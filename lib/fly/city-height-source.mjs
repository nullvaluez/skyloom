// Server only. Pesaresi & Politis, GHS-BUILT-H (R2023A), European
// Commission JRC, CC BY 4.0. AGBH is built volume divided by cell area.
// Source and licence: https://registry.opendata.aws/ghs-built-h/
import { fromCustomClient } from 'geotiff';
import { CITY_HEIGHT_PAD, CITY_HEIGHT_SIZE, CITY_HEIGHT_TILES } from './city-height-grid.mjs';
import { BATCH_BUSY, BATCH_FAILED, BATCH_OK, CITY_HEIGHT_BATCH_MAX, encodeCityHeightBatch, parseCityHeightTiles } from './horizon-fill/height-tiles.js';

const source = 'https://jrc-ghsl.s3.eu-central-1.amazonaws.com/ghs-built-h-agbh/r2023a/4326/3asec/2018/GHS_BUILT_H_AGBH_E2018_GLOBE_R2023A_4326_3ss_V1_0.tif';
const degrees = 180 / Math.PI;
let imagePromise;

// Never accept an unbounded reply. The biggest read is the global tile-index
// table (~1.5 MB); a spatial read decodes at most four native 512x512 tiles.
async function requestRange({ headers, signal }) {
  const range = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
  if (!range || Number(range[2]) - Number(range[1]) >= 4 * 1024 * 1024) throw new Error('Unexpected GHSL range');
  const timeout = AbortSignal.timeout(9000);
  const response = await fetch(source, {
    headers, cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.status !== 206 || !response.headers.get('content-range')?.startsWith('bytes ' + range[1] + '-')) {
    await response.body?.cancel();
    throw new Error('GHSL range unavailable');
  }
  return {
    ok: true, status: 206,
    getHeader: name => response.headers.get(name),
    getData: () => response.arrayBuffer(),
  };
}

async function openImage() {
  if (!imagePromise) {
    imagePromise = fromCustomClient({ url: source, request: requestRange }, {
      maxRanges: 0, blockSize: 32768, cacheSize: 96, allowFullFile: false,
    }).then(tiff => tiff.getImage()).then(image => {
      const keys = image.getGeoKeys();
      if (keys.GeographicTypeGeoKey !== 4326 || keys.GTRasterTypeGeoKey !== 1) throw new Error('Unexpected GHSL projection');
      return image;
    }).catch(error => { imagePromise = undefined; throw error; });
  }
  return imagePromise;
}

// Mercator Y is nonlinear in geographic space. Convert every destination row
// before bilinear sampling, including the padded geographic neighbour rows.
export async function readCityHeightTile(x, y) {
  const image = await openImage();
  const [originX, originY] = image.getOrigin(), [dx, dy] = image.getResolution();
  const pixel = 1 / (CITY_HEIGHT_TILES * CITY_HEIGHT_SIZE);
  const xs = new Float64Array(CITY_HEIGHT_PAD), ys = new Float64Array(CITY_HEIGHT_PAD);
  const clamp = (value, high) => Math.max(0, Math.min(high, value));
  for (let i = 0; i < CITY_HEIGHT_PAD; i++) {
    const u = (x * CITY_HEIGHT_SIZE + i - .5) * pixel;
    const v = (y * CITY_HEIGHT_SIZE + i - .5) * pixel;
    xs[i] = clamp(((u * 360 - 180) - originX) / dx - .5, image.getWidth() - 1);
    ys[i] = clamp((Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * degrees - originY) / dy - .5, image.getHeight() - 1);
  }
  const x0 = Math.floor(xs[0]), y0 = Math.floor(ys[0]);
  const x1 = Math.min(image.getWidth(), Math.floor(xs.at(-1)) + 2);
  const y1 = Math.min(image.getHeight(), Math.floor(ys.at(-1)) + 2);
  const width = x1 - x0;
  const heights = await image.readRasters({
    window: [x0, y0, x1, y1], samples: [0], interleave: true, signal: AbortSignal.timeout(12000),
  });
  const result = new Uint8Array(CITY_HEIGHT_PAD ** 2), noData = image.getGDALNoData();
  const heightAt = i => Number.isFinite(heights[i]) && heights[i] !== noData && heights[i] > 0 ? heights[i] : 0;
  for (let j = 0; j < CITY_HEIGHT_PAD; j++) {
    const sy = ys[j] - y0, row = Math.floor(sy) * width, next = Math.min(row + width, heights.length - width), fy = sy % 1;
    for (let i = 0; i < CITY_HEIGHT_PAD; i++) {
      const sx = xs[i] - x0, a = Math.floor(sx), b = Math.min(a + 1, width - 1), fx = sx % 1;
      const top = heightAt(row + a) * (1 - fx) + heightAt(row + b) * fx;
      const bottom = heightAt(next + a) * (1 - fx) + heightAt(next + b) * fx;
      result[j * CITY_HEIGHT_PAD + i] = Math.min(255, Math.round(16 * Math.sqrt(top * (1 - fy) + bottom * fy)));
    }
  }
  return result;
}

/**
 * HORIZON FILL (FLY_HORIZON_FILL.md, stream A): the /api/city-height service,
 * free of the Next runtime so scripts/verify-horizon-fill-data.mjs can drive
 * it with a fake reader. app/api/city-height/route.js wraps handle() in a
 * Response.
 *
 *   ?v=1&x=&y=          one tile, exactly the original route: 16,900 bytes,
 *                       400 / 429 (four reads pending) / 503, immutable caching
 *   ?v=1&tiles=x.y,...  up to CITY_HEIGHT_BATCH_MAX tiles in one response
 *                       (framing: lib/fly/horizon-fill/height-tiles.js). Each
 *                       tile shares the same recent-tile LRU and the same
 *                       pending guard: a read starts only while fewer than
 *                       maxPending reads run, waiting at most batchWaitMs for a
 *                       slot, after which that tile is reported busy. A batch
 *                       that could start no read at all is a 429.
 *
 * Compression is left to the platform (no content-encoding is set here).
 */

const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

export function createCityHeightService({
  read = readCityHeightTile, maxPending = 4, recentTiles = 256, batchMax = CITY_HEIGHT_BATCH_MAX, batchWaitMs = 15000,
  now = () => Date.now(),
} = {}) {
  const pending = new Map();
  const recent = new Map();
  const stats = { single: 0, batches: 0, reads: 0, recentHits: 0, busy: 0, failed: 0 };

  function remember(key, bytes) {
    recent.delete(key);
    if (recent.size >= recentTiles) recent.delete(recent.keys().next().value);
    recent.set(key, bytes);
  }

  function recall(key) {
    const tile = recent.get(key);
    if (tile) {
      stats.recentHits++;
      recent.delete(key);
      recent.set(key, tile);
    }
    return tile;
  }

  function startRead(x, y, key) {
    stats.reads++;
    const load = Promise.resolve().then(() => read(x, y)).then((bytes) => {
      remember(key, bytes);
      return bytes;
    }).finally(() => pending.delete(key));
    pending.set(key, load);
    return load;
  }

  async function single(params) {
    const xText = params.get('x'), yText = params.get('y');
    if (params.get('v') !== '1' || !/^\d{1,4}$/.test(xText) || !/^\d{1,4}$/.test(yText)) return { status: 400, headers: null, body: null };
    const x = Number(xText), y = Number(yText);
    if (x >= CITY_HEIGHT_TILES || y >= CITY_HEIGHT_TILES) return { status: 400, headers: null, body: null };
    stats.single++;
    const key = y * CITY_HEIGHT_TILES + x;
    let tile = recall(key);
    if (!tile) {
      let load = pending.get(key);
      if (!load) {
        if (pending.size >= maxPending) return { status: 429, headers: { 'retry-after': '2', 'cache-control': 'no-store' }, body: null };
        load = startRead(x, y, key);
      }
      try { tile = await load; } catch {
        return { status: 503, headers: { 'retry-after': '60', 'cache-control': 'no-store' }, body: null };
      }
    }
    return { status: 200, headers: { 'content-type': 'application/octet-stream', 'cache-control': IMMUTABLE }, body: tile };
  }

  // Wait for any running read to settle (true), or for the deadline (false).
  async function settled(deadline) {
    const left = deadline - now();
    if (left <= 0) return false;
    let timer;
    await Promise.race([
      ...[...pending.values()].map((p) => p.catch(() => {})),
      new Promise((resolve) => { timer = setTimeout(resolve, Math.min(left, 1000)); }),
    ]);
    clearTimeout(timer);
    return true;
  }

  async function tileFor(x, y, deadline) {
    const key = y * CITY_HEIGHT_TILES + x;
    let load = recall(key) ?? pending.get(key);
    // The slot test and startRead run in one turn, so a batch never starts
    // more than maxPending reads between them.
    while (!load) {
      if (pending.size < maxPending) {
        load = startRead(x, y, key);
        break;
      }
      if (!(await settled(deadline))) return { status: BATCH_BUSY, started: false };
      load = recall(key) ?? pending.get(key);
    }
    try {
      return { status: BATCH_OK, bytes: await load, started: true };
    } catch {
      return { status: BATCH_FAILED, started: true };
    }
  }

  async function batch(params) {
    const tiles = params.get('v') === '1' ? parseCityHeightTiles(params.get('tiles'), batchMax) : null;
    if (!tiles) return { status: 400, headers: null, body: null };
    stats.batches++;
    const deadline = now() + batchWaitMs;
    const entries = await Promise.all(tiles.map(([x, y]) => tileFor(x, y, deadline)));
    for (const e of entries) {
      if (e.status === BATCH_BUSY) stats.busy++;
      else if (e.status === BATCH_FAILED) stats.failed++;
    }
    if (!entries.some((e) => e.started)) return { status: 429, headers: { 'retry-after': '2', 'cache-control': 'no-store' }, body: null };
    const allOk = entries.every((e) => e.status === BATCH_OK);
    return {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'cache-control': allOk ? IMMUTABLE : 'no-store' },
      body: encodeCityHeightBatch(entries),
    };
  }

  return {
    handle(params) {
      return params.has('tiles') ? batch(params) : single(params);
    },
    stats() {
      return { ...stats, pending: pending.size, recent: recent.size };
    },
  };
}

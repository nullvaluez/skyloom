// Server only. Pesaresi & Politis, GHS-BUILT-H (R2023A), European
// Commission JRC, CC BY 4.0. AGBH is built volume divided by cell area.
// Source and licence: https://registry.opendata.aws/ghs-built-h/
import { fromCustomClient } from 'geotiff';
import { CITY_HEIGHT_PAD, CITY_HEIGHT_SIZE, CITY_HEIGHT_TILES } from './city-height-grid.mjs';

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

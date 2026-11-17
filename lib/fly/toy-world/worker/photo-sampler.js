/**
 * World Pass D (LOOK, M1 roofPhoto): the roof colour of a building read from
 * the Esri World Imagery photograph under it. Stream D owns this file.
 *
 * Two halves:
 *
 *   fetchPhoto(z, x, y, cfg) -> photo | null                      (browser only)
 *       The 16 z16 Esri World Imagery tiles under one z14 tile (cfg.zoom) and
 *       the one colour-balanced z11 tile r25-color-ref.js divides the ground by
 *       (cfg.refZoom, kept decoded per worker: regionalLoad / regionalFrame /
 *       regionalAt). The URLs are the terrain's own (lib/fly/vendor/three-tile
 *       ArcGIS source), read from the terrain's Cache API store when the request
 *       names it (cfg.cacheName, read only) and then from the network. A
 *       network error is retried (cfg.retries); nothing is latched as a miss.
 *       Round 2: NO BUILD WAITS FOR THIS. look-roofs.js calls it after a tile
 *       with buildings is built, and the result recolours that tile's roofs in
 *       place on the main thread (lib/fly/look-roof-patch.js).
 *
 *   prepareRoofLook(tileCtx, items, cfg, structOf, opts) -> { roofOf, stats }   (pure)
 *       Per building under `maxH`: the footprint is rasterised at the photo's
 *       pixel centres, eroded by `insetM`, and the pixels that look like
 *       vegetation overhang, baked shadow or blown highlight are dropped. A read
 *       needs `minPx` pixels and `minShare` of the footprint. The colour is the
 *       mean of the interquartile luma band in LINEAR light (a robust median),
 *       times the r25 exposure ratio (ref / mosaic low-pass LUMA, per 32 px
 *       cell, clamped; luma only, no hue shift), then de-lit to an albedo: chroma clamped to `satMax` and luma
 *       clamped to [albedoMin, albedoMax], so a sunlit Phoenix roof at sRGB 246
 *       is not an albedo of 0.9 lit again by our sun. Pure: the node probe
 *       (scripts/wp-look-roofphoto.mjs) feeds it a sharp-decoded mosaic.
 *
 * Height: towers lean in the photo outside Manhattan (critique-realism 1.1:
 * the Burj, IFC 2, the Cocoon and Montparnasse put their facade over the
 * footprint), so only roofs under `maxH` read their own pixels (or a wide one,
 * see `leanK`). Round 2: a roof of a tall structure (its own height or its
 * structure's top at `maxH` or more), setback terraces included, takes a
 * NEUTRAL roof family (membrane, gravel, mechanical) tinted by the photo's
 * LUMINANCE only, never its hue: the photo is not true-ortho, so a tower's
 * footprint samples the street or a neighbour. Every other roof falls back to
 * structure mates' reads, then the block median (a world-anchored `blockMerc`
 * cell, then its 3x3), then opts.fallback (colour.js: the regional photo,
 * corrected by this worker's finished tiles, or the neighbours' medians),
 * never to a typology palette.
 *
 * Photo values are ephemeral (critique-feasibility 7): nothing derived from the
 * photo is written to any persistent cache.
 */

const URL_TEMPLATE = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Defaults; the request's look.worker.photo overrides each key. */
const PHOTO_DEFAULTS = {
  zoom: 16,
  refZoom: 11,
  refClamp: [0.5, 2],
  concurrency: 12, // photo fetches in flight per worker
  fetchTimeoutMs: 6000,
  retries: 2, // a network error is retried (not a 404 or the placeholder)
  retryMs: [800, 2500],
  patchTimeoutMs: 45000, // the whole late photo of one tile
  cacheName: null, // the terrain's Cache API store (read only), from the request
  maxH: 30,
  leanK: 2,
  leanInset: 0.2,
  insetM: 1.2,
  minPx: 5,
  minShare: 0.35,
  shadowK: 0.55,
  darkL: 0.06,
  blownL: 0.97,
  greenK: 0.05,
  albedoGain: 1,
  albedoMin: 0.035,
  albedoMax: 0.6,
  satMax: 0.5,
  blockMerc: 128,
  blockMin: 3,
  placeholderBytes: 2521,
  tallSat: 0.12, // a wide tall roof's own read: chroma clamp (membrane roofs are neutral)
  tallLumaK: 0.35, // a tall roof's neutral family moves this far toward the photo's luma
  fallbackSat: 0.3, // the regional fallback's chroma clamp
  fallbackJitter: 0.05, // +- value jitter of a fallback roof (by building id)
};

function photoConfig(look) {
  const w = look && look.worker && look.worker.photo;
  return w && typeof w === 'object' ? { ...PHOTO_DEFAULTS, ...w } : PHOTO_DEFAULTS;
}

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// --- browser half: fetch, decode, retry --------------------------------------
//
// Round 2: the build never waits for the photo. A 'sat-buildings' build takes
// its roofs from what the worker already holds (the tile's finished roofs, or
// the regional z11 photo as the fallback), and only after the tile is built,
// and only when it has buildings, is the z16 photo fetched (look-roofs.js
// lookRoofPatch). A failed sub-tile is retried, never latched as a miss.

const WORLD = 2 * Math.PI * 6378137;
const HALF = WORLD / 2;

let active = 0;
const waiters = [];
function acquire(limit) {
  if (active < limit) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((r) => waiters.push(r));
}
function release() {
  const next = waiters.shift();
  if (next) next();
  else active -= 1;
}

/** The terrain's Cache API store, read only; its name travels in the request (null: not read). */
const cacheByName = new Map();
function rasterCache(name) {
  if (!name || typeof caches === 'undefined') return Promise.resolve(null);
  if (!cacheByName.has(name)) cacheByName.set(name, caches.open(name).catch(() => null));
  return cacheByName.get(name);
}

const sleep = (ms, signal) =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
  });

/** One attempt: { bmp } | { miss: true } (placeholder, 4xx: final) | { error: true } (retry). */
async function loadTileOnce(url, cfg, signal) {
  let blob = null;
  try {
    const c = await rasterCache(cfg.cacheName);
    const hit = c ? await c.match(url) : null;
    if (hit && hit.ok !== false) blob = await hit.blob();
  } catch {
    blob = null;
  }
  if (!blob) {
    if (signal.aborted) return { error: true };
    await acquire(Math.max(1, cfg.concurrency | 0));
    try {
      if (signal.aborted) return { error: true };
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      signal.addEventListener('abort', stop);
      const timer = setTimeout(stop, cfg.fetchTimeoutMs);
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl.signal });
        if (!res.ok) return res.status >= 400 && res.status < 500 && res.status !== 429 ? { miss: true } : { error: true };
        blob = await res.blob();
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
    } catch {
      return { error: true };
    } finally {
      release();
    }
  }
  if (!blob || signal.aborted) return { error: true };
  // Esri answers a zoom it has no capture for with a fixed 2,521-byte
  // "map data not yet available" tile: never read it as a roof.
  if (blob.size === cfg.placeholderBytes || blob.size < 256) return { miss: true };
  try {
    return { bmp: await createImageBitmap(blob) };
  } catch {
    return { miss: true };
  }
}

/** One imagery tile as an ImageBitmap, or null; a network error is retried (cfg.retries, cfg.retryMs). */
async function loadTile(url, cfg, signal) {
  for (let a = 0; ; a++) {
    const r = await loadTileOnce(url, cfg, signal);
    if (r.bmp) return r.bmp;
    if (r.miss || signal.aborted || a >= (cfg.retries | 0)) return null;
    await sleep((cfg.retryMs && cfg.retryMs[a]) || 2000, signal);
  }
}

const tileUrl = (z, x, y) => URL_TEMPLATE.replace('{z}', z).replace('{y}', y).replace('{x}', x);

function bitmapRGBA(bmp, size) {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

// The regional photo: the colour-balanced z11 tile r25-color-ref.js divides
// the ground by. One fetch serves 64 z14 tiles; it is the reference of the z16
// exposure ratio and the build-time roof fallback (a build never waits for it).
// Decoded once per worker, bounded.
const REGIONAL = new Map(); // 'z/x/y' -> { rgba } | { p: Promise } | { failAt }
const REGIONAL_MAX = 24;

function regionalKey(z, x, y, rz) {
  const s = z - rz;
  return `${rz}/${x >> s}/${y >> s}`;
}

/** Start (or reuse) the regional tile over z/x/y; resolves to its rgba (256 x 256) or null. */
function regionalLoad(z, x, y, cfg) {
  const rz = cfg.refZoom | 0;
  if (!(rz < z && z - rz <= 6) || typeof OffscreenCanvas === 'undefined' || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return Promise.resolve(null);
  const key = regionalKey(z, x, y, rz);
  const e = REGIONAL.get(key);
  if (e && e.rgba) return Promise.resolve(e.rgba);
  if (e && e.p) return e.p;
  if (e && e.failAt && performance.now() - e.failAt < 15000) return Promise.resolve(null);
  const s = z - rz;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.patchTimeoutMs);
  const p = loadTile(tileUrl(rz, x >> s, y >> s), cfg, ctl.signal)
    .then((bmp) => {
      if (!bmp) return null;
      const rgba = bitmapRGBA(bmp, 256);
      bmp.close?.();
      return rgba;
    })
    .catch(() => null)
    .then((rgba) => {
      clearTimeout(timer);
      REGIONAL.delete(key);
      if (REGIONAL.size >= REGIONAL_MAX) REGIONAL.delete(REGIONAL.keys().next().value);
      REGIONAL.set(key, rgba ? { rgba } : { failAt: performance.now() });
      return rgba;
    });
  REGIONAL.set(key, { p });
  return p;
}

// Roof against region, per regional tile: what this worker's finished tiles
// measured (sum of log(own read / regional colour) per channel). The fallback
// roof and the far roof are the regional colour times its geometric mean.
const CORR = new Map();
const CORR_MIN = 8;
/** The correction for a regional key ([3] gains) once `CORR_MIN` reads back it, else null. */
function regionalCorr(key) {
  const c = key ? CORR.get(key) : null;
  return c && c.n >= CORR_MIN ? c.s.map((v) => Math.exp(v / c.n)) : null;
}
/** Learn from one finished tile: pairs of [own read, regional colour] (linear). */
function regionalLearn(key, pairs) {
  if (!key || !pairs.length) return;
  const c = CORR.get(key) || { n: 0, s: [0, 0, 0] };
  for (const [own, reg] of pairs) {
    if (c.n >= 4000) break;
    for (let i = 0; i < 3; i++) c.s[i] += Math.log(Math.max(1e-3, own[i]) / Math.max(1e-3, reg[i]));
    c.n += 1;
  }
  CORR.set(key, c);
}

/** Node gates only: put a decoded regional tile (256 x 256 RGBA) in this worker's store. */
function regionalSeed(z, x, y, cfg, rgba) {
  const key = regionalKey(z, x, y, cfg.refZoom | 0);
  if (rgba) REGIONAL.set(key, { rgba });
  else REGIONAL.delete(key);
}

/** The regional tile over z/x/y as a sampler frame, if already decoded (never waits), else null. */
function regionalFrame(z, x, y, cfg) {
  const rz = cfg.refZoom | 0;
  const key = regionalKey(z, x, y, rz);
  const e = REGIONAL.get(key);
  if (!e || !e.rgba) return null;
  const s = z - rz;
  return { rgba: e.rgba, z: rz, tx: x >> s, ty: y >> s, key };
}

/**
 * The mean linear colour of the regional photo around world Mercator (wx, wy):
 * a 5 x 5 pixel window (about 300 m at 40 N), vegetation, deep shadow and blown
 * pixels rejected, or null. Pure.
 */
function regionalAt(reg, wx, wy) {
  const n = 2 ** reg.z;
  const px = ((wx + HALF) / WORLD) * n * 256 - reg.tx * 256;
  const py = ((HALF - wy) / WORLD) * n * 256 - reg.ty * 256;
  const cx = Math.floor(px), cy = Math.floor(py);
  let r = 0, g = 0, b = 0, k = 0;
  for (let yy = Math.max(0, cy - 2); yy <= Math.min(255, cy + 2); yy++) {
    for (let xx = Math.max(0, cx - 2); xx <= Math.min(255, cx + 2); xx++) {
      const o = (yy * 256 + xx) * 4;
      const R = reg.rgba[o], G = reg.rgba[o + 1], B = reg.rgba[o + 2];
      if (G - R > 12 && G - B > 6) continue;
      const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (L < 25 || R >= 247 || G >= 247 || B >= 247) continue;
      r += SRGB_TO_LIN[R];
      g += SRGB_TO_LIN[G];
      b += SRGB_TO_LIN[B];
      k++;
    }
  }
  return k >= 5 ? [r / k, g / k, b / k] : null;
}

/**
 * The lit ground colour of the regional photo around one z14 tile (its crop
 * plus one tile of margin each side): the mean, in linear light, of the lit
 * half of the pixels that are not vegetation. The walls' local earth (colour.js)
 * reads this, never the z16 photo, so a wall is decided at build time. Pure.
 */
function regionalGround(reg, z, x, y) {
  const span = 1 << (z - reg.z);
  const cell = 256 / span;
  const x0 = Math.max(0, (x - reg.tx * span - 1) * cell), x1 = Math.min(256, (x - reg.tx * span + 2) * cell);
  const y0 = Math.max(0, (y - reg.ty * span - 1) * cell), y1 = Math.min(256, (y - reg.ty * span + 2) * cell);
  const px = [];
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * 256 + xx) * 4;
      const R = reg.rgba[o], G = reg.rgba[o + 1], B = reg.rgba[o + 2];
      if (G - R > 12 && G - B > 6) continue;
      px.push([0.2126 * R + 0.7152 * G + 0.0722 * B, R, G, B]);
    }
  }
  if (px.length < 64) return null;
  px.sort((a, b) => a[0] - b[0]);
  const g0 = px.length >> 1, g1 = Math.max(g0 + 1, px.length - (px.length >> 3));
  const acc = [0, 0, 0];
  for (let t = g0; t < g1; t++) for (let c = 0; c < 3; c++) acc[c] += SRGB_TO_LIN[px[t][c + 1]];
  return acc.map((v) => v / (g1 - g0));
}

/**
 * The z16 photo under one z14 tile, each sub-tile retried on a network error,
 * the whole bounded by `patchTimeoutMs`. Resolves to the photo object
 * (photoFromPixels) or null when no sub-tile arrived. Browser only.
 */
async function fetchPhoto(z, x, y, cfg) {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
  const dz = (cfg.zoom | 0) - z;
  if (dz < 0 || dz > 3) return null;
  const sub = 1 << dz;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.patchTimeoutMs);
  try {
    const jobs = [];
    for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) jobs.push(loadTile(tileUrl(cfg.zoom, x * sub + i, y * sub + j), cfg, ctl.signal));
    const refP = regionalLoad(z, x, y, cfg);
    const got = await Promise.all(jobs);
    const reg = await refP;
    let ref = null;
    if (reg) {
      const span = 1 << (z - (cfg.refZoom | 0));
      const cell = 256 / span;
      const ox = (x % span) * cell, oy = (y % span) * cell;
      const rgba = new Uint8ClampedArray(cell * cell * 4);
      for (let r = 0; r < cell; r++) rgba.set(reg.subarray(((oy + r) * 256 + ox) * 4, ((oy + r) * 256 + ox + cell) * 4), r * cell * 4);
      ref = { n: cell, rgba };
    }
    const photo = got.some(Boolean) ? composePhoto(got, sub, ref, cfg) : null;
    for (const b of got) b?.close?.();
    return photo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Draw the sub-tiles into one mosaic; `ref` is the reference block { n, rgba } or null. */
function composePhoto(bitmaps, sub, ref, cfg) {
  const size = 256 * sub;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const valid = new Uint8Array(sub * sub);
  bitmaps.forEach((b, k) => {
    if (!b) return;
    ctx.drawImage(b, (k % sub) * 256, Math.floor(k / sub) * 256, 256, 256);
    valid[k] = 1;
  });
  const rgba = ctx.getImageData(0, 0, size, size).data;
  return photoFromPixels(rgba, size, valid, sub, ref, cfg);
}

/**
 * The photo object prepareRoofLook reads, from decoded pixels (also the node
 * probe's entry point). rgba: size x size sRGB, row 0 = north; valid: per
 * sub-tile 0/1; ref: { n, rgba } n x n reference pixels over the same area, or null.
 */
function photoFromPixels(rgba, size, valid, sub, ref, cfg = PHOTO_DEFAULTS) {
  // Tile median sRGB luma (for the shadow test), over valid pixels, strided.
  const lumas = [];
  const ground = []; // [L, r, g, b] of non-vegetation pixels: the place's lit-ground colour (wall earth tint)
  const subPx = size / sub;
  for (let yy = 1; yy < size; yy += 4) {
    for (let xx = 1; xx < size; xx += 4) {
      if (!valid[Math.floor(yy / subPx) * sub + Math.floor(xx / subPx)]) continue;
      const o = (yy * size + xx) * 4;
      const L = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
      lumas.push(L);
      if (!(rgba[o + 1] - rgba[o] > 12 && rgba[o + 1] - rgba[o + 2] > 6) && (yy & 15) === 1 && (xx & 15) === 1) ground.push([L, rgba[o], rgba[o + 1], rgba[o + 2]]);
    }
  }
  lumas.sort((a, b) => a - b);
  let groundLin = null;
  if (ground.length >= 64) {
    ground.sort((a, b) => a[0] - b[0]);
    const g0 = ground.length >> 1, g1 = Math.max(g0 + 1, ground.length - (ground.length >> 3)); // the lit half
    const acc = [0, 0, 0];
    for (let t = g0; t < g1; t++) for (let c = 0; c < 3; c++) acc[c] += SRGB_TO_LIN[ground[t][c + 1]];
    groundLin = acc.map((v) => v / (g1 - g0));
  }
  const medianL = lumas.length ? lumas[lumas.length >> 1] / 255 : 0.4;
  // r25-color-ref.js: hi *= clamp(ref / lowpass(hi)) per channel, here per reference cell.
  let ratio = null;
  let rn = 0;
  if (ref && ref.n > 0) {
    rn = ref.n;
    ratio = new Float32Array(rn * rn * 3).fill(1);
    const cellPx = size / rn;
    const [lo, hi] = cfg.refClamp || [0.5, 2];
    for (let cy = 0; cy < rn; cy++) {
      for (let cx = 0; cx < rn; cx++) {
        const sx = Math.floor((cx * cellPx) / subPx), sy = Math.floor((cy * cellPx) / subPx);
        if (!valid[sy * sub + sx]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        const step = Math.max(1, Math.floor(cellPx / 8));
        for (let py = Math.floor(cy * cellPx); py < (cy + 1) * cellPx; py += step) {
          for (let px = Math.floor(cx * cellPx); px < (cx + 1) * cellPx; px += step) {
            const o = (py * size + px) * 4;
            r += SRGB_TO_LIN[rgba[o]];
            g += SRGB_TO_LIN[rgba[o + 1]];
            b += SRGB_TO_LIN[rgba[o + 2]];
            n++;
          }
        }
        if (!n) continue;
        const ro = (cy * rn + cx) * 4;
        const q = (cy * rn + cx) * 3;
        const m = [r / n, g / n, b / n];
        const f = [SRGB_TO_LIN[ref.rgba[ro]], SRGB_TO_LIN[ref.rgba[ro + 1]], SRGB_TO_LIN[ref.rgba[ro + 2]]];
        // Exposure only (luma): the per-channel ratio pushed Midtown's roofs
        // 15-20 % warmer than the mosaic (mean ratio 1.02 / 0.86 / 0.82), a hue
        // shift this sampler cannot check against the ground it sits on.
        const ym = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
        const yf = 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
        const k = ym > 1e-4 ? Math.min(hi, Math.max(lo, yf / ym)) : 1;
        for (let c = 0; c < 3; c++) ratio[q + c] = k;
      }
    }
  }
  return { size, rgba, valid, sub, medianL, ratio, rn, ground: groundLin };
}

// --- pure half: per-building reads ------------------------------------------------

/** Bilinear exposure ratio at mosaic pixel (px, py). */
function ratioAt(photo, px, py, out) {
  if (!photo.ratio) {
    out[0] = out[1] = out[2] = 1;
    return out;
  }
  const rn = photo.rn;
  const fx = Math.min(rn - 1, Math.max(0, (px / photo.size) * rn - 0.5));
  const fy = Math.min(rn - 1, Math.max(0, (py / photo.size) * rn - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(rn - 1, x0 + 1), y1 = Math.min(rn - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const R = photo.ratio;
  for (let c = 0; c < 3; c++) {
    const a = R[(y0 * rn + x0) * 3 + c], b = R[(y0 * rn + x1) * 3 + c];
    const d = R[(y1 * rn + x0) * 3 + c], e = R[(y1 * rn + x1) * 3 + c];
    out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
  }
  return out;
}

/** Linear colour -> albedo: chroma clamp, then luma clamp (hue kept). */
function toAlbedo(c, cfg) {
  let [r, g, b] = c.map((v) => v * cfg.albedoGain);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx > 1e-5 ? (mx - mn) / mx : 0;
  if (sat > cfg.satMax) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = cfg.satMax / sat;
    r = y + (r - y) * k;
    g = y + (g - y) * k;
    b = y + (b - y) * k;
  }
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = y < cfg.albedoMin ? cfg.albedoMin / Math.max(1e-5, y) : y > cfg.albedoMax ? cfg.albedoMax / y : 1;
  return [r * t, g * t, b * t].map((v) => Math.max(0, Math.min(1, v)));
}

/**
 * One building's read, or null. poly in tile units (layer extent E).
 * Returns a linear albedo [r, g, b].
 */
function readRoof(photo, poly, E, mPerPx, cfg, scratch) {
  const S = photo.size;
  const k = S / E;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly.outer) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const bx0 = Math.max(0, Math.floor(x0 * k)), bx1 = Math.min(S - 1, Math.ceil(x1 * k));
  const by0 = Math.max(0, Math.floor(y0 * k)), by1 = Math.min(S - 1, Math.ceil(y1 * k));
  if (bx1 < bx0 || by1 < by0) return null;
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
  if (w * h > 262144) return null; // a mega block is not a roof
  const mask = new Uint8Array(w * h);
  const rings = [poly.outer, ...poly.holes];
  const xs = scratch.xs;
  let total = 0;
  for (let j = 0; j < h; j++) {
    const ty = (by0 + j + 0.5) / k;
    xs.length = 0;
    for (const ring of rings) {
      for (let e = 0, q = ring.length - 1; e < ring.length; q = e++) {
        const a = ring[q], b = ring[e];
        if (a.y > ty !== b.y > ty) xs.push((a.x + ((ty - a.y) * (b.x - a.x)) / (b.y - a.y)) * k);
      }
    }
    xs.sort((a, b) => a - b);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(bx0, Math.ceil(xs[s] - 0.5)), i1 = Math.min(bx1, Math.floor(xs[s + 1] - 0.5));
      for (let i = i0; i <= i1; i++) {
        mask[j * w + (i - bx0)] = 1;
        total++;
      }
    }
  }
  if (total < cfg.minPx) return null;
  // Erode by the inset (4-neighbour, r steps): the photo never lines up exactly.
  let use = mask;
  const r = Math.max(0, Math.round(cfg.insetM / Math.max(0.05, mPerPx)));
  for (let step = 0; step < r; step++) {
    const next = new Uint8Array(w * h);
    let n = 0;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const o = j * w + i;
        if (use[o] && use[o - 1] && use[o + 1] && use[o - w] && use[o + w]) {
          next[o] = 1;
          n++;
        }
      }
    }
    if (n < cfg.minPx) break; // a small house keeps its uneroded pixels
    use = next;
  }
  const rgba = photo.rgba;
  const subPx = S / photo.sub;
  const shadow = Math.max(cfg.darkL, cfg.shadowK * photo.medianL) * 255;
  const blown = cfg.blownL * 255;
  const green = cfg.greenK * 255;
  const keep = scratch.keep;
  keep.length = 0;
  let seen = 0, sx = 0, sy = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!use[j * w + i]) continue;
      const px = bx0 + i, py = by0 + j;
      if (!photo.valid[Math.floor(py / subPx) * photo.sub + Math.floor(px / subPx)]) continue;
      seen++;
      const o = (py * S + px) * 4;
      const R = rgba[o], G = rgba[o + 1], B = rgba[o + 2];
      if (R >= blown || G >= blown || B >= blown) continue;
      if (G - R > green && G - B > green * 0.5) continue; // canopy over the roof
      const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (L < shadow) continue; // baked shadow
      keep.push(L, R, G, B);
      sx += px;
      sy += py;
    }
  }
  const n = keep.length / 4;
  if (!seen || n < cfg.minPx || n < cfg.minShare * seen) return null;
  // Interquartile luma band, averaged in linear light.
  const order = scratch.order;
  order.length = n;
  for (let t = 0; t < n; t++) order[t] = t;
  order.sort((a, b) => keep[a * 4] - keep[b * 4]);
  const lo = n >> 2, hi = Math.max(lo + 1, n - (n >> 2));
  let cr = 0, cg = 0, cb = 0;
  for (let t = lo; t < hi; t++) {
    const q = order[t] * 4;
    cr += SRGB_TO_LIN[keep[q + 1]];
    cg += SRGB_TO_LIN[keep[q + 2]];
    cb += SRGB_TO_LIN[keep[q + 3]];
  }
  const m = hi - lo;
  const ratio = ratioAt(photo, sx / n, sy / n, scratch.ratio);
  return toAlbedo([(cr / m) * ratio[0], (cg / m) * ratio[1], (cb / m) * ratio[2]], cfg);
}

function medianColour(list) {
  if (!list.length) return null;
  const out = [0, 0, 0];
  const ch = new Float32Array(list.length);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < list.length; i++) ch[i] = list[i][c];
    ch.sort();
    out[c] = ch[ch.length >> 1];
  }
  return out;
}

/**
 * The neutral roof family of tall buildings and setback terraces (sRGB hex,
 * decoded to linear): grey and white membrane, gravel ballast, tar, concrete
 * and mechanical decks. Round 2: a tall roof takes one of these by its
 * structure's look id, tinted by the photo's LUMINANCE only.
 */
const NEUTRAL_ROOFS = ['#a9aaa6', '#c3c4c0', '#8e8a82', '#6c6d6a', '#9b9d99', '#b5b3ac', '#7f817e'].map((h) => {
  const n = Number.parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((c) => SRGB_TO_LIN[c]);
});
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Deterministic [0, 1) from two integers. */
function hashUnit(a, b) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** A tall roof: the neutral family by look id, its luma moved `tallLumaK` toward refL (linear luma), +-4 % by part. */
function tallRoof(lookId, partId, refL, cfg) {
  const base = NEUTRAL_ROOFS[Math.floor(hashUnit(lookId, 0x7a11) * NEUTRAL_ROOFS.length) % NEUTRAL_ROOFS.length];
  const Ln = lumaOf(base);
  let L = Ln;
  if (refL != null && Number.isFinite(refL)) L = Ln + (Math.min(cfg.albedoMax, Math.max(cfg.albedoMin, refL)) - Ln) * cfg.tallLumaK;
  const k = (L / Ln) * (0.96 + 0.08 * hashUnit(partId, 0x7a12));
  return base.map((c) => Math.min(1, c * k));
}

/**
 * Per-building roof colours for one tile. items: the near ring's buildings
 * (item.h set). Returns { roofOf(item) -> { rgb, src }, stats }; every item gets
 * a colour. src: 'photo' (its own read), 'structure' (mates' reads), 'block'
 * (the block median), 'tall' (neutral family, luma from the photo's block),
 * 'tallFallback' (neutral family, luma from the fallback), or opts.fallback's
 * own src ('regional', 'neighbour', 'neutral').
 *   structOf(item)   a structure key (mates share reads), or null
 *   opts.tallOf(item)  true for a roof of a tall structure (default: item.h >= maxH)
 *   opts.idOf(item)    the look id the neutral family is picked by (default item.id)
 *   opts.fallback(item, wx, wy) -> { rgb, src }   the roof with no photo evidence
 */
function prepareRoofLook(tileCtx, items, cfg, structOf = null, opts = {}) {
  const photo = tileCtx.lookPhoto || null;
  const E = tileCtx.extent;
  const stats = { buildings: items.length, eligible: 0, photo: 0, structure: 0, block: 0, tall: 0, tallFallback: 0, regional: 0, neighbour: 0, neutral: 0, photoTiles: photo ? photo.valid.reduce((a, b) => a + b, 0) : 0 };
  const tallOf = opts.tallOf || ((it) => !(it.h < cfg.maxH));
  const idOf = opts.idOf || ((it) => it.id);
  const fallbackOf = opts.fallback || (() => ({ rgb: NEUTRAL_ROOFS[0].slice(), src: 'neutral' }));
  const reads = new Map();
  const roof = new Map();
  const scale = E ? tileCtx.tileSpan / E : 1;
  const centre = (it) => {
    const o = it.polys[0].outer;
    let ax = 0, ay = 0;
    for (const p of o) {
      ax += p.x;
      ay += p.y;
    }
    return [tileCtx.mercX0 + (ax / o.length) * scale, tileCtx.mercYTop - (ay / o.length) * scale];
  };
  const cells = new Map();
  const blocks = new Map();
  const structs = new Map();
  const wideOf = (it) => it.h >= cfg.maxH && Math.sqrt(it.areaM2 / (tileCtx.kA * tileCtx.kA)) >= cfg.leanK * it.h;
  if (photo && E) {
    const mPerPx = tileCtx.tileSpan / tileCtx.k / photo.size;
    const scratch = { xs: [], keep: [], order: [], ratio: [1, 1, 1] };
    for (const it of items) {
      // Low roofs read their own pixels. A tall roof does only when its footprint
      // is wide against its height (Madison Square Garden, a mall): the lean
      // then moves the facade over the rim, which a deeper inset drops.
      const wide = wideOf(it);
      if (tallOf(it) && !wide) continue;
      stats.eligible += 1;
      let rgb = readRoof(photo, it.polys[0], E, mPerPx, wide ? { ...cfg, insetM: cfg.insetM + cfg.leanInset * it.h } : cfg, scratch);
      if (!rgb) continue;
      if (wide) rgb = toAlbedo(rgb, { ...cfg, satMax: cfg.tallSat });
      reads.set(it, rgb);
      const w = centre(it);
      const c = [Math.floor(w[0] / cfg.blockMerc), Math.floor(w[1] / cfg.blockMerc)];
      cells.set(it, c);
      const bk = `${c[0]},${c[1]}`;
      if (!blocks.has(bk)) blocks.set(bk, []);
      blocks.get(bk).push(rgb);
      const sk = structOf ? structOf(it) : null;
      if (sk != null) {
        if (!structs.has(sk)) structs.set(sk, []);
        structs.get(sk).push(rgb);
      }
    }
  }
  const blockMed = new Map();
  const blockOf = (c) => {
    const k1 = `${c[0]},${c[1]}`;
    if (blockMed.has(k1)) return blockMed.get(k1);
    let v = null;
    const own = blocks.get(k1) || [];
    if (own.length >= cfg.blockMin) v = medianColour(own);
    else {
      const near = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.push(...(blocks.get(`${c[0] + dx},${c[1] + dy}`) || []));
      if (near.length >= cfg.blockMin) v = medianColour(near);
    }
    blockMed.set(k1, v);
    return v;
  };
  for (const it of items) {
    const own = reads.get(it);
    if (own) {
      roof.set(it, { rgb: own, src: 'photo' });
      stats.photo += 1;
      continue;
    }
    const w = centre(it);
    const b = blocks.size ? blockOf(cells.get(it) || [Math.floor(w[0] / cfg.blockMerc), Math.floor(w[1] / cfg.blockMerc)]) : null;
    if (tallOf(it)) {
      // Tall roofs and setback terraces: the neutral family, luma only.
      const fb = b ? null : fallbackOf(it, w[0], w[1]);
      const refL = b ? lumaOf(b) : fb && fb.src !== 'neutral' ? lumaOf(fb.rgb) : null;
      roof.set(it, { rgb: tallRoof(idOf(it), it.id, refL, cfg), src: b ? 'tall' : 'tallFallback' });
      stats[b ? 'tall' : 'tallFallback'] += 1;
      continue;
    }
    const sk = structOf ? structOf(it) : null;
    const mates = sk != null ? structs.get(sk) : null;
    if (mates && mates.length) {
      roof.set(it, { rgb: medianColour(mates), src: 'structure' });
      stats.structure += 1;
      continue;
    }
    if (b) {
      roof.set(it, { rgb: b, src: 'block' });
      stats.block += 1;
      continue;
    }
    const fb = fallbackOf(it, w[0], w[1]);
    roof.set(it, fb);
    stats[fb.src] = (stats[fb.src] || 0) + 1;
  }
  return { roofOf: (it) => roof.get(it) || null, stats };
}

export { photoFromPixels, prepareRoofLook, readRoof, photoConfig, toAlbedo, tallRoof, fetchPhoto, regionalLoad, regionalFrame, regionalAt, regionalSeed, regionalGround, regionalCorr, regionalLearn, hashUnit, lumaOf, PHOTO_DEFAULTS, SRGB_TO_LIN, NEUTRAL_ROOFS };

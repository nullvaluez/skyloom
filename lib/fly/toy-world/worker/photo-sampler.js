/**
 * World Pass D (LOOK, M1 roofPhoto): the roof colour of a building read from
 * the Esri World Imagery photograph under it. Stream D owns this file.
 *
 * Two halves:
 *
 *   startRoofPhoto(z, x, y, detail, options) -> handle | null      (browser only)
 *       Starts fetching the photo under one z14 'sat-buildings' tile the moment
 *       the tile is requested, in parallel with its vector tile: the 16 z16
 *       tiles (the request's look.worker.photo.zoom) and the one colour-balanced z11
 *       reference tile r25-color-ref.js divides the ground by. The URLs are the
 *       terrain's own (lib/fly/vendor/three-tile ArcGIS source), read from the
 *       terrain's Cache API store first (TERRA_CACHE, read only) and then from
 *       the network (the browser's HTTP cache). Null unless the request carries
 *       look.on and look.roofPhoto (rule 1: the worker reads the request, never
 *       a flag).
 *   handle.settle() -> photo | null
 *       Resolves no later than `waitMs` after the tile request, with whatever
 *       arrived by then. A failed or slow photo NEVER delays a tile beyond that
 *       and never drops it: the tile builds with the block / palette fallback.
 *       What arrived is LATCHED per tile for the worker's life: a rebuild of the
 *       same tile uses exactly the same sub-tiles, so a building never changes
 *       colour on revisit or heal (a photo tile that was late the first time is
 *       never used for that tile).
 *
 *   prepareRoofLook(tileCtx, items, cfg) -> { reads, stats }        (pure)
 *       Per building under `maxH`: the footprint is rasterised at the photo's
 *       pixel centres, eroded by `insetM`, and the pixels that look like
 *       vegetation overhang, baked shadow or blown highlight are dropped. A read
 *       needs `minPx` pixels and `minShare` of the footprint. The colour is the
 *       mean of the interquartile luma band in LINEAR light (a robust median),
 *       times the r25 exposure ratio (ref / mosaic low-pass, per 32 px cell,
 *       clamped), then de-lit to an albedo: chroma clamped to `satMax` and luma
 *       clamped to [albedoMin, albedoMax], so a sunlit Phoenix roof at sRGB 246
 *       is not an albedo of 0.9 lit again by our sun. Pure: the node probe
 *       (scripts/wp-look-roofphoto.mjs) feeds it a sharp-decoded mosaic.
 *
 * Height: towers lean in the photo outside Manhattan (critique-realism 1.1:
 * the Burj, IFC 2, the Cocoon and Montparnasse put their facade over the
 * footprint), so only roofs under `maxH` read their own pixels. Everything else
 * falls back (colour.js): structure mates' reads, the block median (a
 * world-anchored `blockMerc` cell, then its 3x3), then the typology palette.
 *
 * Photo values are ephemeral (critique-feasibility 7): nothing derived from the
 * photo is written to any persistent cache.
 */
import { TERRA_CACHE } from '../../fly-constants';
import { worldPassOf } from './tile-ctx';

const URL_TEMPLATE = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Defaults; the request's look.worker.photo overrides each key. */
const PHOTO_DEFAULTS = {
  zoom: 16,
  refZoom: 11,
  refClamp: [0.5, 2],
  waitMs: 2500,
  concurrency: 8,
  fetchTimeoutMs: 6000,
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

// --- browser half: fetch, decode, latch ---------------------------------------

/** tile key -> { mask, ref } decided by the first build of that tile. */
const LATCH = new Map();
const LATCH_MAX = 4096;
function latchSet(key, v) {
  if (LATCH.size >= LATCH_MAX) LATCH.delete(LATCH.keys().next().value);
  LATCH.set(key, v);
}

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

let cacheP;
function rasterCache() {
  if (cacheP !== undefined) return cacheP;
  cacheP = (async () => {
    try {
      if (!TERRA_CACHE || !TERRA_CACHE.enabled || typeof caches === 'undefined') return null;
      return await caches.open(TERRA_CACHE.name);
    } catch {
      return null;
    }
  })();
  return cacheP;
}

/** One imagery tile as an ImageBitmap, or null (missing, placeholder, error, cancelled). */
async function loadTile(url, cfg, signal) {
  let blob = null;
  try {
    const c = await rasterCache();
    const hit = c ? await c.match(url) : null;
    if (hit && hit.ok !== false) blob = await hit.blob();
  } catch {
    blob = null;
  }
  if (!blob) {
    if (signal.aborted) return null;
    await acquire(Math.max(1, cfg.concurrency | 0));
    try {
      if (signal.aborted) return null;
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      signal.addEventListener('abort', stop);
      const timer = setTimeout(stop, cfg.fetchTimeoutMs);
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl.signal });
        if (!res.ok) return null;
        blob = await res.blob();
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
    } catch {
      return null;
    } finally {
      release();
    }
  }
  if (!blob || signal.aborted) return null;
  // Esri answers a zoom it has no capture for with a fixed 2,521-byte
  // "map data not yet available" tile: never read it as a roof.
  if (blob.size === cfg.placeholderBytes || blob.size < 256) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * Start the photo under one tile. Null unless this is a 'sat-buildings' build
 * with look.roofPhoto in the request and the browser decode APIs exist.
 */
function startRoofPhoto(z, x, y, detail, options) {
  if (detail !== 'sat-buildings') return null;
  const look = worldPassOf(options).look;
  if (!look.on || !look.roofPhoto) return null;
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
  const cfg = photoConfig(look);
  const dz = (cfg.zoom | 0) - z;
  if (dz < 0 || dz > 3) return null;
  const sub = 1 << dz;
  const key = `${z}/${x}/${y}`;
  const latched = LATCH.get(key) || null;
  const t0 = performance.now();
  const ctl = new AbortController();
  const jobs = [];
  for (let j = 0; j < sub; j++) {
    for (let i = 0; i < sub; i++) {
      const bit = j * sub + i;
      if (latched && !(latched.mask & (1 << bit))) {
        jobs.push(null);
        continue;
      }
      const url = URL_TEMPLATE.replace('{z}', cfg.zoom).replace('{y}', y * sub + j).replace('{x}', x * sub + i);
      jobs.push(loadTile(url, cfg, ctl.signal));
    }
  }
  const rz = cfg.refZoom | 0;
  let refJob = null;
  if (rz < z && z - rz <= 6 && (!latched || latched.ref)) {
    const s = z - rz;
    refJob = loadTile(URL_TEMPLATE.replace('{z}', rz).replace('{y}', y >> s).replace('{x}', x >> s), cfg, ctl.signal);
  }
  const got = new Array(jobs.length).fill(null);
  let gotRef = null;
  jobs.forEach((p, k) => p && p.then((b) => (got[k] = b)));
  if (refJob) refJob.then((b) => (gotRef = b));
  let settled = null;
  const settle = () => {
    if (settled) return settled;
    settled = (async () => {
      const wait = Math.max(0, cfg.waitMs - (performance.now() - t0));
      const all = Promise.all([...jobs.filter(Boolean), refJob].filter(Boolean));
      await Promise.race([all, new Promise((r) => setTimeout(r, wait))]);
      ctl.abort(); // what is not here now is never used for this tile
      let mask = 0;
      got.forEach((b, k) => {
        if (b) mask |= 1 << k;
      });
      const ref = !!gotRef && (!latched || latched.ref);
      if (!latched) latchSet(key, { mask, ref });
      const photo = mask ? composePhoto(got, sub, ref ? gotRef : null, x, y, z - rz, cfg) : null;
      for (const b of got) b?.close?.();
      gotRef?.close?.();
      if (photo) photo.waitMs = Math.round(performance.now() - t0);
      return photo;
    })().catch(() => null);
    return settled;
  };
  return { settle, cancel: () => ctl.abort() };
}

/** Draw the sub-tiles into one mosaic and crop the reference block. */
function composePhoto(bitmaps, sub, refBmp, x, y, refShift, cfg) {
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
  let ref = null;
  if (refBmp) {
    const span = 1 << refShift;
    const cell = 256 / span; // reference pixels over this tile (32 at z11 for z14)
    const rc = new OffscreenCanvas(256, 256);
    const rctx = rc.getContext('2d', { willReadFrequently: true });
    rctx.drawImage(refBmp, 0, 0, 256, 256);
    const ox = (x % span) * cell;
    const oy = (y % span) * cell;
    ref = { n: cell, rgba: rctx.getImageData(ox, oy, cell, cell).data };
  }
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
  const subPx = size / sub;
  for (let yy = 1; yy < size; yy += 4) {
    for (let xx = 1; xx < size; xx += 4) {
      if (!valid[Math.floor(yy / subPx) * sub + Math.floor(xx / subPx)]) continue;
      const o = (yy * size + xx) * 4;
      lumas.push(0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]);
    }
  }
  lumas.sort((a, b) => a - b);
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
        for (let c = 0; c < 3; c++) ratio[q + c] = m[c] > 1e-4 ? Math.min(hi, Math.max(lo, f[c] / m[c])) : 1;
      }
    }
  }
  return { size, rgba, valid, sub, medianL, ratio, rn };
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
 * Per-building photo reads and the block medians for one tile.
 * items: the near ring's buildings (item.h set). Returns
 *   { roofOf(item) -> { rgb, src: 'photo'|'structure'|'block'|null }, stats }
 * `structOf(item)` (optional) gives a structure key: mates share reads first.
 */
function prepareRoofLook(tileCtx, items, cfg, structOf = null) {
  const photo = tileCtx.lookPhoto || null;
  const E = tileCtx.extent;
  const stats = { buildings: items.length, eligible: 0, photo: 0, structure: 0, block: 0, palette: 0, photoTiles: photo ? photo.valid.reduce((a, b) => a + b, 0) : 0 };
  const reads = new Map();
  const roof = new Map();
  if (!photo || !E) {
    return { roofOf: (it) => roof.get(it) || null, stats };
  }
  const mPerPx = tileCtx.tileSpan / tileCtx.k / photo.size;
  const scale = tileCtx.tileSpan / E;
  const scratch = { xs: [], keep: [], order: [], ratio: [1, 1, 1] };
  const cell = (it) => {
    const o = it.polys[0].outer;
    let ax = 0, ay = 0;
    for (const p of o) {
      ax += p.x;
      ay += p.y;
    }
    const wx = tileCtx.mercX0 + (ax / o.length) * scale;
    const wy = tileCtx.mercYTop - (ay / o.length) * scale;
    return [Math.floor(wx / cfg.blockMerc), Math.floor(wy / cfg.blockMerc)];
  };
  const blocks = new Map();
  const structs = new Map();
  const cells = new Map();
  for (const it of items) {
    const c = cell(it);
    cells.set(it, c);
    // Low roofs read their own pixels. A tall roof does only when its footprint
    // is wide against its height (Madison Square Garden, a mall): the lean
    // then moves the facade over the rim, which a deeper inset drops.
    const wide = it.h >= cfg.maxH && Math.sqrt(it.areaM2 / (tileCtx.kA * tileCtx.kA)) >= cfg.leanK * it.h;
    if (!(it.h < cfg.maxH) && !wide) continue;
    stats.eligible += 1;
    const rgb = readRoof(photo, it.polys[0], E, mPerPx, wide ? { ...cfg, insetM: cfg.insetM + cfg.leanInset * it.h } : cfg, scratch);
    if (!rgb) continue;
    reads.set(it, rgb);
    const bk = `${c[0]},${c[1]}`;
    if (!blocks.has(bk)) blocks.set(bk, []);
    blocks.get(bk).push(rgb);
    const sk = structOf ? structOf(it) : null;
    if (sk != null) {
      if (!structs.has(sk)) structs.set(sk, []);
      structs.get(sk).push(rgb);
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
    const sk = structOf ? structOf(it) : null;
    const mates = sk != null ? structs.get(sk) : null;
    if (mates && mates.length) {
      roof.set(it, { rgb: medianColour(mates), src: 'structure' });
      stats.structure += 1;
      continue;
    }
    const b = blockOf(cells.get(it));
    if (b) {
      roof.set(it, { rgb: b, src: 'block' });
      stats.block += 1;
    } else stats.palette += 1;
  }
  return { roofOf: (it) => roof.get(it) || null, stats };
}

export { startRoofPhoto, photoFromPixels, prepareRoofLook, readRoof, photoConfig, toAlbedo, PHOTO_DEFAULTS, SRGB_TO_LIN };

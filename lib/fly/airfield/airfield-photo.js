// AIRFIELD PHOTO — the imagery's low frequencies for the airfield materials.
//
// The procedural grass needs the real season and regional colour (Ohio in
// October, Sydney in spring, an alpine valley): the satellite photo has it.
// This composes the SAME Esri World Imagery tiles the terrain draws (same URL,
// same Cache API store as raster-cache.js, so a warm session costs nothing)
// at z15 into one small canvas over the airfield. The materials sample it at a
// high mip: colour only, never the photo's detail (aircraft, shadows and paint
// would read as blotches at a grazing angle).
//
// Browser only. Failure is silent: the materials keep their own palette.
import { TERRA_CACHE } from '../fly-constants.js';

const WORLD = 40075016.68557849;
const URL_TEMPLATE = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

async function fetchTile(url, cache, signal) {
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.blob();
  } catch {
    /* the cache is optional */
  }
  // Read-only use of the terrain's store: its trimming policy stays its own.
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
  if (!res.ok) throw new Error(`imagery ${res.status}`);
  return res.blob();
}

/**
 * @param frame airfield local frame { ox, oz, k }
 * @param bounds local { minX, minZ, maxX, maxZ }
 * @returns { canvas, bounds } or null
 */
export async function loadAirfieldPhoto(frame, bounds, { zoom = 15, maxPx = 1024, signal = null } = {}) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  const sx0 = frame.ox + bounds.minX * frame.k, sx1 = frame.ox + bounds.maxX * frame.k;
  const sz0 = frame.oz + bounds.minZ * frame.k, sz1 = frame.oz + bounds.maxZ * frame.k;
  const span = WORLD / 2 ** zoom;
  const tx0 = Math.floor((sx0 + WORLD / 2) / span), tx1 = Math.floor((sx1 + WORLD / 2) / span);
  const ty0 = Math.floor((sz0 + WORLD / 2) / span), ty1 = Math.floor((sz1 + WORLD / 2) / span);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 160) return null;
  const aspect = (sx1 - sx0) / (sz1 - sz0);
  const W = aspect >= 1 ? maxPx : Math.max(64, Math.round(maxPx * aspect));
  const H = aspect >= 1 ? Math.max(64, Math.round(maxPx / aspect)) : maxPx;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#58603f';
  ctx.fillRect(0, 0, W, H);
  let cache = null;
  try {
    cache = (await globalThis.caches?.open(TERRA_CACHE.name)) ?? null;
  } catch {
    cache = null;
  }
  const jobs = [];
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) jobs.push({ x, y });
  let next = 0, ok = 0;
  const run = async () => {
    while (next < jobs.length && !signal?.aborted) {
      const { x, y } = jobs[next++];
      try {
        const blob = await fetchTile(URL_TEMPLATE.replace('{z}', zoom).replace('{y}', y).replace('{x}', x), cache, signal);
        const bmp = await createImageBitmap(blob);
        const mx0 = -WORLD / 2 + x * span, mz0 = -WORLD / 2 + y * span;
        const px = ((mx0 - sx0) / (sx1 - sx0)) * W, pz = ((mz0 - sz0) / (sz1 - sz0)) * H;
        ctx.drawImage(bmp, px, pz, (span / (sx1 - sx0)) * W + 0.5, (span / (sz1 - sz0)) * H + 0.5);
        bmp.close?.();
        ok++;
      } catch {
        /* a missing tile keeps the neutral fill */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, run));
  if (signal?.aborted || ok === 0) return null;
  return { canvas, bounds: { ...bounds }, tiles: ok, of: jobs.length };
}

// --- measuring the photo (pure given a luma sampler) --------------------------------

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A sampler of the composed photo: local metres -> sRGB luminance 0..1, or -1
 * outside it. Reads the canvas pixels once.
 */
export function photoLumaSampler(photo) {
  const { canvas, bounds } = photo;
  const W = canvas.width, H = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const sx = W / (bounds.maxX - bounds.minX), sz = H / (bounds.maxZ - bounds.minZ);
  return (x, z) => {
    const px = Math.floor((x - bounds.minX) * sx), pz = Math.floor((z - bounds.minZ) * sz);
    if (px < 0 || pz < 0 || px >= W || pz >= H) return -1;
    const i = (pz * W + px) * 4;
    return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  };
}

function median(values) {
  if (!values.length) return -1;
  const v = values.slice().sort((a, b) => a - b);
  return v[v.length >> 1];
}

/** Concrete weight from a feature's median sRGB luminance (imagery: concrete is pale). */
export const concreteFromLuma = (l) => {
  const t = Math.max(0, Math.min(1, (l - 0.38) / 0.14));
  return t * t * (3 - 2 * t);
};

/**
 * The pavement's appearance as a field over the height grid, one RGBA8 texel
 * per node: r = concrete weight, g = the imagery's local pavement level
 * (linear luminance / 0.6), b = paved (any pavement near the node), a = 255.
 *
 * WHY A FIELD. Measured per mesh vertex, the level jumped from feature to
 * feature and interpolated across big triangles: taxiway ribbons, junction
 * pads, fillets and apron polygons overlap, so the same metre of concrete
 * showed triangle-shaped tone patches and z-fought between differently toned
 * coplanar pieces. A field of position alone shades every overlapping piece
 * identically.
 *
 * Each node takes the median imagery luminance over PAVED cells (a raster of
 * the pavement mesh at a quarter step) within one step, else two; concrete is
 * pale in the imagery (concreteFromLuma). Without imagery (`lumaAt` null) the
 * surface classes decide: aprons and helipads concrete, taxiways by airport
 * class. `forceConcrete(x, z)` marks surfaces known to be concrete (the
 * airport set's apron). Pure.
 */
export function buildPavementInfo(grid, pave, { lumaAt = null, aClass = 1, forceConcrete = null } = {}) {
  const { nx, nz, x0, z0, step } = grid;
  const cell = step / 4;
  const mw = (nx - 1) * 4 + 1, mh = (nz - 1) * 4 + 1;
  // Raster of the pavement mesh: 0 = none, else 1 + surface class with
  // aprons winning over taxiways (the priority below).
  const mask = new Uint8Array(mw * mh);
  const rank = [2, 4, 1, 0, 3]; // taxiway, apron, runwayPoly, road, helipad
  const P = pave.position, I = pave.index, S = pave.surf;
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t], ib = I[t + 1], ic = I[t + 2];
    const ax = (P[ia * 3] - x0) / cell, az = (P[ia * 3 + 2] - z0) / cell;
    const bx = (P[ib * 3] - x0) / cell, bz = (P[ib * 3 + 2] - z0) / cell;
    const cx = (P[ic * 3] - x0) / cell, cz = (P[ic * 3 + 2] - z0) / cell;
    const code = Math.max(0, Math.min(4, Math.round(S[ia * 3])));
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(mw - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz))), j1 = Math.min(mh - 1, Math.floor(Math.max(az, bz, cz)));
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const u = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / det;
        const v = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / det;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const k = j * mw + i, cur = mask[k];
        if (!cur || rank[code] > rank[cur - 1]) mask[k] = code + 1;
      }
  }
  const out = new Uint8Array(nx * nz * 4);
  const lumas = [];
  let paved = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 4;
      out[o + 3] = 255;
      let best = -1;
      let concrete = 0, any = 0;
      for (const reach of [4, 8]) {
        lumas.length = 0;
        any = 0;
        concrete = 0;
        const mi = i * 4, mj = j * 4;
        for (let dj = -reach; dj <= reach; dj++) {
          const y = mj + dj;
          if (y < 0 || y >= mh) continue;
          for (let di = -reach; di <= reach; di++) {
            const x = mi + di;
            if (x < 0 || x >= mw || di * di + dj * dj > reach * reach) continue;
            const m = mask[y * mw + x];
            if (!m) continue;
            any++;
            if (m === 2 || m === 5 || (m === 1 && aClass <= 1)) concrete++;
            if (lumaAt) {
              const l = lumaAt(x0 + x * cell, z0 + y * cell);
              if (l >= 0) lumas.push(l);
            }
          }
        }
        if (any >= 4) break;
      }
      if (!any) continue;
      paved++;
      out[o + 2] = 255;
      let cw = concrete / any, tone = mix(0.085, 0.315, cw);
      if (lumas.length >= 4) {
        best = median(lumas);
        cw = concreteFromLuma(best);
        tone = srgbToLinear(best);
      }
      const x = x0 + i * step, z = z0 + j * step;
      if (forceConcrete?.(x, z)) cw = 1;
      out[o] = Math.round(cw * 255);
      out[o + 1] = Math.round(Math.min(1, tone / 0.6) * 255);
    }
  return { data: out, paved };
}

const mix = (a, b, t) => a + (b - a) * t;

/**
 * The imagery's median grass colour (linear rgb) over well-inside grass nodes
 * — the region and season the procedural palette is tinted toward — or null.
 * `rgbAt(x, z, out)` fills sRGB 0..1 and returns false outside the photo.
 */
export function grassTone(grid, field, rgbAt) {
  const r = [], g = [], b = [];
  const { nx, nz, x0, z0, step } = grid;
  const stride = Math.max(1, Math.round(Math.sqrt((nx * nz) / 20000)));
  const c = [0, 0, 0];
  for (let j = 0; j < nz; j += stride)
    for (let i = 0; i < nx; i += stride) {
      if (field[j * nx + i] < 0.99 || !rgbAt(x0 + i * step, z0 + j * step, c)) continue;
      r.push(srgbToLinear(c[0]));
      g.push(srgbToLinear(c[1]));
      b.push(srgbToLinear(c[2]));
    }
  if (r.length < 16) return null;
  return [median(r), median(g), median(b)];
}

/** Like photoLumaSampler, for colour: (x, z, out) -> sRGB in out, or false outside. */
export function photoRgbSampler(photo) {
  const { canvas, bounds } = photo;
  const W = canvas.width, H = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const sx = W / (bounds.maxX - bounds.minX), sz = H / (bounds.maxZ - bounds.minZ);
  return (x, z, out) => {
    const px = Math.floor((x - bounds.minX) * sx), pz = Math.floor((z - bounds.minZ) * sz);
    if (px < 0 || pz < 0 || px >= W || pz >= H) return false;
    const i = (pz * W + px) * 4;
    out[0] = data[i] / 255;
    out[1] = data[i + 1] / 255;
    out[2] = data[i + 2] / 255;
    return true;
  };
}

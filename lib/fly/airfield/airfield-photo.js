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
 * Per-vertex (concrete weight, reference linear luminance) for the pavement
 * mesh, measured feature by feature: taxiways along their centreline with a
 * ±60 m running median (a taxiway can change surface halfway), polygons on a
 * 20 m lattice inside them with a 30 m neighbourhood median, junction pads and
 * fillets at their centre. Writes into `surf` (the aSurf array, stride 3).
 * Returns how many vertices changed.
 */
export function measurePavement(model, pave, lumaAt, onRunway = () => false) {
  const { surf, position, pieces } = pave;
  let changed = 0;
  const write = (v, l) => {
    if (!(l >= 0)) return;
    surf[v * 3 + 1] = concreteFromLuma(l);
    surf[v * 3 + 2] = srgbToLinear(l);
    changed++;
  };
  for (const piece of pieces) {
    if (piece.kind === 'taxiway') {
      const t = model.taxiways[piece.index];
      const samples = [];
      const p = t.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        const n = Math.max(1, Math.round(len / 12));
        for (let k = 0; k < n; k++) {
          const x = p[i] + ((p[i + 2] - p[i]) * k) / n, z = p[i + 1] + ((p[i + 3] - p[i + 1]) * k) / n;
          if (onRunway(x, z)) continue;
          const l = lumaAt(x, z);
          if (l >= 0) samples.push({ x, z, l });
        }
      }
      if (!samples.length) continue;
      const smooth = samples.map((s, i) => median(samples.slice(Math.max(0, i - 5), i + 6).map((q) => q.l)));
      for (let v = piece.v0; v < piece.v1; v++) {
        const x = position[v * 3], z = position[v * 3 + 2];
        let best = 0, bd = Infinity;
        for (let i = 0; i < samples.length; i++) {
          const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        write(v, smooth[best]);
      }
    } else if (piece.kind === 'poly') {
      const rings = model.pavements[piece.index].rings;
      const outer = rings[0];
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        minX = Math.min(minX, outer[i]);
        maxX = Math.max(maxX, outer[i]);
        minZ = Math.min(minZ, outer[i + 1]);
        maxZ = Math.max(maxZ, outer[i + 1]);
      }
      const inside = (x, z) => {
        let hit = false;
        for (const r of rings)
          for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
            if (r[i + 1] > z !== r[j + 1] > z && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) hit = !hit;
        return hit;
      };
      const cell = 20;
      const grid = new Map();
      for (let z = minZ + cell / 2; z < maxZ; z += cell)
        for (let x = minX + cell / 2; x < maxX; x += cell) {
          if (!inside(x, z)) continue;
          const l = lumaAt(x, z);
          if (l < 0) continue;
          const key = `${Math.floor(x / 30)},${Math.floor(z / 30)}`;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(l);
        }
      const all = [...grid.values()].flat();
      const whole = median(all);
      for (let v = piece.v0; v < piece.v1; v++) {
        const x = position[v * 3], z = position[v * 3 + 2];
        const gx = Math.floor(x / 30), gz = Math.floor(z / 30);
        const near = [];
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) near.push(...(grid.get(`${gx + dx},${gz + dz}`) ?? []));
        write(v, near.length >= 3 ? median(near) : whole);
      }
    } else {
      const l = median([0, 1, 2, 3, 4].map((k) => lumaAt(piece.x + (k ? Math.cos(k * 1.57) * 6 : 0), piece.z + (k ? Math.sin(k * 1.57) * 6 : 0))).filter((q) => q >= 0));
      for (let v = piece.v0; v < piece.v1; v++) write(v, l);
    }
  }
  return changed;
}

/** Median linear luminance of the photo over well-inside grass nodes. */
export function grassReference(grid, field, lumaAt) {
  const values = [];
  const { nx, nz, x0, z0, step } = grid;
  const stride = Math.max(1, Math.round(Math.sqrt((nx * nz) / 20000)));
  for (let j = 0; j < nz; j += stride)
    for (let i = 0; i < nx; i += stride) {
      if (field[j * nx + i] < 0.99) continue;
      const l = lumaAt(x0 + i * step, z0 + j * step);
      if (l >= 0) values.push(srgbToLinear(l));
    }
  const m = median(values);
  return m > 0 ? m : 0;
}

// AIRFIELD GRASS — where the infield grass goes, on the height grid's nodes.
//
// The weight at a node is the average over four sub-samples (a quarter step
// apart) of a yes/no test, so the marching-squares contour in
// buildGrassGeometry() lands between nodes at sub-cell precision:
//
//   outside the aerodrome polygon .............................. no
//   on a mapped building (+clearance) or road (+clearance) ...... no
//   WorldCover water / wetland / tree cover ..................... no (photo stays)
//   within `airsideM` of a runway or taxiway (the airside) ...... YES — WorldCover
//     calls much of an airport's infield "built-up" (its 10 m pixels mix the
//     pavement in), so it is only trusted for what is clearly not grass
//   farther out: WorldCover vegetated or bare/sparse ............ YES (bare = dry)
//   no WorldCover for that tile: the airside rule alone.
//
// Pavement is NOT cut out: grass runs under the pavement layers, which sit
// above it, so the two can never open a gap at an edge.
//
// Pure: no three, no DOM.
import { AIRFIELD } from '../observation-config.js';

const CFG = AIRFIELD.ground;
const VEGETATED = new Set([20, 30, 40, 100]);
const NEVER = new Set([10, 70, 80, 90, 95]); // trees, snow, water, wetland, mangrove
const DRYNESS = { 20: 0.45, 30: 0.05, 40: 0.15, 50: 0.25, 60: 0.85, 100: 0.3 };

/** Scanline raster of flat local rings onto a sub-sample lattice (even-odd per piece). */
function rasterRings(mask, w, h, x0, z0, step, pieces) {
  for (const rings of pieces) {
    let minZ = Infinity, maxZ = -Infinity;
    for (const r of rings) for (let i = 1; i < r.length; i += 2) {
      minZ = Math.min(minZ, r[i]);
      maxZ = Math.max(maxZ, r[i]);
    }
    const j0 = Math.max(0, Math.ceil((minZ - z0) / step));
    const j1 = Math.min(h - 1, Math.floor((maxZ - z0) / step));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = z0 + j * step;
      xs.length = 0;
      for (const r of rings)
        for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
          const az = r[k + 1], bz = r[i + 1];
          if (az > z !== bz > z) xs.push(r[k] + ((z - az) * (r[i] - r[k])) / (bz - az));
        }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - x0) / step));
        const i1 = Math.min(w - 1, Math.floor((xs[q + 1] - x0) / step));
        for (let i = i0; i <= i1; i++) mask[j * w + i] = 1;
      }
    }
  }
}

/** Spatial hash of capsules (segments with a radius) for "near a line" tests. */
function capsuleIndex(cell = 48) {
  const grid = new Map();
  return {
    add(ax, az, bx, bz, r) {
      const minX = Math.floor((Math.min(ax, bx) - r) / cell), maxX = Math.floor((Math.max(ax, bx) + r) / cell);
      const minZ = Math.floor((Math.min(az, bz) - r) / cell), maxZ = Math.floor((Math.max(az, bz) + r) / cell);
      const item = { ax, az, bx, bz, r2: r * r };
      for (let x = minX; x <= maxX; x++)
        for (let z = minZ; z <= maxZ; z++) {
          const key = x * 73856093 ^ z * 19349663;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(item);
        }
    },
    near(x, z) {
      const list = grid.get(Math.floor(x / cell) * 73856093 ^ Math.floor(z / cell) * 19349663);
      if (!list) return false;
      for (const s of list) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const L = dx * dx + dz * dz;
        const t = L > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L)) : 0;
        const ex = x - s.ax - dx * t, ez = z - s.az - dz * t;
        if (ex * ex + ez * ez <= s.r2) return true;
      }
      return false;
    },
  };
}

/**
 * @param model airfield model (local metres)
 * @param grid { x0, z0, nx, nz, step } — the height grid
 * @param cover AirfieldData.cover ([{ bounds (scene), data }]) or []
 * @returns { field: Float32Array(nx*nz), dry: Float32Array(nx*nz), coverTiles }
 */
export function buildGrassField(model, grid, cover = []) {
  const { nx, nz, x0, z0, step } = grid;
  const f = model.frame;
  // Sub-sample lattice: 2x per axis, offset a quarter step around each node.
  const sw = nx * 2, sh = nz * 2, sstep = step / 2;
  const sx0 = x0 - step / 4, sz0 = z0 - step / 4;
  const aero = new Uint8Array(sw * sh);
  rasterRings(aero, sw, sh, sx0, sz0, sstep, model.aerodromes.map((a) => a.rings));
  const blocked = capsuleIndex();
  const reach = capsuleIndex(96);
  for (const r of model.runways) reach.add(r.ax, r.az, r.bx, r.bz, r.halfW + r.shoulder + CFG.grass.airsideM);
  for (const t of model.taxiways)
    for (let i = 0; i + 3 < t.pts.length; i += 2) reach.add(t.pts[i], t.pts[i + 1], t.pts[i + 2], t.pts[i + 3], t.halfW + CFG.grass.airsideM);
  const roadW = { service: 6, minor: 7, track: 4, tertiary: 8, secondary: 9, primary: 10, trunk: 12, motorway: 14 };
  for (const r of model.roads)
    for (let i = 0; i + 3 < r.pts.length; i += 2) blocked.add(r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], (roadW[r.cls] ?? 6) / 2 + CFG.grass.roadClearM);
  // Buildings: their own raster on the sub-lattice, then a clearance by
  // capsules along every footprint edge.
  const built = new Uint8Array(sw * sh);
  rasterRings(built, sw, sh, sx0, sz0, sstep, model.buildings.flatMap((b) => b.pieces));
  for (const b of model.buildings)
    for (const rings of b.pieces)
      for (const r of rings) for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) blocked.add(r[k], r[k + 1], r[i], r[i + 1], CFG.grass.buildingClearM);
  // WorldCover lookup by scene position.
  const coverAt = (lx, lz) => {
    const x = f.ox + lx * f.k, z = f.oz + lz * f.k;
    for (const c of cover) {
      const b = c.bounds;
      if (x < b.minX || x >= b.maxX || z < b.minZ || z >= b.maxZ) continue;
      const px = Math.min(255, Math.floor(((x - b.minX) / (b.maxX - b.minX)) * 256));
      const py = Math.min(255, Math.floor(((z - b.minZ) / (b.maxZ - b.minZ)) * 256));
      return c.data[py * 256 + px];
    }
    return -1; // no tile
  };
  const field = new Float32Array(nx * nz);
  const dry = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      let yes = 0;
      let d = 0;
      for (let q = 0; q < 4; q++) {
        const si = i * 2 + (q & 1), sj = j * 2 + (q >> 1);
        const s = sj * sw + si;
        if (!aero[s] || built[s]) continue;
        const x = sx0 + si * sstep, z = sz0 + sj * sstep;
        if (blocked.near(x, z)) continue;
        const code = coverAt(x, z);
        if (NEVER.has(code)) continue;
        if (reach.near(x, z) || VEGETATED.has(code) || code === 60) {
          yes++;
          d += DRYNESS[code] ?? 0.2;
        }
      }
      field[j * nx + i] = yes / 4;
      dry[j * nx + i] = yes ? d / yes : 0;
    }
  return { field, dry, coverTiles: cover.length };
}

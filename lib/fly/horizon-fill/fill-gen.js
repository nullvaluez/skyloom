/**
 * HORIZON FILL (FLY_HORIZON_FILL.md, stream A DATA): the procedural generator.
 *
 * A pure function from the padded 130 x 130 height codes of one z11 survey
 * tile (GHS-BUILT-H, lib/fly/city-height-grid.mjs), a chunk request and a
 * config to a FillChunk: stand-in instances in exactly the encoding
 * createStandInGeometry reads (lib/fly/toy-world/sat-stand-ins.js). No DOM,
 * no three, no Math.random, no Date, no `window`: the fill worker and the
 * node gate import it directly.
 *
 * THE SURVEY VALUE. A cell's code decodes to a = (code / 16)^2 metres, the
 * average gross built height: built volume / cell area. The generator splits
 * it into a ground coverage c(a) and a typical height H(a) = a / c(a):
 *
 *   c(a) = min(cMax, c0 * a^p)       c0 0.10, p 0.70, cMax 0.65
 *   H(a) = a / c(a)                  10 * a^0.3 below the cap (5.5 m at
 *                                    a = 0.14, 10 m at 1, 19 m at 9), then
 *                                    a / 0.65 (towers carry the rest)
 *
 * Both are monotone (c rising, H rising). Calibrated 2026-11-23 against the
 * OpenFreeMap z14 building layer (every polygon of every multipolygon,
 * centroid per survey cell) over whole z11 tiles of central Paris, Midtown
 * Manhattan, Powell OH, Melton VIC and Owens Valley: the mapped coverage per
 * a-bin agrees across all three well-mapped places (a 1: 0.09 to 0.11; a 3:
 * 0.22 to 0.25; a 6.6: 0.37 to 0.40; a 9: 0.47 to 0.51; a 12.5: 0.57 to
 * 0.65), and c0 * a^p sits inside that spread at every bin. Over the
 * well-mapped cells the generated level 0 footprint area is 88 to 95 % of the
 * mapped one; scripts/verify-horizon-fill-data.mjs holds the fixtures.
 *
 * THE NOISE RULE. The survey is bilinearly resampled, so one real house
 * smears into a halo of tiny values and the 3-arcsecond product carries
 * scattered specks in open country. A cell is built only when
 *   a >= floorM                                    (no speck below 0.09 m), and
 *   a >= soloM, or the 3 x 3 neighbourhood sum (the cell included, read from
 *   the padded tile so it is the same on both sides of a tile edge) >= nbMinM.
 * The rule reads survey values only, never the mask, so a cell's buildings do
 * not change when a neighbour is masked (the seam rule).
 *
 * LEVELS.
 *   0  individual buildings in a quarter tile (64 x 64 cells). Each
 *      neighbourhood of 4 x 4 cells has one street orientation and one lot
 *      lattice origin (hashed from its global index), so lots line up the way
 *      streets make them. The lattice pitch comes from the cell's coverage and
 *      its typology's footprint (lot area = footprint / c), so the lot count
 *      follows coverage. Typology bands by a (each threshold jittered per cell):
 *        detached houses (a < 2, 220 m2), terraces and low blocks (a < 5,
 *        380 m2), blocks and slabs (a < 14, 520 m2; 8 % of cells raise one
 *        slab 1.4 to 2x), towers (a >= 14, 900 m2: one or two tall bodies,
 *        1.5x rising to 4x with a, carry the volume). The footprints are the
 *        mapped mean footprint per a-bin of the calibration (Paris and
 *        Manhattan agree within 20 % up to a = 9). A survey cell of a = 12 is
 *        Haussmann Paris as often as Midtown, so the tall bodies start at 14.
 *      Heights are scaled per cell so the cell's instance volume equals its
 *      survey volume. Every box stays inside its own cell with a margin.
 *   1  one box per built cell: footprint c * cell area, height H, yawed to the
 *      neighbourhood's orientation.
 *   2  one box per 2 x 2 cells carrying the summed volume of the unmasked
 *      built cells, at their volume-weighted centre.
 *
 * DETERMINISM. Every hash is of GLOBAL cell indices (gi = tx * 128 + i,
 * gj = ty * 128 + j, gi taken modulo the world), so a building is identical in
 * every session and does not depend on the chunk, the level request or what
 * is masked elsewhere. Instances are sorted by size, DESCENDING (ties by
 * emission order), where size = max(height, footprintK * sqrt(true footprint
 * area)) computed from the QUANTISED dims, exactly the shader's sSize.
 */

export const FILL_GEN_VERSION = 1;

export const WORLD = 40075016.68557849;
export const EARTH_R = 6378137;
export const TILES = 2048;
export const SIZE = 128;
export const PAD = SIZE + 2;
export const TILE_SPAN = WORLD / TILES;
export const CELL = TILE_SPAN / SIZE;
const WORLD_CELLS = TILES * SIZE;
const TAU = Math.PI * 2;

/** Generator defaults; config.data.gen overrides per key, config.data.caps the caps. */
export const FILL_GEN_DEFAULTS = Object.freeze({
  c0: 0.1,
  p: 0.7,
  cMax: 0.65,
  floorM: 0.09,
  soloM: 0.5,
  nbMinM: 0.9,
  minH: 3,
  maxH: 600,
  marginK: 0.04, // cell margin, fraction of a cell side
  nbCells: 4, // neighbourhood side in cells (one orientation, one lattice origin)
  bands: [2, 5, 14], // typology thresholds in a (metres), jittered x 0.85 to 1.15 per cell
});

export const FILL_CAPS_DEFAULT = Object.freeze([40000, 16384, 4096]);

// Typology: footprint (true m2), building aspect (long / short), family
// choices (lib/fly/building-profiles.js), wall and roof sRGB palettes. The
// colours were measured against the mapped far pipeline (sat-skyline
// stand-ins, real OpenFreeMap tiles): walls luminance 53 to 177 (5th to 95th
// percentile across Paris, Manhattan, Powell, Melton), roofs 101 to 182 around
// a neutral (143, 143, 139). These stay inside that range.
const TYPES = [
  { name: 'detached', foot: 220, aspect: 1.35, tall: 0, families: [0, 0, 0, 6],
    walls: [[178, 168, 150], [168, 160, 148], [182, 172, 156], [160, 150, 136]],
    roofs: [[120, 112, 104], [132, 120, 108], [112, 112, 110], [140, 130, 116]] },
  { name: 'terrace', foot: 380, aspect: 2.8, tall: 0, families: [6, 1, 6, 2],
    walls: [[162, 144, 124], [170, 160, 146], [150, 132, 114], [174, 166, 152]],
    roofs: [[126, 122, 118], [138, 134, 128], [118, 116, 114], [146, 142, 134]] },
  { name: 'block', foot: 520, aspect: 2.2, tall: 0.08, families: [1, 2, 3, 1],
    walls: [[170, 164, 152], [158, 154, 146], [164, 152, 136], [176, 172, 162]],
    roofs: [[148, 148, 144], [158, 156, 150], [138, 140, 138], [164, 162, 156]] },
  { name: 'tower', foot: 900, aspect: 1.3, tall: 1, families: [3, 4, 2, 3],
    walls: [[152, 154, 152], [140, 144, 146], [166, 160, 150], [130, 128, 124]],
    roofs: [[156, 156, 152], [148, 150, 150], [166, 164, 158], [140, 140, 138]] },
];

/** The resolved generator config from the fill worker's init(config). */
export function normaliseFillConfig(cfg = {}) {
  const data = cfg.data ?? {};
  const gen = { ...FILL_GEN_DEFAULTS, ...(data.gen ?? {}) };
  const capsIn = Array.isArray(data.caps) ? data.caps : FILL_CAPS_DEFAULT;
  const caps = [0, 1, 2].map((l) => (Number(capsIn[l]) > 0 ? Math.floor(capsIn[l]) : FILL_CAPS_DEFAULT[l]));
  const footprintK = Number.isFinite(cfg.footprintK) && cfg.footprintK > 0 ? cfg.footprintK : 0.9;
  return { gen, caps, footprintK };
}

// ---- hashing (32-bit, integer only) --------------------------------------
function mix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hash3(a, b, salt) {
  return mix((Math.imul(a | 0, 0x27d4eb2d) ^ mix((Math.imul(b | 0, 0x165667b1) + Math.imul(salt | 0, 0x9e3779b9)) | 0)) | 0);
}
const u01 = (h) => h / 4294967296;
const wrapGi = (gi) => ((gi % WORLD_CELLS) + WORLD_CELLS) % WORLD_CELLS;

// ---- the survey curves -----------------------------------------------------
export const decodeA = (code) => (code / 16) ** 2;
export function coverageOf(a, gen = FILL_GEN_DEFAULTS) {
  return Math.min(gen.cMax, gen.c0 * Math.pow(Math.max(a, 0), gen.p));
}
export function heightOf(a, gen = FILL_GEN_DEFAULTS) {
  const c = coverageOf(a, gen);
  return c > 0 ? a / c : 0;
}

/** Mercator scale (world units per true metre) at absolute world z. */
export const mercK = (z) => Math.cosh(z / EARTH_R);

/** Is cell (i, j) of the tile built under the noise rule? Reads survey values only. */
export function cellBuilt(codes, i, j, gen = FILL_GEN_DEFAULTS) {
  const a = decodeA(codes[(j + 1) * PAD + i + 1]);
  if (!(a >= gen.floorM)) return false;
  if (a >= gen.soloM) return true;
  let s = 0;
  for (let dj = 0; dj <= 2; dj++) {
    const row = (j + dj) * PAD + i;
    for (let di = 0; di <= 2; di++) s += decodeA(codes[row + di]);
  }
  return s >= gen.nbMinM;
}

function typeOf(a, gi, gj, gen) {
  const jit = 0.85 + 0.3 * u01(hash3(gi, gj, 11));
  const b = gen.bands;
  if (a < b[0] * jit) return 0;
  if (a < b[1] * jit) return 1;
  if (a < b[2] * jit) return 2;
  return 3;
}

/** The neighbourhood's street orientation (radians), from its global index. */
function nbYaw(ni, nj) {
  const h = hash3(ni, nj, 2);
  const r = u01(hash3(ni, nj, 3));
  return u01(h) < 0.55 ? (r - 0.5) * 0.2 : r * (Math.PI / 2);
}

// ---- output builder ----------------------------------------------------------
class Sink {
  constructor(cap) {
    this.cap = Math.max(16, cap);
    this.n = 0;
    this.x = new Float64Array(this.cap);
    this.z = new Float64Array(this.cap);
    this.u = new Float64Array(this.cap);
    this.v = new Float64Array(this.cap);
    this.h = new Float64Array(this.cap);
    this.yaw = new Float64Array(this.cap);
    this.t = new Uint8Array(this.cap);
    this.hash = new Uint32Array(this.cap);
  }
  grow() {
    const c = this.cap * 2;
    for (const k of ['x', 'z', 'u', 'v', 'h', 'yaw', 't', 'hash']) {
      const a = new this[k].constructor(c);
      a.set(this[k]);
      this[k] = a;
    }
    this.cap = c;
  }
  push(x, z, u, v, h, yaw, t, hash) {
    if (this.n === this.cap) this.grow();
    const n = this.n++;
    this.x[n] = x;
    this.z[n] = z;
    this.u[n] = u;
    this.v[n] = v;
    this.h[n] = h;
    this.yaw[n] = yaw;
    this.t[n] = t;
    this.hash[n] = hash;
  }
}

/** Shrink factor so a box (half extents u, v; yaw) centred at (x, z) stays inside [x0, x1) x [z0, z1) less margin. */
function fitScale(x, z, u, v, cs, sn, x0, x1, z0, z1, margin) {
  const wx = Math.abs(cs) * u + Math.abs(sn) * v;
  const wz = Math.abs(sn) * u + Math.abs(cs) * v;
  const dx = Math.min(x - x0, x1 - x) - margin;
  const dz = Math.min(z - z0, z1 - z) - margin;
  if (dx <= 0 || dz <= 0) return 0;
  return Math.min(1, dx / Math.max(wx, 1e-9), dz / Math.max(wz, 1e-9));
}

// Level 0: one cell's buildings, appended to the sink. Independent of every
// other cell and of the mask.
function emitCellHouses(sink, codes, i, j, gi, gj, gen) {
  const a = decodeA(codes[(j + 1) * PAD + i + 1]);
  const x0 = -WORLD / 2 + gi * CELL;
  const z0 = -WORLD / 2 + gj * CELL;
  const x1 = x0 + CELL;
  const z1 = z0 + CELL;
  const k = mercK(z0 + CELL / 2);
  const side = CELL / k; // true metres
  const area = side * side;
  const c = coverageOf(a, gen);
  const H = a / c;
  const t = typeOf(a, gi, gj, gen);
  const T = TYPES[t];
  const ni = Math.floor(gi / gen.nbCells);
  const nj = Math.floor(gj / gen.nbCells);
  const yaw = nbYaw(ni, nj);
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  // Lot lattice: the neighbourhood's orientation, laid over the largest
  // square of that orientation inside the cell (side CELL / (|cos| + |sin|)),
  // with a whole number of lots per side (pitch from coverage: lot area =
  // footprint / c, dithered by a hash). Every lot lies inside the cell, so
  // nothing is cut at the cell edge, and in a neighbourhood whose streets run
  // with the grid (55 %) the rows continue from cell to cell. At low density a
  // house moves within its lot's slack by a hash, so a rural area is not a
  // grid of points.
  const margin = gen.marginK * CELL;
  const start = sink.n;
  const cellHash = hash3(gi, gj, 7);
  const lot = T.foot / c; // true m2
  const L = CELL / (Math.abs(cs) + Math.abs(sn));
  const nU = Math.max(1, Math.min(8, Math.floor(L / (Math.sqrt(lot * T.aspect) * k) + u01(mix(cellHash ^ 21)))));
  const nV = Math.max(1, Math.min(8, Math.floor(L / (Math.sqrt(lot / T.aspect) * k) + u01(mix(cellHash ^ 22)))));
  const px = L / nU;
  const py = L / nV;
  const xc = x0 + CELL / 2;
  const zc = z0 + CELL / 2;
  for (let n = 0; n < nV; n++) {
    for (let m = 0; m < nU; m++) {
      const h = mix(cellHash ^ Math.imul(m + 1, 0x2545f491) ^ Math.imul(n + 1, 0x6b43a9b5));
      const f = T.foot * (0.7 + 0.6 * u01(mix(h ^ 1)));
      const asp = T.aspect * (0.8 + 0.4 * u01(mix(h ^ 2)));
      const hu = Math.min((Math.sqrt(f * asp) / 2) * k, 0.42 * px);
      const hv = Math.min((Math.sqrt(f / asp) / 2) * k, 0.42 * py);
      const U = (m + 0.5) * px - L / 2;
      const V = (n + 0.5) * py - L / 2;
      sink.push(xc + U * cs - V * sn, zc + U * sn + V * cs, hu, hv, H * (0.8 + 0.4 * u01(mix(h ^ 3))), yaw, t, h);
    }
  }
  // Coverage: a lattice of whole lots realises less than c, so grow every footprint by
  // one factor g (at most 1.6x a side, never past 0.46 of its lot) until the
  // cell's fitted footprint reaches c * cell area, then fit each box inside the
  // cell.
  const k2 = k * k;
  const target = c * area;
  const fitted = (g, apply) => {
    let sum = 0;
    for (let q = start; q < sink.n; q++) {
      const hu = Math.min(sink.u[q] * g, 0.46 * px);
      const hv = Math.min(sink.v[q] * g, 0.46 * py);
      // The house moves within what its lot leaves free (never into the next lot).
      const h = sink.hash[q];
      const dU = (u01(mix(h ^ 4)) - 0.5) * 0.8 * (px - 2 * hu);
      const dV = (u01(mix(h ^ 5)) - 0.5) * 0.8 * (py - 2 * hv);
      const nx = sink.x[q] + dU * cs - dV * sn;
      const nz = sink.z[q] + dU * sn + dV * cs;
      let s = fitScale(nx, nz, hu, hv, cs, sn, x0, x1, z0, z1, margin);
      if (s < 0.45) s = 0; // a sliver at the cell edge: dropped below
      sum += (4 * hu * hv * s * s) / k2;
      if (apply) {
        sink.x[q] = nx;
        sink.z[q] = nz;
        sink.u[q] = hu * s;
        sink.v[q] = hv * s;
      }
    }
    return sum;
  };
  let g = 1;
  for (let it = 0; it < 3; it++) {
    const got = fitted(g, false);
    if (!(got > 0) || got >= target * 0.98) break;
    g = Math.min(1.6, g * Math.sqrt(target / got));
  }
  fitted(g, true);
  let w = start;
  for (let q = start; q < sink.n; q++) {
    if (!(sink.u[q] > 0)) continue;
    if (w !== q) {
      sink.x[w] = sink.x[q];
      sink.z[w] = sink.z[q];
      sink.u[w] = sink.u[q];
      sink.v[w] = sink.v[q];
      sink.h[w] = sink.h[q];
      sink.yaw[w] = sink.yaw[q];
      sink.t[w] = sink.t[q];
      sink.hash[w] = sink.hash[q];
    }
    w++;
  }
  sink.n = w;
  if (sink.n === start) {
    const f = Math.min(T.foot, c * area);
    const hu = (Math.sqrt(f * T.aspect) / 2) * k;
    const hv = (Math.sqrt(f / T.aspect) / 2) * k;
    const x = x0 + CELL / 2;
    const z = z0 + CELL / 2;
    const s = fitScale(x, z, hu, hv, cs, sn, x0, x1, z0, z1, margin);
    sink.push(x, z, hu * s, hv * s, H, yaw, t, cellHash);
  }
  // Tall bodies: towers always, slabs sometimes, the lot with the largest hash.
  const count = sink.n - start;
  if (T.tall > 0 && count > 1 && (T.tall >= 1 || u01(mix(cellHash ^ 9)) < T.tall)) {
    let best = start;
    for (let q = start + 1; q < sink.n; q++) if (sink.hash[q] > sink.hash[best]) best = q;
    const r = u01(mix(cellHash ^ 10));
    sink.h[best] *= t === 3 ? 1.5 + Math.min(2.5, Math.max(0, (a - 12) / 6)) * (0.7 + 0.6 * r) : 1.4 + 0.6 * r;
    if (t === 3 && count > 4 && a > 20) {
      let second = best === start ? start + 1 : start;
      for (let q = start; q < sink.n; q++) if (q !== best && sink.hash[q] > sink.hash[second]) second = q;
      sink.h[second] *= 1.8 + 1.5 * u01(mix(cellHash ^ 12));
    }
  }
  // Scale heights so the cell's volume is the survey's.
  let vol = 0;
  for (let q = start; q < sink.n; q++) vol += ((4 * sink.u[q] * sink.v[q]) / k2) * sink.h[q];
  const scale = vol > 0 ? (a * area) / vol : 0;
  for (let q = start; q < sink.n; q++) sink.h[q] = Math.max(gen.minH, Math.min(gen.maxH, sink.h[q] * scale));
}

// Level 1: one box per built cell.
function emitCellBlock(sink, codes, i, j, gi, gj, gen) {
  const a = decodeA(codes[(j + 1) * PAD + i + 1]);
  const x0 = -WORLD / 2 + gi * CELL;
  const z0 = -WORLD / 2 + gj * CELL;
  const k = mercK(z0 + CELL / 2);
  const area = (CELL / k) ** 2;
  const c = coverageOf(a, gen);
  const t = typeOf(a, gi, gj, gen);
  const yaw = nbYaw(Math.floor(gi / gen.nbCells), Math.floor(gj / gen.nbCells));
  const h = hash3(gi, gj, 13);
  const asp = t === 0 ? 1.2 : 1 + 0.6 * u01(h);
  const f = c * area;
  const hu = (Math.sqrt(f * asp) / 2) * k;
  const hv = (Math.sqrt(f / asp) / 2) * k;
  const x = x0 + CELL / 2;
  const z = z0 + CELL / 2;
  const s = fitScale(x, z, hu, hv, Math.cos(yaw), Math.sin(yaw), x0, x0 + CELL, z0, z0 + CELL, gen.marginK * CELL);
  const u = hu * s;
  const v = hv * s;
  const ft = (4 * u * v) / (k * k);
  sink.push(x, z, u, v, Math.max(gen.minH, Math.min(gen.maxH, (a * area) / ft)), yaw, t, h);
}

// ---- encoding -------------------------------------------------------------------
const q16 = (v, s) => Math.max(0, Math.min(65535, Math.round((v / s) * 65535)));

function encode(sink, level, maxInstances, cfg, cx, cz) {
  const n0 = sink.n;
  const fk = cfg.footprintK;
  // Quantise first, so the size key is exactly what the shader computes.
  const dim = new Uint16Array(n0 * 4);
  const size = new Float64Array(n0);
  const hq = new Float64Array(n0);
  for (let q = 0; q < n0; q++) {
    const yaw = ((sink.yaw[q] % TAU) + TAU) % TAU;
    const du = q16(sink.u[q], 1000);
    const dv = q16(sink.v[q], 1000);
    const dh = q16(sink.h[q], 1000);
    dim[q * 4] = du;
    dim[q * 4 + 1] = dv;
    dim[q * 4 + 2] = dh;
    dim[q * 4 + 3] = q16(yaw, TAU);
    const U = (du / 65535) * 1000;
    const V = (dv / 65535) * 1000;
    const Hm = (dh / 65535) * 1000;
    const k = mercK(sink.z[q]);
    hq[q] = Hm;
    size[q] = Math.fround(Math.max(Hm, fk * ((2 * Math.sqrt(U * V)) / k)));
  }
  // Size-descending order, ties by emission order: one numeric sort of packed keys.
  const keys = new Float64Array(n0);
  for (let q = 0; q < n0; q++) keys[q] = -Math.floor(Math.min(size[q], 2000) * 4194304) * 1048576 + q;
  keys.sort();
  const cap = maxInstances > 0 ? Math.floor(maxInstances) : cfg.caps[level] ?? FILL_CAPS_DEFAULT[level];
  const n = Math.min(n0, cap);
  const out = {
    ax: new Float32Array(n),
    az: new Float32Array(n),
    dim: new Uint16Array(n * 4),
    wall: new Uint8Array(n * 4),
    roof: new Uint8Array(n * 4),
    gnd: new Uint8Array(n * 4),
    size: new Float32Array(n),
  };
  let maxH = 0;
  for (let o = 0; o < n; o++) {
    const q = keys[o] + Math.ceil(-keys[o] / 1048576) * 1048576;
    out.ax[o] = sink.x[q] - cx;
    out.az[o] = sink.z[q] - cz;
    out.dim.set(dim.subarray(q * 4, q * 4 + 4), o * 4);
    out.size[o] = size[q];
    if (hq[q] > maxH) maxH = hq[q];
    const T = TYPES[sink.t[q]];
    const h = sink.hash[q];
    const w = T.walls[(h >>> 4) & 3];
    const r = T.roofs[(h >>> 6) & 3];
    const jw = ((h >>> 8) & 15) - 7; // +-7 per channel, one shared shift
    const jr = ((h >>> 12) & 15) - 7;
    for (let ch = 0; ch < 3; ch++) {
      out.wall[o * 4 + ch] = Math.max(0, Math.min(255, w[ch] + jw));
      out.roof[o * 4 + ch] = Math.max(0, Math.min(255, r[ch] + jr));
      out.gnd[o * 4 + ch] = out.roof[o * 4 + ch];
    }
    out.wall[o * 4 + 3] = T.families[(h >>> 16) & 3]; // family, material 0
    out.roof[o * 4 + 3] = (h >>> 24) & 255; // seed
    out.gnd[o * 4 + 3] = 0; // no ground photo
  }
  return { n, ...out, maxH, capped: n0 - n };
}

function chunkFrame(req) {
  const level = req.level | 0;
  const tx = req.tx | 0;
  const ty = req.ty | 0;
  const qx = level === 0 ? req.qx | 0 : 0;
  const qy = level === 0 ? req.qy | 0 : 0;
  const span = level === 0 ? TILE_SPAN / 2 : TILE_SPAN;
  const cx = -WORLD / 2 + tx * TILE_SPAN + (level === 0 ? (qx + 0.5) * span : span / 2);
  const cz = -WORLD / 2 + ty * TILE_SPAN + (level === 0 ? (qy + 0.5) * span : span / 2);
  return { level, tx, ty, qx, qy, span, cx, cz };
}

/** A chunk with no instances ('empty', or 'missing' while the height tile is not available). */
export function emptyFillChunk(req = {}, status = 'empty', reason = '') {
  const f = chunkFrame(req);
  return {
    v: FILL_GEN_VERSION,
    key: `${f.level}/${f.tx}/${f.ty}/${f.qx}/${f.qy}`,
    tx: f.tx, ty: f.ty, level: f.level, qx: f.qx, qy: f.qy,
    maskEpoch: req.maskEpoch ?? 0,
    status, reason,
    cx: f.cx, cz: f.cz, span: f.span,
    n: 0,
    ax: new Float32Array(0), az: new Float32Array(0), dim: new Uint16Array(0),
    wall: new Uint8Array(0), roof: new Uint8Array(0), gnd: new Uint8Array(0), size: new Float32Array(0),
    maxH: 0, builtCells: 0, maskedCells: 0,
  };
}

/**
 * @param codes  Uint8Array(130 * 130), the padded height codes of tile (tx, ty)
 * @param req    { tx, ty, level, qx, qy, mask, maskEpoch, maxInstances }
 * @param config normaliseFillConfig(...) output, or a raw init config
 * @returns FillChunk (FLY_HORIZON_FILL.md, contract A)
 */
export function generateFillChunk(codes, req, config) {
  const cfg = config && config.gen && config.caps ? config : normaliseFillConfig(config ?? {});
  const gen = cfg.gen;
  const f = chunkFrame(req);
  if (!codes || codes.length !== PAD * PAD || f.level < 0 || f.level > 2) return emptyFillChunk(req, 'missing', 'bad input');
  if (f.ty < 0 || f.ty >= TILES) return emptyFillChunk(req, 'empty', 'out of range');
  const mask = req.mask && req.mask.length === SIZE * SIZE ? req.mask : null;
  const i0 = f.level === 0 ? f.qx * 64 : 0;
  const j0 = f.level === 0 ? f.qy * 64 : 0;
  const w = f.level === 0 ? 64 : SIZE;
  const giBase = wrapGi(f.tx * SIZE);
  const gjBase = f.ty * SIZE;
  let masked = 0;
  let built = 0;
  const sink = new Sink(f.level === 0 ? 8192 : f.level === 1 ? 4096 : 1024);
  if (f.level === 2) {
    const k2cells = new Float64Array(4);
    for (let bj = 0; bj < SIZE / 2; bj++) {
      for (let bi = 0; bi < SIZE / 2; bi++) {
        let vol = 0, ar = 0, mx = 0, mz = 0, aMax = 0;
        for (let d = 0; d < 4; d++) {
          const i = bi * 2 + (d & 1);
          const j = bj * 2 + (d >> 1);
          k2cells[d] = 0;
          if (mask && mask[j * SIZE + i]) {
            masked++;
            continue;
          }
          if (!cellBuilt(codes, i, j, gen)) continue;
          built++;
          const a = decodeA(codes[(j + 1) * PAD + i + 1]);
          const zc = -WORLD / 2 + (gjBase + j + 0.5) * CELL;
          const A = (CELL / mercK(zc)) ** 2;
          vol += a * A;
          ar += A;
          mx += (i + 0.5) * a * A;
          mz += (j + 0.5) * a * A;
          if (a > aMax) aMax = a;
        }
        if (!(vol > 0)) continue;
        const gi = giBase + bi * 2;
        const gj = gjBase + bj * 2;
        const aEff = vol / ar;
        const c = coverageOf(aEff, gen);
        const bx0 = -WORLD / 2 + gi * CELL;
        const bz0 = -WORLD / 2 + gj * CELL;
        const x = bx0 + (mx / vol - bi * 2) * CELL;
        const z = bz0 + (mz / vol - bj * 2) * CELL;
        const k = mercK(z);
        const yaw = nbYaw(Math.floor(gi / gen.nbCells), Math.floor(gj / gen.nbCells));
        const h = hash3(gi, gj, 17);
        const asp = 1 + 0.5 * u01(h);
        const fArea = c * ar;
        const hu = (Math.sqrt(fArea * asp) / 2) * k;
        const hv = (Math.sqrt(fArea / asp) / 2) * k;
        const s = fitScale(x, z, hu, hv, Math.cos(yaw), Math.sin(yaw), bx0, bx0 + 2 * CELL, bz0, bz0 + 2 * CELL, gen.marginK * CELL);
        if (!(s > 0)) continue;
        const u = hu * s;
        const v = hv * s;
        const ft = (4 * u * v) / (k * k);
        const t = typeOf(aMax, gi, gj, gen);
        sink.push(x, z, u, v, Math.max(gen.minH, Math.min(gen.maxH, vol / ft)), yaw, t, h);
      }
    }
  } else {
    for (let j = j0; j < j0 + w; j++) {
      for (let i = i0; i < i0 + w; i++) {
        if (mask && mask[j * SIZE + i]) {
          masked++;
          continue;
        }
        if (!cellBuilt(codes, i, j, gen)) continue;
        built++;
        if (f.level === 0) emitCellHouses(sink, codes, i, j, giBase + i, gjBase + j, gen);
        else emitCellBlock(sink, codes, i, j, giBase + i, gjBase + j, gen);
      }
    }
  }
  const enc = encode(sink, f.level, Number(req.maxInstances) || 0, cfg, f.cx, f.cz);
  return {
    v: FILL_GEN_VERSION,
    key: `${f.level}/${f.tx}/${f.ty}/${f.qx}/${f.qy}`,
    tx: f.tx, ty: f.ty, level: f.level, qx: f.qx, qy: f.qy,
    maskEpoch: req.maskEpoch ?? 0,
    status: enc.n > 0 ? 'ok' : 'empty',
    reason: enc.n > 0 ? (enc.capped > 0 ? `capped ${enc.capped}` : '') : built ? 'capped' : 'no built cells',
    cx: f.cx, cz: f.cz, span: f.span,
    n: enc.n,
    ax: enc.ax, az: enc.az, dim: enc.dim, wall: enc.wall, roof: enc.roof, gnd: enc.gnd, size: enc.size,
    maxH: enc.maxH,
    builtCells: built,
    maskedCells: masked,
  };
}

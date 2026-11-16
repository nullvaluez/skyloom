/**
 * WORLD PASS E (GROUND), M1 `ground.trees`: which canopy level each cell of
 * the lattice is drawn at this placement pass. Pure (no three, no React), so
 * the layer and a node probe run the same code.
 *
 * The worker hands every z14 chunk a fixed hierarchy (worker/ground-canopy.js):
 * L0 crowns, and L1 / L2 / L3 patches over 2 x 2 / 4 x 4 / 8 x 8 lattice
 * cells. A pass walks the L3 cells of every ready chunk NEAREST FIRST and
 * descends while the cell is close enough:
 *     d(L3) >= d2          -> one L3 patch            (far pool)
 *     d(L2) >= d1          -> one L2 patch            (far pool)
 *     d(L1) >= d0          -> one L1 patch            (far pool)
 *     else                 -> its L0 crowns           (near pool)
 * Each tree is therefore drawn exactly once, at one level. Because the walk
 * is nearest first, a full pool degrades by distance, never by tile order:
 * once the near pool is full a cell that would be crowns becomes its L1
 * patch, and once the far pool is full the walk stops (the farthest cells go,
 * which is where the photo carries the woods anyway).
 *
 * Distances are compared in WORLD units: every threshold is true metres times
 * the mercator k, the same law every other satellite ring uses.
 */

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @param chunks  ready chunk records with `.canopy` ({l0,l1,l2,l3}) and cx/cz
 * @param px,pz   player, absolute world
 * @param o       { k, nearCap, farCap, d0, d1, d2, d3 } (thresholds true m)
 * @param near    (chunk, i0) => void   one L0 crown (row index)
 * @param far     (chunk, level, idx, fadeK) => void   one patch
 * @param scratch optional reusable { d: Float64Array, c: Int32Array, i: Int32Array, order: Int32Array }
 * @returns { near, far, cut, d0Used, farthest }
 */
export function selectCanopy(chunks, px, pz, o, near, far, scratch = null) {
  const k = o.k;
  const D0 = o.d0 * k, D1 = o.d1 * k, D2 = o.d2 * k, D3 = o.d3 * k;
  const fadeA = D3 * 0.86;
  // 1. every L3 cell within reach, with its distance
  let n = 0;
  for (let c = 0; c < chunks.length; c++) n += chunks[c].canopy ? chunks[c].canopy.l3.length / 7 : 0;
  let s = scratch;
  if (!s || s.d.length < n) {
    s = { d: new Float64Array(Math.max(256, n * 1.25 | 0)), c: new Int32Array(Math.max(256, n * 1.25 | 0)), i: new Int32Array(Math.max(256, n * 1.25 | 0)), order: null };
    s.order = new Int32Array(s.d.length);
    if (scratch) Object.assign(scratch, s);
  }
  let m = 0;
  for (let c = 0; c < chunks.length; c++) {
    const ch = chunks[c], cv = ch.canopy;
    if (!cv) continue;
    const l3 = cv.l3;
    for (let j = 0; j < l3.length; j += 7) {
      const d = Math.hypot(ch.cx + l3[j] - px, ch.cz + l3[j + 1] - pz);
      if (d - l3[j + 2] * k >= D3) continue;
      s.d[m] = d; s.c[m] = c; s.i[m] = j / 7; s.order[m] = m; m++;
    }
  }
  const order = s.order.subarray(0, m);
  const dist = s.d;
  order.sort((a, b) => dist[a] - dist[b]);
  // 2. nearest first, descend while close
  let nNear = 0, nFar = 0, cut = 0, farthest = 0;
  const fadeOf = (d) => 1 - smooth(fadeA, D3, d);
  outer: for (let q = 0; q < m; q++) {
    const e = order[q];
    const ch = chunks[s.c[e]], cv = ch.canopy, l1 = cv.l1, l2 = cv.l2, l3 = cv.l3;
    const j3 = s.i[e] * 7;
    const d3 = dist[e];
    if (d3 >= D2) {
      if (nFar >= o.farCap) { cut = m - q; break; }
      const f = fadeOf(d3);
      if (f > 0.001) { far(ch, 3, j3 / 7, f); nFar++; farthest = d3; }
      continue;
    }
    for (let a = l3[j3 + 5], ae = a + l3[j3 + 6]; a < ae; a++) {
      const j2 = a * 7;
      const d2 = Math.hypot(ch.cx + l2[j2] - px, ch.cz + l2[j2 + 1] - pz);
      if (d2 >= D1) {
        if (nFar >= o.farCap) { cut = m - q; break outer; }
        far(ch, 2, a, fadeOf(d2)); nFar++; farthest = d2;
        continue;
      }
      for (let b = l2[j2 + 5], be = b + l2[j2 + 6]; b < be; b++) {
        const j1 = b * 7;
        const d1 = Math.hypot(ch.cx + l1[j1] - px, ch.cz + l1[j1 + 1] - pz);
        const kids = l1[j1 + 6];
        if (d1 < D0 && nNear + kids <= o.nearCap) {
          for (let r = l1[j1 + 5], re = r + kids; r < re; r++) { near(ch, r); nNear++; }
          continue;
        }
        if (nFar >= o.farCap) { cut = m - q; break outer; }
        far(ch, 1, b, 1); nFar++; farthest = d1;
      }
    }
  }
  return { near: nNear, far: nFar, cut, cells: m, farthest: farthest / k };
}

/** FableFlight species -> drawn form: 0 broadleaf, 1 conifer, 2 bush, 3 palm. */
export const SPECIES_FORM = [0, 0, 1, 1, 3, 1, 0, 0, 2, 0];
/** Deciduous species (leaf-off in winter imagery): oak, maple, birch. */
export const SPECIES_DECIDUOUS = [true, true, false, false, false, false, true, false, false, false];
/** Mean foliage albedo (linear) per species, FableFlight src/trees.rs LEAF (MIT). */
export const SPECIES_LEAF = [
  [0.075, 0.135, 0.04], [0.09, 0.165, 0.045], [0.032, 0.08, 0.048], [0.05, 0.1, 0.042], [0.085, 0.15, 0.04],
  [0.036, 0.078, 0.04], [0.13, 0.2, 0.05], [0.06, 0.14, 0.035], [0.09, 0.12, 0.05], [0.085, 0.12, 0.075],
];

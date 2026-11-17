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
 *
 * Round 2 (dense forest, motion cost):
 *   - `planCanopy` is a GENERATOR that yields whenever `deadline()` says the
 *     frame's slice is spent, and returns the plan as a flat op list (chunk,
 *     level, row, distance); the layer writes the instances from it in later
 *     slices and swaps them in one frame. selectCanopy runs it to the end.
 *   - SCREEN SIZE: `o.sigma` (0 < sigma <= 1) scales the crown and patch
 *     distances d0..d2 (not d3), so a scene that overflows the pools trades
 *     detail for coarser merged patches nearer the camera instead of losing
 *     its far woods; the layer adapts sigma from each pass's own cut.
 *   - VIEW CONE: `o.cone` ({x, z, cos, keep}) skips L3 cells outside the view
 *     direction beyond `keep` (world units), so the pools are spent where the
 *     camera looks; everything within `keep` is planned all round.
 *   - THE EDGE: the plan reports the band over which the outer edge dissolves
 *     (`edgeA`..`edgeB`, world units): the last 14 % of d3, or of the farthest
 *     planned distance when the pools ran out. The layer turns it into a
 *     dithered density, so no canopy line follows the camera.
 */

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

const KEY_M = 4194304; // 2^22: the sort key packs (quantised distance, cell)

/**
 * The canopy plan, sliced. Yields when `deadline()` is true; returns
 * { n, near, far, cut, cells, farthest, edgeA, edgeB } with the ops in
 * scratch.op {c, l, i, d} (n of them, nearest cell first).
 * @param chunks  ready chunk records with `.canopy` ({l0,l1,l2,l3}) and cx/cz
 * @param px,pz   player, absolute world
 * @param o       { k, nearCap, farCap, d0, d1, d2, d3, sigma?, cone? } (thresholds true m)
 * @param scratch reusable object (grown on demand)
 * @param deadline optional () => boolean
 */
export function* planCanopy(chunks, px, pz, o, scratch, deadline = null) {
  const k = o.k, sg = Math.min(1, Math.max(0.05, o.sigma ?? 1));
  const D0 = o.d0 * k * sg, D1 = o.d1 * k * sg, D2 = o.d2 * k * sg, D3 = o.d3 * k;
  const cone = o.cone ?? null;
  let n = 0;
  for (let c = 0; c < chunks.length; c++) n += chunks[c].canopy ? chunks[c].canopy.l3.length / 7 : 0;
  const s = scratch;
  if (!s.key || s.key.length < n) {
    s.key = new Float64Array(Math.max(256, (n * 1.25) | 0));
    s.c = new Int32Array(s.key.length); s.i = new Int32Array(s.key.length); s.dd = new Float64Array(s.key.length);
  }
  const cap = o.nearCap + o.farCap;
  if (!s.op || s.op.c.length < cap) s.op = { c: new Int32Array(cap), l: new Uint8Array(cap), i: new Int32Array(cap), d: new Float32Array(cap) };
  // 1. every L3 cell within reach (and in view beyond `keep`), with its distance
  let m = 0, seen = 0;
  for (let c = 0; c < chunks.length; c++) {
    const ch = chunks[c], cv = ch.canopy;
    if (!cv) continue;
    const l3 = cv.l3;
    for (let j = 0; j < l3.length; j += 7) {
      if ((++seen & 127) === 0 && deadline && deadline()) yield;
      const dx = ch.cx + l3[j] - px, dz = ch.cz + l3[j + 1] - pz;
      const d = Math.hypot(dx, dz), rr = l3[j + 2] * k;
      if (d - rr >= D3) continue;
      if (cone && d - rr > cone.keep && (dx * cone.x + dz * cone.z) / d < cone.cos) continue;
      s.key[m] = Math.round(d * 4) * KEY_M + m; s.c[m] = c; s.i[m] = j / 7; s.dd[m] = d; m++;
    }
    if (deadline && deadline()) yield;
  }
  const keys = s.key.subarray(0, m);
  keys.sort();
  if (deadline && deadline()) yield;
  // 2. nearest first, descend while close
  const op = s.op;
  let no = 0, nNear = 0, nFar = 0, cut = 0, farthest = 0;
  const push = (c, l, i, d) => { op.c[no] = c; op.l[no] = l; op.i[no] = i; op.d[no] = d; no++; };
  outer: for (let q = 0; q < m; q++) {
    if ((q & 7) === 7 && deadline && deadline()) yield;
    const e = keys[q] % KEY_M;
    const ci = s.c[e], ch = chunks[ci], cv = ch.canopy, l1 = cv.l1, l2 = cv.l2, l3 = cv.l3;
    const j3 = s.i[e] * 7;
    const d3 = s.dd[e];
    if (d3 >= D2) {
      if (nFar >= o.farCap) { cut = m - q; break; }
      push(ci, 3, j3 / 7, d3); nFar++; farthest = d3;
      continue;
    }
    for (let a = l3[j3 + 5], ae = a + l3[j3 + 6]; a < ae; a++) {
      const j2 = a * 7;
      const d2 = Math.hypot(ch.cx + l2[j2] - px, ch.cz + l2[j2 + 1] - pz);
      if (d2 >= D1) {
        if (nFar >= o.farCap) { cut = m - q; break outer; }
        push(ci, 2, a, d2); nFar++; farthest = d2;
        continue;
      }
      for (let b = l2[j2 + 5], be = b + l2[j2 + 6]; b < be; b++) {
        const j1 = b * 7;
        const d1 = Math.hypot(ch.cx + l1[j1] - px, ch.cz + l1[j1 + 1] - pz);
        const kids = l1[j1 + 6];
        if (d1 < D0 && nNear + kids <= o.nearCap) {
          for (let r = l1[j1 + 5], re = r + kids; r < re; r++) { push(ci, 0, r, d1); nNear++; }
          continue;
        }
        if (nFar >= o.farCap) { cut = m - q; break outer; }
        push(ci, 1, b, d1); nFar++; farthest = d1;
      }
    }
  }
  const edgeB = cut ? farthest : D3, edgeA = edgeB * 0.86;
  return { n: no, near: nNear, far: nFar, cut, cells: m, farthest: farthest / k, edgeA, edgeB, D0, D1, D2, D3 };
}

/** The edge density of an op at world distance d (1 inside, 0 beyond the band). */
export function edgeDensity(plan, d) {
  return 1 - smooth(plan.edgeA, plan.edgeB, d);
}

/**
 * The whole plan in one call (node gates, probes): near(ch, i0) for every
 * crown, far(ch, level, idx, edgeDensity) for every patch.
 * @returns { near, far, cut, cells, farthest }
 */
export function selectCanopy(chunks, px, pz, o, near, far, scratch = null) {
  const s = scratch ?? {};
  const it = planCanopy(chunks, px, pz, o, s);
  let r = it.next();
  while (!r.done) r = it.next();
  const plan = r.value, op = s.op;
  for (let q = 0; q < plan.n; q++) {
    const ch = chunks[op.c[q]];
    if (op.l[q] === 0) near(ch, op.i[q]);
    else far(ch, op.l[q], op.i[q], edgeDensity(plan, op.d[q]));
  }
  return { near: plan.near, far: plan.far, cut: plan.cut, cells: plan.cells, farthest: plan.farthest };
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

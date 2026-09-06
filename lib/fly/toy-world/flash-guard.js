/**
 * R24 B WORLD — FLASH_GUARD: the zero-area triangle filter (recon WB-1,
 * A1 / A1b).
 *
 * THE DEFECT (verbatim on this tree). `@mapbox/vector-tile` closes every
 * polygon ring with a clone of its first point (index.js:98,
 * `line.push(line[0].clone()); // closePolygon`), `clipRing`
 * (vector-tile.worker.js:318) keeps it, and every wall extruder walks the
 * ring as if it were OPEN:
 *
 *     for (let e = 0, j = ring.length - 1; e < ring.length; j = e++)
 *
 * so the wrap-around edge (ring[n-1] === ring[0]) emits a wall quad whose
 * four vertices collapse onto two positions — two exactly-degenerate
 * triangles per ring AND per hole. The materials are `side: DoubleSide`, so
 * winding never culls them, and the world-bend vertex shader adds a
 * per-vertex float32 drop (`wPos.y -= bendD*bendD*uBendK`) that perturbs the
 * projected coordinates. The archived R22.1 measurement bisected a pale
 * frame's draw range down to ONE such triangle (`[61410, 61413) — pr 0.731`,
 * three collinear vertices) and censused 6.36–8.64% zero-area triangles in
 * every large chunk (34,405 of 482,740). See scripts/r24-b-world.md §1.
 *
 * THE FIX. An area filter over the index buffer at drape finalize, on the
 * DRAPED positions (the drape only adds a per-anchor Y; world XZ is fixed by
 * the worker, so degeneracy is fully decidable here). `minArea2: 0` =
 * exactly-degenerate only: the archived census found the 0 < area² < 1e-6
 * bucket EMPTY everywhere, so 0 removes the entire measured population
 * without ever touching a real triangle.
 *
 * PROVABLY SHADING-NEUTRAL: a degenerate triangle's face normal is (0,0,0),
 * so it contributed nothing to `computeVertexNormals` — which is why the
 * filter must run BEFORE it, not after.
 *
 * COST: memory-bound, ~0.26 ms median / 0.96 ms max on the largest measured
 * chunk (44k tris) with the wall extruder's 4-consecutive-verts-per-quad
 * layout. Random-index layouts measured 2.75 ms p95 — do not reorder indices
 * upstream of this. Clean chunks allocate NOTHING (the same array comes back
 * by reference).
 */

import { FLASH_GUARD } from '../fly-constants';

/**
 * The runtime pin. `window.__flyFlashPin = 'off'` disables the filter for the
 * rest of the session WITHOUT a reload, so a harness can measure the RED leg
 * (degenerate census > 0, pale frames present) and the GREEN leg in the same
 * page. Sanctioned `__flyWeatherOverride` idiom; node-safe.
 */
export function flashGuardOn() {
  if (!FLASH_GUARD.enabled) return false;
  if (typeof window !== 'undefined' && window.__flyFlashPin === 'off') return false;
  return true;
}

/**
 * Drop every triangle whose |(b−a)×(c−a)|² <= minArea2², compacting the index
 * buffer IN PLACE with a write cursor.
 *
 * @param {Uint16Array|Uint32Array|number[]} idx  triangle index list
 * @param {Float32Array} pos  DRAPED positions, 3 floats per vertex
 * @param {number} [minArea2] parallelogram-area threshold (0 = exact only)
 * @returns {{ idx: any, dropped: number }} `idx` is the SAME object when
 *   nothing was dropped (zero allocation on clean chunks).
 */
export function filterDegenerateTris(idx, pos, minArea2 = FLASH_GUARD.minArea2) {
  if (!idx || !pos) return { idx, dropped: 0 };
  const n = idx.length - (idx.length % 3);
  const lim = minArea2 * minArea2;
  let w = 0;
  let dropped = 0;
  for (let i = 0; i < n; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const abx = pos[b] - pos[a];
    const aby = pos[b + 1] - pos[a + 1];
    const abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a];
    const acy = pos[c + 1] - pos[a + 1];
    const acz = pos[c + 2] - pos[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz <= lim) {
      dropped += 1;
      continue;
    }
    if (w !== i) {
      idx[w] = idx[i];
      idx[w + 1] = idx[i + 1];
      idx[w + 2] = idx[i + 2];
    }
    w += 3;
  }
  if (dropped === 0) return { idx, dropped: 0 };
  // subarray keeps the transferred ArrayBuffer (no copy); a plain JS array
  // (the toy land path) falls back to slice.
  const out = typeof idx.subarray === 'function' ? idx.subarray(0, w) : idx.slice(0, w);
  return { idx: out, dropped };
}

/**
 * Flag-gated wrapper for the finalize call sites: one line each, and a
 * byte-identical no-op when the flag (or the runtime pin) is off.
 */
export function guardIndex(idx, pos) {
  if (!flashGuardOn()) return { idx, dropped: 0 };
  return filterDegenerateTris(idx, pos, FLASH_GUARD.minArea2);
}

/**
 * E CERT's instrument. Census the degenerate population that is actually
 * RESIDENT on the GPU right now — over draped positions, i.e. exactly what
 * the rasterizer sees. Returns 0 degenerate when the guard is on, and the
 * R22.1-class 6–9% when it is off (that difference IS the RED/GREEN proof).
 *
 * @param {Iterable<{geometry?: any}>} meshes
 */
export function censusDegenerate(meshes) {
  let meshCount = 0;
  let tris = 0;
  let degenerate = 0;
  let coincident = 0; // two or more vertices at the identical position
  for (const mesh of meshes) {
    const geo = mesh?.geometry;
    if (!geo) continue;
    const idxAttr = typeof geo.getIndex === 'function' ? geo.getIndex() : geo.index;
    const posAttr = geo.getAttribute?.('position');
    if (!idxAttr || !posAttr) continue;
    meshCount += 1;
    const idx = idxAttr.array ?? idxAttr;
    const pos = posAttr.array ?? posAttr;
    const n = idx.length - (idx.length % 3);
    for (let i = 0; i < n; i += 3) {
      const a = idx[i] * 3;
      const b = idx[i + 1] * 3;
      const c = idx[i + 2] * 3;
      tris += 1;
      const abx = pos[b] - pos[a];
      const aby = pos[b + 1] - pos[a + 1];
      const abz = pos[b + 2] - pos[a + 2];
      const acx = pos[c] - pos[a];
      const acy = pos[c + 1] - pos[a + 1];
      const acz = pos[c + 2] - pos[a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      if (nx * nx + ny * ny + nz * nz === 0) {
        degenerate += 1;
        const bcx = pos[c] - pos[b];
        const bcy = pos[c + 1] - pos[b + 1];
        const bcz = pos[c + 2] - pos[b + 2];
        if (
          (abx === 0 && aby === 0 && abz === 0) ||
          (acx === 0 && acy === 0 && acz === 0) ||
          (bcx === 0 && bcy === 0 && bcz === 0)
        )
          coincident += 1;
      }
    }
  }
  return {
    meshes: meshCount,
    tris,
    degenerate,
    coincident,
    collinear: degenerate - coincident,
    frac: tris ? degenerate / tris : 0,
  };
}

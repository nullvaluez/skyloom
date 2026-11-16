/**
 * World Pass W0 (worker split): pure geometry helpers shared by the Neon/toy
 * path in vector-tile.worker.js and the satellite builders in this folder.
 * Moved here VERBATIM from the worker (c2bf5c06); bodies, comments and
 * arithmetic are unchanged. Everything here is frozen shared ground: the toy
 * bundles (verify-neon-cover's frozen hashes) run through pushGable /
 * pushParapet / pushHvacBoxes / simplifyRing / clipRing as much as the
 * satellite path does. A stream that wants a different satellite form adds a
 * NEW function in its own module; it never edits one of these.
 */
import { MONUMENT_EXCLUSIONS } from '../../monument-models';
import { MONUMENT_MODELS, RING_DEDUPE } from '../../fly-constants';

// --- geometry helpers ------------------------------------------------------

function signedArea(ring) {
  let sum = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    sum += (ring[i].x - ring[j].x) * (ring[i].y + ring[j].y);
  }
  return sum; // >0 = exterior in MVT's y-down winding
}

/** MVT rings → array of polygons [{outer, holes}] by winding. */
function classifyRings(rings) {
  const polys = [];
  let current = null;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    if (signedArea(ring) > 0) {
      current = { outer: ring, holes: [] };
      polys.push(current);
    } else if (current) {
      current.holes.push(ring);
    }
  }
  return polys;
}

/**
 * ROUND 18 (A1) — THE COVERAGE FIX. Winding-AGNOSTIC ring classification, for
 * the SATELLITE paths only.
 *
 * `classifyRings` above hard-codes "signedArea > 0 = exterior". Measured
 * against the live OpenFreeMap planet tiles, that sign is simply WRONG for
 * this tileset — every polygon layer winds the other way:
 *
 *   tile 14/4824/6157 (Manhattan)   features whose FIRST clipped ring is > 0
 *     building        1481 features  ->    0
 *     landcover        512           ->    0
 *     landuse           59           ->    0
 *     water             16           ->    0
 *   tile 14/4203/6089 (Chicago Loop) — identical story, 0 across the board.
 *
 * A feature whose first ring fails the test starts no polygon, so
 * classifyRings returns [] and the caller `continue`s. The ONLY survivors are
 * features that contain a HOLE (courtyard), because a hole winds the other way
 * and gets promoted to `outer` — meaning those few also render their COURTYARD
 * instead of their footprint. End result on the satellite path: 1481 Manhattan
 * footprints became 18, and the densest city on earth rendered as ~100 lonely
 * boxes scattered over flat imagery. That is the true root of the R17 verdict
 * ("buildings have no variety, we are still missing ROOFS") — there were
 * barely any buildings to put roofs on.
 *
 * The fix takes the sign of the feature's FIRST ring as "exterior" rather than
 * assuming one. MVT 2.1 guarantees that within a feature every exterior ring
 * shares a winding and every interior ring has the opposite, so this is correct
 * under EITHER convention and cannot regress a tileset that winds the other
 * way. Downstream is winding-free by construction: earcut ignores it,
 * pointInPoly is even-odd, the emitted triangles ride a DoubleSide material
 * with computeVertexNormals + gl_FrontFacing, and the roof helpers compare
 * signed-area SIGNS rather than assuming one.
 *
 * WHY A NEW FUNCTION instead of fixing classifyRings: it is shared with the
 * TOY pipeline (polygonPass, the toy building block, the toy scatter), which is
 * frozen this round — toy output must stay byte-identical. Neon carries the
 * SAME defect at those three call sites and needs its own round to fix and
 * re-certify; see the round record.
 */
function classifyRingsSat(rings) {
  const polys = [];
  let extSign = 0;
  let current = null;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const a = signedArea(ring);
    if (a === 0) continue;
    const s = a > 0 ? 1 : -1;
    if (extSign === 0) extSign = s; // first real ring defines "exterior"
    if (s === extSign) {
      current = { outer: ring, holes: [] };
      polys.push(current);
    } else if (current) {
      current.holes.push(ring);
    }
  }
  return polys;
}

/**
 * Sutherland–Hodgman clip of one ring against the axis-aligned square
 * [0,extent]² — kills the MVT buffer overlap that would z-fight at seams.
 */
function clipRing(ring, extent) {
  let pts = ring;
  // Each edge: [inside(p), intersect(a,b)]
  const edges = [
    [(p) => p.x >= 0, (a, b) => lerpAt(a, b, (0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= extent, (a, b) => lerpAt(a, b, (extent - a.x) / (b.x - a.x))],
    [(p) => p.y >= 0, (a, b) => lerpAt(a, b, (0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= extent, (a, b) => lerpAt(a, b, (extent - a.y) / (b.y - a.y))],
  ];
  for (const [inside, intersect] of edges) {
    if (pts.length === 0) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    pts = out;
  }
  // R24 B (RING_DEDUPE): the ONE place every polygon ring passes through, so
  // the closing clone dies once for the toy AND satellite pipelines together.
  return dedupeRing(pts);
}

function lerpAt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * R24 B (RING_DEDUPE, recon WB-1 / A1 / A1b) — THE DEFECT AT ITS SOURCE.
 *
 * `@mapbox/vector-tile` closes every polygon ring with a clone of its first
 * point (index.js:98, `line.push(line[0].clone()); // closePolygon`), and
 * clipRing above keeps an inside closing point verbatim. Every wall extruder
 * then walks the ring as if it were OPEN
 * (`for (let e = 0, j = ring.length - 1; e < ring.length; j = e++)`), so the
 * wrap-around edge is zero-length and emits two exactly-degenerate triangles
 * per ring AND per hole — plus 6 more per parapet and 2 per crown step, which
 * is why the measured population is ~7.4 degenerate triangles per ring, not 2
 * (scripts/r24-b-worker-proof.js gate 6, on E's own fixture tile).
 *
 * FLASH_GUARD removes them on the main thread at finalize, which is the
 * CORRECTNESS fix and moves no bundle bytes. This is the SOURCE fix: it also
 * stops them being built, transferred and draped, so the buffers shrink.
 *
 * IT ALSO FIXES A1b's SKYLINE DEFECT FOR FREE. `simplifyRing` walks the ring
 * cyclically and drops any point whose two edges are collinear; for the
 * closing clone `bc` is (0,0) and for ring[0] `ab` is (0,0), so BOTH are
 * discarded and every z14 block-mass ring silently loses its genuine first
 * corner. With the clone gone, ring[0]'s previous neighbour is a real corner
 * and it survives on its own merits — no change to simplifyRing itself.
 *
 * Returns the SAME array when nothing was dropped, so a flag-off session and
 * a flag-on session over already-clean rings are identical.
 */
function dedupeRing(pts) {
  if (!RING_DEDUPE.enabled) return pts;
  const n = pts.length;
  if (n < 2) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = out.length ? out[out.length - 1] : null;
    if (q && q.x === p.x && q.y === p.y) continue; // consecutive duplicate
    out.push(p);
  }
  // …and the wrap-around duplicate (the closePolygon clone).
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
    else break;
  }
  return out.length === n ? pts : out;
}

/** Even-odd point-in-polygon over {outer, holes} rings. */
function pointInPoly(poly, x, y) {
  let inside = false;
  const test = (ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  };
  test(poly.outer);
  for (const h of poly.holes) test(h);
  return inside;
}

/** Deterministic PRNG (chunk-seeded scatter must be stable across rebuilds). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Liang–Barsky segment clip to [0,extent]²; returns [a,b] or null. */
function clipSegment(a, b, extent) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - 0, extent - a.x, a.y - 0, extent - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [lerpAt(a, b, t0), lerpAt(a, b, t1)];
}

// --- P2 roof-detail helpers (worker-baked geometry, zero extra draws) -------
// All operate in the building layer's TILE coordinates; the per-building
// `pushV` closure drapes them to world-local (toLocal) and bakes
// color/anchor/facade/edge. Roof + detail verts carry aFacade.x = -1 (plain:
// no window grid, no glow) EXCEPT emissive crowns / spire tips which carry
// aFacade.x = -2 and aFacade.y = emit-boost (the facade-grid fragment
// multiplies diffuse by it). aEdge is (0,0) on every roof/detail vert.
// Horizontal sizes are given in world (mercator) meters → tile units via the
// caller's mToTile = 1 / scale, matching the drawn footprint's own frame;
// heights are meters directly (the vertical axis is unstretched, like item.h).

function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/**
 * Drop near-collinear / duplicate vertices so a boxy footprint that OSM stored
 * with extra points on straight edges collapses to its true corner count — a
 * gable ridge only makes sense on a real 4-corner ring. epsTile = max
 * perpendicular deviation (tile units) still treated as collinear.
 */
function simplifyRing(ring, epsTile) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = Math.abs(abx * bcy - aby * bcx);
    const scaleE = Math.hypot(abx, aby) + Math.hypot(bcx, bcy);
    if (scaleE < 1e-6 || cross / scaleE > epsTile) out.push(b);
  }
  return out;
}

/** Pitched gable roof: ridge along the long axis of a 4-corner ring. */
function pushGable(building, pushV, quad, roofY, riseM, col) {
  const [p0, p1, p2, p3] = quad;
  const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  // ridge runs parallel to the longer edge pair, over the short-edge midpoints
  const longFirst = len(p0, p1) + len(p2, p3) >= len(p1, p2) + len(p3, p0);
  const e0 = longFirst ? p0 : p1;
  const e1 = longFirst ? p1 : p2;
  const e2 = longFirst ? p2 : p3;
  const e3 = longFirst ? p3 : p0;
  const A = { x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2 }; // ridge end near e1
  const B = { x: (e3.x + e0.x) / 2, y: (e3.y + e0.y) / 2 }; // ridge end near e0
  const ridgeY = roofY + riseM;
  // plane 1 (eave e0-e1 → ridge B-A)
  {
    const a0 = pushV(e0.x, e0.y, roofY, col);
    const a1 = pushV(e1.x, e1.y, roofY, col);
    const rA = pushV(A.x, A.y, ridgeY, col);
    const rB = pushV(B.x, B.y, ridgeY, col);
    building.idx.push(a0, a1, rA, a0, rA, rB); // DoubleSide — winding is free
  }
  // plane 2 (eave e2-e3 → ridge A-B)
  {
    const a2 = pushV(e2.x, e2.y, roofY, col);
    const a3 = pushV(e3.x, e3.y, roofY, col);
    const rA = pushV(A.x, A.y, ridgeY, col);
    const rB = pushV(B.x, B.y, ridgeY, col);
    building.idx.push(a2, a3, rB, a2, rB, rA);
  }
  // gable-end pediments on the two short edges
  {
    const s0 = pushV(e1.x, e1.y, roofY, col);
    const s1 = pushV(e2.x, e2.y, roofY, col);
    const sA = pushV(A.x, A.y, ridgeY, col);
    building.idx.push(s0, s1, sA);
    const t0 = pushV(e3.x, e3.y, roofY, col);
    const t1 = pushV(e0.x, e0.y, roofY, col);
    const tB = pushV(B.x, B.y, ridgeY, col);
    building.idx.push(t0, t1, tB);
  }
}

/** Geometric parapet: raised outer lip + top rim + inner wall around the roof. */
function pushParapet(building, pushV, ring, roofY, heightM, insetFrac, col) {
  const c = ringCentroid(ring);
  const capY = roofY + heightM;
  const n = ring.length;
  const inset = ring.map((p) => ({
    x: c.x + (p.x - c.x) * (1 - insetFrac),
    y: c.y + (p.y - c.y) * (1 - insetFrac),
  }));
  for (let e = 0, j = n - 1; e < n; j = e++) {
    const a = ring[j];
    const b = ring[e];
    const ia = inset[j];
    const ib = inset[e];
    // outer wall band roofY→capY
    const o0 = pushV(a.x, a.y, roofY, col);
    const o1 = pushV(b.x, b.y, roofY, col);
    const o2 = pushV(b.x, b.y, capY, col);
    const o3 = pushV(a.x, a.y, capY, col);
    building.idx.push(o0, o2, o1, o0, o3, o2);
    // top rim at capY: outer → inset
    const r0 = pushV(a.x, a.y, capY, col);
    const r1 = pushV(b.x, b.y, capY, col);
    const r2 = pushV(ib.x, ib.y, capY, col);
    const r3 = pushV(ia.x, ia.y, capY, col);
    building.idx.push(r0, r1, r2, r0, r2, r3);
    // inner wall band capY→roofY on the inset ring
    const w0 = pushV(ia.x, ia.y, capY, col);
    const w1 = pushV(ib.x, ib.y, capY, col);
    const w2 = pushV(ib.x, ib.y, roofY, col);
    const w3 = pushV(ia.x, ia.y, roofY, col);
    building.idx.push(w0, w2, w1, w0, w3, w2);
  }
}

/** One axis-aligned box on the roof, 5 faces (bottom skipped). */
function pushAABBox(building, pushV, cx, cy, half, y0, y1, col) {
  const x0 = cx - half;
  const x1 = cx + half;
  const yy0 = cy - half;
  const yy1 = cy + half;
  const t0 = pushV(x0, yy0, y1, col);
  const t1 = pushV(x1, yy0, y1, col);
  const t2 = pushV(x1, yy1, y1, col);
  const t3 = pushV(x0, yy1, y1, col);
  building.idx.push(t0, t1, t2, t0, t2, t3); // top cap
  const corners = [
    [x0, yy0],
    [x1, yy0],
    [x1, yy1],
    [x0, yy1],
  ];
  for (let s = 0; s < 4; s++) {
    const a = corners[s];
    const b = corners[(s + 1) % 4];
    const s0 = pushV(a[0], a[1], y0, col);
    const s1 = pushV(b[0], b[1], y0, col);
    const s2 = pushV(b[0], b[1], y1, col);
    const s3 = pushV(a[0], a[1], y1, col);
    building.idx.push(s0, s2, s1, s0, s3, s2);
  }
}

/** 1..maxBoxes HVAC boxes rejection-sampled inside the footprint. */
function pushHvacBoxes(building, pushV, poly, roofY, cfg, mToTile, rand, col) {
  const ring = poly.outer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const nBoxes = 1 + ((rand() * cfg.maxBoxes) | 0);
  let placed = 0;
  for (let tries = nBoxes * 6; tries > 0 && placed < nBoxes; tries--) {
    const sx = minX + rand() * (maxX - minX);
    const sy = minY + rand() * (maxY - minY);
    if (!pointInPoly(poly, sx, sy)) continue;
    const sizeM = cfg.sizeM[0] + rand() * (cfg.sizeM[1] - cfg.sizeM[0]);
    const hM = cfg.hM[0] + rand() * (cfg.hM[1] - cfg.hM[0]);
    const half = (sizeM * mToTile) / 2;
    // keep the whole box on the roof (both diagonal corners inside)
    if (!pointInPoly(poly, sx - half, sy - half) || !pointInPoly(poly, sx + half, sy + half)) continue;
    pushAABBox(building, pushV, sx, sy, half, roofY, roofY + hM, col);
    placed += 1;
  }
  return placed;
}

// --- ROUND 20 (C2 ICONS) — MARQUEE MONUMENT FOOTPRINT EXCLUSION -------------
// A marquee monument is drawn TWICE without this. R20's C wave overlays a real
// model on ~10 landmark POIs and parks the PROCEDURAL archetype underneath it —
// but the streamed OpenFreeMap `building` polygon of the same real structure is
// a third actor nobody had parked, and it is the one wearing the satellite
// night-window atlas. Evidence: the Taj Mahal rendered as a blue-tinted block
// standing through the marble model; the Eiffel Tower grew a blocky cluster at
// its base.
//
// So: a static disc per monument (lib/fly/monument-models.js MONUMENT_EXCLUSIONS
// — that file carries the why, the cache-determinism argument and the per-model
// radii) inside which a building footprint is not admitted. Applied in all THREE
// building admission paths (satellite detail, satellite far-mass skyline, toy
// full/mid ring) on the POLYGON CENTROID, which is exact now that R20's A wave
// explodes multipolygons per polygon: before the explosion a "feature" could be
// a whole subdivision and its centroid meant nothing.
//
// MONUMENT_MODELS.enabled false ⇒ marqueeExclusionTile returns null before it
// touches anything ⇒ every bundle is byte-identical to the pre-C tree.
//
// The disc is in TRUE metres; tile geometry is in MERCATOR, which stretches by
// k = 1/cos(lat). Hence the × k. Everything is then converted once per tile into
// TILE UNITS so the per-footprint test is a bare squared distance.

/** This tile's active exclusion discs in tile units, or null if there are none. */
function marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k) {
  if (!MONUMENT_MODELS.enabled || MONUMENT_EXCLUSIONS.length === 0) return null;
  // Absolute world Z of the tile's py=0 and py=extent edges (see toLocal).
  const zTop = -mercYTop;
  const zBot = tileSpan - mercYTop;
  let out = null;
  for (let i = 0; i < MONUMENT_EXCLUSIONS.length; i++) {
    const m = MONUMENT_EXCLUSIONS[i];
    const rM = m.radiusM * k; // true metres → mercator metres at this latitude
    if (m.wx < mercX0 - rM || m.wx > mercX0 + tileSpan + rM) continue;
    if (m.wz < zTop - rM || m.wz > zBot + rM) continue;
    const r = rM / scale; // → tile units
    if (!out) out = [];
    out.push({ px: (m.wx - mercX0) / scale, py: (m.wz + mercYTop) / scale, r2: r * r });
  }
  return out;
}

/** Does this ring's centroid fall inside any of the tile's exclusion discs? */
function inMarqueeExclusion(ring, ex) {
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  const cxT = sx / ring.length;
  const cyT = sy / ring.length;
  for (let i = 0; i < ex.length; i++) {
    const dx = cxT - ex[i].px;
    const dy = cyT - ex[i].py;
    if (dx * dx + dy * dy < ex[i].r2) return true;
  }
  return false;
}

/**
 * Compact `items` in place, dropping every footprint the discs claim. Returns
 * the drop count. Tests polys[0] — under A's per-polygon explosion that IS the
 * building; on the legacy path it is the same ring the drape anchor uses, so the
 * test and the placement can never disagree about where a feature "is".
 */
function dropMarqueeFootprints(items, ex) {
  let w = 0;
  for (let i = 0; i < items.length; i++) {
    if (inMarqueeExclusion(items[i].polys[0].outer, ex)) continue;
    items[w++] = items[i];
  }
  const dropped = items.length - w;
  items.length = w;
  return dropped;
}

export { signedArea, classifyRings, classifyRingsSat, clipRing, lerpAt, dedupeRing, pointInPoly, mulberry32, clipSegment, ringCentroid, simplifyRing, pushGable, pushParapet, pushAABBox, pushHvacBoxes, marqueeExclusionTile, inMarqueeExclusion, dropMarqueeFootprints };

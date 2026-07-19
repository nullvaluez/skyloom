/**
 * Toy World vector-tile worker (FLY_TOYWORLD_REWORK §4.2): fetch an
 * OpenFreeMap pbf → parse (OpenMapTiles schema) → clip to the tile square →
 * tessellate (earcut polygons, ribbon-extruded lines) → ONE transferable
 * bundle per tile: position/color/index arrays per material group, colors
 * baked as vertex colors from toy-palette. Zero main-thread parsing.
 *
 * Coordinates: positions are LOCAL to the tile center in the terrain
 * engine's Web-Mercator world frame (worldX = R·lon·rad, worldZ = -mercY),
 * y = per-feature lift only — the main thread adds draped ground height.
 *
 * Keyless source (hard constraint): the tile URL template is resolved at
 * init() from the public TileJSON (the path is dataset-versioned).
 */

import { expose, transfer as comlinkTransfer } from 'comlink';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import earcut from 'earcut';
import { PALETTE, hexToRGB, pickByHash } from './toy-palette';
import { BEACONS, ROOFS, RUNWAY_LIGHTS, SAT_BUILDINGS, TOY_WORLD } from '../fly-constants';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;

// Result protocol version (round 8): every buildTile result carries `v` so a
// stale HMR worker paired with new engine code is detected — the engine
// dev-warns once and still renders via its per-attribute DARK fallbacks
// (round-7 lesson 7 + missing-attribute-reads-0 trap). Bump on any change to
// the transferable buffer LAYOUT (new/removed attribute arrays) OR to the
// accepted `detail` vocabulary.
//   round 12 → 9: 'ultra' detail (a stale worker would silently run a z10 tile
//     through the FULL filters).
//   round 13 → 10: 'sat-buildings' detail (Phase 3) — a lean buildings-only
//     path returning out.satBuilding (a NEW output key). A stale protocol-9
//     worker asked for 'sat-buildings' has no such branch: wantBuildings is
//     false for it (not 'full'/'mid'), so it returns a land/road tile with NO
//     out.satBuilding — the SatBuildingEngine reads out.satBuilding, gets
//     undefined, renders nothing (SAFE: no buildings, not a crash) and the
//     v-mismatch fires the engine's dev warn-once. Fails loud + safe.
const WORKER_PROTOCOL = 10;

// --- material groups ------------------------------------------------------
// land = everything opaque/static merged into one draw; water separate so a
// foam/animation shader can own it later without re-tessellating.
const GROUPS = ['land', 'water'];

// Per-feature-kind stacking lift (m) ABOVE the chunk's own toy ground plane
// (which rides at TOY_WORLD.groundLift over the tile mesh, sampled from the
// SAME bilinear grid — so these small offsets can never z-fight the ground).
const LIFT = {
  landuse: 2.85,
  landcover: 3.15,
  park: 3.45,
  water: 3.8,
  waterway: 3.9,
  aeroway: 4.3,
  road: 4.7,
};

// True-meter road ribbon widths by transportation class (× mercator k)
const ROAD_WIDTH = {
  motorway: 18,
  trunk: 20,
  primary: 16,
  secondary: 12,
  tertiary: 10,
  minor: 8,
  service: 5,
  track: 4,
  path: 3,
  raceway: 8,
};

const ROAD_COLOR = {
  motorway: PALETTE.roadMotorway,
  trunk: PALETTE.roadMajor,
  primary: PALETTE.roadMajor,
  secondary: PALETTE.roadMid,
  tertiary: PALETTE.roadMid,
};

// Arteries that carry the traffic-pulse dash (FLY_ATLAS_REWORK §4.3a) —
// minor classes stay quiet on purpose (quiet grid, loud arteries).
const PULSE_CLASSES = new Set(['motorway', 'trunk', 'primary']);

const LANDCOVER_COLOR = {
  wood: PALETTE.wood,
  grass: PALETTE.grass,
  sand: PALETTE.sand,
  wetland: PALETTE.grass,
  farmland: PALETTE.park,
  ice: PALETTE.propWhite,
  rock: PALETTE.sand,
};

const LANDUSE_COLOR = {
  residential: PALETTE.groundResidential,
  suburb: PALETTE.groundResidential,
  neighbourhood: PALETTE.groundResidential,
  industrial: PALETTE.groundIndustrial,
  commercial: PALETTE.groundIndustrial,
  retail: PALETTE.groundIndustrial,
  cemetery: PALETTE.park,
  pitch: PALETTE.park,
  playground: PALETTE.park,
  stadium: PALETTE.park,
};

let tileTemplate = null;

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
  return pts;
}

function lerpAt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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

// --- growable group buffers -------------------------------------------------

function makeGroup() {
  // foam: per-vertex arc-length, -1 sentinel on everything else. The water
  // material's foam-dash shader scrolls on it (packed as aFoam); the land
  // group reuses the SAME array for road-pulse arcs (packed as aArc) —
  // structurally identical, one growable array per group.
  // glow (round 7): runway-light arc position 0..1 on the baked light
  // quads, -1 sentinel everywhere else (packed as aGlow on LAND only).
  return { pos: [], col: [], idx: [], foam: [], glow: [], vtx: 0 };
}

function pushPolygon(group, polys, toLocal, color, y) {
  const [r, g, b] = color;
  for (const poly of polys) {
    const flat = [];
    const holeIdx = [];
    for (const p of poly.outer) flat.push(p.x, p.y);
    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      holeIdx.push(flat.length / 2);
      for (const p of hole) flat.push(p.x, p.y);
    }
    if (flat.length < 6) continue;
    const tris = earcut(flat, holeIdx.length ? holeIdx : null);
    if (tris.length === 0) continue;
    const base = group.vtx;
    for (let i = 0; i < flat.length; i += 2) {
      const [lx, lz] = toLocal(flat[i], flat[i + 1]);
      group.pos.push(lx, y, lz);
      group.col.push(r, g, b);
      group.foam.push(-1);
      group.glow.push(-1);
    }
    group.vtx += flat.length / 2;
    // MVT exteriors wind CW in y-down tile coords; earcut preserves input
    // winding, which lands face-DOWN in the XZ world — swap to face up.
    for (let i = 0; i < tris.length; i += 3) {
      group.idx.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
  }
}

/**
 * Ribbon-extrude a clipped polyline: one quad per segment (toy look).
 * arcDir: 0 = write the -1 sentinel (no animation); 1 = accumulated arc
 * length (m, per chain); -1 = reversed arc (total-arc), which flips the
 * scroll direction of the dash shader while every value stays >= 0 (the
 * sentinel must remain unambiguous).
 */
function pushRibbon(group, pts, toLocal, halfW, color, y, arcDir = 0, glowVal = -1) {
  const [r, g, b] = color;
  let arc = 0;
  let total = 0;
  if (arcDir < 0) {
    let px = null;
    let pz = null;
    for (let i = 0; i < pts.length; i++) {
      const [lx, lz] = toLocal(pts[i].x, pts[i].y);
      if (px !== null) total += Math.hypot(lx - px, lz - pz);
      px = lx;
      pz = lz;
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = toLocal(pts[i].x, pts[i].y);
    const [bx, bz] = toLocal(pts[i + 1].x, pts[i + 1].y);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    const base = group.vtx;
    group.pos.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    for (let c = 0; c < 4; c++) group.col.push(r, g, b);
    if (arcDir !== 0) {
      const a0 = arcDir > 0 ? arc : total - arc;
      const a1 = arcDir > 0 ? arc + len : total - arc - len;
      group.foam.push(a0, a0, a1, a1);
      arc += len;
    } else {
      group.foam.push(-1, -1, -1, -1);
    }
    group.glow.push(glowVal, glowVal, glowVal, glowVal);
    group.vtx += 4;
    group.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

/**
 * Round 7: runway edge lights — walk a clipped runway centerline placing a
 * pair of small bright quads every spacing, plus threshold crossbars at
 * both ends. Everything lands in the LAND group (zero extra draws) with
 * aGlow = normalized arc position (the shader's optional "rabbit" chase).
 */
function pushRunwayLights(group, chain, toLocal, k, halfWWorld, color, y) {
  // local-space polyline + cumulative arc
  const pts = [];
  let total = 0;
  for (let i = 0; i < chain.length; i++) {
    const [lx, lz] = toLocal(chain[i].x, chain[i].y);
    if (i > 0) total += Math.hypot(lx - pts[i - 1][0], lz - pts[i - 1][1]);
    pts.push([lx, lz, total]);
  }
  if (total < 40 * k) return; // stub fragments from clipping
  const spacing = RUNWAY_LIGHTS.spacingM * k;
  const off = halfWWorld + RUNWAY_LIGHTS.offsetM * k;
  const s = RUNWAY_LIGHTS.sizeM * k;
  const at = (d) => {
    // point + unit direction at arc distance d
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][2] >= d || i === pts.length - 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const seg = Math.max(b[2] - a[2], 1e-6);
        const t = Math.min(Math.max((d - a[2]) / seg, 0), 1);
        const dx = (b[0] - a[0]) / seg;
        const dz = (b[1] - a[1]) / seg;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, dx, dz];
      }
    }
    return null;
  };
  const idLocal = (x, z) => [x, z]; // pts are already local
  for (let d = spacing / 2; d < total; d += spacing) {
    const p = at(d);
    if (!p) break;
    const [px, pz, dx, dz] = p;
    const nx = -dz;
    const nz = dx;
    const g = d / total;
    // one tiny along-track ribbon per side (pushRibbon = 1 quad for 2 pts)
    for (const side of [1, -1]) {
      const cxp = px + nx * off * side;
      const czp = pz + nz * off * side;
      pushRibbon(
        group,
        [
          { x: cxp - dx * s, y: czp - dz * s },
          { x: cxp + dx * s, y: czp + dz * s },
        ],
        idLocal,
        s,
        color,
        y,
        0,
        g
      );
    }
  }
  // threshold crossbars spanning the runway width at both ends
  for (const [d, g] of [
    [Math.min(6 * k, total * 0.05), 0],
    [total - Math.min(6 * k, total * 0.05), 1],
  ]) {
    const p = at(d);
    if (!p) continue;
    const [px, pz, dx, dz] = p;
    const nx = -dz;
    const nz = dx;
    pushRibbon(
      group,
      [
        { x: px + nx * off, y: pz + nz * off },
        { x: px - nx * off, y: pz - nz * off },
      ],
      idLocal,
      s * 1.4,
      color,
      y,
      0,
      g
    );
  }
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

/** Emissive setback crown band just under the roofline (inset ring). */
function pushCrown(building, pushV, ring, roofY, bandM, insetFrac, col, emit) {
  const c = ringCentroid(ring);
  const n = ring.length;
  const y0 = roofY - bandM;
  const y1 = roofY;
  for (let e = 0, j = n - 1; e < n; j = e++) {
    const a = ring[j];
    const b = ring[e];
    const ax = c.x + (a.x - c.x) * (1 - insetFrac);
    const ay = c.y + (a.y - c.y) * (1 - insetFrac);
    const bx = c.x + (b.x - c.x) * (1 - insetFrac);
    const by = c.y + (b.y - c.y) * (1 - insetFrac);
    const v0 = pushV(ax, ay, y0, col, -1, -2, emit);
    const v1 = pushV(bx, by, y0, col, -1, -2, emit);
    const v2 = pushV(bx, by, y1, col, -1, -2, emit);
    const v3 = pushV(ax, ay, y1, col, -1, -2, emit);
    building.idx.push(v0, v2, v1, v0, v3, v2);
  }
}

/** 4-sided tapered antenna mast (plain) + emissive tip quad. Returns tip Y. */
function pushSpire(building, pushV, cx, cy, roofY, spireH, baseR, mastCol, tipCol, emitTip) {
  const tipY = roofY + spireH;
  const r = baseR;
  const tipR = r * 0.12;
  const base = [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
  ];
  const top = [
    [cx - tipR, cy - tipR],
    [cx + tipR, cy - tipR],
    [cx + tipR, cy + tipR],
    [cx - tipR, cy + tipR],
  ];
  for (let s = 0; s < 4; s++) {
    const a = base[s];
    const b = base[(s + 1) % 4];
    const tb = top[(s + 1) % 4];
    const ta = top[s];
    const m0 = pushV(a[0], a[1], roofY, mastCol);
    const m1 = pushV(b[0], b[1], roofY, mastCol);
    const m2 = pushV(tb[0], tb[1], tipY, mastCol);
    const m3 = pushV(ta[0], ta[1], tipY, mastCol);
    building.idx.push(m0, m2, m1, m0, m3, m2);
  }
  const q0 = pushV(top[0][0], top[0][1], tipY, tipCol, -1, -2, emitTip);
  const q1 = pushV(top[1][0], top[1][1], tipY, tipCol, -1, -2, emitTip);
  const q2 = pushV(top[2][0], top[2][1], tipY, tipCol, -1, -2, emitTip);
  const q3 = pushV(top[3][0], top[3][1], tipY, tipCol, -1, -2, emitTip);
  building.idx.push(q0, q2, q1, q0, q3, q2);
  return tipY;
}

// --- Round 13 Phase 3: lean SATELLITE building extrusion (buildings only) ----
// The 'sat-buildings' detail path: extrude OpenFreeMap building footprints for
// the DAYLIGHT satellite world. Reuses the toy tessellation + roof helpers but
// bakes NEUTRAL daylight tones into vertex colors (no neon), and carries ONLY
// position/color/index + a per-vertex footprint-ANCHOR (feeds both the rigid
// anchor-bend and the RAW-DEM ground drape). NO facade/edge/beacon neon
// attributes, NO emissive crowns/spires/beacons, NO contact skirt (those are
// night-city only). One merged transferable per tile → one draw per chunk. The
// toy `building` block (detail full/mid) is UNTOUCHED — byte-identical toy.
function buildSatBuildings(vt, frame) {
  const { tileSpan, mercX0, mercYTop, cx, cz, t0 } = frame;
  const out = { empty: true, tessMs: 0, v: WORKER_PROTOCOL };
  const layer = vt.layers.building;
  if (!layer) {
    out.tessMs = performance.now() - t0;
    return out;
  }
  const scale = tileSpan / layer.extent;
  const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
  const B = TOY_WORLD.buildings;
  const S = SAT_BUILDINGS;
  const mToTile = 1 / scale;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Pass 1: collect footprints with real heights (missing → area-inferred).
  const items = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    let rawH = f.properties.render_height ?? f.properties.height ?? 0;
    // OMT synthesizes render_height 5 for untagged buildings — treat as missing
    // (the same trap the toy path documents), else every such building is 5m.
    if (rawH === 5 && f.properties.height == null) rawH = 0;
    const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
    const polys = classifyRings(rings.filter((r) => r.length >= 3));
    if (polys.length === 0) continue;
    let area = 0;
    for (const p of polys) area += Math.abs(signedArea(p.outer));
    const areaM2 = area * 0.5 * scale * scale; // mercator m² (ratio-safe)
    if (areaM2 > B.maxFootprintM2) continue; // merged mega-blocks stay flat ground
    let minY = f.properties.render_min_height ?? 0;
    if (minY < 0) minY = 0;
    items.push({ polys, area, areaM2, rawH, minY, id: typeof f.id === 'number' ? f.id : i });
  }
  if (items.length === 0) {
    out.tessMs = performance.now() - t0;
    return out;
  }

  // Pass 2: display height — real height, else a neutral area-based inference
  // (small footprint → house, big lot → mid-rise), then the toy soft-knee so
  // supertalls read AS supertalls without a hard clamp.
  const built = [];
  for (const it of items) {
    const hash = (((it.id * 2654435761) >>> 0) % 4096) / 4096;
    let h = it.rawH;
    if (h <= 0) h = clamp(9 + Math.sqrt(it.areaM2) * 0.5, S.minH, 42) * (0.85 + hash * 0.3);
    h = Math.max(h, S.minH);
    if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope;
    h = Math.min(h, B.maxH);
    it.h = h;
    it.hash = hash;
    it.elevated = it.minY > 1 && it.minY < h - 3;
    built.push(it);
  }
  built.sort((a, b) => b.area - a.area); // keep the biggest footprints under the cap

  const satB = { pos: [], col: [], idx: [], anchor: [], vtx: 0 };
  let nParapet = 0;
  let nHvac = 0;
  let nGable = 0;
  const hvacCol = hexToRGB(PALETTE.roofHvac).map((c) => c * 1.6); // neutral clutter (mid-gray)
  for (const item of built.slice(0, S.maxPerChunk)) {
    const wall = hexToRGB(pickByHash(S.wallTones, item.id));
    const wallBase = wall.map((c) => c * 0.7); // subtle street-level AO gradient
    const roofCol = wall.map((c) => c * S.roofMul); // roofs a shade darker (tar/gravel)
    const outer = item.polys[0].outer;
    let axT = 0;
    let ayT = 0;
    for (const p of outer) {
      axT += p.x;
      ayT += p.y;
    }
    const cxT = axT / outer.length;
    const cyT = ayT / outer.length;
    const [anchorX, anchorZ] = toLocal(cxT, cyT); // one draped ground → level building
    // Walls extrude from -baseSink (tucked BELOW ground so slope/hill gaps hide)
    // up to roofY = h; the engine adds the raw-DEM ground at the anchor.
    const wallBottomY = item.elevated ? item.minY : -S.baseSinkM;
    const roofY = item.h;
    const pushV = (px, py, y, colArr) => {
      const [lx, lz] = toLocal(px, py);
      satB.pos.push(lx, y, lz);
      satB.col.push(colArr[0], colArr[1], colArr[2]);
      satB.anchor.push(anchorX, anchorZ);
      return satB.vtx++;
    };
    for (const poly of item.polys) {
      // roof cap
      const flat = [];
      const holeIdx = [];
      for (const p of poly.outer) flat.push(p.x, p.y);
      for (const hole of poly.holes) {
        if (hole.length < 3) continue;
        holeIdx.push(flat.length / 2);
        for (const p of hole) flat.push(p.x, p.y);
      }
      if (flat.length < 6) continue;
      const tris = earcut(flat, holeIdx.length ? holeIdx : null);
      const roofBase = satB.vtx;
      for (let vi = 0; vi < flat.length; vi += 2) pushV(flat[vi], flat[vi + 1], roofY, roofCol);
      for (let t = 0; t < tris.length; t += 3) {
        satB.idx.push(roofBase + tris[t], roofBase + tris[t + 2], roofBase + tris[t + 1]);
      }
      // walls: independent quads (crisp per-face normals), DoubleSide material
      for (const ring of [poly.outer, ...poly.holes]) {
        for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
          const a = ring[j];
          const b = ring[e];
          const i0 = pushV(a.x, a.y, wallBottomY, wallBase);
          const i1 = pushV(b.x, b.y, wallBottomY, wallBase);
          const i2 = pushV(b.x, b.y, roofY, wall);
          const i3 = pushV(a.x, a.y, roofY, wall);
          satB.idx.push(i0, i2, i1, i0, i3, i2);
        }
      }
    }
    // Geometric roof detail (daylight realism only — no emissive/beacon).
    if (S.roofDetail) {
      const simp = simplifyRing(outer, 2);
      if (
        item.h < ROOFS.gable.maxH &&
        item.areaM2 < ROOFS.gable.maxAreaM2 &&
        simp.length === 4 &&
        nGable < ROOFS.gable.maxPerChunk
      ) {
        const rise = ROOFS.gable.riseM[0] + item.hash * (ROOFS.gable.riseM[1] - ROOFS.gable.riseM[0]);
        pushGable(satB, pushV, simp, roofY, rise, roofCol);
        nGable += 1;
      } else if (
        item.h >= ROOFS.parapet.minH &&
        item.areaM2 >= ROOFS.parapet.minAreaM2 &&
        nParapet < ROOFS.parapet.maxPerChunk
      ) {
        pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, roofCol);
        nParapet += 1;
      }
      if (
        item.h >= ROOFS.hvac.minH &&
        item.h < ROOFS.hvac.maxH &&
        item.hash < ROOFS.hvac.frac &&
        nHvac < ROOFS.hvac.maxPerChunk
      ) {
        const rand = mulberry32((item.id * 2654435761) >>> 0);
        if (pushHvacBoxes(satB, pushV, item.polys[0], roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0)
          nHvac += 1;
      }
    }
  }

  if (satB.idx.length > 0) {
    const pos = new Float32Array(satB.pos);
    const col = new Float32Array(satB.col);
    const anchor = new Float32Array(satB.anchor);
    const idx = satB.vtx > 65535 ? new Uint32Array(satB.idx) : new Uint16Array(satB.idx);
    out.satBuilding = { pos, col, idx, anchor };
    out.empty = false;
    out.tessMs = performance.now() - t0;
    return transferResult(out, [pos.buffer, col.buffer, idx.buffer, anchor.buffer]);
  }
  out.tessMs = performance.now() - t0;
  return out;
}

// --- worker API --------------------------------------------------------------

const api = {
  /** Resolve the versioned tile URL template from the public TileJSON. */
  async init() {
    if (tileTemplate) return true;
    const res = await fetch(TILEJSON_URL);
    if (!res.ok) throw new Error(`TileJSON ${res.status}`);
    const tj = await res.json();
    tileTemplate = tj.tiles[0];
    return true;
  },

  /**
   * Build one tile → transferable material-group buffers (local coords).
   * `detail`: 'full' (z14 ring) | 'mid' (z13) | 'far' (z12) | 'ultra'
   * (round 12: the z10 altitude ring — an alias for 'far': no buildings/
   * scatter/foam, motorway/trunk/primary only; the OMT building layer
   * doesn't exist below ~z13 anyway) — coarser rings drop sub-pixel
   * features (minor roads, taxiways, canals) at the source. 'sat-buildings'
   * (round 13, Phase 3): the DAYLIGHT satellite buildings-only path —
   * extrusion + roofs, neutral tones, out.satBuilding; NONE of the toy
   * land/water/road/scatter passes run (returns early).
   * Returns {empty:true} when the tile 404s (open ocean is sparse).
   */
  async buildTile(z, x, y, detail = 'full') {
    if (detail === 'ultra') detail = 'far';
    if (!tileTemplate) await api.init();
    const url = tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url);
    if (res.status === 404 || res.status === 204) return { empty: true, v: WORKER_PROTOCOL };
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
    const buf = await res.arrayBuffer();
    const t0 = performance.now();
    const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));

    // Tile frame → local world meters (tile center origin)
    const tileSpan = WORLD_SIZE / 2 ** z;
    const mercX0 = -WORLD_SIZE / 2 + x * tileSpan;
    const mercYTop = WORLD_SIZE / 2 - y * tileSpan;
    const cx = mercX0 + tileSpan / 2;
    const cz = -(mercYTop - tileSpan / 2);
    // mercator stretch at tile center (for true-meter ribbon widths)
    const latC = (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
    const k = 1 / Math.cos((latC * Math.PI) / 180);

    // Round 13 Phase 3: the lean satellite buildings-only path returns EARLY
    // (out.satBuilding) — none of the land/water/road/scatter passes below run.
    if (detail === 'sat-buildings') {
      return buildSatBuildings(vt, { tileSpan, mercX0, mercYTop, cx, cz, t0 });
    }

    const groups = { land: makeGroup(), water: makeGroup() };
    let liftEps = 0; // per-feature stacking epsilon within the tile

    const eachFeature = (layerName, fn) => {
      const layer = vt.layers[layerName];
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) fn(layer.feature(i), layer.extent, i);
    };

    const polygonPass = (layerName, colorFor, lift) => {
      eachFeature(layerName, (f, extent) => {
        if (f.type !== 3) return; // polygons only
        const hex = colorFor(f.properties);
        if (!hex) return;
        const scale = tileSpan / extent;
        const toLocal = (px, py) => [
          mercX0 + px * scale - cx,
          -(mercYTop - py * scale) - cz,
        ];
        const rings = f.loadGeometry().map((ring) => clipRing(ring, extent));
        const polys = classifyRings(rings.filter((ring) => ring.length >= 3));
        liftEps = (liftEps + 0.02) % 0.5; // wraps: hundreds of features must not stack meters
        pushPolygon(
          groups[layerName === 'water' ? 'water' : 'land'],
          polys,
          toLocal,
          hexToRGB(hex),
          lift + liftEps
        );
      });
    };

    const linePass = (layerName, groupName, styleFor, lift) => {
      eachFeature(layerName, (f, extent, fi) => {
        if (f.type !== 2) return;
        const style = styleFor(f.properties);
        if (!style) return;
        const scale = tileSpan / extent;
        const toLocal = (px, py) => [
          mercX0 + px * scale - cx,
          -(mercYTop - py * scale) - cz,
        ];
        const halfW = (style.width * k) / 2; // world (mercator) meters
        const color = hexToRGB(style.color);
        // Pulse arteries alternate scroll direction per feature — a hash of
        // the (stable) feature id keeps it deterministic across rebuilds.
        const fid = typeof f.id === 'number' ? f.id : fi;
        const arcDir = style.pulse ? ((fid & 1) === 0 ? 1 : -1) : 0;
        liftEps = (liftEps + 0.02) % 0.5;
        for (const line of f.loadGeometry()) {
          // clip each segment, stitching contiguous runs back into chains
          let chain = [];
          for (let i = 0; i < line.length - 1; i++) {
            const seg = clipSegment(line[i], line[i + 1], extent);
            if (!seg) {
              if (chain.length > 1)
                pushRibbon(groups[groupName], chain, toLocal, halfW, color, lift + liftEps, arcDir);
              chain = [];
              continue;
            }
            if (chain.length === 0) chain.push(seg[0]);
            chain.push(seg[1]);
          }
          if (chain.length > 1)
            pushRibbon(groups[groupName], chain, toLocal, halfW, color, lift + liftEps, arcDir);
        }
      });
    };

    // Paint order = lift order (landuse under landcover under park … roads top)
    const MINOR_ROADS = new Set(['minor', 'service', 'track', 'path', 'raceway']);
    polygonPass('landuse', (p) => LANDUSE_COLOR[p.class], LIFT.landuse);
    polygonPass('landcover', (p) => LANDCOVER_COLOR[p.class] ?? (p.class === 'wood' ? PALETTE.wood : null), LIFT.landcover);
    polygonPass('park', () => PALETTE.park, LIFT.park);
    polygonPass('water', () => PALETTE.water, LIFT.water);
    if (detail !== 'far') {
      linePass('waterway', 'water', (p) =>
        p.class === 'river' ? { width: 14, color: PALETTE.water } : detail === 'full' && p.class === 'canal' ? { width: 9, color: PALETTE.water } : null,
      LIFT.waterway);
    }
    polygonPass('aeroway', (p) => (p.class === 'runway' || p.class === 'taxiway' || p.class === 'apron' ? PALETTE.runway : null), LIFT.aeroway);
    linePass('aeroway', 'land', (p) =>
      p.class === 'runway' ? { width: 55, color: PALETTE.runway } : detail === 'full' && p.class === 'taxiway' ? { width: 14, color: PALETTE.runway } : null,
    LIFT.aeroway);
    // Round 7: runway edge lights + threshold crossbars (full/mid rings) —
    // baked into the land group with aGlow. Lift: ABOVE the whole aeroway +
    // road stack (their liftEps walks up to +0.48 — lights at aeroway+0.3
    // were z-buried under JFK's apron polygons).
    const LIGHT_Y = LIFT.road + 0.6;
    if (detail !== 'far') {
      const lightCol = hexToRGB(PALETTE.runwayLight);
      const rwyHalfW = (55 * k) / 2;
      eachFeature('aeroway', (f, extent) => {
        if (f.type !== 2 || f.properties.class !== 'runway') return;
        const scale = tileSpan / extent;
        const toLocal = (px, py) => [
          mercX0 + px * scale - cx,
          -(mercYTop - py * scale) - cz,
        ];
        for (const line of f.loadGeometry()) {
          let chain = [];
          for (let i = 0; i < line.length - 1; i++) {
            const seg = clipSegment(line[i], line[i + 1], extent);
            if (!seg) {
              if (chain.length > 1)
                pushRunwayLights(groups.land, chain, toLocal, k, rwyHalfW, lightCol, LIGHT_Y);
              chain = [];
              continue;
            }
            if (chain.length === 0) chain.push(seg[0]);
            chain.push(seg[1]);
          }
          if (chain.length > 1)
            pushRunwayLights(groups.land, chain, toLocal, k, rwyHalfW, lightCol, LIGHT_Y);
        }
      });
    }
    linePass('transportation', 'land', (p) => {
      if (p.brunnel === 'tunnel') return null;
      if (detail === 'far' && p.class !== 'motorway' && p.class !== 'trunk' && p.class !== 'primary') return null;
      if (detail === 'mid' && MINOR_ROADS.has(p.class)) return null;
      const width = ROAD_WIDTH[p.class];
      if (!width) return null;
      return {
        width,
        color: ROAD_COLOR[p.class] ?? PALETTE.roadMinor,
        pulse: PULSE_CLASSES.has(p.class),
      };
    }, LIFT.road);

    // --- buildings: extruded footprints, palette rotation, violet base AO ---
    // (near ring only — this is where the diorama depth comes from)
    // beacon: per-vertex blink phase (0..1) on rooftop-beacon quads, -1
    // sentinel everywhere else (packed as aBeacon; the building material's
    // blink layer animates it — FLY_ATLAS_REWORK §4.3b).
    // facade (round 8, P3): vec4 per vertex — (EDGE-LOCAL arc trueM, heightM,
    // buildingH, buildingHash01) on WALL verts (edge-local so window columns
    // align per facade + corners are detectable); role-encoded on details
    // ((-1,…) plain roof/HVAC/gable, (-2, emit,…) emissive crown/spire tip).
    // The facade-grid shader rasterizes a structured window grid from it.
    // edge (round 8, P3): vec2 per vertex — (edgeLenM, litBias) on WALL verts
    // (the shader centers the column grid on the edge + biases lit density by
    // district); (0,0) on every roof/detail vert (no grid → dark).
    const building = { pos: [], col: [], idx: [], anchor: [], beacon: [], facade: [], edge: [], vtx: 0 };
    // 'mid' ring keeps only the tall skyline (a city that vanishes at 8km
    // reads flat); 'far' skips buildings entirely.
    const wantBuildings = detail === 'full' || detail === 'mid';
    if (wantBuildings && vt.layers.building) {
      const layer = vt.layers.building;
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const B = TOY_WORLD.buildings;
      const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
      // Pass 1: collect every footprint (raw height + min-height + mercator
      // area). District stats read the WHOLE full-ring tile, so the mid-ring
      // skyline gate is deferred to pass 2 where it tests the MAPPED height.
      const items = [];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.hide_3d) continue;
        let rawH = f.properties.render_height ?? f.properties.height ?? 0; // 0 = missing
        // R8 verification finding: OpenMapTiles synthesizes render_height for
        // EVERY building (untagged → default 5), so "missing" never read 0 and
        // the district inference (the real same-height fix) was dead code.
        // Treat the exact synthesized default as missing — a genuine 5m
        // building would render at minH-clamped 12.15m either way, so no real
        // data is lost by re-inferring it.
        if (rawH === 5 && f.properties.height == null) rawH = 0;
        // Mid ring shows only the skyline: a TAGGED building under 30m can
        // never map ≥30 (smallBoost only lifts <15m, the knee only shrinks),
        // so skip its geometry load. Missing-height (rawH 0) survives — a big
        // downtown footprint may still get inferred into the skyline.
        if (detail === 'mid' && rawH > 0 && rawH < 30) continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        const polys = classifyRings(rings.filter((r) => r.length >= 3));
        if (polys.length === 0) continue;
        let area = 0;
        for (const p of polys) area += Math.abs(signedArea(p.outer));
        const areaM2 = area * 0.5 * scale * scale; // mercator m² (ratio-safe)
        // Merged-block mega-footprints (0.2km²+) extrude into giant floating
        // roof slabs — they're districts, not toy buildings.
        if (areaM2 > B.maxFootprintM2) continue;
        let minY = f.properties.render_min_height ?? 0;
        if (minY < 0) minY = 0;
        items.push({ polys, area, areaM2, rawH, minY, id: typeof f.id === 'number' ? f.id : i });
      }
      // District logic: how "downtown" is this chunk? tall = tagged buildings
      // ≥40m, cover = footprint fraction of the tile. Drives missing-height
      // inference (the real "same height" fix) and the P3 window-density bias.
      const tileAreaM2 = tileSpan * tileSpan;
      const D = B.district; // knobs live-tunable in fly-constants (fix round)
      let tallCount = 0;
      let coverM2 = 0;
      for (const it of items) {
        if (it.rawH >= D.tallMinH) tallCount++;
        coverM2 += it.areaM2;
      }
      const districtK =
        clamp01(tallCount / D.tallDiv) * 0.6 +
        clamp01(coverM2 / tileAreaM2 / D.coverDiv) * 0.4;
      const litBias = 0.6 + districtK * 0.8; // P3 bakes this into aEdge.y
      // Missing-height inference: suburbs (low districtK) → jittered 9–15m
      // houses; downtown big footprints → inferred mid-rises. Only used where
      // OSM lacks a height (render_height ?? 12 today made every such building
      // exactly 12m — the visible "same height" bug).
      const inferH = (aM2, hash) => {
        const lo = D.loBase + hash * D.loJit;
        const hi = D.hiBase + hash * D.hiJit;
        return lo + (hi - lo) * (districtK * clamp01(aM2 / D.areaDiv));
      };
      // Pass 2: finalize the display height with the soft-knee mapping, apply
      // the mid-ring skyline gate on the MAPPED height, and stash per-building
      // hash / litBias / elevation for emit (and for P3's aEdge bake).
      const built = [];
      for (const it of items) {
        const hash = (((it.id * 2654435761) >>> 0) % 4096) / 4096;
        let h = Math.max(it.rawH || inferH(it.areaM2, hash), B.minH);
        if (h < B.smallBoostH) h *= B.smallBoost; // lift true low-rises only
        if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope; // soft-knee supertalls
        h = Math.min(h, B.maxH);
        if (detail === 'mid' && h < 30) continue; // mid ring: skyline only (mapped h)
        it.h = h;
        it.hash = hash;
        it.litBias = litBias; // stashed for P3 → aEdge.y (window density bias)
        // Elevated footprints (render_min_height): extrude minY→h and float
        // (no baseSinkM). Garbage min ≥ h−3 falls through to a ground slab.
        it.elevated = it.minY > 1 && it.minY < h - 3;
        built.push(it);
      }
      built.sort((a, b) => b.area - a.area);
      const cap = detail === 'mid' ? B.maxPerChunkMid : B.maxPerChunk;
      const shade = hexToRGB(PALETTE.buildingShade);
      const glow = hexToRGB(PALETTE.buildingTop);
      const beaconCol = hexToRGB(BEACONS.color);
      // P2 roof-detail palettes (constant per chunk) + contact-skirt color
      const hvacCol = hexToRGB(PALETTE.roofHvac);
      const spireTipCol = hexToRGB(PALETTE.spireTip);
      const skirtCol = hexToRGB(PALETTE.groundBase).map((c) => c * 0.6);
      // Per-chunk detail caps (tri-budget throttle): count buildings that got
      // each treatment, not verts. Emissive crowns/spires are uncapped (rare —
      // only h ≥ 90/120 towers reach them).
      let nParapet = 0;
      let nHvac = 0;
      let nGable = 0;
      let nSkirt = 0;
      const mToTile = 1 / scale; // world (mercator) meters → building tile units
      for (const item of built.slice(0, cap)) {
        const base = hexToRGB(pickByHash(PALETTE.buildings, item.id));
        // dark-neon grade: near-black feet, luminous violet tops — wall
        // verts interpolate base→top, so every tower glows from above
        const baseAO = base.map((c, ci) => c * 0.55 + shade[ci] * 0.35);
        // Round 7: roofs must READ from above (they used to render as black
        // holes next to the lit walls) — heavier glow weight in the top mix.
        const topCol = base.map((c, ci) => c * 0.35 + glow[ci] * 0.95);
        // footprint centroid (in tile coords) anchors the whole building to
        // ONE draped height so it stands level
        const outer = item.polys[0].outer;
        let axT = 0;
        let ayT = 0;
        for (const p of outer) {
          axT += p.x;
          ayT += p.y;
        }
        const [anchorX, anchorZ] = toLocal(axT / outer.length, ayT / outer.length);
        const bHash = item.hash;
        // The engine subtracts baseSinkM from EVERY building vert (walls sink
        // below ground so no bottom cap is needed). Elevated buildings must
        // NOT sink, so cancel it here and start the walls at minY, not 0.
        const sinkComp = item.elevated ? B.baseSinkM : 0;
        const wallBottomY = (item.elevated ? item.minY : 0) + sinkComp;
        const baseFacY = item.elevated ? item.minY : 0;
        const roofY = item.h + sinkComp;
        const pushV = (px, py, y, colArr, beaconPhase = -1, facU = -1, facY = 0, edgeLen = 0, litB = 0) => {
          const [lx, lz] = toLocal(px, py);
          building.pos.push(lx, y, lz);
          building.col.push(colArr[0], colArr[1], colArr[2]);
          building.anchor.push(anchorX, anchorZ);
          building.beacon.push(beaconPhase);
          building.facade.push(facU, facY, item.h, bHash);
          building.edge.push(edgeLen, litB);
          return building.vtx++;
        };
        for (const poly of item.polys) {
          // roof
          const flat = [];
          const holeIdx = [];
          for (const p of poly.outer) flat.push(p.x, p.y);
          for (const hole of poly.holes) {
            if (hole.length < 3) continue;
            holeIdx.push(flat.length / 2);
            for (const p of hole) flat.push(p.x, p.y);
          }
          if (flat.length < 6) continue;
          const tris = earcut(flat, holeIdx.length ? holeIdx : null);
          const roofBase = building.vtx;
          for (let vi = 0; vi < flat.length; vi += 2) pushV(flat[vi], flat[vi + 1], roofY, topCol);
          for (let t = 0; t < tris.length; t += 3) {
            building.idx.push(roofBase + tris[t], roofBase + tris[t + 2], roofBase + tris[t + 1]);
          }
          // walls: independent quads (crisp per-face normals), gradient AO.
          // Round 8 (P3): the facade arc is now EDGE-LOCAL (0..edgeLen per
          // wall, TRUE meters: tile units × scale ÷ k) instead of cumulative
          // along the ring — real windows align per facade and the shader can
          // detect corner columns. Every wall vert also pushes aEdge =
          // (edgeLen, litBias) so the shader centers the column grid and biases
          // lit density by district. Elevated buildings extrude from minY
          // (baseFacY) up to h; the bottom cap is skipped (DoubleSide closes).
          for (const ring of [poly.outer, ...poly.holes]) {
            for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
              const a = ring[j];
              const b = ring[e];
              const edgeLen = (Math.hypot(b.x - a.x, b.y - a.y) * scale) / k;
              const lb = item.litBias;
              const i0 = pushV(a.x, a.y, wallBottomY, baseAO, -1, 0, baseFacY, edgeLen, lb);
              const i1 = pushV(b.x, b.y, wallBottomY, baseAO, -1, edgeLen, baseFacY, edgeLen, lb);
              const i2 = pushV(b.x, b.y, roofY, topCol, -1, edgeLen, item.h, edgeLen, lb);
              const i3 = pushV(a.x, a.y, roofY, topCol, -1, 0, item.h, edgeLen, lb);
              building.idx.push(i0, i2, i1, i0, i3, i2); // DoubleSide material
            }
          }
        }
        // --- P2 roof detail: dispatch by (height, area, edge count, hash) ---
        // Gables/parapets/HVAC/skirts are FULL-ring only (the mid ring keeps
        // flat caps for the silhouette); emissive crowns + antenna spires emit
        // on BOTH rings so the distant skyline glows. Caps throttle the tri
        // budget (buildings, not verts). All horizontal sizes are world meters.
        const cxT = axT / outer.length;
        const cyT = ayT / outer.length;
        if (detail === 'full') {
          const simp = simplifyRing(outer, 2);
          if (
            item.h < ROOFS.gable.maxH &&
            item.areaM2 < ROOFS.gable.maxAreaM2 &&
            simp.length === 4 &&
            nGable < ROOFS.gable.maxPerChunk
          ) {
            const rise =
              ROOFS.gable.riseM[0] + item.hash * (ROOFS.gable.riseM[1] - ROOFS.gable.riseM[0]);
            pushGable(building, pushV, simp, roofY, rise, hexToRGB(pickByHash(PALETTE.roofGable, item.id)));
            nGable += 1;
          } else if (
            item.h >= ROOFS.parapet.minH &&
            item.areaM2 >= ROOFS.parapet.minAreaM2 &&
            nParapet < ROOFS.parapet.maxPerChunk
          ) {
            pushParapet(building, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, topCol);
            nParapet += 1;
          }
          // HVAC clutter on mid/high flat roofs (hash-gated ~frac)
          if (
            item.h >= ROOFS.hvac.minH &&
            item.h < ROOFS.hvac.maxH &&
            item.hash < ROOFS.hvac.frac &&
            nHvac < ROOFS.hvac.maxPerChunk
          ) {
            const rand = mulberry32((item.id * 2654435761) >>> 0);
            if (pushHvacBoxes(building, pushV, item.polys[0], roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0)
              nHvac += 1;
          }
        }
        // Emissive skyline tops (both rings): crown band ≥90 m, plus an antenna
        // spire on ~half of the ≥120 m towers (id parity). aFacade.x = -2 marks
        // these emissive so the facade-grid shader lights them.
        let spireTipY = null;
        if (item.h >= ROOFS.crown.minH) {
          if (item.h >= ROOFS.spire.minH && (item.id & 1) === 0) {
            const spireH =
              item.h * (ROOFS.spire.hFrac[0] + item.hash * (ROOFS.spire.hFrac[1] - ROOFS.spire.hFrac[0]));
            spireTipY = pushSpire(
              building,
              pushV,
              cxT,
              cyT,
              roofY,
              spireH,
              ROOFS.spire.baseR * mToTile,
              shade,
              spireTipCol,
              ROOFS.spire.emitTip
            );
          }
          pushCrown(
            building,
            pushV,
            outer,
            roofY,
            ROOFS.crown.bandM,
            ROOFS.crown.insetFrac,
            hexToRGB(pickByHash(PALETTE.crownColors, item.id)),
            ROOFS.crown.emit
          );
        }
        // Rooftop obstruction beacon (round 8: absolute 150 m threshold; the
        // round-7 heightFrac 0.8 × maxH 330 = 264 m left these near-extinct
        // against the new mapping). Rides the spire tip when one exists. Blink
        // phase hashed off the id so the skyline never blinks in unison.
        if (item.h >= BEACONS.minHeightM) {
          const s = BEACONS.sizeM / 2 / scale; // half-edge in tile units
          const phase = item.hash;
          const y = (spireTipY ?? roofY) + 0.6;
          const b0 = pushV(cxT - s, cyT - s, y, beaconCol, phase);
          const b1 = pushV(cxT + s, cyT - s, y, beaconCol, phase);
          const b2 = pushV(cxT + s, cyT + s, y, beaconCol, phase);
          const b3 = pushV(cxT - s, cyT + s, y, beaconCol, phase);
          building.idx.push(b0, b2, b1, b0, b3, b2); // DoubleSide material
        }
        // Dark contact skirt (grounds the tower — round 8, P3 package D): a
        // footprint ×1.15 dark polygon baked into the LAND group at a very LOW
        // lift (0.15 — deliberately BELOW the whole road liftEps stack). Full
        // ring only; capped per chunk. pushPolygon writes aArc/aGlow -1
        // sentinels so it never pulses/glows.
        if (detail === 'full' && item.h >= 20 && nSkirt < ROOFS.skirtMaxPerChunk) {
          const skirtOuter = outer.map((p) => ({
            x: cxT + (p.x - cxT) * 1.15,
            y: cyT + (p.y - cyT) * 1.15,
          }));
          pushPolygon(groups.land, [{ outer: skirtOuter, holes: [] }], toLocal, skirtCol, 0.15);
          nSkirt += 1;
        }
      }
    }

    // --- set dressing: deterministic scatter inside green polygons ---------
    // trees = chunky blobs; grass = spiky cone clumps (denser, smaller)
    const treePts = [];
    const grassPts = [];
    if (detail === 'full') {
      const rand = mulberry32((z * 73856093) ^ (x * 19349663) ^ (y * 83492791));
      const { trees, grassCfg } = { trees: TOY_WORLD.trees, grassCfg: TOY_WORLD.grass };
      const scatter = (layerName, classFilter, out, cfg) => {
        const layer = vt.layers[layerName];
        if (!layer) return;
        const scale = tileSpan / layer.extent;
        const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
        for (let i = 0; i < layer.length; i++) {
          if (out.length / 4 >= cfg.maxPerChunk) return;
          const f = layer.feature(i);
          if (f.type !== 3) continue;
          if (classFilter && !classFilter(f.properties)) continue;
          const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
          const polys = classifyRings(rings.filter((r) => r.length >= 3));
          for (const poly of polys) {
            const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
            let want = Math.min(
              Math.floor(areaM2 / cfg.areaPerM2),
              cfg.maxPerChunk - out.length / 4
            );
            if (want <= 0) continue;
            // bbox rejection sampling
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const p of poly.outer) {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            }
            for (let tries = want * 8; tries > 0 && want > 0; tries--) {
              const sx = minX + rand() * (maxX - minX);
              const sy = minY + rand() * (maxY - minY);
              if (!pointInPoly(poly, sx, sy)) continue;
              const [lx, lz] = toLocal(sx, sy);
              out.push(lx, lz, cfg.minR + rand() * (cfg.maxR - cfg.minR), (rand() * 4) | 0);
              want -= 1;
            }
          }
        }
      };
      scatter('park', null, treePts, { ...trees, areaPerM2: trees.areaPerTreeM2 });
      scatter('landcover', (p) => p.class === 'wood' || p.class === 'grass', treePts, {
        ...trees,
        areaPerM2: trees.areaPerTreeM2,
      });
      scatter('park', null, grassPts, grassCfg);
      scatter('landcover', (p) => p.class === 'grass', grassPts, grassCfg);
    }

    // --- water foam: hand-drawn white edge lines along shorelines ----------
    // (skip segments that lie on the tile boundary — those edges are clip
    // artifacts, not coastline)
    if (detail !== 'far' && vt.layers.water) {
      const layer = vt.layers.water;
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const foamColor = hexToRGB(PALETTE.waterFoam);
      const onBoundary = (a, b) => {
        const eps = 0.5;
        return (
          (a.x < eps && b.x < eps) ||
          (a.y < eps && b.y < eps) ||
          (a.x > layer.extent - eps && b.x > layer.extent - eps) ||
          (a.y > layer.extent - eps && b.y > layer.extent - eps)
        );
      };
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.class === 'swimming_pool') continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        for (const ring of rings) {
          if (ring.length < 3) continue;
          let chain = [];
          for (let e = 0; e < ring.length; e++) {
            const a = ring[e];
            const b = ring[(e + 1) % ring.length];
            if (onBoundary(a, b)) {
              if (chain.length > 1)
                pushRibbon(groups.water, chain, toLocal, 3 * 1.3, foamColor, LIFT.waterway + 0.12, 1);
              chain = [];
              continue;
            }
            if (chain.length === 0) chain.push(a);
            chain.push(b);
          }
          if (chain.length > 1)
            pushRibbon(groups.water, chain, toLocal, 3 * 1.3, foamColor, LIFT.waterway + 0.12, 1);
        }
      }
    }

    // Pack transferables
    const out = { empty: true, tessMs: 0, v: WORKER_PROTOCOL };
    const transfer = [];
    for (const name of GROUPS) {
      const g = groups[name];
      if (g.idx.length === 0) continue;
      const pos = new Float32Array(g.pos);
      const col = new Float32Array(g.col);
      const idx = g.vtx > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
      out[name] = { pos, col, idx };
      out.empty = false;
      transfer.push(pos.buffer, col.buffer, idx.buffer);
      if (name === 'water') {
        // the foam-dash shader animates on this
        const foam = new Float32Array(g.foam);
        out[name].foam = foam;
        transfer.push(foam.buffer);
      } else if (name === 'land') {
        // road-pulse arcs (same array, packed as aArc; +4 bytes/vert)
        const arc = new Float32Array(g.foam);
        out[name].arc = arc;
        transfer.push(arc.buffer);
        // runway-light arcs (round 7, packed as aGlow; +4 bytes/vert)
        const glow = new Float32Array(g.glow);
        out[name].glow = glow;
        transfer.push(glow.buffer);
      }
    }
    if (building.idx.length > 0) {
      const pos = new Float32Array(building.pos);
      const col = new Float32Array(building.col);
      const anchor = new Float32Array(building.anchor);
      const beacon = new Float32Array(building.beacon);
      const facade = new Float32Array(building.facade);
      const edge = new Float32Array(building.edge);
      const idx = building.vtx > 65535 ? new Uint32Array(building.idx) : new Uint16Array(building.idx);
      out.building = { pos, col, idx, anchor, beacon, facade, edge };
      out.empty = false;
      transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer, beacon.buffer, facade.buffer, edge.buffer);
    }
    if (treePts.length > 0) {
      const trees = new Float32Array(treePts);
      out.trees = trees;
      out.empty = false;
      transfer.push(trees.buffer);
    }
    if (grassPts.length > 0) {
      const grass = new Float32Array(grassPts);
      out.grass = grass;
      out.empty = false;
      transfer.push(grass.buffer);
    }
    out.tessMs = performance.now() - t0;
    return transferResult(out, transfer);
  },
};

// Mark the result so Comlink moves the buffers instead of cloning them.
function transferResult(value, transferables) {
  return transferables.length ? comlinkTransfer(value, transferables) : value;
}

expose(api);

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
import {
  BEACONS,
  CLUTTER,
  MONUMENT_MODELS,
  NEON_COVER,
  PARCEL_HOMES,
  ROOF_TYPOLOGY,
  ROOFS,
  ROOFS_SAT,
  RUNWAY_LIGHTS,
  SAT_AMBIENT,
  SAT_BUILDINGS,
  SAT_FAR_SUBURB,
  SAT_GROUND_LIFE,
  SAT_POLY_COVER,
  SAT_ROADS,
  SAT_SKYLINE,
  SAT_TINT,
  SAT_VEG,
  SAT_WATER,
  TILE_PIPELINE,
  TOY_MID_SUBURB,
  TOY_WORLD,
} from '../fly-constants';
import { MONUMENT_EXCLUSIONS } from '../monument-models';

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
//   round 13 → 11 (P4): 'sat-buildings' now ALSO returns out.satWater (water
//     polygons for the specular glint). A stale protocol-10 worker's
//     buildSatBuildings has no satWater branch → the tile has NO out.satWater →
//     the engine skips the water mesh (SAFE: no glint, no crash) and the
//     v-mismatch warn fires. New OUTPUT key only; the buffer layouts of every
//     other detail path are unchanged.
//   round 15 → 12: 'sat-buildings' out.satBuilding gained a `uv` array (facade
//     window UVs) and re-colored roofs. A stale protocol-11 worker returns
//     satBuilding WITHOUT uv — an absent attribute reads (0,0) on the GPU, which
//     in the window atlas is a pane, so every roof would grow a window. The
//     SatBuildingEngine therefore now treats ANY v-mismatch as "render nothing"
//     (+ the one dev warn) instead of drawing the tile — fails loud + safe, the
//     documented sentinel contract. Buffer layout change is sat-buildings-only;
//     every other detail path is byte-unchanged.
//   round 16 → 13 (A2): NEW detail 'sat-roads' — the satellite ground-light
//     network — returning out.satRoads {pos,col,arc,cls,idx} (a NEW output key).
//     STALE-BUNDLE ANALYSIS, both directions:
//       • stale v12 worker + new engines: asked for 'sat-roads' it has no such
//         branch and the string is neither 'ultra' nor 'sat-buildings', so it
//         falls THROUGH to the full toy pipeline and returns a land/water/
//         building TOY bundle with NO out.satRoads key. That bundle must never
//         be read as roads, so SatRoadEngine drops ANY v !== 13 outright (one
//         dev warn, chunk marked empty, nothing rendered) — it never inspects
//         the arrays. SatBuildingEngine already drops v !== 13 the same way
//         (its R15 sentinel contract), and ToyWorldEngine's pin moves in
//         lockstep so toy dev sessions don't log a false "stale worker" warn
//         (the R15 lesson).
//       • new v13 worker + a stale engine pinned to 12: every satellite engine
//         drops the bundle and warns — no buildings, no roads, no crash.
//     'sat-buildings' output and every toy detail path are BYTE-UNCHANGED (the
//     new branch returns early, and it adds only new functions).
//   round 18 → 14 (A1): TWO changes, both to the accepted `detail` vocabulary
//     and to 'sat-buildings' OUTPUT KEYS — the two things this constant exists
//     to version.
//       (1) NEW details 'sat-skyline' (the distant z13 block-mass ring A2
//           consumes: out.satSkyline {pos,col,idx,anchor} — walls + flat cap,
//           NO uv) and 'sat-veg' (the ground-life scatter A3 consumes:
//           out.satVeg [x,z,r,kind] rows + out.satPts {water, ind}).
//       (2) 'sat-buildings' gained out.waterCoverage (per-tile water-area
//           ratio, drives the engine's neighbour-gated OCEAN FILL) and
//           out.satBuilding.meta {total, kept, smallKept, forms} (roof-form
//           telemetry verify-roof-variety gates on).
//     STALE-BUNDLE ANALYSIS, both directions:
//       • stale v13 worker + new engines: asked for 'sat-skyline'/'sat-veg' it
//         has neither branch, and neither string is 'ultra'/'sat-buildings'/
//         'sat-roads', so it falls THROUGH to the full toy pipeline and answers
//         with a land/water/building TOY bundle. Reading that as skyline mass
//         or as a tree scatter is meaningless, so every satellite engine drops
//         ANY v !== 14 outright (one dev warn, chunk marked empty, nothing
//         rendered) — it never inspects the arrays. Same contract as R15/R16.
//       • new v14 worker + a stale engine pinned to 13: every satellite engine
//         drops the bundle and warns — no buildings, no roads, no crash.
//     All FIVE consumer pins move in lockstep with this line (sat-building-
//     engine, sat-road-engine, sat-skyline-engine, sat-veg-engine,
//     toy-world-engine — the R15 lesson: forgetting the toy pin spams a false
//     "stale worker" warn through every toy session even though the toy
//     bundle is byte-unchanged).
// Round 19 → 15: bumped in the SCAFFOLDING commit (payloads unchanged at bump
//     time) so the round's worker-output moves (A HOMESTEAD: housePts/satTint/
//     per-class veg rows; F REWIND: toy winding dispatch) all land behind one
//     version gate — a stale HMR worker from either wave drops cleanly.
// Round 21 → 17: bumped in the SCAFFOLDING commit (payloads unchanged at bump
//     time) so the round's worker-output moves (D PIPELINE: empty-reason codes
//     on every {empty:true} return, skyline hash-shuffle + hatch ramp changing
//     selection for identical input, vegMeta opt-in via api.setDiag) land
//     behind one version gate — a stale HMR worker from either wave drops
//     cleanly.
// Round 22 → 18: bumped in the SCAFFOLDING commit (payloads unchanged at bump
//     time) so C CLUTTER's new outputs (cls-3..6 road centerline paths for
//     movers/poles, parking/driveway anchor points, junction points — the
//     CLUTTER block in fly-constants.js documents the contract) land behind
//     one version gate. With CLUTTER.enabled false the worker's outputs stay
//     byte-identical to protocol 17 except this stamp.
const WORKER_PROTOCOL = 18; // R22 W0: 17->18 lockstep (C CLUTTER adds road-path/parking/junction outputs; payloads unchanged at bump time)

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
 * ROUND 19 (F REWIND) — THE NEON COVERAGE FIX. The R18 note above ends with
 * "Neon carries the SAME defect at those three call sites and needs its own
 * round"; this is that round. All three toy call sites (polygonPass land/
 * water, the toy building block, the toy scatter) now dispatch through here,
 * so `NEON_COVER.enabled:false` restores the R18 toy pipeline byte-for-byte
 * (verify-neon-cover gate 1 proves it on a real Powell tile).
 *
 * Measured on the live tiles, before → after (features that yield ≥1 polygon;
 * `scripts/inspect-mvt.mjs` neighbourhood):
 *
 *   14/4411/6193  Powell OH     landuse   31 →  0 ... 31    (EVERY layer zero)
 *                               landcover 17 →  0 ... 15
 *                               water     11 →  0 ...  7
 *                               building   2 →  0 ...  2
 *   14/4824/6157  Manhattan     building 1481 → 18 ... 1375
 *                               landcover 522 →  2 ...  503
 *   14/4825/6158  Brooklyn      building  452 →  6 ...  412
 *
 * Powell is the reference case and it is exactly what the user saw: not "a
 * bit sparse" — every polygon layer in the tile classified to nothing, so the
 * chunk issued no land overlay, no water, no buildings. A literal black void.
 */
const classifyToy = NEON_COVER.enabled ? classifyRingsSat : classifyRings;

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

// --- Round 18 (A1 "BLOCKSMITH") SATELLITE roof-form helpers ------------------
// NEW functions, every one of them — the toy helpers above are FROZEN (their
// output is what keeps Neon byte-identical) and two of them (pushCrown /
// pushSpire) call pushV with SEVEN args to encode the neon emissive role,
// which the satellite path deliberately cannot carry. Everything below calls
// pushV with EXACTLY FOUR args, which on the satellite path means NEUTRAL_UV:
// the atlas's solid-white pier crossing, sampled at mip 0 because a constant
// uv has zero screen-space derivative. That is THE window-free roof contract —
// a 5th/6th arg here would put window panes on a chimney.
//
// Horizontal sizes arrive in world (mercator) meters and are converted to tile
// units by the caller's mToTile, matching the footprint's own frame; heights
// are meters directly (the vertical axis is unstretched).

/** Ring scaled toward its centroid by (1 - insetFrac). */
function insetRing(ring, insetFrac) {
  const c = ringCentroid(ring);
  return ring.map((p) => ({
    x: c.x + (p.x - c.x) * (1 - insetFrac),
    y: c.y + (p.y - c.y) * (1 - insetFrac),
  }));
}

/** Deterministic point strictly inside `poly`, with `halfTile` clearance. */
function hashPointIn(poly, rand, halfTile, tries = 12) {
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
  for (let t = 0; t < tries; t++) {
    const sx = minX + rand() * (maxX - minX);
    const sy = minY + rand() * (maxY - minY);
    if (!pointInPoly(poly, sx, sy)) continue;
    // both diagonals inside ⇒ the whole box/prism lands on the roof (the
    // pushHvacBoxes placement test, reused so clutter never overhangs an eave)
    if (halfTile > 0) {
      if (!pointInPoly(poly, sx - halfTile, sy - halfTile)) continue;
      if (!pointInPoly(poly, sx + halfTile, sy + halfTile)) continue;
    }
    return { x: sx, y: sy };
  }
  return null;
}

/**
 * THE WORKHOUSE FORM. Outer rim ring at roofY → the same ring scaled toward
 * its centroid by (1 - insetFrac), raised to roofY + riseM: n side quads + an
 * earcut cap of the inset ring. One primitive covers three real roof forms by
 * insetFrac alone —
 *   0.42 on a 4-corner ring  ≈ HIP      (four sloped planes, short ridge)
 *   0.25 on a low-rise       ≈ MANSARD  (steep skirt, big flat deck)
 *   0.55 on a 3/5/6-corner   ≈ PYRAMID  (truncated, reads as a peak)
 * — which is why it, not a per-form generator, is the small-band workhorse.
 *
 * CONCAVITY GUARD: scaling toward the centroid is only shape-preserving for
 * convex-ish rings. On a deep L/U footprint the inset ring can fold through
 * itself, which earcut would happily tessellate into a knot of inside-out
 * triangles. A self-intersecting inset flips or blows up the ring's SIGNED
 * AREA, so we test exactly that (sign must hold, magnitude must shrink) and
 * bail to flat when it fails. Returns true iff geometry was emitted.
 */
function pushInsetPeak(building, pushV, ring, roofY, riseM, insetFrac, col) {
  const n = ring.length;
  if (n < 3) return false;
  const inner = insetRing(ring, insetFrac);
  const a0 = signedArea(ring);
  const a1 = signedArea(inner);
  if (!(Math.abs(a0) > 1e-9)) return false;
  if (Math.sign(a1) !== Math.sign(a0)) return false; // folded through itself
  const shrink = Math.abs(a1) / Math.abs(a0);
  if (!(shrink > 0.02 && shrink < 1)) return false; // degenerate or grew
  const peakY = roofY + riseM;
  for (let e = 0, j = n - 1; e < n; j = e++) {
    const a = ring[j];
    const b = ring[e];
    const ia = inner[j];
    const ib = inner[e];
    const v0 = pushV(a.x, a.y, roofY, col);
    const v1 = pushV(b.x, b.y, roofY, col);
    const v2 = pushV(ib.x, ib.y, peakY, col);
    const v3 = pushV(ia.x, ia.y, peakY, col);
    building.idx.push(v0, v2, v1, v0, v3, v2);
  }
  // cap the inset ring (same winding flip the footprint roof cap uses — MVT
  // exteriors wind CW in y-down tile coords)
  const flat = [];
  for (const p of inner) flat.push(p.x, p.y);
  const tris = earcut(flat);
  if (tris.length === 0) return true; // sides already read as a roof
  const base = building.vtx;
  for (const p of inner) pushV(p.x, p.y, peakY, col);
  for (let t = 0; t < tris.length; t += 3) {
    building.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
  }
  return true;
}

/**
 * Single-pitch SHED roof on a 4-corner ring: one tilted quad plus the two
 * triangular ends that fill the wedge over the sloping side walls. `edgePick`
 * (any integer, hashed by the caller) chooses which edge is raised, so a row
 * of identical warehouses doesn't all lean the same way.
 */
function pushShed(building, pushV, quad, roofY, riseM, col, edgePick) {
  const hi = ((edgePick % 4) + 4) % 4;
  const highY = roofY + riseM;
  const isHigh = (i) => i === hi || i === (hi + 1) % 4;
  const v = [];
  for (let i = 0; i < 4; i++) v.push(pushV(quad[i].x, quad[i].y, isHigh(i) ? highY : roofY, col));
  building.idx.push(v[0], v[1], v[2], v[0], v[2], v[3]); // the tilted plane
  // the two side wedges: high corner up top, both corners of that edge at eave
  const wedge = (hiIdx, loIdx) => {
    const t0 = pushV(quad[hiIdx].x, quad[hiIdx].y, highY, col);
    const t1 = pushV(quad[hiIdx].x, quad[hiIdx].y, roofY, col);
    const t2 = pushV(quad[loIdx].x, quad[loIdx].y, roofY, col);
    building.idx.push(t0, t1, t2);
  };
  wedge((hi + 1) % 4, (hi + 2) % 4);
  wedge(hi, (hi + 3) % 4);
}

/**
 * Stair/lift head-house: ONE centered AABB at `spanFrac` of the short
 * footprint span. Uses the both-diagonals-inside placement test so it never
 * overhangs on an L-shaped roof; returns false (caller falls back) if the
 * footprint can't hold it.
 */
function pushPenthouse(building, pushV, poly, roofY, cfg, mToTile, hash, col) {
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
  const span = Math.min(maxX - minX, maxY - minY);
  const frac = cfg.spanFrac[0] + hash * (cfg.spanFrac[1] - cfg.spanFrac[0]);
  const half = (span * frac) / 2;
  if (half <= 0) return false;
  const c = ringCentroid(ring);
  if (!pointInPoly(poly, c.x - half, c.y - half) || !pointInPoly(poly, c.x + half, c.y + half))
    return false;
  const hM = cfg.hM[0] + hash * (cfg.hM[1] - cfg.hM[0]);
  pushAABBox(building, pushV, c.x, c.y, half, roofY, roofY + hM, col);
  // mToTile is unused for the span-relative size but kept in the signature so
  // every clutter helper reads the same way at the call site.
  void mToTile;
  return true;
}

/** Rooftop water tank: 6-sided prism + a 6-triangle conical cap. */
function pushWaterTank(building, pushV, poly, roofY, rM, hM, mToTile, rand, col) {
  const N = 6;
  const r = rM * mToTile;
  const at = hashPointIn(poly, rand, r);
  if (!at) return false;
  const capY = roofY + hM;
  const apexY = capY + hM * 0.35;
  const px = [];
  const py = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    px.push(at.x + Math.cos(a) * r);
    py.push(at.y + Math.sin(a) * r);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const s0 = pushV(px[i], py[i], roofY, col);
    const s1 = pushV(px[j], py[j], roofY, col);
    const s2 = pushV(px[j], py[j], capY, col);
    const s3 = pushV(px[i], py[i], capY, col);
    building.idx.push(s0, s2, s1, s0, s3, s2);
  }
  const apex = pushV(at.x, at.y, apexY, col);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const c0 = pushV(px[i], py[i], capY, col);
    const c1 = pushV(px[j], py[j], capY, col);
    building.idx.push(c0, c1, apex);
  }
  return true;
}

/** Brick flue near the ridge — the detail that says "house" from 600 m. */
function pushChimney(building, pushV, poly, roofY, topY, halfM, mToTile, rand, col) {
  const half = halfM * mToTile;
  // Bias toward the middle of the roof (that is where a ridge is) by lerping
  // a sampled point 60% of the way back to the centroid, then re-testing.
  const c = ringCentroid(poly.outer);
  const at = hashPointIn(poly, rand, half);
  if (!at) return false;
  const bx = c.x + (at.x - c.x) * 0.4;
  const by = c.y + (at.y - c.y) * 0.4;
  const ok = pointInPoly(poly, bx - half, by - half) && pointInPoly(poly, bx + half, by + half);
  const fx = ok ? bx : at.x;
  const fy = ok ? by : at.y;
  pushAABBox(building, pushV, fx, fy, half, roofY, topY, col);
  return true;
}

/**
 * 4-sided tapered mast — the daylight twin of pushSpire, with NO emissive tip
 * (a plain top cap instead of the neon quad, and 4-arg pushV throughout).
 * `tipCol` is PAINT, not glow: a white-painted mast head is photo-plausible on
 * daylight imagery; an emissive one would need attrs this path doesn't carry.
 */
function pushMastSat(building, pushV, cx, cy, y0, hM, baseRTile, mastCol, tipCol) {
  const tipY = y0 + hM;
  const r = baseRTile;
  const tipR = r * 0.15;
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
    const m0 = pushV(a[0], a[1], y0, mastCol);
    const m1 = pushV(b[0], b[1], y0, mastCol);
    const m2 = pushV(tb[0], tb[1], tipY, mastCol);
    const m3 = pushV(ta[0], ta[1], tipY, mastCol);
    building.idx.push(m0, m2, m1, m0, m3, m2);
  }
  const q0 = pushV(top[0][0], top[0][1], tipY, tipCol);
  const q1 = pushV(top[1][0], top[1][1], tipY, tipCol);
  const q2 = pushV(top[2][0], top[2][1], tipY, tipCol);
  const q3 = pushV(top[3][0], top[3][1], tipY, tipCol);
  building.idx.push(q0, q2, q1, q0, q3, q2);
  return tipY;
}

/** 2–4 masts at hashed points — the antenna farm on a 45–120 m roof. */
function pushAntennaFarmSat(building, pushV, poly, roofY, cfg, mToTile, rand, col) {
  const [lo, hi] = cfg.antennaCount;
  const want = lo + ((rand() * (hi - lo + 1)) | 0);
  let placed = 0;
  for (let i = 0; i < want; i++) {
    const rM = cfg.antenna.baseRM[0] + rand() * (cfg.antenna.baseRM[1] - cfg.antenna.baseRM[0]);
    const rTile = rM * mToTile;
    const at = hashPointIn(poly, rand, rTile);
    if (!at) continue;
    const hM = cfg.antenna.hM[0] + rand() * (cfg.antenna.hM[1] - cfg.antenna.hM[0]);
    pushMastSat(building, pushV, at.x, at.y, roofY, hM, rTile, col, col);
    placed += 1;
  }
  return placed;
}

/**
 * Supertall CROWN: two stacked setback steps ABOVE the roofline. Note this is
 * NOT the toy pushCrown geometry — that draws an inset band just UNDER the
 * roofline, which only reads because it is emissive; on the satellite path an
 * inset band below the cap is buried inside the solid wall box and invisible.
 * Stepping UP is what makes a tower top read as a crown in daylight.
 */
function pushCrownSat(building, pushV, ring, roofY, stepM, stepInset, col) {
  let y = roofY;
  let cur = ring;
  let any = false;
  for (let s = 0; s < stepM.length; s++) {
    const inner = insetRing(cur, stepInset[s]);
    const a0 = signedArea(cur);
    const a1 = signedArea(inner);
    if (!(Math.abs(a0) > 1e-9) || Math.sign(a1) !== Math.sign(a0)) break;
    const shrink = Math.abs(a1) / Math.abs(a0);
    if (!(shrink > 0.05 && shrink < 1)) break;
    const y1 = y + stepM[s];
    const n = inner.length;
    for (let e = 0, j = n - 1; e < n; j = e++) {
      const a = inner[j];
      const b = inner[e];
      const v0 = pushV(a.x, a.y, y, col);
      const v1 = pushV(b.x, b.y, y, col);
      const v2 = pushV(b.x, b.y, y1, col);
      const v3 = pushV(a.x, a.y, y1, col);
      building.idx.push(v0, v2, v1, v0, v3, v2);
    }
    const flat = [];
    for (const p of inner) flat.push(p.x, p.y);
    const tris = earcut(flat);
    const base = building.vtx;
    for (const p of inner) pushV(p.x, p.y, y1, col);
    for (let t = 0; t < tris.length; t += 3) {
      building.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
    }
    y = y1;
    cur = inner;
    any = true;
  }
  return any;
}

/** Supertall SPIRE: a scaled-up mast with a white-PAINTED (not lit) tip. */
function pushSpireSat(building, pushV, ring, roofY, spireHM, baseRM, mToTile, mastCol, tipCol) {
  const c = ringCentroid(ring);
  return pushMastSat(
    building,
    pushV,
    c.x,
    c.y,
    roofY,
    spireHM,
    baseRM * mToTile,
    mastCol,
    tipCol
  );
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

// --- Round 13 Phase 3: lean SATELLITE building extrusion (buildings only) ----
// The 'sat-buildings' detail path: extrude OpenFreeMap building footprints for
// the DAYLIGHT satellite world. Reuses the toy tessellation + roof helpers but
// bakes NEUTRAL daylight tones into vertex colors (no neon), and carries ONLY
// position/color/index + a per-vertex footprint-ANCHOR (feeds both the rigid
// anchor-bend and the RAW-DEM ground drape). NO facade/edge/beacon neon
// attributes, NO emissive crowns/spires/beacons, NO contact skirt (those are
// night-city only). One merged transferable per tile → one draw per chunk. The
// toy `building` block (detail full/mid) is UNTOUCHED — byte-identical toy.
//
// Round 15: the R13 output read as one gray slab from the air — roofs were the
// wall tone × 0.82 and walls had six near-identical concrete tones. Now (a) a
// dedicated height-banded ROOF palette on its own hash seed, (b) fake AO baked
// into the existing wall verts (dark base, lifted roofline), and (c) a `uv`
// array in FACADE METERS so the engine's window atlas tiles at real window
// scale. Roof + roof-detail verts carry the constant NEUTRAL_UV (a solid-white
// pier crossing in the atlas, sampled at mip 0 because a constant uv has zero
// derivative) → the texture leaves roofs exactly as the palette painted them.
function buildSatBuildings(vt, frame) {
  const { tileSpan, mercX0, mercYTop, cx, cz, k, t0 } = frame;
  const out = { empty: true, tessMs: 0, v: WORKER_PROTOCOL };
  const layer = vt.layers.building;
  if (!layer) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — the tile PARSED, it just carries no `building` layer. Not
    // the same fact as a 404 (this ground has data, it has no buildings).
    return withReason(out, 'zero');
  }
  const scale = tileSpan / layer.extent;
  const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
  const B = TOY_WORLD.buildings;
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT; // round 18 — the one-line revert flag for THIS whole path
  const mToTile = 1 / scale;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // Round 18 tone resolver. The re-tune rides the SAME flag as the geometry so
  // ROOFS_SAT.enabled:false restores pre-R18 PIXELS, not just pre-R18 shapes.
  // The legacy arrays are frozen historical data in ROOFS_SAT.legacyTone —
  // duplicated on purpose so the revert never depends on retyping a comment.
  const TONE = RS.enabled
    ? { wallTones: S.wallTones, wallBaseMul: S.wallBaseMul, roofMid: S.roofTones.mid, roofTall: S.roofTones.tall }
    : {
        wallTones: RS.legacyTone.wallTones,
        wallBaseMul: RS.legacyTone.wallBaseMul,
        roofMid: RS.legacyTone.roofMid,
        roofTall: RS.legacyTone.roofTall,
      };
  // Round 18 coverage fix — see classifyRingsSat. Behind the SAME flag as
  // everything else on this path, so enabled:false still reproduces pre-R18
  // pixels exactly (including the 18-of-1481 Manhattan behaviour).
  const classify = RS.enabled ? classifyRingsSat : classifyRings;
  const PC = SAT_POLY_COVER; // round 20 (A) — the per-POLYGON coverage flag

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
    const polys = classify(rings.filter((r) => r.length >= 3));
    if (polys.length === 0) continue;
    let minY = f.properties.render_min_height ?? 0;
    if (minY < 0) minY = 0;
    const fid = typeof f.id === 'number' ? f.id : i;
    // --- ROUND 20 (A SPRAWL) — THE SATELLITE HALF OF R19-F's MULTIPOLYGON FIX
    // R19 (F) fixed this for toy only (see the toy coverage block in buildTile;
    // its flag is deliberately NOT NAMED anywhere on this path — see below).
    // Satellite carried BOTH halves of the same defect verbatim:
    //   (1) `maxFootprintM2` — meant to reject ONE merged mega-ring — was
    //       tested against the SUM of every polygon in the feature. Measured
    //       on the live tileset, 14/4411/6193 Powell OH ships ONE feature
    //       carrying 171 house polygons that sum to ~240 000 m²: the whole
    //       subdivision tripped the 60 000 m² test and was discarded as a
    //       "district". Powell rendered 11 buildings over a 3x3.
    //   (2) every polygon of a feature shared polys[0]'s centroid anchor, and
    //       the anchor IS the drape group (sat-building-engine samples the DEM
    //       once per anchor RUN) — so those 171 houses would have stood on one
    //       hillside's ground height, floating and buried by turns.
    // Under the flag a feature EXPLODES into one item per polygon, which makes
    // the footprint test per-BUILDING (its documented intent), the chunk cap a
    // POLYGON cap (the influx is per-polygon, so a per-feature cap cannot
    // contain it) and — free, because an item is now one polygon — the drape
    // anchor per-building. Everything downstream (typology, house inference,
    // roof dispatch, housePts) already operates per ITEM, so it all becomes
    // per-building at the same time.
    //
    // This path must not name the toy coverage flag AT ALL — verify-neon-cover
    // gate 4a greps each satellite builder's body (comments included, which is
    // how it caught the first draft of this very comment) and fails the build
    // on a mention. That is exactly why SAT_POLY_COVER is a separate block:
    // "satellite does not read the toy flag" is enforced on the source text,
    // not on trust.
    if (PC.enabled) {
      const aScale = 0.5 * scale * scale;
      for (let pi = 0; pi < polys.length; pi++) {
        const p = polys[pi];
        const a = Math.abs(signedArea(p.outer));
        const aM2 = a * aScale;
        if (aM2 < PC.minAreaM2) continue; // sliver guard — the explosion's only new floor
        if (aM2 > PC.maxFootprintM2) continue; // now a real merged mega-block, not a subdivision
        // Per-polygon id: deterministic (no RNG), decorrelated from feature
        // order so the hash-driven tone/height jitter and the stratified
        // shuffle below both spread over the whole tile. Same construction as
        // the toy path's pid.
        const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
        const it = { polys: [p], area: a, areaM2: aM2, rawH, minY, id: pid };
        // perPolyDrape:false is the A/B ISOLATION CONTROL, not a shipped mode:
        // it keeps the new coverage while restoring the legacy one-anchor-per-
        // FEATURE drape, so a reviewer can attribute a change to coverage or
        // to drape without rebuilding. Shipped value is true.
        if (!PC.perPolyDrape && pi > 0) it.anchorPoly = polys[0];
        items.push(it);
      }
      continue;
    }
    let area = 0;
    for (const p of polys) area += Math.abs(signedArea(p.outer));
    const areaM2 = area * 0.5 * scale * scale; // mercator m² (ratio-safe)
    if (areaM2 > B.maxFootprintM2) continue; // merged mega-blocks stay flat ground
    items.push({ polys, area, areaM2, rawH, minY, id: fid });
  }
  // Round 20 (C2): punch the marquee monument holes BEFORE anything reads the
  // population — the typology guard, the house inference and the chunk cap all
  // treat `items` as "the buildings of this tile", and a monument that is about
  // to be replaced by a real model is not one of them.
  const marqueeEx = marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k);
  if (marqueeEx) dropMarqueeFootprints(items, marqueeEx);
  if (items.length === 0) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — every footprint was rejected (mega-block guard, per-poly
    // area floor, marquee exclusion). A decision, not a data outage.
    return withReason(out, 'zero');
  }

  // --- Round 19 (A "HOMESTEAD") — THE SUBURBAN-CONTEXT GUARD ----------------
  // The field study's P1: Powell OH rendered ~25 identical 8-12 storey slabs
  // over cul-de-sacs, office windows blazing at night. Mechanism: an untagged
  // footprint past ROOFS_SAT.houseInfer.maxAreaM2 (220) fell into the bare
  // sqrt-area curve below, which was authored for untagged COMMERCIAL lots —
  // fed a 1,200 m² school it returns 9 + 34.6*0.5 ~ 26 m, and a 5,000 m² big
  // box saturates its own clamp at 42 m. Every large suburban footprint came
  // out a mid-rise.
  //
  // The fix is typology-aware (below), but it must NEVER fire over a real
  // downtown: inventing a 12 m warehouse where a 90 m tower stands is a worse
  // defect than the one being fixed. So the whole thing is gated on this
  // guard, computed ONCE per tile over the already-filtered footprint set.
  // Two independent locks, both must hold:
  //   (1) fewer than context.maxTallTagged footprints carry a MAPPED height
  //       >= context.tallM. rawH is 0 for untagged (the OMT synth-5 trap is
  //       already normalised above), so this counts real data only.
  //   (2) footprint cover under context.maxFootprintCover — the toy district
  //       idiom. Catches generalised cores that ship no heights at all.
  // Anything else keeps the legacy curve VERBATIM.
  //
  // Requires ROOFS_SAT.enabled as well: typology is an EXTENSION of the R18
  // inference path, and ROOFS_SAT.enabled:false must still reproduce the R15
  // build exactly. With ROOF_TYPOLOGY.enabled:false `suburbanCtx` is false at
  // every site below, so the flag is a byte-noop.
  const TY = ROOF_TYPOLOGY;
  let suburbanCtx = false;
  if (TY.enabled && RS.enabled) {
    const C = TY.context;
    let tallTagged = 0;
    let coverM2 = 0;
    for (const it of items) {
      if (it.rawH >= C.tallM) tallTagged += 1;
      coverM2 += it.areaM2;
    }
    // Tile area in the SAME mercator m² the footprints are measured in, so
    // the ratio is latitude-independent (areaM2 = tileUnits * scale²).
    const tileAreaM2 = (layer.extent * scale) ** 2;
    suburbanCtx = tallTagged < C.maxTallTagged && coverM2 / tileAreaM2 < C.maxFootprintCover;
  }
  /**
   * First-match-wins typology band for an UNTAGGED footprint. Returns null
   * when typology is off/downtown (the caller then runs the legacy curve).
   * `aspectMin` promotes an elongated mid-size footprint to 'strip'.
   *
   * Aspect is the AXIS-ALIGNED bbox ratio in TILE units. Mercator is
   * conformal, so the local x and y scales are equal and the raw ratio IS the
   * true ground ratio — no k correction needed. It does under-report a strip
   * mall that runs diagonally (its bbox is near-square); that case falls to
   * 'school' (7-12 m) instead of 'strip' (6-8 m), which is a 1-4 m error in
   * the conservative direction and not worth an oriented-bbox solve here.
   */
  const pickTypology = (it) => {
    if (!suburbanCtx) return null;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const p of it.polys[0].outer) {
      if (p.x < bx0) bx0 = p.x;
      if (p.y < by0) by0 = p.y;
      if (p.x > bx1) bx1 = p.x;
      if (p.y > by1) by1 = p.y;
    }
    const w = Math.max(1e-6, bx1 - bx0);
    const d = Math.max(1e-6, by1 - by0);
    const aspect = Math.max(w, d) / Math.min(w, d);
    for (const b of TY.bands) {
      if (it.areaM2 > b.maxAreaM2) continue;
      if (b.aspectMin && aspect < b.aspectMin) continue;
      return b;
    }
    return null;
  };

  // Pass 2: display height — real height, else a neutral area-based inference
  // (small footprint → house, big lot → mid-rise), then the toy soft-knee so
  // supertalls read AS supertalls without a hard clamp.
  const built = [];
  for (const it of items) {
    const hash = (((it.id * 2654435761) >>> 0) % 4096) / 4096;
    let h = it.rawH;
    // Round 18 (A1) — HOUSE HEIGHT INFERENCE. The √area curve was authored for
    // untagged commercial lots; fed a 150 m² suburban house it returned
    // 9 + 12.2·0.5 ≈ 15 m, i.e. a five-storey block where a bungalow stands.
    // Whole American suburbs came out as mid-rise carpet. Footprints under
    // houseInfer.maxAreaM2 now read as 1–2-storey houses over a hash-spread
    // band, which ALSO lands them inside the small-band roof dispatch below
    // (h < ROOFS_SAT.small.maxH) — that is where the gable/hip carpet comes
    // from. Bigger untagged footprints keep the legacy curve untouched.
    let inferredHouse = false;
    // Round 19 (A HOMESTEAD): the typology band this footprint took, or null.
    // Carried onto the item because THREE later sites read it — the roof
    // palette band, the NEUTRAL_UV wall contract, and the housePts emission.
    let typo = null;
    if (h <= 0) {
      if (RS.enabled && it.areaM2 <= RS.houseInfer.maxAreaM2) {
        const hb = RS.houseInfer.hM;
        h = hb[0] + hash * (hb[1] - hb[0]);
        inferredHouse = true;
      } else if ((typo = pickTypology(it))) {
        // Round 19 — TYPOLOGY INFERENCE (suburban context only; pickTypology
        // returns null everywhere else, so the legacy curve below is
        // untouched byte-for-byte over every downtown).
        h = typo.hM[0] + hash * (typo.hM[1] - typo.hM[0]);
      } else {
        h = clamp(9 + Math.sqrt(it.areaM2) * 0.5, S.minH, 42) * (0.85 + hash * 0.3);
      }
    }
    // The S.minH (6 m) floor exists so a mapped 2 m shed isn't a decal; a
    // DELIBERATELY inferred 5 m house must not be dragged up by it (that would
    // compress the [5,8] band to [6,8] and undo half the fix). Round 19: the
    // typology bands are authored as ABSOLUTE metre bands for the same reason
    // — every one of them starts at or above S.minH today, so this is an
    // identity right now, but a future tune down to 5 m must not be silently
    // clamped back up.
    if (!inferredHouse && !typo) h = Math.max(h, S.minH);
    if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope;
    h = Math.min(h, B.maxH);
    it.h = h;
    it.hash = hash;
    it.typo = typo; // round 19: null unless typology fired (suburban context)
    it.inferredHouse = inferredHouse;
    it.elevated = it.minY > 1 && it.minY < h - 3;
    built.push(it);
  }
  // Round 18 (A1) — THE SUBURB FIX (the round's headline bug). R13-R17 sorted
  // by footprint AREA and sliced the top maxPerChunk: over a suburban z14 tile
  // with several thousand footprints, the 500 "largest" are the strip malls,
  // big-box stores and schools — the house carpet that IS a suburb was dropped
  // WHOLESALE, every frame, everywhere. Naperville rendered as eight retail
  // sheds in a field.
  //
  // Volume-stratified selection instead: keep the top `anchorCount` by
  // areaM2 × h (the true skyline anchors — a 200 m tower on a small plate must
  // never be culled by a supermarket), then fill the remaining budget by
  // sampling the REMAINDER over a HASH-SHUFFLED order. The shuffle matters:
  // MVT feature order is spatially clustered, so striding the raw array keeps
  // one CORNER of the tile and leaves the rest bare. Hashing the stable feature
  // id first decorrelates position from order; the fractional stride then draws
  // an even sample of exactly `room` footprints. Fully deterministic, RNG-free
  // — the same tile builds the same city in every session.
  //
  // Round 20 (A): under SAT_POLY_COVER the budget is a POLYGON cap. It has the
  // same value as the feature cap it replaces (500) on purpose — the selection
  // shape is what makes the explosion safe, not a bigger number: before the
  // flag a kept ITEM emitted EVERY polygon of its feature, so 500 features
  // could be thousands of polygons; after it, 500 is 500.
  let selected;
  const capN = PC.enabled ? PC.maxPerChunk : S.maxPerChunk;
  if (RS.enabled) {
    const ranked = built.slice().sort((a, b) => b.areaM2 * b.h - a.areaM2 * a.h);
    const anchors = ranked.slice(0, RS.select.anchorCount);
    const rest = ranked.slice(RS.select.anchorCount);
    const room = Math.max(0, capN - anchors.length);
    if (rest.length <= room) {
      selected = anchors.concat(rest);
    } else {
      rest.sort((a, b) => ((Math.imul(a.id, 2654435761) >>> 0) - (Math.imul(b.id, 2654435761) >>> 0)));
      const step = rest.length / room; // ≥ 1 ⇒ floor() is strictly increasing ⇒ no dupes
      const fill = [];
      for (let i = 0; i < room; i++) fill.push(rest[Math.floor(i * step)]);
      selected = anchors.concat(fill);
    }
  } else {
    built.sort((a, b) => b.area - a.area); // keep the biggest footprints under the cap
    selected = built.slice(0, capN);
  }

  const satB = { pos: [], col: [], idx: [], anchor: [], uv: [], vtx: 0 };
  // Round 19 (A HOMESTEAD): [x,z] anchors of inferred small-band houses —
  // C GROUNDTRUTH's SUBURB_NIGHT house lights. Bounded by
  // SAT_BUILDINGS.maxPerChunk (500) ⇒ <= 4 KB per tile.
  const housePts = [];
  // Round 19 typology telemetry (verify-suburbia reads these through
  // SatBuildingEngine.meta): how many footprints this tile invented a
  // TYPOLOGY height for, the tallest height it invented by ANY inference
  // path, and whether the suburban-context guard armed at all.
  let nTypo = 0;
  let inferMaxH = 0;
  const typoForms = { house: 0, strip: 0, school: 0, bigbox: 0, warehouse: 0 };
  let nParapet = 0;
  let nHvac = 0;
  let nGable = 0;
  // Round 18: per-chunk caps + form telemetry. `forms` is what
  // verify-roof-variety reads to prove the dispatch actually produces variety
  // (≥ 4 distinct forms with nonzero counts, flat-only share ≤ 5%).
  let nSmallForm = 0;
  let nClutter = 0;
  let nChimney = 0;
  let smallKept = 0;
  const forms = {
    gable: 0,
    hip: 0,
    shed: 0,
    pyramid: 0,
    mansard: 0,
    parapet: 0,
    penthouse: 0,
    tank: 0,
    hvac: 0,
    chimney: 0,
    antenna: 0,
    crown: 0,
    spire: 0,
    flat: 0, // buildings that ended the dispatch with NO treatment at all
  };
  const hvacCol = hexToRGB(S.hvacTone).map((c) => c * S.hvacGain); // galvanized clutter
  // Round 18 clutter/treatment tones (constant per chunk — hoisted out of the
  // per-building loop). All plain daylight materials: brick, timber, painted
  // steel, galvanized. Nothing here is ever emissive.
  const chimneyCol = hexToRGB(RS.small.chimney.tone);
  const tankCol = hexToRGB(RS.mid.tankTone);
  const penthouseCol = hexToRGB(RS.mid.penthouse.tone);
  const mastCol = hexToRGB(RS.tall.antenna.tone);
  const spireCol = hexToRGB(RS.super.spire.tone);
  const spireTipCol = hexToRGB(RS.super.spire.tipTone);
  const RT = S.roofTones;
  const F = S.facade;
  // Facade-meter UV periods + the tile→TRUE-meter scale (horizontal tile units
  // are mercator-stretched by k; heights are already true meters).
  const uPeriod = F.cols * F.colPitchM;
  const vPeriod = F.rows * F.floorHM;
  const mTrue = scale / k;
  const NEUTRAL_UV = F.neutralUV; // roof/detail verts: the atlas pier crossing
  // ± jitter so two neighbours that hash to the SAME palette entry still differ.
  const jit = (amt, h) => 1 + (h - 0.5) * 2 * amt;
  for (const item of selected) {
    const hash2 = (((Math.imul(item.id, 2246822519) + 374761393) >>> 0) % 4096) / 4096;
    // Suburb telemetry: how much of what we KEPT is small-footprint. Under the
    // R15 sort-by-area + slice this collapsed toward 0 over any dense suburb —
    // which is exactly the bug. verify-roof-variety gates the ratio at ≥ 0.4
    // over Naperville. (Counted for every kept building, roofDetail or not.)
    if (item.areaM2 < RS.small.maxAreaM2) smallKept += 1;
    // Round 19: inference telemetry over the buildings actually EXTRUDED.
    // inferMaxH spans EVERY inference path (houseInfer, typology, and the
    // legacy sqrt-area curve) because the gate it feeds — "zero untagged
    // building over 14 m in a suburban-context chunk" — is a claim about
    // invented heights as a whole, not about the new code path alone. A
    // suburban chunk that still routes something to the legacy curve would
    // fail LOUDLY here rather than hide behind the typology counter.
    if (item.rawH <= 0) {
      if (item.h > inferMaxH) inferMaxH = item.h;
      if (item.typo) {
        nTypo += 1;
        typoForms[item.typo.form] += 1;
      }
    }
    const wall = hexToRGB(pickByHash(TONE.wallTones, item.id)).map((c) => c * jit(S.wallJitter, hash2));
    // Fake AO, zero extra verts: bottom ring dark (ground grime), top ring lifted
    // (sky bounce). Towers ease toward the weak end — a full-height ramp on a
    // 200m box reads as a gradient, not as contact shading.
    const aoT = clamp(item.h / S.wallBaseRefM, 0, 1);
    const baseMul = TONE.wallBaseMul[0] + (TONE.wallBaseMul[1] - TONE.wallBaseMul[0]) * aoT;
    const wallBase = wall.map((c) => c * baseMul);
    const wallTop = wall.map((c) => c * S.wallTopGain);
    // Roofs own their palette (own hash seed → decorrelated from the wall pick),
    // banded by height: houses = shingle/terracotta, mid = tar/gravel, tall = membrane.
    // Round 19: a typology-inferred building picks its roof palette by BAND
    // HINT, not by height. Every typology band now lands 6-14 m, i.e. under
    // roofTones.lowMaxH (16) — so without this a big-box store and a
    // warehouse would both wear the HOUSE palette and the suburb would grow
    // terracotta Walmarts. The palettes themselves are R15/R18 checkpointed
    // values and are untouched; only the selection moves, and only for
    // buildings whose height this round invented.
    const tyRoof = item.typo?.roofBand;
    const band =
      tyRoof === 'mid'
        ? TONE.roofMid
        : item.h <= RT.lowMaxH
          ? RT.low
          : item.h >= RT.tallMinH
            ? TONE.roofTall
            : TONE.roofMid;
    const roofCol = hexToRGB(pickByHash(band, (item.id ^ 0x5bf03635) >>> 0)).map(
      (c) => c * jit(S.roofJitter, item.hash)
    );
    const parapetCol = roofCol.map((c) => c * S.parapetGain); // the lip catches sun
    const outer = item.polys[0].outer;
    // Round 20 (A): with the explosion an item IS one polygon, so this centroid
    // is the BUILDING's — which is the whole of defect (2). item.anchorPoly is
    // only ever set by the perPolyDrape:false control (see pass 1).
    const anchorRing = (item.anchorPoly ?? item.polys[0]).outer;
    let axT = 0;
    let ayT = 0;
    for (const p of anchorRing) {
      axT += p.x;
      ayT += p.y;
    }
    const cxT = axT / anchorRing.length;
    const cyT = ayT / anchorRing.length;
    const [anchorX, anchorZ] = toLocal(cxT, cyT); // one draped ground → level building
    // Walls extrude from -baseSink (tucked BELOW ground so slope/hill gaps hide)
    // up to roofY = h; the engine adds the raw-DEM ground at the anchor.
    const wallBottomY = item.elevated ? item.minY : -S.baseSinkM;
    const roofY = item.h;
    // uv defaults to NEUTRAL (the atlas pier crossing) — every shared roof helper
    // (pushGable/pushParapet/pushHvacBoxes→pushAABBox) calls this with exactly
    // FOUR args, so roof + detail geometry is window-free by construction. Only
    // the wall loop below passes u/v. (pushCrown/pushSpire pass extra NEON args
    // in slots 5-7 and are deliberately NOT used on this path.)
    const pushV = (px, py, y, colArr, u, v) => {
      const [lx, lz] = toLocal(px, py);
      satB.pos.push(lx, y, lz);
      satB.col.push(colArr[0], colArr[1], colArr[2]);
      satB.anchor.push(anchorX, anchorZ);
      satB.uv.push(u === undefined ? NEUTRAL_UV : u, v === undefined ? NEUTRAL_UV : v);
      return satB.vtx++;
    };
    // --- Round 19 (A HOMESTEAD) — WINDOW-FREE INFERRED-SUBURBAN WALLS ------
    // The other half of the field study's P1. Walls on this path ALWAYS
    // carried facade-meter uv, so the R15 window atlas (and, at night, the
    // emissiveMap) painted an office curtain wall onto every extruded box.
    // On a school, a strip mall or a big-box store whose height we INVENTED,
    // that is two guesses stacked: a wrong height wearing wrong windows, lit
    // up at night over a dark suburb.
    //
    // Passing u/v as `undefined` makes pushV write NEUTRAL_UV — the exact
    // window-free contract every R18 roof helper already uses (a constant uv
    // has zero screen-space derivative, so it samples mip 0 at the atlas'
    // solid-white pier crossing at every distance). So the fix costs no
    // geometry, no branch in the shader and no second material: a typology
    // building is simply mute where a mapped building speaks.
    //
    // Only TYPOLOGY-inferred buildings go mute. A mapped 30 m office keeps
    // its windows, and so does the <=220 m² houseInfer band (those are 5-8 m
    // houses whose two rows of windows read correctly and were certified in
    // R18). neutralWall is false for every pre-R19 case ⇒ byte-noop.
    const neutralWall = !!item.typo && TY.neutralWalls;
    // v = height above the ANCHOR GROUND (y=0), so floors line up building to
    // building; the sunk base just runs negative (it is underground anyway).
    const vBot = neutralWall ? undefined : wallBottomY / vPeriod;
    const vTop = neutralWall ? undefined : roofY / vPeriod;
    // Round 19 — C GROUNDTRUTH's night house-light anchors (see the bundle
    // contract at the emission below). Collected here because this is where
    // the footprint centroid is already in hand, and only for buildings that
    // are actually EXTRUDED, so a light can never float over a culled house.
    // The population is the SMALL BAND — exactly the buildings this dispatch
    // already draws with a house-shaped roof (gable/hip/shed/pyramid). That
    // makes the light and the roof under it agree by construction, and it is
    // strictly better than "inferred only": a MAPPED 8 m / 300 m² building is
    // more certainly a house than one whose height we guessed. Measured, the
    // inferred-only reading gave 0 anchors over Powell and 1 over Columbus.
    if (item.h < RS.small.maxH && item.areaM2 < RS.small.maxAreaM2) {
      housePts.push(anchorX, anchorZ);
    }
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
      // walls: independent quads (crisp per-face normals), DoubleSide material.
      // u is CENTERED on each wall (±half its true-meter run / uPeriod) so both
      // corners cut the window grid symmetrically — an edge-anchored run leaves
      // one corner with a sliver pane (the R8 "columns centered per facade" read).
      for (const ring of [poly.outer, ...poly.holes]) {
        for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
          const a = ring[j];
          const b = ring[e];
          const halfU =
            Math.hypot((b.x - a.x) * mTrue, (b.y - a.y) * mTrue) / (2 * uPeriod);
          const uA = neutralWall ? undefined : 0.5 - halfU;
          const uB = neutralWall ? undefined : 0.5 + halfU;
          const i0 = pushV(a.x, a.y, wallBottomY, wallBase, uA, vBot);
          const i1 = pushV(b.x, b.y, wallBottomY, wallBase, uB, vBot);
          const i2 = pushV(b.x, b.y, roofY, wallTop, uB, vTop);
          const i3 = pushV(a.x, a.y, roofY, wallTop, uA, vTop);
          satB.idx.push(i0, i2, i1, i0, i3, i2);
        }
      }
    }
    // ---- Round 18 (A1) SATELLITE ROOF DISPATCH -----------------------------
    // Replaces the R15 three-way (gable | parapet | HVAC). That dispatch left
    // the city almost roofless in practice: a gable needed an EXACT 4-corner
    // ring AND h < 16 AND area < 400 m² (most houses failed at least one), a
    // parapet needed h ≥ 18 AND area ≥ 250, so NOTHING happened between 16 and
    // 18 m, nothing above 120 m (crowns/spires were toy-only), and there was
    // no rooftop clutter of any kind. Bands below are height-ordered, first
    // match wins on FORM, and clutter is additive + capped. Every knob is in
    // ROOFS_SAT; the whole block is skipped (and the R15 code runs verbatim
    // below) when ROOFS_SAT.enabled is false.
    if (S.roofDetail && RS.enabled) {
      const simp = simplifyRing(outer, RS.simplifyTolTile);
      const nC = simp.length;
      const h = item.h;
      const poly0 = item.polys[0];
      // Own RNG stream per building, seeded off the stable feature id: the same
      // rooftop gets the same clutter in every session, and it can't be
      // perturbed by how many buildings were drawn before it.
      const rand = mulberry32((Math.imul(item.id, 2654435761) ^ 0x9e3779b9) >>> 0);
      const rise = RS.small.riseM[0] + item.hash * (RS.small.riseM[1] - RS.small.riseM[0]);
      const MID_MAX = RT.tallMinH; // 45 — the band edge the roof palette already uses
      const SUPER_MIN = RS.super.minH; // 120
      let treated = false;

      if (h < RS.small.maxH && item.areaM2 < RS.small.maxAreaM2) {
        // --- SMALL BAND: houses + low commercial. This is the band the suburb
        // fix feeds, and it is where "a real city from the air" is won or lost.
        if (nSmallForm < RS.caps.smallForm) {
          if (nC === 4) {
            if (item.hash < RS.small.gableFrac) {
              pushGable(satB, pushV, simp, roofY, rise, roofCol);
              forms.gable += 1;
              nGable += 1;
              treated = true;
            } else if (item.hash < RS.small.hipFrac) {
              if (pushInsetPeak(satB, pushV, simp, roofY, rise, RS.small.hipInsetFrac, roofCol)) {
                forms.hip += 1;
                treated = true;
              }
            } else {
              pushShed(satB, pushV, simp, roofY, rise, roofCol, item.id >>> 3);
              forms.shed += 1;
              treated = true;
            }
          } else if (nC === 3 || nC === 5 || nC === 6) {
            if (pushInsetPeak(satB, pushV, simp, roofY, rise, RS.small.pyramidInsetFrac, roofCol)) {
              forms.pyramid += 1;
              treated = true;
            }
          }
          if (treated) nSmallForm += 1;
        }
        // A chimney rides a pitched roof at chimneyFrac; a >6-corner ring stays
        // flat by design (no believable single pitch) but always earns one, so
        // the complex footprints are not the bare patch in a suburb.
        const wantChimney = nC > 6 || (treated && hash2 < RS.small.chimneyFrac);
        if (wantChimney && nChimney < RS.caps.chimney) {
          const cc = RS.small.chimney;
          const top =
            roofY + (treated ? rise : 0) + cc.riseM[0] + item.hash * (cc.riseM[1] - cc.riseM[0]);
          if (pushChimney(satB, pushV, poly0, roofY, top, cc.halfM, mToTile, rand, chimneyCol)) {
            nChimney += 1;
            forms.chimney += 1;
            treated = true;
          }
        }
      } else if (h < MID_MAX) {
        // --- MID BAND 16–45 m: parapet OR mansard, then ONE clutter pick.
        // Mansard and parapet are mutually exclusive on purpose — a real
        // mansard IS the building's lip; ringing one with a parapet reads as
        // two hats.
        let mansard = false;
        if (
          nC === 4 &&
          h < RS.mid.mansardMaxH &&
          item.hash < RS.mid.mansardFrac &&
          nSmallForm < RS.caps.smallForm
        ) {
          if (pushInsetPeak(satB, pushV, simp, roofY, rise, RS.mid.mansardInsetFrac, roofCol)) {
            nSmallForm += 1;
            forms.mansard += 1;
            mansard = true;
            treated = true;
          }
        }
        if (!mansard && item.areaM2 >= RS.mid.parapetMinAreaM2 && nParapet < RS.caps.parapet) {
          pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
          nParapet += 1;
          forms.parapet += 1;
          treated = true;
        }
        if (nClutter < RS.caps.clutter) {
          if (hash2 < RS.mid.penthouseFrac) {
            if (pushPenthouse(satB, pushV, poly0, roofY, RS.mid.penthouse, mToTile, item.hash, penthouseCol)) {
              nClutter += 1;
              forms.penthouse += 1;
              treated = true;
            }
          } else if (hash2 < RS.mid.tankFrac && item.areaM2 >= RS.mid.tankMinAreaM2) {
            const rM = RS.mid.tankRM[0] + item.hash * (RS.mid.tankRM[1] - RS.mid.tankRM[0]);
            const tH = RS.mid.tankHM[0] + item.hash * (RS.mid.tankHM[1] - RS.mid.tankHM[0]);
            if (pushWaterTank(satB, pushV, poly0, roofY, rM, tH, mToTile, rand, tankCol)) {
              nClutter += 1;
              forms.tank += 1;
              treated = true;
            }
          } else if (pushHvacBoxes(satB, pushV, poly0, roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0) {
            nHvac += 1;
            nClutter += 1;
            forms.hvac += 1;
            treated = true;
          }
        }
      } else if (h < SUPER_MIN) {
        // --- TALL BAND 45–120 m: parapet + penthouse-or-HVAC + antenna farms.
        if (item.areaM2 >= RS.mid.parapetMinAreaM2 && nParapet < RS.caps.parapet) {
          pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
          nParapet += 1;
          forms.parapet += 1;
          treated = true;
        }
        if (nClutter < RS.caps.clutter) {
          if (hash2 < RS.mid.penthouseFrac) {
            if (pushPenthouse(satB, pushV, poly0, roofY, RS.mid.penthouse, mToTile, item.hash, penthouseCol)) {
              nClutter += 1;
              forms.penthouse += 1;
              treated = true;
            }
          } else if (pushHvacBoxes(satB, pushV, poly0, roofY, ROOFS.hvac, mToTile, rand, hvacCol) > 0) {
            nHvac += 1;
            nClutter += 1;
            forms.hvac += 1;
            treated = true;
          }
        }
        if (item.hash < RS.tall.antennaFrac && nClutter < RS.caps.clutter) {
          if (pushAntennaFarmSat(satB, pushV, poly0, roofY, RS.tall, mToTile, rand, mastCol) > 0) {
            nClutter += 1;
            forms.antenna += 1;
            treated = true;
          }
        }
      } else {
        // --- SUPERTALL ≥ 120 m: the skyline read. Geometry only — a photo-
        // plausible stone/mechanical crown or a painted mast. NO emissive:
        // night windows ride the NEUTRAL_UV texel and an emissive vert here
        // would need the neon attrs this path deliberately does not carry.
        if (item.hash < RS.super.crownFrac) {
          const crownCol = roofCol.map((c) => c * RS.super.crownGain);
          if (pushCrownSat(satB, pushV, outer, roofY, RS.super.crownStepM, RS.super.crownStepInset, crownCol)) {
            forms.crown += 1;
            treated = true;
          }
        } else {
          const sp = RS.super.spire;
          const spireH = h * (sp.hFrac[0] + item.hash * (sp.hFrac[1] - sp.hFrac[0]));
          pushSpireSat(satB, pushV, outer, roofY, spireH, sp.baseRM, mToTile, spireCol, spireTipCol);
          forms.spire += 1;
          treated = true;
        }
        if (nParapet < RS.caps.parapet) {
          pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
          nParapet += 1;
          forms.parapet += 1;
        }
      }

      // "ALWAYS-SOMETHING" guarantee: no band may leave a building bare while
      // its caps still have room. A chimney lands on any house footprint; a
      // parapet lands on any ring at all. Only a genuinely exhausted cap (or a
      // degenerate polygon) produces a flat roof — verify-roof-variety gates
      // that share at ≤ 5% of extruded buildings.
      if (!treated) {
        if (h < RS.small.maxH) {
          if (nChimney < RS.caps.chimney) {
            const cc = RS.small.chimney;
            const top = roofY + cc.riseM[0] + item.hash * (cc.riseM[1] - cc.riseM[0]);
            if (pushChimney(satB, pushV, poly0, roofY, top, cc.halfM, mToTile, rand, chimneyCol)) {
              nChimney += 1;
              forms.chimney += 1;
              treated = true;
            }
          }
        } else if (nParapet < RS.caps.parapet) {
          pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
          nParapet += 1;
          forms.parapet += 1;
          treated = true;
        }
      }
      if (!treated) forms.flat += 1;
    } else if (S.roofDetail) {
      // ---- R15 dispatch, VERBATIM (the ROOFS_SAT.enabled:false revert path).
      // Do not "clean this up" — its job is to be byte-identical to pre-R18.
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
        pushParapet(satB, pushV, outer, roofY, ROOFS.parapet.heightM, ROOFS.parapet.insetFrac, parapetCol);
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

  // Round 13 (P4): water polygons for the specular glint (out.satWater). Filled
  // + triangulated flat at y=0 (the engine drapes the mesh to the chunk-center
  // ground); uv = tile-local XZ / rippleM so the normal map tiles at a world-
  // consistent swell size. Rivers-as-lines are left to the toy foam pass — the
  // glint targets polygon water bodies (harbors/lakes/wide rivers).
  const waterLayer = vt.layers.water;
  const satW = { pos: [], uv: [], idx: [], vtx: 0 };
  // Round 18 (A1): per-tile WATER COVERAGE (water polygon area / tile area).
  // Free here — the water layer is already fully iterated for the glint — and
  // it is what lets the engine tell "this 404 is open ocean" from "this 404 is
  // an empty desert" without a second fetch. Emitted unconditionally (0 when
  // the tile has no water layer at all) so it is never a missing-key read.
  let waterAreaTile = 0;
  if (waterLayer) {
    const scaleW = tileSpan / waterLayer.extent;
    const toLocalW = (px, py) => [mercX0 + px * scaleW - cx, -(mercYTop - py * scaleW) - cz];
    const inv = 1 / SAT_WATER.rippleM;
    for (let i = 0; i < waterLayer.length; i++) {
      const f = waterLayer.feature(i);
      if (f.type !== 3 || f.properties.class === 'swimming_pool') continue;
      const rings = f.loadGeometry().map((r) => clipRing(r, waterLayer.extent));
      const polys = classify(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
      for (const poly of polys) {
        // area in TILE units (rings are already clipped to the tile square, so
        // this can never exceed extent²) — holes subtracted
        waterAreaTile += Math.abs(signedArea(poly.outer)) * 0.5;
        for (const hole of poly.holes) {
          if (hole.length < 3) continue;
          waterAreaTile -= Math.abs(signedArea(hole)) * 0.5;
        }
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
        const base = satW.vtx;
        for (let vi = 0; vi < flat.length; vi += 2) {
          const [lx, lz] = toLocalW(flat[vi], flat[vi + 1]);
          satW.pos.push(lx, 0, lz);
          satW.uv.push(lx * inv, lz * inv);
        }
        satW.vtx += flat.length / 2;
        // MVT exteriors wind CW in y-down tile coords → flip to face up
        for (let t = 0; t < tris.length; t += 3) {
          satW.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
        }
      }
    }
  }

  out.waterCoverage = waterLayer
    ? Math.min(1, Math.max(0, waterAreaTile / (waterLayer.extent * waterLayer.extent)))
    : 0;

  const transfer = [];
  if (satB.idx.length > 0) {
    const pos = new Float32Array(satB.pos);
    const col = new Float32Array(satB.col);
    const anchor = new Float32Array(satB.anchor);
    const uv = new Float32Array(satB.uv); // round 15: facade-meter window UVs
    const idx = satB.vtx > 65535 ? new Uint32Array(satB.idx) : new Uint16Array(satB.idx);
    // Round 18 (A1) roof/selection telemetry. A plain object (structured-cloned
    // alongside the transferables, not itself transferable) — additive and
    // sentinel-safe: a pre-v14 bundle simply has no `meta` and every reader
    // optional-chains it.
    //   total     = footprints parsed in this tile (before the cap)
    //   kept      = footprints actually extruded (≤ SAT_BUILDINGS.maxPerChunk)
    //   smallKept = of `kept`, those under ROOFS_SAT.small.maxAreaM2
    //   forms     = per-treatment counts; forms.flat = got nothing at all
    //   Round 19 additions (all additive + sentinel-safe — a pre-v15 reader
    //   simply finds them missing and every consumer optional-chains):
    //   suburban  = 1 when the typology context guard armed for this tile
    //   typo      = footprints given a TYPOLOGY height
    //   typoForms = per-band counts (house/strip/school/bigbox/warehouse)
    //   inferMaxH = tallest height invented by ANY inference path (the
    //               verify-suburbia gate value)
    //   houses    = housePts pairs emitted
    const meta = {
      total: items.length,
      kept: selected.length,
      smallKept,
      forms,
      suburban: suburbanCtx ? 1 : 0,
      typo: nTypo,
      typoForms,
      inferMaxH,
      houses: housePts.length / 2,
    };
    out.satBuilding = { pos, col, idx, anchor, uv, meta };
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer, uv.buffer);
    // --- FROZEN AT A HOMESTEAD'S W1 MERGE — housePts ------------------------
    // Float32Array of [x, z] pairs, TILE-LOCAL (same frame as satBuilding.pos
    // and .anchor: add the chunk's cx/cz, exactly like satPts.water). One pair
    // per EXTRUDED building in the SMALL BAND — h < ROOFS_SAT.small.maxH AND
    // footprint < ROOFS_SAT.small.maxAreaM2 — i.e. precisely the buildings
    // this dispatch already gives a house-shaped roof. Mapped or inferred
    // both qualify; a tagged 8 m / 300 m² building is the most certain house
    // in the dataset. Bounded by SAT_BUILDINGS.maxPerChunk (500) ⇒ <= 4 KB.
    // Absent (not zero-length) when the tile has none — read it as
    // `bld.housePts ?? null`.
    //
    // *** MEASURED WARNING FOR C GROUNDTRUTH ***
    // This will be EMPTY over a real American suburb, and no change to this
    // emission can fix that. OpenFreeMap's z14 `building` layer generalises
    // individual houses away outside dense cores: Powell OH streams 15
    // footprints across 12 chunks and NOT ONE is under 600 m² (measured —
    // meta.smallKept 0). Suburban house lights therefore cannot come from
    // building footprints at all. The available honest source is the
    // residential landcover this same worker already samples: satVeg rows
    // tagged class 4 in satVegCls are deterministic points inside
    // landuse=residential (Powell 1.75 km², Dublin 11.96 km²) with building
    // avoidance already applied. Use housePts where it exists (cities, small
    // town cores) and those points where it does not.
    if (housePts.length > 0) {
      const hp = new Float32Array(housePts);
      out.satBuilding.housePts = hp;
      transfer.push(hp.buffer);
    }
  }
  if (satW.idx.length > 0) {
    const pos = new Float32Array(satW.pos);
    const uv = new Float32Array(satW.uv);
    const idx = satW.vtx > 65535 ? new Uint32Array(satW.idx) : new Uint16Array(satW.idx);
    out.satWater = { pos, uv, idx };
    out.empty = false;
    transfer.push(pos.buffer, uv.buffer, idx.buffer);
  }
  out.tessMs = performance.now() - t0;
  // R21: still empty here ⇒ the selection produced no indices (every kept
  // footprint simplified away / the vertex budget yielded nothing) = 'zero'.
  withReason(out, 'zero');
  return transfer.length ? transferResult(out, transfer) : out;
}

// --- Round 16 (A2 "GND-W"): the SATELLITE ground-light network ---------------
// The 'sat-roads' detail path. Every satellite tile ALREADY carried the OMT
// `transportation` + `aeroway` layers — the R13 satellite branch just threw them
// away, which is why night satellite was a black void. This path ribbon-extrudes
// the road network FLAT at y=0 (the engine drapes it on a bilinear RAW-DEM grid)
// and bakes, per vertex: the class hue (vertex color), a CLASS CODE (1-6 roads,
// 7 runway; 0 is RESERVED and never written — a missing attribute reads 0, which
// the shader's LUT maps to weight 0 = black = invisible under additive blending)
// and the cumulative arc in TRUE METERS along its chain (streetlight spacing and
// dash wavelengths are real-world lengths, and local coords are mercator-
// stretched by k — hence the ×1/k on every accumulated length).
//
// The whole tile lands in ONE set of arrays → one merged mesh → ONE draw per
// chunk, runway lights included (the R7 "zero extra draws" technique). Nothing
// here touches a toy helper: `clipSegment` is CALLED, `pushRibbon`/
// `pushRunwayLights` are PORTED into satellite-local writers so the toy group
// layout (foam/glow sentinels) is untouched.
//
// New functions only — no toy output changes, 'sat-buildings' byte-unchanged.

const SAT_ROAD_MIN_CHAIN_M = 30; // a chain shorter than this is a clip stub, not a road
const SAT_ROAD_RUNWAY_W = 55; // runway ribbon width (m) — the toy aeroway value

/** Clip a line feature to the tile square, stitching contiguous runs into chains. */
function eachClippedChain(f, extent, cb) {
  for (const line of f.loadGeometry()) {
    let chain = [];
    for (let i = 0; i < line.length - 1; i++) {
      const seg = clipSegment(line[i], line[i + 1], extent);
      if (!seg) {
        if (chain.length > 1) cb(chain);
        chain = [];
        continue;
      }
      if (chain.length === 0) chain.push(seg[0]);
      chain.push(seg[1]);
    }
    if (chain.length > 1) cb(chain);
  }
}

/**
 * Tile-space chain → decimated LOCAL polyline [x,z,x,z,…], or null if it is not
 * worth a ribbon. OMT polylines carry far more vertices than a 6 m glowing
 * ribbon needs (minSegM drops them against the last KEPT point, so a curve does
 * not accumulate error), but a long straight run must be SUBDIVIDED (maxSegM) or
 * the per-chunk bilinear drape can only lift its endpoints and the ribbon cuts
 * through a ridge. All thresholds are TRUE meters.
 */
function satRoadPrepChain(chain, toLocal, kInv, S) {
  const keep = [];
  let kx = null;
  let kz = null;
  for (let i = 0; i < chain.length; i++) {
    const [lx, lz] = toLocal(chain[i].x, chain[i].y);
    if (kx === null) {
      keep.push(lx, lz);
      kx = lx;
      kz = lz;
      continue;
    }
    // the last point is always kept, so decimation can never shorten the chain
    const isLast = i === chain.length - 1;
    if (Math.hypot(lx - kx, lz - kz) * kInv < S.minSegM && !isLast) continue;
    keep.push(lx, lz);
    kx = lx;
    kz = lz;
  }
  if (keep.length < 4) return null;
  let total = 0;
  for (let i = 2; i < keep.length; i += 2) {
    total += Math.hypot(keep[i] - keep[i - 2], keep[i + 1] - keep[i - 1]) * kInv;
  }
  if (total < SAT_ROAD_MIN_CHAIN_M) return null;
  const pts = [keep[0], keep[1]];
  for (let i = 2; i < keep.length; i += 2) {
    const ax = keep[i - 2];
    const az = keep[i - 1];
    const bx = keep[i];
    const bz = keep[i + 1];
    const segM = Math.hypot(bx - ax, bz - az) * kInv;
    const n = segM > S.maxSegM ? Math.ceil(segM / S.maxSegM) : 1;
    for (let s = 1; s <= n; s++) {
      pts.push(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
    }
  }
  return pts;
}

/**
 * Ribbon-extrude a LOCAL polyline into the shared sat-road arrays: one quad per
 * segment at y=0 (the engine drapes + lifts). `arcConst` null = accumulate arc
 * in TRUE meters along the chain (roads); a number = write that constant on
 * every vertex (runway light quads carry their normalized 0..1 position along
 * the runway, for the optional chase). `maxVerts` is a HARD stop — the caller
 * fills by class priority, so hitting it drops minor roads, never motorways.
 */
function pushSatRoadQuads(acc, pts, halfW, col, clsCode, kInv, arcConst, maxVerts) {
  const [r, g, b] = col;
  let arc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (acc.vtx + 4 > maxVerts) return;
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    const lenM = len * kInv;
    const a0 = arcConst === null ? arc : arcConst;
    const a1 = arcConst === null ? arc + lenM : arcConst;
    const base = acc.vtx;
    acc.pos.push(ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
    for (let c = 0; c < 4; c++) acc.col.push(r, g, b);
    acc.arc.push(a0, a0, a1, a1);
    acc.cls.push(clsCode, clsCode, clsCode, clsCode);
    acc.vtx += 4;
    acc.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    arc += lenM;
  }
}

/**
 * Satellite port of the round-7 toy `pushRunwayLights` walker: pairs of small
 * bright quads every `spacingM` down a clipped runway centerline, plus threshold
 * crossbars at both ends — written into the SAME sat-road arrays (class code 7),
 * so an airport costs the chunk's single draw and nothing more. The toy function
 * is left untouched (it writes the toy group's foam/glow sentinel layout).
 */
function pushSatRunwayLights(acc, chain, toLocal, k, kInv, halfWWorld, col, clsCode, cfg, maxVerts) {
  const pts = [];
  let total = 0;
  for (let i = 0; i < chain.length; i++) {
    const [lx, lz] = toLocal(chain[i].x, chain[i].y);
    if (i > 0) total += Math.hypot(lx - pts[i - 1][0], lz - pts[i - 1][1]);
    pts.push([lx, lz, total]);
  }
  if (total < 40 * k) return; // stub fragments from clipping
  const spacing = cfg.spacingM * k;
  const off = halfWWorld + cfg.offsetM * k;
  const s = cfg.sizeM * k;
  const at = (d) => {
    // point + unit direction at arc distance d
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][2] >= d || i === pts.length - 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const seg = Math.max(b[2] - a[2], 1e-6);
        const t = Math.min(Math.max((d - a[2]) / seg, 0), 1);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
      }
    }
    return null;
  };
  for (let d = spacing / 2; d < total; d += spacing) {
    if (acc.vtx + 8 > maxVerts) return;
    const p = at(d);
    if (!p) break;
    const [px, pz, dx, dz] = p;
    const nx = -dz;
    const nz = dx;
    const g = d / total;
    for (const side of [1, -1]) {
      const cxp = px + nx * off * side;
      const czp = pz + nz * off * side;
      pushSatRoadQuads(
        acc,
        [cxp - dx * s, czp - dz * s, cxp + dx * s, czp + dz * s],
        s,
        col,
        clsCode,
        kInv,
        g,
        maxVerts
      );
    }
  }
  // threshold crossbars spanning the runway width at both ends
  for (const [d, g] of [
    [Math.min(6 * k, total * 0.05), 0],
    [total - Math.min(6 * k, total * 0.05), 1],
  ]) {
    if (acc.vtx + 4 > maxVerts) return;
    const p = at(d);
    if (!p) continue;
    const [px, pz, dx, dz] = p;
    const nx = -dz;
    const nz = dx;
    pushSatRoadQuads(
      acc,
      [px + nx * off, pz + nz * off, px - nx * off, pz - nz * off],
      s * 1.4,
      col,
      clsCode,
      kInv,
      g,
      maxVerts
    );
  }
}

// --- Round 22 (C CLUTTER) — the ground-life fork of 'sat-roads' -------------
// Positional hash. NOT a mulberry32 stream: an RNG's output depends on how many
// times it has been called, so it couples every anchor to the FEATURE ORDER of
// the tile — and OMT feature order is not a contract. Hashing the point makes
// each anchor a pure function of where it is, which is what "hash-stable" has
// to mean for a gate that hashes instance matrices across two boots.
function clutterHash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Local-space {outer,holes} with a bbox, so inRes() rejects in 4 compares. */
function localResPoly(poly, toL) {
  const outer = poly.outer.map(toL);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { outer, holes: poly.holes.map((h) => h.map(toL)), minX, minY, maxX, maxY };
}

/**
 * Walk a LOCAL polyline at `spacing` (local units) and hand each sample to
 * `cb(x, z, ux, uz)` — the point plus the chain's unit direction there. One
 * walker for both anchor sources and for the pole/mover derivations that live
 * on the client, so "every 42 m along this chain" means the same thing in the
 * worker as it does in the shader.
 */
function walkChain(pts, spacing, phase, cb) {
  let acc = 0;
  let next = phase;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const seg = Math.hypot(pts[i] - ax, pts[i + 1] - az);
    if (seg < 1e-6) continue;
    const ux = (pts[i] - ax) / seg;
    const uz = (pts[i + 1] - az) / seg;
    while (next <= acc + seg) {
      const t = next - acc;
      if (cb(ax + ux * t, az + uz * t, ux, uz) === false) return;
      next += spacing;
    }
    acc += seg;
  }
}

/**
 * ROUND 22 (C "CLUTTER") — the protocol-18 ground-life outputs.
 *
 * THE OWENS LOCK LIVES HERE, and it lives here on purpose. The charter's
 * requirement is "0 instances AND +0 draws at Owens BY CONSTRUCTION", and the
 * only construction that earns that word is the R18 empty-chunk idiom: a tile
 * that emits NOTHING cannot fill a pool, and an empty pool issues no draw. A
 * client-side filter would leave three pools that happen to be empty; this
 * leaves three pools that cannot be anything else.
 *
 * The floor is km of cls-4..6 centerline per TRUE km², measured over the 3x3
 * z13 ring at every certified pose (the table is on the CLUTTER block, and the
 * measurement is scripts/r22-c-density.mjs). The Owens draw-gate pose sits ON
 * Lone Pine — a real, mapped village with 25 service ways and 3.03 km² of
 * residential landuse — so "does this tile have streets?" was never going to
 * separate it from Ohio suburbia. Density does: Lone Pine's densest z13 tile
 * measures 1.50 against P-LEWIS's SPARSEST at 2.54.
 *
 * Writes out.satRoadPaths (movers + poles) and out.satParking (parked cars).
 * Both keys, and every byte of this function, are inside CLUTTER.enabled.
 */
function buildClutter(out, transfer, vt, frame, byCls, serviceChains, kInv) {
  const { tileSpan, mercX0, mercYTop, cx, cz, k } = frame;
  const W = CLUTTER.worker;

  // --- the density floor ----------------------------------------------------
  let streetLocal = 0;
  for (let cls = 4; cls <= 6; cls++) {
    const bucket = byCls.get(cls);
    if (!bucket) continue;
    for (const c of bucket) {
      const p = c.pts;
      for (let i = 2; i < p.length; i += 2) {
        streetLocal += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      }
    }
  }
  const trueSpanKm = (tileSpan * kInv) / 1000;
  const areaKm2 = trueSpanKm * trueSpanKm;
  const streetKmPerKm2 = areaKm2 > 0 ? (streetLocal * kInv) / 1000 / areaKm2 : 0;
  if (streetKmPerKm2 < CLUTTER.minStreetKmPerKm2) return; // OWENS: nothing emitted

  // --- satRoadPaths: cls 3..6 centerlines, VERBATIM the ribbon points --------
  // The same decimated arrays pass 2 ribbon-extrudes, in the same order, so a
  // client walking them re-derives the shader's `aRoadArc` exactly — which is
  // what puts a lamp post ON a lamp pool instead of between two.
  const ptsArr = [];
  const offsets = [0];
  const clsArr = [];
  for (let cls = 3; cls <= 6; cls++) {
    const bucket = byCls.get(cls);
    if (!bucket) continue;
    for (const c of bucket) {
      if (clsArr.length >= W.maxPathsPerChunk) break;
      for (let i = 0; i < c.pts.length; i++) ptsArr.push(c.pts[i]);
      offsets.push(ptsArr.length / 2);
      clsArr.push(cls);
    }
  }

  // Junctions: chain endpoints two or more chains share (OMT splits ways at
  // intersections, so an endpoint census finds them without a segment sweep).
  // The client uses them to SUPPRESS a lamp that would stand in the middle of
  // a crossing — the one place the 42 m phase puts furniture in the road.
  const jmap = new Map();
  const q = (v) => Math.round(v / 2) * 2; // 2-unit bucket ≈ 1.5 true m
  for (let p = 0; p < clsArr.length; p++) {
    for (const idx of [offsets[p], offsets[p + 1] - 1]) {
      const jx = ptsArr[idx * 2];
      const jz = ptsArr[idx * 2 + 1];
      const key = `${q(jx)},${q(jz)}`;
      const e = jmap.get(key);
      if (e) e.n += 1;
      else jmap.set(key, { x: jx, z: jz, n: 1 });
    }
  }
  const junc = [];
  for (const e of jmap.values()) if (e.n >= 2) junc.push(e.x, e.z);

  // --- satParking: where a car actually stands ------------------------------
  // Residential CURBS first (this is the read the user asked for — "cars parked
  // on residential streets"), then the parking AISLES, so a commercial strip's
  // dense service web cannot spend the tile's whole anchor budget before the
  // subdivision gets any.
  const park = [];
  const spacing = W.parkingSpacingM * k; // true m → local (mercator) m
  const cap = W.maxParkingPerChunk;

  const resPolys = [];
  const lu = vt.layers.landuse;
  if (lu) {
    const scale = tileSpan / lu.extent;
    const toL = (p) => ({
      x: mercX0 + p.x * scale - cx,
      y: -(mercYTop - p.y * scale) - cz,
    });
    for (let i = 0; i < lu.length && resPolys.length < 24; i++) {
      const f = lu.feature(i);
      if (f.type !== 3 || f.properties.class !== 'residential') continue;
      const rings = f
        .loadGeometry()
        .map((r) => clipRing(r, lu.extent))
        .filter((r) => r.length >= 3);
      for (const poly of classifyRingsSat(rings)) {
        if (resPolys.length >= 24) break;
        resPolys.push(localResPoly(poly, toL));
      }
    }
  }
  const inRes = (x, z) => {
    for (const p of resPolys) {
      if (x < p.minX || x > p.maxX || z < p.minY || z > p.maxY) continue;
      if (pointInPoly(p, x, z)) return true;
    }
    return false;
  };

  if (resPolys.length > 0) {
    const half = cap >> 1;
    for (const cls of [6, 5]) {
      const bucket = byCls.get(cls);
      if (!bucket) continue;
      for (const c of bucket) {
        if (park.length / 4 >= half) break;
        const off = c.halfW + 1.6 * k; // outboard of the ribbon edge, at the kerb
        walkChain(c.pts, spacing, spacing * 0.5, (x, z, ux, uz) => {
          if (park.length / 4 >= half) return false;
          if (!inRes(x, z)) return true;
          const h = clutterHash(x, z);
          const side = h < 0.5 ? 1 : -1;
          // A kerbside car is PARALLEL to the street and faces with the flow of
          // its own side, so a residential block reads as two opposed rows.
          park.push(x - uz * off * side, z + ux * off * side, ux * side, uz * side);
          return true;
        });
      }
    }
  }
  if (serviceChains) {
    const svcOff = 3.4 * k; // aisle centre → the middle of a parking bay
    for (const pts of serviceChains) {
      if (park.length / 4 >= cap) break;
      walkChain(pts, spacing, spacing * 0.5, (x, z, ux, uz) => {
        if (park.length / 4 >= cap) return false;
        const h = clutterHash(x * 1.7, z * 1.3);
        const side = h < 0.5 ? 1 : -1;
        // A bay car is PERPENDICULAR to its aisle — nose in.
        const nx = -uz * side;
        const nz = ux * side;
        park.push(x + nx * svcOff, z + nz * svcOff, nx, nz);
        return true;
      });
    }
  }

  if (clsArr.length > 0) {
    const pts = new Float32Array(ptsArr);
    const offs = new Uint32Array(offsets);
    const cl = new Uint8Array(clsArr);
    const jn = new Float32Array(junc);
    out.satRoadPaths = { pts, offsets: offs, cls: cl, junctions: jn, streetKmPerKm2 };
    transfer.push(pts.buffer, offs.buffer, cl.buffer, jn.buffer);
  }
  if (park.length > 0) {
    const pk = new Float32Array(park);
    out.satParking = pk;
    transfer.push(pk.buffer);
  }
}

function buildSatRoads(vt, frame) {
  const { tileSpan, mercX0, mercYTop, cx, cz, k, t0 } = frame;
  const S = SAT_ROADS;
  const out = { empty: true, tessMs: 0, v: WORKER_PROTOCOL };
  const kInv = 1 / k; // local (mercator) meters → TRUE meters
  const arteryCol = hexToRGB(S.colors.artery);
  const streetCol = hexToRGB(S.colors.street);
  const runwayCol = hexToRGB(S.colors.runway);

  // Pass 1 — COLLECT accepted chains only (nothing is tessellated yet), so the
  // minFeatures floor below can shed a whole sparse rural tile for zero cost.
  const byCls = new Map(); // cls → [{ pts, halfW, col }]
  const runways = [];
  let nFeatures = 0;
  // R22 (C CLUTTER): the parking-aisle / driveway chains, collected in the SAME
  // walk (a second pass over `transportation` would re-decode every feature).
  // Deliberately NOT counted into nFeatures: the shed lever is a road-RIBBON
  // budget and a tile whose only lines are driveways must still shed.
  const serviceChains = CLUTTER.enabled ? [] : null;

  const tLayer = vt.layers.transportation;
  if (tLayer) {
    const scale = tileSpan / tLayer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    for (let i = 0; i < tLayer.length; i++) {
      const f = tLayer.feature(i);
      if (f.type !== 2) continue; // lines only
      if (f.properties.brunnel === 'tunnel') continue; // buried road = unlit road
      const spec = S.classes[f.properties.class]; // service/track/path/rail/ferry: out
      if (!spec) {
        if (serviceChains && f.properties.class === 'service') {
          eachClippedChain(f, tLayer.extent, (chain) => {
            if (serviceChains.length >= CLUTTER.worker.maxPathsPerChunk) return;
            const pts = [];
            for (const p of chain) {
              const [lx, lz] = toLocal(p.x, p.y);
              pts.push(lx, lz);
            }
            if (pts.length >= 4) serviceChains.push(pts);
          });
        }
        continue;
      }
      const halfW = (spec.w * k) / 2; // true m → local (mercator) m
      const col = spec.cls <= 3 ? arteryCol : streetCol;
      eachClippedChain(f, tLayer.extent, (chain) => {
        const pts = satRoadPrepChain(chain, toLocal, kInv, S);
        if (!pts) return;
        let bucket = byCls.get(spec.cls);
        if (!bucket) {
          bucket = [];
          byCls.set(spec.cls, bucket);
        }
        bucket.push({ pts, halfW, col });
        nFeatures += 1;
      });
    }
  }

  const aLayer = vt.layers.aeroway;
  if (aLayer) {
    const scale = tileSpan / aLayer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    const halfW = (SAT_ROAD_RUNWAY_W * k) / 2;
    for (let i = 0; i < aLayer.length; i++) {
      const f = aLayer.feature(i);
      if (f.type !== 2 || f.properties.class !== 'runway') continue;
      eachClippedChain(f, aLayer.extent, (chain) => {
        runways.push({ chain, toLocal, halfW });
        nFeatures += 1;
      });
    }
  }

  // THE SHED LEVER (verify-sat-depth ≤261 at Owens Valley): a tile with fewer
  // accepted chains than the floor returns EMPTY — no arrays, no satRoads key,
  // and the engine marks the chunk empty → zero draws for that tile. Default 0
  // = every tile with at least one chain draws.
  if (nFeatures < S.minFeatures) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — THE SHED LEVER fired. Deliberate, deterministic, and
    // permanent for this tile: an engine may cache it, but it must never
    // confuse it with a rate-limited fetch.
    return withReason(out, 'zero');
  }

  const transfer = [];

  // --- R22 (C CLUTTER) — the protocol-18 ground-life outputs -----------------
  // Everything below is inside this one flag: with CLUTTER.enabled false the
  // function is byte-identical to protocol 17 (no keys, no transferables, no
  // extra layer decode — `serviceChains` is null and never collected).
  if (CLUTTER.enabled) {
    buildClutter(out, transfer, vt, frame, byCls, serviceChains, kInv);
  }
  // `clutterOnly` (set on the clutter engine's OWN worker via api.setClutterOnly)
  // returns here: that engine reads the two new keys and nothing else, and the
  // ribbon tessellation below is ~90% of this builder's cost. The ROAD engine's
  // worker never sets it, so its bundle is unchanged.
  if (clutterOnly) {
    out.tessMs = performance.now() - t0;
    // The road ring's sentinel is `!result.satRoads`, which is still true here —
    // so even if this bundle somehow reached SatRoadEngine it renders nothing.
    if (!out.satRoadPaths && !out.satParking) withReason(out, 'zero');
    return transfer.length ? transferResult(out, transfer) : out;
  }

  // Pass 2 — tessellate under a hard vertex budget, by PRIORITY: runway lights
  // first (bounded by runway count, and the airport is the payoff), then roads
  // motorway → minor, so a dense downtown z13 tile loses its residential grid
  // before it loses its skeleton.
  const acc = { pos: [], col: [], arc: [], cls: [], idx: [], vtx: 0 };
  const maxV = S.maxVertsPerChunk;
  for (const r of runways) {
    if (acc.vtx >= maxV) break;
    pushSatRunwayLights(acc, r.chain, r.toLocal, k, kInv, r.halfW, runwayCol, 7, S.runway, maxV);
  }
  for (let cls = 1; cls <= 6; cls++) {
    const bucket = byCls.get(cls);
    if (!bucket) continue;
    for (const c of bucket) {
      if (acc.vtx >= maxV) break;
      pushSatRoadQuads(acc, c.pts, c.halfW, c.col, cls, kInv, null, maxV);
    }
  }

  if (acc.idx.length > 0) {
    const pos = new Float32Array(acc.pos);
    const col = new Float32Array(acc.col);
    const arc = new Float32Array(acc.arc);
    const cls = new Float32Array(acc.cls);
    const idx = acc.vtx > 65535 ? new Uint32Array(acc.idx) : new Uint16Array(acc.idx);
    out.satRoads = { pos, col, arc, cls, idx };
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, arc.buffer, cls.buffer, idx.buffer);
  }
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero'); // no accepted chain survived tessellation
  return transfer.length ? transferResult(out, transfer) : out;
}

// --- Round 18 (A1) — the DISTANT BLOCK-MASS fork ('sat-skyline') -------------
// A2 SKYLINE's data source, landed here so the WORKER_PROTOCOL 14 contract is
// frozen at A1's merge. Same early-return shape as 'sat-buildings': none of the
// toy land/water/road/scatter passes run.
//
// This is deliberately the LEANEST possible building path — it feeds a z13 ring
// out to ~14 km whose job is city MASS at range, not architecture:
//   • only footprints that carry real bulk (mapped h ≥ SAT_SKYLINE.minH OR
//     area ≥ minAreaM2) — a suburb contributes nothing to a distant skyline
//   • aggressive simplifyRing (SAT_SKYLINE.simplifyTol) — corners are sub-pixel
//   • walls + ONE flat cap, no roof detail of any kind
//   • NO uv array at all (the facade atlas is a near-field read; at 14 km the
//     window grid is aliasing noise). The consuming material must therefore
//     NOT enable `map` — there is no uv attribute to sample it with.
//   • colours pre-mixed toward SAT_SKYLINE.hazeColor by hazeMix, so the mass
//     sits in aerial perspective without a per-fragment fog term.
// Output: out.satSkyline {pos, col, idx, anchor} — anchor is the same
// footprint-centroid pair the near ring uses, so A2's bend variant
// ('world-bend-anchor-satskyline-r18') drops each block rigidly.
//
// *** A2: READ THIS BEFORE WIRING THE RING ***
// The function is zoom-agnostic — it extrudes whatever tile it is handed — but
// SAT_SKYLINE.ring.z 13 HAS NO USABLE DATA. Measured on the live tileset:
//   z13 2412/3078 (all of Manhattan): the `building` layer holds exactly ONE
//     feature, a single merged blob of 9,925,314 m² with no height. It is the
//     whole borough dissolved into one polygon, and it is correctly discarded
//     by the shared TOY_WORLD.buildings.maxFootprintM2 (60,000) mega-block
//     guard — so a z13 ring emits NOTHING, anywhere.
//   z14 4824/6157 (same ground): 1469 buildings, mapped heights p50 61 m / p90
//     168 m / max 444 m; 997 pass minH 35 and 1066 pass the full filter.
// This is exactly the case the R18 plan §4 anticipated ("contingency ring z14
// r14000"). Take the contingency: z14 with the wider radius. Everything else
// in SAT_SKYLINE (minH / minAreaM2 / simplifyTol / maxPerChunk / hazeMix) is
// tuned for z14-scale geometry and needs no change.
function buildSatSkyline(vt, frame) {
  // `k` (round 20, C2): the mercator stretch, for the marquee exclusion discs.
  const { tileSpan, mercX0, mercYTop, cx, cz, k, t0 } = frame;
  const out = { empty: true, tessMs: 0, v: WORKER_PROTOCOL };
  const layer = vt.layers.building;
  if (!layer) {
    out.tessMs = performance.now() - t0;
    return withReason(out, 'zero'); // parsed, no `building` layer
  }
  const SK = SAT_SKYLINE;
  const S = SAT_BUILDINGS;
  const B = TOY_WORLD.buildings;
  const FS = SAT_FAR_SUBURB; // round 19 — the safe re-arm of the area hatch
  const PC = SAT_POLY_COVER; // round 20 — per-POLYGON admission (see buildSatBuildings)
  const scale = tileSpan / layer.extent;
  const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];

  const items = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    let rawH = f.properties.render_height ?? f.properties.height ?? 0;
    if (rawH === 5 && f.properties.height == null) rawH = 0; // the OMT synth-5 trap
    const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
    const polys = classifyRingsSat(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
    if (polys.length === 0) continue;
    const fid = typeof f.id === 'number' ? f.id : i;
    // --- Round 20 (A SPRAWL) — the far-mass ring's half of the same defect ---
    // Identical mechanism to buildSatBuildings: the mega-block guard and the
    // SAT_FAR_SUBURB hatch's own `minAreaM2` both tested the FEATURE SUM, so a
    // subdivision-in-one-feature was rejected as a district while a genuine
    // 900 m² shed inside a 4-polygon feature was admitted on its siblings'
    // area. Per polygon, both tests finally mean what they say.
    //
    // The tall pick (`rawH >= SK.minH`) is deliberately NOT area-gated here:
    // PC.skyline.minAreaM2 admits AREA-BASED (hatch) picks only. A 200 m tower
    // on a 400 m² plate is exactly what a distant skyline is made of, and a
    // blanket per-polygon floor would delete it. PC.skyline.minAreaM2 mirrors
    // SAT_FAR_SUBURB.minAreaM2 by value and exists so this path can be tuned
    // without touching that frozen block.
    if (PC.enabled) {
      const aScale = 0.5 * scale * scale;
      for (let pi = 0; pi < polys.length; pi++) {
        const p = polys[pi];
        const aM2 = Math.abs(signedArea(p.outer)) * aScale;
        if (aM2 > B.maxFootprintM2) continue;
        const tallPick = rawH >= SK.minH;
        const legacyAreaPick = aM2 >= SK.minAreaM2; // dead while minAreaM2 is 1e9
        const hatchPick =
          FS.enabled &&
          !tallPick &&
          !legacyAreaPick &&
          aM2 >= PC.skyline.minAreaM2 &&
          rawH < FS.hardCapM; // untagged (rawH 0) always passes
        if (!(tallPick || legacyAreaPick || hatchPick)) continue;
        const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
        const hash = (((pid * 2654435761) >>> 0) % 4096) / 4096;
        let h;
        if (rawH > 0) h = rawH;
        else if (hatchPick) h = Math.min(FS.hardCapM, FS.hM[0] + hash * (FS.hM[1] - FS.hM[0]));
        else h = clamp01Range(12 + Math.sqrt(aM2) * 0.6, 18, 60) * (0.9 + hash * 0.2);
        if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope;
        h = Math.min(h, B.maxH);
        const it = { polys: [p], areaM2: aM2, h, id: pid, hatch: hatchPick };
        if (!PC.perPolyDrape && pi > 0) it.anchorPoly = polys[0];
        items.push(it);
      }
      continue;
    }
    let area = 0;
    for (const p of polys) area += Math.abs(signedArea(p.outer));
    const areaM2 = area * 0.5 * scale * scale;
    if (areaM2 > B.maxFootprintM2) continue; // merged mega-blocks are ground, not mass
    // --- Round 19 (A HOMESTEAD) — the SAFE area hatch, v2 -------------------
    // R18 measured the original hatch (invented height 12+sqrt(area)*0.6
    // clamped 18-60) SATURATING: every area-only pick at/above 2500 m² came
    // out at exactly 60 m, growing a fake 20-storey downtown over every
    // big-box strip. It was disabled by setting minAreaM2 to 1e9 rather than
    // deleted, and that dead branch is preserved VERBATIM below.
    //
    // v2 keeps the idea and kills the saturation: a hatch pick gets a
    // hash-spread height in SAT_FAR_SUBURB.hM, hard-capped at hardCapM, so it
    // can only ever read as LOW MASS. A tagged-but-short footprint keeps its
    // real height — honest data is never overwritten.
    // THE CAP IS AN ADMISSION RULE, NOT JUST A CLAMP. A mapped 30 m building
    // is honest data, but it is not LOW MASS — and admitting it would put
    // skyline blocks in the 25-35 m band, which is exactly the "is that a
    // fake downtown?" read this hatch exists to avoid. So the hatch takes
    // nothing above hardCapM from EITHER source. The pay-off is an invariant
    // that verify-suburbia can measure straight off the rendered geometry:
    //   NO skyline block's height lies in (hardCapM, SAT_SKYLINE.minH).
    // Everything above 35 m is mapped and tall; everything the hatch added is
    // at or below 25 m. Buildings mapped in the 25-35 m gap are simply not
    // far-mass material — they still render in the DETAIL ring up close.
    const tallPick = rawH >= SK.minH;
    const legacyAreaPick = areaM2 >= SK.minAreaM2; // dead while minAreaM2 is 1e9
    const hatchPick =
      FS.enabled &&
      !tallPick &&
      !legacyAreaPick &&
      areaM2 >= FS.minAreaM2 &&
      rawH < FS.hardCapM; // untagged (rawH 0) always passes
    if (!(tallPick || legacyAreaPick || hatchPick)) continue;
    const id = typeof f.id === 'number' ? f.id : i;
    const hash = (((id * 2654435761) >>> 0) % 4096) / 4096;
    // Area-only picks carry no mapped height: infer enough bulk to read as a
    // block (a 2500 m² untagged footprint is a warehouse/mall, not a house).
    let h;
    if (rawH > 0) h = rawH;
    else if (hatchPick) h = Math.min(FS.hardCapM, FS.hM[0] + hash * (FS.hM[1] - FS.hM[0]));
    else h = clamp01Range(12 + Math.sqrt(areaM2) * 0.6, 18, 60) * (0.9 + hash * 0.2);
    if (h > B.kneeM) h = B.kneeM + (h - B.kneeM) * B.kneeSlope; // same soft knee as the near ring
    h = Math.min(h, B.maxH);
    items.push({ polys, areaM2, h, id, hatch: hatchPick });
  }
  // Round 20 (C2): the marquee holes, before the density lock counts candidates.
  // A marquee POI CAN reach the far-mass ring — the z13 skyline runs out to
  // 8.7 km and MONUMENT_MODELS.rangeM is 26 km, so an excluded monument is
  // always already wearing its model when this tile is admitted. Dropping the
  // footprint first also keeps it out of the hatch tally, which is what the
  // Owens lock counts.
  const marqueeEx = marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k);
  if (marqueeEx) dropMarqueeFootprints(items, marqueeEx);

  // --- Round 19 (A HOMESTEAD) — THE OWENS LOCK -------------------------------
  // Re-arming the hatch on SIZE alone re-breaks the desert: Owens Valley ships
  // a handful of big untagged footprints, so the skyline chunk there would go
  // from EMPTY to non-empty, which is both a draw the §5 Owens ledger has no
  // room for and a direct failure of verify-skyline's "EMPTY SCENE ISSUES NO
  // MESH (Owens skyline ready === 0)" gate.
  //
  // What actually separates a suburb from a desert is DENSITY, not size — see
  // the measured per-tile candidate counts in SAT_FAR_SUBURB.minCountPerTile.
  // Rural tiles fall under the threshold and contribute NOTHING, so an empty
  // scene stays empty BY CONSTRUCTION rather than by a draw-count race.
  //
  // HONEST LIMITATION, and it is the round's most important negative result:
  // this also means POWELL GETS NO FAR-MASS. The OpenFreeMap z14 `building`
  // layer is empty in American suburbs (R18 documented the same thing for the
  // detail ring: Powell's centre tile ships ONE building, its 5x5 neighbourhood
  // 28). The far-mass this hatch delivers is the low-rise fill around MID-SIZE
  // CITY cores — the 3-16 km dead band of P6 — not suburban mass. Real
  // suburban far-mass has to come from `landuse=residential` polygons, which
  // DO exist there (Powell 1.75 km² over a 3x3); that is a future round.
  //
  // *** ROUND 20 (A SPRAWL) — THE LOCK'S THRESHOLD IS PER-FEATURE DATA ***
  // minCountPerTile 5 was measured on FEATURE-summed candidates, i.e. on the
  // starved population the multipolygon defect produced. Per POLYGON the same
  // 3x3s measure (worst tile, hatch blocks admitted):
  //     Owens Valley 36.601/-118.06   15      Owens 36.6/-118.1   15
  //     Powell OH                    113      Dublin OH          118
  //     Columbus OH                  120*     Chicago Loop       120*
  //     (* at FS.areaMaxPerChunk, so the true candidate count is higher)
  // Owens is NOT empty in the building layer — Lone Pine is a real town, and
  // once winding-correct per-polygon reading lands, 15 of its ranch/industrial
  // footprints clear a threshold of 5. Left alone, the desert grows a far-mass
  // ring: verify-skyline's "EMPTY SCENE ISSUES NO MESH" and verify-suburbia
  // (E) both fail, and the §4 Owens draw ledger has no room for it.
  //
  // So under SAT_POLY_COVER the SAME lock reads a per-POLYGON threshold from
  // SAT_POLY_COVER.skyline.minCountPerTile. SAT_FAR_SUBURB is untouched and
  // still rules with the flag off — the R19 value is per-feature data and stays
  // correct for the per-feature path it was measured on. The new value sits in
  // the same kind of measured gap the old one did (2.7x Owens' busiest tile,
  // 2.8x under Powell's), and the lock's SHAPE — density, not size; empty stays
  // empty by construction, not by winning a draw race — is unchanged.
  //
  // *** ROUND 21 (D PIPELINE) — THE LOCK IS A CLIFF, AND THE CLIFF IS VISIBLE ***
  // The rule above is ALL-OR-NOTHING per tile: 39 hatch candidates render
  // NOTHING and the neighbouring tile's 41 render ALL 41. Between the measured
  // anchors (Owens 15, Powell 113, Dublin 118) sits an entire unmeasured band —
  // every mid-density town in the world — where two adjacent z14 tiles of the
  // SAME suburb land on opposite sides of 40 and the far-mass ring
  // CHECKERBOARDS. That is one of the two symptoms this round exists to close
  // ("parts of the world load their geometry while adjacent areas don't").
  //
  // TILE_PIPELINE.hatchRamp keeps the lock's SHAPE — density, not size; an
  // empty scene stays empty BY CONSTRUCTION — and replaces the step with a
  // ramp:
  //     n <= lockLo (24)          keepN = 0
  //     lockLo < n < rampHi (64)  keepN = round(n * (n - lockLo) / (rampHi - lockLo))
  //     n >= rampHi               keepN = n     (full keep — no R20 regression)
  // Owens' busiest tile measures 15 <= 24, so the desert still contributes
  // ZERO hatch blocks and verify-skyline's "EMPTY SCENE ISSUES NO MESH" plus
  // the Owens <= 261 draw ledger hold by construction, exactly as under the
  // step. Powell 113 and Dublin 118 are past rampHi, so R20's coverage is kept
  // whole. What changes is only the band nobody measured: the 39-vs-41 cliff
  // becomes 15-vs-17. The ramp is quadratic on purpose — keepN/n rises
  // linearly with density, so a tile just over the floor contributes a THIN
  // scatter rather than a sudden slab.
  //
  // WHICH members survive is decided in hash order (see fnv1aId at the
  // selection below), never in raw MVT order: feature order is spatially
  // clustered, so keeping "the first keepN" would put the whole survivor set
  // in one corner of the tile — the identical defect P3 fixes downstream.
  let hatchCand = 0;
  let hatchKeep = -1;
  const parsedItems = items.length;
  if (FS.enabled) {
    let nHatch = 0;
    for (const it of items) if (it.hatch) nHatch += 1;
    hatchCand = nHatch;
    if (TILE_PIPELINE.enabled && TILE_PIPELINE.hatchRamp) {
      const { lockLo, rampHi } = TILE_PIPELINE.hatchRamp;
      const keepN =
        nHatch <= lockLo
          ? 0
          : nHatch >= rampHi
            ? nHatch
            : Math.round((nHatch * (nHatch - lockLo)) / (rampHi - lockLo));
      hatchKeep = keepN;
      if (keepN < nHatch) {
        const hatchItems = items.filter((it) => it.hatch);
        hatchItems.sort((a, b) => fnv1aId(a.id) - fnv1aId(b.id) || a.id - b.id);
        const keep = new Set(hatchItems.slice(0, keepN));
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].hatch && !keep.has(items[i])) items.splice(i, 1);
        }
      }
    } else {
      const minCount = PC.enabled ? PC.skyline.minCountPerTile : FS.minCountPerTile;
      if (nHatch > 0 && nHatch < minCount) {
        for (let i = items.length - 1; i >= 0; i--) if (items[i].hatch) items.splice(i, 1);
      }
    }
  }
  // Round 20 (A): per-tile far-mass telemetry. It hangs off `out` rather than
  // off out.satSkyline so it SURVIVES the empty early-return below — the lock's
  // whole claim is about a tile that ends up emitting nothing, and a number
  // that vanishes exactly when the interesting case fires is not telemetry.
  // Emitted ONLY under the flag, so enabled:false leaves the bundle identical
  // to R19 down to its KEY SET, not merely to its arrays (an extra key moves
  // any bundle-wide fingerprint). Additive + deterministic; engines never read it.
  if (PC.enabled) out.skyMeta = { parsed: parsedItems, kept: items.length, hatchCand };
  // R21: how many hatch blocks the RAMP kept (-1 = ramp not armed). Under
  // TILE_PIPELINE only, same additive-telemetry contract as skyMeta itself —
  // with the flag off the key set is untouched. verify-seam / the D fixture
  // read it to prove Owens 0 and the ramp's monotonicity off the worker.
  if (PC.enabled && TILE_PIPELINE.enabled) out.skyMeta.hatchKeep = hatchKeep;
  if (items.length === 0) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — the density lock/ramp or the admission tests took
    // everything. Deterministic for this tile; not a fetch problem.
    return withReason(out, 'zero');
  }
  // Volume sort — at range, the tallest/bulkiest blocks ARE the skyline.
  items.sort((a, b) => b.areaM2 * b.h - a.areaM2 * a.h);

  // Round 19: the hatch gets its OWN per-tile budget on top of maxPerChunk,
  // so a suburb-shaped tile can never spend the whole skyline cap on 10-22 m
  // sheds and crowd out real towers. In a dense core the volume sort already
  // buries the hatch (a 900 m² x 16 m shed scores 14.4k against a 2000 m² x
  // 60 m tower's 120k), so this cap only ever bites on mid-density tiles.
  // Round 20 (A): a POLYGON cap under the flag, same reasoning (and same
  // value) as the detail ring's — before the explosion a kept item emitted all
  // of its feature's polygons, so SK.maxPerChunk never bounded the geometry.
  //
  // *** ROUND 21 (D PIPELINE) — THE CAP IS CONSUMED IN SPATIAL ORDER *********
  // Both the walk and the slice below run over `items` in VOLUME order, and a
  // volume order is a size order, not a position order — but after R20's
  // per-polygon explosion the caps actually BIND (measured hatch candidates:
  // Powell 113, Dublin 118, Columbus and Chicago AT the 120 sub-cap), and the
  // remainder past the genuine towers is a flat field of near-identical blocks
  // whose relative volume order is essentially the MVT feature order that
  // produced them. MVT feature order is spatially CLUSTERED. So the cap gets
  // spent on one corner of the tile and the rest of it renders nothing —
  // patchiness inside a single chunk.
  //
  // This is a solved problem in this file, twice: buildSatBuildings got
  // volume-stratified + hash-strided selection in R18/R20, and the toy building
  // pass got the same treatment in R19 F with the finding stated outright —
  // "the shuffle is load-bearing: MVT feature order is spatially clustered, so
  // a plain stride keeps one corner of the tile". buildSatSkyline got NEITHER.
  // TILE_PIPELINE.skylineShuffle ports it:
  //   1. the top `anchorCount` (60) by volume are admitted unconditionally —
  //      real towers ARE the skyline and must never lose a coin flip;
  //   2. the remainder is walked in FNV-1a order of the item's stable id (the
  //      per-polygon `pid` under SAT_POLY_COVER, the feature id otherwise), so
  //      the fill is an even sample of the whole tile;
  //   3. FS.areaMaxPerChunk still sub-caps hatch blocks inside that walk,
  //      which is why this is a WALK and not the precedent's fixed-size
  //      fractional stride — a stride cannot skip a rejected member.
  // EMISSION ORDER IS THEN RESTORED TO VOLUME ORDER (`items.filter`), so on a
  // tile where no cap binds the selected SET *and* its order are identical to
  // R20's and the bundle is byte-for-byte unchanged. Only genuinely capped
  // tiles move — which is what plan §5.2 sanctions.
  let selected;
  const capN = PC.enabled ? PC.skyline.maxPerChunk : SK.maxPerChunk;
  if (TILE_PIPELINE.enabled && TILE_PIPELINE.skylineShuffle) {
    const SS = TILE_PIPELINE.skylineShuffle;
    // MEASURED, and the reason `skipDegenerate` exists at all. A volume order
    // is self-selecting for renderability: the biggest polygons always survive
    // `simplifyRing(SK.simplifyTol)`. A hash order is NOT — it draws uniformly
    // from a population that at a dense z14 core is mostly tiny (the tall pick
    // is deliberately area-free, so every 200 m² Manhattan lot is an item), and
    // a tiny ring simplifies below 3 points and emits NOTHING. Measured on the
    // 3x3 around 40.7549/-73.984 with the fill unfiltered: 300 polygons
    // selected per capped tile but only ~193 renderable, i.e. a THIRD of the
    // chunk budget bought empty space and the far skyline thinned 2,207 -> 1,787
    // blocks. Testing renderability BEFORE spending a cap slot is the fix, and
    // it costs one extra simplifyRing per candidate walked — cheap next to the
    // earcut + classify this function has already paid for the same ring.
    const renders = (it) => {
      if (!SS.skipDegenerate) return true;
      for (const p of it.polys) if (simplifyRing(p.outer, SK.simplifyTol).length >= 3) return true;
      return false;
    };
    const chosen = new Set();
    let nHatch = 0;
    const admit = (it, checkRender) => {
      if (chosen.size >= capN) return;
      if (checkRender && !renders(it)) return;
      if (FS.enabled && it.hatch) {
        if (nHatch >= FS.areaMaxPerChunk) return;
        nHatch += 1;
      }
      chosen.add(it);
    };
    // The anchors are admitted UNCONDITIONALLY — a real tower never loses a
    // coin flip, and it never fails the render test anyway.
    const anchorN = Math.min(SS.anchorCount, items.length);
    for (let i = 0; i < anchorN; i++) admit(items[i], false);
    const rest = items.slice(anchorN);
    rest.sort((a, b) => fnv1aId(a.id) - fnv1aId(b.id) || a.id - b.id);
    for (const it of rest) {
      if (chosen.size >= capN) break;
      admit(it, true);
    }
    selected = items.filter((it) => chosen.has(it)); // back to volume order
  } else if (FS.enabled) {
    selected = [];
    let nHatch = 0;
    for (const it of items) {
      if (selected.length >= capN) break;
      if (it.hatch) {
        if (nHatch >= FS.areaMaxPerChunk) continue;
        nHatch += 1;
      }
      selected.push(it);
    }
  } else {
    selected = items.slice(0, capN);
  }

  const acc = { pos: [], col: [], idx: [], anchor: [], vtx: 0 };
  const haze = hexToRGB(SK.hazeColor);
  for (const item of selected) {
    const wall = hexToRGB(pickByHash(S.wallTones, item.id)).map(
      (c, i) => c + (haze[i] - c) * SK.hazeMix
    );
    // Round 20 (A): one polygon per item under the flag ⇒ this is the BLOCK's
    // own centroid, and the anchor RUN it opens is the block's drape group
    // (sat-skyline-engine bilinear-samples once per run). anchorPoly is only
    // set by the perPolyDrape:false A/B control.
    const outer = (item.anchorPoly ?? item.polys[0]).outer;
    let axT = 0;
    let ayT = 0;
    for (const p of outer) {
      axT += p.x;
      ayT += p.y;
    }
    const [anchorX, anchorZ] = toLocal(axT / outer.length, ayT / outer.length);
    const pushV = (px, py, y, colArr) => {
      const [lx, lz] = toLocal(px, py);
      acc.pos.push(lx, y, lz);
      acc.col.push(colArr[0], colArr[1], colArr[2]);
      acc.anchor.push(anchorX, anchorZ);
      return acc.vtx++;
    };
    const roofY = item.h;
    const bottomY = -S.baseSinkM;
    for (const poly of item.polys) {
      const ring = simplifyRing(poly.outer, SK.simplifyTol);
      if (ring.length < 3) continue;
      const flat = [];
      for (const p of ring) flat.push(p.x, p.y);
      const tris = earcut(flat);
      if (tris.length === 0) continue;
      const base = acc.vtx;
      for (const p of ring) pushV(p.x, p.y, roofY, wall);
      for (let t = 0; t < tris.length; t += 3) {
        acc.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
      }
      for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
        const a = ring[j];
        const b = ring[e];
        const i0 = pushV(a.x, a.y, bottomY, wall);
        const i1 = pushV(b.x, b.y, bottomY, wall);
        const i2 = pushV(b.x, b.y, roofY, wall);
        const i3 = pushV(a.x, a.y, roofY, wall);
        acc.idx.push(i0, i2, i1, i0, i3, i2);
      }
    }
  }

  const transfer = [];
  if (acc.idx.length > 0) {
    const pos = new Float32Array(acc.pos);
    const col = new Float32Array(acc.col);
    const anchor = new Float32Array(acc.anchor);
    const idx = acc.vtx > 65535 ? new Uint32Array(acc.idx) : new Uint16Array(acc.idx);
    out.satSkyline = { pos, col, idx, anchor };
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer);
  }
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero'); // selected, but every ring simplified below 3 points
  return transfer.length ? transferResult(out, transfer) : out;
}

/** Local clamp (buildSatBuildings keeps its own inside its closure). */
function clamp01Range(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- Round 18 (A1) — the GROUND-LIFE fork ('sat-veg') ------------------------
// A3 GROUNDSKEEPER's data source; frozen at A1's merge like the skyline branch.
// Early-return, same as the other satellite paths.
//
// This is a PORT of the toy set-dressing scatter recipe (deterministic tile-seed
// RNG → bbox rejection sampling inside park/landcover polygons), written as NEW
// code: the toy scatter block is frozen, so nothing there is called or changed.
// The recipe is reused, not the function.
//
// Outputs (all additive, all sentinel-safe):
//   out.satVeg  Float32Array of rows [xLocal, zLocal, radiusM, kind]
//               kind 0 = broadleaf, 1 = conifer. Capped SAT_VEG.maxPerChunk.
//   out.satVegCls  (round 19, SAT_GROUND_LIFE-gated) Uint8Array, ONE entry per
//               satVeg ROW: 1 park · 2 wood · 3 grass · 4 residential ·
//               5 farmland · 6 orchard. 0 reserved/never written.
//   out.satTint (round 19, SAT_TINT-gated) { pos, col, idx, cls } merged
//               low-poly landcover for the albedo tint — see the block above
//               its build for the full contract.
//   out.satPts  { water: Float32Array [x,z]*, ind: Float32Array [x,z]* }
//               anchor points for the ambient movers: `water` is sampled
//               STRICTLY inside water polygons (with clearance, so a boat never
//               spawns on a shoreline) and `ind` inside landuse=industrial
//               (steam plumes). Real data only — nothing is invented.
// Sizes/density come from TOY_WORLD.trees (the same recipe's own tunables);
// SAT_VEG owns the cap and everything the LAYER decides (pool, palette, fade).
function buildSatVeg(vt, frame) {
  const { tileSpan, mercX0, mercYTop, cx, cz, z, x, y, t0 } = frame;
  const out = { empty: true, tessMs: 0, v: WORKER_PROTOCOL };
  const V = SAT_VEG;
  const T = TOY_WORLD.trees;
  // Round 21 (D PIPELINE) — the `vegMeta` telemetry at the tail of this
  // function is a full SECOND parse of the tile (its own landuse walk PLUS a
  // classifyRingsSat over every building feature), it is not read by any
  // engine or component, and before R21 it ran on EVERY sat-veg tile in
  // production. It is opt-in now: `api.setDiag(true)`. With TILE_PIPELINE off
  // the old always-on behavior is restored exactly.
  const wantVegMeta =
    PARCEL_HOMES.enabled && (!TILE_PIPELINE.enabled || !TILE_PIPELINE.diagMetaDefaultOff || diag);
  // Same tile-seed mix the toy scatter uses — deterministic per tile, so the
  // same park grows the same trees in every session and across re-streams.
  const rand = mulberry32((z * 73856093) ^ (x * 19349663) ^ (y * 83492791));
  const veg = [];
  // --- Round 19 (A HOMESTEAD) — per-class scatter, FROZEN at A's W1 merge ---
  // C GROUNDTRUTH consumes this. Gated on C's own SAT_GROUND_LIFE.enabled so
  // that through Wave 1 the emission is BYTE-IDENTICAL to R18 and verify-veg's
  // canopy counts / A/B crops cannot move.
  //
  // TWO deliberate encoding choices, both fail-safe:
  //   * Row slot 3 (`kind`) KEEPS its R18 meaning — 0 broadleaf, 1 conifer —
  //     i.e. it is the FORM, never the class. SatVegLayer tests it as
  //     `veg[i*4+3] > 0.5`, a THRESHOLD, so had the class been packed there
  //     every new class would silently have rendered as a conifer. New classes
  //     draw their form from their own coniferFrac and read correctly even if
  //     C never plumbs the class array at all.
  //   * The class rides a PARALLEL Uint8Array (`out.satVegCls`, one entry per
  //     row), so the stride stays 4. Three call sites depend on that stride
  //     (SatVegLayer's `veg.length / 4` + its three index reads, and
  //     sat-veg-engine's `vegPts` telemetry) and none of them has to move.
  // Class ids: 1 park · 2 wood · 3 grass · 4 residential · 5 farmland ·
  // 6 orchard. 0 is RESERVED and never written — the sat-roads class-code
  // idiom, so a missing/absent array reads 0 and can be treated as "unknown".
  const GL = SAT_GROUND_LIFE;
  const perClass = GL.enabled;
  const vegCls = [];
  // House-avoidance mask. Rejecting points near building footprints is a
  // worker-side job because the building layer is in THIS tile — the layer
  // would have to re-fetch it. A per-sample scan over every footprint is
  // O(samples x buildings) and Manhattan ships 1,400 of them, so the mask is a
  // coarse occupancy grid instead: mark every cell an inflated footprint bbox
  // touches, then reject in O(1). Cell size is ~19 m at z14, so rejection is
  // conservative (it can over-reject by up to a cell) — trees never stand in
  // a living room, which is the direction that matters.
  const AVOID_GRID_N = 128;
  let avoidMask = null;
  // Round 21 (D PIPELINE): when the telemetry IS armed, its building-polygon
  // census is folded into this walk instead of running a third pass over the
  // same layer — `f.loadGeometry()` (the pbf geometry decode) is the dominant
  // cost and it is already being paid here. -1 = not folded, so the tail falls
  // back to its own pass if this walk did not run.
  let foldBldPolys = -1;
  let foldBldFeats = -1;
  // Round 20 (B): the parcel-anchor pass below wants the SAME mask, so the
  // build condition widens by one term. It is a pure input to sample
  // REJECTION — with PARCEL_HOMES off the condition and the mask are exactly
  // R19's, and with SAT_GROUND_LIFE off nothing reads it but B's pass.
  if ((perClass || PARCEL_HOMES.enabled) && GL.houseAvoidM > 0) {
    const bl = vt.layers.building;
    if (bl) {
      const bScale = tileSpan / bl.extent;
      const inflate = GL.houseAvoidM / bScale; // metres → tile units
      const cell = bl.extent / AVOID_GRID_N;
      const mask = new Uint8Array(AVOID_GRID_N * AVOID_GRID_N);
      if (wantVegMeta) {
        foldBldPolys = 0;
        foldBldFeats = 0;
      }
      for (let i = 0; i < bl.length; i++) {
        const f = bl.feature(i);
        if (f.type !== 3) continue;
        const geom = f.loadGeometry();
        if (wantVegMeta) {
          // Byte-identical to the tail's own census (same layer, same extent,
          // same clip+classify) — it just reuses this decode.
          foldBldFeats += 1;
          foldBldPolys += classifyRingsSat(
            geom.map((r) => clipRing(r, bl.extent)).filter((r) => r.length >= 3)
          ).length;
        }
        for (const ring of geom) {
          let x0 = Infinity;
          let y0 = Infinity;
          let x1 = -Infinity;
          let y1 = -Infinity;
          for (const p of ring) {
            if (p.x < x0) x0 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.x > x1) x1 = p.x;
            if (p.y > y1) y1 = p.y;
          }
          const cx0 = Math.max(0, Math.floor((x0 - inflate) / cell));
          const cy0 = Math.max(0, Math.floor((y0 - inflate) / cell));
          const cx1 = Math.min(AVOID_GRID_N - 1, Math.floor((x1 + inflate) / cell));
          const cy1 = Math.min(AVOID_GRID_N - 1, Math.floor((y1 + inflate) / cell));
          for (let gy = cy0; gy <= cy1; gy++)
            for (let gx = cx0; gx <= cx1; gx++) mask[gy * AVOID_GRID_N + gx] = 1;
        }
      }
      // Mask coordinates are in the BUILDING layer's extent; scatter layers may
      // use a different extent, so the test normalises by each layer's own.
      avoidMask = { mask, n: AVOID_GRID_N };
    }
  }

  /**
   * @param layerName   OMT layer to scatter over
   * @param classFilter predicate on feature properties (null = all)
   * @param coniferFrac share of samples that take the conifer FORM
   * @param cls         round 19 class id written to the parallel array
   * @param areaPerM2   round 19 per-class density; defaults to the R18 value
   * @param avoid       round 19: reject samples over building footprints
   */
  const scatter = (layerName, classFilter, coniferFrac, cls = 0, areaPerM2 = 0, avoid = false) => {
    const layer = vt.layers[layerName];
    if (!layer) return;
    const scale = tileSpan / layer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    const perTree = areaPerM2 > 0 ? areaPerM2 : T.areaPerTreeM2;
    const useMask = avoid && avoidMask ? avoidMask : null;
    const maskScale = useMask ? useMask.n / layer.extent : 0;
    for (let i = 0; i < layer.length; i++) {
      if (veg.length / 4 >= V.maxPerChunk) return;
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      if (classFilter && !classFilter(f.properties)) continue;
      const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
      const polys = classifyRingsSat(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
      for (const poly of polys) {
        const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
        let want = Math.min(
          Math.floor(areaM2 / perTree),
          V.maxPerChunk - veg.length / 4
        );
        if (want <= 0) continue;
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
          // Round 19: reject a sample standing on a building. Costs one array
          // read; runs only for the classes that opted in (`avoid`), so the
          // R18 park/wood/grass passes keep their exact rand() sequence and
          // therefore their exact output.
          if (useMask) {
            const gx = (sx * maskScale) | 0;
            const gy = (sy * maskScale) | 0;
            if (
              gx >= 0 &&
              gy >= 0 &&
              gx < useMask.n &&
              gy < useMask.n &&
              useMask.mask[gy * useMask.n + gx]
            )
              continue;
          }
          const [lx, lz] = toLocal(sx, sy);
          veg.push(lx, lz, T.minR + rand() * (T.maxR - T.minR), rand() < coniferFrac ? 1 : 0);
          if (perClass) vegCls.push(cls);
          want -= 1;
        }
      }
    }
  };
  // Parks/grass read as broadleaf street/park trees; `wood` landcover mixes in
  // conifers (that class is where real forest lives).
  scatter('park', null, 0.1, 1);
  scatter('landcover', (p) => p.class === 'wood', 0.35, 2);
  scatter('landcover', (p) => p.class === 'grass', 0.08, 3);
  // --- Round 19 per-class passes, APPENDED (order is load-bearing) ----------
  // They must come AFTER the R18 three: SatVegLayer decimates with a stable
  // index stride over emission order, so inserting a class earlier would
  // change which park trees survive in a dense tile. Appending only changes
  // the survivor set once the flag is ON — which is C's re-certification, not
  // a W1 regression.
  //
  // MEASURED justification (live 3x3 z14): Powell OH carries 1.75 km² of
  // landuse=residential and Dublin OH 11.96 km², against a `building` layer
  // that ships ~1 footprint per tile. Residential landcover is where American
  // suburbia actually IS in this dataset.
  //
  // `neighbourhood` is deliberately NOT included: it is a place polygon, not
  // landcover (Columbus ships 24.2 km² of it, spanning commercial cores), and
  // scattering a canopy over it would green the downtown. Noted for C.
  if (perClass) {
    const A = GL.areaPerTreeM2;
    scatter('landuse', (p) => p.class === 'residential', 0.15, 4, A.residential, true);
    scatter('landcover', (p) => p.class === 'farmland', 0.1, 5, A.farmland, true);
    scatter('landcover', (p) => p.class === 'orchard', 0, 6, A.orchard, true);
    scatter('landuse', (p) => p.class === 'orchard', 0, 6, A.orchard, true);
  }

  // --- ambient anchor points -------------------------------------------------
  // Per-TILE caps, bounded by the GLOBAL pools A3 draws from: one tile can
  // never hand the layer more anchors than its whole pool holds.
  const nWaterMax = Math.min(40, SAT_AMBIENT.boats.max);
  const nIndMax = Math.min(6, SAT_AMBIENT.plumes.max);
  const waterPts = [];
  const indPts = [];

  // Anchor points spread over a layer's polygons, AREA-PROPORTIONALLY. Two
  // passes: collect the qualifying polygons with their areas, then give each a
  // share of `maxPts` proportional to its area (minimum 1, so a small marina
  // still gets a boat). One-point-per-polygon was the obvious first cut and it
  // is wrong here — a harbour tile is typically ONE enormous water polygon, so
  // it handed A3 a single anchor for a whole bay.
  const sampleInside = (layerName, classFilter, outArr, maxPts, clearanceM) => {
    const layer = vt.layers[layerName];
    if (!layer || maxPts <= 0) return;
    const scale = tileSpan / layer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    const clr = clearanceM / scale; // meters → tile units
    const cand = [];
    let totalArea = 0;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      if (classFilter && !classFilter(f.properties)) continue;
      const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
      const polys = classifyRingsSat(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
      for (const poly of polys) {
        const a = Math.abs(signedArea(poly.outer)) * 0.5;
        if (a <= 0) continue;
        cand.push({ poly, a });
        totalArea += a;
      }
    }
    if (cand.length === 0 || totalArea <= 0) return;
    // biggest first: if rejection sampling fails on a fiddly polygon the budget
    // still lands on the bodies of water that actually read from the air
    cand.sort((p, q) => q.a - p.a);
    for (const c of cand) {
      const have = outArr.length / 2;
      if (have >= maxPts) return;
      const want = Math.min(
        maxPts - have,
        Math.max(1, Math.round((c.a / totalArea) * maxPts))
      );
      const ring = c.poly.outer;
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
      let placed = 0;
      for (let tries = want * 10; tries > 0 && placed < want; tries--) {
        const sx = minX + rand() * (maxX - minX);
        const sy = minY + rand() * (maxY - minY);
        // STRICTLY inside: the point AND a clearance box around it. A boat
        // spawned on a shoreline pixel reads as a beached bug.
        if (!pointInPoly(c.poly, sx, sy)) continue;
        if (
          !pointInPoly(c.poly, sx - clr, sy - clr) ||
          !pointInPoly(c.poly, sx + clr, sy + clr) ||
          !pointInPoly(c.poly, sx - clr, sy + clr) ||
          !pointInPoly(c.poly, sx + clr, sy - clr)
        )
          continue;
        const [lx, lz] = toLocal(sx, sy);
        outArr.push(lx, lz);
        placed += 1;
      }
    }
  };
  sampleInside('water', (p) => p.class !== 'swimming_pool', waterPts, nWaterMax, 60);
  sampleInside('landuse', (p) => p.class === 'industrial', indPts, nIndMax, 30);

  // --- Round 20 (B PARCEL-HOMES) — DEDICATED residential parcel anchors ------
  // SatParcelHomes could have ridden the cls-4 scatter rows above (that is what
  // SatHouseLights does, and what B's charter assumed). MEASURED, over a live
  // 3x3 at z14, that source is not fit for a BUILDING layer:
  //
  //   scene            landuse=residential   cls-4 anchors   anchors / km² res
  //   Craigieburn AU        22.72 km²              0               0.0
  //   Melton AU             22.85 km²            600              26.3
  //   Piaseczno PL          20.43 km²            183               9.0
  //   Hamilton NZ           21.68 km²            192               8.9
  //   Blagnac FR            17.89 km²            257              14.4
  //   Dublin OH             11.16 km²            506              45.4
  //   Powell OH              1.64 km²            657             401.3
  //
  // The cls-4 rows are the LEFTOVERS of SAT_VEG.maxPerChunk (400/tile, spent in
  // emission order with residential LAST — R19's own frozen comment says so).
  // Every scene above with a big suburb is scatter-CAPPED in 6-9 of its 9
  // tiles, so the number of houses a town gets would be a function of how much
  // park and woodland happened to be mapped near it, and Craigieburn — 22.7 km²
  // of Melbourne suburbia — would get exactly none. That is not a density knob,
  // it is a coin flip.
  //
  // So the anchors are sampled HERE, independently, with:
  //   * their OWN mulberry32 stream. Not the shared `rand`: even appended last,
  //     sharing it would couple B's cap to the veg output the moment anything
  //     upstream changed, and the whole point is that verify-veg's canopy
  //     counts cannot move. With a separate stream the satVeg rows are
  //     bit-identical whether this pass runs or not — provable by construction,
  //     not by re-measuring.
  //   * their own AREA-based density (PARCEL_HOMES.anchors.areaPerM2) and their
  //     own per-tile cap, so a suburb's anchor count is a function of the
  //     suburb's area and nothing else.
  //   * the SAME building-occupancy mask the R19 residential canopy uses —
  //     which is built from EVERY ring of EVERY polygon feature in the tile's
  //     `building` layer (see AVOID_GRID_N above), i.e. it was already per-
  //     POLYGON and A SPRAWL's per-polygon explosion could not have made it
  //     stale. A parcel anchor cannot land on a mapped footprint.
  // Output: out.satParcel, Float32Array of TILE-LOCAL [x, z] pairs.
  const parcelPts = [];
  if (PARCEL_HOMES.enabled) {
    const PA = PARCEL_HOMES.anchors;
    const layer = vt.layers.landuse;
    if (layer && PA.maxPerChunk > 0) {
      const prand = mulberry32(
        ((z * 40503) ^ (x * 55621) ^ (y * 12289) ^ 0x5f37) >>> 0
      );
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const useMask = avoidMask;
      const maskScale = useMask ? useMask.n / layer.extent : 0;
      for (let i = 0; i < layer.length; i++) {
        if (parcelPts.length / 2 >= PA.maxPerChunk) break;
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.class !== 'residential') continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        for (const poly of classifyRingsSat(rings.filter((r) => r.length >= 3))) {
          const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
          let want = Math.min(
            Math.floor(areaM2 / PA.areaPerM2),
            PA.maxPerChunk - parcelPts.length / 2
          );
          if (want <= 0) continue;
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
            const sx = minX + prand() * (maxX - minX);
            const sy = minY + prand() * (maxY - minY);
            if (!pointInPoly(poly, sx, sy)) continue;
            if (useMask) {
              const gx = (sx * maskScale) | 0;
              const gy = (sy * maskScale) | 0;
              if (
                gx >= 0 &&
                gy >= 0 &&
                gx < useMask.n &&
                gy < useMask.n &&
                useMask.mask[gy * useMask.n + gx]
              )
                continue;
            }
            const [lx, lz] = toLocal(sx, sy);
            parcelPts.push(lx, lz);
            want -= 1;
          }
        }
      }
    }
  }

  // --- Round 19 (A HOMESTEAD) — satTint, FROZEN at A's W1 merge -------------
  // Merged low-poly landcover for C GROUNDTRUTH's SatTintLayer: ONE pooled
  // mesh, MultiplyBlending at low alpha, draped on the veg chunk grid. Emitted
  // flat at y = 0 in TILE-LOCAL coordinates — the satWater layout — so the
  // consumer can reuse the existing world-bend-fade-r8 base variant with no
  // GLSL change and no cache-key move.
  //
  // Shape: { pos Float32Array [x,0,z]*, col Float32Array [r,g,b]*,
  //          idx Uint16/32Array, cls Uint8Array (per VERTEX) }
  // `col` honours the contract literally (a consumer can upload it as vertex
  // colours untouched) and is resolved here from SAT_TINT.palette; `cls`
  // carries the per-class id so C can re-map the palette WITHOUT a re-stream
  // if it re-tunes. Class ids match the veg scatter: 1 park · 2 wood ·
  // 3 grass · 5 farmland. 0 reserved, never written.
  //
  // Gated on C's SAT_TINT.enabled: nothing consumes it in Wave 1, so leaving
  // it off keeps the worker's per-tile cost at exactly R18.
  //
  // WARNING FOR C, measured: the `park` LAYER is administrative, not
  // landcover. Owens Valley ships 29.87 km² of park:national_scenic_area over
  // a 3x3 — desert, not lawn — so a green park tint there would paint the
  // Mojave. maxTileFrac below drops region-scale polygons for exactly that
  // reason, but if the park tint still reads wrong in the desert the honest
  // fix is to drop `park` from the palette and tint only real landcover.
  const TN = SAT_TINT;
  const satTint = { pos: [], col: [], idx: [], cls: [], vtx: 0 };
  if (TN.enabled) {
    const TINT_MIN_AREA_M2 = 20000; // smaller parcels are sub-pixel where tint is read
    const TINT_MAX_TILE_FRAC = 0.4; // drops administrative mega-polygons (see above)
    const TINT_SIMPLIFY_TOL = 8; // tile units — this is a colour wash, not a shape
    const TINT_MAX_POLYS = 60; // per-tile ceiling (the tris ledger, §5)
    const tintSrc = [
      ['park', null, 1, TN.palette.park],
      ['landcover', 'wood', 2, TN.palette.wood],
      ['landcover', 'grass', 3, TN.palette.grass],
      ['landcover', 'farmland', 5, TN.palette.farmland],
    ];
    let nPolys = 0;
    for (const [layerName, cls, clsId, hex] of tintSrc) {
      const layer = vt.layers[layerName];
      if (!layer || !hex) continue;
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const tileAreaM2 = (layer.extent * scale) ** 2;
      const rgb = hexToRGB(hex);
      for (let i = 0; i < layer.length && nPolys < TINT_MAX_POLYS; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        if (cls && f.properties.class !== cls) continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        const polys = classifyRingsSat(rings.filter((r) => r.length >= 3));
        for (const poly of polys) {
          if (nPolys >= TINT_MAX_POLYS) break;
          const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
          if (areaM2 < TINT_MIN_AREA_M2) continue;
          if (areaM2 > tileAreaM2 * TINT_MAX_TILE_FRAC) continue;
          const ring = simplifyRing(poly.outer, TINT_SIMPLIFY_TOL);
          if (ring.length < 3) continue;
          const flat = [];
          for (const p of ring) flat.push(p.x, p.y);
          const tris = earcut(flat);
          if (tris.length === 0) continue;
          const base = satTint.vtx;
          for (const p of ring) {
            const [lx, lz] = toLocal(p.x, p.y);
            satTint.pos.push(lx, 0, lz);
            satTint.col.push(rgb[0], rgb[1], rgb[2]);
            satTint.cls.push(clsId);
            satTint.vtx += 1;
          }
          // MVT exteriors wind CW in y-down tile coords → flip to face up
          for (let t = 0; t < tris.length; t += 3) {
            satTint.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
          }
          nPolys += 1;
        }
      }
    }
  }

  const transfer = [];
  if (veg.length > 0) {
    const satVeg = new Float32Array(veg);
    out.satVeg = satVeg;
    out.empty = false;
    transfer.push(satVeg.buffer);
    // Round 19: the parallel per-row class array (see the encoding note at the
    // top of this function). Absent entirely when SAT_GROUND_LIFE is off, so a
    // consumer must read it as `result.satVegCls ?? null` and fall back to
    // treating every row as class 0 / unknown.
    if (perClass && vegCls.length === veg.length / 4) {
      const satVegCls = new Uint8Array(vegCls);
      out.satVegCls = satVegCls;
      transfer.push(satVegCls.buffer);
    }
  }
  if (satTint.idx.length > 0) {
    const pos = new Float32Array(satTint.pos);
    const col = new Float32Array(satTint.col);
    const cls = new Uint8Array(satTint.cls);
    const idx = satTint.vtx > 65535 ? new Uint32Array(satTint.idx) : new Uint16Array(satTint.idx);
    out.satTint = { pos, col, idx, cls };
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, cls.buffer, idx.buffer);
  }
  if (waterPts.length > 0 || indPts.length > 0) {
    const water = new Float32Array(waterPts);
    const ind = new Float32Array(indPts);
    out.satPts = { water, ind };
    out.empty = false;
    transfer.push(water.buffer, ind.buffer);
  }
  // Round 20 (B): absent entirely with the flag off, and absent (not empty) on
  // a tile with no residential landuse — the sat-roads sentinel idiom, read as
  // `result.satParcel ?? null`. A tile that is all farmland must cost nothing.
  if (parcelPts.length > 0) {
    const satParcel = new Float32Array(parcelPts);
    out.satParcel = satParcel;
    out.empty = false;
    transfer.push(satParcel.buffer);
  }
  // --- Round 20 (B PARCEL-HOMES) — per-tile RESIDENTIAL telemetry ------------
  // Pure measurement: SatParcelHomes places off the cls-4 scatter rows above
  // and thins by the REAL streamed footprint density, and both of those claims
  // are claims about the tile DATA. Reading them off the same parse the scatter
  // just used is the only way to state them without a second fetch.
  //
  // `bldPolys === 0` with `resAreaM2 > 0` is THE case this whole layer exists
  // for: a z14 tile that carries landuse=residential but ships no `building`
  // layer at all (buildSatBuildings returns empty for it — worker :1157), which
  // is deep-rural and small-town America and most of the non-US world.
  //
  // Emitted ONLY under the flag (A SPRAWL's skyMeta precedent, same reasons):
  // enabled:false leaves the bundle identical to R19 down to its KEY SET, not
  // merely to its arrays. Additive, deterministic, engines never read it —
  // scripts/r20-b-parcels.js and verify-parcel-homes are the only consumers.
  if (PARCEL_HOMES.enabled) {
    // Round 21 (D PIPELINE) — OPT-IN. The guard above is left intact (it is the
    // one-flag revert contract verify-parcel-homes gate (I) reads from source);
    // this inner test is the production default-off. `wantVegMeta` is computed
    // at the top of the function because the avoidMask walk folds this pass's
    // building census into its own when the telemetry is armed.
    if (wantVegMeta) {
      let resAreaM2 = 0;
      let resPolys = 0;
      const lu = vt.layers.landuse;
      if (lu) {
        const s = tileSpan / lu.extent;
        for (let i = 0; i < lu.length; i++) {
          const f = lu.feature(i);
          if (f.type !== 3 || f.properties.class !== 'residential') continue;
          const rings = f.loadGeometry().map((r) => clipRing(r, lu.extent));
          for (const poly of classifyRingsSat(rings.filter((r) => r.length >= 3))) {
            resAreaM2 += Math.abs(signedArea(poly.outer)) * 0.5 * s * s;
            resPolys += 1;
          }
        }
      }
      // Building POLYGONS (not features) — the per-polygon population A SPRAWL's
      // fix made visible, and the denominator of the anti-duplication scalar.
      let bldPolys = 0;
      let bldFeats = 0;
      const bl2 = vt.layers.building;
      // Round 21: the avoidMask walk already decoded this layer — take its
      // census when it ran (it always does with SAT_GROUND_LIFE/PARCEL_HOMES on
      // and houseAvoidM > 0), and keep the standalone pass as the fallback.
      if (foldBldPolys >= 0) {
        bldPolys = foldBldPolys;
        bldFeats = foldBldFeats;
      } else if (bl2) {
        for (let i = 0; i < bl2.length; i++) {
          const f = bl2.feature(i);
          if (f.type !== 3) continue;
          bldFeats += 1;
          bldPolys += classifyRingsSat(
            f.loadGeometry().map((r) => clipRing(r, bl2.extent)).filter((r) => r.length >= 3)
          ).length;
        }
      }
      let cls4 = 0;
      for (const c of vegCls) if (c === 4) cls4 += 1;
      out.vegMeta = {
        resAreaM2,
        resPolys,
        bldPolys,
        bldFeats,
        hasBuildingLayer: !!bl2,
        cls4,
        rows: veg.length / 4,
        capped: veg.length / 4 >= V.maxPerChunk,
        parcels: parcelPts.length / 2,
      };
    }
  }
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero'); // nothing to scatter, tint, anchor or sample here
  return transfer.length ? transferResult(out, transfer) : out;
}

// --- Round 21 (D PIPELINE) — the tile FETCH pipeline + empty-reason codes ----
//
// Everything in this block is inert with TILE_PIPELINE.enabled:false: the
// legacy branch of `fetchTileBuffer` is the R20 fetch sequence verbatim
// (including its error string), `withReason` writes no key, and the semaphore /
// cache / in-flight map are never consulted. That is the one-flag revert
// contract for this agent's whole surface.
//
// WHY A CACHE LIVES IN THE WORKER AND NOT IN THE ENGINE. Five worker instances
// stream this planet (toy-world, sat-building, sat-road, sat-skyline, sat-veg)
// and THREE of them fetch the SAME z14 URLs — a satellite chunk arriving in
// view costs three identical network round-trips today. Nothing dedupes them:
// each worker is an isolated realm with its own module scope, and the browser
// HTTP cache does not coalesce requests that are already in flight. The Cache
// API is the one store all five share (same-origin `caches`), so it is the only
// place a cross-worker dedupe can be written at all. The in-flight Map handles
// the intra-worker half (an engine re-requesting a tile it has not received
// yet); the Cache handles the cross-worker and cross-SESSION halves.
//
// EVERY cache operation is individually try/caught and degrades to a plain
// fetch. A worker with `caches` unavailable (insecure origin), a quota-full
// origin, or a browser that rejects the put must still stream the world.
//
// NOTE ON THE SOURCE GATES: every reference below spells `TILE_PIPELINE` out
// rather than aliasing it to a short local. verify-neon-cover's gate 3a
// attributes a flag reference to its ENCLOSING top-level function to decide
// whether the flag is toy-path-reachable, and a module-scope alias would hide
// the toy-path reference inside `withReason` from that scan — i.e. the gate
// would report "satellite-only" about a flag the toy tail genuinely reads.
// TILE_PIPELINE **IS** toy-reachable (the toy tail's 'zero' tag and the 404
// 'no-data' tag both run for toy rings) and gate 3a must be able to say so.

/**
 * Diagnostic telemetry switch — see `api.setDiag`. Production default OFF:
 * `vegMeta` costs a full second parse + classifyRingsSat over every building
 * feature of every sat-veg tile and NOTHING in the app reads it (its only
 * consumer is scripts/r20-b-parcels.js).
 */
let diag = false;

/**
 * R22 (C CLUTTER) — "only the two new keys, please" switch; see
 * `api.setClutterOnly`. Set by SatClutterEngine on its OWN worker instance
 * (the setDiag idiom: a worker-global, not a buildTile argument, so no engine
 * that has no stake in it grows a positional parameter). The road ring's
 * worker never sets it and its bundles are unchanged.
 */
let clutterOnly = false;

/**
 * FNV-1a over the four bytes of a uint32 id. The skyline selection needs an
 * order that is (a) deterministic across sessions and machines and (b)
 * uncorrelated with position — MVT feature order is spatially CLUSTERED, so
 * any order derived from the array index keeps one corner of the tile and
 * leaves the rest bare (the toy pass documents the same finding at its own
 * hash shuffle, and buildSatBuildings' R20 selection is built on it).
 * Deliberately NOT the `Math.imul(id, 2654435761)` mixer the two existing
 * shuffles use: buildSatSkyline's per-polygon id is ALREADY a product of that
 * constant (see the SAT_POLY_COVER explosion above), and re-applying the same
 * multiplicative hash to its own output is a weaker decorrelation than a
 * different mixer over the same bits.
 */
function fnv1aId(n) {
  let h = 0x811c9dc5;
  let v = n >>> 0;
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    v >>>= 8;
  }
  return h >>> 0;
}

/**
 * Tag an EMPTY bundle with WHY it is empty (the R21 reason-code contract, read
 * by B STREAMKEEPER's engines):
 *   'no-data'  the upstream tile 404/204'd — this ground genuinely ships no
 *              vector data (open ocean, unmapped desert). Cacheable forever-ish.
 *   'zero'     the tile PARSED and the builder admitted nothing: no matching
 *              layer, a density lock, a minimum-count floor, an area floor, a
 *              vertex budget that produced no indices. Deterministic for the
 *              same input, but it is a decision this code made, not a statement
 *              about the network.
 * A THROW (never an empty result) is the third case: `Error('http-<code>')`,
 * which is a transient upstream condition (429/5xx/timeout) an engine must
 * RETRY rather than cache. Before R21 all three collapsed into one bare
 * `{empty:true}` — a rate-limited tile and an open-ocean tile were literally
 * the same object, so the engines cached both sticky-forever.
 */
function withReason(out, reason) {
  if (TILE_PIPELINE.enabled && TILE_PIPELINE.emptyReasons && out.empty === true) out.reason = reason;
  return out;
}

/** Sentinel: upstream says this tile does not exist (404/204). */
const NO_DATA = { noData: true };

// --- fetch semaphore (per worker instance) ----------------------------------
// Measured across engines: 16 concurrent tile fetches during a warp, from five
// workers that each pump whatever their engine asks for. Browsers cap ~6 per
// host anyway, so the excess only adds queueing jitter and abort-less
// long-tails; capping in the worker makes the queue OURS (and keeps the
// AbortController timeout meaningful — a request that spends 20 s waiting for a
// browser connection slot is not a slow server).
let fetchActive = 0;
const fetchWaiters = [];
function acquireFetch() {
  const lim = TILE_PIPELINE.enabled ? TILE_PIPELINE.maxConcurrentFetches | 0 : 0;
  if (lim <= 0 || fetchActive < lim) {
    fetchActive += 1;
    return Promise.resolve();
  }
  // Slot HANDOFF: the waiter inherits the releasing fetch's count, so
  // `fetchActive` is exactly "slots held" and never double-counts.
  return new Promise((resolve) => fetchWaiters.push(resolve));
}
function releaseFetch() {
  const next = fetchWaiters.shift();
  if (next) next();
  else fetchActive -= 1;
}

// --- Cache API layer --------------------------------------------------------
// `undefined` = never tried · `null` = unavailable (degrade to plain fetch).
let cachePromise;
let cacheTrimmed = false;

function tileCache() {
  if (cachePromise !== undefined) return cachePromise;
  cachePromise = (async () => {
    try {
      if (!TILE_PIPELINE.cache || !TILE_PIPELINE.cache.enabled) return null;
      if (typeof caches === 'undefined') return null;
      const c = await caches.open(TILE_PIPELINE.cache.name);
      if (!cacheTrimmed) {
        cacheTrimmed = true;
        trimCache(c); // fire-and-forget: never on the first tile's critical path
      }
      return c;
    } catch {
      return null;
    }
  })();
  return cachePromise;
}

/**
 * Bound the persistent store. The Cache API preserves INSERTION order in
 * `keys()` and a re-put re-appends, so the head of the list is the oldest
 * `x-cached-at` stamp — the trim needs no per-entry `match()` (which on a
 * 4,000-entry cache would be 4,000 reads on every worker boot).
 */
async function trimCache(c) {
  try {
    const max = TILE_PIPELINE.cache.maxEntries | 0;
    if (max <= 0) return;
    const keys = await c.keys();
    const over = keys.length - max;
    for (let i = 0; i < over; i++) await c.delete(keys[i]);
  } catch {
    /* best effort */
  }
}

async function cacheRead(c, url) {
  try {
    const res = await c.match(url);
    if (!res) return null;
    const at = Number(res.headers.get('x-cached-at') || 0);
    if (res.headers.get('x-fly-nodata') === '1') {
      // A 404 marker is an assertion about the PLANET, but OpenFreeMap ships
      // new planet builds — so it expires. Real tile bodies do not: the URL is
      // dataset-versioned (init() resolves it from the TileJSON), so a new
      // build is a new URL and the old bodies simply age out under maxEntries.
      const ttl = (TILE_PIPELINE.cache.noDataTtlSec | 0) * 1000;
      if (!at || Date.now() - at > ttl) return null;
      return NO_DATA;
    }
    const buf = await res.arrayBuffer();
    // A zero-length body is treated as a MISS rather than as a tile. Measured:
    // OpenFreeMap answers an out-of-range tile with 200 and an empty body, and
    // a truncated/corrupt entry would look the same — a re-fetch of a
    // degenerate tile is cheap, serving garbage as geometry is not. (Such a
    // tile therefore never benefits from the cache; no engine requests one.)
    return buf.byteLength > 0 ? { buf } : null;
  } catch {
    return null;
  }
}

async function cacheWrite(c, url, payload) {
  try {
    const headers = { 'x-cached-at': String(Date.now()) };
    if (payload === NO_DATA) {
      headers['x-fly-nodata'] = '1';
      await c.put(url, new Response(new Uint8Array(0), { headers }));
    } else {
      // `new Response(arrayBuffer)` COPIES the bytes (spec: "extract a body"
      // takes a copy of a BufferSource) — the caller's buffer is neither
      // detached nor aliased, which matters because that buffer is about to be
      // handed to PbfReader.
      await c.put(url, new Response(payload.buf, { headers }));
    }
  } catch {
    /* quota / opaque / unsupported — the tile still streams, just uncached */
  }
}

/** Per-worker in-flight coalescing: url → the one Promise fetching it. */
const inflight = new Map();

async function fetchWithTimeout(url) {
  const ms = TILE_PIPELINE.fetchTimeoutMs | 0;
  if (ms <= 0 || typeof AbortController === 'undefined') return fetch(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } catch (e) {
    // An abort is a TRANSIENT upstream condition, so it must reach the engine
    // as the same typed shape a 5xx does — never as an empty tile.
    if (e && e.name === 'AbortError') throw new Error('http-timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The ONE place a tile body is obtained. Resolves to `{ buf }` or the NO_DATA
 * sentinel; throws `Error('http-<code>')` on every transient failure.
 * @param url the versioned tile URL
 * @param tag legacy error-message prefix (`tile z/x/y`), preserved byte-exactly
 */
async function fetchTileBuffer(url, tag) {
  if (!TILE_PIPELINE.enabled) {
    // --- R20 verbatim ---
    const res = await fetch(url);
    if (res.status === 404 || res.status === 204) return NO_DATA;
    if (!res.ok) throw new Error(`${tag}: ${res.status}`);
    return { buf: await res.arrayBuffer() };
  }
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = (async () => {
    const c = await tileCache();
    if (c) {
      const hit = await cacheRead(c, url);
      if (hit) return hit;
    }
    await acquireFetch();
    let res;
    try {
      res = await fetchWithTimeout(url);
    } finally {
      releaseFetch();
    }
    if (res.status === 404 || res.status === 204) {
      if (c) await cacheWrite(c, url, NO_DATA);
      return NO_DATA;
    }
    if (!res.ok) throw new Error(`http-${res.status}`);
    const buf = await res.arrayBuffer();
    if (c) await cacheWrite(c, url, { buf });
    return { buf };
  })();
  inflight.set(url, p);
  p.catch(() => {}).then(() => {
    if (inflight.get(url) === p) inflight.delete(url);
  });
  return p;
}

// --- worker API --------------------------------------------------------------

const api = {
  /**
   * Round 21 (D PIPELINE) — arm the diagnostic telemetry this worker otherwise
   * does not compute. `vegMeta` (buildSatVeg) is a full SECOND parse plus
   * classifyRingsSat over every building feature of the tile; it is pure
   * measurement, no engine has ever read it, and before R21 it ran on every
   * sat-veg tile in production. It is now opt-in: scripts/r20-b-parcels.js
   * calls `await worker.setDiag(true)` before its sweep.
   *
   * Deliberately NOT a buildTile argument: the engines own the call sites and
   * a new positional argument would move five files that have no stake in
   * telemetry. A worker-global switch also survives across the tile loop the
   * probe drives, which is exactly its lifetime.
   */
  setDiag(v) {
    diag = !!v;
    return diag;
  },

  /**
   * Round 22 (C CLUTTER) — put THIS worker instance in ground-life mode: a
   * 'sat-roads' build returns out.satRoadPaths + out.satParking and skips the
   * ribbon tessellation (pass 2 is ~90% of that builder, and the clutter ring
   * would transfer ~500 KB of glow ribbons per tile only to drop them).
   *
   * A worker-global by the `setDiag` reasoning: the clutter engine owns its own
   * worker for its whole lifetime, and a new positional buildTile argument
   * would move five engines that have no stake in this. Inert unless the
   * caller sets it, so the ROAD ring — which shares the detail string but not
   * the worker — is byte-unchanged.
   */
  setClutterOnly(v) {
    clutterOnly = !!v;
    return clutterOnly;
  },

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
   * land/water/road/scatter passes run (returns early). 'sat-roads' (round 16,
   * A2): the satellite ground-light network — transportation + aeroway runway
   * ribbons, out.satRoads; also returns early. 'sat-skyline' (round 18, A1):
   * the distant z13 block-mass fork, out.satSkyline. 'sat-veg' (round 18, A1):
   * the ground-life scatter, out.satVeg + out.satPts. Both early-return too.
   * Returns {empty:true} when the tile 404s (open ocean is sparse) — the
   * SatBuildingEngine reads that, plus its neighbours' out.waterCoverage, as
   * the OCEAN FILL signal (round 18).
   */
  async buildTile(z, x, y, detail = 'full') {
    // Round 19 (F): the REQUESTED ring, captured before the alias below. Every
    // NEON_COVER threshold is a viewing-distance threshold and 'ultra' (z10,
    // 80 km+) is a different distance band from 'far' (z12, 30 km) even though
    // they share a code path.
    const detailReq = detail;
    if (detail === 'ultra') detail = 'far';
    if (!tileTemplate) await api.init();
    const url = tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    // Round 21 (D PIPELINE): the fetch moved into `fetchTileBuffer` — cache +
    // in-flight coalescing + semaphore + AbortController timeout, all behind
    // TILE_PIPELINE.enabled (with the flag off that function's first branch is
    // these four lines verbatim, error string included). The 404/204 answer is
    // now TAGGED: 'no-data' means the planet ships nothing here, which is a
    // permanently different fact from the 'zero' a builder returns when it
    // parsed a tile and admitted none of it.
    const fetched = await fetchTileBuffer(url, `tile ${z}/${x}/${y}`);
    if (fetched === NO_DATA) return withReason({ empty: true, v: WORKER_PROTOCOL }, 'no-data');
    const buf = fetched.buf;
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
    // (round 15: k rides along — facade UVs need TRUE meters, not mercator.)
    if (detail === 'sat-buildings') {
      return buildSatBuildings(vt, { tileSpan, mercX0, mercYTop, cx, cz, k, t0 });
    }
    // Round 16 (A2): the satellite ground-light network — same early-return
    // shape (out.satRoads only; none of the toy passes below run). k rides
    // along: every arc/decimation threshold is in TRUE meters, not mercator.
    if (detail === 'sat-roads') {
      return buildSatRoads(vt, { tileSpan, mercX0, mercYTop, cx, cz, k, t0 });
    }
    // Round 18 (A1): the two NEW satellite forks W2 consumes. Both early-return
    // exactly like the paths above (out.satSkyline / out.satVeg+out.satPts
    // only) — none of the toy passes below run for them. 'sat-veg' additionally
    // needs the TILE COORDS: its scatter RNG is seeded off (z,x,y) so a park
    // grows the same trees in every session (the toy set-dressing contract).
    if (detail === 'sat-skyline') {
      return buildSatSkyline(vt, { tileSpan, mercX0, mercYTop, cx, cz, k, t0 });
    }
    if (detail === 'sat-veg') {
      return buildSatVeg(vt, { tileSpan, mercX0, mercYTop, cx, cz, z, x, y, t0 });
    }

    const groups = { land: makeGroup(), water: makeGroup() };
    let liftEps = 0; // per-feature stacking epsilon within the tile
    // Round 19 (F): this ring's coverage caps (see NEON_COVER).
    const ncMinArea = NEON_COVER.minAreaM2[detailReq] ?? NEON_COVER.minAreaM2.full;
    const ncMaxFeat =
      NEON_COVER.maxFeaturesPerLayer[detailReq] ?? NEON_COVER.maxFeaturesPerLayer.full;

    const eachFeature = (layerName, fn) => {
      const layer = vt.layers[layerName];
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) fn(layer.feature(i), layer.extent, i);
    };

    const polygonPass = (layerName, colorFor, lift) => {
      // Round 19 (F): per-layer feature budget. Only counts features that
      // actually contributed geometry, and only when NEON_COVER is on — with
      // the flag off `kept` never increments and the budget can never fire.
      let kept = 0;
      eachFeature(layerName, (f, extent) => {
        if (f.type !== 3) return; // polygons only
        if (NEON_COVER.enabled && kept >= ncMaxFeat) return;
        const hex = colorFor(f.properties);
        if (!hex) return;
        const scale = tileSpan / extent;
        const toLocal = (px, py) => [
          mercX0 + px * scale - cx,
          -(mercYTop - py * scale) - cz,
        ];
        const rings = f.loadGeometry().map((ring) => clipRing(ring, extent));
        let polys = classifyToy(rings.filter((ring) => ring.length >= 3));
        if (NEON_COVER.enabled) {
          // Sub-pixel drop, BEFORE earcut. Manhattan's landcover alone goes
          // 506 polygons → 189 at 120 m²; the dropped ones are slivers a toy
          // pilot never resolves. Also guarantees the budget counts real area.
          if (polys.length > 0) {
            const aScale = 0.5 * scale * scale;
            polys = polys.filter((p) => Math.abs(signedArea(p.outer)) * aScale >= ncMinArea);
          }
          if (polys.length === 0) return;
          kept += 1;
        }
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
      // --- ROUND 20 (A SPRAWL) — THE TOY MID RING'S 30 m FLOOR ---------------
      // The z13 'mid' ring covers roughly 8-18 km out, and it admitted only
      // buildings that MAP to >= 30 m. Over a real city that is the skyline and
      // it reads correctly; over everything else it is the whole town missing:
      // measured on the live tileset, the z13 parent of Powell OH emits ZERO
      // building vertices at 'mid', as do Dublin, Columbus, Naperville and
      // Owens (only Manhattan survives the floor). So in Neon a suburb simply
      // stops existing at the ring boundary — the ground keeps going and the
      // town does not.
      //
      // Behind TOY_MID_SUBURB the floor drops to minH (12 m — one storey above
      // TOY_WORLD.buildings.minH, so the ring still refuses to spend its budget
      // on sheds) and the chunk budget rises to maxPerChunkMid. Both are tested
      // in the SAME two places as the legacy 30: the pre-geometry-load skip
      // (raw height) and the post-mapping gate (display height), so the flag
      // cannot admit a building at one site and drop it at the other.
      const TM = TOY_MID_SUBURB;
      const midMinH = TM.enabled ? TM.minH : 30;
      // …and the pre-load skip needs the RAW threshold that can still MAP to
      // midMinH, which is not midMinH itself once the floor drops under
      // smallBoostH: a tagged 9 m building maps to 9 x smallBoost = 12.15 and
      // must survive a 12 m floor. Dividing by smallBoost keeps the skip a
      // strict lower bound (it can never drop a building pass 2 would keep) and
      // is an identity at the legacy 30, which is above smallBoostH.
      const midRawSkip = midMinH < B.smallBoostH ? midMinH / B.smallBoost : midMinH;
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
        // Round 20: `midRawSkip` is 30 with TOY_MID_SUBURB off — byte-identical.
        if (detail === 'mid' && rawH > 0 && rawH < midRawSkip) continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        const polys = classifyToy(rings.filter((r) => r.length >= 3));
        if (polys.length === 0) continue;
        let minY0 = f.properties.render_min_height ?? 0;
        if (minY0 < 0) minY0 = 0;
        const fid = typeof f.id === 'number' ? f.id : i;
        if (NEON_COVER.enabled) {
          // ROUND 19 (F) — THE SECOND DEFECT, and the one that would have kept
          // Powell black even WITH the winding fix. `maxFootprintM2` is meant
          // to reject a single merged mega-ring ("they're districts, not toy
          // buildings"), but it was tested against the SUM of every polygon in
          // the feature. That was harmless only because the broken winding
          // left ~1 polygon per feature. Once classification works, one
          // OpenFreeMap feature routinely carries a whole subdivision:
          //
          //   14/4411/6193 Powell OH — 2 features, 173 polygons; ONE of them
          //     holds 171 houses (median 1396 m²) summing to ~240 000 m² → the
          //     ENTIRE feature tripped the 60 000 m² test and Powell kept 2 of
          //     173 footprints. Manhattan lost 714 polygons the same way,
          //     Brooklyn 121.
          //
          // So under the flag a multipolygon feature EXPLODES into one item per
          // polygon: the footprint test becomes per-building (its documented
          // intent), the per-chunk cap becomes a POLYGON cap (the influx is
          // per-polygon, so a per-feature cap cannot contain it), and — the
          // quiet correctness win — every house gets its OWN centroid anchor.
          // Before this, all 171 houses shared polys[0]'s drape height, i.e.
          // one hillside's worth of floating and buried boxes.
          const aScale = 0.5 * scale * scale;
          // Buildings deliberately use the FULL-ring floor on every ring: they
          // are volumetric, so a slim tower on an 800 m² plate still reads from
          // 18 km and the 'mid' ring exists precisely for that skyline. Only
          // the flat ground layers get the distance-scaled floor.
          const bMinArea = NEON_COVER.minAreaM2.full;
          for (let pi = 0; pi < polys.length; pi++) {
            const p = polys[pi];
            const a = Math.abs(signedArea(p.outer));
            const aM2 = a * aScale;
            if (aM2 < bMinArea) continue;
            if (aM2 > B.maxFootprintM2) continue;
            // Per-polygon id: stable across rebuilds (no RNG), decorrelated
            // from feature order so hash-driven colour/height jitter and the
            // stratified shuffle below both spread over the whole tile.
            const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
            items.push({ polys: [p], area: a, areaM2: aM2, rawH, minY: minY0, id: pid });
          }
          continue;
        }
        let area = 0;
        for (const p of polys) area += Math.abs(signedArea(p.outer));
        const areaM2 = area * 0.5 * scale * scale; // mercator m² (ratio-safe)
        // Merged-block mega-footprints (0.2km²+) extrude into giant floating
        // roof slabs — they're districts, not toy buildings.
        if (areaM2 > B.maxFootprintM2) continue;
        items.push({ polys, area, areaM2, rawH, minY: minY0, id: fid });
      }
      // Round 20 (C2): the marquee monument holes — same three-site fix as the
      // two satellite builders, and Neon needs it just as badly (the Eiffel
      // Tower's base pavilions are streamed toy buildings standing inside the
      // model). Punched BEFORE the district statistics below, which read `items`
      // as this tile's building population.
      const marqueeEx = marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k);
      if (marqueeEx) dropMarqueeFootprints(items, marqueeEx);
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
        if (detail === 'mid' && h < midMinH) continue; // mid ring floor on the MAPPED h (R20: 30 when TOY_MID_SUBURB is off)
        it.h = h;
        it.hash = hash;
        it.litBias = litBias; // stashed for P3 → aEdge.y (window density bias)
        // Elevated footprints (render_min_height): extrude minY→h and float
        // (no baseSinkM). Garbage min ≥ h−3 falls through to a ground slab.
        it.elevated = it.minY > 1 && it.minY < h - 3;
        built.push(it);
      }
      const cap =
        detail === 'mid'
          ? TM.enabled
            ? TM.maxPerChunkMid // round 20: the dropped floor needs room for the town
            : B.maxPerChunkMid
          : NEON_COVER.enabled
            ? NEON_COVER.maxPerChunk
            : B.maxPerChunk;
      // Round 19 (F): the R18 suburb lesson, applied to toy. Sorting by area
      // and slicing keeps the strip malls and drops the house carpet — the
      // exact defect class this round kills in satellite, and with the winding
      // fix landing ~100× more footprints the cap finally BINDS, so it matters
      // here for the first time. Same proven shape as ROOFS_SAT.select: keep
      // the true skyline anchors by volume (areaM2 × h — a slim tower must not
      // lose to a supermarket), then fill the remaining budget by striding a
      // HASH-SHUFFLED remainder. The shuffle is load-bearing: MVT feature order
      // is spatially clustered, so a plain stride keeps one corner of the tile.
      // Deterministic and RNG-free — the same tile builds the same city every
      // session.
      let selected;
      if (NEON_COVER.enabled && NEON_COVER.select.volumeStratified) {
        const ranked = built.slice().sort((a, b) => b.areaM2 * b.h - a.areaM2 * a.h);
        const anchors = ranked.slice(0, NEON_COVER.select.anchorCount);
        const rest = ranked.slice(NEON_COVER.select.anchorCount);
        const room = Math.max(0, cap - anchors.length);
        if (rest.length <= room) {
          selected = anchors.concat(rest);
        } else {
          rest.sort(
            (a, b) => (Math.imul(a.id, 2654435761) >>> 0) - (Math.imul(b.id, 2654435761) >>> 0)
          );
          const step = rest.length / room; // ≥1 ⇒ floor() strictly increasing ⇒ no dupes
          const fill = [];
          for (let i = 0; i < room; i++) fill.push(rest[Math.floor(i * step)]);
          selected = anchors.concat(fill);
        }
      } else {
        built.sort((a, b) => b.area - a.area);
        selected = built.slice(0, cap);
      }
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
      for (const item of selected) {
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
          const polys = classifyToy(rings.filter((r) => r.length >= 3));
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
      // Round 19 (F): the scatter was starved by the SAME winding bug — park
      // and landcover polygons classified to nothing, so toy had essentially no
      // trees anywhere (Powell measured 0). Restored, every green chunk pins
      // TOY_WORLD's ceilings and the blobs alone cost 944k tris at NYC, so
      // NEON_COVER clamps the counts. TOY_WORLD's values are untouched and rule
      // whenever the flag is off.
      const treeCap = NEON_COVER.enabled
        ? Math.min(trees.maxPerChunk, NEON_COVER.scatter.treeMaxPerChunk)
        : trees.maxPerChunk;
      const grassCap = NEON_COVER.enabled
        ? Math.min(grassCfg.maxPerChunk, NEON_COVER.scatter.grassMaxPerChunk)
        : grassCfg.maxPerChunk;
      scatter('park', null, treePts, {
        ...trees,
        maxPerChunk: treeCap,
        areaPerM2: trees.areaPerTreeM2,
      });
      scatter('landcover', (p) => p.class === 'wood' || p.class === 'grass', treePts, {
        ...trees,
        maxPerChunk: treeCap,
        areaPerM2: trees.areaPerTreeM2,
      });
      scatter('park', null, grassPts, { ...grassCfg, maxPerChunk: grassCap });
      scatter('landcover', (p) => p.class === 'grass', grassPts, {
        ...grassCfg,
        maxPerChunk: grassCap,
      });
      // A whole draw call for four blobs is not a trade worth making: below the
      // floor the chunk emits no instancer at all (the engine already skips an
      // empty array). Measured 15 such draws at Powell.
      if (NEON_COVER.enabled) {
        const floor = NEON_COVER.scatter.minInstances * 4;
        if (treePts.length < floor) treePts.length = 0;
        if (grassPts.length < floor) grassPts.length = 0;
      }
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
    // Round 21 (D PIPELINE): the toy ring's own zeroing exit. A tile that
    // parsed but admitted no land/water/building/scatter geometry (an ocean
    // square with no coastline, a ring whose NEON_COVER minArea floor took
    // everything) is 'zero' — distinct from the 404 'no-data' tagged at the
    // fetch. This is the toy path's ONE TILE_PIPELINE reference and it is why
    // verify-neon-cover's gate 3a must count TILE_PIPELINE as toy-reachable.
    withReason(out, 'zero');
    return transferResult(out, transfer);
  },
};

// Mark the result so Comlink moves the buffers instead of cloning them.
function transferResult(value, transferables) {
  return transferables.length ? comlinkTransfer(value, transferables) : value;
}

expose(api);

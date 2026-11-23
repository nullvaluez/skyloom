import { findAirportSurface, registerAirport, retainDiscoveredAirports } from '../operations-airports';
import { operationsFootprint, setAirportLandmarks } from '../operations-scenery';
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

import { expose } from 'comlink';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import earcut from 'earcut';
import { buildEarthSurfaceMask } from '../earth-surface-mask';
import { deriveWorldContent } from '../world-content';
import { loadWorldCover, combineWorldCover } from '../world-cover';
import { buildAirfieldTile } from '../airfield/airfield-tile';
import { PALETTE, hexToRGB, pickByHash } from './toy-palette';
import {
  BEACONS,
  RING_DEDUPE,
  NEON_COVER,
  ROOFS,
  RUNWAY_LIGHTS,
  TILE_PIPELINE,
  TOY_MID_SUBURB,
  TOY_WORLD,
} from '../fly-constants';
import { signedArea, classifyRings, classifyRingsSat, clipRing, pointInPoly, mulberry32, clipSegment, ringCentroid, simplifyRing, pushGable, pushParapet, pushHvacBoxes, marqueeExclusionTile, dropMarqueeFootprints } from './worker/geom';
import { withReason, transferResult } from './worker/result';
import { createTileCtx } from './worker/tile-ctx';
// WORLD PASS B begin
import { worldPassOf } from './worker/tile-ctx';
// WORLD PASS B end
import { buildSatBuildings } from './worker/sat-buildings/index';
// WORLD PASS D begin
import { lookBegin, lookFarBegin, lookAfterBuild, lookRoofPatch } from './worker/look-roofs';
// WORLD PASS D end
import { buildSatRoads } from './worker/sat-roads';
import { buildSatSkyline } from './worker/sat-skyline';
import { buildSatVeg } from './worker/sat-veg';
// HORIZON FILL C begin
import { createBundleCache, bundleKey, bundleCacheable, BUNDLE_DEFAULTS } from './worker/bundle-cache';
import { regionalFrame, photoConfig } from './worker/photo-sampler';
// HORIZON FILL C end

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
// Observation lounge (no bump): the additive 'sat-airport' detail carries its
//     own payload revision (AIRFIELD_TILE_REVISION) and its consumer owns a
//     fresh worker per load; see the dispatch site in buildTile.
const WORKER_PROTOCOL = 27; // World Pass wave 2 (wave 1 was 26, W0 25): the build request carries the resolved World Pass flags; opt-in stage counters

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
let templateRequest = null;

// --- geometry helpers ------------------------------------------------------
// World Pass W0 (worker split): signedArea, classifyRings, classifyRingsSat,
// clipRing, dedupeRing, pointInPoly, mulberry32, clipSegment, ringCentroid,
// simplifyRing, pushGable, pushParapet, pushAABBox, pushHvacBoxes and the
// marquee monument exclusion live in ./worker/geom.js, shared with the
// satellite builders in ./worker/. The toy-only helpers stay below.

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

// --- the two EMISSIVE neon roof helpers (toy only; the shared roof-detail
// helpers they sit beside moved to ./worker/geom.js) ---------------------------
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
// World Pass W0 (worker split): the satellite builders live in ./worker/:
//   sat-buildings/ ('sat-buildings'), sat-skyline.js, sat-roads.js, sat-veg.js,
// each taking the per-build context from ./worker/tile-ctx.js. This file keeps
// the message dispatch, the fetch / Cache API / in-flight coalescing, decode,
// WORKER_PROTOCOL and the modes no World Pass stream changes (Neon/toy,
// earth-surface, sat-airport).

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

async function readWithTimeout(url, read) {
  const ms = TILE_PIPELINE.fetchTimeoutMs | 0;
  if (!TILE_PIPELINE.enabled || ms <= 0 || typeof AbortController === 'undefined') {
    return read(await fetch(url));
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await read(await fetch(url, { signal: ctl.signal }));
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
    let payload;
    try {
      // Headers can arrive long before the bytes. Keep both the slot and the
      // deadline until the body has finished, including a mid-stream stall.
      payload = await readWithTimeout(url, async (res) => {
        if (res.status === 404 || res.status === 204) return NO_DATA;
        if (!res.ok) throw new Error(`http-${res.status}`);
        return { buf: await res.arrayBuffer() };
      });
    } finally {
      releaseFetch();
    }
    if (c) await cacheWrite(c, url, payload);
    return payload;
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
    if (!templateRequest) {
      templateRequest = readWithTimeout(TILEJSON_URL, async (res) => {
        if (!res.ok) throw new Error(`TileJSON ${res.status}`);
        const tj = await res.json();
        if (typeof tj.tiles?.[0] !== 'string' || !tj.tiles[0]) throw new Error('TileJSON missing template');
        tileTemplate = tj.tiles[0];
        return true;
      }).finally(() => { templateRequest = null; });
    }
    return templateRequest;
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
  async buildTile(z, x, y, detail = 'full', options = {}) {
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
    // WORLD PASS D begin (look.roofPhoto: the regional photo starts here; the build never waits for any photo; null otherwise)
    const lookIn = lookBegin(z, x, y, detail, options);
    const lookFar = lookFarBegin(z, x, y, detail, options); // round 3: a far tile's regional photo (null: no wait)
    // WORLD PASS D end
    const fetched = await fetchTileBuffer(url, `tile ${z}/${x}/${y}`);
    // WORLD PASS D begin (round 3: bounded, after the vector fetch, only a far tile with the look on)
    if (lookFar) await lookFar;
    // WORLD PASS D end
    if (fetched === NO_DATA) return withReason({ empty: true, v: WORKER_PROTOCOL }, 'no-data');
    const buf = fetched.buf;
    const t0 = performance.now();
    const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
    const needsCover = detail === 'sat-veg' || detail === 'earth-surface' ||
      (detail === 'sat-airport' && options.cover !== false);
    const cover = needsCover ? await loadWorldCover(z, x, y) : null;
    // Install this request's registry after its final await. Concurrent tiles
    // can carry different runway exclusions while WorldCover is downloading.
    setAirportLandmarks(options.airportLandmarks===true);
    retainDiscoveredAirports([]);
    for(const a of (options.operationsAirports||[]).slice(0,16))registerAirport(a);

    // Observation lounge (AIRFIELD GROUND): the observed airport's own facts —
    // runway/taxiway centrelines with refs, pavement + aerodrome polygons,
    // gates, the aerodrome label, uncapped footprints inside the aerodrome and
    // the tile's WorldCover classes — as out.airfield in absolute scene
    // coordinates (lib/fly/airfield/airfield-tile.js). Early return like every
    // satellite fork. NOT a WORKER_PROTOCOL move: its only consumer
    // (lib/fly/airfield/airfield-data.js) spawns its OWN worker per load, so it
    // is never paired with a stale bundle, and it drops any answer without an
    // `airfield` payload of the expected revision. Every other path is
    // byte-unchanged, so the eight shared pins stay where they are.
    if (detail === 'sat-airport') {
      const airfield = buildAirfieldTile(vt, { z, x, y }, cover, { occluders: options.occluders === true });
      return transferResult({ v: WORKER_PROTOCOL, airfield, tessMs: performance.now() - t0 }, airfield.cover ? [airfield.cover.buffer] : []);
    }

    if (detail === 'earth-surface') {
      const span=WORLD_SIZE/2**z,lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/2**z))),k=1/Math.cos(lat);
      const frame={tileSpan:span,mercX0:x*span-WORLD_SIZE/2,mercYTop:WORLD_SIZE/2-y*span,cx:(x+.5)*span-WORLD_SIZE/2,cz:(y+.5)*span-WORLD_SIZE/2,k};
      const surface = deriveWorldContent(vt,combineWorldCover(buildEarthSurfaceMask(vt, options.size),cover),span,k,frame);
      return transferResult({ v: WORKER_PROTOCOL, surface }, [surface.classes.buffer, surface.blend.buffer, surface.exclusion.buffer, surface.waterEdges.buffer,surface.settlement.buffer,surface.forest.buffer,surface.airport.pos.buffer,surface.airport.uv.buffer,surface.airport.style.buffer]);
    }

    // Tile frame → local world meters (tile center origin)
    const tileSpan = WORLD_SIZE / 2 ** z;
    const mercX0 = -WORLD_SIZE / 2 + x * tileSpan;
    const mercYTop = WORLD_SIZE / 2 - y * tileSpan;
    const cx = mercX0 + tileSpan / 2;
    const cz = -(mercYTop - tileSpan / 2);
    // mercator stretch at tile center (for true-meter ribbon widths)
    const latC = (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
    const k = 1 / Math.cos((latC * Math.PI) / 180);
    // World Pass W0: each satellite builder takes ONE per-build context
    // (./worker/tile-ctx.js): the frame below plus the tile id, the decoded
    // tile, the request (incl. its resolved `worldPass`), the protocol and the
    // two worker-global switches.
    const satCtx = (frame) => createTileCtx(vt, frame, { z, x, y, detail, options, v: WORKER_PROTOCOL, diag, clutterOnly });

    // Round 13 Phase 3: the lean satellite buildings-only path returns EARLY
    // (out.satBuilding) — none of the land/water/road/scatter passes below run.
    // (round 15: k rides along — facade UVs need TRUE meters, not mercator.)
    if (detail === 'sat-buildings') {
      // WORLD PASS D begin (lookIn: the roofs' build-time inputs; lookAfterBuild: the late photo's roof index)
      const ctxD = satCtx({ tileSpan, mercX0, mercYTop, cx, cz, k, t0, visuals: options.visuals === true, trueAreas: options.trueAreas === true, sceneryForms:options.sceneryForms===true,showcaseEarth:options.showcaseEarth===true, ...(lookIn ? lookIn.frame() : null) });
      const outD = buildSatBuildings(ctxD);
      return lookIn ? lookAfterBuild(outD, ctxD) : outD;
      // WORLD PASS D end
    }
    // Round 16 (A2): the satellite ground-light network — same early-return
    // shape (out.satRoads only; none of the toy passes below run). k rides
    // along: every arc/decimation threshold is in TRUE meters, not mercator.
    if (detail === 'sat-roads') {
      return buildSatRoads(satCtx({ tileSpan, mercX0, mercYTop, cx, cz, k, t0 }));
    }
    // Round 18 (A1): the two NEW satellite forks W2 consumes. Both early-return
    // exactly like the paths above (out.satSkyline / out.satVeg+out.satPts
    // only) — none of the toy passes below run for them. 'sat-veg' additionally
    // needs the TILE COORDS: its scatter RNG is seeded off (z,x,y) so a park
    // grows the same trees in every session (the toy set-dressing contract).
    if (detail === 'sat-skyline') {
      // SHIP PASS CITY (CT-1, CT-2): `cityRange` (the dense-core rule) and
      // `premix: false` (the diagnosis pin) ride the request only when set
      // (lib/fly/city-range.js cityRangeRequest); absent, the build is today's.
      return buildSatSkyline(satCtx({ tileSpan, mercX0, mercYTop, cx, cz, k, t0, visuals: options.visuals === true, trueAreas: options.trueAreas === true, cityRange: options.cityRange ?? null, cityHorizon: options.cityHorizon ?? null, premix: options.premix !== false,sceneryForms:options.sceneryForms===true,showcaseEarth:options.showcaseEarth===true }));
    }
    if (detail === 'sat-veg') {
      return buildSatVeg(satCtx({ tileSpan, mercX0, mercYTop, cx, cz, k, z, x, y, t0, worldCover: cover }));
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
            if (!operationsFootprint(p.outer,{tileSpan,mercX0,mercYTop,cx,cz},layer.extent)) items.push({ polys: [p], area: a, areaM2: aM2, rawH, minY: minY0, id: pid });
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
              // R24 B (RING_DEDUPE): the toy twin of the sliver guard above.
              if (
                RING_DEDUPE.enabled &&
                Math.hypot(b.x - a.x, b.y - a.y) < RING_DEDUPE.minEdgeTile
              )
                continue;
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
              if(findAirportSurface(cx+lx,cz+lz,15))continue;
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

// WORLD PASS B begin
// The bundle stamp (FLY_WORLD_PASS.md, "The request"): every result built under
// a request with any stream on carries that request's key as `wp`, so an engine
// drops a bundle built for another flag arm (worldPassMatch). With every flag
// off nothing is stamped and the result is byte-identical.
{
  const build = api.buildTile;
  api.buildTile = async function buildTileStamped(z, x, y, detail, options = {}) {
    const r = await build.call(this, z, x, y, detail, options);
    const wp = worldPassOf(options);
    if (wp.any === true && r && typeof r === 'object') r.wp = wp.key;
    return r;
  };
}
// WORLD PASS B end

// WORLD PASS D begin (look.roofPhoto: the late roof photo of a built tile, asked for by lib/fly/look-roof-patch.js)
api.lookRoofPatch = lookRoofPatch;
// WORLD PASS D end

// HORIZON FILL C begin
// The persistent stand-in bundle cache (./worker/bundle-cache.js), and idle
// pre-builds into it. Only a 'sat-skyline' request carrying
// `horizonFill.bundleCache === true` reaches the cache; every other call goes
// straight to the build above, unchanged. A hit is answered BEFORE the vector
// tile is fetched and is the stored result of an earlier fresh build of the
// same key (the stamped result, `wp` included), with its arrays transferred.
{
  const build = api.buildTile;
  let bundleCfg = BUNDLE_DEFAULTS;
  let bundles = null;
  const cacheOf = () => (bundles ??= createBundleCache(bundleCfg));
  const wants = (detail, options) => detail === 'sat-skyline' && !!options && !!options.horizonFill && options.horizonFill.bundleCache === true;
  // A far tile built with the look on takes its colours from the regional
  // photo when this worker already holds it; one built before the photo
  // arrived is a valid build but not one to keep across sessions.
  const stable = (z, x, y, options) => {
    const look = worldPassOf(options).look;
    return !look.on || !!regionalFrame(z, x, y, photoConfig(look));
  };
  async function cached(z, x, y, detail, options) {
    if (!tileTemplate) await api.init();
    const key = bundleKey({ template: tileTemplate, z, x, y, detail, protocol: WORKER_PROTOCOL, options });
    const hit = await cacheOf().get(key);
    if (hit) return { result: hit.result, transfer: hit.transfer, hit: true, put: null };
    const r = await build.call(api, z, x, y, detail, options);
    const put = !diag && bundleCacheable(r) && stable(z, x, y, options) ? cacheOf().put(key, r) : null;
    return { result: r, transfer: null, hit: false, put };
  }
  api.buildTile = async function buildTileBundled(z, x, y, detail, options = {}) {
    if (!wants(detail, options)) return build.call(this, z, x, y, detail, options);
    const c = await cached(z, x, y, detail, options);
    return c.hit ? transferResult(c.result, c.transfer) : c.result;
  };
  /** Idle pre-build: the same path, the bundle stored, only { ok, hit } returned (nothing transferred). */
  api.prebuildTile = async function prebuildTile(z, x, y, detail, options = {}) {
    if (!wants(detail, options)) return { ok: false, hit: false };
    try {
      const c = await cached(z, x, y, detail, options);
      if (c.put) await c.put;
      return { ok: true, hit: c.hit };
    } catch {
      return { ok: false, hit: false };
    }
  };
  /** The engine's copy of HORIZON_FILL.stream (name, entry and byte caps); before the first build. */
  api.setBundleCache = function setBundleCache(cfg) {
    if (!bundles && cfg && typeof cfg === 'object') bundleCfg = { ...BUNDLE_DEFAULTS, ...cfg };
    return true;
  };
  /** hits, misses, puts, evictions, failed, bytes, entries (zeros before the first cached request). */
  api.bundleCacheStats = function bundleCacheStats() {
    return bundles ? { ...bundles.stats } : { hits: 0, misses: 0, puts: 0, evictions: 0, failed: 0, bytes: 0, entries: 0 };
  };
}
// HORIZON FILL C end

expose(api);

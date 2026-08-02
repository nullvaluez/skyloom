/**
 * THE MARQUEE MONUMENT MANIFEST (round 20 "Icons & Sprawl", agent C).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM lib/fly/assets.js — the same reason
 * lib/fly/player-aircraft.js does. assets.js is PARSED by two gates:
 * scripts/verify-fleet.js derives the mapped-traffic-archetype count from its
 * `{ url: '/models/` literals, and scripts/verify-hangar.js hard-pins that count
 * at 10 alongside `TRAFFIC_MODELS.length === 13`. A monument that registered a
 * runtime `url:` literal there would silently move both. So: the LICENSING
 * record (author / source / license / modifications, which CREDITS.md and the
 * credits panel render from) lives in assets.js as `file:`-only entries, and the
 * RUNTIME mapping lives here.
 *
 * SHAPE
 *   poi            the LANDMARKS name key, verbatim. This is the join to
 *                  lib/fly/poi/landmarks.js — placement coords AND the real
 *                  structure height (hM) come from the POI DB, never from here,
 *                  so a marquee model and its procedural twin can never disagree
 *                  about where or how tall the monument is.
 *   file           /models/monument-<id>.glb — processed offline by
 *                  scripts/r20-monument-bake.mjs (uncompressed, textureless,
 *                  albedo in COLOR_0, +Y up, base at y=0, footprint-centred).
 *   targetHeightM  the model's real-world subject height, for the record and for
 *                  verify-icons' sanity band. It is NOT the scale input — the
 *                  POI's hM is (the loader normalises every model to unit
 *                  height, and MonumentModels scales by hM × scaleBoost).
 *   yawFixRad      ABSOLUTE spin about +Y, applied before normalisation. There
 *                  is no orientation heuristic for monuments — a plane has a
 *                  nose to find, a monument has an authored facing. Measured
 *                  with `node scripts/inspect-glb.mjs <file>`, written down.
 *   accents        optional unit-height bands (yMin/yMax, optional rMin/rMax as
 *                  a fraction of the footprint half-extent) that get an EMISSIVE
 *                  colour: torches, crown bands, spire tips, lit clock faces.
 *                  A GLB gets no free floodlight, so this is how a marquee
 *                  monument reads at night the way the procedural archetypes do
 *                  (landmarks-3d.js bakes exactly the same thing with EMIT 3.2).
 *   exclusionM     radius (TRUE metres, from the POI point) inside which the
 *                  vector-tile worker refuses to extrude a streamed
 *                  OpenFreeMap building footprint. See MONUMENT_EXCLUSIONS
 *                  below for why this exists and how the number is chosen.
 *   enabled        false parks one model without touching the rest.
 *
 * Everything numeric that is NOT per-model lives in MONUMENT_MODELS
 * (lib/fly/fly-constants.js).
 */

import { LANDMARKS } from './poi/landmarks';

export const MONUMENT_MANIFEST = [
  {
    // 400 tris. Art-deco setbacks + the mast, in pale limestone — the cheapest
    // model in the set and the one the round was mandated on.
    poi: 'Empire State Building',
    file: '/models/monument-empire-state.glb',
    targetHeightM: 443,
    yawFixRad: Math.PI / 2, // the long facade reads E-W, as the real block does
    // Model half-extent 89 m (long axis) / 61 m (short). DELIBERATELY TIGHTER
    // than half-extent x 1.3: this is the densest block in the whole set and a
    // Midtown neighbour's centroid sits ~90 m away (34th St is 30 m wide and the
    // next block's buildings are ~60 m deep). 60 m clears the tower's own
    // footprint with room to spare and cannot reach across the street.
    exclusionM: 60,
    accents: [
      { yMin: 0.79, yMax: 0.85, color: '#ffd98f' }, // the observatory crown band
      { yMin: 0.93, yMax: 1.0, color: '#bfe0ff' }, // mast tip (the archetype's ice tip)
    ],
  },
  {
    // 2,458 tris, and the source albedo is already VERDIGRIS (#009789 mean) with
    // a gold flame — exactly the identity the toy grade is built to preserve.
    poi: 'Statue of Liberty',
    file: '/models/monument-liberty.glb',
    targetHeightM: 93, // pedestal included, matching the POI's hM
    yawFixRad: 0,
    // The torch is high AND off-axis — rMin is what lets the band name it
    // without also naming the crown at the same height.
    accents: [{ yMin: 0.86, yMax: 1.0, rMin: 0.55, color: '#ffd98f' }],
    // Model half-extent 22 m, but the streamed footprint here is Fort Wood —
    // the 11-point star pedestal OSM maps as one building, ~45 m across. Liberty
    // Island has nothing else on it, so a generous radius costs nothing.
    exclusionM: 60,
  },
  {
    // BESPOKE (lib/fly/monument-builders.js). THREE real free models were
    // found and all three rejected — two on SIZE, one on READ; see the
    // builder's docstring for the measured numbers and the A/B. No `file:`;
    // the loader dispatches on `build:` and everything downstream is identical.
    poi: 'Eiffel Tower',
    build: 'eiffel',
    targetHeightM: 330, // structure 300 m + mast to 330, matching the POI's hM
    yawFixRad: 0, // square plan
    accents: [
      { yMin: 0.335, yMax: 0.36, color: '#ffd98f' }, // 2nd floor — it is lit gold
      { yMin: 0.965, yMax: 1.0, color: '#bfe0ff' }, // the mast tip
    ],
    // Model half-extent 84 m (EIFFEL_PROFILE's 62.5 m base half-width, scaled by
    // hM x scaleBoost / 330). The Champ de Mars carries no neighbours for 200 m+,
    // and the base pavilions OSM maps INSIDE the tower's own square are exactly
    // the "blocky streamed cluster at the tower base" this fix exists for.
    exclusionM: 110,
  },
  {
    poi: 'Taj Mahal',
    file: '/models/monument-taj-mahal.glb',
    targetHeightM: 73, // the mausoleum incl. the main dome, matching the POI's hM
    yawFixRad: 0, // four-fold symmetric plan; the model already faces its axis
    accents: [{ yMin: 0.94, yMax: 1.0, color: '#ffd98f' }], // the gilded finial
    // Model half-extent 78 m; the real marble plinth is 100 m square. 105 m
    // clears the plinth and its four minarets while leaving the mosque and the
    // jawab (centroids ~110 m east and west) standing — they are real, separate
    // red-sandstone buildings and SHOULD stream. Deliberately not "generous".
    exclusionM: 105,
  },
  {
    poi: 'Sydney Opera House',
    file: '/models/monument-opera-house.glb',
    targetHeightM: 65, // the tallest shell
    yawFixRad: 0,
    accents: [],
    // Model half-extent 123 m (the shells run long). Bennelong Point is a
    // peninsula — the nearest streamed building is across Circular Quay, 300 m+.
    exclusionM: 160,
  },
  {
    poi: 'Big Ben',
    file: '/models/monument-big-ben.glb',
    targetHeightM: 96, // the Elizabeth Tower
    yawFixRad: 0, // four identical faces
    accents: [
      // The four clock faces — the one thing that MUST read at night on this
      // monument. rMin keeps the band on the outer faces only.
      { yMin: 0.6, yMax: 0.7, rMin: 0.75, color: '#ffe9b0' },
      { yMin: 0.97, yMax: 1.0, color: '#bfe0ff' }, // spire finial
    ],
    // THE TIGHTEST RADIUS IN THE SET, and on purpose. Model half-extent is only
    // 14 m, and the Elizabeth Tower is the NE corner of the Palace of
    // Westminster — a 265 m building whose centroid sits ~130 m southwest. The
    // Palace must keep streaming (it is the mass the tower stands on the end
    // of); only the tower's own polygon may go.
    exclusionM: 25,
  },
  {
    poi: 'Space Needle',
    file: '/models/monument-space-needle.glb',
    targetHeightM: 184,
    yawFixRad: 0,
    accents: [
      { yMin: 0.845, yMax: 0.878, color: '#ffd98f' }, // the lit saucer rim
      { yMin: 0.96, yMax: 1.0, color: '#bfe0ff' }, // spire
    ],
    // Model half-extent 35 m (the saucer). Seattle Center is an open campus;
    // 50 m clears the tower's own base and legs and stops well short of the
    // Armory and the MoPOP.
    exclusionM: 50,
  },
  {
    poi: 'Gateway Arch',
    file: '/models/monument-gateway-arch.glb',
    targetHeightM: 192,
    yawFixRad: Math.PI / 2, // span N-S, so the arch reads broadside from the river
    accents: [{ yMin: 0.96, yMax: 1.0, color: '#bfe0ff' }], // keystone, as the archetype has
    // Model half-extent 137 m along the span, 8 m across it — the one strongly
    // anisotropic monument in the set, and a circular radius is therefore a
    // COMPROMISE, not a fit. 150 m stays inside Gateway Arch National Park (the
    // Old Courthouse is 400 m west, the levee buildings 250 m+).
    exclusionM: 150,
  },
  {
    poi: 'Colosseum',
    file: '/models/monument-colosseum.glb',
    targetHeightM: 48,
    yawFixRad: 0, // the ellipse's major axis already runs E-W
    accents: [],
    // Model half-extent 177 m (the model's ellipse is wider-for-its-height than
    // the real 189 x 156 m amphitheatre). The archaeological zone is open on
    // every side — Colle Oppio park north, the Forum west, Via Celio Vibenna
    // south — so 190 m eats nothing but the Colosseum's own ring.
    exclusionM: 190,
  },
  {
    // Google Blocks source: it already carries per-vertex colour, so the bake
    // resolved albedo from COLOR_0 rather than a texture.
    poi: 'Willis Tower',
    file: '/models/monument-willis.glb',
    targetHeightM: 527, // antennas included, matching the POI's hM
    yawFixRad: 0,
    accents: [
      { yMin: 0.7, yMax: 0.73, color: '#ffd98f' }, // roofline of the tallest tube
      { yMin: 0.78, yMax: 1.0, color: '#bfe0ff' }, // the twin masts
    ],
    // Model half-extent 68 m. The Loop is dense but its blocks are big: the
    // nearest neighbouring centroid across Wacker/Adams is ~90 m. Tight, like
    // the ESB's, for the same reason.
    exclusionM: 70,
  },
];

/**
 * NOT SHIPPED, and why (the R14 lesson: scouts report honest fallbacks, not
 * forced picks). These POIs keep their procedural archetype:
 *
 *   • One World Trade / CN Tower — the only free models found live on a GitHub
 *     repo that re-hosts Sketchfab exports with NO license file; the CC-BY
 *     licence is real but sits on a page next to the model, and the AUTHOR had
 *     to be inferred from a triangle-count match. CC-BY without a certain name
 *     is not attribution, so both were rejected on provenance, not on looks.
 *   • Burj Khalifa — no free model exists at any acceptable quality (the Poly
 *     archive holds one 1.08 M-triangle Tilt Brush painting).
 *
 *   • THE MPT EPISODE — no POI lost by it in the end, but the lesson is the
 *     most expensive thing this round learned. The Eiffel Tower, Taj Mahal,
 *     Colosseum and Sydney Opera House first shipped from
 *     meta-quest/Meta-Spatial-SDK-Samples, whose repository root
 *     LICENSE is MIT. That LICENSE covers the CODE. The repo's own README says
 *     the rest out loud: "all the supporting materials in each sample's
 *     `app/src/main/res/raw` and `app/src/main/assets` folders including 3D
 *     models, videos, sounds, and others, are licensed under the MPT SDK
 *     license" — the Meta Platform Technologies SDK licence, which restricts
 *     use to developing for Meta platforms and is NOT a free-redistribution
 *     grant. All four models came from `.../geo_voyage/app/src/main/assets/
 *     landmarks/`, squarely inside that carve-out. THE LESSON: a repository's
 *     LICENSE file licenses its CODE; bundled assets need their own grant, and
 *     "there is a LICENSE.txt in the folder above" is not evidence of one —
 *     read the project's own multi-licence statement before believing a file.
 *     All four were re-sourced: the Colosseum from a CC0 model that had already
 *     been scouted, the Taj Mahal and the Opera House from the Google Poly
 *     archive via Icosa Gallery, and the Eiffel Tower from a first-party
 *     builder. Also rejected along the way, and worth not re-treading:
 *     poly.pizza's only Taj candidates are a generic "Palace"/"Shrine" (WRONG
 *     IDENTITY — a model of the wrong building is worse than an honest
 *     archetype), and printables.com/model/256532 is CC-BY-NC-ND, which forbids
 *     both commercial use and derivatives — and this pipeline's whole job is to
 *     make derivatives.
 *
 * Bridges are excluded from v1 by FLY_ROUND20_PLAN §4 (span math is
 * special-cased), and Christ the Redeemer is excluded so that
 * scripts/verify-monuments-sat.js needs no edit this round.
 */

// --- streamed-footprint exclusion ------------------------------------------
/**
 * ROUND 20 (C2) — WHY A MARQUEE MONUMENT HAS A HOLE PUNCHED AROUND IT.
 *
 * Parking the procedural archetype (below) only solves HALF of the double-draw.
 * The other half is the OpenFreeMap `building` polygon of the SAME real
 * structure, which the vector-tile worker extrudes like any other building —
 * so the Taj Mahal rendered as a blue-tinted box wearing the R15 night window
 * atlas, standing around and through the marble model, and the Eiffel Tower
 * grew a blocky cluster at its base. (The Empire State only ever looked right
 * because its model is big enough to engulf its own extrusion.) The fix is a
 * static exclusion disc per placed marquee monument, applied in the worker
 * where footprints are admitted.
 *
 * WHY THE WORKER IMPORTS THIS INSTEAD OF BEING TOLD PER FRAME. Tile bundles are
 * CACHED (per z/x/y/detail) and re-used across the whole session. An exclusion
 * that depended on live placement state would make the same tile build
 * differently depending on when it happened to stream — the classic cache
 * poisoning. This list is a pure function of two static data files (the
 * manifest and the LANDMARKS DB), exactly like every other constant the worker
 * imports, so a tile is deterministic. Range is not a factor either:
 * MONUMENT_MODELS.rangeM is 26 km and the deepest ring that carries buildings
 * at all is the toy z13 'mid' ring at ~18 km, so a monument inside a
 * building-bearing tile is ALWAYS placed.
 *
 * WHAT HAPPENS IF A MODEL FAILS TO DOWNLOAD: the hole stays, and the procedural
 * archetype (never suppressed until its GLB is in hand) stands in it. A
 * monument with the wrong silhouette beats a monument drawn twice.
 *
 * THE RADII are per-model and hand-tuned — the default shape is the model's own
 * footprint half-extent x 1.3, tightened wherever the monument sits on a dense
 * block and widened where it sits alone. Each entry above carries its own
 * reasoning. Nothing here may eat a neighbourhood: A SPRAWL's Powell/Dublin/
 * Manhattan coverage counts are the constraint, and no marquee POI is anywhere
 * near a suburbia probe.
 *
 * Shape: { name, wx, wz, radiusM } in ABSOLUTE mercator world units — the same
 * frame TerrainEngine.geoToWorld and traffic-engine's mercatorWorldXZ produce
 * (duplicated rather than imported so the worker bundle stays data-only).
 */
const EARTH_R = 6378137;
const DEG2RAD = Math.PI / 180;

export const MONUMENT_EXCLUSIONS = (() => {
  const byName = new Map();
  for (const row of LANDMARKS) byName.set(row[0], row);
  const out = [];
  for (const e of MONUMENT_MANIFEST) {
    if (e.enabled === false || !(e.exclusionM > 0)) continue;
    const row = byName.get(e.poi);
    if (!row) continue; // verify-icons gate A3 makes this unreachable
    const [, lat, lon] = row;
    out.push({
      name: e.poi,
      wx: EARTH_R * lon * DEG2RAD,
      wz: -EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2)),
      radiusM: e.exclusionM,
    });
  }
  return out;
})();

// --- procedural-fallback suppression ---------------------------------------
// LandmarkMonuments (the 9 procedural archetype pools) reads this set during
// its placement loop and skips any POI whose marquee model is currently placed,
// which parks that archetype instance at scale 0. The EPOCH is the handshake:
// MonumentModels bumps it when the placed set changes, and LandmarkMonuments
// treats a bump like a rebase — an immediate re-place instead of waiting out its
// own 2 s cadence, so a monument is never drawn twice.
//
// With MONUMENT_MODELS.enabled false the layer never mounts, the set stays
// empty and the epoch never moves, which is what makes the flag-off path
// byte-identical to R19.

const _suppressed = new Set();
let _epoch = 0;

export function isMonumentSuppressed(name) {
  return _suppressed.size > 0 && _suppressed.has(name);
}

export function monumentSuppressionEpoch() {
  return _epoch;
}

export function setSuppressedMonuments(names) {
  if (names.length === _suppressed.size && names.every((n) => _suppressed.has(n))) return;
  _suppressed.clear();
  for (const n of names) _suppressed.add(n);
  _epoch += 1;
}

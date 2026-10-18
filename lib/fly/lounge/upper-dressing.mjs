// Observation lounge — the second level's dressing contract (LOUNGE_PIER).
//
// FROZEN cross-lane interface for the second-level pass
// (FLY_LOUNGE_SECOND_LEVEL.md, "W0 contracts"). Three lanes work in parallel
// on different files: FURNISH builds geometry (room-build.js), LIGHT shades it
// (room-shading.js, the steam overlay), LIFE gives it behaviour (footsteps,
// inspectable décor, an upstairs station). This module is the one place where
// their shared positions live, so each lane can land in any order:
//
//   - FURNISH builds each contracted piece exactly where this file says and
//     pushes its DRESSING id into buildLoungeRoom().dressing (and a cup's
//     steam point into .steamSources);
//   - LIFE / LIGHT act on a piece only when lib/fly/lounge/room-build.js
//     roomDressing(variant) (or room.dressing) contains its id, so nothing
//     ever points at empty floor;
//   - nobody builds inside KEEP_CLEAR (scripts/verify-lounge-second-level.mjs
//     checks the built blockers against it).
//
// Pure data and pure functions: no three, no DOM. Room-local metres in the
// LOUNGE_ROOM frame (+X east/right, +Z toward the back wall, -Z toward the
// runway glass, y up from the lower floor). Pier variant only: the classic
// room has no second level and none of this applies to it.
//
// Changing a value here is a contract change: the lanes that consume it move
// together, and scripts/verify-lounge-second-level.mjs is updated with it.
import { LOUNGE_PIER_ROOM } from '../observation-config.js';

const U = LOUNGE_PIER_ROOM.upper;
const UP = U.floorY; // the upper floor's finished height (4.6 m)
const r3 = (v) => Math.round(v * 1000) / 1000;
/** The stair's walking surface height at z (room-walk.mjs floorHeight). */
export const stairRampY = (z) => U.floorY * Math.max(0, Math.min(1, (z - U.stair.z0) / (U.stair.z1 - U.stair.z0)));

/** Ids of the contracted dressing (what roomDressing() reports once built). */
export const DRESSING = Object.freeze({
  NOOK_RUG: 'upper-nook-rug', // a small rug under the west reading nook
  LIBRARY: 'upper-library', // the bookcase on the west wall behind the top landing
  MODEL_DISPLAY: 'upper-model-display', // a console of desk model aircraft at the east glazing
  COFFEE_STATION: 'upper-coffee-station', // the credenza's coffee service
  CHART_WALL: 'stair-chart-wall', // framed chart prints stepping up the stair wall
  ROOF_FINISH: 'lower-roof-finish', // the lower roof's finish, seen from the upper front seats
  CUP_STATION_A: 'cup-station-a', // the three steaming cups (each its own id: its steam follows it)
  CUP_STATION_B: 'cup-station-b',
  CUP_NOOK: 'cup-nook',
});

// ---------------------------------------------------------------------------
// Cups and their steam (FURNISH builds the cup, LIGHT draws the steam)
// ---------------------------------------------------------------------------
/** The steam overlay's source radius (lounge-steam.js; the hero cup's). */
export const STEAM_R = 0.036;
/**
 * A cup on its saucer, as the hero cup is built (room-build.js heroProps):
 * the saucer's foot on `base` (the surface it stands on), the cup 7.5 mm up,
 * its lip 75 mm above that. Its steam rises from the lip's centre.
 */
export const CUP = Object.freeze({ saucerLift: 0.0075, lip: 0.075 });
export const steamPoint = (cup) => Object.freeze([cup.base[0], cup.base[1] + CUP.saucerLift + CUP.lip, cup.base[2]]);

/** The credenza top (room-build.js upperRoom: stone slab centred UP+0.755, 30 mm thick). */
export const CREDENZA = Object.freeze({ x: 8.9, z: 10.95, halfX: 0.52, halfZ: 1.32, top: r3(UP + 0.77) });
export const CUPS = Object.freeze([
  Object.freeze({ id: DRESSING.CUP_STATION_A, base: Object.freeze([8.74, CREDENZA.top, 10.98]), rot: 0.4, on: DRESSING.COFFEE_STATION }),
  Object.freeze({ id: DRESSING.CUP_STATION_B, base: Object.freeze([9.02, CREDENZA.top, 10.74]), rot: -0.9, on: DRESSING.COFFEE_STATION }),
  // On the reading nook's side table (top 0.57 m, centred x -5.72, z 8.93, r 0.3).
  Object.freeze({ id: DRESSING.CUP_NOOK, base: Object.freeze([-5.66, r3(UP + 0.57), 8.86]), rot: -0.35, on: null }),
]);

// ---------------------------------------------------------------------------
// The stair wall's chart prints (FURNISH frames them, LIGHT paints SURF.CHART)
// ---------------------------------------------------------------------------
/**
 * The picture faces, on the west wall (inner face x = -11.2), facing +X, hung
 * level, each centred 2.0 m above the stair at its centre so that its frame
 * (<= 60 mm, FURNISH's) clears the west handrail's top by >= 0.25 m even at
 * the panel's uphill end. `x` is the plane of the SURF.CHART surface, 40 mm
 * proud of the wall: no frame or print face may sit within 20 mm of being
 * coplanar with the wall or the lower wall's dado trim (its face is at
 * x = -11.185, y = 3.29..3.31). zc/yc is the face's centre, w (along z) by h
 * its size. `kind` and `seed` choose the procedural print (LIGHT):
 * 'sectional' (contours, water, airways) or 'approach' (plan and profile).
 */
export const CHART_FACE_X = -11.16;
export const CHART_PANELS = Object.freeze([5.15, 6.85, 8.55, 10.25].map((zc, i) => Object.freeze({
  id: `stair-chart-${i + 1}`, x: CHART_FACE_X, zc, yc: r3(stairRampY(zc) + 2.0), w: 0.8, h: 0.56,
  kind: i % 2 ? 'approach' : 'sectional', seed: i + 1,
})));

// ---------------------------------------------------------------------------
// Footstep surfaces (LIFE's surface-aware steps; FURNISH's rugs)
// ---------------------------------------------------------------------------
/**
 * What the walker stands on, per walk layer (room-walk.mjs floorId). Rect
 * entries are the rugs' outer edges as built; one with a dressingId counts
 * only once that piece is built. The existing rugs mirror room-build.js
 * (midLounge left group and communal table, upperRoom's rug).
 */
export const FOOTSTEP_SURFACES = Object.freeze({
  lower: Object.freeze({
    surface: 'stone', // honed travertine (and the entrance vestibule)
    rects: Object.freeze([
      Object.freeze({ surface: 'rug', x0: -7.1, x1: -3.7, z0: 5.2, z1: 7.8 }), // left lounge group, 3.4 x 2.6 at (-5.4, 6.5)
      Object.freeze({ surface: 'rug', x0: 1.8, x1: 7.0, z0: 5.15, z1: 8.05 }), // communal table, 5.2 x 2.9 at (4.4, 6.6)
    ]),
  }),
  stairs: Object.freeze({ surface: 'tread', rects: Object.freeze([]) }), // oak treads over travertine risers
  upper: Object.freeze({
    surface: 'oak', // the timber floor (the top landing included)
    rects: Object.freeze([
      Object.freeze({ surface: 'rug', x0: -3.95, x1: 3.95, z0: 8.825, z1: 13.075 }), // the upper rug, 7.9 x 4.25 at (0, 10.95)
      Object.freeze({ surface: 'rug', x0: -8.3, x1: -4.8, z0: 8.35, z1: 10.35, dressingId: DRESSING.NOOK_RUG }),
    ]),
  }),
});
/**
 * The surface under (x, z) on a walk layer: 'stone' | 'oak' | 'rug' | 'tread'.
 * `built` is roomDressing('pier') (a contracted rug counts only when built).
 */
export function surfaceAt(floorId, x, z, built = []) {
  const layer = FOOTSTEP_SURFACES[floorId] ?? FOOTSTEP_SURFACES.lower;
  for (const r of layer.rects) {
    if (r.dressingId && !built.includes(r.dressingId)) continue;
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.surface;
  }
  return layer.surface;
}

// ---------------------------------------------------------------------------
// Inspectable décor (FURNISH builds inside `bounds`; LIFE offers the look)
// ---------------------------------------------------------------------------
/**
 * Scenery the observer can look at: a calm card with a line of first-party
 * text. Never a contact, never a reward. `focus` is the point a prompt aims
 * at, `bounds` the box FURNISH's geometry for it lies inside (and a pick ray
 * may hit), `reachM` the standing distance from the box within which it is
 * offered. Offered only when its dressingId is built. `floorId` is the walk
 * layer it is offered from; the chart wall is offered from the stair.
 */
export const INSPECTABLES = Object.freeze([
  Object.freeze({
    id: 'model-display', dressingId: DRESSING.MODEL_DISPLAY, floorId: 'upper', kind: 'display',
    label: 'Model aircraft', prompt: 'Look at the models',
    text: 'Three desk models from the lounge\'s own collection: a high-wing piston single, a twin-engine jet airliner and a four-engine long-hauler. Scenery only; the aircraft that matter are the real ones outside.',
    focus: Object.freeze([10.6, r3(UP + 1.0), 10.9]),
    bounds: Object.freeze({ min: Object.freeze([10.3, r3(UP + 0.0), 9.85]), max: Object.freeze([10.95, r3(UP + 1.35), 11.95]) }),
    reachM: 1.8,
  }),
  Object.freeze({
    id: 'stair-charts', dressingId: DRESSING.CHART_WALL, floorId: 'stairs', kind: 'charts',
    label: 'Aeronautical charts', prompt: 'Look at the charts',
    text: 'Four chart prints drawn for the lounge: sectional excerpts and an approach plate. Decorative, not for navigation.',
    focus: Object.freeze([CHART_FACE_X, CHART_PANELS[1].yc, CHART_PANELS[1].zc]),
    bounds: Object.freeze({
      min: Object.freeze([-11.2, r3(CHART_PANELS[0].yc - 0.4), r3(CHART_PANELS[0].zc - 0.5)]),
      max: Object.freeze([-11.1, r3(CHART_PANELS[3].yc + 0.4), r3(CHART_PANELS[3].zc + 0.5)]),
    }),
    reachM: 1.4,
  }),
  Object.freeze({
    id: 'library', dressingId: DRESSING.LIBRARY, floorId: 'upper', kind: 'shelf',
    label: 'Spotter\'s library', prompt: 'Look at the books',
    text: 'Well-thumbed spotting guides, airline histories and a field guide to clouds.',
    focus: Object.freeze([-10.98, r3(UP + 1.3), 13.45]),
    bounds: Object.freeze({ min: Object.freeze([-11.2, UP, 12.85]), max: Object.freeze([-10.8, r3(UP + 2.25), 14.05]) }),
    reachM: 1.7,
  }),
  Object.freeze({
    id: 'coffee-station', dressingId: DRESSING.COFFEE_STATION, floorId: 'upper', kind: 'prop',
    label: 'Coffee station', prompt: 'Look at the coffee station',
    text: 'An espresso machine, clean cups and a tray of saucers. Help yourself.',
    focus: Object.freeze([8.9, r3(UP + 0.95), 11.4]),
    bounds: Object.freeze({ min: Object.freeze([8.38, r3(UP + 0.74), 10.4]), max: Object.freeze([9.42, r3(UP + 1.25), 12.25]) }),
    reachM: 1.6,
  }),
]);

// ---------------------------------------------------------------------------
// Reserved station (LIFE may add it to observatory-stations.mjs; FURNISH keeps clear)
// ---------------------------------------------------------------------------
/**
 * An upstairs listening window, mid-bay on the upper front glazing, the same
 * shape as the lower stations (position = the instrument's head; the observer
 * stands on the room side). LIFE owns whether it exists; if it does, it is
 * exactly here.
 */
export const RESERVED_STATIONS = Object.freeze([
  Object.freeze({ id: 'upper-front-listen', kind: 'listen', side: 'front', label: 'Upper listening window', floorY: UP, position: Object.freeze([4.48, r3(UP + 1.12), r3(U.glazing.frontZ + 0.3)]) }),
]);

// ---------------------------------------------------------------------------
// Keep-clear (nobody builds here)
// ---------------------------------------------------------------------------
/**
 * Floor rectangles no blocker may intrude on (2D, per walk layer): the stair
 * run-in and top landing with its way out, the upper room's east-west spine,
 * the existing seats' approaches, the rails and the reserved station with
 * their standing room. A `maxTopM` entry admits only blockers whose top is at
 * most that far above its floor (a ray-height corridor: the upper standing
 * sightlines verify-lounge-upper.mjs traces at x = -6.72 / 0 / 6.72).
 */
const rect = (id, floorId, x0, x1, z0, z1, extra = {}) => Object.freeze({ id, floorId, x0, x1, z0, z1, ...extra });
// The glazing's own wall blockers reach 0.1 m into the room; corridors at the
// glass start just beyond them.
const FRONT_IN = r3(U.glazing.frontZ + 0.12), BACK_IN = r3(U.glazing.backZ - 0.12);
export const KEEP_CLEAR = Object.freeze([
  rect('stair-run-in', 'lower', U.stair.x0, U.stair.x1, 1.7, r3(U.stair.z0 - 0.05)),
  rect('top-landing', 'upper', U.topLanding.x0, U.topLanding.x1, U.topLanding.z0, U.topLanding.z1),
  rect('landing-exit', 'upper', U.topLanding.x1, -6.0, 11.2, 12.6),
  rect('upper-spine', 'upper', -6.0, 8.2, 10.55, 11.4),
  rect('approach-upper-front', 'upper', -3.4, -2.8, 9.3, 9.75),
  rect('approach-upper-back', 'upper', 2.8, 3.4, 12.15, 12.6),
  rect('rail-upper-front', 'upper', 0.3, 1.7, FRONT_IN, 9.0),
  rect('rail-upper-back', 'upper', -1.7, -0.3, 13.3, BACK_IN),
  rect('station-upper-front-listen', 'upper', 4.0, 4.96, FRONT_IN, 9.2),
  ...[-6.72, 0, 6.72].flatMap((x) => [
    rect(`sightline-front-${x}`, 'upper', x - 0.05, x + 0.05, FRONT_IN, 8.75, { maxTopM: 1.5 }),
    rect(`sightline-back-${x}`, 'upper', x - 0.05, x + 0.05, 13.15, BACK_IN, { maxTopM: 1.5 }),
  ]),
]);

/**
 * The pass's triangle plan for room + instruments (pier): the sanctioned
 * ceiling is LOUNGE_BUDGETS.room (160,000); the lanes share the headroom
 * above today's 138,922 and leave a margin. Lane shares: FLY_LOUNGE_SECOND_LEVEL.md.
 */
export const PLAN_TRIANGLES = Object.freeze({ baseline: 138922, furnish: 17500, light: 500, life: 1500, total: 158500 });

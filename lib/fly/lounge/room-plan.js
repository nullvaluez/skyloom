// Observation lounge — the room's fixed dimensions, derived from the shared
// contract (LOUNGE_ROOM in lib/fly/observation-config.js). Pure numbers: the
// geometry builder, the shading model, the glass and the node gate all read
// them, so the analytic window aperture in the shader can never drift from
// the frame that was modelled.
import { LOUNGE_ROOM, LOUNGE_PIER_ROOM, VANTAGE } from '../observation-config.js';

const G = LOUNGE_ROOM.glass;

/** tan of the curtain wall's outward lean. */
export const CANT = Math.tan((G.cantDeg * Math.PI) / 180);
/** The glass plane's z at height y (the wall leans out toward -Z as it rises). */
export const frontZ = (y) => G.baseZ - (y - G.baseY) * CANT;

export const SILL_Y = G.baseY;
export const HEAD_Y = G.topY;
export const HALF_X = G.halfWidth;
export const HEAD_Z = frontZ(G.topY); // the front glass meets the roof glass here
export const ROOF_Z1 = LOUNGE_ROOM.roofGlass.z1;
export const SIDE_Z1 = LOUNGE_ROOM.side.z1;
/** Inner face of the back wall (the envelope ends at 14.6; the wall is 0.4). */
export const BACK_Z = 14.2;

// Mullions sit on the contract's 2.24 m pitch with the seat centred in a bay
// (a mullion at x = 0 would split the default view in half). The two end
// bays against the corner posts are half bays.
export const PITCH = G.mullionPitch;
export const MULLION_HALF = G.mullionHalf; // half the visible face
export const MULLION_DEPTH = 0.2; // fin depth, measured into the room (contract ~0.25)
export const MULLION_X = (() => {
  const xs = [];
  for (let x = PITCH / 2; x < HALF_X - 0.2; x += PITCH) xs.push(-x, x);
  return xs.sort((a, b) => a - b);
})();
export const CORNER_HALF = 0.07; // corner posts at x = ±HALF_X
/** One intermediate fin on each side glazing; the solid wall begins at SIDE_Z1. */
export const SIDE_MULLION_Z = [1.5];
export const HEAD_DEPTH = 0.3; // head transom depth (into the room) where wall meets roof
export const FASCIA_DEPTH = 0.36; // the beam that closes the roof glass at ROOF_Z1
export const FASCIA_DROP = 0.62; // its height below the ceiling plane

/** Where the solid ceiling's baffles hang. */
export const DECK_Y = HEAD_Y;
export const BAFFLE = Object.freeze({ pitch: 0.2, width: 0.045, depth: 0.2, z0: ROOF_Z1 + FASCIA_DEPTH + 0.06, z1: BACK_Z - 0.12 });
/**
 * Linear light slots in the baffle field (x of each slot), on the mullion
 * lines over the two lounge groups. None runs over the seat's sightline: the
 * canted glass reflects the ceiling straight ahead, and a lit slot at x = 0
 * would draw a bright line down the middle of the night view.
 */
export const SLOT_X = [-5.6, 5.6];

/** The seated observer (contract). */
export const EYE = LOUNGE_ROOM.eye;

/** Window seats along the glass, facing the runway; ours is x = 0. */
export const WINDOW_SEATS = [
  { x: -8.96, rot: 0.1 },
  { x: -4.48, rot: -0.06 },
  { x: 0, rot: 0 },
  { x: 4.48, rot: 0.06 },
  { x: 8.96, rot: -0.1 },
];
export const SEAT_Z = 0.08;
/**
 * Our side table: forward-right of the chair, in the lower right of the
 * default view, as far forward as the sill allows and drink-table high, so
 * the cup and binoculars sit above the HUD's control bar and hint line.
 */
export const HERO_TABLE = Object.freeze({ x: 0.5, z: -0.92, top: 0.67, r: 0.25 });

/** The two flight information boards on the back wall (x centre, width). */
export const BOARDS = Object.freeze([
  { x: -7.3, w: 4.8, y0: 1.62, h: 2.7, title: 'ARRIVALS' },
  { x: 7.3, w: 4.8, y0: 1.62, h: 2.7, title: 'DEPARTURES' },
]);
export const BOARD_Z = BACK_Z - 0.07;

/** Bar on the back wall. */
export const BAR = Object.freeze({ x0: -3.4, x1: 3.4, front: 11.45, back: 12.1, top: 1.08, shelfZ: BACK_Z - 0.05 });

/** Entrance vestibule in the right-hand solid wall. */
export const ENTRANCE = Object.freeze({ z0: 9.9, z1: 12.3, h: 3.0, depth: 1.25 });

/** The canvas on the right wall (room-local: z0..z0+w along the wall, y0..y0+h). */
export const ART_RECT = Object.freeze({ z0: 7.2 - 1.7, w: 3.4, y0: 1.95 - 0.95, h: 1.9 });

/** The aperture edges the shader and the glass share. */
export const APERTURE = Object.freeze({
  front: { y0: SILL_Y + 0.02, y1: HEAD_Y - 0.12 },
  roof: { z0: HEAD_Z + 0.16, z1: ROOF_Z1 },
  side: { z1: SIDE_Z1 - 0.12 },
});

/**
 * The floor you can stand on (LOUNGE_WALK; lib/fly/lounge/room-walk.mjs):
 * the room from the glass line at the sill to the back wall, plus the
 * entrance vestibule out to its doors. Walls and furniture are the blockers
 * room-build.js emits; the walk grid inflates them by the body radius.
 */
export const FLOOR_PLATE = Object.freeze({
  x0: -HALF_X, x1: HALF_X, z0: frontZ(SILL_Y), z1: BACK_Z,
  vestibule: Object.freeze({ x0: HALF_X, x1: HALF_X + ENTRANCE.depth, z0: ENTRANCE.z0, z1: ENTRANCE.z1 }),
});

/**
 * The room's variant plan: one source of truth for everything that differs
 * between the classic lounge and the pier lounge (LOUNGE_PIER), keyed off
 * site.variant. Classic is today's room: every named export above is its
 * plan, unchanged. Frozen; built once per variant.
 *   backGlass  the pier's back curtain wall (null in classic)
 *   aperture   the shader/glass aperture edges, with `back` for the pier
 *   vantage    the seats LOUNGE_WALK can sit in (observation-config VANTAGE)
 *   bar        where the bar stands ('back' wall in classic, 'right' in the pier)
 *   art        the right-wall canvas (null in the pier: the bar takes the wall)
 *   probeEye   the reflection probe's fixed eye (null: the live eye, as today)
 */
const VARIANTS = new Map();
export function roomVariant(variant = 'classic') {
  const key = variant === 'pier' ? 'pier' : 'classic';
  if (VARIANTS.has(key)) return VARIANTS.get(key);
  let plan;
  if (key === 'pier') {
    const g = LOUNGE_PIER_ROOM.backGlass;
    const mullionX = [];
    for (let x = -g.halfWidth + g.mullionPitch / 2; x < g.halfWidth - 0.2; x += g.mullionPitch) mullionX.push(Number(x.toFixed(6)));
    plan = {
      variant: key,
      backGlass: Object.freeze({ ...g, mullionX: Object.freeze(mullionX) }),
      aperture: Object.freeze({ ...APERTURE, back: Object.freeze({ x0: -g.halfWidth + 0.07, x1: g.halfWidth - 0.07, y0: g.baseY + 0.02, y1: g.topY - 0.12 }) }),
      vantage: VANTAGE.pier,
      bar: LOUNGE_PIER_ROOM.bar,
      art: null,
      communalTableX: LOUNGE_PIER_ROOM.communalTableX,
      probeEye: LOUNGE_PIER_ROOM.probeEye,
    };
  } else {
    plan = {
      variant: key,
      backGlass: null,
      aperture: Object.freeze({ ...APERTURE, back: null }),
      vantage: VANTAGE.classic,
      bar: Object.freeze({ wall: 'back', ...BAR }),
      art: ART_RECT,
      communalTableX: 5.4,
      probeEye: null,
    };
  }
  const frozen = Object.freeze(plan);
  VARIANTS.set(key, frozen);
  return frozen;
}

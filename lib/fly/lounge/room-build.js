// Observation lounge — the room, built in code (first-party, deterministic).
//
// A contemporary airport sky lounge in room-local metres: canted curtain wall
// with deep bronze fins, a glazed roof strip, side glazing, a honed travertine
// floor, oak baffle ceiling, leather window seats with side tables (ours has
// the coffee, the binoculars and the spotter's notebook), a mid lounge on
// wool rugs, a communal table under pendants, a bar with a backlit back bar,
// two flight information boards, an entrance vestibule and planting.
//
// Output: one merged geometry per material bucket (room-shading.js turns each
// into one draw), plus the shared lists the shader evaluates analytically:
//   practicals  interior light fixtures (point / spot / line)
//   shadows     coarse oriented boxes that cast the key light's furniture shadows
//   floorAO     finer boxes for the floor's contact-occlusion bake
//   glow        emissive channel per fixture group (dimmed with the practicals)
//   blockers    room-local 2D footprints at body height (LOUNGE_WALK collision,
//               click-a-chair), pushed by the same function that builds each
//               piece; they carry no geometry, so the AO signature is unchanged
//
// Buckets: stone, wood, metal, leather, fabric, plaster, small (ceramics,
// paper, foliage, glass, rubber), emissive (unlit light sources).
import { CatmullRomCurve3, Matrix4, Vector3 } from 'three';
import {
  RoomBuilder, softBox, prism, slab, lathe, cylinder, torus, tube, taperTube, leaf, foliageCard,
  superellipse, roundedRect, frame, framePoint, rng, block, frameRing, linear,
} from './geometry-kit.js';
import {
  CANT, frontZ, SILL_Y, HEAD_Y, HALF_X, HEAD_Z, ROOF_Z1, SIDE_Z1, BACK_Z,
  MULLION_X, MULLION_HALF, MULLION_DEPTH, CORNER_HALF, SIDE_MULLION_Z, HEAD_DEPTH,
  FASCIA_DEPTH, FASCIA_DROP, DECK_Y, BAFFLE, SLOT_X, WINDOW_SEATS, SEAT_Z,
  HERO_TABLE, BOARDS, BOARD_Z, BAR, ENTRANCE, roomVariant,
} from './room-plan.js';
import {
  DRESSING, CUPS, CUP, STEAM_R, steamPoint, CREDENZA, CHART_PANELS, CHART_FACE_X,
} from './upper-dressing.mjs';

/** aSurf.w surface flags (room-shading.js reads the same numbers). */
export const SURF = Object.freeze({
  PLAIN: 0, TILES: 1, FLUTED: 2, PLANKS: 3, GRILLE: 4, LEAF: 5, PAPER: 6, LENS: 7,
  BACKLIT: 8, DECK: 9, FLUTED_FINE: 10, CERAMIC: 11, RUG: 12, BAFFLE: 13, LONG: 14, ART: 15, OPAL: 16, UPPER_FLOOR: 17,
  // Second-level pass (FLY_LOUNGE_SECOND_LEVEL.md, W0 contract). Pier-only
  // codes: until room-shading.js gives one a branch it renders exactly as
  // PLAIN (room-shading.js SURF_FALLBACK documents each fallback).
  CHART: 18, // the framed aeronautical chart prints on the stair wall (upper-dressing.mjs CHART_PANELS)
  SPINES: 19, // book spines: per-book bands and titles drawn in the shader
  EXTERIOR: 20, // surfaces outside the glazing (the lower roof seen from upstairs): lit as outdoors
});

/** Emissive channels: each fixture group dims on its own curve. */
export const GLOW = Object.freeze({
  ALWAYS: 0, COVE: 1, SLOT: 2, PENDANT: 3, BAR: 4, ENTRANCE: 5, LAMP: 6, TABLE: 7,
  // Second-level pass: named groups for the upper room's new fixtures, with
  // channels of their own (LIGHT lane). They exist in the PIER program only
  // (room-shading.js declares uLoungeGlow[ 10 ] there and [ 8 ] in the
  // classic program), so only pier geometry and practicals may use them;
  // always by name, never the number.
  READING: 8, // reading and table lamps upstairs: warm pools after dark, dimmed by Night Watch
  DISPLAY: 9, // display / picture lights (model aircraft, charts, shelves): on by day too
});

// The palette (sRGB). Warm oak, honed travertine, dark bronze, cognac leather.
const C = Object.freeze({
  travertine: '#e6dccb', travertineDark: '#cfc3ad',
  oak: '#c79a6b', oakDark: '#5e4330', oakSmoked: '#4a3526',
  bronze: '#6b5440', bronzeDark: '#3c3027', blackMetal: '#1d1d1f', frame: '#8a7b66', frameDark: '#3d362f',
  leather: '#9a5b33', leatherDark: '#5b3220',
  boucle: '#ddd6c9', wool: '#6f7884', woolDark: '#454c55', olive: '#6a7354', sand: '#bfae94',
  plaster: '#ece6db', deck: '#2a2623',
  ceramic: '#f2ede4', stoneware: '#b7ab9b', paper: '#f1ebdd', ink: '#22283a',
  rubber: '#26292a', leaf: '#3f5a2e', leafLight: '#5f7a3c', bark: '#5c4a3a', soil: '#2b2119',
});

/**
 * Build the room. Returns { buckets, practicals, shadows, floorAO, blockers,
 * dressing, steamSources, stats }. `variant` is the room variant
 * (lib/fly/lounge/room-plan.js roomVariant: 'classic' or 'pier').
 *
 * Second-level pass contract (FLY_LOUNGE_SECOND_LEVEL.md, W0):
 *   dressing      ids (lib/fly/lounge/upper-dressing.mjs DRESSING) of the
 *                 contracted dressing this build actually contains. Behaviour
 *                 that targets a piece (an inspectable, a rug's footstep, a
 *                 cup's steam) checks for its id, so it never points at empty
 *                 space whichever lane lands first. Empty until FURNISH builds.
 *   steamSources  every steaming cup, { at:[x,y,z], r }, the hero cup first
 *                 (practicals.steam stays the hero cup, as before).
 */
export function buildLoungeRoom({ variant = 'classic' } = {}) {
  const b = new RoomBuilder(431);
  const random = rng(97);
  const shadows = []; // { c:[x,y,z], h:[hx,hy,hz], rot, k (opacity) }
  const floorAO = []; // same shape, finer
  const practicals = []; // see room-shading.js PRACTICAL layout
  const blockers = []; // { c:[x,z], h:[hx,hz], rot, kind, round?, seatId? } (see blocker())
  const dressing = []; // DRESSING ids built (upper-dressing.mjs), pushed by the function that builds each piece
  const steamSources = []; // extra steaming cups ({ at, r }); the hero cup is prepended below
  const box = (list, c, h, rot = 0, k = 1) => list.push({ c, h, rot, k });
  const plan = roomVariant(variant);
  const vantage = plan.vantage;

  // =========================================================================
  // 1. HERO ZONE — our chair, the side table and what is on it. Built first:
  //    nearest geometry first in the index buffer lets early-Z reject more of
  //    the floor and walls behind it.
  // =========================================================================
  for (const base of WINDOW_SEATS) {
    const seat = plan.backGlass && Math.abs(base.x) > 8 ? { ...vantage.find((v) => v.id === (base.x < 0 ? 'corner-left' : 'corner-right')).chair } : { ...base, z: SEAT_Z };
    const m = frame([seat.x, 0, seat.z], seat.rot);
    loungeChair(b, m, { leather: true, hero: seat.x === 0 });
    shadowChair(shadows, floorAO, seat.x, seat.z, seat.rot);
    const tx = seat.x + (seat.x === 0 ? HERO_TABLE.x : 0.68), tz = seat.x === 0 ? HERO_TABLE.z : -0.62;
    sideTable(b, [tx, 0, tz], seat.x === 0 ? HERO_TABLE.top : 0.55, seat.x === 0 ? HERO_TABLE.r : 0.27);
    const seatId = vantage.find((v) => Math.abs(v.chair.x - seat.x) < 1e-6 && Math.abs(v.chair.z - seat.z) < 1e-6)?.id;
    chairBlocker(blockers, seat.x, seat.z, seat.rot, seatId);
    blocker(blockers, 'table', tx, tz, seat.x === 0 ? HERO_TABLE.r : 0.27, null, 0, { round: true });
    box(shadows, [tx, 0.55, tz], [0.27, 0.02, 0.27]);
    box(floorAO, [tx, 0.008, tz], [0.18, 0.008, 0.18]);
    box(floorAO, [tx, 0.3, tz], [0.025, 0.28, 0.025]);
    if (seat.x === 0) heroProps(b, practicals, [tx, HERO_TABLE.top, tz]);
    else neighbourProps(b, random, practicals, [tx, 0.55, tz], seat.x);
  }

  // =========================================================================
  // 2. THE CURTAIN WALL FRAME — bronze fins, corner posts, head, sill, roof
  //    beams, side glazing frame, the fascia that closes the roof glass.
  // =========================================================================
  glazingFrame(b);
  if (plan.backGlass) {
    backGlazingFrame(b, plan.backGlass);
    const seat = vantage.find((v) => v.id === 'back').chair;
    loungeChair(b, frame([seat.x, 0, seat.z], seat.rot));
    shadowChair(shadows, floorAO, seat.x, seat.z, seat.rot);
    chairBlocker(blockers, seat.x, seat.z, seat.rot, 'back');
  }

  // =========================================================================
  // 3. MID LOUNGE — rug, sofa, two chairs and a travertine table (left);
  //    communal oak table under pendants (right); trees in planters.
  // =========================================================================
  midLounge(b, random, shadows, floorAO, practicals, blockers, plan);

  // =========================================================================
  // 4. BAR, BOARDS, ENTRANCE.
  // =========================================================================
  if (plan.backGlass) pierBar(b, random, shadows, floorAO, practicals, blockers, plan.bar);
  else bar(b, random, shadows, floorAO, practicals, blockers);
  boards(b, practicals, blockers);
  entrance(b, practicals, blockers);

  // =========================================================================
  // 5. THE SHELL — floor, walls, ceiling deck and baffles, skirting.
  //    Last in the buffer (the biggest surfaces, mostly covered).
  // =========================================================================
  ceiling(b, practicals, plan);
  if (plan.upper) upperRoom(b, shadows, floorAO, practicals, blockers, plan, dressing, steamSources);
  shell(b, floorAO, blockers, plan);

  const buckets = b.build();
  let triangles = 0, vertices = 0;
  for (const g of Object.values(buckets)) { triangles += g.index.count / 3; vertices += g.attributes.position.count; }
  BLOCKERS.set(variant, Object.freeze(blockers));
  DRESSING_BUILT.set(variant, Object.freeze([...dressing]));
  if (practicals.steam) steamSources.unshift(practicals.steam);
  return { variant: plan.variant, buckets, practicals, shadows, floorAO, blockers, dressing: Object.freeze([...dressing]), steamSources: Object.freeze(steamSources), stats: { triangles, vertices, parts: b.parts } };
}

// The last build's blockers per variant (they are deterministic): the walk
// (lib/fly/lounge-walk-runtime.js) reads them without building the room twice.
const BLOCKERS = new Map();
// The same for the contracted dressing ids a variant's build contains.
const DRESSING_BUILT = new Map();

/**
 * The contracted dressing ids (upper-dressing.mjs DRESSING) a variant's room
 * contains: behaviour gates on these (an inspectable, a rug's footstep, a
 * cup's steam), never on its own copy of the plan. Built like roomBlockers().
 */
export function roomDressing(variant = 'classic') {
  if (!DRESSING_BUILT.has(variant)) roomBlockers(variant);
  return DRESSING_BUILT.get(variant) ?? Object.freeze([]);
}

/**
 * The room's walk blockers for a variant: those of the room already built
 * (AirportLounge builds it on mount), else a build whose geometry is released
 * at once (~0.1 s).
 */
export function roomBlockers(variant = 'classic') {
  if (!BLOCKERS.has(variant)) {
    const room = buildLoungeRoom({ variant });
    for (const g of Object.values(room.buckets)) g.dispose();
  }
  return BLOCKERS.get(variant);
}

/**
 * A walk blocker: a room-local 2D footprint at body height (floor to ~2 m),
 * overhangs and canopies included. `h` is the half size of an oriented box
 * turned by `rot` (the frame() convention); a `round` blocker is a disc of
 * radius h[0]. The walk grid (room-walk.mjs) inflates every one by the body
 * radius. A sittable chair carries its vantage `seatId`.
 */
function blocker(list, kind, x, z, hx, hz = hx, rot = 0, extra = null) {
  list.push(Object.freeze({ c: Object.freeze([x, z]), h: Object.freeze([hx, hz ?? hx]), rot, kind, ...extra }));
}

/** A lounge chair's footprint (arms and reclined back, measured from loungeChair()). */
function chairBlocker(list, x, z, rot, seatId) {
  // Local footprint: x ±0.43 (the arm boards), z -0.42..0.49 (front legs to the back rail).
  const lz = 0.037;
  blocker(list, 'seat', x + lz * Math.sin(rot), z + lz * Math.cos(rot), 0.43, 0.46, rot, seatId ? { seatId } : null);
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * A mid-century lounge chair: oak frame with broad flat arms, leather (or wool)
 * cushions, the back reclined 16 degrees. Local frame: floor centre, front -Z.
 */
function loungeChair(b, m, { leather = true, color = null, hero = false, lite = false } = {}) {
  const oak = { color: C.oak, rough: 0.5, uv: { texScale: 0.9, grain: 'y' } };
  const oakZ = { ...oak, uv: { texScale: 0.9, grain: 'z' } };
  const oakX = { ...oak, uv: { texScale: 0.9, grain: 'x' } };
  const leg = (x, z, h) => b.add('wood', softBox({ w: 0.046, h, d: 0.046, r: 0.012, seg: 1, div: 1 }), { ...oak, at: [x, h / 2, z], matrix: m });
  for (const x of [-0.37, 0.37]) {
    leg(x, -0.33, 0.56); // front legs carry the arm
    leg(x, 0.3, 0.3);
    // broad flat arm board, softly rounded
    b.add('wood', softBox({ w: 0.11, h: 0.03, d: 0.8, r: 0.013, seg: hero ? 2 : 1, div: hero ? 3 : 1 }), { ...oakZ, at: [x, 0.575, -0.02], matrix: m });
    // side rail
    b.add('wood', softBox({ w: 0.04, h: 0.05, d: 0.62, r: 0.01, seg: 1, div: 1 }), { ...oakZ, at: [x, 0.22, -0.015], matrix: m });
    // back post, reclined with the back
    b.add('wood', softBox({ w: 0.045, h: 0.62, d: 0.045, r: 0.012, seg: 1, div: 1 }), { ...oak, at: [x * 0.97, 0.58, 0.39], rot: [0.28, 0, 0], matrix: m });
  }
  b.add('wood', softBox({ w: 0.7, h: 0.05, d: 0.04, r: 0.01, seg: 1, div: 1 }), { ...oakX, at: [0, 0.22, -0.33], matrix: m });
  b.add('wood', softBox({ w: 0.7, h: 0.05, d: 0.04, r: 0.01, seg: 1, div: 1 }), { ...oakX, at: [0, 0.22, 0.3], matrix: m });
  b.add('wood', softBox({ w: 0.72, h: 0.06, d: 0.04, r: 0.012, seg: 1, div: 1 }), { ...oakX, at: [0, 0.86, 0.47], rot: [0.28, 0, 0], matrix: m });
  // Cushions: crowned, with a softly rolled front edge.
  const bucket = leather ? 'leather' : 'fabric';
  const cushion = leather
    ? { color: color ?? C.leather, rough: 0.46, uv: { texScale: 0.32, grain: 'x' } }
    : { color: color ?? C.olive, rough: 0.92, uv: { texScale: 0.24, grain: 'x' } };
  // `lite` (the pier's reading nook) keeps the shape with fewer facets.
  const cs = lite ? 2 : 3, cd = hero ? 5 : lite ? 2 : 3;
  b.add(bucket, softBox({ w: 0.68, h: 0.12, d: 0.66, r: 0.045, seg: cs, div: cd, crown: 0.026, crownSide: 0.012 }), { ...cushion, at: [0, 0.335, -0.03], matrix: m });
  b.add(bucket, softBox({ w: 0.66, h: 0.52, d: 0.11, r: 0.045, seg: cs, div: cd, crown: 0.0, crownSide: 0.03 }), { ...cushion, at: [0, 0.67, 0.33], rot: [0.28, 0, 0], matrix: m });
  // Lumbar pillow on ours: a softer wool square in a darker tone.
  if (hero) b.add('fabric', softBox({ w: 0.42, h: 0.3, d: 0.1, r: 0.045, seg: 3, div: 3, crownSide: 0.03 }), { color: C.woolDark, rough: 0.95, uv: { texScale: 0.2, grain: 'x' }, at: [0.04, 0.55, 0.22], rot: [0.32, -0.08, 0.06], matrix: m });
}

function shadowChair(shadows, floorAO, x, z, rot) {
  const p = (lx, ly, lz) => framePoint(frame([x, 0, z], rot), lx, ly, lz);
  shadows.push({ c: p(0, 0.33, -0.02), h: [0.42, 0.13, 0.4], rot, k: 1 });
  shadows.push({ c: p(0, 0.66, 0.38), h: [0.37, 0.26, 0.08], rot, k: 1 });
  shadows.push({ c: p(0, 0.575, -0.02), h: [0.42, 0.016, 0.4], rot, k: 1 });
  for (const lx of [-0.37, 0.37]) for (const lz of [-0.33, 0.3]) floorAO.push({ c: p(lx, 0.15, lz), h: [0.025, 0.15, 0.025], rot, k: 1 });
  floorAO.push({ c: p(0, 0.33, -0.02), h: [0.4, 0.06, 0.38], rot, k: 1 });
}

/** A lounge chair's two sun-shadow boxes on a floor at `y0` (the upper room): the seat with its arms, and the back. */
function shadowChairPair(shadows, x, y0, z, rot) {
  const p = (lx, ly, lz) => framePoint(frame([x, y0, z], rot), lx, ly, lz);
  shadows.push({ c: p(0, 0.41, -0.02), h: [0.43, 0.19, 0.41], rot, k: 1 });
  shadows.push({ c: p(0, 0.66, 0.38), h: [0.37, 0.26, 0.08], rot, k: 1 });
}

/** Round pedestal side table: travertine top, bronze stem and foot. */
function sideTable(b, at, top, r = 0.27, segs = 40) {
  const [x, , z] = at;
  const t = 0.032;
  b.add('stone', lathe([[0, top - t], [r - 0.012, top - t], [r, top - t + 0.008], [r, top - 0.008], [r - 0.01, top], [0, top]], segs), { color: C.travertine, rough: 0.38, uv: { mode: 'plan', texScale: 1.2 }, at: [x, 0, z] });
  b.add('metal', cylinder(0.021, 0.024, top - t - 0.02, 16), { color: C.bronze, rough: 0.34, metal: 1, at: [x, (top - t - 0.02) / 2 + 0.018, z] });
  b.add('metal', lathe([[0, 0], [0.17, 0], [0.182, 0.006], [0.175, 0.016], [0.05, 0.022], [0, 0.022]], Math.min(32, segs)), { color: C.bronze, rough: 0.34, metal: 1, at: [x, 0, z] });
}

/**
 * On our table: a stoneware cup of coffee on its saucer, binoculars laid
 * down, the spotter's notebook with a pen. `at` is the table-top centre.
 */
function heroProps(b, practicals, at) {
  const [tx, ty, tz] = at;
  const m = frame([tx, ty, tz], -0.35);
  // Saucer: glossy white glaze, a shallow well.
  b.add('small', lathe([[0, 0.001], [0.05, 0.001], [0.062, 0.004], [0.074, 0.011], [0.077, 0.014], [0.072, 0.0135], [0.058, 0.008], [0.032, 0.0075], [0, 0.0075]], 40), { color: C.ceramic, rough: 0.1, flag: SURF.CERAMIC, at: [-0.09, 0, -0.073], matrix: m });
  // Cup: matte speckled stoneware outside, white glaze inside and on the lip.
  const cup = [-0.09, 0.0075, -0.073];
  b.add('small', lathe([[0.001, 0], [0.027, 0], [0.03, 0.004], [0.036, 0.03], [0.041, 0.062], [0.0425, 0.074]], 40), { color: C.stoneware, rough: 0.62, flag: SURF.CERAMIC, at: cup, matrix: m });
  b.add('small', lathe([[0.0425, 0.074], [0.0436, 0.0765], [0.0418, 0.0775], [0.0392, 0.073], [0.035, 0.05], [0.03, 0.02], [0.026, 0.01], [0.001, 0.009]], 40), { color: C.ceramic, rough: 0.07, flag: SURF.CERAMIC, at: cup, matrix: m });
  // Coffee with a crema ring (vertex colours on a small lathe disc).
  const coffee = b.add('small', lathe([[0.001, 0.0645], [0.012, 0.0645], [0.026, 0.0648], [0.036, 0.0652], [0.0388, 0.066]], 40), { color: '#3a2214', rough: 0.18, at: cup, matrix: m });
  tintRings(coffee, [[0.0, '#2c190f'], [0.013, '#6b3f22'], [0.027, '#a8754a'], [0.036, '#7b4d2c'], [0.04, '#5a341d']], cup, m);
  b.add('small', torus(0.021, 0.0055, 10, 18, Math.PI * 1.15), { color: C.stoneware, rough: 0.6, at: [cup[0] + 0.052, cup[1] + 0.042, cup[2]], rot: [0, 0, -Math.PI * 0.575], matrix: m });
  practicals.steam = { at: framePoint(m, cup[0], cup[1] + 0.075, cup[2]), r: 0.036 };

  // Binoculars (roof prism 8x42), lying on the table. Local frame: barrels
  // along Z, objectives toward -Z, resting on the table top.
  const bm = frame([0.1, 0, -0.085], 0.55).premultiply(m);
  const lay = [Math.PI / 2, 0, 0]; // lathe/cylinder +Y -> +Z
  for (const side of [-1, 1]) {
    const x = side * 0.034, y = 0.0292;
    b.add('small', lathe([[0.0, 0], [0.0285, 0], [0.0292, 0.004], [0.0292, 0.036], [0.0272, 0.044], [0.0262, 0.106], [0.0222, 0.118], [0.0215, 0.13], [0.0, 0.13]], 28), { color: C.rubber, rough: 0.72, at: [x, y, -0.065], rot: lay, matrix: bm });
    b.add('small', lathe([[0.0, 0], [0.0195, 0], [0.0205, 0.004], [0.0205, 0.024], [0.0182, 0.0262], [0.0128, 0.026], [0.0, 0.026]], 24), { color: '#141516', rough: 0.86, at: [x, y, 0.065], rot: lay, matrix: bm });
    // objective: coated glass sunk in a metal rim
    b.add('metal', torus(0.0262, 0.0026, 6, 28), { color: '#2a2622', rough: 0.3, metal: 1, at: [x, y, -0.064], matrix: bm });
    b.add('small', cylinder(0.025, 0.025, 0.002, 28), { color: '#07090c', rough: 0.04, flag: SURF.LENS, at: [x, y, -0.061], rot: lay, matrix: bm });
    b.add('small', cylinder(0.011, 0.011, 0.002, 18), { color: '#0a0b0d', rough: 0.05, flag: SURF.LENS, at: [x, y, 0.088], rot: lay, matrix: bm });
  }
  // hinge bridge and focus wheel
  b.add('small', softBox({ w: 0.04, h: 0.022, d: 0.07, r: 0.008, seg: 2, div: 1 }), { color: '#1b1c1d', rough: 0.55, at: [0, 0.033, 0.02], matrix: bm });
  b.add('metal', cylinder(0.011, 0.011, 0.016, 20), { color: '#2b2b2c', rough: 0.4, metal: 0.6, at: [0, 0.047, 0.035], rot: [0, 0, Math.PI / 2], matrix: bm });
  // neck strap, folded beside the body
  const strap = new CatmullRomCurve3([[-0.062, 0.012, 0.03], [-0.11, 0.004, -0.02], [-0.09, 0.003, -0.11], [-0.02, 0.003, -0.13], [0.06, 0.003, -0.12], [0.1, 0.004, -0.04], [0.062, 0.012, 0.03]].map((p) => new Vector3(...p)));
  b.add('small', tube(strap, 40, 0.004, 6), { color: '#2c2a27', rough: 0.8, matrix: bm });

  // The spotter's notebook (hardbound A5, linen cover, elastic band) + pen.
  const nm = frame([0.02, 0, 0.115], -0.12).premultiply(m);
  b.add('small', softBox({ w: 0.142, h: 0.012, d: 0.205, r: 0.002, seg: 1, div: 1 }), { color: C.paper, rough: 0.9, flag: SURF.PAPER, at: [0, 0.0075, 0], matrix: nm });
  for (const y of [0.0012, 0.0138]) b.add('small', softBox({ w: 0.15, h: 0.0024, d: 0.212, r: 0.0011, seg: 1, div: 1 }), { color: '#2f3a33', rough: 0.85, at: [-0.002, y, 0], matrix: nm });
  b.add('small', softBox({ w: 0.006, h: 0.0152, d: 0.212, r: 0.0025, seg: 2, div: 1 }), { color: '#2f3a33', rough: 0.85, at: [-0.076, 0.0075, 0], matrix: nm });
  b.add('small', softBox({ w: 0.0065, h: 0.0168, d: 0.214, r: 0.002, seg: 1, div: 1 }), { color: '#151515', rough: 0.6, at: [0.052, 0.0075, 0], matrix: nm });
  // Pen along local X on the cover: black lacquer barrel, brass tip and clip.
  const pen = frame([0.012, 0.0196, 0.01], 0.42).premultiply(nm);
  const alongX = [0, 0, Math.PI / 2]; // cylinder +Y -> -X
  b.add('small', cylinder(0.0046, 0.0046, 0.118, 16), { color: '#151618', rough: 0.22, rot: alongX, matrix: pen });
  b.add('metal', cylinder(0.0012, 0.0046, 0.022, 16), { color: '#b9a27a', rough: 0.25, metal: 1, at: [-0.07, 0, 0], rot: alongX, matrix: pen });
  b.add('metal', softBox({ w: 0.042, h: 0.002, d: 0.0035, r: 0.0009, seg: 1, div: 1 }), { color: '#b9a27a', rough: 0.25, metal: 1, at: [0.035, 0.005, 0], matrix: pen });
}

/** Recolour a lathe's vertices by radius (crema rings). */
function tintRings(g, stops, centre, m) {
  // `g` is already transformed; compute radius around the transformed centre.
  const c = new Vector3(...centre).applyMatrix4(m);
  const p = g.attributes.position, col = g.attributes.color;
  const lin = stops.map(([r, hex]) => [r, ...hexLinear(hex)]);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i) - c.x, p.getZ(i) - c.z);
    let k = 0;
    while (k < lin.length - 2 && r > lin[k + 1][0]) k++;
    const a = lin[k], bb = lin[k + 1], t = Math.min(1, Math.max(0, (r - a[0]) / Math.max(1e-6, bb[0] - a[0])));
    col.setXYZ(i, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t);
  }
}
function hexLinear(hex) {
  const n = parseInt(hex.slice(1), 16), f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/**
 * The neighbouring tables: a cordless opal table lamp in the middle (the
 * window line's warm accents after dark) and light, varied props around it.
 */
function neighbourProps(b, random, practicals, at, seatX) {
  const [x, y, z] = at;
  tableLamp(b, practicals, x, y, z, 0.27);
  const pick = Math.abs(Math.round(seatX / 4.48)) % 3;
  if (pick === 1) {
    // two stacked paperbacks
    b.add('small', softBox({ w: 0.11, h: 0.022, d: 0.165, r: 0.003, seg: 1, div: 1 }), { color: '#8a3a2c', rough: 0.7, at: [x - 0.13, y + 0.011, z + 0.07], rot: [0, 0.35, 0] });
    b.add('small', softBox({ w: 0.1, h: 0.018, d: 0.15, r: 0.003, seg: 1, div: 1 }), { color: '#27405a', rough: 0.7, at: [x - 0.125, y + 0.031, z + 0.072], rot: [0, 0.18, 0] });
  } else {
    // a water glass and a phone face down
    b.add('small', lathe([[0, 0], [0.032, 0], [0.034, 0.002], [0.036, 0.1], [0.033, 0.1], [0.031, 0.006], [0, 0.006]], 24), { color: '#c9d4d4', rough: 0.12, flag: SURF.CERAMIC, at: [x + 0.13, y, z - 0.09] });
    b.add('small', softBox({ w: 0.072, h: 0.008, d: 0.15, r: 0.004, seg: 2, div: 1 }), { color: '#1c1d20', rough: 0.3, at: [x - 0.14, y + 0.004, z + 0.05], rot: [0, -0.3 + random() * 0.2, 0] });
  }
}

/**
 * A cordless table lamp: brushed-brass trumpet stem under an opal dome. By day
 * the dome is a lit white surface; after dark it glows (SURF.OPAL) and its
 * underside is the light. The light is a downward spot whose table top
 * occludes it (disc), so the floor under the table stays dark.
 */
function tableLamp(b, practicals, x, y, z, tableR, power = 0.18) {
  b.add('metal', lathe([[0, 0], [0.056, 0], [0.058, 0.003], [0.05, 0.009], [0.03, 0.02], [0.017, 0.04], [0.0105, 0.09], [0.0085, 0.2], [0.0085, 0.262], [0, 0.262]], 28), { color: '#b08d57', rough: 0.32, metal: 1, at: [x, y, z] });
  b.add('small', lathe([[0.112, 0.266], [0.117, 0.27], [0.113, 0.292], [0.098, 0.315], [0.073, 0.332], [0.04, 0.341], [0, 0.344]], 32), { color: '#f4efe6', rough: 0.35, flag: SURF.OPAL, at: [x, y, z] });
  b.add('emissive', lathe([[0, 0.334], [0.04, 0.331], [0.072, 0.321], [0.096, 0.304], [0.11, 0.28], [0.112, 0.266]], 32), { color: '#ffdcae', rough: GLOW.TABLE, at: [x, y, z] });
  practicals.push({ type: 'spot', p: [x, y + 0.3, z], d: [0, -1, 0], color: [1, 0.78, 0.52], power, range: 3, cone: [-0.25, 0.45], group: GLOW.TABLE, disc: [y, tableR] });
}

// ---------------------------------------------------------------------------
// The curtain wall frame
// ---------------------------------------------------------------------------
function glazingFrame(b) {
  // Satin champagne-bronze powder coat: light enough to read against the
  // window instead of as a black slab, warm enough to sit with the oak.
  const bronze = { color: C.frame, rough: 0.46, metal: 0.35, uv: { texScale: 0.5, grain: 'z' } };
  const dark = { color: C.frameDark, rough: 0.45, metal: 0.4 };
  const length = (HEAD_Y - SILL_Y) / Math.cos(Math.atan(CANT));
  const lean = Math.atan(CANT); // the wall leans out (toward -Z) as it rises
  // A fin profile in its own plane: x across the face, y into the room (0 at
  // the glass). Slim nose with a shadow reveal 30 mm behind the face.
  const w = MULLION_HALF, d = MULLION_DEPTH;
  const fin = [
    [-w * 0.55, 0], [w * 0.55, 0], [w * 0.55, 0.02], [w, 0.03], [w, d - 0.05], [w * 0.62, d - 0.044],
    [w * 0.62, d - 0.036], [w, d - 0.03], [w, d - 0.006], [w - 0.006, d], [-w + 0.006, d], [-w, d - 0.006],
    [-w, d - 0.03], [-w * 0.62, d - 0.036], [-w * 0.62, d - 0.044], [-w, d - 0.05], [-w, 0.03], [-w * 0.55, 0.02],
  ];
  // Orient: profile (px, py) -> world x = px, into-room = py; extrusion along
  // the canted wall from sill to head.
  const finGeo = prism(fin, length, { smoothDeg: 20 });
  // prism extrudes along +Z with the profile in XY: rotate so profile Y points
  // into the room (+Z) and the extrusion runs up the wall.
  for (const x of MULLION_X) {
    // Rx(lean - 90deg) then Ry(180deg): extrusion runs up the canted wall,
    // profile y points into the room (+Z), the symmetric profile x mirrors.
    b.add('metal', finGeo.clone(), { ...bronze, flag: SURF.LONG, at: [x, SILL_Y, frontZ(SILL_Y)], rot: [lean - Math.PI / 2, Math.PI, 0], uv: { texScale: 0.6, grain: 'z' } });
  }
  finGeo.dispose();
  // Corner posts (square, canted with the wall).
  for (const s of [-1, 1]) {
    const post = softBox({ w: CORNER_HALF * 2, h: length, d: 0.14, r: 0.01, seg: 1, div: 1 });
    b.add('metal', post, { ...bronze, flag: SURF.LONG, at: [s * (HALF_X - CORNER_HALF * 0.3), (SILL_Y + HEAD_Y) / 2, (frontZ(SILL_Y) + HEAD_Z) / 2 + 0.06], rot: [-lean, 0, 0], uv: { texScale: 0.6, grain: 'y' } });
  }
  // Head transom: where the front glass meets the roof glass.
  const head = prism([[0, 0], [HEAD_DEPTH, 0], [HEAD_DEPTH, -0.07], [HEAD_DEPTH - 0.02, -0.09], [0.04, -0.17], [0, -0.17]], HALF_X * 2, { smoothDeg: 10 });
  // Ry(-90deg): the extrusion runs from +x to -x, profile x points into the room.
  b.add('metal', head, { ...bronze, flag: SURF.LONG, at: [HALF_X, HEAD_Y, HEAD_Z], rot: [0, -Math.PI / 2, 0], uv: { texScale: 0.6, grain: 'z' } });
  // Sill: the glazing shoe and the linear trench-heater grille in front of it.
  b.add('metal', softBox({ w: HALF_X * 2, h: 0.15, d: 0.11, r: 0.006, seg: 1, div: 1 }), { ...dark, flag: SURF.LONG, at: [0, 0.075, frontZ(0.075) + 0.045] });
  b.add('metal', softBox({ w: HALF_X * 2 - 0.02, h: 0.012, d: 0.25, r: 0.002, seg: 1, div: 1 }), { color: '#2c2621', rough: 0.5, metal: 1, flag: SURF.GRILLE, uv: { texScale: 1, grain: 'x' }, at: [0, -0.004, frontZ(0) + 0.24] });
  // Roof beams on the mullion pitch, plus the edge beams over the side glass.
  const roofLen = ROOF_Z1 - HEAD_Z;
  for (const x of [...MULLION_X, -HALF_X + 0.04, HALF_X - 0.04]) {
    const edge = Math.abs(x) > HALF_X - 0.1;
    b.add('metal', softBox({ w: edge ? 0.1 : MULLION_HALF * 2, h: MULLION_DEPTH, d: roofLen, r: 0.006, seg: 1, div: 1 }), { ...bronze, flag: SURF.LONG, at: [x, HEAD_Y - MULLION_DEPTH / 2, (HEAD_Z + ROOF_Z1) / 2], uv: { texScale: 0.6, grain: 'z' } });
  }
  // Side glazing: shoe, head, the intermediate fin, the end post where the
  // solid wall begins.
  for (const s of [-1, 1]) {
    const x = s * HALF_X;
    const z0 = frontZ(SILL_Y), len = SIDE_Z1 - z0;
    b.add('metal', softBox({ w: 0.11, h: 0.15, d: len, r: 0.006, seg: 1, div: 1 }), { ...dark, flag: SURF.LONG, at: [x - s * 0.045, 0.075, z0 + len / 2] });
    for (const zm of SIDE_MULLION_Z) {
      b.add('metal', softBox({ w: MULLION_DEPTH, h: HEAD_Y - SILL_Y, d: MULLION_HALF * 2, r: 0.006, seg: 1, div: 1 }), { ...bronze, flag: SURF.LONG, at: [x - s * MULLION_DEPTH / 2, (SILL_Y + HEAD_Y) / 2, zm], uv: { texScale: 0.6, grain: 'y' } });
    }
    b.add('metal', softBox({ w: 0.26, h: HEAD_Y, d: 0.26, r: 0.01, seg: 1, div: 1 }), { ...bronze, flag: SURF.LONG, at: [x - s * 0.11, HEAD_Y / 2, SIDE_Z1 + 0.05], uv: { texScale: 0.6, grain: 'y' } });
  }
  // The fascia beam that closes the roof glass: oak-clad, a bronze drip line
  // on its leading edge and the cove light slot on its top-back.
  const fz = ROOF_Z1 + FASCIA_DEPTH / 2;
  b.add('wood', softBox({ w: HALF_X * 2, h: FASCIA_DROP, d: FASCIA_DEPTH, r: 0.012, seg: 2, div: 2 }), { color: C.oak, rough: 0.52, flag: SURF.LONG, uv: { texScale: 1.1, grain: 'x' }, at: [0, HEAD_Y - FASCIA_DROP / 2, fz] });
  b.add('metal', softBox({ w: HALF_X * 2, h: 0.03, d: 0.03, r: 0.004, seg: 1, div: 1 }), { ...dark, flag: SURF.LONG, at: [0, HEAD_Y - FASCIA_DROP + 0.015, ROOF_Z1 - 0.005] });
}

// ---------------------------------------------------------------------------
// Mid lounge
// ---------------------------------------------------------------------------
function midLounge(b, random, shadows, floorAO, practicals, blockers, plan) {
  // --- Left group on a bordered wool rug ---------------------------------
  const lx = -5.4, lz = 6.5;
  rug(b, [lx, lz], 3.4, 2.6, C.wool, C.woolDark);
  // Sofa facing the window: oak plinth, boucle cushions.
  sofa(b, frame([lx, 0, lz + 1.15], 0), C.boucle);
  blocker(blockers, 'sofa', lx, lz + 1.15, 1.22, 0.45);
  shadows.push({ c: [lx, 0.33, lz + 1.15], h: [1.2, 0.33, 0.45], rot: 0, k: 1 });
  shadows.push({ c: [lx, 0.6, lz + 1.5], h: [1.15, 0.25, 0.12], rot: 0, k: 1 });
  floorAO.push({ c: [lx, 0.2, lz + 1.15], h: [1.18, 0.2, 0.44], rot: 0, k: 1 });
  // Two lounge chairs facing each other across a travertine table.
  for (const s of (plan.upper ? [] : [-1, 1])) {
    const cx = lx + s * 1.55, rot = s < 0 ? -Math.PI / 2 : Math.PI / 2;
    loungeChair(b, frame([cx, 0, lz - 0.05], rot), { leather: false, color: C.olive });
    chairBlocker(blockers, cx, lz - 0.05, rot);
    shadowChair(shadows, floorAO, cx, lz - 0.05, rot);
  }
  const top = superellipse(0.62, 0.38, 3.2, 56);
  b.add('stone', slab(top, 0.045, { edge: 0.012 }), { color: C.travertine, rough: 0.36, uv: { mode: 'plan', texScale: 1.2 }, at: [lx, 0.335, lz - 0.05] });
  b.add('stone', slab(superellipse(0.44, 0.22, 3.2, 40), 0.335), { color: C.travertineDark, rough: 0.5, uv: { texScale: 1.2, grain: 'y' }, at: [lx, 0, lz - 0.05] });
  shadows.push({ c: [lx, 0.19, lz - 0.05], h: [0.6, 0.19, 0.36], rot: 0, k: 1 });
  blocker(blockers, 'table', lx, lz - 0.05, 0.62, 0.38);
  floorAO.push({ c: [lx, 0.17, lz - 0.05], h: [0.44, 0.17, 0.22], rot: 0, k: 1 });
  // A tray with a small vase on it.
  b.add('small', lathe([[0, 0], [0.05, 0], [0.058, 0.03], [0.05, 0.11], [0.022, 0.16], [0.02, 0.19], [0.016, 0.19], [0.0, 0.17]], 24), { color: '#2b3a3c', rough: 0.15, flag: SURF.CERAMIC, at: [lx + 0.18, 0.38, lz - 0.1] });
  b.add('small', softBox({ w: 0.24, h: 0.02, d: 0.17, r: 0.004, seg: 1, div: 1 }), { color: '#1e1e1f', rough: 0.5, at: [lx - 0.16, 0.39, lz - 0.02], rot: [0, 0.18, 0] });

  // --- Right: communal oak table under three pendants --------------------
  const rx = plan.communalTableX, rz = 6.6;
  rug(b, [rx, rz], 5.2, 2.9, '#7a6a5a', '#5a4c40');
  b.add('wood', slab(roundedRect(4.2, 1.1, 0.12, 5), 0.055, { edge: 0.01 }), { color: C.oak, rough: 0.5, flag: SURF.PLANKS, uv: { mode: 'plan', texScale: 1.4 }, at: [rx, 0.72, rz] });
  for (const s of [-1, 1]) {
    // bronze trestles: two legs and a foot per end
    for (const dz of [-0.36, 0.36]) b.add('metal', softBox({ w: 0.05, h: 0.71, d: 0.05, r: 0.008, seg: 1, div: 1 }), { color: C.bronze, rough: 0.34, metal: 1, at: [rx + s * 1.6, 0.36, rz + dz] });
    b.add('metal', softBox({ w: 0.06, h: 0.03, d: 0.95, r: 0.006, seg: 1, div: 1 }), { color: C.bronze, rough: 0.34, metal: 1, at: [rx + s * 1.6, 0.015, rz] });
    b.add('metal', softBox({ w: 0.05, h: 0.04, d: 0.8, r: 0.006, seg: 1, div: 1 }), { color: C.bronze, rough: 0.34, metal: 1, at: [rx + s * 1.6, 0.69, rz] });
  }
  shadows.push({ c: [rx, 0.745, rz], h: [2.1, 0.03, 0.55], rot: 0, k: 1 });
  // The table with its eight chairs pulled up: one block (the chair backs reach rz ± 0.96).
  blocker(blockers, 'table', rx, rz, 2.1, 0.96);
  for (const s of [-1, 1]) floorAO.push({ c: [rx + s * 1.6, 0.35, rz], h: [0.04, 0.35, 0.45], rot: 0, k: 1 });
  // Eight dining chairs.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const cx = rx - 1.5 + i, cz = rz + s * 0.74, rot = s < 0 ? 0 : Math.PI;
      diningChair(b, frame([cx, 0, cz], rot + (random() - 0.5) * 0.12));
      floorAO.push({ c: [cx, 0.22, cz], h: [0.22, 0.22, 0.22], rot, k: 0.55 });
    }
    // one soft proxy per row of chairs (seats and backs, partly see-through)
    shadows.push({ c: [rx, 0.45, rz + s * 0.78], h: [1.75, 0.38, 0.24], rot: 0, k: 0.5 });
  }
  // Pendants: bronze cylinders with a warm diffuser, on thin rods.
  for (const dx of [-1.4, 0, 1.4]) {
    const px = rx + dx, py = 2.15;
    b.add('metal', lathe([[0.0, 0.32], [0.1, 0.32], [0.105, 0.31], [0.105, 0.02], [0.098, 0.0], [0.09, 0.0], [0.09, 0.29], [0.0, 0.29]], 28), { color: C.bronzeDark, rough: 0.3, metal: 1, at: [px, py, rz] });
    b.add('emissive', cylinder(0.088, 0.088, 0.004, 28), { color: '#ffd29a', tint: 1, rough: GLOW.PENDANT, at: [px, py + 0.01, rz] });
    b.add('metal', cylinder(0.0035, 0.0035, DECK_Y - (py + 0.32), 6), { color: C.blackMetal, rough: 0.5, metal: 1, at: [px, (DECK_Y + py + 0.32) / 2, rz] });
    practicals.push({ type: 'spot', p: [px, py - 0.02, rz], d: [0, -1, 0], color: [1, 0.74, 0.47], power: 2.0, range: 6, cone: [0.5, 1.15], group: GLOW.PENDANT });
  }

  // --- Planting: olive trees in travertine planters near the side glass, tall
  // figs at the back corners. ---------------------------------------------
  for (const s of [-1, 1]) {
    if (!plan.upper || s > 0) {
    oliveTree(b, random, s * 10.15, 3.15, 2.9);
    // The planter is r 0.47; the canopy starts 2.03 m up and reaches ~0.9 m
    // out, so the walker's head stays clear of its lower edge.
    blocker(blockers, 'planter', s * 10.15, 3.15, 0.8, null, 0, { round: true });
    shadows.push({ c: [s * 10.15, 0.38, 3.15], h: [0.48, 0.38, 0.48], rot: 0, k: 1 });
    shadows.push({ c: [s * 10.15, 2.25, 3.15], h: [0.95, 0.75, 0.95], rot: 0, k: 0.55 });
    floorAO.push({ c: [s * 10.15, 0.36, 3.15], h: [0.47, 0.36, 0.47], rot: 0, k: 1 });
    }
    figTree(b, random, s * 10.25, 13.25, 2.6);
    // Big leaves from ~1.5 m up reach ~0.75 m out.
    blocker(blockers, 'planter', s * 10.25, 13.25, 0.8, null, 0, { round: true });
    floorAO.push({ c: [s * 10.25, 0.36, 13.25], h: [0.47, 0.36, 0.47], rot: 0, k: 1 });
  }
  if (!plan.upper) banquette(b, shadows, floorAO, practicals, blockers);
  if (plan.art) artWall(b, practicals, blockers);
}

/**
 * Along the left wall: a long upholstered banquette under a reeded oak wall,
 * small travertine tables in front, brass sconces between.
 */
function banquette(b, shadows, floorAO, practicals, blockers) {
  const x = -HALF_X, z0 = 4.9, z1 = 12.3, len = z1 - z0, zc = (z0 + z1) / 2;
  const fab = { color: '#a8805a', rough: 0.95, uv: { texScale: 0.25, grain: 'z' } };
  // oak plinth, seat, back cushions in segments
  b.add('wood', softBox({ w: 0.56, h: 0.12, d: len, r: 0.01, seg: 1, div: 1 }), { color: C.oakDark, rough: 0.55, uv: { texScale: 1.4, grain: 'z' }, at: [x + 0.32, 0.08, zc] });
  b.add('fabric', softBox({ w: 0.62, h: 0.2, d: len, r: 0.05, seg: 3, div: 3, crown: 0.012 }), { ...fab, at: [x + 0.34, 0.33, zc] });
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const zz = z0 + (i + 0.5) * (len / segs);
    b.add('fabric', softBox({ w: 0.18, h: 0.52, d: len / segs - 0.03, r: 0.07, seg: 3, div: 3, crownSide: 0.03 }), { ...fab, at: [x + 0.12, 0.7, zz], rot: [0, 0, -0.12] });
  }
  shadows.push({ c: [x + 0.32, 0.3, zc], h: [0.32, 0.3, len / 2], rot: 0, k: 1 });
  blocker(blockers, 'sofa', x + 0.325, zc, 0.325, len / 2 + 0.015); // the wall to the seat's front edge (x + 0.65), and the cushions' rounded ends
  floorAO.push({ c: [x + 0.32, 0.22, zc], h: [0.3, 0.22, len / 2], rot: 0, k: 1 });
  // small round tables
  for (const zz of [5.9, 8.6, 11.3]) {
    sideTable(b, [x + 1.05, 0, zz], 0.52, 0.3);
    blocker(blockers, 'table', x + 1.05, zz, 0.3, null, 0, { round: true });
    floorAO.push({ c: [x + 1.05, 0.008, zz], h: [0.18, 0.008, 0.18], rot: 0, k: 1 });
    shadows.push({ c: [x + 1.05, 0.5, zz], h: [0.3, 0.02, 0.3], rot: 0, k: 1 });
  }
  // brass sconces on the reeded wall, washing up and down
  for (const zz of [7.25, 9.95]) {
    b.add('metal', lathe([[0, 0], [0.05, 0], [0.055, 0.01], [0.055, 0.2], [0.05, 0.21], [0, 0.21]], 20), { color: '#a8875a', rough: 0.3, metal: 1, at: [x + 0.06, 2.0, zz], rot: [0, 0, Math.PI / 2] });
    b.add('emissive', cylinder(0.045, 0.045, 0.004, 16), { color: '#ffd6a0', tint: 1.5, rough: GLOW.LAMP, at: [x + 0.17, 2.112, zz] });
    b.add('emissive', cylinder(0.045, 0.045, 0.004, 16), { color: '#ffd6a0', tint: 1.5, rough: GLOW.LAMP, at: [x + 0.17, 1.888, zz] });
    practicals.push({ type: 'spot', p: [x + 0.17, 2.0, zz], d: [0, -1, 0], color: [1, 0.76, 0.5], power: 0.8, range: 4, cone: [0.3, 0.9], group: GLOW.LAMP });
  }
}

/**
 * The right wall before the entrance: a large abstract canvas (painted in the
 * shader, SURF.ART) in a slim oak frame, over a low oak credenza.
 */
function artWall(b, practicals, blockers) {
  const x = HALF_X, zc = 7.2, w = 3.4, h = 1.9, y = 1.95;
  blocker(blockers, 'counter', x - 0.25, zc, 0.25, 1.32); // the credenza (the canvas lies inside the wall's own blocker)
  b.add('wood', softBox({ w: 0.05, h: h + 0.08, d: w + 0.08, r: 0.008, seg: 1, div: 1 }), { color: C.oakDark, rough: 0.5, uv: { texScale: 1.4, grain: 'z' }, at: [x - 0.03, y, zc] });
  b.add('plaster', softBox({ w: 0.02, h, d: w, r: 0.002, seg: 1, div: 1 }), { color: '#ffffff', rough: 0.85, flag: SURF.ART, uv: { texScale: 0.4, grain: 'z' }, at: [x - 0.061, y, zc] });
  b.add('wood', softBox({ w: 0.48, h: 0.62, d: 2.6, r: 0.01, seg: 1, div: 3 }), { color: C.oakSmoked, rough: 0.5, flag: SURF.FLUTED, uv: { texScale: 1.4, grain: 'y' }, at: [x - 0.25, 0.33, zc] });
  b.add('stone', softBox({ w: 0.5, h: 0.03, d: 2.64, r: 0.004, seg: 1, div: 2 }), { color: C.travertine, rough: 0.35, uv: { texScale: 1.2, grain: 'z' }, at: [x - 0.25, 0.655, zc] });
  // a stoneware vase and a stack of books on the credenza
  b.add('small', lathe([[0, 0], [0.07, 0], [0.11, 0.08], [0.1, 0.22], [0.05, 0.32], [0.045, 0.36], [0, 0.35]], 28), { color: '#3d4b4d', rough: 0.3, flag: SURF.CERAMIC, at: [x - 0.25, 0.67, zc - 0.8] });
  b.add('small', softBox({ w: 0.3, h: 0.05, d: 0.22, r: 0.004, seg: 1, div: 1 }), { color: '#7a3b2e', rough: 0.7, at: [x - 0.25, 0.695, zc + 0.6] });
  b.add('small', softBox({ w: 0.27, h: 0.04, d: 0.2, r: 0.004, seg: 1, div: 1 }), { color: '#d9d2c3', rough: 0.8, at: [x - 0.25, 0.74, zc + 0.62], rot: [0, 0.1, 0] });
  // picture light
  b.add('metal', softBox({ w: 0.08, h: 0.04, d: 1.4, r: 0.01, seg: 1, div: 1 }), { color: '#a8875a', rough: 0.3, metal: 1, at: [x - 0.18, y + h / 2 + 0.16, zc] });
  b.add('emissive', softBox({ w: 0.03, h: 0.004, d: 1.3, r: 0.001, seg: 1, div: 1 }), { color: '#ffe0b8', tint: 1.2, rough: GLOW.LAMP, at: [x - 0.2, y + h / 2 + 0.137, zc] });
  practicals.push({ type: 'line', a: [x - 0.22, y + h / 2 + 0.12, zc - 0.65], b: [x - 0.22, y + h / 2 + 0.12, zc + 0.65], n: [0.5, -1, 0], color: [1, 0.82, 0.6], power: 0.35, range: 3, group: GLOW.LAMP });
}

function rug(b, [x, z], w, d, field, border) {
  const outline = (inset) => roundedRect(w - inset * 2, d - inset * 2, 0.06, 3).map(([px, py]) => [px, py]);
  b.add('fabric', slab(outline(0), 0.012, { edge: 0.006, edgeSeg: 2 }), { color: border, rough: 1, flag: SURF.RUG, uv: { mode: 'plan', texScale: 0.5 }, at: [x, 0, z] });
  b.add('fabric', slab(outline(0.16), 0.0135), { color: field, rough: 1, flag: SURF.RUG, uv: { mode: 'plan', texScale: 0.5 }, at: [x, 0, z] });
}

/** Three-seat sofa (boucle on an oak plinth). Local: floor centre, front -Z. */
function sofa(b, m, color) {
  const fab = { color, rough: 0.96, uv: { texScale: 0.25, grain: 'x' } };
  b.add('wood', softBox({ w: 2.3, h: 0.1, d: 0.84, r: 0.01, seg: 1, div: 3 }), { color: C.oakDark, rough: 0.55, uv: { texScale: 1, grain: 'x' }, at: [0, 0.07, 0], matrix: m });
  b.add('fabric', softBox({ w: 2.34, h: 0.22, d: 0.88, r: 0.05, seg: 3, div: 4 }), { ...fab, at: [0, 0.23, 0], matrix: m });
  for (const dx of [-0.57, 0.57]) b.add('fabric', softBox({ w: 1.12, h: 0.14, d: 0.66, r: 0.06, seg: 3, div: 4, crown: 0.03, crownSide: 0.015 }), { ...fab, at: [dx, 0.4, -0.08], matrix: m });
  for (const dx of [-0.57, 0.57]) b.add('fabric', softBox({ w: 1.12, h: 0.42, d: 0.2, r: 0.08, seg: 3, div: 4, crownSide: 0.04 }), { ...fab, at: [dx, 0.62, 0.3], rot: [0.16, 0, 0], matrix: m });
  for (const s of [-1, 1]) b.add('fabric', softBox({ w: 0.2, h: 0.36, d: 0.88, r: 0.08, seg: 3, div: 3, crownSide: 0.01 }), { ...fab, at: [s * 1.12, 0.5, 0], matrix: m });
}

/** A light oak dining chair with a leather seat pad. Local: front -Z. */
function diningChair(b, m) {
  const oak = { color: C.oak, rough: 0.5, uv: { texScale: 0.9, grain: 'y' } };
  for (const x of [-0.2, 0.2]) for (const z of [-0.19, 0.19]) b.add('wood', cylinder(0.016, 0.013, 0.45, 8), { ...oak, at: [x, 0.225, z], matrix: m });
  b.add('wood', softBox({ w: 0.44, h: 0.035, d: 0.42, r: 0.01, seg: 1, div: 1 }), { ...oak, uv: { texScale: 0.9, grain: 'x' }, at: [0, 0.45, 0], matrix: m });
  b.add('leather', softBox({ w: 0.4, h: 0.04, d: 0.38, r: 0.016, seg: 2, div: 2, crown: 0.008 }), { color: C.leatherDark, rough: 0.5, uv: { texScale: 0.3, grain: 'x' }, at: [0, 0.485, -0.01], matrix: m });
  for (const x of [-0.2, 0.2]) b.add('wood', cylinder(0.014, 0.016, 0.38, 8), { ...oak, at: [x, 0.66, 0.2], rot: [0.12, 0, 0], matrix: m });
  b.add('wood', softBox({ w: 0.46, h: 0.07, d: 0.025, r: 0.01, seg: 1, div: 1 }), { ...oak, uv: { texScale: 0.9, grain: 'x' }, at: [0, 0.8, 0.225], rot: [0.12, 0, 0], matrix: m });
}

/** A planter: a travertine bowl with a soil top. */
function planter(b, x, z, pr = 0.47, ph = 0.72, segs = 40) {
  b.add('stone', lathe([[0, 0], [pr - 0.06, 0], [pr - 0.02, 0.03], [pr, 0.12], [pr, ph - 0.02], [pr - 0.012, ph], [pr - 0.05, ph], [pr - 0.05, ph - 0.06], [0, ph - 0.06]], segs), { color: C.travertineDark, rough: 0.5, uv: { mode: 'cyl', texScale: 1.2 }, at: [x, 0, z] });
  b.add('small', cylinder(pr - 0.05, pr - 0.05, 0.01, Math.min(30, segs)), { color: C.soil, rough: 1, at: [x, ph - 0.07, z] });
}

const curve = (pts) => new CatmullRomCurve3(pts.map((p) => new Vector3(...p)));

/**
 * An olive tree: a gnarled trunk splitting into limbs and twigs, dense
 * silver-green foliage concentrated toward the twig ends.
 */
function oliveTree(b, random, x, z, height) {
  const ph = 0.72;
  planter(b, x, z);
  const bark = { color: '#6b5d4f', rough: 0.9, uv: { mode: 'cyl', texScale: 0.4 } };
  const lean = (random() - 0.5) * 0.25;
  const top = [x + lean, ph + height * 0.36, z + (random() - 0.5) * 0.1];
  b.add('wood', taperTube(curve([[x, ph - 0.06, z], [x + lean * 0.2 + 0.05, ph + 0.35, z - 0.03], [x + lean * 0.7 - 0.04, ph + height * 0.25, z + 0.04], top]), 12, 0.075, 0.05, 9), bark);
  // A sprig card at p, facing up and away from the canopy centre c.
  const sprig = (pt, c, spread, sizeK = 1) => {
    const out = Math.atan2(pt.z - c[2], pt.x - c[0]) + (random() - 0.5) * spread;
    const up = 0.3 + random() * 0.6; // radians from vertical
    const dir = [Math.sin(up) * Math.cos(out), Math.cos(up), Math.sin(up) * Math.sin(out)];
    const size = (0.28 + random() * 0.12) * sizeK;
    b.add('foliage', foliageCard(size, 0.35 + random() * 0.3), {
      color: '#ffffff', tint: 0.8 + random() * 0.32, rough: 0.55, flag: SURF.LEAF, uv: { mode: 'keep' },
      at: [pt.x, pt.y, pt.z], rot: [Math.acos(dir[1]), Math.atan2(dir[0], dir[2]), random() * Math.PI * 2],
    });
  };
  // Five scaffold limbs, four twigs each, sprigs along the outer 90% of every
  // twig: a rounded, full canopy rather than tufts at the branch ends.
  const limbs = 5;
  const crown = [top[0], top[1] + 0.75, top[2]];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + random() * 0.7;
    const lr = 0.3 + random() * 0.3;
    const lend = [top[0] + Math.cos(a) * lr, top[1] + 0.4 + random() * 0.35, top[2] + Math.sin(a) * lr];
    const limb = curve([top, [(top[0] + lend[0]) / 2, (top[1] + lend[1]) / 2 + 0.05, (top[2] + lend[2]) / 2], lend]);
    b.add('wood', taperTube(limb, 6, 0.045, 0.022, 6), bark);
    for (let j = 0; j < 4; j++) {
      const a2 = a + (j - 1.5) * 0.55 + (random() - 0.5) * 0.4;
      const tr = 0.28 + random() * 0.32;
      const tend = [lend[0] + Math.cos(a2) * tr, lend[1] + 0.1 + random() * 0.45, lend[2] + Math.sin(a2) * tr];
      const twig = curve([lend, [(lend[0] + tend[0]) / 2, (lend[1] + tend[1]) / 2 + 0.06, (lend[2] + tend[2]) / 2], tend]);
      b.add('wood', taperTube(twig, 5, 0.018, 0.005, 5), bark);
      for (let k = 0; k < 14; k++) sprig(twig.getPoint(0.1 + 0.9 * Math.sqrt(random())), crown, 1.6);
    }
  }
  // Fill: sprigs on the canopy's shell between the twigs, so the crown reads
  // as one mass from across the room.
  for (let k = 0; k < 70; k++) {
    const az = random() * Math.PI * 2, el = Math.asin(random() * 1.6 - 0.6);
    const r = 0.6 + random() * 0.3;
    const pt = new Vector3(crown[0] + Math.cos(az) * Math.cos(el) * r, crown[1] + Math.sin(el) * r * 0.62, crown[2] + Math.sin(az) * Math.cos(el) * r);
    sprig(pt, crown, 1.2, 0.9);
  }
}

/** A multi-stem fiddle-leaf fig: tall stems, big glossy leaves up their length. */
function figTree(b, random, x, z, height, { stems = 4, leaves = 20, rows = 6, segs = 40, pr = 0.47, ph = 0.72 } = {}) {
  planter(b, x, z, pr, ph, segs);
  const bark = { color: '#7a6a58', rough: 0.85, uv: { mode: 'cyl', texScale: 0.4 } };
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + random() * 0.5;
    const spread = 0.12 + random() * 0.18;
    const h = height * (0.75 + random() * 0.3);
    const base = [x + Math.cos(a) * 0.08, ph - 0.06, z + Math.sin(a) * 0.08];
    const tip = [x + Math.cos(a) * spread * 2.4, ph + h, z + Math.sin(a) * spread * 2.4];
    const stem = curve([base, [x + Math.cos(a) * spread, ph + h * 0.45, z + Math.sin(a) * spread], tip]);
    b.add('wood', taperTube(stem, 10, 0.026, 0.01, 6), bark);
    const n = leaves;
    for (let k = 0; k < n; k++) {
      const t = 0.35 + (k / n) * 0.65;
      const p = stem.getPoint(t);
      const yaw = a + k * 2.4 + (random() - 0.5) * 0.5;
      const pitch = -0.35 - random() * 0.6 + t * 0.3; // younger leaves stand up
      const len = 0.24 + random() * 0.14 - (1 - t) * 0.04;
      b.add('small', leaf(len, len * 0.7, { fold: 0.1, curl: 0.16, shape: 1, rows }), {
        color: random() < 0.3 ? '#3b5a2c' : '#2c4724', tint: 0.85 + random() * 0.3, rough: 0.34, flag: SURF.LEAF,
        at: [p.x, p.y, p.z], rot: [pitch, yaw, (random() - 0.5) * 0.4],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Bar, boards, entrance
// ---------------------------------------------------------------------------
function bar(b, random, shadows, floorAO, practicals, blockers, dimensions = BAR) {
  const { x0, x1, front, back, top } = dimensions;
  const w = x1 - x0, cx = (x0 + x1) / 2;
  // The counter under its travertine top (overhang included), the stools, the back bar.
  blocker(blockers, 'bar', cx, (front + back) / 2 - 0.06, (w + 0.16) / 2, (back - front + 0.26) / 2);
  for (let i = 0; i < 5; i++) blocker(blockers, 'seat', cx - 2.4 + i * 1.2, front - 0.42, 0.205, null, 0, { round: true });
  blocker(blockers, 'counter', cx, BACK_Z - 0.28, (w + 0.26) / 2, 0.28);
  // Fluted smoked-oak front over a recessed bronze kick.
  b.add('wood', softBox({ w, h: top - 0.12, d: 0.08, r: 0.01, seg: 1, div: 6 }), { color: C.oakSmoked, rough: 0.5, flag: SURF.FLUTED, uv: { texScale: 1.4, grain: 'y' }, at: [cx, 0.12 + (top - 0.12) / 2, front + 0.04] });
  b.add('metal', softBox({ w: w - 0.04, h: 0.12, d: 0.06, r: 0.004, seg: 1, div: 2 }), { color: C.bronzeDark, rough: 0.45, metal: 1, at: [cx, 0.06, front + 0.1] });
  b.add('wood', softBox({ w, h: top, d: back - front - 0.08, r: 0.01, seg: 1, div: 2 }), { color: C.oakDark, rough: 0.6, at: [cx, top / 2, (front + back) / 2 + 0.04] });
  // Travertine top with a generous overhang.
  b.add('stone', slab(roundedRect(w + 0.16, back - front + 0.26, 0.04, 3), 0.055, { edge: 0.008 }), { color: C.travertine, rough: 0.32, uv: { mode: 'plan', texScale: 1.2 }, at: [cx, top, (front + back) / 2 - 0.06] });
  // Under-top glow washing down the fluting.
  b.add('emissive', softBox({ w: w - 0.1, h: 0.006, d: 0.012, r: 0.002, seg: 1, div: 1 }), { color: '#ffc27a', rough: GLOW.BAR, at: [cx, top - 0.004, front - 0.03] });
  practicals.push({ type: 'line', a: [x0 + 0.1, top - 0.03, front - 0.05], b: [x1 - 0.1, top - 0.03, front - 0.05], n: [0, -0.6, -0.8], color: [1, 0.7, 0.4], power: 0.55, range: 2.6, group: GLOW.BAR });
  // Foot rail.
  b.add('metal', cylinder(0.022, 0.022, w - 0.3, 18), { color: '#8a6a45', rough: 0.25, metal: 1, flag: SURF.LONG, at: [cx, 0.21, front - 0.17], rot: [0, 0, Math.PI / 2] });
  for (let xb = x0 + 0.4; xb <= x1 - 0.39; xb += 1.5) b.add('metal', softBox({ w: 0.02, h: 0.03, d: 0.2, r: 0.004, seg: 1, div: 1 }), { color: '#8a6a45', rough: 0.25, metal: 1, at: [xb, 0.21, front - 0.07] });
  shadows.push({ c: [cx, top / 2, (front + back) / 2], h: [w / 2 + 0.08, top / 2 + 0.03, (back - front) / 2 + 0.12], rot: 0, k: 1 });
  floorAO.push({ c: [cx, top / 2, (front + back) / 2 + 0.04], h: [w / 2, top / 2, (back - front) / 2 - 0.04], rot: 0, k: 1 });
  // Stools: bronze pedestal, foot ring, leather seat.
  for (let i = 0; i < 5; i++) {
    const sx = cx - 2.4 + i * 1.2, sz = front - 0.42;
    b.add('metal', lathe([[0, 0], [0.2, 0], [0.205, 0.006], [0.19, 0.016], [0.04, 0.026], [0, 0.026]], 28), { color: C.bronze, rough: 0.32, metal: 1, at: [sx, 0, sz] });
    b.add('metal', cylinder(0.024, 0.026, 0.7, 14), { color: C.bronze, rough: 0.32, metal: 1, at: [sx, 0.37, sz] });
    b.add('metal', torus(0.17, 0.011, 8, 32), { color: C.bronze, rough: 0.32, metal: 1, at: [sx, 0.3, sz], rot: [Math.PI / 2, 0, 0] });
    b.add('leather', lathe([[0, 0], [0.17, 0], [0.19, 0.012], [0.2, 0.04], [0.19, 0.068], [0.17, 0.075], [0, 0.078]], 32), { color: C.leather, rough: 0.48, uv: { mode: 'plan', texScale: 0.3 }, at: [sx, 0.715, sz] });
    floorAO.push({ c: [sx, 0.013, sz], h: [0.19, 0.013, 0.19], rot: 0, k: 1 });
  }
  // the stools' seats as one soft row
  shadows.push({ c: [cx, 0.75, front - 0.42], h: [2.6, 0.04, 0.2], rot: 0, k: 0.6 });
  // Bar pendants.
  for (const dx of [-2.2, 0, 2.2]) {
    const px = cx + dx, py = 2.45, pz = (front + back) / 2 - 0.05;
    b.add('metal', lathe([[0, 0.24], [0.04, 0.24], [0.05, 0.2], [0.17, 0.02], [0.175, 0.0], [0.165, 0.0], [0.04, 0.19], [0, 0.2]], 32), { color: '#8a6a45', rough: 0.28, metal: 1, at: [px, py, pz] });
    b.add('emissive', lathe([[0, 0.05], [0.12, 0.006], [0.155, 0.002]], 28), { color: '#ffd9a8', rough: GLOW.PENDANT, at: [px, py, pz] });
    b.add('metal', cylinder(0.0035, 0.0035, DECK_Y - (py + 0.24), 6), { color: C.blackMetal, rough: 0.5, metal: 1, at: [px, (DECK_Y + py + 0.24) / 2, pz] });
    practicals.push({ type: 'spot', p: [px, py - 0.02, pz], d: [0, -1, 0], color: [1, 0.72, 0.45], power: 1.8, range: 5.5, cone: [0.55, 1.2], group: GLOW.PENDANT });
  }
  // Back bar: oak cabinet, travertine top, backlit onyx panel, glass shelves
  // and bottles.
  const bz = BACK_Z;
  b.add('wood', softBox({ w: w + 0.2, h: 0.9, d: 0.5, r: 0.008, seg: 1, div: 4 }), { color: C.oakSmoked, rough: 0.5, flag: SURF.FLUTED, uv: { texScale: 1.4, grain: 'y' }, at: [cx, 0.45, bz - 0.25] });
  b.add('stone', softBox({ w: w + 0.26, h: 0.04, d: 0.56, r: 0.006, seg: 1, div: 4 }), { color: C.travertine, rough: 0.32, uv: { texScale: 1.2, grain: 'x' }, at: [cx, 0.92, bz - 0.27] });
  floorAO.push({ c: [cx, 0.45, bz - 0.25], h: [w / 2 + 0.1, 0.45, 0.25], rot: 0, k: 1 });
  const panelW = w - 0.6, py0 = 1.12, py1 = 3.6;
  // (held below white: amber onyx keeps its colour through the tone curve,
  // and its reflection in the night glass stays a glow, not a billboard)
  b.add('emissive', softBox({ w: panelW, h: py1 - py0, d: 0.02, r: 0.004, seg: 1, div: 6 }), { color: '#ffa65a', tint: 0.8, rough: GLOW.BAR, flag: 1, at: [cx, (py0 + py1) / 2, bz - 0.02] });
  b.add('metal', softBox({ w: panelW + 0.12, h: 0.05, d: 0.32, r: 0.006, seg: 1, div: 2 }), { color: C.bronzeDark, rough: 0.4, metal: 1, at: [cx, py1 + 0.025, bz - 0.16] });
  for (const s of [-1, 1]) b.add('metal', softBox({ w: 0.05, h: py1 - py0 + 0.05, d: 0.32, r: 0.006, seg: 1, div: 1 }), { color: C.bronzeDark, rough: 0.4, metal: 1, at: [cx + s * (panelW / 2 + 0.035), (py0 + py1) / 2, bz - 0.16] });
  practicals.push({ type: 'spot', p: [cx - 1.6, 2.4, bz - 0.4], d: [0, -0.15, -1], color: [1, 0.66, 0.36], power: 0.7, range: 6, cone: [-0.2, 0.6], group: GLOW.BAR });
  practicals.push({ type: 'spot', p: [cx + 1.6, 2.4, bz - 0.4], d: [0, -0.15, -1], color: [1, 0.66, 0.36], power: 0.7, range: 6, cone: [-0.2, 0.6], group: GLOW.BAR });
  const shelves = [1.62, 2.22, 2.82];
  const bottleColors = ['#4a6b3a', '#7b4a1d', '#c9c6b4', '#3d2a1a', '#8c6a2a', '#5a2a2e', '#2f4b52', '#b8935a'];
  for (const sy of shelves) {
    b.add('small', softBox({ w: panelW - 0.02, h: 0.014, d: 0.26, r: 0.003, seg: 1, div: 2 }), { color: '#cfd6d4', rough: 0.08, flag: SURF.BACKLIT, at: [cx, sy, bz - 0.15] });
    let px = cx - panelW / 2 + 0.12;
    while (px < cx + panelW / 2 - 0.12) {
      const kind = random();
      const h = 0.2 + random() * 0.14, r = 0.03 + random() * 0.02;
      const prof = kind < 0.45
        ? [[0, 0], [r, 0], [r, h * 0.62], [r * 0.45, h * 0.78], [r * 0.3, h * 0.95], [r * 0.32, h], [0, h]]
        : kind < 0.8
          ? [[0, 0], [r * 1.1, 0], [r * 1.15, h * 0.5], [r * 0.9, h * 0.7], [r * 0.3, h * 0.82], [r * 0.3, h], [0, h]]
          : [[0, 0], [r * 1.3, 0], [r * 1.3, h * 0.55], [r * 0.4, h * 0.7], [r * 0.35, h * 0.86], [0, h * 0.86]];
      const col = bottleColors[Math.floor(random() * bottleColors.length)];
      b.add('small', lathe(prof, 10), { color: col, rough: 0.08, flag: SURF.BACKLIT, at: [px, sy + 0.007, bz - 0.17 + (random() - 0.5) * 0.06] });
      // bottles stand in loose groups with gaps between them
      px += r * 2.3 + 0.015 + (random() < 0.3 ? 0.18 + random() * 0.2 : random() * 0.04);
    }
  }
  // two tumblers on the counter
  b.add('small', lathe([[0, 0], [0.034, 0], [0.037, 0.004], [0.039, 0.095], [0.0, 0.093]], 20), { color: '#d9e2e2', rough: 0.06, flag: SURF.BACKLIT, at: [cx - 1.1, top + 0.055, front + 0.18] });
  b.add('small', lathe([[0, 0], [0.034, 0], [0.037, 0.004], [0.039, 0.095], [0.0, 0.093]], 20), { color: '#d9e2e2', rough: 0.06, flag: SURF.BACKLIT, at: [cx + 0.9, top + 0.055, front + 0.12] });
}

function boards(b, practicals, blockers) {
  // Bronze bezels; the screens themselves are the board mesh (lounge-board.js).
  for (const bd of BOARDS) {
    const { x, w, y0, h } = bd;
    const z = BOARD_Z;
    const frameW = 0.06;
    blocker(blockers, 'wall', x, z + 0.025, w / 2 + frameW, 0.045); // the bezel stands 9 cm off the wall
    for (const [px, py, sx, sy] of [[x, y0 - frameW / 2, w + frameW * 2, frameW], [x, y0 + h + frameW / 2, w + frameW * 2, frameW], [x - w / 2 - frameW / 2, y0 + h / 2, frameW, h], [x + w / 2 + frameW / 2, y0 + h / 2, frameW, h]]) {
      b.add('metal', softBox({ w: sx, h: sy, d: 0.09, r: 0.008, seg: 1, div: 1 }), { color: C.blackMetal, rough: 0.35, metal: 1, at: [px, py, z + 0.025] });
    }
    b.add('metal', softBox({ w: w, h: h, d: 0.06, r: 0.004, seg: 1, div: 1 }), { color: '#0b0c0e', rough: 0.6, metal: 0.4, at: [x, y0 + h / 2, z + 0.04] });
    // The screen's spill onto the floor and ceiling in front of it.
    practicals.push({ type: 'spot', p: [x, y0 + h / 2, z - 0.3], d: [0, -0.1, -1], color: [0.72, 0.8, 1], power: 0.42, range: 7, cone: [-0.3, 0.5], group: GLOW.ALWAYS });
  }
}

function entrance(b, practicals, blockers) {
  const { z0, z1, h, depth } = ENTRANCE;
  const x = HALF_X, zc = (z0 + z1) / 2, wz = z1 - z0;
  // The vestibule's returns (strips just inside its floor; the plaster stands
  // just outside) and its frosted doors (the concourse is not part of the room).
  blocker(blockers, 'wall', x + depth / 2, z0 + 0.03, depth / 2, 0.03);
  blocker(blockers, 'wall', x + depth / 2, z1 - 0.03, depth / 2, 0.03);
  blocker(blockers, 'door', x + depth - 0.05, zc, 0.05, wz / 2);
  // Vestibule: plaster returns, a lit ceiling, frosted glass doors glowing at
  // the far end (the concourse beyond).
  for (const zz of [z0, z1]) b.add('plaster', softBox({ w: depth, h, d: 0.06, r: 0.004, seg: 1, div: 2 }), { color: C.plaster, rough: 0.9, at: [x + depth / 2, h / 2, zz + (zz === z0 ? -0.03 : 0.03)] });
  b.add('plaster', softBox({ w: depth, h: 0.06, d: wz, r: 0.004, seg: 1, div: 2 }), { color: C.plaster, rough: 0.9, at: [x + depth / 2, h + 0.03, zc] });
  b.add('stone', softBox({ w: depth, h: 0.02, d: wz, r: 0.002, seg: 1, div: 2 }), { color: C.travertine, rough: 0.4, uv: { mode: 'plan', texScale: 1.2 }, at: [x + depth / 2, -0.01, zc] });
  b.add('emissive', softBox({ w: 0.02, h: h - 0.12, d: wz - 0.1, r: 0.004, seg: 1, div: 2 }), { color: '#fff1dc', rough: GLOW.ENTRANCE, flag: 2, at: [x + depth - 0.02, h / 2, zc] });
  for (const zz of [z0 + 0.05, zc, z1 - 0.05]) b.add('metal', softBox({ w: 0.05, h: h - 0.1, d: 0.05, r: 0.004, seg: 1, div: 1 }), { color: C.blackMetal, rough: 0.4, metal: 1, at: [x + depth - 0.05, h / 2, zz] });
  b.add('metal', softBox({ w: 0.08, h: 0.08, d: wz + 0.1, r: 0.006, seg: 1, div: 1 }), { color: C.bronze, rough: 0.35, metal: 1, at: [x - 0.03, h + 0.04, zc] });
  practicals.push({ type: 'spot', p: [x + depth - 0.3, h - 0.3, zc], d: [-1, -0.25, 0], color: [1, 0.86, 0.68], power: 1.1, range: 7, cone: [-0.2, 0.6], group: GLOW.ENTRANCE });
}

// ---------------------------------------------------------------------------
// Ceiling and shell
// ---------------------------------------------------------------------------
function ceiling(b, practicals, plan) {
  const { pitch, width, depth, z0, z1 } = BAFFLE;
  const len = z1 - z0, zc = (z0 + z1) / 2;
  // A baffle profile (x across, y down from the deck) with eased lower
  // corners, extruded along +Z: 28 triangles instead of a rounded box's 108.
  const hw = width / 2, e = 0.008;
  const baffleGeo = prism([[-hw, 0], [-hw, -depth + e], [-hw + e, -depth], [hw - e, -depth], [hw, -depth + e], [hw, 0]], len, { smoothDeg: 50 });
  // Oak baffles over the solid ceiling, running toward the window; the three
  // light slots replace a baffle.
  for (let x = -HALF_X + 0.15; x <= HALF_X - 0.15 + 1e-6; x += pitch) {
    if (SLOT_X.some((sx) => Math.abs(x - sx) < pitch * 0.5)) continue;
    if (plan.upper && x < plan.upper.well.x1) continue;
    b.add('wood', baffleGeo.clone(), { color: C.oak, rough: 0.55, flag: SURF.BAFFLE, uv: { texScale: 1.6, grain: 'z' }, at: [x, DECK_Y - 0.02, z0] });
  }
  baffleGeo.dispose();
  for (const sx of SLOT_X) {
    b.add('metal', softBox({ w: 0.16, h: 0.05, d: len, r: 0.004, seg: 1, div: 1 }), { color: C.blackMetal, rough: 0.5, metal: 0.6, flag: SURF.LONG, at: [sx, DECK_Y - 0.045, zc] });
    b.add('emissive', softBox({ w: 0.05, h: 0.004, d: len - 0.1, r: 0.001, seg: 1, div: 1 }), { color: '#ffe2bd', rough: GLOW.SLOT, at: [sx, DECK_Y - 0.073, zc] });
    practicals.push({ type: 'line', a: [sx, DECK_Y - 0.08, z0 + 0.4], b: [sx, DECK_Y - 0.08, z1 - 0.4], n: [0, -1, 0], color: [1, 0.8, 0.6], power: 0.28, range: 5.5, group: GLOW.SLOT });
  }
  // Downlights between baffles over the window seats' back row and lounge.
  for (const [dx, dz] of [[-2.25, 3.4], [2.25, 3.4], [-6.75, 3.4], [6.75, 3.4], [-8.9, 9], [8.9, 9]]) {
    if (plan.upper && dx < plan.upper.well.x1) continue;
    b.add('emissive', cylinder(0.035, 0.035, 0.004, 16), { color: '#fff0d8', rough: GLOW.LAMP, at: [dx, DECK_Y - 0.03, dz] });
    practicals.push({ type: 'spot', p: [dx, DECK_Y - 0.05, dz], d: dz < 4 ? [0, -0.88, -0.48] : [0, -1, 0], color: [1, 0.8, 0.58], power: 2.6, range: 7, cone: [0.82, 0.96], group: GLOW.LAMP });
  }
  // Cove along the fascia's top-back, washing the deck behind it.
  b.add('emissive', softBox({ w: HALF_X * 2 - 0.2, h: 0.006, d: 0.02, r: 0.002, seg: 1, div: 1 }), { color: '#ffd7a8', rough: GLOW.COVE, at: [0, DECK_Y - 0.1, ROOF_Z1 + FASCIA_DEPTH + 0.02] });
  practicals.push({ type: 'line', a: [-HALF_X + 0.3, DECK_Y - 0.12, ROOF_Z1 + FASCIA_DEPTH + 0.05], b: [HALF_X - 0.3, DECK_Y - 0.12, ROOF_Z1 + FASCIA_DEPTH + 0.05], n: [0, 0.6, 0.8], color: [1, 0.76, 0.5], power: 0.5, range: 4, group: GLOW.COVE });
  // The dark deck the baffles hang from.
  if (!plan.upper) {
  b.add('plaster', softBox({ w: HALF_X * 2 + 0.4, h: 0.06, d: BACK_Z - ROOF_Z1 + 0.2, r: 0.004, seg: 1, div: 1 }), { color: C.deck, rough: 0.92, flag: SURF.DECK, at: [0, DECK_Y + 0.03, (ROOF_Z1 + BACK_Z) / 2] });
  } else {
    const u = plan.upper;
    const plate = (x0, x1, a, z, y, h) => b.add('plaster', softBox({ w: x1 - x0, h, d: z - a, r: 0.004, seg: 1, div: 1 }), { color: C.deck, rough: 0.92, flag: SURF.DECK, at: [(x0 + x1) / 2, y, (a + z) / 2] });
    plate(u.well.x1, HALF_X + 0.2, ROOF_Z1, u.plate.z0, DECK_Y + 0.03, 0.06);
    plate(-HALF_X - 0.2, u.well.x1, ROOF_Z1, u.well.z0, DECK_Y + 0.03, 0.06);
    // The timber finish occupies the upper 36 mm of the composite deck.
    // Keep the underside and finished walking height, without a second
    // coplanar exposed top fighting the timber while the camera moves.
    const structureH = u.slabM - 0.036, structureY = u.floorY - u.slabM + structureH / 2;
    plate(u.well.x1, HALF_X + 0.2, u.plate.z0, BACK_Z + 0.1, structureY, structureH);
    plate(-HALF_X - 0.2, u.well.x1, u.well.z1, BACK_Z + 0.1, structureY, structureH);
  }
}

function shell(b, floorAO, blockers, plan) {
  wallBlockers(blockers, plan);
  // Floor: honed travertine in a running bond (the joints are drawn by the
  // shader from room-local position, so the texture never repeats).
  const fz0 = frontZ(0) + 0.37; // just behind the grille
  b.add('stone', softBox({ w: HALF_X * 2, h: 0.1, d: BACK_Z - fz0, r: 0.002, seg: 1, div: 1 }), { color: C.travertine, rough: 0.34, flag: SURF.TILES, uv: { mode: 'plan', texScale: 1.2 }, at: [0, -0.05, (fz0 + BACK_Z) / 2] });
  b.add('stone', softBox({ w: HALF_X * 2, h: 0.1, d: 0.14, r: 0.002, seg: 1, div: 2 }), { color: C.travertineDark, rough: 0.4, uv: { mode: 'plan', texScale: 1.2 }, at: [0, -0.05, frontZ(0) + 0.05] });
  // Side walls (solid part), back wall: warm limewash over a smoked-oak
  // fluted dado; a dark shadow-gap skirting.
  for (const s of [-1, 1]) {
    const len = BACK_Z - SIDE_Z1;
    const x = s * (HALF_X + 0.05);
    if (s > 0) {
      // the right wall is split by the entrance opening
      const { z0, z1, h } = ENTRANCE;
      const parts = [[SIDE_Z1, z0], [z1, BACK_Z]];
      for (const [a, c] of parts) wallStrip(b, x, s, a, c, 0, HEAD_Y);
      wallStrip(b, x, s, z0, z1, h, HEAD_Y);
    } else wallStrip(b, x, s, SIDE_Z1, BACK_Z, 0, HEAD_Y, 3.3, C.oak);
    floorAO.push({ c: [s * (HALF_X + 0.2), 2.3, (SIDE_Z1 + BACK_Z) / 2], h: [0.2, 2.3, len / 2], rot: 0, k: 1 });
  }
  // Back wall: smoked fluted oak, full height, behind the bar and boards.
  if (!plan.backGlass) {
  b.add('wood', softBox({ w: HALF_X * 2, h: HEAD_Y, d: 0.1, r: 0.004, seg: 1, div: 1 }), { color: C.oakSmoked, rough: 0.55, flag: SURF.FLUTED_FINE, uv: { texScale: 1.4, grain: 'y' }, at: [0, HEAD_Y / 2, BACK_Z + 0.05] });
  floorAO.push({ c: [0, 2.3, BACK_Z + 0.2], h: [HALF_X, 2.3, 0.2], rot: 0, k: 1 });
  } else {
    const g = plan.backGlass;
    for (const sign of [-1, 1]) {
      const width = HALF_X - g.halfWidth;
      const x = sign * (g.halfWidth + width / 2);
      b.add('wood', softBox({ w: width, h: HEAD_Y, d: 0.1, r: 0.004, seg: 1, div: 1 }), { color: C.oakSmoked, rough: 0.55, flag: SURF.FLUTED_FINE, uv: { texScale: 1.4, grain: 'y' }, at: [x, HEAD_Y / 2, BACK_Z + 0.05] });
      floorAO.push({ c: [x, HEAD_Y / 2, BACK_Z + 0.2], h: [width / 2, HEAD_Y / 2, 0.2], rot: 0, k: 1 });
    }
  }
  // Front kick under the glazing (seen from inside as the sill's riser).
  floorAO.push({ c: [0, 0.07, frontZ(0) - 0.05], h: [HALF_X, 0.07, 0.06], rot: 0, k: 1 });
}

/**
 * The room's edges as walk blockers, each just inside the floor plate
 * (room-plan.js FLOOR_PLATE): the curtain wall's shoe and fins at the sill,
 * the side glazing's shoe, fin and end post, the solid side walls (the right
 * one open at the entrance) and the back wall. The side walls' inner faces
 * sit 7.5 cm inside the plaster, so the canvas and the sconces fall inside
 * them too; the back wall's sit 6 cm inside (the boards have their own).
 */
function wallBlockers(blockers, plan) {
  const z0 = frontZ(SILL_Y);
  const finZ = z0 + MULLION_DEPTH + 0.02; // the fins' inner edge at the sill, and the shoe
  blocker(blockers, 'wall', 0, (z0 + finZ) / 2, HALF_X, (finZ - z0) / 2);
  for (const s of [-1, 1]) {
    blocker(blockers, 'wall', s * (HALF_X - 0.05), (z0 + SIDE_Z1) / 2, 0.05, (SIDE_Z1 - z0) / 2); // side glazing shoe
    for (const zm of SIDE_MULLION_Z) blocker(blockers, 'wall', s * (HALF_X - MULLION_DEPTH / 2), zm, MULLION_DEPTH / 2, MULLION_HALF);
    blocker(blockers, 'wall', s * (HALF_X - 0.12), SIDE_Z1 + 0.05, 0.12, 0.13); // the end post where the solid wall begins (its last 2 cm are in the wall)
  }
  const wall = (x, za, zb) => blocker(blockers, 'wall', x, (za + zb) / 2, 0.0375, (zb - za) / 2);
  wall(-HALF_X + 0.0375, SIDE_Z1, BACK_Z);
  wall(HALF_X - 0.0375, SIDE_Z1, ENTRANCE.z0);
  wall(HALF_X - 0.0375, ENTRANCE.z1, BACK_Z);
  const backDepth = plan?.backGlass ? plan.backGlass.finDepth + 0.02 : 0.06;
  blocker(blockers, 'wall', 0, BACK_Z - backDepth / 2, HALF_X, backDepth / 2);
}

/** A wall run between z0 and z1 (plaster above a fluted smoked-oak dado). */
function wallStrip(b, x, s, z0, z1, y0, y1, dado = 1.05, dadoColor = C.oakSmoked) {
  const len = z1 - z0, zc = (z0 + z1) / 2;
  if (y0 < dado) {
    b.add('wood', softBox({ w: 0.1, h: dado - y0, d: len, r: 0.004, seg: 1, div: 1 }), { color: dadoColor, rough: 0.55, flag: SURF.FLUTED, uv: { texScale: 1.4, grain: 'y' }, at: [x, y0 + (dado - y0) / 2, zc] });
    b.add('metal', softBox({ w: 0.02, h: 0.02, d: len, r: 0.003, seg: 1, div: 1 }), { color: '#2a2420', rough: 0.4, metal: 1, flag: SURF.LONG, at: [x - s * 0.055, dado, zc] });
  }
  const p0 = Math.max(y0, dado);
  b.add('plaster', softBox({ w: 0.1, h: y1 - p0, d: len, r: 0.004, seg: 1, div: 1 }), { color: C.plaster, rough: 0.9, uv: { texScale: 2, grain: 'z' }, at: [x, p0 + (y1 - p0) / 2, zc] });
}

/** Rear curtain wall between the boards: identical bronze language, no extra draw. */
function backGlazingFrame(b, g) {
  const metal = { color: C.frameDark, rough: 0.34, metal: 1, flag: SURF.LONG };
  for (const x of [-g.halfWidth, ...g.mullionX, g.halfWidth]) {
    b.add('metal', softBox({ w: MULLION_HALF * 2, h: g.topY - g.baseY, d: g.finDepth, r: 0.003, seg: 1, div: 1 }), { ...metal, at: [x, (g.baseY + g.topY) / 2, g.z - g.finDepth / 2] });
  }
  for (const [y, h] of [[g.baseY / 2, g.baseY], [(g.topY + HEAD_Y) / 2, HEAD_Y - g.topY]]) {
    b.add('metal', softBox({ w: g.halfWidth * 2, h, d: 0.22, r: 0.004, seg: 1, div: 1 }), { ...metal, at: [0, y, g.z - 0.11] });
  }
}

/** Reuse the authored bar with one rigid transform; geometry, collision,
 * occlusion and analytical fixtures move together. */
function pierBar(b, random, shadows, floorAO, practicals, blockers, spec) {
  const rot = Math.PI / 2, zc = (spec.z0 + spec.z1) / 2;
  const front = BAR.front, dx = spec.counterX - front;
  const transform = frame([dx, 0, zc], rot);
  const wrapped = { add: (bucket, geometry, opts = {}) => b.add(bucket, geometry, { ...opts, matrix: opts.matrix ? transform.clone().multiply(opts.matrix) : transform }) };
  const ss = [], aa = [], pp = [], bb = [];
  bar(wrapped, random, ss, aa, pp, bb, { ...BAR, x0: -(spec.z1 - spec.z0) / 2, x1: (spec.z1 - spec.z0) / 2 });
  const point = (p) => [dx + p[2], p[1], zc - p[0]];
  const dir = (p) => [p[2], p[1], -p[0]];
  for (const [src, dst] of [[ss, shadows], [aa, floorAO]]) for (const box of src) dst.push({ ...box, c: point(box.c), rot: box.rot + rot });
  for (const light of pp) {
    const next = { ...light };
    for (const key of ['p', 'a', 'b']) if (light[key]) next[key] = point(light[key]);
    for (const key of ['d', 'n']) if (light[key]) next[key] = dir(light[key]);
    practicals.push(next);
  }
  for (const block of bb) blocker(blockers, block.kind, dx + block.c[1], zc - block.c[0], block.h[0], block.h[1], block.rot + rot, block.round ? { round: true } : null);
}


/** Upper observation room: all parts share the existing material batches. */
function upperRoom(b, shadows, floorAO, practicals, blockers, plan, dressing, steamSources) {
  const u = plan.upper, st = u.stair, well = u.well, g = u.glazing;
  // Second-level pass parts carry their own texture offsets (dressAdd), so
  // the builder's shared offset sequence — and with it every texture phase in
  // the shell built after this room — is the same as before they existed.
  const dress = rng(2026);
  const dressAdd = { add: (bucket, geometry, opts = {}) => b.add(bucket, geometry, { ...opts, uv: { mode: 'box', texScale: 1, ...opts.uv, offset: Array.isArray(opts.uv?.offset) ? opts.uv.offset : [dress() * 7.31, dress() * 5.17] } }) };
  const bronze = { color: C.bronzeDark, rough: 0.33, metal: 1, flag: SURF.LONG };
  const oak = { color: C.oak, rough: 0.5, flag: SURF.LONG, uv: { texScale: 1.1, grain: 'z' } };
  const box = (bucket, at, w, h, d, material, rot) => b.add(bucket, softBox({ w, h, d, r: Math.min(0.012, w / 5, h / 5, d / 5), seg: 1, div: 1 }), { ...material, at, ...(rot ? { rot } : {}) });
  const floor = (x0, x1, z0, z1) => box('wood', [(x0 + x1) / 2, u.floorY - 0.018, (z0 + z1) / 2], x1 - x0, 0.036, z1 - z0, { color: '#b4885e', rough: 0.52, flag: SURF.UPPER_FLOOR, uv: { mode: 'plan', texScale: 1.3 } });
  floor(well.x1, u.plate.x1, u.plate.z0, u.plate.z1);
  floor(u.plate.x0, well.x1, well.z1, u.plate.z1);
  const upperBlock = (kind, x, z, hx, hz, rot = 0, more = {}) => blocker(blockers, kind, x, z, hx, hz, rot, { floorId: 'upper', y0: u.floorY, y1: u.roofY, ...more });

  // Closed stair plinth. Actual oak nosings and travertine risers remain crisp
  // close up; the controller walks a continuous rise over these 28 treads.
  const width = st.x1 - st.x0, tread = (st.z1 - st.z0) / st.steps, rise = st.rise / st.steps, cx = (st.x0 + st.x1) / 2;
  for (let i = 0; i < st.steps; i++) {
    const top = (i + 1) * rise, z = st.z0 + (i + 0.5) * tread;
    // Oak defines the finished riser height; the stone ends below its
    // 26 mm tread instead of exposing a competing face at the same height.
    const structureTop = top - 0.026;
    box('stone', [cx, structureTop / 2, z], width, structureTop, tread + 0.003, { color: C.travertineDark, rough: 0.55, uv: { texScale: 1.2, grain: 'y' } });
    box('wood', [cx, top - 0.013, z - 0.009], width + 0.025, 0.026, tread + 0.022, oak);
    // A small warm marker every fourth riser belongs to safe circulation,
    // not the decorative Night Watch channel.
    if (i % 4 === 1) box('emissive', [st.x1 - 0.2, top - rise * 0.55, z - tread / 2 - 0.003], 0.2, 0.012, 0.004, { color: '#e9bc80', tint: 0.4, rough: GLOW.ENTRANCE });
  }
  // The lower walk blocker reaches past the east stringer to the balusters
  // fixed to its face (x1 + 0.085), so a walker never brushes them.
  blocker(blockers, 'stair-plinth', cx + 0.035, (st.z0 + st.z1) / 2, width / 2 + 0.05, (st.z1 - st.z0) / 2 + 0.025, 0, { floorId: 'lower', y0: 0, y1: u.floorY });
  stairFinish(dressAdd, st, u);
  floorAO.push({ c: [cx, u.floorY / 4, (st.z0 + st.z1) / 2], h: [width / 2, u.floorY / 4, (st.z1 - st.z0) / 2], rot: 0, k: 1 });
  // Metal balusters and rounded timber handrails; side rails stay outside
  // the 1.9 m clear stair width and continue safely onto the landing.
  const slope = Math.atan2(st.rise, st.z1 - st.z0), length = Math.hypot(st.rise, st.z1 - st.z0);
  for (const x of [st.x0 - 0.07, st.x1 + 0.07]) {
    for (let i = 0; i <= st.steps; i += 2) {
      const y = st.rise * i / st.steps, z = st.z0 + (st.z1 - st.z0) * i / st.steps;
      box('metal', [x, y + u.guardM / 2, z], 0.026, u.guardM, 0.026, bronze);
    }
    box('wood', [x, st.rise / 2 + u.guardM, (st.z0 + st.z1) / 2], 0.058, 0.055, length + 0.35, oak, [-slope, 0, 0]);
    blocker(blockers, 'rail', x, (st.z0 + st.z1) / 2, 0.04, (st.z1 - st.z0) / 2 + 0.2, 0, { floorId: 'stairs', y0: 0, y1: u.floorY + u.guardM });
  }
  // Upper edge of the stair void. The east opening at the top landing is
  // deliberately clear; every approach to the stair remains on real floor.
  const guard = (x, z0, z1) => {
    for (let z = z0; z <= z1 + 0.001; z += 0.45) box('metal', [x, u.floorY + u.guardM / 2, z], 0.028, u.guardM, 0.028, bronze);
    box('wood', [x, u.floorY + u.guardM, (z0 + z1) / 2], 0.065, 0.06, z1 - z0, oak);
    upperBlock('rail', x, (z0 + z1) / 2, 0.045, (z1 - z0) / 2, 0, { y1: u.floorY + u.guardM });
  };
  guard(well.x1 + 0.035, u.plate.z0, st.z1 - 0.05);

  // The upper roof wraps the stairwell. Its oak-lined underside and two
  // shallow light slots keep this room intimate without blocking the view.
  const roof = (x0, x1, z0, z1) => {
    box('plaster', [(x0 + x1) / 2, u.roofY + 0.065, (z0 + z1) / 2], x1 - x0, 0.13, z1 - z0, { color: C.deck, rough: 0.9 });
    box('wood', [(x0 + x1) / 2, u.roofY - 0.025, (z0 + z1) / 2], x1 - x0 - 0.04, 0.05, z1 - z0 - 0.04, { color: '#9a704e', rough: 0.6, flag: SURF.PLANKS, uv: { mode: 'plan', texScale: 1.2 } });
  };
  roof(-HALF_X - 0.1, HALF_X + 0.1, u.plate.z0 - 0.1, BACK_Z + 0.1);
  roof(-HALF_X - 0.1, well.x1 + 0.1, well.z0, u.plate.z0 - 0.1);
  // West stairwell is warm reeded oak; a solid return closes its front.
  box('wood', [-HALF_X - 0.045, (u.floorY + u.roofY) / 2, (well.z0 + BACK_Z) / 2], 0.09, u.roofY - u.floorY, BACK_Z - well.z0, { color: C.oak, rough: 0.6, flag: SURF.FLUTED_FINE, uv: { texScale: 1.4, grain: 'y' } });
  box('wood', [(-HALF_X + well.x1) / 2, (u.floorY + u.roofY) / 2, well.z0], well.x1 + HALF_X, u.roofY - u.floorY, 0.12, { color: C.oakSmoked, rough: 0.55, flag: SURF.FLUTED_FINE });
  // Side return above the lower roof, forming the enclosed stairwell. It
  // stops at the room's front glazing, leaving the upper landing open.
  box('wood', [well.x1, (u.floorY + u.roofY) / 2, (well.z0 + u.plate.z0) / 2], 0.1, u.roofY - u.floorY, u.plate.z0 - well.z0, { color: C.oakSmoked, rough: 0.6, flag: SURF.FLUTED_FINE });
  // Its outer face stands outside the glazing: an exterior skin 25 mm proud
  // of the oak (whose own face stays an interior surface inside it).
  dressAdd.add('plaster', block(0.04, u.roofY - 0.01 - (DECK_Y + 0.07), g.frontZ - 0.08 - well.z0), { color: '#a49c90', rough: 0.86, flag: SURF.EXTERIOR, uv: { texScale: 2, grain: 'y' }, at: [well.x1 + 0.055, (u.roofY - 0.01 + DECK_Y + 0.07) / 2, (well.z0 + g.frontZ - 0.08) / 2] });

  // Glazed front, back and east side. Seals are modelled inside each bronze
  // channel and the broad reveals are eased, not single sharp-edged planes.
  const frameWall = (z, x0, x1) => {
    const span = x1 - x0, x = (x0 + x1) / 2;
    box('metal', [x, u.floorY + 0.07, z], span, 0.14, g.finDepth, bronze);
    box('metal', [x, u.roofY - 0.08, z], span, 0.16, g.finDepth, bronze);
    box('small', [x, g.y0 + 0.012, z], span - 0.04, 0.018, 0.035, { color: '#202324', rough: 0.78 });
    box('small', [x, g.y1 - 0.009, z], span - 0.04, 0.016, 0.035, { color: '#202324', rough: 0.78 });
    const xs = [x0 + 0.06, x1 - 0.06, ...MULLION_X.filter((px) => px > x0 + 0.2 && px < x1 - 0.2)];
    for (const px of xs) {
      box('metal', [px, (g.y0 + g.y1) / 2, z], 0.07, g.y1 - g.y0, g.finDepth, bronze);
      box('small', [px + 0.042, (g.y0 + g.y1) / 2, z], 0.009, g.y1 - g.y0, 0.04, { color: '#202324', rough: 0.78 });
    }
    upperBlock('wall', x, z, span / 2, 0.1);
  };
  frameWall(g.frontZ, g.frontX0, g.frontX1);
  frameWall(g.backZ, -g.halfWidth, g.halfWidth);
  for (const y of [u.floorY + 0.07, u.roofY - 0.08]) box('metal', [HALF_X, y, (g.frontZ + g.backZ) / 2], g.finDepth, y < u.floorY + 1 ? 0.14 : 0.16, g.backZ - g.frontZ, bronze);
  for (let z = g.frontZ; z <= g.backZ + 0.01; z += (g.backZ - g.frontZ) / 3) box('metal', [HALF_X, (g.y0 + g.y1) / 2, z], g.finDepth, g.y1 - g.y0, 0.07, bronze);
  upperBlock('wall', HALF_X - 0.04, (g.frontZ + g.backZ) / 2, 0.06, (g.backZ - g.frontZ) / 2);
  upperBlock('wall', -HALF_X + 0.04, (st.z1 + BACK_Z) / 2, 0.06, (BACK_Z - st.z1) / 2);

  // Two proper observation chairs with the same upholstered seams and oak
  // shell as downstairs, reused from the cleared lower seating group.
  const translate = frame([0, u.floorY, 0], 0);
  const raised = { add: (bucket, geometry, opts = {}) => b.add(bucket, geometry, { ...opts, matrix: opts.matrix ? translate.clone().multiply(opts.matrix) : translate }) };
  for (const seat of plan.vantage.filter((v) => v.id === 'upper-front' || v.id === 'upper-back')) {
    const c = seat.chair;
    loungeChair(b, frame([c.x, u.floorY, c.z], c.rot), { leather: false, color: '#c3b398' });
    upperBlock('seat', c.x + 0.037 * Math.sin(c.rot), c.z + 0.037 * Math.cos(c.rot), 0.43, 0.46, c.rot, { seatId: seat.id, y1: u.floorY + 1.05 });
    const aa = [];
    shadowChair([], aa, c.x, c.z, c.rot);
    for (const item of aa) floorAO.push({ ...item, c: [item.c[0], item.c[1] + u.floorY, item.c[2]] });
    // Two sun-shadow boxes, not shadowChair's three: the merged seat-and-arms
    // box casts the same footprint, and the freed fixture rows serve the
    // second level's dressing (MAX_SHADOWS is fixed).
    shadowChairPair(shadows, c.x, u.floorY, c.z, c.rot);
    const tx = c.x + 0.78, tz = c.z + (c.rot ? 0.12 : -0.12);
    sideTable(raised, [tx, 0, tz], 0.57, 0.3);
    upperBlock('table', tx, tz, 0.3, 0.3, 0, { round: true, y1: u.floorY + 0.6 });
    // Upstairs the lamps are the room's warm pools after dark (LIGHT lane).
    tableLamp(b, practicals, tx, u.floorY + 0.57, tz, 0.3, 0.7);
  }
  rug(raised, [0, 10.95], 7.9, 4.25, '#8b8071', '#5d574f');
  // A restrained low credenza supplies texture and scale without filling the
  // room with duplicate chairs or putting furniture in its circulation.
  box('wood', [8.9, u.floorY + 0.37, 10.95], 1.0, 0.74, 2.6, { color: C.oakSmoked, rough: 0.48, flag: SURF.FLUTED, uv: { texScale: 1.1, grain: 'y' } });
  box('stone', [8.9, u.floorY + 0.755, 10.95], 1.04, 0.03, 2.64, { color: C.travertine, rough: 0.36 });
  upperBlock('counter', 8.9, 10.95, 0.52, 1.32, 0, { y1: u.floorY + 0.78 });
  shadows.push({ c: [8.9, u.floorY + 0.37, 10.95], h: [0.5, 0.37, 1.3], rot: 0, k: 1 });
  // The removed banquette and two lower downlights make room in the fixture
  // table for the stair and upper room. No scene lights or draws are added.
  for (const x of [-5.6, 5.6]) {
    box('metal', [x, u.roofY - 0.055, 11.1], 0.13, 0.04, 5.7, bronze);
    box('emissive', [x, u.roofY - 0.079, 11.1], 0.035, 0.004, 5.5, { color: '#f5d7ae', tint: 0.6, rough: GLOW.SLOT });
    practicals.push({ type: 'line', a: [x, u.roofY - 0.09, 8.5], b: [x, u.roofY - 0.09, 13.7], n: [0, -1, 0], color: [1, 0.8, 0.59], power: 0.33, range: 5, group: GLOW.SLOT });
  }
  // Circulation remains legible in Night Watch: one recessed diffuser runs
  // across the room, independent of the dimmable decorative slots. Its
  // analytical source and visible strip have the same position and channel.
  const channel = [[-0.05, 0], [-0.05, -0.025], [0.05, -0.025], [0.05, 0]];
  const diffuser = [[-0.025, 0], [-0.025, -0.004], [0.025, -0.004], [0.025, 0]];
  b.add('metal', prism(channel, 20), { ...bronze, at: [-10, u.roofY - 0.02, 11], rot: [0, Math.PI / 2, 0] });
  b.add('emissive', prism(diffuser, 19.8), { color: '#f2d6af', tint: 1.1, rough: GLOW.ENTRANCE, at: [-9.9, u.roofY - 0.048, 11], rot: [0, Math.PI / 2, 0] });
  // (power 3.5, LIGHT lane: enough to keep the floor legible, low enough that
  // the lamps read as pools instead of one even brown wash)
  practicals.push({ type: 'line', a: [-10, u.roofY - 0.06, 11], b: [10, u.roofY - 0.06, 11], n: [0, -1, 0], color: [1, 0.84, 0.67], power: 3.5, range: 6.5, group: GLOW.ENTRANCE });
  // Concealed strip under the inner handrail lights the treads rather than
  // merely drawing illuminated markers against an otherwise black stair.
  // The opal diffuser hangs 13 mm below a bronze channel fixed under the
  // rail (offsets across the rake from its centre line, whose bottom is at
  // -0.0275): a 4 mm strip broke into a dotted line at a distance.
  b.add('emissive', prism([[-0.011, -0.0375], [-0.011, -0.0505], [0.011, -0.0505], [0.011, -0.0375]], length), { color: '#f0cb95', tint: 0.7, rough: GLOW.ENTRANCE, at: [st.x1 + 0.07, 1.08, st.z0], rot: [-slope, 0, 0] });
  dressAdd.add('metal', prism([[-0.015, -0.0265], [-0.015, -0.038], [0.015, -0.038], [0.015, -0.0265]], length), { ...bronze, at: [st.x1 + 0.07, 1.08, st.z0], rot: [-slope, 0, 0] });
  practicals.push({ type: 'line', a: [st.x1 + 0.04, 1.02, st.z0], b: [st.x1 + 0.04, u.floorY + 1.02, st.z1], n: [-0.45, -1, 0.1], color: [1, 0.8, 0.58], power: 2.5, range: 4, group: GLOW.ENTRANCE });

  // The second level's dressing (FLY_LOUNGE_SECOND_LEVEL.md, FURNISH).
  const ctx = { b: dressAdd, random: rng(1931), shadows, floorAO, practicals, dressing, steamSources, plan, upperBlock };
  upperNook(ctx);
  upperLibrary(ctx);
  upperPlants(ctx);
  coffeeStation(ctx);
  modelDisplay(ctx);
  upperEastSeat(ctx);
  roofFinish(ctx);
  chartWall(ctx);
}

// ---------------------------------------------------------------------------
// The second level's dressing (FLY_LOUNGE_SECOND_LEVEL.md, FURNISH; pier only)
//
// Every piece is built where lib/fly/lounge/upper-dressing.mjs puts it and
// pushes its DRESSING id (and a cup its steam point) from the function that
// builds it. Parts authored at floor level ride `lifted` onto the upper floor.
// No two visible faces share a plane: stacked finishes sit >= 20 mm proud,
// concealed structure is buried, and coplanar touches are opposite-facing.
// ---------------------------------------------------------------------------

/** A builder that adds parts `dy` higher (helpers authored at floor level). */
function lifted(b, dy) {
  const m = frame([0, dy, 0], 0);
  return { add: (bucket, geometry, opts = {}) => b.add(bucket, geometry, { ...opts, matrix: opts.matrix ? m.clone().multiply(opts.matrix) : m }) };
}

/**
 * The stair's finishing (weaknesses 7 and 8): one continuous travertine
 * stringer clads the plinth's east face along the rake, 50 mm proud of the
 * stone, its top edge 60 mm above the nosings (the treads' ends are housed in
 * it, and the east balusters are fixed to its face), over a 40 mm shadow gap
 * with a dark kick; and a bronze trim covers the y = 4.6 seam where the lower
 * wall's plaster meets the stairwell's reeded oak (both rounded boxes on
 * x = -11.2, whose touching edges sparkled as a dotted line).
 */
function stairFinish(b, st, u) {
  const tread = (st.z1 - st.z0) / st.steps, rise = st.rise / st.steps, slope = rise / tread;
  const zFront = st.z0 - 0.025; // just ahead of the first nosing (z0 - 0.02)
  const nosing = (z) => (z - (st.z0 - 0.02)) * slope + rise; // the line through the nosings
  const capY = u.floorY + 0.06, zLevel = (capY - 0.06 - rise) / slope + (st.z0 - 0.02);
  // Profile (z, y), extruded across x from the stringer's face (x1 + 0.05) to the stone (x1).
  const profile = [[zFront, 0.04], [st.z1, 0.04], [st.z1, capY], [zLevel, capY], [zFront, nosing(zFront) + 0.06]];
  b.add('stone', prism(profile, 0.05, { smoothDeg: 5 }), { color: C.travertineDark, rough: 0.5, flag: SURF.LONG, uv: { texScale: 1.2, grain: 'x' }, at: [st.x1 + 0.05, 0, 0], rot: [0, -Math.PI / 2, 0] });
  // The kick in the shadow gap, 44 mm behind the stringer's face.
  b.add('metal', block(0.016, 0.03, st.z1 - zFront), { color: '#2a2420', rough: 0.5, metal: 1, flag: SURF.LONG, at: [st.x1 - 0.002, 0.015, (zFront + st.z1) / 2] });
  // The seam trim: 40 mm tall, 24 mm proud of both walls, from the glazing's
  // end post along the flight and the landing to the library.
  const z0 = SIDE_Z1 + 0.18, z1 = 12.85;
  b.add('metal', block(0.024, 0.04, z1 - z0), { color: '#2a2420', rough: 0.42, metal: 1, flag: SURF.LONG, at: [-HALF_X + 0.012, u.floorY + 0.005, (z0 + z1) / 2] });
}

/**
 * A cup of coffee on its saucer for the second level (upper-dressing.mjs CUP:
 * the saucer's foot on `base`, the cup 7.5 mm up, its lip 75 mm above that).
 * White porcelain at 16 facets: the hero cup (heroProps) stays as it is.
 */
function pierCup(b, base, rot) {
  const m = frame(base, rot), segs = 16;
  b.add('small', lathe([[0, 0.001], [0.052, 0.001], [0.068, 0.007], [0.077, 0.014], [0.07, 0.0132], [0.034, 0.0075], [0, 0.0075]], segs), { color: C.ceramic, rough: 0.1, flag: SURF.CERAMIC, matrix: m });
  const cup = [0, CUP.saucerLift, 0];
  b.add('small', lathe([[0.001, 0], [0.026, 0], [0.033, 0.018], [0.04, 0.056], [0.0428, 0.0755], [0.0418, 0.0775], [0.039, 0.072], [0.031, 0.03], [0.001, 0.012]], segs), { color: C.ceramic, rough: 0.09, flag: SURF.CERAMIC, at: cup, matrix: m });
  const coffee = b.add('small', lathe([[0.001, 0.0645], [0.02, 0.0647], [0.0385, 0.0655]], segs), { color: '#3a2214', rough: 0.18, at: cup, matrix: m });
  tintRings(coffee, [[0.0, '#2c190f'], [0.016, '#6b3f22'], [0.03, '#a8754a'], [0.04, '#6b4126']], cup, m);
  b.add('small', torus(0.02, 0.005, 5, 8, Math.PI * 1.15), { color: C.ceramic, rough: 0.1, flag: SURF.CERAMIC, at: [0.05, cup[1] + 0.041, 0], rot: [0, 0, -Math.PI * 0.575], matrix: m });
}

/** Build one contracted cup and register its steam (upper-dressing.mjs CUPS). */
function contractCup(ctx, id) {
  const cup = CUPS.find((k) => k.id === id);
  pierCup(ctx.b, cup.base, cup.rot);
  ctx.steamSources.push(Object.freeze({ at: steamPoint(cup), r: STEAM_R }));
  ctx.dressing.push(cup.id);
}

/**
 * The reading nook at the upper room's west end (weaknesses 1 and 9): a
 * vantage chair in warm wool on its own rug, the side table with a cup and a
 * paperback at its right hand, a bronze floor lamp at its left shoulder (one
 * practical, GLOW.READING).
 */
function upperNook(ctx) {
  const { b, shadows, floorAO, practicals, dressing, plan, upperBlock } = ctx;
  const UP = plan.upper.floorY, raised = lifted(b, UP);
  const seat = plan.vantage.find((v) => v.id === 'upper-nook'), c = seat.chair;
  // The rug, exactly the contract's rect (upper-dressing.mjs FOOTSTEP_SURFACES).
  rug(raised, [-6.55, 9.35], 3.5, 2.0, '#7b5c45', '#4a372b');
  dressing.push(DRESSING.NOOK_RUG);
  const chair = frame([c.x, UP, c.z], c.rot);
  loungeChair(b, chair, { leather: false, color: '#b0743f', lite: true });
  // a deep teal wool cushion tucked into the lamp-side corner
  b.add('fabric', softBox({ w: 0.4, h: 0.38, d: 0.11, r: 0.05, seg: 2, div: 2, crownSide: 0.035 }), { color: '#2f5656', rough: 0.95, uv: { texScale: 0.2, grain: 'x' }, at: [-0.12, 0.6, 0.2], rot: [0.34, 0.16, 0.07], matrix: chair });
  upperBlock('seat', c.x + 0.037 * Math.sin(c.rot), c.z + 0.037 * Math.cos(c.rot), 0.43, 0.46, c.rot, { seatId: seat.id, y1: UP + 1.05 });
  shadowChairPair(shadows, c.x, UP, c.z, c.rot);
  const aa = [];
  shadowChair([], aa, c.x, c.z, c.rot);
  for (const item of aa) floorAO.push({ ...item, c: [item.c[0], item.c[1] + UP, item.c[2]] });
  // Side table (the contract's: top 0.57 m at (-5.72, 8.93), r 0.3).
  const tx = -5.72, tz = 8.93, top = 0.57;
  sideTable(raised, [tx, 0, tz], top, 0.3, 24);
  upperBlock('table', tx, tz, 0.3, 0.3, 0, { round: true, y1: UP + 0.6 });
  floorAO.push({ c: [tx, UP + 0.008, tz], h: [0.18, 0.008, 0.18], rot: 0, k: 1 });
  floorAO.push({ c: [tx, UP + 0.3, tz], h: [0.025, 0.28, 0.025], rot: 0, k: 1 });
  contractCup(ctx, DRESSING.CUP_NOOK);
  b.add('small', block(0.112, 0.022, 0.176), { color: '#2f4a5c', rough: 0.7, at: [tx + 0.09, UP + top + 0.011, tz + 0.14], rot: [0, 0.52, 0] });
  b.add('small', block(0.106, 0.004, 0.17), { color: C.paper, rough: 0.85, flag: SURF.PAPER, at: [tx + 0.09, UP + top + 0.024, tz + 0.14], rot: [0, 0.52, 0] });
  // Floor lamp: base, stem and an arm over the reader's left shoulder in
  // satin dark bronze (a polished brass 10 mm stem broke its highlights into
  // dots), an opal-lined linen shade; the light under it reads onto the lap.
  const lx = -7.25, lz = 9.45, satin = { color: '#4a3b2e', rough: 0.55, metal: 0.6 };
  b.add('metal', lathe([[0, 0], [0.155, 0], [0.16, 0.006], [0.15, 0.02], [0.03, 0.026], [0, 0.026]], 24), { ...satin, at: [lx, UP, lz] });
  b.add('metal', cylinder(0.0105, 0.012, 1.33, 10), { ...satin, at: [lx, UP + 0.025 + 0.665, lz] });
  const armEnd = [lx + 0.33, UP + 1.47, lz - 0.2];
  const arm = curve([[lx, UP + 1.35, lz], [lx + 0.03, UP + 1.44, lz - 0.02], [lx + 0.16, UP + 1.5, lz - 0.1], armEnd]);
  b.add('metal', tube(arm, 10, 0.009, 6), satin);
  const shade = [armEnd[0], armEnd[1] - 0.2, armEnd[2]];
  b.add('metal', cylinder(0.006, 0.006, 0.05, 6), { ...satin, at: [armEnd[0], armEnd[1] - 0.025, armEnd[2]] });
  b.add('small', lathe([[0.14, 0], [0.138, 0.012], [0.1, 0.12], [0.062, 0.175], [0.058, 0.178]], 20), { color: '#e8dcc6', rough: 0.9, flag: SURF.OPAL, at: shade });
  b.add('emissive', lathe([[0, 0.05], [0.07, 0.04], [0.12, 0.02], [0.134, 0.012]], 20), { color: '#ffd9a6', tint: 1.1, rough: GLOW.READING, at: shade });
  const lampAt = [shade[0], shade[1] + 0.03, shade[2]], lap = [c.x + 0.05, UP + 0.55, c.z - 0.25];
  const d = lap.map((v, i) => v - lampAt[i]), dl = Math.hypot(...d);
  practicals.push({ type: 'spot', p: lampAt, d: d.map((v) => v / dl), color: [1, 0.76, 0.5], power: 0.75, range: 3.6, cone: [0.42, 0.9], group: GLOW.READING });
  upperBlock('lamp', lx, lz, 0.17, null, 0, { round: true, y1: UP + 1.55 });
  // the arm and shade overhang at head height: their footprint, stem to shade rim
  const ax = (lx + shade[0]) / 2, az = (lz + shade[2]) / 2, half = Math.hypot(shade[0] - lx, shade[2] - lz) / 2;
  upperBlock('lamp', ax, az, half + 0.14, 0.14, Math.atan2(-(shade[2] - lz), shade[0] - lx), { y1: UP + 1.55 });
  floorAO.push({ c: [lx, UP + 0.013, lz], h: [0.15, 0.013, 0.15], rot: 0, k: 1 });
}

/**
 * The spotter's library on the west wall behind the top landing (the first
 * thing seen from the head of the stair): a walnut bookcase standing 20 mm
 * off the reeded oak, five shelves of books (each one 12-triangle box on
 * SURF.SPINES, its cover colour in the vertex colour), a few lying flat,
 * bronze bookends, a framed photograph, and a picture light over the top
 * (one practical, GLOW.DISPLAY).
 */
function upperLibrary(ctx) {
  const { b, random, shadows, floorAO, practicals, dressing, plan, upperBlock } = ctx;
  const UP = plan.upper.floorY;
  const xBack = -11.18, xFront = -10.84, z0 = 12.85, z1 = 14.05, H = 2.2, t = 0.025;
  const depth = xFront - xBack, xc = (xBack + xFront) / 2, zc = (z0 + z1) / 2;
  const walnut = { color: C.oakDark, rough: 0.5, flag: SURF.LONG, uv: { texScale: 0.9, grain: 'y' } }; // LONG: long boards keep analytic AO (their end vertices sit in crevices)
  const panel = (at, w, h, d, opts = walnut) => b.add('wood', block(w, h, d), { ...opts, at });
  // Flat boards (a few-millimetre rounding sparkled along the side panels'
  // edges). Sides run full height; the top (3 mm back), plinth and shelves
  // (21 mm back) stand between them, so no two front faces share a plane.
  for (const z of [z0 + t / 2, z1 - t / 2]) panel([xc, UP + H / 2, z], depth, H, t);
  const inner = z1 - z0 - 2 * t + 0.002;
  panel([xc - 0.0015, UP + H - t / 2 - 0.002, zc], depth - 0.003, t, inner);
  panel([xc - 0.015, UP + 0.04, zc], depth - 0.04, 0.08, inner, { ...walnut, color: '#3b2a1f' });
  b.add('wood', block(0.012, H - t - 0.08, inner), { color: '#3a2a20', rough: 0.6, uv: { texScale: 0.9, grain: 'y' }, at: [xBack + 0.006, UP + 0.08 + (H - t - 0.08) / 2, zc] });
  const shelfY = [0.08, 0.5, 0.92, 1.34, 1.76];
  for (const y of shelfY) panel([xc - 0.0075, UP + y + t / 2, zc], depth - 0.027, t, inner, { ...walnut, uv: { texScale: 0.9, grain: 'z' } });
  // Books: cloth and paper covers in a muted palette, packed toward the
  // shelf front, in loose runs with a lean or a flat stack between.
  const covers = ['#7a2e26', '#24344f', '#2e4a35', '#b8893a', '#d8cdb4', '#1f1d1b', '#2f5d62', '#5a2430', '#a07a52', '#55657a', '#e5e0d4', '#b8582c', '#3d3a52', '#8c8466'];
  const spine = (x, y, z, w, h, d, rot, color) => b.add('small', block(d, h, w), { color, rough: 0.72, flag: SURF.SPINES, at: [x, y, z], rot });
  const zIn0 = z0 + t + 0.012, zIn1 = z1 - t - 0.012;
  for (let s = 0; s < shelfY.length; s++) {
    const floorY = UP + shelfY[s] + t, clear = (s + 1 < shelfY.length ? shelfY[s + 1] : H - t) - shelfY[s] - t;
    let z = zIn0;
    // The top shelf: a short run held by bookends, a flat stack, the photograph.
    const end = s === shelfY.length - 1 ? zIn0 + 0.5 : zIn1;
    while (z < end - 0.02) {
      const r = random();
      if (r < 0.07 && z < end - 0.3) {
        // a flat stack of three or four
        const n = 3 + Math.floor(random() * 2), w = 0.2 + random() * 0.06, d = 0.15 + random() * 0.05;
        let y = floorY;
        for (let k = 0; k < n; k++) {
          const h = 0.025 + random() * 0.02;
          spine(xFront - 0.03 - d / 2, y + h / 2, z + w / 2 + (random() - 0.5) * 0.01, w - random() * 0.03, h, d, [0, (random() - 0.5) * 0.08, 0], covers[Math.floor(random() * covers.length)]);
          y += h;
        }
        z += w + 0.03;
        continue;
      }
      if (r < 0.14) { z += 0.03 + random() * 0.08; continue; } // a gap
      const w = 0.018 + random() * 0.032, h = Math.min(clear - 0.03, 0.17 + random() * 0.15), d = 0.13 + random() * 0.09;
      const lean = r > 0.95 && z > zIn0 + 0.1 ? 0.18 : 0; // the odd book leaning on its neighbour
      spine(xFront - 0.022 - random() * 0.012 - d / 2, floorY + h / 2 * Math.cos(lean), z + w / 2 + (lean ? h / 2 * Math.sin(lean) : 0), w, h, d, [-lean, 0, 0], covers[Math.floor(random() * covers.length)]);
      z += w + (lean ? h * Math.sin(lean) : 0) + 0.0015;
    }
    if (s === shelfY.length - 1) {
      // bronze bookends at either end of the run
      for (const [zz, sgn] of [[zIn0 - 0.004, 1], [z + 0.004, -1]]) {
        b.add('metal', block(0.12, 0.003, 0.09), { color: C.bronze, rough: 0.35, metal: 1, at: [xFront - 0.09, floorY + 0.0015, zz + sgn * 0.045] });
        b.add('metal', block(0.12, 0.15, 0.004), { color: C.bronze, rough: 0.35, metal: 1, at: [xFront - 0.09, floorY + 0.075, zz] });
      }
      // a framed photograph standing on the shelf, angled into the room
      const fz = zIn1 - 0.16, fy = floorY + 0.105;
      const fm = frame([xFront - 0.09, fy, fz], Math.PI / 2 + 0.35, -0.12);
      b.add('small', frameRing(0.16, 0.21, 0.016, 0.014), { color: '#1d1b19', rough: 0.4, matrix: fm });
      const photo = b.add('small', block(0.128, 0.178, 0.002), { color: '#ffffff', rough: 0.5, at: [0, 0, 0.004], matrix: fm });
      // a sky over the field and the runway: a two-tone print in its vertex colours
      const sky = linear('#9fb3c4'), field = linear('#6d6a55');
      const pp = photo.attributes.position, col = photo.attributes.color;
      for (let i = 0; i < pp.count; i++) {
        const k = pp.getY(i) > fy ? sky : field;
        col.setXYZ(i, k[0], k[1], k[2]);
      }
      b.add('small', block(0.04, 0.11, 0.004), { color: '#1d1b19', rough: 0.5, at: [0, -0.05, -0.028], rot: [0.45, 0, 0], matrix: fm });
    }
  }
  // The picture light: a brass bar on the top's front edge, its opal strip
  // washing down the spines.
  // (all inside the library's inspectable bounds: x <= -10.8, y <= UP + 2.25)
  const ly = UP + H + 0.03, brass = { color: '#a8875a', rough: 0.4, metal: 1 };
  b.add('metal', block(0.05, 0.03, 0.04), { ...brass, at: [xFront - 0.01, UP + H + 0.015, zc] });
  b.add('metal', block(0.03, 0.03, 0.86), { ...brass, at: [xFront + 0.02, ly, zc] });
  b.add('emissive', block(0.016, 0.004, 0.8), { color: '#ffe0b8', tint: 1.1, rough: GLOW.DISPLAY, at: [xFront + 0.022, ly - 0.017, zc] });
  practicals.push({ type: 'line', a: [xFront + 0.03, ly - 0.025, zc - 0.4], b: [xFront + 0.03, ly - 0.025, zc + 0.4], n: [-0.55, -1, 0], color: [1, 0.8, 0.58], power: 0.32, range: 3, group: GLOW.DISPLAY });
  upperBlock('shelf', xc - 0.01, zc, depth / 2 + 0.03, (z1 - z0) / 2 + 0.01, 0, { y1: UP + H + 0.05 });
  shadows.push({ c: [xc, UP + H / 2, zc], h: [depth / 2, H / 2, (z1 - z0) / 2], rot: 0, k: 1 });
  floorAO.push({ c: [xc, UP + H / 2, zc], h: [depth / 2, H / 2, (z1 - z0) / 2], rot: 0, k: 1 });
  dressing.push(DRESSING.LIBRARY);
}

/**
 * Planting upstairs (weakness 12): a fiddle-leaf fig in the reading nook's
 * corner by the front glazing, set back from the stair guard in a lower pot
 * so it does not loom over the flight (scaled under the 3.2 m ceiling, its
 * canopy the walk blocker and filling the corner behind the lamp; at the
 * landing it stood in the stair's axis and hid the back window) and, in the
 * back-east corner, a snake plant in a tall travertine pot — an olive's
 * canopy there (~1.1 m radius) crossed both glazings and overhung the coffee
 * machine, and cost four times the triangles.
 */
function upperPlants(ctx) {
  const { b, random, shadows, floorAO, plan, upperBlock } = ctx;
  const UP = plan.upper.floorY, raised = lifted(b, UP);
  const fig = [-7.95, 9.1], snake = [10.6, 13.68];
  figTree(raised, random, fig[0], fig[1], 2.1, { stems: 3, leaves: 17, rows: 5, segs: 28, pr: 0.38, ph: 0.55 });
  upperBlock('planter', fig[0], fig[1], 0.9, null, 0, { round: true, y1: UP + 2.9 }); // its lowest leaves reach 0.75-0.9 m out
  shadows.push({ c: [fig[0], UP + 1.6, fig[1]], h: [0.7, 1.0, 0.7], rot: 0, k: 0.5 });
  floorAO.push({ c: [fig[0], UP + 0.28, fig[1]], h: [0.38, 0.28, 0.38], rot: 0, k: 1 });
  snakePlant(raised, random, snake[0], snake[1]);
  upperBlock('planter', snake[0], snake[1], 0.38, null, 0, { round: true, y1: UP + 1.45 });
  shadows.push({ c: [snake[0], UP + 0.68, snake[1]], h: [0.26, 0.68, 0.26], rot: 0, k: 0.6 });
  floorAO.push({ c: [snake[0], UP + 0.22, snake[1]], h: [0.24, 0.22, 0.24], rot: 0, k: 1 });
}

/** A snake plant: stiff upright sword leaves from a tall travertine pot. */
function snakePlant(b, random, x, z) {
  const ph = 0.44;
  b.add('stone', lathe([[0, 0], [0.2, 0], [0.222, 0.02], [0.24, ph - 0.02], [0.236, ph], [0.212, ph], [0.212, ph - 0.05], [0, ph - 0.05]], 20), { color: C.travertineDark, rough: 0.5, uv: { mode: 'cyl', texScale: 1.2 }, at: [x, 0, z] });
  b.add('small', cylinder(0.212, 0.212, 0.01, 16), { color: C.soil, rough: 1, at: [x, ph - 0.06, z] });
  for (let k = 0; k < 14; k++) {
    const a = k * 2.4 + random() * 0.5, rr = 0.03 + random() * 0.1;
    const len = 0.55 + random() * 0.5 - rr * 1.2, tilt = 0.06 + rr * 0.9 + random() * 0.08;
    b.add('small', leaf(len, 0.06 + random() * 0.03, { fold: 0.18, curl: 0.02, shape: 0, rows: 5 }), {
      color: random() < 0.4 ? '#3f5a2f' : '#2c4527', tint: 0.85 + random() * 0.3, rough: 0.4, flag: SURF.LEAF,
      at: [x + Math.cos(a) * rr, ph - 0.06, z + Math.sin(a) * rr], rot: [-(Math.PI / 2 - tilt), Math.PI / 2 - a, (random() - 0.5) * 1.2],
    });
  }
}

/**
 * The coffee station on the credenza (upper-dressing.mjs CREDENZA): a
 * compact espresso machine in stainless and black at its back end, the two
 * contracted cups on their saucers, a tray with a sugar bowl and a short
 * stack of clean cups. No practical, and no emitter: the ready light is an
 * amber lens.
 */
function coffeeStation(ctx) {
  const { b, shadows, dressing } = ctx;
  const top = CREDENZA.top, steel = { color: '#c3c3be', rough: 0.4, metal: 1 }, black = { color: '#1b1b1c', rough: 0.45 };
  const mx = 8.96, mz = 11.8; // the machine's centre (its front faces the room, -x)
  b.add('small', block(0.56, 0.045, 0.5), { ...black, at: [mx - 0.06, top + 0.0225, mz] });
  // flat-faced brushed steel: a rounded corner caught the fixtures as a sparkling streak
  b.add('metal', block(0.42, 0.33, 0.48), { ...steel, at: [mx, top + 0.045 + 0.165, mz] });
  b.add('small', block(0.012, 0.15, 0.36), { color: '#141415', rough: 0.25, at: [mx - 0.215, top + 0.27, mz] });
  // group head and portafilter
  b.add('metal', block(0.07, 0.045, 0.1), { ...steel, at: [mx - 0.25, top + 0.205, mz] });
  b.add('metal', cylinder(0.032, 0.03, 0.028, 14), { ...steel, at: [mx - 0.255, top + 0.17, mz] });
  b.add('small', cylinder(0.011, 0.013, 0.13, 10), { ...black, at: [mx - 0.33, top + 0.165, mz + 0.02], rot: [0, 0.25, Math.PI / 2 - 0.08] });
  // drip tray, steam wand, gauge, cup rail and the ready light
  b.add('metal', block(0.12, 0.016, 0.3), { color: '#9a9a96', rough: 0.35, metal: 1, flag: SURF.GRILLE, uv: { texScale: 1, grain: 'z' }, at: [mx - 0.275, top + 0.053, mz] });
  b.add('metal', block(0.04, 0.012, 0.012), { ...steel, at: [mx - 0.228, top + 0.27, mz - 0.17] });
  b.add('metal', cylinder(0.0045, 0.0045, 0.15, 8), { ...steel, at: [mx - 0.25, top + 0.2, mz - 0.17], rot: [0, 0, 0.15] });
  b.add('small', cylinder(0.022, 0.022, 0.008, 16), { color: '#efece4', rough: 0.3, at: [mx - 0.226, top + 0.3, mz - 0.12], rot: [0, 0, Math.PI / 2] });
  for (const dx of [-0.15, 0.15]) b.add('metal', cylinder(0.005, 0.005, 0.44, 8), { ...steel, at: [mx + dx, top + 0.378, mz], rot: [Math.PI / 2, 0, 0] });
  // the ready light: an amber lens, not an emitter (any GLOW channel bloomed it to a 4 cm blob)
  b.add('small', block(0.004, 0.008, 0.016), { color: '#d9822b', rough: 0.15, at: [mx - 0.223, top + 0.3, mz + 0.12] });
  shadows.push({ c: [mx - 0.02, top + 0.2, mz], h: [0.24, 0.2, 0.25], rot: 0, k: 1 });
  // the two cups on their saucers
  contractCup(ctx, DRESSING.CUP_STATION_A);
  contractCup(ctx, DRESSING.CUP_STATION_B);
  // a small walnut tray: sugar bowl, two spoons, three clean cups stacked
  const tz = 11.3;
  b.add('wood', block(0.36, 0.014, 0.22), { color: C.oakDark, rough: 0.45, uv: { texScale: 0.9, grain: 'x' }, at: [9.03, top + 0.007, tz] });
  const ty = top + 0.014;
  b.add('small', lathe([[0, 0], [0.03, 0], [0.04, 0.012], [0.046, 0.04], [0.044, 0.052], [0.0, 0.052]], 16), { color: C.ceramic, rough: 0.1, flag: SURF.CERAMIC, at: [8.93, ty, tz] });
  b.add('small', lathe([[0, 0.052], [0.047, 0.052], [0.046, 0.058], [0.012, 0.064], [0.012, 0.072], [0, 0.074]], 16), { color: C.ceramic, rough: 0.1, flag: SURF.CERAMIC, at: [8.93, ty, tz] });
  for (const dz of [-0.06, -0.075]) b.add('metal', block(0.11, 0.003, 0.012), { color: '#c4c2bc', rough: 0.25, metal: 1, at: [9.0, ty + 0.0015, tz + dz + 0.13], rot: [0, 0.3, 0] });
  const inverted = [[0.0425, 0], [0.04, 0.019], [0.033, 0.057], [0.026, 0.075], [0.001, 0.075]];
  for (let k = 0; k < 3; k++) b.add('small', lathe(inverted, 16), { color: C.ceramic, rough: 0.1, flag: SURF.CERAMIC, at: [9.12, ty + k * 0.074, tz - 0.01] });
  dressing.push(DRESSING.COFFEE_STATION);
}

/** Recolour a part's vertices from its local position: fn(x, y, z) -> linear [r,g,b]. */
function recolor(g, m, fn) {
  const inv = new Matrix4().copy(m).invert(), v = new Vector3();
  const p = g.attributes.position, col = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(inv);
    const c = fn(v.x, v.y, v.z);
    if (c) col.setXYZ(i, c[0], c[1], c[2]);
  }
}

/**
 * A first-party desk model, nose along local +Z, wings along X, on a stand.
 * kind: 'single' (high-wing piston single), 'twin' (twin-jet airliner),
 * 'quad' (four-engine long-hauler). `m` places the model's centre. Painted
 * white over a light grey belly with one restrained cheat-line colour along
 * the windows and on the fin. Scenery, never a contact.
 */
function deskModel(b, m, kind, accent) {
  const paint = { rough: 0.32 };
  const white = linear('#f1efe9'), grey = linear('#b9bcbf'), line = linear(accent);
  const S = { single: { L: 0.27, R: 0.017, span: 0.36 }, twin: { L: 0.4, R: 0.021, span: 0.41 }, quad: { L: 0.47, R: 0.024, span: 0.5 } }[kind];
  const L = S.L, R = S.R, along = [Math.PI / 2, 0, 0]; // lathe +Y -> nose +Z
  // Fuselage: tail cone to nose, 12 facets (10 on the single).
  const body = kind === 'single'
    ? [[0, -L / 2], [0.004, -L / 2 + 0.006], [0.008, -L * 0.36], [0.014, -L * 0.12], [R, L * 0.05], [R, L * 0.22], [R * 0.86, L * 0.36], [R * 0.6, L * 0.47], [0, L / 2]]
    : [[0, -L / 2], [R * 0.25, -L / 2 + 0.006], [R * 0.6, -L * 0.42], [R * 0.92, -L * 0.3], [R, -L * 0.22], [R, L * 0.3], [R * 0.9, L * 0.39], [R * 0.62, L * 0.455], [R * 0.25, L * 0.49], [0, L / 2]];
  const fus = b.add('small', lathe(body, kind === 'single' ? 10 : 12), { ...paint, color: '#ffffff', rot: along, matrix: m });
  const fm = new Matrix4().copy(m).multiply(new Matrix4().makeRotationX(Math.PI / 2));
  recolor(fus, fm, (x, y, z) => {
    // local lathe frame: y along the body, (x, z) around it; z < 0 is the belly after the turn
    const a = Math.atan2(-z, Math.abs(x)); // -pi/2 belly .. +pi/2 crown, per side
    if (Math.abs(a - 0.12) < 0.2 && Math.hypot(x, z) > R * 0.7) return line;
    return a < -0.35 ? grey : white;
  });
  // A wing: planform (x span, c chord, +c forward) as a thin prism, laid flat.
  const wing = (pts, at, thick, color, dihedral = 0, side = 1) => {
    const wm = new Matrix4().copy(m).multiply(new Matrix4().makeTranslation(at[0], at[1], at[2])).multiply(new Matrix4().makeRotationZ(side * dihedral));
    b.add('small', prism(pts, thick, { smoothDeg: 10 }), { ...paint, color, rot: [Math.PI / 2, 0, 0], matrix: wm });
  };
  const half = S.span / 2;
  if (kind === 'single') {
    // high wing on the cabin roof, straight and tapered, with struts
    wing([[-half, 0.03], [half, 0.03], [half, -0.012], [-half, -0.012]], [0, R + 0.002, 0.02], 0.004, '#f1efe9');
    for (const s of [-1, 1]) b.add('small', block(0.003, 0.082, 0.004), { ...paint, color: '#d9d9d6', at: [s * 0.051, 0.0045, 0.03], rot: [0, 0, -s * 1.26], matrix: m });
    wing([[-0.065, -L / 2 + 0.035], [0.065, -L / 2 + 0.035], [0.05, -L / 2 + 0.005], [-0.05, -L / 2 + 0.005]], [0, 0.004, 0], 0.003, '#f1efe9');
    const fin = prism([[-L / 2 + 0.002, 0.004], [-L / 2 + 0.05, 0.004], [-L / 2 + 0.018, 0.055], [-L / 2 + 0.002, 0.055]], 0.003, { smoothDeg: 10 });
    b.add('small', fin, { ...paint, color: accent, at: [0.0015, 0, 0], rot: [0, -Math.PI / 2, 0], matrix: m });
    b.add('small', lathe([[0, 0], [0.008, 0.004], [0.007, 0.014], [0, 0.02]], 8), { color: '#2a2a2b', rough: 0.4, at: [0, 0, L / 2 - 0.002], rot: along, matrix: m });
    b.add('small', block(0.004, 0.144, 0.002), { color: '#2a2a2b', rough: 0.4, at: [0, 0, L / 2 + 0.008], rot: [0, 0, 0.3], matrix: m });
    for (const s of [-1, 1]) {
      b.add('small', block(0.003, 0.04, 0.006), { ...paint, color: '#d9d9d6', at: [s * 0.022, -R - 0.012, 0.035], rot: [0, 0, s * 0.5], matrix: m });
      b.add('small', cylinder(0.008, 0.008, 0.005, 10), { color: '#232324', rough: 0.6, at: [s * 0.032, -R - 0.03, 0.035], rot: [0, 0, Math.PI / 2], matrix: m });
    }
    b.add('small', block(0.003, 0.03, 0.004), { ...paint, color: '#d9d9d6', at: [0, -R - 0.008, L * 0.4], matrix: m });
    b.add('small', cylinder(0.007, 0.007, 0.005, 10), { color: '#232324', rough: 0.6, at: [0, -R - 0.024, L * 0.4], rot: [0, 0, Math.PI / 2], matrix: m });
    return;
  }
  const sweep = kind === 'quad' ? 0.62 : 0.48, rootC = kind === 'quad' ? 0.1 : 0.08, tipC = rootC * 0.28;
  const le = rootC * 0.45, tipLE = le - half * Math.tan(sweep);
  for (const s of [-1, 1]) {
    wing([[0, le], [s * half, tipLE], [s * half, tipLE - tipC], [0, le - rootC]], [0, -R * 0.45, 0.01], 0.0045, '#e9e8e4', 0.07, s);
    const sh = half * 0.34, sle = -L / 2 + 0.07, sc = rootC * 0.5;
    wing([[0, sle], [s * sh, sle - sh * Math.tan(sweep)], [s * sh, sle - sh * Math.tan(sweep) - sc * 0.4], [0, sle - sc]], [0, R * 0.2, 0], 0.003, '#e9e8e4', 0.05, s);
  }
  const finH = R * (kind === 'quad' ? 3.6 : 3.4), finC = rootC * 0.85;
  const fin = prism([[-L / 2 + 0.012, 0], [-L / 2 + 0.012 + finC, 0], [-L / 2 + 0.012 + finC * 0.45, finH], [-L / 2 + 0.012 + finC * 0.08, finH]], 0.0035, { smoothDeg: 10 });
  b.add('small', fin, { ...paint, color: accent, at: [0.00175, R * 0.6, 0], rot: [0, -Math.PI / 2, 0], matrix: m });
  // Engines under the wing: short lathed nacelles on pylons.
  const pods = kind === 'quad' ? [0.36, 0.68] : [0.36];
  const nac = [[0, 0], [0.0075, 0.002], [0.0095, 0.012], [0.009, 0.036], [0.0065, 0.044], [0, 0.044]];
  for (const s of [-1, 1]) for (const f of pods) {
    const x = s * half * f, zLE = 0.01 + le - Math.abs(x) * Math.tan(sweep), lift = Math.abs(x) * Math.tan(0.07);
    b.add('small', lathe(nac, 10), { color: '#c9ccd0', rough: 0.3, at: [x, -R * 0.45 - 0.014 + lift, zLE - 0.026], rot: along, matrix: m });
    b.add('small', block(0.0025, 0.011, 0.03), { color: '#d9d9d6', rough: 0.35, at: [x, -R * 0.45 - 0.0055 + lift, zLE - 0.012], matrix: m });
  }
  if (kind === 'quad') {
    // the upper deck's hump over the forward fuselage
    b.add('small', lathe([[0, 0], [0.012, 0.012], [0.017, 0.05], [0.015, 0.09], [0.008, 0.11], [0, 0.118]], 10), { ...paint, color: '#f1efe9', at: [0, R * 0.8, L * 0.36], rot: [-Math.PI / 2, 0, 0], matrix: m });
  }
}

/**
 * The model aircraft display (weakness 9; upper-dressing.mjs INSPECTABLES
 * model-display): a slim oak console against the east glazing, three desk
 * models in a flight line on angled stands, noses toward the runway.
 */
function modelDisplay(ctx) {
  const { b, shadows, floorAO, dressing, plan, upperBlock } = ctx;
  const UP = plan.upper.floorY, x0 = 10.35, x1 = 10.85, z0 = 9.9, z1 = 11.9, top = 0.78;
  const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, oak = { color: C.oak, rough: 0.5, flag: SURF.LONG, uv: { texScale: 0.9, grain: 'z' } };
  b.add('wood', block(x1 - x0, 0.036, z1 - z0), { ...oak, at: [xc, UP + top - 0.018, zc] });
  for (const z of [z0 + 0.06, z1 - 0.06]) b.add('wood', block(x1 - x0 - 0.06, top - 0.036, 0.032), { ...oak, uv: { texScale: 0.9, grain: 'y' }, at: [xc, UP + (top - 0.036) / 2, z] });
  b.add('wood', block(x1 - x0 - 0.08, 0.024, z1 - z0 - 0.152), { ...oak, at: [xc, UP + 0.2, zc] });
  upperBlock('counter', xc, zc, (x1 - x0) / 2 + 0.01, (z1 - z0) / 2 + 0.01, 0, { y1: UP + top });
  shadows.push({ c: [xc, UP + (top + 0.3) / 2, zc], h: [(x1 - x0) / 2, (top + 0.3) / 2, (z1 - z0) / 2], rot: 0, k: 0.75 });
  floorAO.push({ c: [xc, UP + top / 2, zc], h: [(x1 - x0) / 2 - 0.03, top / 2, (z1 - z0) / 2 - 0.04], rot: 0, k: 0.8 });
  const surface = UP + top;
  const models = [
    { kind: 'single', z: 10.2, h: 0.13, pitch: 0.12, bank: 0.0, accent: '#8a2d2a' },
    { kind: 'twin', z: 10.86, h: 0.2, pitch: 0.16, bank: -0.18, accent: '#2a3f6e' },
    { kind: 'quad', z: 11.55, h: 0.26, pitch: 0.1, bank: 0.0, accent: '#2f5a4a' },
  ];
  for (const md of models) {
    // stand: a black plinth and a slim chrome rod to the model's belly
    b.add('small', block(0.09, 0.014, 0.07), { color: '#1b1b1c', rough: 0.35, at: [xc, surface + 0.007, md.z + 0.04] });
    const rodH = md.h - 0.01;
    b.add('metal', cylinder(0.0032, 0.0032, rodH, 6), { color: '#bdbdb8', rough: 0.25, metal: 1, at: [xc, surface + 0.012 + rodH / 2 - 0.004, md.z + 0.04 - rodH / 2 * Math.sin(0.1)], rot: [-0.1, 0, 0] });
    // the model, nose -Z (toward the runway), climbing gently
    const m = frame([xc, surface + md.h + 0.012, md.z], Math.PI, -md.pitch, md.bank);
    deskModel(b, m, md.kind, md.accent);
  }
  dressing.push(DRESSING.MODEL_DISPLAY);
}

/**
 * The upper rear corner seat (optional in the plan): a rear-facing chair at
 * the east end beside the coffee station, its side table carrying a couple
 * of paperbacks and a water glass. No lamp: the fixture table is full.
 */
function upperEastSeat(ctx) {
  const { b, floorAO, shadows, plan, upperBlock } = ctx;
  const UP = plan.upper.floorY, raised = lifted(b, UP);
  const seat = plan.vantage.find((v) => v.id === 'upper-east'), c = seat.chair;
  loungeChair(b, frame([c.x, UP, c.z], c.rot), { leather: false, color: '#c3b398', lite: true });
  upperBlock('seat', c.x + 0.037 * Math.sin(c.rot), c.z + 0.037 * Math.cos(c.rot), 0.43, 0.46, c.rot, { seatId: seat.id, y1: UP + 1.05 });
  shadowChairPair(shadows, c.x, UP, c.z, c.rot);
  const aa = [];
  shadowChair([], aa, c.x, c.z, c.rot);
  for (const item of aa) floorAO.push({ ...item, c: [item.c[0], item.c[1] + UP, item.c[2]] });
  const tx = 7.5, tz = 13.04, top = 0.57;
  sideTable(raised, [tx, 0, tz], top, 0.3, 24);
  upperBlock('table', tx, tz, 0.3, 0.3, 0, { round: true, y1: UP + 0.6 });
  floorAO.push({ c: [tx, UP + 0.008, tz], h: [0.18, 0.008, 0.18], rot: 0, k: 1 });
  b.add('small', block(0.11, 0.022, 0.165), { color: '#8a3a2c', rough: 0.7, at: [tx - 0.08, UP + top + 0.011, tz - 0.1], rot: [0, 0.35, 0] });
  b.add('small', block(0.1, 0.018, 0.15), { color: '#27405a', rough: 0.7, at: [tx - 0.075, UP + top + 0.031, tz - 0.098], rot: [0, 0.18, 0] });
  b.add('small', lathe([[0, 0], [0.032, 0], [0.034, 0.002], [0.036, 0.1], [0.033, 0.1], [0.031, 0.006], [0, 0.006]], 16), { color: '#c9d4d4', rough: 0.12, flag: SURF.CERAMIC, at: [tx + 0.1, UP + top, tz + 0.08] });
}

/**
 * The lower roof as seen from the upper room (weakness 2): over the deck
 * between the roof glass and the upper glazing, a pale ballast field on
 * SURF.EXTERIOR (25 mm above the deck), raised paver borders, a bronze coping
 * at the front edge and a parapet at the ends, an exterior skin on the
 * stairwell's east return (built with it), and three low planter troughs of
 * grasses well back from the glazing. Everything stays under the upper
 * seats' line to the runway (tops <= 4.8 m; the troughs' grasses 0.25 m).
 */
function roofFinish(ctx) {
  const { b, random, plan, dressing } = ctx;
  const u = plan.upper, deck = DECK_Y + 0.06; // the deck plate's top (4.66)
  const ext = (extra) => ({ rough: 0.9, flag: SURF.EXTERIOR, ...extra });
  const zf = ROOF_Z1 + 0.06, zb = u.glazing.frontZ - 0.08, xw = u.well.x1 + 0.075, xe = HALF_X + 0.14;
  const slabTop = deck + 0.03, slab = (x0, x1, z0, z1) => b.add('plaster', block(x1 - x0, slabTop - (deck - 0.02), z1 - z0), { ...ext({ color: '#a19b90' }), uv: { mode: 'plan', texScale: 2 }, at: [(x0 + x1) / 2, (slabTop + deck - 0.02) / 2, (z0 + z1) / 2] });
  slab(xw, xe, zf, zb);
  slab(-HALF_X - 0.14, xw, zf, u.well.z0 - 0.07);
  // pavers: 300 mm borders 20 mm above the ballast
  const pave = (x0, x1, z0, z1) => b.add('stone', block(x1 - x0, 0.04, z1 - z0), { ...ext({ color: '#cbc2b2', rough: 0.7 }), uv: { mode: 'plan', texScale: 1.2 }, at: [(x0 + x1) / 2, slabTop, (z0 + z1) / 2] });
  pave(-HALF_X - 0.14, xe, zf, zf + 0.3);
  pave(xw, xw + 0.3, zf + 0.3, zb);
  pave(xe - 0.3, xe, zf + 0.3, zb);
  pave(xw + 0.3, xe - 0.3, zb - 0.3, zb);
  // two maintenance paths across the ballast, between the troughs
  for (const x of [-2.8, 2.8]) pave(x - 0.3, x + 0.3, zf + 0.3, zb - 0.3);
  // the coping along the front edge (20 mm ahead of the deck's face) and the parapets at the ends
  const bronze = ext({ color: C.bronzeDark, rough: 0.4, metal: 0.8 });
  b.add('metal', block(HALF_X * 2 + 0.44, 0.13, 0.08), { ...bronze, at: [0, deck + 0.025, ROOF_Z1 + 0.02] });
  for (const [x0, x1, z0, z1] of [[xe, HALF_X + 0.22, zf, zb], [-HALF_X - 0.22, -HALF_X - 0.14, zf, u.well.z0 - 0.07]]) {
    b.add('metal', block(x1 - x0, 0.13, z1 - z0), { ...bronze, at: [(x0 + x1) / 2, deck + 0.025, (z0 + z1) / 2] });
  }
  // three planter troughs of low grasses, 3 m back from the front edge
  const troughTop = deck + 0.12, tz = 5.2;
  for (const xc of [-5.6, 0.0, 5.6]) {
    const len = 2.8, wd = 0.4, wall = 0.03, h = troughTop - slabTop;
    const corten = ext({ color: '#5b4535', rough: 0.6, metal: 0.3 });
    for (const s of [-1, 1]) {
      b.add('metal', block(len, h, wall), { ...corten, at: [xc, slabTop + h / 2, tz + s * (wd / 2 - wall / 2)] });
      b.add('metal', block(wall, h, wd - 2 * wall), { ...corten, at: [xc + s * (len / 2 - wall / 2), slabTop + h / 2, tz] });
    }
    b.add('small', block(len - 2 * wall, 0.02, wd - 2 * wall), { ...ext({ color: C.soil, rough: 1 }), at: [xc, troughTop - 0.022, tz] });
    // a hedge of low shrubby sprigs, cards turned to face the upper room (+z)
    // so they read as foliage from there rather than as edge-on sticks
    for (let k = 0; k < 22; k++) {
      const gx = xc + (k / 21 - 0.5) * (len - 0.16) + (random() - 0.5) * 0.1, gz = tz + (random() - 0.5) * (wd - 0.14);
      const size = 0.26 + random() * 0.1;
      b.add('foliage', foliageCard(size, 0.35 + random() * 0.25), {
        color: '#eef0b8', tint: 0.9 + random() * 0.35, ...ext({ rough: 0.6 }), uv: { mode: 'keep' },
        at: [gx, troughTop - 0.015, gz], rot: [(random() - 0.5) * 0.55, (random() - 0.5) * 0.9 + (random() < 0.5 ? 0 : Math.PI), (random() - 0.5) * 0.5], scale: [1.15, 1, 1.15],
      });
    }
  }
  dressing.push(DRESSING.ROOF_FINISH);
}

/**
 * The stair wall's chart prints (weakness 12; upper-dressing.mjs
 * CHART_PANELS): four level frames stepping up with the rake. Each print is a
 * paper panel on SURF.CHART exactly on its contract rect (face x = -11.16),
 * inside a 12 mm linen slip 8 mm proud of it and a 40 mm dark bronze frame
 * whose back stands 20 mm off the wall (52 mm of border in all).
 */
function chartWall(ctx) {
  const { b, dressing } = ctx;
  for (const p of CHART_PANELS) {
    const slip = 0.012, bar = 0.04;
    b.add('small', block(0.003, p.h, p.w), { color: '#ece4d2', rough: 0.85, flag: SURF.CHART, at: [CHART_FACE_X - 0.0015, p.yc, p.zc] });
    // frameRing extrudes along +Z: turned so its depth runs along +X (out of the wall)
    b.add('small', frameRing(p.w + 2 * slip, p.h + 2 * slip, slip, 0.018), { color: '#cfc5b0', rough: 0.9, flag: SURF.LONG, at: [-11.17, p.yc, p.zc], rot: [0, Math.PI / 2, 0] });
    b.add('metal', frameRing(p.w + 2 * (slip + bar), p.h + 2 * (slip + bar), bar, 0.044), { color: C.bronzeDark, rough: 0.42, metal: 0.7, flag: SURF.LONG, at: [-11.18, p.yc, p.zc], rot: [0, Math.PI / 2, 0] });
  }
  dressing.push(DRESSING.CHART_WALL);
}

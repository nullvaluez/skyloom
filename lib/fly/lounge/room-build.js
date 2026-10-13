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
//
// Buckets: stone, wood, metal, leather, fabric, plaster, small (ceramics,
// paper, foliage, glass, rubber), emissive (unlit light sources).
import { CatmullRomCurve3, Vector3 } from 'three';
import {
  RoomBuilder, softBox, prism, slab, lathe, cylinder, torus, tube, taperTube, leaf, foliageCard,
  superellipse, roundedRect, frame, framePoint, rng,
} from './geometry-kit.js';
import {
  CANT, frontZ, SILL_Y, HEAD_Y, HALF_X, HEAD_Z, ROOF_Z1, SIDE_Z1, BACK_Z,
  MULLION_X, MULLION_HALF, MULLION_DEPTH, CORNER_HALF, SIDE_MULLION_Z, HEAD_DEPTH,
  FASCIA_DEPTH, FASCIA_DROP, DECK_Y, BAFFLE, SLOT_X, WINDOW_SEATS, SEAT_Z,
  HERO_TABLE, BOARDS, BOARD_Z, BAR, ENTRANCE,
} from './room-plan.js';

/** aSurf.w surface flags (room-shading.js reads the same numbers). */
export const SURF = Object.freeze({
  PLAIN: 0, TILES: 1, FLUTED: 2, PLANKS: 3, GRILLE: 4, LEAF: 5, PAPER: 6, LENS: 7,
  BACKLIT: 8, DECK: 9, FLUTED_FINE: 10, CERAMIC: 11, RUG: 12, BAFFLE: 13, LONG: 14, ART: 15, OPAL: 16,
});

/** Emissive channels: each fixture group dims on its own curve. */
export const GLOW = Object.freeze({ ALWAYS: 0, COVE: 1, SLOT: 2, PENDANT: 3, BAR: 4, ENTRANCE: 5, LAMP: 6, TABLE: 7 });

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

/** Build the room. Returns { buckets, practicals, shadows, floorAO, stats }. */
export function buildLoungeRoom() {
  const b = new RoomBuilder(431);
  const random = rng(97);
  const shadows = []; // { c:[x,y,z], h:[hx,hy,hz], rot, k (opacity) }
  const floorAO = []; // same shape, finer
  const practicals = []; // see room-shading.js PRACTICAL layout
  const box = (list, c, h, rot = 0, k = 1) => list.push({ c, h, rot, k });

  // =========================================================================
  // 1. HERO ZONE — our chair, the side table and what is on it. Built first:
  //    nearest geometry first in the index buffer lets early-Z reject more of
  //    the floor and walls behind it.
  // =========================================================================
  for (const seat of WINDOW_SEATS) {
    const m = frame([seat.x, 0, SEAT_Z], seat.rot);
    loungeChair(b, m, { leather: true, hero: seat.x === 0 });
    shadowChair(shadows, floorAO, seat.x, SEAT_Z, seat.rot);
    const tx = seat.x + (seat.x === 0 ? HERO_TABLE.x : 0.68), tz = seat.x === 0 ? HERO_TABLE.z : -0.62;
    sideTable(b, [tx, 0, tz], seat.x === 0 ? HERO_TABLE.top : 0.55, seat.x === 0 ? HERO_TABLE.r : 0.27);
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

  // =========================================================================
  // 3. MID LOUNGE — rug, sofa, two chairs and a travertine table (left);
  //    communal oak table under pendants (right); trees in planters.
  // =========================================================================
  midLounge(b, random, shadows, floorAO, practicals);

  // =========================================================================
  // 4. BAR, BOARDS, ENTRANCE.
  // =========================================================================
  bar(b, random, shadows, floorAO, practicals);
  boards(b, practicals);
  entrance(b, practicals);

  // =========================================================================
  // 5. THE SHELL — floor, walls, ceiling deck and baffles, skirting.
  //    Last in the buffer (the biggest surfaces, mostly covered).
  // =========================================================================
  ceiling(b, practicals);
  shell(b, floorAO);

  const buckets = b.build();
  let triangles = 0, vertices = 0;
  for (const g of Object.values(buckets)) { triangles += g.index.count / 3; vertices += g.attributes.position.count; }
  return { buckets, practicals, shadows, floorAO, stats: { triangles, vertices, parts: b.parts } };
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * A mid-century lounge chair: oak frame with broad flat arms, leather (or wool)
 * cushions, the back reclined 16 degrees. Local frame: floor centre, front -Z.
 */
function loungeChair(b, m, { leather = true, color = null, hero = false } = {}) {
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
  b.add(bucket, softBox({ w: 0.68, h: 0.12, d: 0.66, r: 0.045, seg: 3, div: hero ? 5 : 3, crown: 0.026, crownSide: 0.012 }), { ...cushion, at: [0, 0.335, -0.03], matrix: m });
  b.add(bucket, softBox({ w: 0.66, h: 0.52, d: 0.11, r: 0.045, seg: 3, div: hero ? 5 : 3, crown: 0.0, crownSide: 0.03 }), { ...cushion, at: [0, 0.67, 0.33], rot: [0.28, 0, 0], matrix: m });
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

/** Round pedestal side table: travertine top, bronze stem and foot. */
function sideTable(b, at, top, r = 0.27) {
  const [x, , z] = at;
  const t = 0.032;
  b.add('stone', lathe([[0, top - t], [r - 0.012, top - t], [r, top - t + 0.008], [r, top - 0.008], [r - 0.01, top], [0, top]], 40), { color: C.travertine, rough: 0.38, uv: { mode: 'plan', texScale: 1.2 }, at: [x, 0, z] });
  b.add('metal', cylinder(0.021, 0.024, top - t - 0.02, 16), { color: C.bronze, rough: 0.34, metal: 1, at: [x, (top - t - 0.02) / 2 + 0.018, z] });
  b.add('metal', lathe([[0, 0], [0.17, 0], [0.182, 0.006], [0.175, 0.016], [0.05, 0.022], [0, 0.022]], 32), { color: C.bronze, rough: 0.34, metal: 1, at: [x, 0, z] });
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
function tableLamp(b, practicals, x, y, z, tableR) {
  b.add('metal', lathe([[0, 0], [0.056, 0], [0.058, 0.003], [0.05, 0.009], [0.03, 0.02], [0.017, 0.04], [0.0105, 0.09], [0.0085, 0.2], [0.0085, 0.262], [0, 0.262]], 28), { color: '#b08d57', rough: 0.32, metal: 1, at: [x, y, z] });
  b.add('small', lathe([[0.112, 0.266], [0.117, 0.27], [0.113, 0.292], [0.098, 0.315], [0.073, 0.332], [0.04, 0.341], [0, 0.344]], 32), { color: '#f4efe6', rough: 0.35, flag: SURF.OPAL, at: [x, y, z] });
  b.add('emissive', lathe([[0, 0.334], [0.04, 0.331], [0.072, 0.321], [0.096, 0.304], [0.11, 0.28], [0.112, 0.266]], 32), { color: '#ffdcae', rough: GLOW.TABLE, at: [x, y, z] });
  practicals.push({ type: 'spot', p: [x, y + 0.3, z], d: [0, -1, 0], color: [1, 0.78, 0.52], power: 0.18, range: 3, cone: [-0.25, 0.45], group: GLOW.TABLE, disc: [y, tableR] });
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
function midLounge(b, random, shadows, floorAO, practicals) {
  // --- Left group on a bordered wool rug ---------------------------------
  const lx = -5.4, lz = 6.5;
  rug(b, [lx, lz], 3.4, 2.6, C.wool, C.woolDark);
  // Sofa facing the window: oak plinth, boucle cushions.
  sofa(b, frame([lx, 0, lz + 1.15], 0), C.boucle);
  shadows.push({ c: [lx, 0.33, lz + 1.15], h: [1.2, 0.33, 0.45], rot: 0, k: 1 });
  shadows.push({ c: [lx, 0.6, lz + 1.5], h: [1.15, 0.25, 0.12], rot: 0, k: 1 });
  floorAO.push({ c: [lx, 0.2, lz + 1.15], h: [1.18, 0.2, 0.44], rot: 0, k: 1 });
  // Two lounge chairs facing each other across a travertine table.
  for (const s of [-1, 1]) {
    const cx = lx + s * 1.55, rot = s < 0 ? -Math.PI / 2 : Math.PI / 2;
    loungeChair(b, frame([cx, 0, lz - 0.05], rot), { leather: false, color: C.olive });
    shadowChair(shadows, floorAO, cx, lz - 0.05, rot);
  }
  const top = superellipse(0.62, 0.38, 3.2, 56);
  b.add('stone', slab(top, 0.045, { edge: 0.012 }), { color: C.travertine, rough: 0.36, uv: { mode: 'plan', texScale: 1.2 }, at: [lx, 0.335, lz - 0.05] });
  b.add('stone', slab(superellipse(0.44, 0.22, 3.2, 40), 0.335), { color: C.travertineDark, rough: 0.5, uv: { texScale: 1.2, grain: 'y' }, at: [lx, 0, lz - 0.05] });
  shadows.push({ c: [lx, 0.19, lz - 0.05], h: [0.6, 0.19, 0.36], rot: 0, k: 1 });
  floorAO.push({ c: [lx, 0.17, lz - 0.05], h: [0.44, 0.17, 0.22], rot: 0, k: 1 });
  // A tray with a small vase on it.
  b.add('small', lathe([[0, 0], [0.05, 0], [0.058, 0.03], [0.05, 0.11], [0.022, 0.16], [0.02, 0.19], [0.016, 0.19], [0.0, 0.17]], 24), { color: '#2b3a3c', rough: 0.15, flag: SURF.CERAMIC, at: [lx + 0.18, 0.38, lz - 0.1] });
  b.add('small', softBox({ w: 0.24, h: 0.02, d: 0.17, r: 0.004, seg: 1, div: 1 }), { color: '#1e1e1f', rough: 0.5, at: [lx - 0.16, 0.39, lz - 0.02], rot: [0, 0.18, 0] });

  // --- Right: communal oak table under three pendants --------------------
  const rx = 5.4, rz = 6.6;
  rug(b, [rx, rz], 5.2, 2.9, '#7a6a5a', '#5a4c40');
  b.add('wood', slab(roundedRect(4.2, 1.1, 0.12, 5), 0.055, { edge: 0.01 }), { color: C.oak, rough: 0.5, flag: SURF.PLANKS, uv: { mode: 'plan', texScale: 1.4 }, at: [rx, 0.72, rz] });
  for (const s of [-1, 1]) {
    // bronze trestles: two legs and a foot per end
    for (const dz of [-0.36, 0.36]) b.add('metal', softBox({ w: 0.05, h: 0.71, d: 0.05, r: 0.008, seg: 1, div: 1 }), { color: C.bronze, rough: 0.34, metal: 1, at: [rx + s * 1.6, 0.36, rz + dz] });
    b.add('metal', softBox({ w: 0.06, h: 0.03, d: 0.95, r: 0.006, seg: 1, div: 1 }), { color: C.bronze, rough: 0.34, metal: 1, at: [rx + s * 1.6, 0.015, rz] });
    b.add('metal', softBox({ w: 0.05, h: 0.04, d: 0.8, r: 0.006, seg: 1, div: 1 }), { color: C.bronze, rough: 0.34, metal: 1, at: [rx + s * 1.6, 0.69, rz] });
  }
  shadows.push({ c: [rx, 0.745, rz], h: [2.1, 0.03, 0.55], rot: 0, k: 1 });
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
    oliveTree(b, random, s * 10.15, 3.15, 2.9);
    shadows.push({ c: [s * 10.15, 0.38, 3.15], h: [0.48, 0.38, 0.48], rot: 0, k: 1 });
    shadows.push({ c: [s * 10.15, 2.25, 3.15], h: [0.95, 0.75, 0.95], rot: 0, k: 0.55 });
    floorAO.push({ c: [s * 10.15, 0.36, 3.15], h: [0.47, 0.36, 0.47], rot: 0, k: 1 });
    figTree(b, random, s * 10.25, 13.25, 2.6);
    floorAO.push({ c: [s * 10.25, 0.36, 13.25], h: [0.47, 0.36, 0.47], rot: 0, k: 1 });
  }
  banquette(b, shadows, floorAO, practicals);
  artWall(b, practicals);
}

/**
 * Along the left wall: a long upholstered banquette under a reeded oak wall,
 * small travertine tables in front, brass sconces between.
 */
function banquette(b, shadows, floorAO, practicals) {
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
  floorAO.push({ c: [x + 0.32, 0.22, zc], h: [0.3, 0.22, len / 2], rot: 0, k: 1 });
  // small round tables
  for (const zz of [5.9, 8.6, 11.3]) {
    sideTable(b, [x + 1.05, 0, zz], 0.52, 0.3);
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
function artWall(b, practicals) {
  const x = HALF_X, zc = 7.2, w = 3.4, h = 1.9, y = 1.95;
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
function planter(b, x, z, pr = 0.47, ph = 0.72) {
  b.add('stone', lathe([[0, 0], [pr - 0.06, 0], [pr - 0.02, 0.03], [pr, 0.12], [pr, ph - 0.02], [pr - 0.012, ph], [pr - 0.05, ph], [pr - 0.05, ph - 0.06], [0, ph - 0.06]], 40), { color: C.travertineDark, rough: 0.5, uv: { mode: 'cyl', texScale: 1.2 }, at: [x, 0, z] });
  b.add('small', cylinder(pr - 0.05, pr - 0.05, 0.01, 30), { color: C.soil, rough: 1, at: [x, ph - 0.07, z] });
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
  const limbs = 4;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + random() * 0.8;
    const lr = 0.35 + random() * 0.3;
    const lend = [top[0] + Math.cos(a) * lr, top[1] + 0.45 + random() * 0.4, top[2] + Math.sin(a) * lr];
    const limb = curve([top, [(top[0] + lend[0]) / 2, (top[1] + lend[1]) / 2 + 0.05, (top[2] + lend[2]) / 2], lend]);
    b.add('wood', taperTube(limb, 6, 0.045, 0.022, 6), bark);
    for (let j = 0; j < 3; j++) {
      const a2 = a + (j - 1) * 0.7 + (random() - 0.5) * 0.4;
      const tr = 0.3 + random() * 0.35;
      const tend = [lend[0] + Math.cos(a2) * tr, lend[1] + 0.15 + random() * 0.45, lend[2] + Math.sin(a2) * tr];
      const twig = curve([lend, [(lend[0] + tend[0]) / 2, (lend[1] + tend[1]) / 2 + 0.06, (lend[2] + tend[2]) / 2], tend]);
      b.add('wood', taperTube(twig, 5, 0.02, 0.006, 5), bark);
      // Sprig cards around the twig, each pointing up and outward.
      const n = 13;
      for (let k = 0; k < n; k++) {
        const t = 0.15 + 0.85 * Math.sqrt(random());
        const p = twig.getPoint(t);
        const out = Math.atan2(p.z - z, p.x - x) + (random() - 0.5) * 1.6;
        const up = 0.35 + random() * 0.55; // radians from vertical
        const dir = [Math.sin(up) * Math.cos(out), Math.cos(up), Math.sin(up) * Math.sin(out)];
        const size = 0.3 + random() * 0.12;
        b.add('foliage', foliageCard(size, 0.35 + random() * 0.3), {
          color: '#ffffff', tint: 0.82 + random() * 0.3, rough: 0.55, flag: SURF.LEAF, uv: { mode: 'keep' },
          at: [p.x, p.y, p.z], rot: [Math.acos(dir[1]), Math.atan2(dir[0], dir[2]), random() * Math.PI * 2],
        });
      }
    }
  }
}

/** A multi-stem fiddle-leaf fig: tall stems, big glossy leaves up their length. */
function figTree(b, random, x, z, height) {
  const ph = 0.72;
  planter(b, x, z);
  const bark = { color: '#7a6a58', rough: 0.85, uv: { mode: 'cyl', texScale: 0.4 } };
  const stems = 4;
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + random() * 0.5;
    const spread = 0.12 + random() * 0.18;
    const h = height * (0.75 + random() * 0.3);
    const base = [x + Math.cos(a) * 0.08, ph - 0.06, z + Math.sin(a) * 0.08];
    const tip = [x + Math.cos(a) * spread * 2.4, ph + h, z + Math.sin(a) * spread * 2.4];
    const stem = curve([base, [x + Math.cos(a) * spread, ph + h * 0.45, z + Math.sin(a) * spread], tip]);
    b.add('wood', taperTube(stem, 10, 0.026, 0.01, 6), bark);
    const n = 20;
    for (let k = 0; k < n; k++) {
      const t = 0.35 + (k / n) * 0.65;
      const p = stem.getPoint(t);
      const yaw = a + k * 2.4 + (random() - 0.5) * 0.5;
      const pitch = -0.35 - random() * 0.6 + t * 0.3; // younger leaves stand up
      const len = 0.24 + random() * 0.14 - (1 - t) * 0.04;
      b.add('small', leaf(len, len * 0.7, { fold: 0.1, curl: 0.16, shape: 1, rows: 6 }), {
        color: random() < 0.3 ? '#3b5a2c' : '#2c4724', tint: 0.85 + random() * 0.3, rough: 0.34, flag: SURF.LEAF,
        at: [p.x, p.y, p.z], rot: [pitch, yaw, (random() - 0.5) * 0.4],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Bar, boards, entrance
// ---------------------------------------------------------------------------
function bar(b, random, shadows, floorAO, practicals) {
  const { x0, x1, front, back, top } = BAR;
  const w = x1 - x0, cx = (x0 + x1) / 2;
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

function boards(b, practicals) {
  // Bronze bezels; the screens themselves are the board mesh (lounge-board.js).
  for (const bd of BOARDS) {
    const { x, w, y0, h } = bd;
    const z = BOARD_Z;
    const frameW = 0.06;
    for (const [px, py, sx, sy] of [[x, y0 - frameW / 2, w + frameW * 2, frameW], [x, y0 + h + frameW / 2, w + frameW * 2, frameW], [x - w / 2 - frameW / 2, y0 + h / 2, frameW, h], [x + w / 2 + frameW / 2, y0 + h / 2, frameW, h]]) {
      b.add('metal', softBox({ w: sx, h: sy, d: 0.09, r: 0.008, seg: 1, div: 1 }), { color: C.blackMetal, rough: 0.35, metal: 1, at: [px, py, z + 0.025] });
    }
    b.add('metal', softBox({ w: w, h: h, d: 0.06, r: 0.004, seg: 1, div: 1 }), { color: '#0b0c0e', rough: 0.6, metal: 0.4, at: [x, y0 + h / 2, z + 0.04] });
    // The screen's spill onto the floor and ceiling in front of it.
    practicals.push({ type: 'spot', p: [x, y0 + h / 2, z - 0.3], d: [0, -0.1, -1], color: [0.72, 0.8, 1], power: 0.42, range: 7, cone: [-0.3, 0.5], group: GLOW.ALWAYS });
  }
}

function entrance(b, practicals) {
  const { z0, z1, h, depth } = ENTRANCE;
  const x = HALF_X, zc = (z0 + z1) / 2, wz = z1 - z0;
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
function ceiling(b, practicals) {
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
    b.add('emissive', cylinder(0.035, 0.035, 0.004, 16), { color: '#fff0d8', rough: GLOW.LAMP, at: [dx, DECK_Y - 0.03, dz] });
    practicals.push({ type: 'spot', p: [dx, DECK_Y - 0.05, dz], d: dz < 4 ? [0, -0.88, -0.48] : [0, -1, 0], color: [1, 0.8, 0.58], power: 2.6, range: 7, cone: [0.82, 0.96], group: GLOW.LAMP });
  }
  // Cove along the fascia's top-back, washing the deck behind it.
  b.add('emissive', softBox({ w: HALF_X * 2 - 0.2, h: 0.006, d: 0.02, r: 0.002, seg: 1, div: 1 }), { color: '#ffd7a8', rough: GLOW.COVE, at: [0, DECK_Y - 0.1, ROOF_Z1 + FASCIA_DEPTH + 0.02] });
  practicals.push({ type: 'line', a: [-HALF_X + 0.3, DECK_Y - 0.12, ROOF_Z1 + FASCIA_DEPTH + 0.05], b: [HALF_X - 0.3, DECK_Y - 0.12, ROOF_Z1 + FASCIA_DEPTH + 0.05], n: [0, 0.6, 0.8], color: [1, 0.76, 0.5], power: 0.5, range: 4, group: GLOW.COVE });
  // The dark deck the baffles hang from.
  b.add('plaster', softBox({ w: HALF_X * 2 + 0.4, h: 0.06, d: BACK_Z - ROOF_Z1 + 0.2, r: 0.004, seg: 1, div: 1 }), { color: C.deck, rough: 0.92, flag: SURF.DECK, at: [0, DECK_Y + 0.03, (ROOF_Z1 + BACK_Z) / 2] });
}

function shell(b, floorAO) {
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
  b.add('wood', softBox({ w: HALF_X * 2, h: HEAD_Y, d: 0.1, r: 0.004, seg: 1, div: 1 }), { color: C.oakSmoked, rough: 0.55, flag: SURF.FLUTED_FINE, uv: { texScale: 1.4, grain: 'y' }, at: [0, HEAD_Y / 2, BACK_Z + 0.05] });
  floorAO.push({ c: [0, 2.3, BACK_Z + 0.2], h: [HALF_X, 2.3, 0.2], rot: 0, k: 1 });
  // Front kick under the glazing (seen from inside as the sill's riser).
  floorAO.push({ c: [0, 0.07, frontZ(0) - 0.05], h: [HALF_X, 0.07, 0.06], rot: 0, k: 1 });
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

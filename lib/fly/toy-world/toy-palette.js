/**
 * THE Toy World palette — every color in the toy world imports from this
 * module; nothing else may define colors. Pure JS (no three import) so the
 * vector-tile worker shares it byte-for-byte.
 *
 * Direction (FLY_GLOBE_REWORK §1.4 + user review 2026-07-16 evening): the
 * first dark-neon pass used synthwave cyan/magenta and the user rejected
 * the "retro colors" (they also clashed with the red player jet). This is
 * the airloom-neutral read instead: INK + ICE — a near-black ink-navy
 * globe, streets in silver→ice-white grades, pale glowing shorelines. The
 * altitude tracers and the red plane are the only saturated things on
 * screen. Glowing values sit ABOVE the toy bloom threshold
 * (TOY.bloomThreshold ≈ 0.52 luminance); the ground family stays far
 * below it. The user tunes these values — treat them as theirs.
 */

export const PALETTE = {
  // Ground family: near-black ink navy. groundBase is also the solid
  // raster tile that replaces satellite imagery in toy style.
  groundBase: '#101322',
  groundResidential: '#131629', // subtle block-pattern variation
  groundIndustrial: '#0f1526',
  sand: '#1b1f36',

  // Vegetation — muted dark greens/slates; quiet, the grid owns the frame
  grass: '#12231f',
  grassCones: ['#1c3b34', '#173239', '#204137', '#122c2e'],
  park: '#102221',
  wood: '#0d1b1a',
  treeFoliage: ['#232c4e', '#2a3560', '#1d2542', '#303c6e'],

  // Water: dark ink-teal, PALE ICE foam — the glowing coastline stroke
  water: '#0a2333',
  waterFoam: '#cfeef8',

  // Roads: silver→ice grades by class — arteries glow white, back streets
  // just glimmer. No hue: color belongs to the tracers and the plane.
  roadMinor: '#3a4a63',
  roadMid: '#6b7f9c',
  roadMajor: '#aec4dd',
  roadMotorway: '#eef5ff', // bright ice arteries
  runway: '#e3f2ff', // airports pop

  // Buildings — dark slate bodies (hash rotation), near-black base AO,
  // soft slate-glow tops (walls interpolate base→top = lit-from-above)
  buildings: ['#1b2036', '#1f2440', '#171b2e', '#232946', '#1d2239', '#191e33'],
  buildingShade: '#080a14',
  // Round 7: brightened — the old #41507a tops rendered near-black from
  // above (invisible until the 360° camera let you look straight down;
  // "we do not have any roofs" — user, live review). Round 8 fix (F5):
  // lifted again to a mid slate — under the moonlit toon ramp #55679c caps
  // measured luma 26-28 at 3,500ft (black-on-black vs the ground; user
  // live-review screenshots roof-3500/roof-1100). Desaturated — ICE family.
  buildingTop: '#93a5d6',

  // Round 8 (P2) roof detail colors. Gable roofs: mid-slate hash-rotation
  // (F5 lift — the old #1a1f36-family gables were invisible in suburbs).
  // HVAC clutter: a step darker than the caps so it reads as clutter.
  // Crowns / spire tips are EMISSIVE (the fragment multiplies them ×emit) so
  // they must sit bright — warm/ice accents that clear the toy bloom band.
  roofGable: ['#525e88', '#485379', '#5c6894', '#434e72'],
  roofHvac: '#2e3550',
  crownColors: ['#ffcf8a', '#bcd2ff', '#8fe0ff', '#ffe0a0'],
  spireTip: '#eaf3ff', // emissive antenna tip (bright ice — beacon company)

  // Round 7 "Electric Night City": the world finally EMITS light. Warm
  // amber windows with a cooler minority accent (hash-picked per building),
  // ice parapet glow, warm-white runway edge lights, distant town glow.
  // These are the round-7 review headliners — tune freely.
  windowWarm: '#ffb46b', // majority window temperature (sodium warmth)
  windowCool: '#bcd2ff', // minority accent (office-tower fluorescent)
  windowEdge: '#dce8ff', // parapet edge glow — ice family, NOT cyan
  runwayLight: '#fff3d8', // warm-white edge lights (thresholds included)
  townGlow: '#43549a', // horizon glow-domes (skyHorizon family, lifted)

  // Round 8 (P5) landmark monuments: slate bodies a step lighter than the
  // building family (a monument must read AGAINST the skyline), a mid trim,
  // and EMISSIVE accent values — the landmarks-3d builders bake these ×boost
  // into the vertex colors so torches/crowns/tips clear TOY.bloomThreshold.
  // Round 8 fix round: whole family lifted ~2 steps — the original values
  // rendered a 126m statue invisible at 2km under the moonlit toon ramp
  // (monuments-01-statue.png: pure night, no monument read at all).
  monumentBody: '#5a68a0', // floodlit-slate read at 2km, not neon
  monumentTrim: '#8a9ac8',
  monumentDark: '#2b3358', // recessed faces / gatehouses / cable ribbons
  monumentAccent: '#ffd98f', // warm emissive (torches, crown bands) — crown family
  monumentCool: '#bfe0ff', // ice emissive (spire tips, arch keystones)
  monumentHalo: '#6a7ada', // additive ground halo under hero monuments

  // Props / accents (confetti burst, prop tints)
  propWhite: '#cdd6ea',
  accentPink: '#ff5ec4',
  accentYellow: '#ffd84d',

  // Atmosphere: deep ink void (airloom) — cool horizon glow, black zenith.
  // Round 8 (P4): a mid-stop (skyMid) enriches the upper gradient into a
  // three-stop night band, and the zenith deepens toward true black so the
  // moonlit city, stars and haze read against it. Taste knobs — user-owned.
  skyHorizon: '#2e3a6e',
  skyMid: '#1a2350', // three-stop mid band (SkyDome midColor, toy only)
  skyZenith: '#05070f', // deepened (was #070a14)
  fog: '#1a2246', // keep in sync with TOY.fogColor (= TOY.haze.color, round 8 fix)
  voidFloor: '#04060d',
  voidGrid: '#3d4a75',
  shadowTint: '#10142a',
};

/**
 * '#rrggbb' → [r, g, b] LINEAR floats 0..1. three treats vertex-color
 * attributes as linear-space; baking the sRGB→linear transform here keeps
 * the rendered hues faithful to the palette values above.
 */
export function hexToRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)];
}

/** Small stable per-feature hash → palette array pick (deterministic). */
export function pickByHash(arr, id) {
  let h = id >>> 0;
  h = (h ^ (h >> 16)) * 0x45d9f3b;
  h = (h ^ (h >> 16)) >>> 0;
  return arr[h % arr.length];
}

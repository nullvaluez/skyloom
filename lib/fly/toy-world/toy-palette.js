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
  buildingTop: '#41507a',

  // Props / accents (confetti burst, prop tints)
  propWhite: '#cdd6ea',
  accentPink: '#ff5ec4',
  accentYellow: '#ffd84d',

  // Atmosphere: deep ink void (airloom) — cool horizon glow, black zenith
  skyHorizon: '#2e3a6e',
  skyZenith: '#070a14',
  fog: '#131832', // keep in sync with TOY.fogColor
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

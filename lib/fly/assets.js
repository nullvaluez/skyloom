/**
 * THE single manifest for every third-party Fly-mode asset. The credits UI
 * (components/fly/hud/CreditsPanel.jsx) and CREDITS.md (regenerate with
 * `node scripts/gen-credits.mjs`) both render from this file so they can't
 * diverge. CC-BY entries are a HARD licensing requirement — never ship one
 * without it appearing here.
 *
 * The traffic archetypes currently use primitive-built geometry
 * (lib/fly/traffic-geometries.js, first-party). When the CC-BY GLB pass
 * lands (FLY_MODE_HANDOFF.md §5.4.4), each model joins this manifest with
 * its license/author/url/modifications and a `model` + archetype mapping.
 */

export const FLY_ASSETS = [
  {
    kind: 'font',
    name: 'Archivo Black',
    file: 'public/fonts/ArchivoBlack-Regular.ttf',
    author: 'Omnibus-Type',
    source: 'Google Fonts',
    url: 'https://fonts.google.com/specimen/Archivo+Black',
    license: 'OFL 1.1',
    modifications: 'none (3D POI letters in the world + the inspect-card display face)',
  },
  {
    kind: 'font',
    name: 'Chango',
    file: 'public/fonts/Chango-Regular.ttf',
    author: 'Eduardo Tunni',
    source: 'Google Fonts',
    url: 'https://fonts.google.com/specimen/Chango',
    license: 'OFL 1.1',
    modifications: 'none (game UI headings — inspect modal)',
  },
  {
    kind: 'font',
    name: 'Patrick Hand',
    file: 'public/fonts/PatrickHand-Regular.ttf',
    author: 'Patrick Wagesreiter',
    source: 'Google Fonts',
    url: 'https://fonts.google.com/specimen/Patrick+Hand',
    license: 'OFL 1.1',
    modifications: 'none (Toy World handwritten UI)',
  },
  {
    kind: 'model',
    name: 'Airplane (narrowbody airliner)',
    file: 'public/models/traffic-airliner.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/a3XrQkLNna9',
    license: 'CC-BY 3.0',
    modifications: 'geometry merged + vertex colors baked at load; rescaled to real meters',
  },
  {
    kind: 'model',
    name: 'Jet (business jet)',
    file: 'public/models/traffic-jet.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/bgUY8zN2Bq9',
    license: 'CC-BY 3.0',
    modifications: 'geometry merged + vertex colors baked at load; rescaled to real meters',
  },
  {
    kind: 'model',
    name: 'Jet (military)',
    file: 'public/models/traffic-military.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/dukcCKsLDrS',
    license: 'CC-BY 3.0',
    modifications: 'geometry merged + vertex colors baked at load; rescaled to real meters',
  },
  {
    kind: 'model',
    name: 'Boeing 747',
    file: 'public/models/traffic-cargo.glb',
    author: 'Miha Lunar',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/49CLof4tP2V',
    license: 'CC-BY 3.0',
    modifications: 'geometry merged + vertex colors baked at load; rescaled to real meters',
  },
  {
    kind: 'model',
    name: 'Small Airplane',
    file: 'public/models/traffic-prop.glb',
    author: 'Vojtěch Balák',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/7cvx6ex-xfL',
    license: 'CC-BY 3.0',
    modifications: 'geometry merged + vertex colors baked at load; rescaled to real meters; also reused (retinted) for the glider archetype',
  },
  {
    kind: 'model',
    name: 'Helicopter',
    file: 'public/models/traffic-helicopter.glb',
    author: 'Zsky',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/hG2Qr0A3zR',
    license: 'CC-BY 3.0',
    modifications: 'geometry merged + vertex colors baked at load; rescaled to real meters',
  },
  {
    kind: 'model',
    name: 'Jet (player aircraft)',
    file: 'public/models/player-jet.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/3B3Pa6BHXn1',
    license: 'CC-BY 3.0',
    modifications: 'reoriented + rescaled at load',
  },
  {
    kind: 'hdri',
    name: 'Kloofendal 48d Partly Cloudy (Pure Sky)',
    file: 'public/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    author: 'Greg Zaal',
    source: 'Poly Haven',
    url: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky',
    license: 'CC0',
    modifications: 'none (2K .hdr as published)',
  },
  {
    kind: 'texture',
    name: 'Clouds with Transparency',
    file: 'public/textures/cloud.png',
    author: 'WickedInsignia',
    source: 'OpenGameArt',
    url: 'https://opengameart.org/content/clouds-with-transparency',
    license: 'CC0',
    modifications: 'downscaled to 512px; RGB flattened to white (alpha carries the shape)',
  },
  {
    kind: 'data',
    name: 'World coastlines (1:110m)',
    file: 'public/atlas/coastlines.bin',
    author: 'Natural Earth',
    source: 'naturalearthdata.com',
    url: 'https://www.naturalearthdata.com/downloads/110m-physical-vectors/',
    license: 'Public Domain',
    modifications: 'simplified + packed to a binary polyline blob (scripts/gen-atlas-map.mjs) for the Atlas map',
  },
];

// Tile/data attributions live in ./tile-sources (TERRAIN_ATTRIBUTIONS — the
// ONLY place providers are defined); the credits panel imports them from
// there directly. Not re-exported here so scripts/gen-credits.mjs can load
// this manifest in plain node without pulling in three-tile.

/**
 * Traffic archetype → GLB mapping, indexed in the worker contract order:
 * airliner, jet, prop, helicopter, military, cargo, glider, drone, unknown.
 * `null` keeps the primitive-built geometry (drone/unknown read better as
 * abstract shapes). targetLenM = real nose-to-tail meters the merged
 * geometry is scaled to (display scale still applies at render).
 * yawFixRad overrides the loader's tail-detection heuristic when needed.
 */
// yawFixRad is ABSOLUTE and set for every model from measured ground truth
// (scripts/inspect-glb.mjs prints each GLB's end-slab profile: the tapered
// end is the nose — except helicopters, whose thin end is the tail boom).
// Convention: nose must face -Z; models natively facing +Z get π.
export const TRAFFIC_MODELS = [
  { url: '/models/traffic-airliner.glb', targetLenM: 38, yawFixRad: Math.PI }, // airliner
  { url: '/models/traffic-jet.glb', targetLenM: 20, yawFixRad: Math.PI }, // jet
  { url: '/models/traffic-prop.glb', targetLenM: 9, yawFixRad: 0 }, // prop
  { url: '/models/traffic-helicopter.glb', targetLenM: 16, yawFixRad: 0 }, // helicopter
  { url: '/models/traffic-military.glb', targetLenM: 17, yawFixRad: Math.PI }, // military
  { url: '/models/traffic-cargo.glb', targetLenM: 70, yawFixRad: 0 }, // cargo (747)
  { url: '/models/traffic-prop.glb', targetLenM: 9, yawFixRad: 0 }, // glider (reuse)
  null, // drone — primitive quad reads better
  null, // unknown — abstract primitive stays
];

export const PLAYER_MODEL = { url: '/models/player-jet.glb', targetLenM: 20, yawFixRad: Math.PI };

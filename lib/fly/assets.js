/**
 * THE single manifest for every third-party Fly-mode asset. The credits UI
 * (components/fly/hud/CreditsPanel.jsx) and CREDITS.md (regenerate with
 * `node scripts/gen-credits.mjs`) both render from this file so they can't
 * diverge. CC-BY entries are a HARD licensing requirement — never ship one
 * without it appearing here.
 *
 * Nine of the thirteen traffic archetypes are GLB-backed (TRAFFIC_MODELS
 * below); the rest keep the first-party primitive geometry in
 * lib/fly/traffic-geometries.js, which since round 15 carries its own baked
 * livery. Round 15 also introduced OFFLINE model surgery for several
 * entries (texture → per-vertex COLOR_0, axis/attitude normalisation): the
 * runtime bake in model-loader.js reads material color FACTORS, so a
 * textured GLB renders as a flat white hull unless its texture is baked to
 * COLOR_0 first. Every such edit is spelled out in `modifications` — CC-BY
 * requires the change to be stated, and the next agent needs to know the
 * file on disk is not byte-identical to the published download.
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
    name: 'Airplane (widebody airliner, 787-8)',
    file: 'public/models/traffic-airliner.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/fzIXe2paBN9',
    license: 'CC-BY 3.0',
    modifications:
      'geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)',
  },
  {
    kind: 'model',
    name: 'Airplane (regional/business jet)',
    file: 'public/models/traffic-jet.glb',
    author: 'jeremy',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/9Ev6pklkSYp',
    license: 'CC-BY 3.0',
    modifications:
      'geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)',
  },
  {
    kind: 'model',
    name: 'Jet (military)',
    file: 'public/models/traffic-military.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/dukcCKsLDrS',
    license: 'CC-BY 3.0',
    modifications:
      "round 15: the author's base-color texture is baked to per-vertex COLOR_0 offline and the PNG dropped (the runtime bake reads material color factors only, so the textured hull shipped FLAT WHITE from round 8 to round 14) — same triangles, adaptive-subdivided only where the texture varies; geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)",
  },
  {
    kind: 'model',
    name: 'Boeing 747',
    file: 'public/models/traffic-cargo.glb',
    author: 'Miha Lunar',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/49CLof4tP2V',
    license: 'CC-BY 3.0',
    modifications:
      'round 15: LEVELLED offline — the published file bakes the aircraft into a 25.9° nose-up/banked attitude with a further 17.9° yaw, and the loader only corrects yaw, so every cargo 747 flew permanently crabbed and nose-high (its scaled bbox was 69 × 46 × 70m; it is now 63 × 16 × 70m against a real 747 64.4 × 19.4 × 70.7m). Vertices rotated only — same 1904 triangles, material colors baked to COLOR_0; geometry merged at load; rescaled to real meters; nav-light octahedra appended (round 8)',
  },
  {
    kind: 'model',
    name: 'Small Airplane',
    file: 'public/models/traffic-prop.glb',
    author: 'Vojtěch Balák',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/7cvx6ex-xfL',
    license: 'CC-BY 3.0',
    modifications:
      'geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)',
  },
  {
    kind: 'model',
    name: 'Airplane (sailplane / motor glider)',
    file: 'public/models/traffic-glider.glb',
    author: 'Poly by Google',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/4zE4UQ4siZa',
    license: 'CC-BY 3.0',
    modifications:
      'round 15: Z-up source re-axised to the +Y-up rig convention and its three material colors baked to per-vertex COLOR_0 offline (no geometry edits) — the glider archetype no longer reuses the Cessna prop model; geometry merged at load; rescaled to real meters; nav-light octahedra appended',
  },
  {
    kind: 'model',
    name: 'Aeroplane (low-wing piston fighter — warbird prop)',
    file: 'public/models/traffic-warbird-prop.glb',
    author: 'Gilang Romadhan',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/9VeIc0cybp4',
    license: 'CC-BY 3.0',
    modifications:
      "round 15: the author's base-color texture (green + yellow bands, dark canopy) is baked to per-vertex COLOR_0 offline and the PNG dropped, with adaptive subdivision only where the texture varies (590 → 1157 tris); no silhouette edits; geometry merged at load; rescaled to real meters; nav-light octahedra appended",
  },
  {
    kind: 'model',
    name: 'Helicopter',
    file: 'public/models/traffic-helicopter.glb',
    author: 'Zsky',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/hG2Qr0A3zR',
    license: 'CC-BY 3.0',
    modifications:
      'geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)',
  },
  {
    kind: 'model',
    name: 'Low poly Fighter (warbird jet)',
    file: 'public/models/traffic-warbird-jet.glb',
    author: 'Stephen Graybill',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/1fi8ZIDdFCP',
    license: 'CC-BY 3.0',
    modifications:
      'round 14: downloaded as published. Round 15: its ONE white material meant the hull rendered flat white, so a natural-metal livery (aluminium upper / darker belly, red nose ring + fin band) is baked to per-vertex COLOR_0 offline — no geometry edits, 124 tris unchanged; geometry merged at load; rescaled to real meters; nav-light octahedra appended — warbird-jet archetype',
  },
  {
    kind: 'model',
    name: 'Jet (player aircraft, fighter)',
    file: 'public/models/player-jet.glb',
    author: 'jeremy',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/6fyLMORhgGK',
    license: 'CC-BY 3.0',
    modifications:
      'reoriented + rescaled at load; on the mounted clone: canopy swapped glossy (round 8), all hull materials regraded to clearcoat MeshPhysical + a per-style fresnel rim, additive nav/strobe lights, throttle afterburner cone (round 13) — GLB on disk untouched',
  },
  {
    kind: 'hdri',
    name: 'Kloofendal 48d Partly Cloudy (Pure Sky)',
    file: 'public/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    author: 'Greg Zaal',
    source: 'Poly Haven',
    url: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky',
    license: 'CC0',
    modifications: 'none (2K .hdr as published) — satellite daytime sky',
  },
  {
    kind: 'hdri',
    name: 'Qwantani Dawn (Pure Sky)',
    file: 'public/hdri/qwantani_dawn_puresky_1k.hdr',
    author: 'Jarod Guest, Sergej Majboroda',
    source: 'Poly Haven',
    url: 'https://polyhaven.com/a/qwantani_dawn_puresky',
    license: 'CC0',
    modifications: 'none (1K .hdr as published) — round 13: satellite dawn sky (time-of-day swap)',
  },
  {
    kind: 'hdri',
    name: 'Qwantani Dusk 1 (Pure Sky)',
    file: 'public/hdri/qwantani_dusk_1_puresky_1k.hdr',
    author: 'Jarod Guest, Sergej Majboroda',
    source: 'Poly Haven',
    url: 'https://polyhaven.com/a/qwantani_dusk_1_puresky',
    license: 'CC0',
    modifications: 'none (1K .hdr as published) — round 13: satellite dusk sky (time-of-day swap)',
  },
  {
    kind: 'hdri',
    name: 'Qwantani Night (Pure Sky)',
    file: 'public/hdri/qwantani_night_puresky_1k.hdr',
    author: 'Jarod Guest, Sergej Majboroda',
    source: 'Poly Haven',
    url: 'https://polyhaven.com/a/qwantani_night_puresky',
    license: 'CC0',
    modifications: 'none (1K .hdr as published) — round 13: satellite night sky (first real night since R7)',
  },
  {
    kind: 'texture',
    name: 'Clouds with Transparency',
    file: 'public/textures/cloud.png',
    author: 'WickedInsignia',
    source: 'OpenGameArt',
    url: 'https://opengameart.org/content/clouds-with-transparency',
    license: 'CC0',
    modifications: 'downscaled to 512px; RGB flattened to white (alpha carries the shape) — toy/night cloud puff',
  },
  {
    kind: 'texture',
    name: 'Particle Pack — soft cumulus puff (smoke_08)',
    file: 'public/textures/cloud-cumulus.png',
    author: 'Kenney Vleugels (Kenney.nl)',
    source: 'Kenney',
    url: 'https://kenney.nl/assets/particle-pack',
    license: 'CC0',
    modifications: 'round 13: smoke_08 resized to 512px; RGB flattened to white (alpha carries the shape) — satellite cumulus deck',
  },
  {
    kind: 'texture',
    name: 'Toon cumulus puff',
    file: 'public/textures/cloud-toon.png',
    author: 'SkyTracker (self-made)',
    source: 'first-party (scripts/gen-toon-cloud.mjs)',
    url: null,
    license: 'CC0',
    modifications: 'round 13 P5: procedurally generated 512px 2–3-step toon cumulus silhouette (white RGB, alpha shape) — toy cloud deck',
  },
  {
    kind: 'texture',
    name: 'Water normals',
    file: 'public/textures/waternormals.jpg',
    author: 'three.js authors (mrdoob et al.)',
    source: 'three.js (examples/textures)',
    url: 'https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg',
    license: 'MIT',
    modifications: 'round 13: downscaled to 512px — satellite water-glint normal map (specular sparkle)',
  },
  {
    kind: 'data',
    name: 'Current weather (open-meteo)',
    file: 'app/api/weather/route.js (live proxy — nothing is bundled)',
    author: 'Open-Meteo',
    source: 'open-meteo.com',
    url: 'https://open-meteo.com/',
    license: 'CC-BY 4.0',
    modifications:
      "round 16: the keyless free-tier `v1/forecast` current block (cloud cover, wind, visibility, precipitation, temperature) proxied through /api/weather, snapped to a 0.25° cell and normalized — it drives the live cloud deck, the overcast/fog atmosphere and the precipitation layer. CC-BY REQUIRES this credit. (The route's failover source, aviationweather.gov METAR, is US Government work in the public domain and needs none.)",
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
 * airliner, jet, prop, helicopter, military, cargo, glider, drone, unknown,
 * warbird-prop, warbird-jet, warbird-heavy, classic-transport (13 total;
 * round 14 appended indices 9–12).
 * `null` keeps the primitive-built geometry — which since round 15 carries a
 * BAKED LIVERY, so a null slot (or a failed load) is a finished look, not a
 * flat blob (drone/unknown read better as abstract shapes; warbird-heavy and
 * classic-transport still have no license-clean era-correct GLB anywhere —
 * the round-15 scout re-checked poly.pizza, Quaternius, Kenney and
 * OpenGameArt — so those two primitives ARE the shipped models).
 * targetLenM = real nose-to-tail meters the merged geometry is scaled to
 * (display scale still applies at render). yawFixRad overrides the loader's
 * tail-detection heuristic when needed.
 */
// yawFixRad is ABSOLUTE and set for every model from measured ground truth
// (scripts/inspect-glb.mjs prints each GLB's end-slab profile: the tapered
// end is the nose — except helicopters, whose thin end is the tail boom).
// Convention: nose must face -Z; models natively facing +Z get π.
// Round 8 fleet: airliner = widebody 787-8 (gear-up cruise config, nose +Z
// raw → π), jet = jeremy's regional/business jet (fuselage on X, nose +X →
// π/2 maps +X onto -Z), player = jeremy's fighter (nose +Z raw → π).
export const TRAFFIC_MODELS = [
  { url: '/models/traffic-airliner.glb', targetLenM: 57, yawFixRad: Math.PI }, // airliner (787-8)
  { url: '/models/traffic-jet.glb', targetLenM: 20, yawFixRad: Math.PI / 2 }, // jet
  { url: '/models/traffic-prop.glb', targetLenM: 9, yawFixRad: 0 }, // prop
  { url: '/models/traffic-helicopter.glb', targetLenM: 16, yawFixRad: 0 }, // helicopter
  { url: '/models/traffic-military.glb', targetLenM: 17, yawFixRad: Math.PI }, // military
  // Round 15: the 747 was LEVELLED on disk (it shipped baked into a 26°
  // nose-up/banked, 18°-yawed attitude — see its FLY_ASSETS modifications), so
  // it is now natively nose -Z / length on Z and yawFixRad stays 0.
  { url: '/models/traffic-cargo.glb', targetLenM: 70, yawFixRad: 0 }, // cargo (747)
  // Round 15: a real sailplane instead of a retinted Cessna. Measured nose +Z
  // (the source is Z-up; the offline re-axis put length on Z, tail at -Z) → π.
  // 8m fuselage ⇒ ~15m span, the standard club-class planform.
  { url: '/models/traffic-glider.glb', targetLenM: 8, yawFixRad: Math.PI }, // glider
  null, // drone — primitive quad reads better
  null, // unknown — abstract primitive stays
  // Round 14 warbird/classic archetypes (indices 9–12):
  // Round 15: warbird-prop got a real low-wing piston fighter. Measured nose
  // +Z (prop/spinner end) → π. 10m fuselage ⇒ ~12m span (P-51 is 9.8 × 11.3).
  { url: '/models/traffic-warbird-prop.glb', targetLenM: 10, yawFixRad: Math.PI }, // warbird-prop
  // warbird-jet — Graybill delta fighter; measured nose +Z (end-slab -Z 0.63
  // tail / +Z 0.13 nose) → yawFixRad = π maps +Z onto the -Z convention.
  { url: '/models/traffic-warbird-jet.glb', targetLenM: 12, yawFixRad: Math.PI }, // warbird-jet
  null, // warbird-heavy — purpose-built primitive (4-engine heavy, olive-drab livery)
  null, // classic-transport — purpose-built primitive (DC-3 planform, bare-metal livery)
];

// canopyMaterial: the hero GLB's canopy material name (materials are named
// by hex color, so the generic /canopy|glass|cockpit/i match can't see it) —
// PlayerPlane swaps it for a glossy physical material on the mounted CLONE.
export const PLAYER_MODEL = {
  url: '/models/player-jet.glb',
  targetLenM: 20,
  yawFixRad: Math.PI,
  canopyMaterial: '80DEEA',
};

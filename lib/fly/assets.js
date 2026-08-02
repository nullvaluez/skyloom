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
  // --- Round 20 (C ICONS): MARQUEE MONUMENT models -------------------------
  // Registered `file:`-only ON PURPOSE. verify-fleet derives the mapped traffic
  // archetype count by counting this file's runtime url literals that point
  // into the models folder, and verify-hangar pins that count at 10 — a
  // monument that added one would move both gates. (This comment is itself
  // written the long way round for the same reason: the gate regex is a plain
  // text match, so even naming the pattern here would break it.) The runtime
  // mapping lives in lib/fly/monument-models.js — the round-17
  // player-aircraft precedent.
  //
  // EVERY one was processed offline by scripts/r20-monument-bake.mjs, which is
  // why every `modifications` string below shares a stem: the app's loader is a
  // bare GLTFLoader with no draco/meshopt/KTX2 decoder, and its bake reads only
  // material colour factors × COLOR_0 — a textured GLB renders FLAT WHITE (the
  // round-15 traffic-military trap). So each model is flattened to one
  // node/mesh/primitive, its albedo resolved PER VERTEX into COLOR_0 (texture
  // sampled at each vertex UV, sRGB → linear), all textures/UVs/extensions
  // dropped, vertices welded on the exact attribute triple, and the result
  // re-axised to the monument convention (+Y up, base plane y = 0, origin at
  // the footprint centre, real proportions kept — the runtime scales by HEIGHT).
  {
    kind: 'model',
    name: 'Empire State Building (marquee monument)',
    file: 'public/models/monument-empire-state.glb',
    author: 'Thomas de Rivaz',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/ea0Q8qnyLCF',
    license: 'CC-BY 3.0',
    modifications:
      'round 20: offline monument bake (see the block header) — 400 tris unchanged, 758 → 242 verts after the weld, 13KB → 10KB; no silhouette edits',
  },
  {
    kind: 'model',
    name: 'Lady Liberty (marquee monument — Statue of Liberty)',
    file: 'public/models/monument-liberty.glb',
    author: 'Anna M',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/ef9Yd09Doxh',
    license: 'CC-BY 3.0',
    modifications:
      'round 20: offline monument bake (see the block header) — 2458 tris unchanged, 6214 → 1277 verts after the weld, 90KB → 49KB. The source verdigris (#009789) and gold flame survive into COLOR_0; the toy grade keeps that hue at palette value',
  },
  {
    kind: 'model',
    name: 'Taj Mahal (marquee monument)',
    file: 'public/models/monument-taj-mahal.glb',
    author: 'Enter Inventive Studio',
    source: 'Google Poly archive, via Icosa Gallery',
    url: 'https://icosa.gallery/view/ajc6GfQ7_d_',
    license: 'CC-BY 3.0',
    modifications:
      "round 20: DECIMATED then baked. The source is 542,709 tris / 9.98 MB, but it is one welded shell with a single flat material and no textures or UVs, so `gltf-transform weld` + `simplify --ratio 0.011 --error 0.02` collapses it essentially losslessly to 5,890 tris / 143 KB with the bulbous dome, the four DETACHED minarets, the chattris and the plinth all intact. Then the offline monument bake (see the block header). Downloaded from the GLTF2 format root Icosa's own asset API publishes for this id (a web.archive.org mirror of the retired poly.googleusercontent.com CDN), verified as glTF v2 by magic bytes — the archive will serve an HTML error page behind a 200",
  },
  {
    kind: 'model',
    name: 'Sydney Opera House (marquee monument)',
    file: 'public/models/monument-opera-house.glb',
    author: 'Nick Reinhardt',
    source: 'Sketchfab → Google Poly archive, via Icosa Gallery',
    url: 'https://icosa.gallery/view/1viSkN0IJ-6',
    license: 'CC-BY 4.0',
    modifications:
      "round 20: PROVENANCE FIRST — the aggregator and the file DISAGREE, and the file wins. Icosa's asset API reports authorName 'Jaideep Prasad' (the uploader) and CREATIVE_COMMONS_BY v3.0; the GLB's own `asset.extras`, written by Sketchfab's exporter, names author 'Nick Reinhardt (https://sketchfab.com/Nickardiamond)', license 'CC-BY-4.0' and the original Sketchfab URL, and his page states CC Attribution with 62.4k triangles, matching the archived file's 62,420 exactly. Both readings are CC-BY, so redistribution is permitted either way; crediting the ACTUAL author under the version the asset itself declares satisfies both, and that is what the author/license fields above do. This is a chain STATED in the asset and corroborated at the author's own page — the clean inverse of the One World Trade candidate this round rejected, whose author had to be INFERRED from a triangle-count match. Then: two 4-vertex planes dropped (a water quad that inflated the footprint 1.5x and a backdrop quad that inflated the height 3.6x — with both gone the model measures 2.795 wide : 1 tall against the real building's 183/65 = 2.815); the shell and podium materials recoloured to the real Swedish-tile white and Tarana granite before baking, because the source texture's baked shading resolved to a muddy mauve and the WHITE SHELL is the identity; then the offline monument bake (see the block header) and `simplify --ratio 0.10 --error 0.012`, 62,420 → 6,217 tris / 212 KB. Downloaded from Icosa's published GLTF2 format root (a web.archive.org mirror), verified as glTF v2 by magic bytes",
  },
  {
    kind: 'model',
    name: 'Colosseum (marquee monument)',
    file: 'public/models/monument-colosseum.glb',
    author: 'CreativeTrio',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/83ftBPyiSf',
    license: 'CC0',
    modifications:
      'round 20: offline monument bake (see the block header) — 6835 tris unchanged, 20418 → 13893 verts after the weld, 713KB → 408KB. Its footprint aspect (5.0 wide : 1 tall) is much nearer the real amphitheatre (3.9) than the alternative that was first considered',
  },
  {
    kind: 'model',
    name: 'BigBen (marquee monument — the Elizabeth Tower)',
    file: 'public/models/monument-big-ben.glb',
    author: 'Daqian Dong',
    source: 'poly.pizza',
    url: 'https://poly.pizza/m/8PaQZ_nLFIQ',
    license: 'CC-BY 3.0',
    modifications:
      'round 20: offline monument bake (see the block header) — 8754 tris unchanged (the most detailed model in the marquee set; its gothic tracery is what makes the tower read), 13866 → 12314 verts, 488KB → 377KB',
  },
  {
    kind: 'model',
    name: 'Sears Tower (marquee monument — Willis Tower)',
    file: 'public/models/monument-willis.glb',
    author: 'Benjamin Weinberg',
    source: 'Google Poly archive, via Icosa Gallery',
    url: 'https://icosa.gallery/view/8WZLzwyxTA3',
    license: 'CC-BY 3.0',
    modifications:
      "round 20: offline monument bake (see the block header) — 3072 tris unchanged, 5652 → 3590 verts, 246KB → 114KB. A Google Blocks source, so its albedo came from COLOR_0 rather than a texture. Downloaded from the GLTF2 format root Icosa's own asset API publishes for this id (a web.archive.org mirror of the retired poly.googleusercontent.com CDN); the API is also where the licence CREATIVE_COMMONS_BY 3.0, the author and the 3072 triangle count are stated. The name is the author's own — the model is of the tower now called Willis",
  },
  {
    kind: 'model',
    name: 'Space Needle (marquee monument)',
    file: 'public/models/monument-space-needle.glb',
    author: 'Microsoft',
    source: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/wiki/File:Space_Needle.stl',
    license: 'CC-BY 4.0',
    modifications:
      'round 20: binary STL → GLB through the offline monument bake (see the block header) — 3160 tris unchanged, 9480 → 6268 verts after the weld, Z-up re-axised to +Y up. STL carries no colour, so a single authored stone tone (#d9d7d1) is baked into COLOR_0',
  },
  {
    kind: 'model',
    name: 'Gateway Arch (marquee monument)',
    file: 'public/models/monument-gateway-arch.glb',
    author: 'Microsoft',
    source: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/wiki/File:Gateway_Arch.stl',
    license: 'CC-BY 4.0',
    modifications:
      'round 20: binary STL → GLB through the offline monument bake (see the block header) — 4656 tris unchanged, 13968 → 10933 verts after the weld, Z-up re-axised to +Y up. A single authored stainless tone (#b9bec4) is baked into COLOR_0',
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
    name: 'Cirrus wisp',
    file: 'public/textures/cloud-cirrus.png',
    author: 'SkyTracker (self-made)',
    source: 'first-party (scripts/gen-cirrus.mjs)',
    url: null,
    license: 'CC0',
    modifications:
      'round 19 D: procedurally generated 512px anisotropic-fbm cirrus filament sheet (white RGB, alpha shape, peak alpha 0.72) — the satellite high deck',
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

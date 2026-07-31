# Credits

<!-- GENERATED from lib/fly/assets.js — edit that manifest, then run: node scripts/gen-credits.mjs -->

## Fly Mode assets

- **Archivo Black** (font) — Omnibus-Type, Google Fonts · [OFL 1.1](https://fonts.google.com/specimen/Archivo+Black) · modifications: none (3D POI letters in the world + the inspect-card display face)
- **Chango** (font) — Eduardo Tunni, Google Fonts · [OFL 1.1](https://fonts.google.com/specimen/Chango) · modifications: none (game UI headings — inspect modal)
- **Patrick Hand** (font) — Patrick Wagesreiter, Google Fonts · [OFL 1.1](https://fonts.google.com/specimen/Patrick+Hand) · modifications: none (Toy World handwritten UI)
- **Airplane (widebody airliner, 787-8)** (model) — Poly by Google, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/fzIXe2paBN9) · modifications: geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)
- **Airplane (regional/business jet)** (model) — jeremy, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/9Ev6pklkSYp) · modifications: geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)
- **Jet (military)** (model) — Poly by Google, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/dukcCKsLDrS) · modifications: round 15: the author's base-color texture is baked to per-vertex COLOR_0 offline and the PNG dropped (the runtime bake reads material color factors only, so the textured hull shipped FLAT WHITE from round 8 to round 14) — same triangles, adaptive-subdivided only where the texture varies; geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)
- **Boeing 747** (model) — Miha Lunar, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/49CLof4tP2V) · modifications: round 15: LEVELLED offline — the published file bakes the aircraft into a 25.9° nose-up/banked attitude with a further 17.9° yaw, and the loader only corrects yaw, so every cargo 747 flew permanently crabbed and nose-high (its scaled bbox was 69 × 46 × 70m; it is now 63 × 16 × 70m against a real 747 64.4 × 19.4 × 70.7m). Vertices rotated only — same 1904 triangles, material colors baked to COLOR_0; geometry merged at load; rescaled to real meters; nav-light octahedra appended (round 8)
- **Small Airplane** (model) — Vojtěch Balák, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/7cvx6ex-xfL) · modifications: geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)
- **Airplane (sailplane / motor glider)** (model) — Poly by Google, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/4zE4UQ4siZa) · modifications: round 15: Z-up source re-axised to the +Y-up rig convention and its three material colors baked to per-vertex COLOR_0 offline (no geometry edits) — the glider archetype no longer reuses the Cessna prop model; geometry merged at load; rescaled to real meters; nav-light octahedra appended
- **Aeroplane (low-wing piston fighter — warbird prop)** (model) — Gilang Romadhan, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/9VeIc0cybp4) · modifications: round 15: the author's base-color texture (green + yellow bands, dark canopy) is baked to per-vertex COLOR_0 offline and the PNG dropped, with adaptive subdivision only where the texture varies (590 → 1157 tris); no silhouette edits; geometry merged at load; rescaled to real meters; nav-light octahedra appended
- **Helicopter** (model) — Zsky, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/hG2Qr0A3zR) · modifications: geometry merged + vertex colors baked at load; rescaled to real meters; nav-light octahedra appended (round 8)
- **Low poly Fighter (warbird jet)** (model) — Stephen Graybill, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/1fi8ZIDdFCP) · modifications: round 14: downloaded as published. Round 15: its ONE white material meant the hull rendered flat white, so a natural-metal livery (aluminium upper / darker belly, red nose ring + fin band) is baked to per-vertex COLOR_0 offline — no geometry edits, 124 tris unchanged; geometry merged at load; rescaled to real meters; nav-light octahedra appended — warbird-jet archetype
- **Jet (player aircraft, fighter)** (model) — jeremy, poly.pizza · [CC-BY 3.0](https://poly.pizza/m/6fyLMORhgGK) · modifications: reoriented + rescaled at load; on the mounted clone: canopy swapped glossy (round 8), all hull materials regraded to clearcoat MeshPhysical + a per-style fresnel rim, additive nav/strobe lights, throttle afterburner cone (round 13) — GLB on disk untouched
- **Kloofendal 48d Partly Cloudy (Pure Sky)** (hdri) — Greg Zaal, Poly Haven · [CC0](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) · modifications: none (2K .hdr as published) — satellite daytime sky
- **Qwantani Dawn (Pure Sky)** (hdri) — Jarod Guest, Sergej Majboroda, Poly Haven · [CC0](https://polyhaven.com/a/qwantani_dawn_puresky) · modifications: none (1K .hdr as published) — round 13: satellite dawn sky (time-of-day swap)
- **Qwantani Dusk 1 (Pure Sky)** (hdri) — Jarod Guest, Sergej Majboroda, Poly Haven · [CC0](https://polyhaven.com/a/qwantani_dusk_1_puresky) · modifications: none (1K .hdr as published) — round 13: satellite dusk sky (time-of-day swap)
- **Qwantani Night (Pure Sky)** (hdri) — Jarod Guest, Sergej Majboroda, Poly Haven · [CC0](https://polyhaven.com/a/qwantani_night_puresky) · modifications: none (1K .hdr as published) — round 13: satellite night sky (first real night since R7)
- **Clouds with Transparency** (texture) — WickedInsignia, OpenGameArt · [CC0](https://opengameart.org/content/clouds-with-transparency) · modifications: downscaled to 512px; RGB flattened to white (alpha carries the shape) — toy/night cloud puff
- **Particle Pack — soft cumulus puff (smoke_08)** (texture) — Kenney Vleugels (Kenney.nl), Kenney · [CC0](https://kenney.nl/assets/particle-pack) · modifications: round 13: smoke_08 resized to 512px; RGB flattened to white (alpha carries the shape) — satellite cumulus deck
- **Toon cumulus puff** (texture) — SkyTracker (self-made), first-party (scripts/gen-toon-cloud.mjs) · [CC0](null) · modifications: round 13 P5: procedurally generated 512px 2–3-step toon cumulus silhouette (white RGB, alpha shape) — toy cloud deck
- **Cirrus wisp** (texture) — SkyTracker (self-made), first-party (scripts/gen-cirrus.mjs) · [CC0](null) · modifications: round 19 D: procedurally generated 512px anisotropic-fbm cirrus filament sheet (white RGB, alpha shape, peak alpha 0.72) — the satellite high deck
- **Water normals** (texture) — three.js authors (mrdoob et al.), three.js (examples/textures) · [MIT](https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg) · modifications: round 13: downscaled to 512px — satellite water-glint normal map (specular sparkle)
- **Current weather (open-meteo)** (data) — Open-Meteo, open-meteo.com · [CC-BY 4.0](https://open-meteo.com/) · modifications: round 16: the keyless free-tier `v1/forecast` current block (cloud cover, wind, visibility, precipitation, temperature) proxied through /api/weather, snapped to a 0.25° cell and normalized — it drives the live cloud deck, the overcast/fog atmosphere and the precipitation layer. CC-BY REQUIRES this credit. (The route's failover source, aviationweather.gov METAR, is US Government work in the public domain and needs none.)
- **World coastlines (1:110m)** (data) — Natural Earth, naturalearthdata.com · [Public Domain](https://www.naturalearthdata.com/downloads/110m-physical-vectors/) · modifications: simplified + packed to a binary polyline blob (scripts/gen-atlas-map.mjs) for the Atlas map

## Map data & imagery

- © Esri, Maxar, Earthstar Geographics — https://www.esri.com/en-us/legal/terms/data-attributions
- Terrain © Esri — https://www.esri.com/en-us/legal/terms/data-attributions
- Flight data © adsb.lol — https://adsb.lol

## Live flight data

- ADS-B data by [adsb.lol](https://adsb.lol) — community-run, ODbL.

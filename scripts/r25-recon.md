# R25 "GROUND & NIGHT" — RECON LEDGER (Fable, W0, 2026-09-11)

Three read-only exploration passes over `main` = `f0cd81e` (the Codex "always
load immersive graphics" tip on the R24 close `c0f034c`), plus one design
pass. Every pain-point id below is cited by file:line as the tree read on the
day. The charters in FLY_ROUND25_PLAN.md §3 point at these ids.

> **Venue truth, stated once.** `node_modules` was ABSENT (installed at W0).
> Esri / OpenFreeMap / adsb.lol are 403-blocked by the agent proxy; the ONLY
> tile source here is E's offline fixture (`scripts/_fixture.js`,
> `scripts/r24-fixture/*`, `FLY_TILE_FIXTURE=1`, port 3199). Google Chrome is
> absent; Playwright 1.56.1 is global at `/opt/node22/lib/node_modules`,
> chromium in `/opt/pw-browsers`, launched through `node -r
> ./scripts/_pw-shim.js` (drops `channel:'chrome'`, adds
> `--use-angle=swiftshader`); WebGL is SwiftShader at 1–3 fps. **Every fps /
> ms / tearing / bloom-feel number belongs to the user's RTX 5080 + phone.**
> `.graphics-review/` (the overhaul's Chrome/RTX evidence) is gitignored and
> not in this container.

## §0 The user's words → the ids

| User said | Ids |
|---|---|
| "on the ground the immersive feel still lacks" (ruled: 50–500 ft skimming) | G1–G8 |
| "at night the ground just appears as dark with copper striping (roads)" | N1–N9 |
| "the lighting is really lacking … things feel flat" | L1–L8 |
| "a single button that pans out all of our functionalities aside from the joystick" | M1–M7 |

## §1 Lighting rig (L)

- **L1 ONE light.** Exactly one `<directionalLight>` (`components/fly/FlyScene.jsx:3292-3312`) and one `<hemisphereLight>` (`:3289`); grep for `ambientLight|pointLight|spotLight|RectAreaLight` over `components/` + `lib/` = 0 outside an unused vendor import. FlyScene's own comment: "there is exactly one directionalLight in the world" (`:3101`).
- **L2 The night numbers.** `lib/fly/immersive.js:19-38` `immersiveLighting()`: `sun = (0.09 + 2.5·day)·(1 − 0.83·overcast)`, `fill = 0.10 + 0.34·day`, `environment = 0.14 + 0.38·day`, `haze = 0.28 + 0.72·day`. Applied `FlyScene.jsx:2736-2741` AFTER the legacy `SKY.dayCycle` path (:2727-2735), so `SKY.dayCycle.minSunFrac 0.35` and `SKY_LIVE.weatherDim` are dead in the immersive path. Deep night: key **0.09**, fill 0.10, env 0.14, background 0.22 (`lib/fly/satellite-atmosphere.js:50-51`), exposureGamma ≈ 0.945 (`:43-44`).
- **L3 Hemisphere ground never moves.** `MOODS.satellite.hemi = ['#cfe5ff', '#5a6b53', …]` (`FlyScene.jsx:384-407`); the keyMix effect (`:1843-1854`) writes only `hemiRef.current.color`. Undersides are lit daytime olive at midnight.
- **L4 The moon is not a light.** `ONE_SUN` (`lib/fly/fly-constants.js:5256-5300`) blends the key DIRECTION toward `moonDirFromSun(az)` between el 0 and −8° and explicitly leaves intensity and colour alone (`:5272-5281`). No phase anywhere. The disc is a SkyDome shader term (`SKY_LIVE.nightSky`, `:2428-2437`).
- **L5 Shadows.** `FlyScene.jsx:1007-1036`: on at EVERY tier in immersive; ortho radius `SAT_SHADOWS.orthoRadiusM 1500`, map 2048/1024/512 by tier (`IMMERSIVE.profiles`), bias −0.0004, normalBias 1 (`SHADOW_CALM`), single cascade (`lib/fly/shadow-kernel.js:51-57` rejects CSM) ⇒ **1.46–5.9 m/texel**. Tiles receive only in a ≤48-leaf near set (`DEPTH_PASS.nearReceive`, `FlyScene.jsx:578-587, 759-800`); the texel snap reads `shadowRigRef.current.radiusM` at `:2966`.
- **L6 AO.** `components/fly/N8AO.jsx`; config `fly-constants.js:6273-6290` (halfRes, `aoRadius 24` m, `intensity 5.0`); high tier only (`Effects.jsx:205-213, :685`); measured 0–6% occlusion at Manhattan (`:6277-6282`).
- **L7 Post chain.** `Effects.jsx:163-355` + `reorderForDisplaySpace` (`:434-446`): n8ao → aerial → bloom → ACES → immersive-clouds → HueSaturation → BrightnessContrast → WhiteBalance → Vignette (fixed 0.25/0.55) → SMAA. No DoF in satellite (`'toy-dof'` only, `:295-330`). Speed lines forced off in satellite immersive (`:171`). Night bloom threshold `mix(1.08, 0.91, night)` (`satellite-atmosphere.js:53`) OVERRIDES `SKY_LIVE.bloomNight.threshold 0.62` at `Effects.jsx:657-658`.
- **L8 Night haze is exactly zero.** `AERIAL_LAW.nightRamp true` (`fly-constants.js:5544`) → `atmoNightMul → 0` (`FlyScene.jsx:2485-2489`); `immersiveHaze` ×0.65×0.28 (`:2549`); `NIGHT_TRUTH_R23.hazeNight.retire 1.0` (`:6486`). The R24 §5b note: the decoded night rim renders 38.2 against a dome at 79.6 (~2× too dark).

## §2 Night ground (N)

- **N1 The copper.** `SAT_ROADS.colors.street '#ffb066'` (`fly-constants.js:1206-1208`); night constants `:1209-1225` (intensity 2.4, `streetSpacingM 42`).
- **N2 The override that makes the dots.** `lib/fly/night-city.js:57-64` `satelliteRoadLighting()` returns `{ …r, cinematic: true, intensity: l.roadGlow, lamp.gain: l.streetPoolGain, stream.boost: l.streamGain, traffic.boost: l.trafficGain }` with `SATELLITE_VISUALS.lighting = { roadGlow: 0.035, streetPoolGain: 12, streamGain: 0, trafficGain: 0.32 }` (`lib/fly/satellite-visuals.js:12`). Continuous glow ÷ ~70–100, lamp-pool gain 12 at `sharp 210`, headlight streams 0. Origin: `GRAPHICS_OVERHAUL.md:110-115` ("its old gains produced broad white ribbons"). Never re-swept. `NIGHT_CITY_SWEPT` control leg exists dev-handle-only (`night-city.js:73-87`).
- **N3 The road lights only itself.** Fragment `lib/fly/toy-world/world-bend.js:2585-2662`: every term is a gain on the ribbon's own additive colour (`AdditiveBlending, depthWrite:false, renderOrder −4`, `sat-road-engine.js:276-278`); roads are `receiveShadow`-excluded by design (`fly-constants.js:6189-6191`). No spill, no pool on the terrain.
- **N4 Nothing lights the ground.** No point/spot lights, no lightmaps, no decals; lamp heads are emissive texels (`SatClutterLayer.jsx:696-710`, `CLUTTER.night.intensity 2.8`, poles cull above 900 m AGL `:6180`); the cloud pass's ground shadow and sky replacement are `*day`-gated (`lib/fly/immersive-cloud-pass.js:81-89`).
- **N5 Windows.** `satellite-architecture-material.js:115-136` (lamp mix warm/cool, `glow = paneMask·occupied·darkBuilding·(0.14 + hash·0.24)`, `uArchitectureNight` ramp). `NIGHT_CITY_R23.windows` (`fly-constants.js:6594-6617`: de-repeat, gain spread {0.45,1.55}, `darkFrac 0.22`, `tintJitter 0.18`) is explicitly NOT armed (`night-city.js:42`) and targets the R19 atlas path the cinematic material replaced (`sat-building-engine.js:626/660`).
- **N6 Horizon.** `SatCityGlow.jsx` unmounted in immersive (`FlyScene.jsx:3380` gate `!satelliteVisualsOn('lighting')`, removed per `GRAPHICS_OVERHAUL.md:248-250`); `TownGlow` toy-only. No light-pollution term.
- **N7 Canopy / roofs.** No `night` in `SatVegLayer.jsx`; canopy `MeshStandardMaterial envMapIntensity 0.4` (`cinematic-ground.js:78`) ⇒ black cut-outs at env 0.14 (`GRAPHICS_OVERHAUL.md:337` "foreground park detail is very dark"). Roofs: flat daylight albedo. `FLY_ROUND22_HANDOFF.md` deltas 3, 6, 8 still open.
- **N8 Other emitters.** House-light sprites `SatHouseLights.jsx:143-197` (`#ffd9a0`, opacity 0.38·nightK); parcel-home windows `PARCEL_HOMES.night '#ffc98a' 0.78` (`:4310`); runway edge cls 7 (`SAT_ROADS.runway`, `:1220`); beacons `SAT_AIRPORT_BEACONS` (`:2392-2413`, high tier).
- **N9 Sources B can splat from, client-side.** Pole positions: `SatClutterLayer.placeStatic` writes the pole `InstancedMesh.instanceMatrix` (`components/fly/SatClutterLayer.jsx:876`, `poleRef` init `:503`); building columns: `queryColumns` (sat-building-engine); porch anchors: SatHouseLights; road meshes: `runtime.satRoads.object.children`. ⇒ **no worker payload change; WORKER_PROTOCOL stays 20.**

## §3 Ground level (G)

- **G1 Every AGL band is a cull band.** micro grain ≤1500/2500 (`HILLSHADE.micro` `:2052-2053`), poles ≤900 (`:6180`), movers ≤1200 (`:6162`), parked ≤1400 (`:6151`), veg 2000/2600 (`:3137-3138`), buildings 2200/2800 (`:978-979`), roads 4200/5200 (`:1182-1183`). **Nothing turns ON below ~600 m.**
- **G2 Finest geometry** = an 8.5 m pole (`CLUTTER.poles.heightM` `:6178`) and a 4.1–5.2 m parked car (`:6156`). No grass/scrub/fences/curbs/markings/decals.
- **G3 The tile material.** three-tile `class ae extends MeshStandardMaterial` (`lib/fly/vendor/three-tile/index.js:811-815`, constructed `:1727`): `map` only, roughness 1, no normal/rough/ao maps; `LAMBERT_ENV` not applied; `onTileMaterial` consumed once at `FlyScene.jsx:1508-1526` (bend fade → hillshade → anisotropy).
- **G4 The hillshade patch.** `world-bend.js:1355-1620` (uniforms `:1363-1405`; math `:1527-1560`; micro grain ±10% at 5.5 m `:1554-1570`, `fwidth`-faded by `TERRAIN_LIGHT.microFadeLo/Hi 0.35/0.9` — i.e. faded OUT at the grazing angles of skimming). AGL drive `FlyScene.jsx:2810-2838` (`setMicroDetail`). `TERRAIN_LIGHT.workerNormals false` (`:5409-5443`): DEM face normals, fragment-interpolated. Key: `hillKey(lodFade)` = `r24VariantKey('world-bend-fade-hill-r19', [[e],[f],[a],[l]])` (`:1668-1675`).
- **G5 Resolution ceiling.** `TERRA_SHARP` (`:5768-5806`): imagery z18 ≈ 0.45 m/px, DEM z16 ≈ 1.8 m posting with 2 m tolerated error. R22 measured z18 at the Owens pose = +12 draws (`:5812-5816`), and that pose sits at AGL 65–121 m (inside the bubble).
- **G6 Landcover / veg / clutter as placement sources.** `SatTintLayer.jsx` pooled landcover geometry (`SAT_TINT` `:3746`, alpha 0.1 re-derived per cadence `:3772-3775`, immersive sine grain `:170-186`); `SAT_VEG` pools 0/1500/3000 (`:3100`); `SatClutterLayer` parked 1500 / movers 300 / poles 900, 3 draws, castShadow false, mount gate `qualityTier !== 'low'` (`FlyScene.jsx:3345`), bilinear ground grid `CLUTTER.gridSegments 16` (`:6104-6107` — mismatched grids float objects); `lib/fly/parcel-roads.js` `parcelRoadScan` = cls 5/6 centreline index; `lib/fly/immersive-foliage.js` 128² leaf atlas, alphaTest 0.42.
- **G7 Near-field atmosphere.** `DEPTH_PASS.aerialNear { nearStartM 420, nearMaxMix 0.1 }` (`:6297`) is the only near term; `DEPTH_PASS.enabled false` but armed via `satelliteVisualsOn('depth')` (`lib/fly/depth-pass.js:59-70`).
- **G8 Feel.** `SPEED_FEEL.groundRush.aglBandM 120` exists; `speedOn` forced false in sat immersive (`Effects.jsx:171`, feed `:590-621`); `chase-camera.js` posLambda `:159`, bankShare `:190`, FOV 62 `:267`, IEEE-identity rule `:248-259`; `immersive-audio.js:31-44` wind/engine textures.

## §4 Mobile (M)

- **M1 Device truth.** `hooks/use-device-layout.js:44` (`isTouch, isPhone, isTablet, orientation, isSheet`), `lib/fly/device-class.js:17-30` `isPhoneClass()` static; `data-device`/`data-orient` on the fly root (`FlyMode.jsx:256-268`).
- **M2 Zones.** `MOBILE_UI.zones` (`fly-constants.js:2588-2736`), 8 names, all OWNED (`LayoutRoot.jsx:57-66`), `window.__flyZoneNames.length === 8` asserted (`scripts/verify-mobile-layout.js:211`). `controls-right` `:2707` = the button column.
- **M3 TouchControls.** `components/fly/hud/TouchControls.jsx`: Thumbstick `:102-208` (`touch-joystick`), Throttle `:210-249`, BoostPad `:260-298`, ActionButton `:310-338`, cluster `MOBILE_UI.cluster` (`fly-constants.js:2747-2756`: look, atlas, logbook, photo, pause, inspect*, intercept*, cinema*), TAP `:430-447`, contextual rules `:449-457`, layout `:467-541`, `covered` `:377-383` / `return null` `:413`, `useOverlayBack` `:366`. Sizes `clusterSize {48, 44, 68}` (`:2870`), `minTargetPx 44` (`:2764`), `infoChip.dockBottomRem 24.5` (`:2815`, derived from the column height).
- **M4 No overflow affordance exists;** hangar has NO key and NO touch button (`PauseMenu.jsx:17`, `:201-211`). PauseMenu is the de-facto "everything" list (`:147-292`): 12 actions phone-only via pause.
- **M5 BoostBar ring** positions itself by measuring `[data-testid="touch-boost"]` every 100 ms (`BoostBar.jsx:59-70`).
- **M6 Harness contracts.** `verify-mobile.js` asserts all nine `touch-*` mounted + ≥44 px in both orientations (`:346-360`, `:578-600`), clicks `touch-inspect/-intercept/-logbook/-photo/-pause`; `verify-mobile-layout.js` gates 1–7 incl. pairwise disjointness of outermost pointer-events-auto (`:345`) and landscape `touch-pause` → Exit (`:482-507`); `verify-hangar.js:431` and `verify-logbook.js:484` click `touch-pause`; shared `scripts/_mobile-boot.js` (390×844 / 844×390).
- **M7 Styling.** `app/globals.css:682-686` custom variants phone/phone-land/phone-port; `.hud-glass` phone override kills backdrop-filter (`:720-725`); `framer-motion ^12` in the tree; `readReducedMotion()` (`lib/fly/immersive.js:66`).

## §5 Protocol and certification infrastructure

- WORKER_PROTOCOL = **20** at SEVEN sites (`vector-tile.worker.js:135`, `toy-world-engine.js:84`, `sat-building-engine.js:71`, `sat-skyline-engine.js:140`, `sat-road-engine.js:144`, `sat-veg-engine.js:119`, `sat-clutter-engine.js:105`); `scripts/graphics-unit.mjs:70,72` guards it; `scripts/verify-night-city-identity.mjs:224` carries a stale "stays 18" label.
- The overhaul kept its knobs in `lib/fly/satellite-visuals.js` and `lib/fly/immersive.js` as always-on module constants with NO revert flag; it appended nothing to `fly-constants.js`; all 26 R24 flags read exactly as the CLAUDE.md notice says.
- Un-recertified since the overhaul: every fixed-pose pixel gate (`verify-sat-night` 27/1/1, `verify-dusk`, seam hashes, `verify-monuments-sat`, NEON_COVER hashes); `verify-artifact-hygiene.mjs` gate (1) was RED against `6116fc5` (re-based at W0 to `f0cd81e`, R24 artifacts frozen); 18 harnesses send a dead `?graphics=` param and `graphics-capture.cjs:39` sets a dead `__flyVisualsArm` — documented, not edited (no owner).
- Frozen ceilings: 261 (`verify-sat-depth.js:153` origin; `verify-aerial.js:549`, `verify-groundlife.js:73`, `verify-parcel-homes.js:90`, `verify-night-alive.js:257`, …), 375 (`verify-sat-depth.js:10`, `soak-fly.js:48`), 480, soak p95 tris 2.2 M (`soak-fly.js:47`), `PERF_BUDGET` (`fly-constants.js:28-39`). Post-overhaul live readings: Owens 249/252 noon/night (`GRAPHICS_OVERHAUL.md:132-133`), 246 (`IMMERSIVE_SLICE.md:103-106`); Manhattan 277; Ohio 259; urban soak draw p95 223, mixed 207.
- Tier ladders to hang new detail off: `SATELLITE_VISUALS.profiles` (`satellite-visuals.js:14-18`), `satelliteEffectTier` (`:34-38`), `IMMERSIVE.profiles` (`immersive.js:6-10`), `autoTierCeiling()` phone → medium (`fly-settings.js:116-127`).
- Rig idiom: `components/fly/HudSyncRig.jsx` / `StepSafeRig.jsx` / `PrewarmRig.jsx`, mounted from `FlyCanvas.jsx:73-94` by one line. Pin idiom: `lib/fly/fly-pins.js`.

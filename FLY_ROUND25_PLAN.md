# R25 "Front Door & Clear Sky" — five-agent plan

## Context
Skyloom boots straight into a **mandatory hangar**:
- `stores/fly-store.js:72` has `hangarOpen: true`.
- `components/fly/hud/GroundHangar.jsx` is z-60 and opaque.
- Spawn is **hard-coded to KOSU** (`components/fly/FlyMode.jsx:168`).

So there is no title/intro menu. "Free roam" exists only as glider practice above KOSU, and powered free flight means taxiing out and taking off first. Exit Fly Mode is `window.location.reload()`, which lands back in the hangar.

The satellite world's look is limited by **incoherence rather than missing features**:
- **Two horizon colours.** The cloud-pass sky gradient (`lib/fly/immersive-cloud-pass.js:94-105`) is separate from the fog/rim keyframes (`fly-constants.js:679-695`).
- **A "triple sun".** Terrain is lit by the photo's baked sun × hillshade N·L × MeshStandard N·L.
- **Last-writer faceted normals** (`vendor/three-tile/index.js:1032-1040`).
- **Imagery seams hidden by greying the ground** (`SAT_QUILT`), and a 0.70× darkening hack (`earth-surface-material.js:177`).
- **Clouds.** They are unhazed and hard-cut at 22 km.
- **IBL.** It is never rotated to the live sun.

**Outcome:** a live-world title screen with a clear **Free Flight vs Takeoff & Landing** choice, and a coherent satellite atmosphere and ground behind an in-game **Visuals: Enhanced / Classic** A/B switch.

## Decisions (from the user)
| Topic | Decision |
|---|---|
| Title backdrop | **Live satellite world**, slow cinematic orbit (doubles as tile warm-up) |
| Mode choice | **Two big cards on the title**: Free Flight / Takeoff & Landing. Both go through the hangar for the aircraft pick; the dispatch panel adapts. A **Continue** button relaunches the last setup. Logbook / Settings / Credits are secondary. |
| Free Flight spawn | **Featured scenic spots** + **Search any city** (Atlas POI DB). No geolocation, no resume-position. Any of the 9 aircraft, airborne start. |
| Featured list | Grand Canyon, Manhattan, Swiss Alps (Lauterbrunnen), Rio, Tokyo, Yosemite, Sydney, Dubai, Nāpali Coast, Geirangerfjord, + Columbus practice (today's glider spot) |
| First-time title spot | Featured spot currently in good daylight (golden-hour bonus), fallback Grand Canyon; toy → Manhattan. Returning players see their last setup's location. |
| Name | **Skyloom** everywhere. Keep the `shadowadsb-passport` storage key and the OG URL unchanged. |
| Visual scope | Atmosphere & sky; terrain lighting & relief; imagery colour & sharpness. **Not** buildings, trees or water. |
| Ship posture | Built behind flags. Certified sub-flags ship **ON**. Settings gets **Visuals: Enhanced / Classic**, **live-switchable**. Classic = today's pixels (flag-off identity). Default Enhanced. |
| Texture compression | **Deferred to R26.** New textures (~5.5 MiB) are paid for from bounded pools inside the 300 MiB budget. |
| Airports | Keep KOSU / KCMH / KLCK |
| Process | **Lean record** (one doc like `FLY_GROUND_OPERATIONS.md` + a `CLAUDE.md` notice), per-agent worktrees, one integration pass |

## Key rulings
1. **The title is DOM only, at z-45** (above BootScreen z-40, below the hangar z-60), and interactive immediately.
   - BootScreen goes into *compact mode* as its loading strip. `__flyBoot.pct===100` still means "world revealed" (now the title world).
   - **No new `<canvas>` before the world canvas.** 67 harness sites use `.fixed.inset-0 canvas`.
2. **One state machine**, `screen: 'title'|'hangar'|'flight'` plus `flightMode: 'free'|'ops'`.
   - `hangarOpen` stays as a maintained mirror (`screen==='hangar'`), so testids, harnesses and the store API keep working.
   - New predicates `menuOpen(s)` and `inFlight(s)`.
3. **During the title**, the flight is frozen (operations phase `'hangar'`) at the title spot, and the player group is hidden.
   - A new `lib/fly/title-camera.js` orbits at the flight's own altitude. Streaming rings, readiness, sky-dip and shadows all key off `flight.pos`, so they come for free.
   - These are suppressed on the title: passport spotting, contracts, buzz, near-miss/juice, arrival banner and crashes.
4. **The hangar stages the destination.**
   - `warpToGeo(…,{stage:true})` is allowed while a menu is open.
   - A low-rate invalidate "stage pump" streams it: 10 Hz desktop, 4 Hz phone, stopping when ready or `document.hidden`.
   - The world canvas stays on `'demand'` in the hangar.
5. **The Visuals profile is live.**
   - Every C/D decision (shader text, `customProgramCacheKey`, CPU writes, allocations) goes through one predicate, `r25On(block, sub)`, meaning flag AND profile==='enhanced'.
   - Classic produces today's text and keys, so it is byte-identical by construction.
   - Toggling calls `needsUpdate` on resident materials and swaps prebuilt pass materials.
   - Enhanced data is allocated lazily.
   - Exception: the mesh-tightening sub-flag applies at the next launch only.
6. **Harness posture.** `_boot.js` and `_mobile-boot.js` pin `__flyTitleBypass=true` and `__flyVisualsOverride='classic'` in **both** legs. The legacy fleet then runs today's tree, so no frozen number moves. New gates un-pin via the existing `unpinPins` (`_boot.js:231-245`).
7. **Shared files are W0-only.** `FlyScene.jsx`, `fly-store.js` and the `fly-constants.js` tail are edited only by the orchestrator's W0 commit. Owners fill stub modules that W0 wires in.

## UX flow
| From | Event | Action | To |
|---|---|---|---|
| boot | pre-mount | `resolveInitialScreen()` → `'title'` (bypass pin → `'hangar'`). `resolveInitialSpawn()` → last-setup location, else daylight featured spot (bypass → KOSU). | title |
| title | Free Flight card | `audio.resume()`, `flightMode='free'` | hangar(free) |
| title | Takeoff & Landing card | `audio.resume()`, `flightMode='ops'` | hangar(ops) |
| title | Continue | `runtime.launchSetup(last)` | flight (WarpFlash hold) |
| hangar pre-flight | pick destination/airport | debounced `stageDestination()` | hangar |
| hangar pre-flight | ‹ Title / Esc / Back | — | title (orbits the staged spot) |
| hangar | Fly (`hangar-fly`) | `launchFreeFlight` / `beginDeparture` / glider → `saveLastSetup` | flight |
| pause | Exit to title (`pause-exit-title`, and desktop X) | `exitToTitle(runtime)`: `returnToHangar`, disengage, disarm, close overlays, `titleCam.blendFrom(camera)` | title (orbiting the current position) |

**Title layout**
- Top-left: wordmark "Skyloom" with the tagline "Fly the living Earth".
- Top-right: spot chip showing local time and sun/moon.
- Bottom, in order:
  1. `title-continue` (e.g. "Continue · Skylark · Free Flight over Grand Canyon")
  2. Cards `title-free-flight` and `title-takeoff-landing` (the latter lists KOSU · KCMH · KLCK · Apron/Runway/Approach)
  3. Secondary row: `title-logbook`, `title-settings`, `title-credits`
- Root: `data-testid="title-screen"`, `data-overlay="title"`, `data-ready`. Attribution is rendered inside the title layer.
- Phones: stacked cards ≥88 px tall, targets ≥44 px, safe-area padding, Settings as a bottom sheet. Landscape (844×390): side-by-side, no clipping.

**Settings sheet** (`settings-sheet`)
- Rows: Visuals (`settings-visuals-enhanced|classic`), Map style, Quality, Sound, Reduced motion, Flight stakes.
- The rows are extracted as `hud/SettingsRows.jsx` and reused by PauseMenu. Credits are extracted to `hud/CreditsPanel.jsx`.

**Keyboard and Back**
- Tab order: Continue → cards → secondary row. Enter/Space activate. Esc closes a sheet; on the title root it is a no-op.
- Hangar pre-flight: Esc/Back → title. The mid-flight confirm is unchanged.
- `use-overlay-back.js` `anyOverlayOpen`/`escapeStep` learn `screen` and `settingsOpen`.

**Hangar (B)**
- Header: `hangar-back` ("‹ Title") and `hangar-mode[data-mode]`.
- **Ops mode:** the dispatch panel is unchanged. Glider in ops mode keeps today's KOSU practice.
- **Free mode:** search (`hangar-dest-search`, `#free-flight-search`), featured grid (`hangar-dest-{id}`), results (`hangar-dest-result-{n}`, ≤6), selection summary (`hangar-dest-selected`), and `hangar-stage-status[data-state]`. The Fly button reads "Fly to {name}".
- The default destination is the title spot, so a first flight needs no staging.

## W0 scaffolding (orchestrator, before the workflow)
1. `npm ci`. Record the targeted-eslint baseline for every owned file. Run `node scripts/verify-import-integrity.mjs`.
2. **`lib/fly/fly-constants.js`**: append owner blocks after `MOTION_R24`, all master flags `enabled:false`:
   - `FRONT_DOOR` (A): `titleZ`, `bootCompact`, `exitToTitle`, `orbit{periodSec 240, reducedMotionPeriodSec 900, radiusM 2600, aglM 900, minAglM 350, fovDeg 52, easeSec 2.5}`
   - `VISUALS` (A): `{key:'fly-visuals', defaultProfile:'enhanced'}`
   - `FLIGHT_PLAN` (B): `lastSetupKey:'fly-last-setup-v1'`, `stage{hzDesktop 10, hzPhone 4, debounceMs 400}`, `freeFlight{minAglM 450, cityOffsetM 3000}`, `titleSpot{preferDaylight, minSunElDeg 8, fallbackId 'grand-canyon', toyId 'manhattan'}`
   - `R25_SKY` (C): sub-flags `model`, `skyDip`, `aerialSun`, `cloudAir{fadeStartM 16000, fadeEndM 22000}`, `retireStack`, `iblAlign`, `exposure`
   - `R25_GROUND` (D): sub-flags `relief{mapPx 128, poolTiles 96}`, `oneSun{lo .6, hi 1.45}`, `colorRef{zoom 11, slotPx 64, atlasPx 512}`, `sharpen{minTier 'high', k .3}`, `retireQuilt`, `mesh{enabled:false, table:{13:15,14:6,15:5,16:2}}` (launch-applied), `budget{enhancedTerrainResidentMiB:null}`
   - `R25_CERT` (E): luminance bands `cOnly [.92,1.08]`, `dOnly [.95,1.05]`, `both [.90,1.10]`, `clipPts 1`; horizon `maxDeltaE 8`, `improveK .6`; relief `minGain 1.15`
3. **`stores/fly-store.js`**:
   - Fields: `screen:'hangar'` (A's resolver flips the product to `'title'`), `flightMode:'ops'`, `settingsOpen`, `visuals:'classic'`, `visualsEpoch`.
   - Actions: `setScreen`, `setFlightMode`, `setSettingsOpen`, `setVisuals`.
   - `setHangarOpen(open)` also sets `screen`.
   - Export `menuOpen` and `inFlight`.
4. **Stub modules** (signatures are the contract):
   - `lib/fly/front-door.js` (A): `resolveInitialScreen`, `titleBypassPinned`, `frameloopFor`, `spotAllowed`, `useTitleHidden`
   - `lib/fly/flight-plan.js` (B): `resolveInitialSpawn` → KOSU, `readLastSetup`, `saveLastSetup`, `describeSetup`, `FEATURED_DESTINATIONS`, `searchDestinations`
   - `lib/fly/visuals-profile.js` (written in full, then owned by A): `visualsAvailable`, `visualsPinned`, `resolveInitialVisuals`, `visualsEnhanced`, `r25On`, `saveVisuals`, `setVisualsLive`, `onVisualsChange`, plus dev sub-pins `__flyR25Sky` / `__flyR25Ground`
   - `lib/fly/r25-sky.js` (C): `r25SkyAtmo(runtime, rim, void, ctx)`, `r25SkyFrame(runtime, ctx)`
   - `lib/fly/r25-ground.js` (D): `applyR25Terrain(material)`, `r25GroundFrame(runtime, ctx)`
5. **Wiring**
   - `FlyScene.jsx`:
     - `hangarOpen` → `menuOpen` at :1267, :1315, :1953, :1972, :1978
     - `warpToGeo` `opts.stage` (skip ops warp/arrival)
     - `applyR25Terrain` after `applyEarthSurface` (:1522)
     - `spawn.altM ?? SPAWN_ALT_M` (:1896)
     - `spotAllowed` around `logSpot` (:2045-2055)
     - TitleCamera snap/update in the camera rig chain (:2324-2344)
     - `r25SkyAtmo` after `applyWeatherAtmo` (:2438)
     - `r25SkyFrame` / `r25GroundFrame` after the style chain (:2818), with a module-scope non-allocating `_r25Ctx`
   - `FlyCanvas.jsx:108`: frameloop from `frameloopFor`.
   - `PlayerPlane`/`Contrail`/`PlayerGroundShadow`: `visible={!useTitleHidden()}`.
   - `FlyMode.jsx:153-173`: `resolveInitialVisuals()`, `resolveInitialSpawn()`, `setScreen(resolveInitialScreen())`.
   - `perf-governor.js:441`: use `menuOpen`.
   - `prewarm.js:410`: `applyR25Terrain` twin.
6. **Harness pins (SANCTIONED)**
   - `_boot.js`: both legs get the two pins, and the reload leg gains the missing `__flyBoostInfinite`.
   - `_mobile-boot.js`: add init script with the same pins.
7. **Worktrees.** Tag `r25-w0`, then `git worktree add /home/user/skyloom-r25-{a..e} -b r25/{a..e} r25-w0`, plus `cp -al node_modules` into each.
   - Ports (dev/fixture): A 3031/3201, B 3032/3202, C 3033/3203, D 3034/3204, E 3035/3205, integration 3036/3206.
   - Never use 3000, 3002 or 3019.
   - Browser gates run under `flock`, at most 2 concurrent (SwiftShader on 4 cores).
8. **W0 gates:** import-integrity, `graphics-unit`, `verify-flight-operations`, `verify-mobile-actions-node`, `verify-stylized-earth`, `verify-atmo-law`, `verify-c-flagoff`, `verify-lod-fade`, `verify-vendor-three-tile`, all unchanged and green. Also add a two-line "R25 IN PROGRESS" notice to `CLAUDE.md`.

## The five roles (all Opus; each works in its own worktree and branch, and runs its own gates RED-first against `r25-w0`)
Common rules:
- Edit only your own files and constants block. Never edit `FlyScene.jsx`, `fly-store.js` or the constants tail.
- Run import-integrity first. Targeted eslint must not exceed the W0 baseline.
- No per-frame data through React or zustand.
- New shader text needs a new cache key and a prewarm twin.
- Keep testids stable.
- Evidence goes to `.graphics-review/r25/<role>/`.
- Flip your own master flag `enabled:true` on your branch once your gates are green.
- Report PASS / FAIL / BLOCKED / NOT CALIBRATED, with an "unmeasurable here" column.

### A — FRONT DOOR
**Owns:**
- `FlyMode.jsx`, `FlyCanvas.jsx`, `PauseMenu.jsx`, `FlyErrorBoundary.jsx`
- `hud/BootScreen.jsx`, new `hud/TitleScreen.jsx`, `hud/SettingsRows.jsx`, `hud/CreditsPanel.jsx`, `hud/title.css`
- Title-gating lines in `JuiceSystems.jsx`, `hud/Contracts.jsx`, `hud/ArrivalBanner.jsx`
- `lib/fly/front-door.js`, new `lib/fly/title-camera.js`, `lib/fly/visuals-profile.js`
- `hooks/use-overlay-back.js`, `hooks/use-fly-audio.js`
- `app/layout.js`, `app/loading.js`, `public/manifest.json`

**Builds:**
- The title screen, the state machine and the Esc/Back table.
- `TitleCamera`: orbit around `flight.pos` with a terrain-clearance floor, `blendFrom(camera)` easing, and a slow period under reduced motion.
- `<StagePump>`.
- BootScreen compact mode, keeping the `__flyBoot` contract and testids.
- The Settings sheet with the live Visuals toggle.
- Exit-to-title, replacing the reload. The error boundary keeps reload, labelled "Restart Skyloom".
- An explicit audio unlock on the first title click.
- Engine hum muted while `!inFlight`.
- Skyloom branding across `layout.js` metadata, the manifest, `loading.js`, the BootScreen wordmark and "Welcome to Skyloom".
- Remove the dead geolocation spawn code, but keep the `fly-last-pos` writer (read by `verify-boot.js`).

**Gates:**
- `scripts/verify-r25-front-door.mjs` (node): resolvers, predicates, the `escapeStep` table, `frameloopFor`, `exitToTitle` field resets, visuals precedence.
- `scripts/verify-r25-title.cjs` (fixture, satellite and toy):
  - interactive before reveal
  - orbit radius within ±5% and AGL floor respected
  - plane hidden
  - zero passport change
  - crash disabled
  - AudioContext running after the first click
  - settings round-trip
  - Esc/Back
  - pause → exit → title with a live world
  - phone targets ≥44 px in portrait and landscape
  - attribution visible

**Non-goals:** a second canvas, hangar content, shader work.

### B — FLIGHT PLAN
**Owns:**
- `hud/GroundHangar.jsx`, and the hangar rules in `hud/operations.css`
- `lib/fly/operations-runtime.js`, `lib/fly/flight-plan.js`
- New `lib/fly/destinations.js` and `lib/fly/poi/search.js`
- `hud/Atlas.jsx` (search extraction only)

**Builds:**
- `runtime.launchFreeFlight(aircraftId, dest)`. It generalises `launchGlider` (`operations-runtime.js:32-39`) and the `_boot.js:172-182` helper:
  - sets aircraft config
  - `operations.profile=null`, phase `'airborne'`
  - position `max(dest.altM, ground+minAglM)`, heading from the destination, cruise speed
  - `armWarpTrim`
  - `sync()`, which does the far-warp hold and crash disarm
  - `launchGlider` stays as an alias.
- `runtime.stageDestination()`, `runtime.staging{key, ready}` (a 4 Hz `worldReadiness` poll) and `runtime.launchSetup()`.
- `destinations.js`: the 11 curated entries `{id, name, lat, lon, altM, groundM, clearM, headingDeg, blurb, glyph, title:{radiusM, aglM}}`. Rule: `altM ≥ clearM+400`, with every coordinate verified.
- `poi/search.js`: the exact Atlas ranking (`Atlas.jsx:65-79`) plus `warpOptsFor`; Atlas imports both.
- `fly-last-setup-v1`: validated and rehydrated. Corrupt or ineligible data → `null`, which hides Continue.
- `resolveInitialSpawn()`: bypass → KOSU; else last setup; else daylight featured spot; toy → Manhattan.
- The adaptive hangar panel described above.

**Gates:**
- `verify-r25-flight-plan.mjs` (node): destination sanity, search parity with the old Atlas ranking over 60 queries, last-setup round trip plus corrupt/ineligible cases, daylight spot under a pinned clock, placement math for all 9 aircraft.
- `verify-r25-freeflight.cjs` (fixture):
  - staging progresses behind the hangar
  - the launch lands airborne within tolerance
  - `warp-hold` is shorter than an unstaged control
  - a searched city launches
  - no crash within 10 s
- `verify-r25-continue.cjs` (fixture): exact relaunch of a free flight and an ops-runway flight; corrupt storage hides Continue.

**Non-goals:** airport data, FlightOperations physics, title UI.

### C — SKY (one atmosphere)
**Owns:**
- `lib/fly/r25-sky.js`, new `lib/fly/sky-model.js`
- `immersive-cloud-pass.js`, `living-sky.js`, `atmo-law.js`
- `satellite-atmosphere.js`, `immersive.js` (intensities)
- `AerialPerspective.jsx`, `Effects.jsx`, `WhiteBalance.js`, `SkyDome.jsx` (CPU uniforms + `getSkyDip()`), `SatEnvironment.jsx`
- The post/cloud warm regions of `prewarm.js` (:952, :1045)

**Builds:**
1. **`sky-model.js`**: single-scattering Rayleigh + Henyey-Greenstein Mie (the design at `scripts/r24-d-atmos.md:429-452`; Mie phase reused from `atmo-law.js`), driven by `runtime.sun`, eye height and weather. It outputs:
   - `horizonLin` at the dipped rim, `zenithLin`, `sunTint`, `ambientLin`, `rimSRGB`, `voidSRGB`
   - a GLSL sky function
2. **`r25SkyAtmo`** overwrites `_atmoRim`/`_atmoVoid` in place. Fog, edge fade, depth haze, `setSkyAtmo` and the aerial rim then all share the model colour, so there is one horizon.
3. **Enhanced cloud-composite variant:**
   - dip-aware `up`, model sky + Mie aureole
   - clouds hazed at slab-entry distance using `livingAirTransmission`
   - model ambient/key colours
   - 16–22 km alpha fade replacing the hard cut
   - prebuilt Enhanced materials swapped via `fullscreenMaterial`
4. **Aerial Enhanced define:** sun-angle in-scatter (Rayleigh tilt + Mie lobe) and pre-curve `uExposure`.
5. **Retire the haze stack** (CPU): depth-haze max 0, fog density floor. The 60–120 km rim fade stays as the world edge.
6. **IBL alignment:** `environmentRotation.y` / `backgroundRotation.y = sun.az − hdriSunAz[bucket]`, with per-HDRI azimuths precomputed by a new `scripts/hdr-sun.mjs`. Classic writes 0.
7. **Exposure moves pre-curve** in Enhanced. Neutral tone mapping is a dev pin only (`__flyToneOverride`), never shipped without a user A/B.

**Budgets:** 0 draws, 0 textures, plus the Enhanced program variants.

**Gates:**
- `verify-r25-sky.mjs` (node): model sanity (zenith bluer/darker than horizon, reddening as the sun lowers, monotonic), sRGB/linear parity, dip convention, Classic post text/keys equal to flag-off.
- `verify-r25-sky-browser.cjs` (fixture, clouds frozen via a new `__flyCloudFreeze`):
  - horizon seam ΔE ≤ 8 and ≤ 0.6 × Classic
  - C-only terrain luminance within [.92, 1.08]
  - clip +≤1 pt
  - no 22 km cloud edge
  - Owens draws unchanged

**Non-goals:** `world-bend.js`, the terrain chain, buildings/trees/water, toy.

### D — GROUND (relief, one sun, imagery colour and sharpness)
**Owns:**
- `lib/fly/r25-ground.js`, new `lib/fly/r25-relief.js`, `lib/fly/r25-color-ref.js`
- `lib/fly/toy-world/world-bend.js` (`applyHillshade` :1423-1657, `hillKey` :1679-1686, registry :12-412)
- `earth-surface-material.js`, `daylight-depth.js` (terrain kind), `lod-crossfade.js`
- `terrain-engine.js`, `raster-cache.js`
- Vendored `three-tile/index.js`, `workers/skirt-tail.src.js` (+ built file), `VENDOR.md`, `scripts/vendor-three-tile-integration.json`
- `prewarm.js:395-412`

**Builds:**
1. **Relief:**
   - The DEM worker (when the request has `r25Relief:true`) computes a 128² RG8 normal map from central differences over the full 257² grid.
   - These go into a DataTexture pool of ≤96 tiles with LRU, plus a per-material `uR25Relief` / `uR25HasRelief` holder.
   - Same-LOD neighbour edges are stitched.
   - With the flag off the vendor branch is dead, keeping the upstream shape. Add a VENDOR.md ledger row.
2. **One bounded sun term** in Enhanced `applyHillshade`:
   - `albedo *= clamp((N·L+a)/(Ncap·L+a), lo, hi)`, where N is the relief normal (vertex fallback) and Ncap is up.
   - Terrain direct diffuse uses the flat normal, so relief enters once.
   - Normalising this replaces `groundValue 0.70`.
3. **Colour transfer:**
   - A rolling 512² atlas of 64² z11 Esri slots (a colour-balanced product), fetched via the `tile-sources.js` URL so the fixture routes it.
   - The shader does `hi *= clamp(ref / textureLod(map, uv, uR25LodK), .5, 2.)` before `diffuseColor *= sampledDiffuseColor` (in both the stock and crossfade paths).
   - `setQuiltGrade(0,0)` retires `SAT_QUILT`.
4. **Sharpening** (high tier): Catmull-Rom via 5 bilinear taps when magnified, plus mip-difference unsharp with k ≤ 0.35.
5. **Mesh (launch-applied, ships only if budgets hold):** `R25_GROUND.mesh` tightens z13/z14 Martini error to 15 m / 6 m via `setDemErrorTable` at engine creation, in Enhanced only. It ships OFF if triangles exceed 2.0 M at fixed poses or Owens moves.
6. **Keys:**
   - `hillKey` gains an `r25` suffix (`-nsck25`) with a registry entry.
   - The earth-surface key gains `-r25g`.
   - The prewarm twin compiles the current profile; the alternate is warmed lazily via `requeueForEnvironment`/`pumpRequeue`.

**Budget:** ≤5.5 MiB of textures, Enhanced only. If the peak exceeds 300 MiB, an Enhanced-only terrain residency trim applies.

**Gates:**
- `verify-r25-ground.mjs` (node):
  - normals within 2° on synthetic DEMs, with edge continuity
  - colour-ratio bounds and identity
  - lodK mapping and pool byte arithmetic
  - Classic keys equal to flag-off
  - `verify-worker-normals`, `verify-skirt-worker` and `verify-vendor-three-tile` still green
- `verify-r25-ground-browser.cjs` (fixture):
  - Sobel relief gain ≥1.15× at Sierra and the Smokies
  - seam step ≤ Classic
  - D-only luminance within [.95, 1.05]
  - toy pixel-identical across profiles
  - Enhanced memory ≤300 MiB; Classic = W0 ±0.5 MiB
  - Owens ≤261; triangles unchanged (mesh sub-flag measured separately)

**Non-goals:** compression (R26), light intensities (C), post, a `WORKER_PROTOCOL` bump (the vector workers are untouched).

**Luminance contract (C ↔ D):**
- C owns absolute exposure; D owns relative shading and must be luminance-neutral.
- The combined result must stay within [.90, 1.10] with clip +≤1 pt.
- Drift is fixed with C's exposure knob only.
- Measured at poses P1–P6 by E's shared instrument, using dev sub-pins to produce the C-only and D-only columns.

### E — CERT and INTEGRATION
**Owns:**
- `scripts/_boot.js` (after W0), `_fixture.js`, `_mobile-boot.js`, `r24-fixture/**`
- New `scripts/_title.js`, `_skip-menus.js`, `_r25-luma.js`, `_r25-poses.js`
- Legacy harness edits
- `verify-r25-flagoff.mjs`, `verify-r25-visuals.cjs`, `verify-r25-smoke.cjs`
- The record doc, the `CLAUDE.md` notice, integration conflict resolution

**E1 (first, while A–D do node work):**
- **Prove a satellite fixture boot on `r25-w0`.** Route `wmts.terrascope.be` to a new `r24-fixture/worldcover.mjs` (legend-exact PNGs per scene kind) and any other readiness-blocking host, until `worldReadiness.ready` holds at Owens, Manhattan and Powell.
- **Helpers:**
  - `enterHangar(page, mode)`: tolerant of a missing title.
  - `enterFlight(page, geo)`.
  - Poses P1–P6: Owens 1500 m, Sierra 3200 m, Manhattan 450 m, Powell 350 m, Smokies 1500 m, Owens 7000 m; noon/dusk via `__flySunOverride`.
  - A luma/ΔE/Sobel instrument.
- **Record W0 baselines:** draws, triangles, texture peak, `bootFly` reveal time for toy and satellite, product boot reveal time, per-pose luminance and ΔE.
- **Write the `.e1-ready` marker.** A–D merge `r25/e` before their first fixture run.

**Legacy harness edits (SANCTIONED):**
- The ops harnesses (`verify-operations-*.cjs`, `verify-loading-scenery.cjs`) call `enterHangar(page,'ops')` after `goto`.
- `verify-operations-touch.cjs:15-17` becomes "Back never reveals an unstarted world" (it lands on `title-screen`).
- `verify-mobile-actions-node.mjs` gains the new store fields and cases.
- Text updates: `verify-boot.js:97` ("Welcome to Skyloom"), `verify-mobile-layout.js:488,506` ("Exit to title").
- `graphics-flight.cjs` / `graphics-capture.cjs` use `enterFlight`.
- The other ~35 direct-`goto` harnesses are recorded as already stale since `2c624a3`.

**E2 (integration and close):**
- Merges and smokes.
- Enhanced columns for `verify-rim`, `verify-sat-depth`, `verify-dusk`, `verify-sat-night` and `verify-aerial`, under an un-pin with `// SANCTIONED RE-BASELINE (R25 Enhanced column)`. Classic thresholds are untouched.
- `verify-r25-visuals.cjs`:
  - Classic (all R25 flags on) vs flag-off cross-boot: mean |Δ| ≤0.5/255, p99 ≤2/255.
  - Same-session Classic → Enhanced → Classic is exactly equal.
  - GL program count flat after the first of 3 toggle cycles.
  - Combined luminance and ΔE within bounds.
  - Draws Owens ≤261, satellite ≤375, toy ≤480; triangles equal; textures ≤300 MiB.
- Product boot to the title: median of 3 ≤ W0 × 1.05. If red, B swaps the default spot.
- Ship-state flips, backed by evidence only.

## Workflow (the execution vehicle, run after W0)
One `Workflow` script, `r25-front-door-and-visuals`. There are five agent **roles**; a role can be invoked more than once (build → peer review → fix). All use the session's Opus model; the prompts point at this plan's role sections.

```
phase Build+Review  — pipeline(ROLES=[E1,A,B,C,D], build, peerReview, fixIfFindings)
  build(role):       agent(role charter + worktree/port + "RED-first, gates, commit on r25/<x>"),
                     schema {branch, head, gates[{name,verdict,evidence}], redFirst[], flagFlipped, risks[], unmeasurable[]}
  peerReview(r):     adversarial review by a sibling role, no barrier:
                     A↔B · C↔D · E reviews A–D for harness impact
                     → schema {findings[{severity,file,line,claim,repro}]}
  fixIfFindings(r):  owner fixes blocking findings on its branch; returns updated gate table
phase Integrate     — sequential on claude/game-intro-menu-world-mf37eg (--no-ff), E2 drives:
                     E1 → A → B → D → C   (infra first; the boot path next; the UI stable before shaders;
                     D's luminance is measured while C is still Classic; C's exposure is the last global knob)
                     after each merge: import-integrity + targeted eslint + all node gates + fixture smoke
                     red → owner-role fix agent on its branch → re-merge (≤2 loops, else ship that sub-flag OFF)
phase Certify+Close — E2: Enhanced columns, visuals identity, budgets, boot timing, ship-state flips,
                     production build receipt (node scripts/ground-night-build.cjs --dist=.next-r25),
                     FLY_FRONT_DOOR_AND_VISUALS.md + CLAUDE.md notice + user-machine run list
```

The orchestrator (main loop) then reads the result, re-runs the node gates itself, and pushes `claude/game-intro-menu-world-mf37eg`. **No PR** unless asked.

## Verification
| Check | Node (runs here) | Fixture browser (SwiftShader) | User machine |
|---|---|---|---|
| Title / state machine / Esc-Back | `verify-r25-front-door.mjs`, `verify-mobile-actions-node.mjs` | `verify-r25-title.cjs`, `verify-r25-smoke.cjs` | walk the title on desktop and phone; orbit feel; sound unlock |
| Free Flight / Continue | `verify-r25-flight-plan.mjs` | `verify-r25-freeflight.cjs`, `verify-r25-continue.cjs` | 3 featured spots, 1 searched city, Continue |
| Takeoff & Landing through the title | — | `verify-operations-browser/keyboard/touch.cjs` | full `verify-operations-*.cjs` |
| Sky | `verify-r25-sky.mjs` | `verify-r25-sky-browser.cjs` | A/B at Grand Canyon noon, Manhattan dusk, Alps |
| Ground | `verify-r25-ground.mjs` + vendor/worker gates | `verify-r25-ground-browser.cjs` | colour-quilt on real Esri; relief A/B at Yosemite and Alps |
| Classic = today | `verify-r25-flagoff.mjs` | `verify-r25-visuals.cjs` | quick toggle check |
| Budgets | `verify-terrain-budget.mjs` | `verify-r25-visuals.cjs`, `graphics-flight.cjs` memory audit | fps soak Classic vs Enhanced; memory audit |
| Legacy fleet (pinned) | import-integrity, `graphics-unit`, `verify-stylized-earth`, `verify-flight-operations`, … | `bootFly` toy and satellite, `verify-rim`, `verify-sat-depth` (Classic, unchanged) | — |

**User-machine run list** (Windows/PowerShell; npm launcher broken):
1. `node node_modules/next/dist/bin/next dev -p 3027`
2. Walk: title → Free Flight (Grand Canyon, Alps, a searched city) → pause → Exit to title → Continue → Takeoff & Landing (KCMH runway).
3. Settings → Visuals Enhanced/Classic at 4 spots, with screenshots.
4. With `$env:FLY_URL`, run the `verify-r25-*` and `verify-operations-*` browser gates.
5. Memory audit.
6. Phone on the LAN.

## Risks
| Risk | Mitigation |
|---|---|
| The satellite fixture never reaches readiness | E1 goes first. Fallback: toy fixture for the flows, with pixel evidence moved to the user machine and recorded honestly. |
| Title reveal stalls because the orbit camera is away from `flight.pos` | A measures at 3 spots and tunes radius/AGL. |
| Boot to the default title spot is slower than KOSU | E's boot-time gate; B swaps the default. |
| Program churn on the live toggle | Keys derive from the predicate; lazy alternate warm; a program-count gate. |
| C and D luminance drift | Separate C-only / D-only columns; the single exposure knob. |
| Side effects on the title (spots, contracts, crash) | Title gating plus an assertion of zero passport change. |
| Rename breaks text-matching harnesses | Those edits land with A's merge. |
| Two WebGL contexts during staging on phones | 4 Hz pump; stop when ready or hidden; governor skipped while a menu is open. |

## Critical files
- `components/fly/FlyScene.jsx`, `components/fly/FlyMode.jsx`, `stores/fly-store.js`, `lib/fly/fly-constants.js` (W0)
- `components/fly/hud/GroundHangar.jsx`, `lib/fly/operations-runtime.js` (B)
- `lib/fly/toy-world/world-bend.js`, `lib/fly/vendor/three-tile/index.js` (D)
- `lib/fly/immersive-cloud-pass.js`, `components/fly/AerialPerspective.jsx`, `components/fly/Effects.jsx` (C)
- `scripts/_boot.js`, `scripts/_fixture.js`, `scripts/r24-fixture/` (E)

## W0 addendum (orchestrator, as built)
- **Import-integrity baseline is RED before R25**: `node scripts/verify-import-integrity.mjs`
  reports 3 pre-existing errors in 2 files — `lib/fly/living-regions.js:1`
  (parser: JSON import attributes `with { type: 'json' }`) and
  `scripts/r24-c-agl.js:355,363` (`agl`/`speed` in a browser-evaluated closure).
  Rule for every role: **the error count must not grow**; E may fix the gate's
  parser config / the probe as a sanctioned harness edit.
- Path corrections: the world-bend registry is `lib/fly/toy-world/world-bend.js`;
  PauseMenu is `components/fly/PauseMenu.jsx`.
- W0 wiring as built (owners must not re-edit these call sites; fill the stubs):
  - `stores/fly-store.js`: `screen`, `flightMode`, `settingsOpen`, `visuals`,
    `visualsEpoch`; `setScreen/setFlightMode/setSettingsOpen/setVisuals`;
    `setHangarOpen` mirrors `screen`; exported `menuOpen(s)` / `inFlight(s)`.
  - `components/fly/FlyScene.jsx`: `menuOpen` replaces every `hangarOpen` gate;
    `warpToGeo(lat, lon, {stage:true})` allowed in menus (no ops warp, no arrival);
    `applyR25Terrain(m)` after `applyEarthSurface`; `spawn.altM ?? SPAWN_ALT_M`;
    `spotAllowed(store)` around the passport `logSpot`; `runtime.titleCam`
    (`needsSnap` → `chase.snap()`; `active` → `titleCam.update(dt, flight, camera, mercatorScale, groundElev)`)
    in the camera rig chain; `r25SkyAtmo(runtime, _atmoRim, _atmoVoid, _r25Ctx)`
    right after `applyWeatherAtmo` (satellite branch); `r25SkyFrame` +
    `r25GroundFrame` at the END of the -50 useFrame (after every light write).
    `_r25Ctx` = `{style, tier, dt, scene, camera, gl, flight, sun, hemi, aerialFeed, eyeAgl, eyeAglVis, altT}`.
  - `FlyCanvas.jsx`: `frameloop = useFlyStore(frameloopFor)`.
  - `PlayerPlane.jsx` / `Contrail.jsx` / `PlayerGroundShadow.jsx`: root `visible={!useTitleHidden()}`.
  - `FlyMode.jsx`: `resolveInitialVisuals()`; spawn from `resolveInitialSpawn()`;
    `setScreen(resolveInitialScreen())` before `setSpawn`.
  - `perf-governor.js`: skip samples while `menuOpen`. `prewarm.js`: `applyR25Terrain(m)` warm twin.
  - `scripts/_boot.js` (both legs) and `scripts/_mobile-boot.js`: `__flyTitleBypass = true`,
    `__flyVisualsOverride = 'classic'`; reload leg gained the missing `__flyBoostInfinite`.
- Constants blocks appended at the end of `lib/fly/fly-constants.js`:
  `FRONT_DOOR`, `VISUALS`, `FLIGHT_PLAN`, `R25_SKY`, `R25_GROUND`, `R25_CERT`.
- If an owner genuinely needs a NEW call site in a W0-only file (FlyScene,
  fly-store, the constants tail), it asks in its report; the orchestrator adds
  it at integration. Do not edit those files on a role branch except inside
  your own constants block.

### W0 gate baseline (measured on the W0 tree; identical on 2c624a3 unless noted)
The clone was shallow; W0 ran `git fetch --unshallow` so the vendor-history gates can read b64457b.
| Gate | Result | Note |
|---|---|---|
| verify-import-integrity.mjs | 3 passed / 1 failed | pre-existing: 3 no-undef/parse errors in 2 files (see above) |
| graphics-unit.mjs | PASS | |
| verify-flight-operations.mjs | PASS (33) | |
| verify-mobile-actions-node.mjs | 9/9 PASS | |
| verify-stylized-earth.mjs | PASS 22/22 | |
| verify-c-flagoff.mjs | PASS (58) | |
| verify-vendor-three-tile.mjs | 34 passed / 0 failed | needs full history |
| verify-living-earth.mjs | PASS (19) | |
| verify-cinematic-flight.mjs | PASS | |
| verify-operations-disclosure.mjs | PASS | |
| verify-lod-fade.mjs | 60 passed / 4 failed | pre-existing, identical on 2c624a3 (patch-7 / marker-count assertions stale vs the Motion-Hold vendor edits) |
| verify-atmo-law.mjs | crashes (TypeError in setAerial eval) | pre-existing, identical on 2c624a3 |

Targeted eslint baseline over every R25-owned file (errors/warnings; only files with findings):
```
3e 0w components/fly/Contrail.jsx
1e 0w components/fly/FlyCanvas.jsx
0e 2w components/fly/FlyScene.jsx
2e 2w components/fly/PlayerPlane.jsx
1e 0w hooks/use-fly-audio.js
```
Every other owned file lints clean. Rule: no owned file's count may grow.

### Session 1 stop point (2026-09-23)
- The workflow ran briefly, then was stopped by the user's request, to continue in
  a fresh session via [FLY_ROUND25_KICKOFF.md](FLY_ROUND25_KICKOFF.md).
- Only E CERT's first phase landed (`5072a38`, scripts only, merged in `8323bb6`).
  It reads **import-integrity 4/0** (the 3 pre-existing errors are fixed), so that
  is the new baseline.
  - `verify-mobile-actions-node.mjs` reads 11/11 with 5 PENDING (the Esc/Back table waits for A).
  - `verify-r25-flagoff.mjs` reads 8 passed with 2 NOT CALIBRATED (waits for C/D).
- Roles A–D restart from scratch.

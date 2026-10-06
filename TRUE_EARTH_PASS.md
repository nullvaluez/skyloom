# True Earth — the browser pass record

**Started 2026-10-06 · lands straight on `main` behind flags · owner certifies on an RTX 5080 (Chrome) and an A17 Pro-class iPhone (Safari).**

This file is both the plan and the record. Each phase adds what landed, the flags,
the owner's run list and the results under **Status** below. The original plan
follows unchanged under **Plan**.

## How to try a flag on a live build

Every look-changing workstream ships `enabled:false` in `lib/fly/fly-constants.js`
(TRUE EARTH section at the end). URL parameters switch things for one page load,
which also works on the iPhone where there is no console:

| Parameter | Example | Effect |
|---|---|---|
| `flags` | `?flags=TWILIGHT_FIX,SUN_TRUE_AZ` · `?flags=-HDR_GUARD` | turn flags on, or off with a leading `-` |
| `sunUtc` | `?sunUtc=2026-06-22T00:40:00Z` | pin the sun clock (ISO or epoch ms) |
| `weather` | `?weather=overcast` · `?weather=baseline` | pin a weather state |
| `diag` | `?diag=1` | diagnostics panel: live frame stats, 60 s benchmark, device report |

A flag's default flips to `true` in its own one-line commit after its run list passes.

## Status

| Phase | State |
|---|---|
| 0 — Foundations, defects, diagnostics | **Built on `main` (2026-10-06); waiting on your run list** |
| 1 — True proportions | **`TRUE_SCALE` and `TRUE_AREAS` built on `main` (2026-10-06), off by default; waiting on your run list** |
| 2 — Atmosphere, horizon, conditions, shadows | **In progress: `CONDITIONS` built on `main` (2026-10-06), off by default; `PHYS_SKY`, `EARTH_HORIZON`, `NIGHT_LIGHTS` and `TERRAIN_SHADOW` not started** |
| 3 — Take off and land anywhere | Not started |
| 4 — Cinematic | Not started |
| 5 — Cities and landmarks | Not started |

### Flags

| Flag | Phase | Default | What it changes | Gate |
|---|---|---|---|---|
| `TWILIGHT_FIX` | 0 | off | Sun disc and halo stay on the real sun at sunset; the moon gets its own disc; the key light switches sun→moon at −4° under an intensity dip instead of dragging the "sun" up the sky | `verify-twilight.mjs` 6/6 |
| `SUN_TRUE_AZ` | 0 | off | True solar azimuth (was the hour angle: noon sun always due south, wrong half of the sky in Sydney/Rio); Astronomical Almanac position; sun refreshed every 2 s instead of 60 s | `verify-sun-azimuth.mjs` 5/5 (0.005° vs Meeus) |
| `HDR_GUARD` | 0 | off | Clamps the last HDR write before bloom to [0, 65504], so one NaN pixel can't black out the frame | `verify-hdr-guard.mjs` 4/4 (incl. WebGL2 readback) |
| `LOAD_GUARD` | 0 | off | Provider-empty (ocean) tiles count as ready; vendored three-tile patch R26-1 ends the endless re-update; hard limits 20 s boot / 15 s warp | `verify-load-guard.mjs` 4/4, `verify-vendor-three-tile` 34/34 |
| `PLAYER_SURFACE` | 0 | off | Players see one look: no Visuals/Map-style rows, no review warps, no neon warp confetti; saved Neon/Classic migrates once. Review (`?graphicsReview=1`) and automation keep everything | `verify-player-surface.mjs` 5/5 |
| `DEVICE_TIERS` | 0 | off | Start tier follows the GPU (discrete→high, integrated/unknown→medium, software→low); governor sheds clouds and render scale before dropping shadow cascades (which recompile every lit shader) | `verify-device-tiers.mjs` 5/5 |
| `TRUE_SCALE` | 1 | off | True proportions in Enhanced: mountains, buildings and aircraft stop being squashed by cos(latitude) (×1.31 taller at 40°N, ×1.44 in the Alps, ×2 at 60°N). The camera alone carries the correction; physics, collisions, culling, LOD, picking and HUD numbers are untouched | `verify-true-scale.mjs` 14/14; fixture A/B in SwiftShader |
| `TRUE_AREAS` | 1b | off | Building footprint filters judge the same house the same way at every latitude (normalised to 40°N, where they were tuned): small homes stop vanishing near the equator, big halls stop going flat in the far north. Ohio and New York stay within 2% | `verify-true-areas.cjs` 7/7 (needs `FLY_TILE_FIXTURE=1`), `verify-seam` PASS |
| `CONDITIONS` | 2 | off | A time-of-day slider and weather presets (Clear, Scattered, Overcast, Rain, Snow, Fog) in Pause, the title Settings sheet and the photo bar. Live by default; a pick lasts for the session; a time change glides over 1.5 s. Harness pins and curated Adventures still win | `verify-conditions.mjs` 6/6 |

Shipped without a flag (no look change): OpenStreetMap / OpenMapTiles / OpenFreeMap
credits and the live ADS-B feed's name in the credit bar, title and photo exports
(`verify-attribution.mjs` 4/4); no traffic polling from hidden tabs; the `?flags` /
`?sunUtc` / `?weather` / `?diag` switches; the shadow scene-walk measurement.

### Owner run list (Phase 0)

**Setup, once.** `git pull && npm ci`. For the iPhone, serve on your LAN:
`npm run dev -- -H 0.0.0.0`, or for representative performance
`npm run build && FLY_DEVICE_REPORTS=1 npm run start -- -H 0.0.0.0`. Open
`http://<your-PC-LAN-IP>:3000/...` on the phone.

1. **Baselines (most important).** On the iPhone and on the 5080, open `/?diag=1`,
   start a Free Flight, press **Benchmark 60 s** (hands off), then **Send report**.
   Do it once with no flags and once with
   `/?diag=1&flags=TWILIGHT_FIX,SUN_TRUE_AZ,HDR_GUARD,LOAD_GUARD,PLAYER_SURFACE,DEVICE_TIERS`.
   Reports land in `.graphics-review/device-reports/` on your PC; grade them with
   `node scripts/verify-device-report.mjs`. To hand them to me, paste that output,
   or `git add -f .graphics-review/device-reports && git commit && git push`.
   The report also answers two open questions: whether the iPhone supports reversed
   depth (`gpu.reversedDepth`, decides the Safari depth fallback) and what the
   per-frame shadow scene walk costs (`shadows.scanMs`).
2. **Sunset (`TWILIGHT_FIX`).** Free Flight over Manhattan, facing west, at
   `/?flags=TWILIGHT_FIX&sunUtc=2026-06-22T00:45:00Z` and the same with
   `-TWILIGHT_FIX`. Try `00:30`, `00:45` and `01:00`. Without the fix, a sun disc
   climbs into the sky as the real sun sets; with it, the sun sets and a moon
   appears on its own.
3. **Southern sun (`SUN_TRUE_AZ`).** Sydney at local noon,
   `/?flags=SUN_TRUE_AZ&sunUtc=2026-06-21T02:00:00Z`, versus `-SUN_TRUE_AZ`. With
   the fix the sun is in the north and building shadows point south; without it,
   the reverse.
4. **Black frames (`HDR_GUARD`).** On the 5080:
   `node scripts/verify-black-frames.cjs --url=http://localhost:3000` and again
   with `--flags=HDR_GUARD`.
5. **Loading (`LOAD_GUARD`).** With `/?flags=LOAD_GUARD&diag=1`, warp to a live
   airliner over open ocean (click it, then Warp). The streaming hold must end
   within 15 s, and boot within 20 s.
6. **One look (`PLAYER_SURFACE`).** With `/?flags=PLAYER_SURFACE`, Settings has no
   Visuals or Map style rows, Pause has no "Explore the new atmosphere", and warps
   show no confetti.
7. **Start tier (`DEVICE_TIERS`).** In a fresh browser profile (no saved quality),
   `/?flags=DEVICE_TIERS&diag=1`: the panel's tier reads `high` on the 5080. Watch
   for hitches when the game steps quality down.
8. **Credits.** On a phone, check the credit bar (now one line longer) does not
   collide with the joystick or the compass button.

### Phase 1 — what `TRUE_SCALE` does, and what to look for

**Mechanism.** The scene's horizontal axes are Web-Mercator units (true metres ×
k, k = 1/cos latitude) while heights are metres, so everything rendered k times
too flat. With the flag on, the camera's world matrix becomes T(p)·S⁻¹·R′ with
S = diag(1, k0, 1) at the player's latitude (`lib/fly/true-scale.js`): the GPU
sees the world k0 times taller, i.e. a uniformly scaled, true-proportioned copy
of it. Nothing that thinks in scene units changes — flight model, AGL, crashes,
runway contact, culling, three-tile LOD, click-to-inspect, HUD labels. Active
only in Enhanced satellite (k0 = 1 elsewhere, which is three's own camera).

**What had to follow the camera** (each one gated, each one `k0 = 1`-exact):
- Lights: the sun light and the shadow cascades travel along S⁻¹·(true sun) —
  a parallel projection in scene units is exactly the true one after S.
- three's env-map chunks (reflections, irradiance) and the app's own shaders
  that look at the sky: the cloud march and composite (sky, sun disc, moon,
  phase functions), the aerial haze, terrain and satellite water, aircraft
  vapor, tracer glints, and the Enhanced terrain relief normal (lit at its true
  steepness). Every edit is anchored and all-or-nothing per program; the device
  report lists each one (`trueScale.shaders`).
- The coastal reflection camera (same anisotropic view, mirrored).
- Camera-facing pieces: far-traffic dots, POI letters, contrails, vapor and
  tracer ribbons (they face the eye in true space).
- Metre-authored instances widened by k so they keep their shape: trees, cars
  and street poles, harbour boats, steam plumes, procedural landmarks and the
  marquee models; city glows, porch lights and airport beacons keep their
  on-screen shape.

**Known and accepted for now.**
- The mini-globe reads about k0× more curved (it is now drawn at its true 1,000
  km radius; before, the squash flattened it). Phase 2's EARTH_HORIZON replaces
  that radius with the real Earth.
- Haze looking steeply down is up to k0× thicker (it measures view distance);
  Phase 2's atmosphere replaces it.
- Ambient occlusion still works in scene units; rain falls in a k0× taller
  volume (the drops themselves are fine); Neon/Classic, the toy depth of field
  and the Classic sprite clouds are not converted (TRUE_SCALE is inactive there).
- The chase rigs already authored their offsets in true metres, so the camera
  now sits at its designed angle: a little higher behind the aircraft than you
  are used to. Tell me if you want it lower.

**What the container verified.** The node gate proves the matrix contract (the
anisotropic view of the scene equals a rigid camera viewing the true-scaled world,
culling and picking agree with it, lights and env lookups arrive at true angles,
billboards stay square, ribbons face the eye) and builds the app's own programs
with the flag on and off. In SwiftShader on the offline Sierra fixture
(k0 = 1.245), the flag-on build applied all ten shader edits, compiled with no
shader errors, and rendered the same frame as flag-off except for proportions: the
aircraft and the hills stand taller, sky, clouds and haze unchanged. How it looks
and how fast it runs is yours to judge.

### Owner run list (Phase 1)

Free Flight, Enhanced. For each place, compare `/?flags=TRUE_SCALE` with no flag
(Atlas search finds them all):

1. **Alps** — Zermatt / the Matterhorn (k0 1.44): the peaks should stand much
   taller; valleys deeper; no seams or swimming in the terrain while turning.
2. **Rockies** — Aspen / Maroon Bells (k0 1.29).
3. **Norway at 60°N** — Bergen or the Hardangerfjord (k0 2.0, the strongest
   case): fjord walls should be steep, not rolling hills.
4. **Equator control** — Quito or Mount Kenya (k0 ≈ 1.0): nothing should change.
5. **Sydney** — buildings and the bridge in proportion; shadows (with
   `SUN_TRUE_AZ`) fall the right way and are as long as the sun's height says.
6. **Your aircraft** — chase view: the plane no longer looks squat; contrails and
   vapor stay ribbons (not slivers) from every angle; far traffic dots stay round.
7. **Click-to-inspect** a few airliners, and check the HUD labels sit on them.
8. **One takeoff and landing at KCMH** with the flag on.
9. **Performance** — the `?diag=1` benchmark with and without the flag on the
   5080 and the iPhone (expected: no measurable difference).

### Phase 1b — `TRUE_AREAS`

The vector-tile worker gates buildings by footprint area in Mercator square
units (k² × true m²), so the same 100 m² house is 170 "m²" at 40°N and 100 at
the equator: small homes fall under the 120 floor near the equator, and big
buildings trip the 60,000 ceiling (and go flat) at high latitude. With the flag
on, the satellite building and skyline builders normalise every footprint to the
latitude those thresholds were tuned at (40°N), so Ohio and New York stay
within 2% of today and everywhere else matches them. Lengths, positions and coverage
ratios are untouched; the worker learns the flag per request, so a flag-off
request is the same message as before.

The gate builds a real suburban tile (Powell OH) and a real downtown tile
(Manhattan) in the real worker and serves the same bytes at other latitudes. Flag
off, the builder is blind to latitude (447 buildings kept whether the tile sits
at the equator, 40°N or 60°N, although those are 170 m² houses at the equator
and 42 m² sheds at 60°N). Flag on, the count follows true size (475 / 447 / 151),
and the skyline's area candidates do the same (126 / 120 / 51). At the tile's own
latitude on and off agree, and flag-off output is byte-identical.

**Run list (with `?flags=TRUE_AREAS`, best together with `TRUE_SCALE`):**
1. **Near the equator** — a suburb of Singapore, Quito or Lagos: more small
   homes than without the flag.
2. **Far north** — industrial edges of Oslo or Helsinki: large halls stay 3D
   instead of flattening into the ground.
3. **Home** — Columbus or Manhattan: nothing should change.

### Phase 2 — `CONDITIONS` (time and weather picker)

One resolver, `lib/fly/player-conditions.js`, decides the sun clock and the
weather, highest first: harness pins (`?sunUtc=`, `?weather=`, so every gate stays
deterministic), a curated Adventure's own conditions, the player's pick, then
Live. The time is a **local solar hour** (what the light depends on) applied at
the aircraft's longitude on today's date, so 07:00 means sunrise light wherever
you fly, and it stays that hour after a warp. With no pick the sun runs on the
real clock bit for bit. Weather presets feed the same weather model the live
feed does, so clouds, fog, rain and snow all follow.

**Run list (with `?flags=CONDITIONS`, best with `TWILIGHT_FIX,SUN_TRUE_AZ`):**
1. **Pause → Conditions:** drag the time from noon to 20:00. The sun should
   glide down over about a second and a half, not jump.
2. **Live:** press Live. The sun glides back to the real time and the label
   follows the clock.
3. **Weather:** try each preset. The change should arrive, not cut: fog and
   light within about 5 s, the cloud deck over about 10 s, rain or snow within
   about 2 s (Medium tier and up). Live returns to the real weather.
4. **Photo mode** (P): open the cloud-and-sun button. Golden hour plus Scattered
   should make a good shot.
5. **Curated Adventure:** start one. The panel should say the adventure sets its
   own conditions, and the controls should be disabled.
6. **iPhone:** the panel fits in the Settings sheet and above the photo pill,
   and the slider is easy to drag.

### A defect this pass caused, and its fix

`TRUE_AREAS` (`42c9ed7`) crashed every vector-tile worker in production
builds, so buildings, roads, the skyline and vegetation failed to load in
**every** build of `main` from `42c9ed7` until the fix. Flag state made no
difference: the crash happened when the module loaded. The cause: Next.js
compiles `typeof window` to `"object"` in client bundles, web workers included,
so `pinned()`'s bare guard disappeared, and the module-scope read in
`lib/fly/true-areas.js` threw `window is not defined` in all six workers. Node
does not apply that transform, so every node gate stayed green. The CONDITIONS
browser smoke caught it.

`pinned()` now reads `globalThis.window`, which the transform leaves alone and
which a worker simply lacks. The new `scripts/verify-worker-window.mjs` loads
both workers in node under the same rewrite and builds fixture tiles in them;
it is red on the old code and green now. It joins the pre-push checks.

### Found along the way (pre-existing, not caused by this pass)

- This container's clone is shallow; history-dependent gates need
  `git fetch --shallow-since=2026-08-01 origin main` first (done here).
- `verify-graphics-governor.mjs` crashes on `main` before this pass: its
  sandbox predates the cinematic effect rungs. `verify-device-tiers.mjs` now
  covers the ladder.
- `verify-cinematic-earth.mjs` fails on a stale aircraft-manifest assertion;
  `verify-r25-front-door.mjs` reads 68/2 on the untouched tree;
  `verify-r25-flight-plan.mjs` needs your local `r25-w0` tag.
- Also red on the untouched tree (checked with this pass's changes stashed):
  `verify-atmo-law.mjs` crashes in section [8] (`_state.livingAir` undefined);
  `r24-c-motion-unit.mjs` fails (f2); `verify-painterly-flight.mjs` and
  `verify-canopy-support.mjs` throw TypeErrors; `verify-world-art.mjs` fails an
  assertion. `components/fly/PoiLetters.jsx` carries two pre-existing
  react-hooks lint errors.

### Deferred until device data says so

- The Safari depth fallback (dynamic near plane): only if the iPhone report
  shows no reversed-depth support.
- Replacing the per-frame shadow scene walk with event-driven registration:
  only if `shadows.scanMs` is material on the phone.
- ASTC/KTX2 phone textures and an in-app texture-bytes census.

### Hero landmarks — licensing shortlist (Phase 0 item 14, waiting on you)

[TRUE_EARTH_LANDMARKS.md](TRUE_EARTH_LANDMARKS.md): 14 ranked picks (12 CC-BY
models, two to build in-house: the Sydney Harbour Bridge and the Giza pyramids),
the ones with no acceptable model, and the IP caveats (the Opera House Trust's
image policy, the Eiffel Tower's night lighting, Christ the Redeemer, skyscraper
trademarks). Every model host is blocked from this container, so each licence was
read from a search index, not the page itself: re-read each page before
downloading, and check the author and licence inside the downloaded file before it
is credited. Phase 5 builds only what you approve.

---

# Plan

## Context

Skyloom should get one more full **browser** pass before it is packaged as an app.
I studied the code, the design records and real-GPU captures. The core is strong: a
real-world globe with live ADS-B traffic, Adventures, Encounters and a nine-aircraft
fleet. It is not ready to ship, and several of the weaknesses you picked trace back to
concrete defects. These are your decisions:

- **Devices:** browser first, and it must feel great on gaming PCs, integrated-GPU
  laptops and modern phones.
  - Certify on your RTX 5080 (Chrome) and an A17 Pro-class iPhone (Safari).
- **Core:** "fly anywhere on Earth with real air traffic". The business model is
  undecided, so this pass does only cheap legal hygiene.
- **Visuals:** Enhanced only, in tiers: High (desktop dGPU), Medium (iGPU), Phone.
  - Neon and Classic are hidden from players; the code is kept.
- **World:** true proportions (1.0×); cities procedural first, plus 10–20
  license-checked hero landmarks.
- **Sky:** a physically based atmosphere with the stylized-cinematic grade on top,
  and a realistic Earth horizon (~200–400 km).
- **Cinematic:**
  - a time-of-day and weather picker, **Live by default**, plus photo mode v2;
  - replay with cinematic cameras and smooth blends, with clip export as the last
    replay step;
  - in-world arrivals and warps.
- **Gameplay:** take off and land at any real runway, both seamlessly in Free Flight
  and through a worldwide airport picker.
- **Workflow:** commit **straight to `main`** behind flags; you evaluate live builds.
- **Out of scope:**
  - native wrappers or app stores;
  - progression or economy;
  - gamepad, key remapping, onboarding;
  - skill-based traffic play;
  - audio;
  - cockpit view;
  - detail inside clouds;
  - provider contracts.

**Root causes confirmed in code during the study**

| What you see | Cause |
|---|---|
| Flat mountains, squat cities | Scene X/Z are in Mercator units but Y is in metres (`lib/fly/render-scale.js:1`, `lib/fly/coords.js`). Everything, the aircraft included, is squashed by cos(latitude): −24% at 40°N, −31% in the Alps, −50% at 60°N. This is the likely root of the earlier "poor mountain quality" report. |
| "Mini-globe" horizon and a wall of haze | The world curves on a 1,000 km sphere, 6.4× tighter than Earth (`satellite-visuals.js:12`). It also flattens with altitude (`fly-constants.js:1275`), and haze is forced on from 60–110 km (`AerialPerspective.jsx:507`, `fly-constants.js:1361-1396`). |
| The sun climbs into the sky at sunset | The sun disc and halo are drawn from the blended sun→moon key light (`cinema-environment.js:19-22`, `uCinemaKey` in `cinema-sky.js`). |
| Shadows point the wrong way in Sydney and Rio | `computeSun` returns the hour angle as `az` (`sun-model.js:72-105`), so the noon sun is always due south. |
| Washed-out lavender haze, dark aircraft bellies | The sky is a hand-tuned gradient that ignores altitude. The lower half of the environment map is near black (`CinemaEnvironmentRig.jsx:17`). |
| Long or hung loading screens | The "streaming world" hold has no time limit (`WarpFlash.jsx:41-62`, `BootScreen.jsx:212`). Open-water 404 tiles never count as ready (`earth-surface-engine.js:87-94,156`). A pending-download counter can get stuck (`vendor/three-tile/index.js:802-811`). |
| Risk of whole-screen black flashes | Nothing guards against NaN/Inf pixels before bloom (`BLACK_FLICKER_FIX.md`). |
| Legal gap | The satellite credits have no "© OpenStreetMap contributors" line (`tile-sources.js:200-211`). |

## How the work lands

- **Straight to `main`, in small commits.** Every workstream sits behind a pre-seeded
  `enabled:false` block at the end of `lib/fly/fly-constants.js`. With the flag off,
  output is byte-identical to today.
- **Live A/B without a console.** The iPhone has no console, so extend
  `lib/fly/fly-pins.js`:
  - `?flags=TRUE_SCALE,PHYS_SKY` (or `-FLAG` to force one off) sets the matching
    `window.__fly…Override` before mount.
  - A flag's default flips to on in its own one-line commit, after your run list passes.
- **Before every push:**
  - `npm ci` once per container;
  - scoped `npx eslint <changed files>`;
  - that phase's node checks;
  - `node scripts/verify-import-integrity.mjs`;
  - `FLY_TILE_FIXTURE=1 node scripts/verify-worker-window.mjs` (workers load and build
    under the Next.js `typeof window` rewrite);
  - the isolated build:
    `FLY_BUILD_DIR=.next-trueearth node node_modules/next/dist/bin/next build --webpack`.
- **One record document, `TRUE_EARTH_PASS.md`.** Per phase it lists what landed, the
  flags, your run list and the results.
  - Replace CLAUDE.md's stale top banner with a current-state notice that points to
    it. The banner still says Classic is the default and the R25 ground pass is off.
- **What the container can and can't check.** It has no real GPU, and
  Esri/OpenFreeMap/ADS-B are blocked. Agents check with node scripts, the offline world
  fixture and SwiftShader readbacks. Every look, feel and fps verdict is yours.

## Phase 0 — Foundations, defects, diagnostics (first)

**Defect fixes**
1. **TWILIGHT_FIX**
   - The key light **switches** from sun to moon near −4° instead of blending.
   - The sun disc and Mie halo use `uCinemaSun`; a new `uCinemaMoon` draws the moon.
   - The cascaded shadow maps (CSM) and the sun light follow the switched key.
   - Files: `cinema-environment.js:19-22`, `cinema-sky.js`, `cinema-frame.js:29-32`,
     `CinemaShadowRig.jsx:40`, `FlyScene.jsx:3394-3397`.
   - Check: extend `scripts/verify-one-sun.js` so the disc matches the sun direction
     from −10° to +6°.
2. **SUN_TRUE_AZ**
   - `computeSun` gains a true-azimuth direction `dir` plus the equation of time; the
     hour-angle `az` stays for older callers.
   - Move its consumers over: `cinema-environment.js:17`, `earth-surface-engine.js:62`,
     hillshade.
   - Update the sun continuously instead of every 60 s (`FlyScene.jsx:1716-1787`).
   - Check: NOAA reference positions for Sydney, Rio and Tromsø.
3. **HDR_GUARD**
   - Add `hdrSafe()`, which turns NaN, Inf and negative values into 0, on the
     cloud-composite and aerial-perspective outputs before bloom. No new pass.
   - Clamp parked landmark instances away from zero scale; a zero scale produced the
     NaN pixels in BLACK_FLICKER_FIX.md.
4. **LOAD_GUARD**
   - `no-data` slots count as ready (`earth-surface-engine.js:87-94`,
     `world-readiness.js`).
   - Retry stops re-queuing cached 404s (`EarthSurfaceLayer.jsx:23`).
   - A three-tile patch clears the stuck pending-download count (`index.js:802-811`,
     recorded in `VENDOR.md`).
   - Hard time limits: boot 20 s, warp 15 s. After that the world is revealed and the
     remaining detail keeps streaming in.
5. **Attribution.** Add OSM contributors and OpenFreeMap/OpenMapTiles to the
   satellite credit set (`tile-sources.js:200-211`). That set feeds the credit bar,
   the Credits panel and photo exports. Also update `CREDITS.md`.
6. **No background traffic polling.** Pause polling and ingest while
   `document.hidden` (`hooks/use-fly-traffic.js:88`).
7. **PLAYER_SURFACE (hide Neon and Classic)**
   - Show the Visuals and Map-style rows only in graphics review or dev
     (`SettingsRows.jsx:57-120`).
   - Saved toy/classic choices migrate to satellite/enhanced unless a pin is set
     (`map-style.js`, `visuals-profile.js`), so harness pins keep working.
   - Delete the review warps (`PauseMenu.jsx:157-171`) and show `WarpBurst` only in
     toy style.
8. **Per-frame CPU cost.** `CinemaShadowRig.jsx:43-44` walks the whole scene every
   frame. Register materials when tiles load and chunks finalize instead.

**Foundations**

9. **DEVICE_TIERS:** add `gpuClass()` to `lib/fly/device-class.js`, using
   `WEBGL_debug_renderer_info`.

   | GPU | Tier |
   |---|---|
   | Discrete NVIDIA, AMD RX, Intel Arc | High |
   | Intel UHD/Iris, AMD 680M/780M integrated, Adreno | Medium |
   | Apple GPU with a touch pointer | Phone |
   | SwiftShader, llvmpipe | Low |
   | Unknown desktop GPU | Medium |

   This replaces the `deviceMemory` guess (`fly-settings.js:40-44`; Safari never
   reports it). A 3 s calibration runs during the title orbit.
10. **Quality governor order**
    - Steps that only change values come first: render scale, cloud steps, bloom
        resolution, shadow-map size.
    - Steps that swap shader programs come last, and are prewarmed.
    - Files: `perf-governor.js:99-108`, `cinema-profile.js:25-32`, `prewarm.js:946-974`.
    - Check: `scripts/verify-graphics-governor.mjs` asserts no new shader programs
      across a full cycle.
11. **Diagnostics overlay:** `hud/DiagnosticsPanel.jsx`, opened with `?diag=1` or five
    taps on the version label.
    - It shows:
      - the FRAME_STATS ring (`lib/fly/frame-stats.js`);
      - tier, profile and DPR;
      - `renderer.info` and texture MiB;
      - extension support (reversed depth / `EXT_clip_control`, GPU timer query, ASTC);
      - readiness terms and network errors.
    - **Run benchmark:** a fixed 120 s route with the sun and weather pinned.
    - **Send report:** POSTs JSON to a dev-only route,
      `app/api/dev/device-report/route.js`, which writes it to
      `.graphics-review/device-reports/` on your PC.
      - This avoids the clipboard and share APIs, which need HTTPS that a LAN dev
        server lacks. There is also a selectable-text fallback.
    - `scripts/verify-device-report.mjs` grades a report against the tier table.
12. **Safari depth precision.** The depth setup falls back silently when reversed depth
    isn't supported (`world-bend.js:526-530`). If your iPhone's report shows no
    support, ship a dynamic near plane, clamp(0.02·AGL, 2.5 m, 60 m), and cap the Phone
    horizon before Phase 2.
13. **Compressed phone textures.** Add an ASTC/KTX2 variant of
    `public/materials/cinema-v1`, which is 114 MB of uncompressed RGBA on phones today
    (`cinema-material-assets.js:3-6`).
14. **Landmark licensing track (no code).**
    - Shortlist the 10–20 hero landmarks, Adventure routes first: Statue of Liberty,
      Empire State Building, One WTC, Sydney Opera House and Harbour Bridge, among others.
    - For each, list CC0/CC-BY candidate models with evidence, for your approval.

**Your run list**
- **RTX 5080:** `scripts/verify-black-frames.cjs`, plus boot and warp time to first
  reveal. Targets: boot ≤ 8 s, warp ≤ 6 s; hard limits 20 s and 15 s.
- **iPhone:** a baseline diagnostics report, which becomes the reference for every
  later phase.

## Phase 1 — True proportions (TRUE_SCALE)

**Approach: an anisotropic camera**
- The vertical correction S = diag(1, k0, 1) goes into the camera only, where k0 is
  `mercatorScale(camera latitude)`.
- The camera's world matrix becomes `T(p)·S⁻¹·R'`. Today's scene units then render
  with true proportions.
- Nothing else changes units. Physics, AGL, crashes, runway contact and HUD feet keep
  today's units. So do three-tile LOD and culling, raycasts, `Vector3.project` and CSM
  fitting.
- One k0 per frame means no seams between tiles. k0 = 1 is the identity, so flag-off
  matches today.
- Rejected alternatives:
  - rescaling every vertex height: hundreds of producers and consumers;
  - scaling a world-root group: 74 camera-vs-world CPU sites, and it breaks three-tile LOD.

**Mechanism**
- New `lib/fly/true-scale.js` provides:
  - `setTrueScaleK`;
  - `installTrueScaleCamera(cam)`, which overrides `updateMatrixWorld` and
    `updateWorldMatrix`; installed in the `onCreated` handler in `FlyCanvas.jsx` (~:183);
  - `toWorldDir` and `faceCameraMatrix`;
  - GLSL helpers `tsK()`, `tsDir()` and `tsNormal()`.
- k0 is set each frame after the camera rigs run (`FlyScene.jsx` ~2404).

**Places that must change**
- **Light directions** go through `toWorldDir`:
  - sun light, `FlyScene.jsx:3394`;
  - CSM, `CinemaShadowRig.jsx:40`;
  - hillshade, `FlyScene.jsx:1750,3397`;
  - wake, `aircraft-wake.js:200`.
- **World-space directions inside shaders:**
  - `immersive-cloud-pass.js:67,306,337`;
  - `AerialPerspective.jsx:487-491`;
  - `coastal-water.js:80-89`;
  - `earth-surface-material.js:428-433`;
  - the hillshade normal at `world-bend.js:1771,1804`;
  - three's env-map chunks, patched once (divide the reflection/normal Y by `tsK`).
- **Secondary cameras:**
  - the planar reflection camera (`coastal-reflection.js:35`) gets the same override;
  - N8AO's proxy cameras copy matrices rather than pose (`N8AO.jsx:246,387`);
  - the AO radius and the depth-of-field focus distance are multiplied by k0.
- **Camera-facing billboards and ribbons** switch to `faceCameraMatrix`: PoiLetters,
  TrafficTracers, Contrail, WarpBurst.
- **Instanced models** follow the existing `projectModelMatrix` convention
  (`render-scale.js:18-22`).
  - Already correct: PlayerPlane, TrafficLayer, detailed-traffic.
  - To audit: SatVegLayer, SatParcelHomes, SatClutterLayer, SatGroundDetailLayer,
    PlayerGroundShadow, living-forest, monuments.
- **Worker footprint filters** move to true m² (divide by k²) at
  `vector-tile.worker.js:1419-1425`.
  - This fixes missing small tropical homes and large buildings that go flat at high
    latitudes.
  - Bump WORKER_PROTOCOL at every pin site.
- **Near/far planes** are multiplied by k0. Retune the chase offsets
  (`SATELLITE_VISUALS.scale`).
- **Deliberately unchanged:** `flight-model.js:263`, `terrain-ground-query.js`,
  `cinema-geography.js`, the cloud `metric()`, HUD readouts.

**Order**
1. Module, camera override and node check.
2. Light directions.
3. Shader directions and the env-map chunk.
4. Secondary cameras and billboards.
5. Instanced-model audit.
6. Worker filters.
7. Retune.
8. Your sign-off, then flip the default.

**Checks** (`scripts/verify-true-scale.mjs`)
- k0 = 1 produces exactly three's own matrices.
- Project/unproject round-trips.
- Frustum culling produces identical sets.
- The player matrix has no shear.
- Every instanced layer's column ratio equals k.
- In SwiftShader, a 100 m cube renders 1:1 at 60°N.

**Your run list**
- Flag on/off stills over the Alps, the Rockies, Norway at 60°N, the equator (control)
  and Sydney.
- Check aircraft proportions, shadow length against sun elevation, and click-to-inspect
  on traffic.
- One takeoff and landing at KCMH.

## Phase 2 — Atmosphere, realistic horizon, conditions picker, shadows

**PHYS_SKY: lookup-table atmosphere (Hillaire 2020 method, WebGL2, RGBA16F targets)**
- New code: `lib/fly/atmosphere/` (parameters, table passes, GLSL, a CPU mirror) and
  `components/fly/AtmosphereRig.jsx`.
- The lookup tables:

  | Table | Size | Updated |
  |---|---|---|
  | Transmittance | 256×64 | when parameters change |
  | Multiple scattering | 32×32 | when parameters change |
  | Sky view (includes planet occlusion and ground albedo) | 192×108 | per frame |
  | Aerial perspective: 3D, indexed by direction, quadratic distance out to the horizon | 64×64×32 | 10–30 Hz; depends only on eye altitude and sun |

- **Consumers.** Keep the `cinemaSky(ray)` function name and swap its body under the
  flag, so these all switch together:
  - the cloud composite (`immersive-cloud-pass.js:306,337-338`);
  - aerial haze (`AerialPerspective.jsx:491-505`), via a new `atmoAerial(dir, dist)`;
  - water (`coastal-water.js:80`);
  - the lighting environment bake (`CinemaEnvironmentRig.jsx:17`). Real ground light in
    the lower half fixes the dark aircraft bellies.
- **Lighting values.** `cinema-environment.js` takes key colour and sun strength from
  the CPU transmittance mirror, and exposure from the measured brightness at the eye.
- **Cinematic grade:**
  - `cinema-art.js` becomes offsets on the physical parameters (Rayleigh, ozone, Mie g,
    turbidity by time of day), plus a sky-only saturation gain.
  - AgX and `HDRGradeEffect` are unchanged.
- In Enhanced, stop running `sky-model.js` and AERIAL_LAW; keep the code.
- Phone cost: about 0.1 ms per frame, averaged over the table updates.

**EARTH_HORIZON**
- Bend radius goes from 1,000 km to 6,371 km (`satellite-visuals.js:12`).
- Turn `GLOBE.altFlatten` off for satellite (`fly-constants.js:1275`).
- The world-edge fade (`fly-constants.js:1361-1366`) becomes a dither, placed by the
  horizon, into the lookup tables' ground. Remove the forced edge haze
  (`AerialPerspective.jsx:507`).
- Retune the traffic lift and the traffic horizon fade.
- **Far terrain ring,** via patches to the vendored three-tile:
  - a minimum vertex grid for tiles at zoom ≤ 10, added in the worker tail
    (`workers/skirt-tail.src.js`);
  - 128² imagery for zoom ≤ 9 tiles;
  - a separate residency lane for far tiles;
  - fallback if the budgets fail: a dedicated polar far-ring mesh.
- **Far clouds beyond 22 km:** one low-detail density sample on the curved cloud shell,
  with analytic optical depth (`immersive-cloud-pass.js`, `cloudRayBounds`).
- **NIGHT_LIGHTS:**
  - Source: NASA GIBS `VIIRS_Black_Marble` (public domain, keyless, zoom ≤ 8).
  - Stored in a band atlas cloned from the `_select` / `_pump` logic in
    `earth-surface-engine.js`.
  - Drawn as emissive light beyond the radius of today's generated city lights.
  - Credit NASA. The fixture serves synthetic tiles.

**CONDITIONS (time and weather picker)**
- New `lib/fly/player-conditions.js`, shaped like `adventure-environment.mjs`. The sun
  effect (`FlyScene.jsx:1710-1787`) and weather read one resolver.
- Precedence: harness pins, then curated adventure conditions, then the player's
  choice, then Live.
- **Live is the default.** A player's override lasts for the session.
- New `hud/ConditionsPanel.jsx`, shown in Pause, the title Settings sheet and
  `PhotoModeBar`. It offers:
  - Live;
  - a time slider, eased over 1.5 s;
  - weather presets: Clear, Scattered, Overcast, Rain, Snow, Fog.

**TERRAIN_SHADOW**
- A terrain-only far shadow cascade in `cinema-shadows.js` (terrain layer only, 2 Hz,
  texel-snapped), so mountains shade valleys.
- `PlayerPlane` receives shadows on High (`PlayerPlane.jsx:256`).

**Checks**
- The lookup tables, rendered in SwiftShader and read back, are within 3% of the CPU
  mirror and Hillaire's reference values.
- Conditions precedence.
- Far-tile vertex counts.
- Horizon dip at FL350 and FL450.

**Your run list**
- A matrix of noon, golden hour, night and overcast, at runway, 3 km, FL350 and FL450,
  over the Alps, open ocean and desert.
- The iPhone benchmark with each flag on.
- Confirm that GIBS tiles load (CORS) from your machine.

## Phase 3 — Take off and land anywhere (LAND_ANYWHERE; runs alongside Phase 2)

**Runway data**
- `scripts/build-runway-db.mjs` reads OurAirports `airports.csv` and `runways.csv`
  (public domain) and writes:
  - `public/data/runways/v1/z4/{x}/{y}.bin` — about 25k runways, roughly 1.2 MB in total;
  - a lazily loaded `index.bin` search index, about 0.5 MB gzipped.
- These are static files: cacheable on a CDN and servable by the fixture.
- **Getting the data (re: your "script to add the domains"):** a script inside this
  session can't widen its network policy, because the gateway outside the container
  enforces it. Two routes still work:
  - **Default:** agents attach the public GitHub repo `davidmegginson/ourairports-data`
    read-only through the session's repository tool. You approve that prompt, and they
    shallow-clone it.
  - **Fallback:** add `davidmegginson.github.io` under Allowed domains (cloud
    environment menu → Edit → Network access → Custom; keep the package-manager
    defaults), or run the script on your PC.
  - The container never needs GIBS: players' browsers fetch it at runtime.
- Check: `scripts/verify-runway-db.mjs` validates the schema and that KSFO, EGLL, RJTT
  and LFPG runway endpoints are within 30 m of reference values.

**Airport registry**
- `operations-airports.js` becomes `registerAirport` plus a spatial hash,
  `activeAirports(x, z, 20 km)`.
- The three Ohio airports stay "authored", with taxi routes and stands.
- **Runway height profile:**
  - Fit from the DEM once zoom ≥ 13 tiles are loaded; OurAirports elevation is the
    fallback.
  - Locked before final approach, so wheel contact never jumps.
- `operations-terrain.js` is rewritten with typed arrays and a per-frame budget.

**Runway visuals**
- Generalize the builder in `AirportOperationsLayer.jsx`:
  - the full digit set;
  - threshold bars by runway width;
  - touchdown-zone and aiming-point marks;
  - edge and approach lights;
  - PAPI lights, each white or red from your glidepath angle, computed in the shader.
- Replace the opaque `#777975` OSM runway base (`living-airports.js:11`) with a
  translucent tint at registered runways, so the real imagery shows through.

**Seamless handoff**
- Free Flight gets an operations profile; today it is null (`flight-operations.js:120`).
  This also fixes the touch-and-go daily, which today can only be completed in Ohio.
- **Approach funnel:** up to 8 km along the centreline, ±600 m to the side, gear down or
  the slow speed setting, and heading within ±35°.
  - Inside it, the 50 m floor (`flight-model.js:246-271`, `fly-constants.js:59`) gives
    way to the runway profile plus clearance.
  - The existing low-speed handoff (`flight-operations.js:123-129`) takes over the
    motion step.
  - Climbing past 150 m AGL hands control back to the arcade model.
- Any runway works for line-up and takeoff; runway length is checked against the
  aircraft's envelope (`player-aircraft.js`).

**Grading:** sink rate, centreline and aiming-point error, deviation from approach
speed, and rollout combine into a letter grade, with logbook entries per airport.

**Airport picker**
- The `<select>` in `GroundHangar.jsx:117-119` becomes a search (reusing the ranking in
  `lib/fly/poi/search.js`), plus Nearby and Featured lists.
  - Featured: Innsbruck, Lukla, Queenstown, Aspen, St Maarten, Haneda.
- The runway chooser defaults to the maximum headwind, using wind from `/api/weather`.
- Start options: on the Runway, on a 3, 5 or 10 nm final, or on the Apron (authored
  airports only).
- Atlas cards get "Land here" and "Take off here"; in flight, a "Nearest airports" chip.

**Checks**
- Funnel rules, continuity across the handoff, grading and the profile fit.
- A fixture browser run from approach to a full stop.

**Your run list**
- About 10 airports, including sloped and high fields (Lukla, Innsbruck, Aspen).
- Touch controls on the iPhone.

## Phase 4 — Cinematic

**CAMERA_DIRECTOR** (`lib/fly/camera-director.js`)
- Each camera rig writes a virtual camera; the director blends between them (smootherstep
  over 0.6–1.5 s, rotation slerp, FOV lerp, terrain clamp).
- This replaces the hard cuts at `FlyScene.jsx:2135,2145,2148-2151,2376-2379`.
- Cuts that can't be avoided (crash respawn) get a 200 ms exposure dip instead of a
  DOM flash.

**ARRIVAL_FLIGHT (in-world arrivals and warps)**
- **Far warp:**
  1. Rise and fade out over 1.2 s.
  2. Appear above the destination at the higher of the target altitude and 8 km, where
     low-zoom tiles stream quickly.
  3. Descend automatically at a pace set by world readiness, with orbit and flyby shots.
  4. Control returns on stick input, when the world is ready, or after 20 s.
- **Boot** reveals the title orbit as soon as the far ring and atmosphere are ready.
- **Local warps:** a director blend plus a post-process streak.
- **Boost** is throttled when streaming falls 3 or more zoom levels behind for 2 s.
- This replaces the satellite branch of `WarpFlash.jsx:41-62,350-356`, including the
  confetti.

**REPLAY** (`lib/fly/replay/`, `hud/ReplayBar.jsx`)
- **What is recorded:**

  | Data | Rate / scope | Size |
  |---|---|---|
  | Player: position from a float64 segment origin, attitude, speed, gear, flaps, throttle, operations phase, boost | 30 Hz | about 2.4 KB/s |
  | Traffic: raw ingest batches | within 80 km | about 1–3 KB/s |
  | Sun and weather snapshots | — | — |

  Recordings split into segments at warps. A 10-minute ring buffer is about 4 MB.
- **Playback:**
  - The simulation holds (flight model, operations and crash system skipped), and
    `flight` is driven from interpolated samples. Terrain, buildings, shadows and
    contrails follow it with no changes.
  - A second `TrafficEngine` is fed the recorded batches on the replay clock, so
    traffic motion reproduces exactly.
- **Cameras:**
  - chase and orbit;
  - flyby, which uses the recorded future path;
  - tower (nearest airport) and runway edge;
  - an auto-director that picks shots by flight phase.
- **Last step — clip export:** `canvas.captureStream` plus `MediaRecorder`.
  - MP4 (avc1) where `isTypeSupported` allows it (Safari, newer Chrome); otherwise WebM.
  - Length and resolution are capped.
  - No HUD; the map attribution is burned into the video.

**PHOTO_V2**
- A true pause: simulation, traffic clock and cloud motion all freeze.
- A free camera with terrain clamp, roll and focal length.
- ±3 EV exposure; depth of field with tap-to-focus; quick condition presets.
- High-resolution capture up to 4096 px, from 8–16 slightly offset renders combined
  for anti-aliasing, through the `toBlob` path in `PhotoCapture.jsx`.

**Checks**
- Blends are continuous.
- A replay round-trip is within 1 cm and 0.1°.
- Traffic replays deterministically.
- The memory cap holds.
- A fixture warp shows no DOM overlay.

**Your run list**
- How the blends and arrivals feel.
- Replay memory and one clip export on the iPhone.

## Phase 5 — Cities and landmarks (after the horizon, which uses triangle budget first)

**Cities**
- The skyline ring's minimum building height adapts to density: 35 m by default, 20 m
  in dense cores (`fly-constants.js:3154-3211`).
- More roof and facade families (`building-profiles.js`,
  `satellite-architecture-material.js`).
- Far city massing out to ~15 km, from WorldCover built-up data and the existing
  settlement-infill density, so a city no longer ends at a visible ring.
- Distant cities at night come from NIGHT_LIGHTS.

**Hero landmarks**
- 10–20 glTF models, compressed with meshopt and KTX2: ≤ 1.5 MB on High, ≤ 0.5 MB on
  Phone, two LODs each.
- License records go in `assets.js`; the runtime map goes in `monument-models.js`.
- Extend the `scripts/verify-icons.js` allowlist to require CC0, CC-BY or public domain,
  plus author, source and evidence.
- Models load within 25 km. The procedural shapes (`landmarks-3d.js:441-451`) remain
  the fallback.

**Checks:** the license check, and a triangle and texture count per tier.

**Your run list:** NYC, Paris, Dubai, Tokyo and Sydney stills, day and night.

## Per-tier budgets (certified with the Phase 0 tools)

| | High (dGPU, 1440p) | Medium (iGPU, 1080p) | Phone (A17 Pro) |
|---|---|---|---|
| Frame time | p95 ≤ 12 ms, p99 ≤ 20 ms, no frame > 100 ms | p95 ≤ 16.7 ms, p99 ≤ 33 ms | p95 ≤ 20 ms, ≤ 1 frame > 100 ms per minute |
| Render scale | 1.0 (DPR ≤ 1.5) | 0.75–1.0 | 0.8 (DPR cap 1.5) |
| Triangles / draw calls | 4.0 M / 450 | 2.2 M / 375 | 1.2 M / 250 |
| Texture memory | 600 MiB | 300 MiB | 220 MiB |
| Shadows | 3×2048 to 3 km, plus terrain 2048 to 40 km | 1×1024 to 800 m, plus terrain 1024 to 20 km | 1×1024 to 500 m |
| Cloud steps | 72 (96 on Ultra), plus far shell | 32, plus far shell | 24, plus far shell |
| Horizon / atmosphere update rate | 450 km / 30 Hz | 250 km / 15 Hz | 160 km / 10–15 Hz |

How each is certified:
- **RTX 5080:** `scripts/cert-tier.cjs` flies a fixed route per tier with FRAME_STATS
  and GPU timer queries. Medium is the 5080 forced to Medium, so only counts are
  meaningful.
- **iPhone:** in-app benchmark, then Send report, then `verify-device-report.mjs`.

## Final acceptance

On both devices, with every flag at its shipped default, fly a 20-minute flight:
- a warp to the Alps and one to Sydney at golden hour;
- a climb to FL350;
- a landing at a picker-chosen airport;
- a replay with a clip export;
- a photo.

It passes when:
- there are zero page errors;
- the frame budgets above hold;
- no loading hold exceeds its limit;
- the run lists in `TRUE_EARTH_PASS.md` are complete.

## Risks

- **No iGPU test device.**
  - Medium is certified on counts only, plus the iPhone forced to Medium at 1280×720 as
    a GPU stand-in.
  - Unknown desktop GPUs default to Medium with a fast governor.
  - Before any public launch, buy a Radeon 780M or Iris Xe mini-PC (about $400–600).
- **TRUE_SCALE reach.** Parts of three assume a rigid camera: env-map chunks, sprites,
  CSM.
  - Covered by the node check and your on/off A/B; the flag stays off until you sign off.
- **Far-ring cost.** Triangles already exceed 2.2 M at the 95th percentile on the 5080.
  The far ring has a fallback mesh, and the Phone horizon is capped at 160 km.
- **Providers.** Esri, OpenFreeMap and the ADS-B feeds remain keyless and unlicensed
  while the business model is undecided. GIBS adds one more keyless host.
- **Straight to main.** Flags default to off and the isolated build runs before every
  push, which keeps `main` shippable. A flag flips only after your run list passes.

# Scale and nearby experiences

Implemented against the existing Fleet & Adventures working tree, October 5, 2026.

## Player experience

- Settings now offers **World / Close** chase composition. World is the default:
  58° base FOV and a nominal aircraft width of 15%, or 18% for large transports.
  Close retains the previous composition targets. Neither choice changes physics.
- Player and live aircraft use the same physical-to-map conversion as terrain:
  rotate in metres first, then project the horizontal basis. This preserves
  height during banking and avoids latitude-dependent shape distortion.
  The fitted camera distance and player ground shadow use that conversion too.
- The old 1.75× enlargement is removed from traffic **geometry**. Distant traffic
  indicators retain their visibility treatment. Actual ADS-B positions are unchanged.
- **Nearby** in Free Flight offers reachable live aircraft and twelve local
  discoveries, two in each existing adventure region. The local experiences reuse
  authored course/photo content; they do not launch an adventure or teleport.
- Crossing Paths uses fresh airborne ADS-B contacts only. No aircraft are spawned.
  Accepting does not take controls. Assistance is an explicit action and cannot
  replace another selected target. Thirty seconds alongside earns a memory;
  stale data cannot earn time and a lost contact ends the activity.
- Local courses are offered only when terrain is known along sampled approaches
  and gates with at least 150 m clearance. This is eligibility sampling, not a
  guarantee against arbitrary detours, buildings, or later DEM refinement.
- Invitations last twelve seconds, with at least three minutes between offers.
  The initial quiet period is thirty seconds. Ignored/dismissed experiences are
  suppressed for that location/session until the next warp. Menus, operations,
  adventures, photo mode and existing assisted flight suppress invitations.
- The logbook's **Memories** tab retains the latest 200 records. Up to 24 locally
  stored 640px JPEG thumbnails live separately in IndexedDB. JSON backups include
  journal records, not image bytes; missing/evicted photos do not erase memories.

## Implementation boundaries

`lib/fly/encounters.mjs` owns candidate rules, course progression and the pure
controller. `encounter-runtime.js` adapts existing flight/traffic services and
publishes discrete events; candidate evaluation runs once per second. It never
writes aircraft positions or manufactures traffic fixes. Guidance shares the
frame-synchronized HUD canvas. Photo validation snapshots the camera and epoch
in the same render task as the pixels, requires known terrain along the sightline,
and credits only successful encoding for the same encounter token.

`fly-encounters-v1` is a separate versioned, whitelisted progress record. Existing
saves need no migration and existing adventure/contract/passport state is preserved.
Storage failures keep memories available for the session and backup export.

The browser review also reproduced a pre-existing CinemaShadows lifecycle defect:
disposing a material removed its ownership record without restoring its shader
hook. Re-adopting it installed cascades twice and threw every render. Disposal now
restores the prior hook, program key and defines. The new regression failed before
the fix with the same `lights_pars_begin` error and passes afterward.

## Verification

- `node scripts/verify-encounters.mjs`: ten grouped checks, including all 54 local
  courses through normal FlightModel inputs and geometry measurements of all
  eighteen desktop/mobile aircraft variants. Course rehearsals use fixture ground.
- `node scripts/verify-encounter-runtime.mjs`: assistance ownership, world loading,
  photo pauses, capture validation, adventure isolation, persistence and teardown.
- Existing adventure-runtime, adventure-photo, operations (33), flight-plan (44),
  and cinema-overhaul (16, including the new lifecycle regression) checks pass.
- Scoped ESLint has no errors. Existing FlyScene/LabelCanvas warnings remain.
- Production build uses the repository's existing isolated-build configuration:
  `$env:FLY_BUILD_DIR='.next-encounters'; node node_modules/next/dist/bin/next build --webpack`.
  The ordinary Node 25 webpack-cache path fails in the documented WasmHash path;
  the isolated configuration disables that cache. Font fetching requires network.
- `scripts/review-encounters.mjs` captures World/Close comparisons, exercises the
  real browser UI, and attempts live encounters without injected aircraft.
  Local evidence is under `.graphics-review/encounters/`.

World/Close screenshots confirm the smaller default aircraft composition over
Manhattan. Human enjoyment, a ten-minute flying review, physical-phone usability,
and a paired pre-change performance verdict remain separate acceptance work.
Do not describe fixture flight rehearsals or rAF timings as those results.

### Live browser evidence

- The final general review reports zero page errors, six World/Close captures
  (Skylark, Vector, Leviathan), a local course eligible against live DEM, the
  Memories tab, and no horizontal overflow at 390×844. This viewport check is
  not physical-phone certification.
- A real feed contact (`~2ad261`) disappeared during the live encounter attempt.
  The activity ended without a reward. This verifies loss handling, not successful
  completion with that contact; the report deliberately retains the incomplete row.
- The Canyon course completed through steering/pitch/cruise inputs in 74.99 wall
  seconds, minimum observed AGL 803.31 m. No position, timestep, speed or progress
  was overwritten after the initial test approach. Record: `live-flight.json`.
- The first photo run found that an authored panorama altitude could sit below
  refined terrain. The encounter now follows adventure photography's surface
  adjustment while retaining the stricter known-terrain sightline requirement.
  A fresh real-shutter run saved a photo memory and IndexedDB thumbnail, rendered
  the thumbnail in the journal and retained the memory after reload, with zero
  page errors. Record: `live-photo.json`; screenshot: `earned-memories.png`.
- `scripts/benchmark-encounters.mjs` compares encounters enabled/disabled on the
  final tree with actual rendered-frame counters and per-tick CPU observations.
  This isolates encounter overhead; it is not a pre-change graphics benchmark.
  On the RTX 5080 at 1440×900, DPR 1, High, the off/on/on/off samples measured
  frame-time p95s of 16.9/17.8/15.3/15.6 ms. The mean enabled/disabled p95 ratio
  was 1.0185 (+1.85%, within the 10% target). Programs stayed at 140 and textures
  at 273; geometries settled at 283. Encounter tick p95 was 0.1 ms in all arms,
  with enabled-arm maximum ticks of 14.0 and 10.7 ms during candidate scans.
  There were zero page errors. These observations cover this scene and hardware,
  not every location or a full pre-change performance comparison. Record:
  `performance.json`.

## Visual follow-through: stylized cinematic

The first implementation changed scale and activities, not atmosphere or surface
appearance. The user then explicitly selected **stylized cinematic: stronger
colors and dramatic atmosphere**. This follow-through applies to Enhanced
Satellite; the existing Classic and Neon paths remain separate.

- A shared scene-linear art profile now supplies warmer direct light, cooler
  skylight, a deeper blue zenith, amber/rose dusk and more distinct cloud interiors.
  The sky, lighting environment, aerial perspective and water reflections consume
  the same profile. Full night radiance is unchanged, and fog/overcast still veil
  the clear-weather palette.
- The existing volumetric clouds get stronger self-shadow separation and bounded
  silver edges using the same density and light samples.
- Terrain retains the real imagery while gaining material-specific pigment and
  derivative-filtered rock strata. Facades gain stronger color separation and
  resolved structural panels. This is material/shader work, not a new texture pack;
  no new asset downloads, texture allocations or render passes were added.
- The default cloud base was a fixed 1,500 m **MSL**, which could place the camera
  inside a cloud over elevated scenery even under the baseline weather preset.
  The estimated deck now adds settled regional ground elevation. It seeds after
  warp loading, resamples after 20 km and eases at no more than 4 m/s; climbing
  the aircraft or rebasing the origin does not move the deck. Curated adventure
  conditions still override it. The weather feed does not supply a measured
  cloud-base altitude, so this remains a presentation estimate.

Verification and evidence:

- `verify-cinema-art.mjs`: four grouped checks cover continuous radiance through
  weather/day/night, preserved full-night and fog colors, Enhanced-only ownership,
  review baseline identity, and cloud datum behavior across warps and rebases.
- `verify-cinema-overhaul.mjs` and `verify-cinematic-flight.mjs`: 16/16 each.
  `verify-r25-ground.mjs`: 42 pass, zero fail, one not calibrated because the
  standalone GLSL validator is absent. Actual browser shader checks are separate.
- Scoped ESLint passes. The isolated production build passes with
  `FLY_BUILD_DIR=.next-visual-pass`.
- Untouched pre-edit captures are in `.graphics-review/visual-pass/before/`.
  `review-cinema-art.mjs` then captured same-session A/B pairs with fixed sun,
  weather inputs, pose and frozen cloud drift. The art-disabled arm reproduces
  the prior environment; `window.__flyCinemaArt=0` is a development/review control,
  not a player setting. Do not confuse these with the earlier World/Close shots.
- Four city pairs (day, golden, overcast, night) hold the same quality profile and
  identical texture/program counts within each pair. The first canyon comparison
  stopped on a quaternion difference of about 1e-16; the instrument now allows
  1e-9 quaternion/FOV roundoff and 1 mm position error. Its original failed row is
  retained in `paired/report.json`.
- The final canyon pair passes that check. The estimated cloud base changes from
  1,500 m to 2,671.03 m, and the camera's cloud-density indicator falls from 0.16
  to zero, revealing the terrain. Both arms retain 279 textures. This difference
  is the cloud-height correction, not a change to the weather input or camera.
- RTX 5080, 1440×900, DPR 1, High: art off/on/on/off p95 rendered-frame intervals
  are 12.5/12.5/12.5/12.4 ms. This one-scene observation is not a universal FPS
  guarantee. Raw evidence: `final-checks/report.json`.
- Mobile viewport captures at 390×844, DPR 2 exercise the phone profile in
  daylight, golden hour and overcast, with zero reported errors. They retain the
  phone allocation limits; this is not a physical-phone performance measurement.
  Evidence: `mobile/report.json`.
- Mode switches select Classic, Neon and Enhanced correctly, but changing to
  Classic reproducibly logs `GL_INVALID_VALUE: glGetProgramiv: Program object
  expected`, including with the new art disabled. No JavaScript exception or
  shader compilation failure was recorded, and tracing the exposed program
  queries did not identify an invalid handle. The cause remains unresolved;
  this is not claimed as a clean mode-switch certification. Evidence:
  `mode-check`, `mode-trace`, and `mode-lifetime`.

## Cloud grain and high-altitude imagery follow-up

The user's Ohio screenshot was reproduced at 39.4175 N, 83.4768 W,
32,548 ft MSL. The large pale square remained through a 60-second stationary
capture: 98 resident terrain tiles, zero downloads pending. Source inspection
confirmed a pale higher-zoom capture next to green lower-zoom imagery; this was
a settled imagery seam, not a stuck download queue.

- Enhanced Satellite now uses the existing rolling z11 color-reference atlas
  at cruise altitude. It borrows broad color while preserving finer imagery
  and DEM geometry. The gain ramps from zero at 2,500 m AGL to one at 6,000 m;
  low flight does not allocate a new atlas. A previously allocated atlas stays
  bounded at 1 MiB on descent and stops requesting new slots. Classic/Neon
  cleanup and restoration retain the correct texture binding.
- The previous linear-light ratio clamp of 0.5–2 could not correct this seasonal
  exposure difference. Cinema's cruise correction uses finite bounds of 0.12–8;
  other reference consumers retain their original bounds. The shared reference
  has 64 slots and four concurrent fetches. Missing reference data falls back
  to the source imagery; the window edge is feathered. This reduces the observed
  LOD boundary, but does not promise to remove every seam within provider imagery.
- Clouds now reconstruct premultiplied radiance and transmission with a 5×5
  Gaussian in Enhanced, still rejecting real scene-depth edges. The existing
  3×3 path remains the Classic path. Raymarch budgets, noise field, two render
  passes and texture allocations are unchanged; no temporal history is added.

Evidence and checks:

- `.graphics-review/high-warp/final/`: same-session reference off/on screenshots,
  plus low-altitude return, climb with changed heading and a Grand Canyon cruise
  warp. All reference slots settled, altitude gains were correct and no browser
  or shader errors were recorded. Earlier baseline and limited-clamp attempts
  remain in adjacent folders. `scripts/review-high-warp.mjs` reproduces the route.
- `.graphics-review/cloud-smoothing/final/`: fixed sun, weather, camera and cloud
  drift; the High profile and renderer texture/program counts match. Cloud-region
  high-frequency RMS at the actual cloud-texel spacing falls 3.8484 → 1.3890
  (63.9%). Clear terrain's mean luma difference is 0.0151/255. A single-output-pixel
  metric mostly measures the unchanged final dither, so both spacings are recorded
  in `pixel-metrics.json`. This is a scene-specific grain measurement, not a
  general image-quality score.
- High, 1440×900, DPR 1, RTX 5080: smoothing off/on/on/off p95 rendered-frame
  intervals are 12.6/12.6/12.5/12.5 ms. An earlier run was invalidated by source
  hot reload during measurement and is retained in `verified/` with its errors.
- `.graphics-review/cloud-smoothing/phone/`: 390×844, DPR 2, phone-balanced
  (28 steps), same 206 textures and 119 programs across the flip; zero browser
  or shader errors. This is desktop mobile emulation, not physical-phone timing.
- `verify-cruise-color.mjs` checks lazy allocation, the memory bound, continuous
  altitude gain, quiet descent and texture restoration/cleanup. Cinema-art 4/4,
  cinema-overhaul 16/16 and cinematic-flight 16/16 pass. R25 ground: 42 pass,
  zero fail, one not calibrated (standalone GLSL validator absent). Scoped lint
  and whitespace checks pass. The earlier Classic program-query warning remains
  a separate known limitation; this follow-up does not certify that switch.
- Production build passes with `FLY_BUILD_DIR=.next-visual-pass`; log:
  `.graphics-review/high-warp/build.log`. The development server remains on 3091.

# Cinematic Earth overhaul

## September 30, 2026: HDR graphics pass

Enhanced now uses the shared cinematic renderer by default (`CINEMA_SHIPPING`
is true). Saved Classic preferences and the explicit
`/?graphicsReview=1&earthLook=current` comparison remain available. The user's
HDR overhaul request supersedes the preview-only shipping state recorded below.

The pass adds stronger scene-linear sunlight, open cool shade, weather-aware
exposure, a directional sky aureole and twilight belt, filtered stars and a
bright solar disc. Clouds gain bounded forward/back scattering and interior
fill using their existing density samples. Buildings gain filtered glazing
roughness, bowed glass highlights, neutral dielectric reflections and recessed
interior lighting; facade emission and pavement spill share the same gain.
Player and traffic condensation gain stable billows, optical density and the
same sun/moon color, direction and exposure as the world. A small display grade
follows AgX and merges into the existing pass. The established quality profiles,
worker protocol, simulation and geographic providers remain intact.

This is scene-linear HDR through the existing half-float compositor and filmic
output. It does not add native PQ/HLG monitor output. Classic-to-Enhanced now
loads the cloud volume lazily even when the cloud pass was created in Classic.

Validation on Windows Chrome / RTX 5080, with live geographic providers:

- Production build, targeted ESLint, and import-integrity sweep: pass.
- Aircraft/effects: 14 checks; cinematic renderer: 15; tracer checks: 32;
  graphics material/coverage checks: pass. The tracer source reader now
  normalizes Windows line endings; shader-cache assertions use the new keys.
- `verify-hdr-flight.cjs`: 16 desktop checks and 16 phone-emulation checks,
  including default activation, all applicable quality tiers, shared vapor
  uniforms and Classic-to-Enhanced. No page, shader compile or WebGL errors.
  Existing ANGLE warnings in the Classic control are retained in the report.
- Manhattan day/golden/overcast/night and production Alps day/golden/night
  captures: completed without shader/page errors. Evidence lives under
  `.graphics-review/hdr-overhaul/`, with source hashes in each report.

The desktop motion leg is 40 seconds; the phone viewport leg is 20 seconds on
the desktop GPU. These are integration checks, not physical-phone or 4K
15-minute performance certification. No performance ceiling has been changed.

## Original September 29 sample record

Built from `5987abfba127ffb4626aa439263ba5b4e7d6f759` on
`codex/cinematic-earth-overhaul`. This is the implementation/review checkpoint
for delivery steps 1–3, **not worldwide promotion or hardware certification**.
The user approved the repaired visual sample and requested its merge into
`main` on September 29, 2026. `CINEMA_SHIPPING` stays false for this merge:
the reviewed path remains available through the comparison URL while the
recorded performance and worldwide-expansion gates remain open.

## Art direction

Ground and clouds use the same **stylized naturalism**: real geographic forms
and local color, broad readable lighting, cool open-sky shadows, warm direct
light, restrained small detail, and common atmospheric distance separation.
Cloud banks must not read as smooth cartoon icons above photographic scenery.
Their shared, periodic density field uses broad coverage masks and an original
64³ cellular volume, with rounded billows, irregular edges, darker interiors,
and continuous density. Repeated crown/shoulder ellipsoids have been removed.
The GPU march, cloud shadows, and CPU cloud-passage reader use the same bytes
and morphology. Major shapes do not depend on device quality.

Terrain keeps the real imagery and classified material identity. The new path
preserves native-LOD imagery detail and real glacier/rock patterns, replaces
flat natural-class pigment with geographic albedo, and adds filtered triplanar
rock relief on steep faces. Natural category weights are continuous. Desktop
uses the existing finer DEM mesh tolerances (15/6 m at z13/z14); phone keeps
its mesh policy. Decoded DEM normals drive actual surface lighting. Unknown classes
retain their imagery fallback. No new roads, coastlines, parcels, or collision
geometry are inferred from the visual treatment.

## Implemented sample

- One frame-owned environment supplies the sun/moon key, fill, sky radiance,
  atmosphere, exposure, cloud colors, and night state. Terrain's old hillshade
  multiplier, duplicate fill/fog, and ground brightness normalization are
  bypassed on this path. AgX follows the single exposure stage.
- Visible sky, sky reflections, and PMREM environment lighting evaluate the
  same sky function. PMREM updates are bounded and blend between owned targets.
- Material-local cascaded shadows preserve existing hooks, reversed depth and
  world bending. Ultra has three 2048 maps over 3 physical km; High has two
  1024 maps. Phone has one nearby 1024 map. Low retains the shared key without
  cascades. Cached shader uniforms survive cascade-count changes.
- Water follows the shared sky and broad sun/moon highlights. Existing
  non-repeating waves and selective architectural reflections are retained.
  Reflection allocation follows the effective profile; phones use sky water.
- Original MIT material arrays have 128/256/512/1024 variants. BC3 plus complete
  mip chains is selected where supported; RGBA is the fallback. Selection
  precedes loading and GPU allocation. The manifest records content hashes.
- Terrain classification/appearance atlas packing frees sampler units for
  three cascades without altering its bytes, identities or worker protocol.
- Aircraft materials/canopy and camera presentation follow the same light.
  Camera roll and shake are restrained. Existing comfort controls suppress
  roll, shake, boost FOV and distortion. Flight/collision parameters are intact.
- The ordinary HUD prioritizes speed, AGL and throttle. Spotting restores more
  labels, trails and telemetry; selected traffic remains discoverable.
- One effective render profile controls clouds, shadows, reflection targets,
  material variants and postprocessing. The governor reduces three levels of
  effects before resolution or scenery. Phone targets 30 fps and cannot select
  desktop Ultra assets. Storage failure still resolves Medium and the normal
  satellite world; controls-help storage access no longer aborts startup.
- Owned resource census, context restoration, target disposal, and an explicit
  current/cinematic review dock are included.

Geographic providers, stable IDs, API routes, raw tile cache, worker payloads,
rebasing, chunk fading/healing and simulation interfaces are unchanged.
The existing regional buildings, landmark assets, vegetation placement and
street/entrance-light receivers are reused in this sample. New regional model
families, connected forest authoring, and broader asset variants remain work
for the post-approval expansion; they are not claimed as delivered here.

## Profiles and ceilings

| Profile | Cloud steps / pixel cap | Shadows | Architectural reflections | Material size |
| --- | --- | --- | --- | --- |
| Ultra | 96 / 2,073,600 | 3 × 2048, 3 km | 1024 × 512 | 1024 |
| High | 72 / 1,105,920 | 2 × 1024, 1.8 km | 768 × 512 | 512 |
| Phone Medium | 32 / 360,000 | 1 × 1024, 500 m | sky only | 256 |
| Low | 16 / 160,000 | shared directional key | sky only | 128 |

Ultra ceilings are 768 MiB textures/renderbuffers, 256 MiB attached geometry,
900 draws and eight million submitted triangles across all passes. Historical
lower-profile limits have not been raised. Native 4K acceptance fails if the
governor reduces resolution or the requested Ultra effects. Counters are
limits, not resource targets. Logical ownership census and real GL allocation
peaks are separate instruments; neither is driver-resident VRAM.

## Verification and evidence

- Production build succeeds. `verify-cinema-overhaul.mjs`: 15/15; environment
  continuity, phone policy, effects-first governor, real Three CSM hook/cache
  lifecycle, compressed payloads, density periodicity/coverage, and byte-exact
  atlas packing, curved cloud intersections, AO depth, reflection startup,
  session persistence and resource generations across context loss.
  `verify-import-integrity.mjs`: 755 files, 4/4 gates.
- `verify-cinema-cloud-gpu.mjs` compiles the actual cloud-density GLSL and
  compares 4,096 GPU samples against the CPU field. Maximum density difference
  is 0.000859; the 128-km rebase wrap differs by at most 0.00000537. Nonempty
  samples are required, so an empty-volume upload cannot pass this check.
- The installed Chrome reports **ANGLE / NVIDIA GeForce RTX 5080 / D3D11**,
  with 16 fragment samplers. This is hardware WebGL, not a software fixture.
- Real full-scene validation found and repaired a terrain sampler overflow,
  a missing forest uniform declaration, and cached CSM uniform-array mismatch
  after quality changes. The repaired scene has rendered all cascade counts,
  resize, and context loss/restoration with zero shader/page errors.
- `verify-cinema-textures.cjs` renders all eight BC3 size/material variants,
  all eight layers, and complete mip chains on the GPU. The existing GPU water
  test verifies non-repeating wave motion, rebase wrap and distant filtering.
- `cinema-sample.cjs` records matched real-world poses, solar date/elevation,
  weather, effective profile, canvas resolution, resources and served build
  receipts. It asserts that the requested cinematic path is actually active.
  Stills hold flight for settling; eight-second canvas recordings restore
  ordinary motion and include boost. They do not include the DOM HUD; stills do.
- Current-build captures come from an independently built original checkout:
  build `rsqXNGPuD7XAFVZs4ynL-`, source SHA-256
  `4a6e2ed5126539029f53f802304ed180e83234c33daee5c27f8f241843ffe326`.
  The exact `servedBuild.sourceSha256` in each JSON report is authoritative.

The local evidence directory is `.graphics-review/cinema-overhaul/` (ignored,
not application assets). `sample/index.html` presents the matched stills and
flight clips after `node scripts/cinema-review-gallery.cjs`. JSON reports,
including failed early probes, are retained; superseded captures are not
presented as the current result.

The rejected checkpoint was build `j5uDV_xRddXoL6fpKgmgZ`, served locally on
port **3084**. The user reported cloud artifacts and poor mountain quality.
The complete matched `cohesive-manhattan` / `cohesive-alps` recordings precede
the last cloud refinement (build `-sj85odUuSbSjX9VqFiiJ`). Keep these identities
distinct when comparing a recording with the live preview.

The older blocked-storage phone probe recorded 108.80 MiB peak combined GL
allocations. It is superseded by the final repair check below; neither run is
a physical-phone timing result.

### Cloud and mountain repair — September 29

The user's screenshots expose diagonal cloud integration bands. The single
pixel jitter reused along each ray has been replaced by independent, static
per-step stratification. Curved-world ray bounds now include all valid cloud
intervals instead of clipping against a flat slab. Atmospheric entry uses the
same bounds and latitude scale. No temporal history or blur was introduced.

The 512-KiB original cloud volume is generated by
`node scripts/build-cinema-cloud.mjs`; its MIT metadata and SHA-256 accompany
the asset. CPU passage and GPU density agree numerically. The first repair
capture exposed immutable 3D texture storage still sized to the 1³ placeholder;
disposing that allocation before uploading the 64³ image repaired the empty
clouds. Failed probes remain under `repair/` and `repair2/`.

Stricter browser warnings exposed two additional defects during verification:
new shadow maps were unavailable to the first architectural reflection after
a quality switch, and N8AO's installed denoiser did not honor reversed depth.
Reflections now wait for initialized shadow maps. The cinematic denoiser
converts both depth reads and uses explicit texture LOD in its divergent loop.
Cloud volume reads also use explicit LOD. Dependency files remain untouched.
ANGLE X4122 constant-folding notices are retained as informational warnings;
shader errors, undefined derivatives and invalid GL operations fail the probe.

`repair3/` contains the first full four-condition Manhattan and Alps captures,
but those runs correctly **fail** the newly exposed warning/transition checks.
Build `LY5f8haVEoEL1Iq8E9Uh9` contains the subsequent fixes; its final scene,
motion, mobile and lifecycle results are recorded separately under `repair4/`.
The 90-second motion probe uses ordinary steering inputs and flight physics
with altitude feedback, sustained banks and boost. It records actual camera
cloud density, altitude and origin epochs as well as video. It is an artifact
inspection, not an endurance or performance certificate.

Follow-up probes under `repair4/`–`repair5/` exposed late disposal of obsolete
WebGL handles after context restoration and blocked writes in the automatic
passport/atlas/contract persistence. GPU allocation/deletion now records the
context generation: lost-context storage has already been destroyed, so late
disposal retires its handle without issuing an invalid delete in the restored
context. Current-generation resources still use normal deletion. No draw or
GL-error calls are suppressed. PMREM releases its owned targets at context
loss and rebuilds on restore. This follows the [WebGL context restoration
contract](https://registry.khronos.org/webgl/specs/latest/1.0/#5.15.2).
Progress stores retain session state when persistent storage is unavailable.

The first motion automation used the virtual-stick sign incorrectly and never
climbed; its corrected Manhattan run crossed 900–4,505 m and two rebases with
zero rendering errors, but stayed in a cloud gap. Both are retained as failed
cloud-entry evidence. The next probe stages a real Jersey City approach that
intersects an existing bank, without modifying density or geographic content.

Build `RoyTLmn7518-FshiIYvLO` includes these repairs; final captures and checks
are stored under `repair6/`. The live preview on port **3084** now serves this
build, verified by its HTTP receipt (200), source SHA-256
`e63a0a64cb7d9c1dbec96a3211d8598e1a475af5d301f35cfc70d9fd00c9738a`.
Open `http://localhost:3084/?graphicsReview=1&earthLook=cinematic` and refresh
any tab that still has the rejected build loaded.

Final functional results on this exact build:

- Manhattan and Bernese Alps: daylight, golden hour, overcast and moonlight
  captures, with zero page, shader or invalid-GL errors. Alpine daylight and
  night also have short moving recordings. Actual images were inspected.
- The 90-second Jersey City cloud flight reaches measured camera density 1,
  climbs from 900 to 4,505 m, descends, and crosses one origin rebase. Cloud
  entry and exit, sustained banks and boost are recorded in
  `manhattan/cloud-motion.webm`; representative entry frames were inspected.
  The diagonal integration pattern from the user's screenshots is absent in
  these captures. This does not certify every possible viewing angle.
- Low → Medium → High → Ultra applies 0/1/2/3 cascades and 16/32/72/96 cloud
  steps. Resize and context restoration pass, including a visible restored
  cloud volume and regenerated environment lighting.
- Phone emulation, with both storage reads and writes blocked and compressed
  textures unavailable: boots, uses 30 fps policy, 32 cloud steps, one shadow
  map, only the 256 RGBA surface arrays plus the shared 512-KiB cloud volume.
  Peak audited GL texture/renderbuffer allocation is 111,989,994 bytes
  (106.80 MiB), with no unknown or untracked allocations. The HUD was visually
  rechecked. These are policy/layout/allocation findings on the desktop GPU.
- Grand Canyon daylight: rendering check passes with zero errors, but the
  staged pose is inside a cloud bank and the capture is strongly obscured.
  It is not accepted evidence of final dry-terrain appearance. Thin distant
  horizon artifacts also remain visible in that capture and need attribution
  during the wider terrain/readiness pass.

Report status `REVIEW_REQUIRED` records the state when these checks ran:
functional checks passed, with artistic acceptance then pending. The user
subsequently approved this repaired sample and requested the merge into main.
That approval does not certify the complete overhaul, native-4K endurance or
physical-phone acceptance.

### Native 4K diagnostic — not a pass

`4k-diagnostic.json` records a 60-second moving flight on the RTX 5080, build
`-sj85odUuSbSjX9VqFiiJ`, with the cinematic path active and native resolution
retained. Frame p95 is **12.6 ms**, p99 **37.4 ms**, GPU p95 **10.67 ms**.
Submitted p95 is 314 draws / 6,104,122 triangles. It **fails** the requested
acceptance: p99 is over budget, the initial effective profile is High before
Ultra resumes, attached geometry reaches **286.96 MiB**, and the periodic
logical texture/renderbuffer census reaches **959.16 MiB**. The census requires
allocation-audit attribution, but it is not a reason to waive the ceiling.
There is one rebase, 9.8 km of ground travel, no teleports and no page/shader
errors. This is a useful optimization diagnosis, not a 15-minute certificate.
Do not describe the average fps as proof of sustained 4K/60.

## Review and remaining gates

Run the app and open `/?graphicsReview=1&earthLook=cinematic`; the comparison
dock stages Manhattan, the Bernese Alps or Grand Canyon and switches daylight,
golden hour, overcast and moonlight. `earthLook=current` reloads the current
presentation. Select Ultra in Settings for the desktop sample.

The repaired sample has the user's visual approval. The recorded motion clips
and matching playable build remain available for comparison during expansion.
Remaining work includes rural Ohio,
Tokyo, Melbourne, tropical coast, desert, airports/high altitude, regional
families/forest stands, Low/phone contact shading, wider device variants and
the full motion/readiness/revisit matrix.

Desktop acceptance still requires separate **15-minute daylight and night**
flights at native 3840×2160: frame p95 ≤16.7 ms, p99 ≤33.3 ms, GPU p95 ≤12 ms.
Short diagnostics are not acceptance. Mobile acceptance requires physical
iPhone 13 / Pixel 7 class devices, p95 ≤33.3 ms, p99 ≤66.7 ms and thermal
endurance. Browser emulation only verifies policy, layout and allocation.

Do not promote Enhanced or delete the superseded treatment until artistic,
functional and hardware outcomes have each been recorded. The shipping switch
and reload-based current/new comparison provide rollback during this checkpoint.

## Visual finish pass — September 30, 2026

This pass follows the user's request to finish the eight visual-polish areas
before adding game features. It builds on the merged HDR presentation.

- The first-party Vector v2 airframe has conformal canopy frames, control-surface
  joints, service panels, recognition markings and recessed engine throats.
  Hero/mobile geometry remains six material draws: 8,444 / 3,148 triangles.
  Versioned asset URLs avoid stale immutable downloads.
- Cloud banks vary in width, height and wind shear. Separate body and erosion
  frequencies produce larger forms and broken edges; unresolved erosion fades
  with the march footprint. Interior extinction and fill separate shaded cores
  from bright edges without increasing step counts or target dimensions.
  Cloud-shadow contrast follows the existing air-transmission law, reducing
  dark cloud silhouettes over the already-hazed distant terrain.
- Surface-atlas neighbours are validated by geographic identity. Packed
  appearance interpolation carries readiness per texel across tile boundaries;
  classification no longer recolors whole rectangles of satellite albedo.
  The far hydrology band changes from z9 to z11, retaining the 48-slot, 6-MiB
  mask ceiling. Coastlines are still limited by source classification resolution.
- Office spandrels, industrial ribs, masonry plinths and roof seams reinforce
  existing building families. Every procedural frequency retires at its own
  pixel footprint. Daylight haze and sunset warmth are restrained; night
  structure recedes behind window and pavement sources.
- Exhaust histories publish age to the shader. Older plumes widen, curl and
  develop softer, interrupted edges. Fresh wing vapor stays narrow; Classic
  retains its original ribbon geometry behavior. Storage remains bounded.
- Quiet flight suppresses ordinary labels and navigation ribbons, and reduces
  far traffic glints. Selected/hovered aircraft retain details; every aircraft
  remains pickable and Spotting restores the full overlay immediately.
  Fully invisible navigation ribbons skip their GPU draw while their histories
  continue recording; selecting an aircraft restores its ribbon.
- Chase-camera damping now stores its orientation before optical shake, so the
  previous frame's shake cannot accumulate in the next frame's camera pose.

Moving review also exposed repeated city submissions and an accounting defect.
Building body/roof indices now precede facade trim; the optional metadata remains
compatible with protocol 23 and missing metadata falls back to the full mesh.
Auxiliary captures omit sub-metre trim. Spatial index ranges share vertex data
and reject only out-of-frustum sections, coalescing adjacent visible ranges.
Whole-building drape, mapped bodies, roof shapes and collision columns remain
intact. Nearby color views retain trim; unresolved trim retires with hysteresis.
Spatial ranges retain their own height bounds, padded by the largest measured
terrain-contact displacement. Reusing the whole tile's maximum height for every
range admitted invisible low-rise geometry beside skyscrapers. A complete
legacy redrape refreshes the ranges' height references. Height refinement alone
did not meet the moving triangle budget. The final bounds also use the live
curvature uniform and each region's actual building-anchor envelope, with a
one-metre precision margin; the historical coarse sphere remains as an outer
guard. Forest tiles now keep conservative bounds through births and terrain
repairs, testing the color and shadow cameras independently. No tree or building
is removed from the world. Smaller 8/16-cell partitions were rejected after a
same-scene diagnostic showed that their draw-call cost exceeded the profile.
Reflections now use reserved layer 28; layer 29 remains exclusive to airborne
overlays. Their previous collision admitted traffic markers and contrails into
architectural captures. The reflection regression includes an excluded overlay.

Repeated production boots exposed another startup race: R3F's boolean `shadows`
selects deprecated PCFSoft, while three r185 normalizes it only inside the shadow
render. An earlier auxiliary draw compiled `SHADOWMAP_TYPE_BASIC` but received
PCF comparison textures (the sampler audit captured both bindings). FlyCanvas
now selects `percentage` explicitly, matching the already-settled PCF mode.
Failed production boots and their diagnostic captures remain in the evidence;
the later four-boot `startup-fixed` run verifies the correction.

The resource census now counts depth textures with their actual component width
and does not also invent a single-sample depth renderbuffer for the same target.
The independent GL allocation audit is retained; logical ownership and driver
VRAM are still different measurements. No profile ceiling was raised.

Regression coverage includes `verify-visual-finish.mjs` (12 checks),
`verify-quiet-flight.cjs` (synthetic traffic, real rendering and picking),
`verify-city-water.mjs`, `verify-living-earth.mjs`, `verify-cinema-overhaul.mjs`,
`verify-stylized-earth.mjs`, `verify-cinematic-earth.mjs`,
`verify-aircraft-effects.mjs`, `verify-tracer-spot.mjs`, graphics-unit and import
integrity. `soak-visual-finish.cjs` adds actual control input across day/night
city flights, mountains, cruise altitude and a city revisit, retaining every
sample and checking the historical p95 submission ceilings and heap-floor gate.
The final production build is `tDnQNeDY1QitLKdtiO95u`, with source SHA-256
`484e6806a88a0c224e647a7cf48a92c7919907114b5627562d776bd6e3ae71d4`.
The HTTP receipt is matched to the loaded Next document, and the browser reports
ANGLE / NVIDIA RTX 5080 / Direct3D11. Evidence is under
`.graphics-review/visual-finish/` (local generated captures, excluded from Git).

- `final-hdr-verified/report.json`: 17/17 on the final build, zero page/shader/
  invalid-GL errors and no incompatible sampler bindings. All four presets,
  saved Classic to Enhanced, and real cruise vapor pass. The short cruise
  records 6,698 frames with p95 6.8 ms / p99 12.0 ms and 764 populated wake
  vertices, oldest visible age 32.28 seconds. Baseline ANGLE constant-folding
  warnings and a Classic-path derivative warning remain recorded separately.
- `final-hdr-certified/report.json`: earlier 17/17, zero page/shader/invalid-GL errors
  and no incompatible sampler bindings. Low/Medium/High/Ultra, saved Classic
  to Enhanced, and 40 seconds of ordinary cruise all pass. The player wake has
  764 populated vertices and an oldest visible sample age of 32.44 seconds.
  Frame p95 is 10.4 ms in this short run, not an endurance claim. This and
  `final-city-certified` used build `HKaRkcSW_T-wjqM520ufr` / source
  `6e54725d078b84c49b3d12562d0a660a10253d6d33dc9aff16e68b9b37c10235`,
  before the final conservative bounds and invisible-ribbon draw suppression.
- `startup-fixed/report.json`: four repeated production starts pass after the
  shadow-mode correction, with the sampler observer enabled. This predates only
  the subsequent cloud-shadow haze adjustment.
- `final-lifecycle-verified/report.json`: day/night, all four presets, resize to
  1280×720, and forced context loss/recovery pass on the final build. Clouds,
  environment lighting and matching composer buffers recover. Zero rendering
  errors; one informational ANGLE constant-folding warning. The script reports
  `REVIEW_REQUIRED` for its artistic checkpoint; the day, night and restored
  captures were inspected inline after its functional checks completed.
- `final-city-certified/report.json`: daylight, golden hour, overcast and night
  rendering pass, as do four quality settings, resize, and forced context loss /
  recovery. Recovered clouds, environment map and composer buffers are verified.
  The generic sample script's `REVIEW_REQUIRED` status means artistic review;
  the day, golden-hour and night images were inspected inline in this session.
- `final-phone-verified/report.json`: day/night phone policy and layout pass on
  the final build in desktop emulation: 162/165 draws, 128.14/130.14 MiB logical
  textures/targets, one cascade, 256 material arrays, matching buffers, HUD in
  bounds, no desktop material downloads and zero rendering errors. Its captures
  were inspected; physical-phone thermal/performance behavior is not measured.
- `final-phone/report.json`: earlier day/night phone policy and layout pass on desktop
  emulation: 30-fps policy, one cascade, 256 material arrays, matching buffers,
  HUD in bounds, no desktop material downloads, and zero rendering errors.
  This run predates the explicit PCF selector and cloud-shadow haze adjustment.
- `quiet-final/report.json`: 8/8 with injected traffic on live geography: retained
  tracks, reduced far marker, hidden ordinary overlays, immediate Spotting
  restoration, hover, inspector selection and selected-ribbon restoration.
  This is not a live-feed load test.
- Targeted ESLint passes for the changed graphics modules and harnesses.
  FlyCanvas retains three baseline `react-hooks/immutability` findings on its
  existing imperative runtime bus; the same three were reproduced from HEAD.
  With that one rule excluded for FlyCanvas, no additional lint findings occur.
- `final-soak-certified/report.json`: interrupted after four settled triangle
  overages; `night-bounds-check/report.json`: failed before the curvature and
  forest culling correction. Neither is a completed endurance pass.
- `final-soak-verified/report.json`: PASS, 90 ten-second samples over 907 seconds
  of actual flight, across night/day city routes, mountains, 10.5-km cruise and
  a city revisit. High / DPR 1 / 1920×1080 throughout, 204–694 traffic tracks,
  20 moving origin rebases, zero rendering errors and no buffer mismatches.
  Settled p95 submissions: **2,144,883 triangles ≤2,200,000**, **311 draws ≤375**;
  peak textures/targets **282.26 MiB ≤300 MiB**. Two individual night samples
  exceeded the triangle ceiling and remain in `budgetOverages`; the existing
  gate is p95, not a per-frame maximum. The p95 of the ten-second frame-p95
  windows is **12.6 ms**. Mixed-route heap floors did not climb; this does not
  equate different locations' heaps or measure physical driver VRAM.

Physical-phone thermal behavior and physical-display tearing cannot be certified
by desktop Chrome emulation. The historical native-4K endurance gates above are
not replaced by a 1080p run or a short diagnostic.

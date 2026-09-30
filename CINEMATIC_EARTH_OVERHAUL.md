# Cinematic Earth overhaul — visual sample

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

# Stylized Earth — graphics and terrain overhaul

The user reviewed the running sample on September 14 and replied **"SO MUCH
BETTER! KEEP GOING!"** The accepted treatment is now the standard Satellite
appearance, including ordinary saved selections and old bookmarks. Neon remains
the separate existing style. The user requested publication to main on September
14. Representative integrated-GPU performance acceptance remains unavailable.

Open `/stylized-earth-review.html` on the production server for location, altitude,
time/weather and Satellite/Neon review controls. These controls belong to the
review page. The game keeps its existing flight controls, saved Satellite choice,
traffic, providers and real-time sun/weather behavior.

## Accepted rollout

The same general pipeline now covers glacier, dune, wetland, tropical coast,
dense-city and sparse-building fixtures, in addition to the five original sample
locations. There are no location-specific rendering rules. The temporary URL
switch has been retired; `earth=stylized` remains a harmless old bookmark and
cannot create a third mode.

The surface classifier follows the provider's documented
[landcover classes and subclasses](https://openmaptiles.org/schema/#landcover).
Scrub/heath/fell/tundra receive a muted dry vegetation palette; wetlands and tidal
flats remain ground surfaces, not invented open water. Even `landcover=grass`
with a `park` subclass remains unclassified. Seasonal water and wet ground exclude
inferred props; mapped roads and footprints retain their imagery. These additions
use the same 48 slots / 6 MiB, draw count and 160-instance maximum. Derived mask
revision is 2; worker protocol stays 21 and compatible raw tile caches stay intact.

`verify-earth-data.mjs` passes on 18 actual provider tiles across all six worldwide
fixtures. The expected glacier/sand/wetland/water/developed classes are present
in every relevant fixture; unclassified cells are counted honestly and retain
imagery. This is real-data evidence, not a rendered-image or performance claim.

## Implementation

### One ground surface, including water

The Lake Erie reference reproduced a large diagonal, differently shaded water
sheet. The old water draw depended on the nearest building tile ring and used
separate polygon geometry. A color adjustment cannot make that coverage continuous.
In the new treatment, water is shaded on the actual rendered terrain. Its vertices,
elevation, curvature, refinement and adjoining boundaries are therefore the
terrain's own; no independent flat water sheet can cut through that terrain.
There is no extra water draw or reflection render target.

An independent surface streamer keeps three toroidal bands: z9/128px,
z12/128px, z14/256px, each 4×4 tiles. The three RGBA8 atlases use exactly 6 MiB,
with no mip allocation. At most two worker requests are in flight; at most one
completed slot is finalized per frame. Coarse coverage survives missing detail;
failed requests retry. Recycled slots reject late results. The outer edges and
new classifications blend gradually. Successful finer data can retire a coarser
water outline even when fine landcover is unclassified. Missing tiles do not
manufacture either ocean or vegetation.

Water follows the provider's terrain elevation instead of imposing one global
sea-level plane. Rivers keep their elevation gradient and inland lakes retain
the DEM's level. This does not invent or repair missing provider bathymetry.
Subpixel shore detail remains limited by the source data and mask resolution.

Worker protocol is 21 at the producer and all six existing consumers. The new
surface result includes classification, placement exclusions, water edge metadata,
and its own revision. Derived masks are rebuilt, with no persistent derived cache
to migrate. Compatible raw raster/vector caches are retained.

Existing terrain code preserves children when a merge is cancelled and retries
resident raster failures. The new failure tests exposed a further gap: failed
replacement imagery could still displace valid coverage. Refinement now retains
a valid parent if any child image fails; a failed merge retains its descendants;
a failed material retry retains the last valid image. LOD replacement retries
back off through 1/2/4/8/16/30 seconds, with staging disposal and epoch-safe commits.
Three old-code failures become four focused checks green, alongside the unchanged
14 merge and 20 raster-retry checks.

Sustained urban flight exposed a separate residency defect: the controller read
the removed `TILES.lruBudgetBytes` key and fell back to `Infinity`. Its default is
now finite (140 MB), with an explicit 120 MiB terrain geometry/texture allowance
for Satellite, restored correctly across style switches. Only offscreen
subtrees are elected and the existing valid-parent replacement lifecycle remains
responsible for releasing descendants. Visible coverage takes priority, so this
controller is a memory brake rather than an instantaneous hard cap; the complete
300 MiB allocation audit remains the acceptance gate.

A three-minute CPU diagnostic attributed about 35 seconds to building-contact
raycasts. Satellite now queries height directly from the same rendered
triangles, rejecting XY misses before interpolation. It keeps nearest-hit
semantics for overlapping parents/children, material sides, and draw ranges;
unsupported transforms fall back to the ordinary raycast. No height caching or
geometry/physics change is involved. The new query matched 875 synthetic real-mesh
comparisons and 400 actual streamed samples across Erie, Elyria, Hudson and Owens
(maximum difference 1.5e-12 m). Those isolated CPU samples took 8–10 times less
time; this is query timing, not an integrated-GPU frame-rate claim.

A separate real terrain hole was isolated over the Hudson at 40.7472, -74.0168.
Entirely negative DEM tiles (about -1.2 m maximum elevation) produced empty
visibility boxes. The terrain walker hid valid resident meshes. Surface bounds
now include the minimum elevation before skirt assembly, with correct cache
invalidation after refinement/rebasing. Positive-only tiles retain their old
bounds. The fixed-pose water-region pixel check changed from 100% black before
the fix to 0% black after; normal culling stays enabled. This is distinct from
Lake Erie's independent water-sheet boundary.

Worldwide review exposed another provider edge case in Namibia: fine DEM tiles
contained a finite LERC no-data sentinel near -3.4e38. A finite-number check alone
had admitted it as elevation, producing enormous terrain curtains. The loader now
rejects missing samples before meshing and requests measured parent elevation for
the same geographic footprint, retaining fine imagery. Missing-data caching is
bounded and distinguishes an entirely absent tile from one missing quadrant;
valid neighbouring quadrants remain usable. Completely invalid raw DEM cache
entries are evicted, while compatible raw data stays intact. If every allowed
parent is unavailable, the existing valid terrain remains. Ten focused checks
cover this path, including byte identity for healthy geometry.

The last lifecycle review reproduced four more failure cases: generic DEM
transport/decoder errors still substituted flat geometry, parallel material work
could outlive failed geometry cleanup, sibling loads could outlive failed
refinement cleanup, and rejected DEM merges lacked bounded retry delay. Both
parallel branches and all siblings now settle before cleanup; geometry errors
retain measured ground and failed refinement/merge attempts use bounded backoff.
`verify-dem-lifecycle.mjs` changes from 0/4 to 4/4, including disposal and recovery;
existing merge 14/14 and raster retry 20/20 remain green.

The original `world/biomes` report is explicitly FAIL after visual inspection
revealed this defect; its earlier finite-only verdict is retained as instrument
history. The repaired six-biome `world-dem/biomes` run passed geometry and budget
checks before the final scenery adjustment. Final evidence lives in `complete/`.

### Materials, scenery and light

`lib/fly/stylized-earth.js` centralizes the accepted palette and resource profiles,
consumed through the existing immersive profile system. Explicit landcover and
landuse drive grass, woodland, fields, rock, sand, snow and developed surfaces.
Administrative park boundaries remain unclassified. Imagery supplies geographic
variation and road/footprint detail, with a restrained fallback for sparse data.

Surface detail and woodland shading use repeating analytic patterns rather than
additional bitmap textures. Integer spatial frequencies keep their phase stable
through floating-origin changes; derivative filtering retires unresolved detail.
The same palettes carry through the three distance bands. Existing distant canopy
and building mass systems remain responsible for scenery at cruise altitude.

Trees use the shared solid lobed canopy/trunk mesh instead of overlapping leaf
cards. Existing tree forms, instances, mapped placements and distant transitions
remain. Satellite's legacy park-derived tree scatter is removed, and grass scatter
excludes scrub, tundra and administrative boundaries. The redundant separate tint
overlay is retired. Hydrology-only wetland/tidal classifications use a restrained
blend so dry pans retain their actual imagery. One additional bounded instanced mesh supplies shrubs and flatter stones
from supported woodland/rock/sand masks. Roads, water, building footprints and
landmarks exclude placements. Support checks are capped at 16 per frame with
retry backoff; scenery settles onto the same rendered ground support path.

Existing mapped roof geometry and building families gain stronger wall/roof
separation and warmer material balance. Known footprints/heights are preserved.
Existing nearby contact shading, bounded shadows, building night emission,
road lighting and atmosphere compose with the new terrain treatment.

Moving review exposed a separate legacy contact-shadow defect: its white RGB
texture faded only alpha, while Three's `alphaMap` reads green. The result was a
hard oval on water. The texture now fades opaque grayscale in green, preserving
its size, allocation and draw cost. The production old-code probe measured edge
green 255 (opaque) despite alpha 5; the new probe checks the channel the shader
actually consumes. The change applies to Satellite's existing contact shadow.

Sunlight, ambient fill and water response use true solar elevation and the existing
weather state. Water uses restrained analytic ripples and approximate sky/sun
response. Satellite reduces high-tier cloud rendering to 40% per axis/64 steps
and high-tier shadow maps to 1024. Lighting HDRs are area-filtered in linear HDR
to 512 pixels wide before GPU upload, reducing both source and generated cube
allocations. No new downloaded assets or paid services are introduced.

### Flight and quality

The chase camera moves closer and higher and looks less far ahead. Airframe
scale, flight physics and geographical elevation remain unchanged. Aircraft-specific
camera scaling and reduced-motion behavior are retained.

The existing governor reduces optional effects and resolution before scene detail,
with a 75% minimum internal scale at a 1080p output. HUD rendering remains at output
resolution. The independent surface/water layer is present at every quality tier;
Satellite buildings/roads/skyline retain the existing low-tier coverage contract.

## Build and verification record

- Branch: `codex/stylized-earth`, based on `9295cc365bc548975e988079fcf1ed92ec6703e1`.
- Release production build: `no6lqYTQo4mmRaHZj9If5`, source
  `a9d5d0fa08c317fdbb59674f7ab2a2fa3b0ea82d1484dc431958b2502bbee788`,
  `.next-stylized-earth-release`; compilation succeeded in 14.1 seconds.
  This adds only the final DEM failure lifecycle repair. Port 3033 serves this
  build; `release/` holds its sustained-flight results.
- Worldwide visual build: `UcTR3rb3nSMcfeDZAkjxf`, source
  `0f89f686272daba1f3c0307dc5b692ba5bc72d924d92bd4a28d958117bd76f6c`,
  `.next-stylized-earth-complete`; compilation succeeded in 10.5 seconds.
  `complete/` holds its worldwide, style, quality and moving-review evidence.
  Its daytime soak was stopped for the failure-path repair and is explicitly
  BLOCKED; it must not be presented as a completed performance run.
- Earlier worldwide production build: `I-J5PEPBKMTPO1Uyr4KCK`, source
  `cf8bfcb84787f343f57921365da73aa904cff2a90f2c8091dedc2d2fa044a965`,
  `.next-stylized-earth-world`; compilation succeeded in 32.6 seconds. Port 3033
  previously served this build. `world/` holds its evidence before the regional
  DEM and final vegetation fixes; its timing verdict is not inherited by `complete/`.
- Baseline build: `vuL4DO0MaHx4rAHFF-QmW`, source
  `44ba8657f54205ddcb9d2c35ad8810c31d7eb4c62673adab5514269643b9670b`.
- Contact-shadow sample build: `3KHhgMHgItGBv7ZrWbFEw`, source
  `350924c9ad163161eb76aa9c145b53db3fcc860aeb43eece35dfc51e2453eb14`,
  `.next-stylized-earth-sample`; build succeeded in 17.0 seconds, port 3030.
- Integrated production build: `pp8O4Zecho12zpx6Vh4v1`, source
  `6ccc80a0ff02a4ef7694083cf7a4ffacda39eb7c66d2a92043fe53fd20d7f530`,
  `.next-stylized-earth-integrated`; build succeeded in 15.3 seconds, port 3033.
  This adds the finite residency budget, exact contact-query optimization, and
  raster-failure coverage lifecycle. `integrated/` contains its browser evidence.
- The `review/` evidence is build `qUaihEReoLRgY4_ZLJZD3`, source
  `087773ff7f0f24111b4cdfa0fbc9db4de064a3b3f9a4710720f37fc5d094978a`.
  It includes the bounds fix; `sample/` adds the contact-shadow gradient stops.
  Later `contact/` and `budget/` runs identify the intervening diagnostic builds.
  Earlier `final/` and `v2-matrix/` evidence predates the bounds fix.
- Build receipts bind the actual loaded Next document to the source hash. Review
  HTML and test scripts are outside that application source hash.
- `verify-stylized-earth.mjs`: 21/21; classification, holes/winding, water edges,
  exclusions, unknown data, phase stability, HDR radiance, memory/request bounds,
  stale responses, finer shore refinement, disposal, protocol agreement, default
  selection, administrative park subclasses, wetlands, seasonal water and
  rejection of old derived-mask revisions.
- `verify-earth-scenery.mjs`: solid canopy geometry stays within 58 triangles
  and is finite/nondegenerate. Scrub geometry stays within 18 triangles with
  deterministic placements, water/road/footprint exclusions, rendered support,
  bounded instances and geometry/material disposal. Support resolves over frames,
  respecting the 16-query-per-frame cap.
- Existing gates: terrain merge 14/14; raster retry 20/20; near ground 20/20;
  near support 15/15; graphics unit PASS; immersive unit PASS; mobile action node
  checks 8/8. Existing thresholds were not changed.
- Negative terrain bounds 7/7, calibrated against five old-code failures;
  main/worker skirt identity 9/9; vendor integrity 34/34. The LERC worker tail
  now preserves the existing optional error-table argument; both worker source
  shapes are checked. Worker-normal/skirt feature flags remain unchanged.
- Terrain budget 6/6, calibrated against four failures in the old controller;
  existing real-vendor residency policy 40/40, merge lifecycle 14/14 and raster
  retry 20/20 remain green. Allocation instrumentation passes its existing 24
  synthetic GL cases. Budget/engine/profile targeted lint passes.
- Targeted ESLint passed on the new runtime modules/layer and modified camera,
  canopy, lighting, cloud, prewarm and architecture modules. This is not a
  whole-repository lint claim. The six existing worker consumers, worker and
  SatBuildingLayer also pass. Broader checks report 23 errors/1 warning in FlyScene
  and 2 errors in SatEnvironment; linting those same files from baseline HEAD
  reproduces the same counts/rules. SatVegLayer similarly reports five existing
  hook/immutability errors on both baseline and current source. Baseline and
  current JSON reports are retained; no unrelated lint rules were disabled.
- `verify-graphics-governor.mjs` has an existing failure: its legacy-URL case
  expects 144 FPS while the current unconditional Satellite controller targets
  60. Its test and all four source dependencies are byte-unchanged from HEAD
  (`git diff --exit-code` clean). No assertion was relaxed; actual production
  ladder behavior is covered separately by `graphics-quality.cjs`.

Capture, moving-flight, quality, browser recovery and review-control results are
recorded under `.graphics-review/stylized-earth/`. Final browser results are
recorded below. Fixed-pose captures hold the governor only for comparable
images; sustained flights leave terrain and quality management unpinned.

### Browser evidence

- `release/night-flight.json`: PASS, completed 900 seconds on the same release
  source at 1920×1080, high tier and DPR 1. Frame p95 8.4 ms / p99 12.6 ms;
  GPU p95 5.57 ms; 151,915 measured frames, maximum 41.7 ms, no browser long
  tasks or rendering errors. Complete texture peak 275.07 MiB; renderbuffers
  3.48 MiB separately; unique scene geometry/instance attribute estimate
  145.87 MiB. Draw p95 219, triangle p95 1,463,608, within the unchanged limits.
  Actual travel 182.41 km, minimum measured speed 197.84 m/s, 23 rebases,
  309–445 live aircraft; no crashes, teleports or missing-image markers.
  All four quality transitions retain required layers. No subsystem pins,
  video or profiler. Current source hash matches both served-build receipts.
  These are completed desktop runs; integrated-hardware acceptance remains open.
- `release/day-flight.json`: PASS, completed 900 seconds on the release build
  at 1920×1080, high tier and DPR 1. Frame p95 8.4 ms / p99 12.6 ms; GPU p95
  5.60 ms; 150,478 measured frames, maximum 37.6 ms, no browser long tasks or
  rendering errors. Complete texture peak 268.73 MiB, renderbuffers 3.48 MiB
  separately, unique scene geometry/instance attribute estimate 146.14 MiB.
  Draw p95 214 and triangle p95 1,211,969, within unchanged 375 / 2,200,000 limits.
  Actual travel 182.46 km, minimum measured speed 197.94 m/s, 23 rebases,
  290–373 live aircraft; no crashes, teleports or missing-image markers. All four
  post-flight quality transitions retain buildings, roads and skyline. No
  subsystem pins, video or profiler. RTX 5080 evidence only, not 780M acceptance.
- `release/namib`: PASS on the release build, 238 resident terrain nodes, no
  invalid positions/normals or empty bounds, 64 nodes using measured parent DEM,
  and the same 573.71 m ground sample. Peak textures 257.40 MiB; no rendering
  errors. The failure-lifecycle repair preserves the corrected regional surface.
- `complete/motion-night`, `-overcast`, `-dusk`: CAPTURED on the final build.
  Four 60-second moving legs: Manhattan night and Powell overcast at 1,000 feet
  AGL, Owens dusk at 10,000/30,000 feet MSL. Actual travel 10.56–10.61 km each,
  all stop and return within 0.425 Mercator metres. Cruise clearance stays above
  1,911/8,008 m. No rendering errors or terrain/quality pins. Extracted frames
  were inspected; recording is deliberately separate from timing certification.
- `complete/styles`: PASS on eight fresh boots: saved Satellite, the three old
  graphics URLs, Neon, and old Earth bookmarks in both styles. Every Satellite
  boot has the current surface revision; Neon has no surface engine/cloud pass.
- `complete/quality`: PASS on nine steps through the actual governor ladder and
  back. Effects fall before scenery, minimum scale is 75%, surface coverage and
  buildings/roads/skyline persist at low tier, the cloud pass survives resizing,
  drawing buffers agree, and high quality recovers. High/low/recovered night
  captures were inspected. This explicit ladder check holds unsolicited governor
  steps; the sustained flight checks do not.
- `complete/controls`: PASS on eight checks: ordinary Satellite default, actual
  prop/fighter/cargo framing, release of review time/weather overrides, Neon
  disposal and 140 MB terrain-budget restoration, Satellite coverage and 120 MiB
  budget restoration, and exactly two offered styles. No browser errors.
- `complete/biomes`: PASS on all six final worldwide fixtures in one browser
  context. Ground samples and mesh positions/normals are valid, terrain bounds
  are nonempty, no failed imagery or rendering errors, no terrain/quality pins.
  Texture peak 279.40 MiB; renderbuffers 3.48 MiB separately. Draws 164–197,
  triangles 52,160–734,812, below the existing 375 / 2,000,000 pose ceilings.
  All six images were inspected. Namibia uses measured parent DEM for 64 visible
  tile nodes; the queried elevation is 573.71 m. Glacier, wetland and coast
  retain their geographic surface character; Tokyo and Melton retain buildings.

- `world/night-flight.json`: PASS on build `I-J5PEPBKMTPO1Uyr4KCK`, completed 900 seconds
  at 1920×1080, high scene/effects tier and DPR 1 during measurement. Frame p95
  8.4 ms / p99 12.6 ms; GPU p95 5.70 ms; zero browser long tasks and rendering
  errors. Complete texture peak 275.07 MiB, separate renderbuffers 3.48 MiB,
  scene attribute estimate 146.94 MiB (same exclusions as the day report below).
  Draw p95 219, triangle p95 1,487,808; 182.42 km actual travel, minimum measured
  speed 197.92 m/s, 23 rebases, no crashes/teleports/missing-image markers,
  317–412 live aircraft. All four post-flight quality transitions retained the
  required layers. Terrain/governor/depth/clutter/aerial pins all absent.
  RTX 5080 evidence only; representative integrated-GPU acceptance is unverified.

- Failed sustained run retained at `sample/day-flight.json`: stopped after
  451.5 sampled seconds when texture storage reached 321.77 MiB. Recent frame
  tails also exceeded target. This is FAIL, not a completed 15-minute soak.
  It identified the absent residency byte cap above. Its transient unknown
  allocation also prevents a complete peak-accounting claim; subsequent
  instrumentation records unknown allocation details for diagnosis.

- `review/terrain-bounds`: PASS on actual negative Hudson DEM, normal culling,
  zero empty resident bounds and zero black pixels in the calibrated water region.
- `review/controls`: PASS, eight checks: opted-in review, prop/fighter/cargo
  physical model framing, real-time override release, Neon disposal, Satellite
  restoration and the original treatment remaining available for comparison.
- `review/ohio-matched`, `review/landscapes`, `review/weather`: twelve captures,
  all applicable budget checks pass; zero rendering errors. Peak texture storage
  256.2 MiB across the landscape sequence. Owens 187/191 draws against 261;
  all other captures below 375 draws and 2 million triangles. Intentional images
  are review artifacts; no unrelated image reference was silently replaced.
- `review/quality`: PASS on all nine actual governor steps, including the
  75% resolution floor, lower effects before scenery, live cloud-pass continuity,
  drawing-buffer agreement, retained world layers and full recovery. The governor
  is held only against unsolicited extra steps during this explicit ladder test.
- `review/raster-recovery`: PASS. A controlled error marker on resident real
  imagery triggers a successful retry, retaining geometry/epochs and reinstalling
  material hooks. This does not claim to be a full network-outage pixel test.
- `integrated/outage-completed`: PASS against the previous production build's
  `contact/outage-completed-red` FAIL. The isolated browser clears its imagery
  cache, receives four controlled HTTP 503 responses delayed by 750 ms, and
  waits for a failing transport to complete before restoring connectivity.
  Valid imagery and geometry remain attached throughout, then a real successful
  response replaces the material with its shading hooks intact. Earlier attempts
  that hit cache or restored connectivity before failure completion carry an
  explicit evidence limitation; they do not certify this fix.
- `review/motion-*`: six recorded translating legs across Erie, Elyria and Owens,
  including all three low heights and 10k/30k MSL cruise; actual stops and revisits
  within 1.21 Mercator metres, no rendering errors, terrain/quality unpinned.
  Bank/stop/return video frames were inspected. Initial videos exposed the
  contact-shadow issue; they are retained as diagnosis, with updated footage in
  `sample/`. Recordings do not certify frame times or every-frame pixel continuity.
- `sample/player-shadow`: PASS versus `review/shadow-red` FAIL: actual texture
  center/middle/edge green values 255/141/5, previously 255/253/255. No new draw,
  material variant or texture allocation.
- `sample/styles`: PASS, seven fresh production boots including ordinary saved
  Satellite, old graphics URLs, Neon and the temporary Earth URL in both styles.
- `sample/mobile`: PASS, 518 existing action/layout/input checks with no page
  errors. Includes reduced motion, two-thumb control, cancellation, target actions,
  Back, and ten portrait/landscape sizes in both styles. This is Chromium touch
  emulation on the recorded GPU, not certification of a physical phone or Safari.
- `integrated/day-flight.json`: PASS, completed 900 seconds on RTX 5080 at
  1920×1080, high tier and DPR 1 throughout the measured flight. Frame p95
  12.5 ms / p99 16.7 ms; GPU p95 6.18 ms; one browser long task (65 ms).
  Complete audited texture peak 269.73 MiB; renderbuffers 3.48 MiB separately;
  unique scene geometry/instance attribute estimate peaked at 150.06 MiB
  (excludes driver overhead and unattached cached geometry). Draw p95 212,
  triangle p95 1,349,018; existing ceilings remain 375 / 2,200,000. Actual
  travel 182.47 km, minimum measured ground speed 197.94 m/s, 23 rebases,
  zero crashes/teleports/rendering errors/missing-image markers, 329–445 live
  aircraft. All four post-flight quality transitions retained required layers.
  No terrain, quality, depth, clutter or aerial pin. This is desktop evidence,
  not acceptance on the required integrated hardware.

## Acceptance boundaries

User visual acceptance of the sample was received on September 14. Default
replacement and worldwide implementation follow that approval. The additional
global screenshots remain available for further visual feedback.

The available GPU is an RTX 5080, not the agreed Radeon 780M-class integrated GPU
with 16 GB RAM. Desktop results can establish rendering correctness and allocation
behavior on the recorded machine; they cannot certify integrated-GPU performance.
The final integrated-hardware run still needs p95 ≤16.7 ms, p99 ≤33.3 ms, 1080p
output at internal scale ≥75%, texture storage ≤300 MiB, and the existing applicable
draw/triangle ceilings. Renderbuffers and geometry are reported separately.

The interrupted `integrated/night-flight.json` contains 170 sampled seconds and
is explicitly BLOCKED, not a completed soak. It was interrupted around the user's
live review. Final day/night results belong to the release build's `release/` folder;
they must not inherit the earlier build's verdict.

## Reproducing the review

From the repository, `node scripts/ground-night-build.cjs
--dist=.next-stylized-earth-release` creates the production build and receipt.
Set `FLY_BUILD_DIR=.next-stylized-earth-release` in the server environment,
then run `node node_modules/next/dist/bin/next start --port 3033`. The review page
is `http://localhost:3033/stylized-earth-review.html`.

Pass the new `.next-stylized-earth-release/BUILD_ID` to each browser check;
never reuse an old receipt after rebuilding. Run GPU checks sequentially.

- `node scripts/verify-earth-data.mjs` checks real source classifications without
  GPU work. `node scripts/verify-earth-world.cjs --url=http://localhost:3033
  --build-id=ID --times=noon` renders all six worldwide fixtures and gates
  allocations, valid ground, quality continuity and urban building readiness.

- `node scripts/graphics-flight.cjs --url=http://localhost:3033 --build-id=ID --earth
  --stage=immersive --seconds=900 --hour=17 --agl-ft=1000 --boost
  --output=.graphics-review/day.json`, then the same command with `--hour=4`
  and a distinct night output. No subsystem pins; no recording or profiler.
- `node scripts/graphics-capture.cjs --url=http://localhost:3033 --build-id=ID --earth
  --stage=immersive --sites=elyria,erie,powell,manhattan,owens
  --times=noon,overcast,dusk,night --alts=300,1000,3000 --fixed-tier
  --audit-textures --output=.graphics-review/review-matrix` produces a broad
  fixed-pose review matrix. Use `--msl --alts=10000,30000` for cruise; the
  capture records actual clearance and raises unsafe starting altitudes.
- `node scripts/stylized-earth-motion.cjs --url=http://localhost:3033 --build-id=ID
  --site=erie --time=noon --levels=300,1000,3000 --seconds=60
  --output=.graphics-review/motion` records ordinary flight commands, stops
  and revisits. Other sites: elyria, powell, manhattan, owens; time also accepts
  overcast, dusk and night. Recordings are separate from performance verdicts.
- `node scripts/verify-raster-recovery.cjs --url=http://localhost:3033 --build-id=ID
  --earth --network-fault --timeout=45000 --output=.graphics-review/outage`
  proves completed-failure retention and network restoration.

The commands above document reproducibility and remaining review coverage;
they do not claim every matrix combination has already been visually accepted.

# Satellite graphics overhaul — implementation record

## Review checkpoint

The user accepted the Manhattan/Ohio visual direction on 2026-09-09, then requested
correction of the overly blue building palette. That correction is included, and
the cinematic treatment is now the default on `codex/satellite-graphics-overhaul`.
`/?graphics=legacy` retains the previous appearance. Both required 15-minute soak
scenarios have passing runs, with exact source/version limits recorded below.
The final default boot checks pass. No main merge, push or deployment has
been made; the divergent-main choice below remains pending.

Latest review gallery: `.graphics-review/REVIEW.md`, with the current Manhattan/Ohio
day/night images in `.graphics-review/matrix-verified`. The terrain correction has
been accepted by the user, along with the updated cinematic visual direction.

## Baseline

- Branch `codex/satellite-graphics-overhaul` starts at main `44ec502` and integrates
  Round 24 from `claude/satellite-render-glitches-kwjp4l`, head `7650b6c`.
- Initial main and integrated captures are in `.graphics-review/main` and
  `.graphics-review/integrated`. Their original Manhattan camera intersects nearby
  geometry and does not establish a useful beauty comparison; retain as raw evidence.
- Installed Chrome uses NVIDIA GeForce RTX 5080 / D3D11 on an Intel i9-14900KF,
  approximately 64 GB RAM. Playwright's bundled browser used SwiftShader and is unsuitable.
- Every new capture records source hash, commit, hardware, resolution, active pins,
  time, weather, location, actual AGL, quality, residency, and renderer counters.

## Implemented preview

- One coordinated visual configuration, nine subsystem switches, explicit legacy
  comparison, and high/medium/low profiles. Satellite content survives low quality;
  governor recovery can release a historical session latch after sustained stability.
- Six inferred architectural families, coordinated wall/roof palettes, metre-based
  window proportions, family surface roughness, glass response, stable floor/suite
  occupancy, dark buildings, entrance details, and distant night illumination.
  The shared PBR facade material uses procedural masks instead of individual windows
  or separate building materials. Nearby canopies are capped per chunk.
- Compact building style attributes and shared near/far classification. Worker protocol
  is 19 at the worker and all six consumers. Raw vector-cache data remain compatible;
  derived geometry is rebuilt. New shader variants use the runtime material factories
  during prewarm, including tree shadow/depth variants.
- Reduced curvature and revised chase framing; latitude-aware bend and mixed-unit
  camera calculations. Geographic positions, mapped heights, and flight physics remain.
- The existing depth and night-road systems are enabled in the appropriate preview
  profiles. Buildings, aircraft, vegetation, and landmarks share the scene environment.
- Improved reusable trees with stable proportions and subtle sway, including matching
  depth animation. Parcel homes have varied stable emissive masks. Existing road cars
  and poles remain constrained to supported developed areas.
- Existing aircraft maps are preserved in the satellite material treatment. Landmarks
  have shared PBR surface roles and curated lighting masks; generic tower placeholders
  no longer overlap mapped towers. Source attribution remains in the asset manifest.
- Cloud forms, environment balance, bloom, and exposure respond to the same true solar
  elevation/weather state. Water uses bounded sky/sun/moon and nearby city approximations,
  shoreline masking, and DEM samples inside water polygons; no reflection render target.
- Smaller world labels, compact contracts, and a short controls legend retain essential
  instruments and access to the full controls.

## Evidence so far

- Production build: PASS. Incremental webpack cache intermittently fails under the
  installed Node25 runtime; a cold generated-webpack-cache build passes.
- Graphics unit checks: PASS (families, stable variation, roof masks, positive quality
  coverage, classification height, curvature latitude math, true sun, protocol19).
- R24 terrain29/29, ring hold14/14, and motion unit checks: PASS. The terrain harness
  needed a Windows directory junction rather than a POSIX directory symlink.
- Targeted lint: PASS. The broader fly lint has pre-existing React hook/ref violations;
  it is not recorded as a whole-project pass.
- Initial60-second production flight: approximately106fps, p95 interval12.6ms,
  p99 interval20.8ms, GPU p954.89ms; zero page/shader errors. All required city layers
  remained loaded through high→medium→low→high. This predates the final water correction.
  Its draw counters were inadequate and cannot certify the scene budget.
- An18-pose day/dusk/night ×300/1,000/3,000ft matrix exists in
  `.graphics-review/production-cinematic`. It used the live governor; one Manhattan pose
  stepped to medium, and several lowered DPR. It is not a matched fixed-tier comparison.
  Terrain reached its sharpness target in all18 poses, with zero page/shader errors.
- Ohio source-gap diagnosis: at40.2083,-83.0701, raw OpenFreeMap polygons and emitted
  geometry agree on the nearest footprint at1,166.388 Mercator units. There are no raw
  house polygons within1,000 units. All16 building chunks are visible, fade1, with
  correct DEM+height and zero drape failures. This is not evidence of missing renderer
  geometry. `scripts/graphics-ohio-probe.cjs` records the source and geometry proof.

## Verification tools

`graphics-capture.cjs` supports `--stage=cinematic|legacy`, `--url`, `--sites=a,b`,
`--times=noon,dusk,night`, `--alts=300,1000,3000`, and `--fixed-tier` for matched static
comparisons. It never calls the legacy `_boot.js` pin setup. `CAPTURED` only means
artifacts were recorded; it does not certify their visual quality.

`graphics-flight.cjs --url=http://localhost:3010 --seconds=900` runs translating turns,
GPU queries, scene counters, and quality transitions without terrain/governor pins.
`--scenario=mixed` adds repeated geographic warps. Unavailable GPU timing or counters
produce BLOCKED. The native-resolution and original480-draw/2.2M-triangle limits remain.

## Required before new defaults

The two-scene visual direction is approved. The final matrix, higher-altitude captures,
independent depth/night comparisons, style checks, and moving quality ladder now have
receipts below. Full native 15-minute urban and mixed-terrain soaks and the remaining
moving geographic coverage check are still required. Static screenshots and loaded
chunk counts alone cannot certify motion stability or uninterrupted visual coverage.
No frozen visual baseline or draw budget has been silently revised.

## Corrections established during visual review

The initial screenshots were not accepted on residency counts alone. Focused GPU
probes found two further causes that matter directly to the approved direction:

1. Three 0.185.1 reverses the complete render list with reverse-Z, including explicit
   render order. Water (+3) and roads (+3) were drawn before transparent terrain (0),
   which overwrote them. Actual triangle projection, GPU buffers, and draw order
   establish the cause. Preview order is now tint -2, water -3, roads -4. Legacy keeps
   its original ordering. The restored street layer required a fresh gain treatment;
   its old gains produced broad white ribbons. Preview now separates restrained road
   glow, lamp pools, and short narrow headlights/taillights. Prewarm uses the same values.
2. Ohio has local residential gaps even where regional mapping density is high.
   The preview permits a conservative local exception only with dense residential
   anchors, settled source tiles, no mapped building within a 600 m collar, and the
   existing individual footprint avoidance. All inferred preview homes must also lie
   10–55 m from a mapped residential/service road. Exact terrain-height corrections
   are capped at 0.3 ms / 24 visits per frame; the road index builds in 0.3 ms slices.

The skyline now masks the actual resident detailed tiles rather than retaining a
fixed 4,000-unit empty centre when the nearby quality cap shrinks. The masks follow
floating-origin changes and the detailed altitude/birth fade. Its factory and prewarm
share the new shader key. Focused handover/rebase unit checks pass.

The low-altitude Ohio showcase is at 40.20403, -83.0896; the original Powell pose is
retained as a source-coverage regression location. Before the final road-width/trail
adjustments, the corrected Ohio scene placed 38 supported homes, rejected 33 off-road
candidates, and kept road/ground sampling ready. Owens remained at zero inferred homes
at noon and night, with 249/252 draws against the existing 261 limit. These are exact
pose observations, not a worldwide coverage claim.

Satellite aircraft labels are limited to six ordinary tracks, while selected, locked,
and hovered tracks retain priority. Every track in the pick pool remains selectable.
Satellite trails are thinner and dimmer; Neon keeps its original display.

Additional focused tests: parcel-gap evidence/safety 12 cases and road distance/index
work-budget 8 cases pass. The final production build compiled successfully in 10.9 s.
The final production comparison and flight records are appended below when complete.

## Review evidence before the terrain correction

Final paired captures are in `.graphics-review/review-final` and
`.graphics-review/review-legacy`; `.graphics-review/REVIEW.md` shows them side by side.
All eight captures reached high quality at DPR 1, native 1920×1080, with sharp terrain
and zero page/shader errors. The preview source SHA-256 is
`726cce941fe697e7e1ed79f7ea233cc2177d870b71dc8655d724e2500f31d2fd`.
The four preview poses recorded 274–290 draws and 0.68–1.28 million triangles.

The final home-contact probe passed for all 38 placed homes: base minus exact DEM
was 0.119985–0.120014 m, matching the intended 0.12 m contact lift. Road filtering
rejected 34 candidates in that independent boot. Evidence is in
`.graphics-review/home-drape-after/report.json`; this is a bounded local correctness
check, not a worldwide terrain guarantee.

Whole-file lint still reports pre-existing React mutation diagnostics in the fly
render loops, including TrafficTracers. New helpers and the targeted changed logic
pass their checks; no broad lint exemption or baseline relaxation was introduced.

## Ground imagery regression — 2026-09-09

The user's Fort Wayne screenshot (41.2207, -85.0009, 957 ft AGL, 311 kt)
reproduced on the ordinary Satellite URL. A translating-turn probe observed zero
attached parent/descendant terrain overlaps across 9,397 frames. The visible quilt
was caused by the cached raster loader: it decoded to ImageBitmap and relied on
Texture.flipY, which Three's WebGL upload explicitly ignores for ImageBitmap.
Each tile was therefore mirrored independently. Refining or merging a tile moved
photographic features to different geographic positions. Raw Esri parent/child
comparisons did not reproduce that displacement.

A controlled runtime change converting only the decoded images to canvas restored
continuous roads and fields at the same pose, without changing source imagery,
LOD, terrain geometry, or graphics settings. The permanent loader now uses the
same canvas upload path for full tiles and clipped overzoom tiles, and closes the
temporary decoder bitmap. Cached JPEG/LERC responses remain valid; no purge is
required. This fix applies to ordinary Satellite as well as the cinematic preview.

`verify-raster-orientation.cjs` runs the actual cached loader and vendored upstream
HTML image loader through installed Three on the RTX 5080. The old path differs
in 8,192 color channels; the corrected full image, all four quadrants, and a deeper
south crop match upstream pixel for pixel. `verify-terrain-merge.mjs` separately
passes seven delayed-loader lifecycle checks, including required failing controls:
the merge completion now refreshes frustum membership and restores child tracking
after cancellation. All 29 existing R24 terrain unit checks still pass.

Earlier beauty captures are superseded because they contained incorrectly registered
imagery. The corrected production source SHA-256 is
`4a8f4e78f1d5ebe0cadd0ed98f501509195ebd13b742af326371010532c24ed6`.
The production build passes. Moving-flight results and refreshed review captures
are recorded below. Full urban/mixed 15-minute soaks and worldwide
rollout remain pending; the overhaul defaults remain off.

The compiled fix was exercised at the two reported locations using actual flight
integration, with no terrain/governor pins or runtime orientation override:

| Location | Commanded speed / AGL | Recorded frames | Terrain overlaps | Runtime errors |
|---|---|---:|---:|---:|
| Fort Wayne | 311 kt / 957 ft | 7,329 | 0 | 0 |
| Lima | 146 kt / 36,881 ft | 6,105 | 0 | 0 |

Both runs include translation and reversing turns, and their corrected ground
captures were inspected. These are short regression runs (40 / 25 seconds), not
the planned long soaks or a new performance certification. Evidence is retained in
`.graphics-review/terrain-fixed` and `.graphics-review/terrain-fixed-lima`.
The earlier 90-second performance run recorded 132.7 fps, p95 12.6 ms, p99 16.7 ms,
and GPU p95 4.78 ms, but used the pre-correction build and does not certify this one.

The four refreshed Manhattan/Ohio day/night captures are in
`.graphics-review/review-terrain-fixed`. All reached high tier, DPR 1, sharp terrain,
and zero runtime errors; they recorded 276–290 draws and 0.69–1.33 million triangles.
`.graphics-review/REVIEW.md` now displays these corrected preview images and retires
the old paired comparison. Targeted lint passes for the raster loader and three
new regression scripts; the graphics contract unit gate also passes. These receipts
do not change the pending visual review and global validation requirements.

## Continued visual treatment — 2026-09-09

Current production source SHA-256:
`58059b58539096a633ea46ec19780e8075aff109b3aeb19bae0eb71e71fc02ce`.
The cold production build and graphics contract tests pass. Four current showcase
captures reached sharp terrain at high quality/DPR 1 on the RTX 5080, without runtime
errors. Earlier appearance captures remain historical evidence.

- Fixed unstable window occupancy inside individual panes. Perspective interpolation
  perturbed a byte-valued building seed before a high-gain hash. Rounding the discrete
  style values restores stable rectangular windows; the shared near/far shader key is
  now v2. A 19,890-sample float32 control produced 6,371 old erroneous occupancy flips
  and zero corrected flips; an actual GPU A/B confirmed the visual difference.
- Corrected doubled environment dimming. The atmosphere resolver now supplies final
  environment/background intensities, with shared sun/weather inputs and restrained
  exposure. Cloud groups share a condensation base and tighter, slower lobes. Hidden
  clouds in Drei's shared instancer now shrink and update their matrices because an
  invisible wrapper alone did not hide their instances. Numeric/transform checks pass
  across 2,163 sun/weather cases.
- The cinematic DPR ladder removes AO/shadows and then costly post effects before
  reducing world detail. A real moving high-to-low-to-high ladder passed, retaining
  buildings, roads, and night skyline throughout. The final-scene repeat is recorded
  in the verification receipt below.
- Required prewarm covers cinematic color variants with shadow-casting and non-shadow
  lights, plus canopy depth variants. Live renderer state is restored before each
  async wait. This does not assert that every program count stays flat during travel.
- All 19 existing model records describe the maps actually used by each representation,
  material roles, and lighting-mask provenance. Baked traffic/landmark representations
  explicitly declare no runtime material maps. Credits remain unchanged. Cinematic
  traffic shares the painted-aircraft finish; Neon retains its original parameters.
- Removed legacy city-glow hemispheres from cinematic lighting. A GPU isolation test
  attributed two orange horizon domes to the old additive 448 m-high POI hemispheres.
  Actual skyline windows and road lights remain; the legacy profile is unchanged.

The native flight harness now records progressive frame percentiles, GPU queries,
browser long tasks, terrain load/unload churn, failed imagery, terrain texture byte
estimates, heap and renderer-resource series. Terrain estimates cover RGBA uploads
and mipmaps, not every GPU allocation. Missing imagery or unavailable GPU timing is
BLOCKED. The original timing/draw/triangle limits remain unchanged. The first 15-minute
urban soak was interrupted after 510 seconds for the user's building-palette
correction. Its partial measurements retained native high quality, zero runtime
errors, and 97 programs; it is not a completed soak. Both full soak verdicts remain
required before certification.

### Building-palette correction

The user correctly identified that the initial city view was too uniformly blue.
The inference had forced every untagged building at least 95 m tall into the glass
family; all four glass palettes were blue/cyan, and the glazing shader also applied
a universal blue multiplier. Height now selects among deterministic concrete,
masonry, apartment, and glass treatments after source hints. Glass has neutral,
bronze, charcoal, and muted blue variants; glazing follows the existing per-variant
wall albedo. Night occupancy and discrete seed rounding remain intact. Shader key
v3 is shared by near/far and prewarm. Geometry and mapped heights are unchanged.

A 512-ID tall-building sample contains all four tower families, with stable repeat
results. The unit gate asserts variety, not a frozen artistic percentage. Unit and
targeted lint checks pass. Four refreshed Manhattan/Ohio day/night captures are
CAPTURED, sharp, and free of runtime errors; the matching Manhattan views were
visually inspected and show clear material/color differences. Production build
passes at source SHA-256
`dee70d2e48e261e8a942bac07d92de1152dbc7c3f785e7969c2f0e123cc36cb2`.
The later verification receipt supersedes this checkpoint's pending matrix status;
the two full soaks remain pending.

### Night-horizon integration and geographic checks

The palette-corrected matrix completed all 18 day/dusk/night/altitude views with
sharp terrain and no runtime errors. The additional Powell/Melton/Paris/Owens
day/night captures and 6,000 ft Manhattan/Owens views also reached readiness. Static
review confirmed sparse desert surroundings, neutral architecture, and dark roofs.
It exposed a saturated blue strip where the old night rim met the neutral HDRI.

The cinematic night rim/void now blend toward neutral colors using the resolver's
same true-sun night weight, before weather. Fog, distant terrain haze, and SkyDome
receive the same result. Daylight, Neon, and nearby terrain materials are untouched.
A same-pose Paris GPU comparison confirms removal of the saturated strip. Build
and 721 numeric parity/order checks pass. Current production source SHA-256:
`3f350dbffdb9b89a970dca1f5e7094615aa1920b0999c71ac86ffa4478ca8cd1`.

The first geographic run passed 52 checks including five-location coordinate
roundtrips, repeated warps, terrain/contact/camera checks, and a natural moving
rebase (camera step 1.105 m against flight step 1.108 m). Its interaction failure was
an instrument error: the harness waited for a phone-only close handle on desktop.
The actual inspect card and desktop close button are now used. Destination readiness
also now waits for frame-owned streaming and nearby chunks instead of old ready
statistics immediately after a warp. Source-height validation now compares exact
raw vector responses with actual worker wall geometry. The current geographic verdict
is recorded below.

## Verification receipt — 2026-09-09

The user accepted the Manhattan/Ohio direction, then rejected the uniformly blue
towers; the family-selection and glazing-palette correction above is included in
this receipt. All results below use compiled source SHA-256
`3f350dbffdb9b89a970dca1f5e7094615aa1920b0999c71ac86ffa4478ca8cd1`.
The aggregate `.graphics-review/verification-results.json` remains **BLOCKED** because
the geographic stage is incomplete; successful capture exits are not visual passes.

| Check | Result and evidence under `.graphics-review/` |
|---|---|
| Manhattan/Ohio matrix | 18 day/dusk/night views at 300, 1,000, and 3,000 ft AGL; `matrix-verified/report.json` |
| Geographic appearance | Eight Powell/Melton/Paris/Owens day/night views at 1,000 ft; `global-verified/report.json` |
| Higher-altitude continuity | Four Manhattan/Owens day/night views at 6,000 ft; `altitude-verified/report.json` |
| Depth and lighting comparisons | Two depth-off day views and two lighting-off night views, matched to the enabled matrix; `depth-off-verified/` and `lighting-off-verified/` |
| Legacy comparisons | Four Manhattan/Ohio day/night views; `legacy-verified/report.json` |
| Style isolation | PASS, 3/3 ordinary Satellite, explicit legacy, and Neon routing/material checks; `styles-verified/report.json`. This is not a performance-budget or pixel-identity certification. |
| Moving quality ladder | PASS, nine stages through high → medium → low → recovery; `quality-verified/report.json`. DPR/effects reduced before scene detail; buildings, roads, and night skyline stayed present, and native high quality recovered. |
| Geographic/interaction gate | 21 PASS, 0 FAIL, 1 BLOCKED; `geography-verified/report.json`. The moving-content check required sharpness on every observed frame. A rerun measuring actual imagery coverage is pending; the blocked result has not been relabeled as a pass. |

All 38 static captures reached high quality at native 1920×1080/DPR 1 with sharp
terrain and zero reported runtime errors. The governor was held for matched captures;
terrain and depth were not globally pinned. Capture status is **CAPTURED**. The moving
quality check used the actual governor's forced ladder during translating flight.

Limited visual review supports the treatment: Ohio depth improves wall/ground contact
and roof recesses without obvious detached shadows or bright halos; Manhattan night
shows distinct warm/cool windows, connected street pools, dark roofs, and no whole
facades blown into white blocks. Large office-window clusters remain visually coarse,
and foreground park detail is very dark. Geographic review found neutral architecture
and sparse desert surroundings. Live traffic/cloud timing differs between captures,
so pixel differences alone are not evidence of improvement or stability.

Both complete 15-minute native urban/mixed-terrain soaks, the geographic rerun, and
enabling the new defaults remain pending. No deployment or default flip is included
in this receipt.

### Building contact and final geographic gate

The real-imagery motion rerun retained terrain imagery and buildings across all
7,935 observed frames. It exposed a separate contact defect: a building's DEM
could refine while its chunk centre remained coarse, so the centre-only healing
gate never revisited that building. Earlier partial-ring samples had missed the
nearby houses. Satellite walls intentionally extend 6m below their sampled ground;
the failing house was another 2.009m below that intended base.

Cinematic chunks now retain each building's sampled elevation and vertex span.
Finer valid terrain repairs the complete building in place, including collision
top and house-light ground, without rebuilding or evicting the chunk. Sampling is
limited to eight queries/0.35ms and one bounded upload per frame. Sweep sorting is
separate CPU work, at least two seconds apart; uploads over 16,384 vertices are
reported as deferred. Conservative bounds expand by maximum displacement, rather
than accumulating every building's movement. The legacy healing path is preserved.

The contact census now ignores unreferenced vertices removed by FLASH_GUARD and
waits for the static building ring to finish queuing/building/draping. It retains
its original contact limits. Moving coverage distinguishes loaded parent imagery
being refined from genuinely missing imagery; static views still require sharpness.

The cold production build, graphics units, exact-engine contact regression, and
targeted lint pass. Compiled source SHA-256:
`1563d43ff763fa7cf33bcda4605aa6006481d01c4e45bfdc951ef6686a2d3c65`.
`geography-final/report.json` is **PASS, 57 checks**, covering all five locations,
repeat Manhattan/Ohio visits, supplied wall heights, nearby contact, coordinate and
collision queries, origin alignment, camera clearance, translating low flight,
natural rebasing, and actual pointer/keyboard inspection. This supersedes the
earlier geographic BLOCKED/FAIL results; those files remain as historical evidence.

Native endurance measurements are running on an RTX 5080 (ANGLE/D3D11), i9-14900KF,
32 logical processors, 63.79GiB RAM, Windows 10.0.26200. No other QA browser runs
concurrently with timing. Both full soak verdicts and default rollout remain pending.

The completed urban soak (`soak-urban-final.json`) is **PASS**: 900 seconds,
155.0fps average, frame p95 12.5ms / p99 16.6ms, GPU p95 4.11ms from 139,732
valid queries, zero GPU disjoint events, runtime errors, or browser long tasks.
Native DPR1/high quality held throughout. Draw p95 301 and triangle p95 1.912M
remain below the unchanged 480/2.2M budgets. Live traffic ranged 387–824 tracks.
Heap was 171→169MiB (135–215MiB range), programs stayed at 97, geometries ranged
283–330, and estimated resident terrain textures peaked at 77.33MiB. Travel
produced 9,630 terrain loads / 9,769 unloads across the full run. No oversized
contact repairs were deferred. High/medium/low/recovery each retained buildings,
roads, skyline and night lighting. This is one completed soak; mixed remains pending.

The first full mixed soak (`soak-mixed-final.json`) is **BLOCKED**, despite meeting
performance and budget limits: 201.3fps average, p95 8.4ms / p99 12.5ms, GPU p95
3.69ms, draw p95 303, triangle p95 1.977M, native high throughout, zero runtime
errors. Exactly one of 90 samples, at 740s after the Owens warp, contained one
`flyError` imagery material among 217 resident terrain meshes. This is not a pass.
Other samples were clear, but cannot establish whether that tile recovered or was
evicted. The run recorded seven browser long tasks (p95 565ms) around its broader
travel workload; percentile frame success does not mean every arrival was stall-free.

Investigation found that `flyError` excluded a failed material from reuse, but did
not itself schedule another update. A settled resident tile could retain the error
until another epoch/LOD update. The harness now records failed raster requests and
individual failed tiles for the rerun; recovery is being corrected before rollout.

Resident imagery recovery is now implemented with two concurrent material-only
retries and 1/2/4/8/16/30s backoff. Healthy tiles bypass the asynchronous path;
geometry, tile identity, LOD and epochs are retained. Stale results are discarded
and disposed, and successful replacement uses the ordinary shadow/material hooks.
The first GPU fixture caught a missing TileMapLoader coordinate-preparation step
that simplified Node doubles had hidden. The fix uses the real map-loader wrapper,
and regression coverage now includes its actual projected-bounds checks.

At compiled source SHA-256
`c6616dd83b5dd76f57439712670d039f58ab7f68727ada4765115619e785f109`,
the production build, 20 retry regressions and seven terrain-merge regressions pass.
`raster-recovery-fixed/report.json` is **PASS**: a controlled error marker on a real
resident z18 tile recovered in 1.139s on its first retry, preserving tile/model/
geometry and root/origin epochs. The ordinary material event fired once, restoring
the same bend/grading shader key. No runtime errors occurred. This fixture tests
resident recovery; it is not a visual pass or a complete network-failure simulation.
The full mixed soak is being repeated with the unchanged missing-imagery gate.

### Main-branch reconciliation

The user explicitly authorized integration into GitHub main. The divergent histories
are reconciled from GitHub main `0ff2a3f` and approved overhaul `be711f2`, retaining
both histories and the current main renderer improvements. Main residency, worker
skirts/normals, terrain crossfades, building fade pools, frame pacing, atmosphere
and resize ownership coexist with the approved graphics, cache and recovery work.
Worker and derived geometry contracts advance together to protocol20.

Main residency budget eviction takes precedence over Motion Hold dwell. Cancelled
merges restore detailed children even when a camera turn occurs during crossfade;
borrowed texture slots clear before parent disposal. The quality ladder uses one
DPR owner and preserves the cinematic60fps target across style changes. Historical
Round24 Motion Hold records are archived separately from main Smooth World records.

The integrated production build and focused graphics, governor14/14, terrain14/14,
raster20/20 and main residency40/40 checks pass. A browser-found camera-height name
collision was fixed before publication. Production browser verification uses the
actual installed Chrome hardware renderer at1920x1080 with unpinned terrain.
Integration performance and geographic results will be recorded below on completion;
the earlier receipts remain baseline evidence only.

### Completed mixed repeat and default rollout

`soak-mixed-rerun.json` is **PASS**, a full 900-second run at source `c6616dd8…`:
193.3fps average, p95 8.4ms / p99 12.5ms, GPU p95 3.75ms from 174,204 valid queries,
zero disjoint events, runtime errors, failed raster requests or failed-imagery
samples. Native DPR1/high quality held. Draw p95 306 and triangle p95 1.990M pass
the unchanged budgets. Traffic ranged 44–740 tracks. Heap was 176→119MiB
(83–290MiB range), terrain textures peaked at 89.33MiB, and shader counts settled
at 97/112/113 across environment transitions. Seven browser long tasks remained
(p95 515ms); frame percentiles do not certify every arrival frame as stall-free.
All four post-flight quality steps retained buildings, roads, skyline and lighting.
The earlier mixed run remains BLOCKED in its original file.

The approved configuration is enabled by default. The final production build and
graphics units pass at source SHA-256
`254e1c5deb885e08621617bf01afc7f3626da38426b35ddc5dc1d59e44555a44`.
The default flip changes the selector, not the effective cinematic settings used
by the soak's explicit query. The urban soak predates the isolated failed-raster
recovery patch and had no failed tiles; the mixed repeat and controlled GPU recovery
fixture cover that patch. The static visual matrix predates the in-place contact
repair, whose exact nearby geometry was subsequently checked at all five locations.
These source distinctions are intentional; no receipt is represented as a run on
a different compiled tree. Fresh ordinary/legacy/Neon boot checks are **PASS, 3/3**
on the final compiled default (`defaults-final/report.json`), with no runtime errors.
The ordinary default screenshot was inspected and retains distinct neutral/warm
building finishes. The local branch is ready for the requested main reconciliation.

### GitHub main integration closure

The semantic merge is recorded by c191979; canonical main CLAUDE.md and September
Round 24 records are retained verbatim. [graphics-main-validation.json](scripts/graphics-main-validation.json)
is the compact integration receipt, including renderer hashes and measurement scope.

Both 900-second integrated soaks PASS at source d1e492cd: urban 163.6fps, p95 8.4ms,
p99 16.6ms; mixed 205.3fps, p95 8.4ms, p99 12.5ms. Native1920x1080/high held, with
zero runtime errors or missing-imagery samples and unchanged draw/triangle budgets.
Mixed-region transitions produced seven long tasks (p95 517ms); warp frames are
not claimed to be universally stall-free. Defaults pass in cinematic, legacy and
Neon; matched Manhattan/Ohio day/night views retain varied materials and lighting.

The geographic sweep then found one delayed nearby building contact repair. The
initial failing receipt is preserved. GPU tracing showed the same anchor awaiting
a second DEM check for 19s behind distant repairs. A bounded nearest-building lane
now shares the existing 8-query, 0.35ms, one-geometry-update budget with the fair sweep.
A 6000-anchor regression improves the first repair from about100s to0.383s at
simulated 60fps; a production probe reaches correct contact by its 2s sample.

Final renderer source SHA-256: aec34a2e4d1ff2fd9991173e42031044881dc5c4d530929688ad28b7fa1af795.
Its production build, graphics/contact regressions, unchanged geography 57/57,
moving quality ladder 9 steps and resident-raster fixture 4 checks PASS. A targeted
180-second native flight also PASSes: 131.5fps, p95 12.5ms,
p99 16.7ms, GPU p95 4.23ms, zero runtime errors and
missing-imagery samples. The two full soaks precede only this isolated scheduling
change; they are not represented as runs on the final source hash.

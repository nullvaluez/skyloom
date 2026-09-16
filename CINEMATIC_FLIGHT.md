# Cinematic Flight — implementation and review record

## Scope

Satellite now uses a shared material library, coordinated surface lighting, more restrained aircraft highlights and model-aware chase framing. These are worldwide rendering rules. Manhattan, Ohio and JFK are comparison routes; they do not select a different renderer or receive a location-specific optimization. The world fixtures also cover Aletsch, Namib, the Everglades, Bali, Tokyo, Melton, the Dead Sea and Owens Valley.

This is a local review build. Production publication is a separate action. Radeon 780M performance remains unverified: this machine has an NVIDIA RTX 5080, Intel i9-14900KF and 64 GB RAM.

**Visual status:** the user rejected the first cinematic pass as too similar to the previous game, then identified **ground surfaces and scenery** as the main remaining gap in the 3049 art checkpoint. Technical checks do not establish visual acceptance. The current ground checkpoint adds global land-cover fallback, forest stands and packaged CC0 surface maps. It needs review in ordinary flight; it is not declared equivalent to the supplied game references.

## Build identity and preservation

- Starting commit: `509688f4fd01bc3ef403c43ab34a75499f6909d3`.
- Existing uncommitted work was preserved. Its patch is `.graphics-review/cinematic-flight/preexisting.patch`.
- Production baseline: build `hLdytJuWfwG76n10i9eIc`, source SHA-256 `db5228ad1e3b7c2a14e5f16ab757be4a99a3c4db70c1529fd0f4773b0db7d9ee`, `.next-cinematic-baseline`.
- First pass, retained for comparison: `e_mycvnudf8dkF0Yd_4ZO`, source SHA-256 `ecd10c671f1bc81cfbe6bd362cd2d72e668822132d57b8ae4a52e79b6c3b6574`, `.next-cinematic-grounded`, port 3047.
- Revised art checkpoint: `5LVh0b4gxd3muaKC7Kw5J`, source SHA-256 `c65be05f030691e7883620f607e19efb60a3b844daf5739221fe2c64ad127ec2`, `.next-cinematic-art-final`, built September 15, 2026.
- Current ground checkpoint: `3LnxS1qWsavaUx-A1E7B1`, source SHA-256 `dcb05ff351f1f23d535b5669ecb265cf810be3df825c3d8436f28eccf7c205d4`, `.next-cinematic-ground-final`, built September 15, 2026.
- Local review: `http://localhost:3052/stylized-earth-review.html`. Port 3049 remains the earlier art comparison.
- Receipts are served from `/_next/static/<buildId>/ground-source.json`. Validation checks the build actually served, rather than treating a dirty checkout hash as the tested build.
- The receipt generator now hashes packaged `.bin` artwork too. HTML review UI is verified by the review-control harness but is outside the existing source-hash extension list.

## Rendering changes

### Shared materials and geographic identity

Eight surface types cover asphalt, concrete, masonry, roofing, soil/grass, rock, sand and snow. The current package combines five Poly Haven CC0 source sets with first-party masonry, roofing and snow. The generator produces two shared 256 × 256 × 8 texture arrays with mipmaps. One carries color and roughness; the other carries normal, height and occlusion data. Runtime shading currently consumes the normal channels; height and occlusion are reserved in the same packed allocation.

Color RGB is sRGB; alpha roughness and the normal/detail array remain data. This follows the [Three.js color-management guidance](https://threejs.org/manual/en/color-management.html). Artwork, source authors, original download URLs, source hashes and packed hashes are recorded in `public/materials/cinematic-v2/manifest.json`. The [Poly Haven assets are CC0](https://polyhaven.com/license); first-party artwork uses the project's MIT license. Runtime loads only the locally packaged arrays, not the Poly Haven service. The original v1 assets remain available to the preserved earlier review builds.

The packer normalizes diffuse maps to relative luminance with restrained chroma so one photographed patch cannot recolor every biome. Normal maps bypass ICC conversion and are renormalized after downsampling. Authored repeats are 4 m asphalt, 2 m concrete/grass and 16 m broad mineral structure; the manifest separately records the original scanned dimensions. These repeat lengths divide the 4096 m transported phase, preventing texture jumps at an origin wrap.

Classification preserves source-image luminance, and crop color receives only a restrained blend. An intermediate global-map version pushed fields toward a uniform pale palette; matched screenshots rejected that result. The final shader uses the provider category to select detail while retaining field boundaries, seasonal color and brightness variation.

Three R8 classification atlases provide explicit surface identities. Surface selection no longer identifies grass and woodland by comparing palette RGB values. Derived masks advance to revision 5 for the WorldCover interpretation; the worker payload protocol remains 21, and compatible raw provider caches remain usable.

Patterns use physical metre scale with phase transported through origin rebasing and changing latitude. Fine detail fades with distance and texture mipmaps. A change between coarse and fine surface identities fades through the photographic base before switching material, avoiding a hard midpoint change. Unknown areas retain imagery. Hydrology alone does not invent vegetation, and administrative parks remain excluded from landcover inference.

Mapped aeroway polygons select pavement. Runway/taxiway centrelines only exclude scenery; they cannot create a visible pavement footprint. Water continues to shade the existing terrain surface, preserving shorelines and height.

### Worldwide land-cover fallback

[ESA WorldCover 2021 v200](https://esa-worldcover.org/en/data-access) supplies missing tree, grass, crop, shrub, snow and bare-ground categories under CC BY 4.0. Its exact published WMTS category colors are decoded to categorical IDs in a worker; mixed colors and transparent pixels remain unknown. This is an explicit provider legend, not classification from satellite photo colors or the game's palette. Precise vector surfaces and building/road/airport exclusions take priority. Bare/sparse land retains photographic color because this source does not distinguish sand from rock.

The source is dated 2021 and has nominal 10 m land-cover resolution; it is not current survey data or exact building/road geometry. Coverage outside the provider's published latitude/zoom range keeps the existing fallback. Source/license/provenance are packaged in `public/data/worldcover-provenance.json`; the required attribution appears in Satellite and its photo captures.

Each worker admits at most two requests, holds at most 24 decoded 64 KiB tiles and uses a shared 128-entry compressed Cache API cache. Bitmap decoding stays off the render thread. HTTP, malformed-image and storage failures retain vector/imagery fallback; corrupt persistent entries are removed and failures have a 30-second retry backoff. The existing 48 surface slots and GPU allocations are unchanged. Review telemetry reports `worldCoverTiles` and `worldCoverCells` separately from overall readiness.

Forest candidates enter the existing 400-per-tile tree cap, pool, terrain support and fades. Sampling forms deterministic stands; the size seed is independent of admission order, correcting an early candidate that selected almost exclusively small trees. Published non-tree observations suppress arbitrary trees on broad lawns and residential polygons; unknown observations retain existing mapped scenery. Supplemental forest candidates require a clear surrounding footprint and existing airport exclusions. No place-name-specific logic is involved.

Broad forest normal relief replaces a regular sine-grid effect between individual trees. The derivative is taken from the continuous height field before applying the categorical mask; an intermediate version differentiated the mask and produced false dark forest-edge outlines. That intermediate build (3051) is not the current review build.

### Architecture and scenery

The existing six architectural families retain their palette, silhouette and deterministic identity. Shared material detail adds surface texture, restrained weather streaks, roughness variation and normal relief. Roofs receive an independent metre-space projection. Nearby complex flat roofs can receive an inset parapet within the existing geometry cap. Analytic recessed windows and wall/roof separation remain integrated with the existing material factory, prewarm and night lighting.

Canopies now use the existing first-party leaf-cluster renderer: 34 triangles per tree versus 58 for the solid crown, with one shared 128-square alpha atlas for visible leaves and their shadows. Satellite had previously bypassed this renderer. The same UV attributes are present in shader prewarming, and repeated disposal cannot release another material's atlas. The scrub/stone pool favors nearby candidates with a residency preference; its 160/96/48 quality capacities remain bounded. Existing terrain-support, footprint, road, water and monument exclusions remain in use. Runway and taxiway exclusions are applied in the shared vegetation worker at the source tile's latitude, including airports outside the named review fixtures.

The revised material treatment uses 19 cm facade relief at resolved openings, filtered upper reveals and lower sills, darker roof albedo and long roof seams. Broad roof identity remains on distant and reduced-detail buildings. Ground contrast is applied after classification, so mapped land does not overwrite it; snow retains high reflectance and the daylight adjustment retires at night. Known pavement has a dedicated albedo while photographic markings remain visible. Unknown geometry stays photographic. A periodic 32 m surface field supplies medium-scale variation between fine texture and geographic fields.

### Lighting and aircraft

Sun, sky fill, environment response, clouds and near-field haze use the shared solar/weather state. Cloud light changes reuse the existing pass, targets and step budget. Cast shadows, ground support and contact shading continue through the installed daylight-depth system; this pass does not add another postprocessing chain.

Painted aircraft use roughness 0.48, metalness 0.08, clearcoat 0.16 and environment intensity 0.55. Canopy and exposed metal have separate responses. Existing aircraft maps remain owned by the GLTF cache. Exposure and bloom were retained while material response was reduced, keeping world lighting independent of aircraft highlight correction.

The chase camera uses corrected source-model dimensions, field of view and aspect ratio to target 15% fighter width. Straight-line camera lag is bounded at 7 m so speed does not shrink the aircraft. Banking and camera interpolation remain smooth; existing reduced-motion handling is retained. Model dimensions live in a renderer-owned WeakMap rather than in flight physics state.

### Resource envelope

| Added allocation | Size |
| --- | ---: |
| Two material arrays, including mipmaps | 5.33 MiB |
| Three R8 classification atlases | 1.50 MiB |
| Shared foliage alpha atlas, including mipmaps | 0.083 MiB |
| Total additional GPU texture storage | 6.92 MiB |
| Additional-data allowance | 16 MiB |
| Total texture ceiling | 300 MiB |

The small permanent fallback textures add less than 0.001 MiB. The browser allocation auditor counts actual texture storage, including material arrays and mipmaps. Geometry attributes and renderbuffers are reported separately; texture totals must not be described as total GPU memory.

The material package is fetched once per active Satellite material lifetime, shared by terrain and architecture, and released on final disposal. HTTP failures, truncated data and late responses preserve the procedural fallback. Optional building material detail retires through the existing quality uniforms. Shader variants and scenery draws remain bounded.

## Playable review

The existing review page includes worldwide places, real time, noon, overcast, dusk and night, plus low-altitude and cruise views. It starts at JFK at 300 ft in daylight, within the approved low-flight milestone; the former 3,000 ft opening view hid most nearby material work. Optional `place`, `height` and `light` query parameters open repeatable review locations. Component comparisons disable materials, lighting, camera or aircraft tuning independently. These controls exist only under `graphicsReview=1`; ordinary saved Satellite selection remains compatible.

The component comparisons isolate this pass and are not a replacement for the separately built baseline. Baseline and current matched captures use the same routes, lighting and requested AGL. Moving captures include actual translation, boost, banks, stops and return visits; they are visual evidence, not frame-time benchmarks.

The existing flight model enforces 50 metres (about 164 ft) minimum terrain clearance. The requested 50/100 ft JFK shots are review-only material inspections below that floor, not ordinary playable passes. The first capture interval conflicted with the integrator and left the HUD reporting 164 ft while positioning the image lower. The corrected capture holds synchronously after the integrator, records geometric and reported AGL together, and rejects a mismatch. Flight physics remains unchanged. Ordinary moving checks use approximately 300 ft or higher. The playable review starts its height options at 170 ft and now includes Bali inland; its HTML hash is recorded separately in the final validation summary.

## Validation record

The first pass (`e_mycvnudf8dkF0Yd_4ZO`) completed its seven-region daylight/night sweep, matched views, translating routes, quality/style/fallback checks and separate 15-minute daylight/night flights. Its record is `.graphics-review/cinematic-flight/grounded/validation-summary.json`. The user subsequently rejected its visual strength. The revised art checkpoint has a separate completed queue in `.graphics-review/cinematic-flight/art-final/queue.json`; first-pass endurance numbers below do not certify the revised foliage/shaders. The current ground checkpoint was validated separately in `.graphics-review/cinematic-flight/ground-final/queue.json`. No resource or frame-time ceiling was relaxed. A support census rejects catastrophic placement offsets above 100 m; this does not permit visibly floating buildings. Visual review remains necessary.

Current source checks: production build passed; targeted ESLint passed; WorldCover checks 7/7, cinematic checks 16/16, graphics unit checks passed, surface checks 21/21 and boundary checks 6/6. WorldCover checks exercise exact palette decoding, unknown pixels, geographic wrap and coverage limits, source precedence, exclusions, capped concurrency/LRU, failures/corrupt cache removal and the actual worker's deterministic forest/runway behavior. Browser/endurance results are recorded against the exact served build, not inferred from these source checks.

### Current ground checkpoint — completed

Build `3LnxS1qWsavaUx-A1E7B1` completed the eight-region day/night sweep (16 views), four matched low-flight views, five recorded translating routes, overcast/dusk/cruise captures, quality/style transitions, review controls and component comparisons. The 50/100 ft runway images are the synthetic inspections described above. The comparison is `.graphics-review/cinematic-flight/ground-final/comparison.html`; the source-bound machine record is `ground-final/validation-summary.json`, with selected-frame visual observations and remaining limits in `ground-final/visual-review.json`.

Material HTTP failures preserved the procedural fallback. A controlled WorldCover outage intercepted 120 requests: all 48 surface slots remained ready with zero WorldCover tiles. Delayed imagery HTTP failures retained the resident geometry and imagery, then recovered through the ordinary material hook after network restoration. The capture census's six focused checks also pass; no resource or frame-time threshold changed.

| Measurement | Daylight — Elyria region | Night — Tokyo region |
| --- | ---: | ---: |
| Duration / result | 900 seconds / PASS | 900 seconds / PASS |
| p95 / p99 frame time | 12.50 / 16.70 ms | 8.40 / 12.50 ms |
| GPU p95 | 6.05 ms | 5.88 ms |
| Actual ground travel / origin rebases | 182.48 km / 23 | 182.47 km / 22 |
| Texture / renderbuffer peak | 267.32 / 3.48 MiB | 290.65 / 4.98 MiB |
| Scene geometry attribute maximum | 46.38 MiB | 102.13 MiB |
| p95 draws / triangles | 193 / 416,241 | 208 / 821,216 |
| Live traffic range | 192–374 | 9–19 |
| Internal resolution | 100% throughout | 100% throughout |
| Rendering errors / crashes / teleports | 0 / 0 / 0 | 0 / 0 / 0 |

Both runs used the live governor and production terrain, with all recorded subsystem pins released. Neither run triggered a governor tier or resolution reduction. Their post-timing high → medium → low → high changes retained building, road and skyline residency and night-material readiness. Both recorded zero CPU long tasks and GPU disjoint events. Worst individual frames were 50.0 and 37.5 ms; p99 remained within the requested 33.3 ms limit. There were 16 daylight and 36 night raster request failures, with no sampled missing resident imagery.

These are repeatable regional routes, not universal performance certification. The Tokyo route includes shoreline and water legs over Tokyo Bay. The review remained available to the user during testing, so unrelated GPU contention cannot be excluded. Geometry bytes estimate unique attached scene attribute buffers and exclude driver overhead and unattached caches. Radeon 780M acceptance and user visual acceptance remain unverified.

The fixed regional views settle after a warp; the synchronous stop commands decelerate through the existing integrator before the final image. Requested fixture coordinates therefore identify the region, while the HUD shows the achieved position. Matched before/after images use the earlier interval-held capture method on both sides. Moving-route reports record actual positions, distances and AGL.

### First-pass endurance — historical, not revised-art certification

| Measurement | Daylight — New York | Night — Tokyo |
| --- | ---: | ---: |
| Duration | 900 seconds | 900 seconds |
| Result on recorded desktop | PASS | PASS |
| p95 / p99 frame time | 8.40 / 12.60 ms | 12.40 / 12.60 ms |
| GPU p95 | 5.15 ms | 6.65 ms |
| Actual ground travel / origin rebases | 182.40 km / 23 | 182.88 km / 22 |
| Texture / renderbuffer peak | 273.23 / 3.48 MiB | 292.90 / 4.98 MiB |
| Scene geometry attribute maximum | 146.33 MiB | 99.28 MiB |
| p95 draws / triangles | 211 / 1,245,203 | 208 / 967,057 |
| Live traffic range | 378–485 | 9–27 |
| Internal resolution | 100% throughout | 100% throughout |
| Rendering errors / crashes / teleports | 0 / 0 / 0 | 0 / 0 / 0 |

Both runs had zero CPU long tasks and zero GPU disjoint events; their worst individual frames were 41.6 and 41.7 ms. There were 28 daylight and 21 night provider request failures, with no sampled missing resident imagery. No governor, terrain, depth, settle, clutter or aerial pin was active. Post-timing high → medium → low → high changes retained buildings, roads, skyline and night-material readiness. The governor made no automatic tier or resolution step. The night run was restarted after a host interruption; the interrupted record is preserved. The user could play the review during the rerun, so GPU contention cannot be excluded and its timing is observational. Neither run establishes 780M performance.

Completed source checks:

- Production build passed.
- Targeted ESLint passed for all changed/new `lib/fly` implementation files.
- `verify-cinematic-flight`: 16/16, including actual vegetation worker integration at three latitudes, vegetation arrival/missing DEM, material failures and truncated payloads, shared disposal and late responses, physical scale and rebasing, periodic artwork, explicit surface selection, and leaf/shadow atlas ownership.
- `verify-stylized-earth`: 21/21; `verify-earth-boundaries`: 6/6.
- `graphics-unit` and `immersive-unit`: passed.
- Terrain merge, raster retry, DEM lifecycle/fallback and near-ground support tests passed during implementation; details remain in session output.
- `PlayerPlane.jsx` has three existing React immutability errors and two warnings under the repository's current lint rules. A baseline comparison found the same diagnostics before these edits; the comparison is saved under `.graphics-review/cinematic-flight/lint-comparison.json`.

### Findings retained in the evidence

- The current cruise capture initially blocked on `groundDetail.scanning:true` after the detail layer retired. Source inspection proved the early-return branch clears its generator and hides its mesh before refreshing that telemetry object. The corrected census accepts retirement only with the live immersion signal at or below the existing 0.001 cutoff and the actual mesh hidden; active queues and unknown states still block. Six focused checks cover both predicates. The rerun recorded live `k:0`, inactive ground detail, zero detail draws and 30,000 ft MSL. The blocked original and successful rerun are retained separately. This was a capture-tool correction; the tested renderer did not change.

- The current ground build's first style smoke run failed all six Satellite cases solely because that harness still required derived surface revision 4. Each observed revision 5 with ready terrain, buildings, materials and clouds; both Neon cases passed and there were zero rendering errors. The expectation advances to the implemented WorldCover revision 5, with all readiness and style-isolation conditions unchanged. The original failed report remains in `ground-final/styles`; the rerun uses `ground-final/styles-rerun`.

- The first camera implementation measured the mounted model through its parent transforms, effectively applying scale twice. A moving vertex-projection test caught the resulting fighter/cargo framing errors. Measurement now occurs on corrected source geometry before mounting. The subsequent probe measured fighter widths of 14.2–14.4%, propeller width 10.6%, cargo width 15.0–15.1%, with all models in view.
- The first airport exclusion lacked the latitude factor in the worker frame. The screenshot review caught remaining trees on taxiways; the integrated worker test now exercises the actual call at equatorial, middle and high latitudes.
- The first global sweep had one invalid Bali fixed-pose sample: terrain refinement changed the actual AGL after positioning. The harness now maintains requested AGL while keeping the terrain live; its existing five-metre tolerance was retained. This run remains recorded as failed, followed by a fresh run.
- The next numerical world sweep passed but its Tokyo image showed a floating city. That visual failure halted the endurance queue. The skyline fallback had used the previous region's ground height when destination DEM samples were unavailable, then never repaired the resulting grid. A dedicated probe reproduced approximately 462 m of error in Bali. Skyline fallback now draws only on measured samples within its own geographic group, retains a compact drape record, and resamples at most eight grid points / 0.35 ms per frame. A completed grid sweep can translate intact building runs in place with one upload. Near buildings also refuse continental-scale samples below zoom 10 during arrival. This preserves the existing ordinary terrain query and its nearest-intersection semantics.
- The corrected arrival probe recorded at most 3.74 m of sampled support discrepancy in Bali and 16.65 m in Tokyo (9.74 m after settling); these maxima include the deliberately coarse distant grid. Near buildings waited for destination data, with 8 Bali and 16 Tokyo chunks ready by the 12-second sample. Screenshots were inspected to verify the large floating masses disappeared. The Dead Sea fixture adds live negative-elevation coverage.
- Moving footage then exposed a separate vegetation arrival defect. Actual instance-base measurements found 335.61 m of support error at three seconds, taking about 24 seconds to settle: the vegetation grid accepted continental terrain heights, and near-contact smoothing prolonged the incorrect height even after the grid refined. The corrected grid rejects samples below zoom 12 and fills missing cells only from measured local terrain. With no local evidence it holds pending scenery; an existing ready forest remains during a heal. The corrected production probe found 52 nearby instances by three seconds and 437 by six seconds, with a maximum 10.61 m discrepancy at the far edge of the 2.4 km census. The visible airborne cluster disappeared. The original diagnostic's first attempt was BLOCKED because its coordinate conversion omitted the render origin; that failed instrument is retained separately.
- The 30,000 ft capture initially blocked on a harness condition requiring a ready near-building chunk. Its census proved the near ring had intentionally retired. The capture now accepts that state only when both measured AGL exceeds the existing 2.8 km retirement threshold and the runtime reports `ringOn:false`; terrain readiness and all allocation gates remain required.
- The eight-heading aircraft diagnostic compared prior aircraft parameters, the full treatment and bloom disabled. The prior control did not reproduce the reference screenshot's broad clipping (maximum white silhouette area 0.052%); the full treatment measured 0% across these views. Bloom-off was similarly small (maximum 0.026%). These are angle-specific measurements, not a claimed reconstruction of the original glare. Exposure and bloom were consequently retained. That diagnostic predates the ground-surface follow-up and does not certify every lighting angle in the current build.
- Early capture and framing builds are retained as iteration evidence. They are not substituted for final-build performance results.

## Reproduction

```powershell
# Packaged v2 arrays are already present. To regenerate from the recorded downloads:
node scripts/build-cinematic-surface-assets.mjs --source=.graphics-review/cinematic-flight/material-sources
node scripts/verify-world-cover.mjs
node scripts/verify-cinematic-flight.mjs
node scripts/ground-night-build.cjs --dist=.next-cinematic-ground-final
$env:FLY_BUILD_DIR='.next-cinematic-ground-final'
node node_modules/next/dist/bin/next start --port 3052
```

Use the newly generated build ID for subsequent checks. The current validation queue contains exact argument lists for global capture, matched routes, fallback, moving quality changes and separate 900-second daylight/night flights. It runs GPU workloads sequentially. Baseline videos, final videos and timing runs have distinct directories to avoid mistaking a recorded video run for a performance measurement.

## Acceptance limits

The reference images guide material richness, lighting and composition; this implementation does not claim equivalent asset density or photorealism. Local imagery and vector coverage still determine geographic detail. All final screenshot and motion evidence requires visual review alongside numerical gates.

Laptop acceptance requires rerunning the same production build on Radeon 780M-class integrated graphics with 16 GB RAM: 1080p output, internal scale at least 75%, p95 at most 16.7 ms and p99 at most 33.3 ms. Desktop measurements cannot certify that target.

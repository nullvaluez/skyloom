# True Earth — the browser pass record

**Started 2026-10-06 · lands straight on `main` behind flags · owner certifies on an RTX 5080 (Chrome) and an A17 Pro-class iPhone (Safari).**

This file is both the plan and the record. Each phase adds what landed, the flags,
the owner's run list and the results under **Status** below. The original plan
follows unchanged under **Plan**.

## How to try a flag on a live build

New look-changing workstreams begin `enabled:false` in `lib/fly/fly-constants.js`
(TRUE EARTH section at the end). The owner can authorize their release; the
current enabled set is recorded below. URL parameters switch things for one page load,
which also works on the iPhone where there is no console:

| Parameter | Example | Effect |
|---|---|---|
| `flags` | `?flags=TWILIGHT_FIX,SUN_TRUE_AZ` · `?flags=-HDR_GUARD` | turn flags on, or off with a leading `-` |
| `sunUtc` | `?sunUtc=2026-06-22T00:40:00Z` | pin the sun clock (ISO or epoch ms) |
| `weather` | `?weather=overcast` · `?weather=baseline` | pin a weather state |
| `diag` | `?diag=1` | diagnostics panel: live frame stats, 60 s benchmark, device report |

A flag's default normally flips after its run list passes. An explicit owner
release instruction is recorded separately from the measurements it authorizes.

## Status

### 2026-11-21 — In-flight performance over Argenteuil

The comparison starts from the build that already shipped the Paris facade,
building coverage and startup fixes below. It measures the next 24 seconds
of flight at 399 kt after the local scenery is loaded. High and Ultra run
with their own fixed pixel ratios and shadow settings. The ordinary player
launch is a separate run with the adaptive governor and the flight model
in control.

The CPU profile identified three sources of repeated work during flight.
Detailed city meshes submitted visible ranges and then paid for another
empty draw. The coastal mirror updated the world transform of every object
twice. Airport terrain deformation scaled metre heights by the horizontal
width of a tile, admitting distant runways into its vertex processing.
The renderer now submits the last visible range in Three's normal draw,
updates the reflected geometry and lights before the mirror pass, and tests
physical terrain bounds against runway and shoulder footprints. Altitude
queries use the same indexed terrain triangles as building contact. LERC
workers return completed terrain skirts alongside each decoded tile.

Surface-mask updates repaint the three-texel border affected by a new
neighbor. The cinematic terrain shader reads the fine classification first
and skips the coarser texture reads when coverage is exactly one. Partial
coverage still blends in geographic order. Distant buildings also skip
vertex shading when the existing rules already collapse all their triangles
or discard every fragment.

The two settled cockpit captures shared 170 live terrain tiles. All 170
matched by SHA-256 for indices, positions, normals and UVs. All 569 decoded
terrain meshes in the optimized capture arrived with their skirts completed
in the worker. The High view had 31,840 building columns and 24 roof imagery
tiles in both builds. The screenshots and timings use separate browser
sessions. [Matched cockpit crops and frame-time traces](docs/reviews/building-approach/flight-throughput.webp)

The harness is `scripts/review-flight-throughput.cjs`. Its fixed route uses
live imagery and terrain and an empty traffic feed. Its player mode opens the
ordinary flight link with live traffic, the default graphics preset, the
adaptive governor, and full flight simulation.

Two independent 24-second moving runs per build and preset, measured in
Chrome on the RTX 5080 at 1440 × 900, gave the following pooled results.
P95 and P99 measure intervals between completed world draws. High rendered
at DPR 1 with two 1024 px shadow cascades. Ultra rendered at DPR 1.5 with
three 2048 px cascades throughout both arms.

| Moving flight | High before | High after | Ultra before | Ultra after |
|---|---:|---:|---:|---:|
| Average FPS | 22.5 | 31.0 | 20.9 | 29.5 |
| P95 frame interval | 90.6 ms | 47.9 ms | 93.7 ms | 50.5 ms |
| P99 frame interval | 146.4 ms | 73.2 ms | 156.9 ms | 73.9 ms |
| Frames over 50 ms in 48 seconds | 233 | 63 | 253 | 75 |

In two ordinary launches per build, the first 11 seconds of visible
free flight averaged 23.5 → 29.1 FPS. The following 24 seconds averaged
28.7 → 30.7 FPS, with P99 improving from 90.6 to 60.8 ms. The two later
flight pairs measured 34.7 → 33.0 and 22.8 → 28.4 FPS. Live traffic,
the actual flight path and the automatic graphics rung can differ across
these launches, and each build used more than one pixel ratio. In a
separate profiled repeat the optimized flight held native resolution for
nearly the entire moving segment, while the older build stepped down
to 0.75×. The fixed-preset comparison above isolates the scenery changes.

A separate 22-second entry check observed zero black frames in 618
compositor samples and zero dark frames in 975 sampled browser
presentations. The longest interval between completed world draws in
that cold-entry check was 245 ms.

All 49 beta suites passed. The separate historical city gate reported
46 passes and the same three worker or shader fingerprint differences on
both the unchanged Git baseline and the working tree. An independent
comparison of its 48 flag-off worker fixtures matched byte for byte.

### 2026-11-21 — Default scenery and the Argenteuil approach

The owner requested that `BUILDING_APPROACH` and `CANOPY_VIEW_LOD` ship on.
Ordinary Enhanced sessions now use the building changes, and the airborne
canopy policy applies on its supported tiers. The previous scenery can be
compared on the same build with `?flags=-BUILDING_APPROACH,-CANOPY_VIEW_LOD`.

The Paris material region applied central-city limestone across the approach
to Argenteuil. Mapped wall colors now take priority, including named colors,
and untagged walls use a stable mix of suburban materials as the city center
recedes. Near and distant meshes agree. On the approach tile, 1,863 of 1,895
facades met the pale-warm sRGB threshold before the change, and 597 met it
afterward. Median wall color moved from RGB (212, 200, 177) to (185, 181, 168).
Median roof color was (129, 129, 111) in both runs. Across the 1,257 roofs
with usable reference imagery, median CIE76 error held at 4.24. The threshold
was R ≥ 165, R − B ≥ 20 and R ≥ G ≥ B, evaluated on material colors before
scene lighting. [Matched cockpit views](docs/reviews/building-approach/argenteuil-facades.webp)

The previous approach preview supplied an incomplete building geometry to
shader preparation. A missing instance attribute threw during cloning and
aborted the entire world material batch. The warm scene now mirrors the
geometry and cutout/shadow shaders used by the live renderer, including the
compact skyline on lower tiers. Free Flight reuses the arrival already
streamed at its launch point. A genuine relocation still resets the stream.
Resident skyline roofs can start their low-priority imagery requests once
the local terrain, surfaces and buildings are ready.

The 1.895-second task at cockpit entry had a separate cause. A Chrome CPU
profile attributed 1.475 seconds to the instrument panel's first color pass
and 0.308 seconds to its first shadow pass. The game now builds the selected
deck and prepares its actual screen and shadow programs before use. A
settled hangar selection can prepare one candidate while the current deck
remains available for Cancel. Exterior-only selections skip that work.
The terrain and building programs can link concurrently as soon as terrain
is submitted. Warm-up work that shares the terrain program still waits for
the driver to finish.

The governor now resizes the visible WebGL drawing buffer on the frame that
can actually draw. The compositor reuses prepared material variants as
objects return to view. Bloom rejects non-finite input at its extraction
stage, including frames on which the cloud pass is skipped.

First-second screen captures exposed another cause of the unfinished city.
The driver took about 24 seconds to link the full terrain material in a
single submission. The loading cap could release the player while the river
and ground underneath the buildings still showed the scene background.
During that interval, the terrain now uses its resident satellite texture,
elevation mesh and world curvature. The exact lit material takes over when
the driver completes its link. [First-second and eighth-second captures](docs/reviews/building-approach/argenteuil-entry.webp)

An Ultra CPU profile caught a second cost at that handoff. Switching 170
resident tile materials to full lighting in one frame took a 198 ms
main-thread task. About 89 ms went into preparing the actual tile programs
and another 32 ms into the generic warm-up batch. After reveal the game
now promotes up to eight tiles per frame and retains each tile's preview
until its own color and depth programs can draw. Generic preparation uses
batches of up to four meshes. In the follow-up profile the same 170 tiles
finished switching in 22 frames over 1.09 seconds, with the longest task
overlapping the handoff down to 58 ms.

**Live RTX 5080 comparison.** Chrome ran the production builds at 1440 ×
900, High, with fixed daytime weather and sun. The previous build had both
scenery preview flags explicitly on. The corrected build used its defaults.
The camera was placed south of Argenteuil at 48.889° N, 2.246° E, looking
037° at 2,072 ft MSL. This approximates the supplied screenshot. The facade
stills also locked pixel ratio to 1 on both builds. Both showed 16 detailed
tiles, 31,840 building columns and 24 photographically colored skyline groups.
Automated Chrome retains shader diagnostics during these measurements.

| Stationary cold flight, from navigation | Previous build | Corrected build |
|---|---:|---:|
| Flight released | 37.8 s | 22.7 s |
| Full detailed building ring | 14.3 s | 19.8 s |
| First skyline imagery received | 38.6 s | 16.3 s |
| 24 skyline imagery groups received | 50.3 s | 32.7 s |
| World material batch | Failed | 20 linked programs, ready at 9.5 s |
| Longest main-thread task from the title-to-flight transition through 45 s after release | 1,608 ms | 79 ms |

The old flight remained covered for another 15 seconds after the title
handed off. Both detailed rings were available by the time the player got
control. The corrected run spent more of its startup time drawing the
terrain that had already loaded. The full terrain lighting was ready at
26.5 seconds. These are single cold runs with live scenery.

A separate replay advanced 9.2 km at 399 kt and counted completed world
draws. On the previous build the longest interval between draws was 14.65
seconds. The browser continued running animation callbacks throughout that
interval. After the startup fixes the issue was still reproducible at 13.97
seconds. At the start of that gap, the adaptive effect level reduced the
number of shadow cascades from two to one with the same environment texture,
High scenery tier and 0.75 pixel ratio. The compositor held the previous
frame while 18 shader programs linked. The governor subsequently attempted
to restore the second cascade while the aircraft was still showing the
same frame.

Automatic quality reductions now retain the lighting configuration the
world's shaders already use. At High, the first structural reduction
shrinks the two shadow maps from 1024 to 512 pixels and reduces their
base reach from 1,800 to 600 metres. At the lowest automatic setting,
the game pauses shadow drawing and keeps the existing sampler bindings.
Clouds and post-processing still follow their reduced budgets. A phone
that started above Low can park its single map, while a phone that starts
at Low allocates none. The governor also pauses its measurements whenever
the compositor retains the previous frame.

| First 45 s of moving flight, High | Previous build | Corrected defaults |
|---|---:|---:|
| Completed world draws | 795 | 1,539 |
| 95th percentile interval between draws | 64.1 ms | 63.0 ms |
| 99th percentile interval between draws | 129.1 ms | 114.4 ms |
| Longest interval between draws | 14.654 s | 0.185 s |

The corrected flight reached both automatic shadow reductions. The two
light identities and the environment remained stable. The post-processing
chain still briefly waited while its cheaper passes became available.
[Completed world draws by second](docs/reviews/building-approach/argenteuil-motion.webp)

An 80-second Ultra run started at 1.5 pixel ratio and exercised the automatic
reductions through Low. It retained all three light bindings. Direct pixel
readback found zero black world frames among 2,170. A separate Chrome
screencast found zero black windshield views among 2,763 samples. The
longest gap in this instrumented Ultra run was 391 ms. The earlier build
also produced zero whole-frame blackouts on the sampled route. Controlled
invalid HDR input reproduced the bloom defect in the WebGL2 regression.
The test therefore establishes the repair for that input and the observed
route coverage. Intermittent local flicker may still occur elsewhere.

The hangar check used the ordinary title and aircraft controls. Choosing
the airliner prepared its cockpit, Cancel restored the original aircraft,
and choosing it again and launching reused the prepared cockpit instance.
All 49 beta suites passed, including the new facade, shader, cockpit and
governor checks. Outside that suite, the original R25 flight-plan harness still has
three historical source/markup comparison failures (7h, 8a, 8b), and
the measured-world harness's recorded shader key predates the current
material version. Those failures also reproduce on the previous revision.
The standalone vendor and terrain LOD checks retain their previously
failing assertions (33/34 and 60/64 respectively).
Physical iPhone Safari remains unmeasured for this change.

To repeat the moving-flight measurement against a locally served production
build, run `node scripts/review-argenteuil-loading.cjs http://127.0.0.1:3428 release cruise`.
The optional last argument sets the number of seconds in flight. Set
`FLY_REVIEW_PRESET=ultra` to exercise three shadow cascades. The
`cruise-pixels` mode also records the world buffer and samples browser
presentations. Timing comparisons use the separate `cruise` mode to avoid
the cost of pixel readback.

### 2026-11-21 — Buildings on approach, initial comparison

These measurements compared the earlier defaults with the two opt-in
features. The default release is recorded above. “Current defaults” and
“preview” in the original captures refer to those two historical arms.

The detailed city already streamed along the flight path. On a 4.2 km
High flight over Powell, Ohio, detailed building tiles were present 3 km
ahead at all 27 samples on the measured route. Farther out, the skyline
worker rejected small, mapped footprints without tagged
heights even when the near renderer could determine a plausible house height.
On nine recorded local source tiles the old worker emitted one distant body.
The preview emitted 557. Five of those nine tiles still emitted zero.

The preview admits low-rise clusters using neighboring mapped footprints.
It uses the detailed building height model and represents each distant body
with a roof and two camera-facing walls, six triangles altogether. Projected
roof width matters for a long, low building. A stable footprint sample tapers
with screen size, and the detailed tile takes over as its actual mesh arrives.
The existing per-tier triangle and request ceilings still apply. Elevated
building parts can retain their open space underneath.

In mapped residential gaps, the near houses get the first share of the
existing pool. Remaining slots can place individual houses beside verified
streets on already-resident terrain. Those candidates pass the worker's
building, water, land-cover and airfield masks. The outer houses taper from
2.6 to 4 km in true ground distance. A new house and its shadow appear
together over 1.2 seconds. A change to the resident tiles refreshes a parked
view as well as a moving one. The initial settlement hold still applies on
arrival.

A close look at Quail Crossing Drive, Ohio, exposed a separate near-field
failure. Its vector tile contained two mapped building footprints. ESA
WorldCover classified small patches beside the streets as built and the
surrounding lawns as grass. The previous placement rule required the entire
clearance area to be built. The preview can place a house on a compact built
patch 20–40 m from a minor street, with room around the whole house.
Long paved strips, continuous parking areas, protected land classes, and
areas occupied by a mapped building are excluded. A regression covers a
7 m shed narrow enough to fall between the original raster samples.
The November 15 vector tile replay produced 12 inferred roadside houses,
including four within 250 m of the inspected spot and ten within 500 m.
The positions are estimates from ESA 2021 and mapped roads. No extra tile
requests are needed.

On the RTX 5080, all four of the nearby houses reached the scene. The aircraft
was 1.32 km from the reference point at the approach endpoint. Removing only
those houses changed 642 pixels in the rendered frame, including any shadow
contribution. [Quail Crossing comparison](docs/reviews/building-approach/quail-crossing.webp)

In warmed Node replays the extra roadside search took 1.63 ms per Quail
tile and 3.21 ms on a Manhattan tile with 2,817 mapped building features.
The Quail worker transferred 156 additional bytes. Manhattan added zero homes
and zero parcel bytes. These are tile-worker costs. Browser frame intervals
are measured independently below.

**Measured in the renderer.** The High comparison uses Chrome on the RTX
5080 at 1440 × 900 with live scenery. The aircraft flew 4.2 km at 180 m/s.
The camera, sun, weather and detailed geometry matched at the two endpoints.
For each still, the capture rendered the same instant with the distant
building layer visible and hidden. It counted pixels changing by at least
six levels in any 8-bit RGB channel, after excluding differences between
repeat control renders. A second measurement collapsed only the boxes in one
ground-distance band at a time. Occlusion and postprocessing make the band
counts non-additive. The mask measures the mapped skyline layer. Procedural
house placements and canopy triangles are counted separately.

| Powell High at the approach endpoint | Current defaults | Building preview |
|---|---:|---:|
| Detailed building tiles / indexed columns | 19 / 3,435 | 19 / 3,435 |
| Pixels affected by distant buildings, full frame | 1,938 | 8,590 |
| Pixels affected by buildings at 3–6 km | 123 | 1,090 |
| Pixels affected by buildings at 6–10 km | 1,266 | 6,038 |
| Pixels affected by buildings beyond 10 km | 543 | 1,537 |
| Procedural home instances at least 2.5 km away | 0 | 75 |
| Distant building triangles / draws in the composer render | 50,694 / 16 | 306,222 / 11 |

At that Powell endpoint the default canopy used 142,344 triangles in the
main view and submitted 91,324 more for crown shadows. The combined preview
used 59,250 main-view canopy triangles. At this height the canopy selected
patches for the forest and submitted zero near-crown shadow triangles.
The whole composer render went from 776,072 triangles at default settings
to 1,055,692 with buildings alone and 880,373 with both previews. The
combined preview used 13.4% more triangles than the default at this point.
The moving-flight p95 frame interval was 25.0 ms in all three configurations,
one run per configuration. The performance tradeoff will vary with the
camera height and neighborhood. [Powell comparison](docs/reviews/building-approach/powell-high.webp)

The Medium flight from Brooklyn toward the Hudson exercised a different
budget. At the matched endpoint its distant layer affected 12,540 pixels
before and 26,652 in preview. Distant geometry went from 91,338 triangles
in nine draws to 57,258 in six. Both arms had 11 detailed tiles and 25,342
indexed columns. The moving p95 frame interval was 16.8 ms in both flights.
[Brooklyn comparison](docs/reviews/building-approach/brooklyn-medium.webp)

**Cold maximum-boost approach.** Four 24 km flights at 750 m/s started
moving as soon as the world became available. The check sampled the same
forward strip (1–2.5 km ahead, 1 km wide) once per kilometre. At defaults,
procedural houses appeared at 10 and 8 of 24 checkpoints. With both
previews they appeared at 17 and 18. Trees were present at 23 of 24 in
all four runs. At 3 km ahead, the mapped detailed-building source had a
mesh at 20 checkpoints and had explicitly returned empty at the other four
in every run. Median frame interval was 16.7 ms throughout. In run order,
p95 was 33.4 ms (default), 41.7 ms (preview), 58.2 ms (preview) and
58.3 ms (default). This stress test demonstrates earlier coverage. It leaves
boost-speed frame pacing open. All nine flight captures completed without a
page error or shader error.

The independent review caught three regressions before the final build. A full
pool could drop nearby houses when more outer tiles arrived. Enabling both
city previews could erase an existing, loosely spaced subdivision. The
small mapped shed at Quail scale exposed an overlap beyond the detailed
collision ring. The regression tests now exercise 25 competing tiles in a
5,000-home pool, the union of both footprint policies, and worker exclusion
of the overlapping house. Physical iPhone Safari and owner visual acceptance
remain open.

Reproduce the worker and pool checks with
`node scripts/verify-building-approach.mjs`. Add `--quail --powell` to
replay the source tiles. Run
`node scripts/review-building-approach.cjs <production-url> baseline powell high`,
repeat with `buildings` and `combined`, then run
`node scripts/review-building-approach.cjs compare buildings powell high`.
Append `quail` to isolate the four houses. Use `brooklyn medium` to repeat
the city comparison. Append `--publish` to a comparison command to export a WebP.
The full images, masks, motion samples and frame intervals are under
`.graphics-review/building-approach/`.

### 2026-11-19 — Forest crowns from the air and distant road lights

Fableflight represents trees from multiple directions over the upper hemisphere,
staggers detail changes between trees, and uses the width of a screen pixel on
the road when shading its markings. In Skyloom the near crown had twelve vertical
leaf cards. From directly overhead every leaf triangle was edge-on. Selecting
detail by horizontal range still put those trees in the most expensive pool.
The road lights also sampled a single point in each repeating pattern, even when
one pixel covered multiple lamps or moving dashes. [Fableflight tree impostors](https://github.com/Rolandjg/fableflight/blob/d91a7c09154268f85635c412c5ffc607ad2ad951/src/impostor.rs) · [tree detail selection](https://github.com/Rolandjg/fableflight/blob/d91a7c09154268f85635c412c5ffc607ad2ad951/src/shaders/trees.wgsl) · [road shader](https://github.com/Rolandjg/fableflight/blob/d91a7c09154268f85635c412c5ffc607ad2ad951/src/shaders/roads.wgsl)

**Forest preview.** `CANOPY_VIEW_LOD` slopes four of the twelve leaf cards
across the crown. The visible tree and its shadow use the same 34 triangles.
The forest chooses its detail using the camera, local terrain height and zoom.
Banking widens the planning cone to include the corners of the picture, and a
view straight down can include every bearing. Nearby groups change detail at
slightly different distances. In a fixed 80 × 80 top-down cutout test, the
leaf-covered sample count rose from 0 to 2,227. At the same side angle it went
from 869 to 803.

On four 10 km Powell flights at 215 m/s in Chrome on the RTX 5080, alternating
off/on/on/off, the mean canopy triangle count at the ten distance checkpoints
went from 113,306 to 63,139 (44% lower, main pass only). Trees were present in
the same forward strip at every checkpoint in all four flights. Median frame
time was 33.3 ms in each flight and p95 ranged from 74.9 to 75.1 ms.

**Road preview.** `ROAD_LIGHT_FILTER` integrates each moving dash and streetlamp
across the length of road covered by a pixel. A distant unresolved pattern
tends toward its mean brightness. On the RTX 5080, the 512-phase shader sweep
kept the resolved pattern byte-identical. At 0.24 cycles per pixel the 8-bit
dash range fell from 255 to 31, and at 0.7 cycles per pixel both dash and lamp
ranges fell to zero while mean brightness stayed within one 8-bit level.

With both flags active, a 10 km night flight over Powell at 215 m/s loaded
trees 1–2.5 km ahead and buildings at 3 km at all ten checkpoints. The game
reported the filtered road program at the end of the flight. Chrome recorded
no page or shader errors. The production build and all 40 beta checks passed.

**Default performance change.** Dense forest tiles now reuse rectangular sums
when sampling the satellite photo. Sparse tiles read the few source pixels
they need. On nine Powell vegetation tiles (83,990 crowns) with a fixed
full-range RGB input, all output colours, densities and season decisions
matched the previous build. Across 90 paired samples, median colour preparation
went from 2.32 to 2.10 ms per tile and p95 from 3.50 to 3.44 ms. Reproduce with
`node scripts/benchmark-powell-clearance.mjs --canopy-photo`.

Both appearance flags ship off. Preview together with
`?flags=CANOPY_VIEW_LOD,ROAD_LIGHT_FILTER`. The canopy preview uses the desktop
High/Ultra World Ground producer. Physical iPhone verification remains open.

### 2026-11-19 — Scenery ahead of a moving aircraft

The canopy used to wait for the building arrival hold, its vegetation tile,
its fine terrain grid and its imagery in sequence. A jet could leave that tile
before seeing its trees. During arrival one image request can now run alongside
the first terrain pass. A grove can appear as soon as its image and four local
terrain samples are ready. Travelling 500 ground metres releases the arrival
hold. Later terrain detail still corrects the resident trees.

Buildings, skyline groups and the wider forest now rank pending work along the
measured ground track. The lead is ten seconds of flight, capped at one and a
half tile widths for each layer. The nearby ring still covers turns. Distant
building groups wait for worker capacity before expanding into tile requests.
Procedural housing can refresh after 350 ground metres, at most twice a second.
A local residential gap requires mature mapped tiles and collision indices
across its search area, residential anchors and road clearance. Streaming work
elsewhere no longer blocks that decision.

Fableflight uses cheaper distant trees and limits uploads per frame by count
and bytes. Skyloom already had distant tree patches and frame budgets. This
pass changes which scenery gets those resources first. [Fableflight world streamer](https://github.com/Rolandjg/fableflight/blob/d91a7c09154268f85635c412c5ffc607ad2ad951/src/world.rs)

On the RTX 5080 in Chrome, flying east-southeast from Powell at 750 m/s,
the first moving sample with trees in the forward strip came after 1,428 m
and 2,161 m on two runs of `38b5f7d7`, and after 169 m on the final build.
Sampling was approximately twice a second. At the first fixed checkpoint,
500 m into the flight, the original runs had zero canopy instances in the
strip and the final run had 179. Across the 24 km route, canopy appeared at
22 of 24 checkpoints, up from 20. Procedural homes appeared ahead at 9 of 24,
up from 2 in the instrumented baseline. Both builds had detailed buildings
3 km ahead at 20 checkpoints and reported resolved empty tiles at the other
four. On the 10 km Melton approach at 215 m/s, procedural homes appeared in
seven of ten forward strips on both builds. The sum of house instances across
those snapshots went from 231 to 295. Canopy coverage went from nine strips
to ten. These runs measure scenery arrival on desktop. iPhone Safari is untested.

For a moving comparison, run `node scripts/review-scenery-flight.cjs <server-url> <label> 750 powell`.
Use `215 melton` for a residential approach. Each run records rendered canopy
and house instances in a strip 1–2.5 km ahead and one kilometre wide, plus
detailed building-tile status at 1.5 and 3 km. Reports and screenshots go
under `.graphics-review/scenery-flight/<label>`. The deterministic gate
`node scripts/verify-scenery-flight.mjs` also covers turns, warps, missing
terrain and queue limits.

### 2026-11-19 — Powell seasonal imagery and scenery streaming

The pale band visible on the Powell approach survived a stationary wait with
z18 terrain, sharp imagery and all 20 distant building photos loaded. The live
Esri images themselves carry a seasonal boundary through the neighborhood, even
within a single detailed tile. The z11 regional image is green on both sides.
The previous low-altitude terrain correction had zero weight, and the tree
crowns derived their color and leaf density from the detailed image alone.

`SCENERY_COLOR` extends regional color balancing down to the cockpit
approach. Terrain retains high-resolution photographic detail and preserves
neutral roof and pavement hues. New reference tiles fade in over 1.2 seconds,
and both sides of a terrain LOD transition use the same correction. The tree
crowns take their local color and season from the same regional reference.
The owner authorized enabling it by default on November 19. Use
`?flags=-SCENERY_COLOR` to disable it for one flight. Physical iPhone
verification remains open.

The streaming repairs apply in ordinary flights. Stalled response bodies
release their download slots. The terrain reference and trees retry while the
aircraft is stationary. Building photos make bounded progress while geometry
is busy, and near roofs keep their strongest evidence through partial outages.
Roof colors and walls can also recover if only the regional image failed.
Warped-away requests cannot recolor a replacement chunk. Elevation backfill
skips background geometry below the provider's minimum zoom.

Trees and roadside infill share a land and exclusion mask. On nine z14
OpenFreeMap tiles from this approach, the two previous mask preparations took
9.91 ms median and 28.39 ms p95. The shared preparation took 2.29 ms median
and 11.30 ms p95 over 90 paired samples. Class and exclusion bytes matched on
every tile. The complete vegetation build on the same nine tiles with live
ESA WorldCover data went from 65.45 to 54.48 ms median and from 107.76 to
84.02 ms p95. All geometry arrays and placement counters matched, including
83,990 tree crowns. These timings cover worker CPU time.

The production build and all 36 source, gameplay, world and shader checks
passed. The combined city and scenery preview linked on an RTX 5080 in Chrome
through Ultra, High, Medium, Low and back to Ultra, with zero shader or page
errors. Ultra retained three shadow cascades and stayed within 16 texture
units. Targeted regressions cover stationary retries, a stalled HTTP 200
body, late regional imagery, warp cancellation, roof and wall recovery, and
matching canopy supports.

In the two live High cockpit captures, both flights reached z18 with all 64
regional tiles, 20 distant photos, 15 near building groups and 1,500 near
crowns. The camera and sun matched exactly. Distant canopy counts were
4,663 and 4,668. The tan woodland band was visibly reduced, the roads and
roof detail remained legible, and both flights resumed for over 1.3 km.
Neither flight recorded a failed relief backfill. The paired screenshots
and telemetry are written under `.graphics-review/powell-color/`.

Reproduce the live cockpit comparison with
`node scripts/review-powell-color.cjs <production-url> before`, repeat with
`after`, then run `node scripts/review-powell-color.cjs compare`.
The replay pins the aircraft and sunlight, waits for photos and canopy
placement, saves each view and resumes flight. The mask benchmark is
`node scripts/benchmark-powell-clearance.mjs`. Its `--full` option compares
complete vegetation bundles against the pre-pass revision on the same vector
and land-cover data.

The historical R25 ground suite still reports its two insert-only vendor
checks against earlier tags. The living-ground suite still reports two
atmospheric shader-text assertions. Its actual shader compilation passes
with the feature on and off.

### 2026-11-18 — F-35 cockpit and outside view

An ordinary F-35 flight now offers **Cockpit view** and **Outside view**.
Click the view button or press **4** on desktop. On touch, open **Flight
actions** and tap the destination view. Settings retains both outside camera
distances. Skyloom remembers the chosen seat for the next F-35 flight.
With no saved choice, the outside view opens first while `F35_COCKPIT`
defaults off. A positive URL pin starts the flight in the cockpit for one
load. A negative pin disables cockpit selection for that load.

The open sightline and panoramic display follow the F-35's publicly
documented cockpit layout. Skyloom supplies its own flight instruments. The
visor's compass follows the pilot's gaze, and the attitude marks follow the
earth horizon. The main display reads the flight model, nearby places and
traffic. Its standby attitude window shares the live attitude picture.
[Lockheed Martin's cockpit design overview](https://www.f35.com/content/dam/lockheed-martin/eo/documents/webt/F-35_Mission_Systems_Design_Development_and_Verification.pdf)

The side-stick and throttle animate from the simulation inputs. The
sun lights the canopy bow, padded glare shield, fascia and flight suit in
aircraft coordinates. The display dims at night. Cockpit meshes and textures
load on the first seat selection and stay available until the airframe changes.

Chrome on the RTX 5080 rendered the daytime and nighttime cockpit over
Paris. Desktop checks covered the view button, keyboard shortcut, head
movement, photo-mode return and seat persistence across F-35 flights.
Touch emulation covered both switching directions and both phone
orientations. The five seat/camera tests and the gameplay and source
verification suites passed.

For physical iPhone review, enter the cockpit from Flight actions, glance
sideways, rotate the phone, and switch back outside. Check panel legibility
and sustained frame pacing in Safari.

### 2026-11-18 — Missing water and terrain on Ultra

An external-camera flight over the Hudson reproduced the missing river and
streets with `CITY_CONTINUITY` enabled. Satellite images were present on
all 164 attached terrain tiles. The Ultra terrain shader requested 17
fragment texture units on an RTX 5080 driver that supports 16. The GPU
rejected the program. Buildings and clouds use different programs and
remained visible. Turning off just `CITY_CONTINUITY` restored the surface.

City height tiles now occupy two additional rows in the terrain appearance
texture. Surface classifications retain their original dimensions. This
preserves the water, satellite imagery, city relief and three shadow
cascades within the 16-unit budget. Run
`node scripts/verify-ultra-terrain.cjs --city-continuity` to exercise a
saved Ultra boot and return to Ultra through High, Medium and Low.

### 2026-11-18 — Distant neighborhoods in flight

Preview with `?flags=CITY_CONTINUITY,FLIGHT_RELIEF,FLIGHT_CLARITY,F35_COCKPIT`.
`CITY_CONTINUITY` defaults off. Over Queens, even a fully loaded High skyline
had an abrupt boundary. The geometry budget culled similar low-rise buildings
at the same distance, and shading turned their remaining walls toward the sky.
Medium and Low used a sparse extruded skyline beyond the detailed tiles.

High and Ultra now keep a repeatable sample of mapped buildings at each distance.
Visible walls retain directional lighting. On Medium and Low, the worker reserves
space for prominent buildings and samples neighborhoods across each tile. The
main view, water reflections and outgoing geometry share the tier's triangle
budget. At the outer boundary, each remaining building tapers into the
surface. This removes the screen-space checkerboard on its walls. A tile
group retains its existing buildings while it retries missing data.

Beyond individually resolved roofs, the terrain blends in average building
height and directional relief from the European Commission's 2018 GHSL survey.
The packed layout adds 1.13 MiB to the terrain appearance texture on the
existing terrain draw. A failed height request
leaves the satellite surface available. [GHS-BUILT-H data and attribution](https://registry.opendata.aws/ghs-built-h/)

The comparison route in `scripts/review-manhattan-continuity.cjs` starts at
40.7692° N, 73.9810° W, 1,931 ft and looks across the East River. It records
the same view after travelling 1.8 km towards Queens. A separate Paris
comparison reuses the banked Seine cockpit pose. On the RTX 5080 the High
and Medium captures matched in pose, light and resident detailed tiles at
both ends. On High, 282 low-rise footprints at 8–12 km passed the fade
cutoff at the endpoint, up from 97. The measurement covers the 48° view
towards Queens. A separate flight used normal banking and pointer look.
Physical iPhone testing remains open.

GPU verification also found that the High cloud material could add its GLSL
declarations three times when cascaded shadows installed their shader hook.
That variant failed to link during warmup. The cloud material now applies
its lighting once per shader, with a regression check in
`scripts/verify-flight-relief.mjs`.

### 2026-11-18 — Paris cockpit, skyline and horizon

Preview with `?flags=FLIGHT_RELIEF,FLIGHT_CLARITY,F35_COCKPIT`. The new
`FLIGHT_RELIEF` flag defaults off. In daylight the distant cloud layer uses
coverage and lighting extracted from Greg Zaal’s CC0 Kloofendal sky. The
live sun orients the cloud light, the local volume still handles fly-throughs,
and the aerial perspective follows the visible terrain’s curved horizon.
Night, dense fog, overcast and flight above the layer hand back to the
existing weather model.

Desktop High resolves four facade materials on the building’s existing
window coordinates. Each elevation covers four bays and four floors. The
textures use independent mip chains, and the wall returns to filtered
architectural bands at range. Nearby ungrouped convex towers can use an
offset upper floor inside their mapped height. Large far buildings can
retain wings and courtyard openings as up to four sections that share a
ground elevation. Each tile may use up to 24 spare instances. The F-35 uses
a shaped leather coaming and scuffed paint around fittings and canopy hardware.

The two Paris comparison positions are in `scripts/review-paris-relief.cjs`.
In a matched RTX 5080 capture, disabling building shadow reception removed
the diagonal bands on the tower walls. Restoring it brought the bands back.
The city cascade covered about 10 m per shadow texel on this approach. Wall
receivers now offset their shadow lookup by up to half a texel in this
preview. Fine cascades retain their original bias.

The capture pins the view, flight attitude, sun, baseline weather and cloud
advection. Traffic is held empty for the comparison and imagery streams live.
The low approach uses the owner’s heading of 339°, altitude of 1,103 ft and
airspeed of 126 kt. The banked Seine view is at 3,806 ft. Physical iPhone
appearance and performance remain open for owner review.

The beta suite passed all 34 checks. The recorded Paris worker tiles
used 16 and 15 additional sections respectively. The fixture checks also
covered shape fitting, shared roof elevation across a batched terrain
update, and preserved roof height. Two historical R25 sky assertions,
4h and 4i, also fail against the preceding commit.

### 2026-11-18 — Flight clarity and the F-35 pilot seat

`?flags=FLIGHT_CLARITY,F35_COCKPIT` previews both changes for one load.
Each can also be evaluated independently. Both default off.

The clearest parts of the Paris flight are the Seine, recognizable street
layout, changing daylight and ability to fly straight to a place. At city
scale, moving screen-space grain and small buildings competing for the same
pixel made those geographic cues harder to read. Three changes address that
directly.

- Enhanced flight omits the animated film grain. Output dithering still
  protects gradients.
- The distant building groups now sample a worker-built, linear-light photo
  pyramid with a footprint measured before fragment discards. The rooftop,
  wall and terrain material scans also use explicit gradients across material
  boundaries. At the existing 40 × 512-pixel configuration the extended
  photo atlas costs an additional 20 MiB of GPU texture storage. Each of
  the CPU atlas and a completely full decoded-photo cache can also grow by
  20 MiB. Groups still upload one slice at a time.
- Buildings in the existing 0.8–1.6 CSS-pixel visibility band grow in projected
  area as they approach. This removes their extra screen-door pattern. On
  desktop High and Ultra the cloud bank contour also uses broader, filtered
  billows that survive the ray-march spacing at shallow angles.

The F-35 has an original, flight-only interior with a pilot-eye camera,
canopy frame, cambered wings, live combiner and instrument display. The
navigation display reads the game's places and traffic. Press **4** to
switch between seat and chase. Drag to look, then release to face forward.
Brackets glance sideways, and Page Up / Page Down tilt the head. On touch,
use **Flight actions → Pilot view**. Settings also offers **Flight view →
Pilot**. Other aircraft retain their existing views.

The comparison procedure is in [the flight capture script](scripts/review-flight-clarity.cjs).
[The moving-texture GPU check](scripts/verify-world-clarity.mjs) and
[the camera checks](scripts/verify-f35-cockpit.mjs) isolate filtering and
pilot-eye projection. The renderer still uses simplified distant buildings.
Cloud banks and the transition into horizon haze remain visibly softer than
the supplied photographic reference. Desktop evidence and Chrome touch
emulation do not establish physical iPhone Safari appearance or performance.

**Measured in the production build.** Chrome used ANGLE D3D11 on the local
RTX 5080. Both Paris captures ran at High, 1600 × 900 native pixels, with the
same sun, pose, 16 near building groups and 24 skyline groups with all 24
photos loaded. Over eight fixed-camera frames, the mean absolute change in
8-bit luma in a 240 × 40 rooftop region was 2.252 with the defaults and 0.047
with clarity enabled. A second, 12-step camera turn gave 6.65 and 5.66 in a
600 × 252 city region. The turn includes ordinary motion across roof edges
as well as shimmer. In the isolated GPU check, an unresolved black/white
stripe changed from 0–255 across camera phases to a constant 128. The
resolved close-up stripe retained its original 0–255 range.

All 34 beta checks passed. The seat's dedicated checks covered camera
ownership, 81 attitude/latitude/head-turn combinations, head recentering
and exterior-camera transitions. The running game also passed seat/chase,
photo entry/exit and touch action switching. Captures and the motion
comparison are written under `.graphics-review/cockpit-grain/` by the
flight capture script (`before`, `after`, then `compare`).

### 2026-11-01 — Building surface and streaming follow-up

[Building stutter](FLY_BUILDING_STUTTER.md) records overlapping wall/trim
ownership repair, fair shared chunk admission, and worker-built normals.
`DISTANCE_SOFTEN` adds a bounded distant-city detail preview, **off by default**;
use `?flags=DISTANCE_SOFTEN&diag=1`. Device appearance acceptance and sustained
performance gains are not implied by the regression checks.

### 2026-11-01 — Premium Earth enabled by owner instruction

[FLY_PREMIUM_EARTH.md](FLY_PREMIUM_EARTH.md) records the scanned-material,
foliage, architecture and Manhattan/Yosemite implementation. After the corrected
preview, the owner instructed **“Push to main and enable everything.”**
`MATERIAL_SCANS`, `SCENERY_FORMS`, `SHOWCASE_EARTH`, `BUILDING_REALISM`,
`CITY_HORIZON` and `TWILIGHT_BALANCE` now default **ON** in Enhanced Satellite.
A plain URL activates them; `?flags=-NAME` disables one for a page load. The
implementation retains Three.js/R3F and existing tier limits, with no paid asset
or new paid service dependency.

Owner-reported moving-window shimmer and horizontal cliff bands were then
reproduced and corrected: filtered facade coverage/relief, eviction-tail skyline
masking, and nonperiodic rock weathering with first-order gradients. The
[surface correction record](FLY_SURFACE_STABILITY.md) includes
GPU regression controls and the rebuilt Manhattan/Yosemite flight captures
(zero runtime/shader errors). The release instruction does not certify the
combined feature set's open High resource-budget gate or physical iPhone/Safari
behavior. Those gaps remain documented in the implementation record.

| Phase | State |
|---|---|
| 0 — Foundations, defects, diagnostics | **Built on `main` (2026-10-06); waiting on your run list** |
| 1 — True proportions | **`TRUE_SCALE` and `TRUE_AREAS` built on `main` (2026-10-06), off by default; waiting on your run list** |
| 2 — Atmosphere, horizon, conditions, shadows | **In progress: `CONDITIONS` built on `main` (2026-10-06), off by default; `PHYS_SKY` built (wired, off by default); `EARTH_HORIZON`, `NIGHT_LIGHTS` and `TERRAIN_SHADOW` not started** |
| 3 — Take off and land anywhere | Not started |
| 4 — Cinematic | Not started |
| 5 — Cities and landmarks | Not started |

### Flags

2026-10-31 atmosphere follow-up: `TWILIGHT_BALANCE` fixes the clipped rusty
sunset, the civil-twilight dark interval and city lights surviving their
terrain's horizon fade. Initially off for review; **enabled by owner instruction
on 2026-11-01**. Use `?flags=-TWILIGHT_BALANCE&diag=1` for the disabled arm.
See [FLY_TWILIGHT_BALANCE.md](FLY_TWILIGHT_BALANCE.md) for the reproduction and A/B.

2026-10-31 building pass: `BUILDING_REALISM` and `CITY_HORIZON` are implemented,
**enabled by owner instruction on 2026-11-01**. Force both on with
`?flags=BUILDING_REALISM,CITY_HORIZON&diag=1`. See
[FLY_BUILDING_REALISM.md](FLY_BUILDING_REALISM.md) for material changes, distance
budgets, verification and the desktop/iPhone run list.

2026-10-30 addition: `OPERATOR_LIVERIES` is built on `main`, **off by default**.
`?flags=OPERATOR_LIVERIES` previews callsign-matched airline and military paint.
See [FLY_OPERATOR_LIVERIES.md](FLY_OPERATOR_LIVERIES.md) for coverage, verification
and the desktop/iPhone run list.

| Flag | Phase | Default | What it changes | Gate |
|---|---|---|---|---|
| `TWILIGHT_FIX` | 0 | off | Sun disc and halo stay on the real sun at sunset; the moon gets its own disc; the key light switches sun→moon at −4° under an intensity dip instead of dragging the "sun" up the sky | `verify-twilight.mjs` 6/6 |
| `SUN_TRUE_AZ` | 0 | off | True solar azimuth (was the hour angle: noon sun always due south, wrong half of the sky in Sydney/Rio); Astronomical Almanac position; sun refreshed every 2 s instead of 60 s | `verify-sun-azimuth.mjs` 5/5 (0.005° vs Meeus) |
| `HDR_GUARD` | 0 | off | Clamps the last HDR write before bloom to [0, 65504], so one NaN pixel can't black out the frame | `verify-hdr-guard.mjs` 4/4 (incl. WebGL2 readback) |
| `LOAD_GUARD` | 0 | off | Provider-empty (ocean) tiles count as ready; vendored three-tile patch R26-1 ends the endless re-update; hard limits 20 s boot / 15 s warp | `verify-load-guard.mjs` 4/4, `verify-vendor-three-tile` 34/34 |
| `PLAYER_SURFACE` | 0 | off | Players see one look: no Visuals/Map-style rows, no review warps, no neon warp confetti; saved Neon/Classic migrates once. Review (`?graphicsReview=1`) and automation keep everything | `verify-player-surface.mjs` 5/5 |
| `DEVICE_TIERS` | 0 | off | Start tier follows the GPU (discrete→high, integrated/unknown→medium, software→low); governor sheds clouds and render scale before dropping shadow cascades (which recompile every lit shader); `ultraStart` (2026-10-16): a desktop whose GPU start reads High starts on the Ultra preset, automation keeps High | `verify-device-tiers.mjs` 6/6 |
| `TRUE_SCALE` | 1 | off | True proportions in Enhanced: mountains, buildings and aircraft stop being squashed by cos(latitude) (×1.31 taller at 40°N, ×1.44 in the Alps, ×2 at 60°N). The camera alone carries the correction; physics, collisions, culling, LOD, picking and HUD numbers are untouched | `verify-true-scale.mjs` 14/14; fixture A/B in SwiftShader |
| `TRUE_AREAS` | 1b | off | Building footprint filters judge the same house the same way at every latitude (normalised to 40°N, where they were tuned): small homes stop vanishing near the equator, big halls stop going flat in the far north. Ohio and New York stay within 2% | `verify-true-areas.cjs` 7/7 (needs `FLY_TILE_FIXTURE=1`), `verify-seam` PASS |
| `CONDITIONS` | 2 | off | A time-of-day slider and weather presets (Clear, Scattered, Overcast, Rain, Snow, Fog) in Pause, the title Settings sheet and the photo bar. Live by default; a pick lasts for the session; a time change glides over 1.5 s. Harness pins and curated Adventures still win | `verify-conditions.mjs` 6/6 |
| `CLOUD_CALM` | fix | off | Steadier clouds and haze when flying low (your report). The haze over terrain and in front of the clouds is measured from a damped ground instead of the raw ground under the aircraft, and the cloud noise moves with the cloud base, so the deck shifts as a whole instead of re-forming | `verify-cloud-calm.mjs` 6/6 |
| `PHYS_SKY` | 2 | off | The Enhanced sky, the haze over terrain and in front of clouds, water reflections and the lighting become one physical atmosphere (Hillaire 2020; Earth's Rayleigh, Mie and ozone). The sun's colour and strength follow the real air it passes through, and the aircraft's underside sees lit ground. The cinematic grade, night sky and weather veil stay on top | `verify-phys-sky.mjs` 12/12 (closed forms; GPU tables and lookups in WebGL2 against the CPU) |

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

### Phase 2 — `PHYS_SKY` (physical atmosphere)

With `?flags=PHYS_SKY`, Enhanced draws its sky from a physical model of the air
(Hillaire 2020: lookup tables for transmittance, multiple scattering, the sky
and the haze along any line of sight, with Earth's measured Rayleigh, Mie and
ozone). One switch moves everything that reads the sky:

- **Sky.** Deep blue overhead, paler toward the horizon, and darker the higher
  you fly. A setting sun turns red and dims because its light really crosses
  more air; nothing is hand-tinted.
- **Haze.** Distant terrain and clouds fade into the same air. The haze thickens
  with distance and thins with altitude. Fog and overcast still add their own
  weather haze on top.
- **Light.** The sun's colour and strength follow the air it passes through:
  warm white at noon, deep orange at about a sixth of the strength at a 2° sun.
  The lower half of the image-based lighting is now lit ground (8× the old
  near-black fill), so aircraft bellies are no longer dark.
- **Kept on top:** a sky-only saturation grade (1.2), the authored night sky as
  a floor, the overcast and fog veil, AgX and the Enhanced grade. The flag also
  brings `TWILIGHT_FIX`'s sun and moon geometry.
- **Not yet (`EARTH_HORIZON`, next):** the world still curves on a 1,000 km
  sphere, so its edge melts into the horizon colour 36–60 km out.

The check renders every table and both lookups in WebGL2 and compares them with
the CPU physics (within 0.7% for the tables; 0.3% for the sky lookup; 5.5% for
the haze lookup away from the sun's glare), and checks the closed forms and the
lighting.

**Run list (with `?flags=PHYS_SKY`, compared with no flag):**
1. **Noon over mountains** (the Sierra adventure, or the Alps): blue overhead,
   pale at the horizon, distant ridges fading blue-grey.
2. **Golden hour** (CONDITIONS picker, or `?sunUtc=`): the sun and its light go
   orange-red as it sets, shadows lengthen, and the sky glows around the sun.
3. **Climb to FL350**: the sky overhead darkens and the haze below thins.
4. **Night**: moon and stars as before, no glow left at the horizon after
   dusk, and distant ground fading into the night sky.
5. **Overcast and fog**: still the grey, flat sky.
6. **Aircraft underside** in daylight (chase view, pitch up): lit by the ground.
7. **iPhone**: the `?diag=1` benchmark with and without the flag.

**What the fixture showed** (SwiftShader, the Sierra scene at 3.9 km, High tier,
each scene booted once with the flag and once without; every look and fps
verdict is still yours):

| Scene | Without the flag | With `PHYS_SKY` |
|---|---|---|
| Noon (sun 77° up) | sun light 5.58 | sun light 6.14, warm white (1.00, 0.94, 0.88). On the same ground tile the ground is as bright as before, distant terrain slightly paler (saturation 0.38 → 0.33), and the sky a deeper blue |
| Golden hour (sun 3° up) | sun light 3.41; a lavender sky and haze | sun light 2.34, deep orange (1.00, 0.49, 0.17). Blue overhead shading to orange at the horizon, orange-lit clouds, the lavender gone. On the same ground tile the ground is at about 55% of its old brightness, because the low sun now crosses real air |
| 11 km, noon | flat blue | darker blue overhead, a pale band at the horizon |
| Night (sun 24° down) | a blue-grey haze veils the ground, even close by | clear air leaves the moonlit ground its colour; distance fades it into the night sky |

No shader failed to compile or link in any run. The only page error was the
container's blocked network ("Failed to fetch"). The fixture's ground is a
synthetic test pattern, and it streamed in at different detail levels from
run to run, so compare the sky, the light and the haze, not the ground's
colour or pattern.

The first night capture found a gap, now closed. The tables scatter only
sunlight, so at night the flag's haze added nothing: the ground stood fully
saturated and cut out against the night sky. Both haze consumers now scatter
the night sky's floor through the same air (`pskyNightAir`, zero by day). On
the same ground tile, the far band's saturation went from 1.00 to 0.78 and the
ground now fades into the sky above it.

**Open questions for your run list:**
- **Noon haze.** Distant terrain at noon is slightly paler than before. If it
  reads as washed out, the next step is a turbidity knob in the grade, not a
  return to the authored haze.
- **Golden-hour ground.** The darker ground at a low sun is physical, but
  darker than the old look. If it reads as too dark, the fix is exposure, not
  a brighter sun.
- **Night ground.** The old haze veiled the ground blue-grey even close by;
  clear air leaves moonlit ground its own colour. If it reads as too bright or
  too colourful, the knob is the moonlight (an authored 0.32), not the haze.
- **Texture units.** With the flag on, the terrain program uses 16 texture
  samplers (15 without): the sky table it reads for water reflections adds one.
  16 is the most WebGL2 guarantees and what Safari offers, so any further
  texture on the terrain material under this flag will fail to compile on the
  iPhone. If that happens, water should reflect the environment map instead of
  reading the sky table.

### Fix — `CLOUD_CALM` (your low-altitude cloud report)

You reported clouds that glitch at lower altitudes, with a texture that keeps
changing. The cloud shaders are byte-identical to the tree before this pass, so
this is older behaviour, not a regression. Two mechanisms in the code fit, and
both are strongest near the ground:

- **The haze stepped.** The haze over the terrain and in front of the clouds
  measured heights from the raw ground under the aircraft. Low over hills that
  reference keeps moving, and when a finer elevation tile loads under you it
  jumps (a fixture boot showed 822 → 1,077 → 1,540 → 1,811 m in four frames).
  At 300 m above the ground, a 300 m jump changes the haze in front of a cloud
  12 km away by 3.8% in one frame. With the flag on, the reference is damped
  (8 s), and the same jump moves the haze by 0.007% that frame.
- **The clouds re-formed in place.** The cloud base follows a regional ground
  height that re-samples every 20 km and then eases for minutes, while the cloud
  noise stayed fixed at absolute altitude. On the real noise volume, a 50–450 m
  base shift re-forms 458 of 588 cloudy samples. With the flag on, the noise
  moves with the base, so the deck shifts as a whole (4,000 of 4,000 samples
  identical after a shift).

The march itself was measured too (a node model of the shader, under climbs,
level flight, turns, terrain-limited rays and flight inside the deck). It is
stable to within 1.0–1.4× the true frame-to-frame change, so its sampling was
left alone.

**Run list (with `?flags=CLOUD_CALM`, compared with no flag):**
1. Fly low (300–800 m above the ground) under broken cloud over hills, for
   example the Sierra adventure. The clouds should hold their shape, and the
   haze should stop pulsing as the ground under you changes.
2. Fly 30–40 km in a straight line over rising terrain. The cloud deck may move
   up or down slowly, but the clouds should not re-form.
3. If anything still glitches, note whether it is a flicker, a shimmer or a
   slow re-forming, whether you were turning, and the Quality tier shown in
   `?diag=1`.

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

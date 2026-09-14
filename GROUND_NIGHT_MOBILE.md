# Ground immersion, night lighting, and mobile controls

Base: GitHub `main`, fetched September 11, 2026,
`f0cd81e5fe79979488a1e9a0cf062923d66a8450`. Branch:
`codex/ground-night-mobile`. The original checkout's uncommitted R25 work is
preserved in the original checkout on `codex/preserve-r25-work`. Before freeing
`main` for a clean integration checkout, all 93 modified/untracked work files,
the index status, and the original base HEAD were verified unchanged.

## Current review candidate

Runtime commit `8d4a823092bdb061111d009b852630dadfce6eb9`, build
`EfX5slWsg8pig7H-3wquA`, runtime SHA-256
`e6c2d9b0b607ea23f9f27947d18e9c504309756fa50194ac2f99bf256819a30d`.
Historical isolated production URL: `http://localhost:3038`. That server is
stopped as of September 14, 2026; this is not a running preview. Identity comes from
[ground-build.json](.graphics-review/ground-build.json); the contact and matrix
reports bind that receipt to the loaded Next document. The final appearance
report matches the static receipt and local source hash on this immutable
server used for those captures, but its harness does not bind the receipt to the document.

The intended result is cinematic Satellite flight at 50–500 ft above terrain,
with ground detail, contact shading and source-coherent night illumination.
Existing sky/weather art direction, flight physics and desktop controls are
retained; daylight composition and surface lighting receive targeted corrections.
No additional depth of field or blur is introduced. Touch gameplay exposes the
joystick and one labeled Actions disclosure, with speed and held Boost inside.
Passive readouts and attribution remain; iPhone/Safari is the target.

## Merge request — September 14, 2026

The user explicitly requested merging this branch into `main` on September 14.
The runtime remains the tested 8d commit and source hash above. This records
authorization to merge with the evidence and open items below; it does not
declare all acceptance checks passed. The texture ceiling and step/pace gates
remain **FAIL**, the mixed day flight remains **BLOCKED**, and Neon plus the
new continuous cloud traversal are **NOT RUN** after the session interruption.
Physical iPhone/Safari and overall visual acceptance also remain open.

## Implementation

- One damped rendered-ground signal controls detail, shadows, FOV and wind cues.
  Landcover, road, water and building masks constrain vegetation.
- Near canopy and ground-detail bases now sample actual rendered terrain instead
  of relying only on the sparse chunk grid. A 600 true-metre cache reserves 256
  points per consumer, accepts tile zoom 16/15/14 by tier, and fades to coarse
  support at the range edge and above 600–700 m AGL. It retires on warp, style
  change or unmount; absolute coordinates survive origin rebases. Each frame
  checks at most 64 slots and makes at most eight queries against a 0.5 ms
  deadline; one indivisible query can exceed that deadline. Smooth Y corrections
  visit at most 32 placed instances per consumer per frame. Consecutive dirty
  indices share upload ranges without overwriting queued placement changes;
  bounds expand, birth fades remain, and ground detail retains its 0.05 m sink.
- Local illumination uses two RGBA8 maps: 1024² / 512² / 256² across quality tiers.
  Source height/color matching prevents light reaching unrelated elevations.
  Updates blend; decoding is bounded; procedural homes and porches contribute.
  Current road emission is `glow: 0.004`, `lampGain: 8`, retaining a 0.036 lamp
  center while reducing the continuous orange ribbon. Pool width and source-map
  behavior are unchanged by this road adjustment.
- Cloud radiance composites in linear color before ACES tone mapping. Indirect
  surface lighting improves shaded-surface contrast; contact AO, material grain,
  cool surface fill and varied windows add local depth.
- Shadow coverage ranks the existing 48 terrain receivers by the view, focuses
  the camera toward visible ground, and uses bent shadow coordinates. Procedural
  homes cast shadows. Canopy commit revisions refresh dependent placement when
  streamed content changes.
- Touch controls include all flight/navigation actions, 44 px targets, safe
  areas, scrolling, Back/Pause, focus restoration and held-input cleanup.
  Support-height healing, source selection and shader prewarming were also fixed.

## Current validation

| Check | Result |
| --- | --- |
| Production build | PASS; served identity above |
| Powell 300 ft actual terrain contact | PASS for measured instances; [report](.graphics-review/ground-contact/report.json) |
| Final 15-view matrix | 15 images captured; harness readiness and draw/triangle checks PASS, texture gate FAIL; coverage limits below; [report](.graphics-review/ground-night-final/report.json) |
| Current-build 120 s boosted flight | PASS: frame p95 12.5 ms, GPU p95 5.2868 ms; [report](.graphics-review/ground-final-validation/flight.json) |
| Current-build 15 min mixed day flight | BLOCKED: one sampled visible failed imagery tile despite passing numerical budgets; [report](.graphics-review/ground-final-validation/day.json) |
| Current-build 15 min night flight | PASS: frame p95 12.5 ms, GPU p95 5.3812 ms; [report](.graphics-review/ground-final-validation/night.json) |
| Current-build cloud rebase/pixel checks | PASS 4/4; [report](.graphics-review/ground-final-validation/clouds/report.json) |
| Current-build weather regression | PASS 13/13; [report](.graphics-review/ground-final-validation/weather/report.json) |
| Current-build flash guard | PASS 9/9 over 29,626 composed frames; [log](.graphics-review/ground-final-validation/flash.log) |
| Current-build resize/step regression | FAIL: gate 11 at deviceScaleFactor 1.5; [log](.graphics-review/ground-final-validation/steps.log) |
| Current-build frame pacing regression | FAIL: seven passed, two failed; [log](.graphics-review/ground-final-validation/pace.log) |
| Current-build Neon GPU regression | NOT RUN; interrupted before execution |
| New continuous cloud traversal GPU profile | NOT RUN; CPU fixtures passed, interrupted before GPU execution |
| Current-build mobile replay | PASS 518/518 in Chromium touch emulation; [report](scripts/ground-night-out/mobile-actions-final-replay/report.json) |
| Current-build receiver appearance proof | PASS: 253/334 classified terrain pixels brighten above off/on/off noise; [report](.graphics-review/ground-final-appearance/report.json) |
| Overall visual acceptance | Pending; pixel response alone does not establish appearance quality |
| Current-build full texture allocation measurement | FAIL: 588.4 MiB peak texture storage against unchanged 300 MiB ceiling |

Images and identities are indexed in [GROUND_NIGHT_CAPTURES.md](GROUND_NIGHT_CAPTURES.md).
`CAPTURED` records image production, not visual or performance acceptance.

Latest Node fixtures pass: daylight **9/9**, parcel **6/6**, canopy **6/6**,
near support **15/15**, shadow **13/13**, lighting **26/26**, ground **20/20**,
receipt **9/9**, budget
**6/6**, census **5/5**, suite **17/17**, allocator **24/24**. These validate code
and instruments; they do not replace the browser gates or unrun measurements. The contact harness also
passed Node verdict controls and an actual Three matrix/rebase fixture.

The current 120 s boosted flight passed at native 1920×1080 with terrain and
governor unpinned: frame p95/p99 12.5/16.7 ms, GPU p95 5.2868 ms, zero browser
long tasks and zero rendering errors. Draw p95 was 217 and triangle p95
1,392,819. It travelled 25.868 km with three rebases, no crashes or teleports,
sampled model speeds 180–339.92 m/s, minimum independently measured ground
speed 198.06 m/s, and sampled actual AGL 33.98–57.69 m. Eight raster requests
failed, but no failed imagery tile was present in the 12 sampled scene states.

The 900 s mixed day flight remains **BLOCKED**: one visible z17 imagery tile
failed in one of 90 samples, with repeated `net::ERR_FAILED` requests for tile
17/49522/35239. The report records 12 failed requests across two tile URLs.
Its numerical checks passed: frame p95/p99 12.5/16.7 ms, GPU p95 5.0983 ms,
draw p95 221 and triangle p95 1,302,659. There were 11 long tasks (p95 59 ms)
and zero rendering errors. Actual travel was 182.026 km, with 25 rebases,
five planned route warps, zero crashes, sampled model speeds 180–339.58 m/s,
minimum measured ground speed 197.82 m/s and sampled actual AGL 33.72–57.69 m.
This fixed-UTC mixed route includes locally different times of day.

Both runs completed high→medium→low→high recovery with building, road and
skyline residency. Their [flight suite](.graphics-review/ground-final-validation/suite-flight.json)
and [day suite](.graphics-review/ground-final-validation/suite-day.json) confirm
the same served 8d build and local-source match; suite preflight binds the
document, while these child reports carry static receipts only. The flight
texture estimate peaked at 163.3 MiB in each run, covering resident terrain
plus ground-light maps only; it cannot overturn the full-allocation failure
below. Day heap changed from 217.2 to 227.7 MiB, with a 104.1–344.3 MiB range;
this alone is not a leak verdict. Per-RAF near-support maxima were seven/eight
queries, 64 checked slots and 512 cached points for short/day respectively;
maximum observed support steps were 5.5/10.6 ms. The 0.5 ms query deadline is
soft, and these measurements do not establish a 0.5 ms frame ceiling.

The current 900 s night flight passed at native 1920×1080, with terrain and
governor unpinned: frame p95/p99 12.5/20.8 ms, GPU p95 5.3812 ms, draw p95 237
and triangle p95 1,471,477. It recorded 13 long tasks (p95 63 ms), a longest
frame of 66.6 ms, zero rendering errors, zero failed raster requests and no
failed imagery in 90 samples. The route travelled 182.187 km with 23 rebases,
no crashes or teleports, sampled model speeds 180–339.69 m/s, minimum measured
ground speed 197.78 m/s, and sampled actual AGL 33.72–57.70 m. Traffic ranged
from 379 to 568 active aircraft.

Night quality recovery completed high→medium→low→high with all required layers
resident and night lighting enabled. Ground-light maps followed 8/2/0.5/8 MiB;
the low-tier recovery snapshot retained 491 sources. During the timed flight,
terrain estimates ranged from 108.7 to 166.3 MiB with 8 MiB of ground-light
maps, giving a 174.3 MiB combined estimate peak. This still omits other renderer
storage. Heap changed from 198.0 to 253.0 MiB (range 176.7–360.0 MiB), programs
held at 110 and geometry counts ranged 412–575; these observations alone do
not establish a leak verdict. Near-support per-RAF maxima were six queries,
64 checked slots, 512 cached points and an 8.5 ms step, again exceeding the
soft query deadline without changing its bounded query count.
The [night suite](.graphics-review/ground-final-validation/suite-night.json)
and child report both bind the loaded document to the current 8d receipt;
the suite also confirms the local-source match.

The final cloud check passed all four gates, including a non-empty cloud and
stable cloud pixels across an actual origin rebase at the same absolute pose.
Weather passed 13/13 across clear, few, overcast, rain, altitude and night
conditions. Flash guard passed 9/9: zero pale or black frames in 29,626 composed
frames, with actual degenerate triangles removed and none remaining in the
sampled live chunk census. These successful checks do not substitute for the
unrun continuous climb-through-clouds profile or Neon GPU regression.

The resize/step regression remains **FAIL**. Its only failed gate was (11),
the zero-errors gate at deviceScaleFactor 1.5, which recorded a failed 404
resource amid network request errors. Both device-scale legs passed the actual
buffer-resize, same-frame drawing, mismatch, pale/black-frame and draw-collapse
checks. Those narrower passes do not convert the failed overall run into
certification or establish that all network behavior is acceptable.

The frame-pacing regression remains **FAIL**, with seven passes and two
failures: four of 16 observed resize/DPR method calls occurred outside RAF,
and program count grew by two. The additional write trace showed every actual
canvas-size write inside RAF and zero drawing-buffer mismatches; it distinguishes
method calls from real reallocations but does not erase the failed gate.
The two-program increase remains unresolved. The new continuous cloud harness
was implemented and CPU-checked, but no GPU traversal ran before interruption;
there is no measured entry/exit, cloud-flight or Neon result to claim.

The current mobile replay passed all 518 checks with zero page errors, covering
the recorded layouts, contextual actions, multi-touch and lifecycle cases.
It uses Chromium touch emulation; target state and hidden-document transitions
include harness fixtures. Physical Safari, OS backgrounding and mobile GPU
performance remain unverified. The earlier [failed current-build run](scripts/ground-night-out/mobile-actions-final/report.json)
is preserved with 355 passing checks and one failed remount check. The replay
used the unchanged application build after a harness-only CDP lifecycle fix;
the prior failure has not been overwritten.

The current contact probe held Powell 40.1990, −83.0811 at heading 339° and
exactly 91.44 m AGL, with live terrain and the governor held at high. It measured
all 46 canopy instances within 300 true metres (1,127 in the whole pool), plus
the nearest 48 of 141 ground-detail instances. All 94 samples had trusted zoom
16–18 terrain; errors after the detail sink correction were below 0.00002 m.
This is agreement with the renderer's raw DEM to floating-point precision, not
surveyed elevation accuracy. Exact cache membership is unavailable, so this
does not certify every instance as refined or cover moving-flight transitions.

Eleven telemetry snapshots over 5.117 s retained 250 cache entries (109 canopy,
141 detail), zero admission saturation, and accepted samples rose from 731 to
1,233. Observed query counts were 0–1, checked slots never exceeded 64, and the
largest observed query step was 0.9 ms. Pending upload ranges were already empty
at every snapshot; they do not establish upload bandwidth or every-frame cost.

The final appearance run passed at Manhattan, Powell and Melton with fixed
poses, the governor held high, stable source signatures and zero camera delta
between receiver-only off/on/off captures. Of 334 classified terrain pixels,
253 brightened above both off captures and their measured noise: building bases
64/96, roads and lamps 157/190, procedural-home surroundings 32/48. This proves
detectable local spill at those samples, not universal source support. One
sampled Powell porch remained 6.846 m below its DEM; the elevation rejection
guard remains active. The 15 sampled Melton porches were within ±0.022 m of
the DEM, which does not establish road or whole-city contact accuracy.

The same run measured high/medium/low lighting-map storage at 8/2/0.5 MiB;
low tier retained 174 sources. Day and warp cleanup passed, and at 3,500 ft
the ground signal was zero with the actual detail mesh hidden and its count
zero. These are lighting-map and lifecycle checks, not total GPU memory or
physical-phone performance certification. The appearance report's static
receipt and local source hash match the current 8d build; its document-binding
limitation is recorded above. It reported no rendering errors.

The current 2560×1440 matrix covers Manhattan, Ohio, Melton, Owens and Paris at
300 ft under the named noon/dusk/night presets. All 15 views passed the harness's
scene sharpness and streamer-queue criteria with zero rendering errors. Draws were 191–232 (Owens 191–195)
and triangles 443,547–1,503,378, within their unchanged ceilings. The overall
matrix verdict remains **FAIL** because of texture storage. These fixed views
hold the governor at high and are not flight or mobile performance measurements.

Canopy meshes were present in all 15 views. Ground detail was absent in all Ohio
and Melton views and Paris noon (seven views), so this matrix does not prove
detail coverage everywhere. The building contact-repair queue still contained
40–7,125 items despite the streamer-queue criterion; contact repairs were not
all settled. Ohio's camera tile remained zoom 15 against target 18 even while
the scene-wide sharpness criterion passed. The Paris image named dusk had solar
elevation −9.096°, in the night bucket; actual Paris dusk coverage remains
pending. The retained image is still useful for its matched historical preset.
One matrix census observed a 2.8 ms near-support step containing one query,
confirming that the 0.5 ms deadline is not a hard per-frame maximum.

## Historical evidence — not current-renderer certification

The preceding daylight/canopy candidate was `a73770d09f23541f461e5512aaf12c5380864cea`,
build `AmIT0nMT9DMV3D52YvWbq`, SHA-256
`dde4c9b3ad2750b50c714e444cc5fe6fbbd4f9bc1a2069b14a9261f8bec7ebe8`.
Its Powell 1,378/300 ft pair preceded the exact near-terrain support cache;
those images are retained as historical evidence.

The earlier UI/shader baseline was `835234c0f70877a200b75d4588a9a8cb33b297f4`,
build `90DqHFGYo48EdO_zLGbv6`, SHA-256
`dde8f1ddcc0b51b5041bfbe029c3eae294cb2ba4f7b04debf4d22984c8af9af9`.
Its rendering results precede the daylight and canopy corrections.

| Earlier measurement | Recorded result |
| --- | --- |
| 120 s boosted low flight, native 1080p | PASS: frame p95 16.6 ms, GPU p95 6.46 ms; zero long tasks/rendering errors |
| Clean-main identical flight configuration | PASS: frame p95 16.7 ms, GPU p95 6.89 ms |
| 15 min mixed day flight, five warps | BLOCKED: one failed visible imagery tile in 90 samples; frame p95 12.6 ms, GPU p95 6.26 ms |
| 15 min night flight | PASS: frame p95 16.7 ms, GPU p95 6.75 ms; draw p95 238, triangle p95 1.46M; tier recovery passed |
| Cloud pixel/rebase and weather | Earlier cloud gate PASS; weather 13/13 |
| Flash guard | Earlier 9/9; no pale/black frames in 22,300 composed frames |
| Touch controls | Earlier build `e-blfps0P5FwU1vaajBKK`: 364/364 in Chrome touch emulation |
| Daylight receiver proof | `6041c22`, before canopy revision: PASS at three locations plus extra checks; [report](.graphics-review/ground-daylight-appearance/report.json) |

Hardware was RTX 5080, i9-14900KF, Chrome 153. Moving flights left terrain and
governor unpinned and recorded actual path, AGL, speed, tier and DPR. Each long
flight covered roughly 182 km. The mixed route's fixed UTC time makes Melton
locally night. Live traffic/streaming differ between runs; no deterministic
speedup is claimed.

The corrected clean-main resize control still **FAILS**, with pale-row and
endpoint-race observations. A separate forced-resize probe passed **20/20**.
Neither outcome establishes cloud composition as the cause of the resize failure.
Three historical suite receipts compared different hash algorithms; their false
local-source mismatch is documented, and original records remain unchanged.
Corrected receipt/verdict fixtures cover stale or missing evidence.

## Open acceptance items

**The 300 MiB texture ceiling remains FAIL on the current build.** The current
15-view audit measured 469.4–561.4 MiB of live texture storage and a 588.4 MiB
run peak. Texture plus renderbuffer storage ranged from 496.9 to 618.9 MiB,
with a 645.9 MiB combined run peak; the frozen gate specifically tests texture
storage. The historical 1440p Manhattan allocation audit measured 499.1 MiB on
clean main and 506.4 MiB on the first
candidate. Both had exactly 310,738,784 bytes of RGBA16F across 39 images; the
new high-tier light maps use 8 MiB. The former terrain-only estimate omitted
renderer storage. No limit was relaxed, and the different routes/retained
resources mean the historical and current totals are not a controlled delta.
WebGL allocations are observable; driver overhead and browser swapchain memory
are outside this accounting.

Road ribbons can differ from fine terrain on slopes. Lighting follows their
actual support and preserves elevation rejection. Physical iPhone/Safari,
device safe areas, OS background/resume and mobile GPU behavior remain unverified.
Targeted lint passed; full repository lint was not certified. Earlier integration
lint retained 29 baseline diagnostics.

Provider research found reported 7.62 cm Esri source imagery at Powell but
45.6 cm nominal zoom-18 sampling. Alternate providers remain untested there;
see [GROUND_IMAGERY_OPTIONS.md](GROUND_IMAGERY_OPTIONS.md).

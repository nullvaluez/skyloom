# Immersive Satellite — validation record

The playable preview was pushed to GitHub main as `3c52ee3`. On 2026-09-10 the
user requested immersive visuals always load. The renderer now requires no
`graphics` query parameter; legacy/cinematic URLs and old preview overrides
cannot disable the immersive treatment or its base Satellite renderer.

The results below retain their original preview-build scope. The default rollout
changes activation only, with its own build and fresh-boot checks. Older harnesses
that compare graphics modes or disable preview features must use versioned builds;
those switches no longer change the treatment on this tree.

## Always-on rollout checks

Production build `617efPac3JC2oRqNRipv5` passes, as do the immersive/graphics unit
checks and targeted lint. Renderer source SHA-256:
`72d39599d193e23cf0c6a1b1ac39e3c83f89ef073b743e06a5b5e6ff75ee7eea`.

Fresh production boots pass all five cases: no graphics parameter, legacy URL,
cinematic URL, explicit immersive URL and Neon. Each Satellite case verifies the
architecture materials, active volumetric cloud pass and shadows against actual
rendered scene state. There are zero page/shader errors. The existing Neon map
style boundary remains intact. Evidence: `.graphics-review/immersive-default/`.
No lighting, material, cloud or performance-budget values changed in this rollout.

The earlier integrated preview build and its completed functional checks passed. Both complete
15-minute flights held native 2560×1440 and met the frame-time and scene budgets,
but each had a brief imagery interruption and retains its **BLOCKED** verdict.
These results support a playable review, not full visual certification.

## Main integration and publication

The playable slice is integrated on top of GitHub main `7c9cde0`, including its
nearby building-contact scheduling fix. Terrain residency/crossfades, worker
contracts, building fade uniforms, frame pacing and the current atmosphere law
are retained. Immersive haze scales the shared atmosphere feed and keeps its
night ramp; it runs before cloud composition at every quality tier. Hillshade
follows the final sun/moon key direction.

Main already contains the same PMREM-size repair under `ENV_UNIFORM`. Integration
uses that implementation, including its unchanged 2K daytime endpoint, and keeps
immersive backgrounds on the original HDR. The cold-arrival comparison above
diagnoses the older isolated lineage, not the pre-integration GitHub main.
`ENV_UNIFORM.enabled` remains false for the ordinary appearance; immersive lighting
arms normalization for its own environment. `AERIAL_LAW.enabled` also remains false:
the tested immersive appearance uses the existing post haze with main's night ramp.
The shared-law integration is retained for that optional future mode.

Production build `Nr6OTYCZ59tpAGs6oJllo`, targeted renderer lint, immersive/graphics
units, all 14 terrain lifecycle checks and all eight nearby-contact scheduling
checks pass on the integrated source. Browser and long-flight results on this
tree are recorded separately under `.graphics-review/immersive-main/`.
The integrated GPU smoke passes all 12 checks: audio gesture/pause, reduced motion,
review routes, cloud entry, high/medium/low continuity and Satellite/Neon switching,
with zero page or shader errors. Renderer source SHA-256:
`fea3ee9a6385b62757e378c843628308db1def0a3f5bd143afc7ade689ff475e`.

The user requested pushing this playable version while tests continue. Access it
with `?graphics=immersive`; ordinary cinematic remains the default.

The compact checked-in receipt is
[scripts/immersive-main-validation.json](scripts/immersive-main-validation.json).
It preserves each verdict, the renderer/build identity, key measurements and hashes
of the full local evidence. Harness and documentation edits during these runs are
why some raw receipts say `workingTree: modified`; the renderer hash stayed fixed.

The integrated quality ladder passes all nine stages, retains scenery, and returns
to 104 shader programs and native resolution after the full down/up cycle. The
current atmosphere source checks pass 53/53, governor checks 14/14, and resident
imagery retry checks 20/20. These CPU results do not certify rendered pixels.

Fresh boots pass in all three comparison modes: ordinary cinematic, legacy and
Neon. Weather integration passes 13 checks across clear/few/overcast/rain,
cloud-band and above-cloud views, and true nighttime. Interaction passes 11 checks
across four aircraft, pause/audio/advection, and native-resolution photo export.
Its strengthened composition check verifies exactly one aerial-perspective effect
before the cloud pass, with AO present. Weather had already started with the older
predicate; the subsequent interaction run exercised the strengthened predicate.

The GPU origin-shift comparison passes all four gates. At the same absolute pose,
a non-empty cloud (minimum transmittance 0.011856) changed by at most 0.000244 and
a mean of 0.0000000913 in linear half-float pixels. This measures the rendered
cloud through an actual origin change, not only the CPU density formula.

**Integrated dense-overcast flight, 120 seconds: PASS.** Native 2560×1440 held;
raw p95/p99 were 8.3/8.4 ms, maximum 33.3 ms and GPU p95 4.125 ms. There were zero
browser long tasks, page/shader errors, or failed-imagery samples. Draw p95 was 186
and triangle p95 1.404 M. Actual altitude ranged 1,782.6–2,019.7 m; measured ground
speed stayed at least 179.47 m/s through three origin shifts. Live traffic ranged
408–563. All four subsequent quality changes retained the required scenery.

Geography passes **57/57** at native 1440p: seven visits covering Manhattan, Ohio,
Melton, Paris, Owens and returns, supplied wall heights, camera clearance, nearby
building contact, collision columns and origin alignment. Its 65-second low pass
covered 11.30 km with zero missing-imagery or absent-building frames across 10,363
samples. Natural rebase continuity, pointer picking and target inspection passed.

**Integrated urban flight, 900 seconds: BLOCKED by one transient imagery failure.**
Native 2560×1440 held throughout. Raw frame p95 was 12.5 ms, p99 16.7 ms,
GPU p95 5.089 ms; the worst frame interval was 50.1 ms and one 51 ms long task
was recorded. Draw p95 was 223 and triangle p95 1.350 M, within the unchanged
limits. Live traffic ranged from 390 to 479 aircraft. All four subsequent quality
changes retained the required scenery, with zero page/shader errors.

At the 40-second sample one z16 imagery tile was marked unavailable; the next
sample at 50 seconds was clear, as were all later samples. The failed network
requests and original BLOCKED verdict are retained in `soak-urban.json`. An earlier
setup attempt (`soak-urban-server-network-blocked.json`) measured no flight because
the local server lacked network access. Restarting that server with network access
restored the live feed; no app source changed for that correction.

Main intentionally stopped publishing origin changes through the old store counter.
The raw urban receipt therefore reports zero through that obsolete instrument.
`urban-motion-supplement.json` preserves the distinction: absolute position samples
show at least 21 anchor changes and a minimum measured ground speed of 179.41 m/s.
The next run reads `runtime.origin.epoch` and also checks actual horizontal travel
against the existing 50 m/s movement floor. Five successive three-minute heap floors
were 169 / 167 / 159 / 181 / 166 MiB, with no sustained climb in this bounded run.

**Integrated mixed-region flight, 900 seconds: BLOCKED by one transient imagery
failure.** All five arrivals (Ohio, Melton, Paris, Owens and Manhattan) held native
2560×1440. Raw p95/p99 were 8.4/12.6 ms and GPU p95 was 4.445 ms. The maximum
arrival interval was 45.7 ms and steady-flight maximum was 45.9 ms, with zero
browser long tasks and zero page/shader errors. This is a whole-route measurement,
without the profiling overhead in the earlier cold-arrival comparison.

The Paris leg sampled one failed z15 imagery tile at 530 seconds, clear again at
540 seconds. Draw p95 was 207 and triangle p95 1.355 M, within unchanged limits;
all four subsequent quality changes retained buildings, roads and skyline. Runtime
origin telemetry recorded 23 shifts, and actual ground travel stayed at least
179.48 m/s. Live traffic ranged from 26 to 617 aircraft. Shader programs ranged
103–105 and settled at 104 after the night arrival. Maximum estimated resident
terrain textures were 151.33 MiB; this is not total renderer memory. Per-region
heap floors were 179 / 91 / 94 / 163 / 79 / 157 MiB.

Both complete integrated soaks satisfy the measured native-resolution, frame-time,
draw and triangle targets. Their original BLOCKED outcomes are retained because
each contained an imagery interruption; they are not represented as clean passes.
The final cumulative governor counters report zero DPR and detail-tier steps in
both soaks and the overcast flight, supporting the native-resolution observations
between the 10-second telemetry samples as well.

## Water review finding

A thin dark seam across the Hudson is visible in both immersive and ordinary
cinematic captures at the same aircraft pose. In both treatments, hiding the
satellite water material removes the seam; disabling only its depth test leaves
the seam visible. The water material and streaming engine are byte-unchanged from
pre-integration main `7c9cde0`. This attributes the observed seam to the existing
water-overlay path, without claiming its exact geometry/shader cause is solved.

Evidence is in `water-diagnostic/` and `water-diagnostic-cinematic/`. These are
fixed-pose diagnostics with different chase framing between treatments, not a
pixel-identical comparison or an AGL/HUD correctness check. Depth-test-off is only
an attribution control: it incorrectly paints water over foreground objects and
is not a candidate fix. No water-rendering change was shipped for this finding.

## Legacy regression coverage

`FLY_SHIPPED=1` lets the immersive flash and resize diagnostics release the old terrain,
clutter, depth, aerial and shadow pins explicitly. Their frozen assertions and
ordinary fleet defaults are unchanged. Each prints the effective controls so a
result cannot silently stand in for the current rendering stack. The flash census
can also use the existing production `graphicsReview=1` runtime handle. Main's
newer `verify-flash-guard.js` and `verify-step-clean.js` remain unchanged. The
earlier measured diagnostics are preserved as `immersive-flash-regression.cjs`
and `immersive-step-regression.cjs`; the immersive suite selects those names.

The pacing adapter releases the inherited terrain, governor, settle, clutter,
depth, aerial and shadow overrides and prints both attempted and effective values.
It uses the production composer's real renderer for the old `__flyGl` handle,
which FlyCanvas itself exposes only in development. A first strict run printed
9/9 PASS but its buffer gate measured **0 of 0 frames**; that result is retained
in `pace.log` and adjudicated incomplete. The adapter now requires observed frames
before and after measurement. Two deliberate governor inputs, down at 15 seconds
and up at 45 seconds, request real ladder changes; the live governor may recover
before the second request. The original assertions stay fixed.

The corrected strict run is **8/9, retained as FAIL** (`pace-corrected/pace.log`).
It observes 21,406 buffer comparisons with zero mismatches and 16 resize-method
calls or canvas writes. Four method calls occur outside rAF, so the unchanged gate
fails. At 1280×720 the whole run's worst interval
was 38.6 ms, with one stall, zero long tasks and zero net program growth. The
FrameStats rolling p99 was 12.5 ms; it is not a whole-run percentile.

A separate 60-second attribution run (`pace-attribution/pace.log`) retains the
same 8/9 FAIL and explains it: all four outside-rAF calls increment the existing
guard's suppression counters and perform **zero canvas writes**. All four actual
canvas writes occur inside rAF; 13,844 buffer comparisons find zero mismatches.
This is the inherited method-entry census counting calls outside the guard,
not evidence of an outside-frame allocation. The trace observes automatic recovery
before the requested upstep, so it does not credit both resizes to forced inputs.
No runtime code or original assertion was changed to obtain this attribution.

## Reproduce

With the integrated production preview running on port 3022:

```powershell
node scripts/immersive-cert-suite.cjs --url=http://localhost:3022 --output=.graphics-review/immersive-main-rerun
node scripts/immersive-cert-suite.cjs --url=http://localhost:3022 --checks=defaults,rebase,clouds,geography,pace --output=.graphics-review/immersive-main-rerun
node scripts/immersive-cert-suite.cjs --url=http://localhost:3022 --checks=flash,steps --output=.graphics-review/immersive-main-rerun
```

The suite runs GPU jobs sequentially. `--checks=weather,quality` selects a subset.
Do not run other GPU captures during either soak. Every job writes its own result;
the suite stops after a failed or blocked job, preserving that result.

`graphics-arrival-profile.cjs` records a CPU profile and slow WebGL calls for a
cold Manhattan-to-Melton arrival. Its sampling overhead makes it an attribution
tool, not a frame-time certification.

The asset provenance, first-slice design choices and remaining visual limitations
are documented in [IMMERSIVE_SLICE.md](IMMERSIVE_SLICE.md).

## Earlier isolated-branch evidence

These results precede integration with main and do not certify the published
renderer. They are retained to preserve the original measurements and failures.

### Corrections

The volume originally read only overcast strength. Clear, few-cloud and baseline
weather therefore all produced the same cloud coverage. It now reads the weather
model's already damped `presenceFrac`, so cloud gaps change gradually with reports.
The new regression fails on the original code and passes with this correction.
Wind drift now converts true metres per second to the projected coordinates used
by the density field, accounting for latitude.

The long runs also exposed a cold-arrival shader stall. The day HDR is 2K; the
night/dawn/dusk HDRs and previous blend target are 1K. Three's PMREM generator
disposes its convolution programs when that size changes, and the resulting
`envMapCubeUVHeight` changes the program key of every lit material. A matched
cinematic control reproduced the stall, establishing that it predates the clouds.

Immersive lighting now passes every environment through the existing linear
compositor at 2K. The visible endpoint background still uses the original HDR.
The scratch target is 16 MiB at half-float RGBA; the PMREM output and ping-pong
targets now remain at their existing daytime dimensions for all times of day.
This intentionally spends more reflection memory at night to keep one shader
layout, with no extra recurring draw in the game's scene. Ordinary cinematic
and Neon retain their existing environment path.

The flight harness now updates its altitude target after each mixed-route warp,
records actual speed and rebases, proves rendering pins are absent, and reports
arrival frame times separately. Its raw timing includes every arrival frame and
its existing draw/triangle limits remain unchanged. Every frame in the first
30 seconds after a warp is labelled arrival time; this is an explicit reporting
window, not a claim that arrival necessarily took 30 seconds.

### Builds and completed checks

The earlier isolated production build, including the environment correction, is
`VFKjDOxf4gjDohPYkCL3k`, renderer source hash
`8840c376fcd86b9fed95dc1924e64eeaf8eca05951faa8c1c988782891d66fee`.
Receipt: `.graphics-review/immersive-cert/build-source-stable-environment.json`.
Build, targeted lint and immersive unit checks passed. Results for that build in
`stable-environment/`:

- Weather integration: 13 checks pass, including true nighttime.
- Quality ladder: all nine stages pass; cloud integration and shadow targets
  follow 96/64/32 steps and 2048/1024/512 pixels. Programs return to 103.
- GPU cloud rebase comparison: all four checks pass.
- Dense-overcast flight, 120 seconds at native 2560×1440: PASS. Raw frame p95
  8.3 ms, p99 8.4 ms, maximum 20.9 ms; GPU p95 3.684 ms; zero long tasks and
  zero page/shader errors. Draw p95 249 and triangle p95 1.373 M. Actual altitude
  1,782.6–2,019.7 m and inside-cloud density 0.12–1.0 establish real cloud entry.
  The four following quality changes retained all required scenery layers.
- Geography: PASS across Manhattan, Ohio, Melton, Paris, Owens and return visits,
  followed by a 65-second moving low pass and live aircraft selection.
- Flash regression: **8/9 gates, retained as FAIL**. The 240-second run composed
  42,530 frames, found zero remaining zero-area building triangles, and reported
  zero black frames or page/shader errors. Its unchanged brightness gate flagged
  860 frames. A 120-second diagnostic repeat captured flagged pixels inside the
  actual composed frame: the images show intact bright farmland and clouds,
  rather than a uniform replacement frame. Flags form sustained runs, including
  105, 80, 45 and 269 consecutive frames. The old luma-200/50%-of-scanline rule
  is not specific to flashing under this lighting. No threshold was moved and
  this result is not reported as a complete flash pass. The diagnostic also
  found zero zero-area triangles and zero black/error frames over 20,025 frames.
  Images, raw flag indices and census results are in `flash-diagnostic/`.
- Resize regression: **22/24 gates, retained as FAIL** across device scale factors
  1 and 1.5. All 40 forced changes resized and composed within the same animation
  frame; there were no out-of-frame reallocations, buffer mismatches, black frames,
  draw collapses or page errors. Both 180-second live legs tripped the unchanged
  brightness rule on ordinary scenery, with no resize within 200 ms of the flagged
  samples. The successful resize mechanics do not turn the full gate green.

These receipts were measured on the isolated overhaul lineage. The user's later
request to push the playable slice requires integration with GitHub main's existing
residency, atmosphere, pacing and nearby contact repairs. Integrated-build evidence
is recorded above; the earlier receipts do not certify that merged tree.

Matched 35-second cold-arrival profiles (profiling overhead present):

| Treatment | Worst frame interval | Frames over 50 ms | Slow GL calls over 2 ms |
| --- | ---: | ---: | ---: |
| Immersive before correction | 812.5 ms | 5 | Diagnostic omitted `getProgramInfoLog`; CPU sampling found it |
| Existing cinematic control | 841.6 ms | 5 | 15, including a 280.4 ms PMREM compile wait |
| Corrected immersive | 41.6 ms | 0 | 0 |

The corrected run held DPR 1 and 103 programs through the observed night arrival.
The old immersive run reached 115 programs; the long mixed run established its
102 → 115 transition. This is attribution evidence for this cold route, not a
claim that all loading stalls are eliminated. The raw profiles and CPU samples
are in `arrival-immersive/`, `arrival-cinematic/`, and `arrival-stable-environment/`.

The earlier checks below used production build `YIr5zniIfR9AvwTKWTEwo`, source hash
`311f4a9834679965a48c5919f8b8782876e44ed45df5a14bbbb51460386b697e`.
Receipt: `.graphics-review/immersive-cert/build-source.json`.

- Production webpack build and targeted renderer lint pass.
- Immersive and graphics unit checks pass, along with the seven terrain lifecycle
  checks and the R24 motion checks. No existing assertion ceilings were relaxed.
- Weather integration: **13 checks pass**, including clear, few, overcast, rain,
  low visibility, cloud-band flight, above-cloud views and a true night state.
  These hold the pose for visual evidence; they are not performance measurements.
- Interaction: **11 checks pass**, including four aircraft, audio/pause behavior,
  frozen cloud advection while paused, photo mode and native 1440p PNG export.
  Windows Chrome's native share path is disabled only in this test so it exercises
  the desktop download path without opening a share sheet.
- The real quality ladder passes all nine sampled states. Clouds keep the same
  pass instance; shadows and scenery remain present; drawing buffers match the
  active resolution. It returns to DPR 1/high and the original 102 shader programs.
- Actual GPU cloud pixels pass the floating-origin check: a 3,000-unit origin
  shift at the same absolute camera/aircraft pose changed linear half-float pixels
  by at most 0.000244 and a mean of 0.00000915. The sampled volume was non-empty
  (minimum transmittance 0.012); this is not a comparison of two empty skies.

The first combined integration run is preserved in
`.graphics-review/immersive-cert/regression/report-first-run.json`. Its fixed
weather waits sampled two unfinished transitions; its night wait did not cover the
existing 60-second solar refresh; and the native share sheet prevented a headless
download. The corrected checks wait on actual state and use the explicit download
path. These were instrument failures, not shader or page errors.

### Earlier long flights

The first urban soak was interrupted before completion to correct cloud/weather
behavior. Its receipt is `soak-urban-pre-weather.json` in the certification folder.
It is not a completed soak or a pass.

The corrected runs are recorded separately under `.graphics-review/immersive-cert`.
A run that changes render resolution or loses terrain imagery is not a clean
native-1440p certification, even if its frame-time percentiles meet the target.

**Urban, 900 seconds: BLOCKED, with the native-resolution requirement also missed.**
The raw p95 interval was 8.4 ms, p99 12.5 ms, GPU p95 3.424 ms. Draw p95 was 291
and triangle p95 1.615 M, both within the unchanged budgets. The actual aircraft
speed was at least 180 m/s and the origin shifted 20 times. Live traffic ranged
from 416 to 751 aircraft. Zero page/shader errors occurred, and all four subsequent
quality changes retained buildings, roads, skyline and night lighting.

Two adjacent 10-second samples reported DPR 0.875, followed by recovery to DPR 1.
One of those samples contained one failed imagery tile; later samples recovered.
Twenty failed requests were recorded for the same Esri tile. A later HEAD request
returned HTTP 200, but that does not establish the cause of the earlier failures.
The run is retained as `soak-urban.json`; it must not be described as a clean pass.

The five successive three-minute heap floors were 155 / 151 / 162 / 150 / 158 MiB.
Shader programs settled at 102 after the early resolution changes. Those bounded
observations show no sustained growth in this run; they are not an indefinite
memory-leak guarantee. Maximum estimated resident terrain textures were 72.3 MiB.

**Mixed terrain, 900 seconds: BLOCKED, with the native-resolution requirement also
missed.** Five arrivals covered Ohio, Melton, Paris, Owens and Manhattan. Raw p95
was 8.4 ms, p99 8.5 ms and GPU p95 4.121 ms. Draw p95 was 283 and triangle p95
1.490 M. Actual speed remained at least 180 m/s through 23 origin shifts, with
10–675 live aircraft and zero page/shader errors.

The Australia arrival produced one DPR-0.875 sample at 310 seconds and recovered
by the next sample. One failed imagery tile was sampled later in that same leg,
at 420 seconds. No detail-tier steps or session latch occurred. The maximum frame
interval was 783.4 ms during an arrival; the steady-flight maximum was 37.6 ms.
Arrival p95/p99 were 8.4/12.4 ms versus steady p95/p99 8.4/8.5 ms. Six browser
long tasks were recorded. These stalls remain a real immersion concern despite
the otherwise fast percentiles; a separate cold-arrival profile investigates them.

Programs increased from 102 to 115 after the first night destination and then
stayed at 115 through the remaining three arrivals. Heap floors varied with city
content (70–168 MiB per route leg); the final Manhattan floor was 161 MiB versus
151 MiB initially. Maximum estimated resident terrain textures were 80.3 MiB.

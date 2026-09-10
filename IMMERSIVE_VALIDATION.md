# Immersive Satellite — continuation validation

The continuation expands the first playable slice's validation. The preview is
available at `http://localhost:3020/?graphics=immersive`; the previous appearance
is available with `?graphics=cinematic`.

## Corrections

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

## Build and completed checks

The current production build, including the environment correction, is
`VFKjDOxf4gjDohPYkCL3k`, renderer source hash
`8840c376fcd86b9fed95dc1924e64eeaf8eca05951faa8c1c988782891d66fee`.
Receipt: `.graphics-review/immersive-cert/build-source-stable-environment.json`.
Build, targeted lint and immersive unit checks pass. Current-build results in
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
will be recorded separately; the earlier receipts do not certify that merged tree.

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

## Long flights

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

## Legacy regression coverage

`FLY_SHIPPED=1` now lets the flash and resize harnesses release the old terrain,
clutter, depth, aerial and shadow pins explicitly. Their frozen assertions and
ordinary fleet defaults are unchanged. Each prints the effective controls so a
result cannot silently stand in for the current rendering stack. The flash census
can also use the existing production `graphicsReview=1` runtime handle.

## Reproduce

With the isolated production preview running on port 3020:

```powershell
node scripts/immersive-cert-suite.cjs
node scripts/immersive-rebase.cjs
node scripts/immersive-cert-suite.cjs --checks=clouds,geography,flash,steps
```

The suite runs GPU jobs sequentially. `--checks=weather,quality` selects a subset.
Do not run other GPU captures during either soak. Every job writes its own result;
the suite stops after a failed or blocked job, preserving that result.

`graphics-arrival-profile.cjs` records a CPU profile and slow WebGL calls for a
cold Manhattan-to-Melton arrival. Its sampling overhead makes it an attribution
tool, not a frame-time certification.

The asset provenance, first-slice design choices and remaining visual limitations
are documented in [IMMERSIVE_SLICE.md](IMMERSIVE_SLICE.md).

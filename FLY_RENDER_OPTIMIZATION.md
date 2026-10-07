# Render optimization and satellite atmosphere — 2026-10-04

This pass separates scenery detail from the cost of atmospheric effects on
mobile, removes redundant render/streaming work, and improves Enhanced daylight
contrast. The release contains this optimization pass; existing local adventure
work is preserved separately.

## Behavior

- Fresh capable phones and tablets start at **High** scenery. Devices reporting
  at most 2 GB RAM or two CPU threads start at Medium. Saved explicit quality
  choices remain authoritative. Missing browser hints do not mean weak hardware.
- Mobile presentation targets **60 fps** in Classic and Enhanced. Enhanced's old
  forced 30 fps loop is removed; fractional frame deadlines survive 90/120/144 Hz
  displays and background-tab gaps. This is a target, not a physical-device guarantee.
  The governor honors that cap in Neon too, including after a faster refresh
  estimate during boot.
- Touch tablets now receive mobile effects, shadow, material, and environment
  budgets without adopting the phone HUD. Mouse laptops keep desktop budgets.
- Every adaptive effects step now reduces real work. High world detail survives
  the first reductions in cloud sampling; there are no repeated identical
  effects profiles consuming whole cooldowns. Explicit preset/style changes
  reset the appropriate render policy.
- Mobile atmospheric reductions now retain one shadow cascade and the same
  256-pixel material variant. The final atmospheric step uses a 512-pixel depth
  map instead of removing shadows and changing every lit shader. Explicit Low
  and render scales below 0.8 keep their stronger fallback.
- Mobile Classic also uses mobile cloud sampling and avoids allocating the
  desktop ambient-occlusion targets. Enhanced already separates its mobile
  effects from world geometry; that separation now supports the higher default.

## Work removed without removing scene content

- A 4 KiB periodic cloud lookup replaces 27 modular hashes per density sample,
  including the lighting samples and cloud-shadow lookup. Bank positions,
  volume data, cloud coverage, and weather remain the same.
- Enhanced skips the sky-dome draw and legacy sky calculations that its
  fullscreen composite immediately overwrote. Classic restores dome ownership.
- Cascaded shadows retain their depth texture, resolution, and filtering while
  replacing unused RGBA color attachments with R8: 5 rather than 8 bytes per
  texel for color plus 32-bit depth, a 37.5% attachment-storage reduction.
- Scene material registration avoids allocating a temporary array per mesh on
  every frame. Device/motion preferences reuse live media queries and stop
  polling local storage each frame.
- The recursive geometry/texture inventory now runs only in graphics review,
  rather than allocating thousands of diagnostic entries every two seconds in
  ordinary flight.
- Concurrent requests for the same imagery/DEM URL share transport and body
  acquisition. Every worker still receives its own transferable buffer. Pending
  entries release on both success and failure; existing cache/retry policy stays.
- The transition check reproduced an outgoing Enhanced shadow rig compiling
  Classic terrain with too many samplers during a Neon switch. The rig now
  retires its lights before that next draw. Reflection also waits for shadow
  storage to be ready after a target reallocation.

## Visual treatment

Enhanced now has less diffuse daylight fill, clearer clear-weather air, a deeper
blue horizon, more separation between cloud highlights and undersides, and
slightly stronger midtone color/contrast. Full overcast optical depth and the
night lighting endpoints are retained. These changes use the existing lighting
and grading passes; they add no geometry or fullscreen passes.

## Evidence and limits

Tests use production builds, live imagery/geography, Chrome, and this machine's
NVIDIA RTX 5080 through ANGLE/D3D11. Phone/tablet viewports emulate touch and DPR
on **that desktop GPU**. They do not measure an iPhone, Android GPU, Safari,
thermal throttling, battery consumption, or long-session phone memory pressure.
Server-side live traffic/weather requests also reported provider failures during
these runs. Weather was pinned for comparisons; live-traffic load is not certified.

Initial before/after comparison, two 10-second flight legs after the same settling
window:

| Case | Before | First optimized build |
| --- | --- | --- |
| Desktop Enhanced, High | p50 12.5 ms; p95 16.7–16.8 ms | p50 12.4–12.5 ms; p95 16.6–16.7 ms |
| Phone layout, Enhanced | Medium; p50 33.3 ms; p95 33.5 ms | High; p50 16.7 ms; p95 16.8 ms |
| Phone layout, Classic | Medium; uncapped presentation | High; 60 fps presentation target |

The phone-layout improvement above primarily proves removal of the 30 fps
presentation cap. Streaming and adaptive effects differ between runs; these
are not matched-cost GPU microbenchmarks or evidence of a universal desktop
speedup. The graphics-review inventory remains enabled in both measurement arms.

Later runs before the final mobile fallback refinement were less consistent and must not be hidden by
the initial comparison:

| Final review run | p50, straight / turn | p95, straight / turn | World tier |
| --- | --- | --- | --- |
| Desktop Enhanced | 12.5 / 16.6 ms | 20.8 / 24.9 ms | High |
| Phone Classic | 16.7 / 16.7 ms | 20.9 / 20.8 ms | High |
| Phone Enhanced | 16.7 / 16.7 ms | 25.1 / 20.8 ms | High |
| Tablet Enhanced | 16.7 / 16.7 ms | 21.1 / 20.8 ms | High |

The latter mobile runs reached the old lowest effects profile while retaining High
scenery. This prompted the final mobile fallback refinement above. High scenery
is supported by the policy, but maximum effects plus
steady 60 fps are **not** demonstrated on every run. Removing the diagnostic
inventory did not eliminate the variability. A subsequent CPU-profiled phone
run retained one cascade and the phone-balanced profile, with p95 16.8 ms in
both legs. It did not reproduce the more severe stalls. This is not evidence
that every remaining hitch has been eliminated. Those earlier runs describe the
pre-refinement build; final validation is recorded separately under `final-mobile/`.

Early timing samples omit the delay before the first sampled frame. Their
frame counts therefore matter alongside medians. The instrument also formerly
used rAF batch timestamps, which can predate a long render in that same batch.
The final benchmark uses the actual callback clock, includes the initial delay,
records elapsed time and any unfinished tail, and reports whole-window rendered
FPS plus mean/maximum intervals. `complete-window/` is retained as an intermediate
instrument run, not the final timing authority. In `ordinary-flight/`, draw/triangle counts
are cumulative after review is disabled and must not be interpreted as per-frame
counts; the updated instrument leaves those fields null. Benchmark PASS means
no runtime/GL errors, not passing an FPS threshold.

Final whole-window measurements (`final-mobile/`, no review inventory, High
scenery throughout, actual callback timestamps):

| Layout | Rendered fps, straight / turn | p95 | Longest interval | Effects retained |
| --- | --- | --- | --- | --- |
| Phone | 55.4 / 58.3 | 27.3 / 24.2 ms | 131.4 / 84.0 ms | One 512 shadow cascade, 256 materials |
| Tablet | 56.6 / 58.3 | 24.6 / 23.9 ms | 98.5 / 59.8 ms | One 1024 shadow cascade, 256 materials |

Each leg spans approximately ten seconds. Neither leg drops scenery tier or
render scale (DPR stays 1.5). These are still desktop-GPU emulation results;
occasional long frames remain. This pass does not certify hitch-free 60 fps or
unchanged maximum effects on physical phones.

Machine-readable evidence is under `.graphics-review/render-flight/`:

- `before/report.json`, `after/report.json`: the initial comparison.
- `cloud-gpu.json`: 4,096 samples per shader; maximum old/new density difference
  0.000001312, below one 16-bit normalized quantum, identical 8-bit quantization.
- `release-review/report.json`: final production transitions, drawing-buffer
  agreement, depth attachment preservation, and day/golden/night captures:
  **50/50 checks, zero runtime/shader errors, nine captures**.
- `release-benchmark/report.json`, `ordinary-flight/report.json`, and
  `cpu-diagnosis/report.json`: the additional runs described above.
- `alps/`: visually reviewed clear and overcast mountain captures at Ultra;
  261 draws in both captures, no runtime/GL errors. The capture script's
  REVIEW_REQUIRED status denotes the separate visual inspection, completed here.
- `final-mobile/`: final timing and profile evidence after the shadow-preserving
  fallback. Timed production build ID: `rwb-VD_l-4CxNj1V0w4ui`. The subsequent
  mobile Neon target safeguard does not change these satellite cases.
- `final-mobile-review/report.json`: **34/34 checks**, zero runtime/shader errors,
  including forcing the final atmospheric fallback on phone and tablet and
  verifying the retained 512 shadow map and 256 material variant.
- Compact-shadow pixel proof:
  `.graphics-review/painterly/neon-environment/report.json`, maximum difference 0
  with 419 shadow-control pixels and no GL errors.

## Verification

- Production build: `FLY_BUILD_DIR=.next-render-release npm run build -- --webpack`
  (set the environment variable using the host shell's syntax).
- `node scripts/verify-render-optimization.mjs`: 20 checks, including the real
  registered DEM loader receiving 12 independent worker payloads from one fetch.
- `node scripts/verify-cinema-overhaul.mjs`: 15 checks.
- `node scripts/graphics-unit.mjs`: eight graphics invariant families.
- `node scripts/verify-import-integrity.mjs`: four gates, 800 modules scanned.
- `node scripts/verify-shadow-calm.mjs`: 33 checks.
- `node scripts/verify-shadow-coverage.mjs`: 13 checks.
- `node scripts/verify-raster-retry.mjs`: 20 checks.
- `node scripts/verify-cloud-shadow-range.mjs`: two checks.
- Scoped ESLint and `git diff --check`.
- Browser commands: `node scripts/verify-render-flight.cjs --url=http://localhost:3087`
  and `node scripts/render-flight-benchmark.cjs --url=http://localhost:3087`.

Physical-device follow-up: run Enhanced High on the affected phone, including a
dense city turn, a mountain approach, day/night, and at least several minutes of
continuous flight. Record device/browser, render resolution, effective profile,
and governor steps alongside frame intervals. Existing saved Medium/Classic
choices are deliberately preserved, so select High/Enhanced to evaluate them.

## Cloud and mobile regression repair — 2026-10-07

The follow-up report was textured/glitching clouds and mobile flight needing
Classic/Low to remain playable. Review found several independent causes:

- Cloud smoothing gathered 25 cloud/depth pairs at **full scene resolution**.
  Lowering the ray-march resolution therefore left a substantial fullscreen
  cost. The replacement filters premultiplied radiance and transmission with
  two separable five-tap passes at cloud resolution, then reconstructs four
  depth-compatible neighbours per scene pixel. Both profiles use it; terrain
  silhouettes stay depth-protected.
- The body-density volume was sampled without mipmaps or a ray footprint.
  Sparse mobile marches aliased that detail into moving texture. Both density
  channels now use explicit footprint-selected mip levels, with the body capped
  at level two to preserve billows. Jitter stays spatially fixed and occupies
  the middle half of a step. The low profile trades fewer cloud pixels for 24
  depth samples instead of 16. There is no temporal history or ghosting buffer.
- The governor needed 90 usable frames to estimate refresh and discarded frames
  longer than 0.5 seconds. Severe overload could therefore delay or defeat
  recovery. A sustained-overload path now acts before that calibration, retaining
  boot/warp grace, pins, and the session latch. Single long gaps cannot trigger
  it, and hidden-tab frames are excluded. Resolution/effects still precede
  scenery-tier reductions.
- Mobile started at the desktop DPR cap of 1.5. Its shared Canvas/governor cap is
  now 1.25, **31% fewer shaded pixels** on a high-DPR device. High scenery remains
  the default. Mobile keeps directional cloud lighting with two light samples,
  and the atmospheric fallback retains its 512 shadow cascade and 256 materials.
- Changing a shadow map's resolution rebuilt the whole shadow rig and rebound
  lit materials. It now resizes the existing targets without changing lights,
  shader hooks, or compiled uniform identities.
- The newer upstream `CLOUD_CALM` fix was present but disabled. It now ships on:
  the haze datum is damped across terrain refinements, and density noise moves
  with the regional cloud base. Its two test arms explicitly pin their flags.
  Other True Earth experiment defaults remain unchanged, including PHYS_SKY,
  TRUE_SCALE, and DEVICE_TIERS. Upstream production worker fixes are preserved.

The pass also skips cloud-shadow density work beyond its visible range and
uses unbent height for the CPU cloud-inside sample, matching the shader.

GPU correctness was checked in Chrome on the host's NVIDIA RTX 5080. Across
4,096 samples per density variant, the representative movement-induced density
variance fell from 0.001290 to 0.000318 (75%), while cloudy samples remained
599/622. This is a density-sampling measurement, **not a measured percentage of
onscreen flicker**. The reconstruction test's maximum radiance/transmission and
foreground-edge errors were below 0.000001, with no GL errors. CLOUD_CALM's
300 m terrain-step case changes haze by 0.007% in one frame instead of 3.78%;
moving the base and sample together preserves all 4,000 tested densities.

The integrated tree passes scoped ESLint, import-integrity (859 files), the
graphics invariants, all eight repair checks, render optimization, cinema
overhaul/art, cloud-shadow range, cloud-calm, worker startup, device tiers, and
TRUE_SCALE compatibility. The optional PHYS_SKY checks also pass (12/12),
including its shader composition with TRUE_SCALE; neither flag is enabled.
Production builds use `node node_modules/next/dist/bin/next build --webpack`
with a separate `FLY_BUILD_DIR`.

Matched cloud GPU timings use the old checkout (`7aff577`) and the repaired
tree integrated onto `5790fd2`. The Grand Canyon camera positions are identical,
rotation differences are at floating-point epsilon, and base/thickness, weather,
sun, and drift are held fixed. CLOUD_CALM is explicitly pinned off in **both
timing arms** to isolate reconstruction/sampling cost; the production transition
and moving-flight checks use its shipped ON state. Each cell is the median of
60 non-disjoint GPU timer-query samples, in milliseconds:

| Layout / preset | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Desktop High | 0.485 | 0.408 | 16% |
| Desktop Medium | 0.326 | 0.171 | 47% |
| Desktop Low | 0.180 | 0.110 | 39% |
| Phone High | 0.201 | 0.108 | 46% |
| Phone Medium | 0.191 | 0.110 | 43% |
| Phone Low | 0.121 | 0.068 | 44% |

These are **cloud-pass costs on the RTX 5080**, not whole-frame speedups or
physical-phone measurements. Mobile figures include the 1.5-to-1.25 DPR change;
desktop resolution is unchanged. Low clouds are intentionally softer, while
the sampled terrain/building geometry is not removed by these fixes. GPU clock
and live-world streaming variability still affect absolute timing. Screenshots
and raw measurements are in `.graphics-review/graphics-repair/matched-before/`
and `matched-after/`; reproduce with `scripts/review-graphics-repair.cjs`, passing
`--url`, `--cloudCalm=off`, and separate `--output` directories.
The old `review-cloud-smoothing.mjs` now fails explicitly if its removed toggle
is absent or ignored, instead of reporting a false A/B over identical settings.

The final integrated production build (`k0Buee_B405MVy7eFH6sh`) passes **52/52**
desktop/phone/tablet transition checks, with zero shader/runtime errors: quality
changes, Classic/Enhanced, Neon return, buffer sizes, shadow depth attachments,
the mobile shadow-preserving fallback, and day/golden/night. Nine captures are
under `.graphics-review/graphics-repair/integrated-transitions/`. The live-world
checks exercise shipped CLOUD_CALM; the timed build's application sources match
the repair plus its CLOUD_CALM enablement, before this documentation commit.

Ordinary moving flight (live Manhattan, review census disabled, approximately
10 seconds straight plus 10 seconds turning) also finishes without runtime/GL
errors. High scenery stays selected throughout:

| Layout | FPS, straight / turn | p95 interval | Longest interval | Effective effects |
| --- | --- | --- | --- | --- |
| Phone emulation | 55.4 / 56.1 | 23.4 / 24.5 ms | 102.3 / 69.0 ms | phone-lean, 512 shadow, 256 materials, DPR 1.25 |
| Desktop | 68.3 / 62.6 | 17.8 / 21.1 ms | 105.4 / 99.5 ms | High, DPR 1 |

Raw results are in `.graphics-review/graphics-repair/integrated-flight/`.
These whole-frame results remain within the baseline's live-streaming range;
they do **not** establish an overall FPS gain on this desktop GPU. Occasional
streaming hitches remain. The demonstrated improvements are lower cloud GPU
cost, less density aliasing, stable haze/cloud datum, and prompt recovery from
severe overload. Physical-phone FPS, thermal throttling, and Safari have not
been measured. The affected-device follow-up above still applies; no claim of
universal 60 fps or complete removal of every graphics hitch is made.

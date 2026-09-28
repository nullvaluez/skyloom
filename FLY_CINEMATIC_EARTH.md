# Cinematic Earth presentation

Implementation record, September 28, 2026. Applies to **Satellite → Enhanced**.
The direction is cinematic Earth with recognizable geography, expressive jets,
readable moonlit nights, and a quieter chase view. The reference image is an art
direction target; matching its quality remains a visual judgment, not a test result.

## Implemented

| Reference quality | Implementation |
| --- | --- |
| Aircraft reads as the subject | Original Vector fighter with a sculpted fuselage, swept wings, twin tails, canopy, intakes, nozzle rings and distinct surface materials. Camera fits the actual model, frames it below center and shares less bank. |
| Bright, expressive propulsion | Twin tapered blue-white boost plumes with cyan/violet edges; immediate throttle response. Plumes render after the sky composite and use the existing cloud/depth occlusion gate. Ultra adds subtle distortion behind the engines in the existing composite, with no additional render target. |
| Directional light and atmospheric depth | Enhanced clouds use a periodic curled density field, an extra shape octave and stronger directional silver edges. Cloud night lighting follows the same moon direction as the ground. |
| Colorful, readable Earth | Existing geographic material classification stays intact. Enhanced ground receives a small albedo lift; aircraft glass, painted surfaces and exposed metal retain distinct highlights. |
| Night has its own palette | Shared navy horizon/zenith colors, pale moon key, higher indirect-light floors, restrained stars and a soft moon reflection on water. Existing city windows, streets and grounded illumination remain active. |
| Less clutter around flight | Desktop telemetry sits at lower left; ambient labels are limited around the aircraft. Selected and hovered aircraft retain labels and remain pickable. Touch layout retains its existing controls. |
| Boost feels connected | Existing wind/engine loops respond to boost with smooth gain, filtering and pitch changes appropriate to the aircraft. Reduced-motion mode excludes heat distortion and camera bank sharing. |

Classic and Neon keep their original aircraft assets and exclude the cinematic
policy. The plume compositor registration also repairs a pre-existing case where
the sky composite erased transparent exhaust. Aircraft physics, collision
dimensions and the streaming/governor architecture are unchanged.

## Quality and assets

Ultra is a presentation ceiling over the existing High scene tier, not a fourth
scene tier. The governor can still reduce resolution and effects. Phone sessions
default to Medium and resolve a saved desktop Ultra choice to Medium at boot.

| Preset | Cloud steps | Cloud scale | Maximum cloud target pixels | Shadow map |
| --- | ---: | ---: | ---: | ---: |
| Ultra | 96 | 0.50 | 2,073,600 | 2048 |
| High | 72 | 0.40 | 1,105,920 | 2048 |
| Medium | 48 | 0.30 | 360,000 | 1024 |
| Low | 32 | 0.25 | 160,000 | 512 |

The first-party Vector assets require **no purchase**. Both contain six material
roles and use the same presentation anchors. Hero: 5,276 triangles / 384,964 bytes.
Phone: 2,036 triangles / 151,680 bytes. They are selected by device at mount, so a
governor step does not swap the aircraft model. `scripts/build-vector-aircraft.mjs`
reproduces both GLBs. The manifest and generated `CREDITS.md` record provenance;
the original fighter credit remains for Classic and Neon.

## Validation

Evidence is stored locally under `.graphics-review/cinematic-earth/` (ignored by
Git). Production receipts bind the served Next build ID to the source hash;
presentation-file hashes additionally cover CSS and the generated models.

- New cinematic policy, cloud bounds, lighting continuity, fleet preservation,
  model budgets, and heat projection/rebasing checks: 9/9.
- Import integrity: 4/4. Aircraft effects: 13/13. Painterly flight: 18/18.
- R25 sky: 49 passed. R25 ground: 42 passed, one existing uncalibrated row.
  R25 front door: 70 passed. Graphics unit suite passed.
- R25 flag-off: 11 passed; its old constants-hygiene comparison to `r25-w0`
  fails on the starting tree's constants. This change does not edit those constants.
- The governor suite's retired `?graphics=legacy` expectation fails identically
  against the untouched starting commit (`60 !== 144`). The baseline reproduction
  is in `baseline-tests/governor.log`.
- Targeted lint has two existing `LabelCanvas.jsx` imperative-runtime ownership
  errors and one existing `FlyMode.jsx` synchronous-effect state write. All
  reproduce from `HEAD`; no newly introduced lint errors were found.
- Browser shader compilation and day/night imagery were checked in installed
  Chrome on the RTX 5080. Phone captures use touch/viewport emulation on that GPU;
  they establish layout and effect selection, not physical-phone performance.

The earlier attempted baseline capture was blocked by a readiness/worker error,
so no controlled before/after performance improvement is claimed.

### RTX 5080, 15-minute moving flight

Chrome hardware WebGL, 3840×2160 viewport, Ultra selected, baseline weather,
live terrain and traffic, no governor/terrain pins. Five warps include New York,
Ohio, Melbourne, Paris and the Owens Valley. 150.8 km traveled, 20 rebases,
zero crashes, 5–330 live aircraft. Evidence: `4k-flight.json`.

| Measurement | Result |
| --- | ---: |
| Frame time p95 / p99 | 8.4 / 12.6 ms |
| GPU time p95 | 7.79 ms |
| Draws p95 | 259 / 375 ceiling |
| Triangles p95 | **2,630,200 / 2,200,000 ceiling — FAIL** |
| Native resolution samples | **88/90; two at 0.875 scale — FAIL** |
| Runtime errors / failed imagery samples | 0 / 0 |

Overall result: **FAIL**, not a certified native-4K/60 result. The automatic
resolution reduction happened around the Owens Valley leg and recovered; scene
detail stayed High. All four High→Medium→Low→High transitions retained ready
buildings, roads, skyline and night lighting. The run still contained 45 CPU
long tasks (p95 66 ms); the largest observed frame was 75 ms. A good p95 does
not mean hitch-free flight or measured display/vsync behavior.

This long run preceded the heat-origin correction, presentation-aware preload
and quality-label fix. A short follow-up uses the final renderer source. The
last asset inspection also found and corrected a mirrored fin's inward normals;
both GLBs retain the same byte and triangle counts, and a mirror-normal check
now rejects that defect. Receipts include separate asset hashes so those versions
remain distinguishable.

### Final renderer browser checks

Build `ePH8yNoN-JXsVLLhzb1sf`; renderer source SHA-256
`d568f70be2715100088a2542bf203d9a735027f3cb8f6dd272914123c9540049`.

- `final-manhattan`: day, boost, dusk, night, all nine aircraft, Low and Classic.
  No page/shader errors; all instrument panels in bounds. Both Ultra boost
  captures have active finite heat projections after geographic rebasing.
  Overall **BLOCKED** for sharp-terrain readiness during boost and two rapid
  fleet changes. Those images are useful visual evidence, not settled-world passes.
- `final-phone`: all seven cases have sharp terrain and in-bounds instruments,
  with no page/shader errors. Medium uses 48 cloud steps and a 175×379 target;
  Low uses 32 steps and 146×316. Heat remains off. Result **REVIEW_REQUIRED**.
  Hardware is still the desktop GPU in touch emulation; physical phone timing
  and subjective audio/flight feel remain unmeasured.
- `final-canyon`: final corrected assets, all seven daylight/boost/golden/night/
  Low/Classic cases with sharp terrain, in-bounds instruments, finite active
  Ultra heat projections and zero page/shader errors. **REVIEW_REQUIRED**.
  [Daylight boost](.graphics-review/cinematic-earth/final-canyon/day-boost.png),
  [golden hour](.graphics-review/cinematic-earth/final-canyon/golden.png),
  [night boost](.graphics-review/cinematic-earth/final-canyon/night-boost.png).
- `final-4k-flight.json`: 90 seconds on the final renderer, 8.4 ms frame p95,
  12.5 ms p99, 7.29 ms GPU p95, zero runtime errors and native resolution in
  every sample. It still **FAILS** the triangle ceiling: 2,814,375 p95. This
  short run is not a replacement for the longer mixed-location result above.

The preview remains available at `http://localhost:3066`. Select Satellite,
Enhanced, Vector and Ultra to review the complete desktop treatment. The served
hero/mobile GLB bytes were hashed and matched `delivery-build.json` after the
fin correction. No assets were purchased. The user requested publication to
`main` after reviewing these results; the acceptance limits below remain open.

Remaining acceptance work is real-device phone testing, the scene triangle
budget and native-resolution dip above, and artistic review of real flight.
No performance bounds or historical tests were weakened to hide these results.

### Main integration

The visual changes were rebased onto `origin/main` at `715a69c6`, preserving
the newer traffic-trail fixes. The combined production build passed, together
with cinematic (9/9), import integrity (4/4), aircraft effects (13/13), and
painterly flight (18/18) checks. The upstream tracer suite reports 31 passed
and one source-format assertion failure: its stats-block matcher assumes LF,
while this Windows checkout uses CRLF. The relevant source is identical to
upstream after newline normalization, and the failing reference check passes
with normalized newlines. Neither the upstream test nor its bounds was changed.

## Reproduce

```powershell
node scripts/build-vector-aircraft.mjs
node scripts/gen-credits.mjs
node scripts/verify-cinematic-earth.mjs
node scripts/review-cinematic-earth.cjs --url=http://localhost:3066 --site=manhattan --fleet=1 --output=.graphics-review/cinematic-earth/final-manhattan
node scripts/graphics-flight.cjs --url=http://localhost:3066 --build-id=<served-build-id> --stage=immersive --quality=ultra --width=3840 --height=2160 --seconds=900 --scenario=mixed --hour=17 --output=.graphics-review/cinematic-earth/4k-flight.json
```

Use the review harness with `--phone=1` for touch layout and with `--site=alps` or
`--site=canyon` for rural terrain. Add `--build-id=<served-build-id>` to require a
matching production receipt. The harness captures daylight, boost, golden hour,
night, quality reduction and Classic. A clean capture run returns
`REVIEW_REQUIRED`, deliberately leaving artistic acceptance to the player.

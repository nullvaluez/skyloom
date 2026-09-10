# Immersive Satellite — playable review slice

The first review milestone of the approved immersion plan is implemented. Open
`http://localhost:3022/` and use Escape for the waterfront,
Ohio, Sierra, and above-cloud review destinations. On 2026-09-10 the user requested
immersive visuals always load: no query parameter is needed, and old `graphics`
parameters or preview switches no longer select an earlier renderer.

The continuation's weather corrections and expanded validation are recorded in
[IMMERSIVE_VALIDATION.md](IMMERSIVE_VALIDATION.md). Results below describe the
first slice and retain their original build/source scope.

## What changed

- Shared true-solar/weather lighting with a stronger direct-to-fill relationship,
  restrained environment illumination, and coordinated terrain/shadow direction.
- Shadows survive medium and low quality at 1024 and 512 pixels; high uses 2048.
  Actual shadow render targets resize before drawing. Building and vegetation
  caster flags follow the same policy. Aerial perspective survives quality drops.
- Volumetric clouds with a 256 KiB periodic 3D density texture, self-shadowing,
  forward scattering, density-based scenery shadows, and depth-aware composition.
  Cloud density remains geographically anchored through floating-origin rebases.
  Wind advects it; pause stops advection. The CPU samples the same quantized noise
  field for audio/inside-cloud state instead of equating cloud altitude with cloud.
- High/medium/low cloud integration uses 96/64/32 steps. High and medium render at
  half resolution; low at 35%. Midpoint integration removes screen-door noise.
  The same volume remains on every tier: this intentionally replaces the planned
  low-tier sprite fallback, avoiding a discontinuous change of cloud shape.
- Atmosphere composites before clouds, so a foreground cloud is not hazed using
  distant terrain depth. Cloud programs and the split effect groups are prewarmed.
- First-party foliage uses a generated leaf atlas, rounded lighting normals,
  matching depth cutouts, and 34 triangles per tree versus the prior 58. This is
  a bounded procedural foliage prototype, not a photogrammetry asset library.
- Architecture gains restrained floor/roof detail and facade-base darkening;
  mapped landcover gains antialiased near-ground detail. There is no global grass
  overlay, new invented geography, worker-protocol change, or imagery remapping.
- Chase framing is narrower and calmer, with less bank inheritance, shake, and
  boost distortion. Reduced motion persists and respects the initial OS preference.
- Optional wind/engine audio textures load after audio activation, loop smoothly,
  and respond to speed, camera distance, cloud density, pause, and mute. Existing
  synthesis remains available if a download or decode fails.

The new treatment is Satellite-only. Neon still uses its previous cloud/rendering
path. The integration test exercises switching both ways.

## Asset provenance

Both optional sound files are CC0 according to their original publication pages:

- IgnasD, [Wind](https://opengameart.org/content/wind): `Wind.ogg` from `wind.zip`,
  copied as `public/audio/immersive/wind.ogg` (59,861 bytes).
- pauliuw, [Engine sounds(2)](https://opengameart.org/content/engine-sounds2):
  `engine_sound.mp3`, copied as `public/audio/immersive/engine.mp3`.

The manifest in `lib/fly/assets.js` records the authors and runtime modifications.
These are sound textures, not claims of recordings from the selected aircraft.
The foliage atlas and cloud noise are first-party procedural assets.

## Validation and evidence

- Cold isolated production webpack build passes. This workstation's Node 25
  incremental webpack hash failure reproduced; isolated review builds disable
  that cache. Normal build configuration is otherwise preserved.
- `scripts/immersive-unit.mjs` passes: preview isolation, solar/weather behavior,
  finite transitions, periodic cloud density/rebase invariance, cloud/clear gaps,
  quality continuity, finite foliage attributes and absence of zero-area triangles.
- `scripts/graphics-unit.mjs` passes, including architecture coverage and protocol
  checks. Its data-URL loader now resolves the new pure helper dependency.
- `verify-terrain-merge.mjs` passes all seven lifecycle checks, including the
  required defective controls. R24 motion unit checks also pass.
- `scripts/immersive-smoke.cjs` passes all 12 integration checks on the RTX 5080:
  audio decode after gesture, reduced motion, pause mute, route navigation, real
  cloud entry, three quality levels, and Satellite/Neon transitions; no page or
  shader errors. The earlier optional-camera-handle harness error is preserved as
  `.graphics-review/immersive-smoke/report-blocked-camera.json`.
- New rendering/audio helpers and modified scene components pass targeted lint.
  The audio hook retains the same `runtime.audio` immutability diagnostic as HEAD;
  the matching baseline lint output is recorded. No lint exemption was added.
- `.graphics-review/immersive-build-source.json` records the served build ID and
  source hash. Intermediate captures are engineering evidence, not final acceptance.

The initial unpinned native-1440p baseline on the pre-existing cinematic server
passed: p95 10.7 ms, GPU p95 3.74 ms, draw p95 294 and triangle p95 1.851 M.
That server served the existing build while source editing continued; its harness
source hash must not be treated as the served bundle's identity.

Two early 60-second preview flights passed, but they do not certify cloud entry:
the inherited sampler reset height to 500 m despite the requested starting altitude.
The sampler now maintains its actual initial altitude, and the final cloud-band
run is recorded separately. A high-altitude capture that failed terrain readiness
remains BLOCKED; no readiness assertion was relaxed to turn it green.

The final **120-second daytime cloud-band flight passes** on source
`a8c76983a95e8dbf63f7ac5f10394c98a44d27888c9bef3a8192f5dd14aa1e8f`,
build `m2L2wZyjH_povFUN_UMDp`, installed Chrome / RTX 5080 at native 2560×1440:
p95 **6.5 ms**, p99 **6.8 ms**, GPU p95 **5.16 ms**. Actual flight altitude was
1,783–2,020 m; high quality and DPR 1 persisted throughout the measured interval.
Draw p95 was 250 and triangle p95 1.284 M. All four requested quality transitions
completed, with no page/shader errors. This is a bounded flight, not a 15-minute
soak, worst-case dense-cloud guarantee, or evidence of performance on other GPUs.
Receipt: `.graphics-review/immersive-final-flight.json`.

The final noon review captures for Manhattan, Ohio and Owens all reached high
quality, native 1440p and terrain sharpness, with zero page/shader errors. Draws
were 277 / 259 / 246 respectively; Owens remains below its 261 ceiling. Images and
per-pose telemetry are in `.graphics-review/immersive-review`.

Final Manhattan dusk and night captures also reached sharp terrain at native
1440p/high with zero page/shader errors (`.graphics-review/immersive-evening`).
These are fixed-pose visual checks, not performance measurements. The imagery
and procedural facade detail remain visible limits on realism.

## Review checkpoint and remaining work

This implements the agreed playable slice and its subsequently requested default
rollout; the broader immersion plan still has room for visual refinement.
Review the look in moving flight before the broader refinement/expansion phase.
The naturalness of the procedural foliage, cloud density, camera framing, and sound
mix needs the user's visual/listening judgment. A true volume remains on low quality;
performance on lower-end hardware has not been certified.

The expanded weather, interaction, cloud, geography and quality checks are now
recorded in IMMERSIVE_VALIDATION.md against the integrated main renderer. Both
15-minute soaks finished at native 1440p within the performance budgets, but each
retains a BLOCKED verdict for one brief imagery interruption. The earlier flash
and resize brightness-detector failures are also retained. Further refinement
should incorporate the visual feedback and resolve those certification limits
on the accepted treatment. Existing scene and Owens-specific ceilings remain
unchanged. The user authorized publishing this playable slice while validation
continued, then requested it always load. It is now the standard treatment.

## Reproduce

PowerShell, from this repository:

```powershell
$env:FLY_BUILD_DIR='.next-immersive'
node node_modules/next/dist/bin/next build --webpack
node node_modules/next/dist/bin/next start -p 3022
```

In another terminal:

```powershell
node scripts/immersive-unit.mjs
node scripts/graphics-unit.mjs
node scripts/immersive-smoke.cjs --url=http://localhost:3022
node scripts/graphics-flight.cjs --url=http://localhost:3022 --stage=immersive --width=2560 --height=1440 --hour=17 --alt=1900 --seconds=120 --output=.graphics-review/immersive-review-flight.json
```

Use installed GPU-enabled Chrome with tile-service access. Run GPU captures and
benchmarks sequentially. `--fixed-tier` is only for matched images; performance
certification must keep the governor live and record actual DPR and flight height.

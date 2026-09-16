# Satellite black flicker — September 16, 2026

The new Living Earth forest birth animation submitted instances with Y scale
exactly zero. Three.js's `defaultnormal_vertex` divides the normal by each
instance-matrix column's squared length, so the zero column generated NaN.
Flattened crowns still rasterized; a handful of invalid HDR pixels then spread
through mipmap bloom and turned the presented scene black. Streaming after boot
and warps repeatedly creates new instances, independently of aircraft speed.

`LivingForest._place` now floors the animated height at 0.01 metres. The initial
crown remains beneath its ground anchor (offset -0.8 m), the transform remains
invertible, and the mature geometry and lighting are unchanged.

## Reproduction and diagnosis

Chrome / ANGLE D3D11 / NVIDIA GeForce RTX 5080, actual network terrain and forest,
without the old fleet's terrain/governor pins:

- Original tree: **7 black frames / 702 composed frames** in the first baseline
  leg. Disabling material detail, clouds, and aerial haze did not eliminate it.
- Full half-float readbacks found 3–27 invalid channels in the original scene
  render, persisting through AO, aerial, and clouds before bloom blacked out the
  screen. No JavaScript or shader-compilation errors were required.
- At an actual failing pose, replacing singular instance Y columns with 0.01
  removed all invalid pixels on an immediate rerender. Forest birth instances
  were among those transforms; unrelated parked landmark instances were also
  singular. The product fix changes only the new forest birth path.
- With the forest fix alone: **0 black frames / 5,474 composed frames** across
  20-second coasting, cruise, and boost legs.
- Isolated production build `KghgOh-k8t6-lfeJpS-Wi`: **0 black frames / 10,544
  composed frames**, with no page/shader errors, through initial arrival,
  stationary flight, coasting, cruise, boost, Powell warp, and New York return.
  Powell admitted 7,868 forest patches. Both warps reached actual world readiness.
  The injected black-frame self-test registered exactly once.
- A separate production HDR scan passed: **0 invalid scene frames and 0 black
  frames across 538 presented arrival frames**, also monitoring scene targets
  during boot. This checks the source pixels, not only the final presentation.

Local forensic JSON files are under `.graphics-review/black-*.json`; these are
ignored scratch evidence. This record preserves the principal measurements.

## Regression coverage

`node scripts/verify-living-earth.mjs` — 18 checks pass. The added check exercises
zero, near-zero, partial, and full birth heights using both forest geometries and
the instanced normal calculation. It checks invertibility, finite nonzero
normals, hidden initial placement, and unchanged mature height.

`node scripts/verify-cinematic-flight.mjs` — 16 checks pass.

`scripts/verify-black-frames.cjs` reads three framebuffer scanlines synchronously
after every composer render. It covers initial arrival, stationary flight,
coasting, cruise, boost, and warps to Powell and New York. It requires loaded
world content and nonempty forests. A synthetic black frame must be detected
exactly once, separately from actual failures. `--diagnose=1` additionally scans
the HDR pass targets for NaN/Infinity. Readbacks affect timing: this is a pixel
continuity test, not a performance benchmark. Missing prerequisites return
BLOCKED (exit 2), not PASS.

Production build and targeted ESLint checks pass. The build was isolated using
`FLY_BUILD_DIR=.next-black-production` and `next build --webpack`.

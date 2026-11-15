# Look Pass B SHADOW: ledger (round 1)

Flag `LOOK_SHADOW` (on). Tunables: the `LOOK_SHADOW` block at the end of
`lib/fly/fly-constants.js`, read only through `lib/fly/look-shadow.js`.
Capture label `shadow-r1`; comparison
`.graphics-review/look-pass/compare/baseline__vs__shadow-r1/`.

## What was wrong (measured)

- **Ambient occlusion was invisible.** N8AO ran at 24 m radius. A live A/B on
  `nyc-street__noon` (AO intensity 0 vs as shipped) moved the lower third of the
  frame by 0.1 luma (90.9 vs 91.0). Street canyons were as bright as roofs.
  The ground-shading rig (`light-bubble.js`) also rewrites the AO radius and
  intensity every frame from the pass's construction values, so a live change
  to the pass is lost; the construction config is the place to tune.
- **Noon city frames are front-lit.** At the capture's 2 pm sun the shadows in
  `nyc-street` fall away from the camera, so sun shadows alone can never darken
  the visible canyons; sky occlusion has to.
- **Cloud shadows were clamped to nothing.** The Enhanced cloud composite already
  projects cloud density along the key light, but clamped the darkening to 23 %
  and then faded it twice through the air. No baseline frame shows one.
- **Cascades stopped at 3 km (Ultra) / 1.8 km (High).**

## What changed

1. **City-scale daylight AO** (`lookShadowAoConfig`, `lookShadowAoSun`). Radius
   24 -> 130 m, intensity 5 -> 6.5 on desktop High/Ultra (the only tier the AO
   pass runs on). Weighted by sun elevation (`aoSun` 0 -> 22 deg): at noon the full
   city AO, at golden hour about a quarter of the change, below the horizon
   exactly today's AO, so dusk and night are untouched. Applied after the
   ground-shading rig each frame (CinemaShadowRig, priority -0.9), with a
   remembered write so a skipped frame is never scaled twice.
   `nyc-street__noon` lower third 91.0 -> 63.6 luma; frame 112.6 -> 100.4
   (-10.8 %, inside the 12 % noon rule).
2. **Readable cloud shadows** (`lookShadowCloudComposite`, the one-line call in
   `immersive-cloud-pass.js`). The 23 % clamp is replaced by a Beer-law cover
   `1 - exp(-density * 11)` scaled to a 70 % core, an air floor (70 % of the
   un-hazed shadow survives the two air fades), a slight cool bias, and an
   ease to 35 % strength as the sun nears the horizon (a low sun threw a long
   straight-edged band across Yosemite in iteration 3). Uniform-driven; no
   recompile from the dials. Visible on `nyc-harbor__noon` (a large shadow
   across the harbour), `powell__noon` (a band beyond the aircraft),
   `nyc-street__noon` (the Hudson) and `nyc-cruise__noon` (patches beside each
   cloud).
3. **Cascade reach 8 km Ultra / 5 km High** (`lookShadowRangeM`), light frustum
   26 km deep with 6 km margin on those profiles only (`lookShadowLightDepth`
   now takes the profile; the checkpoint applied it to Medium and phone too).
   Same 3 x 2048 / 2 x 1024 maps. Visible mainly at golden hour on far blocks
   and trees; modest on the contact sheet.

## Dials (master)

`cloudShadow` (0 = none, 1 = tuned), `reach` (multiplies the cascade range),
`occlusion` (0 = today's AO, 1 = the tuned block). Detail: `cloud`, `rangeM`,
`lightFarM`, `lightMarginM`, `ao`, `aoSun`.

## Measured (shadow-r1 vs baseline)

| shot | frame luma | changed px | sparkle (base -> r1) |
|---|---|---|---|
| nyc-street noon | 112.6 -> 100.4 | 37.2 % | 1.999 -> 0.971 |
| nyc-harbor noon | 110.9 -> 107.2 | 22.8 % | 0.594 -> 0.402 |
| powell noon | 113.2 -> 111.3 | 23.1 % | 0.831 -> 0.374 |
| nyc-cruise noon | 124.7 -> 123.4 | 11.8 % | 0.116 -> 0.096 |
| nyc-street golden | 62.9 -> 61.4 | 9.4 % | 0.862 -> 0.363 |
| powell golden | 64.0 -> 64.0 | 15.5 % | 0.289 -> 0.098 |
| yosemite golden | 66.9 -> 66.0 | 12.2 % | 0.077 -> 0.033 |
| nyc-harbor night | 42.6 -> 41.7 | 11.1 % | 0.414 -> 0.263 |

Draw calls are not up (nyc-street noon 365 -> 325, a live-world difference).
No new pass, render target or texture fetch; the AO cost is per sample, not per
radius; the cascades render the same maps over a wider area (more shadow-caster
triangles in the far cascade; read the owner's 5080 frame time).

## Tried and rejected

- Checkpoint AO (70 m, intensity 4.0): it LOWERED intensity from 5 and the
  ground-shading rig blended it down further; invisible on the sheet.
- Full-strength AO at all sun elevations: `nyc-street__golden` lower third
  31 -> 21 luma, deepening the golden-hour mud the plan names. Hence `aoSun`.
- Cloud shadows at full strength under a 7 deg sun: a long straight-edged band
  over the Yosemite ridges that read as a floating sheet. Hence `lowSun`.
- `opticalK` 60 (probe): hard-edged black stamps.
- Building mass in the TERRAIN_SHADOW map: dropped for round 1; the override
  depth material bends with world-bend, the buildings with a per-anchor bend,
  so the far building shadow would sit off its building.

## Gates

- `node scripts/verify-true-earth-flags.mjs`: 8/8.
- `node scripts/verify-look-shadow.mjs` (new, 11 checks): flag off identity,
  reach on High/Ultra only (Medium/phone/Low keep range and light depth), AO
  config and sun weight, and the real Enhanced composite patched once.
- `npx eslint` on every changed file: clean.
- Pre-existing reds, identical with `LOOK_SHADOW` off: `verify-ship-sky` 47/2
  (main-hash checks for aerial/moon), `verify-living-sky` 20/1, `verify-r25-sky`
  47/2 (one is glslangValidator missing). `verify-ship-light` and
  `verify-ship-frame` crash on this Windows host before any check (a `tar` temp
  path and an ESM `c:` URL); not run.
- Passed: cinema-overhaul, cinema-profile-prewarm, cloud-calm, n8ao-direct,
  phys-sky, hdr-guard, true-scale, device-tiers, graphics-governor,
  render-optimization, graphics-repair.

## Edits outside my files

- `lib/fly/immersive-cloud-pass.js` (stream D): one import and one call,
  `lookShadowCloudComposite(this.r25)`, from the checkpoint; unchanged since.
- `scripts/verify-ship-sky.mjs`: four lines pinning `LOOK_SHADOW` off in every
  leg so that gate keeps certifying the Ship Pass SKY program text.

## Still weak

- Golden hour: by design the AO is mostly today's there and cloud shadows are
  eased, so `powell__golden` and `yosemite__golden` barely move. The cascades are
  the only change and they are hard to see at half size.
- Cloud shadows depend on where the baseline weather puts clouds; with sparse
  cumulus most frames get one or two shadows, not a dappled landscape.

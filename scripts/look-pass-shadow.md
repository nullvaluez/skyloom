# Look Pass B SHADOW: ledger (rounds 1 and 2)

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

---

# Round 2 (label `shadow-r2`)

## Review items

Blocking (code auditor), all fixed:

1. **Cloud shadow applied on every tier (rule 5).** Fixed. The patched
   composite keeps the original `clamp(shade*.32,0.,.23)` line as the `else`
   of one uniform branch on `uLookCloudShape.x`, a gate uniform shared by
   every patched composite. It starts at 0 and `CinemaShadowRig` writes it
   every frame from the live profile (`lookShadowCloudGate`): 1 on desktop
   High/Ultra (and their governor rungs) with cascades, 0 on Medium, phone,
   Low, with no cascades, with Classic or when the cinema rig retires. At 0
   the air fades act on the raw density exactly as before, so Medium/phone
   pixels are the original expression; the only added cost there is one
   uniform compare per ground pixel. Gate `verify-look-shadow` (5d) to (5f).
2. **Merge conflict with look/layers in `verify-ship-sky.mjs`.** Fixed: the
   `LOOK_SHADOW` pin moved below the OffscreenCanvas block. `git merge-tree`
   of this file against `look/layers` is now clean (checked with a temporary
   index).
3. **Triangle cost not justified.** See Cost below.

Non-blocking: the AO tuned config is cached per (base, look) and no longer
allocated every frame. The `cloudShadow` master dial now reaches baseline at
0 (it scales the gate, which mixes from the original line to the tuned one),
and above 1 it scales strength.

Critic:

- **Cloud shadows soft, larger, edge broken (done).** The caster is now a
  five-tap disc average (`softM` 420 m) held to at least 80 % of the core
  density, so each shadow grows a feathered penumbra past its cloud. Two
  octaves of the cloud noise at `noiseM` 900 m modulate the density (x0.55 to
  x1.45), which breaks straight or stamped edges. Darkness capped at 60 %
  (was 70 %, the harbour read near-black) and the cool bias raised 0.12 ->
  0.22 so the shadow reads blue-grey, not navy or green-black.
- **Golden-hour cloud shadows (done).** `lowSun` 0.35 -> 1: with soft edges a
  low sun's long shadow no longer reads as a sheet, so golden hour keeps full
  strength.
- **Houses float (done, a real defect).** `SatParcelHomes` casts only when the
  legacy sun light casts, and `CinemaShadowRig` always turns that light off,
  so in Enhanced no parcel house ever cast a shadow. On High/Ultra with this
  pass's cascades they now cast (`lookShadowHomesCast`). The live probe at
  `powell__golden` confirms `sat-parcel-homes` in the caster set, along with
  the tree canopy (`Mesh:trees`) and the forest tiles, which already cast.
- **City warm sun-side lift: declined.** The colour of lit walls and of the
  fill inside a shadow is stream E's (FLY_LOOK_PASS.md, B SHADOW bullet 5),
  and GRADE r1 already adds a warm key and cool fill. Doing it here would
  double the same move.
- **Golden-hour sun shadows that bite: partly.** The cascades already reach
  8 km at golden hour and trees, forest and now houses cast into them; what
  keeps them faint is the ratio of direct sun to sky fill at 7 degrees, which
  is exposure and fill (stream E). Darkening the ambient term inside the
  shadow would mean new CSM shader text in every lit material (a recompile of
  the whole world and a new prewarm key) and was not attempted this round.
- **AO further out: not changed.** The critic also called the near field
  heavy; a larger radius makes both worse together. Left at 130 m / 6.5.

## Cost

Measured by the auditor on a flag-off / flag-on pair, twice each:
`nyc-harbor__noon` 2.04 M -> 2.37 M triangles (+15.9 %, calls 340 -> 349),
`nyc-harbor__night` 2.16 M -> 2.52 M (+16.7 %, calls 344 -> 346). The cause is
the 8 km cascade reach: the far cascade now draws the shadow casters of a
much larger area. It is over rule 8's 15 % line and is kept because it is the
reach the plan asks for (canyons and grounded objects past 3 km). No new
pass, target or texture. For the owner's RTX 5080 read: if the harbour frame
time rises noticeably, `LOOK_SHADOW.reach` 0.75 brings Ultra to 6 km. The
r1 harbour-night draw-call spike (375 -> 538) did not reproduce (rerun 346):
streaming noise. Round 2 adds, on High/Ultra only: four extra cloud-density
taps and two noise taps per ground pixel in the existing cloud composite
(ALU and 3D-texture reads, no draw), and the parcel-house instances in the
shadow pass (one instanced draw per cascade where homes exist).

## Edits outside my files (round 2)

- `components/fly/SatParcelHomes.jsx`: one import and one call,
  `lookShadowHomesCast(runtime)`, added to the existing cast condition.
- `scripts/verify-ship-sky.mjs`: the round 1 pin moved below the
  OffscreenCanvas block (same four lines).
- `lib/fly/immersive-cloud-pass.js`: unchanged since round 1.

## Measured (shadow-r2 vs baseline)

| shot | frame luma | lower third | sparkle (base -> r2) | triangles |
|---|---|---|---|---|
| nyc-street noon | 112.6 -> 98.4 | 91.0 -> 59.0 | 1.999 -> 0.937 | 3.18 M -> 3.64 M (unsettled) |
| nyc-street golden | 62.9 -> 61.1 | 31.3 -> 27.8 | 0.862 -> 0.354 | 3.28 M -> 3.78 M (unsettled) |
| nyc-harbor noon | 110.9 -> 107.4 | 62.8 -> 61.9 | 0.594 -> 0.427 | 2.03 M -> 2.38 M |
| powell noon | 113.2 -> 110.9 | 81.0 -> 80.3 | 0.831 -> 0.436 | 0.82 M -> 0.92 M |
| powell golden | 64.0 -> 63.9 | 21.9 -> 22.0 | 0.289 -> 0.115 | 0.96 M -> 1.05 M |
| yosemite golden | 66.9 -> 65.1 | 38.8 -> 38.8 | 0.077 -> 0.054 | 0.66 M -> 0.66 M |
| nyc-cruise noon | 124.7 -> 123.6 | 133.8 -> 130.6 | 0.116 -> 0.086 | flat |
| nyc-harbor night | 42.6 -> 41.8 | 15.7 -> 14.4 | 0.414 -> 0.247 | 2.14 M -> 2.53 M |

`nyc-harbor__noon` middle band -9.8 luma (the soft harbour shadow). The
nyc-street pair did not settle (`settled=false`; calls 365 -> 514 is
streaming), and its frame luma reads -12.6 %, just over rule 7's 12 % (r1 read
-10.8 % with the same AO). If the merged frame needs it back, `occlusion` 0.85
is the dial. Capture errors: none.

## Still weak after round 2

- Golden hour. `powell__golden` and `yosemite__golden` still barely move at
  half size: the cloud shadows there are soft and present but small, and the
  sun cascades are faint because the direct-to-fill ratio at 7 degrees is low.
  The next real lever is an ambient term inside the cascade shadow (new CSM
  shader text and a prewarm key), which belongs with stream E's fill colour.
- Cloud shadow count still follows the baseline weather's sparse cumulus.

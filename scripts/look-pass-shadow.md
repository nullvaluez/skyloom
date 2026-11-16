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

---

# Round 3 (label `shadow-r3`): balancing inside the combined frame

Base: look/integration 2755f844 (all five streams merged). Compared against
`merged-1` (what this round changed) and `baseline` (the whole pass).

## Items

- **[must] Golden-hour cast shadows bite (powell__golden, nyc-street__golden):
  done, with a shimmer cost (below).** Cause, measured: at a 7 deg sun the
  sky fill and IBL make up most of the light on flat ground, and GRADE lifts
  both at low sun (fill x1.9, IBL x1.45). A tree shadow at `powell__golden`
  was 18 % darker than the lit grass beside it in `merged-1`. Fix:
  `applyLookShadowLowSun` (one call from `lib/fly/cinema-frame.js`, after the
  grade) scales the hemisphere fill by `1 - 0.6 w` and the IBL by
  `1 - 0.45 w`, w = 1 from -1..2.5 deg up to 9 deg of sun, 0 by 17 deg, clear
  air only (overcast untouched). The cascade lights (direct term on lit
  materials only, `lookShadowKeyGain` in CinemaShadowRig) rise by `1 + 0.5 w`
  so lit ground holds; the shared key `e.sun` that clouds, water, mist and
  the air read is NOT touched, so this adds nothing to the toward-the-sun
  glare. No new shader text, no prewarm key, no per-material term. With the
  stronger first try (fill .65 / env .5 / key .9) long tree and levee shadows
  read across the open land at powell__golden, tree shadow 25.6 vs lit 32.5
  (sample boxes include some shade; visually clearly darker and cool).
  The cascades carry the length: 8 km reach, shadows already scale with
  1/tan(elevation) because they are real cast shadows, not a contact term.
- **[must] nyc-street__noon near field: done for my share; the residue is not
  mine.** `occlusion` 1 -> 0.1 (AO radius 130 -> 35 m). merged-1 lower third
  vs baseline -47.5; at occlusion 0.6 it was -41, at 0.2 -33, at 0.1 -32/-35
  (run to run). The last 0.1 step moves nothing, so the remaining ~-33 lower
  third and ~-35 frame p05 come from GRADE's noon contrast and blue fill and
  FACADE's wall value, not occlusion. Block separation survives through the
  cascade shadows. Target (-25 / -15) not met by this stream alone.
- **[should] Cost at cruise: found and fixed, it was mine.** nyc-cruise__golden
  flag off 170 calls, on 312 (merged-1 308). The cause was the parcel houses
  casting into the cascades from 7 km up (`lookShadowHomesCast`). Now houses
  cast only below ~4.5 km AGL, and the cascade reach and light depth ease back
  to the profile's own between 2,000 and 4,500 m AGL (`highAgl`, refit in
  250 m / 500 m steps). nyc-cruise__golden on: 170 calls (= flag off). Cloud
  shadows at cruise are the composite and stay. Harbour triangles (+16 %) are
  the 8 km low-altitude reach and are unchanged; `reach` 0.75 is the dial.
- **[should] yosemite__golden stair-stepped terrain shadow edge: partly.** The
  desktop terrain shadow receiver now takes five bilinear PCF footprints on a
  rotated grid (radius ~1.3 texels) instead of one (new shader text, program
  key `|ts-depth-v1-ls3`, flag on only; the touch `horizon` path unchanged).
  The edge is softer but the teeth remain: they are wider than the filter, so
  either the terrain map texel on that cliff is several screen texels or the
  teeth come from the far CSM cascade. Not resolved this round.
- **Toward-the-sun check (nyc-skyline-sun__golden): my part does not add.**
  vs sun-merged-1: frame -0.2 luma, p95 228 (under 240). The fill/IBL cut
  slightly darkens the shaded faces facing the camera; the key is untouched.

## Shimmer (the open cost)

nyc-street__golden burst: baseline 0.862, merged-1 1.512 (FACADE's
regression), this round 1.98-2.14 with the low-sun fill on and 1.61 with
`lowSunShadow` 0 (probe). The stronger golden-hour shadow contrast makes
the existing facade/edge aliasing ~30 % more visible. The other golden shots
stay inside the rule (powell 0.305 vs 0.289; yosemite both under 0.3). Kept
on because cast shadows at golden hour are this round's headline item;
`lowSunShadow` 0 is the one-number way back if the facade fix does not bring
it down.

## Dials added

`lowSunShadow` (master, 0 = grade's fill untouched), `lowSun`
{fill, env, key, fullDeg, fromDeg, upFromDeg, upFullDeg}, `highAgl`
{fromM, toM}, `terrainSoft`. `occlusion` ships 0.1.

## Edits outside my files (round 3)

- `lib/fly/cinema-frame.js` (GRADE's): one import and one call,
  `applyLookShadowLowSun(e)`, after `applyLookGradeEnvironment(e)` (allowed
  by the round brief).
- `lib/fly/terrain-shadow.js` is mine (contract list); the program key change
  is inside it.

## Gates

`verify-look-shadow` 19/19 (check 3 now asserts the tuned block at the dial's
1; new checks 6 low-sun fill, 7 AGL reach, 8 terrain soft flag gating);
`verify-true-earth-flags` 8/8; `verify-n8ao-direct` pass; `verify-look-grade`
20/20; eslint clean on every changed file.

## Final shadow-r3 (fill .6 / env .45 / key .5, occlusion .1, wide terrain PCF)

The milestone was re-captured on the shipped dials after the key gain was
eased from .9 to .5 (shimmer). Long tree and levee shadows at powell__golden
are weaker than with .9 but still read.

| shot | frame vs merged-1 | lower vs merged-1 | frame vs baseline | lower vs baseline | sparkle base -> merged-1 -> r3 |
|---|---|---|---|---|---|
| nyc-street noon | +5.1 | +13.1 | -9.4 | -34.5 | 1.999 -> 1.296 -> 1.739 |
| nyc-street golden | -1.8 | -4.3 | +46.2 | +16.1 | 0.862 -> 1.512 -> 1.964 (over 1.25x) |
| nyc-harbor noon | +0.2 | +0.5 | +0.8 | -5.3 | 0.594 -> 0.461 -> 0.513 |
| powell noon | +0.3 | +1.7 | +3.7 | -0.5 | 0.831 -> 0.452 -> 0.445 |
| powell golden | +4.0 | +8.5 | +47.7 | +25.9 | 0.289 -> 0.162 -> 0.292 |
| yosemite golden | -0.8 | -3.1 | +60.7 | +46.0 | 0.077 -> 0.093 -> 0.129 (both < 0.3) |
| nyc-cruise noon | +2.4 | +2.0 | +14.9 | +22.3 | 0.116 -> 0.153 -> 0.117 |
| nyc-harbor night | 0.0 | +0.2 | -4.6 | -0.1 | 0.414 -> 0.244 -> 0.247 |

Calls: nyc-cruise noon and golden 170 (merged-1 golden 308). Capture errors:
none.

## Still weak after round 3

- nyc-street__golden shimmer (1.96 vs 0.862 baseline): FACADE's 1.51 plus
  this round's golden contrast. Weakest shot.
- nyc-street__noon lower third still -34 vs baseline with occlusion near
  today's; the rest belongs to GRADE / FACADE.
- Yosemite cliff shadow teeth softened, not gone.
- Cloud shadows at low altitude in Powell: unchanged this round (the critic
  asked for double contrast); the composite still follows the sparse
  baseline cumulus.

## Round 4 (close-out, on the balanced tree 5919deea)

### Shimmer: my share, one session, LOOK_SHADOW off vs on (--burst)

Labels `shadow-r4-off` (`--flags=-LOOK_SHADOW`) and `shadow-r4-on`, captured
back to back on :3312, same poses, same clock window.

| shot | sun | off | on | my share | rule |
|---|---|---|---|---|---|
| nyc-street golden | 7.0 | 1.251 | 1.533 | x1.23 | inside 1.25 |
| nyc-street dusk | -3.0 | 1.558 | 1.555 | x1.00 | inside |
| powell-sun golden | 7.0 | 0.276 | 0.334 | x1.21 | inside (and ~0.3) |
| powell-sun dusk | -3.0 | 0.126 | 0.133 | x1.06 | both under 0.3 |

No shot is over 1.25x from this stream, so no dial moved: the long Powell
shadows and the low-sun fill (`lowSunShadow` 1, key .5) stay as they are. The
orchestrator's whole-pass numbers (powell-sun golden 0.42 vs 0.29, dusk 0.32
vs 0.06) are the five streams together; with LOOK_SHADOW off in the balanced
tree they read 0.276 / 0.126, so the rest of the rise belongs to the other
flags (dusk is below the low-sun window, `upFromDeg` -1, so my fill term is
off there by construction). nyc-street golden at x1.23 is the one with no
margin: `lowSunShadow` 0.7 is the first step down if the owner sees it move.

### yosemite golden stair-stepped cliff edge: the terrain map texel, filtered

Not the far cascade: terrain never casts into the cinema cascades (they hold
buildings, trees, aircraft), so a ridge's shadow on the cliff comes only from
the terrain shadow map. On desktop High/Ultra that map is 2048 texels over
2 x 40 km (device policy `TERRAIN_SHADOW.mapSize`/`rangeM`), i.e. a texel
~39 m across the light and ~9 m along it at a 7 deg sun: the teeth are those
39 m texels on the caster ridge's silhouette. r4 widens the five-footprint
PCF ring from ~1.26 to ~2.5 texels under a low sun
(`mix(2, 1, smoothstep(.12, .35, light.y))`, so above ~20 deg it is r3's
ring), program key `-ls3` -> `-ls4`. The stepped lower edge on the cliff
face now reads as a soft diagonal (shadow-wip vs merged-2 crop). A slight
wave along the edge remains; removing it entirely needs a finer map (4096 or
a 20 km half-width on High/Ultra, device-policy, not mine: ~4x the map
memory/fill, or less reach for valley shadows), not a wider filter.

### Cost dial: LOOK_SHADOW.reach (the only one)

`reach` multiplies `rangeM` {ultra 8000, high 5000}, never below the
profile's own (Ultra 3000 / High 1800), desktop High/Ultra only, eased back
to the profile's range between 2,000 and 4,500 m AGL (`highAgl`).

| reach | Ultra cascade range | High | cost (low-altitude city/harbour/Rio) |
|---|---|---|---|
| 1 (ships) | 8 km | 5 km | +13 to +27 % triangles vs baseline (nyc-harbor noon 2.04 M -> 2.37 M, +16 %; calls +9); cruise 0 (eased off) |
| 0.75 | 6 km | 3.75 km | about half the added far-cascade casters (estimate, not captured) |
| 0.375 | 3 km (= base) | 1.875 km (~base) | 0 added: today's reach; long golden shadows past 3 km gone |

The added cost is the far cascade drawing every caster between 3 and 8 km;
it is triangles in the shadow pass, not pixels. Read on the owner's 5080
frame time; if it costs, 0.75 is the first step.

### Gates (r4)

`verify-look-shadow` 19/19, `verify-true-earth-flags` 8/8,
`verify-cinema-overhaul`, `verify-cinema-profile-prewarm` 7/7,
`verify-graphics-repair`, `verify-lounge-prewarm`, `verify-true-scale` 14/14
pass; eslint clean on both changed files.
`verify-ship-light` 64/67 (run under PowerShell: git-bash's tar cannot read
its C:\ temp path): (0a)/(0b) compare the flags-off terrain text to the old
base 940b751 and differ by other streams' terrain tokens
(`painterly-v3-r5-terrain-world-art1`); (1b) expects the bare `|ts-map-v1`
token and has been red since r3 added the look suffix (`-ls3`, now `-ls4`):
the gate needs to accept `-ls\d` when LOOK_SHADOW is on. Not edited (not my
file). `verify-ship-sky` 47/49: two aerial / cinema-environment hashes
against main, not my files.

### shadow-r4 vs merged-2 (what this step changed)

Mean absDiff 4.35. Luma moves within +-0.7 everywhere except yosemite golden
-1.1 (the cliff penumbra, the intended change). nyc-harbor noon absDiff 10.7
is cloud drift on the running clock (luma +0.16, contrast +0.06; at a 40 deg
sun the terrain ring is r3's by construction). Sparkle: nyc-street noon 1.495
-> 1.465, golden 1.503 -> 1.507, dusk 1.563 -> 1.560, powell golden 0.198 ->
0.167, powell noon 0.466 -> 0.383, yosemite golden 0.098 -> 0.102, harbor
noon 0.436 -> 0.446: run-to-run. Triangles unchanged (nyc-harbor noon 2.37 M,
nyc-street golden 4.12 M). Capture errors: none.

## Round 5 (review fixes on the balanced tree; reviews read 5919deea)

### Blocker: low-sun fill/IBL/key was not gated by profile (Medium leak)

Not addressed by r4 (71c8c9b2 only touched the terrain PCF ring). Fixed:
`applyLookShadowLowSun` now multiplies its weight by a profile gate that is 1
only on desktop High/Ultra (and rungs, `lookProfileKey`, cascades > 0) and 0 on
Medium, phone and Low; on gate 0 it leaves fill and environment untouched and
resets the cascade key gain to 1. The live gate (cinemaProfile()) eases over
~0.5 s like `lookGradeWeight`, first call snaps; an explicit profile argument
(the node gate) answers at once. New gate `verify-look-shadow (6c)`: every
Medium/phone/Low profile gives weight 0, fill 0.3 / env 0.8 untouched, key
gain 1; every High/Ultra rung applies. Medium powell__golden, one session,
`--quality=medium`: all flags on vs all off absDiff 0.80, changed 0.7 %, luma
-0.15 (auditor: 2.57-3.14, 7.7-9.8 %, +0.8-0.97); LOOK_SHADOW-off vs all-off
reads the same 0.81 / 0.7 %, so that is this session's floor
(`shadow-r5-med`, `shadow-r5-med-off`, `shadow-r5-med-noshadow`).

### Shimmer: my share re-measured, one session, LOOK_SHADOW off vs on (--burst)

The first r5 read with key 0.5 found powell-sun golden over the rule:
0.413 / 0.310 (x1.33) and again 0.434 / 0.299 (x1.45) (r4's 1.21 did not
hold). Attribution by dial: `lowSunShadow` 0 gave powell 0.298 / street 1.231
(= the off arm), so all of it is the low-sun term, not the reach. `lowSun.key`
0.5 -> 0.2 (fill and IBL cuts kept, so the shadow still reads; lit faces a
touch less hot): powell 0.322, street 1.352. Final, `shadow-r5` vs
`shadow-r5-off`:

| shot | off | on | my share |
|---|---|---|---|
| nyc-street golden | 1.255 | 1.347 | x1.07 |
| nyc-street dusk | 1.557 | 1.563 | x1.00 |
| nyc-skyline-sun golden | 1.744 | 1.842 | x1.06 |
| powell-sun golden | 0.285 | 0.298 | both under 0.3 |

The rest of the street / skyline-sun shimmer is FACADE x GRADE (auditor's
pair test); not mine to move. vs merged-2: nyc-street golden absDiff 2.18,
luma -1.27, sparkle 1.503 -> 1.347; dusk 0.83 (floor). vs sun-merged-2:
skyline-sun golden 5.81 (cloud drift, luma -1.17), powell-sun golden 3.81,
luma -1.67, sparkle 0.415 -> 0.298; sun path and glow kept.

Gates: verify-look-shadow 20/20, verify-true-earth-flags 8/8,
verify-cinema-overhaul, verify-cinema-profile-prewarm 7/7,
verify-graphics-repair, verify-true-scale 14/14; eslint clean.

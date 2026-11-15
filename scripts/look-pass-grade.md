# Look Pass, stream E (GRADE): ledger

Flag `LOOK_GRADE` (ON), read only through `lib/fly/look-grade.js` and
`lib/fly/look-grade-flag.js`. `?flags=-LOOK_GRADE` is the baseline look.
Desktop High and Ultra only: the live weight is 1 for the cinema profiles
`ultra`, `ultra-balanced`, `high`, `high-balanced`, else 0 (Medium, phone, Low
keep today's pixels; node gates see weight 0).

## What was wrong (measured on the baseline, display-sRGB mean luma)

| shot | frame | upper | middle | lower |
|---|---|---|---|---|
| powell golden | 64 | 103 | 68 | 22 |
| nyc-harbor golden | 67 | 108 | 76 | 19 |
| yosemite golden | 67 | 89 | 74 | 39 |
| nyc-street dusk (-3) | 36 | 35 | 44 | 28 |
| nyc-harbor night (-20) | 43 | 58 | 55 | 16 |

Causes found in code:

1. **Exposure did not follow the light.** `evaluateCinemaEnvironment` meters
   `exposureStops = mix(.16,-.10,day) - .16*golden`: it *closes* exposure by
   0.16 stop at golden hour while the key falls by roughly 3x, and civil
   twilight (key switched off at -4 deg, moon not yet the key) gets nothing, so
   dusk read darker than full night.
2. **Golden hour was not golden.** The physical sky sets the key to the real
   transmittance (about [1, .78, .55] at +7 deg); AgX then pulls a bright warm
   key back toward cream, so sunlit cliffs and towers read pink-grey. The
   display grade's warm guard (which exists to stop the owner's rejected
   "brown city") also denied any vibrance to bright amber.
3. **Fill was neutral-brown at low sun.** Fill colour and ground bounce kept
   the daytime values; shade under a low sun is lit by the blue dome.
4. **Flat AgX midtones.** The existing HDR grade adds only a gentle S; noon
   had no bite and greens/water were muted.
5. **Low-sun water** reflected the sky only through a small Fresnel term on a
   navy body: flat navy at golden hour.

## What changed

1. **Exposure law** (`applyLookGradeEnvironment`, after the physical sky sets
   the final key): +`exposureGolden` stops on a low-sun hump (sun -1.5..+32,
   peak +3.5..+11), +`exposureDusk` on the civil-twilight hump (-10..+3.5),
   `exposureNoon` (-0.02) above 18 deg, nothing at full night. Overcast opens
   golden about half as much.
2. **Warm key at low sun**: the key's chroma x(1 + `keyWarmGolden`), green
   held to a gold floor (`keyGoldGreen`), key strength x(1 + `keyGainGolden`).
   Noon key untouched (gate asserts it). Display grade: the warm guard lifts
   off bright pixels at low sun only; honey push in lit mids (`keyWarm`).
3. **Cool fill at low sun**: hemisphere fill x(1 + `fillGolden`), IBL
   x(1 + `envGolden`), fill hue toward `fillColor`, ground bounce neutral
   instead of brown. Display grade adds a blue-grey push in shadow (`shadeCool`).
4. **Display tone curve** (post-AgX, inside the existing HDRGrade effect, no
   new pass): toe lift, luma-only midtone S (`contrast`, `pivot`), soft
   shoulder, vibrance with the warm guard. Contrast and vibrance fade out below
   civil twilight so full night keeps today's curve.
5. **Low-sun water** (`coastal-water.js`, behind the flag): the reflected sky
   chroma-lifted and warmed toward the sun's azimuth on grazing far water, plus
   a broad sun-path lobe toward the sun. None of the hero poses looks toward
   the sun, so the path lobe is unverified in frames.

## Result: grade-r1 (frame mean luma, saturation, burst shimmer)

| shot | luma before -> after | sat | shimmer % before -> after (ratio) |
|---|---|---|---|
| powell golden | 64 -> 94 (lower third 22 -> 38) | .41 -> .43 | .289 -> .248 (0.86) |
| nyc-harbor golden | 67 -> 99 (lower 19 -> 33) | .36 -> .46 | .406 -> .374 (0.92) |
| yosemite golden | 67 -> 97 (lower 39 -> 64) | .34 -> .43 | .077 -> .096 (1.25, at the limit) |
| nyc-street dusk | 36 -> 58 | .52 -> .51 | 1.370 -> 1.601 (1.17) |
| powell noon | 113 -> 124 (+10 %) | .32 -> .39 | .831 -> .580 (0.70) |
| nyc-harbor noon | 111 -> 121 (+9 %) | .30 -> .39 | .594 -> .497 (0.84) |
| nyc-cruise noon | 125 -> 137 (+10 %) | .30 -> .35 | .116 -> .128 (1.10) |
| nyc-street noon | 113 -> 123 (+9 %) | .26 -> .33 | 1.999 -> 1.800 (0.90) |
| nyc-harbor night | 43 -> 43 | .55 -> .57 | .414 -> .225 (0.54) |

Golden p95 194-201 (unclipped), all three inside the 85-105 target; dusk now
above night (58 vs 43). Compare: `compare/baseline__vs__grade-r1/sheet.jpg`
(mean absDiff 21.2, 85.7 % of pixels changed). The nyc-street pose reported
`settled=false` after 150 s in the r1 run (streaming, not grade).

Weakest: `nyc-cruise__noon` (bluer sky and a crisper ground, but the frame is
dominated by the haze band, stream A's) and noon generally: noon reads
cleaner, bluer and cooler in shade, not transformed. The noon city is still
grey-white; its materials are stream C's, and a warm daylight key was not
re-added because of the owner's brown-city rejection.

## Round 2 (after review: critic revise 3.2, auditor pass)

The critic's verdict: golden hour and dusk strong (Yosemite 4.5), noon a
minor grade shift (powell, harbor 2, cruise 2.5); golden water still cobalt
with no gold; a teal band in the harbour's golden sky; cream-blown golden
cloud tops; a monochrome blue-grey noon city. The auditor's non-blocking
notes: the 0/1 weight snaps on a governor tier step; two pre-existing reds
missing from this ledger.

What changed in r2 (WIP `4ee7fef7` from the interrupted instance, then
`9ecb3a02` and the sparkle pull-back):

1. **Noon colour** (display grade, `day` share only, warm/brown never pushed):
   hue-selective chroma on blues (`noonBlue` 0.55) and greens (`noonGreen`
   0.50), a green hue spread for crop variety (`greenSpread`), a deeper
   saturated sky (`skyDeep` 0.10), extra midtone S at noon (`contrastNoon`
   0.10) around a raised pivot (`pivotNoon` 0.48, so hazy mid ground holds
   instead of lifting toward milk), and a warm-neutral push on sunlit,
   unsaturated stone and concrete (`noonWarm` 0.07). The toe lift is mostly
   withheld at noon (an open toe read as a milky lower frame from cruise).
   The chroma lift is gamut-limited: an earlier pass clipped the cruise
   zenith's red channel to 0 (hue shift to royal blue); the lift now stops
   before any channel leaves the gamut and fades on already-saturated colour.
2. **Gold far water at low sun** (`coastal-water.js`): far grazing water takes
   the horizon's brightness with the key's hue (fully gold toward the sun,
   peach away from it) instead of the cinema sky's cool horizon term; near
   water reflects more of the (chroma-lifted) sky. Program key
   `|look-grade-water-v4`.
3. **Low-sun guards**: firmer shoulder at low sun (`shoulderGolden`) and the
   warm-guard lift stops on the brightest tops, so gold cloud tops keep
   shading; `tealGuard` turns bright unsaturated green-led sky pixels toward
   lavender-peach.
4. **Weight ramp**: `lookGradeWeight()` eases over 0.5 s on a tier change
   (first frame snaps, so boots and stills are never mid-ramp).

### grade-r2 measured (frame mean luma, saturation, burst sparkle %)

Final r2 tree (`contrastNoon` 0.10, toe keyed on day; see the sparkle note).

| shot | luma base -> r1 -> r2 | sat base -> r2 | sparkle base -> r2 (ratio) |
|---|---|---|---|
| powell golden | 64 -> 94 -> 93 | .41 -> .45 | .289 -> .273 (0.94) |
| nyc-harbor golden | 67 -> 99 -> 102 (lower RGB 14,20,23 -> 20,42,68) | .36 -> .46 | .406 -> .386 (0.95) |
| yosemite golden | 67 -> 97 -> 94 | .34 -> .46 | .077 -> .085 (1.10) |
| nyc-street dusk | 36 -> 58 -> 57 | .52 -> .52 | 1.37 -> 1.583 (1.16) |
| powell noon | 113 -> 124 -> 116 | .32 -> .46 | .831 -> .675 (0.81) |
| nyc-harbor noon | 111 -> 121 -> 113 | .30 -> .47 | .594 -> .632 (1.06) |
| nyc-cruise noon | 125 -> 137 -> 131 (upper 80 -> 70) | .30 -> .42 | .116 -> .162 (1.40, noise: .109 on the previous r2 run) |
| nyc-street noon | 113 -> 123 -> 115 | .26 -> .41 | 1.999 -> 2.296 (1.15) |
| nyc-harbor night | 43 -> 43 -> 44 | .55 -> .55 | .414 -> .242 (0.58) |

Compare: `compare/baseline__vs__grade-r2/sheet.jpg`, mean absDiff 21.9, 86.1 %
of pixels changed (r1: 21.2 / 85.7 %). Noon now differs by absDiff 15 to 20
per shot (the baseline-a floor is about 4 to 5) at nearly the same mean luma:
the noon change is contrast and colour, not exposure. Noon saturation is up
0.14 to 0.17 on every noon shot.

Sparkle: the metric counts pixels whose luma jumps by more than 30 between
creeping frames, so any added contrast raises it at a fixed threshold, and
two runs of the same code differ a lot (clouds animate, nyc-street never
reports settled). A flag-off control captured on this server mid-round
(`grade-off2`) read yosemite golden .040 and nyc-street noon 1.246. The first
r2 tree (`contrastNoon` 0.18, full toe at low sun) read yosemite .137 / .224
and nyc-street noon 2.448 / 3.271 in two runs: a real rise, not noise. The
toe is now keyed on daylight (not low sun) and the noon S is 0.10, which
brought both inside 1.25x of baseline (1.10, 1.15). nyc-cruise noon (.116 ->
.162) is a tiny number on a frame of animated clouds; the same pose read .109
on the first r2 run with more contrast, so it is read as noise, but it is the
one ratio over 1.25 in the final set.

Weakest in r2: `nyc-cruise__noon`. The sky is deeper and the ground less
milky, but the white haze slab (stream A) still dominates, the zenith now
reads dark navy, and its sparkle ratio is the one over 1.25. Also weak:
`powell__golden`'s lake, which stays a blue slab (see rejected).

## Dials (`LOOK_GRADE` in fly-constants.js)

Masters: `exposure`, `fill`, `grade`, `water`, `warmth` (each 0 removes its
family, 1 = as tuned). Detail: `exposureNoon/Golden/Dusk`, `fillGolden`,
`envGolden`, `fillColor`, `groundBounce`, `keyWarmGolden`, `keyGoldGreen`,
`keyGainGolden`, `toeLift`, `contrast`, `pivot`, `shoulder`, `vibrance`,
`warmGuard`, `shadeCool`, `keyWarm`, `waterSheen`, `waterPath`; r2 adds
`contrastNoon`, `pivotNoon`, `noonBlue`, `noonGreen`, `greenSpread`, `skyDeep`,
`noonWarm`, `shoulderGolden`, `tealGuard`.

## Tried and rejected

- The checkpoint's water sheen added the CPU horizon colour (`uCinemaHorizon`)
  times a lavender/peach tint: it laid a grey-lavender veil over the harbour
  (frame saturation fell 0.36 -> 0.22). Replaced by the reflected sky itself,
  chroma-lifted.
- First warm-key pass (chroma x1.9, weak green hold) turned Manhattan and the
  clouds salmon-pink. Pulled to x1.75 with a 0.66 green floor: gold, not pink.
- Contrast/vibrance at full night (the checkpoint's 0.35 floor) darkened the
  night sentinel 43 -> 36 and lower third 16 -> 8. Gated off below twilight.
- r2: `contrastNoon` 0.30 around pivot 0.52 halved the cruise zenith's
  luminance (upper third 80 -> 62, a near-black navy) and darkened harbour
  water; pulled to 0.18 / 0.48.
- r2: `contrastNoon` 0.18 and a full toe lift at low sun roughly doubled
  the burst sparkle at yosemite golden and nyc-street noon against a flag-off
  control; pulled to 0.10 and a daylight-keyed toe.
- r2: an ungated noon chroma x1.55 clipped the cruise zenith's red to 0
  (pixels 1,54,125): replaced by the gamut-limited lift.
- r2: far water sampling the cinema sky at its own reflection angle
  (`.025 + .5*eye.y`) stayed cobalt, because the gold band in the frame is
  only 2 to 3 degrees tall and the cinema sky's horizon term is cool. The key
  colour carries the gold instead.
- r2, not solved: the Powell golden lake is near water seen steeply (it
  reflects the deep-blue upper sky); it is lighter and bluer than r1 but has
  no gold, and the sun is out of frame so no sun path can show.
- Not attempted this round: open-land colour variation and deeper vegetation
  in the terrain shader (`earth-surface-material.js`, `living-ground.js`).
  Vegetation is only richer through the display vibrance.

## Gates

- `node scripts/verify-look-grade.mjs` (new): 17/17. Weight 0 and node are
  byte-identical environments; flag-off display text has no `uLook`; the law's
  signs; golden key gold not salmon; noon key untouched.
- `node scripts/verify-true-earth-flags.mjs`: 8/8.
- `npx eslint` on every changed file: clean.
- Node gates naming my files, same result as the baseline tree `c0f11f36`:
  architectural-daylight, cinematic-earth, city-water, cinema-overhaul,
  cruise-color, painterly-flight, true-scale (14), twilight (6) pass.
  verify-cinema-art (assertion), verify-ship-sky (47/2), verify-r25-flagoff
  (4a, a pre-existing constants diff far above the LOOK blocks) and
  verify-r25-ground (7d vendor, 8 vendor-three-tile) fail identically on the
  baseline tree: pre-existing, not moved by this stream. So do
  verify-sea-seams (identical PASS/FAIL list) and verify-ship-light 0a/0b
  (red with LOOK_GRADE forced off too; the auditor's finding).
- r2 re-run: verify-look-grade 18/18 (new: the noon chroma gamut guard is in
  the shader text), verify-true-earth-flags 8/8, eslint clean on every changed
  file; architectural-daylight, cinematic-earth, city-water, cinema-overhaul,
  cruise-color, painterly-flight 18/18, true-scale 14, twilight 6,
  twilight-balance 13, phys-sky 12, reflection-stability 3/3, water-field,
  terrain-weathering exit 0; sea-seams, cinema-art, ship-light exit 1 as on
  the base tree.

## Cost

No new pass, target, texture or draw. The grade runs inside the existing
HDRGrade effect (one uniform vec4); the water adds one uniform and a few ALU
ops per water pixel; the CPU side is a handful of scalar ops per frame. New
shader text: the earth-surface program key gains `|look-grade-water-v4` (r2) when
`SEA_STATE` and the flag are on. The flag-on shader text also compiles on
Medium, phone and Low behind a uniform branch that is 0 there (identical
pixels, a skipped branch, slightly larger programs). grade-r2 draw calls
match baseline within streaming noise (192 to 367 per shot).

## Outside edits

- `lib/fly/cinema-frame.js` (r1, unchanged in r2): one import and one call,
  `applyLookGradeEnvironment(e)`, after `applyPhysicalSky` (shared with A).

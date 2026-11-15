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

## Dials (`LOOK_GRADE` in fly-constants.js)

Masters: `exposure`, `fill`, `grade`, `water`, `warmth` (each 0 removes its
family, 1 = as tuned). Detail: `exposureNoon/Golden/Dusk`, `fillGolden`,
`envGolden`, `fillColor`, `groundBounce`, `keyWarmGolden`, `keyGoldGreen`,
`keyGainGolden`, `toeLift`, `contrast`, `pivot`, `shoulder`, `vibrance`,
`warmGuard`, `shadeCool`, `keyWarm`, `waterSheen`, `waterPath`.

## Tried and rejected

- The checkpoint's water sheen added the CPU horizon colour (`uCinemaHorizon`)
  times a lavender/peach tint: it laid a grey-lavender veil over the harbour
  (frame saturation fell 0.36 -> 0.22). Replaced by the reflected sky itself,
  chroma-lifted.
- First warm-key pass (chroma x1.9, weak green hold) turned Manhattan and the
  clouds salmon-pink. Pulled to x1.75 with a 0.66 green floor: gold, not pink.
- Contrast/vibrance at full night (the checkpoint's 0.35 floor) darkened the
  night sentinel 43 -> 36 and lower third 16 -> 8. Gated off below twilight.
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
  baseline tree: pre-existing, not moved by this stream.

## Cost

No new pass, target, texture or draw. The grade runs inside the existing
HDRGrade effect (one uniform vec4); the water adds one uniform and a few ALU
ops per water pixel; the CPU side is a handful of scalar ops per frame. New
shader text: the earth-surface program key gains `|look-grade-water-v2` when
`SEA_STATE` and the flag are on.

## Outside edits

- `lib/fly/cinema-frame.js`: one import and one call,
  `applyLookGradeEnvironment(e)`, after `applyPhysicalSky` (shared with A).

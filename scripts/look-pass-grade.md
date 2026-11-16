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

## Round 2 revision (after review of `dd8d5102`: critic ship 3.9/4.2, auditor pass)

No must-fix and no blocking item. The resumed instance found no WIP after
`dd8d5102` (the `4ee7fef7` checkpoint the task named sits below round 1 and is
already folded into it), so every item below is new work on top of `dd8d5102`.
Captures re-taken under the same label, `grade-r2`.

What changed (all behind the flag and the live weight; new dials in brackets):

1. **Golden water, near field** (`coastal-water.js`): the near-water sky add
   is chroma-lifted x1.15 instead of x1.7 (the x1.7 was the cobalt tarp); the
   wave slopes that face the sun take a gold sheen off the horizon brightness
   in the key's hue, squared on the slope so it is texture, not a veil, and
   stronger on the sun's side of the frame (`waterNearSheen`); the near body
   gives up 16 % of its chroma toward a warm grey. The lavender "away from the
   sun" tint is now a faint peach.
2. **Noon lake** (`coastal-water.js`, uLookWater.z, `waterNoon`): steep water
   by day reflects 0.075 more of the sky it sees, so its luma rises and the
   waves (which steer the reflected ray) carry structure.
3. **Cruise zenith** (`zenithLift` 0.15): dark, saturated blue below luma
   about .4 gets value back and a little chroma out (toward a mid blue).
4. **Noon whites** (`cloudWhite` 0.85): bright unsaturated pixels at noon go
   to a pale blue-white at their own luma, and the `noonWarm` push now stops
   below them (its top band moved .80-.95 -> .66-.84). Clouds and the cruise
   haze slab are white or blue-white, stone and concrete keep the warm key.
   This only takes back the cream this stream added to stream A's slab; the
   slab's own tint and density are A's.
5. **Dusk walls** (`duskCool` 0.40): at civil twilight warm-lit pixels give
   up 40 % of their chroma toward a faintly blue grey (full night and golden
   hour untouched). Kept modest: stream C's night windows take the rest.
6. **Auditor, non-blocking, taken**: the flag-on GLSL (display grade and sea)
   is now compiled only off the mobile graphics class
   (`LOOK_GRADE_COMPILED = LOOK_GRADE_ON && !isMobileGraphicsClass()`), so
   phones and tablets keep today's programs, not only today's pixels. Desktop
   Medium keeps the uniform branch (its tier moves at runtime). Program key
   `|look-grade-water-v4` -> `-v5`.
7. **Auditor, not taken**: caching `cinemaProfile()` per tier (FlyScene already
   resolves it each frame; the saving is one small object) and zeroing the
   water uniform in `cinema-frame.js`'s cinema-off branch (Classic/Neon are not
   player-facing, and it would be a second edit in a file this stream does not
   own).

WIP evidence (`grade-wip`, region probes, display RGB / luma):

| region | round 1 | round 2 |
|---|---|---|
| powell noon lake (800-1150, 760-880) | 17,39,67 / 36.3 | 18,46,78 / 42.1 (+16 %) |
| powell golden lake | 10,21,45 / 20.8 | 17,25,43 / 24.6 |
| harbour golden near water (0-600, 700-900) | 2,24,54 / 21.8 | 13,27,49 / 25.9 |
| cruise noon zenith (top 200 rows) | 13,65,125 / 57.8 | 16,70,133 / 63.0 (+9 %) |

### grade-r2 (revision) measured, `73cac3d5`

Frame luma = baseline + compare delta; sparkle = burst, baseline -> r2.

| shot | luma base -> r2 | sat delta | sparkle (ratio) |
|---|---|---|---|
| powell golden | 64 -> 93 | +.03 | .289 -> .267 (0.92) |
| nyc-harbor golden | 67 -> 103 | +.03 | .406 -> .399 (0.98) |
| yosemite golden | 67 -> 95 | +.12 | .077 -> .077 (1.00) |
| nyc-street dusk | 36 -> 58 | -.02 | 1.370 -> 1.543 (1.13) |
| powell noon | 113 -> 116 | +.14 | .831 -> .628 (0.76) |
| nyc-harbor noon | 111 -> 113 | +.16 | .594 -> .628 (1.06) |
| nyc-cruise noon | 125 -> 131 | +.11 | .116 -> .119 (1.03) |
| nyc-street noon | 113 -> 114 | +.14 | 1.999 -> 2.215 (1.11) |
| nyc-harbor night | 43 -> 45 | 0 | .414 -> .250 (0.60) |

Every burst ratio is now inside 1.25x (cruise noon was the one over, 1.40).
Mean absDiff 21.8, 86 % of pixels changed. Region probes on the final set:
cruise haze slab (rows 330-420) 137,162,179 at baseline, cream in round 1,
129,170,198 now (blue-white); cruise zenith 63.0 (round 1 57.8, baseline
68.1); Powell noon lake 42.2 (round 1 36.3, baseline 45.5); harbour golden near
water 13,27,49 (round 1 2,24,54).

Rejected on the way: a broad sheen with a 0.25 floor plus a 30 % chroma pull
turned the harbour's near water slate grey-brown (the critic's strongest frame
lost its depth); replaced by the slope-squared sheen and a 16 % pull.

## Round 3 (balancing inside the merged frame, `2755f844` + sun poses)

The owner's item first: golden hour toward a low sun (Rio, and any pose facing
it) was a cream frame. On sun-merged-1 the toward-the-sun shots sat +55 to +84
frame luma over sun-off, the water was flat gold and the sun path was lost.
Three causes on my side: the +0.72 stop golden lift stacked with ATMOS glow and
the cirrus; the near-water gold sheen and a broad pow-6 sun-path lobe washed all
water facing the sun gold; and the lift did not care where the camera looked.

- Golden lift cut 0.72 -> 0.22 stop (down-sun golden now +26..+31 over
  baseline at powell and the harbour).
- Metering (`meterSun` 0.95, `meterDusk` 0.6): exposure comes off as the view
  turns into a low sun (horizontal facing, smooth 0.05..0.9), eased over about
  0.9 s like an eye; a new camera snaps. `cinema-frame.js` now passes
  `runtime.camera` to my existing call (same line). Noon is never metered.
- Water: the broad lobe is now a narrow pow-16 x .05 under the pow-30 path,
  the graze sheen floor .11 -> .05, `waterSheen` 0.8 -> 0.4, `waterNearSheen`
  1.0 -> 0.35. The path is again the brightest thing on the water
  (program key `look-grade-water-v6`).
- Noon (critic: lower third -47, saturation +0.24): `toeNoon` 0.75 (was a fixed
  0.4), `toeGuard` 0.9 (the S below the pivot spares the darkest tones at noon),
  `contrastNoon` 0.10 -> 0.03, `fillNoon` 0.25, `shadeCoolNoon` 0.35 (navy ->
  neutral-cool), `vibranceNoon` 0.65, `noonBlue` 0.55 -> 0.42, `noonGreen`
  0.50 -> 0.40, `zenithDesat` 0.15.
- Night: `exposureNight` 0.30 stop, `toeNight` 0.70 (was 0.35).
- Dusk: `exposureDusk` 0.80 -> 0.66 (dusk stays under golden), `fillDusk` 0.70
  (was 0.35), `toeDusk` 0.8 (a low, narrow toe, y*(1-y)^10, on the ground only).

### grade-r3 measured (frame mean luma delta; burst sparkle %)

Toward the sun, against sun-off (the old look) / against sun-merged-1:

| shot | vs sun-off | vs sun-merged-1 | p95 | sparkle off -> r3 |
|---|---|---|---|---|
| rio__golden | +33.9 | -50.0 | 208 | 0.151 -> 0.144 |
| nyc-skyline-sun__golden | +10.9 | -51.0 | 212 | 0.867 -> 1.555 |
| powell-sun__golden | +1.8 | -53.6 | 194 | 0.287 -> 0.290 |
| yosemite-sun__golden | +21.2 | -40.5 | 205 | 0.149 -> 0.088 |
| nyc-cruise-sun__golden | +8.7 | -53.9 | 200 | 0.102 -> 0.073 |
| rio__dusk | +22.8 | -16.3 | 116 | 0.059 -> 0.066 |

Hero shots against baseline (merged-1 in brackets): powell__golden +26.4
(+43.8), nyc-harbor__golden +30.7 (+49.8), yosemite__golden +45.3 (+61.5),
rio__golden +17.1 (+66.9), nyc-street__noon -9.3 (-14.5; lower third -36.5,
was -47.5; p05 -31, was -41; saturation +0.14, was +0.24), nyc-harbor__night
+3.9 (-4.6), nyc-street__dusk +29.7, powell__noon +5.9, nyc-cruise__noon +16.0.
WIP: alps__dusk lower third 14.5 -> 20.5 with the sky flat (72.9 -> 71.0);
alps__night 35.4 -> 41.7 (baseline 43.9); powell__night 36.3 (baseline 32.9).

Shimmer: nyc-street__dusk 1.37 -> 1.91 against baseline (1.39x; merged-1 was
2.24, FACADE's item) and nyc-skyline-sun__golden 0.867 -> 1.555 against sun-off
(1.79x): the sea glitter restored on darker water. Both are over the 1.25x line.
The skyline one is mine: `waterPath` is its dial.

## Round 4 (close-out on `5919deea`: shimmer only, exposure and golden lift unmoved)

Two shimmer items, both measured as LOOK_GRADE on against `--flags=-LOOK_GRADE`
in the same session (burst.sparklePct; the line is 1.25x).

1. Toward the sun (`coastal-water.js`). The r3 sun path followed each pixel's
   wave normal through a pow-30 lobe, so it broke into per-pixel points that
   aliased in motion. It now reads the flat sea's mirror ray: a band narrow in
   azimuth (pow 500 at the horizon easing to pow 70 on steep near water, as the
   wave slopes allow), running from the horizon down to about 24 deg below the
   sun's own elevation, brightest at the graze. The physical glitter from
   SEA_STATE (in both arms) still carries the sparkle. The near-water gold sheen's
   per-pixel slope term fades out with footprint (pixelM 0.06..0.30) and leaves an
   even sheen. Program key `look-grade-water-v6` -> `-v7`.
   nyc-skyline-sun__golden 0.942 off / 0.997 on (1.06x, was 1.79x);
   rio__golden 0.139 / 0.129 (both under 0.3). The path is still the brightest
   thing on the water, as a smooth gold column (grade-wip).
2. Manhattan (`hdr-grade.js`, new dial `contrastLow`). The midtone S is scaled by
   `mix(1, contrastLow, max(lowSun, twilight))`, so below about 15 deg of sun
   and at civil dusk only a share of it is applied. 0.40 read nyc-street__golden 1.065 /
   1.408 (1.32x) and dusk 1.166 / 1.475 (1.27x); 0.10 reads golden 1.061 /
   1.316 (1.24x) and dusk 1.177 / 1.420 (1.21x) (grade-wip-off2 / grade-wip2).
   The rest of the remaining rise is the golden exposure lift, toe and vibrance,
   which this step was told not to move. The frame keeps its warm key and cool
   fill. The noon S is unchanged.

## Round 5 (final audit on `5919deea`; no code change, r4 already carries the fix)

The audit's shimmer item read the tree before r4. Re-measured on `5473b06f`
(server :3315, settled, same session, burst.sparklePct, `--flags=-LOOK_GRADE`
off arm; labels grade-r5 / grade-r5-off, grade-r5-off2):
nyc-street__golden 1.068 / 1.322 (1.24x, audit head 1.518), nyc-street__dusk
1.170 / 1.427 (1.22x, audit 1.569), nyc-skyline-sun__golden 1.006 / 1.036
(1.03x, audit 1.815: the r4 sun-path band). Off arm repeat 1.072 / 1.173 / 1.012.
FACADE x GRADE pair on this head (`-LOOK_FACADE` vs `-LOOK_FACADE,-LOOK_GRADE`,
grade-r5-nof / -nofg): golden 0.621 / 0.467, dusk 1.101 / 1.008, so GRADE's part
under FACADE-off fell from the audit's 1.68x to 1.33x golden and 1.09x dusk. The
remaining all-on vs all-off rise at the street (1.32 against the audit's 0.389)
sits in FACADE (no GRADE still 1.07) and SHADOW at golden, not in GRADE.
Tried: `toeLow` 0.5 (toe share at low sun): golden 1.313, dusk 1.432, no
movement, reverted. `contrastLow` 0.10 already takes 90 % of the S off at low
sun, so the auditor's (1 - a*z) scaling is in place and stronger. Gates:
verify-look-grade 23/23, verify-true-earth-flags 8/8, eslint clean.

## Dials (`LOOK_GRADE` in fly-constants.js)

Masters: `exposure`, `fill`, `grade`, `water`, `warmth` (each 0 removes its
family, 1 = as tuned). Detail: `exposureNoon/Golden/Dusk`, `fillGolden`,
`envGolden`, `fillColor`, `groundBounce`, `keyWarmGolden`, `keyGoldGreen`,
`keyGainGolden`, `toeLift`, `contrast`, `pivot`, `shoulder`, `vibrance`,
`warmGuard`, `shadeCool`, `keyWarm`, `waterSheen`, `waterPath`; r2 adds
`contrastNoon`, `pivotNoon`, `noonBlue`, `noonGreen`, `greenSpread`, `skyDeep`,
`noonWarm`, `shoulderGolden`, `tealGuard`; the r2 revision adds `zenithLift`,
`cloudWhite`, `duskCool`, `waterNearSheen`, `waterNoon`. Round 3 adds `exposureNight`,
`meterSun`, `meterDusk`, `fillDusk`, `fillNoon`, `toeNight`, `toeDusk`, `toeNoon`,
`toeGuard`, `shadeCoolNoon`, `vibranceNoon`, `zenithDesat`. Round 4 adds `contrastLow`.

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
- r2 revision: verify-look-grade 20/20 (new: the cloud-white, zenith-lift and
  dusk-cool terms are weight-gated; weight 0 zeroes all four water lanes),
  verify-true-earth-flags 8/8, eslint clean on every changed file;
  city-water, water-field, reflection-stability, cinematic-earth,
  cinema-overhaul, cruise-color, twilight, twilight-balance,
  architectural-daylight exit 0; verify-sea-seams exit 1 with the base tree's
  FAIL list (1a, 1b, 1c, 2a, 2c).
- Not run here: a flying burst on the 5080 at nyc-street noon and nyc-cruise
  noon (the critic's request). The harness burst is a slow creep; the
  owner's motion check is the real read.

- r3: verify-look-grade 23/23 (new: golden 0.1..0.4 stop down-sun, night
  floor 0.1..0.4, into-the-sun meters down by more than 0.5 stop, dusk meters
  down, noon unmetered), verify-true-earth-flags 8/8, eslint clean on every
  changed file; city-water, water-field, reflection-stability,
  cinematic-earth, cinema-overhaul, cruise-color, twilight, twilight-balance,
  architectural-daylight exit 0; verify-sea-seams exit 1 with the base tree's
  FAIL list (1a, 1b, 1c, 2a, 2c).

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
- r3: the same `lib/fly/cinema-frame.js` line now reads
  `applyLookGradeEnvironment(e,undefined,runtime.camera)` (the metering needs
  the view direction). `earth-surface-material.js` key: `look-grade-water-v6`.

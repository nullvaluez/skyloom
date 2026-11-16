# Look Pass, stream A (ATMOS): ledger

Flag `LOOK_ATMOS` (lib/fly/fly-constants.js, last block), read only through
`lib/fly/look-atmos.js`. `?flags=-LOOK_ATMOS` is the baseline look. Desktop
High and Ultra only: `AtmosphereRig` passes `allowed = false` on Medium, Low
and phones, which zeroes the layer (`uLookAtmosA.w = 0`) and the mist floor.

Round 1 was built in two sittings: a first instance wrote the boundary layer
and the mist floor (checkpoint `f760096e`, cut off by a machine restart);
this round reviewed it, kept its model, and made it read.

## What was wrong (baseline, measured from the frames and the code)

- **No density at low altitude.** The physical aerial volume (PHYS_SKY) is
  Earth's clear air, about 0.018 /km sea-level extinction, so terrain 20 km
  out keeps about 70% of its contrast. AERIAL_CLARITY then cuts 45% of the
  in-scatter from 900 m AGL up. Powell (about 350 m AGL) had a razor horizon;
  Yosemite's 2 km and 20 km ridges had the same contrast and hue.
- **Golden hour had no luminous air.** The sky's horizon band was warm but the
  ground stopped dead under it; the far field of every golden frame was the
  same dark olive as the near field (ground third luma 19 to 30).
- **Ground mist was a dawn event.** `GROUND_MIST.time` is zero from sun
  elevation 19 degrees in the morning until 4 degrees in the evening unless the
  feed reports fog or rain, so the look-pass sun (+7 degrees afternoon, noon)
  never saw it.
- **Cruise haze is one white slab.** Most of that slab is the existing
  physical in-scatter plus the world-edge fade into the horizon sky, which
  this stream's layer only adds to; see "still weak".

## What changed (ranked by how much of the frame it moves)

1. **A hazy boundary layer inside the Enhanced aerial pass**
   (`lookAtmos()` in look-atmos.js, one anchored edit before the world fade;
   no new pass, draw or texture). Density is a slab to `topM` above the ground
   datum with an exponential top, integrated exactly along the eye-to-pixel
   ray, so from cruise only the grazing rays see a long path. Nothing inside
   `crispM` (1.5 km plus 1 m per metre of eye height) is touched, so the near
   field and the city under the aircraft stay crisp (the AERIAL_CLARITY veil
   is not brought back). The colour is the physical sky's own horizon in that
   pixel's azimuth (blue at noon, warm toward a low sun), with downward rays
   taking a higher, bluer sky row. `betaKm` 0.09 -> 0.18 this round (noon
   distance haze was still too thin at Powell), `crispRamp` 2 -> 1.7 (haze
   starts by 3 km at low altitude).
2. **The layer's sunlit scatter at golden hour.** `iso` 0.012 -> 0.035 with
   `isoDay` 0.25 -> 0.12 (noon unchanged, golden about 3x): warm key light
   scattered by the layer itself, so at golden hour the far field glows
   instead of going dark. Away from the sun the scatter is tinted rose
   (`awayTint`, new, weighted by `golden`), which over the blue sky term reads
   lavender rather than sepia. Forward lobe `lobe` 0.08 -> 0.12 (only seen
   facing the sun; no hero shot does).
3. **Opacity cap** (`maxOpacity` 0.8, new): the layer never hides more than
   80%, so distant ridges keep a silhouette (Yosemite golden had become a flat
   milky band at 0.14 density without it).
4. **Ground mist at more hours** (first instance; kept): a floor under
   GROUND_MIST's time law, a 0.3 daytime residual in basins and an evening rise
   from 16 degrees of sun to full at 3 degrees, handing back to the night
   level. `mistLevel` 1 -> 0.85 this round. Yosemite golden now has a lit
   valley-filling mist; noon has thin wisps over the valley floor.
5. **Cruise grading** (`highLift` 0.08, new): from above the layer, every
   downward ray takes a higher sky row, so the haze over the ground from
   7,000 m is blue rather than white below the horizon band. Small on screen.

## Dials (LOOK_ATMOS)

- `density` scales the layer's optical depth (all times of day).
- `glow` scales the layer's sunlit scatter (iso and lobe; golden hour look).
- `mistLevel` scales the mist floor.
- Finer: `layer.betaKm`, `layer.goldenBoost`, `layer.maxOpacity`,
  `layer.crispM`, `layer.awayTint`, `layer.highLift`.

## Tried and rejected

- `betaKm` 0.14 with `goldenBoost` 0.6: golden strong, noon still thin at
  Powell. Moved weight from the golden boost to the base density.
- No opacity cap: Yosemite golden far range became one flat band with no
  ridge silhouettes. Capped at 0.8.
- `awayTint` [1, 0.6, 0.85]: still read sepia/beige at Powell and NYC golden;
  [1, 0.45, 0.95] moves it toward lavender. The rusty-orange horizon of
  FLY_TWILIGHT_BALANCE.md is the thing this must not drift toward.
- Restructuring the cruise slab through the sky model (SkyDome / physical sky
  horizon): out of time for round 1, and the slab's brightness is the existing
  in-scatter plus world fade, not this layer.

## Gates

- `node scripts/verify-true-earth-flags.mjs`: 8 passed.
- `npx eslint` on every changed file: clean.
- `node scripts/verify-look-atmos.mjs` (new, this stream): 11 passed. Flag-off
  identity of the aerial text, single anchored insertion, throw on a repeated
  anchor, the desktop High/Ultra gate (layer off and mist floor 0 elsewhere),
  and the AerialPerspective wiring.
- `verify-ship-sky.mjs`: the checkpoint had broken SK-2 (f) (a source-text
  wiring gate on the `r25 ? enhancedFragmentShaderClarity : fragmentShader`
  selection). Fixed by keeping that selection as the fallback:
  `r25 && LOOK_TEXT_ON ? enhancedFragmentShaderLook : r25 ? enhancedFragmentShaderClarity : fragmentShader`.
  Now 47 passed, 2 failed; the two (SK-3 (l), TEXT (a)) fail identically with
  LOOK_ATMOS forced off in every leg (NODE_OPTIONS import shim that pins
  `__flyLookAtmosOverride = { enabled: false }`), so they predate this stream.
- `verify-living-ground.mjs`: 22 passed, 2 failed ((2a) phys mark, (2c) length
  diff); identical failures with LOOK_ATMOS forced off: pre-existing.
- `verify-r25-sky.mjs`: 47 passed, 2 failed ((4h), (4i): cloud composite and
  march sources against the r25-w0 tag, files this stream does not touch);
  identical with LOOK_ATMOS forced off: pre-existing.
- `verify-phys-sky.mjs` 12/0, `verify-twilight.mjs` 6/0,
  `verify-twilight-balance.mjs` 13/0, `verify-twilight-ground.mjs` all PASS.
- `verify-atmo-law.mjs` does not load in plain node (extensionless import of
  fly-constants, ERR_MODULE_NOT_FOUND), independent of this stream.

## Round 1 capture (atmos-r1 vs baseline, RTX 5080, Ultra, burst)

| shot | absDiff | changed | luma | shimmer base -> r1 |
|---|---|---|---|---|
| powell__golden | 18.0 | 48.9% | +11.2 | 0.289% -> 0.084% |
| yosemite__golden | 20.9 | 41.6% | +15.9 | 0.077% -> 0.050% |
| yosemite__noon | 13.2 | 41.9% | +7.4 (+6.7%) | 0.256% -> 0.125% |
| powell__noon | 11.9 | 35.3% | +4.0 (+3.5%) | 0.831% -> 0.407% |
| nyc-street__golden | 11.1 | 30.6% | +7.7 | 0.862% -> 0.330% |
| nyc-street__noon | 8.3 | 30.5% | +2.7 (+2.4%) | 1.999% -> 1.207% |
| nyc-harbor__night | 7.1 | 22.2% | +0.6 | 0.414% -> 0.218% |
| nyc-cruise__noon | 5.9 | 25.0% | -5.9 (-4.7%) | 0.116% -> 0.087% |

Noon luma within 12% of baseline on every noon shot (rule 7). Shimmer is at
or below baseline everywhere (the haze lowers far-field contrast). Night
sentinel unchanged by eye (density x 0.3 at night, haze colour is the night
sky). Sheet: compare/baseline__vs__atmos-r1/sheet.jpg.

## Cost

No new pass, draw call, render target or texture. Per ground pixel in the
Enhanced aerial pass (High/Ultra only): one extra `cinemaSky` evaluation (the
physical sky LUT lookup, one texture fetch) and about 40 ALU operations. Six
vec4 uniforms. Draw calls and triangles in the captures match baseline within
the streaming noise (Powell 344 calls, Yosemite 252, NYC cruise 170).

## Still weak (round 1)

- **nyc-cruise__noon** is the weakest shot: the horizon slab is still one
  white band; the layer adds a blue cast to the ground below it but does not
  give the slab a visible top. A real boundary-layer top needs the sky side
  (the horizon row the world fade melts into), which is round 2.
- Golden haze reads beige-lavender rather than clearly lavender away from the
  sun; the forward lobe is untested by the hero set (no shot faces the sun).

## Round 2 (after review: critic revise 3.3, auditor pass)

### What the review found, checked against the frames and the code

- **Cruise darkening (must fix): confirmed, cause found.** From altitude every
  downward ray took a sky row lifted by `down x downBlue x (1 + 2 hi) +
  highLift`, i.e. near the zenith, and the result was scaled by `highGain`
  0.7. The zenith row is dark blue, so mixing it over the ground subtracted
  luma (lower band -14.5). Fixed: from altitude the layer is the horizon
  row (the brightest sky) tinted blue at constant luminance (`highBlue`), so
  it can only lift and blue the ground. `highGain` and `highLift` are gone.
- **Golden horizon seam (must fix): confirmed, two causes.** (1) The hard
  clamp `T = max(exp(-tau), 1 - maxOpacity)` put every far pixel at exactly
  the 0.8 ceiling: one uniform slab with a straight top. (2) The haze colour
  was its own sky lookup 0.7 degrees above the horizon plus the warm scatter,
  so it was paler and greyer than the sky band directly above the terrain
  edge (sampled: band 152/125/92, haze top 175/152/123 at Powell golden).
  Fixed: a soft ceiling `op = cap x (1 - exp(-tau))`; the grazing rays (the
  last few degrees under the horizon, low eye only, only rays that look
  down so ridges above the eye keep their silhouette) take the aerial pass's
  own `haze` (the exact sky row behind the terrain, the one the world fade
  melts into) with a ceiling of 0.96; the layer's scatter tapers to 0 over the
  same grazing band and at the world rim.
- **Golden colour sepia (must fix): confirmed.** The away-side scatter was the
  orange key times [1, 0.45, 0.95], still orange-brown. Now the away side is
  the key's LUMINANCE times a lavender tint, and the warm key colour is kept
  only toward the sun's azimuth, where it is also brighter (`towardSun`):
  the glow has a direction. The base colour below the grazing band is the sky
  row in that azimuth, so the anti-sun side reads blue-lavender and the river
  keeps its blue.
- **Powell noon mid field (push): acted on.** `betaKm` 0.18 -> 0.2 with the
  soft ceiling 0.85, `crispRamp` 1.7 -> 1.2 (the ramp ends at 1.8 km rather
  than 2.6 km), `downBlue` 0.5 -> 0.8 (bluer at each step). The crisp radius
  itself stays 1.5 km (contract: the first 1.5 km stays crisp).
- **Cruise boundary-layer top (push): built in this stream's shader, not the
  sky.** Steep rays from altitude keep most of their clarity (x0.4 at
  steepest), the band under the white slab is the blue-tinted layer, and a
  thin brighter line (`topLine`) sits at `topLineAt` of the world fade's
  start, under the rim melt. SkyDome / sky-model were not needed: the slab is
  the ground's far field melting into `haze`, which this layer now feeds.
- **Yosemite mist (push): acted on.** New GROUND_MIST shape uniform
  (`uGMLook`, flag-on text only): the pool's scale height is x0.5 by day
  (wisps along the floor instead of a column) and x0.75 toward evening (a
  steeper height gradient), and bank edges are softer (`soft` 0.6). Noon
  strength `day` 0.3 -> 0.22, evening 1 -> 0.8 (x `mistLevel` 0.85: -20%
  on the evening floor). Night keeps GROUND_MIST's own shape.
- **Auditor non-blocking items:** all taken. Phones no longer compile the
  layer (`look = r25 && LOOK_TEXT_ON && !isMobileGraphicsClass()` picks the
  clarity text; Medium still carries the dormant branch, chosen at run time);
  the reversed `smoothstep(.3,-.6,mu)` is gone (the tint is now an azimuth
  weight); `uLookAtmosF` is fully used; AtmosphereRig's cleanup calls
  `updateLookAtmos(null, false)`.

### Dials added or changed (LOOK_ATMOS.layer / .mist)

`betaKm` 0.2, `crispPerEye` 1, `crispRamp` 1.2, `iso` 0.07, `towardSun` 1.2,
`awayTint` [1, 0.86, 1.1], `downBlue` 0.8, `highBlue` 0.6, `topLine` 0.15,
`topLineAt` 0.8, `maxOpacity` 0.85 (soft), `rimFrom` 0.45; mist `day` 0.22,
`evening` 0.8, `flatDay` 0.5, `flatEve` 0.75, `soft` 0.6. Master dials
unchanged: `density`, `glow`, `mistLevel`.

### Tried and rejected in round 2

- `crispPerEye` 0.5 then 0.9: the city under the aircraft at cruise was
  veiled pale blue (a wash, which the owner rejected with AERIAL_CLARITY).
  Back to 1, plus the steep-ray clarity term.
- Base colour from the lifted horizon row everywhere with the scatter tapered
  only at the world rim: the rim never engages at low altitude (the terrain
  horizon is well inside the world fade), so the pale strip under the orange
  band stayed. Hence the grazing band keyed on the ray angle.

### Gates (round 2)

- `verify-true-earth-flags.mjs` 8/0; `verify-look-atmos.mjs` 15/0 (new: the
  phone wiring (4a), the uniform binding (4b), the mist shape off-device and at
  night (5a, 5b), the mist text only with the flag on (5c)).
- `verify-ship-sky` 47/2, `verify-living-ground` 22/2, `verify-r25-sky` 47/2:
  the same failures as the base. Re-run with LOOK_ATMOS pinned off through a
  sticky `window` pin (the gates replace `globalThis.window`, so a plain pin
  is lost): `verify-living-ground` (2c) then reads lengths 9696 vs 9881, the
  base's exact numbers, so the flag-off text (aerial and mist) is identical.
- `verify-phys-sky` 12/0, `verify-twilight` 6/0, `verify-twilight-balance`
  13/0. eslint clean on every changed file.

### Round 2 capture (atmos-r2 vs baseline, RTX 5080, Ultra, burst)

| shot | absDiff | luma | lower / middle band luma | shimmer base -> r2 |
|---|---|---|---|---|
| yosemite__golden | 23.3 | +18.0 | +17.6 / +36.8 | 0.077% -> 0.083% (1.08x) |
| powell__golden | 18.7 | +9.8 | +2.9 / +24.7 | 0.289% -> 0.107% |
| yosemite__noon | 12.9 | +6.4 (+5.8%) | | 0.256% -> 0.142% |
| powell__noon | 12.5 | +2.9 (+2.5%) | +0.4 / +6.8 | 0.831% -> 0.398% |
| nyc-street__golden | 11.8 | +8.5 | +1.0 / +23.5 | 0.862% -> 0.328% |
| nyc-street__noon | 7.5 | +2.5 (+2.2%) | | 1.999% -> 1.132% |
| nyc-cruise__noon | 6.7 | +3.5 (+2.8%) | **+8.2** (r1: -14.5) / +2.2 | 0.116% -> 0.115% |
| nyc-harbor__night | 6.0 | +0.9 | | 0.414% -> 0.241% |

Noon luma within 12% everywhere (rule 7); shimmer within 1.25x everywhere.
Powell golden horizon, sampled at x = 150: the sky band reads 152/125/92 and
the first terrain rows 159/131/99 (r1: 175/152/123), so the step at the
edge is down from +23 to about +7 luma and the edge melts. Draw calls in this
burst run read higher than r1 on three poses (powell 344 -> 520, harbor
375 -> 537, cruise 170 -> 260) while the non-burst WIP captures of the same
code read 344 and 170: streaming state of this run (it waited 7.8 minutes
for a slot), not this stream, which adds no geometry, pass or target.

### Still weak (round 2)

- nyc-street__golden: the far city and the rivers now go to a pale
  lavender-grey (no longer tan), but the far rivers lose most of their blue
  and a faint pale strip remains under the orange band. `density` 0.85 or
  `maxOpacity` 0.75 would keep more river if the finisher wants it.
- The forward lobe and the warm toward-sun side are visible in powell__golden
  (peach left, cool right) but no hero shot faces the sun.
- nyc-cruise__noon: the ground is now lifted and blue with a band under the
  slab, but the slab itself (the sky) is unchanged; parks are a little muted
  by the blue veil at mid range.

## Round 3 (balancing inside the combined frame, base 2755f844)

### Toward the low sun (owner's ask, must, first)

Measured share first: the merged look with `?flags=-LOOK_ATMOS`
(`atmos-wip-off`) against sun-off at golden hour reads rio +58, powell-sun
+46, nyc-skyline-sun +53, yosemite-sun +36 frame luma. ATMOS's own share in
sun-merged-1 was rio +26 (middle band +48), powell-sun +10, nyc-skyline-sun
+9, yosemite-sun +26 (middle band +55). So the +30 target cannot be met from
this stream alone: most of the lift (the amber water and the lifted lower
third) is present with this flag off.

Cause in this stream, found by an extreme test (cone 89 deg, depth 0, cap 0
still left +7): the haze COLOUR, not its opacity. The layer's colour is the
sky row in the ray's own azimuth, and toward a low sun that row is the
aureole, many times the key light, so even a 10% opacity whited the mid
ground. Also the rim melt began at 0.45 of the world fade's start, which at
Rio is the 5-12 km mid ground, and inside the rim none of the cuts applied.

Fixed (new `LOOK_ATMOS.layer.sun`, uniforms `uLookAtmosG/H`): inside a cone
of 40 deg round the sun's azimuth at golden hour,
- the haze colour is the sky row 55 deg off the sun, warmed 35% toward the
  key's hue (bounded, still golden), x0.9;
- the rim melt starts at 0.85 instead of 0.45 of the fade start (the mid
  ground keeps its silhouette, the horizon still melts);
- optical depth x0.3, ceiling 0.4 (was 0.85), sunlit scatter and forward
  lobe x0.2;
- the ground mist's forward lobe keeps 35% at golden hour
  (`mist.forwardGolden`, new `uGMLook.z`; the mist text now declares vec3).
The grazing band at the horizon keeps the full sky row: the glow stays a warm
band at the horizon.

### Other items

- alps__golden hard horizontal line (critic must): **fixed, cause found.** It
  was not the layer top: it was the eye-level horizon. The grazing band was
  one-sided (only rays that look down, ramped in over 0.002 rad), so above eye
  level the layer carried its sunlit scatter and below it did not. The band
  is now symmetric about the horizon and the scatter taper is symmetric; the
  higher ceiling still applies only below, ramped over a degree. The line is
  gone in atmos-wip.
- Golden horizon slab with a straight top (must): partly. The scatter now
  tapers over 0.1 rad (was 0.06) above the ground horizon, so the far field
  converges on the sky row behind it instead of a paler grey slab. The
  straight top in the combined frames is mostly the base of LAYERS' horizon
  bank, which is not compensated for here.
- yosemite__golden mist (should): evening 0.8 -> 0.55 and the forward lobe
  cut above.
- nyc-cruise__golden cream ground (should): `highGoldenDark` 0.45 darkens the
  layer seen from altitude at golden hour; modest (lower third 147 -> 141).
- rio/nyc-harbor golden density (should): `goldenBoost` 0.3 -> 0.05 (about
  -20% at 3-10 km).
- powell__night lights (should): `nightK` 0.3 -> 0.15. Not re-checked at
  night this round.
- nyc-cruise__noon flat slab (should): declined this round (time); the slab
  is the sky's horizon row, which this layer only melts into.

### Gates (round 3)

`verify-look-atmos` 15/0 (5c now looks for `uniform vec3 uGMLook;`),
`verify-true-earth-flags` 8/0, `verify-phys-sky` 12/0, `verify-twilight` 6/0,
`verify-twilight-balance` 13/0; `verify-ship-sky` 47/2, `verify-r25-sky`
47/2, `verify-living-ground` 22/2: the same items fail on look-int
(4ef85d08). living-ground (2c) reads 9767 vs 15011 here and 9767 vs 13361 on
the base: the flag-off text is identical, the flag-on text carries the new
layer code.

### Round 3 capture (atmos-r3, burst, RTX 5080, Ultra)

Toward the sun, frame luma (middle band) and p95:

| shot | sun-off | sun-merged-1 | atmos-r3 | over sun-off | p95 |
|---|---|---|---|---|---|
| rio__golden | 82.5 (101) | 166.4 (196) | 155.4 (173) | +73 | 226 |
| nyc-cruise-sun__golden | 101.9 (141) | 164.5 (192) | 150.8 (191) | +49 | 221 |
| nyc-skyline-sun__golden | 95.2 (99) | 157.1 (171) | 151.7 (160) | +56 | 228 |
| yosemite-sun__golden | 79.0 (101) | 140.7 (194) | 128.6 (167) | +50 | 224 |
| powell-sun__golden | 84.5 (96) | 139.9 (169) | 132.4 (157) | +48 | 219 |
| rio__dusk | 31.5 | 70.5 | 64.7 | +33 | 140 |

With ATMOS off the combined frame already reads rio +58, nyc-skyline-sun
+53, powell-sun +46, yosemite-sun +36 over sun-off, so the rest of the gap
to +30 is outside this stream (water, lower third, overall grade). Hills,
skyline, Sugarloaf ridges and the rivers seen from cruise are back as
silhouettes; p95 is under 240 everywhere.

Hero shots against merged-1: powell__golden -3.5 (middle -6.8), yosemite__golden
-2.5, nyc-street__golden -1.2, noon and night unchanged within 1 luma
(harbor night +1.0).

Shimmer against baseline: every hero shot down or within 1.25x except
nyc-street__golden 0.862 -> 1.48 (merged-1 already 1.51: the facade item).
Against sun-off: powell-sun 0.287 -> 0.389 (1.36x; merged-1 0.337) and
yosemite-sun 0.149 -> 0.279 (both under 0.3): with less haze toward the sun,
more ground detail shows.

### Still weak (round 3)

- rio__golden is the weakest shot: +73 over sun-off. The mid ground now has
  ridges, but the left (sea side, just outside the cone's full weight) keeps
  a pale veil, and the amber water and lower third are not this stream's.
- The horizon slab top in powell/nyc-street/nyc-harbor golden sits on the
  LAYERS bank base; until that bank changes the edge stays visible.
- nyc-cruise__noon slab: not touched this round.

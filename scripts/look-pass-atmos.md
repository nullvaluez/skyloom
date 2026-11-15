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

## Still weak

- **nyc-cruise__noon** is the weakest shot: the horizon slab is still one
  white band; the layer adds a blue cast to the ground below it but does not
  give the slab a visible top. A real boundary-layer top needs the sky side
  (the horizon row the world fade melts into), which is round 2.
- Golden haze reads beige-lavender rather than clearly lavender away from the
  sun; the forward lobe is untested by the hero set (no shot faces the sun).

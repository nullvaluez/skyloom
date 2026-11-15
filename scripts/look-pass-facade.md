# Look Pass, stream C FACADE: ledger

Flag `LOOK_FACADE` (block at the end of `lib/fly/fly-constants.js`), read through
`lib/fly/look-facade.js`. `?flags=-LOOK_FACADE` is the pre-pass look: with the
flag off no shader text, palette constant or cache key changes
(`verify-architectural-realism.mjs` pins the flag off in its off/on/independent
arms and still checks the shipped program hashes). With the flag on, every term
is multiplied by one uniform, `uLookFacade`, which `SatBuildingLayer` sets to 1
on the High scene tier (desktop High and Ultra) and 0 on Medium/Low (phones
resolve Medium). The gate renders the flag-on program at `uLookFacade = 0` and
asserts its pixels equal the pre-pass program, day and night.

Round 1 was built in two sittings: a first instance wrote the night-window and
day-albedo terms and was cut off by a machine restart (commit `3a6de967`, kept as
is); the second sitting finished, reviewed and extended it.

## What was wrong (measured on the baseline frames)

- **Night and dusk: every building past ~1 km was a flat tan box.** The window
  emission in `satellite-architecture-material.js` replaces the lit-pane
  pattern by its area average (`opening.x*opening.y*occupancy*0.6`) once a
  window cell is subpixel (`archMinify`, 0.20-0.50 cells per pixel). That
  average is a uniform wall-sized emitter. nyc-street night: lower-half luma
  45.8 with almost all of it from evenly lit walls.
- **Day: windows vanished at the first subpixel axis.** The pane mask retired
  both axes on `max(width.x,width.y)`; oblique walls foreshorten x first, so
  floor lines disappeared together with the bays and walls became one tone.
- **Day: one grey value.** The realism palette jitters value 0.94-1.04, roofs
  share the walls' value, and curtain glass mirrored a bright lifted sky
  (`skyBias 0.18`), so glass towers read as pale grey too.
- **Golden hour: glass never flashed.** Only the GGX lobe of a dim, low key;
  no visible sun image on any glazed face.

## What changed (all in `lib/fly/look-facade.js`, anchored on the shipped text)

1. **Night: sparse lit rooms instead of a lit wall** (`night`). When windows
   minify, the glow is replaced by two coarser levels: a lit window in a 2x2
   cluster, then a lit 2x2 group in a 6-bay x 4-floor block, each box-filtered
   with `archCoverage` like the windows and retired to its own (lower) mean
   before it is subpixel. Per-building activity (0.25-1.6) gives dark and busy
   towers. Result: dark walls with discrete warm/cool points out to the
   skyline ring, which uses the same program, so near and far speak the same
   language. Second-sitting retune: L2 retires later (`minify2` 0.3-0.6 to
   0.4-0.85) and the far mean rose 0.30 to 0.45, because at 0.30 the mid-field
   towers (3-6 km) went dark enough to read as missing.
2. **Day: floor ribbons** (`day.ribbons`, new). The pane mask retires per axis;
   rows retire over 0.28-0.62 cells/pixel. Once a bay is subpixel each floor
   stays a filtered dark band (day) or lit band (night).
3. **Day: per-building value, roofs, storey bands, darker glass**
   (`day`, `day.palette`). Wall value 0.66-1.22 per building (was 0.94-1.04),
   +30% chroma of the building's own cladding (no hue swing toward brown), flat
   roofs 0.55-0.92 of the walls with filtered 7 m tar/plant patches, a
   mechanical band every 3-5 storeys on tall families. Palette: more curtain
   glass (office cuts 0.13/0.23/0.61 to 0.10/0.18/0.40), darker coated glazing,
   sky lift 0.18 to 0.08, mirror 1.85 to 2.1. The palette constants are mixed
   with the shipped ones by `uLookFacade`, so Medium keeps them.
4. **Golden hour: glint** (`glint`, new). The sun's mirror image as a 20-degree
   lobe on glazed faces (`realGlassMask`), with a stable per-building tilt,
   weighted to sun elevations of about 0-18 degrees. A flat face has one normal,
   so the term is constant across a face and cannot crawl.

## Dials (the `LOOK_FACADE` block)

- `night.strength` (0 = shipped area average, 1 = sparse rooms), `night.farMean`.
- `day.strength` (0 = pre-pass albedo), `day.ribbons.rowMinify`.
- `glint.gain` (0 = off).

## Tried and rejected

- Glint lobe 9 degrees wide, gain 3: no visible glint in any frame (golden key
  too dim, too few faces in the mirror cone). Widened to 20 degrees, gain 4.
- Night far mean 0.30 (the first sitting's value): mid-field towers read as
  missing buildings at night. Raised to 0.45 with a later L2 retire.
- First sitting overrode the CITY_FACADES palette block for every tier, which
  moved Medium pixels. Replaced by the tier-weighted GLSL swap.

## Gates

- `node scripts/verify-architectural-realism.mjs`: 12/12 (GPU arm on the 5080).
  Edited: the off/on/independent arms pin `LOOK_FACADE` off and keep asserting
  the shipped hashes (nothing loosened); a `look` arm asserts the day, night,
  ribbon and glint edits and the key suffix; the GPU arm also compiles the look
  programs, asserts `uLookFacade = 0` renders the pre-pass pixels day and night,
  and that Classic stays identical with the flag on.
- `verify-true-earth-flags` 8/8, `verify-facade-filtering` pass (168 interval
  cases), `verify-building-handoff` 4/4, `verify-building-surfaces` 6/6.
- `npx eslint` on every changed file: clean.

## Round 1 capture (`facade-r1`, burst, vs `baseline`)

| shot | changed | luma | shimmer base -> r1 (ratio) |
|---|---|---|---|
| nyc-street noon | 21.3% | -4.93 (-4.4%, rule 7 holds) | 1.999 -> 1.25 (0.63) |
| nyc-street golden | 12.2% | -1.65 | 0.862 -> 0.432 (0.50) |
| nyc-street dusk | 37.2% | -9.11 | 1.37 -> 1.657 (1.21) |
| nyc-street night | 29.7% | -9.45 | 2.223 -> 2.219 (1.00) |
| nyc-harbor noon | 10% | -0.78 | 0.594 -> 0.413 (0.70) |
| nyc-harbor night | 9.5% | -2.57 | 0.414 -> 0.285 (0.69) |
| powell golden (sentinel) | 15% | +0.07 | 0.289 -> 0.106 (0.37) |
| nyc-cruise noon (sentinel) | 5% | -0.13 | 0.116 -> 0.112 (0.97) |

Every shimmer ratio is within 1.25x; dusk (1.21) is closest to the bound.
Powell and cruise differences are cloud/water animation (no city in frame at a
scale the terms touch). Weakest shot: nyc-harbor noon, where the city sits
3-8 km out and the day terms have mostly retired to their averages.

## Cost

No new draws, passes, textures or uniforms beyond one float. ALU only: two
extra box-filtered lit-room levels in the emission, the per-axis pane retire,
a roof patch grid, and one dot-product lobe on glass. One new program key
segment (`|look-facade-v1`) per architecture program (near and far rings), on
the same prewarm path as the shipped material.

## Files outside the stream's list

None. `components/fly/SatBuildingLayer.jsx` (owned) gained one import and one
call, `setLookFacadeTier(qualityTier)`, next to the existing `setCityFacadesSky`.

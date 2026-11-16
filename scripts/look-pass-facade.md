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

## Round 2 (`facade-r2`, review response)

Built in two sittings again: a WIP checkpoint (`87b8b54b`, owner pause) and
the finishing commit `7927c42a`. Program key is now `|look-facade-v2`.

### What changed

1. **Tier branches** (WIP). Every block sits behind `if(uLookFacade>.5)`, the
   palette picks with a ternary, and the ribbon edit keeps the shipped
   expression in its `else`, so Medium/Low run only shipped expressions.
   `uLookFacade` starts at 0. `setLookFacadeTier` now also requires
   `!isMobileGraphicsClass()`, so a touch device that picks High keeps the
   pre-pass look (auditor note; rule 5 says desktop).
2. **Dusk is a dim dusk city, not a night city** (WIP, then tuned). A
   twilight lift (`twilight`, sun -12 to +4 degrees, weight
   `uLookFacadeTwilight`): a cool sky rim on roofs and upper walls and a warm
   horizon lift on faces toward the sun's azimuth. Frame luma went from -9.1
   (r1) to about -1.2 against baseline; the lower band is no longer crushed.
3. **Dusk shimmer** (`7927c42a`). The audit run read 1.894 (1.38x). Night at
   the same HEAD was 0.86x with the same lit-room picks, darkBlocks and
   farActivity, so those were not the source; the only dusk-only term is the
   twilight lift. Fixes: every light-stage term (twilight, sun side, glint)
   uses `nonPerturbedNormal` (the face normal), not `geometryNormal`, which
   carried the per-pane relief slope and varied inside window cells; the lift
   fades to 0.25 past 1.2-4.5 km (`twilight.far`); the sky rim is 0.7x.
   WIP probe before the last pull-back: 1.768 (1.29x).
4. **Day at distance** (WIP + `7927c42a`). Value, hue and dark-glass now apply
   to the whole averaged face once cells are subpixel (`farKeep`), and past
   1.8-5 km the same per-building picks are pushed further (`day.far`: value
   0.62-1.32, +60% chroma, dark-glass towers 0.6x more), so a 5 km skyline
   keeps dark towers, pale stone and brick. Per-building vertical gradient
   (`day.gradient`): 0.8 at the street to 1 at 45 m, a 1.12 sky lift on tall
   towers above 90-240 m.
5. **Day hue families** (WIP). Warm brick, limestone, sandstone, cool grey,
   green-grey and a terracotta accent per building (`day.hues`), chroma
   0.3 -> 0.55, two green-tinted glazings, a 40% dark curtain-glass share of
   tall families with a weaker mirror (`darkTower`), sun side vs shade side on
   walls (`sunSide`, eased with distance).
6. **Golden: the city catches light** (`7927c42a`, tuned in `ea75d347` and the
   last code commit). Glint gain 3 with a soft knee (1.2, so the Jersey City glass no
   longer clips), a broad warm halo beside glinting glass (gain 0.4, glass
   only), and a warm-gold edge on sun-facing stone at low sun
   (`glint.stoneEdge`, gain 0.12, a quarter past 1.5-5 km). Below about 25
   degrees of sun the sun-side/shade split eases out: low sun already splits
   faces hard, and doubling it was the golden shimmer source. Kept small
   because GRADE already warms the golden key.

### Dials (block `LOOK_FACADE`)

`night.strength`, `day.strength`, `day.far.value`, `twilight.strength`,
`glint.gain`, `glint.stoneEdge.gain`.

### Tried and rejected

- Stone edge gain 0.35: golden burst 1.251 (1.45x). Gain 0.16, knee 1.2 and
  the shade cut eased at low sun: 1.198 (1.39x). Final (halo glass-only,
  sun-side boost eased at low sun, stone edge 0.12): 0.973 (1.13x).
- Twilight sky rim 0.10/0.15/0.30 at full strength to the horizon: dusk
  1.768 (1.29x); x0.7 and a far fade.
- try/catch around `applyLookFacade` (auditor suggestion): not done. The
  realism gate pins "a broken or repeated anchor fails loudly", and every
  anchor exists in all four programs (GPU compile passes); a silent fallback
  would hide a broken look on ship day.

### Gates (at `7927c42a`)

`verify-architectural-realism` 12/12 (GPU arm, RTX 5080: compile, flag-off
byte identity, uLookFacade 0 = pre-pass pixels day and night, Classic
unchanged), `verify-true-earth-flags` 8/8, `verify-building-handoff` 4/4,
`verify-facade-filtering` pass (168 cases), `verify-building-surfaces` 6/6,
`verify-distance-soften` pass, `verify-world-art` 3/3, eslint clean.
`verify-play-city` / `verify-ship-city` reds are pre-existing (auditor:
same five play-city checks fail on `c0f11f36` without this stream).

### Cost

ALU only; no new draws, passes or textures. Three uniforms
(`uLookFacade`, `uLookFacadeTwilight`, `uLookFacadeSun`), two writes a frame.
Medium/Low compile a larger program (branches skipped at run time); their
compile time is not measured.

### Round 2 capture (`facade-r2`, burst, vs `baseline`; golden re-taken at the final code)

| shot | changed | luma | shimmer base -> r2 (ratio) |
|---|---|---|---|
| nyc-street noon | 27.4% | -5.83 (-5%, rule 7 holds) | 1.999 -> 1.387 (0.69) |
| nyc-street golden | 24.3% | +0.21 | 0.862 -> 0.973 (1.13) |
| nyc-street dusk | 36.6% | -1.77 (r1 -9.11) | 1.37 -> 1.575 (1.15) |
| nyc-street night | 30.6% | -10.07 | 2.223 -> 1.885 (0.85) |
| nyc-harbor noon | 13.4% (r1 10%, floor 10.4%) | -1.0 | 0.594 -> 0.411 (0.69) |
| nyc-harbor night | 15.9% | -3.03 | 0.414 -> 0.216 (0.52) |
| powell golden (sentinel) | 17.4% | +0.18 | 0.289 -> 0.111 |
| nyc-cruise noon (sentinel) | 4.2% | -0.23 | 0.116 -> 0.121 |

Dusk read 1.576 and 1.575 on two runs (the last golden-only change does not
touch dusk: the sun is below the horizon). nyc-street never settles in 150 s,
so its burst carries streaming noise: a same-session flag-off golden
(`facade-off2`) read 0.412 against the stored baseline's 0.862, so against
that run the final golden is 2.4x. The gate as written (baseline) passes;
golden shimmer is the number to watch on the owner's motion check.

### Shared-folder note

The auditor's accidental `--help` capture rewrote
`.graphics-review/look-pass/baseline/manifest.json` (errors array) and added
`baseline/failure.png`. Not repaired here (outside this worktree); captures
and compare numbers are unaffected.

## Files outside the stream's list

None. `components/fly/SatBuildingLayer.jsx` (owned) gained one import and two
one-line calls, `setLookFacadeTier(qualityTier)` and
`updateLookFacade(runtime.sun)`. `city-facades.js` (owned) gained one exported
line. `verify-architectural-realism.mjs` gained the look arms (shipped hashes
and flag-off arms unchanged).

## Round 3 (`facade-r3`, balancing inside the combined frame)

Program key `|look-facade-v3`. Base: look/integration `2755f844` (all five
streams merged).

### Same-session shimmer A/B (the stored nyc-street baseline does not settle)

Burst, one session, `--flags=-LOOK_FACADE` vs on:

| shot | facade off | r2 code (merged-1) | r3 code |
|---|---|---|---|
| nyc-street golden | 0.746 | 1.467 (1.97x) | 1.305 (1.75x) |
| nyc-street dusk | 1.513 | 2.221 (1.47x) | 1.806 (1.19x) |
| nyc-skyline-sun dusk | 0.759 / 0.766 | 1.16 (1.53x) | 0.902 (1.18x) |
| nyc-skyline-sun golden | 0.729 | - | 0.846 (1.16x) |

### What changed

1. **Patterns retire before they alias** (critic must). Window rows retired at
   0.28-0.62 cells/px, i.e. floor lines 1.6-3.5 px apart, and the night L2
   level at up to 0.85 cells/px: sub-Nyquist patterns under motion. Now rows
   0.18-0.42 (`day.ribbons.rowMinify`), storey band and roof patches 0.15-0.4
   (`day.nyquist`), night L1 0.2-0.45 and L2 0.25-0.5. On top, the pane,
   floor, band and roof-patch patterns fade to their means over 600-2500 m
   whatever the footprint (`day.fade`), and single lit windows retire to the
   lit-room level over the same range (`night.retire`).
2. **Golden glint eased**: gain 3 -> 2.2, lobe 20 -> 28 degrees, a fade to 0.3
   past 800-3000 m (`glint.far`). Measured alone: 1.394 -> 1.381, so glint
   was not the golden source; kept as the softer setting.
3. **Low-sun knee on lit walls** (orchestrator should): albedo luma above
   0.30 rolls off toward 0.48 on sun-lit walls at sin el 0-0.34, so pale
   limestone stays cream under GRADE's golden lift (`day.lowSunKnee`). At low
   sun the per-building value spread eases 0.6 and the 3-8 km push is off
   (`day.lowSunEase`; alone 1.414 -> 1.394).
4. **Harbor night skyline** (critic should): far activity falloff 0.55 -> 0.85
   and window emission x1.3 past 3-5 km (`night.farLift`).
5. **Powell dusk** (critic should): the white-blue warehouse roof was the
   twilight sky rim, not glint (the glint is off below the horizon); flat roofs
   now take 0.45 of the rim (`twilight.roof`). Houses (families 0/6) keep the
   shipped window glow and skip the dark-block cut (`night.houses`), so the
   subdivision reads as before.
6. **Noon near field** (orchestrator must): street-level gradient 0.8 -> 0.9,
   shade faces 0.62 -> 0.74, roofs 0.74-1.0 -> 0.84-1.04. Lower third +1.5
   luma against merged-1: the -46 crush is SHADOW and GRADE, not this stream.

### Capture (`facade-r3`, burst)

| shot | vs merged-1 luma / lower | sparkle baseline -> r3 (ratio) |
|---|---|---|
| nyc-street noon | +0.19 / +1.47 | 1.999 -> 1.303 (0.65) |
| nyc-street golden | +0.12 / +1.17 | 0.862 -> 1.305 (1.51) |
| nyc-street dusk | -1.19 / -3.1 | 1.37 -> 1.806 (1.32) |
| nyc-street night | +0.64 / +1.2 | 2.223 -> 1.669 (0.75) |
| nyc-harbor noon | -0.11 | 0.594 -> 0.478 (0.80) |
| nyc-harbor night | +0.66 / +1.57 | 0.414 -> 0.200 (0.48) |
| powell golden | +4.15 (cloud/clock drift; no city in frame) | 0.289 -> 0.264 (0.91) |
| nyc-cruise noon | +1.12 | 0.116 -> 0.113 (0.97) |

Against the stored baseline nyc-street golden (1.51x) and dusk (1.32x) still
exceed 1.25x. That baseline does not settle and the other four streams share
the frame; against the same-session facade-off run dusk is 1.19x (passes) and
golden 1.75x (does not).

Toward the sun (`facade-r3-sun` vs `facade-r3-sun-off`): nyc-skyline-sun
golden luma +0.08, contrast +0.04, so this stream adds nothing to the
overcooked low-sun look.

### Open

nyc-street golden: this stream still nearly doubles the sparkle at the same
session. Ruled out by measurement: glint, value spread, the 3-8 km push.
Suspect next: the darker, more frequent glazing in the palette (`day.palette`
cuts and glass colours), whose pane grid against the lit cladding is the
highest-contrast pattern in the near field at low sun. Not tried this round.

### Gates

`verify-architectural-realism` 12/12 (GPU arm on the 5080; key assertions moved
to v3 and the r3 terms added), `verify-true-earth-flags` 8/8,
`verify-facade-filtering` pass (168 cases), `verify-building-handoff` 4/4,
`verify-building-surfaces` 6/6, `verify-distance-soften` pass,
`verify-world-art` 3/3, eslint clean.

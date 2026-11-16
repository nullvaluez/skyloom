# Look Pass: depth, grounding and material

2026-11-14, owner-requested. This file is the plan and, once the pass closes,
the record. Scope: the Enhanced satellite look on desktop High and Ultra.

The owner's ask: a strong visual pass on atmosphere, fog density, shadowing,
layering, colour and building textures, shipped today. The owner's complaint
about earlier passes: they always end up minor. This pass is judged on
before/after frames from the owner's RTX 5080, and a change that cannot be seen
at half size on a contact sheet does not count as done.

## What the baseline shows

Baseline: 28 frames (7 poses x 4 sun elevations), `main` at `2a0c563e`, Ultra,
captured by `scripts/look-pass-capture.cjs` into
`C:\Users\bfecho\skyloom-3\.graphics-review\look-pass\baseline\`.

What already works and must survive: the sky gradient at altitude, cloud
shapes, daylight water, terrain relief and the valley shadow in Yosemite, the
landmark models, warm side-light on near buildings at golden hour, and a
stable frame.

What is weak, in order of how much of the frame it costs:

1. **Buildings have no material.** By day Manhattan is grey untextured massing:
   walls and roofs share one value, there is no glass, and window structure is
   unreadable past a few hundred metres. At dusk and night every mid and far
   building is a flat tan box, because window light averages into a wall tint.
2. **Nothing is grounded.** Sun shadows end at 3 km on Ultra and 1.8 km on High,
   so most of any city view is shadowless. Street canyons are as bright as
   roofs. Clouds cast no shadow on land or water. Trees and houses float.
3. **The air has no depth.** At low altitude the horizon is razor sharp (Powell
   has no distance haze at all). Ridges 2 km and 20 km away have the same
   contrast and hue (Yosemite). Golden hour has no luminous haze. From cruise
   the haze is one flat white band. `AERIAL_CLARITY` removes 45% of the
   in-scatter that would have provided this.
4. **The sky is one layer.** One cloud type on one deck, soft and evenly white,
   with no dark bases, no high streaks, no horizon bank. `CIRRUS` and
   `LIGHT_SHAFTS` ship off.
5. **Colour is grey by day and mud at low sun.** Frame mean luma is about 110 at
   noon, 62 to 67 at golden hour and 20 to 35 at dusk, which is darker than
   night (31 to 47). The ground third of a golden-hour frame sits at luma 19 to
   30. Shadows fall to brown-black instead of cool sky fill. Midtones are
   desaturated; open land is two greens and a tan; golden-hour water is flat
   navy with no sun path.

## The target

Every frame reads as three planes: a crisp near field, a softened middle and a
luminous far field, at every time of day. Warm key, cool fill. Light has a
direction you can point to, and things touch the ground. Golden hour is the
best-looking hour, not the dimmest.

## Streams

Five implementers, one worktree and one flag each. Two reviewers.

| Stream | Flag | Port | Worktree | Mission |
|---|---|---|---|---|
| A ATMOS | `LOOK_ATMOS` | 3311 | `look-atmos` | Air density and aerial perspective |
| B SHADOW | `LOOK_SHADOW` | 3312 | `look-shadow` | Shadow reach, occlusion, cloud shadow |
| C FACADE | `LOOK_FACADE` | 3313 | `look-facade` | Building materials, day and night |
| D LAYERS | `LOOK_LAYERS` | 3314 | `look-layers` | Cloud strata and sky layers |
| E GRADE | `LOOK_GRADE` | 3315 | `look-grade` | Exposure, tone, colour, ground and water |

Worktrees are `C:\Users\bfecho\skyloom-3\.claude\worktrees\<name>`, branches
`look/<stream>`, all cut from `look/integration` (worktree `look-int`, port
3310). Dev servers are already running on those ports; do not start or stop
one. If yours stops answering, say so in your report.

### A ATMOS

Hero shots: `powell__noon`, `powell__golden`, `yosemite__noon`,
`yosemite__golden`, `nyc-cruise__noon`, `nyc-street__golden`.

- Distance haze that starts by 3 km at low altitude and builds to the horizon.
  Terrain 15 to 25 km out should lose at least 40% of its near-field contrast
  and shift toward the sky colour: blue at noon, peach toward a low sun and
  lavender away from it.
- The first 1.5 km stays crisp. The owner has already rejected a grey veil
  over the near field once (`AERIAL_CLARITY`); depth must come with colour and
  distance, never as a uniform wash.
- Golden hour: a glowing horizon band and visible forward scatter around the
  sun's azimuth. Valley air catches light (Yosemite).
- Cruise: the haze band gets structure (a boundary-layer top, a blue ground
  tint below it) instead of one white slab.
- Ground mist that shows in more conditions than just after sunrise.

Owns: `lib/fly/atmosphere/*`, `components/fly/AerialPerspective.jsx`,
`AtmosphereRig.jsx`, `lib/fly/aerial-clarity.js`, `ground-mist.js`,
`satellite-atmosphere.js`, `atmo-law.js`, `sky-model.js`, `r25-sky.js`,
`cinema-sky.js`, `SkyDome.jsx`; constants `R25_SKY`, `AERIAL_CLARITY`,
`GROUND_MIST`, `LOOK_ATMOS`.

### B SHADOW

Hero shots: `nyc-street__noon`, `nyc-street__golden`, `nyc-harbor__noon`,
`powell__noon`, `powell__golden`, `yosemite__golden`.

- Street canyons clearly darker than roofs in every daylight city frame, out
  to at least 8 km, not just inside the cascades. Options to weigh: a far
  low-rate shadow map that includes building mass (the terrain shadow map
  already reaches far), an occlusion term from building height, a longer or
  fourth cascade.
- Cloud shadows on land and water: soft, moving, readable from every altitude.
  This is the largest single depth cue missing from open country.
- Trees and houses get a grounded contact shadow that follows the sun.
- Ambient occlusion that reads at city scale.
- Shadowed areas keep detail: strength and coverage are yours, the fill
  colour inside a shadow is stream E's.

Owns: `lib/fly/cinema-shadows.js`, `CinemaShadowRig.jsx`, `terrain-shadow.js`,
`TerrainShadowRig.jsx`, `shadow-coverage.js`, `shadow-kernel.js`,
`compact-shadow-target.js`, `cinema-ao.js`, `n8ao-direct.js`, `N8AO.jsx`,
`traffic-shadows.js`, `PlayerGroundShadow.jsx`, the shadow fields of
`cinema-profile.js`; constants `SAT_SHADOWS`, `TERRAIN_SHADOW`, `SHADOW_REACH`,
`LOOK_SHADOW`. Read cloud coverage from stream D's modules; do not edit them.

### C FACADE

Hero shots: `nyc-street__noon`, `nyc-street__golden`, `nyc-street__dusk`,
`nyc-street__night`, `nyc-harbor__noon`, `nyc-harbor__night`.

- Day: buildings differ in material and value: dark glass that reflects the
  sky, pale stone, brick, concrete. Window bands stay legible to about 2.5 km
  and then settle to an average that still shows floor structure. Roofs are a
  different value from walls and carry some detail. Sun-facing glass glints at
  golden hour.
- Dusk and night: walls go dark; windows are discrete lit cells, warm and cool,
  with per-building occupancy. At distance they resolve to sparse points of
  light, never to a flat lit wall. The skyline ring speaks the same language as
  the near ring.
- Every pattern is derivative-filtered. The owner has reported crawling,
  sparkling windows in motion before; the burst shimmer number is a hard gate
  for this stream.

Owns: `lib/fly/satellite-architecture-material.js`, `architectural-realism.js`,
`architecture-surfaces.js`, `city-facades.js`, `facade-filtering.js`,
`living-architecture.js`, `building-profiles.js`, `night-city.js`,
`city-horizon.js`, `cinematic-materials.js`, `SatBuildingLayer.jsx`,
`SatSkylineLayer.jsx`; constants `CITY_FACADES`, `BUILDING_REALISM`,
`NIGHT_RHYTHM`, `NIGHT_LITE`, `LOOK_FACADE`. Avoid changing the worker
protocol; if you must, say so first in your report.

### D LAYERS

Hero shots: `nyc-cruise__noon`, `nyc-cruise__golden`, `powell__noon`,
`powell__golden`, `alps__noon`, `rio__noon`, `nyc-harbor__golden`.

- Three sky layers in baseline weather: low cumulus with shaded flat bases and
  bright tops, a thin high layer, and a distant bank that gives the horizon a
  silhouette.
- Cloud volume: darker undersides, lit rims at low sun, more internal contrast.
- `CIRRUS` and `LIGHT_SHAFTS` ship off after a motion glitch. Bring them back
  only if stills and the burst number are clean; otherwise leave them and say
  why.
- From cruise, cloud decks at more than one altitude so height reads.

Owns: `lib/fly/living-clouds.js`, `immersive-cloud-pass.js`, `cloud-material.js`,
`cinema-cloud.js`, `cinema-cloud-bounds.js`, `cinema-cloud-volume.js`,
`cloud-reconstruction.js`, `cloud-calm.js`, `painterly-cloud-light.js`,
`light-shafts.js`, `sky-overlay-pass.js`, `CloudField.jsx`; constants
`LIVING_CLOUDS`, `FAR_CLOUDS`, `CIRRUS`, `LIGHT_SHAFTS`, `LOOK_LAYERS`.

### E GRADE

Hero shots: `powell__golden`, `nyc-harbor__golden`, `yosemite__golden`,
`nyc-street__dusk`, `powell__noon`, `nyc-harbor__noon`, `nyc-cruise__noon`.

- Exposure follows the light. Golden-hour frames land near mean luma 85 to
  105 with highlights unclipped; dusk is brighter than night, not darker.
- Warm key, cool fill: shadowed ground and walls read blue-grey next to sunlit
  ones, never brown-black.
- A tone curve with real midtone contrast and a soft shoulder. Richer greens
  and water, a less grey city, without tipping into neon.
- Ground, vegetation and water colour: more variation in open land, deeper
  vegetation, a sun path on water at low sun.

Owns: the grade and tone section of `components/fly/Effects.jsx`,
`lib/fly/hdr-grade.js`, `film-grade.js`, `cinema-environment.js`,
`cinema-art.js`, `architectural-daylight.js`, `r25-color-ref.js`,
`earth-surface-material.js`, `r25-ground.js`, `living-ground.js`,
`living-forest.js`, `cinematic-ground.js`, `coastal-water.js`,
`satellite-water.js`, `SatVegLayer.jsx`; constants `R25_GROUND`, `FILM_GRADE`,
`SEA_STATE`, `LOOK_GRADE`.

## Rules

1. **Look at pixels.** Every iteration is capture, open the PNG, decide. At
   least four capture iterations before you call a round done. Do not tune
   from code alone.
2. **Bold first.** Overshoot, look, then pull back. A reviewer will reject a
   result that needs a magnifier.
3. **Your flag gates everything you change.** `?flags=-LOOK_<STREAM>` must give
   the baseline look. Put tunables in your `LOOK_<STREAM>` block and read them
   through `lib/fly/look-<stream>.js`. Expose two to four master dials there
   (for example `density`, `strength`, `exposureGolden`) so the finishing step
   can rebalance streams by changing numbers only.
4. **Stay in your files.** Outside them, the only edit allowed is a one-line
   call into a module of your own. Never restructure `FlyScene.jsx`,
   `Effects.jsx`, `prewarm.js` or another stream's file. List every edit
   outside your files in your report.
5. **Desktop High and Ultra only.** Medium, phone and Low keep today's pixels
   and today's cost. No new full-screen pass unless your report justifies it
   with a draw-call and timing note.
6. **Shader variants.** New shader text needs a new `customProgramCacheKey`
   segment. Follow how `BUILDING_REALISM_KEY` does it, and keep variants in the
   prewarm path when the material is prewarmed.
7. **Hold the noon exposure.** Unless you are stream E, keep noon frame mean
   luma within 12% of baseline, so five streams do not compound.
8. **Gates.** `node scripts/verify-true-earth-flags.mjs` and `npx eslint` on
   your changed files must pass. Run the node gates that name your files
   (`ls scripts | grep verify-`). If a gate pins a look number you moved on
   purpose, make it assert the old value with your flag off and the new value
   with it on, and list it in your report. Never weaken a correctness gate.
   Release gates for the merged tree: `npm run verify:beta` and
   `npm run build:beta`.
9. **Commit your own files by path** on your branch. Never `git add -A`, never
   push, never touch `main`, never commit `AGENTS.md`.
10. **Known baseline noise.** Yosemite logs `window is not defined` page errors
    on `main` already. Clouds and water animate, so two runs of the same code
    differ; read `compare/baseline-a__vs__baseline/compare.json` for the floor.

## Tier test

Rule 5 has one implementation: `lookTierAllowed(profile, mobile)` in
`lib/fly/look-tier.js`. It is true only for the cinema profiles `ultra`,
`ultra-balanced`, `high` and `high-balanced`, and never on the mobile graphics
class (`isMobileGraphicsClass()`). Every stream must ask it, with the ACTIVE
cinema profile (`cinemaProfile()`), never the store's `qualityTier`: the frame
governor steps the profile's effect rungs (and Battery saver floors them) while
the store tier stays `high`, so a store-tier test left ATMOS and FACADE on at the
rungs that resolve to `medium` or `low` while SHADOW, LAYERS and GRADE were off.

Where each stream asks: GRADE `lookGradeWeight()`, SHADOW `lookProfileKey()`,
LAYERS `lookLayersProfile()`, ATMOS `updateLookAtmos(env, cinemaProfile())`
from AtmosphereRig, FACADE `setLookFacadeProfile(cinemaProfile())` once a frame
from SatBuildingLayer. Every answer drives a uniform or a CPU weight; the
flag-on shader text stays keyed on the flag and the static device class, so a
governor rung step recompiles nothing. `node scripts/verify-look-tier.mjs`
feeds every profile name, on desktop and on the mobile class, through the
predicate and through each stream's gate and asserts they agree. A new stream,
or a new gate in an old one, uses this predicate and adds itself to that gate.

## Capture

```text
node scripts/look-pass-capture.cjs --label=<stream>-wip --url=http://localhost:<port> --shots=powell__noon,powell__golden
node scripts/look-pass-capture.cjs --label=<stream>-r1 --url=http://localhost:<port> --burst --shots=<milestone set>
node scripts/look-pass-compare.cjs --a=baseline --b=<stream>-r1
```

Run them from your worktree. Output always lands under
`C:\Users\bfecho\skyloom-3\.graphics-review\look-pass\`: frames in `<label>\`,
pairs and `sheet.jpg` in `compare\baseline__vs__<label>\`. Three captures run at
once across all streams; a fourth waits its turn. Poses: `nyc-street`,
`nyc-harbor`, `nyc-cruise`, `powell`, `yosemite`, `alps`, `rio`. Times: `noon`,
`golden` (sun at +7 degrees), `dusk` (-3), `night` (-20).

Milestone set = your hero shots plus four sentinels everyone captures:
`nyc-street__noon`, `powell__golden`, `nyc-cruise__noon`, `nyc-harbor__night`.
Labels: `<stream>-wip` while iterating (overwrite it), `<stream>-r1` for the
round you hand to review, `<stream>-r2` after revision. `--burst` adds a
shimmer number (share of pixels whose luma jumps between frames while the pose
creeps forward); it must stay within 1.25x of the baseline value for that shot.

## Ledger

Each stream keeps `scripts/look-pass-<stream>.md`: what was wrong (measured),
what changed, what was tried and rejected, the dials, gates run, cost notes.

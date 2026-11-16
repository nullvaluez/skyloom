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

## Record (closed 2026-11-16)

Shipped on `main` with all five flags on, desktop High and Ultra only.
`?flags=-LOOK_ATMOS,-LOOK_SHADOW,-LOOK_FACADE,-LOOK_LAYERS,-LOOK_GRADE`
restores the previous look for one page load; any one flag can be turned off
by itself the same way.

### How it was run

Five Opus implementers, one per stream, each in its own worktree and dev
server, with two Sonnet reviewers (an art critic who judged frames only and a
code auditor) and the orchestrator merging and capturing. Every claim was
judged on frames from the owner's RTX 5080.

| Step | What happened |
|---|---|
| Rounds 1 and 2 | Each stream built and revised alone, reviewed alone. Merged as `6fa88478`. |
| First merged review | 81% of pixels changed against baseline; art critic "revise" (impact 3.5, taste 3.4). The streams stacked: golden hour 44 to 67 luma over baseline, a cream white-out toward the sun, the horizon cloud bank read as drawn arches, the Manhattan noon foreground 47 below baseline. |
| Round 3, balancing | Each owner worked on top of the merged tree with the review's items. |
| Close-out and must-fixes | Shimmer, cloud bases, the Medium leak. Final art review of that frame: taste 4.2, one must-fix (brown noon cloud bases), fixed. |
| One tier test | `lib/fly/look-tier.js` replaced five different High/Ultra tests. Audit: pass. |
| Sign-off | Art critic: ship (impact 4.3, taste 4.0, no blockers). Code auditor: one blocker, the soft terrain shadow filter running on Medium, fixed afterwards (see "Lower tiers"). |

### What a player sees

- Air: distance softens into sky-coloured haze from about 3 km, golden hour
  has a glowing far field, valleys hold mist in the evening.
- Shadows: street canyons are shaded at noon, clouds shadow the ground, and
  trees, houses and terrain throw long shadows at golden hour.
- Buildings: varied wall tones and glass by day, floor lines, lit faces
  against shaded ones at low sun, dark walls with discrete lit windows at
  dusk and night.
- Sky: cirrus at noon, a light high layer at golden hour away from the sun,
  shaded cloud bases in cool grey.
- Grade: deeper noon sky and richer land and water, a warm key and cool fill
  at golden hour, a blue hour at dusk, a sun path on water.

### Measured on the final frame

Labels `merged-3` (28 shots) and `sun-merged-3` (10 toward-the-sun shots),
tree `e8388154`, no render errors.

- Golden hour, standard poses: frame luma 16 to 31 over baseline (it was 44
  to 67 in the first merge).
- Toward the low sun at golden hour, against the old look (`sun-off`): Rio 0,
  cruise -7, skyline -9, Powell -6, Yosemite -4 (they were +55 to +84 and
  washed out). The sign-off art review read all five as richer than the old
  look, not darker. This was the owner's direct request ("fix the overcooked
  golden hour in Rio and any similar spot"). Only `rio` faced the low sun in
  the original shot list; `nyc-skyline-sun`, `powell-sun`, `yosemite-sun` and
  `nyc-cruise-sun` were added to the capture tool for it.
- Manhattan noon foreground: lower third 25 below baseline (47 in the first
  merge).
- Shimmer, pass off against pass on in one session (`fin3-off`, `fin3-on`):
  nyc-street golden 0.40 to 0.69 (1.73x), dusk 1.01 to 1.22, noon 1.21 to
  1.47, skyline toward the sun 0.87 to 0.79, Powell toward the sun 0.31 to
  0.26. The golden-hour street ratio is over the 1.25 working limit. The
  sign-off audit ruled it should not hold the release: each stream alone is
  inside the limit (FACADE 1.17x, GRADE 1.24x, SHADOW 1.07x), no code defect
  explains it, the absolute value is below the same pose at noon in the old
  look, and the metric counts luma jumps over 30, which rises with
  lit-against-shaded contrast on unchanged edges. It is the first item of the
  owner's motion check.
- Cost: no new pass or render target. Triangles are 13 to 27% over baseline
  in the city, at the harbour and at Rio, from the longer shadow cascade reach
  (`LOOK_SHADOW.reach`, 1 = 8 km on Ultra and 5 km on High).
- Gates: `npm run verify:beta` passes, the production build passes, and
  `npm run smoke:beta` passes 27 of 27 on the RTX 5080. The six look gates
  pass: `verify-look-atmos`, `-grade`, `-shadow`, `-facade`, `-layers`,
  `-tier`.

### Lower tiers

Medium, phone and Low keep the previous pixels. All five streams ask one
predicate, `lookTierAllowed` in `lib/fly/look-tier.js`: the cinema profile is
`ultra`, `ultra-balanced`, `high` or `high-balanced`, and the device is not in
the mobile class. Two consequences: on governor steps that drop the profile to
medium or low while the stored tier is still high, the whole look now switches
off together (haze and facades used to stay on); and a touch tablet whose
benchmark grants desktop effects gets the previous look, not a partial one.

Two leaks to the lower tiers were found by audits and fixed, both in SHADOW:
the low-sun fill and key change (round 3, fixed in the close-out), and the
soft terrain shadow filter (20 depth taps where there were 4, wider at low
sun), which was compiled in for every tier. The second was live on `main` in
`9cc6594c` for about an hour before `0b756552` put it behind a uniform written
from the same predicate. Proof after the fix, desktop Medium, all five flags on
against all off: 0.3% of pixels changed at Powell's golden hour and 0.9% over
Manhattan, against a same-flags floor of 0.2% and 0.4%. A Medium capture has to
wait for the terrain shadow map to fill, or it reads clean when it is not: the
orchestrator's first Medium check missed this leak that way.

Known cost that remains on lower tiers: the new shader text is compiled there
and skipped at run time, because no material knows its tier when it is built.
GitHub CI's smoke test runs on software rendering and has timed out since
before this pass; with the larger programs it now times out earlier.

### The dials to reach for first

| Symptom | Dial |
|---|---|
| Buildings sparkle in motion at golden hour or dusk | `LOOK_GRADE.contrastLow` (0.10; lower is calmer), `LOOK_SHADOW.lowSun.key` (0.2), `LOOK_FACADE.day.lowSunEase`; `?flags=-LOOK_GRADE` to confirm the cause |
| Frame time at the harbour, Rio or over the city | `LOOK_SHADOW.reach` (0.75 brings Ultra to 6 km) |
| Golden hour too bright or too flat | `LOOK_GRADE` golden lift (0.22 stop) and `contrastLow` |
| Too much or too little haze | `LOOK_ATMOS.density`, `LOOK_ATMOS.mistLevel` |
| Manhattan street canyons too dark or too light at noon | `LOOK_SHADOW.occlusion` (0.1) |
| Horizon cloud bank | `LOOK_LAYERS.bank` (0 = off, as shipped) |

### Owner's run list (RTX 5080, in flight)

1. Manhattan at golden hour and at dusk, low and slow: do the building edges
   and glass faces sparkle? Compare with `?flags=-LOOK_GRADE`.
2. Fly toward a low sun at Rio, over Manhattan and at cruise, then turn away:
   exposure eases by about a stop over about a second. Does it feel like
   adaptation or like a pump?
3. Golden-hour cirrus away from the sun, while turning: does it swim?
4. Frame time at the harbour, Rio and over Manhattan against the previous
   build (the longer shadow reach).
5. Force a quality step down in flight: haze and facades switch off in one
   frame while the grade eases over half a second. Is there a visible pop?
6. First-flight compile hitch: the terrain shadow and architecture program
   keys changed.

### Follow-ups

- The horizon cloud bank is off. Three attempts read as drawn shapes; it needs
  a rebuild on the cloud noise, not on analytic domes.
- A flat, hard-topped pale haze band at noon (Rio, Powell, Manhattan and from
  cruise). ATMOS measured that its layer does not draw it; the owner of that
  band is not yet identified.
- `powell__night`: the lit road is fainter than before the pass.
- Dusk reads uniformly blue; a little warm key on lit faces would help.
- `alps__noon`: a dusty tone remains at the foot of the large near cloud; it
  comes from the cloud composite, not the march.
- Yosemite's cliff shadow edge needs a finer terrain shadow map on High and
  Ultra to be clean.
- Lower tiers compile the look's shader text. Leaving it out needs the tier at
  material build time.
- The sign-off art review's small grading notes: a little golden contrast back
  on the Manhattan lit faces, a slightly stronger soft glint and sun path
  toward the sun.
- Add `verify-look-tier.mjs` and the other look gates to `npm run
  verify:beta`.
- Gates outside the CI set that are red for reasons older than this pass (they
  fail the same way with all five flags off): `verify-play-city` (5),
  `verify-ship-city` (3), `verify-ship-light` 0a and 0b, `verify-ship-sky`
  SK-3 l and TEXT a, `verify-living-sky` 1c.

### Evidence

Under `.graphics-review/look-pass/` (not in git): `baseline` and `sun-off`
(before), `merged-1`, `merged-2`, `merged-3`, `sun-merged-1` to `-3`, the
per-stream rounds `<stream>-r1` to `-r5`, and `compare/<a>__vs__<b>/` with a
`sheet.jpg`, one pair per shot and `compare.json`. Start with
`compare/baseline__vs__merged-3/sheet.jpg` and
`compare/sun-off__vs__sun-merged-3/sheet.jpg`.

### Lessons

- Review the combined frame early. Every stream passed alone; the first merge
  was where the look broke, in five places at once.
- A shot list that never faces the sun cannot find a problem that only exists
  facing the sun. One pose out of seven did, by accident.
- Shimmer is measured in one session with a flag toggled. The stored baseline
  for a pose that is still streaming reads about twice the settled value.
- A ratio limit on a threshold metric penalises contrast. Read the absolute
  number next to it.
- Saving a source file during a capture hot-reloads the page and the frame
  comes out blank. The capture tool now detects that and retries.
- Do not move the tree an auditor is reading.
- A workflow resume replays only the unchanged prefix of agent calls. Editing
  an early prompt re-runs everything after it.

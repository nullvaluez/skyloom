# World Pass: every place looks like itself

2026-11-16, owner-requested. This file is the plan and, once the pass closes,
the record. Scope: how the Enhanced satellite world is generated on desktop
High and Ultra: buildings, the far city, trees and ground contact. Medium, Low
and phones keep today's world.

**Status (2026-11-17): all five streams are merged and all five flags ship
`enabled:true`, at the owner's request, before their checks passed.** The
round 2 checks did not pass, and no stream has had a motion check on the
owner's RTX 5080. The owner reports that the browser freezes with the five on.
`?flags=-WORLD_<NAME>` gives the old world for one page load. Performance is
the next session's work. See "Default on (2026-11-17)". The worker's
all-off output is still byte-identical to `c2bf5c06` apart from the protocol
number (now 27).

## Why this pass exists

The owner's ask, in short: procedural generation was bolted on halfway, round
by round. Manhattan must look like Manhattan. Anywhere must look like itself.
How many buildings appear must be fixed. The real terrain stays.

Sixteen layers were added over twenty rounds. Each one decodes the same tiles
again, guesses heights its own way and drapes on the ground its own way. The
review (`.graphics-review/world-pass/review/`, not in git) measured what that
costs.

## What the review measured

Headline numbers. Each one names the report it comes from.

- **The 70 m2 floor drops 22 to 46 % of mapped buildings.** The detail ring
  draws 54 % of Tokyo's mapped footprints, 64 % of Lagos, 72 % of Paris and
  78 % of Manhattan, because one fixed floor runs after the tiles are clipped
  (`data.md` section 0).
- **Untagged heights are invented.** Outside the US north-east and Europe the
  map has footprints but almost no heights. The curve written for US downtown
  lots turns a Phoenix suburb of single-storey houses into 36 to 48 m office
  slabs. Three different functions give the same footprint three heights
  (`system.md` section 3, `data.md`).
- **The far mass keeps about 3 % of mapped buildings** (median 40 bodies per
  tile), so a city falls off a density cliff at the edge of the detail ring
  (`stream.md` S-F1).
- **Arrival is slow.** After a cold warp the first detailed building appears at
  **27 s** and the ring is full at **55 s**. At boost Manhattan arrives with
  **0 of 16** detailed tiles (`stream.md` S-F3).
- **The ground query costs 17.6 microseconds** per call on the main thread, so
  the drape lands about 57 buildings per frame (`critique-perf.md` section 0).
- **Trees are 1 to 5 % of the real canopy** (WorldCover, 900 m around six
  poses; `ground.md` G-F1).
- **Roofs never read the photo.** Roof colour is a hash into five tones
  (`form.md` F-F3).
- **Parts and tile seams split buildings.** A building part becomes its own
  building, and a building on a tile seam becomes two (`data.md`, `form.md`
  F-F8).
- **Generic bridges lie flat** on the photo (`ground.md`).
- **The budget is already red.** Settled Midtown at High: 330 draws and
  3.01 M triangles against the High row of 375 / 2.2 M; 292 MiB of geometry,
  202 MiB of it buildings (`critique-perf.md` section 0).

## Rules

Every stream obeys these. W0 exists to make each one possible.

1. **The worker cannot see `?flags=`.** "A worker has no pins"
   (`lib/fly/fly-pins.js`). Flags are resolved on the main thread and travel in
   the build request (`worldPass: worldPassRequest()`, the
   `trueAreasRequest()` / `premiumWorldRequest()` idiom). The worker never
   reads a World Pass block's `enabled`. Gate:
   `scripts/verify-true-earth-flags.mjs` (8).
2. **Tier.** World Pass content is for desktop High and Ultra. It is latched
   once per page load from the boot-resolved preset and the device class,
   never from the frame governor. `lib/fly/look-tier.js` is per-frame and is
   right only for shader uniform branches. Medium, Low, phones and tablets stay
   byte-identical.
3. **Flags off = today.** With every World Pass flag off, worker output and
   pixels are byte-identical to commit `c2bf5c06`.
4. **Buildings stand on the drawn terrain mesh**
   (`lib/fly/terrain-ground-query.js`). The terrain is Esri LERC meshed by
   three-tile, not AWS Terrarium. No stream drapes on a second DEM. (Terrarium
   differs from LERC by 59 m at p90 in Hong Kong, and the drawn mesh differs
   from raw LERC by up to 18 m at z14; `critique-feasibility.md` section 2.)
5. **Empty stays empty.** A tile with no admitted body issues no mesh (the
   Owens lock).
6. **Keep the stability work.** `FLASH_GUARD`, `CHUNK_FADE`, `HEAL_IN_PLACE`
   and the 24-slot detail/mass coverage mask keep working.
7. **No API keys, no tokened providers.**

Two more that follow from the review:

- A new look term that changes a building's identity (its colour, its
  family) is session-latched, never flipped per frame: a governor step must
  not recolour a city.
- A stream that adds triangles names Ultra or High explicitly in the budget
  table below and pays for itself there.

## Streams

Five streams follow W0, each in its own worktree, each owning files, each
behind one flag.

### A TRUTH (`WORLD_TRUTH`)

Which polygons are buildings, one building descriptor, typology, ONE height
model for the near ring, the far mass and the style classifier, the 15 to
70 m2 small-building band, later roof forms.

Owns: `lib/fly/toy-world/worker/sat-buildings/{admission,height,typology,roofs}.js`,
`lib/fly/building-profiles.js` (height and style classifier parts).

### B ARRIVAL (`WORLD_ARRIVAL`)

An O(1) exact ground query on the drawn terrain mesh, a capped drape retry,
finalize prep moved into the worker, byte-budgeted uploads, footings from
footprint corners, readiness in the view direction.

Owns: `lib/fly/toy-world/sat-building-engine.js`,
`lib/fly/terrain-ground-query.js`, `lib/fly/world-readiness.js`,
`lib/fly/toy-world/flash-guard.js`,
`lib/fly/toy-world/worker/sat-buildings/emit.js`.

### C REACH (`WORLD_REACH`)

The far city: a stand-in for every building that is still a few pixels tall,
replacing the 192-body / 1,536-triangle horizon caps.

Owns: `lib/fly/toy-world/sat-skyline-engine.js`,
`components/fly/SatSkylineLayer.jsx`, `lib/fly/city-horizon.js`,
`lib/fly/city-range.js`, `lib/fly/toy-world/worker/sat-skyline.js`.

### D LOOK (`WORLD_LOOK`)

Roof colour sampled from the Esri photo (on top of `lib/fly/r25-color-ref.js`),
wall material from tags, typology and region, building parts assembled into
structures (FableFlight `relate()`), one colour authority in the shaders.

Owns: `lib/fly/toy-world/worker/sat-buildings/{colour,structures}.js`, a new
`lib/fly/toy-world/worker/photo-sampler.js`, `lib/fly/city-facades.js`,
`lib/fly/look-facade.js`, `lib/fly/architectural-realism.js`,
`lib/fly/satellite-architecture-material.js` (colour terms).

### E GROUND (`WORLD_GROUND`)

Trees at real canopy density with impostors, bridge decks.

Owns: `lib/fly/toy-world/sat-veg-engine.js`, `components/fly/SatVegLayer.jsx`,
`lib/fly/toy-world/worker/{sat-veg,sat-roads}.js`,
`lib/fly/toy-world/sat-road-engine.js`, `components/fly/SatRoadLayer.jsx`,
LivingForest.

### Shared (orchestrator-merged only)

`lib/fly/fly-constants.js` (each stream edits only its own block),
`lib/fly/world-pass.js`, the `lib/fly/toy-world/vector-tile.worker.js`
dispatch and `WORKER_PROTOCOL`,
`lib/fly/toy-world/worker/{geom,tile-ctx,result,stages}.js`,
`lib/fly/toy-world/worker/sat-buildings/index.js`,
`lib/fly/toy-world/world-pass-stages.js`, `components/fly/FlyScene.jsx`.

## Flag registry

Five blocks at the very end of `lib/fly/fly-constants.js`, after the LOOK PASS
blocks, shipped `enabled:false` until 2026-11-17 and `enabled:true` since
(see "Default on (2026-11-17)"). Each is read ONLY through
`lib/fly/world-pass.js`. `?flags=WORLD_TRUTH` turns a stream on for one page
load (desktop High and Ultra only); `?flags=-WORLD_TRUTH` turns it off.

| flag | owner | sub-switches |
|---|---|---|
| `WORLD_TRUTH` | A | `heights`, `typology`, `smallBand`, `roofs` |
| `WORLD_ARRIVAL` | B | `fastQuery`, `drapeCap`, `workerPrep`, `uploads`, `footings`, `readiness` |
| `WORLD_REACH` | C | `standIns` |
| `WORLD_LOOK` | D | `roofPhoto`, `walls`, `structures`, `authority` |
| `WORLD_GROUND` | E | `trees`, `bridges` |

Sub-switches ship `true`: a part follows its stream flag. A stream sets one
`false` to hold back a part that is not ready. Each block also carries
`worker: {}`: the tunables the worker may read. They are copied into the
request only while the stream is on, so the worker never reads a value a pin
could change. Main-thread tunables go anywhere else in the block and are read
with `worldPassConfig(stream)`.

The device report (`lib/fly/device-report.js`) lists the five flags and the
latched state (`worldPass`).

## Contracts

### The reader: `lib/fly/world-pass.js`

```js
worldPassOn(stream, sub?)   // boolean. stream: 'truth'|'arrival'|'reach'|'look'|'ground' or 'WORLD_TRUTH'...
                            // pinned flag AND the latched tier test AND (with sub) the sub-switch.
                            // Throws on an unknown stream or switch.
worldPassTierAllowed()      // boolean, latched: !isMobileGraphicsClass() && boot preset in ['high','ultra']
worldPassRequest()          // the frozen request object below (same object every call)
worldPassKey()              // 'wp1-0' with nothing on, else 'wp1-<tier>-<switch bits base36>-<fnv1a of worker tunables>'
worldPassMatch(result)      // true unless result.wp is set and differs from the key
worldPassConfig(stream)     // the resolved block (constants + pin), frozen; no tier test
worldPassState()            // latched diagnostics or null; never latches
worldPassTierFor(preset, mobile) // the pure tier rule, for node gates
WORLD_PASS_STREAMS, WORLD_PASS_PRESETS, WORLD_PASS_TIER_PIN, WORLD_PASS_REQUEST_VERSION
__resetWorldPassLatchForTests()  // node gates only
```

**The latch.** Everything resolves on the first call: the five pins and the
tier test. The preset is the store's `qualityPreset`, which
`resolveInitialSettings()` sets before the canvas mounts and which the frame
governor never writes (it steps `qualityTier` only, `perf-governor.js`
`applyTier`). A Settings change later in the session does not move it either.
The first callers are the streaming engines, which exist only after the
canvas mounts. The latched state records the store phase it latched in.

**The tier pin.** `window.__flyWorldPassTierOverride`: `true` or `false`
forces the verdict, `{ enabled }` the same (so `?flags=WORLD_PASS_TIER` forces
it on for one load, for the owner on a tablet), and `{ preset, mobile }`
replaces the inputs so a gate drives the real rule.

### The request

Every engine that posts to `vector-tile.worker.js` adds
`worldPass: worldPassRequest()` beside `trueAreas` / `premiumWorld`:
`sat-building-engine.js` (both `buildTile` sites), `sat-skyline-engine.js`
(both), `sat-veg-engine.js`, `sat-road-engine.js`, `sat-clutter-engine.js`,
and `earth-surface-engine.js` (LivingForest's surface). `airfield-data.js`
does not: airport surfaces are not World Pass content.

```js
{ v: 1, key: 'wp1-0', any: false, tier: null,          // tier: 'high'|'ultra' while any stream is on
  truth:   { on, heights, typology, smallBand, roofs, worker },
  arrival: { on, fastQuery, drapeCap, workerPrep, uploads, footings, readiness, worker },
  reach:   { on, standIns, worker },
  look:    { on, roofPhoto, walls, structures, authority, worker },
  ground:  { on, trees, bridges, worker } }
```

A sub-switch is true only while its stream is on. `worker` is null while
off. With nothing on (every tier below High, every phone, or all five streams
explicitly disabled) the request is that exact all-off object. Desktop High
and Ultra sessions without flag overrides use all five streams by default.

**Worker side (the streams).** The worker reads only the request, through
`tileCtx.worldPass` (`worker/tile-ctx.js` is the one place that touches
`options.worldPass`), never the constants block's `enabled` or its pinned
values. With `any` false it must produce today's bytes. It MAY echo
`result.wp = options.worldPass.key` while `any` is true; every engine already
drops a result whose `wp` differs from its own key (`worldPassMatch`, beside
the `WORKER_PROTOCOL` check), so two flag arms can never mix bundles.

### Engine counters

Plain numbers on `window.__fly.satBuildings.stats` and `satSkyline.stats`
(so `scripts/look-pass-capture.cjs` `telemetry.world` records them). The
layers read `engine.stats` every frame, so the counters are published only
while `worldPassCounters()` (`lib/fly/world-pass.js`) is true: any stream on,
the stage-counter diagnostic on, or the `window.__flyWorldPassCounters = true`
pin, which the capture and budget tools set (it touches no worker). With every
stream off and no pin, `stats` and the frame loop are the `c2bf5c06` ones (no
`_wpStats` call, no `_wpTrackRing` walk). An engine reads it once, in
`setWorker`.

| key | meaning |
|---|---|
| `firstTileSec` | engine-clock seconds from the last ring arm or warp to the first detailed tile drawn (-1 = not yet) |
| `fullRingSec` | ... to every tile of the desired set resolved, ready or empty (-1 = not yet) |
| `draping` | tiles currently draping (existing key) |
| `drapeStuck` | tiles draping for more than 20 s |
| `drapeNonFiniteRestarts` | drape restarts caused by a non-finite ground sample (cumulative for the engine's life) |
| `finalizeMsMax`, `finalizeMsLast` | per-tile (per-group for the skyline) finalize ms; the max is since the last arm or warp |
| `geomBytes` | attribute + index bytes of resident chunk geometry, fading twins included |
| `wpStages` | diag only (`worldPassDiag()`): the worker's stage counters summed over resident tiles, see "Stage counters" |

### The worker: `lib/fly/toy-world/worker/`

W0-B split the satellite builders out of `vector-tile.worker.js` (5,353 lines
to 1,621) so streams own files, not line ranges. No circular imports. Each
module uses plain `function name(` declarations at column 0 and one
`export { ... }` list at the end, so the regex-based source gates can slice
it.

| module | what it holds | owner |
|---|---|---|
| `tile-ctx.js` | `createTileCtx(vt, frame, meta)`, `worldPassOf(options)`, `WORLD_PASS_OFF` | shared |
| `geom.js` | rings, clip, classify, simplify, the toy roof helpers (`pushGable`, `pushParapet`, `pushHvacBoxes`: Neon draws with them, so a new satellite form goes in `roofs.js`), the marquee discs | shared, frozen |
| `result.js` | `withReason`, `transferResult` | shared |
| `stages.js` | the opt-in stage counters (below) | shared; a stream adds its own counters |
| `sat-buildings/index.js` | `buildSatBuildings(tileCtx)`: orchestration only, in the `c2bf5c06` order | shared (smallest possible call per stream) |
| `sat-buildings/admission.js` | `admitFootprints` (pass 1 + marquee discs), `selectDetailed` | A |
| `sat-buildings/height.js` | `heightOf(item, tileCtx, 'near' \| 'far')`, both legacy rules | A |
| `sat-buildings/typology.js` | `architectureContext`, `architectureStyle`, `suburbanContext`, `pickTypology` | A |
| `sat-buildings/roofs.js` | `createRoofState`, `emitCoverageGable`, `emitRoof`, the satellite roof primitives | A |
| `sat-buildings/emit.js` | `createBuildingAccumulator`, `makePushV`, `emitBody`, `emitDetail`, `packBuildings` | B |
| `sat-buildings/colour.js` | `colourOf(item, style, tileCtx, 'near' \| 'far', hash2)`, `buildingTones`, `clutterTones` | D |
| `sat-buildings/structures.js` | `relateStructures(items, tileCtx)`: identity today, near ring only | D |
| `sat-buildings/water.js` | `buildSatWater`, `packWater` | B |
| `sat-skyline.js` | `buildSatSkyline(tileCtx)`, `fnv1aId` | C |
| `sat-veg.js` | `buildSatVeg(tileCtx)` | E |
| `sat-roads.js` | `buildSatRoads(tileCtx)`, `buildClutter`, the road helpers | E |

Left in `vector-tile.worker.js`: message dispatch (`buildTile`, `setDiag`,
`setClutterOnly`, `init`), fetch / semaphore / Cache API / in-flight
coalescing, decode, `WORKER_PROTOCOL`, the diag and clutter-only worker
globals, the Neon / toy modes, earth-surface and sat-airport.

**The build context.** `createTileCtx` returns the tile frame the worker has
always computed (spread first, so every builder reads the same values it read
off `frame`) plus `z, x, y, detail, vt, layers, extent, areaK, kA, options,
v (WORKER_PROTOCOL), diag, clutterOnly, worldPass`. `worldPass` is the
request's object when `any === true`, else the frozen `WORLD_PASS_OFF`. A
builder asks `tileCtx.worldPass.<stream>.on` and its sub-switches. Nothing
branches on it in W0. Only `tile-ctx.js` reads `options.worldPass`, and its
all-off copy must match the reader's streams (gate (8b)).

**The height and colour entry points.** `heightOf(item, tileCtx, 'near')`
reads `{ rawH, areaM2, id, polys }` and `tileCtx.suburban` (set by
`index.js` before pass 2) and returns `{ h, hash, typo, inferredHouse }`;
`'far'` reads `{ rawH, areaM2, id, hatch }` and is called twice in
`sat-skyline.js`. `colourOf(..., 'near')` returns
`{ wall, wallBase, wallTop, roofCol, parapetCol }`, `'far'` returns
`{ wall, roof }` with the haze premix. The third legacy height guess
(`building-profiles.js` `buildingClassificationHeight`, inside
`architectureStyle`) is not routed through `heightOf` yet: stream A's job.

### Stage counters (diagnostic, opt-in)

Where do a tile's buildings go? `lib/fly/toy-world/worker/stages.js`. The
counters exist only while the worker's `api.setDiag(true)` switch is on (the
R21 diag-meta idiom that gates `vegMeta`). With diag off (production, every
flag state) nothing is allocated and the payload is byte-identical. With diag
on the builder adds ONE key, `out.wpStages`, after every other key, and
changes nothing else (proved per case, see "W0 proofs").

Turn it on per page with `window.__flyWorldPassDiag = true` before the canvas
mounts, or `?flags=WORLD_PASS_DIAG`. The building and skyline engines read it
once in `setWorker` (`worldPassDiag()`), call their worker's `setDiag(true)`,
keep each tile's record, and publish the sum over resident tiles as
`satBuildings.stats.wpStages` / `satSkyline.stats.wpStages`
(`lib/fly/toy-world/world-pass-stages.js`; percentiles recomputed from summed
integer-metre histograms).

`'sat-buildings'` (units are bodies, i.e. polygons under `SAT_POLY_COVER`):
`features`, `rings`, `clipDropped` (rings under 3 points after the clip),
`windingDropped`, `polygons`, `areaFloorDropped` (the 120 normalised =
70.4 m2 true floor) and `areaFloorDropped15to70` (true area in [15, 70) m2),
`megaDropped`, `airportDropped`, `monumentDropped`, `admitted`, `detailed`,
and `height`: `mapped`, `untaggedSynth5` (OpenMapTiles' synthesized
render_height 5), `untagged`, `inferredHouse` / `inferredTypology` /
`inferredCurve`, `inferredP50` / `inferredP90`, `mappedP50` / `mappedP90`,
and the two histograms.

`'sat-skyline'`: `features`, `polygons`, `megaDropped`, `notPicked`,
`picked {tall, legacyArea, hatch, dense, horizon}`, `monumentDropped`,
`lockDropped` (the Owens lock / hatch ramp), `candidates`, `admitted`,
`bodyCapDropped` (maxPerChunk or the horizon `maxBodies`),
`triangleCapDropped` and `reserveDropped` (polygons skipped by the horizon
triangle budget and its neighbourhood reserve), `degenerateDropped`,
`emittedPolygons`, `emittedTriangles`.

One centre z14 tile each, Enhanced, from the node proof:

| tile | polygons | clip | floor (15-70 m2) | admitted | mapped / synth-5 / untagged | inferred house / typo / curve | inferred p50 / p90 (m) |
|---|---|---|---|---|---|---|---|
| midtown 14/4824/6157 | 4,290 | 305 | 949 (595) | 3,330 | 3,237 / 93 / 0 | 16 / 0 / 77 | 19 / 35 |
| paris 14/8299/5636 | 4,486 | 318 | 918 (568) | 3,568 | 2,201 / 1,366 / 1 | 177 / 0 / 1,190 | 19 / 27 |
| tokyo 14/14552/6451 | 1,315 | 167 | 403 (318) | 912 | 274 / 638 / 0 | 209 / 0 / 429 | 17 / 28 |
| lagos 14/8346/7897 | 4,099 | 165 | 723 (645) | 3,376 | 1,293 / 2,083 / 0 | 690 / 0 / 1,393 | 16 / 22 |
| phoenix-suburb 14/3102/6578 | 1,252 | 54 | 48 (42) | 1,204 | 90 / 1,114 / 0 | 44 / 0 / 1,070 | 19 / 31 |
| powell 14/4411/6193 | 173 | 8 | 17 (14) | 156 | 2 / 154 / 0 | 28 / 126 / 0 | 7 / 9 |
| owens 14/2817/6399 | 1 | 0 | 0 | 1 | 0 / 1 / 0 | 0 / 1 / 0 | 8 / 8 |

| tile (skyline, Enhanced High) | picked tall / hatch / dense / horizon | candidates | admitted | body cap | triangle cap | emitted polygons / triangles |
|---|---|---|---|---|---|---|
| midtown | 1,858 / 229 / 585 / 1,416 | 4,077 | 192 | 3,885 | 76 (+30 reserve) | 80 / 1,530 |
| paris | 40 / 569 / 1,385 / 958 | 2,952 | 192 | 2,760 | 163 (+3) | 22 / 1,534 |
| tokyo | 154 / 158 / 67 / 62 | 441 | 192 | 249 | 82 (+24) | 85 / 1,533 |
| lagos | 38 / 271 / 28 / 924 | 1,261 | 192 | 1,069 | 127 | 65 / 1,531 |
| phoenix-suburb | 0 / 248 / 0 / 8 | 248 | 192 | 56 | 0 (+179 reserve) | 13 / 1,206 |
| powell | 0 / 20 / 0 / 0 (lock took all 20) | 0 | 0 | 0 | 0 | 0 / 0 (empty: no mesh) |
| owens | 0 / 0 / 0 / 0 | 0 | 0 | 0 | 0 | 0 / 0 (empty: no mesh) |

Read with the review's numbers: 1,070 of Phoenix's 1,204 bodies take the
legacy sqrt-area curve, at a 19 m median; and the High horizon admits its 192
bodies but emits only 13 to 85 polygons per tile, because the 1,536-triangle
budget (and its neighbourhood reserve) binds first. The caps, not admission,
decide what the horizon draws.

### Protocol 25 (26 since wave 1)

W0 bumps `WORKER_PROTOCOL` 24 to 25 once for the whole pass, at all ten pin
sites in lockstep: `vector-tile.worker.js`; `EXPECTED_WORKER_PROTOCOL` in the
`sat-building`, `sat-clutter`, `sat-road`, `sat-skyline`, `sat-veg` and
`toy-world` engines; `STYLIZED_EARTH.protocol` in `lib/fly/stylized-earth.js`
(the earth-surface engine's own check, missed by the review's count of nine);
and the literal regexes in `scripts/graphics-unit.mjs` and
`scripts/verify-stylized-earth.mjs`. `scripts/verify-city-horizon.mjs` reads
the number from source. A stream that changes a payload under its flag does
NOT bump it again: the flag-off payload is unchanged, and a flag-on bundle
carries `wp` (see the request contract). The wave 1 merge bumped it once more,
25 to 26, at the same ten sites, so a worker bundle from before the merge is
dropped. The wave 2 merge bumped it again, 26 to 27, at the same ten
sites.

### W0 proofs

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06` builds 1,062
  cases (14 places; every satellite mode with the live High/Ultra Enhanced
  options and Medium/Low/Classic/no-visuals variants; the all-off request;
  toy and earth-surface; a 14-patch revert matrix) from recorded inputs and
  compares every output buffer (SHA-256) and the canonical JSON of the rest
  against fingerprints of a `git archive c2bf5c06` export. Add
  `--ignore-protocol` to mask the top-level `v` of every result (only that
  field) and print the protocol pairs instead; `--only <substr>` for a
  subset. It also builds 28 `+stages` cases (7 places x buildings Enhanced /
  no-visuals x skyline High / Classic) with diag on and requires each, minus
  `wpStages`, to equal its diag-off sibling byte for byte.
  Result at W0 close: with `--ignore-protocol`, 1,062 / 1,062 identical
  (7,308 buffers; protocol pairs `24->25` x 1,062) and 28 / 28 stage cases
  equal to their siblings; without it, all 1,062 differ in the top-level
  `v` only (0 buffer differences). Before the protocol bump the same check
  was 1,062 / 1,062 identical with nothing masked.
- `node scripts/world-pass-worker-live.cjs [--quality high]`: the webpack
  worker bundle loads and streams on :3320.
- Browser, RTX 5080, :3320, Ultra (`scripts/look-pass-capture.cjs`, poses from
  `scripts/world-pass-poses.json`, labels `w0-off` and `w0-allon` under
  `.graphics-review/world-pass/w0/`), compared with the orchestrator's
  pre-W0 `base-1` / `base-3` by `scripts/world-pass-telemetry-compare.cjs`:
  nyc-low noon and phoenix-suburb noon settle with 16 / 16 building tiles and
  the SAME collision columns in all three arms (49,211 and 35,350), skyline
  ready 24 / 22 with identical triangles and vertices (478,464 / 851,542;
  365,964 / 638,963), FLASH_GUARD per-pose work identical (cumulative counters
  differ only because base-3 shot phoenix first). Draws and triangles breathe
  by 1 to 3 % (nyc 378 / 385 / 385 calls). `w0-allon` is the page with all
  five flags on: it streams the same bodies, as it must while nothing
  branches. The nyc lower third reads about 6 luma darker than `base-1` in
  both W0 arms; the clouds sit visibly elsewhere in that frame, so it is read
  as cloud and cloud-shadow placement, not proven.
- `node scripts/world-pass-tier-proof.cjs --arms=off,all,medium,diag`: every
  build request the page posts carries the latched request; with
  `?flags=WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK,WORLD_GROUND` at
  Ultra every request has all five streams on (key `wp1-ultra-2hwcf-0fd37c88`);
  Medium stays `wp1-0`; `?flags=WORLD_PASS_DIAG` publishes `wpStages` on both
  engines.

Gates W0 had to touch, and reds that were already there:

- `scripts/verify-lounge-occlusion.mjs` called `buildSatBuildings(vt, frame)`,
  the pre-split signature; it now builds the context with `createTileCtx`
  (6 / 6, as on `c2bf5c06`).
- The source gates listed above read `readWorkerSource()`.
- Already red on `c2bf5c06` (run from the main checkout, which sits at that
  commit) and unchanged: `scripts/verify-ship-city.mjs` CT-2 (worker vs the
  ship-pass base: six midtown skyline tiles differ) and CT-5 x2 (architecture
  programs and NIGHT_LIGHTS text vs that base), 46 / 49 both before and after;
  `scripts/verify-night-city-identity.mjs` dies in its module loader on
  Windows (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, protocol `c:`) before any gate.
- Browser harnesses with edited source halves, run once on :3320
  (`FLY_URL=http://localhost:3320`): `verify-neon-cover` PASS (all, browser
  legs included). `verify-parcel-homes`: every source gate (I) PASS, browser
  legs (C) x2, (D) and (F) suppression FAIL (homes placed over mapped towns:
  Powell 372, Lone Pine 16). `verify-icons`: source B1 to B8 PASS, three toy
  browser legs FAIL (11 landmark meshes, +2.5 draws, F2) and then a 180 s
  timeout. NOT proven pre-existing: no `c2bf5c06` server can be started here.
  What those legs read is proven unchanged: the Neon/toy and sat-veg worker
  bytes (the proof's toy and sat-veg cases, the `parcel-off` and
  `monuments-off` matrix rows) and the building collision columns (identical
  in the capture compare above).
- `node scripts/world-pass-worker-source.cjs`: the source halves of
  verify-icons B5/B6, verify-neon-cover 1/2/3a/4a and verify-parcel-homes (I)
  on the worker file alone and on `readWorkerSource()`. Those three scripts
  and `verify-night-city-identity` (10) now read `readWorkerSource()`.

### Tools

- `scripts/world-pass-budget.cjs`: per pose draws, triangles, building /
  horizon / veg geometry MiB, JS heap, the arrival counters and getGroundAt
  microseconds. Same GPU slot lock and boot path as
  `scripts/look-pass-capture.cjs`. `--url --pose --posefile --quality --flags
  --out`.
- `scripts/world-pass-tier-proof.cjs`: boots the page per arm (off, Ultra,
  High, Medium, emulated iPhone) and checks the latched state and the
  `worldPass` field the engines actually post, including after a governor
  tier step.
- `scripts/verify-true-earth-flags.mjs` (8) one reader per World Pass block,
  never named in the worker; (8b) the worker's all-off request matches the
  reader's streams and only `tile-ctx.js` reads `options.worldPass`; (9) the
  reader's tier rule and latch in node.

## Budget

Baseline, all flags off, Ultra, 1600 x 900, noon + 2 h, one page warped from
pose to pose (`scripts/world-pass-budget.cjs`, RTX 5080, installed Chrome,
D3D11, live world). JSON: `.graphics-review/world-pass/budget/base/`.
Arrival seconds are measured from the warp in a warm page, not a cold boot.
Two runs; the second is the table, the first in brackets where it moved. Draw
counts breathe with CHUNK_FADE twins and settling layers (nyc-low 385 / 536,
powell 356 / 538 between runs), so compare draws across arms only from
several runs.

| pose | draws | triangles (M) | building MiB | horizon MiB | veg / other MiB | geometry MiB total | JS heap MiB | first detailed tile (s) | full ring (s) | horizon first / full (s) | stuck tiles (bld / hzn) | finalize max (ms) | getGroundAt (us) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nyc-low | 536 (385) | 4.84 (4.52) | 209.9 | 47.4 | 0.1 / 38.5 | 308.2 | 777 | 21.4 | 57.4 (54.5) | 9.6 / 26.0 | 0 / 0 | 146.2 | 18.1 (16.9) |
| paris | 383 | 6.42 | 320.5 | 49.1 | 0.1 / 36.8 | 413.7 | 1129 | 12.1 (8.4) | 52.6 (44.4) | 5.2 / 15.4 | 0 / 0 | 124.6 | 19.1 (16.8) |
| tokyo | 401 | 4.89 | 216.3 | 48.0 | 0.1 / 36.1 | 310.9 | 799 | 10.3 (12.9) | 51.2 | 4.4 / 15.0 | 0 / 0 | 99.2 | 18.6 |
| phoenix-suburb | 369 | 2.71 | 168.4 | 35.6 | 0.1 / 32.2 | 250.6 | 900 | 7.0 | 32.9 (31.1) | 4.5 / 13.2 | 0 / 0 | 72.9 | 20.5 (19.6) |
| powell | 538 (356) | 1.12 (0.90) | 25.4 | 9.4 | 0.6 / 32.2 | 76.1 | 602 | 5.2 | 13.8 | 4.0 / 10.5 | 0 / 0 | 40.5 | 19.1 |

Triangles drawn by layer, second run (thousands): nyc-low buildings 1,700,
horizon 478, terrain 193; paris buildings 2,718, horizon 507; tokyo buildings
1,738, horizon 479; phoenix-suburb buildings 1,367, horizon 366; powell
buildings 227, horizon 96, veg 159.

What the table says before any stream lands:

- Ultra's row in `lib/fly/tier-budgets.js` is 900 draws, 8 M triangles and
  256 MiB of geometry. Every pose is inside the draw and triangle rows. All
  geometry is over 256 MiB at Manhattan (308), Tokyo (311) and Paris (414);
  Paris is over with buildings alone (321). Every stream that adds buildings, roof geometry or resident
  levels needs C-2 (packed vertices, released CPU copies; `critique-perf.md`)
  or pays for itself first.
- A full Manhattan ring takes 54 to 57 s after a warp; Powell 14 s. The ground
  query is 17 to 21 microseconds everywhere, so the drape rate, not the
  network, sets the city ring's arrival.
- No tile was stuck draping for 20 s at any pose. Non-finite drape restarts
  ran 3 (Manhattan) to 22 (Powell, cumulative 36 minus 14) per warp.
- "veg" here is only the SatVegLayer tree; LivingForest and the other ground
  layers sit in "other" (32 to 39 MiB).

## Open after W0

- The latch is taken at the first call. Every caller today is a canvas-mounted
  engine (latched phase `flying` in every proof arm); a future caller that
  runs before the canvas mounts would latch the store default. Nothing guards
  it but `worldPassState().latchedPhase`.
- The tier test excludes the whole mobile graphics class (phones and
  tablets); an iPad can be forced on with `?flags=WORLD_PASS_TIER`.
- `buildingClassificationHeight` (the third height guess) is still outside
  `heightOf`; stream A routes it.
- The new tools and (8)/(8b)/(9) run in `verify:source` (through
  verify-true-earth-flags); the worker proof, tier proof, budget and
  telemetry compare are not in CI (they need recorded inputs or the GPU).
- The browser building harnesses (`verify-sat-buildings`, `-skyline`,
  `-suburbia`, `-roof-variety`, `-veg`, `-seam`, `-stability`) were not run
  in W0; their worker output is covered by the byte proof.
- The "veg" budget bucket covers SatVegLayer only; stream E wants its own.

## Ledger

### A TRUTH

`scripts/world-pass-ledger-truth.md` (merged in wave 1).

### B ARRIVAL

`scripts/world-pass-ledger-arrival.md` (merged in wave 1).

### C REACH

`scripts/world-pass-ledger-reach.md` (merged in wave 1).

### D LOOK

`scripts/world-pass-ledger-look.md` (merged in wave 1).

### E GROUND

Not merged yet (branch `world/ground`).

## Wave 1 record

2026-11-16. Four streams merged into `phresh/mystifying-curran-97a006` by
exact commit, `git merge --no-ff`, in this order: A TRUTH `f1aa4967`
(merge `e85b627c`), D LOOK `fbfa3ae3` (`bd68cf2f`), B ARRIVAL `1808ab92`
(`2997d288`), C REACH `1ca67e45` (`a059fdc1`). E GROUND is not merged. All
four merged with no conflict: each stream edited only its own `WORLD_<NAME>`
block of `fly-constants.js`, and LOOK and ARRIVAL edit different marked seams
of `vector-tile.worker.js` (`// WORLD PASS D` and `// WORLD PASS B`). Every
flag still ships `enabled:false`. Nothing is on `main`.

### Seams wired at the merge

Only what the four flags need to run together (commit `61808488`, both in
`worker/sat-skyline-stand-ins.js`, both inert with the other stream off):

- **TRUTH x REACH.** The stand-in passed `sid` as the id to `heightOf`, but
  the truth table is keyed by the admission's polygon id. With both on, every
  untagged stand-in missed the table and fell back to the old far rule. It
  now passes the polygon id and keeps `sid` for its hashes, so with TRUTH on a
  stand-in gets the near ring's height (this meets C's request to A for
  untagged buildings).
- **LOOK x REACH.** With `look.authority` on, the far wall carries the glass
  (+4) or opaque (+8) offset in its red channel. The stand-in packs walls to
  sRGB bytes, so a tagged wall saturated to full red. It now decodes with
  `lookWallMode` first (the stand-in has no glass mode).

Checked and needing nothing: only ARRIVAL stamps `result.wp` (one wrapper
around `buildTile`); ARRIVAL's Uint8 colour packing returns null and keeps
Float32 when a LOOK glass offset puts a value over 1; LOOK does not touch
REACH's three shader anchors; the truth table is cached on `tileCtx`, so the
skyline worker builds it once per tile for admission and heights.

Also: `WORKER_PROTOCOL` 25 to 26 at all ten sites (`e57657b3`; grep finds no
others), and `scripts/wp-reach-node-bench.mjs` G5 now masks ARRIVAL's `wp`
stamp (`20802cff`; before that every G5 case failed on the stamp alone).

### Proofs on the merged tree

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`:
  "IDENTICAL (top-level protocol field masked): 1062/1062 cases identical,
  7308 buffers + 1062 meta objects compared against 'c2bf5c06'; 28 stage
  cases (0 bad); 0 unrecorded inputs". Protocol pairs `24->26` x 1,062.
- Node gates PASS: `graphics-unit.mjs`, `verify-true-earth-flags` (11),
  `verify-stylized-earth` (22), `verify-city-horizon`,
  `verify-building-handoff` (4), `verify-attribution` (4).
- Stream probes PASS and reproduce their ledgers' numbers exactly:
  `wp-truth-probe.mjs`, `wp-look-roofphoto.mjs`, `wp-look-structures.mjs`,
  `wp-look-shader.mjs` (17), `wp-arrival-worker-prep.mjs`,
  `wp-reach-node-bench.mjs` (G1 to G5).
- `npx eslint` on the 107 JS files changed since `c2bf5c06`: one error,
  `SatSkylineLayer.jsx` react-hooks/immutability at line 81, the same error
  at `c2bf5c06`. No new errors.
- Not run on the merged tree: any browser run (budget, captures, tier proof,
  the building harnesses) and the owner's 5080 motion check. The browser
  numbers below are each stream's own, on its own branch.

### A TRUTH (`WORLD_TRUTH`)

What it does: one fact table per z14 tile (areas, shape, shared corners, land
use, local cover, a cross-tile `sid`, a class: shed, house, terrace,
apartment, block, commercial, civic, industrial, bigbox), and one height law
for the near ring, the far mass and the style classifier. Mapped heights are
kept. Unmapped: class-matched mapped evidence from the same tile, else a
regional prior, quantised to storeys, capped at 24 m. Seam fragments of a
building that clears the 70 m2 floor are kept. Sub-switches: `heights`,
`typology`, `smallBand` (today only the seam-fragment rescue; the lean 15 to
70 m2 band is not built), `roofs` (marks items; the new roof forms are not
built). Nothing ported from FableFlight.

Numbers (node, 3 x 3 tiles per place; probe and ledger agree):

- Hold-out on mapped heights up to 24 m, median abs error, law against
  legacy: NYC 2.5 / 5.4 m, Brooklyn 1.7 / 5.3, Paris 2.5 / 4.9, London 3.5 /
  6.2, Tokyo 5.3 / 6.3, Phoenix suburb 0.6 / 13.9, Lagos 3.8 / 7.3, Dubai
  3.3 / 15.0.
- Unmapped heights p50 / p90: Phoenix suburb 3.6 / 6.6 m (legacy 18.9 /
  23.8), Paris 21.5 / 24 (legacy 20.0 / 28.4), Tokyo 9.6 / 21.6, Lagos
  6.5 / 9.7.
- Far = near height for every unmapped far-hatch candidate (100 %, legacy
  0 %). Seam halves with the same `sid` agree on 63 to 97 % of pairs (legacy
  0 to 6 %); see the verifier's finding below.
- Admitted share up about one point (seam fragments). Empty tiles stay
  empty (Owens, Iowa).
- No new geometry: Ultra building MiB falls or holds (Phoenix 168 to 137,
  Paris 321 to 312). Worker cost +25 to +37 ms per near tile.

### D LOOK (`WORLD_LOOK`)

What it does: roof colour read from the Esri photo under each footprint
(16 z16 tiles and 1 z11 per near tile, fetched in the worker in parallel with
the vector tile, at most 2.5 s wait), with a structure mate's or the block's
median read as fallbacks before the typology palette; wall material from the
tag colour (glass or opaque) or a regional palette by typology group;
building parts grouped into structures that share one look; and the
architecture shader taking the worker colour as the albedo, session-latched.
Sub-switches: `roofPhoto`, `walls`, `structures`, `authority`. Ported:
FableFlight's trimmed-mean roof colour.

Numbers (node, one centre tile; probe and ledger agree): share of roofs from
the photo 48 % Midtown, 97 % Brooklyn, 71 % Paris, 83 % London, 65 % Tokyo,
82 % Phoenix. Roof colour error against the photo (CIELAB dE, mean), today's
shader against the look: Midtown 25.0 / 16.9, Brooklyn 28.2 / 8.2, Paris
21.6 / 8.0, London 22.3 / 6.2, Tokyo 23.7 / 16.3, Phoenix 29.5 / 7.6.
Part piles 214 to 0 at Midtown; seam twins split 13 / 27 to 2 / 27. No new
geometry or draws. The live shares are lower; see the verifier's finding
below.

### B ARRIVAL (`WORLD_ARRIVAL`)

What it does: an exact batched ground query on the drawn terrain mesh (same
answer as the reference on 1,000,000 points); a capped drape; finalize prep
moved into the worker (degenerate triangles dropped, vertices compacted, runs,
regions and footing data, Int8 normals and Uint8 colours); a 24 MiB per-frame
upload budget; two building workers; footings from the footprint's lowest
corners; readiness weighted to the view direction; the `result.wp` stamp.
Sub-switches: `fastQuery`, `drapeCap`, `workerPrep`, `uploads`, `footings`,
`readiness`. Ported: FableFlight's upload byte budget and lowest-ground seat.

Numbers: worker prep PASS on nine places, bundle bytes 98.0 to 63.0 MiB
(-35.7 %), same triangles minus the degenerate ones (node, re-run on the
merged tree). Stream ledger only, Ultra, single runs on a shared machine:
building MiB -34 to -36 %, full ring 36 to 9 s at nyc-low and 43 to 13 s at
Paris, worst finalize work in a frame 4 to 10 ms (was 89 to 122 ms per tile),
boost into Midtown arrives with 13 to 15 of 16 tiles (was 0 or 1). These are
not yet confirmed by the ARRIVAL verifier.

### C REACH (`WORLD_REACH`)

What it does: replaces the capped horizon mass with one instanced
oriented-box stand-in per admitted building (same admission as the near
ring, heights from `heightOf`, colours from `colourOf`), drawn per group by
screen size down to `minPx` 0.8 with a dither fade, under a tier triangle
budget (Ultra 1.5 M, High 0.8 M). Same draws, same groups; CHUNK_FADE and
the coverage mask kept. Sub-switch: `standIns`. Ported: FableFlight's
distance-scaled draw prefix and far rectangle fit.

Numbers: node, 33,030 stand-ins against 729 old horizon bodies on 20 tiles
(45x); Owens, Iowa and farmland stay empty. Stream ledger, Ultra: horizon
geometry 47 to 17 MiB at nyc-low and 49 to 5 MiB at Paris, 8 k to 250 k
buildings drawn, draws unchanged.

### Open after wave 1

Verifier findings, not fixed:

- **LOOK.** Live, only 25 to 54 % of roofs get a photo read (whole tiles get
  none), which leaves a tile-scale patchwork of roofs. Tiles without a photo
  look worse than today in Brooklyn, Paris and Phoenix. San Francisco falls
  to a brick region palette. Hong Kong towers go dark.
- **REACH.** The stand-in triangle cap is exceeded near water, because the
  coastal reflection draws the stand-ins again. Far-ring first arrival is
  later than today. The Paris far ring uses a bright multi-colour palette
  that hides the boulevard pattern.
- **TRUTH.** Seam halves agree less than the ledger claims once pairs with
  different ids are counted. Powell, Ohio two-storey houses become
  one-storey. Large unmapped footprints in dense centres drop to 6 to 8 m
  sheds.
- **ARRIVAL.** Its verifier is still running.
- **GROUND.** Not merged.

Also open:

- No browser run of any kind on the merged tree, and none with more than one
  flag on. The two merge seams are proven only by reading the code and by
  the node gates.
- The owner's 5080 motion check, for every stream.
- Each ledger's own "Open" list stands.

Round 2 (asked by one stream of another, not wired at the merge):

- A to C: set `it.sid` on the legacy far mass items (`sat-skyline.js`).
- A to the merge: derive `hash2` in `sat-buildings/index.js` from
  `item.sid ?? item.id`, so both halves of a seam building get one tone.
- A to B: a lean body buffer for the 15 to 70 m2 small band (about 20 bytes
  a vertex, or one instanced box per body), drawn in the colour pass and
  shadow cascade 0, kept out of emptiness and collision columns.
- B to C: wrap the skyline engine's ground loops in `beginGroundBatch()` /
  `endGroundBatch()` (today they run the reference query).
- B to A: keep an existing bounding box in `installArchitectureShadowRange`,
  and keep `partitionArchitectureIndex` and `emit.js partitionBody` in step
  (or share one module).
- B to A and D: new emitters keep each building's vertices consecutive under
  one anchor; a CPU-side colour pass writes in the packed Uint8 range.
- C to A: once the far height matches the near model for every stand-in, set
  `WORLD_REACH.worker.houseMaxAreaM2` to 0 (Paris and Tokyo gain their
  small-parcel fabric).
- C and D: a photo-sampled far roof colour (removes the far "confetti");
  call `relateStructures` for the far ring; keep REACH's three shader
  anchors (`#include <common>`, `void main() {`, `float skyA = uSkyFade;`).
- D to A: carry the feature id and its polygon count on the item, so the look
  can prefer the OSM id for single-polygon features.

## Wave 2 record

2026-11-17. The owner asked for all five streams on the integration branch
with every flag OFF, so each can be flown with `?flags=`. Merged into
`phresh/mystifying-curran-97a006` by exact commit, `git merge --no-ff`, in
this order: A TRUTH `d774900a` (merge `0c3c8a2e`), D LOOK `14b50cee`
(`0fdf7a14`), B ARRIVAL `237dfef8` (`788a7419`), C REACH `bd10d10c`
(`ff6e21d8`), E GROUND `0a8f3041` (`a2d0a620`). GROUND is merged for the
first time. Every flag still ships `enabled:false`. Nothing is on `main`:
`main` still has the four wave 1 streams at `d40dfd25`.

URL arms (one page load each):

- one stream: `?flags=WORLD_TRUTH`, `?flags=WORLD_ARRIVAL`,
  `?flags=WORLD_REACH`, `?flags=WORLD_LOOK`, `?flags=WORLD_GROUND`
- all five: `?flags=WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK,WORLD_GROUND`

### Conflicts and seams at the merge

Two textual conflicts, both resolved by keeping both sides:

- `sat-building-engine.js` imports: LOOK's `requestLookRoofPatch` and
  ARRIVAL's `wp-frame-slice` import.
- `worker/sat-skyline-stand-ins.js`, the far colour call: REACH's one
  adapter `farLookColour(...)` (which is `colourOf(..., 'far')`, and that now
  calls LOOK's `lookFarColour`), keeping LOOK's `farMode` (the wall material
  rides the family byte).

Already wired by the streams themselves (each merged the earlier ones
first), checked and needing no edit:

- `result.wp`: only ARRIVAL's wrapper stamps it, for every detail, so
  GROUND's 'sat-veg' and 'sat-roads' bundles carry it too.
- LOOK's late roof patch writes in ARRIVAL's packed Uint8 colour range and
  on its compacted vertices (`wp-look-patch.mjs` arms with workerPrep).
- One finalize allowance a frame for ARRIVAL's slices and REACH's stand-in
  group finalize (`wp-frame-slice.js`, `// WORLD PASS B x C seam`).
- REACH's and GROUND's ground loops run inside ARRIVAL's
  `beginGroundBatch()` / `endGroundBatch()`.
- GROUND's wider vegetation ring is its own: the legacy ring every other
  consumer reads (`engine.legacy`) is computed exactly as with the flag off,
  and GROUND's ground detail waits for ARRIVAL's building ring
  (`ground-arrival.js`, reading `_wp.fullRingSec`, at most 75 s).
- ARRIVAL's quantized decode chains onto the architecture material's
  existing `onBeforeCompile` and program key; REACH's stand-in material is
  its own instance and keeps its three shader anchors.
- LOOK's far colour no longer desaturates by distance (`far01` 0), so it
  does not stack with REACH's shader `farLook.desaturate`.

No new seam code was needed.

`WORKER_PROTOCOL` 26 to 27 at the same ten sites (`72ffecdf`; grep finds no
others and nothing still says 26): the streams changed flag-on bundle formats
in round 2 (ARRIVAL's quantized vertices, LOOK's late roof patch, GROUND's
canopy and bridge keys), so a bundle from before the merge is dropped.

### What round 2 changed, per stream (from the ledgers)

- **A TRUTH.** US house prior split into `us` and `us-sunbelt` (Powell
  two-storey houses back); big unmapped footprints in dense centres read a
  wider cover window with open land left out, railway is no longer
  industrial, a big box needs commercial land use or a car-scale region; a
  believable spread of heights around each class centre; seam halves
  measured over every geometric pair. Second pass: dense civic and
  industrial footprints, an arid regional prior (Turkey, Morocco, the Gulf
  and neighbours), the far mass's arrival cost reduced but not removed.
- **D LOOK.** The build no longer waits for its roof photo: a tile is born on
  the regional (z11) fallback and the z16 photo recolours its roofs in place
  (`lib/fly/look-roof-patch.js`, a 900 ms fade); tall roofs take a neutral
  family with the photo's luma; regional palettes reworked; near and far
  agree. Round 3: night keeps each part's family and seed with a night wall
  gain; the far colour is the near colour (`far01` 0, shared material, far
  shade); the far tile waits for the regional photo.
- **B ARRIVAL.** Quantized building vertices (`worker.quantize`: Int16
  position, anchor and uv; bundle bytes over nine places 98.0 to 45.5 MiB);
  the ground-query memo outlives the batch (2.4 M live queries, 0
  differences); the quantized program compiled ahead under the composer's
  target; a build timeout with worker replacement; tiles behind the aircraft
  kept at boost; footings as insurance. Round 2b: boost eviction at Paris and
  every World Pass finalize under one allowance a frame.
- **C REACH.** One far colour adapter; the triangle cap holds on every pass
  (the coastal reflection included); stand-ins grounded per corner on the
  drawn terrain inside ARRIVAL's batch; minPx stability and the near edge at
  boost. Round 2b: arrival with REACH alone and with all four, and the
  street pattern at 1,500 m from a ground photo atlas (Esri z13, about 4
  requests a group).
- **E GROUND.** Night bridge lights; Powell parcel homes (the legacy ring
  view, `engine.legacy`); bridge landings at joints (and the FableFlight
  credit corrected); crown colour from the photo; dense forest; motion cost;
  a stricter arrival hold; fewer Paris night specks. Its implementer marks
  these fixed; its verifier has not confirmed them.

### Proofs on the merged tree

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`:
  "IDENTICAL (top-level protocol field masked): 1062/1062 cases identical,
  7308 buffers + 1062 meta objects compared against 'c2bf5c06'; 28 stage
  cases (0 bad); 0 unrecorded inputs". Protocol pairs `24->27` x 1,062.
- Node gates PASS: `graphics-unit.mjs`, `verify-true-earth-flags` (11),
  `verify-stylized-earth` (22), `verify-city-horizon`,
  `verify-building-handoff` (4), `verify-attribution` (4).
- Stream probes, all exit 0: TRUTH `wp-truth-probe.mjs`,
  `wp-truth-r2-probe.mjs` (measurement tools); LOOK `wp-look-patch.mjs`
  PASS (15 arms, with ARRIVAL's prep), `wp-look-agree.mjs` PASS,
  `wp-look-shader.mjs` 18 passed, `wp-look-structures.mjs`,
  `wp-look-roofphoto.mjs`; ARRIVAL `wp-arrival-worker-prep.mjs` PASS
  (quantized 98.0 to 45.5 MiB), `wp-arrival-ground-churn.mjs` PASS (60,900 +
  60,900, 0 differences), `wp-arrival-r2b-frameslice.mjs` PASS,
  `wp-arrival-r2b-colgrid.mjs` PASS, `wp-arrival-bytes.mjs`; REACH
  `wp-reach-node-bench.mjs` PASS G1 to G5; GROUND `wp-ground-bridges-node.mjs`,
  `wp-ground-canopy-node.mjs`, `wp-ground-unit.mjs` 9 passed.
- `npx eslint` on the 179 JS files changed since `c2bf5c06`: seven errors, all
  react-hooks/immutability in `SatRoadLayer.jsx` (1), `SatSkylineLayer.jsx` (1)
  and `SatVegLayer.jsx` (5), the same errors at `c2bf5c06` (lines moved). No
  new errors.
- `npm run verify:beta`: 34 PASS, 0 FAIL.
- Not run on this tree: `next build` (not run in this directory by rule),
  any browser run, the owner's 5080 motion check.
- Path hygiene: the tracked files no longer carry an absolute home path:
  `.claude/launch.json` (the five stream servers point at `../wp-<key>`),
  `scripts/wp-probe-stream-tiles.mjs` (output beside the script), and the
  GPU slot lock in `wp-ground-verify-{arrival,live,look,motion}.cjs` and
  `wp-look-live.cjs` (found from `git rev-parse --git-common-dir`, as
  `look-pass-capture.cjs` does).

### Verifier results as they stand

- **TRUTH: second check FAILED on two items.** The arid and Turkish height
  prior draws Izmir and Istanbul 1 to 3 storeys where the old world drew 6
  to 8. With TRUTH on, the far ring fills about 50 % later in Paris and
  Tokyo.
- **LOOK: second check UNPROVEN.** It got no GPU slot. Unmeasured: night
  against a flags-off control, the Paris far tonal step, the night far ring,
  the budget and motion.
- **REACH, ARRIVAL, GROUND: second checks still running.** Their previous
  blocking items: REACH, the far ring arrives later than the old world and
  hides the Paris boulevards and the Manhattan avenue grid. ARRIVAL, tiles
  behind the aircraft die at boost in Paris and the tile finalize is not
  fully sliced. GROUND, night bridge stripes, missing Powell homes and
  bridge joints (fixed by its implementer, not yet confirmed).

### Open after wave 2

- The five verifier verdicts above: TRUTH's two failed items, LOOK's unproven
  check, and the three checks still running.
- No browser run of any kind on this merged tree, with one flag or all five.
  The seams above are proven by the node gates and by reading the code.
- The owner's 5080 motion check, for every stream.
- REACH's ground photo pull and LOOK's far colour both pull the far ring
  toward the photo; the combined look is not tuned (REACH round 2b: in the
  four-flag Paris frame the far ring is paler and the boulevards fainter
  than with REACH alone).
- REACH's stand-in group finalize (about 14 ms a frame) is not sliced; the
  shared allowance only keeps it from stacking with ARRIVAL's slices.
- Paris over the 256 MiB geometry row at Ultra in some arms (ARRIVAL alone
  263 MiB at boost; its GPU estimate 261.4 MiB settled).
- GROUND: six crowns under drawn roofs (the canopy keep-out reads the raw
  building layer, not what the building worker draws); the bridge photo on
  the water under each deck; golden-hour crowns brighter than the photo.
- Asked of another stream and not wired here: A to B, the lean 15 to 70 m2
  band body buffer; B to A, keep an existing bounding box in
  `installArchitectureShadowRange` and keep `partitionArchitectureIndex` and
  `emit.js partitionBody` in step; C to A, `houseMaxAreaM2` to 0 once the far
  height matches the near model everywhere; D to A, the feature id and its
  polygon count on the item; E, an earth-surface repaint under bridge decks.
- Each ledger's own "Open" list stands
  (`scripts/world-pass-ledger-<key>.md`).

## Default on (2026-11-17)

### The decision

The owner reported that the browser freezes with the five flags on and asked
to push with all flags on anyway, and to fix performance in a following
session. So the five blocks in `lib/fly/fly-constants.js` (`WORLD_TRUTH`,
`WORLD_ARRIVAL`, `WORLD_REACH`, `WORLD_LOOK`, `WORLD_GROUND`) ship
`enabled:true`. No other value in those blocks moved: every sub-switch keeps
its value. The tier test is unchanged: only desktop High and Ultra get the new
world. Medium, Low, phones and tablets keep the old world.

This was done knowing that the checks below had not passed.

### State of the checks at the decision

- **Round 2 adversarial verdicts: all five streams FAIL or are unproven.**
  - TRUTH: the sparse-evidence prior draws Izmir and Istanbul 1 to 3 storeys
    where the old world drew 6 to 8. The split hold-out wins 25 of 33 cities.
    Alone, TRUTH fills the far ring later (Paris +46 %, Tokyo +60 %).
  - LOOK: unproven. Night against a flags-off control, the Paris far step and
    the night far ring were never measured (no GPU slot).
  - REACH: arrival is later than the old world on a cold start (nyc-low far
    full ring +4.3 to +10.3 s; paris-mid near ring +1.6 to +5.2 s).
  - ARRIVAL (round 2b): tiles behind the aircraft die at boost in Paris. Tile
    finalize is not fully sliced (13 to 17.6 ms, and REACH's skyline finalize
    of 26 to 39 ms shares those frames).
  - GROUND: its round 2 verify failed. Its second fix round is unverified.
- **All five on together, merged tree** (orchestrator review of the int-2
  pair frames).
  - Gains: Phoenix shows the real low warehouses. Paris has limestone fabric
    to the horizon. Bridge decks are raised. Geometry is inside the Ultra
    budget (paris 199.5 MiB against 413.5 with the flags off; nyc-low 170.6
    against 309.0). The ring fills sooner (paris 11.8 s against 22.2 s).
  - Defects: Central Park trees read as bare grey sticks. Powell is buried
    under a conifer forest with dark green roofs. The far city washes pale
    (nyc-mid, nyc-bay, brooklyn, paris-mid, tokyo-bay). paris-mid golden hour
    has cold blue far ground under an amber sky. Roofs are sage green in Tokyo
    and Powell. San Francisco is uniform cream, London paler. Bridge decks are
    unlit at night. An nyc-mid vegetation tile stayed "sampling" for 150 s.
    Non-finite drape restarts are 53 / 69 / 76 against 4 to 7 with the flags
    off. The Tokyo palace tree stands are gone. The horizon stage counters
    read 0 under REACH (an instrument gap).
- **The browser freezes with the five on** (owner report, 2026-11-17). At
  that moment the machine was at 100 % CPU and all three GPU capture slots
  were used by background agents, so the cause is not separated yet.
- **No motion check on the owner's RTX 5080** has been done for any World
  Pass stream.
- **Not in this push:** unmerged, unverified work parked on stream branches:
  `world/truth` (round 3 height prior, `e770dc62` plus a WIP commit),
  `world/look` (round 3 far-city colour and night, `8cf346aa` plus a WIP
  commit), `world/ground` (second fix round, `2f182579`: crowns keep out of
  drawn roofs, calendar season, seam pass).

### Getting the old world back

- For one page load: `?flags=-WORLD_TRUTH` (and so on) turns that stream off.
  All five: `?flags=-WORLD_TRUTH,-WORLD_ARRIVAL,-WORLD_REACH,-WORLD_LOOK,-WORLD_GROUND`.
  A console pin works the same way
  (`window.__flyWorldTruthOverride = { enabled: false }` before the canvas
  mounts).
- In source: set `enabled: false` in the stream's block in
  `lib/fly/fly-constants.js`, one line per stream.
- With all five off the request is `wp1-0`, and the worker output is
  byte-identical to `c2bf5c06` apart from the protocol number (proof below).

### Gates, re-pointed

The old-world guarantee moved from "the default" to "the explicit off arm".
No assertion was deleted or loosened.

- `scripts/verify-true-earth-flags.mjs` (9) now asserts: the default at
  desktop Ultra and High is all five on; each `?flags=-WORLD_<NAME>`
  (installed through the real `installUrlFlags`) turns exactly that stream
  off; all five off, or the fleet pin, gives `wp1-0`; Medium, Low and the
  mobile class get `wp1-0` with the shipped default and with a stream forced
  on; one stream alone is that stream only; the latch survives a governor
  step. (9b) is new: `scripts/_boot.js` pins the five streams off in both
  legs.
- `scripts/world-pass-worker-proof.mjs` builds its `*wpoff` request with the
  real reader on a desktop Ultra page with the five `-WORLD_` flags, and
  fails unless that equals the all-off literal. So IDENTICAL means the
  `?flags=-WORLD_<NAME>` page is the `c2bf5c06` world.
- `scripts/world-pass-tier-proof.cjs` arms: `ultra` and `high` (no flags,
  all five on; `ultra` also steps the governor), `off` (all five `-WORLD_`),
  `minus-<stream>` x5, `truth-only`, `medium`, `medium-forced`, `low`,
  `phone` (no flags: all off), `all`, `diag` (stage counters with all five
  off).
- `scripts/wp-look-shader.mjs` (1) pins `-WORLD_LOOK` for its off arm, and a
  new (1b) checks the shipped default carries the look edits.
- Node gates whose frozen numbers were certified on the old world latch the
  reader on the five `-WORLD_` flags before they build anything, with the new
  helper `scripts/_world-pass-off.mjs` (`latchWorldPassOff()`):
  `verify-play-city`, `verify-architectural-realism`, `verify-look-facade`,
  `verify-living-earth`. `verify-city-horizon` adds the same five pins to the
  `window` it already sets. Without this, `verify-architectural-realism` and
  `verify-look-facade` went red (the architecture program now carries the
  WORLD_LOOK edits), `verify-city-horizon` threw in REACH's stand-in finalize
  (its stub worker sends no stand-in parts) and `verify-living-earth` failed
  earlier than on `0baeb61e` (WORLD_GROUND replaces the living forest).
- Every other node gate runs the shipped default. In node the reader sees no
  window, the store's default preset `high` and no mobile class, so it latches
  all five ON: `graphics-unit`, `verify-stylized-earth`,
  `verify-building-handoff`, the `verify:beta` set and the stream probes now
  run the new world.

### Harness posture

- **Browser fleet (every harness that boots through `scripts/_boot.js`
  `bootFly`): pinned to the old world.** `bootFly` sets `window.__flyWorldTruthOverride`,
  `__flyWorldArrivalOverride`, `__flyWorldReachOverride`,
  `__flyWorldLookOverride` and `__flyWorldGroundOverride` to
  `{ enabled: false }` in the boot leg and the reload leg, the same idiom as
  the R19 to R25 fleet pins. A pin wins over the URL. No World Pass gate
  boots through `_boot.js`. A gate that wants the shipped world un-pins with
  `unpinPins(['__flyWorldTruthOverride', ...])`.
- **World Pass tools and gates run the shipped default** and choose arms with
  `--flags`: `look-pass-capture.cjs`, `world-pass-budget.cjs`,
  `world-pass-tier-proof.cjs`, `world-pass-worker-live.cjs` and the `wp-*`
  scripts. A capture with no `--flags` is now the new world; labels captured
  before 2026-11-17 were the old world by default.
- **Browser scripts that boot without `_boot.js`** (the `review-*` tools,
  `verify-look-*`, `verify-lounge-mobile.cjs`, `verify-earth-world.cjs` and
  others) also run the shipped default. None was re-run here.
- **Production smokes:** at this decision `beta-smoke.cjs` actually pinned
  Low and did not exercise the new world; `verify-ultra-terrain.cjs` selects
  Ultra. The performance follow-up changes the desktop beta smoke default to
  High (`BETA_QUALITY=ultra` also supported) and asserts the effective World
  Pass request. The phone smoke retains Low. Neither smoke was run at the
  default-on decision.
- The Look Pass added no fleet pin to `scripts/_boot.js`; it re-pointed its
  gates one by one (FLY_LOOK_PASS.md rule 8: the old value with the flag off,
  the new value with it on). The World Pass needs the fleet pin because its
  tier test does not read the visuals profile: the fleet's Classic pin
  (`__flyVisualsOverride = 'classic'`) does not keep it out. A Classic session
  at desktop High or Ultra gets the new world too.

### Proofs at this commit

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`:
  "off arm = the reader's request for ?flags=-WORLD_TRUTH,-WORLD_ARRIVAL,
  -WORLD_REACH,-WORLD_LOOK,-WORLD_GROUND at desktop Ultra (wp1-0, equal to
  the all-off literal)"; "IDENTICAL (top-level protocol field masked):
  1062/1062 cases identical, 7308 buffers + 1062 meta objects compared
  against 'c2bf5c06'; 28 stage cases (0 bad); 0 unrecorded inputs".
- `node scripts/world-pass-tier-proof.cjs --url=http://localhost:3320`:
  PASS 15 arms. `ultra` `wp1-ultra-2hwcf-6d1a0855` (after the governor step:
  tier low, the same key, all five on); `high` `wp1-high-2hwcf-6d1a0855`;
  `off` `wp1-0`; `minus-truth` `wp1-ultra-2hwbk-85f5da9c`, `minus-arrival`
  `wp1-ultra-2ht7j-138f12cd`, `minus-reach` `wp1-ultra-2hmv3-726d17a6`,
  `minus-look` `wp1-ultra-270fz-cb849d35`, `minus-ground`
  `wp1-ultra-b8jj-0853c307`; `truth-only` `wp1-ultra-v-1d2d694e`; `medium`,
  `medium-forced`, `low`, `phone` (mobile true) and `diag` `wp1-0`; `all` the
  default key. Every posted request carried the latched key.
- `npm run verify:beta`: 34 PASS, 0 FAIL.
- Node World Pass gates, all PASS or exit 0: `verify-true-earth-flags` (12),
  `graphics-unit`, `verify-stylized-earth` (22), `verify-city-horizon`,
  `verify-building-handoff` (4), `verify-attribution` (4),
  `verify-lounge-occlusion` (6), `wp-truth-probe`, `wp-truth-r2-probe`,
  `wp-look-patch`, `wp-look-agree`, `wp-look-shader` (20),
  `wp-look-structures`, `wp-look-roofphoto`, `wp-arrival-worker-prep`,
  `wp-arrival-ground-churn`, `wp-arrival-r2b-frameslice`,
  `wp-arrival-r2b-colgrid`, `wp-arrival-bytes`, `wp-reach-node-bench`
  (G1 to G5), `wp-ground-bridges-node`, `wp-ground-canopy-node`,
  `wp-ground-unit` (9).
- 40 other node gates that import World Pass code were run here; the 23 that
  were red were run again on a checkout of `0baeb61e`. After the re-pointing
  above, every one still red here is red there with the same failures
  (`verify-ship-city` CT-2 / CT-5, `verify-ship-sky`,
  `verify-ship-light` and `verify-ship-release` (`git archive` of a base
  fails on the known corrupt object), `verify-play-city`, `verify-play-hud`,
  `verify-r25-flight-plan`, `verify-r25-sky`, `verify-living-earth`, and the
  Windows module-loader crashes: `verify-airport-lifecycle`,
  `verify-airport-set`, `verify-c-flagoff`, `verify-canopy-support`,
  `verify-cinematic-flight`, `verify-cloud-road-paths`,
  `verify-measured-world-prewarm`, `verify-night-city-identity`,
  `verify-ship-frame`, `r24-b-prewarm-proof`; and the suites that run them).
- Not run: `next build`, any capture or motion check of the default-on page,
  the production smokes.

### Next session

Performance. First separate the freeze from the machine's load (one page, the
five flags on, nothing else using the CPU or the GPU slots), then by stream
with `?flags=-WORLD_<NAME>`. The round 2 defects above and the three parked
branches stay open.

## Second wave

Not in this pass. Each needs the five streams first.

- Overture footprints and US lidar heights (keyless PMTiles; fail-closed to
  OpenFreeMap, ML footprints only where WorldCover says built-up).
- One shared tile service: a small worker pool and one decoded-tile cache for
  every layer.
- A ground plan raster per tile (map, WorldCover and the photo in one place).
- The earth shader reading the ground plan.
- Facade v2.
- Black Marble night lights into the lit window fraction and the far glow.
- Speed-aware streaming once a coarse level exists.

## Performance follow-up (2026-11-17, in progress)

Work starts from `8c593924` on `codex/world-pass-performance`. All five
World Pass defaults stay on. The parked visual branches remain unmerged.
Baseline dev and production servers use detached, unchanged application
trees; captures run one at a time on the RTX 5080. The owner's existing dev
server is not used or stopped.

### Instrument and baseline caveats

`scripts/world-pass-stalls.cjs` records 90 seconds per row: long tasks over
200 ms with timestamps, actual first canvas presentation, boot 100% and boot
overlay removal separately, every rAF interval, the 60–90 second median,
building-ring arrival, effective tier/flags and streaming counters. A blank
keeper tab lets Chrome stay alive between page 1 and page 2; the previous
world page is closed before the next one opens. Each pose/arm has an isolated
persistent profile, reused after a browser restart for its warm rows. No
network interception disables HTTP caching. Screenshots occur after timing.

Fixed-pose production telemetry requires the explicitly recorded `--review`
URL. Separate `--plain` rows use the literal URL and actual canvas draws,
without relying on development-only runtime handles. The normal instrument
sets `navigator.webdriver=false`, because automation otherwise deliberately
keeps production shader diagnostics on and suppresses the desktop Ultra
default. `--automation` is an explicit diagnostic arm. A fresh normal RTX
5080 player should start at **Ultra**; the earlier automated High starts
were the deliberate automation exception in `device-tiers.js`.

Raw captures, profiles and stills live under the ignored
`.graphics-review/world-performance/` directory. CPU-profile rows are causal
evidence, kept separate from the unprofiled timing table. The first diagnostic
profile also overlapped development route compilation and is not a quiet
timing baseline. An interrupted initial production probe lacked the required
review handle; it is not a measured row.

### Causes and changes under verification

- The content arrival cap released terrain/cloud programs before parallel
  linking finished. Production still blocked with diagnostics disabled:
  its CPU profile moved the wait into `WebGLUniforms` active-uniform queries.
  The actual-player profile attributes the 9.662 s reveal task to about
  5.763 s of scene first use and 3.611 s of cloud first use. Pending shader
  publication now remains gated after the content timer expires.
- Atmosphere LUT programs synchronously linked on their first draws (about
  4.465 s in that production profile). Exact-program asynchronous preparation
  now precedes the unchanged ordered LUT draws and texture publication.
- StrictMode discarded a skyline constructor that had already allocated a
  photo worker and 40 MiB atlas; replay then reused disposed photo resources.
  Resources now belong to effect attachment and are recreated on reattachment.
- Parking vegetation discarded sampling jobs while retaining their sampling
  records. Those jobs now pause and resume with their resident records.
- REACH group merge/photo/drape/bounds preparation now proceeds in bounded
  batches under the existing shared frame allowance. Geometry and completed
  photo patches publish atomically. `finalizeMsMax` remains total group CPU
  time; new `finalizeSliceMsMax` measures per-frame cost. Temporary preparation
  memory has separate counters.
- The boost lead retained only finished own-ring tiles. The reproduction at
  Paris lost 7 of 16 active residents and 4 of 8 drape jobs; bounded retention
  now preserves both records and jobs (zero lost in the same test), accounting
  their estimated bytes before admitting extra lead tiles.
- `drapeNonFiniteRestarts` was not comparable across arms: ARRIVAL counted
  retry batches of unavailable runs, including finite coarse samples; the
  legacy arm counted full-tile restarts. The compatibility field remains,
  with separate missing/nonfinite/coarse query and retry-run counters. No
  drape behavior is changed merely to lower the misleading number.
- Device reports read the latched effective World Pass flags, including tier,
  without latching early. Before the latch those five values are unknown
  (`null`). Desktop beta smoke now defaults to High and verifies its actual
  World Pass request; `BETA_QUALITY=ultra` selects Ultra.

The second actual-player production profile pair also isolates a separate
**1.981 s** task: about **1.858 s** of first-use uniform introspection in
the coastal reflection render. The earlier 9–14 s initialization outliers
did not recur in that pair, so their precise stacks remain unconfirmed.
GPU identity probing is now page-cached and prepared in an OffscreenCanvas
worker before FlyMode imports; the real canvas becomes authoritative and
releases that temporary context. This addresses measured synchronous probe
cost, not a proven attribution of every early outlier.

The observed 25 ms cadence was also present on a first page. Its profile
spent most of the sample window in the render loop, while the next profile
pair settled near 16.7 ms. There is no evidence of a second-page-only 40 Hz
application timer. Raw rAF and completed-world-frame intervals are now both
recorded, so asynchronous preparation cannot conceal a frozen world behind
a responsive animation callback.

Focused CPU regressions so far: lifecycle **14/14** (baseline **4/14**),
stand-in byte/slice/publication equivalence **12/12**, terrain readiness
**19/19**, atmosphere readiness **4/4**, composer readiness **10/10**, GPU
identity lifecycle **12/12**, and boost retention/diagnostics green. The
required worker proof is **IDENTICAL: 1062/1062 cases, 7308 buffers, 28 stage
cases with zero bad, zero unrecorded inputs** against `c2bf5c06`, with only
the pre-existing protocol 24→27 field masked. `npm run verify:beta` passes
**34/34**. These are correctness checks, not a completed performance verdict.
The complete before/after table, production still comparisons, tier proof
and final branch commits remain pending.

### Intermediate production profile, before auxiliary-pass fixes

The `7dc2bdae` candidate at NYC, Ultra, all five flags on, fresh profile:

| Page | Largest task | Largest task after overlay removal | Median rAF / world frame, 60–90 s | Full building ring, engine seconds |
|---|---:|---:|---:|---:|
| First | 2,388 ms | 212 ms | 16.7 / 16.7 ms | 11.6 |
| Second | 1,906 ms | no task over 200 ms | 16.7 / 16.7 ms | 11.3 |

These are **profiled intermediate rows**, not final acceptance. Both largest
tasks are coastal reflection first use (about 2,159 / 1,826 ms sampled
uniform introspection). A separate first-page 1,953 ms task includes about
1,001 ms from the PMREM sky-environment bake and 661 ms from the temporary
hangar's render and floor reflection. The coastal readiness change directly
targets the two maxima. The environment change walks the installed PMREM
generator with its render calls temporarily replaced by compile calls, then
waits for those exact programs before performing the unchanged real bake.
The scratch target is never published. No shader text, lighting constants,
sample count or environment resolution changes.

Inspection also found three readiness omissions: Bloom's down/up materials
are selected inside its render and initially have no `fullscreenMaterial`;
N8AO's six fullscreen meshes include an accumulation draw omitted by its old
warm-up; and layer-29 sky overlays compiled and rendered in the same frame.
Those paths now have explicit readiness, with local overlay holds. The
main world continues rendering while a newly streamed object's program links.

The first presentation instrument now excludes the temporary hangar canvas.
Older rows retain their original first-canvas reading: all sixteen production
baseline readings are within 6.1 ms of the old runtime's first-frame pulse,
but the first candidate's hangar drew 1.5 seconds before its world did. That
candidate number is not a valid first-world comparison. Version 4+ records
the actual world canvas. Version 5 also preserves cache phase separately
from final flight phase and retains page-error stacks and distinct console
errors. Raw older records remain unmodified.

ARRIVAL's 17.6 ms historical headline predates the records-slicing fix. The
intermediate NYC candidate measures a 4.1 ms maximum finalize frame, no
non-finite or missing drape queries, and 78,742 coarse queries. Its remaining
single-run vertex walk now yields within oversized buildings; water-only
commits join the shared admission/accounting. Water geometry construction
itself is still atomic and explicitly measured, not claimed to be bounded.
The first candidate/baseline NYC still comparison preserves visible building
layout, materials and lighting; cloud positions and live traffic differ.

### New York production comparison on the RTX 5080

Application commit `f688965b`, Ultra, Enhanced Satellite. All eight
90-second captures completed. Each row reports the largest main-thread
task in milliseconds, followed by the largest task after the overlay lifted.
Zero means the long-task observer saw no task above its 200 ms recording
threshold. The ring time is wall time from the fixed-pose warp until the
instrument observed a full building ring.

| World Pass | Profile | Page | Baseline largest task | Candidate largest task | Candidate after reveal | Candidate steady frame | Candidate full ring |
|---|---|---:|---:|---:|---:|---:|---:|
| On | Fresh | 1 | 9,126 | 1,274 | 0 | 16.7 ms | 11.4 s |
| On | Fresh | 2 | 9,287 | 370 | 0 | 16.7 ms | 10.8 s |
| On | Warm | 1 | 867 | 286 | 0 | 16.6 ms | 10.0 s |
| On | Warm | 2 | 14,689 | 244 | 0 | 16.6 ms | 10.2 s |
| Off | Fresh | 1 | 6,990 | 1,249 | 0 | 16.7 ms | 25.9 s |
| Off | Fresh | 2 | 551 | 390 | 0 | 16.7 ms | 24.1 s |
| Off | Warm | 1 | 883 | 263 | 0 | 16.7 ms | 24.5 s |
| Off | Warm | 2 | 404 | 247 | 0 | 16.7 ms | 23.7 s |

The first On capture's longest shader first use was **11.6 ms**. Its
environment, reflection, overlay and composer queues all drained. The
largest completed-world-frame gap after reveal across the eight rows was
**325.1 ms**. The first Off second-page capture nevertheless had a **6,975 ms**
animation-frame gap beginning 171 ms after navigation. The page was visible,
its GPU worker reported **6,984 ms** to obtain the renderer identity, and
the next timer sample arrived at 7,165 ms. This startup gap motivates the
returning-page GPU identity change. The earlier 390 ms long-task reading
alone misses it.

### Literal production front door after the GPU identity change

At `8e3dfddb`, four uninterrupted 90-second loads on the RTX 5080 used the
player URL, once with all five negative flags and once without query parameters.
Each arm began with a separate fresh profile. The second page replaced the
first in the same browser. Both fresh profiles selected **Ultra**. These
pages stayed at the title, so the building-ring clock applies to the separate
flight captures. All times below are milliseconds except the two navigation
times marked in seconds. A zero in the post-reveal task column means that
the browser recorded no task over 200 ms in that interval.

| Flags | Page | First world (s) | Overlay removed (s) | Largest task | Largest rAF gap | Post-reveal task | Post-reveal world gap | Median frame, 60–90 s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| On | 1 | 7.36 | 23.60 | 951 | 967 | 0 | 325 | 8.4 |
| On | 2 | 2.38 | 9.03 | 392 | 458 | 0 | 108 | 8.4 |
| Off | 1 | 7.04 | 23.56 | 993 | 1,017 | 280 | 275 | 16.6 |
| Off | 2 | 2.34 | 9.10 | 448 | 450 | 0 | 142 | 16.6 |

On the second default page the stored real-canvas GPU identity took 1 ms
to read and the real flight canvas took 65 ms to acquire its context. The
earlier seven-second gap did not recur in either returning title page.
The cache accepts a real, identifiable Windows desktop RTX/GTX flight
context, expires after ten minutes, and invalidates on context loss.
The current flight context refreshes the stored identity.

### Fixed-pose validation and remaining startup investigation

All 16 candidate development rows at `8e3dfddb` completed. The largest
post-reveal task was 418 ms and the largest post-reveal completed-world-frame
gap was 425 ms. At cold Paris with all streams enabled, the largest boot
task fell from 20,264 to 1,295 ms, the largest post-reveal task from 3,312
to 259 ms, and the full-ring wait after warp from 43.1 to 13.5 seconds.
At NYC, the all-on development rows measured at most 4.5 ms per skyline
finalize slice, compared with 25–33 ms of work accumulated over an entire
group. The building finalize peak was 1.6 ms. All four recorded zero
non-finite drape queries.

Two NYC development rows require follow-up. The cold first page reported
two JavaScript syntax errors with empty stacks. An earlier dev tier proof
and a baseline dev first page reported the same message. The second page
used the GPU identity cache in under 1 ms, yet its first animation callback
arrived at 6,207 ms. The independent timer jumped from 263 to 6,246 ms, and
the real canvas acquired its context later at 8,653 ms. An aggregate that
starts at the first callback misses this delay.

The second fresh NYC production flight also reproduced an 11,392 ms task
starting 1,371 ms after navigation. The HTML load event finished at 134 ms,
the flight bundles had arrived around 210 ms, and the boot overlay mounted
at 993 ms. The first traffic worker constructor began at 12,704 ms and the
real canvas acquired its context at 12,969 ms. The cached GPU identity took
1 ms. The remaining freeze can occur before either the flight WebGL renderer
or terrain workers exist. The four literal production title captures above
did not exercise this failing sequence. These rows remain in the evidence.

The [matched table](docs/reviews/world-pass-performance/stall-table.md) and
[task timeline](docs/reviews/world-pass-performance/longtasks.csv) retain all
32 baseline and 32 candidate fixed-pose combinations at this stage, including
the original readings, their retakes and missing coverage. Across 16 production
captures, the largest post-reveal task was 331 ms and the largest post-reveal
completed-frame gap was 358 ms. The returning fresh Paris flight also had a
10,034 ms startup task. New York's production median ranged from 16.7 to
33.3 ms and included a slower first page. The steady frame interval varies
between runs on this machine.

The [fixed-pose comparison](docs/reviews/world-pass-performance/production-still-comparison.jpg)
shows NYC and Paris with all five flags on and off before and after the shader
and streaming repairs. Building placement, facade selection, river alignment
and ground detail match visually. The live traffic, contrails, moving cloud
shadows and HUD fade differ between shots.

### Returning-page CPU profile and GPU trace

In a fresh NYC production pair on `8e3dfddb`, the second page spent 10.80 s
in its first minimap draw. The flight did not yet exist. A second profile
with native-call timing measured 11.974 s in its first `setTransform`.
Chrome had accepted `willReadFrequently:true` for that second page's dial.
The browser trace measured 11.973 s in the new renderer's command-buffer
initialization. On the GPU thread, destruction of the previous tab's command
buffer occupied 12.998 s; two ANGLE worker jobs each used over 13 s of CPU.
They started during the previous page's screenshot, before its close. With
screenshots disabled, another fresh pair still measured 4.895 s in the
unmodified dial's `setTransform`. That separate trace exceeded its output
cap. The native timing and 25-second CPU profile were preserved.

`605ff4b9` defers allocating the 5 Hz dial until a flight exists. Its first
ordinary, unprofiled NYC production return reached the world at 2.63 s,
with a 385 ms maximum task, 408 ms maximum rAF gap and 100 ms maximum
post-reveal world gap. Its cold first page had a 2.47 s initial rAF delay.
The shader probe returned from its worker in 2.52 s. This pair alone does
not establish that driver teardown is fixed. The old title-bypass diagnostic
also measured a 3.66 s hangar draw under the boot overlay on a page left
in its hangar. Its profile includes the floor reflection, HDR conversion and
first-use uniforms. The fixed-pose flight measurements close that hangar.

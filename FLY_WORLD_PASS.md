# World Pass: every place looks like itself

2026-11-16, owner-requested. This file is the plan and, once the pass closes,
the record. Scope: how the Enhanced satellite world is generated on desktop
High and Ultra: buildings, the far city, trees and ground contact. Medium, Low
and phones keep today's world.

**Status: W0 is committed on branch `phresh/mystifying-curran-97a006`** (two
commits: the worker split, then flags / reader / request / counters /
protocol 25). Nothing is visible: all five flags ship off and the worker's
flag-off output is byte-identical to `c2bf5c06` apart from the protocol
number (see "W0 proofs"). The five streams have not started.

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
blocks, each shipped `enabled:false`. Each is read ONLY through
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
off. With nothing on (every tier below High, every phone, and every session
without a flag) the request is that exact all-off object.

**Worker side (the streams).** The worker reads only the request, through
`tileCtx.worldPass` (`worker/tile-ctx.js` is the one place that touches
`options.worldPass`), never the constants block's `enabled` or its pinned
values. With `any` false it must produce today's bytes. It MAY echo
`result.wp = options.worldPass.key` while `any` is true; every engine already
drops a result whose `wp` differs from its own key (`worldPassMatch`, beside
the `WORKER_PROTOCOL` check), so two flag arms can never mix bundles.

### Engine counters

Plain numbers on `window.__fly.satBuildings.stats` and `satSkyline.stats`
(so `scripts/look-pass-capture.cjs` `telemetry.world` records them):

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

### Protocol 25

W0 bumps `WORKER_PROTOCOL` 24 to 25 once for the whole pass, at all ten pin
sites in lockstep: `vector-tile.worker.js`; `EXPECTED_WORKER_PROTOCOL` in the
`sat-building`, `sat-clutter`, `sat-road`, `sat-skyline`, `sat-veg` and
`toy-world` engines; `STYLIZED_EARTH.protocol` in `lib/fly/stylized-earth.js`
(the earth-surface engine's own check, missed by the review's count of nine);
and the literal regexes in `scripts/graphics-unit.mjs` and
`scripts/verify-stylized-earth.mjs`. `scripts/verify-city-horizon.mjs` reads
the number from source. A stream that changes a payload under its flag does
NOT bump it again: the flag-off payload is unchanged, and a flag-on bundle
carries `wp` (see the request contract).

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

(empty)

### B ARRIVAL

(empty)

### C REACH

(empty)

### D LOOK

(empty)

### E GROUND

(empty)

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

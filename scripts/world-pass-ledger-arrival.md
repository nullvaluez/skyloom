# World Pass ledger: stream B ARRIVAL (`WORLD_ARRIVAL`)

Branch `world/arrival`, worktree `.claude/worktrees/wp-arrival`, from W0 `ac26a77e`.
Dev server :3322 (webpack), installed Chrome / D3D11 / RTX 5080, live world,
Ultra 1600 x 900. Every number below is relative evidence from one shared
machine (up to three GPU capture slots in use by other streams), never an fps
verdict. Evidence folders are under `.graphics-review/world-pass/arrival/`
(not in git).

Goal: the city is there when you arrive, it stands on the ground, and it fits
in memory. Turn it on for one page load with `?flags=WORLD_ARRIVAL` (desktop
High / Ultra only, latched once per page by `lib/fly/world-pass.js`). Every
sub-switch ships `true`; with the flag off every branch below is the shipped
code and the worker output is byte-identical.

## What I built

### M1 fastQuery: an exact fast ground query (`lib/fly/terrain-ground-query.js`)

The shipped query (`sampleReference`, kept verbatim) walks the three-tile tree
from the root on every call. Measured at Midtown it makes 57 tile-box tests a
query (about 0.2 us each: the `BBox` getter is megamorphic), reaches one mesh,
and tests 9 triangles. The walk, not the triangle test, is the cost.

Design. Two exact paths, both armed only by the building engine when
`WORLD_ARRIVAL.fastQuery` is on (`armFastGroundQuery(true)`, latched in
`setWorker`):

- **Batched** (`beginGroundBatch()` / `endGroundBatch()`). The drape, the
  heal-in-place sampler and the contact repair are synchronous loops that only
  query. JavaScript runs such a loop to its end before any other code can touch
  the terrain tree, so inside one batch the tree, every tile box, every matrix
  and every buffer is constant, and the walk for a point is a pure function of
  which tile boxes contain it. The batch memoises one walk per "safe
  rectangle": the intersection of every accepted tile box with the far side of
  every rejected one, each bound kept with the reference test's own strictness
  (`>=`/`<=` for an accepted box, `<`/`>` for the failed side of a rejected
  one), so any point inside takes exactly the same branches and reaches the same
  meshes in the same order. Per batch it also caches each node's children with
  their boxes (read once) and one record per mesh (inverse matrix, triangle
  buckets, the (group, material) ranges, the bounds). Only the triangle test
  runs per point, with the reference's arithmetic, in the reference's order. A
  range identical to an earlier one of the same mesh (same span, same culling
  side) is tested once: it can only re-find heights that never win the strict
  `>`. The memo dies with the batch, so no invalidation question exists.
- **Unbatched calls keep the reference path.** I built an exact unbatched
  variant (the live walk without closures, inverses memoised against all 16
  `matrixWorld` elements, one ancestor update instead of two). It passed the
  same million-point test but measured no faster than the reference (12.1 /
  9.5 / 12.9 / 13.9 us against 11.7 / 11.5 / 14.4 / 15.1 us): the tile-box
  tests are the cost and only a batch may memoise them. It was removed rather
  than shipped.

Public signature unchanged (`sample(lon, lat)`, `getGroundAt`), so stream C
gets the exact answers for free and the speed by wrapping its own query loops
in a batch (see Seam requests).

Proof: `scripts/wp-arrival-ground-diff.cjs` samples N points per pose with
the reference and with the batched path in ONE synchronous page task (the tree
cannot change under the comparison) and requires the same null / undefined,
`Object.is` on `elev`, the same `tileZ` and the same tile object. Half the
points are uniform over a 3 km disc in random order, half the drape's shape
(clusters of 2 to 40 points within 30 m). The batched path runs in batches of
2,000 points (about one drape frame).

### M2 drapeCap and readiness (`sat-building-engine.js`, `world-readiness.js`, `SatBuildingLayer.jsx`)

- **The drape by run.** One ground sample per building on the drawn mesh,
  indexed by run (a building's consecutive vertex span; from the worker's prep
  when present, else one pass over the anchors). No per-vertex walk and no
  string-keyed map in the drape. The heal, the drape and the contact repair
  run inside a ground-query batch.
- **Capped retry, provisional commit.** A run with no usable sample (none,
  non-finite, or a fallback mesh under z10) is re-sampled on its own every
  `drapeRetrySec`, never by restarting the tile. After `drapeCapSec` (4 s) the
  remaining runs commit provisionally on the tile's median ground; a tile with
  no sample at all (no terrain yet) keeps waiting, there is nothing honest to
  stand it on. A run committed on a mesh coarser than `honestZ` (14) counts as
  unsettled.
- **Re-seat in place.** `_repairContactArrival` re-samples every resident run
  nearest-first, unsettled runs first, inside 0.6 ms and 256 samples a frame
  (shipped: 8 samples, one repair a frame), and `repairArrivalRun` moves a
  run's vertices, its collision column and its porch light by the delta with a
  ranged upload when the drawn mesh under it got finer. No eviction, no
  rebuild, so HEAL_IN_PLACE and CHUNK_FADE are untouched (the shipped heal path
  still owns non-arrival chunks).
- **Order by the view and the aircraft.** The desired set is ranked by
  distance from the lead point with a tile behind the camera counted
  `1 + behindK` (2.5) times farther; the lead is `min(speed x leadSec, 0.8 x
  ring radius)` (6 s, where the aircraft will be when a tile asked for now can
  draw). Pending tiles drape and finalize in that rank, not in completion
  order.
- **Two building workers** (`workers: 2`, `maxBuilds: 6`): dense tiles take
  0.6 to 2.4 s each and one worker builds them one after another.
- **Readiness in the view direction** (`world-readiness.js`
  `localRingReadiness`): with the flag on (read from the engine's latched
  switch, so the loading overlay never latches the reader early) a building
  tile counts when it is within 700 m or within 100 degrees of the heading.

### M3 workerPrep and uploads (`worker/sat-buildings/emit.js`, `flash-guard.js`, the engine)

- **The closed-ring defect, fixed at the producer.** `emitBody`'s wall loop no
  longer emits the zero-length wrap edge of a closed ring (or any repeated
  point). The roof cap still receives the ring as before (earcut drops the
  repeat, and changing its input changes its triangulation).
- **Worker prep** (`prepareArrival`, `partitionBody`): an exact zero-area
  filter over the body and detail ranges (FLASH_GUARD's test at threshold 0,
  so earcut's collinear caps go too), compaction of unreferenced vertices,
  runs (span, anchor, local min / max Y, radius), the body partition of
  `partitionArchitectureIndex` (same 4 x 4 centroid buckets; X and Z do not
  move in the drape) with the runs each region touches, footing data, and packed
  attributes: normals as normalized Int8 (3 B for 12), colours as normalized
  Uint8 (3 B for 12; a vertex colour is interpolated after the decode, so the
  quantisation is 1/510 at the vertices, never a band). All in
  `out.satBuilding.prep`, transferred.
- **Main thread.** Region heights come from the per-run ground (a superset of
  the vertex walk's bounds); the chunk box and sphere come from the runs
  (anchor +- radius, local extent + ground) instead of two vertex walks
  (`computeBoundingSphere`, and the box `installArchitectureShadowRange`
  recomputes, which the run box already bounds); the vertex Y add is one small
  hot function per run; the house lights resolve their run by walking both
  lists in step instead of a string-keyed map. The run walk and the FLASH_GUARD
  scan (`guardSliceBegin` / `guardSliceStep`, the same test, order and in-place
  compaction as `guardArchitectureIndex`) run in slices of 3 ms a frame; the
  finalize proper is the light remainder. FLASH_GUARD stays the guard: if it
  ever drops a triangle the worker's partition no longer lines up and the
  partition is recomputed on the main thread as before.
- **Byte budget.** Up to 3 tiles a frame and 24 MiB of new geometry a frame
  (FableFlight's upload budget), at least one tile.
- **CPU copies.** Not released. Three readers keep them alive: the heal and
  the contact repair write `position`, `night-ground-sources.js` reads the
  anchor, style and uv arrays, and three's raycast reads `normal` on a hit. The
  memory saving is real bytes (GPU and heap together), from the packed
  attributes, the compaction and the dropped degenerate triangles.

### M4 footings

Each building is seated on the lowest drawn ground under its footprint and its
walls are carried down to it. The worker lists each run's wall-bottom vertices
(local y equal to the run's minimum, below the anchor ground; an elevated part
gets none) and the footprint's four diagonal extremes among them. The contact
repair samples those four points (plus the centroid it already has) when the
run's mesh zoom improves, and moves only the wall-bottom vertices down by
`ground - lowest` (capped at `footMaxM` 60 m), with their facade v moved by the
same metres so the window rows keep their spacing (the windows continue below
the old base instead of stretching). The roof keeps its height over the
centroid ground. Ported from FableFlight `src/buildings.rs` 1543 to 1560
(`site`: ground under every outline point, gmin) and 1626 to 1642 (`base = gmin
- 2`); I sample four extremes, not every point, to keep it to five queries a
building.

### The result.wp stamp

`vector-tile.worker.js` (one marked seam): `api.buildTile` is wrapped once;
every result built under a request with `any` true carries `wp =
request.key`, read through `worker/tile-ctx.js` `worldPassOf` (so tile-ctx
stays the only reader of `options.worldPass`, gate (8b)). With every flag off
nothing is stamped.

## Measurements

### M1: the differential test

`node scripts/wp-arrival-ground-diff.cjs --url=http://localhost:3322
--pose=hongkong,sf-hills,nyc-low,phoenix-suburb --points=250000
--flags=WORLD_ARRIVAL --out=<arrival>/ground-diff-final` (the final code; the
engine is armed and batching live in the same page):

**PASS: 1,000,000 points, 0 differences** (identical `null`/`undefined`,
`Object.is` on `elev`, same `tileZ`, same tile object). Every point hit
(0 null, 0 undefined); elevations -26 to 548 m; answering tiles z12 to z18
(Hong Kong 21 k at z13 through 2.8 k at z17; Midtown 82 k at z12 through 418 at
z18). The same test passed three times on the way (`ground-diff-1`, before the
engine was armed; `ground-diff-m1`, armed; `ground-diff-final`).

| pose | reference us | batched, mixed points us | reference, drape-shaped us | batched, drape-shaped us |
|---|---|---|---|---|
| hongkong | 17.95 (13.93) | 1.64 (1.43) | 17.24 (13.36) | 1.11 (0.87) |
| sf-hills | 18.11 (15.59) | 1.79 (1.72) | 17.65 (13.83) | 1.32 (1.06) |
| nyc-low | 17.84 (14.43) | 1.74 (1.49) | 19.53 (15.03) | 0.95 (0.93) |
| phoenix-suburb | 18.81 (15.53) | 1.53 (1.62) | 17.89 (15.14) | 0.97 (1.04) |

Final run, with the m1 run in brackets (the machine was busier for the final
run: the reference itself moved from about 14 to 18 us). The batched path is 11
to 19 times faster. "Drape-shaped" points still restart at a random place every
2 to 40 points, so every cluster head pays a full walk; the live drape walks a
tile's buildings in emission order and pays far fewer. The live drape's own
per-building cost (the batched ground query plus the drape's bookkeeping) is
the engine counter `drapeUsPerRun`: **1.42 us at Powell, 1.30 at nyc-low, 1.25
at Hong Kong** (`budget-final`, Ultra, under three busy capture slots, where
the reference cost 19 to 21 us). So the query the drape pays is about 1 us,
13 to 16 times cheaper than the reference; the "under 1 us" target is met on
the probe's drape shape at nyc-low and Phoenix (0.95, 0.97) and missed by 0.1
to 0.3 us at Hong Kong and San Francisco under load.

Walk census (`--profile=1`, nyc-low, 20 k random points): 57.6 nodes and 56.6
tile-box tests a query, exactly 1 mesh reached, 9.1 triangle tests; the walk
alone 9.5 to 12.3 us of the 14 us. That is why the memo, not the triangle
test, is the lever.

### M2 + M3: the budget, off against on (Ultra)

`node scripts/world-pass-budget.cjs --url=http://localhost:3322
--pose=powell,nyc-low,paris,tokyo,phoenix-suburb --quality=ultra
[--flags=WORLD_ARRIVAL] --out=<arrival>/budget-off1 | budget-on2`. One page per
arm, warped pose to pose; powell is the first warp after boot (cold), the rest
are warm warps. Arrival seconds are from the warp. off / on:

| pose | first detailed tile (s) | full ring (s) | finalize max per tile (ms) | building MiB | geometry MiB total | stuck | FLASH_GUARD drops on main | draws | triangles (M) | getGroundAt unbatched (us) |
|---|---|---|---|---|---|---|---|---|---|---|
| powell (cold) | 35.9 / 19.6 | 68.1 / 19.9 | 69.9 / 3.0 | 25.4 / 16.9 (-33.5 %) | 76.1 / 67.5 | 0 / 0 | 6,654 / 0 | 353 / 354 | 0.94 / 0.93 | 14.8 / 19.1 |
| nyc-low | 5.8 / 4.5 | 36.4 / 9.3 | 119.8 / 1.4 | 209.9 / 135.2 (-35.6 %) | 308.3 / 233.5 | 0 / 0 | 122,781 / 0 | 386 / 384 | 4.52 / 4.46 | 16.4 / 18.8 |
| paris | 11.0 / 7.0 | 42.7 / 13.1 | 122.3 / 0.8 | 320.5 / 211.4 (-34.0 %) | 413.7 / 304.6 | 0 / 0 | 136,595 / 0 | 383 / 385 | 6.42 / 6.27 | 16.4 / 19.3 |
| tokyo | 11.6 / 5.8 | 43.7 / 8.8 | 98.3 / 7.4 | 216.3 / 143.7 (-33.6 %) | 310.9 / 238.4 | 0 / 0 | 149,862 / 0 | 401 / 400 | 4.90 / 5.00 | 19.7 / 63.2 |
| phoenix-suburb | 7.0 / 6.4 | 28.8 / 7.5 | 89.2 / 1.6 | 168.4 / 109.4 (-35.0 %) | 250.6 / 191.2 | 0 / 0 | 109,628 / 0 | 369 / 370 | 2.71 / 2.71 | 15.0 / 20.8 |

- "finalize max per tile" is the shipped counter (`finalizeMsMax`, the
  finalize proper). With the flag on the heavy halves run in 3 ms slices before
  it, so the honest hitch number is the most finalize work done in any one
  frame (`finalizeFrameMsMax`, slices included): **5.9 / 5.1 / 4.0 / 9.7 / 3.8
  ms**. Tokyo's 9.7 is over the 8 ms target once. The per-tile average is 0.5 to
  1.3 ms.
- Building geometry is down 33.5 to 35.6 % (the 30 % target), with the same
  triangles (the worker gate below) and the same buildings: collision columns
  49,211 / 49,219 at nyc-low, 53,147 / 53,145 at Paris, 35,350 / 35,350 at
  Phoenix (Tokyo 61,897 / 64,974: the view ranking keeps a different 16 tiles).
  Ultra's 256 MiB row: Manhattan total geometry now fits (233.5), Tokyo fits
  (238.4), Paris is still over (304.6; its buildings alone are 211.4).
- The unbatched `getGroundAt` (the budget tool's own 20 k-point loop) is not
  faster with the flag on, by design (see M1); the on-arm numbers moved up with
  machine load (Tokyo's 63 us is one outlier under three busy capture slots).
- JS heap (MiB, sampled once, off / on): 666 / 641, 965 / 884, 900 / 1116, 738
  / 780, 856 / 1207. Mixed in both directions; not attributed (see Open).

High (`--quality=high`), `budget-high-off` / `budget-high-on`: see the table
appended at the end of this file.

### M2: settle and boost arrival, and frame pacing

`node scripts/wp-probe-stream-motion.cjs --url=http://localhost:3322
--scenarios=settle-nyc,nyc-boost-500 --settleSec=70 --frameSec=4
[--flags=WORLD_ARRIVAL] --out=<arrival>/motion-off | motion-on`, summarised by
`scripts/wp-probe-stream-summary.cjs`:

| | off | on |
|---|---|---|
| settle at Midtown, 500 m: first detailed tile | 16.5 s | 8.3 s |
| ... 16 of 16 detailed tiles | 57.1 s | 10.0 s |
| ... worst building finalize work in a frame (probe) | 153 ms | 8 ms |
| ... longest frame while the ring fills | 1,148 ms | 796 ms |
| ... 250 ms windows with a frame over 50 ms | 85 of 217 | 72 of 235 |
| boost 750 m/s from 15 km: detailed tiles at Midtown arrival | 0, 0, 0, 0, 0, 0, 0, 1 | 14, 14, 15, 13, 13, 13, 14, 14 |
| ... bodies at arrival | 0 to 1,287 | 29,189 to 40,357 |
| ... detailed tiles ready in flight (min / p50 / max) | 0 / 3 / 14 | 8 / 14 / 16 |
| ... tile birth distance ahead, p10 / p50 / p90 | 96 / 617 / 3,452 m | 3,289 / 4,350 / 4,744 m |
| ... worst building finalize work in a frame | 140 ms | 7 ms |
| ... longest frame while flying in | 1,304 ms | 644 ms |
| ... 250 ms windows with a frame over 50 ms | 59 of 97 | 67 of 102 |

The targets (first tile about 3 s after terrain, full ring about 10 s, at
least 12 of 16 at boost, nothing stuck over 20 s) are met except the first
tile: 4.5 to 7 s from the warp on warm warps and 8.3 s in the settle probe,
which counts from before terrain is present; I did not separate the terrain's
own arrival from it. The longest frames (0.6 to 1.3 s in both arms) are not the
building engine (its worst frame is 7 to 8 ms with the flag on); I did not
attribute them. At boost the share of windows with a 50 ms frame did not fall
(59 of 97 against 67 of 102): the ring now finalizes 14 tiles during the run
instead of 4.

### M3: the worker prep gate

`node scripts/wp-arrival-worker-prep.mjs` (recorded inputs of the worker
proof, nine places, Enhanced sat-buildings with the all-off request against
WORLD_ARRIVAL on): **PASS**. No degenerate triangle in the on index (off had
460 to 11,290 per tile), every vertex referenced, the same body and detail
triangles (each keyed by position, colour on the 1/255 grid, anchor, uv and
style, in winding order), runs and regions tile, footing vertices are each
run's wall bottom, `result.wp` stamped. Bundle bytes 98.0 -> 63.0 MiB over the
nine tiles (-35.7 %), vertices -9.2 %, triangles 850,438 -> 798,348 (only the
degenerate ones gone). In the browser FLASH_GUARD dropped 0 triangles with the
flag on at every pose (off: 6.7 k to 150 k a pose).

### M4: footings

`budget-final` (Ultra, flag on): Powell 1,403 footings, 0 gaps, deepest 3.8 m;
nyc-low 14,287 footings, 5 gaps, deepest 13.2 m; Hong Kong 29,333 footings,
**571 gaps closed, deepest 41.7 m** (counters cumulative in the page).

Engine counters with the flag on (`footings`: runs whose footing was computed;
`footGaps`: runs whose lowest corner lies more than `baseSinkM` 6 m below the
centroid ground, i.e. a gap the shipped wall bottom left open; `footMaxDelta`):
budget-on2 footings 1,241 (Powell) to 38,738 (cumulative through Phoenix);
capture `arrival-slope-on` (one page, cumulative) Hong Kong 10,902 footings,
497 gaps closed, deepest 48.8 m; then San Francisco 59,301 footings, 12,178
gaps, deepest at the 60 m cap.

Frames (absolute paths below): at `hongkong__noon`, `sf-hills__noon` and my two
closer poses (`hk-slope`, `sf-slope`, `scripts/wp-arrival-poses.json`) the on
and off frames look the same at the bases I can see; at these distances and
angles no base gap is visible in either arm. **The frames do not prove "gaps
gone"; the counters show the gaps were there and are closed.** San Francisco
reaching the 60 m cap needs a look: it is most likely a building at the bay or
on a cliff edge whose corner samples water or the drop below, where a 60 m
plinth may show.

## Frames

On against off, noon, Ultra (`look-pass-capture.cjs --flags=WORLD_ARRIVAL`),
off from the orchestrator's base-1/2/3 (all flags off) and, for the slope
poses, my own off capture on :3322:

- `.graphics-review/world-pass/arrival/frames-on/{hongkong,sf-hills,nyc-low,paris,tokyo,phoenix-suburb}__noon.png`
- side by side: `.graphics-review/world-pass/arrival/compare/*-off-left-on-right.png`,
  crops `hongkong__noon-crop-off-top-on-bottom.png`, `sf-hills__noon-crop-...`
- slopes: `frames-slope-off/`, `frames-slope-on/` `{hk-slope,sf-slope}__noon.png`,
  `compare/{hk,sf}-slope__noon-off-top-on-bottom.png` and `-crop-...`

Verdict: the same city in both arms (same buildings, colours and shading;
packed colours and normals are not visible). Differences are clouds, light and
trees from other systems. This stream does not change the look; it changes when
the city is there and what it costs.

## Shared-file edits (for the merge)

1. `lib/fly/toy-world/worker/sat-buildings/index.js`: `createBuildingAccumulator(tileCtx)`
   (was `()`), one line between `// WORLD PASS B begin` / `// WORLD PASS B end`.
2. `lib/fly/toy-world/vector-tile.worker.js`: `import { worldPassOf } from
   './worker/tile-ctx'` and the `result.wp` stamp wrapper just before
   `expose(api)`, both between `// WORLD PASS B begin` / `end`.
3. `lib/fly/fly-constants.js`: only the `WORLD_ARRIVAL` block (main-thread
   tunables; `worker: {}` unchanged, `enabled: false`).

Owned files changed: `lib/fly/terrain-ground-query.js`,
`lib/fly/toy-world/sat-building-engine.js`, `lib/fly/world-readiness.js`,
`lib/fly/toy-world/flash-guard.js`, `lib/fly/toy-world/worker/sat-buildings/emit.js`,
`components/fly/SatBuildingLayer.jsx`. New: `scripts/wp-arrival-ground-diff.cjs`,
`scripts/wp-arrival-worker-prep.mjs`, `scripts/wp-arrival-poses.json`, this
ledger. `WORKER_PROTOCOL` not touched.

## Seam requests

- **Stream C (REACH)**: wrap the skyline engine's ground-query loops in
  `beginGroundBatch()` / `endGroundBatch()` (from `lib/fly/terrain-ground-query.js`,
  in a `finally`, nothing awaited inside). With WORLD_ARRIVAL on the query is
  then exact and about 15 times faster; without the batch it runs the reference.
- **Stream A (architecture-draw-range.js)**: `installArchitectureShadowRange`
  always recomputes `geometry.computeBoundingBox()` (a vertex walk). Please
  keep an existing box (I override the method on the instance for that one
  call). And `partitionArchitectureIndex` now has a worker twin
  (`emit.js` `partitionBody`, the same buckets and bounds): keep them in step,
  or move the pure part to a module both can import.
- **Stream A / D (sat-buildings emitters)**: with workerPrep the worker drops
  exactly-degenerate triangles and unreferenced vertices after every emitter
  has run, so a new emitter needs no closed-ring care; it must keep each
  building's vertices consecutive under one anchor (the run contract).
- **Stream D (LOOK)**: with WORLD_ARRIVAL on, building vertex colours arrive as
  normalized Uint8 and normals as normalized Int8 (`bld.prep.colNormalized`,
  `bld.prep.normalPacked`); a CPU-side colour pass must write in that range.
- **Merge**: the flag-on payload carries `wp`; no protocol bump needed for it.

## Ported techniques (credit line)

- FableFlight (MIT), `src/world.rs` lines 83 to 89 and 1040 to 1072: the
  per-frame upload byte budget (24 MiB) -> `WORLD_ARRIVAL.uploadBudgetMB` in
  `_finalizePending`.
- FableFlight (MIT), `src/buildings.rs` lines 1543 to 1560 (`site`: ground
  under the outline, its minimum) and 1626 to 1642 (`base = gmin - 2`): seat on
  the lowest outline ground -> `_footing` (four diagonal extremes, not every
  point).

## Open

1. Footings are not shown working in a frame (counters only), and San
   Francisco hits the 60 m cap; a low oblique pose on a steep street, off and
   on, is the next look.
2. Frame pacing during arrival: the 0.6 to 1.3 s frames are outside the
   building engine and not attributed; at boost the share of 50 ms windows did
   not fall.
3. The first detailed tile is 4.5 to 8.3 s from the warp, not measured from
   terrain presence.
4. The unbatched `getGroundAt` is unchanged (16 to 19 us); only batched loops
   are fast. Stream C, LivingForest and the airport set would need batches.
5. Uploads: a tile's first upload is still one `bufferData` per attribute (the
   byte budget bounds a frame to 24 MiB and 3 tiles; no partial uploads).
6. CPU copies are not released: the heal and contact repair write `position`,
   `night-ground-sources.js` reads anchor, style and uv, three's raycast reads
   `normal`. Releasing colour alone would save 3 B a vertex of heap.
7. JS heap readings moved both ways (Paris +216 MiB, Phoenix +351, nyc -81);
   GC timing is the likely cause but it is not shown.
8. Paris is still over Ultra's 256 MiB of geometry (304.6 MiB total).
9. Runs on terrain coarser than `honestZ` at distance stay "unsettled"
   (three-tile keeps distant ground coarse); they stand on the drawn mesh and
   re-seat when it refines. `honestZ` only orders the repair queue.
10. Only Ultra was measured for arrival and memory; High is in the appended
    table.

## Appendix: High (`--quality=high`), off / on

`node scripts/world-pass-budget.cjs --url=http://localhost:3322
--pose=powell,nyc-low,paris --quality=high [--flags=WORLD_ARRIVAL]
--out=<arrival>/budget-high-off | budget-high-on`. The latched request key at
High is `wp1-high-34w-49a6bb38` (Ultra `wp1-ultra-34w-49a6bb38`), off `wp1-0`.

| pose | draws | triangles (M) | building MiB | total MiB | first tile (s) | full ring (s) | stuck | finalize max per tile (ms) | finalize work in a frame (ms) | FLASH_GUARD drops |
|---|---|---|---|---|---|---|---|---|---|---|
| powell (cold) | 300 / 301 | 0.76 / 0.76 | 25.4 / 16.9 | 76.1 / 67.5 | 40.4 / 41.6 | 77.9 / 42.1 | 0 / 0 | 69.4 / 3.2 | - / 5.7 | 6,654 / 0 |
| nyc-low | 325 / 328 | 3.49 / 3.49 | 209.9 / 135.2 | 308.3 / 233.5 | 9.0 / 6.8 | 55.1 / 11.8 | 0 / 0 | 110.3 / 2.3 | - / 6.5 | 122,781 / 0 |
| paris | 333 / 333 | 4.47 / 4.53 | 320.5 / 211.4 | 413.7 / 304.6 | 11.6 / 8.8 | 54.4 / 16.1 | 0 / 0 | 121.9 / 1.0 | - / 3.8 | 136,595 / 0 |

Draws and triangles are unchanged (this stream adds no geometry and no draw);
High's 375-draw row holds. Costs stated per the pass rule: Ultra and High
both pay LESS geometry with the flag on (-33.5 to -35.6 % building bytes), one
extra worker heap (the second building worker), and per resident tile about
0.3 MB of main-thread footing and run data.

## Round 2 (2026-11-17)

Built on the integration head `d40dfd25` (merged first: TRUTH, LOOK, REACH,
the two merge seams, WORKER_PROTOCOL 26). The flag still ships
`enabled:false`. Same machine as round 1 (RTX 5080, installed Chrome, D3D11,
live world, dev server :3322), shared with the other streams' captures: every
capture waited for one of the three GPU slots, and the cold-boot numbers below
are dominated by other systems' shader links. A fresh control (all flags off)
was shot in the same session for every before / after; no old base frame was
used. Evidence: `.graphics-review/world-pass/r2/arrival/` in this worktree;
the frames for review are copied to
`mystifying-curran-97a006/.graphics-review/world-pass/r2/arrival/`
(`control/` flags off, `own/` WORLD_ARRIVAL, `all/` the four flags, plus
`footing/`, `boost/`, `cmp/`).

Commits: `f212f847` (quantized vertices, seams), `017cfb11` (ground memo, churn
gate), `579954e6` (quantized finalize, repair and footing; build timeout and
worker replacement; keep-behind; counters; probes), `70d91a57` (region-aware
guard, finer slices, fallback counters, the first async compile),
`cc55d506` (the compile under a bound render target, its probe), and this
ledger.

### 1. Geometry budget: quantized building vertices (`worker.quantize`)

**What `world-pass-budget.cjs` counts:** the CPU typed arrays of every unique
geometry (`attribute.array.byteLength` plus the index), never a GPU buffer;
`lib/fly/cinema-resources.js` counts the same thing. It is a proxy for the GPU
buffers, which hold the same bytes for every Float32 attribute. So I did NOT
release CPU copies (that would lower the tool's number and leave the GPU
unchanged). I made the vertex smaller on both sides:

- **Position** Float32 x3 (12 B) -> normalized Int16 x4 (8 B): tile-local
  metres on a fixed 1/16 m lattice (+-2,047 m; a z14 tile is 2,446 m across,
  at Paris 1,600 m). Four components because D3D11 has no 3-component 16-bit
  vertex format; the 4th is 0. The mesh sits at its tile's median ground
  (`mesh.position.y`), so local Y holds any building on that ground (a run
  more than about 1 km off the median would be clamped and counted,
  `quantClamped`: 0 everywhere).
- **Bend anchor** Float32 x2 (8 B) -> normalized Int16 x2 (4 B), same lattice.
- **Facade uv** Float32 x2 (8 B) -> normalized Int16 x2 (4 B) on a 1/512
  lattice (+-64 units = +-1.7 km of facade at 27 m a unit; 5 cm steps).
- Colour, normal and style stay Uint8 / Int8 x3 (round 1).

Where: the worker snaps position, anchor and uv to their lattices BEFORE its
degenerate filter (`emit.js` `snapToLattice`, `toLattice`), so the filter, the
runs, the footing data, the partition and the normals all see exactly the
drawn coordinates, and a triangle the lattice collapses is dropped with the
other exactly-degenerate ones (148 triangles over the nine places beyond
round 1's filter; Paris 31 of 191,747). House
anchors are snapped the same way and still match their runs exactly. A tile
whose local extent does not fit keeps Float32 (none did). The main thread adds
each run's ground in whole lattice steps; the contact repair, the footings and
the facade-v shift write integer deltas from the run's record (`run.gq`,
`run.footQ`), recomputed from the sample each time, so repeated repairs never
accumulate rounding. `WpQuantAttribute` (`lib/fly/toy-world/wp-quant.js`)
reads and writes metres through `getX/getY/setY`, so three's bounding volumes
and raycasts and the night-light reader (`night-ground-sources.js`, `getY`)
see what they saw before. The GPU decode is a macro block inserted just before
`void main` of the vertex shader (position, uv, aBendAnchor) on the shared
architecture material, its CHUNK_FADE twins and the mesh's
`customDepthMaterial` (three's default depth material, decoded); the program
key gains `|wpq1a`. Before `main`, not at the top: three's `common` chunk has a
function parameter named `uv`, and a top-of-shader macro broke it (first smoke
run, 15,781 shader errors, fixed before any measurement below); the edit
refuses to build a program whose expanded main body declares a local named
like a decoded attribute. The quantized program is compiled with
`renderer.compileAsync` before its first mesh is shown (see 3), and the
prewarm scene compiles it.

Seams outside my files: `lib/fly/operations-scenery.js` (Gate to Gate's
building retirement at the observed airport walked positions with a stride of
3 and read anchors as metres: now `pos.itemSize` and `anchor.wpK`, marked
`// WORLD PASS B x Gate to Gate seam`); `lib/fly/prewarm.js` (the decoded
variant and its depth material in the warm scene when the flag, its sub and
`quantize` are on, marked `// WORLD PASS B x prewarm seam`).

Node: `scripts/wp-arrival-bytes.mjs` (per-attribute bytes on the recorded
inputs) and `scripts/wp-arrival-worker-prep.mjs` gate (f), new: the quantized
bundle is the OFF triangles with every vertex snapped to the lattices, minus
those the snap collapses; no ON triangle is degenerate on the lattice; runs
tile; house anchors match runs. **PASS; bundle bytes 98.0 -> 45.5 MiB over the
nine places (-53.6 %; round 1 was 63.0).** Per vertex (midtown): 60.9 B off,
43.2 B round 1, **31.2 B** now on the CPU; the GPU estimate (each 3-component
byte attribute counted as 4) 61.9 / 46.2 / **34.2 B**. With all four flags
LOOK's colour stays Float32 (its glass / opaque offsets put red above 1):
40.2 B.

Live, Ultra, `scripts/wp-arrival-r2-budget.cjs` (the budget tool's count, a
GPU estimate, a frame per pose), one page per arm, same session, all settled
except sf-hills (settle wait timed out in all three arms):

| pose | off: total / buildings MiB | ARRIVAL | all four | GPU estimate total: off / ARRIVAL / all four | draws off / A / all | triangles M off / A / all |
|---|---|---|---|---|---|---|
| paris | 413.5 / 320.4 | **246.0 / 152.9** | **239.6 / 190.7** | 419.6 / 261.4 / 249.0 | 383 / 372 / 384 | 6.41 / 6.47 / 7.16 |
| nyc-low | 309.0 / 210.7 | **196.3 / 98.0** | **190.8 / 122.8** | 313.3 / 206.5 / 197.2 | 386 / 384 / 384 | 4.54 / 4.48 / 5.46 |
| tokyo | 311.5 / 216.8 | 198.7 / 104.0 | 189.1 / 129.5 | 315.9 / 209.5 / 195.6 | 399 / 402 / 403 | 4.91 / 5.02 / 5.95 |
| phoenix-suburb | 250.6 / 168.4 | 161.1 / 78.9 | 121.7 / 67.3 | 253.9 / 169.3 / 127.4 | 369 / 548 / 370 | 2.71 / 3.06 / 3.14 |
| hongkong | 287.1 / 231.6 | 166.6 / 111.1 | 174.5 / 136.1 | 291.2 / 177.6 / 182.5 | 348 / 350 / 352 | 3.31 / 3.50 / 3.62 |
| sf-hills | 294.1 / 235.2 | 158.4 / 99.5 | 169.3 / 124.6 | 298.3 / 168.3 / 175.8 | 377 / 382 / 385 | 4.40 / 4.18 / 4.76 |
| iowa-farm | 39.4 / 2.8 | 38.1 / 1.6 | 35.7 / 0.9 | 39.5 / 38.3 / 35.8 | 282 / 294 / 296 | 0.26 / 0.26 / 0.25 |

High (`--quality=high`), same tool:

| pose | off: total / buildings MiB | ARRIVAL | all four | GPU estimate total: off / ARRIVAL / all four | draws off / A / all | triangles M off / A / all |
|---|---|---|---|---|---|---|
| paris | 413.5 / 320.4 | **246.0 / 152.9** | **239.6 / 190.7** | 419.6 / 261.4 / 249.0 | 477 / 333 / 325 | 4.57 / 4.53 / 4.51 |
| nyc-low | 309.0 / 210.7 | **196.3 / 98.0** | **190.8 / 122.8** | 313.3 / 206.5 / 197.2 | 326 / 329 / 321 | 3.50 / 3.51 / 3.46 |

(High keeps the same building ring as Ultra, so the bytes match Ultra to the
decimal; the horizon is smaller with REACH on.)

By the budget's own count (CPU arrays), Paris and nyc-low are under 256 MiB at
Ultra and High, flag alone and all four. **Stated plainly: by the GPU
estimate, which counts each 3-component byte attribute (colour, normal,
style) as 4 bytes because D3D11 has no 3-byte vertex format, Paris with the
flag alone is 261.4 MiB, 5.4 over.** What ANGLE actually stores cannot be read
from WebGL (see 8); if it pads, Paris ARRIVAL-alone is over the row on the GPU
by that much. The next lever is the style attribute (3 B a vertex, read on the
CPU by the night lights, so moving it into position.w needs a seam there). All
16 resident tiles were quantized at every city pose, 0 clamps, 0 console
errors, 0 page errors. Draws and triangles are unchanged by this stream
(phoenix-suburb's 548 draws in the ARRIVAL arm is CHUNK_FADE / settle
breathing, as round 1 noted; its triangles are higher because the ring held
more tiles at that moment).

The official tool (`world-pass-budget.cjs`, Ultra, paris and nyc-low):

| arm | pose | total MiB | buildings | draws | triangles M | first tile / full ring s | stuck | ground ms |
|---|---|---|---|---|---|---|---|---|
| ARRIVAL | paris | **246.0** | 152.9 | 384 | 6.41 | 27.1 / 28.5 | 0 | 1.87 |
| ARRIVAL | nyc-low | **196.3** | 98.0 | 535 | 4.80 | 4.1 / 6.3 | 0 | 1.97 |
| all four | paris | **239.6** | 190.7 | 384 | 7.16 | 23.4 / 28.4 | 0 | 2.18 |
| all four | nyc-low | **190.8** | 122.8 | 383 | 5.46 | 4.1 / 10.6 | 0 | 2.15 |

(Paris is the tool's first pose, so its first tile waits behind the cold
shader links of section 3; nyc-low is the warm arrival. 535 draws at nyc-low
is fade breathing, under 900.)

Look: off / ARRIVAL / all four side by side per pose (`cmp/<pose>-off-arrival-
all4.png`) and full-resolution crops off over ARRIVAL
(`cmp/{paris,nyc-low,hongkong}-crop-off-top-arrival-bottom.png`): the same
buildings, the same window grid on the same floors, the same roofs; the
visible differences are cloud shadows (running clock). Mean absolute pixel
difference off against ARRIVAL over the lower frame 3.5 to 12.2 (Paris the
largest, a cloud shadow over the Seine bank).

### 2. Ground query: the memo outlives the batch

`lib/fly/terrain-ground-query.js`. While armed, EVERY query (batched or not,
from any caller: the building engine, `getGroundAt` for REACH / GROUND / the
airport set, POI ground, terrain shadows) takes the memoised path. The walk
depends only on the tree's topology and its tiles' world matrices (tile boxes
are tested in X and Z only; a box's X/Z come from scale and matrixWorld); the
triangle test on each reached mesh's geometry, index, draw range, groups,
materials and their sides, bounding box and matrixWorld. So:

- a generation counter, bumped by hooks installed (only while armed) on the
  tile class (`add`, `remove`: every child-list change of the tree goes
  through them), the tile-mesh class (`setGeometry`, `syncGroups`,
  `syncMaterials`, `setMaterial`) and the root's `tile-loaded` /
  `tile-unload` events. An added subtree's matrices are brought current in
  the `add` itself (`updateMatrixWorld(true)`), so a tile never enters the
  memo with the identity matrix it has until the next render (flag on only;
  the value is the one the next render computes);
- per query, the map's world matrix is brought current exactly as the
  reference's `geo2world` does, and the root tile's matrixWorld, the root
  object and the projection are compared with the memo's snapshot (a
  floating-origin rebase moves the root);
- per use, each mesh record re-checks its own inputs and is rebuilt on any
  difference. Inside a batch these checks run once per batch.

Exact under churn, two ways:

- node, `scripts/wp-arrival-ground-churn.mjs`: the vendored three-tile and
  real TileMesh geometry, the fast path never told about a change: refine,
  merge, model replacement with a stale matrix, `setGeometry`, in-place height
  edits (operations-terrain's airport flattening), material side flips and
  swaps, groups resync, a full rebase, a map-only rebase with stale children,
  random interleavings. **PASS: 60,900 unbatched + 60,900 batched comparisons,
  0 differences.** Red check: with the memo never reset the gate fails at the
  first refine.
- live, `scripts/wp-arrival-r2-livediff.cjs`:
  `TerrainGroundQuery.prototype.sample` wrapped in the page, so every query of
  every instance during real arrivals (warp, 45 s, then 15 s of drift over
  refining terrain) is re-asked of the reference in the same synchronous call.

| run | place | live queries | differences | batched / unbatched calls | live us/call: batched / unbatched / reference | replay us/call: fast unbatched / fast batched / reference |
|---|---|---|---|---|---|---|
| 1 | sf | 339,118 | 0 | 173,119 / 165,999 | 2.31 / 4.45 / 13.43 | 1.91 / 1.19 / 11.99 |
| 1 | hk | 617,323 | 0 | 171,711 / 445,612 | 3.12 / 3.79 / 13.10 | 1.82 / 1.41 / 13.10 |
| 1 | nyc | 660,352 | 0 | 268,077 / 392,275 | 1.71 / 2.73 / 12.29 | 1.53 / 0.85 / 9.15 |
| 1 | owens | 794,637 | 0 | 63,784 / 730,853 | 1.56 / 2.02 / 8.32 | 1.56 / 1.19 / 7.99 |
| 2 | sf | 389,974 | 0 | 199,661 / 190,313 | 2.59 / 3.02 / 11.62 | 1.94 / 0.98 / 12.29 |
| 2 | hk | 636,328 | 0 | 174,624 / 461,704 | 2.83 / 3.42 / 12.71 | 1.23 / 0.83 / 8.79 |
| 2 | nyc | 667,014 | 0 | 267,050 / 399,964 | 2.11 / 2.39 / 11.90 | 1.77 / 1.24 / 11.66 |
| 2 | owens | 662,712 | 0 | 56,828 / 605,884 | 1.45 / 2.37 / 9.45 | 1.48 / 1.04 / 7.40 |

**Run 1: 2,411,430 live queries, 0 differences. Run 2: 2,356,028, 0
differences.** Memo resets (generation changes) 404 to 1,587 per place, record rebuilds 1 to
2 (run 1). Run 1 used the code at `579954e6`; run 2 the final code.

Honest timing: "live" is per call with `performance.now` around each call
(Chrome coarsens it; only means over hundreds of thousands of calls are
reported) and includes the walks after every reset while tiles stream. The
replay times the same recorded points in one synchronous loop on the settled
tree. Over both runs the public, unbatched path is 1.2 to 1.9 us a call on
replay (the reference: 7.4 to 13.1 us here, 16 to 21 us in round 1 under
heavier load) and 2.0 to 4.5 us live; the batched path 0.83 to 1.41 us on
replay and 1.4 to 3.1 us live. **The under-1-microsecond target is met for
the batched path on replay in three of eight place-runs (nyc run 1 0.85, sf
run 2 0.98, hk run 2 0.83) and missed in the other five (1.04 to 1.41); the
unbatched path never meets it (1.2 to 1.9 on replay), and no path meets it
live (1.4 to 4.5, with the walks after resets and timer cost included).** The
extra unbatched cost is, per call, the
map's world matrix update (as the reference does it), two 16-element matrix
compares and the record checks. I kept each because each is what makes the
answer provably the reference's; skipping the matrix update would be exact
only if nothing ever moved the map without updating it, which I cannot prove.

### 3. Frame pacing while the ring fills

`scripts/wp-arrival-r2-pacing.cjs`: one fresh page per run, a cold warp (the
page's first) to Midtown and then a warm warp to Paris; per warp, from the warp
until the ring is full (or 45 s): longest frame, frames over 33 / 100 ms, the
engine's worst finalize frame split into readiness checks / sliced walk and
guard / finalize proper / rest, and every shader program linked in that window
(`__flyStats.census.programs`, first use and ms). `--profile` adds a CPU
profile and the functions in the longest busy stretch.

Causes found:

1. **The multi-second cold frames are shader links, in every arm.** Profiled
   (`pacing-prof1`): the 10 to 11 s frame is `getProgramInfoLog` waiting on a
   link inside the post-processing composer (`postprocessing` index.js:6952,
   6.3 s) and the immersive cloud pass (3.7 s). The census names the same
   programs in the OFF arm (`ShaderMaterial#4b11b774` 3.9 to 5.8 s,
   `MeshStandardMaterial#b12bfbe9` 3.9 to 6.1 s). Not this stream's, not fixed
   here. The verifier's 2,391 ms (on) against 1,121 ms (off) cold frame is
   this class: which link lands in which frame moves from run to run.
2. **ARRIVAL added one link of its own**: the quantized building program
   (`MeshStandardMaterial#0e038cea`, 1.3 and 1.9 s in two of three cold
   pairs; absent in OFF). First fix (`70d91a57`): `renderer.compileAsync`
   before the first quantized mesh is shown (the mesh stays hidden until it
   resolves; `quantCompileMs`), and the prewarm scene compiles it. **That
   first fix did not work, and the pacing2 run showed it**: the two ARRIVAL
   cold runs that drew a tile inside the window still had a 2,236 / 2,398 ms
   frame. Cause (the trap `prewarm.js` documents): three keys a program on
   the output colour space of the BOUND target; the game draws into the
   composer's buffer (`srgb-linear`), while my compile ran against the canvas
   (`srgb`), so it minted a variant nothing draws and the real one still
   linked synchronously on the first frame. Fixed in `cc55d506`: the compile
   runs with a 1x1 render target bound, as prewarm does. Proof,
   `scripts/wp-arrival-r2-compilekey.cjs` (records the program three gives
   the building material right after the compile call and the one it draws
   with once shown): **old: different, key field 10 `srgb` vs `srgb-linear`
   (FAIL); fixed: the same program (PASS)**, `compilekey/compilekey-{old,fixed}.json`.
   The depth variant (`MeshDepthMaterial#06e8eeb6` / `#2d1350d1`) still links
   on the first shadow pass: 6 to 23 ms measured, cold and warm.
3. **The 41 to 76 ms finalize frames** (round 1's Paris 71.5 ms with all four;
   here in about a third of the pages, ARRIVAL and all four): `partition` 41 to
   60 ms, the main-thread re-partition of a dense tile, which ran whenever
   FLASH_GUARD dropped even one triangle on the main thread
   (`partitionFallbacks` 1). Fixed at the cost's cause: the sliced guard counts
   the kept triangles per worker region (`flash-guard.js`, `st.bounds` /
   `regionKept`), and the engine keeps the worker's partition with each region
   shortened instead of re-partitioning (`guardDropsKeptPartition`). Why a
   triangle can still drop on the main thread after the worker's filter: a
   triangle whose vertices belong to two runs can become exactly flat once
   each run gets its own ground. Any remaining fallback records its reason
   (`partitionFallbackWhy`).
4. One sliced run walk took 15.8 ms against the 3 ms slice: the deadline was
   checked every 256 runs; now every 64.
5. **All four flags, warm Paris: a 1.9 to 2.6 s frame in every pass-2 run**
   (pacing2, 2,604 / 2,299 / 2,207 ms; absent with ARRIVAL alone and off).
   Profiled (`pacing-prof2`, 1,943 ms): 1,878 ms in `getProgramInfoLog`
   under `CoastalReflectionRig.useFrame` -> `coastal-reflection.js:62`, the
   first-use link of the coastal water reflection program that one of the
   other three flags turns on (the census misses it because it is drawn
   outside the main render). The round-1 all-four "2.36 s first-use link"
   is this same program. Not this stream's; not fixed here.
6. Other streams' finalize: REACH's skyline engine finalizes up to 26 to 39 ms
   a tile (round-1 combined captures). Both engines go through the shared R24
   brake `mayFinalize` (`finalize-pace.js`), which admits at most
   `maxPerFrame` finalizes a frame across engines and refuses after the shared
   budget once one has run; the first admitted finalize of a frame is never
   refused, so one 39 ms skyline tile can share a frame with my slices. I did
   not slice REACH's finalize (their file; Open).

Round-2 first pass (`pacing`, code at `579954e6`, before fixes 2 to 4), three
interleaved pairs:

| pair | arm | cold: longest ms / >33 / >100 | warm: longest ms / >33 / >100 | warm first tile s / honest ground s | finalize frame max ms (warm) |
|---|---|---|---|---|---|
| 0 | off | 10,677 / 76 / 9 | 156 / 106 / 4 | 8.7 / 6.2 | - |
| 0 | ARRIVAL | 11,608 / 78 / 7 | 142 / 138 / 3 | 4.3 / 6.6 | 76.4 |
| 0 | all four | 11,297 / 63 / 8 | 165 / 78 / 2 | 4.1 / 5.6 | 44.2 |
| 1 | off | 12,259 / 74 / 8 | 186 / 129 / 4 | 7.9 / 5.2 | - |
| 1 | ARRIVAL | 10,736 / 74 / 9 | 134 / 85 / 1 | 3.5 / 5.1 | 49.1 |
| 1 | all four | 6,595 / 70 / 8 | 163 / 114 / 5 | 4.3 / 6.2 | 6.9 |
| 2 | off | 8,103 / 66 / 4 | 184 / 47 / 6 | 6.8 / 4.7 | - |
| 2 | ARRIVAL | 6,368 / 64 / 6 | 177 / 64 / 2 | 3.5 / 4.8 | 31.6 |
| 2 | all four | 6,192 / 53 / 9 | 151 / 54 / 2 | 3.7 / 4.9 | 8.1 |

(OFF has no `finalizeFrameMsMax`; its shipped per-tile finalize max was 99.5 /
128.3 / 99.8 ms at Paris. In the cold window OFF drew no detailed tile within
45 s in any pair.)

Second pass (`pacing2`, `70d91a57`: region-aware guard, finer slices, the
first, wrong-target compile), three interleaved pairs:

| pair | arm | cold: longest ms (2nd) / >33 / >100 | cold first tile s | warm: longest ms / >33 / >100 | warm first tile s / honest ground s | finalize frame max ms (cold / warm) | partition fallbacks |
|---|---|---|---|---|---|---|---|
| 0 | off | 15,953 (302) / 68 / 4 | none | 276 / 156 / 10 | none / 8.3 | - | - |
| 0 | ARRIVAL | 10,942 (**2,236**) / 83 / 6 | 17.8 | 164 / 155 / 4 | 4.6 / 6.8 | 18.4 / 4.8 | 0 |
| 0 | all four | 15,300 (443) / 63 / 4 | none | **2,604** / 116 / 4 | 7.9 / 9.3 | 0.6 / 7.6 | 0 |
| 1 | off | 17,733 (331) / 61 / 5 | none | 154 / 107 / 5 | 8.6 / 6.2 | - | - |
| 1 | ARRIVAL | 14,251 (299) / 57 / 4 | none | 181 / 116 / 5 | 4.1 / 5.5 | 0.4 / 7.4 | 0 |
| 1 | all four | 15,765 (295) / 77 / 11 | none | **2,299** / 127 / 8 | 6.6 / 8.6 | 0.7 / 7.2 | 0 |
| 2 | off | 14,430 (233) / 91 / 7 | none | 144 / 128 / 5 | 8.4 / 6.2 | - | - |
| 2 | ARRIVAL | 9,865 (**2,398**) / 92 / 6 | 17.2 | 119 / 79 / 1 | 3.3 / 4.9 | 8.5 / 4.0 | 0 |
| 2 | all four | 14,398 (256) / 64 / 6 | none | **2,207** / 112 / 3 | 6.3 / 8.0 | 0.2 / 5.6 | 0 |

The partition fallback is gone (0 in every run; the worst finalize frame
4.0 to 18.4 ms, the 18.4 a `records` + `partition` frame in a cold run under
the 10 s link). The bold frames are causes 2 (ARRIVAL cold) and 5 (all four
warm) above. OFF's shipped per-tile finalize reached 111 to 117 ms.

Final code (`pacing3`, `cc55d506`), three interleaved pairs:

| pair | arm | cold: longest ms (2nd) / >33 / >100 | cold first tile s | warm: longest ms / >33 / >100 | warm first tile s / honest ground s | finalize frame max ms (cold / warm) | partition fallbacks |
|---|---|---|---|---|---|---|---|
| 0 | off | 10,942 (2,238) / 92 / 5 | none | 148 / 100 / 4 | 7.7 / 5.7 | - | - |
| 0 | ARRIVAL | 8,617 (2,036) / 63 / 8 | 5.4 | 151 / 79 / 1 | 4.1 / 5.8 | 9.4 / 4.1 | 0 |
| 0 | all four | 6,779 (1,949) / 65 / 8 | 5.2 | 136 / 44 / 1 | 3.5 / 5.0 | 5.5 / 3.6 | 0 |
| 1 | off | 9,956 (2,844) / 96 / 7 | none | 141 / 79 / 6 | 7.4 / 5.3 | - | - |
| 1 | ARRIVAL | 11,688 (2,638) / 84 / 8 | 19.2 | 445 / 166 / 7 | 5.1 / 8.4 | 10.0 / 31.9 | 0 |
| 1 | all four | 15,061 (280) / 64 / 3 | none | 2,363 / 125 / 5 | 3.8 / 8.9 | 0.8 / 5.1 | 0 |
| 2 | off | 9,206 (2,008) / 61 / 5 | none | 151 / 90 / 4 | 7.6 / 5.7 | - | - |
| 2 | ARRIVAL | 17,740 (448) / 46 / 4 | none | 134 / 102 / 2 | 3.6 / 5.2 | 1.1 / 8.4 | 0 |
| 2 | all four | 13,443 (2,640) / 75 / 6 | 3.5 | 165 / 114 / 5 | 4.6 / 6.6 | 6.8 / 4.1 | 0 |

Read across the three passes:

- **Cold (the page's first warp):** the longest frame is 6.8 to 17.7 s in
  every arm, the OFF arm included (the shared links of cause 1; the census
  names the same two programs in all nine runs). The second-longest cold
  frame is now 2.0 to 2.8 s in the OFF arm too: the shared links land in two
  frames in some runs. ARRIVAL's own link (0e038cea) is gone from the census
  in all six on-arm cold runs, and ARRIVAL's second-longest cold frame (448 /
  2,036 / 2,638 ms) is inside the OFF arm's range (2,008 to 2,844). The cold
  rows are not a verdict on this stream either way: they are the composer and
  cloud links, which the census attributes to OFF identically.
- **Warm (Paris, second warp):** longest frame OFF 141 to 151 ms, ARRIVAL 134
  to 151 ms in two runs and 445 ms in one (no program linked in that window;
  the frame is not attributed), all four 136 to 165 ms in two runs and 2,363 ms
  in one (cause 5, the coastal reflection link). Frames over 33 ms: OFF 79 to
  100, ARRIVAL 79 to 166, all four 44 to 125: no difference I can claim from
  three pairs.
- **The engine's own finalize work in a frame** (`finalizeFrameMsMax`,
  slices included): 3.6 to 10.0 ms in 11 of 12 on-arm windows, against the
  OFF arm's shipped per-tile finalize of 106 to 116 ms at Paris. The 3 ms
  slice covers the run walk and the guard; the finalize proper of one tile
  (records, partition regions, attributes, mesh) is not sliced and measured
  0.7 to 7.8 ms. One window (ARRIVAL pair 1, warm) read 31.9 ms, all of it in
  the sliced `pre` phase, once in 18 windows; both sliced loops read the clock
  every 64 runs / 8,192 triangles, so I attribute it to a pause outside the
  loop's control (GC or preemption on a machine shared with other captures),
  not proven.
- **First detailed tile, warm:** ARRIVAL 3.6 to 5.1 s, all four 3.5 to 4.6 s,
  OFF 7.4 to 7.7 s; honest ground under the aircraft 5.0 to 8.9 s; the first
  tile lands before the terrain is honest in all six on-arm runs (section 7).

### 4. Worker pool: a build can no longer wait forever

`_guardBuild` races each pool build against `buildTimeoutSec` (20 s; dense
tiles build in 0.6 to 2.4 s); a timeout rejects, so the ordinary error path
re-queues the tile with its capped backoff, and the worker that owned it is
pinged (a no-op `setDiag` message, `pingTimeoutSec` 5 s). A worker that does
not answer is terminated and replaced (`SatBuildingLayer` hands the engine a
spawner), and every build still waiting on it rejects at once. A worker's
`error` event (a script that failed to load) triggers the same ping. With the
flag off none of it exists (one worker, no listener).

Proof, `scripts/wp-arrival-r2-killworker.cjs` (Paris, ARRIVAL, pool worker 1
terminated 2 s after the warp with 3 builds in flight on it): timeouts at 20
to 23 s, the ping failed and the worker was replaced at about 25 s, the three
tiles re-queued and built, nothing left in flight, full ring at 30.5 s.
**PASS** (`killworker/killworker.json`): `buildTimeouts` 3, `workerChecks` 1,
`workersReplaced` 1, 0 page errors, 0 console errors.

"Invalid or unexpected token": seen once (round-2 smoke 1, with React's
"Should not already be working"), in a page booted while I was editing engine
files: next dev rebuilt chunks under the running page, and a worker that
fetches a half-written chunk dies with exactly that SyntaxError and never
answers. That matches the verifier's run (3 builds stuck 184 s on a High
page). Not reproduced on a quiet server; the timeout and the `error` listener
cover it either way.

### 5. Eviction at boost: the ring behind the aircraft stays

The lead point moves the ring up to 0.8 r ahead at speed. Now (readiness on) a
drawn tile outside the lead ring stays resident while any of it is within r of
the AIRCRAFT and the resident building geometry stays under
`buildingBudgetMB` (160; the ring is counted first, then the kept tiles
nearest first; `behindKept`, `behindDropped`).

`scripts/wp-arrival-r2-boost.cjs` (Midtown, full ring, then 750 m/s on heading
220 for 10 s; the orbit camera turned 180 degrees through the input a
right-mouse drag feeds, yaw -3.14 measured): tile deaths behind the aircraft
while still within 4,400 m of it: **off 15, ARRIVAL 0, all four 0**; every
death with the flag on was 4,410 to 4,610 m behind (just outside the ring);
off's started at 3,256 m. Kept behind at the end: 9 (ARRIVAL), 7 (all four).
Frames `boost2/lookback-0-{off,arrival,all4}-t{4,8}.png`, composite
`cmp/boost-lookback-t8-off-arrival-all4.png` (looking back at Manhattan from
the Jersey shore 8 s in: the on arms keep the near waterfront blocks the off
arm has lost). Cost: up to +9 draws while kept; bytes bounded by the budget.

### 6. Footings: insurance, not a visible fix

`scripts/wp-arrival-r2-footing.cjs`: found the deepest footings live (ON) at
hk-slope, sf-slope and nyc-harbor, put a camera 220 m from each, and shot the
same pose off and on in the same session (`footing/*__{off,on}.png`,
`cmp/*-off-left-on-right.png`).

- The deepest footings (60 m, the cap) at Hong Kong and San Francisco were all
  computed on a **z12** drawn mesh, far from the aircraft where three-tile
  keeps the ground coarse; a z12 triangle spans hundreds of metres, so corners
  and centroid differ by tens of metres on a hillside. They are correct
  against the drawn ground and are recomputed when the mesh refines.
  Waterfront (nyc-harbor) footings were 10 m on z14.
- **No frame shows a gap in the control that the on frame closes**, at any of
  the six poses, and no frame shows a plinth or a sunk wall in the on arm
  (mean absolute difference 2.8 to 7.0, clouds). The footing is insurance: it
  guarantees the downhill wall reaches the drawn ground, which the shipped 6 m
  base sink already hides at every pose I found. Counters (on, cumulative):
  `footGaps` HK 518, SF 2,754, NYC 4,116.

### 7. First detailed tile, measured against the terrain's own arrival

The pacing probe stamps the first moment the ground under the aircraft answers
from a drawn mesh at z14 or finer (also engine counters `groundSec` /
`firstTileAfterGroundSec` with counters on). Warm Paris, round-2 first pass:
the honest ground arrives at 4.7 to 6.6 s in every arm, and with the flag on
the first detailed tile is drawn at **3.5 to 4.3 s, i.e. 0.6 to 2.4 s BEFORE
the terrain under the aircraft is honest** (it stands on the coarser drawn
mesh and re-seats in place); off arm 6.8 to 8.7 s. The "3 s after terrain"
target is met with margin. Cold: the honest ground under the aircraft was
often not reached inside the 45 s window (the first frames go to the shader
links above); the first tile landed at 3.9 to 5.6 s in four of six on-arm cold
runs and at 18 to 20 s in two. Final code (pacing3): warm first tile 3.5 to
5.1 s against honest ground 5.0 to 8.9 s, before the ground in all six
on-arm runs; cold first tile 3.5 to 19.2 s in four of six on-arm runs, OFF
none within 45 s in all three.

### 8. Small things

- `emit.js`: the comment now says colours pack as normalized Uint8 (3 B).
- The heal-in-place / contact-repair coupling is commented where the arrival
  chunk's records are made (`_finalizeArrival`): they never act on one chunk
  only because the heal loop skips every chunk with `drapeRuns` in Enhanced; a
  quantized chunk carries no `redrape` record, so a future caller degrades to
  evict-and-rebuild instead of writing metres into lattice steps.
- 3- versus 4-component layouts under ANGLE / D3D11
  (`scripts/wp-arrival-r2-vfmt.cjs`, blank page, upload + first draw +
  `gl.finish`, medians of 9, 4 M vertices): uint8 x3 0.9 ms / x4 1.2 ms, int8
  x3 0.8 / x4 1.1, int16 x3 6.0 / x4 8.0, float32 x3 9.5 ms. **No conversion
  cost is visible for the 3-component byte layouts: they are not slower than
  4-component ones** (at 400 k vertices every layout was 0.2 to 0.5 ms, under
  the timer's resolution). What ANGLE stores on the GPU cannot be read from
  WebGL, so the GPU estimate in 1 assumes the worst (4 bytes). Colour, normal
  and style stay 3-component (4 would add CPU bytes for no measured gain);
  position is 4-component Int16 because that is native.

### Gates at the final commit

- Flags-off worker proof, `node scripts/world-pass-worker-proof.mjs --check
  c2bf5c06 --ignore-protocol`: **IDENTICAL (top-level protocol field masked):
  1062/1062 cases identical, 7308 buffers + 1062 meta objects compared
  against 'c2bf5c06'; 28 stage cases (0 bad); 0 unrecorded inputs; 180.9 s.**
  No worker file changed after this run.
- Node: `graphics-unit` PASS; `verify-true-earth-flags` 11 passed, 0
  failed; `verify-stylized-earth` PASS 22/22 (all worker consumers agree on
  protocol 26); `verify-city-horizon` PASS; `verify-building-handoff` 4/4;
  `verify-attribution` 4 passed, 0 failed; `verify-terrain-ground-query` PASS
  875 real-mesh comparisons; `wp-look-shader` 17 passed; `wp-reach-node-bench`
  PASS G1-G5; `wp-arrival-worker-prep` PASS (quantized 98.0 -> 45.5 MiB);
  `wp-arrival-ground-churn` PASS 60,900 + 60,900 comparisons, 0 differences.
- Browser, this session: `wp-arrival-r2-livediff` PASS twice (0 differences),
  `wp-arrival-r2-killworker` PASS, `wp-arrival-r2-compilekey` PASS (fixed) /
  FAIL (old), budgets and pacing as above, 0 page errors in every run.
- `npx eslint` on every file changed since `d40dfd25`: clean.
- `scripts/r24-b-prewarm-proof` fails at `d40dfd25` as well (pre-existing;
  not caused by the prewarm seam).

### Still open (round 2)

- Paris ARRIVAL-alone by the GPU estimate (3-byte attributes padded to 4):
  261.4 MiB, 5.4 over 256; within budget by the budget tool's CPU count.
  Unknown whether ANGLE pads.
- Ground query under 1 us: met only for nyc batched on replay.
- Cold first-use program links of shared passes (post-processing composer
  `ShaderMaterial#4b11b774`, `MeshStandardMaterial#b12bfbe9`, immersive
  clouds): 6.8 to 17.7 s frames in every arm, OFF included; not this
  stream's.
- The coastal reflection program's first-use link with all four flags
  (1.9 to 2.6 s, warm Paris; `coastal-reflection.js:62`): another stream's.
- One unattributed 31.9 ms finalize window (sliced `pre` phase, once in 18)
  and one unattributed 445 ms warm frame (ARRIVAL pair 1, no link in the
  window).
- The finalize proper of one tile is not sliced (0.7 to 7.8 ms measured).
- The quantized depth program still links on its first shadow pass (6 to
  23 ms measured).
- REACH's skyline finalize (26 to 39 ms a tile) is admitted by the shared
  brake as a frame's first finalize; slicing it is REACH's.
- The footing has no visible gap to close at any pose found (insurance).
- The owner's RTX 5080 motion check.

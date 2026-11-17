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

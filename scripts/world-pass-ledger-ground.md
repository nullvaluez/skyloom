# World Pass ledger, stream E GROUND (`WORLD_GROUND`)

Branch `world/ground`, from W0 `ac26a77e`. Flag `WORLD_GROUND` (sub-switches
`trees`, `bridges`), desktop High and Ultra only, latched once per page through
`lib/fly/world-pass.js`. `?flags=WORLD_GROUND` turns it on for one page load.

## What was built

### M1 trees (`ground.trees`): ONE placer at real canopy density

- **Worker, `lib/fly/toy-world/worker/ground-canopy.js` (new).** Called from
  `worker/sat-veg.js` only when `tileCtx.worldPass.ground.trees` is set. A
  jittered lattice over each z14 tile (10 m true spacing, jitter 0.92 of a
  cell, so it never reads as an orchard). A candidate becomes a tree with a
  probability from the ground it stands on: WorldCover 2021 tree (10) or
  mangrove (95) 0.95; OpenFreeMap landcover wood without WorldCover tree 0.55;
  parks, gardens, cemeteries 0.16; residential landuse 0.13 (0.06 when the tile
  is arid); WorldCover shrubland 0.10; commercial/industrial 0.02; WorldCover
  built-up outside any landuse 0.035; open sport ground and farmland 0.
  Keep-outs on a 1024 x 1024 raster per tile (about 1.8 m at New York): roads
  and rail by class width plus a 1.2 m kerb (paths 2 m, no kerb), water
  polygons and waterways, aeroway polygons, runways with 45 m clearance, the
  airport scenery mask and operations airport surfaces; any keep-out cell in
  the 3 x 3 neighbourhood rejects. Buildings: footprint fill plus a 2.5 m wall
  clearance from a chamfer distance field, which also caps a crown's radius so
  it never pushes through a wall. Species by latitude, region, urban, arid and
  scrub with slow stand noise (FableFlight port, below); size and height per
  species. Every tree sits in a fixed hierarchy (L1 2 x 2 cells, L2 4 x 4,
  L3 8 x 8); each level carries an area-preserving merged patch pointing at its
  children. Output `out.wpCanopy` (`l0..l3` typed arrays); a tile with no tree
  emits nothing. The legacy rows are still emitted unchanged (house lights and
  parcel anchors read them), the layer just stops drawing them.
- **Engine, `lib/fly/toy-world/sat-veg-engine.js`.** Latched `wpTrees`: the
  ring reaches the patch distance (Ultra 25 chunks / 4.4 km, High 16 / 3.6 km;
  `maxChunks` keeps its legacy value because SatParcelHomes sizes its per-chunk
  cap from it), a 33 x 33 drape grid per chunk on the drawn terrain mesh, and an
  in-place re-grid of the nearest three ready chunks whose grid is older than
  6 s (the drawn mesh refines z12 -> z17 as you approach; a grid sampled on the
  coarse mesh buried crowns by up to 27.9 m before this, measured).
- **Layer, `components/fly/WpCanopyLayer.jsx` (new), mounted by SatVegLayer in
  place of its legacy pool.** Two instanced draws sharing the cinematic tree
  material: crowns (the existing 34-triangle leaf-card crown) and patches (a
  new 10-triangle crossed leaf-card clump; a smooth dome read as an egg next to
  the crowns, so it was replaced). Placement (`lib/fly/ground-canopy-select.js`,
  new, pure): all L3 cells sorted nearest first, descend while close (crowns to
  d0, L1 patches to d1, L2 to d2, L3 to d3, faded over the last 14 %); a full
  crown pool turns further cells into patches, a full patch pool stops the walk
  (distance cut, never tile order). Re-run on a 2 s cadence, or after moving
  8 % of d0 (at least 0.25 s apart), or every 0.1 s while a chunk's birth ramp
  runs; skipped when nothing it reads changed. Matrices are written straight
  into the attribute. Ground: each crown queues an exact `getGroundAt` sample
  (cached per row with its zoom, re-sampled after 5 s while below z17, 0.6 ms a
  frame, nearest first); until then the chunk grid; the nearest 256 crowns also
  ride the existing near-contact support. Shadows: crowns cast into cascade 0
  only (an `onBeforeShadow` that zeroes the count for every orthographic shadow
  camera wider than the narrowest seen the previous frame); patches never cast.
- **Colour and season, `lib/fly/ground-canopy-photo.js` (new).** Per chunk, four
  z15 Esri tiles through the existing `imageSlotFetcher` (r25-color-ref),
  linear-averaged to 128 x 128. SEASON: mean green / red of the photo under the
  chunk's deciduous crowns -> leafiness L = smoothstep(1.12, 1.30, g/r), one
  value per chunk for its life. Excess green does NOT separate the seasons in
  this imagery (z15, darker half of the tile: leaf-off Central Park 0.13 and
  Prospect Park 0.17, leaf-on Powell woods 0.22), g/r does (Central Park 1.13,
  Prospect Park 0.97 leaf-off; Powell 1.27, Tijuca 1.41, Bois de Boulogne 1.77
  leaf-on; scratch probe in the session, not committed). Deciduous crowns blend
  from a bare twig colour taken from the photo (L = 0) to FableFlight's leaf
  tint (L = 1); conifers and evergreens always take the leaf tint. A chunk is
  drawn only once its look exists (photo or, after two failed tries, species
  colours and `season: 'none'`).
- **LivingForest, `lib/fly/living-forest.js`.** Latched `wpReplaced`: `update()`
  returns at once, so the forest builds no tile and issues no draw.

### M2 bridges (`ground.bridges`): a deck for every mapped bridge

- **Worker, `lib/fly/toy-world/worker/ground-bridges.js` (new),** called from
  `worker/sat-roads.js` only when `tileCtx.worldPass.ground.bridges` is set.
  Every transportation line with `brunnel=bridge` (motorway to service, rail,
  transit) becomes a chain clipped to the z13 tile, subdivided to <= 20 m, with
  width by class, a clearance target and its two ends marked LANDING (an
  original endpoint inside the tile) or OPEN (cut at the tile edge). Clearance:
  over water 5.5 m + 3.5 % of the length over water, 6 to 45 m (x 0.6 below
  primary); over land 5.5 m per OpenStreetMap `layer`; a span under 25 m 2.5 m.
  Landmark bridges (the six of `lib/fly/poi/landmarks.js`, as capsules along
  their span, 260 m either side; the curated heading is a compass
  approximation, the Golden Gate's deck sits about 20 degrees off at its ends)
  and marquee exclusion discs are left to their models. Pass 2 of the glow
  ribbon skips bridge chains (their light moves onto the deck).
- **Layer, `components/fly/WpBridgeLayer.jsx` (new), mounted by SatRoadLayer.**
  Builds one merged mesh (one draw, its shadow into cascade 0 only) from the
  road engine's ready chunks within 7 km (+2.5 km): every station samples the
  drawn ground; the deck runs between its landing grounds plus the clearance,
  eased in over clearance / 6 % at each landing end (an open end stays at
  clearance), never closer than 0.15 m above its ground; deck top with centre
  dashes and edge lines and sodium light pools after dusk (same night ramp
  shape as the road glow), sides carried 1 m up as parapets, a soffit, piers
  every 35 m (60 m on decks over 15 m) where the deck stands more than 3 m up.
  Rebuilt when the chunk set changes and every 4 s for 40 s after, while the
  terrain under the decks refines. A rebuild is a job of at most 1.5 ms a
  frame (one deck at a time); the finished geometry swaps in one frame. Lean:
  every deck to 4 km, only decks of 10 m clearance or more to 7 km, piers
  every 50 m (90 m on decks over 15 m) only where the deck stands 4 m up,
  36 bytes a vertex, a vertex ceiling of 200 k at Ultra and 100 k at High,
  filled nearest chunk first.
- **Engine, `lib/fly/toy-world/sat-road-engine.js`:** keeps `result.wpBridges`
  on the ready chunk when latched on.

### The arrival hold (`lib/fly/ground-arrival.js`, new)

Ground detail waits for the buildings: while `runtime.worldLoading` is true,
or while the satellite building ring is armed and has not resolved every
desired tile since its last arm or warp (stream B's W0 arrival clock, read
only), for at most 75 s. While held, the canopy fetches one photo look at a
time instead of three, takes no exact per-crown ground samples, re-grids
nothing and requests only the legacy ring's nearest chunks (nothing resident
is evicted); bridge decks are not rebuilt.

## Design decisions and why

- **Keep the legacy rows in the bundle.** SatHouseLights falls back to the
  residential scatter rows and SatParcelHomes reads the parcel anchors; the
  new lattice is a separate key so nothing downstream changes. Cost: the legacy
  scatter still runs (and its `buildEarthSurfaceMask` is the dominant worker
  cost of a sat-veg tile, see Open).
- **Hierarchy in the worker, choice on the main thread.** The worker knows the
  tile; only the main thread knows where the camera is. Fixed cells make each
  tree's level a pure function of its cell's distance, so a tree is never drawn
  twice and never missing (gate `wp-ground-unit` 2a).
- **Leaf cards for patches, not domes or impostor atlases.** The first build
  used an 18-triangle dome: from 650 m on it read as rows of eggs against the
  leaf-card crowns (frame `e2`). Crossed leaf cards on the same atlas and
  material read as the same woods, at 10 triangles.
- **Exact ground per crown.** Rule 4 says the drawn mesh. The first build stood
  crowns on the chunk grid and buried 378 of 402 sampled crowns by more than
  1 m (max 27.9 m) at Central Park, because the grid was sampled on a coarse
  mesh level. Per-row exact samples plus the age re-grid brought that to 0.
- **Season from g/r, decided once.** Rule: "anything that changes what a thing
  is, is decided once". A chunk's leafiness is computed once from its photo.

## Ported techniques (credit line for CREDITS.md, FableFlight, MIT)

- `src/trees.rs` lines 742 to 837 (`species_weights`): ported in
  `worker/ground-canopy.js` `speciesWeights` (altitude term dropped: the worker
  has no ground).
- `src/trees.rs` lines 915 to 984 (jittered lattice, stand noise
  `0.15 + 2.2 n^2` per species at 140 m, species pick) and `vnoise` (208-215):
  ported in `buildCanopyLattice` / `vnoise`.
- `src/trees.rs` LEAF table (130-145): `SPECIES_LEAF` in
  `lib/fly/ground-canopy-select.js` (round 2: used only as the 15 % hue pull
  and the no-photo fallback). The round-1 crown tint (985 to 991, leaf x 0.55 +
  photo x 0.495) is no longer used: round 2 takes the colour from the photo.
- `src/buildings.rs` lines 135 to 143 (`hash`): `hashU` / `hash2`.
- `src/roads.rs` lines 580 to 640 (landing heights interpolated along the
  deck, a clearance target, piers at a fixed spacing): the approach of
  `WpBridgeLayer.jsx`, written new, not line-ported.
- `src/roads.rs` lines 189 to 235 (`bridge_end`): CORRECTED in round 2. Round 1
  credited it but did not implement it (an end was a landing whenever it was
  inside the tile). Round 2 implements only its idea, written new: an end
  within 2.5 m of another bridge way's end or vertex is not a landing. The
  merge of same-class ways that meet end to end, before the ramps are
  computed, is this pass's own and is not in FableFlight.

## Shared-file edits

- `lib/fly/fly-constants.js`: only the `WORLD_GROUND` block (main-thread
  `canopy` tunables per tier; `worker.canopy.spacingM`). `enabled:false` kept.
- No edit to `vector-tile.worker.js`, `worker/{geom,tile-ctx,result,stages}.js`,
  `sat-buildings/index.js`, `world-pass.js`, `world-pass-stages.js` or
  `FlyScene.jsx`. `WORKER_PROTOCOL` unchanged. The worker never stamps `wp`
  (stream B's job).
- Files outside the E list that this stream touched: none. `SatVegLayer.jsx`,
  `SatRoadLayer.jsx`, `sat-veg-engine.js`, `sat-road-engine.js`,
  `worker/sat-veg.js`, `worker/sat-roads.js` and `living-forest.js` are E's.

## Seam requests

- **Stream B (worker dispatch):** when `ground.trees` or `ground.bridges` is on,
  the sat-veg / sat-roads bundles carry new keys (`wpCanopy`, `wpBridges`);
  please stamp `result.wp` for 'sat-veg' and 'sat-roads' too so a flag-arm
  change can never mix bundles.
- **Earth surface (no owner in this pass):** the bridge's photo still lies flat
  on the water under the new deck (it reads as the deck's shadow at noon, a
  second deck at low sun). A water-class repaint under mapped bridge decks
  would remove it; `earth-surface-mask.js` keeps roads photographic on purpose.
- **Budget tool:** `scripts/world-pass-budget.cjs` puts `wp-bridge-decks` in
  "other" (no veg/tree name); trees land in "veg" by name.

## Measurements

### Flags-off byte identity

`node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`,
run after each worker change and last on the final tree:
`IDENTICAL (top-level protocol field masked): 1062/1062 cases identical, 7308
buffers + 1062 meta objects compared against 'c2bf5c06'; 28 stage cases (0
bad); 0 unrecorded inputs`. Main-thread changes are each behind one latched
read (`worldPassOn('ground', 'trees' | 'bridges')`, taken once in a
constructor or a mount-time `useMemo`): SatVegLayer (legacy pool vs
WpCanopyLayer), SatVegEngine (ring, grid, re-grid, canopy key, stats keys),
LivingForest (`update()` returns), SatRoadEngine (keeps `wpBridges`),
SatRoadLayer (mounts WpBridgeLayer). With the flag off every one of them takes
its pre-existing path; the only new code that runs flag-off is the boolean read.

### Gates

`node scripts/graphics-unit.mjs` PASS; `verify-true-earth-flags.mjs` 11/11
(one failure on the way: a comment in the worker named the flag block, fixed);
`verify-stylized-earth.mjs` 22/22; `verify-city-horizon.mjs` all PASS;
`verify-building-handoff.mjs` 4/4; `scripts/wp-ground-unit.mjs` (new) 6/6:
the worker's edge-bucketed polygon fill equals `paintSurfacePolygon` on 400
random polygons at 256 and 1024 (0 differing cells of 15.8 M), every tree is
drawn exactly once across levels, a full crown pool degrades to patches, the
patch cap stops the walk, no chunk places nothing.

### M1 canopy cover against WorldCover (crowns as discs; "sum" is the review
probe's metric, sum of crown areas / real canopy; "union" is the crown union
rasterised at 2 m inside real canopy / real canopy)

Live, Ultra, RTX 5080, `scripts/wp-ground-live.cjs --quality=ultra
[--flags=WORLD_GROUND]` then `scripts/wp-ground-canopy-dump.mjs <pose>.dump.json
600|900`. "Before" counts every DRAWN tree of the legacy SatVeg pool and every
LivingForest stand (a stand as a disc of its geometry's bounding radius, an
upper bound: a stand is six cards with gaps), both at their drawn scale.

| pose | real canopy 600 m (km2, share) | before 600 m sum / union | after 600 m sum / union | before 900 m sum / union | after 900 m sum / union | after: crowns on WorldCover tree | union outside canopy (% of disc) |
|---|---|---|---|---|---|---|---|
| central-park | 0.686 (60.6 %) | 11.1 / 9.7 | 43.3 / 36.3 | 11.1 / 9.5 | 39.7 / 34.1 | 98 % | 0.7 |
| brooklyn | 0.148 (13.1 %) | 8.2 / 7.6 | 37.6 / 28.1 | 6.9 / 6.4 | 36.6 / 30.1 | 93 % | 0.7 |
| paris | 0.076 (6.7 %) | 10.0 / 8.3 | 42.1 / 27.8 | 21.7 / 16.3 | 42.3 / 32.4 | 77 % | 0.7 |
| powell | 0.263 (23.3 %) | 50.5 / 42.3 | 65.8 / 51.5 | 33.6 / 28.8 | 64.4 / 52.8 | 91 % | 1.5 |
| phoenix-suburb | 0.097 (8.5 %) | 2.6 / 2.2 | 35.7 / 23.3 | 3.8 / 2.3 | 36.5 / 23.5 | 80 % | 0.8 |
| iowa-farm | 0.007 (0.7 %) | 5.0 / 2.6 | 64.7 / 44.2 | 7.2 / 6.0 | 64.8 / 45.1 | 93 % | 0.1 |
| rio (pose is over the bay: no canopy within 900 m) | 0 | - | - | - | - | - | - |

Rio's forest is measured in node instead (the review's other measure: every
streamed row, the same worker and selection code, `scripts/wp-ground-canopy-node.mjs`,
Ultra, results `.graphics-review/world-pass/ground/node-ultra-2.json`), at a
point in the Tijuca forest (-22.955, -43.255): real canopy 1.078 km2 within
600 m; legacy rows 0.3 % sum, the new crowns 77.4 % sum / 61.8 % union; within
900 m 70.7 / 61.6. Node, same table for the seven poses: before (legacy rows)
0.2 to 7.7 % sum, after 40.7 to 77.4 % sum, 26.3 to 61.8 % union inside 600 m.

The crowns not on WorldCover tree (Paris 23 %, Phoenix 20 %) are the park,
yard and street trees of residential and built fabric, by design.

### M1 placement truth (no tree on a roof, a road, water or a runway)

Node, every crown centre within 600 m and 900 m at the eight node places
(about 20,000 crowns) tested against the tile's own building and water
polygons, road centrelines (half the class width, no kerb) and aeroway
polygons and runways: **0 / 0 / 0 / 0 / 0** at every place (the first build,
on a 512 raster, had 14 roofs, 4 roads and 7 water at Central Park; the 1024
raster with a 3 x 3 keep-out test brought all to 0).
Ground contact, live (`wp-ground-live.cjs`, a sample of up to 400 drawn
crowns against `getGroundAt` at the crown): after the per-crown exact samples,
0 crowns buried or floating by more than 1 m at all nine poses (the base sits
the configured 0.4 m into the ground); before that fix 378 of 402 at Central
Park were buried by more than 1 m, max 27.9 m.

### M1 cost (live, Ultra, settled pose, `wp-ground-live.cjs`)

| pose | trees off: draws / instances / triangles / KiB | trees on: crowns / patches / triangles / KiB | whole frame draws off -> on | whole frame triangles off -> on (M) |
|---|---|---|---|---|
| central-park | 38 / 849 / 34 k / 600 | 4,420 / 5,216 / 202 k / 1,762 | 395 -> 371 | 4.39 -> 5.06 (with bridges, shadow passes included) |
| brooklyn | 35 / 1,129 / 46 k / 595 | 905 / 8,326 / 114 k / 1,762 | 401 -> 394 | 4.43 -> 4.68 |
| paris | 38 / 740 / 27 k / 582 | 796 / 7,182 / 99 k / 1,762 | 383 -> 371 | 6.42 -> 6.62 |
| powell | 65 / 5,521 / 243 k / 1,320 | 2,987 / 14,000 / 242 k / 1,762 | 353 -> 326 | 0.90 -> 0.92 |
| phoenix-suburb | 35 / 571 / 23 k / 575 | 696 / 10,034 / 124 k / 1,762 | 371 -> 357 | 2.71 -> 2.84 |
| iowa-farm | 16 / 54 / 2.5 k / 470 | 103 / 536 / 8.9 k / 1,762 | 281 -> 282 | 0.26 -> 0.27 |

Trees on: 2 draws + 1 shadow submission (cascade 0), against 16 to 65 draws for
SatVeg + LivingForest off. Hard bound by pool size: Ultra 8,500 x 34 + 14,000 x
10 = 0.429 M triangles, High 4,400 x 34 + 7,000 x 10 = 0.220 M; GPU memory
1.7 MiB (instance matrices, colours, phases, the two geometries), both tiers
under the 0.5 M / 0.25 M / 3 draws / 16 MiB line. JS heap: the worker's
lattice arrays, about 0.4 to 1.6 MB per chunk.
Worker cost per z14 tile (node, `msBy` in the stats): 30 to 130 ms typical
for the lattice itself after the fill fix; the legacy sat-veg scatter's own
`buildEarthSurfaceMask` (unchanged, it runs flag off too) is the larger cost in
dense cities (about 0.45 s per Tokyo tile in node). Placement pass on the main
thread: 0.6 to 13.5 ms (Powell, both pools full), run at most every 0.25 s
while moving, every 2 s at rest.

### M2 bridges

Node, every bridge chain of a 3 x 3 block of z13 sat-roads tiles around each
place (`node scripts/wp-ground-bridges-node.mjs`, results
`.graphics-review/world-pass/ground/bridges-node.json`):

| place | bridge features | chains | over water | left to a landmark model | clearance p50 / p90 / max (m) | longest (m) |
|---|---|---|---|---|---|---|
| tokyo-bay | 872 | 1,183 | 437 | 0 | 5.5 / 16.5 / 45 | 4,918 |
| nyc-top | 502 | 552 | 65 | 0 | 5.5 / 11 / 24.2 | 2,489 |
| london | 169 | 493 | 94 | 21 (Tower Bridge) | 5.5 / 11 / 16.5 | 3,117 |
| paris | 291 | 370 | 55 | 0 | 5.5 / 8.6 / 11 | 1,008 |
| nyc-bay | 411 | 366 | 43 | 93 (Verrazzano) | 5.5 / 11 / 20.8 | 2,399 |
| brooklyn | 353 | 263 | 20 | 93 (Brooklyn Bridge) | 5.5 / 11 / 20.8 | 2,399 |
| sf-golden-gate | 43 | 43 | 1 | 3 (Golden Gate) | 5.5 / 5.5 / 5.5 | 343 |

Live, Ultra, RTX 5080, settled pose, flag on
(`node scripts/wp-ground-live.cjs --url=http://localhost:3325 --pose=<list>
--quality=ultra --flags=WORLD_GROUND --out=...`, results
`.graphics-review/world-pass/ground/live-on-m2/live-ultra.json`). "Height" is
the highest point of a deck above the lower of its two landing grounds.

| pose | decks drawn | piers | triangles | vertices | GPU MiB | height p50 / max (m) | heights <3 / 3-8 / 8-15 / 15-30 / 30+ |
|---|---|---|---|---|---|---|---|
| tokyo-bay | 695 | 2,339 | 109,888 | 134,160 | 5.9 | 11 / 46.1 | 36 / 153 / 313 / 174 / 19 |
| central-park | 279 | 675 | 36,200 | 43,832 | 1.7 | 9.2 / 44.8 | 19 / 111 / 110 / 36 / 3 |
| nyc-bay | 214 | 666 | 30,704 | 37,744 | 1.5 | 11 / 31 | 29 / 57 / 92 / 35 / 1 |
| brooklyn | 192 | 551 | 24,448 | 30,392 | 1.2 | 7.4 / 27.7 | 26 / 73 / 75 / 18 / 0 |
| paris | 192 | 180 | 10,664 | 13,640 | 0.5 | 7.2 / 21.8 | 30 / 73 / 80 / 9 / 0 |
| phoenix-suburb | 25 | 30 | 1,760 | 2,200 | 0.09 | 5.7 / 11.4 | 2 / 20 / 3 / 0 / 0 |
| rio | 13 | 1 | 352 | 464 | 0.02 | 5 / 11.3 | 3 / 9 / 1 / 0 / 0 |
| powell | 7 | 10 | 504 | 640 | 0.03 | 4.8 / 15 | 1 / 4 / 1 / 1 / 0 |
| iowa-farm | 0 | 0 | 0 | 0 | 0 | - | - |

One draw (plus one cascade-0 shadow submission) at every pose; an empty set
issues none (`visible = false`). The first build, before the lean pass, drew
1,904 decks at Tokyo for 260,400 triangles and 19.4 MiB; now 109,888 and
5.9 MiB. The bound is the vertex ceiling: Ultra 200 k vertices (about 164 k
triangles, 7.2 MiB + index), High 100 k (about 82 k triangles, 3.6 MiB).
The rebuild at Tokyo took 250 ms of ground samples in ONE frame before it was
made a job; it now runs as 120 frames of at most 1.5 ms (251.5 ms in all,
`live-on-m2b`). Landmark bridges are not drawn twice: Verrazzano, Brooklyn,
Tower and Golden Gate chains are all left to their models (the Golden Gate
needed the capsule test on 50 m stations, 260 m either side: its mapped deck
sits up to about 20 degrees off the curated heading at its ends). Frames
`e4/crop-bridge.png` against `e4/crop-bridge-off.png`: the Rainbow Bridge
approach at Tokyo on piers against the flat photo.

### Arrival (the building ring with the flag on)

`node scripts/world-pass-budget.cjs --url=http://localhost:3325
--pose=powell,central-park,tokyo-bay --quality=ultra [--flags=WORLD_GROUND]
--out=...`. Seconds from the ring arm to the first building tile and to the
full ring (B's W0 counters).

| run | venue | powell first / full | central-park first / full | tokyo-bay first / full |
|---|---|---|---|---|
| off (`budget-off`) | GPU slot free at once | 15.6 / 57.2 | 11.0 / 55.5 | 7.7 / 21.1 |
| on, before the hold (`budget-on`) | slot after 157 s | 40.0 / 76.3 | 19.2 / 61.8 | 8.0 / 55.7 |
| on, with the hold (`budget-on2`) | slot after 473 s | 39.9 / 77.0 | 16.9 / 53.1 | 6.8 / 19.6 |
| off control (`budget-off2`) | slot after 162 s | 37.0 / 73.7 | 11.1 / 53.5 | - |

The Powell gap was the venue, not the flag: the off control taken under the
same contention (other streams' captures sharing the machine) reads 37.0 /
73.7 against the on arm's 39.9 / 77.0. With the hold, the full ring is within
4 % of the off control at Powell and Central Park and back to the off number
at Tokyo (19.6 against 21.1; it was 55.7 before the hold). What is left is the
FIRST tile at Central Park, +5.8 s (16.9 against 11.1), see Open. The settled
scenes are the same in both arms: buildings 25.4 MiB / 227.5 MiB / 75.0 MiB
(Tokyo 74.3 off) and the same parcel homes. Frame `on2/powell__noon.png`
(after the hold) shows the town and its homes; the earlier `on/powell__noon.png`
was taken before the ring had arrived.

## Open

1. **Central Park's first building tile arrives about 6 s later with the flag
   on** (16.9 s against 11.1 s, one run each under contention); the full ring
   is not later. The canopy worker's lattice runs on the sat-veg worker (its
   own thread) but competes for cores; the hold does not pause the worker.
   Not separated further in this pass.
2. **The owner's RTX 5080 motion check has not run.** Nothing here was judged
   in motion: crowns re-standing when a row's exact sample lands (the shift is
   the coarse-mesh error, up to metres before the per-crown sample), the patch
   fade at d1 to d3, a deck rebuild swapping in as the terrain refines.
3. **Placement pass cost**: 0.6 to 13.5 ms on the main thread (Powell, both
   pools full), at most every 0.25 s while moving and every 2 s at rest. A
   13 ms pass is a visible hitch at 120 Hz; it should be a sliced job like the
   bridge rebuild.
4. **Bridge photo under the deck**: the imagery still shows the bridge flat on
   the water under the new deck (reads as its shadow at noon, a second deck at
   low sun). Seam request above (earth-surface repaint under mapped decks).
5. **Bridge ends meet the drawn ground, the roads do not rise**: a landing
   end eases down to the ground over clearance / 6 %, but the approach road
   ribbon beyond the end stays on the ground, so a multi-level interchange
   reads as decks over flat roads.
6. **Season is per chunk, from the photo**: evergreen-looking leaf-off
   imagery (a winter photo of a conifer stand) is right, but a chunk with
   too little tree photo (Σw < 25) borrows its nearest judged neighbour's
   season, and with none takes leaf-on.
7. **Rio's pose is over the bay**: no canopy within 900 m of it, so Rio's
   forest is measured in node (Tijuca) only.
8. **The worker's `buildEarthSurfaceMask` for the legacy scatter** still runs
   with the flag on (its rows feed house lights and parcel homes): about
   0.45 s per Tokyo tile in node. Dropping it when the canopy is on needs the
   two consumers moved to the lattice first.
9. **Stream B seam** (resolved in round 2: ARRIVAL's wrapper stamps them): `result.wp` is not stamped on sat-veg and sat-roads
   bundles (request above).

## Round 2

2026-11-17. Built on the wave-1 integration head (`git merge d40dfd25`,
protocol 26, ARRIVAL's ground-query batch). `WORLD_GROUND` stays
`enabled:false`. Every live number below is this machine's RTX 5080, Ultra,
1600 x 900, through the stream's own dev server (:3325), on the live world as
OpenFreeMap serves it after its 2026-11-15 planet update; every before/after
has its own control shot in the same session from the same server. The GPU
was shared with other streams' captures the whole time (three-slot lock
always full), so every timing number is noisy; all runs are reported.
Frames: `.graphics-review/world-pass/r2/ground/` in this worktree, copied to
`mystifying-curran-97a006/.graphics-review/world-pass/r2/ground/`
(`control/`, `own-flag/`, `all-flags/`, plus `look-a/` with the round-1 arm
`*-r1.png`, the arrival and motion runs, and the montages `m-*.png`).

Instruments (committed):
- `scripts/wp-ground-verify-look.cjs` (new): per pose and time, three frames
  from one held pose a few frames apart: as drawn (A), every tree mesh hidden
  (B, the photo the trees cover), every tree drawn flat magenta (M, their
  mask). Over the mask: coverage, mean sRGB distance |A - B|, mean CIE76
  delta E, and the luma ratio crowns / photo. Flag off it hides and masks the
  legacy SatVeg pool and every LivingForest stand instead.
- `scripts/wp-ground-verify-arrival.cjs` (the verifier's, extended): one page
  per arm, Paris then Powell then Central Park, every second for 60 s: the
  building ring's first tile and full ring (W0 counters pinned on in both
  arms), parcel homes, house lights, tint, and the legacy ring's own stats.
- The wave-1 verifier's probes, copied: `wp-ground-verify-live.cjs` (now also
  names the drawn mesh a crown stands in), `-motion.cjs` (now also the
  placement-slice histogram over the flight window), `-tier.cjs`,
  `-cover.mjs`, `-joints-osm.mjs` (the raw OpenFreeMap joint count).
- `scripts/wp-ground-bridges-node.mjs` grew an independent joint count: for
  every end the worker marks LANDING it re-reads the tile's raw bridge ways
  and asks whether a way that is not part of that chain has an in-tile vertex
  within 2 m (a way "is part of" a chain when it runs on along the chain from
  that vertex). Also the `result.wp` stamp count and the longest chain.
- `scripts/wp-ground-unit.mjs`: 9 gates (was 6): the view cone, sigma and the
  dissolving edge.
- `scripts/wp-ground-r2-poses.json`: world-pass-poses.json plus `tijuca` and
  `powell`.

### 1. Night bridge lights (blocking) - FIXED

Was: a sodium "light pool" term in the deck shader, full deck width every
42 m: cream and black zebra stripes at Tokyo bay and Midtown at night. And
the flat glow ribbon of EVERY bridge way was dropped from flag-on 'sat-roads'
builds, though decks are drawn only to 4 km (7 km at 10 m clearance) and
under a vertex ceiling, so far bridges went dark (landmark bridges too: their
ribbon was dropped and they get no deck).

Now:
- The pool term is gone (deck program key `-wp-bridge-deck-v2`).
- The deck carries the flat road's own night ribbon: a second merged mesh
  (`wp-bridge-glow`, +1 draw) on the ROAD ENGINE'S SHARED MATERIAL (same
  program, same uniforms: the same glow, lamp dots and traffic as the road it
  continues), one ribbon per deck whose way has a ribbon on the ground (class
  1 to 6; service roads, rail and transit have none on the ground either),
  0.3 m above the deck top, narrowed to the deck width, the worker's quad
  layout (so the R23 lane side attribute is derived the same way).
- The worker no longer drops bridge ribbons. With the flag on it records each
  bridge way's index range and three probe points in the road chunk
  (`wpBridges.ribbon`, stride 8). After each deck rebuild the layer blanks the
  ranges whose probes all lie within 12 m of a drawn deck station in that
  chunk's own index buffer (keeping a pristine copy) and restores them when
  the deck goes; a road chunk rebuilt since is re-checked once a second. A
  bridge beyond the deck range or over the vertex ceiling keeps its flat glow.
  Node, 9 tiles a place: flag-on ribbon vertices now equal flag-off (Tokyo bay
  82,492 = 82,492; was 74,616), 667 ribbon rows at Tokyo bay.
- Frames (same session, same server): `m-r1-on-off.png` top row: round 1
  zebra deck, round 2 lit road on its deck, control flat glow. `m-night.png`:
  Tokyo bay and Midtown at night, own flag against control. Full frames
  `own-flag/tokyo-bay__night-on.png`, `control/tokyo-bay__night-off.png`,
  `own-flag/nyc-mid__night-on.png`, `control/nyc-mid__night-off.png`, and
  `own-flag/*-final.png` on the final code.
- Not measured: a numeric "stripe" metric; the claim rests on the frames.

### 2. Powell parcel homes (blocking) - FIXED

Cause, confirmed in code: with the canopy on, the veg engine (a) widened the
ring every consumer reads from 16 to 25 chunks (High 16), (b) drew every
chunk on a 33 x 33 grid of the drawn mesh instead of 5 x 5 (1,089 samples
instead of 25 inside the same 0.8 ms/frame sampling budget, so the legacy
chunks became ready much later), and (c) under the hold left the outer chunks
unrequested so the settled fraction lagged. SatParcelHomes' settle gate reads
that ring's stats.

Now the engine is the legacy engine for everyone but the canopy:
- the legacy grid (`gridSegments` 4), its heal and its commit are untouched;
  the canopy's fine grid is a separate per-chunk `wpGrid`, its own budgeted
  jobs after the legacy samples (no fine sampling during the arrival hold);
- `engine.legacy` is a view of the legacy ring computed exactly as the
  flag-off engine computes its whole ring (its own lead centre, radius
  SAT_VEG.ring.r, maxChunks, ring-hold and residency rules): `nearest()`
  filtered to it, its own `stats` (chunks, ready, queued, building, sampling,
  settled fraction, its own supportRevision), `groundAtLocal`, `groundAtNear`,
  `maxChunks`. SatParcelHomes, SatTintLayer, SatHouseLights, SatAmbientLife
  and the runtime bus (`runtime.satVeg`, read by SatGroundDetailLayer and
  world readiness) get the view; only WpCanopyLayer gets the engine;
- the legacy ring is requested first, and is always kept by the wide ring.
Flag off, `legacy` is the engine itself.

Measured, Paris to Powell to Central Park in one page per run, interleaved
(on,off / off,on ...), 8 pairs before the stricter hold of item 7 plus 4
pairs after it (12 pairs, 24 pages):

| arm | Powell homes at 15 / 30 / 45 s | first home (s) | legacy ring ready / chunks at 30 s |
|---|---|---|---|
| on (12 runs) | 97 to 98 in 12 of 12 | 8 to 12 | 9 / 9 |
| off (12 runs) | 97 to 98 in 12 of 12 | 8 to 10 | 9 / 9 |

Montage `montage-powell-arrivals-t30.png` (left on, right off, runs 1 to 8,
30 s after the warp): the subdivision is there in all 16. The wave-1
verifier's 1 of 5 used the old engine; it was not re-run on that code here.
What the other consumers see: the legacy ring is 9 ready of 9 in both arms at
every arrival (the full engine holds 16 to 19 chunks with the flag on). House
lights read 0 in both arms (noon), tint verts 0 in both arms (SatTintLayer is
not mounted under stylized earth); the ambient movers were not compared.
Their ground heights come from the same legacy grid in both arms by
construction. Not measured: house lights at night, ambient life counts.

### 3. Bridge landings - FIXED (and the credit corrected)

Was: an end was a LANDING whenever it lay inside the tile, so the joint
between two OSM bridge ways was eased toward the ground (or the water).

Now (worker, `ground-bridges.js`):
- runs of one class that meet end to end, and only each other, are MERGED
  into one chain before the ramps are computed;
- any other end within 2.5 m of another bridge run's end or vertex
  (including a landmark bridge's run, kept for this test only) is OPEN;
- each OSM way keeps its own clearance target (round 1's rule, per way),
  carried per station (`wpBridges.clr`), with the change between two ways
  ramped at the deck grade (6 %) on the lower side, so a water span's
  approach viaduct climbs to it and the merged crossing never steps (the
  first merge gave the whole 7.8 km Yurikamome loop the water clearance;
  per-way targets fixed that before anything shipped).

Node, 3 x 3 z13 tiles a place, the replayed inputs (independent count, see
Instruments):

| place | landing ends that are joints, before | after | chains before -> after | ways merged | longest chain before -> after (m) |
|---|---|---|---|---|---|
| tokyo-bay | 725 of 2,215 (32.7 %) | 0 of 1,469 | 1,183 -> 976 | 209 | 4,918 -> 7,848 |
| nyc-mid | 435 of 1,040 (41.8 %) | 0 of 594 | 552 -> 435 | 120 | 2,489 -> 2,947 |
| paris | 174 of 707 (24.6 %) | 0 of 534 | 370 -> 334 | 40 | 1,008 -> 1,008 |
| brooklyn | 192 of 494 (38.9 %) | 0 of 306 | 263 -> 221 | 46 | 2,399 -> 2,399 |
| nyc-bay | 234 of 681 (34.4 %) | 0 of 437 | 366 -> 321 | 50 | 2,399 -> 2,399 |

The "before" figures match the verifier's raw count (753 of 2,267, 456 of
1,051, 190 of 733 on the newer planet). A long multi-way crossing: Tokyo
bay's longest chain is the Yurikamome transit line over the Rainbow Bridge
approach loop, 7,848 m, 442 stations, both ends open (cut at the tile edge),
clearance 13.7 to 30.3 m with the largest change between two stations
1.19 m (20 m apart, the 6 % grade); Midtown's is a 2,947 m rail crossing
(both ends real landings), 5.5 to 11.3 m, largest step 1.14 m. Frames:
`own-flag/tokyo-bay__noon-final.png`. Not measured live: the drawn deck
height profile along a chain (the node clearance profile and the frames
are the evidence).

Credit: round 1 credited FableFlight `src/roads.rs` 189 to 235 (`bridge_end`)
without implementing it. The "Ported techniques" list above is corrected:
round 2 implements only its idea (the `near` test), written new; the merge
and the per-way ramps are this pass's own.

### 4. Crown look - FIXED by measure, with one visible residue

Was (round 1): broadleaf crowns drew as the shared 3-layer leaf-card crown
(a cone in silhouette); leaf-off crowns were solid brown; leaf-on crowns kept
the species colour (FableFlight's tint), lime at Tijuca.

Now:
- FORM: one instanced attribute (`aWpDens`: density, conifer) bends the
  crown in the vertex shader: broadleaf crowns get a wider rounded top (top
  layer x 1.3), conifers taper to a cone; cones only where the species table
  says conifer.
- COLOUR: each crown takes the linear mean of the photo around it (3 x 3
  pixels of the 128 x 128 chunk photo for crowns, 5 x 5 for L2 and L3
  patches), pulled 15 % toward its species' hue at the photo's brightness
  (leaf-on only), conifers 12 % darker, +-7 % per-tree jitter, times
  `PHOTO_GAIN` 1.1 (measured: at 1.0 the noon crown/photo luma was 0.77 to
  1.02, mean 0.89, over five places).
- LEAF-OFF: density 0.42 (rising to 1 with leafiness): fragments are
  dithered out (interleaved gradient noise, a per-instance phase), so a bare
  crown is a twig haze over the ground photo. The shadow pass dithers the
  same.

Crowns against the photo they cover, same frame (look probe; delta E76 over
the tree mask, and luma crowns / photo). Control = today's trees (legacy
SatVeg + LivingForest); round 1 = this stream's wave-1 code, captured in the
same session by checking out its files on the same server; round 2 = the
final code (PHOTO_GAIN 1.1):

| shot | control dE / luma | round 1 dE / luma | round 2 dE / luma | round 2, all five flags |
|---|---|---|---|---|
| central-park noon | 22.8 / 0.27 | 15.1 / 0.86 | 10.8 / 0.91 | 10.5 / 0.89 |
| central-park golden | 8.2 / 0.57 | 13.1 / 1.50 | 9.6 / 1.30 | 9.5 / 1.35 |
| central-park night | 5.6 / 0.22 | 5.0 / 0.70 | 3.9 / 0.76 | 3.8 / 0.80 |
| tijuca noon | 13.6 / 0.55 | 15.3 / 1.03 | 10.3 / 1.01 | 10.3 / 1.00 |
| powell noon | 30.6 / 0.35 | (no mask: not measured) | 13.3 / 0.99 | 13.3 / 0.99 |
| paris noon | 13.5 / 0.54 | 17.4 / 0.71 | 14.4 / 0.82 | 14.8 / 0.81 |
| paris night | 7.9 / 0.26 | 7.4 / 0.51 | 5.8 / 0.61 | 5.8 / 0.60 |
| brooklyn noon | 31.6 / 0.27 | 18.8 / 0.91 | 15.6 / 1.11 | 16.0 / 1.13 |
| phoenix-suburb noon | 28.6 / 0.39 | - | 23.2 / 0.64 | 20.0 / 0.79 |
| iowa-farm noon | 47.5 / 0.13 | - | 13.5 / 0.90 | 13.5 / 0.91 |
| sf-hills noon | 20.5 / 0.48 | - | 16.5 / 0.95 | 16.2 / 1.03 |

Read with care: the mask is a different set of pixels in each arm (round 2
covers 10 % of the Central Park frame, round 1 16 %, control 4 %; a leaf-off
round-2 crown is 42 % of its pixels), so dE compares how well each arm's own
trees sit in the photo, not the same pixels. Golden hour stays brighter
than the photo (1.30). Paris noon is the least improved (14.4 against 13.5 for
the control's few trees). Frames: `m-r1-on-off.png` rows 2 and 3 (round 1 /
round 2 / control at Central Park and Tijuca), `m-look-a.png`.
Visible residue: at 900 m the leaf-off dither reads as a fine screen-door
grain in the Central Park frames, and Tijuca's far L3 patches show a faint
regular dot pattern (reduced by a 0.3-radius position and +-12 % size jitter
on L2/L3 patches, not removed).

### 5. Dense forest - FIXED at Tijuca (static)

Now: the plan skips L3 cells outside the camera's view cone (horizontal half
field of view + 0.6 rad) beyond `keep` (max(1.25 d0, 900 m)) and re-plans on
a 15-degree camera turn; distances d0 to d2 scale by a screen-size factor
sigma that drops (x 0.85, floor 0.3) after a pass that ran out of pool and
recovers (x 1.06) when both pools have 20 % room; the outer edge dissolves
by dithered density over the last 14 % of d3, or of the farthest planned
distance when a pool ran out, with per-cell jitter so it is no circle.

Tijuca noon, live: round 1 crowns 8,500 / patches 14,000, 6,819 cells cut,
farthest tree 1,614 m; round 2 8,500 / 13,869, 0 cut, farthest 4,236 m
(the d3 of 4,200 m plus a patch radius), sigma 1 (the cone alone made room).
Frame `m-r1-on-off.png` row 3, `own-flag/tijuca__noon-on.png`. Not measured:
a flight over Tijuca (the edge in motion), and sigma below 1 live (the unit
gate covers it).

### 6. Motion cost - FIXED

The placement pass is a job: plan (generator, yields on a deadline) ->
instance writes into staging arrays -> one swap. 1.2 ms deadline, checked
every 16 writes, every 8 L3 cells in the walk and every 128 in the distance
pass. Crown exact samples and the writes run inside ARRIVAL's
`beginGroundBatch` / `endGroundBatch` (a no-op unless WORLD_ARRIVAL arms it).

Straight line at 120 m/s for 24 s, Ultra (`wp-ground-verify-motion.cjs`),
every run (frame ms p50 / p95 / p99; frames over 50 ms):

| run | central-park on | central-park off | powell on | powell off |
|---|---|---|---|---|
| A1 (slices at 1.5 ms/64 writes) | 23.5 / 51.4 / 111.8; 64 | 21.1 / 45.7 / 105.2; 57 | 12.2 / 23.1 / 47.4; 21 | 14.7 / 25.9 / 65.3; 29 |
| A2 | 19.5 / 43.7 / 100.3; 50 | 21.8 / 51.9 / 110.7; 71 | 16.4 / 36.5 / 84.9; 44 | 15.4 / 29.2 / 64.8; 35 |
| A3 | 24.1 / 53.1 / 105.7; 66 | 19.3 / 40.2 / 96.0; 49 | 12.9 / 23.6 / 45.7; 19 | 12.1 / 23.9 / 48.9; 22 |
| B1 (stricter hold, yields) | 18.8 / 41.5 / 88.1; 53 | 17.3 / 41.4 / 82.3; 50 | 11.3 / 22.5 / 49.3; 23 | 11.2 / 22.4 / 41.6; 15 |
| B2 | 20.7 / 44.4 / 104.0; 58 | 20.3 / 45.3 / 113.6; 58 | 13.7 / 26.6 / 58.8; 27 | 11.8 / 25.4 / 47.3; 20 |
| B3 | 22.5 / 53.3 / 121.6; 67 | 23.1 / 47.4 / 116.4; 57 | 12.8 / 27.2 / 53.9; 27 | 17.0 / 31.3 / 72.0; 28 |
| C1 (final slices) | 27.9 / 69.8 / 141.0; 84 | 24.2 / 53.7 / 116.0; 64 | 18.3 / 37.1 / 79.0; 38 | 18.5 / 36.6 / 82.3; 40 |

(Arms ran on, off / off, on / on, off in A and B.) C1 ran while another probe of this
stream was capturing, so its on arm shared the GPU with it. The frame times
are dominated by the shared machine; no run separates on from off beyond
that spread. The PLACEMENT slices, in the flight window only: B runs 77 to
105 slices <= 1.5 ms and 284 to 353 between 1.5 and 3 ms a run, one 3-6 ms
and one > 6 ms in all six; C1 (final) Central Park 527 <= 1.5 ms and 4 of
1.5 to 3 ms, Powell 691 and 1. Wave 1: one pass up to 11.6 ms (Central Park)
and 15 ms (Powell) in one frame.

### 7. Arrival - FIXED

The hold now stops photo looks (was one at a time) and every fine-grid job
(was: first fine grids still sampled), on top of round 1's (no exact samples,
no ring growth, no deck rebuilds).

| pairs | Central Park first tile on / off (s), mean | full ring on / off, mean | Powell first on / off | Powell full on / off |
|---|---|---|---|---|
| 8, before the stricter hold | 7, 6.2, 7.7, 5.5, 6.7, 7.7, 4.9, 5.9 / 8.8, 7.5, 9.5, 5.9, 6.2, 8.4, 6.2, 7.8; 6.5 / 7.5 | 27.2, 24, 23.5, 24.3, 17.4, 29, 29.3, 29.1 / 26.7, 27.7, 21.7, 21.9, 24.1, 25.8, 18.4, 20.7; 25.5 / 23.4 | 4.7 / 4.6 | 12.6 / 11.5 |
| 4, final hold | 4.9, 5, 5, 5 / 9, 6.6, 8.7, 8.3; 5.0 / 8.1 | 23, 19.1, 16.7, 17.8 / 21.8, 18.8, 25.7, 24.5; 19.1 / 22.7 | 4.2 / 4.3 | 9.8 / 10.6 |

With the final hold the flag delays neither the first tile nor the full ring
at either place in these 4 pairs; before it, the full ring was about 1 to 2 s
later on average (within the spread). Wave 1's +6 s first tile at Central
Park did not reproduce in any of the 12 pairs.

### 8. Keep-outs - NOT FIXED (cause found for one of the six)

Added in the worker: the marquee monument models' exclusion discs and every
procedural landmark monument (25 to 120 m discs by height) are painted into
the footprint raster (so the wall clearance applies). Re-measured live
against DRAWN buildings (`wp-ground-verify-live.cjs`, now naming the mesh):
crowns standing more than 3 m under a drawn roof: Brooklyn 1, Paris 5,
Central Park 0, Powell 0 (wave 1: 1 / 5); crowns with at least 2 of 8 edge
points under a roof: 13 / 30 / 2 / 4 (wave 1: 13 / 30 / 2 / 5). Every one of
the six is under a `sat-buildings` mesh, not a monument:
- Brooklyn (-73.96785, 40.67456): the crown is in a courtyard (inside an outer
  ring, inside a hole) of a 43-ring, 22 m OpenFreeMap building; the drawn
  roof covers the courtyard at 26 m. The building engine fills that hole
  (stream A/B's files), so the canopy is right to put a tree there.
- Paris (2.3364, 48.8508 and 2.3324, 48.8547): not inside any z14 building
  ring on the live planet, 1.8 to 3.8 m from the nearest footprint (5 m and
  26 m tall), yet a drawn roof 28 to 34 m up covers them. Source not
  identified this round.
What would fix it: the canopy taking its building keep-out from what the
building worker draws (its admitted footprints after hole handling and
TRUTH's typology) rather than the raw layer, or the building engine
respecting inner rings. Neither is in E's files.

### 9. Paris night specks - FIXED by measure

The crowns take 30 % of the ground lamp pools (night-ground.js's receiver,
string-patched in the canopy's own program); at 100 % every crown near a
street lamp lit up cream. Warm-bright pixels (luma > 110, red > blue + 20)
inside the tree mask, Paris night: round 1 232 (0.45 % of the mask), round 2
51 (0.15 %), control 36 (0.21 %). Crop `m-paris-night.png` (round 1 / round
2 / control): a few remain.

### 10. Budget - HOLDS on draws and triangles, geometry over at Paris (not E)

All five flags, Ultra, `world-pass-budget.cjs` (one run each):

| pose | draws | triangles (tool) | + canopy cascade-0 shadow | geometry MiB (E: trees / decks) |
|---|---|---|---|---|
| central-park | 383 | 6.03 M | 4,419 x 34 = 0.150 M -> 6.18 M | 235.4 (1.9 / 2.1) |
| tijuca | 332 | 2.16 M | 8,500 x 34 = 0.289 M -> 2.45 M | 114.1 (1.9 / -) |
| paris | 372 | 7.19 M | 796 x 34 = 0.027 M -> 7.22 M | 298.2 (1.9 / 0.6) |
| nyc-low | 372 | 5.58 M | at most 0.289 M -> <= 5.87 M | 231.0 (1.9 / -) |

Draws <= 900 and triangles <= 8 M everywhere, counting the shadow
submission explicitly (whether the tool's renderer total already includes
the shadow pass was not checked, so it may be counted twice). Geometry: Paris
is over 256 MiB with buildings alone (247.4 MiB); this stream's share is
about 2.5 MiB there. The canopy now publishes `triangles` and
`shadowTriangles` in its stats; its hard bound is Ultra 8,500 x 34 x 2 +
14,000 x 10 = 0.718 M (High 0.369 M), plus the decks' vertex ceiling (200 k
vertices Ultra, deck + glow together).

### 11. Seams

- `result.wp`: ARRIVAL's wrapper (`// WORLD PASS B`) stamps every result of a
  request with any stream on, so the stamp is already there: node, flag on,
  97 of 97 'sat-veg' canopy bundles and 9 of 9 'sat-roads' bundles a place
  carry the request key; flag off 0. Both engines drop a mismatched bundle
  (`worldPassMatch`). No seam edit was needed.
- The bridge's photo on the water under each deck: not fixed. What would:
  an earth-surface repaint under mapped decks, i.e. the terrain shader
  taking a "covered by a deck" mask (the deck chains rasterised into the
  ground-plan raster the second wave proposes) and drawing water colour
  there; `earth-surface-mask.js` keeps roads photographic on purpose and has
  no owner in this pass. Not cheap or safe inside this round.

### 12. The verifier's probes - DONE

Copied as `scripts/wp-ground-verify-{live,motion,tier,arrival}.cjs`,
`-cover.mjs` and `-joints-osm.mjs` (paths made relative), and extended as
noted above.

### Gates (final commit)

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`:
  IDENTICAL, 1062/1062 cases, 7308 buffers + 1062 meta objects, 28 stage
  cases (0 bad), 0 unrecorded inputs.
- `graphics-unit.mjs` PASS, `verify-true-earth-flags.mjs` 11/11,
  `verify-stylized-earth.mjs` 22/22, `verify-city-horizon.mjs` PASS,
  `verify-building-handoff.mjs` 4/4, `wp-ground-unit.mjs` 9/9.
- eslint on every changed file: no new errors (`SatVegLayer.jsx` keeps its
  5 react-hooks/immutability errors, the same 5 at `c2bf5c06`).
- WORKER_PROTOCOL unchanged (26). The worker reads only the request.
- Flag off, nothing new runs per frame: SatVegLayer passes `engine.legacy`,
  which is the engine; the engine's only new work is behind `wpTrees` /
  empty `wpPending`; SatRoadLayer still mounts no WpBridgeLayer.

### Open after round 2

1. Item 8 (six crowns under drawn roofs; a building-engine hole fill at
   Brooklyn, an unidentified drawn roof at Paris).
2. The owner's 5080 motion check: crowns standing up as exact samples land,
   the patch fade, the dithered edge in flight, the leaf-off screen-door
   grain at distance, deck rebuild swaps.
3. Golden hour crowns are brighter than the photo (luma 1.30).
4. The bridge photo under decks (item 11).
5. Not measured: house lights at night and ambient movers with the flag on
   against off; the deck height profile live; sigma < 1 live; a Tijuca flight.
6. Round 1's Open 5 (approach roads stay on the ground), 6 (season per
   chunk) and 8 (the legacy scatter's surface mask cost) stand.

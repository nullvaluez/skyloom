# Vendored three-tile v0.12.1 (R22 W0)

Upstream: `three-tile@0.12.1` (npm), license **MIT** — declared in the
package's own `package.json` (`"license": "MIT"`); the published package
ships no separate LICENSE file (README has no license section either), so
the package.json declaration is the license of record. Author: shitou
(https://github.com/sxguojf/three-tile).

## Why vendored (the R21 vendored-composer precedent)

R22 needs three changes no public API reaches:

1. The **martini mesh-error table** is a module-private closure
   (`const le = Ee(21)` — dist/index.js:441, consumed as `le[e] || 0` at
   :498 and :674). No export touches it, so the DEM decimation curve
   (z13 = 91 m, z14 = 38 m of tolerated vertical error) is unreachable
   without editing the module.
2. Per-tile **imagery + DEM are fetched serially** (`loader.update` awaits
   material THEN geometry — dist/index.js:860-870).
3. The **LOD evaluation bail** (`downloadingThreads + 4 >= maxThreads`,
   dist/index.js:184-192) stalls the whole tree's refinement once 6 tiles
   are in flight.

Monkey-patching was rejected: (1) is a closure; (2)/(3) are unexported
private methods of unexported classes.

## Files

| File | Provenance |
|---|---|
| `index.js` | byte-verbatim copy of `node_modules/three-tile/dist/index.js` (1,986 lines) |
| `plugin.js` | `node_modules/three-tile/dist/plugin/index.js` (6,257 lines) with its ONE `from "three-tile"` import rewritten to `from "./index.js"` — mandatory: the plugin registers its ArcGis/LERC loaders into the `LoaderFactory` singleton of whichever copy it imports; a split registration would target a factory the map never consults |

The npm dependency stays in package.json pinned at 0.12.1 as the diff base.

## Patch ledger (append one row per change; OFF = verbatim upstream behavior)

Every switch lives in the `FLY_PATCH` object at the top of `index.js` and is
driven **only** by `lib/fly/terrain-engine.js` (`setFlyPatch` / `setDemErrorTable`,
both re-exported from the vendored module). All default **OFF**, in which case
each patched site executes the byte-equivalent upstream expression.

| # | Owner | Switch | What | Status |
|---|---|---|---|---|
| — | — | — | W0: verbatim copy, zero behavior change | landed |
| 1 | A TERRA | `parallelFetch` | `TileLoader.update` (index.js ~:861) awaited `updateMaterial` **then** `updateGeometry` — two serial round-trips per tile against two independent Esri endpoints. ON wraps them in `Promise.all`; `syncGroups()` still runs after both resolve. OFF keeps the original serial pair verbatim. | landed, R22 W1 |
| 2 | A TERRA | `lodBailFix` | `Tile._update` (index.js ~:184) **returned** whenever `downloadingThreads + 4 >= maxThreads`. Because the walk is depth-first from the root, that truncated the entire remainder of the tree for the frame — including the deep near-camera tiles that sort last in DFS order. ON keeps walking while busy but starts no work (no `_updateModel`, no `LOD()`), so the thread budget is spent by whoever the walk reaches rather than by a fixed DFS prefix. OFF is the original `if (!(busy \|\| loading))` guard. | landed, R22 W1 |
| 3 | A TERRA | `demErrorTable` | The martini decimation targets for the LERC DEM path. **The VENDOR.md premise above was wrong and is corrected here:** `le = Ee(21)` at :441 is *not* the table this app's DEM uses. `TerrainLercLoader.doLoad` posts the blob to an embedded worker (the `fe` source string, ~:1118) which decodes **and decimates** inside itself, carrying its own copy of the curve (`P = W(21)`, consumed by `ie()`). The patch therefore (a) threads an optional `errTable` parameter through the worker's `ie()`/`le()`/`onmessage` — absent ⇒ upstream's `P[z]||0` exactly — and (b) adds `errTable` to the message `TerrainLercLoader.doLoad` posts. `le` at :441 is left **byte-verbatim**: it serves only the Mapbox terrain-rgb / terrain-dem loaders and `TileGeometry.setData()`, none of which this app uses. | landed, R22 W1 |
| 4 | A TERRA | *(exports only)* | Three new named exports — `setFlyPatch`, `setDemErrorTable`, `flyGetPatch` — appended to the export block. No upstream export was renamed, removed or reordered. | landed, R22 W1 |
| 5 | B STUTTER (R22.1) | `skirtEdges` | `getBoundaryEdges` (`We`, index.js ~:673) — the skirt builder's boundary-edge finder, run ON THE MAIN THREAD for every DEM tile inside `TerrainLercLoader.doLoad` → `TileGeometry.setAttributes` → `addSkirt`. Upstream allocates 3·T two-element arrays, sorts them with a JS comparator running four `Math.min`/`Math.max` per comparison (~165k comparator calls on a 4k-triangle tile), then de-duplicates adjacent reverse pairs. **Measured as 67% of every stalled millisecond** in the live low-AGL stutter (scripts/r22p1-b-stutter.md; 1,107 ms of a 30 s window, bursting because `Tile._loadSubTiles` resolves four children in one microtask drain). ON counts each undirected edge in a module-scoped open-addressed Int32Array table (generation-stamped, reused, zero per-tile allocation) and keeps the ones seen once. OFF is the original body verbatim. | landed, R22.1 |
| 6 | B STUTTER (R22.1) | *(exports only)* | Three new named exports — `flyBoundaryEdgesFast`, `flyBoundaryEdgesRef`, `flySkirtStats` — appended to the export block so `verify-frame-pace` can prove output identity on live tile index buffers and prove the fast path was exercised (`{fast, bail, upstream, tris}`) rather than merely armed. No upstream export was renamed, removed or reordered. | landed, R22.1 |
| 6a | A MOTION HOLD (R24) | `mergeDwellMs` | `Tile.LOD` (index.js ~:211). A merge verdict now has to be WANTED CONTINUOUSLY for `mergeDwellMs` before `_removeSubTiles` may run; any non-merge evaluation clears the stamp and the clock re-arms from zero. `LOD()` returns `s` on every path exactly as upstream — the only difference is WHEN the merge happens. OFF (`0`) is the verbatim upstream line. See "Patch #6a — why the settled tree is unmoved" below. | landed, R24 |
| 6b | A MOTION HOLD (R24) | `frustumPenalty` | `Tile._getDistRatio` (index.js ~:273) — the `t * 5` applied to an out-of-frustum tile becomes `t * (FLY_PATCH.frustumPenalty \|\| 5)`. **SHIPS AT 5, i.e. byte-equivalent to upstream**; it exists so the multiplier can be swept rather than re-typed. A null/0/absent value also restores 5, so a malformed constants block cannot change the world. NOT swept in R24 (plan §7) — it moves the SETTLED tree, and the budget it spends is verify-aerial's texture-bytes gate, not the Owens draw ceiling (out-of-frustum tiles issue zero draws). | landed OFF-by-value, R24 |
| 6c | A MOTION HOLD (R24) | `lodHysteresis` | `Tile._LODEvaluate` (index.js ~:265) — merge becomes `n > r*H` while refine keeps `n <= r`, the deadband upstream has never had in either direction. **SHIPS AT 1, where the bound binding is `r` itself and the expression is upstream's verbatim.** Built and unit-tested, deliberately not armed: unlike #6a it moves the settled tree at every frozen pose, so arming it is a measured decision (R25). | landed OFF-by-value, R24 |
| 7 | A MOTION HOLD (R24) | `unlockOnReject` | `Tile._loadSubTiles` / `_removeSubTiles` / `_updateModel` (index.js ~:421/~:472/~:485). All three are `async`, `LOD()` DISCARDS the promise they return (~:215), and `TileLoader.update` has a `try/finally` with **no catch** (~:1067) — so one rejection anywhere below permanently damages the tree: `_loadSubTiles` leaves `_subTiles` set and the guard `!this.subTiles` then means **that node can never refine again**, while `_removeSubTiles`/`_updateModel` leave `_loadState === "loading"`, which `_update`'s guard reads as "skip this node AND its entire subtree", forever. ON wraps each body in `try/catch` and restores exactly the pre-call invariant (`unloadSubTiles()`; `_subTiles` rebuilt from the surviving Tile children + `_loadState` cleared; `_loadState` cleared + `_loadedEpoch` advanced to stop a 20 Hz retry storm). OFF re-throws, i.e. upstream verbatim. | landed, R24 |
| 8 | A MOTION HOLD (R24) | `rasterMark` | `TileLoader.updateMaterial` (index.js ~:1290). Upstream hands a failed tile a 20%-opacity BLACK `MeshBasicMaterial` with no reason code, no retry and no telemetry, and the tile keeps it until the LOD collapses it away. ON stamps `userData.source` + `userData.flyError` on the clone and counts it. **Read this next part before touching the site:** stamping `source` ALONE would have the OPPOSITE of the intended effect — the reuse test on the following line would then MATCH the error material and keep it forever — so the patch also excludes `flyError`-marked materials from that test, and *that* is what re-opens the re-ask. `flyError` is set nowhere else, so with the switch off the added guard reads `!undefined` and the test is upstream's. The retry/timeout half lives engine-side in `lib/fly/raster-cache.js` (`TILE_HOLD.raster`). | landed, R24 |
| 9 | A MOTION HOLD (R24) | *(exports only)* | One new named export — `flyTileHoldStats` — appended to the export block, returning the live `{dwellArmed, dwellHeld, dwellFired, rejectLoad, rejectMerge, rejectUpdate, errorTiles, lastError}` receipt, so a gate can prove the patched path was EXERCISED rather than merely armed (the patch-#6/`flySkirtStats` precedent). No upstream export was renamed, removed or reordered. | landed, R24 |

### Patch #6a — why the SETTLED tree is unmoved, and why that is the whole argument

`mergeDwellMs` is hysteresis **in time**, not in space, and the distinction is
what makes it shippable into a fleet of frozen assertion numbers.

* A dwell **delays** a merge; it never cancels one. A node that still wants to
  merge when the window expires merges, and `scripts/r24-a-unit.js` gate (3)
  asserts exactly that against the real `Tile` class.
* Therefore at any pose held still for longer than the dwell, the tree converges
  on the identical set of resident tiles upstream reaches — same draws, same
  triangles, same texture bytes, same `getGroundAt().tileZ`.
* Every terrain harness in this fleet freezes the aeroplane before it measures
  (`verify-terra`'s `FREEZE`, and the same idiom in `verify-aerial` /
  `verify-settle` / `verify-clutter` / `verify-depth2` / `verify-frame-pace`;
  `verify-flicker` sets `f.speed = 0`), and every one of them settles for
  seconds. So none of them can see this patch, in either direction.
* It is **converging**, not identical, and that is why — unlike patch #5 — it
  rides the existing `__flyTerraPin` rather than claiming a pin exemption. See
  `tileHoldOn()` in `lib/fly/terrain-engine.js`, which also names the cost:
  `soak-fly.js` boots pinned, so the fleet's only long motion run does not
  exercise this round's fix.

The refine path is deliberately **not** dwelled (unit gate (5)): delaying
subdivision would make the ground blurrier, i.e. it would ship the defect this
patch exists to fix.

### Patch #5 — why the output is IDENTICAL, not merely equivalent

`getBoundaryEdges` returns an ordered list of directed edges, and the skirt's
winding is built from that order and direction, so "same set" would not be
enough. Three properties make the replacement exact:

1. **Order.** Upstream sorts by `(min(u,v), max(u,v))` ascending and pushes in
   that order. The fast path sorts the surviving slots by the same `(min, max)`
   pair. Every boundary edge is unique under that key, so no tie-break exists
   to disagree about.
2. **Direction.** Upstream pushes the surviving *entry*, i.e. the triangle's own
   `[u, v]`. The fast path records the position of the single occurrence and
   re-reads `[i[t+e], i[t+next]]` from the index array — the same two numbers.
3. **Refusal.** The fast path RETURNS NULL — falling through to the verbatim
   upstream body — for every input it does not claim: an index array whose
   length is not a multiple of 3, a negative index, a third occurrence of one
   undirected edge, or two occurrences that are **not exact reverses**. That
   last case is the only one where upstream's pairwise dedup keeps both halves,
   and it is the one a naive "count == 1" filter would get wrong.

Node fixture (85 meshes: regular grids 1×1…64×64, 80 randomly holed grids in
`Uint16Array` and `Uint32Array`, plus four deliberately non-manifold cases)
reports **85 identical, 4 bailed to upstream, 0 mismatches**. Measured speedup
4.9–6.1× across T = 2 048 … 32 768 (`ref 9.72 ms → fast 1.79 ms` at T = 32 768).
Live: 2 354 tiles in a 25 s Powell run, **0 bails**.

### Not patched (deliberately)

- **`maxThreads` burst** — the plan listed it with the vendored patches, but
  `TileMap.maxThreads` is a public setter; the warp burst is implemented
  engine-side in `terrain-engine.notifyWarp()` with no vendor edit at all.
- **The `LoaderFactory` cache seam** — `registerMaterialLoader` /
  `registerGeometryLoader` are the library's *designed* extension points, so
  `lib/fly/raster-cache.js` registers two new dataTypes ('fly-image-cached',
  'fly-lerc-cached') through the public API. The stock 'image' / 'lerc' loaders
  stay registered and untouched; only the TERRA_CACHE-gated source subclasses
  in `tile-sources.js` ever select the cached ones.

### Upstream behavior worth knowing (measured R22, not patched)

`Tile._update` skips `LOD()` for any leaf that is out of frustum, and
`_getDistRatio` multiplies the ratio by **5** rather than 0.8 when a tile is not
visible. At cruise this means the tile directly **below** the aeroplane can
never refine — it is off screen. Measured at FL300: the leaf under the aircraft
saturates at z10 and stays there with `downloading === 0` for 37 s while
`maxLeafZ` elsewhere in the tree reaches 12–13. This is correct library
behavior, not a defect, and it is why `terraStats.sharp` needs its stall term
(see `TerrainEngine._tick`).

> #### ⚠️ ANNOTATION (R24 A "MOTION HOLD", 2026-08-15) — the paragraph above is right about a FROZEN camera and wrong about a MOVING one. It is kept verbatim because it is the sentence that let the defect through three rounds.
>
> Everything it states is true and was correctly measured. What it never asked
> is what the same rule does while the aeroplane is **turning**, and the answer
> is that the ×5 is not a refinement quirk — it is a **destruction** trigger.
>
> * An interior node released its own model at `_loadSubTiles` (~:321), so
>   `_update`'s "skip a non-visible **leaf**" guard never covers it: `LOD()`
>   runs on it in or out of frustum.
> * A tile that subdivided satisfied `0.8·d/s <= 0.86` ⇒ `d/s <= 1.075`. Out of
>   frustum its ratio is `5·d/s`, which clears 0.86 for any `d/s > 0.172`. So
>   **essentially every subdivided tile that leaves the frustum is merged** —
>   and `_removeSubTiles` → `unloadSubTiles()` (~:190) DISPOSES every fine
>   descendant, geometry and textures included.
> * The gap is a constant `log2(5/0.8) = 2.64` zoom levels, i.e. off-camera
>   ground is held at 6.25× coarser linear resolution than on-camera ground.
>   R22 deepened the tree by two levels (imagery z17→18, DEM 15→16), so each
>   turn now destroys more; `lodBailFix` (patch #2) removed upstream's DFS bail,
>   which had been an accidental throttle on exactly this churn.
>
> **MEASURED, and the numbers were already in this repo before R24 read them.**
> R22.1's own stutter probe (`scripts/r22p1-b-stutter.md` §2.3) flew a 350 kt /
> 233 m serpentine over Powell and recorded **2,123 DEM tile meshes built in
> 22 s** — ~96/s — against a resident set of **223 tiles**
> (`scripts/r22p1-close.md` §1.2 gate (6)), i.e. the whole terrain rebuilt about
> every two seconds, against a transport-limited steady-state rate of ~5–10/s.
> R22.1 correctly made each of those builds 5–6× cheaper (patch #5) and the
> stutter went away. Nobody asked why there were ninety-six of them a second.
>
> That churn is the user-reported 2026-08-15 defect ("the 2D satellite plane
> glitches… problems updating the state of render when moving fast"), it is the
> mechanism behind close-ledger **F11** ("a second visit to a pose does not
> re-refine, with the loader IDLE" — the tile really was destroyed), and it is
> why **F10**'s `camTileZ` swing is not only an instrument artifact: the tile
> really merged, so `getGroundAt().tileZ` really does answer coarse — which is
> the value five streamed-actor engines gate their drape on.
>
> Patches #6a/#6b/#6c above are the response. The lesson worth carrying is the
> narrower one: **this note was written from a frozen pose, by a fleet that
> freezes the aeroplane before every terrain measurement.** "Correct library
> behavior" was a verdict about a camera that never moved.

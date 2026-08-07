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

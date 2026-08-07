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

| # | Owner | Switch | What | Status |
|---|---|---|---|---|
| — | — | — | W0: verbatim copy, zero behavior change | landed |

# VENDORED: three-tile 0.12.1

> Round 24 "Smooth World", agent **A PACE**, milestone W1a (`FLY_ROUND24_PLAN.md`
> §3 A.1; evidence `scripts/r24-recon.md` A2 / T1–T5 / FL-02 / FL-03).
> **This copy is BYTE-VERBATIM upstream at this commit** except the ONE import
> rewrite recorded below. The patch ledger at the bottom is empty by design:
> vendoring lands as its own commit so `git log` can prove the copy is clean
> before any behaviour changes it.

## What was vendored

| Vendored file | Upstream file | sha256 (upstream, as shipped by npm) | sha256 (vendored, this tree) |
|---|---|---|---|
| `lib/fly/vendor/three-tile/index.js` | `node_modules/three-tile/dist/index.js` | `99a4e751a6412940b5432947904ad8399b30b70b66a5927929bf2da0590293d7` | `99a4e751a6412940b5432947904ad8399b30b70b66a5927929bf2da0590293d7` (identical) |
| `lib/fly/vendor/three-tile/plugin.js` | `node_modules/three-tile/dist/plugin/index.js` | `0eac27756b8e36cdef89e278dadd90cd8900f2febe68972a63f933900f8d94c5` | `a8b8b7afbb5c51f787ad048993e23715eb3f8a3382e94783e703aadb8c1e2e21` (one line differs) |

- Package: `three-tile@0.12.1` (`"module": "./dist/index.js"`, `"./plugin"` →
  `./dist/plugin/index.js`), 1,986 + 6,257 lines of readable Vite ESM.
- Both files are ESM. `index.js` imports ONLY from `"three"`. `plugin.js`
  imports from `"three"` and (after the rewrite) from `"./index.js"`. Nothing
  else — no relative asset loads, no `new URL(..., import.meta.url)`, no
  dynamic `import()`. The DEM/LERC/Martini workers are inline minified source
  strings turned into Blob URLs at runtime (`index.js` ~:1118, :1170, :1221),
  so the module's location on disk does not affect them.

## The ONE change: the plugin's core import

`plugin.js` line 2, and nothing else:

```
- } from "three-tile";
+ } from "./index.js";
```

**Why it is mandatory, not cosmetic.** The plugin registers its loaders into
the `LoaderFactory` singleton it imports (`ArcGisSource`/`ArcGisDemSource`
land in the same registry `TileMap` reads). If the plugin kept importing the
npm package while the app imported the vendored core, there would be TWO
`LoaderFactory` module instances: the app's `TileMap` would look up a DEM
loader in a registry the plugin never wrote to, and every tile would fail to
resolve a loader. (Recon A2 records the same conclusion from the R22 tree.)

## License

MIT. The package's own `package.json` declares `"license": "MIT"` and
`"author": { "name": "GuoJF", "email": "hz_gjf@163.com" }`;
`"repository": "git+https://github.com/sxguojf/three-tile.git"`.
**No LICENSE file ships inside the npm tarball** (`files: ["dist"]` — the
published tarball contains only `README.md`, `package.json` and `dist/`), so
the MIT grant is recorded here from the package manifest's own declaration
rather than copied from a shipped license text. The upstream repository is the
canonical place for the full MIT text.

This is third-party CODE, not an asset: it is credited here and in `README.md`,
NOT in `lib/fly/assets.js`. That manifest is the asset ledger whose entry count
is arithmetic in `verify-fleet` / `verify-hangar`, and `CREDITS.md` is generated
from it (`scripts/gen-credits.mjs`) — adding a code dependency there would move
a frozen count for no licensing benefit.

## Why vendor at all

Every pacing fix this round needs to change module-private functions in the
bundle (`We`/`Re` — the skirt boundary-edge finder; `Timer.reset`;
`Tile._LODEvaluate`; `TileLoader.update`; `TileMap.update`). They are not
exported, so a monkey-patch cannot reach them; `patch-package` would put the
same edits somewhere `git` cannot review. Vendoring puts them in the app tree,
under review, with this ledger.

## Dependency wiring changed in the same commit

- `package.json`: `three-tile` removed from `dependencies`; the
  `overrides: { "three-tile": { "three": "$three" } }` block removed with it
  (it existed only to force the peer three onto 0.185.1; there is no longer a
  package to override). `package-lock.json` updated by `npm uninstall
  three-tile` — 13 deleted lines, CRLF endings preserved.
- `next.config.mjs`: `transpilePackages` drops `'three-tile'` (app source is
  transpiled anyway).
- `lib/fly/terrain-engine.js` and `lib/fly/tile-sources.js` are the only two
  importers in the repo; both now import from `./vendor/three-tile/`.
- `node_modules/three-tile` no longer exists. The `.d.ts` files were NOT
  vendored (the app is JS; nothing type-checks against them).

## PATCH LEDGER

**Zero patches at the vendoring commit.** Every later patch — by ANY agent —
gets a row here.

| # | Owner | Switch | File · function · lines | Reason (recon id) | Off-state |
|---|---|---|---|---|---|
| 1 | D | `LOD_CROSSFADE.enabled` | `index.js` · `Tile._loadSubTiles` · one inserted statement before the return expression (~:290) | T4(b/c) — the refine is an atomic single-frame swap in which texture sharpness AND Martini relief change together (the user's "terrain tiles swapping for other ones") | `ir` (the hook) is null → the inserted line is a short-circuited `&&`; the upstream `return h ? … : (this.add(...o), …, this.unloadModel()), !h;` expression is byte-verbatim and unconditional |
| 2 | D | `LOD_CROSSFADE.enabled` | `index.js` · `Tile._removeSubTiles` · one inserted `if` block before the return expression (~:318) | T4(b/c) — merges use the same atomic pattern | `ir` is null → nothing is awaited and `_loadState` is never touched; the upstream return expression is byte-verbatim |
| 3 | D | (holder for 1 and 2) | `index.js` · module scope after the version consts (~:3-13) + one export line | infrastructure for 1 and 2 | `ir` is null until the app calls `setLodFadeHook`; nothing in the library reads it elsewhere |

### D's patches in detail (LOD_CROSSFADE)

All POLICY lives in `lib/fly/lod-crossfade.js`, not here: the flag, the boot
window (`skipBootMs` — boot reveal timing is frozen, and a world that assembles
itself out of blurry parents is a different first impression), the warp
suppression (`WARP.flashMs` 250 already masks a cut), the concurrency bound,
the clock (driven from FlyScene's -50 block on the frame dt) and the parent-
texture lifetime. The library gets two call sites and a holder.

**Why patch 1 must sit exactly where it does.** `unloadModel()` disposes the
parent's texture in the same expression that adds the children. The hook runs
one statement earlier, detaches `material.map` from the parent material (so the
dispose walk cannot reach it), refcounts it, and hands it to the four children
as a second sampler with a clip-UV rectangle. Moving the call after the return
expression would blend against a disposed texture.

**Why patch 2 holds `_loadState` at "loading" across its await.** `_update()`
skips a tile whose `loadState` is `"loading"` and, because children are only
visited inside that same branch, skips its whole subtree. Without the hold, a
parent whose model is loaded but not yet added would be re-evaluated mid-blend
and could call `_loadSubTiles` on itself. The hook's promise is capped
(`fadeSec + 400 ms`) so a tile unloaded mid-blend can never leave the library
awaiting forever.

**Zero extra draws.** The children were already the drawn geometry in both
directions; the blend is one extra `texture2D` in the tile fragment. The
rejected alternative (keep the parent drawn under the children and dither it
out) costs a transient draw per in-flight quad and, per the archived R22.1 B3
finding, an ordered screen-door dither under SMAA-only AA reads as shimmer.

### D note (2026-09-06): gate 6 and the insert-only invariant

`verify-vendor-three-tile` gate 6 asserts the vendored `index.js` is
BYTE-IDENTICAL to upstream. That is exactly right at the vendoring commit and
cannot survive any patch, so it goes RED the moment patch 1 lands. The
replacement assertion that keeps A's intent — "byte-verbatim upstream when off"
— without being trivially satisfiable is:

> **every upstream line still appears in the vendored file, in order** (the
> diff is INSERT-ONLY).

That is the machine-checkable form of switch-idiom rule 2: an insert-only diff
cannot have edited or deleted an upstream statement, only added guarded ones
around it. D's three patches satisfy it today (upstream 1,987 lines, vendored
2,028, zero upstream lines missing or reordered). Flagged to A/Fable rather
than edited here, because `scripts/verify-vendor-three-tile.mjs` is A's file.

### The switch idiom every patch must follow

A patch is a **named boolean switch** in its owner's constants block
(A: `TERRA_PACE.*`; C and D use their own blocks). It must satisfy all five:

1. **One switch, one patch.** The switch is read ONCE at the top of the patched
   function (or hoisted into a module const that reads the constant at import
   time only if the value can never change mid-session — prefer the per-call
   read).
2. **Byte-verbatim upstream when off.** The original statements stay in the
   file, unedited, on the `else` branch. Reviewers must be able to read the
   upstream behaviour without `git show`ing the vendoring commit. If a patch
   cannot preserve the upstream body verbatim, it does not ship.
3. **A row in this ledger** naming the switch, the file, the function, the line
   range, the recon pain-point id it closes, and what the off-state is.
4. **A marker comment** at the patch site in the form
   `// R24 <LETTER> PATCH <n> (<SWITCH>) — <one line>` so a grep finds every
   patch site and `scripts/verify-vendor-three-tile.mjs` can check that the
   ledger and the code agree.
5. **Never renumber.** Patch numbers are permanent; a removed patch keeps its
   row marked WITHDRAWN.

Anything that changes the LERC worker must also update the readable source
under `lib/fly/vendor/three-tile/workers/` and be re-stringified by
`scripts/build-tile-worker.mjs` (added with the first worker patch), so the
minified blob in `index.js` is never hand-edited.

## How this is verified

`node scripts/verify-vendor-three-tile.mjs` (runs anywhere, no browser, no
network):

1. Recomputes the sha256 of both vendored files.
2. If `node_modules/three-tile` is present, diffs the vendored files against it
   line by line and asserts: `index.js` identical; `plugin.js` differs in
   exactly the one line, which must be line 2 and must be exactly the recorded
   rewrite. After `npm uninstall three-tile` the package is gone, so the gate
   falls back to the recorded sha256 pair above and says which leg it ran.
3. Asserts no source file outside `lib/fly/vendor/` still imports the bare
   `three-tile` specifier, that `package.json` has no `three-tile` dependency
   or override, and that `next.config.mjs` no longer transpiles it.
4. Asserts every `// R24 <X> PATCH <n>` marker in the vendored files has a row
   in this ledger and vice versa (both empty today).

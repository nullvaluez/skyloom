# VENDORED: three-tile 0.12.1

> Round 24 "Smooth World", agent **A PACE**, milestone W1a (`FLY_ROUND24_PLAN.md`
> §3 A.1; evidence `scripts/r24-recon.md` A2 / T1–T5 / FL-02 / FL-03).
> **The copy landed BYTE-VERBATIM** (except the ONE import rewrite recorded
> below) in its own commit, `b64457b`, so `git` holds a permanent verbatim
> baseline that every later patch is diffed against. Patches are listed in the
> PATCH LEDGER at the bottom; `scripts/verify-vendor-three-tile.mjs` proves
> both that the baseline is upstream and that the working copy differs from
> the baseline ONLY inside marked patch hunks.

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

**Zero patches at the vendoring commit `b64457b`.** Every later patch — by ANY
agent — gets a row here.

**Row-number allocation (Fable, R24):** A holds **0–4**, D takes **5–7**, C
takes **8–19**, and A's LATER patches take **20 upward** (A's work outgrew its
first block after the allocation was published; taking a fresh high block
rather than eating into D's 5–7 or C's 8+ is why these are numbered 20–23).
Numbers are permanent and are never renumbered once COMMITTED; a withdrawn
patch keeps its row, marked WITHDRAWN.

| # | Owner | Switch | File · function · lines | Reason (recon id) | Off-state |
|---|---|---|---|---|---|
| 0 | A | `R24_SWITCHBOARD` | `index.js` · module scope, after the version const | infrastructure: the bundle must not import app code, so the app pokes `R24_SWITCHES` (from `lib/fly/terrain-engine.js`) and a node fixture flips the same fields directly | an exported object nobody reads; every field `false` |
| 1 | A | `TERRA_PACE.timerFix` | `index.js` · `Timer.reset()` | T3 — upstream `reset()` zeroes only `_currentTime`, so `TileMap.update`'s `getElapsed() > updateInterval/1e3` guard is permanently true after 50 ms of uptime and the FULL quadtree walk runs every frame instead of at 20 Hz | the two upstream statements, unchanged |
| 2 | A | `TERRA_PACE.mergeHysteresis` · `TERRA_PACE.keepResident` | `index.js` · `Tile._LODEvaluate()` | T1 — one threshold both ways with no hysteresis (refine↔merge flip), and a merge test that is satisfied the instant a tile leaves the frustum, so every yaw collapses the field behind the camera and re-downloads a coarser parent ("tiles swapping for other ones") | the single upstream `return` expression, unchanged, below the branch |
| 3 | A | `TERRA_PACE.keepResident` | `index.js` · `Tile._getDistRatio()` | T1 — PATCH 2's merge test needs the in-frustum distance law in every direction; re-scaling the ×5 result would not be the same float | an early return reachable only when a caller passes `true`; every upstream call site passes nothing |
| 4 | A | `TERRA_PACE.skirtFast` | `index.js` · module scope + `We()` (getBoundaryEdges) | T2 / FL-02 / A2 — the boundary-edge finder allocates 3 two-element arrays per triangle and sorts all 3T with a boxed comparator; R22.1 profiled it + its comparator at 67% of every stalled ms while streaming | an early-out at the top of `We`; the entire upstream body follows, unchanged |
| 20 | A | `TERRA_PACE.skirtWorker` | `index.js` · module scope + `qe()` / `nt()` (the two geometry-returning DEM worker factories) | T2 / FL-02 / A2 (F2) — the skirt is built on the MAIN thread in the promise continuation after the worker returns; this moves scan + skirt + attribute concat INTO the worker and returns transferables | the verbatim upstream factory body; the splice returns null and the stock worker is created |
| 21 | A | `TERRA_PACE.skirtWorker` | `index.js` · `TileGeometry.setAttributes()` | T2 — with PATCH 5 the arrays arrive finished, so the main-thread skirt build must not run twice | an inserted early return taken only when the worker set `r24Skirted`; upstream's body follows unchanged |
| 22 | A | `TERRA_PACE.walkWhileSaturated` | `index.js` · `Tile._update()` | T3 (second half) — upstream freezes the ENTIRE quadtree walk while `downloadingThreads + 4 >= maxThreads` (six of ten loads), so a busy queue pins the tree at whatever depth it reached; E CERT measured dl 9/10, maxZ stuck at 6 and every building drape restarting | the verbatim upstream `if (!(…saturated…))` body |
| 23 | A | `TERRA_PACE.walkWhileSaturated` | `index.js` · `Tile.LOD()` | T3 — PATCH 22's companion: compute and return the LOD decision while saturated but withhold the ACTION, so no load is started that upstream would not have | an early return reachable only when a caller passes `true`; every upstream call site passes one argument |
| 24 | A | `TERRA_PACE.bboxCache` | `index.js` · `Tile.BBox` getter | T3 (allocation half) — every tile visit allocates a Box3 + two Vector3s, and the walk touches every tile; PATCH 22 roughly doubles the visits, so the per-visit allocation has to go | the verbatim upstream two-line getter body |

**PATCH 20/21: the worker source rule.** three-tile ships its DEM workers as
MINIFIED SOURCE STRINGS turned into Blob URLs at runtime. Hand-editing one of
those strings is how a vendored patch becomes unreviewable, so it is forbidden.
Worker-side work is authored in a readable file under
`lib/fly/vendor/three-tile/workers/*.src.js`, stringified by
`scripts/build-tile-worker.mjs` into `*.built.js`, and SPLICED into three-tile's
own source in place of its `self.onmessage = …` tail — every upstream byte
survives, and only the new code is in a file a reviewer can read. If the tail
shape is ever absent the splice returns null and the stock worker is created,
so the switch degrades to off rather than half-applying. This is also the seam
another agent extends for worker-side DEM normals (recon T6): add a function to
the readable source, call it from the handler, give it its own switch, and take
the next ledger row. `verify-vendor-three-tile` runs the builder with `--check`,
so a source edit that was never re-stringified goes red instead of shipping
stale. **This is why the bundle is allowed exactly ONE non-`three` import**
(`./workers/skirt-tail.built.js`); it still imports no app code, and the gate
allows that path and nothing else.

**PATCH 4 identity.** Upstream's output is exactly "the directed edges whose
`(min,max)` key occurs once, ordered by `(min,max)`" — its sort groups equal
keys and its dedupe pass drops precisely the adjacent reverse pairs. The fast
path computes that directly with an undirected-edge count in a module-scoped,
generation-stamped open-addressed table (never cleared, only re-stamped) and
sorts only the perimeter. It returns `null` — falling through to the verbatim
body — for every input it does not claim: a length that is not a multiple of 3,
a negative index, a degenerate `a === b` edge (whose min/max collapse makes it
its own reverse), an edge seen three times, or two occurrences with the SAME
winding, which is the one case upstream KEEPS both of.
`scripts/verify-skirt-fast.mjs` drives the public
`TileGeometry.setAttributes()` in both arms and compares position / uv / normal
/ index element by element: identical on six real Martini tiles (up to 116 k
output indices), on regular grids with Uint16 and Uint32 indices, and on a
holed grid with a real interior boundary; and all four bail inputs both BAIL
and stay identical.

**Blast radius notes.** PATCH 1 touches a class (`Timer`) that has exactly one
other instance in bundle + plugin (`plugin.js:381`), and that instance calls
neither `reset()` nor `getElapsed()`. PATCH 2 and 3 are confined to the LOD
decision; the REFINE arm is byte-identical to upstream in both switch states,
which `scripts/verify-terra-residency.mjs` gate 7 proves by running a
fixed-heading approach in both arms and comparing refine counts, request
counts and the loaded-tile census.

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
network, 18 assertions):

1. **The baseline is upstream.** It hashes `index.js` and `plugin.js` *as of
   commit `b64457b`* (`git show`) and compares them to the recorded upstream
   sha256s. That proof does not decay as patches land, and it does not need the
   npm package to still be installed.
2. **The one rewrite.** While `node_modules/three-tile` is still present it
   also does the real line-by-line diff and asserts plugin.js differed on
   exactly line 2; afterwards it asserts line 2 carries the rewritten import.
   It always prints which leg it ran.
3. **No unmarked edits.** `git diff -U0 b64457b` over both files: every hunk
   must contain an added line mentioning `R24`, i.e. every edit sits in a
   marked patch. The count of upstream lines *replaced* rather than left
   verbatim is compared to the number this ledger declares (today: 1 — the
   `_getDistRatio()` signature).
4. **The import list is still `three` alone** (plus `./index.js` in the
   plugin), so the bundle can never start importing app code.
5. **No second copy**: no source file imports the bare `three-tile` specifier;
   exactly two files import the vendored path; `package.json`,
   `package-lock.json` and `next.config.mjs` are clean of it.
6. **Markers and ledger agree** in both directions.

Behavioural proof of the patches themselves lives in
`scripts/verify-terra-residency.mjs` (node, 18 assertions), which drives these
Tile/TileMap classes with a synthetic camera path and a stub loader and reports
refine / merge / refetch / on-screen-replacement counts per switch.

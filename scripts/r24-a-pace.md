# R24 A PACE — "no frame carries a burst" (ledger)

Agent **A PACE**, Round 24 "Smooth World". Worktree `/home/user/skyloom-r24-a`,
branch `r24/a` off `6116fc5` (main + W0 scaffolding). Plan: `FLY_ROUND24_PLAN.md`
§3 A. Evidence: `scripts/r24-recon.md` — my ids are **T1 T2 T3 T4(a) T5 T9 T14 ·
FL-01 FL-02 FL-03 FL-04 FL-05 FL-08 FL-09 FL-13 · A2 A3 A4 A9 · WB-3**.

> **Venue truth, stated once and true for every row below.** This container has
> no GPU (ANGLE/SwiftShader, ~1 fps under the app's load), and Esri /
> OpenFreeMap / adsb.lol are 403-blocked, so **no fps, ms, stutter, stall-rate
> or tearing number in this ledger was measured here** unless it says
> MEASURED-HERE and names the instrument. Structural numbers (counts, byte
> identity, output identity on fixtures, draw census at a fixed pose) ARE
> measurable here and are labelled as such. §9 is the honest
> "could not measure here" list.

---

## §0 RED — what this round's work is answering

The RED for the stall class is not mine to re-measure: it is the archived
R22.1 measurement (`scripts/r22p1-b-stutter.md` §2.2, quoted in recon A2),
taken on a LATER tree with a denser DEM ring:

| Instrument | RED (archived, R22 tree, user's class of machine) |
|---|---|
| CDP profiler samples inside stall windows | `We` (getBoundaryEdges) 37% + its comparator 30% = **67% of every stalled ms** |
| Skirt builds in a 22 s Powell run | 2,123 builds / 8.79 M triangles walked |
| Stalls/min OFF → ON (their fix) | 100.7 / 83.9 / 91.2 → 2.4 / 2.4 / 0.0 |
| Worst frame OFF → ON | 95.8 / 79.2 / 87.5 ms → 29.2 / 33.3 / 20.8 ms |
| GPU exonerated | CrRendererMain 29.9 s vs CrGpuMain 11.7 s of a 30 s window |

On THIS tree the same code is present verbatim (recon A2 file:line evidence
re-verified below), with a coarser DEM ring (`demMaxZoom: 15`, z17 imagery),
so the shape is the same at a lower rate. **I cannot reproduce the rate here.**
What I CAN produce here is the SHAPE: a node fixture that counts triangles
walked and boundary edges found per tile, and an in-app census of tiles
finalized per frame. Those rows are marked MEASURED-HERE.

The RED for the DPR-step and ladder work is likewise archived and re-verified
by code reading on this tree (recon A3/A4).

---

## §1 M1 (W1a) — vendor three-tile 0.12.1 VERBATIM

**Status: DONE.** Commit: see §10. This is the merge-first commit; it changes
no behaviour by construction.

### Mechanism / why

Every pacing fix I own needs to change module-private functions inside
three-tile's dist bundle — `We`/`Re` (the boundary-edge finder and the skirt
builder), `Timer.reset`, `Tile._LODEvaluate`, `Tile.LOD`, `TileLoader.update`,
`TileMap.update`. None of them is exported, so a monkey-patch cannot reach
them (recon A2 states the same conclusion), and `patch-package` would put the
edits somewhere git review cannot see. Vendoring puts them in the app tree
under a ledger.

### What landed

| Item | Detail |
|---|---|
| `lib/fly/vendor/three-tile/index.js` | `node_modules/three-tile/dist/index.js`, **byte-identical** (sha256 `99a4e751…0293d7` both sides), 1,986 lines |
| `lib/fly/vendor/three-tile/plugin.js` | `dist/plugin/index.js`, 6,257 lines, **one line differs** — line 2's `from "three-tile"` → `from "./index.js"` |
| `lib/fly/vendor/three-tile/VENDOR.md` | provenance, sha256 table, the one rewrite + WHY, MIT/author record, **patch ledger with ZERO rows**, and the switch idiom every later patch (mine, C's, D's) must follow |
| `scripts/verify-vendor-three-tile.mjs` | NEW node gate, 18 assertions, runs anywhere |
| `lib/fly/terrain-engine.js`, `lib/fly/tile-sources.js` | the only two importers in the repo, repointed |
| `package.json` | `three-tile` dropped from `dependencies`; the `overrides` block (which existed only to force its `three` peer) removed with it |
| `package-lock.json` | `npm uninstall three-tile` → **13 deleted lines only**; CRLF endings restored by hand (npm rewrites the file LF, which would have made an 8.4k-line diff out of a 13-line change) |
| `next.config.mjs` | `transpilePackages` drops `'three-tile'` |
| `README.md` | vendored-code credit (three-tile 0.12.1, GuoJF, MIT) pointing at VENDOR.md |

**The import rewrite is mandatory, not cosmetic.** The plugin registers
`ArcGisSource`/`ArcGisDemSource` into the `LoaderFactory` singleton of
whichever core module instance it imports. Had it kept importing the npm
package while the app imports the vendored core, there would be two registries
and `TileMap` would look up a DEM loader in one the plugin never wrote to.

**Licensing.** MIT, author GuoJF (`hz_gjf@163.com`), from the package's own
`package.json`. **No LICENSE file ships in the npm tarball** (`files:["dist"]`
— the tarball is `README.md` + `package.json` + `dist/`), so the grant is
recorded in VENDOR.md from the manifest declaration, and that fact is recorded
too. This is CODE, so the credit went to `VENDOR.md` + `README.md` and **NOT**
to `lib/fly/assets.js`: that manifest's entry count is arithmetic inside
`verify-fleet`/`verify-hangar` and `CREDITS.md` is generated from it
(`scripts/gen-credits.mjs`), so an entry there would move a frozen count for
no licensing benefit.

### Evidence (all MEASURED-HERE)

1. **Byte identity, FULL leg** — `verify-vendor-three-tile.mjs` run with the
   upstream files restored under `node_modules/three-tile/`: **18/18 PASS**,
   including "vendored index.js is BYTE-IDENTICAL to upstream", "plugin.js
   differs on EXACTLY one line — lines: 2", "the rewrite is exactly
   `three-tile` → `./index.js`".
2. **Byte identity, SHA leg** — after `npm uninstall three-tile`: **18/18
   PASS**; the gate reports which leg it ran, so a future reader cannot mistake
   the weaker leg for the stronger one.
3. **Import closure** — vendored `index.js` imports ONLY from `"three"`;
   vendored `plugin.js` only from `"three"` and `"./index.js"`. No relative
   asset loads, no `new URL(…, import.meta.url)`, no dynamic `import()`. The
   LERC/Martini workers are inline source strings → Blob URLs at runtime
   (`index.js` ~:1118/:1170/:1221), so the module's new location on disk cannot
   affect them.
4. **No second copy** — no source file imports the bare `three-tile` specifier;
   exactly two files import the vendored path; `package.json`,
   `package-lock.json` and `next.config.mjs` are all clean of it;
   `node_modules/three-tile` is gone.
5. **Dev server boots** — `:3101`, `GET / 200`, compiled clean; the vendored
   module is served as its own client chunk
   (`.next/dev/static/chunks/lib_fly_vendor_three-tile_*.js`).
6. **The map really runs on the vendored copy** — headless boot probe
   (`scripts/r24-out/probe-vendor-boot.js`, SwiftShader):
   `hasEngine:true, isLOD:true, rootTile.children:4, downloading:4,
   demSource.dataType:'lerc'`, **0 pageerrors, 0 non-network console errors**
   (24 network errors = the 403-blocked Esri hosts, expected here). A split
   LoaderFactory would have thrown on the first tile load instead of issuing
   4 downloads.

### Not proven here (carried)

- `gl.info` draws/tris at the Owens / Powell / Manhattan poses identical to the
  pre-vendor tree: **needs tiles**. Runs the moment E's offline fixture lands
  (plan §1); the pre-vendor arm is `git stash`-able because the vendoring
  commit is pure. Tracked in §9.
- Satellite tile URL identity: the URL builders are inside the byte-identical
  `plugin.js`, and `lib/fly/tile-sources.js` changed only its import lines, so
  URL shape identity follows from byte identity; a live check needs egress.

---

## §2 A10 — dev handles must not bind to the StrictMode corpse

**Finding, on THIS tree: the defect is LATENT, NOT PRESENT.** Recon A10 was
measured on the R22 tree, where a `window.__flyTerra` handle was installed from
`TerrainEngine`'s constructor. At `6116fc5` the constructor installs nothing
(`grep -rn "__flyTerra" lib components` → 0 hits), so there is no corpse to
read today. The rule still binds every handle I add, so the fix ships as the
PATTERN plus the instrument the round needs.

`components/fly/FlyScene.jsx` gains ONE effect keyed on `engine`, dev-only,
with an **owner-checked disposer** — the second StrictMode mount's cleanup
cannot delete the first mount's handle, and vice versa:

```
window.__flyTerra = { __owner, get(), engine(), lod(), mem(), instrument(), reset() }
```

`lod()` returns refines / merges / parent refetches / **tiles replaced while on
screen**; `mem()` returns resident tiles, estimated bytes, and LRU activity.
That is the handle the user-machine diagnosis reads.

MEASURED-HERE (live app, SwiftShader, `scripts/r24-out/probe-terra.js`):
`__flyTerra` present, `lod().refine` 7 on the live engine, `sceneRemounts: 0`,
0 pageerrors, 0 non-network console errors.

---

## §3 M2a — the residency trio (T1 + T3): `timerFix`, `mergeHysteresis`, `keepResident`

Re-ordered to the front of M2 by Fable's ruling after the user reported
**"terrain tiles swapping for other ones"** and **"buildings appearing and
disappearing"**.

### Mechanism — why yaw makes the terrain swap

Verified verbatim on this tree, in the vendored copy:

- `Tile._getDistRatio()` returns `inFrustum ? t * 0.8 : t * 5` — the LOD
  distance ratio jumps **×6.25 the instant a tile leaves the frustum**.
- `Tile._LODEvaluate()` uses the SAME threshold for refine and merge, with no
  hysteresis, so that jump immediately satisfies the merge rule.
- `Tile._removeSubTiles()` then **downloads a fresh parent model** and disposes
  the four children.

So a turn collapses the field behind you one level per traversal, and each
collapse REPLACES four tiles with one coarser tile fetched from a different
Esri capture — which is exactly "a tile swapped for another one". Turning back
re-refines from whatever survived. On top of that, `Timer.reset()` never zeroes
`_elapsed`, so `TileMap.update`'s 50 ms guard is permanently true after 50 ms of
uptime and the whole quadtree is walked EVERY frame (T3).

### The fix

| Switch | Where | What |
|---|---|---|
| `timerFix` | vendored PATCH 1, `Timer.reset()` | zero `_elapsed` so `updateInterval` gates the walk again (20 Hz) |
| `mergeHysteresis` | vendored PATCH 2, `Tile._LODEvaluate()` | merge only past `threshold × K` (K = 1.6) |
| `keepResident` | vendored PATCH 2 + 3 | judge the merge with the **in-frustum** distance law in every direction, so leaving the frustum ALONE can never collapse a tile; residency then bounded by distance and by the byte LRU |
| (policy) | NEW `lib/fly/tile-residency.js` | wires the long-dead `TILES.lruBudgetBytes` (140 MB, zero consumers at 3592656); elects OUT-OF-FRUSTUM subtrees farthest-first, sized to the overshoot; also owns the LOD event counters |
| `bendSphere` | `TerrainEngine._armBendSpheres()` | T14 — **built, default OFF**, see the risk note below |

The REFINE law is byte-identical to upstream in both arms. Every vendored edit
sits in a marked patch hunk and has a VENDOR.md row (patches 0–3).

### RED → GREEN (MEASURED-HERE, `scripts/verify-terra-residency.mjs`, 18 gates)

The gate drives the REAL vendored `Tile`/`TileMap` classes in plain node with a
synthetic camera path and a stub loader. Deterministic, no GPU, no network.
**Decision counts, not milliseconds.**

**A. Pure yaw sweep — the camera does not move at all, only its heading turns
720° over 90 frames. Every event here is caused by frustum exit alone.**

| metric | flag-off | flag-on |
|---|---|---|
| merges | **22** | **0** |
| tiles replaced WHILE ON SCREEN | **17** | **0** |
| refetches (tiles downloaded twice) | **178** | **0** |
| refine↔merge flips | 27 | 0 |
| total requests | 354 | 248 |

**C. Attribution — same path, one switch at a time** (the R21 rule: never ship
a bundle of switches on one before/after):

| metric | off | mergeHysteresis | keepResident | both |
|---|---|---|---|---|
| merges | 22 | 22 | **0** | 0 |
| replaced on screen | 17 | 17 | 0 | 0 |
| refetches | 178 | 178 | 0 | 0 |

`keepResident` is the switch that closes the frustum-exit collapse. Hysteresis
alone does nothing on this path — and that is predicted, not surprising: the
out-of-frustum ×5 already carries the ratio far past `threshold × 1.6`.

**C1. Where hysteresis DOES earn its keep — a vertical bob looking straight
down (2.4 km ± 1.5 km, 96 frames), so nothing ever leaves the frustum and the
only thing that moves is the distance ratio:**

| metric | off | mergeHysteresis |
|---|---|---|
| merges | 21 | **11** |
| refine↔merge flips | 27 | **16** |
| refetches | 89 | **63** |

**D. Serpentine (translation + a ±70° heading oscillation, 140 frames)** — the
plan's canonical Powell → Columbus shape:

| metric | flag-off | flag-on |
|---|---|---|
| merges | 36 | 28 |
| replaced on screen | **33** | **4** |
| refetches | **176** | **28** (−84%) |
| total requests | 548 | 552 (+0.7%) |

Requests do NOT fall on the serpentine and the gate does not pretend they do:
the refetches the fix saves are spent on legitimately deeper coverage (the
field behind the aircraft stays refined instead of collapsing). The honest
claim, and the gate's wording, is *the waste goes away and the total does not
grow*.

**E. Timer (12 `map.update` calls spaced ~20 ms, `updateInterval` 50 ms):**
flag-off **10/12** updates walked the whole tree (the interval gates only
during the first 50 ms of process uptime and never again); flag-on **4/12**,
i.e. the intended ~20 Hz.

**G. COST, stated honestly.** `keepResident` keeps a deeper tree, so a walk
visits more nodes: **36 → 74 nodes per walk** on the serpentine. `timerFix` is
what pays for it: 10/12 walks → 4/12. Net traversal work per unit time
**4230 → 3431** (visits × walk rate). The two switches ship together for
exactly this reason.

**Controls (both MEASURED-HERE):**
- **B / 8b** — a fixed-heading approach and a parked ±6 m jitter, where nothing
  leaves the frustum and nothing crosses the threshold, produce **identical**
  refines, requests and loaded-tile census in both arms (59/59, 232/232,
  172/172 and 29/29, 112/112). The refine law was not touched.
- **F / 14** — the byte LRU set to 3 MB against ~60 MB resident on a path where
  nothing leaves the frustum sheds **nothing** and issues **not one extra
  request** (resident 180/180, requests 232/232).

**H. The byte LRU on a path where shedding is safe** (180-frame serpentine,
budget ∞ vs 8 MB): peak resident **126 MB → 95 MB**, final resident tiles
**351 → 270**.

### Two design findings the measurements forced

1. **An in-frustum eviction is churn, not a budget.** `Tile.LOD()` refines only
   `inFrustum` tiles, so collapsing a tile the camera is looking at is undone by
   the very next walk — two loads for nothing. The first version of the LRU
   allowed in-frustum candidates and left the resident peak UNCHANGED while
   churning requests. The election is now **out-of-frustum only**, and vendored
   PATCH 2 independently refuses an LRU mark on a tile that has come back into
   view, so a stale mark can never take the world out from under the player.
   This is also the precise statement of upstream's bug: it applies the
   out-of-frustum collapse ALWAYS and IMMEDIATELY instead of only under memory
   pressure, farthest first.
2. **A fixed-size brake cannot keep up.** At 4 subtrees per 500 ms the resident
   peak still GREW on a 180-frame serpentine (126 → 128 MB). The pass now
   elects as many subtrees as the overshoot needs, capped at 32 per pass, every
   250 ms. And marks are no longer cleared on every pass: `_removeSubTiles`
   re-evaluates AFTER awaiting the parent download, so clearing mid-flight threw
   the fetched parent away.

### Risk carried: T14 (`bendSphere`) is BUILT and OFF

Three culls tile meshes on their UNBENT bounding sphere while the shader drops
each vertex by `d²k`. With `k = 1/(2 × 100 000)` the drop VARIES across one tile
by `~2·d·k·r` — about **30% of the tile radius at 30 km and ~120% at the 120 km
fade end** — so a far resident tile whose bent vertices are on screen can be
culled. `TerrainEngine._armBendSpheres()` implements the inflation on
`tile-loaded`, but turning it on **submits far tiles that are culled today**,
which is a draw-count change against frozen ceilings (Owens ≤ 261, sat ≤ 375).
It therefore ships OFF until it is measured at the canonical poses on E's
fixture. `keepResident` makes it more RELEVANT (more far tiles stay resident)
but not more dangerous: a merged parent has a bigger sphere and is culled less
often, so today's coarse field hides the defect rather than avoiding it.

### Frozen numbers

None moved. Draw ceilings are not measurable here (no tiles); the argument that
they cannot move is: at a SETTLED fixed pose both arms converge to the same
in-frustum field, because the refine law is byte-identical and resident-culled
tiles are not submitted. That argument needs the fixture to become a number —
tracked in §9.

### Runtime pin (for the user's machine)

`window.__flyTerraPaceOverride = { enabled: true, timerFix: true,
mergeHysteresis: true, keepResident: true }`, set before Fly mode mounts,
flips the switches without editing constants (the R16 weather-pin idiom).
That is what makes an A/B possible where the fps numbers actually live.
MEASURED-HERE in the live app: with the pin set, the residency wrapper installs
and the census runs (19 resident tiles / 6.3 MB on a 403-blocked boot), 0
pageerrors; with no pin, `map.update` is unwrapped and nothing extra runs.

---

## §4 M2b — `skirtFast`: the O(E) boundary scan (T2 / FL-02 / A2)

### Mechanism

`We` (getBoundaryEdges) pushes **three two-element arrays per triangle**, sorts
all 3T of them with a boxed JS comparator that does four `min`/`max` per
comparison, then dedupes. At a 129² Martini tile that is ~98 k small arrays and
a ~1.6 M-comparison sort, run on the MAIN THREAD in a promise continuation, per
DEM tile. R22.1's profiler put that function at 37% and its comparator at a
further 30% — **67% of every stalled millisecond** while streaming.

Upstream's output is exactly *"the directed edges whose `(min,max)` key occurs
once, ordered by `(min,max)`"*: the sort groups equal keys and the dedupe pass
drops precisely the adjacent reverse pairs. So the same answer is an O(E)
undirected-edge count in a module-scoped, generation-stamped open-addressed
table (never cleared, only re-stamped — zero per-tile allocation), keeping the
count-1 edges and sorting only the **perimeter** (hundreds, not 3T).

### Bail contract

It returns `null` — falling through to the verbatim upstream body — for every
input it does not claim: length not a multiple of 3, a negative index, a
degenerate `a === b` edge (whose min/max collapse makes it its own reverse), an
edge seen three times, or two occurrences with the SAME winding, **which is the
one case upstream KEEPS both of**.

### RED → GREEN (MEASURED-HERE, `scripts/verify-skirt-fast.mjs`, 12 gates)

The gate does not poke the private function: it drives the PUBLIC
`TileGeometry.setAttributes(data, z)` — the call three-tile makes on every DEM
tile — in both arms and compares position / uv / normal / index **element by
element**. That covers the skirt vertices, the appended triangles, the
attribute concatenation and the ordering, not merely the edge list.

| case | out indices | path | geometry |
|---|---|---|---|
| Martini 129² ridge z15 | 736 | fast | identical |
| Martini 129² cliff z15 | 876 | fast | identical |
| Martini 129² noise z16 | 33,743 | fast | identical |
| Martini 257² ridge z15 | 736 | fast | identical |
| Martini 257² noise z13 | **116,079** | fast | identical |
| Martini 65² flat z15 | 10 | fast | identical |
| regular grid 65² Uint32 | 8,704 | fast | identical |
| regular grid 65² Uint16 | 8,704 | fast | identical |
| holed grid 65² (real interior boundary) | 8,614 | fast | identical |
| non-manifold: edge in 3 triangles | 17 | **BAILED** | identical |
| duplicate winding on a shared edge | 14 | **BAILED** | identical |
| degenerate triangle (a, a, b) | 10 | **BAILED** | identical |
| index length not a multiple of 3 | 13 | **BAILED** | identical |

**Timing — this container's CPU, isolated and single-threaded. It measures the
ALGORITHM, which is legitimately measurable here; it does NOT measure the
user's frame time.**

| grid | triangles | off | on | speedup |
|---|---|---|---|---|
| 129×129 | 32,768 | 44.95 ms | 6.35 ms | **7.1×** |
| 257×257 | 131,072 | 202.60 ms | 31.04 ms | **6.5×** |

(Archived R22.1 measured 4.9–6.1× isolated on a different tree and CPU; the
shape agrees.) Gate 12 proves the table is reused rather than reallocated:
heap 16.5 → 9.2 MB across 25 consecutive 129² tiles.

### What this does NOT claim

A 7× algorithmic win is not a stall-rate. The archived live figure (stalls/min
91 → 2.4, worst frame 87.5 → 29.2 ms) was measured on a DIFFERENT tree with a
denser DEM ring; this tree's rate is unknown until the user runs it. §9.

---

## §5 M2c — `skirtWorker`: the skirt built in the DEM worker (T2 / A2, F2)

**Status: BUILT, ships OFF.** `skirtFast` cut the main-thread cost 7×; this
removes the residual by moving the whole build — boundary scan, skirt vertices,
attribute concatenation — into three-tile's DEM worker and returning the
finished arrays as **transferables**, so the main thread only wraps them in
`BufferAttribute`s.

### The worker-source rule (this is the part C needs)

three-tile ships its DEM workers as MINIFIED SOURCE STRINGS turned into Blob
URLs at runtime. Hand-editing one is exactly how a vendored patch becomes
unreviewable, so VENDOR.md forbids it. Instead:

- `lib/fly/vendor/three-tile/workers/skirt-tail.src.js` — a **readable** file,
- `scripts/build-tile-worker.mjs` stringifies it into `skirt-tail.built.js`
  (`--check` fails if the built file is stale; `verify-vendor-three-tile` runs
  that check, so an unbuilt edit goes red instead of shipping),
- PATCH 20 **splices** that string into three-tile's own source in place of its
  `self.onmessage = …` tail. Every upstream byte survives; only the new code is
  in a file a reviewer can read. If the tail shape is ever absent the splice
  returns null and the stock worker is created — the switch degrades to off
  rather than half-applying.

That is the seam for worker-side DEM normals (recon T6): add a function to the
readable source, call it from the handler, give it its own switch, take the
next ledger row.

### Evidence (MEASURED-HERE, `scripts/verify-skirt-worker.mjs`, 8 gates)

The tail is executed in a sandbox with a stubbed decode step and what it posts
is compared element by element with the main-thread path:

| case | out indices | skirted | transferables | vs main thread |
|---|---|---|---|---|
| grid 33² Uint32 z15 | 6,912 | true | 4 | identical |
| grid 65² Uint16 z16 | 26,112 | true | 4 | identical |
| grid 129² Uint32 z13 | 101,376 | true | 4 | identical |

Plus: the splice target still exists in **both** geometry-returning DEM workers
(decode entry points `le` and `Z`); the built string matches its source; z=0
produces no skirt in either arm; and an input the boundary scan declines comes
back UNSKIRTED so the main thread runs upstream's build exactly as today.

### Why it ships OFF

**The production path is unexercisable in this container.** E's offline fixture
serves terrain-rgb, and three-tile's terrain-rgb loader builds its geometry on
the MAIN thread (`setData`); the geometry-returning worker path is only reached
by Esri LERC tiles, which are 403-blocked here. Node-level identity is proven;
end-to-end streaming is not. It needs one run on the user's machine before it
goes on. §9.

---

## §6 M2d — `walkWhileSaturated` + `bboxCache` (T3, both halves)

Fable relayed E CERT's live measurement on the R24 fixture: fulfilling imagery
through a Playwright route kept three-tile's download queue at **dl 9/10**, and
upstream freezes the ENTIRE quadtree walk while `downloadingThreads + 4 >=
maxThreads` — six of ten. Nothing is re-evaluated then: not frustum flags, not
merges, not the descent. **The tree stalled at maxZ 6, `groundElev` answered
193 m where the true elevation at Powell is 276 m, every satellite building
drape sample saw `tileZ 6 < demZ 12`, and the drape restarted forever.** E fixed
the fixture side; the freeze rule is upstream's and is still live in production.

**PATCH 22/23** make the rule per-tile and strictly conservative: keep walking
and keep the frustum/LOD state current, but START no load while saturated —
neither a refine nor a version reload. It can only evaluate more; it can never
issue a download upstream would not have.

**MEASURED-HERE** (`verify-terra-residency` leg I, 14-frame tile latency against
maxThreads 10, so the loader is held saturated): nodes visited **444 → 4,248**,
refines 19 → 19, requests **72 → 72**. Upstream evaluates a tenth of the tree
and starts exactly the same loads. What this leg CANNOT show is the harm at
depth — my stub loader always drains, so both arms still reach z9; the depth
evidence is E's live measurement above, and it is quoted, not re-derived.

**The cost is real and the gate says so.** Two switches make the walk do more:
`keepResident` keeps a deeper tree resident and `walkWhileSaturated` keeps
evaluating it — upstream's smaller number is a FROZEN tree, not an efficient
one. Nodes visited per walk **36 → 233** on the serpentine; `timerFix` runs the
walk at 20 Hz instead of 60, so traversal work per unit time is 4,230 → 10,891
(bounded by the gate at 4×). **PATCH 24 (`bboxCache`)** is what makes those
visits affordable: `Tile.BBox` allocated a `Box3` and two `Vector3`s on EVERY
visit (recon T3's allocation half), and the box only moves on a floating-origin
rebase or when the tile's own max height changes. Heap over 400 walks:
**1,398 → 771 KB**.

---

## §7 M3 — `LADDER_FIX` + `STEP_SAFE`: the other user symptom

The user's second report is **"buildings appearing and disappearing."** Recon A4
names the mechanism and this round reproduced it: on a `devicePixelRatio`-1
display — the most common desktop — `CANVAS.dprMax 1.5 / dprMin 1 / dprStep
0.25` makes `buildLadder`'s DPR loop run **zero times**, so the ladder is
literally `[1/high, 1/medium, 1/low]` and **the governor's very first step is a
structural TIER step**: the post chain rebuilds, the high-tier layers unmount.
A transient — one bad second while a city streams — is enough to trigger it.

### What ships

| Switch | What |
|---|---|
| `LADDER_FIX` sub-native rungs | render-scale rungs (0.875, 0.75) BEFORE the first tier rung. `CANVAS.dprMin` is untouched — that is the canvas's own boot arithmetic; these exist for the governor alone |
| `LADDER_FIX.nativeRefresh` | the target follows the display's estimated refresh instead of `min(60, refresh)` (FL-04: a 144 Hz monitor at ~100 fps never stepped while presentation alternated 7/14 ms) |
| `LADDER_FIX.longFrameFrac` | a rolling FRACTION of frames longer than `longFrameK / targetFps` can step the ladder. Counted BEFORE the outlier drop, which exists so one stall is not a hardware verdict but also makes the EMA blind to exactly the pattern users call "not smooth" (FL-13). Being a fraction over a 240-frame window, one hitch can never trigger it |
| `STEP_SAFE` | the governor PARKS the DPR (`lib/fly/step-safe.js`); a `useFrame(cb, -99)` rig applies `setPixelRatio` → `setSize` → `composer.setSize` → React `setDpr` in ONE tick, inside the frame that draws it. Plus the FL-05 in-frame buffer check in the composer's own `useFrame`, which closes the same window for the window-resize path the rig does not cover |

Both are armed by runtime pins (`__flyLadderFixOverride`,
`__flyStepSafeOverride`) — the R16 weather-pin idiom, the same one `TERRA_PACE`
uses — so the A/B runs on the USER'S machine without editing constants, and no
harness rewrites a constants file (HARN-HYG-9).

### RED → GREEN (MEASURED-HERE, `scripts/verify-ladder-fix.js`, 13 gates)

RED calibration on the flag-off tree is a single env var
(`FLY_LADDER_RED=1`) and it fails **6 of 13**:

| | flag-off (RED) | flag-on (GREEN) |
|---|---|---|
| ladder at DPR 1 | `[1/high, 1/medium, 1/low]` | `[1/high, 0.875/high, 0.75/high, 1/medium, 1/low]` |
| sub-native rungs | **0** | **2**, both before the first tier rung |
| refresh 144 Hz → target | 60 fps | **144 fps** |
| a 55 fps-mean session with 10% long frames | never steps (longFrac 0) | steps, **render-scale rungs first**: dpr 0.875 → 0.75 → then medium |
| CONTROL: a clean 60 fps session | never steps | never steps |
| a forced step | `__flyStats.step` **null** — React only | `{n:1, dpr:0.875, applyMs:2.3, canvasW:560, canvasH:315, composer:true, viaValve:false}` |
| composer buffers vs drawing buffer after the step | match | match |

The stutter arm is worth its own note, because the first draft of it proved
nothing: 1 frame in 8 at 45 ms drags the MEAN to 41.5 fps, so the EMA path
stepped the ladder and the long-frame term was never tested (it even reached a
TIER rung, which the gate then "passed" for the wrong reason). The shipped arm
is 90% at 16.7 ms and 10% at 30 ms — mean **53.4 fps, above the 51 fps down
bound** — so only `longFrac 0.10 > 0.08` can move it. An A/B whose control arm
also moves is not an A/B.

`__flyStats.step` is the hook E's `verify-step-clean` needs: it records the
frame's DPR, the canvas backing size the rig wrote, whether a live composer was
registered, and `viaValve` — false when the rig applied it in-frame, true when
the 1000 ms safety valve did (hidden tab, or the canvas unmounted between the
park and the next frame).

### Frozen contracts held

`__flyGov.state()` gains `longFrac` and `subNativeRungs` and moves nothing;
with the pins absent the ladder, the target and the step path are the R21 code
verbatim (the RED run above is that proof). `bufferMatchesDrawing`
(verify-tier-step gate 4) is now true BY CONSTRUCTION rather than by timing.

---

## §8 M5a — `HUD_SYNC` (FL-01) and `REBASE_CALM` (FL-09 + T12)

### HUD_SYNC — the HUD was a picture of the previous frame

rAF callbacks run in REGISTRATION order, and both the label overlay's loop and
R3F's re-register as their FIRST statement, so whichever registered first at
boot stays first for the session. LabelCanvas registers first by construction:
`FlyMode` renders it unconditionally while `FlyCanvas` waits on geolocation. So
every overlay frame projected its tracks through the camera matrices left by
the PREVIOUS `renderer.render` — a consistent picture of frame N−1 composited
over GL frame N. **At 60 fps and ~60°/s of yaw that is ~1°, about 30 px on a
1920-wide canvas**: labels, the lock reticle and the hover ring slide off their
planes in every turn. It is one of the things "tearing" can honestly mean, and
it is one of the three tear-shaped mechanisms this round can actually fix.

The fix: LabelCanvas publishes its draw closure as `runtime.hudDraw` instead of
self-driving, and a rig inside the Canvas calls it from R3F's
`addAfterEffect` — after all roots render, so the camera matrices are the ones
the frame was drawn with. The phone 30 Hz `frameStep` lives INSIDE the closure
and is unaffected by which loop calls it. Cost: the same ~0.5–1 ms of 2D work,
paid inside the GL frame's task instead of a separate rAF slot.

Two FL-06 companions ride `HUD_SYNC.framePriority`:

- **CloudField's `useFrame` gets an explicit −10.** Same-priority subscribers
  run in SUBSCRIPTION order, and React fires a child's layout effects before its
  parent's — so drei's `<Clouds>` child (default 0) decomposes each puff's
  `matrixWorld` BEFORE the parent updates it. CloudField's own inline comment at
  :125 assumes the opposite order; the recon could not settle it without a
  probe, and an explicit priority makes the question moot.
- **`camera.updateMatrixWorld()` at the end of the −50 block, unconditionally.**
  Three refreshes it only inside `renderer.render` (priority +1), and the one
  pre-render refresh this scene had was inside the satellite+high+aerial branch
  — so outside that single configuration, every priority-0 reader that
  decomposes `camera.matrixWorld` was a frame behind. It is idempotent (three
  checks `matrixWorldNeedsUpdate`), so on a frame that did not move the camera
  it is a flag test.

### REBASE_CALM — three small things on the 10 km rebase

1. **The dead store write.** `bumpRebaseEpoch()` wakes every zustand selector in
   the tree on a field with ZERO consumers — grep `rebaseEpoch` outside the
   store at `3592656` and there are none. Every layer that must re-place on a
   rebase already compares `origin.anchor` itself (TownGlow, SatCityGlow,
   LandmarkMonuments).
2. **The traversal.** `root.updateMatrixWorld(true)` re-derives the matrix of
   every tile mesh and chunk under `worldRoot`, in the same frame the renderer
   is about to do it anyway. It exists so same-frame engine conversions see the
   new anchor — but those conversions are `_anchor` arithmetic, not
   `matrixWorld`. What DOES read `matrixWorld` in the same frame is the tile
   raycast behind `getElevationAt`, so the update is narrowed to the tile-map
   subtree and nothing else.
3. **T12, the quantised anchor** (Fable's ruling; C declined a `uMicroAnchor`
   uniform, and this route needs no shader change at all). The low-AGL
   micro-detail grain is hashed on REBASED world metres — `vWorldXZ =
   modelMatrix * position`, and `modelMatrix` carries −anchor — so an ARBITRARY
   anchor shifts every fragment's noise input and the whole near-field grain
   re-phases in one frame, every 10 km of travel. The anchor is snapped to a
   multiple of **704 m = `HILLSHADE.micro.scaleM` (5.5) × 128**, which keeps the
   noise field continuous across every rebase.

   The cost, stated: the anchor can then sit up to 704 m from the aircraft
   instead of exactly on it. Nothing minds — every consumer does `_anchor`
   arithmetic and none reads it as the player's position — and the float
   precision argument is unchanged, since 704 m is negligible against the
   10 km rebase distance the precision budget was sized for.

All three are one flag, and all three are pinned:
`window.__flyRebaseCalmOverride` / `__flyHudSyncOverride`, via the new
`lib/fly/fly-pins.js` (`pinned(base, globalName)`) — the R16 weather-pin idiom
generalised, so a harness never rewrites a constants file (HARN-HYG-9) and the
user can run the A/B from a console line before boot.

---

## §8b M5b — `FINALIZE_PACE` (WB-3, A9, WB-10)

Drape SAMPLING is budgeted per millisecond in all four chunk engines, but the
final ASSEMBLY is atomic per chunk: a merge, `computeVertexNormals` (two passes
over V+I), `computeBoundingSphere` (two more), a collision-column run walk, and
then three's first-draw `bufferData` of four or five attributes on the next
render. A 2×2 skyline group is **~135 k verts / ~5.9 MB of attributes in one
frame** (the per-tile numbers are frozen in fly-constants.js:3020-3022). Only
the toy engine has a wall-clock brake, and its guard is `done > 0 &&` — so the
FIRST chunk always lands however late the frame already is, and the four engines
cannot see each other: each may spend its own allowance in the same frame.

`lib/fly/finalize-pace.js` replaces that with two rules:

1. **The first chunk is not free.** If the PREVIOUS frame overran `longFrameMs`
   (24 ms ≈ 1.5 frames at 60 Hz), no engine finalizes anything this frame. A
   frame that is already late is the worst moment to add a 6 MB upload, and
   "always let the first one through" is how a hitch train sustains itself.
2. **The budget is shared.** `budgetLeftMs()` counts from the START OF THE
   FRAME — stamped once from FlyScene's −50 block, before any layer's
   `useFrame` reaches its engine — so four engines plus veg draw on ONE
   allowance instead of four.

Neither rule can starve a chunk: a deferred chunk keeps its place in
`pendingFinalize` and is retried next frame. **`ready` counts do not move** —
this changes WHEN work lands, never WHETHER it does.

Two companions ride the same flag: **A9** — `SatVegEngine._commitPending` gets
the one-chunk-per-frame budget every other engine already had (it flipped every
finished chunk ready on one tick, and the pooled canopy layers all re-sign on
that tick — a synchronised POP rather than a stall, but the last uncapped
commit); and **WB-10** — the toy merged index is built into a `Uint32Array`
instead of spreading up to ~100 k boxed numbers into a plain array purely to
hand it to `BufferAttribute`, which copies it again. Same values, same order.

### MEASURED-HERE (`scripts/verify-finalize-pace.mjs`, 11 gates)

The brake is pure logic with an injected clock, so it is node-testable: flag-off
never defers (control flow unchanged); a 50 ms previous frame defers the first
chunk while a 16.7 ms one does not; the allowance reads 2.97 ms at frame start
and −1.05 ms after 4 ms of work by ONE engine, and a second chunk is then
refused; a fresh frame restores it. Three gates are source-inspection facts a
future edit could silently undo — every engine calls the brake, the toy typed
array exists **and its upstream spread survives verbatim on the flag-off
branch**, and the veg cap is in place.

**Gate 11 is a merge-safety gate, not a behaviour gate:** it asserts the brake
is a SEPARATE guard and never folded into the `done < X.finalizePerFrame` loop
bound. E's harness budget multiplier sits on exactly that expression, and two
owners editing one expression is how a merge silently drops one of them.

### What this does NOT claim

No frame time. The rule's SHAPE is proven; whether it removes a felt hitch is
the user's machine's to say, and the honest instrument for it is E's
`FRAME_STATS` long-frame count before and after. §9.

---

## §8c M4 — `FRAME_STEP`: the sim half LANDED, the consumer half NOT

Plan §0 ruling 2 says "perpetual rendering" includes *a fixed-timestep
simulation with an interpolated render pose so motion stays smooth through any
hitch*. Ruling 6 says `FRAME_STEP` ships ON at close **if the harness pose
contracts hold**. This section says plainly which half landed.

### The defect (FL-04)

`flight.step(dt, cmd)` runs once per frame on the RENDER delta, clamped at
50 ms, and `flight.pos` is simultaneously the sim state and the render pose:

- motion smoothness IS frame pacing — every dropped frame is a jump;
- a long frame **slows the world down** (the 50 ms clamp turns a stall into
  time dilation) while traffic dead-reckoning keeps wall-clock time, so
  relative motion glitches through every hitch;
- explicit Euler on a varying delta means identical inputs give different
  trajectories at different frame rates.

### LANDED: the accumulator and the published render pose

`lib/fly/frame-step.js` + one branch in FlyScene's −50 block. The model
advances in fixed `1/hz` steps (≤ `maxSubsteps` per frame, so a stall cannot
spiral), and the leftover `alpha` produces an interpolated pose published as
**NEW fields** — `flight.renderPos`, `flight.renderAtt`, `flight.renderAlpha`.
`flight.pos` and `flight.heading` remain the sim truth in both arms: the crash
detector, the contracts and every harness pose read them and are untouched.

MEASURED-HERE (`scripts/verify-frame-step.mjs`, 10 gates, node — the
accumulator has no three and no React dependency):

- **THE PROBE plan §3 A.5 asks for**: at a substep boundary (alpha 0) the
  interpolated pose IS the sim pose, by `Object.is` and not by tolerance; at
  alpha 1 it is the new one.
- flag-off: no accumulator is constructed and the −50 block runs
  `flight.step(dt, apCmd ?? cmd)` verbatim; `flight.pos` is never assigned
  anywhere in FlyScene.
- a 60 fps frame runs exactly two 120 Hz substeps with alpha 0.
- 10 s of travel: 60 fps **100.000000**, 144 fps **99.916667** — and the
  difference is *exactly* the step still sitting in the accumulator (both are
  100.000000000 once the residual is counted). Frame-rate independence for an
  accumulator is "equal to within the step not yet taken"; asserting bare
  equality would have been asserting something false and would have needed a
  fudged tolerance later.
- a 500 ms stall runs 4 substeps (the cap), **counts the 55 it dropped**, and
  leaves less than one step in the accumulator — bounded, and visible to a
  soak rather than inferred.
- heading interpolation takes the SHORT arc across the ±π wrap (the long way
  would spin the model right round for one frame).

### NOT LANDED: the consumer opt-in, and why

PlayerPlane, the chase camera, Contrail and PlayerGroundShadow still read
`flight.pos`. Wiring them to `renderPos` is the half that can move a harness
pose, and **it cannot be certified in this container**: the fleet pins its
poses THROUGH `flight.pos` with a `setInterval`, so proving a render-pose
consumer still lands exactly on the pinned pose needs the fleet running at a
useful rate, which this venue does not offer (SwiftShader, four browsers, load
average 14–17). Shipping the seam and the probe with the consumer list written
down is the honest half; shipping an unverified pose change into a fleet of ~57
harnesses is not. Per Fable's ruling this is a **"not landed" row**, not half a
feature.

**The exact remaining work, for whoever takes it:** four consumers
(`components/fly/PlayerPlane.jsx:74`, `lib/fly/chase-camera.js`,
`components/fly/Contrail.jsx:146-148`, `components/fly/PlayerGroundShadow.jsx`)
read `flight.pos`/`flight.heading` and would read `flight.renderPos ?? flight
.pos` and `flight.renderAtt ?? flight`. The certification is: the R21 quartet,
`verify-chase-cam`'s frozen framing gate, and any harness that asserts a
position after `warpTo` — all on a machine that can run them.

---

## §8d Attribution — E's `markPhase` in the terrain and finalize paths

Six call sites, all no-ops until E's instrument is live: `skirt` (the boundary
scan, 67% of every stalled ms on the R22 tree), `lod-walk` (the quadtree walk,
which runs INSIDE `renderer.render` and is otherwise indistinguishable from a
draw), and `finalize:<engine>` for the four chunk assemblies.

The two vendored sites go in **by inversion** (PATCH 25): the bundle must never
import app code, so `terrain-engine.js` sets `R24_SWITCHES.onPhase = markPhase`
and the sites are a null check on paths that already do real work.

---

## §9 Could not measure here (honest list)

Nothing in this section has a number from this container. The venue is
SwiftShader at ~1 fps under the game's load, four cores shared by five agents
and Fable (load average 14–17 during this round's browser work), and Esri /
OpenFreeMap / adsb.lol are 403-blocked.

| # | Claim that needs a real measurement | Venue |
|---|---|---|
| 1 | Draws/tris identity across the vendoring commit at Owens/Powell/Manhattan | E's fixture (structural) |
| 2 | Any fps / ms / stalls-per-minute / worst-frame number | User's machine only |
| 3 | Governor behaviour in real time, DPR-step timing, tearing | User's machine only |
| 4 | Live tile-URL identity against Esri | User's machine (egress) |
| 5 | Draw counts at the settled canonical poses with the residency trio ON | E's fixture |
| 6 | Whether `bendSphere` (T14) can be enabled inside Owens ≤ 261 / sat ≤ 375 | E's fixture |
| 7 | Stalls/min and felt smoothness of the residency trio | User's machine (`__flyTerraPaceOverride` A/B) |
| 8 | Whether a WRONG tile (cache/URL mix-up) is also in play, as distinct from LOD policy | **ANSWERED on the fixture** — see below |
| 9 | `skirtWorker` end to end — the production LERC path builds geometry in a worker; the fixture's terrain-rgb loader builds on the MAIN thread, so the patched path is never reached here | User's machine (Esri egress) |
| 10 | Whether `walkWhileSaturated`'s 2.5× traversal is invisible in a real frame budget | User's machine |
| 11 | Whether `FINALIZE_PACE` removes a FELT hitch (the rule's shape is proven; the frame time is not) | User's machine, via E's FRAME_STATS long-frame count |
| 12 | `HUD_SYNC`: that the label swim is gone in a turn — it is a visual | User's machine |
| 13 | `REBASE_CALM` T12: that the micro-grain no longer re-phases at a rebase | User's machine |
| 14 | `FRAME_STEP`'s consumer opt-in: that a render-pose consumer still lands on a harness-pinned `flight.pos` | A machine that can run the fleet (see §8c) |

**Row 8 — ANSWERED on the fixture (pass 1, arm A, Fable's run):** 64 resident
tiles, **0/62 URL mismatches, 0/64 position mismatches** with `TERRA_PACE` off.
No resident tile was displaying imagery from another tile's address, so a cache
or URL mix-up is NOT producing the "tiles swapping for other ones" symptom in
the code path, and the LOD-policy attribution in §3 does not rest on an
unexamined alternative.

Two limits, so the result is read at the strength it carries:

1. **The fixture serves deterministic bytes per (z,x,y); Esri does not.** The
   finding in §3 is that a merge REPLACES four children with a coarser parent.
   Against the fixture that parent is consistent imagery, so the swap reads as a
   resolution change. On the user's machine it is a DIFFERENT CAPTURE — other
   season, other sun, sometimes visibly different colour. This probe cannot see
   that class at all, because the URL and the position are both correct and only
   the pixels differ. It is still LOD policy and it does not change the fix, but
   it is why the symptom reads more violently on their screen than any fixture
   number will ever show. **The live-capture variant remains a user-machine
   item.**
2. **The denominator is 62, not 64.** The probe only tests tiles whose material
   already carries a map; the two without a URL were skipped SILENTLY, and those
   are the mid-load tiles — the likeliest moment for a mismatch if one existed.
   Not a reason to doubt the result, but the honest figure.

**The one thing I attempted here and could not finish:** the satellite fixture
A/B in `scripts/verify-terra-live.js` (the content probe + the live draw
ceilings). Two runs died — the first on a fixture-server 502 from E's
since-fixed server-reuse bug, the second on a timeout at load average 14 — and
rather than report a partial number I stopped, made the arms separable
(`FLY_TERRA_ARMS=on|off|both`), added per-stage progressive logging and wrapped
every fixture-stats call so a dead fixture degrades the counters instead of
killing the arm. The harness is committed and ready for a quieter machine.
The ladder gate boots TOY precisely to avoid that cost: the ladder and the DPR
step are style-independent and toy streams no tiles.

## §9b THE BLOCKER I SHIPPED — a missing import in CloudField.jsx

**What it was.** `2fadaa6` (W1f, HUD_SYNC) added `_hudFramePriority()` to
`components/fly/CloudField.jsx`, which calls `pinned(HUD_SYNC,
'__flyHudSyncOverride')` — and never added the import. `pinned` is undefined in
that module, the helper runs at RENDER, and the call is **not behind the flag**,
so it is a `ReferenceError` on CloudField's first render in either style with
every flag off. The scene dies. Fable caught it on the integrated tree;
`eslint --rule no-undef` over my changed files reproduces it on my branch at
`CloudField.jsx:78 'pinned' is not defined` — **one error before the fix, zero
after**, with the other 7 reports being the project's pre-existing
`react-hooks/immutability` ones on untouched lines.

**How it got in.** My edit script for that commit did a `str.replace` whose
anchor (`import {\n  HUD_SYNC,`) did not exist in this file — CloudField's
constants import has a different shape. **`String.replace` on a miss is a
silent no-op**, and unlike the other replacements in that script this one had
no `assert`. The helper it was paired with landed; the import did not.

**Why nothing caught it.** Three instruments, three blind spots, and they are
worth naming because each is a rule I was following:

1. `eslint` with the project config: `no-undef` is not enabled there, so my
   "no new lint errors" check compared totals that never contained this class.
2. The `curl` compile check: a bundler resolves modules, it does not resolve
   *identifiers*. A free variable is a runtime `ReferenceError`, not a build
   error, so `GET / 200` was true and meaningless for this.
3. **No browser gate ran after `2fadaa6`.** This is the honest record: the last
   browser run on this branch was `verify-ladder-fix` at `36792a0` (W1e), one
   commit earlier, and `verify-terra-live` never completed at all. W1f, W1g,
   W1h and W1i were committed on node gates and a compile check alone —
   partly by my own sequencing, and from W1f onward under Fable's browser-gate
   moratorium. A single boot would have caught this in seconds.

**The lesson, in the round's own terms:** *a gate that cannot fail the way the
code can fail is not covering it.* I had three green signals and none of them
could see a free variable. The cheap fix is permanent — `no-undef` over the
round's changed files is a node-only check that costs a second — and it is what
should run before every commit that adds a call site, not just before a merge.

---

## §12 SHIP STATE — what A flipped on at the close

One line per switch, and every OFF one names the run it is waiting for. Nothing
here is off by omission.

| Flag / switch | Ships | Why, in one line |
|---|---|---|
| `TERRA_PACE.enabled` | **ON** | the umbrella for the terrain work below |
| `…timerFix` | **ON** | `updateInterval` gates the quadtree walk again: 10/12 updates walked the whole tree → 4/12 |
| `…mergeHysteresis` | **ON** | kills the refine↔merge flip: on a vertical bob, flips 27→16, merges 21→11, refetches 89→63 |
| `…keepResident` | **ON** | the "tiles swapping" fix: on a pure yaw sweep, merges 22→0, on-screen replacements 17→0, refetches 178→0 |
| `…skirtFast` | **ON** | 7.1×/6.5× on the measured 67%-of-stalls hot spot, byte-identical geometry over 13 cases |
| `…walkWhileSaturated` | **ON** | ends the global freeze that pinned E's tree at z6; strictly conservative — visits 444→4,248, refines and requests unchanged |
| `…bboxCache` | **ON** | pays for the above: heap 1,398→771 KB per 400 walks |
| `…skirtWorker` | OFF | **needs one real-hardware run.** Proven output-identical in node (8/8), but the fixture's terrain-rgb loader builds geometry on the MAIN thread, so only Esri LERC tiles reach the patched path — nothing here has ever exercised it |
| `…bendSphere` | OFF | **needs one real-hardware run** at the canonical poses: it fixes the bend-blind cull by SUBMITTING far tiles that are culled today, which is a draw-count change against Owens ≤ 261 / sat ≤ 375 |
| `…parallelLoad`, `imageBitmap`, `preUpload`, `lodOutsideRender` | OFF | **not implemented this round.** W0 scaffolding switches that no patch reads: turning one on changes nothing. Said plainly in the constants so nobody flips one and waits |
| `STEP_SAFE` | **ON** | the DPR step lands inside the frame that draws it: `{dpr:0.875, applyMs:2.3, composer:true, viaValve:false}` where flag-off recorded nothing at all |
| `LADDER_FIX` | **ON** | `[1/high, 1/medium, 1/low]` → five rungs with 0.875 and 0.75 first, so the first step is no longer a tier step |
| `…nativeRefresh` | **ON** | plan §0 ruling 6. **The one flipped value with no measurement behind it** — an exact no-op at 60 Hz (`min(60,60)`), and on 120/144 Hz it raises the target while recon FL-04's own question to the user is still unanswered |
| `HUD_SYNC` | **ON** | the overlay stops being a picture of frame N−1 (~30 px of label swim per turn at 60°/s) |
| `FINALIZE_PACE` | **ON** | one shared per-frame brake across four engines, and the first chunk is no longer free after a long frame |
| `REBASE_CALM` | **ON** | the dead store bump, the narrowed matrix update, and the 704 m quantised anchor so the micro-grain stops re-phasing every 10 km |
| `FRAME_STEP` | OFF | **the consumer opt-in did not land** (§8c). The accumulator and the interpolated pose are proven (10/10, incl. the substep-boundary identity); pointing PlayerPlane / chase cam / Contrail / ground shadow at `renderPos` is the half that can move a harness pose, and it cannot be certified in this venue. On today it would change the sim integration with nothing reading the smoother pose: all the risk, none of the benefit |

### The gate change the flip forced

Every one of my gates drives its feature by setting the switch ITSELF — which
is correct, because the property under test is *"off = the R21 arithmetic,
on = the fix"*, not *"the flag happens to be false"*. But that makes all of
them blind to the SHIP STATE: a flag silently reverted to `false` would leave
every behaviour gate green while the fix was gone from the build. **Those are
two separate claims and both now have a gate.** `scripts/_r24a-ship-state.mjs`
reads the literal out of `fly-constants.js` by brace-matching (not a copy, not
an import — the file that ships), and each gate asserts its own block against
the ruled state while keeping its forced-state behaviour arms.

Three arms had to be hardened for the same reason, and this is the interesting
half of the flip:

- `verify-finalize-pace` gate 1 now says **forced** off, not flag-off.
- `verify-ladder-fix`'s RED arm used to *omit* the pin. With the constants
  shipping ON, an omitted pin IS the shipped state, so the RED calibration
  would have gone quietly green while claiming to measure the defect. It now
  FORCES both features off.
- `verify-terra-live`'s arm A had the same shape — an unpinned control that
  had become the treatment. **An A/B whose control arm is the treatment is not
  an A/B**, which is the same lesson as the stutter arm in §7, arriving from
  the opposite direction: there the control moved, here it silently stopped
  being a control at all.

`verify-vendor-three-tile` gained gate 16b: the vendored switchboard's own
literal must default every switch to `false` regardless of what the app ships,
because the bundle is imported by node fixtures and by the app alike and only
`terrain-engine.js` decides what is on.

---

## §13 Pass-1 gate 6 (`1 → 17` duplicate URLs): the LRU is NOT the cause

Pass 1's terra-live row failed gate 6 — duplicate URLs `1 → 17` with the trio
ON, the opposite direction from the node fixture's `178 → 0`. Three candidate
causes were put to me. **It is none of them as stated, and the LRU hypothesis
is dead twice over.**

### The LRU is ruled out, by arithmetic and by its own effect being absent

| | value |
|---|---|
| cap (`TILES.lruBudgetBytes`) | 140 MB |
| fixture imagery tile, 256² sRGB + mips (`w·h·4·4/3`) | 341.3 KB |
| fixture DEM geometry at the 33² grid (pos+uv+nrm+idx) | 58.0 KB |
| ⇒ per resident tile | **≈ 399 KB** |
| ⇒ what 140 MB admits | **≈ 358 tiles** |
| observed arm B, Powell 41.3 MB | ≈ 106 tiles — **30% of cap** |
| observed arm B, Owens 50 MB | ≈ 128 tiles — **36% of cap** |

The cap was never within a factor of three of binding. And independently:
**the byte LRU's ONLY effect path is setting `_r24Collapse`, which
`_LODEvaluate` turns into a return of 2 — a MERGE.** Arm B reports
`merges 0, refetchParent 0`. Had the LRU evicted anything, both would be
non-zero. Budget headroom and absent effect are two independent refutations.

(The counter semantics were the other candidate; E confirms `/__stats/reset`
clears `byUrl` outright and each arm's window is its own sweep. Every fixture
response is `no-store`, so the browser cache is not masking repeats either: the
counts are honest, and — as E notes — an upper bound on live, where real cache
headers and R21's persistent Cache API tile cache both apply.)

### What it actually is: upstream's discard-after-download, at 51° per FRAME

`_loadSubTiles` re-checks `_LODEvaluate` **after** awaiting the four children
and calls `unloadSubTiles()` if the answer is no longer "refine" — it throws
away downloads it has just made. Whether that fires depends on how far the
camera turned DURING the download, i.e. on **degrees of heading change per
FRAME**. The harness drove the yaw off the wall clock at ~51 °/s: 0.85 °/frame
at 60 fps, but **~51 °/frame on this ~1 fps container**. At that rate the camera
does not sweep, it teleports, and essentially every refine started in the sweep
has its parent out of frustum before its children land.

MEASURED node-side on the real vendored classes (`scripts/r24-out/probe-refetch.mjs`,
throwaway; 60 frames, tile latency 2 frames):

| arm | deg/frame | refines | merges | **discards** | unique | reqs | **dup URLs** |
|---|---|---|---|---|---|---|---|
| OFF | 0.85 | 45 | 1 | 0 | 176 | 177 | **1** |
| trio | 0.85 | 45 | 0 | 0 | 176 | 176 | **0** |
| trio + walkWhileSaturated | 0.85 | 45 | 0 | 0 | 176 | 176 | **0** |
| OFF | 51 | 47 | 34 | 3 | 52 | 218 | **28** |
| trio | 51 | 55 | 0 | 1 | 212 | 216 | **4** |
| trio + walkWhileSaturated | 51 | 59 | 0 | 7 | 204 | 232 | **28** |

At **0.85 °/frame — the same 51 °/s on a 60 fps machine — the trio takes
duplicate URLs 1 → 0.** At 51 °/frame the same code goes 28 → 28: the 34 merges
the fix removes are replaced, one for one in kind, by discards.
`walkWhileSaturated` raises them further (4 → 28) and that is not a bug in it:
it correctly restores the refine STARTS that upstream's freeze rule was
suppressing, and at 51 °/frame every start is doomed.

So the honest attribution has three parts, and the middle one matters:
- the duplicates are **upstream's** waste path, not the trio's — the trio
  removes merges (`1 → 0` live, `34 → 0` in the probe) and adds none;
- they are **surfaced by the venue's frame pacing**, not by the fix. 45 s at
  1 fps is 45 discrete 51° jumps, which is not a turn;
- and `walkWhileSaturated` makes them **more visible**, because it stops the
  freeze from hiding refine starts. That is the fix working, seen through an
  instrument calibrated for a different machine.

**Not claimed:** that the discard path is harmless on the user's machine. The
probe says it is zero at 0.85 °/frame with a 2-frame latency; a real machine has
longer network latency, and the product (deg/frame × latency) is what governs
it. That is a user-machine item, and a genuinely cheap follow-up if it shows up:
re-check the frustum BEFORE issuing the four child loads, not only after they
land.

### The instrument fix

`PIN_YAW` now advances the heading **per frame** (`FLY_TERRA_YAW_DEG_PER_FRAME`,
default 0.85) instead of per wall-clock second, so both arms sweep the same ARC
at any frame rate, and it publishes `window.__fxYaw = {frames, deg}`. Gate 6
refuses to compare two arms unless both swept ≥ 360° and within 10% of each
other; otherwise it prints `SKIP … NOT CALIBRATED` with the two arcs rather
than a red.

**Consequence for pass 2, stated plainly:** at ~1 fps, 45 s × 0.85 °/frame is
about 38° of arc, so gate 6 would SKIP in this container rather than produce a
number. That is the correct outcome — the row needs either a much longer sweep
or the user's machine. A skip that says why beats a red that measures the venue.

**And then the sweep length became reachable** (Fable's ruling, same round):
rather than leave the row skipped here, the sweep is now a harness-only env,
`FLY_TERRA_SWEEP_MS`, defaulting to the original 45000 so an unset environment
is byte-identical to the gate before the env existed (`FLY_TERRA_YAW_MS` is
kept as its alias, so no existing invocation moves). The arithmetic Fable has
to pay: 360° ÷ 0.85 °/frame ≈ **424 rendered frames**, which at this venue's
~1 fps is ~7–8 minutes of wall clock **per arm**; pass 2 runs it at 600000
(10 min/arm) with `FLY_TERRA_ARMS=both`, so gate 6 asserts for real here
instead of skipping. `page.waitForTimeout` is not bounded by Playwright's
default timeout, so the only cost is wall clock — budget roughly +20 minutes
over pass 1's 715 s for the row.

The arc is now printed **beside the verdict on every path**, not only on the
skip: a new `arc swept` line in the YAW SWEEP block carries both arms'
degrees and frames, gate 6's PASS/FAIL detail string repeats them, and the SKIP
text names `FLY_TERRA_SWEEP_MS` as the knob to raise (explicitly **not**
`FLY_TERRA_YAW_MIN_ARC` — lowering the arc minimum would restore exactly the
under-calibrated comparison that produced the 1 → 17). A reader of the log can
now always see what arc the number was measured over.

**Still worth having (E, pass 2):** the per-prefix breakdown. It is no longer
load-bearing for this attribution, but an eviction-refetch cycle would show in
`img` AND `dem` together and nowhere else, so it is the cheapest confirmation if
the question ever reopens. Also unaddressed by the arc fix, and E's own catch:
the stats reset is not atomic with the yaw pin, so boot-tail requests land in
the window and the ON arm holds more resident state at that moment — a second,
smaller contributor to the 1 vs 17 asymmetry.

---

## §14 THE ROUND'S FIRST DEFECT IN A SHIPPED FEATURE — rule 1 tested a level

Found where the close flip met the venue, in **my own** feature, after it had
already been ruled ON. It is the most serious thing in this ledger, so it gets
stated plainly rather than folded into a follow-up list.

### What shipped, and what it did

Rule 1 of FINALIZE_PACE read:

    if (done === 0) return lastDtMs <= c.longFrameMs;   // longFrameMs = 24

That is a test for a **level**, not for a spike. On any machine whose frames are
*steadily* longer than 24 ms — **anything below ~41 fps** — every frame is
"long", so rule 1 refuses the first finalize of **every** frame, forever. Each
engine's `if (!mayFinalize(done)) break;` fires before its loop body has run
once, so `done` never reaches 1 and rule 2 is never even consulted. No chunk
ever finalizes.

The symptom is not a stutter. **Buildings never appear at all.**

| machine | frame time | rule 1 as shipped |
|---|---|---|
| 60 fps desktop | 16.7 ms | fine — this is the machine the round assumed |
| ~41 fps | 24 ms | the threshold |
| 30 fps laptop | 33 ms | **starved** |
| 20 fps integrated GPU | 50 ms | **starved** |
| fixture venue (SwiftShader) | 300–1000 ms | **starved, totally** |

Those middle two rows are laptops and integrated GPUs — *exactly the machines
that report the symptoms this round exists to fix*. I shipped a fix for
stuttering that would have stopped the world from streaming in on the hardware
that stutters.

### How it surfaced

Not on a machine. On the **venue**: pass 2's flash-guard census read **0 meshes
and 0 triangles at Powell AND Manhattan** after the same 60 s settle that gave
**31,576 / 126,116 triangles in pass 1**, when FINALIZE_PACE was off. At
300–1000 ms per frame the starvation is absolute rather than graded, which is
the only reason it was visible at all. **The venue did not cause the defect. It
converted a graded failure into an absolute one, and so exposed it.**

The first diagnosis — mine — was that this was a venue artifact needing a
harness seam, and I wired `budgetK()` into rule 1 so the scaler would switch it
off. Fable rejected that and was right to: a harness exemption would have left
the defect live on every user machine below 41 fps and removed the only
instrument that could ever have caught it. **The bug was never that the venue is
slow. It was that "long" was defined absolutely.**

### The fix, in the product

Rule 1 now refuses only a **spike**: the frame must exceed **both**
`longFrameMs` **and** `spikeK` × a running EMA of recent frame times.

- a 40 ms hitch amid 16 ms frames is 2.4× its baseline → refused, which is the
  hitch train rule 1 was written to break;
- a steady 33 ms machine is never refused — its own baseline is 33 ms, it is not
  spiking, it is simply slower;
- a steady 1 fps venue is a **no-op by construction**, for the same reason. That
  line is the proof the fix belongs to the product: *the harness needs no
  exemption from a rule that correctly ignores it*, and rule 1 carries no K seam
  at all now.

The spike is measured against the EMA **of the frames before it**, never one the
spike has been folded into — otherwise a large enough hitch raises its own
threshold and hides itself.

Plus a **hard starvation cap**: no more than `maxRefuseFrames` (3) consecutive
refusals, then one frame is admitted whatever the EMA says. Rule 1 is an
optimisation, and an optimisation that can starve is worse than not having it.

Two knobs added to `FINALIZE_PACE`, both documented in the block: `spikeK: 2`
(generous on purpose — a missed hitch costs one late upload, a false positive
costs the whole world) and `maxRefuseFrames: 3`.

The EMA seeds at `longFrameMs`, not at the first frame observed: a cold start
has no baseline, and seeding from the first frame would make every first frame
un-spikeable by definition. The visible consequence is honest and bounded — a
very slow machine refuses a handful of frames while the baseline climbs (the
venue arm measures 6 of the first 40, worst run 3, then never again), and the
starvation cap is what bounds it. Gate 15 asserts that shape rather than hiding
it behind a slice.

### Proof

`verify-finalize-pace.mjs` 14 → **17 gates**, RED-calibrated by reverting rule 1
to the shipped line: **14, 15 and 17 fail**, with 14 reading **0/40 frames
admitted** — the defect's exact signature. 16 passes both ways, which is correct
and is the point: *the fix did not move the hitch behaviour it was written for.*

| gate | asserts | on the shipped rule |
|---|---|---|
| 2 / 3 | a cold 50 ms frame is a spike (2.08× the 24 ms seed) and is refused; a 16.7 ms frame is not | unchanged — PASS both ways |
| 14 | steady 33 ms (~30 fps) finalizes on **every** frame | **FAIL, 0/40 admitted** |
| 15 | 20 fps and the 1 fps venue converge to permanent admission, worst run ≤ 3 | **FAIL, 0/40, worst run 40** |
| 16 | one 40 ms hitch amid 16.7 ms frames is refused, **and only that frame** | PASS both ways |
| 17 | a hitch TRAIN never defers more than 3 in a row | **FAIL, worst run 20** |
| 18 | rule 2's shared budget is `budgetMs × budgetK()` — 3 ms at K=1, 120 ms at K=40 | unchanged |

Gate 18 keeps E's scaler on rule 2 only, matching the five engine sites where E
already scales the count budgets. `lib/fly/harness-budget.js` is imported by the
gate **for real** (copied beside the shim, not inlined), so it exercises E's
actual clamp and its actual `typeof window === 'undefined'` branch rather than a
stand-in that agrees with my reading of it — that branch is also why the K arm
has to define a `window`.

### The sentence in my own header that was false

> "Neither rule can starve a chunk: a deferred chunk keeps its place in
> `pendingFinalize` and is retried next frame."

"Retried next frame" is worth nothing if next frame refuses on the same grounds
forever. The claim was true of rule 2 and false of rule 1, and I wrote it while
believing it of both. It is corrected in place in the module header, with the
correction marked rather than quietly edited.

### Still open, and NOT mine to close — flagged for E and Fable

`sat-veg-engine.js:516` caps veg commits at `FINALIZE_PACE.vegPerFrame` (1)
whenever `finalizePaceOn()`, and **E's `budgetK()` does not scale it** — it is
the one budget site of the six that the scaler misses. This is a *different and
much milder* shape than the rule 1 defect: a cap of 1 per frame still makes
monotone progress, where rule 1 made none. But at 1 fps it is one veg chunk per
second, so any veg content gate on this venue will read a partially populated
world and should either raise `vegPerFrame` via the pin or wait proportionally.
I have not touched it: it is E's file and E's seam.

### Lessons

1. **A threshold on an absolute frame time is a threshold on the user's
   hardware.** "Long" only means anything relative to what that machine normally
   does. Every fixed-millisecond frame-time comparison in this codebase deserves
   the same question asked of it.
2. **A pacing rule that can refuse must have a starvation cap**, independent of
   how sound its per-frame reasoning is. The cap is not a workaround for a bad
   heuristic; it is the property that makes the heuristic safe to ship.
3. **My first instinct — "the venue is slow, give it a harness seam" — was the
   wrong shape**, and would have hidden a live user-facing defect behind a test
   flag. When a feature misbehaves *only* on the slowest machine available, that
   is not evidence it is a venue artifact. It is the machine where a graded
   defect became measurable.
4. **A shipped flag is not a certified flag.** FINALIZE_PACE was flipped ON at
   the close with all its gates green, because every one of those gates fed it
   frame times from a healthy machine. The gate suite tested the rule I meant to
   write, not the rule on the hardware users have.

---

## §15 Pass-2b step-clean: the rig was not the only writer — r3f was the other

Second defect found in a shipped R24 feature, and the same shape as §14: a
claim in a header that I never measured.

### What pass 2b measured

Tree `ec53fd3`, STEP_SAFE + LADDER_FIX ON, DPR 1.5, governor pin released:
6 forced steps, **12 DPR applications, exactly 6 inside a rAF and 6 outside**,
and **12 of 30 canvas.width/height writes outside a frame**. Each outside
application carries the **same value** as the inside one, 46–117 ms later:

    setPixelRatio: {d:1.25,inRaf:true, t:178239.6}
                   {d:1.25,inRaf:false,t:182942.8}
                   {d:1.5, inRaf:true, t:184117.3}
                   {d:1.5, inRaf:false,t:184181.2}   …

Same value, one per step, shortly after. That is not a race and not the
governor stepping twice — it is a **second writer applying what the rig has
already applied**.

### The chain, named exactly

`FlyCanvas` holds the DPR in **React state** and passes `<Canvas dpr={dpr}>`.
The `setDpr` the rig calls is that React setter, not r3f's store setter. So:

1. rig applies to three inside the frame (`setPixelRatio` → `setSize` →
   `composer.setSize`) — the 6 inside applications;
2. rig calls `setDpr(d)` → React schedules a render;
3. on commit, r3f's `Canvas` layout effect runs
   `await root.current.configure({ …, dpr, … })` — an **await**, so the store
   write lands a task later (`@react-three/fiber` 9.6.1,
   `react-three-fiber.esm.js:62-77`);
4. r3f's zustand subscriber then re-applies, unconditionally
   (`events-b389eeca.esm.js:1158-1166`):

        if (size.width !== oldSize.width || … || viewport.dpr !== oldDpr) {
          updateCamera(camera, size);
          if (viewport.dpr > 0) gl.setPixelRatio(viewport.dpr);
          gl.setSize(size.width, size.height, updateStyle);
        }

   — outside any animation frame. The 6 outside applications.

The arithmetic checks out exactly. Per application three does one
`setPixelRatio` (which internally calls `setSize` once) plus one explicit
`setSize` = 1 + 2. Six rig applications and six r3f applications give
**12 setPixelRatio and 24 setSize**, which is precisely what the log reports,
with half of each outside.

It cannot be pre-empted from the rig: `configure` is async, and the subscriber
is captured in `createRoot`'s closure with nothing exported to reach it.
`flushSync` does not help either — the `await` defers the store write past the
flush.

### What I got wrong, in my own words

The rig's header said:

> r3f's own catch-up then re-applies identical numbers on its next commit, and
> **Chromium does not reallocate on an unchanged `canvas.width`** — which is
> why calling `setDpr` here as well is not a second resize.

I never measured that, and the HTML spec says the opposite: assigning `width`
or `height` resets the canvas bitmap. I knew there was a second writer — I
wrote it down — and then argued it away with an unverified claim instead of
either measuring it or removing it. **That is how a second writer survived a
design whose entire claim is that there is one writer.** Both headers now carry
the retraction rather than a quiet edit.

### The fix: `installResizeGuard`

When the rig owns the step, a resize request for the state the renderer is
**already in** must not reach the canvas. The rig installs an instance-level
guard on `gl.setPixelRatio` / `gl.setSize` from an effect keyed on the
renderer, and removes it on unmount.

It skips **only** redundancy, never work:

- a real DPR step resizes (its target differs);
- a real container resize resizes (same, on the other axis);
- an unsettled CSS style is not "already satisfied" and delegates;
- `xr.isPresenting` and a non-null `renderer.output` **always** delegate,
  because three takes different paths there and a skip would drop
  `output.setSize`. The app sets neither — this is insurance, not a live case.

On a skip it still calls `setViewport(0, 0, w, h)`, which is the one side
effect three's `setSize` has that a bare `return` would drop. That makes the
skip a **semantic no-op** rather than a behaviour change, which is the only
form of suppression worth shipping.

### Why not the other three options

| option | why not |
|---|---|
| stop calling `setDpr` from the rig | `viewport.dpr` goes stale, and the next genuine container resize re-applies the STALE dpr from r3f's subscriber — it would undo the governor's step |
| `flushSync(() => setDpr(d))` | r3f's `configure` is `await`ed, so the store write lands after the flush regardless |
| shadow `canvas.width`/`height` with a no-op setter | suppresses the *reallocation* but not the *call*, so `verify-step-clean` (3) stays red — and its greenness would then depend on whether my instance property or the harness's prototype patch is outermost. A fix whose proof depends on instrumentation ordering is not a fix |

### Proof — `scripts/verify-step-guard.mjs`, NEW, 13 gates

The browser gate can only see the consequence, so the whole **decision table**
is pinned in node against a fake renderer that reimplements three r185's
`setPixelRatio`/`setSize` verbatim and counts canvas assignments. **Gate 0
re-derives that fake from `three.module.js`'s real source text** (seven
behaviours), so the fake cannot rot into agreeing with a guard that is wrong.

RED-calibrated by neutering the guard: **gates 2 and 10 fail** (4 canvas writes
on a redundant catch-up; owner LOST after a StrictMode double-mount). Gate 1 is
a standing RED control — it runs an *unguarded* renderer through the same
redundant catch-up and asserts it writes, so the gate carries its own
before-picture on every run.

Two instrument bugs of my own, caught on the first run and both worth naming:

1. the fake counted a canvas write only when the **value changed**, so it
   scored the defect **zero** and gate 1 went red on a correct guard. A
   reallocation happens on every assignment; that is the entire defect.
2. the shim bound `const STEP_SAFE = globalThis.__sgCfg` **once at import**, so
   the flag-OFF row silently tested the flag-ON build. Now getters.

Both are the §9b family again — *an instrument that cannot express the defect
cannot certify the fix* — and both were caught because the gate had a RED arm
to disagree with.

### What this means for `verify-step-clean` — E's gate, unchanged

`verify-step-clean.js` is **E's** (`686db21`), so I did not touch it, and it
**needs no change**: its assertions (2) "every canvas.width/height write is
inside a rAF" and (3) "every `gl.setPixelRatio`/`gl.setSize` is inside a rAF"
are already the right ones, they failed honestly on the defect, and the guard
makes them true. Fable's suggested "exactly one application per step, inside
the frame" is a *stronger* claim and a good one — the guard satisfies it, and
`window.__flyStats.stepGuard` now counts suppressed calls so a browser gate can
assert it directly — but adding it is E's call, not mine.

Note for the re-take: (3b) already passed at 0/6 before this fix, because the
rig owns the composer resize and r3f never touches the composer. And (4)
`bufferMatchesDrawing` was **0 mismatched of 43** (pass 1: 22 of 46), so the
user-facing symptom was already closed by the rig alone — this fix closes the
*mechanism claim*, which is what stops it coming back.

### Lessons

1. **A design whose claim is "there is exactly one writer" must enumerate the
   writers.** I had r3f's catch-up written down in my own header and reasoned
   it away instead of counting it.
2. **An unmeasured platform claim is the most dangerous kind of comment**,
   because it reads like a fact and closes the question for the next reader —
   who was me, twice.
3. **Suppression is only safe when it is a semantic no-op.** The `setViewport`
   on the skip path is what separates this from "return early and hope".
4. **Prefer the fix whose proof does not depend on instrumentation ordering.**

---

## §16 The pass-2b toy-boot pageerror: WB-10's index was never wrapped

Third defect in a shipped R24 feature, same family as §14 and §15 and the
cheapest of the three to have prevented. **Attributed by B**, from a headless
attribute census, and confirmed from source by Fable before it reached me — I
am recording that plainly because the finding is not mine.

### The defect

`BufferGeometry.setIndex(x)` wraps `x` in a `BufferAttribute` **only** when
`Array.isArray(x)` is true (three r185, `three.core.js:18404`):

    setIndex( index ) {
      if ( Array.isArray( index ) ) {
        this.index = new ( arrayNeedsUint32( index ) ? Uint32BufferAttribute
                                                     : Uint16BufferAttribute )( index, 1 );
      } else {
        this.index = index;                     // ← a typed array lands HERE
      }
    }

`Array.isArray` is **false** for a typed array. WB-10 changed the merged land
index from a plain array to a `Uint32Array` and left the call as
`geo.setIndex(idx)`, so `geometry.index` became a raw `Uint32Array` with no
`.array` and no `.count`. Nothing structural notices — the scene graph, the
counts and the draw list are all correct — and then `WebGLAttributes` reads
`attribute.array.byteLength` at first upload and throws, **once per land mesh**.

That is the pass-2b toy-boot pageerror: `Cannot read properties of undefined
(reading 'byteLength')`, ×31 on ladder-fix and ×3 on ladder-red, on **both**
arms — both arms because the flag was ON in both.

**Why pass 1 was clean and pass 2b was not:** the flag-OFF branch builds a
plain array, which three wraps *and* sizes for you. The bug was reachable only
with FINALIZE_PACE armed, and FINALIZE_PACE was flipped ON at the close.

### The 2×2, reproduced here

B's `scripts/r24-b-attr-proof.js` (r24/b `8bb4164`), run against this worktree
through a symlinked probe root so nothing of B's lands on r24/a:

| tree | FLASH_GUARD | FINALIZE_PACE | broken meshes |
|---|---|---|---|
| shipped line restored | off | **on** | **80** (every land mesh) |
| shipped line restored | off | off | 0 |
| **fixed** | off | **on** | **0** |
| **fixed** | on | on | 0 |
| **fixed** | off | off | 0 |
| **fixed** | on | off | 0 |

160 meshes over 138 chunks, 80 ready. B's numbers reproduce exactly.

### The fix, and the half of it that is easy to miss

1. **Wrap it** — `idx = new BufferAttribute(merged, 1)`.
2. **Keep the width three would have chosen.** Defaulting to `Uint32Array`
   would have silently **doubled every toy land index buffer**, which is the
   exact opposite of what WB-10 exists to do (B's note 1). So the armed branch
   mirrors `arrayNeedsUint32` (`three.core.js:1779`): `Uint16Array` unless some
   index is `>= 65535`. The bound is **65535 and not 65536** in three's own
   source — `PRIMITIVE_RESTART_FIXED_INDEX`, three #24565 — so it is mirrored,
   not re-derived.

An element of the merged array is either a `groundIdx` value or
`data.idx[k] + off`, so three's "any element ≥ 65535" **decomposes exactly**
into two scans and the array never has to be built twice to be measured.

It is scanned, **not inferred from `total - 1`**. A bound is not the same claim
as a maximum: if the chunk has ≥ 65536 vertices but no index actually reaches
65535, three picks `Uint16` and an inferred answer would pick `Uint32` — the
two paths would then differ in TYPE while agreeing in values, which is exactly
the equivalence this is supposed to preserve.

### Every other `setIndex` in reach, checked rather than assumed

23 call sites. Three pass a bare variable; the rest already pass a
`BufferAttribute` or an array literal.

| site | argument | verdict |
|---|---|---|
| `toy-world-engine.js:1007` | typed array under the flag | **THE DEFECT — fixed** |
| `SatTintLayer.jsx:124` | `new BufferAttribute(new Uint32Array(...), 1)` | safe, read it myself |
| `Contrail.jsx:89` | a plain `[]` built by `push` | safe, read it myself |
| `PrecipLayer.jsx:176` | an array literal | safe |
| 19 others | `new BufferAttribute(...)` | safe |

Fable told me two of those answers in advance and both were right; I read them
anyway, because "someone said it was fine" is how §15 happened.

### Proof

`verify-finalize-pace` 17 → **21 gates**, RED-calibrated by restoring the
shipped line: **8, 19 and 20 fail**.

- **19** the index is wrapped, and no `setIndex(new Uint…)` survives anywhere;
- **20** the width mirrors `arrayNeedsUint32` and the constant is present;
- **21** reads the threshold out of `three.core.js`'s **real source text** and
  compares it to ours, so a three bump that moves the number fails here instead
  of silently desynchronising the two paths;
- **22** *executes the decision*: `INDEX_U32_MIN` and `anyAtLeast` are lifted
  verbatim out of the engine (both are module-level and import nothing) and run
  against three's own predicate over the array the flag-OFF branch actually
  builds, across 7 cases — including exactly-at-the-bound both ways, and the
  case where it is the OVERLAY's offset that crosses the line. All 7 agree.

Gate 22 is deliberately not a restatement of the rule. A gate that re-implements
the logic it is checking agrees with the author, not with three.

The flag-OFF branch is **untouched** — the diff contains no `-`/`+` line inside
it, and gate 9 still asserts the upstream spread verbatim.

### Lessons

1. **Changing a container type is an API change, not an optimisation.** WB-10
   read as "same values, same order, only the container changes" — and the
   container was precisely what `setIndex` branches on.
2. **A flag-gated micro-optimisation inherits the flag's blast radius.** This
   was unreachable until the close flip, so every gate that had ever run on it
   ran on the other branch. §14 was the same sentence about a different feature.
3. **When you replace what a library was doing for you, replace ALL of it.**
   three was not only wrapping the array, it was choosing its width. Taking over
   the first job and not the second is how the "optimisation" would have doubled
   the buffer it set out to shrink.
4. **Read the sites you were told are fine.** Two of the three bare-variable
   call sites had already been cleared for me; reading them cost a minute and is
   the only reason I can put my name on the table above.

---

## §17 The seventh harness-budget site (E CERT's find)

E CERT attributed pass 2b's **longest single stall — 3660 ms under
`[finalize:sat-roads x16]`** — to `sat-road-engine.js`: its finalize bound was a
bare module const, `done < FINALIZE_PER_FRAME`, that `budgetK()` never touched.
Every other engine reads `perFrame * budgetK()`. At K=40/200 every other engine
speeds up and roads does not, so the road ring starves and the stall
concentrates exactly where `markPhase` pointed — the attribution hook finding
the site it was built to find.

E offered it rather than taking it, because the scaler idiom is mine. Fixed with
the same shape as the veg site (`59b4e97`):

    const perFrame = Math.max(1, FINALIZE_PER_FRAME * budgetK());

`budgetK()` is exactly 1 without `FLY_FINALIZE_BUDGET_K`, so the production
arithmetic is byte-identical.

**Gate 23** pins the expression, the loop bound and the import together, the way
gate 10 does for veg — an assertion that moves WITH the expression it guards
rather than merely tolerating it.

**The site census is INFO here, not a gate, and deliberately.** Five of the
seven sites do not exist on `r24/a` — they are E's, and they arrive at the
merge. A census asserting "all seven carry the scaler" would be RED on this
branch and green only after integration, which is a gate that measures the
BRANCH rather than the code. It prints `1/9 on this branch` and says so.
**Promote it to a gate on the merged tree** — that is the right home for it, and
it is the row that would have caught this site and the veg site both.

---

## §18 The Owens breach: retention was charging rent in draw calls

Pass 2b held every yaw contract — merges 35 → 0, on-screen replacements 27 → 0,
0 URL and 0 position mismatches, no page errors — and broke the frozen desert
control: **Owens draws off 152 / on 279**, ceiling 261.

### The measurement that named it

E's addendum is what settled the mechanism, and it did so without a renderer:
the SAME pose with the SAME flags read **185 draws after a 45 s sweep and 279
after a 600 s sweep**, resident tiles 62 → 103, at 113.7 MB and still climbing.
The only variable was **how long the camera had been turning**.

That is not a cull margin and not a one-off pose. It is **retention with no
bound and no separation between being RESIDENT and being ISSUED** — draw calls
that grow for as long as the session runs. On a real GPU at 60+ fps the
accumulation is an order of magnitude faster than on this fixture, and the user
was flying `8240539` while this was being read.

### Attribution, switch by switch

Measured on one synthetic yaw against the real vendored classes:

| arm | issued | off-frustum | maxZ |
|---|---|---|---|
| flag-off | 103 | 83 | 13 |
| mergeHysteresis | 103 | 83 | 13 |
| timerFix | 103 | 83 | 13 |
| walkWhileSaturated | 103 | 84 | 13 |
| bboxCache | 103 | 83 | 13 |
| **keepResident** | **190** | **142** | **17** |
| ON (all) | 190 | 142 | 17 |
| ON minus keepResident | 103 | 84 | 13 |

**`keepResident` alone.** Every other switch reads identical to flag-off, and
removing keepResident from the full ON set returns the flag-off number exactly.

Two of the three hypotheses are refuted by measurement rather than argument:

- **Not double-issue.** `doubleIssued` is **0 in both arms** — a parent and its
  children are never drawn together. The shape that would have produced exactly
  this (+41 tiles, ×2.4 tris) does not occur, because `_loadSubTiles` unloads
  the parent's model on the success path and `_removeSubTiles` unloads the
  children on its own.
- **Not `bendSphere`.** It ships `false` and is never armed; my own constants
  comment already said it "necessarily submits tiles that are culled today".

What is left is the honest finding: keepResident retains everything the camera
has ever refined, in every direction, and **all of it stayed attached to the
scene graph**.

### The fix, in two halves — because the requirement is two things

**1. Retention must not cost draw calls (PATCH 26, `TERRA_PACE.parkOffscreen`).**
A tile out of frustum keeps its model, its textures and its place in the tree —
nothing disposed, nothing re-downloaded — but its **model** is parked invisible,
so three skips the whole subtree in `projectObject`: no draw, and no per-mesh
cull either. Coming back is one boolean.

It is the MODEL that is parked, never the tile: a tile's children hang off the
tile, so hiding the tile would hide in-frustum descendants. And a parent whose
box contains an in-frustum child is itself in frustum, so a visible tile can
never be orphaned behind a parked ancestor.

| 240-frame yaw | unparked | parked |
|---|---|---|
| issued (drawable) | 190 | **48** |
| issued OFF-FRUSTUM | 142 | **0** |
| resident tiles | 190 | **190** (unchanged) |
| merges / refetches | 0 / 0 | 0 / 0 |

And the property that actually closes pass 2b — **the drawn set stops growing
with sweep duration**: unparked it climbs (142 → 151 from 240 to 720 frames);
parked it is bounded by the frustum (48 → 39), which is the only thing that
should bound it.

**No upstream line is edited.** The `_update` pre-pass computes `_inFrustum` on
its own added line so the upstream comma-expression stays byte-verbatim — the
vendor gate's edited-line count does not move, and gate 8 stays at 2.

**2. Residency has a cap, and an LRU that is a real recency order.**
`TILES.lruBudgetBytes` (140 MB) was the only trigger, and pass 2b proved a byte
budget alone is not a bound: Owens sat at **113.7 MB the whole time**, under
budget, while the tile count doubled — so this module elected **nothing**. *A
budget a session cannot reach is not a budget.* Tiles are also what cost draw
calls, and draw calls are the frozen ceiling, so the count is the honest second
unit: `TERRA_PACE.residency.maxResidentTiles`.

The LRU is now ordered by **last visible frame** (PATCH 26 stamps
`_r24LastVisible` on every walk that sees a tile in frustum), distance breaking
ties. A tile just behind you after a 180° turn is CLOSE but stale, and is the
right thing to shed before something far away you are flying toward — distance
alone gets that backwards.

### The headline had to survive its own brake

The round's headline is *zero refetches on yaw*. A cap below a full 360°
working set would evict on every turn and kill it. So the cap is **measured
against the working set, not guessed**:

| cap | resident | merges | refetches | on-screen swaps |
|---|---|---|---|---|
| none | 190 | 0 | 0 | 0 |
| **260 (shipped)** | 190 | **0** | **0** | **0** |
| 120 | 144 | 80 | 80 | 4 |
| 60 | 137 | 72 | 72 | 6 |

Gate 26 asserts the shipped cap **exceeds the measured working set**, reading
the constant out of `fly-constants.js` — so editing the cap without re-measuring
fails the gate rather than silently reintroducing the churn.

### What a cap is NOT, stated rather than papered over

Driving the cap to 120 sheds real tiles (80 elections, 190 → 144) but does not
reach 120, and at 60 it settles at 137. That is by design: the election is
**out-of-frustum only**, because collapsing a tile the camera is looking at is
pure thrash — the next walk refines it straight back. So the cap is a **brake on
a set still being refined, converging toward the in-frustum floor**, not a hard
ceiling. Gate 28 asserts exactly that shape. A gate asserting `resident <= cap`
would be asserting something this design deliberately does not promise, and
would have been a lie that passed.

The 4 and 6 on-screen replacements at those tight caps are the upstream defect
resurfacing under pressure — recorded because it is the honest cost of an
aggressive cap, and the reason the shipped one has headroom.

### Gates

`verify-terra-residency` 22 → **32**. RED-calibrated by neutering `r24Park`:
**20, 23 and 24 fail** (off-frustum issued 142 → 142; the growth contrast can no
longer be demonstrated). The census counts what three would DRAW — a model
attached AND visible through every ancestor — not merely what is attached,
because visibility is the entire mechanism.

### What this does NOT claim

The residual in-frustum count is still higher than flag-off (20 → 48 on the
fixture yaw), because the trio lets the tree reach z17 where upstream's
collapse-on-yaw pinned it at z13. **That is more detail, not leakage**, and it
is the part of the draw delta that parking cannot remove. Whether Owens now
lands under 261 live is E's re-take to measure, not mine to assert: this
container has no renderer, and every number above is a count or a decision.

### Lessons

1. **Resident and issued are different questions**, and a design that conflates
   them will pay for retention in draw calls forever. The fix was not to retain
   less; it was to stop drawing what was retained.
2. **A budget nothing ever reaches is not a budget.** 140 MB looked like a cap
   for a whole round and had never once fired.
3. **Pick the unit the ceiling is denominated in.** The frozen number is draw
   calls; the brake was in megabytes.
4. **An LRU ordered by distance is not an LRU.** Recency and proximity disagree
   exactly where turning is involved, which is the case this round exists for.
5. **The duration was the variable.** Two runs of the same pose with the same
   flags, differing only in how long the camera turned, named the mechanism
   before any renderer was involved.

---

## §19 The 14 "refetched" DEM URLs: shared ancestors, not re-downloads

E's standalone lod-fade row on `9bcaace` (pre-parkOffscreen, trio ON, no pace
pin on either leg) is the strongest form of the residency result so far: over a
full **360° arc at 0.85°/frame with the position frozen, 0 tile
re-appearances**, `refetchParent 0`, `merge 0`. On the same run gate (6) read
**14 of 552 distinct tile URLs refetched, worst 4× `/dem/15/8822/12386.png`** —
and **every one of them DEM; no imagery URL was ever refetched.**

### The asymmetry is the answer

Imagery's ceiling is `satMaxZoomFor(tier)` = **17** at high tier. The DEM's is
`TILES.demMaxZoom` = **15** (the Terrarium data ceiling). So imagery never
exceeds its own source ceiling and every imagery tile gets its own URL. A tile
deeper than a source's `maxLevel` does not, and that is upstream's own rule —
vendored `index.js`, `de()`:

    if (r <= i.maxLevel) return { url: i.getUrl(e, t, r), clipBounds: [0,0,1,1] };
    const n = He(e, t, r, i.maxLevel), s = n.coord;
    return { url: i.getUrl(s.x, s.y, s.z), clipBounds: n.bounds };

Past the ceiling, three-tile requests the **ancestor's** URL at `maxLevel` and
clips it. `He(x, y, 16, 15)` has `s = 2**(16-15) = 2`, so all four z16 children
of z15 `8822/12386` — `(17644..17645, 24772..24773)` — map to
`{x: 8822, y: 12386, z: 15}`. **Four distinct tiles, one URL, four requests.
`worst 4×`, exactly.** A z17 descendant makes it up to 16.

**These are not refetches.** They are N distinct tiles legitimately sharing one
ancestor resource, and a per-URL counter cannot tell that from one tile being
downloaded twice.

### Against Fable's three candidates

| candidate | verdict |
|---|---|
| (a) R21 reason-coded TTL/backoff re-requesting a 200-empty-body DEM | **No.** No empty body is involved; the fixture served these tiles normally, and the backoff path is not on this code path at all. |
| (b) skirt rebuild or `walkWhileSaturated` re-requesting DEM | **No.** Neither issues source URLs, and both would show in imagery too — imagery never duplicated once. |
| (c) a residency gap for DEM under the byte trigger | **No.** `refetchParent 0`, `merge 0`, 0 re-appearances on that same run, and the byte trigger never fired (§18: 113.7 MB under a 140 MB budget). |
| (d) upstream source-level clamping | **Yes**, and it is correct behaviour. |

### Reproduced on my own harness

My node gate could not see this, and the reason is worth naming: its request
counter is keyed **per TILE** (`z/x/y`), so ancestor sharing is invisible to it
and it reads a truthful `0 refetches` for a question it was not asking. Adding a
per-DEM-URL counter reproduces E's shape immediately:

    distinct DEM URLs      224
    URLs requested >1x       4  (worst 9x)
    TILE-level refetches     0

Two counters, two different questions, both right.

### The gates, so this is distinguishable BY NAME

**29** the DEM ceiling really is below the imagery ceiling (read from
`TILES.demMaxZoom`, so raising it re-derives the prediction rather than
invalidating the row); **30** residency holds at the TILE level — 0 tile
refetches, 0 `refetchParent`, 0 merges; **31** every duplicated DEM URL is a
ceiling-clamped ancestor at exactly `z = demMaxZoom`, never a re-download.

Gate 31 is the one that earns its place: a real DEM refetch would duplicate a
URL whose z is **not** the ceiling, and would be named rather than excused as
sharing. The prediction comes from the tile census and the observation from the
request log, so the two can disagree.

### Do the same 14 recur on the parked tree?

**Yes, unchanged** — reasoned from the code, for E to measure. `parkOffscreen`
sets `model.visible`; the clamp fires in `de()` at LOAD time, long before
anything is visible, so parking cannot touch it. The cap does not fire either
(260 clears the working set). The count is a function of how many tiles the
tree holds past z15 and nothing else.

### What I could not supply

Fable asked for the four fetch timestamps of that z15 tile against the sweep's
frame clock. **The log carries counts only** — the fixture's `/__stats` `byUrl`
is a count map with no timeline — so the timestamps do not exist in the
artifact. Said plainly rather than reconstructed: the mechanism is deterministic
from source and the arithmetic above is checkable without them, which is why
this is a ruling and not a hypothesis.

### Lessons

1. **A per-URL counter and a per-tile counter answer different questions**, and
   the difference is invisible until a source ceiling makes them disagree. Both
   readings in E's log were correct; only their names collided.
2. **An asymmetry in the data is the fastest attribution there is.** "All DEM,
   no imagery" pointed at the one property the two sources do not share, and
   the ceiling was the only candidate.
3. This is the pass-1-gate-6 family again: *an instrument can report a real
   number for a question nobody asked.*

---

## §10 Commits

| # | Commit | What |
|---|---|---|
| 1 | `b64457b` | M1 vendor three-tile 0.12.1 VERBATIM + `verify-vendor-three-tile` |
| 2 | `4bedab1` | M1 follow-up: restore CRLF on `next.config.mjs` + `package.json` |
| 3 | `407691b` | M2a the residency trio — `timerFix` / `mergeHysteresis` / `keepResident` + the byte LRU + the LOD counters + the A10 handle; `verify-terra-residency` |
| 4 | `5247d06` | M2b `skirtFast` — the O(E) boundary scan; `verify-skirt-fast` |
| 5 | `e990616` | M2b ledger §4 (docs) |
| 6 | `3158584` | M2c `skirtWorker` (built-OFF) + the readable worker-source rule + `build-tile-worker`; M2d `walkWhileSaturated` + `bboxCache`; E's fixture merged; `verify-skirt-worker` |
| 7 | `ab67ffe` | the splice also fires on C's `TERRAIN_LIGHT.workerNormals` |
| 8 | `36792a0` | M3 `LADDER_FIX` + `STEP_SAFE`; `verify-ladder-fix` (RED-calibrated) |
| 9 | `2fadaa6` | M5a `HUD_SYNC` (+ the two FL-06 companions) and `REBASE_CALM` (FL-09 + T12); `lib/fly/fly-pins.js` |
| 10 | `f8c6a4a` | M5b `FINALIZE_PACE`; `verify-finalize-pace` |
| 11 | `ed773b8` | M4 `FRAME_STEP` sim half + `verify-frame-step`; consumer opt-in NOT landed (§8c) |
| 12 | `70b9f42` | E's `FRAME_STATS` `markPhase` attribution in the terrain + finalize paths (PATCH 25, by inversion) |
| 13 | `f739cb3` | ledger §9/§10/§11 |
| 14 | `8b91bc5` | **BLOCKER FIX**: the missing `pinned` import in CloudField.jsx (§9b) |
| 15 | `5ddf5dc` | **W3 ship-state flip** (§12) + the ship-state gates and the three hardened control arms |
| 16 | `5a41680` | row 8 recorded — the content probe answered on the fixture |
| 17 | _(this commit)_ | §13 — pass-1 gate 6 attributed (NOT the LRU) + the per-frame yaw arc and gate 6's calibration guard |

### Gates added

| Gate | Assertions | Venue |
|---|---|---|
| `scripts/verify-vendor-three-tile.mjs` | 20 | node, anywhere |
| `scripts/verify-terra-residency.mjs` | 22 | node, anywhere |
| `scripts/verify-skirt-fast.mjs` | 13 | node, anywhere |
| `scripts/verify-skirt-worker.mjs` | 9 | node, anywhere |
| `scripts/verify-finalize-pace.mjs` | 12 | node, anywhere |
| `scripts/verify-frame-step.mjs` | 11 | node, anywhere |
| `scripts/verify-ladder-fix.js` | 13 | browser (toy boot, seconds); RED via `FLY_LADDER_RED=1` |
| `scripts/verify-terra-live.js` | 9 | browser + E's fixture; **has not completed here** (§9) |

Plus `scripts/build-tile-worker.mjs` (the worker stringifier, `--check` wired
into the vendor gate).

## §11 Merge notes for Fable

Files I touched that another agent is likely to have touched too:

| File | My hunks | Note |
|---|---|---|
| `components/fly/FlyScene.jsx` | the `rebase` callback (REBASE_CALM), a `noteFinalizeFrame(delta)` line at the top of the −50 block, the FRAME_STEP branch around `flight.step`, `camera.updateMatrixWorld()` at the end of the −50 block, the `__flyTerra` dev-handle effect, four `useMemo`s + one `useCallback` above `rebase`, and four constants imports | every hunk is annotated `// R24 A`; none touches shading, weather, sun or the atmosphere blocks |
| `components/fly/FlyCanvas.jsx` | one `useState` for `stepSafeOn`, the `<StepSafeRig>` mount inside the PERF_GOVERNOR branch, `<HudSyncRig>` in the shared `sceneTree`, two imports | **E mounts a −101 rig here** — different JSX slots, but the same two regions; my rig is inside the `PERF_GOVERNOR.enabled` branch and E's is not |
| `components/fly/FlyEffectComposer.jsx` | a keyed `registerComposer` effect right after the `__flyComposer` effect, an in-frame buffer check at the top of the `enabled` branch of its `useFrame`, one `useRef`, two module scratch `Vector2`s, two imports | **C added one-line `finishPassChain` hooks here** — C's are in the pass-assembly path, mine are in the size/render path |
| `lib/fly/perf-governor.js` | `resolveLadderFix()`, the sub-native rung loop in `buildLadder`, the `targetFps` line, the long-frame block before the EMA, the `r24Stutter` term in the down decision, three `g.*` fields, two `state()` fields, the `applyDpr` park | nobody else should be in this file |
| `lib/fly/vendor/three-tile/index.js` | patches 0–4 and 20–25 | D holds 5–7 and C 8–19; `verify-vendor-three-tile` gates the ledger both ways, and gate 7 rejects any hunk without an `R24` marker |
| `lib/fly/toy-world/*.js` | one `if (!mayFinalize(done)) break;` + one `markPhase(...)` per finalize loop; the veg commit cap; the toy typed-array index | **deliberately NOT folded into the `done < X.finalizePerFrame` bound** where E's `budgetK()` multiplier sits — gate 11 of `verify-finalize-pace` enforces that |
| `lib/fly/tile-sources.js` | the vendored imports (mine) + E's two fixture hunks re-applied on top | take mine for the imports, E's for the fixture body |
| `package.json` / `package-lock.json` | three-tile + overrides removed (mine), geojson-vt + vt-pbf added (E's) | both preserved, CRLF intact |
| NEW, uncontested | `lib/fly/step-safe.js`, `lib/fly/fly-pins.js`, `lib/fly/finalize-pace.js`, `lib/fly/frame-step.js`, `lib/fly/tile-residency.js`, `components/fly/StepSafeRig.jsx`, `components/fly/HudSyncRig.jsx`, `lib/fly/vendor/three-tile/**`, six `scripts/verify-*` | |

I touched **no** world-bend cache key, no shader text, no prewarm entry, and no
constants block but my own.

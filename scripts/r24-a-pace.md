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

## §9 Could not measure here (honest list)

Everything in this section needs the user's machine, or E's offline fixture,
or both. Nothing below has a number from this container.

| # | Claim that needs a real measurement | Venue |
|---|---|---|
| 1 | Draws/tris identity across the vendoring commit at Owens/Powell/Manhattan | E's fixture (structural) — runs here once it lands |
| 5 | Draw counts at the settled canonical poses with the residency trio ON (the ceilings argument above) | E's fixture |
| 6 | Whether `bendSphere` (T14) can be enabled without moving Owens ≤ 261 / sat ≤ 375 | E's fixture |
| 7 | Stalls/min, worst frame and the felt smoothness of the residency trio | User's machine (`__flyTerraPaceOverride` A/B) |
| 8 | Whether a WRONG tile (cache/URL mix-up) is also in play, as distinct from LOD policy | E's z/x/y-stamped fixture + the URL↔position probe |
| 2 | Any fps / ms / stalls-per-minute / worst-frame number | User's machine only |
| 3 | Governor behaviour, DPR-step timing, tearing | User's machine only |
| 4 | Live tile-URL identity against Esri | User's machine (egress) |

---

## §10 Commits

| # | Commit | What |
|---|---|---|
| 1 | `b64457b` | M1 vendor three-tile 0.12.1 verbatim |
| 2 | `4bedab1` | M1 follow-up: restore CRLF on next.config.mjs + package.json |
| 3 | _(this commit)_ | M2a residency trio: timerFix / mergeHysteresis / keepResident + byte LRU + counters + A10 handle |

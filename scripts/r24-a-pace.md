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
read today. The rule still binds every handle I add for this round's
measurements, so the fix ships as the PATTERN plus the instrument I need.

_(Filled in with the commit that adds it — see §10.)_

---

## §9 Could not measure here (honest list)

Everything in this section needs the user's machine, or E's offline fixture,
or both. Nothing below has a number from this container.

| # | Claim that needs a real measurement | Venue |
|---|---|---|
| 1 | Draws/tris identity across the vendoring commit at Owens/Powell/Manhattan | E's fixture (structural) — runs here once it lands |
| 2 | Any fps / ms / stalls-per-minute / worst-frame number | User's machine only |
| 3 | Governor behaviour, DPR-step timing, tearing | User's machine only |
| 4 | Live tile-URL identity against Esri | User's machine (egress) |

---

## §10 Commits

| # | Commit | What |
|---|---|---|
| 1 | _(filled at commit time)_ | M1 vendor three-tile 0.12.1 verbatim |

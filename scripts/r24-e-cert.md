# R24 — E CERT LEDGER ("a green means something here AND there")

Owner: **E CERT**. Worktree `/home/user/skyloom-r24-e`, branch `r24/e`,
dev server port **3105**, fixture port **3199**.
Plan: [FLY_ROUND24_PLAN.md](../FLY_ROUND24_PLAN.md) §1 + §3 E.
Evidence: [scripts/r24-recon.md](r24-recon.md) HARN-ENV-1..3, HARN-GAP-4..8,
HARN-HYG-9, HARN-OBS-10, A1, A3, A7.

This ledger is kept CURRENT as the work happens. Everything below is either a
measured number with the command that produced it, or an explicit
"could not measure here".

---

## §0 The venue, in one table

| Capability | Here (cloud container) | User's machine |
|---|---|---|
| GPU | ANGLE / SwiftShader (software), **~1 fps at the game's load** | real |
| Google Chrome | **absent** | present |
| `playwright` | global only (`/opt/node22/lib/node_modules`, 1.56.1) | repo/global |
| Esri imagery + elevation | **403 at the proxy** | reachable |
| OpenFreeMap | **403** | reachable |
| adsb.lol / open-meteo | **403** | reachable |
| npm / PyPI | reachable | reachable |
| Pixel determinism | **bit-stable** at a fixed pose (SwiftShader) | driver-dependent |

Consequences, applied without exception in everything E ships:

- A number measured here **never** re-baselines a live number (HARN-GAP-6).
  Frozen gates get a **separate FIXTURE column**.
- Every fps / ms / stutter / tearing / governor claim is marked
  **user-machine only** and is not asserted here.
- What IS assertable here: worker fingerprints and determinism, kept/placed
  counts, `gl.info` draws/tris per pose, mesh census, uniform reads,
  protocol/flag/source scans, composer-buffer === drawing-buffer,
  program-count flatness, flag-off byte identity, cache-key registry, boot
  monotonicity, fixed-pose pixel A/B.

---

## §1 M1 — the launch shim and the offline world fixture

### 1.1 `scripts/_pw-shim.js` (commit `98c4cda`)

RED first: `chromium.launch({ channel:'chrome' })` → *"Chromium distribution
'chrome' is not found at /opt/google/chrome/chrome"*, and
`require('playwright')` from the repo → *"Cannot find module 'playwright'"*.
92 harnesses do both.

The shim is a `node -r` preload — **zero diff in any verify-\*.js**. It

1. resolves `playwright` / `playwright-core` from the global install **as a
   fallback** (a repo-local or `NODE_PATH` install still wins), so no
   `NODE_PATH` is needed on the command line;
2. wraps `chromium.launch` and `launchPersistentContext` to delete `channel`
   and append `--use-angle=swiftshader --enable-unsafe-swiftshader` (the
   explicit ANGLE path measured ~2× the fill rate of the implicit one);
3. defaults `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

Escape hatches so the user's machine is unaffected: `PW_CHANNEL=chrome`
preserves the author's exact launch, `PW_EXTRA_ARGS` replaces the arg list,
`PW_SHIM_QUIET=1` silences the banner.

GREEN: a probe replicating `verify-stability.js:445-448` verbatim launches and
reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)),
SwiftShader driver)` / `WebGL 2.0`.

### 1.2 `scripts/r24-fixture/` (commits `10a7963`, `effae67`)

| Module | What it is |
|---|---|
| `noise.mjs` | the ONE deterministic source. No `Math.random`, no wall clock in any tile; everything is a pure function of GEOGRAPHIC position |
| `scenes.mjs` | scene placement BY LAT/LON (so the fleet's hard-coded poses land in the intended scene), the height field, tile↔lonlat, the empty-body tile |
| `features.mjs` | the OMT layer/field subset the worker actually reads |
| `mvt.mjs` | geojson-vt 5.0.2 (ISC) + vt-pbf 3.1.3 (MIT), extent 4096 |
| `dem.mjs` | Mapbox terrain-rgb PNG |
| `imagery.mjs` | ground truth + tile identity (stamp / hue / z-border) |
| `aircraft.mjs` | a 300-aircraft deterministic ADS-B fleet |
| `png.mjs` | ~40-line RGBA8 PNG encoder on node `zlib`, zero deps |
| `server.mjs` | 127.0.0.1, `ACAO *`, `/__stats`, `/__spec`, `/__health` |

**Scene → pose map** (poses grepped from the harnesses; the table lives in
`scenes.mjs`'s header so it cannot drift from the code):

| Scene | Kind | Poses it must serve |
|---|---|---|
| manhattan / sf / tokyo | dense city | 40.7075/−74.0113 · 40.7549/−73.984 · 37.793/−122.4161 · 35.6812/139.7671 |
| columbus | small downtown | 39.9612/−82.9988 |
| powell / blagnac | suburb + a real airport | 40.1578/−83.0752 · 40.15153/−83.08533 · 40.0992/−83.1141 · 40.1073/−83.2674 · 43.63379/1.38366 |
| **owens** | **EMPTY desert** — 0 buildings, 0 landuse | 36.6/−118.1 · 36.601/−118.06 · 36.6061/−118.0632 |
| **sierra** | relief only, no buildings | 36.578/−118.29 (verify-sat-depth's hillshade crops) |
| **melton** | residential landuse, **0 footprints** | −37.68172/144.57398 |
| smokies | hills | 35.65/−83.5 |
| rural | sparse default | everywhere else |

#### Decisions, and why

**PNG encoder: hand-rolled (node `zlib`), not `pngjs`.** ~40 lines for RGBA8 /
no interlace / filter 0. Nothing in the fixture ever DECODES a PNG, so the only
requirement is spec-correctness. One less dependency to licence-audit.

**DEM transport: terrain-rgb, not LERC.** The LERC path would have needed no
app change at all, but the vendored decoder rejects lerc versions > 5 and the
Python-encoder round trip is untested. terrain-rgb is registered by three-tile
by default, so the swap is a source OBJECT, not a code path — a 3-line
harness-only hook.

**THE TERRAIN-RGB TILE-SIZE TRAP (measured, relayed to A/C/D).** three-tile's
terrain-rgb loader resizes each image to `n = clamp((z+2)*3, 2, 64)` px
(`dist/index.js:1210`) and hands the n×n grid to Martini, whose constructor
throws unless the grid is `2^k+1`. `(z+2)*3` is `2^k+1` only at **z=1 and
z=9**. A fixed 256 px terrain-rgb tile therefore throws on nearly every zoom
and falls into three-tile's empty-geometry catch (`:884`) — a **silently FLAT
world** that looks like a fixture bug and is a library one. The fixture serves
**5 / 9 / 17 / 33 px by zoom** so `n = min(crop, imageWidth) = imageWidth`
always, and detail rises with zoom as a real DEM's does.

**Winding is REAL, not convenient.** Fixture exteriors give the worker's
`signedArea` **< 0**, exactly as R18 measured on live OpenFreeMap. So
`classifyRings` (toy, still unfixed) returns `[]` on fixture tiles just as it
does on live ones, and `classifyRingsSat` / `classifyToy` work. A fixture that
wound the other way would have silently "fixed" NEON_COVER and made
verify-neon-cover's flag A/B meaningless.

**Rings decode CLOSED.** `@mapbox/vector-tile` re-appends the closing clone on
`ClosePath` (`index.js:94`), so the A1 zero-area wall-triangle population
exists in fixture tiles **by construction** — which is what makes
`verify-flash-guard` RED-calibratable offline.

**Tile identity (Fable + A ruling).** Imagery carries a large `z / x / y` stamp
at a **fixed top-left position**, an 18% `hash(z,x,y)` hue blended under the
terrain tint, and a border hue of `(z*137) % 360`. The **DEM carries no
identity channel on purpose**, so an imagery swap cannot mask a geometry swap.
`FLY_FIXTURE_STAMP=off` drops all three for shading pixel-A/B gates (it changes
the bytes — a fixture baseline must record which mode it was measured in).
The full mapping is machine-readable at `GET /__spec`.

**A shared server is safe; a STALE one is not.** `/__health` reports
`FIXTURE_REV`. `startFixture` reuses a healthy server only when the rev
matches, and otherwise walks to the next free port — five agents share this
container and a server left running from an earlier payload revision serving
someone else's gate is the exact class of silent wrongness the fixture exists
to remove. **Bump `FIXTURE_REV` whenever a payload changes.**

#### Measured (node level)

```
node scripts/r24-out/mvt-probe.mjs         (decoded with @mapbox/vector-tile)
manhattan z14  building=206  (41 multipolygon features, max 8 rings)  transportation=8  water=1 waterway=1 landuse=1 park=2
manhattan z13  building=825  (150 multi)                              transportation=16
powell    z14  building=408  (18 multi, max 11 rings)                 transportation=8  landuse=6 landcover=1
powell    z13  building=1588 (69 multi)                               transportation=17 landuse=16
powell    z12  building=0                                             transportation=9  landuse=48
powell    z10  building=0                                             transportation=3  landuse=44 park=7
owens     z14  building=0  landuse=0        transportation=1 landcover=1(sand)   ← the Owens lock
lonepine  z14  building=0  landuse=0        transportation=1 landcover=3
melton    z14  building=0  landuse=6(residential)                                ← the parcel carpet
smokies   z14  building=0  landcover=7
rural     z14  building=24 (0 multi)
empty-body tile 14/4413/6194 → 0 bytes, HTTP 200
first building ring: closed=true, shoelace +1022 ⇒ worker signedArea −1022 (< 0, matches live OFM)
```

DEM round-trip and LOD agreement:

```
owens     z13 grid 33  min 1129.9  max 1134.4  corner decoded == elevationAt to 0.1 m
powell    z13 grid 33  min  261.8  max  287.7
smokies   z13 grid 33  min  223.6  max 1046.4
manhattan z13 grid 33  min    7.8  max   17.0
parent/child: z13 corner 843.200 m vs z14 same corner 843.200 m — delta 0.000000
sizes by zoom: z0→5, z1→9, z4→17, z9→33, z14→33, z15→33 (all 2^k+1)
local relief over ~3 km: sierra 393.8 m · owens 3.9 m · owens-floor 3.8 m ·
                         lonepine 3.7 m · powell 22.2 m · manhattan 7.6 m
```

The last row is the point of the sierra scene: verify-sat-depth's hillshade
crops are shot at 36.578/−118.29, which sits INSIDE the Owens desert; a flat
DEM there gives hillshade nothing to shade and C's "> 2/255" margin is
unmeasurable. The Owens FLOOR poses stay flat (3.7–3.9 m over 3 km).

#### Measured (browser)

```
FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
  node -r ./scripts/_pw-shim.js scripts/verify-fixture.js
```

| Fact | Value |
|---|---|
| satellite boot to `__flyBoot.pct === 100` | **48.7 s** at SwiftShader |
| requests during boot | img 57 · dem 53 · mvt 65 · tilejson 20 · aircraft 4 · weather 1 |
| page errors during boot | **0** |
| bytes deterministic on re-fetch | mvt 12,021 B · dem 1,817 B · img 46,864 B, all bit-identical |
| 200-with-empty-body tile | HTTP 200, 0 bytes, `x-fixture-empty-body: 1` |

Boot wall time is **context for scaling harness waits, not a budget**: the
existing `bootFly` default `timeoutMs` of 180 s is comfortable, but the poses
need long settles (`FLY_FIXTURE_SETTLE_MS`, default 60 s) because FlyScene
republishes `__flyStats` only every 60 frames — at ~1 fps that is once a
minute, so `verify-fixture` NULLS `drawCalls` and waits for a fresh number
instead of sleeping and hoping.

### 1.2b THE VENUE'S BINDING CONSTRAINT: per-FRAME work budgets at ~1 fps

The four-pose census exposed something every agent needs to know before
reading a fixture number:

```
manhattan  draws=110 tris=169,552 meshes=122  sb={chunks:16, ready:0,  empty:0}
powell     draws=131 tris=266,114 meshes=135  sb={chunks:16, ready:0,  empty:0}   parcelHomes 2,992
owens      draws=152 tris=161,147 meshes=159  sb={chunks:16, ready:0,  empty:16}  parcelHomes 0
melton     draws=68  tris=328,079 meshes=76   sb={chunks:16, ready:0,  empty:16}  parcelHomes 1,836
traffic 300 tracks · 12 /api/aircraft polls · 0 page errors
```

Read that carefully: **`empty` is 16 exactly where the fixture intends it**
(Owens and Melton have no footprints), **and `ready` is 0 exactly where there
IS content**. The fixture is right; the venue is the constraint.

`SatBuildingEngine._drapePending` spends at most `SAT_BUILDINGS.drapeBudgetMs`
(1.0 ms) **per FRAME**, and `_finalizePending` uploads at most
`finalizePerFrame` (1) chunk per frame. On the calibration GPU at 120 fps that
is 120 ms of drape per second and a chunk lands in well under a second. Here,
at 1–13 fps, it is 1–13 ms per second: a Powell chunk with 22,723 drape
vertices needs minutes. An empty tile has no drape at all, which is why the
Owens and Melton legs resolve instantly and the content legs do not.

Measured directly (`scripts/r24-out/drape-probe.js`, 640×360, Powell pinned):

```
t=12s  fps 50.5  pending 2   drape 1,121/22,723
t=45s  fps 17.3  pending 16  drape 21,464/22,723
t=58s  fps 13.6  pending 16  drape 1,461/22,723   <-- RESTARTED
t=159s fps  8.7  pending 16  drape 20,124/22,723
t=171s fps 12.3  pending 16  drape 1,351/20,892   <-- different chunk
```

The restart is not a fixture artefact either: `_finalizePending` retries the
whole drape (`p.vi = 0`) when `badFrac > 0.05`, i.e. when more than 5% of the
DEM samples came back missing or below `SAT_BUILDINGS.demZ` (12). So a slow
venue and a shallow DEM quadtree compound: the drape never finishes before the
retry condition is re-evaluated. **Under investigation** — the open question is
whether the fixture DEM is answering at all at the near ring (probe running).

Consequences, and they are load-bearing for every agent's fixture legs:

- **Structural satellite-building numbers need a small viewport.** 640×360
  measured 8–50 fps against ~1 fps at 1280×720, i.e. the per-frame budgets are
  spent 8–50× more often. Use it for count/census gates; keep the real viewport
  only where pixels matter.
- **Settles for content poses are MINUTES, not seconds**, and a gate that
  waits 45 s at Powell will read `ready: 0` and think the world is broken.
- **The Owens and Melton legs are cheap and trustworthy** — they are the ones
  that resolve immediately, and they are also the two that carry the round's
  most load-bearing invariants (the Owens lock, the parcel carpet).
- Powell's `parcelHomes: 2,992` in this state is a CONSEQUENCE, not a defect:
  the two-term anti-duplication reads the collision-column index, and with no
  building chunk finalised there is no index to suppress against. The number is
  meaningless until the buildings land; do not quote it.

### 1.2c THE FIX: `lib/fly/harness-budget.js` (the finalize-budget scaler)

Three probes, in sequence, established that §1.2b was not the whole story:

1. **The terrain quadtree DOES settle on the fixture.** Measured level by
   level at Powell (640×360): z5 at 15 s, z6 at 25 s, z7 at 39 s, z8 at 51 s,
   z9 at 62 s, z12 at 96 s, z14 at 109 s, z16 at 121 s, **z17 at 153 s**, with
   ground elevation converging 193.4 → 268.9 → 274.3 → 273.0 m against the
   fixture's true **276.3 m**. The descent is throttled by three-tile's
   `downloadingThreads + 4 >= maxThreads` freeze (recon T3): the probe measured
   `dl` pinned at 8–9 of 10 for the whole descent, and `dl=0/10` once settled.
2. **And yet after SIX MINUTES** `__satBuildings.stats` still read
   `{chunks: 16, ready: 0, empty: 0}` with the terrain fully settled and
   nothing downloading.
3. **The arithmetic.** Each chunk's drape is ~400 `getElevationAt` calls, each
   a full-quadtree raycast over 229 tiles (recon T9 / FL-08), against
   `SAT_BUILDINGS.drapeBudgetMs` of 1.0 ms **per frame**. 120 fps → 120 ms of
   drape per second and a chunk lands in under a second. 1–3 fps → 1–3 ms per
   second, and it never lands.

Left alone this would have made every satellite content gate here — including
B's own `FLASH_GUARD` and `CHUNK_FADE` gates — certify a world whose buildings
never arrived, reading 0 for counts that should be thousands. **That is a
green that means nothing**, and it would have looked like a green.

`budgetK()` is read live at five sites (sat-building drape + finalize,
sat-skyline drape + finalize, toy-world drape + finalize, sat-road drape).
`window.__flyFinalizeBudgetK` absent ⇒ returns exactly 1 ⇒ byte-identical
arithmetic. Clamped to [1, 500] — a harness may only ever make the budget MORE
generous, never tighter, so it cannot manufacture a green by starving
something for frames. Wired through the SAME env-guarded `_boot.js` branch:
`FLY_FINALIZE_BUDGET_K=40` alongside `FLY_TILE_FIXTURE=1`.

**THE RULE.** It changes PACING. No gate that measures pacing, frame time,
stalls or stream-in SHAPE may set it — and none of E's pacing gates do. It is
for gates that ask what the world CONTAINS once settled: counts, census,
draw/triangle totals, fingerprints, fixed-pose pixels. Those answers do not
depend on how many frames the drape took to finish, which is precisely why
scaling is sound for them and unsound for anything else.

### 1.2d What the fixture looks like WITH the scaler and the settle predicate

First run with `FLY_FINALIZE_BUDGET_K=40`, `FLY_BOOT_SCALE=8`, the `_settle.js`
condition and a 427 s cap, at load ~15 with four other agents' browsers live:

```
manhattan  draws=148  tris=323,022  meshes=164
           satBuilding meshes 5 · satSkyline 10 · sb {chunks 16, ready 3, empty 0}
           settled=FALSE at the cap — "terrain only reached z11 of 14;
                                       9 chunk(s) still draping"
           maxZ 11 · 101 tiles · ground 15.6 m
```

Compare the same pose before the scaler: `satBuilding 0`, `sb {16, ready 0,
empty 0}` after six minutes. Buildings now stream.

And note what the gate SAYS: `settled=false` with the reason. That is the
`_settle.js` contract working — the alternative is a census of a half-built
world presented as a column. 148 draws is far under the 375 satellite ceiling,
but it is a FLOOR (three of sixteen chunks resident), not the settled figure,
and the ledger records it as such.

**Contention is the long pole.** At load 15–17 on four cores the terrain
descent costs roughly ten times its uncontended wall time, and the descent is
what every content column waits on. Owens and Melton settle quickly because
empty tiles need no drape at all — which is also why they are the two most
trustworthy fixture columns this venue produces.

### 1.3 Environment findings that cost time (so nobody else pays them)

- **Never edit a source file while a browser gate runs.** Next's HMR remounts
  FlyScene, `runtime.warpToGeo` is nulled on effect cleanup
  (`FlyScene.jsx:745`), and the next `page.evaluate` dies with *"warpToGeo is
  not a function"*. Reproduced here. `verify-fixture` now waits for the handle
  before every pose, but the discipline is the fix. (The R13 lesson, re-learned.)
- **`pkill -f "<pattern>"` can kill your own shell** when the pattern appears
  in the shell's own command line — including the heredoc you are writing. Use
  `lsof -i:PORT` and kill the PID.
- **A name scan over the scene finds no chunks.** `sat-building-engine.js:304`
  names the GROUP `sat-buildings`; its per-chunk children are unnamed. Census
  through the engine handles (`window.__satBuildings.object`,
  `__satSkyline.object`, `__satVeg`, `__toyWorld`) instead.
- `window.__flyGl` (FlyCanvas `onCreated`, dev only) is the renderer handle —
  `gl.info.programs.length` is the only honest instrument for a recompile
  storm or an abandoned composer pass.
- **Server reuse between agents is a flakiness source, not a courtesy.** A
  harness reused a fixture server owned by another node process; that process
  exited and every later proxy fetch answered 502, which surfaced as
  `[sat-buildings] TileJSON init failed: TileJSON 502` and an empty world — a
  fixture failure that reads exactly like a code failure. Reuse is now opt-in.
- **Five agents share four cores.** While one probe ran, D's
  `r24-d-lodprobe.js` and another agent's `diag.js` held fixture ports; the
  measured frame rate fell from 18.5 fps to 2.6 fps as the scene filled AND as
  other work landed. Contention is part of every wall-clock number here; treat
  a 2–3× spread between runs as normal and never read a timing from it.
- **A smoke that cannot find its own scripts must be LOUD.** `r24-smoke.sh`'s
  first version tested the presence of `$1` after a `shift`, i.e. of a file
  called `node`, skipped all nine rows and exited 0. It now exits non-zero on
  `PASS === 0` and on any absent row.

---

## §2 M2 — FRAME_STATS and the user-diagnosis pack

### 2.1 `lib/fly/frame-stats.js` + `FRAME_STATS` (owner block)

RED: nothing in this tree measures frame pace (HARN-GAP-4). The app publishes
scene totals every 60 frames and an EMA of fps; every temporal instrument is
harness-private (`soak-fly.js:118` installs its own rAF collector,
`verify-stability.js:188` patches the WebGL draw prototypes). So the user's
stutter has never had a number attached to it.

`window.__flyStats.frame` publishes: `count`, `lastDt`, `worstDt`,
`worstDtRecent`, `p50/p95/p99` over the ring, `long33`/`long100` (session) and
`long33PerMin`/`long100PerMin` (rolling 60 s), `stalls` / `stallsPerMin` /
`stallThresholdMs` (the R22.1 definition: `dt ≥ max(2×median, 28 ms)`),
`longtasks` + `longtaskMs` from `PerformanceObserver('longtask')`, `programs` /
`programsDelta` / `programsGrewAt` from `gl.info.programs.length` (so B and D
can prove "no new lazy compiles"), `geometries` / `textures` from
`gl.info.memory`, and `lastStall {dtMs, atMs, phase, phases[]}`.

Plus three methods: `sample()` (recompute percentiles, return a plain
structured-clone-safe object), `ring()`, `reset()`.

**Attribution hook.** `import { markPhase } from '@/lib/fly/frame-stats'` and
call `markPhase('finalize:sat-building')` anywhere. It is one string write into
a reused 16-slot buffer (no allocation) and a no-op when the flag is off, so
call sites can be unconditional. When a frame stalls, the tags seen during it
land in `lastStall.phases` — "the world froze for 40 ms" becomes "…during a
skirt build". **A / B / C / D: tag your finalize and LOD paths.**

**Cost.** Per frame: one subtraction, one ring store, ~6 comparisons, two
counter increments. Percentiles are recomputed every
`FRAME_STATS.publishEveryFrames` (30) frames, never per frame.

**Flag-off is byte-identical.** `FrameStatsRig` is not mounted (one guarded
JSX line in `FlyCanvas.jsx`), no ring is allocated, no observer is registered,
`window.__flyStats.frame` never exists.

**Priority −101** — ahead of the governor (−100) and A's STEP_SAFE rig (−99),
so `dt` is the raw inter-frame delta of the frame that just presented.

Readers wired: `soak-fly.js` adds a `frame` key to every 10 s sample and a
`| FRAME p99 … stalls/min … prog+…` tail to its per-minute line;
`verify-stability.js` adds an INFORMATIONAL `FRAME_STATS (dwell, …)` line to
phase 1. **Both keep their private collectors** — those are what every
R20/R21 number was measured with, and the R21 quartet must stay green flag-off.
With the flag off both new fields are `null` and both files' assertions are
untouched.

### 2.2 `scripts/r24-user-diag.md`

Four questions (including *which build(s) showed it*), a self-contained console
collector that works on **any** build (no code dependency), the 3-minute
Powell → Columbus serpentine at 200–400 m, the paste-backs, a 30-second
"buildings vanish / tiles swap" recording recipe whose per-second rows carry
`dReady` / `dSky` / `adds` / `removes` deltas so a timestamp in the clip can be
lined up against the mechanism, and an optional Part C for running the fleet
locally (`PW_CHANNEL=chrome` documented as the user-machine restore).

---

### 2.3 Two inherited gates, improved without moving a bound

**`verify-seam`'s node leg now runs OFFLINE** (HARN-GAP-7). It imports the real
worker in-process and calls `api.init()`, which fetched `TILEJSON_URL` — a
module constant with no injection seam. But the worker calls the GLOBAL fetch,
and in node that is ours: `installNodeFetchFixture()` answers the OFM TileJSON
and any `.pbf` from the fixture and passes everything else through. No app
change. Full green on the flag-off tree in ~40 s with no browser and no GPU;
the numbers are in `r24-close-sweep.md` §1.4b, including two honest places
where the fixture is WEAKER than live.

**`verify-flicker` gains a QUIESCENCE PRECONDITION** (recon A7). The bound of
12 does not move — the plan freezes it and this does not touch it. What moves
is the guarantee that the asserted window opens on a quiet scene. R22.1 §3.2
ran the harness five times on ONE tree: urban p99 6.957 / 6.613 / 9.742 /
6.167 / **16.105**, and the only red carried `movingFrac` 0.1176 against ~0.02
for the others. A gate whose verdict is decided by load is a coin, and its red
is unattributable — which is exactly why R21 closed with the Manhattan
residual un-attributed. A 3-frame probe now gates the window on
`movingFrac ≤ FLICK_QUIET` (0.05), retrying; if the scene never quiets the leg
reports **NOT QUIET** and its p99 is printed as SOFT rather than asserted. The
honest answer is "this run could not judge".

---

## §3 M3 — fixture baseline columns and the new gates

Priority order (Fable ruling, after the user reported *buildings appearing and
disappearing* and *terrain tiles swapping*):

1. `verify-flash-guard`
2. `verify-step-clean`
3. **`verify-fade`** — single-frame ready↔visible building/skyline transitions
4. **`verify-lod-fade`** — single-frame parent↔children tile swaps
5. `verify-one-sun`, `verify-linear-haze`, `verify-depth-roundtrip`
6. `verify-frame-pace` (+ its "tear mechanism" leg)

**`verify-one-sun` contract (from C, ONE_SUN at `967524a`)** — NOT "all four
vectors identical"; two clamps are deliberate:

1. azimuth of key, hill and dome equal to 1e-6 at EVERY tier, except where
   `moonK > 0`;
2. key elevation == true solar elevation, floored at `SAT_SHADOWS.minElRad`
   ONLY while the shadow camera casts (high tier);
3. hill elevation == `clamp(true, [HILLSHADE.minElRad, maxElRad])`;
4. at `moonK === 1` the key is `moonDirFromSun(az)` exactly;
5. water reads the same directional as key (there is no second light).

Instrument: `__flyStats.sun = { live, az, elDeg, moonK, oneSun, style, tier,
key, hill, hillStrength, dome, water }`, with `key` read off the light object
itself. `dome` is null whenever the lobe envelope is 0 (night, toy, flag off) —
SKIP it then, do not fail. Pins released: `__flySunOverride` and the tier
(medium AND high; **medium is where the RED lives**). Flag-off RED: the key
never moves (azimuth −56° every hour on medium/low; key↔hill 119.4° at dusk).

**`verify-shadow-calm` contract (from C, SHADOW_CALM at `fd7d28d`).**
Instrument `__flyStats.shadow = { enabled, installed, biasSign, kernel,
casting, mapSize, radiusM, texelM, normalBias, bias, lightPos, target }`, with
`biasSign` / `kernel` reported by the module that DID the ShaderChunk patch —
never by the flag. Recipe: (1) flag-on → `biasSign` true + `kernel` 'world';
flag-off → false / null (the RED); (2) parked at Manhattan settled, step the
aircraft by HALF a shadow texel (`texelM`) → `target` must NOT move; by 1.5
texels → `target` must move by exactly one texel; (3) the catcher contributes
**0 draws at Owens** flag-ON (`queryColumns` answers empty where nothing
streamed) and exactly **+1** at Columbus / Manhattan; (4) per-pixel temporal
std on a building's shadowed side, before/after, through verify-flicker's five
controls. PIN RELEASED: `__flySatShadowOverride` (accessor-swallow) — and the
shadow pass must be PROVEN reachable at tier high in satellite before anything
is asserted. Background for the RED: three r185's PCF branch adds `shadowBias`
without the reversed-depth `#ifdef` (VSM/BASIC have it), so every receiver was
biased toward shadowed by ~1.6 m and `normalBias 4` hid it; the Vogel kernel is
rotated by a screen-space hash, which is the sparkle.

**`verify-depth-roundtrip` contract (from C).** Toy HIGH, Neon NYC, camera
parked; three pixels whose true view distance is known from a raycast (~50 m,
~700 m, ~4 km). RED (flag off): reconstructed |viewZ| is **2.50–2.51 m at all
three** — every fragment collapses to −cameraNear. GREEN: |reconstructed −
true| / true ≤ 1 % at all three, CoC < 0.02 at the focus plane and > 0.5 at
4 km. Releases no fleet pin (toy high is the fleet default) but needs the DoF
pass present, i.e. tier high.

**`POST_ORDER` highlight separation (from C), as a fixture pixel gate.** On the
R21 chain `HueSaturationEffect`'s `min(color, 1.0)` clips every fragment above
1.0 linear to white BEFORE the tone map, so a 3.2-linear lit window and a
12.0-linear runway light both land at 8-bit **228**. RED = the two crops are
EQUAL; GREEN = they separate (254 vs 255) while midtones are unmoved (0.030 →
26 and 0.180 → 127 both ways, crop delta ≤ 1/255). Pose: the Neon night
window-grid vs runway-light pixels — the fixture puts a real runway in every
city and suburb scene for exactly this.
**Note for the fixture draw columns:** C measures the merged EffectPass count
FALLING under POST_ORDER (sat 4→3 / 4→3 / 3→2, toy 6→5 / 4→3 / 3→2). Flag-on
draw columns will therefore read LOWER than flag-off ones. That is a decrease,
not drift; both columns get recorded, and the exact-delta gates ("cirrus is
exactly +1 draw") are unaffected.

**Node gates to add to the smoke set (no browser, no GPU):**
`scripts/verify-terra-residency.mjs` (A — 22 merges / 17 replaced / 178
refetches → 0/0/0) and `scripts/verify-depth-offset.mjs` (C — RED 6/7 on
`6116fc5`, GREEN 7/7), alongside the three that always ran here
(`verify-classify.mjs`, `verify-warbirds.mjs`, `verify-daily.mjs`).

*(status: in progress — the tables below fill in as each gate is calibrated)*

### 3.1 Fixture baseline columns

| Gate | FIXTURE column | Live column | Notes |
|---|---|---|---|
| *(pending)* | | | |

### 3.2 New gates, RED first

| Gate | RED on flag-off tree | Pin released | Status |
|---|---|---|---|
| verify-flash-guard | zero-area census over resident DRAPED index buffers + a default-framebuffer pale detector | `__flyFlashPin` (B) | written; needs a settled content pose (§1.2b/c) |
| verify-step-clean | canvas / gl / composer resize watch + per-frame buffer identity | `__flyGovPin` (accessor-swallow) | written; **the vacuous case now reads NOT CALIBRATED, not FAIL** |
| verify-fade | hard-birth / hard-death census + the READY invariant + the Owens lock | — | written |
| verify-lod-fade | displayed-tile z/x/y census over a 720° yaw at a FROZEN position + A's `__flyTerra.lod()` + `/__stats` refetches | — | written |
| verify-frame-pace | pacing legs INFORMATIONAL here (and they say so), tear-mechanism legs HARD everywhere | — | written; **RED-as-designed confirmed on the integrated flag-off tree** ("instrument absent — FRAME_STATS.enabled false; unmeasurable, not a renderer failure") |
| verify-env-uniform | `programsDelta` flat across a dusk crossing and four forced tier steps WITH SHADOWS ON | `__flyGovPin` + `__flySatShadowOverride` + `__flySunOverride`, all three | written (the proof B asked for and has not run) |
| verify-shadow-calm | spec received from C | `__flySatShadowOverride` | pending |
| verify-one-sun | key never moves; key↔hill 119.4° at dusk (C, measured) | `__flySunOverride` + tier | pending |
| verify-linear-haze | | — | pending |
| verify-depth-roundtrip | RED by construction (recon L2 / FL-07) | — | pending |
| verify-frame-pace | **user machine only** | — | pending |

---

## §4 Could not measure here (kept honest, per item)

| Claim | Why not | Where it must be measured |
|---|---|---|
| any fps / frame-ms / p99 / stalls-per-minute | SwiftShader, ~1 fps under load | user's machine |
| governor behaviour (steps, dwell, latch) | the ladder collapses instantly at 1 fps; the fleet pins it to `hold` | user's machine or a GPU runner |
| tearing (a real tear line) | a compositor/vsync property; no JS timer or screenshot can see it. Only the MECHANISM is assertable here | user's machine (a phone camera beats a software recorder for this) |
| boot wall time as a BUDGET | 48.7 s here is a SwiftShader number, not a regression signal | user's machine |
| live tileset drift, live traffic | hosts 403-blocked | user's machine |
| GPU-driver artifacts (precision, aniso, half-float) | one software rasteriser only | user's machine |
| the one-frame PALE FRAME itself | probabilistic: the live rate was 1 per 1,600 to 1 per 20,389 composed frames, and this venue renders 1–3 per second. The DEGENERATE CENSUS is deterministic and is what decides `verify-flash-guard`; the pale detector is informational here | user's machine, ≥ 3 min of banked serpentine |
| a settled MANHATTAN building column | 16 dense chunks × ~400 full-quadtree raycasts each; not finished in 300 s at K=40 even on quiet cores. K=200 / 900 s is the recommendation, and it is a venue cost, not a defect | here, with a longer cap — or the user's machine in seconds |
| the LOOK of anything | SwiftShader is bit-stable, so a fixture pixel A/B is sound — but it is a picture of the FIXTURE's planet, not of Esri's | user's machine |
| whether a fixture bound transfers | the fixture's scenes are less dense than the real planet's, so a fixture draw/tri number bounds nothing live. It is a regression baseline FOR THIS VENUE | user's machine |

---

### 3.3 One gate bug worth remembering

`force(dir)` on the perf governor TAKES A NUMBER: `perf-governor.js:158` reads
`dir < 0 ? 1 : -1`, so −1 steps DOWN the ladder and +1 steps UP. Passing the
strings `'down'` / `'up'` makes `dir < 0` false every time; at index 0 the next
index clamps back to 0, `next === g.idx`, and `force()` returns **false**.
Every "forced" step is a silent no-op, and the gate then reports a vacuous
"0 of 0 outside rAF" that looks like a verdict. Measured on the integrated
tree as *"0 DPR applications, dprs seen []"*.

Two lessons, both now in the gates:

1. **A gate that forces something must check that the force was ACCEPTED.**
   Both verify-step-clean and verify-env-uniform now count and print how many
   forced steps the ladder took.
2. **A vacuous result must read as itself.** "0 of 0" is neither a red nor a
   green — it is "the gate could not run". Calling it FAIL is as misleading as
   calling it PASS, so it now prints one distinct `NOT CALIBRATED` line with
   the counters, and exits non-zero.

---

## §5 Open risks

1. **SwiftShader determinism is bit-stable at a fixed pose, but the SCENE is
   not automatically settled.** Any fixture pixel column must state its settle,
   its pose and its stamp mode, or it is a coin (the R22.1 F14 lesson: a probe
   green on a quiet boot is not a probe green under load).
2. **Boot is ~50 s and each pose needs a ~60 s settle plus up to a 60 s wait
   for the next `__flyStats` publish.** A four-pose gate is ~10 minutes. The
   smoke subset must be chosen for that, not for coverage alone.
3. **The fixture is a MODEL of OpenFreeMap, not OpenFreeMap.** It reproduces
   the layer/field subset, the winding, the ring closure, the multipolygon
   shape, the synthesised `render_height 5`, and the 200-with-empty-body
   answer — all of them because a specific defect depended on one of them. It
   does not reproduce anything nobody has yet found a defect in. A gate that
   goes green here and red live is evidence about the fixture, and belongs in
   this ledger.
4. **`FIXTURE_REV` discipline.** A stale server on 3199 serving a previous
   payload revision to another agent's gate is the one way this fixture can
   lie. The rev check makes that loud; it only works if the rev is bumped.
5. **Two process-hygiene incidents, both mine, both the same root.** A
   `pkill -f "<pattern>"` killed my own shell (the pattern appeared in the
   shell's own command line); later a `ps | grep | kill` loop on
   `verify-fixture` killed **Fable's certification run**, because their row's
   command line contains the same script name. In a container five agents
   share, a process-NAME pattern is not an identity. The rule that came out of
   it, now standing for every agent: kill only PIDs you spawned yourself, never
   by pattern, never `fuser -k` on a port that is not yours.
6. **The tile cache.** `TILE_PIPELINE.cache` is a persistent Cache API store.
   Fresh Playwright contexts get fresh storage, so gates are unaffected — but a
   long-lived context that changes `FIXTURE_REV` mid-run would serve stale
   bodies from the browser's own cache.

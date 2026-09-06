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

*(status: in progress — the tables below fill in as each gate is calibrated)*

### 3.1 Fixture baseline columns

| Gate | FIXTURE column | Live column | Notes |
|---|---|---|---|
| *(pending)* | | | |

### 3.2 New gates, RED first

| Gate | RED on flag-off tree | Pin released | Status |
|---|---|---|---|
| verify-flash-guard | | `__flyFlashPin` (B) | pending |
| verify-step-clean | | `__flyGovPin` | pending |
| verify-fade | | — | pending |
| verify-lod-fade | | — | pending |
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
5. **The tile cache.** `TILE_PIPELINE.cache` is a persistent Cache API store.
   Fresh Playwright contexts get fresh storage, so gates are unaffected — but a
   long-lived context that changes `FIXTURE_REV` mid-run would serve stale
   bodies from the browser's own cache.

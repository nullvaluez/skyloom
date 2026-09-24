# R25 E CERT — ledger (E1: infrastructure, helpers, W0 baselines, legacy harness edits)

Branch `r25/e` from `r25-w0`. Worktree `/home/user/skyloom-r25-e`, dev `:3035`,
fixture `:3205`. **Venue: this container** — SwiftShader WebGL at 1–3 fps, four
cores shared by five roles, Esri / OpenFreeMap / adsb / open-meteo /
terrascope 403-blocked. **Every number below is a FIXTURE number.** No fps, ms,
stall or tearing figure here says anything about the user's machine; wall
times are recorded with the load average beside them for exactly that reason.

## §1 The satellite offline-fixture boot on r25-w0 (E1 step 1)

### RED first — a pinned satellite `bootFly` never reveals

Probe: `scripts/r25-e-sat-probe.cjs` (every non-local host logged with its fate,
the in-page readiness mirror polled every 10 s).

| run | tree / harness | result |
|---|---|---|
| probe 1 | r25-w0 `_boot.js` as shipped (TERRA pin set, no WorldCover route, no finalize scaler) | **stuck at `__flyBoot` pct 93 / phase `world`** for 168 s+ (killed). `runtime.terraStats = null`; missing `[terrain, buildings, roads]`. The agent proxy logged `wmts.terrascope.be:443 connect_rejected ×3`. |
| probe 2 | + `unpinPins(['__flyTerraPin'])`, WorldCover routed | `terraStats` published; terrain descending `camTileZ 3 → 14` by 334 s; 48 WorldCover tiles served; **buildings: all 16 chunks still `draping` at 334 s** (killed). |
| probe 3 | `_boot.js` after this ledger's edits (satellite un-pin + fixture finalize scaler 40 by default) | readiness `missing = []` at 446 s; **revealed at 459.6 s**, `__flyWorldStatus = {ready:true, degraded:false, missing:[]}`, **0 page errors**. |
| toy | `_boot.js` after the edits (the `enterFlight` refactor) | **revealed at 51.5 s**, 0 page errors; hosts: `server.arcgisonline.com` 34×200 and `tiles.openfreemap.org` 7×200, both routed. |

### Mechanism (two independent blockers, plus one silent divergence)

1. **The R22 fleet pin deadlocks the Living Earth reveal.** Since `7b83514`
   (2026-09-16) the satellite reveal is the content contract
   `lib/fly/world-readiness.js`. Its `terrain` part is
   `runtime.terraStats?.sharp === true && …`. `terraStats` is written only by
   `TerrainEngine._tick`, which returns immediately unless
   `terraSharpOn() || terraPipeOn()` — and `__flyTerraPin = 1` (every
   `bootFly`, since R22) forces both false. So under the pin `terrain` is
   false forever. **Every pinned satellite browser harness has been unable to
   reveal since 7b83514** — on the user's machine too, not only here (the pin
   is harness-side; the product publishes `terraStats` normally).
2. **Buildings never land at 1–3 fps without the R24 finalize scaler.** The
   reveal waits for the 1 km building + road rings
   (`localRingReadiness`); the drape/finalize budget is per-frame, and at this
   frame rate the chunks stay `draping` indefinitely (R24 §1.2c measured the
   same thing; the scaler already existed, opt-in per run).
3. **WorldCover was unrouted.** `loadWorldCover` fails soft (returns `null`),
   so it did not block readiness — but every surface and canopy tile silently
   took the no-cover branch, i.e. the fixture certified a different world from
   the user's (`combineWorldCover` re-classifies surfaces and carves scenery
   exclusions).

### Fix (all harness-side, E-owned files)

- `scripts/r24-fixture/worldcover.mjs` (NEW) + `/worldcover/{z}/{x}/{y}.png`
  on the fixture server + a `wmts.terrascope.be` route in `_fixture.js` (and
  its node leg). Legend-exact: every pixel is one of the 11 published ESA
  WorldCover 2021 colours, 256² `image/png`, alpha 255, a pure function of
  geography keyed off the same scene table and river line the imagery uses.
  Self-check `node scripts/r24-fixture/worldcover.mjs`: all 10 scenes decode
  through **the app's own** `decodeWorldCover` with **0 unknown pixels**, URL
  round trip exact, Owens has no tree class. `FIXTURE_REV` → `r25-e.1-worldcover`.
- `_boot.js`: a **satellite** boot leaves `__flyTerraPin` unset (both legs;
  `terraPinFor(style)`); toy keeps the pin exactly. `FLY_TERRA_PIN_SAT=1`
  restores the pin (reproduces the RED).
- `_boot.js`: a **satellite fixture** boot defaults `FLY_FINALIZE_BUDGET_K` to
  40 when the run did not set it (the reveal needs it; toy unchanged;
  `FLY_FINALIZE_BUDGET_K=1` opts out). Still inside the env-guarded fixture
  branch — a non-fixture run is untouched.

### Cost / what moved

- The satellite fleet now measures the **shipped** terrain (TERRA_SHARP /
  PIPE / CACHE / TILE_HOLD as they ship ON) instead of the R21 terrain. No
  frozen satellite number can move by this: on r25-w0 no pinned satellite
  gate could boot at all. This is also what the R24 D scaffold note said the
  pin had been hiding (fly-constants "MOTION HOLD" header).
- A satellite fixture boot costs **~7.7 min** here (459.6 s at load ~4.7).

### §1a Pose readiness (Owens / Manhattan / Powell) — session 2

Session 1 left this placeholder unfilled. Session 2 measured it with the
recorder (`scripts/r25-e-baseline.cjs`), at loads of **6–9** (five roles'
dev servers and browser gates on four cores). Readiness here is the STRICT
mirror (`readinessInPage` = every part, the app's `detailReady`), not the
app's reveal (`ready`, which defers buildings/roads/forest/airports after
12 s):

| pose | from | full readiness | notes |
|---|---|---|---|
| P1 Owens noon | booted there (bootFly `geo`) | **564 s** | draws 138, roads 2/2, buildings 4/4 |
| P6 Owens 7000 m | P1 | 17 s | rings not required above 2.8 / 5 km AGL |
| P1 Owens dusk | P6 | 232 s | |
| P2 Sierra | P1 dusk | 497 s | |
| P3 Manhattan noon | P2 (cross-country) | **not in 600 s** — terrain `sharp:false`, camTileZ 13 of 18 | buildings 4/4, roads 1/1 |
| P3 Manhattan dusk | P3 noon | 23 s | the same terrain finished refining |
| P4 Powell | P3 dusk | **not in 600 s** — terrain camTileZ 14 of 18, forest | buildings 4/4, roads 1/1 |
| P5 Smokies | P4 | **not in 600 s** — terrain camTileZ 15 of 16, forest | |

Run 1 (killed, `baseline-w0-run1.log`), booted at NYC: satellite reveal
**546 s** (load 4.5); then P1 Owens sat **900 s missing only ['roads']** and
P2 Sierra **900 s missing ['terrain']** (load 8.3). A roads probe booted at NYC
did not reveal in **900 s** at load ~8. So readiness is reachable at all
three plan poses — Owens settles, Manhattan settles (dusk leg), Powell's
buildings and roads settle while its terrain was still descending at 600 s —
but the time is the venue's: at load 8 a satellite boot costs **16 min**
(967 s at Owens), a cross-country pose 10+ min. Hence `bootFly({geo})`, the
locality order and the capture-on-budget rows (§3a).

## §2 Shared helpers (E1 step 2)

| file | what | self-check |
|---|---|---|
| `scripts/_title.js` | `enterHangar(page, 'ops'\|'free')` — clicks `title-takeoff-landing` / `title-free-flight` when `[data-testid="title-screen"]` exists, else sets `flightMode` on the store (W0 field); waits for `hangar`. `waitTitleReady(page, {world})` → `{title, ready, screen, ms}`, never throws on a missing title. | used by the ops harnesses + smoke |
| `scripts/_skip-menus.js` | `enterFlight(page, geo)` — `bootFly`'s airborne skip, verbatim; `_boot.js` now calls it (one copy). | toy boot 51.5 s through it |
| `scripts/_r25-poses.js` | P1–P6 + in-page `readinessInPage()` (a mirror of `worldReadiness`) + `warpToPose(page, P, {sun, pin})` + `sunTimeMs(P, 'noon'\|'dusk')`. | `node scripts/_r25-poses.js`: 6/6 poses in their fixture scene; mirror == app's 9 parts |
| `scripts/_r25-luma.js` | crop → sRGB decode → mean LINEAR luminance, clip %, Sobel energy (encoded luma), mean-colour Lab, CIE76 ΔE, horizon finder + seam ΔE, two-image diff census (mean/p99 in /255). | `node scripts/_r25-luma.js`: 12/12 closed-form checks |

**Added in E1 phase 2 (session 2, `fb93a14` / `35efaee`):**

| helper | what | why |
|---|---|---|
| `_r25-poses.js` `isolateCanvas(page, on)` | a stylesheet: `body *` hidden, the WORLD canvas (`__flyGl.domElement`, else the first `.fixed.inset-0 canvas`) visible — for the capture only | `_canvasshot.js` captures the PAGE, DOM included; at 1280×720 the controls-hint bar, the ops panel and traffic labels sit INSIDE the terrain crop (seen in `smoke/final.png`). Every luminance / ΔE / Sobel number without it is HUD-polluted. |
| `_r25-poses.js` `loadFlyConstants()` | imports `lib/fly/fly-constants.js` from node (plain ESM, no imports), muting only its MODULE_TYPELESS warning | gates read the SHIP STATE (which R25 blocks are ON) and `R25_CERT` bounds from the one source instead of literals |
| `_r25-poses.js` `window.__r25PinPose` | the held pose of `warpToPose({pin:true})`, published | a RED that writes `flight.pos` is overwritten by the 8 ms pin within a frame — session 1's visuals RED (`pos.y += 2`) could never have fired |
| `_title.js` `installBootProbe` | init script: ms since navigation of the first title node (+ boot pct then), title `data-ready`, `__flyBoot.pct === 100`, first hangar node — a 50 ms timer, independent of the render loop | "interactive before the reveal" and the product-boot timing without racing the reveal |

**Pose corrections (recorded, not silent):**
- **P2 Sierra**: the plan's 36.601/-118.06 is an OWENS FLOOR point that
  `scenes.mjs` keeps deliberately flat (dist/r 2.1 from the `sierra` relief
  scene). A relief gate there measures a flat desert. Moved to the `sierra`
  scene centre 36.578/-118.29 (the verify-sat-depth hillshade pose the scene
  was built for); altitude 3200 m and heading 270 kept.
- **The sun pin is a TIMESTAMP**, not an hour: `__flySunOverride` is read as
  epoch ms (`computeSun(lon, lat, window.__flySunOverride || Date.now())`).
  `sunTimeMs` derives it from the app's own `computeSun` on a fixed date
  (2026-07-01): noon = the day's maximum true elevation (72–78° at the poses),
  dusk = the evening crossing of +4° true elevation.

## §3 W0 baselines (E1 step 4)

### §3a Per pose, Classic (the fleet pin), satellite fixture, 1280×720

`.graphics-review/r25/e/baseline-w0/baseline.json` + one full-frame PNG per
row (the numbers are a function of the PNG; re-read them with any crop).
Captures are WORLD ONLY (`isolateCanvas`); player, traffic and tracers
hidden; aeroplane pinned (pitch −0.1 rad). Sun: 2026-07-01, noon = the day's
max elevation, dusk = the evening +4° crossing. Terrain crop = lower-middle
band (x .12–.88, y .62–.92); horizon crop = central third (x .35–.65,
y .05–.65). Satellite boot for this run: **967 s at P1, load 8.1** (the app's
own reveal: ready, roads deferred).

| pose | sun (el) | settled (s) | missing at capture | draws | tris | GL programs | tex peak MiB | terrain mean lin. Y | clip % | Sobel | horizon (img row) | seam ΔE (split) | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 Owens 1500 m (AGL 367) | noon (76.5°) | 564 | — | **138** | 148,911 | 101 | 107.6 | 0.3621 | 0.00 | 30.80 | 272 | 20.70 | 7.5 |
| P6 Owens 7000 m (AGL 5867) | noon (76.5°) | 17 | — | 101 | 110,115 | 101 | 107.6 | 0.4181 | 0.00 | 42.44 | 359 ‡ | 8.65 ‡ | 8.0 |
| P1 Owens | dusk (4.0°) | 232 | — | 132 | 148,889 | 104 | 117.6 | 0.0526 | 0.00 | 24.79 | 272 | 35.72 | 8.4 |
| P2 Sierra 3200 m (AGL 1380) | noon (76.6°) | 497 | — | 189 | 299,709 | 105 | 126.4 | 0.3299 † | 0.00 | 44.33 † | 316 | 15.38 | 7.1 |
| P3 Manhattan 450 m (AGL 436) | noon (72.4°) | **no** | terrain (z13/18) | 175 | 541,874 | 106 | 129.4 | 0.1907 | 0.01 | 65.69 | 274 | 14.63 | 8.4 |
| P3 Manhattan | dusk (4.0°) | 23 | — | 176 | 542,098 | 108 | 129.4 | 0.0836 | 0.00 | 54.75 | 273 | 27.13 | 7.3 |
| P4 Powell 350 m (AGL **75**) | noon (73.0°) | **no** | terrain (z14/18), forest | 210 | 429,846 | 106 | 134.2 | 0.1284 | 0.01 | 26.39 | 264 | 31.10 | 8.0 |
| P5 Smokies 1500 m (AGL 927) | noon (77.5°) | **no** | terrain (z15/16), forest | **279** | 485,111 | 106 | 159.2 | 0.1067 | 0.00 | 50.84 | 283 | 38.53 | 8.1 |

- **Budgets on the Classic tree**: Owens **138 ≤ 261**; every satellite pose
  ≤ 375 (max Smokies 279); texture peak ≤ 300 MiB everywhere (max 159.2,
  logical GL bytes, ground-texture-audit); tier `high` throughout. Triangles
  0.11–0.54 M.
- **Unsettled rows are references, not baselines** (terrain still descending
  at capture). A gate holds nothing to them.
- **† clouds in the terrain crop.** This run did NOT park the cumulus deck
  (added afterwards, `d926a99`); at P2 a cumulus puff sits in the middle of
  the terrain crop. Every terrain number above includes whatever cloud was in
  frame; the C/D pass must use the parked instrument (and still expects the
  cloud SHADOW discs, which have no handle, until C's `__flyCloudFreeze`).
- **‡ P6's "horizon" is the haze→ground boundary.** At cruise the rim haze is
  a band of its own; the two-class split groups it with the sky and lands on
  its lower edge (row 359), not the sky→haze boundary (~255). A cruise-pose
  seam gate must pass `row` explicitly or use a three-class split.
- **The horizon column is re-read with the split finder** (`605b03f`). The
  live recorder still used the edge statistic, which at P1 took a stamped
  z16 tile border ~100 px below the horizon (ΔE 10.84 at row 371 vs the real
  seam's 20.70 at row 272), at P6 row 454 and at P2 row 393; at P3/P4/P5 and
  both dusks the two agree within 2 rows.
- **P4 is 75 m AGL.** The plan's "350 m" is MSL (warpToGeo altM) over ~275 m
  ground — a very low pose; kept as named, flagged for C/D.
- The fixture's imagery is DIAGNOSTIC (tile-stamped, border-coloured by
  zoom): every luminance / Sobel / ΔE number here describes the fixture, not
  Esri. Ratios within one session are the meaningful reads.

### §3b Boot times (venue numbers — read with the load average)

| boot | wall | load | note |
|---|---|---|---|
| toy `bootFly` (NYC 800 m) | 46.3 / 49.0 / 50.9 / 59.9 / 63.2 s | 4–7 | five boots this session; session 1: 51.5 s |
| satellite `bootFly` at NYC | 546 s (run 1) | 4.5 | session 1: 459.6 s at load 4.7; a third attempt did not reveal in 900 s at load ~8 |
| satellite `bootFly` at P1 Owens | 967 s | 8.1 | the recorder's boot this session |
| W0 PRODUCT boot, satellite (hangar → prop / KOSU / apron → Fly) | hangar DOM at **1.35 s**; Fly enabled at **61.8 s**; world reveal: **PENDING** (§3c) | 6.8 → 3.9 | run 1's probe was read before its timer recorded the reveal (`revealAt null`) — fixed (`a15f984`) |

### §3c What was NOT captured — PENDING (wrap-up, 2026-09-23)

The E1 instance was stopped mid-run (~16:50 UTC); the killed runs' partial
output is `.graphics-review/r25/e/baseline-w0.log` and
`baseline-w0-product/baseline.json`. This wrap-up ran NO browser (both slots
are reserved for A and B), so every row below stays PENDING for E2:

| baseline | status | why / what E2 does |
|---|---|---|
| W0 PRODUCT boot world reveal (satellite, hangar → KOSU apron → Fly) | **PENDING** | run 2 clicked Fly at 107.8 s (load 7.7) and the browser was closed under `waitForFunction` before the reveal; no `worldMs` exists. §8's "≤ W0 × 1.05" comparison therefore has no W0 number yet. **Fix pass (§4c F2):** a lone W0 number would not be enough anyway — E2 runs ONE recorder with `R25_BASELINE_PRODUCT_ARMS="w0=<r25-w0 server>,int=<integration server>" R25_BASELINE_PRODUCT=3`, which interleaves w0,int ×3 under a pinned clock and writes `boots.productVerdict` (NOT CALIBRATED when an arm's own spread exceeds 5 % or its spot moved). The rural readiness proof (`r25-e-sat-probe.cjs satellite grandCanyon` on r25-w0) comes first. |
| P3 Manhattan noon, P4 Powell noon, P5 Smokies noon | **PENDING (reference only)** | captured UNSETTLED (terrain z13–15 of 16–18; forest at P4/P5) — §3a numbers are references, not baselines. E2 re-captures with a longer settle if a C/D gate needs them; the intro pass holds nothing to them. |
| P2 Sierra noon terrain crop | **PENDING (clean re-read)** | a cumulus puff sat in the terrain crop (captured before `d926a99` parked the deck); draws/tris/programs/texture are valid. |
| P4 / P5 dusk, P2 dusk, P6 dusk | **not captured** | not in the killed run's order; C/D-pass concern only. |
| toy per-pose luminance / ΔE | **not captured** | the plan's per-pose table is Classic satellite; toy is covered by smoke (§4a). |
| `graphics-flight.cjs` memory probe | **not run** | texture peak is recorded per pose from ground-texture-audit instead (§3a); the GPU-timer path refuses SwiftShader (§7). |

### §3d Node-gate re-verification at `28cafb1` (wrap-up, no browser)

Every node gate in the plan's W0 baseline table plus E's own, run on this
branch head. All match the W0 baseline; none moved.

| gate | W0 baseline | `r25/e` @ `28cafb1` |
|---|---|---|
| verify-import-integrity.mjs | 3 passed / 1 failed | **4 passed / 0 failed** (E's sanctioned parser fix, §4) |
| verify-r25-flagoff.mjs | (new) | 8 PASS / 0 FAIL / 2 NOT CALIBRATED, exit 2 (C/D stubs) |
| verify-mobile-actions-node.mjs | 9/9 | 11/11 PASS, 5 PENDING (A's hook) |
| graphics-unit.mjs | PASS | PASS |
| verify-flight-operations.mjs | PASS (33) | PASS (33) |
| verify-stylized-earth.mjs | PASS 22/22 | PASS 22/22 |
| verify-c-flagoff.mjs | PASS (58) | PASS (58) |
| verify-vendor-three-tile.mjs | 34 / 0 | 34 / 0 |
| verify-living-earth.mjs | PASS (19) | PASS (19) |
| verify-cinematic-flight.mjs | PASS | PASS (16/16) |
| verify-operations-disclosure.mjs | PASS | PASS |
| verify-lod-fade.mjs | 60 / 4 (pre-existing) | 60 / 4 — the same four (patch-7 / marker-count stale vs the Motion-Hold vendor edits) |
| verify-atmo-law.mjs | crashes (pre-existing) | crashes — the same `TypeError: Cannot set properties of undefined (setting '0')` in `setAerial` |

## §4 Gates written this phase, RED first

| gate | RED (calibration) | on r25-w0 / this branch |
|---|---|---|
| `verify-r25-flagoff.mjs` (node) | `R25_FLAGOFF_RED=1` injects the realistic mistake (a terrain key suffix + a rim write gated on the BLOCK flag instead of `r25On`): **(2b) CLASSIC terrain FAIL (key), (2e) C-only FAIL, (3b) CLASSIC hooks FAIL (6 writes, colours moved)** — 9/3/0, exit 1. | 8 PASS / 0 FAIL / **2 NOT CALIBRATED** (Enhanced == OFF: the C/D bodies are W0 stubs), exit 2. |
| `verify-r25-smoke.cjs` (fixture) | `R25_SMOKE_RED=1` (= `mirror`) breaks the W0 `setHangarOpen`→`screen` mirror in the page → **(7) FAIL** (`hangar left false · screen hangar`), 4/1/14, exit 1 — MEASURED on r25-w0, §4a. **Title-era REDs `title` / `reload` / `continue` (fix pass, §4c F3): MEASURED on the integrated tree in E2 (§4d)** — `title` and `reload` exit 1 on their expected legs, and `mirror` still turns (7) red (and now (4c)). | **5 PASS / 0 FAIL / 14 NOT CALIBRATED**, exit 2 (§4a, pre-fix-pass smoke; the fix pass changed no leg that runs on r25-w0 — see §4c) |
| `verify-r25-visuals.cjs` (fixture, satellite + toy) | **MEASURED** (`R25_VISUALS_FORCE=1 R25_VISUALS_RED=1`, P1 Owens, r25-w0): floor **mean 0.053/255, p99 1/255**; the un-nudged Classic→Enhanced→Classic×3 control **0.057 / 1** (would PASS); the 2 m held-pose nudge **mean 9.281/255, p99 100/255 → (1) FAIL**; (2)–(4) NOT CALIBRATED (nothing enhances), programs flat 111→111→111→111, (5a) draws **132/132/132 ≤ 261**, (5c) texture **101.3 MiB**. 2/1/6, exit 1. Session 1's RED wrote `flight.pos.y`, which the 8 ms pin overwrites — it could never have fired (fixed `fb93a14`); and the first forced run read a floor of **mean 1.8, p99 32** because the pin alone creeps (fixed by `holdStill`, `6ab5954` — §4b). | on this tree the ship-state short circuit reads **7 NOT CALIBRATED** in <1 s (no R25 visual block ON), exit 2 |
| `verify-mobile-actions-node.mjs` (edited) | — (the legacy 9 cases are the baseline) | **11/11 PASS, 5 PENDING** (the R25 Esc/Back cases wait for A's hook; they switch on by themselves when `use-overlay-back.js` learns `screen`/`settingsOpen`) |
| `verify-import-integrity.mjs` (sanctioned parser fix) | the W0 baseline: 3 passed / 1 failed (3 errors in 2 files) | **4 passed / 0 failed** — `ecmaVersion 'latest'` parses the JSON import attribute in `lib/fly/living-regions.js`, and `scripts/r24-c-agl.js` now destructures the `agl`/`speed` it was always passed (a real ReferenceError on the probe's first frame). No other assertion changed. |

### §4a verify-r25-smoke on r25-w0 (toy fixture, `FLY_BOOT_SCALE=3`)

Session 1 wrote the smoke and never recorded a run. Session 2 ran it twice
(the session-1 version, then the hardened one) plus the RED:

| run | (1) legacy | (2) menu | (2e) world canvas first | (7) T&L | (8) errors | total |
|---|---|---|---|---|---|---|
| session-1 smoke, re-verify | PASS, reveal **49.0 s** | PASS (hangar) | — | PASS via the store, KOSU apron parks | PASS | 4/0/5 |
| hardened smoke | PASS, reveal **59.9 s** (load 4.3) | PASS, hangar at **997 ms** | PASS (4 canvases in the DOM, the first `.fixed.inset-0 canvas` is `__flyGl.domElement`) | PASS (`flightMode ops`, phase parked) | PASS | **5/0/14** |
| hardened smoke, `R25_SMOKE_RED=1` | PASS | PASS | PASS | **FAIL** — `hangar left false · screen hangar` | PASS | 4/1/14 |

The 14 NOT CALIBRATED are every title / settings / free-flight / exit /
Continue leg: `FRONT_DOOR` and `FLIGHT_PLAN` ship `enabled:false` here. The
smoke reads the ship state from `fly-constants.js`: once A or B flips its
flag, the same absences read **FAIL**, not NOT CALIBRATED (an ON flag with no
title is a defect). The toy fixture boot is therefore re-verified green on
this base (46–63 s over five toy boots, loads 4–7), without the 8-minute
satellite boot the task allowed skipping.

**What the hardened smoke adds for integration** (header of the file has the
leg list): the title was in the DOM before the reveal (from the boot probe,
not a racy read), the charter controls + `data-overlay="title"`, the title
WORLD reveals (`data-ready` and pct 100; times go to the report as the
product-boot numbers), world canvas first, player hidden on the title, Esc on
the title root is a no-op, the passport is byte-identical across 30 title
frames with traffic, Settings open/Esc-close, the Visuals row hidden while no
R25 visual block ships ON (the intro pass), hangar-back to the title over a
live world, a 60-frame airborne + un-crashed hold, exit-to-title with **no
page reload** (an in-page marker survives), Continue keeps mode + aircraft.
(Fix pass, §4c: (2h) now needs a spot OPPORTUNITY and (6) now needs the
PERSISTED setup — the two claims above were vacuous as first written.)

### §4c Fix pass — adversarial peer review (2026-09-23, no browser)

Three major findings against E's intro-pass gates. All three were verified
against the code (A's `r25/a` `lib/fly/front-door.js`, FlyScene Phase 5,
the recorder) before anything was changed. **This pass ran NO dev server, NO
browser and NO build** (both browser slots were reserved for A and B), so
every browser consequence below is WRITTEN and node-checked, and its first
run belongs to E2.

| # | finding | verified? | verdict | what changed |
|---|---|---|---|---|
| F1 | smoke (6) CONTINUE cannot fail: (4) never picks an aircraft (it stays `fighter`), A's `exitToTitle` (`r25/a` front-door.js:125-150) never touches `flightMode`/`aircraftId`, no reload — a Continue that only calls `setScreen('flight')` passes; the persisted `fly-last-setup-v1` and the relaunch place are never checked | **yes** — both fields survive `exitToTitle` in memory | **FIXED** | (4) clicks `hangar-pick-bizjet` (non-default) and records the launch geo (`runtime.geo`); (4c) asserts the launched aircraft IS the pick. (6) reads `FLIGHT_PLAN.lastSetupKey` from storage, then **perturbs** the store (aircraft → `fighter`, flightMode → `ops`) before clicking Continue, and asserts airborne + mode `free` + aircraft `bizjet` + ≤ 2.5 km from the launch geo + the persisted key present. A green (6) with the default aircraft reads NOT CALIBRATED. A (5) that FAILED makes (6) FAIL. |
| F2 | the product-boot gate (median of 3 ≤ W0 × 1.05) has no W0 number, pins no clock (B's daylight title spot follows the wall clock), records no spot, compares a median against one W0 number, applies 5 % on a venue whose boots swing by minutes, and E never proved satellite readiness at a `rural` fixture spot | **yes** — `productBoot` had no `__flySunOverride`, no spot, one arm | **FIXED (code) + DEFERRED (the two browser proofs)** | `r25-e-baseline.cjs`: every product boot pins `__flySunOverride` (default 2026-07-01 19:00 UTC, `R25_BASELINE_PRODUCT_SUN_MS`, `wall` disables), records `spot` + fixture `scene`; `R25_BASELINE_PRODUCT_ARMS="w0=…,int=…"` interleaves the arms ABABAB in one session; the verdict (new `scripts/_r25-product-boot.js`) is **NOT CALIBRATED** when an arm has < 3 valid runs, its own spread > 5 %, or its spot moved — PASS/FAIL only otherwise. Node self-check **6/6**, RED-first (the single-arm recorder, an 11.3 % W0 spread, a moved spot, 2 valid runs all refuse to read PASS/FAIL). Readiness-only pose **R1 `grandCanyon`** (36.0544/-112.1401, scene `rural`, = `titleSpot.fallbackId`) added to `_r25-poses.js` (`EXTRA_POSES`; `node scripts/_r25-poses.js` 8/8 incl. R1 → rural). **DEFERRED to E2 (browser):** the rural readiness proof on r25-w0 and the W0 product-boot numbers themselves. |
| F3 | none of the intro legs was shown able to fail: the only RED (`setHangarOpen` mirror) was calibrated on r25-w0 through the store path and may not bite on the integrated tree; (2h) "passport unchanged" can pass with no spot opportunity (the only spot path is `targeting.update`'s `acquired` transition) | **yes** — Phase 5 runs every frame on the title, and nothing guaranteed a track enters the frozen nose's cone | **FIXED (code) + DEFERRED (RED calibration runs)** | (2h) wraps the live `__fly.targeting.update` for the window (install at the pre-reveal passport read, unwrap at the post read) and counts acquisitions of a track with `meta` (logSpot's precondition) + traffic max; **no acquisition → NOT CALIBRATED**, never PASS. Wrapper node-checked on a fake runtime (counts 2 acquisitions / 1 with meta over 5 updates, restores the prototype method). New REDs: `R25_SMOKE_RED=title` (setScreen ignores `'title'` → expect (4b)/(5)/(6) FAIL), `reload` (capture-phase hook turns Exit into `location.reload()` → expect (5)/(6) FAIL), `continue` (Continue relaunches the perturbed in-memory store → expect (6) FAIL); `1` = `mirror` unchanged. **DEFERRED to E2:** running all four REDs on the integrated tree and recording them here BEFORE the green smoke is read as certification — including whether `mirror` still turns (7) red there. |

On r25-w0 the fix pass changes no leg that executes there: (2h), (4)–(6)
are NOT CALIBRATED without a title (same 14), and (1)/(2)/(2e)/(7)/(8) are
untouched — so §4a's 5/0/14 and its measured `mirror` RED still describe
this branch.

### §4d E2 — the intro-pass integration smoke (2026-09-23, the integrated tree)

**Venue.** Integration worktree on `claude/skyloom-r25-intro-d0pp2v`; r25/e,
r25/a, r25/b were already merged by the orchestrator and pushed (main
`93c28f3`), so the step's `git merge --no-ff r25/b` read *Already up to
date* (pre-merge `83d23d9`). Dev `:3036`, fixture `:3206`/`:3207`,
`FLY_BOOT_SCALE=3`, TWO SwiftShader browsers at once through the slot lock,
load average **7.4–9.4** on 4 cores for the whole session. Every time below
is a venue number.

**Node gates on the tree** — all at their baselines: import-integrity **4/0**,
verify-r25-front-door **68/0**, verify-r25-flight-plan **44/0**,
verify-r25-flagoff **8/0/2 NC** (exit 2; the C/D rows), mobile-actions-node
**16/16**, graphics-unit PASS, flight-operations **33**, stylized-earth
**22/22**, c-flagoff **58**, vendor-three-tile **34/0**, living-earth **19**,
cinematic-flight PASS, operations-disclosure PASS; the pre-existing reds did
not get worse (lod-fade **60/4**, the same four lines; atmo-law the same
`setAerial` TypeError). Targeted eslint over every file changed since
`r25-w0` + the W0 files: exactly the W0 addendum's per-file counts
(Contrail 3e, FlyCanvas 1e, FlyScene 0e/2w, PlayerPlane 2e/2w,
use-fly-audio 1e; every other file 0).

**The instrument had to be made to survive this venue first** (all E-owned,
each merged as `r25/e` on top — no product file touched):

| smoke run | what happened | fix |
|---|---|---|
| toy 1 | 12/1/1: `(!)` — a plain `click()` on a visible, ENABLED `hangar-fly` sat 30 s in Playwright's actionability wait ("stable" = two rAFs with one box; behind the staging hangar a rAF pair takes seconds) | `cf7c86e`: one `press()` helper (trusted click first, bounded) |
| toy 2 | 11/1/1: `(!)` — even the FORCE fallback on `hangar-back` timed out at 180 s: the free hangar's StagePump keeps invalidating while toy staging cannot finish here, so the page's main thread is saturated and the locator round trips never get a turn (A's ledger measured the same in flight) | `13a4d29`: fall back to ONE `page.evaluate` DOM click (A's `domClick` idiom; B falls back to `dispatchEvent`); `_title.js enterHangar` the same; (7)'s select falls back to the native setter + `change` |
| satellite 1 | 17/1/1: (1) LEGACY POSTURE — bootFly's pct-100 wait (unscaled) timed out at 600 s; the PRODUCT title world in the same session revealed at **1075.6 s** | `1602f61`: satellite legacy bound 1800 s (toy keeps 600 s) |
| RED reload 1 | exit 1 through `(!)` "Execution context was destroyed" — the DOM fallback's own evaluate died with the reload the RED injects | `8f8e315`: a press whose click navigates is a landed press |
| RED reload 2 / RED continue 1 | `(!)` "the control vanished" — the trusted click's timeout fired AFTER the click was dispatched (a starved renderer acks late), so the fallback found the control gone | `fbde973`: a control that vanished right after a press is a landed press |

Every leg asserts the EFFECT (screen / phase / store), never the click, and
every fallback is counted (`report.presses`: the green toy runs read 4 trusted
presses + 5 DOM clicks, and 4 trusted + 4 DOM + 1 late-acked).

**Smoke, green runs** (the certification rows):

| run | result | notes |
|---|---|---|
| toy (run 3, and again on the FINAL instrument `dc4c59b`) | **18 PASS / 0 FAIL / 1 NC** (exit 2), twice | legacy toy reveal 65.7 s; the title in the DOM at 1285 ms at boot pct 0, pct 100 at 66.0 s, data-ready 74.8 s; Free Flight (Manhattan, the toy title spot) in the PICKED `bizjet`, AGL 935 m; Exit to title with no reload; Continue restores the PERSISTED setup after the perturbation (0 m from the launch geo, "Continue Meridian · Free Flight over Manhattan"); T&L KOSU apron parks; zero page errors (the re-run: legacy 62.0 s, pct 100 55.5 s, data-ready 73.2 s, Continue 60 m from the launch geo). The one NC is **(2h)**: 0 acquisitions over 52 targeting updates, traffic 300 — no spot opportunity on the fixture's static fleet, so it is NOT a pass. The passport-on-title property is certified by A's `verify-r25-title` **(t8) PASS** instead, which PLACES the frozen flight 3 km from a contact: 1 real acquisition on the title, spots 0→0. |
| satellite (run 1) | **17 / 1 / 1** | every PRODUCT leg PASS: the title spot was **Tokyo** (the daylight rule at 21:5x UTC), title in the DOM at 1392 ms at pct 0, world revealed 1075.6 s; Free Flight → Tokyo AGL 894 m; exit (no reload); Continue ("Free Flight over Tokyo", 0 m); T&L KOSU apron **parks**; zero page errors. The one FAIL is (1)'s 600 s bound (fixed above); (1) is re-proved standalone below. |
| satellite (1) standalone (the leg re-run alone with the 1800 s bound, E2 scratch `legacy-sat-boot.cjs`) | **PASS** | pinned satellite bootFly revealed at **845.1 s** (load ~7.5), no title node, `visuals classic`, screen `flight`, `hangarOpen false`, `__flyWorldStatus {ready:true, degraded:false, missing:[]}`, **zero page errors** — so the pinned legacy fleet boot reaches pct 100 in both styles on the integrated tree |

**Title-era REDs on the integrated tree** (plan: each must exit 1 with the
expected legs red before a green smoke counts):

| RED | expected | measured |
|---|---|---|
| `title` (setScreen ignores `'title'`) | (4b) (5) (6) FAIL | **exit 1: (4b) FAIL, (5) FAIL (screen `flight`, player visible), (6) FAIL**, + (7) FAIL (collateral: the title can never be re-entered, `enterHangar(ops)` timed out at 360 s) — 14/4/1 |
| `reload` (Exit = `location.reload()`) | (5) (6) FAIL | **exit 1: (5) FAIL (`no reload false`), (6) FAIL**, + (8) FAIL (collateral: the smoke's own `waitForFunction` predicates polled the RELOADED page before `__flyStore` existed — two `getState`/`framesRendered` TypeErrors in the predicate eval); (7) PASS — 15/3/1 (run 3; runs 1–2 were instrument, table above) |
| `continue` (Continue relaunches the perturbed in-memory store) | (6) FAIL | **exit 1: (6) FAIL and nothing else** — after the perturbation Continue relaunched `fighter` / `ops` (launched `bizjet` / `free`), `failed: airborne, mode, aircraft`; 17/1/1 (run 3; run 1 = the late-acked click, run 2 = a 5 s `getAttribute` on the mode chip that read null on a starved main thread → `dc4c59b`) |
| `1` / `mirror` (setHangarOpen loses its `screen` mirror) | record whether (7) still goes red | **exit 1: (4c) FAIL** (after Fly the screen stays `hangar` — B's free launch goes through `setHangarOpen(false)`) **and (7) FAIL** (the ops hangar never appears, 360 s) — so the mirror RED STILL calibrates (7) on the title path, and now (4c) too — 13/2/4 |

**The owners' own fixture gates on the integrated tree:**

| gate | result | owner verdict |
|---|---|---|
| A `verify-r25-title.cjs` toy,phone,attr | **42 / 1 / 0** | **(t11) FAIL — a product defect (A).** Every other t11 condition held (same canvas, no reload, frames advancing, ops back in `hangar`, player hidden, X gone) but `titleCam blends 0`: the title camera SNAPPED instead of easing out of the chase pose. Cause, read from `lib/fly/title-camera.js`: `deactivate()` keeps `_center` from the last title frame, and the first `update()` after `exitToTitle` sees the flight > 3 × radius from that stale centre and treats it as a teleport under the title (snap, blend cancelled). With B merged the toy title spot is Manhattan, not KOSU, so every T&L flight (KOSU) — and any free flight away from the title spot — exits with a hard cut. Node repro (E2 scratch): title shown at A, deactivate, flight ends 800 km away, `blendFrom` + `activate` → **blends 0, snaps 2**; 500 m away → blends 1. Clearing `_hasCenter` in `deactivate()` gives blends 1 in both (a candidate, A's call). On A's branch the title spot was KOSU, so run 16 could not see it. |
| A `verify-r25-title.cjs` sat,attrsat | **10 / 1 / 0** | **(s2) FAIL — A's gate, exposed by B.** The row asserts ±5 % of `FRONT_DOOR.orbit.radiusM` (2600 m), but the title orbits B's PER-SPOT `title.radiusM` (2400–4000 m in `lib/fly/destinations.js`). This boot's daylight spot was **Sydney (radiusM 2400)** → worst error exactly **7.69 %** = 2400 vs 2600, i.e. the camera sat on the spot's own radius. The toy row passes only because Manhattan's radius is 2600. The gate must compare against the active spot's `titleOrbitParams` radius. (s1) (s3)–(s6) and a-satellite1–5 PASS; reveal 589 s. |
| B `verify-r25-continue.cjs` toy | **5 / 0** | through the title: free Δ 0.000 m; ops runway 10R Δ 0.000 m; corrupt storage hides Continue. |
| B `verify-r25-hangar-edges.cjs` | **5 / 0** | Esc clears a query; Esc from inside the hangar → title; late-runtime staging (free Tokyo, ops KCMH). |
| B `verify-r25-freeflight.cjs` toy | **5 / 1 / 1** | **(2) FAIL — B's gate, exposed by the integration.** It stages `hangar-dest-manhattan`, but with the front door on the TOY title spot IS Manhattan (B's `titleSpot.toyId`; leg (1) itself read `default manhattan`), so the stage does not warp (`warped false`) and the row's `warped === true` term fails. Staging the spot you are already at is correct product behaviour; the gate needs a destination other than the default. (1) (3) (4) (5) (7) PASS; (6) NC (toy staging never finishes here). On B's branch the flight started at KOSU. |
| B `verify-r25-freeflight.cjs` satellite | **6 / 0 / 0** | title spot Tokyo → the Manhattan stage warps, ready behind the hangar in 405 s; placement 0.00 m; staged hold **6.8 s** vs the unstaged control still holding after **88.6 s**. |

**The ops harnesses through the title** (they open their own context, so a
new E preload — `scripts/_fixture-preload.js`, a `-r` hook — gives them the
fixture exactly as bootFly does: routes + DEM pin + finalize scaler, no
style/weather/title pin; it also closes the in-process fixture server when
the browser closes, which the first keyboard run showed was needed). The
product boots satellite (their readiness waits are satellite-only), so they
meet this venue's satellite boot:

| harness | result | reading |
|---|---|---|
| `verify-operations-touch.cjs` | **BLOCKED (exit 2)** | through the title: "Back on the title root leaves the page (browser default at the app root)" and "Back in the pre-flight hangar lands on the title" both hold; the KOSU departure PARKED; full readiness was not reached in the harness's hard 90 s (`missing terrain, forest`, progress 0.89) — the harness's own BLOCKED verdict. Run 1 died on a racy E edit (Back's navigation committed after a fixed 500 ms read) → fixed (`059c093`). |
| `verify-operations-keyboard.cjs` | **FAIL — venue** | `enterHangar(ops)` through the title passed; the harness's hard 60 s wait for `hangar-fly` enabled (the aircraft preview GLB, `ready`) expired under load (A's gate waits 180 s for the same). |
| `verify-operations-browser.cjs` | **FAIL — venue** | through the title into the ops hangar; the trusted click on `hangar-pick-prop` logged "performing click action" and timed out at 60 s (a saturated renderer never acked). |

None of the three is a product reading here; they belong to the user
machine's run list. The T&L flow THROUGH THE TITLE is certified on this
venue by the smoke's (7) in both styles (KOSU apron departure parks).

**E2 verdict for this merge step: NOT GREEN — three owner findings, the tree
kept** (the orchestrator's rule for this run: nothing already on main is reset;
each owner fixes on its branch and E merges on top):

1. **A — product (`lib/fly/title-camera.js`)**: exit-to-title snaps instead of
   blending whenever the flight ended > 3 × radius from where the title was
   last shown (stale `_center` across `deactivate`). `verify-r25-title` (t11).
2. **A — gate (`scripts/verify-r25-title.cjs` (s2)/(t6))**: the orbit radius
   must be judged against the ACTIVE spot's `title.radiusM`, not the
   `FRONT_DOOR.orbit` default.
3. **B — gate (`scripts/verify-r25-freeflight.cjs` (2))**: the staging row must
   pick a destination other than the one the flight already sits at (the toy
   title spot is Manhattan).

Everything E owns is green on the tree: node gates at baseline, both styles'
pinned legacy boot, the smoke's every product leg in both styles, and all four
title-era REDs calibrated (each exits 1 on its expected legs).

### §4b verify-r25-visuals — what runs when

- **Now (intro pass)**: `R25_SKY` / `R25_GROUND` ship `enabled:false`, so
  `visualsAvailable()` is false and `resolveInitialVisuals` forces Classic —
  the profile has nothing to switch. The gate reads the ship state from node
  and reports all seven legs NOT CALIBRATED without booting.
  `R25_VISUALS_FORCE=1` runs the browser legs anyway: (5a) draws, (5c)
  texture peak, (6) cross-boot (with `FLY_URL_BASELINE`) and (7) toy are
  meaningful on any tree.
- **C/D pass**: bounds come from `R25_CERT` (one source for C, D, E);
  the C-only / D-only columns are the dev sub-pins (`__flyR25Ground = 0` /
  `__flyR25Sky = 0`), re-entering Enhanced under each pin because the pin is
  read when programs / writes are decided; `settle()` waits for the GL
  program count to hold across two 10-frame windows (lazy alternate warms).
  Its RED is already measured (§4 table): forced on r25-w0 it fails leg (1)
  on a 2 m nudge and passes the un-nudged control, against a floor of
  0.053/255 mean.
- **Why the floor is that small now — `holdStill`.** The first forced run
  (`visuals-red-w0-run1.log`) read a floor of mean 1.8/255, p99 32/255 over
  56 % of pixels between two Classic captures 20 frames apart. The amplified
  diff lit every ground EDGE (tile stamps, borders) and left the sky dark: a
  whole-ground sub-pixel shift. The `warpToPose` pin re-asserts the pose
  every 8 ms, but the flight model still steps between a pin write and the
  render (speed eases up from the pinned 0, the trim servo acts), so the
  camera renders a dt-dependent distance off the held pose — and at 1–3 fps
  dt is anything. The paused phase is the app's own held path
  (`FlightOperations.advance` returns before integrating); with it the floor
  fell to 0.053 / 1 (2.6 % of pixels; the amplified diff shows the SKY
  clean and the residue on the ground only — the road's dashed centre marks,
  which animate, and far-field edge shimmer in the rows just below the
  horizon: 6.7 % of pixels changed there vs 0.4–1.0 % in the sky bands).
  **Every R25 pixel pair must use `holdStill`** — C and D included. The
  R24/R19 pin idiom alone is not a still frame on this venue.

## §5 Legacy harness edits (E1 step 5, SANCTIONED)

- Ops harnesses (`verify-operations-{browser,design,experience,fleet,keyboard,taxi-edge,touch}.cjs`,
  `verify-loading-scenery.cjs`): `enterHangar(page,'ops')` after every
  `goto` / `reload` (touch taps). On r25-w0 this is the store path — no
  behaviour change; after A merges it walks the title.
- `verify-operations-touch.cjs`: the Back rule is now **"Back never reveals an
  unstarted world"** — with a title, Back on the title root keeps a menu up
  and Back in the pre-flight hangar lands on the title or the hangar, never
  `screen 'flight'`; without a title it is today's assertion exactly.
- `verify-mobile-actions-node.mjs`: the fixture store carries `screen`,
  `flightMode`, `settingsOpen`, `visuals`, `visualsEpoch`, `setScreen`,
  `setFlightMode`, `setSettingsOpen`, and the W0 `setHangarOpen` mirror; one
  case asserts the fixture matches `stores/fly-store.js` textually; new cases
  PENDING until A's hook implements them (a `ReferenceError` from an import
  the vm fixture lacks is reported PENDING, not FAIL).
- Text: `verify-boot.js:97` accepts "Welcome to Fly Mode" OR "Welcome to
  Skyloom"; `verify-mobile-layout.js` (~488/506) accepts "Exit Fly Mode" OR
  "Exit to title". Both old and new until A merges.
- `graphics-flight.cjs` / `graphics-capture.cjs` → `enterFlight` (see §5a).

### §5a The rest of step 5 (session 2)

- **`graphics-flight.cjs` / `graphics-capture.cjs` → `enterFlight`** (session 1,
  `5072a38`): both used to wait for pct 100 and then `warpToGeo` UNDER the
  mandatory hangar; they now skip the menus first (the capture keeps
  `name:null`, the flight keeps its old no-heading warp). `graphics-flight`
  still refuses SwiftShader by design — unmeasurable here.
- **`_mobile-boot.js` gains the airborne skip, title-aware.** RED first
  (`scripts/r25-e-mobile-boot-probe.cjs`, toy, hosts blocked): the **r25-w0
  helper RETURNS** — pct 100 behind the hangar — with `screen 'hangar'`,
  `phase 'hangar'`; **the current helper** returns `screen 'flight'`,
  `phase 'airborne'` (46.6 s / 49.1 s). So the six mobile harnesses
  (verify-mobile, -mobile-actions, -mobile-layout, -sat-mobile, -hangar,
  -logbook) were not red since 2c624a3 — they measured the HUD and touch
  controls under an opaque z-60 hangar with the flight frozen. The skip runs
  ONLY when the boot lands in that hangar: a gate that un-pins
  `__flyTitleBypass` keeps its title (A's phone checks can use bootMobile
  unchanged); `{ skipMenus: false }` returns at mount. My first draft of this
  comment claimed a timeout; the probe refuted it and the record says what
  was measured.
- **`verify-mobile-layout.js`**: the landscape exit lookup takes
  `[data-testid="pause-exit-title"]` first, then either label
  case-insensitively ("Exit Fly Mode" / "Exit to title").
- **`verify-operations-touch.cjs`**: Back on the title ROOT may leave the page
  (a fresh tab's history is `about:blank` → app) unless A pushes a history
  entry for the title. Leaving is not revealing a world; the harness records
  it and re-enters instead of throwing.
- **The direct-`goto` fleet, recorded as stale since 2c624a3** (they `goto`
  and `warpToGeo` with the mandatory hangar still up — the flight frozen in
  phase `'hangar'` behind an opaque overlay; with A's title they will warp
  under the title instead). 29 files, none references the hangar:
  `bruno-study.js`, `cinematic-{contact,flight,highlight,vegetation}-probe.cjs`,
  `cinematic-review-components.cjs`, `graphics-{arrival-profile,geography,home-drape-probe,ohio-probe,quality,style-smoke,terrain-motion,water-probe}.cjs`,
  `immersive-{rebase,regression,smoke}.cjs`, `stylized-earth-motion.cjs`,
  `verify-{black-frames,earth-review,earth-world,ground-appearance,ground-contact,ground-neon,player-shadow,raster-orientation,raster-recovery,terrain-bounds-browser,terrain-ground-browser}.cjs`.
  The fix for any of them is one line — `await enterFlight(page, geo)` from
  `scripts/_skip-menus.js` after the `goto` (the graphics-flight pattern).
  Not converted this round (the plan records them, and none is a gate the
  intro pass certifies with).

## §6 Open risks

- The satellite un-pin changes what every satellite harness measures (shipped
  terrain instead of R21 terrain). Justified above; E2 must not read any
  pre-R25 satellite fixture number as a like-for-like baseline.
- The finalize scaler default makes satellite fixture boots unusable for
  PACING claims (they already were — 1–3 fps). A pacing gate must set
  `FLY_FINALIZE_BUDGET_K=1` explicitly.
- `readinessInPage` is a COPY of `worldReadiness`; the self-check catches a
  renamed/added part, not a changed predicate body.
- **Two E runs at once walk the fixture onto 3206** (the integration port):
  `startFixture` binds its own port unless `FLY_FIXTURE_REUSE=1` and walks up
  on a busy one — measured in session 2 (`[fixture] port 3205 busy … trying
  3206`) and killed. E2 runs on 3206 by charter, so it is safe there; a role
  running two fixture gates concurrently must pass distinct ports.
- **`bootFly`'s `skipMenus: true` exits an un-pinned title** (`enterFlight`
  → `setHangarOpen(false)` → screen `'flight'`). That is the documented
  airborne skip, but it assumes A's `screen` change fully leaves the title
  (title camera inactive, player shown) — the smoke's (1)/(2f)/(5) and A's
  title gate cover it at integration.
- **`isolateCanvas` hides the DOM for the capture**, so every R25 pixel
  number (baseline, visuals, C/D columns that use `_r25-luma` via these
  captures) is world-only. A gate that compares against a PRE-isolation PNG
  (none exists in this round) would compare HUD against no HUD.

- **(2h) may never be exercised on the fixture.** A spot needs a track
  inside the frozen nose's 10° / 10 km acquire cone during the title
  window; with the fixture's fleet that is not guaranteed, and the leg then
  reads NOT CALIBRATED by design (fix pass F3). If E2 needs it exercised, it
  must place a track in the cone deliberately (a harness-side fixture
  aircraft), not loosen the leg.
- **(6)'s perturbation writes the store on the title** (aircraft `fighter`,
  flightMode `ops`) before Continue. If B's Continue restores the aircraft
  from the separate `fly-aircraft` pick key rather than the last setup, (6)
  still passes — both are persisted state, which is the contract being
  tested; only an in-memory Continue fails.
- **The product-boot clock pin assumes B's daylight rule reads the app's sun
  clock** (`__flySunOverride`, as FlyScene does). If B reads `Date.now()`
  directly, the pin does not bind — the verdict's moved-spot rule then
  catches a spot that changed between runs, and the fix is on B's side (read
  the same override).

## §7 Unmeasurable here

- every fps / frame-time / tearing / stall figure (SwiftShader, shared cores);
- boot wall time as a budget (7.7 min satellite / 51 s toy are venue numbers);
- real Esri colour, real WorldCover classes, real DEM relief (the fixture is
  synthetic by construction);
- `graphics-flight.cjs`'s GPU-timer path (it refuses SwiftShader by design);
- audio unlock / AudioContext on a real device; phone GPU behaviour.
- the mobile fleet against real tiles (bootMobile attaches no fixture: in
  this container it boots an empty world through the Neon ceiling — fine for
  UI / touch, meaningless for pixels).

## §8 E2 run sheet (for the integration agent)

All from the integration worktree, dev `:3036`, fixture `:3206`, through the
slot lock. `export FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3206 FLY_URL=http://localhost:3036 FLY_BOOT_SCALE=3`.

| after | run | expect on the intro pass |
|---|---|---|
| every merge | `node scripts/verify-import-integrity.mjs` | 4/0 |
| every merge | `node scripts/verify-r25-flagoff.mjs` | 8 PASS, 2 NOT CALIBRATED (exit 2) while C/D are off; [4] constants hygiene must stay PASS |
| every merge | `node scripts/verify-mobile-actions-node.mjs` | 11/11; the 5 PENDING switch on when A's `use-overlay-back.js` learns `screen`/`settingsOpen` — then they must PASS |
| A + B merged, BEFORE the first green smoke counts | the smoke with `R25_SMOKE_RED=title`, then `=reload`, then `=continue`, then `=1` (mirror) — one run each | **each must exit 1** with the expected legs red: title → (4b) (5) (6); reload → (5) (6); continue → (6); mirror → record whether (7) still goes red on the title path (if it does not, say the mirror RED no longer calibrates (7)). Record all four in §4c. A RED that stays green means that leg is not certified. |
| every merge | `…/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-smoke.cjs` (toy, ~6 min) | r25-w0: 5/0/14. After A (FRONT_DOOR ON): the title legs flip from NOT CALIBRATED to PASS/FAIL. After B (FLIGHT_PLAN ON): (4)–(6). Intro pass target: **0 FAIL; NOT CALIBRATED allowed only on (3b)'s round trip and on (2h) when no acquisition opportunity occurred** (`report.titleSpotWindow` — record it; an un-exercised (2h) is not a pass) — (3b) itself PASSES as "row hidden" while no visual block is ON |
| A + B merged | the same with `R25_SMOKE_STYLE=satellite` (~20 min) | the satellite title spot reveals (`productBoot.readyAt` in `smoke/report-satellite.json`) |
| A + B merged, before the product-boot row | a second dev server on an `r25-w0` worktree, then `…/run-browser.sh node -r ./scripts/_pw-shim.js scripts/r25-e-sat-probe.cjs satellite grandCanyon` against it | satellite `worldReadiness` reaches ready at the `rural` scene (R1) — the title spot's scene. If it does not, the product-boot row is BLOCKED (not red) and the reason goes in §4c |
| A + B merged | `R25_BASELINE_TAG=int R25_BASELINE_PRODUCT=3 R25_BASELINE_POSES=0 R25_BASELINE_PRODUCT_ARMS="w0=<r25-w0 server>,int=http://localhost:3036" … scripts/r25-e-baseline.cjs` | six interleaved product boots under the pinned clock; read `boots.productVerdict` (plan: int median ≤ W0 median × 1.05). **NOT CALIBRATED** (an arm's own spread > 5 %, < 3 valid runs, or a moved spot) is the honest outcome on a loaded venue — never hand B a spot swap on it. Record each row's `spot`/`scene` and load |
| C/D pass only | `scripts/verify-r25-visuals.cjs` (+ `FLY_URL_BASELINE` = a dev server on r25-w0) | intro pass: the ship-state short circuit, 7 NOT CALIBRATED in <1 s |

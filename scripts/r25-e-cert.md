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

### Pose readiness (Owens / Manhattan / Powell)

(filled below from probe 3's pose legs — see §1a)

## §2 Shared helpers (E1 step 2)

| file | what | self-check |
|---|---|---|
| `scripts/_title.js` | `enterHangar(page, 'ops'\|'free')` — clicks `title-takeoff-landing` / `title-free-flight` when `[data-testid="title-screen"]` exists, else sets `flightMode` on the store (W0 field); waits for `hangar`. `waitTitleReady(page, {world})` → `{title, ready, screen, ms}`, never throws on a missing title. | used by the ops harnesses + smoke |
| `scripts/_skip-menus.js` | `enterFlight(page, geo)` — `bootFly`'s airborne skip, verbatim; `_boot.js` now calls it (one copy). | toy boot 51.5 s through it |
| `scripts/_r25-poses.js` | P1–P6 + in-page `readinessInPage()` (a mirror of `worldReadiness`) + `warpToPose(page, P, {sun, pin})` + `sunTimeMs(P, 'noon'\|'dusk')`. | `node scripts/_r25-poses.js`: 6/6 poses in their fixture scene; mirror == app's 9 parts |
| `scripts/_r25-luma.js` | crop → sRGB decode → mean LINEAR luminance, clip %, Sobel energy (encoded luma), mean-colour Lab, CIE76 ΔE, horizon finder + seam ΔE, two-image diff census (mean/p99 in /255). | `node scripts/_r25-luma.js`: 12/12 closed-form checks |

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

(filled from `scripts/r25-e-baseline.cjs` — see §3a)

## §4 Gates written this phase, RED first

| gate | RED (calibration) | on r25-w0 / this branch |
|---|---|---|
| `verify-r25-flagoff.mjs` (node) | `R25_FLAGOFF_RED=1` injects the realistic mistake (a terrain key suffix + a rim write gated on the BLOCK flag instead of `r25On`): **(2b) CLASSIC terrain FAIL (key), (2e) C-only FAIL, (3b) CLASSIC hooks FAIL (6 writes, colours moved)** — 9/3/0, exit 1. | 8 PASS / 0 FAIL / **2 NOT CALIBRATED** (Enhanced == OFF: the C/D bodies are W0 stubs), exit 2. |
| `verify-r25-smoke.cjs` (fixture) | `R25_SMOKE_RED=1` breaks the W0 `setHangarOpen`→`screen` mirror in the page → (7) FAIL. | see §4a |
| `verify-r25-visuals.cjs` (fixture, satellite) | `R25_VISUALS_RED=1` moves the aeroplane 2 m between the two Classic captures → (1) FAIL. | runs at integration; on r25-w0 (2)–(4) read NOT CALIBRATED by construction |
| `verify-mobile-actions-node.mjs` (edited) | — (the legacy 9 cases are the baseline) | **11/11 PASS, 5 PENDING** (the R25 Esc/Back cases wait for A's hook; they switch on by themselves when `use-overlay-back.js` learns `screen`/`settingsOpen`) |
| `verify-import-integrity.mjs` (sanctioned parser fix) | the W0 baseline: 3 passed / 1 failed (3 errors in 2 files) | **4 passed / 0 failed** — `ecmaVersion 'latest'` parses the JSON import attribute in `lib/fly/living-regions.js`, and `scripts/r24-c-agl.js` now destructures the `agl`/`speed` it was always passed (a real ReferenceError on the probe's first frame). No other assertion changed. |

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

## §6 Open risks

- The satellite un-pin changes what every satellite harness measures (shipped
  terrain instead of R21 terrain). Justified above; E2 must not read any
  pre-R25 satellite fixture number as a like-for-like baseline.
- The finalize scaler default makes satellite fixture boots unusable for
  PACING claims (they already were — 1–3 fps). A pacing gate must set
  `FLY_FINALIZE_BUDGET_K=1` explicitly.
- `readinessInPage` is a COPY of `worldReadiness`; the self-check catches a
  renamed/added part, not a changed predicate body.

## §7 Unmeasurable here

- every fps / frame-time / tearing / stall figure (SwiftShader, shared cores);
- boot wall time as a budget (7.7 min satellite / 51 s toy are venue numbers);
- real Esri colour, real WorldCover classes, real DEM relief (the fixture is
  synthetic by construction);
- `graphics-flight.cjs`'s GPU-timer path (it refuses SwiftShader by design);
- audio unlock / AudioContext on a real device; phone GPU behaviour.

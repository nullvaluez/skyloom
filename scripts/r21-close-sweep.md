# R21 "STEADY STATE" — CLOSE SWEEP LEDGER (skeleton, authored in W1 by E CERT)

> **STATUS: SKELETON.** Every result cell reads `— (W3)` until the integrated
> tree exists. W1 fills the RED CALIBRATION section only; W2 fills the
> post-merge smoke rows; W3 fills the run matrix, the consumed-move ledger and
> the verdict. The R20 ledger (`scripts/r20-close-sweep.md`) is the shape this
> follows.

Dev server for every run: **the agent's own worktree server on its own port**
(E: `npm run dev -- -p 3124` from `.claude/worktrees/r21-e`), pointed at with
`FLY_URL`. Never `:3000` / `:3002` / `:3019` — those are user-adjacent
(R19 §4.1 deviation note).

---

## §0 What makes this sweep different from R20's

R20 certified 32 browser harnesses green and shipped a build whose FIRST live
satellite session flashed and dropped geometry. The blindness was structural,
not a missed run:

| The fleet pins | so no gate could see |
|---|---|
| `fly-map-style-2 = 'toy'` (bootFly default) | anything satellite-only, in a round whose symptoms are satellite-first |
| `__flyWeatherOverride='baseline'` | overcast/precip interactions |
| `__flyAerialOverride=0`, `__flySatShadowOverride=0` | the R19 ship-state visuals under load |
| `setQualityTier('high')` in nearly every satellite gate | every cost of a tier STEP |
| a FIXED pose, seconds long | flicker (a temporal property), the boot window, and the camera TURNING |
| `soak-fly.js` booting TOY | satellite under a live PerformanceMonitor, ever |

The four new gates + the satellite soak exist to close exactly those six rows.
**They are the reason a green R21 sweep means something a green R20 sweep did
not.**

---

## §1 RED CALIBRATION (W1 — the pre-fix tree, `r21/e` @ `e1077f8`)

Each new gate was run against the scaffolded tree with **all four R21 flags
`enabled:false`**, i.e. R20 behaviour exactly. A gate that cannot go red is a
coin (R20 lesson); these are the measured reds.

| Defect | Gate | Measured RED | Green target | Separation |
|---|---|---|---|---|
| **P4** all-or-nothing skyline lock | verify-seam (2) NO CLIFF | slope **8.8 / candidate** (39 cand → 0 kept, 44 → 44) | ≤ 4 | 2.2× |
| **P4** ramp absent | verify-seam (4) RAMP SPEC | **22 / 156 tiles** disagree | 0 | binary |
| **P4** visible tile seam | verify-seam (5) ALL-OR-NOTHING NEIGHBOURS | **14 seam pairs** (Powell: 34→0 beside 128→128) | 0 | binary |
| **P1** false frustum cull, satellite | verify-stability (7) | **1** chunk mesh of 54 | 0 | binary |
| **P1** false frustum cull, toy z10 | verify-stability (9) | **5** chunk meshes of 417 (worst drop **10 191 m**) | 0 | binary |
| **S3** tier step re-streams the ring | verify-tier-step (3) | ready/chunks floor **0.00** (16 ready → **0**) | ≥ 0.70 | total |
| **S3** skyline ring re-streams | verify-tier-step (3a) | ready/chunks floor **0.60** | ≥ 0.70 | 1.2× |
| **S4** leak across tier steps | verify-tier-step (6) | per-cycle geometry/texture floors, spread **16/16** across cycles (pre-floor metric) | floor rise ≤ 6 | — |
| **S5/S7/S8** flicker, urban | verify-flicker (2) | **p99 14.23 → 13.60** (does NOT decay) | ≤ 12 | 1.13× |
| **S5** disappear/reappear | verify-flicker (4) | **380 pixels** swinging >120 luma at Manhattan · **0** at Powell | ≤ 32/leg | 12× / control 0 |
| **S5/S7** flicker, suburb | verify-flicker (3) | **p99 1.76 → 0.81** — this is the CONTROL, and it is green | ≤ 12 | 15× headroom |
| **P8** polygonOffset sign under reversed depth | verify-flicker (5) | authored **(−2, −2)** with `reversedDepthBuffer` ON | units > 0 | binary |
| **P2/P6** heal + retry loops | verify-seam (7) | worst **2×** across 4 tile URLs in a settled 60 s — not reproduced, see §1b | ≤ 4× | — |
| **S6** parcel carpet at boot | verify-stability (12) | **0 placed** across 235 samples at 100 ms — not reproduced, see §1b | 0 | — |
| **S6/S7** boot window settles | verify-stability (13) | steps after the reveal **0.7–3.8** (reveal itself 17.2) — not reproduced | ≤ 12 | — |
| **S1** tier flap at a steady pose | verify-stability (1) | **0 steps** — cannot reproduce headless, see §1b | 0 | — |
| **S1** ladder settles under load | verify-stability (1b), 6× CPU throttle | **2 steps** (high→medium→low in 10 s), no tier re-entered | ≤ 3, no re-entry | — |

### §1a The flicker gate's control, and what it rules out

verify-flicker's two legs are each other's control, and the Powell leg is what
makes the Manhattan number mean something:

| | p99 sd (window A → B) | movingFrac | pixels swinging >120 | worst swing |
|---|---|---|---|---|
| Manhattan 900 m | **14.23 → 13.60** | 0.069 → 0.054 | **289 → 380** | **190.7** |
| Powell 900 m | 1.76 → **0.81** | 0.008 → 0.003 | **0 → 0** | 93.3 |

Same instrument, same park, same settle, same 12-frame window, real satellite
content in both. Three alternative explanations are ruled out **by
measurement**, not by argument:

1. *"That is just what a satellite frame looks like."* Powell reads 0 swinging
   pixels and p99 0.81.
2. *"It is the tail of the stream-in."* Window B is taken 20 s after window A
   and is not quieter (13.60 vs 14.23; the swinging-pixel count went UP).
3. *"It is the harbour boats and steam plumes, which are supposed to move."*
   They were parked at their owner-published handles
   (`__satVeg.ambient.boatMesh` / `.plumeMesh`) for the run above; the number
   did not move (231 → 289 across runs = run-to-run noise).

### §1b Reds this machine did NOT reproduce (recorded honestly)

Three gates did not go red on the calibration hardware, and all three are recorded
rather than quietly dropped:

- **verify-stability (1) tier flap** measured `tierSteps = 0` over the dwell,
  and **this is structural, not luck**. The R20 flap needs a VSYNC-LOCKED
  display: FlyCanvas' own comment says fps 60 sits ON `PerformanceMonitor`'s
  upper bound, so `onIncline` fires at steady state. Headless Chrome is not
  vsync-locked (this pose ran ~230 fps), so **the flap cannot reproduce in
  headless CI at any throttle rate.** The harness therefore grew a CDP
  CPU-throttled leg (1b) that asserts the thing a headless run CAN see — that
  the ladder SETTLES once it starts moving. Under 6× throttle the R20 ladder
  descended high→medium→low in 10 s and stayed: 2 steps, no tier re-entered.
  A descent, not a flap. The RED evidence for what a step COSTS comes from
  **verify-tier-step**, which forces the step (16 ready chunks → 0).
  Fable should treat "(1) passes on the pre-fix tree" as an environment fact.
- **verify-stability (12) parcel carpet** measured `placed = 0` at Powell
  across the whole boot window at 100 ms sampling. The S6 race needs
  `bs.chunks === 0` to coincide with a veg ring that has already answered; on
  this machine the building ring answered first every run. The gate stays (it
  is the exact invariant R20 froze: Powell places ZERO), and it is cheap; but
  it is NOT calibrated red, and the round record must say so. Its pixel sibling
  **(13)** is in the same position: with the pose frozen the boot window reads
  17.2 across the reveal itself and 0.7–3.8 after it, so the gate asserts on
  the post-reveal steps only and would have caught a carpet flashing, but no
  carpet flashed here.
- **verify-seam (7) unbounded re-request** measured a worst case of **2×**
  across only 4 tile URLs in a settled 60 s dwell over Powell — comfortably
  inside the `healCap + 1` bound. The R20 heal loop needs a chunk that stays
  permanently coarse, and Powell at 900 m does not produce one on this machine.
  The gate is the right assertion for B's `healCap` and it stays; it is not
  red-calibrated, and a scene that does produce a permanently-coarse chunk
  (steep DEM under sparse imagery) would be the follow-up.

### §1c The toy soak path was verified UNCHANGED, by running it

`node scripts/soak-fly.js 0.6` (no `--style`) on the edited file: identical
console line format, identical summary KEY SET (no `style` / `p95Triangles` /
`governorSteps` — they are spread in under the flag), writes
`scripts/soak-results.json` as before, prints no gate block and exits 0.
Measured 425–447 draws / 1.74–2.20 M tris at the NYC spawn, i.e. the R20 toy
profile. `scripts/soak-results.json` was then restored from git so the R20 toy
soak record is not overwritten by a 36-second smoke run.

### §1d W1 evidence, preserved

The W1 calibration artifacts are frozen under `scripts/r21-e-red-w1-*`
(`.json` per gate + the evidence PNGs) so the W2/W3 re-runs, which overwrite
`scripts/r21-e-red-*.json` and the harness screenshots, cannot erase the red
they were calibrated against.

---

### §1e INSTRUMENTS THE FIX AGENTS STILL OWE (every one currently SOFT-fails)

A gate must never crash on an instrument its owner has not landed, so each of
these prints `SOFT … instrument missing (owner X)` and does not set the exit
code. **W3 certification requires ZERO soft lines**, so this table is a
delivery list, not a wish list.

| Instrument | Owner | Gate that is blind without it |
|---|---|---|
| `window.__flyGov.force(dir)` / `.state()` | A | verify-tier-step drives the ladder through `setQualityTier` instead — which measures the REAL R20 cost, but cannot exercise A's own latch |
| `window.__flyStats.fx.rebuilds` | A | verify-stability (4) |
| **`window.__flyComposer`** (the vendored composer, dev-only) | A | verify-tier-step (4) — the composer-buffer-vs-drawing-buffer assertion, i.e. the stretched-frame defect, has NO instrument at all today. **Please publish it.** |
| `window.__flyStats.governor` | A | the satellite soak's governor block (falls back to counting store/DPR transitions) |
| per-engine `stats.emptyByReason` | B | verify-seam (8) |
| per-engine `stats.evictions` / `stats.heals` | B | verify-tier-step (3b) |
| `window.__flyStats.monuments.remerges` | C | verify-stability (5) |
| worker `api.setDiag(v)` | D | verify-seam (6b) |
| `reason` on empty worker results | D | verify-seam (6c) — measured today: ocean and empty-Owens tiles both return a bare `{empty:true}` |

---

## §2 W2 post-merge smoke (run after EACH merge, in order A → D → B → C)

| After merge | verify-stability | verify-tier-step | verify-flicker | verify-seam (node) | Notes |
|---|---|---|---|---|---|
| A GOVERNOR | — | — | — | — | expect `__flyGov` + `fx.rebuilds` to stop SOFT-failing |
| D PIPELINE | — | — | — | — | expect seam (4)/(5) to flip green; Owens (1) must stay 0 |
| B STREAMKEEPER | — | — | — | — | expect stability (7)/(9) → 0 and seam (7) bounded |
| C SURFACE | — | — | — | — | expect flicker (2)/(3)/(5) green and `monuments.remerges` present |

---

## §3 W3 RUN MATRIX

Legend — **UNPIN**: the harness un-pins `__flyGovPin` (only the R21 stability
gates and the soaks do). **MOVE**: a pre-sanctioned §5 move may touch this
gate's numbers; each consumed move needs an inline
`R21 SANCTIONED RE-BASELINE: old → new` comment plus a row in §4.

### 3.1 The four NEW gates + two soaks

| # | Gate | Result | UNPIN | Notes |
|---|---|---|---|---|
| N1 | **verify-stability** (15 gates, 4 phases) | — (W3) | yes | the round-headline gate; must be GREEN and its W1 red table cited |
| N2 | **verify-flicker** (6) | — (W3) | no (deliberate) | temporal stddev; the ladder has its own gate |
| N3 | **verify-tier-step** (9) | — (W3) | yes | forced steps; needs `__flyGov.force` + `window.__flyComposer` from A |
| N4 | **verify-seam** (node 7 + browser 3) | — (W3) | n/a / no | node leg needs no dev server |
| S1 | **soak-fly 15 min TOY** (unchanged path) | — (W3) | no | must stay green; proves the additive edit is a no-op |
| S2 | **soak-fly 15 min `--style=satellite`** | — (W3) | yes | BLOCKING: p95 tris ≤ 2.2 M · p95 draws ≤ 375 · heap floor climb < 60 MB · governor steps ≤ 4 · 0 pageerrors |

### 3.2 Satellite / streaming / worker — MUST RUN (every agent touches these)

| # | Harness | Result | MOVE | Why it must run |
|---|---|---|---|---|
| 1 | verify-sat-night (33) | — (W3) | — | B+C+D all touch the night ground path |
| 2 | verify-sat-buildings (17) | — (W3) | §5.1 | B owns the engine; per-building collision columns |
| 3 | verify-suburbia (21) | — (W3) | §5.1 | (B)/(D)/(F) counts may rise with bend margins; **(E) Owens ≤ 261 does NOT move** |
| 4 | verify-skyline (18) | — (W3) | §5.2 | D changes WHICH members render at capped/banded tiles; **Owens ready 0 frozen** |
| 5 | verify-parcel-homes (21) | — (W3) | §5.3 | C's settle gate delays first placement; **Owens ON/OFF bit-identity must hold EXACTLY** |
| 6 | verify-veg (25) | — (W3) | — | B's park-don't-clear; C's upload stagger |
| 7 | verify-roof-variety (18) | — (W3) | §5.1 | counts may move with coverage; the 1.6 M tri ceiling does not |
| 8 | verify-sat-depth (6) | — (W3) | — | **Owens ≤ 261** |
| 9 | verify-aerial (16) | — (W3) | — | **Owens ≤ 261 fully armed**; the ONE un-pinner of the R19 fleet pins |
| 10 | verify-groundlife (22) | — (W3) | — | C owns the tint + house lights; P8 lands here |
| 11 | verify-icons (49) | — (W3) | — | C owns MonumentModels; the marquee must stay +1 draw |
| 12 | verify-monuments (12) | — (W3) | — | C's per-name hysteresis |
| 13 | verify-monuments-sat (10) | — (W3) | **FROZEN** | §4 says untouched — run it, do not edit it |
| 14 | verify-round11 (13) | — (W3) | — | SatBuildingLayer consumer |
| 15 | verify-sat-mobile (10) | — (W3) | — | A's governor must not break the phone tier policy |

### 3.3 Toy / neon — MUST RUN (B's bend margins and D's worker are style-blind)

| # | Harness | Result | MOVE | Why |
|---|---|---|---|---|
| 16 | verify-neon-cover (11) | — (W3) | gate 3a mechanics | the five frozen R18 hashes. **Gate 3a recomputes the toy-path flag inventory from worker SOURCE and asserts it is exactly `{NEON_COVER, TOY_MID_SUBURB, MONUMENT_MODELS}` (verify-neon-cover.js:174).** D's `TILE_PIPELINE` references land in that same source, so 3a goes red the moment D merges and its `EXPECTED_TOY_FLAGS` + the gate-3 OFF control state must both gain `TILE_PIPELINE` (and any other R21 flag the toy path reads). That is **gate mechanics, not a hash move** — the five FNV hashes do not change. **Needs Fable sign-off (the file is outside E's W1 list).** |
| 17 | verify-neon-city (10) | — (W3) | — | toy facades/runways/beacons |
| 18 | verify-neon-alt (19) | — (W3) | §5.1 | the z10 ultra ring is where the bend margin is largest; toy ≤ 480 |
| 19 | verify-roofs (10) | — (W3) | §5.1 | toy building admission |
| 20 | verify-window-grids (8) | — (W3) | — | toy facade atlas (A's prewarm retains it) |
| 21 | verify-edge-fx (20) | — (W3) | — | world-bend consumer |
| 22 | verify-rim (5) | — (W3) | — | world-bend consumer |
| 23 | verify-airbend | — (W3) | — | world-bend consumer |
| 24 | verify-globe / verify-globe2 | — (W3) | — | curvature + tracer baseline |

### 3.4 Boot, canvas, effects — MUST RUN (A rewrites the canvas + composer)

| # | Harness | Result | Why |
|---|---|---|---|
| 25 | verify-boot (both styles) | — (W3) | **PREWARM must not lengthen the boot envelope** |
| 26 | verify-dusk (15) | — (W3) | C's duskCalm + the HDRI cross-blend; cirrus = +1 draw |
| 27 | verify-weather (28) | — (W3) | the composer pass list changes with precipitation |
| 28 | verify-tracers (6) | — (W3) | composer + style flip |
| 29 | verify-photo (10) | — (W3) | capture reads the canvas post-EffectComposer — A's fork must preserve it |
| 30 | verify-feel (13) | — (W3) | SpeedLines rides the pass list |
| 31 | verify-fleet (37) | — (W3) | count arithmetic frozen |
| 32 | verify-hangar (17) | — (W3) | assets consumer |
| 33 | verify-crash (23) | — (W3) | collision columns come from B's drape pass |

### 3.5 Gameplay / UI / camera — RUN, or DEFER with a citation

| # | Harness | Result | Decision |
|---|---|---|---|
| 34 | verify-chase-cam | — (W3) | run (verify-stability drives the same rig) |
| 35 | verify-freelook | — (W3) | run |
| 36 | verify-warp-arrival | — (W3) | run (warp grace is a governor input) |
| 37 | verify-player-nose | — (W3) | defer-able if `FlyScene.jsx` delta stays at C's three lines |
| 38 | verify-atlas | — (W3) | defer-able |
| 39 | verify-poi | — (W3) | run (letters ride the bend) |
| 40 | verify-juice / verify-spicy | — (W3) | defer-able |
| 41 | verify-contracts / living-contracts / logbook | — (W3) | defer-able |
| 42 | verify-airport-buzz | — (W3) | defer-able |
| 43 | verify-inspect-actions / fly-game | — (W3) | run verify-fly-game (canvas count + warp) |
| 44 | verify-fly-models / fly-style / fly-formation / style-retire | — (W3) | defer-able (verify-fleet covers the meshes) |
| 45 | verify-mobile / verify-mobile-layout | — (W3) | run mobile-layout if any HUD file moved |
| 46 | verify-sun | — (W3) | defer-able |
| 47 | verify-photo | see 29 | — |

### 3.6 Node gates (no browser)

| # | Gate | Result |
|---|---|---|
| 48 | verify-classify.mjs | — (W3) |
| 49 | verify-warbirds.mjs | — (W3) |
| 50 | verify-daily.mjs | — (W3) |

### 3.7 Flag-off byte-identity spot check (§4 contract)

| Check | Result |
|---|---|
| worker fingerprint scenes vs `3645af8` with all four R21 flags off (`scripts/r19-f-fingerprint.js` idiom) | — (W3) |
| per-block one-flag revert (each block off in isolation) | — (W3) |

---

## §4 CONSUMED PRE-SANCTIONED MOVES (§5 of the plan)

| # | Move | Consumed? | Measured control | Inline comment | Sign-off |
|---|---|---|---|---|---|
| 1 | P1 bend margins raise fixed-pose draw counts | — (W3) | | | |
| 2 | P3/P4 skyline member re-baselines | — (W3) | | | |
| 3 | verify-parcel-homes timing legs | — (W3) | | | |
| 4 | soak-fly satellite mode + p95 assertions | **CONSUMED (W1, E)** | additive; toy path byte-unchanged — verified by running it: same console format, same summary KEY SET, same `soak-results.json` target, exit 0, no gate block (satellite writes `soak-results-satellite.json` instead). W1 smoke, 3 min NYC leg: p50/p95 tris 761 k / 863 k, draws 223 / 242, governor steps 0, heap floor +15 MB, 0 pageerrors — **SOAK: PASS** | header block in `scripts/soak-fly.js` | Fable — pending |
| 5 | density fallback levers | — (W3, only if p95 breaches) | | | |
| 6 | `_boot.js` `__flyGovPin` + per-gate un-pins | **CONSUMED (W0 + W1, E)** | the un-pin is an accessor that swallows the fleet write; each gate reports `pin=null attempted=hold` | headers of verify-stability / verify-tier-step / soak-fly | Fable — pending |

---

## §5 FROZEN NUMBERS — the checklist that must read GREEN at close

| Frozen | Where asserted | W3 |
|---|---|---|
| Owens Valley ≤ 261 draws | sat-depth:153, aerial:463, skyline:178, suburbia (E) | — |
| satellite ≤ 375 draws | many | — |
| toy ≤ 480 draws | neon-*, roofs, window-grids, edge-fx | — |
| soak **p95** tris ≤ 2.2 M | soak-fly `--style=satellite` (NEW, blocking) | — |
| the five R18 neon-cover FNV hashes | verify-neon-cover gates 3/3a | — |
| verify-monuments-sat frozen | untouched harness | — |
| verify-suburbia (G): nothing in (25, 35) m | suburbia | — |
| `TRAFFIC_MODELS === 13`, `/models/` literals `=== 10` | verify-fleet / verify-hangar | — |
| boot envelope + `runtime.modelsReady` | verify-boot | — |
| Powell parcel homes === 0 placed (bit-identical flip) | verify-parcel-homes, verify-stability (12) | — |

---

## §6 VERDICT — (W3)

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
| **P4** all-or-nothing skyline lock | verify-seam (2) NO CLIFF | slope **8.8 / candidate** (39 cand → 0 kept, 44 → 44) | ≤ 4 | 2.2× · **CLOSED post-D: 2.5** |
| **P4** ramp absent | verify-seam (4) RAMP SPEC | **22 / 156 tiles** disagree | 0 | binary · **CLOSED post-D: 0/156** |
| **P4** visible tile seam | verify-seam (5) ALL-OR-NOTHING NEIGHBOURS | **14 seam pairs** (Powell: 34→0 beside 128→128) | 0 | binary · **CLOSED post-D: 0** |
| **P1** false frustum cull, satellite | verify-stability (7) | **1** chunk mesh of 54 | 0 | binary |
| **P1** false frustum cull, toy z10 | verify-stability (9) | **5** chunk meshes of 417 (worst drop **10 191 m**) | 0 | binary |
| **S3** tier step re-streams the ring | verify-tier-step (3) | ready/chunks floor **0.00** (16 ready → **0**) | ≥ 0.70 | total |
| **S3** skyline ring re-streams | verify-tier-step (3a) | ready/chunks floor **0.60** | ≥ 0.70 | 1.2× |
| **S4** leak across tier steps | verify-tier-step (6) | ~~spread 16/16~~ → **NOT RED-CALIBRATED**, see §2.2: the shipped floor metric reads rise 0/0 on the pre-fix tree too | floor rise ≤ 6 | none |
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
| ~~`window.__flyGov.force(dir)` / `.state()`~~ | A | **DELIVERED (W2)** |
| ~~`window.__flyStats.fx.rebuilds`~~ | A | **DELIVERED (W2)** — stability (4) is a live assertion now |
| ~~**`window.__flyComposer`**~~ | A | **DELIVERED (W2)** — tier-step (4) is a live assertion now and passes at every sample |
| ~~`window.__flyStats.governor`~~ | A | **DELIVERED (W2)** |
| ~~per-engine `stats.emptyByReason`~~ | B | **DELIVERED (W2)** — verify-seam (8) is a live assertion |
| ~~per-engine `stats.evictions` / `stats.heals` / `errorRetries`~~ | B | **DELIVERED (W2)** — verify-tier-step (3b) and the NEW verify-seam (8b)/(8c)/(8d) all live |
| **NEW ASK: per-ring `stats.bendMarginM`** | B | verify-stability (7)/(9) — see §2.7. One number per engine converts the false-cull census from a count (which cannot reach 0 by construction) into the exact invariant `dropAtCentre <= bendMarginM`. Needs a Fable ruling. |
| `window.__flyStats.monuments.remerges` | C | verify-stability (5) |
| worker `api.setDiag(v)` | D | verify-seam (6b) |
| `reason` on empty worker results | D | verify-seam (6c) — measured today: ocean and empty-Owens tiles both return a bare `{empty:true}` |

---

## §2 W2 post-merge smoke (run after EACH merge, in order A → D → B → C)

| After merge | verify-stability | verify-tier-step | verify-flicker | verify-seam (node) | Notes |
|---|---|---|---|---|---|
| **A GOVERNOR** (`7f55d12`) | **14/16**, only (7)+(9) red | **8/10**, only (3)+(3a) red | **4/6**, only (4)+(5) red | not re-run (worker untouched by A) | see §2.1 — every A-owned class flipped green, every B/C/D-owned class stayed red |
| **D PIPELINE** (`6f10795`) | **15/17**, only (7)+(9) red — identical numbers | **8/10**, only (3)+(3a) red — identical | **4/6**, only (4)+(5) red; swing count halved again | **10/10 — VERIFY: PASS** | see §2.4 — D's own gate went fully green, Owens lock held at 0, nothing D does not own moved |
| **B STREAMKEEPER** (`e2b3941`) | **15/17**, only (7)+(9) red — **but the severity collapsed ~5×, see §2.6** | **10/10 — VERIFY: PASS** | **4/6**, only (4)+(5) red; swing 73 → **49** | **13/13 — VERIFY: PASS** (gate 8 green + 3 new engine-side gates) | see §2.6. One earlier post-B attempt was **killed by a session limit and is DISCARDED** — it wrote no artifacts (`git status` clean at resume), so nothing partial entered the record; every number below is from a clean re-run against a freshly restarted server |
| **C SURFACE** (`6aabe2f`, fully integrated) | **14/17** — (7)/(9) census + **(12) went RED for the first time all round** | (not re-run post-C; C touches no engine) | **5/6 — (5) P8 GREEN**, only (4) red | (not re-run post-C) | see §2.8. `monuments.remerges` landed and is bounded (3→3 over a 45 s dwell) |

### §2.1 Post-A smoke — full per-gate result (dev server restarted on :3124 from the merged tree)

**Every instrument A owed arrived and every gate that was SOFT is now a real
assertion**: `__flyGov`, `__flyStats.fx`, `__flyComposer`, `__flyGl`,
`__flyStats.governor`, `__flyStats.prewarm`.

| Gate | W1 pre-fix | W2 post-A | Owner | Verdict |
|---|---|---|---|---|
| stability (1) tier steps at a steady pose | 0 | **0** | A | green (was never red here — headless cannot sit on the vsync bound) |
| stability (1b) ladder settles under 6× throttle | 2 steps, no re-entry | **2 steps, no re-entry** (high→medium@2 s→low@24 s) | A | green |
| stability (3) sceneRemounts | 0 | **0** | — | green |
| stability (4) composer rebuilds | **SOFT** (no instrument) | **PASS — `fx.rebuilds` 1→1** over a 45 s dwell | A | **instrument landed + green** |
| stability (6) heap GC floor | +2.74 MB/min | **−10.39 MB/min** (floors 166→160→161) | A | green |
| stability (7) satellite false culls | 1 / 54 | **1 / 54** (satRoads, drop 511 m) | **B** | **still RED — expected** |
| stability (9) toy z10 false culls | 5 / 417, worst drop 10 191 m | **5 / 417, worst drop 10 191 m** | **B** | **still RED — expected, identical numbers** |
| stability (12)/(13) boot window | 0 placed / 3.8 max step | **0 placed / 3.2 max step** | C | green (not red-calibrated) |
| tier-step (3) ready/chunks floor | 0.00 | **0.00** (49.7 % of samples < 0.7, longest run 3.0 s) | **B** | **still RED — expected** |
| tier-step (3a) skyline ready/chunks | 0.60 | **0.60** | **B** | **still RED — expected** |
| tier-step (4) composer buffer === drawing buffer | **SOFT** (no instrument) | **PASS — agreed at every sample of 3 forced cycles** | A | **instrument landed + green** |
| tier-step (5) programs flat after cycle 1 | flat (55→57) | **flat (73→73)**, prewarm baseline 72 | A | green |
| tier-step (6) memory floors do not rise | floors [231,231,231] / [190,190,190] | **[231,231,231] / [190,190,190]**, rise 0/0 | A | green — **but see §2.2** |
| tier-step (7) world never vanishes | min 214/221 | **min 216/219** | — | green |
| flicker (2) urban p99 (settled window) | 13.60 | **8.71** (window A 14.41 → B 8.71) | A+B+C | **flipped GREEN on A alone** |
| flicker (3) suburb p99 — the control | 0.81 | **0.49**, 0 swinging pixels | — | green, quieter still |
| flicker (4) pixels swinging >120 | urban **380** | urban **146**, suburb 0 | B+C | **still RED — 62 % of the flicker was A's, the rest is not** |
| flicker (5) P8 authored units | (−2, −2) | **(−2, −2)** | **C** | **still RED — expected** |

The partial-red pattern is the point: **every defect class A owns went green and
no defect class A does not own moved**, with the false-cull census returning
byte-identical numbers (5 / 417, 10 191 m) across the merge.

Two things worth flagging to the round record:

- **A's fix removed 62 % of the settled urban flicker on its own** (swinging
  pixels 380 → 146; p99 13.60 → 8.71; movingFrac 0.054 → 0.032). The composer
  was rebuilding often enough to be a visible part of symptom 1. Window A (at
  the settle) is unchanged at 14.41, so what A fixed is the STEADY-state half.
- **flicker (2) is no longer near its threshold**: 8.71 against a bound of 12,
  i.e. 3.3 of headroom before the ruling's demote-if-within-1.5 line. No
  demotion is needed unless B or C moves it back up.

### §2.2 HONEST CORRECTION to the W1 red table — tier-step (6)

W1 recorded gate (6) as red at "geometry/texture spread 16/16". That number was
measured with an EARLIER version of the gate that used the SPREAD across the
cycles; the shipped gate uses the per-cycle FLOOR, because a spread indicts the
tier-gated facade atlases and water meshes legitimately appearing and
disappearing with the tier. Recomputing the FLOOR metric from the preserved W1
trace (`scripts/r21-e-red-w1-tierstep.json`) gives **[231, 231, 231] and
[190, 190, 190] — rise 0, i.e. green on the pre-fix tree too**.

So **gate (6) as shipped is NOT red-calibrated**, and it joins the §1b list.
It is still worth keeping (a floor that rises is the only unambiguous leak
signature available without heap-snapshot tooling), but it must not be cited as
evidence that A's dispose-on-remove fix works — A's own measurements are that
evidence. This correction is recorded rather than quietly dropped because the
W1 report claimed a red it cannot support.

### §2.3 One harness defect found and fixed by the A merge

The first post-A run failed stability (7) with `samples=0 tested=-1`: an
INSTRUMENT failure, not a defect. Phase 1b (the 6× CPU throttle) ran BEFORE the
satellite orbit and drove the ladder to tier `low`, where
SatBuildingLayer / SatSkylineLayer / SatRoadLayer never mount — so the
false-cull census found no engine roots at all. Under R20's `PerformanceMonitor`
this was invisible because `onIncline` bounced the tier straight back up (the
flap itself); under A's governor the descent LATCHES and stays, exactly as
designed. **A's fix working correctly is what exposed the ordering assumption.**
Fixed in-harness: phase 1b now runs LAST on the satellite page, the orbit leg
prints the census error text when every sample fails, and a new precondition
gate (6b) asserts the census had meshes to test so this can never again read as
a product regression.

---

### §2.4 Post-D smoke — full per-gate result (dev server restarted on :3124 from `6f10795`)

**verify-seam is D's own gate and it went from three reds to `VERIFY: PASS`,
10/10.** Every P4 assertion flipped, and the frozen Owens lock did not move.

| verify-seam gate | W1 pre-fix | post-D | Verdict |
|---|---|---|---|
| (1) THE OWENS LOCK — every Owens z14 tile keeps ZERO | 0 over 30 tiles | **0 over 30 tiles** | frozen invariant HELD |
| (2) NO CLIFF (slope per candidate) | **8.8** (39→0 beside 44→44) | **2.5** (52→36 .. 54→41) | **GREEN** — and 2.5 is the ramp's own steepest true slope (2.6 at `rampHi`), so the shipped curve *is* the specified curve |
| (3) MONOTONE | ok | ok | green |
| (4) RAMP SPEC — `hatchKept === keepN(cand)` | **22/156** disagree | **0/156** disagree | **GREEN, exact** |
| (5) NO ALL-OR-NOTHING NEIGHBOURS | **14** seam pairs | **0** seam pairs | **GREEN** |
| (6) DETERMINISM | byte-identical | byte-identical (**hashes changed** — see below) | green |
| (6b) `api.setDiag` | SOFT | **PASS** | instrument landed |
| (6c) empty results carry a reason | SOFT (bare `{empty:true}`) | **PASS** — ocean `zero`, Owens-outer `zero` | instrument landed |
| (7) no unbounded re-request | 4 URLs × 2 | **0 network requests in the settled 60 s** | green — but see §2.5 |
| (8) `emptyByReason` on engine stats | SOFT | SOFT | **B**, expected |

The measured ramp reads exactly as specified across the whole observed domain:
`24→0  28→3  29→4  32→6  34→9  36→11  39→15  44→22  48→29  52→36  54→41
57→47  60→54  65→65 …` — the 39/44 cliff is gone and the curve is continuous
into the identity region at `rampHi`.

**D's shuffle changed WHICH members render, not HOW MANY.** The determinism
hashes moved (`62282ae7…` → `a4baf11f…` at Manhattan, `ffd505ae…` → `967a5925…`
at Columbus, `c24065b2…` → `5c869dd7…` at Dublin) while the kept counts at those
same tiles are **unchanged** (2215 / 408 / 130). That is precisely the §5.2
pre-sanctioned move behaving as described, and it is why the P3 capped-tile
spread probe moved a little too (span 2385×2365 m → 2423×2428 m, still 16/16
quarter cells). **Not a regression.**

Everything D does not own is byte-stable: the false-cull census returned
`1 / 54` satellite and `5 / 417` toy with the identical worst drop of
**10 191 m** for the third run in a row; tier-step still floors at
`ready/chunks 0.00` and skyline `0.60`; flicker (5) still reads authored
`(−2, −2)`.

**Flicker kept improving, and this time in the SETTLE window.** Manhattan
window A p99 **14.41 → 9.41** and swinging pixels **345 → 125** (post-A those
were unchanged at 14.41 / 345); window B 8.71 → 9.02 with swinging pixels
**146 → 73**. The settle-window half is exactly what a tile cache plus a fetch
semaphore should fix. Running total on the load-bearing swing metric:

| | pre-fix | post-A | post-D | bound |
|---|---|---|---|---|
| Manhattan pixels swinging >120 (window B) | **380** | 146 | **73** | ≤ 32 |
| Powell control | 0 | 0 | **0** | ≤ 32 |

C's `SURFACE_CALM` owns the remaining 73.

### §2.6 Post-B smoke (clean re-run after a session-limit kill; server restarted from `e2b3941`)

**verify-tier-step went 8/10 → 10/10 and verify-seam 10/10 → 13/13.** Two of my
gates needed correcting first, and both corrections are recorded below as gate
mechanics with their validation.

| Gate | pre-fix | post-A | post-D | **post-B** | Owner | Verdict |
|---|---|---|---|---|---|---|
| tier-step (3) chunk geometry survives | ready 16→**0** | 0.00 | 0.00 | **retention drop 0**, endpoints `ready=[12,16,12,16,12,16]` of `chunks=[12,16,12,16,12,16]` | B | **GREEN** |
| tier-step (3a) skyline survives | — | 0.60 | 0.60 | **retention drop 0** | B | **GREEN** |
| tier-step (3b) evictions | SOFT | SOFT | SOFT | **+12 = exactly 3 cycles × (16−12)**, heals +0 | B | **GREEN** (instrument landed) |
| seam (8) `emptyByReason` | SOFT | SOFT | SOFT | **PASS** — sb `{0,0,0}`, sky `{noData 0, zero 1, legacy 0}` | B | **GREEN** |
| seam (8b) healing bounded | — | — | — | **heals +0 / +0** over a settled 60 s (cap 3) | B | **NEW, GREEN** |
| seam (8c) settled ring does not churn | — | — | — | **evictions +0 / +0** | B | **NEW, GREEN** |
| seam (8d) no error-retry hammer | — | — | — | **errorRetries +0 / +0** | B | **NEW, GREEN** |
| flicker (4) pixels swinging >120 | **380** | 146 | 73 | **49** | C | still red (bound 32) |
| flicker (2) urban p99 | 13.60 | 8.71 | 9.02 | **6.91** (window A **3.61**) | — | green, still falling |
| stability (7)/(9) false-cull census | 1/54 · 5/417 | same | same | **2/54 · 4/417** | B | **see §2.7 — my instrument, not B** |

The attribution series the round record wants:
**swinging pixels 380 → 146 (A) → 73 (D) → 49 (B)**, Powell control 0 throughout.
Urban p99 at the SETTLE window walked 14.41 → 14.41 (A) → 9.41 (D) → **3.61** (B).

**Gate-mechanics correction 1 — tier-step (3)/(3a) now assert RETENTION, not a
ratio.** A ratio cannot express "a re-key must not destroy geometry the ring
already has", because the ring SIZE moves with the tier by design (satBuildings
16 at high / 12 at medium; satSkyline 10 / 6). A single 0.70 floor therefore
indicted the skyline for behaving exactly as specified — **one sample out of
180**, the up-step frame where `chunks` jumps to 10 before the four new ones
have streamed. The ratio-free statement is
`ready(t) >= min(chunks(t), ready(t-1))`: a shrink may drop what left the ring,
a widen may stream what just entered it, and a re-stream cannot hide.
**Validated against both preserved traces before shipping** — W1 pre-fix worst
retention drop **5** (ready 6→0 with 5 chunks still in the ring, t = 3.11 s);
post-B **0** on both rings. The old ratio is still printed as informational.

**Gate-mechanics correction 2 — tier-step (3b) budgets the ring shrink.**
"The step evicted nothing" is the wrong assertion: stepping a 16-chunk ring
down to 12 *must* evict four. The budget is now the measured coverage delta,
read off the run's own chunk counts: `CYCLES × (chunksHigh − chunksMed)`.
Measured **12 against a budget of 12** — the evictions are the ring shrink and
nothing else, with `heals` flat at 11→11 across all three cycles.

**verify-seam grew three engine-side gates (8b/8c/8d)** using B's new counters.
This is the load-bearing replacement for the two instruments that went blind:
gate (7) (D's cache — `caches.match()` is not a fetch) and B's own group-hole
fault injection (module-worker fetches are unroutable through Playwright).
Counting the loop beats counting its network shadow. Over a settled 60 s at
Powell: **heals +0, evictions +0, errorRetries +0** on both rings.

**Toy cruise draws (the round's tightest headroom), measured here:**
precondition **410**, orbit median **402**, orbit **max 425 ≤ 480**
(B measured 424). Pre-B the same pose measured median 349 / max 375, so the
bend margins cost **+53 median / +50 max** and leave **55 draws** of headroom.
That is consumed move §5.1 and it should carry a ledger row at W3.

### §2.7 stability (7)/(9) did not reach 0 — and it is MY instrument, not B's fix

The census counts meshes where three's frustum test and the bent geometry
disagree. It models the bend as a **translation of the bounding sphere**
(centre dropped by `d²·k`, same radius in both tests). B's fix instead **grows
the radius** by a computed margin. A translation test has a disagreement band
around every frustum plane whose width is proportional to the drop, so it
**cannot reach zero by construction** no matter how large the margin is — it
only moves the band inward. The count is the wrong statistic for the post-fix
world; what B's margin actually does shows up in every other number:

| | pre-fix | post-B |
|---|---|---|
| satellite: which root disagrees | **satRoads** (1) | satRoads **0**, satSkyline **0**, satBuildings 2 |
| satellite worst drop of a disagreeing mesh | **511 m** | **104 m** (4.9× smaller) |
| toy worst drop | **10 191 m** (r 27 679 — the z10 ultra chunks) | **2 398 m** (r 14 758 — z12 far ring) |
| toy: the ultra-ring class | disagreeing | **cleared** |

Arithmetic check of B's margin at the residual: `_bendPad` at z14 with
`ringM 3600–4400` yields **163–216 m** against a measured centre drop of
**104 m** — the margin comfortably covers the drop; the residual meshes are
simply sitting inside the translation band.

**Proposed W3 fix (needs a Fable ruling and one number from B):** have each
engine publish its ring's `stats.bendMarginM`, and change (7)/(9) from a count
to the exact invariant **`dropAtCentre <= bendMarginM` for every culled mesh**.
That is implementation-independent, tight, and provably red pre-fix (margin 0)
and green post-fix. Until then the honest reading is *severity collapsed ~5×,
two mesh classes cleared, count is not a valid pass/fail statistic* — the gates
should NOT be cited as evidence of a residual P1 defect.

### §2.8 Post-C smoke — C's own gates green, and ONE ESCALATION

**C's two owned gates flipped:**

| Gate | pre-fix | post-B | **post-C** | Verdict |
|---|---|---|---|---|
| flicker (5) P8 authored units | `(−2, −2)` | `(−2, −2)` | **`(−2, +2)`** with `reversedDepthBuffer` on | **GREEN** — the sign flip landed |
| stability (5) monument re-merges | SOFT | SOFT | **PASS — `remerges` 3→3** over a 45 s dwell | **GREEN** (instrument landed) |

**The swing-count series did NOT complete as predicted.** Measured post-C:
**72, 60, 80, 72** across four runs (the last three with extra actors parked).
The series therefore reads **380 → 146 (A) → 73 (D) → 49 (B) → ~72 (C)**, i.e.
it plateaued in the 49–80 band rather than falling under 32, and the post-B 49
now looks like the bottom of that band rather than a step.

FOUR controls were run to attribute the residual, and **all four came back
negative**:

| Control | Result |
|---|---|
| park SatAmbientLife boats + plumes (deliberate movers) | 49 → 72 — no effect |
| park the satellite water's shared specular material (`__satBuildings.waterMaterial`) | 60 → 80 — no effect |
| move the ground crop below the horizon (0.55 → 0.60), after the spatial report put early samples at y 497–515 | 72 → 72 — no effect; the samples simply track the new crop top, which turned out to be a scan-order artifact of the sampler |
| Bayer screen-door dither (`SAT_BLDG_FADE`) | **ruled out by probe**: `satBldgFade` reads **exactly 1.0**, stable across 6 samples at this pose — the dither is not active |

What IS established about the residual: it is ~50–80 pixels of 547 200
(**0.013 %**), spread across 9–15 of 32 grid cells (2–15 per cell, never one
contiguous block), the SAME pixels alternating on a regular period, and
**Powell measures exactly 0 under the identical instrument in every run**.

**ESCALATION — needs a Fable ruling.** I could not attribute this residual
within the W3 budget, and I will not move a threshold to make it green. Per the
R20 verify-groundlife precedent and the standing flicker ruling, the options
are (i) demote (4) to informational with a ledger row, keeping (2)/(3) and the
Powell control load-bearing, or (ii) hold the round open for a fifth control
(most promising: an A/B against the bloom pass, which no park handle currently
reaches). Recorded here rather than resolved.

### §2.9 THE CARPET REPRODUCED — S6 is real, intermittent, and load-dependent

**verify-stability (12) went red for the first time in the round, on the
integrated tree**, at exactly the moment the user reported:

```
BOOTWIN probe (220 samples @100ms, tier=high): placed max=276 at t=0.1s
  t=0.10  placed 276  anchors 35  regK 0  tris 8832  bsChunks 16  bsReady 16
  …  (276 held through t=0.70)
  t=0.81  placed 0    ← the carpet vanishes
  … 0 for the remaining 21 s
```

**276 parcel homes carpeted Powell for ~0.7 s after reveal and then
disappeared.** R20 froze Powell at EXACTLY ZERO placed homes (bit-identical
triangle totals across the flag flip), so any nonzero reading there is the S6
race and nothing else.

It is **intermittent and load-dependent**. A targeted probe (fresh browser, one
page, 50 ms sampling, two consecutive runs, 480 samples total) measured
**placed 0 throughout both runs**, with `suppressed` equal to `anchors` (28/28,
35/35) and the collision-column index already populated at the first sample
(`realCols` 720 / 731 at t = 0.05 s). In the failing stability run the same
first sample had **276 placed with the anchors NOT suppressed**.

**Diagnosis:** the ordering of "parcel layer evaluates" vs "building engine's
collision-column index is populated" decides it. In a quiet browser the columns
win; in the stability harness — where the boot-window page is the FOURTH page
of a long run, after a 45 s dwell, a 30 s orbit, a 35 s CPU-throttle leg and a
toy page — the parcel layer wins, computes `regK 0` against an empty
denominator, and carpets. That is the R20 defect's exact shape surviving inside
C's settle gate, on a path the settle gate does not cover.

**For C:** the suspect is that placement is gated on ring readiness
(`bs.chunks`/`bs.ready`, both already 16/16 at t = 0.1) but NOT on the column
index that `regK` actually divides by. Reproduction recipe: run
`verify-stability` end-to-end (the load matters — a standalone boot will not
show it), or open three loaded pages before the Powell boot.

### §2.10 W3 SANCTIONED EDITS — executed, with their red/green proofs

**(4) FLICKER DEMOTION — RULED AND EXECUTED.** A fifth control was run per the
ruling: bloom reached through `window.__flyComposer` (FX_STABILITY armed) and
its `BloomEffect.intensity` set to 0 at the fixed pose. **Negative — 59 swinging
pixels against 60–80 with bloom on.** The mechanistic prior (an emissive pixel
oscillating across bloom's luminance threshold flipping its whole footprint)
does not hold here. All five controls now stand negative:

| Control | Result |
|---|---|
| park boats + plumes | 49 → 72 no effect |
| park the water's shared specular material | 60 → 80 no effect |
| crop below the horizon (0.55 → 0.60) | 72 → 72 no effect |
| Bayer dither (`SAT_BLDG_FADE`) | ruled out — `satBldgFade` exactly 1.0, 6 samples |
| **bloom intensity → 0** | **~72 → 59 no effect** |

Gate (4) is now **INFORMATIONAL** with the five-control record inline, and a
NEW load-bearing gate **(4a) THE CONTROL HOLDS — Powell swinging pixels === 0**
takes over the assertable half. Gates (2)/(3) unchanged. Post-demotion run:
**verify-flicker VERIFY: PASS, 7/7** (urban 23 that run — the residual's own
spread is 23–80, which is exactly why it could not be a pass/fail statistic).

**(b) CENSUS REFORMULATION — EXECUTED AND PROVEN BOTH WAYS.** The five engines
now stamp `mesh.userData.bendMarginM` at the same site where they grow the
bounding sphere (`R21 SANCTIONED INSTRUMENT`, userData only — no behaviour, no
draw, no bundle change; sat-building ×3 sites, sat-road, sat-skyline,
toy-world). Gates (7)/(9) changed from a COUNT of translated-sphere
disagreements to the exact per-mesh invariant **`dropAtCentre ≤ bendMarginM`**.

| | satellite | toy |
|---|---|---|
| **RED control** (`STREAM_KEEPER.enabled:false`, margin 0) | **44 of 54** meshes short, worst shortfall **565 m** | **417 of 417** short, worst shortfall **15 802 m** |
| **GREEN** (flag restored) | **0 short, 0 unstamped** of 54 | **0 short, 0 unstamped** of 417 |

`verify-stability` → **VERIFY: PASS**. The old count is still printed as
informational (1 satellite / 5 toy) with its "cannot reach 0 by construction"
note. `fly-constants.js` was restored from git after the control — empty diff.

**(a) NEON-COVER — GATE MECHANICS + THE TWO RULED RE-BASELINES, EXECUTED.**
`TILE_PIPELINE` joins `R20_FLAGS` and `EXPECTED_TOY_FLAGS`; it is the ONLY R21
block the worker source references (measured 25 refs; STREAM_KEEPER /
SURFACE_CALM / PERF_GOVERNOR / FX_STABILITY / PREWARM all 0 — they live in the
engines, layers and canvas, which this source scan does not reach). Gate 3a now
reads `{NEON_COVER, TOY_MID_SUBURB, MONUMENT_MODELS, TILE_PIPELINE}` and passes.

The OFF-branch control run (all four toy-path flags false) then produced the
decisive 3-of-5 split, before any hash was touched:

| scene | frozen | measured | |
|---|---|---|---|
| powell-full | 33d299d9 | **33d299d9** | reproduces |
| powell-mid | 8b699579 | **8b699579** | reproduces |
| manhattan-far | 473596c0 | **473596c0** | reproduces |
| manhattan-full | 176e2e75 | **1a509f39** | **RE-BASELINED** |
| manhattan-mid | a6805b95 | **2fa4a264** | **RE-BASELINED** |

A code regression would move all five, or move them by scene; it would not
spare Powell entirely and hit one tile's two rings. Both moved values carry
`R21 SANCTIONED RE-BASELINE (upstream planet drift 20260802, controlled 3-way)`
inline. Post-edit OFF run: **5/5 reproduce**. ON run: **8/8 PASS**, toy draws
cruise 406 / powell 414 / **nyclow 459 ≤ 480**, worst tris **1.973 M ≤ 2 M**.

**(c) SKYLINE NEAR-CROP — ADJUDICATED AND DEMOTED.** Six runs on the integrated
tree (3 same-config pairs, the R20 verify-groundlife method):

| run | signal | noise | ratio |
|---|---|---|---|
| 1 | 0.467 % | 0.682 % | 0.68 ← control ≥ signal |
| 2 | 0.808 % | 0.510 % | 1.58 |
| 3 | 0.804 % | 0.321 % | 2.50 |
| 4 | 0.580 % | 0.150 % | 3.87 |
| 5 | 0.232 % | 0.571 % | 0.41 ← control ≥ signal |
| 6 | 0.342 % | 0.362 % | 0.94 ← control ≥ signal |
| **mean** | **0.539 %** | **0.433 %** | **pooled 1.24×** |

The control **exceeds** the signal in **3 of 6** runs and the pooled ratio is
**1.24×** — the same distribution, exactly the R20 groundlife signature
(pooled 1.04×). The ruling's condition is met, so the `nearNoise * 2` term is
retired and the **absolute 1.2 % ceiling becomes the whole gate**
(`R21 SANCTIONED DEMOTION` inline, with the table).

**Nothing is weakened:** all six runs measured ≤ 0.808 %, comfortably inside the
1.2 % the original author already called the real bar ("with a 7×
discriminator"), so the gate passes on exactly the evidence it always passed on
minus a term that was deciding by coin flip. Post-demotion run: near-crop
**0.164 % ≤ 1.200 %**, and the frozen halves are untouched — **Owens skyline
ready === 0** (10/10 chunks empty, all classified `zero`) and **Owens draws
184 ≤ 261**.

### §2.5 INSTRUMENT NOTE — D's tile cache made verify-seam (7) partially blind

The browser leg now counts **zero** network tile requests in the settled 60 s
window (pre-D: 4 URLs at 2× each). That is D's persistent Cache API working —
but `caches.match()` is not a fetch, so **a heal/evict loop that re-reads a
cached tile fires no Playwright request event at all.** Gate (7) therefore now
asserts only "no unbounded NETWORK hammer", which is a weaker claim than the
one it was written for.

Consequence: **B's `stats.heals` / `stats.evictions` counters (still SOFT) are
now the load-bearing instrument for P2/P6**, not gate (7). This is recorded so
W3 does not read gate (7)'s pass as proof the heal loop is fixed.

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
| 4 | verify-skyline (18) | — (W3) | §5.2 **+ a RULED coin adjudication** | D changes WHICH members render at capped/banded tiles; **Owens ready 0 frozen**. **W3 RULING (Fable, W2):** B flagged the NEAR-CROP half as a statistical coin — run 1 FAIL at signal 1.451 % vs noise 1.375 %, run 2 PASS on the *identical tree* with signal BELOW noise; flag-off measured 10.106 % vs 9.949 %, the same ratio. Adjudicate with a **6-run distribution** (the R20 verify-groundlife precedent): if control ≥ signal, **demote that half to informational** with a ledger row. The load-bearing halves (Owens ready 0, the draw ceilings, the crossfade) do not move either way. |
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
| 16 | verify-neon-cover (11) | — (W3) | gate 3/3a mechanics **+ two hash re-baselines (RULED)** | see §3.1a below — **APPROVED by Fable in W2**, to be executed in E's W3 pass |
| 17 | verify-neon-city (10) | — (W3) | — | toy facades/runways/beacons |
| 18 | verify-neon-alt (19) | — (W3) | §5.1 | the z10 ultra ring is where the bend margin is largest; toy ≤ 480 |
| 19 | verify-roofs (10) | — (W3) | §5.1 | toy building admission |
| 20 | verify-window-grids (8) | — (W3) | — | toy facade atlas (A's prewarm retains it) |
| 21 | verify-edge-fx (20) | — (W3) | — | world-bend consumer |
| 22 | verify-rim (5) | — (W3) | — | world-bend consumer |
| 23 | verify-airbend | — (W3) | — | world-bend consumer |
| 24 | verify-globe / verify-globe2 | — (W3) | — | curvature + tracer baseline |

#### §3.1a verify-neon-cover — the W3 edit, pre-approved (Fable ruling, W2)

Three separate things must happen in this file in E's W3 pass. They are
distinct and the ledger keeps them distinct.

1. **GATE MECHANICS (not a re-baseline).** Gate 3a recomputes the toy-path flag
   inventory from worker SOURCE and asserts it equals `EXPECTED_TOY_FLAGS`
   (`verify-neon-cover.js:174`). D deliberately spelled out every
   `TILE_PIPELINE` reference so 3a's attribution can see it, and it **is**
   toy-reachable (the toy tail's `'zero'` reason tag). So `TILE_PIPELINE` joins
   both `R20_FLAGS` and `EXPECTED_TOY_FLAGS`, and the gate-3 OFF control state
   must clear it along with the rest of the R21 set. Inline comment to carry:
   `R21 SANCTIONED GATE-MECHANICS`. **No hash value changes for this item.**
2. **TWO HASH RE-BASELINES (RULED).** `manhattan-full` and `manhattan-mid` were
   proven by D — with a three-way control including a pristine `e1077f8` stash —
   to be **already red on the untouched scaffolding tree**. OpenFreeMap
   published planet build `20260802_080001_pt` on the day R20 closed; the
   building layer at `14/4824/6157` still reports exactly **1481** features, so
   the drift is in another layer. Fable ruling: re-baseline both under an inline
   `R21 SANCTIONED RE-BASELINE (upstream planet drift, controlled 3-way)`.
   **The code invariant is untouched and independently proven**: flag-off
   byte-identity for identical input stands on D's fixture determinism
   (`verify-seam` (6), byte-identical across two builds of the same tile).
3. **The other three R18 hashes do NOT move** and stay frozen in §5.

**Follow-up seeded for FLY_ROUND21.md §5b (R22 candidate):** a hash gate whose
input is a LIVE tileset is a gate against someone else's release schedule. The
five R18 hashes need **pinned fixture tiles** (bytes committed to the repo, or a
pinned planet build in the URL) so an upstream publish can never present as a
code regression again. The in-process worker fixture E built this round
(`verify-seam`'s node leg) is the natural place to host them.

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
| 1 | P1 bend margins raise fixed-pose draw counts | **OBSERVED CONSUMED (W2, B)** — formal per-gate sanctioning at W3 | **toy cruise (verify-stability phase 3, FL260 NYC): median 349 → 402, max 375 → 425 ≤ 480.** +53 median / +50 max, 55 draws of headroom left. Satellite unchanged at this pose (231–234). B independently measured 424. | each gate whose number moves needs its own `R21 SANCTIONED RE-BASELINE: old → new` at W3 | Fable — W3 |
| 2 | P3/P4 skyline member re-baselines | — (W3) | | | |
| 3 | verify-parcel-homes timing legs | — (W3) | | | |
| 4 | soak-fly satellite mode + p95 assertions | **CONSUMED (W1, E)** | additive; toy path byte-unchanged — verified by running it: same console format, same summary KEY SET, same `soak-results.json` target, exit 0, no gate block (satellite writes `soak-results-satellite.json` instead). W1 smoke, 3 min NYC leg: p50/p95 tris 761 k / 863 k, draws 223 / 242, governor steps 0, heap floor +15 MB, 0 pageerrors — **SOAK: PASS** | header block in `scripts/soak-fly.js` | Fable — pending |
| 5 | density fallback levers | — (W3, only if p95 breaches) | | | |
| 6 | `_boot.js` `__flyGovPin` + per-gate un-pins | **CONSUMED (W0 + W1, E)** | the un-pin is an accessor that swallows the fleet write; each gate reports `pin=null attempted=hold` | headers of verify-stability / verify-tier-step / soak-fly | Fable — pending |
| 2b | **P3/P4 skyline member re-baseline — OBSERVED CONSUMED (W2, D)** | **CONSUMED** | D's shuffle moved the verify-seam determinism hashes at Manhattan / Columbus / Dublin (`62282ae7→a4baf11f`, `ffd505ae→967a5925`, `c24065b2→5c869dd7`) while the kept COUNTS at those tiles are unchanged (2215 / 408 / 130) — "which members", not "how many", exactly as §5.2 describes | verify-seam prints both halves every run | Fable — W2 |
| **7 (W2 ruling)** | **two R18 neon-cover hash re-baselines**: `manhattan-full` + `manhattan-mid` | **CONSUMED (W3, E)** — `176e2e75 → 1a509f39`, `a6805b95 → 2fa4a264`; the other three reproduced byte-exactly in the same run | D's three-way control incl. a pristine `e1077f8` stash proved both hashes already red on the UNTOUCHED scaffolding tree. Upstream OpenFreeMap planet build `20260802_080001_pt`; the building layer at `14/4824/6157` still reports exactly 1481 features, so the drift is in another layer. The CODE invariant (flag-off byte-identity for identical input) stands proven independently by verify-seam (6) fixture determinism | `R21 SANCTIONED RE-BASELINE (upstream planet drift, controlled 3-way)` in `verify-neon-cover.js` | **Fable, W2 — APPROVED** |
| **8 (W2 ruling)** | **`TILE_PIPELINE` into verify-neon-cover `R20_FLAGS` + `EXPECTED_TOY_FLAGS` + the gate-3 OFF control state** | **CONSUMED (W3, E)** — gate 3a reads the widened set and passes; 25 worker refs measured, the other five R21 blocks 0 | gate mechanics only, **no hash value moves**; `TILE_PIPELINE` is toy-reachable via the toy tail's `'zero'` reason tag and D spelled every reference out so gate 3a's source attribution sees it | `R21 SANCTIONED GATE-MECHANICS` | **Fable, W2 — APPROVED** |

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

# FLY ROUND 24 — "MOTION HOLD" (PLAN OF RECORD)

Branch `claude/satellite-render-glitches-kwjp4l`, scaffolded on `44ec502` (the
R22.1 × R23 merge). Five agents: **A TERRA · B STREAM · C MOTION · D
SCAFFOLD/RECORD · E CERT**, under Fable orchestration.

> **Scope in one sentence.** The user's satellite world comes apart *while they
> are flying it*; every round that tried to fix it certified a world that was
> standing still. R24 fixes the motion path and, for the first time, builds a
> gate that moves.

**Contents.** §0 the defect · §1 why four rounds missed it · §2 adjudication ·
§3 ownership · §4 the constants scaffold · §5 ships ON vs BUILT-BUT-OFF ·
§6 environment limits (read before believing any green) · §7 deferred and R25
seeds · §8 rules of engagement.

---

## §0 THE DEFECT

**User, 2026-08-15, live machine, SATELLITE style:** buildings and
shrubs/vegetation appear and disappear, the satellite ground plane itself
glitches, **worst when moving fast**. And, explicitly:

> "We've tried to solve this multiple times… approach it with knowing we've had
> regression."

That last sentence is the round's real brief. R21 "Steady State" was aimed at
this exact symptom class (S1–S8 flashing, P1–P10 patchy world). R22, R22.1 and
R23 each shipped green. The symptom is still there. So the first question this
round had to answer was not *what is broken* but **why did four rounds of
green gates fail to see it** — because any fix that does not also close that
hole will be the fifth.

---

## §1 WHY FOUR ROUNDS MISSED IT

Wave-1 D's finding, and the premise of everything below: **the fleet is blind
to this defect class by construction, not by bad luck.** Five independent
reasons, each citable:

1. **`scripts/_boot.js:86` sets `window.__flyTerraPin = 1` fleet-wide.** The
   shipped R22 terrain — z18 imagery, DEM z16, the altitude LOD curve, the
   vendored pipeline patches, the raster cache — is **OFF in roughly 30 of ~35
   harnesses and in BOTH SOAKS** (`soak-fly.js:62` un-pins only
   `__flyGovPin`). Only `verify-terra`, `verify-arrival`, `verify-settle`,
   `verify-warp-arrival` and `verify-frame-pace` ever see it.
2. **The one visual-stability gate is frozen and fully pinned.**
   `scripts/verify-flicker.js:1` is titled *"does a FROZEN scene hold still?"*
   and imports `bootFly` **without** `unpinPins` (`:83`).
3. **The one bend/cull census orbits without translating.**
   `verify-stability.js:655` is a 360° orbit at a fixed point — rotation only,
   so no ring translation, no keep-set churn, no heal-counter reset. And per
   R21's own merge note (`88587f7`), *"speed 0 = bit-identical centre"*: the
   velocity lookahead it was supposed to protect is **exactly zero** in every
   gate that asserts.
4. **That census does not include the ground.** `verify-stability.js:227-234`
   lists `satBuildings, satSkyline, satRoads, satVeg, toy` — not the terrain
   quadtree, not `SatClutter`, not `SatParcelHomes`, not `SatTintLayer`.
5. **The fleet says so itself.** `scripts/verify-terra.js:287-288`:
   > *"A 350 kt aeroplane crosses a z17 tile in under a second, so an unfrozen
   > 'settle' measures travel."*

   The author correctly identified that at speed the terrain never settles —
   and responded by freezing the aeroplane (`:289-295`).

**The invisible class, stated precisely:** *any defect whose necessary
condition is `speed > 0` on the SHIPPED R22 terrain, and whose observable is
appearance/disappearance rather than frame time, triangles, draws or heap.*
That is the entire user report. It is also the fourth recurrence of the R19
lesson — *"the harness fleet's own pins can hide an entire defect class from
every gate"* — and R22 widened the hole by adding four more pins.

---

## §2 ADJUDICATION — the five Wave-1 reports, resolved

| finding | owner | verdict | corroboration |
|---|---|---|---|
| **A-R1** frustum-driven LOD collapse: `_getDistRatio` ×5/×0.8 (a 6.25× discontinuity) meeting `_LODEvaluate`'s single-threshold, zero-hysteresis subdivide/merge test | A | **CONFIRMED ROOT** of the ground-plane glitch | = D's **T1**; explains R22.1 close-ledger **F11** and the **F10** `camTileZ` 10↔13↔18 swing |
| **A-R2** the `tileZ` contract: a merged tile makes `getGroundAt()` answer coarse, which drives the building **heal-evict** blink | A | **CONFIRMED**, large share of building blinks | = D's **T1** chain steps 2–5 (`sat-building-engine.js:957,974`) |
| **B-F-B1** ring churn: nearest-N membership with no hysteresis and hard, un-faded evicts | B | **CONFIRMED** | = D's **T2** (`sat-building-engine.js:874-893`; `SAT_BLDG_FADE` is altitude-only, `:826`) |
| **B-F-B2** the R21 lookahead broke veg/clutter coverage guarantees at speed | B | **CONFIRMED** | = D's **T2**; feature is zero in every gate (`88587f7`) |
| **B-F-B3** pooled slot allocation is unfair under a translating ring | B | **CONFIRMED** | new in Wave 1 |
| **C-M1/M2** veg/clutter run on **raw AGL** and **2 s wall-clock** cadences | C | **CONFIRMED** | R22's `SETTLE_CALM` already had to damp the same quantity for the visible ground |
| **C-M3** quilt / micro-detail grades also key off raw AGL | C | **CONFIRMED** | uniform-only fix |
| **D-T3 = B-FIX-4 = C-F6** `_commitPending` has no per-frame cap in veg + clutter | B (single fix) | **CONFIRMED**, three independent finds | R22.1 close-ledger **F3** |
| **C-M6** governor unmount + latch | — | **PENDING USER DATA** — no governor code this round | needs the `copy(__flyStats.night)` probe from the user's machine |
| **D-F14** `verify-flicker` "noise" ruling | D | **UPHELD narrow / OVERTURNED broad** — a chunk landing inside the window IS the gate's stated target (`verify-flicker.js:21-24`). **No quiescence-only repair.** E adds a **content precondition only** | — |
| **D-F10** `verify-terra` (2) "instrument" ruling | D | **UPHELD as a gate verdict, OVERTURNED as a product verdict** — `camTileZ` is the drape oracle, not telemetry | A-R2 |

Two Wave-1 theories were **refuted by their own author's arithmetic** and are
recorded so nobody re-opens them cold:

* **Bend-blind frustum culling of the terrain tile meshes.** Every precondition
  is real (unbent `BBox` at `index.js:137-140`, no `frustumCulled` override,
  no `bendMarginM` stamp, `applyBendFade` at `FlyScene.jsx:1233`) — but the LOD
  law keeps leaf size ≈ `0.93·d`, so `drop/radius = 7.6e-6 · d`: **≈4 %** at the
  low-AGL horizon and **≈17 %** at cruise, against the **39 %/89 %** R21
  measured for the toy z12/z10 rings (`toy-world-engine.js:76-78`). Not a
  primary cause. **It has still never been measured** — cheapest close is to add
  `['terrain', window.__fly.engine.object]` to `verify-stability.js:227-234`.
* **The R22 altitude-keyed `LODThreshold` modulation** (`terrain-engine.js:384-391`)
  is a genuinely new LOD → DEM → AGL → LOD feedback path, but moves T by only
  ~0.0064 (0.75 %) per 384 m elevation step. Real, low-rank, not fixed here.

**Not re-asserted, per the R22.1 charter:** the DPR-resize flash and the
cloud-billboard theories stay refuted (`scripts/r22p1-close.md` §3–§4). D
audited both refutations' logic in Wave 1 and found them sound.

---

## §3 OWNERSHIP — hard file boundaries

Policed by D in the Wave-2 adversarial diff review. A commit that touches a
file outside its owner's set is a finding, regardless of how good the change is.

| agent | owns |
|---|---|
| **A TERRA** | `lib/fly/vendor/three-tile/index.js`, `lib/fly/vendor/three-tile/VENDOR.md`, `lib/fly/terrain-engine.js`, `lib/fly/raster-cache.js`, `scripts/r24-a-*` |
| **B STREAM** | the five `lib/fly/toy-world/sat-*-engine.js`, `components/fly/SatVegLayer.jsx`, `components/fly/SatClutterLayer.jsx`, `components/fly/SatParcelHomes.jsx`, `scripts/r24-b-*` |
| **C MOTION** | `lib/fly/settle.js`, `components/fly/FlyScene.jsx`, `scripts/r24-c-*` |
| **E CERT** | `scripts/_world-precondition.js`, `scripts/verify-motion-hold.js`, `scripts/verify-flicker.js` (**precondition only** — no bound moves, no leg deletions) |
| **D** | `lib/fly/fly-constants.js` (the R24 scaffold region), all round docs, `CLAUDE.md` |

`lib/fly/fly-constants.js` is **D's file**. Owners tune values **inside their
own block only**; nobody adds a block, renames a key, or edits another owner's
block. When staging it, confirm `git diff -- lib/fly/fly-constants.js` shows
only your intended region — otherwise wait and retry.

---

## §4 THE CONSTANTS SCAFFOLD (landed)

Six blocks appended after the `FLASH_GUARD` / `NIGHT_*` blocks, each with an
inline derivation citing the defect it closes. Module import-verified
(`TILE_HOLD` / `RING_HOLD` / `LEAD_SAFE` / `POOL_FAIR` / `COMMIT_BUDGET` /
`MOTION_R24` all resolve; 114 exports total, no collisions).

| block | owner | closes |
|---|---|---|
| `TILE_HOLD` | A | A-R1 / A-R2 — merge dwell, frustum penalty as a constant, LOD hysteresis lever, raster timeout/retry/backoff |
| `RING_HOLD` | B | B-F-B1 — keep-set rank hysteresis + minimum residency |
| `LEAD_SAFE` | B | B-F-B2 — per-engine absolute metre cap on the velocity lookahead |
| `POOL_FAIR` | B | B-F-B3 — fair-share pooled slot allocation |
| `COMMIT_BUDGET` | B | F3 / D-T3 / C-F6 — the missing `finalizePerFrame` in veg + clutter |
| `MOTION_R24` | C | C-M1/M2/M3 — AGL truth, damped grades, plus three built-but-off levers |

---

## §5 WHAT SHIPS ON, AND WHAT SHIPS BUILT-BUT-OFF

### Ships ON

`TILE_HOLD` (dwell + raster retry), `RING_HOLD`, `LEAD_SAFE`, `POOL_FAIR`,
`COMMIT_BUDGET`, `MOTION_R24.aglTruth`, `MOTION_R24.grades`.

Each is one-flag revertible and each flag-off path must be the **verbatim prior
expression** — the R22 byte-noop discipline, enforced in review.

### Ships BUILT-BUT-OFF, and the reason for each

The precedent is R22's `DEPTH_PASS`: fully built, fully measured, shipped
`false` pending a user checkpoint rather than flipped on an argument. Four
levers take that route.

| lever | why it does not ship armed |
|---|---|
| `TILE_HOLD.lodHysteresis` (1.0 = identity) | Splitting the subdivide/merge thresholds is the *structural* fix for A-R1, but it changes steady-state tessellation everywhere, including at the frozen poses every draw ceiling is written against (Owens ≤ 261). Dwell alone removes the churn without moving a resident-tile count. **One mechanism per round.** |
| `TILE_HOLD.frustumPenalty` (5 = upstream) | Extracted from a literal so it can be swept; **not swept this round**. A sweep needs a live GPU and real tiles — see §6. |
| `MOTION_R24.elevGate` | Refusing to commit an elevation from a shallow tile is right in principle and is the R19 Owens class of mistake in practice: over genuinely coarse coverage it refuses forever. Needs a controlled pose pair, which this environment cannot fly. |
| `MOTION_R24.elevSlew` | A slew that is too slow reads as the aircraft sinking into terrain — a worse symptom than the one it fixes. Ships off until the rate is measured against a real descent. |
| `MOTION_R24.paceBySpeed` | The honest fix for "a 2 s cadence is a 500 m cadence at 250 m/s" — and it raises worker load exactly when the loader is most saturated. **It does not ship on an argument.** |

### Explicitly NOT in this round

* **No governor changes.** C-M6 (unmount + latch) is **pending the user's
  `copy(__flyStats.night)` probe**. Touching the governor before that data
  arrives would make the probe unreadable.
* **No cache-key or shader-text moves.** The five R18 hashes and the R19/R20/R23
  bend keys stay frozen. This is why B's death fade is deferred (§7).
* **No frozen assertion numbers moved.** A red gets a control, never a new bound.

---

## §6 ENVIRONMENT LIMITS — read this before believing any green

E established that **this cloud environment cannot browser-certify this round**,
and the round is planned around that fact rather than in spite of it.

1. **No GPU.** The browser falls back to SwiftShader at roughly **1 fps**. Every
   timing statistic in the fleet is meaningless here, and so is any gate whose
   settle is expressed in frames.
2. **Tile hosts are blocked.** Esri imagery/DEM and OpenFreeMap return **403**
   (the same block R23 recorded — `scripts/r23-close-sweep.md` §2). No pixel
   claim about satellite content is measurable in this environment. Any harness
   that needs real tiles must report a third outcome, not a false green.
3. **The dt clamp makes "fast" impossible.** The flight integrator clamps
   per-frame `dt`; at ~1 fps that clamp is the entire per-frame advance, so
   commanding boost yields an effective ground speed of about **1 km/min**
   (≈17 m/s) against the ~250 m/s the defect needs. **A "fast flight" harness
   run in this environment is a slow flight harness.** The user's condition
   cannot be reproduced here at all.

**Therefore, mandatory for every gate this round:**

* a **third outcome** — `VERIFY: BLOCKED` — with the precondition that failed
  named in the output (E's `scripts/_world-precondition.js` is the shared
  instrument, the R23 `verify-night-alive` idiom);
* **RED calibration recorded as predicted-pending-egress**, never as measured.
  A gate that has not been proven able to fail certifies nothing, and in this
  environment that proof cannot be taken — so it is written down as owed, not
  quietly skipped;
* thresholds derived from archive/source facts are labelled **PROVISIONAL**.

**The certification verdict for R24 will therefore be a SOURCE + REASONING
verdict with a named re-run list, not a measured green.** The re-run list is in
`FLY_ROUND24.md` §Checkpoints and its headline is: nothing in this round is
confirmed until it is flown on the user's own machine.

---

## §7 DEFERRED, AND R25 SEEDS

Named here so none of them can later be lost to "it was mentioned somewhere".

| # | item | why deferred / what closes it |
|---|---|---|
| D1 | **Chunk death fade (B).** Fade an evicting chunk out instead of dropping it. | Needs a shader term on streamed materials ⇒ a cache-key move, which this round forbids. `RING_HOLD` cuts the event *rate*; the fade removes the event's *visibility*. **R25.** |
| D2 | **`TILE_HOLD.frustumPenalty` sweep.** | Needs a live GPU and real tiles (§6). Constant is extracted and ready. |
| D3 | **`TILE_HOLD.lodHysteresis` arming.** | One mechanism per round; arming it moves steady-state tessellation against frozen draw ceilings. |
| D4 | **B-F-B7 skyline corner loss.** | Real, separate from the motion path, and behind `verify-skyline`'s frozen probes. Own round. |
| D5 | **C-M6 governor unmount + latch.** | **Pending the user's `copy(__flyStats.night)` probe.** No governor code until that data lands. |
| D6 | **A-R6 style-flip bend window.** | A transient at satellite↔toy hot-swap; not the user's reported symptom and not reachable at speed. |
| D7 | **A THIRD unguarded zero-area site: satellite water.** `sat-building-engine.js:727` — `wgeo.setIndex(new BufferAttribute(water.idx, 1))` with **no** `dropDegenerateTris`, in the very file `FLASH_GUARD` lives in, built by the same worker from the same `loadGeometry()` rings that close with a clone of `ring[0]`. Joins R22.1 **F1**'s two known sites (`vector-tile.worker.js:3106` sat skyline, `:4579` toy/Neon). | Census each site, then port the engine-side area filter or add a worker-side ring guard (`WORKER_PROTOCOL` territory, own certification surface). **R25 seed.** |
| D8 | **Terrain root in the false-cull census.** Add `['terrain', window.__fly.engine.object]` to `verify-stability.js:227-234` and read the number — settles the §2 refuted-but-unmeasured tile-bend question in one run. |
| D9 | **F15 load-decided gates.** Four instruments are known to flip on a busy box (terra 2, flicker 2, weather rim, A's §6.6 contention reds); nobody has counted how many more. |
| D10 | **F16 the wide fleet.** ~35 harnesses were not run for R22.1 and have not been run on the merged `44ec502` tree either. |

---

## §8 RULES OF ENGAGEMENT

1. **Flag-off is byte-noop.** Every patched site's disabled path is the verbatim
   prior expression. Vendored patches carry a **VENDOR.md ledger row** (#6, #7)
   with the OFF-equals-upstream statement, per the R22 W0 convention.
2. **No cache-key moves, no GLSL text changes, no frozen assertion edits.**
3. **Own your files** (§3). Explicit-path staging only — never `git add -A`.
   On `index.lock` contention, wait 5–15 s and retry.
4. **A red gets one quiet re-run and then a CONTROL** — never a new bound.
5. **Name what you did not run.** An argument is not a green (R22.1 §7.2 F16).
6. **Measure the trigger before you build the plan's fix** (R19 §7). Where the
   measurement is impossible here, ship the lever OFF and say so (§5, §6).

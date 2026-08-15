# FLY ROUND 24 — "MOTION HOLD" (THE RECORD)

Branch `claude/satellite-render-glitches-kwjp4l`, scaffolded on `44ec502`
(the R22.1 × R23 merge), closed at `de2bf04`+. Five agents — **A TERRA ·
B STREAM · C MOTION · D SCAFFOLD/REVIEW/RECORD · E CERT** — under Fable
orchestration. Plan of record: [FLY_ROUND24_PLAN.md](FLY_ROUND24_PLAN.md).
Per-commit ledger: [`scripts/r24-close.md`](scripts/r24-close.md).

> ## VERDICT UP FRONT
>
> **R24 is BUILT and NODE-CERTIFIED. It is BROWSER-UNCERTIFIED, and not
> because anybody ran out of time — because this environment is provably
> incapable of running the measurement.** No GPU (SwiftShader ~1 fps), both
> tile hosts 403, and a per-frame `dt` clamp that turns commanded boost into
> ~1 km/min of ground speed against the ~250 m/s the defect needs. Every
> browser gate this round ships with a third outcome, `VERIFY: BLOCKED`, and
> every RED calibration is recorded as **predicted-pending-egress** rather
> than claimed. **The user's machine is the closing test.** §4 and §6.

**Contents.** §0 what closed · §1 the defect and the four-round blindness ·
§2 findings ledger · §3 fix table · §4 certification, honestly · §5 the close
(review findings + three new ledger items) · §6 **USER CHECKPOINTS** ·
§7 deferred / R25 seeds · §8 lessons.

---

## §0 WHAT CLOSED

The user's 2026-08-15 report — *"buildings and shrubs/vegetation appear and
disappear, the satellite ground plane itself glitches, worst when moving
fast"*, with *"we've tried to solve this multiple times"* — now has a named,
source-confirmed root cause in each of its three parts, and a fix against each.

| symptom | root cause | fix |
|---|---|---|
| the ground plane glitches | **frustum-driven LOD collapse** — `_getDistRatio`'s ×5/×0.8 (a 6.25× discontinuity) meeting a `_LODEvaluate` with **zero hysteresis**, so essentially every subdivided tile that leaves the frustum is **destroyed** | `TILE_HOLD` — a 2 s merge dwell (A, vendored #6a) |
| buildings appear/disappear | the same collapse driving `getGroundAt().tileZ` down, which flips chunks `coarse` and fires the **heal-evict** path; plus **hysteresis-free nearest-N ring churn** with no fade | `TILE_HOLD` + `RING_HOLD` (B) |
| shrubs/vegetation appear/disappear | R21's **velocity lookahead** walking the short rings off the player at speed, breaking coverage guarantees two rounds had written down as prose; plus uncapped `_commitPending` landing many arrivals on one frame | `LEAD_SAFE` + `COMMIT_BUDGET` + `POOL_FAIR` (B), `MOTION_R24.aglTruth/grades` (C) |

**And one candidate that outranks all of them is not fixed, deliberately:**
a quality-ladder **tier step unmounts the entire satellite content stack**
(§2, C-P1). It needs one console read from the user before a line of governor
code is written. That read is §6 item 1.

---

## §1 THE DEFECT, AND WHY FOUR ROUNDS MISSED IT

R21 "Steady State" was aimed at this exact symptom class. R22, R22.1 and R23
each shipped green. The symptom survived all four. The reason is structural
and is set out in full in [FLY_ROUND24_PLAN.md](FLY_ROUND24_PLAN.md) §1; the
five load-bearing citations:

1. `scripts/_boot.js:86` pins `__flyTerraPin = 1` **fleet-wide** — the shipped
   R22 terrain is OFF in ~30 of ~35 harnesses **and in both soaks**
   (`soak-fly.js:62` un-pins only `__flyGovPin`).
2. `scripts/verify-flicker.js:1` — *"does a FROZEN scene hold still?"* — never
   un-pins anything.
3. `verify-stability.js:655` orbits **without translating**, so per R21's own
   merge note (`88587f7`) *"speed 0 = bit-identical centre"*: the velocity
   lookahead is **exactly zero** in every gate that asserts.
4. The false-cull census (`verify-stability.js:227-234`) covers five actor
   roots and **not** the terrain quadtree, `SatClutter`, `SatParcelHomes` or
   `SatTintLayer`.
5. `scripts/verify-terra.js:287` states the problem and then does the opposite
   of acting on it: *"A 350 kt aeroplane crosses a z17 tile in under a second,
   so an unfrozen 'settle' measures travel"* — and freezes the aeroplane.

**The invisible class:** any defect needing `speed > 0` on the **shipped** R22
terrain whose observable is appearance/disappearance rather than frame time,
triangles, draws or heap. That is the whole user report. Fourth recurrence of
the R19 lesson; R22 widened the hole by adding four more pins.

---

## §2 FINDINGS LEDGER

| # | finding | owner | status |
|---|---|---|---|
| **A-R1** | `_getDistRatio` ×5 out-of-frustum vs ×0.8 in — a 6.25× discontinuity — meeting `_LODEvaluate`'s single-threshold subdivide/merge test (`index.js:265,276`). A tile that subdivided had `d/s ≤ 1.075`; out of frustum its ratio is `5·d/s`, clearing 0.86 for any `d/s > 0.172`. **Essentially every subdivided tile that leaves the frustum is merged**, and `_removeSubTiles` → `unloadSubTiles` **disposes every fine descendant**. The gap is a constant `log2(5/0.8) = 2.64` zoom levels. | A | **FIXED** (#6a dwell); #6b/#6c built at identity |
| **A-R2** | A merged tile makes `getGroundAt().tileZ` answer coarse — and that value is what **five streamed-actor engines gate their drape on**. This is the mechanism behind R22.1 **F11** and behind the **F10** `camTileZ` 10↔13↔18 swing that was ruled an instrument. | A / D | **FIXED** upstream by #6a |
| **A-R3** | Three async tile methods have their promises **discarded** by `LOD()`, and `TileLoader.update` has a `try/finally` with no `catch`: one rejection permanently damages the tree (a node that can never refine again, or a subtree stuck `"loading"` forever). | A | **FIXED** (#7) |
| **A-R4** | A failed raster tile gets a 20 %-opacity black material with no reason code, no retry, no telemetry, and keeps it until the LOD collapses it. | A | **FIXED** (#8 + `TILE_HOLD.raster`) |
| **B-F-B1** | Nearest-N ring membership with **no hysteresis and no fade**: `sort → slice → evict` the same frame. Always more candidates than slots (21 for a 16-slot ring, 15 for 9, 8 for 6, 32 for 16), so boundary chunks oscillate; an eviction is a `geometry.dispose()` and the way back is a worker round-trip plus a re-drape. `SAT_BLDG_FADE` cannot help — it is wired only to the **altitude** cull. | B | **FIXED** (`RING_HOLD`) |
| **B-F-B2** | R21's lookahead offsets each ring centre by `min(speed × 2.5 s, 0.35 × ringR)`. Exact bisection (17×17 positions × 72 bearings): **SAT_VEG guarantee 2417 → 1164 u against a `distFade.endM` of 2400**; **CLUTTER 2885 → 1646 against a max `rangeM` of 2200**. Behind a fast aircraft, canopies and moving cars were cut by a **missing chunk at full scale** — a hard pop with no fade, proportional to speed. | B | **FIXED** (`LEAD_SAFE`) |
| **B-F-B3** | Pooled instancers consumed their budget `nearest()`-first with no per-chunk share, so the cut's **frontier moves** and a pool re-shuffles wholesale as the ring translates. SAT_VEG solved this in R18 and wrote the rule down; R20's `PARCEL_HOMES` and R22's `CLUTTER` never inherited it. | B | **FIXED** (`POOL_FAIR`) |
| **F3 / D-T3 / C-F6** | `SatVegEngine._commitPending` and `SatClutterEngine._commitPending` were the only streaming engines with **no per-frame finalize cap** — four chunks could flip `ready` in one frame and force every downstream pooled layer's signature to change on the same tick. Found independently three times. | B | **FIXED** (`COMMIT_BUDGET`) |
| **C-M1/M2** | Veg and clutter read a **raw AGL** that R22's own `SETTLE_CALM` had already had to damp for the visible ground (~384 → ≤4 m/frame). | C | **FIXED** (`aglTruth`) |
| **C-M3** | `SAT_QUILT` and `HILLSHADE.micro` — the two **ground-plane grades** — keyed off raw AGL too, so a DEM refinement step re-graded the whole frame. Uniform writes only, no shader text, no cache key. | C | **FIXED** (`grades`) |
| **C-P1** | ⚠️ **A quality-ladder TIER step UNMOUNTS the entire satellite content stack.** `SatBuildingLayer` (with `SatVegLayer` mounted inside it), `SatRoadLayer`, `SatSkylineLayer`, `SatClutterLayer` and `PrecipLayer` are all gated `qualityTier !== 'low'` in `FlyScene`, and `PERF_GOVERNOR.latchWindowSec` can make the step **permanent for the session**. The whole fleet is pinned blind to it (`__flyGovPin = 'hold'`). R23 shipped the telemetry for exactly this and **nobody has ever read it on the user's hardware**. | C | **NOT FIXED — PENDING USER DATA.** §6 item 1 |
| **D-F10** | `verify-terra` (2) "instrument" ruling | D | **UPHELD as a gate verdict, OVERTURNED as a product verdict** — `camTileZ` is the drape oracle, not telemetry (A-R2) |
| **D-F14** | `verify-flicker` (2) "noise" ruling | D | **narrow claim UPHELD, broad claim OVERTURNED.** No quiescence repair; the streaming leg became its own gate (E) |
| **E-1** | Under the 403 blockade, `verify-flicker` **passed (1)–(5) on an empty world** — `sb/sky/veg/parcel/lights` all zero, urban p99 **0.287 against a bound of 12**, green by a factor of 42 on a blank grey field. | E | **FIXED** (world-content precondition) |

**Refuted by their own author's arithmetic, recorded so nobody re-opens them
cold:** bend-blind culling of the *terrain tile meshes* (all preconditions
real, but the LOD law keeps `drop/radius` at ~4 % low and ~17 % at cruise
against the 39 %/89 % R21 measured for the toy rings — **still unmeasured**;
the cheap close is D8 in §7), and the R22 altitude LOD-curve modulation (a
real new feedback path, ~0.75 % of threshold per 384 m step). The R22.1
DPR-resize and cloud-billboard refutations were **not** re-opened.

---

## §3 THE FIX TABLE

### Ships ON

| block | owner | flag-off |
|---|---|---|
| `TILE_HOLD` (dwell + raster retry/timeout/backoff) | A | vendored #6a at `0` = upstream line verbatim; `unlockOnReject`/`rasterMark` off = re-throw / no `userData` |
| `RING_HOLD` (rank hysteresis + minimum residency) | B | `enabled:false` ⇒ `slice(0, maxChunks)` and the unguarded evict, verbatim |
| `LEAD_SAFE` (per-engine absolute lead cap) | B | `leadCapM` returns `maxLeadFrac × ringR`, i.e. the R21 line |
| `POOL_FAIR` (fair-share pooled slots) | B | `fairShare` returns the whole pool |
| `COMMIT_BUDGET` (`finalizePerFrame: 1`) | B | budget `Infinity` ⇒ the pre-R24 loop |
| `MOTION_R24.aglTruth` + `.grades` | C | `eyeAglVis === eyeAgl`; `groundElevVisStep` reduces to the pre-R24 expression **byte-for-byte** |

### Ships BUILT-BUT-OFF (the `DEPTH_PASS` precedent)

`TILE_HOLD.lodHysteresis` (1.0 = identity — it moves the settled tree at every
frozen pose, so arming it is a measured decision), `TILE_HOLD.frustumPenalty`
(5 = upstream — extracted so it can be swept; **the sweep must be graded on
`verify-aerial`'s texture-bytes gate, not on draws, because out-of-frustum
tiles issue zero draws**), `MOTION_R24.elevGate`, `.elevSlew`, `.paceBySpeed`.
Each carries its own reason at its own definition.

### Not in this round

**No governor changes** (C-P1 pending user data). **No cache-key or
shader-text moves** — `world-bend.js`, `night-city.js`, `prewarm.js`,
`SatBuildingLayer.jsx` and `SatRoadLayer.jsx` have **zero diff**; FLASH_GUARD
and both R23 night paths are untouched. **No frozen assertion number moved,
anywhere, by anyone.**

---

## §4 CERTIFICATION — WHAT IS GREEN, AND WHAT THAT GREEN IS WORTH

### 4.1 Green

| claim | evidence |
|---|---|
| the tree builds | `npm run build` **clean, 8.4 s** on `908187a` |
| B's streaming logic is correct in isolation | `verify-ringhold` **14/14**, red-calibrated |
| C's motion helpers are correct in isolation | `r24-c-motion-unit.mjs` **32/32** |
| A's vendored patches behave as specified against the real `Tile` class | `r24-a-unit.js` **29/29** |
| the review fixes moved nothing | all three suites re-run post-fix, **no assertion moved** |
| flag-off is byte-noop | verified by D **against the pre-R24 source**, not against the comments — every patched site's disabled path is the verbatim prior expression |

### 4.2 What that green is NOT

**It is a NODE certification of logic, not a BROWSER certification of
behaviour.** E established that this environment cannot produce the
measurement, and the round is planned around that rather than in spite of it:

1. **No GPU** — SwiftShader at ~1 fps. Every timing statistic is meaningless
   here, and so is any settle expressed in frames.
2. **Both tile hosts 403** — Esri and OpenFreeMap, the same blockade R23
   recorded. No pixel claim about satellite content is measurable.
3. **The `dt` clamp makes "fast" impossible** — at ~1 fps the per-frame clamp
   *is* the whole advance, so commanded boost yields ~**1 km/min** (≈17 m/s)
   against the ~250 m/s the defect needs. **A "fast flight" harness run in
   this environment is a slow flight harness.**

Consequently: every browser gate ships with `VERIFY: BLOCKED` (exit 2) and a
named precondition; every RED calibration is **predicted-pending-egress**;
every absolute threshold in `verify-motion-hold` is **PROVISIONAL** and is
re-frozen in one paste by the `SUGGEST` block the gate prints — **and that
re-freeze must be recorded as a threshold move, not as a measurement.**

> **A close sweep must read exit 2 as NOT RUN — never as green, never as a
> product red.**

---

## §5 THE CLOSE — REVIEW FINDINGS AND THREE NEW LEDGER ITEMS

D's adversarial diff review of `6fafa5a..HEAD` found **no blockers** and six
MINOR findings; all six were resolved before the push (`908187a` B, `164a4dd`
C, `aae855b` E, `de2bf04` D). Ownership held: **no file crossed an owner's
boundary.** Three items from the close are worth carrying by name.

### (a) B1 was a real behavioural defect that B's own simulator could not catch — and the gate that would have caught it is in the un-run fleet

`RING_HOLD`'s `if (held.has(key)) continue;` sat **above** the water-cap test.
`_waterKeys` is a subset of `kept` and `held` is disjoint from `keep`, so a
held key was *always* outside the water set and *always* skipped the test that
would have shed it — up to `keepHysteresis` extra glint meshes past
`SAT_WATER.maxWaterChunks`, a bound R19 made explicit **in both directions**
after `verify-roof-variety` caught a `waterReady` breach at 14.

The instrument that would have caught it is **`verify-roof-variety`'s
`waterReady`** — which sits in the ~35-harness set R22.1 named as **F16** and
which has still not been run, on this tree or on `44ec502`. **F16 is now
implicated in a real defect rather than a hypothetical one.** Name it that way
in R25.

### (b) B1's fix needed the shed-and-backfill shape — the half-fix hazard

Moving one line would have been wrong, and the reason generalises. The R19
evict path can shed water freely **because the chunk is destroyed** and picks
water up again from the rebuild's finalize. **A held chunk is never rebuilt**
— it is already `'ready'`, so `_pumpQueue` skips it on re-admission — so a
bare `_evictWater` would have removed the glint **for the life of the record**,
trading a bounded draw breach for a permanent visual hole. The fix therefore
uses the same three lines `setWaterEnabled` uses: `_evictWater` +
`waterAsked = false` + arm the R21 S4 backfill, guarded on `chunk.water` so a
chunk that never had a glint arms nothing.

> **Lesson.** When a new hold keeps an object alive past a cleanup path, check
> what the cleanup path *relied on happening next*. A fix that satisfies the
> bound and skips the restore has traded a measurable breach for an invisible
> one.

### (c) C's guard verification — instrument honesty in the cheap direction

D's C1 finding was that the `_motionTrace` header claimed the channel is
compiled out of production, which held for eleven writes and not for the two
at the `SAT_QUILT` grade. C's response was to **make the claim true** rather
than soften it (both writes now carry the publish site's own predicate) — and,
in verifying it, C found that the **line-proximity grep used to check guard
coverage had mislabelled eight of the eleven**, and replaced it with an **AST
walk** confirming 12 of 12 `_motionTrace` writes are enclosed by an
`IfStatement` whose test contains `NODE_ENV`, **before any claim shipped**.

> **Lesson.** This round's expensive instrument failures were caught by
> re-reading measurements. This one was caught by not trusting a grep for a
> question about scope — the cheapest possible version of the same discipline,
> and the one most worth making a habit.

### 5.1 Also recorded

* **Probe-attribution collision.** A's `r24-a-churn.js`, `r24-a-f11.js` and
  `r24-a-turnback.js` were added by **C's commit `da60841`** through the shared
  index. Tree content is correct and the files are A's by ownership; only the
  commit attribution is off. A shared-index artifact, not a violation.
* **E's water-path runtime caveat** is added to the egress re-run list (§6):
  B1's shed-and-backfill path has been reasoned and unit-checked but never
  exercised against a streaming world.
* **The clutter block's `2446` comment is wrong and is R25's, not this
  round's.** `CLUTTER.ring.z` is **13** (span 4892), but
  `fly-constants.js:5037` states its guarantee as `2446` — which is the **z14**
  tile span quoted at `:3025`. The prose **understates its own ring's
  guarantee by half a tile**; the discrepancy is conservative-direction
  (nothing sized against 2446 was ever unsafe) and B's cap was bisected
  against the corrected geometry, not the prose. Fixing the comment touches
  another owner's block.

---

## §6 USER CHECKPOINTS — ALL PENDING

### 1. ⭐ HEADLINE: THIRTY SECONDS, NO CODE, DO THIS FIRST

This is the single highest-value measurement in R24 and it needs no file. A
tier step unmounts the entire satellite content stack, and the latch can make
it permanent for the session — **R23 shipped the telemetry for exactly this
and nobody has ever read it on your hardware.** Verbatim
(`scripts/r24-c-agl.js:80-105`):

>   1. Boot the app in **SATELLITE**. Do not open the pause menu; do not warp.
>   2. Fly normally for **10+ minutes**, INCLUDING the fast low passes that
>      produce the defect.
>   3. Open the browser console and run: **`copy(__flyStats.night)`**
>   4. Paste the result.
>
> **HOW TO READ IT:**
>
> | reading | meaning |
> |---|---|
> | `govTierSteps >= 1` | the tier ladder moved. Buildings and vegetation disappeared because the **LAYER UNMOUNTED**. If `govLatched` is also true they are **gone for the rest of the session and will not return.** |
> | `govTierSteps 0`, `govDprSteps >= 1` | the ladder is doing its job on the cheap rung; the governor is **not** the defect. Go to P2. |
> | both 0 and `tier 'high'` | the governor never moved. The governor hypothesis is **REFUTED for this machine**, and M1/M2/M3 — the AGL-truth work this round shipped — carry the whole explanation. |

**R24 ships no governor code change. This probe is why.**

### 2. Does the world hold now?

Fly the same fast low passes that produced the report. Three separate
questions, and please answer them separately — they have different owners:
**(a)** does the **ground plane** still glitch (A's dwell)? **(b)** do
**buildings** still blink (A + B)? **(c)** do **shrubs/trees/cars** still
appear and disappear (B's lead caps + C's AGL truth)?

One-flag A/B without a rebuild, in the console:
`__flyRingHold = 0` / `__flyLeadSafe = 0` force B's work OFF;
`= 1` forces it ON; `delete` restores the constant.
`__flyMotion.set('grades', 0)` does the same for C's.

### 3. Taste

The three built-but-off levers are yours to try:
`MOTION_R24.elevSlew.enabled = true` (does the aircraft read as *sinking* into
terrain? then the slew is too slow), `.elevGate` (does anything refuse to
appear over coarse coverage?), `.paceBySpeed` (does the world keep up better,
and does anything get *worse* under load?). Also carried and still open:
`NIGHT_CITY_R23` (R23 §6.4), `DEPTH_PASS`/`__flyDepthArm`, quilt/tree/car/
warp-hold taste (R22 §6).

### 4. The ordered egress re-run list

For the first machine with a GPU and tile-host egress. **In this order** —
each step's output is the next step's input:

| # | run | why this order |
|---|---|---|
| 1 | `verify-motion-hold` with **each RED lever separately** | prove the gate can fail before believing it passes; the levers are listed in its header table |
| 2 | read the printed **`SUGGEST`** block, re-freeze the PROVISIONAL bounds | **record it as a threshold move, not as a measurement** |
| 3 | `verify-motion-hold` **armed** (the shipped configuration) | the round's verdict-bearing run |
| 4 | `verify-flicker` | now that it refuses to grade an empty world |
| 5 | the **R22.1 trio** — flash-guard / frame-pace / step-clean | never run on `44ec502`, let alone on this tree |
| 6 | the **wide fleet** (~35 harnesses, F16) — **`verify-roof-variety` first** | §5(a): its `waterReady` gate is the one that would have caught B1 |
| 7 | A's churn probes (P1/P2/P3) and B's `P-B1`/`P-B2` | curves, not verdicts — they choose the dwell and penalty values |

Plus the standing environment ask: allowing egress to
`server.arcgisonline.com` and `tiles.openfreemap.org` in the cloud
environment's network policy would let future rounds certify in the cloud
instead of on your machine.

---

## §7 DEFERRED AND R25 SEEDS

| # | item |
|---|---|
| D1 | **Chunk death fade** — needs a shader term on streamed materials, i.e. a cache-key move this round forbade. `RING_HOLD` cut the event *rate*; the fade removes the event's *visibility*. |
| D2 | `TILE_HOLD.frustumPenalty` sweep — **graded on texture bytes, not draws**. |
| D3 | `TILE_HOLD.lodHysteresis` arming — moves the settled tree at every frozen pose. |
| D4 | B-F-B7 skyline corner loss. |
| D5 | **C-M6 governor unmount + latch** — gated on §6 item 1. |
| D6 | A-R6 style-flip bend window. |
| D7 | **A third unguarded zero-area site: satellite water**, `sat-building-engine.js:727`, in the very file `FLASH_GUARD` lives in. Joins R22.1 **F1**'s two (`vector-tile.worker.js:3106`, `:4579`). |
| D8 | **Add `['terrain', window.__fly.engine.object]` to `verify-stability.js:227-234`** — settles the refuted-but-unmeasured tile-bend question in one run. Cheapest open item in the round. |
| D9 | F15 — load-decided gates; nobody has counted how many. |
| D10 | **F16 — the wide fleet**, now implicated in a real defect (§5a). |
| D11 | B's declined death-fade variant, `keepHysteresis = 4` lever, `SAT_VEG.maxChunksByTier.high` 9→12 (buys the veg lead back; costs bandwidth, not draws), parked-car `rangeM` cliff. |
| D12 | **The `CLUTTER` 2446-vs-4892 comment correction** (§5.1) — another owner's block. |
| D13 | `POOL_FAIR`'s static divisor — a live resident-count divisor would re-derive every share on every arrival, i.e. the churn again. Recorded as a known, disclosed cost. |

---

## §8 LESSONS

**The paired honesty exemplars. Both halves of this round's real lesson came
from re-reading measurements the repo already had.**

> **B's metric self-correction.** B's Wave-1 report cited **17** re-entries
> per leg as the headline churn number. Building the gate against it,
> B found the real figure was **4** — the Wave-1 instrument had counted
> something else — and **corrected it downward, in public, against B's own
> headline claim**, before the gate shipped. That is the R19 §5 lesson
> recurring, and it is the reason `verify-ringhold`'s bound means anything.

> **A's "nobody asked why there were ninety-six a second."** R22.1's own
> stutter probe (`scripts/r22p1-b-stutter.md` §2.3) flew a 350 kt serpentine
> and recorded **2,123 DEM tile meshes built in 22 s — ~96/s — against a
> resident set of 223 tiles** (`r22p1-close.md` §1.2 gate 6), i.e. the whole
> terrain rebuilding about every two seconds, against a transport-limited
> steady state of ~5–10/s. R22.1 correctly made each build 5–6× cheaper and
> the stutter went away. **The number that names this round's root cause was
> sitting in the repo, measured, for two rounds.** Nobody asked why there were
> ninety-six a second.

The rest:

1. **A gate is only worth what its pose and its machine make it worth** —
   and a *statistic* can require the pose that blinds it. `verify-flicker`'s
   freeze is correct for a temporal stddev (an unfrozen 350 kt aeroplane reads
   a flat ~21 units of pure flight). The repair was never to un-freeze it; it
   was to build a second gate with motion-invariant instruments. D's Wave-1
   ruling stands; D's framing of it was too broad, and E corrected it.
2. **A gate can be green on nothing at all.** `verify-flicker` passed by a
   factor of 42 on a blank grey field. A precondition is not bureaucracy.
3. **"Correct library behavior" was a verdict about a camera that never
   moved.** The vendored note that let this through three rounds is kept
   **verbatim** in `VENDOR.md`, annotated rather than rewritten.
4. **A fleet pin is a decision to stop measuring something.** Four pins were
   added in R22 and none was revisited; the shipped terrain has never been
   flown by any gate.
5. **When a hold keeps an object past a cleanup path, check what that path
   relied on happening next** (§5b).
6. **Don't grep for a question about scope** (§5c).
7. **A dwell is hysteresis in time, and that is what makes it shippable into a
   fleet of frozen assertion numbers** — it delays a merge, never cancels one,
   so every settled pose converges on the identical tree.

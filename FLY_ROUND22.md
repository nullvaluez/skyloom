# FLY ROUND 22 — "TERRAIN & IMMERSION" (RECORD)

> **STATUS: SKELETON (authored W1 by E CERT — the R21 W1 idiom).**
> Every section below is a spine with its evidence slots empty. E fills §4/§5
> at W2/W3; each implementation agent's headline lands in §1 as Fable merges
> it. Placeholders read `— (W2)` / `— (W3)`. The plan is
> [FLY_ROUND22_PLAN.md](FLY_ROUND22_PLAN.md); the certification ledger is
> [scripts/r22-close-sweep.md](scripts/r22-close-sweep.md);
> [FLY_ROUND22_HANDOFF.md](FLY_ROUND22_HANDOFF.md) ("Cinematic Night") is
> DEFERRED INTACT to R23 and must be byte-untouched at close.

---

## §0 Mandate — three symptoms, reported live

The user flew the R21 build in satellite and reported three things (two
screenshots). Each is traced below to named code, and each has a measured
instrument that could not have been built from the R21 fleet.

| # | Symptom, in the user's words | Traced to | Instrument (NEW this round) |
|---|---|---|---|
| 1 | "the world still feels flat / not immersive at low altitude" (Lewis Center OH, ~550 ft AGL) | z17 imagery only below ~930 m AGL; DEM stops at z15; the satellite shadow rig casts onto a terrain set that never receives; zero AO; 42-triangle sphere "trees"; no ground clutter at all; nothing atmospheric in the first 800 m | `verify-terra` (camTileZ by AGL band), `verify-depth2` (receive-set census, frame-time ledger), `verify-clutter` |
| 2 | "post-warp terrain stays blurry" (Atlas warp to Dublin OH at FL300) | `WarpFlash.jsx:43-50` reveals on `engine.downloading < 3` — an instantaneous count with no content check; `warpToGeo` never notifies the quadtree; three-tile refines one zoom per serial round-trip; **Esri imagery/DEM have zero persistent cache** | `verify-arrival` (camTileZ AT the reveal moment, against the departure pose) |
| 3 | "things glitch a little a few seconds after boot/warp" — clarified interactively to **late pop-in + brief stutter**, not tone shifts | the prewarm cannot start until the HDRI resolves and the reveal proceeds at `PREWARM.maxMs` regardless; no streaming layer has a birth fade; parcel homes pop ~2 000 instances at once; the governor ladder has zero DPR rungs at devicePixelRatio 1; raw `groundElev` sweeps every AGL fade band | `verify-settle` (per-layer t90 vs reveal; post-reveal program count; ladder shape; slew rate) |

**The R21 fleet was structurally blind to all three** — it measures whether the
frame HOLDS STILL, and every one of these is a question about whether the right
thing is IN the frame. See `scripts/r22-close-sweep.md` §0.

---

## §1 What shipped

### 1.1 A TERRA — sharpness, streaming speed, raster cache
Vendored three-tile v0.12.1 with every patch behind an exported switch (OFF =
verbatim upstream, ledgered in `VENDOR.md`). **z18 imagery on the high tier and
`demMaxZoom` 15 → 16**, both probe-backed (Esri serves real z18 JPEGs at all six
R22 poses; z16 LERC is real, z17 is a 67-byte degenerate surface — 16 is the
TRUE ceiling). An **altitude-keyed LOD curve** RE-MEASURED against the plan: the
plan's 1.0-at-low-AGL took Owens to **291, breaking the 261 ceiling**, so the
shipped curve is `[600,0.86][3000,0.82][9000,0.78]` — Owens 235. `notifyWarp`
prefetches a ≤48-URL destination pyramid behind a self-closing 8 s burst.
**NEW `lib/fly/raster-cache.js`** registers cached dataType loaders through the
vendored `LoaderFactory` — not a Service Worker, not a fetch shim.

*Measured, E's W3 run:* P-LEWIS camTileZ **13 → 18**; one cold FL300 arrival
**267 → 46 raster requests**; second visit **0.60 → 0.32×**; `fly-raster-v1`
holding **1202 entries**; textures **61 MB** against an unmoved 300 MB cap.

### 1.2 B SETTLE — arrival gates, prewarm, birth fades, settle calm
Content-aware satellite reveals (`ARRIVAL_GATE`) consuming the §5.1 hold cap
3500 → 6500 with the time cap always winning; a bounded **local-warp hold** with
a self-describing `reason` (`'content'|'flash'|'no-deficit-signal'`); birth
transitions on every streaming layer; the parcel `growK` step replaced by a
continuous ease; `groundElevVis` slew-limited; the governor ladder given
sub-native render-scale rungs (§5.8, `dprMin` 0.75 + subStep 0.125); the prewarm
tail re-queued at ≤1 `compileAsync` per idle rAF.

*Measured:* throttled-HDRI worst frame **179 → 154 ms** (B's own arms: 576–714 →
132–165); parcel born at **4 % of settled scale** instead of 100 % in one frame;
`groundElevVis` **1.67 m/frame** visual against **3707 m/frame** raw; ladder
**0 → 2** render-scale rungs at devicePixelRatio 1; boot **9.3 → 6.0 s**.
`ARRIVAL_GATE.bootTerms` deliberately stays **false** — B measured the boot
content terms at +2.6 s against an envelope plan §4 freezes, and escalated
rather than spending it.

### 1.3 C CLUTTER — ground life
Trees v2 as ONE merged trunk+crown geometry in the SAME single instanced draw;
parked cars off worker-emitted parking/driveway anchors, two-term anti-dupped
against the R18 collision-column index; deterministic movers whose phase is
`f(clock·speed + hash(pathId))`; poles at the road shader's own
`streetSpacingM` phase. `__flyClutterPin` is three-valued — `1` legacy, `0`
live, `'freeze'` armed-with-clock-0.

*Measured:* trees **42 → 58 tris**, bbox Y **[-1,1] → [0,1]** (they stand on the
ground instead of floating through it); **exactly +3 draws** at P-LEWIS, one per
non-empty pool; pools 242/34/132, all inside the §5.9 budgets; **Owens 0/0/0
instances with draws identical across the flip**; **0 of 268** cars inside a
collision column, nearest **+31.29 m** clear.

### 1.4 D DEPTH — shadows, AO, near-field atmosphere
Ground catcher with a caster-presence + AGL gate; near-ring leaf tiles enlisted
as shadow RECEIVERS (parcel homes join; roads stay out — additive cannot
receive); **N8AO** at the head of the chain, half-res, high tier only, validated
against the reversed-depth trap; a near atmospheric band under the R19 800 m
start. **Ships `DEPTH_PASS.enabled:false`** pending user checkpoint #3, and is
certified in BOTH states.

*Measured:* receive set **22/22 enlisted tiles still flagged, 0 orphaned**;
receive-set frame cost **−0.09 ms** (22 tiles on vs 0 off, GPU timer query);
**Owens 211 ≤ 261** with catcher + N8AO armed.

### 1.5 E CERT — instruments and gates
Five new harnesses — `verify-terra` (18) / `verify-arrival` (17) /
`verify-settle` (14) / `verify-clutter` (17) / `verify-depth2` (16, both states)
— each RED-calibrated on the pre-R22 tree before any fix merged, and each now
green against its frozen red. Sanctioned-edit preparations for
`verify-warp-arrival` (§5.1), `verify-aerial` (§5.2, unconsumed), `soak-fly`
(§5.10), a `STAB_MOUNTAIN` leg for `verify-stability`, and a `CLUTTER` inventory
row for `verify-neon-cover`. One shared `unpinPins` accessor in `_boot.js`.
Ledger `scripts/r22-close-sweep.md`.

**Seven of this round's harness reds were the harness, not the tree** — twice a
gate measured a world it had itself switched off, twice a gate held a private
copy of a constant the round sanctioned, twice a gate audited a subset its owner
never promised, and once a gate passed comparing `null` to `null`. Every one is
recorded in close-sweep §3.3b/§3.4, because a certification agent that hides its
own misses is worth less than no certification agent.

## §2 Agents and waves

| Agent | Charter | Worktree / port | Merge |
|---|---|---|---|
| **A TERRA** | vendored three-tile patches, sharpness, pipeline, raster cache | `r22-a` / 3220 | — (W2) |
| **B SETTLE** | arrival gates, prewarm, birth fades, governor ladder, settle calm | `r22-b` / 3221 | — (W2) |
| **C CLUTTER** | trees v2, parked + moving cars, poles; Owens empty by construction | `r22-c` / 3222 | — (W2) |
| **D DEPTH** | catcher, receive set, N8AO, near-field atmosphere | `r22-d` / 3223 | — (W2) |
| **E CERT** | five harnesses, sanctioned-edit prep, ledger, this record | `r22-e` / 3224 | — (W3) |

Scaffolding: `ee39397` (Fable, W0) — vendored three-tile v0.12.1,
`WORKER_PROTOCOL 17→18` at all six pin sites lockstep, seven pre-seeded
`enabled:false` constants blocks, three FlyScene pre-seeds, four `_boot.js`
fleet pins.

---

## §3 Defect table — red → green

Every RED was measured on the pre-R22 tree before the fix existed; every GREEN
on the integrated tree at `d5fdb1a`. Retired rows are struck through, never
deleted (the R21 idiom).

| ID | Defect | RED (pre-R22) | GREEN (W3) | Gate |
|---|---|---|---|---|
| T1 | low-AGL ground is a magnified parent tile | camTileZ **13** @164 m AGL | **18** | terra (2) |
| T2 | LODThreshold is altitude-blind | flat **0.86** everywhere | curve armed, worst |Δ| **0.0006** vs source | terra (4) |
| T3 | imagery capped at z17 | max img z **17** | **18** | terra (5) |
| T4 | DEM stops at z15 | DEM **15** / img 17 | DEM **16** | terra (11) |
| T5 | the cold cruise arrival re-fetches the whole pyramid | **267** requests | **46** | terra (7) |
| ~~T5b~~ | ~~far-warp descent stalls at FL300~~ | ~~settled z10 vs departure z12~~ | **RETIRED** — the frustum rule, not a defect | arrival (4b) |
| T6 | no persistent raster cache | `fly-raster-v1` **absent** | **1202 entries** | terra (8) |
| T7 | every warp is a cold descent | second visit **0.60×** | **0.32×** | terra (9) |
| ~~T8~~ | ~~reveal fires on `downloading<3`~~ | ~~reveal z10 vs departure z12~~ | **RETIRED** — on `maxLeafZ` the deficit is 1 | arrival (4) |
| T9 | a local warp reveals a deep deficit with no readiness poll | deficit **7**, hold **0 ms** | `reason='flash'`/`'content'`, hold bounded ≤1500 ms | arrival (9b) |
| S-POP | the city assembles after the reveal | satRoads t90 **+12.9 s** | roads t90 at reveal **−1301 ms** | settle (2a)/(2b) |
| S-STUT | the post-reveal compile train stalls the frame | **179 ms** worst frame | **154 ms** (B's arms 576–714 → 132–165) | settle (4)/(6) |
| S-RAMP | the parcel pool appears in one frame at full size | **100 %** at **100 %** scale | born at **4 %** scale | settle (8) |
| S-ELEV | raw `groundElev` sweeps every AGL fade band | **~384 m/frame** raw | **1.67 m/frame** visual | settle (10) |
| S-LADDER | zero DPR rungs at devicePixelRatio 1 | **0** rungs | **2** rungs | settle (11) |
| C1 | trees are 42-tri spheres with no trunk | **42** tris, bbox Y [-1,1] | **58** tris, bbox Y [0,1] | clutter (2) |
| D1 | shadows land on nothing | **0** receiving | **22/22** flagged, 0 orphaned | depth2 (3) |
| D2 | the ground catcher ships off | **0** catcher meshes | mounts under its gate; Owens **211 ≤ 261** | depth2 (4) |
| D3 | zero ambient occlusion | no AO pass | `N8AOPass` in the chain | depth2 (7) |
| D4 | nothing atmospheric in the first 800 m | `nearStartM` **0** | armed | depth2 (12) |
| D5 | medium/low content is an un-atmosphered cut-out | `content.enabled=false`, `minTier='high'` | enabled, `minTier='medium'`; **verify-sat-mobile PASS** | depth2 (13) |

## §4 Certification (W3)

Per-harness detail in [scripts/r22-close-sweep.md](scripts/r22-close-sweep.md)
§3. **Verdict: the product work is CERTIFIED on `d5fdb1a`, with a named gap in
fleet breadth that touches no frozen number** (close-sweep §6).

### 4.1 Run environment
E's own worktree, its own dev server on `:3224`, merged round branch at
`d5fdb1a`. Never `:3000` / `:3002` / `:3019` or another agent's port. A session
limit killed the first fleet batch mid-run; harnesses whose verdicts were not
already written to the ledger were **re-run, not transcribed** (§5.3).

### 4.2 The five R22 gates — all green against their frozen W1 reds

| Gate | Result |
|---|---|
| verify-terra | **PASS 18/18** |
| verify-arrival (`R22_ARRIVAL_SANCTION=1`) | **PASS 17/17** |
| verify-settle | **PASS 14/14** |
| verify-clutter | **PASS 17/17** |
| verify-depth2 — ship state (off) | **PASS** |
| verify-depth2 — `R22_DEPTH=on` | **PASS** |

### 4.3 Frozen numbers — none red

Owens **195–204**, and **211 with DEPTH fully armed**, against 261. R21
stability quartet all green. `verify-monuments-sat`, `verify-fleet`,
`verify-hangar` unmoved. Five R18 neon-cover hashes byte-exact.
**Boot got faster**: P-DUBLIN 9.3 → **6.0 s**. Full table in close-sweep §5.

### 4.4 Soaks

**SATELLITE — PASS, all five BLOCKING gates:** p95 triangles **824 202**
≤ 2.2 M · p95 draws **248** ≤ 375 · governor steps **0** · pageerrors **0** ·
heap floor **159 → 78 MB, i.e. −81 MB**. That last number is the round's
specific worry answered: A's raster cache is Cache-API backed, so it is disk,
not heap, and fifteen minutes of a three-leg route left the floor *lower* than
it started. §5.10 informational `gpuFrameMs` p95 worst **3.68 ms** against an
R23 candidate target of 12.

**TOY — completed, no blocking gates by design.** fps floor ≈80, heap 478 → 341
falling, 0 pageerrors. Scene-total maxima **483 draws / 2.83 M tris** are
RECORDED AND NOT JUDGED per the standing R20 ruling; the fixed-pose toy numbers
from the same sitting are **455 ≤ 480 and 1.968 M ≤ 2 M** (verify-neon-cover).
R21 saw 481 in exactly this position — two rounds of a soak transient sitting
just over a ceiling it does not measure is a gap, and it is a named R23
follow-up (close-sweep §3.3c).

### 4.5 Money shots (close-sweep §3.6)

| Pair | Reading |
|---|---|
| **P-LEWIS** | camTileZ **17 → 18**, tris **249 k → 501 k**, clutter **0/0/0 → 212/35/130**, canopy **42 → 58** tris. Draws 228 → 237. |
| **P-DUBLIN** | hold **2330 → 2359 ms**, camTileZ 10 and maxLeafZ 12 in BOTH arms. **The cruise view does not change** — what changed is the cost of getting there. |
| **Owens control** | clutter **0/0/0 both arms**, draws 224 → 225. NOT pixel-identical: tris 207 k → 375 k from `demMaxZoom` 16. Identical in CONTENT, denser in MESH. |
| **DEPTH_PASS off/on** | **exactly +6 draws** (237 → 243), triangles unmoved. |

### 4.6 Consumed §5 moves
Nine consumed, one deliberately not (§5.2 texture bytes — 61–68 MB measured
against a 300 MB cap), one escalated rather than spent (`bootTerms`, +2.6 s
against a frozen boot envelope). D's N8AO +6 draws approved against a plan
estimate of +3. Full ledger in close-sweep §4.

### 4.7 `DEPTH_PASS` certified in both states
Ship state (off): every OFF assertion green. Armed: receive set **22/22 flagged,
0 orphaned**, catcher mounts under its gate, **Owens 211 ≤ 261**, receive-set
frame cost **−0.09 ms** on a real GPU timer. It ships **false** pending user
checkpoint #3.

## §5 Postmortem

### 5.1 W1 instrument redesigns (close-sweep §1b)
Three gates were written, run against the defective tree, and **failed to go
red** — and were redesigned in W1 rather than discovered at W3:
`verify-arrival (4)` (self-calibrating against a reference that shared the
defect), `verify-settle (2)` (first appearance instead of t90, and boot instead
of warp), `verify-settle (8)` (aimed at a `growK` step that never fires at the
test pose while the actual pop went unmeasured).

### 5.2 W2/W3 instrument faults — seven, all mine, all found by running
Full detail in close-sweep §3.3b and §3.4. The short form: twice a gate measured
a world it had itself switched off (the harness default, then a fleet pin it
deferred to); twice a gate held a private copy of a constant the round
sanctioned (`SAT_QUILT`'s ramp, `TERRA_SHARP`'s LOD curve) and failed the round
for honouring its own measurement; twice a gate audited a subset its owner never
promised (D's receive set, C's anti-dup bucket-vs-containment); once a gate
passed comparing `null` to `null`. Four of the seven produced *plausible product
failures* — the dangerous kind, because they look exactly like a regression.

### 5.3 A session limit killed the fleet batch mid-run
The first W3 fleet batch was interrupted. Verdicts that had been seen in a
terminal poll but not yet written into the ledger were **discarded and re-run**,
not transcribed from memory — a half-finished batch is testimony, not evidence
(the R21 close ruling, applied to my own run). Rows already written from
completed runs stand.

### 5b Follow-ups

1. **PrewarmRig: PrecipLayer warm deferred** — the file is unowned this round;
   its variants still compile on first precipitation.
2. **B's warm-set `Pass`/`getAttributes` note** — the warm set reaches
   `buildPassList` compositions but not passes that construct their own
   materials outside it; N8AO self-warms for exactly this reason.
3. **Veg-as-caster is UNTESTED** — `SatVegLayer` reads `__flySatShadowOverride`
   at mount, so the fleet pin decides its caster state before D's per-kind flag
   is consulted. The `r22Caster` marker contract covers it; the measurement does
   not exist yet.
4. **The z18 16× DEM re-decode** — A's R23 memo candidate: a z18 imagery tile
   forces a DEM re-decode at a ratio that memoisation would collapse.
5. **§5.2 texture-bytes 300 → 450 stays UNCONSUMED** — measured 61–68 MB at z18
   against a 300 MB cap. Raising it would only hide a future regression. The
   `R22_AERIAL_SANCTION` leg remains prepared and inert.
6. **D self-reported one accidental `:3000` page load** during W1 — the user's
   live port. No writes, no harness run against it; recorded because the
   worktree protocol exists to be auditable, not to be assumed.
7. **`terraSeen` is not where verify-arrival looks** — B publishes it, my read
   path returns `null`. The load-bearing assertion is `reason`, which is
   correct, so this is a reporting gap rather than a gate failure.
8. **The toy soak cannot judge its own draw total** — R21 saw 481, R22 sees
   483, both against a 480 fixed-pose ceiling the soak is not measuring. Give
   the toy soak a fixed-pose probe leg, or stop reporting a number nobody is
   allowed to act on. (R23.)
9. **`verify-globe2` has no verdict line** — it prints stats and `pageErrors: 0`
   and exits 0. It is passed by inspection; a future round should give it a
   `VERIFY:` line so a fleet sweep can read it mechanically.

## §6 User checkpoints (plan §9) — PENDING USER

| # | Checkpoint | Evidence | Status |
|---|---|---|---|
| 1 | **P-LEWIS before/after** — the round's money shot (sharpness + clutter + shadows/AO candidate) | — (W3) | PENDING |
| 2 | **P-DUBLIN warp arrival before/after** + hold-length feel (is ≤ 6.5 s tolerable when it buys a sharp reveal?) | — (W3) | PENDING |
| 3 | **Shadows + AO taste and perf ON THE USER'S MACHINE FIRST** — this decides whether `DEPTH_PASS` flips on or stays built-but-off | — (W3) | PENDING |
| 4 | Tree / car / pole read at low AGL (density, scale, believability) | — (W3) | PENDING |
| 5 | Moving-traffic speed and density taste | — (W3) | PENDING |
| 6 | `SAT_QUILT` arrival desaturation A/B | — (W3) | PENDING |
| 7 | Boot feel: stutter gone, pop-in gone (subjective confirmation of the §7 instruments) | — (W3) | PENDING |

Carried and still open: the R21 §6 table (7 checkpoints), R20 §6 (15), R19 §6
(21), and the earlier R15–R18 tables.

---

## §7 Lessons

1. **A library that re-asserts state every frame cannot be flag-flipped, only
   ridden.** D's near-ring receive set enlisted 22 tiles and 0 of them were
   receiving, because three-tile re-stamps tile state on its own cadence — the
   flags had to be re-applied on a sweep, not set once. The same shape as R19's
   "an actor whose owner rewrites `visible` every frame cannot be parked from
   outside", one layer down.
2. **An instrument that cannot observe a state reads it as zero.** The
   local-warp hold was invisible to my trace twice over: once because the hold
   rendered no `data-stage`, and once because the deficit it keys on comes from
   `terraStats`, which the fleet pin suppressed. Pinned: hold 0 ms. Un-pinned:
   deficit 6, hold 1322 ms. The gate was measuring its own pin and reporting a
   product defect.
3. **An instrument built from the mechanism it audits can only agree with it.**
   My anti-dup census asked `queryColumns` whether a car was inside a column —
   but that API answers with the hash BUCKET's occupants, so it was testing
   cohabitation of a spatial cell, not containment of a footprint. It read 12
   of 242 "inside"; the exact census reads 0 of 268, nearest car +31.29 m clear.
4. **A gate that can quote a constant should read it, not copy it.** Two
   harnesses failed the round for doing exactly what the round sanctioned,
   because each held a private copy of a value the round moved (`SAT_QUILT`'s
   ramp, `TERRA_SHARP`'s LOD curve). Both now derive the expectation from source:
   the arithmetic is asserted, the values are not. **Consuming a value move must
   include re-basing every gate that asserts it.**
5. **A certification gate must certify what ships — and prove it is doing so.**
   `verify-terra` measured an un-armed tree twice, in two different ways, and
   produced six plausible product failures both times. It now has a gate (0)
   that asserts the arm took before anything else runs, using a signal the
   feature itself publishes. A gate should fail first with the reason, not last
   with the symptoms.
6. **An instrument can measure a library working correctly and call it a bug.**
   Four W1 reds were the three-tile out-of-frustum LOD rule: at FL300 the tile
   under the aircraft is off screen and never subdivides. "Stuck at z10 for 40 s
   with `downloading` 0" reads like a stalled pipeline and is a correct
   quadtree. The tell was in the measurement all along — the loader was IDLE.
7. **The same instrument can be right at one altitude and vacuous at another.**
   `maxLeafZ` replaced `camTileZ` at cruise because it sees past the frustum; at
   low AGL that same property made it read z17 off residue from earlier poses
   while the ground under the camera was z13.
8. **A gate must be greenable, not just red-able.** The first re-base put the
   FL300 descent on `maxLeafZ >= 13` — until A's own armed-vs-control files
   showed the cruise profile is IDENTICAL in both arms. A red nobody can close
   is as useless as a green nobody can fail.
9. **"The layer exists" is not "the layer arrived."** Gating pop-in on first
   appearance passed on the defective tree by six seconds, because BootScreen
   drains the tiles before it reveals. The pop a player sees is the ring
   FILLING — t90, not t>0 — and the path where it happens is the WARP reveal.
10. **Settle predicates need the slowest input, not the loudest one.** The
    building ring reported 95 % resolved while the column index the anti-dup
    term actually reads held **43 of an eventual 1844**. A hash taken there is a
    hash of a world still deciding where its buildings are.
11. **Pin the pose in the same tick you warp it.** The flight model integrates
    ~2.5 m between a `warpToGeo` and a freeze 2500 ms later, so two "identical"
    sessions placed hash-stable content around two different origins and the
    determinism gate failed for a reason that was not nondeterminism.

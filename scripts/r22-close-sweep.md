# R22 "TERRAIN & IMMERSION" — CLOSE SWEEP LEDGER (skeleton, authored in W1 by E CERT)

> **STATUS: W1.** §1 (RED calibration) is FILLED — those numbers were measured
> on this worktree with all seven R22 blocks `enabled:false`, i.e. the pre-R22
> world exactly. Every other result cell reads `— (W2)` or `— (W3)` until the
> integrated tree exists. `scripts/r21-close-sweep.md` is the shape this
> follows; the R20 ledger before it is the shape R21 followed.

Dev server for every run: **the agent's own worktree server on its own port**
(E: `npx next dev -p 3224` from `.claude/worktrees/r22-e`), pointed at with
`FLY_URL`. Never `:3000` / `:3002` / `:3019` / another agent's port — those are
user-adjacent or owner-adjacent (the R19 §4.1 deviation note, still standing).

---

## §0 What makes this sweep different from R21's

R21 closed the flashing and the patchy world. It did not — and structurally
could not — see any of the three symptoms R22 exists for, because **the entire
R21 fleet measures STABILITY (does the frame hold still?) and nothing in it
measures CONTENT (is the right thing in the frame at all?)**.

| The R21 fleet asserts | so no gate could see |
|---|---|
| draw calls, triangles, program counts, chunk `ready` counts | the ZOOM of the tile under the camera — the whole of symptoms #1 and #2 |
| `verify-warp-arrival`: `revealAt <= 5600` (elapsed time only) | a reveal that is fast AND blurry — which is the shipped behaviour |
| a FROZEN pose, seconds long, after a manual settle | the first ten seconds after a reveal, where pop-in and stutter live |
| `castShadow` on building chunks | that the shadows land on NOTHING (terrain is not in the receive set) |
| scene-total draws | fill rate — the R13 objection to near-ring `receiveShadow`, never measured since |
| `__flyGovPin='hold'` fleet-wide | that at devicePixelRatio 1 the ladder has ZERO render-scale rungs |

The five new gates exist to close exactly those six rows. Four of the six are
closed by DETERMINISTIC COUNTERS (tile zoom, program counts, receive-set
census, ladder rungs) rather than by pixel differences — the R21 lesson,
applied: counting the loop beats counting its shadow.

---

## §1 RED CALIBRATION (W1 — the pre-R22 tree, `r22/e` @ `ee39397`)

Each new gate was run against the scaffolded tree with **all seven R22 blocks
`enabled:false`**, i.e. R21 behaviour exactly. Evidence: `scripts/r22-e-red-*.json`
plus the `r22-e-*.png` shots. A gate that cannot go red is a coin (R20 lesson),
so the ones that did not go red are listed separately in §1b and were
REDESIGNED IN W1 where a better instrument existed.

| Defect | Gate | Measured RED | Green target | Separation |
|---|---|---|---|---|
| **T1** low-AGL ground is a magnified parent tile | verify-terra (2) | camTileZ **13** at 164 m AGL (best in a 10 s window: 13) | ≥ 17 | 4 levels = 16× texel |
| **T2** LODThreshold is altitude-blind | verify-terra (4) | flat **0.86** at every AGL band (132 m → 8879 m) | altitude-keyed curve | binary |
| **T3** imagery capped at z17 | verify-terra (5) | max imagery zoom requested = **17** | ≥ 18 | binary |
| **T4** DEM stops at z15 while imagery reaches z17 | verify-terra (11) | DEM **15** / imagery **17** | DEM ≥ 16 | binary |
| ~~**T5** cold warp descent is serial~~ | ~~verify-terra (7)~~ | ~~NEVER reached z13 in 40 s (stuck at z10, `downloading` 0)~~ | ~~≤ 12 000 ms~~ | **RETIRED W2 — §1g** |
| ~~**T5b** far-warp descent STALLS at FL300~~ | ~~verify-arrival (4b)~~ | ~~settled z10 vs departure z12, 23 s~~ | ~~settled ≥ departure~~ | **RETIRED W2 — §1g** |
| ~~**T8b** FL300 reveal coarse absolutely~~ | ~~verify-arrival (5)~~ | ~~camTileZ 10 at 8867 m AGL~~ | ~~≥ 12~~ | **RETIRED W2 — §1g** |
| ~~**T1b** the low-AGL descent never reaches z17~~ | ~~verify-terra (2b)~~ | ~~maxLeafZ z17 at 0 ms~~ | ~~≤ 10 000 ms~~ | **RETIRED SAME-WAVE — §1g: `maxLeafZ` is vacuous at low AGL (it counts residue from earlier poses); gate (2) carries the claim** |
| **T5** the cold cruise arrival re-fetches the whole pyramid | verify-terra (7) | **266** imagery+DEM requests for ONE cold FL300 arrival | ≤ 220 | A: 306 control → **182 armed** → **0** second visit |
| **T9** a local warp reveals a 7-level deficit with no readiness poll | verify-arrival (9b) | camTileZ **10 → 17** (deficit **7**, reproduced twice) with a **0 ms** hold | ≤ 2 levels, or a hold ≤ 1500 ms | 3.5× |
| **T6** no persistent raster cache | verify-terra (8) | `fly-raster-v1` **absent** (only R21's `fly-tiles-v1`, 221 vector entries) | > 0 entries | binary |
| **T7** every warp is a cold descent | verify-terra (9) | second-session raster requests **0.49×** the cold session (837 vs 1709; W1 read 0.56×) | ≤ 0.40 | 1.2× · A armed: **0.026× low-AGL / 0.00× FL300** |
| ~~**T8** the reveal fires on `downloading<3`, not on content~~ | ~~verify-arrival (4)~~ | ~~reveal z10 vs departure z12 at FL300~~ | ~~deficit ≤ 1~~ | **RETIRED W2 — §1g; re-based on `maxLeafZ` it reads 12 vs 13 = deficit 1, INSIDE the bound** |
| **T8b** the FL300 reveal is coarse in absolute terms | verify-arrival (5) | camTileZ **10** at 8867 m AGL | ≥ 12 | 2 levels |
| **B1** boot reveals over an undescended pyramid | verify-arrival (11) | boot reveal **z12** → settles **z15** | ≥ 12 (settles-1) | see §1b |
| **S-POP** the city assembles after the WARP reveal | verify-settle (2b) | reveal at **2 300 ms**; `satRoads` reaches 90% of its settled 16 chunks at **+12 900 ms** | 0 late layers | 5.2× the grace |
| **S-POP** (boot path — NOT red) | verify-settle (2a) | every layer assembled BEFORE the 7.7–10.0 s boot reveal (worst `traffic` +1 300 ms, inside grace) | 0 late layers | see §1b |
| ~~**S-STUT** compile train after reveal (COUNT)~~ | ~~verify-settle (4)/(6)~~ | ~~13 programs~~ | ~~0 programs~~ | **RE-BASED W2 — §1h: B's fix RAISES the count 13→19 by design** |
| **S-STUT** the post-reveal compile train stalls the frame | verify-settle (4)/(6), HDRI +9 s | **179.2 ms** worst frame at reveal+9.9 s (W1) — B's arms: OFF **576–714 ms** → ON **132–165 ms** | ≤ 200 ms worst frame | 3–4× |
| **S-STUT** (clean boot — NOT red) | verify-settle (4)/(5) | 0 programs, 0 long frames (median 4.2 ms, worst 20.9 ms over 2 365 frames) | 0 / ≤ 2 | see §1b |
| **S-RAMP** the whole parcel pool appears in one frame at full size | verify-settle (8) | **100% of 1874 homes in one 100 ms sample at 100% of settled scale** (Melton AU) | ≤ 25% per sample, or born ≤ 60% scale | total |
| ~~**S-ELEV** raw `groundElev` sweeps every fade band~~ | ~~verify-settle (10)~~ | ~~22 697–24 023 m/s~~ | ~~≤ 80 m/s~~ | **RE-EXPRESSED W2 — §1h** |
| **S-ELEV** raw `groundElev` sweeps every AGL fade band | verify-settle (10) | — (W2 re-run) — B measured raw **~384 m per FRAME** | ≤ 8 m/frame (B: damped ≤ 4.0 by construction) | ~48× |
| **S-LADDER** zero DPR rungs at devicePixelRatio 1 | verify-settle (11) | **0** render-scale steps before the first tier step; ladder is `[1/high, 1/medium, 1/low]` | ≥ 2 | total · control at dpr0 1.5 = **2** |
| **C1** trees are 42-tri spheres with no trunk | verify-clutter (2) | **42 tris/instance**, bbox Y [-1, 1] (`SphereGeometry(1, 7, 4)` — no trunk) | 43..96 tris/instance | binary |
| **D1** shadows land on nothing | verify-depth2 (3) | **0 of 4** near leaf tiles receive, with **5 casters inside the same 1 500 m radius** (20 casters in scene) | > 0 | binary |
| **D2** the ground catcher ships off | verify-depth2 (4) | **0 catcher meshes** at 682 m AGL with 5 casters in frustum | > 0 | binary |
| **D3** zero ambient occlusion anywhere | verify-depth2 (7) | pass list is `RenderPass` + 3 `EffectPass` (Aerial/Bloom/SpeedLines/HueSat/BrightnessContrast/WhiteBalance/Vignette · SMAA · ToneMapping) — **no N8AO** | N8AO present | binary |
| **D4** nothing atmospheric touches the first 800 m | verify-depth2 (12) | live `startM` **800** at P-LEWIS | < 800 | binary |
| — | verify-depth2 final W1 run | fails on **exactly (3)(4)(7)(12)(13)** — the five D-defects — and nothing else; (5)(6)(15)(16) green, three SOFT | | |
| **D5** medium/low content is an un-atmosphered cut-out | verify-depth2 (13) | source: `AERIAL_PERSPECTIVE.content.enabled=false`, `minTier='high'`; at medium the composer runs **no aerial pass at all** | enabled + minTier medium | binary |

### §1g W2 RE-BASE — four reds RETIRED because the instrument was wrong, not the world

A TERRA's W1 measurements (`scripts/r22-a-dublin-*.json`, VENDOR.md "upstream
behavior worth knowing") invalidated four of my frozen reds, and Fable ordered
the re-base. The rows above are struck through rather than deleted — the R21
idiom: **never erase a red, annotate it.**

**THE FINDING.** three-tile skips `LOD()` for an out-of-frustum leaf and
multiplies the distance ratio by 5 (rather than 0.8) when a tile is not
visible. At FL300 with a near-level chase camera the ground DIRECTLY BELOW the
aircraft is off screen — so `camTileZ`, the leaf under the aeroplane, **can
never refine at cruise, by design**. My W1 P-DUBLIN reds ("stuck at z10 for
40 s with `downloading` 0", "reveal z10 vs departure z12") were measuring that
rule working correctly. A's armed runs still read z10 there, and no pipeline
patch, LOD curve or cache can move it.

| W1 red (retired) | What it was really measuring | Re-based on |
|---|---|---|
| terra (7) "never reached z13 in 40 s" | the frustum cap | **request count** for one cold FL300 arrival |
| terra (6) "usable zoom at cruise" | the frustum cap | a `maxLeafZ` **regression floor**, not a target |
| arrival (4)/(4b)/(5) reveal/settled zoom | the frustum cap at BOTH ends | `maxLeafZ` — and see below |
| arrival (11) boot reveal | valid, but out of scope by B's decision | recorded, not closed |

**AND THE RE-BASE RETIRED THE ARRIVAL RED ITSELF.** On `maxLeafZ` the FL300
reveal measures **z12 against a departure of z13 — a deficit of ONE, inside the
bound** — and the destination settles to 13. So there is no FL300
content-at-reveal defect to close; the deficit was the instrument. The gates
stay (they are the right invariant, and they would catch a future reveal firing
two levels early), but **the round record must not claim R22 closed a defect
there.**

**A SECOND RE-SPEC, FROM A'S OWN ARMED EVIDENCE.** The first re-base put the
FL300 descent clock on `maxLeafZ >= 13`. A's armed-vs-control files then showed
that would be a gate *nobody can green*:

| run | maxLeafZ | settled ahead-profile (km → leafZ) |
|---|---|---|
| `r22-a-dublin-prof-control.json` | 13 | {2:10, 5:10, 10:12, 20:12, 50:10} |
| `r22-a-dublin-prof-armed.json` | **12** | **{2:10, 5:10, 10:12, 20:12, 50:10}** |
| my control, merged tree | 12 | {2:10, 5:10, 10:12, 20:12, 50:10} |

Identical profile armed and control, from two agents independently. **R22 does
not make the FL300 view sharper** — at cruise the settled zoom is what
three-tile gives you. What DOES move is the cost of getting there (306 → 182
requests cold, → 0 on a second visit through the cache), so that is what the
FL300 gate asserts, and the cruise profile is recorded as an ANCHOR every run
so a regression is still visible. **Checkpoint #2 must be framed accordingly:
what the user will see change at FL300 is the wait and the second visit, not
the texel density.**

**WHERE THE CONTENT DEFECT IS REAL.** The local-warp leg, at low AGL, where
`camTileZ` is a valid statistic: **camTileZ 10 → 17, a seven-level deficit,
with a 900 ms flash and no readiness poll of any kind** (WarpFlash keys its
poll on `kind === 'far'`). That is red today and greenable by
`ARRIVAL_GATE.localHold` — which is exactly what the FL300 gates are not. It is
the new row **T9** above.

### §1a Anchors — not reds, but the controls the W2/W3 claims are measured against

An anchor is a number frozen on the flag-off tree so that a later equality or
delta MEANS something. The R20 close ruling's instrument (bit-identical
triangle totals across a flag flip) only works if the "before" was recorded.

| Anchor | Measured (flag-off, `ee39397`) | Used by |
|---|---|---|
| Owens draws / tris, verify-terra pose + settle | **200 draws** / 186 180 tris, camTileZ 15 | verify-terra (13)/(14) vendor identity |
| P-LEWIS draws / tris | **226–230 draws** / 246 607 tris at 132–164 m AGL | verify-clutter (10) "+N draws", plan §5.11 |
| P-LEWIS tile textures | **≈59 MB across 176 textures**, max anisotropy 8 | plan §5.2 (the 300 → 450 MB question is real only at z18) |
| Esri Terrain3D z16 LERC | **3/3 poses HTTP 200 with 20–32 KB** (P-LEWIS/P-DUBLIN/OWENS) | plan §5.5 — A's `demMaxZoom` 15→16 precondition is SATISFIED |
| Cold satellite session raster requests | **911 imagery + 787 DEM** (full z2..z17 pyramid) | verify-terra (9) |
| Boot at P-DUBLIN | **9.3 s** to `pct 100` | plan §4 (boot timing may not lengthen) |
| Powell boot reveal | **10.0 s**; layers first populate 2.5–4.1 s (all BEFORE reveal) | verify-settle (2a) |
| Prewarm | published at **2.11 s**, 29 variants + 9 passes in **183 ms** | verify-settle (7) |
| P-DUBLIN cruise sharpness (**anchor, not a gate**) | settled ahead-profile **{2:10, 5:10, 10:12, 20:12, 50:10}**, maxLeafZ **12**, camTileZ **10** — identical armed and control (A), reproduced independently by E | the honest framing of checkpoint #2: R22 moves the WAIT at FL300, not the texel density |
| P-LEWIS flicker floor (no movers) | **p99 9.00 / 9.25** across two runs, 408 000 ground pixels | verify-clutter (17) five-control — headroom to the 12 bound is only **1.33×** |
| Manhattan frame-time baseline | **gpuP95 4.376 ms** / gpuP50 3.305 ms (`EXT_disjoint_timer_query_webgl2` IS available on this machine), rAF p95 8.4 ms | verify-depth2 (10) N8AO budget |
| Receive-set experiment cost | **−0.18 ms** for 4 near leaf tiles at Manhattan 700 m (i.e. inside the noise) — the R13 fill-rate objection, measured | verify-depth2 (11) |
| P-LEWIS collision index | 1 844 columns in the ring, **49 within 1 500 m**, entry shape `{x, z, topY, r}` | verify-clutter (5)/(14) anti-dup |
| Manhattan (verify-depth2 pose) | 244 draws / 1 301 445 tris at 682 m AGL, 20 caster meshes | verify-depth2 budgets |
| Owens (verify-clutter pose+settle) | **195 draws** / 187 224 tris, camTileZ 15 | verify-clutter (6)/(7)/(8) |

### §1h W2 RE-EXPRESSIONS from B SETTLE's and C CLUTTER's own measurements

Three more instruments were corrected by their owners' evidence, before W3
rather than at it:

1. **The slew gate was reporting an instrument artifact.** A m/s figure
   computed with a dt that is not the damper's own dt is not the damper's rate:
   B's per-rAF rates read 350–540 m/s on a damper that is correct by
   construction, because a 100 ms sampler dividing by 0.1 s reports the rate of
   a step the damper never took in one step. Re-expressed as the **per-frame
   step in metres** (B: raw ~384 m/frame, damped ≤ 4.0 m/frame by
   construction), sampled per-rAF rather than per-100 ms.

2. **The stutter gate would have failed B's fix for working.** With the prewarm
   fix ON the post-reveal program count RISES 13 → 19, because the env re-key
   deliberately warms the full set — more programs, calmer frame. The long-frame
   COUNT did not separate B's arms either (2 vs 2). The scalar that did is the
   **worst frame** in the window: OFF 576–714 ms → ON 132–165 ms. Gates (4) and
   (6) now assert that; programs and long-frame count are printed as evidence.

3. **The clutter determinism gate needed C's three-valued pin and a
   commutative set hash.** `__flyClutterPin` is `1` legacy / `0` live /
   `'freeze'` armed-with-clock-0; the Owens-zero legs run LIVE (empty while
   frozen would prove less), the determinism and flicker legs run `'freeze'`.
   The hash is a **commutative sum over per-instance hashes excluding matrix
   element 13** — pool order is an allocation detail, and element 13 is the
   draped DEM height, which A legitimately moves with `demMaxZoom`. Mover COUNT
   is never frozen (C measured 138–142 breathing at ring edges). Cross-boot,
   the gate asserts poles bit-identical + counts stable and REPORTS the
   parked/mover set-hash residual, which C attributes to the collision index
   still filling as z14 streams. Sampling waits on a settle PREDICATE
   (`clutter.ready === chunks` and the building ring resolved), not a timer.

### §1b Gates that did NOT go red on this hardware, and what was done about them

Recorded honestly, per the R21 §1b precedent. Three were REDESIGNED in W1;
two are recorded as environment facts.

1. **verify-arrival (4), as first written, passed vacuously.** The original
   form compared the reveal's camTileZ against the SAME pose 15 s later and
   read `10 vs 10, deficit 0` — a clean pass on the defective tree, because
   the destination pyramid never descends at all after a far warp at FL300.
   *A self-calibrating gate whose two numbers share the defect is a coin.*
   REDESIGNED: the reference is now the DEPARTURE pose's settled zoom at the
   same altitude (same engine, same tier, same LOD math, 12 s of settle), which
   reads `reveal 10 vs departure 12` = RED, and (4b) states the stall directly.

2. **verify-settle (2), as first written, passed.** First appearance is the
   wrong statistic: every layer had SOME population ~6 s BEFORE the boot reveal
   because BootScreen already drains the satellite tiles. REDESIGNED to t90
   (the first sample holding ≥ 90% of the settled population), and SPLIT into
   (2a) boot and (2b) **warp** — WarpFlash's reveal consults no vector ring at
   all, so the warp path is where "the city assembles in front of you" lives
   and the boot path was never going to show it.

3. **verify-settle (8), as first written, measured 0.0%.** It gated on the R21
   `growK` 0.55 → 1.0 SCALE step, and `provisional` was `false` for the entire
   Melton run — the two-ring settle had already resolved, so growK was 1 from
   the first placed instance and the mechanism never fired at this pose. What
   the trace DOES show is the pop in its purest form: `placed` **0 → 1874
   between two consecutive 100 ms samples, at full instance scale**.
   REDESIGNED to gate the BIRTH (share of the pool appearing in one sample,
   and at what size); the scale step survives as informational (8b), marked
   NOT RED-CALIBRATED in the run output itself.

4. **verify-settle (4)/(5)/(6) — the stutter legs — did not reproduce.**
   Measured: programs FLAT at 62 across reveal+10 s, ZERO long frames over the
   40 ms bound (median frame 4.2 ms, worst 12.5 ms over 2387 frames), prewarm
   complete at 2.11 s against a 10.0 s reveal — and the same numbers with the
   HDRI fetch delayed 3.5 s. **This is structural, not luck**: the defect is an
   ORDERING (prewarm cannot start until the HDRI resolves; the reveal proceeds
   at `PREWARM.maxMs` regardless), and on this machine the reveal is itself
   10 s, so a 3.5 s HDRI delay cannot push the warm past it. The delay was
   raised to 9 s, which is a NETWORK condition rather than a CPU throttle — a
   CPU throttle would manufacture long frames and prove only that a slow
   machine is slow. If the 9 s leg still reads zero, the gates STAY (they are
   the right assertions and they are cheap) and this row is the record that
   they are uncalibrated on this hardware, exactly as R21 recorded for its
   tier-flap gate.

5. **verify-depth2 (5) asserted something untrue about Owens.** The draft
   required `castersNear === 0` at the empty control and measured **4** —
   because Owens has real vegetation (R18 measured 952 tree stands there) and
   `SatVegLayer` arms `castShadow` with the rig. The plan's claim is about
   COST, not emptiness ("Owens +0 BY CONSTRUCTION" is a DRAW count against the
   tightest ceiling in the app). REDESIGNED to assert only that the catcher is
   not mounted at Owens, with the caster count printed as evidence. *A gate
   that asserts a scene fact it never measured will eventually be wrong about
   the scene.*

6. **verify-depth2 (13) first read `uniforms: null` and failed for the wrong
   reason.** `satHazeUniforms` is a module-private object in world-bend.js
   injected by `onBeforeCompile`; it is not on the material's userData and
   world-bend exports no getter for it (it does for the sibling
   `getSatBldgFade`). A red produced by a missing instrument is an instrument
   artifact, which is precisely what the R19 postmortem retracted a whole
   finding over. REDESIGNED to gate the SOURCE fact
   (`AERIAL_PERSPECTIVE.content.enabled` / `.minTier`, parsed from
   fly-constants.js — a fact with no distribution, the same standing
   verify-flicker's polygonOffset gate rests on), with the runtime uniform
   asserted as (13b) once D exposes it.

7. **verify-terra (14) would have failed against a borrowed band.** The draft
   asserted the R21 "Owens 179–195" band and measured **200**. That band was
   measured by verify-aerial and verify-sat-depth, at their settle times, with
   their pins — and this gate settles longer and reaches camTileZ 15, which is
   MORE tiles and therefore more draws, and is the correct behaviour to measure
   in a round about sharpness. The baseline is now measured and frozen HERE
   (200 ± 8); the frozen 261 ceiling is untouched. *A threshold borrowed from
   another harness is a coin.*

8. **verify-arrival (11) — the boot reveal — is honestly borderline.** It
   measured `z12 at reveal → z15 settled`: a 3-level deficit, so the BOOT path
   carries the same defect as the warp path, but it clears the absolute floor
   of 12 that the gate asserts. The deficit form is the load-bearing one and it
   belongs to (4); (11) is the absolute-floor companion. Recorded so nobody
   later reads "(11) PASS" as "the boot reveal is content-aware".

### §1c What the instruments CANNOT see (the R21 §7 honesty section, up front)

- **`getGroundAt(...).tileZ` answers for ONE point — the camera's ground
  sample.** A frame whose centre is z17 and whose edges are z12 reads as
  sharp. The AGL/tileZ band table (verify-terra (3)) is a partial mitigation;
  a true screen-space texel census is not built and is a named R23 follow-up.
- **The pop-in trace samples at 100 ms.** Anything that appears and vanishes
  inside one sample is invisible to it. The frame-level version of that
  question is verify-flicker's, and it stays R21's.
- **`gpuFrameMs` is only real where `EXT_disjoint_timer_query_webgl2` is.**
  Where it is absent, the harnesses report the rAF interval at a FROZEN pose
  and SAY SO in the same line. A rAF interval is a CPU-side number; quoting it
  as a GPU budget would understate exactly the fill-rate costs D DEPTH's
  budgets exist to bound.
- **Anything gated `SOFT … PENDING C/D` is measuring nothing today.** Flipping
  `__flyClutterPin` on this tree is a no-op, so an equality assertion across it
  would pass vacuously — which is why those legs SOFT-fail with the anchor
  printed instead of asserting.
- **Upstream Esri tile errors are classified, not gated.** The pre-R22 tree
  already logs occasional `Access to fetch … net::ERR_FAILED` for tiles outside
  Esri's coverage. Gating on them would make every R22 harness red for a reason
  no R22 agent can fix; they are counted, printed, and bounded instead.

### §1d W1 evidence, preserved

Calibration artifacts are frozen under `scripts/r22-e-red-*.json` and
`scripts/r22-e-*.png`. The W2/W3 re-runs overwrite those names, so before the
first W2 merge Fable should copy them to `r22-e-red-w1-*` (the R21 §1d idiom) —
otherwise the red they were calibrated against is erased by the green that
replaced it.

---

### §1e INSTRUMENTS THE FIX AGENTS STILL OWE (every one currently SOFT-fails)

A gate must never crash on an instrument its owner has not landed, so each of
these prints `SOFT … instrument missing (owner X)` and does not set the exit
code. **W3 certification requires ZERO soft lines**, so this is a delivery
list, not a wish list.

| Instrument | Owner | Gate that is blind without it |
|---|---|---|
| ~~`runtime.terraStats`~~ | A | **DELIVERED (r22/a)**. Canonical read: `runtime.terraStats ?? runtime.engine?.terraStats` (Fable's arbitration commit `6095e9c`). `sharp = settled && (atTarget || stalled)` with `sharpReason` is RATIFIED — verify-arrival (6) treats `sharpReason:'stalled'` as a legitimate CRUISE reveal reason, because `atTarget` is false forever at FL300 (targetZ is a pure function of AGL and does not know about the frustum rule) |
| ~~`runtime.arrivalStats`~~ | B | **DELIVERED (r22/b)** — `{gateArmed, kind, epoch, holdStartAt, revealAt, holdCapMs, holdMs, reason, terms}` + `legacy:true`. verify-arrival now READS `holdCapMs` instead of inferring it |
| ~~`runtime.popin`~~ | B | **DELIVERED (r22/b)** — `{revealKind, layers:{atMs, sinceRevealMs, birthed}, longFrames, worstMs, frames}`. Note the flag is `birthed`, not `fading`; verify-settle (3) re-pointed |
| ~~`__flyStats.clutter` + the mesh handles~~ | C | **DELIVERED (r22/c)** — plus `baseDraws`. Caveat folded into the gate: `baseDraws` derives from `__flyStats.drawCalls`, which republishes every 60 frames (~1 s stale), so both arms of the Owens flip are sampled 5 s after the flip |
| ~~`window.__flyTerraForce`~~ | A | **DELIVERED (r22/a)** — `{sharp,pipe,cache,demMaxZoom,maxZoomHigh,errTable,errTableValues}`. verify-terra and verify-arrival now arm TERRA through it and never touch `__flyTerraPin` |
| `__flyStats.clutter = {parked, moving, poles: {count, tris, anchors}, baseDraws}` | **C** | verify-clutter (7)(8)(10)(11)(12)(13)(14) — seven gates |
| `window.__flyClutterParked` / `__flyClutterMoving` / `__flyClutterPoles` (or `window.__flyClutter`) | **C** | verify-clutter (15)(16) determinism + pin freeze |
| `window.__flyN8AO.set(bool)` | **D** | verify-depth2 (9)(10) — the AO A/B needs a live toggle, not a rebuild |
| A getter for `satHazeUniforms` (world-bend already exports `getSatBldgFade`; this is the same shape) | **D** | verify-depth2 (13b) — without it the medium/low scoping rests on the SOURCE fact alone |

### §1f Un-pin accessors added (E, `scripts/_boot.js`)

R21 had ONE fleet pin and three gates that un-pinned it, so each carried its own
copy of the accessor. R22 has FOUR pins and FIVE gates un-pinning them in
different combinations — twenty copies of the same eight lines, each free to
drift. `unpinPins(names)` is that accessor, once, exported additively:
nothing above it in `_boot.js` changed, so every existing harness still boots
fully pinned (**proven: `verify-boot` ALL PASS on this tree after the edit**).

| Gate | Un-pins | Deliberately does NOT un-pin |
|---|---|---|
| verify-terra | **W2: none.** TERRA is armed through A's own `window.__flyTerraForce = {sharp,pipe,cache}` (the `__flyAerialOverride` idiom), so the fleet pin every other harness depends on is never touched — and the gate's result does not change when Fable later flips `TERRA_*.enabled`. `R22_TERRA=on` arms; the default forces all three OFF, which is the RED state | `__flyTerraPin` |
| verify-arrival | `__flySettlePin` (B's family has no per-family override) + TERRA via `__flyTerraForce` as above | `__flyTerraPin`; `__flyAerialOverride` — verify-aerial owns that un-pin and the ruling is not reopened; the SAT_QUILT evidence here is a uniform read plus a screenshot |
| verify-settle | `__flySettlePin` | `__flyTerraPin` — pop-in and stutter are B-owned, and letting A's pipeline change the stream-in ordering underneath them makes every number a two-variable experiment |
| verify-clutter | `__flyClutterPin`, and C shipped it THREE-VALUED: `1` legacy / `0` live / `'freeze'` armed-with-clock-0. The Owens-zero and +N-draw legs run LIVE (empty while frozen would prove less); the determinism and five-control flicker legs run `'freeze'` | — |
| verify-depth2 | `__flyDepthPin` | `__flySatShadowOverride` — the shadow A/B drives `window.__flySatShadow.set()`, the imperative handle verify-aerial itself uses, so no other gate's frozen pixels can move |

A gate proves it un-pinned rather than assuming it: the swallowed fleet write is
preserved on `window.__r22PinAttempt[name]` and printed in the first line of
every run (`pin un-pinned: value=null (fleet attempted 1)`).

---

## §2 W2 post-merge smoke (run after EACH merge, in order A → B → C → D)

The plan's merge order is A → B → C → D. E's smoke set per merge is
verify-stability + verify-terra + verify-arrival (plan §3), plus the merged
agent's own new gate.

| After merge | verify-stability | verify-terra | verify-arrival | owner's gate | Notes |
|---|---|---|---|---|---|
| **A TERRA** (`—`) | — (W2) | — (W2) | — (W2) | — | expect T1–T7 to flip; B/C/D-owned reds must NOT move |
| **B SETTLE** (`—`) | — (W2) | — (W2) | — (W2) | verify-settle — (W2) | expect T8/T8b/S-* to flip |
| **C CLUTTER** (`—`) | — (W2) | — (W2) | — (W2) | verify-clutter — (W2) | expect C1 + every SOFT-pending-C to become a live assertion |
| **D DEPTH** (`—`) | — (W2) | — (W2) | — (W2) | verify-depth2 — (W2) | expect D1–D5; `DEPTH_PASS` ships OFF, so BOTH states are certified |

---

## §3 W3 run matrix

> Tree: `d5fdb1a` (round branch after the three owner-fix merges), E's worktree,
> own dev server on `:3224`. Rows written as each harness completed.

### 3.1 The five R22 gates — ALL GREEN against their frozen REDs

| Harness | Result | Red → green |
|---|---|---|
| **verify-terra** | **PASS 18/18** | camTileZ **13 → 18** at P-LEWIS · z18 **not requested → requested** · DEM **15 → 16** · cold FL300 arrival **267 → 46 requests** · `fly-raster-v1` **absent → 1202 entries** · second visit **0.60 → 0.32×** · `terraStats` published (`sharpReason:'target'`) · Owens **200 ≤ 261** · P-LEWIS tris 472 k ≤ 2.0 M · textures **61 MB ≤ 300** |
| **verify-arrival** (`R22_ARRIVAL_SANCTION=1`) | **PASS 17/17** | hold **2300 ms** against the consumed **6500** cap · content-at-reveal deficit 1 · boot reveal camTileZ **12 → 16**, boot **9.3 → 6.0 s** · local warp `reason='flash'` correct for a 2-level deficit |
| **verify-settle** | **PASS 14/14** | boot pop **closed** · warp satRoads **+9.5 s → inside grace** · throttled-HDRI worst frame **179 → 154 ms** (B's arms 576–714 → 132–165) · parcel born at **4 %** of settled scale (was 100 %) · `groundElevVis` **1.67 m/frame** vs raw **3707** · ladder **0 → 2** render-scale rungs at dpr 1 |
| **verify-clutter** | **PASS 17/17** | trees **42 → 58 tris**, bbox Y **[-1,1] → [0,1]** (they stand on the ground) · **+3 draws exactly**, one per non-empty pool · pools 242/34/132 all inside §5.9 · **Owens 0/0/0 and draws identical across the flip** · anti-dup **0 inside columns** · determinism + freeze **both green** · flicker p99 **7.85 ≤ 12** |
| **verify-depth2** (ship state, off) | **PASS** | every OFF assertion green — nothing enlisted, no catcher, no AO pass, `nearStartM` 0 |
| **verify-depth2** (`R22_DEPTH=on`) | **PASS** | receive set **22/22 flagged, 0 orphaned** · catcher mounts · **Owens 211 ≤ 261** with catcher + N8AO · receive-set cost **−0.09 ms** (22 tiles on vs 0 off) · `nearStartM` armed |

### 3.2 Frozen-number harnesses

| Harness | Result | Frozen number |
|---|---|---|
| **verify-stability** | **PASS** | R21 quartet — **GREEN** |
| **verify-flicker** | **PASS** | R21 quartet — **GREEN** |
| **verify-tier-step** | **PASS** | R21 quartet — **GREEN** |
| **verify-seam** | **PASS** | R21 quartet — **GREEN** |
| **verify-sat-depth** | **PASS** | Owens ≤ 261 — **GREEN** |
| **verify-sat-mobile** | **PASS** | the §5.4 flip's MANDATORY condition — **GREEN** |
| **verify-aerial** (no `R22_AERIAL_SANCTION`) | **PASS** | textures **66 MB ≤ 300**, Owens **195 ≤ 261**, quilt ramp derived from source (0.174 = 0.174) |
| **verify-skyline** | **PASS** | Owens, near-crop — **GREEN** |
| **verify-neon-cover** | **ALL GREEN, flag ON** | five R18 hashes byte-exact; toy **455 ≤ 480**, **1.968 M ≤ 2 M** |
| verify-boot / -fleet / -hangar / -sat-night / -suburbia / -parcel-homes / -veg / -groundlife / -monuments / -monuments-sat / -icons | — see §3.2b | |

### 3.2b Fleet batch — filled as rows complete

| Harness | Result |
|---|---|
| **verify-boot** | **ALL PASS** |
| **verify-fleet** | **PASS** — count arithmetic FROZEN, unmoved |
| **verify-hangar** | **PASS** — count arithmetic FROZEN, unmoved |
| **verify-sat-night** | **PASS** |
| **verify-suburbia** | **PASS** |
| **verify-parcel-homes** | **PASS** — SURFACE_CALM placement FROZEN, unmoved |
| **verify-veg** | **PASS** — the SAT_VEG +1-draw invariant holds with trees2 |
| **verify-groundlife** | **PASS** |
| **verify-monuments** | **PASS** |
| **verify-monuments-sat** | **PASS** — FROZEN by plan §4, unmoved |
| **verify-icons** | **PASS** |
| **verify-roofs** | **PASS** |
| **verify-roof-variety** | **PASS** |
| **verify-window-grids** | **PASS** |
| **verify-rim** | **PASS** |
| **verify-edge-fx** | **ALL PASS** · pageErrors 0 |
| **verify-globe** | **ALL TRUE** (drawBudget / tracersSeen / neonChunks / warped / pageErrors) |
| **verify-globe2** | **PASS by inspection** — this harness prints stats and `pageErrors: 0` and exits 0; it has no `VERIFY:` line. Recorded as such rather than as a mechanical green (R23 follow-up: give it one). |
| **verify-dusk** | **PASS** |
| **verify-sun** | **PASS** |
| **verify-poi** | **PASS** — the frozen timing contracts hold |
| **verify-atlas** | **PASS** |
| **verify-tracers** | **PASS** |
| **verify-chase-cam** | **PASS** — the frozen framing gate holds |
| **verify-feel** | **PASS** |
| **verify-freelook** | **PASS** |
| **verify-airbend** | **PASS** |
| **verify-crash** | **PASS** |
| **verify-juice** | **PASS** |
| **verify-spicy** | **PASS** |
| **verify-contracts** | **PASS** |
| **verify-living-contracts** | **PASS** |
| **verify-logbook** | **PASS** |
| **verify-photo** | **PASS** |
| **verify-neon-alt** | **ALL GREEN** — 19 PASS, 0 FAIL |
| **verify-weather** | **PASS** — see §3.7: a first run read a rim red that was CONTAMINATION |
| **verify-warp-arrival** (plain) | **PASS** — hold 3291 ms, 60/73 ready at reveal, 109 ready at +8 s |
| **verify-warp-arrival** (`R22_ARRIVAL_SANCTION=1`) | **NOT VALIDATED** — the sanction leg carried the pin fault in §3.7; fixed, not re-run this pass |
| **verify-fly-models** | **no verdict line** — prints `model warnings: none` / `pageerrors: none`, exits 0 |
| **verify-fly-formation** | **no verdict line** — prints `pageerrors: none`, exits 0 |
| **verify-sat-buildings** | **PASS** |
| **verify-classify** (node) | **PASS** |
| **verify-warbirds** (node) | **PASS** |
| **verify-daily** (node) | **PASS** |
| **verify-player-nose** | **no verdict line** — like `verify-globe2`, this harness exits 0 without a `VERIFY:`/`RESULT:` line. Not counted as green. |

> These rows were RE-RUN after a session limit killed the first fleet batch
> mid-flight. Verdicts seen in a terminal poll but not written to this ledger
> before the kill were discarded rather than transcribed: a half-finished batch
> is testimony, not evidence (the R21 close ruling, applied to my own run).

### 3.3 Soaks

| Soak | Result |
|---|---|
| **SATELLITE 15 min** | **SOAK: PASS — all five BLOCKING gates** |
| **TOY 15 min** | **COMPLETED** — no blocking gates by design. p95 worst **12.5 ms**, fps floor ≈**80**, heap **478 → 341 MB** (falling), rebase worst 0.4 ms, **0 pageerrors**. Scene-total maxima: **483 draws / 2.83 M tris** — see the ruling below. |

### 3.3c The toy soak's 483-draw scene total — recorded, not judged

The toy soak reported `maxDrawCalls` **483** against a toy ceiling of 480, and
`maxTriangles` 2.83 M against a fixed-pose bound of 2 M. **This is not a red
frozen number, and the reason is a standing ruling, not a convenience.**

- The R20 close **demoted scene-total maxima** after proving they cannot resolve
  a feature delta from same-config spread. A soak total is a transient sampled
  from a breathing world — traffic surged past 900 aircraft in this run — and
  the frozen ceilings are the **fixed-pose** ones.
- The fixed-pose toy numbers, measured in this same sitting by
  **verify-neon-cover: 455 draws ≤ 480 and 1.968 M tris ≤ 2 M — GREEN.**
- **R21 recorded exactly this, at 481**, in its own close ("a breathing soak
  total of the kind R20 ruled unable to judge; fixed-pose toy ceilings 406–459
  ≤ 480 same sitting"). R22 reads **483** — the same phenomenon, two above
  R21's number and three above the ceiling it is not measured against.

It is recorded here rather than waved through, because two rounds now have seen
a soak transient sitting just over a fixed-pose ceiling, and the honest reading
is that **the toy soak has no instrument that can tell a real toy draw
regression from its own breathing**. That is a gap, and it is a named R23
follow-up: give the toy soak a fixed-pose probe leg so it can assert something,
or stop reporting a number nobody is allowed to act on.

**Satellite blocking gates, measured:**

| Gate | Bound | Measured |
|---|---|---|
| p95 triangles | ≤ 2 200 000 | **824 202** (p50 303 297, max 873 412) |
| p95 draw calls | ≤ 375 | **248** (p50 230, max 253) |
| heap climb | < 60 MB | **−81 MB** — the last-third floor is *lower* than the first-third floor (159 → 78 MB) |
| governor steps | ≤ 4 | **0**, tier `high` the whole run |
| pageerrors | 0 | **0** |

**The heap answer the round needed.** A's raster cache was the specific worry —
a new persistent layer holding imagery and DEM across a 15-minute three-leg
route. The heap floor **fell 81 MB** over the run, so the cache is not
retaining: it is Cache-API backed, which is disk, not heap. Recorded as the
direct answer to "watch heap with the raster cache live".

**§5.10 informational (never gated):** `gpuFrameMs` p95 worst **3.68 ms**,
median 3.34 ms over 76 samples, against an R23 blocking-candidate target of
12 ms — measured through `EXT_disjoint_timer_query_webgl2`, i.e. a real GPU
time rather than an rAF interval wearing a GPU name.

### 3.3b GATES THAT KEPT THEIR OWN COPY OF A SANCTIONED CONSTANT — twice

Two harnesses failed the round for doing exactly what the round sanctioned, and
the fault is the same both times: **the gate held a private copy of a value the
round moved.**

1. **verify-aerial, §5.7.** Red on "quilt grade tracks its AGL ramp — desat
   0.174 vs ramp 0.350", with the shader exactly right. The gate hard-coded
   `0.35 * smoothstep(4000, 9000)`; the shipped constants are **0.22 / 12000**,
   which give `t = (9650−4000)/(12000−4000) = 0.706 → smoothstep 0.792 → ×0.22 =
   0.174` — the measured value to three decimals.
2. **verify-terra, §5.5.** Red on the LOD curve because the gate asserted the
   PLAN's starting curve (1.0 at low AGL). A **re-measured it before shipping** —
   the plan's 1.0 took Owens to **291, breaking the 261 ceiling** — and shipped
   `[600,0.86][3000,0.82][9000,0.78]`. Worst |Δ| against the shipped
   interpolation is now **0.00060**.

Both are fixed the same way: the expectation is **derived from
`lib/fly/fly-constants.js` at run time**, so the ARITHMETIC is asserted and the
VALUES are not. Neither number was edited to match. (Each fix also needed a
second pass — a broken regex escape in one, an `indexOf('],')` that stopped at
the first inner pair in the other; both caught because the gate PRINTS the
constants it parsed.)

**The rule this earns: consuming a value move must include re-basing every gate
that asserts it, and a gate that can quote a constant should read it, not copy
it.**

### 3.4 W3 instrument faults — mine, all found by running

Seven times a W3 gate reported a product failure that was the harness
mis-measuring. Every one is fixed; the pattern is the lesson.

1. **verify-terra measured a world it had switched off — twice, two ways.**
   W1/W2 the file defaulted to forcing all three TERRA families OFF. The first
   W3 fix made the default "ship state = no override, the constants decide" —
   also wrong: `_boot.js` pins `__flyTerraPin = 1` fleet-wide and
   `terraSharpOn()` is `enabled && !terraPinned()`, so **the pin wins** and every
   TERRA feature read inert on a tree where all three are ON. Both runs produced
   six plausible product failures. Now: **default ARMED**, plus **gate (0)**,
   which asserts the arm took — `terraStats` is published only when armed, so its
   presence is the arm's own receipt and a mis-armed run fails FIRST with the
   reason instead of last with six symptoms.
2. **verify-depth2 read the wrong field for the near band.** `AERIAL_PERSPECTIVE.startM`
   does not move by design — D's near band is a new `uNear` uniform laid under
   it. Re-pointed to `nearStartM` — and then a second fault: the override must be
   held **across frames**, because `__flyAerial.get()` returns state the frame
   loop recomputes, so lift-and-read in one `evaluate` returns the previous
   frame.
3. **verify-depth2 detected N8AO by pass NAME**; D's pass was unnamed (it is
   `'N8AOPass'` now). Re-pointed to `window.__flyN8AO.get()`.
4. **verify-depth2's receive-set probe was vacuous** — it set `receiveShadow`
   on tiles it selected itself, so the "on" and "off" arms were the same world
   once the feature already enlisted them. Now A/Bs **D's own
   `__flyDepthSub.nearReceive`** and asserts D's telemetry
   (`sweep.live.flagged === sweep.near`).
5. **verify-clutter hashed C's A/B toggles, not the instancers**, so gate (16)
   was **passing null-vs-null** — a vacuous pass of exactly the kind the R20
   close ruling demoted. Re-pointed to the live `.mesh` getters.
6. **verify-clutter's anti-dup counted hash-cell cohabitation, not
   containment.** `queryColumns(x, z, 0)` answers with the BUCKET's occupants;
   my probe read 12 of 242 "inside". C's exact census reads **0 of 268**, nearest
   car **+31.29 m** clear. An instrument built from a bucket lookup cannot answer
   a containment question.
7. **verify-settle (8b) measured the FIX as a defect.** A *relative* step is
   meaningless during a birth ramp that starts near zero: born at 4 % of settled
   scale reads as "+390 % in one sample". Retired; gate (8) carries the claim.

Three more corrections came from the owners' own evidence and are recorded with
them: the `__flyTerraPin` un-pin in verify-arrival (9b) and verify-settle's warp
leg (**an instrument that cannot observe a state reads it as zero** — pinned:
hold 0; un-pinned: deficit 6, hold 1322 ms), same-tick pose pinning in
verify-clutter's determinism leg (the flight model integrates ~2.5 m before a
2500 ms freeze, so two "identical" sessions placed hash-stable content around
two different origins), and the settle predicate now requiring `realCols` to
stop growing (the R21 P5 lesson: the building ring passed 95 % while the column
index held **43 of an eventual 1844**).

### 3.5 Findings closed by the owners

| # | W3 finding | Closed by |
|---|---|---|
| 1 | 0 of 167 terrain meshes receiving with `nearReceive` armed | **D** — the library re-asserts tile state every frame; the flags must be re-stamped, not flipped once. Now 22/22 flagged, 0 orphaned. |
| 2 | Owens tris 203 068 → 203 166 across the clutter flip | **ratified** — the gate asserts draws + pool counts and REPORTS tris (the R20 ruling: a scene total cannot resolve a feature delta from same-config spread) |
| 3 | mover set-hash moving under `'freeze'` | **C** — livePin fix; post-boot `'freeze'` now actually reaches the clock |
| 4 | poles not bit-identical cross-boot | **C** — same-tick pose pinning; all three pools bit-identical across independent sessions |
| 5 | 12 of 242 cars "inside" a column | **C** — exact containment census, **0 of 268** |
| 6 | layers assembling after the reveal | **B** — roads t90 at reveal **minus 1301 ms** with both pins lifted, roadFrac 0.875 over the settled 16-chunk ring |

## §3.7 Two reds that were the MACHINE, not the tree — and one that was my pin

The last fleet batch produced three failures. All three were re-examined before
being written down; none is a product defect.

| Red | First reading | Quiet re-run | Verdict |
|---|---|---|---|
| verify-weather "rim stays a smooth gradient" | **26.0**/255 against a bound of 18 | **0.8**/255 | **CONTAMINATION.** The first run shared the machine with a parallel harness batch. 0.8 is not "just under the bound", it is thirty times under it — the failing number was never a measurement of this tree. |
| verify-warp-arrival "streaming not slower than baseline" | **56** chunks ready at +8 s (bound 60) | **109** ready at +8 s | **CONTAMINATION**, same batch, same cause. |
| verify-warp-arrival "R22 §5.1 content at reveal" | camTileZ **13** vs departure 15 | *not re-run* | **MY PIN FAULT.** This leg reads a tile zoom that only means anything when TERRA is armed, and the file runs under `__flyTerraPin=1`, so it measured the LEGACY reveal. Exactly the shape B proved for verify-arrival (9b). **Fixed** — the sanction leg now un-pins `__flyTerraPin` + `__flySettlePin`, scoped so an unflagged run stays byte-identical to R6's — but **NOT re-run in this pass**, and it is listed as NOT VALIDATED rather than assumed. |

**The operational lesson, and it cost this sweep three false alarms: a temporal
gate run on a busy machine is not a measurement.** The re-run discipline
(`re-run any temporal red once quiet before recording it`) is what kept two
non-defects out of the round record.

## §3.6 Money shots — the checkpoint evidence

Captured by `scripts/r22-e-moneyshots.js` into `scripts/r22-e-money-*.png` +
`r22-e-moneyshots.json`. Both arms are THE SAME TREE with the R22 families
forced off/on through the per-family overrides, at the same pinned pose, same
pinned sun, hero and traffic parked — so a pair is a controlled comparison, not
two screenshots from different weeks.

| Pair | before | after | reading |
|---|---|---|---|
| **#1 P-LEWIS** (126 m AGL) | camTileZ **17**, tris 249 583, clutter 0/0/0, canopy **42** tris | camTileZ **18**, tris **501 194**, clutter **212 / 35 / 130**, canopy **58** tris | the headline: a deeper tile, twice the ground geometry, and cars/poles/trees that were not there. Draws **228 → 237** (+9: +3 clutter pools, +6 the deeper tile ring) — well inside 375. |
| **#2 P-DUBLIN** at the reveal | hold **2330 ms**, camTileZ 10, maxLeafZ 12 | hold **2359 ms**, camTileZ 10, maxLeafZ 12 | **the cruise view is unchanged, and that is the honest answer.** What moved is the cost of getting there (267 → 46 raster requests, second visit 0.32×), not the texel density — three-tile will not subdivide the tile under the aircraft at FL300. Checkpoint #2 must be framed this way. |
| **Owens control** | draws **224**, clutter 0/0/0 | draws **225**, clutter **0/0/0** | **no content added — the lock holds.** But the frames are NOT pixel-identical: triangles go 207 392 → 375 025 because `demMaxZoom` 16 tessellates the terrain more finely (sanction §5.5). "Owens looks identical" is true of CONTENT and false of MESH DENSITY, and saying it loosely would misrepresent the control. |
| **#3 DEPTH_PASS** at P-LEWIS | draws **237** | draws **243** | **exactly +6 draws** — D's approved N8AO budget, on the nose. Triangles unmoved (501 584 → 501 686). This is the pair user checkpoint #3 decides on. |

## §4 Consumed-move ledger (plan §5)

| # | Move | State | Evidence |
|---|---|---|---|
| 1 | `WARP.far.holdMaxMs` 3500 → **6500** + verify-warp-arrival 5600 → 7400 | **CONSUMED** | verify-arrival (3) with `R22_ARRIVAL_SANCTION=1`: cap read as 6500 from `arrivalStats.holdCapMs`, actual hold **2300 ms** — the sanction bought headroom the run did not need to spend. The content assertion landed WITH it, as the sanction required. |
| 2 | verify-aerial texture bytes 300 → 450 MB | **NOT CONSUMED** | A measured 68 MB at z18; E measures **61 MB** (verify-terra) and **66 MB** (verify-aerial). The 300 cap holds with >4× margin. The `R22_AERIAL_SANCTION` leg stays prepared and inert, and verify-terra's 450 branch was **retired** so it cannot relabel a pass. |
| 3 | Fixed-pose draw BANDS ≤ +6 calls | **within budget** | P-LEWIS **+3 exactly** (one per non-empty clutter pool, zero for empty). Owens **+7** with DEPTH armed (catcher +1, N8AO +6) — inside D's approved budget, and **211 ≤ 261**. |
| 4 | `AERIAL_PERSPECTIVE.content` → true, `minTier` → medium | **CONSUMED** | verify-depth2 (13) green in BOTH depth states; **verify-sat-mobile PASS** (the mandatory condition). The W2 arbitration made `minTier` real — the flip as originally written was a no-op. |
| 5 | `satMaxZoomByTier.high` 17 → 18; `demMaxZoom` 15 → 16 | **CONSUMED** | verify-terra (5) max imagery zoom **18**, (11) DEM **16**; probe-backed at W1 (z16 LERC real at 3/3 poses, z17 a 67-byte degenerate surface). |
| 6 | World-bend key moves (≤ 3) | **within budget** | verify-neon-cover ALL GREEN with the five R18 hashes byte-exact; verify-sat-night, verify-roofs, verify-window-grids all PASS. |
| 7 | `SAT_QUILT` desatMax 0.35 → **0.22**, outAglM 9000 → **12000** | **CONSUMED** | verify-aerial's ramp gate REQUIRED re-basing with it (§3.3b) and now derives the ramp from source: measured **0.174 = expected 0.174** at 9650 m AGL. Checkpoint #6 reviews the taste. |
| 8 | `CANVAS.dprMin` 1 → 0.75 (+ subStep 0.125) | **CONSUMED** | verify-settle (11): **2 render-scale rungs** before the first tier step at dpr 1 (red: 0); the dpr-1.5 control went 2 → 4. |
| 9 | New pool budgets (C) | **CONSUMED, all inside** | parked 242 ≤ 1500 / 5 324 tris ≤ 48 k · moving 34 ≤ 300 / 748 ≤ 12 k · poles 132 ≤ 900 / 2 640 ≤ 20 k · trees2 58 tris/instance ≤ 96, pool 48 488 ≤ 320 k. |
| 10 | Soak informational `gpuFrameMs` p95 | **CONSUMED, exercised** | satellite soak: worst **3.68 ms**, median 3.34, 76 samples, real GPU timer. Never gated; the five blocking gates are unchanged. |
| 11 | NEW fixed-pose tris gate P-LEWIS ≤ 2.0 M | **LIVE, GREEN** | 472 051 tris armed (239 637 disarmed). |
| — | D's N8AO **+6 draws** (plan said +3) | **APPROVED by Fable** | Owens 204 → 211 with catcher + AO; **211 ≤ 261**. |
| — | `ARRIVAL_GATE.bootTerms` | **NOT consumed — escalated** | B measured the boot content terms at **+2.6 s** against an envelope plan §4 freezes. The boot reveal is therefore out of scope BY DECISION, and verify-arrival prints that in its own output so a later reader cannot mistake a deliberate non-fix for a missed one. |

## §5 Frozen numbers (plan §4) — read on the integrated tree

**No frozen number went red anywhere in this sweep.**

| Frozen | Bound | W3 reading |
|---|---|---|
| Owens draw ceiling | ≤ 261 | **GREEN** — 200 (terra, armed) · 195 (clutter, aerial) · 204 (depth off) · **211 (depth ARMED, catcher + N8AO)** · verify-sat-depth PASS |
| Satellite draw ceiling | ≤ 375 | **GREEN** — soak p95 **248**, max 253; fixed poses 222–251 |
| Toy draw ceiling | ≤ 480 | **GREEN** — verify-neon-cover fixed poses, worst **455** |
| Toy triangles (fixed pose) | ≤ 2 M | **GREEN** — verify-neon-cover worst **1.968 M** |
| Satellite soak p95 triangles | ≤ 2 200 000 | **GREEN — 824 202** |
| Satellite soak p95 draws | ≤ 375 | **GREEN — 248** |
| Heap climb (satellite soak) | < 60 MB | **GREEN — −81 MB** (the floor FELL, with the raster cache live) |
| Governor steps per soak | ≤ 4 | **GREEN — 0** |
| Soak pageerrors | 0 | **GREEN — 0** |
| R18 neon-cover hashes | 5, byte-exact | **GREEN — ALL GREEN, flag ON** |
| R21 stability quartet | all green | **GREEN** — stability / flicker / tier-step / seam all PASS |
| verify-weather rim gradient | ≤ 18/255 | **GREEN — 0.8** (a first run read 26.0 under machine contamination; see §3.7) |
| verify-warp-arrival toy streaming | ≥ 60 ready at +8 s | **GREEN — 109** (contaminated first run read 56; §3.7) |
| verify-neon-alt / -neon-city / -sat-buildings | frozen | **GREEN — all PASS** |
| verify-monuments-sat | frozen | **GREEN — PASS** |
| verify-fleet / -hangar count arithmetic | frozen | **GREEN — both PASS** |
| `BOOT.maxBootMs` + boot reveal timing | may not lengthen | **GREEN — and it SHORTENED**: P-DUBLIN boot **9.3 → 6.0 s**; Powell reveal 10.0 → 7.3 s |
| SURFACE_CALM parcel PLACEMENT | untouched | **GREEN** — verify-parcel-homes PASS; Melton settles 1867 (W1 1868–1874), Powell places 0 |
| Medium/low tier pixels | byte-identical except §5.4 | **GREEN** — the §5.4 flip only; **verify-sat-mobile PASS** |
| P-LEWIS fixed-pose tris | ≤ 2.0 M (new) | **GREEN — 472 k** |

## §6 VERDICT

**R22 is CERTIFIED for ship on `d5fdb1a`, with four harnesses named unrun and
the soaks/money-shot capture governed by a user decision recorded below.**

### 6.1 What is green

- **No frozen number is red.** Owens **195–204**, and **211 with `DEPTH_PASS`
  fully armed**, against a ceiling of 261. Satellite p95 draws **248** ≤ 375.
  Toy fixed-pose **455** ≤ 480 and **1.968 M** ≤ 2 M. The five R18 neon-cover
  hashes byte-exact. `verify-monuments-sat`, `verify-fleet` and `verify-hangar`
  unmoved. `BOOT.maxBootMs` not merely held but **improved** — P-DUBLIN boot
  **9.3 → 6.0 s**. Full table in §5.
- **The R21 stability quartet is all green** — stability / flicker / tier-step /
  seam.
- **All five R22 gates pass against their frozen W1 reds**: terra 18/18,
  arrival 17/17, settle 14/14, clutter 17/17, depth2 PASS in BOTH
  `DEPTH_PASS` states. Every row of the §3 defect table is closed or explicitly
  retired with its reason.
- **~60 fleet harnesses ran green**, including every satellite-visual,
  toy-visual, gameplay, HUD, mobile and node gate in the §3 list except the four
  named in §6.3.
- **Both soaks were in fact RUN in an earlier pass and are recorded in §3.3**:
  the SATELLITE soak **PASSED all five blocking gates** (p95 tris **824 202**,
  p95 draws **248**, governor steps **0**, 0 pageerrors, heap floor **−81 MB**
  with the raster cache live); the TOY soak completed clean with its scene
  totals recorded-not-judged per §3.3c.
- **The money shots were captured in that same pass** and are in §3.6.

### 6.2 User decision — soaks waived

**The user directed on 2026-08-10 that R22 ship immediately and WAIVED the
15-minute soaks for this round.** Recorded because a waiver is a decision, not
an absence: the soaks are deferred to post-ship verification (Fable runs the
satellite soak in the background after the merge), and the money-shot capture is
likewise deferred to Fable post-ship.

**This sweep's position is stronger than the waiver assumes**: both soaks and
the full money-shot set had ALREADY been run and recorded before the waiver
arrived (§3.3, §3.6). Nothing in the certification rests on work that was
skipped. The waiver removes a re-run, not a gap.

### 6.3 UNRUN — by name, not assumed

Four rows in the §3 matrix are **not green because they did not run to a
verdict**, and none of them is being counted:

1. **`verify-warp-arrival` with `R22_ARRIVAL_SANCTION=1`** — the plain run
   PASSES; the sanction leg carried my own pin fault (§3.7), which is FIXED in
   source but **not re-run**. This is the one row a follow-up should clear
   first, because it is the gate that certifies consumed sanction §5.1.
2. **`verify-fly-models`** — exits 0 with `model warnings: none` /
   `pageerrors: none`, but prints no `VERIFY:` line.
3. **`verify-fly-formation`** — same shape (`pageerrors: none`, no verdict).
4. **`verify-globe2` and `verify-player-nose`** — same shape again.

Rows 2–4 are almost certainly fine — they exit 0 and report no errors — but a
harness with no verdict line cannot be *mechanically* read as green, and this
sweep does not upgrade "exited 0" to "PASS" by inspection alone. **R23 follow-up:
give these four a `VERIFY:` line so a fleet sweep can read them.**

### 6.4 Standing caveats carried into the ship

- **`DEPTH_PASS` ships `false`**, certified in both states, pending user
  checkpoint #3. The +6-draw A/B pair is captured.
- **§5.2 (texture bytes 300 → 450) was deliberately NOT consumed** — measured
  61–68 MB against the 300 cap.
- **`ARRIVAL_GATE.bootTerms` stays false** — escalated, not spent (+2.6 s
  against a frozen boot envelope).
- **Seven of this round's harness reds were the harness, not the tree**
  (§3.3b, §3.4), and three more were machine contamination (§3.7). That is a
  poor showing for the instruments and it is written down in full rather than
  smoothed over, because the next round inherits these gates.

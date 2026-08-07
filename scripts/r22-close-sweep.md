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

## §3 W3 run matrix (the full fleet)

Every existing browser harness plus the five new ones. `—` until run.

| Harness | Gates | Result | Notes |
|---|---|---|---|
| verify-boot | — | — (W3) | |
| verify-fleet | — | — (W3) | count arithmetic FROZEN (plan §4) |
| verify-hangar | — | — (W3) | count arithmetic FROZEN |
| verify-sat-depth | — | — (W3) | Owens ≤ 261 |
| verify-aerial | — | — (W3) | §5.2 sanction armed here if consumed |
| verify-skyline | — | — (W3) | |
| verify-sat-buildings | — | — (W3) | |
| verify-sat-night | — | — (W3) | |
| verify-sat-mobile | — | — (W3) | **MANDATORY re-run if §5.4 content-haze flips** |
| verify-suburbia | — | — (W3) | |
| verify-parcel-homes | — | — (W3) | SURFACE_CALM placement FROZEN |
| verify-veg | — | — (W3) | SAT_VEG +1-draw invariant |
| verify-groundlife | — | — (W3) | |
| verify-monuments / -sat | — | — (W3) | **verify-monuments-sat FROZEN** |
| verify-icons | — | — (W3) | |
| verify-neon-city / -alt / -cover | — | — (W3) | five frozen R18 hashes; R22 flags join the all-off control set |
| verify-roofs / -roof-variety / -window-grids | — | — (W3) | |
| verify-rim / -edge-fx / -globe / -globe2 | — | — (W3) | |
| verify-dusk / -weather / -sun | — | — (W3) | |
| verify-poi / -atlas | — | — (W3) | verify-poi timing contracts FROZEN |
| verify-warp-arrival | — | — (W3) | §5.1 sanction armed here if consumed |
| verify-chase-cam / -feel / -freelook / -player-nose / -airbend | — | — (W3) | |
| verify-crash / -juice / -spicy / -contracts / -living-contracts | — | — (W3) | |
| verify-logbook / -photo / -daily / -classify / -warbirds | — | — (W3) | |
| verify-mobile / -mobile-layout | — | — (W3) | |
| verify-tracers / -fly-game / -fly-style / -fly-models / -fly-formation | — | — (W3) | |
| verify-inspect-actions / -airport-buzz / -style-retire | — | — (W3) | |
| **verify-stability** (R21) | 17 | — (W3) | must stay green ALL round (plan §4) |
| **verify-flicker** (R21) | 7 | — (W3) | five-control before/after for D (plan §6) |
| **verify-tier-step** (R21) | 10 | — (W3) | |
| **verify-seam** (R21) | 13 | — (W3) | |
| **verify-terra** (NEW) | 17 | — (W3) | |
| **verify-arrival** (NEW) | 16 | — (W3) | |
| **verify-settle** (NEW) | 14 | — (W3) | |
| **verify-clutter** (NEW) | 18 | — (W3) | |
| **verify-depth2** (NEW) | 16 | — (W3) | certified in BOTH `DEPTH_PASS` states |
| **soak-fly (TOY, 15 min)** | — | — (W3) | |
| **soak-fly (SATELLITE, 15 min)** | 5 blocking | — (W3) | p95 tris ≤ 2.2M, p95 draws ≤ 375, heap flat, gov steps ≤ 4, 0 pageerrors; + informational gpuFrameMs p95 (§5.10) |

---

## §4 Consumed-move ledger (plan §5)

Every consumed move needs an inline `R22 SANCTIONED: old → new` comment in the
source, a measured control, and a row here.

| # | Move | Consumed? | Inline comment at | Measured control | Owner |
|---|---|---|---|---|---|
| 1 | `WARP.far.holdMaxMs` 3500 → 6500 + verify-warp-arrival 5600 → 7400 | — (W2) | prepared in `verify-warp-arrival.js`, inert behind `R22_ARRIVAL_SANCTION` | must land WITH the content assertion | B / E |
| 2 | verify-aerial texture bytes 300 → 450 MB | — (W2) | prepared in `verify-aerial.js`, inert behind `R22_AERIAL_SANCTION`, and spent only when z18 is observed | W1 anchor: ≈59 MB at z17 | A / E |
| 3 | fixed-pose draw BANDS ≤ +6 calls | — (W3) | | W1 anchors: Owens 200, P-LEWIS 226–230 | all |
| 4 | `AERIAL_PERSPECTIVE.content` false → true, minTier → medium | — (W2) | | verify-sat-mobile re-run MANDATORY | D |
| 5 | `satMaxZoomByTier.high` 17 → 18; `demMaxZoom` 15 → 16 | — (W2) | | **z16 LERC probe PASSED 3/3 poses (§1a)** — the precondition is satisfied | A |
| 6 | world-bend key moves (budget ≤ 3) | — (W2) | | each joins the PREWARM warm set in the same change | B |
| 7 | `SAT_QUILT` desatMax/inAglM | — (W2) | | verify-arrival (13) records the arrival-pose uniform | A |
| 8 | `CANVAS.dprMin` 1 → 0.75 | — (W2) | | **RED measured: 0 rungs at dpr0 1 vs 2 at dpr0 1.5** | B |
| 9 | new pool budgets (C) | — (W2) | | verify-clutter (11)(12)(13) | C |
| 10 | soak informational `gpuFrameMs` p95 | **PREPARED (W1)** | `soak-fly.js`, satellite mode only, non-blocking, marked pending sign-off | blocking set unchanged | E |
| 11 | NEW fixed-pose tris gate P-LEWIS ≤ 2.0M | **LIVE (W1)** | `verify-terra.js` gate (15) | W1 anchor: 246 607 tris | E |

---

## §5 Frozen numbers (plan §4) — re-checked at W3

| Frozen | Value | W3 reading |
|---|---|---|
| Owens draw ceiling | ≤ 261 | — (W3) |
| Satellite draw ceiling | ≤ 375 | — (W3) |
| Toy draw ceiling | ≤ 480 | — (W3) |
| Satellite soak p95 triangles | ≤ 2 200 000 | — (W3) |
| Governor steps per soak | ≤ 4 | — (W3) |
| R18 neon-cover hashes | 5, byte-exact | — (W3) |
| verify-monuments-sat | frozen | — (W3) |
| verify-fleet / verify-hangar count arithmetic | frozen | — (W3) |
| `BOOT.maxBootMs` + boot reveal timing | may not lengthen | — (W3) · W1 anchor 9.3 s |
| SURFACE_CALM parcel PLACEMENT logic | untouched | — (W3) |
| Medium/low tier pixels | byte-identical except §5.4 | — (W3) |

---

## §6 VERDICT

— (W3)

# FLY ROUND 24 — "SMOOTH WORLD" (RECORD)

Orchestrator: the session orchestrator. Executors: five agents — **A PACE** /
**B WORLD** / **C LIGHT** / **D ATMOS** / **E CERT** — in worktrees `r24/a..e`
off `6116fc5` (the R21 "Steady State" tree `3592656` + the W0 scaffolding),
plus a sixth agent (**F SCRIBE**) for this record. Plan:
[FLY_ROUND24_PLAN.md](FLY_ROUND24_PLAN.md) · kickoff:
[FLY_ROUND24_KICKOFF.md](FLY_ROUND24_KICKOFF.md) · evidence ledger:
[`scripts/r24-recon.md`](scripts/r24-recon.md) · per-agent ledgers
`scripts/r24-{a-pace,b-world,c-light,d-atmos,e-cert}.md` · certification
ledger [`scripts/r24-close-sweep.md`](scripts/r24-close-sweep.md) · user
diagnosis pack [`scripts/r24-user-diag.md`](scripts/r24-user-diag.md).
Integration branch `claude/skyloom-r24-orchestration-6753n2` (the plan's
"main" for this round; fast-forwarding `main` is the user's call).

---

## §0 Why this round exists, and what the user said

After R21 the user reported, on "the last few newest builds":

> **"The last few newest builds had symptoms of really bad screen tearing and
> glitching, mainly buildings appearing and disappearing, and terrain tiles
> swapping for other ones."** (2026-09-06)

The build(s) were **not named**, and Rounds 22, 22.1 and 23 are archived, not
merged (`archive/r22-r23-main-44ec502`) — so the report may describe a tree
this one does not contain. Every mechanism in §1 was therefore shown to exist
**ON THIS TREE at file:line** before it was fixed; the archived rounds are
cited only as diagnoses.

**The second open question was never answered.** Plan §0 asked which symptoms
were seen on which build, and for the machine (GPU, resolution, DPR, refresh,
browser, windowed vs fullscreen). No reply arrived. **The plan's defaults were
used throughout: a DPR-1 60 Hz desktop, Chrome, satellite style** — and two
consequences are load-bearing rather than cosmetic: the DPR-1 assumption is
what makes A's ladder finding (A4/FL-13) *the first governor step this user
gets*, and the satellite assumption is what scoped C's and D's work away from
Neon.

**Venue.** The container 403-blocks Esri, OpenFreeMap, open-meteo and adsb.lol;
WebGL is ANGLE/SwiftShader (~1–3 fps at the game's load, bit-stable at a parked
pose); Chrome is absent and 57 harnesses pin `channel:'chrome'`; four cores
were shared by five agents plus the orchestrator (load 12–19 during browser
work). E's **offline world fixture** made the structural, count, census,
determinism and fixed-pose-pixel gates runnable here. **Every fps / ms / stall
/ tearing number in this round comes from the user's machine or is marked
"could not measure here".**

**What the user's machine has confirmed this round: NOTHING.** The diagnosis
pack went out early; Part A on the current build — the round's real RED — has
not come back. There is no "before", and therefore no performance verdict of
any kind. §4 and §6 restate this in their own terms; it is the single most
important caveat on the record.

---

## §1 Headline — the symptoms, traced to closed defects (measured)

### Symptom A — "buildings appearing and disappearing"

| Defect | What it was | Closed by | Measurement |
|---|---|---|---|
| **P1-at-speed** (WB-6) | R21's bend-margin census ran on the ORBIT phase at **speed 0, where the lookahead lead is 0**. The pad is short on ALL SEVEN rings the moment the aircraft moves: sat-buildings 54 · sat-roads 558 · sat-skyline 747 · toy full 241 · mid 1,205 · far 3,405 · ultra 31,412 m. The three pooled instanced layers (veg, parcel homes, **and SatTintLayer, unnamed by the recon**) pad with a 2 s-stale `maxD` and cull AS ONE OBJECT — a whole forest, suburb or landcover sheet vanishing at once | B `BEND_LEAD` | `r24-b-bend-proof.mjs`: `padON ≥ worstDrop` on **7/7** rings and `padON ≥ padOFF` everywhere (the pad can only ever KEEP geometry); `poolLeadM` 1500 m = 2 s cadence × 750 m/s; Owens 0 by construction (its chunks are `empty` and issue no mesh) |
| **Birth / evict / heal cut** (WB-2, WB-8) | every chunk appears and vanishes in ONE frame; a heal is delete-and-refetch — a hole for the whole rebuild latency, up to `healCap` 3× per key | B `CHUNK_FADE` + `HEAL_IN_PLACE` | `r24-b-engine-proof.js` (the REAL `SatBuildingEngine` + the REAL worker, headless, 90 s / 2,700 frames at 120 m/s, DEM refining twice): single-frame pops **92 → 2** (both `fadeBudgetMiss`, i.e. attributable), ramp steps **0 → 600**, heals **16 (0 in place) → 21 (all in place)**, evictions **40 → 24** |
| **The one-frame pale splat** (A1/A1b) | `@mapbox/vector-tile` closes every ring with a clone of `ring[0]`; the wall extruders walk it as OPEN ⇒ two exactly-degenerate `DoubleSide` triangles per ring and per hole, perturbed by the per-vertex bend | B `FLASH_GUARD` (zero-area filter at drape finalize, `minArea2` 0, same array by reference when clean) | node census **15,984 resident degenerate (14.19 %) → 0**; per builder 14.22 % sat-buildings / 14.84 % toy / 16.67 % suburb toy / **skyline 0**; `computeVertexNormals` **bit-identical** across the filter. The live fixture REDs, and what they change about this claim, are in §4.2 |
| **DEM refine sweeps every AGL-keyed fade** (T8/A6) | raw `groundElev` steps **384.0 m in ONE frame** when a finer tile lands, and seven visual consumers step with it | B `GROUND_VIS` | `r24-b-groundvis-proof.mjs`: worst per-frame delta **4.000 m**, converges in **95 frames**, a warp snaps 364 m by design; flight model, crash floor, cameras and every placement sampler keep RAW |
| **The first perf step is a TIER step on DPR-1** (A4/FL-13) | `buildLadder`'s DPR loop runs ZERO times at `devicePixelRatio` 1, so the ladder is `[1/high, 1/medium, 1/low]` — rung 1 unmounts the building and precip layers and rebuilds the composer. One bad second while a city streams is enough | A `LADDER_FIX` + `STEP_SAFE` | `verify-ladder-fix` 13 gates, `FLY_LADDER_RED=1` fails **6/13**. Ladder → `[1/high, 0.875/high, 0.75/high, 1/medium, 1/low]`; a 144 Hz display targets **144**; a 53.4 fps-mean session with 10 % long frames steps **render-scale first** where the EMA never steps at all; the clean-60 control never steps |
| **Shadow-map re-rasterization** (L5/FL-12) | a 2048² ortho following the plane at sub-texel steps (0.78 m/texel toy, 1.46 m satellite) with the PCF kernel rotated by a **screen-space** hash ⇒ every building silhouette re-rasterizes each frame — a second, independent root of "buildings flickering" | C `SHADOW_CALM` | `verify-shadow-calm.mjs` (node, **32 gates**, `a9e30cc` → `5ca8e15`; **33/33** on C's flipped branch) runs the patch against three's REAL chunk text both ways: off returns it byte-identical; both anchors occur EXACTLY once so VSM and BASIC cannot be touched; the reversed-depth `#ifdef` count goes **2 → 3**; reversing the edit reproduces three's text exactly. The snap runs numerically: 0.4 texel of travel moves the target **0.00e+0 m**, 1.4 texels moves it exactly one texel (**1.46484 m**), 401 samples over 10 texels give **11 distinct positions — a staircase, not a slide**. It caught a defect in its own module on the first run (`PHI_TO` defaulted every unrecognised kernel name to `'world'`; now an allow-list) |

**And the round shipped one of its own into this symptom, caught at the close.**
`FINALIZE_PACE`'s first rule — "the first chunk is not free" — compares
`lastDtMs` against a FIXED `longFrameMs` of **24 ms**, which makes it a LEVEL
detector rather than a spike detector: on any machine running steadily below
**~41 fps** (33 ms frames at 30 fps, 50 ms at 20 fps — laptops and integrated
GPUs, exactly the machines that report these symptoms) **every** frame is
"long", the first finalize of every frame is refused forever, and no building,
skyline, road or toy chunk ever lands. As merged at `91141fe` the flag would
have reproduced **"buildings never appear"** on a steadily slow machine. The
fixture venue only made it total (300–1000 ms frames) and is how it was found —
§4.2, pass 2a. The module's own header claimed the opposite invariant
("neither rule can starve a chunk — a deferred chunk is retried next frame"),
and that claim is false under sustained slowness.

Two mechanisms were examined and deliberately NOT touched (B ledger §8, rows
10–11): the skyline group `visible` flip and its AGL evict/re-arm hysteresis
are **pixel-neutral BY CONSTRUCTION** — a group parks only when its farthest
corner is inside `uSkyHole.x`, where every fragment is already discarded, and
both hysteresis ends (10,000 / 9,200 m) sit above `SAT_SKYLINE.fade.endM`
9,000. R21's reading of that as "a 4.9 km block of city blinking" is
unsupported by the shader.

### Symptom B — "terrain tiles swapping for other ones"

| Defect | What it was | Closed by | Measurement |
|---|---|---|---|
| **Merge on frustum exit** (T1) | `Tile._getDistRatio()` returns `inFrustum ? t*0.8 : t*5` — **×6.25 the instant a tile leaves the frustum**; `_LODEvaluate` uses one threshold for refine and merge with zero hysteresis; `_removeSubTiles` then downloads a fresh parent (a different Esri capture at a coarser zoom = "another tile") and disposes the children | A `TERRA_PACE.keepResident` + `mergeHysteresis` + `timerFix` | `verify-terra-residency.mjs` (the REAL vendored classes in node, 21 gates). **720° yaw sweep at a parked position: merges 22 → 0, tiles REPLACED WHILE ON SCREEN 17 → 0, parent refetches 178 → 0.** Attribution one switch at a time: `keepResident` closes it; hysteresis alone moves nothing (the ×5 already carries the ratio past `threshold × 1.6`). Vertical bob: merges 21 → 11, flips 27 → 16, refetches 89 → 63. Serpentine: replaced-on-screen **33 → 4**, refetches **176 → 28 (−84 %)**, requests **+0.7 %**. Controls identical in both arms (59/59 refines, 232/232 requests). Byte LRU: peak resident **126 → 95 MB**, 351 → 270 tiles. **Confirmed a third time, by a different agent's instrument under IDENTICAL conditions**: `verify-lod-fade`'s pure-yaw sweep read **27 re-appearances on the flag-off tree and 0 on the flipped one** (pass 1 vs pass 2b, same wall-clock sweep), with `residentTiles` 87 / `residentMB` 30.4 showing the byte LRU live. **The two fixes compose exactly as intended**: A removed the swaps that should never have happened, so D's baseline is now **4 hard refines, not the 20 of its pass-1 ladder**, and D blends the four that remain |
| **Quadtree walk every frame + wholesale freeze** (T3) | `Timer.reset` never zeroes `_elapsed` (the 50 ms guard is dead after 50 ms of uptime); the WHOLE tree update is skipped while `downloadingThreads + 4 >= maxThreads`. **E measured the consequence live: the tree stalled at maxZ 6, `groundElev` answered 193 m where Powell's true elevation is 276 m, every drape sample saw `tileZ 6 < demZ 12`, and the drape restarted forever** | A `timerFix` + `walkWhileSaturated` + `bboxCache` | timer **10/12 → 4/12** whole-tree updates. Loader held saturated: nodes visited **444 → 4,248** with refines **19 → 19** and requests **72 → 72** — strictly conservative. Honest cost: visits/walk 36 → 74 (`keepResident`) → **233** (with `walkWhileSaturated`); traversal per unit time 4,230 → 3,431 → 10,891 (gate-bounded at 4×). `bboxCache` heap over 400 walks **1,398 → 771 KB** |
| **Hard LOD pop** (T4 b/c) | a refine or merge is an atomic parent↔children swap in ONE synchronous block — no frame draws both, none draws neither — and the relief snaps with the texture (`7000·(1−z/17)³`: z13 ≈ 91 m, z15 ≈ 11 m) | D `LOD_CROSSFADE` (parent-texture clip-UV blend on refine AND merge, ~0 extra draws) | **RED on the fixture** (Powell altitude ladder 4000→1600→800→380→1600→4000 m, 640×360, A's pacing ON): **hardSwaps 20 / faded 0**, `skip.disabled 20` — un-faded because the flag is off, not because a guard fired; A's counters read refine 16 / replacedOnScreen 0 / **merges 0** (that zero is `keepResident` working, which is why D's value lands on REFINES). **The ON leg was never obtained** (§5.1) |
| **Skirt built on the main thread** (T2/A2) | `getBoundaryEdges` allocates 3·T pair-arrays and sorts them with a boxed comparator per DEM tile (~98 k arrays, ~1.6 M comparisons at 129²), on the MAIN thread, four children per microtask. Archived R22.1 profiling: 37 % + its comparator 30 % = **67 % of every stalled millisecond** | A `skirtFast`; `skirtWorker` BUILT-OFF | `verify-skirt-fast` **12/12** element-by-element identical through the PUBLIC `setAttributes` on 13 cases incl. six real Martini tiles up to **116,079 indices**, four non-manifold cases BAILING to the verbatim body; isolated algorithm timing **7.1× / 6.5×** (this container's CPU, not a frame time); table reuse proven (heap 16.5 → 9.2 MB / 25 tiles). `verify-skirt-worker` **8/8** node-identical (6,912 / 26,112 / 101,376 indices) |

**Why the live symptom reads worse than any fixture number.** The fixture
serves deterministic bytes per (z, x, y); Esri does not. A merge REPLACES four
children with a coarser parent, so on the fixture that parent is consistent
imagery and the swap reads as a resolution change — on the user's machine it is
a **DIFFERENT CAPTURE** (season, sun angle, colour), which the URL/position
probe cannot see because both are correct (§4.2, terra-live arm A: 0 mismatches
in 62 of 64 tiles). It is still LOD policy and the fix is unchanged; it is only
the reason no fixture number conveys how violent the live event looks.

### Symptom C — "screen tearing" (what this venue can and cannot say)

A tear line is a compositor/vsync property: no screenshot and no JS timer can
see it, and a software recorder composites it away. What CAN be asserted here,
and is: the DPR step reallocates the drawing buffer OUTSIDE any rAF and the
composer resizes a frame late (A3/FL-05 → `STEP_SAFE`, `verify-step-clean`);
the HUD `LabelCanvas` draws with the PREVIOUS frame's camera matrices, because
rAF callbacks run in registration order and LabelCanvas always registers first
— at 60 fps and ~60°/s of yaw that is ~1°, about **30 px on a 1920-wide
canvas** (FL-01 → `HUD_SYNC`); there is no fixed timestep, so a long frame
slows the world while traffic dead-reckoning keeps wall-clock time (FL-04 →
`FRAME_STEP`, sim half only); and sub-pixel procedural grain aliases under
SMAA-only AA (T13 → C's `microFwidth`). **The tear LINE itself is NOT
MEASURABLE here at all** — the gates assert the mechanism only, and **a phone
camera pointed at the screen beats a software recorder, because a recorder
composites.**

### Findings the round did not go looking for

- **three r185 handles the reversed depth buffer in two of its three shadow
  branches and not in PCF** — the one this app runs: `shadowCoord.z += bias`
  unconditional ⇒ every receiver biased toward SHADOWED by **~1.6 m** of world
  depth, and `normalBias 4` (**5.1 texels**) was paying to hide a sign error.
- **`HueSaturationEffect` ends `min(color, 1.0)` and ran BEFORE the tone map**
  since R13: a 3.2-linear lit window and a 12.0-linear runway light both landed
  on 8-bit **228**; after the reorder **254 / 255**, midtones unmoved (0.030 →
  26, 0.180 → 127 both ways). The merged EffectPass count **falls** (satellite
  high 4 → 3, toy high 6 → 5).
- **postprocessing + three r185 double-convert reversed depth**: every
  reconstructed viewZ ≈ −2.5 m = −`cameraNear` (−2.632 at 50 m, −2.509 at
  700 m, −2.501 at 8 km, −2.500 at 300 km), so the toy tilt-shift CoC was
  **flat 0.1762–0.1773 from 5 m to 300 km** — a uniform 18 % blur, i.e. "Neon
  reads globally soft". One token; GREEN error 0.000000 m. AerialPerspective's
  sky early-out has meanwhile **never fired**, saved only by its height term.
- **The 14 → 16 km haze handoff is a 2 km PLATEAU, not a seam** (two zero-slope
  samples; the cue restarts at 1/12 of its previous slope); the 16–55 km band
  has **no height term**; the two evaluators measure different rays (**+14.7 %**
  at cruise); medium/low have **no distance cue at all inside 16 km**.
- **On medium/low the key light NEVER MOVED** — azimuth **−56° at every hour of
  every day**, key↔hillshade **37.1° noon / 119.4° dusk / 109.6° night**. And
  measured live on the fixture at HIGH tier, Sierra pose: **key ↔ hill 10.50°
  with `live:false`** — the branch that writes the key position **never
  executed on the harness fleet, at any tier**, because `_boot.js` pins
  `__flySatShadowOverride = 0` and the write lived inside that shadow gate.
  Every R19–R21 satellite pixel gate certified a world lit by a constant
  (HARN-GAP-5, with a number).
- **The horizon seam cannot match by construction**: the closed-form DECODE
  ROUND-TRIP delta per 255 — noon **9.3** / golden **19.9** / night **76.3** /
  twilight **99.2** / Neon rim **89.4** → **0.000**, with zero constants moved.
  **Read that as what it is, because the round later had to**: the node oracle
  proves each setter writes `srgbToLinear` of the authored triple, **never that
  the rendered SEAM is 0** — a reading this record carried until C reversed it at
  the close. **Measured, with the decode ON**, the venue reads a seam of **53.1
  noon / 41.4 night** (tail re-run 53.4 / 40.1), the decode **narrowing** the
  noon seam by ~6 luma and **halving the hour dependence**; the residual is the
  rim re-tune C refused this round, not the decode (§4.2, §8).
- **`RING_DEDUPE` is not a pure removal**: restoring `ring[0]` changes corner
  counts and corner counts drive roof-form dispatch — Manhattan sat verts
  −15.6 %, skyline **+31.6 %**, Powell toy bundle **+17.4 %**, degenerate → 0
  everywhere, Owens `empty`/`zero` in both legs.
- **The venue's own trap**: at 1–3 fps the per-FRAME `drapeBudgetMs` never
  finishes a content chunk — six minutes at Powell, `ready 0` — so **every
  satellite content gate would have certified an empty city GREEN**.
- **`verify-depth-offset.mjs` caught `prewarm.js:280`** warming the tint twin
  with the pre-P8 raw `polygonOffsetUnits`, on the day the one-implementation
  rule was written. RED **6/7** on base, GREEN **7/7**, 185 files.

---

## §2 Waves

- **W0** (`6116fc5`): `WORKER_PROTOCOL 17→18` lockstep at all six pin sites;
  **26 pre-seeded `enabled:false` owner blocks**; the recon ledger; the R21
  records imported verbatim. **Zero constants conflicts across five agents** —
  the R18 idiom holding a fourth round.
- **W1a, merged first** (`aee2a86`): A's verbatim three-tile 0.12.1 vendor
  (`b64457b`) + the CRLF restore (`4bedab1`). C and D patched the vendored
  bundle only after it landed; patch rows are A 0–4 + 20–25, D 5–7, C 8–19.
- **W1** (five agents in parallel, own worktree, port and `.next` each):
  A `f739cb3` (13 commits) · B `06b8f1d` (16) · C `871f9be` · D `d30fc4c` →
  `6dc8817` · E `a071ee9` → `c7d538c`. Every feature behind its own block,
  every block `enabled:false` in-branch.
- **W2 (E → A → B → C → D, one reviewed merge each)**: E `ea772b4` (shim,
  fixture, `FRAME_STATS`, diag pack) · `4ab22f1` (fixture hardening, seven
  gates, smoke, close sweep) · `0c5a72f` (smoke path fix, `budgetK()`) ·
  `cf3ee49` (`force(dir)` sign fix, `_settle.js`, the offline seam node leg,
  flicker quiescence) · `8ddbff8` (R21 artifact restore, fs-level write
  redirect, `verify-artifact-hygiene`) · `f7cb9b6` · **A `720e3c1`** ·
  **B `cd6b759`** · **C `bd65e60`** (+ audit `66a2f0c`) · **D `fa380fd`**
  (+ audit `990c7b5`, + `190d2d6` scripts-only) · E `bf319ca`. Every merge was
  accepted on a dev-server `GET / 200` plus the full node-gate set; hygiene
  commit `453119e` restored `scripts/r21-e-red-seam.json`.
- **W3 (certification)** — and the round's worst hour. All five merged, 17/17
  node gates green, the run launched detached… and **the integrated tree could
  not boot**: `ReferenceError: ATMO_GLSL_DECL is not defined` at module
  evaluation, body "Something went wrong", 0 canvas, `__flyBoot` undefined.
  `eslint --rule no-undef` over the 50-file delta found **three unimported
  symbols on three different branches** (§5.1), fixed as node-only merges —
  **A `6aa2030`**, **C `961135c`**, **D `3f379ff`**, **B `8b68ae5`** (the
  reviewed `ENV_UNIFORM` warm) — after which `no-undef` reads **0** and
  `SMOKE_NODE_ONLY=1` reads **15/15**. Three more merges followed: C's node
  `verify-shadow-calm` (`a9e30cc` → **`5ca8e15`**), B's ledger §15 (`6d38245`
  → `5cdafce`) and E's cert-run hardening (head **`3a21403`**, merging after
  the run). **The certification run measures `5ca8e15`, not the `7a00df0` its
  banner first stamped** — `next dev` compiles the WORKING TREE on demand, so a
  startup stamp names the tree the script was launched from, not the one the
  server serves; the script now re-stamps `TREE UNDER TEST` immediately before
  the boot proof. On that tree the **boot proof passed: `BOOT OK in 62.5 s`,
  zero console errors, zero page errors, zero failed `/_next/` chunk requests,
  after 15/15 node gates.** Certification then runs in **two passes** — pass 1
  on the flag-off tree, pass 2 on the flipped tree — and §4 carries a marker
  per row. The owners' flip commits are written and **held on their branches
  until pass 1 ends**: D `327950b`, B `070b95b`, C `81338da`, A `5ddf5dc`,
  with E's `FRAME_STATS` flip `6c26fe9` completing the set. **PASS 1 CLOSED**
  (CERT DONE 20:42:30) and the five flips merged to integration in order:
  `19d90b0` (E `e5d4792`), `5b13e35` (A `b74e5be`), `7face8f` (B `070b95b`),
  `a60bf17` (C `974ce23` — conflict in `FlyEffectComposer.jsx`, A's
  `registerComposer` and C's `installDepthProbe` effects BOTH kept) and
  **`91141fe`** (D `fe269b9` — conflict in `scripts/verify-lod-fade.mjs`, D's
  anchored superset taken). **The merged tree is byte-identical to the dry-run
  worktree**, `no-undef` reads 0 over the 50-file R24 delta, node smoke is
  **16/16**, and it is pushed. **PASS 2 is GO at `91141fe`** — and pass 2a was stopped after one row (§4.2),
so two more close merges followed: **`3d388ec`** (close merge 6, A `abd127c` —
the `FINALIZE_PACE` spike detector) and **`ec53fd3`** (close merge 7, E
`59b4e97` + `a2d95a3` — the sixth harness-budget site and the pale detector's
isolation rule), both pushed with node smoke 16/16. **PASS 2b started 21:13:59
at `ec53fd3`** (`CERT_OUT scripts/r24-out/cert3`, summary `cert-run4.log`);
pass 2a's logs are kept as diagnosis. **The five held tips then merged EARLY,
before the re-take, at the user's request — integration tip `8240539`, pushed;
the chain and its proofs are §4.1.** **A dry-run merge of all five
  flipped branches into a scratch worktree produced exactly one resolvable
  conflict** — `FlyEffectComposer.jsx`, where A's `registerComposer` effect and
  C's `installDepthProbe` effect both land and both were kept — **and node smoke
  16/16 except three of D's key-expectation gates**, which assumed C's tokens
  were off: the flipped hill key is `world-bend-fade-hill-r19-ef24` (e and f
  from C) while those gates expected `-a24` / `-l24` literals. **D fixed them at
  `fe269b9`**: the literals are gone, each gate reads the live e/f tokens from
  the shipped constants, forces only D's own token and calls the same
  `r24VariantKey` the material calls — asserting the PROPERTY (D's token present
  exactly when D's flag is on, at its fixed position; with it off the key equals
  what the other owners' tokens alone produce), plus a world-independent "all
  four tokens false = the bare R19 key" row and a **16-state order sweep**,
  because token ORDER is the contract and a shifted token serves one owner's
  program for another's — the R4 wrong-cached-program defect the helper exists
  to prevent. Proven green in BOTH worlds by running (D's branch: `-r19` →
  `-r19-l24` / `-r19-a24`; C's flipped constants: `-r19-ef24` → `-r19-efl24` /
  `-r19-efa24`). Counts: verify-atmo-law **45 → 48/48**, verify-lod-fade
  **51 → 55/55**, and merged into the dry flipped worktree the **full node smoke
  reads 16/16 — the merge queue is validated end to end**.

---

## §3 Per-agent shipped

Every block ships `enabled:false` through W2 and W3; the flips are the close
commit's (§8). Prose is compressed here — the ledgers hold the derivations.

### A PACE (`r24/a`, W1 head `f739cb3`, 13 commits; W3 `8b91bc5`; flip `5ddf5dc`) — [ledger](scripts/r24-a-pace.md)

| flag / item | sha | what | state |
|---|---|---|---|
| vendor three-tile 0.12.1 | `b64457b`, `4bedab1` | byte-identical `index.js`, plugin differs on **exactly one line** (its own import — mandatory: the plugin registers loaders into whichever `LoaderFactory` singleton it imports), `VENDOR.md` patch ledger, git-anchored integrity gate; MIT/GuoJF credit to `VENDOR.md` + `README.md` and NOT to `assets.js`, whose entry count is arithmetic inside `verify-fleet`/`verify-hangar` | merged W1a |
| `TERRA_PACE.timerFix` / `mergeHysteresis` / `keepResident` + `lib/fly/tile-residency.js` | `407691b` | the tile-swap defect at the root; wires the long-dead `TILES.lruBudgetBytes`; eviction is out-of-frustum only (an in-frustum eviction is churn, not a budget); `__flyTerra` dev handle with an owner-checked disposer | ON |
| `TERRA_PACE.skirtFast` | `5247d06` | O(E) generation-stamped boundary scan with an explicit bail contract | ON |
| `TERRA_PACE.skirtWorker` | `3158584` | skirt built in the DEM worker, transferables out, via a **readable** worker source + `build-tile-worker.mjs` (`--check` in the vendor gate) so no minified blob is hand-edited | BUILT-OFF — one real-hardware run |
| `TERRA_PACE.walkWhileSaturated` + `bboxCache` | `3158584` | the T3 freeze fixed conservatively (keep walking, start no load); per-visit `Box3`/`Vector3` allocation gone | ON |
| `TERRA_PACE.bendSphere` (T14) | `3158584` | tile sphere inflation for resident-culled tiles (the unbent sphere is ~30 % short at 30 km, ~120 % at the fade end) | BUILT-OFF — it SUBMITS tiles culled today, i.e. a draw change against frozen ceilings |
| `installResizeGuard` + `verify-step-guard.mjs` | `a0c1484` | the second writer COUNTED rather than argued: r3f's zustand subscriber re-applying `setPixelRatio` + `setSize` outside the frame after an awaited `root.configure`, and a guard that drops a resize into the state the renderer already holds while still calling `setViewport(0,0,w,h)`. **`__flyStats.stepGuard` counts SUPPRESSED calls** — cumulative for the page's life, ambiguous with "guard never installed" when absent, and counting in-frame redundancy too — so E's one-writer assertion takes A's safest form: **per step, `step.n` +1, zero writes outside a rAF, `stepGuard` strictly increased** | ON with `STEP_SAFE` |
| `LADDER_FIX` + `STEP_SAFE` | `36792a0` | five rungs with two render-scale steps first, native-refresh target, long-frame fraction term, DPR applied inside the drawing frame (`step-safe.js` + `StepSafeRig`), plus the FL-05 in-frame buffer check in the composer | ON (§6 taste; `nativeRefresh` carries no measurement — §6 item 4) |
| `HUD_SYNC` + FL-06 + `REBASE_CALM` | `2fadaa6` | labels drawn from `addAfterEffect` with THIS frame's matrices; CloudField priority −10; unconditional pre-render `camera.updateMatrixWorld()`; dead `rebaseEpoch` bump removed, matrix traversal narrowed to the tile subtree, anchor quantised to **704 m** = `HILLSHADE.micro.scaleM × 128` so the micro-grain no longer re-phases every 10 km | ON |
| `FINALIZE_PACE` + veg cap + toy typed index | `f8c6a4a` | one shared per-frame brake for all four engines (the first chunk is not free; the budget counts from frame start); `SatVegEngine._commitPending` capped; the toy merged index built as a `Uint32Array` — **which is where the toy-boot `byteLength` page error came from**: `setIndex` wraps only a plain Array, so the typed array was assigned raw and `WebGLAttributes` threw on first upload, once per land mesh. **Fixed in `e7325cd`** — wrapped in a `BufferAttribute`, with the width MIRRORED from three's `arrayNeedsUint32` (bound 65535, not 65536) rather than inferred, so the two paths stay equal in values AND in type (§4.2) | ON — but the module's header invariant ("neither rule can starve a chunk") **was false under sustained slowness**, and the close proved it: rule 1's fixed 24 ms threshold starves every finalize below ~41 fps (§1, §4.2). Fixed in `abd127c` (merged `3d388ec`): rule 1 refuses only when the frame exceeds both 24 ms and `spikeK` 2 × an EMA of the frames BEFORE it, capped at `maxRefuseFrames` 3; `verify-finalize-pace` 14 → 17 gates |
| `FRAME_STEP` (sim half) | `ed773b8` | 120 Hz accumulator, ≤4 substeps, `renderPos`/`renderAtt`/`renderAlpha` as NEW fields; `flight.pos` stays the sim truth | **OFF — "not landed"**: no consumer reads the smoother pose (§8) |
| `markPhase` | `70b9f42` | six sites, two vendored ones **by inversion** (`R24_SWITCHES.onPhase`, so the bundle never imports app code) | ON with `FRAME_STATS` |

**PATCH 26 `TERRA_PACE.parkOffscreen` + `maxResidentTiles` — the Owens breach
closed at the root** (`dead5e5`, `c573d08`, built AFTER fast-forwarding `r24/a`
onto `9bcaace`, so the duplicate-import class could not recur — **lesson 60's
structural half applied at its first opportunity**). **ATTRIBUTION, measured
switch by switch on one synthetic yaw against the real vendored classes**, as
issued / off-frustum issued / maxZ: flag-off **103 / 83 / 13**;
`mergeHysteresis` 103 / 83 / 13; `timerFix` 103 / 83 / 13; `walkWhileSaturated`
103 / 84 / 13; `bboxCache` 103 / 83 / 13; **`keepResident` 190 / 142 / 17**; ON
(all) 190 / 142 / 17; **ON minus `keepResident` 103 / 84 / 13** — **`keepResident`
ALONE.** Two of the orchestrator's three hypotheses were REFUTED by measurement:
**not double-issue** (`doubleIssued` **0** in both arms — `_loadSubTiles`
unloads the parent's model on its success path and `_removeSubTiles` unloads the
children on its own, so a parent and its children are never drawn together, and
the shape that would have given exactly +41 tiles and 2.4× tris does not occur),
and **not `bendSphere`** (ships false, never armed — A's own constants comment
already said it *"necessarily submits tiles that are culled today"*).
**FIX 1**: an out-of-frustum tile keeps its model, textures and tree position and
only its MODEL is parked invisible, so three skips the subtree in
`projectObject` — **no draw, no per-mesh cull, the return is one boolean**. On a
240-frame yaw: issued **190 → 48**, off-frustum issued **142 → 0**, resident
**190 → 190 UNCHANGED**, merges and refetches still 0 — **and the property that
actually closes pass 2b: unparked, the drawn set GROWS with sweep duration
(142 → 151 from 240 to 720 frames); parked, it is BOUNDED by the frustum
(48 → 39).** No upstream line was edited: A's first cut inlined the call into
`_update`'s upstream comma-expression and **the vendor gate caught it** (3
replaced against the 2 declared), so the pre-pass computes `_inFrustum` on its
own added line — upstream byte-verbatim, gate 8 unmoved, `VENDOR.md` row 26,
vendor 20/20. **FIX 2, the cap**: **140 MB was never a bound** — Owens sat at
113.7 MB the whole time while the tile count doubled, so the module elected
nothing — and `maxResidentTiles` **260** is a second trigger and the one that
binds, **the LRU ordered by LAST VISIBLE FRAME** (PATCH 26 stamps it) with
distance breaking ties, *because a tile just behind you after a 180° turn is
close but stale and distance alone gets that backwards*. **The headline survives
its own brake**: cap none → resident 190 / merges 0 / refetch 0 / on-screen 0;
**cap 260 (shipped) → 190 / 0 / 0 / 0**; cap 120 → 144 / 80 / 80 / 4; cap 60 →
137 / 72 / 72 / 6. Gate 26 reads the cap out of `fly-constants.js` and asserts it
**exceeds the measured working set**, so editing it without re-measuring goes
red. **A's two refusals to overstate, both kept**: a cap is a **BRAKE, not a hard
ceiling** — election is out-of-frustum ONLY, an in-frustum collapse being pure
thrash, so a cap below the working set converges toward the in-frustum floor and
stops (120 → 144, 60 → 137), and **gate 28 asserts that SHAPE deliberately**,
where a `resident ≤ cap` gate would have passed while asserting something the
design does not promise; and **the part parking cannot fix** — the residual
in-frustum count is still above flag-off (**20 → 48** on the fixture yaw) because
the trio lets the tree reach **z17** where upstream's collapse-on-yaw pinned it
at z13: **more detail, not leakage**. Parking removes the entire GROWING
component; **whether Owens then lands under 261 live is E's `terra-live` re-run
to measure, not asserted**, and if it still breaches **the honest lever is
`LODThreshold`** — R19's own knob, which measured naive z16 at 270 and shipped
209 — **not a re-baseline**. `verify-terra-residency` **22 → 32**, RED-calibrated
by neutering `r24Park` (gates 20, 23, 24 fail), its census counting what three
would DRAW — attached AND visible through every ancestor. **Flag-off identity
untouched**: `applyTerraPaceSwitches` gates `parkOffscreen` on `keepResident` AND
`enabled`, and every patch site is one `if` that returns. `c573d08` also drops
the unused `copyFileSync` import. A's node gates on the fix: terra-residency
**32/32**, vendor 20/20, finalize-pace 22/22, frame-step 11/11, skirt-fast 13/13,
skirt-worker 9/9, step-guard 13/13; `no-undef` 0; import-integrity 4/4.

Node gates (second number = the flipped branch, each grown by a ship-state row):
vendor **19 → 20** · terra-residency **21 → 22 → 32** · skirt-fast **12 → 13** ·
skirt-worker **8 → 9** · finalize-pace **11 → 17 → 21** (11 as merged, 17 after the rule-1 spike work, 21 after the index-container fix) · frame-step **10 → 11**.
Browser: ladder-fix **13**; `verify-terra-live` **9 — never completed here**
(a fixture 502, then a load-14 timeout). Three findings the flip produced:
`_r24a-ship-state.mjs` reads each block's literal by brace matching, because
*"a flag silently reverted to false would leave every behaviour gate green
while the fix was gone from the build"*; `verify-ladder-fix`'s RED arm and
`verify-terra-live`'s arm A both OMITTED the pin, which with the constants ON
**is the shipped state** (lesson 26); and vendor gate **16b** — the vendored
switchboard's own literal defaults every switch to false.

### B WORLD (`r24/b`, W1 head `06b8f1d`, 16 commits; W3 `f361543`; ledger `6d38245`; flip `070b95b`) — [ledger](scripts/r24-b-world.md)

| flag | sha | what | state |
|---|---|---|---|
| `FLASH_GUARD` | `4f93436`, `bd2776a` | zero-area filter at 4 sites (sat-buildings, skyline, toy buildings, toy water); the land and sat-water sheets are deliberately excluded — no wall extruder there | ON, with the site-by-site honesty of §4.2 |
| `BEND_LEAD` | `8a2769b` | bend pad covers the lookahead lead in 4 engines + 3 pooled layers | ON |
| `CHUNK_FADE` + `HEAL_IN_PLACE` | `6da62a4` | POOLED fade twins (same constructor params and `customProgramCacheKey` ⇒ three returns the SAME program) so a per-mesh ramp can exist at all — three re-uploads uniforms only when the MATERIAL changes between draws, so one shared uniform cannot express one; heal re-drapes the resident position buffer with a ranged upload, patching collision columns and porch lights with it; parcel `growK` eased in place over 0.6 s; the twin's fade uniform is published once, in `TwinPool._newTwin`, as `material.userData.__fadeU` for probes | ON — `maxDying` 4 is the only draw term and **Owens takes exactly 0 by construction**. **Ramps were TIME-ONLY**, which is a frame-rate assumption: B adds a frame-count floor (`45e2cde`; `progress = min(elapsed/sec, framesSince/minFrames)`, **`minFrames` 4** — a death starts at full presence, so N frames give N−1 partial samples and "≥ 3 on a death" needs 4), so the slowest machine still sees the transition, 60 fps is unchanged by construction, and a hitch train can no longer skip a fade. **The same run broke B's own heal gate, and the gate was wrong**: `healsInPlace + healsNoop ≥ heals` is not an invariant — a heal can end five other ways — so the engine now counts `healsQueueFull` (budget spent), `healsAborted` (the chunk was evicted under the job: MOOT, no chunk means no hole), `healsNoRecord` (water-only), `healsCoalesced` (a re-drape already in flight) and `redraping` (draining); the ledger is EXHAUSTIVE and the gate asserts **equality**, so a residual heal hole in a browser row is read against `healsQueueFull` alone — the same discipline as `fadeBudgetMiss` |
| `GROUND_VIS` | `8d577db` | slew-limited `runtime.groundElevVis` with a 16-row damped/raw seam table | ON |
| `ENV_UNIFORM` | `42e6f66`, `f361543` | constant PMREM height (the day endpoint bypasses the resize ⇒ noon bit-identical), both shadow states warmed, late-HDRI idle re-queue | **OFF** (§5.3) |
| `RING_DEDUPE` | `720c5d2`, `995f0da`, `8f9861e` | source-side ring dedupe + the skyline's restored `ring[0]` + a sliver guard | BUILT-OFF (roof re-certification owed) |

Node proofs outside the smoke: `r24-b-engine-proof.js`, `-worker-proof.js`,
`-bend-proof.mjs`, `-groundvis-proof.mjs`, `-fixture.js`, and
`r24-b-prewarm-proof.mjs` (**9/9**, `--red` **5/9** as recorded at `06b8f1d` (**6 of 9 FAIL** re-read at the close on `645d08c`) against the defective
`06b8f1d`; gates 1–2 self-calibrate against base `6116fc5`, the invariant being
*B added nothing here*). Ledger §8 = **16 mechanisms that can remove a building
from the screen**, each with file:line and its measured before/after; §15 = B's
reading of E's live flash-guard REDs (§4.2).

**At the close, `7540f20`**: `scripts/r24-b-fadecover-proof.js` drives all three
satellite chunk engines headless **at the venue's own 2.84 s/frame** under E's
exact presence rule and attributes every hard event to its layer — **sat-building
0 hard of 54 births and 45 deaths, 54 of 54 wearing `__fadeU`** — which moves the
fade row's remainder off the floor and onto **two layers with no fade channel at
all** (sat-roads, sat-water), now declaring **`userData.__noFade`** with their
reasons so a probe attributes them instead of scoring them; the new gate leg —
**every material a presence probe can meet either fades or declares `__noFade`**
— is RED on pre-fix `9bf5f8a`. And the question flushed out a second defect of
the SAME SHAPE as the fade ramp: `HEAL_IN_PLACE.budgetMs` is a per-frame time
budget, i.e. **a frame-rate-dependent throughput** (36 ms/s at 60 Hz, **0.2 ms/s
at 0.35 fps**), fixed with **`minRunsPerFrame` 64** and measured under
`--healstarve` at `redrapeRuns` **15 → 580** and `healsInPlace` **0 → 2**, the
gate asserting **forward progress** rather than `healsInPlace` because an
eviction is not a pacing failure. All B gates green across eight engine legs,
`fadecover` RED on pre-fix, `prewarm` RED on its pre-fix revision, `no-undef` 0;
the older probes learned the `@/` alias the merged tree uses.

### C LIGHT (`r24/c`, W1 head `871f9be`; W3 `ad01d32`, `a9e30cc`; flip `81338da`) — [ledger](scripts/r24-c-light.md)

| flag | sha | what | state |
|---|---|---|---|
| `LINEAR_HAZE` | `f15f044`, `ee10642` | five haze/fade setters + `uHazeColor` decoded to linear; `getRimColor()` reads an authored-sRGB stash so SatVegLayer, which already decoded correctly, cannot double-decode. **The runtime pin landed at the close** (`ee10642`, verified by the orchestrator on the dry tree): `linearHazeOn()` is exported from `world-bend.js:518` and is the **ONE reader** of `LINEAR_HAZE.enabled` in the tree (`:527`), following the R24 pin idiom — `__flyLinearHazeOverride` consulted per call, no module-init capture, so an `addInitScript` pin governs the whole tree. **THE FINDING: there were TWO raw readers, not one.** `components/fly/AerialPerspective.jsx` carried its own `if (LINEAR_HAZE.enabled)` branch for `uHazeColor`, so pinning the dispatch site alone would have produced a tree with the haze COLOUR on one law and the fade setters on the other — *a mixed tree presented as a measurement*. C's note to E is kept with it: the pin changes the haze COLOUR, not whether haze is applied, so at `aerialGate` 0 the two arms are **the same frame** — which is why the A/B has to release the aerial pin as well | **ON** — decode round-trip **0.000** by construction (node oracle); **the SEAM is UNMEASURED** and the A/B re-take is pending (§4.2) |
| `ONE_SUN` | `967524a`, `08e6518` | key follows `runtime.sun` at EVERY tier; TRUE elevation, floored only while the shadow camera casts; anti-solar moon blended over [0°, −8°]; hillshade weight on its own `uHillElev`; satellite monuments Toon → Lambert in BOTH representations (a second `directionalLight` was REFUSED: `NUM_DIR_LIGHTS` 1→2 re-keys every lit material) | ON, `hill.dayK` **1.0**, `monumentsLambert` true |
| `POST_ORDER` + `DEPTH_FIX` | `4146eb7` | ACES before the grade, SMAA last (`smaaPreset 'high'`) with a per-pixel hash dither (`post-policy.js`, from BOTH assemblers so the warm compiles the same program), CoC un-double-converted, the dead sky early-out fixed | ON — grade re-tune measured (0.037 vs 0.05) and **declined** at 0.23/255 |
| depth probe hook | `e59445d` | `window.__flyDepthProbe(x, y) → { raw, viewZ, coc, reversed, near, far, drawingBuffer, source, cocSource, cocReason, error }` (drawing-buffer pixels, top-left origin, landing on the texel centre) + `window.__flyDof`; installed from `FlyEffectComposer` under a **statically false `NODE_ENV` branch** (the R19 park-handle idiom — production byte-identical, nothing allocated until a harness calls it). `raw` is `composer.depthTexture` **AS STORED** — no un-reversing, no normalisation, the same texel AerialPerspective and the CoC material read; `coc` is the DoF effect's `renderTargetCoC` at the same normalised UV (null with a `cocReason` when DoF is not mounted — toy + high is the only composition that mounts it); `reversed` comes from the renderer's `getReversed()`, not from the request. The depth attachment cannot be `readPixels`'d, so the probe samples it into a 1×1 FloatType target and **returns an `error` without `EXT_color_buffer_float` rather than a number it cannot stand behind** (8-bit is useless at 3.6e-3 reversed depth). **The precision ladder is quantified** (`7dae48b` + proof, ledger `974ce23`): `EXT_color_buffer_float` → FloatType, `precision 'float32'`, worst **0.000002 %** of z; `EXT_color_buffer_half_float` → HalfFloatType, `'float16'`, worst **0.0754 %** (50 m 0.0165 %, 700 m 0.0150 %, 4000 m 0.0754 %) — **every float16 path is 13× inside the gate's 1 % bound**; neither extension → **no number and an `error` naming both**. HALF_FLOAT `readPixels` returns 16-bit patterns, decoded ONCE with three's `DataUtils.fromHalfFloat` from a `Uint16Array`, and **the proof scans the probe for `"1.0 -"` so the L2 double-conversion cannot be reintroduced inside the instrument that measures it**. The return carries `precision`, `precisionWorstPct` and `precisionNote`, and the gate prints the precision beside its verdict; eight further proof gates, including **"the constants the probe DECLARES are the measured ones — a declared cost may overstate and never understate"** | ON (dev-only) |
| `SHADOW_CALM` + T11 | `fd7d28d`, `a9e30cc` | PCF bias sign, world-locked kernel, texel snap in light space, catcher armed on `queryColumns` + AGL, one `offsetUnits()`/`groundOverlayOffset()` implementation; the patch refactored into a pure `r24PatchShadowChunk(src, opts)` so a gate can EXECUTE it | ON (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0), in C's own words: *"shader edits and snap arithmetic proven node-side (32 gates); mount/arm logic structural; pixels, draw counts and whether the catcher actually receives a shadow unmeasured — user's machine."* |
| `TERRAIN_LIGHT` | `9783586`, `0e2f7cb` | fragment-stage N·L, `microFwidth` grain fade, area-weighted smooth worker normals (PATCH 8, spliced at build time like `__DECODE__`), skirts inherit their edge normal | tile half ON (`fragmentHill`, `microFwidth`); `workerNormals` **FALSE** |
| `CLOUD_LIT` + `LAMBERT_ENV` | `a5c403e` | fake-hemisphere normal + Henyey-Greenstein forward lobe on drei's instancer via a prototype ACCESSOR (drei overwrites a constructor assignment one line later), same ONE draw; Lambert `reflectivity` 1 → 0.15 on 4 content + 2 monument materials, uniform-only | ON — the cloud variant takes the registry key and NOT a warm-set entry: a documented exception with a measurement condition attached |
| shared | `9783586` | `r24VariantKey(base, tokens)`, fixed order **e** ONE_SUN · **f** TERRAIN_LIGHT · **a** AERIAL_LAW · **l** LOD_CROSSFADE, plain booleans, all-off ⇒ the bare R19 key | — |
| F4 + F11 | `6ac995f`, `98cc33d` | three monument material-contract gates added ADDITIVELY to `verify-monuments-sat` (its eleven frozen numbers unmoved), the fourth as a source-level unreachability proof; the two key-NEUTRAL shader edits documented in the registry header | ON |

Node gates: depth-offset **7** · depth-roundtrip-proof (it **EXTRACTS both
return expressions of three's `perspectiveDepthToViewZ` from the installed
build** and evaluates them against the JS mirror: **8,004 comparisons across
four frustums** including the shadow ortho's 1/8000, both branches, the full
[0,1] range with endpoints, **BIT-IDENTICAL under `Object.is`** — so the mirror
cannot carry its own copy of the double-conversion bug and goes red if three's
formula changes; plus six contract gates: as-stored, no `"1.0 -"` anywhere,
reversed from the renderer, refuses instead of guessing, names its sources, both
handles production-dead) · c-flagoff **26 → 37 → 40** · worker-normals **12**
(3.34° last-writer → **0.26°** area-weighted) · shadow-calm **32** (**33/33**
flipped; the browser could not host it — its first term is the fleet pin
`__flySatShadowOverride`). The last three c-flagoff gates are the pin's own
anti-rot: the accessor exists and is exported, every other reader of
`LINEAR_HAZE.enabled` is gone, and the census skips comments — **RED-calibrated
by adding a second read in `SkyDome.jsx` and watching it go red**, not asserted.
C's honest residual: no full `next build` was run behind the pin. **Zero constants moved, in six milestones.** What the
flip decided: `hill.dayK` **1.0** keeps the daytime demotion built-and-off BY
CONSTRUCTION (weight exactly 1 ⇒ `uHillStrength * uHillElev` bit-identical to
R21, `verify-sat-depth`'s margin unmoved; 0.65 would have spent up to **35 %**
of a frozen margin on an unmeasured argument); `workerNormals` stays OFF because
ON makes `verify-skirt-worker`'s identity leg RED by design; `verify-c-flagoff`
gate (1) now asserts the SHIP STATE including sub-values while (2)/(3) keep
proving the SOURCE properties (false branch = R21 verbatim, `r24VariantKey` bare
when every token is false), so the flags ON still prove the round is **one flag
flip from R21** — the anti-rot for R20 §7. **Live keys at boot**:
`world-bend-fade-hill-r19` + the tokens actually set — `a` is UNSET because
`AERIAL_LAW.enabled` ships false, so expect `-ef24` unless D's `lodFade` adds
`l`; **read it off the material, do not predict it** — plus `cloud-lit-c24` on
the satellite decks and the reordered post twins (satellite high **3**
EffectPasses, was 4; toy high **5**, was 6). **Census caveat**: `SHADOW_CALM`
changes the compiled TEXT of every shadow receiver with **no cache key**, so a
KEY census is blind by construction while a SOURCE-hash census sees every
receiver move — say which one a number came from.

**C'S CLOSE RULING: the night hill/key split is a DEFECT, and C overturned its
own W2 text to say so** (`446545b` code, `1a28ab9` ledger, merged as 20 →
`93f1dce`). The re-take's 137° disagreement is **reproduced from constants alone,
with no GPU**: hill el **8.594°** is `HILLSHADE.minElRad` (`computeSun` clamps
`asin(max(0, sinEl))` up to the graze floor); key el **34.377°** is
`SKY_LIVE.nightSky.moonElRad` **0.6 rad**; the azimuth gap is **exactly 180°**
because `moonDirFromSun` is anti-solar (`a = az + π`); and
`acos(cos 34.377 · cos 8.594 · cos 180 + sin 34.377 · sin 8.594)` = **137.04°**.
`r24-c-one-sun-proof.mjs` prints three trees and reproduces the browser number to
two decimals: **R21 flag-off 0.00°** (agreed — both on the SUN), **`ONE_SUN`
pre-fix 137.03°** (key on the moon, ground on the sun), **`ONE_SUN` this fix
0.00°** (agreed — both on the MOON). **Three reasons, the first decisive: R21
ALREADY AGREED at night**, flag-off putting key and hill on the same vector at a
graze floor, **so no inherited contract permits the ground to disagree with the
light and the split is 100 % `ONE_SUN`'s** — introduced by C's own M2 moving the
key to the moon and leaving the ground behind, *"a regression I shipped"*;
**nothing in source asks the hillshade to stay solar at night** — the only
documented night intent is the ELEVATION clamp (*"graze floor (night/dawn) —
relief stays readable"*), orthogonal to azimuth and preserved, and `sun-model`'s
`az < 0 = morning` convention is the DAYTIME sense whose cited gate,
`verify-sat-depth`, actually asserts a hillshade **STRENGTH** A/B (mad > 2) and
not an azimuth flip; and **recon L3 named four sun directions per frame as a root
cause, and a 180° azimuth contradiction inside one frame is that defect at its
sharpest**. The W2 proof text had carved the hill out *"BY DESIGN"* at
`moonK > 0` — **written before any night measurement existed, it justified the
KEY moving and never asked whether the ground should follow**; the contract is
rewritten with a new clause 6. **THE FIX**: `moonBlendK(elDeg)` is now **the ONE
copy of the blend weight**, called by the per-frame key branch AND the 60 s
hillshade cadence — *"two copies of the curve would put ground and buildings on
different lights for the whole crossing — the same defect in slow motion"* — and
in `apply()` the three R21 expressions survive **verbatim** as `hx`/`hy`/`hz` and
are what `setHillDir` receives with `ONE_SUN` off, so **flag-off identity is by
construction**. **THE CONTRACT CHANGE E folds in**: at `moonK` = 1 the hill
elevation is **`moonElRad` (34.377°), NOT the clamp floor 8.594°**; clause (3)
holds where `moonK` is 0; **at full moon hill el == key el == 34.377°, still
inside [8.6°, 51.6°], so relief legibility is not traded away** — and **the
re-take's "(3) hill = the clamp floor" PASS was on the PRE-FIX tree**. **THE
PUBLISH**: `moonKeyAzDeg` / `moonKeyElDeg` on `__flyStats.sun` **in the GATE's
convention** (az = `atan2(x, z)`, el = `asin(y)`, degrees) because the gate
compares angles and **a convention mismatch would read as a lighting bug** — the
proof file's own `azOf` uses `atan2(−x, z)`, the `basis()` convention, and the
published numbers deliberately follow the gate; **both null while `moonK` is 0**,
because `_moonKeyDir` is only written inside the `mk > 0` branch and *a stale
vector reported as live is how an instrument invents a measurement*; production
cost is four assignments and no trig. **`verify-c-flagoff` 40 → 44** — one
formula with two callers, the hill blend `ONE_SUN`-gated with the R21 arguments
verbatim, the moon key null at `moonK` 0, and **a published-shape gate over all
21 `__flyStats.sun` fields** (*"a dropped field turns a clause into a silent
NOTCAL rather than a red, which is how pass 2b lost three"*), RED-calibrated both
ways; node sweep c-flagoff 44/44, shadow-calm 33/33, depth-offset 7/7,
worker-normals 12/12, four proofs, import-integrity 4/0, eslint 0/0. **NOT
MEASURED, and now on the post-batch list**: this moves satellite NIGHT ground
pixels, so **`verify-sat-night`, `verify-dusk` and `verify-flicker`'s night legs
re-run on the merged tree after `terra-live`**; **daylight is bit-identical by
construction** (`mk` is 0 above the horizon) and flag-off is untouched at every
elevation; **a red there is C's to re-examine, never a re-baseline.**

**AND C CLOSED THE THREE DEPTH-ROW OPEN ITEMS AT THEIR SOURCE** (`a44f4b7`,
merge 37, `verify-c-flagoff` 50 → **54**, two RED-calibrated). The far pick was
**C's own defect and not the candidate set**: the un-bend's rigid vertical lift
is right for distant terrain and **fatal in the near field** — a 3,144 m hit
lifts the ray origin 49 m, which **passes 49 m over the player aircraft 30 m
ahead** — *"my own rule was right and my correction defeated it"* — fixed by
casting BOTH an unlifted and a bend-solved ray, rejecting either above 1.5 px of
reprojection and **taking the nearest survivor, "because nearest is what a depth
buffer keeps"**, which needs no special case because distant terrain found by the
unlifted ray rejects itself. The 36 m gap was **not** the near plane (the probe
reconstructs exactly near/raw), **not** texel addressing (inverse conversions of
one centre, reprojection 0.00 px), **not** float16 (60× too small) — **it was a
MOVING surface**, proven by two probes of one pixel reading 1207.14 and 1209.63:
*"a truth taken in a different turn is a truth of a different world"* — so
`truth` became a FIELD on the probe result, computed **in the same synchronous
turn** as the depth read. And the bound moves without the number moving:
`0.01 · abs(truth.viewZ) + truth.slopeMPerPx`, the slope **measured by casting the
four neighbouring pixels** rather than guessed, *"tight where the surface is flat,
honest where it is not."* `cocSource` had been published all along — **the gate
read a different address** (`__flyStats.effects` versus the probe result it
already destructured), *"nothing wrote the address it read"*, now mirrored to both
— and, in passing, **the CoC texture is 8-BIT**: the readings are exactly 36/255
and 42/255, quantised to 0.0039, *"because '0.141' reads like a continuous
measurement and is not."*

**AND C RULED THE HAZE A/B** (`0f54071`, merge 34): **keep `LINEAR_HAZE` ON** —
*"a correctness fix about which colour space a number is in, true independently
of the seam"* — because `srgbToLinear(c) < c` everywhere, so **one monotone
darkening read through two geometries** narrows the noon seam (terrain above the
dome) and widens the night one (terrain below it), **nothing night-specific
happening in the decode, which is why the hour-dependence spread improved 44 %**.
The tuning number: the day rim keeps **80 %** of its luminance under the decode
and the night rim **13 %**, so **a re-tune is per-keyframe, never a global
scale** — and C refused to do it here for three reasons (no browser and a
synthetic sky is the wrong instrument, *the R17 §7.1 mistake in a new costume*;
the rim triple is a single source with FOUR consumers by the round-6 rule; and it
is a look decision with a user checkpoint attached). C also resolved *"aerial
pass null"* — it is the same config mirror that printed `dof=null`, while the
aerial term is live and composed as an EFFECT into the shared `EffectPass`, so
there is no pass to enumerate: *"null is the right answer to the wrong
question."*

**AND ONE MORE, at the very close: the four micro-degree one-sun residuals were
C'S OWN INSTRUMENT** (`7fa86cb`, merge 31, `verify-c-flagoff` 49 → **50**). They
were neither of the two candidates put to C — the residual is **`toFixed(6)` in
the stats publish**: a unit-vector component rounded to 1e-6 moves the derived
azimuth by up to **4.05e-5°/cos(el)**, and every failing number sits inside that
bound. Quantising the app's own expressions the way the instrument does gives an
azimuth difference of **float64 0.00e+0** at noon, dusk AND night, 2.4–2.6e-5 at
`toFixed(6)`, and 3.3e-8 or better at `toFixed(9)` — ***"the app's key and hill
azimuths are BIT-IDENTICAL as doubles at every leg; the gate was differencing its
own rounding."*** Float32 is nowhere on the read path (a `Vector3` of plain JS
numbers, the JS-side uniform value object, a float64 normalise; the GPU copy is
never read back). And the two computations are **correct**: `basis(az, el)`
evaluated once per consumer **from the same `az` double** at contract-different
elevations, so **"one sun" is one SOURCE — one az, one sinEl, one `moonBlendK` —
and the bit-identical azimuths ARE the evidence.** C declined the loosened bound
— *"a 1e-3° bound would have written my instrument's rounding into the contract
permanently"* — publishing directions at nine decimals instead (~3e-8°, three
orders inside the 1e-6° clause) while degree scalars keep four **because they are
read rather than differenced**, with **gate 50 locking every published direction
vector at nine decimals**, RED-calibrated by putting the hill back to six.

**AND THE DEPTH TRUTH HOOK** (`514eddd`, built on the merged `175e33e`, merge 25
→ `4a95763`). `window.__flyDepthTruth(x, y)` returns
`{ hit, distance, viewZ, object, source }` plus `bendK`, `bendDropM`,
`bendIters`, `residualM`, `reprojectionPx`, `candidates`, and
`{ hit: false, reason }` on a miss — **never a zero**. `viewZ` is three's view
space, **negative in front of the camera, world metres — the same convention and
units as `__flyDepthProbe`'s**, so E differences them directly, and x/y are
drawing-buffer pixels converted as **the exact inverse of the probe's own UV** so
both hooks address the same texel. **Camera and geometry**: the camera and scene
are **the SAME two objects `FlyEffectComposer` hands its own `RenderPass`**,
passed into `installDepthProbe` from the same production-dead effect, **so the
hook cannot read the inspect turntable's camera** (a second Canvas with its own
renderer); candidates are **depth-WRITING only** — `isMesh`, visible through
EVERY ancestor (R19's traverse lesson), `depthWrite !== false`, not a sprite
material — **so billboarded traffic and tracers fall out BY THAT TEST rather than
by name**. **THE FINDING, C's and lesson-grade: a naive raycast would have been
confidently WRONG.** Every world vertex is displaced by
`wPos.y -= bendD² · uBendK` in the vertex shader (`world-bend.js:579`), so **the
CPU geometry a `Raycaster` sees is not the surface the depth buffer recorded** —
at the gate's own 4 km probe that is metres to tens of metres, **far outside the
1 % bound** — and *"a truth hook that ignored it would have handed you a
confident wrong number, which is worse than the 0 hits it replaces."* **The
un-bend**: shifting the ray ORIGIN up by the drop shifts the whole line
vertically while leaving its XZ path identical, so *"shifted line meets un-bent
geometry"* is the same equation as *"original line meets bent geometry"* for a
locally constant drop; the drop is smooth, so **iterating it at the current hit
converges — at most four passes, stopping at 1 cm, with `bendIters` reporting how
many** — and `k` comes from `getBend()`, **the CPU mirror of the LIVE uniforms**
(the `__flyAirDrop` idiom), never a constant. **It checks itself, because C had
no browser**: `residualM` reports whether the fixed point converged at that pose,
and `reprojectionPx` projects the answer back through the same camera and reports
**the pixel distance from the pixel asked for** — so a wrong SPACE (the floating
origin; `FlyScene` rebases the camera at `:1735`, so a between-frames call should
see camera and objects in one space, **but the hook does not assume it**), a
stale matrix or a bad bend all surface as **a large `reprojectionPx` instead of a
plausible distance**; E reads `reprojectionPx` and `residualM` **BEFORE**
distance (1 px / 0.05 m per probe, else an instrument miss carrying that reason).
**`dof=null` beside `__flyDof true` is resolved: `__flyDof` IS RIGHT** — it is
the live `DepthOfFieldEffect` instance published by `Effects.jsx`'s `setDof`
callback ref, while `__flyStats.effects.dof` is a CONFIG mirror that reads null in
compositions that DO mount the pass, **which is exactly why (0b) already judges on
the live one and merely prints the other**; the probe's `cocSource` now names the
effect's constructor plus the handle it came through, so (3)/(4) can state which
term they are green on. **`verify-c-flagoff` 44 → 49**: the hook is published and
torn down with the probe; **cannot exist in production** (same `NODE_ENV`
early-return, same install site, the regex admitting only COMMENTS between guard
and call so no statement can slip in); reads the composer's own camera/scene
binding with no module-scope camera to shadow it; the candidate set is
depth-writing; it un-bends by the LIVE `uBendK` and reports its own convergence —
RED-calibrated by deleting the guard and by weakening the depth-write filter. Two
of C's own instrument files needed **one-line follows tracking the edit, not
re-baselines**: `r24-c-depth-roundtrip-proof.mjs` stripped only three's import
before evaluating the mirror and became a SyntaxError when the module grew a
second (it strips every top-level import now), and its production-dead-branch
regex demanded the call IMMEDIATELY after the guard (it allows comment lines now,
same property). Node sweep: c-flagoff 49/49, shadow-calm 33/33, depth-offset 7/7,
worker-normals 12/12, four proofs, import-integrity 4/0; **eslint 0 NEW** — the
four `react-hooks` errors in `FlyEffectComposer.jsx` are pre-existing, 4 before /
4 after, verified by stash (§5b).

### D ATMOS (`r24/d`, W1 tip `6dc8817`; W3 `1620e32`; flip `327950b`) — [ledger](scripts/r24-d-atmos.md)

| flag | sha | what | state |
|---|---|---|---|
| `AERIAL_LAW` | `5114dcf`, `bc408e7` | `lib/fly/atmo-law.js`: ONE analytic f(distance, height, sunDir) → (transmittance, inscatter) as ONE GLSL string + ONE JS mirror; post pass at high (LAW variant chosen once from a module const so production and the warm twin cannot diverge), per-material term at medium/low before `<dithering_fragment>`, tier split never-both; the 16–55 km tile band retired by AMPLITUDE and the 60–120 km rim melt absorbed by extinction → 1; satellite-scoped (toy writes strength 0 = the IEEE-exact identity path) | **`enabled` FALSE** — no pixel A/B exists at any pose |
| `AERIAL_LAW.nightRamp` (A8) | `bc408e7`, `327950b` | post-pass strength on the city windows' own `dayFrac` curve — exactly 1 at noon, exactly 0 at deep night, uniform-only, no shader text | **TRUE with `enabled` false**: FlyScene gates A8 on `nightRamp` alone and applies it to the LEGACY post strength on the `lawOn === false` branch, so noon identity keeps `verify-aerial`'s 0.55 exact |
| `LOD_CROSSFADE` | `e7993ee`, `bc408e7` | vendored PATCH 5/6/7 (**+68 / −0**, insert-only, so D spends none of A's deleted-lines budget), parent-texture clip-UV blend on refine AND merge, `lod-crossfade.js`, `__flyStats.terra.fades` with enumerated skip reasons; `fadeSec` 0.25 = un-hitched FRAME time (the −50 block clamps dt at 50 ms), `maxConcurrent` 12 → **32** because it counts MATERIALS and a refine arms four (≈ 8 concurrent refines ≈ 2.7 MB of retained parent textures) | OFF pending the pass-1 `verify-lod-fade` row (§8) |
| `SKY_PROCEDURAL` | — | **NOT BUILT**; design in D's ledger §4.5 | OFF |

**Settled by pass 2b**: `merges` 0 at every pose is `keepResident` WORKING, so the merge path is recorded as **structurally gated only** — chasing merges would measure a tree that does not ship. **The boundary D put on the record before the pass-2 number existed, and which the number then confirmed:** A's yaw
sweep saw **merges 1** and D's altitude ladder saw **merges 0**, so a green
pass-2 LOD row rests almost entirely on REFINES. D's recommendation, if it
flips, reads in D's own words: **"the refine path is measured, the merge path is
inferred from shared machinery (same uniform, same clip-UV transform, same
clock, run backwards; merge direction gated structurally by
`verify-lod-fade.mjs`), and structural is not measured."**

Node gates: `verify-atmo-law` **41 → 45 → 48/48** and `verify-lod-fade.mjs`
**51 → 55/55** after `fe269b9` replaced three spelled key literals with gates
that COMPUTE the expectation from the live tokens (§2). **One correction D made
to the orchestrator's own instruction, worth its own sentence:** the `e` token
had been described as `ONE_SUN.enabled`, but the source predicate is
`hillElevOn() = ONE_SUN.enabled || TERRAIN_LIGHT.enabled` — an OR — and D
mirrored the SOURCE, because the shorthand would have gone green on a tree whose
key was right. Detail on the law gate: **41 → 45** (GLSL parsed by a subset interpreter
against the JS mirror at 4,160 points, 0 relative error; flag-on minus the law
=== flag-off character for character; four ship-state rows added at the flip)
and `verify-lod-fade.mjs` **51/51**, reading the DECLARED state. D's rationale:
**"a gate that asserts a flag is off forever goes red the day the feature ships,
which trains people to edit gates; the invariant is that the state is declared
and legal and the RED counter works in either state."** **Not built, reported as
such**: the content and air/anchor variants (satbldg, satskyline, anchor,
monument, air, air-anchor, road, water) — dispatch designed (`atmoApply` opaque
/ `atmoExtinct` additive), variants not built.

**At the close, D applied §4.10b to the standalone `lod-fade` row and ruled
NO-GO** — three preconditions fail (P3 `noParentMap` 1, P5 arc 264° and ratio
0.745, P6 maxZ 17 vs 16), four flip conditions hold on their own evidence (F1,
F3, F4, F5) and two are NOT EVALUABLE (F2, F6): *"the preconditions are what
block the call — which is the template working, not failing."* D attributed its
own precondition to the WORLD rather than to D's code — the vendored
`_errorMaterial` clone has no map, so one failed imagery fetch on a parent
produces exactly one `noParentMap` denial and the ladder correctly falls through
to the upstream swap — **so P3 is revised** (shape and unpatched stay hard 0;
`noParentMap` is reported always and fails only above ~5 % of window refines or
when the parent DID have a map, with `{z, x, y, hasModel, matCount, matName}`
context added, *"a gap in my instrument, not E's"*). Two findings fell out of the
numbers: **the ON arm is structurally slower because the harness creates `ctx2`
while the OFF page is still open**, so the ON sweep renders against two live
SwiftShader contexts — *"a far better explanation of ratio 0.745 than load noise,
and raising the cap alone would not fix it"* — and **(18) compared two different
scenes**, both SETTLED but at different maxZ, so F6 becomes an equality
**preconditioned on equal maxZ**, NOT CALIBRATED rather than FAIL otherwise. One
open item D declined to dress up: per unit arc the ON arm refined MORE (0.235/°
vs 0.200/°), *"not evidence of a defect and not evidence of flatness"*, with F2
unread until the arcs match. The single specified re-run is on A's fixed tree
with four changes (§4.2), and **the ship state stays OFF**: *"the refine path
blends, but the run that would license the flip has not happened yet."*

### E CERT (`r24/e`, W1 tip `c7d538c` → `299cc1a` → head `3a21403`) — [ledger](scripts/r24-e-cert.md)

| deliverable | sha | what |
|---|---|---|
| launch shim | `98c4cda` | `scripts/_pw-shim.js`, a `node -r` preload with **zero diff in any verify-\*.js**: drops `channel:'chrome'`, adds the explicit SwiftShader ANGLE path (~2× the implicit one's fill rate), resolves the global playwright as a fallback; `PW_CHANNEL`/`PW_EXTRA_ARGS` restore the author's launch on the user's machine |
| OFFLINE WORLD FIXTURE | `10a7963`, `effae67`, `b81a10a` | synthetic imagery (z/x/y stamped, per-tile hue, z-border), terrain-rgb DEM **sized 5/9/17/33 px by zoom** around three-tile's `clamp((z+2)*3,2,64)` resize and Martini's 2^k+1 requirement, MVT via geojson-vt + vt-pbf with CLOSED rings and OpenFreeMap's NEGATIVE winding sign, ADS-B + weather stubs, `/__stats` `/__spec` `/__health` + `FIXTURE_REV`; scenes at the fleet's own poses (manhattan / sf / tokyo / columbus / powell / blagnac / **owens** / **sierra** / **melton** / smokies / rural / an empty-body tile); imagery pinned as a SOURCE after route-fulfilled imagery froze the quadtree at z6 |
| `FRAME_STATS` | `a071ee9` | `lib/fly/frame-stats.js` at `useFrame` priority **−101** (ahead of the governor and A's rig): dt ring, p50/p95/p99, >33/>100 ms per minute, stalls/min on the R22.1 definition (`dt ≥ max(2×median, 28 ms)`), longtasks, `programsDelta`, `markPhase` into `lastStall.phases` |
| user-diag pack | `a071ee9` | four questions, a console collector that works on ANY build, the 3-minute Powell → Columbus serpentine, and a 30 s recipe whose per-second rows carry `dReady`/`dSky`/`adds`/`removes` deltas |
| `budgetK()` | `1bf7f5a` | harness-only per-frame budget scaler at five sites, exactly 1 in production, clamped [1,500] so a harness can only be MORE generous |
| `_settle.js` | `0fa0c0f` | settled is a **CONDITION** (maxZ ≥ 14, elevation quiet, `ready + empty === chunks`, a fresh publish), never a duration |
| offline `verify-seam` node leg | `b8b32f9` | the first complete FIXTURE column — 9 gates, ~40 s, no browser, no GPU |
| hygiene | `a996b9e` | R21 artifact restored; fs-level fixture write redirect wrapping every path Playwright uses; `verify-artifact-hygiene.mjs` as an OUTCOME gate |
| `verify-import-integrity.mjs` | `ea48d36` | the **"can the app EVALUATE"** gate — `no-undef` over the round's delta, RED **3 files / 8 errors** on the broken tree; now the FIRST row of the node set |
| `scripts/r24-cert-run.sh` | `af0bb76` → `3a21403` | the certification run with its failure modes designed out: one server, a port guard that asks *does anything ANSWER* (§5.2), `CERT_PROOF_ONLY=1`, every child tracked, `TREE UNDER TEST` stamped at first page load |
| new gates + smoke | `d5fe40f`, `b81a10a`, `964a7e6`, `cbd7c8a`, `e1b7905`, `ff5d9a1` | verify-flash-guard / -fade / -lod-fade / -step-clean / -one-sun / -env-uniform / -linear-haze / -depth-roundtrip / -frame-pace; `verify-flicker`'s quiescence precondition (bound of 12 **unmoved**); `r24-smoke.sh` (zero passes = failure; `SMOKE_NODE_ONLY=1` runs the node set in 13 s) |


---
## §4 Certification

Per-gate detail, the user-machine command list and the deviation log are in
[`scripts/r24-close-sweep.md`](scripts/r24-close-sweep.md) — **§2.7 is the
per-gate user-machine run list and is not duplicated here.** The pass-1 legs are
written into the cells below while pass 2 runs; at the close they move to the
close sweep, which is now BUILT for it (`r24/e 189d68c`): a §5.0 citation index
(leg → subsection → owner → pass 1 → pass 2), §5.1–§5.13 with PASS 1 and PASS 2
as separate blocks, every gate line with its number, every VOID / NOT RUNNABLE /
NOT CALIBRATED reason verbatim, and the three verdicts defined up front —
pass 1 filled for fixture, flash-guard, fade, lod-fade, step-clean, ladder-fix
(both arms), one-sun, linear-haze, depth-rt, terra-live, frame-pace and
shadow-calm, with env-uniform pending. **At the close each row here becomes one
line citing `scripts/r24-close-sweep.md §5.N`, with N read from the merged file
rather than guessed.**

Certification is **TWO PASSES**, and a row is not finished until both are in:

- **PASS 1 — the flag-off tree (`5ca8e15`)**: RED calibration, flag-off
  identity, and the ON legs a runtime pin can arm.
- **PASS 2 — the flipped tree (the close commit)**: every GREEN that needs a
  constants flip.

Two further columns are never mixed with those: **LIVE** = the user's machine
against real Esri / OpenFreeMap / adsb.lol bytes, and **NOT MEASURABLE HERE**.
**A FIXTURE NUMBER NEVER RE-BASELINES A LIVE NUMBER** (HARN-GAP-6), and **the
LIVE column is empty for every row in this record.**

### 4.1 Node gates — the 15 in `SMOKE_NODE_ONLY=1`, all green (13 s)

Numbers from the integrated tree at `990c7b5`; re-run **15/15** after the three
import fixes and again before the certification run's boot proof. Where a
second number appears it is the same gate on its owner's flipped branch, grown
by a ship-state row.

**The pre-re-take merge (PUSHED, tip `8240539` on
`claude/skyloom-r24-orchestration-6753n2`).** It landed EARLY — before the
standalone re-take set — because the user asked for it: *"can you at least push
enough now so I can test."* Five merges, in order: **`d0dba79`** (merge 8, E
`18bd5eb`; **ruling 2** in `verify-terra-live.js` — A's both-arms pin plus E's
page-error hook, returning `yawArc` AND `errNote`) → **`fb9c294`** (merge 9, A
`e7325cd` — the toy index container fix and the `STEP_SAFE` resize guard) →
**`2112a49`** (merge 10, B `b459056`; **ruling 1** on the chunk-fade import —
`rampT` taken, the duplicate `markPhase` import dropped) → **`718bea0`** (merge
11, C `ee10642`; **ruling 3** on the `AerialPerspective` import block) →
**`8240539`** (merge 12, D `1083168`). It was built on a FRESH worktree
(`/home/user/skyloom-r24-int`, branch `r24/int-next`, checked out at `ec53fd3`)
so the pass-2b browser run on the main worktree was never touched; that
worktree's local branch is deliberately behind origin and is fast-forwarded
after pass 2b's end line, and the re-take runs there. **Proofs on the merged
worktree**: content **byte-identical to the dry tree `e6227c4`** (`git diff`
empty), node smoke **16/16**, import-integrity **4/4**, `verify-c-flagoff`
**40/40**, `attr-proof` **BROKEN=0** — and **the first real compile of the
integrated tree**: `next dev` on `:3107`, `GET /` **200**, Turbopack compile
**12.8 s**, no module errors, **which closes C's "no `next build`" residual on
the `AerialPerspective` → `world-bend` import edge**. **The adversarial review of that merge came back and the pushed tree
STANDS.** Thirteen agents: four read-only reviewers — one per hand-resolved file
plus a lost-hunk sweep across all five branches — with three adversarial lenses
per finding. **The three resolution dimensions returned NO findings.** The
lost-hunk sweep returned three, **none of them a merge defect**: (a) the
review's own premise — *"no branch touches `fly-constants.js`"* — **was wrong**;
`r24/b`'s `45e2cde` deliberately brought `CHUNK_FADE.minFrames` **4** with its
consumer `rampT` wired in both sat engines and named in merge 10's message, so
the tree is coherent and only the PREMISE is corrected; (b) **`SURFACE_CALM` is
imported at `FlyScene.jsx:120` and used nowhere** — pre-existing at `ec53fd3`
(C's `fd7d28d` replaced the `SURFACE_CALM.depthOffsetFix` polygonOffset
expression and left the import), routed to C; (c) **`copyFileSync` is imported at
`verify-finalize-pace.mjs:24` and unused** — pre-existing at the base, one lens
confirming it before the 429 took the other two, routed to A.

**Merge 13, `01ff6d8`, pushed** (confirmed by `ls-remote`; a scripts-only delta
above `8240539`, which is why the user's test build moves with it): E `e1a67f8`
makes **B's headless attribute census node gate 17** — in the smoke set and in
`cert-run`'s node-first block, asserting **`BROKEN=0` with
`--noflag=FINALIZE_PACE` as the control**, so the toy index defect can never
return unnoticed; **node smoke is 17/17 from here on**. **The two node counts in
this record are two SETS, not a discrepancy**: `SMOKE_NODE_ONLY=1
scripts/r24-smoke.sh` runs **17** (its list carries `verify-seam` and the
smoke-only rows), while `cert-run`'s **node-first block runs 16**, `attr-proof`
included, because it does not repeat them. It also takes
`verify-terra-live.js` **VERBATIM from the merged tree** — A's both-arms pin,
the `__fxYaw` read and E's `attachPageErrors` together — rather than re-deriving
it, so ruling 2 cannot come back as a second conflict; adds a per-pose
**resident / with-model / VISIBLE** census that walks **every ancestor**,
because an invisible parent hides a visible child and `Object3D.traverse` does
not stop at one (**R19 §5's instrument artifact, cited by name**); and raises
`FLY_TERRA_SWEEP_MS` **600 s → 900 s** with the arithmetic in the comment.
`r24/e` tip `976db14` is ledger-only above it.

**Merges 14 and 15, and a two-minute broken tip.** `7946a16` (E `f8cb5a2`) gives
`cert-run` a **`CERT_ROWS` row selection**, so the re-take is the SAME runner
with a shorter list and inherits everything hardened this round — the curl port
refusal, the PGID captured at launch, the node-gates-first hard stop, the boot
proof with the tree re-stamped, the SPAWNED trap — plus a **`haze-red` row** that
runs `verify-linear-haze` with `HAZE_RED=1`, both arms pinned off, to record the
reader's noise floor; it is not in the default list. `66ad406` (A `7890d1b`)
takes **the seventh budget site**: `sat-road-engine`'s finalize bound is now
`Math.max(1, FINALIZE_PER_FRAME * budgetK())` and `verify-finalize-pace` goes
**21 → 22** with the site-count gate at **6 → 7**. **That merge shipped broken
for about two minutes** — the incident is §5.4 — and **`9bcaace`** is the fix
(dedupe of a duplicated `budgetK` import; **node smoke 17/17**, import-integrity
**4/4**, finalize-pace **22/22**). **`9bcaace` is the tree the re-take runs on**, the main worktree having been
fast-forwarded to it with `:3100` free.

**The Owens fix and merge 17, PUSHED as `83462eb` — the user's test tip.**
`r24/int-next` was **fast-forwarded to A's `c573d08`** (`dead5e5` +
`c573d08`; **no merge commit, because A had already merged `9bcaace` into
`r24/a` before starting** — the structural half of lesson 60, used the first time
it was available), then **merge 17 `83462eb`** took C's `2e1d700`. Gates on
`83462eb`: terra-residency **32/32**, vendor 20/20, import-integrity **4/4**,
`verify-c-flagoff` **40/40**, node smoke **17/17**; compile proof `next dev`
`:3107`, `GET /` **200**, compile **13.0 s**, no module errors. Confirmed on the
remote by `ls-remote`. **The main worktree stays at `9bcaace` under the re-take
batch**; after the nine rows and the `lod-fade` standalone it is
fast-forwarded and **E runs `terra-live` at 900 s against A's fix**.
**Merge 18, `9bf5f8a`, pushed** (E `7129aa0`, scripts + ledger only, node smoke
17/17): the resident/visible census repaired BEFORE it was pointed at that fix —
§5.2 — and **`9bf5f8a` is the user's test tip**, scripts-only above `83462eb`.

**Merge 19 is a FAST-FORWARD to `7540f20`, B's own tip** (B merged `9bf5f8a`
first — lesson 60's structural half again — so integration took it without a
merge commit), pushed: node smoke **17/17**, import-integrity **4/4**, and B's
new `fade-cover` proof PASS on the tree. It carries B's answer to the fade row
(§4.2): `userData.__noFade` on the two shared materials, and the
`minRunsPerFrame` **64** throughput floor in the heal loop.

**Merge 20, `93f1dce`, pushed** (C `446545b` + `1a28ab9`, on `r24/c` merged to
`9bf5f8a`): C's night ruling — the hill follows the moon — with orchestrator
gates on the tip reading `verify-c-flagoff` **44/44**, import-integrity **4/4**,
node smoke **17/17**. **Merge 21, `71f2c8c`, pushed** (E `a252330` + `afb25e2`):
the sun legs now **WAIT for the app to report the commanded elevation** (poll to
within 0.5° up to the recompute cadence, NOTCAL otherwise), **(6)** is gated on
**(0c)**, **(8)** counts declarations with comments AND strings stripped (bare
grep 2 → stripped **1**), the night clauses read **C's published moon key**, and
**the fade probe ATTRIBUTES `__noFade` materials instead of scoring them**; probe
self-test **7/7**, node smoke 17/17. **Merge 22, `9db481d`, pushed** (E `0f6560b`, scripts-only, node smoke 17/17)
folds C's night contract INTO the gate: **(3)** asserts the solar clamp **only
where `moonK` is 0** and SKIPs below the blend with the reason — *asserting the
clamp there is asserting the PRE-FIX behaviour* — and a new **(3m)** requires
**hill ≡ key within 0.5° in BOTH azimuth and elevation under moonlight, the
invariant that would have caught the defect**; **(2)/(4)** compare against the
published `moonKeyAzDeg` / `moonKeyElDeg` as wrapped az/el deltas **in the gate's
own convention**, with **null while `moonK` is 0 honoured as NOT CALIBRATED,
never a FAIL against the sun**. E's §2.7d carries the post-batch order with a
reason per row, the three exposed night gates last. **Merge 23, `175e33e`,
pushed** (E `ffe0893`, scripts-only; node smoke 17/17, import-integrity 4/4 over
**378 files**) lands the sun-lag fix — both sun gates re-issue the same pose to
re-run the sky effect (§4.2) — and **the widened `scripts/` sweep caught E's
first attempt** (`PIN_POSE` does not exist in `verify-one-sun`; it warps inline):
**the fifth catch since the sweep was widened, the second within an hour.**
**Merge 24, `95907ce`, pushed** (E `ba9c2ae`, scripts-only, node smoke 17/17):
`verify-depth-roundtrip` now consumes **the owner's in-app truth** — three probes
with `truth.hit`, **\|probe.viewZ − truth.viewZ\| within 1 %** against the
2.50–2.51 m double-un-reversal signature, NOT CALIBRATED with **the truth's own
reason** below three — and **the hand-built `Raycaster` is gone**. E's note is
worth the line: *"I had a working fix that borrowed r3f's internals off the
canvas store and deleted it before it ran — same mistake, better clothes; C owns
the truth now."* **Merge 25, `4a95763`, pushed** (C `514eddd`) lands the other half —
`window.__flyDepthTruth`, un-bent by the live `uBendK` and publishing its own
falsifiers (§3 C) — with `verify-c-flagoff` **49/49**, import-integrity 4/4 and
node smoke 17/17 on the tip. **Merge 26, `14c1220`, pushed** (E `cee3f57`, scripts-only, node smoke 17/17)
closes the consumer side: `verify-depth-roundtrip` reads **`reprojectionPx` and
`residualM` BEFORE distance** (1 px / 0.05 m per probe; a probe outside band is
**an instrument miss carrying that reason, never a `DEPTH_FIX` verdict**; fewer
than three survivors NOT CALIBRATED, **distinguishing no-hit from
hit-but-unusable**), prints `bendK` / `bendDropM` / `bendIters` / `residualM` /
`reprojectionPx` per probe, and labels the config mirror **informational** beside
the live `__flyDof` handle. **Merge 27, `b91899a`, pushed** (A `c7203b1`, scripts + gate only,
`verify-terra-residency` **32 → 35**) rules `lod-fade`'s gate (6) — the 14
duplicated DEM URLs are upstream **source-level clamping**, not refetches — with
gates 29–31 making sharing and refetch distinguishable by name (§4.2). **Merge
28, `8662015`, pushed** (D `5f9be56`; `verify-lod-fade` **55 → 64**, atmo-law
48/48, vendor 20/20, node smoke 17/17) carries §4.10c's verdict and §4.10d's
bounded `noParentMapFirst` recorder.

**Merge 29, `2618317`, pushed** (E `4195a09`, scripts-only, node smoke 17/17)
re-poses `verify-lod-fade` for the re-run: (9)'s OFF pace read taken FIRST, yaw
and pin stopped, and **`page.close()` before `ctx2` exists** — E: *"I fixed this
exact defect in `verify-flash-guard` two passes ago and did not carry it to the
gate with the same shape"* — plus F6 preconditioned on equal maxZ AND tile count,
`FLY_LOD_SWEEP_MS` defaulting to 1,500,000, D's revised P3, and **(6) classifying
a duplicated DEM URL at z === `demMaxZoom` as SHARED and anything else as a
REFETCH**, the ceiling source-parsed — E: *"I printed 'DEM, not imagery' as a
curiosity when it was the answer."*

**Merges 30 and 31.** `30` carried E's provisional loosening of one-sun's
(1)/(1b) to 1e-3°, **superseded within one merge**; **`a7a8739`** (merge 31, C
`7fa86cb`, `verify-c-flagoff` 49 → 50, node smoke 17/17) closed the residual at
its source and the strict 1e-6° bound is restored (§4.2). **`main` was
fast-forwarded to `a7a8739`** at the user's second request — *"Merge into main"*
— from `9bf5f8a`: **30 commits, 25 files, +2,231 / −94**, ancestry checked, the
six built-but-off flags read false **by import**, node smoke 17/17 before the
push; **`main` == the integration tip**. The main worktree under the post-batch
run **stays at `14c1220` until the batch's end line**, then fast-forwards for the
night gates and the tail re-runs.

**Merge 32, `8e21366`, pushed** (E `5a58f5e`, scripts-only) restores
`verify-one-sun`'s (1)/(1b) to **1e-6°** now that the publisher carries nine
decimals. **`main` stays at `a7a8739`**, one scripts-only commit behind, until the
close.

**Merges 33 and 34.** `d1408ed` (E `c3ef874`, scripts-only) makes
`verify-linear-haze`'s clause (3) **informational per arm** with the spread ratio
printed in the A/B block — *"the decode roughly halves the hour dependence
without removing it, exactly what a decode should do to a seam whose remaining
difference is tuning"* — **E deleting the assertion rather than parking it behind
a dead branch**; judges the night A/B only against `HAZE_NOISE_FLOOR`, with NOT
SEPARATED below it and **a bare sign test named as such when no floor is
supplied**; and makes the row **name its live channels** (`aerialPass`,
`aerialGate`, `content`, `depth`, `linear`) — *"a gate that cannot name its
channel cannot attribute its own result."* `c0c7cec` (merge 34, C `0f54071`,
ledger only) carries the ruling itself (§4.2).

**FOOTNOTE — THE STALE-COUNT SWEEP.** Every gate count in this record was
re-checked against the count the gate reads **today on the integration tip
`f22fcac`** (merged into `r24/f` and run from that worktree; browser counts are
read from the logs under `scripts/r24-out/`, each cited to its run). **Node, run
today, all PASS**: import-integrity **4** · depth-offset **7** · terra-residency
**35** · c-flagoff **54** · worker-normals **12** · skirt-worker **9** · lod-fade
(node) **64** · vendor **20** · skirt-fast **13** · frame-step **11** ·
finalize-pace **22** · artifact-hygiene **5** · `r24-b-attr-proof` **BROKEN=0** ·
seam (node leg) **10 rows** · shadow-calm **33** · atmo-law **48** · step-guard
**13** · `r24-b-prewarm-proof` **9** — and **`SMOKE_NODE_ONLY=1` reads 17 passed,
0 failed.** **Six counts had gone stale and are corrected in the table above**:
terra-residency (21 → 22 → 32 → **35**), c-flagoff (… 40 → 44 → 49 → 50 →
**54**), lod-fade node (51 → 55 → **64**), finalize-pace (11 → 17 → 21 → **22**),
atmo-law (41 → 45 → **48**) and the seam node leg (9 → **10 rows**). Two are not
corrections but honesty: **`classify`'s "38 gates" is INHERITED from R15** — the
gate prints no total, and shows 35 PASS rows today — and **`warbirds` and `daily`
print no total either** (19 and 28 rows). **Browser counts, each cited to its
run**: `scripts/r24-out/retake` — flash-guard **8/0**, step-clean **9/0**,
ladder-fix **13/0**, ladder-red **7/6**, fade **4/2**, one-sun **12/4**,
linear-haze **2/0**, haze-red **4/0**, depth-rt **3/0**;
`scripts/r24-out/lodfade` — lod-fade **18/4**; `scripts/r24-out/retake2` — fade
**7/0**, one-sun **38/4**, linear-haze **9/3**, haze-red **10/2**, depth-rt
**4/3**. **Every browser number in §4.2 matches its log** (the NOT CALIBRATED
counts sit beside these pass/fail pairs and are not part of them).

**Merge 39, `dd6502c`, pushed** (A `f3cf43b`; `verify-terra-residency` 35 →
**40**, node smoke 17/17): the residency cap follows the drawn set, with the
eviction count published so a merge can never again be ambiguous between the LOD
policy and the memory brake (§4.2).

**THE POST-BATCH RUN**, started 01:28:06 at load 0.72, `TREE UNDER TEST
14c1220`, **BOOT OK 61.5 s** — with **every post-batch fix verified PRESENT in
the tree before launch**: the warp re-issue at `verify-one-sun.js:238`,
`__noFade` in `verify-fade.js`, `truthUsable` in `verify-depth-roundtrip.js`,
`parked` in `verify-terra-live.js`, and `parkOffscreen` six times in the vendored
`index.js`. **The runner's canonical order puts `fade` FIRST** (01:29:36), not
the `CERT_ROWS` order.

**`depth-rt` re-runs post-batch, after `fade`.**

**And `main` was fast-forwarded to it**, at the user's explicit request —
*"Merge what is done so far into main so I can test"* — from the W0 scaffold
`6116fc5` to `9bf5f8a`: **a pure fast-forward** (`origin/main` was an ancestor),
**212 commits, 133 files, +41,660 / −272**. The pre-push check is worth
recording for its method: the built-but-off flags were read **by IMPORTING
`fly-constants.js`** — `LOD_CROSSFADE`, `AERIAL_LAW`, `SKY_PROCEDURAL`,
`FRAME_STEP`, `ENV_UNIFORM`, `RING_DEDUPE` all `enabled:false` — **after a regex
over the block's first 2,500 characters failed to find the top-level key behind
`LOD_CROSSFADE`'s long header comment**: the import is the honest read, the
regex was not. `main` carries the **W0** `CLAUDE.md` notice; **the R24 notice and
`FLY_ROUND24.md` land on `main` at the close**, with this branch. The re-take on
the main worktree (still at `9bcaace`) is unaffected.

| Gate | PASS 1 (flag-off) | LIVE | NOT MEASURABLE HERE |
|---|---|---|---|
| `verify-classify.mjs` | **PASS** — the "38 gates" is INHERITED from R15; the gate prints no total and shows **35 PASS rows** today | — | — |
| `verify-warbirds.mjs` | **PASS** | — | — |
| `verify-daily.mjs` | **PASS** | — | — |
| `verify-depth-offset.mjs` | **PASS** 7/7, 185 files; RED **6/7** on base `6116fc5` | — | — |
| `verify-terra-residency.mjs` | **PASS** — 21 as merged → **22** flipped → **32** after `dead5e5` (parkOffscreen + the cap) → **35** after `c7203b1` (the DEM-clamp gates 29–31); 22 merges / 17 replaced / 178 refetches → 0/0/0 | — | felt smoothness |
| `verify-c-flagoff.mjs` | **PASS** — 26 gates at `990c7b5`, **37/37** after C's F4 and on the flipped branch (gate (1) asserts the SHIP STATE, so it is green in both passes); **40/40** on the dry tree after the `linearHazeOn` pin added three gates (accessor exported · no other raw reader · the census skips comments), RED-calibrated by an added read in `SkyDome.jsx`; then **44** (`446545b`, the night hill ruling) → **49** (`514eddd`, the truth hook) → **50** (`7fa86cb`, the nine-decimal publish) → **54 today** (`a44f4b7`) | — | — |
| `verify-worker-normals.mjs` | **PASS** 12/12 (3.34° → 0.26°) | — | **pixels** — the spliced worker runs only on the Esri LERC path |
| `verify-skirt-worker.mjs` | **PASS** 8/8 (**9/9** flipped), element-identical | — | end-to-end streaming; ⚠ its identity leg goes RED **by design** with `workerNormals` ON and needs a flag-on ARM, never a re-baseline |
| `verify-lod-fade.mjs` (D's node half) | **PASS** — 51 as merged, **55** at the flip, **64 today** after `5f9be56` (§4.10c/d and the `noParentMapFirst` recorder); reads the DECLARED state | — | — |
| `verify-vendor-three-tile.mjs` | **PASS** 19/19 (**20/20** flipped, incl. gate 16b: the vendored switchboard's own literal defaults every switch to false) | live tile-URL identity (egress) | — |
| `verify-skirt-fast.mjs` | **PASS** 12/12 (**13/13** flipped); 13 cases, 4 bails | — | stalls/min |
| `verify-frame-step.mjs` | **PASS** 10/10 (**11/11** flipped) | — | the consumer opt-in against a pinned harness pose |
| `verify-finalize-pace.mjs` | **PASS** — 11 as merged; **17** after the rule-1 spike work, **21** after the index-container fix, **22 today** after `7890d1b` (the seventh budget site) (§4.2) | — | whether it removes a FELT hitch |
| `verify-artifact-hygiene.mjs` | **PASS** 5/5, tree clean | — | — |
| `verify-seam.js` **node leg**, offline | **PASS** — 9 in the run this table was written from, **10 PASS rows today** (0, 0b, 1–6, 6b, 6c; the browser leg 7–9 skips without `FLY_URL`) · 149 z14 tiles · Owens `hatchKept` **0** · worst slope 2.5 · ramp 0/149 · 0 seam pairs · manhattan kept **311** `8d36f2aa:89218640:13605`, columbus kept **193** `2eefc447:49bbe703:8715` — **identical to the pre-merge run on `r24/e` alone** | the LIVE hashes stay frozen | the fixture's Owens yields no z14 candidates at all, so gate (1) passes "0 by construction" and is WEAKER here than live |

**The flag-off byte-identity claim is measured, not asserted**: with every R24
flag off, five agents' merges leave the worker's output byte-identical on 149
fixture tiles.

Node gates outside that 15: **`verify-shadow-calm.mjs` 32 → 33 (**33** today)**, `verify-atmo-law.mjs` 41 → 45 (**48** today), A's
`scripts/_r24a-ship-state.mjs`, B's `r24-b-prewarm-proof.mjs` **9/9** / `--red` **5/9** as recorded
(**6/9 FAIL** re-read at the close), and B's four engine/worker/bend/groundvis proofs — the source of every
Symptom-A number in §1. E's **`verify-import-integrity.mjs`** (RED 3 files /
8 errors on the broken tree) is the FIRST node row on E's head `3a21403`, which
merges after the run; the 15/15 above predates it.

### 4.2 Browser gates — two passes

**The per-leg record lives in `scripts/r24-close-sweep.md` §5.1–§5.13** (its §5.0
is the citation index); the cells below keep the verdict, the load-bearing
numbers and the attribution, and cite that file rather than repeating it.

**The re-take is RUNNING on `9bcaace`** (`CERT_OUT=scripts/r24-out/retake`,
`:3100` free), and it is **NINE rows in the batch plus one standalone**. The
batch — flash-guard, fade, step-clean, one-sun, linear-haze, **haze-red**,
depth-rt, ladder-fix, ladder-red — runs through `cert-run`'s new `CERT_ROWS`
selection, so every hardening of this round applies unchanged. **`lod-fade` runs
STANDALONE immediately after**, against a `CERT_PROOF_ONLY=1` server with
`FLY_LOD_SWEEP_MS=900000` and its own timeout, **because it does not fit the
runner's per-row `timeout 2400`**: 360° at 0.85°/frame is **424 rendered frames
per arm**, pass 2b measured that gate's arms at **0.65 and 1.15 fps**, so two
sweeps alone are **~1,000–1,300 s** on top of two boots (~120 s each), two
settles (45 s) and two Owens `settleWorld` passes (~220 s each) — **~2,500–2,800
s**. A row killed at 2,400 s **loses even the OFF leg**, and shortening the sweep
would return a capped arc: an honest NOT CALIBRATED under E's guard, but not the
measurement D's §4.10b template needs. **`terra-live` is DEFERRED** until A's
residency fix lands, because its open row is a product question and not an
instrument one.

**THE NINE-ROW BATCH IS COMPLETE, on `9bcaace`.** **CERTIFIED**: `flash-guard`
**8/8**, `step-clean` **9/9**, `ladder-fix` **13/13** with `ladder-red` **7/6**
holding. **PARTIAL, ATTRIBUTED**: `fade` **4/2** — the fading layer reads 0 hard
by B's proof, the remainder is two DECLARED no-fade layers, and it re-runs with
the attributing probe. **REFUSED BY INSTRUMENT, MECHANISM FOUND, RE-RUN
PENDING**: `one-sun` **12/4/6**, `linear-haze` **2/0/8**, `haze-red` **7
NOTCAL** — all three on the 60 s wall-clock interval this venue starves, fixed by
the `warpEpoch` re-issue — and `depth-rt` **3/0/2**, with no camera or `THREE`
handle outside the bundle and C's in-app truth raycast pending. **NOT ONE ROW'S
RED WAS A FEATURE DEFECT OF THE FLAG IT CERTIFIES.** Two feature defects were
found by the rows anyway and fixed — **the toy index container and the night
hillshade** — and one feature was measured **breaking a frozen ceiling** and
fixed: **residency draws**. **NEXT**: E's `lod-fade` STANDALONE against a
`CERT_PROOF_ONLY` server on the `9bcaace` worktree at
`FLY_LOD_SWEEP_MS=900000` with its own timeout, from which the `LOD_CROSSFADE`
go/no-go follows per D's §4.10b template; then the main worktree fast-forwards to
the merged tip (`175e33e` or later) and the post-batch list runs there.

**The standalone IS RUNNING**, on the `9bcaace` worktree: the server started
under `CERT_PROOF_ONLY=1` **with the PGID captured the moment it printed** (DEV_PID
9184, DEV_PGID 9171, five group members, written to a scratch file as well as
held in session) — *"that is the whole reason to capture at LAUNCH rather than at
teardown: `CERT_PROOF_ONLY` disarms the cleanup trap, so there is no safety
net"*; `TREE UNDER TEST 9bcaace`; **BOOT OK 65.4 s**. The invocation is
`FLY_TILE_FIXTURE=1 FLY_FINALIZE_BUDGET_K=40 FLY_BOOT_SCALE=6
FLY_LOD_SWEEP_MS=900000 LOD_SETTLE_MS=45000 timeout 5400 node -r
./scripts/_pw-shim.js scripts/verify-lod-fade.js` — **the 5,400 s ceiling instead
of `run()`'s 2,400 being exactly why this row is standalone** — two boots, two
360° sweeps at 0.85°/frame (~424 rendered frames each) and two `settleWorld`
passes at Owens. **The log carries D's §4.10b rows mechanically**: arc per leg
with its frame count; the ladder identity **refines + merges === hardSwaps +
faded** on both arms; the ±25 % frame-comparability guard on **(14)** that fired
at 0.57 last time; `faded` rising while `hardSwaps` drops; `maxBlendRun` as the
crossfade window, **≥ 5 a complete blend and 2–4 a sweep that ended mid-blend**;
the drain snapshot **at the instant it held** plus a second read attributing any
non-zero `active` to arrivals; the leak signature **`active === 0 && retained >
0` on both reads**; the invariant **retained ≤ active ≤ 4 × retained**; and Owens
draws and tris equal between arms with both settles. Logs:
`scripts/r24-out/lodfade/lod-fade.log` and `lodfade-server.log`; teardown is TERM
→ KILL on the PGID with a `curl` to 000 before "done". **It completed at 18 / 4 /
2, and the shape of its verdict is: the SUBSTANCE is strongly positive — 61 of 62
refines faded against 72 of 72 hard with the flag off, no parent-texture leak,
bounded concurrency, a 31-frame blend window — while **THREE of D's six
preconditions FAIL** (P3, the single `noParentMap` denial, a defect-shaped reason
the template requires at 0; P5, the arc capped at 264° with the frame ratio 0.75
at the edge of the ±25 % guard; and P6, both arms SETTLED but at maxZ 17 against
16). **Under §4.10b as written that is NO FLIP this round**, unless a re-run on A's parked tree with a longer ON sweep (~1,500 s)
passes it — **`LOD_CROSSFADE` ships OFF, and D states the mechanical verdict.**

**THE REVISED CLOSING SEQUENCE**, after `terra-live` was killed by the row
ceiling and A re-sized the cap: E finishes `verify-flicker` and the three tail
re-runs (`one-sun`, `linear-haze` at floor **1.2**, `depth-rt`) on `3231f7d`;
teardown; the main worktree fast-forwards to the tip (`dd6502c`, plus C's dusk
fix if it lands first); **`terra-live` STANDALONE** on the adaptive-cap tree with
the published eviction count; **the three NIGHT gates** with the adapted
screenshot path (§4.3); and **`lod-fade` STANDALONE last**, from which D's ruling
follows. **A VENUE EVENT interrupted it**: the container restarted at ~03:55 UTC
on the session limit and **killed the `terra-live` standalone on `645d08c`
mid-sweep — w4, nothing measured** — and E relaunched steps 5–7 on the same tree
into `scripts/r24-out/w5` (node gates **17/17** again). Tip `645d08c` = merge 41
(C's truth arbiter `81d803a`) + merge 42 (E's four: the night-gate adaptations
`482fe10`, runner knobs `8a5da27`, close sweep `17cffa6`, and the `terra-live`
print patch `fc83e64` carrying A's three placement notes), pushed.

**Re-take header, started 23:37:28 at load 0.45 — the quietest conditions any
pass has had.** Tree at start `9bcaace`; **`cert-run`'s node-first block
16/16, including `r24-b-attr-proof.js` at `BROKEN=0`** — on `ec53fd3` the un-pinned run read **80
broken LAND meshes**, so **A's `FINALIZE_PACE` fix is CONFIRMED in node, in under
a second, with no GL context, and the defect can no longer reach a browser row**;
dev `:3100` **PID 26928 / PGID 26915**, distinct — the exact case where trusting
`$!` names a corpse; `TREE UNDER TEST 9bcaace` with **no drift**; **BOOT OK
63.2 s** against 2b's 60.9 s and 2a's 62.3 s, so **neither of A's fixes cost boot
time**.

| Gate | PASS 1 — flag-off (`5ca8e15`) | PASS 2 — flipped | LIVE | NOT MEASURABLE HERE |
|---|---|---|---|---|
| **boot proof** | **PASS — `BOOT OK in 62.5 s`**, zero console errors, zero page errors, zero failed `/_next/` chunk requests | **PASS — `BOOT OK 63.2 s` on `9bcaace`** at the re-take header, against pass 2b's 60.9 s and pass 2a's 62.3 s: **neither of A's fixes cost boot time**. Final reading; no further boot proof is scheduled | — | a boot WALL TIME here is a SwiftShader number, never a budget |
| `verify-fixture.js` | **rc=0, 2,045 s, 10/10** at K=200 with a 900 s settle cap. (1) deterministic bytes — mvt 12,021 B / dem 1,817 B / img 46,864 B; (2) the 200-with-empty-body tile reachable; (3) satellite boots the fixture in **124.1 s** (`pct 100` at 54.6 s), img 74 / dem 74 / mvt 67 / tilejson 20; (4) **Manhattan is a city** — satBuilding meshes **22**, tris 496,466, settled in **256 s** at load 4.1, draws **189**, meshes 216 (satBuilding 22, satSkyline 10, toyChunk 110), sb **16/16**, maxZ 14, tiles 125; (5) **Powell is a suburb** — 16 satBuilding meshes, sb 16/16, draws **194**, tris 368,119, **parcel homes 555**, settled 200 s, maxZ 15, tiles 161; (6) **THE OWENS LOCK** — bld 0 / sky 0 / parcel 0, draws **166**, tris 183,709, sb ready 0 / **empty 16**, settled in **38 s**, maxZ 16, tiles 177 (FIXTURE column, informational against the live ≤ 261); Melton draws 184, tris 486,321, **1,836 parcel homes from zero footprints**; (8) traffic stub 300 tracks, 69 aircraft requests; (9) toy boots on the fixture — toyChunks 98, tris 273,567, boot 141.3 s, draws 212; (10) both boots clean | **rc=1, 1464 s, 9/10 at K=200 with a 900 s per-pose cap (22:41:29) — the venue certifies itself again on the flipped tree, and the ONE red is the tree's own missing fix.** Deterministic bytes unchanged (mvt **12,021** / dem **1,817** / img **46,864** B); the 200-with-empty-body tile reachable; satellite boots in **122.2 s** (`pct 100` at **53.4 s**; img 68 / dem 64 / mvt 64 / tilejson 20); **Manhattan is a city** — 23 satBuilding meshes, **549,471** tris; **Powell is a suburb** — 16 meshes, **16/16** chunks ready, 0 empty; **THE OWENS LOCK HOLDS** — 0 buildings / 0 skyline / 0 parcels, draws **219** (FIXTURE column, informational against the live ≤ 261); traffic stub reaches the engine (300 tracks, 53 requests); **toy boots** — 302 chunks, **375,424** tris, 130.2 s. **(10) no page errors FAILS on toy: `TypeError` `byteLength` ×3 — which is `ec53fd3`, the tree WITHOUT A's index-container fix, so it is the EXPECTED red**; the fix is in the pushed tree from `8240539` onward and B's census is node gate 17 from merge 13. **CERT DONE 23:05:53**; the dev server was killed by PGID and the port released; logs `scripts/r24-out/cert3/` **CLOSED.** Gate (10)'s red was toy's `byteLength` ×3 on `ec53fd3`, the tree WITHOUT A's index-container fix — **closed by that fix, confirmed by node gate 17 (`r24-b-attr-proof.js`) reading `BROKEN=0` on `9bcaace`** where the un-pinned run on `ec53fd3` read 80. **No browser fixture re-run is planned**, so this row's final result is the 9/10 above plus that node confirmation · per-leg detail: `scripts/r24-close-sweep.md` §5.1 | — | n/a — it certifies the venue |
| `verify-flash-guard.js` | **rc=1, 534 s, 5 passed / 1 failed — RED calibrated**; legs below. **Three readings that change how the flag is described:** the **skyline site is INSURANCE, not a fix** — its path runs `simplifyRing` before the wall loop and the collinearity test drops the closing clone, so the zero-length wall edge never exists there and a green at that site repairs nothing (recon A1b predicted it; nobody had measured it — B ledger §15.1); **Powell's 8.28 % lands inside R22.1's live 6.36–8.64 % band** while Manhattan's worst chunk at **13.98 %** is above it, the expected shape rather than a contradiction (the band was quoted for *every large chunk*, the defect is a fixed count per ring, so a chunk with small or few footprints is proportionally worse — B's 4-corner fixture reads 14.22 % for the same reason); and **the toy site is NOT EXERCISED by any row this round** — both poses run satellite, the toy extruder carries the same wrap-around loop at `vector-tile.worker.js:4285`, and the close ruled no toy leg is added, so B's node legs (toy `full` **14.84 % → 0**; 2,288 → 0 on E's Manhattan tile) are **evidence that the code works and not a certified browser leg**. **`(4) PALE DETECTOR` — `frames=256 pale=168 worstScanlineMean=222.3` — is VOID and must never be quoted as a result**: the scanline sat 55 % up the frame and a banked serpentine spends much of its time looking at a clear daytime sky (~213 luma), so 168 identical-mean frames are a sustained bright FIELD, not the one-frame jump the detector exists to catch — R17 §7.1 arriving as false POSITIVES for once. Fixed at `r24/e e1b7905` (running median of 24 frames, scanline at 0.25 height bottom-up, a hit needs jump > 60 over the median AND min > median + 40 AND absolute > 180; renamed `worstJumpOverMedian`), **not yet RED-calibrated** — it owes a synthetic one-frame jump scoring exactly one hit and a serpentine scoring zero | **pass 2b: rc=1, 571 s, 6 passed / 1 failed — the census is ALIVE, the green leg is void again, and the detector lost its own self-test** (below). **RE-TAKE: rc=0, 1423 s, 8/8 — `FLASH_GUARD`'s FIRST GENUINE GREEN**, on `9bcaace`, started 23:39:02, K=40, load 4.29 / 4.20 / 3.70. **(1a)** the census has something to count at Powell — **165,520 tris across 16 meshes**; **(2) RED calibration: the zero-area population EXISTS** with `__flyFlashPin=off` — **13,766 zero-area triangles (8.32 %)**, and the gate is RED-valid *only* because that is > 0; **(1b)** Manhattan census non-empty — 171,432 tris across 16 meshes; **(4a) no false positive** — the banked serpentine registers **ZERO isolated pale frames in 668** (worst jump over median 77.1 against a baseline 20.2); **(4b) the detector FIRES** — one synthetic white frame registers **EXACTLY ONE hit** (f 670, mean 255, median 20.2, min 255, candidate true); **(3) GREEN — the zero-area count is EXACTLY 0 at every site with the guard armed** (tris 151,754); **(5)** the degenerate RATE falls and never rises — sat-buildings **8.32 % → 0.00 %**; **(6)** no page errors. **INFO (4)**: the pale detector is probabilistic and **absence is NOT proof** — armed, 668 frames, 0 pale, 0 sustained. **What makes this verdict mean something, against the two voids**: pass 2a's census read **0 meshes** (the venue starved by `mayFinalize`) and pass 2b's green leg read **0 meshes** (page 1 still rendering) with **(3) printing PASS on nothing** and the self-test scoring 0; this run closes page 1 BEFORE the armed page boots, settles both legs on `_settle.js`'s condition rather than a fixed 60 s, and scores the self-test frame OUTSIDE the run-length bookkeeping — so the armed census is **non-empty for the first time** and (3) reads 0 **on a real population**. **The settles are what cost the 1,423 s and what made it valid**: RED leg Powell **SETTLED at 422 s** (16/16 ready, maxZ 17), GREEN leg Powell **SETTLED at 274 s** (16/16, maxZ 17) — **(3) reads zero=0 over tris 151,754 where 2a and 2b read zero=0 over tris 0**. **(5) is deliberately a RATIO** because the two boots settle different chunk counts, and **Powell's 8.32 % sits inside R22.1's live 6.36–8.64 % band, so the fixture still stands in for the real defect**; **(4a)'s 0 isolated / 0 sustained against 2b's 3 sustained runs is a BASELINE difference** — 20.2 here, a dark ground scene at the scanline, against 237.8 sky there. **CAVEAT 1: Manhattan did NOT settle** — 12 of 16 chunks still draping at 420 s, ready 4, maxZ 16 — so its census (6 sat-building meshes, 87,680 tris, worst chunk 13.97 %) is a **FLOOR**, (1b) passing means only that the census had something to count, **the A/B lives in the Powell pair and Manhattan is corroboration at best**. **CAVEAT 2: `FLASH_GUARD telemetry: null` still** — the runtime pin and the constant are different switches — **so (3)'s green rests on the census, not on the feature announcing itself** (§5b, for B) · per-leg detail: `scripts/r24-close-sweep.md` §5.2 | PENDING — the pale FRAME itself | the pale detector is probabilistic (live rate 1 per 1,600 to 1 per 20,389 composed frames); **the census decides the gate** |
| `verify-fade.js` | **rc=1, 338 s, 4/2 — RED calibrated.** (1) births **14** / deaths **10** over 94 frames; (2) **14 of 14 hard births** — *"presence channel is none: no material carries a fade uniform"*, which IS the flag-off state; (3) **10 of 10 hard deaths**; (4) `ready` tracks CHUNKS, not presence (ready 0 of 16 during the serpentine); (5) **THE OWENS LOCK — sbReady 0, skyReady 0, draws 156** (a FIXTURE number; the live ≤ 261 is not re-baselineable from here); (6) clean. **GREEN needs pass 2** — the gate carries no ON pin | **pass 2b: rc=1, 346 s, 4 passed / 2 failed — the flip produced NO fade VISIBLE TO THE GATE, and the cause was the INSTRUMENT.** 29 of 29 hard births and 20 of 20 hard deaths with the probe reporting *"presence channel is 'none'"* — `verify-fade.js:81-95`'s `presenceOf()` looked for uniforms named `uBirth`/`uChunkFade` and an `opacity < 1`, while B publishes `userData.__fadeU`, **so the gate read a channel B never wrote and called the feature dead**; the Owens delta of +34 draws was left unattributed here. Per-leg detail: `scripts/r24-close-sweep.md` §5.3. **RE-TAKE: rc=1, 380 s, 4 passed / 2 failed — the probe now SEES the fade, and what it sees is a PARTIAL result.** On `9bcaace`, started 00:02:45, K=40, load 4.12 / 4.11 / 3.83. **THE CHANNEL IS ALIVE**: presence channel = **`userData.__fadeU`** where pass 2b read `none`, **82 of 114** serpentine frames carried a partial-presence mesh (**was 0**), and the runtime evidence line lists **births / dying / fadeTwins / fadeBudgetMiss** — E's probe fix and B's contract met correctly, and **the first fade reading that is about the FEATURE**. Gates: **(1)** the watch has something to watch — births **26**, deaths **11** over 114 frames **PASS**; **(2) NO HARD BIRTH — FAIL, 8 of 26** births at full presence on their first displayed frame; **(3) NO HARD DEATH — FAIL, 6 of 11** deaths leave from full presence with **cumulative `fadeBudgetMiss` 0**, i.e. *"an UNEXPLAINED remainder — this is the defect shape"*; **(4)** a fade never changes what is ready (ready 2 of 16 chunks, series in the JSON) **PASS**; **(5) the Owens lock** — sbReady 0 / skyReady 0, draws **191** (FIXTURE column) **PASS**; **(6)** no page errors **PASS**. **Against pass 2b's blind probe (29 of 29 hard births, 20 of 20 hard deaths), the re-take reads 8/26 and 6/11 — B's fade IS running and the `minFrames` 4 floor demonstrably works for 18 births and 5 deaths.** The remaining 8 and 6 are **honest FAILs, not venue artefacts**: `fadeBudgetMiss` is 0 and `maxConcurrent` never reported exhausted, **so B's own attribution rule convicts rather than excuses them**. The venue note is kept WITH its limit: `_startDeath` writes `value = _altFade` (1.0 at these poses) and the value only moves on the NEXT `_stepFades`, so at ~2.84 s per frame a 0.3 s `evictSec` ramp cannot span two samples — **but the floor was merged precisely to remove that excuse, and 5 deaths DID span partial samples**. **THE HEAL TAXONOMY, E's exhaustive ledger paying off**: heals **9** = `healsQueueFull` **4** · `healsAborted` **4** · `healsCoalesced` **1**; `healsInPlace` **0**, `healsNoop` 0, `healsNoRecord` 0 — **the outcome that IS the `HEAL_IN_PLACE` fix never occurred in this window**, and the 4 queue-full heals are the only real holes. *Without the taxonomy this would have read "heals 9" and said nothing.* **ROUTED TO B** (read-only on the log; merge `r24/int-next` first): attribute the 8 and the 6 **from source** with a synthetic **0.35 fps** clock — the floor in BOTH engines and BOTH directions, `f0` stamped at first display, deaths starting in the same frame as a heal / coalesce / `warpEpoch` bump, parcel and monument twins — a node RED/GREEN reproducing the shape and reading **0/0** after; and **rule whether `healsInPlace` 0 over a 114-frame serpentine is BY CONSTRUCTION** (saying what window would exercise it) **or a defect**. Marker stands — B has it **B'S ANSWER, and it is a COVERAGE GAP, not a floor failure** (`7540f20`, merge 19). B's new `scripts/r24-b-fadecover-proof.js` drives all three satellite chunk engines headless **at the venue's own 2.84 s/frame**, applies **E's exact presence rule per mesh** and attributes every hard event to its LAYER: **sat-building 54 births / 0 HARD · 45 deaths / 0 HARD · 54 of 54 wearing `__fadeU`** — **zero hard events on the fading layer at the venue's frame rate**. All four candidate mechanisms are CLEARED BY MEASUREMENT: the floor is applied **in both engines and both directions**; **`f0` IS stamped at first display** (the birth writes value 0 in the same synchronous block as `object.add`, so the first sample is 0); no heal / coalesce / warp path skips a ramp; the parcel and monument twins are not in this set. **What is left is two layers under E's probed roots with NO fade channel at all**: **sat-roads** (a probed root) — one shared `MeshBasicMaterial`, transparent at **opacity 1**, no `__fadeU`, so **E's opacity fallback returns 1 — THIS is the hard remainder**; and **sat-water** (inside `__satBuildings.object`) — a shared additive MeshPhong at opacity 0.9, which the fallback reads **PARTIAL forever**, inflating `partialFramesSeen` and contributing **ZERO** to the hard count. Both exclusions were deliberate and already reasoned (`verify-sat-night` pins one material instance; meshes === ready === visible for the road engine) — **B's own words**: *"My mistake was documenting that IN PROSE ONLY: an undeclared design decision is indistinguishable from a bug, which is precisely what happened."* **FIX 1**: both shared materials now carry **`userData.__noFade`** with the reason, so a probe ATTRIBUTES them instead of scoring an unexplained hard birth, and a **new gate leg — every material a presence probe can meet either fades or declares `__noFade`** — passes on the tree and **FAILS on pre-fix `9bf5f8a`** via `--root=`. A real road fade stays a **scoped §5b follow-up** needing a `verify-sat-night` sanction: *"putting a load-decided coin into a frozen gate at close is the trade §7.6 already refused."* **`healsInPlace` 0 is BY CONSTRUCTION, and the exhaustive taxonomy is what proves it**: heals 9 = queueFull 4 + aborted 4 + coalesced 1, and **`healsAborted` means the chunk was evicted or re-streamed under the job — no chunk, no hole**; at 2.84 s/frame a ~90 m/s serpentine moves **~250 m per FRAME**, so chunk residency is a handful of frames, shorter than any budgeted multi-frame re-drape — **and the row's own `readySeries` shows sb ready 3 → 0 mid-window, every in-flight job dying with its ring**. **The path is not broken**: at the SAME 0.35 fps B's engine proof measures **`healsInPlace` 6–8 of 8–12** when chunks live long enough. **FIX 2, which the question flushed out**: the heal loop carried **the SAME frame-rate bug as the fade ramp** — `HEAL_IN_PLACE.budgetMs` is a per-FRAME time budget, i.e. a frame-rate-dependent THROUGHPUT (36 ms/s at 60 Hz, **0.2 ms/s at 0.35 fps**) — same shape, same fix: **`minRunsPerFrame` 64**, a forward-progress floor, with the ms budget hit first and governing alone at 60 Hz; measured with the budget forced spent (`--healstarve`, `budgetMs` 0 = the limit of what a long frame does): **`redrapeRuns` 15 → 580, `healsInPlace` 0 → 2**, **and the gate asserts FORWARD PROGRESS rather than `healsInPlace`**, because completion also depends on the chunk surviving and *an eviction is not a pacing failure*. **ROUTED to E**: the fade probe must ATTRIBUTE `__noFade` materials and never score them, with a leg that **every hard event is attributable**; **fade re-runs post-batch after one-sun**; and the window that would exercise the heal path is named for an informational leg — **a STATIONARY hold, no warp and no serpentine, over E's Sierra relief scene (36.578 / −118.29, 394 m over 3 km), pinned once and held ≥ 20 frames so `_pumpRedrape` can drain**, reading `healsInPlace` against the new `redrapeRuns` counter and treating `healsAborted` as a CORRECT outcome. **POST-BATCH: rc=0, 398 s, 7 passed / 0 failed — `CHUNK_FADE` CERTIFIED ON THE VENUE, and `HEAL_IN_PLACE` EXERCISED for the first time.** On `14c1220`, started 01:29:36, K=40, load 4.68 / 4.35 / 4.04. **(1)** births **16**, deaths **3** over 105 serpentine frames; **(2) NO HARD BIRTH — 0 of 16**; **(2b) NEW — EVERY HARD EVENT IS ATTRIBUTABLE: 0 hard events on a material carrying neither `__fadeU` nor `__noFade`**, with the DECLARED non-faders attributed and never scored — **258× *"sat-roads: excluded from `CHUNK_FADE` — `verify-sat-night` pins one material instance for this engine"*, i.e. the whole re-take remainder, now NAMED instead of convicted**; **(3) NO HARD DEATH — 0 of 3**, cumulative `fadeBudgetMiss` **1 ≤ the cap**, *"CAPPED AS DESIGNED (`maxDying` 4, and the evict loop + AGL cull can present more at once)"*; **(4)** a fade never changes what is ready (ready 3 of 16); **(5) the Owens lock** — sbReady 0 / skyReady 0, draws **182** (fixture); **(6)** no page errors; presence channel `userData.__fadeU`, **70 of 105** frames carrying a partial-presence mesh. **HEAL OUTCOMES on the PARKED tree with B's throughput floor**: heals **2** = `healsInPlace` **1** + `healsCoalesced` 1, with `healsQueueFull` **0**, `healsAborted` 0, `healsNoRecord` 0, `redraping` 0 — ***"0 budget-starved heals: no hole is attributable"*** — **the `HEAL_IN_PLACE` outcome that IS the fix, observed on the venue for the first time** (pass 2b and the re-take both read 0 in-place, BY CONSTRUCTION on the starved serpentine). **The progression is the row's real argument**: pass 2b **29/29 births + 20/20 deaths hard** with the probe BLIND → re-take **8/26 + 6/11** with the channel alive and a coverage gap → post-batch **0/16 + 0/3** with the gap DECLARED, **the floor and the probe finally agreeing**| PENDING — the LOOK of the fade | — |
| `verify-lod-fade.js` | **rc=1, 317 s, 2 passed / 5 failed — RED calibrated** (Powell, a 40 s PURE YAW with the position frozen). (1) `residentTiles` 0 / `estMB` undefined — A's byte LRU only tracks with `TERRA_PACE` on, expected in pass 1; (2) 47 frames, 61 events; (3) **27 RE-appearances on a pure yaw** = A's T1/T3 bend-blind re-stream, measured from the other side; (4) **8 hard refines + 3 hard merges** = D's T4 atomic swap; (5) crossfade window **0 frames**; (6) **15 tile URLs refetched**, worst 2× `/img/6/23/17` = A's refetch defect; (7) Owens FIXTURE draws **174** / tris **166,659**; (8) zero page errors. **Scope of the wall-clock caveat, narrowed:** it applies to **(3) and (6) ONLY** — both are functions of how far the heading moves per download round-trip, and this sweep steps ~51° per rendered frame (PASS 2 cell). **(4) hard refines + merges is yaw-rate INDEPENDENT** — an atomic parent↔children swap is atomic at any heading rate — **so it stands as D's T4 RED and §1 Symptom B's citation is unqualified.** **(5) has since been RETIRED**: its 0 is true at any rate but carries no information, because a mesh co-display census reads 0 by construction under `parentBlend`, and recording it in the RED table as a defect was an error of this record's own — corrected here, and replaced in the gate by `maxBlendRun` over `terra.fades.active` (PASS 2 cell). The re-take's OFF leg re-measures all four, so the record will end up carrying both experiments for (3)/(6) and one consistent RED for (4)/(5). **A gap the row exposed:** as written the gate has **no ON leg** — it never sets `window.__flyLodFadeOverride` — so the one feature that ships OFF *pending a measurement* could not have obtained it from either pass. E is adding a pinned ON leg for pass 2 (D reviewing it, §5.2); expected then: (3) and (6) GREEN from `TERRA_PACE`, (4) and (5) still RED in the OFF leg because LOD ships OFF, and **the pinned ON leg decides D's go/no-go** | **PASS 2b: the row CRASHED after gate (13)** — `ReferenceError: notCalibrated is not defined` (`verify-lod-fade.js:782`), gate (14)'s NOT CALIBRATED path calling a helper the file never imports: **the round's own unimported-symbol class, this time in a HARNESS file**, which `verify-import-integrity` could not catch because it swept only `lib/`, `components/`, `app/`, `hooks/` and `stores/` — the sweep was widened to 374 files in response, and caught its next one within the hour. Pass 1 and pass 2b per-leg detail: `scripts/r24-close-sweep.md` §5.4. **THE STANDALONE RAN TO COMPLETION: 18 passed / 4 failed / 2 NOT CALIBRATED** (`9bcaace` worktree, `CERT_PROOF_ONLY` server, `FLY_LOD_SWEEP_MS=900000`, `LOD_SETTLE_MS=45000`, K=40, `timeout 5400`). **VERDICT PENDING D**, who applies the §4.10b template — the mechanical ruling is D's to state. **OFF LEG**: **(1)** a real resident tile field at Powell — **73 of 101 tiles carry a model** — and the **arc swept 360° over 424 rendered frames** at 0.85°/frame, **the first complete revolution any run of this gate has managed** (pass 2b's sweeps were 46 frames); **(2)** census 432 frames / 360 events; **(3) NO TILE LEAVES AND COMES BACK ON A PURE YAW — 0 re-appearances**, where pass 1 read **27** at 51°/frame on the flag-off tree: **a whole revolution with the position frozen and nothing came back — A's residency trio measured across the very sweep it was accused on, the strongest form of that result available**; **(4) NO HARD LOD SWAP — FAIL, refines 72 · merges 0, all hard**, which is **the RED as it must be with the flag off**; **(5)** co-display run 0 — **NOT CALIBRATED BY CONSTRUCTION**, D's blend mixing the parent TEXTURE into the child material and never co-displaying meshes; **(6a)** 552 distinct tile URLs fetched (614 total) — the denominator; **(6) FAIL — 14 of 552 refetched, ALL DEM**, worst 4× `/dem/15/8822/12386.png`, **no imagery URL refetched at all** (pass 2b: 20 of 59 at 51°/frame): *a different and much narrower finding than "the streamer re-fetches on yaw"*, **routed to A** for attribution among a backoff re-request of the fixture's 200-empty-body DEM, a skirt-rebuild path, or a residency gap for DEM; **(8)** no page errors; **(8b)** ladder identity 72 + 0 = 72 + 0; **(9)** `TERRA_PACE` is the SHIPPED state on both legs, no pace pin (OFF null · ON null); Owens settled 53 s (maxZ 17) — draws **275** / tris 329,348 (fixture). **ON LEG** (armed via `__flyLodFadeOverride`, second context): the arc swept **264° over 311 rendered frames, CAPPED at 900 s before it completed** at **0.35 fps** — *the crossfade itself costs frames on this renderer, twin materials during blends*; **(10) THE ON LEG IS ARMED** — `skip.disabled` 0; **(11)** 62 refines + 0 merges; **(12) FAIL** — shape 0 · **noParentMap 1** · unpatched 0, one fade denied because its parent had no map, attribution with D; **(13)** ladder identity 62 + 0 = 62 against hardSwaps 1 + faded 61; **(14) NOT CALIBRATED** — OFF 432 vs ON 322 frames, **ratio 0.75 at the edge of the ±25 % comparability guard**; **(15) THE MASS MOVED — faded 0 → 61, hardSwaps 72 → 1**, with E's note that under `skipBootMs` 0 the boot itself fades, so **faded-in-window is the sweep proof**; **(16) EVERY BLEND DRAINS — the drain HELD after 2 rendered frames at active 0 / retained 0, and a second read 12 frames later read the same: NO parent-texture leak**, the single most important thing this leg can catch; **(16d)** not evaluated (no read caught a non-empty active set — **not a pass**); **(17)** peakActive **8** ≤ `maxConcurrent` 32 (source-parsed), **(17b)** `skip.concurrency` 0; **(5-ON) A CROSSFADE WINDOW EXISTS** — longest run of frames with a live blend set **31**, blend frames **184 of 322**, peak active 8; INFO 233 of 233 tile materials carry `__lodFade.mix`, 0 strictly inside (0, 1) at the second read; ON Owens settled 197 s (maxZ 16) — draws **259** / tris 323,170; **(18) FAIL — "OWENS BIT-FOR-BIT THE SAME SCENE"**, ON 259 / 323,170 against OFF 275 / 329,348 — **ATTRIBUTED (to D for the F6 reading): this tree is PRE-`parkOffscreen`, and on it the drawn set GROWS with sweep length** (terra-live 185 → 279; here OFF swept 424 frames and ON 311), **so the gap is residency charging draw calls for the longer sweep, not the crossfade adding or removing anything — on A's parked tree both arms should read EQUAL**; **(19)** no page errors on the ON leg. **E's two comments**: `refine 73` from A's counters against **72** from E's frame-diff census is **one apart because two instruments sample at different points, the identity exact — not a defect**; and the OFF leg's Owens **275 reproduces `terra-live`'s 279 shape at a SECOND pose** after a full-arc sweep on the pre-fix tree. **THE SHAPE OF THE VERDICT** (D states it formally): **the substance is strongly positive — 61 of 62 refines faded against 72 of 72 hard, no leak, bounded concurrency, a 31-frame blend window — but two of D's six preconditions FAIL on the ON arm** (arc < 360°, frame ratio at the edge) **and one fade was denied for `noParentMap`, a defect-shaped reason the template requires at 0**; under the template as written that is **NO FLIP this round** unless a re-run on A's parked tree with a longer ON sweep (~1,500 s) passes it — **so `LOD_CROSSFADE` ships OFF until then.** **D'S RULING: NO-GO — three of six preconditions fail, so the run does not decide the flip, and `LOD_CROSSFADE.enabled` stays false.** §4.10b applied verbatim. **PRECONDITIONS**: **P1** no pace pin on either page **PASS** (OFF null · ON null); **P2** ON `skip.disabled` === 0 **PASS**; **P3** shape = noParentMap = unpatched = 0 **FAIL** (0 · 1 · 0); **P4** both arms offered swaps **PASS** (OFF 72, ON 62); **P5** arc ≥ 360° on both arms AND ratio ∈ [0.75, 1.25] **FAIL on both halves** (ON arc 264°, ratio **0.74537**); **P6** both arms settled at Owens **FAIL** — both SETTLED, but **maxZ 17 vs 16**. **FLIP CONDITIONS**: **F1** ladder identity both arms **HOLDS** (72 + 0 = 72 + 0; 62 + 0 = 1 + 61); **F2** refines + merges equal **NOT EVALUABLE** (P5; 72 → 62); **F3** faded > 0 and hardSwaps drops **HOLDS** (0 → 61; 72 → 1); **F4** `maxBlendRun` ≥ 2 read against 5 **HOLDS** (31; blend frames 184 of 322); **F5** drain at active 0, no leak on both reads, arrivals attributed, the invariant **HOLDS** (held after 2 frames, 0/0 and 0/0); **F6** Owens draws AND tris equal with 0 page errors **NOT EVALUABLE** (259 / 323,170 vs 275 / 329,348). **D's sentence**: *"Four flip conditions hold on their own evidence. Two cannot be read. The preconditions are what block the call — which is the template working, not failing."* **(a) The `noParentMap` 1 is ATTRIBUTED**: it **IS** the single hardSwap (62 refines = 61 faded + 1 hard, and it is the only non-zero denial), and it is **not a boot artefact** — a sweep-window delta with both counters taken after the settle, so `skipBootMs` at its default would not have moved it and **P3 should not be re-read at the default**. From source: `tileMap = tile?.model?.material?.[0]` then `pm?.map`, and the vendored `index.js:1236` catches a failed imagery load with `this._errorMaterial.clone()` — `_errorMaterial` (`:1142`) being `MeshBasicMaterial({ color: 0, transparent, opacity: 0.2 })` **with NO map** — so **one failed imagery fetch on a parent produces exactly this, once, benignly** (the fixture served 614 fetches with 14 refetched, so a transient miss is consistent). The other reachable causes (a source not covering the tile; a parent unloaded during the await) **are not distinguishable from the log** *"because my counter records no context — a gap in my instrument, not E's"*. **The behaviour is correct either way**: a parent with no map has no texture to blend from, and the ladder falls through to the **verbatim upstream swap** rather than blending from nothing — *"so P3 asserts a property of the WORLD, not of D's code, the same error §4.11 names"*. **P3 revised**: `shape` and `unpatched` stay hard 0 (both mean the ladder was reached wrongly), while `noParentMap` is **reported always** and FAILs only **above ~5 % of window refines** or when attribution shows the parent DID have a map; the counter will record the first few as `{z, x, y, hasModel, matCount, matName}`. **(b) TWO FINDINGS THE NUMBERS GAVE UP.** The ON arm is **structurally slower, and it is the HARNESS not the tree**: `ctx2` is created **while the OFF page is still open**, so the ON sweep renders with **two live SwiftShader contexts** where the OFF sweep had one — everything the OFF arm contributes is captured before `ctx2` exists (only gate (9)'s OFF pace read comes later) — *"a far better explanation of ratio 0.745 than load noise, and raising the cap alone would not fix it"*. And **(18) compared two different SCENES**: both arms reported SETTLED but at **maxZ 17 vs 16**, one resolved a whole level deeper, which moves draws and triangles on its own, **independently of the pre-`parkOffscreen` residency growth** — which D accepts and which points the same way (OFF swept 424 frames, ON 311) — *"'Settled' is not sufficient for an equality assertion"*. On the re-run **F6 reads ON draws === OFF draws && ON tris === OFF tris PRECONDITIONED on equal maxZ** (and resident tile count if cheap), else **NOT CALIBRATED, never FAIL**. **One open item D will not dress up**: per unit arc the ON arm refined MORE (**0.235/° vs 0.200/°**) — consistent with a shorter, differently-descended window, **not evidence of a defect and not evidence of flatness**; F2 stays unread until the arcs match. **(c) THE ONE RE-RUN**, on A's fixed tree (post `dead5e5`), one invocation, four changes: **1.** `await page.close()` before creating `ctx2` (capturing (9)'s OFF pace value first) — **the single highest-value change, removing the systematic 27 % frame deficit**; **2.** `FLY_LOD_SWEEP_MS=1500000` (311 frames in 900 s ⇒ ~2.9 s/frame ⇒ 424 frames needs ~1,230 s, so 1,500 s is margin, and with (1) the ON arm should need less); **3.** keep `skipBootMs: 0` — the venue needs it and the `noParentMap` event was in-window; **4.** F6 gated on equal maxZ, P3 as revised. **Ship state stays OFF and the record says exactly that**: *"the refine path blends — F3, F4 and F5 are strong and independent of the failures — but the run that would license the flip has not happened yet."* **ROUTED**: E takes the four re-run changes as one scripts-only sha and the re-run at the tail of the post-batch list; D writes §4.10c, the counter context and a node gate asserting its shape. **A'S RULING ON (6): the 14 "refetched" DEM URLs are NOT REFETCHES — they are UPSTREAM SOURCE-LEVEL CLAMPING** (`c7203b1`, merge 27 `b91899a`). **The asymmetry was the answer**: imagery's ceiling is `satMaxZoomFor(tier)` = **17**, the DEM's is `TILES.demMaxZoom` = **15**, and past a source's `maxLevel` the vendored `index.js` `de()` requests **the ANCESTOR's URL with clipBounds** — `if (r <= i.maxLevel) return { url: i.getUrl(e, t, r), clipBounds: [0,0,1,1] }; const n = He(e, t, r, i.maxLevel) …` — where `He(x, y, 16, 15)` has `s = 2`, so **all four z16 children of z15 8822/12386 map to ONE URL: four distinct tiles, one URL, four requests — the "worst 4×" exactly** (a z17 descendant makes it up to 16). **Imagery never exceeds its own ceiling, which is precisely why no imagery URL duplicated.** All three candidates fall: **not** the R21 TTL/backoff on a 200-empty-body (no empty body, not this code path); **not** skirt rebuild / `walkWhileSaturated` (neither issues source URLs, and both would show in imagery); **not** a residency gap for DEM (`refetchParent` 0, merges 0, **0 re-appearances on the same run**, and the byte trigger never fired at 113.7 MB under 140). **Why it was invisible on A's own harness is the useful part**: A's request counter is keyed **PER TILE**, so ancestor sharing cannot appear in it — *"it read a truthful 0 refetches for a question it was not asking"* — and with a **per-DEM-URL** counter the same run reads **224 distinct DEM URLs, 4 requested more than once (worst 9×), tile-level refetches 0**: *"two counters, two questions, both right; the same family as pass-1 gate 6 — an instrument can report a real number for a question nobody asked."* **Gates 29–31 make sharing and refetch distinguishable BY NAME**: (29) the DEM ceiling is below the imagery ceiling, read from `TILES.demMaxZoom` **so raising it re-derives the prediction instead of invalidating the row**; (30) residency holds at the TILE level; (31) **every duplicated DEM URL is a ceiling-clamped ancestor at exactly z = `demMaxZoom`, never a re-download** — a real DEM refetch would duplicate a URL whose z is NOT the ceiling and **would be named rather than excused** — with the prediction coming from the tile census and the observation from the request log **so they can disagree**. The same 14 recur on the parked tree, reasoned from code (`parkOffscreen` sets `model.visible`; the clamp fires in `de()` at LOAD time, before anything is visible; the cap does not fire either). **What A could not give**: the four timestamps — `/__stats byUrl` is a count map with no timeline, **so they do not exist in the artifact**, stated rather than reconstructed. A **offered** a shared-DEM request coalescer (one in-flight fetch per ancestor URL, four consumers, a real ~4× cut in DEM traffic past z15) as new work needing a measured decision, and **the orchestrator DECLINED it for this round on A's own grounds** (critical path; it changes request timing) — §5b. **E's (6) adopts the same distinction for the re-run.** **AND D LANDED THE RECORDER** (`5f9be56`, merge 28 `8662015`, `verify-lod-fade` **55 → 64**): §4.10c carries the NO-GO verdict as delivered, and §4.10d adds the first four `noParentMap` denials as `{ z, x, y, hasModel, matCount, matName }` on **`noParentMapFirst`, a SIBLING of the skip census rather than a member**, because E's leg diffs skip key by key and a non-numeric member would be a trap (D flagged this as its one departure from the instruction's wording); **bounded to four, empty at rest, cleared with the counters — *"a diagnosis, not a log"*** — and **unreachable with the flag off**, because `eligible()` refuses the swap before `onRefine` ever reads the parent's map, so flag-off identity is untouched by construction **and the gate asserts that ordering**. **`matName` is the whole point**: three-tile names its failed-imagery fallback **`"error-material"`**, so one string answers in a single run what pass 2b cost a three-way source inference to leave open; RED-calibrated by deleting `matName` (62/2, naming both the missing field AND the lost discriminator), restored 64/64, eight new rows. **D's note for the re-run brief**: **closing the OFF page before `ctx2` is THE fix for P5, not the sweep cap** — the cap was sized against a frame rate the second live context caused — *"if only one change survives triage, that is the one, and if it lands the cap may not need raising at all."* Marker stands <!-- CERT:verify-lod-fade PASS2 PENDING --> | PENDING — whether swaps are still visible at real frame rate | the fade's real DURATION (a 250 ms blend completes inside one SwiftShader frame) |
| `verify-step-clean.js` | **rc=1, 229 s, 4/4 — RED calibrated**, viewport DPR 1.5, governor pin RELEASED (the fleet's `'hold'` was written and the accessor swallowed it). (0) pin released; (1) **the released term is reachable** — 6/6 forced steps ACCEPTED, 6 DPR applications, DPRs seen `[1.25, 1.5]`; (2) **18 of 18 `canvas.width/height` writes OUTSIDE a rAF** (width 1600 at t=171932, `inRaf:false`); (3) `setPixelRatio` 6/6 and `setSize` 12/12 outside; (3b) `composer.setSize` **6/6 outside** — the passive-effect lag; (4) `bufferMatchesDrawing` **false on 22 of 46 frames** (composer 1920×1080 vs drawing buffer 1600×900 at frame 7); (5) the composer is **RESIZED, not rebuilt** — rebuilds 1 → 1, resizes 6, R21's `FX_STABILITY` holding; (6) clean. GREEN for (2)/(3)/(3b)/(4) is expected in pass 2 with `STEP_SAFE` on. **The gate states in its own output that the tear LINE is not measurable here** | **pass 2b: HALF GREEN.** The composer lag CLOSED (`composer.setSize` outside a rAF 6/6 → 0/6, A's `registerComposer`) and the buffer mismatch CLOSED (22 of 46 → 0 of 43), while the DPR double-apply stayed OPEN — **attributed and fixed in A's `a0c1484`**: the second writer is r3f's own zustand subscriber re-applying `setPixelRatio` + `setSize` outside any frame after an awaited `root.configure`, triggered by the rig's own `setDpr` and therefore within the flag's reach; `installResizeGuard` drops a resize into the state the renderer already holds while keeping `setViewport`, with `verify-step-guard.mjs` 13/13 behind it. Per-leg detail: `scripts/r24-close-sweep.md` §5.5. **RE-TAKE: rc=0, 260 s, 9 passed / 0 failed — `STEP_SAFE` CERTIFIED ON THE VENUE.** On `9bcaace`, started 00:09:05, no K, load 4.64 / 4.23 / 3.95. **(0) the pin is released** — the fleet wrote `'hold'`, the accessor swallowed it, live pin null, `__flyGov` an object, `devicePixelRatio` 1.5; **(7) ONE APPLICATION PER STEP, INSIDE THE FRAME** — 6 accepted steps, `step.n` +1 each, **zero writes outside a rAF**, and `stepGuard` strictly increased at every step (**{setPixelRatio: 1, setSize: 2} per step — that is r3f's re-apply being SUPPRESSED, A's second writer, counted rather than argued**); **(1)** the released term is reachable — **6/6 forced steps accepted**, 6 DPR applications, DPRs seen [1.25, 1.5]; **(2)** every `canvas.width/height` write inside a rAF — **0 of 12 outside**, where **pass 1 read 18 of 18 outside and pass 2b 12 of 30**, **and the TOTAL itself fell 30 → 12 as the redundant r3f calls stopped — A's prediction, measured** (the 22-of-46 and 0-of-43 pair belongs to gate **(4)**, `bufferMatchesDrawing`, not to this one); **(3)** every `gl.setPixelRatio` / `gl.setSize` inside a rAF — **0/6 and 0/6 outside**; **(3b)** every `composer.setSize` inside a rAF — **0/6 outside**, where the passive-effect lag read **6/6** before A's `registerComposer`; **INFO (4)** `bufferMatchesDrawing` frames 65, mismatches 0; **(4)** never goes false — **0 mismatched of 65**; **(5)** the composer is **RESIZED, not rebuilt**, across a step — rebuilds 1 → 1; **(6)** no page errors | PENDING — and the ladder the user's real DPR has | the tear LINE |
| `verify-ladder-fix.js` | **rc=0, 90 s, 13/0 — GREEN, and a measured ON leg**: the gate boots TOY and arms `LADDER_FIX` + `STEP_SAFE` through their runtime pins. (1) **two sub-native rungs on a DPR-1 display**, 0.875/high and 0.75/high; (2) both BEFORE the first tier rung (last sub-native index 2, first tier rung 3); (3) boot rung still index 0 at native DPR and boot tier; (4) tier rungs unchanged in order and count; (5) refresh estimated from the frame cadence = **144 Hz**; (6) `nativeRefresh` target **144** vs refresh 144; (7) **a stuttering session steps DOWN on a healthy mean** — rung 3 at `emaFps` **53.4** (at/above the 51 fps down bound), `longFrac` 0.1, the pattern the EMA cannot see; (8) CONTROL: a clean 60 fps session never steps (rung 0, dprSteps 0, tierSteps 0); (9) dpr steps [0.875, 0.75, 1] then tiers ["medium"]; (10) a forced step moved the ladder 0 → 1; (11) **`STEP_SAFE` applied it INSIDE a frame, not via the valve** (n=1, `applyMs` 466.8 — a SwiftShader number, `composer=true`); (12) composer buffers ARE the drawing buffer ([560, 315] both); (13) clean. **The R20 flap condition `[1/high, 1/medium, 1/low]` is now the five-rung ladder, measured**  | **12/13 — every ladder gate GREEN on the flipped tree.** `rc=1, 82 s` (22:01): two sub-native render-scale rungs (0.875 / 0.75, tier high) BEFORE the first tier rung; boot rung index 0 at native DPR; tier rungs unchanged (medium, low); refresh estimated **144 Hz and the target FOLLOWS it** (144 vs 144, `nativeRefresh`); a stuttering session steps DOWN at `emaFps` **53.4** with `longFrac` 0.1; the clean-60 control takes **0 steps**; rungs are spent before any tier step ([0.875, 0.75, 1] then ["medium"]); a forced step 0 → 1 is applied by `STEP_SAFE` **INSIDE a frame** (n=1, `applyMs` **2.5** — a real number now, not the 466.8 of the SwiftShader-contended pass-1 run — `composer=true`); composer buffers == drawing buffer [560, 315]. **Gate 13 FAILS**: the TOY boot throws an uncaught `Cannot read properties of undefined (reading 'byteLength')` **31 times** — **ATTRIBUTED (below) to `FINALIZE_PACE`'s toy index container, not to the ladder flags, and FIXED in A's `e7325cd`**; the ladder-fix re-take is the census leg **RE-TAKE: rc=0, 86 s, 13 passed / 0 failed — `LADDER_FIX` CERTIFIED ON THE VENUE.** On `9bcaace`, started 00:42:01, no K, load 5.04 / 4.76 / 4.70. Every ladder gate as in pass 2b: **(1)** two sub-native render-scale rungs on a DPR-1 display (0.875/high, 0.75/high); **(2)** every one of them BEFORE the first tier rung (last sub-native at 2, first tier rung at 3); **(3)** boot rung index 0 at native DPR and the boot tier (1/high); **(4)** tier rungs unchanged in order and count (1/medium, 1/low); **(5)** the governor estimates the display refresh from the frame cadence — **144 Hz**; **(6) `nativeRefresh` — the target FOLLOWS the display rather than capping at 60 (target 144 vs refresh 144)**; **(7)** a stuttering session steps DOWN though its mean fps is healthy (rung 3 at `emaFps` 53.4 ≥ the 51 fps bound, `longFrac` 0.1); **(8) CONTROL** — a clean 60 fps session never steps (rung 0, dprSteps 0, tierSteps 0); **(9)** the render-scale rungs are spent BEFORE any tier step ([0.875, 0.75, 1] then ["medium"]); **(10)** a forced governor step moved the ladder 0 → 1; **(11)** `STEP_SAFE` applied it INSIDE a frame, not through the safety valve (n=1, `applyMs` 12.2, `composer=true` — pass 2b read 2.5 ms and pass 1 466.8 ms; **all three are SwiftShader contention, not a trend**); **(12)** the composer buffers ARE the drawing buffer after the step ([560, 315] both); and **(13) NO PAGE ERRORS — on the TOY boot that threw `byteLength` 31 times on the pre-fix tree**. **That last gate is the BROWSER confirmation of A's index-container fix (`e7325cd`), on top of node gate 17's `BROKEN=0`: the toy land chunks now upload.** · per-leg detail: `scripts/r24-close-sweep.md` §5.6 | PENDING — governor behaviour in real time, on the user's real DPR and refresh | the tear LINE; every fps/ms number |
| `verify-ladder-fix.js` + `FLY_LADDER_RED=1` (the control arm) | **rc=1, 94 s, 7 passed / 6 failed — EXACTLY the expected RED, i.e. the control arm is a control.** (1) **0** sub-native rungs; (2) last sub-native **−1**, first tier rung **1**; (6) target **60** vs refresh 144 — the 60 Hz cap; (7) rung 0 at `emaFps` 53.4 with `longFrac` **0**, no stutter step-down; (9) dpr steps **[]** then tiers **[]**; (11) `STEP_SAFE` "no record"; controls (3)(4)(5)(8)(10)(12)(13) pass with buffers [640, 360] matching. **A's hardening of the omitted-pin trap, holding on the flag-off tree** (lesson 26) — and E confirms at the close that **`ec53fd3` contains A's FORCING version**, so pass 2b's 7/6 was measured by a RED arm that pins both features off rather than merely omitting the pin: **that calibration is real** | **pass 2b: the RED calibration HOLDS on the flipped tree** — `rc=1, 86 s`, gates 1, 2, 6, 7, 9 and 11 failing exactly as the arm requires with the ladder flags pinned off. **And gate 13 threw the same `byteLength` error ×3, which was the row's most useful output**: it exonerated `LADDER_FIX` and `STEP_SAFE` (though NOT "A" — `FINALIZE_PACE` stayed ON in it) and started the attribution that B's 2×2 and bisect finished — `FINALIZE_PACE` ON → 80 broken toy LAND meshes, OFF → 0, independent of `FLASH_GUARD`; root cause `toy-world-engine.js:972` handing `setIndex` a raw `Uint32Array`, which three wraps only when `Array.isArray` is true, so `WebGLAttributes` throws on `array.byteLength` at first upload. **FIXED in A's `e7325cd`** — the index wrapped and its width mirrored from three's own `arrayNeedsUint32` bound (65535, not 65536), *"because a bound is not a maximum"* — with `verify-finalize-pace` 17 → 21 → 22 and B's census `BROKEN=0`. Per-leg detail and the full bisect: `scripts/r24-close-sweep.md` §5.6, and §5.1's toy leg. **RE-TAKE: rc=1, 92 s, 7 passed / 6 failed — the RED calibration holds EXACTLY, on the FIXED tree.** On `9bcaace`, started 00:43:27, load 7.10 / 5.50 / 4.97. With the flags pinned off: **(1)** 0 rungs below native; **(2)** last sub-native −1 / first tier rung 1; **(6)** target **60** against a refresh of **144**; **(7)** rung 0 at `emaFps` 53.4 with `longFrac` **0**; **(9)** dpr steps [] then tiers []; **(11)** `STEP_SAFE` *"no record"* — while the controls pass: **(3)** boot rung 1/high, **(4)** tier rungs unchanged, **(5)** 144 Hz estimated, **(8)** the clean session never steps, **(10)** the forced step 0 → 1, **(12)** buffers [640, 360] == drawing, and **(13) NO PAGE ERRORS on the toy boot**, where pass 2b's RED arm threw `byteLength` ×3. **Together with `ladder-fix`'s 13/13 this is a GREEN whose RED was RE-ESTABLISHED ON THE FIXED TREE** — the shape the round spent the day insisting on. **CERT DONE 00:44:59**, *"stopping the dev server process group I started (PGID 26915)"*, *"port :3100 released"* — **the second consecutive run with no surviving `next-server`** | PENDING — the same control on a real display | — |
| `verify-one-sun.js` | **rc=1, 251 s, 20/7 — RED calibrated.** Both pins released (`__flySunOverride` null → null, `__flySatShadowOverride` 0 → 1) and **`live === true` at high AND medium**, so the released term is proven reachable before anything is asserted. Azimuth key === hill, **Δ 0.00e+0°** at every tier and time. **Key ELEVATION stuck near 45° — 39.552° high/noon, 45.291° high/dusk, 45.142° elsewhere — against a true solar 55 / 2 / −14, at high AND medium**: recon L3, measured in the shipped app. **Medium azimuth spread 0.0000°** is the RED itself. Gate (5) — "water reads the same directional, Δ undefined°" — **PASSED on an absent reading**, i.e. vacuous; E is fixing it. No page errors | **pass 2b: rc=1, 263 s, 14 passed / 7 failed / 6 NOT CALIBRATED — VOID BY INSTRUMENT.** Both gates wrote `{ elDeg }` to `__flySunOverride`, **which the app consumes as a TIMESTAMP in milliseconds** (`FlyScene.jsx:939`, `:1155`), and nothing reads `__r24Sun`, **so the flipped app kept its wall clock** — the monotonic azimuth drift across a commanded 55° → 2° → −14° is the tell. What stood: `live = true` at both tiers and azimuth **key === hill at Δ 0.00e+0°**. Per-leg detail: `scripts/r24-close-sweep.md` §5.7. **RE-TAKE: rc=1, 260 s, 12 passed / 4 failed / 6 NOT CALIBRATED — the identity clauses are CERTIFIED where the sun actually landed, and all four reds are the INSTRUMENT's.** On `9bcaace`, started 00:13:25, no K, load 5.26 / 4.64 / 4.19. **THE FEATURE**: **(5)** water reads the same directional as the key, **Δ 0.000000°** at both tiers at night; **(5b)** the water light **IS** the key light **by SOURCE**, `waterSource "key-light"` — *"an angle of 0 between two independent lights would be a coincidence that holds until someone moves one of them"*; **(3)** hill elevation = the clamp floor **8.594° exactly**, both tiers; **(0a)/(0b)** the key light is live; **(0c) high/night and medium/night commanded −14°, app reports −13.996°** via `t=2026-07-01T02:31:33Z` — **the first time this round the app's sun was where a gate put it**; **(0)** both pins released (sun null → null, satShadow 0 → 1); **(7)** no page errors. **THE FOUR REDS, attributed from the log and `FlyScene.jsx`, none of them `ONE_SUN`'s**: **(a)** (0c) high/noon and high/dusk NOT CALIBRATED — the app reports elDeg **−4.539** against a commanded 55° / 2°, **and −4.5° is the WALL CLOCK at boot** (00:15 UTC, 7 Sept, Powell); medium/noon and medium/dusk report **−13.996, the PREVIOUS leg's value, stuck** — so the app picks the override up on a **recompute cadence** (`FlyScene.jsx:1155`) the legs do not wait for, and **the night legs passed because the cadence happened to fire first**. E's 0.5° precondition caught it honestly, which is exactly what it was added for; the fix is a leg that **WAITS for `elDeg` to land** (poll to within 0.5°, timeout = the cadence plus margin, NOTCAL otherwise). **(b)** (6)'s medium-tier RED reads a **0.0000° azimuth spread** — *the consequence of the stuck sun on that tier, not a measurement* — and (6) now gates on (0c) passing on at least two legs. **(c)** (8) *"the world scene declares exactly one `<directionalLight>`"* counts **2** in `FlyScene.jsx`: the declaration at **:2412** and **the COMMENT at :2295** that names the tag while explaining the identity — **R20 §7's "a grep gate reads comments too", the trap C's own reader census skips and E's new source gate did not**; C's one-light claim stands and (8) reads **1** once comment lines are excluded. **(d)** (2) KEY ELEVATION at night on both tiers — key **34.377°** against an expected 8.594° (high, casting) / −14° (medium): **with `moonK` = 1 the key follows the MOON** (`moonDirFromSun`, `FlyScene.jsx:2193`, the same `_moonKeyDir` the key is set from), and the gate's own SKIP on (1) says **clause (4) governs** — but (4) is NOT CALIBRATED because *"the instrument does not publish `moonExpected`"* **and (2) asserted the sun anyway**. C is publishing `moonK` and the moon key direction (`moonKeyAzDeg` / `moonKeyElDeg`) on `stats.sun` beside `casting`, and (2)/(4) under `moonK` = 1 will assert the key against **that published direction**, NOTCAL until it exists. **The 34.377° is therefore the FIRST MEASURED READING of C's moonlit night key on the venue, not a defect.** **ROUTED**: E takes the four instrument items as one batch (one-sun re-runs after lod-fade, with terra-live); C publishes `moonK` + the moon key direction and the flag-off shape gate. **AND C RULED (d) A DEFECT, against C's own W2 text** (`446545b`, merge 20 `93f1dce`): R21 flag-off already put key and hill on the SAME vector at night, so the 137° split is 100 % `ONE_SUN`'s — the key moved to the moon in C's M2 and **the ground was left behind**. The hill now follows the moon through ONE `moonBlendK(elDeg)` called by both the per-frame key branch and the 60 s hillshade cadence, and **the contract changes with it: at `moonK` = 1 the hill elevation is `moonElRad` 34.377°, not the clamp floor — so this row's (3) PASS was on the PRE-FIX tree** (§3 C). C also publishes `moonKeyAzDeg` / `moonKeyElDeg` in the GATE's convention, null while `moonK` is 0. **E has folded that contract into the gate** (`0f6560b`, merge 22): (3) asserts the solar clamp only where `moonK` is 0 and SKIPs below the blend with the reason, a new **(3m)** requires hill ≡ key within 0.5° in both azimuth and elevation under moonlight — **the invariant that would have caught the defect** — and (2)/(4) read C's published moon key, honouring the nulls as NOT CALIBRATED rather than failing against the sun. **Why this row's (3) PASS is not preserved, recorded so nobody later reads the change as a re-baseline**: on the pre-fix tree *"(3) HILL ELEVATION === clamp"* **passed at 8.594° on the exact frame that contained the 137° defect**, because it asserted the hill against the SUN and the hill was still dutifully on the sun — **the passing number WAS the symptom**. **POST-BATCH: rc=1, 398 s, 38 passed / 4 failed / 0 NOT CALIBRATED — `ONE_SUN` CERTIFIED ON THE VENUE, and the four fails are one tolerance.** On `14c1220`, started 01:36:15, load 4.36 / 4.29 / 4.12. **THE SUN LANDED ON EVERY LEG**: (0c) high/noon **54.998°** (`t=2026-07-01T15:06:44Z`), high/dusk **2.002°**, high/night **−14.001°**, and the same three on medium — **E's `warpEpoch` re-issue works, and the series is pass 2b 0 of 6 → re-take 2 of 6 → 6 of 6.** **THE FEATURE**: **(0)** both pins released; **(0a)/(0b)** the key light live on every leg; **(2) KEY ELEVATION === TRUE** — 54.998° vs 55.000° at noon (casting true on high, false on medium), **8.594° at high/dusk** (floored at `minElRad` while casting) against **2.002° at medium/dusk** (not casting, so unfloored); **(3) HILL ELEVATION === CLAMP** — **51.566°** at noon (the clamp CEILING) and **8.594°** at dusk (the graze floor), both tiers; **(5) WATER READS THE SAME DIRECTIONAL AS KEY — Δ 0.000000° on every leg**; **(5b)** key-light by source; **(2)/(4) AT FULL MOON THE KEY IS THE PUBLISHED MOON KEY** — key az 45.188° / el 34.377° against moon key az 45.188° / el 34.377°, **Δaz 0.0000, Δel 0.0000**, both tiers; **(3m) UNDER MOONLIGHT THE HILL FOLLOWS THE KEY** — same numbers, **Δaz 0.0000, Δel 0.0000, both tiers: C's hill-follows-moon fix CONFIRMED on the venue and the re-take's 137.04° is GONE**; **(6) THE MEDIUM-TIER RED — the key MOVES when the sun moves**, azimuth spread **153.30°** across the three elevations on medium where C measured 0 on the flag-off tree; **(7)** no page errors; **(8)** the world scene declares **exactly ONE** `<directionalLight>` — 1 JSX declaration with comments stripped. **THE FOUR FAILS ARE ONE THING**: **(1)** azimuth key === hill *"to 1e-6°"* — **Δ 4.76e-6° at noon on both tiers, 4.60e-5° at medium/dusk**; **(1b)** key === dome to 1e-6° — **Δ 4.60e-5° at high/dusk** (medium/dusk 0.00e+0; the noon (1b) legs SKIP because the dome lobe envelope is 0). **First ruled a TOLERANCE question** — 4.6e-5° is 8e-7 rad, float32 precision through sin/cos/atan2, and the defect the clause exists to catch was 137° — **and then CLOSED FROM SOURCE, which reverses that ruling** (C `7fa86cb`, merge 31 `a7a8739`, `verify-c-flagoff` 49 → 50). **The residual was NEITHER candidate: it is `toFixed(6)` in C's own instrument, the stats publish.** The arithmetic: a unit-vector component rounded to 1e-6 moves the azimuth derived from it by up to **5e-7·√2/cos(el) rad = 4.05e-5°/cos(el)** — 4.05e-5 at the horizon, **4.91e-5 at the moon's 34.377°**, 7.06e-5 at 55° — **and every failing number sits inside that bound**. Evaluating the app's own two expressions in float64 and quantising them the way the instrument does: noon (key 55.000 / hill 51.566) \|Δaz\| **float64 0.00e+0**, at `toFixed(6)` 2.45e-5, at `toFixed(9)` 3.31e-8; dusk (2.000 / 8.594) 0.00e+0 / 2.60e-5 / 2.41e-8; night (−14.000 / 8.594) 0.00e+0 / 2.42e-5 / 4.88e-9 — ***"the app's key and hill azimuths are BIT-IDENTICAL as doubles at every leg; the gate was differencing its own rounding."*** **And float32 is nowhere on the read path**: `Object3D.position` is a `Vector3` of plain JS numbers, `getHillshade().dir` is the JS-side uniform VALUE object rather than a GPU read-back, and the key is recovered as position − target and normalised in float64 — the GPU copy is float32 **and nothing reads it back, so a uniform round trip never happens.** **One computation or two? TWO, and correctly so**: two DIFFERENT directions by contract, `basis(az, el)` evaluated once per consumer **from the SAME az double** (`runtime.sun.az` is copied, not recomputed) at deliberately different elevations — the key at the true elevation, floored only while casting, and the hill at the clamped one. **The charter's "one sun" is about the direction SOURCE, and there is exactly one** — one az, one sinEl, one `moonBlendK` — **the bit-identical azimuths being precisely the evidence; nothing to fold.** **C DECLINED the tolerance**: *"a 1e-3° bound would have written my instrument's rounding into the contract permanently."* Nine decimals puts the artifact at ~3e-8°, **three orders INSIDE the 1e-6° clause, so the clause can be asserted for what it says**: key / hill / dome / water and the two moon angles move 6 (and 4) → **9**, while degree scalars keep four **because they are read rather than differenced**; dev-only, on the existing 60-frame cadence, no cost; (2)/(4)'s Δ may now print ~1e-8 rather than exactly 0 — **the same agreement reported honestly**; **new gate 50 locks every published direction vector at nine decimals**, RED-calibrated by putting hill back to six, with one line in the `ONE_SUN` header recording the bound. **The dusk sign is confirmed EXPECTED**: medium/dusk with `casting=false` gives key el 2.002°, the TRUE elevation, since `SAT_SHADOWS.minElRad` floors it only while the shadow camera casts (clause 2's own contract), against hill el 8.594° = `HILLSHADE.minElRad`, the graze floor `computeSun` clamps into — and `moonK` is 0 there because `fadeStartDeg` is 0, so a positive elevation cannot arm the blend: **the clamp contract reading correctly, not a sign error**. **RULING REVERSED: E restores (1)/(1b) to 1e-6°** — merge 30's 1e-3° is superseded, and **E had written into that gate that a tolerance is right only if the disagreement is REPRESENTATION; it was not, and the note did its job** — **and the TAIL RE-RUN CLOSED IT: rc=0, 419 s, `42 passed, 0 failed`, 0 NOT CALIBRATED, at the RESTORED 1e-6° bound** — on `3231f7d` (the `CERT_PROOF_ONLY` server), started 03:02:36, load 4.82 / 4.54 / 4.54, log `scripts/r24-out/tail/one-sun.log`. **(1) key === hill**: Δ **2.41e-8°** high/noon, **0.00e+0** high/dusk, **2.60e-9** medium/noon, **1.35e-8** medium/dusk; **(1b) key === dome**: **1.35e-8** high/dusk, **0.00e+0** medium/dusk — **three orders inside the clause, exactly as C's nine-decimal publish predicted**; the sun landed on **6 of 6** legs (54.998 / 2.002 / −14.001, both tiers); **(3m) hill ≡ key under moonlight, Δaz 0.0000 / Δel 0.0000 on both tiers**; **(2)/(4) key = the published moon key, Δ 0.0000**; **(6)** the medium-tier spread **153.2958°**; **(8)** exactly one `<directionalLight>` with comments and strings stripped. **`ONE_SUN` is CERTIFIED, and the round's four micro-degree residuals are gone at the strict bound.** | PENDING — the LOOK (checkpoint 5) | — |
| `verify-linear-haze.js` | **VOID — reader outside rAF; re-run pass 2.** rc=1, 240 s, 4 passed / 2 failed, and not one of the six means anything: both poses read **terrain L 0.0 / sky L 0.0**, an all-zero luma profile and "horizon row 6 of 540, step 0.0", because the seam reader ran from `page.evaluate` **outside any animation frame** against a `preserveDrawingBuffer:false` context, so `readPixels` returned a CLEARED default framebuffer. (1a)/(1b) failed honestly ("no horizon in the frame"); (2a), (2b) and (3) then PASSED — "RIM SEAM ≤ 12/255 Δ 0.0" and "seam independent of time of day, spread 0.0" — **on black against black**. E's rewrite samples at the start of the NEXT animation frame on the renderer's own context (the pale detector's idiom, which is why the census rows worked) and makes (2)/(3) print **NOT CALIBRATED** whenever (1) fails. `verify-depth-roundtrip` has no `readPixels` path and is not the same shape | **pass 2b: VOID AS POSED — there is no seam in this frame because there is no MELT in this frame.** The repaired rAF reader DID work (a horizon found at row 227, noon Δ 50.9, night Δ 50.8), but `bootFly` pins `__flyAerialOverride = 0` so `aerialGate` multiplies to 0 and all three atmosphere channels take their identity path; **≤ 12/255 is unreachable at that pose even released** (`maxMix` 0.55 leaves 0.45 × 51 ≈ 23 before a 1200 m falloff meets a 4200 m eye), and the bound's provenance was wrong — C's node oracle predicts 0.000 for the DECODE ROUND TRIP, never a 0 seam. Per-leg detail: `scripts/r24-close-sweep.md` §5.8. **RE-TAKE: rc=1, 512 s, 2 passed / 0 failed / 8 NOT CALIBRATED — the sun override never landed on ANY leg, so NOTHING about `LINEAR_HAZE` was measured.** On `9bcaace`, started 00:17:45, no K, load 4.77 / 5.01 / 4.59. **(0)** OFF arm, noon and night: commanded 55° / −14°, **the app reports elDeg 21.6767 on both** (Δ 33.3° / 35.7°); **(0)** ON arm: **20.8412 on both** (Δ 34.2° / 34.8°); **(3)** on both arms — *"the seam does not depend on the time of day"* — NOTCAL, one of the two poses producing no reading; **(5a)** the A/B at noon and **(5b)** at night — NOTCAL, an arm produced no reading; **(4)** no page errors on either arm **PASS**. **This is the SAME recompute-cadence gap the one-sun row exposed, and the precondition refused every leg correctly instead of comparing a seam under the wrong sun** — so the flag's state does NOT move in either direction: **decode round-trip proven by the node oracle; the SEAM UNMEASURED (instrument); the A/B re-run pending.** **The open question is ANSWERED** (E): `verify-linear-haze.js:43` poses at **Owens Valley (36.6, −118.1, 4200 m), not Powell**, and computed with the app's own `computeSun` at that latitude the REAL sun was **21.796° at 00:20 UTC and 21.003° at 00:24** — the row read 21.677 (OFF) → 20.841 (ON), so **both arms sat on the real sun at their own latitude and the 0.8° gap is four minutes of Earth rotation**, the OFF arm having sampled minutes before the ON arm. **That is a live wall clock, which confirms "never applied" rather than "applied wrongly"** — a mis-applied override would give a wrong-but-STATIC value. The polled field is `trueElevationDeg` (`FlyScene.jsx:2189`, published at `:2204`), **unclamped**, which is also why one-sun could read −13.996°. E's line for the record: *"A NOT CALIBRATED row costs a re-run; a green one would have cost the round its finding."* **And `haze-red`'s first arm caught the mechanism DIRECTLY rather than by inference** (RED-A, both arms pinned off): its noon leg read **20.0042** — the Owens wall clock — against a commanded 55°, and its **NIGHT leg read 54.9987 against a commanded −14°**, i.e. **the NOON command landed one leg late**. So the override IS applied, just after the sample; **E's poll-to-landing fix is exactly the remedy**, and the row finished **NOTCAL — rc=1, 501 s, 7 NOT CALIBRATED**, RED-A noon 20.0042 / night 54.9987 and RED-B noon unlanded / night landed, **so no noise floor was established** and it re-runs. **AND THE MECHANISM IS NOW KNOWN FROM SOURCE** (E `ffe0893`, merge 23 `175e33e`): the sky effect applies the override on **`setInterval(apply, SKY.dayCycle.refreshSec * 1000)` — 60 s of WALL CLOCK** — with deps `[mapStyle, warpEpochForSun, runtime, spawn]`, and `verify-frame-pace` had measured **92,897 ms of long tasks inside a 90 s window**, so the main thread is essentially always blocked and a 60 s interval fires **far less often than every 60 s**: *"polling harder was never going to fix that; my first fix would have failed too, slower."* **The fix uses the app's OWN dependency**: `warpEpochForSun` is `useFlyStore(s => s.warpEpoch)` and `warpToGeo` bumps it, so both sun gates now **RE-ISSUE THE SAME POSE immediately after writing the override**, re-running the effect on the spot — **the pose does not change and nothing in the frame moves except the clock the sky reads** — with the poll kept as proof, cap 180 s. **`linear-haze` and `haze-red` join the post-batch re-run behind that fix**, in order: lod-fade standalone → one-sun → linear-haze → haze-red → fade → **depth-rt** → terra-live → **sat-night → dusk → flicker** (C's night ruling moves satellite night ground pixels). **POST-BATCH: rc=1, 574 s, 9 passed / 3 failed / 0 NOT CALIBRATED — THE FIRST RUN WHOSE ARMS SEPARATED.** On `14c1220`, started 01:42:53, load 4.39 / 4.74 / 4.45. **PRECONDITIONS, both arms**: **(0m)** night `moonK` === 1 at a landed −14° sun — **an independent check that the commanded elevation took**, since `moonK` keys on `trueElevationDeg`; **(1a)/(1b)** a horizon was found at all — noon row **227 of 540** (step 62.5 OFF / 55.6 ON), night row **230** (step 39.9) OFF / **233** (step 43.6) ON; `aerialGate` **1 on both legs of both arms**, tier high, with *"aerial pass null"* printed beside it (C is saying which haze channels were live on the frame); **(4)** no page errors on either arm. **THE READINGS** — recorded for the A/B, **not judged against an absolute bound**: OFF arm noon **Δ 59.9**, night **Δ 38.8**; ON arm noon **Δ 53.1** (terrain 214.7 · sky 161.6), night **Δ 41.4** (terrain 38.2 · sky 79.6). **THE A/B**: **(5a) noon — the decode ON reads a SMALLER seam, 59.9 → 53.1, PASS** (−6.8 luma); **(5b) night — the decode ON reads a LARGER seam, 38.8 → 41.4, FAIL** (+2.6 luma), **to be judged against `haze-red`'s noise floor: NOT SEPARATED if the floor is ≥ 2.6, a real night reversal if below**. **(3)** on both arms — *"the seam does not depend on the time of day"* — **FAIL at bound 0.5**, spreads OFF **21.1** (59.9 vs 38.8) and ON **11.7** (53.1 vs 41.4): **halved, not gone** — with the gate's own note that **pass 2b's 0.1 proved nothing because both legs were the same wall-clock frame**, and *"with the sun really moving, this has teeth"*. **THE ORCHESTRATOR'S RULINGS**: (3)'s 0.5 bound asserts the seam's INDEPENDENCE from the time of day — **that is C's M1 tuning equality (haze target ≡ dome horizon colour), refused this round and never claimed of the decode alone** — so **(3) becomes INFORMATIONAL** (both spreads and the ratio printed) and **(5a)/(5b) carry the verdict**: *a FAIL on a bound the owner refused is not a finding*. **C is reading the night reversal from source**, against the orchestrator's hypothesis: **at night the terrain band (38) is DARKER than the sky (80)**, so decoding the sRGB-authored haze/fade targets to linear darkens them further while **the dome's night colour is not on that path** — the decode WIDENS the gap at night and NARROWS it by day, **a decode that is right and a TARGET that is wrong, C's M1 refusal showing its night face** — plus the *"aerial pass null"* question and C's ship-state recommendation (keep ON / ship OFF / ON with the night target adjusted). **The row re-runs at the tail** with (3) informational, and **(5b) waits on `haze-red`'s noise floor**. **C'S RULING, ACCEPTED: KEEP `LINEAR_HAZE` ON** (`0f54071`, ledger only, merge 34 `c0c7cec`) — *"a correctness fix about which colour space a number is in, true independently of the seam, and the venue agrees where it counts: the time-of-day spread HALVED, 21.1 → 11.7."* **THE MECHANISM, with the arithmetic**: `srgbToLinear(c) < c` for every c in (0, 1), so **the decode can only DARKEN the haze target**, and the dome is NOT on the decode path (161.6 noon / 79.6 night on BOTH arms). Reconstructed from the log: noon terrain **~221.5 → 214.7 (Δ −6.8)** against a dome at 161.6, seam 59.9 → 53.1 **narrower**; night terrain **~40.8 → 38.2 (Δ −2.6)** against a dome at 79.6, seam 38.8 → 41.4 **wider**. ***"ONE monotone darkening read through two geometries: by day the terrain sits ABOVE the dome so darkening closes the gap, at night it sits BELOW so the same darkening opens it. Nothing night-specific happens in the decode — which is precisely why the spread, the quantity that asks whether the seam is the same at every hour, improved by 44 %."*** **The number that decides the tuning question**: the day rim `#c6d7e8` keeps **80 %** of its luminance under the decode (0.8338 → 0.6643, ×0.797) while the night rim `#1a2246` keeps **13 %** (0.1369 → 0.0181, ×0.132) — **sRGB→linear is gentle on bright values and brutal on dark ones, so any re-tune is PER-KEYFRAME, never a global scale**. What the night target would have to be: `srgbToLinear(authored_night_rim)` equal to the DOME's linear horizon colour — the decoded target renders 38.2 against a dome at 79.6, **so the triple must go UP**, and the exact value is not derivable here because the chain from uniform to pixel runs through the aerial mix fraction (`maxMix` 0.55), ACES and the grade: ***"a measurement, not algebra."*** **Still REFUSED, three reasons**: no browser AND **the venue is the wrong instrument** — a synthetic SwiftShader sky, and tuning shipping constants against it is **the R17 §7.1 mistake in a new costume**; the triple is a **SINGLE SOURCE with four consumers by design** (`SKY.haze`'s own header: *"the SINGLE source for the rim triple … so all move TOGETHER per the round-6 rim rule"*), so moving it moves verify-rim / sat-depth / sat-night / dusk in one round; and **it is a look decision with a user checkpoint attached, not a defect fix**. **"AERIAL PASS NULL" RESOLVED**: it is `__flyStats.effects.aerial`, **the SAME config mirror that printed `dof=null` beside a live `__flyDof`** — the aerial term is mounted and live (`aerialOn = sat && AERIAL_PERSPECTIVE.enabled && tier === 'high'`, `Effects.jsx:154`), composed as an EFFECT into the shared `EffectPass` (R19's "0 extra draws"), **so there is no separate pass in `composer.passes` to enumerate**: *"null is the right answer to the wrong question."* **The channels live on that frame**: `AerialPerspective`'s `uHazeColor` (LIVE, decoded, 800 m → 14 km, `maxMix` 0.55, **dominant at a horizon**) and the tile depth haze's `uHazeColor` (LIVE, decoded, 16–55 km; `AERIAL_LAW` ships OFF so the amplitude is `SKY.haze.max` 0.5); the tile edge fade decoded but ~0 at 60–120 km; content haze OFF by constant; `SAT_QUILT` live but decoding no colour — **both decoded channels take the same `_atmoRim` triple by the round-6 single-source rule, so the A/B is a clean measurement of ONE authored target**. **SHIP ON, in C's order of reasons**: it is a SPACE fix, and with the flag off the triples are interpreted in a space the buffer is not in — **wrong whatever the seam reads**; the spread halved; **the night regression is SMALLER than the noon gain (+2.6 vs −6.8)** and is a target-value residual that **exists identically flag-off**, where the night seam is already 38.8, so turning the decode off does not close it — it gives back the noon gain and the spread; and shipping OFF **would certify a known-wrong colour space to make one sub-clause green**. **Two caveats for the close**: **(5b) may not be a measurement at all** — +2.6 luma is small, and if `haze-red`'s floor returns at or above 2.6 the clause is **noise and belongs in NOT CALIBRATED, not the regression column**; and **the ≤ 12/255 seam contract is unreachable at that pose regardless of the flag** (`maxMix` 0.55 leaves the terrain ≥ 45 % of its own colour, 0.45 × 51 ≈ 23 > 12, before a 1200 m falloff meets a 4200 m eye), so **the seam gate belongs on the informational side for R24**. **AND `haze-red` RETURNED THE FLOOR, which closes (5b)** (post-batch, `HAZE_RED=1`, both arms pinned `{ enabled: false }`; rc=1, 616 s, 10 passed / 2 failed — **the two FAILs are clause (3) on RED-A and RED-B**, spreads 19.3 and 19.8 at the old 0.5 bound, i.e. **the pre-merge-33 script, and not findings**; horizons found on both arms, `moonK` === 1 at a landed −14° sun, no page errors). **(5a) RED CALIBRATION (noon) — two identical arms must NOT separate: 0.00. (5b) RED CALIBRATION (night): 0.45.** ***"This number is the reader's noise floor, and any A/B claim smaller than it is noise."*** **So the night A/B's +2.6 luma is a REAL separation — about six times the within-run floor** — which **confirms C's attribution** (the decoded night target sitting darker under a dome the decode does not touch, a target-value residual identical with the flag off) and **changes nothing in the ship-ON ruling**: (5b) loses its "may be noise" caveat and becomes **a measured, explained regression of 2.6 luma at night against a 6.8 luma gain at noon and a halved hour-dependence**. **A SECOND FLOOR the row exposed**: across SEPARATE BOOTS the same OFF configuration at the same poses on the same tree read noon **59.3 here against 59.9** in the linear-haze run, and night **40.0 / 39.5 here against 38.8** there — **a cross-boot floor of roughly 1.2 luma, larger than the within-run 0.45**. The A/B's 2.6 clears that too, **so the reading stands, but the number a future A/B must beat is 1.2**; E records both floors and passes `HAZE_NOISE_FLOOR=1.2` to the tail re-run **TAIL RE-RUN — the A/B stands, and the night residual DID NOT REPRODUCE.** On `3231f7d`, started 03:09:35, rc=1 (E's convention: any NOTCAL leg returns 1), 581 s, load 4.15 / 4.35 / 4.50, with **`HAZE_NOISE_FLOOR=1.2` passed explicitly** — the CROSS-BOOT floor, the larger of the two, against a within-run `haze-red` measurement of 0.00 noon / 0.45 night: **9 passed, 0 failed, 1 NOT CALIBRATED** (`scripts/r24-out/tail/linear-haze.log`). The sun landed on **both** arms (noon 54.999°, night −14.000°, `moonK` 1 at night). **(5a) NOON: Δ OFF 59.3 → ON 53.4, a difference of 5.90, ABOVE the 1.2 floor — the decode ON reads the SMALLER horizon seam, and the L1 claim is measured a SECOND time** (the earlier run read −6.8). **(5b) NIGHT: OFF 39.8 → ON 40.1, difference −0.28, INSIDE the cross-boot floor → NOT CALIBRATED, neither pass nor fail** — **the earlier run's +2.6 night residual did NOT reproduce**, which is consistent with the ruling that the night remainder is refused TUNING and not the decode. **(3) INFORMATIONAL**: the time-of-day spread OFF 19.4 → ON 13.2, ratio **0.68** (the earlier run 21.1 → 11.7). **(4)** no page errors on either arm. **The ruling is unchanged — `LINEAR_HAZE` SHIPS ON — and the night leg is stated honestly as NOT SEPARATED at this venue's floor, not as a pass.** | PENDING — whether live colours land in the same band | — |
| `verify-depth-roundtrip.js` | **rc=1, 220 s, 1 passed / 1 failed — NOT RUNNABLE, not RED** (toy, tier high, renderer `reversedDepth=true`). Gate (0) refused because **`window.__flyDepthProbe(x, y)` was ABSENT** — *"this gate cannot reconstruct viewZ without the renderer's own conversion; re-implementing it in the harness would test the harness's copy of the bug"* — required signature `{ viewZ, coc, raw, reversed }` over drawing-buffer pixels, top-left origin, owner C under `DEPTH_FIX`; it printed `dof=null`, and gate (0b) "the DoF pass is present" then PASSED on an inference from style and tier while `dof` was null — **the fourth vacuous pass of the day**; E is making it read a handle. C has since built the hook (`e59445d`, §3), so **the PASS 2 marker stands**. Note for pass 2: an `error` there means **neither float target renders** — recorded with the probe's own string, and read as NOT RUNNABLE HERE rather than as a defect | **pass 2b: the hook ARRIVED and the gate still measured nothing.** `window.__flyDepthProbe` present and `__flyDof` true — **C's hook worked on the first run it existed for** — but 0 raycast hits of 15 probes and no finite CoC. Per-leg detail: `scripts/r24-close-sweep.md` §5.9. **RE-TAKE: rc=1, 443 s, 3 passed / 0 failed / 2 NOT CALIBRATED — the hook and the settle are proven, the round-trip is UNMEASURABLE FROM THE HARNESS SIDE.** On `9bcaace`, started 00:34:38, K=40, load 4.37 / 4.55 / 4.63. **(0)** `__flyDepthProbe` present **PASS**; **(0b)** the DoF pass is present — `__flyDof` true, style toy, tier high (*"the toy `DepthOfField` pass is the consumer this gate is about"*), renderer `reversedDepth=true` **PASS**; **the settle WORKED — SETTLED in 121 s, maxZ 15, load 4.49 — its first run as a CONTENT gate with K=40** (pass 2b's 0 hits was a world that had not streamed); **(1) THREE PIXELS WITH A KNOWN TRUE DISTANCE — NOT CALIBRATED**, 0 raycast hits of 15 probes, picked 0, every miss reading *"handle absent — THREE false, gl true, cam false, scene true"*; **(3)/(4) CoC — NOT CALIBRATED**, no finite `coc` (near undefined, far undefined), the DoF separation not asserted; **(5)** no page errors **PASS**; the row also printed **`dof=null` beside `__flyDof true`**. **ATTRIBUTION**: the gate tries to build a `Raycaster` **from OUTSIDE the bundle**, and the page exposes the renderer and the scene but **neither the camera nor the `THREE` namespace** — a bundled app has no `window.THREE` — **so no true distance can EVER be established from the harness side**. That is a **hook gap on C's probe, not a `DEPTH_FIX` result**, and **the miss table is what made it attributable in one read** where pass 2b's bare "0 raycast hits" could not say why. **ROUTED**: C extends the probe with an in-app truth raycast — `window.__flyDepthTruth(x, y)` (or a `truth` field on the probe result) through **the composer's ACTIVE camera** against **the world's depth-WRITING geometry only** (terrain tiles, toy chunks, sat buildings; no billboards, sprites or transparent non-depth-writers, **so the truth matches what the depth buffer holds**), returning `{ hit, distance, viewZ, object, source }` in the probe's own viewZ units and `{ hit: false, reason }` when nothing is hit, dev-only and on demand — and reconciles `dof=null` against `__flyDof true` with `cocSource` naming the pass it read. E consumes it: **(1)** picks three probes with `truth.hit` and asserts **\|probe.viewZ − truth.viewZ\| within 1 %** against C's **2.50–2.51 m** RED signature, NOTCAL with the truth's reason below three, **never a hand-built `Raycaster`**. **`depth-rt` joins the post-batch list after `fade`.** **POST-BATCH: rc=1, 434 s, 4 passed / 3 failed / 1 NOT CALIBRATED — the hook works, and the HEADLINE HOLDS.** On `14c1220`, which carries C's `__flyDepthTruth` and E's falsifier precondition; started 02:02:43, K=40, load 4.09 / 4.38 / 4.49. **THE HOOK WORKS**: (0) `__flyDepthProbe` present; (0b) the DoF pass present (`__flyDof` true, style toy, tier high); **(1) THREE PIXELS WITH A KNOWN TRUE DISTANCE — 12 truth hits** at 1,392 / 1,171 / 1,464 / 1,887 / 1,758 / 2,412 / 2,369 / 2,429 / 2,864 / 2,811 / 2,836 / 3,145 m on `Mesh`, *"in-app `Raycaster` through the composer's own camera against depth-writing meshes, un-bent by the live `uBendK`"* — per probe **`bendK` 0.000005, drops 10.05 – 30.12 m converging in 3–4 iterations, residual 0.000 – 0.007 m, reprojection 0.00 px on EVERY one: C's self-falsifying truth passed its own falsifiers on its first run**; (5) no page errors. **THE HEADLINE: the probe reconstructs in the KILOMETRE regime** — **1207.14 m against a 1171.4 m truth** (raw 0.00207; 2.5 / 0.00207 = 1207.7, i.e. z = near / raw, reversed with an infinite far and near ≈ 2.5) — **nowhere near C's 2.50–2.51 m double-un-reversal RED signature: `DEPTH_FIX`'s core claim, that reversed depth is no longer double-converted and DoF sees real depth, is CONFIRMED ON THE VENUE.** **THE THREE FAILS AND THE NOTCAL are instrument or open attribution, none of them the flag's**: **(2) near ~50 m — 3.05 %** (true 1171.4 m vs reconstructed 1207.14 m) and **(2) mid ~700 m — 3.26 %** (true 1171.4 m vs 1209.63 m), **both picks resolving to the SAME pixel (480, 464) with the same truth — two legs that are one measurement wearing two labels** (E's pick; fixed for the re-run as three DISTINCT pixels with distinct, ordered truths), with **the 36 m residual at 1.2 km left with C to attribute** (near-plane value, texel alignment between the two hooks, a skirt or LOD neighbour, float16 precision at raw 0.002) **before the ≤ 1 % bound is judged**; **(2) far ~4 km — 98.90 %** (true 3144.7 m vs reconstructed **34.45 m** at pixel (480, 281), raw 0.0726) — **the depth buffer holds a depth-WRITING object 34 m in front of the camera at that pixel that the truth raycast did not hit** (under reversed-Z a LARGER raw is nearer; the player aircraft under the chase cam is the obvious occupant, C confirming) — **two different surfaces, not a round-trip error**, so the re-run's pick treats a factor-of-ten disagreement as **a pick miss with its reason, never a `DEPTH_FIX` FAIL**, and C rules whether the truth's candidate set must include the player; **(3)/(4) CoC — NOT CALIBRATED**: the values are finite (near 0.141, far 0.165) but *"no `cocSource` is published — the gate would be asserting a number without knowing which pass produced it"*, and on a tree carrying C's `cocSource` publish it read null (with `dof=null` beside `__flyDof` true again) — C attributing. **The row re-runs at the tail.** **C CLOSED ALL THREE AT THE SOURCE** (`a44f4b7`, merge 37 `f22fcac`, `verify-c-flagoff` 50 → **54**, two RED-calibrated). **THE FAR PICK WAS C'S OWN DEFECT, not the candidate set**: a rigid vertical lift is the right correction for distant terrain and **fatal in the near field** — at `bendK` 5e-6 a 3,144 m hit means a lift of 3144² · 5e-6 = **49 m**, and a ray whose origin is lifted 49 m **passes ~49 m above anything a few tens of metres away**, so the first iteration hit distant terrain, the lift went to tens of metres, and every subsequent cast **flew straight over the player aircraft sitting ~30 m ahead under the chase cam**: *"the aircraft is a depth-writing visible Mesh and was in the list the whole time — my own rule was right and my correction defeated it."* The fix casts **BOTH** an unlifted ray (near field, where the drop is 0.05 m at 100 m and cannot matter) **and** the bend-solved ray, projects each corrected point back to the pixel, **rejects above 1.5 px, and takes the NEAREST survivor — "because nearest is what a depth buffer keeps"** — distant terrain found by the unlifted ray being pushed off the ray by its own drop and rejecting itself, **so there is no special case anywhere**; new fields `via` ('unlifted' \| 'bend-solved'), `tried`, `rejected`. **THE 36 m GAP, ruled out in order**: **NOT the near plane** (2.5 / 0.00207 = 1207.7 against a reported 1207.14 — **the probe reconstructs exactly near/raw for a reversed buffer, so the conversion is faithful and the disagreement is about which SURFACE**); **NOT texel addressing** (both hooks take `gl.getDrawingBufferSize()` and use exactly inverse conversions of the same px + 0.5 centre, **and `reprojectionPx` came back 0.00 on every probe — direct proof the truth point lands on the pixel asked for**); **NOT float16** (at raw 0.00207 a half-float carries ~0.05 % relative error, **60× too small for 3 %**). **What remains is the surface, and the log proves it was MOVING**: two probes of the SAME pixel (480, 464) read **1207.14 and 1209.63, 2.5 m apart** — *"a static surface cannot do that, so a truth taken in a different turn is a truth of a different world"* — so **`truth` is now a FIELD on the probe result, computed in the same synchronous turn as the depth read**, with no frame able to land between them (the standalone `__flyDepthTruth` stays). **THE CONTRACT WORDING MOVES, THE NUMBER DOES NOT**: ≤ 1 % is the wrong bound for a SURFACE comparison at 1.2 km, and it now reads **\|probe.viewZ − truth.viewZ\| ≤ 0.01·\|truth.viewZ\| + truth.slopeMPerPx**, because one pixel at 1.2 km subtends metres of ground and on a grazing face — a tile skirt, a cliff, a seam between two LODs — **the depth across one texel changes by tens of metres where no reconstruction error is being measured**; the truth casts the four neighbouring pixels and publishes `slopeMPerPx`, the largest one-texel view-Z step, **so the term is MEASURED at the probe's own pixel rather than guessed as a constant**: *"tight where the surface is flat, honest where it is not."* **`cocSource` WAS published — the gate read a different address**: `coc` and `cocSource` are assigned in the same branch off the same `cocTex`, so **a finite `coc` PROVES a published `cocSource`**, and the log printing `coc 0.1411764770746231` beside *"coc source: null"* is exactly that contradiction — the gate reads `__flyStats?.effects?.cocSource ?? __flyDof?.cocSource` (`verify-depth-roundtrip.js:381–383`) while the name lives on **the probe result the same gate already destructures at `:323`**: *"nothing wrote the address it read."* The probe now also mirrors the name onto `__flyStats.effects.cocSource` so both paths work, **and this class of "published, but somewhere else" is closed for the field**. **BONUS — THE CoC TEXTURE IS 8-BIT**: 0.1411764770746231 is float32(36/255) and 0.16470588743686676 is float32(42/255), **exact 1/255 steps**, so the CoC term is quantised to 0.0039 — comfortable against (3)'s 0.02 bound but worth stating, **because "0.141" reads like a continuous measurement and is not**; (4) is not blocked by it — it read 0.165 because that pixel held the aircraft at 34 m rather than terrain at 4 km, i.e. the far-pick defect, **and E's pick change plus the dual cast should clear the two together**. E consumes all of it for the tail re-run: `probe.truth` in the same turn, the slope term in (2), `cocSource` off the probe result, the quantisation stated. **TAIL RE-RUN, MEASURED: rc=1, 406 s, 7 passed / 2 failed** (toy / high, K=40, on `3231f7d`, started 03:19:16, load 3.93 / 4.17 / 4.37; `scripts/r24-out/tail/depth-rt.log`). **WHAT STOOD**: the hook published, the DoF pass present, **settled in 77 s** (maxZ 15), **13 distinct truths of 13 usable hits** with 2 misses where the un-bend did not converge in four passes ((672,297) residual 0.073 m, (288,281) 0.234 m, against the 0.05 m bound); **(2) NEAREST 35.9 m on `Jet_Cube024_1`, probe 35.94 m, err 0.10 % PASS**; **(2) FARTHEST 3210.4 m on `Mesh`, probe 3210.50 m, err 0.00 % PASS — the kilometre regime reconstructs, so the double-un-reversal headline stands a SECOND time**; **(4) far CoC 1 at 4 km PASS**; no page errors. **The CoC source is now NAMED in the log** — `DepthOfFieldEffect.renderTargetCoC`, half-resolution, via `__flyDof` — with the 8-bit quantum 0.0039 recorded. **THE TWO REDS ARE OPEN BY ATTRIBUTION — neither a defect nor a pass.** **(a)** (2) MEDIAN at px (480, 389): truth **1933.4 m** on `Mesh` against probe **1728.04 m**, \|Δ\| **205.36 m = 10.62 %** against a bound of **28.66 m** (1 % + a **9.32 m** one-texel slope), *"via bend-solved · 1 cast rejected of 2"*. **Nearest and farthest agree to 0.1 % ON THE SAME FRAME, so this is ONE PIXEL'S SURFACE disagreeing, not the decode**; C is reading the truth's rejected cast and whether a depth-WRITING actor (an `InstancedMesh`, a bent chunk) is missing from the candidate set — **instrument if so, and `DEPTH_FIX`'s if the buffer really reads 1728 m where every depth-writing surface is ≥ 1933 m.** **(b)** (3) *"CoC < 0.02 at the focus plane"* read near `coc` **0.161** — **on the PLAYER JET at 35.9 m**, because the nearest pick landed on `Jet_Cube024_1` under the chase cam: **the gate read an actor it does not control, which is R17 §7.1's lesson exactly**. E owns that premise and is rebuilding the clause as *"measured CoC ≈ the DoF material's own CoC formula at the truth distance, within the 8-bit quantum"*, **so it no longer assumes where focus sits**, with C supplying the focus-plane contract; the re-run rides a later server. **BOTH REDS ARE NOW ATTRIBUTED — INSTRUMENT, BOTH — with the re-run still pending.** **RED 1, the 205 m median, is C'S OWN TRUTH HOOK** (fixed at `81d803a`, merge 41 `066cc73`). The old truth **subtracted the GROUND drop from every hit and rejected anything that then missed the pixel by more than 1.5 px**, and that model failed twice at this pick: **on a GRAZING ray a vertical displacement is almost entirely PERPENDICULAR to the ray**, so at 1.7 km (ground drop 1728² × 5e-6 = **14.9 m**, one pixel ≈ 1.7 m) **a CORRECT candidate reprojects ~9 px away and is thrown out** — the row's own *"1 cast rejected of 2"*; and **the ground formula is WRONG BY CONSTRUCTION for an air-bent actor** (traffic, contrails and the player ride `world-bend-air-anchor`, whose `airDrop` carries R7's lift term), **so the one class of actor most likely to sit in front of terrain was the class GUARANTEED to be rejected**, and the truth fell through to the ground 205 m behind. **The candidate set is exonerated from source** — no raycast override, no layers manipulation anywhere in `components/fly` or `lib/fly`, every `InstancedMesh` pool already in the list. **The fix REMOVES the model rather than tuning it**: every bend variant displaces only in **Y**, so the rendered point shares the hit's XZ and **the truth is the point on the ORIGINAL ray at that XZ — reprojection 0 BY CONSTRUCTION, exact for ground, anchor and air bends**; `impliedDrop = hit.y − rayY(sameXZ)` becomes **a MEASUREMENT of how far the GPU moved the actor** and the validity test (0 ≤ impliedDrop ≤ groundDrop within tolerance) — **a ground hit reads them equal and an air-bent actor visibly less: the family tell, PRINTED not inferred**; both casts feed one pool of up to 8 hits each, nearest valid `t` wins, and the hook publishes every candidate (`hits`). **The two non-convergent misses (0.073 / 0.234 m) should vanish with it.** `verify-c-flagoff` **54 → 57**, RED-calibrated by forcing `valid=true` and by reversing the sort, **the gate file untouched**. C's line: *"your shape was right — it was an actor the ray DID see and my corrector discarded."* **RED 2, the CoC clause, is E'S INSTRUMENT and worse than "an actor it does not control": the toy DoF runs on WORLD CONSTANTS that do not follow the chase** — `TOY.dofFocusM` **700 m**, `dofRangeM` **2600 m**, `bokehScale` 2.6 (`Effects.jsx:238–246`), normalised to focus 0.001167 / range 0.004333 — **so the near pick at 35.9 m sat 664 m IN FRONT of the focus plane, and CoC 0.161 there is the DoF working as configured**. **The same defect voids (4): it PASSED at 3210 m while naming 4 km.** Both clauses picked their pixel **by RANK** (nearest / farthest truth) and never checked WHERE that pixel was, and nothing in this pose's 13 truths is near 700 m (closest 1171 m) or past 4 km (max 3487 m) — **so on this pose both are NOT CALIBRATED BY CONSTRUCTION: a pose problem, and never a reason to move 0.02 or 0.5. One cause, a false red AND a vacuous green.** **C's contract confirms the rebuild**: `CircleOfConfusionMaterial` computes `smoothstep(0, focusRange, abs(linearDepth − focusDistance))`, and evaluated at this run's own truths it reproduces the measurements within the 8-bit quantum (35.9 m → **0.1624** against a measured 0.1608; 3210 m → **0.9965** against a measured 1); **a "< 0.02" pick must land in 482–918 m of world distance**, and `window.__flyDof.cocMaterial` exposes the live `focusDistance` / `focusRange` uniforms. E rebuilds (3)/(4) as **"measured CoC ≈ the material's own formula at the truth distance, within the 8-bit quantum, at all three picks"** — **stronger than a focus-plane assertion, because it tests that the DoF reads REAL DEPTH without assuming where focus sits** — RED-calibrated on the flag-off tree where CoC must not track truth distance. The re-run rides the night-gates server after row (6) if E's rebuild is merged by then, else the `lod-fade` server. Marker stands for the re-run <!-- CERT:verify-depth-roundtrip PASS2 PENDING --> | — | needs `window.__flyDepthProbe`; absent ⇒ the row reads NOT RUNNABLE, never RED |
| `verify-terra-live.js` | **rc=1, 715 s, 8 passed / 1 failed — both arms, armed through `__flyTerraPaceOverride`.** Content probe **0 URL and 0 position mismatches in BOTH arms** (62/64 off, 59/65 on) — **a cache/URL mix-up is RULED OUT as a separate cause of "tiles swapping" in this code path**; **(4) merges 1 → 0** and **(5) replaced-on-screen 0 → 0**; **(7) the Owens ceiling 161 → 185 ≤ 261** and (8) Powell 161 → 183 ≤ 375, the rise being `keepResident` keeping more tiles DRAWN. **(6) FAIL, 1 → 17 repeat URLs — ATTRIBUTED TO THE INSTRUMENT, not `TERRA_PACE`**: the harness stepped `PIN_YAW` ~51° per rendered frame at 1 fps, so upstream started a refine, downloaded the children and DISCARDED them before the next evaluation — a node probe on the vendored classes reads duplicates 1 → 0 at 0.85°/frame and 28 → 28 at 51°/frame — and the byte LRU is ruled out by arithmetic (peak 41.3 MB ≈ 30 % of a 140 MB cap, merges 0). `PIN_YAW` became frame-based with `arcOk` guarding gate 6. **Two limits at exactly A's strength**: the fixture serves deterministic bytes per (z,x,y) and Esri does not, so a merge that replaces four children with a coarser parent reads here as a resolution change and on the user's machine as **a DIFFERENT CAPTURE** the probe cannot see; and the probe only tests tiles whose material already has a map, so its denominator excludes the mid-load tiles that are the likeliest moment for a mismatch. Per-leg detail: `scripts/r24-close-sweep.md` §5.10| **rc=1, 1973 s, K=40, both arms pinned explicitly — the residency trio HOLDS its yaw contracts on the flipped tree and BREAKS the frozen desert ceiling.** Started 22:04:16, load 4.20 / 4.63 / 4.71, `FLY_TERRA_SWEEP_MS=600000` with FRAME-based sweeps. **Arm A (trio OFF)**: content probe **62 resident tiles, 58 with an imagery URL, 0 URL / 0 position mismatches**; yaw arc **383° over 450 frames (0.8 fps)**; Powell draws **211** / tris 359,004; Owens draws **152** / tris 170,932; `residentMB` 0 (the OFF arm does not report residency). **Arm B (`timerFix` + `mergeHysteresis` + `keepResident` + `skirtFast`)**: **103 resident tiles, 99 with a URL, 0 URL / 0 position mismatches**; yaw arc **305° over 359 frames (0.6 fps)**; Powell **366** / 616,368 / `residentMB` **112.6**; Owens **279** / 409,846 / `residentMB` **113.7**. Gates: **(1)** every resident tile displays the imagery of its OWN z/x/y (arm A, 58 checked) **PASS**; **(2)** its quadtree address matches its world position (arm A, 62 checked) **PASS**; **(3)** the same with the trio ON (arm B, 99 URL / 103 position) **PASS** — the content half is answered in BOTH arms on the flipped tree; **(4) the engine stops merging tiles the camera merely turned away from — merges 35 → 0 PASS**; **(5) no tile is replaced while it is on screen — 27 → 0 PASS** — *that pair is the round's headline for Symptom B, measured on the venue*; **(6) SKIP / NOT CALIBRATED** — the duplicate-URL comparison needs ≥ 360° per arm within 10 % of each other and got 383°/450 frames off against 305°/359 frames on, **and the gate's own message named the right knob: raise `FLY_TERRA_SWEEP_MS` (arc = frames × 0.85°, so a slow venue needs proportionally longer), NOT `FLY_TERRA_YAW_MIN_ARC`** — hence 900 s on the re-take; **(7) CEILING Owens ≤ 261 in every arm that ran — FAIL, off 152 / on 279**; **(8)** satellite ≤ 375 at the suburb pose in every arm that ran — off 211 / on 366 **PASS**; **(9)** no page errors in either arm **PASS**. **THE BREACH: +127 draws with 41 more resident tiles and 2.4× tris at the same pose — retained tiles are ISSUED.** Pass 1's 45 s wall-clock sweep read Owens **off 161 / on 185**; this 600 s frame-based sweep reads **off 152 / on 279** at the SAME flag state, so **E's caution — accumulation with sweep DURATION — is the working hypothesis**, not (or not only) a cull-margin leak; **E's resident/visible census separates them in one read** (resident up with the drawn fraction flat = retention; drawn fraction up = cull). **Routed to A with two requirements**: a retained tile that is off-frustum or superseded is **never issued**, and residency gets an **eviction policy with a cap** (LRU by last-visible frame, tiles or MB — `residentMB` 113.7 after 600 s **and nothing says it stops**; a real GPU at 60+ fps accumulates an order of magnitude faster than this fixture, **and the user is flying this build now**), proven RED/GREEN in the node terra-residency gate with **zero-refetch-on-yaw preserved**. **The frozen 261 is NOT moved.** **A'S FIX HAS SINCE LANDED** (`dead5e5`/`c573d08`, merged to integration and pushed in `83462eb`): the breach is attributed to `keepResident` ALONE by a switch-by-switch measurement, and PATCH 26 `parkOffscreen` cuts off-frustum issued tiles **142 → 0** with residency itself unchanged (§3 A). **This row is DEFERRED, not closed** — E re-runs it at 900 s on that fix, and whether Owens lands under 261 is measured there, not asserted here. **The expected reading is on the record IN ADVANCE**: resident high, **`parked` high**, `visible` ≈ flag-off, drawn fraction well under 100 % — **read before the draw number** — and if Owens still breaches 261 with the drawn set frustum-bounded, that is A's named residual (z17 detail where upstream collapsed to z13) and the lever is `LODThreshold`, **never the ceiling**. The census itself was repaired first (§5.2) <!-- CERT:verify-terra-live PASS2 PENDING --> | PENDING — the residency trio's live draw evidence, and whether gate (6)'s repeat fetches appear on real bytes | the LIVE capture difference behind a merge; a fixture draw count bounds nothing live |
| `verify-frame-pace.js` | **rc=1, 153 s — NOT RUNNABLE BY DESIGN, not RED.** Gate (1): *"THE INSTRUMENT IS PUBLISHED — `window.__flyStats.frame` with `sample()`/`ring()`/`reset()` — absent — `FRAME_STATS.enabled` is false. Everything below is unmeasurable; that is the flag-off state, not a failure of the renderer"*, and the pacing legs are skipped. `FRAME_STATS` has **no runtime pin** — E's instrument is flag-gated and E's flip `6c26fe9` ships it ON — so **pass 2 is the first run of this gate**; even then its pacing legs are informational in this venue by design | **rc=1, 260 s, 5 PASS / 1 NOT CALIBRATED (22:37) — the instrument EXISTS and the row exists because `FRAME_STATS` shipped ON; pass 2a had no instrument at all.** `window.__flyStats.frame` is published with `sample()`/`ring()`/`reset()` and **27 fields**, the **13 ledger-quoted fields are present**, **programs delta 0** — no recompile storm — and no page errors. **(3a) FIRED**: *"no resize occurred in the window, resizes 0 over 107 frames"*, so **(3) every resize inside a rAF (0 of 0) and (4) `bufferMatchesDrawing` never false (0 of 107) carry NOT CALIBRATED inline** — without §2.10's vacuity guard both would have printed PASS and **the tear mechanism would have read clean on a window in which nothing resized**. E counts it as **the fourth time this pass a guard stopped a green that meant nothing**; `verify-step-clean` is the row that forces a step. The phase marker earned itself here: **the last stall, 3660 ms, is stamped `[finalize:sat-roads ×16]`** — an owner, not a mystery **Final; no browser re-run of this row is scheduled** · per-leg detail: `scripts/r24-close-sweep.md` §5.11 | PENDING — **everything**: stalls/min, worst dt, p99, >100 ms/min | the pacing legs are not asserted here; flag-off it correctly reads "instrument absent — unmeasurable, not a renderer failure" |
| `verify-seam.js` browser leg | **NOT RUN this round** — no browser seam row was scheduled in either pass or in the re-take | **NOT RUN this round** (the `verify-seam` NODE leg is green in every smoke — 9/9, §4.1) | PENDING — the seam on a real display | a browser seam leg was never posed here; the node leg is the round's seam evidence |
| `verify-env-uniform.js` | **NOT RUN this round** — `ENV_UNIFORM` ships **OFF** (§5.3), so no browser leg was scheduled in either pass | **NOT RUN this round**, same reason. **The round's only evidence for it is node-side**: B's `r24-b-prewarm-proof.mjs` **9/9** with `--red` **5/9** as recorded (6 of 9 FAIL re-read at the close) against the defective `06b8f1d`, which proves the stand-in-scene fix and NOT the flip · per-leg detail: `scripts/r24-close-sweep.md` §5.12 | PENDING — the ms a compile storm costs | the proof B asked for and never ran, **still owed to the next round**: the `programsDelta` run and the twilight A/B |
| `verify-shadow-calm.mjs` | **PASS 32/32 in node** (§1, §4.1) | **33/33** on C's flipped branch · per-leg detail: `scripts/r24-close-sweep.md` §5.13 | PENDING — sparkle, acne, whether the catcher receives a shadow | no browser leg exists and none could be afforded (its mount begins with the fleet pin). **No pixel, no draw count; "Owens is 0 by construction" rests on `queryColumns` answering `[]`, which is a browser fact** |

**PASS 2a IS VOID, and it is the round's own pacing rule that voided it.** The
first pass-2 row ran on the flipped tree (`TREE UNDER TEST 91141fe`, boot proof
62.3 s) and came back `rc=1, 542 s, 3 passed / 4 failed` with **Powell 0 meshes
/ 0 tris and Manhattan 0 / 0** — (1a), (1b) and (2) FAIL on an empty world, (5)
NOT CALIBRATED, and **(3) printing "GREEN zero=0 tris=0" ON AN EMPTY CENSUS**,
which is precisely the case E's own gate header warned about. The mechanism was
then read from source rather than inferred: `lib/fly/finalize-pace.js:74-79` —
`mayFinalize(done)` with `done === 0` returns `lastDtMs <=
FINALIZE_PACE.longFrameMs` (24 ms), and **every SwiftShader frame here is
300–1000 ms**, so rule 1 refuses the FIRST finalize of EVERY frame and
`sat-building-engine.js:1366` never lets a chunk finalize. **`FINALIZE_PACE`
shipped ON starves every content gate in this venue** — and the void is real AND
**the mechanism is a SHIPPED DEFECT, not a venue artefact**: a fixed 24 ms
threshold is a LEVEL detector, so **any machine steadily below ~41 fps** (33 ms
at 30 fps, 50 ms at 20 fps) refuses the first finalize of every frame forever and
never lands a chunk. The venue only made it total. E's harness budget could not
save it either: `budgetK()` scales only the COUNT budget at `:1362`, BEHIND the
wall-clock rule. **A's fix is a PRODUCT fix, not a harness one, and it has LANDED** (`r24/a
abd127c` → integration **`3d388ec`**, close merge 6, pushed, node smoke 16/16):
rule 1 refuses only when the frame exceeds BOTH `longFrameMs` (24 ms) AND
`spikeK` (**2**) × a running EMA of the frames **BEFORE** it — so **a big hitch
cannot raise its own threshold and hide** — capped at `maxRefuseFrames` (**3**)
consecutive refusals; `EMA_ALPHA` 0.1 is a module constant, the instrument's
smoothing rather than a policy. The EMA seeds at `longFrameMs`, so on a very
slow machine the venue refuses **6 of its first 40 frames (worst run 3) and then
never again** — about 6 s of deferral at boot at 1 fps, inside every settle.
**Rule 1 carries NO harness seam at all**: the EMA makes it a no-op on a steady
venue by construction, which is why the venue's fix and the product's fix are
one change. Rule 2 keeps `budgetMs × budgetK()`.
`verify-finalize-pace` goes **14 → 17 gates**, RED-calibrated by reverting rule 1
to the shipped line: (14) steady 33 ms frames — **shipped admits 0 of 40, fixed
admits every frame**; (15) 20 fps and the 1 fps venue converge with worst run
≤ 3 — **shipped 0/40, worst run 40**; (17) a hitch train never defers more than
**3** in a row — shipped worst run 20; (16) one 40 ms hitch amid 16.7 ms frames
is refused **AND ONLY THAT FRAME**, which passes BOTH ways — i.e. **the fix did
not move the behaviour rule 1 was written for**; (18) rule 2's budget is 3 ms at
K=1 and 120 ms at K=40. Pass 2 restarts from the top on the corrected tree. The close sweep records the row's real
danger in one sentence: *"gate (3) PASSED on an empty census; only the (1a)/(1b)
preconditions added after the §2.10 audit stopped that being reported as the A1
fix landing."* Two other readings from the same run stand: **(4b) the pale
self-test fires exactly once**, so the rewritten detector finally has its own
RED, and **(4a) still reported 8 pale hits in 290 frames including consecutive
identical-mean frames** (f:141/142 both mean 222.1 against a median of 145.5) —
a sustained field, not a one-frame jump. E's isolation rule (`a2d95a3`) is now
in: **a candidate counts only when its run length is exactly 1**, and longer
runs are recorded separately as "sustained" with their extents, so the voided
run's 8 hits replay as **0 isolated + 2 sustained** while the self-test's single
white frame still scores exactly **1**. E notes why the obvious form was
rejected: a naive "f−1 and f+1 are not pale" test **would still admit the last
frame of every run** — run length is the right rule.

**PASS 2b, and it reads in three parts** (K=40, tree `ec53fd3`, boot 60.9 s;
`rc=1, 571 s, 6 passed / 1 failed`).

1. **THE CENSUS IS ALIVE — and that closes pass 2a's mechanism.** The RED leg
   (`__flyFlashPin='off'`) reproduces pass 1 **EXACTLY on the flipped tree**:
   Powell 3 meshes / 31,576 tris / **2,616 zero-area (8.28 %)**, Manhattan 14 /
   126,116 / **5,820 (4.61 %)**, with (1a), (1b) and (2) PASS. **A's rule-1 spike
   fix is confirmed on the venue by the same instrument that read 0 meshes in
   2a** — the strongest form of that proof available here.
2. **THE GREEN LEG IS VOID AGAIN, for a different reason.** "powell (no pin): 0
   meshes, 0 tris", so (3) printed **"PASS zero=0 tris=0" on an empty census**
   once more and (5) is NOT CALIBRATED. The cause this time is the harness: **the
   gate boots its second page while the first is still alive and rendering**, so
   the green boot gets roughly half the CPU and settles no chunk inside a fixed
   60 s — pass 1's same leg settled 2 meshes / 20,935 tris, which was already
   marginal, and the flipped tree does more per frame. **`FLASH_GUARD`'s green
   remains UNMEASURED.** E is closing page 1 before page 2 and replacing the
   fixed settle with the settle CONDITION, and the row is re-taken **standalone**
   after pass 2b's end line on the same tree; **that re-take decides the §8
   `FLASH_GUARD` row**, which stays ON per the ship table with "green leg pending
   re-take" until it lands.
**THE STANDALONE RE-TAKE SET, after pass 2b's end line, is now THREE rows** on
the same tree with E's harness fixes and B's `minFrames` merged: **flash-guard**
(page isolation + the self-test), **fade** (the `__fadeU` probe + `minFrames`)
and **lod-fade** (frame-based yaw — **and its pinned ON leg is what decides
`LOD_CROSSFADE`**).

3. **THE DETECTOR: the isolation rule works, and the self-test broke.** (4a)
   **0 isolated pale frames in 266**, with 3 sustained runs recorded separately
   and now labelled as the sky they are — len 5 at f107–111 (mean 214.8 against a
   median 152.3), len 6 at f221–226, len 2 at f240–241 — so the rule does its job
   on the false positives. But **(4b) the self-test registered 0 hits LIVE where
   E's replay scored 1**: *the instrument cannot see the event it exists for*.
   That is E's TENTH instrument defect and is under investigation.

**`verify-flash-guard`, pass 1, leg by leg** (`K=40`, `__flyFlashPin='off'`):

| leg | result |
|---|---|
| (1a) Powell census | 3 meshes / **31,576 tris** |
| (2) RED calibrated | **2,616 zero-area (8.28 %)**, coincident-vertex |
| (1b) Manhattan census | 14 meshes / **126,116 tris** / 5,820 zero-area (4.61 %) — sat-buildings 4 meshes / 42,364 tris / **5,820** (worst chunk **13.98 %**); **sat-skyline 10 meshes / 83,752 tris / EXACTLY 0**; toy-world 0/0/0 |
| (3) GREEN | **FAILS BY DESIGN on a flag-off tree** — the gate releases B's runtime pin, which only knows `'off'` (`lib/fly/toy-world/flash-guard.js:51`), so the "green" leg measures the population a third time (**1,744 / 20,935 = 8.33 %**, fresh boot). **(3) is the go/no-go for `FLASH_GUARD` ON in pass 2** |
| (4) PALE DETECTOR | **VOID** — the reason is in the gate's cell above, verbatim |
| (5) | **was VACUOUS**: a tautology printing `pinned=n/a`, i.e. a PASS asserting nothing; and `flagOn(probe)=true` was misleading — it read the pin's ABSENCE, not the constant. Both fixed at `r24/e ff5d9a1` (post-run): (5) now compares the sat-buildings degenerate RATE between legs or prints **NOT CALIBRATED** |
| (6) | clean |

### 4.3 Inherited gates and frozen numbers

| Gate | Frozen number | This container | LIVE |
|---|---|---|---|
| the R21 quartet: `verify-stability` / `-flicker` / `-tier-step` / `-seam` | 17 / 7 (bound **12**, never moved) / 10 / 13 | seam node leg green (§4.1); the rest NOT RUN HERE | **PENDING — user machine.** The in-tree R21 record has no W3 matrix, so this is the **first real measurement of the tree R24 was built on**, not a regression check |
| `soak-fly --satellite --minutes 15` | p95 tris ≤ 2.2 M · p95 draws ≤ 375 · heap climb < 60 MB · governor steps ≤ 4 · 0 page errors | **NOT MEASURABLE HERE** | **PENDING — BLOCKING** |
| `verify-neon-cover` (five R18 FNV hashes) | frozen | — | a re-baseline candidate ONLY under `RING_DEDUPE`, which ships OFF |
| `verify-sat-buildings` / `-skyline` / `-parcel-homes` / `-suburbia` | 226 draws / 6,965 kept / 6,964 columns · 17 · Powell 0 placed · nothing in (25, 35) m | not re-run | frozen |
| `verify-rim` / `-dusk` / `-sat-night` / `-sat-depth` / `-aerial` / `-edge-fx` / `-neon-alt` | pixel bands; `verify-aerial`'s 0.55 | — | **the ONE-TIME sanctioned horizon re-baseline batch (C's L1 + D's law) was NEVER EXECUTED** — which is why `AERIAL_LAW.enabled` ships false. `verify-sat-depth`'s hillshade margin does not move (dayK 1.0) and `verify-aerial`'s 0.55 stays exact (A8's noon identity) |
| `verify-monuments-sat` | eleven frozen numbers | **+3 gates, additively**; no frozen number moved | frozen |
| **the three NIGHT gates** — `verify-sat-night` / `-dusk` / `-flicker`, run because C's hill-follows-moon ruling moves satellite NIGHT ground pixels | R19/R16 pixel bands | **FIRST ATTEMPT VOID ON THE HARNESS, plus ONE REAL READING.** `verify-sat-night` **rc=1 after 172 s with ZERO gates run** — *"locator.screenshot: Timeout 23971 ms exceeded"* after *"waiting for element to be stable"*: the R16 harness's screenshot waits on Playwright's ACTIONABILITY check, **which a canvas re-rendering continuously at fixture frame rates never satisfies** — a venue-vs-legacy-harness mismatch, **not a lighting result**; E is adapting the screenshot path (`page.screenshot` with a clip, or the harness's own `readPixels` probe) and re-running all three. `verify-dusk` **rc=1 after 177 s** and got **ONE reading out before the same timeout**: *"pinned noon is the certified DAY sky (day bucket, no blend, env/bg exactly 0.85 / 1.0) — FAIL — state=day s=0 env=0.7382 bg=0.8801 el=67.954°"* — **both `SatEnvironment` intensities scaled by ~0.868 at a PINNED NOON where `moonK` is 0**, so it is **NOT** the hill-follows-moon change: **something that shipped ON this round dims the satellite environment BY DAY**, and since this frozen R19 gate never ran on an R24 flipped tree until tonight it has read that way **since the flips at `ec53fd3`**. **C CLOSED IT AT THE SOURCE, and it is NOT an R24 flag** (`739d3ee`, merge 40 a fast-forward): it is **a per-FRAME ramp starved by a ~0.5 fps venue**. `SatEnvironment.jsx:553` ramps both intensities with `k = 1 − Math.exp(−(delta > 0.25 ? 0.25 : delta) / SKY_LIVE.hdriFade.rampSec)` where `delta` is r3f's FRAME delta — **a per-frame exponential approach capped at 0.25 s of advance PER FRAME, not a wall-clock ramp** — and `git log -L` puts the clamp and `rampSec` 1.5 in R16's `4a1fe1f` and the `day: { env: 0.85, bg: 1.0 }` anchor in R13's `d72adb1`: **neither moved this round.** **The arithmetic says it twice**: env is 13.15 % short and bg 11.99 % short, implying **3.04 s and 3.18 s** of ramp time, i.e. **12–13 frames at 0.25 s each inside a 26 s wait — ~0.48 fps, exactly the SwiftShader regime**; and the two ratios are **NOT equal (0.8685 vs 0.8801) precisely because they ramp from different seeds toward different targets — one starved ramp measured on two channels, not two symptoms**. On a machine with frames, 26 s buys 26 s of ramp (`exp(−26/1.5)` = 3.3e-8) and the explicit snap two lines down lands on **EXACTLY** 0.85 / 1.0, which is what the frozen cell's "exactly" requires: *"the gate is a settle contract and the venue cannot satisfy it at half a frame per second, whatever is flagged."* **Every candidate cleared FROM SOURCE**: `LAMBERT_ENV` sets `material.reflectivity` on Lambert materials only (four named sites), per-material and never a scene scalar; `CLOUD_LIT` is a material; `ONE_SUN`'s `hill.dayK` is 1.0, the identity; **POST_ORDER and tone mapping cannot show in these numbers BY CONSTRUCTION** — the gate reads `__flyStats.envIntensity` / `bgIntensity`, written straight from `env` / `bgOut` at `SatEnvironment:598–599`, **pre-tonemap scalars before any pass runs**; `ENV_UNIFORM` is shipped OFF; `FRAME_STATS` adds no draw and no material state. **The decisive structural fact**: the ONLY writers of `scene.environmentIntensity` in the whole tree are `FlyScene.jsx:2468` (the TOY `<Environment>`) and `SatEnvironment.jsx:347`/`:594` — **nothing R24 added writes either scalar**. **WHAT CHANGES IS THE HARNESS** (E, scripts-only): a settle contract **waits on the VALUE, not the clock** — `await page.waitForFunction(() => window.__flyStats?.envIntensity === 0.85 && window.__flyStats?.bgIntensity === 1)` with a generous timeout, **strictly stronger than the 26 s sleep and immune to venue speed**, applied to **all fifteen legs** that sleep on the same assumption; **the assertions do not move — a venue adaptation of a settle, not a re-baseline**. C's offered `envTarget`/`bgTarget` publish was DECLINED by the orchestrator: the constants are known to the gate | **PENDING** — the night look on a real display, and whether the day dimming is visible |

### 4.4 The fixture column, for the record

`verify-fixture` on the flag-off tree, tier high, 1280×720, `K=40`,
`FLY_BOOT_SCALE=6`, load 4–6 — **10 passed, 0 failed**:

| Pose | draws | tris | satBuilding | satSkyline | parcelHomes | settled | maxZ | ground |
|---|---|---|---|---|---|---|---|---|
| Manhattan @792 m | **176** | 344,430 | 7 | 10 | 0 | **false** @300 s (12 chunks draping) — a **FLOOR** | 16 | 14.8 m |
| Powell @900 m | *(stale)* | 385,393 | 16 | 0 | **671** | **true** in 305 s | **17** | 275.3 m (true 276.3) |
| **Owens @2600 m** | **184** | 208,987 | **0** | **0** | **0** | **true in 53 s**, 16/16 `empty` | 17 | 1128.3 m |
| **Melton @700 m** | **153** | 451,149 | 0 | 0 | **1,836** | **true in 154 s** | 14 | 113.9 m |
| toy / Powell | **91** | 66,500 | — | — | — | — | — | — |

Against the frozen ceilings: Owens **184 ≤ 261** · satellite **153 / 176 ≤
375** · toy **91 ≤ 480** · fixed-pose tris all ≤ 2.0 M. **These bound nothing
live** — the fixture's scenes are less dense than the real planet's; they are a
regression baseline FOR THIS VENUE. The Owens lock and the R20 Melton carpet
reproduce; Powell's 671 parcel homes (against 2,992 on an unsettled Powell) is
the R20 anti-duplication story reproducing once the collision index exists.

### 4.5 The honest verdict

- **Certified here:** every structural, count, census, determinism,
  source-scan, byte-identity and fixed-pose claim reachable through node — the
  node set green on the integrated tree, the worker byte-identical across five
  merges on 149 fixture tiles, the Owens lock and the Melton carpet reproduced,
  a RED calibration for each new gate on the literal flag-off tree, and the
  boot proof on `5ca8e15`.
- **Not certified, and not certifiable here:** every fps, frame-time, stall,
  governor, tearing and driver claim, and the LOOK of anything on a real GPU
  over real Esri and OpenFreeMap bytes.
- **In flight:** the two browser passes of §4.2.
- **Still pending:** `scripts/r24-user-diag.md` Part A on the CURRENT build.
  **Without it there is no before, and "smoother" is an opinion.**

**`verify-ladder-fix`, pass 1: GREEN — and it is a measured ON leg.** The gate
boots TOY and arms `LADDER_FIX` and `STEP_SAFE` through their runtime pins, so
it certifies the shipped behaviour on the flag-off tree: **rc=0, 90 s, 13 passed
/ 0 failed.** (1) **two sub-native render-scale rungs exist on a DPR-1 display**
— 0.875/high and 0.75/high; (2) both come BEFORE the first tier rung (last
sub-native at index 2, first tier rung at 3); (3) the boot rung is still index 0
at native DPR and boot tier (1/high); (4) the tier rungs are unchanged in order
and count (1/medium, 1/low); (5) the governor estimates the display refresh from
the frame cadence — **144 Hz** on a synthetic cadence; (6) `nativeRefresh`
target **144** vs refresh 144; (7) **a stuttering session steps DOWN although
its mean fps is healthy** — rung 3 at `emaFps` **53.4** (at or above the 51 fps
down bound) with `longFrac` 0.1, which is exactly the pattern the EMA cannot
see; (8) CONTROL: a clean 60 fps session never steps (rung 0, dprSteps 0,
tierSteps 0); (9) render-scale rungs are spent before any tier step — dpr steps
[0.875, 0.75, 1] then tiers ["medium"]; (10) a forced step moved the ladder
0 → 1; (11) **`STEP_SAFE` applied it INSIDE a frame, not through the safety
valve** (n=1, `applyMs` 466.8 — a SwiftShader number, `composer=true`); (12) the
composer buffers ARE the drawing buffer after the step ([560, 315] both);
(13) clean. **The R20 flap condition `[1/high, 1/medium, 1/low]` is now the
five-rung ladder, measured.**

**`verify-depth-roundtrip`, pass 1: NOT RUNNABLE, not RED.** rc=1, 220 s,
1 passed / 1 failed, toy at tier high with the renderer reporting
`reversedDepth=true`. Gate (0) refused because **`window.__flyDepthProbe(x, y)`
is ABSENT** — *"this gate cannot reconstruct viewZ without the renderer's own
conversion; re-implementing it in the harness would test the harness's copy of
the bug"* — required signature `__flyDepthProbe(x, y) → { viewZ, coc, raw,
reversed }` over drawing-buffer pixels, top-left origin, owner C under
`DEPTH_FIX`; it printed `dof=null`. Gate (0b) "the DoF pass is present" then
PASSED on an inference from style and tier **while `dof` was null** — the
FOURTH vacuous pass of the day; E is making it read a handle. C is building the
hook on `r24/c` as a dev-only, `NODE_ENV`-guarded handle (production
byte-identical) whose JS mirror of three's reversed `perspectiveDepthToViewZ`
is proven against the GLSL text in its node proof, plus `window.__flyDof`; the
row re-runs in pass 2.

**`verify-one-sun`, pass 1**: **rc=1, 251 s, 20 passed / 7 failed = RED
calibrated.** Both pins released (`__flySunOverride` null → null,
`__flySatShadowOverride` 0 → 1) and **`live === true` at high AND medium**, so
the released term is proven reachable before anything is asserted. Azimuth:
key === hill, **Δ 0.00e+0°** at every tier and time. **Key ELEVATION is stuck
near 45° — 39.552° at high/noon, 45.291° at high/dusk, 45.142° everywhere else
— against a true solar 55 / 2 / −14, at high AND medium**: recon L3, measured
in the shipped app. **Medium azimuth spread 0.0000°** is the RED itself. Gate
(5) — "water reads the same directional, Δ undefined°" — **PASSED on an absent
reading**, i.e. vacuous; E is fixing it. No page errors.

**`verify-linear-haze`, pass 1: VOID, instrument.** rc=1, 240 s, 4 passed /
2 failed — and not one of the six means anything. Both poses read **terrain
L 0.0 / sky L 0.0**, a luma profile of all zeros, and "horizon row 6 of 540,
step 0.0": the seam reader ran from `page.evaluate`, **outside any animation
frame**, against a `preserveDrawingBuffer:false` context, so `readPixels`
returned a CLEARED default framebuffer. (1a) and (1b) failed honestly ("no
horizon in the frame"); (2a), (2b) and (3) then PASSED — "RIM SEAM ≤ 12/255
Δ 0.0" and "seam independent of time of day, spread 0.0" — **on black against
black.** E is rewriting the reader to sample at the start of the NEXT animation
frame on the renderer's own context (the pale detector's idiom, which is
exactly why the census rows worked) and making (2)/(3) print **NOT CALIBRATED**
whenever (1) fails; the row is re-run in pass 2. `verify-depth-roundtrip` has
no `readPixels` path, so it is not the same shape.

**`verify-lod-fade`, pass 1** (`K=40`, flag-off, Powell, a 40 s PURE YAW with
the position frozen): **rc=1, 317 s, 2 passed / 5 failed = RED calibrated.**
(1) `residentTiles` 0 / `estMB` undefined — A's byte LRU only tracks with
`TERRA_PACE` on, expected in pass 1; (2) 47 frames, 61 events; (3) **27
RE-appearances on a pure yaw** = A's T1/T3 bend-blind re-stream, measured from
the other side; (4) **8 hard refines + 3 hard merges** = D's T4 atomic swap;
(5) crossfade window **0 frames**; (6) **15 tile URLs refetched**, worst 2×
`/img/6/23/17` = A's refetch defect; (7) Owens FIXTURE draws **174** / tris
**166,659** (the live ≤ 261 is not re-baselineable from here); (8) zero page
errors.

**A gap the row exposed, and it matters for `LOD_CROSSFADE`'s go/no-go:** as
written, `verify-lod-fade.js` has **no ON leg** — it never sets
`window.__flyLodFadeOverride` — so the one feature that ships OFF *pending a
measurement* could not have obtained that measurement from either pass. E is
adding a pinned ON leg (same pose and sweep, reading `__flyStats.terra.fades`:
`hardSwaps`, `faded`, `peakActive`, `skip.*`, plus the Owens column) for
pass 2, with D reviewing the criteria mapping. Expected pass-2 reading under
the ruled ship state: (3) and (6) GREEN from `TERRA_PACE`; (4) and (5) stay RED
in the OFF leg, because LOD ships OFF, and **the pinned ON leg is what decides
D's go/no-go**.

---

## §5 Postmortem

### 5.1 Three unimported symbols, on three branches, one mechanism

The certification run was VOIDED: a control probe (no init scripts, fixture,
satellite, 640×360) on `bf319ca` reported `ReferenceError: ATMO_GLSL_DECL is not
defined` **at module evaluation**, body "Something went wrong", **0 canvas**,
`__flyBoot` undefined. `eslint --rule no-undef` over the 50-file delta (vendor
`plugin.js` excluded) found three, all present on the branch tips and in clean
worktrees — **branch defects, not merge resolutions**:

| Owner | Symbol(s) | Where it throws | Reach |
|---|---|---|---|
| **D** | `ATMO_GLSL_DECL`, `ATMO_GLSL_FRAGMENT` (**module scope**), `AERIAL_LAW` ×2, `atmoUniforms`, `getAtmoLaw` in `AerialPerspective.jsx` | a module-scope template literal ⇒ the **whole `components/fly` chunk** dies at evaluation, in BOTH styles | **no flag can gate it** — the demonstrated cause of every void row. Introduced by `bc408e7`, present through `6dc8817` |
| **A** | `pinned` in `CloudField.jsx` | render time, in a helper that is **not behind the flag** | reachable with every flag OFF, in both styles |
| **C** | `offsetUnits` in `FlyScene.jsx` (the `SHADOW_CALM` catcher's material) | inside a `useMemo`, when `SatShadowCatcher` builds its material | unreachable on the shipped tree: needs `SHADOW_CALM.enabled` AND satellite AND tier high AND `__flySatShadowOverride ≠ 0` |

**A's and D's share one mechanism, arrived at independently: an un-asserted
`String.replace`.** A's anchor (`import {\n  HUD_SYNC,`) does not exist in
CloudField; D's was `AerialPerspective.jsx`'s two-line prologue, which the C
merge had already changed by adding `SRGBColorSpace`. **A miss is a silent
no-op**, both scripts reported success, and each helper landed without its
import. Five of D's six edits had an `assert old in s`; **the one that did not
is the one that broke.** Four blind spots, each a rule someone was following: (1) the project ESLint
config does not enable `no-undef`, so both agents compared totals that could
never contain this class; (2) a compile check resolves MODULES, not IDENTIFIERS
— `GET / 200` was true and meaningless; (3) **no browser gate ran after the
offending commits** (A's last was `verify-ladder-fix` at `36792a0`, one commit
earlier; D's `lodprobe-on.log` at 16:52 postdates `bc408e7` at 16:45); (4) C's
was behind the flag AND a fleet pin — the first run that could mount the catcher
is `verify-shadow-calm`, whose recipe says step one is un-pinning
`__flySatShadowOverride`, and which did not exist until `a9e30cc`. HARN-GAP-5,
twice in one round.

**D's correction, made in its own ledger (§4.95):** the flag-ON LOD leg did not
"time out under load" — `bootFly` waits on `__flyBoot`, which never exists when
the chunk throws, so the 180 s timeout **is the signature of D's own defect on a
tree D had broken seven minutes earlier**. The RED leg (`lod-off.json`, 16:23,
before `bc408e7`) is VALID; **the ON leg was never booted, on any tree, at any
time.**

### 5.2 The void rows, seven instrument defects, and the port guard

Three rows of the two attempts are not results: **`fixture` run 1** (`rc=1 62s`
— E's `ps | grep | kill` loop matched the orchestrator's row); **`flash-guard`
run 2** (`rc=1 601 s` — E's `INSTALL_PALE` probe polled
`canvas.getContext('webgl2')` from page load, and **a canvas has ONE context
whose attributes the first caller decides**, so the probe raced three and the
boot never completed; fixed in `cbd7c8a` by reading `window.__flyGl`;
`linear-haze` in the same run carried the identical bug); and **`fade` run 2**,
killed by the orchestrator at ~19:12 while diagnosing.

**E's `getContext` race is recorded as REAL BUT NOT THE CAUSE, at E's own
request** — the demonstrated cause is D's module-scope `ReferenceError`, on a
tree where nothing could boot at all (lesson 19).

**E's instrument-defect count for the session is THIRTEEN**, each with a defence
in the tree (the thirteenth is `verify-lod-fade.js:782` calling an unimported
`notCalibrated` — **the round's own §5.1 defect class inside a harness file**,
and the mechanism was §5.1's exactly: the missing `require('./_notcal')` was ONE
python replace in the same batch as seven other gates, and **that one had no
assert and matched nothing**. It was committed by the agent writing the gate that
catches unimported symbols. `verify-import-integrity` now sweeps `scripts/` —
**374 files, up from 200**, with `r24-out/` and `r24-fixture/` ignored and the
ignore list still pinned — RED-calibrated: `ec53fd3`'s `verify-lod-fade.js`
dropped into the swept tree yields **7 `no-undef` errors** — and the extended
sweep **caught its own next unimported symbol within the hour** (`b5a638a`:
`lateActive`, declared inside an `else` branch and read outside it, on the very
path D had asked E to add), in ONE node-gate run, where the previous instance of
that class cost **860 s of browser time and a certification row's ON leg**, and
**two MORE of E's own turned up while the next batch was being written** — a
block-scoped `lateActive` and a missing `notCalibrated` import in one-sun, the
third and fourth instances; and
**the FOURTEENTH is the sun override itself** — an elevation OBJECT written to a
TIMESTAMP handle, a value crossing an ownership boundary in the OTHER direction,
with the gate WRITING a shape the owner never defined, which voided two legs of
one-sun and the night leg of linear-haze) (the tenth, pass 2b's pale self-test registering 0 hits live where the
replay scores 1, is open at the time of writing; the eleventh is
`verify-fade`'s `presenceOf()` reading guessed channel names instead of the
handle B published for it; the twelfth is `verify-lod-fade`'s wall-clock sweep,
the SECOND of its kind and found by the first one's fix — §4.2): the context race; the artifact overwrite (§5.4); the straw-man port
guard; the sky inside the pale crop; the vacuous gate (5); the misleading
`flagOn(probe)`, which read a pin's absence rather than a constant; the seam
reader that sampled a cleared framebuffer from outside any animation frame and
passed three assertions on black against black; and **`r24-cert-run.sh`'s
summary grep, which did not match `NOT CALIBRATED` — so a third verdict would
have been a SILENT row in the run summary**; and the one-generation cleanup trap
below. Each was found by E and fixed by E, which is the difference between an
instrument-defect count and a defect count. **Four vacuous passes in one
day** — flash-guard (5), one-sun (5), linear-haze (2a)/(2b)/(3), depth-roundtrip
(0b) — is what makes lesson 24 a rule rather than an anecdote.

**D's review of E's LOD ON leg found four venue-dependence defects, all fixed
before pass 2**: a 10-rendered-frame drain for a 250 fade-ms fade is 500 ms here
and 167 ms at 60 fps — a HARD gate that fails on a healthy machine; the 20-frame
warp settle is 18 frames here, 54 at 60 fps and ~130 at 144 Hz; the OFF and ON
arms took their snapshots after different settles; and strict equality of
`refines + merges` across two boots at 1–3 fps is a coin unless the frame counts
are within ±25 %. The corrected criterion (D `8d1599a`, tip `51a95bc`) **polls
`active === 0` with a 90-rendered-frame cap and PRINTS the count, and polls
`skip.warp` unchanged across two reads** — 250 fade-ms being 5 frames here and
15 at 60 fps. **The 10-frame number was D's own §4.10 criterion**, corrected in
the same commit.

**C reported the same class against itself.** The depth-precision work landed as
two commits (`7dae48b` code + proof, `974ce23` ledger) because C's edit script
aborted before the ledger write while its commit ran — **the un-asserted
mechanical-edit class of §5.1, a third time in one round**, this time caught by
its author and costing only a split commit.

**One more, at the close, and it makes NINE:** E's pass-1 dev server was still
listening after CERT DONE, because that version of E's script had no PID in its
trap; the orchestrator killed the three PIDs — recorded as the orchestrator's
own, since it was the orchestrator that reached for another process. The defect
underneath was **a one-generation cleanup trap**: `npm run dev` is four
processes and the FORKED `next-server` worker was the pass-1 orphan. The cert
runner now kills by process **GROUP** — `setsid` at launch, the PGID read from
`/proc/<pid>/stat` field 5 **parsed from the last `)`**, because `$!` can name a
parent that exits while the real leader is elsewhere — TERM, 10 s, then KILL,
after which the port is re-checked and either "port released" or a warning is
printed. Proven on a throwaway `setsid` tree: three members, zero survivors —
**and proven in production at the close**: pass 2b's teardown printed *"stopping
the dev server process group I started (PGID 32314)"* and then *"port :3100
released"*, **the first of three passes to end with no surviving
`next-server`.**

Two process facts from the same hour: a second `cert-run.sh` raced the first
run's server into an `EADDRINUSE` (killed by PID 5023/5024/5038), and an
`ss`-based "is anything listening" check reported the live server absent and
stopped a good run. **Then the guard written to prevent that EADDRINUSE proved
blind in the same way**: `lsof -i:PORT -sTCP:LISTEN` does not see a live
`next dev` listener here (it shows only ESTABLISHED rows, because Next binds
dual-stack) while it happily finds a `python http.server` — the guard had been
verified against the python server, i.e. **tested against something it could
see**, which is also why the run printed "PID unknown" and left its trap with
nothing to kill. Rewritten (`dd6b332`) to ask *does anything ANSWER* (`curl`
status ≠ 000) and *who* from `/proc`, verified live: "REFUSING TO START:
something already ANSWERS on port 3100 / PID 12117 … It is not mine to kill."

**And the fleet-pin idiom bit the OTHER way.** R19's lesson was that the fleet's
own pins can hide an entire defect class from every gate; here a pin hid **the
FEATURE from its own gate** — `__flyAerialOverride = 0` means the satellite melt
never runs in a harness frame, so `verify-linear-haze` measured a world in which
the thing it certifies is switched off, and reported the result as a seam.

**And one defect no structural gate could have seen.** The toy-boot `byteLength`
error left the scene graph, the mesh counts, the draw list and every
`ready`/`chunk` number CORRECT — the geometry was fully built. **The defect
existed only in the TYPE of one object, and surfaced only when a GL context
uploaded it.** A headless attribute census is the gate for that class, and B
built one (`r24-b-attr-proof.js`): it walks every geometry index and attribute
for a missing `.array`, which is the exact shape three reads `byteLength` from,
without a GL context at all.

### 5.3 Session limits, and the one review finding that landed

The limit hit at ~16:50 and reset at 18:30 UTC. **D and E were killed mid-task**
(D coherent at `d30fc4c` with a complete ledger; E clean at `c7d538c`, settled
census undelivered, no final report), and the adversarial reviews died
mid-verification: **A 0/6 reviewers ran; C 2/6 dimensions with 0/11 findings
verified; B 12/90 agents with ONE confirmed.** The orchestrator merged all four
by direct review, re-derived C's eleven findings on the merged tree (six fixed
in `66a2f0c`, two not defects, two carried to §5b), and resumed the agents.

**The one confirmed finding was worth the whole workflow.** B's `ENV_UNIFORM`
alternate-shadow-state warm (a) ran INSIDE the boot gate, so it could extend the
reveal to the 3000 ms cap — violating a frozen rule B's own ledger asserted it
respected — and (b) **flipped the LIVE directional's `castShadow` across an
awaited compile while `frameloop="always"` kept rendering**, so every frame in
that window re-keyed every lit material and, on a slow HDRI, the user could SEE
shadows snap on and off. **A `programsDelta` gate would have read flat**: the
programs are the ones wanted; the defect is WHEN and against WHAT they were
minted. The fix (`f361543`) warms a STAND-IN scene of CLONED lights with
`castShadow` inverted, carrying the live `environment` and `fog` — both are in
three's program cache key, so a stand-in missing either mints a THIRD program —
queued strictly after `_state.done` on the idle drain. It still ships OFF.

**And a SECOND limit, at the close.** At ~23:0x a 429 (reset 23:30 UTC)
terminated **A, E and F mid-turn**, and **two of the three verification lenses on
the merge review's third finding** with them. Salvage: **A had committed
`7890d1b`** (the seventh budget site) and left three dirty files — the residency
cap in progress, resumed on the integrated tree — and **B, C, D, E and F were
clean**. **This is the third round in a row a session limit interrupted the
close** (R19 §5, R20 §5), and the first where **nothing was lost**, for one
reason worth stating as a practice: **every owner commits before reporting**, so
a killed turn costs a report and not work.

**And one the numbers gave up at the close**: `verify-lod-fade`'s ON arm renders
against **two live SwiftShader contexts**, because `ctx2` is created while the
OFF page is still open — a **systematic ~27 % frame deficit on the treated arm**,
read for a whole round as load noise, and the reason its comparability guard sat
at 0.745. The fix is one `await page.close()`. **Its sibling**: the row's own
equality gate compared two scenes that had both reported SETTLED at **different
maxZ**, so an assertion of identity was being made across a level of detail.

**E's own account of that ruling, worth keeping as written**: *"I loosened a
contract to accommodate my own instrument's error … the instinct was right and
aimed at the wrong arithmetic … five of my instrument defects were reading
someone else's value wrongly; this one was reading my OWN value at a resolution I
had chosen and then blaming the source."*

**A frozen gate outside the round's row set caught a change no R24 gate was
watching.** `verify-dusk` — R19's, untouched, never run on an R24 flipped tree
until the close — read **both `SatEnvironment` intensities scaled by ~0.868 at a
PINNED NOON**, a day-path change that has been in the build since the flips at
`ec53fd3` and that **not one of the round's eighteen browser rows was looking
for**, because the row set was built around the round's own flags. **The row set
is not the gate set**: a round that certifies its own changes can still ship a
regression that only somebody else's frozen gate can see. **The honest coda: it
was NOT a regression.** Read from source, the red is an R16 per-frame ramp
starved by a half-frame-per-second venue, with no R24 flag writing either scalar
(§4.3) — **and the round could not have known which it was until somebody read
the source.** That is the lesson either way: the gate outside the row set is the
one that asks a question nobody on the round thought to ask, and the answer is
sometimes the venue.

**And one ruling that stood for exactly one merge.** The four micro-degree
one-sun residuals were ruled a TOLERANCE question — the arithmetic was right that
4.6e-5° is float32 noise — **and wrong about WHERE the rounding lived**: it was
`toFixed(6)` in the publishing instrument, not float32 anywhere on the read path,
and the app's two azimuths are bit-identical as doubles. The loosened bound
shipped in one merge and was superseded by the next; **the gate's own note — that
a tolerance is right only if the disagreement is REPRESENTATION — is what made
the reversal automatic.**

**And one caught BEFORE it produced a number.** Before pointing `terra-live` at
A's fix, E read A's `VENDOR.md` #26 — *"the patch parks the MODEL
(`model.visible = inFrustum`), never the tile; a tile's children hang off the
tile, and a parent whose box contains an in-frustum child is itself in frustum,
so a visible tile can never be orphaned behind a parked ancestor"* — and found
that **E's own resident/visible census, added in `e1a67f8` to adjudicate exactly
this fix, tested `n.visible && !!n.model`**: the TILE's flag plus the mere
EXISTENCE of a model, **never `n.model.visible`**. Across the one fix it was
written to judge, it would have reported **`visible` unchanged while the draw
count fell by three quarters**, and the `terra-live` re-run would have concluded
**A's patch did nothing**. E's framing, kept: it is **the §6 failure mode — a
value read across an ownership boundary without the owner's definition —
occurring INSIDE the instrument written to adjudicate it**, the sixth instance
this round and **the first caught before it produced a wrong number**. The census
now requires **the model's own flag as well as the tile's and every ancestor's**
(the ancestor walk stays — R19 §5's artifact) and **reports `parked` explicitly,
because that is the fix's own number and should not have to be inferred from a
difference** (E `7129aa0`, merge 18 `9bf5f8a`).

### 5.4 Four more incidents worth the record

- **Four agents collided on one cache key.** `world-bend-fade-hill-r19` was
  about to be emitted under two mutually exclusive expressions (C's `-c24` vs
  D's `-d24`), both patching `applyHillshade` — the round-4 wrong-cached-program
  defect **arriving from a MERGE, not one author**; caught by C reading D's
  branch, resolved by `r24VariantKey` with a fixed token order.
- **A commit that did not build reached another agent**: C's `9783586` shipped
  four welded import prologues, D merged it and got `GET / 500`, C fixed it at
  `1d17a6b`. **The module resolver is the only instrument**, and the `GET / 200`
  merge-acceptance step came out of it — one second per merge.
- **A harness overwrote a record nobody can re-measure**: E's `b8b32f9` rewrote
  the tracked `scripts/r21-e-red-seam.json` — R21's LIVE-tileset RED — with
  synthetic numbers (**1,015 of 1,528 lines**), nothing failing or warning.
  Restored (`453119e`, `a996b9e`) behind three defences: the restore, an
  fs-level write redirect under the fixture env, and an OUTCOME gate.
- **The CRLF rewrite**: `npm uninstall three-tile` rewrote `next.config.mjs`
  (**72 → 0** CRLF lines) and `package.json` (**58 → 0**) to LF, turning a
  13-line change into an 8.4 k-line diff. Restored by hand in `4bedab1`; a
  preserve-line-endings rule went round-wide (599 CRLF files, no
  `.gitattributes`).

**A push gated on nothing (the orchestrator's own).** A's branch predates E's
`59b4e97` and re-added `import { budgetK }` at `sat-road-engine.js:21`, where the
integrated tree already imports it at line 2; the hunks are DISJOINT, so **git
auto-merged them into a duplicate declaration** with no conflict to resolve. The
orchestrator's shell chain then **pushed `66ad406` BEFORE reading the gate line**
— *the chain's exit status was `tail`'s, not the gate's* — so a tip that fails
import-integrity (**"Identifier 'budgetK' has already been declared"**, which
would fail the app's own compile) sat on the remote for **about two minutes**.
Fixed in **`9bcaace`** (dedupe; **node smoke 17/17**, import-integrity 4/4,
finalize-pace 22/22), and **the push is now gated on the literal string `"17 passed, 0
failed"`**. Two takeaways, the second being the structural one: **a push chained
after a gate in one shell line is a push gated on nothing** (it pairs with
lessons 16 and 54), and the fix for the duplicate-import CLASS is that **an owner
merges the integration branch into their branch BEFORE new work**, so a collision
surfaces in the owner's worktree instead of in a merge nobody has to resolve.

**A cleanup that killed its own shell (the orchestrator's, and the second of its
kind).** The compile-proof cleanup located the spare dev server by cwd plus the
text `"next dev"` in `/proc/<pid>/cmdline` — **which also matched the bash
running the command, because that command line contained the words it was
searching for** — and sent TERM to its own process group (**exit 144**) before
the push line ran. It is the same trap as the earlier `pgrep -f` self-kill
wearing a different face. Fixed by matching **`/proc/<pid>/comm`** (`node` |
`next-server` | `npm`) and **never cmdline text**; the push then went out gated
on the recorded smoke line.

**A commit that landed without its ledger, from a lesson already written down**
(C, self-reported). `446545b` was committed **without** `1a28ab9`: the edit script
asserted on a heading the merge had rewritten with backticks and **aborted before
writing**, but the `git commit` on the next line **ran anyway, because the two
were joined by a NEWLINE instead of `&&`**. It is the same class as the
`7dae48b`/`974ce23` split earlier this round — *"the lesson had been written down
and not applied"* — and the ledger followed in `1a28ab9`, made as a single `&&`
chain.

### 5.4b Three from the close itself

- **The dry-run merge of the five flipped branches** produced ONE resolvable
  conflict (`FlyEffectComposer.jsx`: A's `registerComposer` and C's
  `installDepthProbe` effects, both kept) and node smoke **16/16 except three of
  D's key-expectation gates**, which had spelled `-a24` / `-l24` literals while
  the flipped tree's hill key is `world-bend-fade-hill-r19-ef24` — C's tokens.
  D is making them compute the expectation from the live token states. **A gate
  that spells a key it does not own is a coupling gate, not a key gate.**
- **D signed off E's corrected LOD ON leg** (`r24/e f7fe5f2`, "mapping
  correct"), noting two places where E went beyond the spec: `waitUntil`
  evaluates BEFORE any wait, so an empty sweep returns frames 0 rather than
  hanging, and `waitFrames` was DELETED rather than left for the next person.
  D's non-blocking note, which E is writing into the leg: **the leg's warp
  safety is a property of the 45 s `LOD_SETTLE_MS`, not of the `skip.warp`
  poll.**
- **The record's own author hit lesson 20.** While folding §4's prose into its
  cells, one cut's end-marker matched PAST the block it was meant to bound and
  took §4.3, §4.4 and §4.5 with it. A per-section line census before the commit
  caught it — the numbers did not add up — and all three were restored
  byte-verbatim from `HEAD`, so the committed diff contains only intended
  removals. **A mechanical edit whose match is not asserted is the same defect
  in a document as it is in a module** (F SCRIBE).

- **Two venue notes from the early merge, both about launching a server.**
  Turbopack **refuses a symlinked `node_modules` that points outside the project
  root** — `TurbopackInternalError: Symlink node_modules is invalid, it points
  out of the filesystem root` — so the round's standard worktree idiom does not
  compile; a **hardlinked copy (`cp -al`) works, with no extra disk**. And the
  forked `next-server` worker **outlived a process-group TERM again**, because
  the `setsid` wrapper had already exited and its `/proc` stat was gone, so the
  PGID could not be read back; it was killed by cwd match instead. **The PGID
  must be captured AT LAUNCH** — E's cert-run does, the ad-hoc launch did not.

### 5.4c A retraction A wrote against itself

`STEP_SAFE`'s rig header claimed the r3f catch-up was free, "because Chromium
does not reallocate on an unchanged `canvas.width`" — **never measured, and the
HTML spec says the opposite**. So **the second writer was written down in A's own
header and argued away with an unverified platform claim instead of counted**,
and the pass-1 row that found it was reading a defect the design had already
described. Both headers now carry the retraction, and the count replaced the
argument (§4.2).

### 5.4d Three dry-merge rulings

The close's merges were rehearsed in a scratch worktree (`r24/dry` on `ec53fd3`)
and produced two conflicts worth recording, because both are the shape where
"take theirs" would have shipped a regression.

- **B's `45e2cde`** conflicted in `sat-building-engine.js` and
  `sat-skyline-engine.js` **on the import line**: the integration tree already had
  `markPhase` imported at line 1 (A `70b9f42` / B `12bb3f1`) and B's branch
  re-added it beside its new `rampT`. **Ruled: take `rampT`, drop the duplicate
  import** — a second binding of the same name is a SyntaxError, which
  `verify-import-integrity` would have caught, but after the fact.
- **E's `d9e5d57`** conflicted in `scripts/verify-terra-live.js`: A's `5ddf5dc`
  had made **BOTH arms pin `__flyTerraPaceOverride` explicitly** — the constants
  ship ON, so an unpinned "off" arm would silently BE the treatment — and added
  the `__fxYaw` arc read, while E's branch never had that hunk, so E's version
  would have **regressed the off arm**. **Ruled: keep both** — A's both-arms pin
  plus E's page-error hook, returning `yawArc` AND `errNote`.
- **C's `ee10642`** conflicted in `components/fly/AerialPerspective.jsx` **on the
  import block**, three owners having edited the same four lines: D's atmo-law
  block, C's new `linearHazeOn` import, and the integration tree's
  `import { AERIAL_LAW, DEPTH_FIX }`. **Ruled: take all three, and DROP the
  `LINEAR_HAZE` import** — C's change removed the file's only raw read of it, so
  keeping the binding would have left an unused import that reads like a second
  law still being consulted.

**The dry merge completed at `847a816`** = `ec53fd3` + E `c4f2747` + A `e7325cd`
+ B `45e2cde`/`b459056` + C `ee10642` + D `1083168` — **ten merge commits, 36
files, +3502 / −170**. On it: `verify-c-flagoff` **40/40**, import-integrity
**4/4**, node smoke **16/16**, B's census **BROKEN=0** (it was RED at 80 before
A's fix), and a tree-wide grep for readers of `LINEAR_HAZE.enabled` finds **the
accessor and nothing else**. The real merge runs in the order **E → A → B → C →
D** after pass 2b's last row, with the three rulings re-applied identically. E is
pre-wiring the linear-haze A/B behind it: **both arms pinned explicitly** (the
constants ship ON, so an unpinned "off" arm would silently be the treatment —
the `terra-live` ruling generalised), `aerialGate > 0` asserted on both, and the
RED being *both arms pinned off must not pass* — landed as `18bd5eb`, which
moves the dry tree to **`e6227c4`** with the node gates unchanged.

### 5.5 Ledger disagreements, resolved

Four numbers differ between ledgers because they were measured on different
trees; the **later-dated** one is what to quote. (1) The `pinned` line number —
A says `CloudField.jsx:78` (on `r24/a`), the integration sweep says **82** (on
`bf319ca`, after four merges). (2) The `offsetUnits` line number — C says
`FlyScene.jsx:351`, D's §4.95 says `:373`, the sweep says **381**. (3) A's
traversal cost — A §3 reports visits/walk 36 → **74** and 4,230 → **3,431** for
the residency trio alone, A §6 reports 36 → **233** and 4,230 → **10,891** with
`walkWhileSaturated`; both are correct for their arm and §1 quotes the chain.
(4) Which process inventory works here — the mid-round rule "`lsof` works, `ss`
does not" was right about `ss` and **wrong about `lsof` for a `next dev`
listener** (E's later `dd6b332`); neither is authoritative, ask whether the port
ANSWERS. A fifth, smaller: E's §1.2b four-pose census (Manhattan 110 draws /
Powell 131 / Owens 152 / Melton 68) predates the budget scaler and the settle
predicate and is superseded by §4.4 (176 / — / 184 / 153); only §4.4 is
quotable.

---

## §5b Follow-ups

- **`ENV_UNIFORM`** ships OFF; the stand-in fix is in, but the flip still needs
  the `programsDelta`-flat run across a forced dusk crossing AND a forced
  high↔medium step with `__flyGovPin` and `__flySatShadowOverride` both released,
  plus a twilight fixture A/B (noon is bit-identical by construction, twilight is
  an upsample).
- **`RING_DEDUPE`** needs a roof RE-CERTIFICATION, not a hash re-baseline —
  `verify-roofs` (394/2985), `verify-roof-variety`, `verify-window-grids` (403)
  and `verify-neon-city` (379) all stand on roof-form outcomes that move with the
  restored corner count — plus a live worker-hash re-baseline.
- **Restore the skyline's first corner** (B, ledger §15.1): the collinearity walk
  that saves the skyline from the flash defect also discards `ring[0]` with the
  closing clone, so **every z14 block-mass ring silently loses a genuine
  corner** — a different bug, measured by no gate but measured by B at Manhattan
  sat-skyline **4,570 → 6,015 verts (+31.6 %)** under `RING_DEDUPE`, which IS its
  fix and is built-but-off because it moves `WORKER_PROTOCOL`, `verify-skyline`'s
  frozen numbers and the roof-form dispatch. Next worker round.
- **`AERIAL_LAW`**: the one-time horizon pixel-gate re-baseline batch (C's L1 +
  D's law, ONE batch, with a fixture column) was never executed and no pixel A/B
  exists at any pose; the content and air/anchor variants are unbuilt; the
  C-off/D-on rim seam at 60–120 km needs one fixture pixel A/B.
- **`LOD_CROSSFADE`'s ON leg**, which pass 1 proved the gate could not produce
  (§4.2): the pinned leg (`{ enabled: true, skipBootMs: 0 }` — the shipped 6000
  fade-clock ms is 120 rendered frames, longer than the whole sweep at 1–3 fps)
  settles ≥ 20 rendered frames after the warp, warp suppression being 900
  fade-ms = 18 frames, and asserts the §8 criteria.
- **`window.__flyDepthProbe` + `window.__flyDof`** (C, `DEPTH_FIX`) if pass 2
  cannot land the hook: without it `verify-depth-roundtrip` stays NOT RUNNABLE
  and the browser round-trip of the depth fix has no evidence at all.
- **`FRAME_STEP` consumer opt-in**: four call sites (`PlayerPlane.jsx:74`,
  `lib/fly/chase-camera.js`, `Contrail.jsx:146-148`, `PlayerGroundShadow.jsx`)
  and the certification list in A's ledger §8c.
- **Built-off, one real-hardware run each**: `skirtWorker`, `bendSphere`,
  `TERRAIN_LIGHT.workerNormals`; cross-tile normal agreement additionally needs
  the decode to RETURN the raster and its side length, read from the payload and
  never assumed to be 257.
- **`verify-shadow-calm`'s browser half** — the catcher's +1 draw in cities and 0
  at Owens, the sparkle temporal std, the acne A/B at `normalBias 1`. The node
  gate proves the string edits and the arithmetic; it cannot prove a pixel.
- **RED-calibrate the rewritten pale detector** (`e1b7905`): a synthetic
  one-frame jump must score exactly one hit, a serpentine zero. **Re-run the
  rewritten seam reader** (linear-haze) in pass 2.
- **`verify-terra-live`'s content probe should count and report SKIPPED tiles**
  (one line): its denominator was 62 of 64 because it only tests tiles whose
  material already has a map, and the two it skipped were mid-load — the
  likeliest moment for a mismatch.
- **Audit every fixed-millisecond frame-time comparison in the codebase**
  (A's ask, next round): `FINALIZE_PACE`'s was the one that starved, but a
  threshold on an absolute frame time is a threshold on the user's hardware
  wherever it appears.
- ~~`sat-veg-engine.js` veg cap~~ **CLOSED before pass 2b** (E `59b4e97`, merged
  `ec53fd3`): the **sixth** harness-budget site is now
  `cap = finalizePaceOn() ? Math.max(1, FINALIZE_PACE.vegPerFrame * budgetK()) :
  Infinity`, **exactly 1 in production**. Worth keeping for the pattern: A's
  `verify-finalize-pace` gate 10 had pinned the OLD expression verbatim and went
  RED **correctly**, so E moved the assertion WITH the expression — it now
  requires the multiply AND the harness-budget import — 11/11, recorded as E's
  edit to A's engine and gate at A's request. Expect veg counts to move in pass
  2b's fixture row for this reason and not a feature change.
- ~~`SURFACE_CALM` imported at `FlyScene.jsx:120` and used nowhere~~ **CLOSED**
  (C `2e1d700`, `r24/c` fast-forwarded to `9bcaace` + 1, held for the
  post-re-take batch; import removed, **0 occurrences**). Pre-existing at
  `ec53fd3` — `fd7d28d` replaced the `SURFACE_CALM.depthOffsetFix` polygonOffset
  expression and left the import behind — found by the merge review's lost-hunk
  sweep, **not a merge defect**. Worth keeping: **the RED had to be asked for
  explicitly** — `npx eslint --rule '{"no-unused-vars":["error",{"varsIgnorePattern":"^_"}]}'
  components/fly/FlyScene.jsx` → **120:3 defined but never used**; GREEN 0,
  default eslint 0/0, grep 0. C's node gates on the merged tree: c-flagoff 40/40,
  shadow-calm 33/33, depth-offset 7/7, worker-normals 12/12, four proofs,
  import-integrity 4/0.
- **R25: re-author `SKY.altAtmo`'s tod rim keyframes against the DOME's measured
  linear horizon colour, per bucket, ON THE USER'S MACHINE**, with **verify-rim,
  sat-depth, sat-night and dusk re-certified together, because the triple has
  four consumers** (§4.2). The decoded night target renders 38.2 against a dome
  at 79.6, so it must go UP — but the value is a measurement and not algebra (the
  chain runs through `maxMix` 0.55, ACES and the grade), and the venue's
  synthetic sky is the wrong instrument to author it on.
- **A shared-DEM request coalescer** — OFFERED by A and **DECLINED for this
  round on A's own grounds** (it is on the critical path and it changes request
  timing): one in-flight fetch per ancestor URL with four consumers, for a real
  **~4× cut in DEM traffic past z15**, where today four z16 children of one z15
  tile each issue the same clamped ancestor URL (§4.2). New work, needing a
  measured decision.
- **A real fade for the road layer** (B, scoped): the road engine's shared
  `MeshBasicMaterial` declares `__noFade` today, and giving it a real fade needs
  a `verify-sat-night` sanction first — *"putting a load-decided coin into a
  frozen gate at close is the trade §7.6 already refused."*
- **An informational STATIONARY leg for the heal path** (E): a Sierra hold
  (36.578 / −118.29, 394 m over 3 km), pinned once, ≥ 20 frames so `_pumpRedrape`
  drains, reading `healsInPlace` against `redrapeRuns` and treating
  `healsAborted` as a correct outcome — the serpentine cannot exercise it.
- **Four pre-existing `react-hooks` errors in `FlyEffectComposer.jsx`** — 4
  before and 4 after C's truth hook, verified by stash, so the round added none;
  noted because a future `eslint` sweep will meet them.
- **Publish a `FLASH_GUARD` counter on `__flyStats`** (B): the re-take's green
  rests on the harness's own census because `FLASH_GUARD telemetry` reads null —
  the runtime pin and the constant are different switches — so the gate cannot
  read the feature's own number.
- ~~`copyFileSync` imported at `verify-finalize-pace.mjs:24` and unused~~
  **CLOSED** (A `c573d08`): pre-existing at the base, confirmed by one lens
  before the 429 took the other two.
- ~~THE SEVENTH BUDGET SITE~~ **CLOSED** (A `7890d1b`, merged `66ad406`, fixed
  `9bcaace`): offered by E and NOT taken by E — routed to A.
  `sat-road-engine.js:526` bounded its finalize with a module const
  `FINALIZE_PER_FRAME = 1` that was **not multiplied by `budgetK()`**, while
  every other engine reads `perFrame × budgetK()`. At K = 40/200 every other
  engine speeds up and **roads does not**, which starves the road ring and
  **concentrates the stall exactly where the phase marker points** — pass 2b's
  frame-pace row stamped its last 3660 ms stall `[finalize:sat-roads ×16]`. Same
  one-line idiom as the veg site (`59b4e97`). Shipped as
  `Math.max(1, FINALIZE_PER_FRAME * budgetK())`, `verify-finalize-pace` **21 →
  22** with the site-count gate at **6 → 7**, product path byte-identical because
  `budgetK()` is 1 in production.
- ~~Residency needs an eviction policy with a cap~~ **CLOSED** (A `dead5e5`,
  pushed in `83462eb`): `parkOffscreen` stops issuing off-frustum tiles and
  `maxResidentTiles` **260** is the trigger that binds, the byte cap having
  elected nothing at 113.7 MB (§3 A). **What remains is a MEASUREMENT, not a
  fix**: E's `terra-live` at 900 s on A's tree decides whether Owens lands under
  261, and if it does not, the lever is `LODThreshold`, not a re-baseline.
- **Every per-frame REFUSAL must have a starvation bound, and every pacing rule
  must be reachable with the harness budget on.** `finalize-pace.js`'s header
  asserted an invariant it did not have — "neither rule can starve a chunk" —
  and a fixed-threshold refusal starves forever on a steadily slow machine. Two
  standing checks come out of it: a refusal rule states its bound (or carries a
  `maxRefuseFrames` cap) and compares against the machine's own baseline rather
  than a constant; and **the content-gate list in close sweep §1.5 is the
  checklist** — anything on it must be reachable with the budget scaler on.
- **A toy leg for the degenerate census** — no row this round boots toy, so
  `vector-tile.worker.js:4285` has node evidence and no certified browser leg.
- **`verify-terra-live` on a real GPU.** The FIXTURE column is in (§4.2: merges
  1 → 0, refetchParent 1 → 0, Owens 161 → 185 ≤ 261, Powell 161 → 183 ≤ 375),
  the URL↔position half is answered (0 mismatches in both arms) and gate (6) is
  attributed to the instrument; what remains is the live draw evidence, plus
  **E's two confirmations for pass 2 — the per-prefix breakdown of the repeat
  fetches, and a reset made atomic with the pin** — and a harness-only
  sweep-length env so the full 360° arc runs in this venue.
- **The skyline park/unpark pixel A/B** at Manhattan — the one hypothesis row in
  B's mechanism table.
- **`hill.dayK 0.65`** is a PROPOSAL, and shipping 1.0 keeps the demotion
  built-and-off by construction. The v1 Sierra A/B produced 13.961/255 and was
  DECLARED INVALID by its own author (|Δ| rose monotonically with capture order —
  a streaming world and an animating cloud deck inside the crop); instrument v2
  (parks every mover, interleaves controls, prints a drift floor, refuses a
  margin when it is unreadable) is committed and unrun.
- **`LADDER_FIX.nativeRefresh` has no measurement behind it** (§6 item 4) and
  recon FL-04's question — native refresh, or a 60 Hz cap? — is unanswered. The
  revert is one word.
- **Toy/Neon chunk births (`uBirth`)**: not shipped, design in B's ledger §9;
  likewise the roads/toy in-place heal (grid-delta variant) and the sat-roads
  birth fade, which needs a sanctioned `verify-sat-night` contract move.
- **Attribution string follows `x-adsb-source`** — carried from R19.

---

## §6 User checkpoints — ALL PENDING

**THE USER-MACHINE TALLY, plainly: NOTHING has been confirmed from the user's
machine this round.**

- **The diagnosis pack was sent, and no reply arrived.** Part A and the four
  questions in Part 0 are still unanswered, so the round ran on the plan's
  defaults for which build showed the symptoms, which symptoms were present,
  what the machine is, and which style was in use.
- **`main` was fast-forwarded TWICE at the user's own request** — first to
  `9bf5f8a` (*"Merge what is done so far into main so I can test"*), then to
  `a7a8739` (*"Merge into main"*) — **and both builds were in the user's hands
  with no report back.** `9bf5f8a` was the first build carrying the toy index
  container fix and the `STEP_SAFE` resize guard; `a7a8739` adds A's Owens
  residency fix, C's night hill ruling and C's nine-decimal publish.
- **Every number in this record is the SwiftShader fixture's.** No fps, no frame
  time, no stall count, no tear observation and no pixel judgement in §4 comes
  from a GPU. The container renders at roughly 1 fps through ANGLE/SwiftShader,
  the tile hosts are 403-blocked, and Chrome is absent — so "CERTIFIED ON THE
  VENUE" means a fixture proved a mechanism, never that a machine felt better.
- **The checkpoints below stay OPEN, each with the exact question it needs
  answered.** A checkpoint closes on the user's reply; it does not close because
  a build exists, because a gate is green, or because a mechanism is proven.

**The build to test is `a7a8739` on `main`** (integration runs ahead of it with
scripts and ledgers only; §4.1 carries the merge list).

| # | Checkpoint | What to look for |
|---|---|---|
| **1** | **THE DIAG PACK FIRST** — Part A on the build you have now, THEN on this build | stalls/min, worst dt, p99, and the per-second `dReady` / `adds` / `removes` deltas during a 30 s low serpentine. **This is the round's RED; without it there is no before** |
| **1b** | The four questions in Part 0 | which build(s) showed it; which symptoms (a crossed-out symptom is as useful as a ticked one); the machine facts; which style. All four are still unanswered, and the round ran on the plan's defaults |
| **2** | Buildings appearing/disappearing — Powell → Columbus at 200–400 m AGL, turning hard | nothing pops in one frame at the ring edge; nothing vanishes behind you while still on screen; heals do not blink |
| **3** | Tiles swapping — a slow 360° yaw at a parked pose, then the serpentine | the field behind you stays refined; no coarse parent replaces four children in view; refines dissolve (if `LOD_CROSSFADE` is ON). **Live, a merge swaps in a DIFFERENT Esri CAPTURE — season, sun, colour — which no fixture number can show**, so your eyes are the only instrument for how violent it looks |
| **4** | **`LADDER_FIX`, two questions.** The taste one: softer-under-load (0.875 / 0.75 render scale) vs a tier hitch — is the softness acceptable? `__flyGov.state()` shows the rung. And the **unmeasured** one: `nativeRefresh` ships ON per plan §0 ruling 6 with **no measurement behind it** — an exact no-op at 60 Hz (`min(60, 60)`), but on a 120/144 Hz display it raises the governor's target and recon FL-04's question is still open. **The revert is one word** | does a 144 Hz machine feel better targeting 144, or is a 60 Hz cap preferable? |
| 5 | Linear haze + one sun: noon and dusk horizon vs R21; the Neon rim melting to `#1a2246` **as authored** | **the day seam NARROWS (the venue measures ~6 luma) and a seam REMAINS** — the residual is the rim re-tune C refused this round, so say whether the horizon reads better BY DAY and whether the night seam is acceptable; the key light moves with the sun on medium too. The Neon rim is ~89/255 darker at the melt, and that is the fix, not a regression |
| **5b** | **Moonlit satellite nights** — the ground relief is now shaded from the MOON's direction, like the buildings are (C's close ruling, §3 C) | at full moon the hill and the key agree exactly; relief stays readable (hill el 34.377°, inside the [8.6°, 51.6°] band). **Daylight is bit-identical by construction** |
| **5c** | **The satellite horizon band, by DAY and by NIGHT** — the one look question C refused to answer on a synthetic sky | is the seam better by day (the venue says −6.8 luma), and **is the night seam acceptable**? If it is not, R25 re-authors the rim keyframes against the dome's measured horizon colour — per keyframe, since the decode keeps 80 % of a bright value and 13 % of a dark one |
| 6 | Shadows: catcher on in cities, sparkle gone, floating fixed | shadows land on the ground; edges do not crawl in motion. **No browser gate covers this** |
| 7 | `hill.dayK 0.65` — try it | 1.0 ships (no demotion, frozen margin untouched); does 0.65 read better on photo ground? |
| 8 | `LOD_CROSSFADE` look and skirt cliffs | dither-free blend; shorter darkened skirts. **The two questions no fixture row can settle**: does a 250 ms blend read as smooth or as MUSH at your refresh rate, and does the crossfade actually remove the tile-swap symptom — or does it leave the RELIEF snap, which a texture blend cannot morph? |
| 9 | Lit clouds, tamed Lambert env, and the DoF band that finally exists in Neon | puffs have a sun side; buildings stop mirroring the sky; the tilt-shift is a band, not a flat 18 % |
| 10 | **Performance feel through all of the above — FIRST, not last** | the R20 §6.15 lesson |
| 11 | **If a real tear line is still there, film it** | tearing is a compositor/vsync property no JS timer or screenshot can observe, and the gates assert the MECHANISM only. **A phone camera pointed at the screen beats a software recorder, because a recorder composites** |

Carries forward the still-open R15–R21 §6 tables.

---

## §7 Lessons

1. **A census run at speed 0 cannot see a lookahead defect** — measure the
   trigger at the speed the user flies. R21 closed P1 on an orbit census where
   the lead is exactly 0.
2. **A pooled instanced layer culls as ONE object**; its pad is a whole-suburb
   contract, not a per-item one.
3. **A frozen-number fix one layer down**: three flips the reversed-depth sign
   in the branches it thought about (VSM/BASIC), not the one you use (PCF) —
   R21's `polygonOffset` defect, one library level lower.
4. **"Correct" and "certified" are different claims, and only the second is a
   merge gate** — `RING_DEDUPE` restores a real corner and moves four certified
   gates' roof forms; the toy flash site has node evidence and no browser leg.
5. **A smoke that skips everything and exits 0 is the R20 false-green shape** —
   zero passes must be a failure. (E CERT.)
6. **A per-frame budget is a per-frame-RATE contract**; at 1 fps it is a
   different product. Scale it for content gates, never for pacing gates.
   (E CERT.)
7. **`pkill -f <pattern>` kills the shell whose command line carries the
   pattern** — a process NAME is not an identity in a shared container. **It
   recurred at the close in a different face**: a cleanup matching cwd plus the
   text `"next dev"` in `/proc/cmdline` matched the bash that was running the
   search and TERMed its own group. **Any search that can see your own command
   line will find it — match a process by what it IS (`/proc/<pid>/comm`), not
   by what it was asked to run.**
8. **A route-fulfilled tile can starve the loader and freeze the quadtree** — a
   fixture must be a SOURCE, not a proxy, for anything with a concurrency rule.
9. **A valid import is not a correct import.** A scripted specifier insertion
   welded four files' imports; ESLint passed and only the module resolver saw it.
10. **A per-tile normal field is still per-tile**: smooth normals inside a tile
    do not agree across a Martini-error boundary, and the decode must return the
    raster — reading its side from the payload, never assuming 257.
11. **A fixture run that writes where a live gate writes REPLACES a record
    nobody can re-measure.** A mechanism can be bypassed by the next harness; an
    OUTCOME check cannot.
12. **A determinism pin and a ship-state visual can be the same switch.** The
    satellite key-light write lived inside the shadow gate `_boot.js` pins to 0,
    so the whole fleet certified a world lit by a constant — `live:false`,
    key↔hill 10.50°.
13. **"Settled" is a condition, not a duration.** A sleep-and-count gate at
    1–3 fps counted coarse z5 drapes as a built city. (E CERT.)
14. **Node gates source-parse and cannot see a broken import.** A dev-server
    `GET / 200` is a merge-acceptance step now.
15. **A crossfade under a clamped `dt` is a FRAME count, not a wall duration**,
    and a per-material `maxConcurrent` counts MATERIALS — a refine arming four
    means 12 was only three refines. (D ATMOS.)
16. **A module-scope reference to an unimported symbol takes the whole chunk
    down in every style, and no flag can gate it.** Lint the delta for
    `no-undef` before any browser gate: a node-only check costing a second that
    would have saved this round's certification run. (The gate is E's.)
17. **An agent's browser evidence is DATED.** A commit made after the last boot
    is unbooted code, and a timeout on an unbooted tree is the signature of the
    breakage, not of contention.
18. **An instrument must never be the FIRST to ask for a resource the subject
    owns.** A canvas has one context and the first caller decides its
    attributes. (E CERT.)
19. **Fixing the right bug and explaining the wrong failure are different acts.**
    A real `getContext` race was fixed and initially offered as the cause of the
    void rows; it was not, and saying so is what made the record correct.
    (E CERT.)
20. **Every mechanical edit needs its own assertion.** `String.replace` on a
    miss is a silent no-op, and two agents shipped a helper without its import
    from exactly that shape, hours apart. (A PACE and D ATMOS.)
21. **The fleet had ~60 browser gates, a dozen node gates, and no gate at all
    for "can the app EVALUATE"** — unowned because it belonged to no feature.
    The questions nobody's feature raises are the ones that take the whole chunk
    down. (E CERT.)
22. **A guard is only as good as the question it asks, and a test that passes
    against something the guard CAN see proves nothing about the thing it
    cannot.** The port guard was verified against a python server and was blind
    to the `next dev` listener it existed to catch. (E CERT.)
23. **A gate that EXECUTES the thing beats a gate that READS it.** Refactoring
    the shadow patch into a pure function let a node gate run it against three's
    real chunk text — "here is the GLSL three would receive", not "the code looks
    right" — and it found a defect in its own module on the first run. (C LIGHT.)
24. **A gate that passes without asserting anything is indistinguishable from a
    gate that works** — read the PASS lines as sceptically as the FAIL lines.
    Four in one day: flash-guard (5) printed `pinned=n/a`, one-sun (5) did the
    same shape, linear-haze passed "RIM SEAM ≤ 12/255 Δ 0.0" on black against
    black, and depth-roundtrip (0b) asserted "the DoF pass is present" from style
    and tier while its own `dof` read null. **A downstream assertion must go NOT
    CALIBRATED when its precondition fails**, never green. (E CERT.)
25. **Ask an instrument what ELSE could produce this reading.** The pale
    detector's 168 hits, the Sierra A/B's monotone-in-capture-order margin, the
    `getContext` probe, the lsof port guard: every one was an instrument that had
    not been asked that question. (E CERT.)
26. **An unpinned control arm silently becomes the treatment the day the flag
    ships.** `verify-ladder-fix`'s RED arm and `verify-terra-live`'s arm A both
    OMITTED the pin; both now state the state they want in both directions, and
    the ladder-red row proves the hardening holds. (A PACE.) — **Three
    independent instances landed this round**, which is why it is a family and
    not an incident: A's both-arms pin in `verify-terra-live`; A's
    `FLY_LADDER_RED` forcing both features OFF rather than omitting the pin
    (*"an omitted pin is the SHIPPED state, and the RED arm would have gone
    quietly green while claiming to calibrate against the defect"*); and E's
    linear-haze A/B pinning both arms explicitly. It is the same defect as
    `?? 0` on the Owens lock and `v == null ||` on a ceiling wearing a third
    face: **an absent value inheriting a meaning it was never given.**
    (E CERT.)
27. **Ship state and behaviour are two claims and need two gates.** A flag
    silently reverted to false would leave every behaviour gate green while the
    fix was gone from the build — hence a gate that reads the block's literal out
    of the constants file. (A PACE.)
28. **A gate that asserts a flag is off FOREVER goes red the day the feature
    ships, which trains people to edit gates.** The durable invariant is that the
    state is DECLARED and LEGAL and the RED counter works in either state, while
    the source properties (false branch = R21 verbatim; the variant key is bare
    when every token is false) keep proving the round is one flag flip from R21.
    (D ATMOS and C LIGHT, independently; the anti-rot for R20 §7.)
29. **A criterion the record cites must be the one the gate asserts.** D struck
    its own "`hardSwaps` flat at 20" from the `LOD_CROSSFADE` go/no-go once the
    counter turned out to PARTITION events rather than count them. (D ATMOS.)
30. **Never compare counters across poses.** The 20 that nearly became a
    shipping criterion was measured at a different pose from the ON leg's.
    (D ATMOS.)
31. **A mirror of a formula is proven by EXTRACTING the formula, not by
    re-deriving it.** The depth proof pulls both return expressions of three's
    `perspectiveDepthToViewZ` out of the installed build and compares them with
    the JS mirror bit-for-bit, so the mirror cannot carry its own copy of the bug
    and goes red the day three changes. (C LIGHT.)
32. **A frame-count settle is a venue constant, not a duration — poll the
    condition and report the frames it took.** Ten rendered frames is 500 ms at
    1–3 fps and 167 ms at 60 fps, so a hard frame-count drain fails on a healthy
    machine; the corrected leg polls `active === 0` under a 90-frame cap and
    prints the count. The 10-frame number was D's own criterion. (D ATMOS.)

33. **A gate must not assert what another owner ships.** Three of D's gates
    spelled `-a24` / `-l24` literals and went red the moment C's tokens were on;
    rewritten, each forces only its own token, calls the same `r24VariantKey` the
    material calls, and asserts the property plus a 16-state order sweep —
    because token ORDER is the contract. And a gate must mirror the SOURCE
    predicate, not a shorthand for it: `e` is `ONE_SUN.enabled ||
    TERRAIN_LIGHT.enabled`, and the shorthand would have passed on a tree whose
    key was right. (D ATMOS.)
34. **A wall-clock sweep at 1 fps is a different experiment — pin the
    instrument to rendered FRAMES and assert the arc it achieved.** The harness's
    yaw stepped ~51° per rendered frame here, so tiles entered and left the
    refine set inside one download round-trip and upstream discarded them; the
    gate was measuring the venue's step, not the feature. It now steps
    0.85°/frame inside a rAF and prints SKIP / NOT CALIBRATED when the arc falls
    short. **Addendum: the fleet had TWO wall-clock sweeps, and the second was
    found by the first's fix** — `verify-lod-fade`'s `START_YAW` runs 720° in
    40 s, the same ~51°/frame regime, and its (6) and (3) were reading the
    instrument as well. (A PACE and E CERT.)
35. **A pacing rule that compares to a fixed threshold is a LEVEL detector; a
    hitch is a SPIKE.** Compare to the machine's own baseline, and cap any
    refusal so it can never become starvation. `FINALIZE_PACE`'s 24 ms threshold
    refuses the first finalize of every frame on anything steadily below ~41 fps
    — buildings that never appear, on exactly the machines that report symptoms.
    **The venue that certifies content found it because it is the slowest machine
    there is.** A corollary from the same run: the harness budget must cover
    EVERY pacing rule, not only the count budget — W1's scaler found the count
    budget, the close found the wall-clock one. (The orchestrator and E CERT,
    jointly.)
36. **A threshold on an absolute frame time is a threshold on the user's
    hardware.** Every fixed-millisecond frame-time comparison in this codebase
    deserves the same question `FINALIZE_PACE`'s got, and the fix generalises:
    compare against the machine's own recent history, exclude the frame under
    test from that history so a hitch cannot raise its own threshold, and cap the
    consequence. (A PACE.)
37. **A green "exactly zero" with an EMPTY population is a void row, not a
    fix.** Every "exactly zero" gate needs its population gate in FRONT of it —
    `verify-flash-guard`'s (3) printed "PASS zero=0 tris=0" on an empty census
    twice, in two different runs, for two different reasons, and only the
    preconditions added after the §2.10 audit kept it from being read as the fix
    landing. (E CERT, from the gate's own header.)
38. **When a feature publishes a probe handle, the gate must read THAT handle —
    a gate that guesses channel names certifies its own guess.** `verify-fade`
    looked for four `material.uniforms` names and a transparency pair, while
    `CHUNK_FADE`'s uniform arrives through `onBeforeCompile` and was deliberately
    exposed at `material.userData.__fadeU`, documented in the code and listed in
    the owner's hand-off table. The gate reported "no fade" about a fade it was
    not looking at. (B WORLD and E CERT, jointly.)
39. **A time-only ramp is a frame-rate assumption — floor every ramp in FRAMES
    so the slowest machine still sees the transition.** A 0.3 s evict ramp is 18
    frames at 60 fps and less than one at 2.84 s per frame, so every death reads
    hard on a slow machine no matter what the budget says; `progress =
    min(elapsed/sec, framesSince/minFrames)` guarantees three partial samples at
    any rate, leaves 60 fps unchanged, and stops a hitch train skipping a fade
    entirely. (B WORLD.)
40. **A label written first-wins reports the first thing seen, not the thing
    that matters.** `verify-fade`'s channel label used `??=`, and the first mesh
    sampled is almost always one at rest — so even with the right handle read,
    the row would have reported "presence channel = none" a second time. Label by
    the most specific evidence in the WHOLE window, and make the self-test that
    exact sequence: rest sample first, ramp sample second. (E CERT.)
41. **An inequality invariant hides the outcomes it does not name.** B's heal
    gate asserted `healsInPlace + healsNoop ≥ heals`, and a heal can end five
    other ways — budget spent, chunk evicted under the job, water-only, coalesced
    with a re-drape in flight, or still draining. Enumerate every outcome and
    assert EQUALITY, so a residual is attributable rather than absorbed by the
    slack. (B WORLD.)
42. **A number read across an ownership boundary, without its owner's
    definition, is not evidence.** "heals 9" read as holes, "presence channel =
    none" read as no-fade, "refines NaN" read as a threshold — one error, three
    times. **Every cross-owner counter a gate reads must be read with the owner's
    published rule printed beside it**, and a gate that cannot find the rule must
    say "unpublished" rather than fall back to the total. **Addendum: the rule
    runs BOTH ways — a gate must also WRITE a handle by the owner's definition.**
    `verify-one-sun` and `verify-linear-haze` wrote `{ elDeg }` to
    `__flySunOverride`, which the app reads as a timestamp in milliseconds, so
    two rows measured the wall clock and reported a feature. (E CERT; the general
    form of lesson 38, replacing three separate incident notes.)
43. **An instrument written before its feature must be re-read against the
    feature's MECHANISM.** `verify-lod-fade`'s co-display census counts a parent
    MESH drawn with its children, while the crossfade blends the parent TEXTURE
    into the child material through clip-UV — so that gate reads 0 by
    construction and is NOT MEASURABLE here rather than RED. **A census of meshes
    cannot see a blend of textures.** (D ATMOS and E CERT, from the pass-2b
    lod-fade row: D names the handle, E owns the instrument.)
44. **A residual is only a leak when nothing is in flight — state the SIGNATURE,
    not the number.** `active` 8 / `retained` 2 after a drain looked like stuck
    blends and was two refine events arriving, because the camera stops and the
    streamer does not; the exact signature is `active === 0` AND `retained > 0`,
    and the counters' own ratio (four child materials per parent texture) told
    the difference. (D ATMOS.)
45. **"Harnesses are exercised by running them" is false where it matters.**
    Running a harness exercises only the paths a RUN TAKES, and the NOT
    CALIBRATED paths are by definition the ones a healthy run does not take — so
    the fleet's own scripts need the same static sweep as the app, and the
    unimported symbol duly appeared in the file whose job is catching unimported
    symbols. (E CERT, pricing its own earlier exclusion.)
46. **A guard on the snapshot that SATISFIED the condition guards nothing.**
    `verify-lod-fade`'s (16d) was gated on the drain-satisfying read, where
    `active === 0` holds by definition, so it could only ever fire on a capped
    drain — the case it was not written for. **Evaluate an invariant on the read
    that could VIOLATE it.** (D ATMOS, reviewing E's rework.)
47. **A criterion invented after seeing the measurement is not a criterion —
    write the go/no-go BEFORE the numbers land.** D published `LOD_CROSSFADE`'s
    six preconditions and six flip conditions ahead of the re-take, and pass 2b
    is the reason: with a frame ratio of 0.57 and the refine counts matching at 4
    anyway, a green would have arrived with no principled way left to refuse it.
    (D ATMOS.)
48. **A static gate pays for itself on the timescale of its first run.** The
    extended `scripts/` sweep caught its own next unimported symbol within the
    hour — `lateActive`, declared inside an `else` and read outside it, on the
    very path the reviewer had just asked for — in ONE node-gate run, where the
    previous instance of that class cost 860 s of browser time and a
    certification row's ON leg. (E CERT.)
49. **A design whose claim is "one writer" must COUNT the writers, not argue
    them away.** `STEP_SAFE`'s header explained why r3f's catch-up was harmless,
    on an unverified platform claim that the HTML spec contradicts; the gate then
    counted exactly half of every write landing outside the frame. **An
    unverified platform claim in a header is a defect waiting for a gate.**
    (A PACE.)
50. **A fix whose proof depends on instrumentation ordering is not a fix.**
    Shadowing `canvas.width/height` would have suppressed the reallocation but
    not the CALL, so whether the gate went green would have depended on which
    instrument ran first — rejected for that reason alone. (A PACE.)
51. **A no-page-errors gate must print the STACK, not just the message.** One
    uncaught `byteLength` read cost a full row of attribution because the gate
    reported the text alone; `scripts/_pageerrors.js` (`d9e5d57`) now dedupes by
    message, counts repeats and prints the first three UNIQUE exceptions with
    their first non-vendor frame, wired into all ten R24 gates plus ladder-fix
    and terra-live. (E CERT.)
52. **The gate asked a runtime question whose honest answer is a source fact.**
    C declined a runtime light census for water's key light — a frame-loop
    traverse would perturb `FRAME_STATS` timings in a performance-certification
    round — and published the vector plus `waterSource:'key-light'` instead. When
    the runtime answer costs the measurement you are certifying, the static
    source gate is the honest instrument. (C LIGHT.)
53. **A defect can live in the TYPE of an object while every count is correct.**
    The toy index was the right values in the right order; the scene graph, mesh
    census, draw list and `ready` counts were all right; only the CONTAINER was
    wrong, and it surfaced solely when a GL context uploaded it. **A headless
    attribute census — does every index and attribute have the `.array` three
    reads `byteLength` from — is the gate for that class.** (B WORLD.)
54. **An un-asserted CONTAINER SWAP is the same defect family as an un-asserted
    `str.replace`.** The comment above the line said "identical values, identical
    order, only the container changes" — and the container was the bug, because
    `setIndex` wraps a plain Array and assigns a typed array raw. The claim in the
    comment is exactly the claim that needed a gate. (The orchestrator; pairs with
    lesson 16.)
55. **A harness A/B whose control arm is INHERITED from the constants stops
    being an A/B the day the constants flip — pin BOTH arms, always.** A had made
    `verify-terra-live` pin `__flyTerraPaceOverride` explicitly on both arms for
    exactly this reason, and the dry merge nearly took a branch version that
    dropped it, which would have made the "off" arm silently the treatment.
    (The orchestrator; the same shape as lesson 26.)
56. **Changing a container type is an API change, not an optimisation — and
    when you take over what a library was doing for you, you take over ALL of
    it.** three was not merely wrapping the toy index array, it was CHOOSING its
    width; taking the first job and not the second is how this "optimisation"
    would have doubled the very buffer it set out to shrink, on top of throwing
    at upload. The fix mirrors three's own bound (65535, not 65536) rather than
    re-deriving it, and a gate reads that number out of three's source so a
    version bump fails loudly instead of desynchronising the paths. (A PACE.)
57. **The constants an instrument DECLARES must be the ones it measured, and a
    declared cost may overstate but never understate.** The depth probe's
    precision ladder is asserted against measured worst-case error — float32
    0.000002 %, float16 0.0754 %, both far inside the 1 % bound — rather than
    quoted from a datasheet. (C LIGHT.)

58. **A pin is only a pin if it is the ONLY reader.** `LINEAR_HAZE` was pinned at
    its dispatch site and the round nearly measured an A/B on it — but
    `AerialPerspective.jsx` read the constant RAW for `uHazeColor`, so the "off"
    arm would have run the new haze colour against the old fade law: **a mixed
    tree presented as a measurement**. Route the flag through one exported
    accessor, then GATE that it is the only reader — and calibrate that gate by
    adding a second read and watching it go red. (C LIGHT.)

59. **The instrument found the gap in the instrument's coverage.** `markPhase`
    was added so a stall could be ATTRIBUTED, and the first serious stall it
    caught — 3660 ms, stamped `[finalize:sat-roads ×16]` — pointed at a
    finalize budget the harness scaler had SKIPPED: `sat-road-engine.js`'s
    `FINALIZE_PER_FRAME` never met `budgetK()`, so at K = 200 every other engine
    accelerated and roads did not. A coverage list is a claim like any other,
    and the thing that checks it is a measurement pointing somewhere
    inconvenient. (E CERT.)

60. **A push chained after a gate in one shell line is a push gated on nothing.**
    The chain's exit status was `tail`'s, not the gate's, so a tip that fails
    import-integrity — a duplicate `budgetK` declaration git auto-merged out of
    two disjoint hunks — was on the remote for two minutes. Gate the push on the
    literal string the gate prints. And the structural fix for the duplicate
    import is upstream of the merge: **an owner merges the integration branch
    into their branch BEFORE new work**, so the collision surfaces in the owner's
    worktree. (The orchestrator; pairs with lessons 16 and 54.)

61. **`no-undef` and `no-unused-vars` answer different questions, and an
    extraction commit needs both.** `no-undef` has run before every commit since
    `ad01d32` and caught the MISSING `offsetUnits` import — and it is
    **structurally blind** to an import that resolves and is never read;
    `no-unused-vars` names that one, and the project config does not enable it
    for the file, so the RED had to be asked for explicitly. **A helper
    EXTRACTION leaves a dead import only `no-unused-vars` sees; a helper
    ADOPTION leaves a missing import only `no-undef` sees.** (C LIGHT; pairs
    with lesson 16.)

62. **Retention was charging rent in draw calls.** `keepResident` kept every tile
    it had ever seen AND kept issuing them, so the drawn set grew with how long
    the camera had been turning — a ceiling breach that no flag-off run and no
    short sweep could reach. **"Resident" and "issued" are different sets**, a
    residency feature is gated on the size of the SECOND, and the fix parks the
    model rather than dropping the tile. And **a cap that only elects
    out-of-frustum tiles is a BRAKE, not a ceiling**: its gate must assert
    CONVERGENCE toward the in-frustum floor, because a `resident ≤ cap`
    assertion would pass while promising something the design does not.
    (A PACE.)

63. **Before an instrument is pointed at someone else's fix, read the fix.** A's
    patch parks the tile's MODEL; E's census tested the TILE's flag and the mere
    existence of a model, so it would have reported `visible` unchanged while the
    draw count fell by three quarters — and the re-run would have said the patch
    did nothing. Reading `VENDOR.md` #26 first caught it **before it produced a
    number**: the same ownership-boundary failure this record names elsewhere,
    this time INSIDE the instrument written to adjudicate it. A working rule, not
    an observation. (E CERT.)

64. **A precondition that reads NOT CALIBRATED on four legs of six did its job.**
    The previous pass printed six PASSes against a stationary sun; this one
    refused four and named the cause — the app picks a sun override up on a
    recompute cadence the legs did not wait for, so the two that passed passed by
    timing. **A gate that can only pass or fail will report the venue's timing as
    the feature's behaviour.** (E CERT; pairs with 26 and 42.)

65. **An undeclared design decision is indistinguishable from a bug.** Two
    shared materials were deliberately excluded from the fade — each for a
    reasoned, gate-backed reason — and the reasoning lived **in prose only**, so
    a presence probe scored them as unexplained hard births and the round spent a
    row calling a coverage gap a floor failure. **Declare exclusions where the
    probe can read them** (`userData.__noFade`, with the reason), and gate that
    every material a probe can meet either fades or declares itself. (B WORLD.)

66. **A per-frame time budget is a frame-rate-dependent THROUGHPUT — the same
    defect as a seconds-only ramp being frame-rate-dependent progress.** The heal
    loop's `budgetMs` delivered 36 ms/s at 60 Hz and **0.2 ms/s at 0.35 fps**;
    the fade ramp had the identical shape, and both need **a per-frame floor**
    (`minRunsPerFrame`, `minFrames`). Two bugs, one shape — and the second was
    found only because a question about the first was answered from source.
    (B WORLD.)

67. **A design-intent note written before any measurement is a hypothesis, and
    the author is the right person to overturn it.** C's W2 proof text carved the
    hillshade out of the sun identity *"BY DESIGN"* at `moonK > 0` — written
    before a night reading existed, it justified the KEY moving to the moon and
    **never asked whether the ground should follow**. The first night measurement
    showed a 180° azimuth contradiction inside one frame, and the flag-off tree
    settled it: R21 already agreed at night, so no inherited contract permitted
    the disagreement. **When a fix changes a contract, say which clause moved** —
    here, hill elevation at `moonK` = 1 is the moon's, not the clamp floor, and a
    gate that passed on the old clause passed on the old tree. (C LIGHT.)

68. **One curve, two callers — never two copies.** The key light and the
    hillshade cross to the moon on the same weight, and a second copy of that
    blend would put the ground and the buildings on different lights **for the
    whole crossing**: the same defect in slow motion. A shared `moonBlendK()`,
    with the pre-existing expressions surviving verbatim on the flag-off path so
    identity is by construction. (C LIGHT.)

69. **A gate can be green on the very frame that contains the defect, and the
    passing number can BE the symptom.** *"(3) HILL ELEVATION === clamp"* passed
    at 8.594° on the frame where the key and the ground were 137° apart —
    because it asserted the hill against the SUN, and the hill was still
    dutifully on the sun. The invariant that catches it is the RELATIONSHIP
    (hill ≡ key under moonlight), not either endpoint; and when such a PASS is
    deliberately not preserved, **record why, or the next reader calls it a
    re-baseline**. Its sibling rule: a null published by the owner is **the
    honest answer** — honour it as NOT CALIBRATED rather than failing against the
    value it replaced. (E CERT, with C LIGHT's stale-vector rule.)

70. **A harness cannot measure what only the bundle can see — and polling harder
    is not a fix for a starved timer.** The depth round-trip needs a true
    distance, which needs the camera and `THREE`; a bundled app publishes
    neither, so the truth has to come from **inside** the app as a dev-only hook.
    The sun override had the same shape from the other side: the sky applies it
    on a **60 s wall-clock `setInterval`** on a thread carrying **92,897 ms of
    long tasks per 90 s**, so the gates were writing to a channel the app
    consumed almost never — and the fix was not a faster poll but **the app's own
    dependency**, re-issuing the same pose to re-run the effect. Both times the
    instrument's honest refusal is what made the mechanism findable: *a
    CALIBRATION row whose arms cannot separate by construction is what exposed
    the lag.* (E CERT.)

71. **Truth is where the bend is — and an instrument that cannot be
    browser-tested must publish its own falsifiers.** A reference that ignores
    the transform the GPU applied is not a reference: every world vertex is
    displaced by `wPos.y -= bendD² · uBendK`, so a naive `Raycaster` at a 4 km
    probe would have been wrong by metres to tens of metres — **a confident wrong
    number, which is worse than the zero hits it replaces**. The un-bend is
    exact for a locally constant drop and iterated to 1 cm off the LIVE uniform,
    never a constant. And because its author had no browser, the hook reports a
    RESIDUAL and a REPROJECTION in pixels, so a wrong space, a stale matrix or a
    bad bend **surfaces as a large number instead of a plausible distance** — and
    the consumer reads those before it reads the answer. (C LIGHT.)

72. **A precondition that asserts a property of the WORLD is a coin.** `P3`
    required `noParentMap` = 0, but a parent whose imagery fetch failed wears the
    vendor's `_errorMaterial` clone, which has no map — so a transient miss on
    the fixture blocks a flip decision while the code under test behaves
    correctly (it falls through to the upstream swap rather than blending from
    nothing). Assert the property you OWN, gate the world's property as a RATE,
    and **record enough context to tell the two apart** — a counter with no
    context cannot distinguish its own causes. (D ATMOS.)

73. **"Settled" is a state of the streamer, not an identity of the scene.** Two
    arms both reported SETTLED and were compared for bit-equal draws and
    triangles — at maxZ 17 and 16, a whole level apart. **An equality across arms
    is preconditioned on the scene being the same**, and where it is not, the
    honest verdict is NOT CALIBRATED, never FAIL. (D ATMOS.)

74. **A per-URL counter and a per-tile counter answer different questions —
    and "refetch" is defined at the TILE.** Four z16 tiles past the DEM's z15
    ceiling share ONE clamped ancestor URL, so a per-URL log reads four requests
    and a per-tile log reads zero refetches: **two counters, two questions, both
    right**. A's own harness had been reading a truthful 0 for a question it was
    not asking. **Name sharing as sharing** — and gate the discriminator, so that
    a real refetch (a duplicated URL whose z is NOT the ceiling) is named rather
    than excused. (A PACE; pairs with the pass-1 gate-6 lesson.)

75. **Before loosening a bound, quantise the model's own numbers the way the
    instrument does.** Four failing clauses looked like float32 noise and were
    `toFixed(6)` in the publisher: the app's azimuths agreed to the bit as
    doubles, and **the residual reproduced from the instrument's FORMATTING
    alone** — so the bound was never the problem, and a looser one would have
    written the instrument's rounding into the contract permanently. Publish
    enough digits that the clause can be asserted for what it says. **And "one
    sun" is one SOURCE, not one vector**: two consumers evaluating the same
    azimuth at contract-different elevations are the design, and bit-identical
    azimuths are how you prove the source is one. (C LIGHT; pairs with 69 and
    the presence-channel latch.)

76. **Read your own publisher's precision before trusting a difference.** The
    mirror of 75, and the harder half: this round's instrument defects were
    mostly about reading someone ELSE's value wrongly, but this one **read its
    own value at a resolution it had chosen and then blamed the source** — and
    the first instinct was to loosen the contract to fit it. **A difference is
    only as real as the digits it was computed from.** (E CERT.)

77. **A monotone correction can read as an improvement on one side of a reference
    and a regression on the other — judge it by the INVARIANT it targets, not by
    the sign on one leg.** `srgbToLinear` only darkens, and the terrain sits
    above the dome by day and below it at night, so the identical correction
    narrowed the noon seam and widened the night one while **the quantity that
    actually asks the question — is the seam the same at every hour — improved by
    44 %**. And the tuning corollary: the decode keeps **80 %** of a bright value
    and **13 %** of a dark one, so **re-authoring decoded targets is per-keyframe,
    never a global scale**. (C LIGHT.)

78. **A within-run floor measures the READER; a cross-boot floor measures the
    VENUE; and an A/B whose arms boot separately is bounded by the second.**
    `haze-red` returned 0.00 and 0.45 by re-reading one configuration twice in a
    run — but the same OFF configuration at the same poses on the same tree drifted
    ~1.2 luma between BOOTS. The claim under test cleared both, so it stood; the
    number a future A/B must beat is the larger one. (E CERT.)

79. **A pick that labels distances it did not find measures the label.** Two
    legs called "near ~50 m" and "mid ~700 m" resolved to the same pixel with the
    same truth at 1,171 m: one measurement wearing two names, and a third leg
    disagreed with its truth by a factor of ten because **the probe and the
    raycast were right about DIFFERENT SURFACES** — a depth-writing object 34 m
    from the camera that the truth's candidate set did not contain. **A pick's
    first job is to prove the two instruments share one surface**; a
    factor-of-ten disagreement is a pick miss with a reason, never a verdict on
    the feature. (E CERT.)

80. **A correction that is right in one regime can be fatal in another — cast
    both and let the falsifier choose.** The bend un-lift is exact for distant
    terrain and lifts the ray 49 m at 3 km, which flies clean over anything 30 m
    away: the truth hook's own correction was hiding the object in front of the
    camera. Casting an unlifted ray AND a bend-solved one, rejecting on
    reprojection and **taking the nearest survivor**, needs no regime test at
    all — the wrong one rejects itself. (C LIGHT.)

81. **A truth read in a different turn is a truth of a different world.** Two
    probes of one pixel disagreed by 2.5 m; a static surface cannot do that, so
    the reference had been taken against a frame the depth value never saw.
    Compute the reference **in the same synchronous turn** as the measurement, or
    the comparison is between two worlds. (C LIGHT.)

82. **A bound for a SURFACE comparison must carry the surface's own slope,
    measured at the pixel.** One pixel at 1.2 km subtends metres of ground, and
    on a skirt, a cliff or an LOD seam the depth across one texel moves tens of
    metres with no reconstruction error present — so a flat percentage is the
    wrong shape. Cast the four neighbours and publish the largest one-texel step:
    **tight where the surface is flat, honest where it is not.** (C LIGHT.)

83. **A certification round produces truth in one direction: a claim gets
    weaker every time someone looks at it, and what survives is the record.**
    Writing this file for a day, I watched the same shape happen fourteen times.
    A row goes green and the green turns out to be an empty census; a row goes
    red and the red turns out to be the gate's own rounding, its own yaw step,
    its own channel name, its own lifted ray. **Of the eighteen browser rows in
    §4.2, not one red was ever a defect of the flag it was certifying** — and
    the round still found three real defects, every one of them fallen out of an
    instrument being fixed. That is not an accident of this venue; it is what a
    certification round IS, and it has three consequences for whoever writes the
    next one.
    **First, a verdict is only as durable as the sentence that says why.** The
    numbers in this record moved constantly — 40 became 44 became 49 became 54,
    "one tolerance" became "my own `toFixed(6)`", "the streamer refetches"
    became "the DEM ceiling is lower than the imagery ceiling". The attributions
    did not move. **Write the mechanism, and the number becomes a citation
    rather than a claim.**
    **Second, record the reversal, not just the conclusion.** Three rulings in
    this round were overturned by their own authors — C's "BY DESIGN" carve-out,
    the orchestrator's tolerance call, D's precondition — and each reversal is
    on the page beside what it replaced, because *the trail of what we believed
    is the only defence against believing it again*. A record that shows only
    final answers teaches nothing and quietly re-licenses every mistake it
    tidied away.
    **Third, say what you did not measure, in the same voice you use for what
    you did.** This record's most important sentence is not a green count; it is
    that **nothing here has been confirmed on the user's machine**. A scribe's
    job is not to make the round look finished — it is to leave the next round
    able to tell a proof from a hope at a glance. (F SCRIBE.)

84. **A cap sized on one motion is wrong on the next.** `maxResidentTiles` 260
    was measured on a 240-frame synthetic yaw that saturates at 190 — and a
    650-frame revolution, a bob and a serpentine all hold more, so the brake
    bound and its evictions read as LOD churn: **74 merges reduced to 47 by the
    brake, not by the policy**. Size the bound on **the worst ratio you can
    measure** (retained/drawn, worst 9.20 across yaw, bob and serpentine at two
    lengths) and let it follow the quantity it tracks; and **publish the eviction
    count**, so a merge is never again ambiguous between the policy and the
    brake — that ambiguity is what cost a re-take. (A PACE.)

85. **A per-frame ramp is a frame-rate-dependent SETTLE, and a gate that sleeps
    for a fixed time on a starved venue measures the venue's frame rate wearing
    the feature's number.** `SatEnvironment` advances at most 0.25 s of ramp per
    FRAME, so a 26 s wait bought 12–13 frames and two scalars landed 13.15 % and
    11.99 % short — read at first as a day-dimming regression, and in fact
    ~0.48 fps. The two channels disagreeing (0.8685 vs 0.8801) was the tell: one
    starved ramp seen twice, not two symptoms. **Wait on the VALUE the code snaps
    to**, never on the clock. (C LIGHT; pairs with 66 and with the fade floor.)

86. **A corrector can discard the very actor the ray saw.** The truth hook
    subtracted the GROUND drop from every hit and rejected whatever then missed
    the pixel — but a vertical displacement is almost entirely PERPENDICULAR to a
    grazing ray, so a correct candidate at 1.7 km reprojects ~9 px away, and the
    ground formula is wrong by construction for an air-bent actor, **so the class
    of actor most likely to stand in front of terrain was the class guaranteed to
    be thrown out**. The fix removes the model instead of tuning it: every bend
    displaces only in Y, so the truth is the point on the ORIGINAL ray at the
    hit's XZ — **reprojection 0 by construction** — and the drop becomes a
    MEASUREMENT that tells the actor's family apart, printed rather than
    inferred. *"Your shape was right — it was an actor the ray DID see and my
    corrector discarded."* (C LIGHT.)

87. **A pick chosen by RANK is a pick that never checked where it landed.** The
    CoC clauses took the nearest and farthest truths and asserted a focus-plane
    property — but the toy DoF focuses on WORLD constants (700 m, range 2600 m)
    that do not follow the chase, and this pose's 13 truths hold nothing near
    700 m or past 4 km, so **one cause produced a false red at 35.9 m and a
    vacuous green at 3210 m**. The repair is not a looser bound: assert the
    measured CoC against **the material's own formula at the truth distance**,
    which tests that the effect reads real depth **without assuming where focus
    sits**. (E CERT; pairs with 79 and with R17 §7.1.)

---

## §8 Flag ship state at close

**The flips are MERGED.** Pass 1 closed, and the five owners' flip commits went
to integration in order — `19d90b0` (E), `5b13e35` (A), `7face8f` (B),
`a60bf17` (C), **`91141fe`** (D) — giving a tree that is byte-identical to the
dry-run worktree, `no-undef` 0 over the R24 delta and node smoke 16/16. Every
state below is read from `91141fe:lib/fly/fly-constants.js` and cited to the
merge that set it; **only `LOD_CROSSFADE` is still open**, on pass 2's pinned ON
leg. **Nothing here has been certified on the user's machine.**

**CLOSED, and it was never a flag**: `verify-dusk`'s pinned-noon red is **the
venue starving an R16 PER-FRAME ramp** — `SatEnvironment.jsx:553` advances both
intensities by at most **0.25 s of ramp per FRAME**, so at ~0.48 fps the gate's
26 s noon wait buys 12–13 frames of approach and the scalars land 13.15 % and
11.99 % short. **No R24 flag writes either scalar** — the only writers of
`scene.environmentIntensity` in the tree are the TOY `<Environment>` and
`SatEnvironment` itself — **so the default ruling had nothing to apply to; the
constant is already frozen and untouched**, and **the HARNESS changes instead**:
the settle now waits on the VALUE the code snaps to, not on the clock (§4.3,
§5.2).

### ON at close (Level A: green on the fixture or structurally proven, flag-off identity proven)

| Flag | Rests on | Marker |
|---|---|---|
| `FLASH_GUARD` | **CERTIFIED ON THE VENUE** — the re-take reads **8/8** with the armed census non-empty for the first time: **13,766 zero-area triangles (8.32 %) with the pin off, EXACTLY 0 armed at every site** over 151,754 tris, both Powell legs settled (422 s / 274 s), the detector's self-test firing exactly once and the serpentine registering zero false positives in 668 frames (§4.2). **The one-frame white flash's zero-area DoubleSide wall triangle, from the vector-tile ring closure, is removed AT THE SOURCE; the pale detector is CORROBORATING, not load-bearing.** Caveats that stay: Manhattan did not settle, so its 13.97 % worst chunk is a floor and the A/B lives in the Powell pair; **skyline = INSURANCE**, its population 0 by construction; **the toy site is NOT EXERCISED** by any browser row; and `FLASH_GUARD telemetry` still reads null, so the green rests on the census rather than on the feature announcing itself. 15,984 → 0 in node; normals bit-identical; zero keys, zero bundle bytes, zero draws | **ON**, merged `7face8f` |
| `BEND_LEAD` | `padON ≥ worstDrop` on 7/7 rings; Owens 0 by construction | **ON**, merged `7face8f` |
| `CHUNK_FADE` | **CERTIFIED ON THE VENUE (7/0)** — **a chunk is never at full presence on its first displayed frame (0 of 16 births) and never leaves from full presence on the fading layers (0 of 3 deaths)**, with every hard event attributable and the non-fading layers DECLARED (258 attributions, 0 unexplained); `fadeBudgetMiss` 1 is capped as designed (§4.2). The road to it: — the re-take's probe sees the channel (`userData.__fadeU`, 82 of 114 frames carrying a partial-presence mesh) and the `minFrames` 4 floor works for 18 of 26 births and 5 of 11 deaths; **B's headless proof at the venue's own 2.84 s/frame reads the fading layer at 0 HARD of 54 births and 45 deaths**, so the 8 and the 6 are **two DECLARED no-fade layers** (sat-roads, sat-water) now wearing `userData.__noFade`, not a floor failure (§4.2). **Re-run pending** with E's attributing probe. pops 92 → 2, both attributable; `maxDying` 4 is the only draw term. **ON per the ship table**; whose expected reading is on the record in advance — births SOFT, deaths spanning ≥ 3 partial samples, hard deaths ≤ `fadeBudgetMiss` (§4.2) — and which runs with B's frame-count ramp floor (`45e2cde`, `minFrames` **4**) in: venue pops **0** against 92 flag-off, the 60 Hz ramp length unmoved, and a mid-ramp 500 ms hitch no longer completing a ramp | **ON**, merged `7face8f` |
| `HEAL_IN_PLACE` | **EXERCISED ON THE VENUE at last** — on the parked tree with B's throughput floor the post-batch row reads heals 2 = **`healsInPlace` 1** + coalesced 1, with **`healsQueueFull` 0** and nothing aborted: *"0 budget-starved heals: no hole is attributable"* (§4.2). Before that it was **NEVER EXERCISED in the serpentine window, and B RULED that BY CONSTRUCTION** — heals **9** = queueFull 4 · aborted 4 · coalesced 1 with `healsInPlace` **0**, because at 2.84 s/frame a serpentine moves ~250 m per frame and every in-flight job dies with its ring (`readySeries` sb 3 → 0); the same engine at 0.35 fps measures `healsInPlace` **6–8 of 8–12** when chunks live long enough. **A throughput floor landed with the ruling** (`minRunsPerFrame` 64 — `budgetMs` was a frame-rate-dependent throughput), and **the window that would exercise it is named**: a stationary Sierra hold, ≥ 20 frames (§4.2). heals 16 (0 in place) → 21 (all in place); evictions 40 → 24. **ON per the ship table** with `CHUNK_FADE` (§4.2), now against an EXHAUSTIVE outcome ledger — `healsInPlace`, `healsNoop`, `healsQueueFull`, `healsAborted`, `healsNoRecord`, `healsCoalesced`, `redraping` — asserted as an EQUALITY, so a residual hole is attributable to `healsQueueFull` or it is a defect | **ON**, merged `7face8f` |
| `GROUND_VIS` | 384.0 → 4.000 m worst frame, converging in 95; the flight model keeps RAW | **ON**, merged `7face8f` |
| `LINEAR_HAZE` — pinned through `linearHazeOn()` (`ee10642`) | **SHIP STATE SETTLED: ON, on C's ruling** — it is a colour-SPACE fix, and with the flag off the triples are interpreted in a space the buffer is not in, wrong whatever the seam reads; the night regression (+2.6) is smaller than the noon gain (−6.8) and is a **target-value residual that exists identically flag-off**, so switching the decode off would give back the gain and certify a known-wrong space to make one sub-clause green. **THE ARMS SEPARATED at last, and the reading is two-sided**: on the venue the **noon seam SHRINKS with the decode (59.9 → 53.1)** and the **day-night dependence HALVES (spread 21.1 → 11.7)**, while the **night seam did NOT separate on the re-run** (OFF 39.8 → ON 40.1, difference −0.28 inside the 1.2 cross-boot floor → NOT CALIBRATED, where the earlier run's +2.6 did clear it) — **the noon gain reproduced at 5.90 luma and the hour-dependence ratio at 0.68**, so the decode's claim is measured twice and the night remainder stays where C put it, in the refused tuning — the residual seam is **the tuning C refused this round**, not the decode, so (3) is informational and the ship state waits on C's source reading and recommendation (§4.2). **decode round-trip proven by the node oracle** (each setter writes `srgbToLinear` of the authored triple; closed-form deltas 9.3 / 19.9 / 76.3 / 99.2 / 89.4 per 255 → 0.000). **The SEAM is UNMEASURED** — pose and pin: the fixture frame has 0 % melt because `bootFly` pins `__flyAerialOverride = 0`, and ≤ 12/255 is unreachable at that pose even released (§4.2). **A/B re-take pending** — the first attempt read 8 NOT CALIBRATED because the sun override never landed (§4.2), and it re-runs behind E's wait-for-landing fix; now calibratable: `linearHazeOn()` is the ONE reader of the flag (`verify-c-flagoff` 37 → 40), and the second raw reader in `AerialPerspective.jsx` is gone | **ON**, merged `a60bf17`; pin `ee10642` in the dry tree |
| `ONE_SUN` — `hill.dayK` **1.0**, `monumentsLambert` true; **CERTIFIED ON THE VENUE at all three elevations and BOTH tiers (38/4/0)**: one direction across key, hill, water and — at dusk — the dome, **to within float32**; the sun landing on 6 of 6 legs; the medium tier's key MOVING with the sun (azimuth spread 153.30° against 0 flag-off); **the moon key published and FOLLOWED by the hill under moonlight (Δaz 0.0000, Δel 0.0000)**; exactly one `<directionalLight>` declared. **The four fails were C's OWN INSTRUMENT, not a tolerance**: `toFixed(6)` in the stats publish, whose bound (4.05e-5°/cos el) contains every failing number, while the app's key and hill azimuths are **bit-identical as doubles at every leg**. Directions now publish at nine decimals (gate 50), the 1e-6° clause is RESTORED, and **the tail re-run CLOSED IT: 42 passed, 0 failed, 0 NOT CALIBRATED, deltas 0.00e+0 to 2.41e-8° — three orders inside the clause** (`scripts/r24-out/tail/one-sun.log`, tree `3231f7d`, §4.2, §3 C). Historically, **the identity clauses were CERTIFIED WHERE MEASURED** — water ≡ key **by source AND by angle** (`waterSource "key-light"`, Δ 0.000000° at both tiers), the hill clamp floor exact at **8.594°**, and the night sun landing **within 0.004°** of the commanded −14° — while **the noon/dusk legs and the moon expectation are UNMEASURED BY INSTRUMENT** (a recompute cadence the legs did not wait for, now waited on by E's `71f2c8c`) — **and the night hill/key split C first read as its moonlit key is RULED A DEFECT BY C, against C's own W2 text, and FIXED** (`446545b`): R21 flag-off already agreed at night, so the 137° split was 100 % `ONE_SUN`'s; the hill now follows the moon through one shared `moonBlendK`, **and the contract changes with it — at `moonK` = 1 hill el is `moonElRad` 34.377°, not the clamp floor, still inside [8.6°, 51.6°]** (§3 C). **Satellite NIGHT ground pixels move: sat-night, dusk and flicker's night legs re-run post-batch; daylight is bit-identical by construction.** **Re-run pending** — pass 2b's azimuth leg is exact (key === hill at Δ 0) while its elevation legs are VOID: the gate wrote an `{ elDeg }` object to a handle the app reads as a timestamp, so the app kept its wall clock (§4.2). **Not open-as-defect** | key az −56° at every hour → the sun at every tier; `live:false` closed. **dayK 1.0 makes the daytime demotion built-and-off BY CONSTRUCTION** (the weight is exactly 1, so `uHillStrength * uHillElev` is bit-identical to R21 and `verify-sat-depth`'s margin does not move); 0.65 would have spent up to 35 % of a frozen margin on an unmeasured argument | **ON** (`hill.dayK` 1.0, `monumentsLambert` true), merged `a60bf17` |
| `POST_ORDER` (`smaaPreset 'high'`, dither) | 228/228 → 254/255 with midtones unmoved; merged pass count FALLS (sat 4→3, toy 6→5) | **ON** (`smaaPreset 'high'`, dither), merged `a60bf17` |
| `DEPTH_FIX` | node proof (`depth-roundtrip-proof`: RED flat **0.176–0.177** CoC, viewZ **−2.50 m**; GREEN error 0.000000; the mirror proven by EXTRACTING three's own formula, 8,004 comparisons bit-identical) + `verify-depth-offset` **7/7**; the **hook is proven present and published** (pass 2b: `__flyDepthProbe` present, `__flyDof` true) and **THE DOUBLE UN-REVERSAL IS GONE ON THE VENUE**: the probe reconstructs **1207.14 m against a 1171.4 m truth**, in the kilometre regime and nowhere near the 2.50–2.51 m RED signature, over **12 truth hits that passed C's own falsifiers** (residual ≤ 0.007 m, reprojection 0.00 px; the iterative un-bend converged in 2–4 passes and **has since been REPLACED** by C's `81d803a` arbiter, which takes the truth on the original ray at the hit's XZ — reprojection 0 by construction, no iteration at all). **All three open items are CLOSED AT THE SOURCE** (C `a44f4b7`): the far pick was the un-bend's own near-field blindness (dual cast, nearest survivor), the 36 m gap was a surface moving between turns (`truth` is now a field on the probe result, same turn), and `cocSource` was published at an address the gate did not read. **The round-trip contract is restated with a MEASURED slope term** — `0.01 · abs(truth.viewZ) + truth.slopeMPerPx` — because one pixel at 1.2 km subtends metres of ground. **THE ROUND-TRIP IS NOW MEASURED AT BOTH ENDS**: nearest 35.94 m against a 35.9 m truth (**0.10 %**) and farthest 3210.50 m against 3210.4 m (**0.00 %**) on one frame, with 13 usable truths and the CoC source named — **both reds are ATTRIBUTED TO THE INSTRUMENTS, neither of them `DEPTH_FIX`'s**: the 205 m median was C's own truth hook rejecting the correct candidate — a ground-drop correction is perpendicular to a grazing ray and wrong by construction for an air-bent actor, so the class most likely to sit in front of terrain was the class guaranteed to be discarded (fixed at `81d803a`, the truth now taken on the original ray at the hit's XZ with reprojection 0 by construction; c-flagoff 54 → 57); and the CoC clause read the toy DoF's WORLD constants (focus 700 m, range 2600 m) at a 35.9 m pick, one cause producing both a false red and a vacuous green at 3210 m, with E rebuilding both clauses against the material's own formula (§4.2). **The re-run is pending.** Historically — the near and mid picks resolved to ONE pixel, the far pick hit a different SURFACE (a depth-writing object 34 m out, the player the obvious candidate), and CoC has no `cocSource` to attribute — re-run at the tail (§4.2). Historically: the re-take proves the hook and the settle (121 s, maxZ 15, the gate's first content run at K=40, `reversedDepth` true), but **(1) cannot be calibrated from the harness side AT ALL** — the page exposes the renderer and the scene and neither the camera nor `THREE`, so an out-of-bundle `Raycaster` can never establish a true distance. **the truth is now PUBLISHED with its own self-check** (C `514eddd`): `__flyDepthTruth` through the composer's own camera and scene over depth-WRITING geometry only, **un-bent by the live `uBendK`** because the CPU geometry is not the surface the depth buffer recorded, reporting `residualM` and `reprojectionPx` so a wrong space reads as a large number rather than a plausible distance; E asserts the probe against it within 1 % of the 2.50–2.51 m RED signature, reading the falsifiers first (§3 C, §4.2) | **ON**, merged `a60bf17` |
| `SHADOW_CALM` (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0) | shader edits and snap arithmetic **proven node-side (32/33 gates)**; mount/arm logic structural; **pixels, draw counts and whether the catcher actually receives a shadow unmeasured — user's machine.** Note for any program census: it changes the compiled TEXT of every shadow receiver with NO cache key, so a key census is blind by construction and a source-hash census sees every receiver move | **ON** (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0), merged `a60bf17` |
| `TERRAIN_LIGHT` — `fragmentHill`, `microFwidth`; `workerNormals` **false** | the tile half ships; the worker half is node-proven (3.34° → 0.26°) with zero pixels behind it, and ON would make `verify-skirt-worker`'s identity leg RED by design | **ON** — `fragmentHill` and `microFwidth` true, **`workerNormals` false**, merged `a60bf17` |
| `CLOUD_LIT` + `LAMBERT_ENV` (0.15) | same ONE draw; uniform-only for Lambert; the cloud variant's warm-set exception has a measurement condition attached | **ON**, merged `a60bf17` **ON** (`reflectivity` 0.15), merged `a60bf17` |
| `TERRA_PACE` {`timerFix`, `mergeHysteresis`, `keepResident`, `skirtFast`, `walkWhileSaturated`, `bboxCache`} | 22/17/178 → 0/0/0; timer 10/12 → 4/12; the saturated walk strictly conservative; skirt output element-identical; **live-arm fixture evidence now in** — merges 1 → 0, refetchParent 1 → 0, Owens **161 → 185 ≤ 261**, Powell **161 → 183 ≤ 375**, draws rising because `keepResident` keeps more tiles drawn. `verify-terra-live` (6)'s 1 → 17 repeat fetches are **ATTRIBUTED to the harness's ~51°/frame wall-clock yaw at 1 fps, not to the feature** — the LRU had nothing to evict (peak 30–36 % of a 140 MB cap) and merges were 0; re-measured in pass 2 at 0.85°/frame over a full 360°. **THE ON-SCREEN CONTRACT IS MEASURED BY THE PER-ARM COUNTERS, NOT CERTIFIED**: with the arms comparable for the first time (647 vs 650 frames, 550° vs 553°), **`replacedOnScreen` reads 65 → 0** on the parked tree with content correct per tile in both arms — **but that row was KILLED at the 2,400 s ceiling before any gate printed**, so these are summary counters and **the certification word waits for the standalone re-run** (§4.2). **The zero-merge headline's loss on the CAPPED tree is ATTRIBUTED AND FIXED** — merges 47 with 47 refetches were **A's own brake**, `maxResidentTiles` 260 having been sized on a 240-frame yaw that saturates at 190 while this venue's revolution holds more, so the LRU elected off-frustum subtrees and the return re-fetched them; **the cap now follows the drawn set** (`max(260, 14 × drawn)`, `k` sized on the worst measured retained/drawn ratio of 9.20), `parkOffscreen` is refuted from source as a cause, and **`replacedOnScreen` 65 → 0 held BY DESIGN because election is out-of-frustum only** (§4.2); and **the Owens draw number on the parked tree is STILL UNMEASURED**, the row having been killed by `run()`'s 2,400 s ceiling and re-running standalone (§4.2). Earlier, on the un-capped flipped tree: merges 35 → 0, on-screen replacements 27 → 0. **FIX LANDED, re-measure PENDING: the same row's ON arm read Owens 279 against the frozen 261** after a 600 s sweep (185 after 45 s in pass 1, same flags), with resident tiles 62 → 103 and `residentMB` 113.7 still climbing — **retention, not necessarily culling**, and **both requirements are met** — PATCH 26 `parkOffscreen` (off-frustum issued **142 → 0**, resident unchanged, the drawn set BOUNDED by the frustum instead of growing with sweep duration) and `maxResidentTiles` **260**, an LRU by last-visible frame with distance breaking ties, `verify-terra-residency` **22 → 32** RED-calibrated by neutering the park. **`keepResident` alone was the cause** (switch-by-switch, §3 A). **The 261 is not moved, and whether Owens lands under it is E's `terra-live` re-run to measure** | **ON** — `timerFix`, `mergeHysteresis`, `keepResident`, `skirtFast`, `walkWhileSaturated`, `bboxCache` all true; `skirtWorker` and `bendSphere` false, merged `5b13e35` |
| `LADDER_FIX` (incl. `nativeRefresh`) + `STEP_SAFE` | **BOTH CERTIFIED ON THE VENUE. `LADDER_FIX` reads 13/0**: two sub-native render-scale rungs spent before any tier drop, a refresh-FOLLOWING target, a stutter-aware step-down at healthy mean fps, the clean-session control never stepping, and the step applied in-frame with the composer buffers in lock-step — **and `nativeRefresh` is EXERCISED, not measured against a display**: the governor estimated **144 Hz from the SYNTHETIC frame cadence the harness feeds it** on a ~1 fps SwiftShader venue with no 144 Hz panel anywhere, and the target followed it — **so what is proven is that the target TRACKS the cadence it is given; no display was measured, and §6 item 4 stays the user's, both halves.** **Gate (13) is also the BROWSER confirmation of A's index fix** — no page errors on the toy boot that threw `byteLength` 31 times pre-fix. **`STEP_SAFE` reads 9/0**: a quality-ladder step now applies the DPR, the renderer size AND the composer size **inside one frame**, with **the second writer guarded** (`stepGuard` {setPixelRatio: 1, setSize: 2} per step is r3f's re-apply being suppressed) — **the tear mechanism, a canvas resized outside the frame, has no remaining path on this tree**: **0 of 12 canvas writes outside a rAF** (pass 1 read 18 of 18, pass 2b 12 of 30), 0/6 for `setPixelRatio`, `setSize` and `composer.setSize`, and **0 buffer mismatches in 65 frames** where pass 1's gate (4) read 22 of 46, composer resized not rebuilt (§4.2). RED 6/13; two render-scale rungs before the first tier rung; DPR applied inside the drawing frame — **and pass 2b closed the composer lag (`composer.setSize` outside a rAF 6/6 → 0/6) and the buffer mismatch (22 of 46 → 0 of 43)**. **The DPR double-apply is ATTRIBUTED and FIXED** (`a0c1484`): the second writer is r3f's own zustand subscriber, re-applying `setPixelRatio` + `setSize` outside any frame after an AWAITED `root.configure` — triggered by the rig's own `setDpr`, so within the flag's reach — and `installResizeGuard` drops a resize into the state the renderer already holds while keeping `setViewport`, with `verify-step-guard.mjs` 13/13 behind it (§4.2). **`nativeRefresh` is still UNMEASURED on hardware** — the re-take proves only that the target follows the cadence the harness feeds the governor (144 from a synthetic dt on a ~1 fps venue), so §6 item 4 keeps BOTH halves | **ON** (incl. `nativeRefresh`), merged `5b13e35` **ON**, merged `5b13e35` |
| `HUD_SYNC` + `REBASE_CALM` | labels drawn with this frame's matrices; 704 m quantised anchor | **ON**, merged `5b13e35` **ON** (`quantM` 704), merged `5b13e35` |
| `FINALIZE_PACE` | **rule-1 spike fix CONFIRMED on the venue** (§4.2, flash-guard part 1) — and a SECOND defect attributed at the close: **the paced branch's toy merged index is a raw `Uint32Array` handed to `setIndex`, which wraps only a plain Array, so `WebGLAttributes` throws on `array.byteLength` once per toy land mesh** (80 broken meshes with the flag on in B's 2×2, 0 with it off, independent of `FLASH_GUARD`); **fixed in `e7325cd`** (wrapped, and the width mirrored from three rather than inferred), with `verify-finalize-pace` at **21/21** and B's census `BROKEN=0` on the dry tree; the ladder-fix re-take is the census leg. One shared brake. **Its first rule shipped as a LEVEL detector and starved every finalize below ~41 fps** — found at the close, §1 and §4.2 — and now refuses only on a genuine spike (> 24 ms AND > `spikeK` **2** × an EMA of the preceding frames) with a hard `maxRefuseFrames` **3** cap; `verify-finalize-pace` 14 → 17 gates, and the single-hitch gate passes both ways, so the behaviour the rule was written for did not move | **ON**, merged `5b13e35`, fix `abd127c` merged `3d388ec` |
| `FRAME_STATS` | the round's only frame-pace instrument; flag-off byte-identical, and **flag-gated with no runtime pin**, so `verify-frame-pace` runs for the first time in pass 2 (flip `6c26fe9`) | **ON**, merged `19d90b0` |
| `AERIAL_LAW.nightRamp` (A8) — **true while `AERIAL_LAW.enabled` is false** | FlyScene gates A8 on `nightRamp` alone and applies it to the LEGACY post strength on the `lawOn === false` branch; noon multiplier EXACTLY 1 keeps `verify-aerial`'s 0.55 exact, deep night EXACTLY 0; uniform-only | **ON with `AERIAL_LAW.enabled` false**, merged `91141fe` |

### Conditional

| Flag | Condition |
|---|---|
| `LOD_CROSSFADE` | **SHIPS OFF — D ruled NO-GO on the standalone under §4.10b** (three preconditions fail; F1/F3/F4/F5 hold on their own evidence, F2/F6 not evaluable), with ONE re-run specified on A's fixed tree. The refine path is proven blending on the venue and the flip is withheld by the TEMPLATE, not by a defect: the substance is strongly positive (faded 0 → 61, hardSwaps 72 → 1, every blend draining with no parent-texture leak, peakActive 8 ≤ 32, a 31-frame blend window) but the ON arm's arc capped at 264° at 0.35 fps, the frame ratio landed at 0.75 on a ±25 % guard, and one fade was denied for `noParentMap` — **two failed preconditions and a defect-shaped denial, which under D's §4.10b template is NO FLIP without a re-run on A's parked tree at a longer sweep** (§4.2). **decided by pass 2's pinned ON leg** — pass 1 proved the gate as written has no ON leg at all (§4.2). D struck its own earlier "`hardSwaps` flat at 20": **the 20 came from a different pose, and the counter PARTITIONS events rather than counting them.** The criteria the leg asserts, and the only ones this record cites: `refines + merges === hardSwaps + faded` on BOTH legs · `refines + merges` FLAT OFF→ON · `hardSwaps` DROPS toward 0 while `faded` RISES on the ON leg · **the leak SIGNATURE rather than a number** — from `finish()` releasing every owned texture before deleting from `_active`, **LEAK ⟺ `active === 0` AND `retained > 0`** — asserted on the snapshot taken at the instant the drain condition held AND on a second read N frames later, with `refines + merges` attributing arrivals (INFO) against stuck (FAIL), plus the free invariant `retained ≤ active ≤ 4 × retained` while only refines are in flight · `0 < peakActive ≤ 32` (a session high-water mark, boot included) · `skip.concurrency > 0` acceptable ONLY with `peakActive === 32` · `skip.shape`, `skip.noParentMap`, `skip.unpatched` all **0** · Owens draws/tris EQUAL to the OFF leg's fixture numbers (**174 / 166,659**), not merely ≤ 261 · zero page errors · **NOT CALIBRATED** (not red) when `refines + merges` in the measured window is 0. **The decision procedure is written DOWN, in advance, at D's ledger §4.10b (`r24/d 1083168`)**: six PRECONDITIONS under which the run decides anything at all — no pace pin on either page · `skip.disabled` 0 · `skip.shape` / `noParentMap` / `unpatched` 0 · both arms offered swaps · **arc ≥ `MIN_ARC_DEG` AND the frame ratio within ±25 %** · both arms settled at Owens — and six FLIP conditions: **F1** ladder identity on both arms; **F2** `refines + merges` equal across the flip; **F3** `faded > 0` in-window with `hardSwaps` below the OFF arm; **F4** `maxBlendRun ≥ 2`, reported against 5; **F5** the drain snapshot at `active === 0`, the leak signature `active === 0 && retained > 0` clear on BOTH reads, a non-zero second read attributed by advancing counters, and `retained ≤ active ≤ 4 × retained`; **F6** Owens draws AND tris equal, zero page errors on both arms. The leg also polls `active === 0` (90-rendered-frame cap, count printed) and `skip.warp` unchanged across two reads rather than trusting a frame-count settle (D `8d1599a`/`51a95bc`). **Two things D put in writing BEFORE the numbers land.** Pass 2b — frame ratio **0.57**, with the refine counts matching at 4 anyway — is exactly why the frame-ratio band is a PRECONDITION and not a footnote: **on a green, D would have had no principled way to refuse it afterwards.** And **a green proves the REFINE path only** — A's yaw sweep saw merges 1 and D's ladder merges 0 — so if it flips, the recommendation reads, in D's words, *"the refine path is measured, the merge path is inferred from shared machinery (same uniform, same clip-UV transform, same clock, run backwards; merge direction gated structurally by `verify-lod-fade.mjs`), and structural is not measured"* — **`measured` for refines, `inferred` for merges, in the recommendation itself**. And the honest remainder that no fixture row settles either way: whether 250 ms reads as smooth or as MUSH at 60 or 144 Hz, and whether the crossfade removes the user's symptom or merely leaves the relief snap that a texture blend cannot morph — the user's machine, §6. Otherwise it holds at OFF with its RED on the record. <!-- FLIP:LOD_CROSSFADE PENDING --> |
| `AERIAL_LAW` (the law itself) | OFF this round. ON only after the horizon re-baseline batch runs with a fixture column AND one fixed-pose Owens draw row — D's own words: flipping it ON without the re-baseline "would be flipping a look nobody has seen". **OFF**, merged `91141fe` — the law ships off and only `nightRamp` is on |

### OFF at close

| Flag | Why |
|---|---|
| `AERIAL_LAW` — **the LAW OFF, `nightRamp` ON** | the night multiplier is read at `FlyScene.jsx:1896` **outside the `lawOn` gate** (defined at `:1914`), so it ships LIVE while the law does not; and the block's `content: true` / `airAnchor: true` are **pre-set but read by NOTHING in `lib/` or `components/`** — dead until a future dispatch reads them, not gated behind `lawOn` |
| `ENV_UNIFORM` | the review-confirmed boot-gate / live-light-flip defect is fixed against a stand-in scene (9/9, `--red` 5/9 as recorded; 6 of 9 FAIL re-read at the close), but the flip still needs the `programsDelta` run and the twilight A/B — and B never recommended it on construction alone |
| `RING_DEDUPE` | BUILT-OFF pending a roof re-certification (§5b) |
| `SKY_PROCEDURAL` | NOT BUILT (design row) |
| `FRAME_STEP` | **a "NOT LANDED" row, not half a feature**: the sim half and its probe are in and green; **no consumer reads the smoother pose**, and wiring one cannot be certified in a venue whose fleet pins its poses THROUGH `flight.pos` |
| `TERRA_PACE.skirtWorker` | node-identical; **needs ONE real-hardware run** (the LERC path is 403 here) |
| `TERRA_PACE.bendSphere` (T14) | **needs ONE real-hardware run**: turning it on submits far tiles that are culled today, i.e. a draw-count change against frozen ceilings |
| `TERRA_PACE` {`parallelLoad`, `imageBitmap`, `preUpload`, `lodOutsideRender`} | **NOT IMPLEMENTED this round** — W0 scaffolding that no patch reads. Turning one on changes nothing; they are not awaiting a run |
| `TERRAIN_LIGHT.workerNormals` | 3.34° → 0.26° in node, zero pixels behind it, and ON makes A's identity leg RED by design |

**None of the built-off switches may be counted as certified by a green node
smoke.** A green smoke says the tree still holds its data contracts; it says
nothing about a code path this container cannot execute.

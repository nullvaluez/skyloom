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
- **The horizon seam cannot match by construction**: closed-form delta per 255
  — noon **9.3** / golden **19.9** / night **76.3** / twilight **99.2** / Neon
  rim **89.4** → **0.000**, with zero constants moved (any gain ≠ 1 re-opens
  the seam, so the budgeted re-tune was refused).
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
`r24-b-prewarm-proof.mjs` (**9/9**, `--red` **5/9** against the defective
`06b8f1d`; gates 1–2 self-calibrate against base `6116fc5`, the invariant being
*B added nothing here*). Ledger §8 = **16 mechanisms that can remove a building
from the screen**, each with file:line and its measured before/after; §15 = B's
reading of E's live flash-guard REDs (§4.2).

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
| `verify-classify.mjs` | **PASS** (38 gates) | — | — |
| `verify-warbirds.mjs` | **PASS** | — | — |
| `verify-daily.mjs` | **PASS** | — | — |
| `verify-depth-offset.mjs` | **PASS** 7/7, 185 files; RED **6/7** on base `6116fc5` | — | — |
| `verify-terra-residency.mjs` | **PASS** 21/21 (**22/22** flipped); 22 merges / 17 replaced / 178 refetches → 0/0/0 | — | felt smoothness |
| `verify-c-flagoff.mjs` | **PASS** — 26 gates at `990c7b5`, **37/37** after C's F4 and on the flipped branch (gate (1) asserts the SHIP STATE, so it is green in both passes); **40/40** on the dry tree after the `linearHazeOn` pin added three gates (accessor exported · no other raw reader · the census skips comments), RED-calibrated by an added read in `SkyDome.jsx` | — | — |
| `verify-worker-normals.mjs` | **PASS** 12/12 (3.34° → 0.26°) | — | **pixels** — the spliced worker runs only on the Esri LERC path |
| `verify-skirt-worker.mjs` | **PASS** 8/8 (**9/9** flipped), element-identical | — | end-to-end streaming; ⚠ its identity leg goes RED **by design** with `workerNormals` ON and needs a flag-on ARM, never a re-baseline |
| `verify-lod-fade.mjs` (D's node half) | **PASS** 51/51, reading the declared state | — | — |
| `verify-vendor-three-tile.mjs` | **PASS** 19/19 (**20/20** flipped, incl. gate 16b: the vendored switchboard's own literal defaults every switch to false) | live tile-URL identity (egress) | — |
| `verify-skirt-fast.mjs` | **PASS** 12/12 (**13/13** flipped); 13 cases, 4 bails | — | stalls/min |
| `verify-frame-step.mjs` | **PASS** 10/10 (**11/11** flipped) | — | the consumer opt-in against a pinned harness pose |
| `verify-finalize-pace.mjs` | **PASS** 11/11 as merged; **17** after the rule-1 spike work and **21/21** after the index-container fix (§4.2) | — | whether it removes a FELT hitch |
| `verify-artifact-hygiene.mjs` | **PASS** 5/5, tree clean | — | — |
| `verify-seam.js` **node leg**, offline | **PASS** 9/9 · 149 z14 tiles · Owens `hatchKept` **0** · worst slope 2.5 · ramp 0/149 · 0 seam pairs · manhattan kept **311** `8d36f2aa:89218640:13605`, columbus kept **193** `2eefc447:49bbe703:8715` — **identical to the pre-merge run on `r24/e` alone** | the LIVE hashes stay frozen | the fixture's Owens yields no z14 candidates at all, so gate (1) passes "0 by construction" and is WEAKER here than live |

**The flag-off byte-identity claim is measured, not asserted**: with every R24
flag off, five agents' merges leave the worker's output byte-identical on 149
fixture tiles.

Node gates outside that 15: **`verify-shadow-calm.mjs` 32/32 (33/33 flipped)**,
`verify-atmo-law.mjs` **41/41 (45/45 flipped)**, A's
`scripts/_r24a-ship-state.mjs`, B's `r24-b-prewarm-proof.mjs` **9/9** / `--red`
**5/9**, and B's four engine/worker/bend/groundvis proofs — the source of every
Symptom-A number in §1. E's **`verify-import-integrity.mjs`** (RED 3 files /
8 errors on the broken tree) is the FIRST node row on E's head `3a21403`, which
merges after the run; the 15/15 above predates it.

### 4.2 Browser gates — two passes

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
| `verify-fixture.js` | **rc=0, 2,045 s, 10/10** at K=200 with a 900 s settle cap. (1) deterministic bytes — mvt 12,021 B / dem 1,817 B / img 46,864 B; (2) the 200-with-empty-body tile reachable; (3) satellite boots the fixture in **124.1 s** (`pct 100` at 54.6 s), img 74 / dem 74 / mvt 67 / tilejson 20; (4) **Manhattan is a city** — satBuilding meshes **22**, tris 496,466, settled in **256 s** at load 4.1, draws **189**, meshes 216 (satBuilding 22, satSkyline 10, toyChunk 110), sb **16/16**, maxZ 14, tiles 125; (5) **Powell is a suburb** — 16 satBuilding meshes, sb 16/16, draws **194**, tris 368,119, **parcel homes 555**, settled 200 s, maxZ 15, tiles 161; (6) **THE OWENS LOCK** — bld 0 / sky 0 / parcel 0, draws **166**, tris 183,709, sb ready 0 / **empty 16**, settled in **38 s**, maxZ 16, tiles 177 (FIXTURE column, informational against the live ≤ 261); Melton draws 184, tris 486,321, **1,836 parcel homes from zero footprints**; (8) traffic stub 300 tracks, 69 aircraft requests; (9) toy boots on the fixture — toyChunks 98, tris 273,567, boot 141.3 s, draws 212; (10) both boots clean | **rc=1, 1464 s, 9/10 at K=200 with a 900 s per-pose cap (22:41:29) — the venue certifies itself again on the flipped tree, and the ONE red is the tree's own missing fix.** Deterministic bytes unchanged (mvt **12,021** / dem **1,817** / img **46,864** B); the 200-with-empty-body tile reachable; satellite boots in **122.2 s** (`pct 100` at **53.4 s**; img 68 / dem 64 / mvt 64 / tilejson 20); **Manhattan is a city** — 23 satBuilding meshes, **549,471** tris; **Powell is a suburb** — 16 meshes, **16/16** chunks ready, 0 empty; **THE OWENS LOCK HOLDS** — 0 buildings / 0 skyline / 0 parcels, draws **219** (FIXTURE column, informational against the live ≤ 261); traffic stub reaches the engine (300 tracks, 53 requests); **toy boots** — 302 chunks, **375,424** tris, 130.2 s. **(10) no page errors FAILS on toy: `TypeError` `byteLength` ×3 — which is `ec53fd3`, the tree WITHOUT A's index-container fix, so it is the EXPECTED red**; the fix is in the pushed tree from `8240539` onward and B's census is node gate 17 from merge 13. **CERT DONE 23:05:53**; the dev server was killed by PGID and the port released; logs `scripts/r24-out/cert3/` **CLOSED.** Gate (10)'s red was toy's `byteLength` ×3 on `ec53fd3`, the tree WITHOUT A's index-container fix — **closed by that fix, confirmed by node gate 17 (`r24-b-attr-proof.js`) reading `BROKEN=0` on `9bcaace`** where the un-pinned run on `ec53fd3` read 80. **No browser fixture re-run is planned**, so this row's final result is the 9/10 above plus that node confirmation | — | n/a — it certifies the venue |
| `verify-flash-guard.js` | **rc=1, 534 s, 5 passed / 1 failed — RED calibrated**; legs below. **Three readings that change how the flag is described:** the **skyline site is INSURANCE, not a fix** — its path runs `simplifyRing` before the wall loop and the collinearity test drops the closing clone, so the zero-length wall edge never exists there and a green at that site repairs nothing (recon A1b predicted it; nobody had measured it — B ledger §15.1); **Powell's 8.28 % lands inside R22.1's live 6.36–8.64 % band** while Manhattan's worst chunk at **13.98 %** is above it, the expected shape rather than a contradiction (the band was quoted for *every large chunk*, the defect is a fixed count per ring, so a chunk with small or few footprints is proportionally worse — B's 4-corner fixture reads 14.22 % for the same reason); and **the toy site is NOT EXERCISED by any row this round** — both poses run satellite, the toy extruder carries the same wrap-around loop at `vector-tile.worker.js:4285`, and the close ruled no toy leg is added, so B's node legs (toy `full` **14.84 % → 0**; 2,288 → 0 on E's Manhattan tile) are **evidence that the code works and not a certified browser leg**. **`(4) PALE DETECTOR` — `frames=256 pale=168 worstScanlineMean=222.3` — is VOID and must never be quoted as a result**: the scanline sat 55 % up the frame and a banked serpentine spends much of its time looking at a clear daytime sky (~213 luma), so 168 identical-mean frames are a sustained bright FIELD, not the one-frame jump the detector exists to catch — R17 §7.1 arriving as false POSITIVES for once. Fixed at `r24/e e1b7905` (running median of 24 frames, scanline at 0.25 height bottom-up, a hit needs jump > 60 over the median AND min > median + 40 AND absolute > 180; renamed `worstJumpOverMedian`), **not yet RED-calibrated** — it owes a synthetic one-frame jump scoring exactly one hit and a serpentine scoring zero | **pass 2b: rc=1, 571 s, 6 passed / 1 failed — the census is ALIVE, the green leg is void again, and the detector lost its own self-test** (below). **RE-TAKE: rc=0, 1423 s, 8/8 — `FLASH_GUARD`'s FIRST GENUINE GREEN**, on `9bcaace`, started 23:39:02, K=40, load 4.29 / 4.20 / 3.70. **(1a)** the census has something to count at Powell — **165,520 tris across 16 meshes**; **(2) RED calibration: the zero-area population EXISTS** with `__flyFlashPin=off` — **13,766 zero-area triangles (8.32 %)**, and the gate is RED-valid *only* because that is > 0; **(1b)** Manhattan census non-empty — 171,432 tris across 16 meshes; **(4a) no false positive** — the banked serpentine registers **ZERO isolated pale frames in 668** (worst jump over median 77.1 against a baseline 20.2); **(4b) the detector FIRES** — one synthetic white frame registers **EXACTLY ONE hit** (f 670, mean 255, median 20.2, min 255, candidate true); **(3) GREEN — the zero-area count is EXACTLY 0 at every site with the guard armed** (tris 151,754); **(5)** the degenerate RATE falls and never rises — sat-buildings **8.32 % → 0.00 %**; **(6)** no page errors. **INFO (4)**: the pale detector is probabilistic and **absence is NOT proof** — armed, 668 frames, 0 pale, 0 sustained. **What makes this verdict mean something, against the two voids**: pass 2a's census read **0 meshes** (the venue starved by `mayFinalize`) and pass 2b's green leg read **0 meshes** (page 1 still rendering) with **(3) printing PASS on nothing** and the self-test scoring 0; this run closes page 1 BEFORE the armed page boots, settles both legs on `_settle.js`'s condition rather than a fixed 60 s, and scores the self-test frame OUTSIDE the run-length bookkeeping — so the armed census is **non-empty for the first time** and (3) reads 0 **on a real population**. **The settles are what cost the 1,423 s and what made it valid**: RED leg Powell **SETTLED at 422 s** (16/16 ready, maxZ 17), GREEN leg Powell **SETTLED at 274 s** (16/16, maxZ 17) — **(3) reads zero=0 over tris 151,754 where 2a and 2b read zero=0 over tris 0**. **(5) is deliberately a RATIO** because the two boots settle different chunk counts, and **Powell's 8.32 % sits inside R22.1's live 6.36–8.64 % band, so the fixture still stands in for the real defect**; **(4a)'s 0 isolated / 0 sustained against 2b's 3 sustained runs is a BASELINE difference** — 20.2 here, a dark ground scene at the scanline, against 237.8 sky there. **CAVEAT 1: Manhattan did NOT settle** — 12 of 16 chunks still draping at 420 s, ready 4, maxZ 16 — so its census (6 sat-building meshes, 87,680 tris, worst chunk 13.97 %) is a **FLOOR**, (1b) passing means only that the census had something to count, **the A/B lives in the Powell pair and Manhattan is corroboration at best**. **CAVEAT 2: `FLASH_GUARD telemetry: null` still** — the runtime pin and the constant are different switches — **so (3)'s green rests on the census, not on the feature announcing itself** (§5b, for B) | PENDING — the pale FRAME itself | the pale detector is probabilistic (live rate 1 per 1,600 to 1 per 20,389 composed frames); **the census decides the gate** |
| `verify-fade.js` | **rc=1, 338 s, 4/2 — RED calibrated.** (1) births **14** / deaths **10** over 94 frames; (2) **14 of 14 hard births** — *"presence channel is none: no material carries a fade uniform"*, which IS the flag-off state; (3) **10 of 10 hard deaths**; (4) `ready` tracks CHUNKS, not presence (ready 0 of 16 during the serpentine); (5) **THE OWENS LOCK — sbReady 0, skyReady 0, draws 156** (a FIXTURE number; the live ≤ 261 is not re-baselineable from here); (6) clean. **GREEN needs pass 2** — the gate carries no ON pin | **rc=1, 346 s, 4 passed / 2 failed — the flip did not produce a fade VISIBLE TO THE GATE; ATTRIBUTION PENDING.** With `CHUNK_FADE` + `HEAL_IN_PLACE` ON in constants: (1) births **29** / deaths **20** over 122 frames; (2) **29 of 29 HARD births**, with the probe's own note — *"presence channel is 'none': no material carries a fade uniform or transparent opacity — this IS the flag-off state"*; (3) **20 of 20 hard deaths**; (4) `ready` tracks CHUNKS, not presence (ready 4 of 16 in the sweep, series in the log); (5) **THE OWENS LOCK — sbReady 0 / skyReady 0 / draws 190** (FIXTURE), against **156 at the same pose on the flag-off pass**: the flipped tree adds **34 draws at Owens**, still ≤ 261, **and that delta is NOT attributed here**; (6) clean. **ATTRIBUTED, from source, and it is the INSTRUMENT's**: `verify-fade.js:81-95` `presenceOf()` looks for `material.uniforms` named `uBirth` / `uChunkFade` / `uFade` / `uChunkBirth`, or `material.transparent` + `opacity` — but `CHUNK_FADE` rides a POOLED TWIN `MeshLambertMaterial` whose fade uniform is injected through `applyBendAnchor*(material, uniform)`, an **`onBeforeCompile` uniform and not a `material.uniforms` entry**. B had already published the read handle **on purpose** — `lib/fly/toy-world/chunk-fade.js:98-102`, `t.material.userData.__fadeU = t.uniform`, *"so a probe can read the EFFECTIVE fade"* — in both engines (`sat-skyline-engine.js:163-171`, `sat-building-engine.js:345/821-868`), and it is listed in B's own §10 hand-off table to E. E is fixing `presenceOf()` to read `__fadeU` first (channel `'__fadeU'`) while keeping the `'none'` verdict for the flag-off tree; **the fade row joins flash-guard in the standalone re-take after pass 2b's end line** — with E's probe commit (`r24/e fcb168a`, `+27f36e8`) in, and **a second defect that B's point (b) exposed INSIDE E's first fix**: the channel label used `??=`, first-write-wins, and **the first mesh sampled is almost always one at rest**, so the row would have printed "presence channel = none" AGAIN with `__fadeU` being read correctly. The label is now **the most specific channel seen anywhere in the run**, self-test (5c) is exactly that sequence (rest sample first, ramp sample second), (3) prints `hardDeaths` against `fadeBudgetMiss` under B's rule, and the probe has its own RED (`FADE_PROBE_SELFTEST=1`, **7/7**) that extracts `presenceOf` from the file's own source — which first matched three characters of its own COMMENT, so the marker is built by concatenation now, and which must run before `require('playwright')`. **E then took the further step (`r24/e 4972f14`) of having the gate PRINT B's reading rules beside its own verdicts** instead of leaving them in a ledger: deaths are expected at ≥ 3 partial samples on this venue, with the birth/death asymmetry explained in the gate's own output — **a naive "≥ `minFrames` partial samples" would have gone RED on a correct implementation, for every death** — and the heal taxonomy is read in full (`healsInPlace` is the fix working, `healsAborted` moot, `healsNoRecord` water-only, `healsCoalesced` a re-drape in flight, `redraping` draining, and **only `healsQueueFull` is a hole**), with an explicit **"unpublished"** verdict instead of a silent fallback to the total: this run's "heals 9" **is uninterpretable on its own, which is the point**. Probe self-test 7/7. B's source read at `ec53fd3` completes the picture and sets the re-take's expectations in advance: `__fadeU` is published in **ONE** place, `TwinPool._newTwin` (`chunk-fade.js:102`), and both engines build their twins through that pool (`sat-building-engine.js:345`, `sat-skyline-engine.js:167`), while the GLSL uniforms are `uSatBldgFade` / `uSkyFade` — **neither in the gate's guessed list**. The twin sits on a mesh **only during a ramp**: on birth completion the shared material is restored and the twin returns to the pool, and dying meshes leave the scene, so **a resident chunk at rest has no `__fadeU` and "absent" is presence 1 BY DESIGN**. A birth's first displayed frame is presence **0** (`_startBirth` writes 0 in the same synchronous block as `object.add`, `:847`), so **all 29 births are expected SOFT once the probe reads the handle**. A death's first frame is presence ≈ **1** by construction (`_startDeath` writes `_altFade`, 1.0 at the certification poses, `:873`) and the ramps are **TIME-ONLY**, so at this venue's **2.84 s per frame a 0.3 s evict ramp cannot span two samples** and every death reads hard regardless of budget — a venue effect (0.3 s is 18 frames at 60 fps) that **B fixed in the PRODUCT** (`r24/b 45e2cde`, held until pass 2b's end line and merging with E's probe fix before the re-take): a frame-count floor, `progress = min(elapsed/sec, framesSince/CHUNK_FADE.minFrames)`, in both engines and both ramps through `rampT` (records carry `f0`; `_stepFades` advances a monotone `_fadeFrame`). **`minFrames` is 4, not the 3 asked for, and B flagged the difference with the arithmetic**: a birth starts at presence 0, so N frames give N partial samples, while a death starts at full presence BY DEFINITION and N frames give N−1 — so "≥ 3 partial samples on a death" needs **4**. At 60 Hz, 0.3 s is 18 frames ≫ 4, so elapsed governs and **shipped behaviour on a normal machine is unchanged by construction**. Proof rows (`r24-b-engine-proof.js`): `--dt=2.84` (this venue) **pops 0** against 92 flag-off, births ≥ 1 and deaths ≥ 3 partial samples; `--dt=0.0167` (60 Hz) pops 4, **all `fadeBudgetMiss`**, deaths ≥ 17 partial — elapsed governs, ramp length unmoved; `--dt=0.0167 --hitch` **pops 0**, so a 500 ms frame mid-ramp can no longer complete a ramp; `--off` **pops 92 / 0 ramps**, byte-identical RED. Caps: `maxConcurrent` 8 births is unreachable in the serpentine (`finalizePerFrame` 1 per engine, ~2 in flight), while `maxDying` 4 CAN be exceeded by the eviction loop (`:1077`) and the AGL cull (`:1020`), so the re-take's hard-death count is read against the cumulative `stats.fadeBudgetMiss` (`:843`/`:857`) — **`hardDeaths ≤ fadeBudgetMiss` is capped as designed, greater is a defect**. **The re-take's expected reading, written before it runs: births SOFT, deaths spanning ≥ 3 partial samples (`minFrames` 4), hard deaths ≤ `fadeBudgetMiss`** **RE-TAKE: rc=1, 380 s, 4 passed / 2 failed — the probe now SEES the fade, and what it sees is a PARTIAL result.** On `9bcaace`, started 00:02:45, K=40, load 4.12 / 4.11 / 3.83. **THE CHANNEL IS ALIVE**: presence channel = **`userData.__fadeU`** where pass 2b read `none`, **82 of 114** serpentine frames carried a partial-presence mesh (**was 0**), and the runtime evidence line lists **births / dying / fadeTwins / fadeBudgetMiss** — E's probe fix and B's contract met correctly, and **the first fade reading that is about the FEATURE**. Gates: **(1)** the watch has something to watch — births **26**, deaths **11** over 114 frames **PASS**; **(2) NO HARD BIRTH — FAIL, 8 of 26** births at full presence on their first displayed frame; **(3) NO HARD DEATH — FAIL, 6 of 11** deaths leave from full presence with **cumulative `fadeBudgetMiss` 0**, i.e. *"an UNEXPLAINED remainder — this is the defect shape"*; **(4)** a fade never changes what is ready (ready 2 of 16 chunks, series in the JSON) **PASS**; **(5) the Owens lock** — sbReady 0 / skyReady 0, draws **191** (FIXTURE column) **PASS**; **(6)** no page errors **PASS**. **Against pass 2b's blind probe (29 of 29 hard births, 20 of 20 hard deaths), the re-take reads 8/26 and 6/11 — B's fade IS running and the `minFrames` 4 floor demonstrably works for 18 births and 5 deaths.** The remaining 8 and 6 are **honest FAILs, not venue artefacts**: `fadeBudgetMiss` is 0 and `maxConcurrent` never reported exhausted, **so B's own attribution rule convicts rather than excuses them**. The venue note is kept WITH its limit: `_startDeath` writes `value = _altFade` (1.0 at these poses) and the value only moves on the NEXT `_stepFades`, so at ~2.84 s per frame a 0.3 s `evictSec` ramp cannot span two samples — **but the floor was merged precisely to remove that excuse, and 5 deaths DID span partial samples**. **THE HEAL TAXONOMY, E's exhaustive ledger paying off**: heals **9** = `healsQueueFull` **4** · `healsAborted` **4** · `healsCoalesced` **1**; `healsInPlace` **0**, `healsNoop` 0, `healsNoRecord` 0 — **the outcome that IS the `HEAL_IN_PLACE` fix never occurred in this window**, and the 4 queue-full heals are the only real holes. *Without the taxonomy this would have read "heals 9" and said nothing.* **ROUTED TO B** (read-only on the log; merge `r24/int-next` first): attribute the 8 and the 6 **from source** with a synthetic **0.35 fps** clock — the floor in BOTH engines and BOTH directions, `f0` stamped at first display, deaths starting in the same frame as a heal / coalesce / `warpEpoch` bump, parcel and monument twins — a node RED/GREEN reproducing the shape and reading **0/0** after; and **rule whether `healsInPlace` 0 over a 114-frame serpentine is BY CONSTRUCTION** (saying what window would exercise it) **or a defect**. Marker stands — B has it <!-- CERT:verify-fade PASS2 PENDING -->| PENDING — the LOOK of the fade | — |
| `verify-lod-fade.js` | **rc=1, 317 s, 2 passed / 5 failed — RED calibrated** (Powell, a 40 s PURE YAW with the position frozen). (1) `residentTiles` 0 / `estMB` undefined — A's byte LRU only tracks with `TERRA_PACE` on, expected in pass 1; (2) 47 frames, 61 events; (3) **27 RE-appearances on a pure yaw** = A's T1/T3 bend-blind re-stream, measured from the other side; (4) **8 hard refines + 3 hard merges** = D's T4 atomic swap; (5) crossfade window **0 frames**; (6) **15 tile URLs refetched**, worst 2× `/img/6/23/17` = A's refetch defect; (7) Owens FIXTURE draws **174** / tris **166,659**; (8) zero page errors. **Scope of the wall-clock caveat, narrowed:** it applies to **(3) and (6) ONLY** — both are functions of how far the heading moves per download round-trip, and this sweep steps ~51° per rendered frame (PASS 2 cell). **(4) hard refines + merges is yaw-rate INDEPENDENT** — an atomic parent↔children swap is atomic at any heading rate — **so it stands as D's T4 RED and §1 Symptom B's citation is unqualified.** **(5) has since been RETIRED**: its 0 is true at any rate but carries no information, because a mesh co-display census reads 0 by construction under `parentBlend`, and recording it in the RED table as a defect was an error of this record's own — corrected here, and replaced in the gate by `maxBlendRun` over `terra.fades.active` (PASS 2 cell). The re-take's OFF leg re-measures all four, so the record will end up carrying both experiments for (3)/(6) and one consistent RED for (4)/(5). **A gap the row exposed:** as written the gate has **no ON leg** — it never sets `window.__flyLodFadeOverride` — so the one feature that ships OFF *pending a measurement* could not have obtained it from either pass. E is adding a pinned ON leg for pass 2 (D reviewing it, §5.2); expected then: (3) and (6) GREEN from `TERRA_PACE`, (4) and (5) still RED in the OFF leg because LOD ships OFF, and **the pinned ON leg decides D's go/no-go** | **PASS 2b: the row CRASHED after gate (13)** — `ReferenceError: notCalibrated is not defined at scripts/verify-lod-fade.js:782`, gate (14)'s NOT CALIBRATED path calling a helper the file never imports: **the round's own unimported-symbol class (§5.1), this time in a HARNESS file**, which `verify-import-integrity` could not catch because it sweeps `lib/`, `components/`, `app/`, `hooks/` and `stores/` and not `scripts/` — E is extending it, with this as its RED. **What it measured before dying is still the most useful pair of legs in pass 2b.** OFF leg (LOD off, `TERRA_PACE` shipped): `terra.fades` refines **4** · merges 0 · hardSwaps **4** · faded **0** · `skip.disabled` 4; sweep 46 frames, **0 re-appearances**, 4 hard refines, window 0, 20/59 refetched (the wall-clock artifact), Owens **229** draws (FIXTURE — the flag-off pass read 174 at this row's Owens pose), (8b) ladder identity 4+0 = 4+0. ON leg (`__flyLodFadeOverride {enabled:true, skipBootMs:0}`, second context): (9) `TERRA_PACE` unpinned on BOTH legs; warp settle steady at 3 after 17 rendered frames; drain "held after 26 rendered frames"; sweep 26 frames · 8 appearances / 2 disappearances · **0 re-appearances** · frame-diff hard 2+0 · co-display run 0; `terra.fades` refines 4 · merges 0 · **hardSwaps 0** · **faded 4** · `active` NOW **8** · `retained` **2** · `peakActive` 8/32; every skip reason 0 (disabled, boot, warp, concurrency, shape, noParentMap, unpatched); (10) armed, (11) 4 swaps offered, (12) no defect denials, (13) 4+0 = 0+4. **So the REFINE path armed and blended on D's own counters — hardSwaps 4 → 0, faded 0 → 4 — while the MERGE path stayed unexercised (merges 0 on both legs), exactly as D predicted.** **D'S READING RESOLVES BOTH OPEN QUESTIONS.** (1) **The refine path is PROVEN**: hardSwaps 4 → 0, faded 0 → 4, all seven skip reasons 0 and the ladder identity on both arms — `skip.disabled` 0 proves the pin reached the ladder, `skip.unpatched` 0 proves it arrived BEFORE material patching. (2) **`active` 8 / `retained` 2 is ARRIVALS, not stuck blends and not the leak**, on three grounds: `waitUntil` returned "held", so **`active === 0` WAS observed**; `retained` counts distinct parent TEXTURES while `active` counts MATERIALS, and a refine arms four children off one texture, so **8/2 is exactly two refine events in flight — a 4:1 ratio no stuck set lands on by coincidence**; and `skip.concurrency` 0 with `peakActive` 8 of 32. Between the drain returning and the later read the yaw interval kept pinning the final heading — **the camera stops but the streamer does not** — and each `page.evaluate` round-trip is several rendered frames, so two more refines landed. **The 26-frame drain does not prove the absence of a leak and cannot, as written**; the signature is exact, from `finish()` releasing every owned texture before deleting from `_active`: **LEAK ⟺ `active === 0` AND `retained > 0`**. The re-take therefore asserts (16) on the snapshot taken at the INSTANT the condition held, takes a SECOND read N frames later with `refines + merges` to attribute arrivals (INFO) against stuck (FAIL), asserts the leak signature on both reads, and adds the free invariant **`retained ≤ active ≤ 4 × retained`** while only refines are in flight. (3) **(5) reads 0 by construction, FOREVER**: mode `'parentBlend'` never keeps the parent mesh drawn — it blends the parent TEXTURE into the child material through clip-UV and disposes the parent model as upstream does, for zero extra draws. The measurement needs no app change: sample `__flyStats.terra.fades.active` per frame, and **the longest run of `active > 0` IS the crossfade window**, with per-tile `__lodFade.mix.value` strictly in (0,1) as an INFO row. (4) **`merges` 0 at every pose is `keepResident` WORKING** — frustum-exit merges no longer happen — so chasing them would measure a tree that does not ship, and the merge path is recorded as **structurally gated only**. (5) **Nobody had flagged this**: gate (14) would have gone NOT CALIBRATED on this run — framesOFF 46 against framesON 26 is **0.57, outside the ±25 % band** — and the refine counts matched at 4 **by luck**, so the old literal gate would have printed a meaningless green. **The [C3] guard earned its place on its first outing**, and it is the strongest argument for the frame-based yaw. **E's REWORK is committed** (`r24/e cba7b45` + `356e32d`, held for the pre-re-take merge; node smoke 16/16, import-integrity 4/4 over 374 files): the yaw is now **0.85°/frame on rAF with a 360° minimum arc**, `FLY_LOD_SWEEP_MS` bounding wall time at the old 40 s default, arc and frames printed beside every verdict, (3) and (6) **NOT CALIBRATED on a short arc**, and both legs sharing the sweep; **D's spec is applied in full** — drain snapshot at the instant the condition held, a second read 12 frames later with `refines + merges` (advanced ⇒ arrivals INFO, flat with `active > 0` ⇒ stuck FAIL), the leak signature `active === 0 && retained > 0` on BOTH reads, and the invariant `retained ≤ active ≤ 4 × retained`; **gate (5) is RETIRED as the crossfade measurement** — a mesh co-display census reads 0 by construction forever under `parentBlend`, **and its 0 had been written into the RED table as a defect** — replaced by `terra.fades.active` sampled per frame (`blendFrames`, `maxBlendRun` = the crossfade window, `peakActiveInWindow`) plus an INFO row over `material.userData.__lodFade.mix.value` in (0,1); and `merges` is printed as UNEXERCISED because `keepResident` works, not chased. **D's read of that diff found three corrections, all in**: [E1] three-tile tile meshes carry a material ARRAY (`super(g, m ?? [])`, `syncMaterials` assigning `this.material[i]`), so the mix census read `.material.userData` on an array and **would have printed "0 materials carry `__lodFade`" on every healthy run, with a fallback that made it look expected** — it now iterates the array as `terrain-engine`'s `onTileMaterial` does, keeping the equalities `mixes.length` = patched materials and `midRamp.length` = `active`; [E2] **(16d) was VACUOUS on a healthy run**, guarded on the snapshot that SATISFIED the drain — where `active === 0` by definition — so it only ever evaluated on a CAPPED drain, and is now evaluated on the second read; [E3] **(16b) turned a missing snapshot into "the blends are stuck"** (null falling into the else) and now reads NOT CALIBRATED. D's measurement note goes with them: **0.25 s of fade clock is 5 clamped frames at any fps, so `maxBlendRun ≥ 5` is a COMPLETE blend and a shorter run means the sweep ended mid-blend.** D is writing the go/no-go template, so the call is mechanical when the re-take's numbers land. **`LOD_CROSSFADE` stays OFF and its FLIP marker stays PENDING** until then <!-- CERT:verify-lod-fade PASS2 PENDING --> | PENDING — whether swaps are still visible at real frame rate | the fade's real DURATION (a 250 ms blend completes inside one SwiftShader frame) |
| `verify-step-clean.js` | **rc=1, 229 s, 4/4 — RED calibrated**, viewport DPR 1.5, governor pin RELEASED (the fleet's `'hold'` was written and the accessor swallowed it). (0) pin released; (1) **the released term is reachable** — 6/6 forced steps ACCEPTED, 6 DPR applications, DPRs seen `[1.25, 1.5]`; (2) **18 of 18 `canvas.width/height` writes OUTSIDE a rAF** (width 1600 at t=171932, `inRaf:false`); (3) `setPixelRatio` 6/6 and `setSize` 12/12 outside; (3b) `composer.setSize` **6/6 outside** — the passive-effect lag; (4) `bufferMatchesDrawing` **false on 22 of 46 frames** (composer 1920×1080 vs drawing buffer 1600×900 at frame 7); (5) the composer is **RESIZED, not rebuilt** — rebuilds 1 → 1, resizes 6, R21's `FX_STABILITY` holding; (6) clean. GREEN for (2)/(3)/(3b)/(4) is expected in pass 2 with `STEP_SAFE` on. **The gate states in its own output that the tear LINE is not measurable here** | **HALF GREEN — the composer lag and the buffer mismatch are CLOSED; a DPR double-apply is OPEN.** `rc=1, 241 s, 6 passed / 2 failed` with `STEP_SAFE` + `LADDER_FIX` ON, DPR 1.5, pin released. Closed by the flip, pass 1 → pass 2b: **(3b) `composer.setSize` outside a rAF 6 of 6 → 0 of 6** — the −99 rig owns the composer resize; **(4) `bufferMatchesDrawing` mismatched frames 22 of 46 → 0 of 43 — the mechanism behind the tear symptom that this gate CAN see is closed**; (5) composer resized, not rebuilt, 1 → 1 in both passes; (0)/(1) pin released with 6/6 forced steps, 12 DPR applications, dprs [1.25, 1.5]; (6) clean. Still red, and the shape is precise: **(2) canvas write outside a rAF 18 of 18 → 12 of 30**, **(3) `setPixelRatio` 6 of 6 → 6 of 12 outside and `setSize` 12 of 12 → 12 of 24 outside** — **EXACTLY HALF of every canvas/renderer write with the rig on: 6 steps, 12 applications, 6 inside and 6 outside**, i.e. **a SECOND WRITER applies the DPR outside the frame alongside A's rig** (the legacy apply path, or R3F's own `setDpr` effect not suppressed when the rig owns the step). **ATTRIBUTED and FIXED** (A `a0c1484`), and it is **neither hypothesis strictly**: `FlyCanvas` holds the DPR in React state, so the `setDpr` the rig calls IS that React setter — the rig applies to three inside the frame (**the 6 inside**), `setDpr` schedules a commit, r3f's Canvas layout effect runs an **AWAITED** `root.configure({dpr})` (`react-three-fiber.esm.js:62-77`) so the store write lands a task later, and **r3f's zustand subscriber** (`events-b389eeca.esm.js:1158-1166`) re-applies `gl.setPixelRatio` + `gl.setSize` **outside any frame** (**the 6 outside**). Per application three does one `setPixelRatio` (which calls `setSize` once) plus one explicit `setSize`, so six rig + six r3f = **12 `setPixelRatio` and 24 `setSize` with exactly half outside — the log to the number**. So it IS r3f, **triggered by the rig's own `setDpr`, and therefore within the flag's reach**. THE FIX: `installResizeGuard`, installed by the rig from an effect keyed on the renderer — **a resize request for the state the renderer is ALREADY in does not reach the canvas**, and only that case (a real DPR step and a real container resize still resize; an unsettled CSS style delegates; `xr.isPresenting` and a non-null `renderer.output` always delegate); on a skip it still calls `setViewport(0,0,w,h)`, **the one side effect a bare return would drop, so the skip is a semantic no-op**; `window.__flyStats.stepGuard` counts suppressed calls. Three alternatives were rejected with reasons: dropping the rig's `setDpr` leaves `viewport.dpr` stale so the next container resize re-applies the stale value; `flushSync` is defeated by the await; and shadowing `canvas.width/height` suppresses the reallocation but not the CALL, with a greenness that would depend on instrumentation ordering — **"a fix whose proof depends on instrumentation ordering is not a fix"**. NEW GATE `scripts/verify-step-guard.mjs`, **13/13 node-only**: the decision table against a fake renderer **re-derived from `three.module.js`'s real source text** (gate 0, 7 behaviours), gate 1 a standing RED control on an unguarded renderer, RED-calibrated by neutering the guard (gates 2 and 10 fail) — **and that RED arm caught two instrument bugs of A's own on its first run** (the fake counted a write only when the VALUE changed, scoring the defect zero; the shim froze `STEP_SAFE` at import, so the flag-off row tested the flag-on build). E's `verify-step-clean.js` is unchanged, because its (2)/(3) failed HONESTLY and the guard makes them true, and E adds a `stepGuard` assertion. **Expected re-take, written in advance: (2) 0 outside, (3) 0/6 and 0/12, and the TOTALS falling too** (`setPixelRatio` ~12 → 6, `setSize` ~24 → 6–12) **so a drop reads as the fix and not as lost work**. E's `d9e5d57` also lands **(7) in A's safest form** — per accepted step, `step.n` +1 AND zero outside-rAF writes AND `stepGuard` strictly increased, with **the totals drop PRINTED, not failed on** — and `scripts/_pageerrors.js`, which dedupes by message, counts repeats and prints the first three UNIQUE exceptions with their first non-vendor frame, wired into all ten R24 gates plus ladder-fix and terra-live. Step-clean joins the standalone re-take **RE-TAKE: rc=0, 260 s, 9 passed / 0 failed — `STEP_SAFE` CERTIFIED ON THE VENUE.** On `9bcaace`, started 00:09:05, no K, load 4.64 / 4.23 / 3.95. **(0) the pin is released** — the fleet wrote `'hold'`, the accessor swallowed it, live pin null, `__flyGov` an object, `devicePixelRatio` 1.5; **(7) ONE APPLICATION PER STEP, INSIDE THE FRAME** — 6 accepted steps, `step.n` +1 each, **zero writes outside a rAF**, and `stepGuard` strictly increased at every step (**{setPixelRatio: 1, setSize: 2} per step — that is r3f's re-apply being SUPPRESSED, A's second writer, counted rather than argued**); **(1)** the released term is reachable — **6/6 forced steps accepted**, 6 DPR applications, DPRs seen [1.25, 1.5]; **(2)** every `canvas.width/height` write inside a rAF — **0 of 12 outside**, where pass 1 read 22 of 46 and the pre-guard flipped tree read 0 of 43, **and the TOTAL itself fell 43 → 12 as the redundant r3f calls stopped — A's prediction, measured**; **(3)** every `gl.setPixelRatio` / `gl.setSize` inside a rAF — **0/6 and 0/6 outside**; **(3b)** every `composer.setSize` inside a rAF — **0/6 outside**, where the passive-effect lag read **6/6** before A's `registerComposer`; **INFO (4)** `bufferMatchesDrawing` frames 65, mismatches 0; **(4)** never goes false — **0 mismatched of 65**; **(5)** the composer is **RESIZED, not rebuilt**, across a step — rebuilds 1 → 1; **(6)** no page errors | PENDING — and the ladder the user's real DPR has | the tear LINE |
| `verify-ladder-fix.js` | **rc=0, 90 s, 13/0 — GREEN, and a measured ON leg**: the gate boots TOY and arms `LADDER_FIX` + `STEP_SAFE` through their runtime pins. (1) **two sub-native rungs on a DPR-1 display**, 0.875/high and 0.75/high; (2) both BEFORE the first tier rung (last sub-native index 2, first tier rung 3); (3) boot rung still index 0 at native DPR and boot tier; (4) tier rungs unchanged in order and count; (5) refresh estimated from the frame cadence = **144 Hz**; (6) `nativeRefresh` target **144** vs refresh 144; (7) **a stuttering session steps DOWN on a healthy mean** — rung 3 at `emaFps` **53.4** (at/above the 51 fps down bound), `longFrac` 0.1, the pattern the EMA cannot see; (8) CONTROL: a clean 60 fps session never steps (rung 0, dprSteps 0, tierSteps 0); (9) dpr steps [0.875, 0.75, 1] then tiers ["medium"]; (10) a forced step moved the ladder 0 → 1; (11) **`STEP_SAFE` applied it INSIDE a frame, not via the valve** (n=1, `applyMs` 466.8 — a SwiftShader number, `composer=true`); (12) composer buffers ARE the drawing buffer ([560, 315] both); (13) clean. **The R20 flap condition `[1/high, 1/medium, 1/low]` is now the five-rung ladder, measured**  | **12/13 — every ladder gate GREEN on the flipped tree.** `rc=1, 82 s` (22:01): two sub-native render-scale rungs (0.875 / 0.75, tier high) BEFORE the first tier rung; boot rung index 0 at native DPR; tier rungs unchanged (medium, low); refresh estimated **144 Hz and the target FOLLOWS it** (144 vs 144, `nativeRefresh`); a stuttering session steps DOWN at `emaFps` **53.4** with `longFrac` 0.1; the clean-60 control takes **0 steps**; rungs are spent before any tier step ([0.875, 0.75, 1] then ["medium"]); a forced step 0 → 1 is applied by `STEP_SAFE` **INSIDE a frame** (n=1, `applyMs` **2.5** — a real number now, not the 466.8 of the SwiftShader-contended pass-1 run — `composer=true`); composer buffers == drawing buffer [560, 315]. **Gate 13 FAILS**: the TOY boot throws an uncaught `Cannot read properties of undefined (reading 'byteLength')` **31 times** — **ATTRIBUTED (below) to `FINALIZE_PACE`'s toy index container, not to the ladder flags, and FIXED in A's `e7325cd`**; the ladder-fix re-take is the census leg <!-- CERT:verify-ladder-fix PASS2 PENDING --> | PENDING — governor behaviour in real time, on the user's real DPR and refresh | the tear LINE; every fps/ms number |
| `verify-ladder-fix.js` + `FLY_LADDER_RED=1` (the control arm) | **rc=1, 94 s, 7 passed / 6 failed — EXACTLY the expected RED, i.e. the control arm is a control.** (1) **0** sub-native rungs; (2) last sub-native **−1**, first tier rung **1**; (6) target **60** vs refresh 144 — the 60 Hz cap; (7) rung 0 at `emaFps` 53.4 with `longFrac` **0**, no stutter step-down; (9) dpr steps **[]** then tiers **[]**; (11) `STEP_SAFE` "no record"; controls (3)(4)(5)(8)(10)(12)(13) pass with buffers [640, 360] matching. **A's hardening of the omitted-pin trap, holding on the flag-off tree** (lesson 26) — and E confirms at the close that **`ec53fd3` contains A's FORCING version**, so pass 2b's 7/6 was measured by a RED arm that pins both features off rather than merely omitting the pin: **that calibration is real** | **the RED calibration HOLDS on the flipped tree**, `rc=1, 86 s` (22:02:50): with the ladder flags pinned off, gates 1, 2, 6, 7, 9 and 11 fail — 0 sub-native rungs, target 60 against a 144 Hz refresh, rung 0 at `emaFps` 53.4, no `STEP_SAFE` record. **And gate 13 throws the SAME `byteLength` error 3 times**, which is the row's most useful output: **the page error is NOT `LADDER_FIX`/`STEP_SAFE`**. **ATTRIBUTED — it is A's `FINALIZE_PACE`.** Stated precisely, because the arm's own scope matters: **this arm exonerates `LADDER_FIX` and `STEP_SAFE` ONLY, and NOT "A"** — `FINALIZE_PACE` is A's too and stayed ON in it — and **the ×3 against the ladder-fix row's ×31 is how many toy LAND chunks reached upload before each row ended, not a different cause**. B's 2×2, node-only against an EXTRACTED `ec53fd3` tree (`git archive`, touching no worktree): `FLASH_GUARD` ON / `FINALIZE_PACE` ON → **80 broken meshes**; `FLASH_GUARD` OFF / `FINALIZE_PACE` ON → **80**; `FINALIZE_PACE` OFF → **0 in both `FLASH_GUARD` states** — independent of `FLASH_GUARD`, **fully determined by `FINALIZE_PACE`** — and every broken mesh is the toy LAND mesh, the one toy site B deliberately did not guard (B ledger §1.3); `r24/b` alone, with no A code, passes. **ROOT CAUSE, confirmed from source**: `toy-world-engine.js:972` `geo.setIndex(idx)` — under `finalizePaceOn()` (`:943`) the paced branch builds `idx = new Uint32Array(base + extra)`, and three's `BufferGeometry.setIndex` wraps its argument in a `BufferAttribute` **only when `Array.isArray(index)` is true**, so a typed array is assigned RAW as `geometry.index`, has no `.array` / `.count`, and `WebGLAttributes` throws on `attribute.array.byteLength` the first time it uploads it — **once per land mesh, which is the ×31**. The flag-OFF branch builds a PLAIN array, which three wraps and sizes Uint16/Uint32 through `arrayNeedsUint32` — **which is exactly why pass 1 was clean, pass 2b was not, and the ladder-red arm still threw with only the ladder flags pinned off**. B's two side notes for A: the paced branch always allocates Uint32 where the plain-array path lets three choose Uint16 when the vertex count allows — not the bug, but **the ON path silently doubled every toy land index buffer**, and A's fix preserves the type choice — and `setIndex(rawTypedArray)` is a GENERAL trap, so every `setIndex` added this round was checked (Contrail passes a plain array, SatTintLayer a `BufferAttribute`; `:972` was the only one). Two hypotheses were cleared from source: `guardIndex` returns `{ idx: undefined }` for an undefined input in BOTH legs and the pre-R24 line was already `setIndex(new BufferAttribute(data.idx, 1))`, so an absent toy index would throw with the flag off too, and the guarded index is `idx.subarray(0, w)`, a view keeping the source type; `HEAL_IN_PLACE` and `BEND_LEAD` are unreachable on the toy path. **THE INSTRUMENT**: `scripts/r24-b-attr-proof.js` (`r24/b 8bb4164`, one script plus B ledger §17, no other owner's file touched) drives `ToyWorldEngine` headless against the fixture and censuses every geometry index and attribute for a missing `.array` — **the exact shape three reads `byteLength` from — with NO GL context**; `--root=<tree>` with `--off` / `--nopace` reproduces the 2×2; it is RED on the integration tree and PASS on `r24/b`, and E adopts it as the **17th node gate** after the merge. **B's BISECT settles it by exhaustion** (`b459056`, scripts + ledger only): one flag off at a time on the otherwise-flipped integration tree, counting LAND meshes whose `geometry.index` is not a `BufferAttribute` — none **80** · FLASH_GUARD 80 · CHUNK_FADE 80 · HEAL_IN_PLACE 80 · GROUND_VIS 80 · BEND_LEAD 80 · TERRA_PACE 80 · HUD_SYNC 80 · REBASE_CALM 80 · LADDER_FIX 80 · STEP_SAFE 80 · PERF_GOVERNOR 80 · NEON_COVER 80 · STREAM_KEEPER 80 · **FINALIZE_PACE 0 — the only mover.** And proven directly IN three rather than argued: `setIndex(new Uint32Array([0,1,2]))` gives `index.array` undefined and `count` undefined; `setIndex([0,1,2])` gives `Uint16Array(3)` and `count` 3; `Array.isArray(<typed array>)` is false; and reading `index.array.byteLength` reproduces the reported message **verbatim**. **B has no fix sha, and says why**: the defective line does not exist on `r24/b` — `finalizePaceOn` and the typed-array branch arrive with A's merge, and B's tree still carries the base's plain-array block, **which is why B's own attr gate passes there** — so the fix is A's. `attr-proof` gained `--noflag=NAME` (repeatable) and prints `BROKEN=<n>`, so every bisect row is one command against a `git archive`-extracted tree. **FIXED: A `e7325cd`**, verified by the orchestrator on the dry merged tree. Both halves: the index is **wrapped** (`idx = new BufferAttribute(merged, 1)`), and its **width mirrors three** — Uint16 unless some index is ≥ 65535, lifted from `arrayNeedsUint32` (`three.core.js:1779`), where **the bound is 65535 and NOT 65536 in three's own source** (`PRIMITIVE_RESTART_FIXED_INDEX`, three #24565), **so it is mirrored rather than re-derived**. A's design note is worth keeping: A did NOT use `total − 1` as the maximum, because **a bound is not a maximum** — a chunk with ≥ 65536 vertices whose indices never reach 65535 gets Uint16 from three, and an inferred answer would pick Uint32, leaving the two paths **equal in values and different in TYPE, which is exactly the equivalence being preserved**; an element of the merged array is either a `groundIdx` value or `data.idx[k] + off`, so three's "any element ≥ 65535" decomposes exactly into two scans (`INDEX_U32_MIN` 65535, `anyAtLeast`), **and the array is never built twice to be measured**. A reproduced B's 2×2 independently (symlinked probe root, nothing of B's committed on `r24/a`): shipped line with `FINALIZE_PACE` ON → **80** broken LAND meshes, `--nopace` → **0**, and the fixed tree → **0 in all four combinations**, at 160 meshes / 138 chunks / 80 ready — **B's numbers on the nose**. All **23 `setIndex` sites** were audited: three pass a bare variable — `toy-world-engine.js` (the defect), `SatTintLayer.jsx:124` (a `BufferAttribute`), `Contrail.jsx:89` (a plain array built by `push`) — `PrecipLayer.jsx:176` is an array literal, the other 19 already wrap, and **A re-read the two that had been cleared in advance anyway, "because 'someone said it was fine' is how §15 happened"**. PROOF: `verify-finalize-pace` **17 → 21**, RED-calibrated by restoring the shipped line (gates 8, 19 and 20 fail); **gate 21 reads the threshold out of `three.core.js`'s REAL source text** and compares it with ours, so a three bump that moves the number fails there instead of silently desynchronising the two paths; and **gate 22 EXECUTES the decision rather than restating it** — `INDEX_U32_MIN` and `anyAtLeast` lifted verbatim from the engine, run against three's own predicate over the array the flag-OFF branch actually builds, across 7 cases including exactly-at-the-bound in both directions and the case where the OVERLAY's offset crosses the line, **all 7 agreeing** — because *"a gate that re-implements the logic it checks agrees with its author, not with three"*. Flag-OFF is unchanged: no `−`/`+` line inside the OFF branch (checked, not asserted), gate 9 still pins the upstream spread verbatim, `--nopace` reads 0. **Orchestrator verification on the dry tree** (`ec53fd3` + E `d9e5d57` + A `e7325cd` + B `45e2cde`/`b459056` + C `ad0849f` + D `1083168`): B's census **BROKEN=0** with and without `--noflag=FINALIZE_PACE`, `verify-finalize-pace` **21/21**, import-integrity **4/4**; and A's node set is green throughout — terra-residency 22/22, vendor 20/20, finalize-pace 21/21, frame-step 11/11, skirt-fast 13/13, skirt-worker 9/9, step-guard 13/13, `no-undef` 0. **A's ledger §16 credits B's attribution up front** and carries the 2×2 and the audit <!-- CERT:verify-ladder-red PASS2 PENDING --> | PENDING — the same control on a real display | — |
| `verify-one-sun.js` | **rc=1, 251 s, 20/7 — RED calibrated.** Both pins released (`__flySunOverride` null → null, `__flySatShadowOverride` 0 → 1) and **`live === true` at high AND medium**, so the released term is proven reachable before anything is asserted. Azimuth key === hill, **Δ 0.00e+0°** at every tier and time. **Key ELEVATION stuck near 45° — 39.552° high/noon, 45.291° high/dusk, 45.142° elsewhere — against a true solar 55 / 2 / −14, at high AND medium**: recon L3, measured in the shipped app. **Medium azimuth spread 0.0000°** is the RED itself. Gate (5) — "water reads the same directional, Δ undefined°" — **PASSED on an absent reading**, i.e. vacuous; E is fixing it. No page errors | **(2) and (6) are VOID BY INSTRUMENT — not `ONE_SUN` failures.** `rc=1, 263 s, 14 passed / 7 failed / 6 NOT CALIBRATED`, `ONE_SUN` ON at `dayK` 1.0, both pins released. **What stands**: (0a)/(0b) `live = true` at high AND medium, so the branch runs; (1) azimuth **key === hill, Δ 0.00e+0°** at every tier and time; (7) clean. **What is void, and why, from source**: both gates redefine `window.__flySunOverride` as an accessor returning `window.__r24Sun` (`verify-one-sun.js:90` `mk('__flySunOverride','__r24Sun')`, `verify-linear-haze.js:49-57` `UNPIN_SUN`) and then set `__r24Sun = { elDeg: el }` — but **the app consumes `__flySunOverride` as a TIMESTAMP in milliseconds** (`FlyScene.jsx:939` `computeSun(lon, lat, tMs ?? window.__flySunOverride ?? Date.now())`, `:1155` `(window.__flySunOverride) \|\| Date.now()`), and **nothing in `lib/` or `components/` reads `__r24Sun` or an `elDeg` field**. An object where a number is expected yields NaN inside `computeSun` or a truthy fallthrough, **so the flipped app kept its wall clock** — which is exactly what the monotonic azimuth drift −64.6081 → −64.8665 → −65.1123 across a commanded 55° → 2° → −14° over a 263 s row was showing. **The numbers are kept as the INSTRUMENT record, never as a feature verdict**: (2) key elevation constant ≈ 23° (23.132 high/noon, 23.132 high/dusk, 22.938 high/night, 22.938 / 22.753 / 22.753 medium, `casting = undefined` throughout) against ≈ 45° flag-off; (6) medium-tier azimuth spread 0.2458° against 0.0000° flag-off. **(5)'s NOT CALIBRATED ×6 stands on its own footing** — `water` publishes the STRING `"key"` and `angleBetween` returned null — E's verdict working exactly where the flag-off pass had a vacuous PASS. **E's re-base is committed** (`d9e5d57`): `scripts/_sun-time.mjs` SEARCHES a timestamp using **the app's own `computeSun`** (through `scripts/_node-resolve.mjs`, which handles the extensionless relative imports D's alias loader does not), reading `sinEl` because `frac` clamps below the horizon and `el` is floored — **errors < 0.003°** — and both sun gates now carry the precondition that **the app reports the commanded elevation within 0.5°, else NOT CALIBRATED**: *that leg's absence is precisely what let pass 2b read a stationary sun as a stationary key*. `moonK === 1` is asserted at a landed −14°. The gate also takes C's `ad0849f` contract: **(5) angle ≤ 0.5° AND `waterSource === 'key-light'`** — *"an angle of 0 between two independent lights is a coincidence that holds until someone moves one"* — and a NEW **(8)**: the source count of `<directionalLight>` in `FlyScene.jsx` must be **exactly 1** (measured 1), which gives the identity claim teeth without a runtime census. **C's triage answered all three** (`ad0849f`, node-only). `casting` was **C's own instrument defect**: the gate reads `casting`, `minElRadDeg`, `hillMinDeg` and `hillMaxDeg` off `__flyStats.sun`, but C had published `casting` on `__flyStats.shadow` and the other three NOWHERE — so clause (2)'s floor degraded and (3) skipped on all six legs; all four are on `stats.sun` now (`casting` stays on `stats.shadow` too). **`ONE_SUN` is exonerated by the log's own numbers: key and hill agree to 0.00° in azimuth AND elevation on every leg.** Water's `"key"` is by-reference semantics — satellite water is MeshPhong lit by the single world-scene `<directionalLight>` (`FlyScene.jsx:2141`; the other two directionals belong to the inspect turntable's own Canvas) — **so clause (5) is Δ 0 BY IDENTITY**, and it now publishes the vector plus `waterSource:'key-light'`; C declined a runtime light census because a frame-loop traverse would perturb `FRAME_STATS` timings during a perf-cert round, **a static source gate being the honest instrument**. And clause (6)'s > 1° is **E's expectation, not C's contract**: azimuth IS the hour angle, so a time-driven gate moves Powell's sun by tens of degrees — while `moonK` (keying on `trueElevationDeg`) stayed **0** on the "−14°" leg, a free "the commanded night never landed" tell that is now an assertion. **One-sun joins the re-take** **RE-TAKE: rc=1, 260 s, 12 passed / 4 failed / 6 NOT CALIBRATED — the identity clauses are CERTIFIED where the sun actually landed, and all four reds are the INSTRUMENT's.** On `9bcaace`, started 00:13:25, no K, load 5.26 / 4.64 / 4.19. **THE FEATURE**: **(5)** water reads the same directional as the key, **Δ 0.000000°** at both tiers at night; **(5b)** the water light **IS** the key light **by SOURCE**, `waterSource "key-light"` — *"an angle of 0 between two independent lights would be a coincidence that holds until someone moves one of them"*; **(3)** hill elevation = the clamp floor **8.594° exactly**, both tiers; **(0a)/(0b)** the key light is live; **(0c) high/night and medium/night commanded −14°, app reports −13.996°** via `t=2026-07-01T02:31:33Z` — **the first time this round the app's sun was where a gate put it**; **(0)** both pins released (sun null → null, satShadow 0 → 1); **(7)** no page errors. **THE FOUR REDS, attributed from the log and `FlyScene.jsx`, none of them `ONE_SUN`'s**: **(a)** (0c) high/noon and high/dusk NOT CALIBRATED — the app reports elDeg **−4.539** against a commanded 55° / 2°, **and −4.5° is the WALL CLOCK at boot** (00:15 UTC, 7 Sept, Powell); medium/noon and medium/dusk report **−13.996, the PREVIOUS leg's value, stuck** — so the app picks the override up on a **recompute cadence** (`FlyScene.jsx:1155`) the legs do not wait for, and **the night legs passed because the cadence happened to fire first**. E's 0.5° precondition caught it honestly, which is exactly what it was added for; the fix is a leg that **WAITS for `elDeg` to land** (poll to within 0.5°, timeout = the cadence plus margin, NOTCAL otherwise). **(b)** (6)'s medium-tier RED reads a **0.0000° azimuth spread** — *the consequence of the stuck sun on that tier, not a measurement* — and (6) now gates on (0c) passing on at least two legs. **(c)** (8) *"the world scene declares exactly one `<directionalLight>`"* counts **2** in `FlyScene.jsx`: the declaration at **:2412** and **the COMMENT at :2295** that names the tag while explaining the identity — **R20 §7's "a grep gate reads comments too", the trap C's own reader census skips and E's new source gate did not**; C's one-light claim stands and (8) reads **1** once comment lines are excluded. **(d)** (2) KEY ELEVATION at night on both tiers — key **34.377°** against an expected 8.594° (high, casting) / −14° (medium): **with `moonK` = 1 the key follows the MOON** (`moonDirFromSun`, `FlyScene.jsx:2193`, the same `_moonKeyDir` the key is set from), and the gate's own SKIP on (1) says **clause (4) governs** — but (4) is NOT CALIBRATED because *"the instrument does not publish `moonExpected`"* **and (2) asserted the sun anyway**. C is publishing `moonK` and the moon key direction (`moonKeyAzDeg` / `moonKeyElDeg`) on `stats.sun` beside `casting`, and (2)/(4) under `moonK` = 1 will assert the key against **that published direction**, NOTCAL until it exists. **The 34.377° is therefore the FIRST MEASURED READING of C's moonlit night key on the venue, not a defect.** **ROUTED**: E takes the four instrument items as one batch (one-sun re-runs after lod-fade, with terra-live); C publishes `moonK` + the moon key direction and the flag-off shape gate. Marker stands <!-- CERT:verify-one-sun PASS2 PENDING --> | PENDING — the LOOK (checkpoint 5) | — |
| `verify-linear-haze.js` | **VOID — reader outside rAF; re-run pass 2.** rc=1, 240 s, 4 passed / 2 failed, and not one of the six means anything: both poses read **terrain L 0.0 / sky L 0.0**, an all-zero luma profile and "horizon row 6 of 540, step 0.0", because the seam reader ran from `page.evaluate` **outside any animation frame** against a `preserveDrawingBuffer:false` context, so `readPixels` returned a CLEARED default framebuffer. (1a)/(1b) failed honestly ("no horizon in the frame"); (2a), (2b) and (3) then PASSED — "RIM SEAM ≤ 12/255 Δ 0.0" and "seam independent of time of day, spread 0.0" — **on black against black**. E's rewrite samples at the start of the NEXT animation frame on the renderer's own context (the pale detector's idiom, which is why the census rows worked) and makes (2)/(3) print **NOT CALIBRATED** whenever (1) fails. `verify-depth-roundtrip` has no `readPixels` path and is not the same shape | **VOID AS POSED — there is no seam in this frame, because there is no MELT in this frame.** `rc=1, 243 s, 4 passed / 2 failed`, `LINEAR_HAZE` ON, the repaired reader sampling at rAF start on the renderer's own context — and the repair did work: (1a)/(1b) **a horizon IS found**, row 227 of 540, step 54.6 / 54.7; noon terrain L **212.4** vs sky L **161.5**, **Δ 50.9**; night terrain 212.3 vs 161.5, **Δ 50.8**; profile […213.3, 208, **159.5**, 160, 160.5…]; (3) spread **0.1**; (4) clean. **C's triage, from source, says the Δ is NEITHER `LINEAR_HAZE` NOR the reader's row.** The reader's sides are right (bottom-up `readPixels`; terrain at `bestY − GAP − BAND`, sky at `bestY + GAP`). **The frame has 0 % melt, not a partial one**: `bootFly` pins `__flyAerialOverride = 0` (`_boot.js:83` and `:119`, boot and reload legs) and releases only the sun; `FlyScene.jsx:1659–1666` multiplies `aerialGate` to 0; R19 B built all three atmosphere channels to take their IDENTITY path at 0 (`clearAerial`, `setSatContentHaze(…, 0)`, `setQuiltGrade(0, 0)`); `WORLD_EDGE.fade.satellite` is 60 → 120 km and nothing in a fixture frame is within 60 km; and `setDepthHaze` at `FlyScene.jsx:1011` is literally 0 in satellite. **The gate's own profile corroborates it**: 13 terrain rows flat at 210–214 with **no trend toward 161**, then a one-row cliff to 159.5 — a melt completing at the horizon would have swept most of the 51 across those rows. **≤ 12/255 is unreachable at that pose even with the pin released**: `AERIAL_PERSPECTIVE.maxMix` 0.55 ("never fully swallows the mid-band") leaves 0.45 × 51 ≈ **23** before `heightFalloffM` 1200, and the pose's eye at 4200 m is **3.5 e-folds above that scale height** — satellite's melt is DESIGNED to finish in the world-bend edge fade at 60–120 km. And the bound's provenance was wrong: C's `r24-c-linear-haze-proof.mjs` predicts **0.000 for the DECODE ROUND-TRIP** (each setter writing `srgbToLinear` of the authored triple), **never a 0 seam**, so the gate's expected value should not have been sourced from it. **C's caveat, kept**: with the melt at 0 the run is BLIND to whether the haze target also disagrees with the dome's colour — if a Δ survives the pin release, that is the next candidate, and it is C's M1 tuning refusal rather than a decode defect. **The night leg stays VOID by the sun-override defect** (one-sun cell). **THE ORCHESTRATOR'S RULING, now implemented** (`d9e5d57`): the gate releases `__flyAerialOverride`, asserts tier high AND `aerialGate > 0` else NOT CALIBRATED, **drops the unreachable ≤ 12**, claims the **A/B — Δ(flag ON) < Δ(flag OFF)** — and keeps spread ≤ 0.5 as the one-colour-function tell, with a toy pose as a second INFORMATIONAL leg. **The runtime pin has LANDED** (`ee10642`, verified on the dry tree): `linearHazeOn()` (`world-bend.js:518`) is now the ONE reader of `LINEAR_HAZE.enabled` in the tree (`:527`), consulting `__flyLinearHazeOverride` per call with no module-init capture — so the A/B's ON arm is calibratable. **C found TWO raw readers, not one**: `AerialPerspective.jsx` had its own `if (LINEAR_HAZE.enabled)` for `uHazeColor`, and pinning the dispatch site alone would have measured a MIXED tree. `verify-c-flagoff` **37 → 40**, RED-calibrated by an added read in `SkyDome.jsx`. **C's condition on the re-take**: the pin changes the haze COLOUR, not whether haze is applied, so at `aerialGate` 0 both arms are the same frame — the A/B must release `__flyAerialOverride` too, which the orchestrator's ruling already requires. **E has WIRED the A/B to that pin** (`18bd5eb`, `r24/e` tip, held; node smoke 16/16, import-integrity 4/4 over 377 files): **one boot per arm** — OFF `{ enabled: false }` then ON `{ enabled: true }`, **both pinned explicitly**, because the constant ships ON and an unpinned "off" arm is the treatment, which makes the comparison treatment-against-treatment. Each arm releases `__flyAerialOverride` with the accessor idiom, drives the sun by TIME under the 0.5° precondition, asserts `moonK === 1` at a landed −14°, measures both poses and checks its own spread ≤ 0.5; then the A/B claim: **Δ with the decode ON < Δ with it OFF**, same pose, same fixture. **Two refusals**: NOT CALIBRATED whenever EITHER arm's `aerialGate` is 0 — the gate **travels with each reading** rather than being read once at the end, so one arm cannot inherit the other's — and the absolute ≤ 12 stays gone. **The gate has its own RED**: `HAZE_RED=1` pins BOTH arms `{ enabled: false }` and asserts the A/B does NOT separate; two identical trees cannot produce Δ_on < Δ_off except by reader noise, so what comes back is **the reader's NOISE FLOOR, recorded rather than assumed** — and it goes in the record beside the A/B result, because *"without it, 'on reads 2 luma smaller' is not obviously a finding"*. `verify-terra-live.js` and `verify-ladder-fix.js` are NOT re-edited on `r24/e`: the merged tree's resolved versions run<!-- CERT:verify-linear-haze PASS2 PENDING --> | PENDING — whether live colours land in the same band | — |
| `verify-depth-roundtrip.js` | **rc=1, 220 s, 1 passed / 1 failed — NOT RUNNABLE, not RED** (toy, tier high, renderer `reversedDepth=true`). Gate (0) refused because **`window.__flyDepthProbe(x, y)` was ABSENT** — *"this gate cannot reconstruct viewZ without the renderer's own conversion; re-implementing it in the harness would test the harness's copy of the bug"* — required signature `{ viewZ, coc, raw, reversed }` over drawing-buffer pixels, top-left origin, owner C under `DEPTH_FIX`; it printed `dof=null`, and gate (0b) "the DoF pass is present" then PASSED on an inference from style and tier while `dof` was null — **the fourth vacuous pass of the day**; E is making it read a handle. C has since built the hook (`e59445d`, §3), so **the PASS 2 marker stands**. Note for pass 2: an `error` there means **neither float target renders** — recorded with the probe's own string, and read as NOT RUNNABLE HERE rather than as a defect | **the HOOK works; the gate's PIXEL PICK does not.** `rc=1, 244 s, 3 passed / 1 failed / 1 NOT CALIBRATED`, toy at tier high, renderer `reversedDepth = true`. (0) **`window.__flyDepthProbe` PRESENT — C's hook works on the first run it existed for**; (0b) the gate reads the handle now, `__flyDof` true; (1) **"THREE PIXELS WITH A KNOWN TRUE DISTANCE WERE FOUND — 0 raycast hits" FAIL** — the pick hit nothing at the pose, **so the probe was never called on a real pixel**; (3)/(4) **NOT CALIBRATED**, "the probe returned no finite coc (near undefined, far undefined)" — the third verdict doing its job where a vacuous pass would otherwise have stood; (5) clean. **Attributed to the instrument's PICK, not the hook**: the row runs with no `K` because it sits on the pacing list, while it is in fact a settled-pose PIXEL probe — **E's own §1.5 table puts pixel A/B gates in the CONTENT class** — so on the flipped tree, with `FINALIZE_PACE`'s cold seed and a fixed settle, the toy chunks were not resident at the moment of the pick. **Fixed in `d9e5d57`**: the raycast now says WHY it missed, the row settles on `_settle.js` FIRST, hits are printed with their distances and objects, the verdict is **NOT CALIBRATED below three picks**, and the row is **moved into cert-run's `K` list as a CONTENT gate, per E's own §1.5**. Depth-rt joins the standalone re-take <!-- CERT:verify-depth-roundtrip PASS2 PENDING --> | — | needs `window.__flyDepthProbe`; absent ⇒ the row reads NOT RUNNABLE, never RED |
| `verify-terra-live.js` | **rc=1, 715 s, 8 passed / 1 failed — both arms, armed through `__flyTerraPaceOverride`.** Arm A (trio OFF): content 62 URL / 64 pos, **0 mismatches**; yaw merges **1**, replacedOnScreen 0, refetchParent 1, imagery requests 33, URLs fetched >1× **1**; Powell draws **161** / tris 294,870; Owens **161** / 182,645; `residentMB` 0. Arm B (trio ON — `timerFix` + `mergeHysteresis` + `keepResident` + `skirtFast`): content 59 URL / 65 pos, **0 mismatches**; yaw merges **0**, replacedOnScreen 0, refetchParent **0**, imagery requests 36, URLs fetched >1× **17**; Powell **183** / 273,085 / `residentMB` **41.3**; Owens **185** / 157,297 / `residentMB` **50**. Gates: (1)(2)(3) content PASS — **a cache/URL mix-up is RULED OUT as a separate cause of "tiles swapping" in this code path** (A's §9 row 8, answered on the fixture; the live-capture variant stays a user-machine item); (4) merges **1 → 0** PASS; (5) replaced-on-screen 0 → 0 PASS; (6) "the same tile URL is not fetched twice as the heading comes back round" **RED 1 → 17 — ATTRIBUTED to the instrument's ~51°/frame yaw step (upstream DISCARDED refines), not to `TERRA_PACE`; re-measured in pass 2 at 0.85°/frame over 360°** (A, `d03ccdc`, docs + instrument only). The byte LRU is ruled out by arithmetic: the cap is 140 MB and a tile costs ≈ 341.3 KB imagery + 58.0 KB DEM geometry ≈ **399 KB**, so the cap admits ≈ **358 tiles**, while the observed peak was 41.3 MB ≈ 106 tiles (**30 % of cap**) and the worst arm 50 MB ≈ 128 tiles (**36 %**) — **the LRU had nothing to evict** — and its only route to a refetch is `_r24Collapse → merge`, with merges **0** in that arm. Counter semantics were ruled out by E (reset per arm, `no-store`). **The positive mechanism is upstream's**: `_loadSubTiles` starts a refine, downloads the children, then DISCARDS them when the parent stops being a refine candidate on the next evaluation — and at ~1 fps the wall-clock `PIN_YAW` stepped **~51° per rendered frame**, so a tile enters and leaves the refine set inside one download round-trip and the next arrival of that heading re-requests it. Node probe on the vendored classes: at **0.85°/frame** with the trio on, duplicates **1 → 0**; at **51°/frame**, **28 → 28** (merges replaced by discards); with `walkWhileSaturated` on, **4 → 28**, because it correctly restores refine starts — **the red measured the venue's yaw step, not the feature**. `PIN_YAW` is now frame-based (`YAW_DEG_PER_FRAME` 0.85 inside a rAF, `YAW_MIN_ARC_DEG` 360) with gate 6 guarded by `arcOk` and printing SKIP / NOT CALIBRATED on a short arc (45 s here ≈ **38°** of arc); pass 2 runs the full 360° (~424 rendered frames, 7–8 min per arm) and gate 6 asserts for real. Two of E's own caveats remain to confirm: the "URLs fetched >1 time" filter **had no prefix test**, so the 17 includes DEM, MVT and API URLs while "imagery requests 33 → 36" is imagery only (per-prefix breakdown lands for pass 2; an eviction-refetch cycle shows in `img` and `dem` only), and the reset is **not atomic with the pin**, so boot-tail requests land inside the window. **Every fixture response is `no-store`, so a fixture refetch count is an UPPER bound on live**, where real cache headers and R21's persistent Cache API tile cache both apply; (7) **CEILING Owens ≤ 261 in every arm — off 161 / on 185 PASS**; (8) satellite ≤ 375 at Powell — off 161 / on 183 PASS; (9) clean. All FIXTURE numbers. **Draw counts rise off → on at both poses because `keepResident` keeps more tiles drawn, and the frozen ceilings hold with margin.** **Two limits at exactly A's strength:** the fixture serves deterministic bytes per (z,x,y) and Esri does not, so the merge that REPLACES four children with a coarser parent reads here as a resolution change and on the user's machine as a **DIFFERENT CAPTURE** (season, sun, colour) the probe cannot see because URL and position are both correct — still LOD policy, the fix unchanged, and the reason the symptom reads more violently live than any fixture number shows; and the probe only tests tiles whose material already has a map, so its denominator excludes the mid-load tiles that are the likeliest moment for a mismatch | **rc=1, 1973 s, K=40, both arms pinned explicitly — the residency trio HOLDS its yaw contracts on the flipped tree and BREAKS the frozen desert ceiling.** Started 22:04:16, load 4.20 / 4.63 / 4.71, `FLY_TERRA_SWEEP_MS=600000` with FRAME-based sweeps. **Arm A (trio OFF)**: content probe **62 resident tiles, 58 with an imagery URL, 0 URL / 0 position mismatches**; yaw arc **383° over 450 frames (0.8 fps)**; Powell draws **211** / tris 359,004; Owens draws **152** / tris 170,932; `residentMB` 0 (the OFF arm does not report residency). **Arm B (`timerFix` + `mergeHysteresis` + `keepResident` + `skirtFast`)**: **103 resident tiles, 99 with a URL, 0 URL / 0 position mismatches**; yaw arc **305° over 359 frames (0.6 fps)**; Powell **366** / 616,368 / `residentMB` **112.6**; Owens **279** / 409,846 / `residentMB` **113.7**. Gates: **(1)** every resident tile displays the imagery of its OWN z/x/y (arm A, 58 checked) **PASS**; **(2)** its quadtree address matches its world position (arm A, 62 checked) **PASS**; **(3)** the same with the trio ON (arm B, 99 URL / 103 position) **PASS** — the content half is answered in BOTH arms on the flipped tree; **(4) the engine stops merging tiles the camera merely turned away from — merges 35 → 0 PASS**; **(5) no tile is replaced while it is on screen — 27 → 0 PASS** — *that pair is the round's headline for Symptom B, measured on the venue*; **(6) SKIP / NOT CALIBRATED** — the duplicate-URL comparison needs ≥ 360° per arm within 10 % of each other and got 383°/450 frames off against 305°/359 frames on, **and the gate's own message named the right knob: raise `FLY_TERRA_SWEEP_MS` (arc = frames × 0.85°, so a slow venue needs proportionally longer), NOT `FLY_TERRA_YAW_MIN_ARC`** — hence 900 s on the re-take; **(7) CEILING Owens ≤ 261 in every arm that ran — FAIL, off 152 / on 279**; **(8)** satellite ≤ 375 at the suburb pose in every arm that ran — off 211 / on 366 **PASS**; **(9)** no page errors in either arm **PASS**. **THE BREACH: +127 draws with 41 more resident tiles and 2.4× tris at the same pose — retained tiles are ISSUED.** Pass 1's 45 s wall-clock sweep read Owens **off 161 / on 185**; this 600 s frame-based sweep reads **off 152 / on 279** at the SAME flag state, so **E's caution — accumulation with sweep DURATION — is the working hypothesis**, not (or not only) a cull-margin leak; **E's resident/visible census separates them in one read** (resident up with the drawn fraction flat = retention; drawn fraction up = cull). **Routed to A with two requirements**: a retained tile that is off-frustum or superseded is **never issued**, and residency gets an **eviction policy with a cap** (LRU by last-visible frame, tiles or MB — `residentMB` 113.7 after 600 s **and nothing says it stops**; a real GPU at 60+ fps accumulates an order of magnitude faster than this fixture, **and the user is flying this build now**), proven RED/GREEN in the node terra-residency gate with **zero-refetch-on-yaw preserved**. **The frozen 261 is NOT moved.** **A'S FIX HAS SINCE LANDED** (`dead5e5`/`c573d08`, merged to integration and pushed in `83462eb`): the breach is attributed to `keepResident` ALONE by a switch-by-switch measurement, and PATCH 26 `parkOffscreen` cuts off-frustum issued tiles **142 → 0** with residency itself unchanged (§3 A). **This row is DEFERRED, not closed** — E re-runs it at 900 s on that fix, and whether Owens lands under 261 is measured there, not asserted here. **The expected reading is on the record IN ADVANCE**: resident high, **`parked` high**, `visible` ≈ flag-off, drawn fraction well under 100 % — **read before the draw number** — and if Owens still breaches 261 with the drawn set frustum-bounded, that is A's named residual (z17 detail where upstream collapsed to z13) and the lever is `LODThreshold`, **never the ceiling**. The census itself was repaired first (§5.2) <!-- CERT:verify-terra-live PASS2 PENDING --> | PENDING — the residency trio's live draw evidence, and whether gate (6)'s repeat fetches appear on real bytes | the LIVE capture difference behind a merge; a fixture draw count bounds nothing live |
| `verify-frame-pace.js` | **rc=1, 153 s — NOT RUNNABLE BY DESIGN, not RED.** Gate (1): *"THE INSTRUMENT IS PUBLISHED — `window.__flyStats.frame` with `sample()`/`ring()`/`reset()` — absent — `FRAME_STATS.enabled` is false. Everything below is unmeasurable; that is the flag-off state, not a failure of the renderer"*, and the pacing legs are skipped. `FRAME_STATS` has **no runtime pin** — E's instrument is flag-gated and E's flip `6c26fe9` ships it ON — so **pass 2 is the first run of this gate**; even then its pacing legs are informational in this venue by design | **rc=1, 260 s, 5 PASS / 1 NOT CALIBRATED (22:37) — the instrument EXISTS and the row exists because `FRAME_STATS` shipped ON; pass 2a had no instrument at all.** `window.__flyStats.frame` is published with `sample()`/`ring()`/`reset()` and **27 fields**, the **13 ledger-quoted fields are present**, **programs delta 0** — no recompile storm — and no page errors. **(3a) FIRED**: *"no resize occurred in the window, resizes 0 over 107 frames"*, so **(3) every resize inside a rAF (0 of 0) and (4) `bufferMatchesDrawing` never false (0 of 107) carry NOT CALIBRATED inline** — without §2.10's vacuity guard both would have printed PASS and **the tear mechanism would have read clean on a window in which nothing resized**. E counts it as **the fourth time this pass a guard stopped a green that meant nothing**; `verify-step-clean` is the row that forces a step. The phase marker earned itself here: **the last stall, 3660 ms, is stamped `[finalize:sat-roads ×16]`** — an owner, not a mystery **Final; no browser re-run of this row is scheduled** | PENDING — **everything**: stalls/min, worst dt, p99, >100 ms/min | the pacing legs are not asserted here; flag-off it correctly reads "instrument absent — unmeasurable, not a renderer failure" |
| `verify-seam.js` browser leg | **NOT RUN this round** — no browser seam row was scheduled in either pass or in the re-take | **NOT RUN this round** (the `verify-seam` NODE leg is green in every smoke — 9/9, §4.1) | PENDING — the seam on a real display | a browser seam leg was never posed here; the node leg is the round's seam evidence |
| `verify-env-uniform.js` | **NOT RUN this round** — `ENV_UNIFORM` ships **OFF** (§5.3), so no browser leg was scheduled in either pass | **NOT RUN this round**, same reason. **The round's only evidence for it is node-side**: B's `r24-b-prewarm-proof.mjs` **9/9** with `--red` **5/9** against the defective `06b8f1d`, which proves the stand-in-scene fix and NOT the flip | PENDING — the ms a compile storm costs | the proof B asked for and never ran, **still owed to the next round**: the `programsDelta` run and the twilight A/B |
| `verify-shadow-calm.mjs` | **PASS 32/32 in node** (§1, §4.1) | **33/33** on C's flipped branch | PENDING — sparkle, acne, whether the catcher receives a shadow | no browser leg exists and none could be afforded (its mount begins with the fleet pin). **No pixel, no draw count; "Owens is 0 by construction" rests on `queryColumns` answering `[]`, which is a browser fact** |

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

**Nothing in this table has been confirmed.** The diagnosis pack was sent and
no reply arrived; every row is unconfirmed on the user's machine, including the
two that are the reason the round exists.

**The user is now testing `9bf5f8a`** (`8240539`, plus merges 13–18: the scripts-only ones, the import dedupe, **A's Owens fix**, C's dead-import removal and E's census repair) — **on `main` as well as on the integration branch**, `main` having been fast-forwarded to it at the user's request (§4.1) — pushed early, at their request, before
the standalone re-take (§4.1). It is **the first R24 build in the user's hands
that contains the toy index container fix and the `STEP_SAFE` resize guard**, so
the toy boot page error and the DPR double-apply are the two things this build
answers that no earlier one could. **Nothing has come back from that machine
yet**: every row below still reads PENDING, and a checkpoint is closed by the
user's reply, not by this build existing.

| # | Checkpoint | What to look for |
|---|---|---|
| **1** | **THE DIAG PACK FIRST** — Part A on the build you have now, THEN on this build | stalls/min, worst dt, p99, and the per-second `dReady` / `adds` / `removes` deltas during a 30 s low serpentine. **This is the round's RED; without it there is no before** |
| **1b** | The four questions in Part 0 | which build(s) showed it; which symptoms (a crossed-out symptom is as useful as a ticked one); the machine facts; which style. All four are still unanswered, and the round ran on the plan's defaults |
| **2** | Buildings appearing/disappearing — Powell → Columbus at 200–400 m AGL, turning hard | nothing pops in one frame at the ring edge; nothing vanishes behind you while still on screen; heals do not blink |
| **3** | Tiles swapping — a slow 360° yaw at a parked pose, then the serpentine | the field behind you stays refined; no coarse parent replaces four children in view; refines dissolve (if `LOD_CROSSFADE` is ON). **Live, a merge swaps in a DIFFERENT Esri CAPTURE — season, sun, colour — which no fixture number can show**, so your eyes are the only instrument for how violent it looks |
| **4** | **`LADDER_FIX`, two questions.** The taste one: softer-under-load (0.875 / 0.75 render scale) vs a tier hitch — is the softness acceptable? `__flyGov.state()` shows the rung. And the **unmeasured** one: `nativeRefresh` ships ON per plan §0 ruling 6 with **no measurement behind it** — an exact no-op at 60 Hz (`min(60, 60)`), but on a 120/144 Hz display it raises the governor's target and recon FL-04's question is still open. **The revert is one word** | does a 144 Hz machine feel better targeting 144, or is a 60 Hz cap preferable? |
| 5 | Linear haze + one sun: noon and dusk horizon vs R21; the Neon rim melting to `#1a2246` **as authored** | the seam is gone; the key light moves with the sun on medium too. The Neon rim is ~89/255 darker at the melt, and that is the fix, not a regression |
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

---

## §8 Flag ship state at close

**The flips are MERGED.** Pass 1 closed, and the five owners' flip commits went
to integration in order — `19d90b0` (E), `5b13e35` (A), `7face8f` (B),
`a60bf17` (C), **`91141fe`** (D) — giving a tree that is byte-identical to the
dry-run worktree, `no-undef` 0 over the R24 delta and node smoke 16/16. Every
state below is read from `91141fe:lib/fly/fly-constants.js` and cited to the
merge that set it; **only `LOD_CROSSFADE` is still open**, on pass 2's pinned ON
leg. **Nothing here has been certified on the user's machine.**

### ON at close (Level A: green on the fixture or structurally proven, flag-off identity proven)

| Flag | Rests on | Marker |
|---|---|---|
| `FLASH_GUARD` | **CERTIFIED ON THE VENUE** — the re-take reads **8/8** with the armed census non-empty for the first time: **13,766 zero-area triangles (8.32 %) with the pin off, EXACTLY 0 armed at every site** over 151,754 tris, both Powell legs settled (422 s / 274 s), the detector's self-test firing exactly once and the serpentine registering zero false positives in 668 frames (§4.2). **The one-frame white flash's zero-area DoubleSide wall triangle, from the vector-tile ring closure, is removed AT THE SOURCE; the pale detector is CORROBORATING, not load-bearing.** Caveats that stay: Manhattan did not settle, so its 13.97 % worst chunk is a floor and the A/B lives in the Powell pair; **skyline = INSURANCE**, its population 0 by construction; **the toy site is NOT EXERCISED** by any browser row; and `FLASH_GUARD telemetry` still reads null, so the green rests on the census rather than on the feature announcing itself. 15,984 → 0 in node; normals bit-identical; zero keys, zero bundle bytes, zero draws | **ON**, merged `7face8f` |
| `BEND_LEAD` | `padON ≥ worstDrop` on 7/7 rings; Owens 0 by construction | **ON**, merged `7face8f` |
| `CHUNK_FADE` | **RUNNING ON THE VENUE, PARTIAL** — the re-take's probe sees the channel (`userData.__fadeU`, 82 of 114 frames carrying a partial-presence mesh) and the `minFrames` 4 floor demonstrably works for **18 of 26 births and 5 of 11 deaths**; **the hard remainder — 8 births and 6 deaths at full presence with `fadeBudgetMiss` 0 — is OPEN, fix pending B**, who has the source attribution at 0.35 fps (§4.2). pops 92 → 2, both attributable; `maxDying` 4 is the only draw term. **ON per the ship table**; whose expected reading is on the record in advance — births SOFT, deaths spanning ≥ 3 partial samples, hard deaths ≤ `fadeBudgetMiss` (§4.2) — and which runs with B's frame-count ramp floor (`45e2cde`, `minFrames` **4**) in: venue pops **0** against 92 flag-off, the 60 Hz ramp length unmoved, and a mid-ramp 500 ms hitch no longer completing a ramp | **ON**, merged `7face8f` |
| `HEAL_IN_PLACE` | **NEVER EXERCISED in the re-take's window, ruling pending B** — the heal taxonomy reads heals **9** = queueFull 4 · aborted 4 · coalesced 1, with **`healsInPlace` 0**, so the outcome that IS this fix did not occur; B rules whether that is by construction (naming a window that would exercise it) or a defect (§4.2). heals 16 (0 in place) → 21 (all in place); evictions 40 → 24. **ON per the ship table** with `CHUNK_FADE` (§4.2), now against an EXHAUSTIVE outcome ledger — `healsInPlace`, `healsNoop`, `healsQueueFull`, `healsAborted`, `healsNoRecord`, `healsCoalesced`, `redraping` — asserted as an EQUALITY, so a residual hole is attributable to `healsQueueFull` or it is a defect | **ON**, merged `7face8f` |
| `GROUND_VIS` | 384.0 → 4.000 m worst frame, converging in 95; the flight model keeps RAW | **ON**, merged `7face8f` |
| `LINEAR_HAZE` — pinned through `linearHazeOn()` (`ee10642`) | **decode round-trip proven by the node oracle** (each setter writes `srgbToLinear` of the authored triple; closed-form deltas 9.3 / 19.9 / 76.3 / 99.2 / 89.4 per 255 → 0.000). **The SEAM is UNMEASURED** — pose and pin: the fixture frame has 0 % melt because `bootFly` pins `__flyAerialOverride = 0`, and ≤ 12/255 is unreachable at that pose even released (§4.2). **A/B re-take pending**, now calibratable: `linearHazeOn()` is the ONE reader of the flag (`verify-c-flagoff` 37 → 40), and the second raw reader in `AerialPerspective.jsx` is gone | **ON**, merged `a60bf17`; pin `ee10642` in the dry tree |
| `ONE_SUN` — `hill.dayK` **1.0**, `monumentsLambert` true; **the identity clauses are CERTIFIED WHERE MEASURED** — water ≡ key **by source AND by angle** (`waterSource "key-light"`, Δ 0.000000° at both tiers), the hill clamp floor exact at **8.594°**, and the night sun landing **within 0.004°** of the commanded −14° — while **the noon/dusk legs and the moon expectation are UNMEASURED BY INSTRUMENT** (a recompute cadence the legs did not wait for; a night key that follows the MOON at 34.377°, the first measured reading of C's moonlit key and not a defect), **re-run pending** — pass 2b's azimuth leg is exact (key === hill at Δ 0) while its elevation legs are VOID: the gate wrote an `{ elDeg }` object to a handle the app reads as a timestamp, so the app kept its wall clock (§4.2). **Not open-as-defect** | key az −56° at every hour → the sun at every tier; `live:false` closed. **dayK 1.0 makes the daytime demotion built-and-off BY CONSTRUCTION** (the weight is exactly 1, so `uHillStrength * uHillElev` is bit-identical to R21 and `verify-sat-depth`'s margin does not move); 0.65 would have spent up to 35 % of a frozen margin on an unmeasured argument | **ON** (`hill.dayK` 1.0, `monumentsLambert` true), merged `a60bf17` |
| `POST_ORDER` (`smaaPreset 'high'`, dither) | 228/228 → 254/255 with midtones unmoved; merged pass count FALLS (sat 4→3, toy 6→5) | **ON** (`smaaPreset 'high'`, dither), merged `a60bf17` |
| `DEPTH_FIX` | node proof (`depth-roundtrip-proof`: RED flat **0.176–0.177** CoC, viewZ **−2.50 m**; GREEN error 0.000000; the mirror proven by EXTRACTING three's own formula, 8,004 comparisons bit-identical) + `verify-depth-offset` **7/7**; the **hook is proven present and published** (pass 2b: `__flyDepthProbe` present, `__flyDof` true) and **the browser round-trip is still pending** — that row's failure was the gate's pixel pick, not the hook (§4.2) | **ON**, merged `a60bf17` |
| `SHADOW_CALM` (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0) | shader edits and snap arithmetic **proven node-side (32/33 gates)**; mount/arm logic structural; **pixels, draw counts and whether the catcher actually receives a shadow unmeasured — user's machine.** Note for any program census: it changes the compiled TEXT of every shadow receiver with NO cache key, so a key census is blind by construction and a source-hash census sees every receiver move | **ON** (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0), merged `a60bf17` |
| `TERRAIN_LIGHT` — `fragmentHill`, `microFwidth`; `workerNormals` **false** | the tile half ships; the worker half is node-proven (3.34° → 0.26°) with zero pixels behind it, and ON would make `verify-skirt-worker`'s identity leg RED by design | **ON** — `fragmentHill` and `microFwidth` true, **`workerNormals` false**, merged `a60bf17` |
| `CLOUD_LIT` + `LAMBERT_ENV` (0.15) | same ONE draw; uniform-only for Lambert; the cloud variant's warm-set exception has a measurement condition attached | **ON**, merged `a60bf17` **ON** (`reflectivity` 0.15), merged `a60bf17` |
| `TERRA_PACE` {`timerFix`, `mergeHysteresis`, `keepResident`, `skirtFast`, `walkWhileSaturated`, `bboxCache`} | 22/17/178 → 0/0/0; timer 10/12 → 4/12; the saturated walk strictly conservative; skirt output element-identical; **live-arm fixture evidence now in** — merges 1 → 0, refetchParent 1 → 0, Owens **161 → 185 ≤ 261**, Powell **161 → 183 ≤ 375**, draws rising because `keepResident` keeps more tiles drawn. `verify-terra-live` (6)'s 1 → 17 repeat fetches are **ATTRIBUTED to the harness's ~51°/frame wall-clock yaw at 1 fps, not to the feature** — the LRU had nothing to evict (peak 30–36 % of a 140 MB cap) and merges were 0; re-measured in pass 2 at 0.85°/frame over a full 360°. **The yaw contracts HOLD on the flipped tree, on the venue: merges 35 → 0, on-screen replacements 27 → 0, content correct per tile in BOTH arms (0 URL / 0 position mismatches over 58 + 99 tiles).** **FIX LANDED, re-measure PENDING: the same row's ON arm read Owens 279 against the frozen 261** after a 600 s sweep (185 after 45 s in pass 1, same flags), with resident tiles 62 → 103 and `residentMB` 113.7 still climbing — **retention, not necessarily culling**, and **both requirements are met** — PATCH 26 `parkOffscreen` (off-frustum issued **142 → 0**, resident unchanged, the drawn set BOUNDED by the frustum instead of growing with sweep duration) and `maxResidentTiles` **260**, an LRU by last-visible frame with distance breaking ties, `verify-terra-residency` **22 → 32** RED-calibrated by neutering the park. **`keepResident` alone was the cause** (switch-by-switch, §3 A). **The 261 is not moved, and whether Owens lands under it is E's `terra-live` re-run to measure** | **ON** — `timerFix`, `mergeHysteresis`, `keepResident`, `skirtFast`, `walkWhileSaturated`, `bboxCache` all true; `skirtWorker` and `bendSphere` false, merged `5b13e35` |
| `LADDER_FIX` (incl. `nativeRefresh`) + `STEP_SAFE` | **`STEP_SAFE` is CERTIFIED ON THE VENUE (9/0)**: a quality-ladder step now applies the DPR, the renderer size AND the composer size **inside one frame**, with **the second writer guarded** (`stepGuard` {setPixelRatio: 1, setSize: 2} per step is r3f's re-apply being suppressed) — **the tear mechanism, a canvas resized outside the frame, has no remaining path on this tree**: 0 of 12 canvas writes outside a rAF (was 22 of 46), 0/6 for `setPixelRatio`, `setSize` and `composer.setSize`, 0 buffer mismatches in 65 frames, composer resized not rebuilt (§4.2). RED 6/13; two render-scale rungs before the first tier rung; DPR applied inside the drawing frame — **and pass 2b closed the composer lag (`composer.setSize` outside a rAF 6/6 → 0/6) and the buffer mismatch (22 of 46 → 0 of 43)**. **The DPR double-apply is ATTRIBUTED and FIXED** (`a0c1484`): the second writer is r3f's own zustand subscriber, re-applying `setPixelRatio` + `setSize` outside any frame after an AWAITED `root.configure` — triggered by the rig's own `setDpr`, so within the flag's reach — and `installResizeGuard` drops a resize into the state the renderer already holds while keeping `setViewport`, with `verify-step-guard.mjs` 13/13 behind it (§4.2). **`nativeRefresh` carries no measurement** — a no-op at 60 Hz, a target change at 120/144 (§6 item 4) | **ON** (incl. `nativeRefresh`), merged `5b13e35` **ON**, merged `5b13e35` |
| `HUD_SYNC` + `REBASE_CALM` | labels drawn with this frame's matrices; 704 m quantised anchor | **ON**, merged `5b13e35` **ON** (`quantM` 704), merged `5b13e35` |
| `FINALIZE_PACE` | **rule-1 spike fix CONFIRMED on the venue** (§4.2, flash-guard part 1) — and a SECOND defect attributed at the close: **the paced branch's toy merged index is a raw `Uint32Array` handed to `setIndex`, which wraps only a plain Array, so `WebGLAttributes` throws on `array.byteLength` once per toy land mesh** (80 broken meshes with the flag on in B's 2×2, 0 with it off, independent of `FLASH_GUARD`); **fixed in `e7325cd`** (wrapped, and the width mirrored from three rather than inferred), with `verify-finalize-pace` at **21/21** and B's census `BROKEN=0` on the dry tree; the ladder-fix re-take is the census leg. One shared brake. **Its first rule shipped as a LEVEL detector and starved every finalize below ~41 fps** — found at the close, §1 and §4.2 — and now refuses only on a genuine spike (> 24 ms AND > `spikeK` **2** × an EMA of the preceding frames) with a hard `maxRefuseFrames` **3** cap; `verify-finalize-pace` 14 → 17 gates, and the single-hitch gate passes both ways, so the behaviour the rule was written for did not move | **ON**, merged `5b13e35`, fix `abd127c` merged `3d388ec` |
| `FRAME_STATS` | the round's only frame-pace instrument; flag-off byte-identical, and **flag-gated with no runtime pin**, so `verify-frame-pace` runs for the first time in pass 2 (flip `6c26fe9`) | **ON**, merged `19d90b0` |
| `AERIAL_LAW.nightRamp` (A8) — **true while `AERIAL_LAW.enabled` is false** | FlyScene gates A8 on `nightRamp` alone and applies it to the LEGACY post strength on the `lawOn === false` branch; noon multiplier EXACTLY 1 keeps `verify-aerial`'s 0.55 exact, deep night EXACTLY 0; uniform-only | **ON with `AERIAL_LAW.enabled` false**, merged `91141fe` |

### Conditional

| Flag | Condition |
|---|---|
| `LOD_CROSSFADE` | **decided by pass 2's pinned ON leg** — pass 1 proved the gate as written has no ON leg at all (§4.2). D struck its own earlier "`hardSwaps` flat at 20": **the 20 came from a different pose, and the counter PARTITIONS events rather than counting them.** The criteria the leg asserts, and the only ones this record cites: `refines + merges === hardSwaps + faded` on BOTH legs · `refines + merges` FLAT OFF→ON · `hardSwaps` DROPS toward 0 while `faded` RISES on the ON leg · **the leak SIGNATURE rather than a number** — from `finish()` releasing every owned texture before deleting from `_active`, **LEAK ⟺ `active === 0` AND `retained > 0`** — asserted on the snapshot taken at the instant the drain condition held AND on a second read N frames later, with `refines + merges` attributing arrivals (INFO) against stuck (FAIL), plus the free invariant `retained ≤ active ≤ 4 × retained` while only refines are in flight · `0 < peakActive ≤ 32` (a session high-water mark, boot included) · `skip.concurrency > 0` acceptable ONLY with `peakActive === 32` · `skip.shape`, `skip.noParentMap`, `skip.unpatched` all **0** · Owens draws/tris EQUAL to the OFF leg's fixture numbers (**174 / 166,659**), not merely ≤ 261 · zero page errors · **NOT CALIBRATED** (not red) when `refines + merges` in the measured window is 0. **The decision procedure is written DOWN, in advance, at D's ledger §4.10b (`r24/d 1083168`)**: six PRECONDITIONS under which the run decides anything at all — no pace pin on either page · `skip.disabled` 0 · `skip.shape` / `noParentMap` / `unpatched` 0 · both arms offered swaps · **arc ≥ `MIN_ARC_DEG` AND the frame ratio within ±25 %** · both arms settled at Owens — and six FLIP conditions: **F1** ladder identity on both arms; **F2** `refines + merges` equal across the flip; **F3** `faded > 0` in-window with `hardSwaps` below the OFF arm; **F4** `maxBlendRun ≥ 2`, reported against 5; **F5** the drain snapshot at `active === 0`, the leak signature `active === 0 && retained > 0` clear on BOTH reads, a non-zero second read attributed by advancing counters, and `retained ≤ active ≤ 4 × retained`; **F6** Owens draws AND tris equal, zero page errors on both arms. The leg also polls `active === 0` (90-rendered-frame cap, count printed) and `skip.warp` unchanged across two reads rather than trusting a frame-count settle (D `8d1599a`/`51a95bc`). **Two things D put in writing BEFORE the numbers land.** Pass 2b — frame ratio **0.57**, with the refine counts matching at 4 anyway — is exactly why the frame-ratio band is a PRECONDITION and not a footnote: **on a green, D would have had no principled way to refuse it afterwards.** And **a green proves the REFINE path only** — A's yaw sweep saw merges 1 and D's ladder merges 0 — so if it flips, the recommendation reads, in D's words, *"the refine path is measured, the merge path is inferred from shared machinery (same uniform, same clip-UV transform, same clock, run backwards; merge direction gated structurally by `verify-lod-fade.mjs`), and structural is not measured"* — **`measured` for refines, `inferred` for merges, in the recommendation itself**. And the honest remainder that no fixture row settles either way: whether 250 ms reads as smooth or as MUSH at 60 or 144 Hz, and whether the crossfade removes the user's symptom or merely leaves the relief snap that a texture blend cannot morph — the user's machine, §6. Otherwise it holds at OFF with its RED on the record. <!-- FLIP:LOD_CROSSFADE PENDING --> |
| `AERIAL_LAW` (the law itself) | OFF this round. ON only after the horizon re-baseline batch runs with a fixture column AND one fixed-pose Owens draw row — D's own words: flipping it ON without the re-baseline "would be flipping a look nobody has seen". **OFF**, merged `91141fe` — the law ships off and only `nightRamp` is on |

### OFF at close

| Flag | Why |
|---|---|
| `ENV_UNIFORM` | the review-confirmed boot-gate / live-light-flip defect is fixed against a stand-in scene (9/9, `--red` 5/9), but the flip still needs the `programsDelta` run and the twilight A/B — and B never recommended it on construction alone |
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

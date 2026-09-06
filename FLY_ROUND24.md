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
pass 2a's logs are kept as diagnosis. **A dry-run merge of all five
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
| `LADDER_FIX` + `STEP_SAFE` | `36792a0` | five rungs with two render-scale steps first, native-refresh target, long-frame fraction term, DPR applied inside the drawing frame (`step-safe.js` + `StepSafeRig`), plus the FL-05 in-frame buffer check in the composer | ON (§6 taste; `nativeRefresh` carries no measurement — §6 item 4) |
| `HUD_SYNC` + FL-06 + `REBASE_CALM` | `2fadaa6` | labels drawn from `addAfterEffect` with THIS frame's matrices; CloudField priority −10; unconditional pre-render `camera.updateMatrixWorld()`; dead `rebaseEpoch` bump removed, matrix traversal narrowed to the tile subtree, anchor quantised to **704 m** = `HILLSHADE.micro.scaleM × 128` so the micro-grain no longer re-phases every 10 km | ON |
| `FINALIZE_PACE` + veg cap + toy typed index | `f8c6a4a` | one shared per-frame brake for all four engines (the first chunk is not free; the budget counts from frame start); `SatVegEngine._commitPending` capped; the toy merged index built as a `Uint32Array` | ON — but the module's header invariant ("neither rule can starve a chunk") **was false under sustained slowness**, and the close proved it: rule 1's fixed 24 ms threshold starves every finalize below ~41 fps (§1, §4.2). Fixed in `abd127c` (merged `3d388ec`): rule 1 refuses only when the frame exceeds both 24 ms and `spikeK` 2 × an EMA of the frames BEFORE it, capped at `maxRefuseFrames` 3; `verify-finalize-pace` 14 → 17 gates |
| `FRAME_STEP` (sim half) | `ed773b8` | 120 Hz accumulator, ≤4 substeps, `renderPos`/`renderAtt`/`renderAlpha` as NEW fields; `flight.pos` stays the sim truth | **OFF — "not landed"**: no consumer reads the smoother pose (§8) |
| `markPhase` | `70b9f42` | six sites, two vendored ones **by inversion** (`R24_SWITCHES.onPhase`, so the bundle never imports app code) | ON with `FRAME_STATS` |

Node gates (second number = the flipped branch, each grown by a ship-state row):
vendor **19 → 20** · terra-residency **21 → 22** · skirt-fast **12 → 13** ·
skirt-worker **8 → 9** · finalize-pace **11 → 12** · frame-step **10 → 11**.
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
| `LINEAR_HAZE` | `f15f044` | five haze/fade setters + `uHazeColor` decoded to linear; `getRimColor()` reads an authored-sRGB stash so SatVegLayer, which already decoded correctly, cannot double-decode | ON — seam 0.000 by construction |
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
handles production-dead) · c-flagoff **26 → 37** · worker-normals **12**
(3.34° last-writer → **0.26°** area-weighted) · shadow-calm **32** (**33/33**
flipped; the browser could not host it — its first term is the fleet pin
`__flySatShadowOverride`). **Zero constants moved, in six milestones.** What the
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

| Gate | PASS 1 (flag-off) | LIVE | NOT MEASURABLE HERE |
|---|---|---|---|
| `verify-classify.mjs` | **PASS** (38 gates) | — | — |
| `verify-warbirds.mjs` | **PASS** | — | — |
| `verify-daily.mjs` | **PASS** | — | — |
| `verify-depth-offset.mjs` | **PASS** 7/7, 185 files; RED **6/7** on base `6116fc5` | — | — |
| `verify-terra-residency.mjs` | **PASS** 21/21 (**22/22** flipped); 22 merges / 17 replaced / 178 refetches → 0/0/0 | — | felt smoothness |
| `verify-c-flagoff.mjs` | **PASS** — 26 gates at `990c7b5`, **37/37** after C's F4 and on the flipped branch (gate (1) asserts the SHIP STATE, so it is green in both passes) | — | — |
| `verify-worker-normals.mjs` | **PASS** 12/12 (3.34° → 0.26°) | — | **pixels** — the spliced worker runs only on the Esri LERC path |
| `verify-skirt-worker.mjs` | **PASS** 8/8 (**9/9** flipped), element-identical | — | end-to-end streaming; ⚠ its identity leg goes RED **by design** with `workerNormals` ON and needs a flag-on ARM, never a re-baseline |
| `verify-lod-fade.mjs` (D's node half) | **PASS** 51/51, reading the declared state | — | — |
| `verify-vendor-three-tile.mjs` | **PASS** 19/19 (**20/20** flipped, incl. gate 16b: the vendored switchboard's own literal defaults every switch to false) | live tile-URL identity (egress) | — |
| `verify-skirt-fast.mjs` | **PASS** 12/12 (**13/13** flipped); 13 cases, 4 bails | — | stalls/min |
| `verify-frame-step.mjs` | **PASS** 10/10 (**11/11** flipped) | — | the consumer opt-in against a pinned harness pose |
| `verify-finalize-pace.mjs` | **PASS** 11/11 (**12/12** flipped) | — | whether it removes a FELT hitch |
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

| Gate | PASS 1 — flag-off (`5ca8e15`) | PASS 2 — flipped | LIVE | NOT MEASURABLE HERE |
|---|---|---|---|---|
| **boot proof** | **PASS — `BOOT OK in 62.5 s`**, zero console errors, zero page errors, zero failed `/_next/` chunk requests | <!-- CERT:boot-proof PASS2 PENDING --> | — | a boot WALL TIME here is a SwiftShader number, never a budget |
| `verify-fixture.js` | **rc=0, 2,045 s, 10/10** at K=200 with a 900 s settle cap. (1) deterministic bytes — mvt 12,021 B / dem 1,817 B / img 46,864 B; (2) the 200-with-empty-body tile reachable; (3) satellite boots the fixture in **124.1 s** (`pct 100` at 54.6 s), img 74 / dem 74 / mvt 67 / tilejson 20; (4) **Manhattan is a city** — satBuilding meshes **22**, tris 496,466, settled in **256 s** at load 4.1, draws **189**, meshes 216 (satBuilding 22, satSkyline 10, toyChunk 110), sb **16/16**, maxZ 14, tiles 125; (5) **Powell is a suburb** — 16 satBuilding meshes, sb 16/16, draws **194**, tris 368,119, **parcel homes 555**, settled 200 s, maxZ 15, tiles 161; (6) **THE OWENS LOCK** — bld 0 / sky 0 / parcel 0, draws **166**, tris 183,709, sb ready 0 / **empty 16**, settled in **38 s**, maxZ 16, tiles 177 (FIXTURE column, informational against the live ≤ 261); Melton draws 184, tris 486,321, **1,836 parcel homes from zero footprints**; (8) traffic stub 300 tracks, 69 aircraft requests; (9) toy boots on the fixture — toyChunks 98, tris 273,567, boot 141.3 s, draws 212; (10) both boots clean | <!-- CERT:verify-fixture PASS2 PENDING --> | — | n/a — it certifies the venue |
| `verify-flash-guard.js` | **rc=1, 534 s, 5 passed / 1 failed — RED calibrated**; legs below. **Three readings that change how the flag is described:** the **skyline site is INSURANCE, not a fix** — its path runs `simplifyRing` before the wall loop and the collinearity test drops the closing clone, so the zero-length wall edge never exists there and a green at that site repairs nothing (recon A1b predicted it; nobody had measured it — B ledger §15.1); **Powell's 8.28 % lands inside R22.1's live 6.36–8.64 % band** while Manhattan's worst chunk at **13.98 %** is above it, the expected shape rather than a contradiction (the band was quoted for *every large chunk*, the defect is a fixed count per ring, so a chunk with small or few footprints is proportionally worse — B's 4-corner fixture reads 14.22 % for the same reason); and **the toy site is NOT EXERCISED by any row this round** — both poses run satellite, the toy extruder carries the same wrap-around loop at `vector-tile.worker.js:4285`, and the close ruled no toy leg is added, so B's node legs (toy `full` **14.84 % → 0**; 2,288 → 0 on E's Manhattan tile) are **evidence that the code works and not a certified browser leg**. **`(4) PALE DETECTOR` — `frames=256 pale=168 worstScanlineMean=222.3` — is VOID and must never be quoted as a result**: the scanline sat 55 % up the frame and a banked serpentine spends much of its time looking at a clear daytime sky (~213 luma), so 168 identical-mean frames are a sustained bright FIELD, not the one-frame jump the detector exists to catch — R17 §7.1 arriving as false POSITIVES for once. Fixed at `r24/e e1b7905` (running median of 24 frames, scanline at 0.25 height bottom-up, a hit needs jump > 60 over the median AND min > median + 40 AND absolute > 180; renamed `worstJumpOverMedian`), **not yet RED-calibrated** — it owes a synthetic one-frame jump scoring exactly one hit and a serpentine scoring zero | **pass 2b: rc=1, 571 s, 6 passed / 1 failed — the census is ALIVE, the green leg is void again, and the detector lost its own self-test** (below). Marker stands for the standalone re-take <!-- CERT:verify-flash-guard PASS2 PENDING --> | PENDING — the pale FRAME itself | the pale detector is probabilistic (live rate 1 per 1,600 to 1 per 20,389 composed frames); **the census decides the gate** |
| `verify-fade.js` | **rc=1, 338 s, 4/2 — RED calibrated.** (1) births **14** / deaths **10** over 94 frames; (2) **14 of 14 hard births** — *"presence channel is none: no material carries a fade uniform"*, which IS the flag-off state; (3) **10 of 10 hard deaths**; (4) `ready` tracks CHUNKS, not presence (ready 0 of 16 during the serpentine); (5) **THE OWENS LOCK — sbReady 0, skyReady 0, draws 156** (a FIXTURE number; the live ≤ 261 is not re-baselineable from here); (6) clean. **GREEN needs pass 2** — the gate carries no ON pin | **rc=1, 346 s, 4 passed / 2 failed — the flip did not produce a fade VISIBLE TO THE GATE; ATTRIBUTION PENDING.** With `CHUNK_FADE` + `HEAL_IN_PLACE` ON in constants: (1) births **29** / deaths **20** over 122 frames; (2) **29 of 29 HARD births**, with the probe's own note — *"presence channel is 'none': no material carries a fade uniform or transparent opacity — this IS the flag-off state"*; (3) **20 of 20 hard deaths**; (4) `ready` tracks CHUNKS, not presence (ready 4 of 16 in the sweep, series in the log); (5) **THE OWENS LOCK — sbReady 0 / skyReady 0 / draws 190** (FIXTURE), against **156 at the same pose on the flag-off pass**: the flipped tree adds **34 draws at Owens**, still ≤ 261, **and that delta is NOT attributed here**; (6) clean. **ATTRIBUTED, from source, and it is the INSTRUMENT's**: `verify-fade.js:81-95` `presenceOf()` looks for `material.uniforms` named `uBirth` / `uChunkFade` / `uFade` / `uChunkBirth`, or `material.transparent` + `opacity` — but `CHUNK_FADE` rides a POOLED TWIN `MeshLambertMaterial` whose fade uniform is injected through `applyBendAnchor*(material, uniform)`, an **`onBeforeCompile` uniform and not a `material.uniforms` entry**. B had already published the read handle **on purpose** — `lib/fly/toy-world/chunk-fade.js:98-102`, `t.material.userData.__fadeU = t.uniform`, *"so a probe can read the EFFECTIVE fade"* — in both engines (`sat-skyline-engine.js:163-171`, `sat-building-engine.js:345/821-868`), and it is listed in B's own §10 hand-off table to E. E is fixing `presenceOf()` to read `__fadeU` first (channel `'__fadeU'`) while keeping the `'none'` verdict for the flag-off tree; **the fade row joins flash-guard in the standalone re-take after pass 2b's end line** — with E's probe commit (`r24/e fcb168a`, `+27f36e8`) in, and **a second defect that B's point (b) exposed INSIDE E's first fix**: the channel label used `??=`, first-write-wins, and **the first mesh sampled is almost always one at rest**, so the row would have printed "presence channel = none" AGAIN with `__fadeU` being read correctly. The label is now **the most specific channel seen anywhere in the run**, self-test (5c) is exactly that sequence (rest sample first, ramp sample second), (3) prints `hardDeaths` against `fadeBudgetMiss` under B's rule, and the probe has its own RED (`FADE_PROBE_SELFTEST=1`, **7/7**) that extracts `presenceOf` from the file's own source — which first matched three characters of its own COMMENT, so the marker is built by concatenation now, and which must run before `require('playwright')`. **E then took the further step (`r24/e 4972f14`) of having the gate PRINT B's reading rules beside its own verdicts** instead of leaving them in a ledger: deaths are expected at ≥ 3 partial samples on this venue, with the birth/death asymmetry explained in the gate's own output — **a naive "≥ `minFrames` partial samples" would have gone RED on a correct implementation, for every death** — and the heal taxonomy is read in full (`healsInPlace` is the fix working, `healsAborted` moot, `healsNoRecord` water-only, `healsCoalesced` a re-drape in flight, `redraping` draining, and **only `healsQueueFull` is a hole**), with an explicit **"unpublished"** verdict instead of a silent fallback to the total: this run's "heals 9" **is uninterpretable on its own, which is the point**. Probe self-test 7/7. B's source read at `ec53fd3` completes the picture and sets the re-take's expectations in advance: `__fadeU` is published in **ONE** place, `TwinPool._newTwin` (`chunk-fade.js:102`), and both engines build their twins through that pool (`sat-building-engine.js:345`, `sat-skyline-engine.js:167`), while the GLSL uniforms are `uSatBldgFade` / `uSkyFade` — **neither in the gate's guessed list**. The twin sits on a mesh **only during a ramp**: on birth completion the shared material is restored and the twin returns to the pool, and dying meshes leave the scene, so **a resident chunk at rest has no `__fadeU` and "absent" is presence 1 BY DESIGN**. A birth's first displayed frame is presence **0** (`_startBirth` writes 0 in the same synchronous block as `object.add`, `:847`), so **all 29 births are expected SOFT once the probe reads the handle**. A death's first frame is presence ≈ **1** by construction (`_startDeath` writes `_altFade`, 1.0 at the certification poses, `:873`) and the ramps are **TIME-ONLY**, so at this venue's **2.84 s per frame a 0.3 s evict ramp cannot span two samples** and every death reads hard regardless of budget — a venue effect (0.3 s is 18 frames at 60 fps) that **B fixed in the PRODUCT** (`r24/b 45e2cde`, held until pass 2b's end line and merging with E's probe fix before the re-take): a frame-count floor, `progress = min(elapsed/sec, framesSince/CHUNK_FADE.minFrames)`, in both engines and both ramps through `rampT` (records carry `f0`; `_stepFades` advances a monotone `_fadeFrame`). **`minFrames` is 4, not the 3 asked for, and B flagged the difference with the arithmetic**: a birth starts at presence 0, so N frames give N partial samples, while a death starts at full presence BY DEFINITION and N frames give N−1 — so "≥ 3 partial samples on a death" needs **4**. At 60 Hz, 0.3 s is 18 frames ≫ 4, so elapsed governs and **shipped behaviour on a normal machine is unchanged by construction**. Proof rows (`r24-b-engine-proof.js`): `--dt=2.84` (this venue) **pops 0** against 92 flag-off, births ≥ 1 and deaths ≥ 3 partial samples; `--dt=0.0167` (60 Hz) pops 4, **all `fadeBudgetMiss`**, deaths ≥ 17 partial — elapsed governs, ramp length unmoved; `--dt=0.0167 --hitch` **pops 0**, so a 500 ms frame mid-ramp can no longer complete a ramp; `--off` **pops 92 / 0 ramps**, byte-identical RED. Caps: `maxConcurrent` 8 births is unreachable in the serpentine (`finalizePerFrame` 1 per engine, ~2 in flight), while `maxDying` 4 CAN be exceeded by the eviction loop (`:1077`) and the AGL cull (`:1020`), so the re-take's hard-death count is read against the cumulative `stats.fadeBudgetMiss` (`:843`/`:857`) — **`hardDeaths ≤ fadeBudgetMiss` is capped as designed, greater is a defect**. **The re-take's expected reading, written before it runs: births SOFT, deaths spanning ≥ 3 partial samples (`minFrames` 4), hard deaths ≤ `fadeBudgetMiss`** <!-- CERT:verify-fade PASS2 PENDING --> | PENDING — the LOOK of the fade | — |
| `verify-lod-fade.js` | **rc=1, 317 s, 2 passed / 5 failed — RED calibrated** (Powell, a 40 s PURE YAW with the position frozen). (1) `residentTiles` 0 / `estMB` undefined — A's byte LRU only tracks with `TERRA_PACE` on, expected in pass 1; (2) 47 frames, 61 events; (3) **27 RE-appearances on a pure yaw** = A's T1/T3 bend-blind re-stream, measured from the other side; (4) **8 hard refines + 3 hard merges** = D's T4 atomic swap; (5) crossfade window **0 frames**; (6) **15 tile URLs refetched**, worst 2× `/img/6/23/17` = A's refetch defect; (7) Owens FIXTURE draws **174** / tris **166,659**; (8) zero page errors. **Scope of the wall-clock caveat, narrowed:** it applies to **(3) and (6) ONLY** — both are functions of how far the heading moves per download round-trip, and this sweep steps ~51° per rendered frame (PASS 2 cell). **(4) hard refines + merges is yaw-rate INDEPENDENT** — an atomic parent↔children swap is atomic at any heading rate — **so it stands as D's T4 RED and §1 Symptom B's citation is unqualified.** **(5) has since been RETIRED**: its 0 is true at any rate but carries no information, because a mesh co-display census reads 0 by construction under `parentBlend`, and recording it in the RED table as a defect was an error of this record's own — corrected here, and replaced in the gate by `maxBlendRun` over `terra.fades.active` (PASS 2 cell). The re-take's OFF leg re-measures all four, so the record will end up carrying both experiments for (3)/(6) and one consistent RED for (4)/(5). **A gap the row exposed:** as written the gate has **no ON leg** — it never sets `window.__flyLodFadeOverride` — so the one feature that ships OFF *pending a measurement* could not have obtained it from either pass. E is adding a pinned ON leg for pass 2 (D reviewing it, §5.2); expected then: (3) and (6) GREEN from `TERRA_PACE`, (4) and (5) still RED in the OFF leg because LOD ships OFF, and **the pinned ON leg decides D's go/no-go** | **PASS 2b: the row CRASHED after gate (13)** — `ReferenceError: notCalibrated is not defined at scripts/verify-lod-fade.js:782`, gate (14)'s NOT CALIBRATED path calling a helper the file never imports: **the round's own unimported-symbol class (§5.1), this time in a HARNESS file**, which `verify-import-integrity` could not catch because it sweeps `lib/`, `components/`, `app/`, `hooks/` and `stores/` and not `scripts/` — E is extending it, with this as its RED. **What it measured before dying is still the most useful pair of legs in pass 2b.** OFF leg (LOD off, `TERRA_PACE` shipped): `terra.fades` refines **4** · merges 0 · hardSwaps **4** · faded **0** · `skip.disabled` 4; sweep 46 frames, **0 re-appearances**, 4 hard refines, window 0, 20/59 refetched (the wall-clock artifact), Owens **229** draws (FIXTURE — the flag-off pass read 174 at this row's Owens pose), (8b) ladder identity 4+0 = 4+0. ON leg (`__flyLodFadeOverride {enabled:true, skipBootMs:0}`, second context): (9) `TERRA_PACE` unpinned on BOTH legs; warp settle steady at 3 after 17 rendered frames; drain "held after 26 rendered frames"; sweep 26 frames · 8 appearances / 2 disappearances · **0 re-appearances** · frame-diff hard 2+0 · co-display run 0; `terra.fades` refines 4 · merges 0 · **hardSwaps 0** · **faded 4** · `active` NOW **8** · `retained` **2** · `peakActive` 8/32; every skip reason 0 (disabled, boot, warp, concurrency, shape, noParentMap, unpatched); (10) armed, (11) 4 swaps offered, (12) no defect denials, (13) 4+0 = 0+4. **So the REFINE path armed and blended on D's own counters — hardSwaps 4 → 0, faded 0 → 4 — while the MERGE path stayed unexercised (merges 0 on both legs), exactly as D predicted.** **D'S READING RESOLVES BOTH OPEN QUESTIONS.** (1) **The refine path is PROVEN**: hardSwaps 4 → 0, faded 0 → 4, all seven skip reasons 0 and the ladder identity on both arms — `skip.disabled` 0 proves the pin reached the ladder, `skip.unpatched` 0 proves it arrived BEFORE material patching. (2) **`active` 8 / `retained` 2 is ARRIVALS, not stuck blends and not the leak**, on three grounds: `waitUntil` returned "held", so **`active === 0` WAS observed**; `retained` counts distinct parent TEXTURES while `active` counts MATERIALS, and a refine arms four children off one texture, so **8/2 is exactly two refine events in flight — a 4:1 ratio no stuck set lands on by coincidence**; and `skip.concurrency` 0 with `peakActive` 8 of 32. Between the drain returning and the later read the yaw interval kept pinning the final heading — **the camera stops but the streamer does not** — and each `page.evaluate` round-trip is several rendered frames, so two more refines landed. **The 26-frame drain does not prove the absence of a leak and cannot, as written**; the signature is exact, from `finish()` releasing every owned texture before deleting from `_active`: **LEAK ⟺ `active === 0` AND `retained > 0`**. The re-take therefore asserts (16) on the snapshot taken at the INSTANT the condition held, takes a SECOND read N frames later with `refines + merges` to attribute arrivals (INFO) against stuck (FAIL), asserts the leak signature on both reads, and adds the free invariant **`retained ≤ active ≤ 4 × retained`** while only refines are in flight. (3) **(5) reads 0 by construction, FOREVER**: mode `'parentBlend'` never keeps the parent mesh drawn — it blends the parent TEXTURE into the child material through clip-UV and disposes the parent model as upstream does, for zero extra draws. The measurement needs no app change: sample `__flyStats.terra.fades.active` per frame, and **the longest run of `active > 0` IS the crossfade window**, with per-tile `__lodFade.mix.value` strictly in (0,1) as an INFO row. (4) **`merges` 0 at every pose is `keepResident` WORKING** — frustum-exit merges no longer happen — so chasing them would measure a tree that does not ship, and the merge path is recorded as **structurally gated only**. (5) **Nobody had flagged this**: gate (14) would have gone NOT CALIBRATED on this run — framesOFF 46 against framesON 26 is **0.57, outside the ±25 % band** — and the refine counts matched at 4 **by luck**, so the old literal gate would have printed a meaningless green. **The [C3] guard earned its place on its first outing**, and it is the strongest argument for the frame-based yaw. **E's REWORK is committed** (`r24/e cba7b45` + `356e32d`, held for the pre-re-take merge; node smoke 16/16, import-integrity 4/4 over 374 files): the yaw is now **0.85°/frame on rAF with a 360° minimum arc**, `FLY_LOD_SWEEP_MS` bounding wall time at the old 40 s default, arc and frames printed beside every verdict, (3) and (6) **NOT CALIBRATED on a short arc**, and both legs sharing the sweep; **D's spec is applied in full** — drain snapshot at the instant the condition held, a second read 12 frames later with `refines + merges` (advanced ⇒ arrivals INFO, flat with `active > 0` ⇒ stuck FAIL), the leak signature `active === 0 && retained > 0` on BOTH reads, and the invariant `retained ≤ active ≤ 4 × retained`; **gate (5) is RETIRED as the crossfade measurement** — a mesh co-display census reads 0 by construction forever under `parentBlend`, **and its 0 had been written into the RED table as a defect** — replaced by `terra.fades.active` sampled per frame (`blendFrames`, `maxBlendRun` = the crossfade window, `peakActiveInWindow`) plus an INFO row over `material.userData.__lodFade.mix.value` in (0,1); and `merges` is printed as UNEXERCISED because `keepResident` works, not chased. **D's read of that diff found three corrections, all in**: [E1] three-tile tile meshes carry a material ARRAY (`super(g, m ?? [])`, `syncMaterials` assigning `this.material[i]`), so the mix census read `.material.userData` on an array and **would have printed "0 materials carry `__lodFade`" on every healthy run, with a fallback that made it look expected** — it now iterates the array as `terrain-engine`'s `onTileMaterial` does, keeping the equalities `mixes.length` = patched materials and `midRamp.length` = `active`; [E2] **(16d) was VACUOUS on a healthy run**, guarded on the snapshot that SATISFIED the drain — where `active === 0` by definition — so it only ever evaluated on a CAPPED drain, and is now evaluated on the second read; [E3] **(16b) turned a missing snapshot into "the blends are stuck"** (null falling into the else) and now reads NOT CALIBRATED. D's measurement note goes with them: **0.25 s of fade clock is 5 clamped frames at any fps, so `maxBlendRun ≥ 5` is a COMPLETE blend and a shorter run means the sweep ended mid-blend.** D is writing the go/no-go template, so the call is mechanical when the re-take's numbers land. **`LOD_CROSSFADE` stays OFF and its FLIP marker stays PENDING** until then <!-- CERT:verify-lod-fade PASS2 PENDING --> | PENDING — whether swaps are still visible at real frame rate | the fade's real DURATION (a 250 ms blend completes inside one SwiftShader frame) |
| `verify-step-clean.js` | **rc=1, 229 s, 4/4 — RED calibrated**, viewport DPR 1.5, governor pin RELEASED (the fleet's `'hold'` was written and the accessor swallowed it). (0) pin released; (1) **the released term is reachable** — 6/6 forced steps ACCEPTED, 6 DPR applications, DPRs seen `[1.25, 1.5]`; (2) **18 of 18 `canvas.width/height` writes OUTSIDE a rAF** (width 1600 at t=171932, `inRaf:false`); (3) `setPixelRatio` 6/6 and `setSize` 12/12 outside; (3b) `composer.setSize` **6/6 outside** — the passive-effect lag; (4) `bufferMatchesDrawing` **false on 22 of 46 frames** (composer 1920×1080 vs drawing buffer 1600×900 at frame 7); (5) the composer is **RESIZED, not rebuilt** — rebuilds 1 → 1, resizes 6, R21's `FX_STABILITY` holding; (6) clean. GREEN for (2)/(3)/(3b)/(4) is expected in pass 2 with `STEP_SAFE` on. **The gate states in its own output that the tear LINE is not measurable here** | **HALF GREEN — the composer lag and the buffer mismatch are CLOSED; a DPR double-apply is OPEN.** `rc=1, 241 s, 6 passed / 2 failed` with `STEP_SAFE` + `LADDER_FIX` ON, DPR 1.5, pin released. Closed by the flip, pass 1 → pass 2b: **(3b) `composer.setSize` outside a rAF 6 of 6 → 0 of 6** — the −99 rig owns the composer resize; **(4) `bufferMatchesDrawing` mismatched frames 22 of 46 → 0 of 43 — the mechanism behind the tear symptom that this gate CAN see is closed**; (5) composer resized, not rebuilt, 1 → 1 in both passes; (0)/(1) pin released with 6/6 forced steps, 12 DPR applications, dprs [1.25, 1.5]; (6) clean. Still red, and the shape is precise: **(2) canvas write outside a rAF 18 of 18 → 12 of 30**, **(3) `setPixelRatio` 6 of 6 → 6 of 12 outside and `setSize` 12 of 12 → 12 of 24 outside** — **EXACTLY HALF of every canvas/renderer write with the rig on: 6 steps, 12 applications, 6 inside and 6 outside**, i.e. **a SECOND WRITER applies the DPR outside the frame alongside A's rig** (the legacy apply path, or R3F's own `setDpr` effect not suppressed when the rig owns the step). A is reading the write sequence node-only: if it is `STEP_SAFE`'s, the fix is **"the rig is the only writer"** with the gate asserting exactly one application per step INSIDE the frame, and step-clean joins the standalone re-take; if it is an R3F path outside the flag, it is recorded as such <!-- CERT:verify-step-clean PASS2 PENDING --> | PENDING — and the ladder the user's real DPR has | the tear LINE |
| `verify-ladder-fix.js` | **rc=0, 90 s, 13/0 — GREEN, and a measured ON leg**: the gate boots TOY and arms `LADDER_FIX` + `STEP_SAFE` through their runtime pins. (1) **two sub-native rungs on a DPR-1 display**, 0.875/high and 0.75/high; (2) both BEFORE the first tier rung (last sub-native index 2, first tier rung 3); (3) boot rung still index 0 at native DPR and boot tier; (4) tier rungs unchanged in order and count; (5) refresh estimated from the frame cadence = **144 Hz**; (6) `nativeRefresh` target **144** vs refresh 144; (7) **a stuttering session steps DOWN on a healthy mean** — rung 3 at `emaFps` **53.4** (at/above the 51 fps down bound), `longFrac` 0.1, the pattern the EMA cannot see; (8) CONTROL: a clean 60 fps session never steps (rung 0, dprSteps 0, tierSteps 0); (9) dpr steps [0.875, 0.75, 1] then tiers ["medium"]; (10) a forced step moved the ladder 0 → 1; (11) **`STEP_SAFE` applied it INSIDE a frame, not via the valve** (n=1, `applyMs` 466.8 — a SwiftShader number, `composer=true`); (12) composer buffers ARE the drawing buffer ([560, 315] both); (13) clean. **The R20 flap condition `[1/high, 1/medium, 1/low]` is now the five-rung ladder, measured**  | <!-- CERT:verify-ladder-fix PASS2 PENDING --> | PENDING — governor behaviour in real time, on the user's real DPR and refresh | the tear LINE; every fps/ms number |
| `verify-ladder-fix.js` + `FLY_LADDER_RED=1` (the control arm) | **rc=1, 94 s, 7 passed / 6 failed — EXACTLY the expected RED, i.e. the control arm is a control.** (1) **0** sub-native rungs; (2) last sub-native **−1**, first tier rung **1**; (6) target **60** vs refresh 144 — the 60 Hz cap; (7) rung 0 at `emaFps` 53.4 with `longFrac` **0**, no stutter step-down; (9) dpr steps **[]** then tiers **[]**; (11) `STEP_SAFE` "no record"; controls (3)(4)(5)(8)(10)(12)(13) pass with buffers [640, 360] matching. **A's hardening of the omitted-pin trap, holding on the flag-off tree** (lesson 26) | <!-- CERT:verify-ladder-red PASS2 PENDING --> | PENDING — the same control on a real display | — |
| `verify-one-sun.js` | **rc=1, 251 s, 20/7 — RED calibrated.** Both pins released (`__flySunOverride` null → null, `__flySatShadowOverride` 0 → 1) and **`live === true` at high AND medium**, so the released term is proven reachable before anything is asserted. Azimuth key === hill, **Δ 0.00e+0°** at every tier and time. **Key ELEVATION stuck near 45° — 39.552° high/noon, 45.291° high/dusk, 45.142° elsewhere — against a true solar 55 / 2 / −14, at high AND medium**: recon L3, measured in the shipped app. **Medium azimuth spread 0.0000°** is the RED itself. Gate (5) — "water reads the same directional, Δ undefined°" — **PASSED on an absent reading**, i.e. vacuous; E is fixing it. No page errors | **the flip changed the CONSTANT (≈45° → ≈23°) without making the key TRACK the sun — attribution with C.** `rc=1, 263 s, 14 passed / 7 failed / 6 NOT CALIBRATED`, `ONE_SUN` ON at `dayK` 1.0, both pins released. (0a)/(0b) **`live = true` at high AND medium**; (1) azimuth **key === hill, Δ 0.00e+0°** at every tier and time; (2) **KEY ELEVATION FAILS EVERYWHERE, at a CONSTANT ≈ 23°** — 23.132° high/noon against a true 55.000, 23.132° high/dusk against 2.000, 22.938° high/night against −14.000, and 22.938 / 22.753 / 22.753 on medium — **with `casting = undefined` on every line** (the flag-off pass read a constant ≈ 45°); (6) **the MEDIUM-TIER RED: key azimuth spread across three sun elevations 0.2458°**, against 0.0000° flag-off and a gate that wants > 1°; (5) **NOT CALIBRATED ×6** because `water` publishes the STRING `"key"` and `angleBetween` returned null — **E's NOT CALIBRATED verdict working as designed exactly where the flag-off pass had a vacuous PASS**; (7) clean. Four questions are with C, node-only: a constant ~23° at −14°, 2° and 55° looks like `SAT_SHADOWS.minElRad` applied UNCONDITIONALLY rather than only while the shadow camera casts, or an elevation term that never reaches the key while the azimuth term tracks; whether `casting` is published under the name the gate reads; how much azimuth movement C's contract actually predicts across three ELEVATIONS at a fixed hour (**the > 1° expectation may be the instrument's**); and whether water `"key"` is C's published by-reference semantics, in which case (5) is Δ 0 by identity. **One-sun joins the re-take if a fix lands** <!-- CERT:verify-one-sun PASS2 PENDING --> | PENDING — the LOOK (checkpoint 5) | — |
| `verify-linear-haze.js` | **VOID — reader outside rAF; re-run pass 2.** rc=1, 240 s, 4 passed / 2 failed, and not one of the six means anything: both poses read **terrain L 0.0 / sky L 0.0**, an all-zero luma profile and "horizon row 6 of 540, step 0.0", because the seam reader ran from `page.evaluate` **outside any animation frame** against a `preserveDrawingBuffer:false` context, so `readPixels` returned a CLEARED default framebuffer. (1a)/(1b) failed honestly ("no horizon in the frame"); (2a), (2b) and (3) then PASSED — "RIM SEAM ≤ 12/255 Δ 0.0" and "seam independent of time of day, spread 0.0" — **on black against black**. E's rewrite samples at the start of the NEXT animation frame on the renderer's own context (the pale detector's idiom, which is why the census rows worked) and makes (2)/(3) print **NOT CALIBRATED** whenever (1) fails. `verify-depth-roundtrip` has no `readPixels` path and is not the same shape | <!-- CERT:verify-linear-haze PASS2 PENDING --> | PENDING — whether live colours land in the same band | — |
| `verify-depth-roundtrip.js` | **rc=1, 220 s, 1 passed / 1 failed — NOT RUNNABLE, not RED** (toy, tier high, renderer `reversedDepth=true`). Gate (0) refused because **`window.__flyDepthProbe(x, y)` was ABSENT** — *"this gate cannot reconstruct viewZ without the renderer's own conversion; re-implementing it in the harness would test the harness's copy of the bug"* — required signature `{ viewZ, coc, raw, reversed }` over drawing-buffer pixels, top-left origin, owner C under `DEPTH_FIX`; it printed `dof=null`, and gate (0b) "the DoF pass is present" then PASSED on an inference from style and tier while `dof` was null — **the fourth vacuous pass of the day**; E is making it read a handle. C has since built the hook (`e59445d`, §3), so **the PASS 2 marker stands**. Note for pass 2: an `error` there means **neither float target renders** — recorded with the probe's own string, and read as NOT RUNNABLE HERE rather than as a defect | <!-- CERT:verify-depth-roundtrip PASS2 PENDING --> | — | needs `window.__flyDepthProbe`; absent ⇒ the row reads NOT RUNNABLE, never RED |
| `verify-terra-live.js` | **rc=1, 715 s, 8 passed / 1 failed — both arms, armed through `__flyTerraPaceOverride`.** Arm A (trio OFF): content 62 URL / 64 pos, **0 mismatches**; yaw merges **1**, replacedOnScreen 0, refetchParent 1, imagery requests 33, URLs fetched >1× **1**; Powell draws **161** / tris 294,870; Owens **161** / 182,645; `residentMB` 0. Arm B (trio ON — `timerFix` + `mergeHysteresis` + `keepResident` + `skirtFast`): content 59 URL / 65 pos, **0 mismatches**; yaw merges **0**, replacedOnScreen 0, refetchParent **0**, imagery requests 36, URLs fetched >1× **17**; Powell **183** / 273,085 / `residentMB` **41.3**; Owens **185** / 157,297 / `residentMB` **50**. Gates: (1)(2)(3) content PASS — **a cache/URL mix-up is RULED OUT as a separate cause of "tiles swapping" in this code path** (A's §9 row 8, answered on the fixture; the live-capture variant stays a user-machine item); (4) merges **1 → 0** PASS; (5) replaced-on-screen 0 → 0 PASS; (6) "the same tile URL is not fetched twice as the heading comes back round" **RED 1 → 17 — ATTRIBUTED to the instrument's ~51°/frame yaw step (upstream DISCARDED refines), not to `TERRA_PACE`; re-measured in pass 2 at 0.85°/frame over 360°** (A, `d03ccdc`, docs + instrument only). The byte LRU is ruled out by arithmetic: the cap is 140 MB and a tile costs ≈ 341.3 KB imagery + 58.0 KB DEM geometry ≈ **399 KB**, so the cap admits ≈ **358 tiles**, while the observed peak was 41.3 MB ≈ 106 tiles (**30 % of cap**) and the worst arm 50 MB ≈ 128 tiles (**36 %**) — **the LRU had nothing to evict** — and its only route to a refetch is `_r24Collapse → merge`, with merges **0** in that arm. Counter semantics were ruled out by E (reset per arm, `no-store`). **The positive mechanism is upstream's**: `_loadSubTiles` starts a refine, downloads the children, then DISCARDS them when the parent stops being a refine candidate on the next evaluation — and at ~1 fps the wall-clock `PIN_YAW` stepped **~51° per rendered frame**, so a tile enters and leaves the refine set inside one download round-trip and the next arrival of that heading re-requests it. Node probe on the vendored classes: at **0.85°/frame** with the trio on, duplicates **1 → 0**; at **51°/frame**, **28 → 28** (merges replaced by discards); with `walkWhileSaturated` on, **4 → 28**, because it correctly restores refine starts — **the red measured the venue's yaw step, not the feature**. `PIN_YAW` is now frame-based (`YAW_DEG_PER_FRAME` 0.85 inside a rAF, `YAW_MIN_ARC_DEG` 360) with gate 6 guarded by `arcOk` and printing SKIP / NOT CALIBRATED on a short arc (45 s here ≈ **38°** of arc); pass 2 runs the full 360° (~424 rendered frames, 7–8 min per arm) and gate 6 asserts for real. Two of E's own caveats remain to confirm: the "URLs fetched >1 time" filter **had no prefix test**, so the 17 includes DEM, MVT and API URLs while "imagery requests 33 → 36" is imagery only (per-prefix breakdown lands for pass 2; an eviction-refetch cycle shows in `img` and `dem` only), and the reset is **not atomic with the pin**, so boot-tail requests land inside the window. **Every fixture response is `no-store`, so a fixture refetch count is an UPPER bound on live**, where real cache headers and R21's persistent Cache API tile cache both apply; (7) **CEILING Owens ≤ 261 in every arm — off 161 / on 185 PASS**; (8) satellite ≤ 375 at Powell — off 161 / on 183 PASS; (9) clean. All FIXTURE numbers. **Draw counts rise off → on at both poses because `keepResident` keeps more tiles drawn, and the frozen ceilings hold with margin.** **Two limits at exactly A's strength:** the fixture serves deterministic bytes per (z,x,y) and Esri does not, so the merge that REPLACES four children with a coarser parent reads here as a resolution change and on the user's machine as a **DIFFERENT CAPTURE** (season, sun, colour) the probe cannot see because URL and position are both correct — still LOD policy, the fix unchanged, and the reason the symptom reads more violently live than any fixture number shows; and the probe only tests tiles whose material already has a map, so its denominator excludes the mid-load tiles that are the likeliest moment for a mismatch | <!-- CERT:verify-terra-live PASS2 PENDING --> | PENDING — the residency trio's live draw evidence, and whether gate (6)'s repeat fetches appear on real bytes | the LIVE capture difference behind a merge; a fixture draw count bounds nothing live |
| `verify-frame-pace.js` | **rc=1, 153 s — NOT RUNNABLE BY DESIGN, not RED.** Gate (1): *"THE INSTRUMENT IS PUBLISHED — `window.__flyStats.frame` with `sample()`/`ring()`/`reset()` — absent — `FRAME_STATS.enabled` is false. Everything below is unmeasurable; that is the flag-off state, not a failure of the renderer"*, and the pacing legs are skipped. `FRAME_STATS` has **no runtime pin** — E's instrument is flag-gated and E's flip `6c26fe9` ships it ON — so **pass 2 is the first run of this gate**; even then its pacing legs are informational in this venue by design | <!-- CERT:verify-frame-pace PASS2 PENDING --> | PENDING — **everything**: stalls/min, worst dt, p99, >100 ms/min | the pacing legs are not asserted here; flag-off it correctly reads "instrument absent — unmeasurable, not a renderer failure" |
| `verify-seam.js` browser leg | <!-- CERT:verify-seam-browser PASS1 PENDING --> | <!-- CERT:verify-seam-browser PASS2 PENDING --> | PENDING | — |
| `verify-env-uniform.js` | <!-- CERT:verify-env-uniform PASS1 PENDING --> | n/a — the feature ships OFF | PENDING — the ms a compile storm costs | the proof B asked for and never ran |
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
dropped into the swept tree yields **7 `no-undef` errors**) (the tenth, pass 2b's pale self-test registering 0 hits live where the
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
printed. Proven on a throwaway `setsid` tree: three members, zero survivors.

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
| 8 | `LOD_CROSSFADE` look and skirt cliffs | dither-free blend; shorter darkened skirts |
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
   pattern** — a process NAME is not an identity in a shared container.
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
    the ladder-red row proves the hardening holds. (A PACE.)
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
    say "unpublished" rather than fall back to the total. (E CERT; this is the
    general form of lesson 38, and it replaces three separate incident notes.)
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
47. **The constants an instrument DECLARES must be the ones it measured, and a
    declared cost may overstate but never understate.** The depth probe's
    precision ladder is asserted against measured worst-case error — float32
    0.000002 %, float16 0.0754 %, both far inside the 1 % bound — rather than
    quoted from a datasheet. (C LIGHT.)

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
| `FLASH_GUARD` | **satellite buildings proven (Powell 8.28 %, Manhattan worst chunk 13.98 %); skyline = INSURANCE, its population is 0 by construction; toy site NOT EXERCISED** by any browser row. **The GREEN leg is still unmeasured** — voided twice, in 2a by the pacing rule and in 2b by a two-page CPU split — and a standalone re-take decides it (§4.2). 15,984 → 0 in node; normals bit-identical; zero keys, zero bundle bytes, zero draws. Pass-2 go/no-go is the gate's leg (3) | **ON**, merged `7face8f` |
| `BEND_LEAD` | `padON ≥ worstDrop` on 7/7 rings; Owens 0 by construction | **ON**, merged `7face8f` |
| `CHUNK_FADE` | pops 92 → 2, both attributable; `maxDying` 4 is the only draw term. **ON per the ship table; green leg pending the standalone RE-TAKE**, whose expected reading is on the record in advance — births SOFT, deaths spanning ≥ 3 partial samples, hard deaths ≤ `fadeBudgetMiss` (§4.2) — and which runs with B's frame-count ramp floor (`45e2cde`, `minFrames` **4**) in: venue pops **0** against 92 flag-off, the 60 Hz ramp length unmoved, and a mid-ramp 500 ms hitch no longer completing a ramp | **ON**, merged `7face8f` |
| `HEAL_IN_PLACE` | heals 16 (0 in place) → 21 (all in place); evictions 40 → 24. **ON per the ship table; green leg pending the re-take** with `CHUNK_FADE` (§4.2), now against an EXHAUSTIVE outcome ledger — `healsInPlace`, `healsNoop`, `healsQueueFull`, `healsAborted`, `healsNoRecord`, `healsCoalesced`, `redraping` — asserted as an EQUALITY, so a residual hole is attributable to `healsQueueFull` or it is a defect | **ON**, merged `7face8f` |
| `GROUND_VIS` | 384.0 → 4.000 m worst frame, converging in 95; the flight model keeps RAW | **ON**, merged `7face8f` |
| `LINEAR_HAZE` | seam 0.000 by construction, from 9.3 / 19.9 / 76.3 / 99.2 / 89.4 per 255 | **ON**, merged `a60bf17` |
| `ONE_SUN` — `hill.dayK` **1.0**, `monumentsLambert` true; **the key-elevation contract is OPEN** (pass 2b: azimuth key === hill at Δ 0, but elevation constant ≈ 23° at every tier and hour, §4.2) | key az −56° at every hour → the sun at every tier; `live:false` closed. **dayK 1.0 makes the daytime demotion built-and-off BY CONSTRUCTION** (the weight is exactly 1, so `uHillStrength * uHillElev` is bit-identical to R21 and `verify-sat-depth`'s margin does not move); 0.65 would have spent up to 35 % of a frozen margin on an unmeasured argument | **ON** (`hill.dayK` 1.0, `monumentsLambert` true), merged `a60bf17` |
| `POST_ORDER` (`smaaPreset 'high'`, dither) | 228/228 → 254/255 with midtones unmoved; merged pass count FALLS (sat 4→3, toy 6→5) | **ON** (`smaaPreset 'high'`, dither), merged `a60bf17` |
| `DEPTH_FIX` | node proof (`depth-roundtrip-proof`: RED flat **0.176–0.177** CoC, viewZ **−2.50 m**; GREEN error 0.000000; the mirror proven by EXTRACTING three's own formula, 8,004 comparisons bit-identical) + `verify-depth-offset` **7/7**; the browser round-trip runs in pass 2 against C's probe hook `e59445d` | **ON**, merged `a60bf17` |
| `SHADOW_CALM` (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0) | shader edits and snap arithmetic **proven node-side (32/33 gates)**; mount/arm logic structural; **pixels, draw counts and whether the catcher actually receives a shadow unmeasured — user's machine.** Note for any program census: it changes the compiled TEXT of every shadow receiver with NO cache key, so a key census is blind by construction and a source-hash census sees every receiver move | **ON** (`biasSignFix`, `kernel 'world'`, `texelSnap`, `satCadence` 0), merged `a60bf17` |
| `TERRAIN_LIGHT` — `fragmentHill`, `microFwidth`; `workerNormals` **false** | the tile half ships; the worker half is node-proven (3.34° → 0.26°) with zero pixels behind it, and ON would make `verify-skirt-worker`'s identity leg RED by design | **ON** — `fragmentHill` and `microFwidth` true, **`workerNormals` false**, merged `a60bf17` |
| `CLOUD_LIT` + `LAMBERT_ENV` (0.15) | same ONE draw; uniform-only for Lambert; the cloud variant's warm-set exception has a measurement condition attached | **ON**, merged `a60bf17` **ON** (`reflectivity` 0.15), merged `a60bf17` |
| `TERRA_PACE` {`timerFix`, `mergeHysteresis`, `keepResident`, `skirtFast`, `walkWhileSaturated`, `bboxCache`} | 22/17/178 → 0/0/0; timer 10/12 → 4/12; the saturated walk strictly conservative; skirt output element-identical; **live-arm fixture evidence now in** — merges 1 → 0, refetchParent 1 → 0, Owens **161 → 185 ≤ 261**, Powell **161 → 183 ≤ 375**, draws rising because `keepResident` keeps more tiles drawn. `verify-terra-live` (6)'s 1 → 17 repeat fetches are **ATTRIBUTED to the harness's ~51°/frame wall-clock yaw at 1 fps, not to the feature** — the LRU had nothing to evict (peak 30–36 % of a 140 MB cap) and merges were 0; re-measured in pass 2 at 0.85°/frame over a full 360° | **ON** — `timerFix`, `mergeHysteresis`, `keepResident`, `skirtFast`, `walkWhileSaturated`, `bboxCache` all true; `skirtWorker` and `bendSphere` false, merged `5b13e35` |
| `LADDER_FIX` (incl. `nativeRefresh`) + `STEP_SAFE` | RED 6/13; two render-scale rungs before the first tier rung; DPR applied inside the drawing frame — **and pass 2b closed the composer lag (`composer.setSize` outside a rAF 6/6 → 0/6) and the buffer mismatch (22 of 46 → 0 of 43)**. **OPEN: a DPR double-apply**, exactly half of every canvas/renderer write landing outside the frame, i.e. a second writer alongside the rig; attribution with A (§4.2). **`nativeRefresh` carries no measurement** — a no-op at 60 Hz, a target change at 120/144 (§6 item 4) | **ON** (incl. `nativeRefresh`), merged `5b13e35` **ON**, merged `5b13e35` |
| `HUD_SYNC` + `REBASE_CALM` | labels drawn with this frame's matrices; 704 m quantised anchor | **ON**, merged `5b13e35` **ON** (`quantM` 704), merged `5b13e35` |
| `FINALIZE_PACE` | one shared brake. **Its first rule shipped as a LEVEL detector and starved every finalize below ~41 fps** — found at the close, §1 and §4.2 — and now refuses only on a genuine spike (> 24 ms AND > `spikeK` **2** × an EMA of the preceding frames) with a hard `maxRefuseFrames` **3** cap; `verify-finalize-pace` 14 → 17 gates, and the single-hitch gate passes both ways, so the behaviour the rule was written for did not move | **ON**, merged `5b13e35`, fix `abd127c` merged `3d388ec` |
| `FRAME_STATS` | the round's only frame-pace instrument; flag-off byte-identical, and **flag-gated with no runtime pin**, so `verify-frame-pace` runs for the first time in pass 2 (flip `6c26fe9`) | **ON**, merged `19d90b0` |
| `AERIAL_LAW.nightRamp` (A8) — **true while `AERIAL_LAW.enabled` is false** | FlyScene gates A8 on `nightRamp` alone and applies it to the LEGACY post strength on the `lawOn === false` branch; noon multiplier EXACTLY 1 keeps `verify-aerial`'s 0.55 exact, deep night EXACTLY 0; uniform-only | **ON with `AERIAL_LAW.enabled` false**, merged `91141fe` |

### Conditional

| Flag | Condition |
|---|---|
| `LOD_CROSSFADE` | **decided by pass 2's pinned ON leg** — pass 1 proved the gate as written has no ON leg at all (§4.2). D struck its own earlier "`hardSwaps` flat at 20": **the 20 came from a different pose, and the counter PARTITIONS events rather than counting them.** The criteria the leg asserts, and the only ones this record cites: `refines + merges === hardSwaps + faded` on BOTH legs · `refines + merges` FLAT OFF→ON · `hardSwaps` DROPS toward 0 while `faded` RISES on the ON leg · **the leak SIGNATURE rather than a number** — from `finish()` releasing every owned texture before deleting from `_active`, **LEAK ⟺ `active === 0` AND `retained > 0`** — asserted on the snapshot taken at the instant the drain condition held AND on a second read N frames later, with `refines + merges` attributing arrivals (INFO) against stuck (FAIL), plus the free invariant `retained ≤ active ≤ 4 × retained` while only refines are in flight · `0 < peakActive ≤ 32` (a session high-water mark, boot included) · `skip.concurrency > 0` acceptable ONLY with `peakActive === 32` · `skip.shape`, `skip.noParentMap`, `skip.unpatched` all **0** · Owens draws/tris EQUAL to the OFF leg's fixture numbers (**174 / 166,659**), not merely ≤ 261 · zero page errors · **NOT CALIBRATED** (not red) when `refines + merges` in the measured window is 0. The pass-2 leg polls `active === 0` (90-rendered-frame cap, count printed) and `skip.warp` unchanged across two reads, rather than trusting a frame-count settle (D `8d1599a`/`51a95bc`). **And a green there proves the REFINE path only** — A's yaw sweep saw merges 1 and D's ladder merges 0 — so if it flips, the recommendation reads, in D's words, *"the refine path is measured, the merge path is inferred from shared machinery (same uniform, same clip-UV transform, same clock, run backwards; merge direction gated structurally by `verify-lod-fade.mjs`), and structural is not measured"*. Otherwise it holds at OFF with its RED on the record. <!-- FLIP:LOD_CROSSFADE PENDING --> |
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

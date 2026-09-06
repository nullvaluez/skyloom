# FLY ROUND 24 — "SMOOTH WORLD" (RECORD)

Orchestrator: Fable. Executors: five agents — **A PACE** / **B WORLD** /
**C LIGHT** / **D ATMOS** / **E CERT** — in worktrees `r24/a..e` off `6116fc5`
(the R21 "Steady State" tree `3592656` + the W0 scaffolding), and a sixth agent
(**F SCRIBE**) for this record. Plan:
[FLY_ROUND24_PLAN.md](FLY_ROUND24_PLAN.md). Kickoff:
[FLY_ROUND24_KICKOFF.md](FLY_ROUND24_KICKOFF.md). Evidence ledger:
[`scripts/r24-recon.md`](scripts/r24-recon.md). Per-agent ledgers:
`scripts/r24-{a-pace,b-world,c-light,d-atmos,e-cert}.md`. Certification
ledger: [`scripts/r24-close-sweep.md`](scripts/r24-close-sweep.md). User
diagnosis pack: [`scripts/r24-user-diag.md`](scripts/r24-user-diag.md).
Integration branch: `claude/skyloom-r24-orchestration-6753n2` (the plan's
"main" for this round; fast-forwarding `main` is the user's call).

---

## §0 Why this round exists, and what the user said

After R21 the user reported, on "the last few newest builds":

> **"The last few newest builds had symptoms of really bad screen tearing and
> glitching, mainly buildings appearing and disappearing, and terrain tiles
> swapping for other ones."** (2026-09-06)

The build(s) were **not named** — Rounds 22, 22.1 and 23 are archived, not
merged (`archive/r22-r23-main-44ec502`), so the report may describe a tree this
one does not contain. Every mechanism named in §1 was therefore shown to exist
**ON THIS TREE at file:line** before it was fixed, and the archived rounds are
cited only as diagnoses.

**The second open question was never answered.** Plan §0 asked for machine
facts — GPU, resolution, DPR, refresh rate, browser, windowed vs fullscreen —
and for which symptoms were seen on which build. No reply arrived during the
round. The plan's defaults were used throughout: **a DPR-1 60 Hz desktop, in
Chrome, satellite style**. Two consequences are load-bearing and are stated
here rather than buried: the DPR-1 assumption is what makes A's ladder finding
(§1, A4/FL-13) the first governor step on this user's display, and the
satellite assumption is what scoped C's and D's work away from Neon.

**Venue.** The cloud container 403-blocks Esri, OpenFreeMap, open-meteo and
adsb.lol; its WebGL is ANGLE/SwiftShader (~1–3 fps at the game's load, but
bit-stable at a parked pose); Google Chrome is absent and 57 harnesses pin
`channel:'chrome'`; four cores were shared by five agents plus the
orchestrator (load average 12–19 during browser work). E's **offline world
fixture** made structural, count, census, determinism and fixed-pose-pixel
gates runnable here. **Every fps / ms / stall / tearing number in this round
comes from the user's machine or is marked "could not measure here".**

**What the user's machine has confirmed this round: NOTHING.** The diagnosis
pack was sent early (plan §1, `scripts/r24-user-diag.md`), and Part A on the
current build — the round's real RED — has not come back. There is therefore
no "before", and no performance verdict of any kind. §4 and §6 say the same
thing in their own terms; this is the single most important caveat on the
whole record.

---

## §1 Headline — the symptoms, traced to closed defects (measured)

### Symptom A — "buildings appearing and disappearing"

| Defect | What it was | Closed by | Measurement |
|---|---|---|---|
| **P1-at-speed** (recon WB-6) | R21's bend-margin false-cull census ran on the ORBIT phase at speed 0, where the lookahead lead is 0. The pad is short on ALL SEVEN rings the moment the aircraft moves: sat-buildings 54 · sat-roads 558 · sat-skyline 747 · toy full 241 · mid 1,205 · far 3,405 · ultra 31,412 m. The three pooled instanced layers (veg, parcel homes, **and SatTintLayer, unnamed by the recon**) pad with a 2 s-stale `maxD` and cull AS ONE OBJECT — a whole forest / suburb / landcover sheet vanishing at once | B `BEND_LEAD` | `r24-b-bend-proof.mjs`: `padON ≥ worstDrop` on 7/7 rings, `padON ≥ padOFF` everywhere (the pad can only ever KEEP geometry); `poolLeadM` 1500 m = 2 s cadence × 750 m/s; Owens 0 by construction (its chunks are `empty` and issue no mesh) |
| **Birth / evict / heal cut** (WB-2, WB-8) | every chunk appears and vanishes in ONE frame; a heal is delete-and-refetch (a hole for the whole rebuild latency, up to `healCap` 3× per key) | B `CHUNK_FADE` + `HEAL_IN_PLACE` | `r24-b-engine-proof.js` (the REAL `SatBuildingEngine` + the REAL worker, headless, 90 s / 2,700 frames at 120 m/s, DEM refining twice): single-frame pops **92 → 2** (both = `fadeBudgetMiss`, i.e. attributable), ramp steps **0 → 600**, heals **16 (0 in place) → 21 (all in place)**, evictions **40 → 24** |
| **The one-frame pale splat** (A1/A1b) | `@mapbox/vector-tile` closes every ring with a clone of `ring[0]`; the wall extruders walk the ring as OPEN ⇒ two exactly-degenerate `DoubleSide` triangles per ring and per hole; **14.19 % of a dense chunk's resident triangles** (per builder: sat-buildings 14.22 %, toy full 14.84 %, suburb toy 16.67 %; **skyline CLEAN at 0** — `simplifyRing` had eaten both the clone AND the real first corner) | B `FLASH_GUARD` (engine-side zero-area filter at drape finalize, `minArea2` 0, same array by reference when clean) | census 15,984 resident degenerate → **0**; `computeVertexNormals` **bit-identical** across the filter; kept/column counts identical |
| **DEM refine sweeps every AGL-keyed fade** (T8/A6) | raw `groundElev` steps **384.0 m in ONE frame** when a finer tile lands, and seven visual consumers step with it | B `GROUND_VIS` | `r24-b-groundvis-proof.mjs`: worst per-frame delta **4.000 m**, converges in **95 frames**, a warp snaps 364 m by design; flight model, crash floor, cameras and every placement sampler keep RAW |
| **First perf step is a TIER step on DPR-1 displays** (A4/FL-13) | `buildLadder`'s DPR loop runs ZERO times at `devicePixelRatio` 1, so the ladder is literally `[1/high, 1/medium, 1/low]` — rung 1 unmounts the building/precip layers and rebuilds the composer. One bad second while a city streams is enough | A `LADDER_FIX` (+ `STEP_SAFE`) | `verify-ladder-fix` 13 gates; `FLY_LADDER_RED=1` fails **6/13** on the flag-off tree. Ladder → `[1/high, 0.875/high, 0.75/high, 1/medium, 1/low]`; a 144 Hz display targets **144**, not 60; a 53.4 fps-mean session with 10 % long frames steps **render-scale first** where the EMA never steps at all; clean-60 control never steps |
| **Shadow-map re-rasterization** (L5/FL-12) | a 2048² ortho following the plane at sub-texel steps (0.78 m/texel toy, 1.46 m satellite), with the PCF kernel rotated by a **screen-space** hash ⇒ every building silhouette re-rasterizes each frame — a second, independent root of "buildings flickering" | C `SHADOW_CALM` | `shadow-kernel.js`: PCF bias `#ifdef` (three r185 has it in VSM and BASIC and not in PCF — the branch this app runs), world-locked Vogel rotation, texel-snapped light in LIGHT space, `normalBias` 4→1 (toy) / 2→1 (sat). Instrument `__flyStats.shadow` reports what was PATCHED, never what the flag asked for. **No `verify-shadow-calm` exists** — this ships on node gates + fixture pixels only (§8) |

Two mechanisms were examined and deliberately NOT touched (B ledger §8, rows
10–11): the skyline group `visible` flip and its AGL evict/re-arm hysteresis
are **pixel-neutral BY CONSTRUCTION** — a group parks only when its farthest
corner is inside `uSkyHole.x`, at which point every fragment is already
discarded, and both hysteresis ends (10,000 / 9,200 m) sit above
`SAT_SKYLINE.fade.endM` 9,000. R21's inline reading of that as "a 4.9 km block
of city blinking" is unsupported by the shader; a fixture pixel A/B at
Manhattan across a park/unpark is the open check.

### Symptom B — "terrain tiles swapping for other ones"

| Defect | What it was | Closed by | Measurement |
|---|---|---|---|
| **Merge on frustum exit** (T1) | `Tile._getDistRatio()` returns `inFrustum ? t*0.8 : t*5` — the ratio jumps **×6.25** the instant a tile leaves the frustum; `_LODEvaluate` uses the same threshold for refine and merge with **zero hysteresis**; `_removeSubTiles` then downloads a fresh parent (a different Esri capture at a coarser zoom = "another tile") and disposes the children | A `TERRA_PACE.keepResident` + `mergeHysteresis` + `timerFix` | `verify-terra-residency.mjs` (the REAL vendored `Tile`/`TileMap` in node, 21 gates): **a 720° yaw sweep at a parked position — merges 22 → 0, tiles REPLACED WHILE ON SCREEN 17 → 0, parent refetches 178 → 0**. Attribution one switch at a time: `keepResident` is the closing switch, hysteresis alone moves nothing (the ×5 already carries the ratio past `threshold × 1.6`). Vertical bob (nothing leaves the frustum): merges 21 → 11, flips 27 → 16, refetches 89 → 63. Serpentine: replaced-on-screen **33 → 4**, refetches **176 → 28 (−84 %)**, total requests **+0.7 %** (spent on deeper coverage). Controls: a fixed-heading approach and a parked jitter are **identical** in both arms (59/59 refines, 232/232 requests, 172/172 loaded). Byte LRU on a safe path: peak resident **126 → 95 MB**, 351 → 270 tiles |
| **Quadtree walk every frame + wholesale freeze** (T3) | `Timer.reset` never zeroes `_elapsed`, so the 50 ms guard is dead after 50 ms of uptime; and the WHOLE tree update is skipped while `downloadingThreads + 4 >= maxThreads` — **E measured the consequence live on the fixture: the tree stalled at maxZ 6, `groundElev` answered 193 m where Powell's true elevation is 276 m, every building drape sample saw `tileZ 6 < demZ 12`, and the drape restarted forever** | A `timerFix` + `walkWhileSaturated` + `bboxCache` | timer: **10/12 → 4/12** whole-tree updates (the intended 20 Hz). With the loader held saturated: nodes visited **444 → 4,248** with refines **19 → 19** and requests **72 → 72** — strictly conservative, it can only evaluate more. Honest cost: visits per walk 36 → 74 (`keepResident`) → **233** (with `walkWhileSaturated`); traversal per unit time 4,230 → 3,431 (trio) → 10,891 (bounded at 4× by the gate). `bboxCache`: heap over 400 walks **1,398 → 771 KB** |
| **Hard LOD pop** (T4 b/c) | a refine/merge is an atomic parent↔children swap in ONE synchronous block — no frame draws both, no frame draws neither — and above `demMaxZoom` the texture AND the relief snap together (`7000·(1−z/17)³`: z13 ≈ 91 m, z15 ≈ 11 m) | D `LOD_CROSSFADE` (parent-texture clip-UV blend on refine AND merge, ~0 extra draws) | **RED measured** on the fixture (Powell altitude ladder 4000→1600→800→380→1600→4000 m, 640×360, A's pacing ON): **hardSwaps 20 / faded 0**, `skip.disabled 20` — every swap un-faded because the flag is off, not because a guard fired; A's counter reads refine 16 / replacedOnScreen 0 / **merges 0** (that zero is `keepResident` working, which is why D's value is on REFINES). **The ON leg was never obtained** — see §5 |
| **Skirt built on the main thread** (T2/A2) | `getBoundaryEdges` allocates 3·T two-element arrays per DEM tile and sorts them with a boxed comparator (~98 k arrays and a ~1.6 M-comparison sort at 129²), on the MAIN THREAD, per tile; four children land in one microtask. The archived R22.1 profiler put it at 37 % + its comparator 30 % = **67 % of every stalled millisecond** | A `skirtFast` (O(E) generation-stamped scan) ; `skirtWorker` BUILT-OFF | `verify-skirt-fast` **12/12**, element-by-element identical through the PUBLIC `TileGeometry.setAttributes` on 13 cases incl. six real Martini tiles up to **116,079 indices**, with four non-manifold cases BAILING to the verbatim upstream body; isolated algorithm timing **7.1× / 6.5×** (this container's CPU, not a frame time); table reuse proven (heap 16.5 → 9.2 MB over 25 tiles). `verify-skirt-worker` **8/8** node-identical (6,912 / 26,112 / 101,376 indices) — OFF because the production LERC path is 403-blocked here and the fixture's terrain-rgb loader builds on the main thread |

### Symptom C — "screen tearing" (what this venue can and cannot say)

A tear line is a compositor/vsync property: no screenshot and no JS timer can
see it, and a software recorder composites it away. What CAN be asserted here,
and is:

- the DPR step reallocates the drawing buffer OUTSIDE any rAF and the composer
  resizes a frame late (A3/FL-05 → A `STEP_SAFE`, E `verify-step-clean`);
- the HUD `LabelCanvas` draws with the PREVIOUS frame's camera matrices — rAF
  callbacks run in registration order and LabelCanvas always registers first,
  so at 60 fps and ~60°/s of yaw that is ~1°, about **30 px on a 1920-wide
  canvas** (FL-01 → A `HUD_SYNC`);
- there is no fixed timestep, so a long frame slows the world down while
  traffic dead-reckoning keeps wall-clock time (FL-04 → A `FRAME_STEP`, sim
  half only);
- sub-pixel procedural grain and window grids alias under SMAA-only AA
  (T13/L9 → C `microFwidth` + the facade fwidth fade).

The tear LINE itself needs the user's machine — a phone camera, per
`scripts/r24-user-diag.md`.

### Findings the round did not go looking for (all measured, all closed)

- **three r185 handles the reversed depth buffer in two of its three shadow
  branches and not in PCF** — the one this app runs: `shadowCoord.z += bias`
  unconditional ⇒ every receiver biased toward SHADOWED by **~1.6 m** of world
  depth, and `normalBias 4` (5.1 texels at 0.78 m/texel) was paying to hide a
  sign error. (C, `lib/fly/shadow-kernel.js`.)
- **`HueSaturationEffect` ends `min(color, 1.0)` and ran BEFORE the tone map**
  since R13: every fragment above 1.0 linear hard-clipped to white before ACES
  ever saw it. A 3.2-linear lit window and a 12.0-linear runway light both
  landed on 8-bit **228**; after the reorder, **254 / 255**, with midtones
  unmoved (0.030 → 26, 0.180 → 127 both ways). The merged EffectPass count
  **falls** (satellite 4→3, toy 6→5). (C, `POST_ORDER`.)
- **postprocessing + three r185 double-convert reversed depth**: every
  reconstructed viewZ is ≈ −2.5 m = −`cameraNear` (measured −2.632 at 50 m,
  −2.509 at 700 m, −2.501 at 8 km, −2.500 at 300 km), so the toy tilt-shift CoC
  was **flat 0.1762–0.1773 from 5 m to 300 km** — a uniform 18 % blur, i.e.
  "Neon reads globally soft". The fix is one token; GREEN error is 0.000000 m.
  AerialPerspective's sky early-out has meanwhile **never fired** and was saved
  only by its height term. (C, `DEPTH_FIX`.)
- **The 14 → 16 km haze "handoff" is a 2 km PLATEAU, not a seam** (two
  zero-slope samples; the depth cue switches off and restarts at 1/12 of its
  previous slope); the 16–55 km band has **no height term at all**; the two
  evaluators measure different rays (3-D from the camera vs XZ from the bend
  centre — **+14.7 %** at cruise); and medium/low have **no distance cue
  whatsoever inside 16 km**. (D, `AERIAL_LAW`, proven by a GLSL-subset
  interpreter against the JS mirror at 4,160 points, 0 relative error.)
- **On medium/low the key light NEVER MOVED** — azimuth **−56° at every hour of
  every day** (the position write lived inside the high-tier shadow branch),
  with key↔hillshade **37.1° at noon, 119.4° at dusk, 109.6° at night**. And
  **measured live on the fixture at HIGH tier, Sierra pose: key ↔ hill 10.50°
  apart with `live:false`** — the branch that writes the key position **never
  executed on the harness fleet, at any tier**, because `scripts/_boot.js` pins
  `__flySatShadowOverride = 0` and the write lived inside that shadow gate.
  Every R19–R21 satellite pixel gate certified a world whose key light was a
  constant. (C, `ONE_SUN`; recon HARN-GAP-5, with a number.)
- **The horizon seam cannot match by construction**: haze/fade targets were
  authored as sRGB and mixed as linear once the composer took the render.
  Closed-form seam delta per 255: noon **9.3** / golden **19.9** / night
  **76.3** / twilight **99.2** / Neon rim **89.4** → **0.000**, with zero
  constants moved (any gain ≠ 1 re-opens the seam, so the budgeted re-tune was
  refused). (C, `LINEAR_HAZE`.)
- **`RING_DEDUPE` is not a pure removal**: restoring `ring[0]` changes corner
  counts, and corner counts drive roof-form dispatch — Manhattan sat verts
  −15.6 %, skyline **+31.6 %** (the A1b defect closing), Powell toy bundle
  **+17.4 %**, degenerate → 0 in every leg, Owens `empty`/`zero` in both. It
  therefore ships BUILT-OFF pending a roof re-certification: correct and
  certified are different claims. (B.)
- **The venue's own trap**: at 1–3 fps the per-FRAME `drapeBudgetMs` never
  finishes a content chunk — six minutes at Powell, `ready 0` — so every
  satellite content gate would have certified an empty city GREEN. (E,
  `lib/fly/harness-budget.js`; `budgetK()` is exactly 1 in production, clamped
  [1,500] so a harness can only ever be MORE generous.)
- **`verify-depth-offset.mjs` caught `prewarm.js:280`** warming the tint twin
  with the pre-P8 raw `polygonOffsetUnits` — on the day the one-implementation
  rule was written. RED 6/7 on `6116fc5`, GREEN 7/7, 185 files scanned. (C.)

---

## §2 Waves

- **W0** (`6116fc5`, orchestrator): `WORKER_PROTOCOL 17→18` lockstep at all six
  pin sites; **26 pre-seeded `enabled:false` owner blocks** at the end of
  `lib/fly/fly-constants.js`; the recon ledger; the R21 records imported
  verbatim; archive refs pushed. **Zero constants conflicts across five
  agents** — the R18 idiom holding a fourth round.
- **W1a, merged first** (`aee2a86`): A's verbatim three-tile 0.12.1 vendor
  (`b64457b`) plus the CRLF restore (`4bedab1`). C and D patched the vendored
  bundle only after this landed; patch rows are A 0–4 + 20–25, D 5–7, C 8–19.
- **W1** (five agents in parallel, each in its own worktree, port and `.next`):
  A `r24/a` → `f739cb3` (13 commits) · B `r24/b` → `06b8f1d` (16 commits) ·
  C `r24/c` → `871f9be` · D `r24/d` → `d30fc4c` → `6dc8817` · E `r24/e` →
  `a071ee9` → `c7d538c`. Every feature behind its own block, every block
  `enabled:false` in-branch.
- **W2 (integration, E → A → B → C → D, one reviewed merge each)**:
  E `ea772b4` (shim, fixture, `FRAME_STATS`, diag pack) · E `4ab22f1` (fixture
  hardening, seven new gates, smoke, close sweep) · E `0c5a72f` (smoke path
  fix, `budgetK()`) · E `cf3ee49` (`force(dir)` sign fix, `_settle.js`,
  offline `verify-seam` node leg, flicker quiescence) · E `8ddbff8` (R21
  artifact restore, fs-level fixture write redirect, `verify-artifact-hygiene`)
  · E `f7cb9b6` (docs) · **A `720e3c1`** · **B `cd6b759`** · **C `bd65e60`**
  (+ audit `66a2f0c`) · **D `fa380fd`** (+ audit `990c7b5`, + `190d2d6`
  scripts-only) · E `bf319ca`. Every merge was accepted on a dev-server
  `GET / 200` plus the full node-gate set. Hygiene commit `453119e` restored
  `scripts/r21-e-red-seam.json`.
- **W3 (certification)** — and the round's worst hour. All five merged, 17/17
  node gates green, the certification run launched detached… and **the
  integrated tree could not boot**: a control probe on the merged tree reported
  `ReferenceError: ATMO_GLSL_DECL is not defined at module evaluation`, body
  "Something went wrong", 0 canvas, `__flyBoot` undefined. `eslint --rule
  no-undef` over the 50-file R24 delta found **three independent unimported
  symbols on three different branches** (§5). They were fixed as node-only
  merges — **A `6aa2030`** (`pinned` in CloudField), **C `961135c`**
  (`offsetUnits` in FlyScene, plus the F4 monument gates and F11 registry
  rows), **D `3f379ff`** (the atmo-law + `AERIAL_LAW` imports), **B `8b68ae5`**
  (the reviewed `ENV_UNIFORM` stand-in-scene warm) — after which `no-undef`
  over the delta reads **0** and `SMOKE_NODE_ONLY=1` reads **15/15**. The
  browser certification rows are being re-taken from that tree; §4 carries a
  `CERT:… PENDING` marker for each.

---

## §3 Per-agent shipped

Every block ships `enabled:false` on the branches and on `8b68ae5`; the flips
are the close commit's (§8).

### A PACE (r24/a, W1 head `f739cb3`, 13 commits; W3 `8b91bc5`) — ledger [`scripts/r24-a-pace.md`](scripts/r24-a-pace.md)

| flag / item | sha | what | verdict at close |
|---|---|---|---|
| vendor three-tile 0.12.1 | `b64457b`, `4bedab1` | byte-identical `index.js` (sha256 both sides), plugin differs on **exactly one line** (its own import), `VENDOR.md` patch ledger, git-anchored integrity gate, MIT/GuoJF credit in `VENDOR.md` + `README.md` (NOT `assets.js` — that manifest's count is arithmetic inside `verify-fleet`/`verify-hangar`) | merged W1a |
| `TERRA_PACE.timerFix` / `mergeHysteresis` / `keepResident` + `lib/fly/tile-residency.js` | `407691b` | the tile-swap defect at the root; wires the long-dead `TILES.lruBudgetBytes`; out-of-frustum-only eviction (an in-frustum eviction is churn, not a budget); `__flyTerra` dev handle with an owner-checked disposer | ON (live draw evidence still owed — `verify-terra-live` never completed here) |
| `TERRA_PACE.skirtFast` | `5247d06` | O(E) generation-stamped boundary scan with an explicit bail contract | ON |
| `TERRA_PACE.skirtWorker` | `3158584` | skirt built in the DEM worker, transferables out; a **readable** worker source + `scripts/build-tile-worker.mjs` (`--check` wired into the vendor gate) so no minified blob is hand-edited | BUILT-OFF — needs ONE real-hardware run |
| `TERRA_PACE.walkWhileSaturated` + `bboxCache` | `3158584` | the T3 freeze fixed conservatively (keep walking, start no load); per-visit `Box3`/`Vector3` allocation gone | ON |
| `TERRA_PACE.bendSphere` (T14) | `3158584` | tile sphere inflation for resident-culled tiles (the unbent sphere is ~30 % short at 30 km, ~120 % at the fade end) | BUILT-OFF — turning it on SUBMITS tiles that are culled today, i.e. a draw-count change against frozen ceilings; needs ONE real-hardware run |
| `LADDER_FIX` + `STEP_SAFE` | `36792a0` | five rungs with two render-scale steps first, native-refresh target, long-frame fraction term, DPR applied inside the drawing frame (`lib/fly/step-safe.js` + `StepSafeRig`), plus the FL-05 in-frame buffer check in the composer | ON (§6 taste checkpoint) |
| `HUD_SYNC` + FL-06 + `REBASE_CALM` | `2fadaa6` | labels drawn from `addAfterEffect` with THIS frame's matrices; CloudField priority −10; unconditional pre-render `camera.updateMatrixWorld()`; dead `rebaseEpoch` store bump removed, matrix traversal narrowed to the tile subtree, anchor quantised to **704 m** = `HILLSHADE.micro.scaleM × 128` so the micro-grain no longer re-phases every 10 km | ON |
| `FINALIZE_PACE` + veg cap + toy typed index | `f8c6a4a` | one shared per-frame brake for all four engines (the first chunk is not free; the budget counts from frame start), `SatVegEngine._commitPending` capped, the toy merged index built as a `Uint32Array` | ON — `ready` counts provably do not move |
| `FRAME_STEP` (sim half) | `ed773b8` | 120 Hz accumulator, ≤4 substeps, `renderPos`/`renderAtt`/`renderAlpha` as NEW fields; `flight.pos` stays the sim truth | **OFF — "not landed" row**: the consumer opt-in (PlayerPlane, chase cam, Contrail, PlayerGroundShadow) cannot be certified in this venue |
| `markPhase` attribution | `70b9f42` | six call sites incl. two vendored ones **by inversion** (`R24_SWITCHES.onPhase`, so the bundle never imports app code) | ON with `FRAME_STATS` |

Node gates: vendor **19** · terra-residency **21** · skirt-fast **12** ·
skirt-worker **8** · finalize-pace **11** · frame-step **10**. Browser:
ladder-fix **13** (toy boot, `FLY_LADDER_RED=1` = 6/13 fail), terra-live **9**
(**never completed here** — two runs died on a fixture 502 and a load-14
timeout; the harness is committed with separable arms).

### B WORLD (r24/b, W1 head `06b8f1d`, 16 commits; W3 `f361543`) — ledger [`scripts/r24-b-world.md`](scripts/r24-b-world.md)

| flag | sha | what | verdict at close |
|---|---|---|---|
| `FLASH_GUARD` | `4f93436`, `bd2776a` | zero-area filter at drape finalize, 4 sites (sat-buildings, skyline, toy buildings, toy water); land and sat-water sheets deliberately excluded (no wall extruder there) | ON — zero bundle bytes, zero keys, zero draws, no frozen-gate exposure |
| `BEND_LEAD` | `8a2769b` | bend pad covers the lookahead lead in 4 engines + 3 pooled layers | ON |
| `CHUNK_FADE` + `HEAL_IN_PLACE` | `6da62a4` | POOLED fade twins (same constructor params, same `customProgramCacheKey` ⇒ three returns the SAME program) so a per-mesh ramp exists at all; heal re-drapes the resident position buffer with a ranged upload, patching collision columns and porch lights with it; parcel `growK` eased in place over 0.6 s | ON — `maxDying` 4 is the only term that adds draws, and **Owens takes exactly 0 by construction** |
| `GROUND_VIS` | `8d577db` | slew-limited `runtime.groundElevVis`; a 16-row damped/raw seam table (ledger §8) | ON |
| `ENV_UNIFORM` | `42e6f66`, `f361543` | constant PMREM height (day endpoint bypasses the resize ⇒ noon bit-identical), both shadow states warmed, late-HDRI idle re-queue | **OFF** — see §5 and §14 of B's ledger |
| `RING_DEDUPE` | `720c5d2`, `995f0da`, `8f9861e` | source-side ring dedupe + the skyline's restored `ring[0]` + a sliver guard | BUILT-OFF (roof re-certification owed) |

Node proofs (outside the smoke): `r24-b-engine-proof.js`,
`r24-b-worker-proof.js`, `r24-b-bend-proof.mjs`, `r24-b-groundvis-proof.mjs`,
`r24-b-fixture.js`, and `r24-b-prewarm-proof.mjs` (**9/9**, `--red` **5/9**
against the defective `06b8f1d`, self-calibrating against base `6116fc5`).
B's ledger §8 is the round's most useful single table: **16 mechanisms that can
remove a building from the screen**, each with file:line, single-frame or not,
the flag that closes it, and the measured before/after.

### C LIGHT (r24/c, W1 head `871f9be`; W3 `ad01d32`) — ledger [`scripts/r24-c-light.md`](scripts/r24-c-light.md)

| flag | sha | what | verdict at close |
|---|---|---|---|
| `LINEAR_HAZE` | `f15f044` | five haze/fade setters + `uHazeColor` decoded to linear; `getRimColor()` reads an authored-sRGB stash so SatVegLayer (which already decoded correctly) cannot double-decode | ON — seam 0.000 by construction |
| `ONE_SUN` | `967524a`, `08e6518` | key follows `runtime.sun` at EVERY tier; TRUE elevation (floored only while the shadow camera casts); anti-solar moon blended over [0°, −8°]; hillshade weight on its own `uHillElev`; satellite monuments Toon → Lambert in BOTH representations | ON at **`hill.dayK` 1.0** — 0.65 remains a PROPOSAL (§6) |
| `POST_ORDER` + `DEPTH_FIX` | `4146eb7` | ACES before the grade, SMAA last with a per-pixel hash dither (`lib/fly/post-policy.js`, from both assemblers so the warm compiles the same program), CoC un-double-converted, the dead sky early-out fixed | ON — grade re-tune measured (0.037 vs 0.05) and **declined** at 0.23/255 |
| `SHADOW_CALM` + T11 | `fd7d28d` | PCF bias sign, world-locked kernel, texel snap in light space, catcher armed on `queryColumns` + AGL, one `offsetUnits()`/`groundOverlayOffset()` implementation | ON — **but no `verify-shadow-calm` exists** (§8) |
| `TERRAIN_LIGHT` | `9783586`, `0e2f7cb` | fragment-stage N·L, `microFwidth` grain fade, area-weighted smooth worker normals (PATCH 8, spliced at build time like `__DECODE__`), skirts inherit their edge normal | tile half ON; `workerNormals` BUILT-OFF (the LERC path is unreachable here) |
| `CLOUD_LIT` + `LAMBERT_ENV` | `a5c403e` | fake-hemisphere normal + Henyey-Greenstein forward lobe on drei's instancer via a prototype ACCESSOR (drei overwrites a constructor assignment one line later), same ONE draw; Lambert `reflectivity` 1 → 0.15 on 4 content + 2 monument materials (uniform-only) | ON — the cloud variant takes the registry key and **not** a warm-set entry, a documented exception with a measurement condition attached |
| shared | `9783586` | `r24VariantKey(base, tokens)` with fixed order **e** ONE_SUN · **f** TERRAIN_LIGHT · **a** AERIAL_LAW · **l** LOD_CROSSFADE, plain booleans, all-off ⇒ the bare R19 key | — |
| F4 + F11 | `6ac995f`, `98cc33d` | three monument material-contract gates added additively to `verify-monuments-sat` (its eleven frozen numbers unmoved), the fourth as a source-level unreachability proof; the two key-NEUTRAL shader edits documented in the registry header | ON |

Node gates: `verify-depth-offset` **7** · `verify-c-flagoff` **26 → 37** ·
`verify-worker-normals` **12** (3.34° last-writer → **0.26°** area-weighted),
plus three closed-form proof scripts. **Zero constants moved, in six
milestones.**

### D ATMOS (r24/d, W1 tip `6dc8817`; W3 `1620e32`) — ledger [`scripts/r24-d-atmos.md`](scripts/r24-d-atmos.md)

| flag | sha | what | verdict at close |
|---|---|---|---|
| `AERIAL_LAW` | `5114dcf`, `bc408e7` | `lib/fly/atmo-law.js`: ONE analytic f(distance, height, sunDir) → (transmittance, inscatter) as ONE GLSL string + ONE JS mirror; post pass at high (LAW variant chosen once from a module const so production and the warm twin cannot diverge), per-material term at medium/low before `<dithering_fragment>`, tier split never-both; the 16–55 km tile band retired by AMPLITUDE, the 60–120 km rim melt absorbed by extinction → 1; satellite-scoped (toy writes strength 0 = the IEEE-exact identity path) | **OFF** — no pixel A/B exists at any pose; ON only after the horizon re-baseline batch and one Owens draw row (D's own recommendation) |
| `AERIAL_LAW.nightRamp` (A8) | `bc408e7` | post-pass strength on the city windows' own `dayFrac` curve — exactly 1 at noon, exactly 0 at deep night, uniform-only, no shader text | **ON** — the round's only unconditional GO from D |
| `LOD_CROSSFADE` | `e7993ee`, `bc408e7` | vendored PATCH 5/6/7 (**+68 / −0**, insert-only, so D spends none of A's deleted-lines budget), parent-texture clip-UV blend on refine AND merge, `lib/fly/lod-crossfade.js`, `__flyStats.terra.fades` with enumerated skip reasons; `fadeSec` 0.25 = un-hitched FRAME time (the −50 block clamps dt at 50 ms), `maxConcurrent` 12 → **32** because it counts MATERIALS and a refine arms four (≈ 8 concurrent refines ≈ 2.7 MB of retained parent textures) | RED measured (20/20 hard swaps); **ON only on the cert run's ON row** (§8) |
| `SKY_PROCEDURAL` | — | **NOT BUILT**; the design is in D's ledger §4.5 | OFF |

Node gates: `verify-atmo-law` **41** (GLSL parsed by a subset interpreter and
compared with the JS mirror at 4,160 points, 0 relative error; flag-on minus
the law === flag-off character for character) and `verify-lod-fade.mjs` **51**.
**Not built and reported as such**: the content and air/anchor law variants
(satbldg, satskyline, anchor, monument, air, air-anchor, road, water) — the
dispatch is designed (`atmoApply` for opaque, `atmoExtinct` for additive), the
variants are not.

### E CERT (r24/e, W1 tip `c7d538c` → `299cc1a`) — ledger [`scripts/r24-e-cert.md`](scripts/r24-e-cert.md)

| deliverable | sha | what |
|---|---|---|
| launch shim | `98c4cda` | `scripts/_pw-shim.js` — a `node -r` preload with **zero diff in any verify-\*.js**: drops `channel:'chrome'`, adds the explicit SwiftShader ANGLE path (~2× the fill rate of the implicit one), resolves the global playwright as a fallback; `PW_CHANNEL`/`PW_EXTRA_ARGS` restore the author's launch on the user's machine |
| OFFLINE WORLD FIXTURE | `10a7963`, `effae67`, `b81a10a` | synthetic imagery (z/x/y stamped, per-tile hue, z-border), terrain-rgb DEM **sized 5/9/17/33 px by zoom** around three-tile's `clamp((z+2)*3,2,64)` resize and Martini's 2^k+1 requirement, MVT via geojson-vt + vt-pbf with CLOSED rings and OpenFreeMap's NEGATIVE winding sign, ADS-B + weather stubs, `/__stats`, `/__spec`, `/__health` + `FIXTURE_REV`; scenes at the fleet's own poses (manhattan / sf / tokyo / columbus / powell / blagnac / **owens** / **sierra** / **melton** / smokies / rural / an empty-body tile); imagery pinned as a SOURCE after route-fulfilled imagery froze the quadtree at z6 |
| `FRAME_STATS` | `a071ee9` | `lib/fly/frame-stats.js` at `useFrame` priority **−101** (ahead of the governor and A's rig): dt ring, p50/p95/p99, >33/>100 ms per minute, stalls/min on the R22.1 definition (`dt ≥ max(2×median, 28 ms)`), longtasks, `programsDelta`, `markPhase` attribution into `lastStall.phases` |
| user-diag pack | `a071ee9` | `scripts/r24-user-diag.md` — four questions, a self-contained console collector that works on ANY build, the 3-minute Powell → Columbus serpentine, and a 30 s recording recipe whose per-second rows carry `dReady`/`dSky`/`adds`/`removes` deltas |
| `budgetK()` | `1bf7f5a` | `lib/fly/harness-budget.js` — harness-only per-frame budget scaler at five sites, exactly 1 in production, content gates only |
| `_settle.js` | `0fa0c0f` | settled is a **CONDITION** (maxZ ≥ 14, elevation quiet, `ready + empty === chunks`, a fresh stats publish), never a duration |
| offline `verify-seam` node leg | `b8b32f9` | the first complete FIXTURE column — 9 gates, ~40 s, no browser, no GPU |
| hygiene | `a996b9e` | R21 seam artifact restored; fs-level fixture write redirect (`scripts/` → `scripts/r24-out/fixture-*`) wrapping every write path Playwright uses; `verify-artifact-hygiene.mjs` as an OUTCOME gate |
| new gates + smoke | `d5fe40f`, `b81a10a`, `964a7e6`, `cbd7c8a` | verify-flash-guard / -fade / -lod-fade / -step-clean / -one-sun / -env-uniform / -linear-haze / -depth-roundtrip / -frame-pace; `verify-flicker` quiescence precondition (bound of 12 **unmoved**); `r24-smoke.sh` (zero passes = failure; `SMOKE_NODE_ONLY=1` runs 15 node gates in 13 s) |

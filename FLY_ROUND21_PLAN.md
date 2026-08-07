# FLY ROUND 21 — "STEADY STATE" (PLAN)

Orchestrator: Fable. Executors: FIVE Opus 5 agents (A GOVERNOR / B STREAMKEEPER /
C SURFACE / D PIPELINE / E CERT). Branch `claude/round21-steady-state` off
`3645af8` (the R20 merge). Scaffolding commit: this document + four pre-seeded
`enabled:false` constants blocks + `WORKER_PROTOCOL 16→17` at all six pin sites
lockstep + the `getFacadeAtlas` module-scope hoist (behavior-preserving) + the
`__flyGovPin` fleet pin in `scripts/_boot.js`.

## §0 Why (the user's report, and what exploration found)

After the R20 merge the user reports, live on their machine: **(1) whole-screen
glitching** — "everything will flash, reappear, disappear" — **immediately on
boot AND degrading further after minutes in satellite**, and **(2) patchy
world** — parts of the world load their satellite/neon styled geometry while
adjacent areas don't, **in BOTH styles**. Three exploration passes converged on
an 18-defect inventory (S1–S8 flashing, P1–P10 patchiness) — full statements
with file:line in the orchestrator plan; the per-agent charters below embed
the ones each agent owns. R20's 32-green certification was structurally blind:
the fleet pins style=toy / weather=baseline / aerial+shadows=0 / sun=noon, and
the soak booted TOY — satellite was never soaked under a live
PerformanceMonitor. R20 also shipped over its own triangle budget (soak
2.345–2.549M vs frozen 2.2M; p95 12.5ms vs R19 8.4ms) with the gate demoted
instead of the cost contained.

**Round mandate**: surgically fix all 18 defects WITHOUT deleting any R20
feature; add the prerender/pre-warm system (the repo has ZERO
`renderer.compileAsync`, no tile cache, no lookahead, no amortized uploads);
close the harness blind spot. User decisions locked 2026-08-06: full round (no
hotfix), tile cache PERSISTENT across sessions, small density trims
pre-sanctioned as fallback levers only.

## §1 Scaffolding (Fable, already landed on this branch)

- `WORKER_PROTOCOL 16→17` at all six pin sites lockstep (worker:~131,
  toy-world-engine:~55, sat-building-engine:~44, sat-skyline-engine:~23,
  sat-road-engine:~33, sat-veg-engine:~15). Stale bundles drop. Payloads
  unchanged at bump time; D's in-round output moves (reason codes, skyline
  selection, vegMeta opt-in) land behind this one gate.
- Four constants blocks at the tail of `lib/fly/fly-constants.js`, ALL
  `enabled:false`: `PERF_GOVERNOR` + `FX_STABILITY` + `PREWARM` (owner A),
  `STREAM_KEEPER` (owner B), `SURFACE_CALM` (owner C), `TILE_PIPELINE`
  (owner D). Flag-off must stay byte-identical to R20 behavior per block.
  Owners tune values INSIDE their own block freely; nobody edits a block they
  don't own. The reason-code contract lives in the `TILE_PIPELINE` doc
  comment — B codes against it; B treats `reason === undefined` as legacy.
- `sat-building-engine.js`: `getFacadeAtlas(night)` module-scope memo
  (behavior-preserving hoist; A's prewarm imports it; engine path unchanged;
  atlases now deliberately never disposed).
- `scripts/_boot.js`: `__flyGovPin = 'hold'` fleet-wide (both legs). Inert
  until A's flag arms. Only E's new stability gates + soaks un-pin.

## §2 Ownership matrix (files, exclusive unless noted)

| Agent | Owns |
|---|---|
| **A GOVERNOR** | `components/fly/FlyCanvas.jsx`; `components/fly/Effects.jsx`; NEW `lib/fly/perf-governor.js`; NEW `components/fly/FlyEffectComposer.jsx` (vendored @react-three/postprocessing composer fork, dep pinned 6.39.2); NEW `lib/fly/prewarm.js` + NEW `components/fly/PrewarmRig.jsx` (+ its ONE FlyCanvas mount line); `components/fly/hud/BootScreen.jsx` (warm-gate wiring ONLY); `lib/fly/fly-settings.js` (governor helpers ONLY — `autoTierCeiling` semantics unchanged); blocks `PERF_GOVERNOR`/`FX_STABILITY`/`PREWARM` |
| **B STREAMKEEPER** | `lib/fly/toy-world/toy-world-engine.js`, `sat-building-engine.js`, `sat-road-engine.js`, `sat-veg-engine.js`, `sat-skyline-engine.js`; `components/fly/SatBuildingLayer.jsx`, `components/fly/SatSkylineLayer.jsx`; block `STREAM_KEEPER` |
| **C SURFACE** | `components/fly/SatParcelHomes.jsx`, `MonumentModels.jsx`, `LandmarkMonuments.jsx`, `SatRoadLayer.jsx`, `SatAmbientLife.jsx`, `SatTintLayer.jsx`, `SatVegLayer.jsx`, `SatHouseLights.jsx`, `SatEnvironment.jsx`; `components/fly/FlyScene.jsx` **ONLY the SatShadowCatcher polygonOffset lines (~:268-270)**; block `SURFACE_CALM` |
| **D PIPELINE** | `lib/fly/toy-world/vector-tile.worker.js` (entire file); block `TILE_PIPELINE` |
| **E CERT** | NEW `scripts/verify-stability.js`, `verify-flicker.js`, `verify-tier-step.js`, `verify-seam.js`; `scripts/soak-fly.js` (satellite mode — SANCTIONED edit); `scripts/_boot.js` (SANCTIONED, the pin already landed in W0 — E extends per-gate un-pin only); `scripts/r21-close-sweep.md`; `FLY_ROUND21.md` skeleton; may author determinism fixes ANYWHERE with Fable sign-off per fix (R20 D-CERT precedent) |

`lib/fly/toy-world/world-bend.js` is **READ-ONLY** this round (prewarm imports
its `apply*` functions; NO new cache keys; no registry edits). `fly-constants.js`
is conflict-free by pre-seeded blocks. `FlyScene.jsx` is touched by exactly ONE
agent (C, three lines). B and A coordinate exactly once: A's prewarm imports
`getFacadeAtlas` (already exported in W0) — A never edits B's engine files.

## §3 Waves

- **W1 (ALL FIVE parallel)**: A–D implement behind their flags; E authors the
  four new harnesses + the satellite soak mode and **calibrates each RED on
  `3645af8`** (prove the gate catches the defect before any fix merges).
- **W2 (integration; Fable merges in order A → D → B → C)**: one reviewed
  merge commit per agent; E smoke-runs verify-stability + verify-tier-step +
  verify-flicker after each merge.
- **W3**: E certifies the integrated tree — full existing fleet (32 browser
  harnesses + 3 node gates), TOY soak + SATELLITE soak, evidence PNGs,
  `scripts/r21-close-sweep.md`, consumed-move ledger.

Worktree protocol (R19/R20 idiom, unchanged): each agent creates its OWN
worktree off `claude/round21-steady-state`
(`git worktree add .claude/worktrees/r21-<x> -b r21/<x> claude/round21-steady-state`
from the repo root), junctions node_modules
(`cmd /c mklink /J node_modules C:\Users\bfecho\skyloom-3\node_modules`), runs
its OWN `next dev` on its OWN free port (A 3120, B 3121, C 3122, D 3123,
E 3124; NEVER :3000/:3002/:3019 — user-adjacent), points every harness at it
via `FLY_URL`. **Agents never commit** — Fable reviews and lands one merge
commit per agent.

## §4 Frozen constraints (NOT sanctioned to move)

- **Owens Valley ≤ 261 draws** — every harness that asserts it
  (verify-sat-depth:153, verify-aerial:463, verify-skyline:178,
  verify-suburbia (E)). The P4 hatch ramp keeps Owens at ZERO skyline hatch
  BY CONSTRUCTION (Owens' busiest tile measures 15 candidates < lockLo 24).
- Satellite ≤ 375, toy ≤ 480 draw ceilings. Soak: **p95** tris ≤ 2.2M (the
  R20 close ruling's statistic — max was demoted; p95 is now BLOCKING on the
  new satellite soak).
- The five frozen R18 neon-cover FNV hashes (`NEON_COVER.enabled:false`
  control state = the full R20 flag set off, per the R20 gate-3 re-spec —
  R21 flags must ALSO be off in that control state; E updates gate 3a's
  recomputed flag set, which is gate-mechanics, not a hash move).
- `verify-monuments-sat.js` stays FROZEN. verify-suburbia (G): NO rendered
  height in (25, 35) m. verify-fleet / verify-hangar count arithmetic
  (`TRAFFIC_MODELS === 13`, assets.js `/models/` literals `=== 10`).
- Boot envelope (verify-boot); `runtime.modelsReady` semantics; no
  `_isModel`/`_painted` on monument/parcel meshes. PREWARM must not lengthen
  the boot envelope (hard `maxMs` timeout; warm continues async post-reveal).
- Per-block flag-off byte-identity to R20 behavior (the one-flag revert
  contract). With ALL R21 flags off, the worker must be byte-identical to
  `3645af8` for identical inputs except the `v:17` stamp.
- R20 features stay: 10 marquee monuments, per-poly coverage (Powell 1,863),
  parcel homes (Melton 2,068), toy mid-ring. Their R20 gates stay green.

## §5 PRE-SANCTIONED moves (each consumed move needs an inline
`R21 SANCTIONED RE-BASELINE: old → new` comment + a round-record row + Fable
sign-off on the measured control)

1. **P1 bend margins raise fixed-pose draw counts** (fewer chunks falsely
   culled): verify-suburbia (B)/(D)/(F) measured numbers, verify-sat-buildings,
   verify-roof-variety counts, and the Owens 179–195 measured BAND may move
   UP — ceilings (261/375/480) do NOT move. E measures the per-gate delta
   before sanctioning each.
2. **P3/P4 change WHICH skyline members render** at capped/banded tiles — any
   gate asserting member-level content there re-baselines with an A/B control;
   uncapped tiles must be provably unchanged.
3. **verify-parcel-homes timing legs** — the settle gate delays first
   placement; timing-sensitive legs re-measure. The Owens ON/OFF bit-identical
   flip legs must hold EXACTLY.
4. **`scripts/soak-fly.js`** satellite mode + p95 assertions (the R20 close
   ruling's own re-spec, now implemented).
5. **Density fallback levers, ONLY if W3's integrated satellite soak still
   breaches p95 2.2M after the churn deletions**: `SAT_POLY_COVER.maxPerChunk`
   500→440, `SAT_POLY_COVER.skyline.maxPerChunk` 300→260,
   `TOY_MID_SUBURB.minH` 12→13 — each with a deterministic worker-level A/B
   (the R20 five-tile method), never a soak-differenced ratchet. User-approved
   2026-08-06.
6. **`scripts/_boot.js` `__flyGovPin`** (landed in W0) and per-gate un-pins in
   E's new harnesses.

## §6 Agent charters (summary — full briefs delivered at launch)

- **A GOVERNOR** (S1, S2, S3, S4-composer-half, §3.1/3.2 prewarm): custom perf
  governor replacing drei PerformanceMonitor (EMA + dwell + cooldown +
  session latch + boot/warp grace + `__flyGovPin`), DPR decoupled from tier;
  memo(Effects) + discrete-keyed pass list; vendored FlyEffectComposer
  (dispose-on-remove, drawingBufferSize-true setSize keyed on dpr, pass-list
  diff, `__flyStats.fx.rebuilds`); boot prewarm (compileAsync warm set over
  the world-bend FINAL variants + both tier pass compositions, retained;
  atlases via `getFacadeAtlas`; `__flyBoot` shaders-gate wiring, 3s cap).
- **B STREAMKEEPER** (P1, P2-engine-half, P5-veg-assist, P6, P10, S4-engine-
  half, §3.4/3.5): computed bend margins on bounding spheres; empty-reason
  TTL/backoff consumption; heal caps; veg park-don't-clear; water backfill
  in place; skyline visibility hysteresis + staged toy ultra ring shift;
  velocity lookahead; amortized finalize; engine `stats.emptyByReason` +
  eviction counters for E.
- **C SURFACE** (S6, S7, S8, P5, P7, P8): parcel both-rings settle gate + EMA
  + deadband + grow-in + delete-confirm; monument per-name hysteresis +
  priority -1 same-frame suppression; upload ranges + phase stagger +
  static-skip; latches for beacons/boats/plumes (SANCTIONED unflagged
  determinism bugfixes); polygonOffset units sign-flip under reversed depth
  (tint + shadow catcher); dusk dip calm + env seed.
- **D PIPELINE** (P2-worker-half, P3, P4, P9, §3.3): empty-reason codes +
  typed http errors + AbortController timeout; skyline hash-shuffle port
  (top-N volume + FNV fill); hatch ramp (lockLo 24 / rampHi 64, Owens 15→0 by
  construction); vegMeta opt-in via `api.setDiag` (+ update its two
  consumers: `scripts/r20-b-parcels.js`, `verify-parcel-homes`); fetch
  semaphore; Cache API tile cache (persistent, in-flight dedupe, try/catch
  degrade).
- **E CERT** (§4 gates + W3): verify-stability (satellite unpinned 90s +
  orbit + TOY orbit leg + boot-window leg — proven RED on `3645af8`);
  verify-flicker (temporal stddev, owner-authoritative parks); verify-tier-step
  (forced steps: chunks survive, composer buffer === drawingBufferSize,
  programs/geometries FLAT); verify-seam (worker fixtures: Owens 0, ramp
  monotone, shuffle deterministic; browser: emptyByReason, adjacent-tile
  skyline balance); satellite soak (p95 tris ≤ 2.2M BLOCKING, governor steps
  ≤ 4, fetch-error bound); W2 smoke-runs; W3 full-fleet certification +
  ledger.

## §7 Definition of done

Every §4 frozen number green on the integrated tree; the four new gates green
(and verify-stability proven RED on `3645af8`); satellite soak p95 ≤ 2.2M with
governor steps ≤ 4; TOY soak still green; every consumed §5 move documented
inline + in the ledger; all four R20 headline features intact with their R20
gates green; `FLY_ROUND21.md` traces each of the user's two symptoms to named,
closed defects; flag-off = R20 byte-identity spot-checked (worker fingerprint
scenes vs `3645af8`).

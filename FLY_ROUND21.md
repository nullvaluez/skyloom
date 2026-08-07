# FLY ROUND 21 — "STEADY STATE" (RECORD)

> **STATUS: SKELETON.** Authored in W1 by E CERT so the round has a spine to
> fill. Sections marked `— (W2)` / `— (W3)` are filled at integration and
> close. The plan is [FLY_ROUND21_PLAN.md](FLY_ROUND21_PLAN.md); the
> per-harness certification ledger is
> [`scripts/r21-close-sweep.md`](scripts/r21-close-sweep.md).

Orchestrator: Fable. Executors: five Opus 5 agents — **A GOVERNOR** /
**B STREAMKEEPER** / **C SURFACE** / **D PIPELINE** / **E CERT** — on branch
`claude/round21-steady-state` off `3645af8` (the R20 merge). Scaffolding
commit `e1077f8`: `WORKER_PROTOCOL 16→17` at all six pin sites lockstep, four
pre-seeded `enabled:false` constants blocks, the `getFacadeAtlas` module-scope
hoist, and the `__flyGovPin` fleet pin in `scripts/_boot.js`.

---

## §0 Why this round exists

After the R20 merge the user reported, live on their own machine, two
symptoms:

1. **whole-screen glitching** — "everything will flash, reappear, disappear" —
   **immediately on boot AND degrading further after minutes in satellite**;
2. **a patchy world** — parts of the world load their styled geometry while
   adjacent areas don't, **in BOTH styles**.

R20 had shipped with 32 green browser harnesses and 3 green node gates. The
gap between that and the user's first session is the real subject of this
round, and it was not a missed run — it was structural: the harness fleet pins
`style=toy`, `weather=baseline`, `aerial=0`, `satShadow=0`, `sun=noon` and
`qualityTier='high'`, holds a FIXED pose for a handful of seconds, reads scene
totals that republish every 60 frames, and soaks TOY. Nothing in it could see
a tier step, a turning camera, a temporal flicker, or the first twenty seconds
after reveal. Three exploration passes converged on an 18-defect inventory
(S1–S8 flashing, P1–P10 patchiness); the per-agent charters in the plan §6
carry the ones each agent owns.

**Round mandate**: fix all 18 surgically WITHOUT deleting any R20 feature; add
the prerender/pre-warm system (the repo contained ZERO `renderer.compileAsync`
calls, no tile cache, no lookahead, no amortized uploads); and close the
harness blind spot so a green sweep means something it did not mean in R20.

---

## §1 Headline — (W3)

> One paragraph per user symptom, each tracing to named, closed defects.
> Symptom 1 (flashing) → S1–S8. Symptom 2 (patchy world) → P1–P10.

---

## §2 What each agent shipped

### 2.1 A GOVERNOR — (W2)
### 2.2 B STREAMKEEPER — (W2)
### 2.3 C SURFACE — (W2)
### 2.4 D PIPELINE — (W2)
### 2.5 E CERT — the harness blind spot (W1, authored pre-fix)

Four new gates and a satellite soak, each **calibrated RED against the pre-fix
tree before any fix merged** — the R20 lesson that a gate whose pass is a coin
gets demoted, applied in advance.

| New instrument | What it can see that the R20 fleet could not |
|---|---|
| **`scripts/verify-stability.js`** (15 gates, 4 phases) | a 90 s dwell with the ladder LIVE (tier/DPR steps, composer rebuilds, monument re-merges, scene remounts, heap floor); a slow 360° orbit in BOTH styles with a **false-cull census**; the 20 s BOOT WINDOW at a real Powell spawn |
| **`scripts/verify-flicker.js`** (6) | **per-pixel temporal standard deviation** over 12 consecutive frames of a frozen scene — a flicker is a temporal property and every R20 pixel gate compared exactly two frames |
| **`scripts/verify-tier-step.js`** (9) | what a FORCED tier step costs: chunk geometry survival, composer-buffer agreement, program/geometry/texture floors, and that the world never vanishes |
| **`scripts/verify-seam.js`** (7 node + 3 browser) | the worker's coverage decisions as a PURE FUNCTION of tile bytes — the 39/41 skyline cliff, the ramp spec, adjacent-tile seams, determinism — in ~60 s with no dev server |
| **`scripts/soak-fly.js --style=satellite`** | satellite under a live PerformanceMonitor across a three-leg route, reported at **p95** (the R20 close ruling's own re-spec, now implemented and BLOCKING) |

Three techniques are new to the fleet and are reusable:

- **The false-cull census.** Instead of guessing at draw-count dips, it
  replays three's own sphere-vs-frustum test twice per chunk mesh — once with
  the raw bounding sphere (what the renderer does) and once with the sphere's
  centre dropped by the same `d² · uBendK` the world-bend vertex shader
  applies (what the player sees) — and counts the meshes where the two
  disagree in the direction "culled but on screen". P1 becomes an integer.
- **The in-process worker fixture.** `scripts/verify-seam.js` imports
  `vector-tile.worker.js` straight into node behind two `registerHooks`
  loaders (one stubs `comlink`'s `expose` to capture the api, one teaches node
  the repo's extensionless relative imports). No browser, no dev server, no
  boot: ~20 ms per tile against the live OpenFreeMap tileset. R20's equivalent
  measurements needed a full GPU Chrome boot.
- **Un-pinning a fleet pin without touching `scripts/_boot.js`.** Playwright
  runs init scripts in registration order and `bootFly` registers its own, so a
  later assignment can never win. Instead the gate defines `__flyGovPin` as an
  accessor BEFORE the app mounts whose setter swallows the fleet write and
  whose getter returns undefined — and it reports both (`pin=null
  attempted=hold`), so the un-pin is proven rather than assumed. `_boot.js` was
  not modified at all this round.

---

## §3 The prerender / pre-warm system — (W2)

---

## §4 CERTIFICATION — (W3)

Ledger: [`scripts/r21-close-sweep.md`](scripts/r21-close-sweep.md).

### 4.1 RED calibration (W1, pre-fix tree `e1077f8`)

| Defect | Gate | Measured RED | Green target |
|---|---|---|---|
| P4 all-or-nothing skyline lock | verify-seam (2) | slope **8.8/candidate** (39 → 0 kept, 44 → 44) | ≤ 4 |
| P4 ramp absent | verify-seam (4) | **22/156** tiles disagree with the spec | 0 |
| P4 visible tile seam | verify-seam (5) | **14** adjacent all-or-nothing pairs | 0 |
| P1 false cull (satellite) | verify-stability (7) | **1** of 54 chunk meshes | 0 |
| P1 false cull (toy z10 ultra) | verify-stability (9) | **5** of 417, worst drop **10 191 m** | 0 |
| S3 tier step re-streams the ring | verify-tier-step (3) | ready/chunks floor **0.00** (16 → 0 ready) | ≥ 0.70 |
| S3 skyline ring | verify-tier-step (3a) | floor **0.60** | ≥ 0.70 |
| S5/S7/S8 flicker (urban) | verify-flicker (2)/(4) | p99 **14.2 → 13.6** (no decay), **380** pixels swinging >120 luma | ≤ 12 / ≤ 32 |
| — its control | verify-flicker (3) | Powell **p99 0.81**, **0** swinging pixels, same instrument | (green already) |
| P8 polygonOffset under reversed depth | verify-flicker (5) | authored **(−2, −2)**, `reversedDepthBuffer` ON | units > 0 |
| … rest | see `scripts/r21-close-sweep.md` §1 | | |

The flicker gate carries its own control **inside the run** (sweep §1a): Powell
reads zero hard-swinging pixels where Manhattan reads 380, the second window is
not quieter than the first (so it is not stream-in), and parking the harbour
boats and steam plumes at their owner-published handles does not move the
number (so it is not the deliberate movers).

Two gates did **not** reproduce red on the calibration hardware and say so out
loud (sweep §1b): the steady-pose tier flap (the headless GPU never declines —
the flap is a slow-machine behaviour, which is why the harness grew a CDP
CPU-throttled leg, and verify-tier-step carries the destructive half of the red
regardless) and the parcel-home boot carpet at Powell (the building ring
answered first on every run here).

### 4.2 Run matrix — (W3)
### 4.3 Soaks — (W3)
### 4.4 Flag-off byte identity — (W3)

---

## §5 Postmortem — (W3)

## §5b Follow-ups — (W3, seeded in W1)

- **`window.__flyComposer` is not published.** verify-tier-step's
  composer-buffer gate (4) SOFT-fails without it. A should publish the
  vendored composer on `window` in development, or the gate stays soft forever
  and the stretched-frame defect keeps its hiding place.
- **The R19 attribution follow-up is still open** (attribution hardcodes
  "Flight data © adsb.lol" while the proxy may serve adsb.fi; R17 photo mode
  bakes the string into exports).
- **verify-stability (1) and (12) need a slow-hardware run** to be red-proven
  (see §4.1) — a throttled-CPU Playwright leg is the obvious follow-up.

## §6 USER CHECKPOINTS — (W3)

> Carries forward the still-open R15/R16/R17/R18/R19/R20 §6 tables.

## §7 Lessons — (W3, seeded in W1)

1. **A fleet's own pins define its blind spot.** Six pins (style, weather,
   aerial, shadows, sun, tier) plus a fixed pose and a 60-frame stat cadence
   are exactly the six things R20's 32 green gates could not see, and the
   user's first session found all of them. Before trusting a sweep, enumerate
   what its pins make invisible.
2. **A flicker is a temporal property.** Every pixel gate in the R20 fleet
   compared two frames and asked whether a toggle moved them. No number of
   two-frame gates adds up to "does this hold still".
3. **Measure the defect, not a proxy for it.** A draw-count dip during a
   camera orbit is not evidence — a turning camera legitimately changes what
   is in view. Replaying the renderer's own cull test against the shader's own
   displacement turns "chunks vanish sometimes" into an integer that is 0 or
   is not.
4. **A ring's SIZE is not its CONTENT.** verify-tier-step's first draft gated
   on `chunks` and passed cleanly while `ready` collapsed 16 → 0 underneath
   it. The streaming unit and the geometry inside it are different quantities.
5. **An endpoint sample cannot see a step that reverts.** The first
   calibration run read `tier='high'` at both ends of every forced cycle: the
   `PerformanceMonitor` had already undone the step inside the dwell. Trace,
   don't sample.
6. **Heap slope over raw samples measures the GC sawtooth.** A 12 s window read
   +50 MB/min on a tree that was not leaking. The retention signal is the
   floor.
7. **The worker is a pure function — test it like one.** Importing it into
   node behind two loader hooks turned a 40 s boot per measurement into 20 ms
   per tile, and made the 39/41 cliff visible as a table.

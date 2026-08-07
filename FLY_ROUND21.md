# FLY ROUND 21 — "STEADY STATE" (RECORD)

Orchestrator: Fable. Executors: five Opus 5 agents — **A GOVERNOR** /
**B STREAMKEEPER** / **C SURFACE** / **D PIPELINE** / **E CERT** — on branch
`claude/round21-steady-state` off `3645af8` (the R20 merge). Plan:
[FLY_ROUND21_PLAN.md](FLY_ROUND21_PLAN.md). Per-harness certification ledger:
[`scripts/r21-close-sweep.md`](scripts/r21-close-sweep.md).

Scaffolding commit `e1077f8`: `WORKER_PROTOCOL 16→17` at all six pin sites
lockstep, four pre-seeded `enabled:false` constants blocks, the `getFacadeAtlas`
module-scope hoist, and the `__flyGovPin` fleet pin in `scripts/_boot.js`.

---

## §0 Why this round exists

After the R20 merge the user reported, live on their own machine, two symptoms:

1. **whole-screen glitching** — "everything will flash, reappear, disappear" —
   **immediately on boot AND degrading further after minutes in satellite**;
2. **a patchy world** — parts of the world load their styled geometry while
   adjacent areas don't, **in BOTH styles**.

R20 had shipped with 32 green browser harnesses and 3 green node gates. The gap
between that and the user's first session is the real subject of this round, and
it was not a missed run — it was **structural**:

| The fleet pins | so no gate could see |
|---|---|
| `fly-map-style-2 = 'toy'` (bootFly default) | anything satellite-only, in a round whose symptoms are satellite-first |
| `__flyWeatherOverride='baseline'` | overcast/precip interactions |
| `__flyAerialOverride=0`, `__flySatShadowOverride=0` | the R19 ship-state visuals under load |
| `setQualityTier('high')` in nearly every satellite gate | every cost of a tier STEP |
| a FIXED pose, seconds long | flicker (a temporal property), the boot window, and the camera TURNING |
| `soak-fly.js` booting TOY | satellite under a live PerformanceMonitor, ever |

Three exploration passes converged on an 18-defect inventory (S1–S8 flashing,
P1–P10 patchiness). **Round mandate**: fix all 18 surgically WITHOUT deleting any
R20 feature; add the prerender/pre-warm system (the repo contained ZERO
`renderer.compileAsync` calls, no tile cache, no lookahead, no amortized
uploads); and close the harness blind spot so a green sweep means something it
did not mean in R20.

---

## §1 Headline — the two symptoms, traced to closed defects

### Symptom 1 — "everything will flash, reappear, disappear"

| Defect | What it was | What closed it | The measurement |
|---|---|---|---|
| **S1** the tier flap | drei `PerformanceMonitor` with `flipflops = Infinity` and no latch; on a 60 Hz display fps 60 sits ON its upper bound, so `onIncline` fires at steady state. FlyCanvas' own comment: "the hitch IS the flap" | A's custom governor: EMA + dwell + asymmetric cooldowns + **session latch** (a rung re-descended within 120 s of ascent closes for the session) + boot/warp grace + `__flyGovPin` | verify-stability (1) **0 tier steps** over a 45 s dwell; (1b) under 6× CPU throttle the ladder **steps twice and settles**, no tier re-entered |
| **S2** every material recompiles on first draw after a step | nothing retained or pre-warmed | A's PREWARM: 29 material variants + 9 merged EffectPasses across all three tiers, compiled at boot and **retained** | verify-tier-step (5) **programs flat 73→73** across three forced high↔medium cycles |
| **S3** a tier step re-streams the ring | material re-key evicted and rebuilt chunks | A's DPR/tier decoupling + B's `waterInPlace` backfill and engine-side park | verify-tier-step (3) **retention drop 0** — `ready=[12,16,12,16,12,16]` of `chunks=[12,16,12,16,12,16]`; pre-fix the same trace read ready **16 → 0**. (3b) evictions **exactly the ring shrink**, 12 = 3 × (16−12) |
| **S4** the composer leaked and mis-sized | the library `removePass` never disposes; a DPR step resizes the drawing buffer but NOT the composer's targets (the stretched frame) | A's vendored `FlyEffectComposer`: dispose-on-remove, `setSize` keyed on `viewport.dpr` from `gl.getDrawingBufferSize()`, pass-list diff | verify-tier-step (4) **composer buffer === drawing buffer at every sample** of three cycles; (6) per-cycle geometry/texture floors **rise 0** |
| **S5** heal-loop chunk swapping under a still camera | permanently-coarse chunks evict+rebuild every 2 s forever | B's `healCap` | verify-seam (8b) **heals +0** over a settled 60 s; (8c) **evictions +0**; (8d) **errorRetries +0** |
| **S6** the parcel-home carpet at boot | `regK` divides the building ring by the veg ring; the two stream independently, and at boot `bs.chunks === 0` read as "settled", so mapped towns carpeted and vanished ~2 s later | C's both-rings settle gate + EMA + deadband + delete-confirm, **plus a collision-index trust gate** added after this round's own gate caught the residual under load (§5) | verify-stability (12) **placed 0 across 220 samples at 100 ms** at a real Powell boot — and R20's frozen contract (Powell places EXACTLY ZERO) holds |
| **S7** four pooled layers re-uploading whole buffers on the same 2 s beat | plus ambient life re-picking state instead of latching | C's ranged uploads + phase stagger + static-skip + latches | verify-flicker (2) urban p99 **13.60 → 5.8–9.0**; the settle window **14.41 → 3.6–4.9** |
| **S8** the marquee re-merging on a DEM bucket edge | a 1.5 m groundY bucket edge re-merged all 12 monuments, each merge epoch-bumping all 9 archetype pools | C's per-name baked placement state with rank/range hysteresis + min rebuild gap + `priority -1` same-frame suppression | verify-stability (5) **`monuments.remerges` 3→3** over a 45 s dwell |

### Symptom 2 — "parts of the world load, adjacent areas don't, in BOTH styles"

| Defect | What it was | What closed it | The measurement |
|---|---|---|---|
| **P1** false frustum culling | bounding spheres computed on the UNBENT geometry while the world-bend vertex shader drops vertices by `d²·uBendK` — up to ~89 % of the sphere radius on the toy z10 ring. The chunk is on screen and three drops it | B's computed bend margins on every ring's bounding spheres | verify-stability (7)/(9), reformulated to the exact invariant **`dropAtCentre ≤ bendMarginM` per mesh**: **0 short / 0 unstamped** of 54 satellite and 417 toy meshes. Proven red at margin 0: **44/54 and 417/417 short**, worst shortfall **565 m / 15 802 m** |
| **P2** empty/error tiles never re-asked, or hammered forever | no reason codes; errors retried every 2 s indefinitely | D's reason codes + typed http errors + AbortController timeout; B's TTL/backoff consumption | verify-seam (6c) **ocean and Owens-outer both return `reason: 'zero'`**; (8) engine `emptyByReason` live; (8d) **errorRetries 0** |
| **P3** which members survive a capped tile | caps consumed in spatially-clustered raw MVT order | D's hash-shuffle port (top-N by volume + FNV fill) | verify-seam (6) determinism hashes MOVED while kept counts held (2215 / 408 / 130) — "which members", not "how many" |
| **P4** the all-or-nothing skyline lock | a tile with 39 far-mass candidates rendered NOTHING; the tile beside it with 44 rendered ALL 44 | D's hatch ramp (`lockLo 24`, `rampHi 64`) | verify-seam (2) cliff slope **8.8 → 2.5** per candidate; (4) **0/156** tiles disagree with `keepN`; (5) **14 → 0** adjacent all-or-nothing seam pairs; **Owens stays 0 by construction** (busiest tile 15 < lockLo 24) |
| **P5–P7, P9, P10** | veg park-don't-clear, skyline visibility hysteresis, staged ring shift, velocity lookahead, amortized finalize, upload calm | B + C + D | carried by the fleet's own gates (§4) |
| **P8** the landcover tint dropping out on slopes | FlyCanvas runs `reversedDepthBuffer: true`; three flips only the polygonOffset FACTOR, so the authored `(−2, −2)` reaches GL as `(+2, −2)` — a slope- and view-dependent offset that lets the tint lose the depth test | C's author-side units sign flip | verify-flicker (5) **`(−2, +2)`** with `reversedDepthBuffer` on — pre-fix `(−2, −2)` |

---

## §2 Waves

- **W0 scaffolding** (`e1077f8`, Fable): protocol bump at six pin sites, four
  disabled constants blocks, the `getFacadeAtlas` hoist, the `__flyGovPin` pin.
- **W1 (five agents in parallel)**: A–D implemented behind their flags; **E
  authored four new harnesses + the satellite soak mode and calibrated each RED
  on the pre-fix tree** before any fix merged.
- **W2 (integration, merged A → D → B → C)**: one reviewed merge per agent, with
  E smoke-running the new gates after each. The per-agent attribution this
  produced — every defect class flipping green exactly when its owner merged, and
  nothing else moving — is in `scripts/r21-close-sweep.md` §2.1/§2.4/§2.6/§2.8
  and is the round's strongest evidence that the gates measure what they claim.
- **W3 certification**: E on the integrated tree — §4.

### 2.5 E CERT — the harness blind spot

| New instrument | What it can see that the R20 fleet could not |
|---|---|
| **`scripts/verify-stability.js`** (17 gates, 5 phases) | a 45–90 s dwell with the ladder LIVE; a 6× CPU-throttled slow-machine leg; a slow 360° orbit in BOTH styles with the bend-margin census; the 20 s BOOT WINDOW at a real Powell spawn |
| **`scripts/verify-flicker.js`** (7) | **per-pixel temporal standard deviation** over 12 consecutive frames of a frozen scene — a flicker is a temporal property and every R20 pixel gate compared exactly two frames |
| **`scripts/verify-tier-step.js`** (10) | what a FORCED tier step costs: chunk-geometry retention, composer-buffer agreement, program/geometry/texture floors, eviction budget |
| **`scripts/verify-seam.js`** (13) | the worker's coverage decisions as a PURE FUNCTION of tile bytes, in ~60 s with no dev server; plus engine-side heal/evict/retry counters |
| **`scripts/soak-fly.js --style=satellite`** | satellite under a live PerformanceMonitor across a three-leg route, reported at **p95** (the R20 close ruling's own re-spec, now implemented and BLOCKING) |

Four techniques are new to the fleet and reusable:

1. **The bend-margin census.** Replays three's own sphere-vs-frustum test per
   chunk mesh and asserts the engine's stamped `bendMarginM` covers the shader's
   own `d²·uBendK` drop. P1 becomes an integer that is 0 or is not.
2. **The in-process worker fixture.** `verify-seam` imports
   `vector-tile.worker.js` straight into node behind two `registerHooks` loaders
   (one stubs `comlink`'s `expose`, one teaches node the repo's extensionless
   imports). ~20 ms per tile against the live tileset, versus a 40 s boot.
3. **Un-pinning a fleet pin without touching `_boot.js`.** `__flyGovPin` is
   redefined as an accessor before mount whose setter swallows the fleet write;
   every gate reports `pin=null attempted=hold`, so the un-pin is proven.
4. **The load recipe.** Some races only appear when the page under test is the
   fourth page of a long run. §5 is what that bought.

---

## §4 CERTIFICATION

Full per-harness ledger, frozen-number watch and both soak percentile tables:
[`scripts/r21-close-sweep.md`](scripts/r21-close-sweep.md) §4.

---

## §5 POSTMORTEM — the session-limit interruption, and the carpet that hid

A session limit killed **two** agents mid-task this round (C and E, at different
points). Both were salvaged, and the round is better for how:

**Transcripts survived.** In R19 and R20 a session limit meant a lost transcript
and a forensic reconstruction from the worktree. This time both agents resumed
with their own context intact, which turned salvage from archaeology into a
checklist.

**Verify-first salvage.** E's resume began with `git status --short` before
anything else, on the explicit principle that **a half-finished smoke is
testimony, not evidence**. The tree came back clean — the killed run had died
before writing a single artifact — so nothing partial entered the record and the
entire post-B smoke was re-run from a freshly restarted server. Had the tree been
dirty, the correct move was the same: discard, do not reconcile.

**The finding that only load could produce.** C's parcel settle gate passed C's
own probe three times. E's `verify-stability` then caught **276 parcel homes
carpeting Powell for 0.7 s after reveal** on the integrated tree — the exact
symptom the user reported, in the exact window they reported it. A targeted probe
(fresh browser, one page, 50 ms sampling, two runs, 480 samples) could **not**
reproduce it: `placed 0` throughout, with the collision-column index already
populated at the first sample. The difference was load — in the stability harness
the boot-window page is the FOURTH page of a long run, after a 45 s dwell, a 30 s
orbit, a 35 s CPU-throttle leg and a toy page, and under that the parcel layer
evaluates before the column index exists, computes `regK 0` against an empty
denominator, and carpets. C's fix became a **collision-index trust gate**, not
just a ring-readiness gate.

This is the R20 harness-vs-prose lesson evolved. R20 learned *a harness that
matches prose as code is not a harness*. R21 learns the sharper form:
**a probe green on a quiet boot is not a probe green under load** — and the
cheapest way to find a race is to make the thing under test compete for the
machine.

---

## §5b Follow-ups

- **Pinned fixture tiles for the hash gates (R22).** Two of the five frozen R18
  neon-cover hashes were proven — by a three-way control including a pristine
  `e1077f8` stash — to be **already red on the untouched scaffolding tree**:
  OpenFreeMap published planet build `20260802_080001_pt` on the day R20 closed.
  A hash gate whose input is a LIVE tileset is a gate against someone else's
  release schedule. Commit the tile bytes, or pin the planet build in the URL;
  `verify-seam`'s in-process worker fixture is the natural host.
- **`caches.match()` is not a fetch, so it blinds network gates.** D's persistent
  tile cache took `verify-seam` (7) from "4 URLs at 2× each" to **zero observed
  requests** — not because nothing re-requests, but because cache hits fire no
  request event. Engine-side counters (`heals`/`evictions`/`errorRetries`) are now
  the load-bearing instrument for P2/P6. Any future gate that counts network
  traffic needs the same treatment.
- **MipmapBlurPass sub-material churn** on low↔medium remains (A, documented,
  bounded; the latch makes `low` one-way in practice).
- **Parcel first placement is ~5 s later than R20** by construction (the settle
  gate). A taste checkpoint, not a defect — §6.
- **A's prewarm retains ~29 materials by design**, and its env-snapshot timing
  (`envWaitMs 4000`) is a cache-key dependency worth re-measuring if the HDRI set
  changes.
- **The flicker residual is unattributed.** 23–80 pixels of 547 200 (≈0.013 %) at
  Manhattan, zero at Powell, after **five negative controls** (boats+plumes,
  water specular, crop below horizon, Bayer dither, bloom). Gate (4) is
  informational with the record inline; (4a) Powell === 0 is load-bearing.
- **The census's old count is informational.** A translated-sphere disagreement
  count cannot reach 0 by construction; it is printed beside the exact
  margin-covers-drop assertion so the trend stays visible.

---

## §6 USER CHECKPOINTS — PENDING

The two reported symptoms come first; everything else is taste.

| # | Checkpoint | What to look for |
|---|---|---|
| **1** | **THE FLASHING — your machine, satellite, a long session** | boot, then fly 10+ minutes. Nothing should flash, vanish and return. R21 closed S1–S8; your machine is the only place the vsync-locked flap can actually be confirmed dead — headless CI cannot reproduce it (§7) |
| **2** | **THE PATCHY WORLD — both styles** | fly over suburbs and city edges and TURN THE CAMERA. No chunk should pop out while it is plainly on screen; no tile-shaped hole beside a full one |
| 3 | Melton AU and Powell OH parcel homes | Melton should still carpet with 2 068 homes; Powell should still place ZERO (real footprints win). Both are R20 contracts R21 must not have moved |
| 4 | Monument merges during DEM streaming | fly toward ESB / Liberty / Taj as terrain refines — the marquee should not blink or double-draw against its procedural archetype |
| 5 | Dusk crossing | fly through sunset in satellite; the HDRI cross-blend and the golden lobe should ease, not snap |
| 6 | Toy cruise density and headroom | FL200+ in Neon; the world should be denser than R20 (the bend margins keep chunks that used to vanish) at a measured cost of ~50 draws |
| 7 | First-placement delay taste | parcel homes now appear ~5 s into a boot rather than immediately. Correct, but is it noticeable? |

Carries forward the still-open R15/R16/R17/R18/R19/R20 §6 tables.

---

## §7 Lessons

1. **A fleet's own pins define its blind spot.** Six pins (style, weather,
   aerial, shadows, sun, tier) plus a fixed pose and a 60-frame stat cadence are
   exactly the six things R20's 32 green gates could not see, and the user's
   first session found all of them. Before trusting a sweep, enumerate what its
   pins make invisible.
2. **A probe green on a quiet boot is not a probe green under load.** C's settle
   gate passed its own probe three times; the carpet appeared only when the page
   under test was the fourth page of a long run.
3. **A hold needs its own clock.** A settle gate that trusts ring readiness but
   not the index the ratio actually divides by is not a settle gate — it is a
   different race with a longer fuse.
4. **The flap was hiding a bug in the harness.** E's first post-A run failed
   because the CPU-throttle leg drove the tier to `low`, where the satellite
   engines never mount. Under R20's `PerformanceMonitor` that was invisible —
   `onIncline` bounced the tier straight back up. **A's fix working correctly is
   what exposed the ordering assumption.** Expect a fix to break the harness that
   proved it.
5. **A frozen hash over a live tileset is a gate against someone else's release
   schedule.** Three of five reproducing while two moved — sparing one scene
   entirely — is the signature of upstream drift, not a code regression. The
   3-of-5 split *was* the evidence.
6. **Counting the loop beats counting its shadow.** A cache turned a network
   re-request gate into a no-op overnight. The engine's own heal/evict counters
   cannot be short-circuited by a layer below them.
7. **Model the fix, not a proxy for it.** The false-cull census modelled the bend
   as a translation while the fix grew a radius, so its count could never reach
   zero however good the fix was. Asking the engine for the margin it actually
   applied turned a plateauing count into a binary invariant, provably red at
   margin 0 and green at margin > drop.
8. **A ring's SIZE is not its CONTENT.** The first tier-step gate asserted on
   `chunks` and passed cleanly while `ready` collapsed 16 → 0 underneath it.
9. **An endpoint sample cannot see a step that reverts.** Trace, don't sample.
10. **Heap slope over raw samples measures the GC sawtooth.** A 12 s window read
    +50 MB/min on a tree that was not leaking. The retention signal is the floor.
11. **A number that survives five controls is not a pass/fail statistic.** The
    flicker residual and the skyline near-crop ratio were both demoted with their
    control records intact — and in both cases the half that *could* discriminate
    (Powell === 0; the absolute 1.2 % ceiling) kept its teeth.

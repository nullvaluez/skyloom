# R22.1 "WORLD STABILITY" — CLOSE LEDGER (D "CERT")

Branch `r22p1/integrate`, worktree `.claude/worktrees/r22-fable`, dev server
`:3021`. Final tree = STEP_SAFE (A) + FRAME_PACE (B) + FLASH_GUARD (C2), all
three `enabled: true`.

**Verdict up front: see §7.**

Conventions follow `scripts/r22-close-sweep.md`: every row carries its
NUMBERS, every red carries an ADJUDICATION reached by control rather than by
re-baselining, and everything unrun is named rather than assumed.

Written INCREMENTALLY while the runs were in flight (a session limit killed an
agent earlier in this round), so section numbering is stable but rows were
appended as they landed.

**Contents.** §0 what this round certifies · §1 the three new gates, GREEN and
RED · §2 frozen subset · §3 the two open reds, adjudicated · §4 cloud closure ·
§4b the pale-frame watch · §6 the satellite soak · §7 verdict · §8 named R23
follow-ups. (§5 was renumbered to §8 when the follow-ups moved to the end;
there is no §5.)

---

## §0 What this round certifies, and what makes it different

R22.1 is a three-defect hotfix wave against one user recording of the shipped
R22 production build. Each defect has a measured root cause, a one-flag revert
and a NEW RED-calibrated gate:

| defect | root cause | fix | gate |
|---|---|---|---|
| one-frame full-screen white flash | ONE **zero-area triangle** in a streamed sat-buildings chunk; `side: DoubleSide` + the bend's float32 offset tips the rasterizer's area determinant | `FLASH_GUARD` — area filter at drape finalize | verify-flash-guard |
| micro-stutter, ~1 freeze / 2 s while manoeuvring | three-tile's `getBoundaryEdges` skirt builder on the MAIN thread (67 % of stall samples) | `FRAME_PACE` — vendored patch #5, output identical by construction | verify-frame-pace |
| (latent) DPR-step present-before-draw | r3f reallocates the drawing buffer between animation frames; the composer resizes a frame late | `STEP_SAFE` — a priority −99 rig that resizes inside the frame that draws | verify-step-clean |

What is different from an ordinary close: **this round's certification is not
just "the gates are green", it is "the gates can still go RED on THIS tree".**
A gate that cannot fail certifies nothing, so every new gate below was run in
BOTH directions on the final integrated tree, not only on its author's branch.

---

## §1 The three new gates — GREEN and RED, both legs, on the final tree

### 1.1 verify-flash-guard

| leg | lever | result | numbers |
|---|---|---|---|
| **GREEN** | — | **PASS 9/9** | 45,925 composed frames · **0 pale** · 0 black · census **0 zero-area** of 109,141 live tris over 25 meshes · `degenScanned 3,983,782 / degenDropped 274,902 / degenChunks 202` |
| **RED** | `FLASH_PIN_OFF=1` (`__flyFlashPin='off'`) | **FAIL (4)(6)** — the gate still detects the defect | 40,777 composed frames · **2 pale** (first n=2903, `pr` 0.997, L 225.2) · census **9,500 zero-area** live · `degenDropped 0` |

The RED leg is the load-bearing row: the identical harness, on the identical
integrated tree, reproduces both the deterministic census red (9,500 zero-area
triangles across six named chunks) and the stochastic content red (2 pale
frames) the moment the guard is pinned off. Gate (3) — "there WERE degenerates
to drop" — passed in both legs, so the GREEN is not vacuous: the defective
content was present and the filter removed it.

**Certifier's read of the filter itself** (`dropDegenerateTris`,
`lib/fly/toy-world/sat-building-engine.js:103`) — no defect found, and three
properties worth recording because they are what make the GREEN safe rather
than lucky:

* the loop bound is `n = idx.length - 2` stepping by 3, so a non-multiple-of-3
  index length cannot read past the end;
* the compaction is a single in-place write cursor and `idx` is returned
  **unchanged by reference** when `dropped === 0`, so a clean chunk allocates
  nothing and is byte-identical to the R22 path;
* the test is `nx²+ny²+nz² <= minArea2²`, i.e. the squared cross-product
  magnitude against the squared bound — no `sqrt` per triangle, and at
  `minArea2: 0` it admits exactly the exactly-degenerate set and nothing else.
  Both early returns (`!enabled` and `__flyFlashPin === 'off'`) fall through to
  the verbatim R22 line, which is why the RED leg above is a true revert and
  not an approximation of one.

### 1.2 verify-frame-pace

| leg | lever | result | numbers |
|---|---|---|---|
| **GREEN** | — | **PASS 7/7** | stalls/min OFF **95.5 / 177.5** → ON **2.7** (ratio **65.7x**, bound 4x) · worst frame **91.5 → 29.2 ms** (0.32x, bound 0.6x) · p99 **45.8 → 12.6 ms** · identity 24 buffers / 46,295 tris / 24 fast / **0 mismatches** · content **223 tiles resident in BOTH arms, 0 differ** · scene totals 277 draws both arms |
| **RED** | `PACE_PIN_OFF=1` (`__flyPaceForce=false` on the middle arm too) | **FAIL (1)(2)(3)(4)(5)** | stalls ON-arm **90/min** vs OFF median 142.3 → ratio **1.6x** (bound 4x) · worst frame **70.7 vs 95.9 ms = 0.74x** (bound 0.6x) · fast 0 / upstream 2,107 |

**The RED lever is new, and it is gate mechanics, not a product change.** This
gate is the one member of the trio whose defective tree is *already inside
every run* — the OFF arms ARE the shipped-R22 program — but running the
defective tree is not the same as proving the gate can FAIL on it. `PACE_PIN_OFF=1`
(added here, env-gated, default path untouched) boots the middle arm with
`__flyPaceForce=false` as well, so all three arms are defective and the ratio
gates collapse. They did: **1.6x against a 4x bound and 0.74x against a 0.6x
bound.** The gate detects the defect on this tree.

Two things worth recording from the GREEN run's own numbers:

* **The OFF arms got WORSE than B's calibration, not better** — 95.5 and 177.5
  stalls/min here against B's 83.9–100.7. The second OFF arm ran at a median
  8.3 ms rather than 4.2 ms, i.e. the machine was under more load by the third
  arm. That is exactly the drift the gate's OFF/ON/OFF interleave exists to
  absorb, and it absorbed it: the ON arm sat between two worse arms and still
  came in at 2.7/min.
* **Content identity is measured, not argued** — gate (6) reloads the whole
  quadtree under each arm at one frozen pose and compares every resident tile
  by z/x/y: 223 in both, 0 differ, and the scene totals agree at 277 draws.

### 1.3 verify-step-clean

| leg | lever | result | numbers |
|---|---|---|---|
| **GREEN dsf 1.5** | — | **PASS 12/12** | 20/20 steps moved the drawing buffer 1920↔1600 · reallocs outside a rAF **0/40** · buffer mismatch **0** · composer lag **0.3–0.9 ms** · same-frame proof **20/20** · live 180 s / **34,872 frames** · 0 pale / 0 black / 0 collapse · worst paleRun 0.003 vs a 0.25 gate |
| **GREEN dsf 1.0** | — | **PASS 12/12** | 20/20 steps moved 1280↔1120 (the SUB-NATIVE `1.0 → 0.875` rung SETTLE_CALM adds — the arm is not vacuous) · outside-rAF **0/40** · mismatch **0** · same-frame **20/20** · live 180 s / **35,413 frames** · 0 pale / 0 black / 0 collapse |
| **RED** | `STEP_PIN_OFF=1` (`__flyStepSafePin='off'`), dsf 1.5 | **FAIL (4)(5)(12)** | reallocs outside a rAF **40/40** · buffer mismatch **20** · composer lag **13.4–18.3 ms** · same-frame proof **0/20** |

The RED leg reproduces A's calibration exactly (A measured 24/24 and 10/12 on
a 12-step run; this is 40/40 and 20/20 on a 20-step run), and the composer lag
separates the two states by a factor of ~20 with no overlap. The two content
gates (6)/(7) are GUARDS rather than reproduced reds — A never reproduced a
pale frame from the DPR path in ~46 forced steps, and neither did I in 66
forced steps plus 70,285 live frames. That is recorded as a limitation of the
calibration, not as a green.

**70,285 live composed frames at Powell across the two GREEN legs, zero pale,
zero black, zero draw-count collapse.**

---

## §2 FROZEN SUBSET — assertion numbers unchanged

Method, stated up front because it is what makes the rows mean anything:

* **One gate at a time on a quiet machine.** No two browser harnesses ever ran
  concurrently, and nothing else was on the box. This matters — A's §6.6 and
  C2's §5.1/§5.2 both record reds that were another agent's load, and B's terra
  red (§3.1) is one too.
* **`npm run build` ran strictly LAST**, after every browser gate finished.
  `next dev` and `next build` share one `.next` and Next 16 has no `distDir`
  flag; C2 measured what happens when you build mid-gate (`window.__fly.warpToGeo
  is not a function`).
* **No frozen assertion number was moved, and none was proposed for moving.**
  A red gets ONE quiet re-run and then a CONTROL; it never gets a new bound.
* **Tracked RED artifacts restored before every commit.** Running the R21/R22
  gates rewrites `scripts/r21-e-*.png|json` and `scripts/r22-e-*.png|json` in
  place — E's frozen calibration evidence. `git checkout --` before staging,
  every time (A's §6.5 lesson).

### 2.1 The run table

Every row below was run on `r22p1/integrate` with all three R22.1 flags
`enabled: true`, against `:3021`.

| Harness | Result | Numbers, and what is frozen in them |
|---|---|---|
| **verify-stability** | **PASS 18/18** | R21 quartet. tierSteps **0** · dprSteps **0** · sceneRemounts **0** · composer rebuilds **1→1** · monument re-merges **3→3** · heap floor **−1.47 MB/min** over 180 samples · slow-machine ladder **2 steps, 1 tier re-entry** · satellite orbit **0 meshes short of their own bend margin**, 0 unstamped, of 54 tested · toy ultra ring 23/23 |
| **verify-tier-step** | **PASS** | R21 quartet. composer/material leak **0/0 ≤ 6** · world-empties-during-the-step **min 221/221 ≥ 0.5×** |
| **verify-seam** | **PASS** | R21 quartet. engine-side heal loop **+0/+0 ≤ 3** · Manhattan capped-tile spread parsed 2215 / kept 2215 over **16/16 quarter cells** |
| **verify-flicker** | **see §3.2** | R21 quartet — the second open red, adjudicated separately |
| **verify-terra** | **PASS 18/18** | Owens **200 ≤ 261** and **200 vs its own flag-off baseline 200** · P-LEWIS tris **469,503 ≤ 2 M** · textures **61 MB ≤ 300** · imagery z18 / DEM z16 · cold FL300 arrival **46 ≤ 220** · second visit **0.26 ≤ 0.40** · `fly-raster-v1` 1,170 entries · gate (2) **camTileZ 18** (§3.1) |
| **verify-arrival** | **PASS** | local warp deficit **1 level, hold 0 ms** against ≤ 2 levels / ≤ 1500 ms |
| **verify-settle** | **PASS 14/14** | prewarm published at **2.3 s** (34 warmed, 9 passes, 378 ms) vs reveal 7.31 s · **2 render-scale rungs at dpr 1** ≥ 2 |
| **verify-clutter** | **PASS** | trees2 **58 tris/instance** in the 43–96 band |
| **verify-depth2 (OFF, ship state)** | **PASS** | DEPTH_PASS built-but-off certified in its shipping state; three N8AO instruments SOFT by construction when the pass is absent |
| **verify-depth2 (`R22_DEPTH=on`)** | **PASS** | the armed state certified too — **both states green**, as R22 required |
| **verify-sat-buildings** | **PASS** | draws **226 ≤ 375** · kept **6,965** (max 500/chunk over 16) · columns **6,964** · maxR **305.9 m** — every number identical to C2's read, i.e. FLASH_GUARD moved none of them |
| **verify-sat-depth** | **PASS** | satellite low-AGL draws **215 ≤ 261** · aniso 8 · z16 requested · hillshade mean \|Δ\| 10.70 |
| **verify-round11** | **PASS** | draws **236 ≤ 480** · 0 page/console errors |
| **verify-weather** | **PASS 28/28** | rim step **0.9/255** against a bound of 18 — a FOURTH throw of the coin documented in §8 F13 |
| **verify-fleet** | **PASS** | count arithmetic FROZEN, unmoved |

**13 of 13 batch gates PASS. `grep '^FAIL'` across every log in the batch
returns nothing.** No gate needed a re-run, no control was required, and no
assertion number moved.

---

## §3 THE TWO OPEN REDS — ADJUDICATED

### 3.1 verify-terra gate (2), `camTileZ = 13` at P-LEWIS

**The question handed to me.** Agent B proved the gate red on `main` with every
R22.1 flag off, deterministically, minutes apart — yet R22's E CERT read terra
**18/18 on `d5fdb1a`** one day earlier, with the row "camTileZ **13 → 18** at
P-LEWIS". Three candidate verdicts were named: an INSTRUMENT fault (the
StrictMode dead-engine handle), a PRODUCT regression (the LOD curve stopped
reaching z18), or UPSTREAM tileset drift.

**The instrument.** `scripts/r22p1-d-terra.js` — not a gate. It reads the tree
depth under the aeroplane FOUR independent ways in ONE tick (`getGroundAt`,
which is what the gate calls · `terraStats.camTileZ`, which is what the engine
publishes · a TREE census of every tile whose (z,x,y) contains the aircraft's
lon/lat, walked from z10 down · the `__flyTerra` dev handle), at four poses in
one session, with every Esri response's STATUS and BYTE LENGTH recorded per
leg. Evidence: `scripts/.probe-d-terra/terra.json`.

#### What it measured

| leg | camTileZ | statsCamTileZ | containing-tile chain | maxLeafZ | AGL | downloading |
|---|---|---|---|---|---|---|
| **P-LEWIS, cold first visit** | **18** (trace `15,18,18,…,18`) | 18 | refines 10→11→12→13→14→15→16→**17 leaf** | 18 | 157 m | **0** |
| **POWELL (B's pose), frozen** | **10** | 10 | `10/275/387` is a **LEAF, kids 0** | **18** | 229 m | **0** |
| **P-LEWIS, SECOND visit, same session, 20 s later** | **13** | 13 | 10→11→12→**13 leaf** | **18** | 137 m | **0** |
| **OWENS** | 15 | 15 | 10→…→**15 leaf** | 17 | 422 m | **0** |

Four facts fall out, and together they name the verdict.

**(a) It is NOT upstream.** Every Esri response in every leg is **HTTP 200**
with a real payload: on the cold P-LEWIS visit, `img18` **29 responses**
(9.3–13.5 KB), `img17` 23, `img16` 20, `dem16` 20 (21–34 KB), and a full
`dem6…dem16` / `img6…img18` pyramid. Zero 4xx, zero 5xx, zero degenerate
67-byte LERC. Imagery reaches z18 and DEM reaches z16 — both at their
configured ceilings. The tileset is serving exactly what R22 measured it
serving.

**(b) It is NOT the StrictMode dead handle.** The handle IS dead — the probe
reads `__flyTerra.get().sizeZ0 = 0` and `same: false` in all four legs, which
independently confirms B's finding — but **verify-terra never reads it.** Its
`PROBE` resolves `const eng = window.__fly.engine` and its stats read
`rt.terraStats ?? rt.engine?.terraStats`. Both are the LIVE engine, and the
probe proves they agree: `camTileZ` and `statsCamTileZ` are identical in
all four legs. F4 is a real latent hazard and stays on the R23 list; it is not
this red.

**(c) It is NOT a product regression, and the frustum-immune statistics say
so.** On the same tree, in the same session: `maxLeafZ` is **18** in three legs
out of four, z18 imagery is requested and served at P-LEWIS, and A's forward
ground profile — the statistic introduced in R22 precisely because it cannot be
frustum-capped — reads **z16 / z14 / z13 at 1 / 2 / 5 km ahead** at P-LEWIS and
**z15 / z14 / z13** at Powell. That is the ground a pilot actually looks at, and
it is refined. `downloading` is **0** in every settled sample: the loader is
not slow, it is IDLE. Nothing is failing to arrive.

**(d) `camTileZ` itself is the unreliable part — MEASURED, twice, two ways.**

* **Same pose, same session, 20 s apart: 18 → 13.** P-LEWIS reads 18 on the
  cold arrival and 13 when the probe returns to the identical pose after a
  detour to Powell. Loader idle, `maxLeafZ` 18 in both. The second visit issued
  **4 img17 + 6 img18 responses and no DEM at all** — the tree simply did not
  re-refine under the aeroplane, and it did not need to in order to keep every
  other statistic green.
* **Same pose, same tree, same day: 10 frozen vs 18 flying.** My probe FREEZES
  the flight (verify-terra's own idiom) and reads Powell at **camTileZ 10**.
  `verify-frame-pace`'s precondition reads the SAME pose at **camTileZ 18** with
  the aircraft flying (§1.2). A statistic that moves 8 levels depending on
  whether the integrator is running is not measuring sharpness.

#### Why — the library's own rule, at low AGL this time

The vendored three-tile refuses to subdivide an out-of-frustum tile:
`Tile._update` at `index.js:215` is `this.inFrustum && !this.subTiles &&
this._loadSubTiles(e)`, and `_getDistRatio` (`:276`) multiplies the ratio by
**5** rather than 0.8 when a tile is not visible. R22's own VENDOR.md records
this and R22's W2 re-base RETIRED `camTileZ` **at cruise** for exactly this
reason — but left it standing at low AGL on the assumption that the ground
below is always in view. **The probe shows that assumption is false.** At the
frozen P-LEWIS/Powell poses the chase camera's forward axis sits **83–86° away
from nadir** while the vertical half-FOV is **31.9°** (fov 63.87), and the
camera is only ~8 m above the aircraft. The ground directly under the aeroplane
is roughly **78° below the camera's horizontal** against a frustum bottom edge
at **36°** — it is not merely at the edge of the view, it is nowhere near it.
So the tile the aeroplane happens to sit inside gets refined only when
something else puts it in the frustum: a fly-through (which is why the flying
arm reads 18), or an arrival trajectory that swept it (which is why the cold
first visit reads 18).

#### The gate itself, run on the final tree: **PASS 18/18**, and it prints BOTH numbers

`verify-terra` on `r22p1/integrate`, quiet machine:

```
P-LEWIS trace (20 @500ms): camTileZ 13,16,18,18,…,18 · maxLeafZ 14,17,18,… ·
                            AGL 153 m · downloading 7,12,0,0,…
PASS (2) P-LEWIS SHARPNESS — settled camTileZ=18 (best in window 18) at 153 m AGL
…
SECOND VISIT: … P-LEWIS leg alone 0img/0dem · settled camTileZ 13
VERIFY: PASS
```

**The red does not reproduce, and the gate's own log contains both readings in
one run.** Its cold P-LEWIS leg settles at **18**; its second-visit leg returns
to the identical pose later in the same session and settles at **13**, issuing
**zero imagery and zero DEM requests** for that leg — the tiles are already in
`fly-raster-v1` (1,170 entries), so this is not a data problem, it is the LOD
walk declining to descend. The gate does not assert on the second-visit zoom,
so it passes while printing the very value B's run failed on.

The rest of the run, all frozen numbers unmoved: **Owens draws 200 ≤ 261** and
**200 vs the harness's own flag-off baseline 200** (the vendor-identity signal,
tighter than the ceiling) · P-LEWIS tris **469,503 ≤ 2 M** · textures **≈61 MB
≤ 300** · imagery z18 / DEM z16 · cold FL300 arrival **46 requests ≤ 220** ·
second visit **0.26 ≤ 0.40** · `fly-raster-v1` **1,170 entries** · app errors 0.
The Esri DEM probe re-confirms R22's own measurement exactly: z15 and z16 real
(20–36 KB at all three poses), z17 a **67-byte degenerate**.

#### VERDICT — INSTRUMENT, with one real product observation attached

> **verify-terra (2) is an INSTRUMENT fault, not a product regression and not
> upstream drift.** `camTileZ` at a FROZEN low-AGL pose measures whether the
> aircraft's own tile happened to fall in the LOD walk's frustum, which depends
> on the previous pose and on whether the integrator is running. It swings
> **10 ↔ 13 ↔ 18 at the same poses on the same tree within one session** while
> every frustum-immune statistic — `maxLeafZ` 18, forward profile z16 at 1 km,
> z18 imagery served, DEM at its z16 ceiling, `downloading` 0 — stays green.
> B's red and E's green are the same tree behaving as the library specifies.
> **The gate is GREEN 18/18 here and I am not claiming B measured wrong** — B's
> run shared a machine with Agent A all session, and the trace shows the value
> climbing 13 → 16 → 18 over the first second, so a slower box legitimately
> reads 13 for the whole 10 s window. A statistic that a busy machine can pin
> at the RED value while every other signal is green is a gate defect, not a
> product signal.

**I did not move the bound and I did not re-point the gate.** Re-pointing gate
(2) from `camTileZ` to the forward profile or to `maxLeafZ` is the obvious
repair and it is A TERRA's instrument to re-point, not a certifier's — the same
line R22's W2 re-base drew when it retired the cruise form. It is carried as
**F10** in §8.

**The one thing here that is NOT an instrument artifact, and is new:** on the
second visit to a pose, the region under the camera did not re-refine within
20 s **with the loader idle and 0 DEM requests issued**. That is not the gate
being wrong; that is the tree declining to come back. It is the same family as
R21's sticky-empty tiles and it deserves an owner. Carried as **F11**.

### 3.2 verify-flicker gate (2), urban p99 vs a bound of 12

**The question handed to me.** Agent A measured PASS 7/7. Hours later C2, on
the same machine, measured **14.869** (first run, alongside a resource 404),
**12.072** (quiet re-run, armed) and **13.833** on a control with FLASH_GUARD
off — i.e. the tree *without* the fix was redder than the tree with it. C2
reported it as inherited, did not move the bound, and asked for an adjudication
between machine noise, live-tileset drift at Manhattan (R21 has already ruled
OFM planet drift once) and a real regression.

**Method.** Five runs on a quiet machine, one at a time: three with all three
R22.1 flags ARMED, then two with all three flipped to `enabled: false` in
`fly-constants.js` (C2's control idiom — flip, run, flip back; `git diff` on the
file confirmed **empty** afterwards, and the three `enabled: true` lines are
back).

| # | tree | urban p99 (bound **12**) | urban `movingFrac` | A(at settle) p99 | suburb p99 | suburb swing px | verdict |
|---|---|---|---|---|---|---|---|
| 1 | **ARMED** | **6.957** | 0.0219 | 9.900 | 0.471 | 0 | PASS |
| 2 | **ARMED** | **6.613** | 0.0234 | 5.352 | 0.360 | 0 | PASS |
| 3 | **ARMED** | **9.742** | 0.0351 | 7.112 | 0.733 | 0 | PASS |
| 4 | **CONTROL (all 3 flags OFF)** | **6.167** | 0.0206 | 6.388 | 2.394 | 0 | PASS |
| 5 | **CONTROL (all 3 flags OFF)** | **16.105** | **0.1176** | 7.152 | 6.204 | 0 | **FAIL** |

**The only red in five runs is on the CONTROL tree** — the tree without a line
of R22.1 in it — and it is the reddest reading anyone has taken all round,
worse than C2's 14.869 and worse than R21's original RED calibration band of
13.60–14.23.

**And run 5 says why, in its own numbers.** `movingFrac` — the fraction of the
ground crop that moved at all — is **0.1176**, five times every other run's
0.02, and the suburb leg of the same run reads **0.1966** against a normal
0.0013–0.0157. On top of that, run 5's B window (after the extra settle) is
WORSE than its A window (16.105 vs 7.152), which inverts the gate's own
"decay A→B = the stream-in control" expectation. That is the signature of a
scene still streaming when the 12-frame sample was taken — a chunk landing
inside the window — not of a scene that has settled and then flickers.

**Live-tileset drift is ruled out by the same table.** Drift would be a stable
shift in the Manhattan content: every run would read high. Instead the identical
pose on the identical tileset read **6.167 and 16.105 within a few minutes of
each other**, on the identical code. A 2.6× swing on one code state in one
sitting is not a property of the planet.

#### VERDICT — MACHINE / STREAMING NOISE. Inherited, not caused, bound not moved.

> **verify-flicker (2) is GREEN on the armed final tree — 3/3 at p99
> 6.613–9.742 against a bound of 12** — and the statistic is NOISY at the
> ~2.6× level on this hardware. Pooling every reading anyone has taken this
> round (A: PASS · C2: 14.869 / 12.072 armed, 13.833 control · D: 6.957 /
> 6.613 / 9.742 armed, 6.167 / 16.105 control) the p99 spans **6.167 to
> 16.105 with reds appearing on BOTH code states**, so the metric cannot
> distinguish the fix from its own absence. R22.1 is not responsible: the
> armed arm is, if anything, the quieter one. **No bound was moved and none is
> requested.**

The repair is not a new number, it is a precondition: the gate should refuse to
sample until the scene is quiescent (its own `movingFrac` is the ready-made
instrument, and it separated the runs perfectly here). Carried as **F14**.

---

## §4 CLOUD CLOSURE — A's 0 / 30,499 is PATH LUCK, and here is the arithmetic

**The open question.** Agent A named `CloudField` on a strong cross-run A/B at
the NYC spawn: pale ≈ 1 per 1,600 composed frames with clouds live, **0 in
30,499** with `window.__flyClouds.visible = false`. C2 then refuted clouds by
same-frame hide-bisection — hide `__flyClouds` IN the pale frame, with every
matrix frozen, and the pale ratio does not move — **7 / 7**, at `pr` 0.73–1.00,
with `__flyClouds` present in the swept sibling list and `__flyCirrus` too. Of
36 top-level children only the HemisphereLight and the origin-offset Group
holding `sat-buildings` clear the pale. C2 recorded honestly that this leaves
A's zero unexplained.

**What closes it is that the pale RATE is not a rate.** C2's own mechanism says
the defect is *pose-dependent*, not time-dependent: `bendD` changes every frame
and only at some poses does the area determinant tip. So "events per frame" is
really "events per unlucky pose visited", and it should vary wildly between
runs of the identical program. It does. Every RED-leg observation ever taken on
this defect, in one table:

| observer | leg | pale / frames | 1 per |
|---|---|---|---|
| A | NYC, clouds LIVE, five runs | "~1 per 1,600" | **1,600** |
| C2 | NYC probes 6/8/9/10/11 | 12 / 24,617 | **2,051** |
| C2 | production RED (`next start`) | 6 / 34,096 | **5,683** |
| C2 | verify-flash-guard RED, NYC | 6 / 43,435 | **7,239** |
| **D (this round)** | **verify-flash-guard RED, NYC, final tree** | **2 / 40,777** | **20,389** |

**A 12.7× spread on the identical defective program**, and my own RED leg today
sits at the far end of it. At A's own rate (1/1,600) a 30,499-frame window
expects ~19 events and P(0) ≈ 5 × 10⁻⁹ — which is why A's zero looked like
causation. At the rate my RED leg measured on the same pose (1/20,389) the same
window expects **1.5** events and **P(0) ≈ 22 %** — an ordinary result. A's
clouds-off zero is inside the observed spread of the rate itself, and A's
five clouds-ON runs were 2,236 / 3,189 / 3,749 / 3,791 / 23,987 frames, i.e.
mostly far too short to estimate a rate that varies this much.

**Add the mechanism C2 offered and it is no longer a puzzle**: parking 55 lit
billboards changes frame cost, which changes streaming cadence, which changes
*which poses get sampled* — and poses are the sampling unit for this defect.

**What my runs add.** Every GREEN frame below was composed with the cloud deck
LIVE and un-parked:

| run | pose | frames | pale |
|---|---|---|---|
| verify-flash-guard GREEN | NYC, baseline weather | 45,925 | **0** |
| verify-step-clean GREEN dsf 1.5 (live window) | Powell | 34,872 | **0** |
| verify-step-clean GREEN dsf 1.0 (live window) | Powell | 35,413 | **0** |
| verify-step-clean GREEN dsf 1.5/1.0 (forced-step phases) | Powell | 7,098 | **0** |
| verify-step-clean RED leg | Powell | 9,824 | **0** |

**133,132 composed frames added this round with clouds live and zero pale**, on
top of C2's 172,068 (136,547 dev + 35,521 production, including a Powell
live-weather arm) — **305,200 total.** No pale frame appeared in any run, so
C2's bisect instruments (`scripts/r22p1-c-probe6..12.js`) were not needed and
the STOP-and-report condition was never reached.

**Closure:** clouds are exonerated on the strongest available evidence (7/7
same-frame, which asks whether the actor paints those pixels rather than
whether removing it changes a rate), and the one loose end — A's zero — is
accounted for by a measured 12.7× instability in the rate itself. Nothing is
owed here. `FLASH_GUARD.cloudNearFade` stays `false` and its constants-block
comment stays accurate.

---

## §4b The pale-frame watch — what would have STOPPED this certification

The brief set one hard abort: *if any near-full-frame pale frame appears in any
run, capture it with C2's bisect instruments and STOP.* Recording the trigger
so a future reader knows it was armed rather than absent.

The detector rode along in three different harnesses this round, all reading
the DEFAULT FRAMEBUFFER in-page per composed frame (A's §2.2 finding: CDP
`Page.startScreencast` missed 8/8 injected one-frame blanks that the in-page
census caught every time):

* `verify-flash-guard` gate (6) — `pr` over a middle scanline, NYC pose;
* `verify-step-clean` gates (6)/(10) — `paleRun ≥ 0.25` with a luma jump ≥ 45
  over the session median, Powell pose, across forced DPR steps AND a live
  window;
* the same detectors again on both RED legs.

**It fired exactly where it was supposed to and nowhere else**: 2 pale frames
on the flash-guard RED leg (`pr` 0.997, L 225.2) and **zero** across every
GREEN run. `scripts/r22p1-c-probe6..12.js` were therefore never invoked, and
the STOP condition never came up.

---

## §6 THE 15-MINUTE SATELLITE SOAK

`node scripts/soak-fly.js 15 --style=satellite` on the final tree — the R21+
convention: the three-leg route (NYC city → warp Powell OH suburb → rural Union
County OH), the perf governor UN-PINNED, five BLOCKING gates.

**Run twice, and why.** Run 1 was in flight when an account session limit
terminated this agent. The soak is a detached node process, so it kept going and
finished on its own: 76 samples, contiguous minute stamps 0m → 15m, all three
legs entered (`[leg] nyc-city @0.0m` · `powell-suburb @5.2m` · `union-rural
@10.1m`), a complete summary and `SOAK: PASS`, exit 0. That is a finished run,
not a half-finished one — but it finished across the boundary of a session being
killed, so rather than argue about whether the machine was quiet I ran it
**again from scratch on a verified-quiet machine**. Both runs are reported.
Run 1's raw results were copied out before `git checkout --` restored the
tracked `scripts/soak-results-satellite.json`.

### 6.1 SATELLITE 15 min — BOTH RUNS PASS, all five blocking gates

| Blocking gate | Bound | **R22.1 run 1** | **R22.1 run 2 (quiet)** | R22 close |
|---|---|---|---|---|
| p95 triangles | ≤ 2 200 000 | **844 657** (p50 380 386, max 861 601) | **848 123** (p50 399 399, max 896 676) | 824 202 (p50 303 297, max 873 412) |
| p95 draw calls | ≤ 375 | **247** (p50 231, max 253) | **252** (p50 229, max 255) | 248 (p50 230, max 253) |
| heap climb (last-third floor vs first-third) | < 60 MB | **−76 MB** (148 → 72) | **−76 MB** (148 → 72) | −81 MB (159 → 78) |
| governor steps | ≤ 4 | **0** | **0** | 0 |
| pageerrors | 0 | **0** | **0** | 0 |
| **verdict** | | **SOAK: PASS** | **SOAK: PASS** | SOAK: PASS |

Both runs: 15 minutes, **76 samples**, all three legs, tier `high` throughout,
`dprSteps 0` / `tierSteps 0` / `latched false` — the session-latching governor
never had to move.

Informational:

| Series | R22.1 run 1 | R22.1 run 2 (quiet) | R22 close |
|---|---|---|---|
| worst p95 frame | 12.5 ms | **4.3 ms** | — (satellite worst not printed; the toy soak read 12.5) |
| fps floor (approx) | ≈ 80 | **≈ 233** | — |
| `gpuFrameMs` p95 (real GPU timer, `EXT_disjoint_timer_query_webgl2`) | worst 5.19 ms, median 3.53 | worst **3.39 ms**, median **3.26** | worst 3.68 ms, median 3.34 |
| worst rebase | 0.40 ms | **0.30 ms** | 0.4 ms |
| traffic peak | 556 live aircraft | 371 | — |

**Read against R22.** Draws are flat (p95 **247 / 252** vs 248; max **253 /
255** vs 253). Triangles are up ~3 % at p95 and the max straddles R22's
(861 601 / 896 676 vs 873 412). The heap floor still **falls 76 MB**, the
governor still never steps, and there are still zero page errors. Nothing in
this round was expected to move a soak total: FLASH_GUARD only removes triangles
that draw no pixels, FRAME_PACE is output-identical by construction
(verify-frame-pace gate (2): 24 live buffers, 46,295 triangles, 0 mismatches;
gate (6): 223 tiles resident in both arms, 0 differ), and STEP_SAFE re-orders a
resize. The p50-triangle spread (303 k → 380 k → 399 k) tracks the live traffic
and the route's own breathing, which is the statistic R20 demoted for exactly
this reason.

**The one number that looked like it moved, resolved by the second run.** Run 1
read `gpuFrameMs` p95 worst **5.19 ms** against R22's 3.68 and I flagged it as
recorded-not-adjudicated. Run 2 on the quiet machine reads **3.39 ms — better
than R22's 3.68** — with the median at 3.26 vs R22's 3.34. So the 5.19 was a
transient in a run that finished while a session was being torn down, not a
property of the tree. Both are far under the 12 ms R23 blocking-candidate
target, and the number is informational by R22's own §5.10 ruling either way.

**No pale frame.** The §4b STOP condition stayed armed through both runs
(30 minutes of satellite flight, 152 samples, three legs each) and never fired,
so C2's bisect instruments were never invoked.

---

## §7 VERDICT

### 7.1 What is green, and what that green is worth

| Claim | Evidence |
|---|---|
| The three fixes work on the integrated tree | flash-guard **9/9** (0 pale in 45,925 frames, 0 zero-area of 109,141 live tris) · frame-pace **7/7** (stalls 95.5/177.5 → **2.7**/min, worst frame 91.5 → **29.2 ms**) · step-clean **12/12 × 2 dsf legs** (0 out-of-rAF reallocs of 80, 0 mismatch, same-frame 40/40, 70,285 live frames clean) |
| Each new gate can still FAIL on this tree | flash-guard RED **FAIL (4)(6)** — 9,500 zero-area, 2 pale · frame-pace RED **FAIL (1)–(5)** — ratios collapse to 1.6× and 0.74× · step-clean RED **FAIL (4)(5)(12)** — 40/40 out-of-rAF, 20 mismatched frames, composer lag 13.4–18.3 ms |
| Nothing frozen moved | **13/13** frozen-number harnesses PASS with unchanged assertions; `grep '^FAIL'` over every batch log returns nothing; Owens **200 ≤ 261** and **200 = 200** against terra's own flag-off baseline; sat-buildings **226 / 6,965 / 6,964 / 305.9** identical to C2's read |
| The world holds for 15 minutes | satellite soak **PASS, all five blocking gates, twice** (p95 tris 844 657 / 848 123 ≤ 2.2 M · p95 draws 247 / 252 ≤ 375 · heap floor **−76 MB** both runs · governor **0** steps · **0** pageerrors) |
| The production bundle compiles | `npm run build` **PASS** (exit 0, run strictly after every browser gate — the shared `.next` hazard C2 measured) |
| Both open reds are explained by control, not smoothed | terra (2) → INSTRUMENT (§3.1) · flicker (2) → NOISE, the only red was the control tree (§3.2) |
| The clouds question is closed | 7/7 same-frame refutation + the rate-instability arithmetic (§4); **305,200 composed frames with clouds live and zero pale** across C2's runs and mine |

**Zero frozen assertion numbers moved. Zero sanctions requested. Zero
re-baselines.** One gate gained a RED lever (`PACE_PIN_OFF`, env-gated,
default path untouched) — gate mechanics, not a product change.

### 7.2 What this certification does NOT cover — by name

1. **The wide fleet was not run.** This close ran the three new gates in both
   directions, thirteen frozen-number harnesses and the soak — the subset the
   brief named. The other ~35 harnesses in R22's §3.2b (icons, parcel-homes,
   veg, groundlife, monuments, monuments-sat, roofs, roof-variety, window-grids,
   rim, edge-fx, globe, globe2, dusk, sun, poi, atlas, tracers, chase-cam, feel,
   freelook, airbend, crash, juice, spicy, contracts, living-contracts, logbook,
   photo, neon-alt, neon-cover, skyline, suburbia, sat-night, sat-mobile,
   aerial, hangar, boot, warp-arrival, mobile, mobile-layout, and the three node
   gates) were **NOT run this round.** They rest on the content-identity
   arguments in §1 — patch #5 proven output-identical on live buffers, the flash
   filter proven to remove only triangles that draw no pixels and contribute no
   normals, STEP_SAFE proven to change ordering and not content — plus
   verify-sat-buildings and verify-neon-cover's own frozen numbers being unmoved
   where they were measured. That is a strong argument. **It is an argument, not
   a green** (F16).
2. **Nothing here was measured on a production build.** A and C2 both ran
   production legs on their own branches (C2's is the load-bearing one: RED 6
   pale / 34,096 vs GREEN 0 / 35,521 against the real bundle). This close ran
   the dev server throughout, because `window.__fly` is dev-only. `npm run build`
   compiling is not the same as the bundle being certified.
3. **The user's own machine has not confirmed anything.** All three defects were
   reported from a recording of the shipped build. Nobody has yet flown the
   fixed build on the user's hardware. That is the only test that closes the
   round.
4. **Four instruments in this fleet are load-decided** and were caught being so
   this round: verify-terra (2), verify-flicker (2), verify-weather's rim, and
   the three contention reds A recorded in his §6.6. Every green above was taken
   on a quiet machine; a busy one can flip at least four of them (F15).
5. **Two more zero-area-triangle sites are known and unfixed** —
   `vector-tile.worker.js:3106` (sat skyline) and `:4579` (toy/Neon) — confirmed
   by grep, never censused (F1). If the flash is ever reported in Neon or in the
   skyline ring, it starts there.
6. **The residual stutter is not zero.** FRAME_PACE takes stalls to 0–2.7/min
   with a worst frame of 20.8–33.3 ms; the skirt builder is still on the main
   thread, five to six times cheaper rather than gone (F2).

### 7.3 The verdict

> ## CERTIFIED FOR HANDOFF
>
> The R22.1 integrated tree — STEP_SAFE + FRAME_PACE + FLASH_GUARD, all three
> `enabled: true` — is certified for handoff on the evidence above, with the six
> caveats in §7.2 stated as caveats rather than buried.
>
> Each of the three fixes is measured, each has a one-flag revert, and each has
> a gate that was **proven able to go red on this exact tree** rather than
> merely observed green on it. The thirteen frozen-number harnesses that could
> have caught a regression did not, and their numbers are unmoved to the digit.
> The two reds handed to me were both resolved by control and neither is a
> product regression: the terra red is a statistic the library's own frustum
> rule makes unreliable at a frozen low-AGL pose, and the flicker red appeared
> **only on the tree with R22.1 switched off**.
>
> **The certification is of the SUBSET that was run.** The wide fleet, a
> production leg and the user's own machine are outstanding, and §7.2 names them
> rather than letting the word "certified" cover them.

### 7.4 The one thing a reader should take away

The round found its real defect the moment somebody flew a pose the fleet does
not fly (A's §7.1: a production leg at an un-warped spawn, red in three
minutes), and it spent most of a wave arguing about two reds that turned out to
be instruments rather than the world. Both halves are the same lesson in
different directions — **a gate is only worth what its pose and its machine
make it worth** — and F10, F14, F15 and F16 are that lesson written as work.

---

## §8 NAMED R23 FOLLOW-UPS

Carried out of this round by name, so none of them can be lost to "it was
mentioned somewhere". Each says who found it and what would close it.

| # | follow-up | found by | what closes it |
|---|---|---|---|
| **F1** | **Two MORE zero-area-triangle sites, unfixed.** `lib/fly/toy-world/vector-tile.worker.js:3106` (the sat SKYLINE builder, `buildSatSkyline`) and `:4579` (the TOY/Neon building extruder) carry the identical wrap-around loop `for (let e = 0, j = ring.length - 1; e < ring.length; j = e++)` over rings `loadGeometry` has already closed with a clone of `ring[0]`, so both emit ~2 zero-area wall triangles per ring BY CONSTRUCTION. `:362` also greps but is a point-in-polygon test and is harmless. | C2 (confirmed, not censused) | A census at each site, then either the engine-side area filter ported (the idiom is one function) or a worker-side ring guard. Worker-side is `WORKER_PROTOCOL` territory and needs its own certification surface — the skyline and toy paths sit behind different frozen gates (verify-skyline, verify-neon-cover's five R18 hashes). Whether they can FLASH depends on each material's `side` mode and whether a bend perturbs its projection; neither has been checked. |
| **F2** | **The skirt builder is still on the main thread**, 5–6x cheaper rather than zero. Moving `addSkirt`/`getBoundaryEdges`/`concatenateTypedArrays` into the embedded LERC worker would take it to zero. | B | Deferred deliberately as too large a vendored surface for a hotfix wave. It is the obvious next win IF the user still sees anything after R22.1. |
| **F3** | **`SatVegEngine._commitPending` and `SatClutterEngine._commitPending` have no per-frame cap** while every other streaming engine has `finalizePerFrame = 1`. They build no geometry, so they are not the stutter — but they can flip many chunks ready in one frame and force every downstream pooled layer's signature to change on the same 2 s tick. | B | Give both the same `finalizePerFrame` budget the other engines have, and re-run verify-flicker (whose gate (3) is exactly the four-staggered-uploader pose). |
| **F4** | **StrictMode dead-engine dev handles.** `FlyScene` builds the TerrainEngine in an empty-dep `useMemo`; React 19 StrictMode double-invokes the component body, so TWO engines are constructed and the one React DISCARDS runs its constructor LAST. Every handle installed FROM A CONSTRUCTOR is therefore bound to a corpse: `window.__flyTerra.get().sizeZ0` reads 0 and `.stats()` reads null while `window.__fly.engine` is live. | B (measured) | Install dev handles from an effect keyed on the object, with a disposer that only clears if it still owns the slot — A's `registerStepSafeComposer` idiom, which is immune by construction. Until then, any gate reading engine-LOCAL state through `__flyTerra` is reading a corpse. **Not the cause of the verify-terra red — see §3.1.** |
| **F5** | **A's clouds-off statistic (0 pale in 30,499 frames) — CLOSED this round, recorded so nobody re-opens it cold.** §4 shows the pale rate spans 1/1,600 to 1/20,389 across five RED legs of the identical program (12.7×), which puts A's zero inside the rate's own spread. | A / C2 / D | Nothing to build. If anyone re-opens the cloud question, start from §4's arithmetic, not from a fresh bisection. |
| **F6** | **`FLASH_GUARD.minArea2: 0` catches exactly-zero only.** The census found no near-zero triangles at all (the `tiny` bucket 0 < area2 < 1e-6 was empty in every chunk), so there is nothing measured for a positive epsilon to catch — but a near-zero SLIVER is subject to the same determinant instability in principle. | C2 | Raise the value only against a measurement, never against the theory. The knob is already there. |
| **F7** | **The wasted vertices remain.** The filter drops indices, not the ~4 verts per degenerate wall edge; they still cost transfer, memory and the O(nVerts) drape walk. | C2 | The worker-side edge guard in F1 recovers this as a side effect. |
| **F8** | **Window resizes are not covered by STEP_SAFE.** A CSS `size` change goes through the same r3f subscriber outside the frame loop; STEP_SAFE only intercepts the DPR path. Deliberate (a resize is user-driven and already visually eventful; a governor step is not). The `FX_STABILITY`-off configuration only gets the renderer half, and the legacy `PerformanceMonitor` path (reachable only with `PERF_GOVERNOR.enabled:false`) still has the original defect untouched by design. | A | Extend the rig to the size path, or record the exclusion permanently. |
| **F10** | **verify-terra (2) needs a frustum-immune statistic.** `camTileZ` at a frozen low-AGL pose is decided by whether the aircraft's own tile fell in the LOD walk's frustum — measured swinging 10 ↔ 13 ↔ 18 at the same poses on one tree in one session (§3.1). R22's W2 re-base already retired it at cruise for the same reason; the low-AGL form has the same fault. | D (this round) | Re-point gate (2) at `maxLeafZ` and/or A's forward ground profile (both already in the gate's own `PROBE`), or make the leg fly rather than freeze. **A TERRA's instrument to re-point — a certifier does not re-aim another agent's gate.** Until then the gate is a coin at low AGL and must not be read as a product signal in either direction. |
| **F11** | **A second visit to a pose does not re-refine, with the loader IDLE.** Returning to P-LEWIS 20 s after leaving it left the tile under the camera at z13 with `downloading = 0`, 0 DEM requests and only 10 imagery responses in the whole leg, while `maxLeafZ` stayed 18 on the previous pose's leftovers. Not an instrument artifact — the tree declined to come back. | D (this round) | Same family as R21's sticky-empty tiles / reason-coded backoff. Needs an owner and a repro at a controlled pose pair. |
| **F16** | **The R22.1 wave never ran the WIDE fleet.** This close ran the three new gates in both directions, thirteen frozen-number harnesses and one soak — the subset the brief named. It did NOT run the ~35 other harnesses R22's §3.2b lists (icons, parcel-homes, veg, groundlife, monuments, monuments-sat, roofs, roof-variety, window-grids, rim, edge-fx, globe, globe2, dusk, sun, poi, atlas, tracers, chase-cam, feel, freelook, airbend, crash, juice, spicy, contracts, living-contracts, logbook, photo, neon-alt, neon-cover, skyline, suburbia, sat-night, sat-mobile, aerial, hangar, boot, warp-arrival, mobile, mobile-layout, classify, warbirds, daily). | D (this round) | Named, not assumed — see §7. Those rest on the content-identity arguments in §1, not on a fresh green. A full matrix before the next feature round would retire the assumption. |
| **F12** | **`verify-globe2`, `verify-fly-models`, `verify-fly-formation`, `verify-player-nose` still print no verdict line** — they exit 0 without a `VERIFY:`/`RESULT:` row, so they cannot be counted green mechanically. R22's close named this and it is still true. | R22 close / carried | Give each one a verdict line. Until then they are "no verdict", never "PASS". |
| **F15** | **Three gate families are now known to be load-decided, and nobody has counted how many more are.** verify-terra (2) reads 13 vs 18 depending on machine speed (§3.1), verify-flicker (2) reads 6.2 vs 16.1 depending on whether streaming finished (§3.2), verify-weather's rim reads 0.9 vs 19.0 (F13), and A's §6.6 recorded three more reds that were only contention. That is four instruments in one hotfix wave whose verdict a busy box can flip. | A / C2 / D | Worth one deliberate pass: run the fleet under measured CPU load and list every gate whose verdict changes. A gate that a loaded machine can flip is a gate that will eventually cost a round a day of investigation — this one cost most of a wave. |
| **F9** | **The toy soak still has no instrument that can judge a toy draw regression.** R21 read 481 and R22 read 483 against a fixed-pose ceiling of 480, and BOTH were ruled unjudgeable by the R20 scene-total demotion. Two rounds have now recorded a number nobody is allowed to act on. | R20 close / R22 close / carried | Give the toy soak a fixed-pose probe leg so it asserts something, or stop printing the number. |
| **F14** | **verify-flicker (2) needs a quiescence precondition, not a new bound.** Five runs today spanned p99 **6.167 → 16.105** with the ONLY red on the control tree, and the red run's own `movingFrac` was **0.1176** against 0.02 everywhere else — the scene was still streaming when the 12-frame window opened (§3.2). | D (this round), on C2's and A's readings | Gate the sample on `movingFrac` (or on a chunk-arrival count) being quiet for N frames before the window opens, and re-take the window if it is not. The instrument already computes the number it needs. **Do not move the bound of 12** — R21 calibrated it against a real defect and it still separates. |
| **F13** | **`verify-weather`'s rim gate is a coin and everyone knows it.** C2 threw it four times across two code states and read **19.0 / 1.2 / 8.7** against a bound of **18** — a 17.8/255 spread on an 18 bound. The gate's own header already admits "run 1 passed at 14.1, run 3 failed >18 on identical code". `RIM_BAND` is marked `[pencil]` and documents coordinates for a 1600×900 frame the harness does not use, and **the probe hides nothing** — no player, no traffic — which is the R17 §7.1 lesson still live inside a shipped gate. | C2 (four throws) | Give the probe a controlled pose and park the actors it does not own. Do NOT re-roll it and do NOT move the bound. |

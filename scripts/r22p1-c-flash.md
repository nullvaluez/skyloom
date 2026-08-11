# R22.1 — Agent C2 "FLASH" ledger

Branch `r22p1/clouds` off `r22p1/integrate` b920fa8 (Wave 1's STEP_SAFE +
FRAME_PACE). Worktree `.claude/worktrees/r22-fable`, dev server `:3021`.

**The branch name is wrong and I am keeping it.** It was cut when the leading
theory was CloudField. The evidence moved in the first hour: clouds are
exonerated by same-frame measurement (§2). Renaming a branch mid-round costs
more than the confusion it saves.

C2 is the SALVAGE instance. Agent C was killed by a session limit mid-
investigation; its five probe scripts and six output dirs were uncommitted.
Commit `f75294b` is that salvage, taken as the first action of this session.

---

## 1. What the predecessor left, and what was actually true in it

Committed as evidence in `f75294b`: `scripts/r22p1-c-probe{1..5}.js`,
`.probe-c-who/who.json` + two pale PNGs, `.probe-c-why/why.json`,
`.probe-c-mesh/mesh.json`. The bulky dumps (bisect / lag / stochastic census,
~2.8 MB) are gitignored — reproducible from the scripts.

Two things I flagged as suspect on arrival, and how they resolved:

| flag | resolution |
| --- | --- |
| `.probe-c-why/full-672.png` and `iso-672.png` are BYTE-IDENTICAL (md5 `52cb8663…`) — "the isolation never isolated" | **RETRACTED — the identity is the proof, not a bug.** That event had `pr = 1.0`: the culprit covers the *entire* frame, so isolating it changes no pixel. Probe 6's `isoCulpritHidden` control (L=0, pr=0) confirms the isolation machinery does work. I was wrong to doubt it and I am recording that I was wrong. |
| `why.json` cam `[0, 808.3, -4525]` is the NYC ~800 m default spawn, not the user's Powell 233 m pose | **STANDS.** Both A and C reproduced at NYC. Powell is still owed a run (§6). |

The predecessor's last words — "not the clouds — a satellite-buildings chunk
mesh" — are **CONFIRMED**, and its scene-graph hide-bisection was a sound
instrument. It runs the re-renders *inside* the intercepted `composer.render`,
before any matrix is recomputed, so the torn frame's state is preserved.

---

## 2. H4 — CLOUDS ARE EXONERATED. Same-frame beats cross-run.

Agent A's ledger reports a strong stochastic A/B at the NYC spawn: pale ≈1 per
1,600 composed frames with clouds on, **0 in 30,499** with
`__flyClouds.visible = false`. On that basis A named CloudField and
recommended a near-camera puff fade.

That is a *rate comparison across runs*. The hide-bisection asks a strictly
stronger question — hide the actor **in the very frame that is pale, with every
matrix frozen**, and see whether the pale survives:

| event | `__flyClouds` hidden on the pale frame | verdict |
| --- | --- | --- |
| probe 4, n=1503 (`pr` 0.731) | pale UNCHANGED, `pr` 0.731 | not the clouds |
| probe 6, n=1078 (`pr` 1.000) | pale UNCHANGED, `pr` 1.000 | not the clouds |
| probe 6, n=1160 (`pr` 0.997) | pale UNCHANGED, `pr` 0.997 | not the clouds |
| probe 6, n=1268 (`pr` 1.000) | pale UNCHANGED, `pr` 1.000 | not the clouds |
| probe 6, n=1571 (`pr` 0.997) | pale UNCHANGED, `pr` 0.997 | not the clouds |
| probe 6, n=2071 (`pr` 0.864) | pale UNCHANGED, `pr` 0.864 | not the clouds |
| probe 6, n=15266 (`pr` 0.997) | pale UNCHANGED, `pr` 0.997 | not the clouds |

**7 / 7.** In probe 4's full scene-level sweep, of **36 top-level children only
two** clear the pale: the `HemisphereLight` and the origin-offset `Group` that
contains `sat-buildings`. `__flyClouds` (sibling 32, a Group of 55 puffs) is in
that swept list and does not clear it. `__flyCirrus` does not either.

**Why A's A/B still went to zero is NOT explained, and I will not pretend it
is.** Parking 55 lit billboards changes frame cost and therefore streaming
cadence, which plausibly closes the window — but that is a hypothesis, not a
measurement. What is measured is that clouds do not paint these pixels. See
§6 for the honest open item.

---

## 3. The mechanism, measured

### 3.1 What it is NOT (probe 6, `scripts/r22p1-c-probe6.js`, 6/6 events)

15,582 composed frames at the NYC pose, baseline weather, 6 pale events, each
adjudicated inside the frame:

| hypothesis | prediction | measured | verdict |
| --- | --- | --- | --- |
| **H1** same-frame chunk add / epoch tear | culprit was added this frame | `addedThisFrame=false` 6/6; ages **107, 143, 297, 554, 446, 2213** frames | **REFUTED** |
| **H1** transform teleport | `matrixWorld` differs from last frame | `mwDelta = 0.000` 6/6 — byte-identical translation | **REFUTED** |
| **H3** material / attribute state lag | colors or anchors missing, program not ready | `color=true`, `anchor=true`, `vertexColors=true`, `matShared=true`, `progReady=true` 6/6 | **REFUTED** |
| **H4** clouds | hiding clouds clears the pale | unchanged 6/6 (§2) | **REFUTED** |
| **H2** bend shader | removing the bend patch clears it | unbent clone → `pr 0` 6/6 (from `pr` 0.86–1.00) | **SURVIVES** |

The chunk is a long-resident, geometrically sane, correctly-transformed merged
building mesh. Nothing about it changes on the frame it goes white.

### 3.2 Narrowing H2 to ONE input (probe 7, `scripts/r22p1-c-probe7.js`)

The unbent clone in probe 6 dropped *three* things at once — the vertex bend,
the Bayer screen-door discard and the content-haze mix. Probe 7 neutralises one
input at a time on the frozen pale frame. `pr < 0.5` means that input is the
cause. Three events, identical results:

| trial | n=1208 (pr .664) | n=2170 (pr 1.000) | n=2628 (pr .997) |
| --- | --- | --- | --- |
| **`uBendK = 0`** | **0.009** | **0.007** | **0.016** |
| **`uBendCenter = camera`** | **0.000** | **0.000** | **0.000** |
| `uSatBldgFade = 1` | .664 | 1.000 | .997 |
| `uSatHazeMax = 0` | .664 | 1.000 | .997 |
| `HemisphereLight.intensity = 0` | .664 | 1.000 | .997 |
| `DirectionalLight.intensity = 0` | .664 | 1.000 | .997 |
| `scene.fog = null` | .664 | 1.000 | .997 |
| `environmentIntensity = 0` | .664 | 1.000 | .997 |
| **`material.color = black`** | **.664** | **1.000** | **.997** |

Two findings, and the second one reframes the whole defect:

1. **It is the bend, and only the bend.** `uBendK=0` and `uBendCenter=camera`
   both collapse the pale to zero. Every other input is inert.
2. **THE PALE IS NOT THIS MATERIAL'S SHADED COLOUR.** Setting the diffuse to
   pure black leaves the frame at L=226.9. Killing *both* lights leaves it at
   L=226.9. A black, unlit surface cannot paint a 226-luma field — yet hiding
   the mesh removes it. So the mesh is not being *seen*; something downstream
   is reacting to the **depth** it writes.

That kills the "a lit white wall saturates the post chain" reading that both A
and the predecessor carried (A's §1.2 calibration showed the post chain's
response to a saturated input *matches* the recorded frame — true, but it does
not establish that the input came from a lit surface).

The uniform ring is flat across the event — `uBendCenter` marches smoothly
(−5081.9 → −5083.0), `uBendK` is a constant 5e-6, fade 1, hazeMax 0. **No
uniform spikes.** Whatever changes between a normal frame and a pale frame is
not in this material's uniform state.

Vertical profile of the pale: `[0.97, 1, 1, 1, 1, 1, 1, 1, 0.97]` over nine
scanlines — near-total frame coverage, consistent with the user's 83%.

### 3.3 It is ONE zero-area triangle (probes 8–12)

I chased a post-process explanation first and it was wrong. Recording the
detour because the wrong turn is instructive:

* `rawSceneRender` (a direct `renderer.render` to the default framebuffer) is
  **not** pale — which looked like proof the post chain invents it. It is not
  proof: the composer's RenderPass writes an HDR HalfFloat target with **no**
  tone mapping, while a direct render writes the LDR default framebuffer
  **with** it. The second clamps exactly what the first passes on.
* Reading the composer's own input buffer as FLOAT settles it: **the pale is
  already in the scene render.** lumMean 0.213 → 0.853, fraction of samples
  over luminance 1.0 0.015 → 0.45, and hiding the culprit puts it back to
  0.211. Not a post artifact.
* Bloom exonerated properly — by `intensity = 0` and `threshold = 99`, not by
  `blendFunction`. Probe 8 showed per-effect `blendFunction = 0` is an
  unreliable disable: on HueSaturation it blacked the entire frame.

**The culprit chunk rendered ALONE fills the whole frame with a flat,
featureless pale field** (`.probe-c-look/iso-180.png`). Flat and featureless is
the signature of one enormous primitive, not of a city block. So probe 11
binary-searched the index draw range:

| draw range | result |
| --- | --- |
| all 109,503 indices | `pr` 0.731 |
| `[0, 61410)` | `pr` **0.000** (black) |
| **`[61410, 61413)` — ONE TRIANGLE** | **`pr` 0.731** — the whole thing |

Its three vertices:

```
i=40221  pos [805.5746459960938, 34.12337875366211, 331.4261779785156]
i=40222  pos [805.5746459960938, 34.12337875366211, 326.64886474609375]
i=40223  pos [805.5746459960938, 34.12337875366211, 326.22686767578125]
```

x identical, y identical, z spanning 5 m — **three collinear points, a
zero-area triangle.** All attributes finite; all three share one anchor and
therefore one bend drop (148.90 m), so the bend does not shear it.

### 3.4 Why a zero-area triangle paints the screen

A zero-area triangle is mathematically invisible, but it is numerically
unstable to rasterize: the area determinant is ~0, so the sign and magnitude
are decided by the last bits of the projected coordinates. The material is
**`side: DoubleSide`**, so backface culling — which removes about half of these
by winding — never runs. The bend adds a per-vertex float32 offset
(`bendD * bendD * uBendK`) that perturbs the projection just enough to tip the
determinant, which is exactly why `uBendK = 0` and `uBendCenter = camera` both
collapse the pale and why nothing else does.

It also explains the thing that confused me for two probes: **the pale
reproduces on demand from the frozen frame state.** This is not a timing race.
It is a pose-dependent numerical condition — as the aircraft moves, `bendD`
changes every frame, and only at certain poses does the determinant tip. That
is why it is ~1 frame in 1,600 and why the user saw exactly one frame.

My float64 CPU replication of the bend disagreed with the GPU (it put the
geometry 2.6 km away in the lower-left, ndcX −4.4..−0.12). That disagreement is
not a bug in the replication — it is the finding. float64 never tips.

### 3.5 Prevalence — this is systemic, not one bad building

Probe 12 censuses every streamed chunk (NYC, settled):

| chunk | tris | zero-area | % | coincident |
| --- | --- | --- | --- | --- |
| fb6c0469 | 35,824 | 2,528 | **7.06 %** | 2,526 |
| 68a5692b | 18,372 | 1,457 | **7.93 %** | 1,456 |
| 83336648 | 36,501 | 3,152 | **8.64 %** | 3,150 |
| 873be0c1 | 41,933 | 2,802 | **6.68 %** | 2,802 |
| d44701b8 | 44,157 | 2,806 | **6.36 %** | 2,804 |
| a1ce53a3 | 28,122 | 2,082 | **7.40 %** | 2,082 |

**Every large building chunk carries 6–9 % exactly-zero-area triangles.** Two
distinct kinds, and the difference matters for the fix:

* **coincident** (≈99.9 %) — two vertices byte-identical, e.g.
  `pa = pc = [358.298583984375, -4.965739727020264, 330.8290100097656]`. A wall
  quad extruded over a zero-length footprint edge (duplicate consecutive
  footprint points).
* **collinear but distinct** (≈2 per chunk) — the probe-11 painter. A ring
  dedupe would NOT remove these, so the fix must be an **area** test, not a
  point dedupe.

Small chunks (127–602 tris) carry **zero** degenerates, so this tracks dense
OpenFreeMap footprints, not the extruder in general.

---

## 3.6 The fix — `FLASH_GUARD`

New constants block `FLASH_GUARD` (fly-constants.js, appended after
`STEP_SAFE`) + `dropDegenerateTris()` in `lib/fly/toy-world/sat-building-engine.js`,
called in `_finalizePending` immediately before `setIndex` and
`computeVertexNormals`.

* **An AREA test, not a point dedupe.** The wall degenerates would fall to a
  consecutive-duplicate dedupe on the footprint ring; the roof-earcut one that
  was actually caught painting would not. The test is on area, at the end of
  the pipeline, so it catches every producer including any the drape creates.
* **On the DRAPED positions**, engine-side. The worker is untouched —
  `WORKER_PROTOCOL` does not move, and no other worker consumer is disturbed.
* **Before `computeVertexNormals`**, so a degenerate cannot contribute a
  zero/NaN face normal to its neighbours' shading either.
* **`minArea2: 0`** — exactly-degenerate only. Measured-safe rather than
  guessed: the census `tiny` bucket (0 < area2 < 1e-6) was **empty in every
  chunk**, so 0 removes the entire measured population without touching one
  real triangle.
* Compacts **in place** on the worker-transferred buffer the engine owns, and
  returns the input array untouched when nothing is dropped — a clean chunk
  allocates nothing.

### 3.6b The fix is provably shading-neutral

I wrote in the first draft of the code comment that filtering before
`computeVertexNormals` "stops a degenerate perturbing its neighbours'
shading". **That overclaimed, and checking it produced a better fact.**

`computeVertexNormals` accumulates a face normal per triangle as
`cross(c-b, a-b)`. For a coincident-vertex triangle and for a collinear one
that cross product is exactly `(0,0,0)` — so a degenerate contributes
*nothing* to the accumulation and never perturbed anything. Verified directly
against this repo's three build with a quad plus one coincident and one
collinear degenerate:

```
with degenerates   : 0,0,1, 0,0,1, 0,0,1, 0,0,1
without degenerates: 0,0,1, 0,0,1, 0,0,1, 0,0,1
NORMALS IDENTICAL on the real vertices: true
```

So the correct statement is the stronger one: **removing these triangles
cannot change the shading of any surviving vertex.** Combined with the fact
that a zero-area triangle covers no pixels when it rasterizes correctly, the
fix is pixel-neutral on every well-behaved frame by construction, and the only
frames it changes are the defective ones. The comment in the source now says
that instead.

**Revert contract:** `FLASH_GUARD.enabled: false` ⇒ the index buffer is used
verbatim, one branch, byte-identical to R22. Runtime pin `__flyFlashPin='off'`
gives the same RED tree without a rebuild (A's `__flyStepSafePin` idiom); it is
never set by the app or by `scripts/_boot.js`.

**Not shipped: the cloud fade.** `cloudNearFade: false`, with the reasoning
inline in the constants block. Clouds are refuted 7/7 by same-frame bisection,
and a near-camera fade would move cloud placement — which several frozen pixel
gates read — to fix an actor that has been shown not to be the actor.

**Not triangle-count-neutral, deliberately.** Index counts fall 6–9 % on dense
chunks. Pixels do not change (a zero-area triangle contributes none when it
behaves); `verify-sat-buildings` confirms the content instruments are unmoved
(§5). Nothing in the fleet asserts an exact sat-building index count, and the
tris budgets are ceilings this only lowers.

---

## 4. Numbers

### 4.1 RED vs GREEN — same gate, same machine, same session

| leg | pale frames | zero-area triangles live | verdict |
| --- | --- | --- | --- |
| **RED** (`FLASH_PIN_OFF=1`, NYC) | **6 / 43,435** | **5,068** | FAIL (4)(6) — the calibration |
| GREEN NYC baseline | **0 / 48,707** | 0 | PASS 9/9 |
| GREEN Powell baseline | **0 / 42,681** | 0 | PASS 9/9 |
| GREEN Powell **live weather** | **0 / 45,159** | 0 | PASS 9/9 |

**GREEN total: 136,547 composed frames, zero pale, zero black.** Powell is the
user's own pose; live weather is the arm the entire harness fleet is blind to
(`__flyWeatherOverride='baseline'` is a fleet pin), which is exactly what A's
open risk 5 asked for.

Earlier RED evidence from the probes, same tree, NYC baseline: **12 pale in
24,617 frames** (probes 6/8/9/10/11) ≈ 1 per 2,051.

### 4.2 What the filter costs

It runs inside `_finalizePending`, which is budgeted (`drapeBudgetMs: 1.0`,
`finalizePerFrame: 1`), so the per-frame worst case is one chunk's scan.
Measured standalone on the largest chunk shape in the census (44,157 tris),
using the real index layout — the wall extruder pushes 4 CONSECUTIVE verts per
quad, so access is spatially coherent:

| layout | median | p95 | max |
| --- | --- | --- | --- |
| coherent (realistic) | **0.264 ms** | 0.758 ms | 0.956 ms |
| random indices (cache-hostile, not the real layout) | 0.454 ms | 2.752 ms | 9.171 ms |

The realistic figure fits inside the 1.0 ms budget on the biggest chunk that
exists. The random-index row is reported because I measured it first and it
looks alarming — it is not the shipped access pattern, but the honest reading
is that this filter is memory-bound, so a future geometry layout that
scatters indices would make it expensive.

Empirically there is no regression: `verify-settle` (the stutter gate) and
`verify-stability` both PASS, and the GREEN windows sustained ~187 fps.

### 4.3 The filter's own arithmetic

Census before: 28 meshes, 482,740 tris, **34,405 zero-area**.
Census after: 28 meshes, 448,335 tris, **0 zero-area**.
Per chunk, exact: 70,393 verts 35,824 → 33,296 tris (−2,528, the measured
count); 36,776 verts 18,372 → 16,915 (−1,457). Nothing but the degenerates
left.

Over a 260 s NYC window the engine reports `degenScanned 4,052,557 /
degenDropped 280,503 / degenChunks 217`.

---

## 5. Frozen gates

Run against `:3021`. **No frozen assertion number was moved.**

| harness | result | note |
| --- | --- | --- |
| verify-flash-guard RED (`FLASH_PIN_OFF=1`) | FAIL (4)(6) | the calibration — it must fail on the defective tree |
| verify-flash-guard × 3 GREEN legs | PASS | 9/9 each; §4.1 |
| verify-sat-buildings | **PASS** | draws 226 ≤ 375, kept 6,965, columns 6,964, maxR 305.9 — all unmoved |
| verify-stability | **PASS** | |
| verify-settle | **PASS** | |
| verify-round11 | **PASS** | |
| verify-weather | **PASS** | first run FAILED on a HARNESS error I caused — §5.2 |
| **verify-flicker** | **FAIL (2)** | **PRE-EXISTING — not mine, proven in control** |
| `npm run build` | **PASS** | |

### 5.2 I contaminated verify-weather, and it is my fault, not the gate's

The first verify-weather run died with
`page.evaluate: TypeError: window.__fly.warpToGeo is not a function`. That is
not a content failure and it is not flake: **I ran `npm run build` against the
same `.next` the dev server was serving from, while the gate was in flight.**
`next dev` and `next build` share one `.next` and Next 16 has no `distDir`
flag — the R19 close recorded exactly this hazard for a second dev server, and
a production build is worse. A health check after the build confirmed the dev
server had recovered (`warp: function`, `__satBuildings: object`), and the
quiet re-run is green.

Rule for the next agent: **never build while a browser gate is running against
the dev server.** Sequence the production leg after the dev sweep.

### 5.1 verify-flicker (2) is not mine, and the control says so

Gate (2) URBAN FLICKER wants p99 per-pixel temporal stddev ≤ 12.

| run | p99 | other |
| --- | --- | --- |
| first run, armed | 14.869 | also FAIL (6): a resource 404 |
| quiet re-run, armed | **12.072** | (6) cleared |
| **control — `FLASH_GUARD.enabled:false`** | **13.833** | **also FAIL (4a)** Powell suburb=5 |

The tree **without** my change is redder than the tree with it, and fails an
extra gate. So (2) is pre-existing on this machine, and FLASH_GUARD *improves*
it. The first run's shape also matches A's §6.6 exactly — a content red
downstream of a network red — but I am not claiming contamination for the
re-run: 12.072 against a bound of 12 is a real 0.6 % overshoot, on a machine
that has been running heavy probes all session. **I did not move the bound and
I am not asking for it to be moved.** It is reported as inherited.

The control was run by flipping the constant to `false`, running, and flipping
it back; `git diff` on `fly-constants.js` was confirmed empty afterwards.

---

## 6. Instruments

| script | what it establishes |
| --- | --- |
| `scripts/r22p1-c-probe6.js` | actor adjudication on every pale event: scene-level bisection incl. clouds, chunk-age census (H1), matrixWorld vs previous frame, CPU bounding-sphere projection, unbent-material discriminator, culprit-hidden control |
| `scripts/r22p1-c-probe7.js` | single-input uniform/light/fog/colour toggles on the frozen pale frame |
| `scripts/r22p1-c-probe8.js` | channel (depth/colour/raw render) + pass & effect sweep + float64 CPU bend replication |
| `scripts/r22p1-c-probe9.js` | reads the composer's HDR input buffer as FLOAT; drives bloom by its own parameters |
| `scripts/r22p1-c-probe10.js` | pixels — full / culprit-isolated / culprit-hidden PNGs + mean HDR rgb |
| `scripts/r22p1-c-probe11.js` | **drawRange binary search — names the single triangle** |
| `scripts/r22p1-c-probe12.js` | static zero-area census across every streamed chunk |
| `scripts/verify-flash-guard.js` | the shipped gate, 9 gates, RED-calibrated |

All read the default framebuffer in-page per composed frame (A's §2.2 finding:
CDP screencast is blind to single-frame events).

---

## 7. Decisions

**7.1 Kept the branch name `r22p1/clouds`.** The evidence moved off clouds; the
name is a historical artifact. Noted rather than churned.

**7.2 Retracted my own arrival finding.** I opened by calling the predecessor's
byte-identical isolation PNGs a probe bug. They are not — at `pr = 1.0` an
isolation render is *expected* to be byte-identical. Recorded in §1 rather than
quietly dropped.

**7.3 Fixed engine-side, not in the worker.** The worker's wall loop is the
cheaper site (it would save the wasted vertices too, not just the indices) and
the structural `loadGeometry` closing-point duplicate is right there. But it
only produces the COINCIDENT kind. The triangle actually measured painting the
screen comes from the roof earcut, which the wall-loop guard would not touch.
One area test at the end of the pipeline covers every producer; a worker-side
edge guard is a follow-up perf win, not the correctness fix.

**7.4 Did not ship the cloud fade.** See §3.6. Refuted actor, and the fade
moves geometry frozen pixel gates read.

**7.5 Two gate bugs found by the RED leg, both fixed.** Gate 2 read
`degenScanned` where the guard's state is `degenDropped`; gate 9 failed on a
live-network 404. That is the RED leg doing its job.

**7.6 Moved gate 1's own precondition** from a live-triangle threshold
(calibrated on Manhattan) to cumulative `degenScanned`, because Powell
legitimately holds 4,845 live triangles and a threshold that fails the sparse
pose for being correct is a bad threshold. This is my own new gate, not a
frozen number.

---

## 8. Open, unproven, honest

1. **A's clouds-off 0 / 30,499 is still unexplained.** Clouds do not paint
   these pixels — 7/7 same-frame, with `__flyClouds` in the swept sibling list.
   Why parking 55 lit billboards drove A's *rate* to zero is not measured. The
   plausible reading is that removing them shifts frame cost and therefore
   which poses get sampled, since the defect is pose-dependent rather than
   time-dependent — but that is a hypothesis. Anyone re-opening the cloud
   question should start here.
2. **verify-flicker (2) is inherited red** (§5.1), 12.072 vs a bound of 12,
   redder without my fix. Not moved, not smoothed.
3. **`minArea2: 0` catches exactly-zero only.** The census found no near-zero
   triangles at all, so there is nothing measured for a positive epsilon to
   catch — but a *near*-zero sliver is subject to the same determinant
   instability in principle. If a future pose produces one, the value is there
   to raise **against a measurement**.
4. **The wasted vertices remain.** The filter drops indices, not the ~4 verts
   per degenerate wall edge. They still cost transfer, memory and the O(nVerts)
   drape walk. A worker-side edge guard would recover that (§7.3).
5. **Only satellite buildings are fixed, and I have CONFIRMED two more sites
   carry the identical pattern.** The wall extrusion at
   `lib/fly/toy-world/vector-tile.worker.js:1739` is the one I fixed
   (downstream). The exact same wrap-around loop —
   `for (let e = 0, j = ring.length - 1; e < ring.length; j = e++)` over rings
   that `loadGeometry` has already closed with a clone of `ring[0]` — appears
   at:
   * **:3106** — the sat SKYLINE builder (`buildSatSkyline`), same
     `pushV`-per-edge quad shape.
   * **:4579** — the TOY/NEON building extruder.
   (`:362` also matches the grep but is a point-in-polygon test, harmless.)

   Both therefore emit ~2 zero-area wall triangles per ring by construction, as
   satellite did. **I did not census or fix them** — whether they can flash
   depends on their own material `side` mode and whether a bend perturbs their
   projection, and each sits behind a different certification surface. The
   user's report was satellite. If the flash is ever reported in Neon, or in
   the skyline ring at altitude, start at those two line numbers, not from
   scratch. The engine-side filter idiom here ports directly.
6. **The user's recording was 1280x720 at Powell 233 m AGL banked, in
   production.** I reproduced at Powell and in production, but never at that
   exact bank/speed — the pose is uncontrolled in the harness. The mechanism is
   pose-independent, so this is a coverage gap, not a doubt about the cause.

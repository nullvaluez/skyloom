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

## 4. Instruments

| script | what it establishes |
| --- | --- |
| `scripts/r22p1-c-probe6.js` | actor adjudication on every pale event: scene-level bisection incl. clouds, chunk-age census (H1), matrixWorld vs previous frame, CPU bounding-sphere projection, unbent-material discriminator, culprit-hidden control |
| `scripts/r22p1-c-probe7.js` | single-input uniform/light/fog/colour toggles on the frozen pale frame |
| `scripts/r22p1-c-probe8.js` | depth vs colour channel; which pass/effect paints it |

All read the default framebuffer in-page per composed frame (A's §2.2 finding:
CDP screencast is blind to single-frame events).

---

## 5. Decisions

**5.1 Kept the branch name `r22p1/clouds`.** The evidence moved off clouds; the
name is a historical artifact. Noted rather than churned.

**5.2 Retracted my own arrival finding.** I opened by calling the predecessor's
byte-identical isolation PNGs a probe bug. They are not — at `pr = 1.0` an
isolation render is *expected* to be byte-identical. Recorded in §1 rather than
quietly dropped.

---

## 6. Open, unproven, honest

1. **A's clouds-off 0/30,499 is unexplained.** Clouds do not paint the pale
   (7/7 same-frame). Why parking them drove the *rate* to zero is not measured.
2. **Powell is owed a run.** Everything so far is the NYC ~800 m spawn. The
   user was at Powell, 233 m AGL, live weather, production build.
3. **The depth hypothesis (§3.3) is not yet proven.**

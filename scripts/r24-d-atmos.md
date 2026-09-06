# R24 D ATMOS — "one atmosphere, no hard pops" (ledger)

Worktree `/home/user/skyloom-r24-d`, branch `r24/d`, port 3104, key suffix
`-d24`. Charter: plan §3 D ATMOS. Ids: **L4 L10 · T4(b/c) T10 · A8**
(context: L1 is C's, T4(a) `preUpload` is A's).

**Environment truth up front.** This container has no GPU worth the name
(ANGLE/SwiftShader, ~1 fps under the game's load) and the tile hosts are
403-blocked. Every number below is either (a) a pure-function/node
computation, (b) a shader-text or cache-key fact, or (c) a fixed-pose fixture
pixel/draw number once E's fixture lands. **No ms, fps, stutter or tearing
number in this ledger was measured here, and none may re-baseline a live
one.** Per-item honesty in §9.

---

## §1 RED — measured before anything was built

### 1.1 The two-fogs mid band (L4). `node scripts/verify-atmo-law.mjs` §5

Satellite/high, eye 1 km AGL, ground fragment (h = 0). `post` is
AerialPerspective (`0.55·smoothstep(800,14000,d)·exp(-h/1200)`, 3-D Euclidean
from the CAMERA); `tile` is the world-bend depth haze
(`0.5·smoothstep(16000,55000,d)`, XZ distance from the BEND CENTRE, no height
term); TOTAL is how they actually compose, `1-(1-tile)(1-post)`.

```
     d(m)     post    tile   TOTAL   d(TOTAL)/d(km)
      800   0.0000  0.0000  0.0000       —
     4000   0.0813  0.0000  0.0813  0.025406
     8000   0.3124  0.0000  0.3124  0.057775
    12000   0.5159  0.0000  0.5159  0.050888
    13500   0.5477  0.0000  0.5477  0.021163
    14000   0.5500  0.0000  0.5500  0.004615
    15000   0.5500  0.0000  0.5500  0.000000   <-- dead band
    16000   0.5500  0.0000  0.5500  0.000000   <-- dead band
    17000   0.5500  0.0010  0.5504  0.000436
    20000   0.5500  0.0147  0.5566  0.002060
    30000   0.5500  0.1470  0.6162  0.005955
    45000   0.5500  0.4182  0.7382  0.008136
    55000   0.5500  0.5000  0.7750  0.003679
    60000   0.5500  0.5000  0.7750  0.000000
```

Four RED facts, all gated:

1. **The handoff is a 2 km plateau, not a seam.** Between 14 km and 16 km the
   total haze is EXACTLY constant (two zero-slope samples). Distance stops
   reading for 2 km, then restarts at 1/12 of the slope it had at 8 km. The
   eye does not see a step; it sees the depth cue switch off and back on.
2. **The 16-55 km band has no height term at all** — a valley floor and a
   1.2 km ridge top at 30 km haze identically in the scene pass.
3. **The two evaluators do not measure the same ray.** Post is 3-D from the
   camera; the tile band is XZ from the bend centre. At cruise (eye 9 km,
   XZ 16 km) they differ by **+14.7 %** (18,358 m vs 16,000 m).
4. **medium/low get nothing at all inside 16 km** — the post pass is
   `minTier: 'high'`, the tile band starts at 16 km. The entire flyable near
   and mid field has zero distance cue on every non-high machine.

### 1.2 The night post-haze at 0.55 (A8)

`AERIAL_PERSPECTIVE.maxMix 0.55` is a pure function of tier × style × the
fleet pin — there is no sun term in the block and none in the shader. At deep
night the mix target is the rim colour `#101a30`, so the same 0.55 *darkens*
distant city and terrain instead of hazing them. Gated as a pure function in
verify-atmo-law §6.

### 1.3 The hard LOD pop (T4 b/c) — the user's own symptom

User report relayed 2026-09-06: *"really bad screen tearing and glitching —
mainly buildings appearing and disappearing, and terrain tiles swapping for
other ones."* The tile half of that is verbatim in this tree:

- `three-tile/dist/index.js:257-271` `_loadSubTiles` — children are created
  with `_loadState='loading'` but NOT added; then `await Promise.all(...)`,
  `this.add(...children)`, `this.unloadModel()` in ONE synchronous block.
  There is no frame in which both are drawn and no frame in which neither is.
- `:280-286` `_removeSubTiles` — merges are the same atomic pattern.
- `:430-441` the Martini error table `7000·(1−z/17)³` → z13 ≈ 91 m, z15 ≈ 11 m:
  the SURFACE moves at a refine, not just the texture.
- `:1044-1049` imagery becomes `new Texture(img)` from an HTMLImageElement, so
  the swap frame also pays four `texImage2D` + `generateMipmap` uploads
  (A's `preUpload` removes that half; this ledger owns the visual half).

RED count protocol (needs E's fixture, whose imagery carries a z/x/y stamp and
a per-tile hue so a parent↔child swap is pixel-observable): hard pops per
scripted Powell→Columbus serpentine = single-frame `ready`↔`visible`
transitions where a tile's drawn texture identity changes between consecutive
frames with no intermediate blend. GREEN target: zero single-frame swaps,
every swap covered by a ≤300 ms blend, Owens draws unchanged, boot fade-free.

---

## §2 M1 — AERIAL_LAW

### 2.1 The law (`lib/fly/atmo-law.js`, NEW)

One analytic `f(d, h, cosSun) → (transmittance T, inscatter I)`;
`out = c·T + I·(1−T)`.

- **Extinction** is the exact analytic integral of an exponential atmosphere
  along the eye→fragment ray: with ρ(y)=exp(−y/H), τ = β·d·(e^−a − e^−b)/(b−a)
  where a = eyeH/H, b = fragH/H, degenerating to β·d·e^−a when the heights
  agree. That single expression covers level flight, a dive at a ridge, and
  look-down-from-cruise — the case the old altitude-blind 14 km smoothstep
  could not express at all.
- **β is per channel** (mild Rayleigh lean 0.84 / 1.0 / 1.225), so the colour
  walk toward the horizon is free instead of a flat grey mix.
- **Inscatter** is the live rim triple pushed toward a warm `sunTint` by a
  Henyey-Greenstein forward lobe on the view/sun angle — normalised to its own
  forward peak so `mie.k` reads directly as "peak fraction", and written as a
  `mix`, so it is bounded and can never over-brighten.
- **`strength` is the only kill switch**: `mix(vec3(1.0), T, uAtmoStrength)`
  is IEEE-exactly `vec3(1.0)` at 0, so `c·1 + I·0` returns `c` unchanged. That
  is what makes flag-off / fleet-pinned / toy frames bit-identical rather than
  merely close (gated: 200 random (colour, d, h, cosSun) points return the
  input BIT-EXACTLY).

Calibration: `beta.base 6.45e-5` is chosen so that at low flight a ground
fragment at 14 km keeps T = 0.45, i.e. lands on **exactly the mix the R19 post
pass produced at the end of its band**. The near/mid field the user already
signed off does not move; everything the old stack could not do falls out of
the same coefficient.

### 2.2 Colour space — correct in linear whatever C's flag does

The composer's target is linear HalfFloat, so `<colorspace_fragment>` is
identity and the after-fog slot is LINEAR (recon L1). `setAtmoLaw()` therefore
decodes the raw sRGB rim triple to linear **itself**, with the exact
`toy-palette.hexToRGB` transfer function, and the law never reads `uEdgeColor`
/ `uHazeColor` — whose space depends on whether C's `LINEAR_HAZE` is on. When
C's flag IS on, both decode the same triple through the same curve and agree
exactly; when it is off, the law is still linear-correct and C's terms are the
ones that are wrong. **No double decode is possible by construction.**

### 2.3 The instrument: `scripts/verify-atmo-law.mjs` (NEW, 25 gates, node-only)

The risk this gate exists for: the law is evaluated in two places (per material
at medium/low, post pass at high) and **no pose exercises both tiers at once**,
so a drift between them would be invisible to every pixel gate — the 14→16 km
seam would just move to the tier boundary.

So the gate does not compare two implementations by eye. It **parses the GLSL
string that ships in the shaders** (`ATMO_GLSL_VERTEX + ATMO_GLSL_FRAGMENT`,
imported from the module the materials inject) with a ~200-line interpreter
over the exact subset the law is written in, evaluates it, and asserts equality
with the JS mirror at 4,160 sample points spanning d ∈ [0, 130 km],
h ∈ [−400 m, 9 km], cosSun ∈ [−1, 1].

Result on this tree: **25 passed, 0 failed.**

| gate | result |
|---|---|
| GLSL parses in the declared subset (anything outside it throws) | PASS — 5 functions |
| `atmoTrans` GLSL == JS | PASS, worst rel 0.00e+0 |
| `atmoInscatter` GLSL == JS | PASS, worst rel 0.00e+0 |
| `atmoApply` GLSL == JS | PASS, worst rel 0.00e+0 |
| `atmoExtinct` GLSL == JS | PASS, worst rel 0.00e+0 |
| `atmoPack` GLSL == JS | PASS, worst rel 2.12e-15 |
| strength 0 returns the input BIT-EXACTLY | PASS |
| T monotone non-increasing in distance (no band edges) | PASS |
| T(0) == 1 exactly | PASS |
| extinction → 1 by 120 km | PASS, T = [0.0044, 0.0015, 0.0004] |
| a ridge hazes less than the valley at the same range | PASS, 0.7212 vs 0.6148 |
| blue extinguishes fastest | PASS, [0.6655, 0.6148, 0.5511] |
| 2nd difference tiny across 0.5-60 km (ONE continuous law) | PASS, worst 1.78e-4 |
| from cruise, ground 30 km out still attenuated | PASS, T 0.7249 |
| the four RED rows above | PASS (all four) |
| A8 ramp: noon multiplier EXACTLY 1 | PASS |
| A8 ramp: deep night EXACTLY 0 | PASS |
| A8 ramp monotone in `sun.frac` | PASS |

The interpreter is itself a gate: the law may only be written in the subset it
follows (float/vec3 decls, return, `+ - * /`, unary −, parens, ternary, the
four comparisons, swizzles, and `exp sqrt abs min max mix clamp dot length
vec3 float`). Anything else throws at parse time.

### 2.4 What the law does to the numbers (pure computation, not a measurement)

| pose | old total mix | law mix | note |
|---|---|---|---|
| low, ground @ 14 km | 0.550 | 0.550 | calibrated to match — the signed-off band does not move |
| low, ground @ 15-16 km | 0.550 (flat) | continuous | the dead band is gone by construction |
| low, ridge (h 1.2 km) @ 30 km | 0.616 (same as valley) | less than the valley | the 16-55 km band gains a height term |
| cruise (eye 9 km), ground @ 14 km | 0.550 | 0.139 | the law knows the eye is above the air |
| any, @ 120 km | 1.000 via a separate smoothstep | 0.996 via extinction | the rim melt folds in |

---

## §3 M2 — LOD_CROSSFADE

### 3.1 What was built

`LOD_CROSSFADE.mode 'parentBlend'`. On a REFINE the four children are added
already sampling the PARENT's texture through a clip-UV rectangle (each child
covers one quadrant of the parent's [0,1] map) and cross-dissolve to their own
map over `fadeSec` (250 ms shipped, ≤ 300 ms by charter). On a MERGE the same
machinery runs backwards: the leaf children dissolve INTO the freshly loaded
parent imagery (mix 0 → 1) and only then does the geometry swap, so the swap
lands under a surface that already matches on both sides.

**Zero extra draws.** The children were already the drawn geometry in both
directions; the blend is one extra `texture2D` inside three's own map chunk.
The rejected alternative — keep the parent mesh drawn under the children and
dither it out — costs a transient draw per in-flight quad AND, per the archived
R22.1 B3 finding, an ordered screen-door dither under SMAA-only AA reads as
shimmer, which is the artifact class this round exists to remove.

**Where it lives.** Three vendor patches (VENDOR.md rows D5 holder, D6
`_loadSubTiles`, D7 `_removeSubTiles`), all INSERT-ONLY: 4 hunks, +68 / −0, so
D spends none of A's `DELETED_UPSTREAM_LINES` budget. All POLICY is in
`lib/fly/lod-crossfade.js` — the library gets two call sites and a holder, and
its import list stays `three` + A's worker tail.

**Two placement facts that are not style choices.**
- D6 must run one statement BEFORE the refine return expression, because
  `unloadModel()` disposes the parent texture inside that same expression. The
  hook detaches `material.map` from the parent material first (so the dispose
  walk cannot reach it) and refcounts it.
- D7 holds `_loadState` at `"loading"` across its await. `_update()` skips a
  loading tile AND, because children are only visited inside that branch, its
  whole subtree — without the hold, a parent whose model is loaded but not yet
  added would be re-evaluated mid-blend and could call `_loadSubTiles` on
  itself. The hook caps its own promise (`fadeSec + 400 ms`) so a tile unloaded
  mid-blend can never leave the library awaiting forever.

**The map-chunk surgery.** The blend has to land on `sampledDiffuseColor`
BEFORE it multiplies into `diffuseColor`, or the material's own colour and
vertex factors would be divided out of the blend. Rather than transcribe
three's `map_fragment` (version-brittle), the slot carries three's OWN
`ShaderChunk.map_fragment` read at runtime and splices one line into it.
`verify-lod-fade` gates the assumptions: the spliced line exists, occurs
exactly once, and `sampledDiffuseColor` is declared before it.

### 3.2 The relief snap, stated honestly

A texture blend does not morph geometry. What it does is stop TWO cues changing
on one frame. And above `TILES.demMaxZoom` (15) the z16/z17 geometry is a CROP
of the z15 DEM, so the great majority of near-field refines change no relief at
all and the blend covers them completely. Below it (z13→z15, mid-field) the
surface genuinely moves; there the swap still happens on one frame, with the
texture already matching across it.

### 3.3 The SwiftShader caveat, and how the fade was photographed anyway

This container advances the frame clock ~1000 ms per frame, so a shipped 250 ms
blend completes INSIDE a single frame and cannot be captured — the crossfade is
invisible here BY CONSTRUCTION, not because it is absent. The `slow` leg pins
`fadeSec` to a few seconds through the dev override, which spreads the SAME
code path across several frames. Because every fixture imagery tile is stamped
with its own "z / x / y", a child rendering the PARENT's stamp IS the crossfade,
photographed. The fade's real DURATION is a user-machine number.

### 3.4 Measurement (fixture, `scripts/r24-d-lodprobe.js`)

A serpentine is unaffordable at ~1 fps, so the probe forces the same events
with an ALTITUDE LADDER at a pinned Powell lat/lon: descending shrinks
`distance / tileSize` and refines the field, climbing merges it back — exactly
the pair `_loadSubTiles` / `_removeSubTiles` implement. It reads A's
`__flyTerra.lod()` and D's `__flyStats.terra.fades` side by side.

**A DISCARDED RUN, recorded so it is not re-used.** The first RED table (31
refines / 31 hard swaps) was taken on fixture rev `r24-e.2-sierra`, where
route-fulfilled imagery kept three-tile's download queue saturated and the
quadtree walk froze wholesale at z6 (E's measurement; recon T3). That table is
a measurement of the freeze, not of LOD behaviour, and is void. Every number
below is on `r24-e.3-imgsource` with A's pacing switches on — including
`walkWhileSaturated`, which fixes the freeze at the root, so refine counts on
the integrated tree differ from anything measured on `4bedab1`.

**A's coupling, stated plainly:** `keepResident` removes the frustum-exit
merges, so LOD_CROSSFADE's measured value is on REFINES and on whatever merges
survive under memory pressure. The two fixes compose — A stops the swaps that
should never have happened, D softens the ones that must.

### 3.5 Numbers (fixture, Powell altitude ladder 4000→1600→800→380→1600→4000 m,
640×360, A's pacing switches ON, `r24-e.3-imgsource`)

| leg | pin | A: refine / merge / replacedOnScreen | D: hardSwaps / faded | active / peak | resident | pageerrors |
|---|---|---|---|---|---|---|
| **flag OFF (RED)** | none | 16 / 0 / 0 | **20 / 0** | 0 / 0 | 39 → 70 | 0 |
| flag ON, shipping | `{enabled:true, skipBootMs:1500}` | **NOT MEASURED** — `bootFly` timed out at its 180 s `waitForFunction` under load; the run was never repeated before the session ended | | | | |

The ON row is blank and stays blank. It is not "presumed green": the only ON
evidence on this tree is the first, discarded attempt at `fadeSec: 6`, whose
`active 12` reading was the clamped-dt artefact of §3.6 rather than a fade
measurement. Owens `drawCalls`/`triangles` were added to the probe for exactly
this leg and are likewise unmeasured.

The RED is unambiguous: **20 refines, 20 of them single-frame hard swaps, zero
blended**, and `skip.disabled: 20` proves every one was un-faded because the
flag is off rather than because a guard fired. `merge 0` across the whole
ladder is A's `keepResident` working — the frustum-exit merges are simply gone
— which is why D's measured value is on REFINES.

A's counter reads 16 where D's reads 20 because A's wrapper increments at the
top of `_loadSubTiles` (including the `z < minLevel−1` early path) and is reset
by `__flyTerra.reset()` at the start of the ladder, while D's accumulates from
boot. The four-count delta is the four refines between boot-settle and the
reset. Not a disagreement.

### 3.6 What the first ON leg found, which is worth more than the leg

The first ON attempt read `active 12` STUCK, `faded 3`, `skip.concurrency 9`.
Neither number is a bug in the fade; both are facts nobody had written down:

1. **The fade clock rides a CLAMPED dt.** FlyScene's −50 block computes
   `const dt = Math.min(delta, 0.05)`, so `tickLodFades` advances 50 ms per
   RENDERED FRAME whatever the wall clock does. On SwiftShader at ~1 fps a
   `fadeSec: 6` probe pin is 120 frames — two minutes of wall time per blend,
   which no ladder step waits for. This is the right behaviour for a crossfade
   (a blend wants a frame COUNT; a "250 ms" fade that renders twice is a
   two-step pop, i.e. the defect), so the constant's comment now says so and
   the probe pins a frame count instead of a duration.
2. **`maxConcurrent` counts MATERIALS, and a refine arms four.** 12 was
   therefore only THREE concurrent refines, and the ladder denied 9 of 19
   refines a fade with `skip.concurrency`. Raised to 32 = 8 concurrent refines.
   The bound is not about draws or samplers — the sampler is on the tile
   program either way and an idle fade skips its branch. It bounds RETAINED
   PARENT TEXTURES: a refine keeps its parent's map alive past `unloadModel()`
   until the last child finishes, so 32 materials ≈ 8 retained 256² tile
   textures ≈ **2.7 MB** against the 300 MB texture gate.

That the enumerated skip reasons made both diagnosable in one read is the
argument for shipping them; a bare "0 fades" would have been a bisection.

## §3x M2 — old header (kept so the section numbering does not shift)

See §1.3 for the RED. Design: `mode: 'parentBlend'` — children are added
holding the PARENT's texture through a clip-UV transform (each child covers one
quadrant of the parent's [0,1] map) and cross-dissolve to their own map over
`fadeSec` ≤ 0.3 s. Zero extra draws, one extra sampler on the tile program →
tile FINAL key `-d24` + prewarm entry in the same commit. The alternative
(keep the parent drawn, dither it out) costs a transient draw per in-flight
quad and, per the archived R22.1 B3 caveat, an ordered dither under SMAA-only
AA reads as shimmer — the exact artifact class this round removes.

Boot is fade-free (`skipBootMs`, reveal timing frozen); warps skip the fade
(`WARP.flashMs` 250 already masks the cut).

---

## §2.5 M1 — AERIAL_LAW, as wired

The law is not a library this round; it is evaluated.

**High tier — the post pass.** `AerialPerspective.jsx` gains a LAW variant of
its shader, chosen ONCE at construction from a module const so production and
the PREWARM twin cannot compile different programs (the Effects.jsx el()/raw()
rule). Everything structural is unchanged — the depth reconstruction, the
reversed-depth DETECTION (never assumption: three downgrades the request when
`EXT_clip_control` is missing and a hard-coded flip would invert the world on
exactly those devices), and both early-outs. What changes is the four lines
that WERE the atmosphere:

```
  old:  mix( color, uHazeColor, uMaxMix * smoothstep(uBand, dist) * exp(-h/H) )
  new:  atmoApply( color, vec3( dist, h, cosSun ) )
```

`dist` is `length(viewPos)` and `cosSun` divides the same ray by the same
`max(dist, 1e-4)` that `atmoPack` uses in the vertex stage, so the two
evaluators measure the same ray BY CONSTRUCTION rather than by agreement.

**Medium/low — the per-material term**, injected in `applyHillshade`
immediately before `<dithering_fragment>`, the last chunk in three's fragment.
That placement is the load-bearing decision. It deliberately does NOT touch the
after-fog lines the base fade patch and C's `LINEAR_HAZE` own, and it buys two
things:
- the 16–55 km tile band is retired by **amplitude** — FlyScene writes its max
  to 0 under the flag — rather than by editing another owner's injection, so a
  merge in either order composes;
- the 60–120 km rim melt is **absorbed**: by the time the edge fade has mixed
  to `uEdgeColor` the law's transmittance is already ~0, so the final colour is
  the law's LINEAR inscatter either way. That is what "fold the rim melt into
  extinction → 1" means in code.

**The tier split is what makes "one law" true at the pixel** rather than only
in the source: at high the post pass reads the law and the materials read 0; at
medium/low the reverse. Never both, so nothing double-hazes. The two gates
share a uniform NAME (`uAtmoStrength`) in two different programs, which is
exactly the shape of the thing.

**The fleet pin is split out of the tier gate.** The law runs at medium/low, so
`__flyAerialOverride` must still reach it while the tier gate must not; the
rebuilt `aerialGate` expression is bit-identical to R21's.

**A8** rides the EXACT `SAT_BUILDINGS.night` curve the city windows come up on —
exactly 1 at `frac ≥ dayFrac` (noon keeps 0.55 bit-for-bit), exactly 0 at deep
night. CPU multiply on an existing uniform: no shader text, no key move, and
its own flag (`AERIAL_LAW.nightRamp`) so it can ship without the law.

**Keys.** No new key expression exists in D's code. C's `hillKey(lodFade)` =
`r24VariantKey('world-bend-fade-hill-r19', [[e],[f],[a],[l]])` carries both of
D's tokens — 'a' for `AERIAL_LAW.enabled`, 'l' for the crossfade slot — in a
fixed order, which is what stops two owners emitting one text under two
mutually exclusive key expressions (the R4 wrong-cached-program defect).

**Flag-off identity is proven on the generated TEXT**, not on tokens:
`verify-atmo-law` §7 flips `AERIAL_LAW.enabled`, compiles `applyHillshade`
twice against a stub shader, and asserts *flag-on VERTEX minus the law ===
flag-off VERTEX* and the same for the fragment, character for character — plus
that the ten law uniforms are wired BY REFERENCE to the shared block
(`shader.uniforms.uAtmoBeta === atmoUniforms.uAtmoBeta`), i.e. the post pass
and the materials read one set of numbers rather than two that agree.

**NOT BUILT this round, and reported as such rather than implied:** the content
slot (`applyBendAnchorSat` / `…SatSkyline`) and the air/anchor variants
(traffic, monuments, veg, parcel homes, town glow, roads, water) do not yet
carry the law. At high tier the post pass already covers every depth-writing
one of them from the same depth buffer, so the visible gap is medium/low
content standing on hazed ground. Each is a separate `-a24` key with the same
two-entry-point dispatch (`atmoApply` for opaque, `atmoExtinct` for additive —
inscatter into an ADDITIVE layer would ADD light where the atmosphere should
remove it).

## §4 Frozen gates touched

| gate | state | note |
|---|---|---|
| `world-bend-fade-hill-r19` (FINAL tile key) | MOVES under either D flag | through C's shared `r24VariantKey` with fixed token order e/f/a/l; all-off is the verbatim R19 key, proven by gate |
| every horizon pixel gate (`verify-rim`, `verify-sat-depth`, `verify-aerial`, `verify-neon-alt`, `verify-sat-night`, `verify-dusk`, `verify-edge-fx`) | RE-BASELINE PENDING, one batch with C's L1 | not executed by D; the batch is C's, with E's FIXTURE column |
| `verify-aerial`'s `__flyAerialOverride` pin | STILL HONOURED | the pin is split out of the tier gate but still multiplies both the post gate and the per-material gate, so a pinned frame is strength 0 = the bit-identity early-out |
| Owens ≤ 261 / satellite ≤ 375 / toy ≤ 480 draws | UNCHANGED BY CONSTRUCTION, measurement pending | neither feature adds a mesh: the law is ALU on programs that already run, and the crossfade blends geometry that was already drawn |
| `verify-flicker` bound of 12 | untouched | nothing here touches emissives or bloom |
| `PREWARM` warm set | follows automatically | prewarm builds through the same `applyHillshade(m, HILLSHADE, attachLodFade(m))` and the same `AerialPerspectiveEffect` constructor |
| `DELETED_UPSTREAM_LINES` (A's vendor budget) | D spends 0 | D's four vendor hunks are +68 / −0, gated |

## §4.5 M3 — SKY_PROCEDURAL: NOT BUILT

Reported honestly rather than half-shipped. It ships OFF regardless (plan §0
ruling 5), it is the only item of mine with no user-visible defect behind it —
L10 is a `[low]` hypothesis, not a measured symptom — and the session went to
the two items the user's own report named. The design, so a later round does
not re-derive it:

- Analytic sky in the dome fragment (Preetham/Hosek-lite, ~40–60 ALU per sky
  pixel, 0 draws) from `runtime.sun`, replacing four cross-faded photographs
  and the 0.45 background dip per cut. The dome material is a raw
  `ShaderMaterial` with no `customProgramCacheKey`, so the key discipline is a
  PREWARM entry, not a registry bump.
- The same function OUTPUTS the rim/inscatter colour that `setAtmoLaw` is fed,
  which is the point: today the rim triple is a five-keyframe table
  (`SKY.altAtmo.tod`) that can drift from what the HDRI shows, and every
  mismatch has a compensating term (the golden lobe, the texel cap, the dip,
  the star clamps). With the sky and the atmosphere reading one function they
  agree by construction and every compensator can be retired.
- HDRIs kept as IBL only (or PMREM the procedural sky on a low-res target every
  few minutes — that trade needs a GPU measurement this venue cannot make).
- Weather stays on the existing overcast lid; stars/moon layers unchanged.

Cost is a GPU number (sky pixels are ~30–50 % of the frame at altitude), so it
could not be ranked here even if it had been built.

## §4.9 M4 — GO / NO-GO

| feature | gates | ceilings | new lazy compiles | verify-flicker | fixture A/B | RECOMMENDATION |
|---|---|---|---|---|---|---|
| **A8** (night ramp) | verify-atmo-law §6, 4/4 as a pure function | none touched (uniform-only) | none possible (no shader text, no key) | untouched | not needed — noon multiplier is EXACTLY 1, so noon is bit-identical | **FLIP ON** |
| **AERIAL_LAW** | verify-atmo-law 41/41 incl. GLSL≡JS at 4,160 points and flag-off text identity | unmeasured here; adds no mesh | prewarm builds through the same `applyHillshade` + the same Effect constructor | untouched (nothing touches emissives or bloom) | **NOT CAPTURED** | **ON only after the horizon re-baseline batch runs with a fixture column, and after one fixed-pose Owens draw row.** Not before. |
| **LOD_CROSSFADE** | verify-lod-fade 51/51 (Fable's regex fix included) | Owens row unmeasured | tile program is prewarmed with the slot | untouched | RED captured, ON leg NOT captured | **HOLD at OFF for this round** unless the certification run's browser leg lands the ON row. |
| **SKY_PROCEDURAL** | — | — | — | — | — | **OFF** (not built; design in §4.5) |

What each recommendation rests on, and what it does not:

- **A8 is the only unconditional GO.** It is a CPU multiply on a uniform that
  already exists, on a curve that is already in the tree, and its identity at
  noon is exact rather than approximate — `1 − clamp01(1 − frac/0.3)^1.5` is
  EXACTLY 1 for every `frac ≥ 0.3`. There is nothing for a pixel gate to catch.
  It closes a real defect (0.55 of the deep-night rim mixed into distant
  terrain, with no sun term) that R23 already ruled a taste question rather
  than a regression, so it is also the one item where "ship it and look" is
  cheap to undo.
- **AERIAL_LAW's evidence is structural, and that is not sufficient on its
  own.** What is proven: the law is one function, the GLSL text equals the JS
  mirror to 0.00e+0 relative error at 4,160 points, flag-off is byte-identical
  in generated text / uniforms / key, the two evaluators never both run, and
  the four REDs are real and computed rather than eyeballed. What is NOT
  proven: what it looks like. No fixture pixel A/B was captured at any
  canonical pose, and every horizon pixel gate moves by construction. Flipping
  it ON without the re-baseline batch would be flipping a look nobody has seen.
- **LOD_CROSSFADE has a clean RED and no GREEN.** 20 refines, 20 hard
  single-frame swaps, 0 blended, `skip.disabled 20` — the defect the user
  reported, counted. The ON leg timed out in `bootFly` under load and was never
  re-run, so "the blend happens, on which swaps, how many at once" is
  unmeasured on this tree. The mechanism is gated structurally and the flag-off
  identity is proven, but a feature whose whole claim is visual should not ship
  on a RED alone.
- **What only the user's machine can settle, for both Level B features:** every
  ms and every fps; whether the 250 ms blend reads as smooth or as mush at 60
  or 144 Hz; whether the law's cruise clearing (mix 0.55 → 0.14 at eye 9 km,
  §2.4) reads as "the air thinned" or as "the haze broke"; and whether the
  crossfade actually removes the reported "terrain tiles swapping" or merely
  moves it to the relief snap that a texture blend cannot morph (§3.2).

## §4.95 The AerialPerspective import blocker — how it happened, and what it voids

**The defect.** `components/fly/AerialPerspective.jsx` used six symbols it never
imported: `ATMO_GLSL_DECL` and `ATMO_GLSL_FRAGMENT` (module-scope template
literal), `AERIAL_LAW`, `atmoUniforms`, `getAtmoLaw`. Because two of them are
evaluated in a module-scope template literal, the ENTIRE `components/fly` chunk
threw at evaluation: "Application error: ReferenceError: ATMO_GLSL_DECL is not
defined", zero canvas, `__flyBoot` never defined, in both styles. Introduced by
`bc408e7`, present through `6dc8817`.

**Why it happened, precisely.** The wiring was applied by a python patch script
whose edits are `str.replace` calls. Five of the six had an `assert old in s`
in front of them. The import edit did not. Its anchor was

```
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3, Color } from 'three';
```

and by the time the script ran, the C merge (`f7a3137`, 16:38) had already
added `SRGBColorSpace` to that second line and a `DEPTH_FIX, LINEAR_HAZE`
import under it. The anchor no longer matched, `str.replace` returned the
string unchanged, and with no assertion the script reported success. **Every
mechanical edit needs its own assertion; the one that did not have it is the
one that broke.** That is the lesson, and it is not a subtle one.

**Why no node gate caught it.** `verify-atmo-law` §8 reads
`AerialPerspective.jsx` as TEXT (regex over the shader strings), and §7
compiles `applyHillshade`, which lives in a different module. Nothing in D's
gate set imports or evaluates `AerialPerspective.jsx`. The same blind spot C's
`verify-c-flagoff` had, and the reason Fable's new `GET / 200` merge-acceptance
step is the right fix at the process level. An `eslint --rule no-undef` over
the round's changed files is the cheap gate-level fix.

**What it voids, from the timestamps.**

| artifact | written | tree | verdict |
|---|---|---|---|
| `lod-off.json` — the RED (20 refines / 20 hard swaps / 0 faded) | 16:23:06 | after `81424b2` (16:19), **before `bc408e7` (16:45)** | **VALID.** The app booted; the breakage did not exist yet. |
| `lodprobe-on.log` — the flag-ON leg | 16:52:06 | after `bc408e7` | **VOID, and mis-attributed.** |

**A correction I owe the record.** I reported the ON leg as having "timed out
in `bootFly` under load". It did not. `bootFly` waits on `__flyBoot`, and
`__flyBoot` is never defined when the chunk throws at module evaluation — so
the 180 s `waitForFunction` timeout at 16:52 is the *signature of this very
defect*, on a tree I had broken seven minutes earlier. Contention was a guess,
and it was wrong. The ON leg was never booted, on any tree, at any time.

**Also found by the same eslint sweep, NOT mine and NOT fixed here** (Fable's
instruction was to change nothing else): `components/fly/FlyScene.jsx:373`
uses `offsetUnits(gl, -1)` without importing it — C's `fd7d28d` (SHADOW_CALM /
T11). It is exported from `lib/fly/toy-world/world-bend.js:381` and imported
correctly in `SatTintLayer.jsx` and `prewarm.js`, so the fix is one name in
FlyScene's existing world-bend import block. It sits inside a `useMemo`
callback rather than at module scope, so it throws when SatShadowCatcher builds
its material rather than at chunk evaluation — quieter than mine, and still a
ReferenceError.

**Known-red on this branch, deliberately not touched:** `verify-lod-fade`'s
`fadeSec is inside the charter bound` gate reads 6000 ms, because its regex
matches the `fadeSec: 6` quoted in the block COMMENT before the real
`fadeSec: 0.25` key. Fable has already fixed it on integration (anchored to the
key line); duplicating the fix here would only make a conflict.

## §5 Decisions

- **D-1. AERIAL_LAW is SATELLITE-scoped.** Toy/Neon keeps `TOY.haze` (a single
  4-13 km law plus the void melt) and writes `strength` 0 — the IEEE-exact
  identity path. Every symptom L4 lists is a satellite symptom; changing Neon
  would move every certified Neon pixel gate for no named defect. Recorded so
  a future round can revisit it deliberately rather than by accident.
- **D-2. `atmoExtinct` for additive materials.** Applying inscatter to an
  ADDITIVE layer would ADD light where the atmosphere should REMOVE it. The
  law therefore has two entry points, dispatched on `material.blending` at
  patch time (no call-site signature changes), with their own cache keys.
- **D-3. The law owns its own sRGB→linear decode** rather than reading C's
  setters (see §2.2), so a merge in either flag order is correct.

- **D-4. AERIAL_LAW is scoped to the tile material + the post pass this round.**
  The content and air/anchor variants are designed, dispatched
  (`atmoApply`/`atmoExtinct` on `material.blending`) and un-built. Reported as
  a gap in §2.5 rather than implied by "one law".
- **D-5. The per-material term lands before `<dithering_fragment>`, not in the
  after-fog slot.** The after-fog slot is owned by the base fade patch and, this
  round, by C's `LINEAR_HAZE`. Injecting one chunk later retires the old tile
  band by amplitude instead of by editing another owner's lines, so the merge
  composes in either order and the rim melt is absorbed for free.
- **D-6. `maxConcurrent` bounds retained parent TEXTURES, not draws.** 32
  materials = 8 concurrent refines ≈ 2.7 MB against the 300 MB texture gate.
  The previous 12 was silently only three refines and denied 9 of 19 a fade.

## §6 Open risks

- **A merge-order hazard I could not close from here.** C's `LINEAR_HAZE`
  decodes `uEdgeColor` to linear at the setter. With C's flag OFF and mine ON,
  the edge fade still targets a raw-sRGB colour while the law targets linear —
  but the law saturates BEFORE the fade band, so the fade mixes a colour that is
  already the law's, and the visible result is the law's. With both on they
  decode the same triple through the same curve. Neither ordering is wrong; the
  case worth a fixture pixel A/B at close is C-off / D-on at the 60–120 km rim.
- The per-material term interpolates `(d, h, cosSun)` linearly across a
  triangle. For large distant terrain triangles the cosSun component is an
  approximation; the Mie lobe is broad (g 0.76) so this should read as a
  slow gradient, but it is a taste item for the user checkpoint, not a
  measured fact.
- ALU cost of the per-material term and of a procedural sky is a GPU number.
  Not measurable here (§9).

## §9 Could not measure here

- Every ms/fps/ALU claim. SwiftShader at ~1 fps cannot rank shader cost.
- Live tile behaviour (Esri/OpenFreeMap 403). LOD pop counts and crossfade
  behaviour are measured on E's offline fixture only; the live serpentine is
  the user's machine.

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

(numbers: §3.5, filled from the probe runs)

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

## §4 Frozen gates touched

(populated as work lands)

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

## §6 Open risks

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

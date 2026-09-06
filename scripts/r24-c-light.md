# R24 C LIGHT — "one sun, one color space, edges that hold still"

Agent C of Round 24 "Smooth World". Worktree `/home/user/skyloom-r24-c`, branch
`r24/c`, off `6116fc5` (main + W0 scaffolding). Charter: FLY_ROUND24_PLAN.md §3
C LIGHT. Evidence ids: **L1 L2 L3 L5 L6 L7 L8 · WB-7 · FL-07 FL-12 · T6 T7 T11
T12 T13** in `scripts/r24-recon.md`.

## Venue truth (read before any number below)

This container has **no GPU worth the name** (ANGLE/SwiftShader, ~1 fps under
the app's load) and **no tile egress** (Esri / OpenFreeMap / adsb.lol 403). So
every number in this ledger is one of exactly three kinds, and each is labelled:

- **[closed-form]** — arithmetic over the shipped constants and the shipped
  shader text, evaluated in node. These are as hard as a GPU measurement,
  because the quantity is a pure function of numbers already in the tree.
- **[source]** — a proof about the generated shader text / material state /
  pass list, produced by running the real module and diffing strings.
- **[pending fixture]** — needs E's offline world fixture (fixed-pose pixel
  A/B on SwiftShader, which IS bit-stable) or the user's machine. Stated as
  such, never guessed.

**"Could not measure here"** has its own section at the end. No fps / ms /
stutter / tearing number appears anywhere in this ledger.

---

## M1 — LINEAR_HAZE (recon L1) — "the horizon that cannot match by construction"

### RED [closed-form]

`node scripts/r24-c-linear-haze-proof.mjs` (committed).

The defect is arithmetic, not perceptual, so it is provable without a GPU. At
the ground fade band's END the terrain fragment is **exactly** `uEdgeColor`
(the mix factor is 1); the SkyDome band immediately above it is **exactly**
`Color.setRGB(rim, SRGBColorSpace)` (SkyDome.jsx:30) and the scene fog is the
same (FlyScene.jsx:1439). Both land in the same linear HalfFloat buffer and pass
through the same ACES curve and sRGB encode, and they are adjacent pixels so the
grade / vignette / bloom terms cancel in the DELTA. The rim-seam luma delta is
therefore a closed-form function of ONE authored triple.

| authored triple | RED Δluma /255 | RED ΔRGB /255 | GREEN Δ |
|---|---|---|---|
| `SKY.altAtmo` rim @frac 0.0 `#101a30` (deep night) | **76.3** | [60, 79, 99] | 0.000 |
| `SKY.altAtmo` rim @frac 0.14 `#4a4258` (twilight) | **99.2** | [98, 100, 91] | 0.000 |
| `SKY.altAtmo` rim @frac 0.3 `#d8b48a` (golden) | **19.9** | [8, 22, 43] | 0.000 |
| `SKY.altAtmo` rim @frac 0.5 / 1.0 `#c6d7e8` (day/noon) | **9.3** | [13, 9, 5] | 0.000 |
| `GLOBE.rim.satellite` `#c6d7e8` | **9.3** | [13, 9, 5] | 0.000 |
| `GLOBE.rim.toy` `#1a2246` (Neon rim) | **89.4** | [84, 90, 100] | 0.000 |
| `TOY.haze.color` `#1a2246` | **89.4** | [84, 90, 100] | 0.000 |

Worst RED = **99.2/255 at twilight**; the daylight satellite case is 9.3/255,
which is the recon's "~+15% luma" read confirmed to the digit. GREEN is
**0.000 by construction** — the terrain target and the dome band become the
same number under the same curve.

### Mechanism

`three.module.js:7585` picks `ColorManagement.workingColorSpace` as the output
color space for **any bound render target**, so `<colorspace_fragment>` is an
identity once `FlyEffectComposer` owns the render (HalfFloat RT,
FlyEffectComposer.jsx:130). The world-bend registry's "OUTPUT-space (raw sRGB)"
premise (world-bend.js:268) was true pre-R13 and has been false since. Five
setters (`setEdgeFade`, `setDepthHaze`, `setEdgeFadeRGB`, `setDepthHazeRGB`,
`setSatContentHaze`) plus `AerialPerspective.update`'s `uHazeColor` wrote raw
sRGB components straight into that linear buffer; fog, SkyDome, VoidFloor did
not. Under ACES the mismatch survives, and dark rims are worst (a dark sRGB
value decodes to a tiny linear value, but the raw one stays large — which is
why twilight/night are 4–10x the daylight error).

### Fix

`LINEAR_HAZE.enabled` (C's pre-seeded block). One helper in world-bend.js
(`srgbToLinear` = three's transfer function verbatim, `hazeC` = flag-gated
decode) applied at all five setters, and `SRGBColorSpace` named in
AerialPerspective's `setRGB`. **No GLSL change, no cache-key move, no draw, 0 ms.**

`getRimColor()`'s documented contract is "raw sRGB 0..1" and SatVegLayer
(SatVegLayer.jsx:421-425) decodes it itself with `SRGBColorSpace` for the canopy
haze — so handing it the now-decoded uniform would DOUBLE-decode the one content
layer that already got this right. The authored triple is therefore stashed
(`_rimRaw`) and `getRimColor` reads the stash. With the flag off the stash and
the uniform hold identical numbers, so that read is byte-identical.

### The re-tune the charter budgeted: REFUSED, with a reason

The charter allows re-tuning `SKY.altAtmo` / `TOY.haze` / `GLOBE.rim` after the
decode. **Any gain ≠ 1 on the decoded target re-opens the exact seam the fix
closes**, because the fog and the dome read the same authored triple through a
decode this agent does not own and cannot move with it. The correct post-fix
value of the seam is 0.000 and it is 0.000 *only* at gain 1. So no constant
moved, no knob was added, and the visible consequence — the Neon rim melts to
`#1a2246`-as-authored instead of to a ~89/255-brighter value — is a **user
checkpoint (plan §6.5), not a bug to tune away**.

### Frozen gates touched

Every pixel gate that samples a horizon moves. This is the plan §0 ruling-4
ONE-TIME sanctioned re-baseline batch: `verify-rim`, `verify-sat-depth`,
`verify-aerial`, `verify-neon-alt`, `verify-sat-night`, `verify-dusk`,
`verify-edge-fx`. To be done in ONE batch with D's `AERIAL_LAW` if D's lands
green (Fable coordinates), with a FIXTURE column from E and the live column
marked "user machine re-baseline pending". **[pending fixture]**

### Gate handed to E — `verify-linear-haze`

- Bound: `|luma(terrain @ fade-end) − luma(dome band)| ≤ 3/255`.
- Poses: satellite Owens FL120 (the EMPTY control — no content between the
  band and the dome) and Neon NYC FL260; **noon AND deep night** (the deep-night
  leg is the one that goes 76.3 → 0.000).
- RED leg: `LINEAR_HAZE.enabled = false` on the same tree, same pose.
- The node proof above is the gate's arithmetic oracle: E's browser numbers
  should land within the tone-curve quantisation of these.

### Coordination note (Fable relay, D ATMOS)

D's `AERIAL_LAW` decodes the raw sRGB rim triple to linear **itself** and never
reads `uEdgeColor` / `uHazeColor`, so the two fixes cannot double-decode in
either merge order, and under D's flag the SATELLITE rim-melt line routes
through D's colour while toy keeps the legacy `uEdgeColor` line verbatim. **The
raw triple D reads is the authored-sRGB stash** this milestone introduced
(`_rimRaw`, surfaced by `getRimColor()`); it is NOT the uniform, which is now
decoded. Anyone moving `getRimColor` moves D's input too.

---

## M2 — ONE_SUN (recon L3) — "four suns in one frame"

### RED [closed-form]

`node scripts/r24-c-one-sun-proof.mjs` (committed). Each consumer's own formula
is re-evaluated verbatim from its call site at three real solar states, and the
pairwise angular disagreement is reported in degrees. Constants read out of the
tree: `SKY.sunDirection = [0.555, 0.742, 0.377]` (the kloofendal HDRI's
brightest texel), `HILLSHADE.el ∈ [0.15, 0.9] rad` = **[8.6°, 51.6°]**,
`SAT_SHADOWS.minElRad 0.15`, `SKY_LIVE.nightSky.moonElRad 0.6`.

**tier medium / low — the headline. The key light never moves at all:**

| solar state | key↔hill | key↔dome | key az/el |
|---|---|---|---|
| noon, el +68° | **37.1°** | 35.1° | −56 / 48 |
| dusk, el +2° | **119.4°** | 125.6° | −56 / 48 |
| night, el −14° | **109.6°** | 128.1° | −56 / 48 |

The key azimuth is the **same −56° at every hour of every day** — it is the
HDRI's baked sun, because the position write lived inside the high-tier shadow
branch (FlyScene.jsx:1699). At dusk the ground's hillshade and the scene's key
light are **119° apart**: the terrain is lit from one side of the sky and every
building from the other. That is the "buildings pasted on photo ground" read,
quantified.

**tier high — the key moves, but on a clamped elevation:**

| solar state | key↔hill | key↔dome | key az/el |
|---|---|---|---|
| noon, el +68° | 0.0° | **16.4°** | 3 / **52** |
| dusk, el +2° | 0.0° | 6.6° | 149 / 9 |
| night, el −14° | 0.0° | **22.6°** | 172 / **9** |

At summer noon the key is stuck at the hillshade band's ceiling (51.6°) while
the sun is at 68°; at night it sits 8.6° **above the horizon at the solar
azimuth** — i.e. it is the set sun, merely re-coloured, while SkyDome hangs the
moon disc anti-solar. The two "moonlights" were **22.6° apart** and on opposite
sides of the sky in azimuth once the moon term is considered.

### Mechanism

Nothing owned a "sun state → all materials" contract. The directional's position
was written only inside `else if (sun && satShadowRef.current && style ===
'satellite')`; `MOODS.satellite.lightDir` is otherwise the whole story.
`runtime.sun.el` is **not the sun's elevation** — `computeSun` clamps it into the
hillshade band, which is a relief-legibility device — so every consumer that read
`el` inherited a lighting fact that was really a shading preference.

### Fix (flag `ONE_SUN.enabled`; satellite only — toy has no live `runtime.sun`)

1. **Key follows `runtime.sun` at EVERY tier.** The branch condition becomes
   `(ONE_SUN.enabled || satShadowRef.current)`; only the shadow-CAMERA props keep
   the high-tier gate (they are JSX driven by `satShadowsOn`), so this adds no
   shadow pass anywhere. Flag off = the R21 condition character-for-character,
   and the position arithmetic is the same expression factored through
   `kx/ky/kz` (same operand order, IEEE-identical).
2. **The key's elevation becomes the TRUE one** (`asin(sinEl)`), floored at
   `SAT_SHADOWS.minElRad` **only while the shadow camera casts** — that floor is
   a statement about ortho-frustum depth precision, not about light.
3. **An explicit moon key at night.** `moonDirFromSun` (anti-solar, the same
   vector SkyDome hangs the moon disc on) is blended into the key direction over
   `[0°, −8°]` of TRUE elevation and renormalised. **Colour and intensity are
   deliberately untouched** — `SKY.hdriCycle.keyColor.night` is already
   moonlight-cool and `verify-sun`'s noon/midnight intensity contract therefore
   holds by construction. **A second `directionalLight` was REFUSED**: it moves
   `NUM_DIR_LIGHTS` 1 → 2, which changes three's program key for *every lit
   material in the scene* and would mint a full recompile storm plus a prewarm
   mismatch — exactly recon WB-4. One key light that is honestly the moon after
   dark is the cheap, correct answer.
4. **Hillshade weight keyed on TRUE elevation** — `dayK 0.65` at ≥ 40°, 1.0 at
   ≤ 15°, smoothstepped. Written as `stashed base × weight` from both writers
   (the `sunBaseRef`/`ocDim` idiom) so the style/tier effect and the day-cycle
   cadence can never compound. Weight is exactly 1 with the flag off.
5. **Satellite monuments MeshToon → MeshLambert vertexColors**, in BOTH
   representations (`LandmarkMonuments` archetypes and the `MonumentModels`
   marquee batch) so the R20 interchangeability invariant holds. Same draw
   count, same `DoubleSide` policy, same value palette.

### GREEN [closed-form]

| state | tier | key↔dome | key↔hill | note |
|---|---|---|---|---|
| noon +68° | high & medium | **0.0°** | 16.4° | the 16.4° IS the hillshade's declared [8.6°, 51.6°] clamp |
| dusk +2° | medium | **0.0°** | 6.6° | same clamp |
| dusk +2° | high | 6.6° | 0.0° | the shadow-camera floor, declared |
| night −14° | any | n/a | 137.0° | `moonK == 1`: the key **IS** `moonDirFromSun(az)`, 0.0° from it |

The contract `verify-one-sun` should assert (handed to E below) is therefore
**not** "all four vectors are identical" — that would be a false contract, because
two of the clamps are deliberate and documented. It is:

1. **azimuth** of key, hill and dome are equal to 1e-6 at every tier, *except*
   where `moonK > 0`;
2. key elevation == true solar elevation, floored at `SAT_SHADOWS.minElRad`
   only while the shadow camera casts;
3. hill elevation == `clamp(true, [HILLSHADE.minElRad, maxElRad])`;
4. at `moonK == 1` the key is `moonDirFromSun(az)` exactly;
5. `water` reads the same directional as `key` — there is no second light in the
   rig (FlyScene.jsx:1806-1827), so satellite water's MeshPhong specular follows
   for free.

### The R20 §5b.4 Taj night residual — closed in the same move

R20 recorded it and named its own cause: *"the excess is the satellite night key
itself (MeshToonMaterial takes no envMap)"*. `three` r185 hands `scene.environment`
to Standard / Lambert / Phong only (`WebGLPrograms.js:60-63`), so a Toon monument
was lit by one directional and nothing else while every OFM building beside it
took the HDRI — the marquee read **+25.0 blue-minus-red at night against a +18.4
baseline**. Lambert takes that IBL. The gradient ramp is dropped with the
material class (a Lambert has no `gradientMap`); the banding it provided is
carried by the R18 vertex-colour value modulation the geometry already ships.
**Coupled to `LAMBERT_ENV`** (recon WB-7): three's Lambert defaults are
`combine = MultiplyOperation`, `reflectivity = 1`, i.e. a full-strength mirror
lookup of the environment — a monument left at that default would take a
view-dependent sky tint the buildings around it are about to stop taking. Both
monument materials therefore read `LAMBERT_ENV.reflectivity` when that flag is on.
**[pending fixture]** for the night blue-minus-red re-measurement at the Agra pose.

### `verify-monuments-sat` — the sanctioned evolution, read honestly

The harness is FROZEN and I read all 208 lines before touching anything. **It
asserts nothing about the material**: its gates are pool mounts, placement
distance, raw-DEM height, letter lift, a Δdraws budget and the draw ceiling —
all of which the Toon → Lambert swap leaves **numerically unmoved** (same draw
count, same instancing, same geometry, same anchor bend). So the sanction is not
spent on moving a number; it is spent **adding** the contract the harness never
had:

- `satellite monument material is MeshLambert with vertexColors` (RED on the
  flag-off tree: it is `MeshToonMaterial`);
- `satellite monument material takes scene.environment` (RED: Toon gets none);
- `marquee and archetype materials are the same class` (the R20 invariant, never
  previously pinned);
- toy monument material is still `MeshToonMaterial` with its 3-step ramp (the
  guard that keeps this satellite-only).

That is written up for E; the existing eleven gates keep their numbers.

### Cost

0 draws, 0 new programs at medium/low (the directional already existed and its
position is a uniform), 0 ms. The monument swap trades three toon-ramp texture
fetches for the Lambert env chunk on ≤ 15 draws.

### Frozen gates touched

- `verify-sun` — noon/midnight **intensities** unmoved by construction (this
  milestone writes no intensity and no colour). Its direction assertions, if
  any, need re-reading against the audit. **[pending fixture]**
- `verify-sat-depth` hillshade A/B margin (> 2/255) — the daytime hillshade is
  demoted to `dayK 0.65`, so the margin shrinks by up to 35 % at a high sun. This
  is the one knob in ONE_SUN that trades a frozen margin for honesty; it is a
  named user-checkpoint value. **[pending fixture]**
- `verify-monuments-sat` — additive only, see above.
- Medium tier leaves the R19 byte-freeze for `ONE_SUN` under plan §0 ruling 4;
  phones stay capped at medium.


---

## M3 — POST_ORDER (recon L6) + DEPTH_FIX (recon L2 / FL-07)

### DEPTH_FIX — RED [closed-form]

`node scripts/r24-c-depth-roundtrip-proof.mjs` (committed). Every formula is
transcribed verbatim from the installed libraries with its file:line.

three r185 injects `USE_REVERSED_DEPTH_BUFFER` into every non-raw ShaderMaterial
(`three.module.js:6829/:6999`, off `renderer.state.buffers.depth.getReversed()`
at `:7495`) **and** switches its `<packing>` `perspectiveDepthToViewZ` to a
reversed-INPUT formula (`:463`). postprocessing 6.39.2 **also** un-reverses, in
its own `readDepth`, under the same define — `CircleOfConfusionMaterial`
(`index.js:4939`) and the merged `EffectMaterial` (`:14646`). Two conversions
where the formula wanted zero.

| true dist | raw d (reversed) | RED viewZ | RED err | GREEN viewZ | GREEN err |
|---|---|---|---|---|---|
| 50 m | 5.00e-2 | **−2.632** | 47.4 | −50.000 | 0.000000 |
| 700 m | 3.57e-3 | **−2.509** | 697.5 | −700.000 | 0.000000 |
| 8 km | 3.08e-4 | **−2.501** | 7997.5 | −8000.000 | 0.000000 |
| 300 km | 4.17e-6 | **−2.500** | 299997.5 | −300000.000 | 0.000000 |

Every fragment reconstructs at ≈ −2.5 m = −`cameraNear`. The toy DoF CoC is
therefore **flat 0.1762 – 0.1773 across 5 m to 300 km** — a uniform 18 % mix of
the half-res blur over the whole frame, which is the "Neon reads globally soft"
complaint. GREEN is 0.0000 in the focus band and rises monotonically to 1.0,
which is what a tilt-shift diorama is.

### DEPTH_FIX — the fix, and the patch that was NOT needed

One token: delete `depth=1.0-depth;` from the CoC material instance's
`fragmentShader` so the raw reversed value reaches three's reversed-aware
formula. Safe on a device that did not get a reversed buffer — the define is
absent there, the `#elif` branch never ran, and removing its body changes
nothing. Applied in `patchDofDepth()`, called from **both** the `el()` ref
callback and the `raw()` twin so the pre-warm compiles the same text.

`getViewPosition` needs **no** patch, and that deserves stating because it looks
wrong: it builds `vec3(uv, depth) * 2.0 − 1.0`, the WebGL [−1,1] NDC-z
convention, while reversed depth runs zero-to-one clip control. But row 2 of the
inverse of three's reversed perspective matrix is `[0, 0, 0, −1]` — the
reconstructed view Z comes from the clip W, which the shader builds **from
viewZ** (`projectionMatrix[2][3]*viewZ + [3][3] = −viewZ`), and the bogus NDC z
multiplies a zero column. X and Y scale by w alone. The reconstruction is exact
once viewZ is.

### DEPTH_FIX — AerialPerspective's sky early-out was DEAD

| | value |
|---|---|
| sky raw depth (reversed clear) | 0 |
| after the merged `EffectMaterial` readDepth (`index.js:14646`) | 1.0 |
| RED test `d >= 0.999999` where `d = 1.0 − depth` | **0.0 → never fires** |
| GREEN test `depth >= 0.999999` | 1.0 → fires |

The R19 header's premise — *"a define NEITHER library ever sets (the string does
not occur anywhere in three's source)"* — is false for three 0.185.1, and the
R19 manual flip is therefore a **third** conversion that lands on the correct
math by accident. The distance term has always been right; the sky was saved
only by the height term (an un-bent fragment 600 km out reads ~1,800 km high, so
`exp(−h/1200)` underflows). That is a load-bearing accident with no comment on
it. GREEN tests the value `readDepth` **normalises**, which is far = 1.0 in both
orientations, so one test is correct on every device and needs no uniform. The
header now says why.

### POST_ORDER — the reorder [source-derived]

`node scripts/r24-c-post-order-proof.mjs` reads the descriptor ids out of
`Effects.jsx` itself, so the proof cannot drift from the shipped list.

| composition | RED passes | GREEN passes |
|---|---|---|
| satellite / high | bloom → speed → aerial → grade → vignette → smaa → **tone** (4) | bloom → speed → aerial → **tone** → grade → vignette → smaa (**3**) |
| satellite / medium, low | 4, 3 | **3, 2** |
| toy / high | bloom → speed → hue → bc → **dof** → noise → vignette → smaa → **tone** (6) | bloom → speed → **dof** → **tone** → hue → bc → noise → vignette → smaa (**5**) |
| toy / medium, low | 4, 3 | **3, 2** |

Every composition is a **permutation** of the same list and the merged
EffectPass count **can only fall** — load-bearing, because Owens has zero draw
headroom at 261 and a fullscreen pass is a draw. Bloom stays first and
pre-curve (it is a sensor effect on scene radiance, and R21's bloom luma gates
were calibrated there). Aerial stays pre-curve for the R19 reason (the tile band
and the dome rim are baked in the scene render). **DoF stays pre-curve** — a
lens blur is radiance averaging, and averaging after a filmic curve darkens
bright bokeh.

### POST_ORDER — the clip nobody had documented [closed-form]

`HueSaturationEffect`'s shader ends `outputColor = vec4(min(color, 1.0), a)`.
On the R21 chain that effect runs **before** the tone map, on sRGB-encoded
scene-linear values — so **every fragment brighter than 1.0 linear was hard
clipped to white before the filmic curve ever saw it**. The ACES pass added in
R13 has been rolling off an already-clipped signal.

| pixel class | scene linear | RED 8-bit | GREEN 8-bit |
|---|---|---|---|
| deep sky / void | 0.004 | 0 | 0 |
| unlit facade | 0.030 | 26 | 26 |
| lit ground | 0.180 | 127 | 127 |
| road ribbon (additive) | 0.900 | 225 | 228 |
| window emissive | 3.200 | **228** | 254 |
| runway light / crown | 12.000 | **228** | 255 |

A lit window at 3.2 and a runway light at 12.0 are the **same 8-bit value**
today. The grade also sees an input range of 0 … 2.92 (a knob defined for [0,1]),
and so does SMAA's edge detector — which is why dark edges were under-weighted
and emissive edges over-weighted. After the reorder both see 0 … 1 by
construction.

### POST_ORDER — the grade re-tune: MEASURED, then declined

The charter budgeted a post-curve re-tune of `SKY.grade` / `TOY.saturation` /
`TOY.contrast`. A least-squares fit over the midtones (0.004 – 0.6 linear,
60 log-spaced samples, grayscale, neutral white balance, screen centre) gives a
best post-curve satellite contrast of **0.037** against the shipped **0.05** —
and leaving the knob alone costs **1.33/255 rms** versus **1.10/255** for the
re-fit. **0.23/255 is not worth moving a constant this agent does not own**, and
the R21 midtone look survives the reorder to within 1.33/255 rms. So POST_ORDER,
like LINEAR_HAZE, moves **zero constants**. The highlights are supposed to
change — that is the defect.

### POST_ORDER — the dither

`lib/fly/post-policy.js` `finishPassChain()` sets `dithering = true` on the LAST
EffectPass, from **both** assemblers (the forked composer and prewarm's
`buildWarmPasses`), because `EffectPass.dithering` sets `material.dithering`,
three injects `#define DITHERING`, and a dithered pass is a **different
program** — a pre-warm that missed it would compile a program production never
binds.

Per Fable's ruling this is explicitly **not** an ordered / Bayer / screen-door
pattern: three's `<dithering_fragment>` is a **per-pixel hash of
`gl_FragCoord`** at ±0.5 LSB, applied after `<colorspace_fragment>` and
immediately before quantisation. An ordered matrix is a fixed spatial texture
that survives in the same place every frame and can itself crawl at reduced DPR
(recon A7's complaint about the R21 Bayer dissolve); a hash has no repeating
structure to alias. `encodeOutput` needed no change — `ENCODE_OUTPUT` is already
`"1"` on every EffectMaterial and only the last pass renders to screen, so
`<colorspace_fragment>` is an identity on the intermediates.

### SMAA

`SMAAPreset.HIGH` + `EdgeDetectionMode.LUMA`, mounted as our own instance via
`<primitive>` rather than drei's `<SMAA>`: drei's `wrapEffect` spreads
constructor options back onto the effect as R3F props, and `applyProps` would
try `effect.preset = …` (SMAAEffect exposes only `applyPreset`), so the
option-carrying element and the `raw()` twin could not be built the same way
through it. The instance is built by calling `smaaSpec({}).raw()` — literally
the pre-warm's own constructor call.

**Honest caveat:** postprocessing converts the buffer back to linear at the end
of each merged pass, so SMAA's input is tone-mapped **linear** in [0,1], not
sRGB-encoded. The reorder therefore fixes the *unboundedness* (0…2.92 → 0…1),
which is the substantive half of L6's complaint, but not the *encoding*. Stated
rather than glossed.

### Cost

0 draws (pass count falls), 0 new render targets. SMAA HIGH ≈ +0.2–0.4 ms at
1080p — **[pending user machine]**, never measurable here. The DoF patch is a
shader-text change on one existing pass.

### Frozen gates touched

Every toy high-tier pixel moves (the DoF finally has a band): `verify-neon-*`,
roofs, window-grids, edge-fx. Every graded pixel above ~1.0 linear moves
(the clip is gone). **[pending fixture]** for the A/B and the re-baseline; the
live column stays "user machine pending".

### Fable's note (1): "does anything you add read as tearing?"

Nothing added is an ordered pattern (above). The per-pixel **temporal std** at
the Manhattan settled pose, before/after, through `verify-flicker`'s five-control
protocol, is **[pending fixture]** — it needs a real frame sequence and this
container renders ~1 fps of SwiftShader. What CAN be said from here: the dither
is a *static* function of `gl_FragCoord`, so it contributes **zero** temporal
variance at a parked camera by construction, and SMAA HIGH strictly increases
the search radius of an existing spatial filter — neither introduces a
frame-to-frame term. The one thing that could raise temporal std is the DoF band
becoming real, and that is bounded by the CoC ramp being monotone in distance.


---

## M4 — SHADOW_CALM (recon L5 / FL-12) + the T11 offset helper

### RED 1 — THE BIAS SIGN [source, three 0.185.1]

`ShaderChunk.shadowmap_pars_fragment` handles the reversed depth buffer in two
of its three shadow paths and **not in the third**:

| shadow type | bias line |
|---|---|
| `SHADOWMAP_TYPE_VSM` | `#ifdef USE_REVERSED_DEPTH_BUFFER  z -= bias  #else  z += bias` |
| `SHADOWMAP_TYPE_BASIC` | `#ifdef USE_REVERSED_DEPTH_BUFFER  z -= bias  #else  z += bias` |
| **`SHADOWMAP_TYPE_PCF`** | **`shadowCoord.z += shadowBias;` — unconditional** |

PCF is the type this app runs (R3F's `shadows` → `PCFSoftShadowMap`, which three
r185 deprecates to `PCFShadowMap` at `:9148`). Under a reversed shadow map
near = 1, far = 0 and the comparison is `GreaterEqualCompare` (`:9312`), so
biasing toward LIT means making the reference **larger** — and the authored bias
is **negative** (`-0.0002` toy, `-0.0004` satellite), correct for the convention
it was tuned in. `z += bias` therefore biases every receiver toward **shadowed**.

**Scale:** the toy shadow camera is `near 1 / far 8000` orthographic, so depth is
linear and 0.0002 of depth is `0.0002 × 7999 ≈ 1.6 m` of world depth pushed the
wrong way. **`normalBias: 4` is what pays for it** — 4 m of normal offset on a
`800 × 2 / 2048 = 0.78 m/texel` map is **5.1 texels of peter-panning** bought to
hide a 1.6 m sign error. This is the R21 P8 polygonOffset defect one layer down:
three flips the sign for you in the branches it thought about, not in the one you
use.

### RED 2 — THE ROTATING KERNEL [source]

PCF's 5-tap Vogel disk is rotated by
`interleavedGradientNoise( gl_FragCoord.xy ) * PI2` — a **screen-space** hash.
When the camera moves, a fragment covering the same piece of world gets a
different rotation than it had last frame, so the filtered edge changes shape
every frame, and there is no temporal filter anywhere in this renderer to average
it (recon FL-11). On buildings that reads as **the buildings flickering** — a
shadow-side cause of the user's report that is independent of chunk births, and
that is why it is called out separately in this ledger.

### RED 3 — THE UN-SNAPPED FRUSTUM [source]

`FlyScene.jsx:1689-1727` writes `sun.position` / `sunTarget.position` from
continuous `rpx/rpz` every frame, so a 2048² map re-rasterises every silhouette
into a sub-texel-shifted grid **every frame**, at 0.78 m/texel (toy) and
1.46 m/texel (satellite).

### Fix (flag `SHADOW_CALM.enabled`)

1. **`lib/fly/shadow-kernel.js`** — two string edits to
   `ShaderChunk.shadowmap_pars_fragment`, installed **once from FlyScene's module
   body**, i.e. before any material in the scene can compile. A ShaderChunk edit
   changes the text every shadow receiver compiles **without touching a single
   material, a single FINAL cache key or a single prewarm entry** — which is the
   precise property three's `CSM.js` does not have (it hooks `onBeforeCompile`,
   the same hook all 15 world-bend variants own, and would re-key all of them —
   recon L5). Edit (a) gives PCF the `#ifdef` form three already uses in VSM and
   BASIC. Edit (b) replaces the screen-space `phi` with
   `interleavedGradientNoise( shadowCoord.xy * shadowMapSize )` — identical cost,
   identical tap statistics, but the rotation is glued to the **world**, so
   camera motion cannot change any fragment's kernel. `kernel: 'fixed'`
   (`phi = 0`) is kept as the fallback if 'world' still shimmers on the user's
   machine; `'three'` leaves it alone.
2. **Texel snap** — `snapToShadowTexel()` quantises the follow target to a whole
   `2·orthoRadius / mapSize` in **light space**, using the shadow camera's own
   `matrixWorldInverse` rather than a hand-built basis: a basis differing from
   three's by a roll about the light axis would quantise onto a **rotated** grid
   and snap to nothing. It is one frame stale, and the basis changes only when
   the sun does (a 60 s cadence), so "one frame stale" is exact in every frame
   that matters. Applied to both rigs; on satellite only while the shadow camera
   is actually casting, since `ONE_SUN` now runs that branch at every tier.
3. **`normalBias` 4 → 1 (toy), 2 → 1 (satellite)** — creditable only *because*
   the sign is fixed. **[pending fixture]** for the acne A/B.
4. **The ground catcher, armed** — mounted whenever `SHADOW_CALM` is on, and made
   `visible` only where `runtime.satBuildings.queryColumns(px, pz, 1200)` returns
   a caster and AGL < 1500 m, on a 10-frame cadence. **Owens is 0 draws BY
   CONSTRUCTION, not by measurement**: `queryColumns`'s own docstring says it
   answers with an empty array when nothing has streamed, and over Owens Valley
   that is every frame of every pose. R19 shipped this disc off because an
   unconditional +1 draw breaks a ceiling with no headroom; the gate is not "is
   it enabled" but "is there anything to catch".
5. **`satCadence` CONSIDERED AND LEFT AT 0.** The ortho follows the *aircraft*,
   so skipping updates strands the shadow map behind the world it shadows — a
   measured-nowhere GPU saving traded for a visible lag. Re-open only with a
   number from the user's machine.

### T11 — one polygonOffset sign rule

`offsetUnits()` and `groundOverlayOffset()` now live once, in `world-bend.js`.
`SatTintLayer` and the shadow catcher became **calls**; the streaming engines
(roads, satellite water) get an offset **for the first time**, behind the flag,
because they are `depthWrite:false, depthTest:true` additives draped on a 16×16
bilinear grid at demZ 12 and depth-tested against the z15 tile mesh — on ground
tilted away from the eye they simply lose the test (recon T8). Engines have no
renderer in scope, so `FlyCanvas.onCreated` latches the live capability once via
`setDepthReversed()`.

### NEW GATE — `scripts/verify-depth-offset.mjs` (node, runs anywhere)

**RED on the base tree `6116fc5`: 6 of 7 gates fail** (verified by archiving the
base commit and running the gate against it):

```
FAIL  no raw polygonOffsetUnits literal outside world-bend.js
        components/fly/FlyScene.jsx:278 | lib/fly/prewarm.js:279
FAIL  the helper itself exists exactly once — declarations=0
FAIL  offsetUnits is exported from world-bend.js
FAIL  groundOverlayOffset is exported and flag-gated
FAIL  setDepthReversed is latched from the live renderer at context creation
FAIL  satellite shadow catcher uses the shared helper
```
GREEN on this tree: **7/7 PASS, 185 files scanned.**

**The gate found a real offender on its first run:** `lib/fly/prewarm.js:280`
warmed the `SatTintLayer` twin with a raw `polygonOffsetUnits: -2` while
production has applied the R21 P8 sign flip since that round — the twin and the
material it warms disagreed about the depth convention. (No program moves:
polygonOffset is GL state, not a shader define, so this is a state-fidelity fix,
not a cache-key one.) That is exactly the drift a one-implementation rule exists
to prevent, caught by the rule on the day it was written.

### Instrument for E — `__flyStats.shadow`

`{ enabled, installed, biasSign, kernel, casting, mapSize, radiusM, texelM,
normalBias, bias, lightPos, target }`. `biasSign` / `kernel` come from the module
that **did or did not perform the patch**, never from the flag that asked for it.
`casting` is fleet-pin-aware: `verify-shadow-calm` must un-pin
`__flySatShadowOverride` (the accessor-swallow idiom) and prove the pass is
reachable at high tier before asserting anything.

**Gate recipe:** (1) `biasSign === true && kernel === 'world'` with the flag on,
both false/null with it off; (2) park the camera at the Manhattan settled pose
and step the aircraft by **half a shadow texel** — `target` must not move; step
it by 1.5 texels — `target` must move by exactly one texel; (3) at the Owens pose
with the flag ON, the catcher's draw contribution is 0 (visible false) while at
Columbus it is exactly +1; (4) per-pixel temporal std on the shadowed side of a
building, before/after, through verify-flicker's five controls.

### Flag-off confirmation (Fable, for merge arbitration)

1. **The ShaderChunk edits are applied ONLY when `SHADOW_CALM.enabled` is true.**
   `installShadowKernel()`'s first statement is
   `if (_state.installed || !SHADOW_CALM.enabled) return _state;` — with the flag
   off the function returns before reading `ShaderChunk.shadowmap_pars_fragment`
   at all, so three's chunk text is byte-verbatim and the flag-off tree compiles
   exactly R21's shadow programs.
2. **Install site:** `components/fly/FlyScene.jsx`, MODULE BODY, one bare
   statement `installShadowKernel();` immediately after the `_sunAudit` /
   `_moonKeyDir` module scratch declarations and before `snapToShadowTexel` —
   i.e. inside the module's top-level statement list, not inside any component.
   (`components/fly/FlyCanvas.jsx` imports `./FlyScene` at line 6 and
   `./PrewarmRig` at line 10, and `prewarm.js`'s module body compiles nothing —
   its `compileAsync` runs from a component effect — so the chunk is patched
   before ANY material in this app compiles, prewarm's warm scene included.)
3. **The warm and live programs therefore read the same text**: there is one
   `ShaderChunk` table, it is mutated once, before either.
4. **`__flyStats.shadow.biasSign` / `.kernel` are read from `shadowKernelState()`
   — the module's record of what it ACTUALLY patched**, not from the constants
   block that asked. A failed string match leaves them `false` / `null` and the
   gate sees the truth.

### Cost

0 draws over empty terrain, +1 where casters exist. The kernel edits are
text-only (same 5 taps, same instruction count ±1). The snap is one matrix pair
per frame on one object.

### Frozen gates touched

Toy roof / edge-fx crops may move **by a texel** (the snap) and by the bias sign
(shadow edges shift toward the caster instead of away). Road and water coverage
can only **grow** on slopes, never shrink. **[pending fixture]** for all of it.


---

## M5 — TERRAIN_LIGHT (recon L8, T6, T7, T12, T13) — PARTIAL, and honestly so

### What is DONE (this tree)

- **`uHillElev`** — the sun-elevation weight as its own uniform, with the FINAL
  tile key derived from the flag combination (see the ONE_SUN section; the key
  suffix is built from the actual flags so two different texts can never share
  one key — the R4 lesson).

### What is BLOCKED on A, and why it must be

The worker half — smooth central-difference normals from the FULL DEM grid and
error-bounded skirts — has to live inside three-tile's LERC worker. On this tree
that worker is a **minified inline string** (`const fe = '...'`, vendored
`index.js:1118`) whose per-vertex normal function is the last-writer face-normal
loop recon T6 names. A patch into a minified blob is unreviewable and unmergeable,
and A's `skirtWorker` step replaces that string with a READABLE source plus a
stringify script. **The correct move is to wait for it, not to work around it**,
and Fable has ruled the same way. Patch numbering (8+), the `// R24 C PATCH <n>`
site marker, the `VENDOR.md` row format and gate 7/8's constraints are recorded
so the work can land as marked hunks the moment A's sha arrives.

E's constraint is recorded with it: three-tile's terrain-rgb path resizes to
`clamp((z+2)*3, 2, 64)` px and Martini **throws** unless the grid is `2^k+1`,
and the LERC path has its own grid — so the normal computation must derive its
size from the worker payload and **never assume 257**.


---

## M6 — CLOUD_LIT (recon L7) + LAMBERT_ENV (recon WB-7)

### CLOUD_LIT — RED [source]

`components/fly/CloudField.jsx:500` — `const CloudMat = style.lit ?
MeshLambertMaterial : MeshBasicMaterial` on drei's `<Clouds>` sprite instancer.
A billboard's normal points AT the camera, so `N·L` is **one constant per
sprite**: the sun cannot shape a puff, there is no lit side and no shadow side,
and the whole deck is a set of grey cotton discs whose only variation is the
per-instance tint (recon L7; the R22 handoff's "flat grey-blue wash").

### Fix

`lib/fly/cloud-material.js` gives each fragment a **fake hemisphere normal**
from its position on the sprite quad — `n = (p.x, p.y, sqrt(1 − |p|²))` in VIEW
space is exactly the normal field of a sphere seen head-on — rotates it to world
space, shades sun-side against shadow-side, and adds a **Henyey-Greenstein
forward lobe** toward `runtime.sun`. The HG term IS the silver lining: real
droplets scatter strongly toward the eye when the sun is behind the puff.

**Same instancer, same ONE draw**, ~+20 ALU on the 5–10 % of pixels a deck
covers, exact early-out at `uCloudMix <= 0`.

### The hook is an ACCESSOR, and that is forced

drei's `<Clouds material={X}>` builds `class CloudMaterial extends X` and, in
**its own constructor** (`Cloud.js`), assigns `this.onBeforeCompile = …` to
inject the per-instance `cloudOpacity` attribute. `super()` runs first, so
anything our constructor assigns is overwritten one line later. The only stable
hook is a prototype **accessor**: drei's assignment lands in our setter, and our
getter returns a composed function that runs drei's edits FIRST. That ordering
is required, not stylistic — our fragment edit rewrites the exact `gl_FragColor`
line drei writes. If drei ever stops emitting it, the replace is a no-op and the
deck falls back to plain Lambert: a missing flourish, never a broken frame.

### The feed

Rides CloudField's EXISTING ~10 s tint cadence — no new timer, no new React
state — and reads the same `runtime.sun` the tint just consumed, so the deck's
colour and its lighting cannot disagree about the time of day (the round-6
single-source rule). After dark the key is the **anti-solar moon**: the same
vector `ONE_SUN` swings the scene key onto and SkyDome hangs the moon disc on.
Overcast greys BOTH sides toward one ceiling tone and removes the rim, which is
correct — there is no direct sun to back-scatter.

### The PREWARM exception — stated as an exception (Fable ruling)

The shared rules say every new shader text gets a FINAL cache key **and** a
PREWARM warm-set entry in the same change. This variant takes the key and
**not** the warm-set entry, and that is a documented exception rather than an
oversight:

| | |
|---|---|
| world-bend registry header | **YES** — listed, with its reach and its 0-identity condition |
| `customProgramCacheKey` | **YES** — `'cloud-lit-c24'` (the onBeforeCompile source is its identity) |
| PREWARM warm set | **NO** |
| why | It compiles once at boot with the deck it belongs to, and introduces **no new mid-flight state flip** — the style flip that swaps Lambert↔Basic already existed and already re-links this program's slot. Prewarm exists for mid-flight flips (recon WB-4), not for boot. Warming it would also mean replicating drei's runtime-generated inner subclass, which is a fragile twin by construction. |

**The condition, accepted:** E's `verify-env-uniform` `programsDelta` run must
include one satellite → toy → satellite style flip, so "no mid-flight compile"
is MEASURED rather than argued. **If that run shows the lit cloud program
re-linking on the flip back, this belongs in B's re-warm-on-style-flip**, not in
a boot warm set — Fable routes it there. **[pending E]**

### LAMBERT_ENV — RED [source]

`three/src/renderers/webgl/WebGLPrograms.js:60-63` applies `scene.environment`
to Lambert/Phong, and `MeshLambertMaterial`'s defaults are
`combine = MultiplyOperation`, `reflectivity = 1` — i.e. a **full-strength
mirror-reflection lookup** of the HDRI on every wall, roof, canopy and house
(`envmap_fragment.glsl.js:41-43`). Roofs take the zenith colour, facades take
the horizon band, and the twilight HDRI's bright azimuth band can light one
facade direction at night — a plausible contributor to "white-glow buildings".

`reflectivity 0.15` on the four Lambert content materials (sat buildings,
skyline, canopy, parcel homes) plus the two monument materials `ONE_SUN` moved
to Lambert. **Uniform-only**: a material PARAMETER, so the program is unchanged
and no cache key moves — only the envmap intensity term. **[pending fixture]**
for the noon/dusk A/B at the certified poses.


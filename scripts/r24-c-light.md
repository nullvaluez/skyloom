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


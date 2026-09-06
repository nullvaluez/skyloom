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


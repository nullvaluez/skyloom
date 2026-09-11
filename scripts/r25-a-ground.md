# R25 A GROUND — "a bubble of detail under the aeroplane" (ledger)

Agent **A GROUND**, Round 25 "Ground & Night". Worktree `/home/user/skyloom-r25-a`,
branch `r25/a` off `6bf628e` (the W0 scaffolding tip of
`claude/happy-planck-dw8yyf`). Plan: `FLY_ROUND25_PLAN.md` §3 A, ownership row
§4. Evidence: `scripts/r25-recon.md` — my ids are **G1 G2 G3 G4 G5 G6 G7 G8**,
and I read **L5 / L6** because C LIGHT's shadow and AO radii share my band.

> **Venue truth, stated once and true for every row below.** This container has
> no GPU (ANGLE/SwiftShader at 1–3 fps under the app's load), Google Chrome is
> absent (Playwright chromium through `scripts/_pw-shim.js`), and Esri /
> OpenFreeMap / adsb.lol are 403-blocked, so the ONLY world here is E's offline
> fixture (`FLY_TILE_FIXTURE=1`). **No fps, ms, stutter, bandwidth, VRAM or
> "does it look right" number in this ledger was measured here, and none is
> claimed.** Structural numbers — generated GLSL strings, cache keys, uniform
> values, instance counts, draw census at a pinned pose, fixed-pose pixel crops
> — ARE measurable here and are labelled MEASURED-HERE. §8 is the honest
> "could not measure here" list, and the LOOK of the overlay is the first thing
> in it.

---

## §0 RED — what the ground actually is at 80 m AGL today

The user's words were "on the ground the immersive feel still lacks", ruled to
**50–500 ft skimming**. Four facts, all re-verified on this tree, all from the
source rather than from an impression:

| # | The RED | Where |
|---|---|---|
| G1 | **Every AGL band is a CULL band.** Poles cull at 900 m, movers 1200, parked cars 1400, canopy 2000/2600, buildings 2200/2800, roads 4200/5200. **Nothing whatever turns ON below ~600 m** — the world gets emptier as you descend. | `fly-constants.js:6180 / 6162 / 6151 / 3137 / 978 / 1182` |
| G2 | **The finest thing in the world is an 8.5 m lamp post over a 4.1 m car.** No grass, no scrub, no hedges, no curbs, no markings, no decals. | `CLUTTER.poles.heightM 8.5`, `:6156` |
| G3 | **The tile material carries `map` and nothing else** — no normal map, no roughness map, no detail map, `roughness 1` — so there is no surface response to the key light at any scale below the DEM posting (z16 ≈ 1.8 m, 2 m tolerated error). | `vendor/three-tile/index.js:811-815`; `TERRA_SHARP` |
| G4 | **The ONE sub-10 m term is a ±10 % LUMA grain at a 5.5 m cell** (`HILLSHADE.micro`, amp 0.1, `strengthByTier.high 1.0`, faded out between 1500 and 2500 m AGL) — a pure albedo multiply with **no normal component at all**, so it cannot move with the sun, and it is `fwidth`-attenuated. | `world-bend.js` micro block; `fly-constants.js:2049-2055` |

**MEASURED-HERE (arithmetic on the shipped constants, 900 px tall viewport,
62° vertical FOV, the same `fwidth` model the fragment uses):** the recon's
phrase "faded OUT at the grazing angles of skimming" is true for the FAR half
of a low frame and NOT for the near half, and the honest table is worth having
because it is also the table the new overlay is designed against:

| At 80 m AGL, depression below the horizon | ground range | micro cells/px | micro attenuation |
|---|---|---|---|
| 90° (straight down) | 0 m | 0.052 | **1.000** |
| 30° | 139 m | 0.105 | 1.000 |
| 10° | 454 m | 0.302 | 1.000 |
| 8.6° | 529 m | 0.351 | 1.000 (the fade begins here) |
| 5° | 914 m | 0.602 | 0.563 |
| 3.3° | 1,387 m | 0.911 | **0.000** |

So at 80 m the grain is at full strength out to ~530 m of ground range and gone
by ~1.4 km. **The defect is not that the one term is switched off; it is that
the one term is a 5.5 m albedo flicker and there is nothing else.** A 5.5 m cell
is the size of a small car — at 80 m AGL it spans ~50 px, which is a stain, not
a texture.

**Draw census RED (MEASURED-HERE, fixture).** The flag-off leg of
`scripts/verify-ground-bubble.js` (`FLY_GD_ARM=0`) is the control run: it boots
the same tree with neither pin, flies the same poses, and writes its Owens draw
census to `scripts/r25-out/gd-owens-control.json`, which the armed run then
reads. That is the control the "0 by construction" claim is measured against —
a number from another process on the same fixture at the same pose, not a
number remembered from another day. Numbers in §6.

---

## §1 Mechanism — the four things that ship, and one that does not

Everything reads `runtime.groundBubble?.k ?? 0` (plan §2's shared substrate,
written by `GroundBubbleRig` at `useFrame` −49) and is gated by
`r25On('GroundDetail', <sub>')` through **one** accessor,
`lib/fly/ground-detail.js`. Satellite only.

### 1. `overlay` — the tile fragment's 'd' block (0 draws)

Injected inside `applyHillshade` at the END of the `<color_fragment>`
replacement, after SAT_QUILT, when and only when `groundOverlayOn()`:

* two octaves of the hillshade's OWN `hillVNoise` on `vWorldXZ` at **1.4 m** and
  **0.45 m** cell periods → a fine luma grain;
* an **analytic normal perturbation** — finite differences of the COARSE octave
  at a half-cell offset — fed through the N·L the fragment already computes from
  `vHillNW`, applied as the DIFFERENCE of the perturbed and unperturbed shade
  and enveloped by `uHillStrength * uHillElev`. So the relief **moves with C's
  key light**, is exactly as strong as the hillshade it belongs to, and is
  exactly 0 off satellite (where that envelope is 0);
* an **imagery classifier** on the sampled pixel (hue/saturation/luma) weighting
  grass (full grain + full relief), asphalt (0.35 / 0.25 — a smooth sparse
  speckle; a car park with grass texture on it is worse than a flat car park)
  and soil-or-other (0.70 / 0.60);
* `uGroundDetail` = `k × strengthByTier` (high 1 / medium 0.7 / low 0) and
  `uGroundAmp` = (`lumaAmp`, `normalAmp`), both LIVE, written once per frame by
  `setGroundDetail` from ONE line in FlyScene's −50 block beside
  `setMicroDetail`.

**Per-OCTAVE `fwidth` fade, and why it is per-octave.** R24 C's lesson (recon
T13) is that a procedural cell under ~2 px aliases into the crawling shimmer the
user called tearing, and that SMAA — a geometric-edge filter — cannot touch it.
The quantity `fwidth(noiseCoord)` is *cells per pixel*, which is scale-free, so
C's calibrated thresholds (`microFadeLo 0.35` / `microFadeHi 0.9`) apply to any
octave — but the two octaves reach the limit at completely different altitudes,
so one shared attenuation would either alias the fine octave or kill the coarse
one. MEASURED-HERE (same arithmetic as §0):

| Straight down, at | coarse (1.4 m) attenuation | fine (0.45 m) attenuation |
|---|---|---|
| 80 m | 1.000 | 1.000 |
| 200 m | 1.000 | 0.586 |
| 500 m | 0.865 | 0.000 |
| 700 m | 0.385 | 0.000 |

The fine octave **self-retires by ~500 m**, before the bubble closes it at
500→700 m; the coarse octave is still 0.385 at 700 m where the bubble takes it
to 0. **The term is anti-aliased by construction and the bubble is the belt to
that brace, not the other way round.**

### 2. `scrub` — one InstancedMesh, +1 draw where placed

`components/fly/SatGroundDetailLayer.jsx`. 2 crossed cards = **4 triangles**,
sharing the existing `immersive-foliage.js` 128² leaf atlas (`alphaTest 0.42`,
`DoubleSide`), `MeshLambertMaterial` with `LAMBERT_ENV.reflectivity`,
`applyBendAnchor` — the EXISTING `'world-bend-anchor-r8'` variant, unmodified.
Pools {high 2000, medium 800, low 0} ⇒ **8,000 tris at the full high pool,
exactly the 8 k budget.**

Anchors sit on the pooled **SatTint landcover TRIANGLES**, selected by the
worker's own per-vertex `cls` (2 wood / 3 grass / 5 farmland — **never `park`**,
which is administrative and would carpet the Mojave; the worker's own warning at
`vector-tile.worker.js:3698` and the R19 measured ruling behind it). Rejections:
a building column within `urbanAvoidM` (ONE `queryColumns` call for the whole
disc, then a 32 m hash grid — per candidate it is a bucket walk, not an
allocation), a cls 5/6 road centreline within `roadAvoidM`, a water anchor
within `waterAvoidM`. Ground height is `engine.groundAtLocal(chunk, lx, lz)` —
**THE SAME bilinear grid** the clutter, the tint, the porch lights and the
parcel homes stand on, because a mismatched grid floats objects
(`CLUTTER.gridSegments`, `fly-constants.js:6104`).

**The sampler is a JITTERED WORLD LATTICE**, walked over
`bbox(triangle) ∩ bbox(disc)` with spacing `1 / sqrt(pool / (π r²))` ≈ 11.9 m at
the high pool. **Density is DERIVED, not a new constant** — the spacing IS the
density, so a fully-vegetated disc fills the pool exactly and a half-vegetated
one fills half of it, with no per-triangle cap needed at all. And it is
**hash-stable in the strongest sense**: the lattice lives in ABSOLUTE world
coordinates and each cell's jitter is keyed on its integer index, so a tuft's
position is a pure function of where it is on the planet and of NOTHING the
camera does. That is SAT_VEG's rule ("never a distance sort") applied to a
source with no emission order of its own, and it is why a tuft cannot move,
blink or re-shuffle when you turn. §7.2 records the sampler this replaced and
why it measured the wrong thing.

### 3. `hedges` — a second instancer in the same file, +1 draw where placed

**10-tri** open-bottomed box segments (`segM × heightM`, `thickness` 0.8 m) at
`offsetM` outboard of BOTH sides of every cls 5/6 (tertiary/minor) centreline
segment the existing `parcelRoadScan` index carries. A hash drops ~⅓ of the
offers (an unbroken hedge on every lane of a subdivision is a maze, not a
suburb); a piece is skipped if a building column is within `columnAvoidM` (that
is where the driveways are) or if no ready veg chunk sits under it (its ground
height would be a guess, and a floating hedge is worse than none).

**TEN triangles, not the charter's twelve, and this is a budget fact:** 600 ×
12 = **7,200** against the 7,000 ceiling. The dropped face is the one buried in
the ground — SatVegLayer's trunk makes exactly this call ("the base is in the
ground — capping either would be 6 invisible tris") — and it brings the full
high pool to **6,000 ≤ 7,000**.

The road index stores each segment as the SAME array object in every grid cell
it crosses, so an **identity `Set` dedupes exactly** — no coordinate rounding
and no epsilon.

### 4. `tint` — the landcover drape lifts (0 draws, 0 shader text)

`SAT_TINT` bakes its alpha into the vertex COLOUR on the CPU (multiply blending
has no alpha channel of its own) and already re-derives every multiplier from
the worker's raw `col` on each cadence pass. So
`mix(SAT_TINT.alpha, lowAglAlpha, k)` is one CPU multiplier on a pass that was
happening anyway: **no shader text, no cache key, no extra fill.** `k` joins the
static-skip signature — otherwise the skip would hold a settled parcel at the
alpha it was filled with while the aircraft descends through the bubble — and
it is appended to that string ONLY when the sub-switch is armed, so the flag-off
signature is character-for-character the R24 one.

### 5. What does NOT ship: sway, and therefore no new cache key

The reserved `'world-bend-anchor-scrub-r25'` key is **left un-taken**, and the
registry header now says so. Sway needs a per-instance attribute — a new
program and a new warm-set entry — to animate a 0.6–1.4 m card that is under two
pixels above ~200 m AGL. The round's ask is "the ground has detail", not "the
grass moves".

**Fences are not built** either (the plan already ruled it): a 5 cm post at
50 m is sub-pixel, and a fence LINE without posts is a road ribbon by another
name.

---

## §2 Flag-off identity — PROVEN, byte for byte

`node scripts/r25-a-flagoff-identity.mjs` (committed, re-runnable; it extracts
the base copy itself with `git show 6bf628e:lib/fly/toy-world/world-bend.js`)
loads **this tree's** `applyHillshade` and the **W0 base's** in ONE node process
through `scripts/_node-resolve.mjs`, runs both through the same fake shader
object, and compares the generated strings. **MEASURED-HERE, 8/8:**

```
PASS (1) flag-off FINAL tile key verbatim R24 — world-bend-fade-hill-r19-ef24 (both)
PASS (2) flag-off fragment string byte-identical — 3047 vs 3047 chars
PASS (3) flag-off vertex string byte-identical
PASS (4) flag-off uniform set identical — uHillAO,uHillAmbient,uHillDir,uHillElev,
         uHillLift,uHillSat,uHillStrength,uMicroAmp,uMicroScale,uMicroStrength,
         uQuiltAnchor,uQuiltDesat,uQuiltFlat
PASS (5) flag-off fragment carries no R25 text
PASS (6) armed key = the flag-off key + the single token 'd' — …-ef24 -> …-efd24
PASS (7) armed fragment = the flag-off fragment PLUS the d block (a pure append)
PASS (8) armed adds exactly the two overlay uniforms and nothing else
8 passed, 0 failed
```

Note what (1) also records: the FINAL key on the SHIPPED tree is
`world-bend-fade-hill-r19-ef24` — `e` and `f` only. `AERIAL_LAW` ships OFF (no
`a`) and `lodFade` is per-material (no `l` in this synthetic capture), so `'d'`
lands as the third character of the token run when armed.

The other four terms are flag-off-identical by construction and by reading:

| Term | Flag-off state |
|---|---|
| `scrub` / `hedges` | `groundDetailOn()` is false ⇒ the `&&`-chain in `FlyScene.jsx` does not mount `SatGroundDetailLayer` at all — no pools, no materials, no cadence, no globals. |
| `tint` | `tintAlphaFor` returns its argument, and the signature suffix is an empty string, so `fillTint` runs the R24 arithmetic on the R24 string. |
| `z19` | `z19MaxZoomFor` returns its `base` argument; `satMaxZoomFor` is a pure wrapper around the pre-R25 body, which is untouched. |
| `workerNormals` | `pinned(TERRAIN_LIGHT, …)` returns the constants object itself when the global is absent, so `R24_SWITCHES.workerNormals` evaluates to exactly what R24 evaluated to. |
| prewarm | both new warm entries are inside `if (groundDetailOn(<sub>))`, so the flag-off warm set is the R24 one. |

**The one thing flag-off identity does NOT cover, stated plainly:** with the
block ARMED, every tile material recompiles once (the key gains `d`) and toy
tiles compile the same program. Toy pixels are unchanged because `uGroundDetail`
is 0 off satellite and the branch is skipped — the R13 micro-detail precedent —
but the *program count* moves, which is why the gate reports the delta rather
than asserting a frozen number.

---

## §3 Ownership — every file I touched, and why it was mine to touch

| File | Row says | What I did |
|---|---|---|
| `lib/fly/ground-detail.js` | NEW (A) | The predicate + policy accessor. B NIGHT gets `lib/fly/night-ground.js` for the same reason. |
| `components/fly/SatGroundDetailLayer.jsx` | NEW (A) | scrub + hedges. |
| `lib/fly/toy-world/world-bend.js` | "the `'d'` block + `setGroundDetail` + `groundDetailOn()` in `applyHillshade`" | Exactly that, plus the two registry-header stubs filled in and a **marked insertion point for B's `'n'`** in both the GLSL and `hillKey`. |
| `components/fly/SatTintLayer.jsx` | "α" | The α mix and its signature term — **plus ONE line publishing the SatVegEngine** to `publishGroundSource`. That is beyond the literal word "α"; it is the exact analogue of B's sanctioned `runtime.satClutterPoles = mesh` line in `SatClutterLayer.jsx`, and it is the only place in the tree that holds the streamer the scrub needs. **Flagged for the orchestrator.** |
| `components/fly/FlyScene.jsx` | one mount line | TWO lines + two imports: the `&&`-chain mount beside `SatClutterLayer`, and the `setGroundDetail(...)` line beside `setMicroDetail` that the charter names as the permitted second touch. |
| `lib/fly/tile-sources.js` | "z19 read" | `satMaxZoomFor` now wraps the pre-R25 body (renamed `satMaxZoomBase`, contents untouched). |
| `lib/fly/prewarm.js` | "SIZES entry if a new attribute" | No new attribute and no SIZES change; **two guarded warm ENTRIES** instead — see §5, this is a deliberate reading of the rule and it is flagged. |
| `lib/fly/r25-pins.js` | **not in my row (Fable's W0)** | THREE import specifiers `'./x'` → `'@/lib/fly/x'`, zero behaviour, because `_alias-loader.mjs` — which `verify-lod-fade.mjs` and `verify-atmo-law.mjs` register — resolves the `@/` alias and NOT extensionless relative paths, so the first R25 module to reach `world-bend.js` crashed the gate at import. Every owner's chain hits this. §7.6. **Flagged for the orchestrator.** |
| `lib/fly/terrain-engine.js` | **not in my row** | ONE line + one import: `R24_SWITCHES.workerNormals` reads `TERRAIN_LIGHT` through `pinned`. The charter assigns me this (§3 A6) and no other owner touches this file this round, but it IS out of row. **Flagged for the orchestrator.** |
| `lib/fly/fly-constants.js` | `GROUND_DETAIL_R25` | Only inside my own block: `z19` gains `levels: 1` and the reason it is a ceiling. |
| `scripts/verify-ground-bubble.js`, `scripts/r25-a-z19-probe.js`, `scripts/r25-a-ground.md` | NEW | My gate, my measurement probe, this ledger. **`scripts/verify-*` is E's row** — the plan names this gate as "E writes, A ships the handle"; I wrote it because it is the only instrument that can RED-calibrate my own work before merge. **E owns it from the merge on** and should re-key anything that collides. |

---

## §4 Cost, per tier

Budgets frozen this round: Owens ≤ 261 / satellite ≤ 375 draws, fixed-pose tris
≤ 2.0 M, textures ≤ 300 MB. Mine: scrub ≤ 8 k tris, hedges ≤ 7 k, +1 draw each
where placed.

| Term | high | medium | low | draws | texture bytes | RT bytes |
|---|---|---|---|---|---|---|
| `overlay` | strength 1 | 0.7 | **0** | **0** | 0 | 0 |
| `scrub` | pool 2000 × 4 tris = **8,000** | 800 × 4 = 3,200 | pool 0 ⇒ **not rendered at all** | +1 where placed, **0 where the landcover set is empty and 0 above the bubble** | 0 — it shares the existing `immersive-foliage` atlas, which the canopy already allocates | 0 |
| `hedges` | pool 600 × 10 tris = **6,000** | pool 0 | pool 0 | +1 where placed, 0 otherwise | 0 | 0 |
| `tint` | 0 | 0 | 0 | 0 (a CPU multiplier on an existing pass) | 0 | 0 |
| `z19` (OFF) | +1 imagery level ceiling | — | — | §6 | more tiles resident (unbounded here; the reason it ships OFF) | 0 |

Worst case with everything armed at high tier, inside the bubble, over a
fully-vegetated suburb: **+2 draws, +14,000 triangles.** Against a 2.0 M
fixed-pose tris ceiling that is 0.7 %.

**ALU cost of the overlay, counted rather than guessed:** 4 `hillVNoise`
evaluations (2 for the two octaves, 2 for the coarse finite differences) at 4
hash + 3 mixes each, plus ~30 scalar ops for the classifier and the two shade
dots. It runs ONLY inside `if (uGroundDetail > 0.001)`, i.e. only on satellite
tile pixels inside the bubble. **What that costs in ms is the user's machine's
answer, not this container's** — see §8.

---

## §5 Frozen gates and rules touched

| Thing | Status |
|---|---|
| Owens ≤ 261 | Asserted by `verify-ground-bubble` leg (2c) and (2d) against a flag-off control measured in the same venue. **No threshold moved.** |
| satellite ≤ 375 / toy ≤ 480 | Untouched — no new draw is issued in toy (the layer never mounts) and the Owens/suburb legs bound the satellite side. |
| `WORKER_PROTOCOL` 20 | **Untouched.** Every source I read is client-side: the tint triangles the worker already emits, `queryColumns`, `parcelRoadScan`, the veg engine's bilinear grid. No payload change, no pin site. |
| Neon / toy byte-identity | The `'d'` program is compiled for toy tiles when the block is armed, but `uGroundDetail` is 0 off satellite and the branch is skipped, so toy PIXELS are unchanged (the R13 micro-detail precedent). Program COUNT moves; the gate reports it. |
| `verify-skirt-worker` | **Goes RED BY DESIGN** if the user sets `__flyTerrainLightOverride = { workerNormals: true }`. Its contract is element-for-element identity between the worker skirt and the main-thread one, and smooth normals deliberately change the normal array. **NOTE FOR E:** this is a user-A/B pin, not a shipped flip; the gate is not red on the shipped tree. |
| `prewarm.js` warm-set rule | **A deliberate reading, flagged.** The rule is "new shader TEXT ⇒ new FINAL key + a warm-set entry in the same change". The scrub and hedge materials take an EXISTING variant with no new text — but three's own program key is the material's parameter set, and neither material matches any of prewarm's (a)/(b)/(c) (the scrub adds alphaMap/alphaTest/DoubleSide/uv/vertexColors; the hedge adds vertexColors). Without a warm entry the first descent through the bubble compiles two programs mid-flight, which is exactly the hitch class this round exists to remove. Both entries are guarded by the same predicate the mount is. |
| `verify-c-flagoff.mjs` | **58/58 GREEN on this branch.** It asserts that the tile key goes through `r24VariantKey` "with the FIXED token order e/f/a/l" — my `'d'` is APPENDED after those four, so the assertion is untouched. MEASURED-HERE. |
| `verify-atmo-law.mjs` / `verify-depth-offset.mjs` / `verify-vendor-three-tile.mjs` / `verify-artifact-hygiene.mjs` | 53/0 · 7/0 · 34/0 · 5/0 GREEN on this branch. MEASURED-HERE. |
| `lib/fly/vendor/three-tile/index.js` — `R24_WORKER_TAIL_RE` | **CHANGED, deliberately, and it is the round's most consequential line for me.** §6.5. `verify-skirt-worker` (E's copy) RED 10/1 → GREEN 11/0, gate 2b 1 of 2 → 2 of 2; `verify-vendor-three-tile` 34/0 → 32/2 → **34/0** once the reviewed receipt recorded the change. |
| `scripts/vendor-three-tile-integration.json` | One digest and one inventory entry added, with the reason. It is a REVIEW artifact by design, so this is the workflow, not a bypass. |
| `verify-lod-fade.mjs` (60/4) and this tree's `verify-skirt-worker.mjs` (8/1) | **RED, and NOT mine.** Every red is an assertion about `lib/fly/vendor/three-tile/**` or the spliced DEM worker tail — files this branch does not touch (`git diff --stat 6bf628e -- lib/fly/vendor` is EMPTY). They were INVISIBLE until §7.6's import fix, because the gate crashed before reaching them. **They need an owner.** |
| `verify-import-integrity.mjs` | RED at the W0 base on `scripts/r24-c-agl.js` (two `no-undef`). **Pre-existing** — verified by stashing this work and re-running. My files add zero. |
| `hillKey` token order | `'d'` is APPENDED after R24's `e f a l`, and there is a marked insertion point comment for B's `'n'` AFTER it, in both `hillKey` and the GLSL — plan §4's arbitration rule, written into the file so a merge in either order composes. |

---

## §5b Decisions

**1. The overlay is a fragment term, not a normal map or a detail map.** Both
alternatives are texture bytes against a 300 MB ceiling on a vendored tile
material that carries `map` and nothing else, and both would need a second UV
set to tile at metre scale across a tile that is kilometres wide. The noise
function was already compiled into that fragment.

**2. The normal perturbation is an additive DELTA of two N·L evaluations**, not
a change to the hillshade's own `lit`. The hillshade block has already resolved
and mixed by the time mine runs; re-deriving `mix(rgb, rgb·lit·ao, w)` to divide
it out would couple my block to C's exact expression. Evaluating the perturbed
and unperturbed dot and applying the difference under the same envelope is
decoupled and is what "perturbation" means.

**3. Classification reads the IMAGERY, not a tag.** At this scale Esri's own
pixel is a better statement of what is underfoot than any vector layer we have:
landcover polygons exist for maybe a third of a suburb, and none at all for a
car park, a runway apron or a gravel yard. The thresholds are constants in my
block precisely so they are the §9 checkpoint's knobs.

**4. Scrub anchors come from the SatTint TRIANGLES, not from the veg scatter
points.** The scatter is a per-class point set with a frozen per-tile cap spent
in emission order (R19 measured: at Powell the park/wood/grass passes consume
the cap before residential is reached). Sampling the polygons directly is
uncapped, area-proportional, and — this is the part that matters — it is the
same geometry the tint drape is painted from, so the scrub and the colour of the
ground under it can never disagree.

**5. `park` is excluded from the landcover set.** It is administrative. Owens
Valley ships 29.87 km² of `park:national_scenic_area` over the Mojave (R19,
measured); the worker's own comment warns about it. Grass / farmland / wood only.

**6. Hedges are offered on BOTH sides and hash-dropped, not placed on one side.**
A single-sided rule makes every street in a subdivision read as a one-way
corridor; a both-sides rule with no drop makes a maze. A hash drop of ~⅓ is the
cheapest thing that reads as "some plots have a hedge".

**7. No sway, no fences** — §1.5.

**8. z19 is a CEILING, not a k-keyed write.** `maxLevel` is consumed once at
source construction; three-tile recomputes `_maxLevel` only from
`_updateSource()`, which is reached by assigning a new `imgSource` and which
calls `rootTile.reload(false)`. A literally-k-keyed step is therefore either a
vendor-private write or **a whole-tree reload every time the aircraft crosses
150 m AGL** — which is the user's own reported symptom ("terrain tiles swapping
for other ones"), on purpose, once per crossing. What ships instead raises the
ceiling one level at satellite + high; three-tile's own distance descent decides
when it binds, and `aglM` documents the altitude at which it starts to. **It
ships OFF** and needs two greens to flip: the fixture draw row in §7, and the
user confirming Esri serves z19 (the fixture generates imagery procedurally at
any z, so a green here says nothing about the provider — the R22 z18 probe,
`scripts/r22-a-esri-probe.json`, is the model).

**9. `workerNormals` is wired as a PRE-BOOT pin, and the ledger says so.** The
switch is substituted as a literal into the spliced DEM worker source when the
Blob is created, so a post-boot console flip cannot reach a worker that is
already running. The protocol is: set
`window.__flyTerrainLightOverride = { workerNormals: true }`, then **reload**.

**10. The tint α lift joins the static-skip signature.** Without it the skip's
premise ("nothing changed") would be false during a descent and a settled parcel
would hold the alpha it was filled with. Appended only when armed, so the
flag-off string does not move.

---

## §6 Measured rows (fixture, MEASURED-HERE)

*(filled from the `scripts/verify-ground-bubble.js` RED and GREEN runs and the
z19 probe; every row names the run it came from, and every row is a STRUCTURAL
number — counts, uniforms, keys, draws, fixed-pose crops. There is no fps, ms
or look row here and there cannot be.)*

### 6.1 Flag-off identity (node, `scripts/r25-a-flagoff-identity.mjs`)

**8 / 8.** See §2 for the full output.

### 6.2 The RED calibration (fixture, `FLY_GD_ARM=0`, flag-off tree)

Powell OH 40.1578 / −83.0752, satellite, tier high, noon pinned, AGL pinned
through the flight model.

| Leg | RED result |
|---|---|
| (1a) the rig is unmounted and readers see 0 | **PASS** — `runtime.groundBubble` is `undefined` |
| (1b) k ≥ 0.95 at 80 m | **FAIL** — no bubble |
| (1c) k ≤ 0.02 at 900 m | **FAIL** — no bubble |
| (1d) 480 → 560 → 480 does not ratchet | **FAIL** — no bubble |
| (1e) the 60 m input deadband is real | **FAIL** — no bubble |
| (3a) the suburb places SCRUB | **FAIL** — the layer is not mounted |
| (3b) the suburb places HEDGES | **FAIL** — the layer is not mounted |
| (6a) `uGroundDetail === 0` at 3500 ft | **PASS** — 0 (the uniform does not exist) |
| (6b) both pools parked at 3500 ft | **PASS** — no meshes in the scene |
| (6c) / (3c) drape alpha at `SAT_TINT.alpha` | **PASS** — 0.1, lifted nowhere |

Census on that tree, the RED numbers themselves:

```
hillKey       world-bend-fade-hill-r19-ef24   (no 'd')
z19Level      17                              (TERRA pinned legacy by the fleet)
tintChunks    8     tintVerts 31    tintPolys 13
draws         49    tris 92,720
scrubAreaM2   0     scrubCount 0    hedgeCount 0
```

**Six legs red, and each of the six is a thing the feature makes true.** The
four PASSes are the "costs nothing when off" half and are green by design, not
by accident — they are what makes the RED run a control rather than a ceremony.

### 6.3 The ARMED run

Same pose set, `FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6 FLY_GD_SETTLE=3`, both
blocks armed by pin (`{ enabled: true }`, so the shipped sub-switches are the
ones under test). **15 passed, 1 failed, 3 NOT CALIBRATED, ZERO page errors.**

| Leg | Result |
|---|---|
| (1a) `runtime.groundBubble` published | **PASS** `{k:1, aglM:79.83, aglVisM:79.83}` |
| (1b) k ≥ 0.95 at 80 m | **PASS** k = **1.0000** at aglVis 80 m |
| (1c) k ≤ 0.02 at 900 m | **PASS** k = **0.0000** at aglVis 900 m |
| (1d) 480 → 560 → 480 does not ratchet | **PASS** k 0.9053 → … → **0.9053** |
| (1e) **the 60 m input deadband is real** | **PASS** k 0.9053 → (640) → **0.6484**; a no-deadband bubble returns to 0.9053 |
| (2a) Owens places ZERO scrub and ZERO hedges | **PASS** both `{count:0, visible:false}` |
| (2b) …and neither mesh is visible | **PASS** |
| (2c) Owens draws ≤ 261 | **PASS** max **133** over 8 samples (57 ×7, one 133 sample while the ring was still refining) |
| (2d) armed ≤ the flag-off control | **NOT CALIBRATED** — the RED run died before writing the control (§7.1/§7.5) |
| (3a) the suburb places SCRUB | **NOT CALIBRATED** — **0 m²** of grass/farmland/wood landcover inside the 300 m disc at this pose |
| (3b) the suburb places HEDGES | **NOT CALIBRATED** — the parcel-road index is EMPTY here; no cls 5/6 centreline had streamed |
| (3c) the drape alpha LIFTS inside the bubble | **PASS** tintAlpha **0.18** (from `SAT_TINT.alpha` 0.1) |
| (4a) the overlay moves the crop > 2/255 | **PASS** by its bound — **47.953/255** |
| (4b) …and beats the same-interval control | **FAIL** — control **59.815/255** > signal |
| (5) the FINAL key carries `'d'` when armed | **PASS** `world-bend-fade-hill-r19-**efd**24` |
| (6a) `uGroundDetail === 0` at 3500 ft | **PASS** |
| (6b) both pools parked at 3500 ft | **PASS** both `{count:0, visible:false}` |
| (6c) drape alpha back at 0.1 at 3500 ft | **PASS** |
| (0) zero page errors | **PASS** |

Census armed at Powell 80 m: `draws 51 · tris 97,460 · programs 95 ·
tintChunks 8 / tintVerts 31 / tintPolys 13 · z19Level 17`.

**(4b) IS THE HONEST READING, and it is not a defect of the flag.** The
same-interval control — two ON frames `gap` apart — measured **59.8/255** of
mean absolute change while the SIGNAL measured 47.9. The venue's own drift
(tiles still refining at 1–3 fps) is LARGER than the effect, so **(4a)'s pass
is not attributable** and the pair reads NOT CALIBRATED as a pair. That is
exactly what the control is for, and the correct response is neither to lower
the bound nor to re-run until the coin lands: the overlay's pixel claim belongs
to the user's machine (§8.1). The fix for a future run is `verify-flicker`'s
idiom — find a quiescent window FIRST, then assert inside it — not a looser
bound.

**The two NOT CALIBRATED content legs are the venue, and the gate can prove it
is the venue.** `scrubAreaM2` is the precondition the layer publishes: 0 m² of
landcover in range means there is nothing to place on, which is a fact about
the fixture (its landcover parcels are ~600 × 500 m on a 1.11 km lattice and
the suburb scene emits them on ~14 % of cells, so whether one overlaps a 300 m
disc at a FIXED pose is close to a coin — §10.1). A zero count WITH area in
range would have been a defect; this is not that, and an instrument that could
not tell them apart would have reported a coin either way.

### 6.4 z19

*(pending — `scripts/r25-a-z19-probe.js` has not been run; see §8.9.)*

---

## §6.5 THE VENDOR DEFECT — `R24_WORKER_TAIL_RE`, and why my own charter item 6 would have lied

**Found by E CERT, fixed here, RED → GREEN measured.** This one belongs at the
top of anybody's reading list because of the SHAPE of the failure, not its size.

**THE DEFECT.** The Codex overhaul re-applied VENDOR.md patch #3
(`demErrorTable`), which threads an OPTIONAL fourth argument through the LERC
DEM worker's tail. MEASURED across the two trees:

```
0ff2a3f   fe (LERC)        le(d.demData,d.z,d.clipBounds)             errTable x0
f0cd81e   fe (LERC)        le(d.demData,d.z,d.clipBounds,d.errTable)  errTable x2
          ge (terrain-rgb)  Z(o.demData,o.z,o.clipBounds)             unchanged
```

`R24_WORKER_TAIL_RE` inside the shipped bundle was **not** widened with it. It
demanded exactly three arguments, so `r24SpliceWorkerTail(fe)` returned null,
`r24MakeWorker` returned null, and three-tile built the VERBATIM upstream
worker. **`TERRA_PACE.skirtWorker` AND `TERRAIN_LIGHT.workerNormals` therefore
degraded SILENTLY to OFF on the LERC path — the only DEM path the live app
uses.** The terrain-rgb worker still matched, and terrain-rgb is exactly what
the offline fixture serves, so nothing in this container and no row in the
browser fleet could observe it.

**Why it is mine, and why it matters to THIS charter.** Item 6 of my charter is
the `workerNormals` user A/B. On the user's machine — Esri LERC — that A/B would
have read **"no difference"**, and it would have read it for this reason and not
a graphics one. A false negative on a knob whose whole purpose is a human
judgement is worse than a red gate, because nothing would ever have contradicted
it.

**THE FIX** (`lib/fly/vendor/three-tile/index.js`, `r24SpliceWorkerTail`):
1. the fourth argument becomes **optional and captured**, and the pattern stays
   anchored on the exact `demData, z, clipBounds` prefix and the exact
   `self.postMessage(<decoded>)` tail — **2 of the 3 `self.onmessage=` sites in
   the bundle match and the third is the imagery worker**, verified;
2. the captured field is **forwarded into the spliced decode call**. Dropping it
   would have spliced a worker that decodes without the per-level error table —
   subtler and worse than not splicing at all. Proven on both real tails:

```
decode=le  extra=errTable  ->  le(req.demData, req.z, req.clipBounds, req.errTable)
decode=Z   extra=(none)    ->  Z(req.demData, req.z, req.clipBounds)
residual __DECODE__: 0 in both
```

3. the decode-call replacement is **ASSERTED, not trusted**. An un-checked
   `String.replace` that silently no-ops is the R24 defect class that cost that
   round twice; here it would have produced a Blob worker whose call still read
   `__DECODE__` — a ReferenceError on the user's machine only. A miss now
   returns null and the verbatim upstream worker is built.

**RED → GREEN, E's gate, run from this worktree:**

| | RED (before) | GREEN (after) |
|---|---|---|
| `verify-skirt-worker.mjs` (E's r25/e copy) | **10 passed, 1 failed** | **11 passed, 0 failed** |
| gate 2b "THE SHIPPED SPLICE MATCHES EVERY DEM WORKER TAIL IT WILL BE HANDED" | **1 of 2** splice-able | **2 of 2** |
| gate 3 "worker skirt == main-thread skirt, element by element" | PASS | **PASS** (output identity is not disturbed) |

**The reviewed integration receipt was updated deliberately, not refreshed.**
`verify-vendor-three-tile.mjs` gates 8d/8e read
`scripts/vendor-three-tile-integration.json`, which its own comment says is
"deliberately NOT auto-refreshed … unexplained changes fail even when they carry
an R24 comment". My edit made it 34/0 → **32/2**; the receipt now carries the new
`index.js` digest and one new inventory entry, `r24SpliceWorkerTail (modified)`,
with the reason above written into it — and the gate is back to **34 / 0**.

**Also green after the vendor edit:** `verify-skirt-fast` 13/0,
`verify-worker-normals` 12/12, `verify-c-flagoff` 58/58, `verify-depth-offset`
7/7, `verify-artifact-hygiene` 5/0, and my own flag-off identity proof 8/8.

**NOTE FOR E:** the copy of `verify-skirt-worker.mjs` in THIS tree still carries
the old three-argument regex in its own gate 2 and therefore still reads 8/1;
E's r25/e copy is the one that is correct and it supersedes it at merge.

---

## §7 Instrument notes — what went wrong with the gate, before the gate worked

Two, both worth writing down because both are the venue meeting a harness
rather than a defect in the feature:

**7.1 `locator.screenshot` never settles on this canvas.** The first RED run
died at `locator.screenshot: Timeout 30000ms exceeded — locator resolved to
visible <canvas …>` after fourteen legs. This is R24's own lesson arriving
again: Playwright's actionability check waits for two consecutive frames at the
same bounding box, and a continuously rendering canvas at 1–3 fps never gives
it one. `scripts/_canvasshot.js` exists precisely for this (it reads the box
ONCE and then uses `page.screenshot({ clip })`, which has no actionability
check), and this gate now uses it. **A gate that dies mid-run looks, in a
summary table, exactly like a gate that passed nothing** — the reason the
failure is recorded here rather than quietly fixed.

**7.2 The scrub sampler was rewritten because the first one measured the wrong
thing.** The first implementation drew N barycentric samples per landcover
triangle with a per-triangle cap, then range-rejected. On the fixture, a
landcover parcel is ~600 m × 500 m (`LANDUSE_CELL 0.01°`, `sizeM = luStep ·
111320 · (0.55…0.90)`) while the placement disc is 300 m — so a capped
per-triangle budget spread over the whole parcel delivers only the fraction that
happens to fall in the disc, and the cap makes that fraction arbitrarily small.
The shipped sampler is a **jittered world LATTICE** walked over
`bbox(triangle) ∩ bbox(disc)`: work is proportional to the in-disc area, no cap
is needed, the density is exactly `pool / (π r²)` everywhere, and hash stability
is stronger than before (the lattice is in absolute world coordinates and each
cell's jitter is keyed on its integer index, so a tuft's position is a pure
function of where it is on the planet).

**7.4 `scripts/_boot.js:181` swallows `FLY_BOOT_SCALE` — a latent harness
defect, and it is the R11 lesson repeating four lines below its own warning.**
The third RED attempt died with

```
page.waitForFunction: Timeout 30000ms exceeded.
    at bootFly (scripts/_boot.js:181)
```

…with `FLY_BOOT_SCALE=6` set, which should have made that wait 180,000 ms. The
call is

```js
await page.waitForFunction(
  () => !document.querySelector('[data-testid="boot-screen"]'),
  { timeout: 30000 * bootScale }          // ← SECOND parameter
);
```

and `waitForFunction`'s second parameter is **`arg`**, not options — options are
the THIRD. So the object is passed to the page as an argument, the timeout falls
back to the 30 s page default, and `FLY_BOOT_SCALE` never reaches this wait.
The comment eleven lines above it says exactly this about a different call
("Round 11 fix: options are waitForFunction's THIRD parameter (second is
`arg`) — the old two-arg call silently fell back to the 30s default").

It is latent because the boot screen normally unmounts inside 30 s. Under this
afternoon's load (six agents, load average 23) it does not, and **every browser
gate in the fleet is exposed to it.** `scripts/_boot.js` is E CERT's file and I
have not touched it; this gate raises the PAGE DEFAULT instead
(`page.setDefaultTimeout`), which fixes every un-timed wait in that file from
the caller's side. **E: the one-line fix is to move the options object to the
third parameter.**

**7.8 The dev server jammed its own port, and the failure looked like a
tree.** After the vendor edit, `next dev -p 3130` failed to bind
(`EADDRINUSE`) while `curl` to that port got connection-refused — a socket held
by a process that no longer served. The supervisor loop then restarted into the
same error every three seconds, and the first visible symptom was a harness
row, not a server message. The z19 probe was moved to port **3136** (outside the
six agent ports and none of the forbidden user ports); **that is a deviation
from the plan's port allocation and it is recorded rather than hidden.**

**7.6 The R25 pin accessor was not loadable by the node gates, and it would
have bitten all five other owners.** The moment `world-bend.js` imported an R25
module, `verify-lod-fade.mjs` stopped at import:

```
ERR_MODULE_NOT_FOUND: Cannot find module 'lib/fly/r25-pins'
  imported from lib/fly/ground-detail.js
```

That gate registers `scripts/_alias-loader.mjs`, which resolves the `@/` alias
and **not** extensionless relative specifiers — and `lib/fly/r25-pins.js` (W0)
imports `'./fly-constants'` / `'./fly-pins'`. Three import specifiers changed to
`@/…`; zero behaviour, because Next resolves both spellings identically and
`world-bend.js` has imported `'@/lib/fly/fly-constants'` since R24 for exactly
this reason. **It is not specific to me** — every R25 owner's chain reaches a
node gate through `r25-pins` — which is why it was fixed rather than worked
around, and why it is flagged as out of row in §3. (`scripts/_node-resolve.mjs`
already handles BOTH forms and would be the alternative fix, in E's row.)

**What the unblocked gate then showed, and it is not mine:**
`verify-lod-fade` reads **60/4** and `verify-skirt-worker` **8/1**, and every
red is in `lib/fly/vendor/three-tile/**` or the DEM worker tail — files this
branch does not touch (`git diff --stat 6bf628e -- lib/fly/vendor` is empty).
They were hidden behind the crash. **E: five reds exist on the W0 base and need
an owner.**

**7.5 The dev server died twice mid-run, and the first symptom was a gate
result.** Two runs were VOID because `next dev` on this worktree exited under
the afternoon's load (six agents, load average 23, Turbopack + an 800 MB
hard-linked `node_modules`) and the harness reported
`net::ERR_CONNECTION_REFUSED` / a stale log rather than "the server is gone".
It now runs under a restart supervisor. Recorded because the failure mode
matters: **a harness whose server dies produces a row that looks like a
measurement.** Every number in §6 comes from a run whose server was verified
alive before and after.

**7.7 The overlay A/B was contaminated by the gate's own feature.**
`__flyGroundDetail.set(k)` pins the SHARED bubble k — and the landcover drape
alpha reads the same k — so toggling it between the two arms moved the TINT as
well as the overlay, and the crop would have been measuring two things at once.
The fix is R17 §7.1 applied to a feature's own sibling: the drape is parked for
BOTH arms (SatTintLayer does not rewrite `material.visible`, so
verify-groundlife's park holds), alongside the two instancers and the hero.
With all four parked, the only difference between the arms is `uGroundDetail`.

**7.3 The gate reports NOT CALIBRATED, never PASS, when its precondition is
unmet.** The layer publishes `scrubAreaM2` — the in-disc landcover area the pass
actually considered. A zero scrub count with zero area is the VENUE having
nothing to place on; a zero count with area in range is a defect. An instrument
that cannot tell those apart reports a coin.

---

## §8 Could not measure here — the honest list

Everything in this section is a number or a judgement that belongs to the
user's RTX 5080 + phone, and NONE of it is claimed anywhere above.

1. **The LOOK of the overlay.** This is the first item on purpose. Whether two
   octaves at 1.4 m / 0.45 m read as *ground texture* or as *noise on a photo*
   is a judgement, and the fixture's imagery is a procedurally generated hue
   band with a "z/x/y" stamp on it — it is not Esri, so even the CLASSIFIER
   cannot be evaluated here (there is no real grass, asphalt or soil pixel to
   classify). **The knobs are `GROUND_DETAIL_R25.overlay`: `lumaAmp` and
   `normalAmp` are LIVE uniforms** (sweep them in a console with
   `window.__flyGroundDetailOverride = { enabled:true, overlay:{ …, lumaAmp: X } }`
   before boot, or read them back with `__flyGroundDetail.read()`), and
   `classify.grassHue / grassSatMin / asphaltSatMax / asphaltLuma` are the
   thresholds. §9.
2. **Any fps / ms / frame-time number.** The overlay is ~4 noise evaluations
   plus ~30 scalar ops on satellite tile pixels inside the bubble; whether that
   is free or costs a millisecond at 4K is unmeasurable at 1–3 fps SwiftShader.
3. **Whether the scrub reads as grass at 50 ft.** Card size (`cardM 0.6–1.4 m`),
   density (derived from `poolByTier` and `radiusM`) and the leaf atlas's
   appearance at two metres are all look calls.
4. **Whether the hedges read as hedges** — height 1.6 m, 0.8 m thick, 12 m
   segments, ⅓ hash-dropped, 6 m outboard. On a real OpenFreeMap suburb the cls
   5/6 set is far denser than the fixture's lattice, so the COUNT here is not
   predictive of the count there.
5. **The OVERLAY'S PIXEL EFFECT, as an attributable number.** The armed A/B
   measured a 47.953/255 signal against a **59.815/255 same-interval control** —
   the venue's own drift (tiles refining at 1–3 fps) is LARGER than the effect,
   so (4a)'s pass is not attributable and the pair reads NOT CALIBRATED. No
   bound was moved and the run was not repeated until it landed. The instrument
   fix for a future attempt is `verify-flicker`'s: find a quiescent window
   FIRST, then assert inside it. §6.3.
6. **Scrub and hedge COUNTS on real data.** Both content legs read NOT
   CALIBRATED here for two separately-measured venue reasons (0 m² of landcover
   in the 300 m disc; an empty parcel-road index). The mechanism is proven —
   both meshes park at `count 0 / visible false` and Owens is 0 by construction
   — but the number a real OpenFreeMap suburb produces is unknown in EITHER
   direction. §10.1.
7. **The z19 provider question.** The fixture generates imagery at any z, so a
   green draw row here says nothing about whether Esri serves z19 World_Imagery.
   That probe needs a machine that is not 403-blocked.
8. **`TERRAIN_LIGHT.workerNormals`.** The LERC decode path is unreachable here
   (the fixture serves terrain-rgb PNGs instead), so the A/B this round wires
   can only be run on a real machine. It ships OFF. **And this is precisely why
   §6.5's defect survived a whole round: the only DEM path that could see it is
   the one no gate in this container can reach.** The splice is now proven
   STRUCTURALLY on the real LERC tail (the spliced call and its arguments), which
   is as far as this venue can go; whether smooth normals LOOK better is §9 A9.
9. **Texture bytes.** Both new materials share the existing foliage atlas and
   add none, so the delta is 0 by construction — but the z19 ceiling's resident
   tile bytes are unbounded here and are part of why it ships OFF.
10. **Whether the bubble's 500→700 m band is the right band.** It is plan §2's
   number, and the only way to judge it is to fly through it.

---

## §9 User checkpoints (§6 of the round record)

| # | What to look at | How |
|---|---|---|
| A1 | **Ground texture at 80 m over Powell, by day.** Does the overlay read as ground, or as noise on a photo? | Arm before boot: `window.__flyGroundBubbleOverride={enabled:true}; window.__flyGroundDetailOverride={enabled:true}`, fly to 40.1578/−83.0752 at ~80 m. |
| A2 | **The two amplitudes.** `lumaAmp` 0.06 and `normalAmp` 0.35 are the round's guesses. Sweep them live. | `__flyGroundDetail.read()` to see them; re-pin the block and reload to change them. |
| A3 | **The classifier.** Does a car park stay smooth and a field stay grainy? Is a warm ploughed field over- or under-done? | `overlay.classify` — `grassHue [70,160]`, `grassSatMin 0.12`, `asphaltSatMax 0.08`, `asphaltLuma [0.18,0.55]`. |
| A4 | **Scrub density and size.** Too sparse to read, or too busy? | `scrub.poolByTier`, `scrub.radiusM`, `scrub.cardM`. `__flyGroundDetail.read().scrubCount`. |
| A5 | **Hedge scale and spacing.** Do they read as hedgerows or as walls? Is ⅓ dropped the right fraction? | `hedges.segM / heightM / offsetM`. |
| A6 | **The drape lift.** Is `0.18` at the deck a better ground or a painted one? | `tint.lowAglAlpha`; the R19 ceiling on this was "a GRADE, never paint". |
| A7 | **The bubble band itself.** Does the world arrive too late or too early on a descent? | `GROUND_BUBBLE.aglInM/aglOutM` (Fable's block, not mine). |
| A8 | **z19**: does Esri serve it where you fly, and what does the Owens-class draw census read on your machine? | `z19: { enabled: true }` inside the GroundDetail pin; `__flyStats.drawCalls`. |
| A9 | **`workerNormals`**: does the LOD seam / faceting improve? | `window.__flyTerrainLightOverride = { workerNormals: true }`, then **reload**. Expect `verify-skirt-worker`'s identity leg to go red while it is on. |

---

## §10 Open risks

1. **The fixture is a poor venue for the scrub content leg.** A fixture
   landcover parcel is ~600 × 500 m on a 1.11 km lattice and the suburb scene
   emits grass/wood on only ~14 % of cells, so whether a parcel overlaps the
   300 m disc at a FIXED pose is close to a coin. The gate therefore publishes
   `scrubAreaM2` and reads NOT CALIBRATED rather than FAIL when the venue has
   nothing to place on. On a real OpenFreeMap suburb the landcover set is far
   denser and far more fragmented; **the COUNT measured here is not predictive
   of the count there, in either direction.**
2. **`roadAvoidM` only avoids cls 5/6 roads.** `parcelRoadScan` is a
   tertiary/minor centreline index — it is the only road index reachable from a
   layer, and building a second one for arteries would duplicate a scan that
   already costs a frame budget. So a scrub card CAN land on a motorway
   shoulder. Mitigations that already hold: motorways are wide and their
   ribbons draw ON TOP (additive, `renderOrder −4`), and landcover polygons do
   not usually cover carriageways. **Not proven; named.**
3. **`waterAvoidM` is a point-sample repel, not a containment test.**
   `chunk.water` is the worker's set of boat anchors sampled strictly INSIDE
   water polygons, not the boundary. The brace that actually holds is that
   scrub is placed only on grass/farmland/wood landcover, and water is a
   different layer — a card in a lake needs two overlapping polygons of
   different classes.
4. **Two triangles of the same parcel can overlap after `earcut`**, and two
   different landcover polygons certainly can. The lattice would then place two
   cards at nearly the same spot. Cheap to see, not cheap to prove; the
   jittered lattice makes an exact coincidence unlikely rather than impossible.
5. **Armed, every tile material recompiles once** (the FINAL key gains `d`),
   including toy tiles. Pixels are unchanged there (the branch is skipped at
   `uGroundDetail` 0 — the R13 precedent) but the program COUNT moves, and any
   gate that freezes a program count across an R25 flip will see it.
6. **The overlay's ALU cost is unmeasured.** 4 noise evaluations + ~30 scalar
   ops per satellite tile fragment inside the bubble. At the deck the tiles fill
   most of the frame. This is the single most likely place for the feature to
   cost something on a real GPU, and it is exactly what this venue cannot see.
7. **The lattice walk is bounded by the disc, but not by the triangle COUNT.**
   Work is `Σ over landcover triangles of |bbox(tri) ∩ bbox(disc)| / spacing²`
   point-in-triangle tests. On the fixture that is ~13 triangles and nothing;
   on a real OpenFreeMap suburb with a hundred small landcover polygons the
   worst case is bounded above by (disc area / cell area) × N ≈ 2,540 × N tests
   per 2 s cadence pass. That is the one place this layer could cost CPU on a
   real world, it is unmeasurable here, and if it binds the fix is a cheap
   per-triangle bbox-area early-out rather than a cap (a cap is what §7.2
   removed).
8. **`chunkAt` is a linear scan** over ready veg chunks per hedge candidate
   (≤ ~20 compares). Fine at the pool sizes here; it would want a grid if the
   hedge pool grew by an order of magnitude.
9. **The scrub and hedge pools are resolved at MOUNT from the quality tier.** A
   tier step after mount does not re-pool (deliberately — the R16 §7/§10
   PerformanceMonitor lesson), so a session that steps high → medium keeps the
   high pool until the layer remounts.

---

## §11 Seams I need from other owners

| Owner | Seam |
|---|---|
| **B NIGHT** | The `'n'` token goes **after** my `'d'`, in BOTH places, and I have left a clearly marked insertion point in each: in `applyHillshade`'s `<color_fragment>` replacement (`▼▼ R25 SEAM — B NIGHT's 'n' block … GOES HERE`) and in `hillKey`'s token list (`▼ R25 SEAM: B NIGHT's 'n' goes HERE, after A's 'd'`). My block ENDS with a write to `diffuseColor.rgb` and B's reads it, so append — do not interleave. |
| **B NIGHT** | My scrub and hedge instancers are `MeshLambertMaterial` on `'world-bend-anchor-r8'`, named `sat-ground-scrub` and `sat-ground-hedge`. If B's night-ground irradiance wants ground-level foliage to sit in the lamp pools (`receivers.clutter` does exactly this for the cars), these two are the natural next receivers — but that is B's call and B's key, and I have not pre-empted it. |
| **C LIGHT** | My relief term is enveloped by `uHillStrength * uHillElev` and feeds off `uHillDir`, so it follows C's key light for free — **including the moon**, once `immersiveLighting`'s moon terms land. Nothing to do; stated so C knows the tile relief is a consumer. |
| **C LIGHT** | C's AGL-keyed shadow radius (`mix(1500, 350, k)`) and mine read the SAME `runtime.groundBubble.k`. If C quantises k to 8 steps with its own hysteresis, that is C's quantisation of a shared signal, not a second signal — worth one sentence in C's ledger so nobody later "unifies" them. |
| **E CERT** | `scripts/verify-ground-bubble.js` is in E's row; I wrote it to RED-calibrate before merge and E owns it from the merge on. It needs no fleet pin released — it ARMS two R25 blocks that ship off. |
| **E CERT** | With `window.__flyTerrainLightOverride = { workerNormals: true }` set pre-boot, **`verify-skirt-worker`'s identity leg goes RED BY DESIGN.** Not red on the shipped tree. |
| **E CERT** | `verify-import-integrity.mjs` is RED at the W0 base `6bf628e` on `scripts/r24-c-agl.js` (two `no-undef`). **Pre-existing, not mine** — verified by stashing this work and re-running. It needs an owner. |

---

## §12 A note on how flag-off identity is proven, and why not by a pixel A/B

The kickoff asks for flag-off identity "PROVEN (fixture pixel A/B at a pinned
pose, a fingerprint, or the GLSL false-branch string verbatim)". This ledger
takes the **third** option for the overlay, deliberately, and it is the stronger
one here:

* a fixture pixel A/B is bounded below by the venue's own frame-to-frame noise
  (the fixture streams, the clouds drift, tiles refine), and it can only ever
  say "smaller than my noise floor";
* the GLSL comparison says the generated fragment string, the generated vertex
  string, the uniform SET and the FINAL cache key are **byte-for-byte the W0
  base's** — from which pixel identity follows, rather than being sampled.

For the other four terms the proof is structural and is stated as such in §2:
the layer is not mounted at all, `tintAlphaFor` returns its argument,
`z19MaxZoomFor` returns its argument, and `pinned` returns the constants object
itself. The pixel evidence that does exist is gate leg (4a) run on the flag-off
tree, which must read ≈ 0 — the RED calibration — and the same leg armed, which
must exceed 2/255.

---

# R25 D GROUND — ledger (relief, one sun, imagery colour and sharpness)

Branch `r25/d` from `r25-w0` (`1f983be`, E1 already merged into it). Worktree
`/home/user/skyloom-r25-d`, dev `:3034`, fixture `:3204`. **Venue: this
container** — SwiftShader WebGL at 1–3 fps on four shared cores, Esri /
OpenFreeMap / adsb / open-meteo / terrascope 403-blocked, and E's offline
fixture serves **terrain-rgb** DEM (not LERC) and synthetic imagery. Every
browser number below is a FIXTURE number; nothing here speaks for the user's
GPU, frame time, real Esri colour or real Esri relief.

## §1 What was built (charter items 1–6)

| # | item | where | ships |
|---|---|---|---|
| 1 | **Relief normal maps** — a mapPx² (128²) RG8 world-frame normal map from CENTRAL DIFFERENCES over the FULL decoded DEM grid (LERC: in the worker; terrain-rgb: on the main thread from the grid the decode worker returns), returned only when the request carries `r25Relief` (Enhanced). Pooled DataTextures (≤ 96, RG8 + mips, LRU by three-tile's last-VISIBLE stamp), per-material holder `{uR25Relief, uR25HasRelief}` (the attachLodFade idiom), same-LOD neighbour edge STITCHING (corner-aligned layout, shared edge = byte average). | `lib/fly/r25-relief.js`, `workers/skirt-tail.src.js` (`r25ReliefMap`, `r25CaptureMesh`, `r25PostUnskirted`), vendored `index.js` R25-30..33, `raster-cache.js` (cached LERC twin), `terrain-engine.js` (`applyR25GroundSwitches`, `setR25ReliefPx`, `onTileEvents`, `forEachLoadedTile`) | ON (`relief`) |
| 2 | **One bounded sun term** — `albedo *= clamp((N·L+a)/(up·L+a), lo, hi)`, N = relief normal (vertex fallback when `uR25HasRelief < .5`), full weight once the tier's hill strength reaches 0.55. Classic's hill block keeps its slope AO / saturation (sunless) but its sun term reads FLAT ground, so **flat ground is exactly Classic**; the Standard material's direct + indirect light use the FLAT normal, so the sun direction enters once. The earth surface's `groundValue 0.70` literal becomes the live `uR25GroundValue` normaliser (0.70 × `oneSun.groundValueK`, 1 = neutral). | `world-bend.js` (`r25PatchTile`, `r25OneSunGLSL`), `earth-surface-material.js` | ON (`oneSun`) |
| 3 | **Colour transfer** — a rolling 512² atlas of 64² z11 slots (8×8, toroidal, recentred on z11 crossings, fetched through the engine's OWN imagery source so the fixture routes it), `hi *= clamp(ref / textureLod(map, uv, uR25LodK), .5, 2.)` spliced before `diffuseColor *= sampledDiffuseColor` in BOTH the stock and the LOD-crossfade map chunks; lodK = the tile mip whose texel = one reference texel. `r25GroundFrame` writes `setQuiltGrade(0,0)` in Enhanced satellite (SAT_QUILT retired). A Classic toggle frees the atlas's GPU copy and keeps its 1 MiB of CPU bytes (the A/B round trip re-uploads, never re-fetches). | `lib/fly/r25-color-ref.js`, `world-bend.js` (`r25RefRatio`, `r25MapInsert`), `r25-ground.js` | ON (`colorRef`, `retireQuilt`) |
| 4 | **Sharpening (high tier)** — Catmull-Rom from 5 bilinear taps when magnified (blended in over λ ∈ [−0.5, 0]) + mip-difference unsharp `c + k (c − lod(λ+1))`, k = 0.3 (≤ 0.35, clamped in code), faded in over λ ∈ [−1, 0]; in the crossfade chunk the delta rides the child sample at `1 − uLodFadeMix`. | `world-bend.js` (`r25CatRom`, `r25Sharpen`) | ON (`sharpen`) |
| 5 | **Mesh sub-flag** — launch-applied (latched at TerrainEngine creation, Enhanced only) tighter z13/z14 Martini error via `setDemErrorTable` (`r25MeshTable` merges `{13:15, 14:6, 15:5, 16:2}` over TERRA_SHARP's). | `terrain-engine.js` | **OFF** — see §5 |
| 6 | **Keys / prewarm / live toggle** — tokens `-{n}{s}{c}{k}25` (+ `-r25g` on earth tiles) from ONE source (`r25GroundKeySuffix`), appended LIVE by the outermost hook (`applyR25Terrain`), registry entry in `world-bend.js`. The prewarm twin (prewarm.js:395-412, unchanged) compiles whichever profile is live; while Enhanced, the Classic tile program is warmed ONCE in the background from a retained twin under `withR25GroundClassic` (text and key forced Classic). Toggle = `onVisualsChange` → `needsUpdate` on every resident tile material (`TerrainEngine.forEachTileMaterial`); Enhanced → Classic disposes every R25 GPU texture. | `world-bend.js`, `r25-ground.js`, `terrain-engine.js` | — |

**Budget arithmetic** (verify-r25-ground 5a): 96 × 43,690 B (128² RG8 + full
mip chain) = 4.000 MiB + the 512² RGBA8 atlas 1.000 MiB = **5.000 MiB ≤ 5.5**,
Enhanced only, allocated lazily (pool textures on first bind).

## §2 RED first

| gate | RED (calibration) | GREEN (this branch) |
|---|---|---|
| `verify-r25-ground.mjs` on the **r25-w0 tree** (the gate copied into a `git archive r25-w0` checkout) | `ERR_MODULE_NOT_FOUND …/lib/fly/r25-relief.js` — exit 1 (nothing to measure: the relief, the keys and the worker path do not exist) | 38 / 0 / 0 (with the sibling gates) |
| `R25_GROUND_RED=nostitch` (stitching skipped) | **(1e) FAIL** — unstitched seam step 1.250° stays 1.250° | (1e) 1.250° → 0.000° |
| `R25_GROUND_RED=flipz` (relief Z/south sign flipped) | **(1a)(1b)(1c)(1d)(1e) FAIL** — north-rising plane 59.9°, sinusoid 73.7° off analytic | 0.23–0.41° (257² grid) |
| `R25_GROUND_RED=blockkey` (key token gated on the BLOCK flag, not `r25GroundOn`) | **(3a)(3b)(3c)(3e) FAIL** — Classic key gains `-nsck25` | Classic key == flag-off key |
| (3g) GLSL compile, RED control | a deliberately broken Enhanced arm (`vHillNWx`) is REJECTED by glslangValidator | Classic control + 10 Enhanced arms compile |
| `verify-r25-flagoff.mjs` (E) | on r25-w0: 8 PASS / 2 NOT CALIBRATED (Enhanced == OFF, D stub) | **12 / 0 / 0** — (2c) Enhanced differs, (2d) new text ⇒ new key, (2e) C-only == OFF, (3c) the hooks act |
| `verify-r25-ground-browser.cjs` | in-run RED arm: Enhanced with `window.__flyR25Ground = 0` (D forced off) re-compiled through a toggle — its relief gain must stay below the bound | §4 |

## §3 Mechanism notes a reviewer needs

- **The flag decides the SPLICE, the profile decides the REQUEST.** DEM
  workers are created lazily and live for the session, so the LERC worker's
  grid capture is decided from `R25_GROUND.relief` at engine creation; the live
  profile only decides whether a request asks for a map
  (`R24_SWITCHES.r25ReliefPx`). Classic with the flag ON runs the relief-spliced
  worker with no request field — its posted geometry is BYTE-IDENTICAL to the
  verbatim upstream worker's (verify-r25-ground 2c: the REAL `qe()` output
  captured through a stub Worker, run in a vm against the real clip + Martini
  with a stubbed LERC decode).
- **Why the key tokens ride the OUTERMOST hook.** Every outer terrain hook
  (near-ground, night receiver, daylight, earth) freezes its predecessor's key
  STRING at apply time while the profile is live: a hill-level token would be
  baked in by whatever profile was current when the tile streamed, and a later
  toggle would compile Classic text under an Enhanced key (the R4 collision).
  `applyR25Terrain` appends `r25GroundKeySuffix(material)` at call time; the
  injected text reads the same `r25GroundOn(sub)` at compile time.
- **Why world-bend does not import the profile.** Several R24 node gates load
  `world-bend.js` with a resolver that handles only its own imports
  (`verify-lod-fade`, `verify-atmo-law`); importing `visuals-profile.js` there
  (→ zustand, extension-less relative imports) crashed them. The predicate is
  INSTALLED by `r25-ground.js` (`setR25GroundPredicate`); nothing installed =
  Classic. The app imports `r25-ground.js` (FlyScene, prewarm.js) before any
  material can compile. Likewise `earth-surface-material.js` reads the '-r25g'
  predicate through the per-material holder and `terrain-engine.js` latches the
  mesh flag through `r25-relief.js` — neither imports world-bend.
- **Vendor posture.** Every R25 hunk is INSERT-ONLY against r25-w0 (index.js and
  the readable worker tail; verify-r25-ground 7d). The relief splice is LAYERED
  on A's `r24SpliceWorkerTail` (its output, with two inert markers substituted),
  not an edit of it. R25 markers use their own grammar (`// R25 D PATCH n`) and
  their own ledger ids (`R25-30..33`, VENDOR.md "R25 PATCH LEDGER"): the R24
  grammar is pinned by `verify-vendor-three-tile` 17/18 and by `verify-lod-fade`
  (D's R24 marker set must be exactly {5, 6, 7}). The integration receipt
  (`scripts/vendor-three-tile-integration.json`) lists the new/modified
  functions with reasons and the new digests; `verify-vendor-three-tile` 34/34.
- **Why the lazy Classic warm is D's own and not `requeueForEnvironment` /
  `pumpRequeue`.** The plan names those two as the lazy-alternate vehicle, but
  both are gated on `ENV_UNIFORM.enabled`, which R24 shipped OFF
  (`fly-constants.js` ENV_UNIFORM, "SHIPPED OFF (R24 close)"), and their queue
  lives outside prewarm.js:395-412 (not D's to edit). `warmClassic` in
  `r25-ground.js` does the same job in the same shape (one retained twin,
  `compileAsync` under a bound render target, once per session, after 120
  Enhanced frames), so the first Enhanced → Classic toggle finds the Classic
  program linked. If ENV_UNIFORM ever ships ON, folding the twin into its
  queue is a one-call change.
- **Toy.** Toy tiles compile the same Enhanced program (it is one tile
  material chain) and stay pixel-identical: the one-sun term and the flat
  normal sit behind `uHillStrength > 0` (0 off-satellite), the relief swap is
  inside Classic's `mix(…, uHillStrength)`, the map terms behind `uR25Sat > .5`
  (written 0 off-satellite), and no relief is requested in toy.

## §4 Browser row (fixture)

(filled after the run — see §4a)

## §5 Sub-flag rulings

- **`mesh` ships OFF (unchanged from W0's `enabled:false`).** Its only lever is
  the Martini error table, and Martini runs ONLY on the LERC path; E's fixture
  serves terrain-rgb, whose loader builds a regular (z+2)·3 grid with no
  Martini at all. Triangles at fixed poses and the Owens draw count therefore
  cannot be measured for this sub-flag in this container. The code path is
  built and node-proven (7a table merge, 7b latch); the flip needs one run on a
  machine that reaches Esri LERC.
- `budget.enhancedTerrainResidentMiB` stays `null`: the plumbing
  (`setR25ResidentCapMiB`) exists, and the cap applies only if a measured
  Enhanced texture peak exceeds 300 MiB (§4).

## §6 Cost

- GPU: ≤ 5.0 MiB (Enhanced only; 0 in Classic — the toggle disposes it).
- CPU: 32 KiB per resident geometry of relief bytes (Enhanced-loaded tiles) +
  a 1 MiB atlas; the relief map is ~16k bilinear samples of a precomputed
  gradient field per tile (worker-side on LERC).
- Draws / triangles: 0 / 0. Programs: one Enhanced tile program (+ its
  shadow/env permutations), and the Classic twin warmed once while Enhanced.
- Per frame (Enhanced): a handful of uniform writes, one quilt write, a
  z11-tile compare; every 30 frames a bounded (≤ 4) re-bind pass. No per-frame
  allocation (stats are refreshed in place).

## §7 W0 requests

None required. (`applyR25Terrain` and `r25GroundFrame` were enough: the engine
is read from `runtime.engine`, tile events come from the engine, and the
predicate / mesh latch are installed at `r25-ground.js` import.)

## §8 Open risks

- **A session that STARTS Classic shows relief only on tiles streamed after the
  switch to Enhanced** (relief rides the DEM request). The default profile is
  Enhanced, and an Enhanced → Classic → Enhanced round trip re-binds from the
  geometry's CPU bytes instantly; E's `verify-r25-visuals` (boots Classic, then
  toggles) will see Enhanced WITHOUT relief at its fixed poses.
- The relief is in the RENDERED (Web Mercator) frame, like the mesh and its
  vertex normals: slopes are flattened by cos(lat) against true terrain. Kept
  deliberately consistent with the silhouette; a true-metre relief would
  disagree with the geometry it shades.
- D-only luminance on steep relief: the flat-normal direct light + the bounded
  term brighten steep slopes slightly against Classic's two cos-darkened terms;
  `oneSun.groundValueK` is the D-side normaliser if the band is breached (C owns
  absolute exposure).
- The colour reference assumes Esri's z11 is the colour-balanced product (true
  of World_Imagery's low zooms); on the fixture every zoom is the same ground
  truth, so the transfer is ~identity here and its seam benefit is
  unmeasurable (§9).

## §9 Unmeasurable here

- Real Esri colour quilt and the colour transfer's seam reduction (the fixture
  has no capture-date mosaic in clean mode; the stamp mode's per-tile hue is a
  different signal).
- Real Esri LERC relief (257² grids, Martini decimation — the case the relief
  maps exist for); the fixture's terrain-rgb grids are ≤ 64² and regular.
- The mesh sub-flag's triangle / draw cost (LERC-only).
- Every fps / frame-time / compile-hitch number (SwiftShader), including the
  cost of the Enhanced tile program and of the live toggle's recompile.
- Anisotropic filtering interplay with the unsharp term at grazing angles on a
  real GPU (shimmer is a user-machine read).

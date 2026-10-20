# Ultra by default, a real sea, sooner buildings — 2026-10-17

The owner asked for four things, in their words: visual performance
optimizations "without sacrificing any fidelity or loss of quality"; Ultra as
the desktop default; procedural 3D buildings that stop feeling delayed; and
water that no longer looks "very very basic and bland, and low quality".
Everything below landed on the session branch and was merged to `main` at the
owner's request.

**Environment truth (unchanged):** this container has no real GPU (SwiftShader)
and is blocked from Esri, OpenFreeMap and the ADS-B feeds. Shader correctness,
pixel identity and CPU costs were measured here; every fps and every look
verdict belongs to the owner's RTX 5080 and iPhone.

## 1. Ultra is the desktop default

- **Start:** `DEVICE_TIERS.ultraStart` (merged to `main` from a parallel
  session, `220ae2d`, and adopted here): with no saved pick, a desktop whose
  GPU start reads High (discrete GPUs, Apple Pro/Max/Ultra) starts on the
  Ultra preset, the High scene tier plus the Ultra effects ceiling (96-step
  clouds at 0.5 scale, three 2048 shadow cascades over 3 km, the 1024 material
  set, the 1024×512 reflection). Integrated and unknown desktop GPUs, phones and
  tablets keep their start; automation (WebDriver) keeps High so no harness
  preset moves. A saved pick still wins: a player who once chose High in
  Settings stays on High until they choose Ultra.
- **The governor no longer spends resolution first on Ultra.** With
  `DEVICE_TIERS.ladderOrder` the Ultra → High rung drops a cascade (3 → 2),
  which recompiles every lit program, so it waited behind render scale: an
  Ultra machine that missed its frame target lost resolution before anything
  else. A new `ultra-balanced` profile (`lib/fly/cinema-profile.js`) keeps
  Ultra's shadows, materials and reflection and marches clouds at High's
  density and resolution (about half Ultra's cloud cost). Ladder now: Ultra →
  Ultra-balanced → render scale → High-balanced → Low → tiers.
- **Native resolution on high-DPI displays:** Ultra on desktop renders up to
  `CANVAS.ultraDprMax` = 2× (was capped at 1.5×, i.e. 75 % of native on a
  Retina or 200 %-scaled display). 1× and 1.5× displays are unchanged.

## 2. Buildings appear sooner

The trace (every stage, with constants) found the dominant delay in the drape:
each building's ground height came from `TerrainGroundQuery`, which tested
**every triangle of every terrain tile level** under the point, ~5,400
triangle tests and ~73 µs per building. Under a 1 ms per-frame budget a
500-building block took ~37 frames just to find its ground, blocks one after
another. The R24/R25 fixture notes had recorded the symptom ("all 16 building
chunks still `draping` after 334 s").

- **Bucketed ground query** (`lib/fly/terrain-ground-query.js`): each queried
  terrain mesh gets a lazy XY grid of its non-degenerate triangles (rebuilt when
  its buffers change, freed with the geometry). A query tests only its cell's
  triangles, in the same order with the same arithmetic. Measured: **0
  mismatches in 20,000 hits against the original code, 72.9 → 2.8 µs per query
  (26×), 5,400 → 10.8 triangle tests**. It also speeds every other ground
  consumer (trees, roads, skyline, parcel homes, contact repair).
- The drape loop reads the clock once per building instead of once per vertex.
- A held chunk re-samples every 0.5 s instead of 1.5 s (`drapeRetrySec`; the
  ~30 s cap is unchanged: `drapeMaxTries` 20 → 60, warp window 3 → 9).
- **Descent arms at the fade's top:** the ring used to arm at 2200 m eye-AGL
  while the altitude fade starts revealing at 3000 m, so a descent reached the
  visible band with nothing streamed (a climb kept its chunks to 3200 m).
  `cullAglOnM` 2200 → 3000.
- **No hole at the skyline hand-off:** the far mass was cut under a detailed
  block the moment it was ready, while that block was still dithering in over
  0.4 s. The cut now follows each block's birth ramp (`uArchitectureTileK`), so
  the two Bayer patterns stay exactly complementary.
- **In the running app** (offline Manhattan fixture, Enhanced satellite,
  software GL, unscaled pacing budget `FLY_FINALIZE_BUDGET_K=1`, same scene and
  settings in both arms):

  | Building blocks placed | first | 3 of 9 | 9 of 9 |
  | --- | ---: | ---: | ---: |
  | Before (`9ba95e8`) | 619 s | 872 s | not reached (4 of 9 at 1012 s) |
  | After | 413 s | 501 s | 804 s |

  Triangle tests per ground query in the app: ~480 before, 8.8 after (137,215
  queries). These are software-rendering times, not the owner's; the arms also
  ran under different dev bundlers (webpack for the old worktree, Turbopack
  here), so read the ratio, not the seconds. First arrival is still gated by
  fine terrain streaming, which this pass does not change.
- Considered and **not shipped**: re-planning the ring every 1 s / 300 m
  (`r24-b-ringhold` measured ring-edge thrash 69 → 82, i.e. more blinking at
  the far edge); committing drapes on z10 terrain and repairing later (visible
  sinking/floating, then a vertical pop).

## 3. The sea (`SEA_STATE`, ON; `?flags=-SEA_STATE` shows the old water)

The Enhanced water is one function, `coastalWater()` in
`lib/fly/coastal-water.js`. The old version had about 1/6–1/15 of the slope
variance a real 5 m/s sea has (measured: E|∇n|² = 0.78 per unit band), and it
dropped detail too fine for a pixel instead of accounting for it, so distant
water became a flat mirror with a pin-point sun, everywhere the same teal.

- **Slope statistics from measurement:** total mean-square slope follows Cox &
  Munk (0.003 + 0.00512·U) for the live wind (`runtime.weather.wx`, damped;
  the harness baseline is the weather model's 5 m/s), split upwind/crosswind.
- **Seamless geometry → BRDF:** four resolved bands carry fixed shares of that
  variance; as a band falls below the pixel footprint its share moves into the
  sun BRDF (energy-conserving). The sun/moon uses Bruneton, Neyret &
  Holzschuch's (2010) anisotropic Gaussian microfacet lobe with Smith masking,
  and the sky reflection their mean Fresnel. Result: a physically sized,
  wind-stretched glitter path at every distance and altitude.
- **Water colour (changed 2026-10-20):** the water body first took the
  satellite imagery's own colour where it read as water. Esri World Imagery is
  a mosaic of captures, so every capture and LOD edge showed on the water as
  rectangles and stair-steps (the owner's report over the Hudson and New York
  Harbor). It now uses one physical deep-water albedo with the vector shore
  band; reef and sandbar shallows read deep blue until a seam-free colour
  source (the consistent z11 mosaic) is wired in. `scripts/verify-sea-seams.mjs`.
- **Light through backlit crests** at low sun; **0.5 m glitter facets** that
  converge to the smooth lobe as the footprint grows; **whitecaps** at the
  measured coverage for the wind (Monahan & O'Muircheartaigh 1980: ~0.1 % at
  5 m/s, 1 % at 10, 6 % at 17), with a CPU-solved threshold so near caps and the
  far mean coverage meet without a seam, and a breaking field so caps form and
  fade; **rough-water reflections** stretch the coastal city capture into
  columns.
- Cost: ALU on water pixels only. No textures, samplers, render targets or
  draws. The imagery and footprint are captured in uniform control flow.
- Offline renders, old (left) and new (right):
  [docs/sea-state-offline-renders.jpg](docs/sea-state-offline-renders.jpg).
  A flat sea under the legacy cinema sky with an approximate ACES curve, no
  clouds, haze or terrain: it shows the material, not the game's final frame.
- Evidence (container): the real GLSL rendered offline in SwiftShader over ten
  scenes (noon/golden/night, calm/gale, high/low, shallows) beside the old
  water; frame-to-frame change ≤ 18/255 with no pixel over 32 (twinkle, not
  flicker); `verify-water-field` (4096 m wrap exact, seam ≤ 1, finite unsaturated
  resolved slopes, unresolved detail retires); `?flags=-SEA_STATE` renders the
  old water **pixel-identically** through the new call site.

## 4. Lossless performance

| Change | Before | After | Pixels |
| --- | --- | --- | --- |
| Surface atlas slot uploads (`earth-surface-engine.js`) | whole 1024×1536 RGBA + R8 (~7.5 MiB) per slot change, several per band crossing | one `texSubImage2D` of the 128/256 px slot from the same CPU array | identical (GPU readback, both formats) |
| Traffic + aircraft-light buffers (`TrafficLayer.jsx`, `glow-points.js`) | every pool at full capacity every frame (~0.5 MB) | the drawn prefix only | identical (nothing past `count` is drawn) |
| n8ao composite (`n8ao-direct.js`) | composite into an internal full-res target, then copy | composite straight into the composer output when size/format match | byte-identical (browser A/B) |
| Coastal reflection (`coastal-reflection.js`) | two full scene walks per frame for lights | one | identical |
| Surface engine per-frame stats | ~20 small allocations per frame | none | n/a |

Considered and **not shipped** (pixel or hitch risk): hiding the zero-intensity
sun under the CSM rig (changes the light count, recompiles every lit program),
throttling the CSM scene walk, `matrixAutoUpdate=false` on the world root,
removing the n8ao accumulation pass (1 LSB changes).

## 5. Gates

New: `verify-atlas-subupload.mjs` (GPU readback + flush logic),
`verify-n8ao-direct.mjs` (byte identity). Repaired (each was broken or vacuous
on the tree before this pass, independent of it):

- `verify-terrain-ground-query.mjs` compared **zero** real hits: its fixture
  meshes had no material and no groups, so both paths inspected nothing and
  every comparison was miss-equals-miss. It now gives them what the tile loader
  gives real tiles, and asserts that most comparisons hit (869/875).
- `verify-render-optimization.mjs` and `verify-cinema-overhaul.mjs` modelled
  the governor ladder before `DEVICE_TIERS.ladderOrder` shipped.
- `verify-painterly-flight.mjs` mocks predated the appearance atlas.
- `verify-water-field.mjs` packs the (now realistic) slopes without clipping and
  falls back to the bundled Chromium.

App smoke (fixture, Enhanced satellite): zero shader and page errors at the
container's Low start and with Ultra forced (`ultra` profile: 3 × 2048 cascades
over 3 km, 1024 reflection, 1024 materials; governor at rung 0).

Passing on the final tree: render-optimization 22, cinema-overhaul 16,
device-tiers 5, terrain-ground-query 875 (869 hits), r24-b-ringhold 14,
city-water 5, water-field, atlas-subupload 2, n8ao-direct, painterly-flight 18,
stylized-earth 22, visual-finish 12, graphics-unit, true-scale 14,
true-earth-flags 8, ops-golden 28, ground-lighting 26, import-integrity, ESLint.

Still failing, not touched by this pass: `verify-cinematic-earth.mjs` (aircraft
presentation fields after the fleet rebuild, `9ba95e8`); the GPU halves of
`verify-phys-sky.mjs` / `verify-hdr-guard.mjs` cannot launch a browser in this
container (their node halves pass).

## Owner run list

1. **Ultra:** fresh profile on the 5080 → the HUD reads `Q ultra`; Settings →
   Ultra is selected. On a 200 %-scaled or Retina display, `?diag=1` shows
   render DPR 2.
2. **Water:** fly the Manhattan/Hudson waterfront, Sydney Harbour and a
   Caribbean coast at noon, golden hour and night, low (150 m) and high
   (3 km). Compare with `?flags=-SEA_STATE`. Try `?weather=overcast` and a windy
   live day. Watch for: glitter path toward a low sun, the moon path, no
   pattern or tiling, whitecaps only when it is windy, true shallow colours.
3. **Buildings:** descend from 4 km into a city and bank hard over downtown;
   blocks should land almost as soon as the terrain under them is sharp, with no
   hole as the far skyline hands over.
4. **Benchmark:** `?diag=1` → Benchmark 60 s at Ultra before/after
   (`git checkout 9ba95e8` for before). Report p95 and whether the governor
   stepped.

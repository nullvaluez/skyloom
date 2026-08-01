# FLY ROUND 19 — "Honest World" — ROUND RECORD

> Round CLOSED 2026-08-01. Plan: [FLY_ROUND19_PLAN.md](FLY_ROUND19_PLAN.md).
> Execution: SIX Opus 5 agents in two waves of three under Fable orchestration
> on branch `claude/round19-honest-world`; scaffolding commit `faf5e28`
> pre-seeded all seventeen R19 constants blocks `enabled:false`, moved
> WORKER_PROTOCOL 14→15 at all six pin sites in lockstep, and landed the
> `_boot.js` fleet pins (`__flyAerialOverride` / `__flySatShadowOverride` = 0)
> plus `FLY_URL`. Zero constants merge conflicts across six agents — the
> pre-seeded-disjoint-blocks idiom (R18 lesson 6) held a second round.
>
> The round was planned after a 15-minute live GPU field study (28
> screenshots, both styles, Powell OH / rural Union County / Columbus OH,
> 150 m–FL280, noon/dusk/night) that produced the twelve numbered pains
> P1–P12 in the plan's §0. Every one of them has a merge commit against it.

## 0. Why this round

R18 closed with a world that was correct in the hero downtowns and dishonest
everywhere else. The field study named four mechanisms of "flat": no
near-field atmosphere (`SKY.haze.startM 16000` leaves every fragment inside
16 km mathematically unattenuated, and buildings/veg/roads carried no haze at
all), imagery ~8× under-sampled (`satMaxZoom 16` ≈ 1.83 m/px at 40°N against
0.22 m/px screen-resolved at 300 m AGL, aniso 4 applied statically), hillshade
that degenerates to a uniform brightness multiply on flat Ohio DEM, and
nothing casting a shadow in satellite at all. On top of that sat the standing
R18 headline candidate — the toy/Neon winding defect — plus a sky with no
dusk, a suburbia built out of tower clones, and no speed sensation at 793 kt.

User decisions (plan §1): fold in the Neon fix, spend the high-tier headroom
(medium/low byte-identical to R18), do all four priorities, and give the sky a
real dusk with a procedural weather fallback that is never absent.

## 1. THE headline — Neon gets its world back (F REWIND)

R18 §1 found `classifyRings` hard-coding `signedArea > 0 = exterior`, a sign
that is wrong for every polygon layer OpenFreeMap ships, and fixed it
satellite-side only (`classifyRingsSat`, winding-agnostic). Toy carried the
identical defect at three frozen call sites — `polygonPass` land/water, toy
buildings, toy scatter — dropping ~99% of toy polygons. R19 landed the fix
behind `NEON_COVER` with full re-certification.

**Powell OH went from EVERY polygon layer classifying to zero — a black void
with roads on ink — to a real town.** The fix itself is three dispatch sites:
`NEON_COVER.enabled ? classifyRingsSat : classifyRings`. Function bodies
untouched; `enabled:false` is byte-identical toy output, the one-flag revert,
proven on an 11-scene FNV roll.

Two further defects fell out of it, both latent behind the winding starvation:

- **`maxFootprintM2` tested the SUM of a feature's polygons.** One
  OpenFreeMap feature carries a whole 171-house subdivision, so the
  per-building footprint guard was reading a subdivision-sized area and
  rejecting it. Multipolygons now explode per-polygon behind the flag, which
  is also what makes `maxPerChunk` a POLYGON cap (500) rather than the
  per-FEATURE cap (`TOY_WORLD.buildings.maxPerChunk` 700) that never bound
  while the pipeline was starved.
- **Set dressing was winding-starved too.** Park/landcover classified to
  nothing, so there were ~no trees anywhere. Restored, the scatter hits
  TOY_WORLD's 220/320 ceilings in every green chunk — 944 k tris of trees at
  NYC alone. The instancers set `frustumCulled = false`, so a chunk of trees
  8 km behind the player draws forever; this needed the one charter-permitted
  engine-side distance gate (`ToyWorldEngine._gateScatter`, visibility only —
  geometry stays built, so returning pops nothing). **NYC low 577 → 408
  draws.**

Influx containment is per-RING, because "too small to draw" is a function of
viewing distance and the ring IS the distance band (`full` reaches 8 km,
`mid` 18 km, `far` 30 km, `ultra` past 80 km): `maxFeaturesPerLayer`
400/200/120/100 and `minAreaM2` 120/4000/25000/60000. Measured: the mid+far
rings alone were issuing 77 water draws at Powell for water nobody can
resolve.

**Zero re-baselines.** All six pre-sanctioned re-certification gates (§2 of
the plan) passed their UNCHANGED assertions: neon-city 379 draws, neon-alt
325 / voidFrac 0.19%, roofs 394 / 2985 buildings, window-grids 403, edge-fx
400/372/322, verify-poi no shift. Ceilings 480 untouched. Satellite bundles
6/6 byte-identical across the flag. Worst pose (NYC low) 408 ≤ 480 draws and
1.498 M ≤ 2.2 M tris. NEW `verify-neon-cover` 8/8 — later 9/9 after the
post-merge gate-4 rewrite (§5.1).

## 2. Wave 1 — what shipped

Merge order A → B → D, each its own merge commit, full sweep between waves.

### A "HOMESTEAD" (`1116848`) — typology, coverage, far-mass

- **Typology-honest suburbia (P1).** Untagged footprints past
  `ROOFS_SAT.houseInfer.maxAreaM2` (220) no longer fall into the bare √area
  mid-rise curve with the office facade atlas. `ROOF_TYPOLOGY` bands them by
  area and bbox aspect — house / strip / school / bigbox / warehouse — inside
  a suburban-context guard (`maxTallTagged 2` at `tallM 40`, footprint cover
  ≤ 0.12, evaluated per SOURCE TILE over the post-filter set so it is
  ratio-safe at every latitude). **Powell invented heights 42.0 m → 12.0 m.**
  Downtown-context chunks keep the legacy curve VERBATIM — wrong typology is
  worse than empty and the conservative direction is DOWN.
- **Window-free inferred walls.** Inferred-suburban walls emit NEUTRAL_UV, the
  window-free contract the R18 roofs already used. A school at night goes dark
  instead of blazing with the office emissive atlas — this alone kills the P1
  night read. `roofBand` was added so a now-6–14 m typology building does not
  drop under `roofTones.lowMaxH` and wear the HOUSE palette (terracotta
  warehouses); the palettes themselves are R15/R18 checkpointed values and
  were not touched.
- **Coverage widen, high tier only (P2).** `SAT_COVERAGE.high` ring 3600 →
  4400 m, maxChunks 12 → 16. Medium/low resolve to `null` and fall back to
  the R18 ring — byte-identical, per decision 2.
- **Far-suburb hatch v2, hard-capped (P6).** The R18 candidate invented 18–60 m
  heights and SATURATED. v2 re-arms `minAreaM2` at 900 with `hM [10,22]` and
  `hardCapM 25` as an ADMISSION rule, not merely a clamp: **nothing can land
  in the (25, 35) band between the hatch ceiling and `SAT_SKYLINE.minH`, by
  construction**, and verify-suburbia gates that off rendered geometry.
- **The Owens lock.** A height cap alone does not fix the desert half of the
  defect — three 10–22 m blocks still make an Owens skyline chunk NON-EMPTY
  and break verify-skyline's "empty scene issues no mesh". So the hatch arms
  on DENSITY: `minCountPerTile 5`. Measured candidates per z14 tile over a
  live 3×3 — Owens max 1, Powell max 2, Dublin max 12, Columbus max 16,
  Chicago Loop max 46. 5 sits in a clean gap: 5× Owens' busiest tile, 2.5×
  Powell's, still arming over a real suburb and every city core.
- **Frozen worker emissions for C**, additive and sentinel-safe: `housePts`
  ([x,z] anchors of inferred small-band houses), `satTint` (merged low-poly
  landcover polys with per-class ids), per-class veg scatter rows
  (`residential` / `farmland` hedgerow / `orchard`, each sample rejecting
  points within `houseAvoidM` of a building footprint). Frozen at A's merge —
  C consumed them in W2 without touching the worker.
- Plus the water nearest-12 fix and a stale-coarse-drape heal.
- **verify-suburbia 16/16 NEW**; sat-depth / skyline / sat-buildings /
  roof-variety / veg green; zero re-baselines; flag-off byte identity 25/25;
  **Owens 239–240 ≤ 261**.

The one charter deviation, documented inline: the warehouse band shipped
`hM [10,16] → [10,14]`, because the plan's own verify-suburbia contract is
"zero untagged buildings > 14 m in suburban-context chunks" and a [10,16] band
breaks it by construction. With every band ceiling at or below 14 the gate now
holds by construction rather than by luck of the hash draw.

### B "DEEPFIELD" (`751625c`) — atmosphere, depth, resolution, shadows

- **THE reversed-depth-buffer fix.** `postprocessing`'s
  `USE_REVERSED_DEPTH_BUFFER` define is never set on this stack, so raw depth
  arrives REVERSED at any effect that samples it. Detected at runtime via
  `getReversed()` and flipped. Every subsequent depth-reading feature in the
  round is downstream of this one line.
- **AerialPerspective** (NEW `components/fly/AerialPerspective.jsx`, the
  WhiteBalance custom-Effect pattern) MERGED into the existing satellite
  EffectPass = **0 extra draws**; the composer gains its depth buffer here.
  Reconstructs view distance + world height and mixes toward the live
  `_atmoRim` triple from `startM 800` with a 1200 m e-fold height falloff
  (valleys fill first), `maxMix 0.55`, `endM 14000` where the unchanged 16 km
  tile `uHaze` band takes over. High tier + satellite only; strength ×
  `__flyAerialOverride`, fleet-pinned 0.
- **SAT_QUILT** cruise grade under the same pin: altitude-keyed desaturation
  0.35 + luma flatten 0.25, blending in 4000 → 9000 m eye AGL. The Esri
  capture-date quilt is a cruise artifact; low AGL keeps full imagery color
  and the hillshade/micro contracts.
- **Satellite shadow rig**: sun-follow directional on a 1500 m ortho frustum,
  mapSize 2048, `distM 3000` / `farM 8000`, `minElRad 0.15` (≈ 8.6°, the
  hillshade's own floor — at el→0 shadow length → ∞ and acne maximises).
  Casters/receivers are sat building chunk meshes + the veg canopy instancer
  only; tiles never receive. **The ground-catcher disc ships built-but-off**
  (Fable ruling, Owens headroom — checkpoint row to opt in).
- **z17 + aniso 8, high tier**, with a style-gated `LODThreshold 0.86`. The
  naive z16 descent measured 270 draws — which BREAKS the 261 Owens ceiling.
  Shipped **209, and sharper than R18**: the threshold buys back more than the
  extra zoom level costs.
- **Exactly 3 of the 4 budgeted cache-key moves**: tile
  `world-bend-fade-hill-r13` → `-r19`, `world-bend-anchor-satbldg-r16` →
  `-r19`, `world-bend-anchor-satskyline-r18` → `-r19`. The shared
  `applyBendAnchor` (toy reach) was not touched.
- **Content haze built-but-off**, Fable-accepted. At the only tier R19 lets it
  run it is REDUNDANT — the depth post pass reads the same depth buffer those
  meshes write and already hazes them by the same distance law; enabling both
  double-hazes the mid band. The term is real, 0-gated and key-bumped because
  it is the RIGHT fix for medium/low where no post pass runs and content
  genuinely is a cut-out today — but turning it on there would move medium/low
  pixels, which decision 2 freezes. R20 call (§5b).
- **verify-aerial 14/14 NEW** — the ONE harness that un-pins both new fleet
  pins. sat-depth **212** / rim / sun / round11 / neon-city (toy 363) green;
  zero re-baselines; **Owens armed 191 ≤ 261**; toy flag-off 359 = 359 draws
  with all new terms exactly 0.

### D "GOLDENHOUR" (`7262071`) — dusk exists

- **`runtime.sun.el` is a LIE for this purpose.** `computeSun` CLAMPS `el`
  into the hillshade band [8.6°, 51.6°] and takes `asin(max(0, sinEl))` — it
  can never be low, let alone negative. The unclamped truth is
  `runtime.sun.sinEl`, so every R19 consumer derives elevation as
  `asin(sinEl)` (`trueElevationDeg`). Finding this is what made the whole
  feature possible.
- **The dusk re-key.** `SKY_DUSK` selects buckets on solar ELEVATION — night
  below −8° (civil twilight), dawn/dusk −8°…+10°, day above. Legacy: `frac =
  sin(el)/sin 50°` with `nightFrac 0.06` = el 2.6°, i.e. R18 called a +2.6°
  sun NIGHT — 8:40 pm July Ohio, ten minutes before real sunset, rendered a
  starfield. **Now el +2 = dusk with ZERO stars.**
- **The starfield was the other half of P9.** `sun-model.nightWeight` keyed on
  `frac`, which hits 0 the instant the sun touches the horizon, snapping the
  star field to FULL against bright twilight. Re-keyed on elevation with the
  same inverse-smoothstep shape: exactly 0 at/above −4°, full by nautical
  twilight −12°. A deep-night pose (el ≈ −25°) still resolves to exactly 1 —
  which is what keeps verify-sat-night's contract intact.
- **SkyDome golden lobe**: warm horizon-glow around the sun azimuth, active
  only for el ∈ [−8°, +12°], strength computed CPU-side with a hard shader
  skip so it is exactly 0 outside the band. Bespoke ShaderMaterial, outside
  the cache-key registry — the cheapest possible seam.
- **8-step HDRI cross-blend** into a HalfFloat scratch RT, dip-masked by the
  existing machinery (`blendDipK 0.25` for intra-pair steps, full depth for a
  pair change). **Pure endpoints bypass the blend entirely on the raw source
  texture — settled skies are bit-identical.**
- **`WEATHER.fallback` flipped to `'procedural'`** (decision 4), plus a real
  bug found on the way: the fallback generator computed `tempC` from RAW
  latitude while everything else quantises to the 0.25° cell, so `tempC`
  flapped the precip kind across the freezing line within one cell.
- **Overcast lid v2** (`OVERCAST_V2`, closing R18 §5b#3 / checkpoint #17):
  `horizonKeep 0.35` reduces lid opacity near the rim so the dome's authored
  zenith gradient reads through, `zenithRamp 0.6` makes a ceiling dimmest
  overhead, `duskChroma 0.25` admits a fraction of the golden lobe THROUGH the
  lid — stars and moon are hidden by a lid, a sunset is not. All three live
  inside the existing `uOvercast` mix, so every one is an exact no-op at
  overcastT 0 whatever its value.
- **Cirrus deck**: a second drei `<Clouds>` instancer, satellite + high only,
  band 7000–11000 m, 10 wide-thin wisps, **+1 draw**, procedural CC0 texture
  from NEW `scripts/gen-cirrus.mjs`, registered in FLY_ASSETS and credits
  regenerated.
- NEW `lib/fly/sky-dusk.js` pure module. **verify-dusk 15/15 ×3**; sun / boot
  / round11 / sat-night / veg green (**Owens 239 ≤ 261 with cirrus armed**).
  Two charter-caused verify-weather moves ESCALATED to Fable rather than
  touched by the agent — the escalation rule working as designed.

### W1 Fable integration (`e00ba12`)

- **Dusk-aware key/hemi color bucket** (D's handoff): the legacy `hdriBucket`
  stat is byte-untouched, but `keyBucket` follows `resolveSky`'s dominant
  endpoint, so the key light stops reading noon-white through a dusk sky.
  R18-identical when `SKY_DUSK` is off.
- **Two SANCTIONED verify-weather moves**, per-gate sign-off under the
  escalation rule: `LID_SAT_MAX` 0.12 → 0.20 (a pristine control measured the
  lid saturation at 0.075 → 0.153, superseding the gate's original `[pencil]`
  estimate), and the dusk walk extended by 2 stamps with the swap gate rebuilt
  as a **1..16 band** — the R18 walk no longer crossed what it asserted under
  the new elevation ladder, and the band now also bounds the re-bake ladder.
  The end-bucket assertion was relaxed to left-day because the legacy stat
  reads night at el +2.

### W1 close (`61fbf07`)

- **keyMix lerp v2** — D's collateral catch, found by review rather than by a
  gate: the dominant-endpoint snap STEPPED the key light to noon-white at
  s > 0.5, which is worse than R18 at el +6. Key and hemi now LERP between
  endpoint buckets by s, mirroring the HDRI cross-blend. Off-path
  byte-identical.
- **verify-living-contracts reload gates gain the `completedCount` witness.**
  D produced a deterministic repro: a live completion races the pagehide
  flush, and the paid-out row is DELIBERATELY never persisted. The gate now
  excuses a missing row iff it is covered by `completedDelta`; a wipe still
  fails both gates.
- verify-dusk green (golden band 1.82 / 7.45), living-contracts rewritten
  gates 2/2, verify-sun green. **D's weather hypothesis was disproven** —
  `WEATHER.fallback` stays procedural.

## 3. Wave 2 — what shipped

Merge order F → C → E (F first so the Neon numbers are measured on a tree
already carrying all of W1; E last so its Effects.jsx / FlyScene edits rebase
onto B's W1 versions).

### F "REWIND" (`ae7f046`) — see §1

### C "GROUNDTRUTH" (`a0358a6`) — living ground

- **Residential canopy** off A's frozen per-class scatter: **Powell 227
  placed, was 0**; Central Park re-certified at 1177 / 2756 clean. Density is
  the only lever C owned and it is also the honest one — the worker's per-tile
  cap is spent in EMISSION ORDER and the R18 park/wood/grass passes run first
  (at Powell they alone stream 1,911 rows across 8 chunks), so the appended
  residential pass only ever sees leftovers. 1 stand per ~1300 m² is a 36 m
  grid, which is what a leafy Ohio subdivision looks like from the air.
- **Landcover tint, +1 draw**: ONE pooled merged mesh on the existing
  `world-bend-fade-r8` base variant (no GLSL change, no key move),
  MultiplyBlending with the α baked into vertex color on the CPU (so `alpha`
  is live-tunable without a re-stream), invisible below 12 polys — the shed
  lever. **`park` was DROPPED from the palette**: the OMT `park` layer is
  ADMINISTRATIVE, not landcover — Owens Valley ships 29.87 km² of
  `park:national_scenic_area` over a 3×3, which is Mojave desert, and Ohio
  township parks routinely enclose parking lots. A null hex makes the worker
  skip the layer at source, so it costs nothing to stream and nothing to draw.
  **Owens desert stays pale.** Park VEGETATION is unaffected.
- **Suburban night.** House lights are hash-stable CLUSTERS on A's `housePts`
  AND on residential-landcover scatter points (vegCls 4) — because
  OpenFreeMap's z14 building layer generalises individual houses away outside
  dense cores: **Powell streams 15 footprints across 12 chunks, not one under
  600 m², so `housePts` there is literally 0** (measured twice,
  independently). Manhattan 387 / Columbus 19 use the primary source; the
  suburbs ride parcel points. **2,128 lights at Powell; litFrac 1.081 →
  0.103** across the sizing pass — the first pass over a real subdivision
  photographed a field of glowing white boulders (a 7 m sphere is ~40 px of
  resolved faceted geometry at 320 m AGL), and the shipped porch light is a
  1.3 m POINT with a `farScale` ramp. `liftM 14` because the anchors' ground
  comes from SatVegEngine's ~460 m bilinear grid and a 3 m lift left the whole
  pool depth-culled.
- **The streetlight double-dimming, diagnosed.** The road fragment ends in
  `diffuseColor.rgb *= rw * gain`, where `rw` is the class WEIGHT = ribbon
  width / widest ribbon. A suburb is tertiary (12 m) and minor (9 m) against a
  26 m motorway, so every lamp in Powell rendered at 0.46 / 0.35 of the gain
  the R16 sweep calibrated on downtown arteries. **Road width was
  double-duties as brightness** — `rw` is the per-pixel brightness AND it
  correlates with the ribbon's pixel COUNT, so a 9 m street was dimmed twice
  for being narrow. Fixed with an additive cls 5/6 envelope
  (`streetGain` 0.24 / 0.34 → ~0.70 effective weight, parity per pixel with
  primaries, never above them). **The R16-swept `SAT_ROADS.night.intensity`
  was NOT touched** — it is a pending user checkpoint.
- **Daylight road seam**: a pale steady term on cls 1–4 (`daySeam 0.14`) —
  concrete catching the sun, not paint. The material is additive so it can
  only ever ADD light. Measured **peak +121 luma on road pixels**. This is the
  **4th and final budgeted key move**: `world-bend-road-satnight-r16` →
  `-r19`.
- **verify-groundlife 18/18 NEW**; veg / sat-depth / skyline / sat-night
  green; zero re-baselines; **Owens 178 noon / 179 night ≤ 261 — exactly the
  plan §5 ledger**; flag-off restores every R18 number.

### E "SLIPSTREAM" (`414a392`) — speed feel + the ride-alongs

- **SpeedLines**: radial smear (drags the ACTUAL frame content outward from
  the focus of expansion, so it reads on a white overcast and a night city
  alike — an additive overlay reads on neither, R18's steam-plume lesson) +
  44 wedge streaks + boost heat-haze, all ONE Effect merged into the existing
  EffectPass, **0 draws, and NO depth read by design — immune to the
  reversed-depth trap B had to fix**. Intensity smoothsteps from `onFrac 0.55`
  ⇒ **exactly 0 at probe cruise 0.24**, the SHAKE probe-safety construction,
  so no fleet pin was needed.
- **Boost FOV punch +3.06°** measured OUTSIDE the damped state — layering it
  inside would have let `fovLambda` swallow the transient entirely.
- **Framing-aware cinema clamp (P11).** A flat 900 m cap would BREAK
  verify-chase-cam's frozen framing gate: at the 2,400 m separation that
  gate's precondition allows, a 900 m abeam camera puts each aircraft 53° off
  axis, outside the 47° half-FOV. `frameSafety 0.85` computed from the LIVE
  fov/aspect reconciles them — the clamp never pulls closer than the range
  that still frames the pair, so the shot gets TIGHTER instead of broken:
  **1083 m standoff, both framed, versus 2765 m pre-R19**. Plus a far-target
  refusal at 8 km (a 21 nm pair is sky) falling back to chase + toast.
- **Altitude-keyed label budget (P11)**: above 3 km eye AGL keep the top 6 by
  kind rank / distance. **FL180 6 letters vs 11.** Below the band, byte-
  identical to today — verify-poi's letters-continuously-present contract.
- **P12, with the plan's mechanism CORRECTED.** Two control experiments on
  the W1 tree: **hands-off, the flight model already holds PERFECTLY — warp to
  2,300 m, 31 s, Δaltitude 0.0 m** (pitch stays exactly 0, vy = sin(0)·speed).
  The plan's vy servo would have shipped as a no-op. The real trigger is a
  STALE STICK: mouse-steer is ABSOLUTE, and a warp arrives level with the
  stick neutralized but the CURSOR still parked where the player clicked an
  Atlas destination card. The first pointer move re-arms a large SUSTAINED
  nose-down command — **measured `cmd.pitch` −0.471 forever, pitch pinned at
  the −80° clamp, 2,300 m → 443 m in 16 s (≈650 m at t = 12 s: the field
  study's curve, reproduced)**. Hence `cancelPitch 0.55`, set ABOVE the
  measured −0.471 — the trim yields to a deliberate deflection but not to a
  parked cursor — with a 1.5 s fade-back. It servos PITCH, not vy: at −80° of
  commanded nose-down, holding vy alone would fly the aircraft level with its
  nose in the dirt and the chase camera staring at the ground.
- **verify-feel 13/13 NEW**; chase-cam / poi / freelook / warp-arrival /
  fly-game green; zero re-baselines; **flag-off returns every defect** (the
  rollback proof, run deliberately).

## 4. Certification

Per-harness detail — every gate, every number, every re-run and its
classification — lives in **`scripts/r19-close-sweep.md`** on the close
branch. This section records only the round-level results and the ledger.

### 4.1 Final sweep

<<PENDING: final sweep tally — harness count green / total, plus the live-flake
re-run list and their classifications, from scripts/r19-close-sweep.md>>

Per-wave sweeps were green on each merged tree with the numbers recorded in
§2/§3: W1 closed with sat-depth 212, Owens 239–240 armed, toy 363; W2 closed
with Owens 178 noon / 179 night and the toy suite re-certified at its
unchanged assertions.

### 4.2 Soak

15 minutes, `node scripts/soak-fly.js 15`, live traffic, merged tree.

<<PENDING: soak p50 / p95 frame time, draws max, tris peak, heap peak, peak
live-aircraft count, pageerror count>>

### 4.3 verify-sat-night determinism

Two Fable-ruled changes closed the two gates left open by `5baeb63` (§5.1):

1. **"SUN DRIVES UNIFORMS ONLY" re-based onto the road-layer mesh census.**
   The gate differenced `layerDraws = onDraws − offDraws` between the night
   and noon legs for EXACT equality — four scene totals sampled 2.5 s apart
   while live traffic breathes them. The sign FLIPPED across three
   consecutive runs (6/5, 5/6, 5/5) while the road layer's own mesh census
   read 16 visible at BOTH night and noon: the invariant holds, the instrument
   does not. The gate now asserts the census. **Instrument replacement, same
   invariant** — no assertion about the product moved.
2. **The (E) block park extended to the remaining movers.** After the cloud
   deck + 14 InstancedMesh siblings + the cirrus group were parked, the A/A
   pair was still not a static frame: a live traffic GLB remained visible and
   moving (`setForegroundVisible` hides only InstancedMeshes carrying
   `_isModel`/`_painted`, and GLB traffic is Groups/Meshes), three animated
   instanced pools nested under groups kept bumping `instanceMatrix` (counts
   93 / 432 / 30), and one Points object moved.

<<PENDING: verify-sat-night final result — gate tally, and per-run margins over
N consecutive runs: (E) @2000 A/A noise, @3100 gone vs the 2.82 ceiling, and
the road-layer census equality>>

### 4.4 Re-baseline ledger

**None of the plan §2's six pre-sanctioned measured re-baselines were
consumed.** F measured every one of them on the W2 merged tree and reported
that all six pass their existing assertions unchanged (§1): verify-neon-city,
verify-neon-alt, verify-roofs, verify-window-grids, verify-poi (toy leg) and
verify-edge-fx (toy legs) are all still asserting their pre-R19 numbers. The
ceilings they defend — toy ≤ 480, sat ≤ 375, tris 2.2 M — were never
approached from below by more than the round's own measured content, and
**Owens ≤ 261 was never re-baselineable and never moved** (239–240 at W1,
178 / 179 at W2 close).

The round's **sanctioned assertion-number moves** are the two verify-weather
ones from W1 (`e00ba12`, per-gate Fable sign-off under the escalation rule):
`LID_SAT_MAX` 0.12 → 0.20 against a measured pristine control, and the dusk
walk / swap-gate rebuild into a 1..16 band with the end bucket relaxed to
left-day. Both are charter-CAUSED — the elevation ladder changed what the
walk crosses — and both were escalated by D rather than taken by the agent.

The round's **harness-instrument changes** (mechanics, not product numbers —
each one leaves every assertion number frozen):

| Change | Where | Why |
|---|---|---|
| verify-neon-cover gate (4) → 4a SOURCE + 4b RUNTIME | `dfb6443` | a frozen cross-owner bundle hash cannot express "F did not touch this" (§5.1) |
| verify-living-contracts reload gates gain `completedCount` | `61fbf07` | a live completion races the pagehide flush; the excusal is now witnessed |
| verify-sat-night (E) cloud park set on BOTH object and material flags, + `__flyCirrus` handle | `5baeb63` | an object-visibility park is rewritten every frame by its owner (§5.1) |
| verify-sat-night "SUN DRIVES UNIFORMS ONLY" re-based onto the road-layer mesh census | close | four breathing scene totals differenced for exact equality is a coin (§4.3) |
| verify-sat-night (E) park extended to GLB traffic / nested instanced pools / Points | close | the A/A pair was not a static frame (§4.3) |

### 4.5 Evidence

Evidence regenerates ONCE, at round close, in one pass, on the merged tree —
the convention set at `3b6704d` after a smoke run clobbered the R18-close
PNGs (and captured the unrelated app on :3000 into `boot-*.png` while doing
it). **The R19 sweep/soak evidence produced during the interrupted morning
session was deliberately REVERTED rather than committed**, and the
certification artifacts on the close branch supersede it. Two artifacts were
kept out of that revert because they could not be reproduced later:
verify-aerial's four A/A control pairs (`r19-b-aerial-*-ctrlA/B.png` — its
`ctrlDrift` floor is quoted inside its own gate detail, so the frames belong
with `r19-b-aerial-01..09`) and `formation-arch4.png`, the first live
archetype-4 formation verify-fly-formation has ever caught. `r16-satnight-*`
was deliberately NOT refreshed mid-session.

Per-agent evidence on the branch: `r19-a-*` (Powell typology, Columbus
coverage, Dublin far-mass, Owens empty), `r19-b-*` (aerial off/on, near,
cruise, shadow, Owens armed, the LOD candidate A/B, toy before/after),
`r19d-*` (cirrus texture, noon A/B/C, golden on/off, P9 dusk at Powell,
overcast dusk), `r19-c-*` (canopy, tint on/off/onb, day seam + diff, night
on/off/onb, house lights, Owens tint), `r19-e-*` (cruise A/A + un/remounted,
boost streaks, FL180 labels, cinema refused/close), `r19-f-*` (**Powell toy
before/after at 300 m and 1000 m — the money shot** — plus NYC cruise),
`r19pm-livetraffic-before/after.png`.

## 5. POSTMORTEM — the paused close

The round's close did not run in one pass. A session limit interrupted it
mid-sweep, leaving uncommitted work in two worktrees; a separate,
user-visible live-traffic outage landed on top of that. Both were salvaged
and both produced findings worth more than the interruption cost.

### 5.1 The two salvaged worktrees

**`dfb6443` — the false positive.** verify-neon-cover's gate (4) froze the
FNV rolls of six satellite bundles on F's own pre-merge tree and asserted
byte-identity forever, as the proof that `classifyRingsSat`'s satellite path
never reads `NEON_COVER`. It went red the moment C GROUNDTRUTH merged: C
flipped `SAT_GROUND_LIFE` and `SAT_TINT` on, so `buildSatVeg` legitimately
began emitting `out.satVegCls` and `out.satTint.{pos,col,idx,cls}` — arrays
that did not exist when the baseline was captured. A hash over "every typed
array in the bundle" therefore HAD to move, and only the two sat-veg scenes
did: sat-buildings-manhattan `e6b44c38`, sat-buildings-powell `8a8a67f5`,
sat-roads-powell `0d8b4300` and sat-skyline-manhattan `af892789` were all
still byte-exact to F's freeze, while sat-veg-manhattan `d4589b10` →
`cc5328a6` and sat-veg-powell `032da74e` → `a64098f8`. Nothing SHARED
changed; the diff was purely the new keys.

The invariant F owns is narrower than the hash, and a frozen bundle hash also
fails whenever the bundle's rightful owner changes it — it is a coupling gate
on somebody else's file, not a leak gate on F's. Replaced with the two halves
that are actually F's to own: **4a SOURCE** slices the worker into top-level
bodies and scans `buildSatBuildings` / `buildSatRoads` / `buildSatSkyline` /
`buildSatVeg` for any `NEON_COVER` reference (a MISSING builder counts as
leaky, so a rename fails LOUD rather than vacuously passing, and the toy path
must reference the flag more than zero times — measured 24 — or the gate
declares itself vacuous); **4b RUNTIME** rebuilds each satellite bundle after
driving the FLAGGED toy path ('full' then 'mid') hard on the SAME worker at
the SAME tile coords and requires byte-identity, because `tileTemplate` is the
worker's only module-scope mutable state and therefore the only runtime
channel by which the toy path could reach satellite output. Gate count 8 → 9.
Re-certified on main `414a392`, flag ON, **9/9 green**: Powell bldgVerts 11973
/ landIdx 13359 / waterIdx 585 / trees 90; cruise 337 draws / 0.75 M, Powell
373 / 0.46 M, NYC-low 407 / 1.51 M, all ≤ 480; worst 1.515 M ≤ 2.0 M; zero
pageerrors. `scripts/r19-f-satdiff.js` — the per-ARRAY differ that produced
the diagnosis — landed with it.

**`5baeb63` — the no-op.** The interrupted close had left an (E)-block park
setting `o.visible = false` on the cloud deck and every scene-root
InstancedMesh sibling, justified by the sanctioned `CLOUDS.shadow.opacity`
0.12 → 0.28 discs sweeping the ground crop. A census of the live scene:
`__flyClouds` is drei's outer GROUP, its parent is the SCENE ROOT with 48
children of which 14 are InstancedMeshes, and after 2.5 s of frames **exactly
ONE came back visible — the opacity-0.28 disc pool**. CloudField's `useFrame`
ends with an unconditional `shadows.mesh.visible = wantShadows`, so an
object-visibility park is overwritten on the next frame: **the park was a
no-op on precisely the actor it was written for.** Both flags are now set
(three gates the render-list push on `material.visible` in `projectObject`,
and nothing rewrites it) and both restored, so the park stays symmetric
across abSolid/abGone. The cirrus deck is a sibling GROUP, invisible to an
`isInstancedMesh` sweep, and needed its own handle — `window.__flyCirrus`,
D's, the same idiom. Measured across three consecutive runs with assertion
numbers frozen throughout: @2000 A/A noise 0.0296 → 1.68 → 0.154; @3100
gone 1.15 / 3.41 / 2.70 against the 2.82 ceiling. Run 3 reached 33/33 — **on
a 4% margin with noise == signal, i.e. it passed on the coin, not on the
physics**, which is why §4.3's two rulings exist and why run 3 was explicitly
not reported as green.

### 5.2 The live-crafts outage — R19 exonerated, then fixed anyway

Mid-close the user reported live aircraft missing. **R19 is exonerated by
construction: the entire `3b6704d..414a392` source diff contains ZERO lines
matching `/traffic/i`, and `TrafficLayer.jsx`, `traffic-engine.js`,
`use-fly-traffic.js` and `app/api/aircraft/*` are byte-untouched by the
round.** The regression is an upstream degradation meeting a failover blind
spot that predates R19 by many rounds.

**Mechanism.** adsb.lol's geographic endpoint had fallen over while the host
stayed up: `/v2/lat/lon/dist` answers HTTP **200** with a syntactically
perfect `{"ac":[],"msg":"No error","total":0}` at Manhattan, LAX, Tokyo and
Sydney (London 54 rows against 756), while adsb.fi and airplanes.live serve
~1050 rows for the identical point and adsb.lol's own NON-geographic
`/v2/mil` still returns data — the spatial index, not the host. The proxy
failed over on `!response.ok` and on a MISSING array, but an
**empty-but-present array walked the success path**: it pinned the sticky
`preferredSource` to the broken aggregator, cached the empty payload as
`lastGood` (poisoning the stale path that exists to hold the last real
frame), and returned 0 rows — so the two healthy sources were never asked
again. That is a TOTAL kill rather than a degradation because the client
stale ladder only ever ages tracks OUT: a run of empty batches deletes the
whole sky. Raw-boot repro over Midtown, satellite + live weather + real
geolocation: **281 → 253 → 0 tracks** and an empty minimap.

**Fix (`d5076d0`, `app/api/aircraft/route.js` only, 52 lines, no knob
moves).** An empty result is held as a CANDIDATE and the rotation continues;
the first non-empty source wins and is pinned. Only if EVERY reachable source
agrees the cell is empty is the empty payload returned — over genuinely quiet
airspace that is the honest answer, tagged `x-adsb-empty: all-sources`, at a
cost of one extra upstream call per poll cell there. An empty source is
deliberately NOT cooled down (an empty cell is not misbehaviour) and never
becomes `preferredSource` or `lastGood`, so a broken aggregator cannot
re-seat itself at the head of the rotation and make the outage
self-sustaining.

**Evidence.** NEW `scripts/r19pm-livetraffic.js` boots like a REAL user —
deliberately NOT `scripts/_boot.js`, whose fleet pins (toy style, weather
baseline, `__flyBoostInfinite`, `__flyAerialOverride` 0) plus the probes that
hide live traffic make this class of defect invisible to the whole harness
fleet. Same warp, same 8202 ft, same heading: **before = 0 tracks, empty sky,
empty minimap, every response `source=adsb.lol`; after = 782 tracks with
labels, tracers and a full minimap, every response `source=adsb.fi`, not one
empty.** A mid-Pacific control still returns an honest empty and does not
poison the preference. Gates on the fix (own server, own `.next`):
verify-tracers (302 backfills, 194 live after style flips), verify-fly-game,
verify-spicy (3-min soak, 0 pageerrors), verify-inspect-actions, verify-feel
13/13 — zero re-baselines. Control-experimented: verify-feel's streak gate is
a marginal pixel-noise assertion that failed in BOTH conditions on one loaded
run (armed A/A jitter swung 0.554 → 1.380 across runs) and passes clean on a
quiet machine — not attributable to this change.

**The harness fleet degraded with the sky.** The pre-fix control run
additionally failed both cinema gates (sep −1 m) and HARD-CRASHED on a null
target, because an empty sky leaves those gates nothing to aim at. A
live-traffic outage does not merely go undetected by the fleet; it breaks the
fleet in a way that reads as an unrelated harness bug.

**Follow-up NOT fixed here** (out of scope, filed in §5b): `lib/fly/
tile-sources.js` hardcodes `"Flight data © adsb.lol"` and PauseMenu links it,
but the proxy now routinely serves adsb.fi — and **Round 17's photo mode
bakes that string into exported captures**, so a wrong credit ships inside
images the user shares. Attribution should follow the live `x-adsb-source`.

## 5b. Follow-ups filed

1. **Attribution must follow `x-adsb-source`.** `lib/fly/tile-sources.js` +
   PauseMenu hardcode adsb.lol; the proxy routinely serves adsb.fi; R17 photo
   mode bakes the string into exported captures. §5.2.
2. **The harness fleet is structurally blind to live-traffic outages.**
   `_boot.js`'s pins plus the probes that hide traffic mean no gate in the
   fleet can see an empty sky, and verify-feel's cinema gates CRASH on one
   rather than failing meaningfully. Wants a synthetic-feed leg (the R16 §8
   prescription, now with a second motivation) or an explicit
   traffic-liveness gate.
3. **verify-neon-cover's `SAT_BUILDERS` is a hard-coded four-name list.**
   Gate 4a fails loud if a listed builder is renamed or removed, but a NEW
   satellite builder added in a future round is silently uncovered — the gate
   would pass vacuously for it. Wants derivation from the worker's own
   dispatch table.
4. **Satellite water material** — carried from R18 §5b#2 and deferred by
   Fable ruling in R19 §1 (no owner among the four locked priorities). Still
   a matte-green hard-edged slab from altitude; A1's R18 ocean-fill widened
   its coverage. Pairs naturally with a dedicated water round.
5. **Plume prominence** (`SAT_AMBIENT.plumes.*`) — carried from R18 §5b#6 and
   deferred because the knobs sit in R18 §6 checkpoint #13, PENDING USER;
   retuning them before sign-off would violate the checkpoint rule.
6. **Phone-class satellite device certification** — carried from R18 §5b#5.
   verify-sat-mobile did not run in an R19 wave gate list either, and R19
   made every high-tier visual heavier while freezing medium/low, so the
   phone path is now further from what is actually certified.
7. **Overcast-dusk sky** — R18 §5b#3 was ABSORBED by D's `OVERCAST_V2` and is
   mechanically closed (gradient retention + warm horizon band + dusk-chroma
   admission, exact no-op at overcastT 0). What remains is taste: checkpoint
   row 9.
8. **`AERIAL_PERSPECTIVE.content` ships built-but-off.** It is the RIGHT fix
   for medium/low, where no post pass runs and extruded content genuinely is
   an un-atmosphered cut-out, and it costs 0 draws and 0 tris. Turning it on
   is a one-flag change that would move medium/low pixels, which R19 decision
   2 froze byte-identical to R18. R20 call.
9. **`SAT_SHADOWS.catcher` ships built-but-off** (Fable ruling on Owens
   headroom). Opt-in is checkpoint row 5.
10. **Live-data flakes**: edge-fx tracer-cv and fly-game hover-aim persist
    from R16/R18, and verify-feel's streak gate joins them as a marginal
    pixel-noise assertion (armed A/A jitter 0.554 → 1.380 on a loaded
    machine). Same synthetic-feed prescription as #2.
11. **verify-sat-night's `layerDraws` instrument** was unchanged since R16
    (`4a1fe1f`) and was structurally a coin for three rounds before anyone
    differenced it enough times to notice. Worth a sweep for sibling gates
    that difference live scene totals for exact equality.

## 6. User checkpoints (PENDING USER — the next live session's agenda)

| # | Area | Question | Knobs |
|---|---|---|---|
| 1 | Typology honesty | Powell's invented heights are 42.0 m → 12.0 m and inferred walls are window-free. Does suburbia read as suburbia now — and did anything real get flattened? | `ROOF_TYPOLOGY.bands/context` |
| 2 | Far-mass read | At 8 km, does Powell read as low mass rather than a fake downtown? Nothing lands in the 25–35 m band by construction — is the gap visible as a gap? | `SAT_FAR_SUBURB.hM/hardCapM/minCountPerTile` |
| 3 | Coverage widen | Ring 3600 → 4400 m, 12 → 16 chunks (high tier). Enough reach, or still a visible bubble edge? | `SAT_COVERAGE.high` |
| 4 | Aerial perspective strength | `maxMix 0.55` from 800 m with a 1200 m height falloff — depth, or milk? Note it is fleet-pinned OFF in harnesses, so this is a LIVE-only read. | `AERIAL_PERSPECTIVE.maxMix/startM/heightFalloffM` |
| 5 | Shadow feel + catcher opt-in | Satellite content shadows at 1500 m ortho. Do buildings sit on the ground now? Opt in to the player ground-catcher disc (+1 draw)? | `SAT_SHADOWS.*`, `catcher.enabled` |
| 6 | z17 + quilt grade | Low AGL is z17/aniso 8 with `LODThreshold 0.86`; cruise gets desat 0.35 / luma-flatten 0.25 from 4–9 km. Sharper near, less quilted far — or over-graded? | `TILES.satMaxZoom`, `SAT_QUILT.*` |
| 7 | Dusk taste | el +2 is dusk with zero stars; the golden lobe runs −8°…+12°. Is the golden hour the right length and the right warmth? | `SKY_DUSK.elNightDeg/elDayDeg/glow.*` |
| 8 | Cirrus | 10 wide-thin wisps at 7–11 km, +1 draw, satellite/high only. Keep, thin, or drop? | `SKY_CIRRUS.*` |
| 9 | Overcast lid v2 | Closes R18 checkpoint #17. Does an overcast dusk still read as a featureless tan dome? | `OVERCAST_V2.horizonKeep/zenithRamp/duskChroma` |
| 10 | Procedural weather | `WEATHER.fallback` is `'procedural'` now — weather is never absent. Does invented weather ever contradict what you can see out the window? | `WEATHER.fallback` |
| 11 | Landcover tint subtlety | α 0.10 multiply, and `park` deliberately DROPPED (administrative, not landcover — Owens stays pale). Farmland ≠ forest ≠ golf, or a green wash? | `SAT_TINT.alpha/palette` |
| 12 | Suburban night warmth | 2,128 lights at Powell in hash-stable clusters + a cls 5/6 streetlight envelope at parity with primaries. Alive, or a runway? | `SUBURB_NIGHT.houseLights.*`, `streetGain` |
| 13 | Daylight road seam | `daySeam 0.14` on cls 1–4, peak +121 luma on road pixels. Concrete catching the sun, or painted lines? | `SUBURB_NIGHT.daySeam` |
| 14 | Streak / boost feel | Streaks start at speedFrac 0.55 (cruise is 0.24 = literally nothing), 44 wedges, radial smear 0.022 UV, +3.06° FOV punch. Does 793 kt feel like 793 kt? | `SPEED_FEEL.*` |
| 15 | Cinema clamp | 1083 m standoff both-framed (was 2765 m), refusal past 8 km with a chase fallback. Better shot, or too tight? | `CINEMA_FIX.maxRangeM/frameSafety/engageMaxM` |
| 16 | Label budget | FL180 shows 6 letters instead of 11, unchanged below 3 km AGL. Right budget, right ranking? | `LABEL_DECLUTTER.aglOnM/topN` |
| 17 | P12 warp trim | The bleed was a parked cursor, not drift. Does a warp now hold its altitude, and does the trim ever fight you when you DO want to descend? | `WARP_TRIM.cancelPitch/holdSec/releaseSec` |
| 18 | Neon before/after | **The money shot.** Powell toy at 300 m and 1000 m, before vs after (`scripts/r19-f-powell-*`). Does Neon read as a world now — and is the tree/grass density right? | `NEON_COVER.*` |
| 19 | Live crafts, on YOUR machine | The proxy fix (§5.2) is verified here at 782 tracks. Confirm a live session on your own machine over your own area recovers aircraft, and that quiet airspace still reads honestly empty. | `app/api/aircraft/route.js` |
| 20 | Neon nudge (carried) | R18's Fable-authored 3-value warmth/spread commit `7865ba4` still awaits approve-or-revert. Judge it AFTER #18 — R18 §5 already noted the A/B screenshots were mostly documenting the winding defect, which is now fixed. | R18 §5 |
| 21 | Carried tables | **R15 §6, R16 §6, R17 §6 and R18 §6 (17 rows) all remain open.** R19 explicitly did not touch any knob in them — `SAT_BUILDINGS.wallTones`, `ROOFS_SAT` band taste, `SAT_ROADS.night.intensity`, `SAT_AMBIENT.plumes.*`, `BOOST_METER`/`CRASH`/`SHAKE`/`MUSIC`, `toy-palette.js`. | — |

## 7. Lessons

1. **A frozen cross-owner hash is a coupling gate, not a leak gate.** F froze
   six satellite bundle hashes to prove its toy change could not reach
   satellite output. It went red when C legitimately added new keys to a
   bundle C owns. A hash over somebody else's artifact fails whenever that
   artifact's rightful owner changes it — which is a coupling assertion, not
   the isolation assertion it was written to make. Express the invariant you
   actually own: source scan for the reference, runtime rebuild for the
   channel.
2. **Object visibility cannot park an actor whose owner rewrites it every
   frame.** `o.visible = false` on the cloud deck was overwritten by
   CloudField's own unconditional `useFrame` write on the very next frame —
   the park was a no-op on precisely the actor it was written for. Park at a
   level the owner does not touch (`material.visible` gates the render-list
   push in `projectObject`), and prove the park with a census, not with an
   assumption.
3. **A gate that differences four breathing scene totals for exact equality
   is a coin.** verify-sat-night's `layerDraws` sign flipped 6/5, 5/6, 5/5
   across three consecutive runs while the invariant it defends was true in
   all three. It had been that way since R16. If a gate's inputs are live
   scene totals sampled seconds apart, measure the thing itself — the road
   layer's mesh census read 16 at both night and noon, every time.
4. **An aggregator can fail INSIDE a 200. Empty-but-well-formed is not
   healthy.** adsb.lol answered every geographic query with a syntactically
   perfect zero-row payload while its own non-geographic endpoints stayed up.
   Every failover predicate in the proxy — `!response.ok`, missing array —
   said "success". Treat an empty result as a candidate, not an answer, and
   never let it pin preference or poison a last-good cache.
5. **The harness fleet's own pins can hide an entire defect class from every
   gate.** `_boot.js` pins toy style, baseline weather and neutral overrides,
   and the pixel probes hide live traffic — so a total live-traffic kill was
   invisible to 20+ harnesses, and the two gates that DID depend on traffic
   crashed instead of failing meaningfully. Pins buy determinism by removing
   a variable; something must still test with the variable in.
6. **The plan's mechanism is a hypothesis; measure the trigger before you
   build the fix.** P12 was specified as altitude drift with a vy servo as
   the remedy. Hands-off, the flight model holds 0.0 m over 31 s — the servo
   would have shipped as a no-op against a defect that reproduces perfectly.
   The real trigger was a parked mouse cursor re-arming an absolute pitch
   command (−0.471, sustained), and the fix that works is a pitch trim with a
   cancel threshold set ABOVE the measured value.
7. **A clamp that fights a frozen gate must be reconciled by geometry, not by
   picking a smaller number.** A flat 900 m cinema standoff would have put
   both aircraft outside the half-FOV at the separation verify-chase-cam's
   frozen precondition allows. Computing the framing-safe range from the LIVE
   fov/aspect made the shot tighter AND kept the gate — 1083 m vs 2765 m.
8. **Density, not size, separates a suburb from a desert.** A height cap
   stopped the far-suburb hatch inventing downtowns but not inventing three
   blocks over Owens Valley. Arming on candidate COUNT per tile did — the
   measured gap between Owens (max 1) and a real suburb (Dublin max 12) is
   wide and clean, and it makes "an empty scene stays empty" true by
   construction instead of by winning a draw-count race.
9. **An administrative layer is not a landcover layer.** OMT `park` covers
   29.87 km² of Mojave desert at Owens and encloses parking lots in Ohio.
   Tinting it green is a rendering bug wearing a feature's clothes. Check
   what a vector layer MEANS before you paint it.
10. **When one term double-duties as brightness and as size, tuning it dims
    twice.** The road shader's class weight is both per-pixel gain and a
    proxy for lit pixel COUNT, so a 9 m suburban street was dimmed twice for
    being narrow — which read as "the streetlights are missing". The fix
    lifts per-pixel to parity and lets width do the differentiating; the
    R16-swept intensity knob was never touched.
11. **Two systems that haze the same pixels double-haze them.** B's in-shader
    content haze is correct, key-bumped and free — and REDUNDANT at the only
    tier R19 lets it run, because the depth post pass already hazes those
    fragments by the same law. Ship it off, document why, and leave the flag
    for the tier that needs it.
12. **A library define you never set is still a contract.** `postprocessing`
    expects `USE_REVERSED_DEPTH_BUFFER`; unset, raw depth arrives reversed at
    every effect that samples it. Detect the convention at runtime
    (`getReversed()`) rather than assuming either sign — the same class of
    defect as R18's winding sign, one layer up the stack.
13. **Zero product re-baselines is achievable on the round that multiplies
    the world by ~100×** — if the caps are sized from day-1 measurement
    rather than from taste. All six of F's pre-sanctioned re-baselines went
    unconsumed.

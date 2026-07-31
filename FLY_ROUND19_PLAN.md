# FLY ROUND 19 — "Honest World" — PLAN

> Depth, atmosphere and honesty for the world outside the hero downtowns
> (Powell OH is the reference case), a sky with a real dusk and weather that is
> never absent, speed you can feel, and the Neon winding fix with full
> re-certification. SIX Opus 5 agents in two waves of three under Fable
> orchestration on branch `claude/round19-honest-world`. Plan authored
> 2026-07-31 after a 15-minute live GPU field study (28 screenshots, telemetry,
> both styles, zero pageerrors — Powell OH / rural Union County / Columbus OH
> at 150 m–FL280, noon/dusk/night), a 3-agent recon pass, and an architect
> design review. Every diagnosis below was seen on screen, then verified in
> source at the cited file:line on main @ 7169aff.

---

## §0. Why this round + the pain→charter map

Four verified root causes of "flat": (1) **no near-field atmosphere** —
`SKY.haze.startM = 16000` + fogExp2 density 7.5e-6 means every fragment within
16 km is mathematically unattenuated, and buildings/veg/roads carry NO haze at
all (world-bend.js sat-building patch is "PURE vertex bend, no fade/haze");
(2) **imagery ~8× under-sampled** — `TILES.satMaxZoom 16` (≈1.83 m/px at
40°N vs ≈0.22 m/px screen-resolved at 300 m AGL), aniso 4 (applied statically
at terrain-engine.js:9); (3) **hillshade needs slope, Ohio has none** (the v2
stack degenerates to a uniform brightness multiply on flat DEM); (4) **nothing
casts a shadow in satellite** — `castShadow={mapStyle === 'toy' && …}`
(FlyScene), cloud shadows high-tier-only at opacity 0.12.

| Pain (field study, ranked) | Mechanism (verified) | Charter |
|---|---|---|
| P1 wrong-typology tower clones | untagged footprints >220 m² fall past `ROOFS_SAT.houseInfer` into the √area mid-rise curve with the office facade atlas (walls ALWAYS carry uv) — blazes at night | A |
| P2 coverage ~zero outside downtowns | `SAT_BUILDINGS` ring r 3600 / maxChunks 12 | A |
| P3 toy Powell = black void | `classifyRings` winding defect at 3 frozen call sites (worker polygonPass land/water, toy buildings, toy scatter) — ~99% of toy polygons dropped | F |
| P4 zero speed sensation | no streaks/radial cues/boost punch; FOV kick only speed^1.5 | E |
| P5 low-alt ground = magnified blur | z16 cap + aniso 4 + flat DEM ⇒ zero parallax | B |
| P6 3–16 km dead band, no suburban far-mass | haze.startM 16000; `SAT_SKYLINE.minH 35`, area hatch disabled at minAreaM2 1e9 (the 18–60 m invented-height version SATURATED — measured, R18) | A (mass) + B (haze) |
| P7 rural featureless + Esri date-quilt seams; zero trees off park/wood/grass | sat-veg scatter classes are park/wood/grass only; no landcover tinting exists | C (veg/tint) + B (quilt grade) |
| P8 mid-alt/cruise content dead zone | both content engines cull by ~2.6–2.8 km eye-AGL | A (far-mass) + B (aerial perspective) |
| P9 dusk doesn't exist | `hdriCycle.nightFrac 0.06` on frac = sin(el)/sin(50°) ⇒ "night" at el ≈ +1.7°; discrete buckets skip golden hour | D |
| P10 night suburbia dead dark | roads stream but read dark in suburbs; inferred houses either blaze (office atlas) or nothing | C |
| P11 cinema cam on far target frames nothing; label clutter at altitude | `rangeM = sep × rangeK` unclamped; POI declutter is XY-radius only | E |
| P12 post-warp altitude bleeds 2300→~650 m in ~15 s | warpToGeo sets pitch 0 / speed cruise; nothing holds altitude | E |

**Already reads well — DO NOT REGRESS:** cloud field, cruise curvature/rim,
native-res cruise imagery, toy NYC hero look, Columbus downtown mass, POI
letters (in rural areas they are the ONLY content — keep), night stars/moon,
RMB orbit, boot times (sat 24 s / toy 8 s), zero-pageerror stability, ambient
live-ADS-B presence, perf headroom (draws ≤365 measured, fps 205–241).

R18 §5b follow-ups absorbed this round: **#1 winding (F, the headline)**,
**#3 overcast-dusk (D)**. DEFERRED by Fable ruling: **#2 satellite water
material** (no owner in the four locked priorities; pairs with a future water
round) and **#6 plume prominence** (knobs sit in R18 §6 checkpoint #13,
PENDING USER — retuning them now would violate the checkpoint rule). Both are
re-filed in FLY_ROUND19.md §5b.

---

## §1. User decisions (locked 2026-07-31) + Fable rulings

1. **Neon winding fix: FOLD IN.** Agent F owns fix + re-certification with
   pre-sanctioned measured re-baselines; the other five agents are
   satellite/immersion.
2. **Perf: SPEND HIGH-TIER HEADROOM.** z17 imagery at low AGL, aniso 8 high
   tier, depth-buffer post pass (real aerial perspective), satellite shadows.
   **Medium/low tiers byte-identical to R18.** Owens ≤261 and all draw gates
   hold; soak stays green.
3. **Priorities: ALL FOUR** — honest suburbia, atmosphere & depth, living
   ground, speed & feel — plus the ride-along fixes (cinema far-target, label
   declutter, post-warp trim).
4. **Sky: REAL DUSK + PROCEDURAL WEATHER FALLBACK.** Continuous golden hour +
   `WEATHER.fallback: 'baseline' → 'procedural'` (the in-source "USER
   decision" flag is now decided).

**Fable rulings on the architect's open questions:** water material + plumes
DEFERRED (above) · **shadow ground-catcher disc ships built-but-OFF** (Owens
arithmetic, §5) · cirrus is satellite-only (toy sky is certified) · coverage
widen r4400/16 confirmed · house-light density 0.35 gets an evidence
screenshot at C's merge review before final tune · verify-poi's toy leg is
re-RUN; any number move needs explicit Fable sign-off per gate.

**What these decisions sanction touching in EXISTING constants** (everything
else is new-blocks-only): `WEATHER.fallback` (dec 4) · `SKY_LIVE.overcastLid`
gradient-retention terms (dec 4; R18 §6 #17 invites this rework) ·
`CLOUDS.shadow.opacity` (dec 2 — `minTier` stays 'high': medium is
byte-frozen) · `TILES.satMaxZoom`→by-tier and `HILLSHADE` anisotropy→by-tier
high=8 (dec 2) · `SAT_BUILDINGS` ring/maxChunks high-tier-only widen (dec 3,
P2) · the `ROOFS_SAT` dispatch seam for typology (dec 3, P1 — A owns the
block per R18). **NOT sanctioned:** any knob in the R15–R18 §6 pending
checkpoint tables not named above — explicitly including
`SAT_BUILDINGS.wallTones`, `ROOFS_SAT` band taste values,
`SAT_ROADS.night.intensity`, `SAT_AMBIENT.plumes.*`,
`BOOST_METER`/`CRASH`/`SHAKE`/`MUSIC`, and `toy-palette.js` (the R18 Neon
nudge `7865ba4` awaits sign-off — that file is FROZEN for everyone).

---

## §2. Hard constraints (violating any = regression)

No API keys, providers only in `lib/fly/tile-sources.js` · no r3f-perf · no
per-frame data through React state/zustand · all tunables in
`lib/fly/fly-constants.js` (R19 blocks pre-seeded `enabled:false` = byte-noop
AND the feature's one-flag rollback; agents edit ONLY their own block
interiors + the §1-sanctioned lines) · harness testids frozen ·
**WORKER_PROTOCOL 14→15 happens ONCE, in the scaffolding commit, all SIX pin
sites lockstep** (vector-tile.worker.js producer + sat-building-engine /
sat-road-engine / toy-world-engine / sat-skyline-engine / sat-veg-engine
consumers); mismatch ⇒ drop bundle + one dev warn, never crash · cache keys:
**exactly FOUR key moves budgeted, all named in §4** (B: tile
`world-bend-fade-hill-r13`→`-r19`, satbldg `-r16`→`-r19`, satskyline
`-r18`→`-r19`; C: road `-satnight-r16`→`-r19`); any GLSL change bumps the
FINAL key of every variant it reaches; new terms multiply to the IEEE
identity at defaults; the shared `applyBendAnchor` ('world-bend-anchor-r8',
reaches toy TownGlow/monuments) is UNTOUCHABLE; need a fifth move = escalate
to Fable · low-tier behavior via STATIC source gates only (draw gates can't
see fill rate); phones capped medium; **medium/low byte-identical to R18 (dec
2)** · new vertex attributes FAIL DARK · every visual-metric harness pins sun
AND weather (R18 lesson 7 — it detonated twice in one round); pixel gates
hide `__flyPlayer` and pin traffic out of crops; probe preconditions imply
their assertions; sample the app's own clocks; drive REAL engines, never
stubs · new harnesses boot via `bootFly` and take the target URL from
`process.env.FLY_URL` — **the user's live dev server is on :3002; never
assume :3000, never point a harness at the user's live server** · nobody
edits while the user live-flies; never two dev servers on one `.next` — every
agent runs its own dev server on a free port from its OWN worktree · agents
work in worktrees off `claude/round19-honest-world` (**verify the worktree
branch before editing — the R17 trap put 3 of 5 agents on main**), never
commit — Fable reviews the tree and commits one merge commit per agent ·
each agent authors AND runs its own new harness; Fable runs fleet sweeps,
drives the real cross-agent pairings, regenerates evidence PNGs on the merged
tree, runs `node scripts/soak-fly.js 15` at close · new assets: CC0/CC-BY
direct download only, registered in `FLY_ASSETS` with
license/author/url/modifications, credits via `gen-credits.mjs`; procedural
CanvasTexture preferred · Windows 11 + PowerShell 5.1 (no `&&`).

### Pre-sanctioned measured re-baselines (F measures, on the W2 merged tree; every move gets an inline `R19 SANCTIONED RE-BASELINE: old → new` comment, Fable sign-off per gate, and a round-record row)

| Gate | Current number | Why it moves |
|---|---|---|
| verify-neon-city | draws measured 363–364 (ceiling 480); skyline-lit >0.2%; runway pixel fracs | winding fix lands ~100× toy polygons — empty groups flip to issued; more lit facade area |
| verify-neon-alt | cruise draws ≤480; horizon voidFrac <25% | ultra/mid rings now carry real ground polys |
| verify-roofs | suburb buildings ≥30; roof variance ≥120; draws ≤480 | toy suburb coverage explodes; variance recomputed over the real population |
| verify-window-grids | skyline-lit frac; totalLit ≥300; flicker litA ≥500; draws ≤480 | lit-pixel floors move UP |
| verify-poi (toy leg) | letters continuously present | re-RUN; re-baseline only if a measured shift appears, per-gate Fable sign-off |
| verify-edge-fx (toy legs) | toyDraws ≤480 ×3 | measured draws recorded old→new; ceiling unchanged |

### Explicitly NOT sanctioned
**Owens Valley ≤261** (verify-sat-depth / verify-skyline / verify-veg — the
fleet's most-defended number), every satellite gate (sat-depth pixel gates,
roof-variety luminance band, skyline, veg, sat-night, round11, rim, sun,
sat-buildings, monuments-sat), the toy ≤480 / sat ≤375 ceilings themselves,
tris 2.2 M, the node gates (classify 38 / warbirds 20 / daily 28), soak p5
fps ≥55, the boot-time envelope (sat 24 s + B's ≤+20% tolerance gate).

---

## §3. Execution: scaffolding, waves, ownership, merge order

### Scaffolding commit (Fable, one commit, byte-noop by construction)
1. This plan as `FLY_ROUND19_PLAN.md`.
2. **WORKER_PROTOCOL 14→15** at all six pin sites, lockstep (same payloads,
   new stamp — behaviorally a no-op; stale HMR bundles drop cleanly).
3. **17 new fly-constants blocks appended at EOF** under one R19 banner, each
   `enabled:false`, each JSDoc header naming its owner: `ROOF_TYPOLOGY` /
   `SAT_FAR_SUBURB` / `SAT_COVERAGE` (A) · `AERIAL_PERSPECTIVE` /
   `SAT_SHADOWS` / `SAT_QUILT` (B) · `SKY_DUSK` / `SKY_CIRRUS` /
   `OVERCAST_V2` (D) · `SAT_GROUND_LIFE` / `SAT_TINT` / `SUBURB_NIGHT` (C) ·
   `SPEED_FEEL` / `CINEMA_FIX` / `LABEL_DECLUTTER` / `WARP_TRIM` (E) ·
   `NEON_COVER` (F). Agents edit ONLY the interior of blocks they own; never
   append to the file end; never reorder.
4. **FlyScene `RUNTIME CONTRACTS (R19)`** comment extending the R18 block,
   plus a pre-seeded `SKY_DUSK.enabled`-gated `setSkySun(az, el, frac)` call
   in the -50 satellite branch (no-op stub exported from SkyDome — D
   implements). Worker v2 contract fields: `housePts` (Float32Array [x,z]
   pairs — anchors of inferred small-band houses), `satTint` ({pos, col, idx}
   merged landcover polys), per-class veg scatter rows — producer A (frozen
   at A's W1 merge), consumer C (W2). `SAT_SHADOWS` mesh-flag rule: each
   content layer sets castShadow/receiveShadow on its own meshes, two lines,
   added by that layer's owner-of-the-wave (A: SatBuildingLayer W1; C:
   SatVegLayer W2). All additive + optional-chained at every read.
5. **`scripts/_boot.js` fleet pins (SANCTIONED harness edit, the R16/R18
   idiom):** `window.__flyAerialOverride = 0` and
   `window.__flySatShadowOverride = 0` — the two new ship-state visuals that
   would otherwise invalidate frozen satellite pixel gates, pinned neutral
   fleet-wide; **verify-aerial is the ONE harness that un-pins them.** (Speed
   streaks need no pin: exactly 0 at probe speeds by construction, the SHAKE
   precedent.)

### Waves

| Wave | Agents | Merge order + rationale |
|---|---|---|
| W1 (parallel) | A HOMESTEAD · B DEEPFIELD · D GOLDENHOUR | **A → B → D → full sweep + W1 checkpoint measurement** (Owens draws with aerial+shadows armed, sat city draws, boot time, tris). A first: its worker branches (including everything C consumes) freeze at its merge. B second: its key bumps + FlyScene edits land on A's layer flags. D independent of both. |
| W2 (parallel) | C GROUNDTRUTH · E SLIPSTREAM · F REWIND | **F → C → E → full sweep + soak.** F first so the Neon re-baselines are measured on a tree already carrying all W1 work. C consumes A's frozen worker branches and takes world-bend for the ONE road key bump. E last — its Effects.jsx/FlyScene edits rebase on B's W1 versions. |

### Per-file owner-by-wave matrix (one owner per file per wave)

| File | W1 | W2 |
|---|---|---|
| vector-tile.worker.js | **A** (all sat paths + C's data emissions) | **F** (toy region ONLY: the three classifyRings call sites + caps) |
| fly-constants.js | per-block ownership (table above) | same |
| world-bend.js | **B** (3 key bumps + content haze) | **C** (road key bump) |
| Effects.jsx | **B** (AerialPerspective) | **E** (SpeedLines) |
| FlyScene.jsx | **B** (shadow rig + castShadow gate) | **E** (warpToGeo trim) |
| SkyDome / SatEnvironment / CloudField / weather-model / use-fly-weather | **D** | — |
| terrain-engine.js, tile-sources.js | **B** | — |
| sat-building-engine.js, SatBuildingLayer.jsx | **A** | **C** (mount lines + house-light host) |
| sat-veg-engine.js, SatVegLayer.jsx | — | **C** |
| sat-road-engine.js | — | **C** |
| chase-camera / cinema-camera / flight-model / PoiLetters / audio-engine | — | **E** |
| toy-world-engine.js | — | **F** (only if a cap needs the engine side) |
| scripts/_boot.js | Fable only | Fable only |
| toy-palette.js | FROZEN | FROZEN |

Cross-agent calls optional-chained; cross-agent data flows only through the
worker bundle fields and runtime fields named in the contracts comment.

---

## §4. Charters

### A "HOMESTEAD" (W1) — honest suburbia: typology, coverage, far-mass
One line: make the world outside downtowns tell the truth — no more tower
clones over cul-de-sacs, wider real coverage, and a safe suburban far-mass.

Owns: `vector-tile.worker.js` (ALL W1 edits: buildSatBuildings,
buildSatSkyline, buildSatVeg incl. the satTint/housePts/per-class-scatter
emissions C consumes — frozen at A's merge), `sat-building-engine.js`,
`SatBuildingLayer.jsx` (W1: bundle meta + the two SAT_SHADOWS mesh-flag
lines), blocks `ROOF_TYPOLOGY` + `SAT_FAR_SUBURB` + `SAT_COVERAGE` +
sanctioned `ROOFS_SAT` dispatch seam + sanctioned `SAT_BUILDINGS` high-tier
ring keys, NEW `scripts/verify-suburbia.js`.

- Typology inference replaces the bare √area curve for untagged footprints
  > `houseInfer.maxAreaM2` (220), gated `ROOF_TYPOLOGY.enabled` AND a
  suburban-context guard (chunk has <2 tagged-tall ≥40 m AND footprint cover
  <~0.12 — the toy district idiom): 220–600 m² → 6–9 m large-house /
  small-commercial; 600–2,500 m² with bbox aspect >3 → 6–8 m strip; else
  7–12 m school/apartment; 2,500–10,000 m² → 8–14 m big-box with
  parapet+HVAC; >10,000 m² → 10–16 m warehouse. Downtown-context chunks keep
  the legacy curve VERBATIM — wrong-typology is worse than empty; the
  conservative direction is DOWN.
- **Inferred-suburban walls emit NEUTRAL_UV** (the window-free contract the
  R18 roofs use): a school at night goes dark instead of blazing with the
  office emissive atlas. This alone kills the P1 night read.
- Coverage widen, HIGH TIER ONLY (`SAT_COVERAGE`): ring r 3600→4400,
  maxChunks 12→16; medium keeps 3600/12 byte-identical. +4 draws, ≈+0.3 M
  tris worst case.
- Far-suburb mass, the SAFE hatch (`SAT_FAR_SUBURB`): re-arm
  `SAT_SKYLINE.minAreaM2` at ~900 m² and REPLACE the failed 18–60 m
  invented-height clamp with `hM [10,22]` hard-capped 25,
  `areaMaxPerChunk ≈120`. Powell reads as low mass at 8 km, never a fake
  downtown; Owens stays empty by the existing empty-issuance rule.
- `housePts` emission: [x,z] anchors of inferred small-band houses appended
  to the sat-building bundle (additive, sentinel-safe) — C's night
  house-light data source.
- Veg/tint data for C (frozen at merge): buildSatVeg scatter passes gain
  landuse `residential` (~1/3,500 m²), `farmland` hedgerow (~1/8,000 m²),
  `orchard`; each sample rejects points within `SAT_GROUND_LIFE.houseAvoidM`
  of a building footprint (the building layer is in the same tile); `satTint`
  merged low-poly landcover polys with per-class ids. Worker caps unchanged —
  density does the work.
- verify-suburbia.js (pinned noon sun + baseline weather + hidden player,
  `FLY_URL` boot): Powell 600 m AGL — zero untagged buildings >14 m in
  suburban-context chunks; Columbus residential straight-down — extruded
  columns ≥40 (was ~0); far-mass present at 8 km with max h ≤25; the
  verify-roof-variety invariants re-asserted (≥4 forms, flat-share ≤5% — not
  re-based); Owens ≤261.
- NOT: world-bend.js, Effects.jsx, FlyScene, SkyDome, any toy worker region
  (F's, W2), SAT_ROADS, wallTones or any R15–R18 checkpointed taste value.

### B "DEEPFIELD" (W1) — atmosphere, depth, resolution, shadows
One line: give every pixel a distance — depth-aware aerial perspective, height
fog, satellite shadows, z17/aniso 8, quilt-seam grade.

Owns: `Effects.jsx` (W1), `world-bend.js` (W1: 3 of the 4 budgeted key
moves), `FlyScene.jsx` (W1: shadow rig + castShadow gate), NEW
`components/fly/AerialPerspective.jsx` (custom Effect, WhiteBalance.js
pattern), `terrain-engine.js`, `tile-sources.js`, blocks `AERIAL_PERSPECTIVE`
+ `SAT_SHADOWS` + `SAT_QUILT` + sanctioned `TILES.satMaxZoom`-by-tier +
`HILLSHADE` anisotropy-by-tier, NEW `scripts/verify-aerial.js`.

- AerialPerspectiveEffect: depth-reading Effect MERGED into the existing
  satellite EffectPass (HueSat+BC+WhiteBalance) = **0 extra draws**; composer
  gains its depth buffer here. Reconstructs view distance + world height from
  depth; mixes toward the live rim color (the same `_atmoRim` triple the -50
  block computes) from `startM ≈800` with height falloff (valleys fill
  first). High tier only; satellite only; strength ×`__flyAerialOverride`
  (fleet-pinned 0). The 16 km tile `uHaze` band stays as the all-tier base —
  the post pass augments, never replaces, and `SKY.haze` values are NOT
  retuned.
- Content haze: 0-gated mix appended to the sat-building and sat-skyline
  fragments — keys `world-bend-anchor-satbldg-r16`→`-r19`,
  `world-bend-anchor-satskyline-r18`→`-r19`. Buildings/mass stop reading as
  un-atmosphered cut-outs. `applyBendAnchor` NOT touched (toy reach); veg
  haze is C's CPU-side instance-color job.
- Quilt grade: altitude-keyed desaturation + luma-flatten uniforms in the
  tile fragment (the setMicroDetail idiom), 0-gated, high-tier-gated → FINAL
  tile key `world-bend-fade-hill-r13`→`-r19` (toy tiles recompile but stay
  pixel-identical via the 0 gates — the R13 precedent).
- Satellite shadows (`SAT_SHADOWS`, high only): a satellite branch of the
  sun-follow block positions the directional along `runtime.sun` az/el on a
  small ortho frustum (radius ~1,500 m, mapSize 2048); the `castShadow` gate
  extends to satellite under the flag; casters/receivers = sat building chunk
  meshes + veg canopy instancer ONLY (tiles never receive; player keeps its
  R13 contact disc). **The ground-catcher disc is BUILT but ships
  `catcher.enabled:false`** (Fable ruling — Owens headroom §5; user
  checkpoint row to opt in).
- z17 + aniso 8: `TILES.satMaxZoom` becomes by-tier {high:17, else:16},
  consumed in tile-sources; the AGL gating is intrinsic (quadtree descends
  only when screen-space error demands). LRU stays 140 MB — churn, not
  budget, and verify-aerial measures it. Aniso: replace the static
  DEFAULT_ANISOTROPY set with a tier-resolved value pre-mount (high 8,
  medium/low unchanged).
- Boot-time guard: verify-aerial measures satellite boot on the merged tree;
  if z17 pushes boot >20% over the 24 s baseline, clamp descent via
  LODThreshold rather than ship the regression.
- verify-aerial.js: THE one harness that un-pins `__flyAerialOverride` /
  `__flySatShadowOverride`. Pinned noon + baseline weather + hidden player.
  A/B strength-0 vs on: mid-band (3–10 km) crop mean-Δ ≥ floor; near crop
  (<800 m) Δ≈0 (hillshade relief preserved — the verify-sat-depth contract);
  shadow on/off luminance Δ on a Manhattan crop; Owens ≤261 with everything
  armed; texture bytes ≤300 MB at 300 m AGL under z17; boot ≤ +20%.
- NOT: worker, SkyDome/SatEnvironment/CloudField (D's), SAT_ROADS GLSL (C's),
  any toy pixel behavior (all new terms 0-gated in toy), SKY.haze values,
  SKY.altAtmo keyframes.

### D "GOLDENHOUR" (W1) — real dusk, procedural weather, cirrus, overcast lid
One line: the sky gets a golden hour, a high deck, a lid with a gradient, and
weather that always exists.

Owns: `SkyDome.jsx`, `SatEnvironment.jsx`, `CloudField.jsx`,
`weather-model.js` + `use-fly-weather` wiring, blocks `SKY_DUSK` +
`SKY_CIRRUS` + `OVERCAST_V2` + sanctioned `WEATHER.fallback` flip +
sanctioned `SKY_LIVE.overcastLid` terms + sanctioned `CLOUDS.shadow.opacity`
0.12→0.28 (minTier stays 'high' — medium byte-frozen), NEW
`scripts/verify-dusk.js`, NEW `scripts/gen-cirrus.mjs` (procedural texture,
self-made, FLY_ASSETS-registered).

- Elevation-keyed buckets (`SKY_DUSK`): today `nightFrac 0.06` on
  frac = sin(el)/sin(50°) makes 8:40 pm July Ohio FULL NIGHT at el ≈ +1.7°
  (P9). Re-key bucket selection on solar ELEVATION: night below −8° (civil
  twilight), dawn/dusk −8°…+10°, day above. Legacy frac path runs verbatim
  when disabled. Pinned-noon gates are unaffected either way (el high ⇒ day).
- Golden-hour glow in SkyDome — the cheapest seam (bespoke ShaderMaterial
  OUTSIDE the cache-key registry): new `uSunDir/uSunGlow` uniforms driven by
  the scaffolded `setSkySun` feed; a warm horizon-glow lobe around the sun
  azimuth, active only for el ∈ [−8°, +12°], color ramped through the
  existing altAtmo golden keyframe family. Exactly 0 outside the band (IEEE
  identity discipline).
- HDRI cross-blend: stepped re-bakes (~8) between neighbour HDRIs across the
  dusk window, each masked by the existing dip machinery — no more hard
  bucket swap. Prefetch already exists.
- Procedural weather flip: `WEATHER.fallback: 'procedural'` — the fallback
  generator is already written and deterministic (seeded 0.25° cell + 3 h UTC
  bucket). Fleet stays deterministic: `_boot.js` pins baseline. verify-dusk
  adds a determinism leg (same cell+bucket ⇒ identical wx twice).
- Overcast-dusk lid fix (`OVERCAST_V2`, R18 §5b#3 / checkpoint #17): keep a
  vertical gradient + a residual warm horizon band inside the lid instead of
  the flat tan dome; exact no-op at overcastT 0.
- Cirrus deck (`SKY_CIRRUS`): second `<Clouds>` instancer in CloudField, band
  7,000–11,000 m, ~10 wisps from gen-cirrus.mjs, satellite-only, high-only =
  **+1 draw**. Toy sky certified — untouched.
- verify-dusk.js (sets `__flySunOverride` BEFORE warp — warpEpoch re-runs the
  day-cycle effect): pinned el +4° → golden band present (warm-hue crop near
  sun azimuth); el −4° → dusk, NOT night (star weight 0); el −10° → night
  (verify-sat-night contract preserved); overcast dusk → lid top-vs-horizon
  luma/chroma Δ ≥ floor (the featureless-tan tripwire); cirrus +1 draw
  accounting; noon frame A/B byte-stable vs R18.
- NOT: Effects.jsx, world-bend.js, FlyScene (the setSkySun line is
  scaffolded), tile pipeline, SKY.altAtmo keyframe values,
  hdriFade.texelCap/nightTexelCap, toy dome props.

### C "GROUNDTRUTH" (W2) — living ground: veg carpet, tint, suburban night
One line: residential America gets its trees, its landcover its color, and its
nights their porch lights and streetlights.

Owns: `sat-veg-engine.js` + `SatVegLayer.jsx`, `SatBuildingLayer.jsx` (W2:
mount lines + house-light host), `sat-road-engine.js`, `world-bend.js` (W2:
the 4th and final budgeted key move), NEW `components/fly/SatTintLayer.jsx`,
NEW house-light instanced sprite (hosted in SatBuildingLayer — the
SAT_AIRPORT_BEACONS hosting precedent), blocks `SAT_GROUND_LIFE` + `SAT_TINT`
+ `SUBURB_NIGHT`, NEW `scripts/verify-groundlife.js`.

- Residential/farmland veg: consumes A's frozen per-class scatter. High-tier
  pool 3000→5000 via `SAT_GROUND_LIFE` (medium byte-identical); same ONE
  instanced canopy draw; `visible=false` at count 0 (Owens flat). House
  avoidance is worker-side (A) — C asserts it.
- Veg haze, zero-shader: distance-keyed instance-color lerp toward the live
  rim tone on the existing 2 s placement cadence — the cut-out fix for trees
  without touching the shared anchor variant.
- Landcover tint (`SAT_TINT`): ONE pooled merged mesh (+1 draw,
  `visible=false` below a poly threshold — a shed lever), MultiplyBlending
  α≈0.10, draped on the veg chunk grid, reusing the EXISTING
  `world-bend-fade-r8` base variant — no GLSL change, no key move. Farmland ≠
  forest ≠ golf at last.
- Daylight road read: new low-intensity 0-gated day terms in
  `applyBendRoadSat` (pale steady seam on cls 1–4, ~0.14 — additive material
  can only add; a faint concrete glint, not paint) ⇒ **key
  `world-bend-road-satnight-r16`→`-r19`**. Existing `SAT_ROADS.day` glint
  values untouched — new terms only.
- Suburban night (`SUBURB_NIGHT`): (a) house lights — instanced warm sprites
  (+1 draw, ~35% of A's housePts lit, pool ≤600, dayFrac/γ night ramp in the
  SAT_CITY_GLOW family shape; count 0 ⇒ parked, so Owens/day cost nothing);
  (b) streetlight read — diagnose the Powell dark-roads finding and fix via
  envelope terms for cls 5–6 in the road patch, NOT by retuning the
  R16-swept `night.intensity`.
- verify-groundlife.js (pinned sun per leg, baseline weather, hidden player):
  Powell noon 600 m — residential canopy ≥250 (was 0); house-clearance
  assert; tint A/B crop Δ within [floor, ceiling] (bounded BOTH ways —
  subtle); pinned-night Powell — combined streetlight+houselight crop luma ≥
  floor (P10 tripwire); toy mounts none of it; Owens ≤261 with tint + house
  lights armed.
- NOT: worker (consumes A's frozen branches; F owns the file in W2),
  Effects.jsx, FlyScene, SkyDome, plume knobs, SAT_VEG medium-tier values,
  wallTones.

### E "SLIPSTREAM" (W2) — speed & feel + the ride-along fixes
One line: 793 kt should feel like 793 kt — and the camera, labels and warps
stop undermining the fantasy.

Owns: `Effects.jsx` (W2), `FlyScene.jsx` (W2: warpToGeo), `chase-camera.js`,
`cinema-camera.js`, `flight-model.js`, `PoiLetters.jsx`, `audio-engine.js`
(wind layer), NEW `components/fly/SpeedLines.jsx` (custom Effect), blocks
`SPEED_FEEL` + `CINEMA_FIX` + `LABEL_DECLUTTER` + `WARP_TRIM`, NEW
`scripts/verify-feel.js`.

- Wind streaks / ground-rush / heat-haze: ONE screen-space Effect merged into
  the existing EffectPass (0 draws, the WhiteBalance pattern); intensity =
  smoothstep(speedFrac from `onFrac ≈0.55`) ⇒ **exactly 0 at probe cruise
  0.24** (the SHAKE probe-safety construction — no fleet pin needed).
  Ground-rush multiplier below `aglBandM ≈120`; heat-haze UV wobble at boost
  folded into the same effect.
- Boost FOV punch: transient `punchDeg ≈4`, 0.5 s decay, layered on the
  existing damped fovBoost — zero at probe speeds (verify-chase-cam safe).
- Cinema far-target fix (`CINEMA_FIX`): clamp rangeM to
  [120, maxRangeM ≈900] and refuse engage beyond `engageMaxM ≈8 km` (fall
  back to chase + toast). A 21 nm target no longer frames empty sky.
- Label declutter (`LABEL_DECLUTTER`): above eye-AGL ~3 km keep top-N (≈6) by
  kind rank/distance; below, today's behavior byte-identical (verify-poi's
  letters-continuously-present contract).
- Post-warp trim (`WARP_TRIM`): for `holdSec ≈10` after warpEpoch, vy is
  softly servoed toward the warp `altM` unless the player pitches; player
  input cancels instantly. The outcome gate is the contract (mechanism has
  latitude): warp to 2,300 m at cruise, hands-off 30 s ⇒ altitude ±60 m.
- verify-feel.js: cruise frame with streaks armed pixel-identical to disabled
  (A/B); boost frame streak-luma ≥ floor + FOV punch numeric trace; cinema on
  an injected 21 nm target → clamped or clean fallback; FL180 label count ≤N;
  the warp outcome gate above (no altitude pin — this gate proves the product
  fix).
- NOT: worker, world-bend.js, SkyDome, sat layers, input-controller, frozen
  testids, SHAKE/BOOST_METER/CRASH/MUSIC values (R18 §6 pending).

### F "REWIND" (W2) — Neon winding fix + re-certification
One line: give Neon its 99% of the world back, hold the budget, and
re-baseline every toy gate with measured numbers.

Owns: `vector-tile.worker.js` (W2: toy region ONLY — the three classifyRings
call sites + caps), `toy-world-engine.js` (only if a cap needs the engine
side), block `NEON_COVER`, the six pre-sanctioned re-baselines (§2), NEW
`scripts/verify-neon-cover.js`.

- The fix: at the three frozen call sites (polygonPass land/water, toy
  buildings, toy scatter) dispatch
  `NEON_COVER.enabled ? classifyRingsSat : classifyRings` — the exact R18
  satellite pattern with the proven winding-agnostic function. Function
  BODIES untouched. `enabled:false` ⇒ byte-identical toy output (the
  one-flag revert).
- Day-1 measurement, BEFORE styling anything (R18 lesson 1): per-tile
  before/after feature counts at Powell, NYC, and a z13 'mid' tile via
  `scripts/inspect-mvt.mjs` — the re-baseline evidence starts here.
- Influx containment (tris ≤2.2 M, toy ≤480): `NEON_COVER` adds per-layer
  polygon budgets (~400/tile) + a min-area drop (~120 m² is sub-pixel at toy
  altitudes) + optional volume-stratified building selection mirroring
  `ROOFS_SAT.select` — the R18 suburb lesson applies to toy: the existing 700
  cap alone would keep only the biggest and drop the house carpet.
- Draw accounting: toy draws rise only where empty groups become non-empty.
  Measured at NYC cruise (ultra ring armed — worst case, the verify-neon-alt
  pose) and Powell; ceiling 480 holds via the caps; the measured numbers
  become the new baselines (§2 table).
- Re-certification on the W2 merged tree: verify-neon-city / neon-alt /
  roofs / window-grids / poi / edge-fx toy legs; every moved number recorded
  old→new with inline comments + per-gate Fable sign-off; screenshots
  regenerated for the round record; **Powell toy before/after is the money
  shot.**
- verify-neon-cover.js: flag-off output byte-identical (a Powell tile builds
  the pre-R19 bundle exactly); flag-on Powell chunk polygons kept ≥200 (was
  ~0); NYC cruise tris ≤2.0 M measured (0.2 M headroom under the gate); zero
  pageerrors; satellite bundles byte-identical across the flag
  (classifyRingsSat's satellite path does not read NEON_COVER).
- NOT: classifyRings/classifyRingsSat bodies, any satellite worker path,
  toy-palette.js, TOY_WORLD building taste values, Owens/satellite gates,
  world-bend.js.

---

## §5. Budgets & tiers (arithmetic)

**Draws — satellite city** (R18 measured 253–280, gate ≤375): A widen +4 →
284 · B shadow-pass caster re-renders (≤16 building chunks + 1 veg instancer)
+17 → 301 · D cirrus +1 → 302 · C tint +1 + house lights +1 → **304 ≤ 375 ✓**
(catcher OFF; 71 headroom).

**Draws — Owens Valley** (R18 measured base **254–258**, gate ≤261, NOT
re-baselineable): worst case 258 + B veg-caster +1 + D cirrus +1 + C tint +1
= **261 = AT the ceiling with zero headroom.** Mitigation is structural: the
catcher ships OFF (Fable ruling); each of the three Owens-visible adds
carries an independent shed lever (veg caster rides the SAT_SHADOWS flag;
cirrus has its own sub-flag; tint goes `visible=false` below a poly
threshold). **Owens is measured at the W1 checkpoint (aerial+shadows armed)
AND again before C's W2 merge; if the W1 base measures >255, Fable escalates
the shed order BEFORE W2 starts.**

**Draws — toy** (measured 363–364, ceiling 480): F's group flips measured +
re-baselined; caps guarantee ≤480. D cirrus is satellite-only; B/C/E add 0
toy draws.

**Tris** (gate 2.2 M): sat city ≈0.64 M ×1.5 widen ≈0.96 M + skyline ≤250 k +
far-suburb hatch ≤~90 k + veg (instanced) + tint ~40 k ≈ **1.35 M ✓**. Toy:
F's budget 2.0 M measured, with named levers (maxFeaturesPerLayer /
minAreaM2 / building selection).

**Textures** (300 MB budget; tile LRU fixed 140 MB): z17 lives inside the
unchanged LRU (churn only — verify-aerial measures); cirrus CanvasTexture
≤1 MB; shadow map 2048² ≈16 MB high-only. ✓

**Tiers** (decision 2): every R19 VISUAL is high-tier-gated (aerial pass,
shadows, z17, aniso 8, quilt grade, cirrus, coverage widen, veg pool raise).
All-tier changes are content-honesty only (typology, far-mass, winding fix —
worker geometry is tier-independent, and medium draws hold under the same
caps). **Medium/low byte-identical ⇒ phones get the honesty, none of the
spend.**

---

## §6. Verification

**Existing gates UNCHANGED (at-risk + defense):** verify-sat-depth 261 +
hillshade pixel gates — aerial/shadows fleet-pinned neutral in `_boot.js`;
near-crop Δ≈0 designed into AERIAL_PERSPECTIVE.startM · verify-roof-variety
luminance band — shadows pinned; A re-asserts ≥4 forms / flat ≤5% ·
verify-skyline — hatch v2 keeps empty-issuance; Owens ready===0 re-asserted ·
verify-veg — pool raise high-only; Owens ≤261 re-pinned by C · verify-rim /
verify-round11 / verify-sun — pinned noon ⇒ SKY_DUSK inert, byte-stable ·
verify-sat-night — deep-night pose sits below el −8° ⇒ same bucket ·
verify-weather — fleet pinned baseline; its own overrides unchanged ·
verify-chase-cam — streaks/punch zero at probe speeds by construction ·
verify-boot — B's boot-time tolerance gate · toy suite — green through W1
(NEON_COVER false), re-certified in W2 · soak at close — p5 ≥55, tris watch.

**NEW:** verify-suburbia (A, ~9) · verify-aerial (B, ~10; the ONE un-pinner
of the two new fleet pins) · verify-dusk (D, ~9) · verify-groundlife (C, ~9)
· verify-feel (E, ~8) · verify-neon-cover (F, ~7 + the six re-cert runs).
All: bootFly + `FLY_URL`, sun pinned per leg, weather baseline, player
hidden, traffic out of pixel crops, real engines, preconditions imply
assertions. Full sweep after each wave merge + at close; evidence PNGs only
on the merged tree (Fable).

### Risk table

| Risk | Mitigation | Who measures |
|---|---|---|
| Owens 261/261 worst case | catcher OFF + three independent shed levers + measured at W1 checkpoint AND pre-W2-merge; >255 base ⇒ Fable escalates shed order | Fable (checkpoints), B+C (own harnesses) |
| Typology mislabels a real downtown block | suburban-context guard defaults conservative (legacy curve on any tagged-tall presence); verify-suburbia asserts zero >14 m inferred in suburb chunks | A |
| z17 boot/fetch regression | ≤+20% boot gate; LODThreshold clamp fallback; LRU untouched | B |
| Aerial pass double-hazes vs tile band | startM ≥800 vs tile 16 km; A/B crops gate near (Δ≈0) and mid-band (Δ≥floor) | B |
| Dusk re-keying shifts a sun-pinned gate | SKY_DUSK inert at pinned noon by construction; full sweep after D's merge | D, Fable |
| Toy tri blow-up at NYC cruise | day-1 tile measurement; caps sized to measured 2.0 M; soak tris watch | F |
| Shadow acne / z-fight | tiles never receive; catcher (when opted in) is ShadowMaterial + polygonOffset, high-only | B |
| W2 Effects/FlyScene rebase friction | merge order F→C→E; E rebases on the merged W1 tree in its worktree | E, Fable |
| Procedural weather surprises a live session | fallback fires only on upstream MISS; fleet pinned baseline; determinism leg in verify-dusk | D |

---

## §7. Close

W2 sweep → soak 15 min → Fable drives the real cross-agent pairings (the
four-agent frame: shadowed typology suburb at dusk under procedural overcast
with streaks; C+D night Powell with house lights under the new lid) →
`FLY_ROUND19.md` with §6 user-checkpoint table (typology honesty, far-mass
read, aerial strength, shadow feel + catcher opt-in, dusk taste, cirrus, tint
subtlety, suburban night warmth, streak intensity, cinema/label/warp fixes,
Neon before/after + the six re-baselines, **carried R15–R18 §6 stacks + the
Neon nudge 7865ba4 sign-off row**) + §7 lessons + §5b follow-ups (sat water
material, plume prominence, phone-satellite device cert) → CLAUDE.md NEWEST
notice (R18 demoted to Earlier) → PR #6 `claude/round19-honest-world` → main,
merge commit.

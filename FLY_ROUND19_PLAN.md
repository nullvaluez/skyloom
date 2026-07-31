# FLY ROUND 19 — "Grounded & Alive" — PLAN


> Round plan (Fable-orchestrated, six Opus 5 agents in two waves). Authored
> 2026-07-31 from a three-explorer recon; approved by the user same day. The
> execution record will be FLY_ROUND19.md.
## Context

The user (who flies primarily around Powell, OH / Columbus) reports the game "just isn't
meeting the mark" visually — flying real suburban/rural areas feels flat despite the curved
mini-globe, satellite imagery, buildings, weather, and everything R11–R18 built. The ask: a
major visual enhancement + deeper flying immersion, six Opus 5 agents orchestrated with
per-agent review/sign-off, following the established round workflow. New models/shaders/
textures explicitly permitted.

Three exploration agents established the diagnosis (all claims verified in source, key ones
re-verified by the orchestrator first-hand):

- **A suburb is content-limited, not perf-limited** — Owens Valley runs 254–258 draws against
  a 470 budget. The layers that would make Powell feel alive are structurally silent there:
  - Roads render **zero pixels in daylight** (night-only shader; day = motorway-only 5%-duty
    glint) — `world-bend.js:1452+`, `SAT_ROADS.day`.
  - Trees spawn only from `park` / `landcover=wood` / `landcover=grass`
    (`vector-tile.worker.js:2221-2223`) — yards, street trees, farmland contribute nothing.
  - OpenFreeMap ships ~3 building footprints/tile outside dense cores (Naperville-class,
    documented in `verify-roof-variety.js:26-46`) — R18's roof machinery has nothing to work on.
  - **The altitude dead band**: veg gone by 2.4 km AGL, buildings by 3.0–3.2 km, and
    SAT_SKYLINE (minH 35) catches nothing in a suburb → from 2.4 km to cruise, pure photo on
    ~30 m-relief DEM. The "city becomes mass" handoff that saves Manhattan doesn't exist here.
  - **Nothing casts a shadow in satellite** (`FlyScene.jsx:1395` castShadow is toy-only).
  - satMaxZoom 16 ≈ 1.8 m/px → mush below ~800 m AGL; flat DEM makes hillshade/AO/micro carry ~0.
- **Toy/Neon carries the filed R19 headline defect**: `classifyRings` hard-codes the wrong
  winding sign → ~99% of toy polygons dropped at three frozen call sites
  (`vector-tile.worker.js:2419/:2573/:2839`). The proven fix (`classifyRingsSat` :247, flag
  dispatch idiom :1149) took satellite Manhattan 114→3,860 buildings in R18.
- Water = matte-green slab (filed R18 §5b #2); overcast-dusk sky = featureless tan dome
  (filed #3, sky half unfixed).

**Live playtest was attempted and honestly aborted**: this container's network policy
403-blocks the tile hosts AND shadowads.netlify.app, and SwiftShader drops the quality tier
to LOW (verified: Powell and Manhattan render as the identical empty sphere here). The
baseline playtest becomes Phase 0 of the round, runnable the moment the network opens.

## User decisions (locked 2026-07-31, via AskUserQuestion)

1. **Scope = ALL FOUR packages**: suburban ground truth · light/depth/altitude band · Neon
   winding fix · flight-feel immersion. **Six Opus 5 agents** (user raised the historical
   5-agent cap in the original request).
2. **Baseline** on the deployed site (shadowads.netlify.app) — currently network-blocked;
   follow-up question went unanswered → default: proceed on source-derived findings, baseline
   = Phase 0, each package re-validates its diagnosis against Phase 0 screenshots before its
   styling constants lock.
3. **All pending R13–R18 checkpoint tables TREATED AS APPROVED** — current values are the
   baseline (incl. Neon nudge `7865ba4`, re-judged after the winding fix); R19 may re-tune
   documented values; round ends with ONE fresh consolidated checkpoint table closing them all.
4. **Perf: spend the headroom** — measured, pre-sanctioned-by-name gate re-baselines (R14
   discipline). PERF_BUDGET 470 draws / 2.2 M tris / 12 ms GPU stays hard law; 15-min soak
   must pass.

## Phase 0 — live baseline (blocked on network; runs the instant it opens)

Hosts the user must allowlist in the environment settings: `shadowads.netlify.app`,
`server.arcgisonline.com`, `services.arcgisonline.com`, `tiles.openfreemap.org`,
`api.adsb.lol` (+ `api.open-meteo.com`, `aviationweather.gov` for live weather).

Ladder (local dev server + bundled Chromium `--enable-unsafe-swiftshader --use-gl=angle
--use-angle=swiftshader`, `NODE_PATH=/opt/node22/lib/node_modules`, tier held via the
sanctioned dev pin below; sun pinned noon + one dusk + one overcast-dusk pass; player hidden
for ground crops):
- Powell OH (40.1578, −83.0752): 300/700/1500/2500/4000/8000 m AGL (2500+4000 = the dead band on film)
- Columbus downtown 700/2500 m · Manhattan control 700/3000 m · Owens Valley 700 m (draw floor)
- Toy/Neon: Powell 700 m + Manhattan 700 m (winding baseline)

If the allowlist never opens: Phase 0 + browser gates + soak run on the user's machine (where
every R11–R18 sweep ran); this container carries node gates, builds, lint, and review.

## Hard constraints (violating any = regression)

No API keys/.env; tile providers only in `lib/fly/tile-sources.js` · no r3f-perf; pinned
three/r3f versions · per-frame data via `runtime` refs, never React/zustand state · every R19
constants block pre-seeded `enabled:false` (byte-noop); agents edit only their own block
interiors · **WORKER_PROTOCOL 14→15 exactly ONCE (A1, W1), all FIVE consumer pins lockstep**
(sat-building/sat-road/sat-skyline/sat-veg/toy-world engines); stale bundles DROP; new attrs
fail dark; `pushV` exactly 4 args · **world-bend: ZERO new cache keys; THREE sanctioned
modified-variant renames** (`world-bend-road-satnight-r16→-r19`, `world-bend-fade-hill-r13→-r19`,
`world-bend-water-satglint-r13→-r19`), all owned by A3, each with registry update + a
0-defaults identity proof (new shader terms multiply to exact 0.0 at defaults); the
one-new-key-per-round budget held in RESERVE for A3's road-edge contingency (Fable sign-off
required) · harness testids frozen · store literal `mapStyle:'toy'` sacred; `__toyWorld`
undefined in satellite · phones = static medium ceiling; texture types are device contracts ·
re-baselines only those pre-sanctioned by name below, measured, arithmetic recorded ·
evidence PNGs regenerate ONLY on the merged tree (Fable) · lint baseline 51 problems, add
zero · assets CC0/CC-BY direct-download, self-hosted, no accounts, ≤1 MB GLB, registered in
`lib/fly/assets.js` → `gen-credits.mjs`; never hand-edit CREDITS.md · nobody edits while the
user live-flies.

## Execution

**Scaffolding commit (Fable, before any agent launches):**
- 13 pre-seeded `enabled:false` constants blocks, each header naming its owner:
  `INFILL_SAT` `VEG_SUBURB` `SAT_SHADOWS` `ROAD_DAYLIGHT` `GROUND_MICRO2` `SAT_WATER2`
  `SKY_DUSK` `ALT_BAND` `TILES_Z17` `TOY_COVERAGE` `SPEED_CUES` `AMBIENT_DAY` `WIND_FEEL`
- FlyScene `RUNTIME CONTRACTS (R19)` comment (extends the R18 block at :471):
  `runtime.shadowAnchors` (A1 engine accessor → A2), `runtime.satVeg` (A1 → A2/A6); all
  reads optional-chained.
- **Sanctioned dev-only tier hold**: `window.__flyTierPin` honored by `stepQualityTier` in
  `FlyCanvas.jsx` under a `process.env.NODE_ENV==='development'` guard (dead code in prod).
  Nothing in `_boot.js` sets it — only SwiftShader-environment harnesses set it explicitly
  (the R16 fleet-pin idiom, inverted).
- `__flyStats.fps/frameMs` stub comment (A6 fills).
- FLY_ROUND19_PLAN.md checked in.

| Wave | Agents (parallel, isolated worktrees off the round branch) | Merge order |
|---|---|---|
| W1 | A1 Homestead · A2 Suncast · A3 Daylight · A6 Airsense | A1 → A3 → A2 → A6 → full sweep |
| W2 | A5 Neontrue · A4 Skyfall | A5 → A4 → full sweep |
| Close | Fable | merged-tree evidence → soak → record → PR |

One owner per file per wave. **The worker: A1 in W1, A5 in W2 — nobody else, ever.** Other
key files: `world-bend.js` = A3 (W1 only) · `FlyScene.jsx` = A2 (W1) / A4 (W2) ·
`FlyCanvas.jsx` = A6 (W1). Agents run their own gate + ad-hoc dev servers (:3101–:3103),
never the full fleet, never commit to the round branch; Fable reviews every diff, merges in
order, sweeps after each wave, owns integration fixes as separate commits, drives every real
cross-agent pairing itself (R18 lesson: a seam both sides tested is still untested).

## Charters (six Opus 5 agents)

### A1 "HOMESTEAD" (W1) — suburban ground truth; worker owner W1; protocol 15
Owns: `vector-tile.worker.js` (all W1 edits), `sat-building-engine.js`, `sat-veg-engine.js`,
`SatVegLayer.jsx`, `SatBuildingLayer.jsx`, five protocol-pin bumps, `INFILL_SAT`+`VEG_SUBURB`
blocks (+ documented `SAT_VEG` pool re-tunes), NEW `scripts/verify-suburb.js`.
- WORKER_PROTOCOL 14→15 (the round's single bump).
- **Veg sources**: extend the scatter (worker:2205+) to `landuse=residential` (yard trees ~1
  per 700 m²), `farmland`/`orchard` (field-edge rows), and **street trees** sampled along
  minor-road chains inside residential landuse (~38 m spacing, hashed jitter, ~7 m offset).
  Same `[x,z,r,kind]` array, new kinds 2 (yard/street) and 3 (hedge) — same InstancedMesh,
  +0 draws. Pool 3000→4500 high / 1500→2200 medium (documented).
- **House infill**: worker-side synthesis along residential road setbacks, gated by scarcity —
  only when parsed buildings < `INFILL_SAT.maxRealBuildings` (40) AND tile has
  residential landuse. Rows along minor roads: setback 12–18 m, spacing 28–45 m, 90–220 m²,
  h 5–8 m, deterministic per-tile seed, cap 180/tile, strictly inside residential polygons,
  merged into existing chunk meshes via the ROOFS_SAT house band → **+0 draws**. Honesty
  rails (the R18 area-hatch lesson): height 5–8 m only, never where real data is dense,
  `meta.synth` count emitted, dies with `INFILL_SAT.enabled:false`.
- Publishes `runtime.shadowAnchors` + `runtime.satVeg`. Implements A3's spec'd `SAT_WATER2`
  material-creation flags at the engine's one guarded line (named seam).
- NOT: toy call sites :2419/:2573/:2839, world-bend.js, FlyScene, shadows, road look.

### A2 "SUNCAST" (W1) — satellite shadows; FlyScene owner W1
Owns: NEW `components/fly/SatShadowLayer.jsx` + NEW `lib/fly/sat-shadow-pool.js`,
`FlyScene.jsx` (mount + contracts upkeep), `SAT_SHADOWS`, NEW `scripts/verify-shadows.js`.
- **Per-object blob instancing** (rejected: screen-space AO = whole-frame fill rate, the axis
  that killed the R13 ortho rig; baked skirts can't track the live sun). Two pooled
  InstancedMesh quads (buildings ≤1500, veg ≤1500 high; buildings-only ≤800 medium), soft
  radial CanvasTexture, MultiplyBlending, depthWrite off, polygonOffset. Placed on a 2 s
  cadence from `runtime.shadowAnchors`/`runtime.satVeg`; offset along live sun azimuth,
  length clamped, opacity ∝ sun elevation (exact 0 below horizon and when disabled);
  alt-fade reads `SAT_BLDG_FADE`/`SAT_VEG.altFade` live. **+2 draws high / +1 medium**;
  `visible=false` at count 0 (Owens veg pool is non-empty → its +1 is pre-sanctioned).
- NOT: worker, engines, world-bend, PlayerGroundShadow, sky, any composer pass.

### A3 "DAYLIGHT" (W1) — world-bend owner W1: day roads, ground micro v2, water
Owns: `world-bend.js` (the three variant renames + registry), `ROAD_DAYLIGHT`+`GROUND_MICRO2`
+`SAT_WATER2` blocks, NEW `scripts/verify-daylight-ground.js`.
- **Day roads** (extend existing road variant, key →`-r19`): (A) `uRoadDayLift` — steady
  class-weighted pale-asphalt lift via the existing `uClsW` LUT (arteries lead, residentials
  whisper; cap ~0.15 — class STRUCTURE, not level, makes it read as a grid, not haze),
  (B) `uRoadDayTraffic` — slow sparse dash trains on cls 3–6 by day. Night terms untouched;
  both terms exact-0 at defaults. Contingency (reserved new key + Fable sign-off + A5-wave
  worker work): `aRoadCross` edge-paint attribute, 0-encoded to fail dark.
- **Ground micro v2** (inside `applyHillshade`, key →`-r19`, all inside the existing
  `uMicroStrength` envelope — toy pinned 0 stays byte-identical): second noise octave with
  amplitude/scale modulated by the tile texel's own chroma (field vs urban grain — no
  invented parcel lines), sun-azimuth gradient-luma shading; band 1500/2500 → 2200/3200.
- **Water rework** (`applyBendWaterSat`, key →`-r19`, + `SAT_WATER2`): normal-blended
  deep-water tint (darkens the matte slab), grazing-angle brightening, distance-feathered
  shore softening, existing glint on top. Stays high-tier, `maxWaterChunks 12` unmoved.
- NOT: worker, engines, FlyScene, sky/HDRI, constants outside its three blocks.

### A6 "AIRSENSE" (W1) — flight feel: speed cues, wind, day life, fps stats
Owns: NEW `components/fly/SpeedStreaks.jsx` + NEW `components/fly/AmbientBirds.jsx`,
`FlyCanvas.jsx` (mounts), `audio-engine.js`, `SPEED_CUES`+`AMBIENT_DAY`+`WIND_FEEL` blocks,
NEW `scripts/verify-airsense.js`.
- **Speed cues: camera-anchored wind streaks** — one InstancedMesh of thin quads in camera
  space (+1 draw), opacity ∝ airspeed above threshold AND AGL-weighted (intensifies low,
  where speed feels fastest); `visible=false` below threshold → 0 draws/pixels at every
  frozen probe pose. Rejected: FOV ramp (the fleet flies at held boost under
  `__flyBoostInfinite` — it would move every frozen screenshot gate).
- **Wind audio**: AGL-proximity gain + gust LFO on the existing wind bus; zero new nodes off.
- **Ambient day birds**: ≤6 flocks × ≤12 instanced V-quads (+1 draw, high tier, day only)
  on closed orbits around park/water anchors from `runtime.satVeg` (the SAT_AMBIENT leash
  discipline — closed paths, never free integration).
- **`__flyStats.fps` + `frameMs`** (p50/p95, 60-frame window) from its own useFrame.
- NOT: FlyScene, chase-camera (SHAKE untouched), flight-model, worker, music-director, HUD.

### A5 "NEONTRUE" (W2) — the winding fix; worker owner W2
Owns: worker (ONLY the three call sites + dispatch + additive toy meta counts),
`toy-world-engine.js` interior (cap plumbing), `TOY_COVERAGE` block (+ documented re-tunes
in `TOY_WORLD`/`ROOFS`/`WORLD_EDGE`), NEW `scripts/verify-toy-coverage.js`.
- `TOY_COVERAGE.enabled` mirrors `ROOFS_SAT.enabled` semantics: ONE flag, false = R18 code
  paths byte-identically. Dispatch per the :1149 idiom at :2419, :2573, :2839. Shared helper
  bodies untouched. Neon palette HUE untouchable.
- **Measure counts FIRST** (node MVT counts on frozen reference tiles — the R18 "coverage
  defect masquerades as variety complaint" lesson), then re-tune the caps that will newly
  bind (`TOY_WORLD.buildings.maxPerChunk 700`, trees 220, grass 320, maxChunks 160,
  ultraRing budgets, ROOFS per-chunk caps) — tris are the risk axis, draws barely move.
- Certification sequence: node counts → flag-on toy pose screenshots (Neon Manhattan/Queens/
  Powell) → tri/draw at verify-neon-city + FL300 poses → cap tuning → the pre-sanctioned toy
  re-baseline sweep → Fable A/B incl. re-judging Neon nudge `7865ba4` → soak.
- NOT: sat worker paths, protocol (already 15), classify function bodies, world-bend, sat gates.

### A4 "SKYFALL" (W2) — dusk sky, altitude band, z17 evaluation
Owns: `SkyDome.jsx`, `SatEnvironment.jsx`, `FlyScene.jsx` (W2; sky plumbing only),
`SKY_DUSK`+`ALT_BAND`+`TILES_Z17` blocks, NEW `scripts/verify-dusk-sky.js`.
- **Overcast-dusk sky**: gradient retention — the lid keeps a vertical gradient + sun-azimuth
  warm bruise at dusk (terms scale with overcastT×duskT, exact 0 at baseline/noon → pinned
  daylight gates byte-stable). Works with `SKY_LIVE.weatherDim/overcastLid` + the
  `SKY.altAtmo.tod` dusk keyframe (re-tunes documented, old values inline).
- **Dead-band fix: fade extension, no new layer** (rejected: settlement-mass tint = invented
  mass over photo; skyline minH lowering = nothing to mass in a suburb, the killed R18
  hatch). `ALT_BAND` (read-sites prefer it when enabled): `SAT_BLDG_FADE` 2400/3000/3200 →
  3200/4000/4200; `SAT_VEG` altFade 1800/2400 → 2400/3200, cull 2000/2600 → 2800/3400; roads
  stay 4200/5200 — now the day-lit grid visibly carries 0→5.2 km and micro v2 bridges to
  cruise. Streaming cost measured in W2 (draw-neutral by cap; fetch/tri transient recorded).
- **satMaxZoom 16→17: tier-gated evaluation, NOT default-on.** `TILES_Z17 {enabled:false,
  satMaxZoomByTier:{high:17}}` through a selector at the `tile-sources.js` read site. Ships
  enabled-at-high only if measured (tile-draw delta, texture bytes vs the 140 MB LRU / 300 MB
  law, stream churn at 300–800 m) and the soak holds; else it's a checkpoint-row knob.
- NOT: worker, world-bend, Effects/bloom, weather-model, HDRI files, tracers.

## Budgets & pre-sanctioned re-baselines

Baseline (measured): Owens 254–258 ≤261 · Manhattan 263 · sat low-AGL ≤375 · toy 363–364
≤480 · soak p95 8.4–12.6 ms. Adds: A1 +0 draws (+~280 k tris worst) · A2 +2 high/+1 medium ·
A3 +0 · A6 +1 streaks (0 at probes) +1 birds (high/day only) · A4 z17 tile-delta measured
(est. +15–40, high only) · A5 toy +30–80 draws, tris capped back under 2.2 M.

**Pre-sanctioned by name (with arithmetic, recorded in the round record):**
- `verify-sat-depth` Owens **261 → 268** (+1 veg-shadow pool over the 254–258 floor + slack;
  still ~200 under budget).
- sat low-AGL **375 → 400** IFF z17 ships at high (measured delta recorded).
- Toy pose assertions in `verify-neon-city`/`verify-neon-alt` re-measured post-winding
  (est. 363→≤440; the 480 ceiling and PERF_BUDGET do NOT move).
- The full toy visual re-baseline fleet (A5): verify-neon-city, -neon-alt, -roofs,
  -window-grids, -rim, -globe, -globe2, -poi, -edge-fx, -monuments, -tracers, -airbend,
  soak-fly.

Tier matrix: low = none of R19 (static source gates). Medium (=phones) = suburb veg + infill
+ building shadows (800) + day roads + micro v2 + ALT_BAND + winding fix + streaks + fps
stats. High adds veg shadows, water rework, z17 (if certified), birds, gust bed, pool 4500.
Named shed levers: every block's `enabled:false` + `SAT_SHADOWS.maxByTier`,
`INFILL_SAT.maxPerTile/maxRealBuildings`, `VEG_SUBURB` densities, `ROAD_DAYLIGHT.lift→0`,
`TILES_Z17.enabled`, `ALT_BAND.enabled`, `TOY_COVERAGE` caps, `SPEED_CUES.count`.

## Verification

**Existing gates at risk + defense:** verify-sat-depth (ledger above; micro v2 inside the
strength-0 A/B) · verify-roof-variety (infill scarcity gate keeps dense tiles clean) ·
verify-veg (re-measure under its pinned sun; moves = named re-baseline) · verify-skyline
(ALT_BAND must keep the hole-ease coupling; run both flag states) · verify-sat-night (day
terms exact-0 at night) · verify-chase-cam (streaks invisible below threshold) ·
verify-crash/juice (files untouched; sweep) · **verify-sat-mobile MUST run this round**
(R18 §5b #5 debt).

**NEW gates (six):** `verify-suburb` (Powell/Naperville pose: infill count band on
generalized tiles, ZERO synth on Manhattan, synth-within-setback proof via worker meta, veg
floor in residential landuse, Owens synth 0, luma-delta band, sun+weather pinned) ·
`verify-shadows` (noon count>0, midnight exact-0, ground-crop A/B band, Owens ≤268,
count-0⇒visible=false) · `verify-daylight-ground` (road-day A/B luma band at Powell 800 m +
identity at lift 0, micro-v2 identity at strength 0, water tint/shore probes) ·
`verify-dusk-sky` (overcast-dusk vertical-gradient std ≥ floor, noon byte-stability,
per-state sun+weather pins) · `verify-toy-coverage` (feature-count floors on reference
tiles, flag-off byte-identity, tri ceiling at FL300) · `verify-airsense` (streak draw only
above threshold, absent at probe cruise, fps/frameMs sane, zero audio nodes off).

Every visual-metric gate pins sun AND weather at authoring time (the R18 twice-detonated
lesson); probe preconditions must imply assertions; pixel probes hide `__flyPlayer`; use
`material.visible` flips, ground-only crops, same-run noise controls.

**Where verification runs:** this container today — lint, build, node gates, worker-logic
probes on vendored tile fixtures; once the allowlist opens — the full browser fleet under
SwiftShader with `__flyTierPin='high'`; if it never opens — browser gates/evidence/soak on
the user's machine. fps floors are never asserted under SwiftShader; perf numbers come from
the user's machine.

## Close deliverables

FLY_ROUND19.md round record (winding before/after counts, every documented re-tune with old
values inline, re-baseline arithmetic, probe-determinism ledger) · **ONE consolidated user
checkpoint table formally closing R13–R18's open tables** + the R19 rows (infill look,
shadow feel, day-road level, dead-band climb, dusk sky, water, z17, streaks/wind taste,
Neon-after-winding incl. `7865ba4` re-judgment) · CLAUDE.md notice update · PR to main
(user must explicitly request PR creation per repo rules — confirm at close).

| Risk | Mitigation |
|---|---|
| Infill reads "SimCity over photo" | road-setback alignment + 5–8 m honesty rail + scarcity gate + one-line revert + Phase-0 re-validation before styling locks |
| Winding fix blows toy tris | measure-first node counts; named cap levers; flag-off byte-noop; own W2 wave |
| Day-road lift reads as haze | class-structured lift, cap 0.15, A/B band gate, reserved-key contingency |
| Shadow blobs read as bugs | cadence sun tracking, offset clamp, elevation-0 opacity, verify-shadows bands |
| z17 churn (why R11 dropped it) | tier-gated flag, default-off until measured, checkpoint row |
| ALT_BAND streaming cost | draw-neutral by cap; transient measured in W2; enabled:false revert |
| Network allowlist never opens | Phase 0 + browser evidence fall to the user's machine; container holds node gates + review |
| Worker owner collision | hard rule A1=W1 / A5=W2, disjoint ranges, protocol bumped once |
| New gates flake on live data/sun | per-state sun+weather pins; preconditions imply assertions |

## Orchestration workflow (how this executes)

1. Phase 0 baseline (or user-machine fallback) → re-validate diagnoses.
2. Fable: scaffolding commit on `claude/game-visual-flight-immersion-aiudsm`.
3. W1: launch A1/A2/A3/A6 (Opus, isolated worktrees, charters above). Fable reviews every
   diff, arbitrates deviations (recorded), merges A1→A3→A2→A6, drives real seam pairings,
   runs the wave sweep.
4. W2: launch A5/A4 the same way; merge A5→A4; sweep.
5. Close: merged-tree evidence PNGs, full harness sweep + node gates, 15-min soak, round
   record, consolidated checkpoint table, CLAUDE.md notice; PR only on explicit user request.

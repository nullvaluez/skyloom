# FLY ROUND 18 — "Alive & Dangerous" — PLAN

> World that reads like a real city from the air (satellite-first: real roof
> variety, suburb coverage, distant skyline mass, living ground, sawtooth-water
> fix) · Arcade layer with juice and stakes (near-miss/combo/session score,
> screen shake, procedural music, boost meter, CRASHES — on by default).
> Five Opus 5 agents in two waves under Fable orchestration. Plan authored
> 2026-07-27 after a 3-explorer + 1-architect pass AND a live GPU fly-around
> (headless-chrome tour, high tier: NYC 250 m–4,000 ft day/night, Naperville,
> Alps, Neon — every diagnosis below was seen on screen, then verified in
> source).

## 0. Why this round

The user's R17 verdict: the world still feels boring — "buildings have no
variety, we are still missing ROOFS," and the game should feel arcade-fun.
Five verified root causes:

1. **Day-satellite building read** — uniform dark charcoal prisms floating on
   pale imagery (R13 §8 flagged `wallTones` "reads dark", never tuned); one
   silhouette; monuments read as blank clay.
2. **Roofs effectively absent** — gable requires an exact-4-corner simplified
   ring + h<16 + area<400 m² (most houses fail); nothing at 16–18 m; nothing
   above 120 m in satellite (crown/spire/beacon are toy-only); no rooftop
   clutter. **Suburb bug (verified at worker:749/:766)**: `sort(b.area-a.area)`
   + `slice(0, 500)` keeps the 500 *largest* footprints — the house carpet that
   IS a suburb is dropped wholesale; untagged-house inference (`9+√area·0.5`)
   makes a 150 m² house 13–17 m tall.
3. **Scale illusion breaks** — the 2.7 km bubble edge is visible; the city
   vanishes above ~7,200 ft (R16 §8 already named the skyline proxy).
4. **Dead/jarring ground** — zero satellite vegetation/props; satWater glint
   sawtooths over the Hudson (OpenFreeMap 404s open-water tiles, R13 §5).
5. **No arcade loop** — no combos/near-miss/session score/music; boost is a
   free preset; `CAMERA.shake*` constants have ZERO readers; no crash.

Already reads well (do not touch): satellite night, high-tier terrain relief,
Neon night coherence, HUD/toast/tracer feel.

## 1. User decisions (locked 2026-07-27)

- Satellite-first; Neon gets ONLY a Fable-authored value/warmth nudge at round
  close (A/B screenshots, user sign-off; palette hue untouched — taste lock).
- World scope: roofs+variety AND city scale AND living ground AND jarring reads.
- Arcade scope: score juice + game feel AND crash stakes. NOT this round:
  rings/courses/time-trials, XP/unlock economy.
- **Crashes ON by default**; persisted "Forgiving flight" toggle = R17 behavior.
- **Full boost meter** (6 s / 12 s regen / 25% re-arm; autopilot exempt).
- Perf: modest tier-gated spend; empty scenes flat (Owens ≤261, no re-baseline).

## 2. Hard constraints (violating any = regression)

No API keys · no r3f-perf · never per-frame data through React state/zustand
(runtime + refs) · all tunables in `lib/fly/fly-constants.js` (R18 blocks are
pre-seeded `enabled:false` = byte-noop; agents edit only their own block
interiors) · harness testids frozen · ZERO gate re-baselines (none sanctioned
this round) · toy worker outputs byte-identical (new sat helpers are NEW
functions; shared `pushGable/pushParapet/pushAABBox/pushCrown/pushSpire` bodies
+ toy `ROOFS` values FROZEN) · every new worker helper calls `pushV` with
EXACTLY 4 args (NEUTRAL_UV window-free roof contract) · WORKER_PROTOCOL 13→14
once (A1), all four engine pins move in lockstep, stale v13 bundles DROPPED by
new engines · ONE new bend cache key (`world-bend-anchor-satskyline-r18`) +
registry entry, no existing GLSL/key moves (need one = escalate to Fable) ·
low-tier behavior via STATIC source gates only · phones = static medium
ceiling · evidence PNGs regenerate ONLY on the merged tree (Fable) · nobody
edits while the user live-flies.

## 3. Execution: waves, ownership, contracts

Scaffolding (THIS commit): 11 constants blocks (`ROOFS_SAT SAT_SKYLINE SAT_VEG
SAT_AMBIENT SHAKE NEARMISS COMBO SESSION MUSIC BOOST_METER CRASH`), fly-store
R18 fields + stubs, FlyScene `RUNTIME CONTRACTS (R18)` comment, this plan.

| Wave | Agents | Merge order |
|---|---|---|
| W1 (parallel) | A1 Blocksmith · A4 Showtime · A5 Gravity | A1 → A5 → A4 → sweep |
| W2 (parallel) | A2 Skyline · A3 Groundskeeper | A2 → A3 → sweep |

One owner per file per wave. FlyScene: A5 (W1), A2 (W2). SatBuildingLayer: A1
(W1), A3 (W2). Cross-agent calls optional-chained (`juice?.onCrash()`,
`audio.crashThud?.()`); cross-agent data only through `runtime.boost` /
`runtime.satBuildings` / `runtime.juice` (spec'd in FlyScene comment).

## 4. Charters

### A1 "BLOCKSMITH" (W1) — roofs/variety/suburbs/tones/water, protocol 14
Owns: `lib/fly/toy-world/vector-tile.worker.js` (ALL R18 edits incl. the
'sat-skyline'/'sat-veg' branches W2 consumes), `sat-building-engine.js` (pin
14, neighbor-gated ocean fill, collision-column index + `queryColumns` for A5,
A/B luminance support), `SatBuildingLayer.jsx` (`runtime.satBuildings`),
one-line pin bumps `sat-road-engine.js`/`toy-world-engine.js`, `ROOFS_SAT` +
`SAT_BUILDINGS` retunes + `SAT_WATER` additions, NEW `scripts/verify-roof-variety.js`.
- New 4-arg helpers: `pushInsetPeak` (rim→centroid-inset ring at +riseM;
  0.42=hip / 0.25=mansard / 0.55=pyramid — handles non-4-corner rings),
  `pushShed`, `pushPenthouse`, `pushWaterTank`, `pushChimney`, `pushMastSat`/
  `pushAntennaFarmSat`, `pushCrownSat`/`pushSpireSat` (geometry-only, no
  emissive). Zero extra draws; ≈+48k tris worst case.
- Dispatch matrix per ROOFS_SAT bands; "always-something" guarantee, flat-only
  share ≤5% (gated).
- Suburb fix: top-`anchorCount` by areaM2×h, then fill 500 sampling the
  remainder over a HASH-SHUFFLED order (MVT order is spatially clustered — raw
  stride keeps one corner). House inference band `houseInfer` (≤220 m² → 5–8 m).
- Tone re-tune MEASURED: wallTones value ~+18% warm-nudged, wallBaseMul[0]
  0.5→0.62, roofTones.mid/tall lift; verify-roof-variety pins a building-vs-
  imagery luminance-delta band (~8–25/255) + luma-std floor via visibility-flip
  A/B shots (old values preserved in comments).
- satWater: worker emits `waterCoverage`; engine synthesizes a full-tile water
  quad on 404 tiles with ≥2 ring-neighbors at coverage ≥0.6 (inside
  maxWaterChunks 12; high tier only).
- Adds `out.satBuilding.meta {total, kept, smallKept, forms}` (additive,
  sentinel-safe).
NOT: toy-path worker functions, world-bend.js, FlyScene, flight/camera/audio/
HUD, toy `ROOFS` values.

### A4 "SHOWTIME" (W1) — near-miss/combo/session, shake, music, boost bar
Owns: `chase-camera.js` (shake post-slerp, wires dead CAMERA.shake* semantics,
zero motion at probe speeds), `audio-engine.js` (whoosh/crash-thud one-shots +
`bus()` accessor), NEW `lib/fly/juice.js` (trauma/combo/near-miss/session pure
module), NEW `lib/fly/music-director.js` (4 procedural layers: AGL air bed,
speed pulse, proximity tension, night pad; D-dorian; 2 Hz; `setTargetAtTime`;
enabled:false ⇒ zero nodes), NEW `JuiceSystems.jsx` mounted from
`FlyCanvas.jsx`, NEW HUD `ComboChip/RunSummary/BoostBar`, `FlyHUD.jsx` +
`LayoutRoot.jsx` zones (ComboChip `score` zone, pointer-events:none; BoostBar
desktop rail + phone ring-fill on the BOOST pad; RunSummary ≥44 px dismiss),
`SpotToast.jsx` 'nearmiss' flavor, store session call sites, `SHAKE NEARMISS
COMBO SESSION MUSIC`, NEW `scripts/verify-juice.js`. `__flyStats.juice`.
NOT: FlyScene, FlyMode, flight-model, input-controller, worker/engines,
PauseMenu, frozen testids.

### A5 "GRAVITY" (W1) — crash, respawn, boost meter
Owns: `flight-model.js` (floor-contact telemetry `{vy, speed}` one line in the
clamp branch + meter-coerced boost — byte-identical when disabled),
`FlyScene.jsx` (crash sequence, meter in cmd assembly, `runtime.boost`), NEW
`lib/fly/crash-system.js`, NEW `CrashFlash.jsx`, `FlyMode.jsx` (mount),
`PauseMenu.jsx` + `fly-settings.js` ("Flight stakes: Crashes ON / Forgiving",
persisted), store crash sites, `CRASH BOOST_METER`, NEW `scripts/verify-crash.js`.
- Terrain crash iff sink >30 m/s at contact OR (speed >200 AND pitch <−18°);
  gentle contact keeps the R6 slide. Building crash (satellite only) via A1's
  `queryColumns` cylinders at ≥45 m/s. **Arm gate 5 s after mount AND every
  warpEpoch bump** — no harness/probe/pinScene pose can crash (fleet-safety
  invariant).
- Sequence ~1.8 s: neutralize → ballistic tumble → CrashFlash →
  `juice?.onCrash()` + `audio.crashThud?.()` → respawn 2 km back-along-track at
  ground+400 m, cruise, `chase.snap()`, `bumpCrashEpoch()` → RunSummary. Buzz
  detector reset.
NOT: chase-camera/audio/HUD chips, worker/engines, contracts/passport.

### A2 "SKYLINE" (W2) — city-scale + monuments
Owns: NEW `sat-skyline-engine.js` + `SatSkylineLayer.jsx`, `world-bend.js`
(ONE new variant `applyBendAnchorSatSkyline`, key
`world-bend-anchor-satskyline-r18`, registry entry), `FlyScene.jsx` (mount
line), `landmarks-3d.js` + `LandmarkMonuments.jsx`, `SAT_SKYLINE` +
`LANDMARKS_3D.satStyle`, NEW `scripts/verify-skyline.js`.
- z13 block-mass ring per SAT_SKYLINE; near-field Bayer hole (skyline only
  beyond the detail bubble; 2400→3000 m crossfade — the city BECOMES mass);
  own cull to ~30k ft; **empty chunks issue no mesh** (Owens by construction).
  Day-1 probe with `scripts/inspect-mvt.mjs`; contingency ring z14 r14000.
- Monuments: silhouette pass (setback ledges, chamfered WTC shaft, buttress
  hints, ≤1,200 verts) + `variant:'sat'` value-only vertex-color stone shading
  (sat material flips vertexColors:true; toy paths byte-identical). +0 draws.
NOT: worker (A1's branch frozen), sat-building-engine, toy monument paths.

### A3 "GROUNDSKEEPER" (W2) — vegetation + ambient life
Owns: NEW `sat-veg-engine.js` + `SatVegLayer.jsx` + `SatAmbientLife.jsx`,
`SatBuildingLayer.jsx` (mount lines), `SAT_VEG` + `SAT_AMBIENT`, NEW
`scripts/verify-veg.js`.
- Consumes A1's `satVeg` [x,z,r,kind] + `satPts {water, ind}`. ONE pooled
  global canopy InstancedMesh (existing `applyBendAnchor`, MeshLambert,
  desaturated palette, luma jitter), pool per SAT_VEG, cadence placement,
  cached 3×3 bilinear ground. **visible=false at count 0** (Owens flat). Alt
  fade [1800, 2400 m] via instance color.
- Movers (high tier, +1 draw each): harbor boats (≤48 hulls, drift + 1.5 m/s)
  and industrial steam plumes (≤12 stacks × 3 soft-quads, rise-and-fade).
NOT: worker, world-bend.js, FlyScene, monuments.

## 5. Budgets & tiers

Draw ledger (city base measured 240–265): city +≤15 ⇒ ≈253–280 ≤ 375 ✓;
**Owens +0–1 ⇒ ≤255 ≤ 261 ✓** (empty-issuance + visible:false invariants,
pinned twice by new harnesses); toy 0. Tris: +≈50k roofs, ≤250k skyline worst,
≈60k veg vs 2.2M (levers: SAT_SKYLINE.minH/maxPerChunk, SAT_VEG.poolByTier).
Tiers: low = game layer only; medium (=phones) = roofs/suburbs/tones, skyline
6, veg 1500, monuments, full game layer; high adds boats/plumes, satWater +
ocean fill, skyline 10, veg 3000.

## 6. Verification

Existing gates UNCHANGED (at-risk + defense): verify-sat-depth (empty
issuance/visible:false), verify-chase-cam (shake silent at probe speeds),
verify-sat-night (skyline sun-independent), toy suite (worker toy paths
byte-identical), soak-fly tris (named levers), verify-fly-formation/
inspect-actions (autopilot meter-exempt), verify-warp-arrival (arm reset).
NEW: verify-roof-variety (suburb small-share ≥0.4, ≥4 forms, flat-only ≤5%,
pinned luminance band + std floor) · verify-skyline (Owens ready===0 AND ≤261;
NYC 5,000 m flip-mass; 600 m near-crop Δ≈0) · verify-veg (park canopy ≥200 +
green-mass A/B + saturation bounds; Owens ≤261; boats inside water; toy never
mounts) · verify-juice (synthetic track on domain clock → near-miss exactly
once; combo/mult; shake under-trauma/absent-at-cruise; boost drain/block;
music node A/B) · verify-crash (source-asserts armDelaySec ≥5; 30 s level
flight ⇒ no crash; dive ⇒ crash/respawn/summary; Forgiving ⇒ R17 slide;
Manhattan building crash sat-only; Alps wall inside arm window ⇒ no crash).
Full sweep after each wave merge; evidence on merged tree at close.

## 7. Close

Neon nudge (Fable, isolated commit + A/B → sign-off) · FLY_ROUND18.md with the
user-checkpoint table (crash feel, meter numbers, tone delta, skyline
crossfade, veg look, music taste, combo pacing, Neon nudge + carried R15–R17
checkpoints) · CLAUDE.md notice · PR to main.

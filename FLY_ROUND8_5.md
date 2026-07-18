# Fly Round 8.5 — Inspect-card rework + toy-vs-satellite feel parity

> STATUS: BUILT + SWEPT GREEN (2026-07-17) — §A parity (H1 ryd drawn-frame,
> H2 radius 100k, H3 fog-exempt trails), §B inspect card (runtime-bus,
> right-dock, photo-hero w/ turntable fallback), §C Information Entropy church
> waypoint all landed and harness-verified (12/12). Diagnosis below was from a
> read-only code investigation (Fable fork agent) done while round 8 built.
> CAUTION: file:line refs are working-tree positions AFTER round-8 P4–P6 edits —
> re-verify before editing.

## A. Toy-vs-satellite feel gap (user: satellite "STILL feels better and works
## better with contrails and the height of planes")

The contrail/tracer renderer is the SAME component in every style
(`TrafficTracers.jsx:56-64`, one additive draw; `Contrail.jsx:30-38` player
ribbon; both bend via `applyBendAir(mat, GLOBE.trafficBend)` at
`TrafficTracers.jsx:167,427`). What differs per style are the INPUTS. Ranked:

### H1 (top) — Frame mismatch: toy draws ground higher than the air-math ground
Toy draws terrain at `elev × 1.7 + 2.5` (`TOY_WORLD.terrainExaggeration`
fly-constants.js:379, `groundLift` :378; applied toy-world-engine.js:380 and to
grounded-plane pins FlyScene.jsx:171-177). Airborne traffic flies at TRUE
altitude (`t.ry`, never exaggerated) and the air-bend cap uses TRUE ground:
`setBendEye(flight.pos.y, flight.groundElev)` (FlyScene.jsx:575; "flight floor
uses TRUE DEM" fly-constants.js:379). In relief, a plane's visual height above
the DRAWN ground is compressed by `0.7×elev + 2.5` m — at a 600 m-elevation
field planes read ~420 m too low. Satellite (exaggeration 1) has no mismatch.
**Fix (small, gated `TOY_WORLD.airFrameFollowsDrawnGround`, live-tunable):**
in toy express traffic Y in the drawn frame — `yDrawn = drawnGround +
(ryTrue − trueGround)` via the already-registered elevation sampler
(FlyScene.jsx:171-177 has both frames) — OR pass drawn-ground to `setBendEye`
in toy so cap/AGL blend agree with the render.

### H2 — Toy curvature 25% stronger than satellite
`GLOBE.bendRadiusM = { satellite: 100000, toy: 80000 }` (fly-constants.js:
420-424; `k = 1/(2R)` FlyScene.jsx:565-566). At 25 km: 3.9 km drop (toy) vs
3.1 km (satellite). High-AGL traffic is rescued by farLiftBoost
(fly-constants.js:446-459, `uAirCapFar` world-bend.js:132,244) but the low/mid
band (AGL 150–900 m blend) keeps FULL drop — approach/departure traffic and
contrail far-tails curve down visibly harder in toy.
**Fix (constant, one-reload A/B):** `bendRadiusM.toy: 100000`, or toy-specific
`keepFrac`/`aglHiM` override.

### H3 — Toy fog ~2.7× denser; air objects have no fade patch so fog is their
### only distance treatment
`TOY.fogDensity 0.00002` (round 8 raised it, fly-constants.js:325) vs satellite
`0.0000075` (:280). Air-anchor variant carries "No base fade/haze"
(world-bend.js:33) and Basic materials default `fog: true` — at 25 km a
contrail is ~22% washed toward `#131832` in toy vs ~3% in satellite. Round-8
bloom retune (0.9/0.56) dims additive tracers slightly further.
**Fix:** `fog: false` on tracer/contrail materials (they own alpha ladders
already), or a per-style `TRACERS` alpha floor.

### H4 — Perceptual cues (no bug)
Satellite has imagery + DEM hillshade = size/parallax cues under every plane.
Round 8's grids/AO/roofs/shadows should close much of this — re-evaluate H4
only after the user flies the round-8 build.

## B. Inspect-card actions + redesign

### Root causes (verified in code)
1. `runtime` = stable `useRef({}).current` (FlyMode.jsx:38); ONE FlyScene
   effect (FlyScene.jsx:156-311) mutates handles on (`warpTo` :182, `warpToGeo`
   :217, `interceptHex` :272); cleanup NULLS them + disposes engine/traffic
   (:295-310). Style switches do NOT remount (:399-404); the dead window is
   FlyScene unmount/remount (Suspense/error-boundary/HMR — `sceneRemounts`
   tripwire :286-290). Failure feedback today = 10px line + 0.35 s shake
   (InspectModal.jsx:485-497) — reads as "nothing happened".
2. `live` sampler (InspectModal.jsx:78-109) silently bails unless `t.fix1`
   (:81) → WARP `disabled={!live}` shows "ACQUIRING…" forever (:456-467) with
   no path out. CHASE never disabled but `interceptHex` returns false on
   `stale === 2` (:274) → quiet shake.
3. `warpTo` requires `fix1` (:184) only to derive speed (:198) — stricter than
   the position warp needs (`rx/ry/rz` suffice).

### Fix plan (per-file)
- **`lib/fly/runtime-bus.js` (new, ~30 lines):** module-level action registry;
  FlyScene registers on every mount; `runtimeReady` flag in fly-store; actions
  resolve AT CALL TIME so remounts heal instead of orphaning captured nulls.
- **FlyScene.jsx:** registration flips `store.runtimeReady`; `warpTo` drops the
  hard `fix1` gate (speed falls back to `FLIGHT.speeds.cruise`); keep the
  sceneRemounts tripwire.
- **InspectModal.jsx:** WARP enabled when `runtimeReady && track` (not `live`);
  CHASE disabled-with-reason on `stale === 2`; loud card-level failure flash +
  ONE auto-retry ~400 ms; keep testids `inspect-card/-warp/-chase/-hex/
  -action-notice`.
- **Redesign** (InspectModal + inspect-tokens + card-bits + ModelTurntable):
  right-docked panel (`absolute right-4 inset-y-16`, ~420 px wide, column
  layout, NO center scrim) replacing the centered 640 px card; planespotters
  photo as the HERO — already integrated (`useAircraftPhoto(hex)` →
  `photo?.thumbnail_large?.src` :178-179, currently tab-buried :181); KEEP the
  photographer attribution + link (planespotters requirement). Extra vertical
  room = route progress, sparkline, squawk, spot history uncrammed.
- **scripts/verify-inspect-actions.js:** new layout crops/position gates; a
  remount-resilience gate (force remount, Warp still works); a no-fix1 gate
  (WARP enabled, dead-reckoned warp).

## C. Information Entropy waypoint (user request 2026-07-17; land AFTER the
## fix-round sweep — verify-monuments asserts exact monument mesh counts)
- Add landmark POI: `['Information Entropy', 42.28994, -83.73803, 'church', 32]`
  (1115 Broadway St, Ann Arbor MI — geocoded via Nominatim). Landmark class ⇒
  atlas-searchable warp destination + letter + minimap + monument = "waypoint".
- NEW 'church' archetype in landmarks-3d.js (9th): nave + gable roof + front
  bell tower + emissive spire tip; proportions modeled on the nearest real
  church, Saint Thomas the Apostle Catholic Church (42.28507, -83.74140, ~600 m
  away) — per user: "find a church as the point of interest marker".
  Register in LandmarkMonuments pool (+1 draw, 9→10 archetype meshes),
  monumentScale aspect, palette entry.
- Update verify-monuments structural gates 9→10 meshes (and any "+9 draws"
  comments/accounting: monuments now +10 +halo).
- Alternative reading (cheap flip if user meant it): place the monument at the
  CHURCH's coords instead of the store's.

## Build notes
- All parity fixes live-tunable where possible (user A/Bs them in one reload).
- H1–H3 are independent knobs — land separately so the user can attribute the
  feel change.
- Fable agents (user directive 2026-07-17: all agents on Fable).

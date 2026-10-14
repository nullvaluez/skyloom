# Gate to Gate — record

The plan is [FLY_GATE_TO_GATE_PLAN.md](FLY_GATE_TO_GATE_PLAN.md) (owner
decisions, architecture, waves, rules). This file is the record and the
contract reference every stream builds against: what each wave landed, the
contracts with their homes, the flag registry, who owns which file in each
wave, and the seams. **Where this file and a design JSON disagree, this file
wins; where this file and the plan disagree, the plan wins.**

Status: **W0 landed on `main` (2026-10-13). Nothing visible changed.**
Checkpoint 0 (the owner confirms the flag registry) is open. **W4-0 (the
lounge contracts) landed on `main` the same day, also invisible**, ahead of W1
by the owner's order, and **W4 N (the walk) landed behind `LOUNGE_WALK`**,
which the owner signed off and is **on since 2026-10-14**.

## The seam rule

The hot files were edited in W0 only; later streams use the seams below and
never edit these files. W4-0 does the same for the lounge's hot files.

| Hot file | W0 seam | Later streams use |
|---|---|---|
| `components/fly/FlyScene.jsx` | `connectGateToGate` effect (:2006); `runtime.airports.update` at useFrame −40 (:2008); `runtime.snapCamera` (:2013); dev `installReviewPoses` (:2021); `simHold.any()` in `paused` (:2091); G / R / V read only behind OPS_FEEL / CAMERA_DIRECTOR as `cmd.gearToggle` / `cmd.reverseToggle` / `cmd.cameraCycle` (:2115); `runtime.presentation.update` after the motion step (:2381); `cameraOwner()` camera chain with a `'director'` branch (:2518) and `transitionMode()` (:2548); `<AirportAreas>` beside `<ObservationWorld>` (:3656) | the service, presentation, director, camera-mode and review-poses modules |
| `components/fly/PlayerPlane.jsx` | `flight.playerRig` (:98); `poseAircraftRig(renderView(flight), flight.presentation)` (:112); `playerVisible({titleHidden, observing, parked})` with `parked` from `airportWatch.playerParked` (:116) | `aircraft-pose.js`, `render-view.js`, `player-visibility.js`, `ops-presentation.js` |
| `components/fly/TrafficLayer.jsx` | `runtime.playerFeed?.(lights, smoke, origin, now, exposure)` before `lights.end` (:442) | W2 E installs `runtime.playerFeed` |
| `lib/fly/operations-runtime.js` | `stageMinKm()` (:30); `warpKindFor` / `sync(kind, {seamless, from})` / `runtime.relocate` (:48-64); `beginDeparture(id, airport, start, opts)` with `'gate'` → `runtime.beginGate` and a runway fallback, `airportReturn` reset, departure prefetch (:71); `operations.guided` and arrival prefetch in `approachAirport` (:265); `connectLoungeBridge` slot (:273) | `ops-journey.js` (W3 J) installs `runtime.beginGate`; `lounge-bridge.js` (W4) |
| `lib/fly/fly-constants.js` | the fifteen flag blocks after `EARTH_HORIZON` (:7427-7641) | each stream changes only values inside its own block |
| `lib/fly/device-report.js` | the fifteen names in `FLAGS` | — |
| `components/fly/hud/OperationsHUD.jsx` | the v1 history writer moved out (W0.4); `airportChoices` | W1 D owns it from W1 |

## Contracts (W0)

Every shape below exists on `main` now, inert while its flag is off.

| Contract | Home | Notes |
|---|---|---|
| Flag readers | `lib/fly/ops-flags.js` | the one accessor: a literal `pinned(BLOCK, '__fly<Name>Override')` per block, plus `opsFlag`, `opsSub`, `opsAirfieldOn(mapStyle)`, `opsTier()` (`off`/`registry`/`lite`/`full`), `gateToGateOn()`, `loungeVariant()` |
| AirportService `runtime.airports` | `lib/fly/airport-service/index.js` | inert: registry `surfaceAt`, prefetch `{phase:'none'}`, no areas, no gates, `towerPoint`/`diagram` null |
| Service shapes | `lib/fly/airport-service/contracts.js` | `OpsSurface`, `OpsGround`, `PrefetchState`, `TaxiRoute`, `GateStage` (`bindPlayerStand`), `HoldState`, `AreaView` (key = ident\|x\|z\|runwayId\|variant), the service API; `RUNWAY_DRAWN_LIFT` = 0.09 m |
| Service tunables | `lib/fly/airport-service/config.js` | area plan (2 Hz, ≤3 desktop / 1 phone, unmount after 2 plans), mount km, rebuild ms, budgets |
| Ops core split | `lib/fly/flight-operations.js` + `lib/fly/ops/{util,contact,ground-step,air-step,touchdown,completion,guidance,telemetry}.js` | public fields and methods unchanged; `snapshot()` / `restore()` (deep; registry airport shared; the event sequence never rewinds); `runwayForWind`; `GROUND_PHASES`; `fail(reason, kind)`; `cancelGuidance()`; `tapEvents(fn)` |
| Contact seam | `lib/fly/ops/contact.js` | `surfaceAt(ops,x,z)` (the composite when `operations.ground` is set), `paved(s)` (grass is not pavement), `placementHeight(ops,x,z,authoredY)`; every placement (begin, lineUp, retry, approach capture, funnel, envelope AGL) and both off-pavement tests use it |
| Event payloads | `ops/touchdown.js`, `ops/ground-step.js`, `flight-operations.js` | touchdown: runway, speed, vref, crossM, alongM, aimM, bank, pitch, headingErr, gearDown, mains[2], bounced (+ sink, quality, airport); takeoff/touch-and-go: runway, rollM, speed; crashed: reason, kind, context; bounce: sink; departure/lineup/retry/approach/go-around: airport, runway. **No new event types in W0** (ids unchanged) |
| Telemetry `ops.telemetry` | `lib/fly/ops/telemetry.js` | n1, thrustFrac, brake, surface, onGround, timeScale, clock, flare trace (20 Hz × 8 s), rollout {maxCrossM, remainingM}, route ring (10 s × 90), rollStart; failure / prevPose / renderAlpha reserved for OPS_FEEL |
| Event cursor | `lib/fly/ops-events.js` | taps the emitter; each event once, across the 32 window and `begin()` |
| Presentation + fan-out | `lib/fly/ops-presentation.js` | `flight.presentation` (defaults; `lights` always computed); the one fan-out → subscribers and `runtime.playerFx.event` |
| Light state | `lib/fly/player-external-lights.js` | phase-derived nav/beacon/strobe/landing/taxi/turnoff/logo |
| Pose helper | `lib/fly/aircraft-pose.js` | `poseAircraftRig`, `composeAircraftMatrix({groundHull, hullY, anchor})`, `idleBobAmplitude`, `groundHullOffset`; Object.is-identical to the pre-W0 PlayerPlane math |
| Render view | `lib/fly/render-view.js` | `renderView(flight)` = flight unless `flight.renderOwner === 'ops'` |
| Visibility | `lib/fly/player-visibility.js` | hidden on the title and while observing, unless parked at its stand under LOUNGE_BRIDGE |
| Camera | `lib/fly/camera-mode.js`, `camera-director.js`, `camera-shots.js` | precedence lounge > photo > photo-exit > title > director > cinema > chase; director stub (`wants()` false); `previewPose` = the chase rest pose until W2 F |
| Camera blend | `lib/fly/camera-transition.js` | `start(fromPose, sec, ease)` |
| Sim hold | `lib/fly/sim-hold.js` | reasons `review`, `intro`, `lounge`, `replay` |
| Deck + callouts | `lib/fly/flight-deck-model.mjs`, `lib/fly/ops-callouts.mjs` | `DECK_STEPS`, `deckStep`, `deckModel` (owns nothing yet); `CALLOUTS`, `CALLOUT_LABEL`, inert detector |
| Ops tunables | `lib/fly/ops-config.js` | feel, fx, audio, director, grade weights and letters, journey |
| Runtime services | `lib/fly/gate-to-gate-runtime.js` | `connectGateToGate` owns airports / director / presentation lifetimes |
| Lounge bridge slot | `lib/fly/lounge-bridge.js` | `connectLoungeBridge` (registers nothing until W4) |
| Area components | `components/fly/airport/AirportAreas.jsx`, `AreaRouteLights.jsx` | stubs |
| Review poses (dev) | `lib/fly/airport-service/review-poses.js` | `runtime.reviewOps.{poses, gatePoses, pose, hold, camera, state, ensureAirport, eligible, readiness}`; pure `reviewRunwayPose()`; lineup, roll40, rotate, final3nm, final1nm, flare, rollout (gate poses refused until W3); `camera('side')` is a photo-orbit placeholder until W2 F |
| Multi-area suppression | `lib/fly/airfield/airfield-suppression.js` | `setAirfieldSuppressionArea(key, {ident, x, z, radius, runwayIds, covers:'all'\|'runways'})`, `airfieldSuppressions()` (frozen, stable until change), `subscribeAirfieldSuppression(fn(list))`, `insideAirfieldSuppression`, `airfieldSuppressionOf`, `airfieldSuppressesAirport`; compat `setAirfieldSuppression` = key `'lounge'`. Consumers: AOL, SatRoadEngine (class 7 zeroed in any disc), LivingAirports (`living-airfield-v3`, cuts and hides tiles only for `'all'` discs) |
| Runway catalog | `lib/fly/runway-catalog.js` | `protectRunwayIdent(role, ident\|null)`, `protectedRunwayIdents()`; `RUNWAY_ACTIVE_LIMIT` 48; eviction always terminates and never evicts a protected ident or the row being activated |
| Session site | `lib/fly/lounge-site.js` | `resolveSessionSite(airport, {variant, ...})` (never rejects), `sessionSiteSync`, `chooseSessionSeat`, `sessionSeat`, `clearSessionSites`; cached per ident\|variant for the page session; `variant` defaults to `loungeVariant()` |
| Labels and units | `lib/fly/ops-labels.mjs` | `airportLabel`, `runwayLabel`, `airportIdent`, `shortAirportName`, `airportChoices(aircraftId, {include, exclude, ineligible, near, maxKm, limit})` (one row per ident), `catalogEligible`, `fmtKt/fmtFt/fmtFpm/fmtNm`; `RUNWAY_MINIMA` from operations-airports.js |
| Flight history | `lib/fly/flight-history.mjs` | v2 key `fly-flight-history-v2` (cap 200), `readHistory` (v1 merged read-only), `bests`, `appendHistoryV2`, `appendHistoryV1` (the moved v1 writer; the fan-out calls it on `'completed'`) |
| Flight plan | `lib/fly/flight-plan.js` | `'gate'` in `START_MODES` ('Gate'); `airportDestination().tz` from the nearest city (else `round(lon/15)`); catalog `describeSetup` names the airport |
| Airport browser parts | `components/fly/hud/airports/browser-parts.jsx` | `sunNow`, `goldenAirports`, `SunChip`, `FeaturedAirportCard`, `GoldenHourRow`, `AirportResultRow`; `AircraftGlyph` exported from GroundHangar.jsx |
| Geometry exports | `lib/fly/airfield/airfield-geometry.js`, `lib/fly/airport-set/decals.js` | `coverageIndex(model)`, `standLeadIn(stand, lanes, side)` |
| Hangar pick (harnesses) | `scripts/_hangar-pick.js` | `pickDeparture`, `departureId`, `pickStart`, `waitForDeparture`, `hasDeparturePicker`, `departureUi`; works with today's select and the W3 chooser testids |

## Flag registry

All fifteen shipped `enabled:false`, after `EARTH_HORIZON` at the end of
`lib/fly/fly-constants.js`; **`LOUNGE_WALK` is on since 2026-10-14** (the
owner signed the walk off), the other fourteen are still off. Turn one on for
a page load with `?flags=NAME` (off with `-NAME`). Nothing but flag blocks may follow the TRUE EARTH marker
(`scripts/verify-true-earth-flags.mjs` (5)–(7)). Each block is listed in
`device-report.js` FLAGS.

| Flag | Gates | Phone |
|---|---|---|
| `OPS_AIRFIELD` | service and areas, OSM ground, airfield lights incl. PAPI/ALS, wheel contact on the drawn surface, multi-disc suppression, AOL fallback, prefetch, `airfield` readiness, lounge-as-area | registry tier |
| `OPS_APRON` | pier set and parked fleet in flight areas, bridge rig, tug, VDGS, staged GSE | off |
| `GATE_TO_GATE` | gate start, pushback, engine start/shutdown, router + greens + bars, 45 s hold (`maxHoldSec`), auto-taxi ≤4×, arrival stand, docking, "Taxi out from here" | off |
| `PLAYER_GLOW_LIGHTS` | player lights in AircraftLights, the analytic light pool | lights on, pool off |
| `OPS_FEEL` | spool, two-stage rotation, ground effect, auto gear + G, gear-up rejection, spoilers / reverse (R) / autobrake, settling failure, handoff smoothing, interpolation, ground input | on |
| `OPS_FX` | visual AoA, oleo, wheel spin, nose steer, spoiler panels, prop RPM, burner/heat on the ground, shake, rumble, speed rush, smoke/dust/spray, haptics | on (shake ×0.7) |
| `OPS_AUDIO` | N1 engine voices, start/shutdown, rumble, thumps, chirp, gear, brakes, reverse, callout tones, duck, apron ambience | on (2 voices) |
| `CAMERA_DIRECTOR` | shots, V cycle, beats, `'airport'` cuts, intros, `previewPose` | on (camera button) |
| `FLIGHT_DECK` | new deck, captions, approach HUD, nav chip, beacon, minimap pin, Land-here, guidance mapping, declutter, missed-approach prompt | PhoneFlightDeck |
| `OPS_HANGAR` | title hero, airport chooser, briefing + diagram, real-sun hangar, exterior stand fix, staging behind the hangar, confirm-before-discard | sheet chooser |
| `OPS_DEBRIEF` | grade, stamp, auto photo, debrief, history v2, Flights tab, title "your best" | bottom sheet |
| `REPLAY` | render-only replay (W5) | 1 MB cap |
| `LOUNGE_PIER` | pier room, pier set both sides, back-aware seats, seated city cap | inert |
| `LOUNGE_WALK` (**ON**, 2026-10-14) | walk, postures, vantage seats, Sit prompt, seat menu, glides, footsteps | inert |
| `LOUNGE_BRIDGE` | Fly from here, Watch from the lounge, origin-aware Leave/Esc, Atlas bookmark, `'lounge'` transition, promotion (decision 12) | inert |

Sub-switches: `ops-flags.js` `opsSub(NAME, key)`; e.g. `OPS_FX.smoke`,
`GATE_TO_GATE.greens`, `FLIGHT_DECK.guidance` (`'minimal'`).

## Ownership per wave

Streams merge `--no-ff` to `main` in the stated order, with the full node
battery after each merge.

**W1** (merge B → A → C → D)
- **A AIRFIELD IN FLIGHT:** `lib/fly/airfield/{airfield-ground,airfield-geometry,airfield-height,airfield-lights,airfield-glyphs,airfield-materials,airfield-data}.js`; `lib/fly/airport-service/{index,config}.js`, NEW `plan-areas.js`, `sites.js`, `area.js`; `components/fly/airport/AirportAreas.jsx`; `components/fly/observation/AirfieldGround.jsx`; `components/fly/ObservationWorld.jsx`; `components/fly/AirportOperationsLayer.jsx`; `lib/fly/runway-catalog.js` (ensureAirportRunways); `lib/fly/world-readiness.js`; `lib/fly/terrain-engine.js` (dev warning only); `scripts/verify-airfield-ground.mjs`, `verify-airport-service.mjs`, `review-operations-airfield.cjs`.
- **B GROUND TRUTH, GRAPH, ROUTER, CLEARANCE:** `lib/fly/ops/contact.js`; NEW `lib/fly/airfield/{airfield-paved,airfield-taxi-graph}.js`, `lib/fly/airport-service/{ops-ground,clearance}.js`, `scripts/build-ops-airfields.mjs`, `scripts/fixtures/ops-airfields/*`, `scripts/verify-ops-ground.mjs`, `scripts/verify-taxi-router.mjs`.
- **C FEEL:** `lib/fly/flight-operations.js`; `lib/fly/ops/{ground-step,air-step,touchdown,completion,guidance,telemetry}.js`; `lib/fly/operations-profiles.js`; `lib/fly/input-controller.js`; `lib/fly/render-view.js`; `components/fly/Contrail.jsx`; `components/fly/PlayerGroundShadow.jsx`; `scripts/verify-flight-operations.mjs`, `verify-aircraft-effects.mjs`, `verify-ops-golden.mjs` (re-record only for an intended OPS_FEEL-on arm, never the off arm).
- **D FLIGHT DECK:** `lib/fly/{flight-deck-model,ops-callouts,ops-labels}.mjs`; NEW `components/fly/hud/flight-deck/*`; `components/fly/hud/{OperationsHUD,MobileFlightDeck,FlyHUD,Minimap,NearbyAirports}.jsx`; `components/fly/hud/mobile-flight.css`; `components/fly/OperationsGuidance.jsx`; NEW `scripts/verify-flight-deck-model.mjs`, `verify-ops-callouts.mjs`; `scripts/verify-mobile-flight-deck.cjs`, `verify-operations-touch.cjs`, `verify-operations-design.cjs` (overlap probe only).

**W2** (merge E → G → F → H)
- **E AIRCRAFT & DRAMA:** `lib/fly/{ops-presentation,aircraft-pose,player-external-lights}.js`; `components/fly/{PlayerPlane,LandingGear}.jsx` inside the W0 seams; `lib/fly/{fleet-gear.mjs,fleet-animation.js,exhaust-heat.js,fleet-smoke.js,juice.js,chase-camera.js}`; `lib/fly/player-aircraft.js` (spoiler/flap anchors); `lib/fly/airfield/airfield-materials.js` (spot pool, from A); `components/fly/{Effects,CrashFlash}.jsx`; `scripts/verify-ops-presentation.mjs`.
- **F CAMERA DIRECTOR:** `lib/fly/{camera-director,camera-shots,camera-mode,camera-transition}.js`; `components/fly/hud/WarpFlash.jsx` ('airport' card polish); NEW `components/fly/hud/flight-deck/{IntroLowerThird,OpsCut}.jsx`; `components/fly/PauseMenu.jsx` ('Cinematic moments'); NEW `scripts/verify-camera-director.mjs`.
- **G AUDIO:** NEW `lib/fly/ops-audio.js`; `lib/fly/{audio-engine,immersive-audio}.js`; `hooks/use-fly-audio.js`; `lib/fly/airport-audio.js` (apron mode only); `lib/fly/observation-config.js` (SOUNDSCAPE.apron only); NEW `scripts/verify-ops-audio.mjs`, `review-ops-audio.cjs`; `scripts/verify-airport-audio.mjs`.
- **H DEBRIEF & LOGBOOK:** NEW `lib/fly/landing-grade.mjs`; `lib/fly/flight-history.mjs`; `components/fly/PhotoCapture.jsx`; `lib/fly/encounter-photo.js`; NEW `components/fly/hud/debrief/*`, `components/fly/hud/logbook/FlightsTab.jsx`; `components/fly/hud/Logbook.jsx`; `components/fly/hud/flight-deck/FlightDeck.jsx` (stamp only); `stores/fly-store.js` (debriefOpen); `hooks/use-overlay-back.js`; `components/fly/FlyMode.jsx` (Esc chain); NEW `scripts/verify-landing-grade.mjs`, `verify-ops-circuit.cjs`; `scripts/verify-flight-history.mjs`.

**W3** (merge I → J → K → L)
- **I LIVING APRON:** `lib/fly/airport-set/{plan,terminal,decals,bridges,index,lights}.js`, NEW `bridge-rig.js`; NEW `lib/fly/airport-service/gate.js`; `lib/fly/fleet-parked.js`; `components/fly/observation/{AirportStructures,ParkedFleet}.jsx`; `lib/fly/player-aircraft.js` (stand hints, door); NEW `scripts/verify-living-gate.mjs`; `scripts/verify-airport-set.mjs`, `verify-fleet-airframes.mjs`.
- **J GATE JOURNEY:** `lib/fly/flight-operations.js` (atGate/pushback phases); NEW `lib/fly/ops/{gate-sequence,taxi-follow}.js`; `lib/fly/ops/{completion,ground-step}.js`; NEW `lib/fly/ops-journey.js` (`runtime.beginGate`, `departFromHere`); `lib/fly/operations-runtime.js` only if the delegation needs a fix; NEW `scripts/verify-ops-journey.mjs`; `scripts/verify-flight-operations.mjs` (gate tests).
- **K ROUTE LIGHTS & SERVICE:** NEW `lib/fly/airfield/airfield-route-lights.js`; `components/fly/airport/AreaRouteLights.jsx`; `lib/fly/airport-service/index.js` (gate/route/clearance/tower/diagram/stands); `lib/fly/airport-service/review-poses.js`; `scripts/review-operations-airfield.cjs`; NEW `scripts/verify-operations-airfield.cjs`; `scripts/verify-airport-service.mjs` (budget gate).
- **L HANGAR & BRIEFING:** `components/fly/hud/{TitleScreen,HangarScene,HangarExterior,GroundHangar,AirportPicker}.jsx`, `title.css`, `operations.css`; NEW `components/fly/hud/hangar/*`, `lib/fly/hangar-lighting.mjs`, `components/fly/hud/flight-deck/ConfirmEndFlight.jsx`; `components/fly/hud/AirportExperience.jsx` (search-row launch buttons only); `components/fly/{PauseMenu,FlyMode}.jsx` (exit confirms); `scripts/_hangar-pick.js` (new-UI branch).

**W3i** (one agent): NEW `scripts/verify-gate-to-gate.cjs`, `review-ops-experience.cjs`; this file's record; `CLAUDE.md`; `CREDITS.md`.

**W4-0** (one agent): `lib/fly/observation-config.js` (lounge sections), `lib/fly/lounge/room-plan.js`, `lib/fly/lounge-site.js` (aperture, variant), `lib/fly/airport-watch-runtime.js` (eye, posture, seats, hooks, enter opts, exit, handoff), `lib/fly/airport-watch-camera.mjs`, `lib/fly/airport-audio.js` (listener), `lib/fly/lounge/room-build.js` (blockers), `lib/fly/airport-layout.js` (additive), `scripts/_tri-bvh.mjs` + `build-lounge-ao.mjs`, `lib/fly/lounge-bridge.js`, `components/fly/hud/lounge/{LoungeHud,LoungeHeader,LoungeBridgeBar}.jsx`, `components/fly/FlyMode.jsx` (Esc → `watch.exit()`), NEW `scripts/verify-lounge-walk.mjs`, `FLY_OBSERVATION_LOUNGE.md`.

**W4** (merge M → O → N → P)
- **M ROOM-PIER:** `lib/fly/lounge/{room-build,room-shading,lounge-glass,room-ao}.js`, `lib/fly/airport-lounge.js`, `components/fly/AirportLounge.jsx`, `scripts/build-lounge-ao.mjs`, NEW `public/models/lounge-ao-pier-v1.bin`, `scripts/verify-airport-lounge.mjs`, `lib/fly/assets.js`, `CREDITS.md`.
- **O PIER SET & SEATS:** `lib/fly/airport-layout.js`, `lib/fly/airport-set/*`, `lib/fly/fleet-parked.js`, `lib/fly/airport-service/gate.js` (side-aware), `lib/fly/airfield/airfield-ground.js` (`_addSetApron` only), `components/fly/SatBuildingLayer.jsx` (seated city cap), `lib/fly/{lounge-seat,lounge-site}.js` (pier sources), `scripts/build-lounge-seats.mjs`, NEW `lib/fly/lounge-seats-pier.js`, the set/seat/fleet/living-gate gates, `scripts/review-lounge-sightlines.cjs`.
- **N WALK & SIT:** NEW `lib/fly/lounge/room-walk.mjs`, `lib/fly/lounge-walk-runtime.js`, `components/fly/hud/lounge/{SeatMenu,SitPrompt,SeatsButton}.jsx`; `components/fly/hud/lounge/LoungeSurface.jsx`; `components/fly/hud/airport-watch.css`; `lib/fly/airport-audio.js` (footsteps); the walk/vantage gates; `scripts/review-observation-lounge.cjs`.
- **P BRIDGE:** `lib/fly/lounge-bridge.js`; `components/fly/hud/lounge/{LoungeBridgeBar,LoungeFlySheet,LoungeOverlay}.jsx`; `components/fly/hud/AirportExperience.jsx` (`choose()` confirm, 'airport' entry card); `lib/fly/player-visibility.js`; `lib/fly/camera-mode.js` ('lounge' mode); NEW `scripts/verify-lounge-bridge.{mjs,cjs}`.

**W4i** (one agent): flagship pier entries and tuned budgets in `observation-config.js`, `lounge-seats-pier.js`, `FLY_OBSERVATION_LOUNGE.md`, `CLAUDE.md`, delete `scripts/review-airport-lounge.cjs`.

**W5:** R1 NEW `lib/fly/replay/{recorder,playback}.js`, `sim-hold.js` (replay reason), `TrafficLayer.jsx` (one-line indirection), `aircraft-pose.js` (replay source), NEW `scripts/verify-replay.mjs`; R2 `camera-director.js` (replay), NEW `ReplayBar.jsx`, `ops-audio.js` (replay voices), `FlightDebrief.jsx` ('Watch replay').

## Record

### W0 — contracts, seams, shared fixes (2026-10-13)

Executed on `main` by the orchestrating session, with two helpers in
worktrees merged `--no-ff`:
- helper A (`g2g/w0-a`): shared fixes and pure modules;
- helper B (`g2g/w0-b`): harnesses and the BEFORE baseline.

Nothing a player sees changed. Every new path is inert with the flags off.

**Commits** (in order):

| Commit | Step |
|---|---|
| `8df9ca1` | W0.1 the fifteen flag blocks, `ops-flags.js`, the device report; `verify-true-earth-flags` (7) only flag blocks follow the marker |
| `4f7fac3` | `sim-hold.js` and the dev review-pose install seam |
| `e51c99f` | W0.2 `verify-ops-golden` recorded on the untouched ops core |
| `48fc621` | W0.2 the readable split into `lib/fly/ops/*`, `snapshot()` / `restore()`, `runwayForWind` |
| `fb98c2b` | W0.3 the contact seam |
| `6bf920e` | W0.4 event payloads, `ops.telemetry`, the event cursor; the lounge join rollback uses `snapshot()` / `restore()` |
| `e301876` | W0.5 contracts, the inert service, the pose helper (PlayerPlane switched), presentation, camera mode, director/shot stubs, deck/callout enums |
| `fe2c5bc` | W0.6 the hot-file seams |
| `dfd9a20` | W0.7 Atlas guidance (`guided`), exit-to-title clears `airportReturn` |
| `20166b6` | merge helper A: `70a54dc` catalog eviction, `9625cf3` multi-area suppression, `cf4a7cf` session site, `848ae0b` labels, `8ee7751` flight-plan gate/tz, `8349854` history v2, `8cab810` browser parts, `442b3a6` Atlas ground-warp copy, `bca8bc5` geometry exports |
| `a8292c0` | W0.4 the v1 logbook writer moves into the event fan-out; AOL's shadowed glyph rows removed |
| `e294ccc` | `verify-airport-service` contact / snapshot / pose / inert sections; `verify-r25-flight-plan` 7i gate-launch fallback |
| `df2c37f` | merge helper B: `d4f3148` `_hangar-pick` and `_title` fix, `04c8cb4` harness migrations, `1d3ab8e` review poses, `6ef4ef5` `review-operations-airfield.cjs`, `d904417` browser pre-baseline ledger |
| `9440498` | `runtime.snapCamera`, the review tier pin, the last stale `title-free-flight` ids |
| `f9b3e29` | merge helper B: `2216c08` review harness `--flags` and recorded URL flags, `2b20b48` the integrated-tree browser regression |

**Node gates** (untouched main → W0):

| Gate | Before | After | Note |
|---|---|---|---|
| verify-true-earth-flags | 7 | 8 | +(7) only flag blocks follow the marker; 27 blocks |
| verify-ops-golden | — | 28/28 | NEW. 7 scenarios × 30/60/120/144 Hz (the plan's six plus a LOWI catalog circuit) |
| verify-flight-operations | 33 | 33 | identical output |
| verify-ops-presentation | — | 13 | NEW: data, pose (Object.is over 200 poses), presentation, the moved v1 writer |
| verify-airport-service | — | 17 | NEW: suppression, catalog eviction, session site, contact seam, snapshot round trip, pose equivalence, inert service |
| verify-ops-labels | — | 9 | NEW |
| verify-flight-history | — | 8 | NEW |
| verify-explorer | 17 | 18 | +Atlas guidance from 20 km / 1,200 m (fails on the old code by construction) |
| verify-airport-lifecycle | 23 | 24 | +exit to title clears the lounge return (fails without the fix); the ops test double gained `snapshot`/`restore` |
| verify-runway-catalog | 9 | 10 | +eviction terminates with protected idents |
| verify-r25-flight-plan | 41/44 | 45/48 | +4f gate start, tz, catalog labels; +7i gate-launch fallback. The same three pre-existing frozen-identity reds (7h, 8a, 8b) |
| verify-r25-front-door | 70 | 70 | (8a) re-baselined: the title-camera check follows the camera precedence into `camera-mode.js` |
| verify-frame-step | 10/11 | 10/11 | pre-existing red, unchanged |
| observation 45, audio 11, lounge, lounge-seat, airport-set 17, fleet-airframes 13, airfield-ground 13, import-integrity 4, true-scale 14, aircraft-effects 14, operations-disclosure | — | unchanged | |

`node node_modules/next/dist/bin/next build` passes on the integrated tree.

**Browser gates** on the integrated tree (`9440498`, flags off; the ledger is
`scripts/g2g-w0-browser.md`). **No verdict got worse and no red is caused by W0.**
- **Pass:** `verify-operations-browser`, `-keyboard`, `-fleet`, `-taxi-edge`, `verify-loading-scenery`, `verify-airport-interaction` 25/25, `verify-airport-browser-states` 24/24, `verify-chase-cam`.
- **Same pre-existing reds, at the same step as their pre-W0 (4f7fac3) scripts:**
  - `-design`, `-touch`, `-experience`;
  - `verify-sat-night` 27/2;
  - `verify-feel` 12/13.
- **`verify-mobile-flight-deck`:** now reaches 21 checks (it stopped at 0 on the stale title id) and stops at the pre-existing tips-card tap.
- **Duplicate keys:** React duplicate-key errors at catalog airports dropped from ~1,100–1,600 per run to **0** (`airportChoices`).
- **Flags-on boot smoke**, all 15 flags via `?flags=` at KCMH and LOWI (lineup and final1nm), run twice:
  - 0 page errors, 0 console errors;
  - `window.__flyUrlFlags` lists all 15;
  - draws/tris within the measured same-configuration noise of BEFORE (±15–30 draws, ±15% tris);
  - textures 331–357 and programs 153–156 in every arm.

  W0 is inert with every flag on.

**The BEFORE baseline:** `.graphics-review/operations-airfield/baseline/` (local, gitignored, 699 MB).
- Scope:
  - KCMH 10R, KJFK 13R-31L, LOWI 08-26 (bizjet; an airliner is not eligible at 1,996 m), YSSY 16R-34L and EGLL 09L-27R;
  - day, golden and night on 2026-10-13;
  - 7 runway poses × chase and side;
  - 420 PNGs including GL-only twins.
- Results: 0 page errors. Per-pose census and labels are in `baseline-summary.json`; the command is in `index.json`.
- **The BEFORE already exceeds the High budget at the hubs:**
  - YSSY 370–405 draws on every pose;
  - EGLL 367–391 draws;
  - KJFK final3nm 2.30 M triangles at golden (2.15 M at night).

  W1's census must be read against these numbers, and the YSSY city cap question (checkpoint 4) is already visible here.
- 12 captures hit the 30 s settle cap before every readiness part arrived (the `airports` part at 8 lineups; `buildings` at the three LOWI final3nm); they are listed in the summary.

**Deviations from the plan, and why:**
- **The golden has seven scenarios, not six.** The added LOWI catalog circuit covers the `authored === false` completion path that W1 changes.
- **The plan wants `verify-flight-operations` identical**, so the four W0.4 data tests live in `verify-ops-presentation`.
- **`restore()` never rewinds the event sequence.** A rolled-back event was already delivered to the cursor, so its id must stay unique.
- **No new event types in W0** (ids stay identical for the golden). Rollout data is in `ops.telemetry.rollout`. `gear`, `engine` and `stopbar` events arrive with the streams that own them.
- **surfaceRise** still applies to any contact kind (W0 changes no motion). Restricting it to runways is W1 B's contact change.
- **The service, director and presentation live in one `connectGateToGate()` effect** (`lib/fly/gate-to-gate-runtime.js`) rather than in FlyScene memos. FlyScene stays a call site.
- **LivingAirports** cuts and hides tiles only for `'all'` discs. A `'runways'` disc keeps the pavement sheet, which carries the taxiways a runway-only area does not draw.
- **The session seat cache now lives for the page session** (shared with the service), not per runtime connection.

**Pre-existing reds named, not fixed** (FLY_GATE_TO_GATE_PLAN.md "Environment truth"):
- `verify-r25-flight-plan` 7h/8a/8b and `verify-frame-step` 1;
- browser: `verify-operations-design`/`-touch`, which want the phone deck's old role names;
- `verify-operations-experience` "Rollout braking failed";
- `verify-mobile-flight-deck`, where the tips card blocks a tap after the stale id fix;
- `verify-sat-night` (SatCityGlow unmounted under cinematic lighting);
- `verify-feel` "punch decayed" 74° vs 78°;
- `verify-chase-cam`, which depends on live traffic.

**Noted for later waves:**
- bright white hemisphere blobs over the treeline right of the KCMH night final1nm (pre-existing; W1 A should look while the airfield lights land);
- a one-off "Invalid or unexpected token" on the very first cold dev compile.

### Owner decisions after W0 (2026-10-13)

- **Lounge now:** `LIVING_AIRPORTS.enabled` flipped to `true` (`1846ba4`). "Watch an airport" shows on the title card and the Atlas pill for desktop players with no URL parameters. This is ahead of the W4 promotion in decision 12; phones stay excluded. `scripts/verify-lounge-promotion.cjs` guards it.
- **Lounge walk first:** W4-0 (lounge contracts) and W4 N (WALK & SIT, classic room) move ahead of W1. The handoff is [FLY_LOUNGE_WALK_HANDOFF.md](FLY_LOUNGE_WALK_HANDOFF.md). W1–W3, the pier (M, O) and the bridge (P) follow; the owner picks the next one at the walk checkpoint.

### Checkpoint 0 (owner)

There is nothing visual to judge. The owner confirms:
1. The fifteen-flag registry above, including the sub-switches (e.g. `GATE_TO_GATE.maxHoldSec: 45`, `FLIGHT_DECK.guidance: 'minimal'`).
2. The defaults already set in the plan: auto-taxi, auto-gear and autobrake do not count as "Assisted"; line-ups, practice finals and warps do.
3. That W1 may start: B → A → C → D, with checkpoint 1 on the RTX 5080 and iPhone for `OPS_AIRFIELD`, `OPS_FEEL` and `FLIGHT_DECK`.

### W4-0 — lounge contracts (2026-10-13)

Executed by the orchestrating session on `g2g/lounge-walk`, then merged
`--no-ff`. Nothing a player sees changed, and every lounge gate passes
unchanged with `LOUNGE_WALK`, `LOUNGE_PIER` and `LOUNGE_BRIDGE` off. The
contract table and the full record are in
[FLY_OBSERVATION_LOUNGE.md](FLY_OBSERVATION_LOUNGE.md) ("Lounge, further").

| Commit | Step |
|---|---|
| `5e3f84e` | task 0: `verify-lounge-promotion.cjs` passed 7/7 as written; it now also checks the Atlas pill (desktop) and its absence (phones): 9/9 |
| `b10d6ea` | the contracts: vantage seats and walk numbers, room variants and `FLOOR_PLATE`, the aperture from any eye, the observer's eye and posture, the look limits and hooks, enter options, `exit()` / `handoff()`, walk blockers, the pier-ready layout fields, the eye as the audio listener, the shared BVH, the HUD and walk slots |
| `5b0ccbe` | review fixes: the seam gaps (enter options honoured, `exit()` hands non-title origins to the bridge's `exitLounge`, the Leave label, binoculars halt a walk, the corner-seat zoom anchor, the probe eye), three blockers, and `verify-lounge-walk.mjs` 19 → 28 with a mutation run |

**Gates (flags off):**
- node: observation 45, lifecycle 24, lounge 13, lounge seat 6, airport set 17, fleet airframes 13, airfield ground 13, true-earth flags 8, ops golden 28/28, airport service 17, import integrity 4, front door 70, all unchanged; audio 11 → 12; NEW lounge walk 28;
- browser: promotion 9/9, interaction 25/25, browser states 24/24.

**Deviations from the ownership list:**
- `components/fly/AirportLounge.jsx` (M's file) got the one probe-eye branch, because a walking eye must not drag the glass's box projection with it. The branch is never taken with the flag off.
- `components/fly/hud/lounge/{BinocularHud,SpotterCard}.jsx` read their range from `watch.eyeWorld()`.
- N's `SeatsButton`, `SitPrompt` and `SeatMenu` and the walk slot `lounge-walk-runtime.js` were created as null stubs, so LoungeHud is never edited again.
- `scripts/verify-airport-audio.mjs` gained the walking-eye check, and `scripts/_catalog-airports.mjs` is new.

### W4 N — walk and sit, classic room (2026-10-13)

Executed by the orchestrating session on `g2g/lounge-walk-n` (from W4-0), then merged `--no-ff`. Behind `LOUNGE_WALK`, shipped off. With the flag off nothing changes: every lounge gate passes unchanged and `verify-ops-golden` stays 28/28. What the walk does, the comfort rules and the open owner checkpoints are in [FLY_OBSERVATION_LOUNGE.md](FLY_OBSERVATION_LOUNGE.md) ("Lounge, further — N").

| Commit | Step |
|---|---|
| `3aa025c` | the walk: `lib/fly/lounge/room-walk.mjs` (walkable space, collisions, A*, glides, Sit prompt, click-a-chair), `lounge-walk-runtime.js`, SitPrompt / SeatMenu / SeatsButton, LoungeSurface keys and click, the walk CSS, the footstep cue; NEW `verify-lounge-vantage.mjs`, `verify-lounge-walk.cjs`; `review-observation-lounge.cjs --flags / --seats` |
| `bada877` | adversarial review fixes (mid-glide re-targeting, sub-cell path starts, the click ray under TRUE_SCALE, reduced motion read live, a key held through a landing, Esc and Enter and panels) and a gate that kills 11 of 11 mutations |

**Gates:**
- node: lounge walk 55 (28 W4-0 + 27 walk), NEW lounge vantage 7, audio 13; the rest unchanged (observation 45, lifecycle 24, lounge 13, lounge seat 6, airport set 17, fleet airframes 13, airfield ground 13, true-earth flags 8, ops golden 28/28, airport service 17, import integrity 4, front door 70);
- browser: NEW lounge walk 20; interaction 25/25 and browser states 24/24 flags off and with `?flags=LOUNGE_WALK`; promotion 9/9.

**Deviations from the design:**
- **Seat changes across the room fade through black.** The design gives the glide `maxMps 3.2` and `maxSec 3.0`. An 18 m change cannot satisfy both, and holding the 3 s cap meant a peak of 11.5 m/s at eye height. The speed cap wins (the comfort rule): a change that does not fit in 3 s at that speed dips through black (0.6 s, about 1.6 s in all). The seat-menu jump lands in about 1.3 s.
- **Click-a-chair reaches across the room** (the design names no reach). The nearest chair under the pointer answers, so an ordinary chair hides a vantage chair behind it.
- The corner seats keep the design's look centre (±0.55); the owner kept it at sign-off.

**`LOUNGE_WALK` on (2026-10-14).** The owner signed the walk off, and the flip is its own commit. Certifying the flipped tree found:
- a sliver of floor no seat change could start from (fixed: `pathStart()` floods a world-anchored 1 cm lattice; a whole-floor gate check over 101,168 points);
- the seat-menu jump is now timed on the page's clock;
- a pre-existing stall: WebGL program links of 4-12 s in the lounge's first minute, with the walk on **or off** (a soak on a production build). It is not the walk's; it is recorded in FLY_OBSERVATION_LOUNGE.md "Known issues", and the walk gate settles past it.

Gates on the flipped tree: node walk 56 and the lounge battery unchanged; browser walk 20/20 (production build), interaction 25/25 and states 24/24 in both arms, promotion 9/9 (dev).

# Gate to Gate — Takeoff & Landing overhaul, then the Lounge, further

Plan for a new execution session. Planned 2026-10-13. Detailed designs (step IDs cited below as
`airfield A4`, `experience D2`, `lounge W1-B`, `critic`) are archived locally in
`.graphics-review/gate-to-gate-plan/` (gitignored): `study-*.json` (4 code studies with file:line
evidence) and `design-*.json` (3 architect designs + the integration critic). **Where a design and
this plan disagree, this plan (which applies the critic's reconciliation) wins.**

## Context

The owner (2026-10-13) said: *"the runway and takeoff abilities are just so poorly done from both
an execution perspective as well as a graphics perspective… make it feel MUCH more rich, like the
million dollar game that it is. Once you do this, then enhance the observation deck even further."*

**The root cause: the premium airport already exists, but only in the lounge.** The Oct 12–13
lounge built OSM pavement with analytic FAA/ICAO markings and a glyph atlas. It also built
GlowPoints airfield lighting (ALSF‑2/MALSR, PAPI, TDZ, centreline, stop bars), a terminal pier, jet
bridges, moving GSE, parked airliners, aircraft lights and touchdown smoke.
`ObservationWorld` mounts all of it only while `airportWatch` is active
(`components/fly/ObservationWorld.jsx:20-30`, `FlyScene.jsx:3615`).

What a player actually gets today:
- **Runway look.** `AirportOperationsLayer.jsx:15-91` draws a grey slab with 5×7 bitmap
  designators at half FAA size, flat 1.5 m square lights and a three-box hangar.
- **Feel.** `FlightOperations` emits takeoff and touchdown events that nothing presents: no smoke,
  chirp, shake or camera beat. Engine pitch follows speed, not throttle. Liftoff is a switch, pitch
  equals flight path, and a gear-up landing is graded "Smooth". Failures freeze mid-motion.
- **Camera.** One chase camera. Every reposition plays the WARPING curtain.
- **Journey.** The panel is a web form whose AGL readout contradicts the top HUD. There is no
  navigation to the destination: `guidanceTarget()` is dead, and Atlas guidance is dropped the
  next frame. The grade is a single word, and `fly-flight-history` is never read.
- **Catalog airports.** The 14k catalog runways get no taxiways or gates.
- **Lounge.** One fixed seat, reachable only with `?graphicsReview=1&airports=on`, and nothing
  links it to flying.

## Owner decisions (final)

1. **Gate to gate at any airport with OSM data**, on the lounge airfield stack. Airports without
   data get a polished runway-only start (registry-tier markings and lights).
2. Feel: **cinematic and approachable.** You still rotate, flare and brake. Strong assists,
   forgiving grading, heavy drama.
3. **No ATC.** Guidance is diegetic: lights, stop bars and the HUD.
4. Callouts: **visual HUD captions + synthesized tones, no voice.**
5. **Lounge ↔ flight linked both ways.** "Fly from this gate" uses your hangar aircraft. After you
   land, "Watch from the lounge".
6. **Full living apron:** pier, a bridge docked to you that retracts, a pushback tug, GSE, and
   parked neighbours as static scenery. This closes the lounge checkpoint (parked aircraft stay).
7. **Payoff:** letter grade, cinematic debrief with an auto touchdown photo, and a Flights logbook
   with per-airport bests. No contracts, dailies or unlocks.
8. **Short replay** of the last ~60 s, in a later wave.
9. Lounge: **a pier room glazed both ways.** Back glass sits between the FIDS boards. **Free walk**
   (WASD + drag-look, collisions) with **snap-to-sit** vantage seats and a seat menu. The **best
   second view** is scored per airport. **No NPCs.**
10. **Desktop first, phone parity.** The phone keeps today's flow and gets a registry tier.
11. **Behind flags** (`enabled:false`, `?flags=NAME`). The owner flips each flag in its own commit.
12. **Promote the lounge on sign-off.** Flipping the lounge flags makes "Watch an airport" visible
    to ordinary desktop players: title, Atlas and the debrief CTA. Change `airport-feature-policy.js`
    in that same flip commit.
13. **Stop bars hold for a real arrival on short final**, live ADS-B only, with a type-only chip
    and a **45 s cap**. Rolling through a red bar is graded, never failed.
14. **Plausible default lighting** by runway class on *lighted* catalog runways: PAPI everywhere,
    plus ALS, TDZ and centreline lights on long runways. Unlit runways stay unlit.
15. **Commit ODbL OSM fixtures** for 7 airports (≤3 MB) with attribution in CREDITS.md.

Defaults I set, which the owner can override at a checkpoint:
- Auto-taxi, auto-gear and autobrake do **not** count as "Assisted". Line-up teleports, practice
  finals and warps still do.
- The seated city-building cap at YSSY (9 chunks instead of 12) and any flagship pier seat moves
  are decided **at checkpoint 4, with captures in hand.**

## Architecture (one of each — the critic's reconciliation)

| Piece | Home | Notes |
|---|---|---|
| **AirportService** `runtime.airports` | NEW `lib/fly/airport-service/` (`index, contracts, config, plan-areas, sites, area, ops-ground, clearance, gate, review-poses`) | Inert when `OPS_AIRFIELD` is off. A pure `planAreas()` runs at 2 Hz: ≤3 desktop areas and 1 on phones, by purpose (lounge > player-area within 6 km > destination > departure > Free Flight nearby). An area unmounts only after 2 plans without it. **Area key = ident + site x/z + runwayId + variant** (no purposes, no siteEpoch), so lounge→flight never remounts. The API also covers `towerPoint`, `diagram`, `stands` and `gateOptions`. |
| **Airfield renderer** | `lib/fly/airfield/airfield-ground.js` + `components/fly/airport/AirportAreas.jsx` | `AirfieldGroundSet` takes options instead of seat assumptions: injected model, multi-focus paint and grass, dual-face lights, `papiEye` (pilot eye), optional set apron, suppression key, tier, rebuild policy. The lounge becomes one area and keeps its runtime aliases. |
| **One wheel height** | `lib/fly/ops/contact.js` → `ops-ground.js` composite | The height field **pins every node under a registered runway** to the endpoint profile + eps. Physics reads `profile + RUNWAY_DRAWN_LIFT (0.09 m)` on drawn runways, and height field + pavement lift on taxiway, apron and stand cells of a 2 m `airfield-paved.js` mask. `surfaceAt`, `paved()` and `placementHeight()` are used by **every** placement and contact read, not only the three `findAirportSurface` calls. The ground is latched and swaps only while airborne or after >2 s parked. With no ready area, results stay authored (the Ohio rectangles remain the certified fallback). |
| **Taxi** | NEW `airfield-taxi-graph.js` (graph, gap repair, A* over node and incoming edge, grid fallback, fillet smoothing, "Taxi to 28L via B, B4"); `clearance.js` `evaluateHold` (decision 13); NEW `airfield-route-lights.js` (follow-the-greens + stop bars, 1 GlowPoints draw) | One `TaxiRoute` shape. Clearance is evaluated per frame outside the integrator and written to `ops.routeInput`. |
| **Living gate** | `lib/fly/airport-set/*` + NEW `bridge-rig.js` + `fleet-parked.js` | Rig capacity is **always reserved** and bound at runtime via `bindPlayerStand(i)`. Podium and apronY are sticky per area. One pure `chooseStand(layout,{spanM, prefer:'lounge-visible'\|'free'})`. Tug from the gse.js pushback kit, VDGS from reserved SetLights. The player's door anchor goes in `player-aircraft.js`. |
| **Ops core split** | `lib/fly/flight-operations.js` → `lib/fly/ops/{ground-step,air-step,contact,touchdown,completion,guidance,gate-sequence,taxi-follow}.js` | Proven byte-identical by the NEW `verify-ops-golden.mjs`, **recorded on the untouched tree first**. Adds `snapshot()`/`restore()` (deep), enriched event payloads, `ops.telemetry`. The integrator stays the only event emitter. |
| **Presentation** | NEW `ops-events.js` (one cursor), `ops-presentation.js` (one fan-out → `runtime.playerFx`), `aircraft-pose.js` (the **only** pose helper: renderView + visual AoA + heave; PlayerPlane, the lights feed, smoke, the director and replay all use it), `render-view.js`, `player-external-lights.js` | `flight.presentation.lights` is the single light state, always computed. |
| **Camera** | NEW `camera-mode.js` (precedence: lounge glide > photo > title > director > cinema > chase), `camera-director.js`, `camera-shots.js` (`previewPose` is shared with the lounge glide) | warpKind `'airport'` replaces the WARPING curtain for same-airport moves. |
| **HUD** | NEW `components/fly/hud/flight-deck/*`, `flight-deck-model.mjs`, `ops-callouts.mjs`, `ops-labels.mjs` | Target-UI language. **All pinned test ids and role names are preserved.** |
| **Audio** | NEW `lib/fly/ops-audio.js` + an apron mode in `airport-audio.js` | Effects bus only; `setTargetAtTime` only. |
| **Payoff** | NEW `landing-grade.mjs`, `flight-history.mjs` (v2 + v1 merge + bests), `hud/debrief/*`, `hud/logbook/FlightsTab.jsx` | |
| **Lounge** | Room variant `classic`/`pier` on `site.variant`. `watch.eyeLocal`/`eyeWorld`, posture, seats. NEW `room-walk.mjs`, `lounge-walk-runtime.js`, `lounge-bridge.js` | The session seat cache moves to `lounge-site.js` `resolveSessionSite` (one home; the service wraps it). |

## Flag registry (15 blocks, appended after `EARTH_HORIZON`, `fly-constants.js:7401`)

The one accessor is NEW `lib/fly/ops-flags.js`. It holds the literal `pinned(NAME,'__fly<Name>Override')`
reads and the helpers `opsAirfieldOn`, `opsTier`, `gateToGateOn` and `loungeVariant`. All 15 go in
`device-report.js` FLAGS. **Nothing but flag blocks after the marker**
(`verify-true-earth-flags.mjs:97-99`). Tunables live in `airport-service/config.js`, NEW
`lib/fly/ops-config.js` and `observation-config.js`.

| Flag | Gates | Phone |
|---|---|---|
| `OPS_AIRFIELD` | Service and areas, OSM ground, airfield lights incl. PAPI/ALS, wheel contact on the drawn surface, multi-disc suppression, AOL fallback (atlas designators, FAA stripes, no connector line, GlowPoints edge lights, unpaved surfaces), prefetch, `airfield` readiness part, lounge-as-area | Registry tier: `AF_LITE` runway, ≤1 area, ≤3 draws / 15k tris / 1.2 MiB, no OSM fetch |
| `OPS_APRON` | Pier set and parked fleet in flight areas, bridge rig, tug, VDGS, staged GSE | off |
| `GATE_TO_GATE` | Gate start, pushback, engine start/shutdown, router + greens + bars, 45 s hold, auto-taxi ≤4×, arrival stand, docking, "Taxi out from here" | off (runway-only; Ohio apron unchanged) |
| `PLAYER_GLOW_LIGHTS` | Player lights in TrafficLayer's AircraftLights (PlayerLights Points retired in satellite) + analytic landing-light pool | lights on, pool off |
| `OPS_FEEL` | N1 spool, two-stage rotation, ground effect / anti-balloon, auto gear + G, gear-up rejection, spoilers / reverse (R) / autobrake, failure that settles, handoff smoothing, render interpolation, ground mouse deadzone | on |
| `OPS_FX` | Visual AoA on the mains, oleo, wheel spin, nose steer, spoiler panels, prop RPM, burner/heat on the ground, ground shake channel, rumble, speed rush (v/Vr), tyre smoke/dust/spray, haptics | on (shake ×0.7) |
| `OPS_AUDIO` | N1 engine voices, start/shutdown, rumble, centreline thumps, chirp, gear, brakes, reverse, callout tones, duck arbitration, apron ambience | on (2 voices) |
| `CAMERA_DIRECTOR` | Nose / wing / tower / runway-side / establish / gate / flyby shots, V cycle, beats (Pause toggle), `'airport'` cuts, intros, `previewPose` | on (camera button) |
| `FLIGHT_DECK` | New deck, captions, approach HUD, nav chip + "Approach armed", beacon, minimap pin, Land-here, guidance mapping (rails/gates/ribbon hidden in "Minimal"), declutter, missed-approach prompt, names not ids | PhoneFlightDeck |
| `OPS_HANGAR` | Title hero, airport chooser (Gates badge, Gate mode), briefing + diagram, hangar lit to the real sun/weather, exterior stand fix, staging behind the hangar, confirm-before-discard | sheet chooser |
| `OPS_DEBRIEF` | Grade, provisional stamp, auto photo, debrief, history v2, Flights tab, title "your best" | bottom sheet |
| `REPLAY` | Render-only replay (90 s buffer, 60 s shown), replay cams, ReplayBar, replay audio | 1 MB cap |
| `LOUNGE_PIER` | Pier room, two-aperture lighting, 5th glass pane, per-variant AO, pier set and fleet both sides (flight areas too), back-aware seat chooser, seated city cap | inert |
| `LOUNGE_WALK` | Walk, postures, vantage seats (classic 3 / pier 4), Sit prompt, click-a-chair, seat menu (V / "Seats"), glide, footsteps | inert |
| `LOUNGE_BRIDGE` | Fly from here, Watch from the lounge, origin-aware Leave/Esc, Atlas bookmark + confirm, `'lounge'` transition, the `'airport'` entry card + **promotion (decision 12)** | inert |

## Delivery waves

Each wave = ≤4 parallel workstreams in worktrees (the lounge pass's pattern; junction
`node_modules`, `next dev --webpack`). Streams merge `--no-ff` to `main` in the stated order, with
the full node battery after each merge. **Streams never edit hot files seamed in W0 / W4-0**
(`FlyScene.jsx`, `PlayerPlane.jsx`, `TrafficLayer.jsx`, `operations-runtime.js`, the flag registry,
`airport-watch-runtime.js`, `LoungeHud.jsx`, `LoungeHeader.jsx`). Ownership per wave is listed in
`critic.phases` and must be copied into `FLY_GATE_TO_GATE.md` in W0.

### W0 — Contracts, seams, shared fixes (one agent on main; nothing visible changes)
Commits run in this order:
1. **Flags.** The 15 blocks plus `ops-flags.js` and `device-report`.
2. **Golden, then split.** Record `verify-ops-golden.mjs` (6 scenarios × 30/60/120/144 Hz) on the
   **untouched** tree, then do the readable split plus `snapshot`/`restore`/`runwayForWind`,
   byte-identical.
3. **Contact seam.** `ops/contact.js` provides `surfaceAt`, `paved` and `placementHeight` for every
   placement and AGL read (`flight-operations.js:22,34-36,60-62,82,109-111,131,160,181,202-203,236`).
4. **Data.** Event payloads, `ops.telemetry` and the `ops-events` cursor. `flight-history.mjs` v2;
   the v1 writer moves out of `OperationsHUD.jsx:49` and writes identical rows.
5. **Contracts.** `airport-service/contracts.js` and an inert service at `FlyScene.jsx:1117`.
   Also: `aircraft-pose.js` (PlayerPlane switched, equivalence to 1e-9), `render-view`,
   `ops-presentation` (lights only), director/shots stubs, `camera-mode.js`, `sim-hold.js`,
   `player-visibility.js`, deck/callout enums.
6. **Seams in the hot files.**
   - FlyScene: service update at −40; presentation after advance (`:2317`);
     `cameraOwner`/`transitionMode` (`:2483-2509`); `paused || simHold.any()` (`:2063`); G/R/V
     read only behind flags; `AirportAreas` next to `ObservationWorld` (`:3615`).
   - TrafficLayer: `runtime.playerFeed` before `lights.end` (`:440`).
   - `beginDeparture(aircraftId, airportId, start, {standIndex, runwayId, intro, from, fromPose,
     seamless})`, where `'gate'` delegates to `runtime.beginGate` with a runway fallback.
   - `sync(kind, {seamless})` with warpKind `'airport'`, inert until `CAMERA_DIRECTOR`.
   - WarpFlash `'airport'` card (keep `warp-hold`); no `warpSweep` for `'airport'`;
     `CameraTransition.start()`; `stageMinKm()`; prefetch call sites; the `connectLoungeBridge` slot.
7. **Unflagged fixes.**
   - `'gate'` in `START_MODES` (`flight-plan.js:28`).
   - Runway-catalog eviction must terminate (`runway-catalog.js:13`); protect idents through a
     Set and raise the limit.
   - Atlas guidance: add a `guided` field so far guidance survives (`operations-runtime.js:220-226`,
     `flight-operations.js:132`).
   - Airport tz from `standardOffsetAt` (`flight-plan.js:132`); `airportChoices` dedupe;
     `airportLabel` instead of raw ids.
   - Multi-area suppression (`airfield-suppression.js` plus AOL, SatRoad and living-airports with
     program key v3).
   - Reset `airportReturn` on `exitToTitle`, `launchSetup` and `beginDeparture`.
   - `resolveSessionSite` in `lounge-site.js`; export `browser-parts.jsx` and `AircraftGlyph`;
     ground-warp copy in the Atlas.
   - Delete the duplicate glyph keys (`AirportOperationsLayer.jsx:16-18`).
8. **Harnesses.**
   - NEW `scripts/_hangar-pick.js`, used to migrate the tracked `#departure-airport` harnesses.
   - Fix `scripts/_title.js:27` (`title-free-flight` → `title-explore`).
   - NEW `review-operations-airfield.cjs` skeleton.
   - **BEFORE baseline:** KCMH/KJFK/LOWI/YSSY/EGLL × day/golden/night × 7 runway poses.
9. **Docs.** NEW `FLY_GATE_TO_GATE.md` (contracts with file:line, the flag registry, per-wave
   ownership, the seam rule). Update the CLAUDE.md banner and close the parked-scenery checkpoint
   in `FLY_OBSERVATION_LOUNGE.md`.

**Gates:**
- `verify-true-earth-flags`, `verify-ops-golden`, and `verify-flight-operations` 33/33 with
  identical output.
- `verify-explorer` +1 (Atlas guidance holds from 20 km / 1,200 m) and `verify-r25-flight-plan`
  (+gate, tz).
- `verify-airport-lifecycle` 24 (the new return-pill check fails first on old main).
- NEW `verify-airport-service.mjs` (suppression, pose equivalence, snapshot round trip, eviction
  with 4 big idents + 20 discoveries).
- Every lounge/airfield gate unchanged.
- The build passes.
- All ops browser harnesses pass in the flags-off arm.

**Checkpoint 0:** the owner confirms the registry. No visuals to judge.

### W1 — The real airport under the wheels, the feel, the deck
Streams merge **B → A → C → D**.
- **A AIRFIELD IN FLIGHT** (`OPS_AIRFIELD`; airfield A1–A7)
  - Options decoupling.
  - Runway pinning and refine-only rebuilds with a rebuild policy (0 ms grounded / 500 / 2000).
  - Dual-face lights, hold-indexed stop bars, `papiState`, refcounted glyph atlas.
  - `planAreas`, sites, the area lifecycle, prefetch (hangar pick, destination, Guide approach,
    within 40 km), LRU 4, protected idents, and an `airfield` readiness part that never blocks
    past 12 s.
  - `AirportAreas` mount; the composite provider owns the engine slot.
  - Tiers: full / lite / registry.
  - AOL as the fallback (split runway/taxi meshes; plausible default lighting per decision 14).
- **B GROUND TRUTH, GRAPH, ROUTER, CLEARANCE** (pure, offline; airfield B1–B6)
  - The paved mask and the OpsGround composite with its latch.
  - `scripts/build-ops-airfields.mjs` writes **7 committed ODbL fixtures**.
  - Taxi graph with gap repair; router and instructions; `evaluateHold` with a 45 s cap read
    from `GATE_TO_GATE.maxHoldSec`.
- **C FEEL** (`OPS_FEEL`; experience A1–A3 + ground input)
  - Spool: N1 τ 2.0 / 1.1 s, heavy ×1.35, prop 0.35 s.
  - Two-stage rotation: liftoff at pitch ≥0.105 heavy / 0.085 light and ≥1.02 Vr.
  - Ground effect `0.45·(1−h/hGE)²`; flare-band vy cap +0.4; float bleed after 3.5 s.
  - Auto gear + G; gear-up contact fails with kind `gear`; spoilers, reverse and autobrake; a
    failure that settles within 4 s.
  - Interpolation via `renderAlpha`; the handoff hint.
  - 12% ground mouse deadzone; mouse-y rotation only with S held; steering kept while braking.
- **D FLIGHT DECK** (`FLIGHT_DECK`; experience D1–D4 + gaps)
  - View model and callout detector; desktop deck and phone deck (ids and role names kept).
  - Approach HUD (flight-path marker within 2 px, LOC/GS diamonds, fpm); nav chip and
    "Approach armed".
  - Beacon (1 draw, sky overlay × exposure); minimap pin; Land-here chip in Free Flight (replaces
    the hidden Slow funnel).
  - Guidance mapping; FlyHUD and near-field label declutter; missed-approach prompt; no overlap
    with the Contracts chip.

**Exit:** every gate passes in both arms (flags off byte-identical).

KCMH with `?flags=OPS_AIRFIELD` on High must show:
- exactly 1 departure area;
- wheels on `runway` at profile + 0.09 ± 0.01 m;
- AOL runway draws 0;
- ≤375 draws / 2.2 M tris and a texture delta ≤ +10 MiB against BEFORE;
- cold prefetch ≤ 20 s.

The phone registry tier must be within budget.

**Checkpoint 1** (RTX 5080 + iPhone): `OPS_AIRFIELD`, `OPS_FEEL` and `FLIGHT_DECK`, each alone and
then together.

### W2 — Takeoff & landing drama + the payoff
Streams merge **E → G → F → H**.
- **E AIRCRAFT & DRAMA** (`OPS_FX`, `PLAYER_GLOW_LIGHTS`; experience A4–A5, airfield D1–D3)
  - Visual AoA pivoted on the mains (≤0.30 rad total, de-rotation 1.4 s); oleo; wheel spin; nose
    steering; spoiler panels (optional flap panels).
  - Prop RPM from throttle; burner and heat haze on the ground.
  - Ground shake channel outside the cinema ×0.10; rumble by surface; touchdown drop; FOV/streaks
    keyed to v/Vr.
  - Player GlowPoints lights; tyre smoke / dust / spray via `runtime.playerFx`.
  - Analytic landing-light pool (program key `-v3` only when on; no THREE.Light).
- **F CAMERA DIRECTOR** (`CAMERA_DIRECTOR`; experience B1–B4)
  - Smootherstep blends 0.6–1.5 s; eye ≥ ground + 1.2 m; composer sync on near-plane change.
  - Shots: nose, wing, tower (`towerPoint` or synthetic), runway-side (sun behind), establish,
    gate, flyby.
  - Beats: takeoff from 0.9·Vr; **never during the flare**; touchdown at +0.6 s, emitting
    `touchdown-photo`.
  - `'airport'` cuts (220 ms dip); skippable intros with a lower third; a "Cinematic moments"
    Pause row.
- **G AUDIO** (`OPS_AUDIO`; experience C1–C4)
  - N1 engine and per-class voices; start and shutdown.
  - Rumble; centreline thumps every 15 m; 2 chirps + thump per touchdown; gear, brakes, reverse
    and the gear warning.
  - Callout tones; per-source music duck; apron ambience from live traffic.
  - `review-ops-audio.cjs` renders WAV stems for the owner.
- **H DEBRIEF & LOGBOOK** (`OPS_DEBRIEF`; experience F1–F3)
  - `landing-grade.mjs` weights: sink 0.25; centreline, aim, speed, flare and rollout 0.15 each.
  - Letters: A+ ≥95 "Butter", A ≥88, B ≥78, C ≥66, else D. A bounce caps the score at 87.
  - Provisional stamp at touchdown + 1.2 s; auto photo (`{record:false}`, prefix-scoped storage).
  - `FlightDebrief`: stats, route trace, actions [Fly again] [Taxi out from here] [Next airport]
    [Watch from the lounge, only when that action exists].
  - Flights tab with per-airport bests.
  - NEW `verify-ops-circuit.cjs` (production build, desktop + Pixel 7).

**Exit:** gates pass in both arms. `review-ops-experience.cjs` poses at KCMH/KJFK day/golden/night
plus LOWI stay ≤375 / 2.2 M, or name the shot that exceeds it.

**Checkpoint 2:** the main takeoff & landing sign-off.

### W3 — Gate to gate
Streams merge **I → J → K → L**.
- **I LIVING APRON** (`OPS_APRON`; airfield C1–C5)
  - Plan options; sticky podium; reserved rig + `bindPlayerStand`; `chooseStand`.
  - Animated bridge rig (wide doubles); tug; VDGS; staged GSE; mover yield.
  - Area-generic structures and fleet; door anchors and stand-class upsizing.
- **J GATE JOURNEY** (`GATE_TO_GATE`; experience G1–G3)
  - `beginAtGate`; pushback kinematics inside the fixed step; the engine state machine.
  - `taxi-follow` (holds enforced, auto-taxi by pure pursuit, ≤4× only in taxi phases with 1×
    near holds or traffic).
  - Arrival to a free stand **visible from the lounge**; VDGS docking; shutdown.
  - "Taxi out from here" without relocation; the seamless sync path.
- **K ROUTE LIGHTS & SERVICE** (airfield D4, W2-1..3)
  - RouteLights; service ↔ ops wiring.
  - Full review harness (stand / pushback / hold / taxi-in / docked poses, PAPI 2W2R at 3 nm and
    1 nm); budget lock.
  - NEW `verify-operations-airfield.cjs`.
- **L HANGAR & BRIEFING** (`OPS_HANGAR`; experience E1–E3)
  - Title hero; FlyAirportChooser (Featured incl. Innsbruck, Queenstown, Lukla, St Maarten,
    Haneda, Aspen; golden-hour; recent; nearby; eligibility before the click).
  - DepartureBriefing (conditions, runway by wind, diagram, gate, live counts); hangar lit to the
    real sun.
  - Exterior stand fix; no fake terminals; staging behind the hangar (no warp-hold).
  - ConfirmEndFlight; lounge search rows routed through the hangar.

**Exit:** NEW `verify-gate-to-gate.cjs` passes. At KCMH it runs gate (bridge docked, neighbours
parked, named route, greens) → pushback → red bar → takeoff → land → auto-taxi → dock → debrief.
A verified **no-OSM catalog strip** (`prefetchState.hasOsm===false`) also passes the runway-only
flow with a grade. Census ≤375 / 2.2 M at KCMH/KJFK/LOWI/EGLL (the YSSY city named). The phone
runway-only flow and the Ohio apron starts are unchanged.

**Checkpoint 3:** KCMH/KJFK/YSSY gate→gate, golden and night. Judge night apron brightness, the
hold behaviour and auto-taxi.

### W3i — Integration and record (one agent)
- Run every gate in every arm: flags off, each flag alone, all on.
- Produce contact sheets and the census.
- Write the `FLY_GATE_TO_GATE.md` record and the owner run list with `?flags=` URLs.

### W4-0 — Lounge contracts (one agent; behaviour identical)
- `observation-config` sections (`LOUNGE_PIER_ROOM`, `VANTAGE`, `WALK`, `PIER_SET`, `SEAT_BACK`,
  budgets) and `roomVariant()`.
- `loungeApertureFrom(eye,…,variant)`; matches today's aperture on 20k directions.
- Watch state: `eyeLocal`/`eyeWorld`, posture, seats, `lookLimits`, the `walk`/`cinematic` hooks,
  `enter(id,{origin, keepFlight, seat, faceStand})`, `exit()`, `handoff()`.
- `clampYawAround`/`walkBob`; the audio listener uses `eyeWorld`.
- Classic room blockers; additive layout fields.
- `_tri-bvh.mjs` with a byte-identical AO bake.
- `lounge-bridge.js` skeleton; LoungeHud/Header slots; a lounge plan section in
  `FLY_OBSERVATION_LOUNGE.md`.

### W4 — The lounge, further + the bridge
Streams merge **M → O → N → P**.
- **M ROOM-PIER** (`LOUNGE_PIER`; lounge W1-A)
  - A 9 m vertical back curtain wall at z 14.2 **between the FIDS boards** (the boards stay at
    x ±7.3).
  - The bar moves to the right wall; a back chair goes between the boards.
  - A compile-time `LG_BACK_GLAZED` aperture branch (no uniforms or lights); a 5th glass quad; a
    fixed probe eye; `lounge-ao-pier-v1.bin`.
  - Budgets: ≤14 draws / 140k / 24 MiB.
- **O PIER SET & SEATS** (`LOUNGE_PIER`; lounge W1-C)
  - Thin pier; back stands = rot180 of the canonical front planner (bridges, kits, decals and
    docking reused).
  - Mid LOD for far stands; the seated city cap (tuned at checkpoint 4).
  - `lounge-seat.js` back-hemisphere scoring (second runway / back apron / skyline); reject any
    back sample on a runway.
  - NEW `lounge-seats-pier.js` hub table.
- **N WALK & SIT** (`LOUNGE_WALK`; lounge W1-B)
  - `room-walk.mjs`: 0.1 m grid, sliding collision, A* glide ≤3 s (0.3 s veil when reduced
    motion).
  - Postures: standing eye 1.65 m, seated 1.18 m. WASD + Shift, captured before input. No pointer
    lock (the cursor stays the picker).
  - 4 pier / 3 classic vantage seats; Sit prompt (Enter); click-a-chair; SeatMenu (V / "Seats");
    footsteps.
  - "Face the back window" label at the back seat (testid kept).
- **P BRIDGE** (`LOUNGE_BRIDGE`; lounge W1-D, W2-1)
  - `entryContext`, bookmarks via `ops.snapshot()`/`restore()`, origin-aware Leave/Esc, Atlas
    confirm strip.
  - LoungeFlySheet: aircraft rail, visible fitting stands, faced runway unless crosswind > 15 kt.
  - `flyFromGate`: `beginDeparture(…,'gate',{standIndex, seamless:true, from:'lounge'})` →
    `bindPlayerStand` → glide to `director.previewPose` → `handoff()`, with **no remount**.
  - `watchFromLounge` via `keepFlight` + `playerParked` (your aircraft visible at its stand).
  - `'airport'` entry card when prefetched; promotion wiring (decision 12) ready for the flip
    commit.

**Exit:** every lounge gate passes in both variants and both arms. The loop "Fly from this gate →
gate → takeoff → land → gate → Watch from the lounge → Back to your aircraft" runs with no
warp-hold. Budgets: KCMH/KJFK/LOWI/EGLL ≤2.2 M / ≤360 calls; YSSY no regression from 340 / 2.55 M.

**Checkpoint 4:**
- the back view per airport;
- walking comfort;
- the YSSY city cap;
- flagship pier seat moves;
- the bridge loop.

Then flip the lounge flags, which promotes the lounge.

### W4i — Lounge audits (one agent)
- Pier sightline audit, all 111 hubs (≥95% with a valid pier seat).
- Paired performance runs and a 20-min soak.
- Delete the stale `review-airport-lounge.cjs`; write the record.

### W5 — Replay (later)
- **R1 core:** `replay/recorder.js`, 30 Hz × 90 s plus nearby real traffic at 5 Hz, ≤2 MB desktop
  / 1 MB phone. Render-only; `flight.pos` is bit-identical across a replay.
- **R2 presentation:** replay shots and auto-director, `ReplayBar`, replay audio, "Watch replay" in
  the debrief.

**Checkpoint 5.**

## Rules every stream follows
- **Rendering.**
  - No new `THREE.Light`; chain `onBeforeCompile` / `customProgramCacheKey` (CSM).
  - Anything transparent against the sky is a `registerSkyOverlay`, multiplied by
    `getR25Sky().exposure`.
  - TRUE_SCALE: metres under (k,1,k), view-space billboards, `ts*` helpers. Reversed depth.
  - worldRoot content uses absolute Object3D coordinates + local vertices + bend helpers.
  - Composer `setMainCamera` on every near/fov change.
- **Sim.**
  - Fixed 120 Hz, ≤100 ms catch-up; only the integrator emits events.
  - Every feel change is tested in both arms against `verify-ops-golden`.
  - Time compression applies only in taxi phases, with the wall-dt cap applied before scaling.
- **Policy.**
  - Real live aircraft only. Parked and gate choreography are scenery, never contacts.
  - No API keys or new runtime deps.
  - Assets are first-party or CC0 with `FLY_ASSETS` provenance, and CREDITS.md regenerated
    (including the ODbL fixtures).
  - CONDITIONS stays off; no rewards from the lounge; neutral paint.
- **Budgets.**
  - High 375 draws / 2.2 M tris. Each full area ≤20 draws / 650k / 40 MiB, and texture delta
    ≤ +10 MiB per area against BEFORE.
  - Service ≤0.3 ms p95; terrain pump ≤1.5 ms.
  - Retired layers pay for the new ones: AOL inside areas, LivingAirports tiles, sat-roads class 7,
    PlayerLights Points.
- **Code.**
  - Readable modules, unlike the old minified ops style.
  - CRLF: use the Edit tool. Run node directly (`node node_modules/next/dist/bin/next build`).
  - Commit to the stream branch and never push. Each flag flip is its own commit after sign-off.

## Verification

- **Node gates.** Existing gates stay green, or are re-baselined with documentation:
  - `verify-flight-operations` 33, `verify-explorer`, `verify-r25-flight-plan`, `verify-r25-front-door`;
  - airport observation 45, lifecycle 23→24, audio 11, lounge 12, lounge-seat 6, airport-set 17,
    fleet-airframes 13, airfield-ground 13, runway-catalog 9;
  - `verify-true-earth-flags`, `verify-import-integrity`, `verify-true-scale`.

  New gates:
  - `verify-ops-golden`, `verify-airport-service`, `verify-ops-ground`, `verify-taxi-router`;
  - `verify-flight-deck-model`, `verify-ops-callouts`, `verify-ops-presentation`,
    `verify-camera-director`, `verify-ops-audio`;
  - `verify-landing-grade`, `verify-flight-history`, `verify-ops-journey`, `verify-living-gate`;
  - `verify-lounge-walk`, `verify-lounge-vantage`, `verify-lounge-bridge`, `verify-replay`.
- **Browser gates** (dev or production server on a free port, unpinned, no pose writes):
  - The existing ops harnesses: `-browser`, `-design`, `-keyboard`, `-experience`, `-touch`,
    `-fleet`, `-taxi-edge`, and `verify-mobile-flight-deck` 29. They stay green **with flags off
    and with the relevant flags on**, since ids and role names are preserved.
  - Lounge `verify-airport-interaction` 25 and `-browser-states` 24.
  - New: `verify-operations-airfield.cjs`, `verify-ops-circuit.cjs`, `verify-gate-to-gate.cjs`,
    `verify-lounge-walk.cjs`, `verify-lounge-bridge.cjs`.
- **Visual review** (fixed sun, every look claim backed by a capture):
  - `review-operations-airfield.cjs` (5 airports + a no-OSM strip × 3 suns × runway and gate
    poses, census, both arms);
  - `review-ops-experience.cjs` (shots per pose);
  - `review-ops-audio.cjs` (WAV stems);
  - `review-observation-lounge.cjs --flags … --seats all`;
  - `review-lounge-sightlines.cjs --variant pier`.
- **Environment truth.** Headless results are local evidence. Every fps, feel and sound verdict
  belongs to the owner's RTX 5080 and iPhone at the checkpoints. The known pre-existing reds
  (`verify-living-earth` readiness, `verify-render-optimization`, `verify-r25-sky` 4h/4i) are named,
  not fixed, here.

## Top risks → mitigations

- **`flight-operations.js` is reshaped three times.** Record the golden on the untouched tree.
  Have one owner per wave (C in W1, J in W3) and give `contact.js` its own owner. Test in both
  arms.
- **The lounge→flight handoff pops** (remount, a 9 cm lift, a ground swap). Key areas by geometry
  only, reserve rig capacity, keep podium and apronY sticky, and latch the ground. The bridge
  browser gate asserts set object identity and y continuity.
- **Budget and governor at hubs.** Use staged mounting (ground within 40 km, set within 8 km), the
  three tiers and the retired layers. Run a census per pose and lock a node budget gate. On a tier
  drop the parked fleet hides first, and director shots fall back to chase below High.
- **First-visit OSM latency** of 10–15 s. Prefetch at every choice point, report `hasGate` only
  when the area is ready, keep the runway-start fallback, and never block readiness past 12 s.
- **Hot-file merge conflicts.** W0 and W4-0 seams, an ownership table and fixed merge orders.
- **The traffic hold feels like ATC.** Keep it diegetic (a bar and a type chip, never "cleared"),
  ignore stale fixes, treat a dead feed as no conflict, cap it at 45 s and grade rather than fail.

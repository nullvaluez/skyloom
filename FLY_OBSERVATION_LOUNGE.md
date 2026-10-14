# Observation Lounge — plan and record

> **Status (2026-10-13): W0 and all five W1 workstreams are merged on `main`,
> with an integration pass on top (see Record).** Still behind
> `?airports=on`. Every look and fps verdict below comes from headless Chrome
> on the owner's RTX 5080 box; the owner's own sessions decide the open items
> in "Owner checkpoints".
> This file is both the plan every workstream works from and the record of
> what shipped. It supersedes the seated-room section of
> [FLY_LIVING_AIRPORTS.md](FLY_LIVING_AIRPORTS.md) for everything inside the
> lounge; that file stays the record of airport discovery, the runway
> catalog, safe joining and the original performance campaign.

## The ask (owner, 2026-10-12)

> look over our last pass that added a new feature of a observability room from
> an airport. right now, the world itself just looks terrible, and the room has
> no immersive feel. this should truly feel like a cutting edge experience where
> you feel like you are plane watching. even right now, there are no contrails,
> and if you click on something, it does nothing. the binoculars zoom, and all
> you see is a callsign. id like for you to significantly overhaul this, come up
> with better 3d assets, and use our incredible immersive 3d atmosphering
> cinematic world as the outside view. you need to be mindful about the 3d assets
> generated on the satelite map as well to ensure everything looks like the
> billion dollar game that this is. perform a heavy pass to turn this viewing
> feature from what it is now as a skeleton, into a robust new feature addition.
> build it off the main branch so we can test along the way.

Standing owner decisions this pass keeps: **one seated first-person room**
(the three-view exterior UI was rejected), **real live aircraft only** (no
simulated flights), desktop only (phones excluded by policy), observation
grants no Explorer/passport rewards, no API keys, first-party or CC0 assets
only. CONDITIONS (manual time/weather) stays off by owner direction — the
lounge must not add a time picker.

## Diagnosis of the skeleton (evidence: four read-only briefs, live captures)

- **Room.** Six merged procedural draws: pergola-like slats, no glass, no
  interior lighting model (lit as if outdoors by sun + sky through the roof),
  noise-textured floor. Eye 8 m over the infield, 150 m off the runway.
- **World.** At 8 m the satellite photo is at a 1–3° grazing angle: z18 photo
  only resolves to ~350 m, the aerodrome interior is **raw photo** (no grass
  material — exclusion strips it), three pavement layers disagree (AOL runway
  +0.025 m, OSM sheet +0.65 m, ~7 m classification texels), night runway light
  quads float 5 m up and double up, large terminals are culled by the 60k m²
  footprint cap, no jet bridges, nothing moves on the ground.
  **Defect (fixed W0):** the aerial pass kept the flight near plane (2.5) while
  the lounge used 0.08, reconstructing depth ~31× too far and over-hazing the
  view; `getComposer().setMainCamera(camera)` now runs on every near change.
- **Aircraft.** Past 25 km every contact is a 6 px glint; under it, known
  families draw a mid hull (no windows) unless within 900 m. A lounge selection
  never earned the near model. **Defect (fixed W0):** every distance was taken
  from a point 300 m over the runway midpoint (the parked player), not the seat;
  the hidden player now waits at the seated eye. **Open defect:** a track deleted
  after 61 s and re-acquired keeps `meta:null` forever (worker meta signature
  never pruned) — FLEET fixes it.
- **Contrails.** They exist (12 admitted in the baseline) but cannot be seen:
  0.2–0.5 px wide at 20–60 km, 38 s life (~5 km long), alpha ~0.5 white on a
  bright sky, cloud gate floor 0, nothing below ~5.9 km, and far-lift moves high
  traffic to 2.5× its height above the eye past 20 km (now disabled while
  observing, `setAirFarLift`).
- **Click.** The world picker (`LabelCanvas`) returns early while observing,
  and the full-screen drag layer sits inside `[data-overlay]`, which the picker
  ignores by design. Only the six DOM hint chips are clickable.
- **Binoculars.** FOV × 0.28 and nothing else: a glint and a DOM callsign.
- **Sound.** Four sawtooth voices, nearest four contacts inside 2.4 km, music
  director keeps playing.
- **Also found:** PrecipLayer rain follows the camera indoors; the cloud
  composite casts cloud shadows on interior pixels; N8AO (radius 24) is sized
  for the world, not a 4 m room; no prewarm for lounge materials.

## The design

**Where you sit.** An elevated glass lounge on the terminal side of one runway
(`lib/fly/lounge-site.js`): flagships use the real terminal side (KCMH 10R,
KJFK 04L-22R, LOWI 08-26, YSSY 16R-34L at its 16R end), any other airport faces its longest
runway from the side its sibling runways are on. Floor 9–26 m above the apron
by runway class, glass 330 m from the runway edge on big airports. A higher
eye is the single biggest lever for the photo ground (steeper angles) and puts
the apron diorama below the window and the whole airfield, city and sky in
frame.

**What you see.** Through canted floor-to-ceiling glazing with a glazed roof
strip: the terminal pier below, jet bridges and parked aircraft on the stands,
ground support moving, the apron, taxiways and runway with real markings and
airfield lighting, live traffic as real 3D aircraft (gear, landing lights,
strobes), persistent contrails overhead, and the cinematic sky, clouds and
atmosphere doing the rest. Day, golden hour and night are all first-class.

**What you do.** Look around (drag, keys), click any aircraft to select it,
binoculars with real magnification that lock and stabilise on it, a spotter
card with photo/route/type/registration, a live board (arrivals, departures,
on the ground, overhead), follow, join a flight, photograph.

## Contracts (W0, on `main`)

| Contract | File | Notes |
|---|---|---|
| Room frame, room envelope, look limits, budgets | `lib/fly/observation-config.js` | Room-local metres: origin = floor under the seated eye, +X right, +Y up, −Z toward the runway. Group = rotation.y `site.heading`, scale (k,1,k). One config section per workstream. |
| Site | `lib/fly/lounge-site.js` | `resolveLoungeSite(airport)`, `siteToWorld`, `worldToSite`, `siteDirToWorld`, `loungeAperture(dir)` (front / roof / side glazing). |
| Layout | `lib/fly/airport-layout.js` | `airportLayout(site)` → `{terminal, apron, stands[], floorM}`; stand = `{id, cls, x, z (room-local), wx, wz (scene), heading (compass, traffic yaw convention), noseZ}`. Procedural default; AIRFIELD may source stands from real OSM gates but keeps the shape. |
| Glow lights | `lib/fly/glow-points.js` | `GlowPoints`: one instanced draw, sky-overlay pass, view-space quads (TRUE_SCALE-safe), min-px floor with energy falloff, flash modes (steady/strobe/double/beacon), directional beams, ground or air bend, cloud gate. Use it for every light seen at a distance. |
| Flight phase | `lib/fly/flight-phase.js` | `trackPhase(t, groundY)`, `gearDown`, `landingLightsOn`. Visual inference only. |
| Bend hooks | `lib/fly/toy-world/world-bend.js` | `shareBendUniforms(u)` for custom shaders; `setAirFarLift(boost)` (the lounge sets 0.2 = no lift, restores on leave). |
| Runtime | `lib/fly/airport-watch-runtime.js` | `runtime.airportWatch`: `active, validated, airport, site, seat (floor point, scene), floorY, roomHeading, frame.k, selected, tracking, yaw, pitch, zoom, snapshot()`, lifecycle actions. The hidden player waits at the seated eye. |
| Mounts | `components/fly/FlyScene.jsx` | `<ObservationWorld>` inside worldRoot (absolute scene coords on objects, local vertex data) → `observation/AirfieldGround`, `observation/AirportStructures`, `observation/ParkedFleet`. `<AirportLounge>` outside worldRoot (subtracts the anchor itself). HUD: `<AirportExperience>` in FlyMode. |
| Review harness | `scripts/review-observation-lounge.cjs` | `--port --airport --utc --views --out`; PNGs + report.json. |

## Workstreams (W1) and ownership

Each workstream works on its own branch in its own worktree and edits only
the files it owns. Anything needed outside that list is a **minimal additive
hook** called out in the hand-back, never a rewrite.

### A — ROOM (interior, glass, interior light)
Owns `lib/fly/airport-lounge.js` (may split into `lib/fly/lounge/*`),
`components/fly/AirportLounge.jsx`, `scripts/verify-airport-lounge.mjs`,
`ROOM_LOOK` in observation-config, any `scripts/build-lounge-*.mjs`.
Delivers the room to the `LOUNGE_ROOM` contract: canted glazing with slim
mullions, glazed roof strip, side glazing, a designed interior all the way
round (seat, side table with cup/binoculars/notebook, neighbouring seats,
columns, ceiling, floor, bar/back wall, plants), an in-world live board screen
(`CanvasTexture` from the runtime snapshot, ≤1 Hz), a lighting model that
reads as an interior (analytic window aperture on the key light, sky-visibility
on indirect, baked AO, warm practicals at night, eased exposure bias), glass as
a sky overlay (fresnel env reflection + sun glint + faint smudges; night
interior reflection; rain beading when it rains), and indoor fixes (no rain
indoors, no cloud shadow on interior pixels, N8AO sized for the room).
Budget ≤14 draws, ≤160k triangles, ≤24 MiB textures.

### B — EXPERIENCE (camera, interaction, binoculars, HUD, sound)
Owns `lib/fly/airport-watch-runtime.js`, `lib/fly/airport-observation.mjs`,
`components/fly/hud/AirportExperience.jsx` (+ `components/fly/hud/lounge/*`),
`components/fly/hud/airport-watch.css`, `lib/fly/airport-audio.js`,
`hooks/use-fly-audio.js` (lounge parts), `VIEW` + `SOUNDSCAPE` sections and the
airport node gates. Delivers click/tap selection of any visible aircraft
(projected bent positions, zoom-aware radius, hover), a real binocular mode
(magnification steps, eased zoom, stabilised lock-on tracking, twin-lens mask,
rangefinder readout), a spotter card (photo, route, type, operator from the
callsign tables, registration, phase, actions), the live board (arrivals /
departures / ground / overhead from `trackPhase` + runway geometry),
look-around with inertia, a "golden hour now" airport list (live sun, no
CONDITIONS), the lounge UI restyled to the `target-ui.css` language, and the
soundscape (room tone, PA chime, glass-muffled distant jets with distance
delay from the CC0 engine sample, music ducked).

### C — FLEET & SKY (aircraft and contrails)
Owns `lib/fly/live-aircraft*.js`, `lib/fly/detailed-traffic.js`,
`components/fly/TrafficLayer.jsx`, `lib/fly/traffic-geometries.js`,
`components/fly/TrafficContrails.jsx`, `lib/fly/aircraft-wake.js`,
`lib/fly/aircraft-effects.js`, `lib/fly/flight-phase.js`,
`lib/workers/aircraft-processor.worker.js` (meta fix only),
`components/fly/observation/ParkedFleet.jsx`, new `lib/fly/aircraft-lights.js`,
`FLEET_VIEW` + `SKY_VIEW`. Delivers higher-fidelity procedural airframes for
every family (and the common families now drawn as GLB stand-ins), neutral but
varied paint (policy: never an inferred airline livery; the real registration
may be painted), every contact within ~60 km of the observer as a real model
with the selection and nearest few at hero detail, gear and flaps by phase,
landing/taxi/logo lights, beacons and strobes through `GlowPoints`, touchdown
smoke, contrails visible from the ground (long-lived, spreading, wind-drifted,
sun-lit at dusk, pixel-floored, cloud-gated with a floor), parked aircraft on
the layout stands (static scenery — never a live contact, hidden when a real
ground contact occupies the stand; switch `FLEET_VIEW.parkedScenery`), and the
meta-loss fix.

### D — AIRFIELD GROUND (data, surfaces, lighting)
Owns `components/fly/observation/AirfieldGround.jsx`, new
`lib/fly/airfield/*`, the `'sat-airport'` worker detail in
`lib/fly/toy-world/vector-tile.worker.js`, `lib/fly/living-airports.js`,
`components/fly/AirportOperationsLayer.jsx`, the runway-light suppression in
`sat-road-engine.js`/`SatRoadLayer.jsx`, `AIRFIELD.ground`. Delivers real OSM
airport data for the observed airport (gates, aprons, taxiway lines with refs,
aerodrome outline, terminal footprints without the area cap), pavement that
reads as pavement at a shallow angle (asphalt/concrete materials, joints,
rubber deposits, correct runway/taxiway markings) replacing the conflicting
layers near the lounge, a grass/infield material over the aerodrome interior,
and the airfield lighting system (edge, threshold/end, centreline, TDZ,
approach lights with sequenced flashers, PAPI, taxiway edge/centre, apron
floods) through `GlowPoints`, day/dusk/night correct.

### E — AIRFIELD STRUCTURES (terminal, bridges, stands, ground support)
Owns `components/fly/observation/AirportStructures.jsx`, new
`lib/fly/airport-set/*`, `lib/fly/airport-layout.js` (keeping its record
shape), exclusions in `lib/fly/operations-scenery.js`,
`components/fly/AirportLandmark.jsx` (hidden at the observed airport),
`AIRFIELD.structures`.
Delivers the terminal pier under the lounge (curtain walls, roofline, roof
plant, lit concourse at night), jet bridges docked at stands, stand markings
and apron furniture, ground support equipment (tugs, belt loaders, baggage
trains, fuel and catering trucks; parked and moving on service roads), apron
flood masts, a control tower and hangars in view, windsocks; OSM buildings
inside the set's footprint retired; the old AirportLandmark stand-ins hidden at
the observed airport.

## Rules every workstream follows

**Rendering (from the pipeline brief).**
- Enhanced post chain: RenderPass → N8AO → aerial (depth) → immersive cloud
  composite (replaces every no-depth pixel with sky) → **SkyOverlayPass**
  (layer 29, after clouds, depth-tested, no lights/exposure/haze) → bloom/AgX/
  grade/vignette → SMAA. Anything transparent seen against the sky must be a
  sky overlay (`registerSkyOverlay`), or the sky replacement erases it.
- No new THREE.Light, ever (light hash change recompiles every lit program).
  Sun on desktop comes from the CSM cascade lights; materials are CSM-patched
  automatically — chain `onBeforeCompile` and `customProgramCacheKey`, keep the
  `lights_pars_begin`/`lights_fragment_begin` anchors. Custom `lights:true`
  ShaderMaterials sum every cascade (N× sun) — don't.
- Overlays get no exposure: multiply authored radiance by
  `getR25Sky().exposure` (lib/fly/r25-sky.js) where it must match the scene.
- TRUE_SCALE ships on: author metres under (k,1,k), light in view/TRUE space,
  use the `ts*` helpers, never `transpose(viewMatrix)`; billboards in view
  space (GlowPoints does this).
- Reversed depth buffer; composer buffers HalfFloat, `NoToneMapping` during the
  composer (materials output linear HDR).
- World content inside worldRoot: absolute scene coordinates on the Object3D,
  local vertex data; bend with the existing helpers (Enhanced = physical Earth
  radius, ~2 m drop at 5 km — still apply it).

**Policy.** Real live aircraft only for flights; parked scenery is a switch and
never a contact. No API keys, no new runtime dependencies. Assets are
first-party (generated in code or by a `scripts/build-*.mjs`) or CC0 with
provenance in `lib/fly/assets.js` `FLY_ASSETS` (regenerate CREDITS.md). No
Explorer/passport/contract rewards from anything in the lounge. Desktop only.

**Performance.** High ceilings are unchanged: 375 draws, 2.2 M triangles. Lounge
budgets: room 14 draws / 160k tris / 24 MiB textures; airfield (ground +
structures) 40 draws / 650k tris / 40 MiB; fleet 30 draws / 900k tris; sky 3
draws. The lounge renders at a 60 fps cadence (BudgetFramePump); the governor
keeps sampling, so a heavy lounge degrades the whole session — measure.

**Code.** Readable code with comments where the *why* is not obvious, like
`TrafficLayer.jsx` / `world-bend.js` (not the minified style of the skeleton).
The repo checks out CRLF (`core.autocrlf true`): use the Edit tool or
normalise before scripted replacements. Commit to your branch with clear
messages; never push.

## Verification

Node gates (must stay green): `verify-airport-observation.mjs`,
`verify-airport-lifecycle.mjs`, `verify-airport-audio.mjs`,
`verify-airport-lounge.mjs` (budgets re-baselined by A, documented),
`verify-import-integrity.mjs`, plus each workstream's new gates.

Visual review: `node scripts/review-observation-lounge.cjs --port <yours>
--airport <id> --utc <h>` at KCMH and KJFK (day `--utc 16`, golden `--utc 22`,
night `--utc 3`), LOWI (day 10, golden 16), YSSY (day 1, golden 7) and one
generic airport (EGLL day 12). Every look-changing claim is backed by a
capture; every fps claim names the machine.

Seats: `node scripts/review-lounge-sightlines.cjs --port <yours> --airports
<ids>` traces the seated eye to every runway's touchdown zone and 3° approach
(1.5–12 km) through the streamed building columns and the terrain, and with
`--grid` / `--candidates` scores other seats, including whether the set's pier
and apron would land on a real runway or taxiway. `--site
runwayId,along,cross,floorM` (both review scripts) tries a seat through
`window.__flyLoungeSiteOverride` (development builds only). It does not see
trees: confirm a new seat with a capture.

## Record

### W0 — scaffolding (2026-10-12)
Site/room/layout/glow/phase contracts, elevated seat (the hidden player waits
at the eye: traffic range, polling and bend centre follow the observer),
`setAirFarLift(0.2)` while observing, composer camera sync (over-haze fix),
hint clipping on `loungeAperture`, `ObservationWorld` mount with workstream
stubs, review harness. Gates: airport observation 29/29, lifecycle 12/12,
import integrity 4/4.

### W1 — five workstreams, merged in this order (2026-10-12 / 13)

Each ran in its own worktree under `C:\Users\bfecho\skyloom-lounge\`, merged
`--no-ff` onto `main` after its gates and captures were reviewed.

- **B EXPERIENCE (`90becf4`).** The picker works while seated: every contact
  is projected at its drawn (bent) position, glazing-culled, hover with
  hysteresis, click selects and follows, drag looks (never selects).
  Binoculars 1–25× (presets 7/12/20, wheel zoom, double-click raises them on
  the aircraft under the pointer) with a stabilised lock, twin-lens mask and
  rangefinder. Spotter card (photo, type, operator, registration, phase),
  live board (arrivals / departures / ground / overhead from `trackPhase` and
  runway geometry, ETAs, "not a schedule" footnote), golden-hour-now airport
  list, the target-UI restyle, and the soundscape (room tone, PA chime, five
  glass-filtered distant voices from the CC0 engine sample with distance delay
  and doppler, music ducked). New gate `verify-airport-interaction.cjs` (25,
  browser).
- **E STRUCTURES (`eac9026`).** `lib/fly/airport-set/*`: terminal pier with
  curtain walls and lit concourse, jet bridges docked at the stands, stand
  markings and decals, ground support (parked and moving), flood masts and
  pools, the tower at its real coordinates, hangars, windsocks, signs; OSM
  buildings in the footprint retired (restored on leave). 8–10 draws, ~134k
  set triangles at YSSY, 2.67 MiB atlas. New gate `verify-airport-set.mjs`
  (17), review `review-airport-set.cjs`.
- **A ROOM (`dde871e`).** `lib/fly/lounge/*`: a designed sky lounge (canted
  curtain wall and roof glazing, seating groups, bar, arrivals screen, side
  table with coffee, binoculars and notebook, planting), interior lighting
  through an analytic window aperture, offline AO bake
  (`public/models/lounge-ao-v1.bin`, `scripts/build-lounge-ao.mjs` — rerun
  after any room geometry change), 28 practicals, glass as a sky overlay with
  reflections, eased exposure bias; indoor fixes (no rain or cloud shadow
  indoors, N8AO sized for the room). 12 draws, 120,198 triangles, 21.9 MiB.
- **C FLEET & SKY (`812c493`).** First-party procedural airframes for 29
  families at three LODs (neutral paint, no liveries; windows, doors and the
  registration drawn at runtime), gear/flaps/spoilers by phase, every contact
  within 60 km a real model, lights (nav, beacon, strobe, landing, taxi,
  turn-off) in one GlowPoints draw, touchdown smoke, contrails seen from the
  ground (2–5 min life, spreading, wind-drifted, sun-lit, pixel-floored, 1
  draw), parked aircraft docked at the jet bridges by their L1 door
  (`FLEET_VIEW.parkedScenery`, hidden when a real ground contact claims the
  stand), and the worker altitude fix (QNH-corrected `alt_baro` low, geoid-
  corrected `alt_geom` high; identity re-sent). New gate
  `verify-fleet-airframes.mjs` (12).
- **D AIRFIELD GROUND (`ab365f8`).** `lib/fly/airfield/*`: the observed
  airport from OSM (worker detail `'sat-airport'`): pavement that reads at a
  shallow angle (concrete and asphalt, slabs, staining, rubber), analytic
  runway markings (FAA/ICAO) and designators, taxiway paint, procedural grass
  tinted by the imagery, and the lighting system (runway edge/threshold/end,
  ALSF-2 and MALSR with sequenced flashers, TDZ, centreline, PAPI, taxiway
  edge/centre, stop bars; ≤12,288 lights). `TerrainEngine.setGroundProvider`
  makes `getGroundAt` answer the drawn surface while observing. 5–6 draws,
  ~180–230k triangles. New gate `verify-airfield-ground.mjs` (13).

### Integration pass (2026-10-13)

- `b1a85fe` D's re-sample patch in E's frame loop: the set re-drapes when the
  airfield surface refines under it (pavement − set ground p99 1.10 → 0.11 m).
- `75831eb` an unknown 3-letter callsign no longer falls back to a 2-letter
  IATA match (ATN read "Royal Air Maroc" in the dossier).
- `5a9465e` idle brackets declutter (airborne first, no overlaps, no parked
  ground contact past 1.8 km — still pickable); the locked aircraft's
  navigation trace is hidden while the binoculars are up.
- `c390c78` **YSSY moved from along 700 to along 100 / cross 580.** From the
  old seat the terminal's 49 m north block stood in the line to every 16R
  arrival (the binoculars locked onto a facade). New
  `scripts/review-lounge-sightlines.cjs`, `airportWatch.runways` (read-only)
  and `window.__flyLoungeSiteOverride` (development builds). Final sightline
  audit, blocked points of 36 per airport: KCMH 0, LOWI 0, YSSY 1 (runway 07
  at 1.5 km), KJFK 2 (13L/13R touchdown zones; the faced 04/22 pair is
  clear). The set bound in `verify-airport-set.mjs` widened 3.5 → 6 km (a seat
  at one end of a long runway puts the far windsock 3.6 km out).
- `2733564` provenance for the room, the airframes, the set and the airfield
  surfaces in `FLY_ASSETS`; CREDITS.md regenerated (the generator now keeps
  the airport discovery section it used to drop).

### Seats at every airport (2026-10-13)

The four flagships were hand-placed and audited, but every other airport used
the generic rule (46 % along the longest runway, a fixed distance off it).
Audited at six hubs it put the set's pier and apron on taxiways (KORD 41 %,
LFPG 48 % of the footprint), on a crossing runway (KSFO, KPIT) or on grass
with no apron (KDEN) — and the golden-hour list sends players to exactly those
hubs.

- `lib/fly/lounge-seat.js` rasterises the airport's OSM data (aprons,
  runways, taxiway centrelines, buildings, gates; `SEAT` in
  observation-config) and scores seats along every long runway: never on a
  runway, taxiways under the set penalised, stands on real apron near real
  gates rewarded, sightlines to every touchdown zone and approach checked
  over the buildings; a wide runway takes the mid set only when nothing good
  fits. ~50 ms per airport.
- `scripts/build-lounge-seats.mjs` runs it offline for the golden-hour hubs
  (lib/airports.js) into `lib/fly/lounge-seats.js`: **107 of 111 hubs**, none
  on a runway, none with the faced runway's approach blocked by more than one
  point. Re-run it when `SEAT` or the set layout changes.
- Any other airport chooses at runtime: `enter()` transfers to the generic
  seat at once, loads the airport's OSM data in the background (the airfield
  ground's own shared load) and moves to the chosen seat before the reveal
  (`airportWatch.seatPending`, at most `SEAT.loadTimeoutMs`; the published
  site epoch remounts the set). Dev server: KPIT 13.2 s (generic seat 63
  footprint samples on a runway → chosen 0, 113 on apron), KIND 9.7 s.
- Order in `resolveLoungeSite`: review override → flagship → hub table →
  runtime choice → generic; `site.source` names it. Gate
  `verify-lounge-seat.mjs` (6) on a synthetic field the generic rule gets
  wrong.

Also: `380ac36` a contrail no longer takes a step when the feed jumps during
a stall frame (it now shifts with any jump inside 3 s; a 1.2 s stall used to
leave a 36° step for the trail's whole life), with a RED-first check in
`verify-fleet-airframes` (13).

**Gates on `main` after the pass:** airport observation 45/45, lifecycle 23/23,
audio 11/11, lounge 12, airport set 17/17, fleet airframes 13/13, lounge seat
6/6, airfield ground 13/13, runway catalog 9/9, import integrity 4/4, true
scale 14/14, aircraft effects 14, tracer spot 32/32, warbirds, cloud calm
6/6, HDR guard 4/4, conditions 7/7, interaction 25/25 and browser states 24/24
(browser), fleet static. Still red and
not this pass's: `verify-living-earth` "readiness covers missing
neighbouring tiles" (`world-readiness.js`, last changed before this pass), and
the earlier `verify-render-optimization` / `verify-r25-sky` (4h, 4i) reds.

**Measured (headless Chrome, RTX 5080, 1920×1080, High; vsync-capped, so
frame times read 16.7 ms p50 everywhere and say nothing about headroom).**
Golden hour, default view: KCMH 313 calls / 1.78 M rendered triangles, KJFK
302 / 1.98 M, LOWI 313 / 1.94 M, EGLL 330 / 1.96 M, YSSY 340 / 2.55 M; p95
16.9 ms, p99 20.7–24.8 ms, zero page errors. YSSY is over the 2.2 M guideline
because of the city in view from the new seat (satellite buildings 755k);
the lounge's own layers there are room 120k, set 134k, airfield ground 180k,
parked fleet 141k, live fleet up to ~380k — each inside its budget.

### Owner checkpoints (open)

- **Night.** Apron floods, cabin windows and taxiway/runway lights are tuned
  by eye in headless captures; judge the night apron brightness on a real
  display (`AIRFIELD.structures.night`, `FLEET_VIEW.flood`).
- **Frame rate** on the owner's machine at YSSY (the heaviest seat) and KJFK.

### Owner checkpoints (decided)

- **Parked aircraft at the gates: keep** (owner, 2026-10-13, as part of the
  Gate to Gate "full living apron" decision; FLY_GATE_TO_GATE_PLAN.md
  decision 6). `FLEET_VIEW.parkedScenery` stays on: static scenery, never a
  contact, hidden when a real aircraft takes the stand.

### Known issues and follow-ups

- A contrail can still bend at a real sharp turn (the step after a stall
  frame is fixed, `380ac36`).
- The sightline review ignores vegetation, and its bounding-cylinder
  buildings over-report next to large terminals (KLAX, LFPG, EHAM read many
  "blocked" points that a capture shows clear); the seat chooser itself uses
  footprints. A seat change needs a capture.
- A first visit to an airport outside the hub table waits for its OSM data
  (about 10–15 s on the dev server, where the worker compiles on demand)
  before the reveal; revisits in a session reuse the choice.
- Clear-sun shadow penumbrae show a fixed stipple on the apron (the shared
  cinema shadow kernel, not the lounge).
- Regional stand door sills sit up to 0.33 m off for CRJs and E-Jets (one sill
  height per class).
- Without traffic reporting `nav_qnh`, low altitudes fall back to raw
  `alt_geom`; contrail drift uses surface wind × 1.8 (no upper-air wind).
- Runway markings are foreshortened from a 22 m eye at 0.5–1.5 km
  (physically right; the binoculars resolve them).

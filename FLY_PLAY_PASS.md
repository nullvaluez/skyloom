# Play Pass — free flight and Watch an Airport (2026-10-21)

The owner asked for a review of where the game is weak (guided journeys
aside), then a visual and feature pass on **Free Flight** and **Watch an
Airport** that makes Skyloom something people truly want to play and that
looks good. Takeoff & Landing and Guided Journeys are backlogged for this
pass. Five Opus agents do the work, one per workstream, on the owner's local
`main` so it can be live-tested as each piece lands.

## The review (played live on `main` at 36b29fe, 1440×900, Ultra)

### Free flight

| # | What the player meets | Why it hurts |
|---|---|---|
| F1 | The `FLIGHT_INSTRUMENTS` HUD fills the middle of the screen: speed tape, altitude tape, heading scale, a horizon bar, a pitch ladder, a flight-path marker and the steering dot, all around the aircraft. | It reads as a fighter-jet sim the game is not. It covers the city, the aircraft and the traffic, which are the point. Most of it carries nothing the player acts on. |
| F2 | The chrome around it is scattered: a `0 pts` chip top left, a `Spotting · Off` button mid-left, a long control legend at the bottom, the Nearby dock and minimap bottom right, the place name top centre, a two-line attribution bar. | No single layout. Points show before anything scores. The legend never leaves. |
| F3 | "Some scenery is still loading. Retry scenery" stays up for minutes over Manhattan and the Alps, and sits on top of the escort chip during an escort. | Reads as broken; overlaps live UI. |
| F4 | Fly alongside (Nearby → Fly alongside): the cinematic camera loses both aircraft. The escorted helicopter (AS350, 900 ft) is never visible, only its bracket; the player jet is a speck at the edge. Two cards say the same thing (bottom-left "Escorting N410CK" and right "Live traffic · Crossing paths N410CK"); `Spotting · Off` sits on the escort card. | The headline activity of free flight has no payoff shot. |
| F5 | Low-level traffic (a helicopter at 900 ft) drags a thick white ribbon across the city. | Looks like smoke, not aviation; real contrails form only high and cold. |
| F6 | Manhattan from 3,000 ft: buildings are flat tan boxes in near-identical colours under a grey veil. | The city is the hero of a city flight and it reads as sandcastles. |
| F7 | Night at the Swiss Alps (live clock) is a dark blue mass with the instruments over it. | The live clock is an owner rule (CONDITIONS) and stays; the HUD should get out of the way at night. |

### Watch an Airport (KJFK window seat)

| # | What the player meets | Why it hurts |
|---|---|---|
| A1 | The live board says WJA1880 is on final for 04R "now"; nothing in the view shows where. No arrow, no cue, no automatic look. Landings happen off-screen. | The core promise — watch real arrivals — needs the player to know where to look and click at the right second. |
| A2 | The sky is dotted with dozens of empty dashed brackets (contacts far away). | Clutter that says nothing. |
| A3 | Binoculars on an arrival drift: the aircraft slides to the edge as it moves. | You fight the tool instead of watching. |
| A4 | No lean-back mode. Every moment needs a click: select, follow, binoculars. | A plane-spotting window should be able to run itself — the "TV" mode people leave on. |
| A5 | The apron is a vast flat grey plain; the far edge is a row of cardboard houses. | The view the whole mode is built around has no texture, wear or depth. |
| A6 | Follow works and the selected card is good; the board is good. | Keep; build on them. |

## The workstreams

Each workstream owns one flag (end of `lib/fly/fly-constants.js`, read only
through `lib/fly/play-pass.js`), **ON by default**; `?flags=-NAME` is the
previous experience for one page load.

| Stream | Flag | Goal | Owns |
|---|---|---|---|
| HUD | `CALM_HUD` | F1–F3, F7: a calm explorer HUD by default; the fighter instruments become an opt-in HUD mode; one layout for the chrome; toasts that behave | `components/fly/hud/FlyHUD.jsx`, `FlightInstruments.jsx`, `flight-instruments.css`, `JuiceHud.jsx`, `ExplorerGuide.jsx`, `Minimap.jsx`, `explorer.css`, new HUD files, HUD settings rows it adds |
| ENCOUNTERS | `ENCOUNTER_FEEL` | F4–F5: fly alongside / escort that frames both aircraft and shows the target, one card, a payoff moment; honest low-level trails | `lib/fly/escort.js`, `encounter-*.js`, `encounters.mjs`, `camera-director.js` (escort paths), `components/fly/hud/EncounterExperience.jsx`, `EscortHud.jsx`, `encounters.css`, `target-ui.css`, `TrafficTracers.jsx`, `TrafficContrails.jsx`, `lib/fly/sky-trails.js`, `fleet-trails.js`, `tracer-spot.js` |
| CITY | `CITY_FACADES` | F6: facades that read as real cities by day (colour variety, glazing, floors, roofs) without changing night or Neon | `lib/fly/satellite-architecture-material.js`, `lib/fly/building-profiles.js`, the satellite building material path in `lib/fly/toy-world/sat-building-*`, `components/fly/SatBuildingLayer.jsx` |
| DIRECTOR | `LOUNGE_DIRECTOR` | A1–A4: next-movement cue with an on-screen locator, a one-press watch that tracks through touchdown, steady binoculars, an auto-director mode, a decluttered sky | `lib/fly/airport-watch-*.{js,mjs}`, `components/fly/hud/AirportExperience.jsx`, `components/fly/hud/lounge/**`, `airport-watch.css`, `lounge-life.css`, `observatory.css` |
| APRON | `APRON_DETAIL` | A5: concrete with slabs, joints, wear and stains; markings that read; grass with variation; a far edge that is not cardboard | `components/fly/observation/AirfieldGround.jsx`, `AirportStructures.jsx`, `lib/fly/airfield/**`, `lib/fly/airport-surfaces.js` |

### Seams

- `FlyMode.jsx` and `FlyScene.jsx` carry empty marked blocks
  (`PLAY PASS <STREAM> begin/end`, and `PLAY PASS <STREAM> imports begin/end`).
  A stream that must mount something edits only its own block.
- `lib/fly/fly-constants.js`: a stream edits only its own block.
- Nobody else edits another stream's files. If a stream truly needs a change in
  a file it does not own, it keeps the change minimal and says so in its report.
- Shared stores (`stores/fly-store.js`): add fields, never rename or remove.
- The Gate to Gate seam rule still holds: `TrafficLayer.jsx`,
  `operations-runtime.js`, `PlayerPlane.jsx` are not edited outside existing
  marked blocks; `scripts/verify-ops-golden.mjs` stays byte-identical with
  this pass's flags off.

### Rules every workstream follows

- Flag off is the previous experience (DOM and shader text). Shader edits are
  anchored substitutions applied only with the flag on.
- Every existing `data-testid` stays; gates that index the HUD keep passing.
- Phones and tablets keep working (`verify-mobile-layout.js`); fill-rate costs
  are tier-gated.
- No per-frame `console.*`. No new network providers or API keys.
- Before every landing on `main`: scoped ESLint, `verify-true-earth-flags.mjs`,
  `verify-import-integrity.mjs`, the stream's own gates (existing ones it
  touches plus a new `scripts/verify-play-<stream>.mjs`), `verify-ops-golden.mjs`
  for anything near operations, and a browser check in the stream's own dev
  server with zero page errors, flag on and off.

## Status (2026-10-21, the pass is built)

Every stream landed on local `main` (not pushed); all five flags ship **on**.
The owner tests on the dev server (`skyloom-dev-3123` in `.claude/launch.json`).
Review captures from every stream are in `.graphics-review/play-pass/<stream>/`
(gitignored, local).

| Stream | State | Merges on `main` |
|---|---|---|
| W0: review, flags, reader, mount blocks, this record | **Done** | `553c4cb`, plus `a08407c` (EarthSurfaceLayer null-flight guard; the dev hot reload threw ~50k errors) |
| HUD (`CALM_HUD`) | **Landed** | `d9d68ff`, `58a8ea2` |
| ENCOUNTERS (`ENCOUNTER_FEEL`) | **Landed**. The agent ran out of session before writing its report; its commits and gate are complete | `5f22d09`, `e7c6ac1`, `b75058a` |
| CITY (`CITY_FACADES`) | **Landed** | `63b03d8` |
| DIRECTOR (`LOUNGE_DIRECTOR`) | **Landed** | `56994c3`, `cc608de`, `6b2baf6`, `47903b5` |
| APRON (`APRON_DETAIL`) | **Landed**. Same as ENCOUNTERS: session ended before the report; commits and gate complete | `0f6cd3b`, `baf5c73`, `a8d3e98`, `b04613f` |

### What the player gets

- **HUD.** Free Flight opens on the **Explorer** HUD:
  - The middle of the screen is the aircraft and the world.
  - Speed, altitude (AGL in amber below 1,000 ft), heading and throttle sit in one quiet row at the bottom centre.
  - The place name is the headline at the top.
  - A steering cue (a ring and a needle toward the cursor) shows only while the mouse is off-centre and moving.
  - **H** cycles Explorer → **Instruments** (the `FLIGHT_INSTRUMENTS` HUD, unchanged) → **Clean**. The mode can also be set in Settings → HUD and is saved under `fly-hud-mode`.
  - After 6 s without input the chrome dims; any input or event brings it back.
  - The Spotting toggle moves into the bottom row.
  - The points chip waits for the first score.
  - The key legend shows for the first 3 flights, then becomes one line (`fly-hud-legend-v1`).
  - Notices share one lane in the bottom row.
  - The scenery notice speaks only when missing scenery is actually on screen, after 30 s, and retries once by itself first.
  - Phones keep their compact strip.
  - Files: `components/fly/hud/CalmHud.jsx`, `calm-hud.js`, `calm-hud.css`.
- **ENCOUNTERS.** Fly alongside:
  - The camera is a photo ship close in: the target large and lit, the player in the same frame, swinging round from the pursuit on an arc (`lib/fly/escort-shot.js`).
  - Formation holds the slot by speed along the target's track, so helicopters are held alongside rather than looped (`escort-formation.js`, through the autopilot's marked block).
  - One escort card (`EscortCard.jsx`) shows photo, type, route, the 30 s memory bar, and Photo / Cinema / Release.
  - Drifting out of the slot drains the timer instead of zeroing it.
  - Payoff: the camera eases to the best angle, the shutter keeps that frame, and a "Flight memory saved" lower third appears (`EncounterMoment.jsx`).
  - Every memory earns that lower third: escort, discovery or crossing; a crossing's photo joins its memory.
  - Discoveries get a guidance marker in the experience's colour, with an off-screen chevron and its distance.
  - Photo mode gets a viewfinder chip that says what the encounter shutter will see.
  - Honest trails: below contrail-forming air a traffic trail is a thin light line that gives way to the hull, and the escorted aircraft drops its trail at escort range.
- **CITY.** Daytime satellite buildings get:
  - Regional cladding: nine palettes, chosen from the worker's Natural Earth context and eased over 2.5 s.
  - Dark tinted curtain-wall glass that reflects the scene's own sky (high tier only).
  - Cladding that is consistent across a tower's separately mapped parts.
  - Real roofs (membrane, gravel, tar, planted, tile) with parapets a shade darker.
  - Night, Classic, Neon and the toy world are unchanged.
  - No new draws or textures.
  - Code: `lib/fly/city-facades.js`, `satellite-architecture-material.js`.
- **DIRECTOR.** Watch an Airport:
  - A **Next movement** cue (callsign, type, runway, countdown, and the movement after it).
  - A locator: a ring on the aircraft, an edge arrow with its ETA when off screen, or the touchdown spot when the aircraft is hidden.
  - **N** watches it: the head eases into the swing and follows through touchdown and rollout (or the roll and climb-out), then lets go.
  - **H, Watch for me:** an auto director. It takes each movement it can actually show, raises the binoculars on short final and through touchdown, and shows broadcast lower thirds (airline and flight, type, the route when it agrees). It rests on the runway between movements and fills quiet spells with taxiing aircraft. Any input hands control back.
  - "Touchdown" and "Airborne" moments.
  - Steady binoculars that auto-zoom to fit the aircraft (measured ±3 px at 25x, 7–8 km).
  - A clean sky: brackets only near and on movers, faint dots in the middle distance, nothing far.
  - Code: `lib/fly/airport-watch-director*.{mjs,js}`, `components/fly/hud/lounge/DirectorHud.jsx`.
- **APRON.** The lounge's airfield ground:
  - Concrete in paving lanes with slabs, joints and cracks; oxidised asphalt with patches.
  - A detail field (`lib/fly/airfield/airfield-apron.js`, never on touch devices) for:
    - main-gear rubber either side of every taxi path;
    - oil stains under parked aircraft;
    - edge dirt and shoulders;
    - runways worn down the centre.
  - Yellow taxiway paint with black borders.
  - Grass:
    - mown runway strips with swaths that catch the light, rough grass beyond, and scoured runway ends;
    - the grass frays into the photographed world instead of stopping on a ruled line.
  - At night, floodlit apron pools that spill onto the grass.
  - Rain soaks the airfield over about a minute and dries over about ten: glossy pavement, standing water, darker paint.
  - No draws added.

### Verification on the merged `main` (orchestrator, 2026-10-21)

- **Node gates, all green:**

  | Gate | Result |
  |---|---|
  | `verify-play-hud` | 51 |
  | `verify-play-encounters` | on and off arms |
  | `verify-play-city` | pass |
  | `verify-play-director` | 24 |
  | `verify-play-apron` | 19 |
  | `verify-ops-golden` | 28/28 (byte-identical) |
  | `verify-true-earth-flags` | 8 |
  | `verify-import-integrity` | 4 |
  | `verify-escort` | pass |
  | `verify-encounter-runtime` | pass |
  | `verify-living-flight-ui` | 34 |
  | `verify-living-menus` | 12 |
  | `graphics-unit` | pass |

- **ESLint:** 51 changed files, 28 errors before and 28 after, all pre-existing in `FlyScene.jsx`.
- **Browser on :3123:**
  - the HUD's three modes;
  - an escort through to "Flight memory saved";
  - the JFK lounge by day (Watch for me through short final) and at dusk (floodlit apron);
  - Manhattan by day (pinned noon) and at night.

  Zero page and shader errors on the final tree.
- **Streams' own browser gates** (per their reports):
  - HUD overlap audit at 1440, 1920 and 1280: 64/64;
  - lounge gate suite: 30/30;
  - CITY: a motion burst with no more sparkle than flag off;
  - every flag-off arm: zero errors.
- **Flag-off identity** is pinned in node for every stream: the DOM and Settings rows (HUD), shader text and program keys by sha256 (CITY, APRON), and the runtime with no director attached (DIRECTOR).

### Owner checkpoints (open)

- **Look in motion on the RTX 5080** (nothing here had a real-GPU motion check):
  - CITY: Midtown at 750–1,500 ft, curtain-wall frames and roof edges, flag on vs `?flags=-CITY_FACADES`;
  - APRON: slab and paint detail through the binoculars;
  - the escort shot.
- **HUD:**
  - Is Explorer the right default, and H the right key?
  - Calm timing (`CALM_HUD.calm`).
  - Should calm also dim the Nearby button (an ENCOUNTERS file)?
  - Should Clean hide more?
  - Should AGL show only below 1,000 ft?
  - The points chip now hides until the first score; on desktop that also hides the contracts list.
- **CITY tuning:**
  - glass strength (`CITY_FACADES.reflect`, `skyBias`, `glassF0`);
  - glass share (`claddingCuts`);
  - roof mix;
  - Tokyo's east-asia palette may want more warmth.
- **DIRECTOR:**
  - Should Watch an Airport open in Watch for me? A button on the airport browser's cards would sit in `browser-parts.jsx`.
  - Director timing (`LOUNGE_DIRECTOR.director`), clean-sky ranges (`.sky`), binocular fill (`.optics`).
  - Moments reuse the soft "select" chime; there is no touchdown sound in the game.
  - Whether N and H belong in the lounge help line.
- **APRON:** wetness strength (`APRON_DETAIL.wet`; the dev pin `window.__flyApronWet = 0..1` previews it).

### Known issues and follow-ups

- **Not this pass, found during it:**
  - **Grey veil at altitude.** From about 8,000 ft, Manhattan disappears into a uniform grey haze even in pinned clear weather; 6,000 ft is fine. This is the sky/atmosphere pass (aerial perspective), reported by CITY with captures (`city/on11/nyc-8000-noon.png` vs `nyc-6000-noon.png`).
  - **Assert flood.** `PoiLetters` → `TerrainEngine.getElevationAt` → three-tile `getLocalInfoFromGeo` fails `console.assert` about 6 times a second in flight and in the lounge. The guard forwards every failure, so a dev console buffers tens of thousands.
  - **YSSY seat.** YSSY's window seat never validates in a headless harness, flag on or off ("Loading terrain and live activity…"); check it on the owner's machine.
- **Pre-existing reds** (each fails the same with this pass's flags off or before it):

  | Gate | Failure |
  |---|---|
  | `verify-encounters.mjs` | C-17 GLB length 53.45 m against its declared length |
  | `verify-living-earth.mjs` | localRingReadiness no-data |
  | `verify-finalize-pace.mjs` | check 9 (an LF regex on a CRLF file) |
  | `verify-sat-buildings.js` | F1 (kept ≤ 500 per chunk vs ~5,438) |
  | `verify-lounge-promotion.cjs` | 8/9 (expects `fly-title-card`; the cinema title renamed it `tcn-row`) |
  | `verify-mobile-layout.js` | an intermittent React "Cannot commit the same tree" page error, also with `?flags=-CALM_HUD` |

- **Seams to tidy:**
  - Flight's Nearby key handler (`EncounterExperience.jsx`) still hears N in the lounge. DIRECTOR closes that scope from its side with the flag on; ENCOUNTERS could ignore N while `airportWatch` is active.
  - ENCOUNTERS' result line ("A new place, a fresh sky.") is a second notice surface beside the HUD lane.
- **Dev only:** a merge landing while the game is open can throw React's "Should not already be working" on hot reload; a full reload clears it.
- **Out of scope** (backlog): Takeoff & Landing, Guided Journeys.

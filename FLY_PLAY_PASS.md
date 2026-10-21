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

## Status

| Stream | State |
|---|---|
| W0 — review, flags, reader, mount blocks, this record | **Done** |
| HUD | In progress |
| ENCOUNTERS | In progress |
| CITY | In progress |
| DIRECTOR | In progress |
| APRON | In progress |

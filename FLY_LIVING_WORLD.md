# Living World — the graphics pass (plan and record)

**Started 2026-10-20 on `claude/vigilant-newton-moag9y`.** The owner asked for "a
major graphics update to make the world and planes and everything else feel more
immersive and alive": the landscape, the atmosphere, contrails, plane models and the
overall aesthetics including the menus, with before and after screenshots.

This file is the plan and the record. **Status** and **Results** are filled in as
work lands; the plan below them does not change after the fact.

## Environment truth (this session)

- **Network.** Unlike every earlier pass, this session's proxy reaches Esri World
  Imagery, Esri elevation, OpenFreeMap, open-meteo and NASA GIBS, so the review
  captures show **real streamed terrain, imagery and buildings**, not the synthetic
  fixture. The ADS-B feed is replaced in captures by a fixed synthetic sky, so
  both arms see the same traffic.
- **GPU.** WebGL is SwiftShader (software). Frames take seconds; the terrain tree
  refines about one zoom level per 30–45 s at 1600×900. Captures are LOOK
  evidence only. **Every fps, frame-time and feel verdict belongs to the owner's
  RTX 5080 and iPhone.**

## What the survey found (2026-10-20)

Four read-only surveys mapped the shipped Enhanced satellite look (sky and post,
aircraft and trails, ground and water, menus and HUD). The short version:

| Area | Strong today | Weak or missing |
|---|---|---|
| Sky | Physical atmosphere (Hillaire LUTs), true sun, AgX | No light shafts, no lens response, stars without twinkle or Milky Way, moon without halo |
| Clouds | One raymarched deck, curved-world bounds, wind drift | Ad hoc phase function, negligible multiple scattering, authored ambient; the deck ends at 22 km (a disc around you at cruise); no high cloud |
| Trails | Physically shaped persistent trails exist, **but only in the lounge** | In flight: 38 s ribbons out to 22 km, at most 48 aircraft; distant cruising traffic leaves nothing |
| Aircraft | Authored GLBs, clearcoat hulls, baked AO, CSM shadows | No panel detail, opaque canopies with no pilot, solid propellers, lights that the sky replacement can erase by day, no condensation effects |
| Ground | z18 imagery, relief normals, procedural buildings, a physical sea | Dark cities from cruise at night, no valley mist, rain streaks erased against the sky |
| Menus | Live-world title, inspect dossier, escort HUD | Four competing styles, a stock zinc Pause menu, a text-table HUD, no transitions, a dim hangar |

## The workstreams

Each workstream is one flag at the end of `lib/fly/fly-constants.js`, **ON by
default** (owner-requested), read only through `lib/fly/living-world.js`.
`?flags=-NAME` shows the previous look for one page load.

| Flag | What it does | Owner | Files |
|---|---|---|---|
| `LIVING_CLOUDS` | Cloud light: two-lobe Henyey–Greenstein phase, multiple-scattering octaves, sky-lit ambient, more key taps on High/Ultra | SKY | `lib/fly/immersive-cloud-pass.js`, `lib/fly/living-clouds.js` |
| `FAR_CLOUDS` | The deck beyond the 22 km volume, out to the horizon (one shaded sample on the curved cloud shell; TRUE_EARTH_PASS.md, Phase 2) | SKY | same |
| `CIRRUS` | A high, thin cirrus layer lit from its own altitude | SKY | same |
| `LIGHT_SHAFTS` | Crepuscular rays through cloud gaps, around ridges and the aircraft | SKY | `lib/fly/light-shafts.js`, the cloud pass |
| `LENS_FLARE` | Veiling glare, a soft starburst and faint ghosts, occluded by cloud and terrain | SKY | same |
| `FILM_GRADE` | Fine grain and slight lateral colour at the frame edges | SKY | `lib/fly/film-grade.js`, `components/fly/Effects.jsx` |
| `NIGHT_SKY` | The Milky Way where it really is, twinkling stars, a moon halo | SKY | `lib/fly/cinema-sky.js` |
| `SKY_TRAILS` | Persistent contrails in flight for traffic and the player, formed by a temperature test | SKY | `components/fly/TrafficContrails.jsx`, `components/fly/Contrail.jsx`, `lib/fly/fleet-trails.js` |
| `RAIN_OVERLAY` | Rain and snow streaks stay visible against the sky | SKY | `components/fly/PrecipLayer.jsx` |
| `VAPOR_FX` | Transonic vapour cone, over-wing vapour under load, wingtip vortices | AIRFRAME | `components/fly/PlayerPlane.jsx` (own block), `lib/fly/aircraft-effects.js`, new files |
| `AIRFRAME_DETAIL` | Panel lines and fasteners, glass canopies with a pilot, propeller discs, lights that read by day | AIRFRAME | same, plus `lib/fly/airframe-detail.js` |
| `NIGHT_LIGHTS` | NASA GIBS VIIRS night lights beyond the generated city lights (TRUE_EARTH_PASS.md, Phase 2) | GROUND | `components/fly/AerialPerspective.jsx`, `lib/fly/night-lights-atlas.js`, credits |
| `GROUND_MIST` | Valley mist and low haze layers at dawn, dusk and in humid air | GROUND | `components/fly/AerialPerspective.jsx` |
| `MENU_GLASS` | One glass design language for Pause, Settings and Credits | UI | `components/fly/PauseMenu.jsx`, `components/fly/hud/SettingsRows.jsx`, `components/fly/hud/CreditsPanel.jsx`, new CSS |
| `TITLE_MOTION` | Title sequence: wordmark, staggered entrance, card art, a lit Continue | UI | `components/fly/hud/TitleScreen.jsx`, `title.css` |
| `FLIGHT_INSTRUMENTS` | Speed and altitude tapes, a heading scale, a flight-path marker | UI | `components/fly/hud/FlyHUD.jsx`, new component |
| `HANGAR_STAGE` | Studio light, reflective floor, door haze, eased camera moves, idle turntable | UI | `components/fly/hud/HangarScene.jsx`, `GroundHangar.jsx` |
| `TITLE_CINEMA` | The window-seat title: live dataview, world tour behind a window shade, boarding-pass primary, numbered modes; the journeys sheet and the pause card in its type ([FLY_TITLE_CINEMA.md](FLY_TITLE_CINEMA.md), 2026-10-21) | UI | `components/fly/hud/CinemaTitle.jsx`, `cinema-title.css`, `cinema-menus.css`, `lib/fly/title-tour.js` |

### Rules every workstream follows

- **Flag off is the previous frame.** Shader edits are anchored text substitutions
  that throw on a missing anchor (the R25 `swapExact` idiom) and are applied only
  when the flag is on, so flag-off program text and keys are unchanged.
- **One reader.** Blocks are read only through `lib/fly/living-world.js`
  (`verify-true-earth-flags.mjs` (5)); tunables live in the owner's own block.
- **Seams.** Nobody edits `FlyScene.jsx`, `TrafficLayer.jsx`, `operations-runtime.js`
  or another workstream's files. `PlayerPlane.jsx` edits stay inside one marked
  AIRFRAME block. The hangar's one airframe-material call is wired at integration.
- **Tiers.** Anything that costs fill rate is tier-gated (phone and Low keep today's
  frame unless a block says otherwise).
- **Before every push:** scoped ESLint, `verify-true-earth-flags.mjs`,
  `verify-import-integrity.mjs`, `FLY_TILE_FIXTURE=1 verify-worker-window.mjs`,
  `verify-ops-golden.mjs` (byte-identical), the workstream's own node gate, and a
  browser smoke with zero shader and page errors with the flags on and off.

## Capture protocol

`scripts/capture-graphics-pass.cjs` boots one build, pins the sun instant, weather,
quality preset (High), governor (hold), lens (60°), the animation clock (240 s) and
the traffic (synthetic, fixed epoch), settles each pose at 640×360 and resizes to
1600×900 for the frame, and writes PNGs plus `manifest.json`. The **before** arm is
a production build of `ebfb6ab` (the tree this pass started from) in a separate
worktree; the **after** arm is a production build of the final tree. Poses: Alps
noon and golden hour, Yosemite morning, cruise with traffic, an aircraft photo
orbit, the Honolulu coast, Manhattan at dusk and at night, rain under overcast in
Seattle, and the title, hangar and pause screens.

## Status

| Workstream | State |
|---|---|
| W0 — survey, flags, reader, capture harness, this plan | **Done** |
| SKY | **Landed**, then repaired after the owner flew it (merge `b7a9e61`, flags `0ef62b2`, night-sky fix `3b36fd4`) |
| AIRFRAME | **Landed** (merge `f733916`; hangar wiring `3714518`) |
| GROUND | **Landed** (merges `218e54f`, `9cc7d41`; wiring `9e160ed`; low-altitude tuning `22acdb1`) |
| UI-MENUS | **Landed** (merge `31aaee9`) |
| UI-FLIGHT | **Landed** (merge `d320cae`) |
| Integration, after captures, gallery | In progress |

### Flag state at the close

| Flag | State | Note |
|---|---|---|
| `LIVING_CLOUDS` | **on** | Repaired: ambient from the sky's irradiance at the deck, ground-lit bases, eccentric octaves |
| `FAR_CLOUDS` | **on** | Repaired: per-column opacity, a lit and a shadow side, cover averaged past the footprint, wider depth tolerance |
| `CIRRUS` | off | Value-noise filaments on a fixed grid read as a lattice; needs a new density field |
| `LIGHT_SHAFTS` | off | Screen space darkens the air in front of every sunlit valley; needs shadowed air marched along the view |
| `LENS_FLARE` | off | A camera artefact over every sun; off with the shafts, and whether it belongs at all is the owner's call |
| `FILM_GRADE`, `NIGHT_SKY`, `SKY_TRAILS`, `RAIN_OVERLAY` | on | |
| `VAPOR_FX`, `AIRFRAME_DETAIL` | on | |
| `NIGHT_LIGHTS`, `GROUND_MIST` | on | After a fix round (below) |
| `MENU_GLASS`, `TITLE_MOTION`, `FLIGHT_INSTRUMENTS`, `HANGAR_STAGE` | on | |
| `TITLE_CINEMA` | **on** | Owner-requested (2026-10-21); replaces the `TITLE_MOTION` title while on. DOM only, no shader or program key. `?flags=-TITLE_CINEMA` is the previous title |

## Results (2026-10-20)

**The owner flew the SKY work and it glitched.** On a production build of the
branch at Ultra, the owner reported near clouds with blue, purple and green
cores and fringes, a band of patchy far clouds flickering in motion, a dark line
across the clouds at the horizon, and sun rays that looked wrong. None of the
SKY work had run on a real GPU or in motion before. `LIVING_CLOUDS`,
`FAR_CLOUDS`, `LIGHT_SHAFTS` and `LENS_FLARE` went off the same hour (`79dc8ad`).
Measured causes (SKY polish): the cloud ambient was tinted by the zenith at the
eye and kept its daylight level as the sun fell, and the art's cool interiors
counted the blue twice; one far-deck sample per pixel covered 6–11 km of shell
per row near the horizon and aliased; the shafts' cancel term subtracted 3–4×
the air's own in-scatter. The horizon line was **pre-existing** (present on
`ebfb6ab` with every Living World flag off): the reconstruction dropped all four
taps on the last terrain row, where depth jumps from ~200 km to the sky's 1e6.

**The motion bar.** From then on no look flag shipped on without an integrator
check in motion on the RTX 5080: the camera held still (frame-to-frame change
over the ground and sky bands must match the arm with the flag off) and a burst
of flying frames compared magnified. Two features that had passed their
author's stills failed it on first merge and went back:
- `GROUND_MIST` popped: with the camera still, one frame changed 10.5% of the
  ground (≤0.13% with it off). The first height grid after an arrival came from
  coarse terrain with holes read as basins, and the 30 s rebuild swapped in
  within a frame. Fixed with hole filling and a double-buffered 5 s crossfade.
- `NIGHT_LIGHTS` crawled: pixel-sized sparkle decided per pixel from filtered
  radiance switched on and off in flight. Replaced by a world-fixed,
  GPU-filtered street-lamp pattern the radiance is redistributed onto.

AIRFRAME measured its own effects in motion and found five bugs no still
showed (tip ribbons facing the wrong eye after a floating-origin rebase,
shader patches dropped on every tier step, trails cut short at high refresh,
lights floating metres off the skin, vapour in a 1 g cruise).

**The capture harness** reused synthetic aircraft hexes across poses, so the
engine blended each "aircraft" across thousands of km and drew kinked and
vertical contrails; it also stepped the feed clock 5 s per 3 s poll. Fixed in
`bb06396`; the kinks were never the trails.

**A regression the gate sweep caught:** `NIGHT_SKY`'s moon edit anchored on a
line only the twilight and physical sky texts carry, so `?flags=-PHYS_SKY`
threw at load and `verify-phys-sky` crashed (12/0 on `ebfb6ab`). Fixed in
`3b36fd4`.

**Two lines of the same pass.** The cloud session was not gone: after its limit
reset it went on pushing to `claude/vigilant-newton-moag9y` (its own GROUND, SKY
tweaks, a gallery page, a Milky Way skyglow fade), none of it run on a GPU. The
owner chose this line, which lives on `claude/living-world-rtx`; the cloud
branch is left as it is. Ported from it after a check here: the skyglow fade
(`0bafd5f`, now eased so a recompute never steps the band) and the gallery page
(`fe72d8b`).

**Gallery.** `docs/reviews/living-world/` holds the 14 before/after WebP pairs
(production builds of `ebfb6ab` and the final tree, RTX 5080), `index.json` and
`notes.json`; `node scripts/build-living-world-gallery.cjs --out=<page>` builds
the page (it expects the images under `img/` beside it).

### Owner checkpoints

- The wordmark's thread through "loom" can read as a strikethrough.
- The hangar key light blows light liveries to white on the nose.
- After sunset `LIVING_CLOUDS` makes clouds darker than before (physical);
  `LIVING_CLOUDS.skyLevel` is the knob.
- The far deck at cruise is sparser and softer than the first version;
  `FAR_CLOUDS.meanCover` and `formDensity` restore presence.
- Vapour strength in hard turns (`VAPOR_FX`), and a possible hitch the first
  time an aircraft mounts while its patched programs compile.
- City lights from low altitude: the far city is brighter than the ground beneath you, and at dusk it reads pale (gallery: Manhattan at dusk).
- The reflector floor renders the hangar twice on Medium and up: frame cost.
- Every fps and feel verdict, and the iPhone, remain the owner's.

## Handoff (2026-10-20)

The cloud session that started this pass (`session_01PgZ4TGUqBRVNc2ubRY3X3V`)
hit its usage limit after pushing W0 and the SKY workstream. The AIRFRAME,
GROUND and UI work had not been pushed, so it never reached the remote and is
restarted from `4f7aff0` by a local session on the owner's Windows workstation
(RTX 5080). Two things change with that:

- **The GPU is real.** Browser smokes and captures run on hardware, so a look
  check here is a real frame. fps is still only the owner's to judge in use:
  agents run headless with other work on the machine.
- **The eight unconsumed blocks now ship `enabled:false`.** W0 seeded them ON
  with nothing reading them. Each workstream turns its block on in the commit
  that lands its consumer, so the flag never claims a look that is not there.

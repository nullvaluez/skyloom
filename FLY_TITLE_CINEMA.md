# Cinema Title — the window-seat front door (2026-10-21)

Owner request: *"Rebuild our intro and menu screens to a billion dollar game.
The ONLY part I like is that it panoramas the view of different areas."* Three
reference images (an aircraft-window dataview, an editorial landing page, a
boarding-pass hero) were given as inspiration, not as targets to copy.

**Flag:** `TITLE_CINEMA` (Living World registry, end of
`lib/fly/fly-constants.js`, read only through `lib/fly/living-world.js`),
**shipped ON** because the owner asked for it. Use `?flags=-TITLE_CINEMA` to
see the previous Living World title (`TITLE_MOTION`) for one page load. With
the flag off, the old title renders exactly as before (gate below).

## What the player sees

The live world orbiting behind the title is still the backdrop. The title now
frames it as the view from a window seat, with a dataview over it.

- **The bezel.** The screen edge darkens into a window frame with rounded inner
  corners and four viewfinder marks. A reticle marks the centre of the screen.
  The title camera looks through that point, so it is the place itself; it is
  labelled with the coordinates and the orbit radius.
- **The heading tape.** A compass tape at the top turns with the title
  camera's orbit (`runtime.titleCam.stats.angleDeg`, one transform write per
  frame, never React), with a `HDG 027°` readout.
- **Live status.** Top right: `● LIVE · 1,284 AIRCRAFT` (the real ADS-B track
  count) and the place / local time / sun chip (`title-spot`, as before).
- **The place, set large.** Lower right, like a documentary location title:
  `№ 02 / 08 — NOW SHOWING` (or `WHERE YOU LEFT OFF` at your last
  setup's spot), the name in thin Geist at up to 156 px, the region and
  coordinates in mono, the destination's own line, and a data row: local time,
  the light (Golden hour / Soft daylight / Blue hour… with the sun elevation),
  the camera's altitude, and live weather when `/api/weather` has it.
- **The world tour.** This is the panorama the owner liked, now a feature. Below
  the place are `‹ ›` and a rail of stops with the dwell filling the current
  one. The tour moves between the featured destinations. It skips the practice
  field, and in satellite it skips nature stops in deep night; city stops stay,
  because their lights are the view.
  - **The window shade.** A hop closes a frosted shade over the world. The shade
    shows the next stop's name over a blurred in-game capture of it, where one
    exists (`public/adventures/*.webp`).
  - **Streaming happens behind the shade.** Once the shade is closed, the frozen
    title flight is staged to the stop with `runtime.stageDestination`, the
    hangar's own pre-stream path. The shade lifts, with its pull tab, once that
    world reads ready.
  - **The same shade covers other waits.** It is down during the boot and while
    a hangar pick is still streaming when you come back to the title. It is
    never down longer than `shade.capSec` (30 s).
  - **When it moves by itself.** On desktop the tour advances on its own after
    `tour.dwellSec` (48 s), but only on the bare title (no sheet, journal,
    library or browser open), on a visible tab, with the player still for
    `tour.idleSec` (5 s). It never advances on phones (`autoPhone:false`),
    under reduced motion, or under automation (`navigator.webdriver`, the
    `DEVICE_TIERS` / `PLAYER_SURFACE` rule), so no harness's title spot moves
    under it; `window.__flyTitleTourAuto = true` opts a harness back in.
    `← →` or the buttons move it at any time.
  - **The far-warp overlay steps aside.** Each hop is a stage warp, which
    bumps `warpEpoch`. While the cinema title is up, `WarpFlash` keeps its
    readiness hold and bookkeeping (`worldLoading`, arrival stats, prewarm
    bypasses) but draws nothing, because the shade owns the transition.
    Without this, its "WARPING" card showed through once the shade lifted
    (caught in the recorded tour). In flight, and with the flag off, nothing
    changes.
- **The boarding pass is the one lit action.**
  - *Returning players:* **Continue** (`title-continue`). The pass shows the
    mode, aircraft and destination of the last setup or the active journey.
  - *New players:* **Fly here** (`title-fly-here`), which goes to the Free
    Flight hangar with the current stop preselected, because `defaultDestination`
    reads the staged stop.
  - The pass has notches, a perforation, a stable flight number and barcode, and
    seat **1A · Window**. Its destination changes with a split-flap animation
    when the tour moves.
  - With Continue on the pass, **Fly here** moves to the tour rail.
- **The modes are a numbered menu:** 01 Free Flight (`title-explore`), 02 Guided
  Journeys (`title-adventures`), 03 Watch an Airport (`watch-airport`,
  desktop only, by the existing policy), 04 Takeoff & Landing
  (`title-takeoff-landing`). The lit row has a cyan bar, its description and an
  arrow. Hover and focus share one highlight.
- **Keyboard:** `↑ ↓` choose, `Enter` select, `← →` places, `H` watch. Watch
  hides the interface and leaves the world, the bezel and the credit; any key
  or tap brings it back. A key-hint strip sits at the bottom right on wide
  windows.
- **Sound:** a soft sine tick when the highlight moves, and a two-note chime on
  an action (`audio-engine.js` `uiFocus` / `uiConfirm`, through `_beep`, so the
  master mute silences them). Off with `sound:false`.
- **The entrance** plays once per page load. The bezel fades in, the wordmark
  draws its contrail thread (the existing `Wordmark`), the pass and the rows
  rise at most 8 px, and the sheen crosses the pass. Exit to title returns to a
  settled title.
- **Journeys library (a menu the title opens):** with the flag on, the dialog
  becomes a full-bleed sheet. The chosen journey's capture fills it, the place
  name is set large, the routes are the title's lit rows, and the brief is one
  smoked-glass card (`cinema-menus.css`, scoped to `.tcn-sheet`).
- **Settings, Credits, Logbook, the hangar, the airport browser and the pause
  menu** are unchanged. They already carry the Living Glass and Target UI
  languages, and the title's Settings and Credits use the same glass sheets as
  before.

## Phones

- **Portrait:** the wordmark and chip at the top, the place under them, the
  world in the middle, then the pass, the mode rows, the tour rail, icon
  buttons and the credit.
- **Landscape:** the place and the tour on the left, the pass and the rows on
  the right.
- **Short phones in portrait** (667–740 px tall, such as the iPhone SE or
  mini): the data row, the pass's top line and fields, and the tour heading
  give way, and the rows tighten, so nothing leaves the screen.
- On phones the pass drops its Mode field (its label already says it), so the
  aircraft and the place stay whole.
- Solid surfaces only, with no `backdrop-filter` over the live canvas.
- Every target is at least 44 px. Settings opens as the bottom sheet docked on
  the credit strip.

## Engineering contracts

- `CinemaTitle` is mounted by FlyMode beside `TitleScreen`. `TitleScreen`
  renders nothing while the flag is on.
- The title's shared pieces are exported from `TitleScreen.jsx` with their
  markup unchanged: `Wordmark` and the Settings and Credits sheets.
- Every harness address of the old title is kept: `title-screen` (with
  `data-ready`, `data-overlay="title"`, z 45), `title-spot`, `title-continue`,
  `title-explore`, `title-adventures`, `watch-airport`,
  `title-takeoff-landing`, `title-logbook`, `title-settings`, `title-credits`,
  `title-attribution`, `settings-sheet`.
- New addresses: `title-fly-here`, `title-tour-prev`, `title-tour-next`,
  `title-hide-ui`.
- The credit strip reserve (`--fly-title-attr-reserve`) is measured exactly as
  before, so the sheets stop above Esri's credit.
- `lib/fly/title-tour.js` is pure and node-tested: the stop list, the stop
  under a position, stepping, when the tour may advance, when the shade is
  down, the tape heading, coordinates, light phrases and pass identity.
- **Seams:** no edit to `FlyScene.jsx`, `PlayerPlane.jsx`, `TrafficLayer.jsx`,
  `operations-runtime.js` or `title-camera.js`. The tour uses only the
  existing runtime API (`stageDestination`, `staging`, `titleCam.stats`,
  `geo`, `traffic`, `weather`, `audio`).
- **Edited:**
  - `FlyMode.jsx`: one mount line.
  - `TitleScreen.jsx`: the step-aside and four `export`s.
  - `AdventureExperience.jsx`: the sheet class and photo variable on the
    library dialog, flag on only.
  - `PauseMenu.jsx`: one class, flag on only.
  - `WarpFlash.jsx`: draws nothing while the cinema title is up.
  - `audio-engine.js`: two additive methods.
- **Performance (measured, fixture A/B):** the main-thread cost of the title
  matches the previous title. Each arm ran 40 s on the toy title, 1280×720,
  SwiftShader, counting long tasks and frames.
  - The previous title (`?flags=-TITLE_CINEMA`) drew 0.80–0.92 fps, with a
    longest task of 1313–1685 ms.
  - The first cinema build drew 0.57–0.60 fps, with a longest task of
    1952–2085 ms.
  - The final build draws 0.88–0.94 fps, with a longest task of
    1273–1409 ms.
  - Elimination runs found two costs. The lifted shade stayed a full-screen
    blurred composited layer, and two "live" dots pulsed forever. The lifted
    shade now goes `visibility:hidden` once its lift ends, and nothing on the
    title animates forever (gate (6e)).
  - The tape, the bezel, the scrim and the small backdrop blurs each measured
    inside the noise.
  - The film grain is the first layer of the scrim's own background. It adds
    no full-screen layer and no blend mode over the canvas.
  - Phones get no `backdrop-filter`.
  - The tape is one transform per frame on a promoted layer.
  - The polls run at 1 Hz (dataview) and 4 Hz (shade and tour).

## Verification (cloud container: SwiftShader, offline world fixture)

| Check | Result |
| --- | --- |
| `scripts/verify-title-cinema.mjs` (new, node) | **21 / 0**. RED-calibrated: an unscoped rule, a dropped testid, a wrong tape heading and an injected forever-animation each read FAIL; the gate was then restored to green |
| `scripts/verify-living-menus.mjs` (cinema pinned OFF in both arms) | **12 / 0**. The flag-off title, pause, settings and credits are byte-identical to the Living World base |
| `scripts/verify-true-earth-flags.mjs` | **8 / 0** (47 blocks; the device report lists `TITLE_CINEMA`) |
| `scripts/verify-import-integrity.mjs` | **4 / 0** |
| `scripts/verify-r25-front-door.mjs` | 68 / 2. The two FAILs are rows that diff against the `r25-w0` tag, which this clone does not have ("no W0 baseline"). The untouched base tree reads the same |
| `scripts/verify-r25-title.cjs` **phone** legs (390×844, 844×390) | **14 / 0**: every control ≥ 44 px, nothing clipped, no overlaps, credit on top, Settings sheet docked on the credit, Back closes the sheet and leaves the hangar, zero page errors |
| `scripts/verify-r25-title.cjs` **attr** leg | **13 / 0**: Logbook, Settings and Credits keep the credit visible and on top on desktop, portrait and landscape; no lock blip on the title |
| `scripts/verify-r25-title.cjs` **toy** leg, `FLY_BOOT_SCALE=3` (the R25 venue setting) | **15 / 1**. Every flow row passes: interactive before reveal, the audio unlock, the settings round trip, Esc, reveal, orbit radius 0.00 %, plane hidden, zero passport change through real soft-locks, crash disabled, Takeoff & Landing → hangar → Esc → title, KOSU flight → pause → Exit to title (blend), attribution, mountain floor, zero page errors. The FAIL is **(t3v)**, a stale harness regex. `R25_SKY` ships `enabled: true` with a comment between `{` and `enabled`, so the gate's `\{\s*enabled:\s*true` reads it as OFF and then flags the correctly shown Visuals row. `SettingsRows` is untouched |
| The same toy leg at `FLY_BOOT_SCALE=1` | (t2) and one 60 s click timed out on the starved venue. Both pass at scale 3 |
| **Final regression on the finished tree** (toy + phone legs, `FLY_BOOT_SCALE=3`) | **29 / 1**. The toy walk runs end to end, and all 14 phone rows pass. The one FAIL is the stale (t3v) regex above. An intermediate run of the pre-fix tree had lost the toy leg to a 180 s locator wait while the page's main thread was saturated. The performance fixes below brought the title's main-thread cost back to the previous title's |
| Extra layouts (the phone rules at 375×667, 667×375 and 430×932) | no small targets, nothing clipped, no overlaps |
| The automatic tour (fixture probe, short dwell pin) | It wrapped Geirangerfjord → Manhattan → Swiss Alps → Rio → Tokyo → Sydney → Dubai → Geirangerfjord. Each hop closed the shade, staged the stop and lifted, with zero page errors. Night nature stops sat out |
| eslint on every new and edited file | New files: 0 problems. Edited files: only the findings already on the base tree (FlyMode 1 error and 1 warning, WarpFlash 13, AdventureExperience 3 warnings) |

**Venue notes.**
- On this container the page's timers run seconds late. `runtime.staging`'s
  own 4 Hz poll managed 1–7 polls in 40 s, so every hop lifts only on the
  shade cap.
- At 1600×900 with video capture, a far warp held the main thread for about
  70 s. `stageDestination` itself takes 1–5 ms.
- **How the screenshots and the motion clip were made.** They show the real
  title (real DOM, tour, staging and shade logic) composited over the shipped
  in-game captures in `public/adventures/`, matched to the place the title
  reports. The live canvas was kept running at 2×2 px, because the container
  cannot render the world at a usable rate.
- Every fps, feel and look verdict belongs to the owner's machines.

## Owner checkpoints (open)

1. The tour on the RTX 5080: shade timing (`shade.*`), dwell (`tour.dwellSec`),
   and whether hops ever show streaming, which would mean `capSec` was reached.
2. Night tours in satellite: which stops read well in the dark (`NIGHT_SHOWABLE`
   in `lib/fly/title-tour.js`).
3. The place type weight (300) and size over bright scenes such as snow and
   desert; the scrim strength.
4. The UI sounds: level and character.
5. iPhone: the portrait and landscape layouts, the shade's blur cost and the
   manual-only tour.

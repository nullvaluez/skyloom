# Lounge Mobile: plan and record

> **Status (2026-10-29): BUILT and merged to `main`; ON for phones and
> tablets (`LOUNGE_MOBILE`).** Two streams built it in parallel worktrees
> against the W0 contracts below: **TOUCH** (gestures, pinch, the portrait
> field, the walk stick, motion look, haptics) and **GLASS** (the portrait
> binocular view, the phone HUD and sheets, Back, the airport browser on a
> phone). Each then reviewed the other stream adversarially, every finding was
> challenged by its author, and a fix round closed the confirmed ones. The
> Record at the end is what shipped, the evidence, the owner checkpoints and
> the known issues. Every fps, feel and look verdict belongs to the owner's
> iPhone and Android: this container has no GPU.

## The ask (owner, 2026-10-29)

> implement the lounge view into mobile so mobile devices can use this feature
> of the game. You will need to be mindful about movement and controls, and
> also ensuring there is a sleek view for mobile with how you zoom in and see
> crafts. We need to ensure the binoculars for mobile are optimal for the
> taller portrait view, and polish this so it's a new million dollar feature
> for mobile. Merge your branch into main once done.

## Where it started (evidence: `verify-lounge-mobile.cjs` baseline captures)

- **Policy.** `livingAirportsOn()` returned false on every coarse-touch
  device (`lib/fly/airport-feature-policy.js`), so phones and tablets never
  saw "Watch an airport". Three gates asserted the exclusion:
  `verify-airport-observation.mjs`, `verify-lounge-browser.cjs` and
  `verify-lounge-promotion.cjs`.
- **Portrait HUD (390 x 664).** The header's two cards, the Airports / Leave
  buttons and the director's "Next movement" card overlap; the live board
  sits on top of all of them; the ten-button footer runs off both sides of
  the screen; the status pill wraps one word per line; the attribution bar
  and the footer overlap.
- **Portrait binoculars.** `drawMask` sizes the twin lenses from the screen
  HEIGHT (`R = 0.47 h`, centres `+-0.56 R`): on a 390 px wide screen each lens
  is wider than the screen, so the mask all but disappears, and the
  magnification buttons stack down the right edge over the view.
- **Portrait camera.** The lounge keeps the desktop's 58 degree VERTICAL
  field: at aspect 0.46 the horizontal field is about 28 degrees, a slit.
- **Input.** Only one-pointer mouse semantics: no pinch, no walking without
  a keyboard (WASD), double-click timing tuned for a mouse.
- **Landscape (750 x 342).** The board and the director card cover the
  header; the dock and the attribution collide.

The orange "N 1 Insight" chip in the harness captures is the Next.js dev-tools
indicator (dev server only), not product UI: overlap checks ignore
`nextjs-portal`.

## The flag

`LOUNGE_MOBILE` (`lib/fly/fly-constants.js`, the last TRUE EARTH block):
`{ enabled: true, tablets: true }`, read only through
`lib/fly/lounge-mobile.js` (`loungeMobileOn()`, `loungeDeviceClass()`,
`loungeMobileAllowed()`). ON by default (owner-requested).
`?flags=-LOUNGE_MOBILE` restores the phone and tablet exclusion for one page
load; `window.__flyLoungeMobileOverride = { tablets: false }` keeps tablets
out. Desktop never reads the block, and every mobile-only behaviour below is
unreachable on a fine-pointer desktop.

## Rules every stream keeps

1. **Desktop is unchanged.** A fine-pointer desktop at 1920 x 1080 and
   1280 x 800 keeps today's DOM, test ids, layout, keys and mouse gestures.
   Mobile layout keys off `useDeviceLayout()` (`isTouch`, `isPhone`,
   `isTablet`, `isSheet`, `orientation`); gestures key off the pointer's own
   `pointerType === 'touch'`.
2. **Every existing test id stays.** A control may move into a sheet or menu
   on a phone, but it keeps its id.
3. **No new dependencies, no API keys, no unlicensed assets.** Icons come
   from lucide-react.
4. **Reduced motion** (`prefersReducedMotion()`, `fly-reduced-motion`) turns
   off inertia flourishes, haptics and decorative animation.
5. **Seam rule (Gate to Gate):** never edit `FlyScene.jsx`,
   `PlayerPlane.jsx`, `TrafficLayer.jsx`, `operations-runtime.js` or the
   flag registry outside your own block. If you need one of them, stop and
   report it.
6. **`next dev` rewrites `AGENTS.md`** every start: never commit that change
   (`git checkout AGENTS.md` before committing).
7. Everything in this file that says "the TOUCH stream" or "the GLASS
   stream" is a contract: change it only by updating this file in the same
   commit, and say so in your report.

## File ownership

| Stream | Owns |
|---|---|
| **TOUCH** | `components/fly/hud/lounge/LoungeSurface.jsx`, `LoungeTouchControls.jsx` (+ a new `lounge-touch.css`), `lib/fly/airport-watch-runtime.js`, `lib/fly/airport-watch-camera.mjs`, `lib/fly/lounge-walk-runtime.js`, `lib/fly/lounge/haptics.js`, new `lib/fly/lounge/touch-*.{js,mjs}`, the `MOBILE_TOUCH` block in `lib/fly/observation-config.js`, `scripts/lounge-mobile/touch-checks.cjs`, a new node gate `scripts/verify-lounge-touch.mjs` |
| **GLASS** | `components/fly/hud/lounge/LoungeHud.jsx` (incl. the slot's `blocked` prop), `LoungeOverlay.jsx`, `BinocularHud.jsx`, `LoungeHeader.jsx`, `LiveBoard.jsx`, `SpotterCard.jsx`, `SeatMenu.jsx`, `SeatsButton.jsx`, `SitPrompt.jsx`, `DecorCard.jsx`, `ObservatoryHud.jsx`, `DirectorHud.jsx`, `LoungeBridgeBar.jsx`, the lounge css (`airport-watch.css`, `lounge/*.css`, a new `lounge/lounge-mobile.css`), `components/fly/hud/AirportExperience.jsx` and `hud/airports/*` (the airport browser on a phone), the `MOBILE_GLASS` block in `lib/fly/observation-config.js`, `scripts/lounge-mobile/glass-checks.cjs`; lounge-only CSS rules for global HUD pieces that collide in the lounge (attribution, toasts) |
| **LEAD** | `lib/fly/lounge-mobile.js`, the flag, `airport-feature-policy.js`, the phone render posture (`components/fly/AirportLounge.jsx`, `lib/fly/airport-lounge.js`, `lib/fly/lounge/room-*`, `components/fly/ObservationWorld.jsx`, `components/fly/observation/*`), `scripts/verify-lounge-mobile.cjs` and `scripts/lounge-mobile/touch-driver.cjs`, this file, `CLAUDE.md`, merges |

A file outside your row: read it freely, but do not edit it. If you must, make
the smallest change, keep it in its own commit, and name it in your report.

## Gestures (TOUCH implements; GLASS writes the words for them)

| Gesture | Where | Does |
|---|---|---|
| One-finger drag | the view | Look: the world under the finger follows it (gain from the live field of view), a short glide on release (none under reduced motion) |
| Pinch | the view | Continuous zoom 1x to 25x about the fingers' midpoint. Spreading past `VIEW.optics.binocularAt` raises the binoculars; pinching back below lowers them (the wheel's semantics). A pinch may start with a finger in the walk stick's thumb zone: two fingers landing within `MOBILE_TOUCH.gesture.pinchPairMs`, the first still, are a pinch, whichever lands first and wherever (the zone relays its fingers to the glass) |
| Two-finger drag | the view | Look by the midpoint while pinching |
| Tap | an aircraft | Select it (a touch pick radius of at least 24 CSS px plus the aircraft's projected size; with the binoculars up the radius stops growing with the power, at most `MOBILE_TOUCH.pick.binocularMaxPx`, since the projected size already grows). A tap on the aircraft already selected and followed changes nothing |
| Tap | a chair / decor (standing) | Sit there / open its card (today's click) |
| Double-tap | an aircraft / empty view | Binoculars on that aircraft / raise them where you look. With the binoculars up, a double-tap lowers them, on empty glass or on the aircraft they hold; only a double-tap on another aircraft keeps them up and swings them onto it. The second tap counts when it lands on what the first one opened (the spotter card rising over the aircraft); on a control that was already on screen it is that control's tap |
| Long-press (about 0.5 s, still) | an aircraft | Its details (the `T` key) |
| Walk stick | lower-left thumb zone | Standing: analog walk once the thumb has moved past the tap slop, run past about 85 % travel, stop on release; a second finger while the thumb walks looks (in the zone or on the glass). Seated: pushing it stands you up and walks (the WASD rule) |
| Motion look | binoculars, opt-in | Device orientation steers the view 1:1, low-pass filtered, recentred when enabled; drag still adds an offset |

iOS Safari gotchas the TOUCH stream owns: `touch-action: none` on the look
surface and the stick; `gesturestart` / `gesturechange` `preventDefault`
(WebKit page pinch-zoom); `-webkit-touch-callout: none` and
`user-select: none` on the surface (no long-press callout or text selection);
no page scroll or overscroll bounce while dragging.

## Cross-stream contracts

1. **The slot.** `LoungeHud` mounts `<LoungeTouchControls runtime watch
   blocked />` once, right after the look surface. GLASS sets `blocked` true
   while a sheet or panel covers the thumb zone (the board sheet expanded, the
   spotter sheet, the seat menu, a décor card, the airport map, inspect, the
   Atlas, the airport browser, pause). Held sideways, the board, the lounge
   menu and the spotter card are side sheets clamped clear of the zone, so
   there they leave the stick up (cross-review fix, 2026-10-29).
2. **The thumb zone.** GLASS publishes two CSS custom properties on the
   `.lounge` section (phones and tablets): `--lounge-stick-bottom` (the
   distance from the viewport's bottom edge to where the free thumb zone
   starts: the dock's height, safe area included, plus a gap) and
   `--lounge-stick-left` (the left inset, safe area included). TOUCH rests the
   stick's ring at `left: var(--lounge-stick-left, 20px); bottom:
   var(--lounge-stick-bottom, 96px)` and lets a thumb start it anywhere in the
   lower-left zone above that line. While standing, GLASS keeps that zone free
   of persistent chrome; while the stick shows (seated: its Walk ring and the
   base a push draws; standing: the whole zone) the transient floats (coach
   marks, status line, lower thirds) keep out of it too. For that GLASS
   mirrors the zone's extent (`--lounge-zone-w` / `--lounge-zone-h` in
   lounge-mobile.css, from `MOBILE_TOUCH.stick.zone` as lounge-touch.css
   draws it); `scripts/verify-lounge-glass.mjs` fails if the three part ways.
3. **Motion look.** TOUCH exposes `runtime.airportWatch.motionLook`, either
   `null` (no device orientation) or `{ supported, active, needsPermission,
   enable(): Promise<boolean>, disable() }`. `enable()` must be called from
   the tap itself (iOS asks permission inside a user gesture). GLASS draws the
   toggle in the binocular view when `supported`.
4. **Haptics.** `haptic(kind)` from `lib/fly/lounge/haptics.js`, kinds
   `'tick' | 'select' | 'lock' | 'raise' | 'lower' | 'detent'`. TOUCH
   implements it (a no-op where `navigator.vibrate` is missing, as on iOS
   Safari, on desktop and under reduced motion); GLASS may call it (the focus
   wheel's detents).
5. **Magnification.** GLASS's controls call the existing
   `setMagnification(m)` / `stepMagnification(dir)` / `binoculars(force)`;
   TOUCH keeps their semantics. If TOUCH makes the binocular field of view
   aspect-aware, `optics.mag` keeps meaning "times the naked eye".
   **The lock tolerance** (added in the cross-review round):
   `runtime.airportWatch.lockTolerance()` is the aim error (radians) inside
   which the binoculars hold a lock: an eighth of the vertical field on a
   desktop (today's `camera.fov / 8`, bit for bit) and of the narrower field
   on a touch device (a portrait phone's vertical field is the wider one).
   The runtime's lock haptic and sway read it, and so do GLASS's LOCKED
   readout and lock box (`BinocularHud`, `LoungeOverlay`), so the three agree.

## The harness

`scripts/verify-lounge-mobile.cjs` (LEAD) boots an emulated iPhone 13
(390 x 664 Safari area, or `--tall` for 390 x 844; isMobile + hasTouch) through
the production flow, mocks traffic from the seat, runs each stream's
`portrait(h)` then `landscape(h)` (750 x 342) from
`scripts/lounge-mobile/{touch,glass}-checks.cjs`, turns back, leaves, and
counts page errors. `scripts/lounge-mobile/touch-driver.cjs` sends real
multi-touch through CDP (`tap`, `doubleTap`, `hold`, `drag`, `push`,
`pinch`). Run it against your own dev server:

```
FLY_URL=http://localhost:<port>/ FLY_CHROMIUM=/opt/pw-browsers/chromium \
  node scripts/verify-lounge-mobile.cjs --only touch|glass [--out <dir>]
```

The container has no GPU (SwiftShader, a few fps) and no map hosts, so the
lounge takes 1-2 minutes to validate and every capture is functional
evidence only. Frame rate, feel and look on a real phone are the owner's
verdict.

## Record

### What shipped

**The door.** `LOUNGE_MOBILE` (`{ enabled: true, tablets: true }`) lets
`livingAirportsOn()` answer true on coarse-touch devices for the lounge only
(world art and airport scenery stay desktop-only). Phones and tablets get
"Watch an airport" on the title and the Atlas pill. `?flags=-LOUNGE_MOBILE`
restores the exclusion for one page load; `{ tablets: false }` keeps iPads
out. Three gates that asserted the exclusion moved with the flag
(sanctioned): `verify-airport-observation.mjs`, `verify-lounge-browser.cjs`,
`verify-lounge-promotion.cjs`.

**TOUCH (input, camera, walking).**
- A pure gesture recognizer (`lib/fly/lounge/touch-gestures.mjs`) turns
  pointer samples into intents: look, pinch (scale = the finger-gap ratio,
  about the midpoint, panning with it), tap, double-tap, long-press. It judges
  a gesture by its events' own timestamps, so a stalled main thread can never
  turn a tap into a hold. A finger left after a pinch re-grabs where it is
  (no jump, no phantom tap); a third finger is ignored.
- The look is an exact grab: the world point under the finger stays under
  it, solved every frame by the runtime, with an exponential glide on release
  (none under reduced motion or after a paused lift).
- Pinch reuses the wheel's zoom machinery, so crossing the binocular power
  raises or lowers the glasses with their cues.
- **The portrait field.** On touch devices the naked eye keeps a 50 degree
  horizontal floor (vertical capped at 86 degrees) where the desktop's 58
  degree vertical field left a 28-36 degree slit. `fovForMag(mag, aspect)` is
  bit-identical to `58 / mag` at every aspect of 0.841 or more and whenever no
  aspect is passed, and every angle the runtime derives from the field (drag
  gain, the zoom anchor, acquire, slew, key rate) reads the field actually
  rendered.
- **The walk stick** (`LoungeTouchControls.jsx`): standing, a floating stick
  appears where the left thumb lands in the thumb zone, analog speed, run past
  85 % travel (amber ring, RUN tag), stop on release, while the other thumb
  looks. Seated, a small Walk ring stands you up (the WASD rule). The walker,
  collisions, stairs, prompts and footsteps are the existing ones; this is a
  new input (`setMoveAnalog`), and `setMoveKeys` is unchanged.
- **Motion look** (`runtime.airportWatch.motionLook`, binoculars only,
  opt-in): the phone's back axis from the full device rotation, relative to
  the pose at enable, low-pass 0.12 s with a 0.22 degree deadband, so 20x
  does not shimmer with hand tremor. iOS asks permission inside the tap.
  It switches off when the glasses come down, the page hides, or no sensor
  answers within 1.6 s.
- **Haptics** at the existing cue points (select, raise, lower, lock, the run
  threshold, the focus wheel's detents) through `navigator.vibrate`, where it
  exists: Android Chrome. iOS Safari has none, so the iPhone is silent.
- iOS Safari: no page pinch-zoom (`gesturestart`), no double-tap zoom, no
  overscroll or text selection or long-press callout on the lounge; the mouse,
  pen and keyboard paths are unchanged.

**GLASS (the view).**
- **The portrait binoculars** (`lib/fly/lounge/glass-layout.mjs` drives the
  canvas mask and the DOM bands from one geometry): upright, the two images
  fuse into ONE lens sized from the screen's width, centred on the optical
  axis the lock and the picker project through. The dark band above carries a
  live bearing tape, elevation, the power and the rangefinder (callsign, type,
  ALT / SPD / RNG / V-S in large tabular numerals, lock status). The band below
  belongs to the thumb: Lower, a log-scale focus wheel with magnetic detents at
  7x / 12x / 20x and tappable presets, and Motion. Sideways: twin lenses sized
  from the height with side columns. The desktop mask and HUD are untouched.
- **The phone HUD** (`PhoneLounge.jsx`, `data-layout` on the section; a
  desktop gets no attribute and none of the markup): a compact header with a
  menu (Airports, Leave), a thumb dock (Board, Seats, a large Binoculars
  button, Follow, More; a right-edge rail in landscape), the live board folded
  to a one-line "next movement" peek, bottom sheets (side sheets in landscape)
  for the board, the spotter card, seats, the airport map and the menu,
  first-visit coach marks in touch words, the thumb-zone contract for the
  stick, and the map credit as a measured full-width strip that nothing
  covers.
- **Back** (`use-lounge-back.js`): Android's back gesture and the browser's
  Back close the topmost lounge layer (browser, sheet, card, seat menu, map,
  binoculars, the auto director, the selection) and never leave the app.
- **The airport browser on a phone**: a full-height sheet, a featured
  carousel, region chips on one line, 44 px rows, a 16 px input, no keyboard
  popping on open.
- **Tablets** keep the desktop HUD with touch-sized targets; an upright tablet
  uses the portrait lens.

**LEAD.** The flag and policy, the harness (`verify-lounge-mobile.cjs`: an
emulated iPhone 13, or `--device ipad`, through the production flow, real
CDP multi-touch with timestamped events, a resting orientation sensor,
`h.reset()` between phases), the integration, and the phone render posture
below.

### The cross-review

Each stream reviewed the other on the integrated tree; the authoring stream
then tried to refute every finding. All 18 were confirmed (two partly). The
fix round closed the 16 owned by the streams, each with a gate that would have
caught it; the lead's two are the harness (fixed: a resting orientation
sensor and `h.reset()`) and the binoculars' masked fill (an owner-phone
experiment, below). The ones that mattered most:
- **Blocker:** entering the lounge from the Atlas's "Watch an airport" on a
  touch device dropped the player on the title. The flight HUD's Back chain
  (`hooks/use-overlay-back.js`) popped the airport browser's history sentinel
  as if it were its own, and the lounge read the resulting pop as a Back at
  its root. The two chains now tag their own entries and announce their own
  programmatic pops.
- On every phone with an orientation sensor, the portrait binocular top band
  overflowed once the Motion toggle took the side slot (the Readouts switch
  squashed to 44 x 17 px, the top row pushed under the notch). GLASS's own run
  had no sensor, so only the integrated run could show it.
- "Double-tap empty glass lowers the binoculars" could not happen in the
  portrait lens: the touch pick radius covered nearly the whole lens.
  The gesture is now: with the glasses up, a double-tap lowers them anywhere
  but on ANOTHER aircraft (that one it swings onto), and the touch pick radius
  stops growing with the power (48 px plus the projected half-span), so 63 %
  of the 23x portrait lens is empty glass, against 0 % before.
- Coach marks, the status line and the director's captions covered the seated
  Walk ring and the standing stick; they now keep out of the thumb zone, and
  sideways the sheets sit clear of it so the left thumb walks while the right
  one reads.
- Also fixed: a pinch may start in the stick's zone; a quick corrective re-tap
  on a control is never swallowed as a double-tap's second; on a portrait
  phone LOCKED, the lock haptic and auto-acquire use the narrower (horizontal)
  field (`watch.lockTolerance()`, bit-identical on desktop); the focus wheel's
  glide stops with the glasses; phones never blur the live canvas; the game's
  own reduced-motion setting drives the phone HUD; one name per action in the
  dock and the spotter sheet.

### The phone render posture (lead)

Measured on the phone path in this container (an emulated iPhone 13, the
phone tier policy, the governor held), not on a phone: the lounge at KCMH
draws **134 draw calls and 860k triangles at tier high, DPR 1.25**, against
the phone budget of 250 / 1.2M (`lib/fly/tier-budgets.js`); the room itself
is 14 draws and 157k triangles. Nothing in the render path changed for
phones. Open, for the owner's phone: the portrait binoculars render the whole
frame while 54-71 % of it sits under the mask's dark bands (scissoring the
composer to the lens is a measured experiment, not a blind change), and the
interior probe's occasional six-face refresh.

### Evidence

| Gate | Result |
|---|---|
| `node --no-warnings scripts/lounge-pass-gates.mjs` | PASS all 31 on the merged tree (W0: 29), the classic room's invariant unchanged (12 draws, 120,198 triangles) |
| `verify-lounge-touch.mjs` (node: recognizer, field identity table, grab, pinch, stick, motion math, haptics) | PASS (in the suite) |
| `verify-lounge-glass.mjs` (node: lens and band geometry, wheel, the two Back chains together, CSS contracts) | 56/56 (in the suite) |
| `verify-mobile-actions-node.mjs` (the flight HUD's Back chain, which the lounge now shares) | 17/17 |
| `verify-lounge-mobile.cjs` (iPhone 13, portrait + landscape, both modules) | Before the fix round: 136/140 (the four reds are the cross-review's findings, fixed). **On the merged tree: 266/267, no page errors.** The one red ("landscape Back chains from flight") was the check's timing, not the app: it tapped the Atlas's pill 2.5 s after a far warp, while the arrival curtain (`warp-hold`, pre-existing, it takes every tap until the area streams) was still up under SwiftShader; a lead probe on the same flow shows the curtain lifting after 15 s and the pill then opening the browser over the Atlas. The check now waits for the curtain. |
| `verify-lounge-mobile.cjs --device ipad` | First merged-tree run 67/72: three real tablet layout reds (the airport browser's 40 px region chips and 43 px close; the desktop spotter card touching the taller tablet bar at 1024 x 768), fixed in `4ab14f7`, plus two touch-check timing reds. **Rerun: 70/72, every GLASS tablet check green.** The two reds are the TOUCH tablet phase's own staging, not the app: "a tap on QAL101 selects it" (upright) found no aircraft from the check's own fixture, while a lead probe on the same upright iPad shows the overlay registering QAL101 on screen and a fingertip tap selecting it; "a one-finger drag turns the view" (landscape) read 0 degrees once and passed on the previous run (and upright on both). Open for the TOUCH check: stage the aircraft from the runner's fixture on a tablet. |
| Desktop 1280 x 800, fine pointer: the lounge's visible controls (test id, class, box, label) in four states (seated, selected, binoculars, standing), W0 vs final | Every control present in both, no page errors in either; the only differences are live content (the feed count, the director's next movement, status lines, the weather item when the forecast has or has not arrived, the spotter card mid-entry). The 1920 x 1080 leg did not validate under the box's load. |

All browser evidence is SwiftShader in a container whose map hosts are
blocked: layout, gestures and state only.

### Owner checkpoints (on a real iPhone and an Android phone)

1. Enter from the title card and from the Atlas pill; Back (Android) closes
   one layer at a time and never leaves the lounge unasked.
2. The portrait binoculars: lens size, the bands' legibility, the focus
   wheel's detents, lock on an arrival, and Motion (the iOS permission prompt,
   steadiness at 20x).
3. The feel tunables in `MOBILE_TOUCH`: drag glide 0.24 s, the stick's travel
   52 px, deadzone 0.14, run at 0.85, tap 380 ms, long-press 520 ms,
   double-tap 300 ms / 34 px.
4. Walking the pier room with the stick, up the stair, and sitting by tapping
   a chair.
5. Frame rate and heat over a 15-minute watch, portrait and landscape; the
   binoculars' masked fill (above).
6. An iPad in both orientations.

### Known issues

- **iPhone haptics are silent**: iOS Safari has no `navigator.vibrate`
  (Android Chrome vibrates). An undocumented iOS 18 workaround exists and was
  deliberately not used.
- **Motion look** was exercised with synthetic `deviceorientation` events
  only (the harness's resting sensor and the node math gates). The real iOS
  permission prompt, sensor noise and the 0.22 degree deadband's feel are the
  owner's checkpoint.
- **Lifting one finger mid-pinch** is proven in node only: CDP releases every
  finger on `touchEnd`.
- **The portrait field applies to touch devices only** (rule 1: a desktop
  never reads `LOUNGE_MOBILE`), so a desktop portrait monitor keeps the 58
  degree vertical field. One line in `airport-watch-runtime.js`
  (`touchDevice`) if that should change.
- **The auto director frames against the 58 degree base**, so in portrait an
  auto-framed aircraft fills a slightly different share of the screen.
- **The binoculars' masked fill** (above): a measured experiment on the
  owner's phone, not a blind change.
- **The 1920 x 1080 desktop census** did not validate under the container's
  load; 1280 x 800 is the desktop evidence, with each stream's own W0 A/B.
- **Pre-existing lint errors** (`LoungeHud.jsx` set-state-in-effect,
  `SpotterCard.jsx` two) are W0's, untouched.
- **Two TOUCH tablet checks are flaky** (see the iPad row): the upright tap
  check stages its own aircraft and missed it twice; the app picks it (lead
  probe).
- `next dev` (16.4.0) prints a Next.js security-upgrade notice; nothing was
  upgraded in this pass.

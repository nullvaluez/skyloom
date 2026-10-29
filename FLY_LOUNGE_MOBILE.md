# Lounge Mobile: plan and record

> **Status (2026-10-29): IN PROGRESS on `claude/lounge-mobile`.** W0
> (contracts, flag, policy, harness) is committed. Two streams build in
> parallel worktrees: **TOUCH** (gestures, walk stick, portrait camera,
> motion look, haptics) and **GLASS** (portrait binoculars, phone HUD,
> sheets). The lead integrates, owns the phone render posture, runs the gates
> and merges to `main`.

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
   Atlas, the airport browser, pause).
2. **The thumb zone.** GLASS publishes two CSS custom properties on the
   `.lounge` section (phones and tablets): `--lounge-stick-bottom` (the
   distance from the viewport's bottom edge to where the free thumb zone
   starts: the dock's height, safe area included, plus a gap) and
   `--lounge-stick-left` (the left inset, safe area included). TOUCH rests the
   stick's ring at `left: var(--lounge-stick-left, 20px); bottom:
   var(--lounge-stick-bottom, 96px)` and lets a thumb start it anywhere in the
   lower-left zone above that line. While standing, GLASS keeps that zone free
   of persistent chrome.
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

(Filled at the close: what each stream built, the gates, the evidence, the
owner checkpoints and the known issues.)

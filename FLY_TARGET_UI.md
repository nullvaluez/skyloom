# Target UI — inspect dossier, escort, Nearby

October 7, 2026. The owner's report: the inspect panel "feels old, not arcade
like"; the Nearby menu is awful; **"even if we click assist plane, it doesn't
close, doesn't do cinematic, nothing."** This pass rebuilds every surface that
deals with *another aircraft* as one system, on desktop and on phones.

## What the player sees now

**Target dossier (click a plane, T on a lock, tap the lock chip).**
- A hero stage: the real planespotters photo when one exists, otherwise the
  archetype on a lit turntable, framed by lock-on brackets that snap in, a
  scan sweep, a `LIVE · 2.4 nm` tag and the callsign set big over the stage.
- Rarity is the loot colour: the tier chip, the panel's top edge and its glow.
  A first sighting gets a stamped **NEW SPOT**.
- Four live telemetry tiles (altitude with climb/descent, speed, heading with a
  needle, range), then a *where is it from me* row — a dial pointing off your
  nose, the clock position, the height difference and whether you are closing.
- Route strip with progress, time left and ETA; the registry/transponder facts
  fold into a **Dossier** disclosure (remembered for the session).
- Two big actions pinned to the bottom (thumb reach on a phone):
  **Escort** (fly alongside, cinematic — `F`) and **Warp** (jump in behind — `G`).
  `‹ ›` (`Q` / `E`) cycles through nearby aircraft without closing.
- Desktop: a frosted dock on the right. Phone portrait: a bottom sheet you drag
  down to dismiss. Phone landscape: a full-height side dock.

**Escort — one action everywhere.** The dossier's Escort (and `F` while the
dossier is open), Nearby's *Fly alongside*, an invitation's *Fly alongside*
and the lock card/chip's Escort all do the same thing (`lib/fly/escort.js`):
1. the panel that asked closes;
2. the intercept → formation autopilot engages;
3. the cinematic camera comes in as soon as the pair can be framed (inside
   `CINEMA_FIX.engageMaxM`; a far target starts in the chase view and cuts in
   when close enough), **gliding** from the chase pose rather than cutting, with
   letterbox bars and a whoosh;
4. while far apart the cinema camera now hangs over your shoulder on the line
   to the target (*pursuit*), and swings round on an arc to the classic abeam
   wing shot as the pair closes (`CINEMA_PURSUIT` in
   `lib/fly/cinema-camera.js`). Both aircraft stay in frame the whole way:
   every blended pose is held outside the circle on which the pair would be
   wider than the frame, and the look leans toward the target only as far as
   the frame allows;
5. when it cannot start, it says why (*Take off first*, *No fresh position
   from that aircraft yet*, …) instead of doing nothing.

The escort HUD (top centre) names the phase — INTERCEPT, FORMATION or CINEMA —
the target, range and whether it is closing or opening (and how fast), the
30-second alongside timer during a Nearby crossing, and two
controls: **Cinema / Chase cam** (`C`) and **Release** (`F`).

**Nearby (`N`).** A radar-scope button beside the minimap with the count of
contacts in reach; it glows amber while an invitation waits. On touch it is an
entry in the Actions menu (*Nearby · 3*) instead, because a closed touch HUD
keeps exactly one gameplay button (`verify-mobile-actions`). The panel plots every contact on a sweep relative to your nose and lists
them as cards with one action: **Fly alongside** for live traffic (accepts the
crossing *and* starts the escort) or **Go** for discoveries; traffic also opens
its dossier. Invitations slide in with a draining 12-second timer. An accepted
experience becomes a compact mission card (gate progress or the alongside
timer, range, clock position, Photo, Leave). On phones every card sits above
the thumbstick, never on it, and the lock chip steps aside while one is up.

**Lock chip.** The soft-lock card is now actionable: desktop shows the photo or
the class silhouette, callsign, operator/type, range, altitude, route and
**Escort (F) / Details (T)**; on phones the chip's body opens the dossier and
its Escort button flies (it used to be `pointer-events: none`).

## Behaviour changes, deliberately

- **Assist could not "steal" a lock** (`verify-encounter-runtime` asserted it).
  The soft lock is automatic — any aircraft inside the 10° nose cone takes it —
  so Assist was disabled whenever anything at all sat ahead, which is exactly
  the reported dead button. An explicit Escort now replaces a soft lock. The
  gate asserts the new rule and that a refusal carries a message.
- **A completed crossing keeps the escort flying.** Thirty seconds alongside
  saves the memory and plays the activity cue; the player stays in formation
  and in the cinematic until they press Release. Leaving, a lost contact, a
  warp or a crash still hand the controls back.
- **`F` on a lock stays the plain intercept** (the camera is the player's; `C`
  toggles the cinematic). The Escort buttons are the cinematic order, and `C`
  (or the escort HUD's camera button) retires a pending cinematic request.
  `verify-mobile-actions` asserts Intercept → Cinema → cinema on the touch
  panel, which rides the same `F` press.
- **A portrait phone's wing shot backs off until the pair fits**
  (`CINEMA_PURSUIT.frameFloor`). The R19 framing range only ever capped the
  standoff, so on a 390×844 screen (~13° of horizontal half-FOV) the wing
  shot stood at separation × 1.6 with both aircraft past the frame edges.
  Desktop and landscape are unchanged (separation × 1.6 is already wider).
- **The landscape lock chip sits between the stick and the action cluster
  again.** A global touch rule stretched the info dock across the screen 12rem
  up, and its `transform: none` could not cancel Tailwind v4's
  `-translate-x-1/2` (the separate `translate` property): the chip was shifted
  half a screen off the left edge.
- **The landscape phone minimap sits below the menu button.** The Actions
  button moved to the top-right corner on touch (September's mobile controls
  pass) and its lower edge crossed the radar's R17 slot
  (`verify-mobile-layout`: *minimap × touch-fab*); the radar now starts 64 px
  down. The open Actions panel had the same collision: on a short landscape
  screen it grows to 8 px under the top edge and covered its own Close button
  (`verify-mobile-actions`: *panel is bounded and clears both controls*, red at
  568×320); it now parks left of the button.

## Contracts kept

Testids: `inspect-card/-warp/-chase/-hex/-action-notice/-photo-credit/
-photo-state/-spot-log/-reg/-model/-owner/-route/-route-unknown/
-registry-source/-sheet-handle/-turntable/-bearing/-sparkline`,
`hud-chase-chip` (opacity 1 while escorting; its text still carries
INTERCEPT/FORMATION and CINEMA), `encounter-card`, `infocard-chip`,
`infocard-photo-credit`, `touch-intercept`/`touch-cinema` (Intercept still
rides `input.press('f')`). New: `nearby-button` (desktop), `touch-nearby`,
`nearby-panel`, `nearby-contact-<id>`, `inspect-telemetry`, `infocard`. The
idle escort HUD is `visibility: hidden` after its fade, so its buttons are not
live controls on a closed touch HUD.
The dossier body stays see-through (gradient alpha ≤ 0.45) on desktop and the
dock stays a ~440 px right column with no scrim; actions still resolve through
the runtime bus at call time with one silent retry when the failure can be a
scene remount. Desktop panels keep frosted glass; phones get solid fills (no
`backdrop-filter` over the live canvas). Every touch target is ≥ 44 px.

## Files

| File | Role |
|---|---|
| `lib/fly/escort.js` | `startEscort` / `releaseEscort` / `toggleEscortCamera`, player-word reasons, `relativeTo` (clock position, bearing, height) |
| `lib/fly/cinema-camera.js` | `CINEMA_PURSUIT` over-the-shoulder framing, `glide()` |
| `components/fly/FlyScene.jsx` | honours `runtime.escort.wantCinema` (glide + whoosh), `F` sets the escort, `C` retires the request |
| `components/fly/hud/InspectModal.jsx`, `inspect/dossier-bits.jsx` | the dossier |
| `components/fly/hud/EscortHud.jsx` | escort HUD + cinematic letterbox |
| `components/fly/hud/EncounterExperience.jsx` | Nearby scope, panel, invitation, mission card |
| `lib/fly/encounter-runtime.js` | `escortActive()`, `fly(id)`; `assist()` kept as the boolean form |
| `components/fly/hud/InfoCard.jsx` | lock card / chip |
| `components/fly/hud/target-ui.css` | the shared visual system |

## Verification

**Venue truth.** The cloud container has no GPU (SwiftShader at ~1–3 fps) and
is blocked from Esri, OpenFreeMap and the ADS-B feeds, so everything below ran
on the offline world fixture with injected aircraft. Feel, fps and the look of
the cinematic belong to the owner's machines.

**Node gates, green on this tree:**
- `verify-escort` **10/10** (new): every refusal carries a reason and a
  sentence; a started escort requests the cinematic, `C` and Release hand
  control back; the runtime bus wins over a stale handle; clock positions and
  height deltas; the rig frames both aircraft as a converged pose on 16:9,
  390×844 and 844×390 at seven separations × three bearings; far pairs film
  over the shoulder; inside `wingM` the desktop wing shot is the classic pose;
  the blend has no jumps; and **every frame of five simulated live escorts
  per aspect** (closing, crossing, target below, a 90 s formation that runs
  the orbit drift all the way round, a pair opening again) keeps both aircraft
  in frame — worst |NDC| 0.81 desktop, 0.89 portrait, 0.75 landscape.
- `verify-encounter-runtime` (explicit escort replaces a soft lock, requests
  the cinematic, explains a refusal), `verify-encounters` 10/10,
  `verify-import-integrity` 4/4, `verify-mobile-actions-node` 17/17,
  `verify-adventures` 15/15.
- **Red before this pass, identically on a clean `origin/main` worktree:**
  `verify-cinematic-earth` (its frozen copy of the fighter's manifest entry),
  `verify-r25-front-door` 68/2 and `verify-r25-flight-plan` (both read the
  local-only `r25-w0` tag, absent from this clone).

**Browser gates on this container (software GL, tile hosts blocked):**
- `verify-mobile-layout` (390×844 and 844×390): every layout gate green in both
  orientations — chip and stick disjoint (landscape chip now
  [252–592 × 298–350], it was shifted over the stick), no zone overlaps (the
  landscape *minimap × touch-fab* red is fixed), toasts, 44 px targets, pause,
  logbook sheet. Its only red is *zero pageerrors*: troika-three-text's
  fallback-font lookup fetches `cdn.jsdelivr.net`, which this container blocks
  (stack-attributed; not this pass).
- `verify-mobile-actions` boots **satellite**, which never reaches boot 100 %
  here — identically on the pre-change tree (control run: *mobile boot timed
  out*, 0 gates). A scratch copy that boots the toy style
  instead passes **515 gates** across 10 sizes × 2 styles — one gameplay button
  on a closed touch HUD, panel geometry (the landscape panel fix included),
  44 px targets, Intercept → Cinema, multi-touch, Back — and its one red is the
  same blocked font fetch.

**Browser, fixture (a scratch screenshot rig, not a gate):** desktop 1440×860,
iPhone 390×844 and 844×390. Nearby → *Fly alongside* closes the panel, engages
the intercept and cuts to the cinematic (`cameraMode: 'cinema'`); the
dossier's Escort does the same; Release hands back the chase camera; zero page
errors on every run. Read off the live camera in landscape at 1.6 km: player
(0.72, −0.21), target (−0.46, 0.13) NDC — the node simulation's numbers.

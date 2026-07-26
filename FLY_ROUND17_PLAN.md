# FLY ROUND 17 — "Your Wings" — PLAN

> Player Hangar (selectable aircraft with distinct flight feel) · Progression
> repair + Living-world contracts + Daily set · Photo mode · FULL mobile UI
> overhaul (portrait + landscape). Five Opus 5 agents in two waves under Fable
> orchestration. Plan authored 2026-07-25 after a 3-explorer + 3-designer
> pass; every claim below was verified against the code by the design agents.

## 0. Why this round

R11–R16 built a living satellite world; the *player-facing game layer* lags it:

1. **You can't change your aircraft** — the same 20 m fighter since R8, yet the
   coupling is one manifest entry + a single-alias flight model, and 8
   already-licensed CC-BY GLBs sit on disk.
2. **Session goals are thin, progression inert** — contracts: 11 templates,
   deterministic starting set, session-only progress, points never spent.
   Found bugs: `concorde_heir` has no unlock case; squawk badges +
   `emergencyCount` unreachable (logSpot never passed squawk); persisted spot
   rarity ≠ displayed rarity; `CLASSIFICATION_RARITY` still keys the deleted
   2D vocabulary so airliner/jet/prop/glider/drone score base 0. Weather, the
   real sun, and 1,900+ tagged POIs feed zero gameplay.
3. **Mobile UI is broken by construction** — 15 overlays as siblings each
   hard-coding a corner; two disagreeing phone definitions (landscape phones
   get touch controls + desktop HUD); badge toasts overflow ~180 px; the
   InfoCard covers the joystick and steals steering; no touch path to F/C/T/L
   while the phone HUD prints "C to exit"; LabelCanvas's window-level
   pointerdown opens inspect from a joystick touch; Atlas can't zoom on touch;
   `globals.css` has zero @media/safe-area/touch rules. verify-mobile proves
   controls *function*, never that anything *fits*.

## 1. User decisions (locked 2026-07-25)

- Aircraft: selectable fleet, **distinct flight feel** per aircraft; **reuse
  existing GLBs only**.
- Unlocks: **everything free this round**; manifest reserves `unlock: null`
  for a future economy round.
- Features: progression repair + living-world gameplay + photo mode.
  (Session-summary explicitly not selected.)
- Mobile: **full overhaul**, portrait AND landscape, plus a measuring layout
  harness.
- Execution: max 5 Opus 5 implementation agents; Fable orchestrates/reviews.

## 2. Hard constraints (violating any = regression)

No API keys · no r3f-perf · never per-frame data through React state/zustand
(runtime + refs) · all tunables in `lib/fly/fly-constants.js` · CC-BY credits
from the single `lib/fly/assets.js` manifest · Esri attribution visible in
EVERY UI state · pinned three/r3f/drei · harness testids frozen ·
**default = bit-identical** (no saved aircraft pick ⇒ the fighter, value-
identical; bootFly never seeds `fly-aircraft`) · `TRAFFIC_MODELS` length
stays 13 (`verify-warbirds.mjs` gates it) — the player fleet is a NEW
`PLAYER_AIRCRAFT` array in a NEW file.

## 3. W1 — Player Hangar & Fleet (Agent A1)

**Fleet: 9 aircraft, helicopter excluded** (fixed-wing coordinated-turn model
can't hover; the traffic heli rotor is static geometry — future round with a
`hover` capability flag).

- NEW `lib/fly/player-aircraft.js` (NOT assets.js — `verify-fleet.js` counts
  `{ url: '/models/` literals there): `PLAYER_AIRCRAFT` entries
  (id/name/blurb/url/targetLenM/yawFixRad copied verbatim from
  `TRAFFIC_MODELS`/canopyMaterial/forceVertexColors/`unlock: null`),
  `AIRCRAFT_KEY='fly-aircraft'`, `resolveAircraft(id)`,
  `resolveInitialAircraft()`, `saveAircraft(id)`. Numbers in a new `HANGAR`
  block in fly-constants (incl. `enabled: true` = one-flag rollback).
  **Fighter gets NO override block** (statically gated).
- Fleet (speeds slow/cruise/boost m/s · camScale · fx): fighter 60/180/750
  ·1.0· AB + twin contrail (unchanged); military "Talon" 65/200/750 ·0.95·
  AB, single contrail; warbird-jet 55/160/420 ·0.85· scaled AB; warbird-prop
  45/115/165 ·0.80· none; prop 30/60/95 ·0.75· none; glider 22/38/58 ·0.75·
  none + wind-only audio; bizjet 55/150/255 ·1.0· twin contrail; airliner
  75/240/310 ·2.4· twin span 22; cargo 75/250/310 ·2.8· twin span 30. Preset
  KEYS ('slow/cruise/boost') never change.
- **Seam = `flight.cfg`**: `FlightModel.constructor(cfg = FLIGHT)`; `step()`
  reads `this.cfg`; `setConfig()` clamps speed into the new envelope.
  Consumers read `flight.cfg`: chase-camera (× `cameraOffsetScale`),
  autopilot, FlyScene warp seeding, audio-engine via discrete `setProfile()`
  (identity default = bit-identical DSP; 'prop' thrum LFO, 'heavy' hz/sub
  multipliers, 'wind' zeroes engine).
- Mid-session switch: keep pos/heading/pitch/bank, no respawn; PlayerPlane
  remounts via `key={aircraftId}`; speed eases through the normal accel path.
- PlayerPlane: `aircraft` prop replaces the 6 `PLAYER_MODEL.*` reads;
  vertexColors = `entry.forceVertexColors || geometry.hasAttribute('color')`
  (flat-white-hull guard); afterburner conditional + per-aircraft ramp;
  module-scope preload stays fighter-only, saved pick preloads pre-mount in
  FlyMode. Contrail takes a `contrail` prop (backM ≈ 0.6×len); ground shadow
  takes `radiusM`.
- Persistence: exact fly-settings pattern (pre-canvas-mount resolve in
  FlyMode, never write back a default). Store: `aircraftId` + `hangarOpen`
  in `initialState`; Esc chain slot.
- UI: NEW self-contained `components/fly/hud/HangarPanel.jsx` (fullscreen
  overlay, `useSheetLayout()` phone sheet, ≥44 px targets, stat bars +
  ModelTurntable preview via new optional `entry` prop) + one PauseMenu
  button. No keyboard shortcut this round.
- NEW `scripts/verify-hangar.js` (~13 gates, static + browser; see §7).
- Accepted quirks: traffic ×1.75 display scale vs player true scale;
  slow aircraft can't close autopilot intercepts.

## 4. W2 — Progression repair + Living contracts (Agent A2) · Photo (Agent A3)

Verified corrections that shaped this: toy has NO live `runtime.sun` → night
contracts gate on satellite exactly like weather; `verify-warbirds.mjs` e0
hard-pins `classBase.prop/jet === undefined` → deliberate re-baseline;
`verify-logbook.js` pins 24 badge cards → 26; photo capture must read the
canvas same-rAF AFTER the EffectComposer pass (preserveDrawingBuffer false).

### A2 — repair + living world

- NEW `lib/fly/spot-attrs.js` — one `trackSpotAttrs(track, geo)` (squawk,
  category, gs kt, alt ft) used by ALL THREE sites: FlyScene logSpot,
  InspectModal logSpot + displayed-rarity memo, SpotToast SPICY scan →
  persisted ≡ displayed rarity by construction; squawk badges reachable.
- passport-store: `emergencyCount` derives from squawk ∈ {7500,7600,7700}.
- badges: `concorde_heir` real `SUPERSONIC_TYPES` case; `vip_spotter` re-keyed
  (SAM/AF1/AF2/EXEC callsigns or VC25/C32/C37/C40); NEW `daily_streak_30`
  (gold) + `daily_streak_100` (platinum) + progress entries.
- rarity: CLASSIFICATION_RARITY adds ONLY airliner 10, jet 15, prop 10,
  glider 45, drone 50 (legacy 2D keys dormant; military/heli/cargo/warbirds
  untouched). SPICY analysis: A380 = 50 rare (no ping flood); new intended
  ping = 7700 airliner at 90 legendary. History NOT migrated.
- Contract persistence: NEW `lib/fly/contract-progress.js`, sibling key
  `fly-contracts-active-v1` (the `fly-contracts` envelope is a harness
  contract), debounced saves from event context + pagehide; lazy-initializer
  restore in Contracts.jsx stateRef. Surface `completedCount` + streak in one
  added header line (testid `contracts-completed`).
- Living engine: `spotAdvances(contract, spot, ctx)` + pure
  `contractEligible(tpl, ctx)`; `requires` descriptors; rotation skips
  ineligible; stale-ineligible actives rotate out after
  `CONTRACTS_LIVING.staleSwapSec` (30).
- 9 templates appended AFTER `touch-go`: storm-chaser 300 · ifr-legs 250 ·
  wind-rider 250 · above-weather 200 · night-spots 250 · night-buzz 350 ·
  visit-boneyard 300 · visit-factory 300 · overfly-hotspot 200 (verify
  poiSlots carries hotspots, else a 1 Hz bbox scan over the 30 hotspots).
- Daily set: NEW zero-import `lib/fly/daily.js` (`mulberry32(utcDayNumber)`,
  2 picks from mechanical templates only, world-identical, honors
  `window.__flyDayOverride`); daily row pays pts × 2; persisted with dayKey
  rollover.
- Contract-complete toast via the R16 deferred `pendingRef` queue;
  `addCompletion(pts, meta)` sets transient `lastCompleted` (partialized out).
- NEW `scripts/verify-daily.mjs` + `scripts/verify-living-contracts.js`;
  sanctioned re-baselines: verify-warbirds e0/BASE_MAP, verify-logbook badge
  count 26.

### A3 — photo mode

- `cameraMode: 'photo'`; flight keeps flying, stick neutralized (extend the
  FlyScene neutralize condition); NOT phase:'paused'.
- NEW `lib/fly/photo-camera.js` (chase-orbit pose, persistent yaw/pitch,
  wheel zoom `PHOTO.minDistM..maxDistM`); input-controller wheel
  `consumeZoom()` + button-0 photoLook; `P` toggle via `consumePress('p')`;
  Esc-chain slot after inspect.
- HUD hidden (not unmounted) via one wrapper; **AttributionBar always
  visible**. NEW `PhotoModeBar.jsx` (shutter/exit, 44 px).
- NEW `components/fly/PhotoCapture.jsx` in-Canvas: runtime-bus `capturePhoto`;
  `useFrame` priority 100 reads `gl.domElement.toBlob` same task
  post-composer; one-shot 2D canvas bakes `ATTRIBUTIONS_BY_STYLE[mapStyle]`
  bottom-left; `navigator.share` (files) else download; `__flyStats.photo`.
- NEW `scripts/verify-photo.js`.

## 5. W3 — Mobile UI full overhaul (Agents A4+A5, Wave 2 — AFTER Wave 1 merges)

- **D1 zone system**: NEW `components/fly/LayoutRoot.jsx` — named absolute
  zone containers carrying EXACTLY today's desktop offsets (hoisted, not
  redesigned → desktop byte-identical by construction); phone/landscape via
  Tailwind v4 custom variants `phone:`/`phone-land:`/`phone-port:` keyed off
  `data-device`/`data-orient`; zones: toasts, contracts, minimap,
  controls-left/right, info-dock, attribution, exit; modals/flash stay
  siblings with `data-overlay`; dev registry `window.__flyZones`.
- **D2 unified hook**: `hooks/use-device-layout.js` →
  `{isTouch, isPhone, isTablet, orientation, isSheet}`; `isPhone` delegates
  to `isPhoneClass()`; `isSheet = isPhone || width ≤ 639` (union — landscape
  phones finally get sheets, narrow desktop unchanged); old hooks become thin
  wrappers; `max-sm:` composed with, never replaced.
- **D3**: touch actions ride `InputController.press(key)` into the existing
  `consumePress('f'|'c')` machines; dead `setBoost()` gets wired (momentary
  BOOST), not deleted.
- Migrations/fixes: SpotToast → toasts zone, two-line phone cards (stack
  logic + `__flyStats.toastCount` + testids byte-preserved); InfoCard → phone
  compact chip that opens the InspectModal sheet (desktop card unchanged;
  chip/joystick disjoint BY CONSTRUCTION, harness-asserted); Contracts
  landscape chip; InspectModal landscape right-dock; Logbook landscape
  100svh sheet; banners/boot `clamp()` fluid type + phone particle cuts;
  PauseMenu scrollable ≥44 px (landscape Exit reachable); Credits width
  clamp; Atlas no-autofocus on touch + ≥44 px + pinch-zoom/pan/22 px picks +
  zoom buttons; LabelCanvas 30 Hz on phone, no F/T reticle hints on touch,
  POI tap-tooltip, hit-exclusion guard; `.hud-glass` (desktop blur, phone
  solid); chase chip stops advertising "C" on touch.
- Bug fixes: TouchControls `stopPropagation()` + LabelCanvas `[data-zone]/
  [data-overlay]` exclusion (joystick can't open inspect); Atlas autofocus
  gated off touch.
- New touch buttons (from `MOBILE_UI.cluster`; photo plugs in as one entry):
  LOOK · ATLAS · LOGBOOK · PAUSE persistent; BOOST momentary; contextual
  INSPECT/INTERCEPT/CINEMA on lock. `hooks/use-overlay-back.js` — Android
  back replays the Esc chain.
- globals.css: additive ~60-line block only. fly-constants gains `MOBILE_UI`.
- NEW `scripts/verify-mobile-layout.js` (390×844 AND 844×390 via new
  `LANDSCAPE_CTX`): no horizontal overflow, zone-pair disjointness, toast
  stack in-bounds under load, ≥44 px on every visible pointer-events-auto
  control (allow-list: attribution/photo-credit), landscape pause Exit
  reachable. verify-mobile.js extended (contextual buttons via injected lock,
  boost hold, tap-leak regression, no-autofocus, pinch, history-back).
- Frozen contracts: all harness testids; `.bottom-2.left-2` AttributionBar
  (verify-fly-style); `.fixed.inset-0 canvas`; `window.__flyBoot/__fly/
  __flyStore/__flyStats.toastCount`; verify-logbook phone-sheet box gate.
- Split: shared foundation first (A4), then A4 layout & surfaces ∥ A5 input &
  interaction (disjoint files). Desktop suite runs FIRST as the Wave-2
  regression gate — zero re-baselines allowed there.

## 6. Waves, merges, ownership

- **Wave 1**: A1 (hangar) ∥ A2 (progression+living) ∥ A3 (photo), each in an
  isolated worktree; Fable merges **A2 → A1 → A3**. Known small overlaps
  Fable arbitrates: FlyScene (A1 mount/cfg/neutralize · A2 logSpot line ·
  A3 P-toggle/camera/neutralize — the neutralize condition gains BOTH terms),
  FlyMode Esc chain (final order: inspect → photo → atlas → logbook → hangar
  → credits → pause), fly-constants (three additive blocks), fly-store.
- **Wave 2**: A4 lands the foundation (desktop suite green on it alone), then
  A4 ∥ A5 on disjoint file sets. A4 also migrates Wave-1 additions
  (HangarPanel/PhotoModeBar polish, photo touch button, contract toast card).
- Browser harnesses run centrally on :3000 by Fable post-merge; agents run
  node-only gates in their worktrees (junction node_modules from the main
  checkout) and may use ad-hoc dev servers on ports 3101–3103 for spot
  checks.

## 7. Harness matrix

NEW: verify-hangar.js · verify-daily.mjs · verify-living-contracts.js ·
verify-photo.js · verify-mobile-layout.js. EXTENDED: verify-mobile.js.
DELIBERATE re-baselines (the only two): verify-warbirds.mjs (e0 flip +
BASE_MAP prop 10/jet 15 + e1/e2 histogram), verify-logbook.js (badge cards
24 → 26). Everything else must pass unchanged — full sweep between waves and
at close; screenshots both phone orientations.

## 8. Deliverables

FLY_ROUND17.md round record with § user-checkpoint tables (hangar feel per
aircraft, contract pacing/daily set, photo output, mobile before/after both
orientations, glass→solid phone look) + lessons; CLAUDE.md notice; memory
update post-merge.

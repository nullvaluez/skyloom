# FLY ROUND 17 — "Your Wings" — ROUND RECORD

> Built 2026-07-25. Plan: [FLY_ROUND17_PLAN.md](FLY_ROUND17_PLAN.md). Five
> Opus 5 agents in two waves under Fable orchestration (A1 hangar · A2
> progression/living contracts · A3 photo mode ∥ then A4 mobile layout ·
> A5 mobile input), each in an isolated worktree, merged and integration-
> arbitrated by Fable. Full sweep green at close (§5). User checkpoints §6
> PENDING.

## 1. Player Hangar (A1)

The player can finally change aircraft. **9 selectable airframes**, every one
reusing an already-licensed CC-BY GLB (zero new licensing work; helicopter
deliberately excluded — the fixed-wing coordinated-turn model can't hover;
future round with a `hover` capability flag).

- NEW `lib/fly/player-aircraft.js` — the fleet manifest (kept OUT of
  assets.js so `verify-fleet`'s model-count arithmetic never moved):
  Vector (the R8 fighter, default), Talon (military), Dart (warbird-jet),
  Mustang (warbird-prop), Skylark (prop), Whisper (glider), Meridian
  (bizjet), Stratoliner (airliner 57 m), Leviathan (cargo 747 70 m). Each
  entry reserves `unlock: null` for a future economy round — everything is
  free this round by user decision.
- **Distinct flight feel** via the new `flight.cfg` seam: `FlightModel`
  takes a constructor config; chase camera, autopilot, warp seeding and the
  procedural audio engine all read the aircraft's own envelope (glider =
  wind-only audio; heavies get sub-heavy engine beds and 2.4–2.8× camera
  standoff; the Dart's afterburner lights at ITS 200 m/s, not the fighter's
  250). Preset keys 1/2/3 unchanged — only the values differ per aircraft.
- Mid-session switch keeps position/heading; PlayerPlane remounts on
  `key={aircraftId}`; speed eases into the new envelope through the normal
  accel path. Per-aircraft contrails (span/backM ≈ 0.6×length), ground-shadow
  radius, vertex-color liveries (the flat-white-hull trap guarded by
  geometry-derived `hasVC` — military camo confirmed by screenshot gate).
- Hangar UI: `components/fly/hud/HangarPanel.jsx` (PauseMenu → "Hangar",
  stat bars, drag-to-spin `ModelTurntable` preview via its new optional
  `entry` prop), phone sheet, ≥44 px targets. Persistence = the exact
  `fly-settings.js` pre-mount pattern (`fly-aircraft` key; a default is
  never written back).
- **Default = bit-identical**: no saved pick ⇒ the fighter with
  value-identical config (statically gated); bootFly never seeds the key, so
  every pre-R17 harness passed unchanged. Rollback = `HANGAR.enabled: false`.
- NEW gate `scripts/verify-hangar.js` (16): manifest/credits/no-override
  statics + browser (default boot, seeded picks, per-aircraft speeds, glider
  fx absence, livery vertexColors, mid-session switch continuity,
  persistence roundtrip, draw delta, pageerrors).

## 2. Progression repair + Living contracts (A2)

**Repair (bugs found in the round-open exploration, all fixed):**
- NEW `lib/fly/spot-attrs.js` — ONE `trackSpotAttrs()` used by all three
  spot/rarity call sites (FlyScene acquired-logSpot, InspectModal logSpot +
  displayed-rarity, SPICY scan) → persisted rarity ≡ displayed rarity by
  construction, and squawk finally reaches badges + rarity. The three squawk
  badges (`emergency_witness`/`hijack_alert`/`radio_failure`) and
  `stats.emergencyCount` are now reachable; gs/alt rarity bands are live.
- `concorde_heir` had NO unlock case since its creation — real
  `SUPERSONIC_TYPES` case now (CONC kept deliberately: it's the badge's
  namesake and an audited EXACT_TYPE_BONUS entry). `vip_spotter` re-keyed to
  the USAF VIP fleet + SAM/AF1/AF2/EXEC callsigns ('government' class never
  exists in the Fly worker). NEW `daily_streak_30` (gold) + `daily_streak_100`
  (platinum). Badge cards 24 → 26 (verify-logbook re-baselined, sanctioned).
- `CLASSIFICATION_RARITY` finally speaks the Fly vocabulary: airliner 10,
  jet 15, prop 10, glider 45, drone 50 (an A320 is no longer rarity 0; an
  A380 is a 50 rare). New intended SPICY ping class: a 7700-squawking
  airliner = 90 legendary. No history migration — the player's logbook is
  not rewritten. verify-warbirds e0/BASE_MAP re-baselined (sanctioned;
  measured histogram in the commit — 72 of 170 warbird codes ride the
  'prop' archetype, not the ~15 the plan guessed).
- **Contract progress persists** (`fly-contracts-active-v1`, debounced
  event-context saves + pagehide, validated lazy restore incl. poolIdx;
  the R6 "no store writes in updaters" discipline kept). `completedCount`
  + day streak surfaced in the panel header (`contracts-completed`).

**Living world:** 9 templates appended after `touch-go` (wheel order + initial
slice(0,3) preserved): storm-chaser · ifr-legs · wind-rider · above-weather ·
night-spots · night-buzz · visit-boneyard · visit-factory · overfly-hotspot.
`contractEligible(tpl, ctx)` gates dealing on live conditions — **toy style
never deals a weather/night contract** (toy has no `runtime.sun` and never
fetches weather); stale-ineligible actives rotate out after 30 s. **Daily
set**: `lib/fly/daily.js` `mulberry32(utcDayNumber)` picks 2 mechanical
templates — world-identical per UTC day, no server, pays ×2, persists with
dayKey rollover; `__flyDayOverride` is the determinism hook.
Offer thresholds are deliberately looser than progress thresholds
(precip .15/.35, fog .2/.45, wind 10/15, overcast .4/.6).
NEW gates: `verify-daily.mjs` (28, node) + `verify-living-contracts.js` (16,
weather/sun/day pinned per-case). Contract-complete toasts ride the R16
deferred queue; spot/spicy/buzz push paths byte-preserved.

## 3. Photo mode (A3)

`P` (or the touch PHOTO button) → orbit camera around the plane (persistent
yaw/pitch, wheel/pinch zoom 25–600 m), flight keeps flying with the stick
neutralized (the instructor levels off), HUD hides via four
`display:contents`/`hidden` wrappers (nothing unmounts — contract progress
and toast queues survive; paint order untouched) — **AttributionBar stays
visible, always**. Shutter captures the POST-PROCESSED frame (same-rAF
`drawImage` after the EffectComposer pass — `preserveDrawingBuffer` stays
false) onto a one-shot 2D canvas that bakes the style's real attribution
text bottom-left; `navigator.share` on mobile, download elsewhere.
`photo.handoff()` hard-cuts the chase rig on exit (the damped pose is stale
by the distance flown while composing). NEW gate `scripts/verify-photo.js`
(10) incl. PNG-magic + watermark + heading-stability-under-drag.

## 4. Mobile UI overhaul (A4 + A5)

The structural fixes for "truly awful, crammed, and things even overflow":

- **One device truth**: `hooks/use-device-layout.js` —
  `{isTouch, isPhone, isTablet, orientation, isSheet}`; `isPhone` delegates
  to the perf layer's `isPhoneClass()`; `isSheet = isPhone || width ≤ 639`
  (**union** — landscape phones finally get the sheets; narrow desktop
  unchanged). `use-is-touch`/`use-sheet-layout` are now wrappers over it.
- **Named layout zones** (`components/fly/LayoutRoot.jsx` + `MOBILE_UI.zones`)
  carrying today's desktop offsets VERBATIM — desktop byte-identity was
  *measured*, not asserted (nine-surface bounding-box + computed-style A/B
  against the pre-migration build: identical). Phone/landscape geometry via
  Tailwind v4 `phone:`/`phone-land:`/`phone-port:` variants keyed off
  `data-device`/`data-orient`. Dev registry `window.__flyZones`.
- **The overflows are dead**: SpotToast = full-width two-line phone cards
  (widest measured 262/390); InfoCard = a 48 px chip that opens the inspect
  sheet (desktop card unchanged); CreditsPanel width-clamped; Arrival/Warp
  banners + Boot wordmark on `clamp()` fluid type (desktop resolves to the
  exact old sizes); BootScreen particles 70/9 → 28/5 on phone; PauseMenu
  scrolls (landscape "Exit Fly Mode" reachable — previously unreachable).
- **The touch scheme is complete**: persistent LOOK · ATLAS · LOGBOOK ·
  PHOTO · PAUSE cluster + momentary BOOST (the dead-since-R9 `setBoost` is
  finally wired) + contextual INSPECT/INTERCEPT/CINEMA on lock (they ride
  `input.press()` into FlyScene's existing key state machines — one state
  machine, not two). Atlas: pinch-zoom + pan + 22 px touch picks + zoom
  buttons + no more iOS keyboard pop (autofocus gated); Android back closes
  overlays (`hooks/use-overlay-back.js` sentinel history entry); POI letters
  answer to a tap with the hover tooltip; the phone reticle stopped
  advertising F/T keys; LabelCanvas runs 30 Hz on phones.
- **The tap-leak bug is fixed twice over**: TouchControls stops propagation
  AND LabelCanvas ignores `[data-zone]`/`[data-overlay]` targets — a thumb
  on the joystick can no longer open the inspect card (regression-gated by
  an in-page listener assertion). Note: the exclusion guard also fixes a
  desktop click-through (minimap/InfoCard clicks opening planes behind
  them) — the one deliberate desktop behavior change, harness-green.
- **Phone compositing cost**: `.hud-glass`/`.hud-flat-phone` — desktop keeps
  its blur + INK gradients untouched; phones drop `backdrop-filter` for
  solid translucency (the single most expensive mobile path over live WebGL).
- **Integration arbitration** (Fable, post-merge, all caught by the new
  gate): throttle detents to `min-h-11` (measured 39–40 px); landscape rides
  the contextual buttons IN the persistent row (stacked, the column top hit
  the minimap band); **portrait contracts joins landscape in collapsing to
  the tap-to-expand chip** — the full panel with daily rows measured bottom
  478 px, through the info-chip dock, and a collapsed chip is also simply
  the right answer to "crammed"; info-chip dock recomputed 15.5 → 24.5 rem
  for the real cluster stack.
- **NEW gate `scripts/verify-mobile-layout.js`** — the harness this UI never
  had: boots **390×844 AND 844×390**, measures (not asserts) no horizontal
  overflow, zone-pair disjointness via `__flyZones`, toast-stack fit under
  badge+spot load, ≥44 px on every visible control (allow-list: attribution
  + photo-credit micro-links; Atlas chips held at 36 px, documented),
  landscape pause/logbook reachability, zero pageerrors.
  `verify-mobile.js` grew to 28 gates (contextual buttons via injected lock,
  boost hold/release, tap-leak regression, autofocus, pinch telemetry,
  history-back).

## 5. Verification at close

- **Final sweep: 42 browser harnesses + 3 node gates, ALL GREEN** (39/42 on
  the sweep pass; verify-edge-fx (tracer cv 0.199 under a ~731-aircraft
  Friday-evening sky), verify-sat-buildings (SF DEM probe sampled a
  still-streaming z15 tile) and verify-weather (rim gradient under a live
  state) each passed on immediate re-run — the documented live-environment
  flake classes, none with a causal path from this round's diffs. Mid-round,
  verify-chase-cam / verify-inspect-actions showed the same class once each.)
  Evidence screenshots in scripts/ are refreshed from the green merged-tree
  runs (the R15 convention).
- **Sanctioned harness changes, all evidence-backed**: verify-warbirds
  e0/BASE_MAP (rarity re-base), verify-logbook badge count 24→26,
  verify-sat-night probe isolation + demotions (§7 lesson 1 — control-
  experimented against the pre-R17 build), verify-mobile extension,
  verify-mobile-layout NEW.
- Environment incident, resolved: the shared `node_modules` at the repo root
  was found damaged mid-round (missing `.bin` + 44 packages; playwright
  never was a project dep — it resolves from the user-home install).
  Repaired via `npm ci` from the pinned lockfile.

## 6. USER CHECKPOINTS — PENDING (the next session's agenda)

Fly it and judge. Every default is tunable (`HANGAR`, `CONTRACTS_LIVING`,
`PHOTO`, `MOBILE_UI` in fly-constants.js).

| # | Checkpoint | Where |
|---|---|---|
| 1 | Each aircraft's FEEL: Leviathan's mass, Whisper's float, Skylark's putter, Dart's snap — and the camera standoff per airframe | Pause → Hangar, fly each |
| 2 | Mid-flight aircraft switch: continuity vs jarring | Hangar while cruising |
| 3 | Hull liveries: Talon camo, Leviathan livery, warbirds — no white hulls | satellite noon |
| 4 | Rarity feel post-re-base: are spot toasts better-distributed? Does a 7700 airliner SPICY ping feel right? | normal spotting |
| 5 | Daily contracts: the ×2 pay, the day-rollover, "same everywhere" | contracts panel, two days |
| 6 | Weather/night contracts: do they DEAL at sensible moments (storm-chaser only when rain is actually near)? staleSwapSec 30 feel | satellite, live weather |
| 7 | Photo mode: framing, orbit feel, zoom range, the baked credit, share-sheet on phone | P / touch PHOTO |
| 8 | Phone portrait: the collapsed contracts chip, the info chip, toast width, cluster reach | real phone |
| 9 | Phone landscape: the full layout (first time it has one) | real phone rotated |
| 10 | `.hud-glass` solid-vs-blur look on phone panels | real phone |
| 11 | Touch: BOOST hold, contextual INSPECT/INTERCEPT/CINEMA appearing on lock, Atlas pinch, Android back | real phone |
| 12 | Real-notch safe-areas (Playwright reports env() as 0 — base offsets certified, notches are yours to eyeball) | real phone |
| 13 | Low-tier phone: silhouette instead of turntable in the inspect sheet | old phone / tier low |
| 14 | R15 §6 + R16 §6 carried checkpoints remain open alongside these | those tables |

## 7. Lessons

1. **A pixel-probe gate must not contain an actor it doesn't control.** Two
   sweep runs failed sat-night's noon gates; the control experiment (same
   probe against the PRE-R17 build) measured the SAME failure — the hero's
   idle bob straddling the probe crop had been the "signal" since R16, and
   that cert passed on a lucky noise pair. The fix is to hide the
   foreground during ground-layer probes, and to demote what remains
   (sub-0.25/255 residuals of a breathing bloom) to informational. Run the
   control experiment BEFORE blaming the round.
2. **Injected test fixtures must live on the DOMAIN clock.** A synthetic
   traffic fix stamped with `performance.now()/1000` is ~1.8 billion
   seconds stale on the server clock — the stale ladder deletes it before
   the system under test ever sees it. `injectLock` asks `traffic.serverNow()`.
3. **Derived layout constants need their derivation recomputed at
   integration, not trusted.** A4 derived the info-chip dock from the
   cluster it could see; A5's buttons landed; the gate (not a human)
   caught the stale number. Writing the derivation INTO the constant's
   comment is what made the recompute a two-minute fix.
4. **Parallel agents may not share evidence artifacts.** Both Wave-2 agents
   regenerated the same verify-mobile PNGs from partial trees → binary
   merge conflicts. Evidence regenerates on the MERGED tree at
   certification; agent-side screenshots are working notes.
5. **`git stash push` on a directory of large binaries can time out and
   leave a half-applied index** — restore with `git reset` + targeted
   `checkout`, and prefer `git show HEAD:path` (binary-safe via bash, NOT
   PowerShell redirection, which corrupts binaries).
6. **A worktree cut for an agent may not be cut from the branch you think**
   — three of five agents found themselves on `main` and had to
   `reset --hard` to the round branch first. Make the check part of the
   agent's setup litany.
7. **The union sheet predicate (`isPhone || narrow`) is what let landscape
   phones stop being desktops** — capability and width are different
   questions; R16's fly-settings lesson ("static source gates") composes
   with, not against, a reactive orientation signal.

## 8. Follow-ups (not this round)

- Aircraft unlock economy (manifest `unlock` field is reserved and unused).
- Helicopter as a flyable (needs a hover-capable flight model + rotor anim).
- Weather-contract "conditions nearby" hint when none are eligible.
- Portrait contracts chip: consider a first-run coach mark (the panel now
  hides behind one tap).
- R15 §8 carries: classify.js deletion decision, ATN airline-prefix
  collision.

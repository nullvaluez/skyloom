# R25 A — FRONT DOOR ledger (intro pass)

Branch `r25/a` (from `r25-w0` = `1f983be`, E1 already in the base). Plan:
[FLY_ROUND25_PLAN.md](../FLY_ROUND25_PLAN.md) "Key rulings" 1-6, "UX flow", role A.
Every fps / ms / feel judgement below the line "unmeasurable here" belongs to
the user's machine; every number here is the offline fixture's on SwiftShader.

## 1. What was built

| Piece | Where | Notes |
|---|---|---|
| State helpers | `lib/fly/front-door.js` | `resolveInitialScreen` ('title' when `FRONT_DOOR.enabled && !titleBypassPinned()`), `frameloopFor` ('always' title+flight, 'demand' hangar), `gameplayLive` = `spotAllowed` (inFlight), `onTitle`, `bootCompactFor`, `exitGoesToTitle`, `freeFlightAvailable`, `enterHangarFromTitle`, `hangarToTitle`, `exitToTitle(runtime)`, the StagePump policy (`stagePumpWanted`, `stagePumpHz`, `stagePumpStats`). Every export returns the W0 stub's answer with the flag off. |
| Title flyby | `lib/fly/title-camera.js` | `TitleCamera` + `installTitleCamera(runtime)` → `runtime.titleCam`. Orbit around `flight.pos` at `FRONT_DOOR.orbit`; eye = max(flight y, centre ground + aglM, terrain-under-eye/ahead + minAglM), eased up fast / down slow and HARD-floored; look point `pitchDeg` (new, 16°) down, never below the centre ground; horizontal distances × mercator k (the look drop too — found by the node gate, see §3). `blendFrom` captures the pose on the next update (absolute frame); every other entry snaps; a teleport under the title (spawn landing, staged destination) snaps; leaving sets `needsSnap`. Reduced motion (OS or the in-game setting) → 900 s period. Per-spot `{radiusM, aglM}` from `runtime.titleSpot` or `spawn.title` (B's destinations). Toy: the floor follows the DRAWN (×1.7 + lift) ground. |
| Title screen | `components/fly/hud/TitleScreen.jsx`, `hud/title.css` | DOM only, `z-45`, `data-testid="title-screen"`, `data-overlay="title"`, `data-ready` (= `__flyBoot.pct === 100`, 4 Hz poll until true). Wordmark "Skyloom" + "Fly the living Earth"; spot chip (`title-spot`: featured destination → ops airport → nearest offline POI city, local time, sun/moon from `runtime.sun` or `computeSun`); `title-continue` (only when `readLastSetup()` is non-null; `runtime.launchSetup(last)`, degrading to the hangar in the setup's mode); `title-free-flight` (only when `FLIGHT_PLAN.enabled`); `title-takeoff-landing` (KOSU · KCMH · KLCK · Apron/Runway/Approach); `title-logbook` / `title-settings` / `title-credits`; its own attribution (`title-attribution`). Hidden while the Logbook (z-20) is open. Phones: stacked cards ≥ 88 px, targets ≥ 44 px, safe-area padding, no backdrop-filter, Settings as a bottom sheet; landscape side-by-side. |
| Settings | `hud/SettingsRows.jsx` (+ `MenuButton`), sheet in TitleScreen | `settings-sheet`, `settings-close`; rows Visuals (`settings-visuals-enhanced|classic`, only when `visualsAvailable()`; live `setVisualsLive` + `saveVisuals`), Map style, Quality, Sound, Reduced motion, Flight stakes. PauseMenu renders the same rows in the pre-R25 order and markup. |
| Credits | `hud/CreditsPanel.jsx` | Extracted verbatim; PauseMenu + the title's Credits button. |
| StagePump | `FlyCanvas.jsx` | Mounted only with the flag on. setInterval at 10 Hz desktop / 4 Hz phone; invalidates while the HANGAR is open and B's `runtime.staging` is not ready — or, for a session that came through the title (no bypass pin), while the boot has not revealed — never when `document.hidden`. |
| Boot compact mode | `hud/BootScreen.jsx` | Under the title the backdrop stays (z-40, `boot-screen`, `data-stage`, `data-compact="1"`, pointer-events none) and the wordmark + bar become a `boot-strip` sibling at `titleZ + 1` carrying `boot-caption`, pct and the 45 s Retry / Reduced-detail buttons. `__flyBoot` publisher, gates and reveal untouched. Leaving the title before the reveal restores the full screen. |
| Exit to title | `PauseMenu.jsx`, `FlyMode.jsx` | `pause-exit-title` "Exit to title" and the desktop X (`aria-label="Exit to title"`, shown only in flight) call `exitToTitle(runtime)`: `operations.returnToHangar()`, autopilot off, crash disarmed + sequence idle, stick neutral, every overlay closed, unpaused, `titleCam.blendFrom(camera)`, `setScreen('title')`. The error boundary keeps the reload, labelled "Restart Skyloom". |
| Gating | `JuiceSystems.jsx` (near-miss scan; detector reset on re-entry), `hud/Contracts.jsx` (1 Hz contracts / overflights / buzz; detector reset), `hud/ArrivalBanner.jsx`, FlyScene's W0 `spotAllowed` | All on `gameplayLive` (true with the flag off). Crash detection is already off in menus (W0: `menuOpen` → `paused` → `crashSys.update({enabled:false})`). |
| Audio | `hooks/use-fly-audio.js`, TitleScreen | Engine + wind bed ramped to 0 while `!gameplayLive` (one-shots/UI untouched; immersive loops `active && live`). Every title action and a capture-phase pointerdown call `runtime.audio.resume()`. |
| Esc / Back | `FlyMode.jsx` Esc chain, `hooks/use-overlay-back.js` | inspect → photo → atlas → logbook → **settings sheet** → hangar (dismissible = mid-flight confirm → unchanged; pre-flight → **title**) → credits → **title root: no-op** → pause/resume. `anyOverlayOpen` learns `settingsOpen`; the title ROOT pushes no Back sentinel (it is the home screen — Back there is browser navigation, and escapeStep is a no-op on it either way). |
| Chrome under the title | `FlyMode.jsx` | The four photo-mode `HudGroup`s also hide on the title (mounted, display:none); JuiceHud and the flight AttributionBar are not rendered while the title is up (the title carries its own attribution); the "designed for desktop" note waits for the first flight; the first-entry help card waits for a flight. All constant with the flag off. |
| Branding | `app/layout.js`, `public/manifest.json`, `app/loading.js`, BootScreen wordmark, PauseMenu help card, the mobile note, the error boundary | "Skyloom" / "Fly the living Earth". The OG url (`https://shadowadsb.app`) and the `shadowadsb-passport` key are unchanged. Branding is the ONE deliberate unflagged change (the user's "Skyloom everywhere"; metadata cannot sit behind a runtime flag). |
| Dead code | `FlyMode.jsx` | The R9 geolocation → last-pos → NYC spawn resolver is gone; the `fly-last-pos` WRITER stays (verify-boot reads it). |
| Constants | `FRONT_DOOR` block only | `enabled: true` (flipped on this branch after the gates), `orbit.pitchDeg: 16` added. Nothing outside the block. |

W0-only files (`FlyScene.jsx`, `stores/fly-store.js`, the constants tail outside
`FRONT_DOOR`/`VISUALS`) are untouched. **No w0Requests**: every call site the
title needs was already wired by W0.

## 2. RED first

* `verify-r25-front-door.mjs` on the **r25-w0 tree** (a detached worktree of the
  tag, this gate copied in): **21 passed / 15 failed** — (1b) the W0 stub opens on
  the hangar with the flag forced on, (2)/(5)/(7) the stub has no
  `gameplayLive` / `exitToTitle` / `stagePumpWanted`, (4a/4b/4e/4f) the hook has
  no settings/title branch, (6) `title-camera.js` does not exist, (8b/8c/8d/8f/8h)
  no title, no exit-to-title, no branding, geolocation still present. The 21
  that pass are the flag-off arms + W0 invariants, by design.
  Evidence: `.graphics-review/r25/a/red-front-door-w0.txt`.
* `verify-r25-title.cjs` with `FRONT_DOOR.enabled` **false** on this branch (the
  r25-w0 posture): **0 passed / 3 failed** — (t1)/(p1)/(l1) "screen hangar — no
  title-screen". Evidence: `.graphics-review/r25/a/red-title-flagoff.txt`.
* `verify-mobile-actions-node.mjs` (E's, pre-seeded): 11/11 + **5 PENDING** on
  r25-w0 → **16/16 PASS** here.

## 3. Found by the gates (not on the shopping list)

* **The look-down pitch ignored the mercator stretch.** World x/z are mercator
  units (k per metre) while y is metres, so "radius × tan(16°)" read as 12.4° at
  40° N. The node gate's (6d) caught it; the drop is now radius × k × tan.
* **Playwright actionability on a rendering page.** A visible, enabled settings
  row timed out a plain `click()` at 30 s (the stability check needs two
  animation frames; a SwiftShader frame can take seconds). The gate uses
  `force` clicks/taps — still trusted input at the element centre — and a
  bounded `browser.close()` (a hung close held a container-wide slot once).
* **The toy reveal outran the first click** (title at pct 15 after ~30 s, reveal
  at ~56 s). The toy leg now holds the traffic GLB responses (BootScreen gate
  (b)) until the pre-reveal rows are done, then releases them.

## 4. Gates (this branch)

(filled below from the runs)

## 5. Open risks

(filled below)

## 6. Unmeasurable here (the user's machine)

* The orbit's FEEL: period 240 s, radius 2.6 km, 16° pitch, 2.5 s blend — tune
  in `FRONT_DOOR.orbit`.
* Whether the title world reveals fast enough on real hardware at a real title
  spot (B's daylight featured spot) — E's product-boot timing row.
* Sound: that the first title click audibly unlocks audio on iOS Safari, and
  that the bed is silent on the title and comes back at launch.
* Phone: real safe-area insets (notch / gesture bar), real touch targets, the
  bottom sheet's feel, and the 4 Hz stage pump's cost with two WebGL contexts.
* The title's look over REAL Esri imagery and live traffic (the fixture's
  world is synthetic).

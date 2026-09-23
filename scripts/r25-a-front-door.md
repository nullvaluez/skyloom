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
| Audio | `hooks/use-fly-audio.js`, `lib/fly/front-door.js`, TitleScreen, `hud/SpotToast.jsx` (one gating line) | Engine + wind bed silent while `!gameplayLive` — `quietBed` also zeroes the 'prop' tremolo LFO depth and `wakeBed` restores it on the flight edge (§7). The lock blip (`lockBlipWanted`) and the SPICY scan (ping, pulse, toast, `seen`) are flight-only. Immersive loops `active && live`. Every title action and a capture-phase pointerdown call `runtime.audio.resume()`. |
| Esc / Back | `FlyMode.jsx` Esc chain, `hooks/use-overlay-back.js` | inspect → photo → atlas → logbook → **settings sheet** → hangar (dismissible = mid-flight confirm → unchanged; pre-flight → **title**) → credits → **title root: no-op** → pause/resume. `anyOverlayOpen` learns `settingsOpen`; the title ROOT pushes no Back sentinel (it is the home screen — Back there is browser navigation, and escapeStep is a no-op on it either way). |
| Chrome under the title | `FlyMode.jsx` | The four photo-mode `HudGroup`s also hide on the title (mounted, display:none); JuiceHud and the flight AttributionBar are not rendered while the title is up (the title carries its own attribution); the "designed for desktop" note waits for the first flight; the first-entry help card waits for a flight. The Logbook opened from the title hides the title layer, so the flight AttributionBar mounts for it; the title's Settings/Credits modal stops above the title credit (`--fly-title-attr-reserve`) (§7). All constant with the flag off. |
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
  at ~56 s; a GLB hold cannot help — `BOOT.maxBootMs` 45 s reveals
  regardless). (t1) now reads an IN-PAGE probe (addInitScript) that clicks
  `title-settings` the moment it exists with `__flyBoot.pct < 100` and records
  the pct; the AUDIO row (t2) stays a separate trusted Playwright click.
* **A trusted click could sit 180 s in actionability** right after the hangar
  closed (load ~7.5). Navigation steps a row does not certify use one DOM
  click through `page.evaluate`.
* **(t8) had no acquisition to suppress.** The fixture's static fleet puts
  its nearest contact 11.6–12.3 km away in 3-D (8.4–9.1 km out, ~8.4 km up),
  outside `TARGETING.acquireRangeM` 10 km, so runs 9–11 read NOT CALIBRATED;
  a lift to 95 % of the range still missed (an airliner closes a 500 m
  margin in ~2 s of dead reckoning). The row now PLACES the frozen flight
  3 km short of the contact (a plain vector while frozen, as t9 already
  moves it), re-aims each poll, and restores the pose. Run 14 then showed
  the lock taken (`9f15f3` at 3.5 km, 0.00° off the nose) and the NEXT
  evaluate reading null — polling `lockedHex` misses an acquisition that
  releases between two evaluates. The row now counts Targeting `'acquired'`
  transitions by wrapping the live instance's `update` for the dwell (the
  exact transition that logs a spot in flight) and removes the wrapper
  afterwards. Scratch probe + log: `.graphics-review/r25/a/aim-probe.*`.

## 4. Gates (this branch)

Tree: `r25/a` with `FRONT_DOOR.enabled: true` and E's harness head `28cafb1`
merged (fix pass: `a427041`). Fixture on SwiftShader, `FLY_BOOT_SCALE=3`, one browser slot.

| Gate | Verdict | Evidence |
|---|---|---|
| `verify-r25-front-door.mjs` (node) — fix pass | **PASS 68 / 0** | + [9] audio bed on the real FlyAudio (9a–9f) and (8j–8l); fix-pass RED 62 / 6 (§7). `.graphics-review/r25/a/front-door-fixpass.txt` |
| `verify-r25-front-door.mjs` (node) — first build | **PASS 58 / 0** | RED on r25-w0: 21 / 15 (§2). Flag-off arms (1a, 2a, 3b, 4g, 4h over 256 states, 5a, 6n) prove the flag-off tree answers exactly as r25-w0. |
| `verify-r25-title.cjs` fix pass (run 16: toy + phone + attr + attrsat, `R25_TITLE_MOUNTAIN=0`, E head `a427041` merged) | **PASS 47 / 0 / 0** | `.graphics-review/r25/a/title-run16.log`. Toy t1–t12 + t14 green incl. (t8) through a real title acquisition (1) with the passport unchanged, (t11) exit to title; portrait/landscape p1–p7 / l1–l7 green with (p4)/(l4) now asserting the sheet DOCKED on the credit (portrait sheet bottom 802 / credit top 806; landscape 365 / 369; credit on top); new leg `attr` (desktop toy, both phones) + `attrsat` (satellite): the flight bar mounted + on top under the title Logbook (desktop toy + satellite, text "© Esri, Maxar…" in satellite), the title credit on top and clear of the Settings / Credits backdrop (modal bottom 686 vs credit top 690 desktop; 670/674 satellite), 0 lock blips for 3 title lock transitions. RED of the new rows: **4 / 14** on the pre-fix tree (§7). The satellite REVEAL leg (s1–s6) was not re-run: nothing it measures changed (run 10 row below). |
| `verify-r25-title.cjs` toy + phone + sat (run 10) | **PASS 35 / 0, 1 NOT CALIBRATED (t8, closed by run 15)** | `.graphics-review/r25/a/title-run10.log`. Toy t1–t14 green except (t8); portrait p1–p7 and landscape l1–l7 green (every control ≥ 44 px, the ops card 362×100 portrait / 460×88 landscape, nothing clipped or overlapping, Settings a bottom sheet, Back closes the sheet and returns the pre-flight hangar to the title); satellite s1–s6 green (interactive at boot pct 0, the world revealed after 456 s with the orbit camera away from `flight.pos`, orbit radius error 0.00 %, min AGL 897 m, plane hidden, Esri attribution on top, zero page errors). RED: 0 / 3 with the flag off (§2). |
| (t8) zero passport change — toy re-run (run 15, `R25_TITLE_MOUNTAIN=0`) | **PASS** | runs 10–14 NOT CALIBRATED (no acquisition happened / was observed; §3). Run 15: **3 `'acquired'` transitions on the title** (contact `9f15f3` placed at 3 km, 0.00° off the nose) and the passport unchanged (spots 0→0, total 0→0). `.graphics-review/r25/a/title-run15.log`. |
| `verify-import-integrity.mjs` | **PASS 4 / 0** | = baseline |
| `verify-mobile-actions-node.mjs` | **PASS 16 / 16** | the 5 rows PENDING on r25-w0 (the Esc/Back table) now PASS |
| `verify-r25-flagoff.mjs` (E) | 8 passed, 2 NOT CALIBRATED | = baseline (the 2 wait for C/D) |
| graphics-unit · flight-operations (33) · operations-disclosure · cinematic-flight (16) · stylized-earth (22) · living-earth (19) · c-flagoff (58) | **PASS** | = W0 baseline |
| targeted eslint over every changed product file | FlyCanvas 1e, use-fly-audio 1e, all others 0 | = W0 baseline (both pre-existing `react-hooks/immutability` on `runtime`) |

## 5. Open risks

* **Branding is unflagged.** Metadata, manifest, loading text and the
  wordmark read "Skyloom" whatever `FRONT_DOOR.enabled` says (the user's
  "Skyloom everywhere"; metadata cannot sit behind a runtime flag). A harness
  that text-matches the old product name would move; none of the node gates
  in the baseline table did.
* **B's surface is stubbed on this branch.** Continue (hidden while
  `readLastSetup()` is null), the Free Flight card (hidden while
  `FLIGHT_PLAN.enabled` is false) and the StagePump's `runtime.staging`
  arm are coded against B's signatures and gated by (t1b) on what ships;
  their live behaviour is certified only once B lands on the integration tree.
* **The title's default spot is KOSU** (W0 `resolveInitialSpawn`) until B
  ships the daylight featured spot; the satellite reveal took 456 s on this
  venue at KOSU. E's boot-time row owns the product number.
* **Landscape side-by-side** is measured with one card (Free Flight hidden);
  two-card layout is CSS-only and re-read at integration with B.
* **`hud/SpotToast.jsx` is outside A's owns list** (the plan names no owner).
  The fix pass added ONE title-gating line (the SPICY tick returns while
  `!gameplayLive`) — the same class of line as the Juice / Contracts /
  Arrival gates A owns, constant true flag-off. An integrator merging another
  SpotToast edit should keep it.
* **The phone Logbook covers the credit** (R16 `Logbook.jsx`, in flight too):
  from the title the flight bar is now mounted under it, but paint order on
  phones is unchanged pre-existing behaviour (§7).
* **(t8) calibration** rests on a PLACED frozen pose (3 km from a contact);
  its RED arm (spots logged on the title) was not run in the browser — the
  suppression's RED is the node gate's (2a)/(2b) table (RED on r25-w0).
  The row proves real acquisitions happened on the title and logged nothing.

## 6. Unmeasurable here (the user's machine)

* The orbit's FEEL: period 240 s, radius 2.6 km, 16° pitch, 2.5 s blend — tune
  in `FRONT_DOOR.orbit`.
* Whether the title world reveals fast enough on real hardware at a real title
  spot (B's daylight featured spot) — E's product-boot timing row.
* Sound: that the first title click audibly unlocks audio on iOS Safari, and
  that the bed is silent on the title and comes back at launch — for the
  'prop' voices too (the tremolo zeroing is certified on a mock AudioContext,
  [9]; no gate listens to the output).
* SPICY on the title: the fixture has no SPICY-qualifying contact near the
  title spot, so "no ping on the title" is a source + table certification.
* Phone: real safe-area insets (notch / gesture bar), real touch targets, the
  bottom sheet's feel, and the 4 Hz stage pump's cost with two WebGL contexts.
* The title's look over REAL Esri imagery and live traffic (the fixture's
  world is synthetic).

## 7. Fix pass — adversarial review (2026-09-23)

Three findings, each verified before touching code; each RED measured on the
pre-fix tree, then GREEN.

| # | Finding | Verdict | Mechanism (verified) | Fix |
|---|---|---|---|---|
| 1 | Esri credit lost under the title Logbook; the title Settings/Credits modal dims + blurs it (desktop) and the phone sheet covers it | **FIXED** | `TitleScreen` is `hidden={logbookOpen}` (its credit goes with it) while FlyMode rendered the flight bar only `!titleUp`; `.fly-title-modal` was `inset:0` over the credit. RED (browser, leg `attr`+`attrsat`, `.graphics-review/r25/a/red-title-attr.txt`): **4 / 14** — Logbook: no `.bottom-2.left-2` anywhere (toy, satellite, both phones); Settings/Credits: `elementFromPoint` on the credit hits `div.fly-title-modal` / the sheet rows (desktop modal bottom 720 over credit top 690/674; portrait sheet to 844 over credit top 806; landscape 390 over 369); satellite text "© Esri, Maxar…". | FlyMode mounts `<AttributionBar/>` when `titleUp && logbookOpen` (`logbookUp` selector: `onTitle(s) && s.logbookOpen`, constant false flag-off → no extra render). The title modal is `inset:0 0 var(--fly-title-attr-reserve) 0`; TitleScreen writes the reserve (root bottom − credit top + 4 px) straight to the DOM from a ResizeObserver — the credit strip is never under the backdrop, and the phone sheet docks on it. (p4) now asserts the dock (sheet bottom = credit top, credit on top). |
| 2 | `quietBed` leaves the 'prop' / 'warbird-prop' tremolo audible on the title + hangar | **FIXED** | `audio-engine._applyProfile` connects the LFO (`gain = engineMaxGain·thrumDepth = 0.22·0.55 = 0.121`) to `engGain.gain`; Web Audio sums it onto the intrinsic value, which quietBed alone ramped to 0. RED (node [9] on the REAL FlyAudio over a mock AudioContext that sums connected nodes onto a param; the pre-fix quietBed moved verbatim): **62 / 6** — (9b) `warbird-prop` + `prop` engine amplitude **0.121** on the title, (9d) a prop picked while quiet stays 0.121 (`.graphics-review/r25/a/red-front-door-audio.txt`). | `quietBed` / `wakeBed` / `lockBlipWanted` moved to `lib/fly/front-door.js`. quietBed also ramps `_lfoGain.gain` to 0 (τ 0.05, whatever the context state); `immediate` sets it at once for a graph (re)built while quiet — the hangar pick (`applyAircraft`) and the first click that builds the context (the `gesture` handler, same task, before it can sound). The hook calls `wakeBed` only on the quiet→flight edge (restores `engineMaxGain·thrumDepth`; (9c) compares it with a freshly built graph's depth, so a drift in audio-engine reads FAIL). Flag off: gameplayLive is constant true, so neither is ever called — today's call sequence exactly. `audio-engine.js` untouched (not A's file). |
| 3 | SPICY scan + lock blip run on the title | **FIXED** | (a) `SpotToast`'s 2 s SPICY interval had no gate: it pinged (`spotBlip`), set `runtime.spicyPulse`, queued a toast behind the hidden HUD group and spent the hex from the once-per-session `seen` set. (b) Targeting soft-locks from the frozen flight (t8 measured 3 acquisitions) and the `lockedHex` subscription played `lockBlip()` for each. RED: browser (a4) **3 lock blips for 3 title transitions** (toy and satellite); node (9f) title + hangar `true`; (8j) no gate in the SPICY tick. | The SPICY tick returns while `!gameplayLive(useFlyStore.getState())` (one title-gating line in `SpotToast.jsx` — the plan's owns list names no owner for this file; it is the same class of line as the Juice/Contracts/Arrival gates A owns, recorded as a risk). The subscription plays the blip only when `lockBlipWanted(hex, prev, state)` (= `hex && !prev` flag-off). Targeting itself still soft-locks on the title (the reticle is hidden there; passport logging is `spotAllowed`-gated, t8). |

**Browser RED is not a SPICY measurement.** The fixture's static fleet has no
SPICY-qualifying (military / epic+) contact near the title spot, so the SPICY
suppression is certified by the source row (8j) + the `gameplayLive` table
([2]), not by a ping counted in the page. Unmeasurable here → the user's machine.

**Phone Logbook parity.** On phones the R16 Logbook is a full sheet (`bottom:0`,
z-20) over the attribution zone (z-10) — in flight too. From the title the flight
bar is now MOUNTED under it (row a-portrait1 / a-landscape1 assert parity, not
paint order); the phone Logbook covering the credit is pre-existing R16 behaviour
in `Logbook.jsx` (not A's file) and is recorded, not changed.

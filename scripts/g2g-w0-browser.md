# Gate to Gate W0 — flags-off browser pre-baseline

Run 2026-10-13 on the owner's Windows PC (Chrome headless, ANGLE D3D11 on the
RTX 5080), against `next dev --webpack -p 3311` from the `g2g/w0-b` worktree
(`main` 4f7fac3 plus the W0.8 harness commits and `review-poses.js`). No
flags; each gate's own pins only. `FLY_URL` was `http://localhost:3311`, with
`/?graphicsReview=1` where the gate's own default carries it, and
`...&airports=on&airportArt=on&airportScenery=on` for the two lounge gates.

The app delta from 4f7fac3 is `lib/fly/airport-service/review-poses.js` only,
a dev hook that does nothing until `runtime.reviewOps.pose()` is called, so a
gate whose script and `require` closure are unchanged runs the same code as
on 4f7fac3.

## Verdicts

| Gate | Migrated in W0.8 | Result | Red is |
|---|---|---|---|
| `verify-operations-browser.cjs` | yes | PASS (fresh, second departure, reload: FULL_DETAIL) | — |
| `verify-operations-design.cjs` | no | FAIL after 8 checks: the phone leg waits for a `Minimize flight controls` button that the phone deck (`MobileFlightDeck`, "Approach ⌄") does not have | pre-existing: the 4f7fac3 script with the 4f7fac3 `_title.js` fails identically (8 checks) |
| `verify-operations-keyboard.cjs` | no | PASS | — |
| `verify-operations-experience.cjs` | yes | FAIL after 6 checks: "Rollout braking failed", Space held 7 s after clicking `Idle` leaves 12.8 m/s | pre-existing: the 4f7fac3 script fails identically (6 checks, 13.3 m/s). The migrated lines (KOSU pick, runway radio) passed: runway start, takeoff, rotation, both finals and the go-around all ran |
| `verify-operations-touch.cjs` | no | FAIL after 2 checks: no `Parking brake on` button on the phone deck | pre-existing: the 4f7fac3 script fails identically |
| `verify-operations-fleet.cjs` | yes | PASS (nine previews, eight powered departures, glider practice, repeat departure) | — |
| `verify-operations-taxi-edge.cjs` | yes | PASS | — |
| `verify-mobile-flight-deck.cjs` (29) | no | FAIL, 0 checks: line 77 taps the stale `title-free-flight` | pre-existing (unchanged script and `_landmark-boot.cjs`). A scratch copy with `title-explore` then passed 21 checks and stopped on the first-flight tips card (`explorer-guide`) intercepting the `Close flight setup` tap, which is a second pre-existing issue |
| `verify-airport-interaction.cjs` (25) | no | 25/25 PASS | — |
| `verify-airport-browser-states.cjs` (24) | no | 24/24 PASS | — |
| `verify-sat-night.js` | no | 26/3, re-run 27/2. Consistent: "SatCityGlow keeps the far city alive" and "city glow is night-lit" (placed −1). Flaky: the eviction A/B (passed on re-run) | pre-existing: `FlyScene.jsx:3695` mounts SatCityGlow only when `!satelliteVisualsOn('lighting')`, so the cinematic lighting retired it and the gate is stale |
| `verify-chase-cam.js` | no | 6/8, re-run 8/8 PASS. The first run had the player off-screen in cinema and a `Failed to fetch` page error | pre-existing and flaky (live traffic) |
| `verify-feel.js` | no | 12/13, re-run 11/13. Consistent: "punch decayed" (74.0° against the 78.0° expected). Flaky: "cruise draws unchanged by the mount" (396 against 394) | pre-existing |

Extra migrated-harness checks (not on the W0 list):
- `verify-loading-scenery.cjs` passes (uses `pickDeparture` + `pickStart('runway')`).
- A probe of `scripts/_hangar-pick.js` against the live hangar passed every
  branch with zero page errors: authored pick, catalog ident through the
  search (`LOWI` → `LOWI:08-26`), full catalog id (`EGLL:09R-27L`),
  `waitForDeparture('EGLL:')`, the runway radio, the `gate` → `apron` alias,
  `optional` at a catalog runway, and `hasDeparturePicker`/`departureId` in
  the Free Flight hangar (false / null).

**No red is caused by the migration.** The migrated scripts that failed
(`-experience`) fail at the same step as their 4f7fac3 originals.

Not run here: `verify-r25-continue/-freeflight/-hangar-edges/-smoke.cjs`,
`r25-e-baseline.cjs` (fixture rows) and `beta-smoke.cjs` (production build).
Their edits are mechanical, and the helper paths they use are the ones the
probe exercised.

## Notes for later waves

- The stale `title-free-flight` id is still used by
  `verify-mobile-flight-deck.cjs:77`, `verify-r25-title.cjs:301` and
  `verify-rio-clouds.cjs:18` (outside W0.8's files). `_title.js`,
  `verify-r25-smoke.cjs` and `verify-r25-continue.cjs` now use `title-explore`.
- The phone legs of `-design` and `-touch` expect pre-`MobileFlightDeck`
  role names (`Minimize flight controls`, `Parking brake on`). They need the
  deck's current names, or the W1 D deck must restore them.
- `OperationsHUD.jsx:54` builds `destinations` as `[...OPERATIONS_AIRPORTS,
  current catalog destination]`, but a registered catalog airport is already
  in `OPERATIONS_AIRPORTS`. React therefore logs a duplicate-key error on
  every HUD render at a catalog airport: about 1,100–1,600 per review run at
  KJFK, LOWI, YSSY and EGLL, and none at KCMH.

## BEFORE review baseline (W0.8)

`C:\Users\bfecho\skyloom-3\.graphics-review\operations-airfield\baseline\`
(gitignored, in the main checkout). It holds 15 runs: KCMH, KJFK:13R-31L,
LOWI:08-26, YSSY:16R-34L and EGLL:09L-27R × day/golden/night on 2026-10-13,
arm off. Each run has 7 runway poses × chase and side cameras, and every
capture has a `-clean` twin, for 210 captures and 420 PNGs. Every run has a
`report.json`; `index.json` and `baseline-summary.json` cover the whole set.
The set has **0 page errors**. The command is in `baseline-summary.json`.

## Integrated tree (9440498)

The same 13 gates plus `verify-loading-scenery.cjs` were run on `main`
9440498 (the fully integrated W0 tree: helper A, helper B, the orchestrator's
splits, seams and fixes), with the same server setup and URLs, flags off.

| Gate | Pre-baseline (4f7fac3 + W0.8) | Integrated 9440498 | Changed? |
|---|---|---|---|
| `verify-operations-browser.cjs` | PASS | PASS | no |
| `verify-operations-design.cjs` | FAIL after 8 checks (phone `Minimize flight controls`) | FAIL after 8 checks, same step | no |
| `verify-operations-keyboard.cjs` | PASS | PASS | no |
| `verify-operations-experience.cjs` | FAIL after 6 checks (rollout braking, 12.8 m/s) | FAIL after 6 checks, same step (12.2 m/s) | no |
| `verify-operations-touch.cjs` | FAIL after 2 checks (phone `Parking brake on`) | FAIL after 2 checks, same step | no |
| `verify-operations-fleet.cjs` | PASS | PASS | no |
| `verify-operations-taxi-edge.cjs` | PASS | PASS | no |
| `verify-mobile-flight-deck.cjs` | FAIL, 0 checks (stale `title-free-flight`) | FAIL after 21 checks: the first-flight tips card intercepts the `Close flight setup` tap | yes, it now gets further. The stale id is fixed (9440498), and the remaining red is the pre-existing tips card my scratch run found |
| `verify-airport-interaction.cjs` | 25/25 | 25/25 | no |
| `verify-airport-browser-states.cjs` | 24/24 | 24/24 | no |
| `verify-sat-night.js` | 26/3, re-run 27/2 | 26/3, re-run 27/2 | no. The two SatCityGlow reds are consistent. The third red was a different flake this time: a console 404 from the live `/api/aircraft/<hex>/route` lookup, gone on re-run |
| `verify-chase-cam.js` | 6/8, re-run PASS | PASS | no (the earlier red was a live-traffic flake) |
| `verify-feel.js` | 12/13 (punch decayed) | 12/13 (punch decayed, 73.98° against 78°) | no |
| `verify-loading-scenery.cjs` | PASS | PASS | no |

**Nothing is caused by W0.** No verdict regressed, and the only change is
the mobile deck getting further.

**Duplicate keys:** 0 React duplicate-key console errors on the integrated
tree at KJFK:13R-31L and LOWI:08-26 (review runs below; arm off and on). The
same poses logged 1,100–1,600 per run before `airportChoices`. All five
integrated review runs logged 0 console errors and 0 page errors.

**Flags-on boot smoke.** `review-operations-airfield.cjs --airport KCMH,LOWI
--sun day --poses lineup,final1nm --arm on --flags <all 15 W0 names>`, run
twice (`w0-flags-on`, `w0-flags-on-r2`), plus an arm-off run on the
integrated tree (`w0-integrated-off`, with KJFK) and a paired LOWI off/on
run (`w0-lowi-pair`). All are under
`C:\Users\bfecho\skyloom-3\.graphics-review\operations-airfield\`.
- 0 page errors and 0 console errors on every run.
- `window.__flyUrlFlags` lists all 15 names as `true`, plus the `sunUtc`
  and `weather` pins.
- Census (draws / tris, median of five 60-frame refreshes):

| Pose | BEFORE | Integrated, off | On #1 | On #2 |
|---|---|---|---|---|
| KCMH lineup | 353 / 0.67M | 336 / 0.74M | 341 / 0.65M | 330 / 0.73M |
| KCMH final1nm | 349 / 1.31M | 335 / 1.18M | 332 / 1.14M | 329 / 1.16M |
| LOWI lineup | 323 / 1.06M | 336 / 1.12M | 338 / 1.28M | 334 / 1.29M |
| LOWI final1nm | 360 / 1.34M | 334 / 1.19M | 329 / 1.19M | 339 / 1.21M |
| KJFK lineup | 334 / 0.78M | 328 / 0.84M | — | — |
| KJFK final1nm | 340 / 1.10M | 325 / 1.16M | — | — |

  The same configuration repeated moves by about ±15–30 draws and ±15% tris
  (streaming and live traffic). For example, the paired LOWI run read 363 /
  1.13M off against 358 / 1.18M on at the lineup, and 376 / 1.337M in both
  arms on final1nm. Every flags-on delta sits inside that spread, and
  textures (331–357) and programs (153–156) did not move. Nothing renders
  differently in W0, as expected.

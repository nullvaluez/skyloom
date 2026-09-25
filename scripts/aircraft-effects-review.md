# Aircraft effects and airborne gear review — 2026-09-25

Request: improve player and world aircraft, contrails and effects, fix the always-deployed wheels, and push to main.

## Changes

- Free Flight now resets gear and flaps synchronously on launch/warp. Previously the operations constructor initialized gear to 1, while Free Flight cleared the operations profile; `advance()` returned before changing gear. The wheels therefore stayed down indefinitely. A runway departure keeps its gear through initial liftoff, then retracts over 2.5 seconds. Low passes do not deploy it; approaches and ground starts still do. The prop's authored fixed gear remains intact.
- Engine-specific condensation: one or two sources for small jets, two wing engines on the airliner, four on the cargo jet. Bounded histories retain density at emission, drift with wind, spread and dissolve with age, survive origin rebases, and break across warps or dry intervals. Camera-crossing segments fade to avoid full-screen ribbons. Short wingtip vapor appears during fast, hard turns.
- World traffic uses the same engine stations as its detailed geometry, with jet/type/altitude/speed/ground checks and admission limits of 48/28/12 aircraft by quality tier. Physical plumes complement the existing navigation tracers in one additional draw. Newly observed jets receive a short velocity-estimated visual wake; this is not historical ADS-B data. The cold altitude band is an artistic approximation, not measured upper-air saturation.
- Player afterburners use feathered blue cores, warm shear, moving shock cells and end-on nozzle glow, aligned to actual engine stations in one mesh. Props, gliders and heavies do not gain afterburners. Navigation lights sit on measured wing tips, use circular halos and double strobes, and include forward-facing, gear-linked landing lamps.
- Paint and canopy grading retain source maps, alpha settings and material arrays. Detailed live aircraft gain clearer glass/paint/metal separation and merged fan, intake and exhaust detail. The latest upstream painterly treatment is preserved, including its model-scale argument.

## Validation

The integrated production code is commit `175abad`, merging the implementation `798885a` with upstream `21ded98`. Final follow-up changes concern the harness and this record only.

- Production build: PASS (`FLY_BUILD_DIR=.next-aircraft-check`, `next build --webpack`). The isolated worktree resolves its existing dependency installation from the parent checkout.
- Targeted ESLint: PASS for the aircraft, wake, presentation, geometry and operations changes.
- `node scripts/verify-aircraft-effects.mjs`: 13/13 PASS, including 30/60/144 Hz gear behavior, fixed-gear compatibility, source stations, bounded history, invalid data, expiry, rebase invariance, dry gaps, warp cuts, camera intersections, shader composition, cache immutability and all live model families.
- `node scripts/verify-flight-operations.mjs`: 33/33 PASS.
- `node scripts/verify-living-earth.mjs`: 19/19 PASS.
- `node scripts/verify-painterly-flight.mjs`: 18/18 PASS.
- Browser review: 16/16 PASS, zero page or shader errors. Chrome on ANGLE/NVIDIA GeForce RTX 5080, 1600×1000, using the local world/traffic fixture. Screenshots and reports are in the integration worktree's ignored `.graphics-review/aircraft-effects/` directory. This is focused aircraft validation; it is not certification of live imagery or the full terrain fleet.

The final captures show deployed gear only in the runway case, twin fighter exhausts during boost, four cargo plumes, and circular red/green navigation lights at night. All aircraft captures were taken after loading finished. The night checkpoint measured sun fraction 0, versus 0.96 by day; the low-tier checkpoint admitted exactly 12 aircraft with a limit of 12. Fixed landing gear on the prop remains part of its model.

The browser command is `node scripts/verify-aircraft-effects.cjs`, with `FLY_URL` pointing to the development server and `FLY_TILE_FIXTURE=1`. Its checks cover visible airborne gear, both map styles, player/world wakes, boost, all nine player aircraft, cargo engine count, night lighting, quality limits and runway-to-Free-Flight transitions. Image captures wait for the model and arrival overlay. Night testing refreshes the style because the sun otherwise updates on a 60-second cadence.

## Existing terrain race found by the control

The first browser sequence directly called `beginDeparture()` and then `launchSetup()` 500 ms later, while the first arrival was still loading. Both the integrated branch and an isolated, unmodified `21ded98` produced the same exception during the second warp:

```
Can't add more than 5 objects to a tile.
T.add → THREE.Object3D.add → T.add → T._loadSubTiles
```

The control's nine Free Flight cases all reported gear=1; the updated branch reported gear=0 with the retractable gear mesh hidden. The terrain exception was therefore reproduced independently of the aircraft changes, and no tile-loader fix is claimed here. The final aircraft harness waits for arrivals between those lifecycle transitions. The original failure is retained in `browser-report-first.json`; `terrain-control-report.json` and its control script are in the original checkout's ignored `.graphics-review/aircraft-effects/` directory. No existing assertion threshold was relaxed.

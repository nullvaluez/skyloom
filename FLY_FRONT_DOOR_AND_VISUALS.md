# Front Door & Visuals (Round 25)

Implementation and verification record, 2026-09-24. Plan:
[FLY_ROUND25_PLAN.md](FLY_ROUND25_PLAN.md).

**Visuals update (2026-09-24):** the saved SKY and GROUND work is now integrated
on `codex/clear-sky-visuals`. The user approved Enhanced as the default and
publication to main, with 20 passing real-GPU runtime checks; appearance
certification remains open. See
[CLEAR_SKY_VISUALS.md](CLEAR_SKY_VISUALS.md) for the current implementation,
feature flags, evidence and remaining work. The intro verification and ship-state
statements below are the historical intro close, not new visual certification.

**The round has two halves:**

- **The intro half is built and certified on the offline fixture.** It covers
  the title screen, Free Flight vs Takeoff & Landing, the adaptive hangar,
  Continue, Exit to title and the Skyloom branding. Three roles built it:
  A FRONT DOOR, B FLIGHT PLAN and E CERT.
- **The visuals half is implemented.** C SKY and D GROUND sit behind the
  Visuals: Enhanced / Classic switch. See the
  [current visual record](CLEAR_SKY_VISUALS.md); Enhanced is now the default.

Every fps, millisecond and feel judgement is for the user's machine. The
cloud container blocks the tile hosts and renders WebGL on SwiftShader at 1–3
fps, so every browser row here ran against E's offline world fixture. Those
numbers are fixture numbers.

## Play the feature

The game now opens on a **title screen** over a live world. The camera orbits
slowly around a featured spot. The first time you play, that is a spot in good
daylight right now (the Grand Canyon if none is lit; Manhattan in the Neon
style). After that it is wherever your last flight started. The title works
straight away; the world streams in behind it, with a compact loading strip at
the bottom.

1. **Free Flight.** This opens the hangar in free mode. Pick any of the nine
   aircraft. Then pick one of the 11 featured spots or search any city, and
   press **Fly to {name}**. You start airborne above the spot. The hangar
   loads the destination in the background as soon as you pick it
   (**staging**), so the flight starts without a long hold. The featured
   spots are the Grand Canyon, Manhattan, the Swiss Alps (Lauterbrunnen), Rio
   de Janeiro, Tokyo, Yosemite Valley, Sydney Harbour, Dubai, the Nāpali
   Coast, Geirangerfjord and Columbus (practice).
2. **Takeoff & Landing.** This opens today's dispatch hangar: KOSU, KCMH or
   KLCK, starting on the apron, lined up on the runway, or on approach. The
   ground-operations flow in [FLY_GROUND_OPERATIONS.md](FLY_GROUND_OPERATIONS.md)
   is unchanged.
3. **Continue** (for example "Continue · Meridian · Free Flight over
   Manhattan") relaunches your last setup exactly. It appears only once a
   valid setup has been saved.
4. In flight, **pause → Exit to title** (or the desktop X) returns to the
   title over the same world, without reloading the page. The camera eases
   out of the chase view into the orbit.
5. **Settings, Logbook and Credits** open from the title. Settings holds Map
   style, Quality, Sound, Reduced motion and Flight stakes. The Visuals row
   stays hidden until the visuals pass ships something Enhanced.
6. **Esc / Back:**
   - Esc closes a sheet.
   - On the title itself, Esc does nothing.
   - In the hangar before a flight, Esc or Back (or **‹ Title**) returns to
     the title.
   - The mid-flight "return to hangar" confirm is unchanged.
7. **Phones:** the cards stack, with targets at least 44 px and safe-area
   padding, and Settings opens as a bottom sheet. In landscape the cards sit
   side by side.

The title suppresses passport spotting, contracts, airport buzz, near-miss
juice, the arrival banner, crashes, SPICY pings and the lock blip. The engine
and wind sound stays silent until you are flying. The first click on the
title unlocks audio.

## Requirements map

| Requirement (plan "Decisions") | Implementation |
| --- | --- |
| Live-world title with a slow orbit | `hud/TitleScreen.jsx` is DOM only, at z-45. `lib/fly/title-camera.js` orbits `flight.pos` using each spot's `{radiusM, aglM}`. It keeps a terrain-clearance floor, looks 16° down, uses a 240 s period (900 s under reduced motion), and blends 2.5 s out of the chase pose. |
| Two cards, both through the hangar; Continue; Logbook / Settings / Credits secondary | `title-free-flight`, `title-takeoff-landing`, `title-continue`, `title-logbook`, `title-settings`, `title-credits` |
| Free Flight: featured spots + city search, any aircraft, airborne | `lib/fly/destinations.js` (11 curated spots, each with `altM ≥ clearM + 400`), `lib/fly/poi/search.js` (the exact Atlas ranking), `runtime.launchFreeFlight` |
| First title spot: daylight featured spot, fallback Grand Canyon, toy → Manhattan; returning players see their last setup | `pickTitleSpot`, `resolveInitialSpawn` in `lib/fly/flight-plan.js` |
| Skyloom everywhere; passport key and OG URL unchanged | `app/layout.js`, `public/manifest.json`, `app/loading.js`, the BootScreen wordmark, "Welcome to Skyloom", and "Restart Skyloom" on the error boundary. `shadowadsb-passport` and the OG URL are untouched. |
| Built behind flags; certified sub-flags ship ON | `FRONT_DOOR`, `FLIGHT_PLAN` (ON), `VISUALS` (profile plumbing), `R25_SKY` / `R25_GROUND` (OFF until the visuals pass). See Ship state. |
| Visuals: Enhanced / Classic, live, Classic = today's pixels | `lib/fly/visuals-profile.js` provides `r25On(block, sub)`. The Settings row is hidden while nothing Enhanced exists. |
| Airports KOSU / KCMH / KLCK kept | The Takeoff & Landing hangar is today's dispatch panel. |

## Engineering contracts

### State machine

One store field, `screen: 'title' | 'hangar' | 'flight'`, plus
`flightMode: 'free' | 'ops'`. `hangarOpen` is kept as a mirror of
`screen === 'hangar'`, so testids, harnesses and the store API keep working.
Two predicates are exported: `menuOpen(s)` and `inFlight(s)`.

| From | Event | Action | To |
| --- | --- | --- | --- |
| boot | pre-mount | `resolveInitialScreen()` → `'title'` (the harness bypass pin → `'hangar'`). `resolveInitialSpawn()` → last setup, else the daylight spot (bypass → KOSU). | title |
| title | Free Flight card | `enterHangarFromTitle('free')`: audio resume, `flightMode='free'` | hangar (free) |
| title | Takeoff & Landing card | `enterHangarFromTitle('ops')` | hangar (ops) |
| title | Continue | `runtime.launchSetup(readLastSetup())` | flight |
| hangar, pre-flight | pick a destination or airport | `stageDestination()`, debounced 400 ms | hangar |
| hangar, pre-flight | ‹ Title / Esc / Back | `hangarToTitle()` | title, orbiting the staged spot |
| hangar | Fly (`hangar-fly`) | `launchFreeFlight` / `beginDeparture` / `launchGlider`, then `saveLastSetup` | flight |
| pause | Exit to title (`pause-exit-title`, desktop X) | `exitToTitle(runtime)`: `returnToHangar`, autopilot off, crash disarmed, input neutral, overlays closed, `titleCam.blendFrom(camera)` | title, orbiting the current position |

On the title the flight is frozen: operations phase `'hangar'`, with the
player group hidden. The canvas frameloop is `'always'` on the title and in
flight, and `'demand'` in the opaque hangar. There, `<StagePump>` invalidates
at 10 Hz on desktop and 4 Hz on phones until staging is ready, the boot has
revealed, or the tab is hidden.

### Runtime actions

- `runtime.launchFreeFlight(aircraftId, dest)`:
  - sets the aircraft config;
  - sets `operations.profile = null` and phase `'airborne'`;
  - sets the altitude to `max(dest.altM, ground + 450 m)`, with the
    destination's heading and cruise speed;
  - arms the warp trim, then calls `sync()` (far-warp hold, crash disarm).

  `launchGlider` is unchanged, byte for byte.
- `runtime.stageDestination(dest | airportId)`: `warpToGeo(…, {stage:true})`
  while the menu stays open, then a 4 Hz readiness poll that publishes
  `runtime.staging {key, ready, readyMs, progress, missing, warped, …}`.
  - A destination within 0.5 km of the flight does not warp.
  - Ops airports stage only when they are more than 50 km away, so the
    Columbus cluster never stage-warps.
- `runtime.launchSetup(setup)` is what Continue calls. It relaunches free,
  ops or glider setups, persists them, and closes every menu.
- `runtime.titleSpot` is set by staging and by free launches. The title
  camera reads `runtime.titleSpot ?? spawn.title`.
- `exitToTitle(runtime)`, `hangarToTitle()` and `enterHangarFromTitle(mode)`
  live in `lib/fly/front-door.js`.

### Storage

| Key | Contents |
| --- | --- |
| `fly-last-setup-v1` | The last launch (free: aircraft + destination; ops: aircraft, airport, start mode). It is validated on read; corrupt or ineligible data reads `null` and hides Continue. |
| `fly-visuals` | An explicit Visuals pick (written only by the Settings row). |
| `fly-aircraft`, `fly-departure`, `fly-map-style-2` | Unchanged. They are still written. |

### Flags

All in the R25 owner blocks at the end of `lib/fly/fly-constants.js`:

| Block | Owner | Contents |
| --- | --- | --- |
| `FRONT_DOOR` | A | `enabled`, `titleZ 45`, `bootCompact`, `exitToTitle`, `orbit {periodSec 240, reducedMotionPeriodSec 900, radiusM 2600, aglM 900, minAglM 350, fovDeg 52, easeSec 2.5, pitchDeg 16}` |
| `VISUALS` | A | `key 'fly-visuals'`, `defaultProfile` (see below) |
| `FLIGHT_PLAN` | B | `enabled`, `lastSetupKey`, `stage {enabled, hzDesktop 10, hzPhone 4, debounceMs 400}`, `freeFlight {minAglM 450, cityOffsetM 3000, fallbackAltMslM 800}`, `titleSpot {preferDaylight, minSunElDeg 8, fallbackId 'grand-canyon', toyId 'manhattan'}` |
| `R25_SKY` | C | Sub-flags `model`, `skyDip`, `aerialSun`, `cloudAir`, `retireStack`, `iblAlign`, `exposure` (visuals pass) |
| `R25_GROUND` | D | Sub-flags `relief`, `oneSun`, `colorRef`, `sharpen`, `retireQuilt`, `mesh` (launch-applied), `budget` (visuals pass) |
| `R25_CERT` | E | Luminance, horizon and relief bounds shared by the C/D/E instruments |

**Branding is the one change that is not behind a flag.** Metadata cannot sit
behind a runtime flag.

### Visuals profile

`lib/fly/visuals-profile.js` holds the one predicate:
`r25On(block, sub)` = the block is enabled **and** the sub-flag is not
disabled **and** the live profile is `'enhanced'`. Every C/D decision point
goes through it: shader text, program cache key, CPU uniform writes and
allocations. So Classic produces today's text and keys by construction.

The profile resolves in this order:

1. the dev/graphicsReview pin `__flyVisualsOverride`;
2. the stored `fly-visuals`;
3. `VISUALS.defaultProfile`, when `visualsAvailable()`;
4. `'classic'`.

`visualsAvailable()` is `R25_SKY.enabled || R25_GROUND.enabled`, and it is
**false on this tree**. So the profile is forced to Classic and the Settings
Visuals row is hidden. The default follows the rule "`'enhanced'` only if an
Enhanced visual sub-flag ships ON". The intro pass therefore sets it to
`'classic'`, which changes no behaviour while nothing Enhanced exists. **The
visuals pass revisits this.**

### Harness posture

The legacy fleet pins `__flyTitleBypass = true` and
`__flyVisualsOverride = 'classic'` in both legs of `scripts/_boot.js` and
`scripts/_mobile-boot.js`. It therefore boots today's hangar, and the airborne
skip closes it, so no frozen number can move. The R25 gates un-pin these via
`unpinPins`. `scripts/_title.js` and `scripts/_skip-menus.js` (`enterHangar`,
`enterFlight`) walk the title. The ops harnesses call `enterHangar(page, 'ops')`
after every `goto`.

## Verification

Commands use direct Node, because the Windows npm launcher is broken. In the
container, browser gates run as
`node -r ./scripts/_pw-shim.js scripts/<gate>` with `FLY_TILE_FIXTURE=1`; on
the user's machine they run as plain `node scripts/<gate>`.

### Node gates (final intro tree)

These ran on the final intro code (`480ba99`, the ship-state commit); the
record's own commit adds only docs and E's harness edits.

| Gate | Result | Baseline |
| --- | --- | --- |
| `verify-import-integrity.mjs` | 4 passed / 0 failed | 4 / 0 |
| `verify-r25-front-door.mjs` (A) | **70 / 0**: resolvers, predicates, the `escapeStep` table, `frameloopFor`, `exitToTitle` resets, visuals precedence, the title camera (incl. exit-to-title blends from any flight end), the audio bed | RED on r25-w0: 21 / 15 |
| `verify-r25-flight-plan.mjs` (B) | **44 / 0**: 11 destinations and clearances, Atlas ranking parity over 60 queries, the last-setup round trip plus 16 corrupt/ineligible rows, daylight spot under pinned clocks, placement for 9 aircraft | RED on the W0 stubs: 4 / 37 |
| `verify-r25-flagoff.mjs` (E) | 8 PASS / 0 FAIL / 2 NOT CALIBRATED (exit 2). Classic terrain == flag-off byte for byte; the Classic hooks write nothing; constants outside the six R25 blocks == r25-w0. The two NC rows are the Enhanced arms (nothing Enhanced exists). | RED (`R25_FLAGOFF_RED=1`): 9 / 3 |
| `verify-mobile-actions-node.mjs` | 16 / 16 | 9/9 at W0 (+ the R25 Esc/Back cases) |
| `_r25-product-boot.js` self-check | 6 / 6 | — |
| `_r25-xboot.js` self-check (the cross-boot and toggle-applicability rules of `verify-r25-visuals`, added at this close) | 10 / 10 | RED first: a pair outside the bound with no floor, a pair worse than its floor, and a floor that resolves the bound all read FAIL |
| `graphics-unit.mjs` · `verify-flight-operations.mjs` (33) · `verify-stylized-earth.mjs` (22/22) · `verify-c-flagoff.mjs` (58) · `verify-vendor-three-tile.mjs` (34/0) · `verify-living-earth.mjs` (19) · `verify-cinematic-flight.mjs` (16/16) · `verify-operations-disclosure.mjs` | all PASS | = W0 |
| `verify-lod-fade.mjs` | 60 / 4, the same four lines | pre-existing at `2c624a3` |
| `verify-atmo-law.mjs` | crashes (`setAerial` TypeError) | pre-existing at `2c624a3` |
| targeted eslint | Contrail 3e · FlyCanvas 1e · FlyScene 0e/2w · PlayerPlane 2e/2w · use-fly-audio 1e; every other R25 file 0 | = the W0 addendum |

### Fixture browser rows (offline world fixture, SwiftShader)

The per-run detail is in the E ledger, [`scripts/r25-e-cert.md`](scripts/r25-e-cert.md)
§4d, §4e and §4f.

The tree for each row is one of three:

- **§4d**: the first integration of r25/e, r25/a and r25/b.
- **§4e**: the final intro tree `a509647`.
- **close**: `480ba99`, which is `a509647` plus the ship-state commit.

The fixture server is in-process, `FLY_BOOT_SCALE=3`, with load 4–9 on 4
cores.

| Row | Result | Tree |
| --- | --- | --- |
| `verify-r25-smoke` toy: the flow smoke | **18 PASS / 0 FAIL / 1 NOT CALIBRATED**. The title is in the DOM at 1.4 s at pct 0; Free Flight → bizjet at AGL 938 m; Exit to title with no reload; Continue restores the persisted setup; the T&L KOSU apron departure parks; zero page errors. The NC is (2h): no spot opportunity on the fixture's static fleet. Title (t8) certifies that property instead, with a real acquisition. | §4e |
| `verify-r25-smoke` satellite | every product leg PASS. Title spot Tokyo; the world revealed at 1075.6 s; Free Flight, exit, Continue and the KOSU apron all PASS. The pinned legacy satellite boot, re-proved standalone, reveals in 845.1 s with zero page errors. | §4d |
| The smoke's four title-era REDs (`title`, `reload`, `continue`, `mirror`) | each **exits 1 on its expected legs** | §4d |
| `verify-r25-title` toy + phone + attr | toy **16/0/0**. (t11) exit to title now BLENDS from a KOSU flight ~800 km from the title spot: blends 0→1. (t6) radius error 0.00 %. (t8) is a real title acquisition with the passport unchanged. Phone portrait and landscape and the attribution legs are green; their only §4d red was (t11). | §4e / §4d |
| `verify-r25-title` satellite | **6/0/0**. (s2) spot Yosemite, radius 3200 m, error 0.00 %. The old gate would have read 23.1 % there. The world revealed after 444 s with the orbit away from `flight.pos`. | §4e |
| `verify-r25-freeflight` toy | **6/0/1**. It staged Tokyo from the Manhattan title (`warped true`); placement 0.00 m; heading error 0°. The NC is (6): toy staging cannot finish behind the hangar at ~0.4 fps. | §4e |
| `verify-r25-freeflight` satellite | **6/0/0**. Staging was ready behind the hangar in 405 s. The staged hold was **6.8 s**, against an unstaged control still holding after **88.6 s**. | §4d |
| `verify-r25-continue` toy | **5/0**: exact relaunch of a free flight (Δ 0.000 m) and of an ops runway flight (10R, Δ 0.000 m); corrupt storage hides Continue | §4d |
| `verify-r25-hangar-edges` | **5/0**: Esc clears a query; Esc inside the hangar → title; late-runtime staging, free and ops | §4d |
| `verify-r25-visuals` (FORCED; the Classic cross-boot against a live `r25-w0` server) | **8 PASS / 0 FAIL / 14 NOT CALIBRATED**, re-derived under the committed rule. The raw run read 13/2/11: both FAILs were instrument applicability, with a Classic/Classic pair judged as Enhanced at Manhattan (§4f). Draws: Owens **132 ≤ 261**, Manhattan **175 ≤ 375**, toy **148–183 ≤ 480**. Texture peak **109–113 MiB ≤ 300**. **Triangles equal the flag-off tree's exactly**: 148,871 and 541,874. Cross-boot Owens **PASS** at 0.124 / 2. Manhattan is **NOT CALIBRATED** at 0.552 / 10: two boots of the flag-off tree itself differ by 2.031 / 33 there (Owens: 0.531 / 11), because of a clock-driven sky cloud pass, steam plumes and facade shimmer. Smokies never settled in either session. The toggle, luminance and Enhanced rows are NOT CALIBRATED: nothing Enhanced exists. | close |
| Product boot to the title, toy, ABABAB against a same-session `r25-w0` | **NOT CALIBRATED**: each arm's own spread (21.9 % / 5.9 %) exceeds the 5 % bound. Medians: int **51.8 s** vs W0 **56.4 s** (×0.918). W0's number is pct 100 *behind* the opaque hangar; the player sees that world only after Fly, at 65–81 s. | close |
| Production build receipt | **PASS**. `ground-night-build.cjs --dist=.next-r25`: Next.js 16.1.0, compiled in 41 s, 8/8 static pages. Commit `480ba99`, buildId `SQBH24tF02qNzB6XnJcQJ`, sourceSha256 `116fb07f…fbaf2e`. Recomputed at the close's final head, the hash is identical: only docs and scripts changed after `480ba99`. | close |
| Title smoke against `next start` (`.next-r25`, port 3036, `?graphicsReview=1`) | **16 PASS / 0 FAIL / 3 NC**. The page title reads "Skyloom - Fly the living Earth". The title is in the DOM at 538 ms; Free Flight → hangar → Fly is airborne at 938 m AGL; Exit to title with no reload; Continue relaunches the persisted setup; the KOSU apron departure parks; zero page errors. Two NCs need dev-only handles; the third is (2h). | close |
| The pinned legacy fleet boot (`bootFly`) | toy reveals in 47.0 s; satellite in 845.1 s; no title, Classic, zero page errors | §4e / §4d |
| `verify-operations-touch` / `-keyboard` / `-browser` through the title | **Venue-limited → user machine.** Touch BLOCKED on its hard 90 s readiness; keyboard hit its 60 s Fly-enable wait; browser hit a 60 s click ack. The title entry itself passed in all three. | §4d |

### Unmeasurable here (the user's machine)

- Every fps, frame-time, stall and boot-wall-time figure. SwiftShader runs at
  1–3 fps with load 4–8 on 4 shared cores.
- How the title orbit feels: the 240 s period, 2.6 km radius, 16° pitch and
  2.5 s blend (tune in `FRONT_DOOR.orbit`). Also how the exit-to-title blend
  looks at real frame rates.
- That the first title click audibly unlocks audio (iOS Safari especially),
  and that the engine bed is silent on the title and returns at launch.
- Real terrain clearance at the 11 spots (the fixture DEM is synthetic), and
  the daylight pick against a real clock and sky.
- Staging wall time and warp-hold length on real hardware and networks.
- SPICY suppression on the title: the fixture fleet has no qualifying contact
  near a title spot.
- Phones: real safe-area insets, real touch, the bottom sheet, and the stage
  pump's cost with two WebGL contexts.
- The title over real Esri imagery and live traffic.
- The ops harnesses end to end through the title (below).

## User-machine run list

Windows PowerShell, from the repo root:

```powershell
# 1. Dev server (the npm launcher is broken on this machine)
node node_modules/next/dist/bin/next dev -p 3027

# 2. The intro walk (by hand, desktop, satellite):
#    title -> Free Flight -> Grand Canyon -> Fly; pause -> Exit to title;
#    Free Flight -> Swiss Alps; search a city (e.g. "Denver") -> Fly;
#    pause -> Exit to title -> Continue (must relaunch the Denver setup);
#    Takeoff & Landing -> KCMH, Ready on the runway -> Fly -> take off.
#    Check: the orbit, the blend out of the chase view, sound silent on the
#    title and back in flight, Esc/Back from the hangar, Settings sheet.

# 3. The browser gates against the live server (second terminal)
$env:FLY_URL = "http://localhost:3027"
node scripts/verify-r25-smoke.cjs
$env:R25_SMOKE_STYLE = "satellite"; node scripts/verify-r25-smoke.cjs; Remove-Item Env:R25_SMOKE_STYLE
$env:R25_TITLE_LEGS = "toy,phone,sat,attr,attrsat"; node scripts/verify-r25-title.cjs; Remove-Item Env:R25_TITLE_LEGS
node scripts/verify-r25-freeflight.cjs
$env:R25_FF_STYLE = "satellite"; node scripts/verify-r25-freeflight.cjs; Remove-Item Env:R25_FF_STYLE
node scripts/verify-r25-continue.cjs
node scripts/verify-r25-hangar-edges.cjs
node scripts/verify-operations-browser.cjs
node scripts/verify-operations-keyboard.cjs
node scripts/verify-operations-touch.cjs
# The product-boot comparison (time to a live world), both styles: run once
# on this tree and once on a checkout of the r25-w0 tag served on another
# port, e.g. 3028, then compare the medians:
$env:R25_BASELINE_TAG = "user"; $env:R25_BASELINE_PRODUCT = "3"; $env:R25_BASELINE_POSES = "0"
$env:R25_BASELINE_PRODUCT_ARMS = "w0=http://localhost:3028,int=http://localhost:3027"
$env:R25_BASELINE_PRODUCT_STYLE = "satellite"; node scripts/r25-e-baseline.cjs
$env:R25_BASELINE_PRODUCT_STYLE = "toy"; node scripts/r25-e-baseline.cjs
Remove-Item Env:FLY_URL, Env:R25_BASELINE_TAG, Env:R25_BASELINE_PRODUCT, Env:R25_BASELINE_POSES, Env:R25_BASELINE_PRODUCT_ARMS, Env:R25_BASELINE_PRODUCT_STYLE
```

4. **Phone on the LAN.** Start the dev server with `-H 0.0.0.0`, then open
   `http://<pc-ip>:3027` on the phone. Walk the title in portrait and
   landscape: the cards, Settings as a bottom sheet, Back on the title root
   and in the hangar, a Free Flight and a Takeoff & Landing launch, and Exit
   to title. Check that the Esri credit stays visible on the title.
5. **Production build**, as a spot check:
   `node node_modules/next/dist/bin/next build`.

## Ship state at the intro close (historical)

| Flag | State | Evidence / reason |
| --- | --- | --- |
| `FRONT_DOOR.enabled` | **ON** | front-door 70/0; title toy 16/0/0 and satellite 6/0/0 (+ phone and attr legs); smoke toy 18/0/1, satellite every product leg; production smoke 16/0/3 |
| `FRONT_DOOR.bootCompact` | **ON** | smoke (2b): the title is interactive at boot pct 0, in dev and production; title (t1) and (s1) |
| `FRONT_DOOR.exitToTitle` | **ON** | smoke (5) with no reload, in dev and production; title (t11) blends (the E2 fix) |
| `FLIGHT_PLAN.enabled` | **ON** | flight-plan 44/0; freeflight toy 6/0/1 and satellite 6/0/0; continue 5/0; hangar-edges 5/0; smoke (4) (6) (7) |
| `FLIGHT_PLAN.stage.enabled` | **ON** | freeflight satellite: staged hold 6.8 s against an unstaged 88.6 s+; toy (2) staging progresses |
| `VISUALS` (profile plumbing) | **Row hidden; profile forced Classic** | `visualsAvailable()` is false while `R25_SKY` and `R25_GROUND` are off. Smoke (3b) reads the row HIDDEN in dev and production. |
| `VISUALS.defaultProfile` | **`'classic'`** | The Visuals-default rule: `'enhanced'` only if an Enhanced visual sub-flag ships ON. None does. There is no behaviour change today. **The visuals pass revisits it.** |
| `R25_SKY` (all sub-flags) | **OFF**, untouched | The visuals pass has not been built |
| `R25_GROUND` (all sub-flags, incl. `mesh`) | **OFF**, untouched | The visuals pass has not been built |
| `R25_CERT` | bounds only | Shared by the C/D/E instruments |
| Branding ("Skyloom") | **shipped, not flagged** | Metadata cannot sit behind a runtime flag. The passport key and the OG URL are unchanged. |

## Visuals (C SKY / D GROUND) — scope recorded at the intro close

The following is the original unbuilt scope. It is superseded for implementation
status by [the resumed visual record](CLEAR_SKY_VISUALS.md).

**None of this exists on the tree yet.** `R25_SKY` and `R25_GROUND` ship
`enabled:false`, and their stub bodies (`lib/fly/r25-sky.js`,
`lib/fly/r25-ground.js`) are the W0 no-ops. The Settings Visuals row is
hidden, and every session renders Classic, which is today's pixels. The
visuals pass builds the following, per the plan's C and D charters:

- **C SKY:** one analytic atmosphere (`sky-model.js`: Rayleigh plus
  Henyey-Greenstein Mie) feeding the rim, void, fog, haze, clouds and IBL
  alignment. It adds a 16–22 km cloud fade, sun-angle aerial in-scatter and
  pre-curve exposure.
- **D GROUND:** DEM relief normal maps, one bounded sun term replacing the
  0.70 darkening, low-frequency imagery colour transfer (retiring
  `SAT_QUILT`), magnification sharpening at high tier, and the
  launch-applied mesh sub-flag.

It then:

- adds the Enhanced columns to `verify-rim`, `verify-sat-depth`,
  `verify-dusk`, `verify-sat-night` and `verify-aerial` (all **PENDING**);
- runs the Enhanced, toggle and luminance legs of `verify-r25-visuals.cjs`
  (**NOT CALIBRATED** on this tree);
- sets the `VISUALS.defaultProfile` ship state;
- adds the user-machine Visuals A/B at four spots and a memory audit.

It starts from the pushed intro tree. "Flag-off identity" then means identity
with that tree.

## Follow-ups

- **The visuals pass (C/D), in progress.** It sets the Visuals default back
  to `'enhanced'` when a C/D Enhanced sub-flag ships ON (the user's "Default
  Enhanced").
- **The product-boot timing needs the user's machine.** On the fixture the
  toy comparison read NOT CALIBRATED (the venue's spread is larger than the
  5 % bound), with the integration median faster. The satellite comparison
  costs 15–18 minutes per boot here and was not run.
- **The ops harnesses through the title are venue-limited here:**
  `verify-operations-touch` BLOCKED on its 90 s readiness bound,
  `-keyboard` on its 60 s Fly-enable wait, `-browser` on a 60 s click ack.
  They belong to the user's run list above. The T&L flow through the title is
  certified here by the smoke's leg (7), a KOSU apron departure that parks,
  in both styles.
- **29 direct-`goto` harnesses** have been stale since `2c624a3`: they warp
  under the menu. Each needs one line, `await enterFlight(page, geo)` from
  `scripts/_skip-menus.js`. The list is in `scripts/r25-e-cert.md` §5a.
- **Esc → title is written in two places**: B's hangar, for focus inside it,
  and A's window chain. The two copies share one rule, so if A changes the
  rule, the hangar's `toTitle()` must follow.
- **The phone Logbook covers the credit.** This is pre-existing R16 behaviour
  in `Logbook.jsx`, in flight too.
- **Searched cities on high ground** (Denver, La Paz) rely on the DEM being
  resident at launch. Featured spots carry authored clearances.
- **Pixel instruments for the visuals pass** (found at this close,
  `scripts/r25-e-cert.md` §4f). **Two boots of the same Classic tree differ
  by more than the 0.5 / 2 identity bound on the fixture**: Owens 0.531 / 11,
  Manhattan 2.031 / 33. Before the Enhanced columns can resolve anything:
  - freeze the clock-driven fullscreen sky cloud pass (C's
    `__flyCloudFreeze`) and the facade shimmer;
  - park the sat-veg boats and steam plumes by layer in `hideActors`;
  - make `verify-r25-visuals` (7a) wait for toy readiness;
  - give the Smokies pose (P5) more than 1,200 s, or read it on the user's
    machine.
- **Pre-existing reds, not made worse:** `verify-lod-fade` 60/4 (patch-7 /
  marker-count stale against the Motion-Hold vendor edits) and
  `verify-atmo-law`, which crashes in `setAerial`.
- **Deferred to R26:** GPU texture compression and the z13/z14 mesh budget.
  Buildings, trees and water are out of R25's visual scope.

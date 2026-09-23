# R25 B FLIGHT PLAN — ledger

Branch `r25/b` (from `r25-w0`, E1 marker `28cafb1` merged). Plan:
FLY_ROUND25_PLAN.md "B — FLIGHT PLAN". Flag: `FLIGHT_PLAN.enabled` —
**flipped `true` on this branch** once the node gate and the toy fixture flows
were green (see §4). FRONT_DOOR stays off here (A's flag); every B path is
written to work with and without the title.

## 1. What was built

| Piece | Where | Notes |
|---|---|---|
| `runtime.launchFreeFlight(aircraftId, dest)` | `lib/fly/operations-runtime.js` | Generalises `launchGlider` + the `_boot.js` airborne skip: aircraft cfg, `operations.profile=null`, phase `airborne` (+ `operations.warp` resets), altitude `max(dest.altM, ground + minAglM)` (ground = DEM sample, else the destination's authored ground), destination heading, cruise speed, `armWarpTrim`, then `sync()` (far-warp hold, crash disarm). Publishes `runtime.lastLaunch` + `runtime.flightPlanDest`. |
| `launchGlider` | same | **Unchanged byte-for-byte** (the KOSU practice alias; the gate compares the code lines against `r25-w0`). |
| `runtime.stageDestination(dest \| airportId)` | same | `warpToGeo(lat, lon, {altM, headingRad, stage:true})` (W0 allows stage warps in menus; the flight stays frozen in phase `hangar`), then a 4 Hz readiness poll → `runtime.staging {key, dest, since, ready, readyAt, readyMs, progress, missing, warped, polls, pumped, launched}`. Already within 0.5 km ⇒ no warp. Readiness = `worldReadiness` (satellite, with WarpFlash's 600 ms settle past the flash) or WarpFlash's toy chunk test (after `holdMinMs`). Ops airports stage only when > 50 km away (the Columbus cluster never stage-warps, so today's ops flows are untouched). |
| Frame pump fallback | same | A's `<StagePump>` mounts only under `FRONT_DOOR.enabled`. With the front door OFF nothing would render the `'demand'` canvas behind the hangar, so the staging poll calls r3f `invalidate()` at 4 Hz — **only** when FRONT_DOOR is off, the hangar is open, the tab is visible and staging is unready. With the front door on it never pumps (node gate 7d: 4 pumps off, 0 on). |
| `runtime.launchSetup(setup)` | same | free → `launchFreeFlight`; ops glider → `launchGlider`; ops → `beginDeparture`. Persists `fly-last-setup-v1` + `fly-aircraft` (+ `fly-departure` for ops), sets `flightMode`, closes every menu (`setHangarOpen(false)` → screen `flight`, also leaving the title). A's Continue calls this. |
| `runtime.readLastSetup()` | same | Harness handle to the validated last setup (the title imports the module directly). |
| 11 destinations | `lib/fly/destinations.js` | Grand Canyon, Manhattan, Swiss Alps (Lauterbrunnen), Rio, Tokyo, Yosemite, Sydney Harbour, Dubai, Nāpali Coast, Geirangerfjord, Columbus (practice = KOSU 09R +600 m). Each: `lat, lon, groundM, clearM, altM, headingDeg, tz, glyph, blurb, title{radiusM, aglM}`. `clearM` = highest named summit/structure within 5 km (sources inline); `altM ≥ clearM + 400`. |
| Atlas search extraction | `lib/fly/poi/search.js`, `components/fly/hud/Atlas.jsx` | `rankAtlasEntries` (the exact Atlas ranking) + `warpOptsFor(entry, rand = Math.random)`; Atlas imports both (behaviour identical, gate 2b/2c). |
| `lib/fly/flight-plan.js` | | `FEATURED_DESTINATIONS`, `searchDestinations` (featured first, accent-folded, then the Atlas ranking; ≤ max; duplicates collapse onto featured), `resolveDestination`, `destinationFromEntry` (city/airport/landmark start `cityOffsetM` out with the sun behind; military/hotspot keep the Atlas 4 km / 1,200 m arrival with a deterministic bearing), `freeFlightPlacement`, `validateSetup` / `normalizeSetup` / `readLastSetup` / `saveLastSetup` / `describeSetup`, `pickTitleSpot`, `resolveInitialSpawn`, `defaultDestination`. |
| Adaptive hangar | `components/fly/hud/GroundHangar.jsx`, `hud/operations.css` | Header `hangar-back` ("‹ Title", pre-flight only, only with FRONT_DOOR on) + `hangar-mode[data-mode]`. Ops mode = today's panel exactly. Free mode = `FreeDispatch`: `hangar-dest-search` / `#free-flight-search`, featured grid `hangar-dest-{id}`, results `hangar-dest-result-{n}` (≤ 6, arrow keys + Enter), `hangar-dest-selected[data-dest]`, `hangar-stage-status[data-state=idle\|pending\|staging\|ready\|unstaged]`, `hangar-fly` = "Fly to {name}". Debounced (`stage.debounceMs` 400) staging on every pick; default destination = where the flight already is (the title spot), so a first flight needs no staging. Every launch saves the last setup; `fly-aircraft` / `fly-departure` are still written. |

### Decisions made without asking (plan-implied)
- **resolveInitialSpawn returns KOSU whenever the session does not open on the
  title** (flag off, the harness bypass pin, *or FRONT_DOOR off*): the title
  spot only means something when there is a title. With FRONT_DOOR off the
  product still boots into today's ops hangar at KOSU.
- A searched city starts 3 km **south** of it facing north (north of it facing
  south in the southern hemisphere) — the sun behind you, deterministic, so
  Continue is exact. Military/hotspot keep the Atlas arrival but with a
  hash-of-key bearing instead of `Math.random` (the Atlas itself still uses
  `Math.random`, gate 2c).
- Featured setups persist by id (rehydrated from the catalog); searched ones
  persist their resolved start (exact relaunch).
- Title spot scoring: sun elevation in `[minSunElDeg, 50]°`, score
  `1 − |el − 30|/50`, +0.5 golden-hour bonus at `el ≤ 18°`; Columbus practice
  is not a candidate; toy → Manhattan.
- Staging and every Free Flight launch set `runtime.titleSpot` to the
  destination's `{radiusM, aglM}` (A's title camera reads `runtime.titleSpot ??
  spawn.title`), so "‹ Title" from the hangar orbits the staged spot with its
  own orbit, and Exit-to-title after a free flight uses that spot's. Ops
  launches leave it untouched (the airport has no curated orbit).
- `describeSetup` returns the detail only ("Skylark · Free Flight over Grand
  Canyon", "Vector · KCMH · Runway") — A's title renders "Continue" before it.

## 2. RED first

### verify-r25-flight-plan.mjs (node) — `R25B_RED=1` loads flight-plan.js, operations-runtime.js and GroundHangar.jsx at the `r25-w0` tag
```
verify-r25-flight-plan (RED: r25-w0 stubs): 4 passed / 37 failed
```
The 4 PASS rows are the identity rows that MUST pass on W0 (2a the reference
is the tag's own code; 4a flag-off = KOSU literal / no write / null read; 7h
launchGlider + sync bodies = tag; 8a flag-off hangar markup = tag). Every
feature row FAILs (no destinations module, no search.js, stubs return
[]/null, no launchFreeFlight/stageDestination/launchSetup, no free hangar).

### verify-r25-freeflight.cjs (toy fixture) — FLIGHT_PLAN off (the r25-w0 hangar)
```
FAIL  (1) FREE HANGAR ... — mode null · cards 0 · default null · ops panel 1
FAIL  (2)-(6) — free hangar absent
PASS  (7) ZERO page errors across the session  — clean
verify-r25-freeflight (toy): 1 passed / 6 failed
```

## 3. The venue, measured (why two fixture rows read the way they do)

`scripts/r25-b-probe.cjs` (scratch probe, toy fixture, FRONT_DOOR off, free
hangar open): the hangar's own preview canvas (`HangarScene`, frameloop
'always', shadows) saturates the SwiftShader main thread, so the staging
poll — and with it B's 4 Hz fallback pump — runs at ~0.4 Hz and the world
behind the hangar renders ~0.4 fps (frames 6 → 45 in ~110 s). The toy ring at
the destination grows (chunks 21 → 154) but **no chunk reaches `ready` in
~45 frames** — a toy boot needs a few hundred frames. Two consequences, both
the venue's:
- staging "ready" is not reachable in a bounded toy fixture run; the gate
  therefore certifies PROGRESS (the charter's wording) and records readiness;
- Playwright's `click()` actionability ("stable" = 2 rAFs with one box) timed
  out at 20 s on a visible hangar button (rAF pairs took up to 4.3 s); the
  fixture gates click normally first and fall back to the DOM `click` event,
  asserting the EFFECT (counted in the report as `presses`).

## 4. Results (green, FLIGHT_PLAN on)

| Gate | Verdict | Evidence |
|---|---|---|
| `verify-r25-flight-plan.mjs` (node) | **PASS 44/0** | RED 4/37 on the r25-w0 stubs (§2) |
| `verify-r25-freeflight.cjs` toy fixture | **PASS 6 / FAIL 0 / NOT CALIBRATED 1** | Confirmed on the final tree (`freeflight-toy-4.log`, legs (1)–(5), (7) PASS; placement 0.00 m, Brooklyn 0.0 m / 800 m / no crash). Its (6) printed FAIL (staged 7.4 s vs unstaged 5.0 s) **with staging NOT ready at launch** — so nothing staged was compared; the rule now requires that precondition and reads NOT CALIBRATED (re-derived from the recorded numbers; the gate was not re-run after that one-line rule change). Run 3 (`freeflight-toy-3.log`) was the same: 28.0 vs 10.2 s, staging not ready. The toy ring cannot finish staging in a bounded run behind the hangar here (§3); (6) is certified on SATELLITE below. Run 3 detail: (1) free hangar, default `columbus-practice`; (2) stage warp, frozen, frames +35, toy ring 18 → 115 chunks, status `staging`; (3) "Fly to Manhattan", placement 0.00 m, alt 950 = max(950, 0+450), heading error 0.0000°, cruise 60 m/s; (4) no crash 10 s (min AGL 773 m); (5) "Brooklyn" → `poi:city:Brooklyn`, placement 0.0 m, 800 m, nose north, no crash; (6) **NOT CALIBRATED** — toy far-warp holds are time-capped (ARRIVAL_GATE 6.5 s) and both arms overran it on a starved poll (staged-not-ready 28.0 s vs unstaged 10.2 s): the toy venue cannot separate them; (7) zero page errors |
| `verify-r25-freeflight.cjs` **satellite** fixture (the one satellite confirmation) | **PASS 6 / FAIL 0 / NOT CALIBRATED 0** (+ (5) skipped: not satellite-specific, certified on toy) | `freeflight-sat-1.log`: (2) staging **reached ready behind the hangar in 368 s** (readiness progress 0.67 → 1, the last missing part `terrain`; frames +91, 88 pumps, flight frozen, status `ready`); (3) placement 0.00 m, alt 950, heading error 0; (4) no crash (min AGL 937 m); **(6) staged hold 5,676 ms vs the unstaged Tokyo control still holding after 83,131 ms** (the satellite hold is content-gated and uncapped); (7) zero page errors |
| `verify-r25-continue.cjs` toy fixture | **PASS 5/0** | `continue-toy-2.log` (3 page loads, one context): (1) corrupt `fly-last-setup-v1` (unknown aircraft) → `readLastSetup()` null, app boots normally (no title on this tree; with a title the gate asserts no `title-continue`); (2) a Free Flight launch writes free · prop · manhattan; (3) Continue after a reload relaunches it: placement Δ 0.000 m, Δalt 0.000 m, Δheading 0; (4) Vector · KCMH · Runway relaunches lined up on 10R, Δ 0.000 m, Δheading 0, phase `parked`; (5) zero page errors. Run 1 read (3) FAIL "Δ 28.5 m" — the instrument compared LIVE poses and the toy flies on through its warp hold (Δalt and Δheading were exactly 0); fixed to compare `runtime.lastLaunch` placements + live ≤ 2 km. |
| import-integrity | PASS 4/0 | |
| legacy ops browser harnesses (`verify-operations-*`) | NOT RUN here | ops mode renders today's panel + the mode chip only (node 8b, byte-compared); ops staging is a no-op inside the Columbus cluster (node 7e). E's integration smoke covers the ops flow. |
| eslint (6 changed app files) | 0 errors / 0 warnings | baseline 0 |
| W0 node baseline: flight-operations 33, mobile-actions-node 11/11 (+5 pending, A's), operations-disclosure, graphics-unit, r25-flagoff 8/0/2 (constants hygiene PASS) | unchanged | |

## 5. Cost
- Draws / textures / shaders: **0** (DOM only; no new material, no cache key).
- Per-frame: nothing. Staging is a 4 Hz `setInterval` that stops at ready or
  launch; the hangar reads `runtime.staging` at 4 Hz for its status line.
- Bundle: ~11 destinations + a search over the existing Atlas list (already in
  the fly bundle).

## 6. Open risks
- **Searched cities on high ground**: the start is `max(800 m MSL, ground +
  450)` where ground is the DEM sample at launch. If the DEM under the start is
  not resident yet (launch before staging finished), a Denver/La Paz start
  relies on the flight model's soft floor during the far-warp hold (the Atlas
  has the same property today). Featured spots carry an authored ground +
  clear height so they never depend on the DEM.
- `clearM` values are from published summit / tower heights, not a DEM
  survey; the Geirangerfjord ring (1,750 m) is the least certain.
- The fixture's DEM is synthetic: fixture altitudes prove the arithmetic, not
  the real clearance.

## 7. Unmeasurable here
- Real terrain clearance at the 11 spots (needs real DEM — user machine).
- Staging wall time / warp-hold length on real hardware and real networks
  (fixture numbers are SwiftShader at 1–3 fps).
- The title-spot daylight pick as the user sees it (real clock, real sky).
- Phone layout of the free panel (CSS written for ≤650 px and landscape
  phones; no phone viewport run in this pass).

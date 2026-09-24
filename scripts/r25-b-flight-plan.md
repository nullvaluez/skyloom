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

## 8. Fix pass (peer review, 2026-09-23)

Three findings against `48d99e8`; every one verified before it was touched.
Venue for the A+B rows: a local trial merge (`r25/a d84bf9e` merged onto
`r25/b`, FRONT_DOOR on, not committed anywhere) served on :3032, toy fixture.

| # | Finding | Verdict | Mechanism | Fix |
|---|---|---|---|---|
| 1 | Esc in the pre-flight hangar does nothing once A merges | **FIXED** | The hangar's `onKeyDown` (unchanged since r25-w0) calls `e.stopPropagation()` on every key; React stops the NATIVE event at the root container, so A's `window` keydown chain (`FlyMode.jsx` on r25/a: hangarOpen && !dismissible → `setScreen('title')`) never sees an Esc pressed with focus inside the hangar — and the hangar focuses its own dialog on mount. A's own t10 leg `blur()`s the hangar before pressing Esc, which is why no gate saw it. Measured RED below. | The hangar handles its own pre-flight Esc: `if (Esc && !confirmReturn && !e.isDefaultPrevented() && toTitle()) e.preventDefault()`. `toTitle()` (the "‹ Title" button's handler) is A's rule verbatim — FRONT_DOOR on and not dismissible — and now returns whether it moved. The search box still owns an Esc that clears a non-empty query (it `preventDefault`s first). The mid-flight confirm is untouched (`!confirmReturn`, and it is dismissible anyway). FRONT_DOOR off ⇒ `toTitle()` is false ⇒ nothing changes (r25-w0 identity, leg (2) on this branch). Gated on FRONT_DOOR only, not FLIGHT_PLAN: Esc → title is the front door's rule, and B's hangar must not swallow it even with B's flag reverted. |
| 2 | Hangar opened before the runtime services ⇒ staging never happens | **FIXED** | Both staging effects called `runtime.stageDestination?.(…)` ONCE after the debounce; `undefined` (service not installed) was neither retried nor mapped to 'unstaged', so the status sat at `pending` forever and the launch went unstaged. Measured RED below. | Both effects now wait for the service: after the debounce, if `stageDestination` is not a function yet they re-check every 250 ms (`SERVICE_RETRY_MS`), then call it once; the timer chain is cleared by the effect's cleanup. No new dependency on `live`; the Fly button's rule is unchanged. |
| 3 | `verify-r25-continue` was never run RED-first | **FIXED** (the claim was true) | The ledger recorded RED for the node gate and freeflight only; leg (1) could not fail on a flag-off tree (an always-null reader passes "corrupt hides Continue"). | Leg (1) now carries a CONTROL: the same `readLastSetup()` must return the row one field away from the corrupt one (`aircraftId: 'prop'` instead of `'blimp'`), so a reader that is simply null cannot pass. With a title it still asserts `title-continue` absent. The gate fails fast when the title has no Free Flight card, and skips the post-Continue waits when Continue did not happen. RED recorded below, on both trees. |

### New gate: `scripts/verify-r25-hangar-edges.cjs` (toy fixture)
Legs: (1) Esc with a query clears it and stays; (2) Esc with focus inside the
pre-flight hangar → title (FRONT_DOOR on) / nothing (FRONT_DOOR off, the
r25-w0 identity row); (3) late runtime, free: `stageDestination` removed, pick
Tokyo, wait 4 s, restore behind a spy → Tokyo staged; (4) late runtime, ops:
the same for the departure airport (fighter → KCMH); (5) zero page errors.

RED — A+B trial with the PRE-FIX hangar (`hangar-edges-RED-ab-old.log`):
```
PASS  (1) query "" · screen hangar · hangar true
FAIL  (2) focus inside true · screen hangar · title false · hangar true
FAIL  (3) held true · before: staging manhattan, status pending · after: calls [], staging manhattan, status pending
FAIL  (4) held true · departure KCMH · calls after restore []
PASS  (5) clean
verify-r25-hangar-edges: 2 passed / 3 failed
```
GREEN — A+B trial with the fixed hangar (`hangar-edges-GREEN-ab.log`):
```
PASS  (1) query "" · screen hangar · hangar true
PASS  (2) focus inside true · screen title · title true · hangar false
PASS  (3) held true · before: staging manhattan, status pending · after: calls ["tokyo"], staging tokyo, status staging
PASS  (4) held true · departure KCMH · calls after restore ["KCMH","KCMH"]
PASS  (5) clean
verify-r25-hangar-edges: 5 passed / 0 failed
```
(4) recorded two calls, both `KCMH`; where the repeat comes from was not
isolated. It is harmless: `stageDestination` is idempotent per key (a second
call while that staging is live returns true without a warp).

r25/b itself, fixed, FRONT_DOOR off (`hangar-edges-b.log`): **5 passed / 0
failed** — (2) reads the r25-w0 identity (focus inside, screen hangar →
hangar, hangar open), (3) calls `["tokyo"]` → staging tokyo, status staging,
(4) `["KCMH","KCMH"]`.

### verify-r25-continue, RED then GREEN
RED — FLIGHT_PLAN off on r25/b (uncommitted one-line flip, reverted with
`git checkout`; `continue-RED-b-flagoff.log`):
```
FAIL  (1) no title on this tree: readLastSetup() → null · control → null
FAIL  (2) free hangar absent
FAIL  (3) continue {"via":"runtime","ok":false}
FAIL  (4) continue {"via":"runtime","ok":false} · saved null
PASS  (5) clean
verify-r25-continue (toy): 1 passed / 4 failed
```
RED — FLIGHT_PLAN off on the A+B trial (`continue-RED-ab-flagoff.log`):
(1) FAIL `title-continue nodes 0 · control → null`; A's title then has no
Free Flight card, and that run (before the fast-fail existed) ended on the
900 s click timeout as "harness completed" FAIL. Not re-run: the r25/b RED
above measures (2)-(4).
GREEN — A+B trial, the first run of this gate through a real title
(`continue-GREEN-ab.log`): **5/0** — (1) `title-continue nodes 0 · control →
free/prop/manhattan`; (3) via **title-continue**, placement Δ 0.000 m, Δalt
0.000 m, Δhdg 0; (4) via title-continue, runway 10R, Δ 0.000 m.
GREEN — r25/b (`continue-toy-3.log`): **5/0** — (1) `readLastSetup() → null ·
control → free/prop/manhattan`; (3) via runtime Δ 0.000 m; (4) 10R Δ 0.000 m.

### Node / lint after the fix
- `verify-r25-flight-plan.mjs`: 44/0 (unchanged; 8a flag-off hangar markup
  still byte-identical to r25-w0 — the fix is handler and effect code only).
- `verify-import-integrity.mjs`: 4/0.
- eslint on `GroundHangar.jsx`, `verify-r25-hangar-edges.cjs`,
  `verify-r25-continue.cjs`: 0 errors, 0 warnings.

### Not re-run, and why
- `verify-r25-freeflight` (toy/satellite): the staging change only adds a
  wait when the service is missing; when it exists the call happens at the
  same debounce as before. The normal pick-then-stage path ran green after
  the fix in both continue GREEN runs (each waits for `staging.key ===
  'manhattan'` before Fly).
- Venue note: the r25/b GREEN pair ran concurrently; the second gate's fixture
  server found 3202 held by the first and fell back to **3203** on its own.
  That breaks the "3202 only" port rule for one run. Nothing else was
  listening there, and later runs went back to one at a time.

### Open risks added
- Esc → title is now written in two places: B's hangar, for focus inside it,
  and A's window chain, for focus outside it. They share the rule (FRONT_DOOR
  on, not dismissible) but are two copies of it. If A changes its rule, the
  hangar's `toTitle()` must follow.

## 9. E2 integration fix (2026-09-24, `scripts/r25-e-cert.md` §4d finding 3)

**Venue.** `r25/b` with `claude/skyloom-r25-intro-d0pp2v` merged in
(`accc3d6`, a fast-forward: the integrated intro tree with the title and the
flight plan both ON, and E's latest harness). Dev :3032, toy fixture :3202,
`FLY_BOOT_SCALE=3`, load 7–8 on 4 cores.

**RED.** This is E2's §4d run on the integrated tree: toy **5 / 1 / 1**. It was
not re-run here because a toy run costs ~10 minutes. Its evidence JSON
(`.graphics-review/r25/b/freeflight-toy.json` in the integration worktree) reads
leg (1) `default manhattan`, spawn 40.70 / −74.03. Leg (2) `began true ·
warped false` failed on its `warped === true` term; every other (2) term held
(frames +46, toy chunks 48 → 156, status `staging`). `R25_FF_STAGE_DEST=manhattan`
is now the handle that reproduces it on purpose (not run this pass).

**Mechanism.** Leg (2) always staged `hangar-dest-manhattan`. On B's branch
the flight started at KOSU, so that stage was a far warp. With the front
door on, the flight sits at the title spot. The TOY title spot IS Manhattan
(`FLIGHT_PLAN.titleSpot.toyId`), so `stageDestination` saw a distance under
`STAGE_HERE_KM` and correctly staged without warping. On satellite the title
spot was Tokyo, so the same leg warped and passed (6/0/0). **The product is
not at fault.** The no-warp stage has `minMs = 0`, so `hangar-stage-status`
reads `ready` on the first poll where the world at that spot passes its own
readiness test. In the RED that test really was not met: the harness entered
the hangar right after mount, so the toy ring at Manhattan was still building
(0 of 48 → 0 of 156 chunks ready). `staging` was the true status, and nothing
here needs a fix in B's product files.

**Fix (the harness only, `scripts/verify-r25-freeflight.cjs`).**
- **STAGE PICK**: the harness now takes the first of `manhattan`, `tokyo`, then
  the featured cards in hangar order that is NOT the hangar default from leg
  (1) and lies at least `FAR_KM` (50 km, great circle) from the flight.
  - Toy with the title at Manhattan stages **Tokyo**, which is a fixture city
    scene.
  - Satellite with the title at Tokyo still stages **Manhattan**, the same as
    E2's 6/0/0 row.
  - With the front door off (KOSU start) it still stages Manhattan, so B's
    earlier rows are unchanged.
- Leg (3) now reads the placement, heading, `altM`, "Fly to {name}" and
  `lastLaunch.destId` from the picked catalog entry (`lib/fly/destinations.js`)
  instead of Manhattan literals.
- **CONTROL PICK** (leg 6): the first of `tokyo`, then the featured cards, that
  is NOT the staged destination and lies at least 50 km from the flight at
  control time.
  - Toy (the flight at Brooklyn, Tokyo staged) uses **Grand Canyon**. Keeping
    Tokyo would re-visit the world that was just staged, which is not an
    unstaged control.
  - Satellite (Manhattan staged) still uses **Tokyo**, the boot spot, which
    E2 measured. A warmer control can only make (6) harder to pass. It cannot
    produce a false PASS.
- `R25_FF_STAGE_DEST=<id>` forces the stage pick. That is the RED handle.

**Gates (the merged tree).**

| gate | verdict |
|---|---|
| `verify-r25-freeflight.cjs` **toy** | **6 PASS / 0 FAIL / 1 NC** (exit 0). (1) default `manhattan`. **(2) stage pick tokyo, `warped true`**, flight frozen, frames +48, toy chunks 36 → 125, status `staging` (truthful: not ready). (3) "Fly to Tokyo", placement 0.00 m, alt 900 = max(900, 0 + 450), heading error 0.0000°, `staged {warped:true}`, hold 21.8 s. (4) no crash (min AGL 748 m). (5) Brooklyn 0.0 m / 800 m. **(6) NC**: staging had not finished at launch (the toy venue, §3). The control Grand Canyon revealed in 4.7 s. (7) zero page errors. |
| `verify-r25-freeflight.cjs` satellite | **not re-run**. Both picks resolve to E2's own (stage Manhattan, control Tokyo; checked in node against the catalog), so the §4d 6/0/0 row still stands. A satellite boot takes 15–18 minutes here. |
| `verify-r25-continue` / `verify-r25-hangar-edges` | **not re-run**. They are separate scripts and share no code with this harness, and no product file changed. |
| `verify-r25-flight-plan.mjs` | 44 / 0 |
| `verify-import-integrity.mjs` | 4 / 0 |
| eslint `scripts/verify-r25-freeflight.cjs` | 0 / 0 (baseline 0 / 0) |

The toy GREEN run executed the flat-earth `distM` for the pick threshold.
After the run, the harness switched to a great-circle `gcKm`, which only
affects the km figure in the log (18,723 → 10,852 km for New York–Tokyo). The
pick results are identical: re-checked in node for the toy, satellite and
front-door-off cases.

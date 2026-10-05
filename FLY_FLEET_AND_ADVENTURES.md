# Adventures Worth Flying — current implementation

Implemented on top of `0592f51` on 2026-10-01. The earlier Fleet & Adventures
record below is historical; this section describes the updated behavior.

- Six illustrated briefings lead into the existing hangar. All nine aircraft,
  earned liveries, per-aircraft estimates and Curated / Live conditions are
  available before launch. Previous aircraft choice is respected; changing an
  unfinished journey's aircraft or conditions asks before restarting it.
- Every journey retains four discoveries and has three optional activities.
  Authored contours, level passes and landmark arcs use directed gates with
  per-aircraft clearance tolerances and geometry. The controller keeps
  continuous measurements in memory and publishes only discrete progress.
- Activities can be skipped or retried individually from an authored approach.
  Discoveries and completed activities survive that retry. Activity records
  are saved immediately per route / aircraft / conditions, including when the
  player later starts a different aircraft. Completion grants Bronze, two
  activities Silver, and all three Gold. Previous medals never decrease.
- Compact blue discovery guidance and gold course gates share the synchronized
  HUD canvas. The next three gates and a direction cue keep the view readable.
  Discovery captions and separate audio cues respect existing mute/pause
  controls. Photo mode remains an explicit player action.
- A photograph must frame the named subject, be within range, have a clear
  known-terrain sightline and encode successfully. Position, camera projection,
  run token and warp epoch are captured before encoding. The debrief uses the
  player's current successful photograph, lists results and improvement hints,
  and previews an earned livery on the actual aircraft. Next adventure opens
  its briefing. Purchase-interest research lives in the journal.
- Version 2 stays inside `fly-adventures-v1`. Version 1 completions, medals,
  liveries and discovery indices migrate. Unfinished old journeys retain their
  original recommended aircraft; new activities begin unearned. Backup import,
  export and recovery accept both envelopes.
- Curated sun and cloud conditions use production environment state and the
  existing sky/weather systems. Explicit harness overrides retain precedence.
  Leaving for ordinary flight, operations or the title restores live conditions;
  failed launches roll back the environment. Classic/Enhanced and quality remain
  player choices. Aircraft paint/glass roughness and navigation-light size are
  refined without new aircraft geometry or altered flight physics.

Destination artwork is captured from the actual game, not external images.
See `public/adventures/README.md` for provenance and retained credits. The six
1280px WebPs total approximately 602 KB. Half Dome's photo target uses the
[climbing area's coordinates](https://www.mountainproject.com/area/105833395/half-dome)
rather than the airborne discovery position.

## Verification of this update

Node checks passed: adventure/assets/save safety 15, guidance 6, activity and
migration scenarios 8, runtime integration scenarios, real-camera photo checks
(composition, rebasing, occlusion, capture-time snapshots), adventure HUD isolation
(including an unfinished journey during ordinary Free Flight), front door 70, flight-plan
compatibility 44, operations 33, mobile actions 17, import integrity 4, visual
finish 12, cinematic flight 16, cinema environment/resources 15, immersive unit,
cloud/road paths 10 and cloud-shadow range 2. Scoped ESLint has zero errors
(four existing-style plain-image warnings). Production webpack build passes.

`node scripts/verify-adventure-flight.mjs` flies all 54 route/aircraft combinations
and 108 activity courses through the unchanged `FlightModel` using steering,
pitch and cruise commands. It never teleports after an authored approach or
writes progress. Every first discovery occurs at about 25 simulated seconds;
recommended main routes take 5–7 minutes, plus optional detours. This proves
control feasibility, ordering and estimates. It does **not** simulate live DEM
streaming or certify enjoyment. `scripts/adventure-browser-pilot.js` provides
reversible control-only driving for live review; it is not production code.

Local review evidence is under `.graphics-review/adventures-worth-flying/`.
The real-world Canyon route completed through the normal input controller in
336.48 simulated seconds (338.02 wall seconds), with all four ordered discoveries
and a minimum observed clearance of 691 m. No poses, timestep, speed or progress
were overwritten after launch. The optional contour and overlook courses also
completed through steering/pitch/cruise input, from their normal retry approaches
(75.75 and 98.28 wall seconds; minimum observed clearance 803 and 1,448 m).
Individual retries preserved discovery progress. A deliberately failed PNG
encode left the photograph unearned; the real shutter subsequently credited a
successfully framed and encoded panorama. The three completed activities survived
hangar entry, aircraft-change cancellation and Continue.

The remaining live-world journeys and the heavy/fast variants also completed
through steering, pitch and cruise controls. No pose, progress, speed or timestep
overrides were used. The five remaining destinations used their Curated profile.
Each row collected all four discoveries; the clearance is observed live DEM AGL,
not a guarantee for every possible detour.

| Journey | Aircraft | Flight seconds | Minimum observed AGL |
|---|---|---:|---:|
| Grand Canyon | Skylark | 336.48 | 691 m |
| Manhattan | Skylark | 411.62 | 707 m |
| Sydney | Skylark | 306.63 | 822 m |
| Swiss Alps | Whisper | 307.98 | 2,109 m |
| Yosemite | Skylark | 302.24 | 1,275 m |
| Nāpali Coast | Skylark | 305.98 | 1,698 m |
| Grand Canyon | Stratoliner | 103.74 | 691 m |
| Grand Canyon | Vector | 129.24 | 691 m |

Manhattan's Liberty arc completed its nine directed gates in 53.25 wall seconds,
with 1,043 m minimum observed AGL. Yosemite's missed corridor did not block its
remaining discoveries. Canyon also completed with all three activities for Gold;
later Bronze runs preserved that best medal. All six stamps yielded exactly nine
liveries. Evidence: `live-journeys.json`, `canyon-gold-flight.json` and the live
activity captures. These are automated control-driven playthroughs, not human
enjoyment results. Their frame timings are observational, not paired benchmarks.

All nine aircraft loaded through the hangar selection controls with their own
duration estimates. Selecting a different aircraft displayed the restart
confirmation and left the saved aircraft and activities untouched until approval.
Approving the change to Leviathan restarted the journey; a page reload and the
title's Continue action retained Leviathan and Live conditions. The nine earned
liveries and Canyon's Gold medal remained intact.
All nine hangar models were visually inspected in the fixed studio lighting.
All 27 aircraft / day-dusk-night chase combinations were captured and inspected:
models loaded, framing retained their silhouettes, and navigation lights remained
restrained. The hangar does not have three separate time-of-day lighting modes.
Temporary lighting pins were cleared after this review.
Phone layout was checked with a coarse pointer, touch capability and a 390×844
viewport; the joystick, actions, photo and adventure guidance remained available.
This is emulated layout testing, not physical-device usability testing.
The final navigation checks also confirmed that Next opens its destination
briefing with the adventure environment cleared, and returning from preparation
to Free Flight opens the ordinary hangar without a redundant end-flight prompt.

The matched performance comparison passes the 10% bound for the measured Canyon
windows: `0592f51` and the updated build both read **12.5 ms p95 in each of three
25-second samples**, after a 10-second warm-up, on the same RTX 5080, same active
browser tab, 1200×800 at DPR 1, Enhanced / High, prop aircraft and Live conditions.
Each cycle includes a new launch and return to the hangar. The updated build held
140 programs, 38 render targets and 191,739,579 owned graphics bytes across those
cycles (baseline: 138 / 38 / 188,943,373). Geometry and texture counts fluctuated
with streaming rather than continually increasing. Three additional cycles held
140 programs / 38 targets / 188,288,008 bytes; JavaScript heap fell from 267.7 MB
to 199.0 MB through ordinary collection. Heap readings are not GC-normalized and
six short cycles do not certify indefinite leak freedom or all-route performance.

A later production-build recheck read 8.4 ms p95 in three further cycles, with
134 programs, 38 targets and 187,545,269 owned graphics bytes held steady. An
extra preview tab had been closed before that run, so this is a stability check,
not evidence of a feature-driven speedup. The subsequent Free Flight HUD guard
does not alter the active-adventure benchmark path.

Evidence: `baseline-same-tab.json`, `new-same-tab.json`, and
`new-memory-cycles.json` and `final-build-cycles.json`. Earlier cross-tab repeats are explicitly VOID: the
embedded browser throttled the baseline tab to 1 Hz despite visible/focused state.
Initial unmatched full-route samples are not used to judge the 10% bound. No
threshold, simulation rate or quality setting was relaxed.

Human enjoyment testing is not yet performed: first-time comprehension,
unassisted Canyon completion and a memorable activity still require real
players. No human results are inferred from automated control tests.

For that review, give a new player the title screen and the task “fly an adventure
in an aircraft you like.” Observe whether they find aircraft selection, identify
the next discovery, distinguish optional gold gates from the main route, and
finish Canyon without coaching. Afterwards ask which moment they remember and
what they would change. Record the aircraft, conditions, input device, completion,
confusion and quoted feedback. **Participants: 0; human verdict: pending.**

---

# Historical record: Fleet & Adventures foundation

Built against `9ee7e79` on 2026-10-01. This is a local implementation for review, with purchases disabled. Human art acceptance, six complete player playthroughs and the 8-of-10 introductory usability target are not yet certified.

## What is available

- Start an Adventure is the main title action. Continue prefers the unfinished journey. Grand Canyon teaches steering, speed, navigation and photo capture in context; the full controls reference remains in Pause.
- First Flights contains Grand Canyon, Manhattan and Sydney. Wild Earth contains Swiss Alps, Yosemite and Nāpali Coast, labelled **Free during preview**, with no expiry or checkout.
- Every route has four ordered discoveries, photo and steady-flight optional objectives, a stamp, a medal, a completion screen and a next-flight recommendation. Six route liveries plus collection rewards at two, four and six completions cover all nine aircraft. Journeys lives alongside sightings, badges and statistics in the Logbook.
- Eight original airframes have desktop/lightweight GLBs, named moving surfaces, propellers where applicable, coherent material slots and geometry-derived thumbnails. Hangar and flight share the presentation manifest. Vector's source GLBs are unchanged; movable surfaces are partitioned on its private render clone. Landing gear is aircraft-specific. Traffic keeps its inexpensive existing models. Flight handling and airport compatibility are unchanged.
- Pause/Settings provides validated export/import and recovery of the previous save. Guest play remains immediate. Storage failure displays a session-only warning; exports use the live in-memory stores.
- Optional analytics is off until the player opts in, and has no effect without configuration. The Wild Earth completion screen asks optional purchase interest at **$9.99 USD once, research only**.

## Interfaces and ownership

| File | Responsibility |
|---|---|
| `lib/fly/adventures.mjs` | Stable route IDs, authored safe starts, checkpoints, optional objectives and rewards |
| `lib/fly/adventure-controller.mjs` | Pure progress state machine; ordered segment crossings, pause/retry/resume/abandon, one-time rewards |
| `lib/fly/adventure-runtime.js` | Existing flight/staging adapter; no independent simulation timer |
| `lib/fly/adventure-guidance.mjs` | Recovery labels and a frame-synchronised, world-projected checkpoint marker on the existing HUD canvas |
| `stores/adventure-store.js` | Version 1 browser save, hydration and session-only fallback |
| `lib/fly/content-access.mjs` | Shared catalog and access resolver used by menus and launch actions |
| `lib/fly/fleet-aircraft.mjs` | Selected-aircraft URLs, animation parts, effect anchors and livery slots |
| `scripts/build-adventure-fleet.mjs` | Reproducible original model/thumbnail authoring; no external mesh dependencies |
| `public/models/adventure-fleet-v1.json` | Per-variant bytes, triangles and airframe draw counts; gear is measured separately by verification |
| `lib/fly/save-backup.mjs` | Import validation, allowed keys, recovery and rollback |
| `lib/fly/adventure-analytics.js` | Consent, lazy SDK initialization and strict event property filtering |

Checkpoints use flown segments, so a fast crossing counts even if both sampled endpoints are outside the circle. A warp epoch change, large discontinuity or crash requires an authored checkpoint retry. Reload retains the checkpoint index, never an arbitrary saved flight position. Required objectives do not read traffic. Optional photo credit is given only after successful capture near a discovery. Existing contracts continue to run.

Access is client-side scaffolding, not purchase security. All existing aircraft, exploration, quality settings, operations, spotting and photos remain free. Imports never grant pack ownership. Future sales require accounts, server-verified grants, purchase recovery and a delivery policy; none is activated here.

## Analytics setup and interpretation

Configure both public build-time variables only when you want to enable the optional integration:

```dotenv
NEXT_PUBLIC_POSTHOG_KEY=your_public_project_key
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Use the ingest host for your actual PostHog region. Rebuild after changing these variables. No secret API key belongs in either value. Missing configuration or an SDK/network failure leaves play unaffected.

Events: `adventure_started`, `adventure_checkpoint`, `adventure_completed`, `adventure_retried`, `reward_claimed`, `return_visit`, `pack_interest`. Allowed product properties: route ID, checkpoint number, medal, named livery reward, answer, pack ID and calendar day. SDK routing/anonymous identity fields are retained so opted-in subsequent visits can be connected. Automatic page URLs, referrers, identity attributes, photos, precise coordinates and aircraft identifiers are removed before sending. Autocapture, replay, automatic pageviews, performance capture, exception capture, surveys and person profiles are disabled. IP geolocation is disabled; the service necessarily receives the network connection.

Measure introductory completion, a second distinct adventure start, seven-day return and Yes/Maybe/No interest separately. Retries and checkpoint drop-off locate friction. A price preference is not a purchase or proof of demand. Seven-day retention requires observing subsequent dates; it cannot be inferred from this session. [PostHog integration reference](https://posthog.com/docs/libraries/next-js), [official SDK source](https://github.com/PostHog/posthog-js).

## Verification and release gates

Automated checks added: all six route definitions and cruise-distance estimates; traffic-independent progression; ordering; fast crossings; warp/crash retry; pause; reload; duplicate completion; malformed saves; entitlement exclusion; failed storage writes and recovery; analytics filtering; all sixteen model variants, named parts and triangle budgets including gear. Browser Back closes an adventure dialog before resuming flight.

Run:

```text
node scripts/verify-adventures.mjs
node scripts/verify-adventure-guidance.mjs
node scripts/verify-mobile-actions-node.mjs
node scripts/verify-flight-operations.mjs
node scripts/verify-r25-front-door.mjs
node scripts/verify-r25-flight-plan.mjs
node scripts/verify-cloud-road-paths.mjs
node scripts/verify-cloud-shadow-range.mjs
node scripts/verify-import-integrity.mjs
```

Release build: `FLY_BUILD_DIR=.next-fleet-review next build --webpack` (PowerShell: set `$env:FLY_BUILD_DIR` first). Review evidence is stored locally under `.graphics-review/fleet-adventures/`, which is intentionally ignored by Git.

Local verification results: adventures/assets/import safety 15/15; adventure guidance 5/5; mobile action ordering 17/17; flight operations 33/33; title/front door 70/70; flight-plan compatibility 44/44; cloud/road paths 10/10; cloud-shadow range 2/2; import integrity 4/4. Scoped lint has no errors. These are the named automated suites, not a claim that every historical browser harness was rerun.

The release browser completed Grand Canyon through actual simulation/control input, without position warps or checkpoint grants. All four discoveries registered in order in about six minutes (370 s controller elapsed, including an earlier short retry attempt). A 1280 × 672 PNG encoded successfully at 1,394,184 bytes; nearby photo credit and steady flight produced Gold, the Canyon stamp and the Skylark livery. Next started Manhattan; reloading and choosing Continue restored its authored start at 1,050 m and retained the Canyon medal/reward. This is an automated control-assisted integration playthrough, not a first-time human usability result. Background contracts continued scoring while traffic providers were unavailable.

Additional browser checks: the earned Skylark livery equips in Customize; a blocked Meridian GLB shows a recoverable error and Retry loads it after access returns; JSON export contains all five live progress records; a denied adventure save keeps flight playable and displays the session-only warning. At 390 px width the library has no horizontal overflow and its launch action stays visible. Shift+Tab wraps to that action. Coarse-touch/phone-class and reduced-motion emulation retain the joystick and flight action menu. All temporary request blocks, storage overrides and device emulation are removed after review. The eight replacements were inspected in the hangar; the full lighting/chase-camera art matrix still awaits acceptance.

The first three visual review subjects are Skylark, Mustang and Stratoliner. They and the remaining five need owner acceptance in hangar/chase/day/dusk/night. Geometry checks alone do not approve the artwork. Route duration tests use recommended cruise speeds; actual 5–10 minute pacing and safe clearance require complete playthroughs. The usability target remains at least 8 of 10 new testers finishing Grand Canyon without coaching.

Performance comparison uses the unchanged release from `9ee7e79` and this release on the same browser/GPU. Record viewport, DPR, quality, weather, cache state and loading separately. The frame instrument reports a rolling 600-frame window; a brief comparison is a smoke check, not a long-session p95 or leak certification. Final release acceptance requires repeated lived flights, turns, destination changes and hangar returns, with no more than 10% p95 regression and a separate resource-growth review.

### Recorded local smoke comparison

Windows, Chrome 154 in Codex's browser, NVIDIA RTX 5080 / ANGLE D3D11, 32 logical CPUs, 1280 × 720 CSS pixels, DPR 1, High / Enhanced / satellite, Skylark. Same scripted release sequence: Canyon launch, 15 s settling, 20 s forward flight, 20 s right turn, Manhattan destination change for 25 s, then return-to-hangar confirmation. Live world/provider state was not frozen, and this is one pair rather than repeated trials. An earlier 1280 × 672 baseline was rejected as non-comparable.

| Rolling p95 | Baseline `9ee7e79` | Fleet release | Change |
|---|---:|---:|---:|
| Canyon forward | 16.2 ms | 14.0 ms | −13.6% |
| Canyon turn | 14.6 ms | 11.8 ms | −19.2% |
| After destination change | 14.8 ms | 15.7 ms | +6.1% |

These sampled windows meet the 10% target in this pair; they do not establish a general speedup or complete the performance acceptance gate. Destination transition worst frames were 109.8 / 96.0 ms baseline/new. The world frame instrument pauses while the hangar is in demand mode, so the multi-second return gaps are **not** frame-time regressions and that row is excluded. Actual hangar rendering was checked separately. Retained geometry/texture counts read 247/279 baseline and 270/284 new; JS heap varied with garbage collection (about 397/369 MB after destination change). More detailed selected-aircraft geometry is expected, but repeated resource-growth/long-flight testing is still required.

## Cloud-shadow repair reported during this pass

The supplied Ohio screenshot at approximately 42,294 ft was reproduced. The cloud marcher stopped at 22 km, but the composite still sampled shadow casters beyond that range and darkened already-hazed scenery. Those shadows looked like detached patches suspended above the ground. `cloud-shadow-range.mjs` now fades projected casters through the cloud field's distance band, including low-sun displacement. Nearby clouds retain their shadows. The release browser review reproduced the before image and confirmed removal of the distant pattern after the change; screenshots are in the review folder. The new regression checks cover high altitude, the fade interval and origin rebasing.

## Adventure opening and navigation repair

Fresh flights now show Photo and Leave, with recovery actions reserved for interrupted or resumed routes. An interruption before the first discovery offers **Restart approach**; after a discovery it offers **Retry checkpoint**. A paused save offers **Resume adventure**. The controller still protects checkpoint ordering and warps cannot award progress.

All six starts are aligned with the first checkpoint at its authored altitude, about 25 seconds outside its discovery radius at the recommended aircraft's cruise speed. Sydney's initial centre distance falls from 4.6 km to 2.15 km. To retain 5–10 minute route geometry after shortening the opening, Manhattan now recommends Skylark and the final sightseeing legs of Sydney, the Alps, Yosemite and Nāpali are extended. Cruise estimates range from 5.15 to 7.07 minutes; these are geometry estimates, not completed human playtests of the revised routes.

A numbered ring marks the next discovery at its projected world position, with its name and distance. A direction arrow takes over when it is outside the view or covered by the objective panel. The marker shares the existing frame-synchronised label canvas, follows world bend/origin rebasing and camera bank, and draws even when traffic is unavailable. It hides during photo capture, pause and menus; it adds no GL meshes or simulation timer. The introductory hint directs players to the ring.

The added regression gate covers all six opening distances, recovery states, projection ahead/behind/banked/rebased views, unavailable traffic and hidden UI states. Release-browser review confirms Sydney advances from its first discovery to Opera House through normal flight, removes Retry again after recovery, and displays compact guidance at phone width with reduced motion. Recovery was also exercised using the controller's interruption hook; this was not a physical crash playtest. The final guidance preview uses `.next-adventure-guidance` on port 3002. New screenshots share the existing ignored review folder. The full route, art and performance acceptance gates above remain open.

### Adventure HUD design follow-up

The flight panel now uses a translucent navy surface, larger Geist checkpoint typography, a four-stop progress track, a combined course/distance readout, and subdued optional-objective indicators. Place descriptions, bearings and altitude move into a keyboard-operable Details disclosure inside the panel; bounded scrolling keeps expanded information from extending over the lower flight controls. Recovery and photo actions retain their existing behavior. Touch controls have 44 px targets and the panel uses responsive spacing.

The waypoint is now an open segmented beacon with a small sequence badge and unboxed name/distance text. Offscreen guidance uses a compact arrow capsule. Both use the existing HUD canvas and bundled font, with no new scene geometry or animated UI effects. Review screenshots `adventure-design-day.png`, `adventure-design-night.png` and `adventure-design-mobile.png` show the release build. Day/night contrast, keyboard Details, recovery, and a 390 × 844 coarse-touch/reduced-motion layout were inspected; the joystick and flight menu remain available. Guidance 5/5, adventures 15/15, mobile actions 17/17, import integrity 4/4, scoped lint and the production build pass. This design review does not replace the outstanding long-flight performance or human acceptance gates.

## Commercial launch dependencies and operating costs

Reviewed 2026-10-01. No provider agreement, subscription or account was purchased or accepted during this pass. This inventory identifies decisions still required before selling access.

| Provider/surface | Current use and launch action | Cost planning |
|---|---|---|
| Open-Meteo | Current weather route uses the public API. Its free service is noncommercial; commercial use requires the customer endpoint and a plan. Data attribution remains required independently of service access. | Free evaluation limits include 10,000 calls/day and 300,000/month. Published paid call budgets are 1M/5M/50M+ monthly. Obtain the current subscription price and move keys server-side before commercial operation. [Pricing and terms](https://open-meteo.com/en/pricing) |
| Esri imagery/elevation | Current legacy keyless endpoints are not a commercial permission grant. Confirm the approved service/account, attribution, caching, redistribution and postcard/export use. | Meter imagery/DEM tile requests and hosting egress. ArcGIS platform pricing is a planning reference, not a price or license for the legacy endpoints. [ArcGIS pricing](https://developers.arcgis.com/pricing/) |
| OpenFreeMap / OSM | Preserve attribution and applicable data-license obligations. Public hosting is provided as-is and may change/discontinue; decide whether its service terms fit commercial availability requirements. | Track tile volume, cache misses and backup/self-hosting cost. [Service terms](https://openfreemap.org/tos/) |
| adsb.lol and fallback traffic feeds | Confirm production use, attribution and redistribution for every feed. adsb.lol requests contact before production API use. The review encountered 403/429 responses, so availability is not assumed. | Poll volume scales with active sessions, interval, cache sharing and failovers. Obtain any required capacity agreement. [API documentation](https://api.adsb.lol/docs) |
| AviationWeather METAR, ESA WorldCover, Planespotters photos/metadata | Inventory exact endpoints, source attribution, rate limits and commercial/export permissions. Existing credits do not establish every API or photo reuse right. | Measure weather lookups, metadata/photo fetches, cached bytes and egress; budget support/fallbacks. These permissions remain open. |
| Original fleet and existing third-party artwork | New fleet is first-party MIT; existing assets retain their individual entries in `CREDITS.md`. Recheck upstream asset-specific licenses when replacing files. | New uncompressed GLBs are about 0.10–0.58 MB each, downloaded on selection. Budget CDN egress and ongoing art production. |
| PostHog | Optional, consent-based explicit events only. Configure region, retention and budget before enabling production collection. | Events per completed first route are roughly start + 4 checkpoints + completion + reward, plus retries/returns/interest. Multiply by opted-in sessions and consult the current [pricing](https://posthog.com/pricing). No analytics bill or demand forecast has been established here. |
| App/API hosting | Keep server weather/traffic caching and observe cold starts and outbound quotas. | Model monthly cost as host base + compute + uncached API requests + CDN egress + monitoring. Instrument real sessions before quoting unit economics. |

Accounts, checkout, multiplayer, career currency, native apps and another world-rendering overhaul remain outside this pass.

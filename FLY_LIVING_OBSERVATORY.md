# Living Observatory

Implementation and validation record for the opt-in lounge expansion. Both `LOUNGE_PIER.enabled` and `LOUNGE_INSTRUMENTS.enabled` remain `false`. This record does not authorize enabling either default.

## Owner feedback and upper lounge revision — October 17, 2026

The owner rejected the first preview's floating instrument heads, striped aircraft shadows and overloaded eight-button instrument panel. The interaction checks below describe functioning controls in that earlier build; they did not establish the requested visual or experiential quality. Those captures and failures remain evidence, not approval.

The rear-facing lower lounge is retained. The current revision adds a distinct enclosed upper observation room at local floor height 4.6 m, reached by a continuous left-wall staircase. The upper room has front and rear glazing, its own seating, guardrails and a raised roof. The same movement controller owns walking, stair elevation and seat transitions; the placement footprint and conservative classic fallback remain unchanged.

The revised HUD opens one airport map with a single aircraft-to-viewpoint action. Window tools appear in proximity instead of as eight global tabs; lighting is a direct toggle. Listening follows the player's look direction and clearly exposes sound-off, so it no longer requires a separate bearing-slider task. Rounded display housings connect through hinges to continuous supports. The existing five-tap shadow filter uses its fixed sample pattern: the previous continuously rotated noise produced visible diagonal bands under magnification. Bias, shadow resolution and cascade count are unchanged.

This revision is undergoing rendered validation. Earlier build `817f580` and its performance/interaction reports do not certify the new upper room. Final revision evidence must include real keyboard ascent and descent, floor-aware picking and controls, upper/lower daylight and night views, close inspection of physical joins, and the corrected apron shadows.

## Runtime and interaction contracts

Built from `main` at `9ba95e8` in `codex/living-observatory`, separately from the trailer checkout. Opt in with `?flags=LOUNGE_PIER,LOUNGE_INSTRUMENTS`; `?flags=-LOUNGE_PIER,-LOUNGE_INSTRUMENTS` exercises the unchanged entry experience. The existing phone/tablet feature policy is unchanged.

- `observatory-stations.mjs` defines shared identity, bounds, availability, proximity, unobstructed targeting, prompts and release rules. The physical instrument geometry and HUD consume the same positions. Table, compass and lighting have remote HUD access; the microphone and standing rail retain their proximity requirement.
- `lounge-observatory-runtime.js` attaches to the existing airport watch, owns only instrument state, and releases it on leave. The existing walk is the sole movement controller. Table selection uses `watch.select(..., { follow: false })` and clears an earlier follow without moving the camera. The optional bearing cue expires after 12 seconds.
- `observatory-model.mjs` derives fresh contacts only from `runtime.traffic.items`. Static scenery never becomes a contact. Missing motion is labelled unavailable. Stale/lost tracks are removed immediately, then can reappear on a fresh fix. Runway centrelines merge the registered catalog and loaded OSM geometry; no runway is labelled active. The existing selection is shared with the board and binoculars.
- Window eligibility tests room apertures, available OSM buildings, generated terminal/hangar/tower volumes, and rendered terrain height. Terrain queries are cached and bounded: at most 256 new queries per refresh, 4,096 cache entries, 250 m sample spacing, 64 samples per ray, refined tiles only. Beyond 16 km, missing/coarse terrain, incomplete building data and exhausted query budgets remain unverified. This is conservative sampled evidence, not exact visibility against every vegetation leaf or mesh triangle.
- Suggestions use actual approach/departure/overhead classifications or a selected contact appearing on the other side. A better candidate must persist for five seconds before replacing a valid suggestion. Lost or obstructed candidates clear immediately. Quiet feeds have no filler.
- Directional listening mixes the existing finite aircraft voice pool through a narrow bearing lobe, preserving emission history, propagation delay, distance falloff and Doppler. The ordinary through-glass ambience remains. The HUD displays an estimated level and bearing even when sound is muted. No conversations or flight-specific announcements are generated.
- Rail support reduces existing hand sway to 18% without changing zoom, movement restrictions, target data or the camera controller. It raises free binoculars without automatic acquisition; tracking stays optional. Instrument screens and bodies disappear with the room's exact optics fade. Readouts default to hidden only with instruments enabled.
- Night Watch dims decorative emissive channels, their practical contribution, interior bounce and glass reflections together. Entrance and circulation illumination retain a floor. Exterior light, weather and time are unchanged. The setting is reversible and is not persisted.

The physical instruments add two draws and a 2 MiB atlas, sharing the room's metal shader. All geometry, canvas artwork and procedural sound are first-party or reuse the existing credited soundscape. Assets and the separate pier AO bake are recorded in `lib/fly/assets.js` and regenerated `CREDITS.md`.

## Integration verification

Node gates passed: observation 45/45, lifecycle 25/25, audio 16/16, observatory model/runtime 17/17, prewarm 5/5, classic room 12/12, pier room 12/12, pier 8/8, seat 6/6, walk 56/56, vantage 7/7, airport set 17/17, fleet airframes 13/13, flag registry 8/8, operations golden 28/28, import integrity 4/4 and attribution 4/4. Final browser measurements are recorded separately below when complete.

The lifecycle regression covers rail activation during an unfinished cursor-anchored zoom: the rail clears that pending anchor without changing ordinary cursor anchoring. Audio coverage includes enabling sound while paused or hidden, immediate store/visibility-edge muting and subscription cleanup; a sound preference cannot bypass the combined master mute predicate.

The combined presentation gate passes for both variants: **14 draws, 120,454 triangles classic / 120,868 triangles pier, 23.86 MiB textures**. It verifies finite shared-shader attributes, resource disposal and unobstructed physical display faces; a regression ray must hit each screen before its housing. The layout detector reported no findings on the new HUD, stylesheet and instrument component. ESLint passed all changed JavaScript files and `git diff --check` passed.

Production interaction acceptance on implementation commit `817f580` passes **62/62** checks: flags off 5, classic with instruments 28, pier with instruments 29. A separate **1280×720 desktop pass is 5/5**, including normal overflow scrolling and clicking the Night Watch restore control. Both reports contain zero page exceptions. The expanded title/front-door suite also passes **70/70** after the shared audio-mute correction.

The browser pass uses real application modules, collision geometry and WebAudio, with a deterministic, explicitly marked traffic fixture for selection assertions. Physical approach setup is instrumented; keyboard, pointer, focus, movement release and Escape use browser input. It covers a muted instrument, range focus, free rail binoculars, opt-in readouts, shared selection, no camera turn on table actions, Night Watch reversal, pause, sound-on while paused, mute teardown and rear activation. Screenshots are taken after the physical atlas/optics settle, not during their intentional transitions.

**Visibility qualification:** headless Chrome kept both tabs visible when another tab was brought forward. The harness records `nativeHidden: false` and explicitly simulates the Page Visibility input to exercise teardown. The application intentionally stays paused after visibility returns, and the test asserts that before explicitly resuming. This branch and the real store/event regression pass, but native OS/browser background-tab behavior remains an owner/manual check; it is not certified by the headless result.

Local browser evidence: `.graphics-review/living-observatory/interactions-final-production/report.json` and `interactions-compact-production/report.json`, with corresponding captures. Earlier failures are retained: physical screen clipping (fixed), a development-only offscreen-click timeout (not reproduced in final production/compact checks), development script errors, and two visibility-harness assumptions corrected to match the application's retained-pause policy. They are not silently counted as passing runs.

Additional commands:

```powershell
node scripts/verify-lounge-observatory.mjs
node scripts/verify-airport-observation.mjs
node scripts/verify-airport-lifecycle.mjs
node scripts/verify-airport-audio.mjs
node scripts/verify-lounge-prewarm.mjs
node scripts/verify-ops-golden.mjs
node scripts/verify-attribution.mjs
node scripts/verify-living-observatory.cjs --port 3349 --case all
```

## Pier geometry and circulation validation

The pier variant contains a rear curtain wall between the flight boards, the bar on the right wall, a relocated communal table, and four physical vantage chairs. Front and rear apron stands reuse the existing airport-set geometry, docking, routes, fleet resources, and material batches. Classic geometry retains its separate path.

The room, its collision proxies, and the separate pier AO bake are generated from the same variant plan. `public/models/lounge-ao-pier-v1.bin` is checked against the pier geometry signature; the classic bake remains separate. No new `THREE.Light` is added. The room contract is at most **14 draws, 140,000 triangles, and 24 MiB of textures including instruments**. The combined presentation gate counts both room and instruments; these resource counts are not frame-time measurements.

The pier gate verifies four chair approach routes, collision coverage of emitted room geometry at body height, finite rear-set geometry, bridge and aircraft docking alignment, route symmetry, and resource disposal at KCMH, KJFK, LOWI, EGLL, and YSSY. It also checks the rear glass geometry/shader aperture and Night Watch illumination without changing the exterior state.

All **24,338 conservatively walkable grid cells** connect to the central aisle. A cardinal flood joins 24,337 cells directly. The remaining 10 cm cell at room `(10.15, -0.05)` is between the right corner chair and its round table. The coarse grid's half-diagonal clearance margin isolates it, but the actual 25 cm walking capsule has a verified 20-step escape using 1 cm movements, with at least 30.5587 cm clearance. The gate now requires an exact `moveWithCollision`-verified escape for every disconnected coarse component and fails if any lacks one; it no longer accepts a percentage threshold. This is geometric coverage, not a substitute for reviewing movement feel or all walking routes in the rendered scene.

Run from the repository root:

```powershell
node scripts/verify-airport-lounge.mjs
node scripts/verify-airport-lounge.mjs --pier
node scripts/verify-lounge-pier.mjs
node scripts/verify-lounge-seat.mjs
node scripts/verify-lounge-walk.mjs
node scripts/verify-lounge-vantage.mjs
node scripts/verify-airport-set.mjs
node scripts/verify-fleet-airframes.mjs
node scripts/verify-observatory-presentation.mjs
```

The pier gate passes 8 checks; the classic seat gate passes 6. The remaining command outcomes and final combined resource totals should be recorded with the final integration evidence. Rebuild AO after changes to pier geometry or collision layout:

```powershell
node scripts/build-lounge-ao.mjs --pier
```

## Placement coverage and provenance

`scripts/lounge-pier-audit.json` records **115 airport identifiers, 111 accepted placements, and 4 classic fallbacks**. All five visual-review airports have scored placements. KHNL, KRKL, OKBK, and SPJC lacked usable runway catalog records in this audit. Acceptance is a data/geometry result, not visual certification.

The audit reused cached OpenFreeMap z14 tiles and fetched missing tiles from planet `20261011_080001_pt`. The original cache snapshot dates are unknown; the report explicitly records `source: mixed cached OpenFreeMap tiles`, `cachedSnapshotDate: null`, and `visualCertification: false`. It must not be described as a uniformly fresh OSM snapshot. No new data provider was introduced.

The scorer samples both apron footprints, rejects runway overlap and incomplete tile coverage, constrains rear stand taxiway/building overlap, and evaluates rear targets from one seated and three standing/route positions. A missing acceptable placement retains the classic room. A scored row also requires its original runway to resolve in the live registry: missing sibling runway data and a chosen row belonging to another airport cannot enable an unscored generic pier. Regression tests cover these fallback paths.

Regeneration with the existing local source cache used in this session:

```powershell
node scripts/build-lounge-seats.mjs --pier --source-cache C:/Users/bfecho/skyloom-3/.graphics-review/lounge-seats/tiles
```

For a cache-only rerun, append `--offline`. Missing cached tiles then fail conservatively. The full command rewrites the pier table and audit; `--only KCMH,KJFK,LOWI,EGLL,YSSY` limits inspection and does not replace the complete seat table, but still writes a scoped audit. Preserve the full audit before using that option.

## Open release gates

- Owner visual signoff remains required before a separate default-enabling change, as required by `FLY_GATE_TO_GATE_PLAN.md` decisions 11-12.
- Complete rendered front/rear and walking-route reviews at all five airports in daylight and at night, including standing/seated transitions, interrupted interactions, reduced motion, and maximum zoom. The placement audit and Node geometry gates do not establish visual quality.
- Complete matched cold-entry/first-binocular measurements, identify and verify program warmup behavior, and record the YSSY comparison plus a 20-minute walk/zoom soak. Historical figures are context only; they do not prove this expansion's performance.
- Record final live-world integrity, mute/pause/hidden-tab, accessible-control, teardown, and full integration outcomes with the final build. Source assertions alone do not replace these checks.

## Upper lounge revision — geometry validation

The owner subsequently asked for a continuous stair to a distinct upper lounge. This revision supersedes the single-level pier geometry and four-seat circulation figures above. The browser results recorded for `817f580` remain evidence for that earlier build; they do not certify the upper-room revision.

The lower front and rear windows, right-wall bar, entrance and central circulation remain. The upper observation room occupies room-local `x=-11.2..11.2, z=8..14.2`, with its floor at `y=4.6` and roof at `y=7.85`. Its front, rear and east glazing use real bronze channels and seals. Two upholstered observation chairs, stone side tables, lamps, a woven rug, timber flooring and a low credenza give the room a distinct interior. The upper front and rear seats are `upper-front` and `upper-back`; the latter's approach is `[3.1,12.4]` to preserve the walking capsule's clearance from its side table.

The left stair has a 1.9 m clear width, 28 equal 164 mm rises and 270 mm treads, running from `z=3.6` to `11.16`. The existing left banquette, its tables and the front-left planter are removed; two lower lounge chairs are reused upstairs. The stair has a closed plinth, balusters, timber handrails and restrained circulation markers. The ceiling opening, landing, upper floor and guardrails share `LOUNGE_PIER_ROOM.upper` with the navigation model. The room footprint in airport coordinates is unchanged; the variant envelope rises to `maxY=8.05`.

The interior shader now tests the actual two-level shell and intermediate slab for key light and exterior reflections. Interior fixtures cannot light through that slab, except through the stair opening. One existing 256-pixel cube probe is reused and refreshed when the observed level changes; there is no second probe or new `THREE.Light`.

The new AO bake uses the actual 131,196-triangle room geometry, signature `6b7a1f50`. Its version-2 payload retains the 512×352 lower floor map and adds a 512×160 upper floor map, packed into one 512×512 R8 texture. This adds approximately 0.104 MiB including mipmaps. The classic version-1 bake and geometry remain unchanged. The base pier resource has 12 draws, 131,230 triangles including glass/boards/steam, 5.71 MB of geometry and 21.96 MiB of textures; it contains 29 analytical practicals and 40 shadow boxes. The separate combined presentation gate must include the updated instruments before claiming the 14-draw, 140,000-triangle, 24-MiB limit is met.

Validation completed before the first production capture of this revision:

- `verify-airport-lounge.mjs`: 12/12 classic and 12/12 pier checks, including finite geometry, envelope/glazing contracts, real shader patch anchors, fixture limits, matching AO and disposal.
- `verify-lounge-upper.mjs`: 6/6 checks using the actual mesh BVH. These include 483 stair-width/headroom samples, both upper seated sightlines, six upper standing sightlines, the open stair ceiling, occupied landing, solid intermediate slab, preserved lower rear view, vertical blocker bounds and separate upper contact shadows.
- ESLint passed the changed geometry, shading, glass, probe, AO, configuration, component and test files.

```powershell
node scripts/verify-airport-lounge.mjs
node scripts/verify-airport-lounge.mjs --pier
node scripts/verify-lounge-upper.mjs
node scripts/build-lounge-ao.mjs --pier
```

The shared-controller navigation, complete layered-floor connectivity, rendered room craft, all-five-airport sightlines, daylight/night lighting and matched performance/soak results must be recorded against the upper-room production build. These geometric results are not visual signoff or frame-time evidence. Pier and instruments remain off by default pending owner visual approval.

# Ground to Ground

Implementation and verification record - 2026-09-22.

## Play the feature

Every normal session opens in the hangar. Select a plane and a compatible airport,
then choose **On the apron**, **Ready on the runway**, or **Landing practice**.
The latter two are explicit assisted starts; acceleration, rotation, steering,
flare and braking remain under player control. Your previous choice is highlighted but never
automatically launched. The eight powered aircraft support ground operations;
Whisper explicitly launches into airborne practice.

1. Select **Taxi** to release the parking brake and apply taxi power. Manual
   **B** and **2** controls remain available.
2. Follow the gold path. **A/D** steer; mouse and the touch stick also steer.
   Stop at the hold-short bars, turn onto the runway, and align with its centreline.
3. Once aligned, select **Begin takeoff** (or use **3** for takeoff power).
   Pull up with **S**, Down Arrow, or the stick at the **Rotate now** cue when
   the displayed rotation speed is reached. Gear and flaps are assisted.
4. In **Destination and guidance**, choose an airport and select **Guide approach**.
   Centre the gold dot and follow the approach gates. **Approach power** selects
   the aircraft's approach throttle; **+/-** and the slider allow adjustments.
   Near the runway, select **Idle** and gently raise the nose. Neutral controls
   hold the selected attitude; reducing power preserves glide energy.
5. After touchdown, use **1** for idle and hold **Space** or **Hold brakes**.
   Follow the parking marker at taxi speed. Stop at the stand and engage the
   parking brake for two seconds to complete the flight.

Go around whenever the approach is unsuitable. Mild bounces are recoverable;
unsafe contacts offer **Retry approach** and **Return to apron**. No aircraft is
lost. Returning to the hangar in flight explicitly ends that flight. Airborne
Atlas warps remain available and mark the flight assisted. They are unavailable
while parked or taxiing. Outside the airport envelope, the existing cruise
controls and exploration flight model remain in use.

## Airport and aircraft support

| Airport | Runway pair | Aircraft |
| --- | --- | --- |
| KOSU - Ohio State University | 09R / 27L | Skylark, Mustang |
| KCMH - John Glenn Columbus | 10R / 28L | All eight powered aircraft |
| KLCK - Rickenbacker | 05L / 23R | All eight powered aircraft |

Runway endpoints and endpoint elevations are FAA airport-record facts effective
2026-09-03, checked through [KOSU](https://www.airnav.com/airport/KOSU),
[KCMH](https://www.airnav.com/airport/KCMH), and
[KLCK](https://www.airnav.com/airport/KLCK). No third-party airport artwork was copied.
Runway profiles interpolate between endpoint elevations. Taxi corridors, stands,
and hangar buildings are **simplified gameplay layouts**, not surveyed reproductions.
The current FAA diagrams were visually reviewed: KOSU follows the south-side
Taxiway A apron; KCMH follows the south-side Taxiway A general aviation area;
KLCK uses the apron-facing 05L/23R and northwest Taxiway A, avoiding an invented
taxiway southeast of 05R. KLCK's displaced landing thresholds are marked and
checked at contact; the full pavement remains available for takeoff.
Diagram sources: [KOSU](https://aeronav.faa.gov/d-tpp/2609/05387AD.PDF),
[KCMH](https://aeronav.faa.gov/d-tpp/2609/00094AD.PDF),
[KLCK](https://aeronav.faa.gov/d-tpp/2609/06846AD.PDF), effective September 3-October 1,
2026. Connector geometry and stand dimensions are deliberately simplified and
still require visual alignment review against live imagery.
Eligibility is a game rule, not a statement about real operating permissions.

Runway assignment uses the available weather vector and stays fixed for that
operation. Without usable wind, the first direction in the table is selected.
The model does not simulate crosswind forces or ATC runway occupancy.

## Requirements and implementation map

| Requirement | Implementation |
| --- | --- |
| R1 - Hangar and departure | Mandatory selection, orbitable full-scale preview, responsive fleet strip, airport eligibility, stationary apron start, model-load retry |
| R2 - Taxi and takeoff | Fixed-step wheel contact, steering, continuous throttle, taxi power limit, brakes, rotation threshold, assisted configuration |
| R3 - Arrival | Destination guidance, glide-path indication, flare/sink handling, bounce recovery, touchdown quality, go-around, parking summary, practice retry |
| R4 - Compatibility | Existing airborne cruise and warps, explicit assisted attribution, hangar-only aircraft changes, separate glider option |
| Stable pavement | Shared authored height profile for collision, pavement, terrain deformation, and ground queries; independent of quality tier |
| Scenery | Authored-pavement exclusion in building/vegetation worker paths; derived-data cache protocol incremented |
| Presentation | Gear, fixed-gear Skylark support, taxi camera, runway/taxi lights, ground roll audio, aircraft-specific preview colour |

The implementation is playable, but **the full approved release acceptance is
not certified**: see the remaining checks below. Diagram review establishes the
correct apron side and runway relationship; it does not establish survey accuracy.

## Engineering contracts

`FlightOperations.advance(dt, flight, command, held)` returns true when operations
owns movement, false when the existing cruise model should step. It integrates at
120 Hz with at most 100 ms catch-up. Menus/backgrounding discard accumulated time.
Only the operations integrator emits touchdown; terrain streaming cannot do so.

| From | Trigger | To |
| --- | --- | --- |
| Hangar | Explicit valid aircraft/airport selection | Parked |
| Parked | Brake released and aircraft moving | Taxi out |
| Taxi out | Runway contact and acceleration | Takeoff roll |
| Takeoff roll | Rotation speed plus nose-up command | Airborne |
| Airborne | Destination guidance selected | Approach |
| Approach | Go-around command | Airborne |
| Airborne / approach | Valid runway contact | Landing roll |
| Landing roll | Reduced to taxi speed | Taxi in |
| Taxi in | Stopped at stand, parking brake, two seconds | Completed |
| Ground / approach | Unsafe contact or high-speed excursion | Crashed |
| Crashed | Retry approach / return to apron | Approach / parked |

- Per-frame state stays on the mutable runtime; the HUD reads at 10 Hz.
- Commands add throttle delta, wheel brake, power preset, and parking-brake edge.
  Existing turn, pitch, speed preset, boost, and free-look inputs remain available.
- Aircraft operations profiles hold speeds, clearances, gear anchors, steering,
  acceleration, braking, and touchdown tolerances in SI units. Values are game
  tuning, not aircraft flight-manual claims.
- Runtime actions: `beginDeparture(aircraftId, airportId, startMode)`, `retryApproach()`,
  `lineUpRunway()`, `launchGlider()`. These coordinate physics, aircraft configuration, rebase,
  camera reset, input reset, and streaming epochs.
- No server/API routes were added. Worker protocol **22 -> 23** invalidates old
  derived scenery in all six consumers. Protocol assertions changed accordingly;
  no numeric visual/performance gate was relaxed.
- Preferences use existing `fly-aircraft` plus `fly-departure`. Completed summaries
  use `fly-flight-history`, bounded to 100 entries. Invalid preferences fall back;
  unavailable/full storage does not prevent play. Transient flight state is not saved.
- `scripts/_boot.js` explicitly prepares the historical airborne NYC fixture for
  legacy rendering tests. It is **not** evidence for ground operations. The new
  browser harness never calls `_boot.js` or installs terrain/governor pins.

## Verification and remaining release checks

Commands (direct Node is used because this machine's npm launcher is broken):

```powershell
node scripts/verify-flight-operations.mjs
node scripts/graphics-unit.mjs
node scripts/verify-stylized-earth.mjs
node scripts/verify-cinematic-flight.mjs
node node_modules/next/dist/bin/next build
# Against a running development server; defaults to localhost:3027:
node scripts/verify-operations-browser.cjs
```

### September 22 continuation: causes fixed

- The 93% loading hang was a protocol mismatch: the worker emitted revision 23,
  while STYLIZED_EARTH still expected 22 and discarded every surface result.
  Its protocol now agrees with every consumer; a worker-result regression covers
  actual slot commit and full local-ring readiness. Fallback is never counted as success.
- Slow off-pavement taxi no longer rolls position back and zeros speed. That
  created an invisible wall and removed the steering needed to escape it.
  Recoverable shoulder travel is capped; high-speed excursions still fail.
- Operations controls and the hangar now participate in world-picking exclusion.
  A production touch test caught Begin takeoff also opening an aircraft inspection
  behind the panel, which paused the plane at zero speed with full throttle.
- Taxi steering has useful authority at walking speed. Takeoff has an explicit
  aligned-runway action and rotation cue. Arrival ownership has hysteresis;
  trimmed pitch persists; go-around arrests descent; airborne power reduction no
  longer applies wheel-brake deceleration. Exit guidance advances past missed exits.
- Hangar selections share one Canvas rather than replacing its WebGL context for
  every plane. Cached models re-arm readiness. Four view presets, camera-side wall
  cutaways, clearer dispatch options and a persistent start action improve inspection.
  The retained world uses demand rendering while the hangar is open; the governor
  excludes those intentionally idle frames from its performance sample.
- Pavement is tessellated into 5 m cells. The former kilometre-long triangles
  interpolated below the curved terrain while short paint strips stayed visible.
  Terrain deformation preserves vertical skirts; scenery exclusions catch crossing
  polygons and the surface worker suppresses duplicate mapped airport pavement.
- The near-ground chase camera blends smoothly; airborne model bob fades out at
  contact; procedural landing legs fold about hinges instead of shrinking vertically.

Observed checks during the continuation (browser evidence in `.graphics-review/operations/`):

- Final production build passes (Next.js 16.1.0; all eight static pages generated).
- Operations: **33 checks pass**, covering all eight aircraft taking off and
  landing, coordinate/length validation, both-direction taxi connectivity,
  brakes, bounce recovery, parking, failure/retry, go-around, warp attribution,
  render-rate consistency, bounded frame gaps, scenery masks, and displaced landing thresholds.
- Existing graphics unit checks pass; stylized-earth **22/22**, living-earth
  **19/19**, cinematic-flight **16/16**, and mobile overlay actions **9/9** pass.
- New modules pass targeted ESLint. The surrounding legacy renderer already has
  React compiler lint findings; these are not evidence of a clean repo-wide lint run.
- Final production full-detail desktop fresh departure, second departure and reload
  **PASS** without fallback (`startup-final/report.json`), including stationary
  apron, taxi and braking. All nine readiness terms were satisfied.
- A normal-keyboard KOSU circuit completed: taxi, aborted takeoff, takeoff, circuit,
  manual approach, one smooth touchdown, taxi and park; one saved summary,
  assisted=false, 656 s (`completed-circuit.json`). This predates the later handling
  overhaul and is not a final-tree circuit certificate.
- Desktop assisted training passed runway start, manual takeoff, go-around,
  practice final, manual flare and rollout braking (`experience-desktop/report.json`).
  This also predates the final idle-energy and click-through fixes.
- Final production slow-edge recovery **PASS**: normal keyboard movement off
  pavement, continued motion at 3.25 m/s, a half-turn, re-entry and braking to rest
  (`taxi-edge-final/report.json`). No reset, lineup helper or pose write was used.
- Final production touch training **PASS** (`experience-touch-final/report.json`):
  cached model re-selection, portrait/landscape hangar, assisted runway start,
  actual touch rotation, go-around, practice final, idle/manual flare, exactly one
  touchdown (2.1 m/s), and held brakes to zero speed. No pose/controller writes,
  world pins or reduced-detail fallback. This is assisted training, not a circuit.
- Final production touch controls **PASS** (`touch/report.json`): mandatory
  selection survives Back; taxi preset, real joystick steering, idle, held wheel
  brakes and parking brake work. Portrait and landscape have no horizontal
  overflow; joystick/action controls remain visible and pass hit testing.
- Keep the earlier failing touch records: they exposed inspection click-through
  and inappropriate airborne deceleration. The later dev HMR interruption is not
  a gameplay result.
- Final production fleet **PASS** (`fleet-final/report.json`): all nine previews,
  all eight powered apron departures plus explicit runway assist and manual rotation,
  glider airborne practice, hangar returns and a repeated Skylark departure. All nine
  readiness terms pass without fallback. The live governor changed high to medium
  to low during this unpinned run; this is not fixed-tier visual/performance certification.
  No page errors; no retained hangar canvas after departure. The initial fleet check
  incorrectly counted the legitimate label/minimap canvases as leaked hangar canvases;
  it now checks the actual hangar canvas selector.
- All large-aircraft side/rear views were reviewed. Apparent missing dispatch
  controls in reduced image previews were disproved by the original-resolution
  PNGs, raw pixel samples and DOM hit tests (`preview-diagnostic/`). No speculative
  compositor workaround was added to product code.
- Captures and browser errors: `.graphics-review/operations/`.

Still required before calling the full feature release-certified:

- Check the diagram-aligned taxiways and authored stands against live imagery;
  airport buildings and connector dimensions remain approximate.
- Fly complete ground-to-ground circuits on real GPU hardware in both visual
  styles, day/night, all aircraft classes, and low quality. Verify wheel contact,
  terrain seams, scenery clearance, lights, heavy-aircraft turning, and gear alignment.
- Complete the repeated hangar/flight GPU-resource soak and broader historical
  browser regression sweep. Individual successful transitions are not a leak certificate.
- Complete final-tree unassisted circuits across aircraft classes, both styles,
  day/night and low quality. The initial protocol blocker is fixed; external provider
  failure is still reported explicitly and does not count as full-detail success.

### Hangar and flight-panel redesign — 2026-09-22

The follow-up replaces the flat blue-grey/yellow dispatch screen with the existing
Ink + Ice visual family: a full-screen aircraft scene, floating departure dock,
three starting-point choices, aircraft silhouettes, a scrolling fleet rail and
compact view controls. Phone framing keeps the aircraft above the controls and
scrolls the selected aircraft into view. The start action remains reachable in
portrait and landscape.

The hangar now opens onto the selected airport's real imagery. Its exterior is a
bounded local preview (nine coarse tiles plus 25 detail tiles), with authored
runway lights and representative airport buildings, not the full streamed flight
world. It uses the existing provider configuration, has visible attribution, and
disposes its own textures on unmount. A loaded photographic map explicitly
recompiles the material variant; a network-success count alone did not catch the
initial untextured material. Directional shadows, an HDR sky and camera-side
architecture cutaways complete the scene. The model cache and single preview
canvas remain shared across aircraft selection.

Flight operations uses the same palette and folds into a small **Flight controls**
tab 6.5 seconds after entering ordinary flight. The whole tab can reopen it;
manual reopening stays open in that context. Approach, aligned low descending
arrival, ground operations and recovery reopen the panel. It does not hide while
a field is being edited. Hidden controls are inert, focus returns to the toggle,
held panel brakes release, and reduced-motion preferences disable the animation.
Native dropdown/navigation keys and button activation do not also control flight;
steering keys remain available after clicking an action button.

Validation for the redesigned surfaces:

- Production build and targeted ESLint pass.
- `verify-operations-disclosure.mjs` passes timing, manual override, arrival and
  recovery checks.
- `design-final/report.json` passes the production browser checks: cached model
  selection, real imagery, manually rotated takeoff, automatic collapse, manual
  reopening, practice approach, go-around, and touch controls in both orientations.
  No application exceptions. These starts are assisted; this is not a new full
  unassisted circuit certificate.
- Screenshots are in `.graphics-review/operations/design-final/`; the intermediate
  art captures remain in `art-pass/` for comparison.
- Final production fleet preview checks pass for all nine aircraft in all four
  views, including cached re-selection (`preview-final/report.json`). No page
  errors; this run checks the hangar, not airborne handling.
- `verify-operations-keyboard.cjs` passes on the final production build: Space
  toggles disclosure without applying flight brakes, airport dropdown arrows do
  not pitch, steering still works with an action button focused, and the dedicated
  brake button releases its held state. This runs after the isolated UI-key fix;
  the broader `design-final` run immediately precedes that fix.

Explicitly outside this release: ATC, fuel, economy/unlocks, manual gear/flaps,
cockpit interiors, multiplayer, and glider ground towing.

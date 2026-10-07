# Skyloom Explorer Beta — current release checklist

Updated 2026-10-07. This is the authoritative checklist for this pass. Older
`FLY_ROUND*.md` files remain historical evidence, not declarations of the current
shipping configuration. `AGENTS.md` has not been rewritten.

**Status: implementation candidate; performance and human acceptance remain
blocked/open. Not accepted for public release.** The production build and
automated functional checks pass. An initial live-provider RTX 5080 endurance
diagnostic found recurring stalls, slow transfers and a draw-budget overrun;
see the evidence ledger below. Headless hardware checks do not close physical
display, phone, subjective flight/visual quality or ten-player study gates.
No deployment, service purchase or public launch is part of this change.

**Visual regression repair (2026-10-07):** the owner rejected the Explorer look
(grey, obscured terrain at Rio) and weather usability. The combined newly enabled
visual flags have been rolled back to the pre-Explorer defaults, without removing
the journal, airports, fleet or other gameplay. This is a conservative rollback,
not proof that one particular atmosphere flag caused the entire screenshot.
Manual photo time/weather changes were independently confirmed blocked by the
new freeze guards; those guards now hold automatic evolution, while explicit
changes still apply. Weather is first in Pause and title Settings, with a desktop
Weather shortcut. Visual acceptance is still required before re-enabling the bundle.

The work is isolated on `codex/explorer-beta`. It preserves the concurrent Umbra
aircraft and target-dossier/Escort changes through merge `6f66f01`. The shared
checkout was reset by another process during implementation; the feature patch
was recovered from the session record before continuing in this worktree.

## Product included

- Guest play, all existing aircraft and six adventures. There are now **ten**
  aircraft because the concurrent Umbra addition is preserved. The title leads with
  Explore the world, Continue when available, guided adventures and worldwide
  runway operations. Preparation keeps the existing hangar and aircraft models.
- Five skippable in-flight tips; replay from Settings. The full control reference
  remains available in Pause. Exploration and region stamps require no precision
  activities, medals or purchases.
- Steering sensitivity, pitch inversion, separate master / engine-and-effects /
  music levels. Existing aircraft, forgiving-flight and graphics preferences are
  retained. Assisted flight remains the model; no fuel, maintenance or new stall
  requirement has been added to exploration.
- Camera pose transitions for mode changes, immediate cancellation at warps and
  reduced-motion bypass. Phone controls retain the existing touch schemes.
- A local Travel journal combines explored locations, historical Atlas visits,
  adventure discoveries, regional stamps, airport landings, photographs and live
  encounter memories. Existing progression stores still own medals and liveries.
- Photo composition pauses flight, automatic weather evolution, aircraft propellers/exhaust,
  ambient boats/plumes and traffic ingestion; grids
  and exposure are adjustable. Manual time and weather changes remain effective
  while the aircraft is frozen. Successful exports retain the existing baked-in
  provider attribution. Journal thumbnails use the bounded local IndexedDB cache;
  they are not full-resolution backups or proof the OS saved a download.
  Background scenery requests can still finish during composition; this is not a
  pixel-frozen replay or a video capture system.
- Recovery UI for WebGL context loss, explicit resume after restoration, and pause
  on backgrounding. Terrain loading has bounded holds and degraded-detail release;
  airport searches offer retries, while unavailable traffic cannot block flight.

## Worldwide airport contract

`public/data/runways/v1/manifest.json` identifies the OurAirports snapshot,
retrieval date and both source SHA-256 digests. The checked-in snapshot contains
**14,094 runways in 113 regional assets**, plus the three authored Ohio overrides.
The index is local search data; selected and nearby regions load on demand.

Only open land runways with valid endpoints, dimensions and elevations are
launchable. Closed airports/runways, heliports, water surfaces, malformed geometry,
unsupported polar/dateline records and incompatible aircraft are excluded.
Missing endpoint elevations use the airport elevation when available. This is a
gameplay approximation, not surveyed runway pavement. The catalog is not a promise
of detailed terminal, apron or taxiway scenery.

Rendering, contact, terrain treatment, approach guidance and scenery exclusion
share the same registry and fixed endpoint profile. Catalog profiles are immutable
once registered; a later DEM refinement cannot move a runway under the aircraft.
Generic airports offer runway/approach starts, rollout and departure from the
landing airport. KOSU, KCMH and KLCK keep their authored stands and taxi routes.
Free Flight can acquire a nearby eligible runway without teleporting or abruptly
cutting power. The Atlas offers nearby airport guidance.

`npm run data:runways` refreshes the assets explicitly; it is not run during CI or
ordinary builds. Review the manifest and complete-catalog validation before
shipping a refresh. Endpoint identifiers are stable `IDENT:LE-HE` values, and Ohio
identifiers remain unchanged. The selected catalog runway is cached locally so
Continue can resolve it before the first scene mount.

## Current world configuration

The following foundation/control blocks remain enabled:

`HDR_GUARD`, `LOAD_GUARD`, `DEVICE_TIERS`, `CONDITIONS`.

The newly enabled look bundle is now OFF pending visual approval:
`TWILIGHT_FIX`, `SUN_TRUE_AZ`, `PLAYER_SURFACE`, `TRUE_SCALE`, `TRUE_AREAS`,
`PHYS_SKY`, `EARTH_HORIZON`. Individual URL flags still permit diagnosis.

`R25_SKY`, `R25_GROUND` and `CLOUD_CALM` were already enabled in the source baseline
and stay enabled. Enhanced remains the default. Classic/Enhanced and Day/Neon
are available to ordinary players, without a review URL or automation exception.
Saved presentation choices are respected. A choice already overwritten by the
earlier candidate cannot be inferred; the restored controls let the owner select
it again. Progress and aircraft choices are preserved.

Enhanced again uses the pre-Explorer horizon and scale. The Earth-radius path is
retained behind its disabled flag. Existing streaming and resource ceilings have
not been raised. The Sydney Harbour Bridge
now has a lightweight first-party arch/hanger silhouette; existing Manhattan hero
models and the verified Sydney Opera House asset remain in use. `CREDITS.md` is
generated from the asset manifest and includes the runway data and bridge.

No claim of realistic pixel continuity or smoothness on a physical device follows
from these flag changes. Day/dusk/night/weather, shoreline transitions, tile seams,
urban turns and quality changes remain part of the acceptance route below.

## Reproducible release checks

Use Node 24 (CI) or compatible Node 25, install with `npm ci`, then:

| Command | Contract |
| --- | --- |
| `npm run verify:source` | Undefined identifiers/import evaluation, flags, front-door contracts, attribution |
| `npm run test:gameplay` | Operations, saves/migrations/recovery, adventures, encounters, mobile actions, Explorer |
| `npm run test:world` | Sun/twilight, loading, device tiers, true scale/areas, conditions, cloud stability, raster retry |
| `npm run test:shaders` | HDR and physical-sky shader checks, including browser GPU/CPU comparison |
| `npm run verify:beta` | All 30 maintained scripts above; writes individual logs and structured results |
| `npm run build:beta` | Production webpack build in `.next-explorer` |
| `npm run smoke:beta` | Production fixture UI, actual webpack worker RPC, photo/journal flow and recovery, phone viewport |
| `npm run soak:beta` | Twenty-minute live-provider hardware diagnostic; refuses software rendering, retains failed evidence |
| `npm run analyze:beta` | Derive resource/route verdicts from a soak report without modifying its raw evidence |
| `npm run start:beta` | Serve the candidate on port 3094 (`PORT` can override it) |
| `npm audit --omit=dev` | Current production dependency advisories |

On this Windows machine the global npm wrapper is broken; the equivalent is
`node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run <command>`.
The scripts themselves invoke Node directly and do not rely on that wrapper.

`.github/workflows/explorer-beta.yml` runs the release sequence on pull requests,
main pushes and manual dispatch. It archives `.graphics-review/beta`, including
logs, JSON, screenshots and a sample attributed PNG. `BETA_SOFTWARE=1` explicitly
forces software rendering; a browser without a GPU may use it regardless. Viewport
emulation never certifies a phone. Fixture data is synthetic and never shipped as
live data. The smoke does not use the legacy title/Classic pins. Its desktop
flight leg uses `?graphicsReview=1` to read the existing diagnostic handles;
the phone leg exercises the ordinary URL.

Run hardware diagnostics alone, with no other GPU benchmark. `BETA_SOAK_ROUTE=airports`
and `BETA_SOAK_MINUTES=6` select the focused departure/arrival route;
`BETA_SOAK_OUT` selects a separate evidence directory. Neither a six-minute route
nor a successful scripted pilot certifies sustained use or human flight feel.
The soak fails on recurring steady-flight stalls, missing takeoff/landing evidence,
uncaught errors, frame targets or preserved resource ceilings.
`BETA_GPU_TRACE=1` records slow WebGL calls and `BETA_CPU_TRACE=1` saves a Chromium
CPU profile. These instrumented runs diagnose causes; use an ordinary run for
acceptance timing.

### Repaired assertions and retained limits

| Earlier assertion | Resolution |
| --- | --- |
| Physical atmosphere must ship enabled | Retired after the owner's visual rejection. Its mathematical/shader checks still run with explicit pins; the shipping check now requires OFF until visual acceptance. No rendering threshold was loosened. |
| R25 saved Classic always wins | Restored for ordinary players. An unpinned, non-WebDriver test now checks that saved Classic/Neon survive and the look controls remain visible. |
| `title-free-flight` must exist | Updated to `title-explore`, with a real production UI check of the same entry flow. |
| Pause must contain the old welcome modal | Welcome moved to the skippable ExplorerGuide; Pause retains the control reference. |
| Conditions source regex assumes LF | Normalize CRLF at the reader; behavioral requirements are unchanged. |
| A file containing `buildTile` is a worker entry | Locate the emitted webpack bootstrap and execute init + buildTile through Comlink's wire protocol. Module registration alone does not pass. |

Historical resource ceilings remain visible: Owens 261 draws, satellite 375,
toy 480, satellite soak p95 triangles 2.2M, and existing per-aircraft geometry
budgets. Their original scene/settle assumptions still apply. Fresh-warp fixture
numbers cannot substitute for a lived flight or a production-provider run.
The maintained suite is a release floor, not a claim that every historical
browser/soak harness has been rerun or re-certified on this pass.

## Evidence and acceptance ledger

Automated results are recorded in `.graphics-review/beta/all.json` and
`smoke.json`; source, world and gameplay outputs include the actual case counts.
The compact checked-in record is
[`docs/reviews/explorer-beta/evidence.json`](docs/reviews/explorer-beta/evidence.json).
The catalog test registers every record. Deterministic operations checks cover
both runway directions at KSFO, EGLL, RJTT, LFPG, LOWI, NZQN, TNCM, YSSY, KASE and
VNLK, including sloped terrain and displaced thresholds. These are simulation
tests; they do not stand in for the ten visual/human airport flights.

The maintained suite contains **30 scripts**, including **17 Explorer cases**.
The production fixture smoke covers **24 checks** and executes the emitted worker
bootstrap through its real RPC protocol. The local smoke renderer is
**RTX 5080 / ANGLE D3D11**, not SwiftShader. Phone screenshots are viewport
emulation only. The production dependency audit reports zero advisories.

The visual repair passed the production build and all 24 smoke checks, including
manual fog/clear selection and night/day lighting during frozen composition,
return to Live, and ordinary-player graphics controls. The initial maintained
suite passed 29 scripts and failed only the now-retired physical-sky shipping
assertion; the two shader scripts passed after that contract was corrected.
Targeted ESLint still reports 26 existing diagnostics in FlyMode/FlyScene; a
before/after comparison found the same diagnostics and none added by this repair.
The existing browser was visually inspected at Rio using live scenery, with Clear
selected and midnight/Live light changes exercised. This is not a same-weather
image A/B or owner acceptance. The appended `visualRepair` evidence keeps these
results separate from the earlier candidate's measurements.

### Live-provider diagnostic and corrections

The first twenty-minute route used headless Chromium, RTX 5080/D3D11,
1920 × 1080 at DPR 1, real providers, High requested and an unpinned governor.
Its seven legs covered Manhattan, Sydney, Queenstown, night/rain, Ohio operations
and an ocean photo session. There were **zero uncaught JavaScript errors**.
Its nominal steady percentiles were p95 **18 ms** and p99 **24 ms**, but this is
**not a performance pass**: there were **62 steady intervals above 100 ms**,
including an **8.08-second** interruption. Whole-frame p95 draws were **378 > 375**;
p95 triangles were **2,069,395 ≤ 2.2M**. Transfers mostly took **8.8–14.3 seconds**,
missing the six-second target. The initial cold hold was about 20.1 seconds,
including polling granularity; a warm-boot claim cannot be inferred from it.

The first scripted departure failed to rotate because its input was too weak.
Stationary crash frames entered that instrument's steady window, invalidating
the whole-route performance claim. The corrected instrument excludes inactive
operations, controls the pilot every frame, records actual takeoffs/landings,
reads production resource counters and fails repeated stalls. Original raw data
remains at `.graphics-review/beta/soak.json`; `soak-analysis.json` explains the
invalid route and corrected resource reading. Do not substitute its percentiles
for acceptance evidence.

Corrections following that diagnostic:

- Keep the governor's session quality limit until an explicit graphics change.
  A five-minute simulated comparison reproduces the old two-minute reset and
  verifies the retained limit after the fix.
- Reuse local runway candidates while shaping terrain. An isolated 2,401-vertex
  comparison was about **5.4× faster**, with height differences below `6e-14 m`.
  The first GPU retest exposed an unbounded search across empty spatial cells for
  coarse tiles. Queries now fall back to scanning the loaded catalog, and the
  complete-catalog test covers a world-size query. That failed retest is retained
  in `.graphics-review/beta-airports/`.
- Bound the per-vertex candidate list as well: coarse tiles now query locally
  instead of checking every runway in a region at every vertex. A 2,601-vertex,
  full-catalog comparison fell from **3,942 ms to 4.4 ms**, with zero height
  difference. This is an isolated worst-case comparison, not an FPS claim.
- Explicitly report reduced detail after a loading cap, offer scenery retry,
  reset replayed tips, and finish the local photo-animation pause behavior.

These corrections require a fresh successful twenty-minute run before the
endurance gate can close. A focused airport retest is recorded separately in
`.graphics-review/beta-airports-fixed/`: takeoff and landing both succeeded,
with zero uncaught errors. Its p95 draws **368 ≤ 375** and p95 triangles
**1,505,653 ≤ 2.2M** passed, but p99 frame interval **39.2 ms > 33.3 ms** and
**81 intervals above 100 ms** (maximum **5.94 seconds**) failed. It was six
minutes, with a stationary post-landing tail; it is functional airport evidence,
not a full endurance certification. The maintained sampler now excludes that
stationary tail as well.

After the coarse per-vertex correction, a one-minute instrumented retest still
failed the frame target (p99 **71.6 ms**, seven intervals over 100 ms). A CPU/WebGL
trace attributes about **20 seconds** of that first minute to first-use
`getProgramInfoLog` waits, with individual calls around **4.18 seconds**. This
identifies shader-readiness/prewarm work still required; disabling diagnostics
has not been validated as a fix. Trace output is in
`.graphics-review/beta-cpu-trace/`. Its timing includes instrumentation, and its
short departure-only route cannot pass the operations/endurance route gate.

| Required acceptance | State / evidence to collect |
| --- | --- |
| Ten first-time players, desktop and phone; at least eight complete start → discovery → photo → journal | Pending human sessions. Record confusion independently from enjoyment. |
| All ten aircraft, slow/fast/heavy comparisons, keyboard/mouse/physical touch | Pending human feel review. Sensitivity and camera tuning are provisional. |
| RTX 5080 Chrome, integrated laptop, A17 Pro Safari, modern Android Chrome | RTX hardware headless diagnostics available. Physical display review, laptop and phones pending. |
| 60 fps target; steady p95 ≤20 ms and p99 ≤33.3 ms | Blocked by recurring >100 ms stalls in the initial diagnostic; nominal percentile pass is insufficient. |
| Twenty-minute urban/mountain/altitude/airport/photo/destination routes | Initial route completed with an invalid scripted departure and p95 draw overrun. Full corrected route, thermal and resource-growth assessment open. |
| Warm usable boot ≤8 s, transfer ≤6 s; holds ≤20/15 s | Guard contracts tested. Measured transfers missed the target; supported-device warm timing remains open. |
| Ten varied airports with reciprocal approaches, slopes and displaced thresholds | Deterministic contact checks available; physical/visual flights pending. |
| Feed loss, stale contacts, throttling, terrain failure, resume, storage faults, duplicate events and photo failure | Automated coverage in maintained tests and production smoke; adverse-network device walkthrough remains open. |
| Day/dusk/night/adverse weather, cities/mountains/coasts/ocean, quality changes while moving | Individual math/shader checks available; combined production visual review pending. |
| Owner beta acceptance, then public preparation | Pending. Provider agreements and deployment review come after acceptance. |

For each device save: build commit (or working-tree diff), OS/browser versions,
GPU, viewport/DPR/refresh rate, power mode, quality preset, provider or fixture,
route, wall-clock duration, warm/cold state, steady and streaming percentiles,
stalls, peak/end memory/draws/triangles, visual defects and recovery outcome.
Use `?diag=1` → Report now / Benchmark 60 s for measurements. Hide diagnostics
when testing ordinary menus; it intentionally overlays the app.

For each new player record: device, independent completion of each of the four
tasks, prompts/help required, first confusion, enjoyment score (1–5), and what
they wanted to do next. Do not combine task success with enjoyment.

## Known limits before acceptance

- First-use shader/loading interruptions and the lived satellite draw ceiling
  require further measurement and correction. No resource ceiling was raised to
  turn the diagnostic green. Do not advertise the 60 fps target as achieved.
- Provider arrangements and production hosting are unresolved; see
  [EXPLORER_PROVIDERS.md](EXPLORER_PROVIDERS.md). Free guest access does not itself
  make a service's use non-commercial.
- Renderer recovery can fail at the browser/driver level; the explicit restart
  path preserves durable progress. Unsaved session-only progress must be exported.
- Region stamps survive ordinary location-history pruning. The journal bounds
  storage to 8,000 locations, 500 landing events and 200 photo records; the shared
  thumbnail cache holds 24 images. Full photo files remain the player's exports.
- Catalog endpoint elevations approximate runway profiles; terrain/runway joins,
  markings, slope feel and scenery clearance require geographic visual review.
- Six regional collections are projections of discoveries, not a separate reward
  currency. Legacy medals/liveries remain authoritative and are not re-awarded.
- Production dependency audit is clear as of this pass; the development ESLint
  dependency chain still needs an upstream advisory fix. Do not use a forced
  downgrade of eslint-config-next to silence it.

Deferred as agreed: accounts/cloud saves, purchases/economy, multiplayer, gamepad,
key remapping, native packaging, replay and video export.

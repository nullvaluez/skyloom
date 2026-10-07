# Skyloom Explorer Beta — current release checklist

Updated 2026-10-07. This is the authoritative checklist for this pass. Older
`FLY_ROUND*.md` files remain historical evidence, not declarations of the current
shipping configuration. `AGENTS.md` has not been rewritten.

**Status: local beta candidate undergoing automated verification. Not accepted
for public release.** Physical-device performance, subjective flight/visual
quality and the ten-player study are open. Software-rendered browser checks do
not close those gates. No deployment, service purchase or public launch is part
of this change.

## Product included

- Guest play, nine aircraft and six existing adventures. The title leads with
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
- Photo composition pauses flight, weather evolution and traffic ingestion; grids
  and exposure are adjustable. Successful exports retain the existing baked-in
  provider attribution. Journal thumbnails use the bounded local IndexedDB cache;
  they are not full-resolution backups or proof the OS saved a download.
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

The following previously staged blocks are enabled together for this candidate:

`TWILIGHT_FIX`, `SUN_TRUE_AZ`, `HDR_GUARD`, `LOAD_GUARD`, `PLAYER_SURFACE`,
`DEVICE_TIERS`, `TRUE_SCALE`, `TRUE_AREAS`, `CONDITIONS`, `PHYS_SKY`, `EARTH_HORIZON`.

`R25_SKY`, `R25_GROUND` and `CLOUD_CALM` were already enabled in the source baseline
and stay enabled. Enhanced is the player look. Classic/Neon remain available under
`?graphicsReview=1` and automation for regression comparisons. Existing saved
Classic/Neon presentation follows the existing PLAYER_SURFACE migration to Enhanced;
earned progress and aircraft choices are not changed by that migration.

Enhanced uses Earth-radius curvature with latitude correction and bounded viewing
distance (High 120 km, Medium 90 km, Low 60 km before the world-unit cap). Existing
streaming and resource ceilings have not been raised. The Sydney Harbour Bridge
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

### Repaired assertions and retained limits

| Earlier assertion | Resolution |
| --- | --- |
| New True Earth flags must ship false | On/off behavior is pinned explicitly in the individual tests; candidate ship values are asserted separately. No rendering threshold was loosened. |
| R25 saved Classic always wins | Preserve the R25 contract with PLAYER_SURFACE explicitly off; its newer migration and production-pin behavior have their own maintained test. |
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
The catalog test registers every record. Deterministic operations checks cover
both runway directions at KSFO, EGLL, RJTT, LFPG, LOWI, NZQN, TNCM, YSSY, KASE and
VNLK, including sloped terrain and displaced thresholds. These are simulation
tests; they do not stand in for the ten visual/human airport flights.

| Required acceptance | State / evidence to collect |
| --- | --- |
| Ten first-time players, desktop and phone; at least eight complete start → discovery → photo → journal | Pending human sessions. Record confusion independently from enjoyment. |
| All nine aircraft, slow/fast/heavy comparisons, keyboard/mouse/physical touch | Pending human feel review. Sensitivity and camera tuning are provisional. |
| RTX 5080 Chrome, integrated laptop, A17 Pro Safari, modern Android Chrome | Pending physical devices. Current browser venue is Chromium/SwiftShader. |
| 60 fps target; steady p95 ≤20 ms and p99 ≤33.3 ms | Pending device captures. Keep streaming windows separate; recurring >100 ms stalls fail. |
| Twenty-minute urban/mountain/altitude/airport/photo/destination routes | Pending thermal, resource growth and recovery assessment. |
| Warm usable boot ≤8 s, transfer ≤6 s; holds ≤20/15 s | Guard contracts tested; actual timing needs supported-device evidence. |
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

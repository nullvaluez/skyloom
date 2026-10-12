# Living Airports: release ledger

Implementation against `213dae3`, on the existing `claude/gracious-pasteur-sm1bz8` branch. No deployment or dependency upgrade. The working tree and previously untracked Explorer work are preserved.

## Integration onto current main (2026-10-12)

The owner requested a direct push to main. Integration is based on upstream `7833d643`, preserving its Explorer features, atmosphere/weather corrections, Ultra texture bound, and unchanged Next 16.4.0 manifest/lockfile. The earlier Next 16.1.0 measurements below describe the original isolated review build, not this integrated build. The original checkout, preview and comparison captures are preserved.

Observation, optional material treatment and flagship exteriors remain OFF by default. Main's existing worldwide airport discovery stays active, including its four-airport rendering cap, spatial grid, immutable runway validation, usable-length eligibility checks and generic runway starts. The region/active-runway caches are bounded; current departure, observation and Explorer destination geometry are protected. The terrain merge retains physical tile bounds, exact indexed pavement queries, DEM restoration and registry notifications. No upstream sky/cloud/atmosphere policy, quality ceiling or dependency version is reverted.

The Explorer tutorial stays hidden in observation. Observation and airport-initiated Escort cannot add Explorer visits or photo rewards; ordinary Explorer photography remains intact. Traffic freshness feeds both the existing Explorer notice and the lounge. Both photo-mode and observation simulation holds remain active.

The combined production build is `uLfBqWIA_c0lRXL3prRjL`. The complete beta source/gameplay/world/shader suite passes 32/32; import integrity passes across 917 files. Airport observation 29/29, lifecycle 12/12, runway/cache 9/9, audio checks, lounge geometry/disposal and world-art checks pass. Deterministic provider/interaction browser checks pass 19/19, including quiet/delayed/unavailable states, safe/rejected joins, photography, keyboard isolation and no Explorer rewards.

The integrated production Explorer browser smoke passes 25/25, including real bundled-worker geometry, ordinary photography and journal recording, provider/context recovery, and phone preparation. The seated-lounge browser review passes 17/17 across Columbus, JFK, Innsbruck and Sydney, including 1080p, 1440p and ultrawide layouts, fixed-seat interaction and photo export, with no runtime or shader errors. These interaction checks and short timing windows do not replace the outstanding sustained performance acceptance.

One extra legacy check, `verify-render-optimization.mjs`, still fails its "duplicate effect profile" assertion. The same failure was reproduced on a clean upstream `7833d643` checkout; its policy/quality dependencies are unchanged in this integration. No governor or quality values were altered to satisfy it. The beta browser harness's worker bootstrap locator was updated to recognize webpack's multi-chunk `Promise.all` bootstrap as well as its single-chunk form; it still executes the actual emitted worker and asserts real geometry. The earlier full-route/performance limitations below remain open.

## Original review release posture

All three additions remain **OFF by default** in `lib/fly/airport-feature-policy.js`: airport observation/discovery, world material treatment, and flagship exteriors. Desktop review opts in with `?graphicsReview=1&airports=on&airportArt=on&airportScenery=on`. Each `on` can independently be changed to `off`. Mobile excludes all three even with review parameters. Art and exteriors also require Enhanced satellite rendering.

The existing atmosphere, sky, cloud, lighting, shadow, exposure, density and quality-budget settings are preserved. No additional render, reflection or fullscreen pass is introduced. Classic and Neon retain their material treatment. Promotion requires visual and performance acceptance; a successful build is not that acceptance.

## Owner review correction: seated airport lounge (2026-10-12)

The owner rejected the exterior viewpoint UI as laggy and unsuitable. The three-view observation design above is superseded by one seated first-person room at every airport. The owner explicitly chose **real live aircraft only**; no ambient or simulated flights have been added.

The room is first-party geometry with wood ceiling slats, a window counter, upholstered seating, metal window framing, terrazzo, a ceramic cup, and baked floor contact shading. It uses six merged draws, 26,896 triangles, approximately 3.55 MB of geometry attributes and three 512-square textures (about 4 MiB with mipmaps). It adds no lights, shadow maps, reflection pass or render target. These are stylized lounge interiors, not surveyed reproductions of each real terminal. Their visual acceptance belongs to the owner.

The camera stays at a fixed, terrain-validated seat. Dragging turns the head; scrolling and binoculars change the lens. Near clipping is restored when leaving or joining. Flight help and the duplicate exit no longer leak into observation. The activity drawer starts closed, six bounded aircraft hints help locate actual contacts, selection tracks from the seat, and the existing dossier/photo/join actions remain available. Labels are clipped against the room's window opening, rather than shown through its walls.

Observation activity includes contacts within 45 km and prioritizes the runway side. Existing contrail admission extends to 50 km during observation, within the same voice/ribbon budgets and physical altitude/type rules. Admission sorting is amortized to twice per second only in observation; histories and aircraft continue animating each rendered frame. Hidden flight label and minimap painters stop drawing in observation. The existing 60 fps vsync scheduler now also serves the lounge; free-flight and title cadence remain unchanged. The sky, cloud, atmospheric lighting and global material settings are untouched by this correction.

Live diagnosis on the previous deck returned 220 regional contacts and ten nearby Columbus contacts; the feed was not universally empty. It also exposed a flight tutorial over observation and a 6.16-second loading frame. Subsequent server logs include 403/429 provider failures and cooling periods. Provider backoff remains intact; an unavailable feed is not called a quiet airport. These findings do not establish that the owner's reported lag is fully resolved.

Verification receipts for the room live in .graphics-review/living-airports/lounge/. The first browser render caught a mixed indexed/non-indexed geometry merge and failed; normalizing geometry before merging fixed it. It is not a waived error. Node checks cover fixed-seat/terrain-refinement stability, restoring camera clipping, safe joins, cancellation, bounded finite room geometry and complete resource disposal. The earlier 20-minute failure and texture-budget failure remain open; this UI correction is not a new full-performance certification. Final room build: mCp5rT2TKqQRM7cwAc2ow (Next 16.1.0, unchanged lockfile). The updated lounge browser suite passes 17/17, and the revised deterministic provider/interaction suite passes 17/17. Final local Chrome samples measured 59.93 / 59.98 / 59.81 actual rendered fps at 1920×1080 / 2560×1440 / 5120×1440, all High. Rendered-frame rolling p95: 17.1 / 17.2 / 17.1 ms; p99: 20.8 ms at each size. The complete twelve-second browser timing windows contain no >100 ms stalls. These are short local hardware samples, not a paired route certification, an embedded-browser measurement, or the required physical midrange run. The live Columbus check returned 23 contacts within 45 km. Lifecycle 12/12, observation 29/29, aircraft-effects 14/14, rendering-policy 20/20, import-integrity 4/4 and world-art 3/3 pass; the room resource/disposal contract passes. Mobile flight-deck checks pass 29/29 with fullWorld:true, including portrait, landscape, small phone, multitouch and go-around. Production build and UI tests also passed before updating localhost:3097. The separate QA server has been stopped; the user preview remains running.


## Implemented

- Desktop title and Atlas airport search, four featured airports, 1 Hz inferred activity filters, selected-contact dossier and camera tracking, photography, and explicit exit/return controls. Quiet, delayed and unavailable data have distinct messages. The existing traffic endpoints, polling cadence and provider failover remain in use.
- Transient observation runtime and camera ownership. Flight/progression pause while traffic, weather and scenery continue. No new save schema, rewards, stamps, missions or currency. Photos taken from the deck do not award gameplay progress.
- Join checks current contact freshness, speed and aircraft-ceiling compatibility, ground state, loading, altitude, endpoint and intervening terrain clearance immediately before repositioning. It uses the existing Escort action; a failed handoff restores the deck state. A successful handoff retains an airport return address. Airport-initiated Escort suspends automatic spotting, contract and near-miss rewards until released.
- The checked-in 14,094-runway catalog uses the existing registry, four cached regions and at most sixteen discovered active runways. The current generic departure and observation airport are protected from eviction. Ohio's authored airport identities and taxi paths remain permanent. Generic starts require sufficient runway length and width, use only runway geometry, and provide no invented taxi network. Unlit catalog runways receive no fabricated runway lights.
- KCMH, KJFK, LOWI and YSSY have three authored camera compositions and lightweight first-party terminal/tower exteriors. Generic airports have one terrain-validated overview. Precise exterior exclusion bounds retire overlapping generic scenery. Airport geometry and terrain buffers are released/reconciled as regions change.
- Optional Enhanced treatment lightly softens imagery noise using an existing mip sample, blends existing cliff material fields, separates building roofs/facades, and adds airport shoulders using existing passes and textures. Existing regional pigments remain in use. It does not alter the atmosphere to hide ground defects.
- Keyboard focus/trapping in airport search, pan/zoom controls, direct camera cuts compatible with reduced motion, existing attributed photo export, and a four-voice nearby-aircraft sound pool using the existing mute/master lifetime.

## Baseline and evidence

`npm ci --no-audit --no-fund` restored Next **16.1.0** from the unchanged manifest and lockfile. Both baseline and candidate production builds use `next build --webpack`; Turbopack rejects the isolated baseline's dependency junction. The archived baseline lives under `.graphics-review/living-airports/baseline`, with build IDs and run settings recorded by the comparison harness.

The owner machine is an RTX 5080 / i9-14900KF / 64 GiB desktop. Local Chrome reports NVIDIA D3D11 hardware rendering. Headless browser runs are local evidence; they do not certify a physical RTX 3060 / RX 6600 or visible-display tearing.

Comparison providers are the configured Esri World Imagery and Esri Terrain3D LERC elevation sources, OpenFreeMap's OpenMapTiles data, and the checked-in OurAirports snapshot retrieved 2026-10-07 (14,094 runways, 113 regions, source hashes in its manifest). Traffic is a deliberately empty local response in comparisons; weather and solar time are pinned in the report. The sustained route uses the existing live aviation endpoints and records the returned source/freshness state. No provider or polling policy was replaced.

Current candidate build: `_CyPCN7gUR3i7ZJ1nYt7P`; baseline: `TMOqTz2wQGZT_4YA_f1EW`. Browser: installed Chrome `154.0.8037.99`, driven by the previously installed Playwright `1.61.1` test tooling, preserved outside the lockfile install and restored for QA. That optional browser runner is not a new production dependency. Import integrity passes across 908 first-party files.

Verification commands:

```text
node scripts/verify-airport-observation.mjs
node scripts/verify-airport-lifecycle.mjs
node scripts/verify-runway-catalog.mjs
node scripts/verify-airport-audio.mjs
node scripts/review-airport-observation.cjs
node scripts/verify-airport-browser-states.cjs
node scripts/airport-performance.cjs paired
node scripts/airport-performance.cjs resources
node scripts/summarize-airport-performance.cjs
node scripts/airport-performance.cjs soak
node scripts/summarize-airport-soak.cjs
```

The mobile flight-deck harness requires `FLY_URL=http://localhost:3097/?graphicsReview=1` so its diagnostic runtime is exposed. The final rerun on `_CyPCN7gUR3i7ZJ1nYt7P` passes 29/29 with `fullWorld:true`; omitting that query caused an earlier harness-only failure while reading its absent runtime hook. The same final build passes the 18-check desktop walkthrough and 17-check deterministic traffic-state browser run.

The functional harness writes screenshots, loading limitations and checks to `.graphics-review/living-airports/functional-report.json`. Paired and soak reports record build identity, effective graphics settings, viewport/drawing buffer, GPU, route, traffic fixture, frame times, resource counts and loading separately. Three paired runs at Medium 2560×1440 and High 5120×1440 are required. The paired traffic fixture is deliberately quiet and cannot certify dense live traffic. GL allocation instrumentation runs separately in `resources` mode because it intercepts texture binds and would distort frame timing. Its texture bytes include render targets; renderbuffers are reported separately.

## Acceptance gates

The local visual review, paired route measurements, allocation audit, mobile control checks and twenty-minute lifecycle route are recorded below. Acceptance is **NOT PASSED**: relative timing, texture allocation and sustained quality/stall gates remain red. Constant-High lifetime stability, actual browser background/resume and physical midrange hardware testing remain unproven. High ceilings remain 375 draws, 2.2 million triangles and 300 MiB textures. Steady flight requires p95 ≤20 ms and p99 ≤33.3 ms; repeated >100 ms gameplay stalls fail. Investigate paired regressions above 3%, with equal effective quality and settled content required before drawing a conclusion.

### Local checks, 2026-10-12

| Gate | Result |
|---|---|
| Lockfile install and baseline/candidate production webpack builds | Pass, Next 16.1.0; manifest/lock unchanged |
| Airport observation safety/catalog validation | 29/29, including all 14,094 rows |
| Observation lifecycle, cancellation, failed handoff rollback, lost tracking | 11/11 |
| Region LRU, revisits, bounded registry, protected departure/observer, exact spatial and terrain rejection | 8/8 |
| Bounded positional audio | 5/5 |
| Deterministic traffic-state browser | 17/17; quiet/delayed/unavailable, unsafe joins, actual Escort/return, ultrawide Photo input, no join points |
| Desktop browser | 18/18; all four airport arrivals, photo, dossier/track, exit; 1080p/1440p/ultrawide |
| Mobile flight deck | 29/29, full world; portrait/landscape/small phone, multitouch, throttle, go-around |
| Existing operations / encounters / adventures | 33/33 · 10/10 · 15/15 |
| Existing rendering policy / import integrity / attribution / world art | 20/20 · 4/4 · 4/4 · 3/3 |

The browser transfer checks exposed a React identity defect during integration: identical keys on sibling streamed layers repeatedly remounted terrain and retained resources. Each layer now has its own stable key prefix. The successful four-airport run is after that repair. This is a corrected implementation defect, not a waived gate.

The first sustained route was stopped after eight legs (6.6 minutes) when the governor degraded from High to Low. That instrumented run is preserved as `soak-transfer-churn.json`, not counted as a successful soak. Discovery had been rebuilding all streaming engines on each registry change. Distant transfers now retain those engines and their shared materials; their existing bounded rings replace old chunks normally, with new runway data attached to subsequent worker requests. Overlapping local discovery still explicitly refreshes exclusions. No quality budget or governor threshold was changed.

An ultrawide first-click Photo failure came from the global aircraft picker hearing an airport HUD pointer-down and opening a dossier before pointer-up. The new interfaces use the existing overlay hit exclusion; the regression test forces a hovered aircraft underneath Photo and confirms a single click exports without opening a dossier.

The **first three Medium pairs failed the 3% regression gate** despite meeting the absolute frame-time limits. Median p95 baseline → candidate: Columbus 8.2 → 11.4 ms; Manhattan 9.4 → 10.9 ms; mountains 9.8 → 12.8 ms; coast 11.1 → 11.5 ms. All effective tiers/DPR matched; no >100 ms frame occurred in the sampled flight windows. Raw evidence is preserved as `.graphics-review/living-airports/paired-initial-medium.json`. High certification was paused to investigate. These results are not a performance pass.

The subsequent clean, unpinned Medium run (`paired-unpinned-final.json`) had lower candidate median p95 at the first three sites, but recurring city stalls in both arms and a baseline coastal quality step. It is not a complete matching-quality acceptance result. Final comparisons use the existing test-only `__flyGovPin='hold'` on **both** arms; the sustained lifecycle route leaves the product governor active. No runtime threshold changed. The original rolling frame instrument is retained, but reported percentiles now cover each complete twelve-second flight window.

The first complete fixed-quality run, build `xFCR02UGTfWEiQJ7tye9F`, is preserved as `paired-before-spatial.json` and `paired-summary-before-spatial.json`. All 48 windows completed with matching effective quality, but the relative gate failed at five of eight quality/site combinations; city stalls also failed the steady-flight gate. A same-scene stationary material ablation on that build measured median p95 11.3 ms OFF / 11.0 ms ON, so it did not establish the art switch as the cause. It is a diagnostic, not a route acceptance pass.

The registry now uses a revision-bound sparse pavement index, retaining the exact overlap order and final geometry tests. Terrain flattening rejects points outside the existing shoulder bounds before a global runway-distance scan. Heights, margins, polar fields and retirement are checked against the original calculations; the isolated 200,000-query far-terrain benchmark improved from about 92 ms to 3–4 ms. That is not an FPS claim. The rebuilt candidate repeats every candidate route; the three unchanged baseline runs are retained explicitly, so this follow-up is not interleaved with fresh baseline runs.

Matched day Columbus/Manhattan, dusk Innsbruck and night Sydney images were reviewed on the preceding build (the subsequent spatial optimization does not change their geometry). Sky, clouds, horizon, exposure and broad shading remain consistent. The material treatment is deliberately restrained. Isolated rectangular objects visible in the Hudson occur in both arms; their upstream scenery attribution remains unresolved, and this pass does not claim to have removed every existing world-placement defect.

### Completed local comparison on the current candidate

The current candidate meets the absolute frame-time limits in every sampled flight window, with no >100 ms frames. The paired acceptance gate is still **NOT PASSED**. Three matching baseline runs and three matching candidate runs exist at each quality/site; candidate reruns followed the retained baseline batch, as disclosed above.

| Route | Medium baseline → candidate median p95 | High baseline → candidate median p95 |
|---|---:|---:|
| Columbus | 7.8 → 9.1 ms (**+16.7%, over tolerance**) | 12.5 → 10.4 ms |
| Manhattan | 10.1 → 10.3 ms | 15.7 → 11.7 ms |
| Innsbruck mountains | 10.9 → 9.6 ms | 14.8 → 10.9 ms |
| Sydney coast | 10.7 → 10.9 ms | 18.5 → 12.0 ms |

High endpoint samples top out at **358 draws / 2,029,334 triangles**, under the unchanged ceilings. These are sampled counts, not a certification of every loading/streaming peak. The separate allocation audit fails the 300 MiB texture ceiling in **both** arms: baseline 566.5–579.2 MiB, candidate 568.2–580.2 MiB, including render-target textures; renderbuffers are additional. Matched per-site increases are 0.7–5.3 MiB. The new airport exteriors add no textures or render targets, but the measured total ceiling is still not met. Its definition has not been narrowed to make this pass.

Raw evidence: `.graphics-review/living-airports/paired-report.json`, `paired-summary.json`, and `resources-report.json`. The same-scene material ablation and sparse lookup investigation do not waive the remaining Columbus comparison. No 60 fps claim on the physical midrange reference follows from these RTX 5080 headless results.

### Completed sustained route: failure retained

The final build completed **1,228,363 ms (20 min 28 s), 27 legs, 17 successful live joins from 37 attempts, and seven photo exports**, with no page errors, crashes or photo failures. The route revisited the four airports, all viewpoints, day/dusk/night, joining/releasing, urban turns, mountains and coastlines. Transfers took 6.2–18.5 seconds, measured separately from the flight windows.

It **fails acceptance**. The normal governor moved from High / DPR 1 / rung 0 to Low / DPR 0.75 / rung 7 by the seventh leg and stayed reduced. Sampled flight p95 ranged 7.8–22.0 ms, p99 10.6–34.4 ms, with **six >100 ms frames**. The raw live-feed route is candidate-only; it does not establish which change or existing renderer behavior caused each reduction or stall. No governor threshold was changed to conceal the result.

Heap snapshots ranged 166.8–559.1 MiB, ending at 337.0 MiB. Later repeated visits at Low had roughly stable geometry/texture/program counts rather than a monotonic climb, but this cannot certify resource stability at unchanged High quality. Headless tab switching left `document.hidden` false, so actual background/resume remains unexercised; the audio unit tests cover the simulated hidden state only. Reports: `.graphics-review/living-airports/soak-report.json` and `soak-summary.json`.

Before promotion: attribute the Columbus timing difference using fresh interleaved comparisons; trace loading/observation/flight phases around the live-route quality steps and stalls; reconcile the existing renderer's target allocation with the unchanged 300 MiB ceiling while preserving visual output; rerun a constant-quality lifetime check and real background/resume; complete the physical RTX 3060/RX 6600-class run. The owner was asked whether that hardware is available; no such machine was tested here.

### Milestone ownership

1. **Reproducible baseline:** complete locally; source snapshot, unchanged lockfile, isolated production baseline and GPU/settings receipts.
2. **World coherence and Columbus prototype:** implemented behind separate switches; functional checks pass, performance investigation remains open.
3. **Worldwide discovery and four flagships:** implemented and functionally exercised; exteriors are lightweight approximations and still require visual acceptance.
4. **Combined acceptance:** local campaign completed with failures; **not accepted and not promoted**. Remaining performance attribution and physical/device checks are listed above. A successful build or functional pass does not enable any switch.

## Staged work deliberately not enabled

The existing Explorer collection/journal/recovery/comfort components, persistence store, camera-transition system, earth-horizon changes and provider replacement configuration remain staged. Only runway discovery, registry support and data freshness handling were reused. The broad Explorer test suite asserts integrations outside this pass and is not a release gate for these additions. The old world-art assertion was reconciled with the current cinema lighting path; obsolete shading was not restored to satisfy a source string.

Provider rate limits remain dynamic: <https://github.com/adsblol/api#rate-limits>. The runway snapshot manifest retains source URLs, retrieval date and source hashes. Airport exteriors are approximate stylized compositions, not surveyed airport navigation geometry.

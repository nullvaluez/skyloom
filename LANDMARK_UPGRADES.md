# Landmark detail and mobile flight deck

Implemented on `codex/landmark-upgrades`, isolated from the active checkout at `2c624a3`. No deployment or integration into the active checkout. The original staged files and server were preserved. A final read-only reconciliation found the active checkout still at `2c624a34861fd3f73183851e6c4f40005bd1f05c` with its original eight staged documentation/media/agent files; there are no newer application commits to reconcile. Integration is deliberately left outside the active Claude checkout.

## Landmarks

The twelve-landmark collection keeps one merged mesh and shared material. Eiffel uses Scott Marshall's licensed lattice model nearby; its original first-party distant model remains. Empire State and Willis receive authored close-up architecture. Burj Khalifa and CN Tower have authored distant and nearby assets. Liberty, Taj Mahal, Sydney Opera House, Big Ben, Space Needle, Gateway Arch, and Colosseum retain their existing recognizable geometry. New architectural illumination includes clock dials, roof bands, structural wash, torch lighting and selectively occupied windows. It uses the existing sun fraction without extra lights or shadow passes.

Detail prefetch starts at 4,000 true metres, enters at 2,000 and exits at 2,500. Horizontal Mercator distances are latitude-corrected; altitude is included. There are two detailed slots, two outstanding GLB requests across all style lifetimes, and four cached landmark geometries. Low quality uses distant geometry. Existing geometry stays visible during downloads; medium detail survives a pending high upgrade. Failed requests back off for 30 seconds. Disposal handles stale completions after warps, quality changes and unmounts.

Cinematic marquee models no longer retain the old additive ground hemisphere: it produced a hard pale dome over the plaza at night. Procedural fallbacks and Neon keep their existing halos. Replacement telemetry now associates timestamps with the actual suppression epoch, so clearing suppression during a style unmount is not miscounted as a late model birth.

The original five-second merge floor, placement/ground hysteresis, floating-origin translation, label height and same-frame procedural suppression are preserved. Medium and high geometry carry position, normals, indexed vertex colors, surface attributes and lighting masks. Asset filenames are versioned for immutable cache headers.

## Asset provenance and reproduction

[Scott Marshall's Eiffel Tower](https://poly.pizza/m/aIpJchqtRTg) is CC-BY 3.0. The source download is [the Poly Pizza GLB](https://static.poly.pizza/95771d85-7ef5-4bbb-8d22-4baa2820396b.glb), SHA-256 `489613a06f9662f8ddaf7fb7d02ab9b87d56f04f780c6d002912e320b7ecdac7`. The export bakes source colors, normalizes the base and height, corrects the footprint to 125:330 proportions, removes 1,173 degenerate triangles, and authors lighting/surface attributes. The source has 57,185 triangles; the shipped high asset has 56,012.

[ManySince910's Burj Khalifa listing](https://sketchfab.com/3d-models/burj-khalifa-59e6dd74e5f647158de568b5a7f9cab7) and [zayshaa's CN Tower listing](https://sketchfab.com/3d-models/cn-tower-532b6478637c4f6894d9070719a45aaa) were evaluated. Their official download endpoints returned HTTP 401 without authentication. Their geometry is **not included**. Original first-party architectural approximations were authored under the repository's MIT license, as permitted by the plan. CN uses a tapered shaft, three buttresses, observation pod and antenna; Burj uses a three-wing stepped mass and floor bands. Willis uses nine bundled tubes and two masts. Empire State uses limestone setbacks, ribs and mast.

The full inventory, exact hashes and sources are in [monument-detail-assets.json](lib/fly/monument-detail-assets.json); application attribution is in [assets.js](lib/fly/assets.js) and [CREDITS.md](CREDITS.md). All inherited sources remain credited.

| Landmark | Asset tier | Triangles | Bytes |
| --- | --- | ---: | ---: |
| Eiffel Tower | high | 56,012 | 3,283,220 |
| Eiffel Tower | medium | 9,000 | 337,484 |
| Empire State Building | high | 3,552 | 354,792 |
| Willis Tower | high | 3,384 | 337,232 |
| CN Tower | far | 568 | 46,964 |
| CN Tower | medium | 2,424 | 189,904 |
| CN Tower | high | 2,424 | 189,904 |
| Burj Khalifa | far | 1,300 | 114,160 |
| Burj Khalifa | medium | 10,836 | 879,216 |
| Burj Khalifa | high | 27,732 | 2,202,220 |

Empire State and Willis reuse their small high assets at medium quality. All far assets remain below 1 MiB; medium is below 20,000 triangles / 2 MiB; high below 60,000 / 4 MiB. No compression decoder or texture fetches are introduced.

Reproduce from the downloaded source:

```powershell
node scripts/r20-monument-bake.mjs --in .graphics-review/landmarks/sources/eiffel.glb --out .graphics-review/landmarks/sources/eiffel-baked.glb --quiet
node scripts/build-landmark-details.mjs --eiffel=.graphics-review/landmarks/sources/eiffel-baked.glb
node scripts/build-landmark-details.mjs --eiffel=.graphics-review/landmarks/sources/eiffel-baked.glb --check
node scripts/gen-credits.mjs
```

The `--check` invocation regenerated all ten GLBs byte-for-byte. Missing the Eiffel source fails before writing an incomplete inventory.

## Placement and caches

The existing ten exclusion radii are unchanged. Burj adds 90 m and CN 32 m. The worker applies the same exclusions to satellite detail, skyline and Neon admission paths. The persistent vector cache stores **raw PBF response bytes**, not derived geometry (`vector-tile.worker.js`, `cacheWrite`). Every new worker rebuilds geometry using the current import-static manifest; derived engine caches die with the engine. Therefore no persistent derived cache or protocol schema needs a version bump. Reload the app after integrating this branch so the new worker manifest is active.

## Mobile design

Touch devices use a compact airport/phase/speed/AGL strip, a short guidance band, a 112 px left thumbstick, and a 150 px right power deck. Primary actions follow the flight phase. Braking, throttle and go-around remain reachable without opening setup. Targets remain 44 px, including the visually slim throttle control. On narrow phones the setup scroller stops above the power deck; landscape setup occupies the centre column. Safe-area insets and reduced motion are supported.

Takeoff and landing suppress duplicate instruments, traffic labels, contract and arcade overlays, and the minimap. Navigation stays available through the 44 px Actions button. The dispatch shelf and fleet strip replace the oversized mobile hangar layout. Touch cancellation, blur, backgrounding and overlay unmount release held brakes. Desktop operations keep their existing layout.

## Verification

- Landmark geometry, normals, provenance, dimensions, budgets, thresholds, quality, failures, cache/disposal and cross-style download concurrency: **16 checks pass**.
- Original icon and fleet static assertions pass; only the approved per-tier landmark file-size allowance changed. Aircraft and distant-asset limits remain unchanged. Browser checks in those legacy harnesses are explicitly not claimed by `--static-only`.
- Runtime browser integration passes **9 checks**, including a real intercepted HTTP 503, quality/style changes, rapid warps, recovery to one merged draw, and zero late replacement consumes.
- Mobile Chrome touch emulation passes **25 checks** at 390×844, 844×390, and 320×568, including two-finger controls and setup-panel reachability. Physical iOS/Android device performance is not measured.
- Current graphics unit checks pass; cinematic flight/material checks **16/16**; operations physics **33/33**; mobile Actions **9/9**; disclosure timing passes.
- Final isolated production build passes (15.4 s compilation) with `FLY_BUILD_DIR=.next-landmark-build` and `next build --webpack`.
- Changed application modules lint clean except two inherited `react-hooks/immutability` errors in LabelCanvas's mutable runtime callback registration. The same errors reproduce through `git show 2c624a3:components/fly/hud/LabelCanvas.jsx | node node_modules/eslint/bin/eslint.js --stdin --stdin-filename components/fly/hud/LabelCanvas.jsx`. This pass adds only a test/visibility hook there; it does not change callback ownership.

### Measured moving flight

The first hardware-rendered comparison ran at 1280×720 on NVIDIA RTX 5080 / Direct3D11, with the shipped governor and terrain settings active. Each leg flew roughly 1.57 km over 20 seconds. Both comparisons retained high quality, loaded detail, and one merged landmark draw. World readiness was true. No page errors occurred.

| Approach | Far baseline p95 | Detail p95 | Maximum frame before / after | Draws before / after |
| --- | ---: | ---: | ---: | ---: |
| Eiffel | 20.8 ms | 16.8 ms | 91.7 / 87.4 ms | 245 / 249 |
| Empire State | 20.9 ms | 20.8 ms | 79.2 / 62.5 ms | 251 / 253 |

Both short comparisons meet the requested 10% p95 regression ceiling. Whole-scene draws fluctuate with live traffic/terrain; the landmark mesh remains one draw. End-of-leg JavaScript heaps were Eiffel 842.6 / 677.3 MB and Empire State 612.9 / 652.1 MB; these snapshots include the whole application and garbage-collection variation and do not establish leak freedom. This is a development-server comparison of the original representation against detail, not a long soak or a device-wide performance guarantee. Terrain continued refining during the baseline legs (z17 toward z18); the report preserves those counters. Do not interpret the faster Eiffel result as a general speed improvement.

The review baseline flag restores the original far representation and illumination; for the new CN/Burj entries it restores procedural spires. This is a representation comparison in the current world renderer, not a second deployment of the full historical checkout.

### Final detail-transition benchmark

The final tree passed a second hardware run: 30 seconds / 2.36–2.38 km per approach, RTX 5080, 1280×720, high quality, no governor or terrain pins. Both upgraded legs began on far geometry and activated high detail around 14.3–14.6 seconds. Every non-vacuity check passed: moving flight, matching tiers, loaded high detail, terrain readiness, one draw, and hardware rendering. No page errors or late suppression consumes occurred.

| Approach | Baseline p95 | Detail p95 | Whole-leg maximum before / after | Peak near the detail switch | Scene draws p95 before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Eiffel | 16.8 ms | 16.8 ms | 87.4 / 83.3 ms | 54.1 ms | 261 / 260 |
| Burj Khalifa | 16.7 ms | 12.6 ms | 45.8 / 41.7 ms | 33.3 ms | 247 / 248 |

The switch-window peak includes the preceding frame and three following frames; it measures simultaneous whole-world work, not isolated landmark CPU cost. Brief spikes remain measurable even though p95 meets the 10% limit. Baseline-order, streaming and garbage-collection variation mean the lower Burj number is not a general speedup claim.

| Leg | JS heap start / peak / end | Renderer geometries / textures / programs at end |
| --- | ---: | ---: |
| Eiffel before | 719.2 / 876.2 / 850.2 MB | 344 / 224 / 127 |
| Eiffel after | 749.6 / 970.0 / 754.9 MB | 341 / 226 / 129 |
| Burj before | 581.0 / 635.8 / 519.7 MB | 340 / 222 / 128 |
| Burj after | 560.4 / 665.6 / 641.6 MB | 347 / 237 / 129 |

These are whole-application heap measurements and renderer resource counts, not measured GPU VRAM bytes. The short runs do not certify long-session memory behavior. Moving-flight timing covers Eiffel, Empire State and Burj; the twelve-landmark visual matrix uses fixed close and distant poses.

### Evidence

- `.graphics-review/landmarks/index.html`: filterable 144-image asset comparison gallery (twelve landmarks × two styles × three lighting states × before/after).
- `.graphics-review/landmarks/art/report.json`: asset review metadata, renderer and errors. This is explicitly isolated artwork review, not world certification.
- `.graphics-review/landmarks/world/report.json`: measured flight comparison, matching approach screenshots and readiness.
- `.graphics-review/landmarks/world.html`: filterable world comparisons at close and distant poses.
- `.graphics-review/landmarks/matrix/report.json`: full world image matrix with geographic placement, sun state, terrain readiness, quality and new exclusion populations.
- `.graphics-review/landmarks/runtime/report.json`: browser lifecycle and controlled-failure checks.
- `.graphics-review/mobile-flight/report.json`: mobile interaction and layout assertions, with portrait/landscape images.

The visual matrix uses fixed camera poses. The satellite shots remained at high quality without governor pins. The first long Neon sweep stepped down to medium/low under the shipped governor; those shots were superseded with high-quality held-governor captures so the artwork comparison is meaningful. Every recaptured row records its pins. Neon has a fixed palette, so its day/dusk/night clock captures are intentionally visually equivalent. Moving-flight benchmarks retain the shipped, unpinned governor and terrain settings.

The completed world matrix contains **288 images**, all high quality with ready terrain, no degraded scenes and zero page errors. Ten matrix checks pass: completeness, existing image files, quality, readiness, sharp satellite terrain, one updated landmark draw, close detail, distant fallback, exclusions and errors. The isolated asset matrix contains **144 images**. New exclusion checks found zero building columns inside the CN 32 m / Burj 90 m discs, while retaining 630 / 214 surrounding columns respectively. The local GPU and tile hosts were available for these final runs; missing GPU/tile readiness remains an explicit **BLOCKED** outcome in the harnesses.

Curated images and machine-readable reports are committed in [docs/reviews/landmark-upgrades](docs/reviews/landmark-upgrades/README.md). The complete 432-image local gallery remains under `.graphics-review/landmarks` to avoid adding hundreds of megabytes of redundant screenshots to Git. Recreate the packaged evidence with `node scripts/build-landmark-evidence.cjs` after running the capture and verification scripts.

## Reviewable commits and preview

- `2218aa6`: bounded detail streaming, licensed/authored assets, architectural night lighting and geometry checks.
- `e6d9464`: compact mobile flight deck, hangar and touch controls.
- `e896c02`: cinematic ground-dome removal, suppression telemetry and lifecycle/visual harnesses.
- Final evidence commit: this report, comparison images, test results and explicit visual capture quality settings.

The isolated development preview is `http://localhost:3017`. No deployment, push or integration into Claude's checkout was performed.


## Main integration - 2026-09-24

Before publication, fetching origin revealed 69 newer commits ending at `9bd7b4f` (R25 title screen and flight planning). They were merged into the isolated branch. The sole textual conflict was the GroundHangar import block; both the mobile stylesheet and R25 service-retry constant were retained. Claude's title and Free Flight flow remain intact.

Fresh integrated validation: production build PASS (20.3 s compile), import integrity 4/4, front-door 70/70, flight-plan 44/44, mobile Back/actions 16/16, landmark geometry/cache 16/16, landmark browser lifecycle 9/9, and mobile browser checks 29/29 with zero page errors and ready live terrain. Mobile now covers both Free Flight and operations hangars at 390, 844 and 320 px widths. A new helper enters operations through the actual title UI. The mobile harness now rejects page errors and exits 2 on unavailable world readiness. Two inherited Windows-only test issues were corrected without changing thresholds: slash normalization in the import exclusion census and CRLF normalization in the historical source comparison. The missing local `r25-w0` reference was reconstructed at the documented W0 scaffold `db78bdf`; it is not pushed as a new remote tag.

The first browser pass used the already-running development server during the merge and saw two invalid-token page errors despite passing its interaction assertions. Those results are superseded by the fresh isolated server run with zero page errors. Integrated reports are stored alongside the original evidence as `mobile-integrated.json` and `runtime-integrated.json`. The earlier frame-time and 432-image results describe the pre-R25 landmark tree; they were not relabeled as new integrated performance measurements.

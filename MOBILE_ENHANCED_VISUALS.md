# Mobile Enhanced visuals — 2026-10-29

This pass addresses the reported white stroke around the aircraft and flat
Enhanced Medium presentation. A GPT-6.1 Sol agent at max effort independently
investigated the cloud/composer path, implemented its repairs, and reviewed the
lighting/cadence integration. Flight physics, terrain identities, aircraft
assets, and the selected scenery tier are unchanged.

## Direct rendering repairs

Cloud ray marching, filtering and reconstruction previously classified depth
through independently rounded texture coordinates. At mobile cloud resolutions,
a low-resolution sample centre can land exactly on a full-resolution depth texel
boundary. The stages could then disagree about whether that sample belonged to
the aircraft or the sky, compositing bright cloud radiance onto the hull.

All cloud stages now use the same bounded integer depth address. This replaces
one depth lookup with one lookup; it adds no samples, targets or render passes.
It applies to both ordinary and TRUE_SCALE projection. The GPU regression uses
an opaque aircraft silhouette at five subpixel positions and three cloud scales.
On the host RTX 5080, the original path leaked into 675 hull pixels across those
15 cases; the repaired path leaked into zero. Residual missed background cloud
coverage in concave silhouette gaps was at most four pixels per 120×120 image.
This proves the reproduced defect is fixed, not that every physical-phone
artifact or display-tearing cause has been eliminated.

The physical sky also declared a per-device `skyHz` budget but never consumed it.
The LUT owner now honors that cadence, retains its existing dimensions and
sample counts, and immediately refreshes on boot, context restoration, clock
reset, large altitude jumps and large sun changes. In a synthetic two-second,
120 Hz rapid climb, sky redraws fell from 241 to 61 at the phone's 30 Hz budget;
aerial redraws and shader text were unchanged. This is a work-count measurement,
not a measured phone FPS increase.

## Mobile look and bloom preview

Use `?flags=MOBILE_ENHANCED` on a build containing this change. The flag affects
touch-device Enhanced Satellite at Medium/High; Classic, Neon, desktop and Low
keep their existing presentation. `?flags=-MOBILE_ENHANCED` is the comparison.
The flag ships **disabled**, as required by AGENTS.md until the owner certifies
the look on physical hardware. The two correctness repairs above do not require
the preview flag.

- The installed bloom implementation ignored the old `resolutionScale` for its
  active mipmap path. The preview sizes its actual luminance and blur targets to
  30% per dimension and uses five mip levels. The installed-library fixture
  measures 4,939,218 → 444,696 active target pixels (91% fewer) and 16 → 10 bloom
  subpass draws. It preserves the luminance threshold, intensity and blend
  equation. The softer bloom footprint still needs owner visual acceptance.
- Daylight world surfaces reuse their existing indirect-light term to separate
  lit and shaded terrain/buildings. The treatment eases under overcast and is
  zero at night. Direct light, emissive lighting and aircraft materials are not
  changed by this treatment. No new fullscreen AO pass is introduced.
- The existing single shadow map can reach nearby visible ground instead of
  stopping at 500 m regardless of altitude. Coverage follows rendered-ground
  AGL smoothly, is capped at 1,200 m, and resets on a warp. Its 1024/512 map
  sizes, cascade count and material identities remain unchanged. This can submit
  more nearby shadow casters; it does not come for free or claim a mobile FPS
  gain by itself.

## Verification

Evidence is generated under `.graphics-review/mobile-enhanced/`. The original
`before-views/` capture attempt is invalid as appearance evidence: its harness
did not wait for destination reveal and first-flight tips. `baseline-views/`
corrects both issues. Captures are review evidence, not visual acceptance.

Commands:

```powershell
node scripts/verify-mobile-enhanced.mjs
node scripts/verify-mobile-bloom.mjs
node scripts/verify-cloud-silhouette-gpu.mjs
node scripts/verify-cloud-reconstruction-gpu.mjs
node scripts/verify-true-earth-flags.mjs
node scripts/verify-graphics-repair.mjs
node scripts/verify-cinema-overhaul.mjs
node scripts/verify-render-optimization.mjs
$env:PLAYWRIGHT_CHANNEL='chrome'
node scripts/verify-phys-sky.mjs
```

The sky test accepts `PLAYWRIGHT_CHANNEL` so it can use the installed Chrome
when Playwright's separate browser download is absent. Its shader comparison
still explicitly uses SwiftShader. The cloud-edge regression and live-world
review use Chrome on the NVIDIA RTX 5080. Touch emulation on that GPU is not
iPhone/Safari testing, thermal testing, or battery testing.

Recorded checks: mobile policy/cadence **6/6**, installed bloom **6/6**, flag
registry **8/8**, prior mobile graphics repair **8/8**, cinema **16/16**, render
optimization **22/22**, physical sky **12/12**, and import integrity (1,184 files,
no undefined references). Shadow/graphics invariants, scoped ESLint, and the
Impeccable mechanical scan also pass. The first physical-sky attempt could not
launch the absent Playwright download; the installed-Chrome rerun passed.

The final isolated production build succeeds with webpack
(`FLY_BUILD_DIR=.next-mobile-enhanced-review`). Earlier attempts encountered
Windows generated-directory permission errors and Next.js's existing dependency
security advisory interrupt. Retrying the build outside the filesystem sandbox
completed; no dependency upgrade is part of this rendering change. The final
cleanup fix also checks that unmounting clears the shared daylight uniform.
Final build ID: `M1xGPpK2P6IvINT8WJqIT`. The 36-check transition sweep and fixed
views preceded that final cleanup-only guard; the final build's moving flight
and the unmount fixture passed afterward.

The production phone/desktop transition sweep passed **36/36**, including the
actual mobile bloom target dimensions, Medium/Low/High, desktop Ultra, the
512-pixel mobile shadow fallback, Classic/Enhanced, Neon return and day/golden/
night. It logged zero runtime/shader errors. Capture inspection found no broad
aircraft outline or new obvious exposure failure in those sampled views.

The city/mountain/night appearance captures still reached the world's existing
loading time cap (terrain/buildings/shader readiness was not fully settled at
reveal). Therefore they are not evidence that all content loads, nor a universal
draw-budget pass: sampled phone city draws were 284/285, above the historical
250 phone budget; mountain was 234. No budget was raised. At the city pose,
shadow coverage increased from 500 m to approximately 755 m using the same map;
at the mountain pose it remained capped at 1,200 m. The active phone bloom target
area was 77,386 pixels at a 1055×487 scene buffer. Streaming/live traffic differs
between boots, so total scene draw changes cannot isolate this optimization.

Final sequential moving-flight comparison on the RTX 5080, phone landscape
layout, Enhanced Medium, 1.25 DPR (1055×487), 12-second settle and eight seconds
per leg. Review inventory was disabled. Both arms retained Medium and the same
`phone` effects profile, with zero runtime/GL errors:

| Arm / leg | Rendered FPS | p95 interval | p99 interval | Longest interval |
| --- | ---: | ---: | ---: | ---: |
| Baseline, straight | 59.98 | 18.9 ms | 21.1 ms | 26.2 ms |
| Preview, straight | 60.06 | 19.7 ms | 22.0 ms | 24.1 ms |
| Baseline, turning | 57.17 | 23.2 ms | 32.2 ms | 103.0 ms |
| Preview, turning | 58.50 | 21.7 ms | 25.8 ms | 99.3 ms |

The flight at 900 m used the preview's 1,200 m shadow cap versus 500 m in the
baseline. Near-60 FPS and the small, mixed interval changes are not evidence of
a universal speedup; live streaming differs between boots. Occasional ~100 ms
turning hitches remain. The concrete gains are the fixed cloud-depth mismatch,
bounded bloom work, and honored atmosphere update budget. Raw observations are
`baseline-flight/report.json` and `preview-flight/report.json` beneath the
evidence directory.

Live-world review commands accept an isolated production URL:

```powershell
node scripts/review-mobile-enhanced.cjs --url=http://localhost:3097 --flags=MOBILE_ENHANCED --output=.graphics-review/mobile-enhanced/preview-views
node scripts/verify-render-flight.cjs --url=http://localhost:3097 --flags=MOBILE_ENHANCED --devices=phone,desktop --output=.graphics-review/mobile-enhanced/transitions
node scripts/render-flight-benchmark.cjs --url=http://localhost:3097 --flags=MOBILE_ENHANCED --cases=phone-enhanced --preset=medium --review=0 --settle=12000 --duration=8000 --output=.graphics-review/mobile-enhanced/preview-flight
```

Physical-device acceptance remains open: check Medium in a dense city turn,
mountain approach and night flight, including cloud-backed wing edges and
portrait/landscape rotation. Keep the device report's flags, effective profile,
render scale and frame intervals with any observations.

## Main push verification — 2026-10-29

Rebased onto `b4086333`, preserving the newer Lounge Mobile work. The only
conflicts were the appended constants blocks and the device-report registry;
both `LOUNGE_MOBILE` and `MOBILE_ENHANCED` are retained with their prior defaults.
The combined tree passes mobile policy/cadence 6/6, bloom 6/6, flag registry 8/8
(53 flags), import integrity 4/4 (1,202 files), Lounge Touch 31/31 and Lounge
Glass 56/56. Its isolated production build (`.next-mobile-main-463aa03c`)
completed successfully after the same existing Next.js advisory interruption
and retry described above. No dependency change or flag promotion was made.

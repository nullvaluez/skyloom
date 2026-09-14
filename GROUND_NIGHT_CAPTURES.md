# Ground and night capture index

Capture index finalized September 14, 2026. Existing files are linked below; **pending
rows are not completed evidence**. Screenshots support visual review, not a
frame-time, memory, or physical-device certification. The integration record is
[GROUND_NIGHT_MOBILE.md](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/GROUND_NIGHT_MOBILE.md).

Current review runtime: `8d4a823092bdb061111d009b852630dadfce6eb9`, build
`EfX5slWsg8pig7H-3wquA`, SHA-256
`e6c2d9b0b607ea23f9f27947d18e9c504309756fa50194ac2f99bf256819a30d`,
historically served from `http://localhost:3038` (stopped September 14).
Final reports below match that served identity, not merely the runner checkout.

## Powell daylight: pair captured, visual acceptance pending

The existing pair uses 40.1990, -83.0811; heading 5.916666164260777 radians;
noon preset; high tier; 1652×1262 viewport; DPR 1. Altitudes are requested AGL,
not sea-level altitude. The report records actual AGL at approximately 420.014 m
and 91.440 m. Compare both reports' weather, camera, actual terrain residency and
pins before attributing visual differences to the code changes.

| View | Before | Corrected build |
| --- | --- | --- |
| Powell, 1,378 ft AGL | [Existing image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-before/powell-reference-noon-1378.png) | [Current image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-contact-powell/powell-reference-noon-1378.png) |
| Powell, 300 ft AGL | [Existing image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-before/powell-reference-noon-300.png) | [Current image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-contact-powell/powell-reference-noon-300.png) |
| Capture report | [Existing report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-before/report.json) | [Current report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-contact-powell/report.json) |

The current pair reports `CAPTURED`, no recorded errors, and the current runtime
identity above. Allocation instrumentation was not enabled for this pair; it
is image evidence, not a memory/performance pass or an approved visual verdict.
The [earlier corrected pair](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-final/report.json)
belongs to `a73770d`, build `AmIT0nMT9DMV3D52YvWbq`, runtime SHA-256
`dde4c9b3ad2750b50c714e444cc5fe6fbbd4f9bc1a2069b14a9261f8bec7ebe8`.
It predates the ground-contact correction and is preserved as older evidence.

Before receipt: commit `835234c0f70877a200b75d4588a9a8cb33b297f4`, build
`90DqHFGYo48EdO_zLGbv6`, runtime SHA-256
`dde8f1ddcc0b51b5041bfbe029c3eae294cb2ba4f7b04debf4d22984c8af9af9`.
Use `servedBuild` in this report for the rendered source; its top-level source
hash describes the runner checkout. Status is `CAPTURED`, not a full acceptance
verdict. The before images record `camTileZ` 16 and 18 respectively.

The [user's original screenshot](C:/Users/bfecho/AppData/Local/Temp/codex-clipboard-8ef73303-e276-4b53-ba2a-c6ba4867e9e0.png)
is a temporary local reference, not a reproducible build receipt. The
[raw Esri tile](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight/powell-esri-z18.jpg) helps separate
baked foliage/color seams and tree shadows from game rendering.

## Final 15-view matrix: captured; memory gate fails

The [final report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/report.json) contains all
15 views from the current served build, with no recorded runtime errors. All
fixed-pose draw and triangle checks are within their limits. Its overall status
is **FAIL**, because every view exceeds the unchanged 300 MiB texture limit.
The images are available for review; the completed capture is not a full
acceptance pass. These use the same five locations and noon/dusk/night presets
as the original matrix, requested 300 ft AGL, 2560×1440, high tier, DPR 1.

**Capture scope:** Paris's file named `dusk` records a true sun elevation of
−9.096°, which is the game's **night** bucket. The preset and filename are
retained for comparison with the original capture; this is not a Paris dusk
appearance check. Settled streamer queues and the reported `sharp` flag also
do not establish complete imagery or object-contact refinement: all three Ohio
views report `camTileZ: 15` against target 18, ground detail has zero instances
in seven views, and contact work remains pending, reaching thousands of building
contacts in some views.

| Location | Noon | Dusk | Night |
| --- | --- | --- | --- |
| Manhattan | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/manhattan-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/manhattan-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/manhattan-night-300.png) |
| Ohio | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/ohio-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/ohio-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/ohio-night-300.png) |
| Melton | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/melton-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/melton-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/melton-night-300.png) |
| Owens | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/owens-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/owens-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/owens-night-300.png) |
| Paris | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/paris-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/paris-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-night-final/paris-night-300.png) |

Local inspection covered Powell 300 ft, Ohio noon and Manhattan night. The
Powell image still shows a hard imagery-color seam and baked tree shadows;
those remain provider-image limitations documented below. No subjective
user acceptance or moving-flight conclusion is inferred from these stills.

## Original 15-view baseline

Five locations × noon/dusk/night, all requested 300 ft AGL, 2560×1440, high tier.
The [original report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/report.json)
records clean-main commit `f0cd81e5fe79979488a1e9a0cf062923d66a8450` and status
`CAPTURED`. It predates the served-build receipt field; preserve that limitation
and do not relabel it as a new final run. The Ohio pose is 40.20403, -83.0896,
which is different from the Powell reference pair above.

| Location | Noon | Dusk | Night |
| --- | --- | --- | --- |
| Manhattan | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/manhattan-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/manhattan-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/manhattan-night-300.png) |
| Ohio | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/ohio-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/ohio-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/ohio-night-300.png) |
| Melton | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/melton-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/melton-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/melton-night-300.png) |
| Owens | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/owens-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/owens-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/owens-night-300.png) |
| Paris | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/paris-noon-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/paris-dusk-300.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-baseline/.graphics-review/ground-night-baseline/paris-night-300.png) |

The six-view `ground-night-first` directory is an earlier iteration. Current-build
validation is separately **PENDING** at
`C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/`;
earlier `835234c` flights/soaks
are historical baseline evidence and do not certify the corrected renderer.

## Earlier daylight receiver proof

The [receiver report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/report.json)
records `PASS` at three locations plus extra checks on commit
`6041c22e1fb9b9ea2f0b577ae89d0b7da8c7f1b8`, build `F-c-AwQJ87qbrTNLmmYJs`,
SHA-256 `839049e7bc7bbf2e8978b30231a33f07d50689c4bfa47ca38f0b943cee210cfa`.
It predates the canopy commit-revision fix and is not current-build certification.

| Location | Illumination on | Receiver difference |
| --- | --- | --- |
| Powell | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/powell-attempt1-on.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/powell-attempt1-receiver-delta.png) |
| Manhattan | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/manhattan-attempt1-on.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/manhattan-attempt1-receiver-delta.png) |
| Melton | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/melton-attempt1-on.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-daylight-appearance/melton-attempt1-receiver-delta.png) |

## Mobile evidence: Chrome touch emulation

The [final replay report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/report.json)
and [console log](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/mobile-actions-final-replay.log)
record **518/518 PASS**, zero duplicate gate names and zero page errors on the
current `8d4a823` / `EfX5slWsg8pig7H-3wquA` receipt above. Both styles cover
320×568, 360×640, 390×844, 430×932, 568×320, 640×360, 844×390, 932×430,
768×1024 and 1024×768, plus simulated portrait safe areas. The 347 native-button
44px hit checks include deterministic Inspect, Hide aircraft info, Intercept
and Cinema geometry at 320×568 and 844×390 in both styles; 29 geometry passes
also check unique IDs and required actions.

The replay preserves speed, held Boost, free look, overlays, contextual action,
Back/Pause, focus, reduced-motion and two-thumb checks. CDP partial release
reaches Boost without releasing the joystick. Actual TouchControls unmount
disconnects its old DOM nodes while preserving the same runtime/input object
and clearing Boost, steering and look. Trusted browser media-change events
record coarse pointer true → false → true, followed by 154.4 ms of stable touch
layout with both controls mounted. Hidden-document cancellation is explicitly
a **synthetic visibility-property/event test**. These results do not certify
Safari, physical-device safe areas, native OS backgrounding or mobile GPU speed.

| Style | 320×568 closed | 320×568 open | 844×390 closed | 844×390 open |
| --- | --- | --- | --- | --- |
| Satellite | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/satellite-320x568-closed.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/satellite-320x568.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/satellite-844x390-closed.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/satellite-844x390.png) |
| Toy | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/toy-320x568-closed.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/toy-320x568.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/toy-844x390-closed.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final-replay/toy-844x390.png) |

All eight final captures were inspected after boot fade completion. Labels and
attribution are legible; the bounded panel avoids the joystick and action
button. Lower rows require scrolling, with reachability checked by the harness.
World aircraft/POI labels can still overlap passive HUD text or show through
the translucent panel in busy views; this is a remaining visual polish issue,
not a control-reachability failure in this run.

Historical mobile evidence follows; its build identities are unchanged.

The [existing report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions/report.json) records
364/364 passing checks on build `e-blfps0P5FwU1vaajBKK`, runtime SHA-256
`57382ce88a49451cb0720ad4b0ee6bb78b03b2913820bf71d7bcb56bd3fc33d3`.
It includes CDP multi-touch release evidence. This certifies those emulated
interactions only; iPhone/Safari, device safe areas, OS interruption and real
mobile GPU behavior remain unverified.

| Style | 320×568 portrait | 844×390 landscape |
| --- | --- | --- |
| Satellite | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions/satellite-320x568.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions/satellite-844x390.png) |
| Toy | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions/toy-320x568.png) | [Image](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions/toy-844x390.png) |

The [later 331-check replay](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-daylight/report.json)
also passed Chrome emulation, but belongs to `a73770d` / `AmIT0nMT9DMV3D52YvWbq`.
Its lower count reflects live contextual-button availability and one old
duplicate check, not omitted viewports. The revised verifier now requires
deterministic contextual geometry in both styles at 320×568 and 844×390,
including Cinema, plus duplicate-ID checks and additional lifecycle tests.

The [first final-build attempt](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/scripts/ground-night-out/mobile-actions-final/report.json)
and [failed log](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/mobile-actions-final.log)
remain **FAIL after 355 passing checks**. Unmount cleanup passed, but immediate
CDP detachment after touch restoration was followed by a desktop HUD at the
remount assertion. The harness correction keeps the emulation session attached
until context closure and waits for stable media, layout and visible controls.
The 518-check replay above uses the unchanged application build in a separate
output directory; the failed evidence has not been rewritten or relabeled.

## Final cloud and regression evidence

The [cloud rebase report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/clouds/report.json)
passed all four checks. The [weather report](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/weather/report.json)
passed 13 checks, with retained [cloud-band](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/weather/cloud-band.png)
and [above-cloud](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/weather/above-overcast.png)
views. These are controlled poses with a held governor. The weather fixture
replaces the flight step, so its HUD AGL is not an actual-altitude witness;
the report's prescribed sea-level height is the relevant coordinate.

The [flash log](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/flash.log)
records 9/9 PASS across 29,626 frames. The final
[step](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/steps.log)
and [pace](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/.graphics-review/ground-final-validation/pace.log)
regressions remain FAIL; details are in the integration record. The new continuous
cloud traversal and production Neon budget harnesses were not run before the
session interruption. No continuous cloud-pixel proof is claimed.

## Acceptance limits

The full 300 MiB texture gate remains **FAIL**. The final 15-view report measures
469.4–561.4 MiB of live textures, with a 588.4 MiB peak across the capture
sequence; every texture audit is complete with zero unknown allocations.
Renderbuffer allocations are reported separately and add to these totals.
Historical clean-main 499.1 MiB / first-candidate 506.4 MiB measurements used a
different, shorter capture sequence and must not be read as a matched delta
against this warmed 15-view run. The corrected clean-main resize control failed with
pale-row/endpoint-race observations, while a separate forced-resize probe passed
20/20. These do not establish cloud composition as the resize-failure cause.

## Provider conclusion and next evidence

Official metadata at the Powell reference point reports a March 9, 2025 City
of Dublin orthophoto with **7.62 cm source resolution**. Our zoom-18 cap implies
**45.6 cm nominal ground sampling**, with coarser tiles possible in the actual
view. Read-only probes returned one HTTP-200 256×256 JPEG at each of zooms 19–21;
they establish availability, not measured sharpness. Alternate providers have
not been visually tested at Powell. Exact queries, responses, pricing sources,
and rights limitations are in [GROUND_IMAGERY_OPTIONS.md](C:/Users/bfecho/skyloom-3/.claude/worktrees/ground-night-mobile/GROUND_IMAGERY_OPTIONS.md).

Sequence: validate the renderer correction, then compare providers at matched
poses and actual LOD, then consider a separate 3D photogrammetry proof with the
required key and terms. No provider migration or image-quality verdict is
implied by this index.

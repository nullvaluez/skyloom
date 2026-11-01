# Surface stability correction — 2026-11-01

The owner reported fuzzy, twitching windows during Manhattan flight and repeated
horizontal lines on Yosemite cliffs. The terrain report was at 37.7339 N,
119.6071 W, 4,660 ft, heading 052. Earlier still-image review did not establish
stability in motion.

The corrected feature set was subsequently authorized for release by the owner:
**“Push to main and enable everything.”** This enables the six features in
[Premium Earth](FLY_PREMIUM_EARTH.md); it is not a claim that unmeasured device
or resource-budget checks passed.

## Corrections

- **Facade coverage:** integrate each periodic opening across the pixel,
  including cell boundaries. Window and room contrast converge to their area
  average by 0.5 cells/pixel, with matching glazing roughness.
- **Facade relief:** analytic slopes replace differentiation of masks that
  already contain derivatives. The first analytic version still aliased in GPU
  motion tests. The final cutoff follows the small bevel's width: full relief
  below .0125 cells/pixel, retired by .025, while the bevel spans 4–2 pixels.
  Nearby relief remains; larger windows retain their own filtering scale.
- **Building handoff:** an evicted near tile keeps masking its skyline
  counterpart throughout the rendered fade. Duplicate returning tiles combine
  coverage with `max(k)`. Sixteen live tiles, two residency-slack tiles and four
  dying tiles fit the existing 24 uniform slots.
- **Rock weathering:** remove the repeated 18 m height sine from cliff color
  and bump, retaining irregular triplanar weathering. Filtering uses the full
  XYZ pixel footprint. Raw height gradients are computed before applying
  filtering weights; derivative calculations precede spatial mask branches.

## Verification

| Check | Result before release enablement |
|---|---|
| `verify-facade-filtering.mjs` | 168 independent integration cases; area preservation, close detail, moving phase sweeps, analytic slopes and cell seams pass |
| `verify-facade-motion-gpu.mjs` | RTX 5080 / Chrome D3D11; 5,184 moving shaded renders against each policy's 6×6 supersampled reference, including 65° and 80° views |
| `verify-building-handoff.mjs` | 4/4; eviction, fade, re-entry, capacity and rebase behavior |
| `verify-terrain-weathering.mjs` | Old contour defect reproduced; artificial 14–22 m band energy reduced 99.991%, irregular weathering variance retained; constant-height/filter-ramp test passes |
| `verify-architectural-realism.mjs` | 9/9, including actual near/far × Enhanced/Classic × realism on/off GPU assembly and readbacks; matching night pixels between flag arms |
| Other targeted checks | Source 5/5, world 10/10, shader 5/5, Stylized Earth 22/22, Premium Earth 10/10, graphics unit and targeted ESLint pass |
| Production build | Pass |

The unresolved bevel contribution has zero measured alias residual after
retirement in the isolated GPU test; representative old controls measured
.011–.036 RMS. This is not a claim of zero whole-game flicker. The fragment
baseline hashes were refreshed for this shared rendering correction; vertex
hashes did not change.

Both report poses settled in the rebuilt production capture, with sharp terrain
and ready streamers. Each scene was captured through sixteen 0.5 m travel steps.
Manhattan also completed 20 real-clock flight samples over approximately
3.66 km, with eleven additional near-ring evictions and minimum AGL 247 m.
There were zero runtime/shader errors and zero source changes during the run.
The Yosemite comparison removes the repeated horizontal rings; nearby
Manhattan windows retain their structure through the approach.

An exploratory whole-image second-difference metric included ordinary edge
travel and was inconclusive for the near city. It was not used as a passing
gate. The supersampled GPU reference isolates the bevel defect instead.

Local capture artifacts remain in the ignored `.graphics-review/shimmer-fix/`
directory; this document and the executable regression scripts are the durable
record. Physical iPhone/Safari, sustained thermal behavior, long-flight
performance and the combined feature set's existing triangle/draw budget
overruns are not newly certified by this correction. See
[Premium Earth](FLY_PREMIUM_EARTH.md) for those measured limits and open checks.

## Release checks with enabled defaults

After the owner's enable-and-push instruction, all six feature defaults were
enabled and their default/rollback assertions updated. `verify:beta` passes all
34 checks; the production dependency audit reports zero vulnerabilities.
The production build, 27/27 gameplay smoke checks, and Ultra → High → Medium →
Low → Ultra terrain shader checks pass with no feature URL pins. All terrain
programs remain within the portable 16-sampler limit, with zero runtime/shader
errors. Architectural realism passes 9/9, twilight balance 13/13, and the city
horizon gates pass after comparing worker transport versions separately from
unchanged geometry payloads.

On this Windows workstation, sandboxed build-directory creation and browser
photo download required normal local file access. The authorized reruns passed;
no product behavior or test assertion was weakened for those environment errors.

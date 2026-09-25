# Painterly Flight

Implemented in the isolated `codex/painterly-flight` worktree, starting at
`2fb97b2`. The original checkout and its staged files are unchanged.

**Enhanced is the default on all devices as of 2026-09-25**, as requested by
the user. Explicit saved player choices still take precedence. The validation
limits below remain recorded: Radeon 780M has not been available for measurement.
The user authorized publication to `main`; no separate deployment command is part of this work.

## Implementation

- Integrated the saved sky (`origin/r25/c`, `11d1f8d`) and ground
  (`origin/r25/d`, `4bc873e`) changes into the newer architecture. The current
  landmarks, mobile controls, operations, geography and live traffic remain.
- Enhanced uses the common sky model for horizon, atmosphere, cloud lighting,
  key/fill chroma and environment orientation. It retires overlapping haze and
  terrain sunlight contributions. Night keeps the existing visibility ramps.
- Classic-first terrain now acquires missing relief from the existing cached
  DEM loader. A bounded queue keeps visible geometry in place and rejects late
  replies after a profile change, tile replacement or teardown. Mesh refinement
  remains disabled.
- First-party `cinematic-v3` material arrays provide broad painted washes,
  directional marks and subdued normal/roughness detail. They cost 5.33 MiB
  including mipmaps, load only for Enhanced Satellite, and release on Classic
  or Neon. Versioned appearance keys accompany the assets; raw geographic
  caches remain reusable. Classic retains the original v2 assets.
- Ground marks use the existing transported world-metre phase, tile seamlessly
  through rebases, and filter out with distance and pixel footprint. Classified
  surfaces keep mapped exclusions, field/road structure and dry-land evidence.
  Unknown and distant geography retain imagery fallback.
- Forest crowns keep their mapped placement and the original near/far triangle
  budgets. The distant representation groups nine crowns into three shouldered
  masses instead of nine cones; the detailed geometry morphs into that shape
  ahead of its existing distance switch. Enhanced geometry is lazy and disposed
  when leaving the profile.
- Revision `painterly-v3-r5` addresses the user's Nevada mountain and Alaska
  forest screenshots. Enhanced distributes stands irregularly inside the union
  of accepted forest cells, validates the entire rotated crown against the
  existing exclusions, and queries elevation at the new position. It retains
  the instance count, raw mapped occupancy, deterministic world identity and
  triangle budgets. Classic retains its original placement pending the explicit
  exception requested after automatic approval review rejected a shared fix.
- Ground correction in Enhanced disables the saved photographic reference
  transfer (including its allocation), which produced tile/triangle value seams.
  A derived inner feather follows WorldCover filling without mutating raw masks;
  material response weights interpolate rather than switching at raster pixels.
  Vegetation pigment retains source brightness and stays within 15% per colour
  channel. Grass/shrub labels and green-tinted shadows can no longer turn dry
  Nevada slopes into bright grass or flat dark patches. The photographic base,
  relief, roads and source classifications remain intact.
- Ordinary regional roofs and facades share the painted arrays and restrained
  highlights. The player fleet shares hull/glass treatment without changing
  meshes, dimensions, livery sources, flight handling, gear or navigation lights.
- The three categorical classification textures are packed losslessly into one
  R8 atlas. This fixes an actual 16-sampler GPU limit exposed by the integration,
  without increasing classification texture storage or resampling category IDs.
- Photographic sharpening from the saved ground branch is suppressed while the
  painterly material treatment is active. Broad surface forms retain native
  image filtering. The isolated saved-ground component retains its original
  configuration and regression assertions.
- Neon uses the same HDR and PMREM conversion with explicit buffer ownership.
  The old implicit converter retained 24 MiB after leaving Neon. Passive cleanup
  now precedes the new style's bake. A GPU comparison across three roughness
  levels produced **zero changed pixels** against automatic conversion.
- Enhanced reserves 24 MiB of the existing 80 MiB terrain cache for material,
  relief and streaming overlap. Residency still evicts only hidden tiles.
  The visible mesh density and tessellation settings are unchanged.
- Reconstructed bloom targets release during the React commit, before the next
  chain allocates its buffers. R3F's deferred disposal had overlapped both
  generations. Only private render targets release immediately; shader materials
  remain under R3F's normal deferred ownership. PCF/Basic shadows retain their original depth texture, precision
  and filtering, while the unused colour attachment uses R8 instead of RGBA8
  (12 MiB saved at 2048 square). VSM and cube shadow targets are excluded.
  A reversed-depth GPU comparison verifies unchanged shadow pixels.
- Profile switches now retain a terrain material's complete uniform table.
  Three caches its shader programs but keeps only one latest uniform table per
  material. Compiling Classic had removed the Enhanced-only bindings, so returning
  to a cached Enhanced program used stale lighting/relief inputs. A real Ohio
  round trip shifted the ground by 31.136/255 before this correction; the fixed
  development run measures 0.057/255 (Ohio) and 0.006/255 (Nevada), both within
  the unchanged noise-floor allowance. Classic shader text remains unchanged.
- Rio's black night clouds were reproduced through **Title → Free Flight → Rio
  → Fly**. The Enhanced solar-scattering model correctly reached zero at night,
  but the cloud pass normalized that zero into zero ambient and key light.
  Enhanced now blends model chroma through the shared daylight ramp and retains
  the existing cool night illumination. Daytime model chroma and Classic cloud
  shaders are unchanged; no additional textures or passes are allocated.

## Integration with current main

Before publishing, fetched main at `30a0450` and merged its Clear Sky work.
The shared cached-uniform correction was independently present there. Its engine
teardown subscription, stale warm-up guard and persistent relief-backfill queue
are retained; the queue is limited to one decode at a time for this pass. Pending
work keeps its slot through profile changes, and the commit checks actual tile
residency. The older parallel queue is removed. The painterly material, cloud,
lighting, memory and terrain corrections are retained. Main's prior default
change is superseded by this task's explicit visual/hardware acceptance gate:
Classic is the initial profile, with saved preferences respected.

The merged production build passes (`build-r8.log`). Focused checks pass:
painterly **18/18**, resident backfill, Classic compatibility **12/12**, and
saved ground **42/42 executable checks**, with optional offline GLSL compilation
unavailable. Earlier GPU runs below use the pre-merge production build r7;
they are not represented as merged-build certification. The merged production
round trip (`roundtrip-r8/report.json`) passes Ohio with a 0.041/255 mean
change and p99 zero. Nevada remains **BLOCKED** because the unchanged Enhanced
control varies by 0.735/255, p99 four; that exceeds the existing noise limit.
No runtime errors occurred. The local merged preview is http://localhost:3042;
the gallery at http://localhost:3041 has 15 pairs / 30 images and all comparison
controls checked. The code was pushed to main in `de59ab1`.

## Latest corrective checks

`rio-clouds-red/report.json` records **42,939 occupied cloud pixels, 100% black,
mean radiance 0** before the fix. `rio-clouds-fixed/report.json` passes after the
same title-screen flow: **42,958 occupied pixels, 0% black, mean radiance 0.07786**,
both initially and after Classic/Enhanced switching. Classic measured 0.07811;
the shader reports day = 0. There were no runtime errors. Captures and the
camera/time state are retained beside each report.

The focused CPU suite is now **18/18**, including cached-program uniform
bindings, night/day cloud illumination and buffer-only bloom release. The
unchanged R25 flag-off tests pass **12/12** and sky tests **49/49**; optional
offline GLSL compilation is still unavailable.

The quality-step harness previously forced only one governor rung, which now
changes DPR without reaching medium tier. It now walks the existing ladder to
the requested tier and back to the top rung; assertions are unchanged. All three
actual tier cycles preserve resident geometry, agree on drawing/composer sizes,
avoid increasing memory floors, keep the world visible and report no errors.
The program-count invariant still **fails** (six-program range after cycle one).
Buffer-only bloom release does not close that failure; it is not claimed as a
shader-churn fix. See `tier-step-target-release.log`.

The production `matched-r7` capture finished **30 images / 15 pairs**,
including Rio at night. Eight technical checks pass. The resource check fails
at Rio in **both** profiles: Classic 2,507,025 and Enhanced 2,507,069 triangles,
against the unchanged 2,000,000 limit; each uses 223 draws. No runtime/shader
errors occurred. This new scene exposes a remaining resource failure.

Production `roundtrip-r7` passes Ohio (mean change 0.044/255) but reports
Nevada **BLOCKED** because its unchanged Enhanced noise floor was 1.791/255;
that unstable control cannot certify the return comparison.

Production `timing-r7` **passes**: 31,620.9 m in 180 seconds, 22,224 frames,
p95 **16.6 ms**, p99 **25.0 ms**, full 1920×1080 with terrain/governor unpinned
and allocation hooks off. Motion p95 is 274 draws / 1,024,156 triangles; runtime
and shader errors are empty. This is the pre-merge r7 build on RTX 5080, not a
Radeon 780M measurement. The workspace was merged while that already-built
server was running; report provenance preserves the sampled workspace stamp
and separately identifies the actual r7 build.

Final `allocation-r7` **fails** the 300 MiB texture gate: **304.09 MiB**
peak across warps, profile/style/tier changes and 60 seconds of real streaming.
The bank/revisit gate fails from the same allocation peak (draws and triangles
remain within their limits). Renderbuffers peak at **6.48 MiB**, separately;
maximum sampled live geometry is **185.71 MiB**, excluding detached meshes and
driver overhead. The other eight technical checks pass, with zero runtime or
shader errors. The prior revision-5 allocation pass is historical and does not
supersede this failure.

The merged saved-ground fixture rerun (Owens-only, `r25-ground-roundtrip-fix.log`)
passes **9 checks, 0 failures**: Enhanced/Classic/Enhanced mean difference
**0.190/255**, p99 two, under the original floor-relative gate. Both profiles
use 137 draws and 180,711 triangles; all 5.00 MiB of Enhanced ground allocation
return on Classic. The omitted Neon leg is explicitly not calibrated; Sierra
and Smokies readiness remains unverified from the earlier run.

Earlier revision-5 measurements below remain historical evidence.

## Verification and evidence

The revision-5 matched capture run (`matched-r5/report.json`) completed **28
images / 14 pairs** with all technical checks passing, including the user's two
locations. Maximum sampled draw count was **282** and scene triangles
**1,733,203**, within the unchanged per-scene gates. Material failure/recovery,
Neon resource release, tier changes, banked revisit and hangar return passed;
there were no reported runtime or shader errors. This is technical evidence,
not a declaration of user visual acceptance.

Revision-5 production timing (`timing-r5/report.json`) travelled **31,585.7 m
in 180 seconds**, recording 16,548 frames at full **1920×1080** with terrain
and governor unpinned and allocation hooks off. **p95 16.8 ms / p99 33.3 ms**:
the strict 16.7 ms desktop target **fails**. Live traffic, real movement,
streaming readiness and resource checks passed, with zero reported runtime or
shader errors. Motion p95 was 282 draws / 1,057,777 triangles. The available GPU
was NVIDIA RTX 5080; **Radeon 780M remains unverified**.

Revision-5 allocation (`allocation-r5/report.json`) **passes** the 300 MiB
texture limit, including day/overcast/dusk/night, Manhattan, Owens, repeated
switches and 60 seconds of actual streaming. Peak textures: **297.23 MiB**;
peak renderbuffers: **6.48 MiB** separately. Maximum sampled live geometry
attribute payload: **185.69 MiB**, excluding detached meshes and driver
overhead. All technical checks passed with no runtime or shader errors.

Additional terrain-retention checks: `r24-a-unit.js` **29/29** and
`r24-b-ringhold.mjs` **14/14**. `r24-c-motion-unit.mjs` retains one failure,
**f2**, which requires `setBendEye(flight.pos.y, flight.groundElev)` while the
current architecture uses `groundElevVis`. Running that read-only test against
the untouched original checkout produced the identical failure
(`motion-base-control.log`). No assertion was changed to hide it.

The saved sky component's GPU regression completed **7 passed, 2 failed,
1 not calibrated** (`r25-sky-complete.log`; detailed results in
`.graphics-review/r25/c/verify-r25-sky-browser.json`). Its horizon rim deltaE
was Classic 9.25 / Enhanced 8.11 at low altitude and 1.96 / 2.09 at cruise;
neither met the unchanged relative-improvement requirement, and the low pose
also exceeded the absolute limit of 8. Luminance, clipping, Classic round trips
and the Owens draw lock passed. The cloud-edge pose never obtained building
readiness, so that measurement is unverified. This is a component-isolation run
with painterly materials disabled, not a substitute for the production captures.
The initial bundled-browser run was interrupted due to slow rendering; the
completed run uses the same Chrome GPU launch configuration as the flight gates.
Windows browser selection changes no visual or resource assertions.

The saved ground component's fixture regression completed **9 passed, 1
failed, 2 not calibrated** (`r25-ground-complete.log`). Sierra and Smokies
never met terrain readiness, so their relief assertions are unverified. Owens
passed seam, luminance, clipping, texture allocation/release, draw and triangle
checks, but failed the Enhanced/Classic/Enhanced pixel round trip (mean change
24.439/255). The Neon comparison passed its original relative floor assertion,
but that floor was noisy (13.616/255 mean), so it supplies weak visual evidence;
the separate controlled environment/shadow equivalence test is stronger.
The diagnostic-only photographic reference path stays available for component
regression and remains disabled in the production painted treatment.

The final terrain correction was inspected in clear daylight at
36.9174°N, 116.0940°W, 192 m AGL. The forest correction was inspected at
64.6421°N, 147.0470°W, 469 m AGL. Diagnostic captures are retained under
`nevada-terms`, `nevada-colour`, `nevada-evidence` and `nevada-support`.
The decisive control removes the colour replacement from **all three** terrain
bands; early single-band colour/wood probes were insufficient and are not used
as proof. New forest checks require substantial departure from rows and verify
every rotated footprint stays inside the accepted forest-cell union.

All evidence is local under `.graphics-review/painterly/`. CPU checks use
`node scripts/check-painterly-flight.mjs`; browser checks are separate programs:

```powershell
# Production build and playable comparison
$env:FLY_BUILD_DIR='.next-painterly-build'
node node_modules/next/dist/bin/next build --webpack
node node_modules/next/dist/bin/next start -p 3040

# Matched views; this includes weather, transfer, switches, banks and revisits
node scripts/verify-painterly-browser.cjs --mode=capture --url=http://localhost:3040 --sites=nevada,alaska,rio,ohio,powell,manhattan,mountains,owens,arid,desert,coast --output=.graphics-review/painterly/matched-r7

# Time and allocation must remain separate
node scripts/verify-painterly-browser.cjs --mode=timing --url=http://localhost:3040 --seconds=180 --output=.graphics-review/painterly/timing-r7
node scripts/verify-painterly-browser.cjs --mode=allocation --url=http://localhost:3040 --sites=ohio,manhattan,owens --output=.graphics-review/painterly/allocation-r7

# Actual fleet dimensions/liveries use the existing development diagnostics
node scripts/verify-painterly-compatibility.cjs --url=http://localhost:3039
node scripts/verify-neon-environment.cjs

# Local evidence viewer, separate from the game's routes
node scripts/build-painterly-review.cjs
node scripts/serve-painterly-review.cjs
```

The CPU suite passes the material, forest, operations, terrain and R25 checks.
The ground gate additionally reports its optional offline GLSL compilation as
**not calibrated** because `glslangValidator` is absent. Browser GPU compilation
is checked independently; this unavailable subtest is not counted as passing.
Windows file-URL and CRLF portability fixes preserve the existing assertions.

`compatibility-r5/report.json` records a successful fresh Enhanced boot, all nine
real aircraft at their specified dimensions with their livery attributes, and
actual imagery requests failing and recovering on revisit. No runtime or shader
errors occurred in that run.

The initial long motion run (`timing/report.json`) travelled 31.58 km in 180 s
at full 1920×1080 on an NVIDIA RTX 5080: p95 **20.8 ms**, p99 **37.4 ms**. It
missed the desktop target. A Classic control recorded p95 **16.8 ms**, p99
**33.4 ms** over 15.41 km in 90 s. The diagnostic CPU profile is separate and
is never used for timing acceptance. Its largest sampled work includes existing
terrain contact queries, terrain preparation, renderer uploads and traffic
ribbons. These observations do not establish Radeon 780M performance.

Suppressing photographic sharpening while painted materials are active brought
the next 90-second run to p95 **16.8 ms**, p99 **33.3 ms** over 15.43 km, at
full 1080p (`timing-no-sharpen/report.json`). That is still above the strict
16.7 ms target; it is not reported as a desktop pass.

Earlier allocation failures are retained: `allocation/report.json` reached
332.63 MiB during warps and style changes; the first fix reached 316.78 MiB
(`allocation-final/report.json`). Releasing the environment scratch removed
steady retention, but did not close the transient peak by itself. Detailed
allocation records then exposed outgoing bloom targets overlapping the new
chain and outgoing imagery. Shrinking prewarm buffers was tested, made no
measurable difference, and was reverted. The later runs below cover immediate bloom-target release, the smaller unused
shadow attachment and terrain reserve.

The first motion harness incorrectly required the arrival `sharp` flag at every
moving sample. That flag requires an idle loader, which continuous streaming
does not provide. Subsequent runs retain the existing flight harness's minimum
20 resident tiles, require live traffic, record detail telemetry, and reject
actual terrain HTTP failures. No frame-time or resource limit was relaxed.

The allocation sequence before the grid correction (`allocation-validated/report.json`) **passed**:
texture peak **295.76 MiB** against 300 MiB; renderbuffer peak **5.48 MiB**,
reported separately. The largest live geometry attribute payload sampled was
**185.70 MiB** in Manhattan. Warps, profile/style/tier changes, the banked
revisit, hangar return, material failure/recovery and 60 seconds of actual
streaming travel all completed with no runtime or shader errors.

The environment/shadow equivalence test (`neon-environment/report.json`)
records zero changed pixels. Disabling shadows changes 419 control pixels,
confirming that the shadow comparison is not a blank or shadow-free scene.

## Remaining visual and hardware checks

Review low countryside daylight, overcast, dusk and night, including the banked
return, then check suburbs, Manhattan, mountains, Owens Lake (mapped water),
the dry foothills, Nevada desert, Alaska forest and the Lake Erie coast.
The comparison holds camera, geography, weather, time and aircraft;
traffic and beacon phases remain live. Visual acceptance belongs to the user.

The 300 MiB limit measures texture allocations. Renderbuffers and live geometry
attribute payload are reported separately; the latter excludes detached cached
meshes and driver overhead. Frame timing is measured without allocation hooks.
Any missed target stays visible in the evidence. The user-requested Enhanced
default applies across device classes; that policy change makes no new hardware
performance claim.

# Twilight atmosphere correction

2026-10-31. Implementation on `main`; preview flags remain off by default.

The owner's Hoboken screenshot showed a rusty orange horizon, a nearly black
purple upper sky and a pale distant ground strip. The fixed-pose reproduction
uses 40.7095, -74.0463, 381 m MSL, heading 260 degrees. A sun elevation of
-3 degrees reproduces the reported sky and ground colors.

## Diagnosis

The physical atmosphere's planet shadow, units and lookup mappings are sound.
Two finishing choices break the sunset transition:

- The sky's 1.2 saturation boost clamps its already weak blue channel to zero
  near the setting sun. The physical aerial perspective does not apply that
  boost, so sky and air over the ground also acquire different colors.
- The authored night floor starts only below -2 degrees. The physical upper
  sky has already faded by then. At -4 degrees a 30-degree-high view renders
  approximately RGB 2, 2, 8, then gets *brighter* later at full night (7, 25, 48).

These RGB values use the physical tables, AgX and the display grade, without
film grain or vignette. They diagnose the transition; the live captures are
the appearance evidence. The existing atmosphere gate passed 12/12, but its
GPU table comparisons used a +30-degree sun and missed this interval.

The pale ground strip comes from the distant VIIRS city-light layer. Turning
that layer off removes the strip while ground mist remains on. Overhead
satellite radiance is redistributed onto an unobstructed ground plane; seen
at a shallow angle, its filtered lamps become a bright continuous carpet.
The reported band spans roughly 8–27 km at a depression of 1–3 degrees.

There is also a compositing gap farther out. On High, terrain fades into the
sky over roughly 36–60 km in scene coordinates. City emission was added after
that fade and only began its own fade near 98 km. Applying the terrain fade to
emission closes this gap, but the first live A/B demonstrated that it does not
fix the nearer carpet. The correction addresses both mechanisms; the
source-only fade test alone is insufficient acceptance evidence.

## Preview

`TWILIGHT_BALANCE` ships `enabled:false`, following the project's desktop and
iPhone review rule. Preview with the building pass:

<http://localhost:3010/?flags=BUILDING_REALISM,CITY_HORIZON,TWILIGHT_BALANCE&diag=1>

## Implementation

The physical sky's diffuse floor now arrives over solar elevations +6 to -6
degrees. It uses the existing night colors, reduces only the excess twilight
saturation, and publishes the same weights to the sky, aerial haze and image
based lighting. The extra floor thins with altitude and is absent above 60 km.
The physical scattering coefficients, sun position, scene exposure and the
stars' and lamps' time-of-day weights are unchanged.

Distant satellite city light now has a smooth visibility factor at shallow
view angles: 10% at <=1 degree, rising to the original brightness at >=6
degrees. It models the screening of street lamps by urban buildings. The angle
uses true metres, so latitude does not change it. This is an angular visibility
proxy, not ray-traced urban occlusion. The existing lamp pattern, city-to-mist
illumination, nearby road lights and individual building windows are retained.
The separate world fade prevents city emission surviving vanished terrain.

The sky correction is exactly neutral at solar elevations >=12 or <=-12
degrees. The light/terrain fade correction also applies at full night, where
the old bright horizon strip persisted. Flag off retains the previous look.

## Evidence

The live baseline ran in installed Chrome on the RTX 5080 (ANGLE D3D11), using
live map providers. The five-point sweep (+3, 0, -3, -6, -12 degrees) reproduced
the owner's screenshot at -3 degrees, with no runtime errors or source edits
during capture. The atmosphere table's recorded sun angle matched the live sun
at every point; stale lookup tables were ruled out.

Disabling distant night lights and ground mist removes the pale strip while
leaving the rusty sky unchanged. This separates the two faults. Captures and
runtime telemetry are in `.graphics-review/atmosphere-twilight/`.

The separate `isolate-no-night` arm confirms that night lights cause the strip.
It also reads the actual aerial effect: the new fade factor is compiled,
`uR25Mode.x=1`, and the fade band is 36,000–60,000 scene units. Thus the initial
remaining strip was a nearer-distance issue, not a stale shader or disabled
branch.

Regression checks:

- `verify-twilight-ground.mjs`: 6/6. Actual assembled aerial shader is identical
  to HEAD with the flag off; only distant-light visibility and the physical
  emission fade change on. Views at >=6 degrees retain their original light.
  All tier bands fade smoothly to zero with their terrain; air attenuation is
  retained and the uniform budget is unchanged.
- `verify-twilight-balance.mjs`: 13/13, including actual RTX 5080 half-float
  atmosphere tables, sky and aerial consumers, AgX and display grading.
  The old upper-sky minimum was 0.205 times its final night floor; the new
  civil-twilight minimum is 1.000015 times that floor. Saturation-induced
  clipped channel samples fall from 31 to zero. GPU/CPU luminance error is
  at most 0.46% across the tested low-sun interval.
- `verify-true-earth-flags.mjs`: 8/8, including URL pin and report registration.
- `verify-import-integrity.mjs`: 4/4; targeted ESLint clean.
- Isolated production build: final source passed in
  `.next-twilight-balance-final`.
  The sandbox first blocked creation of a generated types directory; the same
  source built successfully with the approved isolated build. Existing
  `metadataBase` warning remains unrelated to this pass.

Final desktop captures cover solar elevations +12, +3, 0, -3, -6 and -12
degrees, with zero runtime/shader errors and no source changes during the
six-capture run. The compiled aerial shader includes both corrections.
At the reproduced -3-degree view, the fixed far-band region
(1440-pixel width, rows 450–474) falls from mean display luminance 90.70/255
to 64.19/255, a 29.2% reduction despite the brighter, corrected sky. The
near-city region remains readable (19.06 to 21.57/255); its lights were not
globally dimmed. These are screenshot display values, not physical radiance
or performance numbers. See `luma-minus3.json` alongside the captures.

Both the primary and independent visual reviews accepted the final -3/-6
views: no replacement hard seam or black gap, and the near-building lights
remain distinct. Some faint warm settlement light intentionally remains.

The 430×932 touch-device emulation also rendered the final -3-degree view
under the Medium policy. Its first Next development-server boot reported a
syntax error and an `app/layout` chunk timeout; one reload recovered, followed
by a settled capture with no further errors or source changes. Those initial
errors are retained in `final-phone/manifest.json`. This checks the phone
layout and shader policy on Chrome/RTX 5080, not iPhone Safari or its speed.

For a same-time visual review, add
`&sunUtc=2026-10-31T22:05:35Z&weather=baseline` to the preview URL and use the
Hoboken pose above. Removing those parameters restores the live clock/weather.

No extra render passes, draw calls, textures or atmosphere-table work are added.
This is not an FPS or real-iPhone certification.

# R25 C SKY — ledger ("one atmosphere")

Branch `r25/c` (from `r25-w0`), worktree `/home/user/skyloom-r25-c`, dev `:3033`,
fixture `:3203`. **Venue: this container** — SwiftShader at 1–3 fps, four
cores shared by five roles, Esri / OpenFreeMap / adsb / open-meteo 403-blocked,
satellite imagery and DEM are E's OFFLINE FIXTURE. **Every pixel number below
is a fixture number; every fps / ms / tearing claim belongs to the user's
machine.** The sky itself (model, HDRIs, dome, clouds, haze) is real code on
real assets here — only the ground under it is synthetic.

## RED first

| gate | RED (calibration) | how |
|---|---|---|
| `verify-r25-sky.mjs` on `r25-w0` | cannot run: `lib/fly/sky-model.js` does not exist on the tag (`git show r25-w0:lib/fly/sky-model.js` → fatal) and `r25-sky.js` is the W0 stub, so every Enhanced leg would read NOT CALIBRATED | structural |
| `verify-r25-sky.mjs`, `R25_SKY_RED=ibl` | **(5a) FAIL** — worst azimuth error **3.14 rad**: the plan text's literal `sun.az − hdriSunAz` rotates the HDRI sun to `2·hdriAz − sunAz`, i.e. mirrored about the HDRI's own sun; 47/1/0, exit 1 | uses the literal sign inside the gate |
| `verify-r25-sky.mjs`, `R25_SKY_RED=classic` | **(4a) FAIL** on all three tiers — an Enhanced aerial gated on the BLOCK flag (`R25_SKY.enabled`) instead of `r25On` changes the CLASSIC post chain; 47/1/0, exit 1 | the realistic mistake, injected through `buildPassList`'s ctx |
| `verify-r25-sky-browser.cjs`, flag OFF | see §Browser (the pre-flip run on the intro tree) | `R25_SKY.enabled:false` on the served tree ⇒ Enhanced ≡ Classic |

## Mechanism (what was wrong, measured in source)

- **Two horizons.** The cloud composite painted the daylight sky from
  `livingSkyPalette` (linear `[.46,.63,.80]` at noon, `up = pow(ray.y,.42)` —
  EYE-LEVEL, ignoring the dome's dip), while fog / edge fade / depth haze /
  dome band / aerial haze all mixed toward `SKY.altAtmo`'s `#c6d7e8`. Two
  authors, two colours, and the sky's horizon sat at eye level while the
  terrain rim sat `dip` below it.
- **A flat haze colour against a sky with a sun in it.** The aerial pass's
  living-air path mixes every far pixel toward ONE rim colour; the sky above
  it has an aureole. A fully hazed rim pixel could only match the sky on the
  azimuth-average, never toward or away from the sun.
- **Clouds were unhazed and hard-cut** at `IMMERSIVE.clouds.rangeM` (22 km,
  `limit = min(rangeM/metricRay, dist)` in the march).
- **The IBL was never rotated:** the four HDRIs' baked suns all sit near
  app azimuth −55° (measured, below), whatever `runtime.sun.az` says.
- **Exposure was post-curve:** `resolveSatelliteAtmosphere().balance` folds
  `2^(stops/2.2)` into the sRGB WhiteBalance after ACES.
- **Two hazes stacked:** the aerial post pass (the living-air law) AND the
  16–55 km tile depth band AND exp2 fog all hazed the same far pixels.

## Fix (all behind `r25On(R25_SKY, sub)`; Classic = flag-off)

1. `lib/fly/sky-model.js` — single-scattering Rayleigh + Henyey-Greenstein
   Mie over a spherical exponential atmosphere, Chapman grazing sun path,
   ozone on the sun path, **first-order multiple scattering** (view path lit by
   the single-scatter sky ambient; without it the tangent horizon is orange at
   noon — measured r/b 0.98 vs 0.77 with it). Azimuth-separable, so an 8-row
   table (y' = u², dense at the horizon) × two phase functions per pixel IS
   the model. Mie phase = atmo-law's lobe (`ATMO_MIE_LOBE_GLSL`, lifted out of
   `atmoInscatter` with `ATMO_GLSL_FRAGMENT` byte-identical). Row 0 is the REAL
   planet's tangent ray from the eye altitude, mapped onto the game's dipped
   rim. `sunE 11.66` is the ONE radiance scale: noon horizon luminance at
   1500 m MSL = Classic's `#c6d7e8` (ratio 1.0043, gate 1h). CPU cost: a full
   table integration measured ~0.09 ms (node), re-run only when the eye moves
   10 m vertically or the sun 2e-4 in sin(el); steady state ~0.014 ms.
2. `r25SkyAtmo` overwrites `_atmoRim/_atmoVoid` IN PLACE with the model
   horizon (azimuth-averaged row 0) blended LINEARLY with the Classic rim by
   the composite's own `day` weight — the composite shows `mix(HDRI, sky, day)`,
   so the one horizon is the same mix. Fog, edge fade, depth haze, dome band,
   overcast lid and the aerial rim all read it (the round-6 rule, one source).
3. Enhanced **cloud composite**: sky pixels = the model GLSL with the dome's
   own dip (`y' = ray.y + getSkyDip()`); clouds hazed by
   `livingAirTransmission` to the slab-entry point with the model horizon row as
   in-scatter; model ambient/key CHROMA (Classic luminance kept); march alpha
   × `1 − smoothstep(16 km, 22 km)`. Prebuilt lazily, swapped per frame.
4. Enhanced **AerialPerspective** (`{r25:true}`): in-scatter =
   `r25SkyHorizon(mu)` on THIS pixel's ray — at the rim the sky row and the
   haze row are the same function, every azimuth (gate 3e, exact) — and
   `uR25Exposure` on every pixel, early-outs included (pre-curve exposure).
5. **Haze stack retired BY AUTHORITY** (`strength/0.55` of the aerial pass, read
   from AerialPerspective's own `_state` through a registered reader): tile
   band max × (1 − auth), fog → `fogFloor 3e-6` (the altAtmo cruise floor,
   weather still multiplies). Night ramp / fleet pin ⇒ authority 0 ⇒ Classic
   haze stands. 60–120 km rim fade untouched.
6. **IBL alignment**: `environmentRotation.y = backgroundRotation.y =
   hdriSunAz − sun.az` (wrapped). **The plan text's `sun.az − hdriSunAz` has
   the wrong sign** — three samples at `R^T·dir`, so a +Y rotation θ moves an
   app azimuth a to a − θ; proven through three's own Euler → Matrix4 →
   Matrix3ᵀ chain (gate 5a) and RED-calibrated (the literal sign fails by π).
   Table from `node scripts/hdr-sun.mjs --r25` (luminance-weighted centroid of
   the brightest 0.05 % texels, raw decode): day −0.972783, dawn −0.952488,
   dusk −0.979601, night −0.803958 rad. Blend steps take the circular mean.
   Classic writes nothing and the frame the profile (or style) leaves
   Enhanced restores exactly the rotation it found (gate 6h/6j).
7. **Exposure pre-curve**: `2^(satelliteExposureStops + biasStops)` in the
   aerial/composite; WhiteBalance gets `balanceTint` (the balance without the
   exposure gamma; `balanceTint × gamma ≡ balance`, gate 6m).
8. Dev pins: `__flyCloudFreeze` (cloud drift stops), `__flyToneOverride`
   (Neutral/AgX/ACES/None, read at mount — never shipped without a user A/B).
9. Prewarm: the CURRENT profile's aerial is warmed by the existing
   `buildWarmPasses` (buildPassList asks the same predicate); the ALTERNATE
   profile's aerial + the cloud pair are one more queue unit, **never under the
   fleet pin** (`visualsPinned()` non-null ⇒ skipped).

## Cost

- **0 new draws** (the aerial variant replaces the aerial text inside the same
  EffectPass group; the cloud pass stays 2 draws), **0 new textures** (the
  model reaches the GPU as 2 × `vec3[8]` uniform arrays). Program count: +1
  aerial variant, +2 cloud variants, compiled only once Enhanced is used (or
  lazily warmed when un-pinned).
- CPU: see (1); the rest is uniform writes.
- New keys: none needed in the world-bend registry — every new text lives in
  a raw `ShaderMaterial` / `Effect`, whose program key IS the text
  (`customFragmentShaderID`); gate 4d asserts Enhanced text ≠ Classic text.

## Gates

(filled in below — node gate table, browser rows, W0 baseline re-runs)

## Open risks

(filled in below)

## Unmeasurable here

- every fps / frame-time / compile-stall figure for the toggle (SwiftShader);
- the look of the model sky on a real display, and the Neutral tone-map A/B;
- real Esri imagery under the new haze colour (the fixture ground is synthetic);
- phone GPUs (uniform-array dynamic indexing is core WebGL2, but unmeasured).

# Building realism and continuous city distance

2026-10-31. Scope: Enhanced satellite buildings, their shared illumination, and
the coarse mapped city beyond the detailed ring. The owner's Manhattan capture
at 40.7311° N, 73.9892° W, heading 006°, 1,780 ft is the primary review pose.

Both True Earth flags ship **off pending owner certification**:

- `BUILDING_REALISM`: architectural palettes, differentiated facade/glass
  response, filtered structural detail, neutral texture modulation and quieter
  daytime grading.
- `CITY_HORIZON`: broader, bounded mapped city mass and a gradual outer fade.

Preview both with `/?flags=BUILDING_REALISM,CITY_HORIZON&diag=1`. Negative names
restore the prior paths: `/?flags=-BUILDING_REALISM,-CITY_HORIZON&diag=1`.
These flags are recorded in device reports. No persistent preference changes.

The follow-up [twilight correction](FLY_TWILIGHT_BALANCE.md) adds
`TWILIGHT_BALANCE` to this preview for the owner's rusty-horizon report.

## Diagnosis and changes

The old facade palette favored warm browns, cream and ochre. A later material
pass increased saturation 1.30× and applied another amber multiplier, including
to curtain glass inferred from non-glass building families. Photographic
surface detail could multiply its baked color into an otherwise neutral
material. The display grade then added another saturation lift and warm tone.

`architectural-realism.js` supplies regional, restrained mineral/brick palettes
and separate concrete, metal, glass and roof finishes. The material's structural
family and stable identity still come from the existing worker. Structural bays,
courses and room/blind variation use facade coordinates and derivative filtering;
unresolved windows approach their area average. Glazing is dielectric, with
roughness increasing as panes become subpixel. Texture detail modulates
luminance rather than repainting the cladding. Both near and far materials use
the same factory and material policy. No new material textures or per-building
draw calls are introduced.

The artistic lighting fallback also warmed the key at noon. The new daylight
policy removes that double tint and modestly opens shaded elevations. The
shipped physical atmosphere remains authoritative over the real solar spectrum
and direct intensity; sunset still lights neutral materials warmly. The daytime
display saturation lift falls from 15% to 3.5%, with a quieter split tone. Full
night lighting and material response retain the previous treatment.

The existing `CITY_RANGE` changes altitude visibility, not horizontal range.
The previous skyline uses small merged groups and drops most buildings below
35 m; its dense-city exception only admits 20–35 m bodies under a high tower
count. This leaves low-rise neighborhoods empty beyond the detailed city.

`CITY_HORIZON` uses larger merged source groups, includes mapped low/mid-rise
buildings in sufficiently dense tiles, preserves heights and footprint voids,
and bounds both source requests and triangle output. It creates no guessed
tower field over residential landuse or water. The near ring's resident-tile
mask still performs the handoff. Far mass loses contrast through the existing
atmosphere and disappears gradually inside the first uncovered source group.
This provides soft distant city silhouettes without blurring the aircraft or
nearby buildings.

## Resource limits

| Tier | Merged groups | Concurrent source requests | Maximum triangles/source | Fresh-tier skyline triangles |
|---|---:|---:|---:|---:|
| High / Ultra | 24 | 8 | 1,536 | 589,824 |
| Medium | 10 | 6 | 768 | 122,880 |
| Low | 5 | 4 | 384 | 30,720 |

Each group merges sixteen z14 sources into one mesh. These are new-build
ceilings, not observed rendering totals. A quality reduction retains surviving
geometry to avoid a destructive city reload: Medium can temporarily retain up
to 245,760 triangles and Low up to 122,880 from High-built groups until those
groups turn over. The existing chunk-fade pool also briefly holds outgoing
meshes. Request concurrency drops immediately. A downgrade first contracts the
radial mask over 0.8 seconds, retaining at most the previous group cap until
those outer groups are invisible, then releases them. Warps reset that hold.
These figures must not be described as hard whole-frame GPU limits.

At the Manhattan review pose the High policy's
complete-density to zero band is approximately 11.5–15.1 km in true distance;
the exact band follows the coverage footprint and latitude. Low and Medium
retain smaller budgets. Missing upstream geometry remains missing; this is
inferred material appearance on mapped geometry, not photogrammetry.

## Verification

| Check | Result |
|---|---|
| `verify-architectural-realism.mjs` | 9/9; actual RTX 5080 shader compile/link and readbacks, near/far × Enhanced/Classic, flag-off source identity, unchanged Classic and full-night pixels |
| `verify-architectural-daylight.mjs` | 7/7; continuous day/weather response, full-night identity, live frame writer, physical-sky authority |
| `verify-city-horizon.mjs` | 13/13; mapped low-rise and isolated 26 m mid-rise districts, source/triangle bounds, courtyard voids, full-circle coverage, queue cancellation, flag-off real worker parity against Git HEAD, movement and staged tier reduction |
| `verify-import-integrity.mjs` | 4/4; 1,323 first-party modules checked, no undefined names |
| `verify-true-earth-flags.mjs` | 8/8; both flags reachable through URL pins and device reports |
| `verify-ground-lighting.mjs` | 26/26 |
| `verify-cinematic-flight.mjs` | 16/16 |
| `verify-world-art.mjs` | 3/3 |
| Targeted ESLint / Impeccable detector | Clean new/modified JS; detector returned no findings |
| Production build | Pass with isolated webpack build; existing `metadataBase` warning remains |

`verify-cinema-art.mjs` passes 4/4 when its authored-sky baseline explicitly
pins `PHYS_SKY` off; that legacy test otherwise compares against a sky that is
no longer the shipped default. Two other legacy snapshot gates have inherited
drift: `verify-play-city.mjs` 26/28 (same failing hashes captured before edits)
and `verify-ship-city.mjs` 48/49 (old worker fingerprints). They were not
rebaselined. The new gates compare disabled output against the actual pre-pass
shader captures and Git HEAD worker, including nine Midtown tiles, with exact
parity. The display-grade disabled GLSL also equals Git HEAD exactly.

The reusable live scene harness is
`scripts/review-building-realism.cjs`; its completion predicate includes draping
and fading, which the inherited capture helper did not count.

The deterministic streaming test drives the actual engine through a full turn
and a 10 km return flight with a capacity fixture: zero sampled coverage gaps,
peak eight outstanding source requests and 25 meshes including outgoing fades.
The High-to-Low contraction test reproduces 2,788 uncovered angular samples with
the former immediate-eviction behavior and zero with the staged transition.
Outgoing fades drain by 1.5 seconds. These are engine/geometry checks, not a
claim about live-network latency or frame rate.

The venue is Windows with installed Chrome / D3D11 on the owner's RTX 5080,
not the historical cloud SwiftShader environment. Browser captures use live
imagery and vector providers with deterministic traffic, sun, weather and pose.
Phone viewport/policy emulation on this GPU does not certify iPhone Safari or
phone performance. Review captures do not establish representative frame rates.

### Live RTX 5080 comparison

Five matched desktop views completed with all terrain/loading/streamer settle
predicates satisfied and **zero shader or runtime errors**: owner-pose noon,
owner-pose golden hour, wider Manhattan, night, and Levittown. The enabled run's
source hashes stayed unchanged. The baseline records a source change in the
disabled horizon path during its capture; disabled worker/shader identity is
independently verified above. Live Esri and OpenFreeMap requests returned 200.

| View | Draw calls, before → after | Submitted triangles, before → after |
|---|---:|---:|
| Owner pose, noon | 299 → 327 | 1,873,276 → 2,571,462 |
| Owner pose, golden hour | 301 → 329 | 2,220,447 → 2,918,633 |
| Wider Manhattan, noon | 296 → 322 | 1,222,231 → 1,828,343 |
| Levittown | 316 → 340 | 1,250,011 → 1,737,885 |
| Manhattan, night | 275 → 305 | 1,189,842 → 1,904,384 |

The larger city has a real cost: the owner-pose noon frame submits about 37%
more triangles and 9% more draws. Those totals include the renderer's multiple
passes; the skyline itself grows from 115,833 to 480,335 resident triangles.
No performance ceiling was raised and no frame-rate certification is claimed.
The opt-in High budget is a fidelity preview for hardware acceptance, while
Medium and Low have their own smaller source budgets.

At the exact owner pose the High fade spans approximately 11.1–14.6 km true
distance; the 24 km policy value is a requested search radius, not guaranteed
rendered coverage. Medium's completed outer fade is approximately 7.3 km.

Local captures and manifests:

- `.graphics-review/building-realism/baseline-final/`
- `.graphics-review/building-realism/on-final/`
- `.graphics-review/building-realism/on-medium/`
- `.graphics-review/building-realism/on-phone/`

The additional Medium desktop view settled with 12 detailed and 10 skyline
groups, 288 draw calls and 1,770,035 submitted triangles. Phone-policy portrait
emulation at 430×932 also settled with 12 detailed and 10 skyline groups,
175 calls and 743,679 triangles in that narrower frustum. Both reported zero
shader/runtime errors and unchanged source hashes. The latter is Chrome on
the RTX 5080; Safari/iPhone acceptance remains open.

The independent visual review found the neutral mineral/brick/glass separation
and distant mapped mass materially improved in the noon and golden-hour pairs,
with no additional material defect identified in those views. Tall extrusions
and repeated facade grids remain procedural; these screenshots do not establish
photoreal reconstruction or motion stability.

## Owner certification

1. Compare both preview URLs over Manhattan at noon and low sun. Concrete and
   stone should remain distinct from brick; glass should reflect the environment
   without every building becoming a glossy blue mirror.
2. Fly toward and away from Midtown, then turn through 360°. Coarse mapped mass
   should remain beyond the detailed ring, with no rectangular disappearance
   edge or empty band during the handoff.
3. Check a suburb and a coast. The farther skyline must not invent towers,
   fill courtyards, or place buildings in water.
4. Check dusk/night, then repeat on the iPhone. Capture a diagnostic benchmark
   during flight, including a turn and an approach; a stationary image is not
   evidence about streaming or frame pacing.

## Rendering references

The material treatment follows the dielectric/specular distinction documented
in [Three.js materials](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
and the distance-filtering principles in
[Filament's material model](https://google.github.io/filament/main/materials.html).
Implementation remains on the existing shared Standard material and shader
hooks; the pass adds no transmission render target or full Physical material.

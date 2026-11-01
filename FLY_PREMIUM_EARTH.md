# Premium Earth — free asset implementation

**2026-11-01 · Three.js / React Three Fiber retained · enabled by owner instruction.**

After reviewing the corrected preview, the owner instructed: **“Push to main
and enable everything.”** All six features listed below now default on. This
is the release authorization; it does not turn the outstanding physical-iPhone
checks or measured resource-budget overruns into passes.

The approved extension improves the existing satellite world with real scanned
materials, asset-derived foliage, more plausible roof treatment, and a bounded
Yosemite elevation pack. Manhattan reuses the mapped city and existing landmark
LODs. No engine migration, paid asset, paid API dependency, or second terrain
surface was introduced. The product contract is in [PRODUCT.md](PRODUCT.md).

## Owner-reported surface regressions — 2026-11-01

The owner's moving-flight report exposed defects the earlier still review missed:
windows crawled and sparkled, and Yosemite cliffs showed horizontal rings.

- Facade apertures now integrate periodic pixel coverage, including cell edges,
  and converge to their area average by 0.5 cells/pixel. Recess and glass slopes
  are analytic; no filtered mask is differentiated again. The tiny bevel fades
  while its width spans 4–2 pixels, independently of the larger window pattern.
- A fading-out detailed building tile keeps masking its skyline counterpart
  until its last rendered frame. Re-entering duplicate coverage uses the maximum
  live fade, within the existing 24 uniform slots.
- Terrain no longer paints or embosses a repeating 18 m height sine on mineral
  faces. Irregular rock weathering remains. Cliff filtering uses the full XYZ
  footprint; raw height gradients are computed before applying detail weights.

These correct shared rendering defects; the correction added no new asset,
draw layer or paid dependency. The owner subsequently authorized enabling the
completed feature set.
Source/GPU regression evidence and live-scene captures are recorded in
[the surface correction record](FLY_SURFACE_STABILITY.md).

Regression commands: `node scripts/verify-facade-filtering.mjs`,
`node scripts/verify-building-handoff.mjs`,
`node scripts/verify-facade-motion-gpu.mjs`, and
`node scripts/verify-terrain-weathering.mjs`. GPU checks use installed Chrome;
their measurements isolate shader behavior and are not a device FPS certification.

## Defaults and rollback

The following TRUE EARTH blocks now ship `enabled:true`:

| Flag | Implemented behavior |
|---|---|
| `MATERIAL_SCANS` | Eight CC0 PBR surface layers, native compressed texture arrays, slope-aware cliff projection |
| `SCENERY_FORMS` | Atlas-derived deciduous/conifer stands, irregular stones, conservative scenery support, architectural roof refinement |
| `SHOWCASE_EARTH` | Manhattan roof policy; Yosemite conifers, geographic granite masks and replacement USGS terrain |
| `BUILDING_REALISM` | Regional architectural palettes, material response and filtered facade structure |
| `CITY_HORIZON` | Broader mapped city mass beyond the detailed building ring |
| `TWILIGHT_BALANCE` | Continuous twilight illumination and corrected distant city-light fade |

Enhanced Satellite uses all six on a plain URL. To disable them for one page
load, use:

```text
/?flags=-MATERIAL_SCANS,-SCENERY_FORMS,-SHOWCASE_EARTH,-BUILDING_REALISM,-CITY_HORIZON,-TWILIGHT_BALANCE
```

For an attributable comparison of the free assets, hold the final three
companions constant in both arms and enable/disable only the first three.
Classic and Neon do not enter the Premium Earth asset paths.
Flags are page-load controls, not in-flight asset switches.

In **Free Flight**, search for the existing featured destinations **Manhattan**
and **Yosemite Valley**. Their launch positions are inside the showcase regions;
no developer console or new game mode is needed.

## What changed

**Surface materials.** Poly Haven asphalt, concrete, brick, roofing, forest
floor, dry rock, sand and snow are baked into two eight-layer KTX2 arrays.
Albedo/roughness and normal/height/AO use the existing two sampler slots.
The scan supplies material structure while satellite imagery retains geographic
color and markings. Rock uses triplanar projection on cliffs, with footprint
and distance filtering. Roofs use family-appropriate material layers and
filtered detail rather than applying roofing shingles to every slab.

**Vegetation and stones.** Four views of two CC0 source trees are baked offline
into one shared foliage atlas. High-poly glTF sources never ship to the game.
Six trees per forest cluster use 48 triangles at either LOD, below the previous
342 near / 54 far limits. Geometry, atlas and alpha-tested depth material are
shared. Tree placement uses the existing evidence masks, density, draw groups
and streaming radius. Both admissions and later terrain repairs reject steep
support; the older canopy layer checks its drape-cell slopes too. Small scrub
and stones repeat support checks within the existing bounded query work.
Stones use 38 triangles and at most one additional pooled draw when present;
they share the existing 160/96/48 scenery-instance cap.

**Mapped architecture.** Worker-side policy removes inferred pitched roofs
from non-domestic slabs and Manhattan buildings without explicit pitch tags.
It preserves footprints, heights, courtyard holes and existing family IDs.
No invented tower layer or photogrammetry city is claimed. Near and far worker
messages carry explicit feature booleans; worker protocol is 24 at all seven
consumers and the surface publisher.

**Yosemite terrain.** A public-domain USGS 3DEP crop replaces the terrain mesh
inside its coverage through the existing loader. A worker resamples the local
heightfield, blends the perimeter into the original terrain and generates a
budgeted Martini mesh plus the existing relief data. The surface, building
drape and ground-contact queries read the same replacement geometry. Normals
come from the continuous heightfield rather than arbitrary triangle choices,
reducing shading seams between different tile LODs. Four slope-gated geographic
masks identify major granite faces. This remains heightfield scenery, not
photogrammetry, caves or overhang geometry.

## Costs and fallback

| Asset tier | Download | Notes |
|---|---:|---|
| Surface arrays 128 | 321,090 B | Eight color/detail layers, all mips |
| Surface arrays 256 | 1,275,973 B | Phone material ceiling in the existing profile |
| Surface arrays 512 | 4,988,855 B | Desktop High |
| Surface arrays 1024 | 19,486,212 B | Desktop Ultra; lazy, optional |
| Foliage 512 / 1024 / 2048 | 148,345 / 508,576 / 1,599,502 B | One shared RGBA atlas |
| Yosemite 512 / 1024 / 2048 | 304,128 / 1,216,512 / 4,861,952 B | Only requested in regional coverage |

KTX2 chooses a supported device format; two decoder workers are shared and
retired after 60 seconds idle. Array publication is atomic. Aborted or partly
failed decodes dispose completed textures. Failed scan downloads use the
existing procedural arrays; failed foliage downloads retain a readable
procedural atlas; failed local elevation uses the original terrain. The DEM
worker and its heightfield retire after 60 seconds idle. Region meshes cap the
top surface at 4,096 triangles on desktop and 2,048 on phone; existing skirts
are added afterward. No existing tier-budget threshold was raised.

The elevation crop is approximately 10 m ground sampling in its largest tier,
quantized to 0.1 m. The 1,200-unit feather is in EPSG:3857 map units, about 950
ground metres here. USGS CONUS orthometric heights are blended into the current
world rather than claiming a global vertical-datum conversion.

**Known companion cost:** `CITY_HORIZON` already exceeds the provisional High
2.2 M submitted-triangle ceiling in the close Manhattan pose. That behavior is
recorded in [FLY_BUILDING_REALISM.md](FLY_BUILDING_REALISM.md); the combined
enabled feature set must not be presented as budget-certified. Phone-policy captures stay
much lighter. These new flags do not raise city density or that ceiling.

## Provenance and rebuilding

All new source assets are listed in `lib/fly/assets.js`, the in-game credits
and [CREDITS.md](CREDITS.md). Full source URLs, authors, checksums, selected tree
node, bake dimensions and output hashes are recorded in the three public
manifests. Poly Haven content is [CC0](https://polyhaven.com/license).
Elevation comes from the [USGS 3DEP service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer).
The bundled Basis transcoder includes Apache-2.0 and Three.js license notices.
Existing imagery, map-data and flight-feed attribution remains in force.

The committed outputs work without authoring tools. To rebuild, install the
free Khronos KTX-Software `toktx` CLI, then run:

```powershell
node scripts/build-premium-materials.mjs --toktx=C:/path/to/toktx.exe
node scripts/build-forest-atlas.mjs --toktx=C:/path/to/toktx.exe
node scripts/build-showcase-elevation.mjs
```

The tree bake also uses installed Chrome. Original source files and bake
scratch live in ignored `.graphics-review/premium-earth/`, not `public/`.
Material/tree rebuilds use recorded source hashes. Preserve the cached USGS
TIFF for identical elevation input; a clean download can change with upstream
data. `--refresh` explicitly requests a new crop. Review and update hashes
when intentionally changing source content.

## Verification and acceptance

Automated gates include source integrity and attribution, gameplay, world,
shader checks, the targeted Premium Earth suite, existing graphics-unit and
surface tests, and a production webpack build. Test-only updates isolate an
older storage-fallback test from a previously cached GPU classification and
allow explicit worker feature fields in an older message-shape assertion.
No acceptance threshold was loosened.

Evidence lives under `.graphics-review/premium-earth/`:

- `baseline*`: shipping comparison captures.
- `final-desktop`, `final-phone`: first complete asset pass; real Chrome on
  RTX 5080, with phone policy/viewport emulation explicitly labeled.
- `asset-failure`: both showcases still settle with all new asset downloads
  blocked; original DEM and procedural textures remain, zero runtime errors.
- `fix-desktop`, `fix-phone`: independent-review corrections for cliff trees
  and granite normals/detail, matching viewport and camera evidence.
- `soak/soak.json`: production moving route, free governor, real clock, region
  boundary crossing and return visits. Its measured outcome is recorded below.

The screenshot harness pins time, weather, traffic and governor for visual
comparisons; those captures are not frame-rate evidence. The endurance harness
uses scripted headings/altitude with real motion, and does not replace the
existing flight-operations tests. A blank or incomplete report is not a pass.

**Hardware evidence remains incomplete:** physical
iPhone/Safari, sustained thermal behavior, cold/warm loading, noon/golden/night,
banking and full turns, runway/contact behavior and region-edge travel still
need the full owner run list. The owner authorized enabling the six defaults
on 2026-11-01; automated local 5080 execution and desktop phone emulation do
not substitute for those unmeasured results.

### Final local results

- Production webpack build: passed on the final renderer source.
- Source/gameplay/world/shader groups: 34/34 scripts passed.
- Premium Earth: 10/10 targeted groups, including adjacent-tile normals,
  refined terrain support, checksums and abort/partial-decode disposal.
- Actual KTX2 payloads: 12/12 decoder cases across ASTC, BC7, ETC2 and RGBA.
  These exercise decoding, not native Safari GPU upload.
- Stylized Earth: 22/22; Cinema Overhaul: 16/16; graphics-unit suite: passed.
- Targeted ESLint: five existing `react-hooks/immutability` diagnostics in
  `SatVegLayer.jsx`; linting HEAD and the changed file through the same config
  produced byte-identical diagnostic arrays. No new diagnostics in the changed
  and newly added source files. Evidence: `lint-comparison.json`.
- Fresh independent visual review: all three material findings scored resolved
  after two correction batches. Final granite evidence is in
  `granite-finish-phone` and `granite-finish-desktop`; other views retain the
  batch-one evidence in `fix-phone` / `fix-desktop`.
  Review-time disposition was **ship for the scored fixes in the disabled
  preview**, after endurance completed; not whole-surface or performance
  certification. The later owner instruction enabled the features.
- Documentation review: incumbent system preserved; no material contract or
  provenance inconsistency found in the sampled evidence.
- Endurance: the first route was invalidated because a fixed 2,100 m altitude
  entered mountain terrain. Its incomplete evidence is preserved in
  `soak-invalid-route`. The corrected 15-minute route uses 4,000 m Yosemite
  legs and checks recorded clearance. This
  instrument correction changes no application code or acceptance limit.

**Corrected endurance completed:** 15 minutes on the final production build,
1440 × 900, installed Chrome / RTX 5080 D3D11, real clock and free governor.
All seven structural checks passed: no runtime errors, unchanged source, both
regions visited, regional DEM and material assets observed, valid clearance,
and no stuck final loading. Minimum settled clearance was 852.7 m. The DEM
worker retired its 4,861,952-byte field on the Manhattan return and loaded it
again for Yosemite; atlas references stabilized at five (including prewarm).

Informational headless-host frame intervals over 133,343 steady samples:
p95 **6.8 ms**, p99 **11.9 ms**, one interval over 100 ms. Transition samples:
p95 **12.1 ms**, p99 **23.7 ms**, thirteen intervals over 100 ms. Missed-vblank
share was not captured; these are not physical-device certification numbers.

**Resource budget is not certified.** Aggregate p95 draws were **346 ≤ 375**,
but p95 submitted triangles were **3,147,471 > 2,200,000**. The Manhattan-noon
leg separately reached p95 **462 draws**, and the night-return leg p95
**3,582,427 triangles**. The enabled combined city therefore has an open High
budget gate, consistent with the earlier city-horizon record; do not infer
that every excess has been attributed by a matched A/B. The limits are
unchanged. Full per-leg assessment is in `soak/assessment.json`, reproducible
with `node scripts/analyze-premium-soak.mjs`.

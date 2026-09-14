# Ground imagery options

Research and public-service probes: September 11, 2026. No provider migration,
account registration, purchase, or browser/GPU test was performed. Prices are
published USD rates, not a quote for this game's complete usage or license.

## What the current imagery actually provides

`lib/fly/tile-sources.js` selects Esri World Imagery photographs and a separate
Esri Terrain3D LERC elevation surface. Buildings and vegetation are independent
actors. High-tier imagery currently caps at zoom 18; the DEM has a separate cap.
`lib/fly/raster-cache.js` adds persistent browser caching. A provider change must
review that cache behavior against the replacement's terms.

The raw [Powell zoom-18 JPEG](.graphics-review/ground-daylight/powell-esri-z18.jpg)
shows a hard foliage/color boundary and baked tree shadows before game rendering.
These are source-image limitations. Different capture seasons are a plausible
explanation for the boundary; the single-point metadata below does not establish
the acquisition dates on both sides.

### Official metadata at 40.1990, -83.0811

A read-only [Esri point query](https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/0/query?f=pjson&geometry=-83.0811%2C40.1990&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false)
returned one feature, object `1039954`. Metadata layers 8, 9, and 10 independently
returned the same feature. Esri documents this service as the source for imagery
date, resolution, and provenance [metadata](https://support.esri.com/en-us/knowledge-base/how-to-view-the-world-imagery-basemap-metadata-in-arcgi-000018129).

| Field | Returned value |
| --- | --- |
| Source / name | City of Dublin, Ohio / `Dublin2025` |
| Description | `2025 Orthophoto Imagery` |
| Source date | `SRC_DATE: 20250309` — March 9, 2025 |
| Source resolution | `SRC_RES: 0.0762` m — 7.62 cm |
| Source accuracy | `SRC_ACC: 0.27` m — distinct from resolution |
| Map levels | `MinMapLevel: 12`, `MaxMapLevel: 21` |
| Block / release | `Dublin-OH-USA-7-CMP-20250609` / `Raster Basemaps 2026.R07` |

Thus, a blanket claim that the source at this point is low resolution is
unsupported. Metadata describes the source footprint; it does not prove the
sharpness of every rendered pixel or the age of an existing browser-cached tile.

At this point the 2025 source is reported as **7.62 cm**, while a zoom-18 tile's
nominal ground sampling is **45.6 cm/pixel**. Zoom 18 is a ceiling, not a promise
that every visible tile reaches it: the archived Powell 1,378 ft capture records
`camTileZ: 16`, and the 300 ft capture records `camTileZ: 18`. See the
[capture index](GROUND_NIGHT_CAPTURES.md). Actual residency must accompany any
provider comparison.

Exactly one tile per higher zoom was requested at the point, without retaining
downloads, at **2026-09-11 20:49:35 UTC**:

| Zoom | Official tile | Response | Body bytes | Nominal ground sample spacing |
| --- | --- | --- | ---: | ---: |
| 18 | Current application cap | Existing reference JPEG | Not re-requested | 45.612 cm/pixel |
| 19 | [198105/141148](https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/19/198105/141148) | HTTP 200, JPEG, 256×256 | 17,692 | 22.806 cm/pixel |
| 20 | [396211/282296](https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/20/396211/282296) | HTTP 200, JPEG, 256×256 | 21,219 | 11.403 cm/pixel |
| 21 | [792422/564593](https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/21/792422/564593) | HTTP 200, JPEG, 256×256 | 15,898 | 5.701 cm/pixel |

Spacing is calculated as `2π × 6378137 × cos(40.199°) / (256 × 2^zoom)`.
It is the nominal ground sample footprint, **not observed image sharpness or
MTF**. Zoom 21 samples more finely than the reported source resolution; availability
does not prove new independent detail. Raising the global cap is not recommended
without measuring refinement, residency, and mobile cost.

## Provider paths

The alternate-provider descriptions below are documentary research. No Powell
imagery from Wayback, Mapbox, MapTiler, or Google 3D was downloaded or visually
compared in this investigation. Only the existing Esri source received the
read-only metadata and individual-tile probes recorded above.

| Path | Geometry and Powell coverage | Integration |
| --- | --- | --- |
| Esri World Imagery Wayback | 2D historical mosaics; compare older captures at the exact point | Small source/metadata/cache-key change; existing terrain and actors remain |
| Mapbox Satellite | 2D global mosaic with regional high-resolution North American aerial coverage; exact Powell date/resolution unverified | XYZ adapter, access token, attribution, cache policy; keep existing DEM |
| MapTiler Satellite | 2D aerial coverage across all US states; exact Powell capture unverified | Existing vendored MapTiler source adapter helps; API key, attribution, zoom/cache validation |
| Google Photorealistic 3D Tiles, direct or Cesium ion | Actual textured 3D meshes; US availability does not establish detailed Powell coverage | Substantial streaming/LOD, coordinate conversion, world-bend, collision, duplicate-actor and mobile-budget work |

**Esri Wayback:** A different capture can change foliage, color balance, and seams
without changing providers. Avoid a new dependency on World Imagery Clarity:
Esri schedules retirement for March 2028 and recommends Wayback. The existing
keyless URL is not proof of game redistribution or persistent-cache rights;
chosen-archive production entitlement and pricing remain unverified.
[Retirement notice](https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps),
[Wayback](https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/imagery/create-more-with-world-imagery-wayback).

**Mapbox:** The satellite dataset includes regional 30–60 cm imagery and selected
finer coverage; neither is a guaranteed improvement over Powell's reported
7.62 cm Esri source. Its Raster Tiles API supports third-party XYZ renderers.
Published pricing: 750,000 requests/month free, then $0.25/1,000 in the first paid
band. Respect attribution and cache headers; default device TTL is 12 hours.
Persistent/offline storage and game distribution must match the applicable
product agreement, rather than treating tile access as an asset-export license.
[Dataset](https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/),
[API and caching](https://docs.mapbox.com/api/maps/raster-tiles/),
[Pricing](https://www.mapbox.com/pricing),
[Terms](https://www.mapbox.com/legal/product-terms).

**MapTiler:** Its announced US update contains 2021–2023 aerial imagery at 15–60 cm.
Flex is $30/month including 500,000 API requests, then $0.15/1,000; this custom
Three.js integration is request-billed. Free use is for testing/personal/
noncommercial purposes. Temporary personal-device caching is permitted; proxies,
bulk downloads, and external exports need additional permission. Separately
licensed downloadable imagery offers a self-hosting path. Confirm the actual
game and export use, not just the subscription price.
[US imagery](https://www.maptiler.com/news/2025/02/new-aerial-imagery-for-all-50-states-of-america/),
[Pricing](https://www.maptiler.com/cloud/pricing/),
[Terms](https://www.maptiler.com/terms/cloud/),
[Self-hosting](https://www.maptiler.com/server/self-host-satellite-maps/).

**Google/Cesium:** Google supports custom 3D Tiles renderers, including a possible
[Three.js/R3F integration](https://github.com/NASA-AMMOS/3DTilesRendererJS).
Direct access requires billing and an API key: 1,000 root requests/month free,
then $6/1,000 in the first paid band; a root session permits renderer requests
for up to three hours. Cesium ion is an alternative delivery/billing route,
not different Google imagery: commercial individual plans start at $149/month
with 5,000 Google root requests. Google attribution and restrictions on caching,
extraction, offline use, and derived content still apply. Collision and photo/export
features need explicit terms review. Captured textures do not supply a clean,
fully relightable material system for our night lighting.
[3D overview](https://developers.google.com/maps/documentation/tile/3d-tiles-overview),
[Billing](https://developers.google.com/maps/documentation/tile/usage-and-billing),
[Prices](https://developers.google.com/maps/billing-and-pricing/pricing),
[Policies](https://developers.google.com/maps/documentation/tile/policies),
[Cesium plans](https://cesium.com/platform/cesium-ion/pricing/).

## Rendering first, then a controlled comparison

The parallel source audit confirmed a separate renderer defect:
`Effects.jsx`'s display-space reordering omitted `immersive-clouds` from
`PRE_CURVE`, moving linear cloud radiance composition after ACES tone mapping.
That issue belongs to the renderer regardless of imagery provider. The audit
also identified an active near-ground aerial-perspective veil; its contribution
is measurable, but it is not a ruling that the veil alone caused the screenshot.
Renderer corrections are implemented and recorded in
[GROUND_NIGHT_MOBILE.md](GROUND_NIGHT_MOBILE.md). This provider investigation
makes no alternate-provider pixel or performance claim.

1. Correct and validate the renderer using the existing Esri source. Keep the
   raw JPEG comparison so baked seams/shadows are not blamed on shaders.
2. Compare Wayback/Mapbox/MapTiler at the same Powell pose, viewport, requested
   zoom, actual tile residency, and rendering settings. Test an isolated Esri
   higher-zoom option too. Record source dates, seasonal appearance, transfer
   volume, texture allocations, and mobile frame pacing. Resolution alone is
   not a quality verdict.
3. Prototype Google 3D in an isolated viewer after obtaining the required key
   and confirming intended-use terms. Verify Powell coverage, ground-level
   reconstruction artifacts, day/night suitability, streaming and memory before
   considering a migration. No full Cesium engine replacement is presumed.

# Recognizable Earth, stronger stylization

September 28, 2026. The user rejected the earlier cinematic pass because the
world still looked the same, and clarified the direction: “we should still know
where we are but just have it stylized more.”

This local revision addresses world surfaces and their lighting. It leaves the
aircraft and cloud rendering unchanged. Geographic elevation, coastlines,
roads, settlement footprints and landmarks retain their existing locations.

## World changes

- Natural ground uses distinct grass, forest, field, rock, sand and snow
  pigments. Low-frequency satellite color still guides local variation, while
  authored materials replace more of its baked shadows and fine photographic
  noise. The full treatment reaches 12 km and fades through 65 km, instead of
  the earlier painted layer disappearing at 2.8 km.
- Woods use a deeper green palette; fields and minerals keep local variation.
  Grass and scrub use dry pigments where the broad imagery lacks green chroma.
  Adjacent natural classes blend their pigments continuously instead of fading
  through dark photographic outlines. Existing road, building and water
  exclusions remain in the classification atlas.
  Classification masks and exclusions remain authoritative. Water, roads,
  developed ground and unknown land are not repainted as vegetation.
- Surface light has warmer sunlit faces and cooler open-sky bounce. Moonlit
  terrain receives a directional visibility floor, and distant ground separates
  into blue layers. These changes affect world materials, not a screen filter.
  Terrain light reads the decoded DEM normals; the existing Standard-material
  normal is intentionally flat in the terrain pipeline and cannot supply this
  directional contrast when photographic shadows are removed.
- Buildings have more distinct roof/facade pigments and stronger existing
  window emission at night. No new fictional buildings or lights are placed.
- Water has deeper color, a clearer reflected sky, and a restrained coastal
  color transition along existing shore geometry. Forest crowns receive a
  coordinated color treatment.

The changes use existing meshes, textures and render passes. There are added
fragment calculations and one biased imagery lookup; their GPU cost is not yet
certified on physical phones or by a new 4K soak. No performance bounds changed.
This is a material and lighting revision, not a replacement of every scenery
model or the terrain elevation source.

## Comparison and validation

`scripts/review-world-art.cjs` captures the new treatment against the shipped
world in one session. The camera and player are held at the same pose; solar
elevation must actually reach the requested day/night state before capture.
The aircraft, cloud volume and HUD are hidden in both arms. Actual imagery and
geographic data remain live. Traffic continues moving, so its sky marks are
not evidence of this change.

The review switch `__flyWorldArtOverride=0` works only on the existing
`?graphicsReview=1` development-review path. Normal Satellite / Enhanced uses
the treatment. Classic and Neon exclude it through the shared frame uniform.

Local evidence lives under `.graphics-review/world-art/` and is ignored by Git.
Earlier `valley` captures had an invalid night baseline and incomplete aircraft
hiding; they are superseded. The `*-stylized`, `*-final-world` and
`canyon-material-blend` iterations exposed overly green arid cover and dark
photographic seams at natural-class boundaries. They are rejected art iterations.
`canyon-continuous` fixed the boundary seams but exposed the flattened lighting.
Use `valley-dem-light` and `canyon-dem-light` for the latest terrain, and
`city-final` for the building/water revision (captured before the final natural
terrain changes).

Production build passed. The world shader/solar tests passed 3/3, cinematic
policy 9/9, painterly regression 18/18, and import integrity 4/4. Targeted lint
of the modified material modules and new verification scripts passed. Browser
reports separately record terrain readiness, matched poses, true solar states,
and shader/page errors; `REVIEW_REQUIRED` deliberately leaves artistic quality
to visual review and is not a performance certificate.

The final alpine and canyon runs both have settled terrain, matched camera and
quality, confirmed solar states, and zero page/shader errors. Their eight PNGs
are embedded unmodified in the standalone `world-review.html` comparison in
the current task's visualization directory. Inspection confirmed stronger
natural-material separation and a readable night landscape. Land-cover shapes
and the underlying terrain/scenery resolution remain visible limitations; this
does not establish parity with the reference image's finished artwork.

Tested build: `3GBQJrIcl5qrUCV5JkHVa`; graphics source SHA-256:
`0be03e88dc0bcf136f66b11160de39c607f89a083b3f31c1ea2a392f4fa04fd4`.

The live local preview uses `.next-world-dem-light` on port 3068.
This correction is prepared for `main` under the user's existing push request.

```powershell
$env:FLY_BUILD_DIR = '.next-world-dem-light'
npm run build -- --webpack
node node_modules/next/dist/bin/next start --port 3068
node scripts/verify-world-art.mjs
node scripts/review-world-art.cjs --site=valley --url=http://localhost:3068 --output=.graphics-review/world-art/valley-dem-light
node scripts/review-world-art.cjs --site=canyon --url=http://localhost:3068 --output=.graphics-review/world-art/canyon-dem-light
```

Skyloom aircraft realism review

Run: node scripts/review-aircraft-realism.cjs
Open: http://127.0.0.1:3166/?aircraft=f35&view=rear

The left view loads the unchanged original GLBs (v1, Vector v2). The right
loads the refined GLBs (v3, Vector v4). Original assets remain available so
the comparison is reproducible. Both use the same renderer, lighting, camera
pose, physical dimensions and exposure. Drag either view to orbit both;
Overview, Rear, Profile, Plan and Front select matched views. The detail
button switches both aircraft to their mobile versions. No network assets.

Scope: all 13 selectable player aircraft, both desktop and mobile variants.
Live ADS-B traffic and landmark models are outside this aircraft-hangar pass.

F-35A: nozzle exit radius .79 -> .62 m; outer shroud .94 -> .725 m.
External metal begins at z=7.08 instead of z=6.10; the aft fuselage now
encloses the engine until the short convergent petal section. Nozzle ends
at the original z=7.85, preserving 15.7 m length and 10.7 m span. The flame
radius is .59 m, inside the .603 m interior opening. Smaller canopy profile.

Umbra: original centre-body thickness, cockpit rise and engine fairings
restored after owner feedback. Satin reflections and glossy glazing retain
the depth of the original. Finer joints and baked contact shadows remain.

Second pass after owner rejected the subtle first pass:
- Skylark: enclosed utility cabin, separate windshield/side glazing, vents.
- Mustang: fuller cowling, relocated cockpit, curved wings, anti-glare paint.
- Talon/Dart: distinct intake geometry and blended body fairings.
- Transports/glider: winglets, revised fuselage sections and flap fairings.
- Eight shared aircraft: airfoil controls fit real cutouts in the fixed wing.
- All thirteen: ray-baked ambient occlusion, differentiated paint/glass/metal,
  surface-fitted panel coatings, readable wing joints and maintenance detail.
- Windows and panel coatings are clipped to the actual surface triangles.
  The bake uses three-mesh-bvh offline; no new runtime dependency is imported.
- Patterned liveries retain baked occlusion rather than overwriting it.

All 26 assets: distinct paint/glass/metal response, subtle baked surface
variation, degenerate-face cleanup and vertex welding. Runtime and livery
paths retain authored finishes; old models keep their previous rendering.
Flight physics, collision dimensions, saves and all 39 livery choices remain.
New asset URLs avoid stale immutable browser/CDN caches.

Rebuild in this order:
  node scripts/build-vector-aircraft.mjs
  node scripts/build-adventure-fleet.mjs
  node scripts/build-flying-wing.mjs
  node scripts/build-player-expansion.mjs

Validation:
  node scripts/verify-aircraft-realism.mjs  (28 checks)
  node scripts/verify-player-expansion.mjs  (23 checks)
  node scripts/verify-liveries.mjs          (29 checks)
  next build --webpack

The tests read the actual shipped GLBs, including both LODs, finite unit
normals, non-collapsed triangles, dimensions, named controls, triangle/draw
budgets, material persistence, F-35 nozzle shape and flame fit, flight
envelopes and liveries. These are functional and geometry checks; they are
not an FPS benchmark or a physical-phone certification.

Reference proportions:
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/478441/f-35a-lightning-ii/
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104482/b-2-spirit/
The Umbra remains an original aircraft, not a dimension-exact B-2 replica.

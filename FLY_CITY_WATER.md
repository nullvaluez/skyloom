# Cities, coastal water and readable nights — 2026-09-28

The coastal and Tokyo screenshots exposed three gaps in the previous world pass: water was still a smooth blue field, buildings repeated the same gray/window treatment, and nighttime roofs and developed ground retained their daytime brightness. The requested direction is cinematic and readable, with recognizable real geography.

## Runtime changes

- The active water lives in `earth-surface-material.js`. `satellite-water.js` is disabled by the existing stylized-earth path; modifying that inactive material cannot change this scene.
- The active surface combines independently advected gradient fields at four scales, view-dependent sky color, sun/moon highlights, and distorted coastal architecture reflections. A broad field modulates local roughness. Periodic gradient cells and integer coordinate bases preserve the 4096 m transported material frame without introducing coherent wave fronts. The animation does not inherit the old ten-minute time wrap.
- A sea-level reflection camera draws the existing near and distant city meshes, including their actual window emission. It excludes terrain, water, aircraft, and a second shadow render. The main renderer state and object layer masks are restored in `finally`.
- High uses a 768×512 half-float target; Medium uses 384×256. Color/depth storage is approximately 4.5/1.125 MiB. Low, Classic, high-altitude, no-nearby-water, empty-geometry, and unmount paths release the target. The active water classification gates coastal allocation; historical water-cell counts do not. Empty geometry is checked before allocation, avoiding repeated target creation while the city loads.
- Facades distinguish apartment decks, masonry bays, industrial openings and glass curtain walls. Stable building seeds choose coordinated ivory, stone, brick, slate and glazing treatments. Roofs use restrained per-building mineral, bitumen and metal colors; the existing worker-built rooftop geometry supplies mechanical details. Repeating roof-panel stamps and surface seam grids were removed after the user's follow-up screenshot.
- Selected apartment/glass buildings gain bounded upper-floor setbacks alongside existing masonry/concrete setbacks. Convex unperforated footprints only; source footprint and height remain authoritative. This worker geometry is shared across satellite profiles. The new shader treatment and reflection target are Enhanced-only.
- Night dims structural roof/wall and developed-ground albedo independently of the windows and existing street-light receivers. Occupancy varies coherently by building, groups of floors, and rooms. Warm interiors, selected cool offices and storefront emission replace the same evenly dotted treatment. Stronger distance haze separates city layers.

## Initial verification (70abf98)

- Production webpack build succeeds.
- Focused ESLint and import integrity pass.
- Node checks: city/water 6, world art 3, Living Earth 19, cinematic Earth 9, painterly flight 18, import integrity 4; 59 passing checks across these suites.
- New checks exercise rolled/reverse-Z reflection projection, renderer state restoration on a thrown render, buffer disposal on quality/style/location changes, spatial phase wrap, and the source envelope of new setback families.
- Real Chrome/ANGLE on this machine's RTX 5080, using live terrain and city providers. Fragment sampler limit reports 16. No shader or page errors in the coast, harbor, and Tokyo captures; matched poses, quality and actual day/night solar states were checked.
- Review script: `scripts/review-world-art.cjs --urban=1`. `--lifecycle=1` additionally checks Medium → Low → High → Classic → Enhanced resource transitions at a coastal site.
- Harbor browser lifecycle passes all five states: Medium 384×256 active; Low zero bytes; High 768×512 active; Classic zero bytes; Enhanced restored. Actual scene reflection submissions were 15 draws on High and 17 on Medium for this settled harbor view, not a universal draw ceiling.
- Local evidence: `.graphics-review/city-water/`. The coast-final capture and harbor-final iteration used build `BkXOvboq8-T6Hzy0RzlbP`, source hash `f8f3a624b8e900d0dd27e754e333ba0f3fdf2f0feb9158524883e1d5295ff56d`. Final release `6k1cLCpU4afUtcAvdBgRu`, source hash `f93c62084c2cc3343e2816044898e9ecb8f3575d7a56443f2be6d8920d3fd5c8`, adds empty-geometry cleanup and correct per-capture draw accounting; rendered material values are identical. Tokyo and the harbor lifecycle capture use that release.
- Publish build `0OgW2QS1g5jUQKBjcJSlD`, source hash `7c91c29171eb1b579ff617ca4ecc1a94af24922dad819d06e2a356df784343d7`, moves the empty-geometry check ahead of allocation and enables temporary layer masks inside the protected render block. The added empty-city test and exception-state test pass; material/shader values are unchanged from the compared renders.
- The local interactive comparison loads all six location/time pairs and its before/after controls pass a browser check. Local preview runs at `http://localhost:3071`.

## Follow-up: stamped roofs and uniform ripples

The user rejected the initial roof/water patterning in a Medium-quality shot at 40.7210 N, 73.9988 W, 1,404 ft. Its 7×11 m roof rectangles were an inappropriate substitute for equipment geometry. Four sinusoidal wave families still made a visible woven pattern even with phase modulation. Passing compilation and stationary captures had not established acceptable art quality.

The roof shader now removes those rectangles and repeated roof seams. It also stops applying facade-based minification to roof texture detail: neutral roof UVs falsely kept small repeated texture details fully resolved at flight altitude. Existing 3D rooftop features remain. Roof pigment selection is more restrained, with terracotta primarily on house/attached families and lighter industrial/terminal membranes.

Water now evaluates periodic gradient noise with exact analytic derivatives, using independently advected, rotated scales. A larger field creates local calmer/rougher areas. The pixel footprint retires unresolved scales. This replaces the sine fronts and the synthetic sine cloud pattern without adding a sampler, texture allocation or draw. Actual coastal reflections remain; their distortion is less exaggerated.

Follow-up evidence:

- Build `JvKZlMIk1h-GlLSxdZip9`; application source SHA-256 `4a6e2ed5126539029f53f802304ed180e83234c33daee5c27f8f241843ffe326`. Production webpack and focused ESLint pass.
- `verify-city-water.mjs`: 5 checks; `verify-world-art.mjs`: 3; `verify-painterly-flight.mjs`: 18; import integrity: 4. The old test that parsed sine frequencies was replaced with execution of the real surface GLSL in `verify-water-field.mjs`.
- GPU field checks on the RTX 5080: zero pixel difference after either 4096 m rebase shift, at most one 8-bit step crossing the wrap, evolving finite normals, and unresolved detail reducing to a flat normal. These are shader correctness checks, not an aesthetic score.
- Medium-quality day/night captures at the reported coordinates compare separate old/new production builds. The harness now reseats and pauses in one JS task after boot so separate builds can share the exact camera. It records the build ID from the loaded Next document.
- `review-surface-flight.cjs`: 27.87 simulated seconds, about 4.54 km, 1,826 observed frames, banked turns, no shader/page errors, Medium throughout. Frame intervals during video recording were p50 12.6 ms / p95 20.9 ms, including recording overhead; they are not a comparative gameplay benchmark. Terrain sharpness was false in four of six moving samples, so this does not certify streaming stability. Timed frames were inspected and the raw canvas recording is retained.
- Evidence is under `.graphics-review/surface-correction/`, including the unedited WebM flight, stills, GPU field report and source receipt.

## Limits

The real reflection is a nearby sea-level architectural capture, not a general reflection of all terrain, aircraft or inland lake shores. Its sky response is an analytic horizon/zenith gradient, not a capture of the volumetric cloud pass. Geography still depends on the provider's actual footprints and height coverage; this is not a replacement library of authored landmarks. The original paired review holds new setback geometry constant and toggles materials/light/water only; the follow-up compares the actual old/new builds. Stills hide the player, cloud volume and HUD in both arms; the flight clip retains aircraft and clouds. Sustained gameplay performance and lower-powered hardware remain unverified.

# Fly Mode — "Toy World" Rework (Implementation Doc)

> **⚠️ SUPERSEDED (2026-07-16 EOD):** the art direction moved on — read
> **[FLY_GLOBE_REWORK.md](FLY_GLOBE_REWORK.md)** (airloom-style globe
> across all styles, dark-neon toy reskin). This doc remains the record
> of the vector pipeline + the §6.5 progress log/gotchas, which all
> still apply.

> **Audience:** a fresh Claude (Fable 5) session with no prior context,
> executing a large visual/architectural rework. Read this top to bottom,
> then read **FLY_MODE_HANDOFF.md** §3 (hard constraints) and §8 (what is
> already built and verified) before writing code. This doc supersedes the
> map-style experiments of 2026-07-16 (satellite grade / CARTO "Toy World"
> raster / "Night Ops") — those shipped, but the user's verdict is clear:
> **a recolored map texture will never feel like a game world.**
>
> **User's goal, verbatim intent:** "we are in a video game, in the real
> world" — bruno-simon.com energy over live ADS-B traffic on real geography.
> The map raster "just isn't cutting it"; nameplates and overall feel should
> match Bruno's. Before coding, VISIT https://bruno-simon.com and drive
> around for a few minutes (Playwright works headless: click to start,
> arrow keys to drive, screenshot as you go). Do not skip this — the whole
> rework is aimed at that reference.

---

## 1. The aesthetic, decomposed (from playing bruno-simon.com)

Observed ingredients, in priority order. These are the acceptance criteria
for "does it feel right":

1. **The world is GEOMETRY, not imagery.** Ground is flat-shaded warm tan;
   grass is clumps of spiky cones (olive/yellow-green); trees are chunky
   particle-cloud blobs (pink/magenta/orange); water is flat teal with
   hand-drawn white foam edge lines. Nothing photographic anywhere.
2. **One strict palette** (orange/tan ground · olive grass · pink foliage ·
   teal water · violet/blue shadows · white-lavender props · neon
   pink/yellow accents). Complementary teal–orange core, purple shadow
   tint. Everything samples from ONE palette module.
3. **Baked-looking gradient lighting** — soft warm-to-cool gradients across
   surfaces (toon/ramp shading), purple-tinted shadow areas, no PBR
   realism, no harsh speculars.
4. **3D extruded text lives IN the world** — chunky rounded white letters
   standing on the ground with sparkles around them ("BRUNOS" sign) and
   small plaque signs ("GREAT SITE"). Labels are objects, not overlays.
5. **Confined world**: the playable island floats in a dark violet void
   with a faint grid — edges are a feature, not a failure. (Our analog:
   a dense warm fog bubble + stylized "beyond the edge" treatment.)
6. **Juice everywhere**: neon-glow lanterns, sparkle flames, glowing
   vehicle lights, physics-y props, confetti bits scattered on the ground.
7. **Tilt-shift/DOF + vignette + grain** — the diorama camera look.
8. **Hand-drawn UI**: handwritten-style font on dark chips, doodle arrows.

## 2. What exists and MUST be kept (do not rebuild)

All of this is implemented and browser-verified (see FLY_MODE_HANDOFF §8,
§8.5.1). The rework replaces the terrain's LOOK and the label PRESENTATION
— not the simulation:

- Coordinate model (Web-Mercator world, true-meter speeds, floating origin
  rebasing) — `lib/fly/coords.js`, worldRoot pattern in `FlyScene.jsx`.
- `TerrainEngine` (three-tile) — KEEP for now as the DEM/elevation oracle
  (`getElevationAt`, `geoToWorld`/`worldToGeo`) and as the fallback
  renderer for the 'satellite'/'night' styles, which remain user-selectable.
- Live traffic: worker projection → `TrafficEngine` dead reckoning →
  instanced `TrafficLayer` + GLB fleet (poly.pizza CC-BY, manifest in
  `lib/fly/assets.js` — orientation is pinned per-model via `yawFixRad`,
  ground truth from `scripts/inspect-glb.mjs`).
- Targeting / intercept / formation autopilot, warp (`runtime.warpTo`),
  inspect modal (click or T), passport logging.
- POI dataset (`lib/fly/poi-data.js`: all airports + ~80 cities + ~30
  landmarks, offline) and the nearest-POI HUD line.
- Procedural audio (`lib/fly/audio-engine.js`).
- The `runtime` object pattern (NEVER route per-frame data through React
  state/zustand) and every hard constraint in FLY_MODE_HANDOFF §3 — above
  all: **ZERO API keys**.
- Harness discipline: Playwright scripts in `scripts/` (verify-fly*.js,
  soak-fly.js), dev globals `window.__fly` / `window.__flyStats`. ALWAYS
  look at the screenshots; "no page errors" is not a pass.

## 3. PHASE 0 — the heap leak (P0, fix before the rework)

The §8.5.2 soak (scripts/soak-fly.js, results in scripts/soak-results.json)
found a **monotonic JS-heap climb of ~170–200 MB/min** (138MB → 1.48GB in
8 min). It will kill long sessions. Facts established:

- Frame times/draw calls/tris are all healthy and FLAT (p95 4.3ms, ≤226
  draws, ≤472k tris) — this is retention, not slowdown.
- Reproduces IDLE (straight-and-level, no input, no warps): ~200MB/min.
- **Audio is ruled out**: `soak-fly.js 2 --idle --no-audio` (disposes
  FlyAudio; its update() becomes a no-op) shows the same slope
  (133→513MB in 2 min).
- Headless runs at ~240fps (uncapped rAF) — a per-frame retention leaks 4×
  faster than at 60fps; on user hardware expect ~50MB/min. Still fatal.

Suspects, in bisect order (test each by stubbing and re-running
`node scripts/soak-fly.js 2 --idle`):
1. **three-tile tile pipeline** — tiles keep refining/reloading even when
   "stationary" (imagery LRU churn). Check whether evicted tiles release
   ImageBitmaps/geometries JS-side (`map.dispose` exists, but eviction
   path?). Test: after spawn settles, `page.setOfflineMode`-style block of
   tile hosts → does the slope flatten?
2. **React Query fly-traffic cache** — polls every 2s (~0.5MB payloads at
   NYC). gcTime 30s should bound it; verify with the RQ devtools count or
   by `enabled:false` after first poll.
3. **LabelCanvas / WaypointCanvas / Minimap** rAF loops — transient-object
   churn should be collectable; look for accidental retention (arrays
   captured in closures growing, `hits`/`drawn` are reused — verify).
4. **drei Trail (Contrail)** remounts per rebase — meshline
   geometry/material disposal on unmount?
5. Chrome DevTools heap snapshot diff (Playwright:
   `page.evaluate(() => performance.memory)` + CDP `HeapProfiler`) — two
   snapshots 60s apart, sort by retained-size delta. This is the fastest
   definitive route; do it first if comfortable with CDP.

Exit: 10-min idle soak slope < 5MB/min after warm-up; then re-run the full
8-min active soak green.

## 4. The rework: a stylized VECTOR world (real map data → toy geometry)

### 4.1 Data source (keyless — hard constraint)

Use **OpenFreeMap** vector tiles (OpenMapTiles schema, no key, no
registration; self-hostable if it ever dies):
- Tile URL: `https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf` —
  confirm the exact current pattern from https://openfreemap.org docs at
  implementation time (they also publish `styles/liberty` etc.; we only
  want raw tiles).
- Fallback: OSMF's official vector tiles (shortbread schema,
  `vector.openstreetmap.org`) — different layer names, keep the loader
  schema-agnostic enough to swap.
- Attribution: "© OpenStreetMap contributors" (already wired via
  ATTRIBUTIONS_BY_STYLE.toy) + add OpenFreeMap courtesy line.
- New deps (pin exact versions): `@mapbox/vector-tile`, `pbf`, `earcut`.
  All tiny, worker-side only.

Layers we consume (OpenMapTiles schema): `water`, `waterway`, `landcover`
(grass/wood classes), `landuse` (residential/industrial/park),
`building` (+`render_height`), `transportation` (road classes),
`aeroway` (runways/taxiways — toy airports!), `place` (city/town names —
optional extra POIs), `poi` (ignore, too noisy).

### 4.2 Architecture (`lib/fly/toy-world/`)

New module family, mirroring the existing engine boundaries:

- `toy-palette.js` — THE palette (every color in the toy world imports
  from here; user will tune it):
  ground `#e8a35c`-family ramps, grass `#9aa832`, foliage pinks/oranges,
  water `#3aa8a0`, roads `#f2e3c8` (paths) / `#8d7ba8` (highways),
  buildings: 4-color rotation by hash (white-lavender, terracotta, sand,
  sage), props white `#efeaf6` with violet AO, accents neon pink/yellow.
- `vector-tile.worker.js` — fetch pbf → parse → per-layer tessellation
  (earcut for polygons, ribbon-extrude for lines) → ONE transferable
  bundle per tile: interleaved position/normal/color arrays per material
  group (ground/water/park/building/road/runway). All colors baked as
  vertex colors from toy-palette (import shared module). Zero main-thread
  parsing.
- `toy-terrain-engine.js` — same public surface as TerrainEngine
  (`geoToWorld/worldToGeo/getElevationAt/setAnchor/object/dispose`) so
  FlyScene swaps engines by style without touching consumers:
  - Keeps a slim DEM sampler (reuse three-tile's DEM-only TileMap with an
    invisible material, or sample the existing ArcGis LERC tiles directly)
    for elevation queries + draping.
  - Chunk quadtree: z14 tiles within ~6km, z13 to ~15km, z12 beyond, out
    to the fog bubble (~35km). Chunk = one merged BufferGeometry per
    material group (≤ ~8 draw calls per chunk), vertex-colored, one
    shared toon/gradient material each. Pool + dispose on eviction
    (learn from Phase 0's leak findings).
  - Ground: tile-sized plane grid draped on DEM (coarse 16×16), base
    color by landcover/landuse polygon coverage (paint vertex colors by
    point-in-polygon at vertex resolution — cheap and looks hand-painted).
  - Water: polygons at sea/lake level, flat teal + animated foam edge
    (shader: scroll a stripe along the polygon outline; outline vertices
    come free from tessellation).
  - Buildings: extrude footprints to `render_height` (clamp 8–60m,
    exaggerate small ones ×1.5 for chunk), flat tops, vertex-color AO
    (darker at base), palette rotation by feature-id hash. Cap per chunk
    (largest N by area) with a budget (§4.6).
  - Roads: flat ribbons 1–2m above ground, width by class; motorways get
    the light palette line look.
  - Runways (`aeroway`): wide light-grey ribbons + threshold stripes —
    plus the 3D airport-code letters from §4.4.
- `toy-props.js` — instanced set dressing driven by data: grass-cone
  clusters + blob trees scattered inside park/wood polygons (seeded by
  tile id — deterministic), boats on big water, sparkle particles near
  POI letters. All InstancedMesh, budgeted per chunk.
- `ToyWorldLayer.jsx` — mounts the engine object inside worldRoot,
  owns the chunk update loop (priority -48, after flight before traffic).

### 4.3 Light, sky, camera feel

- Materials: MeshToonMaterial with a 3-step gradient map, or a tiny custom
  shader (vertex color × ramp(NdotL) with purple-tinted shadow color —
  closer to Bruno). Shadow: ONE directional shadow map, small radius
  (~600m) following the player, soft; everything else fakes AO in vertex
  color.
- Sky: gradient dome shader (horizon peach `#f7b978` → zenith violet
  `#6b5aa0`), a few drifting toy clouds (existing CloudField retinted from
  palette), optional star sparkles at dusk band. HDRI no longer used in
  toy style (keep for satellite).
- Confined world: fogExp2 in palette peach, density for a ~30–35km bubble
  (also caps chunk loads); OPTIONAL beyond-the-fog "void + grid" floor
  plane bruno-style (violet, faint cross grid, slow parallax) — prototype
  it, it may be the single biggest "confined world" seller.
- Post: keep Bloom/SMAA/Vignette; add **tilt-shift DOF** (postprocessing
  `DepthOfField` with narrow focus band around the player, or a cheap
  two-pass blur masked by screen-Y) + film grain (Noise) at low opacity.
  All quality-tiered like bloom today.

### 4.4 Text as world objects (nameplates)

- Bundle a rounded chunky typeface as typeface.json for TextGeometry
  (candidates, all OFL/CC0 — VERIFY license before bundling: Baloo 2,
  Fredoka, Chango). Also bundle a handwritten OFL font (Patrick Hand /
  Caveat) as woff2 for DOM/canvas UI. Add both to lib/fly/assets.js +
  CREDITS.md via gen-credits.
- Major POIs (cities, airports, landmarks within ~8km): **extruded 3D
  letters standing on the terrain** at the POI location, palette white
  with violet side faces, slight random per-letter yaw jitter (toy feel),
  sparkle particles idling around them, fade/scale-in on approach.
  Instanced letter pool or merged per-POI geometry; budget ~12 active.
- Mid/far POIs: keep the capsule-chip canvas (restyle: handwritten font,
  palette colors, doodle stem).
- Traffic labels: restyle chips with the handwritten font + palette;
  keep the click/T inspect flow untouched.

### 4.5 Traffic & player in the toy style

- Swap traffic/player materials to the toon ramp in toy style (keep
  vertex colors; material switch only — instancing pipeline untouched).
- Player: add glowing engine dot + thin neon speed-lines at boost;
  warp keeps its flash (retint to palette).
- Lock/warp/formation get particle celebrations (small confetti burst) —
  cheap one-shot InstancedMesh animation, palette colors.

### 4.6 Budgets (tune in fly-constants, enforce in dev overlay)

- Draw calls: ≤ 350 total in toy style (chunks ≤8 each, target ~25 chunks
  visible + traffic + props).
- Tris: ≤ 1.2M visible (buildings are the risk: cap ~1200 footprints per
  z14 chunk by area, merge, decimate silhouettes at z12/z13 rings).
- Worker: tile parse+tessellate ≤ 25ms per z14 tile (measure; earcut on
  NYC building tiles is the hot spot — if over, tessellate buildings at
  z13 granularity or cap footprints harder).
- Heap: chunk eviction must return to baseline (Phase 0 tooling re-used).
- 60fps on the user's machine, ≥55 p5 in a 15-min soak (soak-fly.js).

## 5. Phasing (each phase = build → harness-verify → SCREENSHOT review)

Ph 0  Heap leak root-cause + fix (§3). Exit: flat 10-min idle heap.
Ph 1  Vector pipeline MVP behind `mapStyle==='toy'`: worker → chunks with
      water/land/road flat colors on draped ground; satellite DEM oracle
      still doing elevation. Exit: fly NYC→JFK, chunks stream, palette
      ground/water/roads legible, draws in budget, no leak.
Ph 2  Buildings + parks (grass cones/tree blobs instancing) + toon ramp
      lighting + palette shadows. Exit: lower Manhattan reads as a toy
      diorama in screenshots; tris/draws in budget.
Ph 3  Sky dome + fog bubble + void-grid edge + tilt-shift DOF + grain +
      retinted clouds. Exit: side-by-side screenshot vs bruno reference
      passes the squint test (user reviews!).
Ph 4  3D nameplate letters + airport runway letters + handwritten UI font
      restyle of chips/HUD/modal. Exit: JFK approach shows "JFK" standing
      at the field with sparkles; chips restyled.
Ph 5  Juice + perf: particles (lock/warp/confetti), boost speed-lines,
      quality tiers for DOF/props, full 15-min soak, credits/licenses
      complete. Exit: §4.6 budgets green on user hardware.

At every phase end: run the relevant `scripts/verify-*.js`, LOOK at the
screenshots, and pause for the user's art-direction review — this project
iterates on FEEL, expect retunes (the user edits fly-constants themselves;
respect their values).

## 6. Session-learned gotchas that WILL bite this rework

- All of FLY_MODE_HANDOFF §3/§4 still applies (no keys, no r3f-perf,
  StrictMode double-mount idempotency, PowerShell 5.1 quirks, one dev
  server per .next).
- GLB orientation: never trust half-body height heuristics; ground truth
  via `scripts/inspect-glb.mjs` (end-slab profiles) and pin `yawFixRad`
  per model in assets.js. Helicopters invert the "tapered end = nose" rule.
- drei Trail zero-fills its point buffer → rebased (0,0,0) is ground level
  → frame-count warm-up gate after every remount (Contrail.jsx pattern).
- poly.pizza direct GLB downloads: uuid in page HTML →
  `https://static.poly.pizza/<uuid>.glb` (no login; CC-BY → credits).
- Light raster tiles blow out: if any raster style survives, keep total
  light ≈1.0–1.3 and bloom threshold ≥0.8.
- Playwright: key names are `Shift`/`ArrowUp` (case-sensitive); headless
  rAF runs ~240fps — frame-count gates beat wall-clock gates; background
  task cap is 10 min, size soaks accordingly.
- The 2D map (deck.gl/MapLibre) is untouched by all of this — never write
  to its stores from fly code.

## 6.5 PROGRESS LOG — 2026-07-16 session

- **Ph 0 DONE + verified.** Root cause: three-tile calls `console.assert`
  in `Tile._getDistRatio` per tile per frame; Next 16 dev instrumentation
  retains per-call state (~200MB/min idle). Fix: dev-only guard at top of
  `lib/fly/terrain-engine.js` (forwards only FAILING asserts). Proof:
  CDP sampling profiler (`scripts/leak-probe.js`, keep for future leaks) —
  312MB retained → 5.3MB; 8-min idle soak heap 81→82MB. RULE: never put
  console.* on a per-frame path in dev.
- **Ph 1 + most of Ph 2 DONE** (browser-verified, `scripts/verify-toy-world.js`
  + `toy-closeup.js` probes): `lib/fly/toy-world/` (toy-palette, vector-tile
  worker: OpenFreeMap pbf → clip → earcut/ribbons → transferable vertex-color
  buffers; toy-world-engine: 3-ring gap-free quadtree z14/13/12, per-chunk
  draped ground grid + slope normals + 1.7× exaggeration, extruded buildings
  (palette-rotated, violet base AO, mid-ring skyline ≥30m), instanced blob
  trees in parks). Toy imagery = solid palette-tan data-URI tile (no CARTO).
  Deps pinned: @mapbox/vector-tile 3.0.0, pbf 5.1.2, earcut 3.2.3
  (`import { PbfReader } from 'pbf'` — v5 has no default export).
- **Gotchas learned:** (1) MVT exteriors wind CW-in-y-down → earcut output
  faces DOWN in XZ; swap index order. (2) Overlays must drape on the chunk's
  OWN bilinear grid, never trust the three-tile mesh height (z-fight dither).
  (3) `getElevationAt` "answers" from z2 fallback tiles with plateau garbage
  → `TerrainEngine.getGroundAt` returns `{elev, tileZ}`; chunks hold until
  `demZByDetail` quality, then heal via evict+rebuild (the floating-slab bug).
  (4) Merged-block mega-footprints (>60k m²) must not extrude. (5) OpenFreeMap
  tile template is dataset-versioned — resolve from TileJSON at runtime.
- **User art feedback applied:** monochrome orange killed (pale-sand ground,
  near-white sun, sat 0.22→0.06, fog thinned), motorway violet lightened,
  buildings weighted white. Attribution: toy = OSM + OpenFreeMap.
- **Second pass (same day, after user feedback "dull / not a cartoon world"
  + the airloom reference https://objectiveunclear.com/airloom.html):**
  3-step toon ramp (shared DataTexture gradientMap) + violet hemisphere
  shadow fill; cast shadows (player-following ortho sun, buildings/trees
  cast, ground receives, quality-gated); grass cones + shoreline foam
  ribbons (worker); **mini-planet curvature** (`toy-world/world-bend.js` —
  shared vertex-shader patch on toy + tile materials, live uniforms, CPU
  `bendDrop()` for discrete objects; `TerrainEngine.onTileMaterial()` feeds
  it); SkyDome gradient (peach horizon → violet zenith → void below);
  tilt-shift DepthOfField + Noise grain (toy, tier-gated); **neon
  altitude-colored velocity tracers** on all traffic (one additive
  LineSegments — airloom signature); **3D letter POI pegs** (drei/troika
  Text, self-hosted Chango OFL, candy pegs + drei Sparkles, Y-billboard,
  replaces DOM chips in toy style, publishes runtime.nearestPoi);
  InspectModal restyled as isometric game card (framer-motion springs,
  Chango/Patrick Hand, WARP/CHASE buttons). Fonts in assets.js manifest,
  CREDITS.md regenerated.
- **CRITICAL gotcha:** anything that SUSPENDS inside FlyScene (troika font
  load!) must have its OWN <Suspense> — reaching FlyCanvas's boundary
  hides+cleans the committed scene (React runs effect cleanups →
  `engine.dispose()` mid-flight → spawn re-runs on a disposed TileMap =
  plane at null island, no terrain). Diagnosed via scripts/toy-console.js.
- **Perf note:** draws peak ~378 (budget 350) with shadows+pegs+DOF —
  trim in the perf phase (shadow-caster culling, peg count).
- **Remaining:** STOP-POINT vision realignment with the user (bruno-warm
  vs airloom-void balance, satellite-on-dome option, tracer thickness);
  then void-grid edge, water foam animation, LabelCanvas/HUD font restyle,
  lock/warp particles, 15-min soak.

## 7. First moves for the new session

1. Play bruno-simon.com (headless is fine). Screenshot. Internalize §1.
2. Read FLY_MODE_HANDOFF §3 + §8; skim FlyScene/TerrainEngine/TrafficLayer.
3. Phase 0 (leak) — do not build the pretty world on a leaking base.
4. Prototype ONE z14 tile → toy chunk (water+land+roads) offline in a
   scratch scene before wiring the quadtree; screenshot-review the palette
   with the user early. Cheap alignment beats a week of plumbing.

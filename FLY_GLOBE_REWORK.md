# Fly Mode — "Globe" Rework (Handoff for a fresh Fable 5 session)

> **✅ EXECUTED 2026-07-16 — see §6 (progress log) for what shipped, the
> harness evidence, and the short list still open for user review.**

> **Audience:** a fresh Claude (Fable 5) session with no prior context.
> Read this top to bottom, then FLY_MODE_HANDOFF.md §3/§4/§8 (hard
> constraints + what the base sim is) and FLY_TOYWORLD_REWORK.md §6.5
> (progress log + gotchas from the toy-world sessions). This doc
> SUPERSEDES the toy-world rework's art direction; the toy-world
> INFRASTRUCTURE (vector pipeline, curvature, tracers, letters) carries
> forward — only the look changes.
>
> **Status of the codebase you are inheriting (2026-07-16 EOD):** all of
> it browser-verified working. P0 heap leak fixed; vector-tile toy world
> streaming; mini-planet curvature; neon traffic tracers; 3D letter POIs;
> gradient sky dome; toon ramp + cast shadows; tilt-shift DOF; game-styled
> inspect modal. `scripts/verify-toy-world.js` green (draws peak 378 —
> slightly over the 350 budget, trim during this rework).

---

## 1. The decision (user-confirmed 2026-07-16, do not relitigate)

Reference: **https://objectiveunclear.com/airloom.html** — a curved
mini-globe of real terrain floating in darkness, neon altitude-colored
tracers on live traffic, big clean white 3D city names standing on the
ground. The user called it "a PERFECT reference … the 'feel' we are
aiming for with the confined world."

User verdicts on the current build:
- **KEEP / LOVED:** the tracers ("contrails are a nice touch") and the
  curvature ("i like the rounding").
- **TERRIBLE (their word):** the colors (sunset-orange wash) and the POI
  letter pegs as shipped (chunky violet-outlined Chango on candy pegs
  with sparkles).

**The plan, per their explicit answers:**

1. **All three map styles become globes.** One globe system — curvature,
   per-style sky, neon tracers, 3D letters — with three ground skins.
2. **Per-style skies** (NOT one universal void).
3. **POI letters: clean airloom text.** White, bold, clean sans-serif
   standing on the terrain. NO outline, NO candy pegs, NO sparkles,
   restrained size. Quiet and premium.
4. **Toy vector ground goes DARK NEON ARCADE** (TRON-like): dark ground,
   glowing roads/water. No more coral/orange anywhere.

### The style matrix to build

| style (pause menu) | ground | sky | mood |
|---|---|---|---|
| **satellite** | Esri World Imagery (existing engine, unchanged) | keep the blue-sky HDRI day | bright daylight globe — imagery carries all color |
| **night** | CARTO dark_all raster (existing) | near-black navy void | airloom-exact: dark globe in space |
| **toy** | vector chunks (existing pipeline), re-paletted dark neon | dark violet void | TRON arcade: dark ground, glowing roads/water/edges |

All three get: mini-planet curvature (already style-independent), neon
tracers (extend beyond toy — user loves them), clean 3D letters, bloom.

---

## 2. What exists and carries forward (do NOT rebuild)

Everything in FLY_MODE_HANDOFF §8 (sim, traffic, targeting, warp, audio,
GLB fleet) plus, from the toy-world sessions:

- `lib/fly/toy-world/world-bend.js` — curvature vertex patch. Applied to
  toy materials (ToyWorldEngine ctor) + every tile material via
  `TerrainEngine.onTileMaterial(applyBend)` (FlyScene effect). Strength
  is a live uniform set per frame in FlyScene: currently
  `mapStyle === 'toy' ? 1/(2·TOY_WORLD.bendRadiusM) : 0` — **for this
  rework, make it nonzero for ALL styles** (per-style radius constants;
  80km reads clearly, 260km was invisible under fog). `bendDrop(d, k)`
  is the CPU-side drop for discrete objects (letters).
- `components/fly/TrafficTracers.jsx` — ONE additive LineSegments, neon
  altitude bands (green deck / yellow low / orange mid / cyan cruise),
  velocity-stretched. Currently toy-gated in FlyScene — ungate for all
  styles. Consider ribbon quads if 1px lines read too thin (user wants
  them prominent; check on their hardware, headless lines look thinner).
- `components/fly/PoiPegs.jsx` — POI selection (0.5Hz re-sort, slots,
  runtime.nearestPoi for the HUD, CPU bend, Y-billboard) is sound;
  REPLACE its visuals per §1.3 (strip pegs/sparkles/outline; new font).
  WaypointCanvas DOM chips are gated off in toy — decide per style
  (probably gone everywhere once letters are clean; chips still render
  in satellite/night today).
- `components/fly/SkyDome.jsx` — gradient dome w/ void-below-horizon,
  camera-following, fog-immune. Parameterize colors per style instead of
  the hardcoded toy palette.
- `lib/fly/toy-world/` vector pipeline (worker fetch/clip/earcut/ribbon,
  3-ring gap-free quadtree, DEM-quality drape gate + healing, buildings,
  tree/grass instancing, foam ribbons) — solid. The dark-neon reskin is
  ~90% `toy-palette.js` (THE palette module — every color imports from
  it) + material/emissive/bloom tuning, not new geometry.
- Toon ramp + violet shadow fill + player-following shadow sun
  (FlyScene `sunRef`/`sunTarget`, quality-gated), tilt-shift DOF + grain
  (Effects.jsx, toy-gated — decide per style), game-styled InspectModal
  (framer-motion; user has NOT reviewed it yet — get a verdict early).
- Fonts self-hosted in `public/fonts/` (Chango, Patrick Hand — OFL, in
  `lib/fly/assets.js` manifest → CREDITS.md via `gen-credits.mjs`).
  For the clean airloom letters, bundle a neutral bold sans (suggest
  **Archivo Black**, OFL, static TTF at
  `https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/archivoblack/ArchivoBlack-Regular.ttf`
  — google/fonts raw.githubusercontent 404s; jsDelivr works). Add to the
  manifest + regenerate credits.
- Harnesses: `scripts/verify-toy-world.js` (chunk streaming + budgets,
  NYC→JFK), `toy-closeup.js` (teleport + screenshot), `toy-console.js`
  (full console dump), `toy-pick.js`, `leak-probe.js` (CDP heap
  profiler), `soak-fly.js`, `inspect-mvt.mjs` (dump a vector tile's
  layers). ALWAYS look at the screenshots.

## 3. Hard constraints & gotchas (violating these re-breaks fixed bugs)

Everything in FLY_MODE_HANDOFF §3 (NO API keys ever; no r3f-perf; pinned
three versions; attribution always visible; runtime-object pattern — no
per-frame React state; user owns fly-constants values). Plus, learned
this session (details in FLY_TOYWORLD_REWORK §6.5):

1. **Anything that suspends inside FlyScene needs its OWN `<Suspense>`**
   (troika font loads!). Reaching FlyCanvas's boundary hides the scene,
   runs effect cleanups (`engine.dispose()` mid-flight) and re-runs
   spawn on a disposed TileMap → plane at null island, no terrain.
2. **Never put `console.*` on a per-frame path in dev** — Next 16 dev
   instrumentation retains per-call state (~200MB/min). The three-tile
   assert guard lives at the top of `lib/fly/terrain-engine.js`.
3. Drape chunks only when the DEM answers at adequate zoom
   (`TerrainEngine.getGroundAt` → `{elev, tileZ}`, gate + heal in
   toy-world-engine) — coarse fallback tiles produce plateau slabs.
4. MVT exterior rings wind CW-in-y-down → flip earcut indices or faces
   point down. Clip to the tile square or buffers z-fight at seams.
5. OpenFreeMap tile template is dataset-versioned — resolve from the
   TileJSON (`https://tiles.openfreemap.org/planet`) at runtime.
6. `import { PbfReader } from 'pbf'` (v5 has no default export).
7. The repo's eslint react-hooks compiler rules conflict with the
   runtime pattern (pre-existing errors in FlyMode etc.) — the baseline
   is not lint-clean; don't chase it, don't make it worse.
8. Playwright drives installed Chrome from `C:\Users\bfecho\node_modules`;
   headless rAF ≈ 240fps (frame-count gates, not wall-clock); background
   Bash tasks cap at 10 min — size soaks accordingly.

## 4. Suggested build order (each step: harness → SCREENSHOT → user review)

0. Fly the current build 2 min; read the progress logs; confirm the
   user's pause-menu style names (maybe rename: Day / Night / Neon?).
1. **Globe-ify satellite + night** (fast, high-signal): per-style bend
   radius + SkyDome colors (satellite keeps HDRI day sky — dome only
   below-horizon? prototype: HDRI sky + void under the rim), ungate
   tracers everywhere, trim draw calls back under 350 (shadow casters,
   DOF gating). These two styles need NO new ground work.
2. **Clean letters** (all styles): Archivo Black, white, no decoration,
   size/fade tuning, kill chips everywhere; user screenshot review —
   this burned them once, get sign-off on ONE letter before wiring all.
3. **Toy → dark neon arcade**: re-palette `toy-palette.js` (dark ground
   family, glowing road/water values above bloom threshold), retune TOY
   mood constants (dark violet sky/fog, cool lights), buildings dark
   with subtle edge/top glow, re-tint props. The user edits palette
   values themselves — expect a live tuning loop.
4. Micro-interactions batch (user asked repeatedly): letter pop-in
   springs, warp confetti burst, plane hover wobble, POI hover tooltip
   in the game-UI style, minimap restyle. InspectModal is already
   game-styled — get a verdict, iterate.
5. Perf + soak: draws ≤350, 15-min soak green, docs + CREDITS current.

## 5. Open questions for the user (ask before building if unclear)

- Satellite sky: pure HDRI day, or day sky + dark void visible below the
  globe rim (my read of "per-style skies" + the airloom rim)?
- Tracer thickness: keep 1px additive lines or upgrade to ribbon quads?
- Do the night style and neon-toy style feel distinct enough, or should
  night eventually merge into neon-toy?
- InspectModal game restyle: keep / tune / redo?

---

## 6. PROGRESS LOG — 2026-07-16 (globe rework session, EXECUTED)

All of §1's plan is built, harness-verified and screenshot-reviewed
(`scripts/verify-globe.js` — draws 343/220/215 per style vs 350 budget,
tracers live in all styles, warp + burst verified, zero page errors;
2-min idle soak: heap FLAT 197→169MB, p95 4.3ms). §5's open questions were
answered with the doc's own suggested reads (user was not available):
satellite = HDRI day + void under the rim; tracers stayed 1px additive
(HEAD_BOOST 1.5 so heads bloom in daylight); night kept separate from
neon; InspectModal untouched (verdict still pending).

**What was built (by §4's order):**

1. **Globe-ified all three styles.** New `GLOBE` constants
   (fly-constants): per-style `bendRadiusM` {satellite 100k, night 80k,
   toy 80k — moved out of TOY_WORLD} + per-style dome colors. FlyScene
   sets the bend uniform every frame in every style. `SkyDome` is now
   parameterized (horizon/zenith/void/rimOnly) and mounted always;
   `rimOnly` (satellite) renders transparent above the horizon so the
   HDRI day sky shows, with the light fog band curving into dark void at
   the rim — reads as atmosphere. TrafficTracers/TrafficLayer/billboards
   materials carry `applyBend` so traffic + streaks hug the globe;
   LabelCanvas projections subtract `bendDrop` via new
   `getBend()` (world-bend.js) so reticle/labels/hover-pick stay glued.
2. **Clean letters everywhere.** `PoiPegs.jsx` → **`PoiLetters.jsx`**:
   Archivo Black (OFL, self-hosted `public/fonts/ArchivoBlack-Regular.ttf`,
   in assets.js + CREDITS.md), pure white, NO outline/pegs/sparkles,
   sizes in `LETTERS` constants (city 210 / airport 150 / landmark 95).
   All styles (own Suspense — the troika gotcha). Per-style ground Y
   (toy: exaggerated+lift; others: true DEM). `LETTERS.separationM`
   declutter: bigger kind picks first, colliding smaller names dropped
   (fixed MANHATTAN/TIMES SQUARE overlap). WaypointCanvas DOM chips
   DELETED everywhere (FlyMode); `WAYPOINTS` constants removed;
   `runtime.nearestPoi` now published by PoiLetters.
3. **Toy → dark neon arcade.** `toy-palette.js` fully re-paletted (dark
   violet-navy ground family, dark teal vegetation, deep-violet tree
   blobs, dark teal water + NEON cyan foam shoreline, cyan road grade
   minor→major, magenta motorways, bright runway cyan, dark buildings
   with new `buildingTop` luminous-violet top gradient — worker bakes
   base→top on walls). TOY mood constants: dark violet sky/fog, cool
   near-full sun, bloom 1.05 @ threshold 0.52. `TOY.shadows = false`
   (invisible on near-black ground; saves the shadow pass draws).
4. **Micro-interactions:** letter pop-in spring (easeOutBack in
   PoiLetters), `WarpBurst.jsx` (one-shot additive InstancedMesh, neon
   confetti inheriting flight velocity, fired on warpEpoch), player idle
   hover wobble (PlayerPlane), minimap neon rim + locked-target ring.
5. **Perf:** TOY_WORLD rings trimmed (mid 20→18km, far 36→30km — the
   curvature hides the far edge anyway), maxChunks 150→120. Neon 343
   draws / ≤1.43M tris; night/day ~215-220 draws.
6. Pause menu styles renamed **Neon / Day / Night** (keys unchanged);
   `window.__flyStore` dev global for harness style switching; stale
   traffic now fades toward the per-style fog color; NIGHT relit
   (sun 1.35 — 1.5 washed the globe grey, 1.15 buried the street grid).

**Harnesses:** `scripts/verify-globe.js` (3 styles + warp, budgets,
screenshots globe-*.png), `scripts/globe-night-check.js` (night-only,
long tile settle). Old `verify-fly-style.js` updated for the renamed
button. LOOK AT THE SCREENSHOTS.

**Remaining / for the user:**
- Art-direction review pass: neon palette values (user tunes
  toy-palette.js live), night sun balance, letter sizes, tracer
  thickness (ribbon upgrade if 1px too thin on their display).
- ~~InspectModal verdict~~ → delivered "VERY lame"; rebuilt round 4 (§6.3).
- ~~Not built yet: void-grid floor beyond the fog, water foam animation,
  POI hover tooltip in game-UI style.~~ → all built round 4 (§6.3).
- 15-min soak on the user's iGPU hardware (headless numbers green).

### 6.3 Round 4 — arcade-polish pass (2026-07-16, later session; EXECUTED)

User verdicts arrived with screenshots: clouds clipping + bright white at
night, "rounding of the earth plane is weird" (giant dark rim facets),
"contrails do not work correctly and are intermittent", InspectModal
"VERY lame — want isometric angles + a picture of the craft". Their
picks via Q&A: card = ink glass + hero color; clouds = moody dark wisps;
contrails = persistent ribbons; extras = spot toasts + POI tooltips +
animated foam (boost/warp juice declined).

**What shipped (all harness-verified, `scripts/verify-edge-fx.js` is the
new top-level check — ALL PASS, 0 page errors):**

1. **World edge.** `world-bend.js` grew a second patch variant
   `applyBendFade` (ground materials melt into the style's void/fog color
   across `WORLD_EDGE.fade` bands — the coarse-tile facets can't read as
   geometry) + the long-promised **VoidFloor** (`components/fly/VoidFloor.jsx`):
   world-anchored cross grid (float64 mod offset uniform — never absolute
   XZ in float32), derived floorY = drop(fadeEnd)+margin so z-fighting is
   impossible, dark styles only. `PALETTE.voidGrid` finally consumed.
   ⚠️ Every shader variant carries its OWN `customProgramCacheKey`
   ('world-bend' / 'world-bend-fade' / 'world-bend-fade-foam') — the
   variants' onBeforeCompile closures stringify identically, so the
   default key would serve the wrong cached program.
2. **Clouds.** `CLOUDS.byStyle` (Day keeps white cumulus; toy/night get
   fewer, higher, ink-tinted wisps under the bloom threshold;
   `enabled:false` = the off switch) + terrain clearance: puffs sample
   the DRAWN ground (worldToGeo → getElevationAt; toy ×1.7+lift) on
   toroidal wrap + round-robin healing, base ≥ ground + 450m.
   `__flyStats.cloudMinAgl` gates it (spawn: 1640m).
3. **Contrails/tracers.** `TrafficTracers.jsx` rewritten: ribbon mode
   (default) = per-track ring buffers of ABSOLUTE dead-reckoned float64
   positions → camera-facing tapered quad trails (~3.8km) in ONE mesh
   (Contrail.jsx recipe; warp-cut 2500m; r185 `addUpdateRange`), plus a
   head-extension segment preserving the live-vector read; streak mode
   kept as `TRACERS.mode` A/B. Shared fixes: cap 512, alpha floor 0.35
   (only the removal window fades below), head brightness floor clearing
   every bloom threshold, speed hysteresis 18/12, ~10s buffer grace.
   **ROOT CAUSE FOUND:** the aggregators' clocks disagree (~60s); the
   min()-rule skew estimator lurched on source rotation and the stale
   ladder mass-deleted ~270/330 tracks every ~29s (probe: tracks 329→62).
   Fixed in `traffic-engine.js` ingest: skew samples > `TRAFFIC.clockJumpSec`
   off the estimate = clock DISCONTINUITY → re-baseline + shift every
   stored fix timestamp (mind blendFix aliasing — shift each unique fix
   object once). Tracer count cv: 0.209 → **0.009**, max dip 79.5% → 0.7%.
4. **INK CODEX inspect card.** Full rewrite of `hud/InspectModal.jsx` +
   `hud/inspect/` (tokens, card-bits, ModelTurntable): ink glass card,
   hero color = `meta.color` (CSS var `--hero`), rarity chip + NEW SPOT!/
   ×N from the passport store (logSpot now also fires on card open), GLB
   turntable hero in a dedicated mini-`<Canvas>` (drei `<View>` is
   impossible: opaque DOM above the canvas + EffectComposer repaints the
   whole framebuffer; R3F force-loses the context ~500ms after unmount —
   one benign "Context Lost." console line), silhouette fallback chain,
   photo tab with REQUIRED Planespotters photographer credit, type names
   via new `lib/aircraft-type-names.js`, route progress bar, odometer
   stat meters, pointer-parallax tilt + holo sweep, WARP (ice) / CHASE
   (hero) bevel buttons. Archivo Black got a DOM `@font-face`. Airhex
   logos skipped (licensing) — hero monogram chip instead.
5. **Extras.** `hud/SpotToast.jsx` (rarity-tinted NEW SPOT toasts +
   `FlyAudio.spotBlip(tier)`, SPOTS cell appended LAST in FlyHUD —
   verify-fly.js indexes `.font-mono` [0..4]); POI hover tooltips
   (PoiLetters publishes `runtime.poiSlots`, LabelCanvas hit-tests +
   draws in its existing rAF); animated shoreline foam (worker bakes
   per-vertex `aFoam` arc-length into the merged water group, -1
   sentinel elsewhere; water material scrolls a dash train via
   `applyFoamLayer` — zero extra draws).

**Harnesses:** `verify-edge-fx.js` (floor/clouds/tracer-stability/
budgets/boost, per-style screenshots edge-*.png);
`verify-fly-game.js` selectors moved to data-testids (the old
'Target Data' assert had been silently broken) and its aiming is now
bend-aware via `__flyStats.bendK` — without the drop a 12km target
projects hundreds of px off. Draws: toy ~318+floor, night ~228, day
~197 — all ≤350. LOOK AT THE SCREENSHOTS (edge-01/05 are the money
shots).

**Round-4 addendum (same session, user FL300 report):** two fixes after
the user chased/warped to traffic at 31k ft in Day and hit (a) a giant
BLACK void band between the rim and the sky, (b) a screen-filling white
wedge. Root causes + fixes:
- (a) The full mini-globe bend at cruise altitude drops terrain so fast
  the rim silhouettes ~24° below the horizon and satellite's near-black
  dome void fills the gap. Fix: **GLOBE.altFlatten** — the live bend k
  flattens smoothly with player altitude (full toy curve below 2500m,
  halving every 3500m, floor 10%) in FlyScene's per-frame setBend; every
  CPU consumer reads the live uniform so the world stays glued
  (`__flyStats.bendK` now reports the EFFECTIVE k for harness aiming).
  Plus satellite's dome void is now an atmospheric slate (#33465c), not
  near-black — the below-horizon band reads as thick lower atmosphere.
- (b) Camera-facing ribbons turn their full width toward the camera, and
  the chase cam sits basically INSIDE the player's own contrail (and a
  chased target's ribbon) — even a 2m ribbon smears into a wedge. Fix:
  near-camera width collapse (CONTRAIL.nearFade*M 25→80,
  TRACERS.ribbon.nearFade*M 40→120) in Contrail.jsx + TrafficTracers.jsx.

**Remaining after round 4:** the user's live-tuning loop on the new
defaults (cloud tints/opacity, voidGrid brightness + cellM, fade band
distances, ribbon width/points, altFlatten curve, Day void slate,
turntable speed/scale, card legibility across styles — all in
fly-constants.js/toy-palette.js) and the on-hardware iGPU soak.

### 6.1 Round 2 — user review fixes (same day, in-session feedback)

User flew the neon build: "a LOT better", but rejected the **retro
synthwave colors** (clashed with the red player jet), and reported cloud
clipping, ground planes floating, and intermittent contrails. All four
fixed and harness-verified (`scripts/verify-globe2.js` + re-run of
verify-globe.js — draws 340/223/207 steady-state, zero errors):

1. **Palette → INK + ICE** (toy-palette.js rewrite #2): near-black
   ink-navy globe, streets in silver→ice-white grades (no hue), pale ice
   shoreline foam, dark slate buildings with soft slate tops, deep ink
   sky. The altitude tracers + red plane are now the ONLY saturated
   elements (this IS the airloom read — its ground is neutral dark with
   pale street lines). TOY mood retinted to match. Warp confetti's two
   synthwave hexes swapped for palette ice tones.
2. **Grounded planes floated** (root cause, the documented plateau-DEM
   gotcha): TrafficEngine sampled `getElevationAt` ONCE per track and
   cached forever — a coarse-fallback answer pinned planes mid-air
   permanently, and the pin ignored the toy ground's 1.7×+lift. Fix:
   FlyScene's sampler now uses `getGroundAt` gated on `tileZ ≥ 11`
   (null → engine retries next fix; new `traffic.clearGroundCache()` on
   style swaps), and pins to the DRAWN ground per style. Verified by
   warping to a stale 0m track — it sits ON the street grid.
3. **Clouds clipped at the rim**: puffs don't ride the vertex bend patch
   — CloudField now drops each puff CPU-side by `bendDrop(dist, k)` from
   the live uniform. Distant clouds sink below the rim with the terrain.
4. **Contrail intermittent**: drei Trail's zero-filled buffer forced a
   warm-up remount every ~10km rebase (≈4s blank each) and hard-toggled
   at exactly 6km. **Contrail.jsx rewritten**: custom camera-facing
   ribbon over a ring buffer of ABSOLUTE positions rendered rebased per
   frame — rebase-immune by construction, >400m step = warp hard-cut,
   smooth 800m altitude fade band. Proven: 4 rebases at boost, buffer
   stayed 160/160 (dev stat `__flyStats.contrailPts`). `rebaseEpoch`
   now has no consumers (kept as the designed hook). Also fixed the
   dev `__flyStats.rebases` NaN (field-less init).

### 6.2 Round 3 — reliability + presence (user review, same day)

User reports: tracers ("contrails" in their vocabulary) still dropping,
clouds/sky nearly gone in toy + still rim-clipped, tooltips for planes
NOT in the field of view, hover-inspect sometimes dead, and adsb.lol
**429ing over and over** (correctly suspected as the tracer dropout
cause). All fixed, harness-verified (verify-globe.js: 343/225/209 draws,
warp ✓, 0 errors; verify-globe2.js: contrail 160/160 pts across 4 boost
rebases, ground-warp lands ON the grid):

1. **Multi-source ADS-B failover** (`app/api/aircraft/route.js`,
   user-requested — supersedes the old "don't touch app/api" note for
   this file): keyless readsb aggregators in preference order
   **adsb.lol → adsb.fi → airplanes.live**; 429/timeout/bad-shape puts a
   source on cooldown (30s/12s) and fails over; `x-adsb-source` response
   header for debugging. ⚠️ adsb.fi serves the list as `aircraft` (not
   `ac`) and `now` in SECONDS — the proxy normalizes the array, the
   worker already normalizes s/ms. Also: upstream coordinates are now
   rounded to 0.01° so Next's 3s fetch cache actually dedups — fly mode's
   full-precision moving coordinates made every 2s poll a fresh upstream
   hit (a major 429 contributor). Tracer dropouts were downstream of all
   this: stale ladder starving on 429 storms. (Verified live: traffic
   32 → 395 tracked as sources recovered mid-run.)
2. **Phantom off-screen tooltips** (pre-existing): the NDC z-range check
   is NOT a behind-camera cull — points behind the eye can project
   mirrored into [-1,1]. LabelCanvas now dots against the camera forward
   vector (`inFront()`) for labels, reticle and lead pip.
3. **Hover-inspect sometimes dead**: hit-testing only covered the 15
   labeled nearest. Now a `TRAFFIC.pickPoolSize` (64) pool is hoverable/
   clickable; only the first 15 draw labels. Phantom hover-steal is gone
   with the cull.
4. **Clouds/sky presence in toy**: the 36km cloud cell left most puffs
   sunk below the 80km-globe horizon. Cell → 24km, puffs 54/30/10
   (limit 512 — clouds are ONE instanced draw), and a distance dissolve
   (wrapper-group scale, 9→13.5km) shrinks puffs away BEFORE the bent
   rim can depth-slice them (drei re-reads wrapper matrixWorld per
   frame; per-puff opacity is not reachable through the Cloud ref).
   Toy horizon glow brightened (#2e3a6e) and the dome gained a
   RESTRAINED procedural star field (toy/night only; ~4% of direction
   cells, pinprick size, brightness capped under the bloom threshold —
   first attempt at 20%/0.3° read as a blizzard, keep stars subtle).
5. **Player contrail hardening**: warp reset is now explicit
   (`warpEpoch` effect); the distance backstop went 400m→2500m so a GC
   hitch at boost (0.6s ≈ 450m) can't blank the trail.
6. Ops note: running `npm run build` against a live dev server's `.next`
   corrupted it again (API routes 404) — kill node on :3000, delete
   `.next`, restart. Same as FLY_MODE_HANDOFF §4.

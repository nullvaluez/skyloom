# World Pass, stream C REACH (`WORLD_REACH`, sub-switch `standIns`)

Branch `world/reach`, from the W0 foundation `ac26a77e`. Round 1, implementer.

## What was built

The far city is now one lean stand-in per building instead of the capped
horizon mass. With `?flags=WORLD_REACH` on desktop High / Ultra:

- **Worker** (`lib/fly/toy-world/worker/sat-skyline-stand-ins.js`, called from
  the top of `buildSatSkyline` only when `tileCtx.worldPass.reach.on &&
  .standIns`, Enhanced, with a CITY_HORIZON profile). Every building the near
  ring admits (`admitFootprints`, stream A's admission, so the far set is the
  near set) becomes one record: an area-preserving minimum-area oriented box
  (rotating calipers over the hull, scaled to the polygon's area), its height
  from `heightOf(item, tileCtx, 'far')`, its wall and roof colour from
  `colourOf(item, style, tileCtx, 'far')` with the far mass's existing
  `architectureStyle` call, family and seed. Records are sorted by a
  screen-size key `max(h, footprintK * sqrt(true area))`, descending. The id is
  `item.sid ?? item.id`. No caps but a 6,000 per tile backstop.
- **Untagged rule** (this stream's admission policy; worker tunables in the
  block's `worker` object): an untagged footprint is a stand-in only if it is
  bigger than a house (220 m2: the near ring infers 5 to 8 m for those, under
  two pixels past the detail ring), outside a suburban context or at least
  900 m2 inside one (the R19 hatch area), and the tile holds enough of them
  (the R21 hatch ramp, 24 / 64, FNV order). Owens Valley and farmland stay
  empty by construction (node gate G1). Mapped heights are always admitted.
  Untagged items ask `heightOf` for the far hatch band and carry
  `standIn: true` so stream A can answer them with the near model.
- **Main thread** (`lib/fly/toy-world/sat-stand-ins.js`,
  `lib/fly/sat-stand-in-material.js`, `sat-skyline-engine.js`): a group's 16
  tiles are k-way merged into one size-descending list, draped per building
  on the engine's existing lattice over the drawn terrain mesh (the same
  `getGroundAt` grid the old mass used, refined in place by the existing
  heal sweep), and drawn as ONE instanced draw per group: a shared 12-vertex,
  6-triangle box (roof plus the two walls facing the camera; a wall facing away
  is turned 180 degrees about the box axis, which keeps its winding) and 28
  bytes per instance (anchor 8, ground 4, Uint16 dims 8, Uint8 wall / roof 8).
- **Screen size**: each frame the engine sets each group's instance count to
  the prefix of its size list that can still reach `minPx` from the group's
  nearest point (or the detail ring's fully covered radius, whichever is
  farther). The vertex shader does the exact per-building test with the live
  camera focal length, collapses anything under `minPx` to a point and
  dissolves the next `fadePx` with the same Bayer dither every ring fade uses
  (it multiplies the bend's `skyA`), so a building growing past the threshold
  never pops. If the total passes the tier budget (Ultra 1.5 M, High 0.8 M
  triangles) `minPx` rises, damped (0.2 s up, 2 s down), until it fits.
- **Material**: `createSatelliteArchitectureMaterial({ distant: true })` is
  called as is (stream D's file is not edited) and wrapped: at the start of the
  vertex `main()` it builds each vertex from the instance attributes and then
  aliases `position`, `normal`, `color`, `uv` and `aBuildingStyle` with
  `#define` to the built values. `aBendAnchor` is a real per-instance
  attribute, so the bend, the 24-slot coverage mask (`vArchitectureCovered`
  from `wAnchor`), the outer horizon dissolve, the haze, the night windows and
  the CHUNK_FADE twin uniform all work unchanged. Facade UVs are built in true
  metres so night occupancy averages exactly as on the old mass. Own cache key
  suffix `|wp-reach-standin-v1-<footprintK>`. Stand-ins do not cast or receive
  shadows (the old mass did neither).
- **Kept**: the 24-group z14 ring (`CITY_HORIZON` groups of 4x4), one draw per
  non-empty group (no new draws), CHUNK_FADE births and deaths through the twin
  pool, the coverage mask, the outer horizon band, RING_HOLD, FLASH_GUARD
  (the shared base box has no degenerate triangle), HEAL_IN_PLACE (re-drape of
  every instance's ground on the refined lattice), the empty-group rule (a group
  with no stand-in issues no mesh).

## Design decisions and why

- **Instanced oriented boxes, not simplified rings.** 28 bytes per building
  against ~55 bytes per vertex for the old merged polygons. Midtown's ring
  holds ~500,000 stand-ins in 13 MiB of geometry; the old 24-group horizon
  held 47 MiB for about 3 % of the buildings.
- **Reuse the far material by aliasing, not a new material.** A separate
  material would have to re-implement the coverage mask, the horizon band, the
  haze, night windows and every look flag, and would drift from the near city
  as stream D changes colours. The aliasing patch edits only the shader text
  at two anchors in the vertex shader (`#include <common>`, `void main() {`)
  and one in the fragment (`float skyA = uSkyFade;`); a missing anchor logs
  `[wp-reach] stand-in material: ... anchor not found` once.
- **Admission = the near ring's admission.** Calling `admitFootprints` keeps
  airports, monuments (marquee discs), the area floor and the mega guard
  identical to the near ring, and stream A's small band will flow through.
- **minPx 0.8 (full at 1.6 px), not 2.** Measured on Lagos (see below): at
  2 px the far mainland lost the dense low-rise texture the old mass drew; a
  dense district of 2 to 3 storey buildings at 7 km reads as a city as a
  whole even when each building is about one pixel. The tier budget is the
  backstop where it binds (Midtown at Ultra: minPx rose to 1.13).
- **The covered radius.** The near group contains the detail ring; instances
  inside the area fully covered by settled detail tiles are never visible, so
  the per-group prefix is measured from that radius. 0 while the detail ring
  dissolves with altitude (its near fade < 1).

## Measurements

All on the RTX 5080, installed Chrome, D3D11, :3323, Ultra unless stated,
1600 x 900, `scripts/look-pass-capture.cjs --flags=WORLD_REACH`, frames under
`.graphics-review/world-pass/reach/` (not in git). "Off" frames are base-1 /
base-2 / base-3 unless stated.

Node (recorded inputs, `node scripts/wp-reach-node-bench.mjs`, PASS G1-G5):
stand-ins per centre tile against the old horizon's emitted bodies: midtown
3,289 vs 80, lower Manhattan 1,230 vs 95, Brooklyn 6,000 (cap) vs 23, Paris
3,072 vs 22, Tokyo 557 vs 85, Lagos 1,865 vs 65, Phoenix suburb 764 vs 13,
Dubai 598 vs 58, Hong Kong 1,604 vs 58, SF 2,240 vs 69, Powell 2 vs 0, Owens 0,
Iowa 0. Total 33,030 vs 729 (45x). Worker build 14 to 72 ms per dense tile
(the old horizon tile: 18 to 71 ms, `stream.md` 3.4).

Diag stage counters (the worker's `reach` record summed over the 24 resident
groups, `?flags=WORLD_REACH,WORLD_PASS_DIAG`, `satSkyline.stats.wpReach_*`,
`node scripts/wp-reach-info-probe.cjs --pose=paris-mid
--flags=WORLD_REACH,WORLD_PASS_DIAG`), Paris from 1,500 m, 384 z14 tiles:
admitted 533,572 (mapped 100,862, untagged 432,710); untagged house-sized
335,802, untagged under 900 m2 in a suburban tile 10,679, density ramp 2,035,
under the 6 m size key 4,405, degenerate 0, cap 0; emitted 180,651 stand-ins
(129 tiles were suburban contexts).

### Browser measurements (Ultra, RTX 5080)

`node scripts/world-pass-budget.cjs --url=http://localhost:3323
--pose=nyc-low,paris,tokyo,phoenix-suburb,powell --quality=ultra
--flags=WORLD_REACH --out=.graphics-review/world-pass/reach/budget-ultra-on`
against the W0 base table (FLY_WORLD_PASS.md "Budget", flags off):

| pose | draws on (base) | horizon MiB on (base) | stand-ins resident | drawn | stand-in tris (main pass) | minPx after budget | horizon first / full s on (base) | skyline finalize max ms |
|---|---|---|---|---|---|---|---|---|
| nyc-low | 385 (385 / 536) | 16.9 (47.4) | 631,341 | 249,095 | 1,494,570 | 0.99 (wanted 326,658) | 45.8 / 61.4 (9.6 / 26.0) | 34.9 |
| paris | 383 (383) | 4.9 (49.1) | 182,637 | 174,945 | 1,049,670 | 0.80 | 13.5 / 25.5 (5.2 / 15.4) | 14.4 |
| tokyo | 401 (401) | 12.8 (48.0) | 480,391 | 246,484 | 1,478,904 | 0.94 (wanted 329,794) | 7.1 / 30.0 (4.4 / 15.0) | 24.0 |
| phoenix-suburb | 369 (369) | 7.8 (35.6) | 290,225 | 244,551 | 1,467,306 | 0.80 | 4.5 / 16.5 (4.5 / 13.2) | 9.6 |
| powell | 357 (356 / 538) | 0.3 (9.4) | 10,030 | 8,441 | 50,646 | 0.80 | 4.7 / 16.1 (4.0 / 10.5) | 1.6 |

The old horizon at the same poses drew 478 k (nyc-low), 507 k (paris),
479 k (tokyo), 366 k (phoenix), 96 k (powell) triangles in about 40 to 85
bodies per z14 tile; the stand-ins draw 8 k to 250 k BUILDINGS. Draws are
unchanged (one per group). Geometry is 3 to 10 times smaller than the old mass.

Arrival: the budget tool's horizon "first / full" seconds at nyc-low read
45.8 / 61.4 on, against the W0 table's 9.6 / 26.0 off. That W0 number is
from a quieter machine: re-measured OFF on this server under the same load
(`node scripts/world-pass-budget.cjs --url=http://localhost:3323
--pose=nyc-low --quality=ultra --out=.../reach/budget-ultra-off-nyc`, five
dev servers and other streams' captures running) it reads 43.1 / 54.0, and
its detailed ring 51.5 / 91.2. So the first horizon group arrives as fast as
today; the FULL ring is about 7 s later at Midtown (61 against 54 s), the
cost of building ~3,000 records per Midtown tile instead of ~80 bodies on
the one skyline worker. At the other poses it is within a few seconds of
base. In the capture runs (warm page, warp from the
previous pose) the horizon first / full seconds were: paris-mid 4.2 / 14.3,
nyc-bay 4.8 / 14.3, lagos-mid 34.2 / 40.7 (v3 run), nyc-mid 0.6 / 3.8,
tokyo-mid 2.8 / 3.9 (v1 run). The per-group finalize (merge, drape, upload)
is 1.6 to 35 ms, under the old mass's.

High (`look-pass-capture.cjs --quality=high --flags=WORLD_REACH`, out
`high-on/`): the 0.8 M budget binds and minPx rises: nyc-bay 790,770
stand-in triangles at minPx 2.44 (349,714 wanted at 0.8), paris-mid 798,654
at 1.59, tokyo-mid 742,326 at 1.81. Medium with the flag in the URL
(`medium-on/`): the shipped 10-group horizon, no stand-in counters (the
latched tier test says no).

THE COASTAL REFLECTION. renderer.info counts every stand-in mesh twice near
water: `lib/fly/coastal-reflection.js` renders the skyline group again into
its 768 x 512 reflection target (it did so for the old mass too).
`node scripts/wp-reach-info-probe.cjs --pose=paris-mid`: first version, the
reflection drew 0.86 M stand-in triangles on top of the main pass's 1.03 M;
with the reflection's own focal length and 2 x minPx (`reflectionPxK`) it
draws 0.49 M. So near water the stand-ins cost up to the tier budget in the
main pass plus about half of it in the reflection.

Motion (`node scripts/wp-reach-motion.cjs --url=http://localhost:3323
--flags=WORLD_REACH --scenarios=paris-cruise-500,paris-boost-500
--frameSec=4 --out=.graphics-review/world-pass/reach/motion-on`, summary
`node scripts/wp-reach-motion-summary.cjs <out>/probe.json`), straight line
15 km into Paris at 500 m AGL, golden hour sun:

| run | group births (true distance p10 / p50) | births without a fade (pops) | stand-ins drawn p50 | skyline finalize max |
|---|---|---|---|---|
| on, cruise 180 m/s | 14 (12.8 / 13.4 km) | 0 | 169,134 | 4 ms |
| on, boost 750 m/s | 18 (12.4 / 13.2 km) | 0 | 167,327 | 4 ms |
| off, cruise | 13 (12.7 / 13.5 km) | 0 | - | 11 ms |
| off, boost | 15 (11.6 / 13.0 km) | 0 | - | 7 ms |

Every group birth is a CHUNK_FADE birth 12 km out; within a group the size
threshold is a vertex-shader dissolve, and minPx did not move during either
flight (no budget step). At boost the detail ring cannot keep up (review
S-F2) and the OFF arm shows Paris as photo with a handful of towers; the ON
arm shows the whole city as stand-ins (strip:
`motion-on/strip-boost-on-left-off-right.png`). The headless frame times of
both arms are dominated by the screenshots and are not a verdict.

## Shared-file edits

None. Every edit is in a stream C file or the stream's own `WORLD_REACH`
block of `lib/fly/fly-constants.js`. `WORKER_PROTOCOL` is unchanged.

## Seam requests

- **A TRUTH**: `heightOf(item, tileCtx, 'far')` for an item with
  `standIn: true` should return the near ring's height (the one height model).
  Today the far rule gives an untagged stand-in the R19 hatch band (10 to
  22 m, capped 25), which is what the old mass used for area-only picks; the
  near ring gives 9 + 0.5 sqrt(area) downtown and the typology bands in
  suburbs. Stand-in items carry `{ rawH, areaM2, id, sid, polys, hatch,
  standIn }`, the near item's fields plus `hatch`. tileCtx.suburban is NOT set
  on the skyline path (the stand-in builder computes `suburbanContext` itself
  for its admission rule); if the near model needs it, set it in `heightOf` or
  ask me to set `tileCtx.suburban` before calling.
- **A TRUTH**: when `item.sid` exists the stand-in uses it as the id for the
  height hash, the colour hash and the lock order, so near and far agree.
- **D LOOK**: `colourOf(item, style, tileCtx, 'far')` is called once per
  stand-in with `item.h` set and `standIn: true`; a photo-sampled roof colour
  for the far ring would remove the remaining far "confetti" (random palette
  roofs read brighter and more saturated than the photo at 5+ km).
- **D LOOK**: the stand-in material wraps `createSatelliteArchitectureMaterial
  ({ distant: true })` and depends on three anchors in its generated shader
  text (vertex `#include <common>` and `void main() {`, fragment
  `float skyA = uSkyFade;`) and on the vertex shader reading `position`,
  `normal`, `color`, `uv` and `aBuildingStyle` by those names. Please keep
  them, or tell me when they move.
- **B ARRIVAL**: none required. The stand-in drape uses the public
  `getGroundAt` through the engine's lattice; a faster query makes the far
  lattice fill faster for free.

## Ported techniques

- Per-tile importance order with a distance-scaled draw prefix (FableFlight
  `src/buildings.rs` lines 247-257, the `HCLASS` distance scale, and the
  per-run tallest-first order at 1945-2066). Here the key is a screen-size key
  and the prefix is per instanced group.
- Rectangle fit for far stand-ins (FableFlight `src/buildings.rs` 1799-1840,
  `far_version`): ours is the minimum-area oriented rectangle, area-preserving,
  for every footprint, not only rectangular ones.

## Acceptance frames (final, Ultra, `--flags=WORLD_REACH,WORLD_PASS_DIAG`)

`.graphics-review/world-pass/reach/final/<pose>__<time>.png`, off side
base-1 / base-2 / base-3 (and `reach/off/lagos-mid__noon.png`, a tight off
pair on this server). Per pose: stand-ins resident / drawn / triangles /
minPx after the budget, from `final/manifest.json`.

| shot | resident | drawn | triangles | minPx | verdict |
|---|---|---|---|---|---|
| nyc-bay noon / golden | 498,337 | 248,741 | 1,492,446 | 1.13 | Manhattan, Jersey City and Hoboken now continue dense past the detail ring to Midtown; no ring cliff |
| nyc-top noon | 631,341 | 245,207 | 1,471,242 | 1.13 | Upper Manhattan continues to the bridges |
| nyc-mid noon | 499,337 | 249,897 | 1,499,382 | 1.11 | the cliff at ~3 km is gone; Midtown dense to the horizon |
| nyc-high noon | 482,458 | 249,999 | 1,499,994 | 1.20 | the pose sits inside a cloud deck in every arm (base included): not evidence |
| paris-mid noon | 180,651 | 171,881 | 1,031,286 | 0.80 | the Haussmann fabric carries on to the horizon; the far ring reads a little brighter and more varied than the photo (palette, stream D) |
| tokyo-bay noon / night | 389,095 | 213,123 | 1,278,738 | 0.80 | denser far city; night keeps a warm lit fraction (the shared window emission averages per building) |
| tokyo-mid noon | 419,717 | 243,076 | 1,458,456 | 0.80 | Shinjuku side fills in; Tokyo's map is sparse (553 k of 992 k admitted are untagged houses) |
| phoenix-mid noon | 275,705 | 245,185 | 1,471,110 | 0.80 | little change past the ring: houses stay photo by the untagged rule; the visible cliff here is the NEAR ring's invented slabs (stream A) |
| lagos-mid noon | 214,675 | 139,483 | 836,898 | 0.80 | the mainland carries mass to the horizon (tight pair `reach/v3/cmp-lagos-tight.png`) |
| dubai-bay noon | 109,923 | 71,705 | 430,230 | 0.80 | close to base; small infill |
| iowa-farm noon | 1,597 | 1,533 | 9,198 | 0.80 | farmland stays empty; the 1,597 are mapped buildings in towns of the 48 km ring |

Boxes on water, parks or runways: none seen; a stand-in exists only for an
OpenFreeMap building footprint the near ring admits (airport and marquee
footprints excluded by the same admission).

## Open

- **Untagged houses and stream A.** Rule (1) drops untagged footprints at or
  under 220 m2 because the near model gives them 5 to 8 m. In Paris 335,802
  of 432,710 untagged footprints (Haussmann parcels) fall under it, in
  Tokyo 553 k, Lagos 466 k. When stream A's far height for `standIn` items
  matches the near model, set `WORLD_REACH.worker.houseMaxAreaM2` to 0 and let
  the size key decide: that is when Paris and Tokyo gain their small-parcel
  fabric. Until then untagged non-house stand-ins use the far hatch band
  (10 to 22 m).
- **Colour.** The far ring uses the far palette (stream D's `colourOf`); at 5+
  km it reads a little brighter and more varied ("confetti") than the photo.
  A photo-sampled far roof colour (D) is the fix.
- **Arrival.** The full ring is about 7 s later at Midtown than the shipped
  horizon (one skyline worker builds ~3,000 records per dense tile). The
  first group is not later. A second skyline worker or B's shared tile service
  would take it back.
- **Reflection.** Near water the coastal reflection draws the stand-ins again
  (about half the main pass's triangles after `reflectionPxK`). The tier
  budget counts the main pass only.
- **Shader anchors.** The stand-in material depends on three text anchors in
  the far architecture shader (see Seam requests); if stream D moves them the
  console logs `[wp-reach] stand-in material: ... anchor not found` and the
  stand-ins would draw wrong. No gate checks it in node (it needs a browser
  compile); `scripts/wp-reach-info-probe.cjs` prints that console line.
- **Prewarm.** The stand-in program has its own cache key and is compiled on
  the first group's first draw, not in `prewarm.js` (FlyScene-owned). A
  one-time compile hitch when the first group appears is likely; not measured.
- **Owner motion check.** Sub-pixel boxes (0.8 to 1.6 px) are dissolved with
  the ordered Bayer dither; the 5080 motion read (shimmer of the far city in
  a slow turn) has not been done by the owner. `minPx` / `fadePx` are main-
  thread tunables in the block.
- **Medium, phones**: untouched (the latched tier test), proven by a Medium
  capture with the flag in the URL (shipped 10-group horizon).

## Round 2

2026-11-16/17, implementer. Built on the integration head `d40dfd25` (merged
in, fast-forward: the other three streams, the two wave-1 seams, protocol 26).
Everything below is behind `WORLD_REACH` (still `enabled:false`); every new
line on the main thread is inside `this._reach` (latched once per page) or the
stand-in material; the worker path is reached only through
`tileCtx.worldPass.reach`.

Venue for every number: this machine's RTX 5080, installed Chrome, D3D11,
dev server :3323 on this worktree, Ultra unless stated, 1600 x 900, noon + 2 h,
live world (OpenFreeMap's 2026-11-15 planet). The control (flags off) was shot
in the same session from the same server. Frames:
`.graphics-review/world-pass/r2/reach/` in the main checkout (not in git):
`control/`, `reach/` (WORLD_REACH alone), `all4/`
(WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK), nine poses each, crops`
`*-pair.jpg` (control above, four flags below) and `*-zoom.jpg` (control left);`
`it1-*`, `it2-*`, `fin-*` are the same frames by capture batch (`it2` and`
`fin` carry the shipped code; between them only comments changed).
"Round 1" numbers are the verifier's and the integrator's (wave-1 journal,
`int-1`), which ran on other servers; they are the defect report, not a tight
before.

### 1. Far colour and street pattern

Finding: the far ring was a bright confetti (Paris white and salt-like, the
boulevards hidden, a tonal step at the Seine; Manhattan salmon, pink, cream and
blue over a blue-grey near ring).

What changed:
- **One colour adapter** (`farLookColour` in
  `worker/sat-skyline-stand-ins.js`). Every stand-in's base wall and roof
  colour comes through it. LOOK off: the legacy far palette, which in Enhanced
  is the near ring's own palette (`architecturalColor(style.walls/roofs
  [variant])` in both `farColour` and `nearColour`), so the far ring has the
  near ring's palette statistics. LOOK on: today `colourOf(..., 'far')`
  (LOOK's `lookFar`). LOOK's round-2 work in progress (uncommitted in
  `wp-look` when this was written) names its export `lookFarColour(item,
  style, tileCtx, far01)` plus `lookFarPrepare(admitted, tileCtx)` once per
  tile; `colourOf(..., 'far')` already calls `lookFarColour`, so the adapter
  picks it up on merge and the integrator only adds the `lookFarPrepare`
  call. LOOK's function also desaturates by distance: `farLook.desaturate`
  (0.15) may then go to 0.
- **The ground photo** (worker, request tunables `photoZoom` 12,
  `photoWaitMs` 1500): one Esri World Imagery tile per z12 (one per 4 x 4
  skyline group, the terrain's own source and URL, `cache: 'force-cache'`),
  decoded in the skyline worker, latched per z14 tile (a tile built without
  it stays without it), sampled 3 x 3 pixels (about 75 to 90 m) around each
  stand-in, de-lit (luma clamped to [0.035, 0.45], chroma to 0.35) and packed
  as a fifth instance attribute (`aStandInGround`, 4 bytes: 32 bytes an
  instance). No photo: the tile's mean roof (the palette's own statistics).
  Measured at nyc-bay: the photo was there in time for 332 of 384 tiles.
- **The shader** (`sat-stand-in-material.js`, key `|wp-reach-standin-v2`),
  after every albedo pass and before lighting: from `farLook.fromM` 1,500 m to
  `toM` 7,000 m the stand-in is desaturated by 0.15 and pulled toward the
  ground albedo (roofs 0.85 at gain 0.85, walls 0.6 at gain 0.75); never at
  night. Every wall's foot is darkened (x 0.45 at the ground, 1 at 60 % of the
  height): a stand-in casts and receives no shadow, so this is what turns the
  gap between two boxes back into a street canyon.
- **Street pattern** (worker): a box under `sliverM` 3 m across is dropped
  (unless mapped 40 m or more; 52 at nyc-bay); every box is inset by
  `insetM` 1.5 m a side, at most `insetK` 12 % of its own width (a first try
  at a flat 1.5 m with a 5 m sliver rule dropped Brooklyn's brownstone rows
  from 6,000 to 1,306 a tile and was reverted).

Measured (`scripts/wp-reach-colour-stats.cjs`, sRGB 0-255; L mean luma, C mean
chroma, chf mean neighbour chroma difference = colour confetti). Far-ring
crop x 500-1100, y 470-560:

| pose | control (photo) | round 1, four flags (int-1, other server) | round 2, REACH alone | round 2, four flags |
|---|---|---|---|---|
| paris-mid | L 119.7 C 58.3 chf 2.7 | L 132.3 C 43.8 chf 6.2 | L 120.1 C 56.2 chf 4.4 | L 123.0 C 53.1 chf 4.7 |
| nyc-mid | L 123.8 C 58.6 chf 3.3 | L 124.8 C 56.8 chf 5.0 | L 123.0 C 58.2 chf 3.8 | L 123.6 C 58.0 chf 3.6 |

Whole lower frame (y 450-700): paris-mid control 118.2 / 48.6, round 2
121.2 / 43.3 (round 1 128.5 / 37.3); nyc-mid 118.9 / 46.9 against 116.4 /
47.7; tokyo-mid 112.8 / 49.2 against 111.1 / 52.8. The first round-2 try
(desaturate 0.5, no gains, no canyon: `it1-all4/`) was greyer and whiter
(Paris crop L 127.2 C 52.4 in the wider band); the shipped values are `it2`.

What the frames show (`it2-paris-mid-pair.jpg`, `it2-paris-zoom.jpg`,
`it2-nyc-zoom.jpg`, `it2-tokyo-mid-pair.jpg`, `it2-phoenix-mid-pair.jpg`):
Paris's far ring is cream and grey with shaded walls, no white carpet and no
colour step at the Seine; Manhattan's far ring is grey-blue towers, no salmon
or pink confetti; Tokyo continues the near ring's tone; Phoenix shows no ring
edge (its brighter lower rows are the near ring, stream A's heights and LOOK's
roofs, not stand-ins).

Still open (said plainly): the Manhattan avenue grid does not read in the far
ring at nyc-mid. The avenues run nearly along the view (heading 25 against
the grid's 29) and 50 to 200 m boxes at a 17 degree look-down cover them, as
real towers would; the control shows them because the photo is draped flat.
The canyon darkening helps the cross streets, not the avenues. Paris's far
ring is still about 3 luma brighter and 5 chroma greyer than the photo, and
its fine contrast (hf) is higher than a flat photo's, as any 3D city's is.
LOOK on, the far colour is `colourOf(..., 'far')` until LOOK's function lands;
the combined look of both distance terms is unmeasured.

### 2. Triangle cap (every pass)

Finding: near water the coastal reflection drew the stand-ins a second time;
the cap counted only the main pass (nyc-bay 2.00 M, paris-mid 1.60 M,
tokyo-bay 1.56 M at Ultra against 1.5 M; High up to 1.00 M against 0.8 M).

What changed: `SatSkylineLayer` passes the reflection's state
(`runtime.coastalReflection`); `_updateStandInCounts` adds the reflection's
own count (its focal length from the target height, `reflectionPxK` x minPx)
to the sum the budget search drives, so minPx rises until main plus
reflection fits. `reflectionPxK` 2 to 4 (the water's roughness blurs a
sub-4 px box away). The per-tile backstop `maxPerTile` 6,000 to 9,000, so the
only thing that drops a building is its screen size (the minPx threshold is
uniform in pixels across groups). Probe: `scripts/wp-reach-verify-budget.cjs`
(the verifier's, kept): it wraps each stand-in mesh's onBeforeRender and sums
instanceCount x 6 per render target over 90 frames.

| pose (four flags) | main | reflection | all passes, max frame | minPx | cap |
|---|---|---|---|---|---|
| nyc-bay Ultra | 1,353,552 | 88,650 | 1,442,202 | 1.16 | 1.5 M |
| paris-mid Ultra | 1,023,024 | 142,512 | 1,165,536 | 0.88 | 1.5 M |
| tokyo-bay Ultra | 1,258,902 | 64,578 | 1,323,480 | 0.82 | 1.5 M |
| hongkong Ultra | 187,506 | 101,664 | 289,170 | 0.80 | 1.5 M |
| sf-hills Ultra | 831,864 | 14,790 | 846,654 | 0.80 | 1.5 M |
| nyc-low Ultra | 1,159,806 | 71,130 | 1,230,936 | 1.25 | 1.5 M |
| nyc-bay High | 754,146 | 27,150 | 781,296 | 2.78 | 0.8 M |
| paris-mid High | 716,130 | 2,358 | 718,488 | 2.21 | 0.8 M |
| nyc-low High | 603,270 | 21,846 | 625,116 | 2.68 | 0.8 M |

JSON: `r2/reach/budget/verify-budget-all4-{ultra,high}.json`. REACH alone at
nyc-bay (smoke run): 1,451,856. Not measured: the High rows sit below the cap
with the hysteresis' 10 % headroom, so they are not proof the cap would bind
exactly at High.

### 3. Arrival

Finding: the far ring arrived later than the old mass (nyc-low full ring 33.2
against 26.0 s; the verifier +0.7 to +8.4 s first, +1.6 to +14.1 s full).

Cause (node, `node scripts/wp-reach-node-bench.mjs --time`, worker ms per
tile, recorded inputs, median of 3, sum of the 20 recorded tiles): base 535,
reach 680, the other three streams with the old mass 969, all four 1,002. Most
of the four-flag cost is stream A's truth table (a CPU profile of the Hong Kong
tile: `truthTable` and `geom.test`/`pointInPoly` lead; `buildSatStandIns`
itself about 30 ms of 160). The far ring is one worker building 384 tiles in
turn, so the ring pays about 1.9 x in worker time.

What changed: with the stream on, `SatSkylineLayer` gives the engine a pool of
`workers` 3 skyline workers (least-loaded dispatch, `P.concurrent` x 3 in
flight); the lattice drape and the heal run inside stream B's ground-query
batch (a no-op unless ARRIVAL's fastQuery is armed). The ground photo is
awaited only after the admission work and never more than 1.5 s from its
first request.

Interleaved A/B (`world-pass-budget.cjs`, one page warped pose to pose, first
pose cold; off, four, off, four; JSON `r2/reach/arrival/`), horizon first /
full seconds:

| pose | off run 1 | four flags run 1 | off run 2 | four flags run 2 |
|---|---|---|---|---|
| nyc-low (cold) | 8.9 / 26.0 | 6.9 / 25.9 | 9.4 / 27.8 | 8.5 / 28.5 |
| paris-mid | 5.2 / 12.2 | 4.6 / 8.4 | 4.1 / 12.5 | 4.8 / 8.4 |
| nyc-bay | 2.9 / 11.1 | 2.6 / 5.5 | 3.1 / 10.0 | 2.7 / 6.7 |
| hongkong | 3.8 / 10.1 | 3.7 / 4.9 | 3.5 / 6.8 | 3.9 / 5.8 |
| tokyo-bay | 2.5 / never | 3.2 / 16.3 | 2.7 / never | 2.3 / 13.2 |

Full ring: earlier or equal at every warm pose (by 3 to 6 s); at the cold
nyc-low equal within noise (-0.1 s and +0.7 s). First group: earlier or equal
in 7 of 10 pairs; later by 0.7 s (tokyo-bay run 1), 0.7 s (paris-mid run 2
against run 2's off) and 0.4 s (hongkong run 2). Two runs on a shared machine
cannot separate differences under a second: "no later" holds for the full
ring, and the first group is equal within that noise, not proven earlier.

### 4. Ground

Finding: stand-ins draped on a 300 m lattice: paris-mid p95 15.7 m, max 67 m;
Hong Kong p95 20.1 m; Owens Valley p95 274 m on the Sierra slopes.

What changed: `_refineStandIns` (engine), inside stream B's ground-query batch,
1.5 ms a frame: each stand-in gets its own `getGroundAt` on the drawn terrain
mesh, nearest group first and the size-sorted drawn prefix first; within
`drape.cornerM` 3,000 m of the camera the four box corners are queried too and
the lowest wins (no daylight under the downhill wall). A group is re-swept
every 4 s so a refined terrain tile re-seats its buildings; the lattice heal
never overwrites a building's own answer; uploads are update ranges.

Measured (four flags, 20 s dwell after settle, `verify-budget-all4-ultra.json`):
centre error against the drawn mesh p50 0 / p95 0 to 0.2 / p99 0 to 3.1 m at
all six poses (max 42 m at paris-mid, 11 m Hong Kong). That centre number is
close to true by construction (the same query, minus any terrain refined in
the last 4 s), so the independent check is the box corners: the wall bottom
(base - 6 m sink) over the lowest corner's ground. p95 -5.5 to -2.5 m (buried
below grade everywhere at p95); corners floating more than 1 m: nyc-bay 3 of
3,785, paris-mid 2 of 3,679, tokyo-bay 1 of 3,157, hongkong 19 of 2,457,
sf-hills 9 of 3,139, nyc-low 3 of 3,918; the worst float 14.6 to 64.2 m
(sf-hills; a box beyond the 3 km corner radius on a steep street). Boxes whose
highest corner's ground is over the roof (buried on the uphill side): 1 to 15
a pose. Not measured: Owens Valley (no pose this round), and stand-ins past
the drawn prefix (they are not drawn).

### 5. Stability (minPx)

Finding: on an NYC cruise minPx breathed between 0.80 and 1.48 (round 1).

What changed: hysteresis on the budget factor (`hysteresis` in the block): it
rises the frame the total passes the cap (never over the cap for a frame), to
a fit with 10 % headroom; it falls only when a 1.25 x lower factor would still
fill under 75 % of the cap, over 4 s; between the two it holds.

Motion burst (`scripts/wp-reach-verify-motion.cjs`, straight 15 km at 500 m,
cruise; `r2/reach/motion/*/probe.json`), during the flight only:

| run | minPx range | direction reversals (steps > 0.02) | pops (added already over the half-fade) |
|---|---|---|---|
| REACH, nyc-cruise-500 | 1.64 to 2.26 | 1 | 0 of 138,798 |
| four flags, nyc-cruise-500 | 1.66 to 2.30 | 1 | 63 of 142,860 (max 3.5 px; the examples sit 0.01 px over the threshold at 2.5 km) |
| four flags, paris-boost-500 | 0.82 to 1.10 | 1 | 0 of 24,880 |

minPx now moves once each way: up while the ring arrives, then down slowly as
the detail ring covers the near groups. It sits higher than round 1 at
Midtown because the reflection now counts. The 63 four-flag pops are
attributed to the covered radius stepping (the probe excludes stand-ins
inside it, so a radius drop re-counts close ones), not shown to be visible.

### 6. Near-edge at boost

Finding: near the player at boost the stand-ins read as crude dark blocks.

What changed: the far material's facade detail (`uArchitectureDetail`, a
uniform 0 for the distant material) is redefined in the stand-in program as a
per-vertex ramp: 1 within `nearDetail.fullM` 1,200 m, 0 past 2,600 m. A
stand-in close to the camera wears windows, floor bands and relief like the
near ring. Frames: `r2/reach/motion/strip-boost-all4-left-control-right.jpg`.
Not proven: there is no pinned same-frame A/B against round 1 (the boost
frames land at different moments), and no speed-aware distance was added. The
owner's motion check is the read.

### 7. Stream off: nothing per frame

`SatSkylineLayer` now calls `setStandInView` only when `engine.standInsOn`
(the latched flag): with the stream off the frame loop does one boolean read
and nothing else (no tan, no call). One worker, as before.

### 8. tokyo-bay

Cause: every lattice sample of three groups answers from a drawn terrain tile
coarser than `demZ` 10 (flat bay and reclaimed land never refine), so
`fillSkylineGrid` fails and the group restarts forever (both arms, about 310
restarts). Fix (stream on only; the old mass is untouched): a finite coarse
answer is kept aside; after `drape.coarseAfterSec` 6 s an all-coarse lattice is
accepted at zoom 1 (it is what the terrain draws there, rule 4), and the heal
and per-building drape re-seat it when a finer tile arrives. Measured: the
four-flag full ring at tokyo-bay 16.3 and 13.2 s; off never completes in
either run.

### 9. Verifier scripts

Committed: `scripts/wp-reach-verify-budget.cjs` (now also records console
shader errors, the box-corner float metric, the budget state and `--dwell`),
`-motion.cjs`, `-tier.cjs`. New: `wp-reach-colour-stats.cjs`,
`wp-reach-pair.cjs`, `wp-reach-zoom.cjs`, `wp-reach-strip.cjs`, and
`wp-reach-node-bench.mjs --time`.

### Proofs at the round-2 commit

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`
  at `4f4fe71b`: "IDENTICAL (top-level protocol field masked): 1062/1062 cases
  identical, 7308 buffers + 1062 meta objects compared against 'c2bf5c06'; 28
  stage cases (0 bad); 0 unrecorded inputs; 163.4 s".
- Node gates: `graphics-unit.mjs`, `verify-true-earth-flags` (11/11),
  `verify-stylized-earth` (22/22), `verify-city-horizon`,
  `verify-building-handoff`, `verify-attribution` (4/4),
  `wp-reach-node-bench.mjs` (G1-G5; the gate request uses worker defaults, so
  photo, inset and sliver are off in it).
- eslint on the changed files: the one pre-existing
  `SatSkylineLayer.jsx` react-hooks/immutability error, nothing new.
- No browser shader error on any run (`errors: []` in every probe JSON).

### Seams and shared files

None edited. Uses stream B's exported `beginGroundBatch` / `endGroundBatch`
(no edit); LOOK's far colour through the adapter (no edit).

### Open after round 2

- Manhattan's avenue grid in the far ring (see 1).
- `houseMaxAreaM2` stays 220: TRUTH's far height now equals the near model
  for stand-ins, so 0 would add Paris's and Tokyo's small-parcel fabric, at a
  budget cost (minPx would rise) that was not measured this round.
- LOOK's `lookFarColour` and `lookFarPrepare` (merge step; then decide
  `farLook.desaturate`).
- Owens Valley ground (no pose), the 3 km corner radius on steep cities
  (sf-hills worst float 64 m beyond it), the near-edge A/B and the owner's
  5080 motion check.
- The worker pool is three skyline workers on top of ARRIVAL's two building
  workers; CPU contention on a smaller desktop is unmeasured.

## Round 2b (the verifier's three blocking items)

2026-11-17, implementer, second fix round. The verifier's round-2 verdict
named three blocking items: arrival with `WORLD_REACH` alone, arrival with all
four flags, and the street pattern at 1,500 m. This section covers only those
three, plus what their fixes had to touch. Everything in "Round 2" that passed
was left as it was.

- `WORLD_REACH` still ships `enabled:false`.
- The worker never reads a flag.
- With the stream off the engine constructs nothing new and runs nothing new
  per frame. The photo store, its worker, the atlas and the gate exist only
  while `_reach` is latched on.

Venue: this machine's RTX 5080, installed Chrome, D3D11, dev server :3323 on
this worktree, Ultra, 1600 x 900, noon + 2 h, the live world. Other streams
were capturing the whole time (GPU slot waits of 3 to 6 minutes). So every
arrival number below comes from same-session interleaved runs, and every
control frame was shot in the same session from the same server. Frames and
JSON are in `.graphics-review/world-pass/r2/reach/r2b/` in the main checkout:
- `final-control/` and `final-control2/` (flags off, shot twice, for the noise
  ceiling);
- `final-reach/` (`WORLD_REACH`) and `final-all4/` (all four flags);
- `final-*-4arm.jpg` crops (control / round 2 / REACH / four flags);
- `arrival2/`, `arrival3/`, `budget/`, `motion/`;
- `it1`..`it7` (the iteration frames) and `arrival-early/`, `arrival-h/` (the
  diagnosis; each has a README).

### B1. Arrival with WORLD_REACH alone

Finding (verifier): with REACH alone, every warm pair was later than the old
world: far first group +0.1 to +3.4 s, far full ring +0.4 to +4.5 s, near
ring full ring +1.6 to +11.2 s.

Causes, measured one at a time:
1. **Network share.** Round 2 gave the three-worker pool three times the
   shipped in-flight cap (24 OpenFreeMap tiles in flight against the old
   mass's 8), so the far ring took bandwidth from the near ring. Fix: the pool
   keeps the shipped cap (`CITY_HORIZON` `concurrent`, 8), so it adds CPU and
   no network share. After that alone, the near ring was level with the old
   world (`arrival-early/` runs 1 to 3: near full ring within -1.2 to +0.7 s
   at the warm poses).
2. **The photo on the build path.** Every tile build fetched and awaited its
   ground photo (up to 1.5 s) after its own vector tile. The round-2 budget
   probe summed 35,951 ms of `photoWaitMs` over one nyc-bay ring. Each of the
   three workers also fetched and decoded the same photo with its own latch.
   - A first fix (fetch on the main thread when a group enters the ring,
     never awaited) still competed for the network. paris-mid far full ring
     15.6 s against 11.1 s (`arrival-early` 2-reach / 1-off).
   - The same build with photos off: far full ring -0.5 / -3.5 / -1.2 s
     against flags off (`arrival-h`, one pair).
3. **Photos beside the arriving world.** With photos loaded only while the far
   ring was idle (`arrival2`), London's near ring was still later in 2 of 3
   pairs (+3.3 and +4.8 s), while photos loaded beside it.

What changed:
- **No photo on any build path.** The worker no longer fetches. A main-thread
  store (`lib/fly/toy-world/sat-stand-in-photo.js`) with its own small worker
  (`sat-stand-in-photo.worker.js`) does the fetch, decode and de-lighting.
  Photos load only when:
  - the far ring is idle (nothing queued, in flight or waiting to finalize);
  - the near buildings and the terrain have settled (`setPhotoGate`, from
    SatSkylineLayer);
  - one group at a time, nearest first, at low fetch priority.
- **Fade in.** A photo that lands fades in over `photo.fadeSec` 2.5 s, through
  a per-slot weight (`uStandInPhotoK`). The per-building colour it was born
  with is kept, so nothing pops. A group that comes back with its photo cached
  is born with it.
- **One page-wide store.** This replaces round 2's per-worker latch, which let
  a rebuilt tile change colour, and the unbounded `PHOTO_LATCH`. The store is
  an LRU of `maxCached` 40 decoded photos.
- **Main-thread cost:** at most 0.3 ms per photo (one `data.set` into the
  atlas layer). The first version decoded on the main thread at 19 ms (z12)
  and 208 ms (z13), so decoding moved to the worker.
- Esri requests are still about 4 per group, 2 x 2 z13 tiles for the street
  pattern below (B3). They now come after the world has settled, not during
  arrival.

Measured, `arrival2`: the code before the gate, interleaved off / reach / all4
/ reach / off / all4 / all4 / off / reach. Per pose: seconds from the warp,
three runs per arm.

| pose | metric | off | REACH | four flags |
|---|---|---|---|---|
| nyc-low | far first | 24.3 / 7.7 / 32.4 (med 24.3) | 28.4 / 7.5 / 25.8 (med 25.8) | 7.7 / 7.5 / 8.7 (med 7.7) |
| nyc-low | far full | 28.8 / 25 / 39.6 (med 28.8) | 39.5 / 25.3 / 35.8 (med 35.8) | 25.7 / 26.7 / 25.8 (med 25.8) |
| nyc-low | near first | 29 / 25.1 / 38.7 (med 29) | 39.2 / 22.4 / 32.1 (med 32.1) | 24.2 / 23.8 / 24.5 (med 24.2) |
| nyc-low | near full | 41.8 / 39.9 / 60.8 (med 41.8) | 59.7 / 36.1 / 55.2 (med 55.2) | 25.4 / 25 / 25.4 (med 25.4) |
| paris-mid | far first | 4.4 / 5.2 / 4 (med 4.4) | 4.3 / 4.1 / 4.4 (med 4.3) | 4.1 / 4.5 / 4.6 (med 4.5) |
| paris-mid | far full | 10.4 / 13.9 / 13 (med 13) | 10.6 / 9.4 / 12.1 (med 10.6) | 8.7 / 10.4 / 10 (med 10) |
| paris-mid | near first | 7.2 / 9.3 / 8.6 (med 8.6) | 6.8 / 5.8 / 7.6 (med 6.8) | 4.3 / 4.6 / 4.8 (med 4.6) |
| paris-mid | near full | 20.9 / 28.5 / 31.5 (med 28.5) | 22.2 / 20.1 / 27 (med 22.2) | 11 / 11.8 / 13.1 (med 11.8) |
| nyc-bay | far first | 3.4 / 2.7 / 3.2 (med 3.2) | 3 / 2.7 / 2.9 (med 2.9) | 2.7 / 1.7 / 2.7 (med 2.7) |
| nyc-bay | far full | 11.5 / 10.1 / 11.2 (med 11.2) | 9.2 / 10.5 / 9.8 (med 9.8) | 8.3 / 6.6 / 6.7 (med 6.7) |
| nyc-bay | near first | 4.1 / 3.9 / 3.8 (med 3.9) | 4.3 / 3.7 / 3.8 (med 3.8) | 2.6 / 1.9 / 2.7 (med 2.6) |
| nyc-bay | near full | 16.4 / 16.4 / 18.9 (med 16.4) | 15.1 / 15.7 / 17 (med 15.7) | 7.6 / 5.5 / 5.2 (med 5.5) |
| london | far first | 3.1 / 2.8 / 3.6 (med 3.1) | 3.7 / 3.5 / 3 (med 3.5) | 3.1 / 4.1 / 3.4 (med 3.4) |
| london | far full | 9.4 / 8.8 / 9.8 (med 9.4) | 10.6 / 9.1 / 9.8 (med 9.8) | 6.1 / 8.4 / 6.6 (med 6.6) |
| london | near first | 5.9 / 5.4 / 5.5 (med 5.5) | 6.6 / 6.5 / 4.6 (med 6.5) | 3.1 / 4.1 / 3.4 (med 3.4) |
| london | near full | 16.7 / 15.3 / 19.7 (med 16.7) | 20 / 15.8 / 24.5 (med 20) | 7.2 / 9.8 / 8.6 (med 8.6) |

The REACH column of `arrival2` is the code without the settle gate.
`arrival3` is the shipped code, interleaved off / reach / off / reach / all4 /
off / reach:

| pose | metric | off | REACH | four flags |
|---|---|---|---|---|
| nyc-low | far first | 26.6 / 27.9 / 30.8 (med 27.9) | 31.1 / 27.6 / 25.9 (med 27.6) | 7.7 |
| nyc-low | far full | 33.6 / 35.3 / 37.1 (med 35.3) | 41.2 / 36.9 / 35.3 (med 36.9) | 23.9 |
| nyc-low | near first | 27.5 / 29.3 / 35 (med 29.3) | 37.6 / 37.6 / 34.8 (med 37.6) | 21.5 |
| nyc-low | near full | 56.1 / 57.6 / 54.2 (med 56.1) | 65.4 / 59 / 54.6 (med 59) | 22.5 |
| paris-mid | far first | 4.2 / 4.5 / 3.2 (med 4.2) | 4.7 / 3.9 / 4.5 (med 4.5) | 4.5 |
| paris-mid | far full | 14.6 / 14.4 / 10.9 (med 14.4) | 14.7 / 13.3 / 12.6 (med 13.3) | 9.7 |
| paris-mid | near first | 7.8 / 8.3 / 6.2 (med 7.8) | 9.6 / 9.6 / 9.4 (med 9.6) | 4.4 |
| paris-mid | near full | 31.7 / 34.1 / 23.2 (med 31.7) | 32.9 / 32.9 / 26.5 (med 32.9) | 11.3 |
| nyc-bay | far first | 3.2 / 3.1 / 2.9 (med 3.1) | 4.1 / 2.9 / 2.8 (med 2.9) | 2 |
| nyc-bay | far full | 13.1 / 12.3 / 11.4 (med 12.3) | 12.3 / 10.4 / 10.3 (med 10.4) | 7 |
| nyc-bay | near first | 4.3 / 3.8 / 4.3 (med 4.3) | 4.3 / 3.5 / 3.7 (med 3.7) | 2 |
| nyc-bay | near full | 22.1 / 19.1 / 19.2 (med 19.2) | 21.1 / 18.6 / 19.1 (med 19.1) | 5.7 |
| london | far first | 3.7 / 4.1 / 3 (med 3.7) | 3.4 / 5 / 3.3 (med 3.4) | 2.7 |
| london | far full | 12.2 / 13.8 / 10.4 (med 12.2) | 12.9 / 12 / 11 (med 12) | 7.1 |
| london | near first | 8 / 6.7 / 5.7 (med 6.7) | 6 / 7.4 / 7.5 (med 7.4) | 2.7 |
| london | near full | 24.6 / 24.5 / 20.1 (med 24.5) | 22.9 / 22.1 / 25.7 (med 22.9) | 8.9 |

How to read it:
- `arrival3` ran on a much busier machine than `arrival2`: paris-mid's off
  near full ring was 23 to 34 s, against 21 to 32 s.
- Its 6-off run was the fastest off run of the session (paris near full 23.2
  against 31.7 / 34.1), so the pairs against it lean late.

Result, medians, REACH against off:
- Far first group, warm poses:
  - `arrival3`: paris 4.5 vs 4.2, nyc-bay 2.9 vs 3.1, london 3.4 vs 3.7;
  - `arrival2`: paris 4.3 vs 4.4, nyc-bay 2.9 vs 3.2, london 3.5 vs 3.1.
- Far full ring, warm poses:
  - `arrival3`: 13.3 vs 14.4, 10.4 vs 12.3, 12.0 vs 12.2;
  - `arrival2`: 10.6 vs 13.0, 9.8 vs 11.2, 9.8 vs 9.4.
- Near ring full ring:
  - `arrival3`: paris 32.9 vs 31.7, nyc-bay 19.1 vs 19.2, london 22.9 vs
    24.5;
  - `arrival2` (no gate): 22.2 vs 28.5, 15.7 vs 16.4, 20.0 vs 16.7.

Still later:
- Near ring FIRST tile at paris-mid in `arrival3`: 9.6 / 9.6 / 9.4 against
  7.8 / 8.3 / 6.2. In `arrival2` it was earlier: 6.8 / 5.8 / 7.6 against
  7.2 / 9.3 / 8.6.
- So under heavy CPU load the stand-in builds, which cost about 1.4 x the old
  mass's worker time (`--time`: reach 769 to 938 ms against 549 to 654 ms
  over the 20 recorded tiles), slow the single near-ring building worker.
- Adjacent pairs later by more than 0.5 s: 28 of 72 warm metrics in
  `arrival3` (listed in `arrival3-summary.txt`). Most are against the fast
  6-off run, and most are near-ring metrics.
- "No later than the old world" therefore holds at the median for the far ring
  at every warm pose in both sessions, except paris far first +0.3 s
  (`arrival3`) and london +0.4 s (`arrival2`), both inside the off arm's
  own spread. It is NOT shown for the near ring's first tile under load.

Cold nyc-low (first pose after boot) is bimodal in every arm:
- off far first group 24.3 / 7.7 / 32.4 s;
- verifier off runs 7.3 to 27.4 s.
In the bad mode the whole world is late, near ring included. One run per arm
cannot separate a difference there, so it is reported and not claimed.

### B2. Arrival with all four flags

Finding (verifier): with all four flags the full ring was earlier at warm
poses, but the first group was later by 0.1 to 0.9 s in most warm pairs. Cold
nyc-low was later in 3 of 4 pairs.

The B1 changes apply unchanged with all four flags on:
- the photo is off the build path;
- the pool keeps the shipped in-flight cap.

`arrival2` four-flag arm, three runs:
- Far first group, warm poses:
  - paris-mid 4.1 / 4.5 / 4.6 against off 4.4 / 5.2 / 4.0;
  - nyc-bay 2.7 / 1.7 / 2.7 against 3.4 / 2.7 / 3.2;
  - london 3.1 / 4.1 / 3.4 against 3.1 / 2.8 / 3.6.
- Far full ring is earlier at every warm pose (medians: paris 10.0 against
  13.0, nyc-bay 6.7 against 11.2, london 6.6 against 9.4).
- Near full ring is earlier everywhere (stream B's work).
- Adjacent pairs later by more than 0.5 s: 2 of 27 warm metrics.
  - London far first +1.3 s (6-all4 / 5-off).
  - Paris far first +0.6 s (7-all4 / 8-off).
- Cold nyc-low far first group 7.7 / 7.5 / 8.7 against off 24.3 / 7.7 /
  32.4 s, so no later in any run.
- First content is no later at the median at every pose but London (+0.3 s
  median, inside the 0.3 to 0.8 s spread of the off runs alone).

`arrival3` four-flag run (one, on the loaded machine):
- far first group / full ring: paris 4.5 / 9.7, nyc-bay 2.0 / 7.0, london
  2.7 / 7.1;
- off medians: paris 4.2 / 14.4, nyc-bay 3.1 / 12.3, london 3.7 / 12.2;
- cold nyc-low: 7.7 / 23.9 against off 27.9 / 35.3.

### B3. Street pattern at 1,500 m

Finding (verifier): beyond the near ring, Paris's boulevards and Manhattan's
avenue grid disappear into a uniform granular fabric. The control shows both.

What it was, measured in node (`scripts/wp-reach-node-bench.mjs --streets`,
recorded tiles, 5 x 5 samples per box):
- Boxes covered almost none of the street: 0.33 % of box samples sat on an
  OpenFreeMap street corridor.
- The fabric was not spill. It was the picture:
  - every 2 to 10 px box drew a lit roof and two walls of similar tone in its
    palette colour;
  - the 1.5 m inset opened a fake street between every pair of parcels in a
    block, so the block hierarchy was gone;
  - at a 15 to 25 degree look-down, walls are about five times the screen
    area of roofs.
- The control reads its streets from the flat photograph.

What changed:
- **The photograph per fragment.** Each resident group's photo goes into a
  GPU array texture (`createPhotoAtlas`: 40 layers of 512 x 512 sRGB, 40 MiB
  of texture, not geometry). The photo is the group tile's 2 x 2 z13 children,
  about 12 m a pixel in Paris; z12 at 25 m a pixel was tried first (`it4`) and
  the boulevards stayed faint.
  - The stand-in vertex shader finds where the view ray through each vertex
    meets that building's ground. The fragment takes the photo there, the
    picture the flat ground would show.
  - Below `photoFullH` 45 m (none above `photoZeroH` 90 m), and from
    `fromM` 1,200 to `toM` 4,500 m, the albedo is pulled to that colour (roofs
    0.9, walls 0.85).
  - The stand-in is lit like the ground (normal toward up, by `photoFlat`
    0.8), so the photo's streets, trees and boulevards read through the boxes.
  - Towers keep their own walls and colour, and the silhouettes and heights
    are unchanged.
  - Program key `|wp-reach-standin-v3`. It still compiles once.
- **Blocks read as blocks.** `insetM` 0 and `sliverM` 0, so party walls touch
  again. In their place, a street-corridor rule in the worker (`streetRaster`,
  512 cells a tile, class half-widths 4 to 12 m, narrower than the street
  between facades) shrinks a box that crosses a corridor about its centre,
  never below 0.55, never dropping it. Boxes sit on the footprint's area
  centroid (`centroid` 1).
  - Node, 33,217 stand-ins: spill outside the own footprint 10.29 % -> 7.27 %.
  - On-street samples 0.57 % -> 0.14 %. This second number is low partly by
    construction, since the rule tests the same raster.
  - No stand-in is dropped by the rule (the count is identical).
- **Wall and look terms** (`farLook`): `fromM` 1500 -> 1200, `toM` 7000 ->
  4500, `wallGain` 0.75 -> 0.55, `roofGain` 0.85 -> 1, `canyon` 0.45 -> 0.35 at
  `canyonFrac` 0.85. The canyon and the darker walls now apply only where the
  stand-in is not flattened.

Measured:
- Street-pattern score (`scripts/wp-reach-structure.cjs`): Pearson
  correlation of band-passed luma (box blur r1 1 minus r2 6) against the
  same-session control, over the ground left and right of the aircraft
  (x 0-660 and 940-1600, y 480-760).
- The noise ceiling is a second control shot later in the same session:
  0.966 to 0.996.

| pose | control2 | REACH | four flags |
|---|---|---|---|
| nyc-mid | 0.989 / 0.977 | 0.635 / 0.764 | 0.642 / 0.570 |
| paris-mid | 0.995 / 0.989 | 0.669 / 0.713 | 0.593 / 0.545 |
| tokyo-mid | 0.971 / 0.967 | 0.873 / 0.844 | 0.584 / 0.563 |
| phoenix-mid | 0.996 / 0.988 | 0.959 / 0.960 | 0.274 / 0.429 |
| nyc-bay | 0.990 / 0.992 | 0.819 / 0.951 | 0.624 / 0.523 |

Before and after against a same-session control (`ctl1`, rect
300-1300 x 540-720):
- Round-2 look (`it1`): Paris 0.490, Manhattan 0.609.
- Shipped look (`it7`): Paris 0.740, Manhattan 0.745.
- Left rect (0-600 x 470-700): Paris 0.225 -> 0.510.

The four-flag column cannot isolate this stream: the rectangle includes the
near ring, which streams A, B and D change, so it falls even where the far
ring is untouched (phoenix-mid).

Crops:
- `final-paris-far-4arm.jpg` and `final-nyc-far-4arm.jpg` (rows: control /
  round 2 / REACH / four flags).
- The boulevards beyond the Seine and Manhattan's avenues and cross streets
  are lines again in the REACH row.
- Paris with four flags is paler and the boulevards fainter: LOOK's far colour
  and stream A's heights act on the same stand-ins, and the combined look of
  the two distance terms (REACH's and LOOK's `photoPull` / `desat`) is still
  the integrator's (round-2 note).

Far-band colour (`wp-reach-colour-stats.cjs`, x 500-1100, y 470-560,
same-session control):
- Luma within 2 of the control at 6 of 9 poses for REACH. tokyo-mid -3.7,
  tokyo-bay -6.2, phoenix-mid -5.6.
- Chroma within 4.3, except tokyo-bay (+6.9).
- Confetti (chf) 3.3 / 3.7 / 3.8 against 3.3 / 3.6 / 2.6 (nyc-mid / nyc-bay /
  paris-mid).

### Not regressed (re-measured at `df3915bf`, four flags, Ultra)

- **Triangle cap, all passes** (`budget/`, `wp-reach-verify-budget.cjs`,
  20 s dwell). Max frame against the 1.5 M cap:

  | pose | max frame | minPx |
  |---|---|---|
  | nyc-bay | 1,449,606 | 1.16 |
  | paris-mid | 1,170,684 | 0.88 |
  | hongkong | 289,698 | 0.80 |
  | sf-hills | 850,638 | 0.80 |

- **Ground** (centre p95 / p99 / max, m; corners floating over 1 m):

  | pose | p95 / p99 / max | floating corners |
  |---|---|---|
  | nyc-bay | 0 / 0.2 / 2 | 6 of 3,779 |
  | paris-mid | 0 / 0.3 / 41 | 6 of 3,676 |
  | hongkong | 0 / 3.3 / 12.2 | 25 of 2,459 |
  | sf-hills | 0.2 / 2 / 7 | 11 of 3,143 |

  The worst sf-hills corner gap is 152 m (one box beyond the 3 km corner
  radius; open, as in round 2).
- **Stability** (`motion/all4`, nyc-cruise-500): minPx 0.80 to 2.37 with one
  direction reversal over the run, as in round 2. 98 additions over the
  half-fade of 175,276, max 3.7 px.
- No page or shader error in any capture, probe or arrival run.

### Proofs at the round-2b commit

At `5a112e18` (the shipped code):
- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06
  --ignore-protocol`: "IDENTICAL (top-level protocol field masked):
  1062/1062 cases identical, 7308 buffers + 1062 meta objects compared against
  'c2bf5c06'; 28 stage cases (0 bad); 0 unrecorded inputs; 175.8 s".
- Node gates:
  - `graphics-unit.mjs` PASS;
  - `verify-true-earth-flags` 11/11;
  - `verify-stylized-earth` 22/22;
  - `verify-city-horizon` PASS;
  - `verify-building-handoff` 4/4;
  - `verify-attribution` 4/4;
  - `wp-reach-node-bench.mjs` G1 to G5 (`--streets` and `--time` as
    above).
- eslint on every changed file: only the pre-existing `SatSkylineLayer.jsx`
  react-hooks/immutability error.
- `WORKER_PROTOCOL` unchanged.
- The frames in `final-*` were shot at `df3915bf`. The gate commit after it
  changes only WHEN photos load, not how the far ring looks once they have.
  The `arrival3` REACH runs show all 24 groups' photos loaded and faded in
  by the measurement at every pose (settle + 3 s).

### Shared files and seams

No other stream's file edited. New stream-C files:
- `lib/fly/toy-world/sat-stand-in-photo.js` (store, gate use, GPU atlas);
- `sat-stand-in-photo-core.js` (pure: albedo, per-building mean, fetch);
- `sat-stand-in-photo.worker.js` (fetch and decode off the main thread);
- `scripts/wp-reach-structure.cjs` (the street-pattern score).

Changed:
- the worker builder, the engine, the stand-in material and SatSkylineLayer
  (`setPhotoGate`);
- the REACH block in `fly-constants.js`;
- `scripts/wp-reach-node-bench.mjs` (`--streets`).

### Open after round 2b

- **Near-ring first tile under heavy CPU load (B1, not closed).** Paris near
  first tile was 9.6 / 9.6 / 9.4 s with REACH against 7.8 / 8.3 / 6.2 s off in
  the loaded session; in the lighter session it was earlier. What would close
  it: cut the stand-in build's CPU (it is about 1.4 x the old mass's; the
  per-building oriented box, style and colour calls dominate). Or hold the far
  pool to one worker until the near ring's first tile after a warp, and prove
  it does not move the far first group. Not done this round.
- LOOK integration is the integrator's. `farLookColour` still calls
  `colourOf(..., 'far')`. The per-fragment photo pull and LOOK's own
  `photoPull` / `desat` stack, and the combined look is not tuned. In the
  four-flag Paris frame the far ring is paler and the boulevards fainter than
  with REACH alone.
- **The photos arrive after the world.** By design (B1), the street pattern
  fades in a few seconds after the city has settled (one group at a time,
  about 0.3 to 1 s a group). The time to the last group is not measured.
  Before the photo lands, a group shows round 2's palette look.
- About 4 Esri z13 requests per group.
- 40 MiB of texture for the atlas; not in the 256 MiB geometry row.
- Cold nyc-low arrival is bimodal in every arm. Not separable with these runs.
- Boost minPx jump, corner floats on steep cities, Owens Valley, the 3 km
  corner radius, and the owner's 5080 motion check: as listed in round 2,
  unchanged.

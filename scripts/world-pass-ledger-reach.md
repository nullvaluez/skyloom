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

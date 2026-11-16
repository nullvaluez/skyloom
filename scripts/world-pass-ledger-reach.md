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

(the browser tables are below in "Browser measurements")

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

## Open

(see the bottom of this file, kept current)

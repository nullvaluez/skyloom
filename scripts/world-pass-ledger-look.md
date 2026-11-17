# World Pass ledger: stream D LOOK (`WORLD_LOOK`)

Branch `world/look`, worktree `.claude/worktrees/wp-look`, from W0 `ac26a77e`.
Flag `WORLD_LOOK` (ships `enabled:false`; `?flags=WORLD_LOOK` for one page load,
desktop High and Ultra only). Request field `worldPass.look`
(`roofPhoto`, `walls`, `structures`, `authority`, `worker`).

## Design

**Where the colour comes from today.** The worker bakes a vertex colour per
building from the family profile palette (`building-profiles.js`). By day the
shader replaces it: CITY_FACADES (`city-facades.js`) paints walls from one
region palette uniform and roofs from a five-tone hash, and LOOK_FACADE then
applies one global hue table and a per-building value. Nothing reads the photo.
So any worker-side evidence is invisible unless the shader stops replacing it:
the roof half of the authority has to land with M1, or M1 shows nothing.

**M1 roofPhoto.** A new worker module, `lib/fly/toy-world/worker/photo-sampler.js`.

- Fetch: when a `sat-buildings` tile is requested with `look.roofPhoto` in the
  request, the worker starts fetching the photo under it at once, in parallel
  with the vector tile: the 16 Esri World Imagery z16 tiles of the z14 tile and
  the one z11 tile r25-color-ref.js uses as its colour-balanced reference. Same
  URL as the terrain (`lib/fly/vendor/three-tile` ArcGIS source), read from the
  terrain's Cache API store (`TERRA_CACHE`, read only) and then the network
  (HTTP cache). Own semaphore (8 in flight per worker), 6 s fetch timeout,
  the 2,521-byte "map data not yet available" placeholder rejected.
- Never delays a tile beyond `waitMs` (2.5 s from the request), never drops one:
  at the deadline the worker builds with what arrived; the rest is aborted.
- Decided once: what arrived for a tile is LATCHED per worker (a bitmask of the
  sub-tiles and whether the reference came). A rebuild or heal of the same tile
  uses exactly those sub-tiles, so a building never changes colour on revisit
  because a photo tile came late the first time.
- Sampling (pure, `prepareRoofLook`): rasterise the footprint at pixel centres
  (scanline, holes even-odd), erode by `insetM` (1.2 m, about one z16 pixel),
  drop blown (any channel >= 0.97), vegetation (green over red and blue) and
  baked shadow (< 0.55 x the tile's median luma, or < 0.06). A read needs 5
  pixels and 35 % of the footprint. Colour = interquartile-luma mean in linear
  light (a robust median), times the r25 exposure ratio (z11 reference / mosaic
  low-pass, per 32 px cell, bilinear, clamped 0.5 to 2, per channel: the same
  correction the terrain gets, so roofs stay consistent with the ground around
  them), then de-lit to an albedo: chroma clamped to HSV saturation 0.5 and
  luma clamped to [0.035, 0.6] (so a sunlit Phoenix roof at sRGB 246 is not an
  albedo of 0.9 lit again by our sun). The terrain draws the same photo as its
  albedo, so the radiance-to-albedo gain is 1.
- Height guard: only roofs under 30 m read their own pixels (towers lean in the
  photo outside Manhattan, critique-realism 1.1). A taller roof does only when
  its footprint is at least twice as wide as it is tall (Madison Square
  Garden, malls), with an extra inset of 0.2 x its height.
- Fallbacks: structure mates' reads (M2), then the block median (a world
  anchored 128 Mercator-metre cell with at least 3 reads, then its 3 x 3), then
  the typology palette roof the worker already chose.
- Shader: `satellite-architecture-material.js` `applyWorldLook` captures the
  vertex colour before any pass (`wlBase`) and makes it CITY_FACADES' roof
  (`cityRoof=wlBase`); LOOK_FACADE's per-building roof value steps aside and
  its roof patches keep half their weight (`look-facade.js` `dayGLSL`, option
  `worldLook`). Parapets, penthouses and plant still take the facade a shade
  down (`citySide`). Read once per material from the latched reader
  (`worldLookShader()`), program key `|world-look-v1-...`: flag off, the
  program text and key are today's.

**M2 structures.** `relateStructures(items, tileCtx)` in
`sat-buildings/structures.js`, a port of FableFlight `relate()`
(`src/buildings.rs` 1388-1541, MIT): each footprint is a 10 x 10 grid of
inside points, shares by point-in-polygon, neighbours by a sort-and-sweep on
bounding boxes. Kept: twins (>= 85 % both ways, same base) become one (the
mapped, then the taller one stays); a mapped part >= 85 % inside a bigger mapped
volume spanning its heights is not drawn; union-find structures of parts that
overlap (>= 30 % of the smaller, area ratio >= 0.1, touching in height), rooted
at the biggest footprint on the ground, classified by the structure's TOP
(FableFlight `Rel.top`) so a tower on a podium reads as the tower. Not ported:
merging stacked slabs and trimming a lower slab (they change heights, stream
A's). Added: an outline covered >= 90 % by two or more of its own mapped parts
and no taller than them is not drawn; mapped parts that share an edge, a tag
colour and a height band (>= 20 m, within 1.6 x) are one structure (the
Shard's wedges are side by side in OpenFreeMap, not overlapping, so the
overlap rule alone never joins them).
- One look per structure: `colourOf` re-derives the `style` object (family,
  variant, seed, palette) from the root under the shared look id before any
  colour is read; the caller writes that same object into the vertices, so the
  shader's family and seed follow. Drape anchors and collision columns stay per
  part (no polygon moves, every kept item keeps its own id).
- Look id: `item.sid` when stream A sets it, else a cross-tile-stable id.
  OpenFreeMap merges same-property buildings into one multipolygon feature, so
  the feature id is not per building; a building cut by a seam is identified by
  the whole span it touches on the seam (world Mercator, 4 m quantum; the clip
  can lay several segments along one seam in either order, so the span, not the
  first segment). A building on no seam keeps `item.id`. The far ring
  (`colourOf(..., 'far')`) applies the seam id too.

**M3 walls and authority.** In `sat-buildings/colour.js` (`lookWall`), read
by the near ring (`colourOf(..., 'near')`) and the far ring (`'far'`) through
the same rule, so a building's wall does not change at the handover.

- The colour tag sets the wall material only (critique-realism 1.3: it is
  OpenMapTiles' building:material written as a colour; vs the photo roof r =
  0.03 / 0.23). Blue-cyan tags not too pale (`#5a81a0`, the Shard's `#8db2b9`,
  `#2f4350`) mean curtain glass; every other tag is an opaque wall in that
  colour, saturation clamped to 0.45 (Tokyo's `#ff0000` x 20 is symbology,
  not paint) and luma to [0.04, 0.65]. It never sets a roof.
- Untagged walls take the place's palette: a small offline region table (no
  keys) by tile centre: Paris (Haussmann limestone creams), London (stock brick,
  red brick, Portland stone, white stucco), Manhattan (limestone, buff and red
  brick, granite, white glazed brick; a shoreline test, not a box), Brooklyn
  (brownstone and brick), Japan (pale tile and concrete), Hong Kong, the US
  south-west (stucco in sand and cream), then the worker's own Natural Earth
  style (`living-regions.js`: europe, mediterranean, arid, east-asia, tropical,
  temperate). Within a region the typology group picks the list (houses and
  terraces, apartments, masonry, offices, industrial). Picks are block-coherent:
  a world-anchored 96 m cell draws once and a share of buildings (`block`:
  0.2 Manhattan, so Midtown keeps its variety; 0.75 Paris; 0.7 Phoenix) take
  that draw, the rest draw their own by look id; +-6 % value jitter by look id.
  In the arid tables the photo's lit ground pulls the hue 25 % toward the local
  earth (value kept). Decided once per building: every input is the tile, the
  look id and the latched photo, nothing per frame.
- Glass mode. Untagged office families keep the shader's curtain-wall choice
  (Midtown's glass variety). A tagged wall says it itself: the worker adds 4
  (glass) or 8 (opaque) to the red channel of `wallBase` / `wallTop` (and the
  far ring's wall) while `look.authority` is on, and the shader decodes and
  removes it right after `#include <color_fragment>`, before any pass reads the
  colour (`colour.js lookWallMode` is the decoder for any other consumer).
- Authority (`satellite-architecture-material.js applyWorldLook`, after every
  other facade pass): `cityWall=wlBase` after CITY_FACADES' jitter line,
  `cityCurtain` forced by the tag, `cityRoof=wlBase` (M1). LOOK_FACADE's
  per-building chroma boost, global hue table and value spread step aside on
  walls (`lfDay*lfFace*0.`); its dark-glass pick stays on curtain walls only;
  floor bands, the base-to-top gradient, sun side / shade side, glint, night
  windows and the roof patches (half weight) stay: they modulate the worker's
  colour instead of replacing it. BUILDING_REALISM's window and pier rhythm
  are untouched. Latched per page load (`worldLookShader()`), program key
  `|world-look-v2-rw-0.5000`: a governor step never recolours a city, and the
  24-slot coverage mask is not touched (the far ring's edits sit above it).

## Measurements

### M1 roof colour against the photo (first cut, per-channel exposure ratio)

Superseded by the final table below; kept because it is the measurement that
moved the exposure ratio to luma only.

`node scripts/wp-look-roofphoto.mjs --out .graphics-review/world-pass/look/roofphoto-m1.json`
(one z14 tile per place, near ring built in-process off and on; reference =
the critique-realism probe's read: 1.5-unit inset, green and shadow rejected,
>= 35 % surviving, interquartile mean, sRGB; CIELAB delta E 76 per building).
"shader" = the flat-roof hash palette CITY_FACADES paints by day (what is on
screen today, value jitter ignored); "worker" = today's vertex colour.

| place (tile) | photo / block / palette | dE today shader | dE today worker | dE look | dE today shader, under 30 m | dE look, under 30 m | n |
|---|---|---|---|---|---|---|---|
| NYC Midtown 14/4824/6157 | 47.9 / 51.3 / 0.8 % | 24.9 | 23.3 | 17.9 | 26.7 | 12.4 | 1,942 |
| Brooklyn 14/4826/6162 | 96.8 / 3.2 / 0 % | 28.1 | 31.2 | 10.5 | 28.2 | 10.4 | 1,600 |
| Paris 14/8299/5636 | 71.0 / 29.0 / 0 % | 21.5 | 23.8 | 12.7 | 21.5 | 12.4 | 1,729 |
| London Bridge 14/8188/5448 | 83.2 / 16.8 / 0.1 % | 22.5 | 16.5 | 9.5 | 22.7 | 8.6 | 980 |
| Tokyo 14/14552/6451 | 64.4 / 32.3 / 3.3 % | 23.9 | 19.4 | 16.7 | 23.8 | 13.8 | 532 |
| Phoenix suburb 14/3102/6578 | 81.6 / 17.6 / 0.8 % | 29.5 | 31.4 | 12.5 | 28.5 | 11.6 | 1,004 |

A look roof that took its own read is not 0 against the reference: the
reference keeps radiance and the photo's own exposure, the look roof is
exposure-normalised and clamped. The tall-building rows (block median) carry
most of the remaining error in Midtown and Tokyo.

Worker build time added per tile (same probe, in-process node, median of 3,
machine loaded by four other streams, so noisy): Midtown +63 ms, Brooklyn +70,
Paris +196, London +264, Tokyo +35, Phoenix +71 (on 0.8 to 2.8 s node builds).
The live per-tile number and the arrival off against on are in "Arrival".

### Final: roof colour against the photo (M1 + M2 + M3, luma-only exposure ratio)

`node scripts/wp-look-roofphoto.mjs --out .graphics-review/world-pass/look/roofphoto-final.json`

| place (tile) | photo / structure mate / block / palette (%) | dE today shader | dE today worker | dE look | dE today shader, < 30 m | dE look, < 30 m | n |
|---|---|---|---|---|---|---|---|
| NYC Midtown 14/4824/6157 | 48.2 / 2.1 / 48.9 / 0.8 | 25.0 | 23.4 | 16.9 | 26.6 | 10.8 | 1,913 |
| Brooklyn 14/4826/6162 | 96.9 / 0.0 / 3.1 / 0.0 | 28.2 | 31.2 | 8.2 | 28.2 | 8.0 | 1,598 |
| Paris 14/8299/5636 | 71.1 / 0.5 / 28.4 / 0.0 | 21.6 | 23.8 | 8.0 | 21.6 | 7.5 | 1,721 |
| London Bridge 14/8188/5448 | 83.2 / 1.4 / 15.4 / 0.1 | 22.3 | 16.5 | 6.2 | 22.5 | 4.9 | 980 |
| Tokyo 14/14552/6451 | 64.7 / 1.8 / 29.5 / 4.1 | 23.7 | 19.4 | 16.3 | 23.6 | 13.2 | 527 |
| Phoenix suburb 14/3102/6578 | 81.6 / 0.0 / 17.6 / 0.8 | 29.5 | 31.4 | 7.6 | 28.6 | 6.4 | 1,004 |

The per-channel r25 ratio (first cut) pushed Midtown's roofs warm (mean ratio
1.02 / 0.86 / 0.82; roofs read brown in `look/m1a/nyc-low__noon.png`, Madison
Square Garden brown where the photo is light grey). Luma only fixed it and cut
the error further (Paris 12.7 -> 8.0, London 9.5 -> 6.2, Phoenix 12.5 -> 7.6).
What remains high is the tall-building block median in Midtown and Tokyo (half
of Midtown's roofs are towers with no own read).

Walls in the same builds (stage counters): Midtown 178 tagged glass, 760 tagged
opaque, 2,355 region (`manhattan`); London 26 / 134 / 1,099 (`london`); Paris
0 / 18 / 3,525; Tokyo 3 / 14 / 889 (`japan`); Brooklyn 2 / 3 / 6,265;
Phoenix 0 / 0 / 1,204 (`southwest`).

### M2 part piles and seam twins

`node scripts/wp-look-structures.mjs` (`.graphics-review/world-pass/look/structures.json`).
Pile = a structure of 2+ parts rendering in more than one look (style family or
palette wall differs), or a footprint drawn although the relation hides it.

| tile | structures (parts) | hidden twins / inside / outline | piles today | piles with M2 |
|---|---|---|---|---|
| London Bridge 14/8188/5448 | 29 (94) | 0 / 0 / 0 | 29 | 0 |
| Midtown 14/4824/6157 | 185 (629) | 6 / 14 / 17 | 214 | 0 |
| Paris 14/8299/5636 | 43 (90) | 1 / 24 / 0 | 64 | 0 |
| Tokyo 14/14552/6451 | 32 (93) | 3 / 2 / 1 | 36 | 0 |

(After the grid was made adaptive for speed, 5 x 5 points under 300 true m2,
7 x 7 under 2,000, 10 x 10 above; with 10 x 10 everywhere the counts were
within one or two: London 28 structures and 1 hidden part, Midtown 182 / 210.)
Cost of the relation (in-process node, median of 3, other streams loading the
machine): 55 to 90 ms per tile at Brooklyn (6,276 bodies), Paris and Midtown;
it was 100 to 145 ms before two cuts (boxes meeting only along a party wall
skip the point tests; the adaptive grid).

The Shard: 5 parts (252 to 310 m, all tagged `#8db2b9`), 5 different looks
today, 1 with M2 (family 4, glass). Seam twins, Midtown and its east neighbour
(14/4824 and 14/4825/6157): 27 buildings cut by the seam, the look id matches
on 27 / 27; their looks split on 13 / 27 today and 2 / 27 with M2 (the two
halves have different clipped areas and the classifier reads area).

Seen in the browser (`.graphics-review/world-pass/look/m2a/crop-shard-offon.png`,
london noon, Ultra): with M2 alone the Shard still renders in three materials,
because by day CITY_FACADES picks cladding per 64-unit world cell from each
part's own anchor. The worker side is right; the pixels follow only with M3's
wall authority.

### Arrival and budget, flag off against on (live, Ultra, RTX 5080)

`node scripts/world-pass-budget.cjs --url=http://localhost:3324 --pose=nyc-low,brooklyn,phoenix-suburb --quality=ultra --flags=WORLD_PASS_DIAG --label=off --out=.graphics-review/world-pass/look/budget/off`
and the same with `--flags=WORLD_LOOK,WORLD_PASS_DIAG --label=on` (one run each,
one page warped pose to pose, four other streams sharing the GPU and CPU).

| pose | draws off / on | triangles off / on (M) | building MiB off / on | total MiB off / on | first tile s off / on | full ring s off / on | finalize max ms off / on | collision columns off / on |
|---|---|---|---|---|---|---|---|---|
| nyc-low | 385 / 385 | 4.521 / 4.524 | 209.9 / 210.1 | 308.3 / 308.5 | 57.8 / 46.4 | 98.1 / 88.2 | 143.9 / 152.9 | 49,211 / 48,587 |
| brooklyn | 404 / 404 | 4.431 / 4.429 | 236.8 / 237.2 | 322.8 / 323.2 | 15.5 / 11.6 | 68.3 / 62.9 | 145.1 / 145.6 | 72,321 / 72,081 |
| phoenix-suburb | 369 / 369 | 2.709 / 2.708 | 168.4 / 168.3 | 250.6 / 250.5 | 10.6 / 9.8 | 38.2 / 42.9 | 99.3 / 77.4 | 35,350 / 35,350 |

Read: no new geometry (the look stream changes colours, and drops only hidden
parts: 624 fewer collision columns at Midtown); draws and triangles equal within
the usual breathing. Arrival moved by -11 to +5 s between the arms, in both
directions: single runs on a shared machine, so the photo wait (at most 2.5 s per
tile, in parallel with the vector tile, in the worker) is not separable from
noise here. The budget tool's stats copy carries no `wpStages`, so the live
share of photo / block / palette roofs was NOT read in the browser; the shares
above are the node build of the same code on the same tiles. The live frames
show the photo path working (Brooklyn's roofs come out the silver-grey of the
photo, which no palette entry holds).

Cost for Ultra and High: zero triangles, zero draws, zero GPU memory. Worker:
per near tile 16 z16 + 1 z11 Esri fetches (about 0.4 MB; 272 per 16-tile ring,
cached by the browser and read first from the terrain's Cache API store), one
transient 1024 x 1024 RGBA decode (4 MiB, freed after the build), sampling and
the relation 55 to 110 ms (node, loaded machine). Main thread: none per frame;
one extra string compare per program build.

## Frames (flag on, Ultra, `.graphics-review/world-pass/look/final/`)

`node scripts/look-pass-capture.cjs --label=final --url=http://localhost:3324 --posefile=scripts/world-pass-poses.json --shots=nyc-low__noon,nyc-low__golden,nyc-low__night,brooklyn__noon,london__noon,paris__noon,tokyo__noon,phoenix-suburb__noon,hongkong__noon,nyc-top__noon --flags=WORLD_LOOK --out=<that folder>`
(10 captures, 0 errors). The off side is the orchestrator's base-1/2/3. Pairs:
`pair-*.png` there (`scripts/wp-look-pair.cjs`, off on top).

- nyc-low noon / golden: Midtown keeps its glass towers and gains limestone,
  buff and red brick, granite and white glazed brick, instead of one orange-tan
  family at golden hour. Roofs take the photo; Madison Square Garden reads light
  khaki (brown in the first cut; the photo shows it light grey), and the tower
  roofs take a khaki-green block median of the low roofs around them.
- nyc-low night: windows unchanged in kind; individual buildings whose parts
  were joined into a structure light a different (shared) pattern.
- brooklyn: silver-grey photo roofs over brownstone and brick rows.
- london: the Shard is ONE glass tower (was three boxes: dark glass, brick,
  cream); stock brick, red brick, Portland stone around it.
- paris: warm limestone blocks instead of grey; roofs from the photo.
- tokyo: pale tile and concrete, the red-brick blocks gone.
- phoenix-suburb: sand and cream stucco (the 30 m office slabs are stream A's).
- hongkong: pale tile and concrete towers; colder and more uniform than today
  (the warm variety was the global hue table's).
- nyc-top: Midtown and the far ring share the wall rule; the far mass is paler.

High: `--quality=high`, london noon (`.graphics-review/world-pass/look/final-high/london__noon.png`):
the same reading at High (330 draws, 2.90 M triangles): the Shard one glass
tower, brick and stone around it.

Flag-off proof (rule 3): `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`
on the final tree: IDENTICAL, 1,062 / 1,062 cases, 7,308 buffers, 28 stage
cases (0 bad). Also IDENTICAL after M1 and after M2. Gates green on the final
tree: graphics-unit, verify-true-earth-flags (11 / 11), verify-stylized-earth
(22 / 22), verify-city-horizon, verify-building-handoff (4 / 4), and the new
`node scripts/wp-look-shader.mjs` (17: off = no edit and no key; on = every
anchored edit once, near and far; sub-switches; latched).

## Shared-file edits

- `lib/fly/toy-world/vector-tile.worker.js` (dispatch), three marked blocks
  `// WORLD PASS D begin` / `end`: the import of `startRoofPhoto`; the photo
  started before `fetchTileBuffer` and cancelled on NO_DATA; the bounded
  `await lookPhotoJob.settle()` after the NO_DATA return (before `t0`, so
  `tessMs` stays the build time). One more marked line: the `sat-buildings`
  call spreads `...(lookPhoto ? { lookPhoto } : null)` into its frame
  (`// WORLD PASS D: lookPhoto`). Flag off: `startRoofPhoto` returns null, no
  await happens, and the frame object is the same.
- `lib/fly/fly-constants.js`: only the WORLD_LOOK block (worker tunables).

## Seam requests

- Stream C (REACH): the far ring calls `colourOf(..., 'far')`, which now (look
  on) restyles a seam body under its seam id and returns the look's wall. With
  `look.authority` on that wall can carry the glass-mode offset (+4 / +8 in red).
  The architecture material decodes it; a stand-in with its own material must
  decode it first (`lookWallMode` in `sat-buildings/colour.js`) or use the
  architecture material. Please call `relateStructures` (or reuse its look ids)
  for the far ring too: today a far part takes its own look, not its
  structure's root.
- Stream A (TRUTH): please set `item.sid` in `admitFootprints` (structures.js
  and colour.js already prefer it). Until then the look id is the seam-span
  hash or `item.id`. And: an item carrying `fid` (the feature id) and the
  feature's polygon count would let the look prefer the OSM id for
  single-polygon features.
- Stream B (ARRIVAL): no edit to `emit.js` needed. If finalize prep moves into
  the worker, the wall colour's red channel can exceed 1 by design (glass mode).
- Merge: `index.js` was not touched; the photo travels as `tileCtx.lookPhoto`
  through one marked spread in the worker dispatch.

## Ported techniques

- FableFlight (MIT, Copyright (c) 2026 Rolandjg), `src/buildings.rs`
  `roof_colour()` lines 700-730: the idea of a trimmed-mean roof colour with
  canopy and shadow rejected. Re-implemented (our sampler rasterises the whole
  inset footprint rather than 3 x vertex samples, and adds the exposure ratio,
  the de-light and the height guard).

## Open

- The live share of photo / block / palette roofs was not read in the browser
  (the budget tool does not copy `wpStages`); node shares only.
- Arrival off against on is within single-run noise; a repeated A/B on a quiet
  machine is needed to price the photo wait.
- Tall roofs (>= 30 m and not wide) take the block median of low roofs; in
  Midtown and Tokyo that is half the roofs and most of the remaining error.
- The far ring's roofs keep the typology palette (no photo there): a tall roof
  can change colour at the near/far handover. A z14 photo read for the far
  ring would cost one fetch per tile.
- Two of 27 seam twins still differ in look: each half has its own clipped area
  and the style classifier reads area.
- Relief ledge tops take the old profile palette colour (living-architecture.js
  bakes it; not D's file).
- Glass tint: a tagged glass wall renders with the shader's dark coated tint, not
  its tagged colour (the Shard is pale in reality).
- Hong Kong reads colder and more uniform than today; its palette may want warmer
  tile tones after the owner's look.
- Not run: verify-ship-city and verify-night-city-identity (red on the base),
  the browser building harnesses, the 5080 motion check.

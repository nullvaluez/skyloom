# World Pass ledger: stream D LOOK (`WORLD_LOOK`)

Branch `world/look`, worktree `.claude/worktrees/wp-look`, from W0 `ac26a77e`.
Flag `WORLD_LOOK` (ships `enabled:false`; `?flags=WORLD_LOOK` for one page load,
desktop High and Ultra only). Request field `worldPass.look`
(`roofPhoto`, `walls`, `structures`, `authority`, `worker`).

## For stream C (REACH): the far colour function (round 2)

ONE exported worker function owns every far colour, in
`lib/fly/toy-world/worker/sat-buildings/colour.js`:

```js
lookFarPrepare(admitted, tileCtx)            // once per far tile, before any lookFarColour call
lookFarColour(item, style, tileCtx, far01?)  // -> { wall: [r, g, b], roof: [r, g, b], mode }
```

- `admitted`: the tile's admitted footprints (`admitFootprints(tileCtx, classifyRingsSat)`,
  the near ring's set). `lookFarPrepare` relates the parts (`relateParts`,
  nothing dropped) so a far body takes its structure root's look id and facts,
  exactly as the near ring does. No-op unless `look.on` and `look.structures`.
  Measured cost (node, 3 x 3 tiles): NYC 3 to 61 ms, Paris 17 to 53 ms, Tokyo
  5 to 28 ms per z14 tile, about 1.5 to 2 x the admission itself.
- `item`: an admitted footprint or a copy of one (`item.polys[0]` is the key:
  the whole footprint), with `item.h` set. `style`: `architectureStyle(item, ...)`,
  restyled in place to the root's (write it into the vertices after the call).
- `far01`: 0 at the near ring's edge, 1 at the horizon (default
  `look.worker.far.far01`, 0.6). At 0 the far wall is the near wall exactly
  (gate F in `scripts/wp-look-agree.mjs`).
- `wall`, `roof`: linear [0, 1], no glass offset. `mode`: 0 untagged, 1
  tagged curtain glass, 2 tagged opaque. The wall is the near ring's wall
  (`lookWall`), pulled toward the regional photo at the building (its hue, at
  a value of at most `valueLift` x the photo's luma, never brighter than the
  wall; by `photoPull` x far01) and desaturated (`desat` x far01); a tagged
  glass tower is its tag mostly greyed at the value of tinted glass. The roof is
  the near ring's own fallback roof: the regional (z11) photo at the building,
  corrected by this worker's finished tiles, or for a tall structure the
  neutral roof family with that luma.
- Tunables: `look.worker.far` = { photoPull 0.7, valueLift 1.6, desat 0.45,
  far01 0.6 } (constants WORLD_LOOK block, carried in the request).
- The existing entry point `colourOf(item, style, tileCtx, 'far')` calls it
  (far01 default, the glass offset added for the architecture shader), so the
  current stand-in code keeps working. One marked seam line in
  `worker/sat-skyline-stand-ins.js` calls `lookFarPrepare(admitted, tileCtx)`
  after admission (`// WORLD PASS D x C seam`).

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

## Round 2

Branch `world/look`, merged with the integration head `d40dfd25` first (fast
forward: the other streams' code, the two merge seams, protocol 26). The flag
still ships `enabled:false`. Evidence is live on the RTX 5080 through this
stream's dev server (`:3324`), every before/after against a flags-off control
shot in the same session from the same server; frames in
`mystifying-curran-97a006/.graphics-review/world-pass/r2/look/` (`control/`,
`own/` = `?flags=WORLD_LOOK`, `all4/` = `?flags=WORLD_TRUTH,WORLD_ARRIVAL,WORLD_REACH,WORLD_LOOK`,
`tri-*.jpg` = control | own | all four, `crop-*.jpg`, `frames.json`).

### 1. Roof photo coverage: the build no longer waits; the late photo recolours in place

Finding (verifier, wave 1): live, 25 to 54 % of roofs took the photo and 31 to
68 % fell back to the palette, whole tiles at a time: six builds shared one
queue of 8 fetches, the 2.5 s wait held a build slot, and a miss was latched
for the session. Tiles without a photo looked worse than today.

Changed:

- No build waits for any photo. `worker/look-roofs.js` (new): `lookBegin`
  starts the regional z11 tile at the request (one fetch per 64 tiles, never
  awaited) and hands the build its inputs (`frame()`); `lookAfterBuild` runs
  only when the tile has buildings, indexes every roof vertex of the finished
  bundle (and every wall vertex whose local earth was not known yet) by
  building and kind, and stamps `result.lookPatch`. The z16 photo is fetched
  only when the main thread asks for the patch, so an empty tile (farm,
  desert, water) and a result nobody collects (the water backfill) fetch
  nothing.
- `worker/photo-sampler.js`: `fetchPhoto` retries a network error twice
  (800 / 2,500 ms), never latches a miss (the LATCH is gone), 12 in flight per
  worker, the whole tile bounded by 45 s. The Cache API name comes in the
  request (item 7).
- `lib/fly/look-roof-patch.js` (new, main thread): asks the worker that built
  the tile, then writes the new colours into the bundle if the tile is still
  draping (it is born with them), or fades the colour attribute of a drawn tile
  over 900 ms (steps at most every 50 ms, one update range, its own
  requestAnimationFrame that runs only while a fade is in flight). A result is
  patched only if the chunk's colour attribute IS that result's array, so a
  rebuilt or evicted tile can never take a stale patch. No rebuild, no new
  geometry, no new program. One marked line in `sat-building-engine.js`
  (`// WORLD PASS D x B seam`).
- One rule decides every roof, at build time and again when the photo lands
  (`colour.js lookRoofDecisions`), and the worker keeps each finished tile's
  roofs, so a rebuild after the photo draws exactly the colours the fade ended
  on (no patch). Before the photo the roof is the fallback, never a typology
  palette: the regional (z11) photo at the building (a 5 x 5 pixel window,
  about 300 m), corrected per regional tile by what this worker's finished
  tiles measured (roof against region, geometric mean per channel, after 8
  reads), chroma clamped to 0.3, +-5 % value by building; else the neighbour
  tiles' own-read medians; else the neutral family.

Measured:

- Patch exactness (node, `node scripts/wp-look-patch.mjs`, 5 places x 3 arms:
  look; look + ARRIVAL workerPrep (Uint8 colours, compacted vertices); and the
  same with the regional photo not yet landed at build time): PASS, 15 / 15.
  A tile built without its photo and then patched equals the tile built with
  it, every colour byte (P2: 0 vertices differ; the split-wall vertices whose
  colour is interpolated match within one Float32 ulp or one Uint8 step: 0 to
  132 of them, cold arms only); every other attribute byte-identical (P1); the
  rebuild after the patch equals the photo build and asks for no patch (P3);
  the fallback build differs from the photo build (P4, so the gate can fail:
  it did, on six real defects while it was written: shared anchors, Phoenix's
  wall earth read from the z16 photo, interpolated wall faces).
- Live share of roofs coloured from the z16 photo (own read, structure mates,
  block median, tall family with the photo's luma), READY near-ring chunks,
  Ultra, `?flags=WORLD_LOOK`, cold page per pose, `node scripts/wp-look-live.cjs`
  (`.graphics-review/world-pass/r2/look/live/`):

  | pose | at settle | +20 s | own read | patches landed / asked | into bundle / faded | slowest patch (s) | z16 requests |
  |---|---|---|---|---|---|---|---|
  | nyc-low | 99.0 % | 99.0 % | 73.9 % | 16 / 16 | 16 / 0 | 19.4 | 268 |
  | brooklyn | 99.9 % | 99.9 % | 94.8 % | 16 / 16 | 16 / 0 | 15.6 | 268 |
  | paris | 99.9 % | 99.9 % | 68.8 % | 16 / 16 | 7 / 9 | 13.7 | 272 |
  | phoenix-suburb | 99.7 % | 99.7 % | 91.3 % | 16 / 16 | 12 / 4 | 7.6 | 272 |

  (Round 1, verifier, same probe idea: photo 25 to 54 %, palette 31 to 68 %.)
  The remainder is buildings the photo gives no evidence for (regional
  fallback, 7 to 38 roofs per ring). "Own read" is lower in Midtown and Paris
  because their roofs of 30 m and over take the neutral family (item 2).
  z16 requests: 16 per built tile plus the terrain's own (12 to 16 in the off
  arm, wave 1); see the empty-tile row below for a farm.
- The fallback against its neighbours (node, `node scripts/wp-look-fallback.mjs`):
  a 3 x 3 block of tiles, the eight neighbours patched first, the centre built
  without its photo. CIELAB dE76 of the sRGB roof medians against the
  neighbours' mean:

  | place | fallback (before its photo) | final (after its photo) | round 1's palette fallback | spread of the neighbours themselves |
  |---|---|---|---|---|
  | Brooklyn | 3.5 | 1.7 | 27.8 | 1.4 |
  | Paris | 1.9 | 2.0 | 17.2 | 2.1 |
  | Phoenix | 5.1 | 4.3 | 29.1 | 4.3 |
  | Midtown | 1.8 | 1.3 | 11.6 | 2.4 |

  A tile waiting for its photo now sits within the neighbours' own spread
  (round 1's palette tile sat 12 to 29 away: the patchwork).

### 2. Tall buildings: a neutral roof family, luma only

Finding: roofs of buildings 30 m and taller took the block median of the low
roofs around them (khaki and olive on Midtown towers, Madison Square Garden,
Barclays Center), on every setback tier.

Changed (`photo-sampler.js prepareRoofLook`, `colour.js lookRoofDecisions`):
a roof is "tall" when its own height or its STRUCTURE's top (podium parts and
setback terraces included) is `maxH` (30 m) or more. A tall roof that is not
wide takes a neutral family (seven greys: membrane light and dark, white TPO,
gravel ballast, tar, concrete, mechanical deck; picked by the structure's look
id, +-4 % by part) whose luma moves 35 % toward the photo's block median luma
(or the regional fallback's), never its hue. A wide tall roof (footprint at
least twice its height: MSG, malls) still reads its own pixels, with the
deeper inset, chroma clamped to 0.12.

Measured (live, the item-1 probe): the tall family covers 7,922 + 365 of
41,391 Midtown roofs at nyc-low, 5,204 of 42,837 in Paris (legacy heights put
Haussmann blocks over 30 m; stream A's heights move them), 1,134 in Brooklyn,
982 in Phoenix (the legacy 30 m office slabs, stream A's). In the frames:
Midtown tower roofs and MSG are grey membrane (`crop-nyc-low-roofs.jpg`).

### 3. 1 Penn Plaza, night, Lower Manhattan slabs

Findings: 1 Penn Plaza rendered as two materials (a blue-black glass frame
round a dark grey face with scattered pale cells), near-black maroon at night
with no lit windows; the lower third of nyc-low at night 6.7 luma darker than
the old world; from the bay, two Lower Manhattan towers flat saturated blue and
maroon slabs.

Cause: 1 Penn Plaza is mapped as two parts tagged `#1e2320` (229 m) and
`#4d4a46` (219 m), and in the nyc-low view 2 Penn Plaza (126 m, `#add8e6`)
stands in front of it, so the "frame and face" are two buildings. Round 1 called only blue-cyan tags glass, so both were
OPAQUE walls in a near-black tag colour (luma clamp 0.04): the window panes
(the shader's glazing + 0.035) read as pale cells on a black face, and at night
the face kept its near-black albedo. Pale blue `#add8e6` was opaque too
(round 1 excluded tags brighter than 0.8): a flat light-blue slab. Saturated
tags kept 45 % of their chroma.

Changed:

- `colour.js tagMaterial`: curtain glass = blue-cyan at ANY value, or a dark
  near-neutral (max channel at most 0.32, saturation under 0.4: tinted glass or
  dark metal, never paint). Opaque tags keep at most 30 % chroma and luma
  [0.08, 0.6]. 1 Penn Plaza is now ONE curtain wall (both parts glass): dark
  glass with the facade grid and frames by day.
- The wall material moved from the red-channel offset into the wall vertices'
  style byte (2 curtain glass, 3 opaque, 1 the shader's choice;
  `look-roofs.js encodeWallModes`, decoded in `applyWorldLook` right after
  `float isWall = style.z;`, program key `world-look-v3`). A wall colour stays in
  [0, 1], so ARRIVAL's Uint8 colour packing now holds on Manhattan tiles
  (`col` Uint8Array at nyc and nyc + cold in the patch gate; round 1 forced
  Float32 on any tile with a tagged wall). The far mass keeps the red offset
  (both decoded).
- The far colour of a tagged glass tower is its tag mostly greyed at the value
  of tinted glass (item 6), never the flat tag colour.

Measured (frames `r2/look/{control,own,all4}`, same session, same server):
- Daylight, `crop-nyc-low-penn.jpg` (control | own | all four): the pale
  salmon face with its scattered cells is gone; 1 Penn Plaza and 2 Penn Plaza
  are both curtain glass with the facade grid. It still reads as two tones: a
  near-black face (`#1e2320`) inside blue-tinted setback sides, because the two
  buildings carry different tags and the coat tint follows the tag. Partly
  fixed: one material class, two coat values. nyc-low lower third 63.5
  (control) / 69.0 (own) / 75.9 (all four) sRGB luma.
- Lower Manhattan from the bay, `crop-nyc-bay-lowermanhattan.jpg`: the flat
  pale-blue slab is curtain glass now; lower-half chroma 41.4 / 39.8 / 39.5.
  One maroon-tagged tower stays visibly red (an opaque tag keeps 30 % of its
  chroma by rule); with all four flags its taller TRUTH body makes it more
  prominent. Not fully fixed: a lower chroma cap for tall opaque tags (or
  pulling them toward the regional photo like the far wall) would close it.

- Night, NOT fixed. nyc-low at night, lower third: 29.44 (control) / 25.16
  (own) / 23.24 (all four) sRGB luma; lit pixels (luma > 110, lower 55 %)
  6.70 / 5.78 / 5.79 %; mean of the unlit pixels 26.79 / 24.59 / 23.09. Ruled
  out in node (3 x 3 z14 tiles round Penn Station, the bundle itself): the
  window emission inputs are unchanged (profile occupancy x window share x
  the darkBuilding and glow hashes per m2 of wall: 0.0694 off / 0.0693 look /
  0.0694 look without structures), and the roofs are brighter, not darker
  (area-weighted linear roof luma 0.215 off / 0.338 look). Remaining
  candidate, not proven: more walls are curtain glass now (every dark
  near-neutral tag), and `city-facades.js` mixes a curtain wall toward the dark
  coat tint at night too (`cityWall=mix(..., cityCurtain)` has no day term).
  What would settle it: the same night pose with `look.walls` off; if the
  deficit goes, keep a curtain wall's night albedo at its daytime wall value or
  give curtain walls the office floor-lit emission.

### 4. Regions

Findings: San Francisco, Lagos, Rio and Sydney fell to 'temperate' (San
Francisco a red-brick city); Hong Kong towers near-uniform dark slate; Tokyo
almost monochrome grey near and far.

Changed (`colour.js REGIONS`, `regionKey`, `lookWall`, `wallContext`):

- New regions: `pacific` (the Bay Area and coastal California: painted wood and
  stucco in white, cream, pale grey and muted pastel, little brick), `oceania`
  (sandstone, cream render, some face brick; also the Natural Earth 'oceania'
  style round 1 dropped), `latam` (white and cream concrete, pastel render;
  also every 'latin' tile), `africa` (off-white and beige render, faded paint,
  grey concrete). `temperate` (North America and anything unnamed) is
  brick-light: one brick in six.
- Every region but the four curated cities pulls its wall hue toward the
  REGIONAL photo's lit ground (`earth`: 0.1 Japan and Hong Kong, 0.15 to 0.35
  elsewhere), read from the z11 tile the build already holds
  (`photo-sampler.js regionalGround`: the lit half of the non-vegetation pixels
  over the tile and one tile round it), so an unlisted city sits in its own
  imagery; round 1 read the z16 photo, which the build no longer has. A wall
  built before the regional photo landed is recoloured by the late patch
  (patch gate, cold arms: 24,852 to 31,924 wall vertices, exact).
- `glass` per region: the share of untagged office towers (family 4) kept as
  curtain glass; the rest become concrete towers (family 3) with the region's
  'mod' palette. Hong Kong 0.3 and `officeGlass: false` (an untagged mid-rise
  or tower there is tile and concrete, written as opaque in the style byte, so
  the shader's office cuts cannot make it a curtain wall); Japan 0.55;
  Manhattan 1 (its glass variety stays).
- Japan gained the tan and brown tile of the mansions next to its greys; Hong
  Kong warmer pale tile.

Measured (frames, control / own / all four; `crop-<place>.jpg`):

| pose | region key | lower-third luma | lower-half chroma | read |
|---|---|---|---|---|
| sf-hills | pacific | 77.9 / 90.7 / 91.3 | 28.3 / 26.9 / 27.0 | the red brick is gone: cream, white and pale grey with darker towers. Fixed. |
| lagos | africa | 100.3 / 98.2 / 99.9 | 35.8 / 35.9 / 36.2 | off-white and beige render; was the temperate palette. |
| hongkong | hongkong | 83.5 / 85.6 / 86.6 | 37.0 / 35.7 / 35.4 | towers still mostly dark slate; a few warmer pale mid-rises. Partly fixed. |
| tokyo | japan | 59.4 / 59.9 / 55.8 | 29.8 / 27.9 / 28.5 | still near-monochrome grey near and far. NOT fixed. |

Rio is `latam` and Sydney `oceania` by the key (node), not shot. The
chroma column is frame-wide (water and parks included) and cannot by itself
show building variety; the reads are from the crops. Hong Kong and Tokyo: the
regional-photo pull (0.1) and the glass share are too weak against the
shader's own dark coat for towers; what would fix them is a per-building value
spread for the tower families in those two regions (and the HK curtain glass
share lowered further), judged on the owner's screen.

### 5 and 6. Near and far agree; the far colour sits in the photo

Findings: `lookFar` keyed colour on the part id while the near ring keyed on
the structure root (multi-part structures changed colour at the handoff);
with REACH on the far stand-ins were white and salt-like north of the Seine
against the warm grey near ring, salmon / pink / cream / blue confetti over
Manhattan, with a tonal step along the ring boundary.

Changed: ONE far colour function (`lookFarPrepare` + `lookFarColour`, see the
top of this ledger), the near ring's structure key, wall and fallback roof
rule; the far wall pulled toward the regional photo at the building (hue, and
value at most 1.6 x the photo's luma) by 0.7 x far01 and desaturated by
0.45 x far01. `colourOf(..., 'far')` calls it. Seam: one marked line in
`worker/sat-skyline-stand-ins.js`.

Measured: gate F (item 8): with the near ring's key, 0 of 83 Midtown, 87 Paris,
82 Tokyo and 24 London multi-part buildings differ from the near wall at
far01 = 0; with round 1's part key 63 / 41 / 57 / 13 do. 

The far frames, live (`farstack-<pose>.jpg`: control | own | TRUTH + ARRIVAL +
REACH without LOOK | all four; sRGB luma / chroma of two horizontal bands of the
city below the horizon, the second the far ring):

| pose | band | control | own (legacy far mass) | three flags, no LOOK | all four |
|---|---|---|---|---|---|
| paris-mid | 52-62 % | 123.4 / 57.8 | 123.0 / 57.8 | 127.5 / 52.6 | 129.1 / 49.8 |
| paris-mid | 62-75 % | 112.6 / 45.5 | 115.1 / 43.3 | 120.6 / 38.4 | 128.9 / 27.1 |
| nyc-mid | 62-75 % | 112.6 / 43.1 | 112.6 / 42.4 | 110.5 / 46.5 | 110.2 / 43.5 |
| nyc-bay | 62-75 % | 86.8 / 46.4 | 87.7 / 43.5 | 85.8 / 47.4 | 86.5 / 43.8 |

Over Manhattan the far colour now sits with REACH's own (no confetti in the
frames; band within 1 luma of control). Over Paris it does NOT: on the legacy
far mass LOOK moves the band 2.5 luma, but on REACH's stand-ins it adds 8 luma
and takes chroma 38 to 27 on top of REACH's own 8: the stand-ins north of the
Seine stay paler and greyer than the near ring. The value pull this round
(`valueLift`) moved it 1.2 luma. Likely cause (not proven live): the far roof
is the regional photo with this worker's learned roof correction, and a far
tile is built in a worker that may have patched no near tile (correction
null: the raw regional colour, Paris's pale limestone and streets); the 0.27
desaturation adds to it. What would fix it: carry the near ring's learned
correction per z11 tile in the request (main thread holds it from the patches)
or a per-region default, and judge desat on the owner's screen.

### 7. The worker read TERRA_CACHE.enabled

Changed: `photo-sampler.js` no longer imports `fly-constants`. The Cache API
store name travels in the request: `WORLD_LOOK.worker.photo.cacheName` is a
getter resolved on the main thread when the request is built (the latch),
from the same inputs as `terrain-engine.js terraCacheOn()`
(`TERRA_CACHE.enabled`, `window.__flyTerraPin`, the dev-only
`window.__flyTerraForce.cache`), so a terrain pin reaches the worker. The
worker reads `cfg.cacheName` only (null: the store is not read).

### 8. Metrics that can fail

`node scripts/wp-look-agree.mjs` (`.graphics-review/world-pass/look/r2/agree-gate.json`),
every number read off the bundle the worker emits (vertex colours and style
bytes) or off the far colour function, each with a control arm:

| measure | look on | control | bar |
|---|---|---|---|
| S: multi-part structures whose kept parts carry different walls in the bundle (Midtown / London / Paris / Tokyo) | 0 of 184 / 0 of 29 / 0 of 43 / 0 of 32 | `structures` off: 63 / 19 / 40 / 32 | 0, and the control must disagree |
| M: seam halves with the same wall top in both bundles, Midtown E-W / N-S | 25 of 27 / 29 of 32 | (as measured, no bar) | none |
| F: far wall at far01 = 0 against the near walls of the same building (Midtown / Paris / Tokyo / London) | 0 of 2,336 / 1 of 3,523 / 0 of 889 / 0 of 1,099; multi-part 0 / 0 / 0 / 0 | the round-1 part key: 63 / 41 / 57 / 13 (all multi-part) | no multi-part, at most 0.1 % |

Round 1's "part piles 214 to 0" counted a relation's own bookkeeping (true by
construction); S reads the emitted colours and the control shows what the
relation removes. The seam numbers M are the verifier's measurement redone on
the bundle; the 2 + 3 split halves have different style families (each half's
clipped area feeds the classifier: stream A's `sid` and a shared descriptor
would fix it). The one Paris building in F is a classifier difference between
two builds of one footprint (family 0 near, 1 far), not a key.

The gate found three real defects while it was written: the far restyle
skipped a root whose structure top differs from its own height (fixed in
`lookFarColour`), and two measurement faults (a partial footprint key that
collided, the brightest wall vertex of a stepped building).

### Cost and rules (round 2)

- Flags off: `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`
  IDENTICAL, 1,062 / 1,062 cases, 7,308 buffers, 28 stage cases (0 bad), at
  the final commit. `WORKER_PROTOCOL` unchanged (26).
- Rule 1: the worker reads only the request (`worldPass.look`, its `worker`
  tunables; the cache name now among them). No constants gate in the worker.
- Flags off, per frame: nothing new. `look-roof-patch.js` runs only for a
  result carrying `lookPatch` (look.roofPhoto in the request) and its
  requestAnimationFrame only while a fade is in flight. The engine seam is one
  property test per build result. No new program with the flag off (the shader
  edit and key are behind the latched `worldLookShader()`).
- Geometry: none added. With ARRIVAL on, the colours of tiles with tagged walls
  now pack to Uint8 (3 B a vertex, not 12): the offset that forced Float32 left
  the near ring.
- Worker: the roof index after each build (one pass over the bundle) and, per
  tile with buildings, one z16 photo (16 fetches + the cached z11), its decode
  and one decision pass when the main thread asks. The far ring pays
  `lookFarPrepare` (3 to 61 ms a z14 tile, node, see the top of this ledger).
- Main thread: a fade writes the roof vertices of one tile (about 50 to 120
  thousand) at most every 50 ms for 900 ms and re-uploads one colour range.
- Live draws / triangles at the 12 poses (Ultra, capture tool, settled):
  control 348 to 412 / 2.09 to 6.41 M; own 349 to 409 / 2.09 to 6.42 M (the
  same within single-run noise); all four 351 to 410 / 2.45 to 7.16 M (Paris).
  Inside the all-four budget (900 draws, 8 M triangles). Geometry MiB was not
  read this round (`world-pass-budget.cjs` not run); LOOK adds no vertices.

### Shared-file edits (round 2)

- `lib/fly/toy-world/vector-tile.worker.js`: the WORLD PASS D blocks now import
  `lookBegin, lookAfterBuild, lookRoofPatch` (was `startRoofPhoto`), call
  `lookBegin` before the vector fetch (no await, no cancel needed), build the
  'sat-buildings' tile with `lookIn.frame()` spread into its frame and return
  `lookAfterBuild(out, ctx)`, and add `api.lookRoofPatch` before `expose`. All
  inside `// WORLD PASS D begin` / `end`. With the flag off `lookBegin` returns
  null and the build and its result are the shipped ones.
- `lib/fly/toy-world/sat-building-engine.js` (B's): one import and one line in
  the build-result handler, `// WORLD PASS D x B seam`:
  `if (result.lookPatch) requestLookRoofPatch(this, slot ? slot.api : this.worker, key, result);`
- `lib/fly/toy-world/worker/sat-skyline-stand-ins.js` (C's): one import and one
  line after admission, `// WORLD PASS D x C seam`:
  `lookFarPrepare(admitted, tileCtx);` (a no-op unless look.structures).
- `lib/fly/fly-constants.js`: only the WORLD_LOOK block (and the
  `worldLookTerraCacheName` helper right above it, inside the D seam).

### Gates (round 2)

`node scripts/wp-look-patch.mjs` (new, 15 arms) PASS; `node scripts/wp-look-agree.mjs`
(new) PASS; `node scripts/wp-look-shader.mjs` 17 / 17 (check (2) rewritten for
the style-byte decode); `node scripts/wp-look-fallback.mjs` (new, a measure, no
bar); node gates on the merged tree: graphics-unit PASS, verify-true-earth-flags
11 / 11, verify-stylized-earth 22 / 22, verify-city-horizon PASS,
verify-building-handoff 4 / 4, verify-attribution 4 / 4; eslint clean on every
changed file.

### Still open after round 2

- Night (item 3): the lower third of nyc-low at night is still 4.3 (own) to
  6.2 (all four) luma darker than the control; window inputs and roofs ruled
  out; curtain glass at night is the open candidate (item 3 says how to settle
  it).
- 1 Penn Plaza still reads two-tone (two buildings, two tags, one material);
  one maroon-tagged Lower Manhattan tower stays red.
- Tokyo still near-monochrome and Hong Kong towers mostly dark slate (item 4).
- The far step (item 6): see the far rows above; with all four flags the far
  stand-ins north of the Seine still read paler than the near ring.
- Two to three of 27 to 32 seam halves differ in family (the classifier reads
  each half's clipped area; stream A's `sid` and a shared descriptor).
- Not run: the 5080 motion check, `world-pass-budget.cjs` geometry MiB, the
  empty-tile z16 fetch count live (node only: `lookAfterBuild` stamps no patch
  without buildings), verify-ship-city and verify-night-city-identity.

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

**M3 walls and authority.** (see below)

## Measurements

### M1 roof colour against the photo

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

### M2 part piles and seam twins

`node scripts/wp-look-structures.mjs` (`.graphics-review/world-pass/look/structures.json`).
Pile = a structure of 2+ parts rendering in more than one look (style family or
palette wall differs), or a footprint drawn although the relation hides it.

| tile | structures (parts) | hidden twins / inside / outline | piles today | piles with M2 |
|---|---|---|---|---|
| London Bridge 14/8188/5448 | 28 (94) | 0 / 1 / 0 | 29 | 0 |
| Midtown 14/4824/6157 | 182 (619) | 5 / 14 / 17 | 210 | 0 |
| Paris 14/8299/5636 | 43 (90) | 0 / 24 / 0 | 64 | 0 |
| Tokyo 14/14552/6451 | 32 (94) | 2 / 2 / 2 | 36 | 0 |

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

(see the end of the file)

## Ported techniques

- FableFlight (MIT, Copyright (c) 2026 Rolandjg), `src/buildings.rs`
  `roof_colour()` lines 700-730: the idea of a trimmed-mean roof colour with
  canopy and shadow rejected. Re-implemented (our sampler rasterises the whole
  inset footprint rather than 3 x vertex samples, and adds the exposure ratio,
  the de-light and the height guard).

## Open

(see the end of the file)

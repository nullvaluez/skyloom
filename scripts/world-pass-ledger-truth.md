# World Pass ledger, stream A: TRUTH (`WORLD_TRUTH`)

Branch `world/truth`, from the W0 commit `ac26a77e`. Flag `WORLD_TRUTH`
(`?flags=WORLD_TRUTH`), request field `worldPass.truth`, sub-switches
`heights`, `typology`, `smallBand`, `roofs`. Desktop High and Ultra only (the
W0 latch). Everything below is read in the worker only as
`tileCtx.worldPass.truth` (rule 1).

## Design

**One fact table per tile** (`typology.js truthTable`). The near ring
(`sat-buildings`) and the far mass (`sat-skyline`) each build it from the
tile itself, lazily, and only while the truth stream is on. It is a pure
function of the tile bytes and the truth tunables, so both rings read the
same facts for the same polygon id (the admission's `pid`) and therefore the
same height. Per polygon it holds: the drawn (clipped) true area and the
whole footprint's true area as the tile carries it (MVT buffer included); an
equivalent-rectangle aspect and fill from the polygon's second area moments;
the courtyard (hole) fraction; the corners it shares with other footprints
(attached houses: OSM terraces share nodes, MVT keeps them as exactly equal
integer vertices); the land use class under the centroid (civic,
industrial, commercial, residential, in that priority, from the full
OpenMapTiles landuse class set rather than the four classes
`architectureContext` reads); the local footprint cover and commercial POI
density on a 16 x 16 cell grid smoothed 3 x 3 (continuous: there is no
per-tile yes/no switch any more, so no cliff at a tile edge); the
cross-tile-stable id `sid`; and a typology class.

**Classes**: shed (< 30 m2), house, terrace (attached), apartment, block
(courtyard, or large in dense cover), commercial (sparse, not housing),
civic (school / college / university / hospital land use), industrial
(industrial land use), bigbox (large and sparse, not housing). The house
size limit is regional (450 m2 US, 220 Europe, 180 East Asia, 600 arid).

**One height law** (`height.js truthHeight`, through `heightOf`):

1. A mapped height (a real tag; OpenMapTiles' synthesized 5 is not one)
   goes through the legacy rule untouched. Mapped Manhattan keeps every
   height.
2. Unmapped, for the storey classes: the median mapped height of
   ground-standing buildings of the SAME class in the same tile whose whole
   area lies within [A / 1.6, A x 1.6], when at least 8 exist (the review's
   point: mapped buildings are a biased sample toward the tall and notable,
   Tokyo's mapped median is 22 m, so the evidence is area- and
   class-matched and then kept inside the class prior's storey range).
3. Else the regional prior: the class mode (houses, terraces, commercial,
   civic), or, for apartments and blocks, the local cover mapped onto the
   prior's storey range (denser = taller, continuously).
4. Quantised to storeys: residential 0.5 m plinth + 3.0 m per storey,
   commercial 4.5 m ground floor + 3.6 m, civic 3.8 m. One storey off the
   mode for 22 % of buildings, a +-0.25 m jitter, both hashed from `sid`.
   Industrial and big-box buildings are single volumes, 5 to 11 m and 4.5 to
   9 m by area. Sheds 2.6 to 3.2 m.
5. Capped at 24 m: nothing unmapped is ever a tower.

The style classifier (`building-profiles.js buildingClassificationHeight`,
called from `typology.js architectureStyle`) takes the law's height when the
stream is on, so the facade family is chosen for the height that is drawn:
there is one height per footprint, not three. With `typology` on, an
inferred class also hands the classifier its source hint (house, terrace,
apartment, industrial, warehouse), which the existing family rules read first.

**Stable ids**. OpenFreeMap merges every building with the same attributes
into one multi-polygon feature, so its feature id is not a building id.
`sid` is a hash of the world-quantised (2 units, about 1.2 m at z14)
bounding box of the whole footprint as the tile carries it. A building that
straddles a seam and fits inside both tiles' 64-unit buffers has the same
`sid` in both tiles; one that runs past a buffer does not (the generator cut
it differently in each tile). All per-building hashes of the law come from
`sid`; `heightOf` returns a `hash` from it too (roof form picks), and the
near admission sets `item.sid` and `item.truthCls` for the other streams.
Footprints cut by a tile edge take no tile evidence (each tile has its own
sample), only the class prior and the cover.

**Admission (M2)**. With `smallBand` on, the 70 m2 floor tests the whole
footprint, not the fragment the tile clip left: the clipped half of an
admitted building is kept (slivers under 2 m2 stay out).

## Measurements

### Hold-out on mapped heights (acceptance 1)

`node scripts/wp-truth-probe.mjs --out .graphics-review/world-pass/truth/probe-m1.json`
(3 x 3 z14 tiles of the recorded OpenFreeMap planet build `20261101_080013_pt`
around each pose, the real worker modules in node). Every mapped,
ground-standing, admitted footprint has its height hidden and predicted: the
law with leave-one-out evidence, against the legacy near rule (house band,
the R19 suburban typology when its per-tile guard arms, else the sqrt-area
curve). Errors in metres.

Mapped heights up to 24 m (the law's cap: it never invents a tower):

| place | n | law abs p50 / p90 | law signed p50 | law within 3 m | legacy abs p50 / p90 | legacy signed p50 | legacy within 3 m |
|---|---|---|---|---|---|---|---|
| nyc | 11677 | 2.53 / 7.66 | -0.38 | 0.582 | 5.44 / 12.63 | -2.2 | 0.331 |
| brooklyn | 41613 | 1.7 / 5.45 | 0.37 | 0.698 | 5.25 / 9.63 | -3.75 | 0.242 |
| paris | 10289 | 2.54 / 11.49 | 2.29 | 0.569 | 4.91 / 15.5 | -1.3 | 0.313 |
| london | 4615 | 3.54 / 9.69 | 0.69 | 0.384 | 6.15 / 15.5 | 2.5 | 0.241 |
| tokyo | 1771 | 5.25 / 12.45 | -1.32 | 0.367 | 6.34 / 15.82 | -0.75 | 0.247 |
| phoenix-suburb | 216 | 0.6 / 4.26 | -0.47 | 0.875 | 13.89 / 17.34 | 13.89 | 0.042 |
| lagos | 1796 | 3.82 / 8.52 | -1.52 | 0.431 | 7.31 / 15.45 | 5.42 | 0.241 |
| dubai | 533 | 3.3 / 13.3 | -0.21 | 0.462 | 14.95 / 30.25 | 14.85 | 0.105 |
| powell | 3 | 0.24 / 3.54 | -0.13 | 0.667 | 5 / 5 | 5 | 0.333 |
| owens | 31 | 0.56 / 0.73 | -0.53 | 0.968 | 3 / 4.25 | 3 | 0.516 |

All mapped heights (towers included; the law cannot reach them by design,
the legacy curve reaches 48 m by accident):

| place | n (all mapped) | law abs p50 / p90 | legacy abs p50 / p90 |
|---|---|---|---|
| nyc | 18353 | 4.73 / 53.36 | 8.67 / 50.58 |
| brooklyn | 42488 | 1.72 / 5.66 | 5.25 / 10 |
| paris | 17226 | 4.32 / 10.68 | 6.93 / 17 |
| london | 6088 | 4.57 / 19.72 | 7.59 / 23.15 |
| tokyo | 3947 | 11.53 / 41.39 | 11.49 / 33.83 |
| phoenix-suburb | 218 | 0.6 / 4.27 | 13.89 / 17.34 |
| lagos | 1936 | 4.36 / 11.57 | 7.75 / 16.93 |
| dubai | 968 | 11.46 / 131.04 | 19.58 / 119.56 |
| powell | 3 | 0.24 / 3.54 | 5 / 5 |
| owens | 31 | 0.56 / 0.73 | 3 / 4.25 |

The law wins on the median error in every city with towers excluded, and
on every city but Tokyo with them included (Tokyo: 11.5 against 11.5; its
mapped buildings are the towers, median 22 m). Read these as the honest
bound they are: mapped buildings are a biased sample (tall, notable), so a
hold-out on them flatters a rule that predicts tall. The legacy curve's
signed error at Phoenix (+13.9 m), Dubai (+14.9 m) and Lagos (+5.4 m) is the
office-slab defect measured.

### Inferred heights (acceptance 2) and one height per footprint

The near ring's heights for UNMAPPED admitted footprints, legacy against the
law, the law's provenance mix, the share of seam-cut footprints (same `sid`
seen from two tiles) whose two halves get the same height, and the far
ring's height for every far-hatch candidate (unmapped, >= 900 m2) against the
near ring's:

| place | unmapped admitted | legacy p50 / p90 / max | law p50 / p90 / max | law provenance | seam pairs: law / legacy agree | far = near (law) |
|---|---|---|---|---|---|---|
| nyc | 2911 | 15.35 / 22.17 / 45.15 | 9.58 / 15.63 / 21.748 | density 654, evidence 1572, prior 672, size 13 | 3: 0.667 / 0 | 223/223 |
| brooklyn | 955 | 18.36 / 27.75 / 46.725 | 12.61 / 18.33 / 24 | evidence 884, density 39, size 20, prior 12 | 6: 0.833 / 0 | 193/193 |
| paris | 8088 | 19.96 / 28.4 / 45.15 | 21.52 / 24 / 24 | evidence 7543, density 423, prior 111, size 11 | 41: 0.902 / 0 | 2188/2188 |
| london | 7936 | 18.37 / 28.73 / 46.725 | 15.48 / 18.73 / 21.749 | density 482, evidence 6975, prior 378, size 101 | 34: 0.824 / 0.029 | 1878/1878 |
| tokyo | 26410 | 15.13 / 23.96 / 46.725 | 9.62 / 21.56 / 24 | density 452, evidence 24464, prior 1348, size 146 | 67: 0.731 / 0.03 | 2856/2856 |
| phoenix-suburb | 18751 | 18.87 / 23.77 / 47.513 | 3.58 / 6.58 / 18.669 | prior 12189, size 909, density 827, evidence 4826 | 88: 0.966 / 0.011 | 1801/1801 |
| lagos | 17440 | 16.21 / 22.74 / 47.513 | 6.48 / 9.7 / 18.743 | prior 4154, density 5394, size 1127, evidence 6765 | 58: 0.828 / 0.034 | 1498/1498 |
| dubai | 14694 | 16.98 / 24.68 / 48.103 | 6.58 / 12.52 / 24 | prior 6194, size 482, density 4115, evidence 3903 | 48: 0.625 / 0 | 1725/1725 |
| powell | 1339 | 7.5 / 8.63 / 13 | 3.56 / 6.48 / 9.647 | prior 1282, density 50, size 7 | 16: 1 / 0.063 | 121/121 |
| owens | 580 | 7.13 / 8.63 / 11.844 | 3.54 / 6.47 / 12.567 | prior 157, size 2, evidence 407, density 14 | 1: 1 / 0 | 16/16 |
| iowa-farm | 124 | 6.75 / 8.25 / 10.75 | 3.57 / 6.58 / 9.497 | prior 123, density 1 | 2: 1 / 0 | 10/10 |

- Phoenix suburb: inferred p90 **6.6 m** (target <= 9 m; legacy 23.8 m),
  p50 3.6 m (single-storey houses), max 18.7 m (a block in denser cover).
- Paris: inferred p50 21.5 m = 7 storeys, p90 24 m (8 storeys where the
  class is mostly mapped and its evidence says so); the class medians are
  apartment 21.6, terrace 21.5, block 21.4. Target "centred on 6 to 7
  storeys": met (at the top of it).
- Tokyo: houses 9.3 m and town houses 9.5 m (3 storeys), so the fine grain
  is 2 to 3 storeys; mid-size apartments (180 to 1,500 m2) 21.4 m
  (7 storeys); nothing unmapped above 24 m. Towers only where mapped.
- The far ring and the near ring now give the same height to every
  unmapped far-hatch candidate (100 % in every city; legacy 0 %, the review's
  "one footprint, three heights"). The style classifier reads the same value.
- Seam halves: 63 to 97 % agree under the law, 0 to 6 % under the legacy
  per-tile ids. The rest are buildings longer than a tile buffer (their
  `sid` differs between tiles) or classes whose cover differs across the seam.

Per-class medians (m) and counts:

```
nyc {"terrace":9.63,"apartment":15.73,"block":21.36,"civic":8.29,"house":6.46,"commercial":4.61,"bigbox":6.45} {"terrace":1800,"apartment":361,"block":35,"civic":26,"house":572,"commercial":104,"bigbox":13} ms 621
brooklyn {"house":9.41,"block":18.5,"terrace":12.66,"apartment":15.59,"commercial":11.48,"civic":8.28,"bigbox":6.11,"industrial":6.76} {"house":85,"block":28,"terrace":609,"apartment":176,"commercial":29,"civic":8,"bigbox":12,"industrial":8} ms 877
paris {"apartment":21.57,"terrace":21.49,"block":21.42,"house":6.52,"civic":11.99,"industrial":6.79,"commercial":4.66} {"apartment":4935,"terrace":2279,"block":619,"house":52,"civic":170,"industrial":11,"commercial":22} ms 848
london {"apartment":18.39,"block":21.32,"civic":11.93,"terrace":12.73,"commercial":11.67,"house":9.4,"bigbox":6.25,"industrial":6.49} {"apartment":3421,"block":320,"civic":161,"terrace":3097,"commercial":244,"house":592,"bigbox":30,"industrial":71} ms 572
tokyo {"apartment":21.43,"terrace":9.47,"block":24,"civic":11.9,"house":9.32,"commercial":15.07,"bigbox":6.18,"industrial":7.97} {"apartment":7867,"terrace":15063,"block":389,"civic":291,"house":1442,"commercial":1212,"bigbox":145,"industrial":1} ms 704
phoenix-suburb {"civic":8.11,"bigbox":6.45,"commercial":4.54,"industrial":6.34,"house":3.54,"apartment":9.48,"terrace":9.63,"block":15.32} {"civic":93,"bigbox":298,"commercial":646,"industrial":611,"house":16276,"apartment":698,"terrace":107,"block":22} ms 320
lagos {"house":3.7,"apartment":9.48,"commercial":7.95,"civic":8.18,"terrace":6.63,"block":12.28,"industrial":5.92,"bigbox":6.12} {"house":7141,"apartment":2001,"commercial":2185,"civic":46,"terrace":4914,"block":26,"industrial":1076,"bigbox":51} ms 360
dubai {"commercial":4.54,"house":6.47,"bigbox":6.54,"apartment":12.51,"terrace":9.45,"block":18.37,"civic":8.15,"industrial":6.69} {"commercial":713,"house":8664,"bigbox":87,"apartment":2214,"terrace":2361,"block":218,"civic":42,"industrial":395} ms 286
powell {"house":3.53,"apartment":6.6,"commercial":4.5,"civic":8.27,"bigbox":6.59} {"house":1209,"apartment":50,"commercial":67,"civic":6,"bigbox":7} ms 20
owens {"house":3.52,"industrial":5.24,"apartment":6.57,"commercial":4.53,"terrace":6.61,"civic":8.32} {"house":540,"industrial":2,"apartment":4,"commercial":16,"terrace":10,"civic":8} ms 7
iowa-farm {"house":3.56,"commercial":4.58,"apartment":9.5} {"house":110,"commercial":13,"apartment":1} ms 2

```

### Admission (acceptance 3: the admitted share)

| place | polygons | admitted today | admitted with truth | seam fragments rescued | 15-70 m2 band (whole) |
|---|---|---|---|---|---|
| nyc | 28662 | 22098 (77.1 %) | 22493 (78.5 %) | 436 | 4134 |
| brooklyn | 56630 | 43581 (77.0 %) | 44294 (78.2 %) | 798 | 11354 |
| paris | 33588 | 25492 (75.9 %) | 25996 (77.4 %) | 573 | 3675 |
| london | 25090 | 14596 (58.2 %) | 14789 (58.9 %) | 223 | 7751 |
| tokyo | 51256 | 30493 (59.5 %) | 30898 (60.3 %) | 471 | 19347 |
| phoenix-suburb | 19711 | 18969 (96.2 %) | 19122 (97.0 %) | 158 | 544 |
| lagos | 31230 | 19431 (62.2 %) | 19618 (62.8 %) | 224 | 9913 |
| dubai | 25841 | 15822 (61.2 %) | 15977 (61.8 %) | 197 | 8780 |
| powell | 1473 | 1342 (91.1 %) | 1371 (93.1 %) | 29 | 74 |
| owens | 735 | 611 (83.1 %) | 616 (83.8 %) | 5 | 113 |
| iowa-farm | 183 | 124 (67.8 %) | 125 (68.3 %) | 1 | 47 |

The rescued column is clipped fragments under the 70 m2 floor whose whole
footprint clears it (seam halves); with `smallBand` they are drawn. The last
column is the 15 to 70 m2 band itself (whole footprints), which M2's lean
small band would admit and which is NOT drawn yet (see Open).

Live engine, the stage counters (`?flags=WORLD_PASS_DIAG`, summed over the
16 resident detail tiles after the ring settles), flag off against
`WORLD_TRUTH` on, one page per arm warped pose to pose at Ultra:
`node scripts/wp-truth-stages.cjs --url=http://localhost:3321 --out=<worktree>/.graphics-review/world-pass/truth/stages`
(0 page errors in either arm). The off arm reproduces the review's offline
replay exactly (Tokyo 61,366, Lagos 43,924, Phoenix 35,276, Brooklyn 64,730).

| pose | polygons (16 tiles) | admitted off | admitted on | seam fragments kept (on) | inferred p50 / p90 m, off | inferred p50 / p90 m, on |
|---|---|---|---|---|---|---|
| phoenix-suburb | 36834 | 35276 (95.8 %) | 35604 (96.7 %) | 328 | 18 / 23 | 3 / 6 |
| tokyo | 113959 | 61366 (53.8 %) | 62210 (54.6 %) | 844 | 14 / 23 | 9 / 21 |
| paris | 59434 | 43019 (72.4 %) | 43874 (73.8 %) | 855 | 19 / 28 | 21 / 24 |
| lagos | 68311 | 43924 (64.3 %) | 44430 (65.0 %) | 506 | 15 / 21 | 6 / 9 |
| london | 45761 | 27325 (59.7 %) | 27755 (60.7 %) | 430 | 17 / 28 | 15 / 18 |
| brooklyn | 82990 | 64730 (78.0 %) | 65776 (79.3 %) | 1046 | 17 / 27 | 12 / 18 |
| nyc-low | 52435 | 41566 (79.3 %) | 42297 (80.7 %) | 731 | 7 / 21 | 12 / 15 |
| dubai | 36176 | 22034 (60.9 %) | 22242 (61.5 %) | 208 | 17 / 24 | 6 / 12 |
| iowa-farm | 463 | 322 (69.5 %) | 327 (70.6 %) | 5 | 6 / 8 | 3 / 6 |

The admitted share moves by about one point (the seam fragments): the big
gap, the 15 to 70 m2 band, is M2b and open.

Empty stays empty: `node scripts/wp-truth-probe.mjs --places owens,iowa-farm --r 3`
(7 x 7 tiles): Owens 3 empty tiles before, 3 after; Iowa 1 and 1. A rescued
fragment never makes a tile non-empty on its own (admission.js drops them
when nothing else in the tile clears the floor).

### Budget (acceptance 5), Ultra, 1600 x 900, my server :3321

`node scripts/world-pass-budget.cjs --url=http://localhost:3321 --pose=nyc-low,paris,tokyo,phoenix-suburb,powell --quality=ultra [--flags=WORLD_TRUTH,WORLD_PASS_DIAG]`
(JSON: `.graphics-review/world-pass/truth/budget-off/`, `budget-on/`). One
warm page per arm, warped pose to pose; the machine was shared with four
other streams, so arrival seconds are noisy (nyc-low is the first pose after
boot in both arms).

| pose | arm | draws | triangles (M) | building tris (M) | building MiB | geometry MiB total | first detailed tile (s) | full ring (s) | finalize max (ms) |
|---|---|---|---|---|---|---|---|---|---|
| nyc-low | off | 385 | 4.52 | 1.70 | 209.9 | 308.2 | 49.6 | 90.9 | 144.5 |
| nyc-low | on | 536 | 4.84 | 1.69 | 208.9 | 307.2 | 54.2 | 105.9 | 146.5 |
| paris | off | 383 | 6.42 | 2.72 | 320.5 | 413.7 | 13 | 61.3 | 749.4 |
| paris | on | 383 | 6.44 | 2.64 | 311.8 | 404.9 | 16.7 | 60.8 | 131.6 |
| tokyo | off | 552 | 4.95 | 1.74 | 216.3 | 310.9 | 14.8 | 65.9 | 95.7 |
| tokyo | on | 551 | 4.88 | 1.68 | 209.5 | 304.1 | 19.7 | 71.2 | 98.2 |
| phoenix-suburb | off | 369 | 2.71 | 1.37 | 168.4 | 250.6 | 12.4 | 40.9 | 75.2 |
| phoenix-suburb | on | 370 | 2.41 | 1.11 | 136.8 | 219 | 7.3 | 37.6 | 73.5 |
| powell | off | 538 | 1.11 | 0.23 | 25.4 | 76.1 | 5.6 | 15.2 | 51.9 |
| powell | on | 356 | 0.88 | 0.16 | 17.5 | 68.1 | 5.8 | 16.4 | 48.3 |

The law adds no geometry: building triangles and building MiB fall or stay
(Phoenix 1.37 to 1.11 M triangles and 168 to 137 MiB, Paris 321 to 312 MiB,
Tokyo 216 to 210 MiB, Powell 25 to 18 MiB). Ultra cost: none; High cost:
none (the same worker output at a smaller ring). Worker cost: the fact table
(one extra pass over the tile's land use, POIs and footprint corners; the
building decode is shared with admission) takes the near ring's admission +
heights from 253 to 507 ms per 9 Midtown tiles, 240 to 572 Tokyo, 113 to 213
Phoenix (node, the probe's `legacyMsPer9Tiles` / `lawMsPer9Tiles`), i.e. +25
to +37 ms per tile in the worker. The far ring builds the table only for a
tile that admits an unmapped far-hatch body. First-detailed-tile arrival moved
+0.2 to +5 s in four poses and -5 s at Phoenix: inside this machine's noise
today, not proven either way.

### Frames

Flag on, `node scripts/look-pass-capture.cjs --label=truth-on-diag --url=http://localhost:3321 --posefile=scripts/world-pass-poses.json --shots=... --flags=WORLD_TRUTH,WORLD_PASS_DIAG --out=<worktree>/.graphics-review/world-pass/truth/on`;
flag off on the same server: `.../truth/off`. The base-1/2/3 frames of the
integration tree are the same arm as `off`.

- phoenix-suburb: the office park of 8 to 12 storey slabs is gone; the strip
  is one- and two-storey retail, low warehouses and a hipped house. The
  clearest single change of the stream.
- phoenix-mid: from 1,500 m the dense mid-rise carpet becomes a low suburb
  with the arterial grid readable.
- lagos: 1 to 3 storey fabric instead of 3 to 6 storey blocks.
- dubai: mapped towers unchanged; the podiums and villas around them drop.
- paris: a more even 6 to 7 storey fabric.
- tokyo, brooklyn, nyc-low: almost unchanged (mostly mapped, or the
  unmapped share was already in the right range).
- iowa-farm: the few farm buildings are lower; nothing new appears.

## Milestones

- **M1 heights: done** (commit "World Pass A (TRUTH) M1"). One law in
  `heightOf` for the near ring, the far mass and the style classifier;
  mapped heights untouched; storeys; continuous context; `sid`.
- **M2 admission and the small band: partial.** Done: the floor tests the
  whole footprint (seam fragments kept, `smallBand`), and empty tiles stay
  empty. NOT started: the lean 15 to 70 m2 bodies (`small-band.js`). The
  bodies cannot be lean inside today's building mesh (55 bytes per vertex:
  position, colour, anchor, uv, style, normal; a 4-corner box is 20 vertices,
  about 1.2 KB with its indices, so Tokyo's ring would add about 34,000
  bodies and 40 MiB on a frame already 48 MiB over the Ultra geometry row).
  The rule's "at most 20 bytes per vertex or instanced" needs its own buffer
  and draw in the engine, which stream B owns (seam request 3).
- **M3 typology and roofs: partial.** Roof forms follow the inferred class
  through the existing dispatch: the class hint sets the style family
  (house -> family 0 pitched, terrace -> family 6, apartment -> 1,
  industrial and big box -> 5), and the regional palettes and
  `refineArchitectureStyle` already make non-domestic families flat
  (`roofRise` 0) and arid / South Asian houses flat. New: an inferred
  terrace house wears the coverage gable like a detached one. Not done: any
  new roof form in `roofs.js` (hipped terrace rows, mansards from evidence),
  and roof forms for MAPPED buildings by class.

## Shared-file edits

None. No edit to `vector-tile.worker.js`, `worker/{geom,tile-ctx,result,stages}.js`,
`sat-buildings/index.js`, `world-pass.js` or `world-pass-stages.js`.
`lib/fly/fly-constants.js`: only the `WORLD_TRUTH` block (its `worker`
tunables). `lib/fly/building-profiles.js`: only
`buildingClassificationHeight` (an optional fourth argument, the law's
height; absent, the legacy guess).

The truth stage counters ride `tileCtx.stages` without a stages.js edit:
`heightOf` adds a nested `truth: { cls, prov, sidMapped }` and admission a
`truthRescued` number, both only with diag AND the stream on
(`world-pass-stages.js` already sums nested objects).

## Seam requests

1. **C REACH (`worker/sat-skyline.js`)**: the far `heightOf` result carries
   `sid` while the truth stream is on. Please set `it.sid` from it on the far
   items (`const { h, sid } = heightOf(...)`), so the stand-ins share the near
   ring's stable id. Heights already agree without it (the table is keyed by
   the admission's polygon id, which both rings compute the same way).
2. **B ARRIVAL / D LOOK / merge (`sat-buildings/index.js` `hash2`,
   `colour.js` `pickByHash(..., item.id)`, `roofs.js` is mine)**: derive the
   per-building hashes from `item.sid ?? item.id`, so the two halves of a
   seam building get the same tone. With the stream off `item.sid` is absent
   and nothing changes.
3. **B ARRIVAL (`emit.js` / `sat-building-engine.js` / `SatBuildingLayer.jsx`)**:
   the small band needs a lean body buffer: per vertex at most 20 bytes
   (position as tile-local int16 decimetres x3 = 6, anchor index or int16
   anchor x2 = 4, packed colour rgba8 = 4, 2 bytes spare; flat shading from
   derivatives, no normal, no uv, no style) or one instanced box per body
   (anchor, half extents, yaw, height, colour: about 24 bytes per body), drawn
   in the colour pass and in shadow cascade 0 only, draped by the same anchor
   pass, never counted toward a tile's emptiness or the collision columns.
   With that contract, `small-band.js` emits `out.satBuilding.small`
   (simplified ring of at most 6 vertices, flat roof) for the 15 to 70 m2
   band only while `truth.smallBand` is on.

## Ported techniques

None ported. FableFlight's `src/buildings.rs` was read (the HCLASS distance
scaling near line 257, the roof solver near 349-492); its height default is a
flat 5 to 6 m and was not used. The second-moment equivalent rectangle in
`typology.js ringShape` is standard polygon geometry, not from FableFlight.

## Open

- The lean small band (M2b, seam request 3). Tokyo's ring has about 19,000
  whole footprints per 9 tiles in the band, London 7,800, Lagos 9,900.
- The `sid` is stable only for footprints that fit inside both tiles'
  64-unit buffers; longer seam buildings still get two ids (and can get two
  heights: 3 to 37 % of seam pairs disagree, Dubai worst).
- Evidence and cover are per tile: a class can step a storey at a tile edge
  when its two tiles' mapped samples differ. Seam-cut footprints skip the
  evidence for this reason.
- The priors are authored per region (`WORLD_TRUTH.worker.regions`) and
  calibrated only against the hold-out above; no Overture or lidar truth
  was used (keyless, but out of this stream's sources). The hold-out is on
  mapped buildings, which are biased toward the tall.
- Paris inferred heights sit at the top of the 6 to 7 storey target (21.5 m,
  p90 24 m) with little spread: an even fabric, but a uniform one.
- The worker cost of the fact table (+25 to +37 ms per near tile) is paid
  again in the far worker for every tile with an unmapped far-hatch body.
- M3: new roof forms (hipped terrace rows, mansards on evidence), roofs of
  mapped buildings by class.
- Not run with the flag on: the browser building harnesses
  (`verify-sat-buildings`, `-skyline`, `-suburbia`, `-roof-variety`, `-seam`);
  they pin the flag off. `verify-suburbia` (A)/(B) read the R19 typology
  telemetry, which the law replaces when on.

## Round 2

2026-11-17. Built on the integration head `d40dfd25` (fast-forward merge:
the four wave-1 streams, the two merge seams, protocol 26). The flag still
ships `enabled:false`. Every number here was taken this round, on this
machine, through my server (:3321); the old base frames were not used
(OpenFreeMap changed its planet build on 2026-11-15).

Evidence lives in `<integration worktree>/.graphics-review/world-pass/r2/truth/`:
frames `r1-control/`, `r1-truth/`, `r1-all4/` (the wave-1 law, shot before any
round-2 edit) and `r2-control/`, `r2-truth/`, `r2-all4/` (this round), crops in
`crops/`, budgets in `budget-r1/` (seven arms) and `budget-r2/` (three arms),
per-tile states in `tiles-r1/` and `tiles-r2/`, the node probe in
`probe-r1.json`, `probe-r2.json`, `probe-r2-new.json`, the flags-off proof in
`proof-off-*.txt` and the gate logs in `gate-*.log`.

New tools (not product code):

- `scripts/wp-truth-r2-probe.mjs`: the law against the legacy rule on the
  recorded tiles (build `20261101_080013_pt`), 12 tuning places and 23
  hold-out sets. Hold-out (up to 24 m and all heights), the inferred-height
  distribution (p10 / p50 / p90, the share on the most common height, the
  share at the cap, storeys per class), the house storey share, big
  unmapped footprints drawn under 9 m, GEOMETRIC seam pairs (no sid used:
  the wave-1 verifier's matcher), empty tiles. `--seamDebug` prints the
  pairs that disagree.
- `scripts/wp-truth-tiles-live.cjs`: per arm, every near-ring tile and
  far-mass group at a pose with its state, so an empty-count change can be
  told apart from a change in which tiles are resident.
- `scripts/wp-truth-groupcount.mjs`: mapped footprints admitted in given
  far-mass groups (16 z14 tiles each).
- `scripts/wp-truth-poses.json`: `powell-subdiv2` and `tokyo-akasaka` (the
  verifier's poses). `powell` added to `scripts/world-pass-poses.json`
  (40.158, -83.075, altM 350) as asked.

### 1. Powell: the US house prior (fixed)

Cause: one US region, house mode 1 storey, calibrated on Phoenix and LA.
Change: `truthRegion` splits the USA and Canada into `us-sunbelt` (lat under
36.5, or west of -114 and under 42) and `us` (everything else); a class prior
is now `[lo, hi, mu]` with a centre `mu` that can be fractional and a spread
around it (section 3). Houses: `us` mu 1.8 (about 75 % two storeys),
`us-sunbelt` mu 1.25 (about 70 % one storey).

Share of inferred houses with 2 or more storeys (node, 3 x 3 tiles), wave 1 ->
round 2: Powell (the new pose) 0.12 -> 0.74, Powell north (the old pose)
0.12 -> 0.74, Iowa farms 0.14 -> 0.78, Seattle suburb 0.27 -> 0.70; hold-out
Columbus 0.70, Toronto 0.73. One-storey places stay one-storey: Phoenix
suburb 0.11 -> 0.29 (71 % single), Phoenix shifted tile 0.16 -> 0.32, Owens
0.11 -> 0.24. Mapped house heights where they exist agree with the split:
Chicago p50 8 m (n 1,462), Seattle 8 m, Phoenix 4 m, LA 6 m.

Live (Ultra, same server): `crops/powell-subdiv2-zoom.png` stacks control,
wave 1 and round 2 on the verifier's Powell subdivision: wave 1's bungalows
are two-storey houses again, with a few single-storey ones mixed in.
`r2-truth/powell__noon.png` is the new pose. Phoenix
(`crops/phoenix-suburb-control-r1-r2.png`): the low retail and warehouses
stay low; no slab comes back.

### 2. Big unmapped footprints in dense centres (fixed, one residue)

Causes (the verifier's): "sparse" was the 3 x 3 cell cover, which a park,
the palace grounds or a rail yard empties; railway land use counted as
industrial; any big sparse non-residential footprint became a big box.
Changes in `typology.js`:

- an open-land mask (water, landcover wood / grass / wetland / sand / rock /
  ice, landuse railway / cemetery / pitch / track / playground / stadium),
  16-unit cells over the tile and its buffer, scanline-filled from the
  polygon edges; it is left out of the cover denominators (never below
  `openFloor` 0.4 of a window);
- the class reads `coverWide`, a 5 x 5-cell window, open land left out;
- railway is no longer industrial land use;
- a big box needs commercial land use, or a car-scale region (`us`,
  `us-sunbelt`, `oceania`, `arid`, `latin`) in a tile whose corrected cover
  is under 0.15; any other big sparse footprint is a `block`; a mid-size
  sparse one in a dense tile is an `apartment`, not `commercial`;
- civic in `us` and `east-asia` is density-driven over 2 to 5 storeys.

Unmapped footprints of 1,000 m2 or more drawn under 9 m (node), wave 1 ->
round 2: Tokyo 170 -> 12 (big boxes 148 -> 2), Tokyo shifted 132 -> 42,
London 76 -> 47, NYC 30 -> 9, Brooklyn 22 -> 8, Paris 16 -> 11, Seoul
150 -> 30, Madrid 61 -> 28, Mumbai 576 -> 295, Berlin 29 -> 9. Suburbs keep
their low boxes (Phoenix 751 -> 569, Powell 96 -> 86). Live:
`crops/tokyo-akasaka-control-r1-r2.png` (control, wave 1, round 2): the flat
3-storey carpet and the sheds by the park are a varied mid-rise edge again.
Residue: London keeps 26 low industrial bodies in dense cover. They stand on
real `landuse=industrial` polygons (railway is no longer counted), so they
were left as industrial.

### 3. A believable spread, and a wider hold-out (fixed; losses listed)

Cause: a density class mapped cover to ONE storey count and then clipped a
one-storey jitter at the prior's top, so a dense core piled onto the top
storey; sparsely mapped evidence averaged with the prior was clipped the
same way. Change (`height.js truthHeight`):

- a class with a centre `mu` draws round(mu + 0.45 z); a density class
  centres on lo + (hi - 0.4 - lo) f, f = the open-land-corrected cover
  blended with the footprint's size (`spread.area`: bigger plates stand
  taller in the same street), and draws round(m + 0.75 z), up to hi + 1;
  z is a bounded, roughly normal draw from the building's sid, so it is
  deterministic per building and the same from either side of a seam;
- where the class is well mapped in the tile (30 % or more) the building
  takes its own quantile (0.15 to 0.85, from its sid) of the area-matched
  mapped sample, up to hi + 1 storeys and `maxEvidenceM` 30 m (Paris and
  Madrid map a quarter of their blocks over 24 m); everything else stays
  capped at 24 m;
- sparsely mapped evidence moves the centre, never past hi - 0.4.

Inferred heights (node). Share on the single most common height (0.5 m
bins), wave 1 -> round 2: Paris 0.55 -> 0.36, Tokyo 0.54 -> 0.29, Madrid
0.51 -> 0.36, Seoul 0.49 -> 0.31, Tokyo shifted 0.61 -> 0.52, Dubai
0.57 -> 0.46, Phoenix 0.77 -> 0.61. Tokyo's apartments were 69 % at 7
storeys; now 5: 13 %, 6: 38 %, 7: 36 %, 8: 10 %. p10 / p50 / p90: Paris
18.4 / 21.5 / 24.0 -> 15.8 / 21.5 / 24.6, Tokyo 9.3 / 9.6 / 21.6 -> 6.4 / 9.6
/ 21.6, Madrid 15.4 / 21.3 / 21.7 -> 15.3 / 18.6 / 21.7. Paris now sits at
8 storeys (24.5 m) for 33 % of its unmapped buildings: that is its own mapped
sample (mapped Paris apartments p25 / p50 / p75 = 19 / 22 / 26 m) meeting
the hi + 1 ceiling, not the prior.

Hold-out: 12 tuning places plus 23 hold-out sets (7 tuning poses shifted 6
tiles, one of them, Dubai, with no buildings, and 16 cities never used to set
a number: Berlin, Chicago, LA suburb, Madrid, Seoul, Sydney, Sao Paulo,
Mumbai, Seattle suburb, Toronto, Columbus, Mexico City, Istanbul, Warsaw,
Singapore, Cairo). Median absolute error in metres, law wave 1 / round 2 /
legacy:

| place | set | mapped <= 24 m | all mapped |
|---|---|---|---|
| nyc | tuning | 2.53 / 2.47 / 5.44 | 4.73 / 4.59 / 8.67 |
| brooklyn | tuning | 1.70 / 1.66 / 5.25 | 1.72 / 1.68 / 5.25 |
| paris | tuning | 2.54 / 3.28 / 4.91 | 4.32 / 4.29 / 6.93 |
| london | tuning | 3.54 / 3.60 / 6.15 | 4.57 / 4.71 / 7.59 |
| tokyo | tuning | 5.25 / 5.00 / 6.34 | 11.53 / 11.70 / 11.49 |
| phoenix-suburb | tuning | 0.60 / 0.66 / 13.89 | 0.60 / 0.66 / 13.89 |
| lagos | tuning | 3.82 / 4.46 / 7.31 | 4.36 / 4.66 / 7.75 |
| dubai | tuning | 3.30 / 4.26 / 14.95 | 11.46 / 11.27 / 19.58 |
| powell | tuning | 2.52 / 2.38 / 3.94 (n 37) | same |
| nyc-oos | hold-out | 1.59 / 1.57 / 4.50 | 1.59 / 1.58 / 4.50 |
| paris-oos | hold-out | 3.54 / 3.53 / 4.20 | 4.31 / 4.37 / 4.80 |
| london-oos | hold-out | 1.70 / 1.67 / 6.53 | 1.71 / 1.68 / 6.58 |
| tokyo-oos | hold-out | 1.64 / 1.65 / 3.75 | 1.68 / 1.69 / 4.00 |
| phoenix-oos | hold-out | 1.52 / 1.63 / 13.53 | same |
| lagos-oos | hold-out | 4.41 / 4.41 / 11.22 (n 46) | same |
| berlin | hold-out | 3.35 / 3.30 / 3.56 | 3.50 / 3.50 / 4.09 |
| chicago | hold-out | 1.69 / 1.69 / 6.00 | 2.42 / 2.55 / 6.84 |
| la-suburb | hold-out | 1.15 / 0.72 / 9.84 | 1.17 / 0.72 / 9.84 |
| madrid | hold-out | 3.34 / 3.44 / 4.80 | 4.75 / 6.00 / 7.13 |
| seoul | hold-out | 5.00 / 5.53 / 7.33 | 20.19 / 19.28 / 18.84 |
| sydney | hold-out | 2.48 / 2.49 / 8.27 | 4.28 / 4.32 / 8.88 |
| sao-paulo | hold-out | 2.43 / 2.49 / 7.30 | 2.63 / 2.69 / 8.54 |
| mumbai | hold-out | 4.62 / 4.57 / 7.74 | 10.38 / 9.73 / 9.15 |
| seattle-suburb | hold-out | 3.55 / 3.73 / 13.45 | 4.50 / 4.56 / 13.97 |
| toronto | hold-out | - / 1.67 / 6.33 | - / 3.28 / 7.87 |
| columbus | hold-out | - / 1.61 / 7.89 | - / 1.63 / 8.13 |
| mexico-city | hold-out | - / 4.34 / 8.53 | - / 6.38 / 9.94 |
| istanbul | hold-out | - / 7.74 / 6.13 | - / 9.41 / 7.75 |
| warsaw | hold-out | - / 3.65 / 7.17 | - / 4.71 / 7.51 |
| singapore | hold-out | - / 2.50 / 6.85 | - / 5.32 / 8.95 |
| cairo | hold-out | - / 5.37 / 10.40 | - / 11.38 / 11.53 |

Where it still loses to the legacy rule:

- **Istanbul, both columns** (7.7 against 6.1 m up to 24 m; signed -6.5 m).
  `living-regions` classes Turkey as `arid` (house up to 600 m2, one or two
  storeys), and Istanbul's small footprints are five-to-seven-storey
  apartment buildings (mapped "houses" p50 19 m). Not tuned on: it is a
  hold-out city. The fix is a region entry for Turkey (Mediterranean
  priors), which then needs a new out-of-sample city.
- **Towers included: Tokyo (11.7 against 11.5), Seoul (19.3 against 18.8),
  Mumbai (9.7 against 9.2).** Their mapped buildings are towers the law will
  not invent (24 m cap; 30 m from a representative sample). Seoul and Mumbai
  improved from wave 1 (20.2, 10.4).
- The spread costs median error where the law used to answer with the
  median: Paris up to 24 m 2.54 -> 3.28, Dubai 3.30 -> 4.26, Lagos 3.82 ->
  4.46. Drawing a building's own quantile is worse on a hold-out median and
  is what stops a district being one height. Still under the legacy rule in
  every one of them.

### 4. Seam halves (fixed; measured over every geometric pair)

The wave-1 number (63 to 97 %) counted only pairs that already shared a sid.
Measured as the verifier did (a point 0.75 units across the edge of A's
clipped fragment must lie in B's raw ring; no sid used), wave 1 agreed on 45
to 79 % of pairs in the tuning places and 33 to 86 % out of sample. Two
causes: a straddling footprint read per-tile facts (cells, neighbours, POIs),
and OpenFreeMap does not cut the buffer part of a footprint identically in
two tiles (a vertex moves by a few units; the far side is cut at each tile's
own buffer line), so the bounding-box sid differed.

Change: a footprint that crosses a tile edge reads every class and height
input inside the seam window the tiles share (+-60 units around the edge,
inside the 64-unit MVT buffer; +-192 along it): its area (the piece inside
the window when the building runs past it, which both tiles can tell), holes,
the land-use point (the piece's centroid), cover and open land (every
building and open polygon the tile carries in the window, buffer included,
on a world-aligned 16-unit lattice), shared corners, POIs, and the regional
prior at the seam. Its sid is the middle of its crossing on the edge line,
quantised to 16 units (about 7 m at z14). No evidence for a straddler (as in
wave 1).

Geometric pairs (unmapped halves), share agreeing within 0.01 m, wave 1 ->
round 2: Paris 0.56 -> 0.97 (175 pairs), London 0.45 -> 0.97 (156), Tokyo
0.68 -> 0.99 (271), Dubai 0.51 -> 0.97 (172), Lagos 0.75 -> 0.99, Phoenix
0.76 -> 0.99, NYC 0.67 -> 1.00, Brooklyn 0.76 -> 1.00; out of sample Berlin
0.33 -> 0.95, Chicago 0.41 -> 1.00, Paris-oos 0.59 -> 0.97, London-oos 0.55
-> 0.96, Madrid 0.77 -> 0.99, Toronto 1.00, Mexico City 0.99 (656 pairs).
The gap's p90 is 0 everywhere. The rest are pairs whose crossing midpoints
fall either side of a 16-unit bucket, or whose two tiles carry visibly
different buffer geometry (Berlin has one pair whose window cover reads 0.87
in one tile and 0.45 in the other).

The two seams recorded in FLY_WORLD_PASS.md are wired, both marked:

- `sat-buildings/index.js` (merge-owned): `hash2` from `item.sid ?? item.id`
  ("WORLD PASS A x merge seam").
- `sat-skyline.js` (REACH's file): the per-polygon far-mass item sets
  `it.sid` from `heightOf` when it returns one ("WORLD PASS A x C seam").

Both are inert with the flag off (`sid` is absent; the proof below).

### 5. Empty stays empty (not caused by TRUTH; designed elsewhere; proven)

Live, Ultra, iowa-farm, one page per arm on :3321 (`budget-r1/`, empty
counts, and `tiles-r1/`, per tile):

| arm | near-ring tiles empty | far-mass groups empty |
|---|---|---|
| control | 4 of 16 | 19 of 24 |
| WORLD_TRUTH | 4 | 19 |
| WORLD_ARRIVAL | 2 | 19 |
| WORLD_REACH | 4 | 15 |
| WORLD_LOOK | 4 | 19 |
| all four | 2 | 15 |

- TRUTH changes neither count, and no tile's state: round 2's TRUTH arm has
  the same 16 tiles and 24 groups as the control with 0 state differences,
  and round 2's all-four arm matches wave 1's all-four arm tile for tile
  (`tiles-r2/`).
- ARRIVAL: the 4 -> 2 is a different resident set, not a tile filling in.
  Its ring lookahead keeps 14/3929/6083 and 14/3929/6086 (both with
  buildings in every arm that loads them) instead of 14/3925/6084 and
  14/3925/6085 (empty in every arm that loads them). No tile that is empty
  in one arm is non-empty in another.
- REACH: the five groups that stop being empty (980/1522, 981/1520,
  981/1523, 982/1523, 983/1519) hold 246 to 1,112 mapped, admitted
  footprints each (`scripts/wp-truth-groupcount.mjs`). The legacy far mass
  drew only footprints of 900 m2 and more, so those farm towns were empty;
  REACH draws a stand-in for every admitted building, as designed. One group
  (982/1522, 1,383 footprints) goes the other way, non-empty to empty, under
  REACH's own admission. A group with no mapped buildings stays empty in
  every arm.

Round 2 (`budget-r2/`): Powell's far groups go 6 empty -> 6 with TRUTH and
6 -> 2 with all four, the same REACH pattern; I did not count Powell's groups
one by one.

So: no tile without mapped buildings gains a body in any arm. The empty-count
changes are a resident-set change (ARRIVAL) and the far ring now drawing the
small buildings that exist (REACH). The one REACH group that empties is
REACH's to read.

### 6. Budget (NOT fixed: the growth is not the small band)

Live, Ultra, 1600 x 900, one warm page per arm on :3321, `?flags=...,WORLD_PASS_DIAG` in every arm (`budget-r1/`: the wave-1 law, seven arms; `budget-r2/`: this round). Row: 900 draws, 8 M triangles, 256 MiB geometry.

| pose | arm | draws | triangles (M) | building MiB | geometry MiB |
|---|---|---|---|---|---|
| paris | wave 1, control | 383 | 6.41 | 320.4 | 413.5 |
| nyc-low | wave 1, control | 386 | 4.54 | 210.7 | 309 |
| paris | wave 1, truth | 383 | 6.44 | 312 | 405 |
| nyc-low | wave 1, truth | 386 | 4.53 | 209.3 | 307.5 |
| paris | wave 1, arrival | 384 | 6.41 | 211.3 | 304.5 |
| nyc-low | wave 1, arrival | 384 | 4.48 | 135.7 | 234 |
| paris | wave 1, look | 383 | 6.42 | 320.4 | 413.6 |
| nyc-low | wave 1, look | 386 | 4.52 | 210 | 308.3 |
| paris | wave 1, reach | 383 | 7.09 | 320.4 | 369.2 |
| nyc-low | wave 1, reach | 386 | 5.47 | 210.7 | 278.6 |
| paris | wave 1, ARRIVAL+REACH+LOOK | 384 | 7.09 | 255.4 | 304.2 |
| nyc-low | wave 1, ARRIVAL+REACH+LOOK | 384 | 5.48 | 159.7 | 227.5 |
| paris | wave 1, all four | 384 | 7.16 | 247.4 | 296.3 |
| nyc-low | wave 1, all four | 384 | 5.46 | 160 | 228 |
| paris | round 2, control | 383 | 6.41 | 320.4 | 413.5 |
| nyc-low | round 2, control | 386 | 4.54 | 210.7 | 309 |
| tokyo | round 2, control | 399 | 4.91 | 216.8 | 311.5 |
| phoenix-suburb | round 2, control | 369 | 2.71 | 168.4 | 250.6 |
| powell | round 2, control | 354 | 1.21 | 29.9 | 88.8 |
| paris | round 2, truth | 383 | 6.43 | 311.6 | 404.7 |
| nyc-low | round 2, truth | 386 | 4.53 | 209.1 | 307.3 |
| tokyo | round 2, truth | 400 | 4.86 | 212.4 | 307.1 |
| phoenix-suburb | round 2, truth | 369 | 2.43 | 138.6 | 220.8 |
| powell | round 2, truth | 354 | 1.20 | 28.1 | 87.1 |
| paris | round 2, all four | 384 | 7.14 | 246.5 | 295.3 |
| nyc-low | round 2, all four | 384 | 5.47 | 160 | 228 |
| tokyo | round 2, all four | 403 | 5.96 | 169.8 | 229.4 |
| phoenix-suburb | round 2, all four | 368 | 3.15 | 93.2 | 147.2 |
| powell | round 2, all four | 363 | 1.21 | 20.1 | 65.7 |

With all four flags on, round 2: nyc-low 228 MiB, 5.47 M triangles, 384 draws (inside); Tokyo 229 MiB (inside); Phoenix 147 (inside); Powell 66 (inside); **Paris 295.3 MiB (buildings 246.5) and 7.14 M triangles: 39 MiB over the row.** TRUTH is not where it comes from. Paris buildings, by arm: control 320.4, TRUTH 311.6 (-9), ARRIVAL 211.3, LOOK 320.4 (no change alone), ARRIVAL+REACH+LOOK 255.4, all four 246.5. ARRIVAL alone takes Paris to 211 MiB of buildings and 304.5 total (the far mass is still the legacy 49 MiB there); adding LOOK puts back 44 MiB of buildings (211 -> 255), and REACH takes the far mass from 49 to 5 MiB. TRUTH removes 8 to 9 MiB in both combinations measured (alone, and on top of the other three).

The integrator's reading ("the 15 to 70 m2 band is the growth") does not
hold: the small band is not built (M2b) and TRUTH removes bytes in every arm measured.
The Paris growth is LOOK on top of ARRIVAL: ARRIVAL packs vertex colours as
Uint8 (3 bytes, not 12) only when every colour of a tile is in [0, 1]
(`emit.js packUnit8`), and LOOK's wall-mode flag adds 4 (glass) or 8
(opaque) to the red channel of tagged walls, so any tile with one tagged
wall falls back to Float32 for every vertex. That mechanism is read from the
code; I did not count which Paris tiles fall back (the +44 MiB is the size
the arms measure, LOOK alone adds nothing, so it is the packing). Fix (not mine; B x D): carry the glass / opaque mode outside the
colour (a spare byte of the style attribute, or the alpha of a 4-byte
colour) and decode it there in the LOOK shader, so the colour packs to Uint8
in every tile. Removing houses to pay for it would break the rule this item
set (Brooklyn, Powell and Paris must keep their houses), so I did not.

### 7. The sid hash on mapped buildings (kept; flag-on only, proven)

`heightOf` returns a hash from the sid for mapped buildings only through
`truthNear`, which runs only while `worldPass.truth.on && heights`; the new
`hash2` seam reads `item.sid`, which admission sets only while the stream is
on. With every flag off the worker output is byte-identical to `c2bf5c06`
(proof below), so nothing that reaches the GPU changes with the flag off.

### Worker cost

Fact table per z14 tile, node, warm, alternating runs on a machine shared
with captures (so ranges, not points), wave 1 -> round 2, table only: NYC
31-36 -> 48-61 ms, Paris 32-40 -> 72-77, Tokyo 29-42 -> 68-79, Phoenix
11-23 -> 23-25. Table + admission + heights: NYC 44-49 -> 60-73, Paris 43-51
-> 82-89, Tokyo 38-56 -> 80-94. The new cost is the straddler windows (about 8 to 11 ms a
dense tile), the open-land mask and the wide windows. It is worker time, off
the main thread; arrival with the flag on is in the budget runs above and
was not separately proven faster or slower.

### Proofs and gates (round 2 tree)

- `node scripts/world-pass-worker-proof.mjs --check c2bf5c06 --ignore-protocol`:
  "IDENTICAL (top-level protocol field masked): 1062/1062 cases identical, 7308 buffers + 1062 meta objects compared against 'c2bf5c06'; 28 stage cases (0 bad); 0 unrecorded inputs" at the code commit (`proof-off-final.txt`).
- Node gates, exit 0: `graphics-unit.mjs`, `verify-true-earth-flags` (11),
  `verify-stylized-earth` (22/22), `verify-city-horizon`,
  `verify-building-handoff`, `verify-attribution` (4);
  `wp-truth-probe.mjs` (the wave-1 probe) runs; `wp-reach-node-bench.mjs`
  PASS G1 to G5 (REACH reads `heightOf`).
- eslint on the changed files: `npx eslint` on the five changed product files and the three new scripts: no errors, no warnings.

### Not measured

- The owner's 5080 motion check.
- High tier this round (Ultra only). The law is the same worker output at a
  smaller ring.
- The live stage counters (`?flags=WORLD_PASS_DIAG` ran in the budget arms,
  but I read only the budget and empty counts from them).
- Golden hour and night frames; noon only.
- Seam agreement live (node only, on the recorded build; the live build
  changed on 2026-11-15).

### Incident

Running my first round-2 captures I invoked a script by the name `cap.sh` in
the session's shared scratchpad; the REACH stream had since written its own
`cap.sh` there, so six copies of REACH's capture script ran against REACH's
server (:3323) for about six minutes before I stopped them. They rewrote
`r2/reach/it1-control/*` and `r2/reach/log-it1-control.txt` /
`log-it1-all4.txt` (23:28 to 23:33) with flags-off and all-four captures of
the same poses from REACH's server, and left a stale GPU slot lock
(`slot-2`, pid 28088, dead), which I removed. REACH should re-shoot `it1` if
its record depends on those files. My scripts now live under
`scratchpad/truth-r2/`.

### Open after round 2

- Budget: the LOOK x ARRIVAL colour packing (above), not TRUTH's.
- Istanbul (Turkey classed arid) and towers in Tokyo, Seoul, Mumbai.
- The lean 15 to 70 m2 band (M2b) is still not built; it needs ARRIVAL's
  lean body buffer (wave-1 seam request 3) and must not be built before the
  Paris budget is back inside the row.
- M3 roof forms, as in wave 1.
- C to A (`WORLD_REACH.worker.houseMaxAreaM2` to 0) is REACH's call: the far
  heights now match the near ring for every unmapped stand-in.

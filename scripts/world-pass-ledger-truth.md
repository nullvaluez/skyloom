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

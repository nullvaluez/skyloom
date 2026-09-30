

## Vector tiles (MVT) from Overture Maps — `build_mvt.sh`, `extract.py`, `tile_blocks.mjs` (trailer-mvt-1)

Real-world OpenMapTiles-schema vector tiles for the seven trailer venues, built from
**Overture Maps release 2026-09-23.1** (AWS open data, read with pyarrow S3 through the proxy).
They replace the fixture's synthetic `/mvt/{z}/{x}/{y}.pbf` and drive satellite 3D buildings
(real heights + building parts), the night road network + runway edge lights, water
(glint/reflection mesh, boats, shoreline, ocean coverage), the earth-surface ground classes,
vegetation scatter and airports.

**Output:** `/tmp/claude-0/world/mvt/{z}/{x}/{y}.pbf` — Mapbox Vector Tile v2, **uncompressed**,
extent 4096, buffer 64, numeric feature ids. Zero-length file = "nothing here" (serve 200, empty
body — never 404). `mvt/manifest.json` (coverage per venue per zoom, tile/byte counts, extract
stats, sources, licences) and `mvt/validation.json` (real-worker probe results).

### Pipeline

1. `ovt_index.py` — reads ONLY the parquet footers of every Overture file of a type (512 building
   files, 128 segment files, …) and caches per-row-group `bbox.{xmin,xmax,ymin,ymax}` statistics
   (`/tmp/claude-0/world/cache/ovt-index/*.json`, ~1 min for everything). No file is ever downloaded
   whole.
2. `ovt_read.py` — for a lon/lat box, fetches only the intersecting row groups and only the
   needed columns, filters rows on the per-row bbox struct; cached as local parquet
   (`cache/ovt/<loc>/<type>_{z14,z12,far}.parquet`).
3. `extract.py <loc>` — maps Overture → OMT properties (tables below), trims inland water by the
   ocean, splits road segments at `is_bridge`/`is_tunnel` linear-reference ranges, joins building
   parts, synthesises runway centrelines for polygon-only runways, and writes gzip'd GeoJSON
   **blocks** (one per z12 tile for z12–z14, one per z9 tile, one per z10 tile for z10/z11) with a
   per-feature `[minz,maxz]`. Big polygons are pre-clipped to the block (+8% pad).
4. `tile_blocks.mjs <loc>` — cuts every block with the repo's **geojson-vt 5.0.2 + vt-pbf 3.1.3**
   exactly like `scripts/r24-fixture/mvt.mjs` (indexMaxZoom 0, tolerance 0 for building/aeroway
   else 2, extent 4096, buffer 64, generateId false, `fromGeojsonVt(..., {version:2, extent:4096})`)
   with `maxZoom 14`, so z≤13 get geojson-vt's normal per-zoom simplification and z14 is exact.
   geojson-vt rewinds rings to spec winding (exterior first, clockwise in y-down tile space), which
   is what `classifyRingsSat` expects.
5. `sources_sample.py`, `make_manifest.py`, `validate_worker.cjs` (below).

Everything is idempotent/resumable: cached index + parquet reads, `blocks/<loc>/DONE.json`,
per-block `.done` markers, atomic tile writes (tmp + rename). `extract.py <loc> --force` /
`tile_blocks.mjs <loc> --force` rebuild one venue.

### Coverage policy (per venue, from `../locations.json`)

| z | area | content |
|---|---|---|
| 14 | core box + 4 km | everything; all buildings + building parts |
| 13 | core box + 12 km | all roads incl. service/track/path; buildings ≥ 300 m² (outlines only) |
| 12 | core box + 2 z12 tiles | water, waterway, landuse, landcover, park, aeroway, roads ≤ `minor`, rail |
| 10–11 | same area as z12 | toy-only (Neon "ultra" ring); generalised far data |
| 9 | centre ± `far_km` | ocean + water ≥ 5 ha (simplified ~20 m), ESA land cover ≥ 10 ha (+ ESA urban → `landuse=residential`), OSM landuse ≥ 25 ha, motorway/trunk/primary (no links, no tunnels); **no buildings** |

(The engine requests MVT only at z9/z12/z14 surfaces, z13 roads/clutter, z14 buildings/veg/skyline,
and toy z10–z14 — never above z14.)

### Mapping (Overture → OMT properties the worker reads)

**building** (buildings/building + buildings/building_part, `is_underground` dropped):
`render_height` = `height`, else `num_floors × 3.2` m, else **omitted** (the engine infers; no
synthetic 5 m). `render_min_height` = `min_height`, else `min_floor × 3.2` (only when < height).
String props passed through for the worker's `archTags`: `class`, `subtype`, `facade_material`,
`roof_shape` (`roof_material` deliberately dropped: "concrete" roof material would force the
concrete/office facade family). Outlines whose parts are present get **`hide_3d: true`** at z14 and
the parts (with the parent's class/subtype) are emitted instead — OMT behaviour; e.g. the Empire
State Building renders as its 11 setback parts, One WTC as its 417 m body + 541 m spire.
Features are written tallest-first. Numeric `id` = first 32 bits of the Overture GUID.
The worker keeps every footprint (visuals path); its 500-per-tile cap only picks the detailed subset
by volume.

**transportation** (transportation/segment): road class motorway/trunk/primary/secondary/tertiary
→ same; residential/living_street/unclassified/unknown → `minor`; service → `service` (+`service`
= driveway/parking_aisle/alley…); track → `track`; footway/sidewalk/crosswalk/steps/path/
pedestrian/cycleway/bridleway → `path` (+`subclass`); `*_link` → same class + `ramp: 1`; rail
standard/narrow gauge → `rail`, subway/light_rail/monorail/tram → `transit`; water segments →
`ferry`. `road_flags`/`rail_flags` `is_tunnel`/`is_bridge` → `brunnel` (segments are split at the
flag's `between` range, tunnel wins); `is_indoor`/`is_abandoned`/`is_under_construction` ranges
dropped. A single whole-segment `width_rules` value → `width` (m). Infrastructure `pier` →
`class: pier` (z13+). Min zooms: motorway 4, trunk 5, primary 7, secondary 9, tertiary 11, minor
12, rail 12, service/track/path 13.

**aeroway** (base/infrastructure, subtype `airport`): *_airport/airstrip/seaplane_airport →
`aerodrome` (polygon); heliport; runway / taxiway (+taxilane) / apron / helipad (lines and polygons,
`surface` passed through). **Runway LINES** exist in Overture for all venues checked (they drive
the edge lights); any runway present only as a polygon additionally gets a centreline LineString
along its minimum-rotated-rectangle long axis.

**water** (base/water): `ocean` → `ocean`; lake/pond/reservoir/water/wastewater → `lake`/`pond`;
river/canal/stream polygons and water/{river,tidal_channel,canal} → `river`; dock → `dock`;
human_made/swimming_pool → `swimming_pool` (z13+). `is_intermittent` → `intermittent: 1`
(integer). `physical` (bay/strait/shoal/cape name polygons) dropped. **Ocean:** Overture ships
coastline-derived `ocean` polygons (1° cells); they are unioned per venue, so open-ocean tiles are
one covering `ocean` polygon and coastal tiles follow the coastline (Palm Jumeirah, The World,
Manhattan/Hudson/East River/NY Harbor, Port Jackson, Guanabara Bay verified). **One water surface everywhere:** all
permanent non-pool water polygons are dissolved (OSM water overlaps itself, e.g. Port Jackson +
Sydney Cove/Farm Cove) and the ocean is cut out of the result (OSM harbour/river polygons lie inside
the coastline ocean: NY Upper Bay, Hudson, East River), each dissolved part keeping the class/id of
its largest contributor. Without this the satWater glint mesh draws twice and the worker's SUMMED
`waterCoverage` overshoots (measured: NYC FiDi 1.0 vs true 0.54; Sydney Opera House tile 0.77 vs
true 0.39).
**waterway**: river/canal/stream/ditch/drain lines.

**landuse** (base/land_use): residential → `residential`; developed/{commercial,retail,industrial,
garages,brownfield} (+works/depot/port → industrial); railway; cemetery; military;
school/university/college/kindergarten; hospital; pitch/playground/stadium/track; zoo/theme_park;
quarry; landfill.

**landcover**: base/land (OSM natural) forest → `wood`; shrub → `grass`/`scrub|heath|shrubbery`;
grass → `grass`/`grassland|meadow`; rock → `rock`/`bare_rock|scree|…`; sand/desert → `sand`;
wetland → `wetland`/`marsh|tidalflat|…`; glacier → `ice`/`glacier`. OMT-landcover rows of
land_use: managed/grass, meadow, farmland/farmyard/orchard/vineyard/plant_nursery, allotments/
garden/flowerbed, village_green, recreation_ground, golf (bunker → sand). **ESA WorldCover-derived
base/land_cover (cartography level 8–15) is painted FIRST** (OSM overrides it): forest → wood,
shrub/grass → grass, crop → farmland, wetland/mangrove → wetland, moss → grass/tundra, snow →
ice/glacier; `barren` → sand in dubai, rock in alps/rio, dropped elsewhere (ESA "bare" in cities is
concrete); `urban` only at z9 (→ landuse residential).

**park**: land_use park/dog_park → `park`; protected nature_reserve/national_park/protected_area.

### Validation (real worker, in Node) — `validate_worker.cjs`

Imports `lib/fly/toy-world/vector-tile.worker.js` with a comlink stub (the `verify-seam.js`
pattern), starts `mvt_server.mjs` in-process, points `FLY_FIXTURE_URL` at it and uses
`installNodeFetchFixture()` from `scripts/_fixture.js`, then runs `api.buildTile` for named probes:
`sat-buildings` (z14, visuals), `sat-roads` (z13), `sat-veg` (z14), `earth-surface` (z14/256,
z12/128, z9/128). Results: `mvt/validation.json`; table in `logs/validate.log`.

RESULTS_TABLE

### Known limitations

- **Open-water z14 tiles with no building get no water glint.** `buildSatBuildings` returns
  `'zero'` before its water pass when a tile has no admissible building, so such tiles report
  `waterCoverage 0` and no `satWater`; the engine's ocean fill (`SAT_WATER.oceanFill`, needs 2 of 4
  neighbours with coverage ≥ 0.6) then bridges only ONE tile out from a shore tile. Count of such
  tiles: WATERONLY_COUNTS. This is engine behaviour (OpenFreeMap tiles behave the same); fixing it in
  data would mean fabricating buildings on the water, which I did not do. Engine-side fix: let
  `buildSatBuildings` run its water pass when `items.length === 0`, or let filled tiles vote.
  Shots whose near field is open sea will show the Sentinel imagery water without glint beyond one
  tile from the coast.
- Building heights: NYC 94% measured (NYC LiDAR via OSM); other venues are dominated by Microsoft
  ML / Google Open Buildings footprints without heights (e.g. Dubai 1% measured, 8% from floors) —
  the engine infers those; landmark towers (Burj Khalifa 828 m, Marina towers) do carry heights.
- `landcover`/`landuse` come from OSM via Overture, which is sparser than OpenFreeMap in places;
  ESA polygons fill natural classes. `park` is administrative (the engine ignores it in satellite).
- Overture road classes `unknown` are mapped to `minor`.
- No `transportation_name`, `place`, `poi`, `water_name`, `housenumber` layers (never read).

### Licences / attribution

Overture Maps Foundation release 2026-09-23.1. Buildings, building parts, transportation, water,
land, land_use, infrastructure: **ODbL-1.0** (OpenStreetMap contributors; plus Microsoft ML
Buildings, Google Open Buildings and TomTom rows that Overture distributes under ODbL/its terms).
land_cover: **CC-BY-4.0** (ESA WorldCover, contains modified Copernicus Sentinel data).
Attribution string: `© OpenStreetMap contributors · Overture Maps Foundation · ESA WorldCover
(contains modified Copernicus Sentinel data) · Microsoft ML Buildings · Google Open Buildings`.

### Rebuild

```bash
cd scripts/trailer/world
sh build_mvt.sh                      # all venues, in order nyc dubai sydney rio alps paris london
sh build_mvt.sh nyc                  # one venue (resumes; skips finished blocks/tiles)
nice -n 15 python3 extract.py nyc --force && nice -n 15 node tile_blocks.mjs nyc --force   # rebuild one venue
nice -n 15 python3 make_manifest.py  # mvt/manifest.json
nice -n 15 node validate_worker.cjs nyc dubai   # real-worker probes -> mvt/validation.json
node mvt_server.mjs                  # optional stand-alone /planet + /mvt server on :3290
python3 preview_tiles.py 14 4821 6155 4826 6162 out.png 160   # debug mosaic
```
Timings on this box (4 cores shared with a capture, niced): NYC extract ~6.5 min + tiling ~4–8
min; the smaller venues 2–5 min each. Disk: MVT ~MVT_SIZE; caches under `/tmp/claude-0/world/cache`.

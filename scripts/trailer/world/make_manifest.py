#!/usr/bin/env python3
"""Write /tmp/claude-0/world/mvt/manifest.json from the per-location build records.

Inputs: cache/blocks/<loc>/DONE.json (extract stats), cache/blocks/<loc>/TILES.json
(tiler stats), cache/sources/<loc>.json (sampled Overture source datasets/licenses),
mvt/validation.json (worker validation, optional).
"""
import datetime
import json
import os

import mvt_common as C

OUT = os.path.join(C.MVT_DIR, 'manifest.json')


def load(p, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


def main():
    locs = C.locations()
    man = {
        'generated': datetime.datetime.utcnow().isoformat() + 'Z',
        'product': 'Skyloom trailer local vector tiles (OpenMapTiles-schema subset)',
        'path': '/tmp/claude-0/world/mvt/{z}/{x}/{y}.pbf',
        'encoding': 'Mapbox Vector Tile v2, UNCOMPRESSED (no gzip), extent 4096, buffer 64/4096; '
                    'geojson-vt 5.0.2 (maxZoom 14, indexMaxZoom 0, tolerance 0 building/aeroway else 2) + vt-pbf 3.1.3; '
                    'numeric feature ids (32-bit, from the Overture GUID); spec winding (geojson-vt rewinds). '
                    'A zero-length file = "nothing here": serve as HTTP 200 with an empty body, never 404.',
        'layers': ['building', 'transportation', 'aeroway', 'water', 'waterway', 'landuse', 'landcover', 'park'],
        'zooms': {'9': 'far ring: ocean+large water, ESA landcover (+urban->landuse residential), large OSM landuse, '
                        'motorway/trunk/primary; no buildings',
                  '10-11': 'toy-only (Neon ultra ring); same generalised data as z9, over the z12 area',
                  '12': 'core + 2 z12 tiles: water, waterway, landuse, landcover, park, aeroway, roads <= minor',
                  '13': 'core + 12 km: all roads (service/path/track only here and z14), buildings >= 300 m2 (outlines)',
                  '14': 'core + 4 km: everything, all buildings + building parts (outline hide_3d when parts exist)'},
        'source': {'name': 'Overture Maps Foundation', 'release': '2026-09-23.1',
                   'bucket': 's3://overturemaps-us-west-2/release/2026-09-23.1/',
                   'types': ['buildings/building', 'buildings/building_part', 'transportation/segment',
                             'base/water', 'base/land', 'base/land_use', 'base/land_cover', 'base/infrastructure']},
        'licenses': {
            'ODbL-1.0': 'OpenStreetMap-derived themes (buildings, building parts, transportation, water, land, land_use, '
                        'infrastructure) incl. Microsoft ML Buildings / TomTom rows released by Overture under ODbL',
            'CC-BY-4.0': 'base/land_cover (ESA WorldCover 10 m, derived from Copernicus Sentinel data)',
        },
        'attribution': '© OpenStreetMap contributors; Overture Maps Foundation (overturemaps.org); '
                       'ESA WorldCover (contains modified Copernicus Sentinel data); Microsoft ML Buildings',
        'locations': {},
    }
    total_tiles = total_bytes = 0
    for name in C.ORDER:
        d = os.path.join(C.CACHE, 'blocks', name)
        done = load(os.path.join(d, 'DONE.json'))
        tiles = load(os.path.join(d, 'TILES.json'), {}).get('tiles', {})
        entry = {'status': 'built' if (done and tiles) else ('extracted' if done else 'not built')}
        cov = C.coverage(name, locs[name])
        per = {}
        for z, ts in sorted(cov.items()):
            keys = [f'{z}/{x}/{y}' for x, y in ts]
            have = [tiles[k] for k in keys if k in tiles]
            ne = [t for t in have if t['bytes'] > 0]
            xs = [x for x, _ in ts]
            ys = [y for _, y in ts]
            per[str(z)] = {'tiles': len(ts), 'written': len(have), 'non_empty': len(ne),
                           'bytes': sum(t['bytes'] for t in have),
                           'max_tile_bytes': max([t['bytes'] for t in have] + [0]),
                           'x_range': [min(xs), max(xs)], 'y_range': [min(ys), max(ys)],
                           'bbox_lonlat': [round(v, 5) for v in C.union_box(z, ts, 0)]}
            total_tiles += len(have)
            total_bytes += per[str(z)]['bytes']
        entry['coverage'] = per
        # z14 tiles that carry water but no building feature: the worker's
        # sat-buildings path returns before its water pass there, so they get no
        # satWater glint (engine ocean fill bridges only one tile from shore).
        w14 = [v for k, v in tiles.items() if k.startswith('14/') and v['counts'].get('water')]
        entry['z14_water_tiles'] = len(w14)
        entry['z14_water_tiles_without_buildings'] = sum(1 for v in w14 if not v['counts'].get('building'))
        entry['center'] = [locs[name]['lat'], locs[name]['lon']]
        entry['core_km'] = locs[name]['core_km']
        entry['far_km'] = locs[name]['far_km']
        if done:
            entry['extract'] = done
        src = load(os.path.join(C.CACHE, 'sources', f'{name}.json'))
        if src:
            entry['sources_sampled'] = {t: [(s['dataset'], s['license']) for s in v] for t, v in src.items()}
        man['locations'][name] = entry
    man['totals'] = {'tiles_written': total_tiles, 'bytes': total_bytes}
    val = load(os.path.join(C.MVT_DIR, 'validation.json'))
    if val:
        man['validation'] = 'see validation.json (real worker, node): ' + str(len([k for k in val if not k.startswith('_')])) + ' probes'
    os.makedirs(C.MVT_DIR, exist_ok=True)
    with open(OUT + '.tmp', 'w') as f:
        json.dump(man, f, indent=1)
    os.replace(OUT + '.tmp', OUT)
    print('wrote', OUT, man['totals'])


if __name__ == '__main__':
    main()

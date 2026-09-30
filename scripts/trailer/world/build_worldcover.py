#!/usr/bin/env python3
"""Trailer world: ESA WorldCover 2021 v200 class tiles for Skyloom's surface
engine (lib/fly/world-cover.js), data-contract.md §4.

  * source   ESA WorldCover 10 m 2021 v200 COGs on s3://esa-worldcover
             (3x3 degree tiles named by SW corner, EPSG:4326, 1/12000 deg px,
             nodata 0), read over HTTPS with GDAL /vsicurl/ from the COG itself
             or one of its internal overviews (x2..x32, class-valued).
  * render   256x256 EPSG:3857 XYZ tile, NEAREST NEIGHBOUR at pixel centres
             (the app samples worldCoverAt(x+.5, y+.5)); no anti-aliasing.
  * colours  EXACT legend RGB, alpha 255 where data exists; alpha 0 (RGB 0)
             where the product has no data (value 0, or no COG for that 3x3
             cell, e.g. open ocean).
  * png      RGBA8, IHDR/IDAT/IEND only (no gAMA/sRGB/iCCP/cHRM), < 512 KB.
  * output   $WORLD/worldcover/{z}/{x}/{y}.png  (served as image/png)

Coverage: far ring (square +-far_km) z6-11; core box (+1 tile ring) z6-14.
Overview per (location, zoom): the coarsest of x1..x32 whose pixel is not
coarser than the output pixel at the location's latitude (x64 is skipped: its
grid is not integer-aligned).  Idempotent: complete tile sets are skipped
without touching the network; existing tiles are never rewritten.

usage: nice -n 15 python3 build_worldcover.py [--locs nyc,dubai] [--force]
"""
import argparse, collections, json, math, os, sys, time

import numpy as np

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
os.environ.setdefault('GDAL_HTTP_MERGE_CONSECUTIVE_RANGES', 'YES')
os.environ.setdefault('GDAL_HTTP_MULTIPLEX', 'YES')
os.environ.setdefault('GDAL_HTTP_MAX_RETRY', '6')
os.environ.setdefault('GDAL_HTTP_RETRY_DELAY', '2')
os.environ.setdefault('VSI_CACHE', 'TRUE')
os.environ.setdefault('GDAL_CACHEMAX', '512')
if os.path.exists('/root/.ccr/ca-bundle.crt'):
    os.environ.setdefault('CURL_CA_BUNDLE', '/root/.ccr/ca-bundle.crt')
import rasterio  # noqa: E402
from rasterio.windows import Window  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wcommon as C  # noqa: E402

BUCKET = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com'
COG = BUCKET + '/v200/2021/map/ESA_WorldCover_10m_2021_v200_{name}_Map.tif'
OUT = os.path.join(C.WORLD, 'worldcover')
MISSING_CACHE = os.path.join(C.WORLD, '_cache', 'worldcover-missing.json')
PX_PER_DEG = 12000
FAR_Z = range(6, 12)
CORE_Z = range(6, 15)
CORE_PAD = 1
FACTORS = (1, 2, 4, 8, 16, 32)

LEGEND = {10: 0x006400, 20: 0xffbb22, 30: 0xffff4c, 40: 0xf096ff, 50: 0xfa0000, 60: 0xb4b4b4,
          70: 0xf0f0f0, 80: 0x0064c8, 90: 0x0096a0, 95: 0x00cf75, 100: 0xfae6a0}
LUT = np.zeros((256, 4), np.uint8)  # everything not in the legend -> transparent
for k, c in LEGEND.items():
    LUT[k] = ((c >> 16) & 255, (c >> 8) & 255, c & 255, 255)


def cell_name(lat_sw, lon_sw):
    return '%s%02d%s%03d' % ('N' if lat_sw >= 0 else 'S', abs(lat_sw), 'E' if lon_sw >= 0 else 'W', abs(lon_sw))


def factor_for(z, lat):
    lim = 16875.0 * math.cos(math.radians(lat)) / (1 << z)  # output px / source px (latitude axis)
    f = 1
    for c in FACTORS:
        if c <= lim:
            f = c
    return f


def out_path(z, x, y):
    return os.path.join(OUT, str(z), str(x), '%d.png' % y)


def tile_sets(name, loc):
    fb, cb = C.far_bbox(loc), C.core_bbox(loc)
    sets = []
    for z in CORE_Z:
        if z in FAR_Z:
            r = C.tile_range(fb, z)
            rc = C.tile_range(cb, z, pad=CORE_PAD)
            r = (min(r[0], rc[0]), max(r[1], rc[1]), min(r[2], rc[2]), max(r[3], rc[3]))
            sets.append((name + ':far', z, r))
        else:
            sets.append((name + ':core', z, C.tile_range(cb, z, pad=CORE_PAD)))
    return sets


class Missing:
    def __init__(self):
        try:
            with open(MISSING_CACHE) as f:
                self.d = json.load(f)
        except Exception:
            self.d = {}

    def save(self):
        C.write_atomic(MISSING_CACHE, json.dumps(self.d, indent=0, sort_keys=True).encode())


def read_mosaic(bbox, f, missing, stats):
    """uint8 class mosaic on the global WorldCover grid at factor f covering bbox.
    Returns (array, col0, row0) where global col = floor((lon+180)*12000/f)."""
    w, s, e, n = bbox
    ppd = PX_PER_DEG / f
    col0, col1 = int(math.floor((w + 180) * ppd)) - 1, int(math.ceil((e + 180) * ppd)) + 1
    row0, row1 = int(math.floor((90 - n) * ppd)) - 1, int(math.ceil((90 - s) * ppd)) + 1
    M = np.zeros((row1 - row0, col1 - col0), np.uint8)
    for lat_sw in range(int(math.floor(s / 3)) * 3, int(math.floor(n / 3)) * 3 + 1, 3):
        for lon_sw in range(int(math.floor(w / 3)) * 3, int(math.floor(e / 3)) * 3 + 1, 3):
            nm = cell_name(lat_sw, lon_sw)
            if missing.d.get(nm):
                continue
            # this cell on the global grid
            cc0 = int(round((lon_sw + 180) * ppd))
            rr0 = int(round((90 - (lat_sw + 3)) * ppd))
            size = int(round(3 * ppd))
            a0, a1 = max(col0, cc0), min(col1, cc0 + size)
            b0, b1 = max(row0, rr0), min(row1, rr0 + size)
            if a0 >= a1 or b0 >= b1:
                continue
            url = '/vsicurl/' + COG.format(name=nm)
            try:
                kw = {} if f == 1 else {'overview_level': FACTORS.index(f) - 1}
                with rasterio.open(url, **kw) as ds:
                    assert ds.width == size and ds.height == size, (nm, f, ds.width, size)
                    t0 = time.time()
                    arr = ds.read(1, window=Window(a0 - cc0, b0 - rr0, a1 - a0, b1 - b0))
                    stats['read_s'] += time.time() - t0
                    stats['cells'].add(nm)
            except rasterio.errors.RasterioIOError as ex:
                # Distinguish "no COG for this cell" (open ocean) from a network error.
                import requests
                st = requests.head(COG.format(name=nm), timeout=30).status_code
                if st in (403, 404):
                    missing.d[nm] = True
                    missing.save()
                    print('    (no WorldCover COG for cell %s: HTTP %d)' % (nm, st), flush=True)
                    continue
                raise
            M[b0 - row0:b1 - row0, a0 - col0:a1 - col0] = arr
    return M, col0, row0


def render_tile(M, col0, row0, f, z, x, y):
    ppd = PX_PER_DEG / f
    j = np.arange(256, dtype=np.float64) + 0.5
    lon = (x + j / 256.0) / (1 << z) * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * (y + j / 256.0) / (1 << z)))))
    cols = np.floor((lon + 180.0) * ppd).astype(np.int64) - col0
    rows = np.floor((90.0 - lat) * ppd).astype(np.int64) - row0
    assert cols.min() >= 0 and rows.min() >= 0 and cols.max() < M.shape[1] and rows.max() < M.shape[0]
    cls = M[np.ix_(rows, cols)]
    return LUT[cls], cls


def build_location(name, loc, missing, force=False):
    report = {}
    for label, z, r in tile_sets(name, loc):
        t0 = time.time()
        todo = [(x, y) for x, y in C.range_tiles(r) if force or not os.path.exists(out_path(z, x, y))]
        f = factor_for(z, loc['lat'])
        if not todo:
            print('  %-12s z%-2d %5d tiles  complete (skipped)' % (label, z, C.range_count(r)), flush=True)
            continue
        xs = [t[0] for t in todo]
        ys = [t[1] for t in todo]
        bbox = (C.x2lon(min(xs), z), C.y2lat(max(ys) + 1, z), C.x2lon(max(xs) + 1, z), C.y2lat(min(ys), z))
        stats = {'read_s': 0.0, 'cells': set()}
        M, col0, row0 = read_mosaic(bbox, f, missing, stats)
        classes = collections.Counter()
        empty = 0
        biggest = 0
        for x, y in todo:
            rgba, cls = render_tile(M, col0, row0, f, z, x, y)
            png = C.encode_png_rgba(rgba, level=6)
            assert len(png) < 512 * 1024
            biggest = max(biggest, len(png))
            C.write_atomic(out_path(z, x, y), png)
            if not (rgba[:, :, 3] == 255).any():
                empty += 1
            if z in (12, 14):
                u, c = np.unique(cls, return_counts=True)
                for k, v in zip(u.tolist(), c.tolist()):
                    classes[k] += v
        print('  %-12s z%-2d %5d tiles  made %5d  f=x%-2d mosaic %dx%d  cells %s  read %.0fs  empty %d  max %d B  %.0fs' % (
            label, z, C.range_count(r), len(todo), f, M.shape[1], M.shape[0], ','.join(sorted(stats['cells'])) or '-',
            stats['read_s'], empty, biggest, time.time() - t0), flush=True)
        if classes:
            tot = sum(classes.values())
            print('      class share z%d: %s' % (z, ' '.join('%d:%.1f%%' % (k, 100.0 * v / tot) for k, v in sorted(classes.items()))), flush=True)
        del M
    return report


def write_manifest():
    locs = C.load_locations()
    per = collections.defaultdict(dict)
    seen = set()
    zoom_tot = collections.Counter()
    total = 0
    for name, loc in locs:
        for label, z, r in tile_sets(name, loc):
            present = 0
            for x, y in C.range_tiles(r):
                p = out_path(z, x, y)
                if os.path.exists(p):
                    present += 1
                    if (z, x, y) not in seen:
                        seen.add((z, x, y))
                        total += os.path.getsize(p)
                        zoom_tot[z] += 1
            per[label][str(z)] = {'x': [r[0], r[1]], 'y': [r[2], r[3]], 'tiles': C.range_count(r), 'present': present,
                                  'overview_factor': factor_for(z, loc['lat'])}
    man = {
        'kind': 'skyloom-trailer-worldcover', 'version': 1,
        'built_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'path': 'worldcover/{z}/{x}/{y}.png', 'scheme': 'xyz (== WMTS TILECOL/TILEROW of EPSG:3857 matrix set)', 'crs': 'EPSG:3857',
        'tile_size': 256, 'content_type': 'image/png',
        'png': 'RGBA8, filter 0, chunks IHDR/IDAT/IEND only; every file < 512 KB',
        'resampling': 'nearest neighbour at output pixel centres from the v200 COG or its internal overview (x1..x32)',
        'legend_rgb': {str(k): '#%06x' % v for k, v in LEGEND.items()},
        'nodata': 'alpha 0, RGB 0 (source value 0 or no COG for the 3x3 cell)',
        'source': {'name': 'ESA WorldCover 10 m 2021 v200', 'url': COG,
                   'license': 'CC-BY 4.0', 'attribution': '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
                   'missing_cells': sorted(k for k, v in Missing().d.items() if v)},
        'coverage': {'far_ring': 'z6-11 (square +-far_km)', 'core': 'z6-14 (core box + %d tile ring)' % CORE_PAD},
        'sets': per,
        'unique_tiles_by_zoom': {str(k): zoom_tot[k] for k in sorted(zoom_tot)},
        'unique_tiles': sum(zoom_tot.values()), 'bytes': total,
    }
    C.write_atomic(os.path.join(OUT, 'manifest.json'), json.dumps(man, indent=1).encode())
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--locs', default='')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--manifest-only', action='store_true')
    a = ap.parse_args()
    if not a.manifest_only:
        missing = Missing()
        for name, loc in C.load_locations([s for s in a.locs.split(',') if s] or None):
            t0 = time.time()
            print('[%s]' % name, flush=True)
            build_location(name, loc, missing, a.force)
            print('[%s] done in %.0fs' % (name, time.time() - t0), flush=True)
            write_manifest()
    man = write_manifest()
    print('manifest: %d unique tiles, %.1f MB' % (man['unique_tiles'], man['bytes'] / 1e6))


if __name__ == '__main__':
    main()

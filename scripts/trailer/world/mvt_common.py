"""Shared tile math + location/coverage definitions for the trailer world build."""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCATIONS_JSON = os.path.join(HERE, '..', 'locations.json')
OUT = '/tmp/claude-0/world'
MVT_DIR = os.path.join(OUT, 'mvt')
CACHE = os.path.join(OUT, 'cache')
ORDER = ['nyc', 'dubai', 'sydney', 'rio', 'alps', 'paris', 'london']

# Coverage policy (see README): buildings/z14 = core + PAD14_KM, roads/z13 =
# core + PAD13_KM, z12 (and toy z10/z11) = core + 2 z12 tiles, z9 = far ring.
PAD14_KM = 4.0
PAD13_KM = 12.0
PAD12_TILES = 2
TILE_PAD = 0.08  # data read pad around a tile, as a fraction of the tile (fixture: 8%)

# ESA "barren" (bare / sparse vegetation) means different things per venue.
BARREN_AS = {'dubai': ('sand', 'sand'), 'alps': ('rock', 'bare_rock'), 'rio': ('rock', 'bare_rock')}


def locations():
    with open(LOCATIONS_JSON) as f:
        d = json.load(f)
    return {k: v for k, v in d.items() if not k.startswith('_')}


def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * (1 << z)


def lat2y(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (1 << z)


def x2lon(x, z):
    return x / (1 << z) * 360.0 - 180.0


def y2lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (1 << z)
    return math.degrees(math.atan(math.sinh(n)))


def tile_bbox(z, x, y):
    return (x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z))


def padded_tile_bbox(z, x, y, pad=TILE_PAD):
    w, s, e, n = tile_bbox(z, x, y)
    px, py = (e - w) * pad, (n - s) * pad
    return (w - px, s - py, e + px, n + py)


def km_box(lat, lon, half_w_km, half_h_km):
    dlat = half_h_km / 111.32
    dlon = half_w_km / (111.32 * math.cos(math.radians(lat)))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def core_box(loc, extra_km=0.0):
    w, h = loc['core_km']
    return km_box(loc['lat'], loc['lon'], w / 2 + extra_km, h / 2 + extra_km)


def far_box(loc):
    r = loc['far_km']
    return km_box(loc['lat'], loc['lon'], r, r)


def tiles_in_box(z, box):
    w, s, e, n = box
    x0, x1 = int(math.floor(lon2x(w, z))), int(math.floor(lon2x(e, z)))
    y0, y1 = int(math.floor(lat2y(n, z))), int(math.floor(lat2y(s, z)))
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def tile_width_km(z, lat):
    return 40075.016686 * math.cos(math.radians(lat)) / (1 << z)


def coverage(name, loc):
    """Tile sets per zoom for one location."""
    lat = loc['lat']
    cov = {}
    cov[14] = tiles_in_box(14, core_box(loc, PAD14_KM))
    cov[13] = tiles_in_box(13, core_box(loc, PAD13_KM))
    pad12 = PAD12_TILES * tile_width_km(12, lat)
    cov[12] = tiles_in_box(12, core_box(loc, pad12))
    cov[11] = tiles_in_box(11, core_box(loc, pad12))
    cov[10] = tiles_in_box(10, core_box(loc, pad12))
    cov[9] = tiles_in_box(9, far_box(loc))
    return cov


def union_box(z, tiles, pad=TILE_PAD):
    bs = [padded_tile_bbox(z, x, y, pad) for x, y in tiles]
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))

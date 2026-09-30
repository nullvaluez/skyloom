"""Shared helpers for the trailer world builders (DEM + WorldCover).

Tile math is XYZ / EPSG:3857 (slippy-map), row 0 = north.
Location boxes come from scripts/trailer/locations.json:
  core_km = [east-west km, north-south km] full-detail box centred on lat/lon
  far_km  = half-width (km) of the coarse square ring around the centre.
"""
import json, math, os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
LOCATIONS_JSON = os.path.join(HERE, '..', 'locations.json')
WORLD = os.environ.get('TRAILER_WORLD', '/tmp/claude-0/world')
PRIORITY = ['nyc', 'dubai', 'sydney', 'rio', 'alps', 'paris', 'london']
KM_PER_DEG_LAT = 111.32
MAX_LAT = 85.0511287798066


def load_locations(names=None):
    with open(LOCATIONS_JSON) as f:
        locs = json.load(f)
    locs = {k: v for k, v in locs.items() if not k.startswith('_')}
    order = [n for n in PRIORITY if n in locs] + sorted(n for n in locs if n not in PRIORITY)
    if names:
        order = [n for n in order if n in names]
    return [(n, locs[n]) for n in order]


def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * (1 << z)


def lat2y(lat, z):
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (1 << z)


def x2lon(x, z):
    return x / (1 << z) * 360.0 - 180.0


def y2lat(y, z):
    n = math.pi * (1.0 - 2.0 * y / (1 << z))
    return math.degrees(math.atan(math.sinh(n)))


def box_deg(lat, lon, half_ew_km, half_ns_km):
    """(west, south, east, north) of a km box centred on lat/lon."""
    dlat = half_ns_km / KM_PER_DEG_LAT
    dlon = half_ew_km / (KM_PER_DEG_LAT * math.cos(math.radians(lat)))
    return (lon - dlon, max(-MAX_LAT, lat - dlat), lon + dlon, min(MAX_LAT, lat + dlat))


def tile_range(bbox, z, pad=0):
    """Inclusive (x0, x1, y0, y1) of tiles intersecting bbox, padded by `pad` tiles."""
    w, s, e, n = bbox
    n_t = 1 << z
    x0 = int(math.floor(lon2x(w, z))) - pad
    x1 = int(math.floor(lon2x(e, z) - 1e-12)) + pad
    y0 = int(math.floor(lat2y(n, z))) - pad
    y1 = int(math.floor(lat2y(s, z) - 1e-12)) + pad
    return (max(0, x0), min(n_t - 1, x1), max(0, y0), min(n_t - 1, y1))


def range_tiles(r):
    x0, x1, y0, y1 = r
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield x, y


def range_count(r):
    return (r[1] - r[0] + 1) * (r[3] - r[2] + 1)


def core_bbox(loc):
    ew, ns = loc['core_km']
    return box_deg(loc['lat'], loc['lon'], ew / 2.0, ns / 2.0)


def far_bbox(loc):
    return box_deg(loc['lat'], loc['lon'], loc['far_km'], loc['far_km'])


# ---------------------------------------------------------------- PNG I/O
_SIG = b'\x89PNG\r\n\x1a\n'


def _chunk(t, data):
    return struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)


def encode_png_rgba(rgba, level=9):
    """Lossless RGBA8 PNG: IHDR + IDAT + IEND only (no gAMA/sRGB/iCCP/cHRM/pHYs).
    rgba: numpy uint8 array (h, w, 4). Filter type 0 on every scanline."""
    h, w, c = rgba.shape
    assert c == 4 and rgba.dtype.name == 'uint8'
    raw = bytearray()
    rows = rgba.reshape(h, w * 4)
    for yy in range(h):
        raw.append(0)
        raw += rows[yy].tobytes()
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return _SIG + _chunk(b'IHDR', ihdr) + _chunk(b'IDAT', zlib.compress(bytes(raw), level)) + _chunk(b'IEND', b'')


def png_chunks(buf):
    """List of (type, length) chunks of a PNG byte string (for audits)."""
    assert buf[:8] == _SIG, 'not a PNG'
    out, p = [], 8
    while p < len(buf):
        ln = struct.unpack('>I', buf[p:p + 4])[0]
        t = buf[p + 4:p + 8].decode('ascii')
        out.append((t, ln))
        p += 12 + ln
    return out


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp%d' % os.getpid()
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)

"""
Skyloom trailer world -- Sentinel-2 L2A imagery library.

Geometry (EPSG:3857 / XYZ tiles), scene discovery on the public
`sentinel-cogs` bucket (Element84 COG mirror of Copernicus Sentinel-2 L2A),
cloud-aware scene planning from the SCL band, windowed COG fetches, and the
per-location colour grade.  Driven by build_img.py.

All heavy numeric work is single-threaded per process (cv2/GDAL threads = 1);
the driver decides how many processes run.
"""
import os, re, json, math, time, urllib.request, urllib.parse, urllib.error
import concurrent.futures as cf
from collections import defaultdict

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif,.TIF,.json')
os.environ.setdefault('GDAL_HTTP_MULTIRANGE', 'YES')
os.environ.setdefault('GDAL_HTTP_MERGE_CONSECUTIVE_RANGES', 'YES')
os.environ.setdefault('GDAL_HTTP_MAX_RETRY', '8')
os.environ.setdefault('GDAL_HTTP_RETRY_DELAY', '3')
os.environ.setdefault('GDAL_HTTP_TIMEOUT', '90')
os.environ.setdefault('GDAL_NUM_THREADS', '1')
os.environ.setdefault('GDAL_CACHEMAX', '256')

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import Affine
import cv2

cv2.setNumThreads(1)

HERE = os.path.dirname(os.path.abspath(__file__))
WORLD = os.environ.get('TRAILER_WORLD', '/tmp/claude-0/world')
CACHE = os.path.join(WORLD, 'cache', 'img')
IMG_OUT = os.path.join(WORLD, 'img')
PREV = os.path.join(WORLD, 'previews')
LOC_FILE = os.path.join(os.path.dirname(HERE), 'locations.json')
S3 = 'https://s3.us-west-2.amazonaws.com/sentinel-cogs'
YEARS = [2022, 2023, 2024, 2025]
ORIGIN = 20037508.342789244
EPSG3857 = 'EPSG:3857'

LOC_ORDER = ['nyc', 'dubai', 'sydney', 'rio', 'alps', 'paris', 'london']


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def mkdirs(p):
    os.makedirs(p, exist_ok=True)
    return p


# --------------------------------------------------------------------------
# Web-Mercator / XYZ geometry
# --------------------------------------------------------------------------

def tsize(z):
    return 2 * ORIGIN / (2 ** z)


def res_z(z):
    return tsize(z) / 256.0


def ll2m(lon, lat):
    x = lon * ORIGIN / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) * ORIGIN / math.pi
    return x, y


def m2ll(x, y):
    lon = x / ORIGIN * 180.0
    lat = math.degrees(2 * math.atan(math.exp(y / ORIGIN * math.pi)) - math.pi / 2)
    return lon, lat


def tile_bounds(z, x, y):
    s = tsize(z)
    return (-ORIGIN + x * s, ORIGIN - (y + 1) * s, -ORIGIN + (x + 1) * s, ORIGIN - y * s)


def tile_range(z, b, eps=1e-6):
    """Inclusive tile index range (x0,x1,y0,y1) of tiles intersecting merc bounds b."""
    s = tsize(z)
    n = 2 ** z
    x0 = int(math.floor((b[0] + ORIGIN) / s + eps))
    x1 = int(math.ceil((b[2] + ORIGIN) / s - eps)) - 1
    y0 = int(math.floor((ORIGIN - b[3]) / s + eps))
    y1 = int(math.ceil((ORIGIN - b[1]) / s - eps)) - 1
    return max(0, x0), min(n - 1, x1), max(0, y0), min(n - 1, y1)


def align_bounds(b, z):
    x0, x1, y0, y1 = tile_range(z, b)
    return (tile_bounds(z, x0, y1)[0], tile_bounds(z, x0, y1)[1],
            tile_bounds(z, x1, y0)[2], tile_bounds(z, x1, y0)[3])


def tiles_in(z, b):
    x0, x1, y0, y1 = tile_range(z, b)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


class Grid:
    """North-up EPSG:3857 raster grid."""

    def __init__(self, bounds, res):
        self.bounds = tuple(bounds)
        self.res = float(res)
        self.W = int(round((bounds[2] - bounds[0]) / res))
        self.H = int(round((bounds[3] - bounds[1]) / res))
        self.transform = Affine(self.res, 0, bounds[0], 0, -self.res, bounds[3])

    def pad(self, npx):
        r = self.res
        b = self.bounds
        return Grid((b[0] - npx * r, b[1] - npx * r, b[2] + npx * r, b[3] + npx * r), r)

    def xy_centers(self):
        xs = self.bounds[0] + (np.arange(self.W) + 0.5) * self.res
        ys = self.bounds[3] - (np.arange(self.H) + 0.5) * self.res
        return xs, ys

    def to_dict(self):
        return {'bounds': list(self.bounds), 'res': self.res, 'W': self.W, 'H': self.H}


def map_to_grid(arr, src, dst, interp=cv2.INTER_LINEAR, border=cv2.BORDER_REPLICATE, bval=0):
    """Resample a 2-D (or HxWxC) array defined on Grid `src` onto Grid `dst`
    (both EPSG:3857, north-up) with pixel-centre-exact affine mapping."""
    f = dst.res / src.res
    ox = (dst.bounds[0] - src.bounds[0]) / src.res
    oy = (src.bounds[3] - dst.bounds[3]) / src.res
    # dst pixel (j + .5) -> src coord ox + (j + .5) f ; minus .5 for cv2 centre convention
    M = np.array([[f, 0, ox + 0.5 * f - 0.5], [0, f, oy + 0.5 * f - 0.5]], np.float64)
    return cv2.warpAffine(arr, M, (dst.W, dst.H), flags=interp | cv2.WARP_INVERSE_MAP,
                          borderMode=border, borderValue=bval)


# --------------------------------------------------------------------------
# Locations
# --------------------------------------------------------------------------

class Loc:
    CORE_BLOCK_Z = 12     # core rendering block = one z12 tile
    FAR_BLOCK_Z = 9       # far rendering block = one z9 tile

    def __init__(self, name):
        d = json.load(open(LOC_FILE))[name]
        self.name = name
        self.lat, self.lon = float(d['lat']), float(d['lon'])
        self.core_km = d['core_km']
        self.far_km = float(d['far_km'])
        self.months = [int(m) for m in d['s2_months']]
        self.coslat = math.cos(math.radians(self.lat))
        w, h = self.core_km
        dlat = h / 2.0 / 111.32
        dlon = w / 2.0 / (111.32 * self.coslat)
        self.core_ll = (self.lon - dlon, self.lat - dlat, self.lon + dlon, self.lat + dlat)
        x0, y0 = ll2m(self.core_ll[0], self.core_ll[1])
        x1, y1 = ll2m(self.core_ll[2], self.core_ll[3])
        self.core_m = (x0, y0, x1, y1)
        self.core_ext = align_bounds(self.core_m, self.CORE_BLOCK_Z)
        self.cx, self.cy = ll2m(self.lon, self.lat)
        self.far_r_m = self.far_km * 1000.0 / self.coslat           # mercator metres
        fb = (self.cx - self.far_r_m, self.cy - self.far_r_m, self.cx + self.far_r_m, self.cy + self.far_r_m)
        self.far_ext = align_bounds(fb, self.FAR_BLOCK_Z)

    # ground metres per mercator metre at the location
    def ground(self, merc_m):
        return merc_m * self.coslat

    def ll_bounds(self, b):
        lon0, lat0 = m2ll(b[0], b[1])
        lon1, lat1 = m2ll(b[2], b[3])
        return (lon0, lat0, lon1, lat1)

    def in_circle_tile(self, z, x, y):
        b = tile_bounds(z, x, y)
        nx = min(max(self.cx, b[0]), b[2])
        ny = min(max(self.cy, b[1]), b[3])
        return math.hypot(nx - self.cx, ny - self.cy) <= self.far_r_m

    def core_tiles(self, z):
        return tiles_in(z, self.core_m)

    def far_tiles(self, z):
        cb = (self.cx - self.far_r_m, self.cy - self.far_r_m, self.cx + self.far_r_m, self.cy + self.far_r_m)
        return [t for t in tiles_in(z, cb) if self.in_circle_tile(z, *t)]

    def plan_grid(self, product):
        if product == 'core':
            return Grid(self.core_ext, res_z(13))
        return Grid(self.far_ext, res_z(10))

    def region_ll(self, product):
        return self.ll_bounds(self.core_ext if product == 'core' else self.far_ext)

    def importance(self, grid, product):
        xs, ys = grid.xy_centers()
        if product == 'core':
            b = self.core_m
            mx = (xs >= b[0]) & (xs <= b[2])
            my = (ys >= b[1]) & (ys <= b[3])
            w = np.where(my[:, None] & mx[None, :], 1.0, 0.25)
        else:
            d = np.hypot(xs[None, :] - self.cx, ys[:, None] - self.cy)
            w = np.where(d <= self.far_r_m, 1.0, 0.2)
        return w.astype(np.float32)


# --------------------------------------------------------------------------
# HTTP + scene discovery
# --------------------------------------------------------------------------

def http_get(url, timeout=60, tries=6):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
            last = e
        except Exception as e:  # noqa
            last = e
        time.sleep(1.5 * (i + 1))
    raise last


def s3_list_prefixes(prefix):
    out, tok = [], None
    while True:
        u = f"{S3}/?list-type=2&prefix={urllib.parse.quote(prefix)}&delimiter=/"
        if tok:
            u += f"&continuation-token={urllib.parse.quote(tok)}"
        x = http_get(u)
        if x is None:
            return out
        x = x.decode()
        out += [p for p in re.findall(r"<Prefix>([^<]*)</Prefix>", x) if p != prefix]
        m = re.search(r"<NextContinuationToken>([^<]*)</NextContinuationToken>", x)
        if not m:
            return out
        tok = m.group(1)


def norm_tile(t):
    m = re.match(r'^0*(\d+)([C-X])([A-Z]{2})$', t)
    return f"{int(m.group(1))}{m.group(2)}{m.group(3)}" if m else None


def mgrs_tiles(ll, step_km=4.0):
    import mgrs
    m = mgrs.MGRS()
    lon0, lat0, lon1, lat1 = ll
    clat = math.cos(math.radians((lat0 + lat1) / 2))
    nlat = max(2, int((lat1 - lat0) * 111.32 / step_km) + 2)
    nlon = max(2, int((lon1 - lon0) * 111.32 * clat / step_km) + 2)
    out = set()
    for la in np.linspace(lat0, lat1, nlat):
        for lo in np.linspace(lon0, lon1, nlon):
            t = norm_tile(m.toMGRS(float(la), float(lo), MGRSPrecision=0))
            if t:
                out.add(t)
    return sorted(out)


def tile_prefix(t, y, mo):
    m = re.match(r'^(\d+)([C-X])([A-Z]{2})$', t)
    return f"sentinel-s2-l2a-cogs/{int(m.group(1))}/{m.group(2)}/{m.group(3)}/{y}/{int(mo)}/"


def _pb_float(pb):
    try:
        return float(pb)
    except Exception:
        return 0.0


def parse_item(j, prefix):
    p = j['properties']
    a = j['assets']
    uri = p.get('s2:product_uri', '')
    mo = re.search(r'_R(\d{3})_', uri)
    pb = p.get('s2:processing_baseline', '00.00')
    applied = p.get('earthsearch:boa_offset_applied', None)
    off = 1000 if (_pb_float(pb) >= 4.0 and applied is False) else 0
    href = {}
    for k in ('red', 'green', 'blue', 'nir', 'scl', 'aot'):
        if k in a:
            href[k] = a[k]['href']
    return {
        'id': j['id'],
        'prefix': prefix,
        'tile': norm_tile(j['id'].split('_')[1]),
        'datetime': p['datetime'],
        'date': p['datetime'][:10],
        'platform': p.get('platform'),
        'cloud': float(p.get('eo:cloud_cover', 100.0)),
        'nodata': float(p.get('s2:nodata_pixel_percentage', 0.0) or 0.0),
        'pb': pb,
        'offset_applied': applied,
        'dn_offset': off,
        'datatake': p.get('s2:datatake_id'),
        'orbit': mo.group(1) if mo else '000',
        'epsg': p.get('proj:epsg'),
        'sun_el': p.get('view:sun_elevation'),
        'geometry': j['geometry'],
        'href': href,
        'seq': int(re.search(r'_(\d+)_L2A$', j['id']).group(1)) if re.search(r'_(\d+)_L2A$', j['id']) else 0,
    }


def get_item(prefix):
    name = prefix.rstrip('/').split('/')[-1]
    cp = os.path.join(CACHE, 'stac', 'items', name + '.json')
    if os.path.exists(cp):
        try:
            return parse_item(json.load(open(cp)), prefix)
        except Exception:
            pass
    raw = http_get(f"{S3}/{prefix}{name}.json")
    if raw is None:
        return None
    j = json.loads(raw)
    mkdirs(os.path.dirname(cp))
    with open(cp + '.tmp', 'wb') as f:
        f.write(raw)
    os.replace(cp + '.tmp', cp)
    return parse_item(j, prefix)


def list_scenes(tiles, months, years=YEARS, nthreads=16):
    jobs = [(t, y, m) for t in tiles for y in years for m in months]

    def lst(job):
        t, y, m = job
        cp = os.path.join(CACHE, 'stac', 'list', f"{t}_{y}_{m}.json")
        if os.path.exists(cp):
            return json.load(open(cp))
        px = s3_list_prefixes(tile_prefix(t, y, m))
        mkdirs(os.path.dirname(cp))
        json.dump(px, open(cp, 'w'))
        return px

    with cf.ThreadPoolExecutor(nthreads) as ex:
        prefixes = [p for r in ex.map(lst, jobs) for p in r]
    with cf.ThreadPoolExecutor(nthreads) as ex:
        items = [it for it in ex.map(get_item, prefixes) if it]
    # dedupe reprocessed duplicates: keep highest sequence per (platform, tile, date)
    best = {}
    for it in items:
        k = (it['platform'], it['tile'], it['date'])
        if k not in best or it['seq'] > best[k]['seq']:
            best[k] = it
    return sorted(best.values(), key=lambda c: (c['tile'], c['datetime']))


# --------------------------------------------------------------------------
# COG reads
# --------------------------------------------------------------------------

_NOV = {}


def _open(href, ovl=None):
    if ovl is None:
        return rasterio.open(href)
    key = href.rsplit('/', 1)[-1]
    if key not in _NOV:
        with rasterio.open(href) as ds:
            _NOV[key] = len(ds.overviews(1))
    n = _NOV[key]
    if n == 0:
        return rasterio.open(href)
    return rasterio.open(href, overview_level=min(ovl, n - 1))


def read_window_for(href, bounds3857, ovl=None, pad=4, indexes=None):
    """Read the part of a COG covering bounds3857 (+pad px). Returns (arr, transform, crs) or None."""
    with _open(href, ovl) as ds:
        b = transform_bounds(EPSG3857, ds.crs, *bounds3857, densify_pts=21)
        w = from_bounds(*b, transform=ds.transform)
        c0 = int(math.floor(w.col_off)) - pad
        r0 = int(math.floor(w.row_off)) - pad
        c1 = int(math.ceil(w.col_off + w.width)) + pad
        r1 = int(math.ceil(w.row_off + w.height)) + pad
        c0, r0 = max(0, c0), max(0, r0)
        c1, r1 = min(ds.width, c1), min(ds.height, r1)
        if c1 - c0 < 2 or r1 - r0 < 2:
            return None
        win = Window(c0, r0, c1 - c0, r1 - r0)
        arr = ds.read(indexes=indexes, window=win)
        return arr, ds.window_transform(win), ds.crs


def reproject_to(arr, src_t, src_crs, grid, resampling, src_nodata=0, dst_dtype=np.float32, dst_nodata=None):
    single = arr.ndim == 2
    a = arr[None] if single else arr
    if dst_nodata is None:
        dst_nodata = np.nan if np.issubdtype(np.dtype(dst_dtype), np.floating) else 0
    dst = np.full((a.shape[0], grid.H, grid.W), dst_nodata, dst_dtype)
    reproject(a, dst, src_transform=src_t, src_crs=src_crs, src_nodata=src_nodata,
              dst_transform=grid.transform, dst_crs=EPSG3857, dst_nodata=dst_nodata,
              resampling=resampling, num_threads=1)
    return dst[0] if single else dst


# --------------------------------------------------------------------------
# Masks
# --------------------------------------------------------------------------

def disk(r):
    r = max(1, int(round(r)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def scl_masks(scl, px_m, product):
    """good = clear usable pixels; valid = has data (edge-eroded)."""
    valid = (scl > 0).astype(np.uint8)
    cloud = np.isin(scl, (8, 9, 10)).astype(np.uint8)
    shadow = (scl == 3).astype(np.uint8)
    sat = scl == 1
    if px_m < 60:
        # remove speckle false-positives (bright roofs flagged as cloud) before growing
        cloud = cv2.morphologyEx(cloud, cv2.MORPH_OPEN, disk(40.0 / px_m))
        shadow = cv2.morphologyEx(shadow, cv2.MORPH_OPEN, disk(30.0 / px_m))
    cloud = cv2.dilate(cloud, disk(max(1.0, 250.0 / px_m)))
    shadow = cv2.dilate(shadow, disk(max(1.0, 120.0 / px_m)))
    ve = cv2.erode(valid, disk(max(1.0, 80.0 / px_m))).astype(bool)
    good = ve & (cloud == 0) & (shadow == 0) & ~sat
    return good, ve


def badness(scl):
    b = np.full(scl.shape, 99, np.uint8)
    b[np.isin(scl, (2, 4, 5, 6, 7, 11))] = 0
    b[np.isin(scl, (3, 10))] = 1
    b[scl == 8] = 2
    b[scl == 9] = 3
    b[scl == 1] = 4
    return b


def feather(mask, px_m, width_m):
    if not mask.any():
        return np.zeros(mask.shape, np.float32)
    d = np.minimum(cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5), 1e6)
    t = np.clip(d * px_m / width_m, 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# Colour grade
# --------------------------------------------------------------------------

def srgb_enc(x):
    x = np.maximum(x, 0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0.0031308), 1 / 2.4) - 0.055)


def tci_like(R, G, B):
    """What the stock L2A TCI product looks like (linear DN/10.86 clip) -- the BEFORE."""
    out = np.stack([R, G, B], -1) * 10000.0 * 0.0921 + 4.7
    return np.clip(out / 255.0, 0, 1)


def grade(R, G, B, N, P):
    """Fixed per-location transform: reflectance (R,G,B,NIR) -> display RGB float [0,1] (H,W,3)."""
    dos, wb, ex = P['dos'], P['wb'], P['exposure']
    k = P['knee']
    ch = []
    for band, i in ((R, 0), (G, 1), (B, 2)):
        x = np.maximum(band - dos[i], 0) * (wb[i] * ex)
        x = np.where(x < k, x, k + (1 - k) * np.tanh((x - k) / (1 - k)))
        ch.append(srgb_enc(x))
    rgb = np.stack(ch, -1).astype(np.float32)
    # tone: contrast around a pivot (power S-curve), then a toe lift
    p, c, lift = P['pivot'], P['contrast'], P['lift']
    y = np.clip(rgb, 0, 1)
    lo = p * np.power(np.maximum(y, 1e-6) / p, c)
    hi = 1 - (1 - p) * np.power(np.maximum(1 - y, 1e-6) / (1 - p), c)
    y = np.where(y < p, lo, hi)
    y = y + lift * np.power(1 - y, 3)
    # saturation (luma preserving), eased off in the highlights
    Y = (0.2126 * y[..., 0] + 0.7152 * y[..., 1] + 0.0722 * y[..., 2])[..., None]
    s = P['sat'] * (1 - 0.6 * smoothstep(0.75, 1.0, Y)) + 0.6 * smoothstep(0.75, 1.0, Y)
    y = Y + (y - Y) * s
    # vegetation: a touch of natural green (NDVI weighted), keeps olive S2 greens from going brown
    ndvi = (N - R) / (N + R + 1e-6)
    wv = (smoothstep(0.35, 0.75, ndvi) * P.get('veg', 0.0))[..., None]
    if P.get('veg', 0.0) > 0:
        veg = y * np.array([0.94, 1.03, 0.92], np.float32)
        y = y + (veg - y) * wv
    # water: deep blue-teal palette keyed on water luminance (texture preserved)
    ndwi = (G - N) / (G + N + 1e-6)
    ww = smoothstep(P['w_ndwi0'], P['w_ndwi1'], ndwi) * (1 - smoothstep(0.11, 0.2, G - dos[1]))
    ww = (ww * P['w_str'])[..., None]
    if P['w_str'] > 0:
        Yw = (0.2126 * y[..., 0] + 0.7152 * y[..., 1] + 0.0722 * y[..., 2])[..., None]
        t = np.clip((Yw - P['wY0']) / (P['wY1'] - P['wY0']), 0, 1)
        deep = np.array(P['w_deep'], np.float32)
        shal = np.array(P['w_shal'], np.float32)
        pal = deep + (shal - deep) * t
        Yp = (0.2126 * pal[..., 0] + 0.7152 * pal[..., 1] + 0.0722 * pal[..., 2])[..., None]
        pal = pal * np.power(np.maximum(Yw, 1e-4) / np.maximum(Yp, 1e-4), P.get('w_tex', 0.5))
        y = y + (pal - y) * ww
    return np.clip(y, 0, 1).astype(np.float32)


DEFAULT_GRADE = {
    'knee': 0.70, 'pivot': 0.42, 'contrast': 1.18, 'lift': 0.03, 'sat': 1.2, 'veg': 0.5,
    'w_ndwi0': 0.02, 'w_ndwi1': 0.22, 'w_str': 0.75, 'w_tex': 0.55,
    'w_deep': [0.055, 0.155, 0.225], 'w_shal': [0.17, 0.31, 0.35],
}


def estimate_grade(comp, land_valid, overrides=None):
    """Estimate the fixed per-location grade from the core plan composite (4,H,W) reflectance."""
    R, G, B, N = comp
    v = np.isfinite(R) & np.isfinite(G) & np.isfinite(B) & np.isfinite(N) & (R > 0) & (G > 0) & (B > 0)
    P = dict(DEFAULT_GRADE)
    # dark object subtraction (partial) -- the L2A residual path radiance, strongest in blue
    dos = []
    for band in (R, G, B):
        dos.append(float(np.percentile(band[v], 0.05)) * 0.85)
    P['dos'] = dos
    ndvi = (N - R) / (N + R + 1e-6)
    ndwi = (G - N) / (G + N + 1e-6)
    r, g, b = R - dos[0], G - dos[1], B - dos[2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    landm = v & (ndwi < 0.0) & land_valid
    # grey-world on near-neutral man-made pixels (concrete/asphalt/roofs): excludes sand & vegetation
    cand = landm & (ndvi < 0.18) & (luma > np.percentile(luma[landm], 40))
    ov = dict(overrides or {})
    wb = np.array([1.0, 1.0, 1.0])
    for _ in range(4):
        rr, gg, bb = r[cand] * wb[0], g[cand] * wb[1], b[cand] * wb[2]
        m = (rr + gg + bb) / 3
        chroma = (np.maximum(np.maximum(rr, gg), bb) - np.minimum(np.minimum(rr, gg), bb)) / np.maximum(m, 1e-4)
        sel = chroma < 0.18
        if sel.sum() < 500:
            break
        med = np.array([np.median(rr[sel]), np.median(gg[sel]), np.median(bb[sel])])
        wb = wb * (med.mean() / med)
        wb = wb / wb[1]
    P['wb_full'] = [float(x) for x in wb]
    # L2A reflectance is already physically balanced: only nudge toward neutral, then apply warmth
    wb = np.power(wb, ov.get('wb_strength', 0.35)) * np.array(ov.get('warm', [1.02, 1.0, 0.975]))
    wb = np.clip(wb / wb[1], 0.75, 1.35)
    P['wb'] = [float(x) for x in wb]
    P['wb_pixels'] = int(cand.sum())
    # exposure: land median luma -> target (linear); bounded
    L = (0.2126 * r * wb[0] + 0.7152 * g * wb[1] + 0.0722 * b * wb[2])[landm]
    med = float(np.median(L))
    p99 = float(np.percentile(L, 99.5))
    ex = ov.get('target_median', 0.17) / max(med, 1e-3)
    ex = min(ex, ov.get('p995_to', 1.15) / max(p99, 1e-3))  # knee rolls the rest off (no hard clip)
    P['exposure'] = float(np.clip(ex, 1.8, 4.2))
    P['land_median_luma'] = med
    P['land_p995_luma'] = p99
    # water luma range (display space after the base grade) for the palette mapping
    wm = v & (ndwi > 0.25) & (G - dos[1] < 0.11)
    P['water_pixels'] = int(wm.sum())
    if overrides:
        P.update(overrides)
    if wm.sum() > 200:
        Pn = dict(P)
        Pn['w_str'] = 0.0
        Pn['veg'] = 0.0
        disp = grade(R[wm][None], G[wm][None], B[wm][None], N[wm][None], Pn)[0]
        Yw = 0.2126 * disp[:, 0] + 0.7152 * disp[:, 1] + 0.0722 * disp[:, 2]
        P['wY0'] = float(np.percentile(Yw, 5))
        P['wY1'] = max(float(np.percentile(Yw, 97)), P['wY0'] + 0.05)
        # deep-water fill reflectance (open ocean with no Sentinel data)
        deep = wm & (ndwi > 0.4)
        if deep.sum() < 200:
            deep = wm
        P['fill_refl'] = [float(np.median(x[deep])) for x in (R, G, B, N)]
    else:
        P['wY0'], P['wY1'] = 0.12, 0.35
        P['fill_refl'] = [0.02, 0.035, 0.05, 0.01]
    if overrides:
        P.update(overrides)
    return P

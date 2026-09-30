#!/usr/bin/env python3
"""Trailer world: DEM tiles as Mapbox terrain-rgb for the Skyloom terrain mesh.

Contract (tmp/claude-0/reports/data-contract.md §3 + recipe §8D):
  * source   AWS Terrarium PNG (elevation-tiles-prod, z0-15),
             h = R*256 + G + B/256 - 32768, CLAMPED to h >= 0 (all trailer
             locations are coastal; bathymetry would carve trenches under water)
  * sample   EDGE-INCLUSIVE N x N grid, N = min(64, (z+2)*3): vertex (i, j) is
             at tile fraction (i/(N-1), j/(N-1)), row 0 = north.  Bilinear over
             the Terrarium mosaic (pixel centres at +0.5).  Adjacent tiles at
             one zoom evaluate the identical expression at their shared edge,
             so the seam rows are bit-identical.
  * encode   v = round((h + 10000) * 10) -> R = v>>16, G = v>>8 & 255,
             B = v & 255, A = 255; lossless RGBA8 PNG, chunks IHDR/IDAT/IEND
             only (no gAMA / sRGB / iCCP / cHRM -> no colour management).
  * output   $WORLD/dem/{z}/{x}/{y}.png

Coverage: z0-4 global; per location far ring (square +-far_km) z5-12;
core box (+1 tile ring) z13-16.  Source zoom per output zoom (one rule per z so
seams stay exact):  z<=4 -> z;  5..12 -> z-1 (source px still finer than the
vertex spacing);  13..15 -> z;  16 -> 15 (bilinear upsampling).

SOURCE REPAIR (before everything else, per Terrarium tile, tile-local so it
is a pure function of the tile): Terrarium carries nodata blocks (RGB 0,0,0 =
-32768 and -24766 m blocks in NY waters) and isolated garbage (a 20,889 m
spike at z11 in the Alps far ring, a 1,903 m spike and a -1,429 m pit at z11
off Sydney's heads).  Values below -11000 m are filled from the nearest valid
pixel, then the clamp is applied, then any pixel more than
max(150 m, 4 px-widths) ABOVE or max(30 m, 3 px-widths) BELOW its 5x5 median
is replaced by that median (a 63-degree slope stays inside both bounds), as
is (source z >= 6) any pixel whose |h - median7| exceeds max(100 m, 2.5 x the
7x7 inter-quartile range), up to 3 passes: Terrarium's z8-z11 levels carry 100-1500 m needles
in calm terrain (1,007 m on the Sydney CBD at z9) while real sharp peaks sit in
rough neighbourhoods (Matterhorn, Pedra da Gavea, Sugarloaf verified intact).

WATER FLATTEN (on top of the clamp): Terrarium stitches several sources near
coasts, so sea-level water alternates between 0 m (clamped bathymetry) and
~1-3 m (a hydro-flattened land DEM) in rectangular blocks -- a visible step
under the painted water.  For source zooms >= 11 every Terrarium pixel whose
ESA WorldCover class is 80 (permanent water, from $WORLD/worldcover built by
build_worldcover.py, same XYZ tile or its z14 parent for z15) AND whose height
is < 6 m is set to exactly 0 m.  Lakes and rivers above 6 m (alpine lakes, the
Seine) are untouched.  This is a per-SOURCE-pixel operation, so seams stay
exact -- but it means WorldCover must be built BEFORE the DEM (run_all.sh does).

URBAN DE-SPIKE (opt-in per location, DESPIKE below; default sydney only):
Terrarium's source over Sydney is a surface model, so the CBD towers stand as
50-117 m lumps and the Opera House sits on a 22 m spike (monuments are placed
at the DEM height at their POI point).  For the listed locations, inside the
core box (+pad_km, with a ramp_km fade-in from the box edge) and weighted by
a blurred WorldCover built-up (class 50) mask, the source is pulled down
towards a ground estimate T = min(H, gauss(grey_opening(H, window_m))).  It
only ever LOWERS terrain and removes features narrower than window_m, so ramps
and wide natural relief survive (NOT used for Rio: favelas cover narrow steep
hills).  The region is an explicit box (DESPIKE[loc]['center'/'box_km']).
Computed once per (location, source zoom 11/13/14/15) on a mosaic
with a margin wider than every kernel, stored per source tile under
$WORLD/_cache/despike/{zs}/{x}/{y}.npy and then consumed exactly like a
Terrarium tile, so seams stay exact.

Fetched Terrarium tiles are cached verbatim under $WORLD/_cache/terrarium so a
rebuild is offline.  Everything is idempotent: an existing output tile is
skipped, an existing cache tile is not re-fetched.

usage: nice -n 15 python3 build_dem.py [--locs nyc,dubai] [--no-global]
       [--fetch-workers 16] [--force]
"""
import argparse, collections, concurrent.futures as cf, io, json, math, os, sys, time

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wcommon as C  # noqa: E402

TERRARIUM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
CACHE = os.path.join(C.WORLD, '_cache', 'terrarium')
OUT = os.path.join(C.WORLD, 'dem')
GLOBAL_Z = range(0, 5)
FAR_Z = range(5, 13)
CORE_Z = range(13, 17)
CORE_PAD = 1
TERRARIUM_MAX_Z = 15
NODATA_BELOW_M = -11000.0     # deeper than any real ocean -> Terrarium nodata
SPIKE_MIN_M, SPIKE_PX = 150.0, 4.0
PIT_MIN_M, PIT_PX = 30.0, 3.0
REL_MIN_M, REL_K, REL_MIN_Z = 100.0, 2.5, 6
REPAIR_PASSES = 3
REPAIR_REV = 6
WATER_FLATTEN_MIN_ZS = 11     # source zooms that get the WorldCover water flatten
WATER_FLATTEN_MAX_H = 6.0     # only sea-level water: h < 6 m -> 0
WC_WATER = (0x00, 0x64, 0xC8)  # ESA WorldCover class 80
WC_ROOT = os.path.join(C.WORLD, 'worldcover')
WC_BUILT = (0xFA, 0x00, 0x00)  # ESA WorldCover class 50
DESPIKE_DIR = os.path.join(C.WORLD, '_cache', 'despike')
DESPIKE_ZS = (11, 13, 14, 15)  # every source zoom used by output z >= 12
DESPIKE = {
    # 8 x 8 km over the CBD, The Rocks, Opera House, Barangaroo, Pyrmont and North
    # Sydney: a core-wide region also shaved 10-25 m off wooded ridges and
    # headland tips across the suburbs (measured), so the region is explicit.
    'sydney': {'center': [-33.862, 151.208], 'box_km': [8.0, 8.0], 'window_m': 250.0, 'smooth_frac': 0.25,
               'built_sigma_m': 100.0, 'gain': 2.0, 'ramp_km': 1.0},
}
DESPIKE_REV = 3


def dem_n(z):
    return max(2, min(64, (z + 2) * 3))


def src_zoom(z):
    if z <= 4:
        return z
    if z <= 12:
        return z - 1
    return min(z, TERRARIUM_MAX_Z)


# ------------------------------------------------------------------ fetching
_session = None


def _sess():
    global _session
    if _session is None:
        s = requests.Session()
        a = requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=32)
        s.mount('https://', a)
        _session = s
    return _session


def cache_path(z, x, y):
    return os.path.join(CACHE, str(z), str(x), '%d.png' % y)


def fetch_one(z, x, y):
    p = cache_path(z, x, y)
    if os.path.exists(p) or os.path.exists(p + '.missing'):
        return 'cached'
    url = TERRARIUM.format(z=z, x=x, y=y)
    last = None
    for attempt in range(6):
        try:
            r = _sess().get(url, timeout=30)
            if r.status_code == 200 and r.content[:8] == b'\x89PNG\r\n\x1a\n':
                C.write_atomic(p, r.content)
                return 'fetched'
            if r.status_code in (403, 404):
                C.write_atomic(p + '.missing', b'%d' % r.status_code)
                return 'missing'
            last = 'http %d' % r.status_code
        except Exception as e:  # network hiccup -> retry with backoff
            last = repr(e)
        time.sleep(min(20, 0.5 * 2 ** attempt))
    raise RuntimeError('terrarium fetch failed %s: %s' % (url, last))


def prefetch(tiles, workers):
    tiles = [t for t in tiles if not (os.path.exists(cache_path(*t)) or os.path.exists(cache_path(*t) + '.missing'))]
    if not tiles:
        return collections.Counter()
    cnt = collections.Counter()
    t0 = time.time()
    with cf.ThreadPoolExecutor(workers) as ex:
        for i, res in enumerate(ex.map(lambda t: fetch_one(*t), tiles)):
            cnt[res] += 1
            if (i + 1) % 500 == 0:
                print('    fetched %d/%d (%.0f/s)' % (i + 1, len(tiles), (i + 1) / (time.time() - t0)), flush=True)
    return cnt


# ------------------------------------------------------------------ decoding
RING = 3  # context ring (px) taken from the 8 neighbouring RAW tiles (7x7 windows)


def repair_source(ctx, z, y, stats=None):
    """ctx: RAW Terrarium heights of tile z/*/y with a RING-px border taken from
    the neighbouring raw tiles, shape (256+2R, 256+2R).  Returns the repaired
    256x256 centre: nodata fill -> clamp >= 0 -> isolated-needle and 5x5-median
    spike/pit repair.  A pure function of the raw source data, so every output
    tile that reads this source tile sees identical values."""
    from scipy import ndimage as ndi
    R = RING
    h = ctx.astype(np.float32, copy=True)
    nd = h < NODATA_BELOW_M
    if nd.any():
        if nd.all():
            return np.zeros((256, 256), np.float32)
        idx = ndi.distance_transform_edt(nd, return_distances=False, return_indices=True)
        h = h[idx[0], idx[1]]
        if stats is not None:
            stats['nodata_px'] += int(nd[R:-R, R:-R].sum())
    np.maximum(h, 0.0, out=h)  # clamp bathymetry: water sits at 0 m
    lat = C.y2lat(y + 0.5, z)
    px = 40075016.7 * math.cos(math.radians(lat)) / (1 << z) / 256.0
    ts, tp = max(SPIKE_MIN_M, SPIKE_PX * px), max(PIT_MIN_M, PIT_PX * px)
    Rc = slice(R, -R)
    for it in range(REPAIR_PASSES):
        c = h[1:-1, 1:-1]  # every pixel of c has its 8 real neighbours in h
        nb = np.stack([h[:-2, :-2], h[:-2, 1:-1], h[:-2, 2:], h[1:-1, :-2], h[1:-1, 2:], h[2:, :-2], h[2:, 1:-1], h[2:, 2:]])
        nb.sort(axis=0)
        d6 = (c - (nb.sum(axis=0) - nb[0] - nb[7]) / 6.0)[R - 1:-(R - 1), R - 1:-(R - 1)]
        del nb
        if not (d6.max() > min(0.25 * ts, 0.5 * REL_MIN_M) or d6.min() < -min(0.25 * tp, 0.5 * REL_MIN_M)):
            break
        cur = h[Rc, Rc]
        med = ndi.median_filter(h, size=5, mode='nearest')[Rc, Rc]
        d = cur - med
        bad = (d > ts) | (d < -tp)
        fix = np.where(bad, med, cur)
        # RELATIVE rule: garbage stands out from a CALM neighbourhood, a real peak from a
        # rough one: |h - median7| > max(100 m, 2.5 x IQR of the 7x7 window) -> median7.
        # 7x7 so an 8-px garbage block cannot drag the upper quartile; repeated passes
        # peel clusters.  Measured: Terrarium's z8-z11 needles (1,007 m on the Sydney CBD at
        # z9, 1,516 m in flat Pennsylvania at z8, a 638 m block in NJ where the state's top
        # is 550 m, 171-438 m on the Norfolk coast) are removed, while the Matterhorn, Pedra
        # da Gavea, Corcovado, Jungfrau, Mont Blanc and Monte Baldo keep their raw maxima.
        rel = np.zeros_like(bad)
        if z >= REL_MIN_Z and (np.abs(d) > REL_MIN_M).any():
            m7 = ndi.median_filter(h, size=7, mode='nearest')[Rc, Rc]
            d7 = cur - m7
            cand = np.abs(d7) > REL_MIN_M
            if cand.any():
                q = ndi.percentile_filter(h, 75, size=7, mode='nearest')[Rc, Rc] - ndi.percentile_filter(h, 25, size=7, mode='nearest')[Rc, Rc]
                rel = cand & (np.abs(d7) > REL_K * q) & ~bad
                fix = np.where(rel, m7, fix)
        bad |= rel
        if not bad.any():
            break
        h[Rc, Rc] = fix
        if stats is not None:
            stats['relative_px'] += int(rel.sum())
            stats['abs_spike_pit_px'] += int((bad & ~rel).sum())
            stats['repair_passes'] += 1
    out = h[Rc, Rc].copy()
    return out


def worldcover_class_mask(z, x, y, rgb):
    """Bool 256x256 mask of one WorldCover legend colour at the pixel centres
    of XYZ tile z/x/y (nearest neighbour), or None when no tile exists."""
    if z <= 14:
        p = os.path.join(WC_ROOT, str(z), str(x), '%d.png' % y)
        if not os.path.exists(p):
            return None
        a = np.asarray(Image.open(p).convert('RGBA'))
        return (a[:, :, 0] == rgb[0]) & (a[:, :, 1] == rgb[1]) & (a[:, :, 2] == rgb[2]) & (a[:, :, 3] == 255)
    up = worldcover_class_mask(z - 1, x >> 1, y >> 1, rgb)
    if up is None:
        return None
    q = up[(y & 1) * 128:(y & 1) * 128 + 128, (x & 1) * 128:(x & 1) * 128 + 128]
    return np.repeat(np.repeat(q, 2, axis=0), 2, axis=1)  # pixel i -> parent pixel i//2


def worldcover_water_mask(z, x, y):
    """Bool 256x256 mask of WorldCover class 80 at the pixel centres of XYZ
    tile z/x/y (nearest neighbour), or None when no WorldCover tile exists."""
    if z <= 14:
        p = os.path.join(WC_ROOT, str(z), str(x), '%d.png' % y)
        if not os.path.exists(p):
            return None
        a = np.asarray(Image.open(p).convert('RGBA'))
        return (a[:, :, 0] == WC_WATER[0]) & (a[:, :, 1] == WC_WATER[1]) & (a[:, :, 2] == WC_WATER[2]) & (a[:, :, 3] == 255)
    up = worldcover_water_mask(z - 1, x >> 1, y >> 1)
    if up is None:
        return None
    q = up[(y & 1) * 128:(y & 1) * 128 + 128, (x & 1) * 128:(x & 1) * 128 + 128]
    return np.repeat(np.repeat(q, 2, axis=0), 2, axis=1)  # pixel i -> parent pixel i//2


class TerrariumLRU:
    def __init__(self, cap=512):
        self.cap = cap
        self.d = collections.OrderedDict()
        self.missing = set()
        self.flat_tiles = 0
        self.flat_px = 0
        self.no_mask = set()
        self.repair = collections.Counter()
        self.raw = collections.OrderedDict()

    def get(self, z, x, y):
        n = 1 << z
        x %= n  # antimeridian wrap
        k = (z, x, y)
        a = self.d.get(k)
        if a is not None:
            self.d.move_to_end(k)
            return a
        op = despike_path(z, x, y)
        a = np.load(op) if os.path.exists(op) else self.base(z, x, y)
        self.d[k] = a
        if len(self.d) > self.cap:
            self.d.popitem(last=False)
        return a

    def raw_tile(self, z, x, y):
        """Undecorated Terrarium heights (float32) or None if the tile does not exist."""
        n = 1 << z
        x %= n
        y = min(max(y, 0), n - 1)
        k = (z, x, y)
        a = self.raw.get(k, False)
        if a is not False:
            self.raw.move_to_end(k)
            return a
        p = cache_path(z, x, y)
        if os.path.exists(p):
            im = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)
            a = im[:, :, 0] * 256.0 + im[:, :, 1] + im[:, :, 2] / 256.0 - 32768.0
        elif os.path.exists(p + '.missing'):
            self.missing.add(k)
            a = None
        else:
            fetch_one(z, x, y)
            return self.raw_tile(z, x, y)
        self.raw[k] = a
        if len(self.raw) > 1024:
            self.raw.popitem(last=False)
        return a

    def context(self, z, x, y):
        """RAW tile with a RING-px border from its 8 neighbours (x wraps, y clamps
        to the pole row; a missing tile reads as nodata)."""
        R = RING
        ctx = np.full((256 + 2 * R, 256 + 2 * R), -32768.0, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                a = self.raw_tile(z, x + dx, y + dy)
                if a is None:
                    continue
                if not (0 <= y + dy < (1 << z)):
                    a = a[:1, :] if dy < 0 else a[-1:, :]  # beyond the pole: repeat the edge row
                    a = np.repeat(a, 256, axis=0)
                ys = slice(256 - R, 256) if dy < 0 else slice(0, R) if dy > 0 else slice(0, 256)
                xs = slice(256 - R, 256) if dx < 0 else slice(0, R) if dx > 0 else slice(0, 256)
                oy = 0 if dy < 0 else 256 + R if dy > 0 else R
                ox = 0 if dx < 0 else 256 + R if dx > 0 else R
                blk = a[ys, xs]
                ctx[oy:oy + blk.shape[0], ox:ox + blk.shape[1]] = blk
        return ctx

    def base(self, z, x, y):
        """Repaired + clamped + water-flattened Terrarium heights (no de-spike), uncached."""
        x %= (1 << z)
        k = (z, x, y)
        if self.raw_tile(z, x, y) is None:
            return np.zeros((256, 256), np.float32)
        a = repair_source(self.context(z, x, y), z, y, self.repair)
        if z >= WATER_FLATTEN_MIN_ZS:
            m = worldcover_water_mask(z, x, y)
            if m is None:
                self.no_mask.add(k)
            else:
                sel = m & (a < WATER_FLATTEN_MAX_H) & (a > 0.0)
                self.flat_tiles += 1
                self.flat_px += int(sel.sum())
                a[sel] = 0.0
        return a


def despike_region(cfg):
    return C.box_deg(cfg['center'][0], cfg['center'][1], cfg['box_km'][0] / 2.0, cfg['box_km'][1] / 2.0)


def despike_path(z, x, y):
    return os.path.join(DESPIKE_DIR, str(z), str(x), '%d.npy' % y)


def compute_despike(lru, name, loc, cfg):
    """Write de-spike override tiles for one location. Returns True if any
    zoom was (re)computed, i.e. the location's z>=12 outputs must be rebuilt."""
    from scipy import ndimage as ndi
    changed = False
    R = despike_region(cfg)
    lat = cfg['center'][0]
    for zs in DESPIKE_ZS:
        params = dict(cfg, zs=zs, rev=DESPIKE_REV, water_rev=[WATER_FLATTEN_MIN_ZS, WATER_FLATTEN_MAX_H], repair_rev=REPAIR_REV)
        pfile = os.path.join(DESPIKE_DIR, 'params-%s-z%d.json' % (name, zs))
        rR = C.tile_range(R, zs)
        try:
            with open(pfile) as f:
                old = json.load(f)
        except Exception:
            old = None
        if old and old.get('params') == params and all(os.path.exists(despike_path(zs, x, y)) for x, y in C.range_tiles(rR)):
            continue
        t0 = time.time()
        if old:  # drop the previous run's overrides so no stale tile survives a region change
            ox0, ox1, oy0, oy1 = old['tiles']
            for x in range(ox0, ox1 + 1):
                for y in range(oy0, oy1 + 1):
                    try:
                        os.remove(despike_path(zs, x, y))
                    except FileNotFoundError:
                        pass
        px_m = 40075016.7 * math.cos(math.radians(lat)) / (1 << zs) / 256.0
        k = max(3, int(round(cfg['window_m'] / px_m)) | 1)
        sg = max(0.5, k * cfg['smooth_frac'])
        sb = max(0.5, cfg['built_sigma_m'] / px_m)
        m = int(math.ceil((k + 4 * sg + 4 * sb + 4) / 256.0)) + 1
        n = 1 << zs
        x0, x1, y0, y1 = rR[0] - m, rR[1] + m, max(0, rR[2] - m), min(n - 1, rR[3] + m)
        W, Hh = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
        H = np.empty((Hh, W), np.float32)
        B_ = np.zeros((Hh, W), np.float32)
        L_ = np.ones((Hh, W), np.float32)  # land (not WorldCover water)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                sl = (slice((y - y0) * 256, (y - y0 + 1) * 256), slice((x - x0) * 256, (x - x0 + 1) * 256))
                H[sl] = lru.base(zs, x, y)
                bm = worldcover_class_mask(zs, x % n, y, WC_BUILT)
                if bm is not None:
                    B_[sl] = bm
                wm = worldcover_class_mask(zs, x % n, y, WC_WATER)
                if wm is not None:
                    L_[sl] = ~wm
        T = ndi.grey_opening(H, size=(k, k))
        T = ndi.gaussian_filter(T, sg)
        np.minimum(T, H, out=T)
        # built-up share of the LAND around each pixel (normalised convolution), so
        # a built pier or point surrounded by water is weighted like the city
        wgt = ndi.gaussian_filter(B_ * L_, sb) / np.maximum(ndi.gaussian_filter(L_, sb), 0.05)
        del B_, L_
        wgt *= cfg['gain']
        np.clip(wgt, 0.0, 1.0, out=wgt)
        # fade in from the edge of the de-spike region R (pure function of position)
        jj = np.arange(W, dtype=np.float64) + 0.5
        ii = np.arange(Hh, dtype=np.float64) + 0.5
        lon = (x0 + jj / 256.0) / n * 360.0 - 180.0
        la = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * (y0 + ii / 256.0) / n))))
        kx = C.KM_PER_DEG_LAT * math.cos(math.radians(lat))
        dx = np.minimum(lon - R[0], R[2] - lon) * kx
        dy = np.minimum(la - R[1], R[3] - la) * C.KM_PER_DEG_LAT
        wr = np.clip(np.minimum(dy[:, None], dx[None, :]) / cfg['ramp_km'], 0.0, 1.0).astype(np.float32)
        wgt *= wr
        del wr
        drop = wgt * (H - T)
        del T, wgt
        Hn = H - drop
        inner = drop[(rR[2] - y0) * 256:(rR[3] - y0 + 1) * 256, (rR[0] - x0) * 256:(rR[1] - x0 + 1) * 256]
        st = {'window_px': k, 'max_drop_m': round(float(drop.max()), 1), 'px_dropped_gt1m': int((inner > 1).sum()),
              'px_region': int(inner.size), 'mean_drop_m': round(float(inner.mean()), 3)}
        del drop
        for x, y in C.range_tiles(rR):
            sl = (slice((y - y0) * 256, (y - y0 + 1) * 256), slice((x - x0) * 256, (x - x0 + 1) * 256))
            pth = despike_path(zs, x, y)
            os.makedirs(os.path.dirname(pth), exist_ok=True)
            tmp = pth + '.tmp%d.npy' % os.getpid()
            np.save(tmp, np.ascontiguousarray(Hn[sl], dtype=np.float32))
            os.replace(tmp, pth)
        del Hn, H
        C.write_atomic(pfile, json.dumps({'params': params, 'tiles': [rR[0], rR[1], rR[2], rR[3]], 'stats': st}, indent=1).encode())
        print('  despike %s zs%d: %d tiles, %s  %.0fs' % (name, zs, C.range_count(rR), st, time.time() - t0), flush=True)
        changed = True
    return changed


def sample_tile(lru, z, x, y):
    """Edge-inclusive bilinear N x N heights (metres, >= 0) for output tile z/x/y."""
    N = dem_n(z)
    zs = src_zoom(z)
    scale = 256.0 * (2.0 ** (zs - z))       # source pixels per output tile (power of two)
    f = np.arange(N, dtype=np.float64) / (N - 1)  # f[N-1] == 1.0 exactly
    gx = (x + f) * scale - 0.5                # pixel-centre convention
    gy = (y + f) * scale - 0.5
    H = 256 * (1 << zs)
    ix0 = np.floor(gx).astype(np.int64)
    iy0 = np.floor(gy).astype(np.int64)
    wx = gx - ix0
    wy = gy - iy0
    iy1 = np.clip(iy0 + 1, 0, H - 1)
    iy0 = np.clip(iy0, 0, H - 1)
    ix1 = ix0 + 1
    txa, txb = int(ix0.min()) // 256, int(ix1.max()) // 256
    tya, tyb = int(iy0.min()) // 256, int(iy1.max()) // 256
    M = np.empty(((tyb - tya + 1) * 256, (txb - txa + 1) * 256), np.float32)
    for ty in range(tya, tyb + 1):
        for tx in range(txa, txb + 1):
            M[(ty - tya) * 256:(ty - tya + 1) * 256, (tx - txa) * 256:(tx - txa + 1) * 256] = lru.get(zs, tx, ty)
    cx0, cx1 = ix0 - txa * 256, ix1 - txa * 256
    ry0, ry1 = iy0 - tya * 256, iy1 - tya * 256
    v00 = M[np.ix_(ry0, cx0)].astype(np.float64)
    v01 = M[np.ix_(ry0, cx1)].astype(np.float64)
    v10 = M[np.ix_(ry1, cx0)].astype(np.float64)
    v11 = M[np.ix_(ry1, cx1)].astype(np.float64)
    wxr = wx[None, :]
    wyc = wy[:, None]
    top = v00 * (1.0 - wxr) + v01 * wxr
    bot = v10 * (1.0 - wxr) + v11 * wxr
    return top * (1.0 - wyc) + bot * wyc


def encode_terrain_rgb(h):
    v = np.floor((h + 10000.0) * 10.0 + 0.5).astype(np.int64)
    np.clip(v, 0, 0xFFFFFF, out=v)
    N = h.shape[0]
    rgba = np.empty((N, N, 4), np.uint8)
    rgba[:, :, 0] = (v >> 16) & 255
    rgba[:, :, 1] = (v >> 8) & 255
    rgba[:, :, 2] = v & 255
    rgba[:, :, 3] = 255
    return C.encode_png_rgba(rgba)


def decode_terrain_rgb_png(path):
    """Inverse of the app's decoder (index.js worker): a==0 ? 0 : -1e4 + v*0.1."""
    a = np.asarray(Image.open(path).convert('RGBA'), dtype=np.int64)
    v = (a[:, :, 0] << 16) | (a[:, :, 1] << 8) | a[:, :, 2]
    return np.where(a[:, :, 3] == 0, 0.0, -10000.0 + v * 0.1)


def out_path(z, x, y):
    return os.path.join(OUT, str(z), str(x), '%d.png' % y)


# ------------------------------------------------------------------ tile sets
def tile_sets(locs, with_global=True):
    """[(label, z, (x0,x1,y0,y1))] in build order."""
    sets = []
    if with_global:
        for z in GLOBAL_Z:
            n = (1 << z) - 1
            sets.append(('global', z, (0, n, 0, n)))
    for name, loc in locs:
        fb, cb = C.far_bbox(loc), C.core_bbox(loc)
        for z in FAR_Z:
            sets.append((name + ':far', z, C.tile_range(fb, z)))
        for z in CORE_Z:
            sets.append((name + ':core', z, C.tile_range(cb, z, pad=CORE_PAD)))
    return sets


def source_tiles(z, r):
    zs = src_zoom(z)
    x0, x1, y0, y1 = r
    sh = z - zs
    n = 1 << zs
    out = set()
    # +-1 source tile for the bilinear footprint, +-1 more for the repair context ring
    for ty in range(max(0, (y0 >> sh) - 2), min(n - 1, (y1 >> sh) + 2) + 1):
        for tx in range((x0 >> sh) - 2, (x1 >> sh) + 3):
            out.add((zs, tx % n, ty))
    return out


def build_set(lru, label, z, r, force=False):
    t0 = time.time()
    made = skipped = 0
    for x, y in C.range_tiles(r):
        p = out_path(z, x, y)
        if not (force is True or (force and z >= force)) and os.path.exists(p):
            skipped += 1
            continue
        C.write_atomic(p, encode_terrain_rgb(sample_tile(lru, z, x, y)))
        made += 1
    print('  %-12s z%-2d %5d tiles  made %5d  skipped %5d  %.1fs' % (label, z, C.range_count(r), made, skipped, time.time() - t0), flush=True)
    return made, skipped


def write_manifest(locs):
    sets = tile_sets(C.load_locations(), True)
    per = collections.defaultdict(dict)
    zoom_tot = collections.Counter()
    seen = set()
    total_bytes = 0
    for label, z, r in sets:
        present = 0
        byts = 0
        for x, y in C.range_tiles(r):
            p = out_path(z, x, y)
            if os.path.exists(p):
                present += 1
                if (z, x, y) not in seen:
                    seen.add((z, x, y))
                    s = os.path.getsize(p)
                    byts += s
                    total_bytes += s
                    zoom_tot[z] += 1
        per[label][str(z)] = {'x': [r[0], r[1]], 'y': [r[2], r[3]], 'tiles': C.range_count(r), 'present': present, 'N': dem_n(z), 'source_z': src_zoom(z)}
    loc_meta = {n: {'lat': l['lat'], 'lon': l['lon'], 'core_km': l['core_km'], 'far_km': l['far_km'],
                    'core_bbox_wsen': [round(v, 6) for v in C.core_bbox(l)], 'far_bbox_wsen': [round(v, 6) for v in C.far_bbox(l)],
                    'core_pad_tiles': CORE_PAD} for n, l in C.load_locations()}
    missing_src = []
    for root, _, files in os.walk(CACHE):
        for fn in files:
            if fn.endswith('.missing'):
                missing_src.append(os.path.relpath(os.path.join(root, fn), CACHE)[:-8])
    man = {
        'kind': 'skyloom-trailer-dem', 'version': 1,
        'built_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'path': 'dem/{z}/{x}/{y}.png', 'scheme': 'xyz', 'crs': 'EPSG:3857',
        'encoding': 'mapbox terrain-rgb: h = -10000 + (R*65536 + G*256 + B) * 0.1 ; A = 255',
        'png': 'RGBA8, filter 0, chunks IHDR/IDAT/IEND only (no gAMA/sRGB/iCCP/cHRM)',
        'grid': 'edge-inclusive N x N, N = min(64,(z+2)*3); vertex (i,j) at tile fraction (i/(N-1), j/(N-1)), row 0 = north',
        'N_by_zoom': {str(z): dem_n(z) for z in range(0, 17)},
        'source': {'name': 'AWS Terrain Tiles (Terrarium), s3://elevation-tiles-prod/terrarium',
                   'url': TERRARIUM, 'decode': 'h = R*256 + G + B/256 - 32768',
                   'clamp': 'h < 0 -> 0 (bathymetry removed, applied per source pixel before interpolation)',
                   'zoom_rule': 'z<=4: z; 5..12: z-1; 13..15: z; 16: 15 (bilinear upsampling)',
                   'despike': {'locations': DESPIKE, 'source_zooms': list(DESPIKE_ZS), 'rev': DESPIKE_REV,
                               'rule': 'H - w*(H - min(H, gauss(grey_opening(H, window_m), smooth_frac*window))), w = clip(gain*gauss(WorldCover50*land, built_sigma_m)/gauss(land, built_sigma_m)) * ramp(box_km around center, ramp_km)'},
                   'repair': 'per source tile: h < %g -> nearest valid pixel; clamp >= 0; pixels > max(%g m, %g px) above or > max(%g m, %g px) below their 5x5 median, or (z >= %d) |h - median7| > max(%g m, %g x IQR7) -> 7x7 median; up to %d passes (rev %d)' % (NODATA_BELOW_M, SPIKE_MIN_M, SPIKE_PX, PIT_MIN_M, PIT_PX, REL_MIN_Z, REL_MIN_M, REL_K, REPAIR_PASSES, REPAIR_REV),
                   'water_flatten': 'source zoom >= %d: pixels with ESA WorldCover class 80 and h < %g m set to 0 m (worldcover tile z/x/y, z14 parent for z15)' % (WATER_FLATTEN_MIN_ZS, WATER_FLATTEN_MAX_H),
                   'attribution': 'Terrain Tiles: Mapzen/Linux Foundation, AWS Open Data; sources incl. SRTM, GMTED2010, ETOPO1, USGS 3DEP/NED, Copernicus/EU-DEM, LINZ, etc. (see github.com/tilezen/joerd/blob/master/docs/attribution.md)',
                   'missing_source_tiles': sorted(missing_src)},
        'coverage': {'global': 'z0-4', 'far_ring': 'z5-12 (square +-far_km)', 'core': 'z13-16 (core box + %d tile ring)' % CORE_PAD},
        'locations': loc_meta, 'sets': per,
        'unique_tiles_by_zoom': {str(k): zoom_tot[k] for k in sorted(zoom_tot)},
        'unique_tiles': sum(zoom_tot.values()), 'bytes': total_bytes,
        'serve_note': 'Tiles outside these sets are not built; server.py derives them from the nearest built ancestor (bilinear, edge-inclusive) rather than 404ing (a DEM failure is a failed replacement in three-tile).',
    }
    C.write_atomic(os.path.join(OUT, 'manifest.json'), json.dumps(man, indent=1).encode())
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--locs', default='')
    ap.add_argument('--no-global', action='store_true')
    ap.add_argument('--fetch-workers', type=int, default=16)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--force-zmin', type=int, default=0, help='rebuild existing tiles at z >= this')
    ap.add_argument('--manifest-only', action='store_true')
    a = ap.parse_args()
    force = True if a.force else (a.force_zmin or False)
    locs = C.load_locations([s for s in a.locs.split(',') if s] or None)
    if a.manifest_only:
        write_manifest(locs)
        return
    lru = TerrariumLRU(512)
    groups = []
    if not a.no_global:
        groups.append(('global', tile_sets([], True)))
    for name, loc in locs:
        groups.append((name, tile_sets([(name, loc)], False)))
    for gname, sets in groups:
        t0 = time.time()
        gforce = force
        if gname in DESPIKE:
            loc = dict(locs)[gname]
            # Terrarium sources for the de-spike mosaics (idempotent fetch)
            cfg = DESPIKE[gname]
            R = despike_region(cfg)
            dneed = set()
            for zs in DESPIKE_ZS:
                x0, x1, y0, y1 = C.tile_range(R, zs, pad=4)
                dneed |= {(zs, x % (1 << zs), y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
            prefetch(sorted(dneed), a.fetch_workers)
            if compute_despike(lru, gname, loc, cfg) and force is not True:
                gforce = 12 if not force else min(force, 12)
                lru.d.clear()
        need = set()
        for label, z, r in sets:
            if not (gforce is True or (gforce and z >= gforce)) and all(os.path.exists(out_path(z, x, y)) for x, y in C.range_tiles(r)):
                continue
            need |= source_tiles(z, r)
        print('[%s] %d source tiles referenced' % (gname, len(need)), flush=True)
        cnt = prefetch(sorted(need), a.fetch_workers)
        if cnt:
            print('[%s] fetch %s in %.0fs' % (gname, dict(cnt), time.time() - t0), flush=True)
        for label, z, r in sets:
            build_set(lru, label, z, r, gforce)
        print('[%s] done in %.0fs  (water-flattened source tiles %d, px %d, no WorldCover mask %d; repair %s)' % (
            gname, time.time() - t0, lru.flat_tiles, lru.flat_px, len(lru.no_mask), dict(lru.repair)), flush=True)
        write_manifest(locs)
    man = write_manifest(locs)
    print('manifest: %d unique tiles, %.1f MB' % (man['unique_tiles'], man['bytes'] / 1e6))


if __name__ == '__main__':
    main()

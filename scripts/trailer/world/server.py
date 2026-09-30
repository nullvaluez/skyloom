#!/usr/bin/env python3
"""Skyloom trailer: REAL-DATA TILE SERVER, a drop-in for the offline fixture.

The R24 fixture (scripts/r24-fixture/server.mjs) serves synthetic tiles. This
server answers the SAME routes from a real-world tile set on disk, so
scripts/_fixture.js can point at it through FLY_FIXTURE_URL and nothing else
in the harness changes.

DATA ROOT (env TRAILER_WORLD_ROOT, default /tmp/claude-0/world):
    img/{z}/{x}/{y}.jpg          Sentinel-2 imagery, XYZ numbering, 256 JPEG
    img/manifest.json            optional; 'fallback_rgb' = [r,g,b] or '#rrggbb'
    mvt/{z}/{x}/{y}.pbf          MVT (OMT schema), raw (gzip is unwrapped here)
    dem/{z}/{x}/{y}.png          Mapbox terrain-rgb, edge-inclusive samples
    worldcover/{z}/{x}/{y}.png   ESA WorldCover legend-exact 256 PNG
    traffic.json                 optional /api/aircraft payload (or bare ac list)
    aircraft/{hex}/{info,photo,route}.json   optional canned inspect-card data

ROUTES (every response: ACAO *, ACAH *; OPTIONS -> 204):
    GET  /__health               {"ok":true,"rev":"trailer-real-1"}
    GET  /__stats                per-kind counters, misses, fallbacks, latency
    GET|POST /__stats/reset      zero the counters
    GET  /__spec                 layout / contract summary
    GET  /planet, /planet.json   TileJSON -> http://127.0.0.1:<port>/mvt/{z}/{x}/{y}.pbf
    GET  /mvt/{z}/{x}/{y}.pbf    file bytes, or a ZERO-LENGTH 200. NEVER 404:
                                 a 404 near the aircraft blocks the satellite
                                 reveal forever (data-contract.md s0.1).
    GET  /img/{z}/{y}/{x}        ArcGIS z/y/x ORDER in the URL. File, else a
                                 crop of the nearest ancestor upscaled to 256,
                                 else an opaque neutral tile. Always 200/256px.
    GET  /dem/{z}/{x}/{y}.png    File, else the nearest ancestor's heights
                                 bilinear-resampled edge-inclusively at
                                 N=min(64,(z+2)*3), else flat 0 m. Always 200.
    GET  /worldcover/{z}/{x}/{y}.png   file or 404 (404 is harmless there)
    GET  /api/aircraft           traffic.json with a fresh 'now', else empty
    GET  /api/aircraft/{hex}/{info|photo|route}   canned file or honest miss
    GET  /api/weather            {"found": false}

ENV:
    TRAILER_WORLD_PORT     default 3301
    TRAILER_WORLD_HOST     bind address, default 127.0.0.1
    TRAILER_WORLD_ROOT     default /tmp/claude-0/world
    TRAILER_WORLD_PUBLIC   base URL written into the TileJSON (default
                           http://127.0.0.1:<port the /planet request came in on>)
    TRAILER_WORLD_MVT_BASE overrides TRAILER_WORLD_PUBLIC for the TileJSON only
    TRAILER_WORLD_EXTRA_PORTS  e.g. '3302,3303': extra listeners, same world
    TRAILER_WORLD_LOG      '1' logs one line per request to stderr
    TRAILER_WORLD_MAX_AGE  seconds; >0 sends 'public, max-age=N' instead of
                           'no-store' (default 0 = no-store, fixture parity)
    TRAILER_WORLD_LRU_MB   synthesized-tile LRU budget, default 256

Per-request work is kept tiny: real tiles are one stat + one read; synthesized
tiles are computed once (single-flight) and kept in a byte-budgeted LRU whose
key includes the ancestor's path and mtime, so a tile that lands on disk later
always wins and a rebuilt ancestor invalidates its descendants.
"""
import io
import json
import math
import os
import socket
import struct
import sys
import threading
import time
import zlib
import gzip
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

REV = 'trailer-real-1'
PORT = int(os.environ.get('TRAILER_WORLD_PORT', '3301'))
HOST = os.environ.get('TRAILER_WORLD_HOST', '127.0.0.1')
ROOT = os.path.abspath(os.environ.get('TRAILER_WORLD_ROOT', '/tmp/claude-0/world'))
LOG = os.environ.get('TRAILER_WORLD_LOG', '0') == '1'
MAX_AGE = int(os.environ.get('TRAILER_WORLD_MAX_AGE', '0') or 0)
LRU_BYTES = int(float(os.environ.get('TRAILER_WORLD_LRU_MB', '256')) * 1024 * 1024)
MAX_Z = 24  # hard ceiling on requested zoom (guards against absurd ancestor walks)
DEFAULT_FALLBACK_RGB = (0x23, 0x38, 0x4A)  # muted deep-sea blue-grey

# Heavy libraries are imported lazily-at-start so a missing one fails loudly.
from PIL import Image  # noqa: E402
import numpy as np  # noqa: E402

CACHE_CONTROL = f'public, max-age={MAX_AGE}' if MAX_AGE > 0 else 'no-store'


# --------------------------------------------------------------------------
# small utilities
# --------------------------------------------------------------------------
class LRU:
    """Thread-safe byte-budgeted LRU of immutable values."""

    def __init__(self, max_bytes, max_items=100000):
        self.max_bytes = max_bytes
        self.max_items = max_items
        self.d = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()
        self.hits = 0
        self.misses = 0
        self.evictions = 0

    def get(self, key):
        with self.lock:
            v = self.d.get(key)
            if v is None:
                self.misses += 1
                return None
            self.d.move_to_end(key)
            self.hits += 1
            return v[0]

    def put(self, key, value, size):
        with self.lock:
            old = self.d.pop(key, None)
            if old is not None:
                self.bytes -= old[1]
            self.d[key] = (value, size)
            self.bytes += size
            while self.d and (self.bytes > self.max_bytes or len(self.d) > self.max_items):
                _, (_, s) = self.d.popitem(last=False)
                self.bytes -= s
                self.evictions += 1

    def info(self):
        with self.lock:
            return {'items': len(self.d), 'bytes': self.bytes, 'hits': self.hits,
                    'misses': self.misses, 'evictions': self.evictions}


class SingleFlight:
    """Collapse concurrent computations of the same key into one."""

    def __init__(self):
        self.lock = threading.Lock()
        self.inflight = {}

    def do(self, key, fn):
        with self.lock:
            ev = self.inflight.get(key)
            if ev is None:
                ev = [threading.Event(), None, None]
                self.inflight[key] = ev
                leader = True
            else:
                leader = False
        if not leader:
            ev[0].wait(30)
            if ev[2] is not None:
                raise ev[2]
            return ev[1]
        try:
            ev[1] = fn()
            return ev[1]
        except BaseException as e:  # propagate to followers too
            ev[2] = e
            raise
        finally:
            ev[0].set()
            with self.lock:
                self.inflight.pop(key, None)


_CRC = zlib.crc32


def encode_png_rgba(rgba, w, h):
    """Minimal RGBA8 PNG (IHDR/IDAT/IEND only: no gAMA/sRGB/iCCP/cHRM, so the
    browser applies no colour management to terrain-rgb values)."""
    raw = bytearray()
    stride = w * 4
    buf = rgba.tobytes() if hasattr(rgba, 'tobytes') else bytes(rgba)
    for y in range(h):
        raw.append(0)
        raw += buf[y * stride:(y + 1) * stride]

    def chunk(t, data):
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', _CRC(t + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))


def dem_size(z):
    """The three-tile terrain-rgb loader crops to n = clamp((z+2)*3, 2, 64)."""
    return max(2, min(64, (z + 2) * 3))


def heights_to_terrain_rgb(h):
    v = np.rint((h.astype(np.float64) + 10000.0) * 10.0)
    v = np.clip(v, 0, 0xFFFFFF).astype(np.uint32)
    n0, n1 = h.shape
    rgba = np.empty((n0, n1, 4), dtype=np.uint8)
    rgba[..., 0] = (v >> 16) & 0xFF
    rgba[..., 1] = (v >> 8) & 0xFF
    rgba[..., 2] = v & 0xFF
    rgba[..., 3] = 255
    return encode_png_rgba(rgba, n1, n0)


def decode_terrain_rgb(data):
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    a = np.asarray(im, dtype=np.uint32)
    v = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
    h = -10000.0 + v.astype(np.float64) * 0.1
    h[a[..., 3] == 0] = 0.0  # the app decodes alpha-0 as 0 m
    return h


def parse_rgb(v):
    try:
        if isinstance(v, str):
            s = v.strip().lstrip('#')
            if len(s) == 3:
                s = ''.join(c * 2 for c in s)
            return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
        if isinstance(v, (list, tuple)) and len(v) >= 3:
            return tuple(max(0, min(255, int(round(float(c))))) for c in v[:3])
    except Exception:
        pass
    return None


def stat_file(path):
    """(mtime_ns, size) of a non-empty regular file, else None."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    if st.st_size <= 0:
        return None
    return (st.st_mtime_ns, st.st_size)


def read_file(path):
    try:
        with open(path, 'rb') as f:
            return f.read()
    except OSError:
        return None


# --------------------------------------------------------------------------
# stats
# --------------------------------------------------------------------------
class Stats:
    KINDS = ('health', 'stats', 'spec', 'tilejson', 'mvt', 'img', 'dem', 'worldcover',
             'aircraft', 'aircraft_info', 'weather', 'options', 'other')

    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        with self.lock:
            self.t0 = time.time()
            self.total = 0
            self.by_kind = {}
            self.recent_misses = []

    def _k(self, kind):
        k = self.by_kind.get(kind)
        if k is None:
            k = self.by_kind[kind] = {'count': 0, 'hit': 0, 'miss': 0, 'fallback': 0,
                                      'fallbackCached': 0, 'neutral': 0, 'errors': 0,
                                      'bytes': 0, 'msTotal': 0.0, 'msMax': 0.0,
                                      'missByZ': {}, 'fallbackByZ': {}, 'ancestorDz': {}}
        return k

    def record(self, kind, outcome, z, nbytes, ms, path=None, dz=None):
        with self.lock:
            self.total += 1
            k = self._k(kind)
            k['count'] += 1
            k['bytes'] += nbytes
            k['msTotal'] += ms
            if ms > k['msMax']:
                k['msMax'] = ms
            if outcome:
                k[outcome] = k.get(outcome, 0) + 1
            if z is not None and outcome in ('miss', 'fallback', 'fallbackCached', 'neutral'):
                key = 'missByZ' if outcome in ('miss', 'neutral') else 'fallbackByZ'
                k[key][str(z)] = k[key].get(str(z), 0) + 1
                if outcome in ('miss', 'neutral') and path is not None:
                    self.recent_misses.append(path)
                    if len(self.recent_misses) > 64:
                        del self.recent_misses[:len(self.recent_misses) - 64]
            if dz is not None:
                k['ancestorDz'][str(dz)] = k['ancestorDz'].get(str(dz), 0) + 1

    def snapshot(self, extra=None):
        with self.lock:
            kinds = {}
            for name, k in self.by_kind.items():
                kk = dict(k)
                kk['msMean'] = round(k['msTotal'] / k['count'], 3) if k['count'] else 0.0
                kk['msTotal'] = round(k['msTotal'], 3)
                kk['msMax'] = round(k['msMax'], 3)
                kk['missByZ'] = dict(k['missByZ'])
                kk['fallbackByZ'] = dict(k['fallbackByZ'])
                kk['ancestorDz'] = dict(k['ancestorDz'])
                kinds[name] = kk
            out = {'rev': REV, 'root': ROOT, 'since': self.t0, 'uptimeSec': round(time.time() - self.t0, 1),
                   'total': self.total, 'byKind': kinds, 'recentMisses': list(self.recent_misses)}
        if extra:
            out.update(extra)
        return out


STATS = Stats()


# --------------------------------------------------------------------------
# the world (all tile logic; independent of HTTP so it is unit-testable)
# --------------------------------------------------------------------------
class World:
    def __init__(self, root):
        self.root = root
        self.out_lru = LRU(LRU_BYTES)                   # synthesized response bodies
        self.src_lru = LRU(96 * 1024 * 1024, 512)       # decoded ancestors (PIL / numpy)
        self.sf = SingleFlight()
        self._manifest = (None, DEFAULT_FALLBACK_RGB)  # (mtime_ns, rgb)
        self._neutral = {}
        self._traffic = (None, None)
        self._lock = threading.Lock()

    # ---- paths ----
    def p_img(self, z, x, y):
        return os.path.join(self.root, 'img', str(z), str(x), f'{y}.jpg')

    def p_dem(self, z, x, y):
        return os.path.join(self.root, 'dem', str(z), str(x), f'{y}.png')

    def p_mvt(self, z, x, y):
        return os.path.join(self.root, 'mvt', str(z), str(x), f'{y}.pbf')

    def p_wc(self, z, x, y):
        return os.path.join(self.root, 'worldcover', str(z), str(x), f'{y}.png')

    # ---- ancestor walk ----
    @staticmethod
    def _valid(z, x, y):
        return 0 <= z <= MAX_Z and 0 <= x < (1 << z) and 0 <= y < (1 << z)

    def _find_ancestor(self, pathfn, z, x, y):
        for az in range(z - 1, -1, -1):
            d = z - az
            ax, ay = x >> d, y >> d
            p = pathfn(az, ax, ay)
            st = stat_file(p)
            if st is not None:
                return az, ax, ay, p, st
        return None

    # ---- imagery ----
    def fallback_rgb(self):
        mp = os.path.join(self.root, 'img', 'manifest.json')
        st = stat_file(mp)
        mt = st[0] if st else None
        cur = self._manifest
        if cur[0] == mt:
            return cur[1]
        rgb = DEFAULT_FALLBACK_RGB
        if st:
            try:
                with open(mp, 'r') as f:
                    j = json.load(f)
                rgb = parse_rgb(j.get('fallback_rgb')) or DEFAULT_FALLBACK_RGB
            except Exception:
                rgb = DEFAULT_FALLBACK_RGB
        self._manifest = (mt, rgb)
        return rgb

    def neutral_jpeg(self):
        rgb = self.fallback_rgb()
        b = self._neutral.get(rgb)
        if b is None:
            bio = io.BytesIO()
            Image.new('RGB', (256, 256), rgb).save(bio, 'JPEG', quality=90)
            b = self._neutral[rgb] = bio.getvalue()
        return b

    def _decoded_img(self, path, st):
        key = ('img', path, st[0], st[1])
        im = self.src_lru.get(key)
        if im is not None:
            return im

        def load():
            data = read_file(path)
            im2 = Image.open(io.BytesIO(data))
            im2.load()
            if im2.mode != 'RGB':
                im2 = im2.convert('RGB')
            self.src_lru.put(key, im2, im2.width * im2.height * 3)
            return im2
        return self.sf.do(key, load)

    def img(self, z, x, y):
        """-> (bytes, content_type, outcome, dz)"""
        if not self._valid(z, x, y):
            return self.neutral_jpeg(), 'image/jpeg', 'neutral', None
        p = self.p_img(z, x, y)
        data = read_file(p) if stat_file(p) else None
        if data:
            return data, 'image/jpeg', 'hit', None
        anc = self._find_ancestor(self.p_img, z, x, y)
        if anc is None:
            return self.neutral_jpeg(), 'image/jpeg', 'neutral', None
        az, ax, ay, ap, ast = anc
        key = ('imgfb', z, x, y, ap, ast[0], ast[1])
        body = self.out_lru.get(key)
        if body is not None:
            return body, 'image/jpeg', 'fallbackCached', z - az

        def build():
            src = self._decoded_img(ap, ast)
            d = z - az
            s = 1 << d
            fw = src.width / s
            fh = src.height / s
            ox = (x - (ax << d)) * fw
            oy = (y - (ay << d)) * fh
            out = src.resize((256, 256), Image.BICUBIC, box=(ox, oy, ox + fw, oy + fh))
            bio = io.BytesIO()
            out.save(bio, 'JPEG', quality=88)
            b = bio.getvalue()
            self.out_lru.put(key, b, len(b))
            return b
        return self.sf.do(key, build), 'image/jpeg', 'fallback', z - az

    # ---- DEM ----
    def _flat_dem(self, n):
        k = ('flat', n)
        b = self._neutral.get(k)
        if b is None:
            b = self._neutral[k] = heights_to_terrain_rgb(np.zeros((n, n)))
        return b

    def _decoded_dem(self, path, st):
        key = ('dem', path, st[0], st[1])
        h = self.src_lru.get(key)
        if h is not None:
            return h

        def load():
            h2 = decode_terrain_rgb(read_file(path))
            self.src_lru.put(key, h2, h2.nbytes)
            return h2
        return self.sf.do(key, load)

    @staticmethod
    def resample_child(h0, d, cx, cy, n):
        """Bilinear, EDGE-INCLUSIVE: ancestor sample (i, j) sits at ancestor
        fraction (j/(W-1), i/(H-1)); child sample k at child fraction k/(n-1),
        i.e. ancestor fraction (c + k/(n-1)) / 2^d. Row 0 = north."""
        H, W = h0.shape
        s = float(1 << d)
        k = np.arange(n, dtype=np.float64) / (n - 1)
        u = (cx + k) / s * (W - 1)
        v = (cy + k) / s * (H - 1)
        u0 = np.clip(np.floor(u).astype(np.int64), 0, W - 2)
        v0 = np.clip(np.floor(v).astype(np.int64), 0, H - 2)
        fu = (u - u0)[None, :]
        fv = (v - v0)[:, None]
        a = h0[v0[:, None], u0[None, :]]
        b = h0[v0[:, None], u0[None, :] + 1]
        c = h0[v0[:, None] + 1, u0[None, :]]
        e = h0[v0[:, None] + 1, u0[None, :] + 1]
        top = a + (b - a) * fu
        bot = c + (e - c) * fu
        return top + (bot - top) * fv

    def dem(self, z, x, y):
        n = dem_size(z)
        if not self._valid(z, x, y):
            return self._flat_dem(n), 'image/png', 'neutral', None
        p = self.p_dem(z, x, y)
        data = read_file(p) if stat_file(p) else None
        if data:
            return data, 'image/png', 'hit', None
        anc = self._find_ancestor(self.p_dem, z, x, y)
        if anc is None:
            return self._flat_dem(n), 'image/png', 'neutral', None
        az, ax, ay, ap, ast = anc
        key = ('demfb', z, x, y, ap, ast[0], ast[1])
        body = self.out_lru.get(key)
        if body is not None:
            return body, 'image/png', 'fallbackCached', z - az

        def build():
            h0 = self._decoded_dem(ap, ast)
            d = z - az
            if h0.shape[0] < 2 or h0.shape[1] < 2:
                hh = np.full((n, n), float(h0.flat[0]))
            else:
                hh = self.resample_child(h0, d, x - (ax << d), y - (ay << d), n)
            b = heights_to_terrain_rgb(hh)
            self.out_lru.put(key, b, len(b))
            return b
        return self.sf.do(key, build), 'image/png', 'fallback', z - az

    # ---- MVT ----
    def mvt(self, z, x, y):
        if not self._valid(z, x, y):
            return b'', 'miss'
        p = self.p_mvt(z, x, y)
        st = stat_file(p)
        if st is None:
            return b'', 'miss'
        data = read_file(p) or b''
        if data[:2] == b'\x1f\x8b':
            # The worker never decompresses (data-contract.md s0.2): unwrap here.
            key = ('mvtgz', p, st[0], st[1])
            body = self.out_lru.get(key)
            if body is None:
                try:
                    body = gzip.decompress(data)
                except Exception:
                    body = b''
                self.out_lru.put(key, body, len(body) + 64)
            return body, 'hit'
        return data, 'hit'

    # ---- WorldCover ----
    def worldcover(self, z, x, y):
        if not self._valid(z, x, y):
            return None
        p = self.p_wc(z, x, y)
        return read_file(p) if stat_file(p) else None

    # ---- traffic ----
    def traffic(self):
        tp = os.path.join(self.root, 'traffic.json')
        st = stat_file(tp)
        now = time.time()
        if st is None:
            return {'now': now, 'messages': 0, 'total': 0, 'ctime': int(now * 1000),
                    'ptime': 0, 'msg': 'No error', 'ac': []}
        cur = self._traffic
        if cur[0] != st:
            try:
                with open(tp, 'r') as f:
                    j = json.load(f)
                if isinstance(j, list):
                    j = {'ac': j}
                if not isinstance(j, dict):
                    j = {'ac': []}
                ac = j.get('ac') or []
                j.setdefault('messages', 1000000)
                j['total'] = len(ac)
                j.setdefault('ptime', 3)
                j.setdefault('msg', 'No error')
                j['ac'] = ac
            except Exception as e:
                sys.stderr.write(f'[trailer-world] traffic.json unreadable: {e}\n')
                j = {'messages': 0, 'total': 0, 'ptime': 0, 'msg': 'No error', 'ac': []}
            cur = self._traffic = (st, j)
        out = dict(cur[1])
        out['now'] = now          # MUST advance or use-fly-traffic drops the batch
        out['ctime'] = int(now * 1000)
        return out

    def aircraft_canned(self, hex_, kind):
        safe = ''.join(c for c in hex_.lower() if c.isalnum())[:16]
        p = os.path.join(self.root, 'aircraft', safe, f'{kind}.json')
        data = read_file(p) if stat_file(p) else None
        if data:
            return data
        if kind == 'info':
            return b'{"found":false}'
        if kind == 'photo':
            return b'{"photos":[]}'
        return b'null'

    def lru_info(self):
        return {'synthLru': self.out_lru.info(), 'sourceLru': self.src_lru.info()}


WORLD = World(ROOT)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
_REASONS = {200: 'OK', 204: 'No Content', 400: 'Bad Request', 404: 'Not Found',
            405: 'Method Not Allowed', 500: 'Internal Server Error'}
_CORS = (b'Access-Control-Allow-Origin: *\r\n'
         b'Access-Control-Allow-Headers: *\r\n')


def _i(s):
    return int(s)


def _match_tile(parts, prefix, n_ext=None):
    """parts = path segments. Returns three ints or None."""
    if len(parts) != 4 or parts[0] != prefix:
        return None
    a, b, c = parts[1], parts[2], parts[3]
    if n_ext:
        if not c.endswith(n_ext):
            return None
        c = c[:-len(n_ext)]
    else:
        # imagery: allow an optional extension on the last segment
        dot = c.find('.')
        if dot >= 0:
            c = c[:dot]
    if not (a.isdigit() and b.isdigit() and c.isdigit()):
        return None
    return _i(a), _i(b), _i(c)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'trailer-world/1'
    sys_version = ''
    timeout = 300  # idle keep-alive sockets are closed after this

    def setup(self):
        super().setup()
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    def log_message(self, fmt, *args):  # quiet by default
        if LOG:
            sys.stderr.write('[trailer-world] %s %s\n' % (self.address_string(), fmt % args))

    # one write per response (headers+body) -> no Nagle / delayed-ACK stalls
    def _send(self, code, body=b'', ctype='application/octet-stream', extra=None, head=False):
        hdr = [f'HTTP/1.1 {code} {_REASONS.get(code, "OK")}\r\n'.encode('latin-1'), _CORS]
        if code != 204:
            hdr.append(f'Content-Type: {ctype}\r\nContent-Length: {len(body)}\r\n'.encode('latin-1'))
        else:
            hdr.append(b'Content-Length: 0\r\n')
        hdr.append(f'Cache-Control: {CACHE_CONTROL}\r\n'.encode('latin-1'))
        if extra:
            for k, v in extra.items():
                hdr.append(f'{k}: {v}\r\n'.encode('latin-1'))
        if self.close_connection:
            hdr.append(b'Connection: close\r\n')
        else:
            hdr.append(b'Connection: keep-alive\r\n')
        hdr.append(b'\r\n')
        payload = b''.join(hdr)
        if body and not head and code != 204:
            payload += body
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        if LOG:
            self.log_message('"%s" %d %d', self.requestline, code, len(body))

    def _json(self, obj, code=200, extra=None, head=False):
        self._send(code, json.dumps(obj, separators=(',', ':')).encode(), 'application/json', extra, head)

    def _drain_body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 0:
            self.rfile.read(min(n, 1 << 20))

    def do_OPTIONS(self):
        self._drain_body()
        STATS.record('options', None, None, 0, 0.0)
        self._send(204, b'', extra={
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
            'Access-Control-Max-Age': '86400',
            'Access-Control-Allow-Private-Network': 'true',
        })

    def do_HEAD(self):
        self._route(head=True)

    def do_GET(self):
        self._route(head=False)

    def do_POST(self):
        self._drain_body()
        path = urlsplit(self.path).path
        if path == '/__stats/reset':
            STATS.reset()
            return self._json({'ok': True})
        self._send(405, b'method not allowed', 'text/plain')

    def _route(self, head):
        t0 = time.perf_counter()
        sp = urlsplit(self.path)
        path = sp.path
        parts = [p for p in path.split('/') if p]
        kind = 'other'
        try:
            if parts and parts[0] == 'mvt':
                kind = 'mvt'
                t = _match_tile(parts, 'mvt', '.pbf')
                if t is None:
                    body, outcome, z = b'', 'miss', None
                else:
                    z, x, y = t
                    body, outcome = WORLD.mvt(z, x, y)
                self._send(200, body, 'application/vnd.mapbox-vector-tile', None, head)
                return STATS.record(kind, outcome, z, len(body), (time.perf_counter() - t0) * 1e3, path)

            if parts and parts[0] == 'img':
                kind = 'img'
                t = _match_tile(parts, 'img')
                if t is None:
                    body, ctype, outcome, dz, z = WORLD.neutral_jpeg(), 'image/jpeg', 'neutral', None, None
                else:
                    z, y, x = t  # ArcGIS order: /img/{z}/{y}/{x}
                    body, ctype, outcome, dz = WORLD.img(z, x, y)
                self._send(200, body, ctype, None, head)
                return STATS.record(kind, outcome, z, len(body), (time.perf_counter() - t0) * 1e3, path, dz)

            if parts and parts[0] == 'dem':
                kind = 'dem'
                t = _match_tile(parts, 'dem', '.png')
                if t is None:
                    body, ctype, outcome, dz, z = WORLD._flat_dem(dem_size(0)), 'image/png', 'neutral', None, None
                else:
                    z, x, y = t
                    body, ctype, outcome, dz = WORLD.dem(z, x, y)
                self._send(200, body, ctype, None, head)
                return STATS.record(kind, outcome, z, len(body), (time.perf_counter() - t0) * 1e3, path, dz)

            if parts and parts[0] == 'worldcover':
                kind = 'worldcover'
                t = _match_tile(parts, 'worldcover', '.png')
                body = WORLD.worldcover(*t) if t else None
                if body:
                    self._send(200, body, 'image/png', None, head)
                    return STATS.record(kind, 'hit', t[0], len(body), (time.perf_counter() - t0) * 1e3)
                self._send(404, b'no worldcover tile', 'text/plain', None, head)
                return STATS.record(kind, 'miss', t[0] if t else None, 0, (time.perf_counter() - t0) * 1e3, path)

            if path in ('/planet', '/planet.json'):
                kind = 'tilejson'
                port = self.server.server_address[1]
                base = (os.environ.get('TRAILER_WORLD_MVT_BASE', '') or os.environ.get('TRAILER_WORLD_PUBLIC', '')).rstrip('/') \
                    or f'http://127.0.0.1:{port}'
                self._json({
                    'tilejson': '2.2.0',
                    'name': 'trailer-real',
                    'format': 'pbf',
                    'scheme': 'xyz',
                    'minzoom': 0,
                    'maxzoom': 14,
                    'bounds': [-180, -85.0511, 180, 85.0511],
                    'tiles': [f'{base}/mvt/{{z}}/{{x}}/{{y}}.pbf'],
                    'vector_layers': [{'id': i} for i in (
                        'building', 'transportation', 'aeroway', 'water', 'waterway',
                        'landuse', 'landcover', 'park')],
                }, head=head)
                return STATS.record(kind, 'hit', None, 0, (time.perf_counter() - t0) * 1e3)

            if path == '/api/aircraft':
                kind = 'aircraft'
                self._json(WORLD.traffic(), extra={'x-adsb-source': 'trailer-world'}, head=head)
                return STATS.record(kind, 'hit', None, 0, (time.perf_counter() - t0) * 1e3)

            if len(parts) == 4 and parts[0] == 'api' and parts[1] == 'aircraft' and parts[3] in ('info', 'photo', 'route'):
                kind = 'aircraft_info'
                body = WORLD.aircraft_canned(parts[2], parts[3])
                self._send(200, body, 'application/json', None, head)
                return STATS.record(kind, 'hit', None, len(body), (time.perf_counter() - t0) * 1e3)

            if path == '/api/weather':
                kind = 'weather'
                self._json({'found': False}, head=head)
                return STATS.record(kind, 'hit', None, 0, (time.perf_counter() - t0) * 1e3)

            if path == '/__health':
                kind = 'health'
                return self._json({'ok': True, 'rev': REV}, head=head)

            if path == '/__stats/reset':
                STATS.reset()
                return self._json({'ok': True}, head=head)

            if path == '/__stats':
                return self._json(STATS.snapshot(WORLD.lru_info()), head=head)

            if path == '/__spec':
                return self._json({
                    'rev': REV, 'root': ROOT, 'projection': 'EPSG:3857 / XYZ',
                    'imagery': {'path': '/img/{z}/{y}/{x}', 'note': 'ArcGIS z/y/x order in the URL; stored XYZ at img/{z}/{x}/{y}.jpg',
                                'size': 256, 'missing': 'nearest-ancestor crop (bicubic) else neutral fallback_rgb'},
                    'dem': {'path': '/dem/{z}/{x}/{y}.png', 'encoding': 'mapbox terrain-rgb: h = -10000 + (R<<16|G<<8|B)*0.1, alpha 255',
                            'missing': 'nearest-ancestor bilinear, edge-inclusive, N=min(64,(z+2)*3); else flat 0 m'},
                    'mvt': {'path': '/mvt/{z}/{x}/{y}.pbf', 'missing': 'zero-length 200 (never 404)'},
                    'worldcover': {'path': '/worldcover/{z}/{x}/{y}.png', 'missing': '404'},
                    'tileToLonLat': 'lon = x/2^z*360-180 ; lat = atan(sinh(PI-2*PI*y/2^z))*180/PI',
                }, head=head)

            self._send(404, b'not found', 'text/plain', None, head)
            return STATS.record('other', 'miss', None, 0, (time.perf_counter() - t0) * 1e3, path)
        except Exception as e:  # never kill the connection thread on a bad tile
            sys.stderr.write(f'[trailer-world] ERROR {path}: {e!r}\n')
            STATS.record(kind, 'errors', None, 0, (time.perf_counter() - t0) * 1e3, path)
            # Tile routes must still answer 200 with something usable.
            try:
                if kind == 'mvt':
                    return self._send(200, b'', 'application/vnd.mapbox-vector-tile', None, head)
                if kind == 'img':
                    return self._send(200, WORLD.neutral_jpeg(), 'image/jpeg', None, head)
                if kind == 'dem':
                    t = _match_tile(parts, 'dem', '.png')
                    return self._send(200, WORLD._flat_dem(dem_size(t[0] if t else 0)), 'image/png', None, head)
                return self._send(500, str(e).encode(), 'text/plain', None, head)
            except Exception:
                self.close_connection = True


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 512  # the default 5 drops SYNs under a 200-request burst

    def handle_error(self, request, client_address):
        # A client dropping a socket mid-response is routine (aborted tile
        # fetches, page reloads); keep the log quiet unless asked.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, TimeoutError, socket.timeout)) and not LOG:
            return
        super().handle_error(request, client_address)


def main():
    srv = Server((HOST, PORT), Handler)
    # Optional extra listeners on the same world (Chrome keeps ~6 HTTP/1.1
    # sockets per host:port; pointing img / dem / mvt at different ports gives
    # each its own pool — see pin.cjs worldPin opts imgBase/demBase and
    # TRAILER_WORLD_MVT_BASE).
    extra = []
    for p in filter(None, (s.strip() for s in os.environ.get('TRAILER_WORLD_EXTRA_PORTS', '').split(','))):
        e = Server((HOST, int(p)), Handler)
        threading.Thread(target=e.serve_forever, kwargs={'poll_interval': 0.5}, daemon=True).start()
        extra.append(e)
    ports = [srv.server_address[1]] + [e.server_address[1] for e in extra]
    sys.stderr.write(f'[trailer-world] {REV} listening on {HOST} ports {ports} root={ROOT}\n')
    sys.stderr.flush()
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        for e in extra:
            e.shutdown()
            e.server_close()


if __name__ == '__main__':
    main()

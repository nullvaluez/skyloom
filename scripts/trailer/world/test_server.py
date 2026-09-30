#!/usr/bin/env python3
"""Browser-free validation of scripts/trailer/world/server.py.

Builds a small synthetic data root (known colours / a linear DEM ramp / a
fixture-generated MVT / a gzipped MVT / WorldCover / traffic.json), starts the
server on a private port against it, and checks every route, CORS, the
zero-length MVT contract, the imagery + DEM ancestor fallbacks (decoded and
checked numerically), keep-alive, a 200-request burst and latency.

    python3 scripts/trailer/world/test_server.py            # temp root, port 3391
    TEST_ROOT=/some/dir TEST_PORT=3392 python3 .../test_server.py

Also (optional) --live http://127.0.0.1:3301 runs read-only smoke checks
against an already-running server (whatever tiles exist).
"""
import http.client
import io
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import gzip
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FAILS = []


def gate(name, ok, detail=''):
    print(f"{'PASS' if ok else 'FAIL'} {name}{(' — ' + str(detail)) if detail != '' else ''}")
    if not ok:
        FAILS.append(name)


def lon2x(lon, z):
    return int((lon + 180) / 360 * 2 ** z)


def lat2y(lat, z):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z)


def get(conn_or_port, path, method='GET', headers=None):
    if isinstance(conn_or_port, int):
        c = http.client.HTTPConnection('127.0.0.1', conn_or_port, timeout=20)
        own = True
    else:
        c = conn_or_port
        own = False
    c.request(method, path, headers=headers or {})
    r = c.getresponse()
    body = r.read()
    hdr = {k.lower(): v for k, v in r.getheaders()}
    if own:
        c.close()
    return r.status, hdr, body


def terrain_png(h):
    v = np.clip(np.rint((h + 10000) * 10), 0, 0xFFFFFF).astype(np.uint32)
    a = np.zeros(h.shape + (4,), np.uint8)
    a[..., 0] = v >> 16
    a[..., 1] = (v >> 8) & 255
    a[..., 2] = v & 255
    a[..., 3] = 255
    bio = io.BytesIO()
    Image.fromarray(a, 'RGBA').save(bio, 'PNG')
    return bio.getvalue()


def decode_heights(body):
    im = Image.open(io.BytesIO(body))
    a = np.asarray(im.convert('RGBA'), np.uint32)
    return -10000 + ((a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]) * 0.1, im


def png_chunks(b):
    out, i = [], 8
    while i < len(b):
        n = int.from_bytes(b[i:i + 4], 'big')
        out.append(b[i + 4:i + 8].decode())
        i += 12 + n
    return out


QUAD = {(0, 0): (200, 40, 40), (1, 0): (40, 200, 40), (0, 1): (40, 40, 200), (1, 1): (220, 200, 30)}


def build_root(root):
    # --- imagery: z10 NYC tile with four solid quadrants; one real z12 tile
    z, x, y = 10, lon2x(-73.985, 10), lat2y(40.72, 10)
    im = Image.new('RGB', (256, 256))
    for (qx, qy), c in QUAD.items():
        im.paste(c, (qx * 128, qy * 128, qx * 128 + 128, qy * 128 + 128))
    os.makedirs(f'{root}/img/{z}/{x}', exist_ok=True)
    im.save(f'{root}/img/{z}/{x}/{y}.jpg', quality=95)
    real12 = (12, x * 4 + 3, y * 4 + 3)
    os.makedirs(f'{root}/img/12/{real12[1]}', exist_ok=True)
    Image.new('RGB', (256, 256), (7, 77, 177)).save(f'{root}/img/12/{real12[1]}/{real12[2]}.jpg', quality=95)
    # --- DEM: linear ramp over the z10 tile, edge-inclusive, N0 = 36
    N0 = 36
    k = np.arange(N0) / (N0 - 1)
    U, V = np.meshgrid(k, k)
    H = 100.0 + 1000.0 * U + 500.0 * V
    os.makedirs(f'{root}/dem/{z}/{x}', exist_ok=True)
    with open(f'{root}/dem/{z}/{x}/{y}.png', 'wb') as f:
        f.write(terrain_png(H))
    # --- MVT: a fixture-generated z14 Manhattan tile, raw and gzipped
    mz = 14
    mx, my = lon2x(-73.984, mz), lat2y(40.7549, mz)
    os.makedirs(f'{root}/mvt/{mz}/{mx}', exist_ok=True)
    js = ("import {mvtTile} from '%s/scripts/r24-fixture/mvt.mjs';"
          "process.stdout.write(Buffer.from(mvtTile(%d,%d,%d)).toString('base64'));" % (REPO, mz, mx, my))
    b64 = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, check=True).stdout
    import base64
    mvt = base64.b64decode(b64)
    with open(f'{root}/mvt/{mz}/{mx}/{my}.pbf', 'wb') as f:
        f.write(mvt)
    os.makedirs(f'{root}/mvt/{mz}/{mx + 1}', exist_ok=True)
    with open(f'{root}/mvt/{mz}/{mx + 1}/{my}.pbf', 'wb') as f:
        f.write(gzip.compress(mvt))
    # --- WorldCover: one legend-exact tile
    wz, wx, wy = 12, lon2x(-73.985, 12), lat2y(40.72, 12)
    os.makedirs(f'{root}/worldcover/{wz}/{wx}', exist_ok=True)
    Image.new('RGBA', (256, 256), (0, 100, 200, 255)).save(f'{root}/worldcover/{wz}/{wx}/{wy}.png')
    return dict(z10=(z, x, y), real12=real12, mvt=(mz, mx, my), mvt_bytes=mvt, wc=(wz, wx, wy), H=H)


def main():
    live = None
    if '--live' in sys.argv:
        live = sys.argv[sys.argv.index('--live') + 1]
    if live:
        return live_smoke(live)

    port = int(os.environ.get('TEST_PORT', '3391'))
    tmp = os.environ.get('TEST_ROOT') or tempfile.mkdtemp(prefix='trailer-world-test-')
    info = build_root(tmp)
    env = {k: v for k, v in os.environ.items() if not k.startswith('TRAILER_WORLD_')}
    env.update(TRAILER_WORLD_PORT=str(port), TRAILER_WORLD_ROOT=tmp, TRAILER_WORLD_LOG='0')
    proc = subprocess.Popen([sys.executable, '-u', os.path.join(HERE, 'server.py')], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        up = False
        for _ in range(100):
            try:
                s, _, b = get(port, '/__health')
                if s == 200:
                    up = True
                    break
            except OSError:
                time.sleep(0.1)
        if not up:
            proc.terminate()
            print(proc.stdout.read().decode(errors='replace'))
            gate('server started', False)
        else:
            run_checks(port, tmp, info)
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except Exception:
            proc.kill()
        if not os.environ.get('TEST_ROOT') and not os.environ.get('KEEP_ROOT'):
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\nRESULT: {'PASS' if not FAILS else 'FAIL'} ({len(FAILS)} failed{': ' + ', '.join(FAILS) if FAILS else ''})")
    sys.exit(1 if FAILS else 0)


def cors_ok(h):
    return h.get('access-control-allow-origin') == '*' and h.get('access-control-allow-headers') == '*'


def run_checks(port, root, info):
    # ---------------- health / stats / spec / tilejson
    s, h, b = get(port, '/__health')
    j = json.loads(b)
    gate('health', s == 200 and j == {'ok': True, 'rev': 'trailer-real-1'} and cors_ok(h), b.decode())
    s, h, b = get(port, '/planet')
    tj = json.loads(b)
    gate('tilejson /planet', s == 200 and tj['tiles'] == [f'http://127.0.0.1:{port}/mvt/{{z}}/{{x}}/{{y}}.pbf']
         and tj['minzoom'] == 0 and tj['maxzoom'] == 14 and cors_ok(h), tj['tiles'][0])
    s, h, b = get(port, '/planet.json')
    gate('tilejson /planet.json', s == 200 and json.loads(b)['tiles'] == tj['tiles'])

    # ---------------- MVT
    mz, mx, my = info['mvt']
    s, h, b = get(port, f'/mvt/{mz}/{mx}/{my}.pbf')
    gate('mvt hit bytes identical', s == 200 and b == info['mvt_bytes'] and h.get('content-type') == 'application/vnd.mapbox-vector-tile'
         and 'content-encoding' not in h and cors_ok(h), f'{len(b)} B')
    s, h, b = get(port, f'/mvt/{mz}/{mx + 1}/{my}.pbf')
    gate('mvt gzip-on-disk served raw (unwrapped, no content-encoding)', s == 200 and b == info['mvt_bytes'] and 'content-encoding' not in h, f'{len(b)} B')
    s, h, b = get(port, f'/mvt/{mz}/{mx + 5}/{my + 5}.pbf')
    gate('mvt miss = zero-length 200', s == 200 and b == b'' and h.get('content-length') == '0'
         and h.get('content-type') == 'application/vnd.mapbox-vector-tile' and cors_ok(h))
    for p in ('/mvt/9/1/2.pbf', '/mvt/14/999999/1.pbf', '/mvt/30/1/1.pbf', '/mvt/abc.pbf', '/mvt/1/2/x.pbf'):
        s, h, b = get(port, p)
        gate(f'mvt never 404 ({p})', s == 200 and b == b'')

    # ---------------- imagery
    z, x, y = info['z10']
    s, h, b = get(port, f'/img/{z}/{y}/{x}')
    with open(f'{root}/img/{z}/{x}/{y}.jpg', 'rb') as f:
        gate('img hit (z/y/x URL -> XYZ file) byte-identical', s == 200 and b == f.read() and h.get('content-type') == 'image/jpeg' and cors_ok(h))
    for (qx, qy), c in QUAD.items():
        cz, cx, cy = z + 1, 2 * x + qx, 2 * y + qy
        s, h, b = get(port, f'/img/{cz}/{cy}/{cx}')
        im = Image.open(io.BytesIO(b))
        a = np.asarray(im.convert('RGB'), float)
        ctr = a[64:192, 64:192].reshape(-1, 3).mean(0)
        gate(f'img fallback z11 quadrant ({qx},{qy}) colour', s == 200 and im.size == (256, 256) and im.mode == 'RGB'
             and np.abs(ctr - np.array(c)).max() < 12, f'centre {ctr.round(1).tolist()} vs {c}')
    # deep descendant inside TL quadrant at z16 (6 levels up)
    dz16 = (16, x * 64 + 10, y * 64 + 10)
    s, h, b = get(port, f'/img/{dz16[0]}/{dz16[2]}/{dz16[1]}')
    a = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), float)
    gate('img fallback z16 (dz=6) solid TL colour, 256px opaque', s == 200 and a.shape == (256, 256, 3)
         and np.abs(a.reshape(-1, 3).mean(0) - np.array(QUAD[(0, 0)])).max() < 12, a.reshape(-1, 3).mean(0).round(1).tolist())
    # descendant of the real z12 tile must use the z12 ancestor, not the z10
    rz, rx, ry = info['real12']
    s, h, b = get(port, f'/img/{rz + 2}/{ry * 4 + 1}/{rx * 4 + 2}')
    a = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), float).reshape(-1, 3).mean(0)
    gate('img fallback picks NEAREST ancestor (z12 over z10)', np.abs(a - np.array((7, 77, 177))).max() < 12, a.round(1).tolist())
    # neutral: no ancestor (southern ocean), default colour
    s, h, b = get(port, '/img/3/7/0')
    a = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), float).reshape(-1, 3).mean(0)
    gate('img neutral default #23384a when no ancestor', s == 200 and np.abs(a - np.array((0x23, 0x38, 0x4a))).max() < 4, a.round(1).tolist())
    # manifest fallback_rgb honoured (picked up live via mtime)
    with open(f'{root}/img/manifest.json', 'w') as f:
        json.dump({'fallback_rgb': [90, 110, 60]}, f)
    s, h, b = get(port, '/img/3/7/1')
    a = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), float).reshape(-1, 3).mean(0)
    gate('img neutral uses manifest fallback_rgb', np.abs(a - np.array((90, 110, 60))).max() < 4, a.round(1).tolist())
    # seam continuity between two synthesized siblings straddling the quadrant edge? (inside TL) — adjacent z13 tiles
    t1 = (13, x * 8 + 1, y * 8 + 1)
    t2 = (13, x * 8 + 2, y * 8 + 1)
    s1, _, b1 = get(port, f'/img/{t1[0]}/{t1[2]}/{t1[1]}')
    s2, _, b2 = get(port, f'/img/{t2[0]}/{t2[2]}/{t2[1]}')
    gate('img fallback siblings both 200 256x256', s1 == s2 == 200 and Image.open(io.BytesIO(b1)).size == Image.open(io.BytesIO(b2)).size == (256, 256))
    # a tile that lands on disk LATER wins over the cached fallback
    lz, lx, ly = z + 1, 2 * x, 2 * y
    os.makedirs(f'{root}/img/{lz}/{lx}', exist_ok=True)
    Image.new('RGB', (256, 256), (250, 250, 250)).save(f'{root}/img/{lz}/{lx}/{ly}.jpg.tmp', 'JPEG', quality=95)
    os.replace(f'{root}/img/{lz}/{lx}/{ly}.jpg.tmp', f'{root}/img/{lz}/{lx}/{ly}.jpg')
    s, h, b = get(port, f'/img/{lz}/{ly}/{lx}')
    a = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), float).reshape(-1, 3).mean(0)
    gate('img: late-arriving real tile beats cached fallback', a.min() > 240, a.round(1).tolist())
    s, h, b = get(port, f'/img/{lz + 1}/{2 * ly}/{2 * lx}')
    a = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), float).reshape(-1, 3).mean(0)
    gate('img: its descendants now derive from it', a.min() > 240, a.round(1).tolist())
    s, h, b = get(port, '/img/10/abc/1')
    gate('img malformed path still opaque 200', s == 200 and Image.open(io.BytesIO(b)).size == (256, 256))

    # ---------------- DEM
    s, h, b = get(port, f'/dem/{z}/{x}/{y}.png')
    with open(f'{root}/dem/{z}/{x}/{y}.png', 'rb') as f:
        gate('dem hit byte-identical', s == 200 and b == f.read() and h.get('content-type') == 'image/png' and cors_ok(h))
    H0 = info['H']

    def expected(zc, xc, yc, n):
        d = zc - z
        k = np.arange(n) / (n - 1)
        u = ((xc - (x << d)) + k) / 2 ** d
        v = ((yc - (y << d)) + k) / 2 ** d
        U, V = np.meshgrid(u, v)
        return 100 + 1000 * U + 500 * V

    worst = 0.0
    ok_sizes = True
    for zc in (11, 12, 14, 16, 18):
        d = zc - z
        for (ox, oy) in ((0, 0), ((1 << d) - 1, (1 << d) - 1), ((1 << d) // 3, (1 << d) // 2)):
            xc, yc = (x << d) + ox, (y << d) + oy
            s, h, b = get(port, f'/dem/{zc}/{xc}/{yc}.png')
            hh, im = decode_heights(b)
            n = min(64, (zc + 2) * 3)
            ok_sizes &= (s == 200 and im.size == (n, n) and im.mode == 'RGBA' and np.asarray(im)[..., 3].min() == 255)
            worst = max(worst, float(np.abs(hh - expected(zc, xc, yc, n)).max()))
            ch = png_chunks(b)
            ok_sizes &= not any(c in ch for c in ('gAMA', 'sRGB', 'iCCP', 'cHRM'))
    gate('dem fallback sizes N=min(64,(z+2)*3), RGBA A=255, no colour chunks', ok_sizes)
    gate('dem fallback bilinear edge-inclusive exact on a linear ramp (<= 0.1 m quantum)', worst <= 0.1001, f'max err {worst:.4f} m')
    # siblings share their edge; parent/child agree at the child's corners
    d = 4
    xa, ya = (x << d) + 5, (y << d) + 7
    _, _, ba = get(port, f'/dem/{z + d}/{xa}/{ya}.png')
    _, _, bb = get(port, f'/dem/{z + d}/{xa + 1}/{ya}.png')
    _, _, bc = get(port, f'/dem/{z + d}/{xa}/{ya + 1}.png')
    ha, _ = decode_heights(ba)
    hb, _ = decode_heights(bb)
    hc, _ = decode_heights(bc)
    seam = max(np.abs(ha[:, -1] - hb[:, 0]).max(), np.abs(ha[-1, :] - hc[0, :]).max())
    gate('dem fallback sibling seams identical (E/W and N/S)', seam <= 0.1001, f'max seam {seam:.4f} m')
    # no ancestor -> flat 0 m at size N
    s, h, b = get(port, '/dem/13/100/7000.png')
    hh, im = decode_heights(b)
    gate('dem no-ancestor = flat 0 m, N=45', s == 200 and im.size == (45, 45) and np.abs(hh).max() < 0.05, f'{im.size} max|h|={np.abs(hh).max():.3f}')
    s, h, b = get(port, '/dem/0/0/0.png')
    hh, im = decode_heights(b)
    gate('dem z0 missing -> flat N=6', s == 200 and im.size == (6, 6))

    # ---------------- WorldCover
    wz, wx, wy = info['wc']
    s, h, b = get(port, f'/worldcover/{wz}/{wx}/{wy}.png')
    gate('worldcover hit image/png', s == 200 and h.get('content-type') == 'image/png' and Image.open(io.BytesIO(b)).size == (256, 256) and cors_ok(h))
    s, h, b = get(port, f'/worldcover/{wz}/{wx + 1}/{wy}.png')
    gate('worldcover miss = 404 (with CORS)', s == 404 and cors_ok(h))

    # ---------------- API
    s, h, b = get(port, '/api/aircraft?lat=40.70&lon=-74.00&dist=100')
    j = json.loads(b)
    gate('aircraft default envelope', s == 200 and j['ac'] == [] and j['total'] == 0 and j['msg'] == 'No error'
         and abs(j['now'] - time.time()) < 5 and isinstance(j['ctime'], int) and h.get('x-adsb-source') == 'trailer-world' and cors_ok(h))
    with open(f'{root}/traffic.json', 'w') as f:
        json.dump({'now': 1, 'messages': 5, 'total': 99, 'ctime': 0, 'ptime': 1, 'msg': 'No error',
                   'ac': [{'hex': 'abc123', 'lat': 40.7, 'lon': -74.0, 'alt_baro': 3000, 'gs': 250, 'track': 90, 't': 'F16'}]}, f)
    s, h, b = get(port, '/api/aircraft?lat=40.70&lon=-74.00&dist=100')
    j1 = json.loads(b)
    time.sleep(0.02)
    s2, h2, b2 = get(port, '/api/aircraft?lat=40.70&lon=-74.00&dist=100')
    j2 = json.loads(b2)
    gate('aircraft traffic.json served, now fresh+advancing, total recomputed',
         s == 200 and len(j1['ac']) == 1 and j1['ac'][0]['hex'] == 'abc123' and j1['total'] == 1
         and abs(j1['now'] - time.time()) < 5 and j2['now'] > j1['now'], f"now {j1['now']:.3f} -> {j2['now']:.3f}")
    with open(f'{root}/traffic.json', 'w') as f:
        json.dump([{'hex': 'def456', 'lat': 1, 'lon': 2}], f)
    os.utime(f'{root}/traffic.json', ns=(time.time_ns() + 10**9, time.time_ns() + 10**9))
    s, h, b = get(port, '/api/aircraft?lat=1&lon=2&dist=5')
    j = json.loads(b)
    gate('aircraft bare-list traffic.json wrapped', j['ac'][0]['hex'] == 'def456' and j['total'] == 1 and 'now' in j)
    s, h, b = get(port, '/api/weather?lat=1&lon=2')
    gate('weather {found:false}', s == 200 and json.loads(b) == {'found': False} and cors_ok(h))
    s, h, b = get(port, '/api/aircraft/abc123/info')
    s2, _, b2 = get(port, '/api/aircraft/abc123/photo?reg=N1')
    s3, _, b3 = get(port, '/api/aircraft/abc123/route?callsign=X')
    gate('aircraft info/photo/route canned misses', (s, s2, s3) == (200, 200, 200) and json.loads(b) == {'found': False}
         and json.loads(b2) == {'photos': []} and json.loads(b3) is None)

    # ---------------- CORS preflight, HEAD, 404
    s, h, b = get(port, '/img/10/1/1', method='OPTIONS', headers={'Origin': 'http://localhost:3000',
                                                                 'Access-Control-Request-Method': 'GET',
                                                                 'Access-Control-Request-Headers': 'x-foo'})
    gate('OPTIONS preflight 204 + CORS', s == 204 and b == b'' and cors_ok(h) and 'GET' in h.get('access-control-allow-methods', ''))
    s, h, b = get(port, f'/img/{z}/{y}/{x}', method='HEAD')
    gate('HEAD: headers only, correct content-length', s == 200 and b == b'' and int(h['content-length']) > 1000)
    s, h, b = get(port, '/nope')
    gate('unknown route 404 with CORS', s == 404 and cors_ok(h))

    # ---------------- keep-alive: 50 requests on ONE connection
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    ok = True
    for i in range(50):
        p = [f'/img/{z}/{y}/{x}', f'/mvt/{mz}/{mx}/{my}.pbf', f'/mvt/14/{i}/{i}.pbf', f'/dem/12/{x * 4}/{y * 4 + (i % 4)}.png', '/__health'][i % 5]
        s, h, b = get(c, p)
        ok &= s == 200 and int(h.get('content-length', -1)) == len(b)
    sock_reused = c.sock is not None
    c.close()
    gate('keep-alive: 50 sequential requests on one connection, content-length exact', ok and sock_reused)

    # ---------------- stats + reset
    s, h, b = get(port, '/__stats')
    st = json.loads(b)
    bk = st['byKind']
    gate('stats has per-kind hit/miss/fallback counters', bk['mvt']['miss'] >= 6 and bk['img']['fallback'] >= 5
         and bk['dem']['fallback'] >= 10 and bk['img']['neutral'] >= 2, json.dumps({k: {kk: v[kk] for kk in ('count', 'hit', 'miss', 'fallback', 'fallbackCached', 'neutral')} for k, v in bk.items()}))
    s, h, b = get(port, '/__stats/reset', method='POST')
    s2, h2, b2 = get(port, '/__stats')
    gate('POST /__stats/reset zeroes', s == 200 and json.loads(b2)['total'] == 0)
    get(port, '/__stats/reset')

    # ---------------- burst: 200 parallel requests (mixed; fresh fallbacks included)
    paths = []
    for i in range(200):
        r = i % 8
        if r == 0:
            paths.append(f'/img/{z}/{y}/{x}')
        elif r == 1:
            paths.append(f'/img/15/{(y << 5) + (i % 32)}/{(x << 5) + (i // 8)}')   # fresh fallbacks
        elif r == 2:
            paths.append(f'/dem/15/{(x << 5) + (i // 8)}/{(y << 5) + (i % 32)}.png')  # fresh fallbacks
        elif r == 3:
            paths.append(f'/mvt/{mz}/{mx}/{my}.pbf')
        elif r == 4:
            paths.append(f'/mvt/14/{mx + i}/{my}.pbf')
        elif r == 5:
            paths.append(f'/img/16/{(y << 6) + 3}/{(x << 6) + 3}')  # same key -> single-flight
        elif r == 6:
            paths.append(f'/worldcover/{wz}/{wx}/{wy}.png')
        else:
            paths.append('/api/aircraft?lat=40.7&lon=-74&dist=100')
    lat = []
    errs = []

    def one(p):
        t0 = time.perf_counter()
        try:
            s, h, b = get(port, p)
            dt = (time.perf_counter() - t0) * 1e3
            if s != 200 or int(h.get('content-length', -1)) != len(b):
                errs.append((p, s))
            return dt
        except Exception as e:
            errs.append((p, repr(e)))
            return None

    barrier_t0 = time.perf_counter()
    with ThreadPoolExecutor(200) as ex:
        res = list(ex.map(one, paths))
    wall = (time.perf_counter() - barrier_t0) * 1e3
    lat = sorted(r for r in res if r is not None)
    p50 = statistics.median(lat)
    p95 = lat[int(len(lat) * 0.95) - 1]
    gate('burst: 200 parallel requests all 200 with exact content-length', not errs and len(lat) == 200,
         f'wall {wall:.0f} ms, p50 {p50:.1f} ms, p95 {p95:.1f} ms, max {lat[-1]:.1f} ms, errors {errs[:3]}')
    s, h, b = get(port, '/__stats')
    st = json.loads(b)
    gate('burst: single-flight — the 25 identical z16 requests built once', st['byKind']['img'].get('fallback', 0) <= 25 + 1,
         f"img fallback {st['byKind']['img'].get('fallback')} cached {st['byKind']['img'].get('fallbackCached')}")

    # ---------------- steady-state latency on keep-alive (hits / cached fallbacks / misses)
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    res = {}
    for name, p in (('img hit', f'/img/{z}/{y}/{x}'), ('img fallback cached', f'/img/16/{(y << 6) + 3}/{(x << 6) + 3}'),
                    ('dem fallback cached', f'/dem/15/{(x << 5)}/{(y << 5)}.png'), ('mvt hit', f'/mvt/{mz}/{mx}/{my}.pbf'),
                    ('mvt miss', '/mvt/14/1/1.pbf')):
        ts = []
        for _ in range(200):
            t0 = time.perf_counter()
            get(c, p)
            ts.append((time.perf_counter() - t0) * 1e3)
        ts.sort()
        res[name] = (round(statistics.median(ts), 3), round(ts[189], 3))
    c.close()
    # uncached fallback cost
    t0 = time.perf_counter()
    get(port, f'/img/16/{(y << 6) + 40}/{(x << 6) + 41}')
    res['img fallback uncached (1st)'] = round((time.perf_counter() - t0) * 1e3, 2)
    t0 = time.perf_counter()
    get(port, f'/dem/16/{(x << 6) + 40}/{(y << 6) + 41}.png')
    res['dem fallback uncached (1st)'] = round((time.perf_counter() - t0) * 1e3, 2)
    gate('latency (p50, p95 ms on keep-alive)', all(v[1] < 20 for v in res.values() if isinstance(v, tuple)), json.dumps(res))


def live_smoke(base):
    """Read-only checks against a running server (real data root)."""
    port = int(base.rsplit(':', 1)[1].split('/')[0])
    s, h, b = get(port, '/__health')
    gate('live health', s == 200 and json.loads(b).get('rev') == 'trailer-real-1', b.decode())
    s, h, b = get(port, '/__stats')
    st = json.loads(b)
    root = st['root']
    print('root', root)
    for kind, ext in (('img', '.jpg'), ('dem', '.png'), ('mvt', '.pbf'), ('worldcover', '.png')):
        d = os.path.join(root, kind)
        zs = sorted(int(z) for z in os.listdir(d) if z.isdigit()) if os.path.isdir(d) else []
        print(f'  {kind}: zooms {zs}')
        for zz in zs[-2:]:
            zd = os.path.join(d, str(zz))
            xs = sorted(os.listdir(zd))
            if not xs:
                continue
            xx = xs[len(xs) // 2]
            ys = sorted(f for f in os.listdir(os.path.join(zd, xx)) if f.endswith(ext))
            if not ys:
                continue
            yy = ys[len(ys) // 2][:-len(ext)]
            p = f'/img/{zz}/{yy}/{xx}' if kind == 'img' else f'/{kind}/{zz}/{xx}/{yy}{ext}'
            s, h, b = get(port, p)
            with open(os.path.join(zd, xx, yy + ext), 'rb') as f:
                raw = f.read()
            same = b == raw or (kind == 'mvt' and raw[:2] == b'\x1f\x8b' and b == gzip.decompress(raw))
            gate(f'live {kind} z{zz} {xx}/{yy} served from disk', s == 200 and same and cors_ok(h), f'{len(b)} B')
            if kind in ('img', 'dem'):
                # a child two levels deeper, synthesized if missing
                cz = zz + 2
                cx, cy = int(xx) * 4 + 1, int(yy) * 4 + 2
                p = f'/img/{cz}/{cy}/{cx}' if kind == 'img' else f'/dem/{cz}/{cx}/{cy}.png'
                s, h, b = get(port, p)
                im = Image.open(io.BytesIO(b))
                exp = (256, 256) if kind == 'img' else None
                gate(f'live {kind} child z{cz} served', s == 200 and (exp is None or im.size == exp), f'{im.size} {im.mode}')
    print(f"\nRESULT: {'PASS' if not FAILS else 'FAIL'} ({len(FAILS)} failed)")
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()

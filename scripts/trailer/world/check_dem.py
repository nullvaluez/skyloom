#!/usr/bin/env python3
"""Validate the trailer DEM tiles (build_dem.py output).

  1. PNG audit: every tile is RGBA8, square, width == min(64,(z+2)*3), chunks
     exactly IHDR/IDAT/IEND (no gAMA/sRGB/iCCP/cHRM), alpha 255 everywhere,
     decoded height >= 0 (bathymetry clamp).
  2. Seams: for every built tile set, the east column of tile x equals the
     west column of tile x+1 and the south row of y equals the north row of
     y+1, byte for byte.
  3. Known points (bilinear over the tile grid, i.e. what the mesh shows).
  4. Hillshade previews: $WORLD/previews/dem-<loc>.png (far ring z10 | core z14).

usage: nice -n 15 python3 check_dem.py [--locs nyc] [--skip-audit]
"""
import argparse, collections, json, math, os, sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wcommon as C  # noqa: E402
import build_dem as B  # noqa: E402

KNOWN = [
    # name, lat, lon, expected (m), tolerance (m)
    ('Jungfrau summit', 46.5368, 7.9626, 4158, 200),
    ('Eiger summit', 46.5776, 8.0053, 3967, 150),
    ('Lauterbrunnen valley floor', 46.5935, 7.9091, 800, 120),
    ('Sugarloaf summit', -22.9486, -43.1566, 396, 80),
    ('Corcovado summit', -22.9519, -43.2105, 710, 80),
    ('Guanabara Bay water', -22.8600, -43.1700, 0, 0.05),
    ('Manhattan, Empire State', 40.7484, -73.9857, 18, 15),
    ('Manhattan, Central Park', 40.7812, -73.9665, 30, 20),
    ('NY Harbor water', 40.6700, -74.0400, 0, 0.05),
    ('Hudson River water', 40.7600, -74.0080, 0, 0.05),
    ('Burj Khalifa ground', 25.1972, 55.2744, 8, 15),
    ('Persian Gulf water', 25.1500, 55.0500, 0, 0.05),
    ('Sydney Opera House', -33.8568, 151.2153, 5, 15),
    ('Port Jackson water', -33.8500, 151.2400, 0, 0.05),
    ('Eiffel Tower ground', 48.8584, 2.2945, 33, 15),
    ('Montmartre', 48.8867, 2.3431, 128, 25),
    ('Big Ben ground', 51.5007, -0.1246, 5, 10),
]


def tile_heights(z, x, y, cache={}):
    k = (z, x, y)
    if k not in cache:
        p = B.out_path(z, x, y)
        cache[k] = B.decode_terrain_rgb_png(p) if os.path.exists(p) else None
    return cache[k]


def height_at(lat, lon, z):
    n = 1 << z
    fx, fy = C.lon2x(lon, z), C.lat2y(lat, z)
    x, y = int(fx), int(fy)
    g = tile_heights(z, x, y)
    if g is None:
        return None
    N = g.shape[0]
    u, v = (fx - x) * (N - 1), (fy - y) * (N - 1)
    i0, j0 = min(int(u), N - 2), min(int(v), N - 2)
    wu, wv = u - i0, v - j0
    return (g[j0, i0] * (1 - wu) * (1 - wv) + g[j0, i0 + 1] * wu * (1 - wv) +
            g[j0 + 1, i0] * (1 - wu) * wv + g[j0 + 1, i0 + 1] * wu * wv)


def audit(sets):
    stats = collections.Counter()
    bad = []
    seen = set()
    for label, z, r in sets:
        N = B.dem_n(z)
        for x, y in C.range_tiles(r):
            if (z, x, y) in seen:
                continue
            seen.add((z, x, y))
            p = B.out_path(z, x, y)
            if not os.path.exists(p):
                stats['absent'] += 1
                bad.append(('absent', p))
                continue
            buf = open(p, 'rb').read()
            ch = [t for t, _ in C.png_chunks(buf)]
            if [c for c in ch if c != 'IDAT'] != ['IHDR', 'IEND'] or ch[0] != 'IHDR':
                bad.append(('chunks %s' % ch, p))
            w, h = int.from_bytes(buf[16:20], 'big'), int.from_bytes(buf[20:24], 'big')
            depth, ctype, interlace = buf[24], buf[25], buf[28]
            if (w, h, depth, ctype, interlace) != (N, N, 8, 6, 0):
                bad.append(('ihdr %s' % ((w, h, depth, ctype, interlace),), p))
            a = np.asarray(Image.open(p))
            if a.shape != (N, N, 4) or (a[:, :, 3] != 255).any():
                bad.append(('alpha/shape', p))
            v = (a[:, :, 0].astype(np.int64) << 16) | (a[:, :, 1].astype(np.int64) << 8) | a[:, :, 2]
            if v.min() < 100000:
                bad.append(('negative height', p))
            hh = -10000.0 + v * 0.1
            stats['max_h_dm'] = max(stats['max_h_dm'], int(round(hh.max() * 10)))
            if z >= 11:  # vertex outliers vs the 3x3 median of their neighbours (informational)
                from scipy import ndimage as ndi
                dd = (hh - ndi.median_filter(hh, size=3, mode='nearest'))[1:-1, 1:-1]
                stats['z11plus_max_up_vs_med3_dm'] = max(stats['z11plus_max_up_vs_med3_dm'], int(round(dd.max() * 10)))
                stats['z11plus_max_down_vs_med3_dm'] = max(stats['z11plus_max_down_vs_med3_dm'], int(round(-dd.min() * 10)))
            stats['tiles'] += 1
            stats['bytes'] += len(buf)
    return stats, bad


def seams(sets):
    res = collections.Counter()
    worst = []
    for label, z, r in sets:
        x0, x1, y0, y1 = r
        for x, y in C.range_tiles(r):
            g = tile_heights(z, x, y)
            if g is None:
                continue
            if x < x1:
                e = tile_heights(z, x + 1, y)
                d = np.abs(g[:, -1] - e[:, 0]).max()
                res['ew_pairs'] += 1
                res['ew_mismatch'] += int(d > 0)
                if d > 0:
                    worst.append((d, z, x, y, 'E'))
            if y < y1:
                s = tile_heights(z, x, y + 1)
                d = np.abs(g[-1, :] - s[0, :]).max()
                res['ns_pairs'] += 1
                res['ns_mismatch'] += int(d > 0)
                if d > 0:
                    worst.append((d, z, x, y, 'S'))
        tile_heights.__defaults__[0].clear()
    return res, sorted(worst, reverse=True)[:5]


def lod_step(sets):
    """Child corner vertices vs the parent's bilinear surface (informational)."""
    diffs = []
    for label, z, r in sets:
        if z < 6:
            continue
        for x, y in list(C.range_tiles(r))[::37]:
            g = tile_heights(z, x, y)
            if g is None:
                continue
            for (cx, cy, hv) in ((0, 0, g[0, 0]), (1, 1, g[-1, -1])):
                lat, lon = C.y2lat(y + cy, z), C.x2lon(x + cx, z)
                ph = height_at(lat - 1e-9 * (1 if cy else -1), lon + 1e-9 * (-1 if cx else 1), z - 1)
                if ph is not None:
                    diffs.append(abs(hv - ph))
    tile_heights.__defaults__[0].clear()
    d = np.array(diffs) if diffs else np.zeros(1)
    return {'samples': len(diffs), 'median_m': round(float(np.median(d)), 2), 'p95_m': round(float(np.percentile(d, 95)), 2), 'max_m': round(float(d.max()), 2)}


def grid_mosaic(z, r):
    x0, x1, y0, y1 = r
    N = B.dem_n(z)
    s = N - 1
    M = np.zeros(((y1 - y0 + 1) * s + 1, (x1 - x0 + 1) * s + 1), np.float64)
    for x, y in C.range_tiles(r):
        g = tile_heights(z, x, y)
        if g is not None:
            M[(y - y0) * s:(y - y0) * s + N, (x - x0) * s:(x - x0) * s + N] = g
    tile_heights.__defaults__[0].clear()
    return M


def shade(M, cell_m, size=900):
    gy, gx = np.gradient(M, cell_m)
    az, alt = math.radians(315), math.radians(45)
    slope = np.arctan(np.hypot(gx, gy) * 2.0)  # 2x vertical exaggeration
    aspect = np.arctan2(-gx, gy)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    hs = np.clip(hs, 0, 1)
    hmax = max(1.0, np.percentile(M, 99.5))
    t = np.clip(M / hmax, 0, 1)
    tint = np.stack([0.35 + 0.6 * t, 0.55 + 0.35 * t, 0.30 + 0.55 * t], -1)
    rgb = tint * (0.25 + 0.75 * hs[..., None])
    water = M <= 0.05
    rgb[water] = (0.10, 0.25, 0.55)
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    sc = size / max(im.size)
    return im.resize((max(1, int(im.size[0] * sc)), max(1, int(im.size[1] * sc))), Image.BILINEAR), hmax


def preview(name, loc):
    from PIL import ImageDraw
    panels = []
    for z, kind in ((10, 'far'), (14, 'core')):
        r = C.tile_range(C.far_bbox(loc), z) if kind == 'far' else C.tile_range(C.core_bbox(loc), z, pad=B.CORE_PAD)
        M = grid_mosaic(z, r)
        cell = 40075016.7 * math.cos(math.radians(loc['lat'])) / (1 << z) / (B.dem_n(z) - 1)
        im, hmax = shade(M, cell, 800)
        d = ImageDraw.Draw(im)
        d.rectangle((0, 0, im.size[0], 16), fill=(0, 0, 0))
        d.text((4, 2), '%s %s z%d  %dx%d tiles  max %.0f m  (water = h<=0.05)' % (name, kind, z, r[1] - r[0] + 1, r[3] - r[2] + 1, float(M.max())), fill=(255, 255, 255))
        panels.append(im)
    W = sum(p.size[0] for p in panels) + 8
    H = max(p.size[1] for p in panels)
    out = Image.new('RGB', (W, H), (20, 20, 20))
    xo = 0
    for p in panels:
        out.paste(p, (xo, 0))
        xo += p.size[0] + 8
    path = os.path.join(C.WORLD, 'previews', 'dem-%s.png' % name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--locs', default='')
    ap.add_argument('--skip-audit', action='store_true')
    ap.add_argument('--no-preview', action='store_true')
    a = ap.parse_args()
    locs = C.load_locations([s for s in a.locs.split(',') if s] or None)
    report = {}
    gsets = B.tile_sets([], True)
    if not a.skip_audit:
        st, bad = audit(gsets)
        sm, worst = seams(gsets)
        report['global'] = {'audit': dict(st), 'bad': bad[:10], 'seams': dict(sm), 'worst_seams': worst}
        print('global', report['global'], flush=True)
    for name, loc in locs:
        sets = B.tile_sets([(name, loc)], False)
        rep = {}
        if not a.skip_audit:
            st, bad = audit(sets)
            sm, worst = seams(sets)
            rep.update({'audit': dict(st), 'bad_count': len(bad), 'bad': bad[:10], 'seams': dict(sm), 'worst_seams': worst,
                        'lod_step_parent_vs_child_corner': lod_step(sets)})
        if not a.no_preview:
            rep['preview'] = preview(name, loc)
        report[name] = rep
        print(name, json.dumps(rep), flush=True)
    pts = []
    for nm, lat, lon, exp, tol in KNOWN:
        row = {'name': nm, 'lat': lat, 'lon': lon, 'expected_m': exp}
        for z in (12, 14, 15, 16):
            h = height_at(lat, lon, z)
            row['z%d' % z] = None if h is None else round(float(h), 1)
        h16 = row.get('z16')
        row['ok'] = None if h16 is None else abs(h16 - exp) <= tol
        if h16 is not None and exp > 300:  # summits: the DEM's own peak may sit a few px away
            best = -1e9
            for dy in range(-12, 13):
                for dx in range(-12, 13):
                    hv = height_at(lat + dy * 25 / 111320.0, lon + dx * 25 / (111320.0 * math.cos(math.radians(lat))), 16)
                    if hv is not None:
                        best = max(best, float(hv))
            row['max_within_300m_z16'] = round(best, 1)
        pts.append(row)
        print('  %-28s exp %6.0f  z12 %-8s z14 %-8s z15 %-8s z16 %-8s %-5s %s' % (nm, exp, row['z12'], row['z14'], row['z15'], row['z16'],
                                                                          {True: 'OK', False: 'CHECK', None: 'n/a'}[row['ok']],
                                                                          'max<=300m %s' % row['max_within_300m_z16'] if 'max_within_300m_z16' in row else ''), flush=True)
    report['known_points'] = pts
    C.write_atomic(os.path.join(C.WORLD, 'dem', 'validation.json'), json.dumps(report, indent=1, default=str).encode())


if __name__ == '__main__':
    main()

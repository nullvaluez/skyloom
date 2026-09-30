#!/usr/bin/env python3
"""Validate the trailer WorldCover tiles (build_worldcover.py output).

  1. Every tile of every set: PNG signature, chunks exactly IHDR/IDAT/IEND,
     IHDR 256x256 RGBA8 non-interlaced, file < 512 KB, alpha in {0, 255},
     and the set of (R,G,B,A) colours is a subset of the 11 legend colours
     (alpha 255) plus (0,0,0,0).
  2. One z12 mosaic preview per location: $WORLD/previews/worldcover-<loc>.png

usage: nice -n 15 python3 check_worldcover.py [--locs nyc]
"""
import argparse, collections, json, os, sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wcommon as C  # noqa: E402
import build_worldcover as W  # noqa: E402

ALLOWED = {((c >> 16) & 255) << 24 | ((c >> 8) & 255) << 16 | (c & 255) << 8 | 255 for c in W.LEGEND.values()} | {0}


def audit(sets, seen):
    st = collections.Counter()
    bad = []
    for label, z, r in sets:
        for x, y in C.range_tiles(r):
            if (z, x, y) in seen:
                continue
            seen.add((z, x, y))
            p = W.out_path(z, x, y)
            if not os.path.exists(p):
                bad.append(('absent', p))
                continue
            buf = open(p, 'rb').read()
            ch = [t for t, _ in C.png_chunks(buf)]
            if ch[0] != 'IHDR' or ch[-1] != 'IEND' or set(ch[1:-1]) != {'IDAT'}:
                bad.append(('chunks %s' % ch, p))
            ihdr = (int.from_bytes(buf[16:20], 'big'), int.from_bytes(buf[20:24], 'big'), buf[24], buf[25], buf[28])
            if ihdr != (256, 256, 8, 6, 0):
                bad.append(('ihdr %s' % (ihdr,), p))
            if len(buf) >= 512 * 1024:
                bad.append(('size %d' % len(buf), p))
            a = np.asarray(Image.open(p))
            packed = (a[:, :, 0].astype(np.uint32) << 24) | (a[:, :, 1].astype(np.uint32) << 16) | (a[:, :, 2].astype(np.uint32) << 8) | a[:, :, 3]
            u = set(np.unique(packed).tolist())
            if not u <= ALLOWED:
                bad.append(('colours %s' % sorted('%08x' % v for v in (u - ALLOWED))[:5], p))
            st['tiles'] += 1
            st['bytes'] += len(buf)
            st['max_bytes'] = max(st['max_bytes'], len(buf))
            st['max_colours'] = max(st['max_colours'], len(u))
            if u == {0}:
                st['fully_transparent'] += 1
            elif 0 in u:
                st['partly_transparent'] += 1
    return st, bad


def preview(name, loc):
    z = 12
    r = C.tile_range(C.core_bbox(loc), z, pad=W.CORE_PAD)
    x0, x1, y0, y1 = r
    M = Image.new('RGBA', ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), (0, 0, 0, 0))
    for x, y in C.range_tiles(r):
        p = W.out_path(z, x, y)
        if os.path.exists(p):
            M.paste(Image.open(p), ((x - x0) * 256, (y - y0) * 256))
    bg = Image.new('RGBA', M.size, (40, 40, 40, 255))
    # checker where transparent
    ck = np.zeros((M.size[1], M.size[0], 4), np.uint8)
    yy, xx = np.mgrid[0:M.size[1], 0:M.size[0]]
    ck[..., :3] = np.where((((yy // 16) + (xx // 16)) % 2 == 0)[..., None], 70, 40)
    ck[..., 3] = 255
    out = Image.alpha_composite(Image.fromarray(ck), M).convert('RGB')
    sc = 900 / max(out.size)
    if sc < 1:
        out = out.resize((int(out.size[0] * sc), int(out.size[1] * sc)), Image.NEAREST)
    d = ImageDraw.Draw(out)
    d.rectangle((0, 0, out.size[0], 16), fill=(0, 0, 0))
    d.text((4, 2), '%s WorldCover z12 core %dx%d tiles (checker = no data)' % (name, x1 - x0 + 1, y1 - y0 + 1), fill=(255, 255, 255))
    # legend
    lx = 4
    for k, c in W.LEGEND.items():
        d.rectangle((lx, out.size[1] - 18, lx + 12, out.size[1] - 6), fill=((c >> 16) & 255, (c >> 8) & 255, c & 255), outline=(0, 0, 0))
        d.text((lx + 15, out.size[1] - 18), str(k), fill=(255, 255, 255))
        lx += 42
    path = os.path.join(C.WORLD, 'previews', 'worldcover-%s.png' % name)
    out.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--locs', default='')
    a = ap.parse_args()
    seen = set()
    report = {}
    for name, loc in C.load_locations([s for s in a.locs.split(',') if s] or None):
        st, bad = audit(W.tile_sets(name, loc), seen)
        report[name] = {'audit_new_tiles': dict(st), 'bad_count': len(bad), 'bad': bad[:10], 'preview': preview(name, loc)}
        print(name, json.dumps(report[name]), flush=True)
    C.write_atomic(os.path.join(W.OUT, 'validation.json'), json.dumps(report, indent=1).encode())


if __name__ == '__main__':
    main()

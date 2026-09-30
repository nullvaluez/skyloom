#!/usr/bin/env python3
"""Render a mosaic of built MVT tiles (debug / validation evidence).

water blue, landcover greens/sand/ice, landuse greys, aeroway dark, roads white,
buildings shaded by render_height. Usage:
  python3 preview_tiles.py <z> <x0> <y0> <x1> <y1> out.png [px_per_tile=256]
"""
import os
import sys

import mapbox_vector_tile as mvt
from PIL import Image, ImageDraw

ROOT = '/tmp/claude-0/world/mvt'
LC = {'wood': (46, 90, 40), 'grass': (110, 150, 80), 'farmland': (170, 170, 100), 'wetland': (90, 120, 110),
      'sand': (215, 200, 150), 'rock': (140, 135, 125), 'ice': (235, 240, 245)}
LU = {'residential': (150, 140, 135), 'commercial': (160, 130, 130), 'industrial': (150, 130, 160),
      'retail': (170, 130, 130), 'railway': (120, 110, 110)}


def draw_geom(dr, g, s, ox, oy, fill=None, line=None, width=1):
    t = g['type']
    cs = g['coordinates']
    tf = lambda p: (ox + p[0] * s, oy + p[1] * s)
    if t == 'Polygon':
        cs = [cs]
        t = 'MultiPolygon'
    if t == 'MultiPolygon':
        for poly in cs:
            for k, ring in enumerate(poly):
                pts = [tf(p) for p in ring]
                if len(pts) >= 3:
                    dr.polygon(pts, fill=fill if k == 0 else None)
    elif t in ('LineString', 'MultiLineString'):
        if t == 'LineString':
            cs = [cs]
        for ln in cs:
            pts = [tf(p) for p in ln]
            if len(pts) >= 2:
                dr.line(pts, fill=line, width=width)


def main():
    z, x0, y0, x1, y1 = map(int, sys.argv[1:6])
    out = sys.argv[6]
    px = int(sys.argv[7]) if len(sys.argv) > 7 else 256
    img = Image.new('RGB', ((x1 - x0 + 1) * px, (y1 - y0 + 1) * px), (60, 60, 60))
    dr = ImageDraw.Draw(img)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            fp = f'{ROOT}/{z}/{x}/{y}.pbf'
            ox, oy = (x - x0) * px, (y - y0) * px
            if not os.path.exists(fp) or os.path.getsize(fp) == 0:
                dr.rectangle([ox, oy, ox + px - 1, oy + px - 1], fill=(120, 0, 0) if not os.path.exists(fp) else (40, 40, 40))
                continue
            d = mvt.decode(open(fp, 'rb').read(), default_options={'y_coord_down': True})
            s = px / 4096
            for name in ['landuse', 'landcover', 'park', 'water', 'aeroway', 'transportation', 'building']:
                L = d.get(name)
                if not L:
                    continue
                for f in L['features']:
                    p, g = f['properties'], f['geometry']
                    if name == 'landuse':
                        draw_geom(dr, g, s, ox, oy, fill=LU.get(p.get('class'), (130, 125, 120)))
                    elif name == 'landcover':
                        draw_geom(dr, g, s, ox, oy, fill=LC.get(p.get('class'), (100, 140, 90)))
                    elif name == 'water':
                        draw_geom(dr, g, s, ox, oy, fill=(30, 70, 190) if p.get('class') == 'ocean' else (60, 140, 220))
                    elif name == 'aeroway':
                        draw_geom(dr, g, s, ox, oy, fill=(90, 90, 100), line=(255, 220, 0), width=2)
                    elif name == 'transportation':
                        c = p.get('class')
                        if p.get('brunnel') == 'tunnel' or c in ('path', 'ferry', 'transit'):
                            continue
                        w = 3 if c in ('motorway', 'trunk') else (2 if c in ('primary', 'secondary') else 1)
                        draw_geom(dr, g, s, ox, oy, line=(255, 255, 255) if w > 1 else (220, 220, 220), width=w)
                    elif name == 'building':
                        if p.get('hide_3d'):
                            continue
                        h = p.get('render_height') or 0
                        v = int(min(255, 120 + h * 0.6))
                        draw_geom(dr, g, s, ox, oy, fill=(v, int(v * 0.6), 40))
    img.save(out)
    print(out, img.size)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Debug preview: rasterise Overture ocean (dark blue) + inland water (light blue) for a lon/lat box.
Usage: python3 preview_water.py <loc> w s e n out.png"""
import math, sys
import shapely, pyarrow.parquet as pq
from PIL import Image, ImageDraw


def preview(loc, box, out, W=900):
    t = pq.read_table(f'/tmp/claude-0/world/cache/ovt/{loc}/water_z12.parquet')
    g = shapely.from_wkb(t['geometry'].to_numpy(zero_copy_only=False))
    st, cl = t['subtype'].to_pylist(), t['class'].to_pylist()
    lat = (box[1] + box[3]) / 2
    H = int(W * (box[3] - box[1]) / ((box[2] - box[0]) * math.cos(math.radians(lat))))
    img = Image.new('RGB', (W, H), (70, 110, 60))
    dr = ImageDraw.Draw(img)
    px = lambda x, y: ((x - box[0]) / (box[2] - box[0]) * W, (box[3] - y) / (box[3] - box[1]) * H)

    def draw(gg, col):
        if gg.is_empty:
            return
        if gg.geom_type == 'Polygon':
            ext = [px(*c) for c in gg.exterior.coords]
            if len(ext) >= 3:
                dr.polygon(ext, fill=col)
            for r in gg.interiors:
                ring = [px(*c) for c in r.coords]
                if len(ring) >= 3:
                    dr.polygon(ring, fill=(70, 110, 60))
        elif hasattr(gg, 'geoms'):
            for p in gg.geoms:
                draw(p, col)

    clip = shapely.box(*box)
    for i in range(len(g)):
        if st[i] == 'ocean':
            draw(shapely.intersection(g[i], clip), (20, 60, 200))
    for i in range(len(g)):
        if st[i] not in ('ocean', 'physical') and cl[i] != 'swimming_pool' and g[i].geom_type in ('Polygon', 'MultiPolygon'):
            draw(g[i], (60, 160, 230))
    img.save(out)
    print(out, W, H)


if __name__ == '__main__':
    preview(sys.argv[1], tuple(map(float, sys.argv[2:6])), sys.argv[6])

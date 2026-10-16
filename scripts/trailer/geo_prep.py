"""Pre-bake globe data from Natural Earth 50m (public domain)."""
import json, os
import numpy as np
from PIL import Image, ImageDraw
from paths import GEO, WORK
G = GEO + '/'
W, H = 4096, 2048
def px(lon, lat):
    return ((lon + 180) / 360 * W, (90 - lat) / 180 * H)
land = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(land)
for ft in json.load(open(G + 'ne_50m_land.geojson'))['features']:
    g = ft['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        d.polygon([px(*p) for p in poly[0]], fill=255)
        for hole in poly[1:]:
            d.polygon([px(*p) for p in hole], fill=0)
mask = np.array(land) > 127
# Fibonacci sphere dots
n = 90000
i = np.arange(n) + 0.5
lat = np.degrees(np.arcsin(1 - 2 * i / n))
lon = (np.degrees(np.pi * (1 + 5 ** 0.5) * i) % 360) - 180
xi = np.clip(((lon + 180) / 360 * W).astype(int), 0, W - 1)
yi = np.clip(((90 - lat) / 180 * H).astype(int), 0, H - 1)
keep = mask[yi, xi]
dots = np.stack([lon[keep], lat[keep]], -1).astype(np.float32)
print('land dots', len(dots))
# coastlines as polylines (subsampled)
coast = []
for ft in json.load(open(G + 'ne_50m_coastline.geojson'))['features']:
    g = ft['geometry']
    lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
    for ln in lines:
        c = np.array(ln, dtype=np.float32)
        if len(c) > 3:
            coast.append(c[::2] if len(c) > 40 else c)
# cities
cities = []
for ft in json.load(open(G + 'ne_50m_populated_places_simple.geojson'))['features']:
    p = ft['properties']
    pop = p.get('pop_max') or 0
    if pop >= 400000:
        lon_, lat_ = ft['geometry']['coordinates']
        cities.append((lon_, lat_, pop))
cities = np.array(cities, dtype=np.float64)
print('cities', len(cities))
# routes: weighted by population, mostly regional, some long-haul
rng = np.random.default_rng(5)
w = np.sqrt(cities[:, 2]); w /= w.sum()
def ll2v(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], -1)
V = ll2v(cities[:, 0], cities[:, 1])
routes = []
while len(routes) < 900:
    a, b = rng.choice(len(cities), 2, p=w)
    ang = np.degrees(np.arccos(np.clip(V[a] @ V[b], -1, 1)))
    if ang < 3:
        continue
    # prefer < 60 deg; accept long-haul with lower prob
    if ang > 60 and rng.random() > 0.25:
        continue
    if ang > 110:
        continue
    routes.append((a, b))
routes = np.array(routes)
np.savez(os.path.join(WORK, 'geo.npz'), dots=dots, coast=np.array(coast, dtype=object), cities=cities, routes=routes)
print('routes', len(routes))

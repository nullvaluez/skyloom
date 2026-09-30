#!/usr/bin/env python3
"""Overture Maps (2026-09-23.1) -> OpenMapTiles-schema feature blocks for one location.

Reads only the row groups / columns needed (ovt_read.py), maps Overture
subtypes/classes to the OMT properties the Skyloom worker reads
(data-contract.md §2.3), and writes gzip'd GeoJSON "blocks":

  /tmp/claude-0/world/cache/blocks/<loc>/<bz>_<bx>_<by>.json.gz
  {"z":bz,"x":bx,"y":by,"emit":{"12":[[x,y]],"13":[...],"14":[...]},
   "layers":{"building":[Feature...], ...}}

Each Feature carries an internal "_z":[minz,maxz] property (stripped by the
tiler). tile_blocks.mjs then cuts the blocks into MVT with geojson-vt + vt-pbf.

Usage: nice -n 15 python3 extract.py <loc> [--force]
"""
import gzip
import json
import math
import os
import sys
import time

import numpy as np
import pyarrow as pa
import shapely
from shapely import STRtree
from shapely.ops import substring

import mvt_common as C
from ovt_read import read_box

pa.set_cpu_count(2)
pa.set_io_thread_count(8)

LOG = lambda *a: print('[extract]', *a, flush=True)
FLOOR_M = 3.2

# ---------------------------------------------------------------- mappings
LANDUSE = {  # Overture land_use (subtype, class) -> OMT landuse class
    ('developed', 'commercial'): 'commercial', ('developed', 'retail'): 'retail',
    ('developed', 'industrial'): 'industrial', ('developed', 'works'): 'industrial',
    ('developed', 'depot'): 'industrial', ('developed', 'port'): 'industrial',
    ('developed', 'garages'): 'garages', ('developed', 'brownfield'): 'brownfield',
    ('transportation', 'railway'): 'railway',
    ('military', None): 'military', ('cemetery', None): 'cemetery',
    ('education', 'school'): 'school', ('education', 'schoolyard'): 'school',
    ('education', 'university'): 'university', ('education', 'college'): 'college',
    ('education', 'kindergarten'): 'kindergarten', ('education', 'education'): 'school',
    ('medical', 'hospital'): 'hospital',
    ('recreation', 'pitch'): 'pitch', ('recreation', 'playground'): 'playground',
    ('recreation', 'stadium'): 'stadium', ('recreation', 'track'): 'track',
    ('entertainment', 'zoo'): 'zoo', ('entertainment', 'theme_park'): 'theme_park',
    ('entertainment', 'water_park'): 'theme_park',
    ('resource_extraction', 'quarry'): 'quarry', ('resource_extraction', None): 'quarry',
    ('landfill', None): 'landfill',
}
LU_TO_LANDCOVER = {  # Overture land_use rows that OMT files under landcover
    ('managed', 'grass'): ('grass', 'grass'), ('agriculture', 'meadow'): ('grass', 'meadow'),
    ('agriculture', 'farmland'): ('farmland', 'farmland'), ('agriculture', 'farmyard'): ('farmland', 'farm'),
    ('agriculture', 'orchard'): ('farmland', 'orchard'), ('agriculture', 'vineyard'): ('farmland', 'vineyard'),
    ('agriculture', 'plant_nursery'): ('farmland', 'plant_nursery'),
    ('horticulture', 'allotments'): ('grass', 'allotments'), ('horticulture', 'garden'): ('grass', 'garden'),
    ('horticulture', 'flowerbed'): ('grass', 'flowerbed'),
    ('park', 'village_green'): ('grass', 'village_green'),
    ('recreation', 'recreation_ground'): ('grass', 'recreation_ground'),
    ('golf', 'golf_course'): ('grass', 'golf_course'), ('golf', 'fairway'): ('grass', 'golf_course'),
    ('golf', 'green'): ('grass', 'golf_course'), ('golf', 'tee'): ('grass', 'golf_course'),
    ('golf', 'rough'): ('grass', 'golf_course'), ('golf', 'bunker'): ('sand', 'sand'),
}
LU_TO_PARK = {('park', 'park'): 'park', ('park', 'dog_park'): 'park',
              ('protected', 'nature_reserve'): 'nature_reserve', ('protected', 'national_park'): 'national_park',
              ('protected', 'protected_area'): 'protected_area'}
LAND_TO_LANDCOVER = {  # Overture base/land subtype (OSM natural=*) -> (class, subclass override)
    'forest': 'wood', 'shrub': 'grass', 'grass': 'grass', 'rock': 'rock', 'sand': 'sand',
    'desert': 'sand', 'wetland': 'wetland', 'glacier': 'ice',
}
SHRUB_SUB = {'scrub', 'heath', 'shrubbery', 'fell', 'tundra'}
ESA_TO_LANDCOVER = {'forest': ('wood', 'forest'), 'shrub': ('grass', 'grassland'), 'grass': ('grass', 'grassland'),
                    'crop': ('farmland', 'farmland'), 'wetland': ('wetland', 'wetland'),
                    'mangrove': ('wetland', 'mangrove'), 'moss': ('grass', 'tundra'), 'snow': ('ice', 'glacier')}
WATER_POLY = {'ocean': 'ocean', 'lake': 'lake', 'pond': 'pond', 'reservoir': 'lake', 'river': 'river',
              'canal': 'river', 'stream': 'river'}
WATERWAY = {'river': 'river', 'canal': 'canal', 'stream': 'stream', 'ditch': 'ditch', 'drain': 'drain'}
ROAD_CLASS = {'motorway': 'motorway', 'trunk': 'trunk', 'primary': 'primary', 'secondary': 'secondary',
              'tertiary': 'tertiary', 'residential': 'minor', 'living_street': 'minor', 'unclassified': 'minor',
              'unknown': 'minor', 'service': 'service', 'track': 'track', 'footway': 'path', 'path': 'path',
              'steps': 'path', 'pedestrian': 'path', 'cycleway': 'path', 'bridleway': 'path', 'sidewalk': 'path',
              'crosswalk': 'path'}
ROAD_MINZ = {'motorway': 4, 'trunk': 5, 'primary': 7, 'secondary': 9, 'tertiary': 11, 'minor': 12,
             'service': 13, 'track': 13, 'path': 13, 'rail': 12, 'transit': 13, 'ferry': 12}
TRANSIT_RAIL = {'subway', 'light_rail', 'monorail', 'tram'}
AERODROME = {'airport', 'international_airport', 'regional_airport', 'municipal_airport', 'private_airport',
             'military_airport', 'airstrip', 'seaplane_airport', 'spaceport'}


# ---------------------------------------------------------------- helpers
def fid_of(s):
    """Stable 32-bit numeric id from an Overture GUID (vt-pbf keeps numeric ids only)."""
    h = s.replace('-', '')[:8]
    try:
        v = int(h, 16)
    except ValueError:
        v = 0x811c9dc5
        for ch in s.encode():
            v = ((v ^ ch) * 0x01000193) & 0xffffffff
    return v or 1


def geoms_of(tab):
    return shapely.from_wkb(tab['geometry'].to_numpy(zero_copy_only=False))


def area_m2(g, lat):
    k = 111320.0 ** 2 * math.cos(math.radians(lat))
    return shapely.area(g) * k


def col(tab, name):
    return tab[name].to_pylist() if name in tab.column_names else [None] * tab.num_rows


class Layer:
    """Columnar feature store: geometry + serialized props + zoom range + id."""

    def __init__(self):
        self.g, self.p, self.z0, self.z1, self.id = [], [], [], [], []

    def add(self, g, props, z0, z1=14, fid=None):
        if g is None or g.is_empty:
            return
        self.g.append(g)
        self.p.append({k: v for k, v in props.items() if v is not None})
        self.z0.append(z0)
        self.z1.append(z1)
        self.id.append(fid)

    def __len__(self):
        return len(self.g)

    def freeze(self):
        self.g = np.array(self.g, dtype=object)
        if len(self.g):
            self.g = shapely.transform(self.g, lambda c: np.round(c, 7))
        self.z0 = np.array(self.z0, dtype=np.int8)
        self.z1 = np.array(self.z1, dtype=np.int8)
        self.tree = STRtree(self.g) if len(self.g) else None
        self.ncoord = shapely.get_num_coordinates(self.g) if len(self.g) else np.zeros(0)
        return self


def polys_only(g):
    if g is None or g.is_empty:
        return None
    t = g.geom_type
    if t in ('Polygon', 'MultiPolygon'):
        return g
    if t == 'GeometryCollection':
        ps = [p for p in g.geoms if p.geom_type in ('Polygon', 'MultiPolygon')]
        return shapely.union_all(ps) if ps else None
    return None


def lines_only(g):
    if g is None or g.is_empty:
        return None
    t = g.geom_type
    if t in ('LineString', 'MultiLineString'):
        return g
    if t == 'GeometryCollection':
        ls = [p for p in g.geoms if p.geom_type in ('LineString', 'MultiLineString')]
        return shapely.multilinestrings(ls) if ls else None
    return None


# ---------------------------------------------------------------- readers
def read(loc, key, box, cols, tag):
    return read_box(key, box, cols, cache_name=f'{loc}/{key}_{tag}')


def build_buildings(loc, box, lat, lay):
    b = read(loc, 'building', box, ['id', 'geometry', 'height', 'min_height', 'num_floors', 'min_floor',
                                   'class', 'subtype', 'facade_material', 'roof_shape', 'is_underground',
                                   'has_parts'], 'z14')
    p = read(loc, 'building_part', box, ['id', 'building_id', 'geometry', 'height', 'min_height', 'num_floors',
                                        'min_floor', 'facade_material', 'roof_shape', 'is_underground'], 'z14')
    bg, pg = geoms_of(b), geoms_of(p)
    ids = col(b, 'id')
    parent = {}
    part_parents = set(x for x in col(p, 'building_id') if x)
    recs = []
    H, MH, NF, MF = col(b, 'height'), col(b, 'min_height'), col(b, 'num_floors'), col(b, 'min_floor')
    CL, ST, FM, RS = col(b, 'class'), col(b, 'subtype'), col(b, 'facade_material'), col(b, 'roof_shape')
    UG, HP = col(b, 'is_underground'), col(b, 'has_parts')
    areas = area_m2(bg, lat)
    n_h = n_f = n_none = 0
    for i in range(b.num_rows):
        if UG[i]:
            continue
        g = polys_only(bg[i])
        if g is None:
            continue
        h = H[i]
        if h is None and NF[i]:
            h = NF[i] * FLOOR_M
            n_f += 1
        elif h is not None:
            n_h += 1
        else:
            n_none += 1
        mh = MH[i] if MH[i] is not None else (MF[i] * FLOOR_M if MF[i] else None)
        props = {'render_height': round(float(h), 1) if h else None,
                 'render_min_height': round(float(mh), 1) if mh and h and mh < h else None,
                 'class': CL[i], 'subtype': ST[i], 'facade_material': FM[i], 'roof_shape': RS[i]}
        parent[ids[i]] = (CL[i], ST[i])
        recs.append((h or 0.0, g, props, fid_of(ids[i]), bool(HP[i]) and ids[i] in part_parents, areas[i]))
    # parts
    PH, PMH, PNF, PMF = col(p, 'height'), col(p, 'min_height'), col(p, 'num_floors'), col(p, 'min_floor')
    PB, PFM, PRS, PUG, PID = col(p, 'building_id'), col(p, 'facade_material'), col(p, 'roof_shape'), \
        col(p, 'is_underground'), col(p, 'id')
    parts = []
    for i in range(p.num_rows):
        if PUG[i] or PB[i] not in parent:
            continue
        g = polys_only(pg[i])
        if g is None:
            continue
        # OSM Simple-3D: building:levels counts from the ground (min_level included).
        h = PH[i] if PH[i] is not None else (PNF[i] * FLOOR_M if PNF[i] else None)
        mh = PMH[i] if PMH[i] is not None else (PMF[i] * FLOOR_M if PMF[i] else None)
        cl, st = parent[PB[i]]
        props = {'render_height': round(float(h), 1) if h else None,
                 'render_min_height': round(float(mh), 1) if mh and h and mh < h else None,
                 'class': cl, 'subtype': st, 'facade_material': PFM[i], 'roof_shape': PRS[i]}
        parts.append((h or 0.0, g, props, fid_of(PID[i])))
    # Tallest first (the worker's own selection is volume-ranked; this keeps
    # the skyline right for any consumer that reads in order).
    recs.sort(key=lambda r: -r[0])
    parts.sort(key=lambda r: -r[0])
    for h, g, props, fid, hidden, a in recs:
        if hidden:
            lay['building'].add(g, dict(props, hide_3d=True), 14, 14, fid)
            if a >= 300:
                lay['building'].add(g, props, 13, 13, fid)
        else:
            lay['building'].add(g, props, 14 if a < 300 else 13, 14, fid)
    for h, g, props, fid in parts:
        lay['building'].add(g, props, 14, 14, fid)
    stats = {'outlines': len(recs), 'parts': len(parts), 'hidden_outlines': sum(1 for r in recs if r[4]),
             'height_from_data': n_h, 'height_from_floors': n_f, 'height_unknown': n_none,
             'max_height_m': round(max([r[0] for r in recs] + [r[0] for r in parts] + [0]), 1)}
    LOG(loc, 'buildings', stats)
    return stats


def flag_intervals(flags):
    """[(a,b,brunnel)] from Overture road_flags/rail_flags; tunnel wins over bridge."""
    cuts = {0.0, 1.0}
    spans = []
    for e in flags or []:
        vals = set(e.get('values') or [])
        kind = 'tunnel' if 'is_tunnel' in vals else ('bridge' if 'is_bridge' in vals else None)
        skip = 'is_indoor' in vals or 'is_abandoned' in vals or 'is_under_construction' in vals
        if not kind and not skip:
            continue
        a, b = (e.get('between') or [0.0, 1.0])[:2]
        a, b = max(0.0, min(1.0, a)), max(0.0, min(1.0, b))
        cuts.update((a, b))
        spans.append((a, b, kind, skip))
    if not spans:
        return [(0.0, 1.0, None, False)]
    cuts = sorted(cuts)
    out = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        if b - a < 1e-6:
            continue
        m = (a + b) / 2
        kind, skip = None, False
        for sa, sb, k, s in spans:
            if sa <= m <= sb:
                if k == 'tunnel' or (k == 'bridge' and kind is None):
                    kind = k
                skip = skip or s
        out.append((a, b, kind, skip))
    return out


def build_roads(loc, box, lay, zbox13, far=False):
    tag = 'far' if far else 'z12'
    cols = ['id', 'geometry', 'subtype', 'class', 'subclass', 'road_flags', 'rail_flags'] + ([] if far else ['width_rules'])
    t = read(loc, 'segment', box, cols, tag)
    g = geoms_of(t)
    ST, CL, SC = col(t, 'subtype'), col(t, 'class'), col(t, 'subclass')
    RF, XF = col(t, 'road_flags'), col(t, 'rail_flags')
    WR = col(t, 'width_rules')
    ID = col(t, 'id')
    inner = shapely.box(*zbox13)
    n = 0
    for i in range(t.num_rows):
        st, cl, sc = ST[i], CL[i], SC[i]
        props = {}
        if st == 'road':
            oc = ROAD_CLASS.get(cl)
            if not oc:
                continue
            props['class'] = oc
            if oc == 'path':
                props['subclass'] = 'footway' if cl in ('sidewalk', 'crosswalk') else cl
                if sc:
                    props['subclass'] = sc if cl == 'footway' else props['subclass']
            if oc == 'service' and sc:
                props['service'] = sc
            if sc == 'link':
                props['ramp'] = 1
        elif st == 'rail':
            oc = 'transit' if cl in TRANSIT_RAIL else 'rail'
            props['class'] = oc
            props['subclass'] = cl if cl and cl != 'standard_gauge' and cl != 'unknown' else 'rail'
        elif st == 'water':
            oc = 'ferry'
            props['class'] = 'ferry'
        else:
            continue
        minz = ROAD_MINZ[oc]
        if far:
            if oc not in ('motorway', 'trunk', 'primary') or props.get('ramp'):
                continue
            z0, z1 = 9, 11
        else:
            if props.get('ramp') and oc in ('motorway', 'trunk', 'primary'):
                minz = max(minz, 12)
            z0, z1 = max(10, minz), 14
            if z0 > 12:
                # service/path/track only exist at z13/z14; skip outside the z13 area.
                if not inner.intersects(g[i]):
                    continue
        wr = WR[i] if not far else None
        if wr and len(wr) == 1 and wr[0].get('between') is None and wr[0].get('value'):
            w = float(wr[0]['value'])
            if 2 < w < 100:
                props['width'] = round(w, 1)
        line = lines_only(g[i])
        if line is None:
            continue
        fid = fid_of(ID[i])
        for a, b, kind, skip in flag_intervals((RF[i] or []) + (XF[i] or [])):
            if skip:
                continue
            if a == 0.0 and b == 1.0:
                piece = line
            elif line.geom_type != 'LineString':
                piece = line
            else:
                piece = substring(line, a, b, normalized=True)
            if piece is None or piece.is_empty or piece.geom_type not in ('LineString', 'MultiLineString'):
                continue
            pr = dict(props)
            if kind:
                pr['brunnel'] = kind
            if far and kind == 'tunnel':
                continue
            lay['transportation'].add(piece, pr, z0, z1, fid)
            n += 1
    LOG(loc, tag, 'road pieces', n)
    return n


def build_water(loc, box, lat, lay, lay_ww, far=False):
    tag = 'far' if far else 'z12'
    t = read(loc, 'water', box, ['id', 'geometry', 'subtype', 'class', 'is_intermittent'], tag)
    g = geoms_of(t)
    ST, CL, IN, ID = col(t, 'subtype'), col(t, 'class'), col(t, 'is_intermittent'), col(t, 'id')
    areas = area_m2(g, lat)
    ocean = []
    inland = []
    stats = {'ocean_parts': 0, 'water_polys': 0, 'waterways': 0}
    for i in range(t.num_rows):
        st, cl = ST[i], CL[i]
        gt = g[i].geom_type
        if st == 'ocean':
            if gt in ('Polygon', 'MultiPolygon'):
                ocean.append(g[i])
            continue
        if gt in ('Polygon', 'MultiPolygon'):
            if st == 'physical' or st == 'spring':
                continue
            if st == 'human_made':
                oc = 'swimming_pool' if cl == 'swimming_pool' else ('pond' if cl in ('reflecting_pool', 'pond') else None)
            elif st == 'water':
                oc = 'dock' if cl == 'dock' else ('river' if cl in ('river', 'tidal_channel', 'canal') else 'lake')
            else:
                oc = WATER_POLY.get(st, 'lake')
            if oc is None:
                continue
            a = areas[i]
            if far:
                if oc == 'swimming_pool' or a < 50000:
                    continue
                z0, z1 = 9, 11
            else:
                z0 = 13 if oc == 'swimming_pool' else (12 if a >= 2000 else 13)
                z0, z1 = (10 if a >= 50000 else z0), 14
            props = {'class': oc, 'intermittent': 1 if IN[i] else None}
            inland.append((g[i], props, z0, z1, fid_of(ID[i])))
            stats['water_polys'] += 1
        elif gt in ('LineString', 'MultiLineString'):
            wc = WATERWAY.get(cl) or WATERWAY.get(st)
            if not wc or st in ('physical', 'water'):
                continue
            if far and wc not in ('river', 'canal'):
                continue
            z0, z1 = (9, 11) if far else ((10 if wc in ('river', 'canal') else 12), 14)
            lay_ww.add(g[i], {'class': wc, 'intermittent': 1 if IN[i] else None}, z0, z1, fid_of(ID[i]))
            stats['waterways'] += 1
    u = None
    if ocean:
        u = shapely.union_all(ocean)
        if far:
            u = shapely.simplify(u, 0.0002, preserve_topology=True)
        parts = list(u.geoms) if u.geom_type == 'MultiPolygon' else [u]
        for k, pg in enumerate(parts):
            lay['water'].add(pg, {'class': 'ocean'}, 9 if far else 10, 11 if far else 14, 1000 + k)
        stats['ocean_parts'] = len(parts)
        shapely.prepare(u)
    # ONE water surface everywhere. OSM water polygons overlap each other
    # (Sydney: Port Jackson + Sydney Cove/Farm Cove...) and lie inside the
    # coastline-derived ocean (NY Upper Bay, Hudson, East River...). Stacked
    # water doubles the satWater glint mesh and pushes the worker's SUMMED
    # waterCoverage past the true fraction (Sydney Opera House tile: 0.77 vs a
    # true 0.39). So: dissolve every permanent non-pool polygon, cut the ocean
    # out of the dissolved set, and give each dissolved part the class/id of
    # its largest contributor. Pools and intermittent water are kept as-is.
    keep, dis = [], []
    for rec in inland:
        (dis if rec[1]['class'] != 'swimming_pool' and not rec[1].get('intermittent') else keep).append(rec)
    if dis:
        src = np.array([shapely.make_valid(r[0]) for r in dis], dtype=object)
        src_area = shapely.area(src)
        tree = STRtree(src)
        merged = shapely.union_all(src)
        if u is not None:
            try:
                merged = shapely.difference(merged, shapely.clip_by_rect(u, *merged.bounds))
            except shapely.errors.GEOSException:
                merged = shapely.difference(merged, shapely.make_valid(u))
        merged = polys_only(merged)
        parts = [] if merged is None else (list(merged.geoms) if merged.geom_type == 'MultiPolygon' else [merged])
        k_m2 = 111320.0 ** 2 * math.cos(math.radians(lat))
        for pg in parts:
            a = pg.area * k_m2
            if a < 1.0:
                continue
            hits = tree.query(pg.representative_point(), predicate='intersects')
            if not len(hits):
                hits = tree.query(pg, predicate='intersects')
            j = hits[np.argmax(src_area[hits])] if len(hits) else None
            props = dict(dis[j][1]) if j is not None else {'class': 'lake'}
            fid = dis[j][4] if j is not None else None
            if far:
                if a < 50000:
                    continue
                z0, z1 = 9, 11
            else:
                z0, z1 = (10 if a >= 50000 else (12 if a >= 2000 else 13)), 14
            keep.append((pg, props, z0, z1, fid))
        stats['inland_sources'] = len(dis)
        stats['inland_dissolved_parts'] = len(parts)
    for gi, props, z0, z1, fid in keep:
        lay['water'].add(gi, props, z0, z1, fid)
    LOG(loc, tag, 'water', stats)
    return stats


def build_ground_detail(loc, box, lat, lay):
    stats = {}
    # ESA WorldCover-derived land_cover first (painted first, OSM overrides).
    lc = read(loc, 'land_cover', box, ['id', 'geometry', 'subtype', 'cartography'], 'z12')
    g = geoms_of(lc)
    ST, CA, ID = col(lc, 'subtype'), col(lc, 'cartography'), col(lc, 'id')
    areas = area_m2(g, lat)
    barren = C.BARREN_AS.get(loc)
    n = 0
    for i in range(lc.num_rows):
        mz = (CA[i] or {}).get('min_zoom')
        if mz is not None and mz < 8:
            continue
        st = ST[i]
        m = ESA_TO_LANDCOVER.get(st) or (barren if st == 'barren' else None)
        if not m:
            continue
        if loc == 'dubai' and st == 'shrub':
            m = ('grass', 'scrub')
        pg = polys_only(g[i])
        if pg is None:
            continue
        z0 = 12 if areas[i] >= 5000 else 13
        lay['landcover'].add(pg, {'class': m[0], 'subclass': m[1]}, z0, 14, fid_of(ID[i]))
        n += 1
    stats['esa_landcover'] = n
    # OSM natural (Overture base/land)
    ld = read(loc, 'land', box, ['id', 'geometry', 'subtype', 'class'], 'z12')
    g = geoms_of(ld)
    ST, CL, ID = col(ld, 'subtype'), col(ld, 'class'), col(ld, 'id')
    areas = area_m2(g, lat)
    n = 0
    for i in range(ld.num_rows):
        oc = LAND_TO_LANDCOVER.get(ST[i])
        if not oc:
            continue
        pg = polys_only(g[i])
        if pg is None:
            continue
        sub = CL[i]
        if ST[i] == 'shrub' and sub not in SHRUB_SUB:
            sub = 'scrub'
        if ST[i] == 'desert':
            sub = 'desert'
        z0 = 12 if areas[i] >= 1000 else 13
        lay['landcover'].add(pg, {'class': oc, 'subclass': sub}, z0, 14, fid_of(ID[i]))
        n += 1
    stats['osm_landcover'] = n
    # land_use -> landuse / landcover / park
    lu = read(loc, 'land_use', box, ['id', 'geometry', 'subtype', 'class'], 'z12')
    g = geoms_of(lu)
    ST, CL, ID = col(lu, 'subtype'), col(lu, 'class'), col(lu, 'id')
    areas = area_m2(g, lat)
    nlu = nlc = npk = 0
    for i in range(lu.num_rows):
        st, cl = ST[i], CL[i]
        pg = polys_only(g[i])
        if pg is None:
            continue
        z0 = 12 if areas[i] >= 1000 else 13
        fid = fid_of(ID[i])
        if (st, cl) in LU_TO_PARK:
            lay['park'].add(pg, {'class': LU_TO_PARK[(st, cl)]}, z0, 14, fid)
            npk += 1
            continue
        if (st, cl) in LU_TO_LANDCOVER:
            c, s = LU_TO_LANDCOVER[(st, cl)]
            lay['landcover'].add(pg, {'class': c, 'subclass': s}, z0, 14, fid)
            nlc += 1
            continue
        oc = 'residential' if st == 'residential' else (LANDUSE.get((st, cl)) or LANDUSE.get((st, None)))
        if oc:
            lay['landuse'].add(pg, {'class': oc}, z0, 14, fid)
            nlu += 1
    stats.update(landuse=nlu, landuse_as_landcover=nlc, park=npk)
    LOG(loc, 'ground', stats)
    return stats


def runway_centerline(poly):
    r = shapely.minimum_rotated_rectangle(poly)
    if r.geom_type != 'Polygon':
        return None
    c = list(r.exterior.coords)[:4]
    e = [(c[i], c[(i + 1) % 4]) for i in range(4)]
    L = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in e]
    k = 0 if L[0] >= L[1] else 1
    # long edges are k and k+2; join the midpoints of the short edges k+1 / k+3
    s0, s1 = e[(k + 1) % 4], e[(k + 3) % 4]
    m0 = ((s0[0][0] + s0[1][0]) / 2, (s0[0][1] + s0[1][1]) / 2)
    m1 = ((s1[0][0] + s1[1][0]) / 2, (s1[0][1] + s1[1][1]) / 2)
    return shapely.LineString([m0, m1])


def build_aeroway(loc, box, lat, lay):
    t = read(loc, 'infrastructure', box, ['id', 'geometry', 'subtype', 'class', 'surface'], 'z12')
    g = geoms_of(t)
    ST, CL, SU, ID = col(t, 'subtype'), col(t, 'class'), col(t, 'surface'), col(t, 'id')
    stats = {}
    runway_lines, runway_polys = [], []
    for i in range(t.num_rows):
        st, cl = ST[i], CL[i]
        gt = g[i].geom_type
        fid = fid_of(ID[i])
        if st == 'pier' and gt in ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'):
            lay['transportation'].add(g[i], {'class': 'pier'}, 13, 14, fid)
            stats['pier'] = stats.get('pier', 0) + 1
            continue
        if st != 'airport':
            continue
        if cl in AERODROME:
            oc, polyonly = 'aerodrome', True
        elif cl == 'heliport':
            oc, polyonly = 'heliport', True
        elif cl in ('runway', 'taxiway', 'apron', 'helipad'):
            oc, polyonly = cl, False
        elif cl == 'taxilane':
            oc, polyonly = 'taxiway', False
        elif cl in ('terminal', 'hangar'):
            oc, polyonly = cl, True
        else:
            continue
        isp = gt in ('Polygon', 'MultiPolygon')
        isl = gt in ('LineString', 'MultiLineString')
        if not (isp or (isl and not polyonly)):
            continue
        props = {'class': oc, 'surface': SU[i] if oc in ('runway', 'apron', 'taxiway') else None}
        z0 = 9 if oc == 'aerodrome' else (11 if oc == 'runway' else 12)
        lay['aeroway'].add(g[i], props, z0, 14, fid)
        stats[f'{oc}_{"poly" if isp else "line"}'] = stats.get(f'{oc}_{"poly" if isp else "line"}', 0) + 1
        if oc == 'runway':
            (runway_polys if isp else runway_lines).append((g[i], props, fid))
    # Runway LINES drive the edge lights; synthesise centrelines for polygon-only runways.
    lines = [l[0] for l in runway_lines]
    tree = STRtree(np.array(lines, dtype=object)) if lines else None
    syn = 0
    for pg, props, fid in runway_polys:
        if tree is not None and len(tree.query(pg, predicate='intersects')):
            continue
        parts = list(pg.geoms) if pg.geom_type == 'MultiPolygon' else [pg]
        for p in parts:
            cl = runway_centerline(p)
            if cl is not None and cl.length > 0:
                lay['aeroway'].add(cl, {'class': 'runway', 'surface': props.get('surface')}, 11, 14, fid ^ 0x5a5a)
                syn += 1
    stats['runway_line_synth'] = syn
    LOG(loc, 'aeroway', stats)
    return stats


def build_ground_far(loc, box, lat, lay):
    stats = {}
    lc = read(loc, 'land_cover', box, ['id', 'geometry', 'subtype', 'cartography'], 'far')
    g = geoms_of(lc)
    ST, CA, ID = col(lc, 'subtype'), col(lc, 'cartography'), col(lc, 'id')
    areas = area_m2(g, lat)
    barren = C.BARREN_AS.get(loc)
    keep = []
    for i in range(lc.num_rows):
        mz = (CA[i] or {}).get('min_zoom')
        if (mz is not None and mz < 8) or areas[i] < 100000:
            continue
        st = ST[i]
        if st == 'urban':
            keep.append((i, 'landuse', {'class': 'residential'}))
            continue
        m = ESA_TO_LANDCOVER.get(st) or (barren if st == 'barren' else None)
        if not m:
            continue
        if loc == 'dubai' and st == 'shrub':
            m = ('grass', 'scrub')
        keep.append((i, 'landcover', {'class': m[0], 'subclass': m[1]}))
    idx = np.array([k[0] for k in keep], dtype=int)
    simp = shapely.simplify(g[idx], 0.00015, preserve_topology=True) if len(idx) else []
    for (i, layer, props), sg in zip(keep, simp):
        pg = polys_only(sg)
        if pg is not None:
            lay[layer].add(pg, props, 9, 11, fid_of(ID[i]))
    stats['esa'] = len(keep)
    lu = read(loc, 'land_use', box, ['id', 'geometry', 'subtype', 'class'], 'far')
    g = geoms_of(lu)
    ST, CL, ID = col(lu, 'subtype'), col(lu, 'class'), col(lu, 'id')
    areas = area_m2(g, lat)
    n = 0
    for i in np.nonzero(areas >= 250000)[0]:
        st, cl = ST[i], CL[i]
        pg = polys_only(shapely.simplify(g[i], 0.00015, preserve_topology=True))
        if pg is None:
            continue
        if (st, cl) in LU_TO_LANDCOVER:
            c, s = LU_TO_LANDCOVER[(st, cl)]
            lay['landcover'].add(pg, {'class': c, 'subclass': s}, 9, 11, fid_of(ID[i]))
        elif (st, cl) in LU_TO_PARK:
            lay['park'].add(pg, {'class': LU_TO_PARK[(st, cl)]}, 9, 11, fid_of(ID[i]))
        else:
            oc = 'residential' if st == 'residential' else (LANDUSE.get((st, cl)) or LANDUSE.get((st, None)))
            if not oc:
                continue
            lay['landuse'].add(pg, {'class': oc}, 9, 11, fid_of(ID[i]))
        n += 1
    stats['osm_landuse_large'] = n
    LOG(loc, 'far ground', stats)
    return stats


# ---------------------------------------------------------------- blocks
LAYERS = ['building', 'transportation', 'aeroway', 'water', 'waterway', 'landuse', 'landcover', 'park']


def write_blocks(loc, tier_layers, blocks, outdir):
    """blocks: list of (bz, bx, by, emit{z:[(x,y)]}). Writes one gz JSON per block."""
    os.makedirs(outdir, exist_ok=True)
    frozen = {k: v.freeze() for k, v in tier_layers.items()}
    nfeat = 0
    for bz, bx, by, emit in blocks:
        path = os.path.join(outdir, f'{bz}_{bx}_{by}.json.gz')
        if os.path.exists(path):
            continue
        zs = sorted(emit)
        zlo, zhi = zs[0], zs[-1]
        bb = C.padded_tile_bbox(bz, bx, by)
        qbox = shapely.box(*bb)
        out_layers = {}
        for name in LAYERS:
            L = frozen.get(name)
            if L is None or L.tree is None:
                continue
            idx = L.tree.query(qbox, predicate='intersects')
            if not len(idx):
                continue
            idx = np.sort(idx)  # preserve painter's order
            idx = idx[(L.z0[idx] <= zhi) & (L.z1[idx] >= zlo)]
            if not len(idx):
                continue
            geoms = L.g[idx]
            big = L.ncoord[idx] > 64
            if big.any():
                clipped = shapely.clip_by_rect(geoms[big], *bb)
                geoms = geoms.copy()
                geoms[big] = clipped
            gj = shapely.to_geojson(geoms)
            feats = []
            for j, k in enumerate(idx):
                gk = geoms[j]
                if gk is None or gk.is_empty:
                    continue
                if gk.geom_type == 'GeometryCollection':
                    gk = polys_only(gk) if name in ('water', 'landuse', 'landcover', 'park', 'building') else lines_only(gk)
                    if gk is None:
                        continue
                    gjs = shapely.to_geojson(gk)
                else:
                    gjs = gj[j]
                props = dict(L.p[k])
                props['_z'] = [int(L.z0[k]), int(L.z1[k])]
                fid = L.id[k]
                feats.append('{"type":"Feature",%s"properties":%s,"geometry":%s}' % (
                    f'"id":{fid},' if fid is not None else '', json.dumps(props, separators=(',', ':')), gjs))
            if feats:
                out_layers[name] = feats
                nfeat += len(feats)
        body = '{"loc":%s,"z":%d,"x":%d,"y":%d,"emit":%s,"layers":{%s}}' % (
            json.dumps(loc), bz, bx, by, json.dumps({str(z): [list(t) for t in emit[z]] for z in zs}),
            ','.join('"%s":[%s]' % (n, ','.join(f)) for n, f in out_layers.items()))
        with gzip.open(path + '.tmp', 'wt', compresslevel=1) as f:
            f.write(body)
        os.replace(path + '.tmp', path)
    return nfeat


def main():
    loc = sys.argv[1]
    force = '--force' in sys.argv
    L = C.locations()[loc]
    lat = L['lat']
    cov = C.coverage(loc, L)
    outdir = os.path.join(C.CACHE, 'blocks', loc)
    done = os.path.join(outdir, 'DONE.json')
    if os.path.exists(done) and not force:
        LOG(loc, 'blocks already built; skip (use --force)')
        return
    if force and os.path.isdir(outdir):
        for fn in os.listdir(outdir):
            os.remove(os.path.join(outdir, fn))
    t0 = time.time()
    box14 = C.union_box(14, cov[14])
    box13 = C.union_box(13, cov[13])
    box12 = C.union_box(12, cov[12])
    box9 = C.union_box(9, cov[9])
    stats = {'boxes': {'z14': box14, 'z13': box13, 'z12': box12, 'z9': box9}}

    # ---------------- detail tier (z12..z14, blocks = z12 tiles)
    lay = {k: Layer() for k in LAYERS}
    stats['ground'] = build_ground_detail(loc, box12, lat, lay)
    stats['water'] = build_water(loc, box12, lat, lay, lay['waterway'])
    stats['aeroway'] = build_aeroway(loc, box12, lat, lay)
    stats['roads'] = build_roads(loc, box12, lay, box13)
    stats['buildings'] = build_buildings(loc, box14, lat, lay)
    s13, s14 = set(cov[13]), set(cov[14])
    blocks = []
    for x, y in cov[12]:
        emit = {12: [(x, y)]}
        c13 = [(2 * x + i, 2 * y + j) for i in (0, 1) for j in (0, 1) if (2 * x + i, 2 * y + j) in s13]
        c14 = [(4 * x + i, 4 * y + j) for i in range(4) for j in range(4) if (4 * x + i, 4 * y + j) in s14]
        if c13:
            emit[13] = c13
        if c14:
            emit[14] = c14
        blocks.append((12, x, y, emit))
    stats['detail_features_written'] = write_blocks(loc, lay, blocks, outdir)
    LOG(loc, 'detail blocks', len(blocks), f'{time.time() - t0:.0f}s')
    del lay

    # ---------------- far tier (z9 ring; toy z10/z11 over the z12 area)
    far = {k: Layer() for k in LAYERS}
    stats['far_ground'] = build_ground_far(loc, box9, lat, far)
    stats['far_water'] = build_water(loc, box9, lat, far, far['waterway'], far=True)
    stats['far_roads'] = build_roads(loc, box9, far, box9, far=True)
    fblocks = [(9, x, y, {9: [(x, y)]}) for x, y in cov[9]]
    s11 = set(cov[11])
    for x, y in cov[10]:
        emit = {10: [(x, y)]}
        c11 = [(2 * x + i, 2 * y + j) for i in (0, 1) for j in (0, 1) if (2 * x + i, 2 * y + j) in s11]
        if c11:
            emit[11] = c11
        fblocks.append((10, x, y, emit))
    stats['far_features_written'] = write_blocks(loc, far, fblocks, outdir)
    stats['seconds'] = round(time.time() - t0, 1)
    with open(done, 'w') as f:
        json.dump(stats, f, indent=1)
    LOG(loc, 'DONE', f'{time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()

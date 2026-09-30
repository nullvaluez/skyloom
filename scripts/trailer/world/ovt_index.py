#!/usr/bin/env python3
"""Build (and cache) a per-row-group bbox index for Overture Maps GeoParquet types.

For every parquet file of a type we read ONLY the footer and record, per row
group, the min/max of the bbox.{xmin,xmax,ymin,ymax} struct columns plus the
row count. Downstream readers then fetch only row groups intersecting a query
box and only the columns they need — never whole files.

Output: /tmp/claude-0/world/cache/ovt-index/<type>.json   (idempotent; cached)

Usage: nice -n 15 python3 ovt_index.py [type ...]
  types: building segment water land land_use land_cover infrastructure bathymetry
"""
import json
import os
import sys
import time
import concurrent.futures as cf

import pyarrow.fs as pafs
import pyarrow.parquet as pq

RELEASE = '2026-09-23.1'
ROOT = f'overturemaps-us-west-2/release/{RELEASE}'
TYPES = {
    'building': 'theme=buildings/type=building',
    'building_part': 'theme=buildings/type=building_part',
    'segment': 'theme=transportation/type=segment',
    'water': 'theme=base/type=water',
    'land': 'theme=base/type=land',
    'land_use': 'theme=base/type=land_use',
    'land_cover': 'theme=base/type=land_cover',
    'infrastructure': 'theme=base/type=infrastructure',
    'bathymetry': 'theme=base/type=bathymetry',
}
CACHE = '/tmp/claude-0/world/cache/ovt-index'


def s3():
    return pafs.S3FileSystem(anonymous=True, region='us-west-2',
                             proxy_options=os.environ.get('HTTPS_PROXY') or None,
                             connect_timeout=30, request_timeout=120)


def index_file(fs, path):
    for attempt in range(5):
        try:
            md = pq.ParquetFile(path, filesystem=fs).metadata
            break
        except Exception as e:  # transient proxy hiccups
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))
    rg0 = md.row_group(0)
    cols = {rg0.column(i).path_in_schema: i for i in range(rg0.num_columns)}
    ix = [cols['bbox.xmin'], cols['bbox.xmax'], cols['bbox.ymin'], cols['bbox.ymax']]
    groups = []
    for r in range(md.num_row_groups):
        rg = md.row_group(r)
        st = [rg.column(i).statistics for i in ix]
        if any(s is None or not s.has_min_max for s in st):
            groups.append([r, -180, 180, -90, 90, rg.num_rows])
            continue
        groups.append([r, st[0].min, st[1].max, st[2].min, st[3].max, rg.num_rows])
    return {'path': path, 'groups': groups}


def build_index(key):
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, f'{key}.json')
    if os.path.exists(out):
        with open(out) as f:
            return json.load(f)
    fs = s3()
    files = [i.path for i in fs.get_file_info(pafs.FileSelector(f'{ROOT}/{TYPES[key]}'))
             if i.path.endswith('.parquet') or 'part-' in i.path]
    t0 = time.time()
    res = []
    with cf.ThreadPoolExecutor(12) as ex:  # network-bound
        for r in ex.map(lambda p: index_file(fs, p), files):
            res.append(r)
    data = {'release': RELEASE, 'type': key, 'files': res}
    tmp = out + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f)
    os.replace(tmp, out)
    print(f'[ovt_index] {key}: {len(files)} files indexed in {time.time() - t0:.1f}s', file=sys.stderr)
    return data


def row_groups_for(index, box):
    """box = (w, s, e, n). Returns [(path, [rg...]), ...] of intersecting row groups."""
    w, s, e, n = box
    out = []
    for f in index['files']:
        rgs = [g[0] for g in f['groups'] if not (g[1] > e or g[2] < w or g[3] > n or g[4] < s)]
        if rgs:
            out.append((f['path'], rgs))
    return out


if __name__ == '__main__':
    keys = sys.argv[1:] or list(TYPES)
    for k in keys:
        d = build_index(k)
        n = sum(len(f['groups']) for f in d['files'])
        print(k, len(d['files']), 'files', n, 'row groups')

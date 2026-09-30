#!/usr/bin/env python3
"""Sample Overture `sources` (dataset + license) per theme for a location, for attribution.

Reads the `sources` column of up to N intersecting row groups per type (row-group
pruned, no geometry). Output: /tmp/claude-0/world/cache/sources/<loc>.json
Usage: nice -n 15 python3 sources_sample.py <loc> [N=4]
"""
import collections
import json
import os
import sys

import pyarrow.parquet as pq

import mvt_common as C
from ovt_index import build_index, row_groups_for, s3

TYPES = ['building', 'building_part', 'segment', 'water', 'land', 'land_use', 'land_cover', 'infrastructure']


def main():
    loc = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    out = os.path.join(C.CACHE, 'sources', f'{loc}.json')
    if os.path.exists(out):
        print(open(out).read())
        return
    L = C.locations()[loc]
    cov = C.coverage(loc, L)
    box = C.union_box(14, cov[14])
    fs = s3()
    res = {}
    for t in TYPES:
        jobs = [(p, rg) for p, rgs in row_groups_for(build_index(t), box) for rg in rgs][:n]
        cnt = collections.Counter()
        for p, rg in jobs:
            tab = pq.ParquetFile(p, filesystem=fs).read_row_group(rg, columns=['sources'])
            for srcs in tab.column('sources').to_pylist():
                for s in srcs or []:
                    if s.get('property') in (None, ''):
                        cnt[(s.get('dataset'), s.get('license'))] += 1
        res[t] = [{'dataset': d, 'license': l, 'rows': c} for (d, l), c in cnt.most_common()]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()

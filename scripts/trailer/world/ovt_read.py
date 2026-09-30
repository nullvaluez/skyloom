#!/usr/bin/env python3
"""Read an Overture type inside a lon/lat box using row-group pruning.

Only the row groups whose bbox statistics intersect the box are fetched, and
only the requested columns. Rows are then filtered on the per-row bbox struct.
Results are cached as local parquet under /tmp/claude-0/world/cache/ovt/.
"""
import os
import time
import concurrent.futures as cf

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from ovt_index import build_index, row_groups_for, s3

CACHE = '/tmp/claude-0/world/cache/ovt'


def _read_rg(fs, path, rg, columns, box):
    w, s, e, n = box
    for attempt in range(6):
        try:
            pf = pq.ParquetFile(path, filesystem=fs)
            t = pf.read_row_group(rg, columns=columns + ['bbox'])
            break
        except Exception:
            if attempt == 5:
                raise
            time.sleep(3 * (attempt + 1))
    bb = t.column('bbox')
    xmin = pc.struct_field(bb, 'xmin')
    xmax = pc.struct_field(bb, 'xmax')
    ymin = pc.struct_field(bb, 'ymin')
    ymax = pc.struct_field(bb, 'ymax')
    m = pc.and_(pc.and_(pc.less_equal(xmin, e), pc.greater_equal(xmax, w)),
                pc.and_(pc.less_equal(ymin, n), pc.greater_equal(ymax, s)))
    return t.filter(m)


def read_box(key, box, columns, cache_name=None, threads=6, verbose=True):
    """key: index key (building, segment, ...). box: (w,s,e,n)."""
    if cache_name:
        cp = os.path.join(CACHE, cache_name + '.parquet')
        if os.path.exists(cp):
            return pq.read_table(cp)
    ix = build_index(key)
    jobs = [(p, rg) for p, rgs in row_groups_for(ix, box) for rg in rgs]
    fs = s3()
    t0 = time.time()
    parts = []
    with cf.ThreadPoolExecutor(threads) as ex:
        futs = [ex.submit(_read_rg, fs, p, rg, columns, box) for p, rg in jobs]
        for f in cf.as_completed(futs):
            t = f.result()
            if t.num_rows:
                parts.append(t)
    if parts:
        tab = pa.concat_tables(parts, promote_options='permissive')
    else:
        tab = None
    if verbose:
        print(f'[ovt_read] {key} box={tuple(round(v, 4) for v in box)} rgs={len(jobs)} '
              f'rows={tab.num_rows if tab is not None else 0} {time.time() - t0:.1f}s', flush=True)
    if tab is None:
        # Build an empty table with the right schema from the first file.
        f0 = ix['files'][0]['path']
        sch = pq.ParquetFile(f0, filesystem=fs).schema_arrow
        tab = pa.Table.from_batches([], schema=pa.schema([sch.field(c) for c in columns + ['bbox']]))
    if cache_name:
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        pq.write_table(tab, cp + '.tmp', compression='zstd')
        os.replace(cp + '.tmp', cp)
    return tab

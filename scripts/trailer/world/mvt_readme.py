#!/usr/bin/env python3
"""Append (once) the MVT section to README.md, filling live numbers from
mvt/manifest.json and mvt/validation.json. Re-running replaces only this
section (between its own markers); other agents' sections are untouched.
Usage: python3 mvt_readme.py <template.md>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
README = os.path.join(HERE, 'README.md')
BEGIN, END = '<!-- trailer-mvt-1:begin -->', '<!-- trailer-mvt-1:end -->'


def main():
    tpl = open(sys.argv[1]).read()
    man = json.load(open('/tmp/claude-0/world/mvt/manifest.json'))
    try:
        val = json.load(open('/tmp/claude-0/world/mvt/validation.json'))
    except Exception:
        val = {}
    rows = ['| venue: probe | z14 tile | buildings | max H (m) | waterCoverage | z13 road quads by class | trees / boats | surface z14 water % / classified % | z9 water % |',
            '|---|---|---|---|---|---|---|---|---|']
    for k, r in val.items():
        if k.startswith('_'):
            continue
        sb, rd, vg, es = r['satBuildings'], r['satRoads'], r['satVeg'], r['earthSurface']
        q = ' '.join(f'{c}:{n}' for c, n in sorted(rd['quadsByCls'].items(), key=lambda kv: float(kv[0])))
        rows.append(f"| {k} | {r['z14']} | {sb['total']} | {sb['maxHeightM']} | {sb['waterCoverage']} | {q or '-'} | "
                    f"{vg['trees']} / {vg['boatPts']} | {es['z14']['waterPct']} / {es['z14']['classifiedPct']} | {es['z9']['waterPct']} |")
    cov = ['| venue | status | z14 | z13 | z12 | z9 | z10+z11 | MB | max z14 tile KB | buildings (measured h / floors / inferred) | max h m |',
           '|---|---|---|---|---|---|---|---|---|---|---|']
    wo = []
    total_mb = 0
    for name, e in man['locations'].items():
        c = e.get('coverage', {})
        mb = sum(v['bytes'] for v in c.values()) / 1e6
        total_mb += mb
        b = e.get('extract', {}).get('buildings', {})
        f = lambda z: f"{c[z]['non_empty']}/{c[z]['tiles']}" if z in c else '-'
        cov.append(f"| {name} | {e['status']} | {f('14')} | {f('13')} | {f('12')} | {f('9')} | "
                   f"{c.get('10', {}).get('tiles', 0) + c.get('11', {}).get('tiles', 0)} | {mb:.0f} | "
                   f"{c.get('14', {}).get('max_tile_bytes', 0) // 1024} | "
                   f"{b.get('outlines', 0) + b.get('parts', 0):,} ({b.get('height_from_data', 0):,} / {b.get('height_from_floors', 0):,} / {b.get('height_unknown', 0):,}) | {b.get('max_height_m', '-')} |")
        if 'z14_water_tiles' in e:
            wo.append(f"{name} {e['z14_water_tiles_without_buildings']}/{e['z14_water_tiles']}")
    body = tpl.replace('RESULTS_TABLE', 'Coverage (non-empty/total tiles; the rest are zero-length files):\n\n' + '\n'.join(cov)
                       + '\n\nReal-worker probes:\n\n' + '\n'.join(rows))
    body = body.replace('WATERONLY_COUNTS', '; '.join(wo) + ' (water-bearing z14 tiles without any building / all water-bearing z14 tiles)')
    body = body.replace('MVT_SIZE', f'{total_mb:.0f} MB')
    section = f'{BEGIN}\n{body.strip()}\n{END}\n'
    cur = open(README).read() if os.path.exists(README) else ''
    if BEGIN in cur and END in cur:
        cur = cur[:cur.index(BEGIN)] + section + cur[cur.index(END) + len(END) + 1:]
    else:
        # First write: plain APPEND (other agents append to this file too).
        with open(README, 'a') as fh:
            fh.write('\n\n' + section)
        print('README section appended', len(section), 'chars')
        return
    with open(README + '.tmp', 'w') as fh:
        fh.write(cur)
    os.replace(README + '.tmp', README)
    print('README section written', len(section), 'chars')


if __name__ == '__main__':
    main()

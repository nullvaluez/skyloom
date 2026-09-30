#!/usr/bin/env python3
"""Render chain: for each location (in order) wait for its prep + grade review marker, then render
core (z12-z16), spot previews, far ring (z9-z11) and refresh the merged low zooms (z0-z8)."""
import os, sys, time, json, warnings
warnings.filterwarnings('ignore')
import build_img as B, s2lib as L


def ready(n):
    st = B.load_state(n)
    ok = os.path.exists(os.path.join(L.CACHE, 'review', n + '.ok'))
    return ok and 'grade' in st and st.get('far', {}).get('composed')


for n in sys.argv[1].split(','):
    while not ready(n):
        time.sleep(20)
    loc = L.Loc(n)
    L.log(n, 'RENDER START')
    B.stage_core(loc)
    B.stage_spot(loc)
    B.stage_far(loc)
    B.stage_lowzoom(L.LOC_ORDER)
    L.log(n, 'RENDER DONE')

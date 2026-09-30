#!/usr/bin/env python3
"""Prep chain: plan/fetch/compose/grade(previews) for each location in order (network-heavy, 1 process)."""
import sys, warnings
warnings.filterwarnings('ignore')
import build_img as B, s2lib as L
for n in sys.argv[1].split(','):
    loc = L.Loc(n)
    for prod in ('core', 'far'):
        B.stage_plan(loc, prod)
        B.stage_fetch(loc, prod)
        B.stage_compose(loc, prod)
        if prod == 'core':
            B.stage_grade(loc)
    L.log(n, 'PREP DONE')

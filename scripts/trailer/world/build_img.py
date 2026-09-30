#!/usr/bin/env python3
"""
Skyloom trailer world -- build Sentinel-2 satellite imagery XYZ tiles.

  nice -n 15 python3 build_img.py all  [--locs nyc,dubai,...]
  nice -n 15 python3 build_img.py plan|fetch|compose|grade|core|far|lowzoom|validate|manifest --locs nyc

Stages per location (each is resumable; outputs are skipped when present):
  plan     scene discovery + SCL-based greedy scene selection  (core @ z13 grid, far @ z10 grid)
  fetch    windowed COG reads of B04/B03/B02/B08 (core: 10 m native, far: overview x4 = 40 m)
  compose  plan-resolution composite, per-layer gain matching, feather weights
  grade    fixed per-location colour grade + BEFORE/AFTER previews
  core     z12..z16 tiles (blocks = z12 tiles rendered at z15 res; z16 = Lanczos x2 + halo-clamped USM)
  far      far ring canvas @ z11 res, core pasted in, z9..z11 tiles
  lowzoom  z0..z8 tiles (all locations merged, land/ocean fill outside the rings)
  validate / manifest
"""
import os, sys, json, math, time, argparse, glob
import multiprocessing as mp
from collections import defaultdict

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s2lib as L  # noqa: E402
from s2lib import log, mkdirs, Grid, Loc, res_z, tile_bounds, tiles_in, map_to_grid, Resampling  # noqa: E402

RENDER_VERSION = 'r1'
NPROC = int(os.environ.get('IMG_NPROC', '2'))

# Per-location grade overrides (tuned by eye on the previews -- see README).
GRADE_OVERRIDES = {
    'nyc': {},
    # desert: keep the sand warm (no neutralising WB), richer saturation, turquoise shallows
    'dubai': {'wb': [1.03, 1.0, 0.94], 'sat': 1.32, 'exposure': 1.85, 'contrast': 1.15, 'w_str': 0.55,
              'w_deep': [0.03, 0.15, 0.26], 'w_shal': [0.16, 0.46, 0.5]},
    'sydney': {},
    'rio': {},
    'alps': {},
    'paris': {},
    'london': {},
}


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------

def st_path(name):
    return os.path.join(L.CACHE, 'state', f'{name}.json')


def load_state(name):
    p = st_path(name)
    return json.load(open(p)) if os.path.exists(p) else {}


def save_state(name, st):
    p = st_path(name)
    mkdirs(os.path.dirname(p))
    with open(p + '.tmp', 'w') as f:
        json.dump(st, f, indent=1)
    os.replace(p + '.tmp', p)


def pdir(name, product, *sub):
    return mkdirs(os.path.join(L.CACHE, 'plan', name, product, *sub))


def src_path(name, product, sid):
    return os.path.join(L.CACHE, 'src', name, product, sid + '.tif')


def grid_from(d):
    return Grid(d['bounds'], d['res'])


def npz_save(p, a):
    np.savez_compressed(p + '.tmp.npz', a=a)
    os.replace(p + '.tmp.npz', p)


def npz_load(p):
    with np.load(p) as z:
        return z['a']


# --------------------------------------------------------------------------
# plan
# --------------------------------------------------------------------------

def stage_plan(loc, product, force=False):
    from shapely.geometry import shape, box
    import concurrent.futures as cf
    st = load_state(loc.name)
    if st.get(product, {}).get('planned') and not force:
        return
    core = product == 'core'
    grid = loc.plan_grid(product)
    px_m = loc.ground(grid.res)
    region_ll = loc.region_ll(product)
    tiles = L.mgrs_tiles(region_ll, 3.0 if core else 8.0)
    log(loc.name, product, 'grid', grid.W, 'x', grid.H, f'{px_m:.1f} m/px', 'mgrs', tiles)
    cands = L.list_scenes(tiles, loc.months)
    reg = box(*region_ll)
    need = ('red', 'green', 'blue', 'nir', 'scl')
    cands = [c for c in cands if all(k in c['href'] for k in need) and c['nodata'] < 98.5]
    for c in cands:
        c['ov'] = shape(c['geometry']).intersection(reg).area
    cands = [c for c in cands if c['ov'] > 0]
    log(loc.name, product, len(cands), 'candidate items')

    # rank pass-groups (same date + relative orbit = one datatake, radiometrically consistent)
    groups = defaultdict(list)
    for c in cands:
        groups[(c['date'], c['orbit'])].append(c)
    score = {}
    for k, mem in groups.items():
        score[k] = sum(c['ov'] * (1 - c['cloud'] / 100.0) ** 2 for c in mem)
    ranked = sorted(groups, key=lambda k: -score[k])
    N = 22 if core else 28
    keep = set(ranked[:N])
    # also each tile's own 3 clearest passes
    by_tile = defaultdict(list)
    for c in cands:
        by_tile[c['tile']].append(c)
    for t, lst in by_tile.items():
        for c in sorted(lst, key=lambda c: c['cloud'])[:3]:
            keep.add((c['date'], c['orbit']))
    keep = [k for k in ranked if k in keep]
    log(loc.name, product, len(keep), 'pass groups to inspect')

    ovl_scl = None if core else 1
    ovl_aot = 2 if core else 3

    def scl_for(c):
        cp = os.path.join(pdir(loc.name, product, 'scl'), c['id'] + '.npz')
        if os.path.exists(cp):
            return c['id'], npz_load(cp)
        r = L.read_window_for(c['href']['scl'], grid.bounds, ovl=ovl_scl)
        if r is None:
            a = np.zeros((grid.H, grid.W), np.uint8)
        else:
            a = L.reproject_to(r[0][0], r[1], r[2], grid, Resampling.nearest, src_nodata=0,
                               dst_dtype=np.uint8, dst_nodata=0)
        npz_save(cp, a)
        return c['id'], a

    def aot_for(c):
        try:
            r = L.read_window_for(c['href']['aot'], grid.bounds, ovl=ovl_aot)
            if r is None:
                return c['id'], 0.5
            a = r[0][0]
            v = a[a > 0]
            return c['id'], float(np.median(v)) * 0.001 if v.size else 0.5
        except Exception:
            return c['id'], 0.5

    mem_all = [c for k in keep for c in groups[k]]
    t0 = time.time()
    with cf.ThreadPoolExecutor(8) as ex:
        aots = dict(ex.map(aot_for, mem_all))
    imp = loc.importance(grid, product)
    total = float(imp.sum())
    G = {}
    info = {}
    with cf.ThreadPoolExecutor(6) as ex:
        for k in keep:
            mem = groups[k]
            sc = None
            for cid, a in ex.map(scl_for, mem):
                if sc is None:
                    sc = a.copy()
                else:
                    m = (sc == 0) & (a > 0)
                    sc[m] = a[m]
            gp = os.path.join(pdir(loc.name, product, 'grp'), f'{k[0]}_{k[1]}.npz')
            npz_save(gp, sc)
            good, valid = L.scl_masks(sc, px_m, product)
            G[k] = good
            info[k] = {'valid_frac': float((imp * valid).sum() / total), 'good_frac': float((imp * good).sum() / total),
                       'aot': float(np.mean([aots[c['id']] for c in mem])), 'n': len(mem)}
    log(loc.name, product, 'SCL inspected in', f'{time.time() - t0:.0f}s')

    # greedy selection: max new clear coverage; near-ties broken by aerosol (haze)
    cov = np.zeros((grid.H, grid.W), bool)
    chosen = []
    maxg = 8 if core else 14
    while len(chosen) < maxg:
        gains = {}
        for k in keep:
            if k in chosen:
                continue
            gains[k] = float((imp * (G[k] & ~cov)).sum() / total)
        if not gains:
            break
        best = max(gains.values())
        if best < (0.0008 if core else 0.0015):
            break
        tol = 0.94 if not chosen else 0.85
        elig = [k for k in gains if gains[k] >= best * tol]
        k = min(elig, key=lambda k: (info[k]['aot'] + 0.02 * (0 if not chosen else abs(_days(k[0], chosen[0][0])) / 365.0), -gains[k]))
        chosen.append(k)
        cov |= G[k]
        log(loc.name, product, 'pick', k, f"+{gains[k] * 100:.2f}%", f"aot {info[k]['aot']:.3f}",
            f"cov {float((imp * cov).sum() / total) * 100:.2f}%")

    # extra fill layers for holes with no data at all in the chosen set
    def valid_of(k):
        sc = npz_load(os.path.join(pdir(loc.name, product, 'grp'), f'{k[0]}_{k[1]}.npz'))
        return sc > 0

    anyv = np.zeros((grid.H, grid.W), bool)
    for k in chosen:
        anyv |= valid_of(k)
    extras = []
    for _ in range(4):
        holes = ~anyv
        if (imp * holes).sum() / total < 0.0005:
            break
        bestk, bestv = None, 0
        for k in keep:
            if k in chosen or k in extras:
                continue
            v = float((imp * (valid_of(k) & holes)).sum() / total)
            if v > bestv:
                bestk, bestv = k, v
        if bestk is None or bestv < 0.0005:
            break
        extras.append(bestk)
        anyv |= valid_of(bestk)
        log(loc.name, product, 'extra fill layer', bestk, f'+{bestv * 100:.2f}% data')

    layers = chosen + extras
    fw = 300.0 if core else 2500.0
    bad = []
    for i, k in enumerate(layers):
        sc = npz_load(os.path.join(pdir(loc.name, product, 'grp'), f'{k[0]}_{k[1]}.npz'))
        if i < len(chosen):
            _, valid = L.scl_masks(sc, px_m, product)
            a = L.feather(G[k] & valid, px_m, fw)
        else:
            a = np.zeros((grid.H, grid.W), np.float32)
        np.save(os.path.join(pdir(loc.name, product), f'alpha_{i}.npy'), a.astype(np.float16))
        bad.append(L.badness(sc))
    bad = np.stack(bad)
    choice = np.argmin(bad, axis=0)
    none = bad.min(axis=0) >= 99
    for i in range(len(layers)):
        oh = ((choice == i) & ~none).astype(np.float32)
        oh = cv2.GaussianBlur(oh, (0, 0), 1.5)
        np.save(os.path.join(pdir(loc.name, product), f'fbw_{i}.npy'), oh.astype(np.float16))
    pres = L.feather(~none, px_m, 1500.0 if core else 6000.0)
    np.save(os.path.join(pdir(loc.name, product), 'presence.npy'), pres.astype(np.float16))
    del bad

    lay = []
    for i, k in enumerate(layers):
        lay.append({'key': list(k), 'date': k[0], 'orbit': k[1], 'fill_only': i >= len(chosen),
                    'members': groups[k], **info[k]})
    st = load_state(loc.name)
    st[product] = {'planned': True, 'grid': grid.to_dict(), 'layers': lay, 'mgrs': tiles,
                   'n_candidates': len(cands), 'n_inspected': len(keep),
                   'clear_cov': float((imp * cov).sum() / total), 'nodata_frac': float((imp * none).sum() / total)}
    save_state(loc.name, st)


def _days(a, b):
    import datetime
    return (datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days


# --------------------------------------------------------------------------
# fetch
# --------------------------------------------------------------------------

def fetch_one(loc, product, c, bounds):
    import rasterio
    import concurrent.futures as cf
    out = src_path(loc.name, product, c['id'])
    if os.path.exists(out):
        return 'cached'
    mkdirs(os.path.dirname(out))
    ovl = None if product == 'core' else 1
    bands = ['red', 'green', 'blue', 'nir']

    def rd(b):
        return L.read_window_for(c['href'][b], bounds, ovl=ovl, pad=8)

    with cf.ThreadPoolExecutor(4) as ex:
        res = list(ex.map(rd, bands))
    if any(r is None for r in res):
        return 'empty'
    shp = res[0][0].shape
    if any(r[0].shape != shp for r in res):
        return 'mismatch'
    arr = np.concatenate([r[0] for r in res], 0)
    prof = dict(driver='GTiff', dtype='uint16', count=4, width=shp[2], height=shp[1], crs=res[0][2],
                transform=res[0][1], nodata=0, tiled=True, blockxsize=512, blockysize=512,
                compress='deflate', predictor=2, zlevel=1)
    with rasterio.open(out + '.tmp.tif', 'w', **prof) as ds:
        ds.write(arr)
    os.replace(out + '.tmp.tif', out)
    return f'{shp[2]}x{shp[1]}'


def contrib_bounds(loc, product, plan, i, c, pad):
    """Merc bounds of the plan pixels where member c of layer i can actually contribute."""
    sp = os.path.join(L.CACHE, 'plan', loc.name, product, 'scl', c['id'] + '.npz')
    if not os.path.exists(sp):
        return None
    v = npz_load(sp) > 0
    a = np.load(os.path.join(pdir(loc.name, product), f'alpha_{i}.npy')) > 0.002
    w = np.load(os.path.join(pdir(loc.name, product), f'fbw_{i}.npy')) > 0.002
    m = v & (a | w)
    if m.sum() < 4:
        return None
    ys, xs = np.nonzero(m)
    b = plan.bounds
    return (b[0] + xs.min() * plan.res - pad, b[3] - (ys.max() + 1) * plan.res - pad,
            b[0] + (xs.max() + 1) * plan.res + pad, b[3] - ys.min() * plan.res + pad)


def stage_fetch(loc, product):
    import concurrent.futures as cf
    st = load_state(loc.name)
    lay = st[product]['layers']
    plan = grid_from(st[product]['grid'])
    # pad around the contributing area: enough for gain-fit overlap and kernel support
    pad = 600.0 if product == 'core' else 6000.0
    jobs = []
    for i, l in enumerate(lay):
        for c in l['members']:
            bb = contrib_bounds(loc, product, plan, i, c, pad)
            if bb is not None:
                jobs.append((c, bb))
    t0 = time.time()
    with cf.ThreadPoolExecutor(3) as ex:
        for (c, bb), r in zip(jobs, ex.map(lambda j: fetch_one(loc, product, j[0], j[1]), jobs)):
            log(loc.name, product, 'fetch', c['id'], r)
    log(loc.name, product, 'fetched', len(jobs), 'scenes in', f'{time.time() - t0:.0f}s')


# --------------------------------------------------------------------------
# composite helpers
# --------------------------------------------------------------------------

def layer_on_grid(loc, product, layer, g, resampling):
    import rasterio
    from rasterio.windows import Window, from_bounds
    from rasterio.warp import transform_bounds
    img, valid = None, None
    for c in layer['members']:
        p = src_path(loc.name, product, c['id'])
        if not os.path.exists(p):
            continue
        with rasterio.open(p) as ds:
            b = transform_bounds(L.EPSG3857, ds.crs, *g.bounds, densify_pts=11)
            w = from_bounds(*b, transform=ds.transform)
            c0 = max(0, int(math.floor(w.col_off)) - 6)
            r0 = max(0, int(math.floor(w.row_off)) - 6)
            c1 = min(ds.width, int(math.ceil(w.col_off + w.width)) + 6)
            r1 = min(ds.height, int(math.ceil(w.row_off + w.height)) + 6)
            if c1 - c0 < 2 or r1 - r0 < 2:
                continue
            win = Window(c0, r0, c1 - c0, r1 - r0)
            arr = ds.read(window=win).astype(np.float32)
            t = ds.window_transform(win)
            crs = ds.crs
        if not (arr[0] > 0).any():
            continue
        dst = L.reproject_to(arr, t, crs, g, resampling, src_nodata=0)
        v = np.isfinite(dst).all(0) & (dst[0] > 0) & (dst[1] > 0) & (dst[2] > 0)
        if not v.any():
            continue
        off = c.get('dn_offset_eff', c.get('dn_offset', 0))
        dst = (dst - off) / 10000.0
        if img is None:
            img, valid = np.where(v[None], dst, 0).astype(np.float32), v
        else:
            m = v & ~valid
            img[:, m] = dst[:, m]
            valid |= m
    return img, valid


def plan_up(name, product, fname, plan, g):
    """Crop a plan-res array and resample it (bilinear, centre-exact) onto grid g."""
    a = np.load(os.path.join(L.CACHE, 'plan', name, product, fname), mmap_mode='r')
    x0 = int(math.floor((g.bounds[0] - plan.bounds[0]) / plan.res)) - 2
    y0 = int(math.floor((plan.bounds[3] - g.bounds[3]) / plan.res)) - 2
    x1 = int(math.ceil((g.bounds[2] - plan.bounds[0]) / plan.res)) + 2
    y1 = int(math.ceil((plan.bounds[3] - g.bounds[1]) / plan.res)) + 2
    cx0, cy0 = max(0, x0), max(0, y0)
    cx1, cy1 = min(plan.W, x1), min(plan.H, y1)
    crop = np.ascontiguousarray(a[cy0:cy1, cx0:cx1], dtype=np.float32)
    cg = Grid((plan.bounds[0] + cx0 * plan.res, plan.bounds[3] - cy1 * plan.res,
               plan.bounds[0] + cx1 * plan.res, plan.bounds[3] - cy0 * plan.res), plan.res)
    return map_to_grid(crop, cg, g, interp=cv2.INTER_LINEAR, border=cv2.BORDER_REPLICATE)


def composite_on_grid(loc, product, st, g, resampling, P=None):
    """Front-to-back feathered composite of the planned layers onto grid g. Returns (4,H,W) reflectance."""
    plan = grid_from(st[product]['grid'])
    lay = st[product]['layers']
    H, W = g.H, g.W
    comp = np.zeros((4, H, W), np.float32)
    T = np.ones((H, W), np.float32)
    fbacc = np.zeros((4, H, W), np.float32)
    fbw = np.zeros((H, W), np.float32)
    for i, l in enumerate(lay):
        a0 = plan_up(loc.name, product, f'alpha_{i}.npy', plan, g)
        w0 = plan_up(loc.name, product, f'fbw_{i}.npy', plan, g)
        if a0.max() < 1e-4 and w0.max() < 1e-4:
            continue            # this layer contributes nothing here: skip the warp
        img, valid = layer_on_grid(loc, product, l, g, resampling)
        if img is None:
            continue
        gain = l.get('gain') or [[1.0, 0.0]] * 4
        for b in range(4):
            img[b] = img[b] * gain[b][0] + gain[b][1]
        img[:, ~valid] = 0
        vf = valid.astype(np.float32)
        a = a0 * vf
        comp += (T * a)[None] * img
        T *= (1 - a)
        w = w0 * vf
        fbacc += w[None] * img
        fbw += w
        del img
    has = fbw > 1e-4
    fb = fbacc / np.maximum(fbw, 1e-4)[None]
    comp += (T * has)[None] * fb
    left = T * (~has)
    fill = np.array((P or st['grade'])['fill_refl'], np.float32)[:, None, None]
    comp += left[None] * fill
    if os.path.exists(os.path.join(L.CACHE, 'plan', loc.name, product, 'ocean.npy')):
        ow = plan_up(loc.name, product, 'ocean.npy', plan, g)
        if ow.max() > 1e-4:
            lp = plan_up_multi(loc.name, product, 'lowpass.npy', plan, g)
            comp = apply_ocean(comp, ow, lp, fill, product)
    pres = plan_up(loc.name, product, 'presence.npy', plan, g)
    s = np.clip(1 - pres, 0, 1)
    comp = comp * (1 - s)[None] + fill * s[None]
    return comp


OCEAN = {  # open-water flattening: (full-effect distance ramp from land [m], low-pass sigma [m], detail gain, detail clamp)
    'core': dict(d0=400.0, d1=2500.0, sigma=180.0, k=0.8, clampv=0.006),
    'far': dict(d0=600.0, d1=5000.0, sigma=700.0, k=0.5, clampv=0.005),
}


def ocean_model(loc, product, S, plan, comp):
    """Open water is re-synthesised as the location's deep-water colour + clamped high-pass detail,
    so multi-date sea (glint, sea state, cloud leftovers) cannot patch.  Near-shore water (harbours,
    rivers, plumes) keeps its real pixels.  Land/water by majority SCL vote over the layers, GLOBE
    land mask where no layer votes."""
    from global_land_mask import globe
    O = OCEAN[product]
    px_m = loc.ground(plan.res)
    lv = np.zeros((plan.H, plan.W), np.int16)
    wv = np.zeros((plan.H, plan.W), np.int16)
    for l in S['layers']:
        sc = npz_load(os.path.join(pdir(loc.name, product, 'grp'), f"{l['date']}_{l['orbit']}.npz"))
        lv += np.isin(sc, (4, 5, 11)).astype(np.int16)
        wv += (sc == 6).astype(np.int16)
    xs, ys = plan.xy_centers()
    lon = xs / L.ORIGIN * 180.0
    lat = np.degrees(2 * np.arctan(np.exp(ys / L.ORIGIN * np.pi)) - np.pi / 2)
    glm = globe.is_land(lat[:, None] * np.ones((1, plan.W)), np.ones((plan.H, 1)) * lon[None, :])
    land = np.where((lv + wv) > 0, lv > wv, glm).astype(np.uint8)
    land = cv2.morphologyEx(land, cv2.MORPH_OPEN, L.disk(max(1.0, 45.0 / px_m)))
    d = np.minimum(cv2.distanceTransform((1 - land).astype(np.uint8), cv2.DIST_L2, 5), 1e6) * px_m
    ow = L.smoothstep(O['d0'], O['d1'], d).astype(np.float32)
    lp = np.stack([cv2.GaussianBlur(np.nan_to_num(comp[b]), (0, 0), O['sigma'] / px_m) for b in range(4)])
    np.save(os.path.join(pdir(loc.name, product), 'ocean.npy'), ow.astype(np.float16))
    np.save(os.path.join(pdir(loc.name, product), 'lowpass.npy'), lp.astype(np.float16))
    S['ocean_frac'] = float((ow > 0.5).mean())
    log(loc.name, product, 'ocean model: open-water fraction', f"{S['ocean_frac'] * 100:.1f}%")


def apply_ocean(comp, ow, lp, fill, product):
    O = OCEAN[product]
    if ow.max() < 1e-4:
        return comp
    hp = np.clip(comp - lp, -O['clampv'], O['clampv']) * O['k']
    return comp * (1 - ow)[None] + (fill + hp) * ow[None]


def plan_up_multi(name, product, fname, plan, g):
    a = np.load(os.path.join(L.CACHE, 'plan', name, product, fname), mmap_mode='r')
    return np.stack([_plan_up_arr(a[b], plan, g) for b in range(a.shape[0])])


def _plan_up_arr(a, plan, g):
    x0 = int(math.floor((g.bounds[0] - plan.bounds[0]) / plan.res)) - 2
    y0 = int(math.floor((plan.bounds[3] - g.bounds[3]) / plan.res)) - 2
    x1 = int(math.ceil((g.bounds[2] - plan.bounds[0]) / plan.res)) + 2
    y1 = int(math.ceil((plan.bounds[3] - g.bounds[1]) / plan.res)) + 2
    cx0, cy0 = max(0, x0), max(0, y0)
    cx1, cy1 = min(plan.W, x1), min(plan.H, y1)
    crop = np.ascontiguousarray(a[cy0:cy1, cx0:cx1], dtype=np.float32)
    cg = Grid((plan.bounds[0] + cx0 * plan.res, plan.bounds[3] - cy1 * plan.res,
               plan.bounds[0] + cx1 * plan.res, plan.bounds[3] - cy0 * plan.res), plan.res)
    return map_to_grid(crop, cg, g, interp=cv2.INTER_LINEAR, border=cv2.BORDER_REPLICATE)


def fit_gain(x, y, m, lo=0.7, hi=1.4):
    qs = np.arange(4, 97, 4)
    xs = np.percentile(x[m], qs)
    ys = np.percentile(y[m], qs)
    A = np.vstack([xs, np.ones_like(xs)]).T
    a, b = np.linalg.lstsq(A, ys, rcond=None)[0]
    a = float(np.clip(a, lo, hi))
    b = float(np.clip(np.median(ys - a * xs), -0.04, 0.04))
    return [a, b]


# --------------------------------------------------------------------------
# compose (plan resolution)
# --------------------------------------------------------------------------

def stage_compose(loc, product, force=False):
    st = load_state(loc.name)
    S = st[product]
    if S.get('composed') and not force:
        return
    plan = grid_from(S['grid'])
    lay = S['layers']
    H, W = plan.H, plan.W
    comp = np.zeros((4, H, W), np.float32)
    T = np.ones((H, W), np.float32)
    fbacc = np.zeros((4, H, W), np.float32)
    fbw = np.zeros((H, W), np.float32)
    import rasterio
    for l in lay:
        # DN offset sanity per member: PB>=04.00 items are +1000 DN unless E84 harmonised them.
        # Trust the STAC flag, but verify against the data (blue p0.5 over the whole window).
        for c in l['members']:
            c['dn_offset_eff'] = c.get('dn_offset', 0)
            p = src_path(loc.name, product, c['id'])
            if not os.path.exists(p):
                continue
            with rasterio.open(p) as ds:
                sh = (max(1, ds.height // 8), max(1, ds.width // 8))
                bl = ds.read(3, out_shape=sh)
            v = bl[bl > 0]
            if v.size < 1000:
                continue
            p05 = float(np.percentile(v, 0.5))
            c['blue_p05_dn'] = p05
            # only the safe direction: data below the +1000 floor proves the offset is absent.
            # (the reverse test misfires over bright desert, where blue p0.5 is legitimately >1000 DN)
            if c['dn_offset_eff'] == 1000 and p05 < 950:
                log('WARN', c['id'], 'blue p0.5', p05, '-> DN offset 0 (flag said not applied)')
                c['dn_offset_eff'] = 0
    for i, l in enumerate(lay):
        img, valid = layer_on_grid(loc, product, l, plan, Resampling.average)
        if img is None:
            l['gain'] = [[1.0, 0.0]] * 4
            continue
        sc = npz_load(os.path.join(pdir(loc.name, product, 'grp'), f"{l['date']}_{l['orbit']}.npz"))
        px_m = loc.ground(plan.res)
        good, _ = L.scl_masks(sc, px_m, product)
        land = np.isin(sc, (4, 5))
        gain = [[1.0, 0.0]] * 4
        if i > 0:
            done = (T < 0.02) & np.isfinite(comp).all(0)
            m = done & good & land & valid
            nmin = 3000 if product == 'core' else 800
            if m.sum() < nmin:
                m = (T < 0.2) & valid & land
            if m.sum() >= nmin:
                gain = [fit_gain(img[b], comp[b], m) for b in range(4)]
            log(loc.name, product, 'layer', i, l['date'], 'fit px', int(m.sum()), 'gain',
                [f'{g[0]:.3f}/{g[1]:+.4f}' for g in gain])
        l['gain'] = gain
        l['fit_px'] = int(m.sum()) if i > 0 else 0
        for b in range(4):
            img[b] = img[b] * gain[b][0] + gain[b][1]
        img[:, ~valid] = 0
        vf = valid.astype(np.float32)
        a = np.load(os.path.join(pdir(loc.name, product), f'alpha_{i}.npy')).astype(np.float32) * vf
        comp += (T * a)[None] * img
        T *= (1 - a)
        w = np.load(os.path.join(pdir(loc.name, product), f'fbw_{i}.npy')).astype(np.float32) * vf
        fbacc += w[None] * img
        fbw += w
        l['contrib'] = float(((T * 0 + a) > 0).mean())
        del img
    has = fbw > 1e-4
    fb = fbacc / np.maximum(fbw, 1e-4)[None]
    comp += (T * has)[None] * fb
    left = (T * (~has)).astype(np.float32)
    S['clear_final'] = float((T < 0.02).mean())
    S['fallback_frac'] = float(((T >= 0.02) & has).mean())
    S['nodata_final'] = float((left > 0.5).mean())
    np.save(os.path.join(pdir(loc.name, product), 'comp.npy'), comp.astype(np.float16))
    np.save(os.path.join(pdir(loc.name, product), 'left.npy'), left.astype(np.float16))
    ocean_model(loc, product, S, plan, comp)
    S['composed'] = True
    st = load_state(loc.name)      # re-read: another stage may have written meanwhile
    st[product] = S
    save_state(loc.name, st)
    log(loc.name, product, 'composite: clear', f"{S['clear_final'] * 100:.1f}%", 'fallback',
        f"{S['fallback_frac'] * 100:.2f}%", 'nodata', f"{S['nodata_final'] * 100:.2f}%")


# --------------------------------------------------------------------------
# grade + previews
# --------------------------------------------------------------------------

def to_u8(x):
    return np.clip(x * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_png(arr, path, width=None):
    if width and arr.shape[1] != width:
        h = int(round(arr.shape[0] * width / arr.shape[1]))
        arr = cv2.resize(arr, (width, h), interpolation=cv2.INTER_AREA)
    Image.fromarray(to_u8(arr) if arr.dtype != np.uint8 else arr).save(path)


def stage_grade(loc, force=False, previews=True):
    st = load_state(loc.name)
    comp = np.load(os.path.join(pdir(loc.name, 'core'), 'comp.npy')).astype(np.float32)
    left = np.load(os.path.join(pdir(loc.name, 'core'), 'left.npy')).astype(np.float32)
    if force or 'grade' not in st:
        P = L.estimate_grade(comp, left < 0.01, GRADE_OVERRIDES.get(loc.name))
        st['grade'] = P
        save_state(loc.name, st)
        log(loc.name, 'grade', json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in P.items()}))
    P = st['grade']
    if previews:
        # core is at the z13 plan grid; show the core box region
        plan = grid_from(st['core']['grid'])
        b = loc.core_m
        x0 = int((b[0] - plan.bounds[0]) / plan.res)
        x1 = int((b[2] - plan.bounds[0]) / plan.res)
        y0 = int((plan.bounds[3] - b[3]) / plan.res)
        y1 = int((plan.bounds[3] - b[1]) / plan.res)
        op = os.path.join(pdir(loc.name, 'core'), 'ocean.npy')
        if os.path.exists(op):
            fill = np.array(P['fill_refl'], np.float32)[:, None, None]
            comp = apply_ocean(np.nan_to_num(comp), np.load(op).astype(np.float32),
                               np.load(os.path.join(pdir(loc.name, 'core'), 'lowpass.npy')).astype(np.float32), fill, 'core')
        c = comp[:, y0:y1, x0:x1]
        c = np.where(np.isfinite(c), c, 0)
        before = L.tci_like(c[0], c[1], c[2])
        after = L.grade(c[0], c[1], c[2], c[3], P)
        mkdirs(L.PREV)
        save_png(before, os.path.join(L.PREV, f'img-{loc.name}-before.png'), 1600)
        save_png(after, os.path.join(L.PREV, f'img-{loc.name}-after.png'), 1600)
        log(loc.name, 'previews written')


# --------------------------------------------------------------------------
# tiles
# --------------------------------------------------------------------------

def save_jpg(u8, z, x, y):
    d = mkdirs(os.path.join(L.IMG_OUT, str(z), str(x)))
    p = os.path.join(d, f'{y}.jpg')
    Image.fromarray(u8).save(p + '.tmp', format='JPEG', quality=90, subsampling=0, optimize=True,
                             progressive=False)
    os.replace(p + '.tmp', p)


def sharpen(img, sigma, amount, clamp=0.012):
    blur = cv2.GaussianBlur(img, (0, 0), sigma)
    sh = img + amount * (img - blur)
    k = np.ones((3, 3), np.uint8)
    lo = cv2.erode(img, k)
    hi = cv2.dilate(img, k)
    return np.clip(np.clip(sh, lo - clamp, hi + clamp), 0, 1)


def tiles_overlap(b, c):
    return b[0] < c[2] and b[2] > c[0] and b[1] < c[3] and b[3] > c[1]


def core_block(args):
    name, bx, by = args
    mark = os.path.join(L.CACHE, 'done', name, 'core', f'{RENDER_VERSION}_{bx}_{by}')
    if os.path.exists(mark):
        return 'skip'
    t0 = time.time()
    loc = Loc(name)
    st = load_state(name)
    P = st['grade']
    M = 32
    bb = tile_bounds(12, bx, by)
    g = Grid(bb, res_z(15)).pad(M)
    comp = composite_on_grid(loc, 'core', st, g, Resampling.lanczos, P)
    disp = L.grade(comp[0], comp[1], comp[2], comp[3], P)
    del comp
    inner = disp[M:-M, M:-M]
    n = 0
    # z15 (only tiles touching the core box) -- light USM
    s15 = sharpen(sharpen(disp, 0.8, 0.45, 0.012), 1.8, 0.35, 0.015)[M:-M, M:-M]
    for (x, y) in tiles_in(15, bb):
        if not tiles_overlap(tile_bounds(15, x, y), loc.core_m):
            continue
        ox, oy = x - bx * 8, y - by * 8
        save_jpg(to_u8(s15[oy * 256:(oy + 1) * 256, ox * 256:(ox + 1) * 256]), 15, x, y)
        n += 1
    del s15
    # z16: Lanczos x2 from the z15-res composite, clamp ringing to the local range, halo-clamped USM
    z16 = [(x, y) for (x, y) in tiles_in(16, bb) if tiles_overlap(tile_bounds(16, x, y), loc.core_m)]
    if z16:
        up = cv2.resize(disp, None, fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
        k = np.ones((3, 3), np.uint8)
        lo = cv2.resize(cv2.erode(disp, k), None, fx=2, fy=2, interpolation=cv2.INTER_LINEAR)
        hi = cv2.resize(cv2.dilate(disp, k), None, fx=2, fy=2, interpolation=cv2.INTER_LINEAR)
        up = np.clip(up, lo - 0.01, hi + 0.01)
        del lo, hi
        up = sharpen(sharpen(up, 1.0, 0.9, 0.02), 2.8, 0.6, 0.02)[2 * M:-2 * M, 2 * M:-2 * M]
        for (x, y) in z16:
            ox, oy = x - bx * 16, y - by * 16
            save_jpg(to_u8(up[oy * 256:(oy + 1) * 256, ox * 256:(ox + 1) * 256]), 16, x, y)
            n += 1
        del up
    # z14 / z13 / z12: area downsample (whole block)
    z14 = sharpen(cv2.resize(inner, (1024, 1024), interpolation=cv2.INTER_AREA), 0.8, 0.25)
    for oy in range(4):
        for ox in range(4):
            save_jpg(to_u8(z14[oy * 256:(oy + 1) * 256, ox * 256:(ox + 1) * 256]), 14, bx * 4 + ox, by * 4 + oy)
            n += 1
    z13 = cv2.resize(inner, (512, 512), interpolation=cv2.INTER_AREA)
    for oy in range(2):
        for ox in range(2):
            save_jpg(to_u8(z13[oy * 256:(oy + 1) * 256, ox * 256:(ox + 1) * 256]), 13, bx * 2 + ox, by * 2 + oy)
            n += 1
    save_jpg(to_u8(cv2.resize(inner, (256, 256), interpolation=cv2.INTER_AREA)), 12, bx, by)
    n += 1
    # core z13 display canvas (for the far-ring paste)
    plan = grid_from(st['core']['grid'])
    cv = np.load(os.path.join(L.CACHE, 'canvas', f'{name}_core13.npy'), mmap_mode='r+')
    px = int(round((bb[0] - plan.bounds[0]) / plan.res))
    py = int(round((plan.bounds[3] - bb[3]) / plan.res))
    cv[py:py + 512, px:px + 512] = to_u8(z13)
    cv.flush()
    del cv
    mkdirs(os.path.dirname(mark))
    open(mark, 'w').write(f'{n} tiles {time.time() - t0:.1f}s')
    return f'{n} tiles {time.time() - t0:.1f}s'


def invalidate_ocean_blocks(loc):
    """Drop the done-markers of core blocks that contain open water (after an ocean-model change)."""
    st = load_state(loc.name)
    plan = grid_from(st['core']['grid'])
    ow = np.load(os.path.join(pdir(loc.name, 'core'), 'ocean.npy'))
    n = 0
    for (x, y) in tiles_in(12, loc.core_ext):
        bb = tile_bounds(12, x, y)
        px = int(round((bb[0] - plan.bounds[0]) / plan.res))
        py = int(round((plan.bounds[3] - bb[3]) / plan.res))
        if ow[py:py + 512, px:px + 512].max() > 0.01:
            mk = os.path.join(L.CACHE, 'done', loc.name, 'core', f'{RENDER_VERSION}_{x}_{y}')
            if os.path.exists(mk):
                os.remove(mk)
                n += 1
    log(loc.name, 'invalidated', n, 'ocean blocks')


def stage_core(loc):
    st = load_state(loc.name)
    plan = grid_from(st['core']['grid'])
    cvp = os.path.join(mkdirs(os.path.join(L.CACHE, 'canvas')), f'{loc.name}_core13.npy')
    if not os.path.exists(cvp):
        np.lib.format.open_memmap(cvp, mode='w+', dtype=np.uint8, shape=(plan.H, plan.W, 3))
    blocks = [(loc.name, x, y) for (x, y) in tiles_in(12, loc.core_ext)]
    log(loc.name, 'core blocks', len(blocks))
    t0 = time.time()
    with mp.get_context('fork').Pool(NPROC) as pool:
        for i, r in enumerate(pool.imap_unordered(core_block, blocks)):
            if r != 'skip' and (i % 5 == 0 or i == len(blocks) - 1):
                log(loc.name, f'core {i + 1}/{len(blocks)}', r, f'{time.time() - t0:.0f}s')
    log(loc.name, 'core done', f'{time.time() - t0:.0f}s')


# ---- far ring ----

def stage_far_fit(loc, force=False):
    """Fit the far composite to the core composite (per band) over the core box."""
    st = load_state(loc.name)
    if st['far'].get('far_to_core') and not force:
        return
    fplan = grid_from(st['far']['grid'])
    cplan = grid_from(st['core']['grid'])
    fc = np.load(os.path.join(pdir(loc.name, 'far'), 'comp.npy')).astype(np.float32)
    cc = np.load(os.path.join(pdir(loc.name, 'core'), 'comp.npy')).astype(np.float32)
    f = int(round(fplan.res / cplan.res))
    h, w = cplan.H // f, cplan.W // f
    ccd = np.stack([cv2.resize(cc[b], (w, h), interpolation=cv2.INTER_AREA) for b in range(4)])
    ox = int(round((cplan.bounds[0] - fplan.bounds[0]) / fplan.res))
    oy = int(round((fplan.bounds[3] - cplan.bounds[3]) / fplan.res))
    fcc = fc[:, oy:oy + h, ox:ox + w]
    R, G, B, N = ccd
    ndwi = (G - N) / (G + N + 1e-6)
    m = np.isfinite(ccd).all(0) & np.isfinite(fcc).all(0) & (ndwi < -0.05) & (fcc[0] > 0) & (R > 0)
    fit = [fit_gain(fcc[b], ccd[b], m, 0.75, 1.33) for b in range(4)] if m.sum() > 300 else [[1.0, 0.0]] * 4
    log(loc.name, 'far->core fit px', int(m.sum()), [f'{g[0]:.3f}/{g[1]:+.4f}' for g in fit])
    for l in st['far']['layers']:
        g0 = l.get('gain') or [[1.0, 0.0]] * 4
        l['gain_own'] = g0
        l['gain'] = [[g0[b][0] * fit[b][0], g0[b][1] * fit[b][0] + fit[b][1]] for b in range(4)]
    far = st['far']
    far['far_to_core'] = fit
    st = load_state(loc.name)
    st['far'] = far
    save_state(loc.name, st)


def far_block(args):
    name, bx, by = args
    mark = os.path.join(L.CACHE, 'done', name, 'far', f'{RENDER_VERSION}_{bx}_{by}')
    if os.path.exists(mark):
        return 'skip'
    t0 = time.time()
    loc = Loc(name)
    st = load_state(name)
    P = st['grade']
    M = 8
    bb = tile_bounds(9, bx, by)
    g = Grid(bb, res_z(11)).pad(M)
    comp = composite_on_grid(loc, 'far', st, g, Resampling.average, P)
    disp = L.grade(comp[0], comp[1], comp[2], comp[3], P)[M:-M, M:-M]
    fg = Grid(loc.far_ext, res_z(11))
    cv = np.load(os.path.join(L.CACHE, 'canvas', f'{name}_far11.npy'), mmap_mode='r+')
    px = int(round((bb[0] - fg.bounds[0]) / fg.res))
    py = int(round((fg.bounds[3] - bb[3]) / fg.res))
    cv[py:py + 1024, px:px + 1024] = to_u8(disp)
    cv.flush()
    del cv
    mkdirs(os.path.dirname(mark))
    open(mark, 'w').write(f'{time.time() - t0:.1f}s')
    return f'{time.time() - t0:.1f}s'


def stage_far(loc):
    stage_far_fit(loc)
    fg = Grid(loc.far_ext, res_z(11))
    cvp = os.path.join(mkdirs(os.path.join(L.CACHE, 'canvas')), f'{loc.name}_far11.npy')
    if not os.path.exists(cvp):
        np.lib.format.open_memmap(cvp, mode='w+', dtype=np.uint8, shape=(fg.H, fg.W, 3))
    blocks = [(loc.name, x, y) for (x, y) in tiles_in(9, loc.far_ext)]
    log(loc.name, 'far blocks', len(blocks))
    t0 = time.time()
    with mp.get_context('fork').Pool(NPROC) as pool:
        for i, r in enumerate(pool.imap_unordered(far_block, blocks)):
            if r != 'skip':
                log(loc.name, f'far {i + 1}/{len(blocks)}', r, f'{time.time() - t0:.0f}s')
    # paste the core (display space) with a feathered edge, then cut z9..z11
    st = load_state(loc.name)
    cplan = grid_from(st['core']['grid'])
    cv = np.load(cvp, mmap_mode='r')
    far = np.array(cv)
    core13 = np.load(os.path.join(L.CACHE, 'canvas', f'{loc.name}_core13.npy'))
    f = int(round(fg.res / cplan.res))
    h, w = cplan.H // f, cplan.W // f
    c11 = cv2.resize(core13.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
    ox = int(round((cplan.bounds[0] - fg.bounds[0]) / fg.res))
    oy = int(round((fg.bounds[3] - cplan.bounds[3]) / fg.res))
    inner = np.ones((h, w), np.uint8)
    inner[0, :] = inner[-1, :] = inner[:, 0] = inner[:, -1] = 0
    a = L.feather(inner.astype(bool), loc.ground(fg.res), 2500.0)[..., None]
    reg = far[oy:oy + h, ox:ox + w].astype(np.float32)
    far[oy:oy + h, ox:ox + w] = np.clip(reg * (1 - a) + c11 * a + 0.5, 0, 255).astype(np.uint8)
    np.save(os.path.join(L.CACHE, 'canvas', f'{loc.name}_far11_final.npy'), far)
    n = 0
    for z in (11, 10, 9):
        k = 2 ** (11 - z)
        lvl = far if k == 1 else cv2.resize(far, (fg.W // k, fg.H // k), interpolation=cv2.INTER_AREA)
        gz = Grid(loc.far_ext, res_z(z))
        want = set(loc.far_tiles(z)) | set(loc.core_tiles(z))
        for (x, y) in want:
            tb = tile_bounds(z, x, y)
            px = int(round((tb[0] - gz.bounds[0]) / gz.res))
            py = int(round((gz.bounds[3] - tb[3]) / gz.res))
            if px < 0 or py < 0 or px + 256 > lvl.shape[1] or py + 256 > lvl.shape[0]:
                log('WARN tile outside far canvas', z, x, y)
                continue
            save_jpg(np.ascontiguousarray(lvl[py:py + 256, px:px + 256]), z, x, y)
            n += 1
    log(loc.name, 'far tiles z9-z11', n, f'{time.time() - t0:.0f}s')
    # far preview
    save_png(far, os.path.join(L.PREV, f'img-{loc.name}-far.png'), 1600)


# ---- low zooms (all locations merged) ----

def stage_lowzoom(names):
    from global_land_mask import globe
    done = [n for n in names if os.path.exists(os.path.join(L.CACHE, 'canvas', f'{n}_far11_final.npy'))]
    mk = os.path.join(L.CACHE, 'done', 'lowzoom.json')
    sig = {'locs': sorted(done), 'v': RENDER_VERSION}
    if os.path.exists(mk) and json.load(open(mk)) == sig:
        log('lowzoom up to date', done)
        return
    locs = {n: Loc(n) for n in done}
    info = {}
    for n, loc in locs.items():
        far = np.load(os.path.join(L.CACHE, 'canvas', f'{n}_far11_final.npy'))
        fg = Grid(loc.far_ext, res_z(11))
        st = load_state(n)
        P = st['grade']
        fr = np.array(P['fill_refl'], np.float32)
        ocean = L.grade(*[np.full((1, 1), v, np.float32) for v in fr], P)[0, 0]
        # land colour: median of land pixels (coarse)
        sm = cv2.resize(far, (fg.W // 16, fg.H // 16), interpolation=cv2.INTER_AREA)
        g16 = Grid(loc.far_ext, res_z(7))
        xs, ys = g16.xy_centers()
        X, Y = np.meshgrid(xs, ys)
        lon = X / L.ORIGIN * 180
        lat = np.degrees(2 * np.arctan(np.exp(Y / L.ORIGIN * np.pi)) - np.pi / 2)
        land = globe.is_land(lat, lon)
        land_rgb = np.median(sm[land], axis=0) / 255.0 if land.sum() > 20 else np.array([0.42, 0.44, 0.36])
        # pyramid (with a canvas-edge alpha that fades into the fill beyond the data)
        a = np.ones((fg.H, fg.W), np.uint8)
        a[0, :] = a[-1, :] = a[:, 0] = a[:, -1] = 0
        alpha = L.feather(a.astype(bool), loc.ground(fg.res), 30000.0)
        # level k = z11 res * 2^k ; z<=8 needs k>=3, so halve twice in uint8 first (memory)
        im8 = far
        al = alpha
        for _ in range(2):
            im8 = cv2.resize(im8, (im8.shape[1] // 2, im8.shape[0] // 2), interpolation=cv2.INTER_AREA)
            al = cv2.resize(al, (al.shape[1] // 2, al.shape[0] // 2), interpolation=cv2.INTER_AREA)
        pyr = [None, None, (im8.astype(np.float32) / 255.0, al)]
        del far
        while len(pyr) < 12:
            im, al = pyr[-1]
            if im.shape[0] < 4 or im.shape[1] < 4:
                break
            if im.shape[0] % 2 or im.shape[1] % 2:
                im = cv2.copyMakeBorder(im, 0, im.shape[0] % 2, 0, im.shape[1] % 2, cv2.BORDER_REPLICATE)
                al = cv2.copyMakeBorder(al, 0, al.shape[0] % 2, 0, al.shape[1] % 2, cv2.BORDER_CONSTANT, value=0)
            pyr.append((cv2.resize(im, (im.shape[1] // 2, im.shape[0] // 2), interpolation=cv2.INTER_AREA),
                        cv2.resize(al, (al.shape[1] // 2, al.shape[0] // 2), interpolation=cv2.INTER_AREA)))
        info[n] = {'pyr': pyr, 'ocean': ocean, 'land': land_rgb, 'fg': fg}
        log('lowzoom prep', n, 'ocean', np.round(ocean * 255).astype(int), 'land', np.round(land_rgb * 255).astype(int))
    need = defaultdict(set)
    for n, loc in locs.items():
        for z in range(0, 9):
            for t in set(loc.far_tiles(z)) | set(loc.core_tiles(z)):
                need[(z,) + t].add(n)
    log('lowzoom tiles', len(need))
    for (z, x, y), ns in sorted(need.items()):
        tb = tile_bounds(z, x, y)
        g = Grid(tb, res_z(z))
        xs, ys = g.xy_centers()
        X, Y = np.meshgrid(xs, ys)
        lon = X / L.ORIGIN * 180
        lat = np.degrees(2 * np.arctan(np.exp(Y / L.ORIGIN * np.pi)) - np.pi / 2)
        lat = np.clip(lat, -89.9, 89.9)
        land = cv2.GaussianBlur(globe.is_land(lat, lon).astype(np.float32), (0, 0), 1.0)[..., None]
        cx, cy = (tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2
        near = min(locs, key=lambda n: math.hypot(locs[n].cx - cx, locs[n].cy - cy))
        tile = info[near]['ocean'][None, None] * (1 - land) + info[near]['land'][None, None] * land
        for n in sorted(ns, key=lambda n: -math.hypot(locs[n].cx - cx, locs[n].cy - cy)):
            I = info[n]
            k = 11 - z
            k = min(k, len(I['pyr']) - 1)
            im, al = I['pyr'][k]
            lg = Grid((I['fg'].bounds[0], I['fg'].bounds[3] - im.shape[0] * I['fg'].res * 2 ** k,
                       I['fg'].bounds[0] + im.shape[1] * I['fg'].res * 2 ** k, I['fg'].bounds[3]), I['fg'].res * 2 ** k)
            v = map_to_grid(im, lg, g, interp=cv2.INTER_LINEAR, border=cv2.BORDER_CONSTANT, bval=0)
            a = map_to_grid(al, lg, g, interp=cv2.INTER_LINEAR, border=cv2.BORDER_CONSTANT, bval=0)[..., None]
            tile = tile * (1 - a) + v * a
        save_jpg(to_u8(tile), z, x, y)
    mkdirs(os.path.dirname(mk))
    json.dump(sig, open(mk, 'w'))
    log('lowzoom done')


# --------------------------------------------------------------------------
# validate / manifest / previews
# --------------------------------------------------------------------------

def mosaic_from_tiles(z, x0, y0, nx, ny):
    out = np.zeros((ny * 256, nx * 256, 3), np.uint8)
    for j in range(ny):
        for i in range(nx):
            p = os.path.join(L.IMG_OUT, str(z), str(x0 + i), f'{y0 + j}.jpg')
            if os.path.exists(p):
                out[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = np.array(Image.open(p).convert('RGB'))
            else:
                out[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = (255, 0, 255)
    return out


def ll_to_px(z, lon, lat):
    x, y = L.ll2m(lon, lat)
    s = L.tsize(z)
    return (x + L.ORIGIN) / s * 256.0, (L.ORIGIN - y) / s * 256.0


def crop_preview(z, lon, lat, w, h, path, cross=True):
    gx, gy = ll_to_px(z, lon, lat)
    x0 = int(gx - w / 2)
    y0 = int(gy - h / 2)
    tx0, ty0 = x0 // 256, y0 // 256
    tx1, ty1 = (x0 + w) // 256, (y0 + h) // 256
    m = mosaic_from_tiles(z, tx0, ty0, tx1 - tx0 + 1, ty1 - ty0 + 1)
    c = m[y0 - ty0 * 256:y0 - ty0 * 256 + h, x0 - tx0 * 256:x0 - tx0 * 256 + w].copy()
    if cross:
        cx, cy = int(gx - x0), int(gy - y0)
        for d in range(6, 22):
            for (xx, yy) in ((cx + d, cy), (cx - d, cy), (cx, cy + d), (cx, cy - d)):
                if 0 <= xx < w and 0 <= yy < h:
                    c[yy, xx] = (255, 40, 40)
    Image.fromarray(c).save(path)
    return path


LANDMARKS = {
    'nyc': [('liberty', -74.0445, 40.6892), ('empire', -73.9857, 40.7484), ('jfk', -73.7781, 40.6413)],
    'dubai': [('palm', 55.138, 25.112), ('burj', 55.2744, 25.1972)],
    'sydney': [('opera', 151.2153, -33.8568)],
    'rio': [('sugarloaf', -43.1566, -22.9486), ('redeemer', -43.2105, -22.9519)],
    'alps': [('jungfrau', 7.962, 46.537), ('eiger', 8.005, 46.577)],
    'paris': [('eiffel', 2.2945, 48.8584)],
    'london': [('bigben', -0.1246, 51.5007)],
}


def stage_spot(loc):
    out = []
    lm = LANDMARKS.get(loc.name, [])
    if lm:
        nm, lon, lat = lm[0]
        out.append(crop_preview(16, lon, lat, 1024, 768, os.path.join(L.PREV, f'img-{loc.name}-z16-{nm}.png')))
        out.append(crop_preview(15, lon, lat, 768, 512, os.path.join(L.PREV, f'img-{loc.name}-z15-{nm}-cross.png')))
        out.append(crop_preview(13, lon, lat, 1024, 768, os.path.join(L.PREV, f'img-{loc.name}-z13-{nm}.png'), cross=False))
    log(loc.name, 'spot previews', out)


def stage_validate(names):
    bad = []
    counts = defaultdict(int)
    sizes = 0
    for p in glob.glob(os.path.join(L.IMG_OUT, '*', '*', '*.jpg')):
        z = int(p.split('/')[-3])
        try:
            with Image.open(p) as im:
                ok = (im.format == 'JPEG' and im.size == (256, 256) and im.mode == 'RGB'
                      and not im.info.get('icc_profile') and not im.info.get('progressive')
                      and not im.info.get('progression'))
                im.load()
            if not ok:
                bad.append(p)
        except Exception:
            bad.append(p)
        counts[z] += 1
        sizes += os.path.getsize(p)
    leftovers = glob.glob(os.path.join(L.IMG_OUT, '*', '*', '*.tmp'))
    # completeness of the promised sets
    missing = {}
    for n in names:
        loc = Loc(n)
        miss = []
        for z in range(8, 17):
            for (x, y) in loc.core_tiles(z):
                if not os.path.exists(os.path.join(L.IMG_OUT, str(z), str(x), f'{y}.jpg')):
                    miss.append((z, x, y))
        for z in range(0, 12):
            for (x, y) in loc.far_tiles(z):
                if not os.path.exists(os.path.join(L.IMG_OUT, str(z), str(x), f'{y}.jpg')):
                    miss.append((z, x, y))
        missing[n] = len(miss)
        if miss:
            log('MISSING', n, len(miss), miss[:5])
    res = {'files': int(sum(counts.values())), 'bytes': sizes, 'per_zoom': dict(sorted(counts.items())),
           'bad': bad[:20], 'n_bad': len(bad), 'tmp_leftovers': len(leftovers), 'missing_per_loc': missing}
    log('validate', json.dumps(res))
    return res


def stage_manifest(names, val=None):
    man = {
        'kind': 'skyloom-trailer-imagery', 'render_version': RENDER_VERSION,
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'path': 'img/{z}/{x}/{y}.jpg', 'scheme': 'xyz (Google/OSM), EPSG:3857',
        'engine_request_path': '/img/{z}/{y}/{x}  (server maps y/x order onto these files)',
        'format': {'tile': 256, 'type': 'image/jpeg', 'quality': 90, 'chroma': '4:4:4', 'progressive': False,
                   'icc': None, 'colour': 'sRGB (implicit)', 'opaque': True},
        'source': 'Copernicus Sentinel-2 L2A (ESA), Element84 COG mirror s3://sentinel-cogs/sentinel-s2-l2a-cogs '
                  '(AWS Open Data). Bands B04/B03/B02 (+B08 for the water/vegetation masks) at 10 m; SCL for clouds.',
        'attribution': 'Contains modified Copernicus Sentinel data 2022-2025, processed by Skyloom',
        'license': 'Copernicus Sentinel Data Legal Notice -- free, full and open use incl. commercial, attribution '
                   'required (https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)',
        'aux_licenses': {'global-land-mask (GLOBE 1km, NOAA public domain; pkg MIT)': 'land/ocean fill outside the far rings (z0-z8 only)'},
        'server_notes': [
            'Core tiles exist z8..z16 over the core box (z12-z14 cover whole z12 blocks around it); far ring z0..z11.',
            'Any request deeper than what exists for that area (e.g. z12+ outside the core, z17/z18) should be served by '
            'cropping+upscaling the deepest existing ancestor tile -- never 404 (three-tile paints failures black).',
            'Set the pin img.maxLevel to 16 (native max) so three-tile overzooms z16 itself.',
        ],
        'fallback_rgb': [28, 52, 70],   # deep-water tone; the server's last-resort opaque tile colour
        'locations': {},
    }
    for n in names:
        st = load_state(n)
        if 'grade' not in st:
            continue
        loc = Loc(n)
        ent = {'center': [loc.lat, loc.lon], 'core_km': loc.core_km, 'far_km': loc.far_km,
               'core_bbox_ll': [round(v, 5) for v in loc.core_ll],
               'core_ext_3857': [round(v, 2) for v in loc.core_ext], 'far_ext_3857': [round(v, 2) for v in loc.far_ext],
               'zooms': {}, 'grade': {k: v for k, v in st['grade'].items()}}
        for z in range(0, 17):
            exp = set()
            if z >= 8:
                exp |= set(loc.core_tiles(z))
            if z <= 11:
                exp |= set(loc.far_tiles(z))
            if 12 <= z <= 14:
                exp |= set(tiles_in(z, loc.core_ext))
            have = sum(1 for (x, y) in exp if os.path.exists(os.path.join(L.IMG_OUT, str(z), str(x), f'{y}.jpg')))
            if exp:
                x0 = min(t[0] for t in exp); x1 = max(t[0] for t in exp)
                y0 = min(t[1] for t in exp); y1 = max(t[1] for t in exp)
                ent['zooms'][z] = {'tiles': len(exp), 'present': have, 'x': [x0, x1], 'y': [y0, y1],
                                   'role': ('core' if z >= 12 else ('core+far' if z >= 8 else 'far'))}
        for prod in ('core', 'far'):
            if prod not in st:
                continue
            S = st[prod]
            ent[prod] = {
                'mgrs_tiles': S.get('mgrs'), 'candidates': S.get('n_candidates'), 'inspected_passes': S.get('n_inspected'),
                'clear_fraction': S.get('clear_final'), 'fallback_fraction': S.get('fallback_frac'),
                'nodata_fraction': S.get('nodata_final'), 'far_to_core_gain': S.get('far_to_core'),
                'layers': [{'date': l['date'], 'rel_orbit': l['orbit'], 'fill_only': l['fill_only'],
                            'aot': round(l['aot'], 4), 'good_frac': round(l['good_frac'], 4),
                            'gain': l.get('gain'), 'scenes': [
                                {'id': c['id'], 'datetime': c['datetime'], 'cloud': c['cloud'], 'pb': c['pb'],
                                 's3': c['prefix']} for c in l['members']]} for l in S['layers']],
            }
        man['locations'][n] = ent
    if val:
        man['validation'] = val
    p = os.path.join(L.IMG_OUT, 'manifest.json')
    with open(p + '.tmp', 'w') as f:
        json.dump(man, f, indent=1)
    os.replace(p + '.tmp', p)
    log('manifest written', p)


# --------------------------------------------------------------------------

def run_loc(name, stages, force=()):
    loc = Loc(name)
    t0 = time.time()
    if 'plan' in stages:
        stage_plan(loc, 'core', force='plan' in force)
    if 'fetch' in stages:
        stage_fetch(loc, 'core')
    if 'compose' in stages:
        stage_compose(loc, 'core', force='compose' in force)
    if 'grade' in stages:
        stage_grade(loc, force='grade' in force)
    if 'core' in stages:
        stage_core(loc)
        stage_spot(loc)
    if 'plan' in stages:
        stage_plan(loc, 'far', force='plan' in force)
    if 'fetch' in stages:
        stage_fetch(loc, 'far')
    if 'compose' in stages:
        stage_compose(loc, 'far', force='compose' in force)
    if 'far' in stages:
        stage_far(loc)
    log(name, 'stages', stages, 'done in', f'{time.time() - t0:.0f}s')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stage')
    ap.add_argument('--locs', default=','.join(L.LOC_ORDER))
    ap.add_argument('--force', default='')
    a = ap.parse_args()
    names = [n for n in a.locs.split(',') if n]
    force = set(a.force.split(',')) if a.force else set()
    allst = ['plan', 'fetch', 'compose', 'grade', 'core', 'far']
    if a.stage == 'all':
        for n in names:
            run_loc(n, allst, force)
        stage_lowzoom(L.LOC_ORDER)
        v = stage_validate([n for n in L.LOC_ORDER if 'grade' in load_state(n)])
        stage_manifest(L.LOC_ORDER, v)
    elif a.stage in allst:
        for n in names:
            run_loc(n, [a.stage], force)
    elif a.stage == 'spot':
        for n in names:
            stage_spot(Loc(n))
    elif a.stage == 'lowzoom':
        stage_lowzoom(L.LOC_ORDER)
    elif a.stage == 'validate':
        stage_validate(names)
    elif a.stage == 'manifest':
        v = stage_validate([n for n in L.LOC_ORDER if 'grade' in load_state(n)])
        stage_manifest(L.LOC_ORDER, v)
    else:
        raise SystemExit('unknown stage ' + a.stage)


if __name__ == '__main__':
    main()

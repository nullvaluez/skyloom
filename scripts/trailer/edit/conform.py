#!/usr/bin/env python3
"""
Skyloom trailer CONFORM -- renders the trailer (or an excerpt, or review stills) from an EDL JSON.

    python3 conform.py edl.json --out /tmp/claude-0/edit/trailer.mp4
    python3 conform.py edl.json --out /tmp/claude-0/edit/x.mp4 --from 8 --to 20      # excerpt (with audio)
    python3 conform.py edl.json --out /tmp/claude-0/edit/d.mp4 --preview-scale 0.5   # fast half-res draft
    python3 conform.py edl.json --stills 8.2,20.5 --stills-dir /tmp/claude-0/edit/stills
    python3 conform.py edl.json --check                                               # validate + preflight only

Run it under `nice -n 15` on the shared box (it also renices itself; --nice 0 disables that).

The EDL schema is documented in edl.example.json and README.md. Validation is strict: unknown keys,
wrong types, out-of-range values, overlapping clips, transition windows that collide, ... are all
reported at once with their JSON path, and nothing renders. Keys that start with "_" are comments.

Pipeline for one output frame f (t = f / fps). Every frame is a pure function of (EDL, f): excerpts
and stills are bit-identical to the same frames of a full render.
  1. picture: the clip containing t, or a transition between two clips (the outgoing clip keeps
     playing past its t1 for blend transitions). Per clip: source frame (nearest / blended, with the
     NNNNN.dom.png UI overlay alpha-composited over the jpg of the same index) -> upscale (Lanczos4 +
     light unsharp mask when the source is smaller than the output) -> zoom / shake / flip (one cubic
     warp) -> optional radial blur -> per-clip + global grade as ONE per-channel LUT (uint8 -> float32)
     and one 3x3 saturation matrix.
  2. transition effects (flash / whip / dips / glitch_warp) in display-referred float.
  3. global look: halation (screen), vignette, radial chromatic aberration, animated luma grain.
  4. hard-black ranges and global fades (picture layer only).
  5. title overlays (alpha-over, straight or premultiplied, auto-detected per sequence).
  6. letterbox bars -- drawn last, except while an opaque plate (the end card) is up.
Output: raw BGR piped into ffmpeg (libx264 high, yuv420p via an explicit BT.709 matrix, BT.709 tags,
CFR) + AAC 320k of the mix rendered by mix.py (cached by content hash).
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import OrderedDict

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get('FFMPEG') or ('/usr/local/bin/ffmpeg' if os.path.exists('/usr/local/bin/ffmpeg') else 'ffmpeg')
REF_W = 1920  # pixel-valued EDL parameters (letterbox, shake, grain size) are authored at the EDL width

LUMA_RGB = np.array([0.2126, 0.7152, 0.0722])
LUMA_BGR = LUMA_RGB[::-1].copy()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# =====================================================================================================
# small math helpers
# =====================================================================================================
def sstep(e0, e1, x):
    """smoothstep for scalars."""
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def asmooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hash01(*vals):
    """Deterministic 0..1 hash of ints/strings (stable across runs and machines)."""
    h = hashlib.blake2b(repr(vals).encode(), digest_size=8).digest()
    return int.from_bytes(h, 'little') / 2.0 ** 64


def interp_keys(keys, t):
    """Piecewise-linear interpolation over [[t, v], ...] (sorted), constant outside."""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    i = bisect.bisect_right([k[0] for k in keys], t)
    (ta, va), (tb, vb) = keys[i - 1], keys[i]
    return va + (vb - va) * (t - ta) / (tb - ta)


class Param:
    """A scalar that is either constant or clip-relative keyframes [[t, v], ...]."""
    __slots__ = ('const', 'keys')

    def __init__(self, v):
        if isinstance(v, (int, float)):
            self.const, self.keys = float(v), None
        else:
            self.const, self.keys = None, [(float(a), float(b)) for a, b in v]

    def at(self, t):
        return self.const if self.keys is None else interp_keys(self.keys, t)

    @property
    def static(self):
        return self.keys is None


# =====================================================================================================
# EDL validation (strict, collects every error with its JSON path)
# =====================================================================================================
class EDLError(Exception):
    pass


TRANS_TYPES = ('cut', 'fade', 'dip_black', 'dip_white', 'flash', 'whip', 'glitch_warp')
TRANS_DEFAULT_DUR = {'cut': 0.0, 'fade': 0.5, 'dip_black': 0.5, 'dip_white': 0.5, 'flash': 0.3, 'whip': 0.3, 'glitch_warp': 0.4}
OVERLAP_TYPES = ('fade', 'whip', 'glitch_warp')  # both clips render inside the window
WHIP_DIRS = ('left', 'right', 'up', 'down')
# name: (lo, hi, default)
FX_SCALARS = {
    'exposure': (-4.0, 4.0, 0.0), 'contrast': (0.25, 4.0, 1.0), 'sat': (0.0, 3.0, 1.0),
    'temp': (-1.0, 1.0, 0.0), 'tint': (-1.0, 1.0, 0.0), 'lift': (-0.25, 0.25, 0.0),
    'shake': (0.0, 200.0, 0.0), 'blur_radial': (0.0, 1.0, 0.0),
}
FX_KEYS = set(FX_SCALARS) | {'zoom', 'zoom_center', 'flip'}
CLIP_KEYS = {'id', 't0', 't1', 'src', 'in', 'speed', 'blend', 'fx', 'trans_in', 'src_fps', 'enabled', 'label'}
TRANS_KEYS = {'type', 'dur', 'strength', 'dir', 'color'}
TOP_KEYS = {'fps', 'duration', 'size', 'clips', 'title_manifest', 'titles_enabled', 'titles_exclude',
            'black', 'fades', 'global', 'audio'}
GLOBAL_KEYS = {'letterbox', 'grade', 'grain', 'grain_size', 'vignette', 'halation', 'chromatic'}
GRADE_DEFAULTS = {  # the house look; every key optional in the EDL
    'exposure': 0.0, 'contrast': 1.0, 'sat': 0.97, 'temp': 0.0, 'tint': 0.0, 'lift': 0.0,
    'filmic': 1.0,          # 0..1 strength of the gentle S + highlight shoulder
    'split': 0.5,           # 0..1 split-tone amount (teal shadows / warm highlights)
    'shadow_tint': [-0.55, 0.10, 0.45],   # RGB direction added in the shadows
    'highlight_tint': [0.45, 0.05, -0.32],  # RGB direction added in the highlights
    'black': 0.0,           # output black floor (0..0.1)
    'white': None,          # output white (default 1 - 0.025*filmic)
}
GRADE_RANGES = {'exposure': (-3, 3), 'contrast': (0.5, 2.0), 'sat': (0, 2), 'temp': (-1, 1), 'tint': (-1, 1),
                'lift': (-0.2, 0.2), 'filmic': (0, 1.5), 'split': (0, 2), 'black': (0, 0.1), 'white': (0.8, 1.0)}
FADE_KEYS = {'t0', 't1', 'from', 'to', 'curve'}
AUDIO_KEYS = {'music', 'sfx_events', 'sfx_wav', 'music_gain_db', 'sfx_gain_db', 'duck', 'fade_out', 'mix_wav',
              'target_lufs', 'ceiling_dbtp', 'compressor'}


class V:
    """Validation context."""

    def __init__(self):
        self.errors = []
        self.warnings = []

    def err(self, path, msg):
        self.errors.append(f'{path}: {msg}')

    def warn(self, path, msg):
        self.warnings.append(f'{path}: {msg}')

    def keys(self, path, d, allowed, required=()):
        if not isinstance(d, dict):
            self.err(path, f'expected an object, got {type(d).__name__}')
            return False
        for k in d:
            if k.startswith('_'):
                continue
            if k not in allowed:
                close = [a for a in allowed if a.replace('_', '') == k.replace('_', '').lower()]
                self.err(f'{path}.{k}', 'unknown key' + (f' (did you mean "{close[0]}"?)' if close else
                                                        f' (allowed: {", ".join(sorted(allowed))})'))
        for k in required:
            if k not in d:
                self.err(path, f'missing required key "{k}"')
        return True

    def num(self, path, v, lo=None, hi=None, integer=False):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
            self.err(path, f'expected a number, got {json.dumps(v)}')
            return False
        if integer and int(v) != v:
            self.err(path, f'expected an integer, got {v}')
            return False
        if lo is not None and v < lo:
            self.err(path, f'{v} is below the minimum {lo}')
            return False
        if hi is not None and v > hi:
            self.err(path, f'{v} is above the maximum {hi}')
            return False
        return True

    def boolean(self, path, v):
        if not isinstance(v, bool):
            self.err(path, f'expected true/false, got {json.dumps(v)}')
            return False
        return True

    def keyed(self, path, v, lo, hi, what='value', tmax=None):
        """number, or [[t, v], ...] with strictly increasing t."""
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return self.num(path, v, lo, hi)
        if not isinstance(v, list) or not v:
            self.err(path, f'expected a number or a non-empty list of [t, {what}] keys, got {json.dumps(v)[:60]}')
            return False
        ok = True
        last = -1e18
        for i, k in enumerate(v):
            if not (isinstance(k, list) and len(k) == 2):
                self.err(f'{path}[{i}]', f'expected [t, {what}], got {json.dumps(k)[:60]}')
                ok = False
                continue
            if not self.num(f'{path}[{i}][0]', k[0]):
                ok = False
                continue
            if not self.num(f'{path}[{i}][1]', k[1], lo, hi):
                ok = False
            if k[0] <= last:
                self.err(f'{path}[{i}]', f'key times must be strictly increasing ({k[0]} after {last})')
                ok = False
            last = k[0]
            if tmax is not None and k[0] > tmax + 1.0:
                self.err(f'{path}[{i}][0]', f'key time {k[0]} is past the clip end ({tmax:.3f} s) -- '
                                           'key times are CLIP-RELATIVE seconds (0 = the clip\'s t0)')
                ok = False
        return ok


def _abs(base_dir, p):
    if p is None:
        return None
    p = os.path.expanduser(p)
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(base_dir, p))


def load_edl(path, strict_sources=False):
    """Parse + validate an EDL. Returns (edl dict normalized, warnings). Raises EDLError listing every problem."""
    try:
        with open(path) as fh:
            raw = json.load(fh)
    except FileNotFoundError:
        raise EDLError(f'EDL not found: {path}')
    except json.JSONDecodeError as e:
        raise EDLError(f'{path}: invalid JSON at line {e.lineno} col {e.colno}: {e.msg}')
    base = os.path.dirname(os.path.abspath(path))
    v = V()
    if not isinstance(raw, dict):
        raise EDLError(f'{path}: the EDL must be a JSON object')
    v.keys('$', raw, TOP_KEYS, required=('clips',))
    fps = raw.get('fps', 30)
    if not v.num('$.fps', fps, 1, 240, integer=True):
        fps = 30
    dur = raw.get('duration', 104.0)
    if not v.num('$.duration', dur, 0.1, 3600):
        dur = 104.0
    size = raw.get('size', [1920, 1080])
    if not (isinstance(size, list) and len(size) == 2 and all(isinstance(s, int) and not isinstance(s, bool) and 16 <= s <= 8192 and s % 2 == 0 for s in size)):
        v.err('$.size', f'expected [width, height] (even integers, yuv420p), got {json.dumps(size)}')
        size = [1920, 1080]
    fps = int(fps)
    dur = float(dur)
    out = {'fps': fps, 'duration': dur, 'size': tuple(size), 'path': os.path.abspath(path), 'base': base}

    # ---- clips
    clips = []
    rc = raw.get('clips')
    if not isinstance(rc, list):
        v.err('$.clips', 'expected a list')
        rc = []
    ids = set()
    for i, c in enumerate(rc):
        p = f'$.clips[{i}]'
        if isinstance(c, dict) and isinstance(c.get('id'), str):
            p = f'$.clips[{i}]("{c["id"]}")'
        if not v.keys(p, c, CLIP_KEYS, required=('id', 't0', 't1', 'src')):
            continue
        if c.get('enabled', True) is False:
            continue
        cid = c.get('id')
        if not isinstance(cid, str) or not cid:
            v.err(f'{p}.id', 'expected a non-empty string')
        elif cid in ids:
            v.err(f'{p}.id', f'duplicate clip id "{cid}"')
        if isinstance(cid, str):
            ids.add(cid)
        ok = v.num(f'{p}.t0', c.get('t0'), 0, dur) & v.num(f'{p}.t1', c.get('t1'), 0, dur)
        if ok and c['t1'] <= c['t0']:
            v.err(p, f't1 ({c["t1"]}) must be greater than t0 ({c["t0"]})')
            ok = False
        clen = (c['t1'] - c['t0']) if ok else None
        src = c.get('src')
        if not isinstance(src, str) or not src:
            v.err(f'{p}.src', 'expected a path (directory of NNNNN.jpg frames, or a single image file)')
        else:
            src = _abs(base, src)
            if not os.path.exists(src):
                (v.err if strict_sources else v.warn)(f'{p}.src', f'does not exist (yet): {src} -- renders black until frames appear')
        inn = c.get('in', 0)
        v.num(f'{p}.in', inn, 0, 10 ** 7)
        sfps = c.get('src_fps', fps)
        v.num(f'{p}.src_fps', sfps, 1, 1000)
        speed = c.get('speed', 1.0)
        v.keyed(f'{p}.speed', speed, -16.0, 16.0, 'speed', tmax=clen)
        blend = c.get('blend', False)
        v.boolean(f'{p}.blend', blend)
        for k in ('enabled',):
            if k in c:
                v.boolean(f'{p}.{k}', c[k])
        if 'label' in c and not isinstance(c['label'], str):
            v.err(f'{p}.label', 'expected a string')
        # fx
        fx = c.get('fx', {}) or {}
        nfx = {}
        if v.keys(f'{p}.fx', fx, FX_KEYS):
            for k, (lo, hi, dflt) in FX_SCALARS.items():
                val = fx.get(k, dflt)
                if v.keyed(f'{p}.fx.{k}', val, lo, hi, k, tmax=clen):
                    nfx[k] = Param(val)
                else:
                    nfx[k] = Param(dflt)
            z = fx.get('zoom', [1.0, 1.0])
            if isinstance(z, (int, float)) and not isinstance(z, bool):
                z = [z, z]
            if not (isinstance(z, list) and len(z) == 2 and all(isinstance(q, (int, float)) and not isinstance(q, bool) for q in z)):
                v.err(f'{p}.fx.zoom', f'expected [z0, z1] (or one number), got {json.dumps(z)}')
                z = [1.0, 1.0]
            else:
                for j, q in enumerate(z):
                    if not (1.0 <= q <= 8.0):
                        v.err(f'{p}.fx.zoom[{j}]', f'{q} out of range [1.0, 8.0] (zoom < 1 would expose the frame edge)')
            nfx['zoom'] = (float(z[0]), float(z[1]))
            zc = fx.get('zoom_center', [0.5, 0.5])
            if not (isinstance(zc, list) and len(zc) == 2 and all(isinstance(q, (int, float)) and not isinstance(q, bool) and 0 <= q <= 1 for q in zc)):
                v.err(f'{p}.fx.zoom_center', f'expected [x, y] with 0..1 components, got {json.dumps(zc)}')
                zc = [0.5, 0.5]
            nfx['zoom_center'] = (float(zc[0]), float(zc[1]))
            fl = fx.get('flip', False)
            v.boolean(f'{p}.fx.flip', fl)
            nfx['flip'] = bool(fl)
        # transition
        tr = c.get('trans_in', {'type': 'cut'}) or {'type': 'cut'}
        ntr = {'type': 'cut', 'dur': 0.0, 'strength': 1.0, 'dir': 'right', 'color': None}
        if v.keys(f'{p}.trans_in', tr, TRANS_KEYS, required=('type',)):
            ty = tr.get('type')
            if ty not in TRANS_TYPES:
                v.err(f'{p}.trans_in.type', f'unknown transition {json.dumps(ty)} (one of: {", ".join(TRANS_TYPES)})')
            else:
                ntr['type'] = ty
                d = tr.get('dur', TRANS_DEFAULT_DUR[ty])
                if ty == 'cut':
                    d = 0.0
                elif v.num(f'{p}.trans_in.dur', d, 1.0 / fps, 4.0):
                    ntr['dur'] = float(d)
                if 'strength' in tr and v.num(f'{p}.trans_in.strength', tr['strength'], 0, 3):
                    ntr['strength'] = float(tr['strength'])
                if 'dir' in tr:
                    if ty != 'whip':
                        v.err(f'{p}.trans_in.dir', 'only whip transitions take a direction')
                    elif tr['dir'] not in WHIP_DIRS:
                        v.err(f'{p}.trans_in.dir', f'expected one of {WHIP_DIRS}')
                    else:
                        ntr['dir'] = tr['dir']
                if 'color' in tr:
                    col = tr['color']
                    if not (isinstance(col, list) and len(col) == 3 and all(isinstance(q, (int, float)) and 0 <= q <= 1 for q in col)):
                        v.err(f'{p}.trans_in.color', 'expected [r, g, b] with 0..1 components')
                    else:
                        ntr['color'] = [float(q) for q in col]
        if ok and isinstance(cid, str):
            clips.append({'id': cid, 't0': float(c['t0']), 't1': float(c['t1']), 'src': src,
                          'in': float(inn) if isinstance(inn, (int, float)) else 0.0,
                          'src_fps': float(sfps) if isinstance(sfps, (int, float)) else fps,
                          'speed': speed if (isinstance(speed, (int, float)) or isinstance(speed, list)) else 1.0,
                          'blend': bool(blend) if isinstance(blend, bool) else False, 'fx': nfx, 'trans': ntr,
                          'index': i})
    # ordering + windows
    for a, b in zip(clips, clips[1:]):
        if b['t0'] < a['t0']:
            v.err(f'$.clips("{b["id"]}")', f'clips must be sorted by t0 ({b["t0"]} comes after {a["t0"]} of "{a["id"]}")')
        elif b['t0'] < a['t1'] - 1e-9:
            v.err(f'$.clips("{b["id"]}")', f'overlaps "{a["id"]}" ({a["t0"]}-{a["t1"]}); clips must not overlap -- '
                                          'transitions extend the outgoing clip automatically')
    for k, c in enumerate(clips):
        tr = c['trans']
        pre, post = trans_window(tr, fps)
        prev = clips[k - 1] if k else None
        adjacent = prev is not None and abs(prev['t1'] - c['t0']) < 1e-6
        if tr['type'] in OVERLAP_TYPES and not adjacent and prev is not None:
            v.warn(f'$.clips("{c["id"]}").trans_in', f'{tr["type"]} with a gap before it: blends from black')
        if c['t0'] - pre < -1e-9:
            v.err(f'$.clips("{c["id"]}").trans_in', f'window starts before 0 ({c["t0"] - pre:.3f} s)')
        if c['t0'] + post > c['t1'] + 1e-9:
            v.err(f'$.clips("{c["id"]}").trans_in', f'{tr["type"]} window ({post:.3f} s after the cut) is longer than the clip')
        if k + 1 < len(clips):
            n = clips[k + 1]
            npre, _ = trans_window(n['trans'], fps)
            if c['t0'] + post > n['t0'] - npre + 1e-9:
                v.err(f'$.clips("{c["id"]}")', f'its trans_in window ends at {c["t0"] + post:.3f} s but the next '
                                              f'transition ("{n["id"]}") starts at {n["t0"] - npre:.3f} s -- shorten one of them')
        c['pre'], c['post'] = pre, post
        c['prev'] = prev if adjacent else None
        c['next'] = None
    for k, c in enumerate(clips[:-1]):
        n = clips[k + 1]
        if abs(c['t1'] - n['t0']) < 1e-6:
            c['next'] = n
    out['clips'] = clips

    # ---- titles
    tm = raw.get('title_manifest')
    if tm is not None and not isinstance(tm, str):
        v.err('$.title_manifest', 'expected a path')
        tm = None
    te = raw.get('titles_enabled', True)
    v.boolean('$.titles_enabled', te)
    tx = raw.get('titles_exclude', [])
    if not (isinstance(tx, list) and all(isinstance(q, str) for q in tx)):
        v.err('$.titles_exclude', 'expected a list of sequence slugs (e.g. "12_paris")')
        tx = []
    out['title_manifest'] = _abs(base, tm) if tm else None
    out['titles_enabled'] = bool(te) and bool(tm)
    out['titles_exclude'] = set(tx)
    if out['titles_enabled'] and not os.path.exists(out['title_manifest']):
        (v.err if strict_sources else v.warn)('$.title_manifest', f'not found: {out["title_manifest"]} -- no titles')

    # ---- black / fades
    blk = raw.get('black', [])
    out['black'] = []
    if not isinstance(blk, list):
        v.err('$.black', 'expected a list of [t0, t1]')
    else:
        for i, r in enumerate(blk):
            if not (isinstance(r, list) and len(r) == 2) or not (v.num(f'$.black[{i}][0]', r[0], 0, dur) and v.num(f'$.black[{i}][1]', r[1], 0, dur)):
                if not (isinstance(r, list) and len(r) == 2):
                    v.err(f'$.black[{i}]', f'expected [t0, t1], got {json.dumps(r)}')
                continue
            if r[1] <= r[0]:
                v.err(f'$.black[{i}]', 't1 must be greater than t0')
                continue
            out['black'].append((float(r[0]), float(r[1])))
    fades = raw.get('fades', [])
    out['fades'] = []
    if not isinstance(fades, list):
        v.err('$.fades', 'expected a list')
    else:
        for i, fd in enumerate(fades):
            p = f'$.fades[{i}]'
            if not v.keys(p, fd, FADE_KEYS, required=('t0', 't1', 'from', 'to')) or not all(k in fd for k in ('t0', 't1', 'from', 'to')):
                continue
            ok = all([v.num(f'{p}.t0', fd['t0'], 0, dur), v.num(f'{p}.t1', fd['t1'], 0, dur),
                      v.num(f'{p}.from', fd['from'], 0, 1), v.num(f'{p}.to', fd['to'], 0, 1)])
            cv_ = fd.get('curve', 'linear')
            if cv_ not in ('linear', 'smooth'):
                v.err(f'{p}.curve', 'expected "linear" or "smooth"')
            if ok and fd['t1'] <= fd['t0']:
                v.err(p, 't1 must be greater than t0')
                ok = False
            if ok:
                out['fades'].append((float(fd['t0']), float(fd['t1']), float(fd['from']), float(fd['to']), cv_))

    # ---- global look
    gl = raw.get('global', {}) or {}
    ng = {'letterbox': [(0.0, 60.0)], 'grain': 0.35, 'grain_size': 1.0, 'vignette': 0.35, 'halation': 0.25,
          'chromatic': 0.15, 'grade': dict(GRADE_DEFAULTS)}
    if v.keys('$.global', gl, GLOBAL_KEYS):
        if 'letterbox' in gl:
            lb = gl['letterbox']
            if v.keyed('$.global.letterbox', lb, 0, size[1] // 2 - 1, 'px'):
                ng['letterbox'] = [(0.0, float(lb))] if isinstance(lb, (int, float)) else [(float(a), float(b)) for a, b in lb]
        for k, (lo, hi) in (('grain', (0, 1)), ('vignette', (0, 1)), ('halation', (0, 1)), ('chromatic', (0, 1)), ('grain_size', (0.5, 3))):
            if k in gl and v.num(f'$.global.{k}', gl[k], lo, hi):
                ng[k] = float(gl[k])
        gr = gl.get('grade', {}) or {}
        if v.keys('$.global.grade', gr, set(GRADE_DEFAULTS)):
            for k, val in gr.items():
                if k.startswith('_') or k not in GRADE_DEFAULTS:
                    continue
                if k in ('shadow_tint', 'highlight_tint'):
                    if not (isinstance(val, list) and len(val) == 3 and all(isinstance(q, (int, float)) and -1 <= q <= 1 for q in val)):
                        v.err(f'$.global.grade.{k}', 'expected [r, g, b] with -1..1 components')
                    else:
                        ng['grade'][k] = [float(q) for q in val]
                elif k == 'white' and val is None:
                    ng['grade'][k] = None
                elif v.num(f'$.global.grade.{k}', val, *GRADE_RANGES[k]):
                    ng['grade'][k] = float(val)
    out['global'] = ng

    # ---- audio (validated here, rendered by mix.py)
    au = raw.get('audio')
    out['audio'] = None
    if au is not None:
        try:
            import mix as _mix  # noqa
        except Exception:
            sys.path.insert(0, HERE)
            import mix as _mix  # noqa
        errs, warns, norm = _mix.validate_audio(au, base, dur, path='$.audio')
        v.errors += errs
        v.warnings += warns
        out['audio'] = norm
    if v.errors:
        raise EDLError('EDL is invalid (%d problem%s):\n  ' % (len(v.errors), 's' if len(v.errors) > 1 else '') + '\n  '.join(v.errors))
    return out, v.warnings


def trans_window(tr, fps):
    """(pre, post) seconds around the cut at the clip's t0."""
    ty, d = tr['type'], tr['dur']
    if ty == 'cut':
        return 0.0, 0.0
    if ty == 'flash':
        return 2.0 / fps, d          # a 2-frame pre-glow on the outgoing shot, decay over d after the cut
    return d / 2.0, d / 2.0


# =====================================================================================================
# speed integration: timeline seconds -> source frame position
# =====================================================================================================
class SpeedMap:
    def __init__(self, speed, inn, src_fps):
        self.inn, self.sf = float(inn), float(src_fps)
        if isinstance(speed, (int, float)):
            self.keys = [(0.0, float(speed))]
        else:
            self.keys = [(float(a), float(b)) for a, b in speed]
        # cumulative integral at each key, anchored so that I(0) = 0
        self.cum = [0.0]
        for (ta, sa), (tb, sb) in zip(self.keys, self.keys[1:]):
            self.cum.append(self.cum[-1] + 0.5 * (sa + sb) * (tb - ta))
        self.i0 = self._raw(0.0)

    def _raw(self, t):
        k = self.keys
        if t <= k[0][0]:
            return k[0][1] * (t - k[0][0])
        for i in range(len(k) - 1):
            (ta, sa), (tb, sb) = k[i], k[i + 1]
            if t <= tb:
                s_t = sa + (sb - sa) * (t - ta) / (tb - ta)
                return self.cum[i] + 0.5 * (sa + s_t) * (t - ta)
        return self.cum[-1] + k[-1][1] * (t - k[-1][0])

    def pos(self, tl):
        """source frame position at clip-relative time tl (may be < 0 or past the clip end)."""
        return self.inn + self.sf * (self._raw(tl) - self.i0)


# =====================================================================================================
# sources: frame directories written by the capture rig (NNNNN.jpg [+ NNNNN.dom.png])
# =====================================================================================================
FRAME_RE = re.compile(r'^(\d+)\.(jpg|jpeg|png)$')
DOM_RE = re.compile(r'^(\d+)\.dom\.png$')


def detect_premultiplied(bgra):
    """True if the RGBA image looks premultiplied (no colour channel ever exceeds alpha)."""
    a = bgra[..., 3].astype(np.int16)
    m = (a > 0) & (a < 250)
    if not m.any():
        return False
    over = (bgra[..., :3].max(axis=2).astype(np.int16) > a + 2) & m
    return int(over.sum()) < max(3, int(0.0005 * m.sum()))


def alpha_over(dst_u8, src_bgra, premult):
    """In-place alpha-over of an RGBA uint8 image onto a BGR uint8 image of the same size (bbox-limited)."""
    a = src_bgra[..., 3]
    x, y, w, h = cv2.boundingRect(a)
    if w == 0 or h == 0:
        return dst_u8
    s = src_bgra[y:y + h, x:x + w]
    af = s[..., 3:4].astype(np.float32) * (1.0 / 255)
    rgb = s[..., :3].astype(np.float32)
    d = dst_u8[y:y + h, x:x + w].astype(np.float32)
    if premult:
        o = rgb + d * (1 - af)
    else:
        o = rgb * af + d * (1 - af)
    dst_u8[y:y + h, x:x + w] = np.clip(o + 0.5, 0, 255).astype(np.uint8)
    return dst_u8


def resize_rgba(bgra, size):
    """Resize a straight-alpha RGBA image without dark fringes (premultiply, resize, unpremultiply)."""
    a = bgra[..., 3:4].astype(np.float32) / 255
    pm = np.concatenate([bgra[..., :3].astype(np.float32) * a, a * 255], axis=2)
    interp = cv2.INTER_AREA if size[0] < bgra.shape[1] else cv2.INTER_LANCZOS4
    r = cv2.resize(pm, size, interpolation=interp)
    ra = np.clip(r[..., 3:4], 0, 255)
    rgb = np.where(ra > 0.5, r[..., :3] / np.maximum(ra / 255, 1e-6), 0)
    return np.clip(np.concatenate([rgb, ra], axis=2) + 0.5, 0, 255).astype(np.uint8)


def upscale(img, size, sharpen=0.45):
    """High-quality upscale: Lanczos4 + a light unsharp mask (radius scaled to the upscale factor)."""
    f = size[0] / img.shape[1]
    out = cv2.resize(img, size, interpolation=cv2.INTER_LANCZOS4)
    if sharpen > 0 and f >= 1.2:
        sig = 0.55 * f
        bl = cv2.GaussianBlur(out, (0, 0), sig)
        out = cv2.addWeighted(out, 1 + sharpen, bl, -sharpen, 0)
    return out


class Source:
    """One src: a directory of NNNNN.jpg frames (optionally NNNNN.dom.png overlays) or a single image."""
    RESCAN_SEC = 20.0

    def __init__(self, path):
        self.path = path
        self.kind = 'missing'
        self.idx = []
        self.dom = set()
        self.done = False
        self.scanned = 0.0
        self.dom_premult = None
        self.scan()

    def scan(self):
        self.scanned = time.time()
        p = self.path
        if p and os.path.isfile(p):
            self.kind, self.idx = 'file', [0]
            return
        if not p or not os.path.isdir(p):
            self.kind, self.idx = 'missing', []
            return
        self.kind = 'dir'
        idx, dom = [], set()
        now = time.time()
        self.done = os.path.exists(os.path.join(p, 'DONE'))
        with os.scandir(p) as it:
            for e in it:
                m = FRAME_RE.match(e.name)
                if m:
                    if not self.done:
                        try:  # skip a file the capture may still be writing
                            if now - e.stat().st_mtime < 2.0:
                                continue
                        except OSError:
                            continue
                    idx.append(int(m.group(1)))
                    continue
                m = DOM_RE.match(e.name)
                if m:
                    dom.add(int(m.group(1)))
        self.idx = sorted(set(idx))
        self.dom = dom
        self.width = 0

    def maybe_rescan(self):
        if self.kind != 'file' and not self.done and time.time() - self.scanned > self.RESCAN_SEC:
            self.scan()

    def nearest(self, i):
        if not self.idx:
            return None
        k = bisect.bisect_left(self.idx, i)
        if k < len(self.idx) and self.idx[k] == i:
            return i
        cands = [self.idx[j] for j in (k - 1, k) if 0 <= j < len(self.idx)]
        return min(cands, key=lambda q: (abs(q - i), q))

    def bracket(self, pos):
        """available (a, b) with a <= pos <= b when possible."""
        k = bisect.bisect_right(self.idx, pos)
        a = self.idx[k - 1] if k > 0 else None
        b = self.idx[k] if k < len(self.idx) else None
        if a is not None and a == pos:
            return a, a
        return a, b

    def count_in(self, a, b):
        return bisect.bisect_right(self.idx, b) - bisect.bisect_left(self.idx, a)

    def frame_path(self, i):
        if self.kind == 'file':
            return self.path
        for ext in ('jpg', 'jpeg', 'png'):
            q = os.path.join(self.path, f'{i:05d}.{ext}')
            if os.path.exists(q):
                return q
        return os.path.join(self.path, f'{i:05d}.jpg')


class FrameCache:
    def __init__(self, n=10):
        self.n = n
        self.d = OrderedDict()

    def get(self, k):
        v = self.d.get(k)
        if v is not None:
            self.d.move_to_end(k)
        return v

    def put(self, k, v):
        self.d[k] = v
        self.d.move_to_end(k)
        while len(self.d) > self.n:
            self.d.popitem(last=False)


# =====================================================================================================
# grade: per-channel LUT (uint8 -> float32 display 0..1) + saturation matrix
# =====================================================================================================
def srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(v):
    v = np.maximum(v, 0)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def wb_gains(temp, tint):
    """RGB gains in linear light, luma-normalised. temp>0 warm, tint>0 magenta."""
    g = np.array([1 + 0.10 * temp, 1 - 0.08 * tint, 1 - 0.12 * temp])
    return g / float(np.dot(LUMA_RGB, g))


def pivot_contrast(v, c, p=0.46):
    """Endpoint-preserving power S-curve: slope c at the pivot, 0 -> 0, 1 -> 1."""
    lo = p * np.power(np.clip(v / p, 0, None), c)
    hi = 1 - (1 - p) * np.power(np.clip((1 - v) / (1 - p), 0, None), c)
    return np.where(v < p, lo, hi)


def basic_ops(v, ch, e, temp, tint, con, lift):
    if e != 0 or temp != 0 or tint != 0:
        v = np.clip(lin_to_srgb(srgb_to_lin(v) * (2.0 ** e) * wb_gains(temp, tint)[ch]), 0, 1)
    if con != 1:
        v = pivot_contrast(np.clip(v, 0, 1), con)
    if lift > 0:
        v = lift + (1 - lift) * v
    elif lift < 0:
        v = np.clip((v + lift) / (1 + lift), 0, 1)
    return v


def _shoulder_a(r):
    """solve (1 - exp(-a)) / a = r  (r < 1) for a > 0."""
    lo, hi = 1e-6, 60.0
    for _ in range(80):
        m = 0.5 * (lo + hi)
        if (1 - math.exp(-m)) / m > r:
            lo = m
        else:
            hi = m
    return 0.5 * (lo + hi)


def filmic(v, s, white=None, knee=0.76):
    """Gentle display-referred filmic curve (the footage is already ACES tone-mapped by the game):
    a cubic S pivoting low (0.36) so the midtones keep their level, a tiny toe that keeps the deepest
    shadows from crushing, and an exponential highlight shoulder (1.0 -> ~0.975) for a soft roll-off."""
    if s <= 0:
        return v
    a = 0.30 * s
    p = 0.36
    v = v + a * v * (1 - v) * (v - p)
    v = v + (0.005 * s) * (1 - asmooth(0.0, 0.12, v))       # toe: 0 -> 0.005 (about 1.3 code values)
    wt = (1 - 0.025 * s) if white is None else white
    r = (wt - knee) / (1 - knee)
    if r < 0.9999:
        ak = _shoulder_a(r)
        u = np.clip((v - knee) / (1 - knee), 0, None)
        v = np.where(v > knee, knee + (1 - knee) * (1 - np.exp(-ak * u)) / ak, v)
    return v


def build_lut(clip_vals, g):
    """clip_vals: dict exposure/temp/tint/contrast/lift (clip). g: global grade dict. -> (256,1,3) float32 BGR."""
    x = np.arange(256, dtype=np.float64) / 255.0
    chans = []
    st = np.array(g['shadow_tint'])
    ht = np.array(g['highlight_tint'])
    for ch in (2, 1, 0):  # B, G, R  (ch = RGB index)
        v = basic_ops(x, ch, clip_vals['exposure'], clip_vals['temp'], clip_vals['tint'], clip_vals['contrast'], clip_vals['lift'])
        v = basic_ops(v, ch, g['exposure'], g['temp'], g['tint'], g['contrast'], g['lift'])
        v = filmic(np.clip(v, 0, 1), g['filmic'], g['white'])
        if g['split'] > 0:
            sh = asmooth(0.0, 0.07, v) * (1 - asmooth(0.07, 0.38, v))      # true shadows only
            hl = asmooth(0.55, 0.95, v) * (1 - 0.7 * asmooth(0.97, 1.0, v))  # highlights, neutral at white
            v = v + g['split'] * 0.045 * (sh * st[ch] + hl * ht[ch])
        if g['black'] > 0:
            v = g['black'] + (1 - g['black']) * v
        chans.append(np.clip(v, 0, 1))
    return np.stack(chans, axis=1).reshape(256, 1, 3).astype(np.float32)


def sat_matrix(s):
    """3x3 BGR saturation matrix around Rec.709 luma."""
    if abs(s - 1) < 1e-6:
        return None
    L = np.tile(LUMA_BGR, (3, 1))
    return (s * np.eye(3) + (1 - s) * L).astype(np.float32)


# =====================================================================================================
# titles
# =====================================================================================================
class Titles:
    def __init__(self, manifest, W, H, fps, exclude=()):
        self.W, self.H, self.fps = W, H, fps
        self.seqs = []
        if not manifest or not os.path.exists(manifest):
            return
        with open(manifest) as fh:
            m = json.load(fh)
        mdir = os.path.dirname(os.path.abspath(manifest))
        for s in m.get('sequences', []):
            slug = s.get('slug') or os.path.basename(s['dir'])
            if slug in exclude:
                continue
            d = s['dir'] if os.path.isabs(s['dir']) else os.path.join(mdir, s['dir'])
            self.seqs.append({'slug': slug, 'dir': d, 't0': float(s['t0']), 't1': float(s.get('t1', 1e9)),
                              'frames': int(s['frames']), 'fps': float(s.get('fps', fps)),
                              'alpha': bool(s.get('alpha', True)), 'pattern': s.get('pattern', '%04d.png'),
                              'premult': None})

    def active(self, t):
        out = []
        for s in self.seqs:
            if t < s['t0'] - 1e-9 or t >= s['t1'] + 0.5 / self.fps:
                continue
            k = int(round((t - s['t0']) * s['fps']))
            if 0 <= k < s['frames']:
                out.append((s, k))
        return out

    def load(self, s, k):
        p = os.path.join(s['dir'], s['pattern'] % k)
        im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if im is None:
            return None
        if im.ndim == 2:
            im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
        if s['alpha'] and im.shape[2] == 4:
            if s['premult'] is None:
                s['premult'] = detect_premultiplied(im)
            if (im.shape[1], im.shape[0]) != (self.W, self.H):
                if s['premult']:
                    im = cv2.resize(im, (self.W, self.H), interpolation=cv2.INTER_AREA if im.shape[1] > self.W else cv2.INTER_LANCZOS4)
                else:
                    im = resize_rgba(im, (self.W, self.H))
            return im
        im = im[..., :3]
        if (im.shape[1], im.shape[0]) != (self.W, self.H):
            im = cv2.resize(im, (self.W, self.H), interpolation=cv2.INTER_AREA if im.shape[1] > self.W else cv2.INTER_LANCZOS4)
        return im


# =====================================================================================================
# the renderer
# =====================================================================================================
def splitmix(x):
    x = (x + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
    x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    return x ^ (x >> 31)


class Renderer:
    def __init__(self, edl, scale=1.0, prefetch=True):
        self.edl = edl
        self.fps = edl['fps']
        W0, H0 = edl['size']
        self.W = int(round(W0 * scale / 2)) * 2
        self.H = int(round(H0 * scale / 2)) * 2
        self.px = self.W / W0  # EDL px -> output px
        self.nframes = int(round(edl['duration'] * self.fps))
        self.clips = edl['clips']
        self.t0s = [c['t0'] for c in self.clips]
        g = edl['global']
        self.g = g
        self.grade = dict(g['grade'])
        self.sources = {}
        self.cache = FrameCache(12)       # decoded + cover-fit source frames (uint8, output size)
        self.tcache = FrameCache(8)       # decoded title frames
        self.pending = {}                 # key -> (future, frame) decodes running in the prefetch thread
        self.pool = None
        if prefetch:
            from concurrent.futures import ThreadPoolExecutor
            self.pool = ThreadPoolExecutor(max_workers=1)
        self.lut_cache = OrderedDict()
        for c in self.clips:
            c['speedmap'] = SpeedMap(c['speed'], c['in'], c['src_fps'])
            c['phase'] = [hash01(c['id'], j) * 2 * math.pi for j in range(6)]
        self.missing = {}  # clip id -> {'held', 'black', 'maxdist', 'first', 'last'}
        self.titles = Titles(edl['title_manifest'], self.W, self.H, self.fps, edl['titles_exclude']) if edl['titles_enabled'] else None
        self._init_look()

    def close(self):
        if self.pool:
            self.pool.shutdown(wait=False, cancel_futures=True)

    # ------------------------------------------------------------------ look precompute
    def _init_look(self):
        W, H = self.W, self.H
        g = self.g
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        nx = (xx - W / 2) / (W / 2)
        ny = (yy - H / 2) / (H / 2)
        r = np.sqrt(nx * nx + ny * ny) / math.sqrt(2)
        del yy, xx, nx, ny
        A = g['vignette'] * 0.40
        v = (1 - A * np.power(asmooth(0.30, 1.05, r), 1.15)).astype(np.float32)
        self.vig = cv2.merge([v, v, v])   # also carries the *255 quantisation scale (see look())
        del r, v
        # grain fields (deterministic seeds): luma grain, softened to ~1.2 px so H.264 keeps some of it
        self.grain = []
        if g['grain'] > 0:
            self.gm = max(8, int(32 * W / REF_W))
            rng = np.random.default_rng(20260930)
            sig = 0.62 * g['grain_size'] * W / REF_W
            for _ in range(3):
                n = rng.standard_normal((H + 2 * self.gm, W + 2 * self.gm), dtype=np.float32)
                if sig > 0.3:
                    n = cv2.GaussianBlur(n, (0, 0), sig)
                n /= float(n.std())
                self.grain.append(n)
        # chromatic aberration: R scaled out, B scaled in (corner displacement = 6 px * amount at 1080p)
        self.ca = None
        if g['chromatic'] > 0:
            half_diag = math.hypot(W / 2, H / 2)
            s = 6.0 * g['chromatic'] * W / REF_W / half_diag

            def M(sc):
                return np.array([[sc, 0, (1 - sc) * W / 2], [0, sc, (1 - sc) * H / 2]], np.float32)
            self.ca = (M(1 + s), M(1 - s))

    # ------------------------------------------------------------------ sources + prefetch
    def source(self, path):
        s = self.sources.get(path)
        if s is None:
            s = self.sources[path] = Source(path)
        return s

    def _fit(self, img, sharp):
        """cover-fit to the output size: Lanczos4 + light unsharp mask up, INTER_AREA down, centre crop."""
        W, H = self.W, self.H
        h, w = img.shape[:2]
        if (w, h) == (W, H):
            return img
        s = max(W / w, H / h)
        fw, fh = max(W, int(round(w * s))), max(H, int(round(h * s)))
        if s > 1:
            img = upscale(img, (fw, fh), sharpen=0.0 if sharp else 0.45)
        else:
            img = cv2.resize(img, (fw, fh), interpolation=cv2.INTER_AREA)
        if (fw, fh) != (W, H):
            x0, y0 = (fw - W) // 2, (fh - H) // 2
            img = np.ascontiguousarray(img[y0:y0 + H, x0:x0 + W])
        return img

    def _decode(self, src, i):
        """jpg (+ NNNNN.dom.png alpha-over) -> uint8 BGR at output size. Pure; runs in the prefetch thread."""
        img = cv2.imread(src.frame_path(i), cv2.IMREAD_COLOR)
        if img is None:
            return None
        sharp = False
        if src.kind == 'dir' and i in src.dom:
            dom = cv2.imread(os.path.join(src.path, f'{i:05d}.dom.png'), cv2.IMREAD_UNCHANGED)
            if dom is not None and dom.ndim == 3 and dom.shape[2] == 4:
                if src.dom_premult is None:
                    src.dom_premult = detect_premultiplied(dom)
                dh, dw = dom.shape[:2]
                if (dw, dh) != (img.shape[1], img.shape[0]):
                    if dw > img.shape[1]:  # bring the footage up to the UI's resolution first
                        img = upscale(img, (dw, dh))
                        sharp = True
                    elif src.dom_premult:
                        dom = cv2.resize(dom, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_AREA)
                    else:
                        dom = resize_rgba(dom, (img.shape[1], img.shape[0]))
                img = alpha_over(img, dom, src.dom_premult)
        return self._fit(img, sharp)

    def _get(self, cache, key, fn, *args):
        v = cache.get(key)
        if v is not None:
            return v
        p = self.pending.pop(key, None)
        v = p[0].result() if p is not None else fn(*args)
        if v is not None:
            cache.put(key, v)
        return v

    def _load_raw(self, src, i):
        return self._get(self.cache, ('src', src.path, i), self._decode, src, i)

    def title_frame(self, s, k):
        return self._get(self.tcache, ('title', s['slug'], k), self.titles.load, s, k)

    def clips_at(self, t):
        """[(clip, weight_hint)] the picture at t reads from (1 or 2 clips)."""
        k = bisect.bisect_right(self.t0s, t) - 1
        for j in (k + 1, k):
            if 0 <= j < len(self.clips):
                c = self.clips[j]
                if c['trans']['type'] != 'cut' and c['t0'] - c['pre'] - 1e-9 <= t < c['t0'] + c['post'] - 1e-9:
                    if c['trans']['type'] in OVERLAP_TYPES:
                        return [q for q in (c['prev'], c) if q]
                    return [c['prev']] if (t < c['t0'] and c['prev']) else ([] if t < c['t0'] else [c])
        if k >= 0 and t < self.clips[k]['t1'] - 1e-9:
            return [self.clips[k]]
        return []

    def prefetch(self, f):
        """queue decodes for frame f in the background thread (does not change any output)."""
        if not self.pool or not (0 <= f < self.nframes):
            return
        for key in [k for k, (_, ff) in self.pending.items() if ff < f - 2]:
            self.pending.pop(key, None)
        t = f / self.fps
        jobs = []
        overlays = self.titles.active(t) if self.titles else []
        for s, k in overlays:
            jobs.append((self.tcache, ('title', s['slug'], k), self.titles.load, (s, k)))
        if not any(not s['alpha'] for s, _ in overlays) and not self.in_black(t):
            for c in self.clips_at(t):
                src = self.source(c['src'])
                if src.kind == 'missing':
                    continue
                pos = c['speedmap'].pos(t - c['t0'])
                if src.kind == 'file':
                    idx = [0]
                elif c['blend']:
                    idx = [q for q in src.bracket(pos) if q is not None]
                else:
                    idx = [src.nearest(int(round(pos)))]
                for i in idx:
                    if i is not None:
                        jobs.append((self.cache, ('src', src.path, i), self._decode, (src, i)))
        for cache, key, fn, args in jobs:
            if cache.get(key) is None and key not in self.pending:
                self.pending[key] = (self.pool.submit(fn, *args), f)

    def _note_missing(self, cid, want, got):
        m = self.missing.setdefault(cid, {'held': 0, 'black': 0, 'maxdist': 0, 'first': None, 'last': None})
        if got is None:
            m['black'] += 1
        else:
            m['held'] += 1
            m['maxdist'] = max(m['maxdist'], abs(got - want))
        m['first'] = want if m['first'] is None else min(m['first'], want)
        m['last'] = want if m['last'] is None else max(m['last'], want)

    def fetch(self, clip, pos):
        """uint8 BGR frame (output size) for fractional source position pos (nearest or blended); None -> black."""
        src = self.source(clip['src'])
        if src.kind == 'missing':
            src.maybe_rescan()
        if src.kind == 'file':
            return self._load_raw(src, 0)
        want = int(round(pos))
        if not clip['blend'] or abs(pos - want) < 1e-3:
            i = src.nearest(want)
            if i != want:
                src.maybe_rescan()
                i = src.nearest(want)
            if i != want:
                self._note_missing(clip['id'], want, i)
            if i is None:
                return None
            r = self._load_raw(src, i)
            if r is None:  # unreadable / partial file: try the neighbours
                for j in (i - 1, i + 1):
                    if j in src.idx:
                        r = self._load_raw(src, j)
                        if r is not None:
                            break
            return r
        a, b = src.bracket(pos)
        if a is None or b is None or (b - a) > 2:
            src.maybe_rescan()
            a, b = src.bracket(pos)
        if a is None and b is None:
            self._note_missing(clip['id'], want, None)
            return None
        if a is None or b is None or a == b:
            i = a if b is None else b if a is None else a
            if abs(i - pos) >= 1:
                self._note_missing(clip['id'], want, i)
            return self._load_raw(src, i)
        if b - a > 1:
            self._note_missing(clip['id'], want, a if pos - a < b - pos else b)
        ra, rb = self._load_raw(src, a), self._load_raw(src, b)
        if ra is None or rb is None:
            return ra if rb is None else rb
        w = (pos - a) / (b - a)
        return cv2.addWeighted(ra, 1 - w, rb, w, 0)

    # ------------------------------------------------------------------ one clip's frame
    def clip_fx(self, clip, tl):
        fx = clip['fx']
        return {k: fx[k].at(tl) for k in FX_SCALARS}

    def grade_for(self, vals):
        key = tuple(round(vals[k], 5) for k in ('exposure', 'temp', 'tint', 'contrast', 'lift', 'sat'))
        v = self.lut_cache.get(key)
        if v is None:
            lut = build_lut(vals, self.grade)
            M = sat_matrix(vals['sat'] * self.grade['sat'])
            v = (lut, M)
            self.lut_cache[key] = v
            if len(self.lut_cache) > 256:
                self.lut_cache.popitem(last=False)
        return v

    def clip_image(self, clip, t, extra=None, fast=False):
        """Graded float32 BGR image (H, W, 3) for clip at timeline time t, or None (black)."""
        W, H = self.W, self.H
        tl = t - clip['t0']
        pos = clip['speedmap'].pos(tl)
        img = self.fetch(clip, pos)
        if img is None:
            return None
        vals = self.clip_fx(clip, tl)
        fx = clip['fx']
        dur = clip['t1'] - clip['t0']
        z0, z1 = fx['zoom']
        z = z0 + (z1 - z0) * sstep(0.0, 1.0, tl / dur) if z0 != z1 else z0
        cx, cy = fx['zoom_center'][0] * W, fx['zoom_center'][1] * H
        A = np.eye(3)
        if fx['flip']:
            A = np.array([[-1, 0, W - 1], [0, 1, 0], [0, 0, 1.0]]) @ A
        shake = vals['shake'] * self.px
        dx = dy = 0.0
        if shake > 0:
            ph = clip['phase']
            dx = shake * (0.55 * math.sin(2 * math.pi * 1.7 * t + ph[0]) + 0.30 * math.sin(2 * math.pi * 4.3 * t + ph[1]) + 0.15 * math.sin(2 * math.pi * 9.1 * t + ph[2]))
            dy = shake * (0.55 * math.sin(2 * math.pi * 1.3 * t + ph[3]) + 0.30 * math.sin(2 * math.pi * 3.9 * t + ph[4]) + 0.15 * math.sin(2 * math.pi * 8.3 * t + ph[5]))
            z *= 1 + 2.1 * shake / min(W, H)  # overscan so the frame edge never shows
        if z != 1:
            A = np.array([[z, 0, cx * (1 - z)], [0, z, cy * (1 - z)], [0, 0, 1.0]]) @ A
        if dx or dy:
            A = np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1.0]]) @ A
        if extra:
            es, ex, ey = extra
            if es != 1 or ex or ey:
                A = np.array([[es, 0, W / 2 * (1 - es) + ex], [0, es, H / 2 * (1 - es) + ey], [0, 0, 1.0]]) @ A
        if not np.allclose(A, np.eye(3), atol=1e-6):
            img = cv2.warpAffine(img, A[:2], (W, H), flags=cv2.INTER_LINEAR if fast else cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REFLECT101)
        br = vals['blur_radial']
        if br > 0.001:
            img = radial_blur_u8(img, 0.10 * br, n=8 if not fast else 6)
        lut, M = self.grade_for(vals)
        if M is not None:
            img = cv2.transform(img, M)   # saturation on uint8, before the tone curve
        return cv2.LUT(img, lut)

    # ------------------------------------------------------------------ picture at t
    def black(self):
        return np.zeros((self.H, self.W, 3), np.float32)

    def picture(self, t):
        """float32 picture (pre-look) at t, or None for pure black."""
        k = bisect.bisect_right(self.t0s, t) - 1
        # transition windows: the next clip's window may begin before its t0
        for j in (k + 1, k):
            if 0 <= j < len(self.clips):
                c = self.clips[j]
                if c['trans']['type'] != 'cut' and c['t0'] - c['pre'] - 1e-9 <= t < c['t0'] + c['post'] - 1e-9:
                    return self.transition(c, t)
        if k < 0:
            return None
        c = self.clips[k]
        if t >= c['t1'] - 1e-9:
            return None  # gap
        return self.clip_image(c, t)

    def transition(self, c, t):
        tr = c['trans']
        ty, d, st = tr['type'], tr['dur'], tr['strength']
        prev = c['prev']
        fps = self.fps
        A_img = lambda extra=None, fast=False: (self.clip_image(prev, t, extra, fast) if prev else None)
        B_img = lambda extra=None, fast=False: self.clip_image(c, t, extra, fast)
        z = lambda im: im if im is not None else self.black()
        if ty == 'flash':
            if t < c['t0']:
                u = (t - (c['t0'] - c['pre'])) / c['pre']  # 0..1 over the 2 pre-frames
                e = 0.10 + 0.30 * u
                img = z(A_img())
            else:
                u = (t - c['t0']) / d
                e = (1 - u) ** 2.4
                img = z(B_img())
            return flash_fx(img, min(1.0, e * st), tr['color'])
        if ty in ('dip_black', 'dip_white'):
            col = tr['color'] or ([0, 0, 0] if ty == 'dip_black' else [1, 1, 1])
            colv = np.array(col[::-1], np.float32)
            if t < c['t0']:
                m = sstep(c['t0'] - c['pre'], c['t0'], t)
                img = z(A_img())
            else:
                m = 1 - sstep(c['t0'], c['t0'] + c['post'], t)
                img = z(B_img())
            m = min(1.0, m * st) if st != 1 else m
            return img * (1 - m) + colv * m
        x = (t - (c['t0'] - c['pre'])) / (c['pre'] + c['post'])  # 0..1 across the window, cut at 0.5
        if ty == 'fade':
            w = sstep(0.0, 1.0, x)
            a = A_img() if w < 0.999 else None
            b = B_img() if w > 0.001 else None
            if a is None and b is None:
                return None
            return z(a) * (1 - w) + z(b) * w
        if ty == 'whip':
            return whip_fx(self, c, prev, t, x, st, tr['dir'])
        if ty == 'glitch_warp':
            return glitch_warp_fx(self, c, prev, t, x, st, int(round(t * fps)))
        return z(B_img())

    # ------------------------------------------------------------------ global look
    def look(self, img, f, gain=1.0):
        """float32 picture -> uint8: halation, grain, vignette (+ fade gain + quantisation, fused), chromatic aberration."""
        W, H = self.W, self.H
        g = self.g
        q4 = cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        L4 = cv2.cvtColor(q4, cv2.COLOR_BGR2GRAY)
        if g['halation'] > 0:
            # red-orange glow bleeding out of the brightest highlights, computed at quarter res and
            # screen-blended as ONE upsampled delta: img + hal * (1 - img)
            m = np.clip((L4 - 0.72) * (1 / 0.28), 0, 1)
            m *= m
            if float(m.max()) > 1e-3:
                sig = 5.0 * W / REF_W
                m = 0.6 * cv2.GaussianBlur(m, (0, 0), sig) + 0.4 * cv2.GaussianBlur(m, (0, 0), sig * 3.5)
                amt = g['halation'] * 0.55
                hc = cv2.transform(m[:, :, None], np.array([[0.10], [0.36], [1.0]], np.float32) * amt)  # BGR
                delta = cv2.multiply(hc, 1.0 - q4)
                cv2.add(img, cv2.resize(delta, (W, H), interpolation=cv2.INTER_LINEAR), dst=img)
        if self.grain:
            hsh = splitmix(f * 7919 + 17)
            fld = self.grain[f % len(self.grain)]
            ox, oy = hsh % (2 * self.gm), (hsh >> 20) % (2 * self.gm)
            gr = fld[oy:oy + H, ox:ox + W]
            Ls = cv2.resize(L4, (W // 8, H // 8), interpolation=cv2.INTER_AREA)
            # luma-weighted: none on black, full in shadows/mids, about half in the highlights
            wl = np.clip(Ls * 14.0, 0, 1) * (1.0 - 0.5 * asmooth(0.55, 1.0, Ls))
            wl = (wl * (g['grain'] * 0.030)).astype(np.float32)
            gw = cv2.multiply(gr, cv2.resize(wl, (W, H), interpolation=cv2.INTER_LINEAR))
            np.add(img, gw[:, :, None], out=img)
        # vignette * fade gain * 255 -> uint8 in one saturating pass (the grain above dithers it)
        out = cv2.multiply(img, self.vig, scale=255.0 * gain, dtype=cv2.CV_8U)
        if self.ca is not None:
            b, gch, r = cv2.split(out)
            r = cv2.warpAffine(r, self.ca[0], (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            b = cv2.warpAffine(b, self.ca[1], (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            out = cv2.merge([b, gch, r])
        return out

    # ------------------------------------------------------------------ frame
    def in_black(self, t):
        return any(a - 1e-9 <= t < b - 1e-9 for a, b in self.edl['black'])

    def fade_gain(self, t):
        gsum = 1.0
        for a, b, fr, to, curve in self.edl['fades']:
            if t < a:
                continue
            u = 1.0 if t >= b else (t - a) / (b - a)
            if curve == 'smooth':
                u = u * u * (3 - 2 * u)
            gsum *= fr + (to - fr) * u
        return gsum

    def letterbox_px(self, t):
        return int(round(interp_keys(self.g['letterbox'], t) * self.px))

    def render_frame(self, f):
        t = f / self.fps
        W, H = self.W, self.H
        overlays = self.titles.active(t) if self.titles else []
        plate = None
        for s, k in overlays:
            if not s['alpha']:
                plate = (s, k)
        if plate is not None:  # opaque plate (end card): replaces everything, no grade, no bars
            im = self.title_frame(*plate)
            im = np.zeros((H, W, 3), np.uint8) if im is None else im[..., :3].copy()
            for s, k in overlays:
                if s['alpha'] and s['t0'] >= plate[0]['t0']:
                    o = self.title_frame(s, k)
                    if o is not None and o.ndim == 3 and o.shape[2] == 4:
                        alpha_over(im, o, s['premult'])
            return im
        pic = None if self.in_black(t) else self.picture(t)
        gain = self.fade_gain(t)
        if pic is None or gain <= 0:
            out = np.zeros((H, W, 3), np.uint8)
        else:
            out = self.look(pic, f, gain)
        for s, k in overlays:
            o = self.title_frame(s, k)
            if o is not None and o.ndim == 3 and o.shape[2] == 4:
                alpha_over(out, o, s['premult'])
        lb = self.letterbox_px(t)
        if lb > 0:
            out[:lb] = 0
            out[H - lb:] = 0
        return out

    # ------------------------------------------------------------------ preflight
    def preflight(self):
        """Per-clip source coverage report. Returns (lines, problems)."""
        lines, problems = [], 0
        fps = self.fps
        for c in self.clips:
            sm = c['speedmap']
            pre = c['pre'] if c['trans']['type'] in OVERLAP_TYPES else 0.0
            n = c['next']
            post = (n['post'] if n and n['trans']['type'] in OVERLAP_TYPES else 0.0)
            ts = np.arange(c['t0'] - pre, c['t1'] + post - 1e-9, 1.0 / fps)
            ps = [sm.pos(t - c['t0']) for t in ts]
            lo, hi = min(ps), max(ps)
            src = self.source(c['src'])
            need = sorted(set(int(round(p)) for p in ps))
            if src.kind == 'file':
                status, have = 'still image', len(need)
            elif src.kind == 'missing':
                status, have = 'MISSING DIR -> black', 0
            else:
                have = sum(1 for q in need if q in set(src.idx[bisect.bisect_left(src.idx, need[0]):bisect.bisect_right(src.idx, need[-1])]))
                status = 'ok' if have == len(need) else f'{len(need) - have} missing -> hold nearest' if src.idx else 'EMPTY -> black'
            if lo < -0.5:
                status += f' | pre-roll needs frame {lo:.1f} < 0 (holds first frame)'
            if status != 'ok':
                problems += 1
            ext = []
            if pre:
                ext.append(f'pre {pre:.2f}s')
            if post:
                ext.append(f'post {post:.2f}s')
            lines.append(f'  {c["id"]:<18} {c["t0"]:6.2f}-{c["t1"]:6.2f}  {c["trans"]["type"]:<11} src frames {lo:7.1f}..{hi:7.1f}'
                         f' ({len(need)} needed{", " + ", ".join(ext) if ext else ""}; {have} present{" DONE" if src.done else ""})  {status}'
                         f'  [{os.path.basename(c["src"] or "")}]')
        return lines, problems


# =====================================================================================================
# effects
# =====================================================================================================
def radial_blur_u8(img, span, n=8, center=None):
    """Zoom blur: average of n copies scaled 1..1+span about the centre. uint8 in/out."""
    H, W = img.shape[:2]
    cx, cy = (W / 2, H / 2) if center is None else center
    acc = img.astype(np.float32)
    for k in range(1, n):
        s = 1 + span * k / (n - 1)
        M = np.array([[s, 0, cx * (1 - s)], [0, s, cy * (1 - s)]], np.float32)
        cv2.accumulate(cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT101), acc)
    return cv2.multiply(acc, (1.0 / n,) * 4, dtype=cv2.CV_8U)


def radial_blur_f(img, span, n=8):
    H, W = img.shape[:2]
    acc = img.copy()
    for k in range(1, n):
        s = 1 + span * k / (n - 1)
        M = np.array([[s, 0, W / 2 * (1 - s)], [0, s, H / 2 * (1 - s)]], np.float32)
        acc += cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT101)
    acc *= 1.0 / n
    return acc


def bloom_of(img, thr=0.55):
    H, W = img.shape[:2]
    sm = cv2.resize(img, (W // 8, H // 8), interpolation=cv2.INTER_AREA)
    hi = np.clip((sm - thr) * (1 / (1 - thr)), 0, 1)
    hi = cv2.GaussianBlur(hi, (0, 0), 3.0 * W / REF_W * 1.0 + 2.0)
    return cv2.resize(hi, (W, H), interpolation=cv2.INTER_LINEAR)


def screen(img, layer):
    return img + layer - img * layer


def flash_fx(img, e, color=None):
    """Additive white bloom: highlights bloom first, then the whole frame washes toward (warm) white."""
    if e <= 0.002:
        return img
    col = np.array((color or [1.0, 0.975, 0.93])[::-1], np.float32)
    bl = bloom_of(img)
    layer = bl * (1.4 * e) + col * (0.80 * e ** 1.3)
    return screen(img, np.clip(layer, 0, 1))


def dir_blur(img, L, horizontal=True):
    L = int(L)
    if L < 3:
        return img
    L |= 1
    k = (L, 1) if horizontal else (1, L)
    img = cv2.blur(img, k, borderType=cv2.BORDER_REFLECT101)
    k2 = ((L // 2) | 1, 1) if horizontal else (1, (L // 2) | 1)
    return cv2.blur(img, k2, borderType=cv2.BORDER_REFLECT101)


def whip_fx(R, c, prev, t, x, st, direction):
    """Whip pan: both shots slide + smear along the whip direction, a quick swap at the cut."""
    W, H = R.W, R.H
    b = math.sin(math.pi * x) ** 1.5 * st           # blur envelope, peaks at the cut
    w = sstep(0.40, 0.60, x)                         # A -> B swap, hidden inside the peak smear
    horiz = direction in ('left', 'right')
    sgn = 1 if direction in ('right', 'down') else -1
    span = (W if horiz else H) * 0.22
    zoom = 1 + 0.06 * b
    out = None
    if w < 0.999:
        oa = sgn * span * (min(x, 0.5) / 0.5) ** 2
        a = R.clip_image(prev, t, (zoom, oa if horiz else 0, 0 if horiz else oa), fast=True) if prev else None
        a = R.black() if a is None else a
        a = dir_blur(a, b * 0.14 * (W if horiz else H), horiz)
        out = a * (1 - w)
    if w > 0.001:
        ob = -sgn * span * (min(1 - x, 0.5) / 0.5) ** 2
        bb = R.clip_image(c, t, (zoom, ob if horiz else 0, 0 if horiz else ob), fast=True)
        bb = R.black() if bb is None else bb
        bb = dir_blur(bb, b * 0.14 * (W if horiz else H), horiz)
        out = bb * w if out is None else out + bb * w
    return out


def glitch_warp_fx(R, c, prev, t, x, st, f):
    """Hyperspace warp: accelerating rush + radial light streaks + chromatic split + glitch slices + white flash."""
    W, H = R.W, R.H
    p = math.sin(math.pi * x) ** 1.2 * st
    w = sstep(0.44, 0.56, x)
    parts = None
    if w < 0.999:
        za = 1 + 0.35 * (min(x, 0.5) / 0.5) ** 2
        a = R.clip_image(prev, t, (za, 0, 0), fast=True) if prev else None
        a = R.black() if a is None else a
        parts = a * (1 - w)
    if w > 0.001:
        zb = 1 + 0.30 * (min(1 - x, 0.5) / 0.5) ** 2
        bb = R.clip_image(c, t, (zb, 0, 0), fast=True)
        bb = R.black() if bb is None else bb
        parts = bb * w if parts is None else parts + bb * w
    img = parts
    if p > 0.01:
        img = radial_blur_f(img, 0.22 * p, n=10)
        hi = np.clip((img - 0.50) * 2.5, 0, 1)
        streak = radial_blur_f(hi, 0.50 * p, n=12)
        tint = np.array([1.0, 0.92, 0.78], np.float32)  # BGR: cool blue-white
        img = screen(img, np.clip(streak * tint * (1.3 * p), 0, 1))
        # chromatic split (radial): R out, B in
        s = 0.018 * p
        bch, gch, rch = cv2.split(img)
        Mr = np.array([[1 + s, 0, -s * W / 2], [0, 1 + s, -s * H / 2]], np.float32)
        Mb = np.array([[1 - s, 0, s * W / 2], [0, 1 - s, s * H / 2]], np.float32)
        rch = cv2.warpAffine(rch, Mr, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT101)
        bch = cv2.warpAffine(bch, Mb, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT101)
        img = cv2.merge([bch, gch, rch])
        # glitch slices near the peak
        if p > 0.45:
            nb = 7
            for k in range(nb):
                h1 = hash01('gw', f, k)
                h2 = hash01('gw2', f, k)
                y0 = int(h1 * H)
                bh = max(2, int((0.01 + 0.05 * h2) * H))
                off = int((hash01('gw3', f, k) - 0.5) * 0.10 * W * p)
                y1 = min(H, y0 + bh)
                img[y0:y1] = np.roll(img[y0:y1], off, axis=1)
                if k % 2 == 0:
                    img[y0:y1, :, 2] = np.roll(img[y0:y1, :, 2], int(off * 0.3) + 6, axis=1)
    e = math.exp(-((x - 0.5) / 0.085) ** 2) * 0.92 * st
    if e > 0.002:
        img = screen(img, np.full_like(img[:1, :1], 1.0) * np.array([0.97, 0.985, 1.0], np.float32) * e)
    return img


# =====================================================================================================
# audio + encode
# =====================================================================================================
def ensure_mix(edl, cache_dir):
    """Render (or reuse) the final mix for the EDL's audio section. Returns (wav path, report)."""
    au = edl['audio']
    if au is None:
        return None, None
    if au.get('mix_wav'):
        return au['mix_wav'], {'mix_wav': au['mix_wav'], 'note': 'pre-rendered mix used as-is'}
    sys.path.insert(0, HERE)
    import mix
    key = mix.cache_key(au, edl['duration'])
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, f'mix-{key}.wav')
    rep_path = out + '.json'
    if os.path.exists(out) and os.path.exists(rep_path):
        with open(rep_path) as fh:
            return out, json.load(fh)
    for fn in os.listdir(cache_dir):  # keep one cached mix on this tight disk
        if fn.startswith('mix-') and not fn.startswith(f'mix-{key}'):
            try:
                os.unlink(os.path.join(cache_dir, fn))
            except OSError:
                pass
    log(f'[audio] rendering mix -> {out}')
    rep = mix.render_mix(au, edl['duration'], out, log=lambda *a: log('[audio]', *a))
    with open(rep_path, 'w') as fh:
        json.dump(rep, fh, indent=1)
    return out, rep


def ffmpeg_cmd(out, W, H, fps, t_from, dur, wav, preset, crf, threads=None):
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
           '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-framerate', str(fps), '-i', 'pipe:0']
    if wav:
        cmd += ['-ss', f'{t_from:.6f}', '-t', f'{dur:.6f}', '-i', wav]
    cmd += ['-map', '0:v:0']
    if wav:
        cmd += ['-map', '1:a:0']
    cmd += ['-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+bicubic,format=yuv420p',
            '-c:v', 'libx264', '-preset', preset, '-crf', str(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
            '-x264-params', 'aq-mode=3',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
            '-r', str(fps), '-fps_mode', 'cfr']
    if threads:
        cmd += ['-threads', str(threads)]
    if wav:
        cmd += ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2']
    cmd += ['-t', f'{dur:.6f}', '-movflags', '+faststart', out]
    return cmd


def main(argv=None):
    ap = argparse.ArgumentParser(description='Skyloom trailer conform: EDL JSON -> graded, titled H.264 trailer.')
    ap.add_argument('edl')
    ap.add_argument('--out', default='/tmp/claude-0/edit/trailer.mp4')
    ap.add_argument('--from', dest='t_from', type=float, default=None, help='excerpt start (timeline seconds)')
    ap.add_argument('--to', dest='t_to', type=float, default=None, help='excerpt end (timeline seconds, exclusive)')
    ap.add_argument('--preview-scale', type=float, default=1.0, help='e.g. 0.5 for a fast half-res draft')
    ap.add_argument('--stills', default=None, help='comma list of timeline seconds: dump PNG stills (no video)')
    ap.add_argument('--stills-dir', default=None, help='default: <out dir>/stills')
    ap.add_argument('--stills-with-video', action='store_true', help='with --stills: also render the video, dumping the stills on the way')
    ap.add_argument('--no-audio', action='store_true')
    ap.add_argument('--check', action='store_true', help='validate + source preflight only')
    ap.add_argument('--strict', action='store_true', help='missing sources / frames are errors')
    ap.add_argument('--preset', default=None, help='x264 preset (default slow; veryfast for preview-scale < 1)')
    ap.add_argument('--crf', type=float, default=None, help='x264 CRF (default 14; 18 for preview-scale < 1)')
    ap.add_argument('--threads', type=int, default=2, help='OpenCV worker threads (default 2; the box is shared)')
    ap.add_argument('--x264-threads', type=int, default=None)
    ap.add_argument('--nice', type=int, default=15, help='renice this process (and ffmpeg) by N (0 = leave)')
    ap.add_argument('--cache-dir', default=None, help='audio mix cache (default <out dir>/.cache)')
    a = ap.parse_args(argv)
    if a.nice:
        try:
            os.nice(a.nice)
        except OSError:
            pass
    cv2.setNumThreads(max(1, a.threads))
    try:
        edl, warns = load_edl(a.edl, strict_sources=a.strict)
    except EDLError as e:
        log(str(e))
        return 2
    for w in warns:
        log('warning:', w)
    if not (0.1 <= a.preview_scale <= 1.0):
        log('--preview-scale must be in 0.1..1.0')
        return 2
    R = Renderer(edl, a.preview_scale)
    lines, problems = R.preflight()
    log(f'[preflight] {len(edl["clips"])} clips, {R.nframes} frames @ {R.fps} fps, output {R.W}x{R.H}'
        f'{" (preview x%.2f)" % a.preview_scale if a.preview_scale != 1 else ""}; titles: '
        f'{len(R.titles.seqs) if R.titles else 0} sequences')
    for ln in lines:
        log(ln)
    if R.titles:
        modes = {}
        for s in R.titles.seqs:
            if not os.path.isdir(s['dir']):
                log(f'  title {s["slug"]}: directory missing -> skipped')
                continue
            if not s['alpha']:
                modes.setdefault('opaque plate (replaces picture, no bars)', []).append(s['slug'])
                continue
            im = cv2.imread(os.path.join(s['dir'], s['pattern'] % (s['frames'] // 2)), cv2.IMREAD_UNCHANGED)
            if im is None or im.ndim != 3 or im.shape[2] != 4:
                modes.setdefault('NO ALPHA CHANNEL (skipped)', []).append(s['slug'])
                continue
            s['premult'] = detect_premultiplied(im)
            modes.setdefault('premultiplied alpha' if s['premult'] else 'straight alpha', []).append(s['slug'])
        for m, lst in modes.items():
            log(f'  titles, {m}: {len(lst)} ({", ".join(lst[:4])}{", ..." if len(lst) > 4 else ""})')
    if a.check:
        return 1 if (problems and a.strict) else 0
    if problems and a.strict:
        log(f'--strict: {problems} clip(s) with missing sources')
        return 3
    out_dir = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(out_dir, exist_ok=True)
    stills_dir = a.stills_dir or os.path.join(out_dir, 'stills')
    fps = R.fps
    t_start = time.time()
    report = {'edl': edl['path'], 'out': None, 'size': [R.W, R.H], 'fps': fps}

    stills = []
    if a.stills:
        try:
            stills = [float(q) for q in a.stills.split(',') if q.strip()]
        except ValueError:
            log('--stills: expected comma-separated seconds')
            return 2
        os.makedirs(stills_dir, exist_ok=True)
    still_frames = {}
    for s in stills:
        f = int(round(s * fps))
        if not (0 <= f < R.nframes):
            log(f'--stills: {s} s is outside the timeline')
            return 2
        still_frames[f] = os.path.join(stills_dir, f'still_{s:07.3f}s_f{f:05d}.png')

    if stills and not a.stills_with_video:
        for f in sorted(still_frames):
            t1 = time.time()
            img = R.render_frame(f)
            cv2.imwrite(still_frames[f], img)
            log(f'[still] t={f / fps:.3f}s f={f} -> {still_frames[f]} ({(time.time() - t1) * 1000:.0f} ms)')
        report_missing(R)
        return 0

    f0 = 0 if a.t_from is None else int(round(a.t_from * fps))
    f1 = R.nframes if a.t_to is None else int(round(a.t_to * fps))
    f0, f1 = max(0, f0), min(R.nframes, f1)
    if f1 <= f0:
        log('empty frame range')
        return 2
    n = f1 - f0
    wav, arep = (None, None)
    if not a.no_audio and edl['audio']:
        try:
            wav, arep = ensure_mix(edl, a.cache_dir or os.path.join(out_dir, '.cache'))
        except Exception as e:  # never lose a picture render to an audio problem
            log(f'[audio] FAILED ({e!r}) -- encoding without audio')
            wav = None
        if arep:
            report['audio'] = {k: arep.get(k) for k in ('integrated_lufs', 'true_peak_dbtp', 'sample_peak_dbfs', 'duration_s', 'mix_wav') if k in arep}
    preview = a.preview_scale < 1
    preset = a.preset or ('veryfast' if preview else 'slow')
    crf = a.crf if a.crf is not None else (18 if preview else 14)
    tmp_out = a.out + '.partial.mp4'
    cmd = ffmpeg_cmd(tmp_out, R.W, R.H, fps, f0 / fps, n / fps, wav, preset, crf, a.x264_threads)
    log('[encode]', ' '.join(cmd))
    errlog = open(a.out + '.ffmpeg.log', 'w')
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=errlog)
    rt = 0.0
    try:
        for i, f in enumerate(range(f0, f1)):
            t1 = time.time()
            R.prefetch(f + 1)
            img = R.render_frame(f)
            rt += time.time() - t1
            if f in still_frames:
                cv2.imwrite(still_frames[f], img)
            proc.stdin.write(memoryview(np.ascontiguousarray(img)).cast('B'))
            if (i + 1) % 30 == 0 or i + 1 == n:
                el = time.time() - t_start
                log(f'[render] {i + 1}/{n} t={f / fps:7.2f}s  {(i + 1) / el:5.2f} fps wall, {(i + 1) / rt:5.2f} fps render-only, eta {(n - i - 1) * el / (i + 1):6.0f}s')
        proc.stdin.close()
    except BrokenPipeError:
        pass
    ret = proc.wait()
    errlog.close()
    R.close()
    if ret != 0:
        log(f'ffmpeg failed ({ret}); see {a.out}.ffmpeg.log')
        return 4
    os.replace(tmp_out, a.out)
    try:
        if os.path.getsize(a.out + '.ffmpeg.log') == 0:
            os.unlink(a.out + '.ffmpeg.log')
    except OSError:
        pass
    el = time.time() - t_start
    report.update({'out': a.out, 'frames': n, 'from_s': f0 / fps, 'to_s': f1 / fps, 'wall_s': round(el, 1),
                   'render_fps': round(n / max(rt, 1e-6), 2), 'wall_fps': round(n / el, 2), 'preset': preset, 'crf': crf,
                   'missing': R.missing})
    with open(a.out + '.report.json', 'w') as fh:
        json.dump(report, fh, indent=1)
    log(f'[done] {a.out}  {n} frames in {el:.1f}s ({n / el:.2f} fps wall; render-only {n / max(rt, 1e-6):.2f} fps)')
    report_missing(R)
    return 0


def report_missing(R):
    if not R.missing:
        return
    log('[missing source frames] (held nearest / black):')
    for cid, m in R.missing.items():
        log(f'  {cid:<18} held {m["held"]} (max {m["maxdist"]} frames away), black {m["black"]}, wanted range {m["first"]}..{m["last"]}')


if __name__ == '__main__':
    sys.exit(main())

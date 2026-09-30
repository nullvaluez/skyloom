#!/usr/bin/env python3
"""
Skyloom trailer MIX -- final stereo mix: music + SFX stem, ducking, glue compressor, loudness
normalisation and a true-peak limiter. 48 kHz / 24-bit WAV of EXACTLY the timeline duration.

    python3 mix.py edl.json --out /tmp/claude-0/edit/mix.wav              # reads the EDL's "audio" block
    python3 mix.py --music score.wav --sfx-wav sfx.wav --out mix.wav \
        --sfx-gain-db -4 --duck 8.0,9.0,-4 --duck 94.0,94.6,-12,range --fade-out 102,104
    python3 mix.py --music score.wav --sfx-events sfx_events.json --out mix.wav   # renders the SFX stem via sfx.py

Signal flow
  music * music_gain * duck(t)  +  sfx * sfx_gain                       (float32, 48 kHz stereo)
  -> fade_out (cosine to silence, zero after)
  -> glue compressor: stereo-linked RMS (10 ms), soft knee, attack/release ballistics at 1 ms control rate
  -> loudness gain to target_lufs (ITU-R BS.1770-4 integrated, pyloudnorm)
  -> true-peak limiter: 4x-oversampled peak detection, ~1.5 ms look-ahead, smooth attack, 80 ms release;
     loudness gain re-solved after limiting (iterates to +-0.05 LU)
  -> exact length, PCM_24 WAV, and a JSON report (<out>.json) with the MEASURED values.

"audio" block (EDL) / mix config keys:
  music          path (required)                 sfx_events  path to an sfx.py events JSON (rendered + cached)
  sfx_wav        path to a pre-rendered stem      (sfx_events wins if both are given; the stem file is never overwritten)
  music_gain_db  0     sfx_gain_db -4
  duck           [[t0, t1, db], ...]  music-only gain dips (db < 0). 4th element / "mode":
                   "range"     (default) static dip, 80 ms cosine attack before t0, 350 ms release after t1
                   "sidechain" the dip follows the SFX stem's envelope inside the range (full depth when the
                               SFX is within 6 dB of its loudest moment in that range, none 26 dB below it)
                 or objects {"t0", "t1", "db", "mode", "attack", "release"} (attack/release in seconds)
  fade_out       [t0, t1]  cosine fade of the whole mix to silence
  target_lufs    -14       ceiling_dbtp -1.0
  compressor     {"enabled": true, "threshold_db": -14, "ratio": 1.6, "attack_ms": 30, "release_ms": 250, "knee_db": 6}
  mix_wav        (conform.py only) use this finished mix as-is
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time

import numpy as np
import soundfile as sf
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
SFX_PY = os.path.normpath(os.path.join(HERE, '..', 'audio', 'sfx.py'))
AUDIO_KEYS = {'music', 'sfx_events', 'sfx_wav', 'music_gain_db', 'sfx_gain_db', 'duck', 'fade_out', 'mix_wav',
              'target_lufs', 'ceiling_dbtp', 'compressor'}
COMP_DEFAULTS = {'enabled': True, 'threshold_db': -14.0, 'ratio': 1.6, 'attack_ms': 30.0, 'release_ms': 250.0, 'knee_db': 6.0}
DUCK_MODES = ('range', 'sidechain')


def _log(*a):
    print(*a, file=sys.stderr, flush=True)


# =====================================================================================================
# validation (shared with conform.py)
# =====================================================================================================
def _isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_audio(au, base, duration, path='audio'):
    """-> (errors, warnings, normalized dict)."""
    errs, warns = [], []
    norm = {'music': None, 'sfx_events': None, 'sfx_wav': None, 'music_gain_db': 0.0, 'sfx_gain_db': -4.0,
            'duck': [], 'fade_out': None, 'mix_wav': None, 'target_lufs': -14.0, 'ceiling_dbtp': -1.0,
            'compressor': dict(COMP_DEFAULTS)}
    if not isinstance(au, dict):
        return [f'{path}: expected an object'], warns, norm

    def P(p):
        if p is None:
            return None
        p = os.path.expanduser(p)
        return p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))

    for k in au:
        if not k.startswith('_') and k not in AUDIO_KEYS:
            errs.append(f'{path}.{k}: unknown key (allowed: {", ".join(sorted(AUDIO_KEYS))})')
    for k in ('music', 'sfx_events', 'sfx_wav', 'mix_wav'):
        if k in au and au[k] is not None:
            if not isinstance(au[k], str) or not au[k]:
                errs.append(f'{path}.{k}: expected a path or null')
            else:
                norm[k] = P(au[k])
                if not os.path.exists(norm[k]):
                    warns.append(f'{path}.{k}: not found (yet): {norm[k]}')
    if norm['music'] is None and norm['mix_wav'] is None:
        errs.append(f'{path}.music: required (or give mix_wav)')
    if norm['sfx_events'] and norm['sfx_wav']:
        warns.append(f'{path}: both sfx_events and sfx_wav given -- sfx_events is rendered, sfx_wav ignored')
    for k, lo, hi in (('music_gain_db', -60, 24), ('sfx_gain_db', -60, 24), ('target_lufs', -40, -5), ('ceiling_dbtp', -12, 0)):
        if k in au:
            if not _isnum(au[k]) or not (lo <= au[k] <= hi):
                errs.append(f'{path}.{k}: expected a number in [{lo}, {hi}], got {json.dumps(au[k])}')
            else:
                norm[k] = float(au[k])
    dk = au.get('duck', []) or []
    if not isinstance(dk, list):
        errs.append(f'{path}.duck: expected a list of [t0, t1, db] (or objects)')
        dk = []
    for i, d in enumerate(dk):
        p = f'{path}.duck[{i}]'
        e = {'mode': 'range', 'attack': 0.08, 'release': 0.35}
        if isinstance(d, list):
            if len(d) not in (3, 4) or not all(_isnum(q) for q in d[:3]):
                errs.append(f'{p}: expected [t0, t1, db] or [t0, t1, db, mode], got {json.dumps(d)}')
                continue
            e.update(t0=float(d[0]), t1=float(d[1]), db=float(d[2]))
            if len(d) == 4:
                e['mode'] = d[3]
        elif isinstance(d, dict):
            bad = [k for k in d if not k.startswith('_') and k not in ('t0', 't1', 'db', 'mode', 'attack', 'release')]
            if bad:
                errs.append(f'{p}: unknown key(s) {bad}')
                continue
            if not all(_isnum(d.get(k)) for k in ('t0', 't1', 'db')):
                errs.append(f'{p}: t0, t1 and db are required numbers')
                continue
            e.update({k: d[k] for k in d if not k.startswith('_')})
            for k in ('attack', 'release'):
                if not _isnum(e[k]) or not (0.001 <= e[k] <= 5):
                    errs.append(f'{p}.{k}: expected seconds in [0.001, 5]')
        else:
            errs.append(f'{p}: expected [t0, t1, db] or an object')
            continue
        if e['mode'] not in DUCK_MODES:
            errs.append(f'{p}: mode must be one of {DUCK_MODES}, got {json.dumps(e["mode"])}')
            continue
        if not (0 <= e['t0'] < e['t1'] <= duration + 1e-9):
            errs.append(f'{p}: need 0 <= t0 < t1 <= {duration}')
            continue
        if not (-60 <= e['db'] <= 0):
            errs.append(f'{p}: db is the (negative) music gain change, in [-60, 0]; got {e["db"]}')
            continue
        norm['duck'].append(e)
    fo = au.get('fade_out')
    if fo is not None:
        if not (isinstance(fo, list) and len(fo) == 2 and all(_isnum(q) for q in fo) and 0 <= fo[0] < fo[1] <= duration + 1e-9):
            errs.append(f'{path}.fade_out: expected [t0, t1] inside the timeline, got {json.dumps(fo)}')
        else:
            norm['fade_out'] = (float(fo[0]), float(fo[1]))
    cp = au.get('compressor')
    if cp is not None:
        if not isinstance(cp, dict):
            errs.append(f'{path}.compressor: expected an object')
        else:
            rng = {'threshold_db': (-40, 0), 'ratio': (1, 10), 'attack_ms': (0.5, 500), 'release_ms': (10, 3000), 'knee_db': (0, 24)}
            for k, v in cp.items():
                if k.startswith('_'):
                    continue
                if k == 'enabled':
                    if not isinstance(v, bool):
                        errs.append(f'{path}.compressor.enabled: expected true/false')
                    else:
                        norm['compressor']['enabled'] = v
                elif k in rng:
                    if not _isnum(v) or not (rng[k][0] <= v <= rng[k][1]):
                        errs.append(f'{path}.compressor.{k}: expected a number in {list(rng[k])}')
                    else:
                        norm['compressor'][k] = float(v)
                else:
                    errs.append(f'{path}.compressor.{k}: unknown key')
    return errs, warns, norm


def _file_sig(p):
    try:
        st = os.stat(p)
        return [p, st.st_size, int(st.st_mtime)]
    except OSError:
        return [p, None]


def cache_key(au, duration):
    h = hashlib.sha1()
    h.update(json.dumps(au, sort_keys=True, default=list).encode())
    h.update(str(duration).encode())
    for k in ('music', 'sfx_events', 'sfx_wav'):
        if au.get(k):
            h.update(json.dumps(_file_sig(au[k])).encode())
    with open(os.path.abspath(__file__), 'rb') as fh:
        h.update(fh.read())
    if au.get('sfx_events'):
        h.update(json.dumps(_file_sig(SFX_PY)).encode())
    return h.hexdigest()[:12]


# =====================================================================================================
# DSP
# =====================================================================================================
def load_wav(path, sr=SR):
    x, fs = sf.read(path, dtype='float32', always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    elif x.shape[1] > 2:
        x = x[:, :2]
    if fs != sr:
        g = math.gcd(int(fs), sr)
        x = resample_poly(x, sr // g, int(fs) // g, axis=0).astype(np.float32)
    return np.ascontiguousarray(x)


def fit_len(x, n):
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros((n - len(x), x.shape[1]), np.float32)])


def db2lin(db):
    return 10.0 ** (db / 20.0)


def _cos_ramp(n):
    return (0.5 - 0.5 * np.cos(np.linspace(0, math.pi, n))).astype(np.float32) if n > 0 else np.zeros(0, np.float32)


def block_power(x, B):
    n = len(x) // B * B
    p = (x[:n] ** 2).mean(axis=1).reshape(-1, B).mean(axis=1)
    if n < len(x):
        p = np.append(p, (x[n:] ** 2).mean())
    return p


def smooth_ballistics(target_db, att_coef, rel_coef):
    """one-pole smoothing of a gain-reduction curve (dB, <= 0): attack when reduction increases."""
    y = np.empty_like(target_db)
    s = 0.0
    tl = target_db.tolist()
    for i, g in enumerate(tl):
        if g < s:
            s = att_coef * s + (1 - att_coef) * g
        else:
            s = rel_coef * s + (1 - rel_coef) * g
        y[i] = s
    return y


def duck_curve(n, ducks, sfx):
    g = np.ones(n, np.float32)
    B = 48  # 1 ms control blocks for sidechain mode
    for d in ducks:
        depth = db2lin(d['db'])
        a0 = max(0, int(round((d['t0'] - d['attack']) * SR)))
        a1 = int(round(d['t0'] * SR))
        r0 = int(round(d['t1'] * SR))
        r1 = min(n, int(round((d['t1'] + d['release']) * SR)))
        win = np.zeros(r1 - a0, np.float32)   # 0..1 range window (ramps at the edges)
        win[a1 - a0:r0 - a0] = 1
        win[:a1 - a0] = _cos_ramp(a1 - a0)
        win[r0 - a0:] = 1 - _cos_ramp(r1 - r0)
        if d['mode'] == 'range' or sfx is None:
            curve = 1 - win * (1 - depth)
        else:
            seg = sfx[a0:r1]
            p = uniform_filter1d(block_power(seg, B), size=10)          # ~10 ms RMS
            lv = 10 * np.log10(p + 1e-12)
            core = lv[max(0, (a1 - a0) // B):max(1, (r0 - a0) // B)]
            ref = float(core.max()) if len(core) else float(lv.max())
            amt = np.clip((lv - (ref - 26.0)) / 20.0, 0, 1)
            gr = (d['db'] * amt).astype(np.float64)
            gr = smooth_ballistics(gr, math.exp(-1 / (0.010 * 1000)), math.exp(-1 / (0.200 * 1000)))
            gs = np.interp(np.arange(r1 - a0), (np.arange(len(gr)) + 0.5) * B, gr)
            curve = db2lin(gs * win).astype(np.float32)
        g[a0:r1] = np.minimum(g[a0:r1], curve)
    return g


def compress(x, c):
    """stereo-linked RMS glue compressor at a 1 ms control rate. returns (y, max_gr_db)."""
    B = 48
    p = uniform_filter1d(block_power(x, B), size=10)
    lv = 10 * np.log10(p + 1e-12)
    thr, ratio, knee = c['threshold_db'], c['ratio'], c['knee_db']
    over = lv - thr
    slope = 1.0 / ratio - 1.0
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, slope * over, slope * (over + knee / 2) ** 2 / (2 * max(knee, 1e-6))))
    att = math.exp(-1.0 / max(c['attack_ms'], 0.5))
    rel = math.exp(-1.0 / max(c['release_ms'], 1.0))
    gs = smooth_ballistics(gr.astype(np.float64), att, rel)
    gain = db2lin(np.interp(np.arange(len(x)), (np.arange(len(gs)) + 0.5) * B, gs)).astype(np.float32)
    return x * gain[:, None], float(-gs.min()) if len(gs) else 0.0


def true_peak_env(x, os_=4, chunk=SR * 4):
    """per-sample true-peak magnitude (max over channels of the 4x-oversampled signal)."""
    n = len(x)
    out = np.empty(n, np.float32)
    pad = 64
    for s in range(0, n, chunk):
        a, b = max(0, s - pad), min(n, s + chunk + pad)
        up = resample_poly(x[a:b], os_, 1, axis=0)
        m = np.abs(up).max(axis=1)
        m = m[: (b - a) * os_].reshape(b - a, os_).max(axis=1)
        out[s:min(n, s + chunk)] = m[s - a:s - a + min(chunk, n - s)]
    return np.maximum(out, np.abs(x).max(axis=1))


def true_peak_db(x):
    return 20 * math.log10(float(true_peak_env(x).max()) + 1e-12)


def limit(x, ceiling_db, lookahead_ms=1.5, release_ms=80.0):
    """look-ahead true-peak limiter. returns (y, max_gr_db, active_ms)."""
    c = db2lin(ceiling_db)
    tp = true_peak_env(x)
    req = np.minimum(1.0, c / np.maximum(tp, 1e-9)).astype(np.float64)
    B = 16
    nb = -(-len(req) // B)
    padn = nb * B - len(req)
    gb = np.concatenate([req, np.ones(padn)]).reshape(nb, B).min(axis=1)
    Wn = max(2, int(math.ceil(lookahead_ms * SR / 1000 / B)))
    gmin = minimum_filter1d(gb, size=2 * Wn + 1, mode='nearest')
    gma = uniform_filter1d(gmin, size=Wn, mode='nearest')     # smooth attack; still <= req (window < min radius)
    coef = 1 - math.exp(-B / (release_ms / 1000 * SR))
    g = np.empty(nb)
    s = 1.0
    for i, v in enumerate(gma.tolist()):
        s = s + (1 - s) * coef
        if v < s:
            s = v
        g[i] = s
    gain = np.interp(np.arange(len(x)), (np.arange(nb) + 0.5) * B, g)
    gain = np.minimum(gain, req)  # belt and braces (a no-op by construction)
    y = (x * gain[:, None]).astype(np.float32)
    return y, float(-20 * math.log10(max(g.min(), 1e-9))), float((g < 0.999).sum() * B / SR * 1000)


def loudness(x):
    import pyloudnorm as pyln
    m = pyln.Meter(SR)
    return float(m.integrated_loudness(x.astype(np.float64)))


def render_sfx(events, duration, cache_dir, log=_log):
    h = hashlib.sha1()
    with open(events, 'rb') as fh:
        h.update(fh.read())
    h.update(json.dumps(_file_sig(SFX_PY)).encode())
    h.update(str(duration).encode())
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, f'sfx-{h.hexdigest()[:12]}.wav')
    if os.path.exists(out):
        return out
    for fn in os.listdir(cache_dir):
        if fn.startswith('sfx-'):
            try:
                os.unlink(os.path.join(cache_dir, fn))
            except OSError:
                pass
    cmd = ['nice', '-n', '15', sys.executable, SFX_PY, events, out + '.tmp.wav', '--duration', str(duration)]
    log('rendering SFX stem:', ' '.join(cmd))
    t = time.time()
    r = subprocess.run(cmd, cwd=os.path.dirname(SFX_PY), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'sfx.py failed ({r.returncode}):\n{r.stderr[-2000:]}')
    os.replace(out + '.tmp.wav', out)
    for ext in ('.json',):
        if os.path.exists(out + '.tmp.wav' + ext):
            os.replace(out + '.tmp.wav' + ext, out + ext)
    log(f'SFX stem rendered in {time.time() - t:.1f}s')
    return out


def render_mix(au, duration, out_wav, log=_log, cache_dir=None):
    t_start = time.time()
    n = int(round(duration * SR))
    if not au.get('music') or not os.path.exists(au['music']):
        raise FileNotFoundError(f'music not found: {au.get("music")}')
    music = fit_len(load_wav(au['music']), n)
    sfx = None
    sfx_src = None
    if au.get('sfx_events'):
        sfx_src = render_sfx(au['sfx_events'], duration, cache_dir or os.path.join(os.path.dirname(os.path.abspath(out_wav)), '.cache'), log)
    elif au.get('sfx_wav'):
        sfx_src = au['sfx_wav']
        if not os.path.exists(sfx_src):
            log(f'warning: sfx_wav not found ({sfx_src}) -- mixing music only')
            sfx_src = None
    if sfx_src:
        sfx = fit_len(load_wav(sfx_src), n) * np.float32(db2lin(au.get('sfx_gain_db', -4.0)))
    music *= np.float32(db2lin(au.get('music_gain_db', 0.0)))
    if au.get('duck'):
        music *= duck_curve(n, au['duck'], sfx)[:, None]
    mixb = music if sfx is None else music + sfx
    del music
    pre_lufs = loudness(mixb)
    if au.get('fade_out'):
        a, b = au['fade_out']
        ia, ib = int(round(a * SR)), min(n, int(round(b * SR)))
        mixb[ia:ib] *= (1 - _cos_ramp(ib - ia))[:, None]
        mixb[ib:] = 0
    comp = au.get('compressor') or COMP_DEFAULTS
    comp_gr = 0.0
    if comp.get('enabled', True):
        mixb, comp_gr = compress(mixb, {**COMP_DEFAULTS, **comp})
    target, ceil = au.get('target_lufs', -14.0), au.get('ceiling_dbtp', -1.0)
    L0 = loudness(mixb)
    gain_db = target - L0
    internal_ceil = ceil - 0.1
    y = None
    for it in range(6):
        y, lim_gr, lim_ms = limit(mixb * np.float32(db2lin(gain_db)), internal_ceil)
        L = loudness(y)
        tp = true_peak_db(y)
        log(f'  pass {it + 1}: gain {gain_db:+.2f} dB -> {L:.2f} LUFS, {tp:.2f} dBTP (limiter max GR {lim_gr:.2f} dB, active {lim_ms:.0f} ms)')
        if tp > ceil:
            internal_ceil -= (tp - ceil) + 0.02
            continue
        if abs(L - target) < 0.05:
            break
        gain_db += target - L
    tp = true_peak_db(y)
    if tp > ceil:  # last resort trim (should not happen)
        y *= np.float32(db2lin(ceil - tp - 0.01))
    y = fit_len(y, n)
    os.makedirs(os.path.dirname(os.path.abspath(out_wav)) or '.', exist_ok=True)
    sf.write(out_wav, y, SR, subtype='PCM_24')
    # measure what was written
    yw, _ = sf.read(out_wav, dtype='float32', always_2d=True)
    rep = {'mix_wav': os.path.abspath(out_wav), 'sr': SR, 'channels': 2, 'subtype': 'PCM_24',
           'samples': int(len(yw)), 'duration_s': len(yw) / SR,
           'integrated_lufs': round(loudness(yw), 2), 'true_peak_dbtp': round(true_peak_db(yw), 2),
           'sample_peak_dbfs': round(20 * math.log10(float(np.abs(yw).max()) + 1e-12), 2),
           'target_lufs': target, 'ceiling_dbtp': ceil, 'pre_master_lufs': round(pre_lufs, 2),
           'loudness_gain_db': round(gain_db, 2), 'compressor_max_gr_db': round(comp_gr, 2),
           'limiter_max_gr_db': round(lim_gr, 2), 'limiter_active_ms': round(lim_ms, 1),
           'inputs': {'music': au.get('music'), 'sfx': sfx_src, 'music_gain_db': au.get('music_gain_db', 0.0),
                      'sfx_gain_db': au.get('sfx_gain_db', -4.0), 'duck': au.get('duck'), 'fade_out': au.get('fade_out')},
           'render_s': round(time.time() - t_start, 1)}
    # loudness per 8 s window, handy for feedback on the balance over time
    win = []
    for s in range(0, len(yw), 8 * SR):
        seg = yw[s:s + 8 * SR]
        if len(seg) > SR:
            lv = loudness(seg)
            win.append([round(s / SR, 1), round(lv, 1) if math.isfinite(lv) else None])
    rep['lufs_per_8s'] = win
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser(description='Skyloom trailer final mix (music + SFX, ducking, glue comp, -14 LUFS, -1 dBTP).')
    ap.add_argument('config', nargs='?', help='EDL JSON (uses its "audio" block + duration) or a bare audio-config JSON')
    ap.add_argument('--out', required=True)
    ap.add_argument('--music')
    ap.add_argument('--sfx-events')
    ap.add_argument('--sfx-wav')
    ap.add_argument('--music-gain-db', type=float)
    ap.add_argument('--sfx-gain-db', type=float)
    ap.add_argument('--duck', action='append', default=None, help='t0,t1,db[,mode]  (repeatable; replaces the config list)')
    ap.add_argument('--fade-out', help='t0,t1')
    ap.add_argument('--duration', type=float, default=None, help='default: EDL duration or 104.0')
    ap.add_argument('--target-lufs', type=float)
    ap.add_argument('--ceiling', type=float, help='true-peak ceiling dBTP (default -1)')
    ap.add_argument('--no-comp', action='store_true')
    ap.add_argument('--report', help='JSON report path (default <out>.json)')
    ap.add_argument('--nice', type=int, default=15)
    a = ap.parse_args(argv)
    if a.nice:
        try:
            os.nice(a.nice)
        except OSError:
            pass
    raw, base, duration = {}, os.getcwd(), 104.0
    if a.config:
        with open(a.config) as fh:
            cfg = json.load(fh)
        base = os.path.dirname(os.path.abspath(a.config))
        if 'audio' in cfg:
            raw = dict(cfg['audio'] or {})
            duration = float(cfg.get('duration', duration))
        else:
            raw = cfg
    if a.duration:
        duration = a.duration
    for k, v in (('music', a.music), ('sfx_events', a.sfx_events), ('sfx_wav', a.sfx_wav),
                 ('music_gain_db', a.music_gain_db), ('sfx_gain_db', a.sfx_gain_db),
                 ('target_lufs', a.target_lufs), ('ceiling_dbtp', a.ceiling)):
        if v is not None:
            raw[k] = os.path.abspath(v) if k in ('music', 'sfx_events', 'sfx_wav') else v
    if a.duck is not None:
        dl = []
        for d in a.duck:
            parts = d.split(',')
            try:
                e = [float(q) for q in parts[:3]]
            except ValueError:
                ap.error(f'--duck {d}: expected t0,t1,db[,mode]')
            dl.append(e + parts[3:4])
        raw['duck'] = dl
    if a.fade_out:
        raw['fade_out'] = [float(q) for q in a.fade_out.split(',')]
    if a.no_comp:
        raw['compressor'] = {'enabled': False}
    errs, warns, norm = validate_audio(raw, base, duration)
    for w in warns:
        _log('warning:', w)
    if errs:
        _log('audio config invalid:\n  ' + '\n  '.join(errs))
        return 2
    rep = render_mix(norm, duration, a.out)
    rp = a.report or a.out + '.json'
    with open(rp, 'w') as fh:
        json.dump(rep, fh, indent=1)
    _log(f'[mix] {a.out}: {rep["duration_s"]:.3f} s, {rep["integrated_lufs"]} LUFS integrated, '
         f'{rep["true_peak_dbtp"]} dBTP, sample peak {rep["sample_peak_dbfs"]} dBFS '
         f'(comp max GR {rep["compressor_max_gr_db"]} dB, limiter max GR {rep["limiter_max_gr_db"]} dB) -> report {rp}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

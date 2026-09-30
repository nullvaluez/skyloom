#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Objective verification for a trailer audio file (stem or mix).

    python3 analyze.py in.wav --cues ../cuesheet.json [--meta in.wav.json] [--labels demo.wav.json]
                       --out /tmp/claude-0/audio/qa/name [--zoom 6 18 --zoom 88 100]

Writes <out>.png (overview: waveform, loudness, log-frequency spectrogram, stereo correlation, with
section shading, cue-sheet hits and event ticks), <out>_zoom_<a>-<b>.png, and <out>_report.json, and
prints a summary: integrated loudness (pyloudnorm), sample / true peak, DC, clipping, per-section
level, onset timing of every onset/peak-anchored event in the stem, boundary-click check, and
mono compatibility.
"""
import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import uniform_filter1d
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sfx  # noqa: E402  (shares the K-weighting / loudness helpers)

import matplotlib  # noqa: E402
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402

SURF, INK, INK2, MUTED = '#fcfcfb', '#0b0b0b', '#52514e', '#9a9994'
S1, S2, S3, S7 = '#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'


def load(path):
    x, sr = sf.read(path, always_2d=True)
    assert sr == sfx.SR, f'expected {sfx.SR} Hz, got {sr}'
    return x.T.astype(float), sr


def db(x):
    return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def corr_curve(st, win=0.4, hop=0.1, sr=48000):
    L = sfx.filt(st[0], 'highpass', 60, 2)
    R = sfx.filt(st[1], 'highpass', 60, 2)
    w, h = int(win * sr), int(hop * sr)
    s = np.arange(0, max(1, len(L) - w), h)
    cL = np.concatenate([[0], np.cumsum(L * L)])
    cR = np.concatenate([[0], np.cumsum(R * R)])
    cLR = np.concatenate([[0], np.cumsum(L * R)])
    num = cLR[s + w] - cLR[s]
    den = np.sqrt((cL[s + w] - cL[s]) * (cR[s + w] - cR[s])) + 1e-20
    en = (cL[s + w] - cL[s] + cR[s + w] - cR[s]) / w
    r = num / den
    r[en < 1e-9] = np.nan          # silence: undefined
    return r, (s + w / 2) / sr


def onset_in_stem(st, t, sr, kind, peak_win=0.05):
    """Measure the anchor of an event in the finished stem near its cue time t."""
    n = st.shape[1]
    a = int(round(t * sr))
    if kind == 'onset':
        # spectral-flux onset (log-compressed magnitude, 1024-pt Hann, 1 ms hop) within +-60 ms of the cue.
        # Independent of how sfx.py placed the event; catches sub-bass onsets that a broadband
        # envelope misses when something else is already loud.
        lo, hi = max(0, a - int(0.12 * sr)), min(n, a + int(0.12 * sr))
        x = st[:, lo:hi].mean(axis=0)
        nfft, hop = 1024, 48
        f, tt, Z = signal.stft(x, fs=sr, window='hann', nperseg=nfft, noverlap=nfft - hop, boundary='zeros', padded=True)
        M = np.log1p(1000.0 * np.abs(Z))
        flux = np.sum(np.maximum(M[:, 1:] - M[:, :-1], 0.0), axis=0)
        tf = tt[1:] - hop / (2 * sr) + nfft / (4 * sr)   # a Hann frame 'sees' an onset ~nfft/4 before its centre (calibrated on isolated renders)
        sel = np.abs(tf + lo / sr - t) <= 0.06
        return lo / sr + tf[sel][int(np.argmax(flux[sel]))]
    if kind == 'peak':
        hw = 0.15 if (peak_win or 0.05) <= 0.03 else 0.4       # whooshes: +-150 ms; flybys: +-400 ms
        lo, hi = max(0, a - int(hw * sr)), min(n, a + int(hw * sr))
        e = sfx.smooth_env(st[:, lo:hi], peak_win or 0.05)
        return (lo + int(np.argmax(e))) / sr
    if kind == 'end':
        e = sfx.smooth_env(st, 0.001)
        lo, hi = max(0, a - int(0.3 * sr)), min(n, a + int(0.1 * sr))
        seg = e[lo:hi]
        d = np.diff(seg)
        return (lo + int(np.argmin(d)) + 1) / sr    # the steepest drop = the hard stop
    return None


def boundary_click(st, t, sr):
    """HF (>6 kHz) energy in a 2 ms window at t versus the surrounding +-20 ms, dB."""
    hp = sfx.filt(st, 'highpass', 6000.0, 4)
    p = np.sum(hp * hp, axis=0)
    a = int(round(t * sr))
    w, W = int(0.001 * sr), int(0.02 * sr)
    if a - W < 0 or a + W >= len(p):
        return None
    inner = p[a - w:a + w].mean() + 1e-20
    outer = np.concatenate([p[a - W:a - 3 * w], p[a + 3 * w:a + W]]).mean() + 1e-20
    return float(10 * np.log10(inner / outer))


def discontinuities(st, sr, thresh=12.0):
    """Sample-level discontinuities: |2nd difference| far above its local RMS."""
    out = []
    for ch in range(st.shape[0]):
        d2 = np.abs(np.diff(st[ch], 2))
        loc = np.sqrt(uniform_filter1d(d2 ** 2, int(0.01 * sr), mode='nearest')) + 1e-9
        idx = np.nonzero((d2 > thresh * loc) & (d2 > 10 ** (-50 / 20)))[0]
        out += [(i + 1) / sr for i in idx]
    return sorted(out)


def spectro(ax, x, sr, t0, t1, nfft=4096, hop=1024, vmin=-110, vmax=-20):
    f, t, Z = signal.stft(x, fs=sr, nperseg=nfft, noverlap=nfft - hop, boundary=None, padded=False)
    S = 20 * np.log10(np.abs(Z) * 2 + 1e-12)          # scipy scales by the window sum: sine amp A -> A
    ax.pcolormesh(t + t0, f, S, shading='auto', cmap='magma', vmin=vmin, vmax=vmax, rasterized=True)
    ax.set_yscale('log')
    ax.set_ylim(25, 20000)
    ax.set_xlim(t0, t1)
    ax.set_ylabel('Hz', color=INK2)


def style(ax):
    ax.set_facecolor(SURF)
    for s in ('top', 'right'):
        ax.spines[s].set_visible(False)
    for s in ('left', 'bottom'):
        ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=INK2, labelsize=8)
    ax.grid(True, color='#e6e5e1', lw=0.6)
    ax.set_axisbelow(True)


def overlays(axes, t0, t1, cues, events, labels, top_ax):
    if cues:
        for k, s in enumerate(cues['sections']):
            if s['t1'] < t0 or s['t0'] > t1:
                continue
            for ax in axes:
                if k % 2 == 0:
                    ax.axvspan(max(s['t0'], t0), min(s['t1'], t1), color='#efeee9', zorder=0, lw=0)
                ax.axvline(s['t0'], color=MUTED, lw=0.8, zorder=1)
            top_ax.text((max(s['t0'], t0) + min(s['t1'], t1)) / 2, 1.02, s['id'], transform=top_ax.get_xaxis_transform(),
                        ha='center', va='bottom', fontsize=8, color=INK2)
        for h in cues['hits']:
            if t0 <= h['t'] <= t1:
                for ax in axes:
                    ax.axvline(h['t'], color=S7, lw=0.9, ls=(0, (4, 2)), zorder=3)
    if events:
        for e in events:
            if e.get('kind') == 'cut' or not (t0 <= e['t'] <= t1):
                continue
            top_ax.plot([e['t']], [0.0], marker='v', color=S2, ms=4, transform=top_ax.get_xaxis_transform(), clip_on=False)
    if labels:
        for k, lab in enumerate(labels):
            if lab['t1'] < t0 or lab['t0'] > t1:
                continue
            for ax in axes:
                ax.axvspan(lab['t0'], lab['t1'], color='#efeee9' if k % 2 else '#f6f5f1', zorder=0, lw=0)
                ax.axvline(lab['anchor_s'], color=S7, lw=0.8, ls=(0, (4, 2)), zorder=3)
            top_ax.text((lab['t0'] + lab['t1']) / 2, 1.02 + 0.09 * (k % 2), lab['label'].split(' (')[0],
                        transform=top_ax.get_xaxis_transform(), ha='center', va='bottom', fontsize=7, color=INK2)


def plot(st, sr, t0, t1, path, cues, events, labels, title):
    a, b = int(t0 * sr), int(t1 * sr)
    x = st[:, a:b]
    fig, axes = plt.subplots(4, 1, figsize=(18, 11), sharex=True,
                             gridspec_kw={'height_ratios': [1.1, 1.0, 1.9, 0.6]}, facecolor=SURF)
    for ax in axes:
        style(ax)
    # 1 waveform (min/max per column), L up / R down mirrored as two traces
    cols = 3000
    step = max(1, x.shape[1] // cols)
    m = x.shape[1] // step * step
    tt = t0 + (np.arange(m // step) * step + step / 2) / sr
    for ch, col, lab in ((0, S1, 'L'), (1, S2, 'R')):
        blk = x[ch, :m].reshape(-1, step)
        axes[0].fill_between(tt, blk.min(1), blk.max(1), color=col, alpha=0.55, lw=0, label=lab)
    axes[0].set_ylim(-1, 1)
    axes[0].set_ylabel('amplitude', color=INK2)
    axes[0].legend(loc='upper right', fontsize=8, frameon=False, ncol=2)
    # 2 loudness
    Mm, tm = sfx.loudness_curve(x, 0.4, 0.05 if (t1 - t0) > 3 else 0.005)
    Ms, ts = sfx.loudness_curve(x, 3.0, 0.1)
    axes[1].plot(tm + t0, Mm, color=S1, lw=1.0, label='momentary (400 ms)')
    axes[1].plot(ts + t0, Ms, color=S2, lw=1.6, label='short-term (3 s)')
    axes[1].set_ylim(-60, max(-5, np.nanmax(Mm) + 3))
    axes[1].set_ylabel('LUFS', color=INK2)
    axes[1].legend(loc='upper right', fontsize=8, frameon=False, ncol=2)
    # 3 spectrogram (mid)
    span = t1 - t0
    nfft = 4096 if span > 20 else (2048 if span > 3 else 512)
    spectro(axes[2], x.mean(axis=0), sr, t0, t1, nfft=nfft, hop=nfft // 4)
    # 4 correlation
    r, tr = corr_curve(x, win=0.4 if span > 3 else 0.02, hop=0.1 if span > 3 else 0.005, sr=sr)
    axes[3].plot(tr + t0, r, color=S3, lw=1.0)
    axes[3].axhline(0, color=MUTED, lw=0.8)
    axes[3].set_ylim(-1, 1)
    axes[3].set_ylabel('L/R corr', color=INK2)
    axes[3].set_xlabel('seconds', color=INK2)
    axes[3].set_xlim(t0, t1)
    overlays(axes, t0, t1, cues, events, labels, axes[0])
    fig.suptitle(title, x=0.01, ha='left', color=INK, fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(path, dpi=90, facecolor=SURF)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav')
    ap.add_argument('--cues')
    ap.add_argument('--meta', help='sidecar json written by sfx.py (event anchors)')
    ap.add_argument('--labels', help='demo sidecar json (labelled segments)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--zoom', nargs=2, type=float, action='append', default=[])
    ap.add_argument('--title', default=None)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    st, sr = load(a.wav)
    n = st.shape[1]
    dur = n / sr
    cues = json.load(open(a.cues)) if a.cues else None
    meta = json.load(open(a.meta)) if a.meta else (json.load(open(a.wav + '.json')) if os.path.exists(a.wav + '.json') else None)
    events = meta.get('events') if meta and 'events' in meta else None
    labels = json.load(open(a.labels))['labels'] if a.labels else (meta.get('labels') if meta and 'labels' in meta else None)

    import pyloudnorm as pyln
    meter = pyln.Meter(sr)
    rep = {'file': a.wav, 'duration_s': round(dur, 3), 'sr': sr, 'channels': st.shape[0]}
    rep['integrated_lufs'] = round(float(meter.integrated_loudness(st.T)), 2)
    mono = 0.5 * (st[0] + st[1])
    rep['mono_dualmono_lufs'] = round(float(meter.integrated_loudness(np.stack([mono, mono]).T)), 2)
    rep['mono_minus_stereo_db'] = round(rep['mono_dualmono_lufs'] - rep['integrated_lufs'], 2)
    rep['sample_peak_dbfs'] = round(float(db(np.max(np.abs(st)))), 2)
    rep['true_peak_dbtp'] = round(float(db(np.max(np.abs(resample_poly(st, 4, 1, axis=1))))), 2)
    rep['dc_offset'] = [float(f'{v:.2e}') for v in st.mean(axis=1)]
    rep['clipped_samples'] = int(np.sum(np.abs(st) >= 0.9999))
    Ms, ts = sfx.loudness_curve(st, 3.0, 0.1)
    rep['max_short_term_lufs'] = round(float(Ms.max()), 2)
    r, tr = corr_curve(st, sr=sr)
    rep['corr_min'] = round(float(np.nanmin(r)), 3) if np.any(~np.isnan(r)) else None
    rep['corr_mean'] = round(float(np.nanmean(r)), 3) if np.any(~np.isnan(r)) else None
    rep['corr_pct_negative'] = round(float(np.mean(r[~np.isnan(r)] < 0) * 100), 1) if np.any(~np.isnan(r)) else None
    Mm, tm = sfx.loudness_curve(st, 0.4, 0.05)
    Mmono, _ = sfx.loudness_curve(np.stack([mono, mono]), 0.4, 0.05)
    loud = Mm > (Mm.max() - 30)
    rep['mono_loss_worst_db'] = round(float(np.min((Mmono - Mm)[loud])), 2)
    rep['mono_loss_worst_t'] = round(float(tm[loud][np.argmin((Mmono - Mm)[loud])]), 2)

    if cues:
        secs = []
        for s in cues['sections']:
            i0, i1 = int(s['t0'] * sr), min(n, int(s['t1'] * sr))
            seg = st[:, i0:i1]
            sel = (tm >= s['t0']) & (tm < s['t1'])
            secs.append({'id': s['id'], 't0': s['t0'], 't1': s['t1'],
                         'rms_dbfs': round(float(db(np.sqrt(np.mean(seg ** 2) + 1e-20))), 1),
                         'mom_mean_lufs': round(float(np.mean(Mm[sel])), 1) if sel.any() else None,
                         'mom_max_lufs': round(float(np.max(Mm[sel])), 1) if sel.any() else None})
        rep['sections'] = secs
        # silence after the final cut
        cut = next((h['t'] for h in cues['hits'] if h['kind'] == 'cut_to_silence'), None)
        if cut:
            for w0, w1 in ((cut + 0.05, cut + 0.5), (cut + 0.5, cut + 1.5), (cut + 1.5, dur)):
                seg = st[:, int(w0 * sr):int(w1 * sr)]
                rep.setdefault('after_cut', []).append({'window': [round(w0, 2), round(w1, 2)],
                                                        'peak_dbfs': round(float(db(np.max(np.abs(seg)) if seg.size else 0)), 1)})
    if events:
        timing, clicks = [], []
        for e in events:
            if e.get('kind') == 'cut':
                continue
            if e.get('anchor') in ('onset', 'peak', 'end'):
                m = onset_in_stem(st, float(e['t']), sr, e['anchor'], e.get('peak_win'))
                timing.append({'i': e['i'], 'kind': e['kind'], 't': e['t'], 'anchor': e['anchor'],
                               'stem_err_ms': round((m - float(e['t'])) * 1000, 1),
                               'isolated_err_ms': e.get('isolated_anchor_err_ms'),
                               'dominance_db': e.get('dominance_db')})
            for bt in (e['start_s'], e['end_s']):
                c = boundary_click(st, bt, sr)
                if c is not None:
                    clicks.append({'i': e['i'], 'kind': e['kind'], 't': round(bt, 4), 'hf_jump_db': round(c, 1)})
        rep['timing'] = timing
        rep['boundary_hf_jump_db_max'] = max((c['hf_jump_db'] for c in clicks), default=None)
        rep['boundary_worst'] = sorted(clicks, key=lambda c: -c['hf_jump_db'])[:5]
    disc = discontinuities(st, sr)
    rep['discontinuities'] = len(disc)
    rep['discontinuity_times'] = [round(t, 4) for t in disc[:40]]

    title = a.title or os.path.basename(a.wav)
    plot(st, sr, 0, dur, a.out + '.png', cues, events, labels,
         f"{title}   |   {rep['integrated_lufs']} LUFS-I   TP {rep['true_peak_dbtp']} dBTP   "
         f"mono-stereo {rep['mono_minus_stereo_db']} dB")
    for z0, z1 in a.zoom:
        plot(st, sr, z0, min(z1, dur), f'{a.out}_zoom_{z0:g}-{z1:g}.png', cues, events, labels, f'{title}  {z0:g}-{z1:g} s')
    with open(a.out + '_report.json', 'w') as f:
        json.dump(rep, f, indent=1)
    # summary
    print(f"{a.wav}: {dur:.2f} s")
    for k in ('integrated_lufs', 'max_short_term_lufs', 'true_peak_dbtp', 'sample_peak_dbfs', 'dc_offset',
              'clipped_samples', 'mono_minus_stereo_db', 'mono_loss_worst_db', 'mono_loss_worst_t',
              'corr_mean', 'corr_min', 'corr_pct_negative',
              'discontinuities', 'boundary_hf_jump_db_max'):
        if k in rep:
            print(f'  {k:<24} {rep[k]}')
    if 'sections' in rep:
        print('  section            RMS dBFS  mom-mean  mom-max (LUFS)')
        for s in rep['sections']:
            print(f"  {s['id']:<18} {s['rms_dbfs']:>8}  {s['mom_mean_lufs']!s:>8}  {s['mom_max_lufs']!s:>8}")
    if 'after_cut' in rep:
        print('  after cut:', rep['after_cut'])
    if 'timing' in rep:
        dom = [t for t in rep['timing'] if (t.get('dominance_db') or -99) >= 0]
        bad = [t for t in dom if abs(t['stem_err_ms']) > 10]
        iso = [t for t in rep['timing'] if abs(t['isolated_err_ms'] or 0) > 10]
        rep['timing_summary'] = {'anchored': len(rep['timing']), 'isolated_outside_10ms': len(iso),
                                 'dominant_at_t': len(dom), 'dominant_outside_10ms': len(bad)}
        print(f"  timing: {len(rep['timing'])} anchored events; isolated renders outside +-10 ms: {len(iso)}; "
              f"{len(dom)} dominate the stem at t (>= 0 dB over everything else), {len(bad)} of those outside +-10 ms")
        for t in rep['timing']:
            flag = '' if (t.get('dominance_db') or -99) >= 0 else '   (masked by design: measured on the sum)'
            print(f"    [{t['i']:02d}] {t['kind']:<15} t={t['t']:7.3f} {t['anchor']:<5} stem {t['stem_err_ms']:+7.1f} ms"
                  f"   isolated {t['isolated_err_ms']:+6.2f} ms   dominance {t.get('dominance_db')!s:>6} dB{flag}")
    if disc:
        print('  first discontinuities at:', rep['discontinuity_times'][:12])


if __name__ == '__main__':
    main()

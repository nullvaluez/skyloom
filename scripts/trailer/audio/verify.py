#!/usr/bin/env python3
"""Objective verification of the trailer score (no listening required).

    python3 scripts/trailer/audio/verify.py [path/to/score.wav]

Measures: duration/format, integrated loudness (BS.1770 via pyloudnorm),
true peak (4x oversampled), sample peak, DC, clipping, click candidates,
mono compatibility (L/R correlation, mono-downmix loudness delta),
short-term loudness per cue-sheet section, and the timing of every cue
hit (onset detection on the rendered audio).  Writes PNGs:
  overview.png      waveform envelope + short-term/momentary loudness
  spectrogram.png   log-frequency spectrogram with section/hit markers
  stems.png         per-stem RMS curves
  hits.png          +/-250 ms zoom on every hit with cue vs detected onset
and score_report.json next to score.wav.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = '/tmp/claude-0/audio'
CUES = json.load(open(os.path.join(HERE, '..', 'cuesheet.json')))


def lufs_curve(x, sr, win, hop=0.1):
    """BS.1770 K-weighted loudness over sliding windows (LUFS)."""
    import pyloudnorm as pyln
    m = pyln.Meter(sr)
    # K-weighting via pyloudnorm's filters
    y = x.copy()
    for _, f in m._filters.items():
        for ch in range(y.shape[1]):
            y[:, ch] = f.apply_filter(y[:, ch])
    p = y ** 2
    w, h = int(win * sr), int(hop * sr)
    cs = np.cumsum(np.concatenate([np.zeros((1, p.shape[1])), p]), 0)
    ts, vals = [], []
    for i in range(0, len(p) - w + 1, h):
        ms = (cs[i + w] - cs[i]) / w
        z = ms.sum()
        vals.append(-0.691 + 10 * np.log10(z + 1e-12))
        ts.append((i + w) / sr)   # loudness value is 'as of' the window end
    return np.array(ts), np.array(vals)


def env_db(x, sr, win=0.001):
    w = max(1, int(win * sr))
    m = np.abs(x).max(1) if x.ndim > 1 else np.abs(x)
    m = m[:len(m) // w * w].reshape(-1, w).max(1)
    return np.arange(len(m)) * w / sr, 20 * np.log10(m + 1e-9)


def onset_near(x, sr, T, search=0.05):
    """Detected onset near T.  Two stages:
    1) spectral-flux onset function (1024-pt Hann STFT, hop 64 = 1.33 ms,
       log-magnitude, half-wave-rectified bin differences above 100 Hz);
       the strongest flux peak within +/- search of T is the event;
    2) sample-level refinement: the first sample, searching from 25 ms
       before that peak, where the >100 Hz high-passed |signal| exceeds
       4x (+12 dB) the RMS of the preceding 20 ms.  That is the onset."""
    a = int((T - 0.25) * sr)
    seg = x[max(0, a):int((T + 0.25) * sr)].mean(1)
    hp = signal.sosfilt(signal.butter(2, 100, 'highpass', fs=sr, output='sos'), seg)
    nfft, hop = 1024, 64
    f, t, Z = signal.stft(seg, sr, window='hann', nperseg=nfft, noverlap=nfft - hop, boundary=None, padded=False)
    M = np.log10(np.abs(Z[f > 100]) + 1e-7)
    flux = np.maximum(np.diff(M, axis=1), 0).sum(0)
    tf = t[1:] + (T - 0.25)                      # frame centres
    m = (tf >= T - search) & (tf <= T + search)
    i = np.argmax(np.where(m, flux, -1))
    tpk = tf[i]
    # refinement
    j0 = int((tpk - 0.025 - (T - 0.25)) * sr)
    w = int(0.02 * sr)
    j = max(w, j0)
    ab = np.abs(hp)
    cs = np.cumsum(np.concatenate([[0.0], hp ** 2]))
    onset = tpk
    while j < min(len(hp), int((tpk + 0.02 - (T - 0.25)) * sr)):
        ref = np.sqrt((cs[j] - cs[j - w]) / w) + 1e-7
        if ab[j] > 4.0 * ref:
            onset = (T - 0.25) + j / sr
            break
        j += 1
    # perceived step: K-weighted mean-square loudness of the 300 ms after
    # the hit vs the 300 ms before the pre-hit 'vacuum' (T-0.4 .. T-0.1);
    # transient: peak 5 ms RMS in the first 50 ms vs the median 5 ms RMS
    # of that same pre window.
    import pyloudnorm as pyln
    a0 = int((T - 1.0) * sr)
    y = x[max(0, a0):int((T + 0.5) * sr)].copy()
    for _, f in pyln.Meter(sr)._filters.items():
        for ch in range(y.shape[1]):
            y[:, ch] = f.apply_filter(y[:, ch])
    def kl(t0, t1):
        i0, i1 = int((t0 - (T - 1.0)) * sr), int((t1 - (T - 1.0)) * sr)
        return -0.691 + 10 * np.log10((y[i0:i1] ** 2).mean(0).sum() + 1e-12)
    pre, post = kl(T - 0.4, T - 0.1), kl(T, T + 0.3)
    w5 = int(0.005 * sr)
    xm = x[max(0, a0):int((T + 0.5) * sr)].mean(1)
    def r5(t0, t1):
        i0, i1 = int((t0 - (T - 1.0)) * sr), int((t1 - (T - 1.0)) * sr)
        z = xm[i0:i1][:(i1 - i0) // w5 * w5].reshape(-1, w5)
        return 10 * np.log10((z ** 2).mean(1) + 1e-12)
    trans = r5(T, T + 0.05).max() - np.median(r5(T - 0.4, T - 0.1))
    return onset, pre, post, trans


def drop_near(x, sr, T):
    """For cut/breakdown cues: level (>150 Hz, 5 ms RMS) before vs after,
    and the drop time = first 5 ms frame after T-0.1 that sits 10 dB under
    the pre-cut median level."""
    a0 = int((T - 0.5) * sr)
    seg = x[a0:int((T + 0.5) * sr)].mean(1)
    hp = signal.sosfilt(signal.butter(2, 150, 'highpass', fs=sr, output='sos'), seg)
    w = int(0.005 * sr)
    n = len(hp) // w
    e = 10 * np.log10((hp[:n * w].reshape(n, w) ** 2).mean(1) + 1e-12)
    t = (T - 0.5) + (np.arange(n) + 1) * w / sr        # frame END times
    before = np.median(e[(t > T - 0.3) & (t < T - 0.03)])
    after = np.median(e[(t > T + 0.08) & (t < T + 0.35)])
    idx = np.where((t > T - 0.1) & (e < before - 10))[0]
    td = t[idx[0]] if len(idx) else np.nan
    return td, before, after


def run(path=None):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import pyloudnorm as pyln

    path = path or os.path.join(OUT, 'score.wav')
    x, sr = sf.read(path, always_2d=True)
    info = sf.info(path)
    rep = {'file': path, 'sr': sr, 'channels': x.shape[1], 'subtype': info.subtype,
           'duration_s': round(len(x) / sr, 6)}
    meter = pyln.Meter(sr)
    rep['integrated_lufs'] = round(meter.integrated_loudness(x), 2)
    up = signal.resample_poly(x, 4, 1, axis=0)
    rep['true_peak_dbtp'] = round(20 * np.log10(np.abs(up).max()), 2)
    rep['sample_peak_dbfs'] = round(20 * np.log10(np.abs(x).max()), 2)
    rep['dc_offset'] = [float(f'{v:.2e}') for v in x.mean(0)]
    rep['clipped_samples'] = int((np.abs(x) >= 0.9999).sum())
    L, R = x[:, 0], x[:, 1]
    rep['lr_correlation'] = round(float(np.corrcoef(L, R)[0, 1]), 3)
    mono = (L + R) / 2
    rep['mono_minus_stereo_lufs'] = round(meter.integrated_loudness(np.stack([mono, mono], 1)) - rep['integrated_lufs'], 2)
    ts, st = lufs_curve(x, sr, 3.0, 0.1)
    tm, mo = lufs_curve(x, sr, 0.4, 0.05)
    rep['max_short_term_lufs'] = round(float(st.max()), 2)
    rep['max_momentary_lufs'] = round(float(mo.max()), 2)
    # loudness range (EBU R128 LRA approx: 10th..95th pct of gated short-term)
    g = st[st > -70]
    g = g[g > (10 * np.log10(np.mean(10 ** (g / 10))) - 20)]
    rep['lra_lu'] = round(float(np.percentile(g, 95) - np.percentile(g, 10)), 1)

    secs = []
    for s in CUES['sections']:
        a, b = int(s['t0'] * sr), int(s['t1'] * sr)
        seg = x[a:b]
        rms = 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-12)
        mm = (tm > s['t0'] + 0.4) & (tm <= s['t1'])
        corr = float(np.corrcoef(seg[:, 0], seg[:, 1])[0, 1]) if np.abs(seg).max() > 0 else 1.0
        secs.append({'id': s['id'], 't0': s['t0'], 't1': s['t1'], 'rms_dbfs': round(rms, 1),
                     'momentary_lufs_median': round(float(np.median(mo[mm])), 1),
                     'momentary_lufs_max': round(float(mo[mm].max()), 1),
                     'lr_corr': round(corr, 3)})
    rep['sections'] = secs

    hits = []
    for h in CUES['hits']:
        T = h['t']
        if h['kind'] in ('breakdown', 'cut_to_silence'):
            tt, b4, af = drop_near(x, sr, T)
            hits.append({'t': T, 'kind': h['kind'], 'detected': round(float(tt), 4),
                         'err_ms': round((tt - T) * 1000, 1), 'level_before_db': round(float(b4), 1),
                         'level_after_db': round(float(af), 1), 'type': 'drop'})
        else:
            on, pre, post, trans = onset_near(x, sr, T)
            hits.append({'t': T, 'kind': h['kind'], 'detected': round(float(on), 4),
                         'err_ms': round((on - T) * 1000, 1), 'loudness_step_lu': round(float(post - pre), 1),
                         'transient_db': round(float(trans), 1), 'type': 'onset'})
    rep['hits'] = hits
    rep['hits_max_abs_err_ms'] = max(abs(h['err_ms']) for h in hits if h['type'] == 'onset')

    # click candidates: large 2nd-difference spikes vs local HF level,
    # excluding +/-40 ms around designed hits.
    hp = signal.sosfilt(signal.butter(4, 6000, 'highpass', fs=sr, output='sos'), x.mean(1))
    d2 = np.abs(np.diff(hp, 2))
    w = int(0.02 * sr)
    loc = np.sqrt(np.convolve(hp ** 2, np.ones(w) / w, 'same'))[1:-1] + 1e-6
    ratio = d2 / loc
    excl = np.zeros(len(ratio), bool)
    for h in CUES['hits']:
        excl[max(0, int((h['t'] - 0.04) * sr)):int((h['t'] + 0.04) * sr)] = True
    ratio[excl] = 0
    cand = np.argsort(ratio)[::-1][:8]
    rep['click_candidates'] = [{'t': round(i / sr, 4), 'ratio': round(float(ratio[i]), 1),
                                'hf_level_db': round(20 * np.log10(loc[i]), 1)} for i in sorted(cand)]
    rep['click_ratio_max'] = round(float(ratio.max()), 1)

    # tail / head silence
    rep['last_100ms_peak_dbfs'] = round(20 * np.log10(np.abs(x[-int(0.1 * sr):]).max() + 1e-12), 1)
    rep['gap_94_to_945_peak_dbfs'] = round(20 * np.log10(np.abs(x[int(94.25 * sr):int(94.49 * sr)]).max() + 1e-12), 1)

    json.dump(rep, open(os.path.join(os.path.dirname(path), 'score_report.json'), 'w'), indent=1)

    # ------------------------------------------------------------ plots
    colors = ['#e8eef7', '#f7efe6']

    def markers(ax, labels=True, ymax=None):
        for i, s in enumerate(CUES['sections']):
            ax.axvspan(s['t0'], s['t1'], color=colors[i % 2], alpha=0.5 if labels else 0.0, lw=0)
            if labels:
                ax.text(s['t0'] + 0.2, 1.0, s['id'], transform=ax.get_xaxis_transform(), fontsize=7,
                        va='top', color='#333')
        for h in CUES['hits']:
            ax.axvline(h['t'], color='#c0392b', lw=0.6, alpha=0.7, ls='--')

    fig, axs = plt.subplots(2, 1, figsize=(20, 8), sharex=True)
    te, ed = env_db(x, sr, 0.01)
    axs[0].fill_between(te, -80, ed, color='#34495e', lw=0)
    axs[0].set_ylim(-60, 1)
    axs[0].set_ylabel('peak env (dBFS)')
    markers(axs[0])
    axs[0].set_title(f"Skyloom score — {rep['integrated_lufs']} LUFS-I, {rep['true_peak_dbtp']} dBTP, LRA {rep['lra_lu']} LU")
    markers(axs[1], labels=False)
    axs[1].plot(tm, mo, color='#95a5a6', lw=0.6, label='momentary (400 ms)')
    axs[1].plot(ts, st, color='#2c3e50', lw=1.4, label='short-term (3 s)')
    axs[1].set_ylim(-50, -2)
    axs[1].set_ylabel('LUFS')
    axs[1].legend(loc='lower left', fontsize=8)
    axs[1].set_xlim(0, len(x) / sr)
    axs[1].set_xticks(np.arange(0, 105, 2))
    axs[1].tick_params(labelsize=7)
    axs[1].grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'overview.png'), dpi=90)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(20, 7))
    f, t, Z = signal.spectrogram(x.mean(1), sr, nperseg=4096, noverlap=4096 - 1024, scaling='spectrum')
    Z = 10 * np.log10(Z + 1e-14)
    ax.pcolormesh(t, f[1:], Z[1:], shading='auto', cmap='magma', vmin=Z.max() - 100, vmax=Z.max())
    ax.set_yscale('log')
    ax.set_ylim(20, 20000)
    for s in CUES['sections']:
        ax.axvline(s['t0'], color='w', lw=0.8, alpha=0.8)
        ax.text(s['t0'] + 0.2, 16000, s['id'], color='w', fontsize=7, va='top')
    for h in CUES['hits']:
        ax.axvline(h['t'], color='#00e5ff', lw=0.6, ls='--', alpha=0.8)
    ax.set_xticks(np.arange(0, 105, 2))
    ax.tick_params(labelsize=7)
    ax.set_ylabel('Hz')
    ax.set_title('spectrogram (mono downmix), cyan = cue hits, white = sections')
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'spectrogram.png'), dpi=90)
    plt.close(fig)

    stem_dir = os.path.join(OUT, 'stems')
    if os.path.isdir(stem_dir):
        fig, ax = plt.subplots(figsize=(20, 6))
        markers(ax)
        for fn in sorted(os.listdir(stem_dir)):
            if not fn.endswith('.wav'):
                continue
            y, _ = sf.read(os.path.join(stem_dir, fn), always_2d=True)
            w = int(0.25 * sr)
            p = (y[:len(y) // w * w] ** 2).mean(1).reshape(-1, w).mean(1)
            ax.plot(np.arange(len(p)) * 0.25 + 0.125, 10 * np.log10(p + 1e-12), lw=1.1, label=fn[:-4])
        ax.set_ylim(-70, 0)
        ax.set_xlim(0, 104)
        ax.set_xticks(np.arange(0, 105, 2))
        ax.tick_params(labelsize=7)
        ax.set_ylabel('RMS dBFS (250 ms)')
        ax.legend(ncol=8, fontsize=8, loc='lower center')
        ax.grid(alpha=0.3)
        ax.set_title('stem RMS (pre-master)')
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, 'stems.png'), dpi=90)
        plt.close(fig)

    nh = len(CUES['hits'])
    cols = 7
    rows = int(np.ceil(nh / cols))
    fig, axs = plt.subplots(rows, cols, figsize=(20, 3 * rows))
    for ax, h, hr in zip(axs.flat, CUES['hits'], hits):
        T = h['t']
        a, b = int((T - 0.25) * sr), int((T + 0.25) * sr)
        tt, ee = env_db(x[a:b], sr, 0.001)
        ax.plot(tt + T - 0.25, ee, color='#2c3e50', lw=0.8)
        ax.axvline(T, color='#c0392b', lw=1)
        ax.axvline(hr['detected'], color='#27ae60', lw=1, ls='--')
        ax.set_ylim(-70, 0)
        ax.set_title(f"{T:.1f} {h['kind']}  {hr['err_ms']:+.1f} ms", fontsize=8)
        ax.tick_params(labelsize=6)
    for ax in list(axs.flat)[nh:]:
        ax.axis('off')
    fig.suptitle('cue hits: red = cue time, green dashed = detected onset / steepest drop (1 ms peak env, dBFS)')
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'hits.png'), dpi=80)
    plt.close(fig)

    # console summary
    print(json.dumps({k: v for k, v in rep.items() if k not in ('sections', 'hits', 'click_candidates')}, indent=1))
    print('section              t0     t1   RMS dBFS  M-LUFS med  M-LUFS max  LRcorr')
    for s in secs:
        print(f"{s['id']:18s} {s['t0']:5.1f}  {s['t1']:5.1f}   {s['rms_dbfs']:7.1f}   {s['momentary_lufs_median']:9.1f}"
              f"   {s['momentary_lufs_max']:9.1f}   {s['lr_corr']:.2f}")
    print('hits:')
    for h in hits:
        extra = (f"loudness step {h['loudness_step_lu']:+.1f} LU, transient {h['transient_db']:+.1f} dB"
                 if h['type'] == 'onset' else f"(>150 Hz) {h['level_before_db']:.1f} -> {h['level_after_db']:.1f} dB")
        print(f"  {h['t']:6.2f} {h['kind']:15s} detected {h['detected']:8.4f}  err {h['err_ms']:+6.1f} ms  {extra}")
    print('click candidates:', rep['click_candidates'][:5])
    return rep


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else None)

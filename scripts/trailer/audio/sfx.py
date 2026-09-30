#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Skyloom trailer -- PARAMETRIC SFX RENDERER.

    python3 sfx.py events.json out.wav --duration 104          # render a stem from an event list
    python3 sfx.py --demo out_demo.wav                          # every kind in isolation, 2 s gaps
    python3 sfx.py --list                                       # kinds, anchors, parameters

Output: 48 kHz, stereo, 24-bit WAV (+ out.wav.json sidecar: where every event landed and the
measured anchor error of each isolated render).

EVENT SCHEMA -- a JSON list, or {"events": [...]}. Common keys:
  t         seconds on the timeline (what lands on t depends on the kind's ANCHOR, below)
  kind      one of KINDS (see --list)
  gain_db   0 = the event's loudest 400 ms window reads REF_LUFS + the kind's default level
  pan       -1..1 (static pan / start of a moving source)      pan_to  -1..1 (end of a moving source)
  pitch     semitones, tape-style varispeed of the whole event (durations are pre-compensated)
  dur       seconds (beds / swells)      intensity 0..1 (where meaningful)
  seed      int (renders are deterministic; default seed = hash(kind, t, index))
  enabled   false = skip             label   free text (ignored)
  gate_in   absolute seconds: event is muted before this time (4 ms ramp) -- e.g. clip a flyby's
            approach so the stem is silent before a hard cut
  gate_out  absolute seconds: event is muted after this time (4 ms ramp)
  fade_in / fade_out   seconds (beds)
ANCHORS:
  start  -- the bed begins at t            peak  -- its smoothed loudness maximum lands on t
  onset  -- its transient attack lands on t    end   -- the swell ends (hard stop) exactly at t
MASTER KIND:
  {"t": 94.0, "kind": "cut", "tail_db": -20, "tail": 1.2}  every event with t < 94.0 is cut at 94.0
  with a 4 ms ramp down to tail_db, which then decays to silence over `tail` seconds.

Everything is synthesised from noise, oscillators and physics (doppler by time-varying
resampling of the emission time, ISO-9613-style air absorption, ground-reflection comb, ITD/ILD
stereo, synthetic early-reflection+diffuse IRs). Two CC0 textures from the game itself are layered
at low level (see CREDITS.md): public/audio/immersive/engine.mp3 (pauliuw, OpenGameArt, CC0) in
jet_bed, and public/audio/immersive/wind.ogg (IgnasD, OpenGameArt, CC0) in wind_high. Both are
optional; the renderer falls back to pure synthesis if they are missing ("asset": false forces it).
"""
import argparse
import json
import math
import os
import sys
import zlib

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import butter, fftconvolve, lfilter, resample_poly, sosfilt

try:
    import pedalboard as pb
except Exception:  # pedalboard is optional -- only used for a little grit / EQ
    pb = None

SR = 48000
C = 343.0                       # speed of sound, m/s
REF_LUFS = -18.0                # momentary-max loudness of an event at gain_db 0, kind level 0
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ASSET_DIR = os.path.join(REPO, 'public', 'audio', 'immersive')


# ----------------------------------------------------------------------------- basics
def N(sec, sr=SR):
    return max(1, int(round(float(sec) * sr)))


def db2a(d):
    return np.power(10.0, np.asarray(d, dtype=float) / 20.0)


def a2db(a):
    return 20.0 * np.log10(np.maximum(np.abs(a), 1e-12))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-30))


def norm_rms(x):
    return x / (rms(x) + 1e-12)


def fade(x, fin=0.005, fout=0.005, sr=SR):
    """Raised-cosine fade in/out on the last axis (ends exactly at 0)."""
    n = x.shape[-1]
    a = min(N(fin, sr) if fin > 0 else 0, n // 2)
    b = min(N(fout, sr) if fout > 0 else 0, n // 2)
    w = np.ones(n)
    if a > 0:
        w[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 0:
        w[n - b:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(1, b + 1) / b)
    return x * w


def env_pts(pts, n, sr=SR, db=False, t0=0.0):
    """Piecewise-linear envelope through (time, value) points; value in dB if db=True."""
    ts = np.arange(n) / sr + t0
    v = np.interp(ts, [p[0] for p in pts], [p[1] for p in pts])
    return db2a(v) if db else v


def attack_ramp(n, a_sec, sr=SR):
    w = np.ones(n)
    a = min(n, N(a_sec, sr))
    w[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    return w


def expdecay(n, tau, sr=SR, attack=0.0015):
    t = np.arange(n) / sr
    return np.exp(-t / tau) * attack_ramp(n, attack, sr)


def place(dst, src, i0):
    """Add src (1-D) into dst at index i0, clipped to bounds."""
    n = len(dst)
    a, b = max(0, i0), min(n, i0 + len(src))
    if b > a:
        dst[a:b] += src[a - i0:b - i0]


def saturate(x, drive=2.0):
    pk = float(np.max(np.abs(x))) + 1e-12
    return np.tanh(drive * x / pk) / np.tanh(drive) * pk


_SOS = {}


def sos(kind, fc, order=4, sr=SR):
    key = (kind, tuple(np.round(np.atleast_1d(fc), 3)), order, sr)
    if key not in _SOS:
        fcs = np.atleast_1d(fc).astype(float)
        fcs = np.clip(fcs, 1.0, 0.49 * sr)
        _SOS[key] = butter(order, fcs if len(fcs) > 1 else fcs[0], btype=kind, fs=sr, output='sos')
    return _SOS[key]


def filt(x, kind, fc, order=4, sr=SR, zero_phase=False):
    s = sos(kind, fc, order, sr)
    if zero_phase:
        return signal.sosfiltfilt(s, x, axis=-1)
    return sosfilt(s, x, axis=-1)


def gain_curve(f, pts):
    """dB breakpoints over log-frequency -> linear gain at f."""
    pf = np.log(np.array([p[0] for p in pts], float))
    pd = np.array([p[1] for p in pts], float)
    return db2a(np.interp(np.log(np.maximum(f, 1.0)), pf, pd, left=pd[0], right=pd[-1]))


def shaped_noise(n, rng, pts, sr=SR, lo=18.0, hi=19000.0):
    """Gaussian noise with a log-frequency dB spectral envelope; band-limited [lo, hi]; RMS 1."""
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / sr)
    G = gain_curve(f, pts)
    fs = np.maximum(f, 1e-3)
    G = G / np.sqrt(1.0 + (lo / fs) ** 8) / np.sqrt(1.0 + (fs / hi) ** 16)
    return norm_rms(np.fft.irfft(X * G, n))


def mod_signal(n, rng, f_lo, f_hi, sr=SR, cr=400.0):
    """Band-limited random control signal (zero mean, unit std) resampled to audio rate."""
    m = int(n / sr * cr) + 8
    X = np.fft.rfft(rng.standard_normal(m))
    f = np.maximum(np.fft.rfftfreq(m, 1.0 / cr), 1e-4)
    G = 1.0 / np.sqrt(1.0 + (f_lo / f) ** 4) / np.sqrt(1.0 + (f / f_hi) ** 4)
    y = np.fft.irfft(X * G, m)
    y = (y - y.mean()) / (y.std() + 1e-12)
    return np.interp(np.arange(n) / sr, np.arange(m) / cr, y)


def stft_mask(x, maskfn, nfft=2048, hop=256, sr=SR):
    """Time-varying zero-phase filtering: maskfn(freqs[F], frame_times[T]) -> gain [F, T]."""
    n = len(x)
    f, t, Z = signal.stft(x, fs=sr, window='hann', nperseg=nfft, noverlap=nfft - hop,
                          boundary='even', padded=True)
    G = maskfn(f, t)
    _, y = signal.istft(Z * G, fs=sr, window='hann', nperseg=nfft, noverlap=nfft - hop, boundary=True)
    y = y[:n]
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    return y


def tv_lowpass(x, fc_fn, order=2, sr=SR, nfft=2048, hop=256):
    """Time-varying Butterworth-magnitude low-pass. fc_fn(times) -> cutoff Hz."""
    def mk(f, t):
        fc = np.maximum(fc_fn(t), 20.0)
        return 1.0 / np.sqrt(1.0 + (f[:, None] / fc[None, :]) ** (2 * order))
    return stft_mask(x, mk, nfft, hop, sr)


def interp_cubic(x, idx):
    """Catmull-Rom interpolation of x at fractional indices idx."""
    i = np.floor(idx).astype(np.int64)
    fr = idx - i
    i = np.clip(i, 1, len(x) - 3)
    xm1, x0, x1, x2 = x[i - 1], x[i], x[i + 1], x[i + 2]
    a = -0.5 * xm1 + 1.5 * x0 - 1.5 * x1 + 0.5 * x2
    b = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2
    c = -0.5 * xm1 + 0.5 * x1
    return ((a * fr + b) * fr + c) * fr + x0


def varispeed(x, ratio, sr=SR):
    """Tape-style resample. ratio: scalar or per-output-sample read rate (1 = unchanged)."""
    x = np.atleast_2d(x)
    n = x.shape[-1]
    if np.ndim(ratio) == 0:
        r = float(ratio)
        if r > 1.0:   # band-limit before reading faster
            x = filt(x, 'lowpass', min(0.45 * sr, 0.45 * sr / r), 8, sr)
        m = int((n - 3) / r)
        idx = np.arange(m) * r
    else:
        idx = np.concatenate([[0.0], np.cumsum(ratio[:-1])])
        idx = idx[idx < n - 3]
    return np.stack([interp_cubic(ch, idx) for ch in x])


def frac_delay(x, d):
    """y[n] = x[n - d[n]], d >= 0 in samples (linear interpolation)."""
    n = len(x)
    idx = np.arange(n) - d
    i = np.floor(idx).astype(np.int64)
    fr = idx - i
    i0 = np.clip(i, 0, n - 1)
    i1 = np.clip(i + 1, 0, n - 1)
    y = x[i0] * (1.0 - fr) + x[i1] * fr
    y[idx < 0] = 0.0
    return y


def smooth_env(st, win, sr=SR):
    p = np.sum(np.square(np.atleast_2d(st)), axis=0)
    return np.sqrt(np.maximum(uniform_filter1d(p, max(1, N(win, sr)), mode='constant'), 0.0))


def peak_index(st, win=0.12, lo=None, hi=None, sr=SR):
    e = smooth_env(st, win, sr)
    a = 0 if lo is None else max(0, lo)
    b = len(e) if hi is None else min(len(e), hi)
    return a + int(np.argmax(e[a:b]))


# ----------------------------------------------------------------------------- loudness
_KB1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
_KA1 = [1.0, -1.69065929318241, 0.73248077421585]
_KB2 = [1.0, -2.0, 1.0]
_KA2 = [1.0, -1.99004745483398, 0.99007225036621]


def kweight(x):
    return lfilter(_KB2, _KA2, lfilter(_KB1, _KA1, x, axis=-1), axis=-1)


def loudness_curve(st, win=0.4, hop=0.1, sr=SR):
    """BS.1770 momentary (win 0.4) / short-term (win 3.0) loudness curve. Returns (lufs, times)."""
    st = np.atleast_2d(st)
    p = np.sum(np.square(kweight(st)), axis=0)
    c = np.concatenate([[0.0], np.cumsum(p)])
    w, h = N(win, sr), N(hop, sr)
    if len(p) <= w:
        return np.array([-0.691 + 10 * np.log10(np.mean(p) + 1e-20)]), np.array([len(p) / 2 / sr])
    s = np.arange(0, len(p) - w + 1, h)
    ms = (c[s + w] - c[s]) / w
    return -0.691 + 10 * np.log10(ms + 1e-20), (s + w / 2) / sr


def max_momentary(st):
    L, _ = loudness_curve(st, 0.4, 0.02)
    return float(np.max(L))


def true_peak_db(st, sr=SR):
    up = resample_poly(np.atleast_2d(st), 4, 1, axis=-1)
    return float(a2db(np.max(np.abs(up))))


# ----------------------------------------------------------------------------- space
HEAD_A = 0.0875


def spatialize(x, pan, itd_scale=0.5, shadow=0.7, lf_width=0.3, lf_split=140.0):
    """Mono -> stereo with ITD (Woodworth, scaled for mono-compatibility), ILD (constant-power
    gain + far-ear head-shadow low-pass) and a near-centred low band. pan scalar or per-sample."""
    n = len(x)
    p = np.clip(np.broadcast_to(np.asarray(pan, float), (n,)).astype(float), -0.999, 0.999)
    lo = sosfilt(sos('lowpass', lf_split, 2), x)
    hi = x - lo
    mid = sosfilt(sos('lowpass', 1500.0, 2), hi)      # ITD acts on fine structure below ~1.5 kHz only:
    top = hi - mid                                     # no delay above it -> no mono comb in the presence band
    tops = sosfilt(sos('lowpass', 2200.0, 1), top)
    az = np.arcsin(p)
    itd = itd_scale * (HEAD_A / C) * (np.abs(az) + np.sin(np.abs(az))) * SR
    dL = np.where(p > 0, itd, 0.0)
    dR = np.where(p < 0, itd, 0.0)
    wL = shadow * np.maximum(p, 0.0)
    wR = shadow * np.maximum(-p, 0.0)
    ang = (p + 1.0) * np.pi / 4
    L = np.cos(ang) * (frac_delay(mid, dL) + (1 - wL) * top + wL * tops)
    R = np.sin(ang) * (frac_delay(mid, dR) + (1 - wR) * top + wR * tops)
    angl = (p * lf_width + 1.0) * np.pi / 4
    return np.stack([L + np.cos(angl) * lo, R + np.sin(angl) * lo])


def balance(st, pan):
    """Pan a stereo image without discarding either channel."""
    p = float(np.clip(pan, -1, 1))
    if abs(p) < 1e-6:
        return st
    a = abs(p) * np.pi / 2
    L, R = st[0].copy(), st[1].copy()
    if p > 0:
        R = R + L * np.sin(a) * 0.7071
        L = L * np.cos(a)
    else:
        L = L + R * np.sin(a) * 0.7071
        R = R * np.cos(a)
    return np.stack([L, R])


def stereo_noise(n, rng, pts, corr=0.5, sr=SR):
    """Two partially-correlated noise channels with the same spectrum (corr = inter-channel r)."""
    a = math.sqrt(max(0.0, min(1.0, corr)))
    b = math.sqrt(1.0 - a * a)
    c = shaped_noise(n, rng, pts, sr)
    return np.stack([a * c + b * shaped_noise(n, rng, pts, sr), a * c + b * shaped_noise(n, rng, pts, sr)])


_IR = {}
IR_PRESETS = {
    # t60 s, predelay s, HF damping 0..1, early reflections [(delay s, dB)], extra
    'room':    dict(t60=0.45, pre=0.004, damp=0.35, er=[(0.007, -7), (0.011, -9), (0.017, -11), (0.023, -13)]),
    'outdoor': dict(t60=1.4, pre=0.018, damp=0.75, er=[(0.013, -8), (0.029, -10), (0.041, -12), (0.067, -14),
                                                        (0.089, -16), (0.131, -18), (0.173, -21)]),
    'city':    dict(t60=2.4, pre=0.03, damp=0.7, er=[(0.048, -9), (0.083, -10), (0.121, -12), (0.167, -13),
                                                     (0.229, -15), (0.301, -17), (0.388, -19)]),
    'hall':    dict(t60=2.6, pre=0.02, damp=0.5, er=[(0.011, -8), (0.019, -9), (0.027, -10), (0.041, -12)]),
    'huge':    dict(t60=5.5, pre=0.03, damp=0.6, er=[(0.023, -9), (0.047, -11), (0.071, -12)]),
    'valley':  dict(t60=4.0, pre=0.05, damp=0.8, er=[(0.29, -10), (0.47, -12), (0.73, -14), (1.06, -17),
                                                     (1.44, -20), (1.9, -23)]),
    'shimmer': dict(t60=6.0, pre=0.01, damp=0.05, er=[]),
    'air':     dict(t60=2.0, pre=0.04, damp=0.9, er=[]),
}


def make_ir(name, seed=11):
    if name in _IR:
        return _IR[name]
    pr = IR_PRESETS[name]
    rng = np.random.default_rng(seed + zlib.crc32(name.encode()) % 1000)
    t60, damp = pr['t60'], pr['damp']
    L = N(t60 * 1.15 + pr['pre'])
    t = np.arange(L) / SR
    bands = [(20, 250), (250, 1000), (1000, 4000), (4000, 20000)]
    t60s = [t60 * 1.15, t60, t60 * (1 - 0.35 * damp), t60 * (1 - 0.7 * damp)]
    ir = np.zeros((2, L))
    w_common = rng.standard_normal(L)
    for ch in range(2):
        w_own = rng.standard_normal(L)
        acc = np.zeros(L)
        for k, ((lo, hi), T) in enumerate(zip(bands, t60s)):
            # below 250 Hz the tail is identical in both channels (mono-safe bass), 250-1000 Hz half-shared
            w = w_common if k == 0 else (0.7071 * (w_common + w_own) if k == 1 else w_own)
            b = filt(w, 'bandpass', [lo, min(hi, 0.45 * SR)], 2, zero_phase=True)
            acc += b * np.exp(-6.9078 * t / max(T, 0.05))
        acc *= 1.0 - np.exp(-t / 0.015)            # diffuse density build-up
        ir[ch] = acc
    ir /= np.sqrt(np.sum(ir ** 2) / 2.0)
    for k, (d, g) in enumerate(pr['er']):          # discrete early reflections, alternating sides
        i = N(d)
        if i < L:
            side = 0 if k % 2 == 0 else 1
            ir[side, i] += db2a(g) * 1.0
            ir[1 - side, min(L - 1, i + N(0.0007))] += db2a(g) * 0.55
    ir = np.concatenate([np.zeros((2, N(pr['pre']))), ir], axis=1)
    ir /= np.sqrt(np.sum(ir ** 2) / 2.0)
    ir = fade(ir, 0.0, 0.05)
    _IR[name] = ir
    return ir


def reverb(st, space, wet_db, dry=1.0, send_hp=None):
    """Convolution reverb with a synthetic stereo IR; output is longer by the IR length.
    The send is high-passed (default 150 Hz, 'valley' 60 Hz) so subs stay dry and tight."""
    if not space or space == 'none' or wet_db is None or wet_db <= -90:
        return st
    st = np.atleast_2d(st)
    if st.shape[0] == 1:
        st = np.vstack([st, st])
    ir = make_ir(space)
    n = st.shape[1]
    hp = send_hp if send_hp is not None else (60.0 if space == 'valley' else 150.0)
    snd = filt(st, 'highpass', hp, 2) if hp > 0 else st
    xl = 0.75 * snd[0] + 0.25 * snd[1]
    xr = 0.75 * snd[1] + 0.25 * snd[0]
    wl = fftconvolve(xl, ir[0])
    wr = fftconvolve(xr, ir[1])
    out = np.zeros((2, len(wl)))
    out[:, :n] += dry * st
    out[0] += db2a(wet_db) * wl
    out[1] += db2a(wet_db) * wr
    return trim_tail(out)


def lead_trim(st, floor_db=-50.0):
    """Drop leading near-silence (e.g. IR pre-delay) so a reversed tail ends on its strike."""
    e = np.max(np.abs(st), axis=0)
    i = int(np.argmax(e > e.max() * db2a(floor_db)))
    return st[:, i:]


def trim_tail(st, floor_db=-100.0):
    e = np.max(np.abs(st), axis=0)
    pk = float(e.max()) + 1e-12
    nz = np.nonzero(e > pk * db2a(floor_db))[0]
    if len(nz) == 0:
        return st[:, :1]
    end = min(st.shape[1], nz[-1] + N(0.01))
    return fade(st[:, :end], 0.0, 0.01)


# ----------------------------------------------------------------------------- physics
# Air absorption, dB per metre, ~20 C / 50 % RH (ISO 9613-1 magnitudes).
_AF = np.log([20, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 24000])
_AA = np.log([0.00002, 0.0001, 0.0004, 0.001, 0.0019, 0.0037, 0.0097, 0.0329, 0.105, 0.35, 0.7])


def alpha_db(f):
    return np.exp(np.interp(np.log(np.maximum(f, 20.0)), _AF, _AA))


GROUND = {   # reflection magnitude (dB) vs frequency for a grazing-ish reflection
    'grass': [(50, -1), (300, -2), (1000, -5), (2000, -7), (4000, -9), (10000, -12)],
    'water': [(50, -0.5), (1000, -1), (10000, -2)],
    'hard':  [(50, -0.5), (2000, -1.5), (10000, -3)],
}


def absorb(x, r, air=1.0, sr=SR):
    """Static distance air absorption."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / sr)
    return np.fft.irfft(X * db2a(np.maximum(-air * alpha_db(f) * r, -120)), n)


def tones(n, rng, freqs, amps_db, jitter=0.002, sr=SR, nb=0.4, am_db=1.5):
    """Machine tones: sines with slow FM/AM jitter blended with narrow-band noise at the same pitch
    (turbulence smears real turbomachinery tones)."""
    y = np.zeros(n)
    for f, a in zip(freqs, amps_db):
        if f >= 0.45 * sr:
            continue
        fm = 1.0 + jitter * mod_signal(n, rng, 0.1, 3.0, sr)
        ph = 2 * np.pi * np.cumsum(f * fm) / sr + rng.uniform(0, 2 * np.pi)
        tone = np.sin(ph) * db2a(am_db * mod_signal(n, rng, 0.2, 4.0, sr))
        if nb > 0:
            q = filt(rng.standard_normal(n), 'bandpass', [f * 0.988, f * 1.012], 2, sr)
            tone = (1 - nb) * tone * 1.41 + nb * norm_rms(q)
        y += db2a(a) * tone
    return y


def harmonic_series(n, rng, f0, ks, amps_db, jitter=0.0015, sr=SR):
    """Phase-locked shaft-order harmonics (turbofan 'buzz-saw')."""
    fm = 1.0 + jitter * mod_signal(n, rng, 0.1, 2.0, sr)
    ph = 2 * np.pi * np.cumsum(f0 * fm) / sr
    y = np.zeros(n)
    for k, a in zip(ks, amps_db):
        if k * f0 < 0.45 * sr:
            y += db2a(a) * np.sin(k * ph + rng.uniform(0, 2 * np.pi))
    return y


def crackle_sig(n, rng, rate=150.0, sr=SR):
    """Jet crackle: Poisson shocklets with heavy-tailed (Pareto) strength, bursty rate, skewed
    waveform (instant rise, fast decay, slower negative recovery)."""
    k = rng.poisson(rate * n / sr)
    pos = np.sort(rng.integers(0, n, max(k, 1)))
    m = mod_signal(n, rng, 0.8, 8.0, sr)
    keep = rng.random(len(pos)) < 1.0 / (1.0 + np.exp(-2.2 * m[pos]))
    pos = pos[keep]
    amp = np.minimum(rng.pareto(1.8, len(pos)) + 1.0, 10.0)
    imp = np.zeros(n)
    np.add.at(imp, pos, amp)
    L = N(0.006, sr)
    tt = np.arange(L) / sr
    ker = np.exp(-tt / 0.00022) - 0.3 * np.exp(-tt / 0.0011)
    y = fftconvolve(imp, ker)[:n]
    y = filt(y, 'highpass', 500.0, 2, sr)
    y = filt(y, 'lowpass', min(15000.0, 0.4 * sr), 4, sr)
    return norm_rms(y)


# directivity (theta = angle between flight direction and source->listener, 0 = listener ahead)
def dir_aft(th):    # large-scale jet-mixing noise, peaks ~145 deg
    return db2a(-13 + 17 * np.exp(-((th - 2.53) / 0.5) ** 2))


def dir_side(th):   # fine-scale jet noise, broad
    return db2a(-5 + 5 * np.exp(-((th - 1.9) / 1.0) ** 2))


def dir_fwd(th):    # inlet-radiated fan / compressor tones
    return db2a(-22 * (1 - np.exp(-((th - 0.75) / 0.95) ** 2)))


def dir_fanbb(th):
    return db2a(-8 + 8 * np.exp(-((th - 0.9) / 1.1) ** 2))


def dir_crk(th):    # crackle is strongly aft-directed
    return db2a(-24 + 24 * np.exp(-((th - 2.4) / 0.42) ** 2))


LST_PTS = [(15, -40), (40, -20), (90, -8), (180, -1), (260, 0), (450, -3), (900, -10), (2000, -18),
           (4000, -26), (8000, -35), (16000, -46), (20000, -60)]
FST_PTS = [(15, -40), (60, -22), (200, -9), (600, -2), (1100, 0), (2200, -3), (4500, -9), (9000, -16),
           (15000, -26), (20000, -45)]


def fighter_comps(rng, I=0.85, crackle=0.0, whine=(2380.0, 3710.0), whine_db=-17.0):
    def fn(n, sr):
        lst = shaped_noise(n, rng, LST_PTS, sr) * db2a(1.8 * mod_signal(n, rng, 2, 16, sr))
        fst = shaped_noise(n, rng, FST_PTS, sr) * db2a(1.0 * mod_signal(n, rng, 4, 30, sr))
        wh = tones(n, rng, [whine[0], whine[1], whine[0] * 2.02], [0, -5, -14], jitter=0.0025, sr=sr, nb=0.45)
        comps = [(lst, dir_aft), (fst * db2a(-6), dir_side), (wh * db2a(whine_db + 4 * I), dir_fwd)]
        if crackle > 0:
            comps.append((crackle_sig(n, rng, 180 * crackle, sr) * db2a(-11 + 6 * crackle), dir_crk))
        return comps
    return fn


CORE_PTS = [(15, -40), (28, -16), (60, -5), (120, 0), (200, -1), (380, -5), (750, -12), (1500, -20),
            (3000, -29), (6000, -38), (12000, -50), (20000, -65)]
FANBB_PTS = [(15, -40), (100, -22), (400, -9), (1000, -2), (1800, 0), (3500, -5), (7000, -13), (14000, -25),
             (20000, -45)]


def turbofan_comps(rng, n1=46.0, blades=22, thrust=0.6):
    def fn(n, sr):
        core = shaped_noise(n, rng, CORE_PTS, sr) * db2a(1.5 * mod_signal(n, rng, 1.5, 10, sr))
        fanbb = shaped_noise(n, rng, FANBB_PTS, sr)
        bpf = n1 * blades
        tn = tones(n, rng, [bpf, 2 * bpf, 3 * bpf], [0, -7, -15], jitter=0.0015, sr=sr, nb=0.5)
        ks = np.arange(2, 36)
        amps = -14 - 0.35 * ks - 9 * rng.random(len(ks))
        buzz = norm_rms(harmonic_series(n, rng, n1, ks, amps, 0.0015, sr))
        return [(core, dir_aft), (fanbb * db2a(-9), dir_fanbb), (tn * db2a(-15 + 6 * thrust), dir_fwd),
                (buzz * db2a(-24 + 10 * thrust), dir_fwd)]
    return fn


def render_pass(comps_fn, v, y_off, h, pre, post, hl=1.7, ground='grass', refl=0.8, pan=-0.9,
                pan_to=0.9, air=1.0, os_=2):
    """Straight-line constant-velocity moving source past a listener at the origin.
    Each path (direct, and the ground-image path if `ground`) is rendered by solving the retarded
    emission time tau(t) exactly (t = tau + |q(tau)|/c), resampling the source at tau (Doppler),
    1/r spreading, per-component directivity at the emission angle, then time-varying air
    absorption by the instantaneous path length. The ground image gives the classic sweeping
    comb ('jet flanging'). Returns stereo (2, n) at SR and the sample where the CPA emission arrives."""
    sro = SR * os_
    v = min(float(v), 0.55 * C)
    Dd2 = y_off ** 2 + (h - hl) ** 2
    Dg2 = y_off ** 2 + (h + hl) ** 2
    t_cpa = math.sqrt(Dd2) / C
    to = t_cpa + (np.arange(N(pre + post, sro)) / sro - pre)

    def solve(t, D2):
        return (C * C * t - np.sqrt(v * v * C * C * t * t + (C * C - v * v) * D2)) / (C * C - v * v)

    paths = [(solve(to, Dd2), 1.0, None)]
    if ground:
        paths.append((solve(to, Dg2), refl, GROUND.get(ground, GROUND['grass'])))
    tmin = min(p[0][0] for p in paths) - 0.02
    tmax = max(p[0][-1] for p in paths) + 0.02
    ns = int((tmax - tmin) * sro) + 16
    comps = comps_fn(ns, sro)
    rref = math.sqrt(Dd2)
    mono = None
    for tau, g, gpts in paths:
        r = C * (to - tau)
        idx = (tau - tmin) * sro
        th = np.arccos(np.clip(-(v * tau) / np.maximum(r, 1e-3), -1, 1))
        y = np.zeros(len(to))
        for sig, dfn in comps:
            y += interp_cubic(sig, idx) * dfn(th)
        y *= g * rref / np.maximum(r, 1.0)
        yd = resample_poly(y, 1, os_)
        rd = r[::os_][:len(yd)]
        if len(rd) < len(yd):
            rd = np.pad(rd, (0, len(yd) - len(rd)), mode='edge')

        def mk(f, t, rd=rd, gpts=gpts):
            ri = np.interp(t, np.arange(len(rd)) / SR, rd)
            G = db2a(np.maximum(-air * alpha_db(f)[:, None] * ri[None, :], -120.0))
            if gpts is not None:
                G = G * gain_curve(f, gpts)[:, None]
            return G
        yd = stft_mask(yd, mk, 2048, 256)
        mono = yd if mono is None else mono + yd[:len(mono)]
    tau = paths[0][0][::os_][:len(mono)]
    r = (C * (to - paths[0][0]))[::os_][:len(mono)]
    s = (v * tau) / np.maximum(r, 1e-3)
    pc = pan + (pan_to - pan) * (s + 1.0) / 2.0
    return spatialize(mono, pc), N(pre)


# ----------------------------------------------------------------------------- assets (CC0)
_ASSETS = {}


def load_asset(fname):
    if fname in _ASSETS:
        return _ASSETS[fname]
    x = None
    try:
        y, sr = sf.read(os.path.join(ASSET_DIR, fname), always_2d=True)
        y = y.mean(axis=1)
        if sr != SR:
            g = math.gcd(SR, sr)
            y = resample_poly(y, SR // g, sr // g)
        x = norm_rms(y - y.mean())
    except Exception as e:  # noqa
        sys.stderr.write(f'[sfx] asset {fname} unavailable ({e}); pure synthesis\n')
    _ASSETS[fname] = x
    return x


def loop_to(x, n, rng, xfade=0.4):
    """Loop a texture to n samples with equal-power crossfades, random start offset."""
    xf = min(N(xfade), len(x) // 4)
    out = np.zeros(n)
    pos = 0
    off = int(rng.integers(0, max(1, len(x) - xf * 2)))
    seg = x[off:]
    w_in = np.sin(np.linspace(0, np.pi / 2, xf))
    w_out = np.cos(np.linspace(0, np.pi / 2, xf))
    first = True
    while pos < n:
        s = seg.copy()
        if not first:
            s[:xf] *= w_in
        s[-xf:] *= w_out
        place(out, s, pos)
        pos += len(s) - xf
        seg = x
        first = False
    return out


# ============================================================================= KINDS
# smoothing window (s) that DEFINES "peak" for each peak-anchored kind (generator and verifier agree)
PEAK_WIN = {'whoosh': 0.02, 'flyby': 0.15, 'airliner_pass': 0.25}


def P(ev, k, d):
    v = ev.get(k, d)
    return d if v is None else v


def gen_jet_bed(ev, rng):
    dur = P(ev, 'dur', 4.0)
    I = float(P(ev, 'intensity', 0.6))
    view = P(ev, 'view', 'external')
    n = N(dur)
    rum = shaped_noise(n, rng, [(20, -8), (40, 0), (90, 0), (160, -6), (300, -18), (600, -32), (1200, -50)])
    rum *= db2a(1.6 * mod_signal(n, rng, 5, 14))                      # combustion flutter
    roar_pts = [(20, -30), (60, -12), (150, -2), (300, 0), (700, -3 + 4 * I), (1500, -9 + 6 * I),
                (3000, -17 + 7 * I), (6000, -26 + 8 * I), (12000, -38 + 8 * I), (20000, -55)]
    surge = db2a(1.2 * mod_signal(n, rng, 0.2, 2.5))
    roar = stereo_noise(n, rng, roar_pts, corr=0.55) * surge
    air_pts = [(80, -30), (300, -14), (1000, -5), (2500, -3), (5000, -7), (10000, -15), (18000, -30)]
    gust = db2a(2.5 * mod_signal(n, rng, 0.05, 0.6))
    air = stereo_noise(n, rng, air_pts, corr=0.3) * gust
    wh = tones(n, rng, [2210.0, 3380.0, 4420.0], [0, -4, -12], jitter=0.002, nb=0.5)
    g_rum, g_roar, g_air, g_wh = db2a(0), db2a(-3 + 4 * I), db2a(-9 + 6 * I), db2a(-27 + 8 * I)
    if view == 'cockpit':
        roar = np.stack([filt(ch, 'lowpass', 2500, 2) for ch in roar])
        g_rum, g_air, g_wh = db2a(2), db2a(-6 + 6 * I), db2a(-22 + 8 * I)
    st = roar * g_roar + air * g_air
    st += (rum * g_rum + wh * g_wh)[None, :] * 0.7071
    eng = load_asset('engine.mp3') if P(ev, 'asset', True) else None
    if eng is not None:
        e = filt(loop_to(eng, n, rng), 'lowpass', 380, 2)
        st += (norm_rms(e) * db2a(-7))[None, :] * 0.7071
    st = fade(st, P(ev, 'fade_in', 0.5), P(ev, 'fade_out', 0.8))
    return balance(st, P(ev, 'pan', 0.0)), 0


def gen_flyby(ev, rng):
    pre, post = P(ev, 'pre', 3.5), P(ev, 'post', 4.0)
    st, cpa = render_pass(
        fighter_comps(rng, P(ev, 'intensity', 0.9), P(ev, 'crackle', 0.35),
                      (2380.0 * P(ev, 'whine', 1.0), 3710.0 * P(ev, 'whine', 1.0)), P(ev, 'whine_db', -9.0)),
        v=P(ev, 'speed', 165.0), y_off=P(ev, 'distance', 45.0), h=P(ev, 'height', 30.0), pre=pre, post=post,
        ground=P(ev, 'ground', 'water'), refl=P(ev, 'refl', 0.8), pan=P(ev, 'pan', -0.9),
        pan_to=P(ev, 'pan_to', 0.9), air=P(ev, 'air', 0.6))
    st = fade(st, min(1.0, pre * 0.4), min(1.5, post * 0.4))
    st = reverb(st, P(ev, 'space', 'outdoor'), P(ev, 'wet_db', -13))
    return st, peak_index(st, PEAK_WIN['flyby'], cpa - N(1.2), cpa + N(1.5))


def gen_airliner_pass(ev, rng):
    pre, post = P(ev, 'pre', 5.0), P(ev, 'post', 5.5)
    st, cpa = render_pass(
        turbofan_comps(rng, P(ev, 'n1', 46.0), 22, P(ev, 'thrust', 0.55)),
        v=P(ev, 'speed', 70.0), y_off=P(ev, 'distance', 90.0), h=P(ev, 'height', 20.0), pre=pre, post=post,
        ground=P(ev, 'ground', False), refl=P(ev, 'refl', 0.7), pan=P(ev, 'pan', -0.8),
        pan_to=P(ev, 'pan_to', 0.8), air=P(ev, 'air', 0.9))
    st = fade(st, min(1.5, pre * 0.4), min(2.0, post * 0.4))
    sw = P(ev, 'sweeten_db', -10.0)
    if sw is not None and sw > -60:        # trailer sweetener: a long air whoosh riding the CPA
        w, wa = gen_whoosh({'variant': 'long', 'pan': P(ev, 'pan', -0.8), 'pan_to': P(ev, 'pan_to', 0.8),
                            'wet_db': -40}, rng)
        k = peak_index(st, 0.2, cpa - N(1.5), cpa + N(2.0))
        scale = db2a(sw) * np.max(smooth_env(st, 0.2)) / (np.max(smooth_env(w, 0.2)) + 1e-12)
        tmp = np.zeros((2, max(st.shape[1], k - wa + w.shape[1])))
        tmp[:, :st.shape[1]] += st
        for ch in range(2):
            place(tmp[ch], w[ch] * scale, k - wa)
        st = tmp
    st = reverb(st, P(ev, 'space', 'air'), P(ev, 'wet_db', -22))
    return st, peak_index(st, PEAK_WIN['airliner_pass'], cpa - N(0.6), cpa + N(0.6))


def gen_afterburner(ev, rng):
    dur = P(ev, 'dur', 3.0)
    pre, tail = 0.35, 1.6
    I = P(ev, 'intensity', 1.0)
    n = N(pre + dur + tail)
    T = lambda tt: tt - pre  # noqa: E731  (frame time -> time from ignition)
    # roar (stereo), brightening on light-off
    lst = stereo_noise(n, rng, LST_PTS, corr=0.6)
    fst = stereo_noise(n, rng, FST_PTS, corr=0.4)
    roar = (lst * db2a(2.0 * mod_signal(n, rng, 3, 18)) + 0.6 * fst)
    env_r = env_pts([(-pre, -40), (-0.04, -34), (0.0, -36), (0.05, -8), (0.2, 0), (dur, -1.5), (dur + tail, -60)], n,
                    db=True, t0=-pre)
    pull = P(ev, 'pull_away', True)
    fc_pts = [(-pre, 500), (0.0, 700), (0.12, 3500), (0.35, 9000), (dur, 2600 if pull else 7000),
              (dur + tail, 1200)]
    fcf = lambda t: np.exp(np.interp(T(t), [p[0] for p in fc_pts], np.log([p[1] for p in fc_pts])))  # noqa
    roar = np.stack([tv_lowpass(ch * env_r, fcf, 2) for ch in roar])
    if pb is not None:
        grit = pb.Pedalboard([pb.Distortion(drive_db=10.0)])(roar.astype(np.float32), SR).astype(float)
        roar = roar + 0.35 * grit * (rms(roar) / (rms(grit) + 1e-12))
    # crackle, bursty, scattered across the image
    ck = np.stack([crackle_sig(n, rng, 260 * I) for _ in range(2)])
    ck = 0.6 * ck + 0.4 * ck[::-1]
    env_c = env_pts([(-pre, -60), (0.04, -40), (0.25, 0), (dur, -3), (dur + tail * 0.6, -60)], n, db=True,
                    t0=-pre)
    ck = ck * env_c * db2a(-9)
    st = roar + ck
    if pull:   # pulling away: gentle Doppler drop (read rate 1 -> 0.9)
        rr = np.interp(np.arange(n) / SR - pre, [0.25, dur + tail], [1.0, 0.9])
        st = varispeed(st, rr)
        st = np.pad(st, ((0, 0), (0, max(0, n - st.shape[1]))))[:, :n]
    # spool / intake suck before light-off
    tsp = np.arange(N(pre)) / SR
    spool = tones(N(pre), rng, [2400.0, 3600.0], [0, -6], nb=0.3) * np.exp(-(pre - 0.04 - tsp) / 0.12)
    kx = N(pre - 0.04)                       # intake 'suck' gap: silent for the last 40 ms
    spool[kx:] = 0.0
    spool[:kx] = fade(spool[:kx], 0.02, 0.01)
    # light-off: deep 'whoomp' + pressure thump
    k = N(0.8)
    tt = np.arange(k) / SR
    f = 34.0 + 46.0 * np.exp(-tt / 0.06)
    whoomp = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdecay(k, 0.28, attack=0.004)
    thump = norm_rms(filt(rng.standard_normal(k), 'lowpass', 220, 4)) * expdecay(k, 0.09, attack=0.003)
    bang = norm_rms(filt(rng.standard_normal(k), 'bandpass', [180, 2800], 2)) * expdecay(k, 0.022,
                                                                                           attack=0.0008)
    lo = saturate(whoomp * 1.0 + thump * 0.55 + bang * 0.35, 1.8)
    mono = np.zeros(n)
    place(mono, lo * 1.4 * rms(st[:, N(pre):N(pre + 0.6)]) / (rms(lo[:N(0.3)]) + 1e-12), N(pre))
    place(mono, spool * 0.1 * rms(st[:, N(pre):N(pre + 0.6)]) / (rms(spool) + 1e-12), 0)
    st = st + spatialize(mono, P(ev, 'pan', 0.0))
    st = balance(st, P(ev, 'pan', 0.0))
    st = fade(st, 0.01, 0.2)
    st = reverb(st, P(ev, 'space', 'outdoor'), P(ev, 'wet_db', -13))
    return st, N(pre)


def gen_sonic_boom(ev, rng):
    Tn = P(ev, 'n_dur', 0.15)             # N-wave duration (bow shock -> tail shock)
    rise = P(ev, 'rise_ms', 0.8) / 1000.0
    lead, tail = 0.03, P(ev, 'tail', 5.0)
    n = N(lead + Tn + tail)
    t = np.arange(n) / SR - lead
    nw = np.where((t >= 0) & (t < Tn), 1.0 - 2.0 * t / Tn, 0.0)
    k = N(rise)
    ker = np.hanning(2 * k + 1)
    nw = fftconvolve(nw, ker / ker.sum(), 'same')
    nw = filt(nw, 'highpass', 20.0, 2)
    sizz = np.zeros(n)
    sub = np.zeros(n)
    body = np.zeros(n)
    for tc, a in ((0.0, 1.0), (Tn, 0.85)):
        i = N(lead + tc)
        m = n - i
        tt = np.arange(m) / SR
        sizz[i:] += a * norm_rms(filt(rng.standard_normal(m), 'highpass', 2500, 2)) * expdecay(m, 0.012, attack=0.0003)
        f = 36.0 + 44.0 * np.exp(-tt / 0.05)
        sub[i:] += a * np.sin(2 * np.pi * np.cumsum(f) / SR) * expdecay(m, 0.4, attack=0.002)
        body[i:] += a * norm_rms(filt(rng.standard_normal(m), 'lowpass', 320, 4)) * expdecay(m, 0.06, attack=0.001)
    main = nw / (np.max(np.abs(nw)) + 1e-12) + 0.25 * sizz + 0.4 * sub + 0.12 * body
    main = saturate(main, 1.7)
    st = spatialize(main, P(ev, 'pan', 0.0))
    # rolling terrain echoes of the (dulled) boom
    src = filt(main, 'lowpass', 900, 2)
    for d, g, fc in ((0.28, -9, 900), (0.47, -11, 700), (0.71, -13, 550), (1.05, -16, 420), (1.4, -18, 330),
                     (1.9, -21, 260), (2.5, -24, 200)):
        e = np.zeros(n)
        place(e, filt(src, 'lowpass', fc, 2) * db2a(g), N(d))
        st += spatialize(e, rng.uniform(-0.8, 0.8))
    # rumble bed
    rb = stereo_noise(n, rng, [(20, -4), (40, 0), (80, 0), (160, -6), (320, -18), (800, -34)], corr=0.3)
    t2 = t - (Tn + 0.03)                      # rumble swells in after the second crack
    env = np.exp(-6.9 * np.maximum(t2, 0) / 3.4) * (1 - np.exp(-np.maximum(t2, 0) / 0.12)) * (t2 > 0)
    st += rb * env * db2a(-13) * np.max(np.abs(main))
    st = fade(st, 0.005, 0.3)
    st = reverb(st, P(ev, 'space', 'valley'), P(ev, 'wet_db', -12))
    return st, N(lead)


def gen_whoosh(ev, rng):
    var = P(ev, 'variant', 'short')
    if var == 'long':
        pre, post, d, v, flo, fhi = 1.6, 1.0, 6.0, 22.0, 220.0, 5200.0
    else:
        pre, post, d, v, flo, fhi = 0.5, 0.45, 2.0, 40.0, 380.0, 7000.0
    pre, post = P(ev, 'pre', pre), P(ev, 'post', post)
    n = N(pre + post)
    noise = 0.75 * shaped_noise(n, rng, [(20, -20), (100, -6), (400, 0), (1500, -2), (4000, -5), (10000, -12),
                                          (20000, -30)]) + 0.25 * norm_rms(rng.standard_normal(n))

    def geom(t):
        tf = t - pre
        te = np.where(tf < 0, tf, tf * 1.5)      # quicker release than build
        r = np.sqrt(d * d + (v * te) ** 2)
        return d / r, (v * tf) / np.sqrt(d * d + (v * tf) ** 2)

    def mk(f, t):
        prox, s = geom(t)
        fc = (flo + (fhi - flo) * prox ** 1.3) * (1.0 - 0.22 * s)
        band = np.exp(-0.5 * (np.log2(np.maximum(f, 1.0)[:, None] / fc[None, :]) / 0.85) ** 2)
        return (prox ** P(ev, 'sharp', 2.4 if var == 'long' else 3.0))[None, :] * (band + 0.1)
    y = stft_mask(noise, mk, 2048, 256)
    tt = np.arange(n) / SR
    prox, s = geom(tt)
    body = norm_rms(filt(rng.standard_normal(n), 'lowpass', 180, 4)) * prox ** 3.0
    y = y + P(ev, 'weight', 0.5) * body * rms(y) / (rms(body) + 1e-12)
    pan, pan_to = P(ev, 'pan', -0.7), P(ev, 'pan_to', 0.7)
    st = spatialize(y, pan + (pan_to - pan) * (s + 1) / 2)
    st = fade(st, 0.02, 0.05)
    st = reverb(st, P(ev, 'space', 'outdoor'), P(ev, 'wet_db', -16))
    return st, peak_index(st, PEAK_WIN['whoosh'], N(pre) - N(0.3), N(pre) + N(0.3))


def bell_partials(n, rng, freqs, decay, detune=0.003, ratios=(1.0, 2.76, 5.40), rdecay=(1.0, 0.5, 0.25),
                  rgain=(1.0, 0.35, 0.12), sr=SR):
    t = np.arange(n) / sr
    y = np.zeros(n)
    for f in freqs:
        for r, dk, g in zip(ratios, rdecay, rgain):
            ff = f * r
            if ff > 0.45 * sr:
                continue
            for dt in (-detune, detune):
                y += g * np.sin(2 * np.pi * ff * (1 + dt) * t + rng.uniform(0, 6.28)) * np.exp(-t / (decay * dk))
    return y * attack_ramp(n, 0.002, sr)


def gen_warp(ev, rng):
    pre, tail = P(ev, 'pre', 2.5), P(ev, 'tail', 3.5)
    gap = P(ev, 'gap', 0.035)
    n = N(pre + tail)
    i0 = N(pre)
    chord = [587.33, 880.0, 1174.66, 1760.0, 2349.32, 3520.0]  # D5 A5 D6 A6 D7 A7 -- sits on the D score
    hit = bell_partials(N(2.0), rng, chord, 0.9)
    wet = lead_trim(reverb(spatialize(hit, 0.0), 'shimmer', 0.0, dry=0.0))
    rev = wet[:, ::-1]                                            # reverse shimmer swell (ends on the strike)
    m = N(pre)
    seg = rev[:, -m:] if rev.shape[1] >= m else np.pad(rev, ((0, 0), (m - rev.shape[1], 0)))
    st = np.zeros((2, n))
    end = i0 - N(gap)
    for ch in range(2):
        place(st[ch], seg[ch], end - m)
    st = st / (np.max(np.abs(st)) + 1e-12)
    # noise riser, band centre 300 Hz -> 9 kHz, stereo-decorrelated
    rn = stereo_noise(n, rng, [(20, -10), (1000, 0), (20000, -6)], corr=0.2)

    def mk(f, t):
        x = np.clip(t / pre, 0, 1)
        fc = 300.0 * (9000.0 / 300.0) ** (x ** 1.5)
        amp = db2a(-36 + 36 * x ** 1.8) * (t < pre - gap)
        band = np.exp(-0.5 * (np.log2(np.maximum(f, 1.0)[:, None] / fc[None, :]) / 0.7) ** 2)
        return band * amp[None, :]
    riser = np.stack([stft_mask(ch, mk) for ch in rn])
    riser = riser / (np.max(np.abs(riser)) + 1e-12) * 0.6
    st += riser
    # low suck-in (28 -> 60 Hz) over the last second
    ts = np.arange(N(1.0)) / SR
    suck = np.sin(2 * np.pi * np.cumsum(28 + 32 * (ts / 1.0) ** 2) / SR) * (ts / 1.0) ** 2 * 0.35
    suck = fade(suck, 0.05, 0.004)
    for ch in range(2):
        place(st[ch], suck * 0.7071, end - len(suck))
    st[:, end:i0] = 0.0
    xs = np.clip(np.arange(end) / max(1, end), 0, 1)
    st[:, :end] *= db2a(-24.0 * (1.0 - xs) ** 1.5)[None, :]   # steepen the crescendo (~30 dB over the swell)
    st[:, :end] = fade(st[:, :end], 0.3, 0.003)
    # impact at i0
    m = n - i0
    tt = np.arange(m) / SR
    trans = norm_rms(filt(rng.standard_normal(m), 'highpass', 1500, 2)) * expdecay(m, 0.018, attack=0.0006)
    shing = bell_partials(m, rng, [1318.5, 2637.0 * 1.013, 3951.1 * 0.991, 5274.0 * 1.02], 0.85,
                          ratios=(1.0,), rdecay=(1.0,), rgain=(1.0,))
    f = 36.71 + 73.0 * np.exp(-tt / 0.07)                        # sub drop to D1
    sub = saturate(np.sin(2 * np.pi * np.cumsum(f) / SR) * expdecay(m, 1.1, attack=0.002), 1.5)
    thump = norm_rms(filt(rng.standard_normal(m), 'lowpass', 350, 4)) * expdecay(m, 0.14, attack=0.001)
    imp = 0.5 * trans + 0.35 * shing / (np.max(np.abs(shing)) + 1e-12) + 1.0 * sub + 0.45 * thump
    ist = spatialize(imp, 0.0)
    fwd = bell_partials(N(2.5), rng, chord, 1.1)
    fwd = reverb(spatialize(fwd / (np.max(np.abs(fwd)) + 1e-12), 0.0), 'shimmer', -3.0, dry=0.5)
    wo = stereo_noise(m, rng, [(20, -10), (500, 0), (4000, -2), (16000, -14)], corr=0.2)
    wo = np.stack([tv_lowpass(ch, lambda t: 9000.0 * np.exp(-t / 0.6) + 600.0, 2) for ch in wo])
    wo *= np.exp(-tt / 0.7)[None, :] * attack_ramp(m, 0.01)[None, :] * 0.25
    for ch in range(2):
        place(st[ch], ist[ch] * 1.3, i0)
        place(st[ch], fwd[ch] * 0.28, i0)
        place(st[ch], wo[ch], i0)
    st = fade(st, 0.0, 0.3)
    st = reverb(st, P(ev, 'space', 'huge'), P(ev, 'wet_db', -16))
    return balance(st, P(ev, 'pan', 0.0)), i0


def fm_tone(n, f, ratio=2.0, index=0.8, idecay=0.05, adecay=0.12, attack=0.0015, sr=SR):
    t = np.arange(n) / sr
    return (np.sin(2 * np.pi * f * t + index * np.exp(-t / idecay) * np.sin(2 * np.pi * f * ratio * t))
            * np.exp(-t / adecay) * attack_ramp(n, attack, sr))


def ui_space(st, ev, taps=((0.11, -16, 0), (0.22, -22, 1))):
    n = st.shape[1]
    out = np.zeros((2, n + N(0.3)))
    out[:, :n] += st
    for d, g, side in taps:
        mono = filt(st.mean(axis=0), 'lowpass', 5000, 2) * db2a(g)
        place(out[side], mono, N(d))
    return reverb(out, P(ev, 'space', 'room'), P(ev, 'wet_db', -16))


def gen_ui_blip(ev, rng):
    notes = P(ev, 'notes', [1760.0, 2349.32])     # A6 -> D7
    sp = P(ev, 'spacing', 0.05)
    n = N(0.6)
    y = np.zeros(n)
    for i, f in enumerate(notes):
        k = N(0.4)
        tone = fm_tone(k, f, 3.0, 0.6, 0.02, 0.075) + 0.2 * fm_tone(k, f / 2, 1.0, 0.0, 1, 0.05)
        place(y, tone * (1.0 if i == 0 else 0.7), N(i * sp))
    st = spatialize(y, P(ev, 'pan', 0.0))
    # holographic 'materialise' grains
    g = np.zeros((2, n))
    for _ in range(26):
        k = N(rng.uniform(0.004, 0.009))
        f = rng.uniform(3500, 9000)
        gr = np.sin(2 * np.pi * f * np.arange(k) / SR) * np.hanning(k)
        pos = N(rng.uniform(0.0, 0.18) ** 1.0)
        pp = rng.uniform(-0.8, 0.8)
        a = db2a(-17) * rng.uniform(0.4, 1.0)
        place(g[0], gr * a * math.cos((pp + 1) * np.pi / 4), pos)
        place(g[1], gr * a * math.sin((pp + 1) * np.pi / 4), pos)
    st = fade(st + g, 0.0, 0.05)
    return ui_space(st, ev), 0


def gen_ui_confirm(ev, rng):
    notes = P(ev, 'notes', [1174.66, 1760.0])     # D6 -> A6
    sp = P(ev, 'spacing', 0.09)
    n = N(1.0)
    y = np.zeros(n)
    for i, f in enumerate(notes):
        k = N(0.9)
        tone = (fm_tone(k, f, 1.0, 1.2, 0.03, 0.28) + 0.45 * fm_tone(k, f, 3.5, 0.3, 0.02, 0.12)
                + 0.3 * fm_tone(k, f / 2, 1.0, 0.0, 1, 0.2))
        place(y, tone * (0.8 if i == 0 else 1.0), N(i * sp))
    sw = norm_rms(filt(rng.standard_normal(N(0.06)), 'highpass', 5000, 2)) * expdecay(N(0.06), 0.015) * db2a(-26)
    place(y, sw, 0)
    st = fade(spatialize(y, P(ev, 'pan', 0.0)), 0.0, 0.1)
    return ui_space(st, ev, taps=((0.14, -18, 0), (0.28, -24, 1))), 0


def gen_ui_type(ev, rng):
    text = P(ev, 'text', None)
    nk = len(text) if text else int(P(ev, 'n', max(3, int(P(ev, 'dur', 0.8) / 0.09))))
    rate = P(ev, 'interval', 0.085)
    times = [0.0]
    for _ in range(nk - 1):
        times.append(times[-1] + rate * rng.uniform(0.7, 1.35) + (0.12 if rng.random() < 0.08 else 0.0))
    n = N(times[-1] + 0.4)
    st = np.zeros((2, n))
    for i, tk in enumerate(times):
        k = N(0.05)
        tt = np.arange(k) / SR
        fc = rng.uniform(2600, 4200)
        click = norm_rms(filt(rng.standard_normal(k), 'bandpass', [fc * 0.6, min(fc * 1.8, 18000)], 2)) * expdecay(k, 0.0025, attack=0.0002)
        tick = np.sin(2 * np.pi * rng.uniform(2800, 3300) * tt) * expdecay(k, 0.007, attack=0.0004)
        thock = np.sin(2 * np.pi * rng.uniform(180, 240) * tt) * expdecay(k, 0.010, attack=0.0008)
        key = 0.5 * click + 0.35 * tick + 0.3 * thock
        key *= rng.uniform(0.75, 1.0)
        kst = spatialize(key, P(ev, 'pan', 0.0) + rng.uniform(-0.15, 0.15))
        for ch in range(2):
            place(st[ch], kst[ch], N(tk))
    return ui_space(fade(st, 0.0, 0.05), ev, taps=((0.07, -24, 0),)), 0


SELCAL = [312.6, 346.7, 384.6, 426.6, 473.2, 524.8, 582.1, 645.7, 716.1, 794.3, 881.0, 977.2, 1083.9, 1202.3,
          1333.5, 1479.1]


def gen_radio(ev, rng):
    """Aviation AM radio texture: PTT clicks, squelch open/tail bursts, band-limited static with
    fading and crackle, heterodyne whistles, SELCAL two-tone chimes and 1 kHz beeps. No speech."""
    dur = P(ev, 'dur', 6.0)
    n = N(dur)
    tx = P(ev, 'transmissions', None)
    if tx is None:
        tx, t = [], rng.uniform(0.05, 0.4)
        modes = P(ev, 'modes', ['selcal', 'carrier', 'beeps', 'hetero', 'carrier'])
        while t < dur - 0.7:
            L = min(rng.uniform(0.9, 2.1), dur - t - 0.25)
            tx.append([t, L, modes[len(tx) % len(modes)]])
            t += L + rng.uniform(0.35, 1.0)
    static = norm_rms(shaped_noise(n, rng, [(200, -10), (1000, 0), (2500, -2), (4000, -12)]))
    static *= db2a(3.0 * mod_signal(n, rng, 0.3, 2.5))           # AM fading
    crk = crackle_sig(n, rng, 25.0) * 0.6
    y = static * db2a(P(ev, 'floor_db', -30))                     # closed-squelch hiss floor
    for ts, L, mode in tx:
        i0, i1 = N(ts), N(ts + L)
        m = i1 - i0
        tt = np.arange(m) / SR
        seg = static[i0:i1] * db2a(-9) + crk[i0:i1] * db2a(-10)
        burst = static[i0:i1] * (db2a(4) * np.exp(-tt / 0.05))    # squelch opening
        content = np.zeros(m)
        if mode == 'selcal':
            a, b, c, d = rng.choice(SELCAL, 4, replace=False)
            for k0, (fa, fb) in enumerate(((a, b), (c, d))):
                s0, s1 = 0.12 + k0 * 1.05, 0.12 + k0 * 1.05 + 0.95
                if s1 > L - 0.1:
                    s1 = L - 0.1
                if s1 <= s0:
                    break
                w = ((tt >= s0) & (tt < s1)).astype(float)
                w = uniform_filter1d(w, N(0.006))
                content += w * (np.sin(2 * np.pi * fa * tt) + np.sin(2 * np.pi * fb * tt)) * 0.5
            content *= db2a(-4)
        elif mode == 'beeps':
            for k0 in range(3):
                s0 = 0.15 + 0.22 * k0
                w = uniform_filter1d(((tt >= s0) & (tt < s0 + 0.13)).astype(float), N(0.005))
                content += w * np.sin(2 * np.pi * 1020.0 * tt)
            content *= db2a(-6)
        elif mode == 'hetero':
            f = rng.uniform(1300, 2300) + 40 * mod_signal(m, rng, 0.2, 1.0)
            content = np.sin(2 * np.pi * np.cumsum(f) / SR) * db2a(-13) * (1 - np.exp(-tt / 0.08))
        else:   # open carrier: hum + hiss
            content = (np.sin(2 * np.pi * 400 * tt) + 0.4 * np.sin(2 * np.pi * 800 * tt)) * db2a(-24)
        segtot = seg + burst + content
        segtot = fade(segtot, 0.001, 0.004)
        y[i0:i1] += segtot
        # PTT key-up and key-down clicks + squelch tail
        for ci in (i0, i1):
            k = N(0.012)
            place(y, norm_rms(filt(np.r_[1.0, np.zeros(k - 1)], 'bandpass', [600, 3200], 2)) * db2a(0) * 0.25, ci)
        tl = N(0.14)
        tail = static[:tl] * db2a(3) * np.exp(-np.arange(tl) / SR / 0.05)
        place(y, fade(tail, 0.002, 0.01), i1)
    # radio chain: band-limit 300-3000, AM 'honk', clip, band-limit again
    y = filt(y, 'bandpass', [300, 3000], 4)
    if pb is not None:
        y = pb.Pedalboard([pb.PeakFilter(1700, 4.0, 1.2)])(y.astype(np.float32)[None, :], SR)[0].astype(float)
    y = saturate(y, 2.4)
    y = filt(y, 'bandpass', [300, 3000], 3)
    st = fade(spatialize(y, P(ev, 'pan', 0.0), itd_scale=0.3), P(ev, 'fade_in', 0.01), P(ev, 'fade_out', 0.05))
    return reverb(st, P(ev, 'space', None), P(ev, 'wet_db', -30)), 0


def gen_wind_high(ev, rng):
    dur = P(ev, 'dur', 6.0)
    I = P(ev, 'intensity', 0.6)
    n = N(dur)
    gust = mod_signal(n, rng, 0.05, 0.5)
    rush = stereo_noise(n, rng, [(20, -16), (60, -6), (150, -1), (400, 0), (1000, -3), (2500, -8), (6000, -15),
                                 (12000, -26), (20000, -45)], corr=0.35)
    gcr = np.interp(np.arange(0, n, 256), np.arange(n), gust)

    def tilt(f, t):
        gi = np.interp(t, np.arange(len(gcr)) * 256 / SR, gcr)
        return (np.maximum(f, 50.0)[:, None] / 800.0) ** (0.22 * np.clip(gi, -2.5, 2.5)[None, :])
    rush = np.stack([stft_mask(ch, tilt) for ch in rush]) * db2a((3.0 + 2 * I) * gust)[None, :]
    # howl: two drifting narrow resonances
    how = np.zeros((2, n))
    for ch in range(2):
        x = rng.standard_normal(n)
        f0 = rng.uniform(380, 700) * (1 + 0.3 * I)
        drift = mod_signal(n, rng, 0.03, 0.3)
        dcr = np.interp(np.arange(0, n, 256), np.arange(n), drift)

        def band(f, t, f0=f0, dcr=dcr):
            fc = f0 * 2 ** (0.35 * np.interp(t, np.arange(len(dcr)) * 256 / SR, dcr))
            return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0)[:, None] / fc[None, :]) / 0.05) ** 2)
        how[ch] = norm_rms(stft_mask(x, band, 4096, 512))
    how *= db2a(-15 + 5 * I + 3.5 * gust)[None, :]
    st = rush + how
    wav = load_asset('wind.ogg') if P(ev, 'asset', True) else None
    if wav is not None:
        w = loop_to(wav, int(n * 1.15) + 100, rng)
        w = varispeed(w, 1.0 + 0.08 * mod_signal(int(n * 1.15) + 100, rng, 0.03, 0.2))[0][:n]
        w = np.pad(w, (0, n - len(w)))
        st += spatialize(norm_rms(w) * db2a(-16 + 3 * gust), 0.25 * mod_signal(n, rng, 0.02, 0.1))
    st = fade(st, P(ev, 'fade_in', 1.0), P(ev, 'fade_out', 1.0))
    return balance(st, P(ev, 'pan', 0.0)), 0


def gen_clouds_rush(ev, rng):
    dur = P(ev, 'dur', 2.5)
    n = N(dur)
    t = np.arange(n) / SR
    a_in, a_out = min(0.4, dur * 0.2), min(0.6, dur * 0.3)
    base = stereo_noise(n, rng, [(20, -12), (60, -3), (200, 0), (800, -2), (2500, -6), (7000, -14),
                                 (16000, -28)], corr=0.4)

    def fcf(tt):   # bright at entry/exit, muffled inside the cloud
        x = np.clip(tt / dur, 0, 1)
        inside = np.exp(-0.5 * ((x - 0.5) / 0.28) ** 2)
        return 7000.0 * (1 - inside) + 900.0 * inside
    base = np.stack([tv_lowpass(ch, fcf, 2) for ch in base])
    env = env_pts([(0, -40), (a_in, 0), (dur - a_out, -2), (dur, -40)], n, db=True)
    # buffeting: low thumps
    k = rng.poisson(9 * dur)
    buf = np.zeros(n)
    for p in rng.uniform(0, dur, k):
        m = N(rng.uniform(0.04, 0.1))
        b = norm_rms(filt(rng.standard_normal(m), 'lowpass', 120, 2)) * np.hanning(m) * rng.uniform(0.3, 1.0)
        place(buf, b, N(p))
    # droplets ticking on the canopy
    drop = np.zeros((2, n))
    for p in rng.uniform(0, dur, int(60 * dur)):
        m = N(rng.uniform(0.0006, 0.002))
        d = norm_rms(filt(rng.standard_normal(m + 8), 'highpass', 3500, 2))[:m] * np.hanning(m)
        side = rng.integers(0, 2)
        place(drop[side], d * rng.uniform(0.1, 0.5) * db2a(-14), N(p))
    st = base * env + spatialize(buf * 0.8, 0.0) * env + drop * np.sqrt(env)
    st = fade(st, 0.02, 0.05)
    return balance(st, P(ev, 'pan', 0.0)), 0


def gen_city_night(ev, rng):
    dur = P(ev, 'dur', 8.0)
    n = N(dur)
    hum = stereo_noise(n, rng, [(20, -12), (45, -3), (90, 0), (180, -3), (400, -12), (900, -24), (2000, -36),
                                (5000, -50)], corr=0.25) * db2a(2.0 * mod_signal(n, rng, 0.05, 0.3))[None, :]
    t = np.arange(n) / SR
    mains = sum(db2a(a) * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f, a in
                ((60, -30), (120, -24), (180, -32), (240, -36)))
    st = hum + (mains * db2a(P(ev, 'mains_db', 0)))[None, :] * 0.7071
    dist = np.zeros((2, n))
    for _ in range(int(P(ev, 'horns', max(1, round(dur / 5))))):
        f1 = rng.uniform(370, 430)
        L = rng.uniform(0.25, 0.55)
        m = N(L)
        tt = np.arange(m) / SR
        h = np.tanh(3 * np.sin(2 * np.pi * f1 * tt)) + 0.8 * np.tanh(3 * np.sin(2 * np.pi * f1 * 1.26 * tt))
        h = fade(h, 0.01, 0.03)
        if rng.random() < 0.5:   # double honk
            h = np.concatenate([h, np.zeros(N(0.12)), h[:N(0.2)] if len(h) > N(0.2) else h])
            h = fade(h, 0.0, 0.02)
        r = rng.uniform(500, 1500)
        h = filt(absorb(h, r, 1.5), 'lowpass', 1500, 2) * db2a(3)
        hst = spatialize(h, rng.uniform(-0.8, 0.8))
        pos = N(rng.uniform(0.3, max(0.4, dur - 1.5)))
        for ch in range(2):
            place(dist[ch], hst[ch], pos)
    for _ in range(int(P(ev, 'sirens', 1 if dur >= 5 else 0))):
        L = min(dur - 0.5, rng.uniform(4.0, 6.5))
        m = N(L)
        tt = np.arange(m) / SR
        f = 700 + 600 * (0.5 - 0.5 * np.cos(2 * np.pi * tt / 4.2 + rng.uniform(0, 3)))
        s = np.tanh(2.0 * np.sin(2 * np.pi * np.cumsum(f) / SR))
        s = filt(absorb(s, 1400, 1.5), 'lowpass', 1600, 2) * db2a(1) * np.hanning(m)
        sst = spatialize(s, np.linspace(rng.uniform(-0.8, 0), rng.uniform(0, 0.8), m))
        pos = N(rng.uniform(0.0, max(0.1, dur - L)))
        for ch in range(2):
            place(dist[ch], sst[ch], pos)
    dist = reverb(dist, 'city', -2.0, dry=0.5)[:, :n]
    st[:, :dist.shape[1]] += dist * db2a(P(ev, 'events_db', 0))
    st = fade(st, P(ev, 'fade_in', 1.5), P(ev, 'fade_out', 1.5))
    return balance(st, P(ev, 'pan', 0.0)), 0


def gen_water_skim(ev, rng):
    dur = P(ev, 'dur', 3.0)
    I = P(ev, 'intensity', 0.8)
    n = N(dur)
    spray = np.zeros((2, n))
    for ch in range(2):
        base = shaped_noise(n, rng, [(200, -30), (1000, -14), (2500, -5), (5000, 0), (8000, -1), (12000, -6),
                                     (18000, -16)])
        k = rng.poisson(420 * dur)
        imp = np.zeros(n)
        np.add.at(imp, rng.integers(0, n, k), rng.uniform(0.2, 1.0, k))
        kk = N(0.012)
        dens = fftconvolve(imp, np.exp(-np.arange(kk) / SR / 0.004))[:n]
        dens /= (dens.mean() + 1e-12)
        spray[ch] = base * (0.35 + 0.65 * dens)
    # Minnaert bubble plinks
    pl = np.zeros((2, n))
    for p in rng.uniform(0, dur, int(22 * dur)):
        m = N(rng.uniform(0.008, 0.02))
        tt = np.arange(m) / SR
        f0 = rng.uniform(1100, 4200)
        b = np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.15 * tt / tt[-1])) / SR) * expdecay(m, m / SR / 3, attack=0.0005)
        pp = rng.uniform(-0.9, 0.9)
        a = rng.uniform(0.1, 0.5) * db2a(-10)
        place(pl[0], b * a * math.cos((pp + 1) * np.pi / 4), N(p))
        place(pl[1], b * a * math.sin((pp + 1) * np.pi / 4), N(p))
    wash = stereo_noise(n, rng, [(20, -18), (60, -6), (200, 0), (500, -3), (1000, -10), (3000, -24)], corr=0.5)
    wash *= db2a(4.5 * mod_signal(n, rng, 0.5, 1.5))[None, :]
    slap = np.zeros(n)
    for p in rng.uniform(0, dur, int(2 * dur)):
        m = N(0.08)
        slap_s = norm_rms(filt(rng.standard_normal(m), 'lowpass', 140, 2)) * expdecay(m, 0.03, attack=0.004)
        place(slap, slap_s * rng.uniform(0.3, 1.0), N(p))
    st = spray * db2a(-2 + 3 * I) + pl + wash * db2a(-5) + spatialize(slap * 0.6, 0.0)
    if P(ev, 'swell', True):
        t = np.arange(n) / SR
        st *= db2a(-6 * (1 - np.exp(-0.5 * ((t / dur - 0.5) / 0.35) ** 2)))[None, :]
    st = fade(st, P(ev, 'fade_in', 0.25), P(ev, 'fade_out', 0.5))
    return balance(st, P(ev, 'pan', 0.0)), 0


def gen_formation_rumble(ev, rng):
    dur = P(ev, 'dur', 8.0)
    n = N(dur)
    nf = int(P(ev, 'fighters', 4))
    tanker = P(ev, 'tanker', True)
    n2 = int(n * 1.01) + 400
    st = np.zeros((2, n))
    spots = np.linspace(-0.75, 0.75, max(nf, 1)) if nf > 1 else [0.0]
    for i in range(nf):
        dist = rng.uniform(35, 140)
        th = rng.uniform(1.3, 2.3)
        wf = 1.0 + rng.uniform(-0.03, 0.03)
        comps = fighter_comps(rng, 0.7, 0.0, (2380.0 * wf, 3710.0 * wf))(n2, SR)
        sig = sum(c * d(th) for c, d in comps)
        ratio = 1.0 + 0.003 * mod_signal(n2, rng, 0.03, 0.2)          # slow relative motion
        sig = varispeed(sig, ratio)[0][:n]
        sig = np.pad(sig, (0, n - len(sig)))
        sig = absorb(sig, dist, 1.0) * (40.0 / dist)
        pc = np.clip(spots[i] + rng.uniform(-0.1, 0.1) + 0.08 * mod_signal(n, rng, 0.02, 0.1), -0.95, 0.95)
        st += spatialize(sig, pc)
    if tanker:
        comps = turbofan_comps(rng, 40.0, 22, 0.7)(n2, SR)
        sig = sum(c * d(P(ev, 'tanker_angle', 1.2)) for c, d in comps)
        sig = varispeed(sig, 1.0 + 0.002 * mod_signal(n2, rng, 0.02, 0.1))[0][:n]
        sig = np.pad(sig, (0, n - len(sig)))
        sig = absorb(sig, 90.0, 1.0) * (40.0 / 90.0) * db2a(P(ev, 'tanker_db', 3.0))
        st += spatialize(sig, 0.1)
    rum = shaped_noise(n, rng, [(20, -4), (35, 0), (70, 0), (120, -8), (250, -24)])
    rum *= db2a(2.5 * mod_signal(n, rng, 0.5, 4.0))
    st += (rum * rms(st) * db2a(-3))[None, :] * 0.7071
    st = fade(st, P(ev, 'fade_in', 1.2), P(ev, 'fade_out', 1.5))
    st = reverb(st, P(ev, 'space', 'air'), P(ev, 'wet_db', -20))
    return balance(st, P(ev, 'pan', 0.0)), 0


def gen_impact_low(ev, rng):
    fe = P(ev, 'freq', 36.71)       # D1
    tail = P(ev, 'tail', 2.5)
    n = N(tail + 0.3)
    t = np.arange(n) / SR
    f = fe + 2.2 * fe * np.exp(-t / 0.045)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / P(ev, 'decay', 0.7)) * attack_ramp(n, 0.0015)
    body = norm_rms(filt(rng.standard_normal(n), 'lowpass', 250, 4)) * expdecay(n, 0.12, attack=0.001)
    click = norm_rms(filt(rng.standard_normal(n), 'bandpass', [1500, 6000], 2)) * expdecay(n, 0.006, attack=0.0004)
    x = saturate(sub + 0.45 * body + 0.12 * P(ev, 'click', 1.0) * click, P(ev, 'drive', 2.0))
    st = spatialize(fade(x, 0.0, 0.2), P(ev, 'pan', 0.0))
    st = reverb(st, P(ev, 'space', 'huge'), P(ev, 'wet_db', -14))
    return st, 0


def gen_reverse_swell(ev, rng):
    dur = P(ev, 'dur', 1.5)
    k = N(0.4)
    crash = norm_rms(shaped_noise(k, rng, [(100, -12), (400, -3), (2000, 0), (8000, -3), (16000, -10)])) * expdecay(k, 0.09)
    boom = np.sin(2 * np.pi * 45 * np.arange(k) / SR) * expdecay(k, 0.25)
    shine = bell_partials(k, rng, [587.33, 880.0, 1760.0], 0.3)
    src = crash + 0.6 * boom + 0.25 * shine / (np.max(np.abs(shine)) + 1e-12)
    ir = make_ir('huge')
    wet = np.stack([fftconvolve(src, ir[0]), fftconvolve(src, ir[1])])
    wet = lead_trim(wet)
    rev = wet[:, ::-1]
    m = N(dur)
    rev = rev[:, -m:] if rev.shape[1] >= m else np.pad(rev, ((0, 0), (m - rev.shape[1], 0)))
    tt = np.arange(m) / SR

    def fcf(t):
        return 400.0 * (16000.0 / 400.0) ** np.clip(t / dur, 0, 1) ** 1.3
    rev = np.stack([tv_lowpass(ch, fcf, 2) for ch in rev])
    rev *= ((tt / dur) ** 1.6)[None, :]
    rev = fade(rev, 0.05, 0.0015)
    return balance(rev, P(ev, 'pan', 0.0)), m


def gen_cut(ev, rng):   # handled by the timeline
    return np.zeros((2, 1)), 0


KINDS = {
    #  name            fn                  anchor   level  scaled-by-pitch      params (for --list)
    'jet_bed':          (gen_jet_bed,         'start', -4.0, ['dur'], 'dur, intensity 0..1, view external|cockpit, fade_in, fade_out, asset'),
    'flyby':            (gen_flyby,           'peak',   2.0, ['pre', 'post'], 'pan->pan_to, speed m/s, distance, height, crackle 0..1, intensity, ground water|grass|hard|false, air, whine, pre, post, space, wet_db'),
    'afterburner':      (gen_afterburner,     'onset',  2.0, ['dur'], 'dur, intensity, pull_away, pan, space, wet_db'),
    'sonic_boom':       (gen_sonic_boom,      'onset',  3.0, ['tail'], 'n_dur (N-wave s), rise_ms, tail, pan, space, wet_db'),
    'whoosh':           (gen_whoosh,          'peak',  -2.0, ['pre', 'post'], 'variant short|long, pan->pan_to, weight, pre, post, space, wet_db'),
    'warp':             (gen_warp,            'onset',  2.0, ['pre', 'tail'], 'pre (swell s), tail, gap, pan, space, wet_db'),
    'ui_blip':          (gen_ui_blip,         'onset', -9.0, [], 'notes [Hz], spacing, pan'),
    'ui_confirm':       (gen_ui_confirm,      'onset', -8.0, [], 'notes [Hz], spacing, pan'),
    'ui_type':          (gen_ui_type,         'onset', -13.0, [], 'text | n | dur, interval, pan'),
    'radio':            (gen_radio,           'start', -10.0, ['dur'], 'dur, transmissions [[t,len,mode]], modes [selcal|beeps|hetero|carrier], floor_db, pan'),
    'wind_high':        (gen_wind_high,       'start', -6.0, ['dur'], 'dur, intensity, fade_in, fade_out, asset, pan'),
    'clouds_rush':      (gen_clouds_rush,     'start', -2.0, ['dur'], 'dur, pan'),
    'city_night':       (gen_city_night,      'start', -12.0, ['dur'], 'dur, horns, sirens, events_db, mains_db, fade_in, fade_out'),
    'water_skim':       (gen_water_skim,      'start', -4.0, ['dur'], 'dur, intensity, swell, fade_in, fade_out, pan'),
    'airliner_pass':    (gen_airliner_pass,   'peak',   0.0, ['pre', 'post'], 'pan->pan_to, speed, distance, height, n1, thrust, ground, sweeten_db, pre, post'),
    'formation_rumble': (gen_formation_rumble, 'start', -2.0, ['dur'], 'dur, fighters, tanker, tanker_db, fade_in, fade_out'),
    'impact_low':       (gen_impact_low,      'onset',  0.0, ['tail'], 'freq (Hz, default D1 36.71), decay, tail, click, drive, space, wet_db'),
    'reverse_swell':    (gen_reverse_swell,   'end',   -2.0, ['dur'], 'dur, pan'),
    'cut':              (gen_cut,             'start',  0.0, [], 'tail_db, tail (master cut: everything with t < this t)'),
}

# duration-type defaults per kind, used when pitch pre-compensation needs a value
DEFAULTS = {'jet_bed': {'dur': 4.0}, 'flyby': {'pre': 3.5, 'post': 4.0}, 'afterburner': {'dur': 3.0},
            'sonic_boom': {'tail': 5.0}, 'whoosh': {}, 'warp': {'pre': 2.5, 'tail': 3.5}, 'radio': {'dur': 6.0},
            'wind_high': {'dur': 6.0}, 'clouds_rush': {'dur': 2.5}, 'city_night': {'dur': 8.0},
            'water_skim': {'dur': 3.0}, 'airliner_pass': {'pre': 5.0, 'post': 5.5},
            'formation_rumble': {'dur': 8.0}, 'impact_low': {'tail': 2.5}, 'reverse_swell': {'dur': 1.5}}


# ============================================================================= timeline
def event_seed(ev, idx):
    if 'seed' in ev:
        return int(ev['seed'])
    return zlib.crc32(f"{ev['kind']}|{float(ev.get('t', 0)):.4f}|{idx}".encode()) & 0x7fffffff


def measure_anchor(st, anchor_kind, anchor=None, peak_win=0.15, sr=SR):
    """Independent measurement of where the anchor actually is in an isolated render (samples).
    onset: first 10 % crossing of the 1 ms envelope after the quietest point in the 250 ms before the
    nominal anchor; peak: smoothed-loudness maximum; end: last sample within 40 dB of the peak;
    start: first sample within 60 dB of the peak."""
    e_env = smooth_env(st, 0.001)
    pk = float(e_env.max()) + 1e-12
    if anchor_kind == 'onset':
        e = smooth_env(filt(st, 'highpass', 30.0, 2), 0.001)
        a = int(anchor or 0)
        lo = max(0, a - N(0.25))
        hi = min(len(e), a + N(0.25))
        imin = lo + int(np.argmin(e[lo:a + 1])) if a > lo else lo
        seg = e[imin:hi]
        return imin + int(np.argmax(seg > 0.1 * seg.max()))
    if anchor_kind == 'peak':           # local maximum within +-0.6 s of the nominal anchor
        a = int(anchor or 0)
        return peak_index(st, peak_win, a - N(0.6), a + N(0.6))
    if anchor_kind == 'end':
        return int(np.nonzero(e_env > pk * db2a(-40))[0][-1]) + 1
    return int(np.argmax(e_env > pk * db2a(-120)))


def render_event(ev, idx, verbose=True):
    kind = ev['kind']
    fn, anchor_kind, level, scaled, _ = KINDS[kind]
    rng = np.random.default_rng(event_seed(ev, idx))
    pitch = float(ev.get('pitch', 0.0) or 0.0)
    r = 2.0 ** (pitch / 12.0)
    evp = dict(ev)
    if pitch:
        dflt = dict(DEFAULTS.get(kind, {}))
        if kind == 'whoosh':
            dflt = {'pre': 1.6, 'post': 1.0} if ev.get('variant') == 'long' else {'pre': 0.5, 'post': 0.45}
        for k in scaled:
            if k in evp or k in dflt:
                evp[k] = float(evp.get(k, dflt.get(k))) * r
    st, anchor = fn(evp, rng)
    st = np.atleast_2d(np.asarray(st, float))
    if pitch:
        st = varispeed(st, r)
        anchor = anchor / r
    anchor = int(round(anchor))
    mm = max_momentary(st)
    st *= db2a(REF_LUFS + level + float(ev.get('gain_db', 0.0)) - mm)
    # per-event transient control: true-peak ceiling relative to the event's own loudest 400 ms
    # (crest <= 'crest_db', default 15 dB) -- keeps crackle / booms from slamming the master limiter
    crest = float(ev.get('crest_db', 15.0))
    st, _ = tp_limit(st, REF_LUFS + level + float(ev.get('gain_db', 0.0)) + crest, lookahead=0.002, release=0.05)
    if anchor_kind == 'peak':   # limiting can flatten a broad crest: re-find it (+-0.6 s) on the final render
        for _ in range(6):
            a2 = peak_index(st, PEAK_WIN.get(kind, 0.15), anchor - N(0.6), anchor + N(0.6))
            if a2 == anchor:
                break
            anchor = a2
    if kind not in ('reverse_swell',):
        st = fade(st, 0.0005 if anchor_kind == 'onset' else 0.002, 0.004)
    else:
        st = fade(st, 0.002, 0.0015)
    meas = measure_anchor(st, anchor_kind, anchor, PEAK_WIN.get(kind, 0.15)) if kind != 'cut' else anchor
    return st, anchor, anchor_kind, meas


def gate_env(n, start, sr, gate_in=None, gate_out=None, cuts=()):
    """Gain envelope for an event placed at sample `start` (length n): gate_in / gate_out mutes and
    master cuts (4 ms ramp down to tail_db, then an exponential decay reaching -60 dB re tail_db at
    `tail` seconds)."""
    ta = (start + np.arange(n)) / sr
    g = np.ones(n)
    ramp = 0.004
    if gate_in is not None:
        g *= np.clip((ta - float(gate_in)) / ramp, 0.0, 1.0)
    if gate_out is not None:
        g *= np.clip((float(gate_out) - ta) / ramp, 0.0, 1.0)
    for ct, tail_db, tail in cuts:
        x = ta - ct
        down = np.clip(1.0 - x / ramp, 0.0, 1.0)
        if tail > 0 and tail_db > -90:
            lvl = db2a(tail_db) * np.exp(-6.9078 * np.maximum(x, 0.0) / tail)
            g *= down + (1.0 - down) * lvl
        else:
            g *= down
    return g


def tp_limit(st, ceiling_db=-1.0, lookahead=0.003, release=0.12):
    """True-peak (4x oversampled) look-ahead limiter. Returns (out, max gain reduction dB)."""
    ceil = db2a(ceiling_db)
    n = st.shape[1]
    up = resample_poly(st, 4, 1, axis=1)
    pk = np.max(np.abs(up), axis=0)
    pk = np.pad(pk, (0, max(0, 4 * n - len(pk))))[:4 * n].reshape(n, 4).max(axis=1)
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    if need.min() >= 1.0:
        return st, 0.0
    w = N(lookahead)
    g = minimum_filter1d(need, 2 * w + 1, mode='nearest')
    blk = 64
    nb = (n + blk - 1) // blk
    gb = np.pad(g, (0, nb * blk - n), constant_values=1.0).reshape(nb, blk).min(axis=1)
    coef = 1.0 - math.exp(-blk / (release * SR))
    s, out = 1.0, np.empty(nb)
    for i in range(nb):
        s = gb[i] if gb[i] < s else s + (gb[i] - s) * coef
        out[i] = s
    gr = np.minimum(np.repeat(out, blk)[:n], g)
    gr = uniform_filter1d(gr, w, mode='nearest')     # half-width w/2 <= min-filter half-width w
    y = st * gr[None, :]
    for _ in range(4):   # safety: resampled TP can still overshoot a hair
        tp = true_peak_db(y)
        if tp <= ceiling_db:
            break
        y *= db2a(ceiling_db - tp - 0.02)
    return y, float(a2db(gr.min()))


def load_events(path):
    """Returns (enabled events, master_gain_db). Accepts a list or {"master_gain_db": x, "events": [...]}."""
    with open(path) as f:
        data = json.load(f)
    evs = data['events'] if isinstance(data, dict) else data
    master = float(data.get('master_gain_db', 0.0)) if isinstance(data, dict) else 0.0
    return [e for e in evs if e.get('enabled', True)], master


def render_timeline(events, duration, out_path, lufs=None, ceiling=-1.0, verbose=True, master_db=0.0):
    n = N(duration)
    mix = np.zeros((2, n))
    cuts = [(float(e['t']), float(e.get('tail_db', -20.0)), float(e.get('tail', 1.2)))
            for e in events if e['kind'] == 'cut']
    report = []
    placed = []
    for idx, ev in enumerate(events):
        if ev['kind'] == 'cut':
            report.append({'i': idx, 'kind': 'cut', 't': ev['t']})
            continue
        st, anchor, akind, meas = render_event(ev, idx)
        start = int(round(float(ev['t']) * SR)) - anchor
        ec = [c for c in cuts if float(ev['t']) < c[0]]
        g = gate_env(st.shape[1], start, SR, ev.get('gate_in'), ev.get('gate_out'), ec)
        st = st * g[None, :]
        for ch in range(2):
            place(mix[ch], st[ch], start)
        placed.append((len(report), start, st, int(round(float(ev['t']) * SR))))
        err_ms = (meas - anchor) / SR * 1000.0
        rec = {'i': idx, 'kind': ev['kind'], 't': ev['t'], 'label': ev.get('label', ''), 'anchor': akind,
               'start_s': round(start / SR, 4), 'end_s': round((start + st.shape[1]) / SR, 4),
               'isolated_anchor_err_ms': round(err_ms, 2), 'peak_win': PEAK_WIN.get(ev['kind']),
               'peak_dbfs': round(float(a2db(np.max(np.abs(st)))), 2),
               'max_momentary_lufs': round(max_momentary(st), 2) if st.shape[1] > 10 else None}
        report.append(rec)
        if verbose:
            print(f"  [{idx:02d}] {ev['kind']:<16} t={float(ev['t']):7.3f}  {akind:<5} "
                  f"span {rec['start_s']:7.3f}-{rec['end_s']:7.3f}  anchor err {err_ms:+6.2f} ms  "
                  f"pk {rec['peak_dbfs']:6.1f} dBFS", flush=True)
    w = N(0.05)
    for ri, start, st, a in placed:         # event energy vs everything else, +-50 ms around t
        lo, hi = max(0, a - w), min(n, a + w)
        if hi <= lo:
            continue
        ev_seg = np.zeros((2, hi - lo))
        for ch in range(2):
            place(ev_seg[ch], st[ch], start - lo)
        rest = mix[:, lo:hi] - ev_seg
        report[ri]['dominance_db'] = round(float(10 * np.log10((np.sum(ev_seg ** 2) + 1e-20) /
                                                                (np.sum(rest ** 2) + 1e-20))), 1)
    pre_gain = float(master_db)
    mix *= db2a(pre_gain)
    if lufs is not None:
        import pyloudnorm as pyln
        L = pyln.Meter(SR).integrated_loudness(mix.T)
        mix *= db2a(lufs - L)
        pre_gain += float(lufs - L)
    mix, gr = tp_limit(mix, ceiling)
    mix = np.clip(mix, -1.0, 1.0)
    sf.write(out_path, mix.T.astype(np.float32), SR, subtype='PCM_24')
    meta = {'out': out_path, 'sr': SR, 'duration': duration, 'normalize_gain_db': round(pre_gain, 2),
            'limiter_max_gr_db': round(gr, 2), 'true_peak_dbtp': round(true_peak_db(mix), 2),
            'events': report}
    try:
        import pyloudnorm as pyln
        meta['integrated_lufs'] = round(float(pyln.Meter(SR).integrated_loudness(mix.T)), 2)
    except Exception:
        pass
    with open(out_path + '.json', 'w') as f:
        json.dump(meta, f, indent=1)
    if verbose:
        print(f"wrote {out_path}  LUFS-I {meta.get('integrated_lufs')}  TP {meta['true_peak_dbtp']} dBTP  "
              f"limiter GR {gr:.2f} dB")
    return mix, meta


DEMO = [
    {'kind': 'jet_bed', 'dur': 4.0, 'intensity': 0.7, 'label': 'jet_bed (external, 0.7)'},
    {'kind': 'flyby', 'pan': -0.9, 'pan_to': 0.9, 'crackle': 0.4, 'label': 'flyby (L->R, water)'},
    {'kind': 'afterburner', 'dur': 2.5, 'label': 'afterburner'},
    {'kind': 'sonic_boom', 'tail': 4.0, 'label': 'sonic_boom'},
    {'kind': 'whoosh', 'variant': 'short', 'pan': -0.7, 'pan_to': 0.7, 'label': 'whoosh short'},
    {'kind': 'whoosh', 'variant': 'long', 'pan': 0.7, 'pan_to': -0.7, 'label': 'whoosh long'},
    {'kind': 'warp', 'label': 'warp'},
    {'kind': 'ui_blip', 'label': 'ui_blip'},
    {'kind': 'ui_type', 'text': 'PARIS', 'label': 'ui_type "PARIS"'},
    {'kind': 'ui_confirm', 'label': 'ui_confirm'},
    {'kind': 'radio', 'dur': 6.0, 'label': 'radio'},
    {'kind': 'wind_high', 'dur': 5.0, 'label': 'wind_high'},
    {'kind': 'clouds_rush', 'dur': 2.5, 'label': 'clouds_rush'},
    {'kind': 'city_night', 'dur': 7.0, 'gain_db': 6, 'label': 'city_night (+6 dB for audition)'},
    {'kind': 'water_skim', 'dur': 3.0, 'label': 'water_skim'},
    {'kind': 'airliner_pass', 'label': 'airliner_pass'},
    {'kind': 'formation_rumble', 'dur': 6.0, 'label': 'formation_rumble'},
    {'kind': 'impact_low', 'label': 'impact_low'},
    {'kind': 'reverse_swell', 'dur': 1.5, 'label': 'reverse_swell'},
]


def render_demo(out_path, gap=2.0):
    segs, labels, t = [], [], 0.0
    for i, ev in enumerate(DEMO):
        ev = dict(ev, t=0.0)
        st, anchor, akind, meas = render_event(ev, i)
        segs.append(st)
        labels.append({'kind': ev['kind'], 'label': ev['label'], 't0': round(t, 3),
                       't1': round(t + st.shape[1] / SR, 3), 'anchor_s': round(t + anchor / SR, 3),
                       'anchor': akind, 'isolated_anchor_err_ms': round((meas - anchor) / SR * 1000, 2)})
        print(f"  demo {ev['label']:<34} {t:7.2f}-{t + st.shape[1] / SR:7.2f} s", flush=True)
        t += st.shape[1] / SR + gap
    n = N(t)
    mix = np.zeros((2, n))
    for st, lab in zip(segs, labels):
        i0 = N(lab['t0'])
        for ch in range(2):
            place(mix[ch], st[ch], i0)
    mix, gr = tp_limit(mix, -1.0)
    sf.write(out_path, mix.T.astype(np.float32), SR, subtype='PCM_24')
    with open(out_path + '.json', 'w') as f:
        json.dump({'out': out_path, 'labels': labels, 'limiter_max_gr_db': round(gr, 2)}, f, indent=1)
    print(f'wrote {out_path} ({t:.1f} s), limiter GR {gr:.2f} dB')


def main():
    ap = argparse.ArgumentParser(description='Skyloom trailer parametric SFX renderer')
    ap.add_argument('events', nargs='?')
    ap.add_argument('out', nargs='?')
    ap.add_argument('--duration', type=float, default=104.0)
    ap.add_argument('--lufs', type=float, default=None, help='normalise integrated loudness (default: off; '
                    'levels come from per-event calibration)')
    ap.add_argument('--ceiling', type=float, default=-1.0, help='true-peak ceiling dBTP')
    ap.add_argument('--demo', metavar='OUT_WAV')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    if a.list:
        for k, (fn, anc, lvl, _, prm) in KINDS.items():
            print(f'{k:<17} anchor={anc:<6} level={lvl:+5.1f}  {prm}')
        return
    if a.demo:
        render_demo(a.demo)
        return
    if not (a.events and a.out):
        ap.error('events.json and out.wav are required (or --demo / --list)')
    evs, master = load_events(a.events)
    render_timeline(evs, a.duration, a.out, a.lufs, a.ceiling, master_db=master)


if __name__ == '__main__':
    main()

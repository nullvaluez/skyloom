#!/usr/bin/env python3
"""Skyloom trailer score — fully synthesized (numpy/scipy), cut to timeline.json.

    python3 scripts/trailer/score.py out.wav

96 BPM, A minor (i-VI-III-VII), bar = 2.5 s. Every cue time is taken from the
same timeline the picture renderer uses, so hits land on the cuts.
"""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, 'timeline.json')))
DUR = TL['duration'] + 2.0
N = int(DUR * SR)
BEAT = 60.0 / TL['bpm']
BAR = BEAT * 4
rng = np.random.default_rng(7)

dry = np.zeros((N, 2))
wet = np.zeros((N, 2))  # reverb send


def T(n):
    return np.arange(n) / SR


def place(sig, t, gain=1.0, pan=0.0, rev=0.0):
    """Add mono or stereo sig at time t (s)."""
    i = int(round(t * SR))
    if i >= N:
        return
    if sig.ndim == 1:
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l * 1.414, sig * r * 1.414], axis=1)
    n = min(len(sig), N - i)
    if i < 0:
        sig = sig[-i:]; n = min(len(sig), N); i = 0
    dry[i:i + n] += sig[:n] * gain
    if rev:
        wet[i:i + n] += sig[:n] * gain * rev


def env(n, a=0.005, d=0.3, s=None):
    t = T(n)
    e = np.minimum(1, t / max(a, 1e-4))
    if s is None:
        return e * np.exp(-np.maximum(0, t - a) / d)
    return e


def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR * 0.45)], 'band', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def sweep_lp(x, f0, f1, block=256, curve='exp'):
    """Time-varying low-pass (block-wise state carry)."""
    out = np.zeros_like(x)
    nb = int(np.ceil(len(x) / block))
    zi = None
    for b in range(nb):
        u = b / max(1, nb - 1)
        fc = f0 * (f1 / f0) ** u if curve == 'exp' else f0 + (f1 - f0) * u
        sos = signal.butter(2, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        seg = x[b * block:(b + 1) * block]
        y, zi = signal.sosfilt(sos, seg, zi=zi)
        out[b * block:(b + 1) * block] = y
    return out


def sweep_bp(x, f0, f1, q=1.2, block=256):
    out = np.zeros_like(x)
    nb = int(np.ceil(len(x) / block)); zi = None
    for b in range(nb):
        u = b / max(1, nb - 1)
        fc = f0 * (f1 / f0) ** u
        lo, hi = fc / (1 + 1 / q), min(fc * (1 + 1 / q), SR * 0.45)
        sos = signal.butter(1, [lo, hi], 'band', fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        seg = x[b * block:(b + 1) * block]
        y, zi = signal.sosfilt(sos, seg, zi=zi)
        out[b * block:(b + 1) * block] = y
    return out


def saw(f, n, phase=0.0):
    t = T(n)
    if np.isscalar(f):
        ph = f * t + phase
    else:
        ph = np.cumsum(f) / SR + phase
    return 2 * (ph - np.floor(ph + 0.5))


def noise(n):
    return rng.standard_normal(n)


def pink(n):
    w = noise(n)
    b, a = [0.049922035, -0.095993537, 0.050612699, -0.004408786], [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, w) * 4


def brown(n):
    x = np.cumsum(noise(n)) / 60
    return hp(x, 20)


def hz(note):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    n, o = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[n] + (o - 4) * 12) / 12)


# ---------------------------------------------------------------- instruments
def kick(big=False):
    n = int(SR * (0.9 if big else 0.5))
    t = T(n)
    f = 44 + 110 * np.exp(-t * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (4 if big else 7))
    x += 0.4 * lp(noise(n), 3000) * np.exp(-t * 90)
    return np.tanh(x * 1.6)


def boom(n_s=3.0):
    n = int(SR * n_s); t = T(n)
    f = 28 + 60 * np.exp(-t * 6)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.1)
    x += 0.5 * lp(noise(n), 400) * np.exp(-t * 5)
    x += 0.25 * bp(noise(n), 800, 4000) * np.exp(-t * 25)
    return np.tanh(x * 2.2) * 0.9


def snare():
    n = int(SR * 0.6); t = T(n)
    x = bp(noise(n), 900, 7000) * np.exp(-t * 16)
    x += 0.5 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 22)
    x += 0.3 * hp(noise(n), 5000) * np.exp(-t * 9)
    return np.tanh(x * 1.4)


def tom(f0=95):
    n = int(SR * 0.9); t = T(n)
    f = f0 * (0.75 + 0.25 * np.exp(-t * 9))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    x += 0.25 * lp(noise(n), 1500) * np.exp(-t * 30)
    return np.tanh(x * 1.8)


def hat(open_=False):
    n = int(SR * (0.35 if open_ else 0.08)); t = T(n)
    return hp(noise(n), 7000) * np.exp(-t * (10 if open_ else 60)) * 0.5


def cymbal(n_s=3.5):
    n = int(SR * n_s); t = T(n)
    x = hp(noise(n), 3500) * np.exp(-t * 1.3)
    x += 0.4 * bp(noise(n), 5000, 12000) * np.exp(-t * 0.8)
    return x * 0.6


def braam(root='A1', n_s=3.2, bright=2600):
    n = int(SR * n_s); t = T(n)
    x = np.zeros(n)
    for note, g in [(root, 1.0), (root[:-1] + str(int(root[-1]) + 1), 0.7), ('E' + str(int(root[-1]) + 1), 0.5)]:
        f = hz(note)
        for d in (-0.012, 0.0, 0.009):
            x += g * saw(f * (1 + d), n, rng.random())
    x = sweep_lp(x, 180, bright)
    e = np.minimum(1, t / 0.03) * np.exp(-t / (n_s * 0.45))
    return np.tanh(x * e * 0.5) * 0.9


def riser(n_s, f0=250, f1=9000):
    n = int(SR * n_s); t = T(n); u = t / n_s
    x = sweep_bp(pink(n), f0, f1, q=2.0) * (u ** 2.2) * 1.6
    # shepard-ish rising tone
    tone = np.zeros(n)
    for k in range(3):
        f = 110 * 2 ** (k + 2.5 * u)
        tone += saw(f, n, k * 0.3) * np.sin(np.pi * np.clip(u + k / 3, 0, 1)) ** 2
    x += lp(tone, 4000) * (u ** 2) * 0.25
    return x


def reverse_swell(n_s=2.0):
    n = int(SR * n_s); t = T(n)
    x = bp(noise(n), 400, 9000) * np.exp(-t * 2.5)
    return x[::-1] * 0.8


def whoosh(n_s=2.0, peak=0.6):
    n = int(SR * n_s); t = T(n)
    x = sweep_bp(pink(n), 3500, 280, q=1.1)
    a = np.exp(-((t - peak) / 0.22) ** 2) + 0.4 * np.exp(-np.maximum(0, t - peak) / 0.6) * (t > peak)
    return x * a * 2.2


def subdrop(n_s=1.8, f0=90, f1=28):
    n = int(SR * n_s); t = T(n); u = t / n_s
    f = f0 * (f1 / f0) ** u
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.2) * np.minimum(1, t / 0.01)


def pad(notes, n_s, cutoff=1400, attack=0.8, release=1.2):
    n = int(SR * n_s); t = T(n)
    x = np.zeros((n, 2))
    for i, note in enumerate(notes):
        f = hz(note)
        for d, side in ((-0.006, 0), (0.006, 1), (0.0, None)):
            s = saw(f * (1 + d), n, rng.random())
            if side is None:
                x[:, 0] += s * 0.6; x[:, 1] += s * 0.6
            else:
                x[:, side] += s
    x = lp(x, cutoff)
    e = np.minimum(1, t / attack) * np.clip((n_s - t) / release, 0, 1)
    return x * e[:, None] * 0.12


def pluck(note, n_s=0.4, bright=3200):
    n = int(SR * n_s); t = T(n)
    x = saw(hz(note), n) + 0.5 * saw(hz(note) * 1.005, n)
    y = sweep_lp(x, bright, 250, block=128)
    return y * np.exp(-t * 7) * 0.5


def bell(note, n_s=3.0):
    n = int(SR * n_s); t = T(n); f = hz(note)
    x = sum(g * np.sin(2 * np.pi * f * k * t) * np.exp(-t * dk) for k, g, dk in ((1, 1, 1.2), (2.76, 0.45, 2.8), (5.4, 0.25, 5), (8.9, 0.1, 8)))
    return x * 0.35


def jet_roar(n_s, level=1.0):
    n = int(SR * n_s); t = T(n)
    x = lp(brown(n), 380) * 2.5 + 0.15 * bp(noise(n), 1800, 5000)
    whine = 0.05 * np.sin(2 * np.pi * (2200 + 40 * np.sin(t * 2)) * t)
    e = np.minimum(1, t / 0.4) * np.clip((n_s - t) / 0.4, 0, 1)
    return (x + whine) * e * level


# ---------------------------------------------------------------- the cue sheet
PROG = [  # bar chord: (bass, pad voicing, ostinato notes)
    ('A1', ['A3', 'C4', 'E4', 'B4'], ['A2', 'A2', 'E3', 'A2', 'C3', 'A2', 'E3', 'G3']),
    ('F1', ['F3', 'A3', 'C4', 'G4'], ['F2', 'F2', 'C3', 'F2', 'A2', 'F2', 'C3', 'E3']),
    ('C2', ['G3', 'C4', 'E4', 'D5'], ['C3', 'C3', 'G3', 'C3', 'E3', 'C3', 'G3', 'B3']),
    ('G1', ['G3', 'B3', 'D4', 'A4'], ['G2', 'G2', 'D3', 'G2', 'B2', 'G2', 'D3', 'F#3']),
]


def bar_t(b):
    return b * BAR


def chord(b):
    return PROG[b % 4]


# Act I: 0-20 ---------------------------------------------------------------
place(pad(['A2', 'E3', 'A3', 'B3', 'E4'], 21.0, cutoff=700, attack=5.0, release=2.0), 0.0, gain=0.7, rev=0.6)
place(subdrop(9.0, 55, 55) * np.minimum(1, T(int(SR * 9)) / 6.0), 1.0, gain=0.35)
for i, (tt, nt) in enumerate([(1.4, 'E5'), (4.9, 'A5'), (7.4, 'B5'), (9.2, 'E6')]):
    place(bell(nt, 4.0), tt, gain=0.35, pan=(-0.4 if i % 2 else 0.4), rev=0.8)
# data blips over the globe
for k in range(40):
    tt = 0.8 + k * 0.23 + rng.random() * 0.1
    n = int(SR * 0.05)
    place(np.sin(2 * np.pi * (1800 + 900 * rng.random()) * T(n)) * np.exp(-T(n) * 80) * 0.08, tt, pan=rng.random() * 1.6 - 0.8, rev=0.5)
# dawn: ostinato fades in, pads follow the progression
for b in range(4, 8):
    bass, voicing, ost = chord(b)
    place(pad(voicing, BAR + 1.0, cutoff=900 + 300 * (b - 4)), bar_t(b), gain=0.6, rev=0.5)
    for k, nt in enumerate(ost):
        place(pluck(nt, 0.35, bright=1200 + 400 * (b - 4)), bar_t(b) + k * BEAT / 2, gain=0.22 + 0.06 * (b - 4), pan=(-0.3 if k % 2 else 0.3), rev=0.25)
place(riser(2.5, 300, 6000), 12.5, gain=0.35, rev=0.3)
place(boom(2.5), 15.0, gain=0.7, rev=0.3)
place(reverse_swell(2.4), 15.1, gain=0.5, rev=0.4)
place(jet_roar(3.0, 0.5), 15.0, rev=0.1)
place(whoosh(2.2, 0.55), 16.95, gain=1.1, pan=0.0, rev=0.3)
place(braam('A1', 2.5), 17.5, gain=0.9, rev=0.4)
place(boom(2.5), 17.5, gain=0.8)
place(cymbal(2.5), 17.5, gain=0.35, rev=0.4)
for k in range(8):  # tom build into bar 8
    place(tom(95 if k % 2 else 80), 17.5 + 0.6 + k * BEAT / 2, gain=0.35 + 0.05 * k, pan=(-0.5 if k % 2 else 0.5), rev=0.3)
place(riser(2.5, 400, 9000), 17.5, gain=0.4, rev=0.2)

# Act II: 20-47.5 -----------------------------------------------------------
def groove(b0, b1, full=True, hats8=True):
    for b in range(b0, b1):
        t0 = bar_t(b)
        bass, voicing, ost = chord(b)
        place(pad(voicing, BAR + 0.8, cutoff=1800), t0, gain=0.55, rev=0.45)
        # bass: pumping 8ths
        for k in range(8):
            n = int(SR * BEAT / 2 * 0.9); tt = T(n)
            s = lp(saw(hz(bass), n) + saw(hz(bass) * 2, n) * 0.4, 500) * np.exp(-tt * 6)
            place(s * 0.5, t0 + k * BEAT / 2, gain=0.8)
        for k, nt in enumerate(ost):
            place(pluck(nt, 0.3, bright=3500), t0 + k * BEAT / 2, gain=0.3, pan=(-0.35 if k % 2 else 0.35), rev=0.2)
        # drums
        place(kick(), t0, gain=0.9)
        place(kick(), t0 + 2 * BEAT, gain=0.8)
        if full:
            place(kick(), t0 + 3.5 * BEAT, gain=0.55)
            place(tom(70), t0 + 1.5 * BEAT, gain=0.4, pan=-0.3, rev=0.3)
            place(tom(62), t0 + 2.75 * BEAT, gain=0.4, pan=0.3, rev=0.3)
        place(snare(), t0 + BEAT, gain=0.55, rev=0.55)
        place(snare(), t0 + 3 * BEAT, gain=0.6, rev=0.55)
        if hats8:
            for k in range(8):
                place(hat(k % 4 == 2), t0 + k * BEAT / 2, gain=0.22 if k % 2 else 0.3, pan=0.4)


groove(8, 13)          # 20 - 32.5  harbor / skyline
groove(13, 16, full=False)   # 32.5 - 40 formation (lighter)
for tt in (20.0, 25.0, 30.0, 32.5):
    place(braam(chord(int(tt / BAR))[0], 2.8, bright=3000), tt, gain=0.75 if tt != 32.5 else 0.5, rev=0.4)
    place(boom(2.0), tt, gain=0.7)
    place(cymbal(3.0), tt, gain=0.3, rev=0.4)
place(whoosh(2.0, 0.5), 20.5, gain=1.0, pan=0.3, rev=0.2)
place(jet_roar(4.5, 0.6), 20.2, rev=0.1)
place(jet_roar(5.0, 0.8), 25.0, rev=0.1)
place(whoosh(1.8, 0.7), 30.8, gain=0.9, pan=-0.2, rev=0.2)
place(riser(3.75, 300, 9000), 36.25, gain=0.45, rev=0.2)
for k in range(12):
    place(snare(), 38.125 + k * BEAT / 6 * 1.0, gain=0.15 + 0.03 * k, rev=0.3)
# montage 1: 40 - 47.5, an impact on every cut
groove(16, 19)
for k in range(6):
    tt = 40.0 + k * 1.25
    place(boom(1.6), tt, gain=0.65 if k else 0.9)
    place(cymbal(1.8), tt, gain=0.22, rev=0.3)
    if k % 2 == 0:
        place(braam(chord(int(tt / BAR))[0], 2.4), tt, gain=0.55, rev=0.35)
place(reverse_swell(1.5), 46.0, gain=0.5, rev=0.3)

# Act III: 47.5 - 70 --------------------------------------------------------
place(subdrop(2.5, 70, 25), 47.5, gain=0.9)
place(bell('A4', 5.0), 47.9, gain=0.35, rev=1.0)
place(bell('E5', 5.0), 48.5, gain=0.25, pan=0.3, rev=1.0)
place(bell('C5', 5.0), 49.1, gain=0.25, pan=-0.3, rev=1.0)
# night: heartbeat + low pads
for b in range(20, 23):
    t0 = bar_t(b)
    bass, voicing, ost = chord(b - 20)
    place(pad([v[:-1] + str(int(v[-1]) - 1) for v in voicing], BAR + 1.0, cutoff=900), t0, gain=0.7, rev=0.6)
    for k in range(4):
        place(kick(), t0 + k * BEAT, gain=0.45 if k % 2 == 0 else 0.3)
    for k, nt in enumerate(ost):
        place(pluck(nt, 0.45, bright=1500 + 500 * (b - 20)), t0 + k * BEAT / 2, gain=0.2, pan=(-0.4 if k % 2 else 0.4), rev=0.45)
place(boom(3.0), 50.0, gain=0.6, rev=0.3)
place(riser(3.15, 250, 9000), 53.75, gain=0.5, rev=0.2)
for k in range(16):
    place(tom(90 if k % 2 else 75), 54.4 + k * BEAT / 4 * 1.0, gain=0.2 + 0.03 * k, pan=(-0.4 if k % 2 else 0.4), rev=0.25)
place(whoosh(2.0, 0.6), 56.3, gain=1.2, pan=0.2, rev=0.3)
place(braam('A1', 3.0), 56.9, gain=1.0, rev=0.4)
place(boom(3.0), 56.9, gain=0.9)
place(cymbal(3.0), 56.9, gain=0.35, rev=0.4)
place(jet_roar(3.1, 0.9), 56.25, rev=0.1)
for k in range(10):
    place(snare(), 58.75 + k * BEAT / 8, gain=0.2 + 0.04 * k, rev=0.3)
# montage 2: 60 - 65, biggest section, hit on every cut
groove(24, 26)
for k in range(8):
    tt = 60.0 + k * 0.625
    place(boom(1.2), tt, gain=0.6 if k else 1.0)
    place(snare(), tt, gain=0.35, rev=0.5)
    if k % 2 == 0:
        place(braam(chord(int(tt / BAR))[0], 1.6, bright=3500), tt, gain=0.5, rev=0.3)
place(cymbal(3.0), 60.0, gain=0.4, rev=0.4)
# climb: 65 - 70, all-out riser, accelerating roll, cut dead at 70
place(braam('F1', 3.0), 65.0, gain=0.8, rev=0.4)
place(boom(2.0), 65.0, gain=0.8)
place(riser(5.0, 200, 11000), 65.0, gain=0.6, rev=0.15)
place(jet_roar(5.0, 1.0), 65.0)
place(whoosh(2.0, 0.7), 65.6, gain=1.0, pan=-0.3, rev=0.2)
tt = 66.0; step = 0.3
while tt < 69.95:
    place(snare(), tt, gain=0.25 + 0.12 * (tt - 66), rev=0.2)
    place(tom(80), tt, gain=0.2 + 0.08 * (tt - 66), rev=0.2)
    tt += step; step = max(0.06, step * 0.9)
place(pad(['A3', 'C4', 'E4', 'A4', 'B4'], 5.0, cutoff=3000, attack=3.5, release=0.05), 65.0, gain=0.8, rev=0.3)

# Act IV: logo ---------------------------------------------------------------
cut = int(70.0 * SR)
dry[cut:int(71.25 * SR)] = 0
wet[cut:int(71.25 * SR)] = 0
place(boom(4.0), 71.25, gain=1.0)
place(braam('A1', 5.0, bright=2200), 71.25, gain=0.9, rev=0.6)
place(cymbal(5.0), 71.25, gain=0.35, rev=0.6)
place(pad(['A2', 'E3', 'A3', 'C#4', 'E4', 'B4'], 14.0, cutoff=1600, attack=1.5, release=5.0), 71.25, gain=0.9, rev=0.7)
for tt, nt in ((73.2, 'E5'), (74.5, 'C#6'), (75.8, 'B5'), (77.5, 'A5')):
    place(bell(nt, 5.0), tt, gain=0.3, pan=0.2 if nt < 'D' else -0.2, rev=0.9)
place(whoosh(3.0, 1.2), 71.3, gain=0.45, pan=-0.6, rev=0.4)

# ---------------------------------------------------------------- reverb + master
def make_ir(sec=3.6):
    n = int(SR * sec); t = T(n)
    ir = np.stack([noise(n), noise(n)], axis=1) * np.exp(-t * 2.0)[:, None]
    ir = lp(ir, 6000)
    ir[:int(SR * 0.012)] = 0
    return ir / np.sqrt(np.sum(ir ** 2)) * 1.0


ir = make_ir()
rev = np.stack([signal.fftconvolve(wet[:, c], ir[:, c])[:N] for c in range(2)], axis=1)
mix = dry + rev * 0.9
# the hard cut at 70.0 also kills the reverb tail
mix[cut:int(71.25 * SR)] *= 0.0
mix = hp(mix, 25)
# glue: gentle bus compression via soft clip
peak = np.max(np.abs(mix))
mix = mix / peak * 1.6
mix = np.tanh(mix) / np.tanh(1.6)
# fade the very end
fade = int(SR * 3.0)
end = int((TL['duration']) * SR)
mix[end - fade:end] *= np.linspace(1, 0, fade)[:, None]
mix[end:] = 0
mix = mix / np.max(np.abs(mix)) * 0.89
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/skyloom-score.wav'
wavfile.write(out, SR, (mix[:int(TL['duration'] * SR)] * 32767).astype(np.int16))
print('wrote', out, f'{len(mix) / SR:.1f}s')

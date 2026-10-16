"""Skyloom trailer v2 — original score + sound design, locked to edl.py.

Key of D major, 128.571 BPM (14 frames/beat at 30 fps). Renders a 48 kHz
stereo float WAV. Run:  python3 music.py out.wav
"""
import sys
import numpy as np
from scipy.io import wavfile
import synth as S
from synth import SR, t_axis, midi_hz, svf, butter, noise, sine, saw, square, pan
from edl import SPB, TOTAL_BEATS

TAIL = 0.0                                    # video and score end together (b155)
N = int((TOTAL_BEATS * SPB + TAIL) * SR)
STEP = SPB / 4                               # 16th note


def T(b):
    return b * SPB


def db(x):
    return 10 ** (x / 20)


# ------------------------------------------------------------------ drums
def kick(cut=None):
    n = int(0.48 * SR)
    t = t_axis(n)
    f = 47 + 125 * np.exp(-t / 0.028) + 300 * np.exp(-t / 0.0035)
    amp = np.minimum(t / 0.0012, 1) * np.exp(-np.maximum(t - 0.03, 0) / 0.20)
    body = sine(f, n) * amp
    click = butter(noise(n), 2500, 'high') * np.exp(-t / 0.0035) * 0.7
    k = S.softclip(body * 1.7 + click, 1.6)
    if cut:
        k = svf(k, cut, 0.7)
    return S.fade_tail(k, 0.03)


def clap():
    n = int(0.6 * SR)
    t = t_axis(n)
    nz = noise(n)
    env = np.zeros(n)
    for o in (0.0, 0.010, 0.021, 0.030):
        env += np.where(t >= o, np.exp(-(t - o) / 0.0055), 0)
    env += 0.75 * np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.14), 0)
    c = svf(nz * env, 1500, 1.1, 'bp') * 2.6 + butter(nz * env, 5500, 'high') * 0.35
    body = sine(190 * (1 + 0.35 * np.exp(-t / 0.012)), n) * np.exp(-t / 0.065) * 0.55
    snr = svf(noise(n), 3200, 0.8, 'bp') * np.exp(-t / 0.11) * 0.6
    return S.fade_tail(c + body + snr, 0.02)


def snare(pitch=1.0, n_sec=0.25):
    n = int(n_sec * SR)
    t = t_axis(n)
    body = sine(200 * pitch * (1 + 0.4 * np.exp(-t / 0.01)), n) * np.exp(-t / 0.06)
    nz = svf(noise(n), 3500 * pitch, 0.9, 'bp') * np.exp(-t / 0.09) * 1.3
    return S.fade_tail(body * 0.7 + nz, 0.01)


_HAT_F = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 1.75


def hat(open_=False):
    dur = 0.45 if open_ else 0.09
    n = int(dur * SR)
    t = t_axis(n)
    m = sum(square(f, n, phase0=i * 0.17) for i, f in enumerate(_HAT_F))
    m = svf(m, 9500, 1.4, 'bp') + 0.35 * noise(n)
    m = butter(m, 7000, 'high', 2)
    tau = 0.16 if open_ else 0.022
    return S.fade_tail(m * np.exp(-t / tau) * 0.6, 0.01)


def crash(dur=2.4, bright=1.0):
    n = int(dur * SR)
    t = t_axis(n)
    out = []
    for c in range(2):
        m = sum(square(f * (1 + 0.013 * c), n, phase0=0.3 * i) for i, f in enumerate(_HAT_F * 1.3))
        x = 0.6 * noise(n) + 0.25 * m
        x = butter(x, 4200 * bright, 'high', 2)
        x = butter(x, 14000, 'low', 2)
        env = np.minimum(t / 0.002, 1) * (0.55 * np.exp(-t / 0.07) + 0.45 * np.exp(-t / (dur / 3.5)))
        out.append(x * env)
    return S.fade_tail(np.stack(out, -1), 0.05)


def tom(f0):
    n = int(0.5 * SR)
    t = t_axis(n)
    s = sine(f0 * (1 + 0.6 * np.exp(-t / 0.04)), n) * np.exp(-t / 0.22)
    s += svf(noise(n), f0 * 4, 1.0, 'bp') * np.exp(-t / 0.03) * 0.4
    return S.fade_tail(S.softclip(s * 1.3, 1.2), 0.02)


def shaker():
    n = int(0.08 * SR)
    t = t_axis(n)
    x = butter(noise(n), 6000, 'high', 2)
    return x * np.minimum(t / 0.01, 1) * np.exp(-t / 0.025)


# ------------------------------------------------------------------ voices
def supersaw(midi, dur, cutoff=3200, attack=0.01, release=0.3, voices=7, spread=1.0,
             res=0.8, cut_env=None, decay=0.35, sustain=0.85):
    gate = dur
    n = int((dur + release + 0.05) * SR)
    f0 = midi_hz(midi)
    cents = np.array([-24, -14, -6, 0, 6, 14, 24])[:voices] * spread
    pans = np.linspace(-0.85, 0.85, len(cents))
    st = np.zeros((n, 2))
    for c, p in zip(cents, pans):
        v = saw(f0 * 2 ** (c / 1200), n, phase0=S.RNG.random())
        st += pan(v, p)
    st /= np.sqrt(len(cents))
    fc = cutoff if cut_env is None else cut_env(t_axis(n))
    for ch in range(2):
        st[:, ch] = svf(st[:, ch], fc, res)
    env = S.adsr(n, attack, decay, sustain, release, gate=gate)
    return S.fade_tail(st * env[:, None], 0.02)


def chord_saw(notes, dur, **kw):
    out = None
    for m in notes:
        v = supersaw(m, dur, **kw)
        out = v if out is None else out + v
    return out / np.sqrt(len(notes))


def pluck(midi, dur, bright=1.0, decay=0.14, sustain=0.3):
    n = int((dur + 0.25) * SR)
    t = t_axis(n)
    f = midi_hz(midi)
    x = saw(f * 2 ** (7 / 1200), n, S.RNG.random()) + saw(f * 2 ** (-7 / 1200), n, S.RNG.random())
    x += 0.35 * square(f / 2, n, 0.0)
    fc = 450 + 6500 * bright * np.exp(-t / decay)
    x = svf(x, fc, 1.1)
    env = S.adsr(n, 0.002, 0.22, sustain, 0.12, gate=dur)
    return S.fade_tail(x * env * 0.5, 0.01)


def lead(midi, dur, bright=1.0):
    """Hook voice: bright pluck-lead with delayed vibrato."""
    n = int((dur + 0.3) * SR)
    t = t_axis(n)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.18) / 0.2, 0, 1)
    f = midi_hz(midi) * vib
    x = 0.55 * saw(f * 2 ** (5 / 1200), n, S.RNG.random()) + 0.55 * saw(f * 2 ** (-5 / 1200), n, S.RNG.random())
    x += 0.45 * square(f, n, 0.1, pw=0.42)
    fc = 1700 + 5200 * bright * np.exp(-t / 0.16)
    x = svf(x, fc, 1.25)
    env = S.adsr(n, 0.003, 0.22, 0.7, 0.14, gate=dur)
    return S.fade_tail(x * env * 0.42, 0.01)


def epiano(midi, dur, vel=1.0):
    n = int((dur + 1.0) * SR)
    t = t_axis(n)
    f = midi_hz(midi)
    I = (2.0 * np.exp(-t / 0.4) + 0.35) * vel
    mod = np.sin(2 * np.pi * f * t) * I
    car = np.sin(2 * np.pi * f * t + mod)
    tine = np.sin(2 * np.pi * f * 4 * t) * np.exp(-t / 0.05) * 0.12
    env = S.adsr(n, 0.003, 1.4, 0.0, 0.35, gate=dur) * 0.9 + 0.1 * S.adsr(n, 0.003, 0.2, 0.25, 0.35, gate=dur)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    x = (car + tine) * env
    return S.fade_tail(np.stack([x * trem, x * (2 - trem)], -1) * 0.32 * vel, 0.02)


def bell(midi, dur, vel=1.0):
    n = int((dur + 2.0) * SR)
    t = t_axis(n)
    f = midi_hz(midi)
    parts = [(1.0, 1.0, 1.9), (2.0, 0.45, 1.0), (3.01, 0.22, 0.55), (4.17, 0.16, 0.35), (5.43, 0.09, 0.22), (8.2, 0.05, 0.1)]
    x = np.zeros(n)
    for r, a, d in parts:
        x += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d)
    x *= np.minimum(t / 0.002, 1)
    return S.fade_tail(x * 0.25 * vel, 0.05)


def bass_note(midi, dur, cutoff=1300, drive=1.4):
    n = int((dur + 0.06) * SR)
    t = t_axis(n)
    f = midi_hz(midi)
    sub = sine(f, n) * 0.95
    mid = saw(f * 2, n, 0.0) * 0.5 + saw(f * 2 * 1.006, n, 0.4) * 0.35
    mid = svf(mid, 260 + cutoff * np.exp(-t / 0.07), 1.0)
    env = S.adsr(n, 0.003, 0.12, 0.75, 0.03, gate=dur)
    return S.fade_tail(S.softclip((sub + mid) * env, drive) * 0.75, 0.008)


def sub_note(midi, dur, attack=0.02):
    n = int((dur + 0.4) * SR)
    x = sine(midi_hz(midi), n) * S.adsr(n, attack, 0.5, 0.9, 0.35, gate=dur)
    return S.fade_tail(x * 0.8, 0.02)


# ------------------------------------------------------------------ sound design
def impact(size=1.0, dur=4.0):
    n = int(dur * SR)
    t = t_axis(n)
    boom = sine(34 + 90 * np.exp(-t / 0.07), n) * np.exp(-t / (0.9 * size)) * 1.2
    thud = butter(noise(n), 900, 'low', 2) * np.exp(-t / 0.12) * 1.4
    crack = butter(noise(n), 2500, 'high', 2) * np.exp(-t / 0.015) * 0.9
    x = S.softclip(boom + thud + crack, 1.8)
    return S.fade_tail(x * size, 0.1)


def subdrop(dur=1.6, f0=72, f1=27):
    n = int(dur * SR)
    t = t_axis(n)
    f = f1 + (f0 - f1) * np.exp(-t / (dur / 4))
    return S.fade_tail(sine(f, n) * np.exp(-t / (dur / 2.2)) * np.minimum(t / 0.005, 1), 0.05)


def riser(dur, f_lo=250, f_hi=9000, tone=True, curve=2.4):
    n = int(dur * SR)
    t = t_axis(n)
    u = t / dur
    fc = f_lo * (f_hi / f_lo) ** u
    out = []
    for c in range(2):
        x = svf(noise(n), fc * (1 + 0.04 * c), 2.2, 'bp') * 1.4
        out.append(x)
    st = np.stack(out, -1) * (u ** curve)[:, None]
    if tone:
        ft = 180 * (8.0 ** (u ** 1.3))
        tt = (saw(ft, n) * 0.3 + sine(ft * 2, n) * 0.4)
        tt = svf(tt, 900 + 6000 * u, 1.0) * (u ** 3)
        st += pan(tt * 0.6, 0)
    return st


def revcym(dur=1.2):
    c = crash(2.2)
    c = c[::-1]
    return c[-int(dur * SR):] * 1.0


def whoosh(dur=0.7, f0=500, f1=5000, p0=-0.8, p1=0.8, peak=0.55):
    n = int(dur * SR)
    t = t_axis(n)
    u = t / dur
    bell_ = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.5)
    fc = f0 * (f1 / f0) ** np.sin(np.pi * np.minimum(u / peak, 1) / 2)
    x = svf(noise(n), fc, 1.6, 'bp') * 1.6 + butter(noise(n), 3000, 'high') * 0.25
    x = x * bell_
    p = p0 + (p1 - p0) * u
    return pan(x, p)


def flyby(dur=1.8, p0=-0.9, p1=0.9, peak=0.45):
    n = int(dur * SR)
    t = t_axis(n)
    u = t / dur
    bell_ = np.where(u < peak, (u / peak) ** 2.2, ((1 - u) / (1 - peak)) ** 1.4)
    brown = np.cumsum(S.RNG.standard_normal(n))
    brown = butter(brown, 40, 'high', 2)
    brown /= np.abs(brown).max() + 1e-9
    fc = np.where(u < peak, 900 + 4500 * (u / peak) ** 2, 600 + 4800 * ((1 - u) / (1 - peak)) ** 2)
    x = svf(brown * 3 + noise(n) * 0.5, fc, 0.9) * bell_
    whine_f = np.where(u < peak, 1900, 1150) * (1 + 0.15 * np.cos(np.pi * u))
    whine = svf(saw(whine_f, n), 2500, 2.0, 'bp') * bell_ * 0.12
    return pan(x + whine, p0 + (p1 - p0) * u)


def blip(freq=2400, dur=0.12, vol=1.0):
    n = int(dur * SR)
    t = t_axis(n)
    x = np.sin(2 * np.pi * freq * t + 0.8 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t / 0.01))
    return S.fade_tail(x * np.exp(-t / 0.035) * vol * 0.3, 0.005)


def shing(f=1.0):
    n = int(1.4 * SR)
    t = t_axis(n)
    x = np.zeros(n)
    for fr, a, d in [(2100, .5, .5), (3320, .35, .4), (4710, .3, .3), (6180, .22, .25), (8120, .15, .18)]:
        x += a * np.sin(2 * np.pi * fr * f * t) * np.exp(-t / d)
    sw = butter(noise(n), 5000, 'high') * np.exp(-t / 0.05) * 0.6
    thump = sine(70 * (1 + np.exp(-t / 0.03)), n) * np.exp(-t / 0.09) * 0.8
    return S.fade_tail((x * 0.35 + sw + thump) * np.minimum(t / 0.001, 1), 0.05)


def downlifter(dur=2.0):
    n = int(dur * SR)
    t = t_axis(n)
    u = t / dur
    fc = 7000 * (200 / 7000) ** u
    x = svf(noise(n), fc, 1.8, 'bp') * (1 - u) ** 1.5 * 1.5
    return pan(x, 0)


# ------------------------------------------------------------------ harmony
CH = {  # supersaw / pad voicings (around D4..D5)   bass root (sub octave)
    'D': ([62, 66, 69, 74], 38), 'Dadd9': ([62, 64, 66, 69, 74], 38),
    'A': ([61, 64, 69, 73], 33), 'Bm': ([62, 66, 71, 74], 35),
    'G': ([62, 67, 71, 74], 31), 'Em': ([64, 67, 71, 76], 40),
    'Asus': ([62, 64, 69, 74], 33),
}
# chord per bar (bar = 4 beats)
BARS = (['Dadd9', 'Dadd9', 'Bm', 'G'] +             # 0-3   intro (globe)
        ['D', 'A', 'Bm', 'G'] +                     # 4-7   build A
        ['D', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G'] +  # 8-15  drop 1 (+ fleet)
        ['Bm', 'G', 'D', 'A'] +                     # 16-19 breakdown
        ['Bm', 'G', 'D', 'A'] +                     # 20-23 build B / warp
        ['D', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G'] +  # 24-31 drop 2 (cities)
        ['Em', 'A'] +                               # 32-33 finale
        ['D'] * 6)                                  # 34-39 logo

# hook: (step, length_in_steps, midi) per 4-bar phrase, steps relative to phrase
HOOK = [
    # bar 1 (D)
    (0, 2, 78), (2, 2, 81), (4, 2, 86), (6, 1, 81), (7, 2, 86), (9, 3, 88), (12, 4, 90),
    # bar 2 (A)
    (16, 2, 88), (18, 2, 85), (20, 2, 81), (22, 2, 76), (24, 2, 81), (26, 2, 85), (28, 2, 88), (30, 2, 85),
    # bar 3 (Bm)
    (32, 2, 86), (34, 2, 83), (36, 2, 78), (38, 1, 83), (39, 2, 86), (41, 3, 88), (44, 4, 90),
    # bar 4 (G)
    (48, 3, 91), (51, 3, 90), (54, 2, 88), (56, 3, 86), (59, 3, 85), (62, 2, 81),
]
# breakdown motif over Bm G D A (bell / soft)
SOFT = [
    (0, 6, 78), (6, 2, 76), (8, 8, 74),
    (16, 4, 74), (20, 4, 71), (24, 4, 74), (28, 4, 76),
    (32, 6, 78), (38, 2, 81), (40, 8, 78),
    (48, 8, 76), (56, 4, 73), (60, 4, 76),
]
FINALE = [(0, 4, 79), (4, 4, 81), (8, 8, 83), (16, 8, 88), (24, 4, 86), (28, 4, 85)]


def bar_chord(bar):
    return CH[BARS[min(bar, len(BARS) - 1)]]


def render():
    drums = S.Bus(N)
    kickbus = S.Bus(N)
    bass = S.Bus(N)
    music = S.Bus(N)
    pads = S.Bus(N)
    leadb = S.Bus(N)
    fx = S.Bus(N)
    verb_send = S.Bus(N)
    dly_send = S.Bus(N)
    kicks = []

    K_full = kick()
    K_lp = {c: kick(cut=c) for c in (220, 500, 1200)}
    CLAP = clap()
    HC = [hat() for _ in range(4)]
    HO = hat(True)
    CR = crash()

    def K(b, gain=1.0, cut=None):
        k = K_full if cut is None else K_lp[cut]
        kickbus.add(k, T(b), gain * db(-1))
        kicks.append(T(b))

    def CLP(b, gain=1.0):
        drums.add(CLAP, T(b), gain * db(1))
        verb_send.add(CLAP, T(b), gain * db(-14))

    def HAT(b, gain=1.0, open_=False, p=0.15):
        h = HO if open_ else HC[int(b * 4) % 4]
        drums.add(h, T(b), gain * db(-8 if not open_ else -11), p=p)

    def CRASH(b, gain=1.0):
        drums.add(CR, T(b), gain * db(-12))
        verb_send.add(CR, T(b), gain * db(-20))

    def groove(b0, b1, hats16=True, openhat=False, clap_on=True, kick_cut=None, hat_gain=1.0):
        b = b0
        while b < b1 - 1e-9:
            K(b, cut=kick_cut)
            beat_in_bar = int(round(b)) % 4
            if clap_on and beat_in_bar in (1, 3):
                CLP(b)
            for s in range(4):
                bb = b + s * 0.25
                acc = [0.45, 0.22, 1.0, 0.3][s]
                if hats16 or s == 2:
                    HAT(bb, acc * hat_gain, p=0.2 if s % 2 else -0.1)
            if openhat:
                HAT(b + 0.5, 0.55 * hat_gain, open_=True, p=-0.25)
            b += 1

    def offbeat_bass(b0, b1, cutoff=1300, gain=1.0):
        b = b0
        while b < b1 - 1e-9:
            bar = int(b // 4)
            root = bar_chord(bar)[1]
            bass.add(bass_note(root, STEP * 1.7, cutoff=cutoff), T(b + 0.5), gain * db(-1))
            b += 1

    def pad_bars(bar0, bar1, gain=1.0, cutoff=2200, attack=0.5):
        for bar in range(bar0, bar1):
            notes = bar_chord(bar)[0]
            v = chord_saw(notes, 4 * SPB, cutoff=cutoff, attack=attack, release=0.9, voices=5, res=0.7)
            pads.add(v, T(bar * 4), gain * db(-15))
            verb_send.add(v, T(bar * 4), gain * db(-20))

    def drop_chords(bar0, bar1, gain=1.0, cutoff=4200):
        for bar in range(bar0, bar1):
            notes = bar_chord(bar)[0]
            v = chord_saw(notes, 4 * SPB - 0.02, cutoff=cutoff, attack=0.004, release=0.25, voices=7, res=0.75)
            music.add(v, T(bar * 4), gain * db(-10))
            verb_send.add(v, T(bar * 4), gain * db(-22))

    def arp(bar0, bar1, gain=1.0, cut0=600, cut1=2500, octave=0):
        nb = bar1 - bar0
        for bar in range(bar0, bar1):
            notes = bar_chord(bar)[0]
            seq = [notes[0], notes[1], notes[2], notes[-1], notes[2], notes[1]]
            for s in range(16):
                frac = ((bar - bar0) * 16 + s) / max(nb * 16, 1)
                m = seq[s % len(seq)] + 12 + octave
                v = pluck(m, STEP * 0.9, bright=0.25 + 0.75 * frac, decay=0.08)
                cut = cut0 * (cut1 / cut0) ** frac
                v = svf(v, cut, 0.7)
                music.add(v, T(bar * 4 + s * 0.25), gain * db(-17), p=0.35 if s % 2 else -0.35)
                dly_send.add(v, T(bar * 4 + s * 0.25), gain * db(-24))

    def melody(seq, b0, voice='lead', gain=1.0, transpose=0, bright=1.0):
        for st, ln, m in seq:
            dur = ln * STEP
            if voice == 'lead':
                v = lead(m + transpose, dur * 0.92, bright)
                leadb.add(v, T(b0) + st * STEP, gain * db(0))
                dly_send.add(v, T(b0) + st * STEP, gain * db(-8))
                verb_send.add(v, T(b0) + st * STEP, gain * db(-19))
            elif voice == 'saw':
                v = supersaw(m + transpose, dur * 0.95, cutoff=3800, attack=0.006, release=0.2, voices=5)
                leadb.add(v, T(b0) + st * STEP, gain * db(-8))
                verb_send.add(v, T(b0) + st * STEP, gain * db(-21))
            elif voice == 'bell':
                v = bell(m + transpose, dur)
                leadb.add(pan(v, 0.1), T(b0) + st * STEP, gain * db(-3))
                dly_send.add(pan(v, 0), T(b0) + st * STEP, gain * db(-15))
                verb_send.add(pan(v, 0), T(b0) + st * STEP, gain * db(-18))
            elif voice == 'big':
                v = supersaw(m + transpose, dur * 0.98, cutoff=5200, attack=0.02, release=0.6, voices=7, spread=1.2)
                leadb.add(v, T(b0) + st * STEP, gain * db(-11))
                verb_send.add(v, T(b0) + st * STEP, gain * db(-15))

    def stab(b, name, gain=1.0, octave=0, dur_beats=0.9):
        notes = [m + octave for m in CH[name][0]] + [CH[name][0][0] + 12 + octave]
        v = chord_saw(notes, dur_beats * SPB, cutoff=5500, attack=0.002, release=0.5, voices=7, res=0.8)
        music.add(v, T(b), gain * db(-9))
        verb_send.add(v, T(b), gain * db(-12))
        bass.add(bass_note(CH[name][1], dur_beats * SPB, cutoff=1600), T(b), gain * db(-3))

    def IMPACT(b, size=1.0, gain=1.0):
        v = impact(size)
        fx.add(pan(v, 0), T(b), gain * db(-3))
        verb_send.add(pan(v, 0), T(b), gain * db(-12))

    def SUBDROP(b, gain=1.0):
        fx.add(pan(subdrop(), 0), T(b), gain * db(-5))

    def WHOOSH(b_center, dur=0.8, gain=1.0, **kw):
        v = whoosh(dur, **kw)
        fx.add(v, T(b_center) - dur * kw.get('peak', 0.55), gain * db(-10))
        verb_send.add(v, T(b_center) - dur * kw.get('peak', 0.55), gain * db(-20))

    def FLYBY(b_peak, dur=1.8, gain=1.0, **kw):
        v = flyby(dur, **kw)
        fx.add(v, T(b_peak) - dur * kw.get('peak', 0.45), gain * db(-14))
        verb_send.add(v, T(b_peak) - dur * kw.get('peak', 0.45), gain * db(-24))

    def RISER(b0, b1, gain=1.0, **kw):
        v = riser(T(b1) - T(b0), **kw)
        fx.add(v, T(b0), gain * db(-13))
        verb_send.add(v, T(b0), gain * db(-22))

    def REVCYM(b_end, dur=1.2, gain=1.0):
        v = revcym(dur)
        fx.add(v, T(b_end) - dur, gain * db(-11))

    def BLIP(b, f=2400, gain=1.0, p=0.0):
        fx.add(blip(f), T(b), gain * db(-12), p=p)
        dly_send.add(pan(blip(f), p), T(b), gain * db(-20))

    def SHING(b, f=1.0, gain=1.0, p=0.0):
        v = shing(f)
        fx.add(pan(v, p), T(b), gain * db(-12))
        verb_send.add(pan(v, p), T(b), gain * db(-18))

    def snare_roll(b0, b1, gain=1.0, start_div=2, end_div=8, pitch0=1.0, pitch1=1.6):
        b = b0
        while b < b1 - 1e-9:
            u = (b - b0) / (b1 - b0)
            div = start_div * (end_div / start_div) ** u
            div = 2 ** round(np.log2(div))
            pitch = pitch0 + (pitch1 - pitch0) * u
            v = snare(pitch)
            drums.add(v, T(b), gain * db(-12 + 9 * u), p=0.05)
            verb_send.add(pan(v, 0), T(b), gain * db(-20 + 6 * u))
            b += 1.0 / div

    # =============================================================== INTRO 0-16
    pad_bars(0, 4, gain=1.1, cutoff=1500, attack=1.2)
    music.add(pan(sub_note(38, 4 * 4 * SPB, attack=1.5), 0), 0.0, db(-12))
    arp(1, 4, gain=0.8, cut0=500, cut1=1800)
    # data chatter under the globe
    rng = np.random.default_rng(11)
    for _ in range(46):
        b = rng.uniform(0.6, 14.0)
        BLIP(b, f=float(rng.choice([1800, 2400, 3000, 3600, 4200])), gain=0.18 + 0.2 * rng.random(), p=float(rng.uniform(-0.8, 0.8)))
    IMPACT(1.5, size=0.5, gain=0.45)
    SHING(1.5, f=0.75, gain=0.45)
    WHOOSH(3.0, dur=1.6, gain=0.5, f0=300, f1=2500, p0=-0.5, p1=0.5)
    IMPACT(9.0, size=0.6, gain=0.5)
    SHING(9.0, f=0.9, gain=0.5)
    RISER(10.0, 16.0, gain=1.1)
    WHOOSH(15.9, dur=1.4, gain=1.1, f0=250, f1=7000, peak=0.85, p0=0, p1=0)
    REVCYM(16.0, 1.6, gain=1.0)

    # =============================================================== BUILD A 16-32
    IMPACT(16, 1.0)
    CRASH(16)
    SUBDROP(16, 0.8)
    for b in range(16, 28):
        K(b, gain=0.85, cut=220 if b < 20 else (500 if b < 24 else 1200))
        HAT(b + 0.5, 0.8)
        if b >= 24:
            for s in (0, 1, 3):
                HAT(b + s * 0.25, [0.4, 0.2, 0, 0.3][s])
            if b % 4 in (1, 3):
                CLP(b, 0.8)
    pad_bars(4, 7, gain=1.0, cutoff=2000, attack=0.2)
    arp(4, 7, gain=1.0, cut0=900, cut1=3500)
    offbeat_bass(20, 28, cutoff=500, gain=0.9)
    FLYBY(18.2, dur=2.2, gain=0.7, p0=-0.3, p1=0.4)
    FLYBY(26.5, dur=1.6, gain=0.8, p0=-0.9, p1=0.9)
    RISER(20, 31.75, gain=1.2)
    snare_roll(26, 28, gain=0.5, start_div=2, end_div=4)
    for b, name, oc in ((28, 'G', 0), (29, 'A', 0), (30, 'A', 12)):
        stab(b, name, gain=1.0, octave=oc, dur_beats=0.95 if b < 30 else 1.6)
        K(b)
        CLP(b, 0.9)
        IMPACT(b, size=0.55 if b < 30 else 0.8, gain=0.75)
        CRASH(b, 0.5)
    REVCYM(32.0, 1.0, gain=1.1)

    # =============================================================== DROP 1 32-64
    IMPACT(32, 1.0)
    SUBDROP(32)
    CRASH(32, 1.2)
    groove(32, 62, hats16=True)
    offbeat_bass(32, 62)
    drop_chords(8, 16, gain=1.0)
    melody(HOOK, 32)
    melody(HOOK, 48)
    snare_roll(47, 48, gain=0.6, start_div=4, end_div=4)
    CRASH(48)
    FLYBY(41.2, dur=1.9, gain=1.0, p0=-0.9, p1=0.9)
    FLYBY(48.6, dur=1.3, gain=0.9, p0=0.8, p1=-0.8)
    FLYBY(50.6, dur=1.5, gain=0.8, p0=-0.6, p1=0.8)
    WHOOSH(56.0, dur=0.9, gain=1.2, f0=600, f1=7000, p0=-0.9, p1=0.9)
    # fleet: a light-sweep "shing" per aircraft
    for i, b in enumerate(range(56, 62)):
        SHING(b, f=1.0 + 0.06 * i, gain=0.9, p=(-0.4 if i % 2 else 0.4))
    CRASH(56, 0.8)
    # Umbra reveal: drums drop, big stab, downlift into the breakdown
    stab(62, 'Bm', gain=0.9, octave=12, dur_beats=1.8)
    IMPACT(62, size=0.8, gain=0.8)
    music.add(downlifter(1.9), T(62.2), db(-12))

    # =============================================================== BREAKDOWN 64-80
    IMPACT(64, size=0.5, gain=0.35)
    for bar in range(16, 20):
        notes, root = bar_chord(bar)
        for i, m in enumerate(notes):
            v = epiano(m - 12 if i == 0 else m, 4 * SPB * 0.98, vel=0.9)
            music.add(v, T(bar * 4) + i * 0.012, db(-8))
            verb_send.add(v, T(bar * 4) + i * 0.012, db(-19))
        # gentle off-beat re-strike
        for off in (1.5, 2.5):
            for m in notes[1:3]:
                v = epiano(m, SPB * 0.8, vel=0.45)
                music.add(v, T(bar * 4 + off), db(-15))
        music.add(pan(sub_note(root, 4 * SPB * 0.97, 0.05), 0), T(bar * 4), db(-8))
    pad_bars(16, 20, gain=0.8, cutoff=1400, attack=0.8)
    melody(SOFT, 64, voice='bell', gain=1.0)
    for b in range(72, 80):
        K(b, gain=0.5, cut=1200) if b % 2 == 0 else None
        for s in range(4):
            drums.add(shaker(), T(b + s * 0.25), db(-24 + (4 if s == 2 else 0)), p=0.3)
    WHOOSH(72.3, dur=2.2, gain=0.6, f0=200, f1=1800, p0=-0.7, p1=0.5)
    FLYBY(77.5, dur=2.6, gain=0.45, p0=-0.6, p1=0.6)

    # =============================================================== BUILD B 80-96
    for b in range(80, 94):
        K(b, gain=0.9, cut=1200 if b < 88 else None)
        HAT(b + 0.5, 0.8)
        if b % 4 in (1, 3) and b < 88:
            CLP(b, 0.7)
    for b in (94, 94.5, 95):
        K(b, gain=0.95)
    pad_bars(20, 24, gain=1.0, cutoff=2400, attack=0.15)
    arp(20, 24, gain=1.1, cut0=800, cut1=6000)
    offbeat_bass(80, 95, cutoff=700, gain=0.9)
    FLYBY(81.5, dur=2.0, gain=0.6, p0=0.5, p1=-0.5)
    WHOOSH(88.0, dur=1.0, gain=1.3, f0=500, f1=8000, p0=0.9, p1=-0.9)
    snare_roll(88, 95.5, gain=1.0, start_div=2, end_div=8, pitch0=0.9, pitch1=1.9)
    RISER(84, 95.75, gain=1.4)
    WHOOSH(90.0, dur=1.6, gain=0.8, f0=300, f1=4000, p0=-0.7, p1=0.7)
    WHOOSH(95.8, dur=1.4, gain=1.1, f0=250, f1=7000, peak=0.85, p0=0, p1=0)
    REVCYM(96.0, 1.4, gain=1.2)
    for b, fq in ((91.5, 2600), (92.0, 2600), (92.45, 3300), (92.57, 4400)):
        BLIP(b, f=fq, gain=0.75)

    # =============================================================== DROP 2 96-128
    IMPACT(96, 1.1)
    SUBDROP(96)
    CRASH(96, 1.2)
    groove(96, 124, hats16=True, openhat=True)
    offbeat_bass(96, 124)
    drop_chords(24, 31, gain=1.05)
    melody(HOOK, 96)
    melody(HOOK, 96, voice='saw', transpose=-12, gain=0.9)
    melody(HOOK, 112)
    melody(HOOK, 112, voice='saw', transpose=-12, gain=0.9)
    arp(24, 31, gain=0.6, cut0=2500, cut1=4500, octave=12)
    for b in (104, 112, 120):
        CRASH(b, 0.8)
    snare_roll(111, 112, gain=0.6, start_div=4, end_div=4)
    FLYBY(97.5, dur=2.2, gain=0.8, p0=0.9, p1=-0.9)
    # city chips: lock-on blips
    for b in (96.5, 104.3, 108.3, 112.3, 116.3):
        BLIP(b, f=2600, gain=0.9, p=-0.5)
        BLIP(b + 0.12, f=3900, gain=0.7, p=-0.5)
    IMPACT(120, size=0.6, gain=0.6)
    IMPACT(122, size=0.6, gain=0.6)
    FLYBY(123.0, dur=1.4, gain=0.9, p0=-0.8, p1=0.8)
    # rapid-fire flashes
    for i, b in enumerate((124, 125, 126, 127)):
        K(b)
        CLP(b, 0.9)
        CRASH(b, 0.45)
        stab(b, ['Bm', 'G', 'A', 'A'][i], gain=0.9, octave=12 if i == 3 else 0, dur_beats=0.7)
        IMPACT(b, size=0.5, gain=0.5)
    for s in range(4):
        HAT(127 + s * 0.25, 0.6)
    REVCYM(128.0, 0.6, gain=0.9)

    # =============================================================== FINALE 128-136
    IMPACT(128, 1.2)
    SUBDROP(128, 1.0)
    CRASH(128, 1.3)
    for bar in (32, 33):
        notes, root = bar_chord(bar)
        v = chord_saw(notes + [notes[0] + 12], 4 * SPB, cutoff=5200, attack=0.03, release=0.8, voices=7, spread=1.2)
        music.add(v, T(bar * 4), db(-10))
        verb_send.add(v, T(bar * 4), db(-15))
        music.add(pan(sub_note(root, 4 * SPB, 0.01), 0), T(bar * 4), db(-6))
        bass.add(bass_note(root, 4 * SPB * 0.95, cutoff=900, drive=1.8), T(bar * 4), db(-5))
    melody(FINALE, 128, voice='big', gain=1.1)
    melody(FINALE, 128, voice='lead', gain=0.7, transpose=12)
    for b in (128, 132):
        K(b, 1.1)
    for b in (130, 134):
        v = snare(0.85, 0.5)
        drums.add(v, T(b), db(-3))
        verb_send.add(pan(v, 0), T(b), db(-6))
        CLP(b, 1.0)
    for i, b in enumerate(np.arange(134.5, 135.5, 0.25)):
        drums.add(tom([150, 120, 95, 75][i]), T(b), db(-6), p=[-0.5, -0.2, 0.2, 0.5][i])
    RISER(132, 135.5, gain=1.0, f_lo=500)
    # beat of silence-ish (cut to black) then the logo hit

    # =============================================================== LOGO 136-155
    IMPACT(136, 1.4, gain=1.1)
    SUBDROP(136, 1.0)
    CRASH(136, 1.3)
    notes = CH['D'][0] + [74 + 4, 81]
    v = chord_saw(notes, 10 * SPB, cutoff=4000, attack=0.005, release=3.0, voices=7, spread=1.2,
                  cut_env=lambda t: 1200 + 4200 * np.exp(-t / 1.6), decay=1.5, sustain=0.45)
    music.add(v, T(136), db(-9))
    verb_send.add(v, T(136), db(-11))
    for i, m in enumerate([50, 57, 62, 66, 69]):
        e = epiano(m, 12 * SPB, vel=0.8)
        music.add(e, T(136) + i * 0.015, db(-14))
    music.add(pan(sub_note(38, 10 * SPB, 0.005), 0), T(136), db(-5))
    melody([(0, 2, 86)], 136, voice='bell', gain=1.0)
    melody([(0, 2, 78), (2, 2, 81), (4, 4, 86), (8, 8, 90)], 140, voice='bell', gain=0.9)
    BLIP(144, f=2200, gain=0.8)
    BLIP(144.12, f=3300, gain=0.6)
    pad_bars(36, 38, gain=0.7, cutoff=1200, attack=1.0)
    melody([(0, 16, 86)], 148, voice='bell', gain=0.8)

    # =============================================================== MIX
    sc = S.sidechain_curve(N, kicks, depth=0.82, rel=0.24)
    sc_soft = S.sidechain_curve(N, kicks, depth=0.5, rel=0.22)
    kick_st = kickbus.x
    bass_st = bass.x * sc[:, None]
    music_st = S.widen(music.x, 1.25) * sc_soft[:, None]
    pads_st = S.widen(pads.x, 1.4) * sc[:, None]
    lead_st = leadb.x * (0.75 + 0.25 * sc_soft)[:, None]
    drums_st = drums.x
    fx_st = fx.x

    ir = S.make_ir(rt60=2.6, pre=0.025, bright=7000, width=1.3)
    verb = S.reverb(verb_send.x, ir) * (0.6 + 0.4 * sc_soft)[:, None]
    dly = S.pingpong(dly_send.x, 0.75 * SPB, fb=0.38, lp=0.3)
    dly = butter(dly, 400, 'high', 2)

    mix = (kick_st * db(0) + drums_st * db(-1) + bass_st * db(-1) + music_st * db(0) +
           pads_st * db(-1) + lead_st * db(1) + fx_st * db(-2) + verb * db(-4) + dly * db(10))
    mix = butter(mix, 26, 'high', 2)
    mix = S.peak_eq(mix, 320, -1.5, 0.8)
    mix = S.shelf(mix, 9000, 2.0, 'high')
    pk = np.abs(mix).max()
    mix = mix / pk * db(-6)
    mix = S.compress(mix, thresh_db=-18, ratio=2.2, att=0.01, rel=0.18, makeup_db=4)
    mix = S.softclip(mix * db(2), 1.3)
    mix = mix / np.abs(mix).max() * db(-1.0)
    # fade the very end
    fade = int(2.6 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    stems = dict(kick=kick_st, drums=drums_st, bass=bass_st, music=music_st, pads=pads_st,
                 lead=lead_st, fx=fx_st, verb=verb, dly=dly)
    return mix, stems


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'score.wav'
    mix, stems = render()
    wavfile.write(out, SR, mix.astype(np.float32))
    print('wrote', out, mix.shape, 'peak', np.abs(mix).max())
    for k, v in stems.items():
        print(f'  {k:6s} rms {20*np.log10(np.sqrt((v**2).mean())+1e-12):6.1f} dB  peak {20*np.log10(np.abs(v).max()+1e-12):6.1f}')

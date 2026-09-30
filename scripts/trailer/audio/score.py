#!/usr/bin/env python3
"""Skyloom trailer SCORE — single-command re-render.

    nice -n 15 python3 scripts/trailer/audio/score.py            # render + verify
    nice -n 15 python3 scripts/trailer/audio/score.py --no-verify

Reads the master timeline scripts/trailer/cuesheet.json (120 BPM, 4/4,
beat 0.5 s, bar 2.0 s) and writes, under /tmp/claude-0/audio/:
    score.wav            104.000 s, 48 kHz, stereo, 24-bit PCM (mastered)
    stems/*.wav          post-fader stems (incl. their reverb returns),
                         PRE master-bus glue/limiter; they sum to the
                         pre-master mix
    score_report.json    loudness / peak / timing numbers (verify.py)
    *.png                verification plots (verify.py)

Orchestral parts are MIDI (mido) rendered by fluidsynth from
MuseScore_General_Full.sf3 (reverb/chorus off); hybrid sound design
(braams, sub booms, risers, pulses, heartbeat, shimmer) is synthesized in
numpy (dsp.py); space is synthetic convolution halls/rooms; mastering is
glue compression + a 4x-oversampled true-peak limiter.

The motif is D-A-F-E (1-5-3-2): lonely piano in the cold open, heroic brass
theme in WORLD/LANDMARKS/CLIMAX, D-A-F#-E in D major for FAMILY.
"""
import json
import os
import sys
import time

import numpy as np
import pedalboard as pb
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dsp import (SR, n_, db, midi_hz, add_at, fade, stereo, sub_boom, heartbeat,  # noqa: E402
                 shepard_riser, noise_riser, cymbal, reverse_cymbal, ticks, bell,
                 shimmer, air_pad, radio_static, braam_synth, pulse_note, whoosh,
                 snap, gong, make_ir, convolve_stereo, tp_limiter, true_peak, sine,
                 sos_filter, soft_clip, impact)
import midiw  # noqa: E402
from midiw import Part, render  # noqa: E402

OUT = '/tmp/claude-0/audio'
CACHE = os.path.join(OUT, 'cache')
STEMS = os.path.join(OUT, 'stems')
CUES = json.load(open(os.path.join(HERE, '..', 'cuesheet.json')))
DUR = float(CUES['duration'])
N = n_(DUR)
BEAT, BAR = 0.5, 2.0
S16 = 0.125
midiw.EXACT_TIMES.update(h['t'] for h in CUES['hits'])
TARGET_LUFS = -14.0
CEILING_DBTP = -1.0

# ------------------------------------------------------------- pitches
PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6,
      'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def P(s):
    """'D4' -> 62 (C4 = 60)."""
    if isinstance(s, (int, np.integer)):
        return int(s)
    name, octv = (s[:2], s[2:]) if len(s) > 2 and s[1] in '#b' else (s[:1], s[1:])
    return 12 * (int(octv) + 1) + PC[name]


CHORDS = {  # name: (bass pc, chord pcs)
    'Dm': (2, [2, 5, 9]), 'Dm9': (2, [2, 5, 9, 4]), 'D': (2, [2, 6, 9]), 'Dadd9': (2, [2, 6, 9, 4]),
    'Bb': (10, [10, 2, 5]), 'Bbmaj7': (10, [10, 2, 5, 9]), 'Bbl': (10, [10, 2, 5, 9, 4]),
    'A': (9, [9, 1, 4]), 'Asus': (9, [9, 2, 4]), 'A/C#': (1, [9, 1, 4]), 'F': (5, [5, 9, 0]),
    'C': (0, [0, 4, 7]), 'Gm': (7, [7, 10, 2]), 'G': (7, [7, 11, 2]), 'Bm': (11, [11, 2, 6]),
    'D5': (2, [2, 9]),
}
HARM = [(0, 'Dm9'), (8, 'Dm'), (12, 'Bb'), (14, 'A'),
        (16, 'Dm'), (18, 'Bb'), (19, 'A'), (20, 'Dm'), (21, 'F'), (22, 'Bb'), (23, 'C'),
        (24, 'Bb'), (26, 'Gm'), (27, 'A'),
        (28, 'Dm'), (32, 'Bb'), (34, 'Gm'), (36, 'A'),
        (38, 'D'), (40, 'A/C#'), (42, 'Bm'), (44, 'G'), (45, 'A'), (46, 'D'), (48, 'G'), (49, 'Gm'),
        (50, 'Dm'), (52, 'Bb'), (53, 'A'), (54, 'Dm'), (55, 'F'), (56, 'Bb'), (57, 'C'), (58, 'Dm'),
        (60, 'Bbl'), (62, 'C'), (64, 'Dm9'), (66, 'Bb'), (67, 'A'),
        (68, 'Dm'), (70, 'Bb'), (71, 'A'), (72, 'Dm'), (73, 'F'), (74, 'Bb'), (75, 'C'),
        (76, 'Gm'), (77, 'A'),
        (78, 'Dm9'), (80, 'Bbmaj7'), (82, 'Gm'), (84, 'A'),
        (86, 'Dm'), (88, 'Bb'), (89, 'A'), (90, 'Bb'), (91, 'C'), (92, 'A'), (93, 'D'), (94, 'Dadd9')]


def chord_at(t):
    c = HARM[0][1]
    for t0, name in HARM:
        if t0 <= t + 1e-9:
            c = name
    return c


def voicing(chord, lo, hi):
    pcs = CHORDS[chord][1]
    return [m for m in range(P(lo), P(hi) + 1) if m % 12 in pcs]


def bass(chord, lo='G1'):
    b = CHORDS[chord][0]
    m = P(lo)
    while m % 12 != b:
        m += 1
    return m


def pc_near(pc, lo):
    m = P(lo)
    while m % 12 != pc:
        m += 1
    return m


# ------------------------------------------------------------ the score
class Score:
    STEM_NAMES = ['strings', 'brass', 'choir', 'keys', 'perc', 'impacts', 'synth', 'fx', 'sub']

    def __init__(self):
        self.parts = {}
        self.dry = {}
        self.send = {}
        self.rng = np.random.default_rng(2026)
        self.events = {}

    def part(self, name, bank, prog, stem, group='main', gain=0.0, pan=0.0, send=0.3,
             drum=False, expr=None, lead=0.0, gates=(), hum_t=0.006, hum_v=5, duck=0.0):
        p = Part(name, bank, prog, drum=drum, expr_cc=expr, lead=lead,
                 rng=np.random.default_rng(len(self.parts) * 7919 + 17), hum_t=hum_t, hum_v=hum_v)
        self.parts[name] = dict(part=p, stem=stem, group=group, gain=gain, pan=pan, send=send,
                                gates=list(gates), duck=duck)
        return p

    def buf(self, d, stem, group):
        k = (stem, group)
        if k not in d:
            d[k] = np.zeros((N, 2))
        return d[k]

    def put(self, stem, x, t, gain_db=0.0, group='main', pan=0.0, send=0.25):
        """Queue a synthesized layer (mixed later, one stem at a time, to
        keep peak memory low)."""
        if x.ndim == 1:
            x = stereo(x, pan)
        elif pan:
            x = balance(x, pan)
        self.events.setdefault((stem, group), []).append((t, (x * db(gain_db)).astype(np.float32), send))


def balance(x, pan):
    a = (pan + 1) * np.pi / 4
    return x * (np.array([np.cos(a), np.sin(a)]) * np.sqrt(2))[None, :]


def gate_env(gates, fade_s=0.012):
    """1 outside gate windows [(t_cut, t_resume)], 0 inside, cos fades."""
    e = np.ones(N)
    f = n_(fade_s)
    for (a, b) in gates:
        i0, i1 = n_(a), min(N, n_(b))
        e[i0:i1] = 0.0
        r = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
        s0 = max(0, i0 - f)
        e[s0:i0] = np.minimum(e[s0:i0], r[::-1][f - (i0 - s0):])
        if i1 < N:
            s1 = min(N, i1 + f)
            e[i1:s1] = np.minimum(e[i1:s1], r[:s1 - i1])
    return e


MAIN_GATES = [(49.5, 49.975), (78.0, 81.94), (94.0, DUR + 1)]


def compose():
    S = Score()
    R = S.rng
    # ---------------------------------------------------------------- parts
    # strings (MuseScore sectional strings; 'Expr' presets = CC2 dynamics)
    vln1 = S.part('vln1', 21, 49, 'strings', gain=-1, pan=-0.45, send=0.38, expr=2, lead=0.13, gates=MAIN_GATES, duck=5)
    vln2 = S.part('vln2', 26, 49, 'strings', gain=-3, pan=-0.2, send=0.38, expr=2, lead=0.13, gates=MAIN_GATES, duck=5)
    vla = S.part('vla', 31, 49, 'strings', gain=-3, pan=0.2, send=0.35, expr=2, lead=0.13, gates=MAIN_GATES, duck=5)
    vc = S.part('vc', 41, 49, 'strings', gain=-2, pan=0.35, send=0.3, expr=2, lead=0.12, gates=MAIN_GATES, duck=5)
    cb = S.part('cb', 51, 49, 'strings', gain=-1, pan=0.15, send=0.25, expr=2, lead=0.13, gates=MAIN_GATES, duck=5)
    vln_f = S.part('vln_f', 20, 48, 'strings', gain=-3, pan=-0.4, send=0.3, lead=0.04, gates=MAIN_GATES, hum_t=0.004, duck=3)
    vla_f = S.part('vla_f', 30, 48, 'strings', gain=-3, pan=0.15, send=0.28, lead=0.04, gates=MAIN_GATES, hum_t=0.004, duck=3)
    vc_f = S.part('vc_f', 40, 48, 'strings', gain=1, pan=0.3, send=0.22, lead=0.04, gates=MAIN_GATES, hum_t=0.004, duck=3)
    cb_f = S.part('cb_f', 50, 48, 'strings', gain=3, pan=0.1, send=0.2, lead=0.05, gates=MAIN_GATES, hum_t=0.004, duck=3)
    trem = S.part('trem', 21, 44, 'strings', gain=-4, pan=-0.3, send=0.35, expr=2, lead=0.06, gates=MAIN_GATES, duck=5)
    harm = S.part('harm', 21, 49, 'strings', group='night', gain=-6, pan=-0.3, send=0.6, expr=2, lead=0.13)
    vln_t = S.part('vln_t', 21, 49, 'strings', group='title', gain=-8, pan=-0.3, send=0.6, expr=2, lead=0.13)
    # brass
    hn = S.part('hn', 17, 60, 'brass', gain=1.5, pan=-0.25, send=0.34, expr=2, lead=0.03, gates=MAIN_GATES, duck=2)
    tbn = S.part('tbn', 17, 57, 'brass', gain=-2, pan=0.25, send=0.3, expr=2, lead=0.03, gates=MAIN_GATES, duck=2)
    tpt = S.part('tpt', 17, 56, 'brass', gain=-5, pan=0.05, send=0.3, expr=2, lead=0.01, gates=MAIN_GATES, duck=2)
    tuba = S.part('tuba', 17, 58, 'brass', gain=-3, pan=0.1, send=0.22, expr=2, lead=0.02, gates=MAIN_GATES, duck=3)
    bsec = S.part('bsec', 0, 61, 'brass', gain=-6, pan=0.0, send=0.32, lead=0.05, gates=MAIN_GATES, duck=5)
    stab_t = S.part('stab', 0, 57, 'brass', gain=-5, pan=0.1, send=0.3, lead=0.0, gates=MAIN_GATES, hum_t=0.0)
    stab_b = S.part('stab_b', 8, 61, 'brass', gain=-2, pan=-0.1, send=0.3, lead=0.0, gates=MAIN_GATES, hum_t=0.0)

    class _Stab:  # trombones (fast, brassy) + Brass 2 section, always together
        @staticmethod
        def chord(t, dur, notes, vel, exact=False):
            stab_t.chord(t, dur, notes, vel, exact)
            stab_b.chord(t, dur, notes, vel, exact)
    stab = _Stab()
    # choir
    aah = S.part('aah', 17, 52, 'choir', gain=-1, pan=0.0, send=0.45, expr=2, lead=0.15, gates=MAIN_GATES, duck=4)
    ooh = S.part('ooh', 17, 53, 'choir', gain=-4, pan=0.0, send=0.5, expr=2, lead=0.04, gates=MAIN_GATES, duck=4)
    ooh_t = S.part('ooh_t', 17, 53, 'choir', group='title', gain=-5, send=0.6, expr=2, lead=0.04)
    # keys
    pno_c = S.part('pno_c', 0, 0, 'keys', group='cold', gain=2, pan=0.1, send=0.55, hum_t=0.0)
    cel_c = S.part('cel_c', 0, 8, 'keys', group='cold', gain=-8, pan=-0.25, send=0.6, hum_t=0.0)
    pno = S.part('pno', 0, 0, 'keys', gain=-1, pan=0.1, send=0.45, gates=MAIN_GATES)
    harp = S.part('harp', 0, 46, 'keys', gain=-9, pan=-0.35, send=0.45, gates=MAIN_GATES, hum_t=0.004)
    cel = S.part('cel', 0, 8, 'keys', gain=-10, pan=-0.3, send=0.5, gates=MAIN_GATES)
    pno_n = S.part('pno_n', 0, 0, 'keys', group='night', gain=-3, pan=0.1, send=0.55, hum_t=0.0)
    pno_t = S.part('pno_t', 0, 0, 'keys', group='title', gain=-3, pan=0.05, send=0.6, hum_t=0.0)
    cel_t = S.part('cel_t', 0, 8, 'keys', group='title', gain=-10, pan=-0.3, send=0.65, hum_t=0.0)
    glk_t = S.part('glk_t', 0, 9, 'keys', group='title', gain=-16, pan=0.3, send=0.65, hum_t=0.0)
    # percussion
    taiko = S.part('taiko', 0, 116, 'perc', gain=0, pan=0.0, send=0.18, gates=MAIN_GATES, hum_t=0.003)
    taiko_hi = S.part('taiko_hi', 0, 116, 'perc', gain=-5, pan=-0.3, send=0.18, gates=MAIN_GATES, hum_t=0.004)
    cbd = S.part('cbd', 8, 116, 'perc', gain=-1, pan=0.0, send=0.2, gates=MAIN_GATES, hum_t=0.0)
    timp = S.part('timp', 0, 47, 'perc', gain=-2, pan=0.2, send=0.25, gates=MAIN_GATES, hum_t=0.004)
    okit = S.part('okit', 0, 48, 'perc', drum=True, gain=-4, pan=0.0, send=0.25, gates=MAIN_GATES, hum_t=0.003)
    ohit = S.part('ohit', 0, 55, 'brass', gain=-9, pan=0.0, send=0.3, gates=MAIN_GATES, hum_t=0.0)
    cbd_t = S.part('cbd_t', 8, 116, 'perc', group='title', gain=-2, send=0.35, hum_t=0.0)
    # pads
    halo = S.part('halo', 17, 94, 'synth', group='cold', gain=-10, pan=0.0, send=0.5, expr=2, lead=0.05)
    warm = S.part('warm', 17, 89, 'synth', gain=-9, pan=0.0, send=0.4, expr=2, lead=0.3, gates=MAIN_GATES, duck=6)
    halo_t = S.part('halo_t', 17, 94, 'synth', group='title', gain=-12, send=0.6, expr=2, lead=0.05)

    for p in (vln1, vln2, vla, vc, cb, trem, hn, tbn, tpt, tuba, aah, ooh, warm):
        p.cc(0, 2, 0)
    for p, off in ((vc_f, -1200), (vla_f, -1200), (vln_f, -1200), (cb_f, -700), (stab_t, -600)):
        p.nrpn_gen(0.0, 38, off)     # releaseVolEnv: tighter spiccato / stabs

    def gate(p, a, b):
        for d in S.parts.values():
            if d['part'] is p:
                d['gates'].append((a, b))

    # ---------------------------------------------------------- helpers
    def dyn(p, pts, num=None):
        """piecewise-linear CC automation through (t, value) points."""
        for (t0, v0), (t1, v1) in zip(pts[:-1], pts[1:]):
            if t1 - t0 < 0.02:
                p.cc(t1, num or p.expr_cc or 11, v1)
            else:
                p.ramp(t0, t1, v0, v1, num=num)

    def ostinato(p, t0, t1, octave_lo, vel_acc=112, vel_off=74, accents=(0, 3, 6, 8, 11, 14),
                 pattern=None, dur=0.11, cresc=None, eighths=False, exact_downbeats=True):
        """16th-note trailer ostinato following the harmony root; 3-3-2 accents."""
        t = t0
        while t < t1 - 1e-6:
            step = int(round((t % BAR) / S16)) % 16
            ch = chord_at(t)
            root = bass(ch, octave_lo)
            if eighths and step % 2:
                t += S16
                continue
            pitch = root + (pattern[step] if pattern else 0)
            acc = step in accents
            v = vel_acc if acc else vel_off
            if cresc:
                v = int(v * (cresc[0] + (cresc[1] - cresc[0]) * (t - t0) / max(t1 - t0, 1e-6)))
            p.note(t, dur, pitch, v, exact=False)
            t += S16

    def pulses(t0, t1, octave_lo='D2', step=S16, gain_db=-17, cut=(2400, 170), tau=0.06,
               accents=(0, 3, 6, 8, 11, 14), cresc=(1.0, 1.0), dur_k=0.9, stem='synth'):
        t = t0
        i = 0
        while t < t1 - 1e-6:
            s = int(round((t % BAR) / S16)) % 16
            root = bass(chord_at(t), 'G1')
            f = midi_hz(root)
            f = f * 2 if f < 60 else f
            acc = s in accents
            c0 = cut[0] * (1.0 if acc else 0.6)
            x = pulse_note(f, step * dur_k, c0, cut[1], tau, seed=100 + i % 7)
            k = cresc[0] + (cresc[1] - cresc[0]) * (t - t0) / max(t1 - t0, 1e-6)
            S.put(stem, x, t, gain_db + (0 if acc else -4) + 20 * np.log10(max(k, 1e-3)),
                  pan=0.0, send=0.12)
            t += step
            i += 1

    def roll(p, t0, t1, pitch, v0, v1, rate=0.0625, drum=False):
        t = t0
        while t < t1 - 1e-6:
            x = (t - t0) / max(t1 - t0, 1e-6)
            p.note(t, rate * 0.9 if not drum else 0.2, pitch, int(v0 + (v1 - v0) * x ** 1.6))
            t += rate

    def crash(t, v=120, synth_db=-17, pan=0.0):
        okit.note(t, 2.3, 57, v, exact=True)
        S.put('perc', cymbal(4.5, seed=int(t * 10)), t, synth_db, pan=pan, send=0.35)

    def riser(t_end, dur, level_db=-14, shep=True, nz=True, revcym=True, gm_rev=True, rev_db=None):
        if shep:
            S.put('fx', fade(shepard_riser(dur, seed=int(t_end)), 0.2, 0.006), t_end - dur,
                  level_db, send=0.3)
        if nz:
            S.put('fx', fade(noise_riser(dur * 0.9, seed=int(t_end) + 1), 0.1, 0.006),
                  t_end - dur * 0.9, level_db - 3, send=0.3)
        if revcym:
            d = min(dur, 2.0)
            S.put('perc', reverse_cymbal(d, seed=int(t_end) + 2), t_end - d,
                  (rev_db if rev_db is not None else level_db - 1), send=0.3)
        if gm_rev:
            okit_rev.note(t_end - 1.378, 1.5, 60, 110, exact=True)

    okit_rev = S.part('revcym', 0, 119, 'perc', gain=-6, send=0.35, gates=MAIN_GATES, hum_t=0.0)

    def hit(t, size=1.0, chord='Dm', stab_notes=None, braam=False, cym=True, gm=True, sub=True,
            taiko_v=127, ohit_on=True):
        """Layered trailer hit, sample-exact at t."""
        S.put('impacts', snap(0.12, seed=int(t * 7)), t, -13 + 4 * np.log2(size + 1e-3), send=0.25)
        S.put('impacts', impact(0.6 + 0.2 * size, 150 + 30 * size, 44, seed=int(t * 13), body_tau=0.09 + 0.05 * size),
              t, -6 + 3 * np.log2(size + 1e-3), send=0.12)
        if sub:
            S.put('sub', sub_boom(1.5 + size, f0=120, f1=33, sweep=0.25, tau=0.22 + 0.3 * size,
                                  click=0.3), t, -18 + 3 * np.log2(size + 1e-3), send=0.0)
        if gm:
            taiko.note(t, 1.5, 36, taiko_v, exact=True)
            taiko.note(t, 1.5, 41, int(taiko_v * 0.85), exact=True)
            cbd.note(t, 2.0, 38, min(127, int(100 + 27 * size)), exact=True)
            timp.note(t, 2.0, bass(chord, 'G1') if bass(chord, 'G1') >= 36 else bass(chord, 'G1') + 12,
                      min(127, int(95 + 30 * size)), exact=True)
            if ohit_on:
                ohit.chord(t, 0.6, [m for m in voicing(chord, 'D3', 'D4')][:3], 118, exact=True)
            sn = stab_notes if stab_notes is not None else voicing(chord, 'A1', 'A3')
            stab.chord(t, 0.35 + 0.25 * size, sn, 127, exact=True)
        if cym:
            crash(t, 118, -18 + 2 * size)

    # ======================================================= COLD OPEN 0-8
    # sub drone D1/D2, airy pad, radio texture, lonely piano motif
    tt = np.arange(n_(8.0)) / SR
    drone = 0.8 * sine(midi_hz(P('D1')), len(tt)) + 0.25 * sine(midi_hz(P('D2')) * 1.001, len(tt))
    drone *= np.minimum(1, tt / 3.0) ** 2 * (0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * tt))
    drone = fade(drone[:n_(7.94)], 0.3, 0.02)
    S.put('sub', drone, 0.0, -33, group='cold', send=0.0)
    ap = air_pad([midi_hz(P(x)) for x in ('D5', 'A5', 'E6')], 7.94, seed=3, noise_amt=0.5)
    ap *= (np.minimum(1, np.arange(len(ap)) / n_(3.5)) ** 2)[:, None]
    S.put('synth', fade(ap, 0.5, 0.02), 0.0, -32, group='cold', send=0.5)
    rs = radio_static(6.8, seed=9)
    rs *= (np.sin(np.linspace(0, np.pi, len(rs))) ** 1.5)
    S.put('synth', rs, 0.6, -44, group='cold', pan=0.35, send=0.35)
    halo.cc(0, 2, 0)
    halo.chord(0.4, 7.5, [P('D5'), P('A5'), P('E6')], 70)
    dyn(halo, [(0.4, 0), (3.5, 38), (6.5, 44), (7.9, 20)])
    pno_c.pedal(0.0)
    pno_c.note(1.0, 6.9, P('D2'), 34, exact=True)
    pno_c.note(1.0, 6.9, P('D3'), 26, exact=True)
    for t, m, v in ((1.0, 'D5', 54), (2.0, 'A5', 47), (3.0, 'F5', 50), (4.0, 'E5', 44)):
        pno_c.note(t, 3.0, P(m), v, exact=True)
    for t, m, v in ((5.0, 'D5', 50), (5.5, 'A5', 46), (6.0, 'F5', 49), (6.5, 'E5', 46)):
        pno_c.note(t, 1.4, P(m), v, exact=True)
        cel_c.note(t, 1.4, P(m) + 12, v + 6, exact=True)
    pno_c.pedal(7.93, False)
    # reverse "suck" 7.0 -> 7.94 (reversed braam through the hall + rev cymbal)
    rb = braam_synth([P('D2'), P('A2'), P('D3'), P('F3')], 2.2, seed=4, open_hz=2400, sub=False)
    rb = convolve_stereo(np.pad(rb, ((0, n_(2.5)), (0, 0))), make_ir(3.0, seed=5), 0.3)
    rb = rb[::-1][-n_(1.6):]
    rb = rb / (np.abs(rb).max() + 1e-9)
    rb *= (np.linspace(0, 1, len(rb)) ** 2.2)[:, None]
    S.put('fx', fade(rb, 0.05, 0.008), 7.94 - 1.6, -15, group='cold', send=0.0)
    S.put('perc', reverse_cymbal(1.2, seed=77), 7.94 - 1.2, -20, group='cold', send=0.2)
    S.put('fx', fade(noise_riser(0.9, 300, 7000, seed=78), 0.05, 0.008), 7.04, -26, group='cold', send=0.2)

    # ==================================================== HERO REVEAL 8-16
    # 8.0 MASSIVE BRAAM (D minor): GM brass + tuba + synth saws + sub + taiko
    bnotes = [P('D1'), P('D2'), P('A2'), P('D3'), P('F3'), P('A3')]
    S.put('fx', braam_synth(bnotes, 4.2, seed=8, open_hz=3600, rest_hz=380), 8.0, -8, send=0.4)
    S.put('sub', sub_boom(3.5, f0=130, f1=31, sweep=0.4, tau=1.0, click=0.35), 8.0, -12, send=0.0)
    S.put('impacts', impact(1.0, 190, 42, seed=80, body_tau=0.16), 8.0, -4, send=0.15)
    S.put('fx', gong(46.0, 6.0, seed=9), 8.0, -20, send=0.4)
    S.put('impacts', snap(0.12, 8), 8.0, -11, send=0.3)
    stab.chord(8.0, 3.2, [P('D2'), P('A2'), P('D3'), P('F3'), P('A3')], 127, exact=True)
    bsec.chord(8.0, 3.5, [P('D2'), P('A2'), P('D3'), P('F3')], 127, exact=True)
    tbn.chord(8.0, 3.8, [P('D2'), P('A2'), P('D3')], 100, exact=True)
    tuba.note(8.0, 4.0, P('D1'), 100, exact=True)
    tuba.note(8.0, 4.0, P('D2'), 100, exact=True)
    hn.chord(8.0, 3.6, [P('D3'), P('F3'), P('A3'), P('D4')], 100, exact=True)
    for p in (tbn, tuba, hn):
        dyn(p, [(7.99, 127), (8.6, 118), (11.8, 62), (12.0, 0)])
    taiko.note(8.0, 1.5, 36, 127, exact=True)
    taiko.note(8.0, 1.5, 33, 127, exact=True)
    cbd.note(8.0, 2.0, 38, 127, exact=True)
    timp.note(8.0, 2.5, P('D2'), 127, exact=True)
    ohit.chord(8.0, 0.8, [P('D3'), P('A3'), P('D4')], 120, exact=True)
    crash(8.0, 127, -14)
    # low string pad under the ostinato
    cb.note(8.0, 4.0, P('D1') + 12, 90, exact=True)
    vc.note(8.0, 4.0, P('D2'), 90, exact=True)
    cb.note(12.0, 2.0, P('Bb1'), 90)
    vc.note(12.0, 2.0, P('Bb2'), 90)
    cb.note(14.0, 1.98, P('A1'), 90)
    vc.note(14.0, 1.98, P('A2'), 90)
    for p in (cb, vc):
        dyn(p, [(7.99, 110), (9.0, 70), (12.0, 70), (14.0, 80), (15.9, 118)])
    # 8.5 low string ostinato (16ths on D), building
    vc_f.cc(0, 11, 100)
    cb_f.cc(0, 11, 100)
    ostinato(vc_f, 8.5, 16.0, 'G2', 108, 66, cresc=(0.82, 1.15))
    ostinato(cb_f, 8.5, 16.0, 'G1', 110, 70, eighths=True, cresc=(0.85, 1.12))
    ostinato(vla_f, 12.0, 16.0, 'G3', 100, 62, cresc=(0.75, 1.2))
    ostinato(vln_f, 14.0, 16.0, 'D4', 96, 60, cresc=(0.7, 1.25),
             pattern=[12, 0, 7, 12, 0, 7, 12, 7, 12, 0, 7, 12, 0, 7, 12, 7])
    # taiko on bar downbeats + boost accent 12.0 + fill into 16
    for t, v in ((10.0, 124), (11.0, 90), (11.5, 70), (12.0, 127), (13.0, 92), (13.5, 80),
                 (14.0, 124), (14.75, 88), (15.0, 96), (15.25, 100), (15.5, 110), (15.75, 120)):
        taiko.note(t, 1.2, 36 if v > 110 else 41, v, exact=(t in (10.0, 12.0, 14.0)))
    for t in (10.0, 12.0, 14.0):
        cbd.note(t, 1.5, 38, 110, exact=True)
    # 12.0 boost accent: low brass stab (Bb) + short sub + crash, hybrid pulse enters
    stab.chord(12.0, 0.6, [P('Bb1'), P('F2'), P('Bb2'), P('D3')], 120, exact=True)
    S.put('sub', sub_boom(1.6, 100, 33, 0.25, 0.4, 0.2), 12.0, -18, send=0.0)
    S.put('impacts', snap(0.1, 12), 12.0, -15, send=0.3)
    S.put('impacts', impact(0.6, 160, 45, seed=120), 12.0, -9, send=0.12)
    crash(12.0, 110, -19, pan=0.3)
    pulses(12.0, 16.0, gain_db=-20, cresc=(0.6, 1.1))
    # rising brass swell into 16 (A major, dominant)
    hn.chord(14.0, 1.97, [P('A3'), P('C#4'), P('E4'), P('A4')], 100)
    tbn.chord(14.0, 1.97, [P('A2'), P('E3'), P('A3')], 100)
    tuba.note(14.0, 1.97, P('A1'), 100)
    for p in (hn, tbn, tuba):
        dyn(p, [(13.9, 25), (15.95, 127), (15.99, 127)])
    bsec.chord(14.2, 1.78, [P('A2'), P('E3'), P('A3'), P('C#4')], 104)
    trem.chord(14.0, 1.97, [P('A4'), P('C#5'), P('E5')], 100)
    dyn(trem, [(13.9, 20), (15.95, 115)])
    riser(16.0, 2.5, -15)
    roll(okit, 15.0, 15.97, 38, 30, 118, 0.0625, drum=True)
    roll(timp, 15.0, 15.97, P('A1'), 40, 120, 0.0625)

    # ========================================================== WORLD 16-28
    theme_w = [(16.0, 1.5, 'D4'), (17.5, 0.5, 'A4'), (18.0, 1.0, 'F4'), (19.0, 1.0, 'E4'),
               (20.0, 1.0, 'D4'), (21.0, 0.5, 'A4'), (21.5, 0.5, 'C5'), (22.0, 1.0, 'D5'), (23.0, 1.0, 'E5'),
               (24.0, 1.5, 'F5'), (25.5, 0.5, 'E5'), (26.0, 1.0, 'D5'), (27.0, 0.97, 'C#5')]
    for t, d, m in theme_w:           # horns+trombones; violins 8va join at 20; tutti at 24
        ex = t in (16.0, 20.0, 24.0)
        hn.note(t, d * 0.98, P(m), 100, exact=ex)
        tbn.note(t, d * 0.98, P(m) - 12, 100, exact=ex)
        if t >= 20:
            vln2.note(t, d * 0.99, P(m) + 12, 100, exact=ex)
        if t >= 24:
            tpt.note(t, d * 0.98, P(m), 100, exact=ex)
            vln1.note(t, d * 0.99, P(m) + 12, 100, exact=ex)
            aah.note(t, d * 0.99, P(m), 100, exact=ex)
    dyn(hn, [(16.0, 104), (19.9, 100), (20.0, 110), (23.9, 112), (24.0, 122), (27.97, 124)])
    dyn(tbn, [(16.0, 96), (23.9, 104), (24.0, 116), (27.97, 118)])
    dyn(tpt, [(16.0, 0), (23.95, 0), (24.0, 108), (27.97, 116)])
    dyn(vln1, [(16.0, 0), (23.8, 0), (23.86, 96), (27.97, 110)])
    # low brass roots + chord pads
    for t0, t1 in ((16, 18), (18, 19), (19, 20), (20, 21), (21, 22), (22, 23), (23, 24), (24, 26), (26, 27), (27, 28)):
        ch = chord_at(t0)
        tuba.note(t0, (t1 - t0) * 0.97, bass(ch, 'G1'), 100, exact=(t0 in (16, 20, 24)))
        bsec.chord(t0, (t1 - t0) * 0.97, voicing(ch, 'F3', 'D4'), 84 if t0 < 24 else 100)
        vla.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'F3', 'D4')[-3:], 100)
        cb.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1'), 100)
        vc.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1') + 12, 100)
        warm.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'A4'), 90)
    dyn(tuba, [(16.0, 104), (27.97, 116)])
    for p, a, b in ((vla, 78, 104), (cb, 96, 116), (vc, 90, 112)):
        dyn(p, [(15.95, a), (23.9, a + 6), (24.0, b), (27.97, b)])
    dyn(vln2, [(15.9, 0), (19.8, 0), (19.87, 96), (23.9, 104), (24.0, 112), (27.97, 116)])
    dyn(warm, [(15.8, 40), (27.9, 70)])
    # choir lift at 24
    for t0, t1 in ((24, 26), (26, 27), (27, 28)):
        aah.chord(t0, (t1 - t0) * 0.99, voicing(chord_at(t0), 'A3', 'C5'), 100)
    dyn(aah, [(23.8, 50), (24.2, 100), (27.95, 122)])
    # ostinato full
    ostinato(vc_f, 16.0, 28.0, 'G2', 116, 74)
    ostinato(cb_f, 16.0, 28.0, 'G1', 116, 80, eighths=True)
    ostinato(vla_f, 16.0, 28.0, 'G3', 104, 66)
    ostinato(vln_f, 24.0, 28.0, 'D4', 104, 70,
             pattern=[12, 0, 7, 12, 0, 7, 12, 7, 12, 0, 7, 12, 0, 7, 12, 7])
    pulses(16.0, 28.0, gain_db=-18)
    # percussion
    for bar in range(16, 28, 2):
        for s, v, hi in ((0, 127, 0), (3, 84, 1), (6, 96, 0), (8, 112, 0), (10, 80, 1), (11, 92, 0),
                         (12, 104, 0), (14, 98, 1), (15, 88, 1)):
            t = bar + s * S16
            if s == 0 and bar in (16, 20, 24):
                continue  # the layered hit covers these downbeats
            (taiko_hi if hi else taiko).note(t, 1.0, 45 if hi else (36 if v > 100 else 41), v,
                                             exact=(s == 0))
        cbd.note(bar + 1.0, 1.5, 38, 96)
    for t in (16.0, 20.0, 24.0):
        hit(t, 1.0 if t != 24.0 else 1.2, chord_at(t))
    for te in (18.0, 22.0, 26.0):
        S.put('perc', reverse_cymbal(1.5, seed=int(te)), te - 1.5, -24, send=0.3)
    for te in (20.0, 24.0):
        S.put('perc', reverse_cymbal(1.8, seed=int(te)), te - 1.8, -20, send=0.3)
    for t0 in (19.0, 23.0):
        roll(timp, t0, t0 + 0.97, bass(chord_at(t0), 'G1') + (12 if bass(chord_at(t0), 'G1') < 36 else 0), 40, 112)
    # into the 28 hit
    roll(timp, 27.0, 27.97, P('A2') - 12, 50, 124)
    roll(okit, 27.0, 27.97, 38, 40, 120, 0.0625, drum=True)
    riser(28.0, 2.0, -17)

    # ==================================================== LIVE TRAFFIC 28-38
    hit(28.0, 1.5, 'Dm')
    S.put('fx', braam_synth([P('D1'), P('D2'), P('A2'), P('D3')], 2.2, seed=28, open_hz=2600), 28.0, -12, send=0.4)
    stab.chord(28.0, 1.2, [P('D2'), P('A2'), P('D3'), P('F3')], 127, exact=True)
    hn.note(28.0, 0.9, P('D5') - 12, 110, exact=True)
    tpt.note(28.0, 0.6, P('D5'), 110, exact=True)
    dyn(tpt, [(28.0, 116), (28.6, 60)])
    # drop: pulsing synth bass on 8ths, ticking hats, low strings, radio texture
    pulses(28.5, 37.94, step=0.25, gain_db=-15, cut=(1400, 140), tau=0.05,
           accents=(0, 4, 8, 12), cresc=(0.75, 1.25), dur_k=0.8)
    tk_t = list(np.arange(28.5, 37.94, S16))
    acc = [1.0 if int(round((t % 1.0) / S16)) % 2 == 0 else 0.45 for t in tk_t]
    for t, x in ticks(tk_t, 1.0, seed=5, f=6500, dur=0.025, accents=acc):
        S.put('perc', x, t, -33 + 6 * (t - 28.5) / 9.5, send=0.1)
    for t, x in ticks(list(np.arange(28.5, 37.94, 0.5)), 1.0, seed=6, f=2600, dur=0.03):
        S.put('perc', x, t, -33, send=0.15)
    rs2 = radio_static(5.0, seed=12)
    rs2 *= np.sin(np.linspace(0, np.pi, len(rs2)))
    S.put('synth', rs2, 29.0, -40, pan=-0.4, send=0.3)
    for t0, t1 in ((28.3, 32), (32, 34), (34, 36), (36, 37.97)):
        ch = chord_at(t0 + 0.1)
        cb.note(t0, t1 - t0, bass(ch, 'G1'), 100)
        vc.note(t0, t1 - t0, bass(ch, 'G1') + 12 + (7 if ch == 'Dm' else 0), 100)
    dyn(cb, [(28.2, 0), (29.5, 72), (33.0, 80), (36.0, 92), (37.95, 118)])
    dyn(vc, [(28.2, 0), (29.5, 66), (33.0, 76), (36.0, 90), (37.95, 116)])
    vln2.note(28.6, 5.4, P('A5'), 100)
    vln2.note(34.0, 2.0, P('G5'), 100)
    dyn(vln2, [(28.4, 0), (30.5, 44), (33.9, 50), (35.9, 56)])
    # build 34-38
    trem.chord(34.0, 2.0, [P('G4'), P('Bb4'), P('D5')], 100)
    trem.chord(36.0, 1.96, [P('A4'), P('C#5'), P('E5'), P('A5')], 100)
    dyn(trem, [(33.9, 16), (35.9, 60), (37.95, 124)])
    hn.chord(36.0, 1.96, [P('A3'), P('C#4'), P('E4')], 100)
    tbn.chord(36.0, 1.96, [P('A2'), P('E3')], 100)
    for p in (hn, tbn):
        dyn(p, [(35.9, 20), (37.95, 122)])
    aah.chord(36.0, 1.96, [P('A3'), P('E4'), P('A4'), P('C#5')], 100)
    dyn(aah, [(35.8, 20), (37.95, 116)])
    for t, v in ((34.0, 84), (35.0, 90), (36.0, 100), (36.5, 96), (37.0, 108), (37.25, 100),
                 (37.5, 114), (37.625, 108), (37.75, 120), (37.875, 124)):
        taiko.note(t, 0.9, 41 if v < 110 else 36, v)
    roll(okit, 36.0, 37.95, 38, 24, 122, 0.0625, drum=True)
    roll(timp, 36.5, 37.95, P('A1'), 30, 118, 0.0625)
    riser(37.94, 4.0, -15, rev_db=-17)
    for p in (trem, hn, tbn, aah, okit, timp, taiko, vln2, cb, vc, okit_rev):
        gate(p, 37.94, 37.995)
    S.put('fx', whoosh(1.0, 0.9, seed=37), 37.1, -24, send=0.3)

    # ========================================================= FAMILY 38-50
    # 38.0 soft impact: warm sub + concert BD + low piano + gong bloom
    S.put('sub', sub_boom(3.0, 80, 34, 0.3, 0.8, 0.15), 38.0, -17, send=0.0)
    S.put('impacts', impact(0.8, 110, 40, seed=380, body_tau=0.18, crack=0.25, thump=0.6), 38.0, -9, send=0.3)
    S.put('fx', gong(73.4, 6.0, seed=38), 38.0, -26, send=0.5)
    cbd.note(38.0, 2.0, 38, 88, exact=True)
    pno.pedal(37.99)
    for tc in (40, 42, 44, 45, 46, 48, 49):
        pno.pedal(tc - 0.02, False)
        pno.pedal(tc + 0.03)
    pno.note(38.0, 3.5, P('D1') + 12, 70, exact=True)
    pno.chord(38.0, 1.8, [P('A2'), P('D3'), P('F#3'), P('A3'), P('D4')], 66, exact=True)
    okit.note(38.0, 2.3, 59, 64, exact=True)                      # soft suspended cymbal
    S.put('impacts', sos_filter(snap(0.1, 380), 'lowpass', 3500, 2), 38.0, -20, send=0.4)
    for i, m in enumerate([m for m in voicing('D', 'D3', 'D6')]):  # harp gliss blooms after the impact
        harp.note(38.12 + i * 0.035, 0.8, m, 66 + i, exact=True)
    pno.note(38.0, 3.5, P('D2') + 12, 58, exact=True)
    # harp arpeggios (8ths)
    t = 38.0
    k = 0
    while t < 49.4:
        ch = chord_at(t)
        tones = voicing(ch, 'D3', 'A5')
        seq = tones[::2] + tones[1::2][::-1]
        harp.note(t, 0.6, seq[k % len(seq)], 62 + (8 if k % 4 == 0 else 0))
        t += 0.25
        k += 1
    # piano motif in D major
    for t, d, m, v in ((38.5, 1.0, 'D5', 62), (39.5, 0.5, 'A5', 56), (40.0, 1.0, 'F#5', 60), (41.0, 1.5, 'E5', 54),
                       (42.5, 1.0, 'D5', 60), (43.5, 0.5, 'A5', 56), (44.0, 1.0, 'B5', 60), (45.0, 1.0, 'A5', 58)):
        pno.note(t, d, P(m), v)
        if t >= 42.5:
            cel.note(t, d, P(m) + 12, v - 4)
    for t, ch, v in ((40.0, 'A/C#', 44), (42.0, 'Bm', 46), (44.0, 'G', 50), (46.0, 'D', 62), (48.0, 'G', 50)):
        pno.chord(t, 1.9, voicing(ch, 'F#3', 'D4'), v)
        pno.note(t, 1.9, bass(ch, 'G1') + 12, v + 4)
    pno.pedal(49.45, False)
    # strings legato swell
    for t0, t1 in ((38, 40), (40, 42), (42, 44), (44, 45), (45, 46), (46, 48), (48, 49), (49, 49.5)):
        ch = chord_at(t0)
        cb.note(t0, t1 - t0, bass(ch, 'G1'), 100)
        vc.note(t0, t1 - t0, bass(ch, 'G1') + 12, 100)
        vla.chord(t0, t1 - t0, voicing(ch, 'F#3', 'D4')[-2:], 100)
        vln2.chord(t0, t1 - t0, voicing(ch, 'D4', 'B4')[-2:], 100)
        warm.chord(t0, t1 - t0, voicing(ch, 'D4', 'D5'), 90)
    for t, d, m in ((38.0, 2.0, 'F#5'), (40.0, 2.0, 'E5'), (42.0, 2.0, 'F#5'), (44.0, 1.0, 'G5'),
                    (45.0, 1.0, 'A5'), (46.0, 2.0, 'A5'), (48.0, 1.0, 'B5'), (49.0, 0.48, 'Bb5')):
        vln1.note(t, d, P(m), 100, exact=(t == 46.0))
    fam = [(37.97, 52), (40.0, 62), (42.0, 76), (44.0, 84), (45.6, 108), (46.0, 124), (47.0, 112), (48.0, 90),
           (49.45, 34), (49.5, 0)]
    for p, off in ((vln1, 0), (vln2, -6), (vla, -4), (vc, 0), (cb, -2), (warm, -30)):
        dyn(p, [(t, max(0, v + off)) for t, v in fam])
    # choir: oohs from 42, aahs from 44, peak 46
    for t0, t1 in ((42, 44),):
        ooh.chord(t0, t1 - t0, voicing(chord_at(t0), 'D4', 'B4'), 100)
    dyn(ooh, [(41.9, 20), (43.9, 70), (44.3, 0)])
    for t0, t1 in ((44, 45), (45, 46), (46, 48), (48, 49), (49, 49.5)):
        aah.chord(t0, t1 - t0, voicing(chord_at(t0), 'C#4', 'D5'), 100)
    dyn(aah, [(43.8, 40), (45.8, 104), (46.0, 118), (47.5, 104), (48.2, 80), (49.45, 30), (49.5, 0)])
    # horns: motif at the 46 peak, D major
    for t, d, m in ((46.0, 1.0, 'D4'), (47.0, 0.5, 'A4'), (47.5, 0.5, 'F#4'), (48.0, 1.0, 'E4'), (49.0, 0.48, 'D4')):
        hn.note(t, d * 0.98, P(m), 100, exact=(t == 46.0))
        tbn.note(t, d * 0.98, P(m) - 12, 100, exact=(t == 46.0))
    hn.chord(44.0, 1.95, [P('D4'), P('G4')], 100)
    dyn(hn, [(43.8, 20), (45.9, 90), (46.0, 112), (48.0, 92), (49.45, 36)])
    dyn(tbn, [(45.8, 0), (46.0, 88), (48.0, 70), (49.45, 20)])
    # peak lift at 46
    roll(timp, 45.0, 45.97, P('A1'), 22, 96, 0.0625)
    S.put('perc', reverse_cymbal(1.8, seed=46), 44.2, -22, send=0.35)
    cbd.note(46.0, 2.0, 38, 96, exact=True)
    okit.note(46.0, 2.3, 57, 92, exact=True)
    S.put('sub', sub_boom(2.5, 70, 36, 0.3, 0.7, 0.05), 46.0, -21, send=0.0)
    S.put('synth', fade(shimmer([midi_hz(P(x)) for x in ('D6', 'F#6', 'A6', 'E7')], 3.4, seed=46, attack=0.6), 0.01, 1.6),
          46.0, -34, send=0.6)

    # ====================================================== AIR FORCE 50-60
    hit(50.0, 1.4, 'Dm', stab_notes=[P('D2'), P('A2'), P('D3'), P('F3'), P('A3')])
    S.put('fx', braam_synth([P('D1'), P('D2'), P('A2'), P('D3')], 1.6, seed=50, open_hz=2800), 50.0, -13, send=0.35)
    for bar in (50, 52, 54, 56):
        ch = chord_at(bar)
        if bar != 50:
            hit(bar, 0.8, ch, cym=(bar == 54), ohit_on=False)
        # war drums
        for s, v in ((0, 127), (3, 98), (6, 108), (8, 118), (10, 94), (11, 104), (12, 112), (14, 108), (15, 96)):
            if s == 0:
                continue
            taiko.note(bar + s * S16, 1.0, 36 if v > 105 else 41, v)
        for s, v in ((2, 80), (5, 76), (9, 84), (13, 90)):
            taiko_hi.note(bar + s * S16, 0.8, 45, v)
        for s in (4, 12):
            okit.note(bar + s * S16, 0.4, 38, 112)
            okit.note(bar + s * S16 - 0.02, 0.2, 38, 60)
        cbd.note(bar + 1.0, 1.2, 38, 104)
        # staccato brass 3-3-2 on the chord (changes with the half-bar harmony)
        for s in (0, 3, 6, 8, 11, 14):
            t = bar + s * S16
            chh = chord_at(t)
            if s == 0:
                continue  # hit() already stabs the downbeat
            stab.chord(t, 0.16, voicing(chh, 'F2', 'F3'), 118 if s in (8,) else 108)
            ohit.chord(t, 0.2, voicing(chh, 'D4', 'A4')[:2], 70) if s == 8 else None
    ostinato(vc_f, 50.0, 58.0, 'G2', 124, 86, accents=(0, 2, 3, 6, 8, 10, 11, 14))
    ostinato(cb_f, 50.0, 58.0, 'G1', 124, 88, eighths=True)
    ostinato(vla_f, 50.0, 58.0, 'G3', 108, 70)
    pulses(50.0, 58.0, gain_db=-19)
    for t0, t1 in ((50, 52), (52, 53), (53, 54), (54, 55), (55, 56), (56, 57), (57, 58)):
        ch = chord_at(t0)
        cb.note(t0, t1 - t0, bass(ch, 'G1'), 100)
        tuba.note(t0, (t1 - t0) * 0.95, bass(ch, 'G1'), 100)
    dyn(cb, [(49.9, 90), (57.95, 110), (58.0, 0)])
    dyn(tuba, [(49.9, 96), (57.95, 116)])
    # horn/trombone rising counter-line (legato over the stabs)
    for t, d, m in ((50.0, 2.0, 'D4'), (52.0, 1.0, 'F4'), (53.0, 1.0, 'E4'), (54.0, 1.0, 'A4'),
                    (55.0, 1.0, 'C5'), (56.0, 1.0, 'D5'), (57.0, 0.97, 'E5')):
        hn.note(t, d * 0.97, P(m), 100, exact=(t == 50.0))
        tbn.note(t, d * 0.97, P(m) - 12, 100, exact=(t == 50.0))
    dyn(hn, [(49.9, 108), (57.95, 126)])
    dyn(tbn, [(49.9, 100), (57.95, 124)])
    for t0 in (50, 52, 54, 56):
        vln1.chord(t0, 1.98, voicing(chord_at(t0), 'D5', 'D6')[-2:], 100)
    dyn(vln1, [(49.9, 50), (57.95, 92)])
    roll(okit, 57.0, 57.97, 38, 50, 124, 0.0625, drum=True)
    # 58.0 stinger
    hit(58.0, 1.3, 'Dm', stab_notes=[P('D2'), P('A2'), P('D3'), P('F3'), P('A3'), P('D4')])
    hn.chord(58.0, 0.5, [P('D4'), P('F4'), P('A4'), P('D5')], 100, exact=True)
    tbn.chord(58.0, 0.5, [P('D3'), P('A3')], 100, exact=True)
    tpt.chord(58.0, 0.4, [P('D5'), P('A5')], 100, exact=True)
    dyn(hn, [(58.0, 127), (58.6, 30)])
    dyn(tbn, [(58.0, 127), (58.6, 30)])
    dyn(tpt, [(57.99, 120), (58.5, 20)])
    # riser 58-60
    riser(60.0, 2.0, -14, rev_db=-15)
    roll(okit, 59.0, 59.97, 38, 30, 122, 0.05, drum=True)
    trem.chord(58.2, 1.77, [P('C5'), P('E5'), P('G5')], 100)
    dyn(trem, [(58.1, 10), (59.97, 110)])

    # ============================================================ WARP 60-68
    hit(60.0, 1.1, 'Bb', stab_notes=[P('Bb1'), P('F2'), P('Bb2'), P('D3')], ohit_on=False)
    S.put('fx', whoosh(1.4, 0.12, seed=60, f_lo=300, f_hi=7000), 59.83, -18, send=0.35)
    # shimmering lydian texture + ticking pulse
    t = 60.0
    k = 0
    arp = [P('Bb4'), P('D5'), P('F5'), P('A5'), P('E6'), P('A5'), P('F5'), P('D5')]
    arp2 = [P('C5'), P('E5'), P('G5'), P('D6'), P('E6'), P('D6'), P('G5'), P('E5')]
    while t < 63.95:
        cel.note(t, 0.2, (arp if t < 62 else arp2)[k % 8], 62 + 10 * (k % 4 == 0))
        t += S16
        k += 1
    S.put('synth', fade(shimmer([midi_hz(P(x)) for x in ('F5', 'A5', 'D6', 'E6', 'A6')], 4.0, seed=61, attack=0.8), 0.01, 0.4),
          60.0, -30, send=0.6)
    trem.chord(60.0, 3.96, [P('F5'), P('A5'), P('D6')], 100)
    dyn(trem, [(59.98, 44), (61.5, 56), (63.95, 90)])
    cb.note(60.0, 4.0, P('Bb1'), 100)
    vc.note(60.0, 2.0, P('F2'), 100)
    vc.note(62.0, 2.0, P('G2'), 100)
    dyn(cb, [(59.9, 64), (63.95, 80)])
    dyn(vc, [(59.9, 50), (63.95, 80)])
    for t, x in ticks(list(np.arange(60.25, 67.95, 0.25)), 1.0, seed=62, f=6000, dur=0.02):
        S.put('perc', x, t, -33, send=0.15)
    riser(64.0, 2.0, -13, rev_db=-14)
    S.put('fx', fade(shepard_riser(3.0, base=110, seed=63), 0.4, 0.006), 61.0, -22, send=0.4)
    # 64.0 sub BOOM (warp arrival, Paris at dusk)
    S.put('sub', sub_boom(4.0, 100, 29, 0.45, 1.0, 0.35, sat=2.0), 64.0, -10, send=0.0)
    S.put('impacts', impact(1.2, 120, 36, seed=640, body_tau=0.25, crack=0.3, thump=0.7), 64.0, -5, send=0.25)
    S.put('fx', gong(36.7, 7.0, seed=64), 64.0, -18, send=0.5)
    S.put('impacts', snap(0.1, 64), 64.0, -15, send=0.4)
    cbd.note(64.0, 2.5, 38, 124, exact=True)
    timp.note(64.0, 3.0, P('D2'), 118, exact=True)
    taiko.note(64.0, 1.5, 33, 124, exact=True)
    pno.note(64.0, 3.5, P('D1'), 90, exact=True)
    pno.note(64.0, 3.5, P('D2'), 80, exact=True)
    pno.pedal(63.99)
    pno.pedal(67.9, False)
    # 64-68 arrival pad + gentle pulse + build into 68
    for t0, t1 in ((64, 66), (66, 67), (67, 68)):
        ch = chord_at(t0)
        cb.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1'), 100)
        vc.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1') + 12, 100)
        vla.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'F4'), 100)
        vln2.chord(t0, (t1 - t0) * 0.99, voicing(chord_at(t0), 'D5', 'A5')[:2], 100)
        warm.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'D4', 'E5'), 90)
    dyn(cb, [(63.95, 86), (66.0, 90), (67.97, 118)])
    dyn(vc, [(63.95, 80), (67.97, 116)])
    dyn(vla, [(63.9, 50), (66.0, 70), (67.97, 110)])
    dyn(vln2, [(63.9, 40), (66.0, 60), (67.97, 104)])
    dyn(warm, [(63.8, 30), (67.9, 60)])
    t = 64.5
    k = 0
    while t < 67.9:
        ch = chord_at(t)
        tones = voicing(ch, 'D4', 'A5')
        harp.note(t, 0.5, tones[k % len(tones)], 58)
        t += 0.25
        k += 1
    pulses(64.5, 68.0, step=0.25, gain_db=-20, cut=(1200, 150), accents=(0, 4, 8, 12), cresc=(0.6, 1.2))
    ostinato(vc_f, 66.0, 68.0, 'G2', 100, 60, cresc=(0.7, 1.2))
    for t, v in ((66.0, 96), (67.0, 104), (67.5, 112), (67.75, 118), (67.875, 124)):
        taiko.note(t, 0.9, 36 if v > 110 else 41, v)
    roll(timp, 67.0, 67.97, P('A1'), 40, 124, 0.0625)
    roll(okit, 67.0, 67.97, 38, 30, 124, 0.0625, drum=True)
    hn.chord(66.5, 1.47, [P('A3'), P('C#4'), P('E4')], 100)
    tbn.chord(66.5, 1.47, [P('A2'), P('E3')], 100)
    for p in (hn, tbn):
        dyn(p, [(66.4, 20), (67.96, 122)])
    riser(68.0, 1.6, -15, shep=True, rev_db=-16)

    # ======================================================= LANDMARKS 68-78
    theme_l = [(68.0, 1.5, 'D4'), (69.5, 0.5, 'A4'), (70.0, 1.0, 'F4'), (71.0, 1.0, 'E4'),
               (72.0, 1.0, 'D4'), (73.0, 0.5, 'A4'), (73.5, 0.5, 'C5'), (74.0, 1.0, 'D5'), (75.0, 1.0, 'E5'),
               (76.0, 1.0, 'F5'), (77.0, 0.5, 'E5'), (77.5, 0.49, 'C#5')]
    for t, d, m in theme_l:
        ex = t in (68.0, 70.0, 72.0, 74.0, 76.0)
        hn.note(t, d * 0.98, P(m), 100, exact=ex)
        tbn.note(t, d * 0.98, P(m) - 12, 100, exact=ex)
        tpt.note(t, d * 0.98, P(m) + (12 if t >= 72 else 0), 100, exact=ex)
        vln1.note(t, d * 0.99, P(m) + 12, 100, exact=ex)
        vln2.note(t, d * 0.99, P(m), 100, exact=ex)
        aah.note(t, d * 0.99, P(m), 100, exact=ex)
    dyn(hn, [(67.99, 118), (77.97, 127)])
    dyn(tbn, [(67.99, 112), (77.97, 124)])
    dyn(tpt, [(67.99, 98), (71.9, 104), (72.0, 112), (77.97, 118)])
    dyn(vln1, [(67.86, 104), (77.97, 118)])
    for t0, t1 in ((68, 70), (70, 71), (71, 72), (72, 73), (73, 74), (74, 75), (75, 76), (76, 77), (77, 78)):
        ch = chord_at(t0)
        ex = t0 in (68, 70, 72, 74, 76)
        tuba.note(t0, (t1 - t0) * 0.97, bass(ch, 'G1'), 100, exact=ex)
        bsec.chord(t0, (t1 - t0) * 0.97, voicing(ch, 'F3', 'D4'), 104)
        vla.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'F3', 'D4')[-3:], 100)
        cb.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1'), 100)
        vc.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1') + 12, 100)
        warm.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'A4'), 90)
        aah.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'C5'), 100)
    dyn(tuba, [(67.99, 112), (77.97, 122)])
    for p, a in ((vla, 104), (vln2, 104), (cb, 116), (vc, 112)):
        dyn(p, [(67.9, a), (77.97, min(127, a + 8))])
    dyn(warm, [(67.9, 60), (77.9, 76)])
    dyn(aah, [(67.8, 96), (77.97, 124)])
    ostinato(vc_f, 68.0, 78.0, 'G2', 122, 80)
    ostinato(cb_f, 68.0, 78.0, 'G1', 122, 86, eighths=True)
    ostinato(vla_f, 68.0, 78.0, 'G3', 110, 72)
    ostinato(vln_f, 68.0, 78.0, 'D4', 108, 74,
             pattern=[12, 0, 7, 12, 0, 7, 12, 7, 12, 0, 7, 12, 0, 7, 12, 7])
    pulses(68.0, 78.0, gain_db=-17)
    for bar in range(68, 78, 2):
        hit(bar, 1.25 if bar == 68 else 1.0, chord_at(bar))
        for s, v, hi in ((3, 88, 1), (4, 104, 0), (6, 100, 0), (8, 116, 0), (10, 84, 1), (11, 96, 0),
                         (12, 108, 0), (14, 102, 1), (15, 94, 1)):
            (taiko_hi if hi else taiko).note(bar + s * S16, 1.0, 45 if hi else (36 if v > 100 else 41), v)
        for s in (4, 12):
            okit.note(bar + s * S16, 0.4, 38, 96)
        cbd.note(bar + 1.0, 1.5, 38, 100)
        if bar < 76:
            S.put('perc', reverse_cymbal(1.2, seed=bar), bar + 2.0 - 1.2, -23, send=0.3)
    # after the last landmark: sucked-out release into the 78 breakdown
    rb2 = braam_synth([P('A1'), P('A2'), P('E3'), P('A3')], 1.4, seed=77, open_hz=2400, sub=False)[::-1]
    rb2 *= (np.linspace(0, 1, len(rb2)) ** 3)[:, None]
    S.put('fx', fade(rb2, 0.05, 0.006), 78.0 - len(rb2) / SR, -20, send=0.1)

    # ============================================================ NIGHT 78-86
    # breakdown: heartbeat sub pulse + high string harmonics + piano motif
    for t in np.arange(78.0, 85.0, 1.0):
        lvl = -15 if t < 82 else -15 - (t - 82) * 2.5
        S.put('sub', heartbeat(), float(t), lvl, group='night', send=0.0)
    harm.chord(78.0, 7.95, [P('D6'), P('A6')], 100, exact=True)
    harm.note(80.0, 5.95, P('E6'), 100)
    dyn(harm, [(78.0, 0), (79.2, 36), (82.0, 44), (85.9, 64), (86.0, 0)])
    S.put('synth', fade(shimmer([midi_hz(P(x)) for x in ('A6', 'D7', 'E7')], 8.0, trem=0.25, seed=78, attack=2.0), 0.01, 1.5),
          78.0, -40, group='night', send=0.6)
    pno_n.pedal(77.99)
    pno_n.note(78.0, 3.9, P('D2'), 46, exact=True)
    for t, m, v in ((78.5, 'D5', 52), (79.5, 'A5', 46), (80.5, 'F5', 50), (81.5, 'E5', 45)):
        pno_n.note(t, 2.0 if t < 81 else 2.5, P(m), v, exact=True)
    pno_n.pedal(81.98, False)
    pno_n.pedal(82.02)
    pno_n.chord(82.0, 1.9, [P('G2'), P('D4'), P('Bb4')], 42)
    pno_n.chord(84.0, 1.9, [P('A2'), P('C#4'), P('E4')], 48)
    pno_n.pedal(85.95, False)
    # 82-86: drums re-enter, building (snare roll crescendo) into 86
    for t, v in ((82.0, 92), (83.0, 98), (84.0, 104), (84.5, 100), (85.0, 110), (85.25, 104), (85.5, 116),
                 (85.625, 110), (85.75, 122), (85.875, 126)):
        taiko.note(t, 0.9, 36 if v > 108 else 41, v)
    for t in (82.0, 84.0):
        cbd.note(t, 1.5, 38, 96)
    roll(okit, 84.0, 85.97, 38, 16, 126, 0.0625, drum=True)
    roll(timp, 84.5, 85.97, P('A1'), 30, 124, 0.0625)
    ostinato(vc_f, 82.0, 86.0, 'G2', 104, 62, cresc=(0.6, 1.2))
    ostinato(cb_f, 84.0, 86.0, 'G1', 104, 70, eighths=True, cresc=(0.7, 1.2))
    trem.chord(82.0, 2.0, [P('G4'), P('Bb4'), P('D5')], 100)
    trem.chord(84.0, 1.97, [P('A4'), P('C#5'), P('E5'), P('A5')], 100)
    dyn(trem, [(81.95, 10), (83.9, 50), (85.96, 124)])
    hn.chord(84.0, 1.96, [P('A3'), P('C#4'), P('E4'), P('A4')], 100)
    tbn.chord(84.0, 1.96, [P('A2'), P('E3'), P('A3')], 100)
    tuba.note(84.0, 1.96, P('A1'), 100)
    for p in (hn, tbn, tuba):
        dyn(p, [(83.9, 16), (85.96, 127)])
    aah.chord(84.0, 1.96, [P('A3'), P('E4'), P('A4'), P('C#5')], 100)
    dyn(aah, [(83.8, 20), (85.96, 122)])
    pulses(84.0, 86.0, gain_db=-19, cresc=(0.4, 1.2))
    riser(86.0, 3.0, -13, rev_db=-14)
    rb3 = braam_synth([P('D2'), P('A2'), P('D3'), P('F3')], 2.0, seed=85, open_hz=3000, sub=False)
    rb3 = convolve_stereo(np.pad(rb3, ((0, n_(2.0)), (0, 0))), make_ir(2.5, seed=86), 0.3)[::-1][-n_(1.2):]
    rb3 = rb3 / (np.abs(rb3).max() + 1e-9) * (np.linspace(0, 1, n_(1.2)) ** 2.5)[:, None]
    S.put('fx', fade(rb3, 0.05, 0.006), 86.0 - 1.2 - 0.03, -15, send=0.0)

    # =========================================================== CLIMAX 86-94
    S.put('fx', braam_synth([P('D1'), P('D2'), P('A2'), P('D3'), P('F3'), P('A3')], 2.2, seed=860,
                            open_hz=4000, rest_hz=500), 86.0, -9, send=0.35)
    S.put('sub', sub_boom(2.5, 130, 31, 0.35, 0.8, 0.35), 86.0, -11, send=0.0)
    hit(86.0, 1.6, 'Dm', stab_notes=[P('D2'), P('A2'), P('D3'), P('F3'), P('A3'), P('D4')])
    theme_c = [(86.0, 1.5, 'D5'), (87.5, 0.5, 'A5'), (88.0, 1.0, 'F5'), (89.0, 1.0, 'E5'),
               (90.0, 0.5, 'D5'), (90.5, 0.5, 'E5'), (91.0, 0.5, 'F5'), (91.5, 0.5, 'G5'),
               (92.0, 0.5, 'A5'), (92.5, 0.5, 'C#6'), (93.0, 0.99, 'D6')]
    for t, d, m in theme_c:
        ex = (t == int(t)) or t >= 90
        tpt.note(t, d * 0.97, P(m), 100, exact=ex)
        hn.note(t, d * 0.97, P(m) - 12, 100, exact=ex)
        tbn.note(t, d * 0.97, P(m) - 24, 100, exact=ex)
        vln1.note(t, d * 0.99, P(m) + 12 if t < 93 else P(m), 100, exact=ex)
        vln2.note(t, d * 0.99, P(m), 100, exact=ex)
    dyn(tpt, [(85.99, 118), (93.97, 124), (94.0, 0)])
    dyn(hn, [(85.99, 124), (93.97, 127)])
    dyn(tbn, [(85.99, 120), (93.97, 127)])
    dyn(vln1, [(85.86, 112), (93.97, 124)])
    dyn(vln2, [(85.86, 104), (93.97, 118)])
    for t0, t1 in ((86, 88), (88, 89), (89, 90), (90, 91), (91, 92), (92, 93)):
        ch = chord_at(t0)
        tuba.note(t0, (t1 - t0) * 0.97, bass(ch, 'G1'), 100, exact=True)
        bsec.chord(t0, (t1 - t0) * 0.97, voicing(ch, 'F3', 'D4'), 112)
        vla.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'A4')[:3], 100)
        cb.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1'), 100)
        vc.note(t0, (t1 - t0) * 0.99, bass(ch, 'G1') + 12, 100)
        aah.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'C5'), 100)
        warm.chord(t0, (t1 - t0) * 0.99, voicing(ch, 'A3', 'A4'), 90)
    for t, d, m in theme_c[:-1]:
        aah.note(t, d * 0.99, P(m), 100, exact=True)       # choir sings the theme too
    dyn(tuba, [(85.99, 118), (93.97, 127)])
    for p in (vla, cb, vc):
        dyn(p, [(85.9, 116), (93.97, 127)])
    dyn(aah, [(85.8, 112), (93.97, 127)])
    dyn(warm, [(85.8, 70), (93.9, 90)])
    ostinato(vc_f, 86.0, 93.0, 'G2', 127, 90)
    ostinato(cb_f, 86.0, 93.0, 'G1', 127, 92, eighths=True)
    ostinato(vla_f, 86.0, 93.0, 'G3', 116, 78)
    ostinato(vln_f, 86.0, 93.0, 'D4', 112, 78,
             pattern=[12, 0, 7, 12, 0, 7, 12, 7, 12, 0, 7, 12, 0, 7, 12, 7])
    for t in np.arange(86.0, 92.0, S16):
        s = int(round((t % BAR) / S16))
        if s % 4 in (1, 3):
            okit.note(float(t), 0.1, 38, 58 + 6 * (s % 8 == 3))
    pulses(86.0, 93.0, gain_db=-16)
    # 8th-note taiko (tempo feel doubles) + snare + crashes
    for t in np.arange(86.0, 90.0, 0.25):
        s = int(round((t % BAR) / S16))
        if t in (86.0, 88.0):
            continue
        taiko.note(float(t), 0.9, 36 if s % 4 == 0 else 41, 122 if s % 4 == 0 else 104)
        if s % 4 == 2:
            taiko_hi.note(float(t) + S16, 0.7, 45, 92)
    for t in (86.5, 87.5, 88.5, 89.5):
        okit.note(t, 0.3, 38, 110)
    hit(88.0, 1.1, 'Bb')
    for t in np.arange(86.25, 90.0, 0.25):                       # timpani 8ths drive
        if abs(t - 88.0) > 1e-6:
            timp.note(float(t), 0.2, P('D2') if int(round(t / 0.25)) % 2 else P('A1'), 96 + 12 * (t % 1.0 == 0))
    # 90-93: a hit on every beat (picture cuts on every beat)
    for i, t in enumerate(np.arange(90.0, 93.0, 0.5)):
        ch = chord_at(float(t))
        hit(float(t), 0.7 + 0.1 * i, ch, cym=(i in (0, 4)), ohit_on=(i % 2 == 0))
    roll(okit, 92.0, 92.97, 38, 60, 127, 0.05, drum=True)
    S.put('perc', reverse_cymbal(1.5, seed=93), 93.0 - 1.5, -16, send=0.3)
    # 93.0 FINAL BRAAM + choir (D, Picardy major on top) -> hard stop 94.0
    fb = [P('D1'), P('D2'), P('A2'), P('D3'), P('A3')]
    S.put('fx', fade(braam_synth(fb, 1.2, seed=93, open_hz=4200, rest_hz=900), 0.0, 0.03)[:n_(1.0)], 93.0, -6, send=0.4)
    S.put('sub', fade(sub_boom(1.2, 120, 31, 0.3, 0.8, 0.35)[:n_(1.0)], 0, 0.03), 93.0, -11, send=0.0)
    hit(93.0, 1.8, 'D', stab_notes=[P('D2'), P('A2'), P('D3'), P('F#3'), P('A3'), P('D4')])
    bsec.chord(93.0, 0.99, [P('D2'), P('A2'), P('D3'), P('F#3'), P('A3')], 127, exact=True)
    aah.chord(93.0, 0.99, [P('D4'), P('F#4'), P('A4'), P('D5'), P('F#5')], 100, exact=True)
    ooh.cc(92.9, 2, 120)
    ooh.chord(93.0, 0.99, [P('D4'), P('A4'), P('D5'), P('F#5')], 100, exact=True)
    tuba.note(93.0, 0.99, P('D1') + 12, 100, exact=True)
    cb.note(93.0, 0.99, P('D2'), 100, exact=True)
    vc.note(93.0, 0.99, P('D3'), 100, exact=True)
    vla.chord(93.0, 0.99, [P('F#4'), P('A4')], 100, exact=True)

    # ===================================================== TITLE 94.5-104
    t0 = 94.5
    S.put('sub', sub_boom(5.0, 95, 29, 0.5, 1.15, 0.35, sat=2.0), t0, -9, group='title', send=0.0)
    S.put('impacts', impact(1.5, 110, 34, seed=945, body_tau=0.3, crack=0.25, thump=0.8), t0, -5,
          group='title', send=0.35)
    S.put('fx', gong(36.7, 9.0, seed=945), t0, -15, group='title', send=0.5)
    S.put('impacts', snap(0.12, 945), t0, -17, group='title', send=0.5)
    cbd_t.note(t0, 3.0, 38, 118, exact=True)
    pno_t.pedal(94.4)
    pno_t.note(t0, 8.0, P('D1'), 96, exact=True)
    pno_t.note(t0, 8.0, P('D2'), 84, exact=True)
    pno_t.note(99.0, 4.8, P('D5'), 60, exact=True)          # soft final piano note
    pno_t.note(99.0, 4.8, P('D4'), 34, exact=True)
    pno_t.pedal(103.9, False)
    chord_hi = [P('D5'), P('A5'), P('E6'), P('F#6')]
    for i, m in enumerate(chord_hi):
        S.put('keys', bell(midi_hz(m), 8.0, seed=946 + i), t0 + 0.02 * i, -24 - 2 * i, group='title',
              pan=[-0.4, 0.3, -0.15, 0.45][i], send=0.6)
    cel_t.chord(t0, 6.0, chord_hi, 76, exact=True)
    glk_t.chord(t0 + 0.04, 5.0, [P('D6'), P('A6')], 70, exact=True)
    S.put('synth', fade(shimmer([midi_hz(P(x)) for x in ('D6', 'F#6', 'A6', 'E7', 'A7')], 8.8, seed=947, attack=1.2), 0.01, 4.5),
          t0, -30, group='title', send=0.7)
    ooh_t.cc(0, 2, 0)
    ooh_t.chord(t0, 8.9, [P('D4'), P('A4'), P('E5'), P('F#5')], 100, exact=True)
    dyn(ooh_t, [(t0, 30), (96.0, 86), (98.5, 64), (101.5, 26), (103.2, 0)])
    vln_t.cc(0, 2, 0)
    vln_t.chord(t0, 8.9, [P('D6'), P('A6')], 100, exact=True)
    dyn(vln_t, [(t0, 0), (96.5, 50), (98.5, 36), (102.5, 0)])
    halo_t.cc(0, 2, 0)
    halo_t.chord(t0, 8.9, [P('D4'), P('A4'), P('E5')], 80, exact=True)
    dyn(halo_t, [(t0, 30), (96.0, 64), (98.5, 46), (101.5, 22), (103.2, 0)])
    return S


# ---------------------------------------------------------------- mixing
STEM_FX = {
    'strings': pb.Pedalboard([pb.HighpassFilter(32), pb.PeakFilter(260, -2.0, 0.9),
                              pb.PeakFilter(3200, 1.5, 0.8), pb.HighShelfFilter(8000, 2.5, 0.7),
                              pb.Compressor(-20, 2.0, 25, 180)]),
    'brass': pb.Pedalboard([pb.HighpassFilter(38), pb.PeakFilter(320, -1.5, 1.0),
                            pb.PeakFilter(1800, 2.5, 0.9), pb.HighShelfFilter(9000, 1.0, 0.7),
                            pb.Compressor(-18, 2.5, 18, 140)]),
    'choir': pb.Pedalboard([pb.HighpassFilter(110), pb.PeakFilter(400, -2.0, 1.0),
                            pb.PeakFilter(3000, 1.5, 0.8), pb.HighShelfFilter(9500, 3.0, 0.7),
                            pb.Compressor(-20, 2.0, 30, 200)]),
    'keys': pb.Pedalboard([pb.HighpassFilter(36), pb.HighShelfFilter(9000, 1.5, 0.7)]),
    'perc': pb.Pedalboard([pb.HighpassFilter(28), pb.PeakFilter(90, 2.0, 0.9), pb.PeakFilter(450, -2.5, 1.0),
                           pb.Compressor(-16, 3.0, 6, 110)]),
    'synth': pb.Pedalboard([pb.HighpassFilter(34), pb.Compressor(-20, 2.0, 15, 150)]),
    'fx': pb.Pedalboard([pb.HighpassFilter(26), pb.Compressor(-14, 2.0, 5, 150)]),
    'impacts': pb.Pedalboard([pb.HighpassFilter(28), pb.PeakFilter(3500, 1.5, 0.8)]),
    'sub': pb.Pedalboard([pb.HighpassFilter(22), pb.LowpassFilter(180)]),
}
STEM_GAIN = {'strings': 0.0, 'brass': 0.0, 'choir': 0.0, 'keys': 0.0, 'perc': 0.0, 'synth': 0.0,
             'fx': 0.0, 'sub': 0.0, 'impacts': 0.0}
WET_GAIN = {'strings': 0.9, 'brass': 0.9, 'choir': 1.0, 'keys': 1.0, 'perc': 0.8, 'synth': 1.0,
            'fx': 0.9, 'sub': 0.0, 'impacts': 0.8}


def choke_env(group):
    """Reverb-return choke for the loud 'main' group at the hard cuts
    (78.0 breakdown, 94.0 stop): exponential decay, re-opening at 81.9."""
    e = np.ones(N)
    if group != 'main':
        return e
    for tc, tau, reopen in ((78.0, 0.3, 81.9), (94.0, 0.08, None)):
        i0 = n_(tc)
        i1 = N if reopen is None else n_(reopen)
        tt = np.arange(i1 - i0) / SR
        e[i0:i1] = np.exp(-tt / tau)
        if reopen is not None:
            r = n_(0.05)
            e[i1:i1 + r] = np.linspace(e[i1 - 1], 1.0, r)
    return e


def mix(S):
    """Render/sum each (stem, group) bus in turn: parts (fluidsynth) and
    queued synth layers -> stem processing chain + reverb return (choked
    for the 'main' group at the hard cuts) -> fader ride."""
    t0 = time.time()
    hall = make_ir(4.4, (3.3, 2.9, 2.5, 1.7, 1.0), 0.03, seed=101)
    room = make_ir(1.6, (1.2, 1.05, 0.9, 0.6, 0.4), 0.008, seed=102, er_span=0.03)
    stems = {s: np.zeros((N, 2), np.float32) for s in Score.STEM_NAMES}
    g_main = gate_env(MAIN_GATES).astype(np.float32)[:, None]
    buses = sorted(set((d['stem'], d['group']) for d in S.parts.values()) | set(S.events))
    sc_cache = {}
    for stem, group in buses:
        dry = np.zeros((N, 2), np.float32)
        snd = np.zeros((N, 2), np.float32)
        for name, d in S.parts.items():
            if (d['stem'], d['group']) != (stem, group):
                continue
            if not any(e[1] == 'on' for e in d['part'].ev):
                continue
            x = render(d['part'], N, CACHE)
            if d['pan']:
                x = balance(x, d['pan'])
            env = np.full(N, db(d['gain']), np.float32)
            if d['gates']:
                env *= gate_env(d['gates']).astype(np.float32)
            if d.get('duck'):
                if d['duck'] not in sc_cache:
                    sc_cache[d['duck']] = sidechain(d['duck']).astype(np.float32)
                env *= sc_cache[d['duck']]
            x *= env[:, None]
            dry += x
            snd += x * np.float32(d['send'])
            del x, env
        if (stem, group) in S.events:
            ed = np.zeros((N, 2), np.float32)
            es = np.zeros((N, 2), np.float32)
            for t, x, send in S.events[(stem, group)]:
                add_at(ed, x, t)
                if send:
                    add_at(es, x, t, send)
            if group == 'main':
                ed *= g_main
                es *= g_main
            dry += ed
            snd += es
            del ed, es
        proc = STEM_FX[stem](dry.T.copy(), SR, reset=True).T
        del dry
        out = proc * np.float32(db(STEM_GAIN[stem]))
        if WET_GAIN[stem] > 0 and np.abs(snd).max() > 0:
            ir = room if stem == 'perc' else hall
            nz = np.where(np.abs(snd).max(1) > 1e-7)[0]
            a, b = nz[0], min(N, nz[-1] + len(hall))
            seg = snd[a:b].astype(float)
            wet = convolve_stereo(seg, ir, 0.3) * WET_GAIN[stem]
            if stem == 'perc':
                wet += 0.5 * convolve_stereo(seg, hall, 0.3)
            wet = pb.Pedalboard([pb.HighpassFilter(140), pb.LowShelfFilter(300, -2.0, 0.7)])(
                wet.T.astype(np.float32), SR).T
            wet *= choke_env(group)[a:b, None].astype(np.float32)
            out[a:b] += wet * np.float32(db(STEM_GAIN[stem]))
            del wet, seg
        stems[stem] += out
        del snd, out, proc
    ride = mix_ride().astype(np.float32)[:, None]
    for s in stems:
        stems[s] *= ride
    print(f'  rendered + mixed in {time.time() - t0:.1f}s', flush=True)
    return stems


# arrangement 'fader ride' (dB) applied to every stem: hierarchy between
# sections (hero body under the braam, landmarks under the climax)
RIDE = [(0, 2), (7.9, 2), (8.0, 0), (8.5, 0), (9.6, -4), (11.9, -3.5), (12.0, -2), (14.0, -2), (15.9, 0),
        (67.9, 0), (68.0, -1.5), (77.9, -1.5), (78.0, 0), (85.9, 0), (86.0, 1.5), (94.0, 1.5),
        (94.3, 0), (104, 0)]
# 'vacuum' before the big hits: -6 dB for the last ~60 ms before impact
DUCK = [16, 20, 24, 28, 50, 58, 60, 64, 68, 70, 72, 74, 76, 86, 93]
SC_HITS = [12, 16, 20, 24, 28, 50, 52, 54, 56, 58, 60, 64, 68, 70, 72, 74, 76, 88,
           90, 90.5, 91, 91.5, 92, 92.5]   # not the braams (8, 86, 93): there the bed IS the hit


def sidechain(depth_db, rel=0.22):
    """Post-hit 'pump' for the sustained bed: -depth dB at each hit,
    recovering exponentially (rel s) so the impact transients read."""
    g = np.zeros(N)
    tt = np.arange(n_(1.2)) / SR
    shape = -depth_db * np.exp(-tt / rel) * np.minimum(1, tt / 0.003 + 0.0)
    for T in SC_HITS:
        a = n_(T)
        b = min(N, a + len(shape))
        g[a:b] = np.minimum(g[a:b], shape[:b - a])
    return db(g)


def mix_ride():
    tt = np.arange(N) / SR
    xs, ys = zip(*RIDE)
    g = np.interp(tt, xs, ys)
    for T in DUCK:
        a, b = n_(T - 0.075), n_(T)
        f = n_(0.02)
        k = n_(0.002)
        d = np.zeros(N)
        d[a + f:b - k] = -6.0
        d[a:a + f] = np.linspace(0, -6.0, f)
        d[b - k:b] = np.linspace(-6.0, 0, k)
        g += d
    return db(g)


def master(mixbus):
    """Master: HPF, tonal EQ, glue comp, loudness-targeted TP limiter."""
    import pyloudnorm as pyln
    eq = pb.Pedalboard([pb.HighpassFilter(24), pb.HighpassFilter(24), pb.LowShelfFilter(60, 1.0, 0.7),
                        pb.PeakFilter(300, -1.2, 0.8), pb.HighShelfFilter(10000, 1.0, 0.7)])
    x = eq(mixbus.T.astype(np.float32), SR).T.astype(float)
    glue = pb.Pedalboard([pb.Compressor(-12, 1.8, 30, 220)])
    meter = pyln.Meter(SR)
    pre = 0.0
    for it in range(4):
        y = x * db(pre)
        y = glue(y.T.astype(np.float32), SR, reset=True).T.astype(float)
        y, g = tp_limiter(y, CEILING_DBTP - 0.15, 0.003, 0.15)
        # final gentle tail: everything silent by 104.0
        L = meter.integrated_loudness(y)
        print(f'  master pass {it}: pre {pre:+.2f} dB -> {L:.2f} LUFS, max GR {20 * np.log10(g.min()):.1f} dB')
        if abs(L - TARGET_LUFS) < 0.15:
            break
        pre += (TARGET_LUFS - L) * (1.0 if it < 2 else 0.9)
    tail = np.ones(N)
    i0 = n_(DUR - 0.6)
    tail[i0:] = np.cos(np.linspace(0, np.pi / 2, N - i0)) ** 2
    y *= tail[:, None]
    return y, pre


def main():
    verify = '--no-verify' not in sys.argv
    os.makedirs(STEMS, exist_ok=True)
    t0 = time.time()
    print('composing...', flush=True)
    S = compose()
    print('rendering + mixing...', flush=True)
    stems = mix(S)
    mixbus = np.zeros((N, 2))
    for x in stems.values():
        mixbus += x
    for s, x in stems.items():
        sf.write(os.path.join(STEMS, f'{s}.wav'), x.astype(np.float32), SR, subtype='PCM_24')
    print('mastering...', flush=True)
    y, pre = master(mixbus)
    # master-bus gain applied to stems is informational (they are pre-master)
    assert len(y) == N
    sf.write(os.path.join(OUT, 'score.wav'), y.astype(np.float32), SR, subtype='PCM_24')
    sf.write(os.path.join(OUT, 'premaster.wav'), mixbus.astype(np.float32), SR, subtype='FLOAT')
    print(f'wrote {OUT}/score.wav ({len(y) / SR:.3f} s) in {time.time() - t0:.0f}s; pre-gain {pre:+.2f} dB')
    if verify:
        import verify as V
        V.run()


if __name__ == '__main__':
    main()

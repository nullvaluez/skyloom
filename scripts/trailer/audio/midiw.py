"""Tiny MIDI part model + fluidsynth renderer (cached) for the trailer score.

A Part is one instrument on one channel with a (bank, program) preset from
MuseScore_General_Full.sf3.  Notes/CCs are placed in SECONDS on the
120 BPM grid (1 beat = 0.5 s = 960 ticks), written with mido, and rendered
to a float WAV at 48 kHz by the fluidsynth CLI with its own reverb/chorus
OFF (all space is added in the mix).  Renders are cached by MIDI hash.
"""
import hashlib
import os
import subprocess

import mido
import numpy as np
import soundfile as sf

SF3 = '/usr/share/sounds/sf3/MuseScore_General_Full.sf3'
TPB = 960
SPB = 0.5            # seconds per beat (120 BPM)
SR = 48000
EXACT_TIMES = set()   # cue-hit times (s): notes starting here are never humanized/led


class Part:
    def __init__(self, name, bank, prog, drum=False, expr_cc=None, rng=None, lead=0.0,
                 hum_t=0.006, hum_v=5):
        """expr_cc: 2 for MuseScore 'Expr.' presets (breath-controlled
        dynamics), 11 for plain presets.  lead: seconds to anticipate every
        non-exact note (compensates slow sample attacks)."""
        self.name, self.bank, self.prog, self.drum = name, bank, prog, drum
        self.ch = 9 if drum else 0
        self.ev = []
        self.expr_cc = expr_cc
        self.rng = rng or np.random.default_rng(abs(hash(name)) % (2 ** 32))
        self.lead = lead
        self.hum_t, self.hum_v = hum_t, hum_v
        if expr_cc == 2:
            self.cc(0.0, 2, 100)
            self.cc(0.0, 11, 127)
        elif expr_cc == 11:
            self.cc(0.0, 11, 110)
        self.cc(0.0, 7, 127)

    # ---- events
    def note(self, t, dur, pitch, vel, exact=False):
        if any(abs(t - h) < 0.002 for h in EXACT_TIMES):
            exact = True     # nothing may anticipate or smear a cue hit
        if not exact:
            t = t - self.lead + self.rng.uniform(-self.hum_t, self.hum_t)
            vel = int(np.clip(vel + self.rng.integers(-self.hum_v, self.hum_v + 1), 1, 127))
        t = max(0.0, t)
        self.ev.append((t, 'on', int(pitch), int(np.clip(vel, 1, 127))))
        self.ev.append((t + max(dur, 0.02), 'off', int(pitch), 0))
        return self

    def chord(self, t, dur, pitches, vel, exact=False, spread=0.0):
        for i, p in enumerate(pitches):
            self.note(t + i * spread, dur, p, vel, exact)
        return self

    def cc(self, t, num, val):
        self.ev.append((max(0.0, t), 'cc', int(num), int(np.clip(round(val), 0, 127))))
        return self

    def ramp(self, t0, t1, v0, v1, num=None, curve=1.0, step=0.03):
        """CC ramp (default: the part's expression CC)."""
        num = num or self.expr_cc or 11
        n = max(2, int((t1 - t0) / step))
        for i in range(n + 1):
            x = i / n
            self.cc(t0 + (t1 - t0) * x, num, v0 + (v1 - v0) * (x ** curve))
        return self

    def nrpn_gen(self, t, gen, offset):
        """fluidsynth NRPN (MSB 120) SoundFont-generator offset, e.g. gen 38
        = releaseVolEnv in timecents (NRPN scale 2): -1200 halves the release."""
        v = int(np.clip(8192 + offset / 2, 0, 16383))
        self.cc(t, 99, 120)
        self.cc(t, 98, gen)
        self.cc(t, 6, (v >> 7) & 127)
        self.cc(t, 38, v & 127)
        return self

    def pedal(self, t, on=True):
        return self.cc(t, 64, 127 if on else 0)

    def pitchbend(self, t, val):
        self.ev.append((max(0.0, t), 'pb', int(val), 0))
        return self

    # ---- output
    def _fixed_events(self):
        """Resolve same-pitch overlaps: a note-off that would land after the
        next note-on of the same key (lead/humanize offsets) would kill the
        new note in fluidsynth, so it is moved 1 ms before that note-on."""
        ons = {}
        notes = []
        pend = {}
        evs = sorted(self.ev, key=lambda e: e[0])
        # pair ons/offs in insertion order per pitch
        on_list = [(t, a, b) for (t, k, a, b) in self.ev if k == 'on']
        off_list = [(t, a) for (t, k, a, b) in self.ev if k == 'off']
        for (t_on, p, v), (t_off, p2) in zip(on_list, off_list):
            notes.append([t_on, t_off, p, v])
        by_p = {}
        for nt in notes:
            by_p.setdefault(nt[2], []).append(nt)
        keep = []
        for p, lst in by_p.items():
            lst.sort(key=lambda z: z[0])
            merged = [lst[0]]
            for b in lst[1:]:
                a = merged[-1]
                if b[0] - a[0] < 0.012:            # (near-)simultaneous duplicate: merge
                    a[1] = max(a[1], b[1])
                    a[3] = max(a[3], b[3])
                    continue
                merged.append(b)
            for a, b in zip(merged[:-1], merged[1:]):
                if a[1] > b[0] - 0.001:
                    a[1] = max(a[0] + 0.01, b[0] - 0.001)
            keep += merged
        out = [e for e in self.ev if e[1] not in ('on', 'off')]
        for t_on, t_off, p, v in keep:
            out.append((t_on, 'on', p, v))
            out.append((t_off, 'off', p, 0))
        return out

    def midi_bytes(self):
        mid = mido.MidiFile(ticks_per_beat=TPB)
        tr = mido.MidiTrack()
        mid.tracks.append(tr)
        tr.append(mido.MetaMessage('set_tempo', tempo=500000, time=0))
        ev = []
        if not self.drum:
            ev.append((0, 0, mido.Message('control_change', channel=self.ch, control=0, value=self.bank)))
            ev.append((0, 1, mido.Message('control_change', channel=self.ch, control=32, value=0)))
        ev.append((0, 2, mido.Message('program_change', channel=self.ch, program=self.prog)))
        for (t, kind, a, b) in self._fixed_events():
            tick = int(round(t / SPB * TPB))
            if kind == 'on':
                ev.append((tick, 6, mido.Message('note_on', channel=self.ch, note=a, velocity=b)))
            elif kind == 'off':
                ev.append((tick, 4, mido.Message('note_off', channel=self.ch, note=a, velocity=0)))
            elif kind == 'cc':
                ev.append((tick, 5, mido.Message('control_change', channel=self.ch, control=a, value=b)))
            elif kind == 'pb':
                ev.append((tick, 5, mido.Message('pitchwheel', channel=self.ch, pitch=a)))
        ev.sort(key=lambda e: (e[0], e[1]))
        last = 0
        for tick, _, m in ev:
            tr.append(m.copy(time=tick - last))
            last = tick
        tr.append(mido.MetaMessage('end_of_track', time=TPB * 8))
        import io
        bio = io.BytesIO()
        mid.save(file=bio)
        return bio.getvalue()


def render(part, n_samples, cache_dir, gain=0.5):
    """Render a Part to a stereo float array of exactly n_samples."""
    os.makedirs(cache_dir, exist_ok=True)
    data = part.midi_bytes()
    h = hashlib.sha1(data + f'{gain}{SF3}'.encode()).hexdigest()[:16]
    wav = os.path.join(cache_dir, f'{part.name}_{h}.wav')
    if not os.path.exists(wav):
        midp = wav[:-4] + '.mid'
        with open(midp, 'wb') as f:
            f.write(data)
        subprocess.run(['nice', '-n', '15', 'fluidsynth', '-ni', '-q', '-R', '0', '-C', '0',
                        '-r', str(SR), '-g', str(gain), '-o', 'audio.file.format=float',
                        '-o', 'synth.polyphony=1024', '-o', 'synth.cpu-cores=1',
                        '-o', 'synth.dynamic-sample-loading=1',
                        '-F', wav, SF3, midp], check=True, capture_output=True)
    x, sr = sf.read(wav, dtype='float32', always_2d=True)
    assert sr == SR
    out = np.zeros((n_samples, 2), np.float32)
    m = min(n_samples, len(x))
    out[:m] = x[:m]
    return out

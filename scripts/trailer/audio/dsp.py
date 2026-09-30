"""DSP + synthesis toolkit for the Skyloom trailer score.

Everything here is deterministic (seeded) numpy/scipy/pedalboard code:
band-limited oscillators, time-varying filters, envelopes, the trailer
sound-design voices (braam, sub boom, risers, reverse cymbal, heartbeat,
pulses, ticks, shimmer, bells), a synthetic hall/room impulse-response
generator, and a true-peak look-ahead limiter.  score.py composes with it.
"""
import numpy as np
from scipy import signal
import pedalboard as pb

SR = 48000


# ----------------------------------------------------------------- basics
def n_(t):
    return int(round(t * SR))


def db(x):
    return 10 ** (x / 20.0)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def stereo(x, pan=0.0, width=0.0):
    """mono -> stereo with constant-power pan (-1..1)."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1) * np.sqrt(2)


def add_at(buf, x, t, gain=1.0):
    """Mix x (mono or stereo) into stereo buf starting at time t (s)."""
    i0 = n_(t)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    j0 = 0
    if i0 < 0:
        j0 = -i0
        i0 = 0
    i1 = min(len(buf), i0 + len(x) - j0)
    if i1 <= i0:
        return
    buf[i0:i1] += gain * x[j0:j0 + (i1 - i0)]


def fade(x, fin=0.005, fout=0.005):
    x = x.copy()
    a, b = n_(fin), n_(fout)
    if a > 0:
        r = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
        x[:a] *= r if x.ndim == 1 else r[:, None]
    if b > 0:
        r = np.cos(np.linspace(0, np.pi / 2, b)) ** 2
        x[-b:] *= r if x.ndim == 1 else r[:, None]
    return x


def env_adsr(n, a, d, s, r, sustain_len=None):
    """Sample-length ADSR (times in s).  Curved (exp-ish) segments."""
    A, D, R = n_(a), n_(d), n_(r)
    S = n - A - D - R if sustain_len is None else n_(sustain_len)
    S = max(S, 0)
    e = np.concatenate([
        np.sin(np.linspace(0, np.pi / 2, max(A, 1))) ** 2,
        s + (1 - s) * np.exp(-np.linspace(0, 5, max(D, 1))),
        np.full(S, s),
        s * np.exp(-np.linspace(0, 7, max(R, 1))),
    ])
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e[:n]


def exp_decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


# ------------------------------------------------------------ oscillators
def _polyblep(t, dt):
    y = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m] if np.ndim(dt) else t[m] / dt
    y[m] = x + x - x * x - 1.0
    m2 = t > 1.0 - (dt if np.ndim(dt) == 0 else dt)
    if np.ndim(dt):
        x = (t[m2] - 1.0) / dt[m2]
    else:
        x = (t[m2] - 1.0) / dt
    y[m2] = x * x + x + x + 1.0
    return y


def saw(freq, n, phase0=0.0):
    """Band-limited (polyBLEP) saw; freq scalar or per-sample array."""
    f = np.broadcast_to(np.asarray(freq, float), (n,)).copy()
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    return 2.0 * ph - 1.0 - _polyblep(ph, dt)


def square(freq, n, phase0=0.0, pw=0.5):
    a = saw(freq, n, phase0)
    b = saw(freq, n, (phase0 + pw) % 1.0)
    return 0.5 * (a - b)


def sine(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    return np.sin(2 * np.pi * (phase0 + np.cumsum(f) / SR))


def supersaw(freq, n, voices=7, detune_cents=14.0, rng=None, stereo_out=True):
    rng = rng or np.random.default_rng(1)
    L = np.zeros(n)
    R = np.zeros(n)
    for k in range(voices):
        c = (k - (voices - 1) / 2) / ((voices - 1) / 2 + 1e-9) * detune_cents
        f = np.asarray(freq) * 2 ** (c / 1200)
        v = saw(f, n, rng.random())
        p = (k / (voices - 1)) * 2 - 1 if voices > 1 else 0
        L += v * (1 - p) * 0.5
        R += v * (1 + p) * 0.5
    g = 1.0 / np.sqrt(voices)
    return np.stack([L, R], 1) * g if stereo_out else (L + R) * g


def noise(n, seed=0, ch=1):
    r = np.random.default_rng(seed)
    return r.standard_normal((n, ch)) if ch > 1 else r.standard_normal(n)


# ---------------------------------------------------------------- filters
def sos_filter(x, kind, f, order=2, q=None):
    if kind == 'bp':
        sos = signal.butter(order, [f[0], f[1]], 'bandpass', fs=SR, output='sos')
    else:
        sos = signal.butter(order, f, kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def ladder_sweep(x, cutoff, resonance=0.2, drive=1.0, block=256):
    """Moog-ladder lowpass (pedalboard) with a per-sample cutoff curve.

    Processes in blocks with reset=False so the filter state carries over
    (pedalboard plugins are stateful), giving a click-free sweep."""
    x = np.asarray(x, np.float32)
    mono = x.ndim == 1
    X = x[None, :] if mono else x.T.copy()
    lf = pb.LadderFilter(mode=pb.LadderFilter.Mode.LPF24, cutoff_hz=float(cutoff[0]),
                         resonance=resonance, drive=drive)
    out = np.zeros_like(X)
    n = X.shape[1]
    for i in range(0, n, block):
        lf.cutoff_hz = float(np.clip(cutoff[min(i + block // 2, n - 1)], 20, 20000))
        out[:, i:i + block] = lf.process(X[:, i:i + block], SR, reset=False)
    return out[0] if mono else out.T


def tv_bandpass(x, fc, bw_oct=1.0, block=128):
    """Time-varying 2nd-order bandpass via block-switched biquads (zi carried)."""
    y = np.zeros_like(x)
    zi = np.zeros((1, 2)) if x.ndim == 1 else np.zeros((1, 2, x.shape[1]))
    for i in range(0, len(x), block):
        f = float(np.clip(fc[min(i + block // 2, len(x) - 1)], 30, SR * 0.45))
        lo, hi = f * 2 ** (-bw_oct / 2), min(f * 2 ** (bw_oct / 2), SR * 0.49)
        sos = signal.butter(1, [lo, hi], 'bandpass', fs=SR, output='sos')
        seg = x[i:i + block]
        if x.ndim == 1:
            y[i:i + block], zi = signal.sosfilt(sos, seg, zi=zi)
        else:
            y[i:i + block], zi = signal.sosfilt(sos, seg, axis=0, zi=zi)
    return y


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


# ----------------------------------------------------- sound-design voices
def sub_boom(dur=3.0, f0=110.0, f1=32.0, sweep=0.35, tau=0.9, click=0.35, seed=3, sat=1.6):
    """Trailer sub drop/boom: fast exponential pitch fall + long sine tail,
    a short noise click for definition, gentle saturation for small speakers."""
    n = n_(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / (sweep / 4.0))
    x = sine(f, n)
    amp = np.exp(-t / tau)
    amp *= np.minimum(1.0, t / 0.0015)          # 1.5 ms de-click attack
    x *= amp
    x = soft_clip(x * sat, 1.0) if sat else x
    c = noise(n_(0.05), seed)
    c = sos_filter(c, 'bp', (60, 2500), 2) * exp_decay(len(c), 0.008)
    x[:len(c)] += click * c / (np.abs(c).max() + 1e-9)
    return x


def heartbeat(level=1.0):
    """lub-dub: two pitched sine thumps (lub 0 s, dub 0.25 s)."""
    n = n_(0.7)
    out = np.zeros(n)
    for off, f0, f1, tau, g in ((0.0, 72, 42, 0.11, 1.0), (0.25, 80, 48, 0.08, 0.62)):
        m = n_(0.45)
        t = np.arange(m) / SR
        f = f1 + (f0 - f1) * np.exp(-t / 0.03)
        v = sine(f, m) * np.exp(-t / tau) * np.minimum(1, t / 0.004)
        v += 0.25 * sine(2 * f, m) * np.exp(-t / (tau * 0.5))
        out[n_(off):n_(off) + m] += g * v
    return soft_clip(out * 1.4, 1.0) * level


def shepard_riser(dur, base=55.0, octaves=7, rise_oct=1.0, seed=5, shape=2.2):
    """Endless-rise Shepard tone: `octaves` sine partials an octave apart,
    all gliding up `rise_oct` octaves over dur, Gaussian loudness over log-f.
    Amplitude swells with a power curve and ends at full level."""
    n = n_(dur)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    center = np.log2(base) + octaves / 2
    rng = np.random.default_rng(seed)
    for k in range(octaves):
        for det, pan in ((0.0, -0.5), (6.0, 0.5)):
            lf = np.log2(base) + k + rise_oct * (t / dur) ** 1.3
            lf = np.log2(base) + ((lf - np.log2(base)) % octaves)
            w = np.exp(-0.5 * ((lf - center) / (octaves / 5.0)) ** 2)
            f = 2 ** lf * 2 ** (det / 1200)
            # reset phase jumps when wrapping would click: the Gaussian weight
            # is ~0 at the wrap point, so the discontinuity is inaudible.
            v = sine(f, n, rng.random()) * w
            out[:, 0] += v * (1 - pan) * 0.5
            out[:, 1] += v * (1 + pan) * 0.5
    swell = (t / dur) ** shape
    out *= swell[:, None]
    return out / (np.abs(out).max() + 1e-9)


def noise_riser(dur, f_start=250, f_end=9000, seed=7, shape=2.5, bw=1.2):
    n = n_(dur)
    t = np.arange(n) / SR
    x = noise(n, seed, 2)
    fc = f_start * (f_end / f_start) ** ((t / dur) ** 1.4)
    y = tv_bandpass(x, fc, bw)
    y *= ((t / dur) ** shape)[:, None]
    return y / (np.abs(y).max() + 1e-9)


def cymbal(dur=4.0, seed=11, bright=1.0):
    """Synthetic crash/suspended cymbal: metallic partial cloud + HP noise."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = np.zeros((n, 2))
    nz = noise(n, seed, 2)
    nz = sos_filter(nz, 'highpass', 3200, 3) + 0.35 * sos_filter(nz, 'bp', (900, 3200), 2)
    x += nz * np.exp(-t / (1.3 * bright))[:, None]
    # inharmonic ring
    ring = np.zeros(n)
    for k in range(38):
        f = 420 * (1 + k * 0.618) ** 1.55 * (1 + 0.02 * rng.standard_normal())
        if f > 16000:
            continue
        ring += sine(f, n, rng.random()) * np.exp(-t / (0.6 + 1.2 * rng.random())) / (1 + k * 0.15)
    x += 0.08 * ring[:, None] * np.array([1.0, 0.92])
    x *= np.minimum(1, t / 0.002)[:, None]
    x = fade(x, 0.0, min(1.2, dur * 0.3))
    return x / (np.abs(x).max() + 1e-9)


def reverse_cymbal(dur=2.0, seed=13):
    """Cymbal swell that peaks exactly at the END of the buffer."""
    c = cymbal(dur + 0.3, seed)[:n_(dur)]
    r = c[::-1].copy()
    r = fade(r, 0.05, 0.004)
    return r / (np.abs(r).max() + 1e-9)


def ticks(times, level=1.0, seed=17, f=7000, dur=0.03, accents=None):
    """Clock-tick / closed-hat clicks (returns list of (t, stereo) events)."""
    evs = []
    rng = np.random.default_rng(seed)
    base = noise(n_(dur), seed)
    base = sos_filter(base, 'bp', (f * 0.6, min(f * 2.2, 20000)), 2)
    base *= exp_decay(len(base), dur / 6) * np.minimum(1, np.arange(len(base)) / (0.0006 * SR))
    base /= np.abs(base).max() + 1e-9
    for i, t in enumerate(times):
        a = accents[i] if accents is not None else 1.0
        pan = 0.35 * np.sin(i * 1.7)
        evs.append((t, stereo(base * a * level * (0.9 + 0.1 * rng.random()), pan)))
    return evs


def bell(freq, dur=6.0, seed=21, bright=1.0):
    """Additive tubular/celesta-ish bell (inharmonic partials)."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    parts = [(0.5, 0.35, 3.5), (1.0, 1.0, 2.6), (1.183, 0.45, 2.0), (1.506, 0.38, 1.6),
             (2.0, 0.5, 1.4), (2.514, 0.25, 1.0), (2.662, 0.2, 0.9), (3.011, 0.18, 0.8),
             (4.166, 0.12 * bright, 0.5), (5.43, 0.08 * bright, 0.35), (6.79, 0.05 * bright, 0.25)]
    x = np.zeros(n)
    for r, a, tau in parts:
        f = freq * r
        if f > 18000:
            continue
        x += a * sine(f * (1 + 0.0005 * rng.standard_normal()), n, rng.random()) * np.exp(-t / (tau * dur / 6))
    x *= np.minimum(1, t / 0.002)
    x = fade(x, 0.0, min(2.0, dur * 0.3))
    return x / (np.abs(x).max() + 1e-9)


def shimmer(freqs, dur, trem=7.0, seed=23, attack=1.5):
    """High sparkling pad: sines with fast independent tremolo + slow drift."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    out = np.zeros((n, 2))
    for i, f in enumerate(freqs):
        for d in (-4, 4):
            ph = rng.random()
            tr = 0.55 + 0.45 * np.sin(2 * np.pi * (trem * (0.8 + 0.4 * rng.random())) * t + 6.28 * rng.random())
            v = sine(f * 2 ** (d / 1200) * (1 + 0.002 * np.sin(2 * np.pi * 0.3 * t + i)), n, ph) * tr
            pan = rng.uniform(-0.8, 0.8)
            out[:, 0] += v * (1 - pan) * 0.5
            out[:, 1] += v * (1 + pan) * 0.5
    out *= np.minimum(1, t / attack)[:, None] ** 2
    return out / (np.abs(out).max() + 1e-9)


def air_pad(freqs, dur, seed=29, noise_amt=0.35, lp=9000):
    """Airy synth pad: soft detuned saws (low-passed) + breathy HP noise."""
    n = n_(dur)
    out = np.zeros((n, 2))
    rng = np.random.default_rng(seed)
    for f in freqs:
        out += supersaw(f, n, 5, 9.0, rng)
    out = sos_filter(out, 'lowpass', lp * 0.25, 2)
    nz = sos_filter(noise(n, seed, 2), 'bp', (4000, 12000), 2)
    t = np.arange(n) / SR
    lfo = 0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * t)[:, None]
    out = out / (np.abs(out).max() + 1e-9) + noise_amt * lfo * nz / (np.abs(nz).max() + 1e-9)
    return out / (np.abs(out).max() + 1e-9)


def radio_static(dur, seed=31):
    """Faint distant radio texture: band-limited hiss with syllable-rate
    gating and sparse crackles (no intelligible content)."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    hiss = sos_filter(noise(n, seed), 'bp', (700, 3200), 3)
    # syllable-ish envelope: smoothed random gate ~5 Hz, bursts of ~1.2 s
    g = rng.random(int(dur * 6) + 2)
    g = (g > 0.45).astype(float)
    ge = np.interp(t * 6, np.arange(len(g)), g)
    ge = sos_filter(ge, 'lowpass', 12, 1)
    burst = (np.sin(2 * np.pi * 0.23 * t + 1.0) > 0.2).astype(float)
    burst = sos_filter(burst, 'lowpass', 3, 1)
    x = hiss * (0.25 + 0.75 * ge * burst)
    crack = np.zeros(n)
    idx = rng.integers(0, n, int(dur * 14))
    crack[idx] = rng.standard_normal(len(idx)) * 3
    crack = sos_filter(crack, 'bp', (1500, 6000), 2)
    x = x / (np.abs(x).max() + 1e-9) + 0.4 * crack / (np.abs(crack).max() + 1e-9)
    return x / (np.abs(x).max() + 1e-9)


def braam_synth(notes, dur=3.6, seed=37, open_hz=3200, rest_hz=420, sub=True, drive=2.2):
    """Hybrid braam: detuned supersaws on each note through a Moog ladder that
    snaps open and slowly closes, saturated; sine sub on the lowest note."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = np.zeros((n, 2))
    for i, m in enumerate(notes):
        f = midi_hz(m)
        # slight pitch 'blat' scoop: start 25 cents flat, settle in 60 ms
        fcurve = f * 2 ** ((-25 * np.exp(-t / 0.03)) / 1200)
        x += supersaw(fcurve, n, 7, 16.0, rng) * (1.0 if m < 50 else 0.8)
    x /= np.abs(x).max() + 1e-9
    cutoff = rest_hz + (open_hz - rest_hz) * np.exp(-np.maximum(t - 0.04, 0) / 0.9)
    cutoff *= np.minimum(1.0, 0.25 + t / 0.05)
    y = ladder_sweep(x.astype(np.float32), cutoff, resonance=0.25, drive=1.0).astype(float)
    y = soft_clip(y * drive, 1.0)
    amp = np.minimum(1, t / 0.012) * (0.55 + 0.45 * np.exp(-t / 0.6)) * np.exp(-t / (dur * 0.7))
    amp *= np.clip((dur - t) / 0.4, 0, 1)
    y *= amp[:, None]
    if sub:
        f0 = midi_hz(min(notes))
        while f0 > 60:
            f0 /= 2
        s = sine(f0 * 2 ** ((-40 * np.exp(-t / 0.05)) / 1200), n) * np.minimum(1, t / 0.004) * np.exp(-t / (dur * 0.5))
        s *= np.clip((dur - t) / 0.4, 0, 1)
        y += 0.6 * s[:, None]
    return y / (np.abs(y).max() + 1e-9)


def pulse_note(freq, dur, cutoff0=2400, cutoff1=180, tau=0.07, seed=41, sub_amt=0.3):
    """Plucky hybrid pulse (saw+square) with a snapping ladder envelope."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = 0.6 * saw(freq * 1.003, n, rng.random()) + 0.6 * saw(freq * 0.997, n, rng.random())
    x += 0.4 * square(freq / 2, n, rng.random())
    c = cutoff1 + (cutoff0 - cutoff1) * np.exp(-t / tau)
    y = ladder_sweep(x.astype(np.float32), c, 0.35, 1.5).astype(float)
    y = soft_clip(y * 1.8)
    y += sub_amt * sine(freq / 2 if freq > 60 else freq, n)
    y *= np.exp(-t / (dur * 1.5))
    return fade(y, 0.003, 0.015)       # raised-cosine edges: no corners, no clicks


def whoosh(dur=1.2, peak=0.85, seed=43, f_lo=180, f_hi=5000):
    """Noise whoosh that swells up to `peak` fraction then decays."""
    n = n_(dur)
    t = np.arange(n) / SR
    tp = peak * dur
    fc = np.where(t < tp, f_lo * (f_hi / f_lo) ** (t / tp),
                  f_hi * (f_lo / f_hi) ** (np.maximum(t - tp, 0) / (dur - tp)) ** 0.7)
    y = tv_bandpass(noise(n, seed, 2), fc, 1.4)
    e = np.where(t < tp, (t / tp) ** 2.5, np.exp(-(t - tp) / 0.12))
    y *= e[:, None]
    return y / (np.abs(y).max() + 1e-9)


def snap(dur=0.12, seed=47):
    """Bright transient layer for hits (filtered noise, very fast decay)."""
    n = n_(dur)
    x = noise(n, seed, 2)
    x = sos_filter(x, 'bp', (900, 9000), 2)
    x *= exp_decay(n, 0.018)[:, None] * np.minimum(1, np.arange(n) / 24.0)[:, None]
    return x / (np.abs(x).max() + 1e-9)


def gong(freq=55.0, dur=7.0, seed=53):
    """Low tam-tam/gong bloom: inharmonic partials with a slow swell."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = np.zeros((n, 2))
    for k in range(40):
        f = freq * (1 + k * 0.73 + 0.07 * rng.standard_normal()) * (1.0 + 0.004 * k * k)
        if f > 9000:
            break
        a = 1.0 / (1 + 0.25 * k)
        sw = np.minimum(1, t / (0.02 + 0.03 * k)) * np.exp(-t / (2.5 / (1 + 0.08 * k)))
        v = sine(f * (1 + 0.0015 * np.sin(2 * np.pi * 0.7 * t + k)), n, rng.random()) * a * sw
        p = rng.uniform(-0.6, 0.6)
        x[:, 0] += v * (1 - p)
        x[:, 1] += v * (1 + p)
    x = fade(x, 0.0, min(2.5, dur * 0.4))
    return x / (np.abs(x).max() + 1e-9)


# ------------------------------------------------------------- reverbs
def make_ir(dur=4.0, rt60=(3.4, 3.0, 2.5, 1.7, 1.0), predelay=0.028, seed=61, er_gain=0.5,
            er_span=0.07, diffusion_ms=25):
    """Synthetic stereo IR: 5 frequency bands of decorrelated noise decaying
    at band-specific RT60s (low..high), sparse early reflections, pre-delay."""
    n = n_(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    edges = [(None, 250), (250, 1000), (1000, 4000), (4000, 8000), (8000, None)]
    ir = np.zeros((n, 2))
    for ch in range(2):
        w = rng.standard_normal(n)
        acc = np.zeros(n)
        for (lo, hi), rt in zip(edges, rt60):
            if lo is None:
                b = sos_filter(w, 'lowpass', hi, 4)
            elif hi is None:
                b = sos_filter(w, 'highpass', lo, 4)
            else:
                b = sos_filter(w, 'bp', (lo, hi), 4)
            acc += b * np.exp(-6.91 * t / rt)
        acc *= np.minimum(1, t / (diffusion_ms / 1000.0)) ** 1.5
        ir[:, ch] = acc
    # early reflections
    k = max(1, int(er_span * 400))
    for i in range(k):
        dt = rng.uniform(0.004, er_span)
        idx = n_(dt)
        g = er_gain * (1 - dt / (er_span * 1.2)) * rng.uniform(0.3, 1.0) * rng.choice([-1, 1])
        ir[idx, rng.integers(0, 2)] += g
    ir /= np.sqrt((ir ** 2).sum(0)).max() + 1e-12
    ir = np.concatenate([np.zeros((n_(predelay), 2)), ir])
    return ir


def convolve_stereo(x, ir, cross=0.3):
    """True-stereo-ish convolution: each output side hears mostly its own
    side plus `cross` of the other, convolved with that side's IR."""
    L = (1 - cross) * x[:, 0] + cross * x[:, 1]
    R = (1 - cross) * x[:, 1] + cross * x[:, 0]
    yl = signal.oaconvolve(L, ir[:, 0])[:len(x)]
    yr = signal.oaconvolve(R, ir[:, 1])[:len(x)]
    return np.stack([yl, yr], 1)


# ------------------------------------------------------------- dynamics
def envelope_follow(x, attack=0.005, release=0.1):
    a = np.exp(-1 / (attack * SR))
    r = np.exp(-1 / (release * SR))
    e = np.abs(x) if x.ndim == 1 else np.abs(x).max(1)
    # decimate to 1 kHz control rate for speed, then upsample
    hop = 48
    ed = e[:len(e) // hop * hop].reshape(-1, hop).max(1)
    a2, r2 = a ** hop, r ** hop
    out = np.zeros_like(ed)
    y = 0.0
    for i, v in enumerate(ed):
        c = a2 if v > y else r2
        y = c * y + (1 - c) * v
        out[i] = y
    return np.interp(np.arange(len(e)), np.arange(len(out)) * hop + hop / 2, out)


def true_peak(x, os=4):
    y = signal.resample_poly(x, os, 1, axis=0)
    return np.abs(y).max()


def tp_limiter(x, ceiling_db=-1.0, lookahead=0.003, release=0.12, os=4):
    """Look-ahead true-peak limiter.  Peak envelope measured on a 4x
    oversampled copy; gain = min-hold over the look-ahead window, attack
    ramp across the window (no overshoot), exponential release."""
    ceil = db(ceiling_db)
    up = signal.resample_poly(x, os, 1, axis=0)
    pk = np.abs(up).max(1)
    pk = pk[:len(pk) // os * os].reshape(-1, os).max(1)
    pk = np.pad(pk, (0, len(x) - len(pk)), mode='edge')
    g_req = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    L = max(1, n_(lookahead))
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    # hold the minimum over the look-ahead (window ending L samples ahead)
    g_hold = minimum_filter1d(g_req, size=2 * L + 1, mode='nearest')
    # release: recursive max-follow toward 1 at control rate
    hop = 16
    gd = g_hold[:len(g_hold) // hop * hop].reshape(-1, hop).min(1)
    r = np.exp(-hop / (release * SR))
    out = np.empty_like(gd)
    y = 1.0
    for i, v in enumerate(gd):
        y = v if v < y else (r * y + (1 - r) * v)
        out[i] = y
    g = np.repeat(out, hop)
    g = np.pad(g, (0, len(x) - len(g)), mode='edge')
    g = np.minimum(g, g_hold)
    g = uniform_filter1d(g, size=L, mode='nearest')      # smooth attack ramp
    g = np.minimum(g, minimum_filter1d(g_req, size=2 * L + 1, mode='nearest') * 1.0 + 0.0)
    return x * g[:, None], g


def impact(dur=0.7, f0=170.0, f1=46.0, seed=59, body_tau=0.13, crack=0.5, thump=0.4):
    """Trailer-hit transient body: a pitch-dropping sine 'kick' (0.5 ms
    attack), a band-passed noise crack and a low-passed noise thump,
    saturated together.  This is what makes a hit read as an IMPACT."""
    n = n_(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.018)
    body = sine(f, n) * np.exp(-t / body_tau) * np.minimum(1, t / 0.0005)
    nz = noise(n, seed)
    cr = sos_filter(nz, 'bp', (1200, 6500), 2) * np.exp(-t / 0.022)
    th = sos_filter(nz, 'lowpass', 320, 2) * np.exp(-t / 0.05)
    cr /= np.abs(cr).max() + 1e-9
    th /= np.abs(th).max() + 1e-9
    x = body + crack * cr + thump * th
    x = soft_clip(x * 1.6, 1.0)
    x = fade(x, 0.0, dur * 0.4)
    return x / (np.abs(x).max() + 1e-9)

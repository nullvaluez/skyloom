"""Small numpy/numba synth + effects kit for the trailer score.

All signals are float64 mono arrays at SR unless noted; stereo is (n, 2).
"""
import numpy as np
from numba import njit
from scipy import signal

SR = 48000
RNG = np.random.default_rng(7)


def midi_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


def t_axis(n):
    return np.arange(n) / SR


# ---------------------------------------------------------------- oscillators
def _polyblep(t, dt):
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    out[m] = x + x - x * x - 1.0
    m2 = t > 1.0 - dt
    x = (t[m2] - 1.0) / dt[m2]
    out[m2] = x * x + x + x + 1.0
    return out


def saw(freq, n, phase0=0.0):
    """Band-limited (polyBLEP) saw. freq: scalar or array of length n."""
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    return 2.0 * ph - 1.0 - _polyblep(ph, dt)


def square(freq, n, phase0=0.0, pw=0.5):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    ph2 = (ph + (1 - pw)) % 1.0
    s1 = 2.0 * ph - 1.0 - _polyblep(ph, dt)
    s2 = 2.0 * ph2 - 1.0 - _polyblep(ph2, dt)
    return 0.5 * (s1 - s2)


def sine(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    ph = phase0 + np.cumsum(f) / SR - f[0] / SR
    return np.sin(2 * np.pi * ph)


def noise(n):
    return RNG.standard_normal(n) * 0.5


# ------------------------------------------------------------------- filters
@njit(cache=True)
def _svf(x, fc, q, mode):
    # TPT state-variable filter (Zavalishin). mode 0=LP 1=BP 2=HP
    n = x.shape[0]
    y = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(n):
        g = np.tan(np.pi * min(fc[i], 20000.0) / 48000.0)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            y[i] = v2
        elif mode == 1:
            y[i] = v1
        else:
            y[i] = x[i] - k * v1 - v2
    return y


def svf(x, fc, q=0.707, mode='lp'):
    fc = np.ascontiguousarray(np.broadcast_to(np.asarray(fc, dtype=np.float64), x.shape))
    return _svf(np.ascontiguousarray(x, dtype=np.float64), np.maximum(fc, 10.0), float(q),
                {'lp': 0, 'bp': 1, 'hp': 2}[mode])


def butter(x, fc, kind='low', order=2):
    sos = signal.butter(order, fc, btype=kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def shelf(x, fc, gain_db, kind='high'):
    # RBJ shelf biquad
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / 2 * np.sqrt(2)
    cw = np.cos(w0)
    if kind == 'high':
        b0 = A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)
        a0 = (A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha
    else:
        b0 = A * ((A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha)
        b1 = 2 * A * ((A - 1) - (A + 1) * cw)
        b2 = A * ((A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha)
        a0 = (A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha
        a1 = -2 * ((A - 1) + (A + 1) * cw)
        a2 = (A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha
    b = np.array([b0, b1, b2]) / a0
    a = np.array([1, a1 / a0, a2 / a0])
    return signal.lfilter(b, a, x, axis=0)


def peak_eq(x, fc, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / (2 * q)
    cw = np.cos(w0)
    b = np.array([1 + alpha * A, -2 * cw, 1 - alpha * A])
    a = np.array([1 + alpha / A, -2 * cw, 1 - alpha / A])
    return signal.lfilter(b / a[0], a / a[0], x, axis=0)


# --------------------------------------------------------------- envelopes
def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, gate=None):
    """gate = seconds the note is held (defaults to n minus release)."""
    t = t_axis(n)
    if gate is None:
        gate = max(n / SR - r, a)
    env = np.where(t < a, t / max(a, 1e-6), 1.0)
    dec = s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6))
    env = np.where(t >= a, dec, env)
    level_at_gate = s + (1 - s) * np.exp(-max(gate - a, 0) / max(d, 1e-6)) if gate > a else gate / max(a, 1e-6)
    rel = level_at_gate * np.exp(-(t - gate) / max(r / 4.0, 1e-6))
    env = np.where(t >= gate, rel, env)
    return env


def expdec(n, tau, attack=0.001):
    t = t_axis(n)
    return np.minimum(t / max(attack, 1e-6), 1.0) * np.exp(-t / tau)


def fade_tail(x, sec=0.01):
    m = min(len(x), int(sec * SR))
    if m > 1:
        r = np.linspace(1, 0, m)
        x[-m:] *= r[:, None] if x.ndim == 2 else r
    return x


# ------------------------------------------------------------------- stereo
def pan(x, p):
    """p in [-1, 1]; constant power."""
    th = (np.asarray(p) + 1) * np.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)], axis=-1)


def widen(st, amount=1.3):
    m = (st[:, 0] + st[:, 1]) / 2
    s = (st[:, 0] - st[:, 1]) / 2 * amount
    return np.stack([m + s, m - s], axis=-1)


class Bus:
    def __init__(self, n):
        self.x = np.zeros((n, 2))

    def add(self, sig, t0, gain=1.0, p=0.0):
        i0 = int(round(t0 * SR))
        if sig.ndim == 1:
            sig = pan(sig, p)
        if i0 < 0:
            sig = sig[-i0:]
            i0 = 0
        i1 = min(i0 + len(sig), len(self.x))
        if i1 > i0:
            self.x[i0:i1] += sig[: i1 - i0] * gain


# ------------------------------------------------------------------- effects
def make_ir(rt60=2.2, pre=0.02, bright=6000.0, seed=3, width=1.0):
    rng = np.random.default_rng(seed)
    n = int((rt60 * 1.2 + pre) * SR)
    t = t_axis(n)
    tau = rt60 / 6.91
    ir = np.zeros((n, 2))
    for c in range(2):
        nz = rng.standard_normal(n) * np.exp(-t / tau)
        # darker as it decays: crossfade bright -> dark lowpassed copy
        dark = butter(nz, 1800, 'low', 2)
        mix = np.exp(-t / (tau * 0.8))
        nz = nz * mix + dark * (1 - mix)
        nz[: int(pre * SR)] = 0
        ir[:, c] = nz
    ir = butter(ir, bright, 'low', 2)
    ir = butter(ir, 180, 'high', 2)
    # early reflections
    for k, (dly, g) in enumerate([(0.011, .5), (0.019, .4), (0.027, .35), (0.041, .3), (0.053, .25)]):
        i = int((pre + dly) * SR)
        ir[i, k % 2] += g * 8
        ir[i + 37, (k + 1) % 2] += g * 6
    m = (ir[:, 0] + ir[:, 1]) / 2
    s = (ir[:, 0] - ir[:, 1]) / 2 * width
    ir = np.stack([m + s, m - s], axis=-1)
    ir /= np.sqrt((ir ** 2).sum() / 2)
    return ir


def reverb(st, ir):
    out = np.zeros((len(st) + len(ir) - 1, 2))
    for c in range(2):
        out[:, c] = signal.fftconvolve(st[:, c], ir[:, c])
    return out[: len(st)]


@njit(cache=True)
def _pingpong(xl, xr, dly, fb, lp):
    n = xl.shape[0]
    bl = np.zeros(n)
    br = np.zeros(n)
    sl = 0.0
    sr = 0.0
    for i in range(n):
        dl = bl[i - dly] if i >= dly else 0.0
        dr = br[i - dly] if i >= dly else 0.0
        sl = sl + lp * (dl - sl)
        sr = sr + lp * (dr - sr)
        # cross feedback = ping-pong
        bl[i] = xl[i] + sr * fb
        br[i] = xr[i] * 0.3 + sl * fb
    return bl, br


def pingpong(st, time_s, fb=0.4, lp=0.35):
    l, r = _pingpong(np.ascontiguousarray(st[:, 0]), np.ascontiguousarray(st[:, 1]),
                     int(time_s * SR), fb, lp)
    out = np.stack([l, r], axis=-1) - np.stack([st[:, 0], st[:, 1] * 0.3], axis=-1)
    return out


@njit(cache=True)
def _env_follow(x, att, rel):
    n = x.shape[0]
    e = np.empty(n)
    v = 0.0
    for i in range(n):
        a = x[i]
        c = att if a > v else rel
        v = a + c * (v - a)
        e[i] = v
    return e


def compress(st, thresh_db=-14.0, ratio=2.5, att=0.008, rel=0.16, makeup_db=0.0, knee=6.0):
    det = np.sqrt(np.maximum((st ** 2).mean(axis=1), 1e-12))
    ac = np.exp(-1 / (att * SR))
    rc = np.exp(-1 / (rel * SR))
    env = _env_follow(det, ac, rc)
    lvl = 20 * np.log10(np.maximum(env, 1e-9))
    over = lvl - thresh_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    g = 10 ** ((makeup_db - gr) / 20)
    return st * g[:, None]


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def sidechain_curve(n, kick_times, depth=0.7, rel=0.22, shape=2.2):
    """Gain array that ducks at each kick and recovers over `rel` seconds."""
    g = np.ones(n)
    L = int(rel * SR)
    curve = 1 - depth * (1 - (np.linspace(0, 1, L) ** (1 / shape)))
    # small 3ms lead-in so the duck is already down at the transient
    lead = int(0.003 * SR)
    for t in kick_times:
        i0 = int(round(t * SR)) - lead
        i1 = min(i0 + L, n)
        if i1 <= max(i0, 0):
            continue
        seg = curve[max(0, -i0): i1 - i0]
        g[max(i0, 0):i1] = np.minimum(g[max(i0, 0):i1], seg)
    return g

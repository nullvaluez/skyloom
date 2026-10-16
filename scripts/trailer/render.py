"""Skyloom trailer v2 — picture renderer.

Renders every clip of edl.CLIPS to its own near-lossless segment (in
parallel), then concatenates them. Usage:
    python3 render.py [clip_id ...]          # all clips, or only these
"""
import os
import sys
import glob
import subprocess
from multiprocessing import Pool
import numpy as np
import cv2
from PIL import Image

import edl
from edl import CLIPS, BEAT, FLEET, FPS
import titles as TT
from titles import PW, PH, place, text_mask, smooth, ease_out

from paths import SRC, SEG, FLEET_FRAMES, FONTS
FW, FH = 1920, 1080
TOP = (FH - PH) // 2          # 138: letterbox bar height
SRC_TOP = 60                  # the reference has 1920x960 active picture at y=60
SH = 960

LOOK = dict(
    day=dict(bp=0.035, wp=0.985, con=1.18, sat=1.14, warm=0.035, teal=0.030, bloom=0.30, thr=0.70, expo=1.0),
    haze=dict(bp=0.075, wp=0.98, con=1.26, sat=1.18, warm=0.030, teal=0.035, bloom=0.25, thr=0.72, expo=0.98),
    sunset=dict(bp=0.04, wp=0.97, con=1.20, sat=1.16, warm=0.060, teal=0.035, bloom=0.42, thr=0.62, expo=1.0),
    night=dict(bp=0.03, wp=0.94, con=1.16, sat=1.10, warm=0.030, teal=0.045, bloom=0.65, thr=0.55, expo=1.04),
)
CLIP_LOOK = {
    'Z_stealth': 'haze', 'A_real': 'haze', 'A_coast': 'haze', 'AE_hero': 'haze',
    'J_sunset': 'sunset', 'J2_burner': 'sunset', 'K_hud': 'sunset', 'L1_along': 'sunset', 'L2_along': 'sunset', 'fl_J': 'sunset',
    'R_paris': 'night', 'S_eiffel': 'night', 'W_newyork': 'night', 'X_night': 'night', 'Y_runway': 'night', 'fl_R': 'night',
}

_yy, _xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
_r = np.sqrt(((_xx - PW / 2) / (PW / 2)) ** 2 + ((_yy - PH / 2) / (PW / 2)) ** 2 * 1.0)
VIGNETTE = (1 - 0.30 * np.clip(_r / 1.12, 0, 1) ** 2.4).astype(np.float32)[..., None]
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


# ------------------------------------------------------------------ source
def decode(a, b):
    """Frames [round(a*30)-1, round(b*30)+1] of the reference, active area, float32 0..1."""
    i0 = max(int(round(a * FPS)) - 1, 0)
    i1 = int(round(b * FPS)) + 1
    n = i1 - i0 + 1
    # -fps_mode passthrough: with the default CFR sync a seeked raw pipe repeats its
    # first frame, which shifts every clip one frame early.
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{(i0 - 0.5) / FPS:.5f}', '-i', SRC, '-frames:v', str(n),
           '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, FH, FW, 3)[:, SRC_TOP:SRC_TOP + SH]
    return i0, fr


_dis = None


def flow(a, b):
    global _dis
    if _dis is None:
        _dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    ga = cv2.cvtColor(cv2.resize(a, (960, 480), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
    gb = cv2.cvtColor(cv2.resize(b, (960, 480), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
    f = _dis.calc(ga, gb, None)
    return cv2.resize(f, (FW, SH), interpolation=cv2.INTER_LINEAR) * 2.0


_gx, _gy = np.meshgrid(np.arange(FW, dtype=np.float32), np.arange(SH, dtype=np.float32))


def interp(A, B, t, cache, key):
    if key not in cache:
        cache.clear()
        cache[key] = (flow(A, B), flow(B, A))
    fab, fba = cache[key]
    wa = cv2.remap(A, _gx - t * fab[..., 0], _gy - t * fab[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    wb = cv2.remap(B, _gx - (1 - t) * fba[..., 0], _gy - (1 - t) * fba[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return (wa.astype(np.float32) * (1 - t) + wb.astype(np.float32) * t)


def source_frame(frames, i0, last_valid, fpos, speed, cache):
    """fpos: fractional source frame index. Returns float32 0..255 (960x1920x3)."""
    if speed >= 1.3:   # motion blur: box over the frames this output frame covers
        lo = fpos
        hi = fpos + speed * 0.75
        idx = list(range(int(np.floor(lo)), int(np.floor(hi)) + 1))
        idx = [min(max(i, i0), last_valid) for i in idx]
        acc = np.zeros(frames[0].shape, np.float32)
        for i in idx:
            acc += frames[i - i0]
        return acc / len(idx)
    i = int(np.floor(fpos))
    t = fpos - i
    i = min(max(i, i0), last_valid)
    j = min(i + 1, last_valid)
    if t < 0.08 or j == i:
        return frames[i - i0].astype(np.float32)
    if t > 0.92:
        return frames[j - i0].astype(np.float32)
    return interp(frames[i - i0], frames[j - i0], t, cache, i)


def reframe(img, z, cx, cy, dx=0.0, dy=0.0):
    cw, ch = PW / z, PH / z
    cx = float(np.clip(cx, cw / 2, FW - cw / 2)) + dx / z
    cy = float(np.clip(cy, ch / 2, SH - ch / 2)) + dy / z
    x0, y0 = cx - cw / 2, cy - ch / 2
    M = np.array([[1 / z, 0, x0], [0, 1 / z, y0]], np.float32)
    return cv2.warpAffine(img, M, (PW, PH), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_REFLECT)


# ------------------------------------------------------------------ grade
def grade(x, L):
    x = x * L['expo']
    x = np.clip((x - L['bp']) / (L['wp'] - L['bp']), 0, 1)
    g = L['con']
    xg = x ** g
    x = xg / (xg + (1 - x) ** g + 1e-6)
    lum = x @ LUMA
    x = lum[..., None] + (x - lum[..., None]) * L['sat']
    # split tone: teal shadows, warm highlights
    sh = (1 - lum) ** 2
    hi = lum ** 2
    x = x + sh[..., None] * np.array([-0.6, 0.15, 0.55], np.float32) * L['teal'] \
          + hi[..., None] * np.array([0.8, 0.35, -0.5], np.float32) * L['warm']
    # bloom
    small = cv2.resize(x, (PW // 4, PH // 4), interpolation=cv2.INTER_AREA)
    sl = small @ LUMA
    knee = np.clip((sl - L['thr']) / (1 - L['thr'] + 1e-6), 0, 1) ** 1.5
    hl = small * knee[..., None]
    b1 = cv2.GaussianBlur(hl, (0, 0), 3)
    b2 = cv2.GaussianBlur(hl, (0, 0), 12)
    bl = cv2.resize(b1 * 0.6 + b2 * 0.8, (PW, PH), interpolation=cv2.INTER_LINEAR)
    x = x + bl * L['bloom'] * np.array([1.0, 0.97, 0.92], np.float32)
    # sharpen
    x = x + 0.35 * (x - cv2.GaussianBlur(x, (0, 0), 1.1))
    return x


def finish(pic, g, grain=0.016):
    """pic: float picture area -> uint8 full 1080p frame with letterbox."""
    pic = pic * VIGNETTE
    rng = np.random.default_rng(1000 + g)
    n = rng.standard_normal((PH // 2, PW // 2)).astype(np.float32)
    n = cv2.resize(n, (PW, PH), interpolation=cv2.INTER_LINEAR)
    lum = np.clip(pic @ LUMA, 0, 1)
    pic = pic + (n * grain * (1.1 - 0.6 * lum))[..., None]
    out = np.zeros((FH, FW, 3), np.uint8)
    out[TOP:TOP + PH] = (np.clip(pic, 0, 1) * 255 + 0.5).astype(np.uint8)
    return out


# ------------------------------------------------------------------ fx helpers
def hblur(img, length):
    L = int(length)
    if L < 2:
        return img
    k = np.ones((1, L), np.float32) / L
    return cv2.filter2D(img, -1, k, borderType=cv2.BORDER_REFLECT)


def zoom_blur(img, amount, n=10):
    if amount < 0.003:
        return img
    acc = img.copy()
    for k in range(1, n):
        s = 1 + amount * k / n
        M = np.array([[s, 0, PW / 2 * (1 - s)], [0, s, PH / 2 * (1 - s)]], np.float32)
        acc += cv2.warpAffine(img, M, (PW, PH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return acc / n


FLASH = [1.0, 0.62, 0.34, 0.16, 0.06]


def apply_fx(pic, clip, k, n, prev_whip):
    fx = clip.get('fx', [])
    if 'flash_in' in fx and k < len(FLASH):
        pic = pic + FLASH[k] * 0.9
    if 'fade_in' in fx and k < 10:
        pic = pic * smooth(k / 10)
    if prev_whip and k < 4:
        L = [180, 90, 40, 12][k]
        pic = hblur(pic, L)
    if 'whip_out' in fx and k >= n - 4:
        j = k - (n - 4)
        L = [20, 60, 130, 220][j]
        sh = [0, 30, 110, 260][j]
        M = np.array([[1, 0, -sh], [0, 1, 0]], np.float32)
        pic = cv2.warpAffine(hblur(pic, L), M, (PW, PH), borderMode=cv2.BORDER_REFLECT)
    if 'ramp_out' in fx and k >= n - 5:
        j = k - (n - 5)
        pic = zoom_blur(pic, [0.02, 0.05, 0.09, 0.15, 0.24][j]) * (1 + 0.15 * j)
    if 'cut_black' in fx and k >= n - BEAT // 2:
        pic = pic * 0.0
    return pic


# ------------------------------------------------------------------ clip renderers
def src_frames(clip):
    b0, b1 = clip['b']
    n = int(round((b1 - b0) * BEAT))
    a, b = clip['src']
    i0, frames = decode(a, b)
    last_valid = min(int(round(b * FPS)) - 1, i0 + len(frames) - 1)
    speed = (b - a) * FPS / n
    L = LOOK[CLIP_LOOK.get(clip['id'], 'day')]
    z0 = clip.get('z', 1.0)
    cy = clip.get('cy', SH / 2)
    cx = clip.get('cx', FW / 2)
    push = clip.get('push', 0.0)
    punch = clip.get('punch', 0.0)
    shake = 'flash_in' in clip.get('fx', []) and clip['id'] in ('B_harbor', 'R_paris', 'AE_hero', 'Z_stealth')
    rng = np.random.default_rng(hash(clip['id']) % 2 ** 32)
    cache = {}
    ramp = 'ramp_out' in clip.get('fx', [])
    for k in range(n):
        u = k / max(n - 1, 1)
        fpos = a * FPS + k * speed
        if ramp and k >= n - 5:      # accelerate into the cut
            j = k - (n - 5) + 1
            fpos = a * FPS + (n - 5) * speed + speed * (j * 1.6 + 0.25 * j * j)
            fpos = min(fpos, last_valid)
        img = source_frame(frames, i0, last_valid, fpos, speed, cache) / 255.0
        z = z0 * (1 + push * smooth(u) if push else 1) * (1 + punch * np.exp(-k / 2.5))
        dx = dy = 0.0
        if shake and k < 12:
            amp = 9 * np.exp(-k / 4)
            dx, dy = rng.normal(0, amp), rng.normal(0, amp)
        pic = reframe(img, z, cx, cy, dx, dy)
        yield grade(pic, L)


# ---- globe
def globe_frames(clip):
    import globe
    b0, b1 = clip['b']
    n = int(round((b1 - b0) * BEAT))
    fn = globe.intro_frame if clip['mode'] == 'intro' else globe.warp_frame
    for k in range(n):
        yield fn(k / BEAT).astype(np.float32)


# ---- fleet
def _fleet_bg(t, seed):
    rng = np.random.default_rng(seed)
    base = np.zeros((PH, PW, 3), np.float32)
    r = np.sqrt(((_xx - PW / 2) / 900) ** 2 + ((_yy - PH * 0.42) / 520) ** 2)
    base += np.exp(-r ** 2 * 1.6)[..., None] * np.array([0.05, 0.085, 0.13], np.float32)
    beam = np.exp(-((_xx - PW / 2) / 420) ** 2) * np.clip(1 - _yy / PH, 0, 1) ** 1.5
    base += beam[..., None] * np.array([0.035, 0.05, 0.07], np.float32)
    # floor glow
    fl = np.exp(-((_yy - PH * 0.86) / 60) ** 2) * np.exp(-((_xx - PW / 2) / 700) ** 2)
    base += fl[..., None] * np.array([0.03, 0.05, 0.08], np.float32)
    # dust motes
    nd = 160
    px = (rng.uniform(0, PW, nd) + t * rng.uniform(-30, 30, nd)) % PW
    py = (rng.uniform(0, PH, nd) + t * rng.uniform(-12, 5, nd)) % PH
    br = rng.uniform(0.05, 0.35, nd) * (0.6 + 0.4 * np.sin(t * 3 + rng.uniform(0, 6, nd)))
    dust = np.zeros((PH, PW), np.float32)
    np.add.at(dust, (py.astype(int), px.astype(int)), br)
    dust = cv2.GaussianBlur(dust, (0, 0), 1.6) * 6
    base += dust[..., None] * np.array([0.6, 0.75, 0.9], np.float32)
    return base


def fleet_frames(clip):
    g0 = int(round(clip['b'][0] * BEAT))
    for i, a in enumerate(FLEET):
        n = int(round((a['b'][1] - a['b'][0]) * BEAT))
        umbra = 'umbra' in a['model']
        for k in range(n):
            u = k / max(n - 1, 1)
            t = (g0 + int(round((a['b'][0] - clip['b'][0]) * BEAT)) + k) / FPS
            img = _fleet_bg(t, 3 + i)
            # ghost name behind the aircraft
            gm, _, _ = text_mask(a['name'], 'Archivo-900-expanded.ttf', 250, 0.04)
            place(img, gm, (0.75, 0.86, 1.0), PW / 2 + 40 - 80 * u, PH * 0.47, 0.085)
            rgba = np.asarray(Image.open(os.path.join(FLEET_FRAMES, f'{i:02d}_{k:03d}.png')).convert('RGBA'),
                              np.float32)[TOP:TOP + PH] / 255.0
            rgb, al = rgba[..., :3], rgba[..., 3:4]
            if umbra:
                lum = rgb @ LUMA
                rgb = rgb ** 2.6 * 0.9 + np.clip(rgb - 0.72, 0, None)[..., :] * 1.6
                rgb *= smooth(k / 10) * 0.85 + 0.15
            else:
                rgb = np.clip(rgb, 0, 1) ** 1.18
            # light sweep across the airframe
            sweep_x = -300 + (PW + 600) * (u * 0.9 + 0.05)
            band = np.exp(-(((_xx - sweep_x) + (_yy - PH / 2) * 0.45) / 110) ** 2)[..., None]
            lum = (rgb @ LUMA)[..., None]
            rgb = rgb + band * 0.55 * np.clip(lum * 1.6, 0, 1) * np.array([1.0, 0.98, 0.95], np.float32)
            img = img * (1 - al) + rgb * al
            # shadow/rim glow
            glow = cv2.GaussianBlur(al[..., 0], (0, 0), 24)[..., None]
            img += glow * np.array([0.02, 0.05, 0.09], np.float32) * 0.8
            img = grade(img, dict(bp=0.0, wp=1.0, con=1.08, sat=1.05, warm=0.02, teal=0.03, bloom=0.5, thr=0.65, expo=1.05))
            # labels
            idx = f'{i + 1:02d} / 13'
            mi, _, _ = text_mask(idx, 'JetBrainsMono-500.ttf', 20, 0.12)
            place(img, mi, (0.6, 0.85, 1.0), 112, PH * 0.83, smooth(k / 3), anchor='l')
            mn, _, _ = text_mask(a['name'], 'Archivo-800-expanded.ttf', 40, 0.32)
            place(img, mn, (1, 1, 1), 112 + 128, PH * 0.83, smooth(k / 3), anchor='l', glow=0.2)
            mh, _, _ = text_mask('THE HANGAR', 'Archivo-300-expanded.ttf', 20, 0.6)
            place(img, mh, (0.8, 0.9, 1.0), 112, PH * 0.12, 0.75, anchor='l')
            if umbra and k >= 3:
                TT.draw_title(img, dict(b=(62.2, 64), style='line', text='13 AIRCRAFT. PICK YOUR WINGS.',
                                        y=0.70, accent=True, hold=True, stagger=0.3), k - 3)
            # quick flash on each cut
            if k < 3:
                img = img + [0.26, 0.10, 0.03][k]
            yield img


# ---- logo
def logo_frames(clip):
    import globe
    n = int(round((clip['b'][1] - clip['b'][0]) * BEAT))
    rng = np.random.default_rng(4)
    ns = 500
    sx, sy = rng.uniform(0, PW, ns), rng.uniform(0, PH * 0.8, ns)
    sb = rng.random(ns) ** 3 * 0.7 + 0.03
    Rl = 2600.0
    ccx, ccy = PW / 2, PH * 0.80 + Rl
    d = np.sqrt((_xx - ccx) ** 2 + (_yy - ccy) ** 2)
    inside = smooth((Rl - d) / 1.5)
    limb_line = np.exp(-((d - Rl) / 2.2) ** 2)
    halo = np.exp(-np.clip(d - Rl, 0, None) / 38) * (d >= Rl - 1)
    inner = np.exp(-np.clip(Rl - d, 0, None) / 70) * (d < Rl)
    ang = np.abs(_xx - ccx) / 900
    arc_fall = np.exp(-ang ** 2)
    sky_col = np.array([0.012, 0.022, 0.045], np.float32)
    for k in range(n):
        t = k / FPS
        img = np.zeros((PH, PW, 3), np.float32) + sky_col * (1 - _yy[..., None] / PH * 0.3)
        st = np.zeros((PH, PW, 3), np.float32)
        tw = sb * (0.8 + 0.2 * np.sin(t * 2 + sx))
        globe.splat(st, sx, sy, np.stack([tw * 0.85, tw * 0.92, tw], -1))
        img += cv2.GaussianBlur(st, (0, 0), 0.6) * 1.5 * (1 - inside[..., None])
        # earth limb
        rise = ease_out(k / 40, 2)
        img = img * (1 - inside[..., None]) + inside[..., None] * np.array([0.004, 0.008, 0.016], np.float32)
        col_l = np.array([0.55, 0.80, 1.0], np.float32)
        img += (limb_line * 1.1 * arc_fall)[..., None] * col_l * rise
        img += (halo * (0.55 + 0.45 * arc_fall))[..., None] * np.array([0.10, 0.30, 0.75], np.float32) * rise
        img += (inner * 0.35 * arc_fall)[..., None] * np.array([0.10, 0.25, 0.6], np.float32) * rise
        # sunrise flare at the limb crest
        fx_, fy_ = PW / 2, PH * 0.80
        fd = np.sqrt((_xx - fx_) ** 2 + ((_yy - fy_) * 2.2) ** 2)
        fl_k = 0.55 + 0.45 * np.exp(-k / 18)
        img += (np.exp(-fd / 60) * 0.9 + np.exp(-fd / 260) * 0.35)[..., None] * np.array([1.0, 0.88, 0.72], np.float32) * fl_k * rise
        streak = np.exp(-((_yy - fy_) / 2.5) ** 2) * np.exp(-np.abs(_xx - fx_) / 420)
        img += streak[..., None] * np.array([0.55, 0.75, 1.0], np.float32) * (0.7 * fl_k) * rise
        # wordmark
        scale = 1.0 + 0.05 * (1 - ease_out(k / 45, 3))
        wy = PH * 0.40
        m_sky, _, _ = text_mask('SKY', 'Archivo-900-expanded.ttf', 128, 0.36)
        m_loom, _, _ = text_mask('LOOM', 'Archivo-900-expanded.ttf', 128, 0.36)
        pad = int(128 * 0.5)
        w1 = m_sky.shape[1] - 2 * pad
        w2 = m_loom.shape[1] - 2 * pad
        gap = 128 * 0.36
        total = w1 + gap + w2
        x_start = PW / 2 - total / 2
        # reveal sweep
        sweep = -100 + (total + 300) * ease_out(k / 16, 2)
        for m, col, xo in ((m_sky, (1, 1, 1), 0), (m_loom, (0.62, 0.80, 1.0), w1 + gap)):
            mm = m.copy()
            xs = np.arange(mm.shape[1]) - pad + xo
            reveal = smooth((sweep - xs) / 60)
            mm = mm * reveal[None, :]
            glow = 0.35 + 1.2 * np.exp(-k / 10)
            place(img, mm, col, x_start + xo - pad, wy, 1.0, anchor='l', glow=glow, scale=1.0)
        # sweep head glint
        if k < 22:
            gx = x_start + sweep
            glint = np.exp(-((_xx - gx) / 12) ** 2) * np.exp(-((_yy - wy) / 80) ** 2) + \
                np.exp(-((_yy - wy) / 3) ** 2) * np.exp(-np.abs(_xx - gx) / 160) * 0.6
            img += glint[..., None] * 0.9 * (1 - k / 22)
        # tagline, button
        fr_t = k - 4 * BEAT
        if fr_t >= 0:
            a = smooth(fr_t / 18)
            tr = 0.95 - 0.15 * ease_out(fr_t / 30)
            mt, _, _ = text_mask('FLY THE LIVING EARTH', 'Archivo-300-expanded.ttf', 26, tr)
            place(img, mt, (0.82, 0.90, 1.0), PW / 2, wy + 96, a)
        fr_b = k - 8 * BEAT
        if fr_b >= 0:
            a = smooth(fr_b / 14)
            mb, _, _ = text_mask('PLAY NOW IN YOUR BROWSER', 'Archivo-800-expanded.ttf', 18, 0.34)
            bw, bh = mb.shape[1] - 18 + 60, 54
            box = np.zeros((bh + 8, bw + 8), np.float32)
            cv2.rectangle(box, (4, 4), (bw + 3, bh + 3), 1.0, 2, cv2.LINE_AA)
            box = cv2.GaussianBlur(box, (0, 0), 0.5)
            place(img, box, (0.55, 0.80, 1.0), PW / 2, wy + 176, a * 0.85, glow=0.4)
            place(img, mb, (1, 1, 1), PW / 2, wy + 176, a)
        # end fade
        fo = 1 - smooth((k - (n - 36)) / 34)
        yield img * fo


CREDITS = [
    'Footage captured in-engine. Imagery: contains modified Copernicus Sentinel-2 data (ESA).',
    'Map data: Overture Maps Foundation, © OpenStreetMap contributors. Elevation: Mapzen Terrain Tiles. Land cover: ESA WorldCover 2021.',
    '3D models (CC BY): Statue of Liberty – Anna M · Empire State Building – Thomas de Rivaz · Eiffel Tower – Scott Marshall · '
    'Sydney Opera House – Nick Reinhardt · Big Ben – Daqian Dong · aircraft – Poly by Google, Miha Lunar (poly.pizza).',
    'Air traffic in this trailer is staged for illustration. In the game, traffic is live ADS-B data. Globe: Natural Earth. Music: original score.',
]
INTER = os.path.join(FONTS, 'Inter-400.ttf')


def credits_overlay(frame, k, n):
    a = smooth((k - 10 * BEAT) / 20) * (1 - smooth((k - (n - 36)) / 34))
    if a <= 0:
        return frame
    img = frame.astype(np.float32) / 255
    y = FH - TOP + 30
    for line in CREDITS:
        m, _, _ = text_mask(line, INTER, 15, 0.01)
        h, w = m.shape
        if w > FW - 80:
            m = cv2.resize(m, (FW - 80, int(h * (FW - 80) / w)), interpolation=cv2.INTER_AREA)
        TT._blend_over(img, m * a * 0.62, np.array([0.75, 0.8, 0.88], np.float32),
                       int(FW / 2 - m.shape[1] / 2), int(y - m.shape[0] / 2))
        y += 24
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


# ------------------------------------------------------------------ driver
def render_clip(ci):
    cv2.setNumThreads(1)
    clip = CLIPS[ci]
    g0 = int(round(clip['b'][0] * BEAT))
    n = int(round((clip['b'][1] - clip['b'][0]) * BEAT))
    out = os.path.join(SEG, f'{ci:02d}_{clip["id"]}.mkv')
    gen = {'src': src_frames, 'globe': globe_frames, 'fleet': fleet_frames, 'logo': logo_frames}[clip['kind']](clip)
    prev_whip = ci > 0 and 'whip_out' in CLIPS[ci - 1].get('fx', [])
    ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{FW}x{FH}',
                           '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'fast', '-crf', '7',
                           '-pix_fmt', 'yuv444p', out], stdin=subprocess.PIPE)
    count = 0
    for k, pic in enumerate(gen):
        g = g0 + k
        pic = apply_fx(pic, clip, k, n, prev_whip)
        TT.draw_titles(pic, g)
        grain = 0.016 if clip['kind'] == 'src' else 0.010
        frame = finish(pic, g, grain)
        if clip['kind'] == 'logo':
            frame = credits_overlay(frame, k, n)
        ff.stdin.write(frame.tobytes())
        count += 1
    ff.stdin.close()
    ff.wait()
    assert count == n, (clip['id'], count, n)
    return out


if __name__ == '__main__':
    os.makedirs(SEG, exist_ok=True)
    want = sys.argv[1:]
    idx = [i for i, c in enumerate(CLIPS) if not want or c['id'] in want]
    # heavy clips first for better packing
    weight = {'globe': 5, 'fleet': 2, 'logo': 3}
    idx.sort(key=lambda i: -(weight.get(CLIPS[i]['kind'], 1) * (CLIPS[i]['b'][1] - CLIPS[i]['b'][0])))
    with Pool(int(os.environ.get('JOBS', '4'))) as p:
        for out in p.imap_unordered(render_clip, idx):
            print('done', os.path.basename(out), flush=True)

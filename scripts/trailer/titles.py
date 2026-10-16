"""Kinetic typography for the trailer. All drawing happens in picture space
(1920 x 804, the 2.39:1 area) on float32 RGB images."""
import os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from edl import TITLES, BEAT

from paths import FONTS

PW, PH = 1920, 804
_fc = {}


def font(name, size):
    k = (name, int(size))
    if k not in _fc:
        path = name if os.path.isabs(name) else os.path.join(FONTS, name)
        _fc[k] = ImageFont.truetype(path, int(size))
    return _fc[k]


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def ease_out(x, p=3):
    x = np.clip(x, 0, 1)
    return 1 - (1 - x) ** p


def text_mask(text, fname, size, track=0.0, per_char=None):
    """Render text to an alpha mask (float32 0..1). track in em.
    per_char: optional list of (alpha, dy) per character for staggered reveals."""
    f = font(fname, size)
    asc, desc = f.getmetrics()
    widths = [f.getlength(ch) for ch in text]
    tw = sum(widths) + track * size * max(len(text) - 1, 0)
    pad = int(size * 0.5)
    w, h = int(np.ceil(tw)) + 2 * pad, asc + desc + 2 * pad
    im = Image.new('L', (w, h), 0)
    x = pad
    if per_char is None:
        d = ImageDraw.Draw(im)
        for ch, cw in zip(text, widths):
            d.text((x, pad), ch, font=f, fill=255)
            x += cw + track * size
    else:
        for (ch, cw), (a, dy) in zip(zip(text, widths), per_char):
            if a > 0.003 and ch != ' ':
                layer = Image.new('L', (w, h), 0)
                ImageDraw.Draw(layer).text((x, pad + dy), ch, font=f, fill=int(255 * min(a, 1)))
                im = Image.fromarray(np.maximum(np.asarray(im), np.asarray(layer)))
            x += cw + track * size
    m = np.asarray(im, np.float32) / 255.0
    # cap-height box for vertical centring
    return m, pad, asc


def place(img, mask, col, cx, cy, alpha=1.0, anchor='c', glow=0.0, blur=0.0, scale=1.0, cap=None):
    """Composite a mask onto img. (cx, cy) = anchor point in picture px; cy is the
    vertical centre of the cap height."""
    if alpha <= 0.002:
        return
    m = mask
    if scale != 1.0:
        m = cv2.resize(m, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    if blur > 0.05:
        m = cv2.GaussianBlur(m, (0, 0), blur)
    h, w = m.shape
    if anchor == 'c':
        x0 = int(round(cx - w / 2))
    elif anchor == 'l':
        x0 = int(round(cx))
    else:
        x0 = int(round(cx - w))
    y0 = int(round(cy - h / 2))
    a = m * alpha
    col = np.asarray(col, np.float32)
    if glow > 0:
        g = cv2.GaussianBlur(a, (0, 0), 14) * glow
        _blend_add(img, g, col * 0.9, x0, y0)
    _blend_over(img, a, col, x0, y0)


def _clip(img, a, x0, y0):
    H, W = img.shape[:2]
    h, w = a.shape
    xa, ya = max(x0, 0), max(y0, 0)
    xb, yb = min(x0 + w, W), min(y0 + h, H)
    if xb <= xa or yb <= ya:
        return None
    return (slice(ya, yb), slice(xa, xb)), a[ya - y0:yb - y0, xa - x0:xb - x0]


def _blend_over(img, a, col, x0, y0):
    r = _clip(img, a, x0, y0)
    if r is None:
        return
    sl, aa = r
    aa = aa[..., None]
    img[sl] = img[sl] * (1 - aa) + col * aa


def _blend_add(img, a, col, x0, y0):
    r = _clip(img, a, x0, y0)
    if r is None:
        return
    sl, aa = r
    img[sl] = img[sl] + aa[..., None] * col


def shade_under(img, cy, height, strength=0.35):
    """Soft horizontal darkening band behind text for legibility."""
    y = np.arange(PH, dtype=np.float32)
    band = np.exp(-((y - cy) / height) ** 2) * strength
    img *= (1 - band)[:, None, None]


_YY, _XX = np.mgrid[0:PH, 0:PW].astype(np.float32)
WHITE = (1.0, 1.0, 1.0)
ICE = (0.74, 0.88, 1.0)
CYAN = (0.45, 0.82, 1.0)


def draw_title(img, T, fr):
    """fr: frame index within the title (0..n-1)."""
    n = int(round((T['b'][1] - T['b'][0]) * BEAT))
    u = fr / max(n - 1, 1)
    st = T['style']
    text = T['text']
    if st == 'whisper':
        a = smooth(fr / 10) * (1 - smooth((fr - (n - 9)) / 8))
        tr = 0.55 + 0.12 * u
        m, _, _ = text_mask(text, 'Archivo-500-expanded.ttf', 30, tr)
        shade_under(img, PH * T.get('y', 0.45), 40, 0.35 * a)
        place(img, m, (0.95, 0.98, 1.0), PW / 2, PH * T.get('y', 0.45), a, glow=0.3)
    elif st == 'line':
        accent = T.get('accent', False)
        fname = 'Archivo-800-expanded.ttf' if accent else 'Archivo-300-expanded.ttf'
        size = 46 if accent else 44
        tr = 0.20 + 0.035 * u
        L = len(text)
        per = []
        stg = T.get('stagger', 0.55)
        for i in range(L):
            k = (fr - i * stg) / 9
            per.append((smooth(k), (1 - ease_out(k)) * 18))
        out = 1.0 if T.get('hold') else 1 - smooth((fr - (n - 9)) / 8)
        m, _, _ = text_mask(text, fname, size, tr, per)
        shade_under(img, PH * T.get('y', 0.5), 60, T.get('shade', 0.22) * out)
        place(img, m, WHITE if accent else (0.92, 0.96, 1.0), PW / 2, PH * T.get('y', 0.5), out,
              glow=0.25 if accent else 0.0, blur=(1 - out) * 4)
    elif st == 'slam':
        k = ease_out(fr / 5, 3)
        scale = 1.0 + 0.32 * (1 - k)
        blur = 9 * (1 - smooth(fr / 4))
        a = smooth(fr / 2.0)
        m, _, _ = text_mask(text, 'Archivo-900-expanded.ttf', 150, 0.06 + 0.04 * u)
        shade_under(img, PH * 0.5, 140, 0.30)
        if fr < 3:   # chromatic split on impact
            off = int(14 * (1 - fr / 3))
            place(img, m, (1.0, 0.2, 0.25), PW / 2 - off, PH * 0.5, a * 0.5, scale=scale, blur=blur)
            place(img, m, (0.2, 0.6, 1.0), PW / 2 + off, PH * 0.5, a * 0.5, scale=scale, blur=blur)
        place(img, m, WHITE, PW / 2, PH * 0.5, a, glow=0.5 * (1 - u) + 0.15, scale=scale, blur=blur)
    elif st == 'hero':
        kin = ease_out(fr / 14, 3)
        out = 1 - smooth((fr - (n - 10)) / 9)
        tr = 0.50 - 0.24 * kin + 0.04 * u
        a = smooth(fr / 8) * out
        blur = 7 * (1 - smooth(fr / 10)) + (1 - out) * 6
        m, _, _ = text_mask(text, 'Archivo-800-expanded.ttf', 68, tr)
        y = PH * T.get('y', 0.3)
        shade_under(img, y, 90, 0.25 * a)
        place(img, m, WHITE, PW / 2, y, a, glow=0.45, blur=blur)
        # hairline under the title
        lw = int(520 * ease_out((fr - 4) / 16) * out)
        if lw > 2:
            line = np.ones((2, lw), np.float32)
            place(img, line, CYAN, PW / 2, y + 56, a * 0.8, glow=0.8)
    elif st == 'stack':
        k = ease_out(fr / 6, 3)
        a = smooth(fr / 2.5)
        size = 104
        m, _, _ = text_mask(text, 'Archivo-900-expanded.ttf', size, 0.05)
        h, w = m.shape
        # left-to-right wipe
        wipe = int(w * k)
        mm = m.copy()
        mm[:, wipe:] = 0
        y = PH * 0.74
        shade_under(img, y, 110, 0.28 * a)
        if T.get('align') == 'right':
            tw = w - size          # mask width minus the two half-em pads
            x = PW - 110 - tw - 30 * (1 - k)
            place(img, mm, WHITE, x - int(size * 0.5), y, a, anchor='l', glow=0.2)
            bw = int(90 * k)
            if bw > 1:
                place(img, np.ones((5, bw), np.float32), CYAN, PW - 110 - bw, y - size * 0.72, a, anchor='l', glow=0.6)
        else:
            x = 110 + 30 * (1 - k)
            place(img, mm, WHITE, x - int(size * 0.5), y, a, anchor='l', glow=0.2)
            # accent bar above
            bw = int(90 * k)
            if bw > 1:
                place(img, np.ones((5, bw), np.float32), CYAN, 110, y - size * 0.72, a, anchor='l', glow=0.6)
    elif st == 'chip':
        k = ease_out(fr / 10, 3)
        out = 1 - smooth((fr - (n - 7)) / 6)
        a = smooth(fr / 4) * out
        x = 112
        y = PH * 0.80
        cx_ = np.exp(-((_XX - 260) / 520) ** 2)
        cy_ = np.exp(-((_YY - y) / 95) ** 2)
        img *= (1 - (0.55 * a) * (cx_ * cy_))[..., None]
        bh = int(96 * ease_out(fr / 7))
        if bh > 1:
            place(img, np.ones((bh, 4), np.float32), CYAN, x, y, a, anchor='l', glow=0.8)
        m, _, _ = text_mask(text, 'Archivo-800-expanded.ttf', 54, 0.30 + 0.05 * u)
        h, w = m.shape
        mm = m.copy()
        mm[:, int(w * k):] = 0
        place(img, mm, WHITE, x + 26 - int(27) + 40 * (1 - k), y - 18, a, anchor='l', glow=0.15)
        sub = T.get('sub', '')
        if sub:
            k2 = ease_out((fr - 5) / 10, 3)
            ms, _, _ = text_mask(sub, 'JetBrainsMono-500.ttf', 21, 0.10)
            h2, w2 = ms.shape
            ms = ms.copy()
            ms[:, int(w2 * k2):] = 0
            place(img, ms, ICE, x + 26 - 10, y + 30, a * 0.95, anchor='l')


def draw_titles(img, gframe):
    for T in TITLES:
        f0 = int(round(T['b'][0] * BEAT))
        f1 = int(round(T['b'][1] * BEAT))
        if f0 <= gframe < f1:
            draw_title(img, T, gframe - f0)

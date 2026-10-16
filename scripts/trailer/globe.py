"""Procedural 'live sky' globe for the trailer (intro and warp).

Orthographic globe: dot-matrix land, coastlines, night-side city lights and
animated great-circle flight trails. Renders the 2.39:1 picture area only
(1920 x 804), float32 RGB, roughly display-referred 0..1.
"""
import os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

from paths import FONTS, WORK

PW, PH = 1920, 804
CX, CY = PW / 2, PH / 2

_D = np.load(os.path.join(WORK, 'geo.npz'), allow_pickle=True)


def ll2v(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], -1)


DOTS = ll2v(_D['dots'][:, 0], _D['dots'][:, 1]).astype(np.float32)
COAST = [ll2v(c[:, 0], c[:, 1]).astype(np.float32) for c in _D['coast']]
CITY = _D['cities']
CITYV = ll2v(CITY[:, 0], CITY[:, 1]).astype(np.float32)
CITYS = np.clip((np.log10(CITY[:, 2]) - 5.6) / 1.8, 0.15, 1.0).astype(np.float32)

# routes: 64 samples along an elevated great circle
_rng = np.random.default_rng(21)
ROUTES = []
for a, b in _D['routes']:
    va, vb = CITYV[a].astype(np.float64), CITYV[b].astype(np.float64)
    om = np.arccos(np.clip(va @ vb, -1, 1))
    u = np.linspace(0, 1, 64)
    s = np.sin(om)
    p = (np.sin((1 - u) * om)[:, None] * va + np.sin(u * om)[:, None] * vb) / s
    h = 1 + (0.035 + 0.10 * om / np.pi) * np.sin(np.pi * u)
    ROUTES.append((p * h[:, None]).astype(np.float32))
ROUTES = np.stack(ROUTES)                      # (R, 64, 3)
NR = len(ROUTES)
R_PHASE = _rng.random(NR)
R_SPEED = 0.10 + 0.12 * _rng.random(NR)       # route-lengths per second
R_WARM = _rng.random(NR) < 0.12

SUN = np.array([0.62, 0.38, 0.69])
SUN /= np.linalg.norm(SUN)

# static background: deep space gradient + stars
_yy, _xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
_rr = np.sqrt(((_xx - CX) / PW) ** 2 + ((_yy - CY) / PW) ** 2)
BG = np.stack([0.010 + 0.020 * np.exp(-_rr * 3.0), 0.016 + 0.030 * np.exp(-_rr * 3.0),
               0.030 + 0.050 * np.exp(-_rr * 3.0)], -1).astype(np.float32)
_srng = np.random.default_rng(8)
NS = 900
STAR_XY = np.stack([_srng.uniform(0, PW, NS), _srng.uniform(0, PH, NS)], -1)
STAR_B = (_srng.random(NS) ** 3) * 0.9 + 0.04
STAR_TW = _srng.uniform(0.5, 3.0, NS)


def rot(lon0, lat0):
    lo, la = np.radians(lon0), np.radians(lat0)
    ry = np.array([[np.cos(-lo), 0, np.sin(-lo)], [0, 1, 0], [-np.sin(-lo), 0, np.cos(-lo)]])
    rx = np.array([[1, 0, 0], [0, np.cos(la), -np.sin(la)], [0, np.sin(la), np.cos(la)]])
    return (rx @ ry).astype(np.float32)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def splat(img, xs, ys, cols):
    """Bilinear point splat (additive). cols: (n,3)."""
    h, w = img.shape[:2]
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    fx, fy = xs - x0, ys - y0
    for dx, dy, wt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi, yi = x0 + dx, y0 + dy
        m = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        for c in range(3):
            np.add.at(img[:, :, c], (yi[m], xi[m]), cols[m, c] * wt[m])


_font_cache = {}


def font(name, size):
    k = (name, size)
    if k not in _font_cache:
        _font_cache[k] = ImageFont.truetype(os.path.join(FONTS, name), size)
    return _font_cache[k]


def draw_text(img, text, x, y, fname, size, col, alpha=1.0, track=0.0, anchor='l'):
    """Draw small tracked text onto float img (additive-over)."""
    f = font(fname, size)
    widths = [f.getlength(ch) for ch in text]
    tw = sum(widths) + track * size * (len(text) - 1)
    pad = 4
    im = Image.new('L', (int(tw) + 2 * pad, size * 2), 0)
    d = ImageDraw.Draw(im)
    cx = pad
    for ch, wch in zip(text, widths):
        d.text((cx, size * 0.3), ch, font=f, fill=255)
        cx += wch + track * size
    a = np.asarray(im, np.float32) / 255 * alpha
    if anchor == 'c':
        x = x - im.width / 2
    elif anchor == 'r':
        x = x - im.width
    x, y = int(round(x)), int(round(y - size * 0.3 - size * 0.5))
    h, w = a.shape
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, PW), min(y + h, PH)
    if x1 <= x0 or y1 <= y0:
        return
    aa = a[y0 - y:y1 - y, x0 - x:x1 - x, None]
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - aa) + np.array(col, np.float32) * aa


def render_globe(t, R, lon0, lat0, active=1.0, fade=1.0, hud=1.0, lock=None):
    M = rot(lon0, lat0)
    img = BG.copy()
    # stars (parallax-free, twinkle)
    sb = STAR_B * (0.75 + 0.25 * np.sin(t * STAR_TW * 2 + STAR_TW * 10))
    star = np.zeros((PH, PW, 3), np.float32)
    splat(star, STAR_XY[:, 0], STAR_XY[:, 1], np.stack([sb * 0.85, sb * 0.92, sb], -1))
    img += cv2.GaussianBlur(star, (0, 0), 0.6) * 1.6

    # ---- sphere shading (per pixel)
    x = (_xx - CX) / R
    y = (CY - _yy) / R
    r2 = x * x + y * y
    inside = r2 < 1
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    lam = x * SUN[0] + y * SUN[1] + z * SUN[2]
    day = smooth((lam + 0.15) / 0.6)
    ocean_n = np.array([0.006, 0.014, 0.028], np.float32)
    ocean_d = np.array([0.020, 0.060, 0.115], np.float32)
    base = ocean_n + (ocean_d - ocean_n) * day[..., None]
    hx, hy, hz = SUN + np.array([0, 0, 1.0])
    hn = np.sqrt(hx * hx + hy * hy + hz * hz)
    spec = np.clip((x * hx + y * hy + z * hz) / hn, 0, 1) ** 400 * 0.10
    fres = (1 - z) ** 3
    rim = np.array([0.20, 0.55, 1.0], np.float32)
    sphere = base + spec[..., None] * np.array([0.7, 0.85, 1.0]) + fres[..., None] * rim * (0.25 + 0.6 * day[..., None])
    rr = np.sqrt(r2)
    halo_w = 0.045 + 18.0 / R
    halo = np.exp(-np.clip(rr - 1, 0, None) / halo_w) * (rr >= 1)
    halo_col = rim * (0.35 + 0.55 * smooth((x * SUN[0] + y * SUN[1]) / max(rr.max(), 1e-3) + 0.5)[..., None])
    edge = smooth((1 - rr) * R / 1.5)          # anti-aliased limb
    img = img * (1 - edge[..., None]) + sphere * edge[..., None]
    img += halo[..., None] * halo_col * 0.75

    # ---- land dots
    cam = DOTS @ M.T
    vis = cam[:, 2] > 0.02
    c = cam[vis]
    sx = CX + R * c[:, 0]
    sy = CY - R * c[:, 1]
    on = (sx > -20) & (sx < PW + 20) & (sy > -20) & (sy < PH + 20)
    c, sx, sy = c[on], sx[on], sy[on]
    l = c @ SUN
    dl = smooth((l + 0.12) / 0.5)
    limb = smooth(c[:, 2] / 0.35)
    col_d = np.array([0.50, 0.80, 1.05], np.float32)
    col_n = np.array([0.08, 0.15, 0.26], np.float32)
    cols = (col_n + (col_d - col_n) * dl[:, None]) * limb[:, None] * float(np.clip(1.3 - R / 2500, 0.0, 1.0))
    dots = np.zeros((PH, PW, 3), np.float32)
    if R < 900:
        splat(dots, sx, sy, cols * 1.1)
        dots = cv2.GaussianBlur(dots, (0, 0), 0.55 + R / 1400) * (1.4 + R / 700)
    else:
        rad = max(1, int(R * 0.0042))
        for xx, yy, cc in zip(sx, sy, cols):
            cv2.circle(dots, (int(xx * 4), int(yy * 4)), rad * 4, tuple(float(v) for v in cc), -1, cv2.LINE_AA, 2)
    img += dots

    # ---- coastlines
    coast = np.zeros((PH, PW, 3), np.float32)
    th = 1 if R < 900 else 2
    for cl in COAST:
        cc = cl @ M.T
        v = cc[:, 2] > 0.03
        if not v.any():
            continue
        pts = np.stack([CX + R * cc[:, 0], CY - R * cc[:, 1]], -1)
        # split into visible runs
        idx = np.flatnonzero(np.diff(np.concatenate([[0], v.astype(np.int8), [0]])))
        for s0, s1 in zip(idx[::2], idx[1::2]):
            if s1 - s0 < 2:
                continue
            p = pts[s0:s1]
            if (p[:, 0].max() < 0) or (p[:, 0].min() > PW) or (p[:, 1].max() < 0) or (p[:, 1].min() > PH):
                continue
            seg_l = cc[s0:s1] @ SUN
            g = float(0.10 + 0.22 * smooth((seg_l.mean() + 0.1) / 0.5))
            cv2.polylines(coast, [(p * 4).astype(np.int32)], False, (g * 0.55, g * 0.85, g * 1.1), th, cv2.LINE_AA, 2)
    img += coast

    # ---- night-side city lights + flight trails (glow layer)
    glow = np.zeros((PH, PW, 3), np.float32)
    cc = CITYV @ M.T
    l = cc @ SUN
    m = (cc[:, 2] > 0.05) & (l < 0.12)
    if m.any():
        night = smooth((0.12 - l[m]) / 0.25) * CITYS[m] * smooth(cc[m, 2] / 0.3)
        splat(glow, CX + R * cc[m, 0], CY - R * cc[m, 1],
              np.stack([night * 1.0, night * 0.62, night * 0.25], -1) * 5.0)
    n_act = int(NR * np.clip(active, 0, 1))
    if n_act > 0:
        lw = 1 if R < 900 else 2
        heads = []
        for i in range(n_act):
            P = ROUTES[i] @ M.T
            u = (R_PHASE[i] + t * R_SPEED[i]) % 1.6
            if u > 1.3:
                continue
            k1 = int(min(u, 1.0) * 63)
            k0 = int(max(u - 0.35, 0) * 63)
            if k1 - k0 < 1:
                continue
            seg = P[k0:k1 + 1]
            rxy = np.sqrt(seg[:, 0] ** 2 + seg[:, 1] ** 2)
            vis = (seg[:, 2] > 0) | (rxy > 1.0)
            pts = np.stack([CX + R * seg[:, 0], CY - R * seg[:, 1]], -1)
            warm = R_WARM[i]
            base_c = np.array([1.0, 0.72, 0.38]) if warm else np.array([0.45, 0.85, 1.0])
            nseg = len(pts) - 1
            for j in range(nseg):
                if not (vis[j] and vis[j + 1]):
                    continue
                a = ((j + 1) / nseg) ** 1.5 * 1.15
                c = tuple(float(v) for v in base_c * a)
                cv2.line(glow, (int(pts[j, 0] * 4), int(pts[j, 1] * 4)), (int(pts[j + 1, 0] * 4), int(pts[j + 1, 1] * 4)),
                         c, lw, cv2.LINE_AA, 2)
            if u <= 1.0 and vis[-1]:
                heads.append((pts[-1, 0], pts[-1, 1], warm))
        if heads:
            hx_ = np.array([h[0] for h in heads])
            hy_ = np.array([h[1] for h in heads])
            hc = np.array([[1.0, 0.85, 0.6] if h[2] else [0.85, 0.97, 1.0] for h in heads]) * 3.2
            splat(glow, hx_, hy_, hc)
    glow *= fade
    g1 = cv2.GaussianBlur(glow, (0, 0), 1.0)
    g2 = cv2.GaussianBlur(glow, (0, 0), 5.0)
    g3 = cv2.GaussianBlur(glow, (0, 0), 16.0)
    img += g1 * 1.3 + g2 * 1.3 + g3 * 0.9

    # ---- HUD ring
    if hud > 0 and R < 1400:
        ring = np.zeros((PH, PW, 3), np.float32)
        rr_ = R * 1.13
        a = 0.18 * hud
        cv2.circle(ring, (int(CX * 4), int(CY * 4)), int(rr_ * 4), (a * 0.5, a * 0.8, a), 1, cv2.LINE_AA, 2)
        for k in range(120):
            ang = np.radians(k * 3 + t * 6)
            r0 = rr_ + (10 if k % 10 == 0 else 4)
            p0 = (CX + rr_ * np.cos(ang), CY + rr_ * np.sin(ang))
            p1 = (CX + r0 * np.cos(ang), CY + r0 * np.sin(ang))
            cv2.line(ring, (int(p0[0] * 4), int(p0[1] * 4)), (int(p1[0] * 4), int(p1[1] * 4)),
                     (a * 0.5, a * 0.8, a), 1, cv2.LINE_AA, 2)
        # sweep arc
        sw0 = (t * 70) % 360
        cv2.ellipse(ring, (int(CX * 4), int(CY * 4)), (int(rr_ * 4), int(rr_ * 4)), 0, sw0, sw0 + 40,
                    (a * 1.2, a * 2.4, a * 3.2), 2, cv2.LINE_AA, 2)
        img += cv2.GaussianBlur(ring, (0, 0), 0.6) * 1.3

    # ---- lock-on reticle
    if lock is not None:
        lon_l, lat_l, k, label, sub = lock
        v = ll2v(lon_l, lat_l) @ M.T
        if v[2] > 0:
            px_, py_ = CX + R * v[0], CY - R * v[1]
            ret = np.zeros((PH, PW, 3), np.float32)
            e = smooth(k)
            rad = 90 - 62 * e
            col = (0.55 * e + 0.2, 0.9 * e + 0.2, 1.0)
            cv2.circle(ret, (int(px_ * 4), int(py_ * 4)), int(rad * 4), col, 2, cv2.LINE_AA, 2)
            cv2.circle(ret, (int(px_ * 4), int(py_ * 4)), int(4 * 4), (1, 1, 1), -1, cv2.LINE_AA, 2)
            br = rad + 14
            for sxn, syn in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                cx_, cy_ = px_ + sxn * br, py_ + syn * br
                cv2.line(ret, (int(cx_ * 4), int(cy_ * 4)), (int((cx_ - sxn * 14) * 4), int(cy_ * 4)), col, 2, cv2.LINE_AA, 2)
                cv2.line(ret, (int(cx_ * 4), int(cy_ * 4)), (int(cx_ * 4), int((cy_ - syn * 14) * 4)), col, 2, cv2.LINE_AA, 2)
            for d0, d1 in ((rad + 4, rad + 40),):
                for ang in (0, 90, 180, 270):
                    ca, sa = np.cos(np.radians(ang)), np.sin(np.radians(ang))
                    cv2.line(ret, (int((px_ + ca * d0) * 4), int((py_ + sa * d0) * 4)),
                             (int((px_ + ca * d1) * 4), int((py_ + sa * d1) * 4)), (0.5, 0.8, 1.0), 1, cv2.LINE_AA, 2)
            img += ret * 1.2 + cv2.GaussianBlur(ret, (0, 0), 6) * 1.2
            if e > 0.6:
                al = smooth((e - 0.6) / 0.3)
                draw_text(img, label, px_ + br + 30, py_ - 14, 'Archivo-800-expanded.ttf', 34, (1, 1, 1), al, 0.3)
                draw_text(img, sub, px_ + br + 30, py_ + 26, 'JetBrainsMono-500.ttf', 21, (0.7, 0.9, 1.0), al, 0.1)
    return img * fade


def zoom_blur(img, amount, n=22):
    if amount <= 0.002:
        return img
    img = cv2.GaussianBlur(img, (0, 0), 1.2)
    acc = img.copy()
    for k in range(1, n):
        s = 1 + amount * k / n
        M = np.array([[s, 0, CX * (1 - s)], [0, s, CY * (1 - s)]], np.float32)
        acc += cv2.warpAffine(img, M, (PW, PH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return acc / n


NYC = (-74.0, 40.7)
PARIS = (2.35, 48.86)


def ease_io(x):
    x = np.clip(x, 0, 1)
    return np.where(x < 0.5, 4 * x ** 3, 1 - (-2 * x + 2) ** 3 / 2)


def intro_frame(b):
    """b: beats since clip start (0..16)."""
    t = b * 14 / 30
    fade = smooth(b / 2.5)
    if b < 12:
        R = 300 + 95 * smooth(b / 12)
        lon0 = -100 + 26 * (b / 12)
        lat0 = 22 + 8 * smooth(b / 12)
    else:
        u = (b - 12) / 4
        R = 395 * 55 ** (u ** 2.4)
        k = smooth(u / 0.7)
        lon0 = (-100 + 26) * (1 - k) + NYC[0] * k
        lat0 = 30 * (1 - k) + NYC[1] * k
    active = smooth((b - 1.0) / 8)
    hud = smooth((b - 2) / 3) * (1 - smooth((b - 12) / 1.5))
    sub = 3 if b > 12.5 else 1
    acc = None
    for s in range(sub):
        img = render_globe(t + s * 0.02, R if s == 0 else R * (1 + 0.04 * s), lon0, lat0, active, fade, hud)
        acc = img if acc is None else acc + img
    img = acc / sub
    if b > 12:
        img = zoom_blur(img, 0.35 * smooth((b - 12.5) / 3.3))
    # white flash into the next shot
    fl = smooth((b - 15.2) / 0.8)
    img = img * (1 - fl) + fl * 1.6
    return img


def warp_frame(b):
    """b: beats since clip start (0..8)."""
    t = 30 + b * 14 / 30
    k = ease_io(b / 3.6)
    lon0 = -115 + (PARIS[0] + 115) * k
    lat0 = 40 + (PARIS[1] - 40) * k
    R = 330 + 60 * smooth(b / 4)
    if b > 5.8:
        u = (b - 5.8) / 2.2
        R = 390 * 60 ** (u ** 2.3)
    fade = smooth((b + 0.4) / 0.8)
    lock_k = (b - 3.4) / 1.6
    lock = (PARIS[0], PARIS[1], lock_k, 'PARIS', '48.8566° N   2.3522° E') if b > 3.4 else None
    # spin motion blur: temporal supersampling while fast
    speed = abs(ease_io((b + 0.05) / 3.6) - ease_io((b - 0.05) / 3.6))
    sub = 1 + int(min(speed * 140, 9))
    acc = None
    for s in range(sub):
        db_ = (s - (sub - 1) / 2) * 0.1 / max(sub - 1, 1)
        kk = ease_io((b + db_) / 3.6)
        img = render_globe(t, R, -115 + (PARIS[0] + 115) * kk, 40 + (PARIS[1] - 40) * kk, 1.0, fade,
                           hud=1 - smooth((b - 5.8) / 1.0), lock=lock)
        acc = img if acc is None else acc + img
    img = acc / sub
    if b > 5.8:
        img = zoom_blur(img, 0.4 * smooth((b - 6.0) / 1.8))
    fl = smooth((b - 7.3) / 0.7)
    img = img * (1 - fl) + fl * 1.6
    return img


if __name__ == '__main__':
    import sys
    import time
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, fn, bs in (('intro', intro_frame, [0.5, 2, 5, 8, 11, 12.8, 13.8, 14.8]),
                         ('warp', warp_frame, [0.2, 1.5, 3.0, 4.2, 5.2, 6.2, 7.0])):
        for b in bs:
            t0 = time.time()
            img = fn(b)
            cv2.imwrite(os.path.join(out, f'{name}_{b:05.2f}.png'),
                        (np.clip(img[..., ::-1], 0, 1) ** (1 / 1.0) * 255).astype(np.uint8))
            print(name, b, f'{time.time() - t0:.2f}s')

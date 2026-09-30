#!/usr/bin/env python3
"""Contact sheets for the trailer title review loop.

usage: contact.py <review_dir>
Reads <review_dir>/plan.json + raw/<slug>/<label>.png (RGBA from titles.cjs)
and writes, per card:
  <review_dir>/<slug>__sheet.png   5 moments x {bright sky, dark city} at 1/3 scale
  <review_dir>/<slug>__detail.png  1:1 crop of the 'landed' frame over both plates
End card: <review_dir>/<slug>__sheet.png (all stills) + full-res stills.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CITY_SRC = os.path.join(REPO, 'scripts', 'r16-satnight-02-manhattan-night-after-ab.png')
NOON_SRC = os.path.join(REPO, 'scripts', 'r16-satnight-03-manhattan-noon.png')


def sky_plate():
    """Bright daytime sky: deep-ish blue zenith -> hazy near-white horizon,
    with a hot sun bloom - the harshest plate a white title will ever sit on."""
    im = Image.new('RGB', (W, H))
    px = im.load()
    top, mid, bot = (88, 142, 212), (200, 222, 244), (238, 243, 249)
    for y in range(H):
        k = y / (H - 1)
        if k < 0.62:
            u = k / 0.62
            c = [int(top[i] + (mid[i] - top[i]) * (u ** 1.2)) for i in range(3)]
        else:
            u = (k - 0.62) / 0.38
            c = [int(mid[i] + (bot[i] - mid[i]) * u) for i in range(3)]
        for x in range(W):
            px[x, y] = tuple(c)
    # soft cloud banks + a sun bloom
    over = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(over)
    for (cx, cy, rx, ry, a) in [(300, 700, 520, 90, 170), (1500, 640, 640, 110, 190), (980, 820, 900, 120, 200),
                                (1200, 300, 300, 50, 90), (500, 380, 260, 40, 80)]:
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=a)
    over = over.filter(ImageFilter.GaussianBlur(60))
    white = Image.new('RGB', (W, H), (250, 251, 253))
    im = Image.composite(white, im, over)
    sun = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sun).ellipse([1260, 260, 1500, 500], fill=255)
    sun = sun.filter(ImageFilter.GaussianBlur(90))
    im = Image.composite(Image.new('RGB', (W, H), (255, 252, 240)), im, sun)
    return im


def load_plate(path):
    im = Image.open(path).convert('RGB')
    return im.resize((W, H), Image.LANCZOS)


def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf']:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def comp(plate, rgba):
    base = plate.convert('RGBA')
    return Image.alpha_composite(base, rgba.convert('RGBA')).convert('RGB')


def main(review):
    plan = json.load(open(os.path.join(review, 'plan.json')))
    cache = os.path.join(review, '_plates')
    os.makedirs(cache, exist_ok=True)
    sp = os.path.join(cache, 'sky.png')
    if not os.path.exists(sp):
        sky_plate().save(sp)
    plates = {'bright sky': Image.open(sp).convert('RGB'), 'dark city': load_plate(CITY_SRC)}
    f24 = font(22)
    scale = 3
    tw, th = W // scale, H // scale
    for card in plan:
        raw = os.path.join(review, 'raw', card['slug'])
        shots = card['shots']
        if not card['alpha']:
            cols = 3
            rows = (len(shots) + cols - 1) // cols
            sheet = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 40) + 8), (20, 20, 24))
            d = ImageDraw.Draw(sheet)
            for i, s in enumerate(shots):
                im = Image.open(os.path.join(raw, s['label'] + '.png')).convert('RGB')
                x = 8 + (i % cols) * (tw + 8)
                y = 8 + (i // cols) * (th + 40)
                sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 32))
                d.text((x, y + 4), f"{s['label']}  t={s['t']:.3f}", fill=(200, 200, 210), font=f24)
            sheet.save(os.path.join(review, card['slug'] + '__sheet.png'))
            continue
        names = list(plates.keys())
        sheet = Image.new('RGB', (5 * (tw + 8) + 8, len(names) * (th + 8) + 48), (20, 20, 24))
        d = ImageDraw.Draw(sheet)
        d.text((10, 10), f"{card['slug']}  [{card['kind']}]  {card['text']}", fill=(230, 230, 235), font=f24)
        landed = None
        for j, pname in enumerate(names):
            for i, s in enumerate(shots):
                rgba = Image.open(os.path.join(raw, s['label'] + '.png'))
                if s['label'].startswith('2') and landed is None:
                    landed = rgba
                im = comp(plates[pname], rgba).resize((tw, th), Image.LANCZOS)
                x = 8 + i * (tw + 8)
                y = 48 + j * (th + 8)
                sheet.paste(im, (x, y))
                if j == 0:
                    d.text((x + 6, y + 4), f"{s['label']} {s['t']:.2f}", fill=(20, 30, 60), font=f24)
        sheet.save(os.path.join(review, card['slug'] + '__sheet.png'))
        # 1:1 detail crop of the landed (or mid) frame
        mid = Image.open(os.path.join(raw, '3-mid.png'))
        bbox = mid.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
        if bbox:
            pad = 50
            box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad))
            crops = [comp(plates[p], mid).crop(box) for p in names]
            cw, ch = crops[0].size
            det = Image.new('RGB', (cw, ch * len(crops) + 8 * (len(crops) - 1)), (20, 20, 24))
            for k, c in enumerate(crops):
                det.paste(c, (0, k * (ch + 8)))
            det.save(os.path.join(review, card['slug'] + '__detail.png'))
    # one-page overview: the first card of each style, landed + mid, both plates
    firsts, seen = [], set()
    for card in plan:
        if card['alpha'] and card['kind'] not in seen:
            seen.add(card['kind'])
            firsts.append(card)
    if firsts:
        ov = Image.new('RGB', (4 * (tw + 8) + 8, len(firsts) * (th + 40) + 8), (20, 20, 24))
        d = ImageDraw.Draw(ov)
        for r, card in enumerate(firsts):
            raw = os.path.join(review, 'raw', card['slug'])
            y = 8 + r * (th + 40)
            d.text((10, y + 4), f"{card['kind']}: {card['text']}", fill=(230, 230, 235), font=f24)
            for c, (lab, pname) in enumerate([('2-landed', 'bright sky'), ('2-landed', 'dark city'), ('3-mid', 'bright sky'), ('3-mid', 'dark city')]):
                rgba = Image.open(os.path.join(raw, lab + '.png'))
                ov.paste(comp(plates[pname], rgba).resize((tw, th), Image.LANCZOS), (8 + c * (tw + 8), y + 32))
        ov.save(os.path.join(review, '00_overview.png'))
    print('contact sheets ->', review)


if __name__ == '__main__':
    main(sys.argv[1])

#!/usr/bin/env python3
"""Shape title strings with HarfBuzz and export glyph outlines for titles.html.

Why: Chrome rasterises TEXT with its glyph origins and baselines snapped to
the pixel grid, so a slow scale push / tracking drift on live text steps in
~0.3-1 px ticks (measured). The trailer's cards are drawn instead as SVG
geometry (glyph outlines placed at HarfBuzz positions, the same shaper Chrome
uses), which Skia anti-aliases analytically at any sub-pixel transform: the
motion is continuous and every frame is a pure function of t.

usage: shape.py <request.json> <out.json>
request: {"fonts": {key: {"file": path, "variations": {...}}}, "strings": [[key, text], ...]}
out:     {"fonts": {key: {"upm", "capHeight", "ascender", "descender"}},
          "strings": {"key|text": {"adv": units, "glyphs": [[gid, x, y], ...]}},
          "outlines": {key: {gid: "svg path d (font units, y-up)"}}}
Needs: pip install uharfbuzz brotli (brotli only to read .woff2).
"""
import io
import json
import sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

# Chrome turns these off whenever letter-spacing != 0 (all our cards are tracked)
FEATURES = {'liga': False, 'clig': False, 'dlig': False, 'hlig': False, 'calt': False, 'kern': True}


def load(spec):
    tt = TTFont(spec['file'])
    tt.flavor = None
    buf = io.BytesIO()
    tt.save(buf)
    face = hb.Face(buf.getvalue())
    font = hb.Font(face)
    if spec.get('variations'):
        font.set_variations(spec['variations'])
    os2 = tt['OS/2']
    meta = {
        'upm': face.upem,
        'capHeight': getattr(os2, 'sCapHeight', 0) or int(face.upem * 0.7),
        'ascender': tt['hhea'].ascent,
        'descender': tt['hhea'].descent,
    }
    return font, meta


def main(req_path, out_path):
    req = json.load(open(req_path))
    fonts, meta = {}, {}
    for key, spec in req['fonts'].items():
        fonts[key], meta[key] = load(spec)
    strings, used = {}, {k: set() for k in fonts}
    for key, text in req['strings']:
        font = fonts[key]
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(font, buf, FEATURES)
        x = 0
        glyphs = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            glyphs.append([info.codepoint, x + pos.x_offset, pos.y_offset])
            used[key].add(info.codepoint)
            x += pos.x_advance
        strings[key + '|' + text] = {'adv': x, 'glyphs': glyphs}
    outlines = {}
    for key, gids in used.items():
        o = {}
        for gid in sorted(gids):
            pen = SVGPathPen(None)
            fonts[key].draw_glyph_with_pen(gid, pen)
            o[str(gid)] = pen.getCommands()
        outlines[key] = o
    json.dump({'fonts': meta, 'strings': strings, 'outlines': outlines}, open(out_path, 'w'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

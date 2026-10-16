"""Contact sheet of the rendered segments at given global beats."""
import sys, os, glob, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from edl import CLIPS, BEAT
from paths import SEG
beats = [float(x) for x in sys.argv[2:]]
out = sys.argv[1]
tiles = []
for b in beats:
    g = int(round(b * BEAT))
    for ci, c in enumerate(CLIPS):
        f0, f1 = int(round(c['b'][0] * BEAT)), int(round(c['b'][1] * BEAT))
        if f0 <= g < f1:
            seg = os.path.join(SEG, f'{ci:02d}_{c["id"]}.mkv')
            k = g - f0
            r = subprocess.run(['ffmpeg', '-v', 'error', '-i', seg, '-vf', f'select=eq(n\\,{k})', '-frames:v', '1',
                                '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
            if len(r.stdout) == 1920 * 1080 * 3:
                tiles.append((b, Image.frombytes('RGB', (1920, 1080), r.stdout)))
            break
cols = 2
W = 960
sheet = Image.new('RGB', (cols * W, ((len(tiles) + cols - 1) // cols) * 540))
d = ImageDraw.Draw(sheet)
fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
for i, (b, im) in enumerate(tiles):
    x, y = (i % cols) * W, (i // cols) * 540
    sheet.paste(im.resize((W, 540)), (x, y))
    d.text((x + 6, y + 4), f'b{b}', fill='yellow', font=fnt)
sheet.save(out)

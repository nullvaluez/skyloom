"""Concatenate rendered segments, loudness-normalise the score, mux the master.
Usage: python3 assemble.py score.wav out.mp4"""
import json
import os
import re
import subprocess
import sys
from edl import CLIPS, TOTAL_FRAMES, FPS

from paths import SEG

score, out = sys.argv[1], sys.argv[2]
segs = [os.path.join(SEG, f'{i:02d}_{c["id"]}.mkv') for i, c in enumerate(CLIPS)]
missing = [s for s in segs if not os.path.exists(s)]
assert not missing, missing
lst = os.path.join(SEG, 'concat.txt')
with open(lst, 'w') as f:
    for s in segs:
        f.write(f"file '{s}'\n")

# two-pass EBU R128 normalisation to -14 LUFS / -1 dBTP
p = subprocess.run(['ffmpeg', '-hide_banner', '-i', score, '-af',
                    'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json', '-f', 'null', '-'],
                   capture_output=True, text=True)
m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', p.stderr).group(0))
af = (f"loudnorm=I=-14:TP=-1.0:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
      f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,"
      f"aresample=48000")
dur = TOTAL_FRAMES / FPS
cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', score,
       '-map', '0:v', '-map', '1:a', '-af', af, '-t', f'{dur:.4f}',
       # segments are untagged (BT.601 matrix from swscale's default); go through RGB to a BT.709 master
       '-vf', 'scale=in_color_matrix=bt601:flags=accurate_rnd+full_chroma_int,format=rgb24,'
              'scale=out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '10M', '-bufsize', '20M',
       '-tune', 'film', '-profile:v', 'high',
       '-pix_fmt', 'yuv420p', '-g', '60', '-color_primaries', 'bt709', '-color_trc', 'bt709',
       '-colorspace', 'bt709', '-color_range', 'tv',
       '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', out]
subprocess.run(cmd, check=True)
print('wrote', out)

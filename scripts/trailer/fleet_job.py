import json, math, os
from edl import FLEET, BEAT
from paths import FLEET_FRAMES as OUT, WORK
os.makedirs(OUT, exist_ok=True)
SIZES = {  # bbox x (span), y, z (length) from the probe render
    'vector-hero-v4': (17.8, 4.66, 18.9), 'concorde-hero-v3': (25.56, 10.93, 62.29),
    'mustang-hero-v3': (11.58, 3.68, 10.0), 'f35-hero-v3': (10.7, 4.02, 15.7),
    'c17-hero-v3': (51.75, 14.92, 53.45), 'whisper-hero-v3': (19.26, 1.44, 8.0),
    'umbra-hero-v3': (44.0, 2.9, 18.0),
}
PI = math.pi
SHOTS = {
    #        az0,        az1,        el0,   el1,  fill, roll0, roll1, keyAz0, keyAz1
    'low34':   (PI - 0.58, PI - 0.40, -0.20, -0.14, 0.90, 0.0, 0.0, 2.2, 3.2),
    'side':    (PI / 2 + 0.10, PI / 2 - 0.06, 0.05, 0.04, 0.92, 0.0, 0.0, 1.0, 2.4),
    'front34': (PI + 0.75, PI + 0.55, 0.14, 0.10, 0.80, 0.0, 0.0, 3.6, 2.6),
    'top':     (0.0, 0.0, 1.22, 1.22, 0.56, 0.0, 0.0, 0.5, 1.8),
    'wing':    (0.62, 0.42, 0.30, 0.24, 0.80, 0.0, 0.0, 0.6, 1.8),
    'hero':    (PI, PI, 0.20, 0.13, 0.86, 0.0, 0.0, 4.4, 2.0),
}
frames = []
for i, a in enumerate(FLEET):
    n = int(round((a['b'][1] - a['b'][0]) * BEAT))
    sx, sy, sz = SIZES[a['model']]
    az0, az1, el0, el1, fill, r0, r1, k0, k1 = SHOTS[a['shot']]
    for k in range(n):
        u = k / max(n - 1, 1)
        az = az0 + (az1 - az0) * u
        el = el0 + (el1 - el0) * u
        # projected half-width of the bbox for this view (rough)
        half = 0.5 * max(abs(sx * math.cos(az)) + abs(sz * math.sin(az)), sx if el > 1 else 0, 1e-3)
        if a['shot'] == 'top':
            half = 0.5 * max(sx, sz * 1.78)
        hfov = 2 * math.atan(math.tan(math.radians(15)) * 16 / 9)
        d = half / math.tan(hfov / 2) / fill
        d *= 1.0 - 0.07 * u             # slow push-in
        if a['shot'] == 'hero':
            d *= 1.0 - 0.10 * u
        frames.append(dict(url=f"/public/models/player-{a['model']}.glb", az=az, el=el, dist=d, fov=30,
                           keyAz=k0 + (k1 - k0) * u, keyEl=0.55, keyI=4.0,
                           rimAz=az + PI + 0.5, rimEl=0.35, rimI=8.0,
                           rim2Az=az + PI - 0.9, rim2El=0.1, rim2I=3.0,
                           envI=0.12 if 'umbra' in a['model'] else 0.2,
                           exposure=0.95 if 'umbra' in a['model'] else 1.0,
                           out=os.path.join(OUT, f'{i:02d}_{k:03d}.png')))
json.dump(dict(frames=frames), open(os.path.join(WORK, 'fleet_job.json'), 'w'))
print(len(frames), 'frames')

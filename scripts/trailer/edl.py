"""Skyloom trailer v2 — edit decision list.

Everything is on one grid: 30 fps, 14 frames per beat (128.571 BPM), 4 beats
per bar. Clip and title times are in BEATS; source times are seconds into the
reference trailer (skyloom-trailer-final-1080p). Only caption-free source
windows are used (measured by textscore.py).
"""
FPS = 30
BEAT = 14                      # frames per beat
BPM = FPS * 60 / BEAT          # 128.571...
SPB = BEAT / FPS               # seconds per beat (0.4667)
TOTAL_BEATS = 155
TOTAL_FRAMES = TOTAL_BEATS * BEAT

def f(beats):
    return int(round(beats * BEAT))

# framing: z = zoom (>=1), cy = vertical centre of the 2.39 window in source
# active-picture rows (0..960, default 480), cx default 960. push = extra zoom
# reached by the end of the clip (slow push-in), punch = beat-hit zoom kick.
CLIPS = [
    # ---- INTRO: live globe -------------------------------------------------
    dict(id='globe_intro', kind='globe', b=(0, 16), mode='intro'),
    # ---- BUILD A -----------------------------------------------------------
    dict(id='Z_stealth',   kind='src', b=(16, 20), src=(86.27, 88.0), cy=545, push=0.05, fx=['flash_in']),
    dict(id='G_sydney',    kind='src', b=(20, 24), src=(23.25, 24.97), push=0.05),
    dict(id='E_coast',     kind='src', b=(24, 26), src=(19.25, 19.97), push=0.04),
    dict(id='C_gov',       kind='src', b=(26, 28), src=(12.0, 13.0), push=0.04),
    dict(id='A_real',      kind='src', b=(28, 29), src=(7.57, 7.93), cy=420, punch=0.06),
    dict(id='I_live',      kind='src', b=(29, 30), src=(28.27, 28.6), punch=0.06),
    dict(id='AB_yours',    kind='src', b=(30, 32), src=(89.13, 90.0), punch=0.06, fx=['ramp_out']),
    # ---- DROP 1 ------------------------------------------------------------
    dict(id='B_harbor',    kind='src', b=(32, 40), src=(8.3, 12.0), push=0.07, fx=['flash_in']),
    dict(id='H_water',     kind='src', b=(40, 44), src=(25.3, 27.5), push=0.04),
    dict(id='F_palm',      kind='src', b=(44, 46), src=(20.0, 20.43), push=0.04),
    dict(id='AA_peak',     kind='src', b=(46, 48), src=(88.1, 89.0), push=0.04),
    dict(id='AC_canyon',   kind='src', b=(48, 50), src=(90.03, 91.0), push=0.05),
    dict(id='J2_burner',   kind='src', b=(50, 52), src=(37.0, 37.95), push=0.04),
    dict(id='O_trails',    kind='src', b=(52, 54), src=(58.0, 59.0), push=0.04),
    dict(id='N_peaks',     kind='src', b=(54, 56), src=(54.0, 55.0), push=0.04, fx=['whip_out']),
    dict(id='fleet',       kind='fleet', b=(56, 64)),
    # ---- BREAKDOWN ---------------------------------------------------------
    dict(id='J_sunset',    kind='src', b=(64, 68), src=(34.4, 36.3), push=0.05, fx=['fade_in']),
    dict(id='K_hud',       kind='src', b=(68, 72), src=(38.0, 39.1), cy=440, push=0.04),
    dict(id='L1_along',    kind='src', b=(72, 76), src=(42.07, 43.5), push=0.05),
    dict(id='L2_along',    kind='src', b=(76, 80), src=(47.0, 49.0), push=0.05),
    # ---- BUILD B -----------------------------------------------------------
    dict(id='N2_formup',   kind='src', b=(80, 84), src=(55.0, 56.9), push=0.05),
    dict(id='AD_up',       kind='src', b=(84, 86), src=(91.03, 92.0), push=0.04),
    dict(id='O2_trails',   kind='src', b=(86, 88), src=(59.0, 59.9), push=0.06, fx=['whip_out']),
    dict(id='globe_warp',  kind='globe', b=(88, 96), mode='warp'),
    # ---- DROP 2: cities ----------------------------------------------------
    dict(id='R_paris',     kind='src', b=(96, 100), src=(64.05, 66.0), push=0.05, fx=['flash_in']),
    dict(id='S_eiffel',    kind='src', b=(100, 104), src=(68.2, 70.0), z=1.16, cy=388, push=0.04),
    dict(id='T_london',    kind='src', b=(104, 108), src=(70.2, 72.0), z=1.16, cy=388, push=0.04),
    dict(id='U_sydney',    kind='src', b=(108, 112), src=(72.2, 74.0), z=1.16, cy=388, push=0.04),
    dict(id='V_dubai',     kind='src', b=(112, 116), src=(74.2, 76.0), z=1.16, cy=388, push=0.04),
    dict(id='W_newyork',   kind='src', b=(116, 120), src=(76.2, 77.97), z=1.16, cy=388, push=0.04),
    dict(id='X_night',     kind='src', b=(120, 122), src=(78.25, 79.0), push=0.04),
    dict(id='Y_runway',    kind='src', b=(122, 124), src=(84.8, 85.7), push=0.04),
    dict(id='fl_H',        kind='src', b=(124, 125), src=(27.43, 27.93), punch=0.05, fx=['flash_in']),
    dict(id='fl_J',        kind='src', b=(125, 126), src=(36.5, 37.0), punch=0.05, fx=['flash_in']),
    dict(id='fl_R',        kind='src', b=(126, 127), src=(66.2, 66.7), punch=0.05, fx=['flash_in']),
    dict(id='fl_N',        kind='src', b=(127, 128), src=(57.0, 57.5), punch=0.05, fx=['flash_in', 'ramp_out']),
    # ---- FINALE ------------------------------------------------------------
    dict(id='AE_hero',     kind='src', b=(128, 136), src=(92.27, 93.97), cy=565, push=0.05, fx=['flash_in', 'cut_black']),
    dict(id='logo',        kind='logo', b=(136, 155)),
]

# Titles. style: whisper | line | slam | stack | chip | hero
TITLES = [
    dict(b=(1.5, 7.5),  style='whisper', text='RIGHT NOW,', y=0.41),
    dict(b=(3.0, 7.5),  style='line',    text='THOUSANDS OF REAL FLIGHTS ARE IN THE AIR.', y=0.50, shade=0.4),
    dict(b=(9.0, 14.5), style='line',    text='WHAT IF YOU COULD JOIN THEM?', y=0.50, accent=True, shade=0.4),
    dict(b=(28, 29),    style='slam',    text='REAL.'),
    dict(b=(29, 30),    style='slam',    text='LIVE.'),
    dict(b=(30, 32),    style='slam',    text='YOURS.'),
    dict(b=(32, 39.6),  style='hero',    text='FLY THE LIVING EARTH', y=0.30),
    dict(b=(40, 44),    style='stack',   text='EVERY CITY.'),
    dict(b=(44, 46),    style='stack',   text='EVERY COAST.'),
    dict(b=(46, 48),    style='stack',   text='EVERY PEAK.'),
    dict(b=(64.5, 71.6), style='line',   text='EVERY PLANE IN YOUR SKY', y=0.30),
    dict(b=(68.0, 71.6), style='line',   text='IS A REAL FLIGHT. LIVE.', y=0.37, accent=True),
    dict(b=(72.5, 79.6), style='line',   text="YOUR FAMILY'S FLIGHT HOME?", y=0.30),
    dict(b=(76.0, 79.6), style='line',   text='FLY RIGHT BESIDE IT.', y=0.37, accent=True),
    dict(b=(80.5, 85.8), style='line',   text='OR FORM UP WITH THE AIR FORCE.', y=0.30, accent=True, shade=0.35),
    dict(b=(89.0, 95.7), style='hero',   text='WARP ANYWHERE ON EARTH', y=0.80),
    dict(b=(96.5, 104), style='chip',    text='PARIS', sub='48.8584° N   2.2945° E'),
    dict(b=(104.3, 108), style='chip',   text='LONDON', sub='51.5007° N   0.1246° W'),
    dict(b=(108.3, 112), style='chip',   text='SYDNEY', sub='33.8568° S   151.2153° E'),
    dict(b=(112.3, 116), style='chip',   text='DUBAI', sub='25.1972° N   55.2744° E'),
    dict(b=(116.3, 120), style='chip',   text='NEW YORK', sub='40.7484° N   73.9857° W'),
    dict(b=(120, 122),  style='stack',   text='DAY AND NIGHT.'),
    dict(b=(122, 124),  style='stack',   text='IN REAL TIME.', align='right'),
]

# Fleet beat: one aircraft per beat (b56..b64), last two held 2 beats.
FLEET = [
    dict(model='vector-hero-v4',     name='VECTOR',    b=(56, 57), shot='low34'),
    dict(model='concorde-hero-v3',   name='CONCORDE',  b=(57, 58), shot='side'),
    dict(model='mustang-hero-v3',    name='MUSTANG',   b=(58, 59), shot='front34'),
    dict(model='f35-hero-v3',        name='F-35A',     b=(59, 60), shot='top'),
    dict(model='c17-hero-v3',        name='C-17',      b=(60, 61), shot='low34'),
    dict(model='whisper-hero-v3',    name='WHISPER',   b=(61, 62), shot='wing'),
    dict(model='umbra-hero-v3',      name='UMBRA',     b=(62, 64), shot='hero'),
]

# Skyloom trailer v2 — "Fly the Living Earth" (72 s)

A tighter, beat-locked re-cut of the 104 s reference trailer
(`skyloom-trailer-final-1080p.mp4`) with an original score, a procedural
live-globe opener, a hangar beat rendered from the game's own first-party
aircraft, new kinetic typography, a 2.39:1 grade and a new end card. Every
cut, title and sound hit sits on one grid: **30 fps, 14 frames per beat
(128.57 BPM), 155 beats = 72.33 s.**

## Cut sheet (beats → content)

| Beats | Section | Picture | Copy |
|---|---|---|---|
| 0–16 | Intro | Procedural globe: dot-matrix land, live flight trails, dive into NYC | RIGHT NOW, / THOUSANDS OF REAL FLIGHTS ARE IN THE AIR. / WHAT IF YOU COULD JOIN THEM? |
| 16–32 | Build | Stealth over clouds, Sydney low pass, coast, Governors Island | REAL. / LIVE. / YOURS. (one slam per beat) |
| 32–56 | Drop 1 | NYC harbor, waterfront burner, Palm Jumeirah, peaks, urban canyon, contrails | FLY THE LIVING EARTH / EVERY CITY. / EVERY COAST. / EVERY PEAK. |
| 56–64 | Hangar | Vector, Concorde, Mustang, F-35A, C-17, Whisper, Umbra (three.js renders of `public/models/player-*-hero`) | 13 AIRCRAFT. PICK YOUR WINGS. |
| 64–80 | Breakdown | Sunset above the clouds, HUD traffic tags, airliner alongside | EVERY PLANE IN YOUR SKY / IS A REAL FLIGHT. LIVE. / YOUR FAMILY'S FLIGHT HOME? / FLY RIGHT BESIDE IT. |
| 80–96 | Build | Formation, contrails, globe spin → Paris lock-on → dive | OR FORM UP WITH THE AIR FORCE. / WARP ANYWHERE ON EARTH |
| 96–128 | Drop 2 | Paris, Eiffel, London, Sydney, Dubai, New York, night city, runway, 4 flash cuts | city chips with coordinates / DAY AND NIGHT. / IN REAL TIME. |
| 128–136 | Finale | Stealth jet over the cloud sea, 0.46× optical-flow slow motion, cut to black | — |
| 136–155 | End card | Wordmark light-sweep over a sunrise limb | SKYLOOM / FLY THE LIVING EARTH / PLAY NOW IN YOUR BROWSER + credits |

Score: original, D major, I–V–vi–IV drops, half-time vi–IV–I–V breakdown,
IV–ii–V–I cadence landing on the logo. Synthesised in numpy (no samples);
mastered to −14 LUFS / −1 dBTP.

## Run it

```bash
pip install numpy scipy numba opencv-python-headless pillow   # + ffmpeg on PATH
npm install                                                    # three + playwright (already deps)
export TRAILER_WORK=$PWD/.trailer-work                         # default; git-ignored
export TRAILER_SRC=/path/to/skyloom-trailer-final-1080p.mp4    # the reference cut

cd scripts/trailer
python3 fetch_assets.py          # fonts (OFL) + Natural Earth 1:50m (public domain)
python3 geo_prep.py              # globe land dots, coastlines, cities, routes -> geo.npz
python3 fleet_job.py && node fleet/drive.mjs "$TRAILER_WORK/fleet_job.json"   # hangar renders
python3 music.py "$TRAILER_WORK/score.wav"
JOBS=4 python3 render.py         # all clips, or name clip ids to re-render a few
python3 assemble.py "$TRAILER_WORK/score.wav" "$TRAILER_WORK/skyloom-trailer-v2.mp4"
python3 preview.py sheet.png 32 56 96 136   # contact sheet at given beats
```

`fleet/drive.mjs` uses Playwright's Chromium; set `CHROME_PATH` to point at a
specific build. Rendering takes ~15 min on 4 cores (the globe is the long pole).

## Things that bit, so they don't again

- **Only caption-free source windows are usable.** The reference has burned-in
  captions and white flash frames at most cuts (~8 frames to settle).
  `textscore.py` finds the bold captions, but thin and fading ones slip under
  it — every window in `edl.py` was also checked by eye on contrast-boosted
  strips of the caption band at its first and last frames.
- **Decode with `-fps_mode passthrough`.** A seeked raw pipe under the default
  CFR sync repeats its first frame, which shifts a whole clip one frame early
  and pulls the previous shot's last frame into any window that starts on a cut.
- **Old city labels** sit lower-left; the city shots are reframed 1.16× from the
  top so the 2.39:1 window drops them, and the new chips replace them.
- **Colour:** segments are written untagged (swscale's BT.601 matrix);
  `assemble.py` goes through RGB to a tagged BT.709 master.
- Air traffic in the footage is staged; the end card says so, and keeps the
  reference trailer's imagery, map-data and CC BY model credits verbatim.

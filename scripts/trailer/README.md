# Skyloom — launch trailer

An 86-second, 2.39:1 cinematic trailer for Skyloom starring the house fighter,
**Vector** (`public/models/player-jet.glb`, the hangar's default aircraft). The
finished video is `docs/trailer/skyloom-trailer-1080p.mp4`.

Everything here is deterministic and offline. Each frame is a pure function of
time, the score is synthesized from the same `timeline.json`, and every asset
comes from this repo.

## Cut sheet (96 BPM, a bar is 2.5 s)

| Time | Shot | What happens |
|---|---|---|
| 0–10 | `globe` | The live planet from orbit. Every streak is a flight between two of the game's 1,719 POI cities. The camera pushes from the night-side crescent to a sunrise on the limb. *"RIGHT NOW" / "THOUSANDS OF REAL FLIGHTS ARE CROSSING THE PLANET"* |
| 10–15 | `dawn` | Glide over a golden cloud deck. *"THIS TIME" / "YOU'RE ONE OF THEM"* |
| 15–20 | `reveal` | The Vector punches out of a cumulus tower and passes the lens, and the camera whips round. It climbs away into the sun with an aileron roll and vapor off the wingtips. |
| 20–30 | `harborA/B` | Golden hour on the lakefront. A low water pass, then a knife-edge orbit around the **CN Tower** (the game's detail-v1 model). *"FLY ANYWHERE ON EARTH"* |
| 30–32.5 | `skyline` | Street level in Midtown, looking up at the Empire State Building (detail-v1) as the jet rolls overhead. |
| 32.5–40 | `formation` | The jet slides onto a Boeing 787's wing above the clouds, with a live ADS-B lock bracket and a *NEW SPOT +150* toast. |
| 40–47.5 | `montage1` | Six real in-game captures (satellite style) cut on the beat. |
| 47.5–50 | black | *"AND WHEN THE SUN GOES DOWN"* |
| 50–60 | `eiffelA/B` | Paris at 23:00. The Eiffel Tower is gold with its hourly sparkle and the rotating beacon on. The Vector threads past it in a roll. |
| 60–65 | `montage2` | Eight night and Neon captures. *"OR GO NEON"* |
| 65–70 | `climb` | An afterburner climb beside the tower, straight up into the stars. The picture and sound cut dead at 70. |
| 71.25–86 | `logo` | SKYLOOM, *THE WHOLE SKY IS LIVE*, *PLAY IN YOUR BROWSER*, then credits. |

## Files

- `timeline.json` holds the shots, the supers, the location stamps, the hits and the flashes. Both the picture and the score read it.
- `main.js` is the frame renderer. It runs three.js post (MSAA, bloom, ACES, grade), per-shot sub-frame motion blur, and a 2D compositor for type, lens flares, the HUD, grain, the vignette and the letterbox.
- `common.js` holds the shared pieces:
  - the analytic sky, which is also the fog colour, so horizons are seamless
  - time-keyed Catmull-Rom flight paths with coordinated-turn banking
  - the Vector rig: afterburners, nav lights and strobes
  - camera-facing ribbons for vapor, contrails and light trails
  - the instanced city with windows
- `scene-globe.js`, `scene-sky.js`, `scene-harbor.js` and `scene-paris.js` are the four worlds.
- `score.py` is the synthesized score: pads, ostinato, braams, trailer drums, risers, whooshes and jet roar.
- `render.cjs` is the headless-Chromium frame dumper. `probe.cjs` and `inspect.cjs` are debug helpers.
- `build.sh` runs render, then score, then encode.

## Rebuild

```bash
pip install numpy scipy imageio-ffmpeg     # imageio-ffmpeg ships an ffmpeg with libx264
FFMPEG=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())") \
  scripts/trailer/build.sh
```

To preview a few frames at low resolution, serve the repo root on `:8765`
(`python3 -m http.server 8765`) and run:

```bash
node scripts/trailer/render.cjs --out /tmp/prev --w 640 --h 360 --mb 1 --frames 120,420,660,1380
```

## Honesty notes

- **The cinematic shots are staged, not gameplay.** They are rendered with the game's own models (the Vector, the 787, the CN Tower, Empire State and Eiffel monuments), its HDRIs, its coastline data and its city list. The world around them (the cloud deck, the cities, the water) is built for the trailer. The container this was made in cannot reach the Esri, OpenFreeMap or adsb.lol tile and data hosts, so live-world footage could not be captured here.
- **The two montages are real in-game captures** from the repo's screenshot history. They carry an "IN-GAME CAPTURE" tag and the Esri, Maxar and Earthstar credit on the end card.
- **The HUD callsign `SKL204` is fictional.** The spot toast reuses the game's own spot/points language.
- **Credits** (end card): Vector by jeremy (CC-BY 3.0), 787 by Poly by Google (CC-BY 3.0) and Eiffel Tower by Scott Marshall (CC-BY 3.0). The CN Tower and Empire State detail models are first-party (MIT). HDRIs are from Poly Haven (CC0). Coastlines are Natural Earth (public domain). Flight data is from adsb.lol.

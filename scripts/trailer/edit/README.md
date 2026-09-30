# Skyloom trailer: edit, conform and mix

Two tools turn captured in-engine footage, title renders and the score/SFX into the finished trailer
(104.0 s, 1920x1080, 30 fps CFR, H.264 High yuv420p BT.709, AAC-LC 320k 48 kHz stereo).

| file | what it is |
|---|---|
| `conform.py` | renders the picture from an EDL: sources, speed ramps, fx, transitions, grade, titles, letterbox. Pipes raw frames to ffmpeg and muxes the mix |
| `mix.py` | final stereo mix: music plus SFX stem, ducking, glue compressor, -14 LUFS, -1 dBTP true-peak limiter, 48 kHz / 24-bit, exact duration |
| `edl.example.json` | **the schema, documented inline**. It validates, and every key is explained in its `_doc` fields |
| `edl.draft.json` | the first cut against the 960x540 draft captures (`/tmp/claude-0/shots/<id>-preview`) |

Timeline, beats and cue points live in `../cuesheet.json`. Titles come from `/tmp/claude-0/titles/manifest.json`.
The score comes from `../audio/score.py`, and SFX from `../audio/sfx.py`.

## Commands

Always run under `nice` on the shared box. Both tools also renice themselves by 15 by default (`--nice 0` disables this).

```bash
cd scripts/trailer/edit

# validate + per-clip source coverage report (which source frames each clip needs, which exist)
python3 conform.py edl.draft.json --check

# fast half-res draft of the whole trailer (x264 veryfast / CRF 18 unless --preset/--crf given)
nice -n 15 python3 conform.py edl.draft.json --out /tmp/claude-0/edit/draft.mp4 --preview-scale 0.5

# the master (x264 slow, CRF 14)
nice -n 15 python3 conform.py edl.draft.json --out /tmp/claude-0/edit/trailer.mp4

# an excerpt, with its audio (frames are bit-identical to the same frames of a full render)
nice -n 15 python3 conform.py edl.draft.json --out /tmp/claude-0/edit/x.mp4 --from 8 --to 20

# review stills (PNG, full pipeline incl. titles and bars); no video unless --stills-with-video
python3 conform.py edl.draft.json --stills 8.0,13.5,19.0,64.0 --stills-dir /tmp/claude-0/edit/stills

# the mix on its own (reads the EDL's "audio" block), or fully from flags
nice -n 15 python3 mix.py edl.draft.json --out /tmp/claude-0/edit/mix.wav
nice -n 15 python3 mix.py --music /tmp/claude-0/audio/score.wav --sfx-events /tmp/claude-0/audio/sfx_events.json \
    --sfx-gain-db -4 --duck 8.0,8.6,-3 --duck 60,60.5,-4,sidechain --fade-out 102.5,104 --out /tmp/claude-0/edit/mix.wav
```

Other `conform.py` flags:
- `--strict`: missing source directories or frames become errors.
- `--no-audio`
- `--threads N`: OpenCV threads; the default is 2.
- `--x264-threads N`
- `--cache-dir`: where the rendered mix is cached; the default is `<out dir>/.cache`, holding one mix of about 30 MB.

Outputs written next to `--out`:
- `<out>.report.json`: timings, the audio loudness measured by mix.py, and the missing-frame report.
- `<out>.ffmpeg.log`: kept only if ffmpeg printed anything.

The video is written to `<out>.partial.mp4` and renamed when it is complete.

## EDL schema (summary; `edl.example.json` is the reference)

```
{ "fps": 30, "duration": 104.0, "size": [1920, 1080],
  "clips": [ { "id", "t0", "t1", "src", "in", "speed": 1.0 | [[t, speed], ...], "blend": false, "src_fps", "enabled",
               "fx": { "zoom": [z0, z1], "zoom_center": [x, y], "exposure", "contrast", "sat", "temp", "tint", "lift",
                       "shake", "blur_radial", "flip" },
               "trans_in": { "type": cut|fade|dip_black|dip_white|flash|whip|glitch_warp, "dur", "strength", "dir", "color" } } ],
  "title_manifest": path, "titles_enabled": true, "titles_exclude": [slug, ...],
  "black": [[t0, t1], ...],
  "fades": [ { "t0", "t1", "from", "to", "curve": linear|smooth } ],
  "global": { "letterbox": px | [[t, px], ...], "grain", "grain_size", "vignette", "halation", "chromatic",
              "grade": { "exposure", "contrast", "sat", "temp", "tint", "lift", "filmic", "split",
                         "shadow_tint", "highlight_tint", "black", "white" } },
  "audio": { "music", "sfx_events", "sfx_wav", "music_gain_db", "sfx_gain_db", "duck", "fade_out",
             "target_lufs", "ceiling_dbtp", "compressor", "mix_wav" } }
```

**Rules.**
- Validation is strict:
  - unknown keys are errors, with a "did you mean" hint;
  - so are wrong types, out-of-range values, unsorted or overlapping clips, and transition windows that collide or are longer than their clip;
  - every problem is reported at once with its JSON path, and nothing renders.
- Keys that begin with `_` are comments.
- Times are timeline seconds, except clip keyframes (`speed` and any keyframed fx), which are clip-relative.
- `letterbox` keys use absolute time.
- Pixel values are authored at `size` and scale with `--preview-scale`.
- `speed` keys are integrated into a source position (a ramp never jumps).
  - Fractional positions resolve to the nearest frame, or blend the two neighbours with `"blend": true`.
- Scalar fx take either a number or `[[t, v], ...]` keys (linear interpolation, held outside the keys).

**Transitions** (`trans_in` of the incoming clip; the window is centred on its t0):

| type | behaviour | needs overlap |
|---|---|---|
| `cut` | hard cut | no |
| `fade` | smoothstep cross-dissolve over [t0-d/2, t0+d/2] | yes |
| `dip_black` / `dip_white` | outgoing to colour at t0, then colour to incoming (`color` overrides) | no |
| `flash` | hard cut with additive warm-white bloom: 2-frame pre-glow on the outgoing shot, peak on the cut frame, decay over `dur` (`strength` 0..3) | no |
| `whip` | both shots slide and smear along `dir` (box-on-box motion blur up to 14% of the frame width, +6% zoom); the swap happens inside the peak smear | yes |
| `glitch_warp` | hyperspace warp: the outgoing shot rushes forward (zoom to +35%) and the incoming settles from +30%. Adds radial zoom blur, cool radial light streaks from highlights, radial R/B split, deterministic glitch slices, and a white peak on the cut | yes |

With "overlap", the outgoing clip keeps playing past its t1 and the incoming clip starts before its t0 (`in` minus half the window).
- `--check` lists the exact source frame range each clip needs, including these extensions.
- A position below frame 0 holds the first frame and is flagged in the preflight.
- The first clip, or a clip after a gap, transitions from black.

## Picture pipeline (per output frame, pure function of EDL + frame index)

1. **Source.** `NNNNN.jpg`, with `NNNNN.dom.png` alpha-composited over it when present. The footage is brought up to the UI's resolution first when they differ.
   - The result is cover-fit to the output: Lanczos4 plus a light unsharp mask (sigma 0.55 x factor, amount 0.45) when upscaling the 960x540 drafts; INTER_AREA when downscaling.
   - Decoding and upscaling run one frame ahead in a prefetch thread.
2. **Per-clip geometry.** Zoom, shake, flip and transition transforms are fused into one cubic `warpAffine`.
   - Shake is a deterministic 3-sine mix at 1.3–9.1 Hz on timeline time, phase-seeded by clip id. The overscan is automatic, so the frame edge never shows.
   - `blur_radial` is an 8-tap zoom blur.
3. **Grade.** Saturation is a 3x3 matrix (Rec.709 luma) on uint8. Everything else is one per-channel 256-entry LUT (uint8 to float32), built once per parameter set, in this order:
   1. clip exposure and white balance (in linear light, luma-normalised gains);
   2. clip contrast (endpoint-preserving S about 0.46) and lift;
   3. the same global grade operations;
   4. the **filmic curve**: a cubic S pivoting at 0.36, a +0.005 toe so the deepest shadows are never crushed, and an exponential shoulder from 0.76 that maps 1.0 to 0.975 for a soft highlight roll-off;
   5. **split toning**: teal only in true shadows (0.02–0.38), warm only in highlights (0.55–0.97), neutral at pure black and white, amplitude ±0.045 x `split`.

   The footage is already ACES tone-mapped by the game, so the look is deliberately restrained. On test frames, medians move within ±5 code values, the 1st percentile stays put, and Lab chroma stays within about ±5% (day).
4. **Transition effects** in display-referred float.
5. **Global look.**
   - Halation: red-orange (B 0.10 / G 0.36 / R 1.0), from highlights with luma > 0.72, computed at quarter resolution and screen-blended.
   - Grain: luma-only, 3 pre-generated soft (sigma 0.62 px) Gaussian fields. The crop offset and field are chosen by a hash of the frame index. The grain is weighted by luma: none on black, full in shadows and mids, half in highlights. At 0.35 it is σ ≈ 1% of full scale.
   - Vignette: elliptical, corners at -0.40 x `vignette`. It is fused with the fade gain and the float-to-uint8 quantisation, which the grain dithers.
   - Chromatic aberration: radial R out / B in, on uint8.
6. `black` ranges and `fades` act on the **picture layer only**. Titles still composite over black.
7. **Titles.** Alpha-over, bbox-limited. The PNGs from the title renderer are detected as **straight (un-premultiplied) alpha**: colour channels exceed alpha on soft edges. Detection runs per sequence, and `--check` prints the result.
   - Titles are not graded. They are composited after grain and vignette, so the type stays crisp.
   - `alpha: false` sequences (the end card `19_endcard` from 94.5 s) are **opaque plates**. They replace the frame, ungraded and without bars.
8. **Letterbox** bars (default 60 px = 2.0:1) are drawn last, over titles, except on plates.

## Encode

`ffmpeg -f rawvideo bgr24 -> scale=out_color_matrix=bt709:out_range=tv (accurate_rnd, full_chroma_int) -> libx264 -preset slow -crf 14 -profile:v high -pix_fmt yuv420p -x264-params aq-mode=3 -colorspace/-color_primaries/-color_trc bt709 -color_range tv -r 30 -fps_mode cfr, AAC 320k 48 kHz, -movflags +faststart`.

The explicit BT.709 matrix matters: swscale's default for RGB-to-YUV is BT.601. Decoding the output with a BT.709 matrix reproduces the PNG stills with a per-channel mean error of about 0.1 code values (PSNR 37–45 dB at CRF 14).

`aq-mode=3` is the one addition to the requested flags. It biases bits to dark flat areas, such as the night scenes and the end card's navy gradients, to avoid banding.

Expected bitrate at CRF 14 is about 45–50 Mb/s, of which the grain accounts for about 14 Mb/s. The 104 s master will be roughly 600–650 MB. For a lighter review copy, use `--crf 18`.

## Mix (`mix.py`)

**Signal flow:**
1. `music x music_gain x duck(t) + sfx x sfx_gain`
2. fade_out
3. glue compressor: stereo-linked 10 ms RMS, soft knee; defaults -14 dBFS, 1.6:1, 30/250 ms, 6 dB knee
4. loudness gain to `target_lufs` (BS.1770-4, pyloudnorm)
5. true-peak limiter: 4x-oversampled detection, 1.5 ms look-ahead with a smoothed attack, 80 ms release

The loudness gain is re-solved after limiting until the result is within ±0.05 LU and at or below the ceiling. The output is exactly `round(duration x 48000)` samples, PCM_24.

`<out>.json` reports the **measured** values:
- integrated LUFS, true peak (dBTP) and sample peak
- compressor and limiter maximum gain reduction, and limiter active time
- loudness per 8 s window

**Ducking:**
- `range` (default): a static dip with cosine ramps, 80 ms before t0 and 350 ms after t1.
- `sidechain`: the dip follows the SFX stem's 10 ms RMS inside the range. It reaches full depth within 6 dB of the loudest SFX moment in that range, with 10/200 ms ballistics.

`sfx_events` is rendered through `../audio/sfx.py` and cached by a content hash, taking about 100 s. The audio agent's `sfx.wav` is never overwritten.

**Measured on the current score plus `sfx.wav`** (`edl.draft.json` audio block): -14.02 LUFS integrated, -1.10 dBTP, compressor maximum GR 2.0 dB, limiter maximum GR 3.1 dB (active 4.4 s in total), 27 s render, 477 MB peak RSS.

## Draft footage and missing frames

- Draft captures are 960x540 and are upscaled as described above.
- Sources may be incomplete while captures run:
  - A missing frame holds the **nearest available** frame. This also covers stride-N previews and gaps.
  - A missing or empty directory renders **black**.
  - Nothing crashes.
- Directories without a `DONE` marker are rescanned every 20 s. Files modified in the last 2 s are ignored, because the capture may still be writing them.
- Every hold is counted per clip and printed at the end, and is also in `report.json`.

## Speed

Measured on this shared 4-core box (load average 12–17, other agents' jobs holding 2 cores at nice 10, this process at nice 15). The figures below are CPU time per frame on ONE core with one OpenCV thread and no prefetch.

| frame type | ms/frame | fps |
|---|---|---|
| native 1080p source | ~112 | ~9 |
| 960x540 draft upscaled to 1080p | ~112 | ~9 |
| draft + a title overlay (the 1080p PNG decode is about half of this) | ~190 | ~5.3 |
| DOM-overlay shot | ~150 | ~6.7 |
| flash | ~320 | ~3 |
| whip | ~240 | ~4 |
| glitch_warp (heaviest, 12 frames per use) | ~860 | ~1.2 |
| `--preview-scale 0.5` | ~19 | ~50 |

End-to-end wall-clock on the loaded box, including x264:
- full-res excerpt (x264 slow): 1.1 fps
- half-res full-timeline draft (x264 veryfast): ~6 fps

Wall speed is dominated by CPU contention and by x264 slow at CRF 14. On an idle 4-core machine, expect roughly 4–6 fps for the master.

Memory: the renderer stays well under 1.5 GB (about 0.4–0.6 GB RSS at 1080p). mix.py peaks at about 480 MB.

## Verification evidence

Everything under `/tmp/claude-0/edit/`.

The synthetic test footage has been deleted to save disk. To regenerate it, run `make_testshots.py` in the session scratchpad (`/tmp/claude-0/-home-user-skyloom/ed71df51-*/scratchpad/`). The same directory holds `edl.test.json` (the draft EDL pointed at the synthetic shots), `edl.fxtest.json`, `edl.bad.json`, and the harness scripts `ab.py`, `sheet.py`, `fuzz.py` and `rfuzz.py`.

**Synthetic shots (regenerable).** These are in-game screenshots with a camera drift and the frame number burned in, extended with symlinks. They include:
- a `.dom.png` overlay shot
- a 20-frame gap
- a stride-2 shot
- a native-1080p shot
- a deliberately missing shot

**Real captured footage** (`nyc-hero`, `nyc-traffic-sky`, `clouds-family-ui` previews):
- `real_28_34.mp4`: full-res excerpt on real footage, with the flash cut at 28.0, titles 06/07 and the mix.
- `real_strip.jpg`: frames from that excerpt.
- `stills_real/`: stills through the full pipeline.
- `ab_real.jpg`: ungraded vs graded.
- `real_titles.jpg`: titles over real footage.

**Picture, on the synthetic shots:**
- `excerpt_8_20.mp4`: the 12 s full-res test excerpt. It has flash cuts at 8.0 and 16.0, a whip at 19.0, titles 03/04, the letterbox and the mix. Its stills are in `stills_excerpt/`.
- `timeline_strip.jpg`: 20 frames decoded from the half-res render of the whole 104 s test timeline (3120 frames, 403 s wall). `test_full_preview.log` and `test_full_preview.mp4.report.json` go with it; the MP4 itself was deleted.
- `sheet_flash_whip.jpg`, `sheet_warp_dip.jpg`, `sheet_fx.jpg`: frame-by-frame contact sheets of every transition type, the speed ramp, shake, radial blur, flip and zoom, colour fx, animated letterbox, still-image source, stride-2 source and missing source.
- `ab1.jpg`, `ab2.jpg`: ungraded vs graded.
- `crops_v2.png`, `mp4crops.png`: 1:1 crops (grain, halation, title edges, upscale) before and after H.264.
- `loc_crop.png`: a location title inside the 2.0:1 area.

**Audio:** `mix_test.wav.json` (draft audio block) and `mix_test2.wav.json` (sfx_events rendered via sfx.py, range and sidechain ducks, fade-out). The WAVs themselves were deleted.

**Robustness:**
- Validator fuzz: 6,000 random mutations of the draft and fx EDLs produced only clean `EDLError`s, with no crashes.
- Render fuzz: 690 frames from randomly mutated valid EDLs, with no crashes.
- `edl.bad.json` reports 21 problems at once.
- The same test verified unit behaviour of the range and sidechain duck curves, the true-peak limiter (+4.1 dBTP in, -1.10 out) and the fade-out.

## Known limitations

- **Letterbox vs full-UI shots.** The 60 px bars cover the top and bottom of the game HUD on UI beats (for example `clouds-family-ui`, where the destination label sits under the top bar). Key the letterbox down around those beats, or capture the UI inset.
- **Pre-roll.** Blend transitions into a clip with `in: 0` (for example `atlas` and `paris-arrival` in the draft) hold the source's first frame for the pre-roll frames. It is hidden by the whip or warp blur, but it is flagged. Give such clips `in` ≥ half the transition in frames.
- **Titles are drawn exactly as rendered.** Location titles' soft glow reaches y ≈ 1023, so the bottom bar trims its faint edge. The text itself is inside the 2.0:1 area.
- **Colour pipeline scope.** The grade assumes display-referred sRGB/BT.709 input, which is what the capture writes. There is no HDR path.
- **Motion blur.** Only transitions and `blur_radial` add motion blur. There is no optical-flow retiming; `blend` is a linear frame blend.
- **Halation and grain** are computed per frame without temporal state. That is deliberate: it makes `--from/--to` and stills bit-exact with the full render.

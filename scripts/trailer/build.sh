#!/usr/bin/env bash
# Skyloom trailer — full build: render frames, synthesize the score, encode.
#   scripts/trailer/build.sh [OUT_DIR]
# Needs: playwright (global ok), python3 + numpy/scipy, an ffmpeg with libx264
# (FFMPEG=/path/to/ffmpeg; `pip install imageio-ffmpeg` ships one).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/docs/trailer}"
WORK="${WORK:-/tmp/skyloom-trailer}"
FFMPEG="${FFMPEG:-ffmpeg}"
WORKERS="${WORKERS:-3}"
mkdir -p "$OUT" "$WORK/frames"

# 1. static server at the repo root (the renderer imports /node_modules, /public, /lib)
( cd "$ROOT" && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 ) & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

# 2. frames (deterministic per frame, so workers split the list; --resume 1 skips done frames)
pids=()
for k in $(seq 0 $((WORKERS - 1))); do
  node "$ROOT/scripts/trailer/render.cjs" --out "$WORK/frames" --w 1920 --h 1080 --workers "$WORKERS" --worker "$k" --resume 1 & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

# 3. score
python3 "$ROOT/scripts/trailer/score.py" "$WORK/score.wav"

# 4. encode (loudness-normalised to -14 LUFS, true peak -1 dB)
"$FFMPEG" -y -framerate 24 -i "$WORK/frames/f%05d.jpg" -i "$WORK/score.wav" \
  -c:v libx264 -preset slow -crf 20 -tune film -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -af "highpass=f=28,equalizer=f=70:t=q:w=1:g=-3,loudnorm=I=-14:TP=-1.0:LRA=11" -c:a aac -b:a 256k -ar 48000 \
  -shortest "$OUT/skyloom-trailer-1080p.mp4"
echo "wrote $OUT/skyloom-trailer-1080p.mp4"

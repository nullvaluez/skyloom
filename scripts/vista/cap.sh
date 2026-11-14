#!/usr/bin/env bash
# VISTA PASS — the capture queue. The software rasteriser uses every core, so
# only ONE capture may run on this machine at a time; this wrapper takes a
# machine-wide lock, runs scripts/vista/capture.cjs and logs the run.
#
#   scripts/vista/cap.sh <stream> <port> <outdir> <poses> [extra capture.cjs args]
#   e.g. scripts/vista/cap.sh air 3101 .graphics-review/vista/air/it1 alps-noon,city-day
#        scripts/vista/cap.sh air 3101 .graphics-review/vista/air/off alps-noon --flags=-VISTA_AIR
#
# It can wait a long time for the lock: run it in the background and wait for
# the completion notice rather than holding a foreground shell.
set -u
stream="$1"; port="$2"; out="$3"; poses="$4"; shift 4
LOCK=/tmp/vista-capture.lock
LOG=/tmp/vista-capture.log
here="$(cd "$(dirname "$0")/../.." && pwd)"
queued=$(date +%s)
echo "$(date -u +%H:%M:%S) QUEUED  $stream $poses" >> "$LOG"
exec 9>"$LOCK"
flock 9
start=$(date +%s)
echo "$(date -u +%H:%M:%S) START   $stream $poses (waited $((start - queued))s)" >> "$LOG"
if ! curl -s -o /dev/null -m 60 "http://localhost:$port/"; then
  echo "$(date -u +%H:%M:%S) NOSERVER $stream port $port" >> "$LOG"
  echo "cap.sh: nothing is serving http://localhost:$port/ — start your dev server first" >&2
  exit 3
fi
cd "$here" && FLY_CHROME="${FLY_CHROME:-/opt/pw-browsers/chromium}" node scripts/vista/capture.cjs \
  --url="http://localhost:$port" --out="$out" --poses="$poses" "$@"
code=$?
end=$(date +%s)
echo "$(date -u +%H:%M:%S) DONE    $stream $poses exit=$code ran $((end - start))s" >> "$LOG"
exit $code

#!/usr/bin/env bash
# Start the trailer REAL-DATA tile server in the background (no systemd) and
# wait until /__health answers. Idempotent: if a healthy trailer-real-1 server
# already owns the port, it is reused and nothing is started.
#
#   scripts/trailer/world/run-server.sh            # start (or reuse)
#   scripts/trailer/world/run-server.sh stop       # stop the one we started
#   scripts/trailer/world/run-server.sh restart
#   scripts/trailer/world/run-server.sh status     # health + stats summary
#
# ENV: TRAILER_WORLD_PORT (3301), TRAILER_WORLD_ROOT (/tmp/claude-0/world),
#      TRAILER_WORLD_LOG (0), TRAILER_WORLD_MAX_AGE (0), TRAILER_WORLD_LRU_MB (256),
#      TRAILER_WORLD_NICE (0 — the server is latency-critical for the capture;
#      it does almost no CPU work, so it is NOT niced by default),
#      TRAILER_WORLD_PIDFILE (/tmp/claude-0/world-server.<port>.pid),
#      TRAILER_WORLD_LOGFILE (/tmp/claude-0/world-server.<port>.log)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${TRAILER_WORLD_PORT:-3301}"
export TRAILER_WORLD_PORT="$PORT"
export TRAILER_WORLD_ROOT="${TRAILER_WORLD_ROOT:-/tmp/claude-0/world}"
NICE="${TRAILER_WORLD_NICE:-0}"
PIDFILE="${TRAILER_WORLD_PIDFILE:-/tmp/claude-0/world-server.${PORT}.pid}"
LOGFILE="${TRAILER_WORLD_LOGFILE:-/tmp/claude-0/world-server.${PORT}.log}"
BASE="http://127.0.0.1:${PORT}"
REV="trailer-real-1"

health() { curl -s --noproxy '*' -m 2 "${BASE}/__health" 2>/dev/null || true; }

stop() {
  if [[ -f "$PIDFILE" ]]; then
    local pid; pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      kill -9 "$pid" 2>/dev/null || true
      echo "[run-server] stopped pid $pid"
    fi
    rm -f "$PIDFILE"
  else
    echo "[run-server] no pidfile ($PIDFILE)"
  fi
}

start() {
  local h; h="$(health)"
  if [[ "$h" == *"\"rev\":\"${REV}\""* ]]; then
    echo "[run-server] already healthy at ${BASE} (${h}) — reusing"
    return 0
  fi
  if [[ -n "$h" ]]; then
    echo "[run-server] port ${PORT} answered with something else: ${h}" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$PIDFILE")" "$(dirname "$LOGFILE")" "$TRAILER_WORLD_ROOT"
  nohup nice -n "$NICE" python3 -u "${HERE}/server.py" >>"$LOGFILE" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PIDFILE"
  for _ in $(seq 1 100); do
    h="$(health)"
    if [[ "$h" == *"\"rev\":\"${REV}\""* ]]; then
      echo "[run-server] up: ${BASE} pid ${pid} root ${TRAILER_WORLD_ROOT} log ${LOGFILE}"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[run-server] server exited during start; last log lines:" >&2
      tail -n 20 "$LOGFILE" >&2 || true
      rm -f "$PIDFILE"
      exit 1
    fi
    sleep 0.1
  done
  echo "[run-server] timed out waiting for ${BASE}/__health" >&2
  exit 1
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status)
    echo "health: $(health)"
    curl -s --noproxy '*' -m 5 "${BASE}/__stats" | python3 -c 'import sys,json; j=json.load(sys.stdin); print(json.dumps({"total":j["total"],"byKind":{k:{kk:v[kk] for kk in ("count","hit","miss","fallback","fallbackCached","neutral","errors","msMean","msMax")} for k,v in j["byKind"].items()},"synthLru":j.get("synthLru")},indent=1))' || true
    ;;
  *) echo "usage: $0 [start|stop|restart|status]" >&2; exit 2 ;;
esac

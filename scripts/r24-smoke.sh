#!/usr/bin/env bash
#
# R24 (E CERT) — the POST-MERGE SMOKE. One command per W2 merge (E → A → B → C
# → D). It runs the subset that (a) actually runs in this container and (b)
# finishes in a workable time, and it says out loud what it is NOT covering.
#
#   scripts/r24-smoke.sh [port]        # default 3105 (E's port)
#
# It expects a dev server ALREADY RUNNING on that port from the worktree under
# test, and it never starts or stops one — a smoke that boots its own server
# would race the one the agent is using.
#
# ENV
#   FLY_URL          overrides the whole target (wins over the port argument)
#   SMOKE_NODE_ONLY  '1' runs ONLY the node gates — no browser, no dev server
#                    needed. Use it for a fast merge check, and whenever
#                    someone else's browser owns the machine (five agents share
#                    four cores; two browser runs at once make every wall-clock
#                    number meaningless and can starve a certification run).
#   SMOKE_SKIP_SLOW  '1' drops the two long browser gates (fade, lod-fade)
#   SMOKE_OUT        artifact directory (default scripts/r24-out)
#
# WHAT THIS SMOKE CANNOT SEE — say it in the report, every time:
#   · any fps / frame-ms / stalls-per-minute number (SwiftShader, ~1 fps)
#   · the governor's real ladder behaviour
#   · tearing (a vsync property; only its MECHANISM is asserted, in
#     verify-step-clean and verify-frame-pace)
#   · live tileset drift and live traffic (hosts are 403-blocked)
# Those belong to the user-machine run list in scripts/r24-close-sweep.md.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PORT="${1:-3105}"
URL="${FLY_URL:-http://localhost:${PORT}}"
OUT="${SMOKE_OUT:-scripts/r24-out}"
mkdir -p "$OUT"

export FLY_URL="$URL"
export FLY_TILE_FIXTURE=1
export PW_SHIM_QUIET=1
# Post-reveal waits in bootFly are fixed 30 s on a GPU machine's assumption;
# under SwiftShader with five agents on four cores they time out AFTER pct 100
# has already been reached. Scaling them does not weaken the boot contract.
export FLY_BOOT_SCALE="${SMOKE_BOOT_SCALE:-6}"
# The finalize-budget scaler, for the CONTENT gates only. Enumerated here on
# purpose: a pacing gate must never see it (see lib/fly/harness-budget.js).
CONTENT_K="${SMOKE_FINALIZE_K:-40}"

PASS=0
FAIL=0
SKIP=0
ROWS=()

# run <name> <script-path> <command...>
#
# The SCRIPT PATH is an explicit argument. It used to be inferred from the
# command's first word, which is `node` or `env` — so the presence check tested
# for a file called "node", every row reported "absent", and the whole smoke
# exited 0 with "0 passed, 0 failed, 9 skipped". That is the R20 false-green
# shape exactly: a gate that cannot find itself must be LOUD, never green.
run() {
  local name="$1"; shift
  local script="$1"; shift
  local log="$OUT/smoke-${name}.log"
  printf '\n=== %s ===\n' "$name"
  if [ ! -f "$script" ]; then
    printf 'SKIP  %s (%s not present on this tree)\n' "$name" "$script"
    SKIP=$((SKIP+1)); ROWS+=("SKIP  $name  ($script absent)"); return
  fi
  local t0; t0=$(date +%s)
  if "$@" >"$log" 2>&1; then
    local dt=$(( $(date +%s) - t0 ))
    printf 'PASS  %s  (%ss)  %s\n' "$name" "$dt" "$log"
    PASS=$((PASS+1)); ROWS+=("PASS  $name  ${dt}s")
  else
    local dt=$(( $(date +%s) - t0 ))
    printf 'FAIL  %s  (%ss)  %s\n' "$name" "$dt" "$log"
    tail -25 "$log" | sed 's/^/      /'
    FAIL=$((FAIL+1)); ROWS+=("FAIL  $name  ${dt}s  -> $log")
  fi
}

node_gate() { run "$1" "scripts/$1" node "scripts/$1"; }
browser_gate() { run "$1" "scripts/$1" node -r ./scripts/_pw-shim.js "scripts/$1"; }

NODE_ONLY="${SMOKE_NODE_ONLY:-0}"
printf 'R24 SMOKE — target %s — fixture ON — %s\n' "$URL" \
  "$([ "$NODE_ONLY" = 1 ] && echo 'NODE GATES ONLY' || echo 'node + browser')"
if [ "$NODE_ONLY" != 1 ]; then
  curl -s -o /dev/null -w 'dev server: HTTP %{http_code}\n' --max-time 60 "$URL/" || {
    echo "dev server not answering on $URL — start it in the worktree under test first"; exit 2; }
fi

# --- node gates: no browser, no GPU, no network. These run anywhere and are
#     the fastest possible signal that a merge broke a data contract.
node_gate verify-classify.mjs
node_gate verify-warbirds.mjs
node_gate verify-daily.mjs
node_gate verify-depth-offset.mjs        # C (R24): reversed-depth polygonOffset
node_gate verify-terra-residency.mjs     # A (R24): merge/refetch on a yaw sweep
node_gate verify-c-flagoff.mjs           # C (R24): every C flag off + GLSL false-branch verbatim
# D shipped its node coverage as feature gates rather than one flag-off gate:
node_gate verify-lod-fade.mjs            # D (R24): the node half; the BROWSER half is E's verify-lod-fade.js
node_gate verify-worker-normals.mjs      # C (R24): area-weighted DEM normals, 3.34 deg -> 0.26 deg
# A's skirt-worker identity gate. NOTE (C, 0e2f7cb): its element-by-element
# identity leg goes RED with TERRAIN_LIGHT.workerNormals ON *by design* — the
# NORMAL array is meant to change; positions, uv and indices must not. When
# that flag is on, this needs a flag-on ARM, NOT a re-baseline of A's number.
node_gate verify-skirt-worker.mjs

node_gate verify-artifact-hygiene.mjs    # E (R24): no R15-R23 calibration artifact may change
node_gate verify-vendor-three-tile.mjs   # A (R24): the vendored copy is verbatim
node_gate verify-skirt-fast.mjs          # A (R24): O(V) boundary scan is output-identical
node_gate verify-frame-step.mjs          # A (R24): fixed-timestep sim / interpolated render pose
node_gate verify-finalize-pace.mjs       # A (R24): wall-clock finalize brake

# --- verify-seam's NODE leg runs offline (HARN-GAP-7): its api.init() is
#     pinned to the fixture by a global-fetch wrapper. Gates 0-6c are the
#     fastest deterministic instrument in the fleet.
#     FLY_URL IS UNSET FOR THIS ROW ON PURPOSE. The smoke exports FLY_URL for
#     the whole run, and verify-seam.js:452 takes that as "also run the browser
#     leg" — which then does require('playwright') with no shim preload and
#     dies with "Cannot find module 'playwright'" AFTER nine green node gates.
#     The node leg is the fixture column; the browser leg is a browser_gate row.
run verify-seam.js scripts/verify-seam.js env -u FLY_URL node scripts/verify-seam.js


if [ "$NODE_ONLY" = 1 ]; then
  printf '\n--------------------------------------------------\n'
  for r in "${ROWS[@]}"; do printf '%s\n' "$r"; done
  printf '\n%s passed, %s failed, %s skipped  (NODE GATES ONLY — no browser was run)\n' \
    "$PASS" "$FAIL" "$SKIP"
  [ "$PASS" -eq 0 ] && { echo '*** SMOKE FAILED: ZERO gates ran'; exit 2; }
  [ "$FAIL" -gt 0 ] && exit 1
  [ "$SKIP" -gt 0 ] && { echo "*** SMOKE INCOMPLETE: $SKIP absent"; exit 3; }
  exit 0
fi

# --- the fixture's own gate. If this is red, every browser number below is
#     meaningless, so it runs first and its failure is the headline.
run verify-fixture.js scripts/verify-fixture.js \
  env FLY_FIXTURE_SETTLE_MS="${SMOKE_FIXTURE_SETTLE:-120000}" \
      FLY_FINALIZE_BUDGET_K="$CONTENT_K" \
  node -r ./scripts/_pw-shim.js scripts/verify-fixture.js

# --- browser gates that are hardware-independent (counts, census, source scans,
#     buffer identity). Ordered cheapest first.
# PACING gates — these must NEVER see FLY_FINALIZE_BUDGET_K.
browser_gate verify-frame-pace.js
browser_gate verify-step-clean.js
browser_gate verify-ladder-fix.js        # A (R24): FLY_LADDER_RED=1 = 6/13 fail flag-off; boots TOY
# verify-seam's BROWSER leg (gates 7-9: engine counters over a settled 60 s).
run verify-seam-browser scripts/verify-seam.js \
  node -r ./scripts/_pw-shim.js scripts/verify-seam.js
# CONTENT gates — counts, census and single-frame transitions. Their
# assertions are on WHAT the world contains and on transition COUNTS, never on
# how long a drape took, so a wider per-frame budget cannot change an answer.
content_gate() {
  run "$1" "scripts/$1" env FLY_FINALIZE_BUDGET_K="$CONTENT_K" \
    node -r ./scripts/_pw-shim.js "scripts/$1"
}
content_gate verify-flash-guard.js
if [ "${SMOKE_SKIP_SLOW:-0}" != "1" ]; then
  content_gate verify-lod-fade.js
  content_gate verify-fade.js
fi

printf '\n--------------------------------------------------\n'
for r in "${ROWS[@]}"; do printf '%s\n' "$r"; done
printf '\n%s passed, %s failed, %s skipped\n' "$PASS" "$FAIL" "$SKIP"

# A smoke that ran nothing is a FAILURE, not a pass. Same for a run in which
# every row was skipped: the only honest reading of "0 passed" is "this told
# you nothing".
VERDICT=0
if [ "$FAIL" -gt 0 ]; then VERDICT=1; fi
if [ "$PASS" -eq 0 ]; then
  printf '\n*** SMOKE FAILED: ZERO gates actually ran (%s skipped). A smoke that skips\n' "$SKIP"
  printf '*** everything and exits 0 is a false green — check the paths above.\n'
  VERDICT=2
fi
if [ "$SKIP" -gt 0 ] && [ "$VERDICT" -eq 0 ]; then
  printf '\n*** SMOKE INCOMPLETE: %s gate(s) were skipped as absent. Verify that each is\n' "$SKIP"
  printf '*** genuinely not on this tree before treating this run as green.\n'
  VERDICT=3
fi

cat <<'NOTE'

NOT COVERED BY THIS SMOKE (by construction, not by omission):
  · every fps / frame-ms / p99 / stalls-per-minute number — this container
    renders the game at ~1 fps on a software rasteriser
  · the perf governor's real ladder, dwell and latch behaviour
  · tearing itself (only its mechanism is asserted here)
  · live OpenFreeMap / Esri / adsb bytes, and therefore every LIVE frozen
    hash and pixel band — the fixture columns are separate numbers and never
    re-baseline a live one
  · the 15-minute satellite soak
See scripts/r24-close-sweep.md for the user-machine run list.
NOTE

exit $VERDICT

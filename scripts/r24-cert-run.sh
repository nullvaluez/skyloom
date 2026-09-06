#!/usr/bin/env bash
#
# R24 (E CERT) — THE CERTIFICATION RUN, hardened.
#
# The sequence Fable ran by hand, with the three failure modes that cost this
# round about an hour designed out of it:
#
#   1. A `curl` health check proves a PORT answers, not that YOUR server
#      answers. A hand run's `next dev -p 3100` died instantly with EADDRINUSE
#      because an earlier server still held the port; the check passed against
#      that other process and every row after it measured a tree nobody had
#      chosen. THIS SCRIPT REFUSES TO START if :3100 already has a listener,
#      prints the PID, and NEVER kills it — it is not ours to kill.
#   2. "Zero canvas, __flyBoot undefined" is the `dynamic(FlyMode,{ssr:false})`
#      loading state: the chunk never evaluated. Twelve minutes of browser rows
#      were spent discovering it twice. THIS SCRIPT PROVES THE BOOT FIRST with
#      one throwaway page that must reach `__flyBoot.pct === 100`, and ABORTS
#      with the page's console errors printed if it does not. That single step
#      is what would have saved the 601 s row.
#   3. Content gates and pacing gates need different environments.
#      `FLY_FINALIZE_BUDGET_K` widens a per-frame budget, so it is correct for
#      "what does the world CONTAIN" and WRONG for anything that measures
#      pacing. The split below is exactly the table in
#      scripts/r24-close-sweep.md §1.5 and is written per row, never globally.
#
# It also runs the node gates first — `verify-import-integrity` above all, the
# cheapest possible "the app can evaluate" signal — because a red there makes
# every browser number after it meaningless.
#
#   scripts/r24-cert-run.sh [port]        # default 3100
#
# ENV
#   CERT_PROOF_ONLY=1  stop after the boot proof and LEAVE THE SERVER UP. The
#                      proof is the go/no-go for a whole certification run, so
#                      it is worth being able to ask for it alone.
#   CERT_SKIP_NODE=1   skip the node gates (they are seconds; rarely worth it)
#   CERT_K             content-gate budget scaler (default 40)
#   CERT_FIXTURE_K     the fixture census's own K (default 200 — Manhattan's
#                      sixteen dense chunks do not settle at 40 in this venue)
#   CERT_BOOT_SCALE    FLY_BOOT_SCALE (default 6)
#   CERT_OUT           log directory (default scripts/r24-out/cert)
#
# Logs: $CERT_OUT/<row>.log · summary on stdout with rc, seconds and load.
# At the end it kills ONLY the dev-server PID it started.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PORT="${1:-3100}"
OUT="${CERT_OUT:-scripts/r24-out/cert}"
K="${CERT_K:-40}"
FK="${CERT_FIXTURE_K:-200}"
mkdir -p "$OUT"

load() { uptime | sed 's/.*average: //'; }
say() { printf '%s\n' "$*"; }

# Who holds this port? MEASURED IN THIS CONTAINER: `lsof -i:PORT -sTCP:LISTEN`
# does NOT see a `next dev` listener — it shows only that server's ESTABLISHED
# connections — while it happily sees a python http.server on the same kind of
# port. Next binds 0.0.0.0/dual-stack and this lsof view misses the LISTEN row.
# So a guard built on lsof alone would have failed to stop exactly the
# EADDRINUSE collision it exists to prevent. The authoritative question is not
# "does lsof see a socket" but "does anything ANSWER on this port", and the
# answer to "who" comes from /proc, not from lsof.
port_answers() {
  local c
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1/" 2>/dev/null)"
  [ -n "$c" ] && [ "$c" != "000" ]
}
dev_pid_for() {   # PID of a `next dev -p <port>` started from THIS tree
  local port="$1" here p a
  here="$(pwd -P)"
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    a="$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)"
    case "$a" in
      *"next dev -p $port"*)
        [ "$(readlink -f "/proc/$p/cwd" 2>/dev/null)" = "$here" ] && { printf '%s' "$p"; return 0; } ;;
    esac
  done
  return 1
}
holder_desc() {
  local port="$1" p a
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    a="$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)"
    case "$a" in
      *"-p $port"*|*":$port"*)
        printf 'PID %s  cwd=%s  %s' "$p" "$(readlink -f "/proc/$p/cwd" 2>/dev/null)" "$(printf '%s' "$a" | head -c 110)"
        return 0 ;;
    esac
  done
  printf 'not identifiable from /proc (lsof: %s)' "$(lsof -t -i:"$port" 2>/dev/null | tr '\n' ' ')"
}

# --- 1. the port must be OURS ------------------------------------------------
if port_answers "$PORT"; then
  say "REFUSING TO START: something already ANSWERS on port $PORT"
  say "  $(holder_desc "$PORT")"
  say "  It is not mine to kill. Stop it yourself, or pass another port."
  exit 2
fi

TREE_AT_START="$(git rev-parse --short HEAD 2>/dev/null)"
say "=== R24 CERTIFICATION RUN  $(date +%T)  port $PORT  load $(load)"
say "tree at start: $TREE_AT_START  $(git log -1 --format=%s 2>/dev/null | head -c 70)"

# --- 2. node gates first -----------------------------------------------------
NODE_FAIL=0
if [ "${CERT_SKIP_NODE:-0}" != 1 ]; then
  say ""
  say "--- node gates (no browser, no server) ---"
  for g in verify-import-integrity.mjs verify-classify.mjs verify-warbirds.mjs \
           verify-daily.mjs verify-depth-offset.mjs verify-terra-residency.mjs \
           verify-c-flagoff.mjs verify-worker-normals.mjs verify-skirt-worker.mjs \
           verify-lod-fade.mjs verify-vendor-three-tile.mjs verify-skirt-fast.mjs \
           verify-frame-step.mjs verify-finalize-pace.mjs verify-artifact-hygiene.mjs; do
    [ -f "scripts/$g" ] || { printf 'SKIP  %s (absent)\n' "$g"; continue; }
    if node "scripts/$g" > "$OUT/node-$g.log" 2>&1; then
      printf 'PASS  %s\n' "$g"
    else
      printf 'FAIL  %s   -> %s\n' "$g" "$OUT/node-$g.log"
      tail -12 "$OUT/node-$g.log" | sed 's/^/      /'
      NODE_FAIL=$((NODE_FAIL + 1))
    fi
  done
  if [ "$NODE_FAIL" -gt 0 ]; then
    say ""
    say "*** $NODE_FAIL node gate(s) failed. STOPPING before the browser rows."
    say "*** If verify-import-integrity is among them, the app cannot evaluate and"
    say "*** every browser row would have died at bootFly with no canvas — which is"
    say "*** exactly the half hour this script exists to stop repeating."
    exit 1
  fi
fi

# --- 3. exactly one dev server, ours ----------------------------------------
say ""
say "--- starting one dev server on :$PORT ---"
(npm run dev -- -p "$PORT" > "$OUT/dev.log" 2>&1 &)
CODE=000
for _ in $(seq 1 90); do
  sleep 2
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "http://127.0.0.1:$PORT/" 2>/dev/null)"
  [ "$CODE" = "200" ] && break
done
if [ "$CODE" != "200" ]; then
  say "dev server never answered 200 on :$PORT (last $CODE). Tail of $OUT/dev.log:"
  tail -20 "$OUT/dev.log" | sed 's/^/      /'
  exit 2
fi
# Re-read the PID AFTER the 200. MEASURED: the first attempt captured it two
# seconds after launch, before the listener existed, and the retry loop only
# refilled it on a FAILED curl — so a server that came up quickly printed
# "PID unknown" and the cleanup trap had nothing to kill. A script that starts
# a server must know which one it started, or it cannot promise to stop it.
DEV_PID="$(dev_pid_for "$PORT" || true)"
if [ -z "$DEV_PID" ]; then
  say "started a dev server on :$PORT but cannot identify its PID — refusing to"
  say "continue, because I could not promise to clean it up afterwards."
  exit 2
fi
say "dev :$PORT -> 200, PID $DEV_PID  load $(load)"

# Everything this script spawns, so an interrupt does not leave a headless
# browser and a dev server behind. MEASURED the hard way: a `timeout 60` around
# a first test of this script killed the shell but left the boot proof's node
# process AND its chromium running, still holding a fixture port — because a
# child is not in the parent's kill path unless you track it. Only PIDs THIS
# script started are ever touched.
SPAWNED=""
cleanup() {
  local rc=$?
  for p in $SPAWNED; do
    if kill -0 "$p" 2>/dev/null; then
      say "stopping child I started (PID $p)"
      for c in $(pgrep -P "$p" 2>/dev/null); do kill "$c" 2>/dev/null; done
      kill "$p" 2>/dev/null
    fi
  done
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    say "stopping the dev server I started (PID $DEV_PID)"
    kill "$DEV_PID" 2>/dev/null
  fi
  return $rc
}
trap cleanup EXIT INT TERM

export FLY_TILE_FIXTURE=1
export FLY_URL="http://localhost:$PORT"
export FLY_BOOT_SCALE="${CERT_BOOT_SCALE:-6}"
export PW_SHIM_QUIET=1

# --- 4. THE BOOT PROOF -------------------------------------------------------
# One throwaway page. If it cannot reach pct 100 the run stops HERE, with the
# console errors printed — rather than after twelve minutes of browser rows all
# dying at the same wait for the same reason.
# WHICH TREE IS ACTUALLY UNDER TEST? Not necessarily the one in the banner.
# MEASURED: a run stamped 7a00df0 at 19:14:00, a merge landed at 19:14:14, and
# the dev server started at 19:14:15 — so every module the server compiled on
# demand came from 5ca8e15 and the banner named a tree the rows never touched.
# `next dev` serves the WORKING TREE at compile time, not the commit the script
# started on, so the honest stamp is taken here, next to the first page load,
# and a drift is called out rather than left in a log for someone to notice.
TREE_AT_BOOT="$(git rev-parse --short HEAD 2>/dev/null)"
say ""
if [ "$TREE_AT_BOOT" != "$TREE_AT_START" ]; then
  say "*** TREE MOVED DURING STARTUP: $TREE_AT_START -> $TREE_AT_BOOT"
  say "*** The dev server compiles the WORKING TREE on demand, so the rows below"
  say "*** measure $TREE_AT_BOOT. Record that sha, not the banner's."
fi
say "TREE UNDER TEST: $TREE_AT_BOOT"
say "--- boot proof (throwaway page, satellite, fixture) ---"
cat > "$OUT/_bootproof.js" <<'PROOF'
const { chromium } = require('playwright');
const { bootFly } = require('../../_boot');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/_next/')) errs.push('CHUNK FAILED ' + r.url().slice(-80) + ' ' + (r.failure()?.errorText || ''));
  });
  const t0 = Date.now();
  try {
    await bootFly(page, { style: 'satellite', timeoutMs: 300000, settleMs: 2000 });
    console.log(`BOOT OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await b.close();
    process.exit(0);
  } catch (e) {
    console.log(`BOOT FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(e).split('\n')[0]}`);
    const state = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      boot: typeof window.__flyBoot,
      pct: window.__flyBoot?.pct ?? null,
      body: (document.body.innerText || '').slice(0, 120),
    })).catch(() => null);
    console.log('PAGE STATE ' + JSON.stringify(state));
    for (const x of errs.slice(0, 12)) console.log('  ' + x);
    if (state && state.canvases === 0 && state.boot === 'undefined')
      console.log('  DIAGNOSIS: zero canvases and no __flyBoot = the FlyMode dynamic chunk never\n' +
                  '  evaluated. Look at a module-scope ReferenceError first (run\n' +
                  '  node scripts/verify-import-integrity.mjs), then at /_next/ chunk responses.');
    await b.close();
    process.exit(1);
  }
})();
PROOF
timeout 600 node -r ./scripts/_pw-shim.js "$OUT/_bootproof.js" > "$OUT/bootproof.log" 2>&1 &
BP=$!
SPAWNED="$SPAWNED $BP"
wait "$BP"; BP_RC=$?
cat "$OUT/bootproof.log"
if [ "$BP_RC" != 0 ]; then
  say ""
  say "*** BOOT PROOF FAILED — stopping. No browser row can mean anything until"
  say "*** the app mounts. See $OUT/bootproof.log."
  exit 1
fi

if [ "${CERT_PROOF_ONLY:-0}" = 1 ]; then
  say ""
  say "CERT_PROOF_ONLY: stopping after the boot proof. The dev server (PID ${DEV_PID:-unknown})"
  say "is LEFT RUNNING on :$PORT for whoever launches the rows."
  trap - EXIT INT TERM      # do not tear down the server we were asked to leave up
  exit 0
fi

# --- 5. the rows -------------------------------------------------------------
# run <name> <K|-> <script> [extra env...]
#   K = the finalize-budget scaler. "-" means the row must NOT see it: it
#   measures pacing, per-frame ordering or program counts, and a wider budget
#   changes which work lands in which frame.
run() {
  local name="$1" k="$2" script="$3"; shift 3
  [ -f "scripts/$script" ] || { printf '\nSKIP  %s (scripts/%s absent)\n' "$name" "$script"; return; }
  local t0; t0=$(date +%s)
  printf '\n=== %s (K=%s) %s\n' "$name" "$k" "$(date +%T)"
  if [ "$k" != "-" ]; then
    env FLY_FINALIZE_BUDGET_K="$k" "$@" timeout 2400 node -r ./scripts/_pw-shim.js "scripts/$script" > "$OUT/$name.log" 2>&1
  else
    env "$@" timeout 2400 node -r ./scripts/_pw-shim.js "scripts/$script" > "$OUT/$name.log" 2>&1
  fi
  local rc=$? dt=$(( $(date +%s) - t0 ))
  printf 'rc=%s %ss load=%s\n' "$rc" "$dt" "$(load)"
  # NOTCAL is the third verdict (scripts/_notcal.js) — a leg that measured nothing.
  # It must appear in the run summary or a NOT CALIBRATED row reads as a silent row.
  grep -E "^(PASS|FAIL|SKIP|NOTCAL|RED|GREEN|INFO|NOT CALIBRATED|VERIFY)" "$OUT/$name.log" | head -40
}

# CONTENT rows — they ask what the world CONTAINS once settled.
run flash-guard "$K" verify-flash-guard.js
run fade        "$K" verify-fade.js
run lod-fade    "$K" verify-lod-fade.js
# PACING / ORDERING rows — these must NEVER see the budget scaler.
run step-clean   -   verify-step-clean.js
run one-sun      -   verify-one-sun.js
run linear-haze  -   verify-linear-haze.js
run depth-rt     -   verify-depth-roundtrip.js
run ladder-fix   -   verify-ladder-fix.js
run ladder-red   -   verify-ladder-fix.js FLY_LADDER_RED=1
# terra-live's yaw is FRAME-based as of A's b74e5be — 0.85 deg/frame with a
# 360 deg MINIMUM arc, so the sweep length is set in frames, not wall clock. At
# this venue's 1-3 fps that is ~424 rendered frames, i.e. 7-8 minutes per arm,
# and the row wants ~30-35 minutes of the budget with both arms. The point of
# paying for it: under the old wall-clock window gate 6 could not complete a
# full revolution, so "the same tile URL is not fetched twice as the heading
# comes back round" never actually brought the heading back round. It asserts
# for real at this length.
run terra-live  "$K" verify-terra-live.js FLY_TERRA_ARMS=both FLY_TERRA_SWEEP_MS=600000
run frame-pace   -   verify-frame-pace.js
# LAST, and longest: the four-pose census. Manhattan's sixteen dense chunks do
# not settle at K=40 in this venue (measured: 12 still draping at 300 s on
# quiet cores), so it gets its own K and a 900 s per-pose cap.
run fixture     "$FK" verify-fixture.js FLY_FIXTURE_SETTLE_MS=900000

say ""
say "=== CERT DONE $(date +%T)  load $(load)"
say "logs: $OUT/"

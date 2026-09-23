#!/bin/bash
# R25 browser-slot wrapper: at most TWO SwiftShader browser gates run at once
# across all five role worktrees (4 cores). Usage:
#   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/<gate>
# Blocks until a slot is free, runs the command, releases the slot, exits with
# the command's status.
while true; do
  for i in 0 1; do
    exec 9>"/tmp/r25-locks/browser-$i.lock"
    if flock -n 9; then
      echo "[r25-slot] acquired browser slot $i for: $*" >&2
      "$@"; rc=$?
      flock -u 9; exec 9>&-
      exit $rc
    fi
    exec 9>&-
  done
  sleep 5
done

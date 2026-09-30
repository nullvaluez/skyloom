#!/bin/sh
# Build the Overture -> OMT vector tile set for every trailer location (resumable).
#   lane A: extract.py <loc>   (Overture row-group reads -> GeoJSON blocks; 1 core)
#   lane B: tile_blocks.mjs <loc> as soon as that location's blocks are DONE (1 core)
# Then sources sampling, manifest and real-worker validation.
# Usage: sh build_mvt.sh [loc ...]      (default: nyc dubai sydney rio alps paris london)
set -e
cd "$(dirname "$0")"
LOCS="${*:-nyc dubai sydney rio alps paris london}"
LOG=/tmp/claude-0/world/logs
mkdir -p "$LOG"
nice -n 15 python3 ovt_index.py >/dev/null
( for l in $LOCS; do nice -n 15 python3 extract.py "$l" >>"$LOG/extract_$l.log" 2>&1 || echo "extract $l FAILED" >>"$LOG/build.log"; done ) &
for l in $LOCS; do
  until [ -f "/tmp/claude-0/world/cache/blocks/$l/DONE.json" ]; do sleep 10; done
  nice -n 15 node tile_blocks.mjs "$l" >>"$LOG/tile_$l.log" 2>&1
  nice -n 15 python3 sources_sample.py "$l" 3 >/dev/null 2>&1 || true
  echo "$(date -u +%FT%TZ) $l tiled" >>"$LOG/build.log"
done
wait
nice -n 15 python3 make_manifest.py
nice -n 15 node validate_worker.cjs $LOCS 2>&1 | grep -v 'MODULE_TYPELESS\|Reparsing\|To eliminate\|trace-warnings' >"$LOG/validate.log"
nice -n 15 python3 make_manifest.py

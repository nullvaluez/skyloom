#!/usr/bin/env bash
# Trailer world: ESA WorldCover tiles, then DEM (terrain-rgb) tiles, then validation.
# Order matters: the DEM's water flatten and Sydney de-spike read the WorldCover tiles.
# Idempotent/resumable: existing tiles are skipped; the Terrarium cache makes DEM rebuilds offline.
#   scripts/trailer/world/run_dem_worldcover.sh [nyc,dubai,...]      (default: all, priority order)
set -euo pipefail
cd "$(dirname "$0")"
LOCS="${1:-}"
ARGS=(); [ -n "$LOCS" ] && ARGS=(--locs "$LOCS")
nice -n 15 python3 build_worldcover.py "${ARGS[@]}"
nice -n 15 python3 build_dem.py "${ARGS[@]}"
nice -n 15 python3 check_worldcover.py "${ARGS[@]}"
nice -n 15 python3 check_dem.py "${ARGS[@]}"

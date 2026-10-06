/**
 * TRUE EARTH — the diagnostics overlay switch and benchmark route.
 * `?diag=1` (read once per page load) mounts the overlay and its frame-totals
 * collector; nothing else in the app reads or allocates for it otherwise.
 */
let requested = null;
export function diagRequested() {
  if (requested !== null) return requested;
  if (typeof window === 'undefined') return false;
  try {
    requested = new URLSearchParams(window.location.search).get('diag') === '1' || window.__flyDiag === true;
  } catch {
    requested = false;
  }
  return requested;
}

/**
 * The fixed benchmark: warp to the Battery, 900 m, heading north (0 rad), and
 * fly straight up Manhattan with no input, under a pinned June-afternoon sun
 * and baseline weather. Same start, same scene, every device and build.
 */
export const DIAG_BENCH = {
  id: 'manhattan-north-900m',
  lat: 40.7033,
  lon: -74.017,
  altM: 900,
  headingRad: 0,
  // 2026-06-21 18:00 UTC = 14:00 in New York: high sun, long city shadows.
  sunUtcMs: Date.UTC(2026, 5, 21, 18, 0, 0),
  settleMs: 3000,
  captureMs: 60000,
  revealTimeoutMs: 45000,
};

/**
 * SHIP PASS (FLY_SHIP_PASS.md section 6) — the frame contracts FRAME provides
 * to the other streams. FRAME owns this file and implements it; consumers
 * import only from here.
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   FRAME_RATE_KEY                         'fly-frame-rate-v1' (RELEASE whitelists it for backups)
 *   setFrameCadence(mode)                  mode '60' | 'display' | '30' (FR-9); persisted under FRAME_RATE_KEY
 *   frameCadence() → mode                  the current mode
 *   holdGovernor(reason) → release()       while any hold is live the quality governor neither steps
 *                                          down nor up (LIGHT's photo capture, LT-6); release() is idempotent
 *   governorHolds() → string[]             the live hold reasons (diagnostics)
 *   frameSessionSummary() → { p95Bucket, stallsPerMin, rung }
 *                                          RELEASE's analytics perf_summary (RL-6); coarse buckets only
 *
 * W0 STUB: the cadence is '60' and is not persisted; holds are counted but
 * nothing reads them yet; the summary is all nulls.
 */
export const FRAME_RATE_KEY = 'fly-frame-rate-v1';
export const FRAME_CADENCE_MODES = Object.freeze(['60', 'display', '30']);

let cadence = '60';
const holds = new Map();
let nextHold = 1;

export function setFrameCadence(mode) {
  if (FRAME_CADENCE_MODES.includes(mode)) cadence = mode;
  return cadence;
}

export function frameCadence() {
  return cadence;
}

export function holdGovernor(reason = 'unnamed') {
  const id = nextHold++;
  holds.set(id, String(reason));
  return () => {
    holds.delete(id);
  };
}

export function governorHolds() {
  return [...holds.values()];
}

export function frameSessionSummary() {
  return { p95Bucket: null, stallsPerMin: null, rung: null };
}

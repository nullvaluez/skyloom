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
 * Additive (FRAME, this pass): FRAME_CADENCE_MODES, subscribeFrameCadence,
 * resolveFrameCadence, governorHeld, cadenceState / noteCadence (the governor
 * publishes its refresh, lock and target here; FlyCanvas and the report read
 * them) and frameReportFields (the device-report block).
 *
 * WHAT IS LIVE WITH PACE_ADAPT OFF. The mode persists and holds work (LIGHT's
 * photo capture needs a frozen governor whatever this pass's flags say); the
 * mode is APPLIED to the frameloop and the governor target only with
 * PACE_ADAPT on (lib/fly/pace-adapt.js), so flag-off pacing is today's.
 */
import { shipPassOn } from './ship-pass';
import { devicePolicyReport } from './device-policy';

export const FRAME_RATE_KEY = 'fly-frame-rate-v1';
export const FRAME_CADENCE_MODES = Object.freeze(['60', 'display', '30']);

let cadence = null;
const listeners = new Set();
const holds = new Map();
let nextHold = 1;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The saved mode ('60' when absent, corrupt or storage is blocked). Read once. */
export function resolveFrameCadence() {
  if (cadence) return cadence;
  let saved = null;
  try {
    saved = storage()?.getItem(FRAME_RATE_KEY) ?? null;
  } catch {
    saved = null;
  }
  cadence = FRAME_CADENCE_MODES.includes(saved) ? saved : '60';
  return cadence;
}

/** Set (and persist) the mode. Unknown modes are ignored. Returns the mode. */
export function setFrameCadence(mode) {
  resolveFrameCadence();
  if (!FRAME_CADENCE_MODES.includes(mode) || mode === cadence) return cadence;
  cadence = mode;
  try {
    storage()?.setItem(FRAME_RATE_KEY, mode);
  } catch {
    /* blocked storage: the mode still applies for this session */
  }
  listeners.forEach((fn) => fn(mode));
  return cadence;
}

export function frameCadence() {
  return resolveFrameCadence();
}

export function subscribeFrameCadence(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
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

/** True while any hold is live (the governor's per-frame read; no allocation). */
export function governorHeld() {
  return holds.size > 0;
}

// --- cadence state (published by the governor and the display probe) -------
const cstate = { displayHz: null, refresh: null, locked: null, targetFps: null, bootRung: 0, rung: 0 };
const cstateSubs = new Set();
let cversion = 0;

/** Merge fields into the published cadence state; notifies on change. */
export function noteCadence(fields) {
  let changed = false;
  for (const [k, v] of Object.entries(fields)) {
    if (cstate[k] !== v) {
      cstate[k] = v;
      changed = true;
    }
  }
  if (changed) {
    cversion++;
    cstateSubs.forEach((fn) => fn());
  }
}

export function cadenceState() {
  return cstate;
}

/** useSyncExternalStore pair: a version number that moves on every change. */
export function cadenceVersion() {
  return cversion;
}
export function subscribeCadence(fn) {
  cstateSubs.add(fn);
  return () => cstateSubs.delete(fn);
}

// --- session summary (RELEASE perf_summary) ---------------------------------
const P95_BUCKETS = [16.7, 20, 33.3, 50, 100];
const STALL_BUCKETS = [0, 1, 2, 5, 10];

/** '<=16.7' … '>100' — the coarse p95 frame-time bucket. */
export function p95Bucket(p95) {
  if (!Number.isFinite(p95) || p95 <= 0) return null;
  for (const b of P95_BUCKETS) if (p95 <= b) return `<=${b}`;
  return '>100';
}

/** Stalls (>100 ms intervals) per minute rounded UP to 0, 1, 2, 5, 10, or '>10'. */
export function stallBucket(perMin) {
  if (!Number.isFinite(perMin) || perMin < 0) return null;
  for (const b of STALL_BUCKETS) if (perMin <= b) return b;
  return '>10';
}

export function frameSessionSummary() {
  const f = typeof window !== 'undefined' ? window.__flyStats?.frame : null;
  const s = typeof f?.sample === 'function' ? f.sample() : null;
  return {
    p95Bucket: s ? p95Bucket(s.p95) : null,
    stallsPerMin: s ? stallBucket(s.long100PerMin) : null,
    rung: Number.isFinite(cstate.rung) ? cstate.rung : null,
  };
}

/** The device-report fields FRAME adds (lib/fly/device-report.js FRAME block). */
export function frameReportFields() {
  const gov = typeof window !== 'undefined' && typeof window.__flyGov?.state === 'function' ? window.__flyGov.state() : null;
  return {
    pacing: {
      paceAdapt: shipPassOn('PACE_ADAPT'),
      mode: frameCadence(),
      displayHz: cstate.displayHz,
      refresh: cstate.refresh,
      cadenceLock: cstate.locked,
      targetFps: cstate.targetFps,
      bootRung: cstate.bootRung,
      holds: governorHolds(),
      governor: gov,
    },
    // FR-10 / FR-11: the device class, the boot benchmark's score and start decision.
    devicePolicy: devicePolicyReport(),
  };
}

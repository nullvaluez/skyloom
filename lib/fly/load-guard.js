/**
 * TRUE EARTH — LOAD_GUARD: the boot and warp holds can no longer hang.
 * One pin read; the readiness rings, the vendored terrain patch and the two
 * hold screens ask these helpers (scripts/verify-load-guard.mjs).
 */
import { pinned } from './fly-pins';
import { LOAD_GUARD } from './fly-constants';

/** The resolved LOAD_GUARD block (URL / console pins applied once, at load). */
export const LOAD_GUARD_ACTIVE = pinned(LOAD_GUARD, '__flyLoadGuardOverride');

const sub = (guard, key) => guard?.enabled === true && guard[key] !== false;

/** A provider-empty ('no-data') tile counts as done: waiting cannot change it. */
export function noDataCountsReady(guard = LOAD_GUARD_ACTIVE) {
  return sub(guard, 'noDataReady');
}

/** three-tile: settle an epoch whose update changed nothing (VENDOR.md R26-1). */
export function settleNoopOn(guard = LOAD_GUARD_ACTIVE) {
  return sub(guard, 'settleNoop');
}

/** The hard hold limit in ms for 'boot' or 'warp', or null when uncapped. */
export function holdCapMs(kind, guard = LOAD_GUARD_ACTIVE) {
  if (guard?.enabled !== true) return null;
  const ms = kind === 'boot' ? guard.bootCapMs : guard.warpCapMs;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

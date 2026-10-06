/**
 * TRUE EARTH — DEVICE_TIERS: start at the tier the GPU can carry, and step
 * down without recompiling shaders until there is nothing cheaper left.
 * scripts/verify-device-tiers.mjs.
 */
import { pinned } from './fly-pins';
import { DEVICE_TIERS } from './fly-constants';
import { gpuClass, isMobileGraphicsClass, readGpuInfo } from './device-class';

/** The resolved DEVICE_TIERS block (URL / console pins applied once, at load). */
export const DEVICE_TIERS_ACTIVE = pinned(DEVICE_TIERS, '__flyDeviceTiersOverride');

const sub = (key, active = DEVICE_TIERS_ACTIVE) => active?.enabled === true && active[key] !== false;

let cachedClass = null;
/** The session's GPU class (one throwaway context, read once). */
export function sessionGpuClass() {
  if (!cachedClass) cachedClass = gpuClass(readGpuInfo().renderer, { coarse: isMobileGraphicsClass() });
  return cachedClass;
}

/**
 * The start tier the GPU implies, or null to keep the existing policy
 * (flag off, or a phone: phones keep the post-R16 phone policy).
 */
export function gpuStartTier(active = DEVICE_TIERS_ACTIVE, cls = null) {
  if (!sub('startTier', active)) return null;
  const c = cls ?? sessionGpuClass().cls;
  return c === 'high' ? 'high' : c === 'medium' ? 'medium' : c === 'low' ? 'low' : null;
}

/** Governor: program-stable rungs before render scale, cascade drops after. */
export function ladderOrderOn(active = DEVICE_TIERS_ACTIVE) {
  return sub('ladderOrder', active);
}

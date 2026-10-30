/**
 * SHIP PASS (FLY_SHIP_PASS.md FR-10, FR-11) — the one device policy.
 *
 * Every feature this pass adds asks here which devices may run it and with
 * what budget, instead of calling isPhoneClass() / isMobileGraphicsClass()
 * itself (FLY_SHIP_PASS.md 3.2 "Device gating"; a grep gate in
 * verify-ship-frame enforces it).
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   deviceClassOf(ctx?)        → 'phone' | 'tablet' | 'igpu' | 'dgpu' | 'software'
 *   deviceFeature(name, ctx?)  → { allowed: boolean, budget: object }
 * `ctx` is optional and only for callers that already know the answer
 * (node gates, the device report): { cls, tier, preset }. A browser caller
 * passes nothing, or the tier it is rendering at ({ tier }).
 *
 * W0 STUB: the class is today's equivalents (device-class.js + the session
 * GPU class), and the table rows below are the gates each feature would have
 * written for itself today. FRAME owns this file and replaces the table with
 * the measured one (FR-11) and the boot benchmark (FR-10, DEVICE_POLICY);
 * the signatures stay.
 */
import { isMobileGraphicsClass, isPhoneClass } from './device-class';
import { sessionGpuClass } from './device-tiers';

/** The session's device class (read live; cheap after the first call). */
export function deviceClassOf(ctx = {}) {
  if (ctx.cls) return ctx.cls;
  if (typeof window === 'undefined') return 'dgpu';
  const gpu = sessionGpuClass().cls;
  if (gpu === 'low') return 'software';
  if (isPhoneClass()) return 'phone';
  if (isMobileGraphicsClass()) return 'tablet';
  return gpu === 'high' ? 'dgpu' : 'igpu';
}

const TOUCH = new Set(['phone', 'tablet']);
const tierOf = (ctx) => ctx.tier ?? 'high';
const presetOf = (ctx) => ctx.preset ?? ctx.tier ?? 'high';

/*
 * One row per feature: (cls, tier, preset) → { allowed, budget }. Budgets are
 * plain data (ms, draws, metres, pixels); a row never reads the GPU itself.
 */
const POLICY = {
  // SKY (SK-4): the cheap sky for Medium and touch devices.
  SKY_LITE: (cls, ctx) => ({
    allowed: TOUCH.has(cls) || tierOf(ctx) !== 'high',
    budget: { aerialGpuMs: 0.6, aerialDraws: 0, cloudDraws: 1, cloudSamples: 1, cloudReach: 0.5 },
  }),
  // CITY (CT-2): the detailed city reaches farther only on desktop High/Ultra.
  CITY_RANGE: (cls, ctx) => ({
    allowed: cls !== 'software',
    budget: { detailedM: !TOUCH.has(cls) && tierOf(ctx) === 'high' ? 4500 : null },
  }),
  // CITY (CT-4): city light from altitude where the near ring is all there is.
  NIGHT_LITE: (cls, ctx) => ({
    allowed: TOUCH.has(cls) || tierOf(ctx) === 'low',
    budget: { draws: 2, reachM: 60000 },
  }),
  // LIGHT (LT-2): a terrain shadow map on desktop, a CPU horizon map on touch.
  TERRAIN_SHADOW: (cls, ctx) => ({
    allowed: cls !== 'software' && tierOf(ctx) !== 'low',
    budget: TOUCH.has(cls)
      ? { path: 'horizon', gridN: 64, hz: 1, gpuMs: 0.3 }
      : { path: 'map', mapSize: tierOf(ctx) === 'high' ? 2048 : 1024, rangeM: tierOf(ctx) === 'high' ? 40000 : 20000, hz: 2, draws: 1, gpuMs: 0.6 },
  }),
  // LIGHT (LT-3): real casters on desktop High/Ultra, contact blobs elsewhere.
  TRAFFIC_SHADOWS: (cls, ctx) => ({
    allowed: cls !== 'software',
    budget: { path: !TOUCH.has(cls) && tierOf(ctx) === 'high' ? 'caster' : 'blob', draws: 2, blobBelowAglM: 60 },
  }),
  // LIGHT (LT-4): the player receives shadows on High and Ultra (not phones).
  AIRFRAME_SHADOW: (cls, ctx) => ({ allowed: cls !== 'phone' && cls !== 'software' && tierOf(ctx) === 'high', budget: {} }),
  // LIGHT (LT-5): altitude-following shadow reach on Medium desktops.
  SHADOW_REACH: (cls, ctx) => ({ allowed: !TOUCH.has(cls) && cls !== 'software' && tierOf(ctx) === 'medium', budget: { maxRangeM: 1200 } }),
  // LIGHT (LT-6): supersampled photo export.
  PHOTO_HIRES: (cls) => ({ allowed: cls !== 'software', budget: { maxScale: TOUCH.has(cls) ? 2 : 3, maxLongPx: TOUCH.has(cls) ? 4096 : 4096 } }),
  // LIVING WORLD (AIRFRAME_DETAIL) today: everything but phones and Low.
  AIRFRAME_DETAIL: (cls, ctx) => ({ allowed: cls !== 'phone' && tierOf(ctx) !== 'low', budget: {} }),
  // FRAME (FR-12): supersampling only on a discrete GPU at Ultra.
  ULTRA_SUPERSAMPLE: (cls, ctx) => ({ allowed: cls === 'dgpu' && presetOf(ctx) === 'ultra', budget: { maxScale: 1.5 } }),
};

/** The feature names the table knows (node gates enumerate them). */
export const POLICY_FEATURES = Object.freeze(Object.keys(POLICY));

/** The device classes the table answers for (node gates enumerate them). */
export const DEVICE_CLASSES = Object.freeze(['phone', 'tablet', 'igpu', 'dgpu', 'software']);

/** { allowed, budget } for `name` on this device (unknown names: allowed, no budget). */
export function deviceFeature(name, ctx = {}) {
  const row = POLICY[name];
  if (!row) return { allowed: true, budget: {} };
  return row(deviceClassOf(ctx), ctx);
}

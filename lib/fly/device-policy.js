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
 * (node gates, the device report): { cls, tier, preset, score,
 * reversedDepth }. A browser caller passes nothing, or the tier it is
 * rendering at ({ tier }).
 *
 * FRAME (FR-11): the table below is the policy. It is LIVE regardless of
 * DEVICE_POLICY, because SKY, CITY and LIGHT consume it for their own flags;
 * with DEVICE_POLICY off (no benchmark score) every W0 seed row answers
 * exactly what it answered at W0. DEVICE_POLICY on adds the boot benchmark's
 * `score` (FR-10, lib/fly/gpu-benchmark.js) as the third key: a 'high' score
 * lets a tablet at High keep the full sky, a tablet needs at least 'medium'
 * for AIRFRAME_DETAIL, and Ultra supersampling requires 'high'.
 *
 * Class order (FRAME, this pass): a touch device is 'phone' / 'tablet' even
 * when its renderer is software — that is an emulated phone in a harness,
 * and the phone policy is exactly what such a harness exists to exercise. A
 * real phone never has a software renderer. Only a non-touch software
 * renderer is 'software'.
 *
 * THE CLASS PIN (FRAME, LIGHT's contract request): `window.
 * __flyDeviceClassOverride = 'phone' | 'tablet' | 'igpu' | 'dgpu' |
 * 'software'` makes deviceClassOf() answer that class for the session (dev
 * and harness use: this venue's SwiftShader is class 'software', which most
 * rows refuse, so a harness pins the class it exercises). It changes only
 * what reads deviceClassOf() / deviceFeature() — not device-class.js's tier
 * resolution. Any other value is ignored. `ctx.cls` still wins (a caller
 * that already knows the answer).
 */
import { isMobileGraphicsClass, isPhoneClass, readGpuInfo } from './device-class';
import { sessionGpuClass } from './device-tiers';
import { shipPassBlock, shipPassOn } from './ship-pass';
import { benchmarkScore, decideStart } from './gpu-benchmark';

/** The session's device class (read live; cheap after the first call). */
export function deviceClassOf(ctx = {}) {
  if (ctx.cls) return ctx.cls;
  if (typeof window === 'undefined') return 'dgpu';
  const pin = window.__flyDeviceClassOverride;
  if (pin != null && CLASS_PINS.has(pin)) return pin;
  if (isPhoneClass()) return 'phone';
  if (isMobileGraphicsClass()) return 'tablet';
  const gpu = sessionGpuClass().cls;
  if (gpu === 'low') return 'software';
  return gpu === 'high' ? 'dgpu' : 'igpu';
}

const TOUCH = new Set(['phone', 'tablet']);
/** The values `window.__flyDeviceClassOverride` may take (DEVICE_CLASSES). */
const CLASS_PINS = new Set(['phone', 'tablet', 'igpu', 'dgpu', 'software']);
const tierOf = (ctx) => ctx.tier ?? 'high';
const presetOf = (ctx) => ctx.preset ?? ctx.tier ?? 'high';
/** The session's benchmark score; a software renderer is not measured (gpu-benchmark.js). */
const sessionScore = () => benchmarkScore({ skip: deviceClassOf() === 'software' ? 'software' : null });
/** The benchmark score in force: ctx.score, else the cached one when DEVICE_POLICY is on. */
const scoreOf = (ctx) => (ctx.score !== undefined ? ctx.score : shipPassOn('DEVICE_POLICY') ? sessionScore() : null);
const scoreAtLeast = (ctx, grade) => {
  const g = scoreOf(ctx)?.grade;
  return grade === 'high' ? g === 'high' : g === 'high' || g === 'medium';
};

/*
 * One row per feature: (cls, ctx = { tier, preset, score }) → { allowed, budget }.
 * Budgets are plain data (ms, draws, metres, pixels); a row never reads the
 * GPU itself. Rows marked "seed" return the W0 answer whenever there is no
 * score; the FRAME notes say what a score changes.
 */
const POLICY = {
  // SKY (SK-4, seed): the cheap sky for Medium and touch devices. FR-11: a
  // tablet with a 'high' benchmark at High tier keeps the full sky.
  SKY_LITE: (cls, ctx) => ({
    allowed: (TOUCH.has(cls) && !(cls === 'tablet' && tierOf(ctx) === 'high' && scoreAtLeast(ctx, 'high'))) || tierOf(ctx) !== 'high',
    budget: { aerialGpuMs: 0.6, aerialDraws: 0, cloudDraws: 1, cloudSamples: 1, cloudReach: 0.5 },
  }),
  // CITY (CT-2, seed): the detailed city reaches farther only on desktop High/Ultra.
  CITY_RANGE: (cls, ctx) => ({
    allowed: cls !== 'software',
    budget: { detailedM: !TOUCH.has(cls) && tierOf(ctx) === 'high' ? 4500 : null },
  }),
  // CITY (CT-4, seed): city light from altitude where the near ring is all there is.
  NIGHT_LITE: (cls, ctx) => ({
    allowed: TOUCH.has(cls) || tierOf(ctx) === 'low',
    budget: { draws: 2, reachM: 60000 },
  }),
  // LIGHT (LT-2, seed): a terrain shadow map on desktop, a CPU horizon map on touch.
  TERRAIN_SHADOW: (cls, ctx) => ({
    allowed: cls !== 'software' && tierOf(ctx) !== 'low',
    budget: TOUCH.has(cls)
      ? { path: 'horizon', gridN: 64, hz: 1, gpuMs: 0.3 }
      : { path: 'map', mapSize: tierOf(ctx) === 'high' ? 2048 : 1024, rangeM: tierOf(ctx) === 'high' ? 40000 : 20000, hz: 2, draws: 1, gpuMs: 0.6 },
  }),
  // LIGHT (LT-3, seed): real casters on desktop High/Ultra, contact blobs elsewhere.
  TRAFFIC_SHADOWS: (cls, ctx) => ({
    allowed: cls !== 'software',
    budget: { path: !TOUCH.has(cls) && tierOf(ctx) === 'high' ? 'caster' : 'blob', draws: 2, blobBelowAglM: 60 },
  }),
  // LIGHT (LT-4, seed): the player receives shadows on High and Ultra (not phones).
  AIRFRAME_SHADOW: (cls, ctx) => ({ allowed: cls !== 'phone' && cls !== 'software' && tierOf(ctx) === 'high', budget: {} }),
  // LIGHT (LT-5, seed): altitude-following shadow reach on Medium desktops.
  SHADOW_REACH: (cls, ctx) => ({ allowed: !TOUCH.has(cls) && cls !== 'software' && tierOf(ctx) === 'medium', budget: { maxRangeM: 1200 } }),
  // LIGHT (LT-6, seed): supersampled photo export. FRAME (LIGHT's contract
  // request): touch maxScale 2 → 3 — at 2 a 585×1266 phone buffer exports a
  // 2,532 px long edge, short of LT-6's 2,560 px; maxLongPx 4096 still caps
  // the export (and its memory) on every class.
  PHOTO_HIRES: (cls) => ({ allowed: cls !== 'software', budget: { maxScale: 3, maxLongPx: 4096 } }),
  // LIVING WORLD (AIRFRAME_DETAIL, seed): everything but phones and Low.
  // FR-11: with a benchmark score, a tablet needs at least 'medium'.
  AIRFRAME_DETAIL: (cls, ctx) => ({
    allowed: cls !== 'phone' && tierOf(ctx) !== 'low' && !(cls === 'tablet' && scoreOf(ctx) && !scoreAtLeast(ctx, 'medium')),
    budget: {},
  }),
  // FRAME (FR-12, seed): supersampling only on a discrete GPU at Ultra;
  // FR-10: with a benchmark score, only a 'high' one.
  ULTRA_SUPERSAMPLE: (cls, ctx) => ({
    allowed: cls === 'dgpu' && presetOf(ctx) === 'ultra' && (scoreOf(ctx) == null || scoreAtLeast(ctx, 'high')),
    budget: { maxScale: 1.5 },
  }),
  // FRAME (FR-9): Battery saver (30 fps + the phone-lean profile) is a touch
  // setting, Match display a desktop one; the mid-session 30 Hz cadence lock
  // (FR-5) is trusted by default on touch devices (lib/fly/pace-adapt.js).
  BATTERY_SAVER: (cls) => ({ allowed: TOUCH.has(cls), budget: { fps: 30, effectFloor: 3 } }),
  MATCH_DISPLAY: (cls) => ({ allowed: !TOUCH.has(cls), budget: {} }),
  CADENCE_LOCK: (cls) => ({ allowed: TOUCH.has(cls), budget: { lockHz: 30 } }),
  // FRAME (FR-13): the dynamic near plane, only where the renderer has no
  // reversed depth (ctx.reversedDepth === false). Every renderer that reports
  // reversed depth (the 5080, desktop Chrome) never runs it.
  DYNAMIC_NEAR: (cls, ctx) => ({
    allowed: ctx.reversedDepth === false && cls !== 'software',
    budget: { k: 0.02, minM: 2.5, maxM: 60 },
  }),
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

let start;
/**
 * FR-10 (DEVICE_POLICY): the benchmark's start decision for this session —
 * { grade, tier, preset, dprCap, tabletDesktopEffects } — or null with the
 * flag off or no score. lib/fly/fly-settings.js (FRAME start tier block),
 * render-resolution.js (Ultra DPR cap) and cinema-policy.js (tablet effects)
 * read it. Resolved once.
 */
export function benchmarkStart() {
  if (start !== undefined) return start;
  if (!shipPassOn('DEVICE_POLICY') || typeof window === 'undefined') return (start = null);
  const score = sessionScore();
  if (!score) return (start = null);
  const masked = /^Apple GPU$/i.test(readGpuInfo().renderer.trim());
  const t = shipPassBlock('DEVICE_POLICY')?.benchmark?.thresholds;
  start = decideStart({ score, cls: deviceClassOf(), masked, ...(t ? { thresholds: t } : {}) });
  (window.__flyStats ??= {}).devicePolicy = { cls: deviceClassOf(), score, start };
  return start;
}

/** The device-report block (FR-10, FR-11): class, score, start decision. */
export function devicePolicyReport() {
  return { on: shipPassOn('DEVICE_POLICY'), cls: deviceClassOf(), score: shipPassOn('DEVICE_POLICY') ? sessionScore() : null, start: benchmarkStart() };
}

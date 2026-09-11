/** Shared visual-only ground signal. No flight model or collision writes. */
import { graphicsReviewOn } from './satellite-visuals';
export const NEAR_GROUND = Object.freeze({
  enterM: 560, exitM: 700, fullM: 160, fadeM: 650, responseSec: 0.65,
  detail: { radiusM: 220, cellWorldM: 18, pool: 640, fadeStartM: 130,
    tiers: { high: 1, medium: 0.52, low: 0.18 } },
});
const FEATURES = new Set(['detail', 'materials', 'camera', 'audio', 'lighting', 'shading', 'pools']);
export const clampGround = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export function groundSmooth(a, b, value) {
  const t = clampGround((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/** Dev/review A/B toggles change uniforms; the shared signal keeps running. */
export function nearGroundOn(feature) {
  if (feature && !FEATURES.has(feature)) return false;
  const flags = (process.env.NODE_ENV === 'development' || graphicsReviewOn()) && typeof window !== 'undefined'
    ? window.__flyGroundFeatures : null;
  return flags !== false && flags?.all !== false && (!feature || flags?.[feature] !== false);
}
export function stepNearGround(previous, { aglM, speedMps = 0, boostMps = 750,
  satellite = true, epoch = 0, dt = 1 / 60 }) {
  const valid = Number.isFinite(aglM), agl = valid ? Math.max(0, aglM) : Infinity;
  const snap = !previous || previous.epoch !== epoch;
  const active = satellite && valid && (snap || !previous.active ? agl < NEAR_GROUND.enterM : agl < NEAR_GROUND.exitM);
  const target = active ? 1 - groundSmooth(NEAR_GROUND.fullM, NEAR_GROUND.fadeM, agl) : 0;
  const weight = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) / NEAR_GROUND.responseSec);
  const speed = groundSmooth(0.08, 0.75, Math.max(0, speedMps) / Math.max(1, boostMps));
  return { aglM: agl, k: !satellite ? 0 : snap ? target : clampGround(previous.k + (target - previous.k) * weight),
    speedK: snap ? speed : clampGround(previous.speedK + (speed - previous.speedK) * weight), epoch, active };
}
export function stepNearGroundRuntime(runtime, flight, dt, state) {
  const ground = Number.isFinite(runtime.groundElevVis) ? runtime.groundElevVis : flight.groundElev;
  runtime.groundImmersion = stepNearGround(runtime.groundImmersion, {
    aglM: Number.isFinite(ground) ? flight.pos.y - ground : Infinity,
    speedMps: flight.speed, boostMps: flight.cfg?.speeds?.boost,
    satellite: state.mapStyle === 'satellite', epoch: state.warpEpoch ?? 0, dt,
  });
  return runtime.groundImmersion;
}
/** Zero at rest/reduced motion; no shake and at most 0.85 degrees extra FOV. */
export function groundCameraCue(signal, reducedMotion = false) {
  return reducedMotion ? 0 : clampGround(signal?.k) * clampGround(signal?.speedK);
}
export function groundAudioCue(signal) {
  return clampGround(signal?.k) * clampGround(signal?.speedK);
}

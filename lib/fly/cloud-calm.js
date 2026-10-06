/**
 * TRUE EARTH fix — CLOUD_CALM: steadier clouds and haze when flying low (the
 * block in fly-constants.js says why). Pure helpers: FlyScene steps the haze
 * ground once per frame; the aerial pass, the cloud composite and the cloud
 * density read the results. With the flag off every reader gets exactly the
 * value it read before.
 */
import { pinned } from './fly-pins.js';
import { CLOUD_CALM } from './fly-constants.js';

/** The resolved CLOUD_CALM block (URL / console pins applied once, at load). */
export const CLOUD_CALM_ACTIVE = pinned(CLOUD_CALM, '__flyCloudCalmOverride');
export function cloudCalmOn() {
  return CLOUD_CALM_ACTIVE.enabled === true;
}
/** Cloud noise sampled relative to the cloud base (the deck moves as a whole). */
export function cloudNoiseFollowsBase() {
  return cloudCalmOn() && CLOUD_CALM_ACTIVE.noiseFollowsBase !== false;
}

/**
 * One frame of the haze reference ground: `groundElev` damped with time
 * constant `tauSec`. A new warp epoch (or an empty state) re-seeds it with no
 * glide; a non-finite sample keeps the previous value.
 */
export function stepHazeGround(state, groundElev, epoch, dt, tauSec = CLOUD_CALM_ACTIVE.hazeGroundSec) {
  if (!Number.isFinite(groundElev)) return Number.isFinite(state.y) ? state.y : 0;
  if (!Number.isFinite(state.y) || state.epoch !== epoch) {
    state.y = groundElev;
    state.epoch = epoch;
    return state.y;
  }
  const seconds = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
  const tau = Math.max(1e-3, Number.isFinite(tauSec) ? tauSec : 8);
  state.y += (groundElev - state.y) * (1 - Math.exp(-seconds / tau));
  return state.y;
}

/** The ground height the haze laws measure from: `rawGroundY` when off. */
export function hazeGroundY(runtime, rawGroundY) {
  return cloudCalmOn() && Number.isFinite(runtime?.hazeGround?.y) ? runtime.hazeGround.y : rawGroundY;
}

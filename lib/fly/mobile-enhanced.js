import { MOBILE_ENHANCED } from './fly-constants';
import { pinned } from './fly-pins';
import { isMobileGraphicsClass } from './device-class';
import { useFlyStore } from '../../stores/fly-store';

export function resolveMobileEnhanced() {
  return pinned(MOBILE_ENHANCED, '__flyMobileEnhancedOverride');
}

/** Live gate: returning to Classic/Low must restore its existing budget/look. */
export function mobileEnhancedOn(state = useFlyStore.getState(), mobile = isMobileGraphicsClass()) {
  return resolveMobileEnhanced().enabled === true && mobile
    && state.mapStyle === 'satellite' && state.visuals === 'enhanced'
    && (state.qualityTier === 'medium' || state.qualityTier === 'high');
}

/** True metres. Invalid/unknown ground never inflates the shadow working set. */
export function mobileShadowRange(baseM, aglM, config = MOBILE_ENHANCED) {
  if (!Number.isFinite(aglM) || aglM < 0) return baseM;
  return Math.max(baseM, Math.min(config.shadowMaxRangeM,
    aglM * config.shadowAglScale + config.shadowPaddingM));
}

/** Smooth only actual motion; warps seed a new range, so the old city cannot lag. */
export function stepMobileShadowRange(previous, targetM, epoch, dt, responseSec = 1) {
  if (!previous || previous.epoch !== epoch) return { rangeM: targetM, epoch };
  const seconds = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
  previous.rangeM += (targetM - previous.rangeM) * (1 - Math.exp(-seconds / Math.max(.01, responseSec)));
  return previous;
}

import { CANVAS } from './fly-constants';
import { isMobileGraphicsClass } from './device-class';
import { useFlyStore } from '../../stores/fly-store';
import { benchmarkStart, deviceFeature } from './device-policy';
import { shipPassBlock, shipPassOn } from './ship-pass';

/**
 * SHIP PASS FRAME (FR-12, ULTRA_SUPERSAMPLE) — the supersample scale for this
 * session, or null. Only on a DPR-1 display, at Ultra, where the device
 * policy allows it (a discrete GPU) AND the boot benchmark graded 'high'
 * (DEVICE_POLICY supplies the score). It becomes the governor's top rung and
 * the first one shed (lib/fly/perf-governor.js). Flag off: null.
 */
export function ultraSupersampleScale() {
  if (!shipPassOn('ULTRA_SUPERSAMPLE') || typeof window === 'undefined') return null;
  if ((window.devicePixelRatio || 1) !== 1) return null;
  const preset = useFlyStore.getState().qualityPreset;
  const f = deviceFeature('ULTRA_SUPERSAMPLE', { preset });
  if (!f.allowed || benchmarkStart()?.grade !== 'high') return null;
  const scale = Math.min(f.budget.maxScale ?? 1.5, shipPassBlock('ULTRA_SUPERSAMPLE')?.maxScale ?? 1.5);
  return scale > 1 ? scale : null;
}

// One source for Canvas allocation AND the governor's first rung. Mobile used
// the desktop 1.5 cap: 44% more shaded pixels than 1.25, before any scenery.
// HUD text retains native CSS resolution; terrain/building detail is separate.
export function initialRenderDpr() {
  if (typeof window === 'undefined') return CANVAS.dprMax;
  const ss = ultraSupersampleScale();
  if (ss) return ss;
  const ultra = useFlyStore.getState().qualityPreset === 'ultra';
  // SHIP PASS FRAME (FR-10, DEVICE_POLICY): Ultra's DPR stays at 1.5 unless
  // the boot benchmark passes 'high'. null with the flag off (today's rule).
  const benchCap = ultra ? benchmarkStart()?.dprCap : null;
  const ceiling = isMobileGraphicsClass() ? 1.25
    : ultra ? (benchCap ? Math.min(CANVAS.ultraDprMax, benchCap) : CANVAS.ultraDprMax) : CANVAS.dprMax;
  return Math.min(ceiling, window.devicePixelRatio || 1);
}

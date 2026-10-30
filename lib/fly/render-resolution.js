import { CANVAS } from './fly-constants';
import { isMobileGraphicsClass } from './device-class';
import { useFlyStore } from '../../stores/fly-store';
import { benchmarkStart } from './device-policy';

// One source for Canvas allocation AND the governor's first rung. Mobile used
// the desktop 1.5 cap: 44% more shaded pixels than 1.25, before any scenery.
// HUD text retains native CSS resolution; terrain/building detail is separate.
export function initialRenderDpr() {
  if (typeof window === 'undefined') return CANVAS.dprMax;
  const ultra = useFlyStore.getState().qualityPreset === 'ultra';
  // SHIP PASS FRAME (FR-10, DEVICE_POLICY): Ultra's DPR stays at 1.5 unless
  // the boot benchmark passes 'high'. null with the flag off (today's rule).
  const benchCap = ultra ? benchmarkStart()?.dprCap : null;
  const ceiling = isMobileGraphicsClass() ? 1.25
    : ultra ? (benchCap ? Math.min(CANVAS.ultraDprMax, benchCap) : CANVAS.ultraDprMax) : CANVAS.dprMax;
  return Math.min(ceiling, window.devicePixelRatio || 1);
}

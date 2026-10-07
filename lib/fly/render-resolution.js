import { CANVAS } from './fly-constants';
import { isMobileGraphicsClass } from './device-class';

// One source for Canvas allocation AND the governor's first rung. Mobile used
// the desktop 1.5 cap: 44% more shaded pixels than 1.25, before any scenery.
// HUD text retains native CSS resolution; terrain/building detail is separate.
export function initialRenderDpr() {
  if (typeof window === 'undefined') return CANVAS.dprMax;
  const ceiling = isMobileGraphicsClass() ? 1.25 : CANVAS.dprMax;
  return Math.min(ceiling, window.devicePixelRatio || 1);
}

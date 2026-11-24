import { EARTH_HORIZON } from './fly-constants';
import { pinned } from './fly-pins';
import { physicalBendCoefficient } from './render-scale';
export const earthHorizonOn=()=>pinned(EARTH_HORIZON,'__flyEarthHorizonOverride').enabled===true;
export function earthBend(scale){return physicalBendCoefficient(6371008.8,scale);}
// This band blends terrain into sky. Keep the selected horizon while the
// governor reduces scenery detail, or haze sweeps across already visible ground.
const fadeEndM = { ultra: 120000, high: 120000, medium: 90000, low: 60000 };
export function earthFade(preset, scale = 1) {
  const endM = Math.min(120000, (fadeEndM[preset] ?? fadeEndM.medium) * Math.max(1, scale));
  return { startM: endM * 0.5, endM };
}

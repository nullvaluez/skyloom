import { EARTH_HORIZON } from './fly-constants';
import { pinned } from './fly-pins';
import { physicalBendCoefficient } from './render-scale';
export const earthHorizonOn=()=>pinned(EARTH_HORIZON,'__flyEarthHorizonOverride').enabled===true;
export function earthBend(scale){return physicalBendCoefficient(6371008.8,scale);}
// Distance caps stay inside the existing terrain ring. Changing the horizon
// never increases residency, geometry caps, traffic range or worker budgets.
export function earthFade(tier,scale=1){const end=Math.min(120000,({high:120000,medium:90000,low:60000}[tier]||90000)*Math.max(1,scale));return {startM:end*.5,endM:end};}

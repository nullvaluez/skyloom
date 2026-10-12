import { isMobileGraphicsClass } from './device-class.js';

// Separate rollout switches. Review builds opt in until device acceptance.
export const LIVING_AIRPORTS = Object.freeze({ enabled: false, worldArt: false, scenery: false });
let cachedSearch, params;
export function livingAirportsOn(part = 'enabled') {
  if (isMobileGraphicsClass()) return false;
  if (typeof window !== 'undefined') {
    if(cachedSearch!==window.location.search){cachedSearch=window.location.search;params=new URLSearchParams(cachedSearch);}
    if(params.get('graphicsReview')!=='1')return LIVING_AIRPORTS[part]===true;
    const value = params.get(part==='enabled'?'airports':part==='worldArt'?'airportArt':'airportScenery');
    if (value === 'off') return false;
    if (value === 'on') return true;
  }
  return LIVING_AIRPORTS[part] === true;
}

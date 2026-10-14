import { isMobileGraphicsClass } from './device-class.js';

// Separate rollout switches. Review builds can still force each part with
// ?graphicsReview=1&airports= / airportArt= / airportScenery=.
// enabled = the observation lounge ('Watch an airport' on the title card and
// the Atlas pill): ON for desktop players since 2026-10-13 (owner: "lounge
// now"), ahead of the Gate to Gate W4 flip. Phones and tablets stay excluded
// (isMobileGraphicsClass). worldArt and scenery stay review-only.
export const LIVING_AIRPORTS = Object.freeze({ enabled: true, worldArt: false, scenery: false });
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

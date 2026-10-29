import { isMobileGraphicsClass } from './device-class.js';
import { loungeMobileAllowed } from './lounge-mobile.js';

// Separate rollout switches. Review builds can still force each part with
// ?graphicsReview=1&airports= / airportArt= / airportScenery=.
// enabled = the observation lounge ('Watch an airport' on the title card and
// the Atlas pill): ON for desktop players since 2026-10-13 (owner: "lounge
// now"), ahead of the Gate to Gate W4 flip. Phones and tablets have it since
// 2026-10-29 behind LOUNGE_MOBILE (lib/fly/lounge-mobile.js;
// ?flags=-LOUNGE_MOBILE excludes them again). worldArt and scenery stay
// review-only, and stay desktop-only (isMobileGraphicsClass).
export const LIVING_AIRPORTS = Object.freeze({ enabled: true, worldArt: false, scenery: false });
let cachedSearch, params;
export function livingAirportsOn(part = 'enabled') {
  if (isMobileGraphicsClass() && !(part === 'enabled' && loungeMobileAllowed())) return false;
  if (typeof window !== 'undefined') {
    if(cachedSearch!==window.location.search){cachedSearch=window.location.search;params=new URLSearchParams(cachedSearch);}
    if(params.get('graphicsReview')!=='1')return LIVING_AIRPORTS[part]===true;
    const value = params.get(part==='enabled'?'airports':part==='worldArt'?'airportArt':'airportScenery');
    if (value === 'off') return false;
    if (value === 'on') return true;
  }
  return LIVING_AIRPORTS[part] === true;
}

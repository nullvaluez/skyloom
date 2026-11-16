import { isMobileGraphicsClass } from './device-class';

/**
 * LOOK PASS tier test (FLY_LOOK_PASS.md, "Tier test"): the ONE answer to "is
 * the look allowed right now" for all five streams (ATMOS, SHADOW, FACADE,
 * LAYERS, GRADE). Rule 5: desktop High and Ultra only.
 *
 * It reads the ACTIVE cinema profile (cinemaProfile() in cinema-policy.js), not
 * the store's qualityTier: the frame governor steps the profile's effect rungs
 * (and Battery saver floors them) while the store tier stays at 'high', so a
 * store-tier test and a profile test disagreed on the rungs that resolve to
 * 'medium' or 'low'. The mobile graphics class is excluded as well: GRADE and
 * ATMOS compile their shader text only off that class (a static, per-session
 * gate), so a touch device can never run the whole look.
 *
 * No store or policy import, so node gates load it raw. Callers pass the
 * profile (object or name); `mobile` defaults to the live device class.
 */
export const LOOK_TIER_PROFILES = Object.freeze(['ultra', 'ultra-balanced', 'high', 'high-balanced']);
const ALLOWED = new Set(LOOK_TIER_PROFILES);

export function lookTierAllowed(profile, mobile = isMobileGraphicsClass()) {
  const name = typeof profile === 'string' ? profile : profile?.name;
  return !mobile && ALLOWED.has(name);
}

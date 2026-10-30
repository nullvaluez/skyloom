/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md SK-4) — SKY_LITE: Medium and phone skies
 * that stop looking like a different game, without a new pass.
 *
 * WHAT DIFFERED. Every device runs the same Enhanced aerial pass and cloud
 * march; what Medium and phones lose is REACH:
 *  - the aerial-perspective volume (PHYS_SKY) is rendered to 450 km on High,
 *    250 km on Medium and 160 km on touch devices, and pskyAerial() CLAMPS a
 *    farther pixel to the last slice. From a few kilometres up the curved
 *    Earth's horizon is 200-360 km away, so on Medium and phones the outer
 *    band of terrain (and the clouds over it) stopped hazing where High keeps
 *    going: a crisper, darker far field than the same view on desktop;
 *  - the far cloud deck (FAR_CLOUDS) beyond the 22 km volume is 180 km on
 *    High, 90 km on Medium and absent on phones, so a phone's deck ended in a
 *    bare ring at 22 km.
 *
 * WHAT SKY_LITE DOES, inside passes that already run (no new full-screen pass,
 * no new draw, no new render target):
 *  (1) AERIAL REACH: past the volume's last slice the optical depth keeps
 *      growing linearly with distance, T(d) = T(d_last)^(d / d_last), and the
 *      in-scatter keeps its share of the opacity, S(d) = S(d_last) x (1 - T(d))
 *      / (1 - T(d_last)). Continuous at d_last, a few ALU ops on the pixels
 *      beyond the range only (two pow-like ops per channel), and switched per
 *      frame by a uniform (uPskyAp.z) that AtmosphereRig sets only where the
 *      device policy allows SKY_LITE — so High, which never sees past 450 km,
 *      runs the clamp exactly as before.
 *  (2) FAR-CLOUD LITE on phones: the existing far deck (one wide-footprint
 *      density sample on the curved shell — already a single sample) at the
 *      policy's reach fraction of the High deck (0.5 → 90 km, Medium's
 *      reach), set through the deck's existing reach uniform: +0 draws,
 *      +0 programs.
 *  Both are gated by deviceFeature('SKY_LITE') (lib/fly/device-policy.js,
 *  FRAME's table), never a raw device-class call.
 *
 * Flag off: the GLSL is the input, unchanged (an anchored single-match edit
 * that throws on a miss when on), the uniform stays 0 and the deck reach is
 * the previous expression's.
 */
import { shipPassOn } from './ship-pass.js';
import { deviceFeature } from './device-policy.js';

/** True when this page load carries SKY_LITE (a page-load decision, like every Ship Pass flag). */
export const SKY_LITE_ON = shipPassOn('SKY_LITE');

/** The policy row for SKY_LITE at a quality tier ({ allowed, budget }). */
export function skyLitePolicy(tier, ctx = {}) {
  return deviceFeature('SKY_LITE', { ...ctx, tier });
}

/** Does this device at `tier` get the lite sky right now? */
export function skyLiteActive(tier, ctx = {}, on = SKY_LITE_ON) {
  return on && skyLitePolicy(tier, ctx).allowed === true;
}

// The GLSL half lives with the lookup it patches (lib/fly/atmosphere/glsl.js
// stays free of runtime dependencies); re-exported here for the gate.
export { skyLiteAerialGLSL } from './atmosphere/glsl.js';

/** uPskyAp.z for this frame: 1 = extrapolate past the volume's reach. */
export function skyLiteAerialSwitch(tier, ctx = {}, on = SKY_LITE_ON) {
  return skyLiteActive(tier, ctx, on) ? 1 : 0;
}

/**
 * The far deck's reach (m) for a cinema profile under SKY_LITE, or null to
 * keep the previous rule. Phone profiles (the touch-device ladder, all but
 * its Low rung) get the policy's fraction of the High deck.
 */
export function skyLiteFarReachM(profileName, maxKm, tier, ctx = {}, on = SKY_LITE_ON) {
  if (!on || typeof profileName !== 'string' || !profileName.startsWith('phone') || profileName === 'phone-low') return null;
  const p = skyLitePolicy(tier, ctx);
  if (!p.allowed) return null;
  const k = Number.isFinite(p.budget?.cloudReach) ? p.budget.cloudReach : 0.5;
  return Math.max(0, maxKm * 1000 * k);
}

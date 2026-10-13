/**
 * GATE TO GATE — is the player's aircraft drawn?
 *
 * Hidden on the title flyby and while observing an airport, except when the
 * lounge shows it parked at its stand ('Watch from the lounge' after landing,
 * LOUNGE_BRIDGE, W4 P: watch.playerParked). PlayerPlane and the player light
 * feed both read this, so they can never disagree.
 */
import { loungeBridge } from './ops-flags.js';

export function playerVisible({ titleHidden = false, observing = false, parked = null } = {}) {
  if (titleHidden) return false;
  if (!observing) return true;
  return !!parked && loungeBridge().enabled === true;
}

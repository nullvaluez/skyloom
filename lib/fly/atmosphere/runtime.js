/**
 * TRUE EARTH Phase 2 — PHYS_SKY: the runtime switch. The atmosphere rig, the
 * cinemaSky variant and the lighting will read physSkyOn(); until they land,
 * nothing does, so the flag changes nothing.
 */
import { pinned } from '../fly-pins.js';
import { PHYS_SKY } from '../fly-constants.js';

/** The resolved PHYS_SKY block (URL / console pins applied once, at load). */
export const PHYS_SKY_ACTIVE = pinned(PHYS_SKY, '__flyPhysSkyOverride');
export function physSkyOn() {
  return PHYS_SKY_ACTIVE.enabled === true;
}

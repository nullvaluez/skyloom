import { LOOK_SHADOW } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS B (SHADOW): sun shadow reach, ambient occlusion, contact and cloud shadow: what grounds the world.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_SHADOW_CFG = pinned(LOOK_SHADOW, '__flyLookShadowOverride');
export const LOOK_SHADOW_ON = LOOK_SHADOW_CFG.enabled === true;

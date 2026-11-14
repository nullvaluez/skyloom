import { LOOK_FACADE } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS C (FACADE): building walls, glass, roofs and their response to light.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_FACADE_CFG = pinned(LOOK_FACADE, '__flyLookFacadeOverride');
export const LOOK_FACADE_ON = LOOK_FACADE_CFG.enabled === true;

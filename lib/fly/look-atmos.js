import { LOOK_ATMOS } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS A (ATMOS): air density, aerial perspective, fog and mist: the depth of the frame.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_ATMOS_CFG = pinned(LOOK_ATMOS, '__flyLookAtmosOverride');
export const LOOK_ATMOS_ON = LOOK_ATMOS_CFG.enabled === true;

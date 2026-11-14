import { LOOK_LAYERS } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS D (LAYERS): cloud strata, far-field silhouettes and the horizon: the stacked planes of the view.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_LAYERS_CFG = pinned(LOOK_LAYERS, '__flyLookLayersOverride');
export const LOOK_LAYERS_ON = LOOK_LAYERS_CFG.enabled === true;

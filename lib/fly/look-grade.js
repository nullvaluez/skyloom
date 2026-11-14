import { LOOK_GRADE } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS E (GRADE): tone curve, colour grade, key/fill colour and ground, vegetation and water colour.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_GRADE_CFG = pinned(LOOK_GRADE, '__flyLookGradeOverride');
export const LOOK_GRADE_ON = LOOK_GRADE_CFG.enabled === true;

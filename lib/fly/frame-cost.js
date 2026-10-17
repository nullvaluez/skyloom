/**
 * FRAME COST — the one accessor for the four frame-cost flag blocks at the end
 * of fly-constants.js (ULTRA_RUNG, CLOUD_STEPS, AERIAL_MERGE, CASCADE_STAGGER).
 * Each read is a literal pinned(BLOCK, '__fly<Name>Override') evaluated at call
 * time, so `?flags=NAME` and console pins win (verify-true-earth-flags (5)).
 */
import { pinned } from './fly-pins.js';
import { ULTRA_RUNG, CLOUD_STEPS, AERIAL_MERGE, CASCADE_STAGGER } from './fly-constants.js';

export const ultraRung = () => pinned(ULTRA_RUNG, '__flyUltraRungOverride');
export const cloudSteps = () => pinned(CLOUD_STEPS, '__flyCloudStepsOverride');
export const aerialMerge = () => pinned(AERIAL_MERGE, '__flyAerialMergeOverride');
export const cascadeStagger = () => pinned(CASCADE_STAGGER, '__flyCascadeStaggerOverride');

export const ultraRungOn = () => ultraRung()?.enabled === true;
export const cloudStepsOn = () => cloudSteps()?.enabled === true;
export const aerialMergeOn = () => aerialMerge()?.enabled === true;
export const cascadeStaggerOn = () => cascadeStagger()?.enabled === true;

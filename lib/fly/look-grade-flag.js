import { Vector4 } from 'three';
import { LOOK_GRADE } from './fly-constants.js';
import { pinned } from './fly-pins.js';
import { isMobileGraphicsClass } from './device-class.js';

/** LOOK PASS E (GRADE): the flag and the shared water uniform, with no store
 * or policy imports, so shader modules that node gates load raw can read it. */
export const LOOK_GRADE_CFG = pinned(LOOK_GRADE, '__flyLookGradeOverride');
export const LOOK_GRADE_ON = LOOK_GRADE_CFG.enabled === true;
/** The flag-on shader text is compiled only off the mobile graphics class (a
 * static, per-session gate): phones and tablets keep today's programs, not just
 * today's pixels. Desktop Medium keeps the uniform branch (its tier moves at runtime). */
export const LOOK_GRADE_COMPILED = LOOK_GRADE_ON && !isMobileGraphicsClass();
/** x low-sun water sheen, y sun-path gain, z daylight steep-water lift; shared into the sea uniforms (0 = identity). */
export const LOOK_WATER_UNIFORM = { value: new Vector4() };

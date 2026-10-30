/**
 * SHIP PASS FRAME (FR-2, SHADER_READY) — when three may skip its shader
 * diagnostics.
 *
 * WHY. With `renderer.debug.checkShaderErrors` true (three's default), the
 * first use of every WebGLProgram calls getProgramInfoLog plus two
 * getShaderInfoLog — synchronous driver round trips that wait for the link to
 * finish (WebGLProgram.js onFirstUse). EXPLORER_BETA.md's live-provider
 * diagnostic measured about 20 s of the first minute inside
 * getProgramInfoLog on the RTX 5080 (single calls up to 4.18 s). A production
 * player gains nothing from those logs: a shader that fails to link renders
 * nothing either way, and the program census (lib/fly/program-census.js)
 * still reports the failure (LINK_STATUS read after the link has landed, and
 * track('client_error', { kind: 'shader_link' })).
 *
 * THE SPLIT. Diagnostics are skipped ONLY when all three hold:
 *   - SHADER_READY is on for this page load,
 *   - this is a production build (`process.env.NODE_ENV === 'production'`),
 *   - the page is not automated (`navigator.webdriver` is not true) — every
 *     harness, smoke and soak keeps full shader diagnostics, so a gate can
 *     never pass over a broken shader because the build stopped looking.
 * Dev servers keep `true` always. scripts/verify-ship-frame.mjs proves the
 * table. Flag off: this returns true and FlyCanvas never assigns the field,
 * so the renderer is three's default, byte for byte.
 */
import { shipPassOn } from './ship-pass';

/** WebDriver / Playwright sessions (the device-tiers.js and player-surface.js rule). */
export function automated() {
  return typeof navigator !== 'undefined' && navigator?.webdriver === true;
}

/**
 * Should the renderer keep checking shader errors? Pure when every argument
 * is passed (the node gate); the defaults read this page load.
 */
export function shaderErrorsChecked({
  flagOn = shipPassOn('SHADER_READY'),
  production = process.env.NODE_ENV === 'production',
  automation = automated(),
} = {}) {
  return !(flagOn === true && production === true && automation !== true);
}

/**
 * Apply the policy to a renderer. Writes the field only when it differs from
 * three's default, so a flag-off renderer is never touched. Returns the
 * resulting value (diagnostics).
 */
export function applyShaderErrorPolicy(gl, opts) {
  const checked = shaderErrorsChecked(opts);
  if (!checked && gl?.debug) gl.debug.checkShaderErrors = false;
  return gl?.debug?.checkShaderErrors ?? checked;
}

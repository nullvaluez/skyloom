/**
 * FRAME LEAN (FLY_HORIZON_FILL.md, "Second round"): the ONLY reader of the
 * FRAME_LEAN block at the end of lib/fly/fly-constants.js.
 *
 * Resolved once when this module is first imported (the world-clarity.js
 * idiom). The block ships ON; `?flags=-FRAME_LEAN` (or a pin
 * `window.__flyFrameLeanOverride = { enabled: false }`) gives the previous
 * frame loop for one page load, which is how a before / after is measured on
 * one build. A worker has no pins and never imports this module.
 *
 *   FRAME_LEAN_ON            the flag, with its pin
 *   frameLeanOn('engines')   a sub-switch (on only while the flag is)
 *   FRAME_LEAN_ACTIVE        the resolved block, for tunables
 */
import { pinned } from './fly-pins.js';
import { FRAME_LEAN } from './fly-constants.js';

/** Sub-switches a caller may ask about. */
export const FRAME_LEAN_SUBS = Object.freeze(['engines', 'loop']);

export const FRAME_LEAN_ACTIVE = pinned(FRAME_LEAN, '__flyFrameLeanOverride');
export const FRAME_LEAN_ON = FRAME_LEAN_ACTIVE.enabled === true;

/** frameLeanOn() or frameLeanOn('engines' | 'loop'). */
export function frameLeanOn(sub) {
  if (sub === undefined) return FRAME_LEAN_ON;
  if (!FRAME_LEAN_SUBS.includes(sub)) throw new Error(`frame-lean: unknown switch "${sub}"`);
  return FRAME_LEAN_ON && FRAME_LEAN_ACTIVE[sub] !== false;
}

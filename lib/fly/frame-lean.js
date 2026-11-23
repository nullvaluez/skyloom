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
import { STREAM_PACE_ON } from './stream-pace.js';

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

/**
 * The settle rules (FRAME_LEAN.settle), or null for the previous behaviour.
 * They make a parked world settle on the same bytes whatever the order and
 * pace its work was done in. Independent of the FRAME_LEAN arm; on when the
 * block or its pin says so, and always with STREAM_PACE, whose pacing would
 * otherwise change what the roads and stand-ins settle on. A pin may carry
 * only `{ settle: { enabled: true } }`: the numbers come from the block.
 */
export const FRAME_SETTLE = (() => {
  const resolved = FRAME_LEAN_ACTIVE.settle;
  // A pin that names `settle` decides (an explicit off is the calibration
  // arm, even with STREAM_PACE); otherwise the block, or STREAM_PACE.
  const explicit = resolved != null && resolved !== FRAME_LEAN.settle;
  const on = explicit ? resolved.enabled === true : FRAME_LEAN.settle?.enabled === true || STREAM_PACE_ON;
  return on ? Object.freeze({ ...FRAME_LEAN.settle, ...(explicit ? resolved : {}), enabled: true }) : null;
})();

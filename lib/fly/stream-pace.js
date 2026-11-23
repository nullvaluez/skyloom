/**
 * STREAM PACE (FLY_HORIZON_FILL.md, "Third round"): the ONLY reader of the
 * STREAM_PACE block at the end of lib/fly/fly-constants.js, and the one scale
 * every streaming allowance shares.
 *
 * Resolved once when this module is first imported (the world-clarity.js
 * idiom). A worker has no pins and never imports this module.
 *
 *   STREAM_PACE_ON            the flag, with its pin
 *   streamPaceOn('flight')    a sub-switch (on only while the flag is)
 *   STREAM_PACE_ACTIVE        the resolved block, for tunables
 *   paceK()                   the scale this frame; exactly 1 while the flag is off
 *
 * W0 scaffold: stream P implements the scale. Until then paceK() is 1.
 */
import { pinned } from './fly-pins.js';
import { STREAM_PACE } from './fly-constants.js';

/** Sub-switches a caller may ask about. */
export const STREAM_PACE_SUBS = Object.freeze(['flight', 'curtain']);

export const STREAM_PACE_ACTIVE = pinned(STREAM_PACE, '__flyStreamPaceOverride');
export const STREAM_PACE_ON = STREAM_PACE_ACTIVE.enabled === true;

/** streamPaceOn() or streamPaceOn('flight' | 'curtain'). */
export function streamPaceOn(sub) {
  if (sub === undefined) return STREAM_PACE_ON;
  if (!STREAM_PACE_SUBS.includes(sub)) throw new Error(`stream-pace: unknown switch "${sub}"`);
  return STREAM_PACE_ON && STREAM_PACE_ACTIVE[sub] !== false;
}

/** The shared allowance scale for this frame. Exactly 1 while the flag is off. */
export function paceK() {
  return 1;
}

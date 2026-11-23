/**
 * ONE REVEAL (FLY_HORIZON_FILL.md, "Second round"): the ONLY reader of the
 * ONE_REVEAL block at the end of lib/fly/fly-constants.js.
 *
 * Resolved once when this module is first imported (the world-clarity.js
 * idiom): app/page.js installs `?flags=` pins before any Fly module loads, and
 * a harness sets `window.__flyOneRevealOverride` before navigation. A worker
 * has no pins and never imports this module.
 *
 *   ONE_REVEAL_ON            the flag, with its pin
 *   oneRevealOn('gate')      a sub-switch (on only while the flag is)
 *   ONE_REVEAL_ACTIVE        the resolved block, for tunables
 */
import { pinned } from './fly-pins.js';
import { ONE_REVEAL } from './fly-constants.js';

/** Sub-switches a caller may ask about. */
export const ONE_REVEAL_SUBS = Object.freeze(['gate', 'bornFinal', 'carpetHold']);

export const ONE_REVEAL_ACTIVE = pinned(ONE_REVEAL, '__flyOneRevealOverride');
export const ONE_REVEAL_ON = ONE_REVEAL_ACTIVE.enabled === true;

/** oneRevealOn() or oneRevealOn('gate' | 'bornFinal' | 'carpetHold'). */
export function oneRevealOn(sub) {
  if (sub === undefined) return ONE_REVEAL_ON;
  if (!ONE_REVEAL_SUBS.includes(sub)) throw new Error(`one-reveal: unknown switch "${sub}"`);
  return ONE_REVEAL_ON && ONE_REVEAL_ACTIVE[sub] !== false;
}

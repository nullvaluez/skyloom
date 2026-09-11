/**
 * Round 25 (Fable, W0) — the ONE accessor for every R25 block.
 *
 * `r25Block(name)` returns the constants block with `window.__fly<Name>Override`
 * merged over it (lib/fly/fly-pins.js — the R24 A idiom, R16's
 * `__flyWeatherOverride` generalised). `r25On(name, sub)` is the boolean every
 * mount and every shader predicate reads. Production reads nothing extra: with
 * no global set, the block is returned by reference and `r25On` is a property
 * read.
 *
 * The merge is SHALLOW on purpose (a pin that names a sub-block replaces the
 * whole sub-block): a harness arming `{ enabled: true }` gets the owner's
 * shipped sub-switches exactly, and a pin that wants one sub-knob spells the
 * whole sub-object it wants. That keeps the "flag-off is byte-identical"
 * claim testable in one process and one build.
 */

import {
  FEEL_R25,
  GROUND_BUBBLE,
  GROUND_DETAIL_R25,
  LIGHT_BUBBLE_R25,
  MOBILE_FAN_R25,
  NIGHT_GROUND_R25,
} from './fly-constants';
import { pinned } from './fly-pins';

const BLOCKS = {
  GroundBubble: GROUND_BUBBLE,
  GroundDetail: GROUND_DETAIL_R25,
  NightGround: NIGHT_GROUND_R25,
  LightBubble: LIGHT_BUBBLE_R25,
  MobileFan: MOBILE_FAN_R25,
  Feel: FEEL_R25,
};

/** The block for `name` ('GroundBubble' | 'GroundDetail' | 'NightGround' | 'LightBubble' | 'MobileFan' | 'Feel'), pinned. */
export function r25Block(name) {
  const base = BLOCKS[name];
  if (!base) throw new Error(`r25Block: unknown block '${name}'`);
  return pinned(base, `__fly${name}Override`);
}

/**
 * Is the block armed — and, with `sub`, is that sub-switch armed too? A
 * sub-switch is either a boolean or an object carrying its own `enabled`.
 */
export function r25On(name, sub) {
  const b = r25Block(name);
  if (b.enabled !== true) return false;
  if (!sub) return true;
  const s = b[sub];
  return s === true || (!!s && typeof s === 'object' && s.enabled === true);
}

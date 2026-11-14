/**
 * VISTA PASS (2026-11-14; FLY_VISTA_PASS.md) — the one reader of the pass's
 * flags.
 *
 * Every block is resolved ONCE, at module load, through its URL / console pin
 * (`?flags=NAME` / `?flags=-NAME`, or `window.__fly<Name>Override` set before
 * Fly mode mounts), the TRUE EARTH convention lib/fly/play-pass.js follows.
 * scripts/verify-true-earth-flags.mjs (5) requires each block to be read
 * exactly like this.
 *
 * `vistaOn(name)` is the boolean every consumer asks; `vistaBlock(name)`
 * carries the block (constants merged with any pin) for tunables.
 *
 * A web worker has no pins (pinned() returns the constants there), so a
 * worker-side change must be switched by an explicit boolean in the worker
 * message, resolved on the main thread through vistaOn().
 */
import { pinned } from './fly-pins';
import { VISTA_AIR, VISTA_LIGHT, VISTA_CITY, VISTA_GROUND, VISTA_SKY } from './fly-constants';

export const VISTA_AIR_ACTIVE = pinned(VISTA_AIR, '__flyVistaAirOverride');
export const VISTA_LIGHT_ACTIVE = pinned(VISTA_LIGHT, '__flyVistaLightOverride');
export const VISTA_CITY_ACTIVE = pinned(VISTA_CITY, '__flyVistaCityOverride');
export const VISTA_GROUND_ACTIVE = pinned(VISTA_GROUND, '__flyVistaGroundOverride');
export const VISTA_SKY_ACTIVE = pinned(VISTA_SKY, '__flyVistaSkyOverride');

const ACTIVE = {
  VISTA_AIR: VISTA_AIR_ACTIVE,
  VISTA_LIGHT: VISTA_LIGHT_ACTIVE,
  VISTA_CITY: VISTA_CITY_ACTIVE,
  VISTA_GROUND: VISTA_GROUND_ACTIVE,
  VISTA_SKY: VISTA_SKY_ACTIVE,
};

/** True when the Vista Pass block `name` is on for this page load. */
export function vistaOn(name) {
  return ACTIVE[name]?.enabled === true;
}

/** The resolved block (constants merged with its pin) for tunables. */
export function vistaBlock(name) {
  return ACTIVE[name] ?? null;
}

/** Every flag of the pass and its resolved state (diagnostics and harnesses). */
export function vistaFlags() {
  const out = {};
  for (const [name, block] of Object.entries(ACTIVE)) out[name] = block.enabled === true;
  return out;
}

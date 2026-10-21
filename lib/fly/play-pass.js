/**
 * PLAY PASS (2026-10-21; FLY_PLAY_PASS.md) — the one reader of the pass's
 * flags.
 *
 * Every block is resolved ONCE, at module load, through its URL / console pin
 * (`?flags=NAME` / `?flags=-NAME`, or `window.__fly<Name>Override` set before
 * Fly mode mounts), the TRUE EARTH convention that lib/fly/living-world.js
 * follows too. scripts/verify-true-earth-flags.mjs (5) requires each block to
 * be read exactly like this.
 *
 * `playPassOn(name)` is the boolean every consumer asks; `playPassBlock(name)`
 * carries the block (constants merged with any pin) for tunables.
 */
import { pinned } from './fly-pins';
import { CALM_HUD, ENCOUNTER_FEEL, CITY_FACADES, LOUNGE_DIRECTOR, APRON_DETAIL } from './fly-constants';

export const CALM_HUD_ACTIVE = pinned(CALM_HUD, '__flyCalmHudOverride');
export const ENCOUNTER_FEEL_ACTIVE = pinned(ENCOUNTER_FEEL, '__flyEncounterFeelOverride');
export const CITY_FACADES_ACTIVE = pinned(CITY_FACADES, '__flyCityFacadesOverride');
export const LOUNGE_DIRECTOR_ACTIVE = pinned(LOUNGE_DIRECTOR, '__flyLoungeDirectorOverride');
export const APRON_DETAIL_ACTIVE = pinned(APRON_DETAIL, '__flyApronDetailOverride');

const ACTIVE = {
  CALM_HUD: CALM_HUD_ACTIVE,
  ENCOUNTER_FEEL: ENCOUNTER_FEEL_ACTIVE,
  CITY_FACADES: CITY_FACADES_ACTIVE,
  LOUNGE_DIRECTOR: LOUNGE_DIRECTOR_ACTIVE,
  APRON_DETAIL: APRON_DETAIL_ACTIVE,
};

/** True when the Play Pass block `name` is on for this page load. */
export function playPassOn(name) {
  return ACTIVE[name]?.enabled === true;
}

/** The resolved block (constants merged with its pin) for tunables. */
export function playPassBlock(name) {
  return ACTIVE[name] ?? null;
}

/** Every flag of the pass and its resolved state (diagnostics and harnesses). */
export function playPassFlags() {
  const out = {};
  for (const [name, block] of Object.entries(ACTIVE)) out[name] = block.enabled === true;
  return out;
}

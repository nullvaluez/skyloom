/**
 * LIVING WORLD (2026-10-20; FLY_LIVING_WORLD.md) — the one reader of the
 * pass's flags.
 *
 * Every block is resolved ONCE, at module load, through its URL / console pin
 * (`?flags=NAME` / `?flags=-NAME`, or `window.__fly<Name>Override` set before
 * Fly mode mounts). That is the TRUE EARTH convention (PHYS_SKY is read the
 * same way): a flag decides shader text and program keys, so it is a page-load
 * decision, never a mid-flight toggle. scripts/verify-true-earth-flags.mjs (5)
 * requires each block to be read exactly like this.
 *
 * `livingWorldOn(name)` is the boolean every consumer asks; the `*_ACTIVE`
 * objects carry the block (constants merged with any pin) for tunables.
 */
import { pinned } from './fly-pins';
import {
  LIVING_CLOUDS,
  FAR_CLOUDS,
  CIRRUS,
  LIGHT_SHAFTS,
  LENS_FLARE,
  FILM_GRADE,
  NIGHT_SKY,
  SKY_TRAILS,
  RAIN_OVERLAY,
  VAPOR_FX,
  AIRFRAME_DETAIL,
  NIGHT_LIGHTS,
  GROUND_MIST,
  MENU_GLASS,
  TITLE_MOTION,
  FLIGHT_INSTRUMENTS,
  HANGAR_STAGE,
  TITLE_CINEMA,
} from './fly-constants';

export const LIVING_CLOUDS_ACTIVE = pinned(LIVING_CLOUDS, '__flyLivingCloudsOverride');
export const FAR_CLOUDS_ACTIVE = pinned(FAR_CLOUDS, '__flyFarCloudsOverride');
export const CIRRUS_ACTIVE = pinned(CIRRUS, '__flyCirrusOverride');
export const LIGHT_SHAFTS_ACTIVE = pinned(LIGHT_SHAFTS, '__flyLightShaftsOverride');
export const LENS_FLARE_ACTIVE = pinned(LENS_FLARE, '__flyLensFlareOverride');
export const FILM_GRADE_ACTIVE = pinned(FILM_GRADE, '__flyFilmGradeOverride');
export const NIGHT_SKY_ACTIVE = pinned(NIGHT_SKY, '__flyNightSkyOverride');
export const SKY_TRAILS_ACTIVE = pinned(SKY_TRAILS, '__flySkyTrailsOverride');
export const RAIN_OVERLAY_ACTIVE = pinned(RAIN_OVERLAY, '__flyRainOverlayOverride');
export const VAPOR_FX_ACTIVE = pinned(VAPOR_FX, '__flyVaporFxOverride');
export const AIRFRAME_DETAIL_ACTIVE = pinned(AIRFRAME_DETAIL, '__flyAirframeDetailOverride');
export const NIGHT_LIGHTS_ACTIVE = pinned(NIGHT_LIGHTS, '__flyNightLightsOverride');
export const GROUND_MIST_ACTIVE = pinned(GROUND_MIST, '__flyGroundMistOverride');
export const MENU_GLASS_ACTIVE = pinned(MENU_GLASS, '__flyMenuGlassOverride');
export const TITLE_MOTION_ACTIVE = pinned(TITLE_MOTION, '__flyTitleMotionOverride');
export const FLIGHT_INSTRUMENTS_ACTIVE = pinned(FLIGHT_INSTRUMENTS, '__flyFlightInstrumentsOverride');
export const HANGAR_STAGE_ACTIVE = pinned(HANGAR_STAGE, '__flyHangarStageOverride');
export const TITLE_CINEMA_ACTIVE = pinned(TITLE_CINEMA, '__flyTitleCinemaOverride');

const ACTIVE = {
  LIVING_CLOUDS: LIVING_CLOUDS_ACTIVE,
  FAR_CLOUDS: FAR_CLOUDS_ACTIVE,
  CIRRUS: CIRRUS_ACTIVE,
  LIGHT_SHAFTS: LIGHT_SHAFTS_ACTIVE,
  LENS_FLARE: LENS_FLARE_ACTIVE,
  FILM_GRADE: FILM_GRADE_ACTIVE,
  NIGHT_SKY: NIGHT_SKY_ACTIVE,
  SKY_TRAILS: SKY_TRAILS_ACTIVE,
  RAIN_OVERLAY: RAIN_OVERLAY_ACTIVE,
  VAPOR_FX: VAPOR_FX_ACTIVE,
  AIRFRAME_DETAIL: AIRFRAME_DETAIL_ACTIVE,
  NIGHT_LIGHTS: NIGHT_LIGHTS_ACTIVE,
  GROUND_MIST: GROUND_MIST_ACTIVE,
  MENU_GLASS: MENU_GLASS_ACTIVE,
  TITLE_MOTION: TITLE_MOTION_ACTIVE,
  FLIGHT_INSTRUMENTS: FLIGHT_INSTRUMENTS_ACTIVE,
  HANGAR_STAGE: HANGAR_STAGE_ACTIVE,
  TITLE_CINEMA: TITLE_CINEMA_ACTIVE,
};

/** True when the Living World block `name` is on for this page load. */
export function livingWorldOn(name) {
  return ACTIVE[name]?.enabled === true;
}

/** The resolved block (constants merged with its pin) for tunables. */
export function livingWorldBlock(name) {
  return ACTIVE[name] ?? null;
}

/** Every flag of the pass and its resolved state (diagnostics and harnesses). */
export function livingWorldFlags() {
  const out = {};
  for (const [name, block] of Object.entries(ACTIVE)) out[name] = block.enabled === true;
  return out;
}

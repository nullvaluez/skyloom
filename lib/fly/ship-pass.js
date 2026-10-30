/**
 * SHIP PASS (2026-10-30; FLY_SHIP_PASS.md) — the one reader of the pass's
 * flags.
 *
 * Every block is resolved ONCE, at module load, through its URL / console pin
 * (`?flags=NAME` / `?flags=-NAME`, or `window.__fly<Name>Override` set before
 * Fly mode mounts), the TRUE EARTH convention that lib/fly/play-pass.js and
 * lib/fly/living-world.js follow too. scripts/verify-true-earth-flags.mjs (5)
 * requires each block to be read exactly like this.
 *
 * `shipPassOn(name)` is the boolean every consumer asks; `shipPassBlock(name)`
 * carries the block (constants merged with any pin) for tunables.
 */
import { pinned } from './fly-pins';
import { SHADER_READY, PACE_ADAPT, DEVICE_POLICY, ULTRA_SUPERSAMPLE } from './fly-constants';
import { AERIAL_CLARITY, REAL_MOON, SKY_LITE } from './fly-constants';
import { CITY_RANGE, NIGHT_LITE, NIGHT_RHYTHM } from './fly-constants';
import { TERRAIN_SHADOW, TRAFFIC_SHADOWS, AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES, HANGAR_EXPOSURE } from './fly-constants';
import { CHALLENGE_LAYER, DEEP_LINKS, ANALYTICS_V2, OFFLINE_SHELL } from './fly-constants';

// FRAME
export const SHADER_READY_ACTIVE = pinned(SHADER_READY, '__flyShaderReadyOverride');
export const PACE_ADAPT_ACTIVE = pinned(PACE_ADAPT, '__flyPaceAdaptOverride');
export const DEVICE_POLICY_ACTIVE = pinned(DEVICE_POLICY, '__flyDevicePolicyOverride');
export const ULTRA_SUPERSAMPLE_ACTIVE = pinned(ULTRA_SUPERSAMPLE, '__flyUltraSupersampleOverride');
// SKY
export const AERIAL_CLARITY_ACTIVE = pinned(AERIAL_CLARITY, '__flyAerialClarityOverride');
export const REAL_MOON_ACTIVE = pinned(REAL_MOON, '__flyRealMoonOverride');
export const SKY_LITE_ACTIVE = pinned(SKY_LITE, '__flySkyLiteOverride');
// CITY
export const CITY_RANGE_ACTIVE = pinned(CITY_RANGE, '__flyCityRangeOverride');
export const NIGHT_LITE_ACTIVE = pinned(NIGHT_LITE, '__flyNightLiteOverride');
export const NIGHT_RHYTHM_ACTIVE = pinned(NIGHT_RHYTHM, '__flyNightRhythmOverride');
// LIGHT
export const TERRAIN_SHADOW_ACTIVE = pinned(TERRAIN_SHADOW, '__flyTerrainShadowOverride');
export const TRAFFIC_SHADOWS_ACTIVE = pinned(TRAFFIC_SHADOWS, '__flyTrafficShadowsOverride');
export const AIRFRAME_SHADOW_ACTIVE = pinned(AIRFRAME_SHADOW, '__flyAirframeShadowOverride');
export const SHADOW_REACH_ACTIVE = pinned(SHADOW_REACH, '__flyShadowReachOverride');
export const PHOTO_HIRES_ACTIVE = pinned(PHOTO_HIRES, '__flyPhotoHiresOverride');
export const HANGAR_EXPOSURE_ACTIVE = pinned(HANGAR_EXPOSURE, '__flyHangarExposureOverride');
// RELEASE
export const CHALLENGE_LAYER_ACTIVE = pinned(CHALLENGE_LAYER, '__flyChallengeLayerOverride');
export const DEEP_LINKS_ACTIVE = pinned(DEEP_LINKS, '__flyDeepLinksOverride');
export const ANALYTICS_V2_ACTIVE = pinned(ANALYTICS_V2, '__flyAnalyticsV2Override');
export const OFFLINE_SHELL_ACTIVE = pinned(OFFLINE_SHELL, '__flyOfflineShellOverride');

const ACTIVE = {
  SHADER_READY: SHADER_READY_ACTIVE,
  PACE_ADAPT: PACE_ADAPT_ACTIVE,
  DEVICE_POLICY: DEVICE_POLICY_ACTIVE,
  ULTRA_SUPERSAMPLE: ULTRA_SUPERSAMPLE_ACTIVE,
  AERIAL_CLARITY: AERIAL_CLARITY_ACTIVE,
  REAL_MOON: REAL_MOON_ACTIVE,
  SKY_LITE: SKY_LITE_ACTIVE,
  CITY_RANGE: CITY_RANGE_ACTIVE,
  NIGHT_LITE: NIGHT_LITE_ACTIVE,
  NIGHT_RHYTHM: NIGHT_RHYTHM_ACTIVE,
  TERRAIN_SHADOW: TERRAIN_SHADOW_ACTIVE,
  TRAFFIC_SHADOWS: TRAFFIC_SHADOWS_ACTIVE,
  AIRFRAME_SHADOW: AIRFRAME_SHADOW_ACTIVE,
  SHADOW_REACH: SHADOW_REACH_ACTIVE,
  PHOTO_HIRES: PHOTO_HIRES_ACTIVE,
  HANGAR_EXPOSURE: HANGAR_EXPOSURE_ACTIVE,
  CHALLENGE_LAYER: CHALLENGE_LAYER_ACTIVE,
  DEEP_LINKS: DEEP_LINKS_ACTIVE,
  ANALYTICS_V2: ANALYTICS_V2_ACTIVE,
  OFFLINE_SHELL: OFFLINE_SHELL_ACTIVE,
};

/** True when the Ship Pass block `name` is on for this page load. */
export function shipPassOn(name) {
  return ACTIVE[name]?.enabled === true;
}

/** The resolved block (constants merged with its pin) for tunables. */
export function shipPassBlock(name) {
  return ACTIVE[name] ?? null;
}

/** Every flag of the pass and its resolved state (diagnostics and harnesses). */
export function shipPassFlags() {
  const out = {};
  for (const [name, block] of Object.entries(ACTIVE)) out[name] = block.enabled === true;
  return out;
}

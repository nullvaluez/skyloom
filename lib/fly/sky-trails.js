/**
 * LIVING WORLD — SKY_TRAILS (FLY_LIVING_WORLD.md): contrails that persist in
 * flight, for live traffic and for the player.
 *
 * The observation lounge already draws trails the way they really behave
 * (lib/fly/fleet-trails.js: minutes long, the engine plumes rolling into the
 * vortex pair and merging, spreading to hundreds of metres, drifting with the
 * upper wind, lit by the sun as seen from the trail's own altitude). In flight
 * the game drew only 38-second CPU ribbons out to 22 km. This module feeds the
 * same GPU trails in flight: every contrail-forming jet within rangeM (tier
 * capped, nearest first) and the player's own engines. The CPU ribbons stay
 * for the first seconds behind each engine (where the camera can be), on a
 * shortened life, and the persistent trail fades in under them by age.
 *
 * Formation follows the Schmidt–Appleman criterion (Schumann 1996's fit of the
 * threshold temperature to the mixing-line slope, propulsion efficiency ~0.3)
 * against an air temperature built from ISA plus the live surface anomaly
 * decaying with height: trails form above about FL270 on a standard day,
 * higher on a hot one. The weather feed does not measure upper-air humidity,
 * so persistence stays the deterministic per-band "humidity for the hour" the
 * lounge uses (fleet-trails.js trailPersistence).
 */
import { Vector2 } from 'three';
import { contrailStrength, smoothBand } from './aircraft-effects.js';
import { livingWorldBlock, livingWorldOn } from './living-world.js';
import { SKY_VIEW } from './observation-config.js';
import { getR25Sky } from './r25-sky.js';

export const SKY_TRAILS_ON = livingWorldOn('SKY_TRAILS');
const CFG = livingWorldBlock('SKY_TRAILS') ?? {};

/** The tunables, with defaults (the block may carry any subset). */
export const SKY_TRAILS_CFG = Object.freeze({
  rangeM: CFG.rangeM ?? 120000,
  maxTrails: CFG.maxTrails ?? { high: 72, medium: 40, low: 0 },
  backfillSec: CFG.backfillSec ?? 110,
  nearLifeSec: CFG.nearLifeSec ?? 28, // the CPU ribbons' life when the persistent trail takes over
  ageIn: CFG.ageIn ?? [7, 22], // the persistent trail fades in over this age (s)
  nearFade: CFG.nearFade ?? [120, 520], // and fades out this close to the eye (m)
  playerLifeSec: CFG.playerLifeSec ?? null, // null: the flight-level band's persistence
  humidityBonusK: CFG.humidityBonusK ?? 1.5, // threshold lift (K) for the unmeasured humidity
  density: CFG.density ?? 0.82, // flight trails' optical depth relative to the lounge's
});

/**
 * Schmidt–Appleman formation, 0..1, for an altitude (m MSL) under the live
 * weather (surface temperature anomaly; baseline = ISA).
 */
export function contrailFormation(altM, wx) {
  const h = Math.max(0, altM) / 1000;
  const isa = h < 11 ? 15 - 6.5 * h : -56.5;
  const surface = Number.isFinite(wx?.tempC) ? wx.tempC : 15;
  // A hot or cold surface day shifts the column, less and less with height.
  const t = isa + (surface - 15) * 0.6 * Math.max(0, 1 - h / 11);
  const p = 1013.25 * Math.pow(Math.max(0.05, 1 - 2.25577e-5 * Math.max(0, altM)), 5.25588); // hPa
  const g = (1.5 * p) / 250; // mixing-line slope, Pa/K
  const lg = Math.log(Math.max(1e-3, g - 0.053));
  const tCrit = -46.46 + 9.43 * lg + 0.72 * lg * lg + SKY_TRAILS_CFG.humidityBonusK;
  return smoothBand(tCrit + 2.5, tCrit - 2.5, t);
}

/** contrailStrength with the physical formation band when SKY_TRAILS is on. */
export function livingContrailStrength(altM, speed, grounded = false, wx = null) {
  if (!SKY_TRAILS_ON) return contrailStrength(altM, speed, grounded);
  return grounded || !Number.isFinite(altM) || !Number.isFinite(speed) ? 0 : contrailFormation(altM, wx) * smoothBand(55, 115, speed);
}

const _buffer = new Vector2();
const _fill = [0, 0, 0];

/**
 * The light a SkyTrails batch needs this frame (the lounge's skyFrame values:
 * the sun as seen from the trail, the moon key, the sky fill with exposure
 * folded in because overlays get none).
 */
export function skyTrailLight(runtime, camera, renderer, tier) {
  renderer.getDrawingBufferSize(_buffer);
  const e = runtime.cinemaEnvironment, exposure = getR25Sky().exposure || 1;
  const sinEl = runtime.sun?.sinEl ?? 1;
  const fill = e?.fillColor ?? [0.45, 0.62, 1];
  const day = e?.day ?? 1, night = e?.night ?? 0;
  for (let i = 0; i < 3; i++) _fill[i] = fill[i] * (0.05 + 0.22 * day) * exposure;
  return {
    px: camera.projectionMatrix.elements[5] * (_buffer.y || 1080) * 0.5,
    sunDir: e?.sunDir ?? [0, 1, 0], sun: [sinEl, 4.6, night * (e?.sun ?? 0.3) * 1.4, exposure],
    sunColor: [1, 0.97, 0.92], keyDir: e?.keyDir ?? [0, 1, 0], keyColor: e?.keyColor ?? [0.6, 0.7, 1], skyFill: _fill, tier,
  };
}

/** The upper wind the trails drift with (surface wind x windK, capped), in scene units/s. */
export function skyTrailWind(wx, k, out) {
  out.x = (wx?.windX ?? 0) * SKY_VIEW.windK; out.z = (wx?.windZ ?? 0) * SKY_VIEW.windK;
  const w = Math.hypot(out.x, out.z);
  if (w > SKY_VIEW.windMaxMps) { out.x *= SKY_VIEW.windMaxMps / w; out.z *= SKY_VIEW.windMaxMps / w; }
  out.x *= k; out.z *= k;
  return out;
}

/** The flight batch's own uniforms (near fade and age-in) every frame. */
export function applyFlightTrailFades(sky) {
  const u = sky.uniforms;
  if (u.uNearFade) u.uNearFade.value.set(SKY_TRAILS_CFG.nearFade[0], SKY_TRAILS_CFG.nearFade[1]);
  if (u.uAgeIn) u.uAgeIn.value.set(SKY_TRAILS_CFG.ageIn[0], SKY_TRAILS_CFG.ageIn[1]);
}

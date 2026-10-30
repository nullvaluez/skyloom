/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md SK-2) — AERIAL_CLARITY: the atmosphere's
 * half of the grey-veil fix.
 *
 * WHAT THE VEIL IS, ATMOSPHERICALLY (SK-1's attribution, both instruments in
 * the record): in clear air the Enhanced aerial pass adds the physical
 * aerial-perspective in-scatter S to every ground pixel (PHYS_SKY, Hillaire
 * 2020). Over dark city imagery that light is a large fraction of the ground's
 * own radiance, and it grows with the slant distance — which grows with the
 * eye's height. The CPU mirror (lib/fly/atmosphere/model.js) puts the
 * atmosphere-only contrast transfer of Midtown seen 20° below the horizon at
 * 0.79 from 6,000 ft and 0.71 from 10,000 ft; it is almost all Rayleigh
 * in-scatter (taking the aerosol out entirely moves it by 1.3 points), so the
 * plan's first candidate (Mie density with altitude) cannot remove it, and the
 * haze mix is already scene-linear (PHYS_SKY) with no colour-space error left.
 *
 * WHAT CLARITY DOES. In clear daylight, from altitude, the in-scatter on the
 * NEAR AND MID FIELD is cut by `strength`, fading back to the physical value
 * across [nearKm, farKm] of distance, so the city under the aircraft keeps its
 * block-to-street contrast while the far field — distant ridges, the 50 km
 * band, the horizon — keeps exactly the depth it had:
 *   S' = S x (1 - k),  k = strength x clearAir x day x eyeRamp(AGL)
 *                          x (1 - smoothstep(nearKm, farKm, distance)).
 * Extinction (the transmittance T: the tint and dimming of distance) is not
 * touched, and S x (1 - k) still grows monotonically with distance, so no ring
 * and no inversion. clearAir = (1 - overcast)(1 - fog): weather keeps every
 * bit of its murk. eyeRamp is 0 below eyeRampM[0] of eye height, so a
 * low-level frame is the previous frame exactly.
 *
 * One anchored edit of the built Enhanced aerial text (after PHYS_SKY,
 * TRUE_SCALE and the Living World ground edits) that throws on a missing or
 * repeated anchor; one uniform. Flag off: the text is the input, byte for
 * byte, and the effect gains no uniform.
 */
import { Vector4 } from 'three';
import { shipPassBlock, shipPassOn } from './ship-pass.js';

/** True when this page load carries AERIAL_CLARITY. */
export const AERIAL_CLARITY_ON = shipPassOn('AERIAL_CLARITY');
const P = shipPassBlock('AERIAL_CLARITY') ?? {};

/** (k at full ramp before the distance fade, nearKm, farKm, -); x is written per frame. */
export const AERIAL_CLARITY_UNIFORMS = {
  uShipClarity: { value: new Vector4(0, P.nearKm ?? 12, P.farKm ?? 45, 0) },
};

const LIT_FROM = '+apS*uPskySunIllum+pskyNightAir(apDir)*(1.-apT);';
const LIT_TO = '+apS*uPskySunIllum*shipClarity(length(metricRay)*.001)+pskyNightAir(apDir)*(1.-apT);';
const MAIN = 'void mainImage(';
const CLARITY_GLSL = `uniform vec4 uShipClarity;
// SHIP PASS SKY (AERIAL_CLARITY): the share of the in-scatter clear air keeps
// at this distance (km): 1 - k in the near field, back to 1 by uShipClarity.z.
float shipClarity(float km){return 1.-uShipClarity.x*(1.-smoothstep(uShipClarity.y,uShipClarity.z,km));}
`;

function once(src, from, to, what) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`aerial-clarity: ${what} anchor ${at < 0 ? 'missing' : 'repeated'}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * The Enhanced aerial text with clarity (flag on), or `src` unchanged. A text
 * without the physical in-scatter line (PHYS_SKY off) has nothing to clear and
 * is returned as it is.
 */
export function aerialClarityShader(src, on = AERIAL_CLARITY_ON) {
  if (!on || !src.includes(LIT_FROM)) return src;
  const out = once(src, LIT_FROM, LIT_TO, 'in-scatter');
  return once(out, MAIN, `${CLARITY_GLSL}${MAIN}`, 'mainImage');
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};
const c01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/**
 * k for this frame, before the distance fade: strength x clear air x day x the
 * eye-height ramp. `env` is the cinema environment ({ day, overcast, fog }).
 */
export function aerialClarityK(eyeAglM, env, on = AERIAL_CLARITY_ON) {
  if (!on || !env) return 0;
  const ramp = P.eyeRampM ?? [900, 2600];
  const clear = (1 - c01(env.overcast)) * (1 - c01(env.fog));
  return c01(P.strength ?? 0.45) * clear * c01(env.day) * smooth(ramp[0], ramp[1], eyeAglM);
}

/** The share of S kept at `km` for a frame's k (the GLSL's shipClarity, mirrored for the gate). */
export function clarityKeep(k, km) {
  return 1 - k * (1 - smooth(P.nearKm ?? 12, P.farKm ?? 45, km));
}

/** Per frame (the aerial effect's update): write k into the shared uniform. */
export function updateAerialClarity(eyeAglM, env) {
  AERIAL_CLARITY_UNIFORMS.uShipClarity.value.x = aerialClarityK(eyeAglM, env);
}

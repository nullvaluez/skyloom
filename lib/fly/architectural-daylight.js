/** Scene-linear daylight for the BUILDING_REALISM preview.
 *
 * Material albedo is already authored under neutral illumination. The former
 * cinematic key added amber at noon, then added amber again in the art pass.
 * Use one daylight white point and reserve the warmer spectrum for low sun.
 * This is shared scene illumination: glass, stone, aircraft and the sky's
 * environment bake must see the same light. No per-object inverse colour tint.
 * Run after cinema art, before curated weather and the physical-sky override.
 */
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export const ARCHITECTURAL_DAYLIGHT = Object.freeze({
  key: [1, 0.975, 0.93],
  lowSun: [1, 0.79, 0.56],
  skyFill: [0.62, 0.75, 0.96],
  overcastFill: [0.84, 0.88, 0.94],
  ground: [0.17, 0.165, 0.15],
});

export function applyArchitecturalDaylight(environment) {
  const e = environment;
  const day = clamp(e.day);
  // Preserve every full-night value exactly, including the moonlight policy.
  if (day === 0) return e;
  const cloud = clamp(e.overcast);
  const golden = clamp(e.golden);
  const P = ARCHITECTURAL_DAYLIGHT;
  for (let i = 0; i < 3; i++) {
    const key = mix(P.key[i], P.lowSun[i], golden);
    e.keyColor[i] = mix(e.keyColor[i], mix(key, 1, cloud * 0.7), day);
    e.fillColor[i] = mix(e.fillColor[i], mix(P.skyFill[i], P.overcastFill[i], cloud), day);
    e.groundColor[i] = mix(e.groundColor[i], P.ground[i], day);
    // The visible solar disc and the reflected environment use this spectrum.
    e.sunTint[i] = mix(e.sunTint[i], e.keyColor[i], day);
  }
  // A modest open-sky fill retains material information on shaded elevations.
  // Cloud cover keeps its existing diffuse-light increase and key attenuation.
  e.fill *= mix(1, 1.16, day * (1 - cloud));
  e.environment *= mix(1, 1.12, day * (1 - cloud));
  return e;
}

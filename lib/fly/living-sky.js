const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const blend = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

/** Scene-linear sky radiance. Uses the same damped weather as the ground key.
 * Cloud density, shape, motion and lighting are owned by the existing pass. */
export function livingSkyPalette(light, weather = {}) {
  const overcast = clamp(light.overcast), fog = clamp(weather.fogT);
  const golden = clamp(light.golden), veil = 1 - (1 - overcast) * (1 - fog * .8);
  const horizon = blend(blend([.46, .63, .80], [.85, .46, .22], golden * .7), [.39, .425, .46], veil);
  const zenith = blend([.025, .105, .285], [.17, .195, .23], veil);
  return { horizon, zenith, sunTint: blend([1, .90, .72], [1, .53, .23], golden),
    sunVisibility: (1 - overcast) ** 2 * (1 - fog), fog, overcast };
}

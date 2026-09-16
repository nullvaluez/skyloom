const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Optical density follows damped weather, rather than capture imagery. */
export function livingAirProfile(weather = {}, latitude = 0) {
  const overcast = clamp(weather.overcastT), fog = clamp(weather.fogT);
  return { metricScale: 1 / Math.max(.1, Math.cos(latitude * Math.PI / 180)),
    extinction: .00012 + overcast * .000045 + fog * .00024, heightM: 1200 };
}

/** Diagnostic counterpart: average density along the eye-to-surface ray.
 * The closest 250 m retain their local contrast. Heights are physical metres. */
export function livingAirTransmission(distanceM, eyeHeightM, surfaceHeightM, profile) {
  const a = Math.max(0, eyeHeightM) / profile.heightM;
  const b = Math.max(0, surfaceHeightM) / profile.heightM, delta = b - a;
  const density = Math.abs(delta) < .0001 ? Math.exp(-a) : (Math.exp(-a) - Math.exp(-b)) / delta;
  return Math.exp(-profile.extinction * Math.max(0, distanceM - 250) * density);
}

export const LIVING_AIR_GLSL = `
float livingAirTransmission(float distanceM, float eyeHeightM, float surfaceHeightM) {
  float a=max(0.,eyeHeightM)/uLivingAir.w;
  float b=max(0.,surfaceHeightM)/uLivingAir.w;
  float delta=b-a;
  float density=abs(delta)<.0001?exp(-a):(exp(-a)-exp(-b))/delta;
  return exp(-uLivingAir.z*max(0.,distanceM-250.)*density);
}
`;

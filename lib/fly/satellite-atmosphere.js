/** Cinematic satellite atmosphere. Pure functions; sun.sinEl is the UNCLAMPED
 * solar elevation source. The hillshade `el` cannot describe dusk or night.
 * Values are art-direction defaults for the preview, not GPU-certified limits.
 */
import { immersiveOn, immersiveLighting } from './immersive';
const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const trueElevation = (sun) => Math.asin(Number.isFinite(sun?.sinEl) ? clamp(sun.sinEl, -1, 1) : 1) * 180 / Math.PI;
const nightWeight = (elevation) => 1 - smooth(-12, -1, elevation);
const NIGHT_RIM = [36 / 255, 39 / 255, 43 / 255]; // #24272b, output-space sRGB
const NIGHT_VOID = [10 / 255, 13 / 255, 18 / 255]; // #0a0d12

/** Update the shared rim BEFORE weather, so fog, distant haze and SkyDome
 * all meet the neutral night HDRI. The old saturated #101a30 appeared as a
 * separate blue stripe. Caller owns the cinematic/satellite gate; daytime
 * returns without touching either array. No allocation in the frame loop.
 */
export function applySatelliteNightRim(rim, voidColor, sun) {
  const night = nightWeight(trueElevation(sun));
  if (night === 0) return;
  for (let i = 0; i < 3; i++) {
    rim[i] = mix(rim[i], NIGHT_RIM[i], night);
    voidColor[i] = mix(voidColor[i], NIGHT_VOID[i], night);
  }
}

export function resolveSatelliteAtmosphere(sun = {}, weather = {}) {
  const immersive = immersiveOn('lighting') ? immersiveLighting(sun, weather) : null;
  // Missing solar telemetry is neutral daylight, never a black boot frame.
  const elevation = trueElevation(sun);
  const day = smooth(-6, 18, elevation);
  const night = nightWeight(elevation);
  const twilight = smooth(-12, -2, elevation) * (1 - smooth(3, 18, elevation));
  const overcast = clamp(weather?.overcastT ?? 0, 0, 1);
  const fog = clamp(weather?.fogT ?? 0, 0, 1);
  const warmth = twilight * (1 - overcast * 0.62);
  // A small exposure reduction protects emissive colour, rather than using
  // bloom to lift the entire night image. Neutral/cool illumination remains.
  let exposureStops = -0.12 * day - 0.18 * night - 0.08 * twilight;
  // --- R25 C (LIGHT_BUBBLE_R25.grade): the NIGHT grade -------------------
  // `sun.grade` is components/fly/LightBubbleRig.jsx's per-frame publication
  // ({ nightBloomThreshold, nightExposureStops }); absent = flag off, toy, or
  // the frame before the rig's first. It arrives ON THE SUN OBJECT rather than
  // through an import because scripts/graphics-unit.mjs loads this file as a
  // `data:` URL and rewrites exactly one specifier (`./immersive`): a second
  // import would break a frozen node gate this round may not edit. The `+=` is
  // skipped entirely when the grade is absent, so the number is not merely
  // equal to R24's, it is the same expression.
  const grade = sun.grade;
  if (grade && Number.isFinite(grade.nightExposureStops)) exposureStops += grade.nightExposureStops * night;
  const exposureGamma = 2 ** (exposureStops / 2.2);
  return {
    elevation, day, night, twilight, overcast, fog, exposureStops,
    // These are FINAL intensities, not multipliers on the legacy day/night
    // ramp. Multiplying both ramps crushed night IBL to 0.032 and discarded
    // almost all material response on surfaces away from emissive windows.
    environment: immersive ? immersive.environment : mix(0.16, 0.78, day) * (1 - 0.20 * overcast),
    background: mix(0.22, 0.88, day) * (1 - 0.25 * overcast) * (1 - 0.28 * fog),
    bloomIntensity: mix(0.38, 0.56, night),
    // R25 C: night bloom threshold — 0.91 today (satellite-atmosphere OVERRIDES
    // SKY_LIVE.bloomNight.threshold 0.62 at Effects.jsx:657), which is above
    // the linear value of nearly every night emitter B's ground light makes, so
    // the night city cannot bloom at all. The ternary resolves to the literal
    // 0.91 with no grade published, i.e. the identical expression.
    bloomThreshold: mix(1.08, grade && Number.isFinite(grade.nightBloomThreshold) ? grade.nightBloomThreshold : 0.91, night),
    // WhiteBalanceEffect operates in sRGB; exposure is converted accordingly.
    balance: [
      (1 + 0.032 * warmth - 0.018 * night) * exposureGamma,
      (1 - 0.006 * warmth) * exposureGamma,
      (1 - 0.036 * warmth + 0.023 * night) * exposureGamma,
    ],
    cloudColor: [
      mix(0.76, 0.98, day) + 0.035 * warmth,
      mix(0.82, 0.98, day) - 0.045 * warmth,
      mix(0.92, 1.0, day) - 0.105 * warmth,
    ],
    cloudOpacity: (0.82 + 0.12 * overcast) * (1 - 0.12 * night),
    cloudDepth: 0.74 + 0.38 * overcast,
    cloudShadowWeight: smooth(2, 22, elevation) * (1 - 0.80 * overcast) * (1 - 0.65 * fog),
    // Haze disappears with the same astronomical night envelope; it must not
    // add a daytime grey veil over lit architecture after material lighting.
    aerialDayWeight: 0.24 + 0.76 * day,
  };
}

/** Stable cloud roles: each cluster shares a condensation band, with bounded
 * variation inside it. Round-robin tier reductions retain the same banks.
 * Bounds describe lobe OFFSETS in drei, not their size: large bounds with
 * small default lobes make disconnected confetti. Compact bounds and a
 * larger minimum lobe connect the existing eight sprites without adding any.
 */
export function satelliteCloudShape(seed, clusterCount = 6) {
  const hash = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const cluster = seed % Math.max(1, clusterCount);
  const bank = cluster % 3 === 0;
  const altitude = (bank ? 0.16 : 0.31) + 0.15 * hash(cluster + 52);
  return {
    width: bank ? 1.08 : 0.63 + 0.18 * hash(seed + 81),
    depth: bank ? 0.46 : 0.55 + 0.18 * hash(seed + 93),
    height: bank ? 0.34 : 0.72 + 0.30 * hash(seed + 74),
    altitude: altitude + 0.055 * (hash(seed + 74) - 0.5),
    clusterSpread: bank ? 0.64 : 0.49,
    volume: bank ? 1.18 : 1.10 + 0.15 * hash(seed + 93),
    smallestVolume: bank ? 0.48 : 0.42,
    opacity: bank ? 0.86 : 1,
  };
}

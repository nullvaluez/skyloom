/** TRUE EARTH — close the gap between a fading solar sky and its night floor.
 * This is an output-radiance policy shared by the sky, aerial perspective and
 * IBL. It does not change solar scattering, sun/moon position, exposure, stars,
 * building lights, weather or the scene's day/night clock.
 */
import { TWILIGHT_BALANCE } from '../fly-constants.js';
import { pinned } from '../fly-pins.js';

export const TWILIGHT_BALANCE_ACTIVE = pinned(TWILIGHT_BALANCE, '__flyTwilightBalanceOverride');
export const TWILIGHT_BALANCE_ON = TWILIGHT_BALANCE_ACTIVE.enabled === true;

const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Preserve the authored endpoints exactly. At civil twilight the physical
 * sky already supplies warm directional sunlight: extra saturation clips its
 * blue channel to zero, while the late night floor leaves a black/purple dip.
 * Retire that saturation boost and let the existing diffuse floor arrive
 * continuously. The −6°/+6° ramp removes the measured below-night radiance
 * trough at both the zenith and 30° elevation; the former −8°/+4° candidate
 * still dipped 12% below the final floor before brightening again.
 *
 * Only the ADDITIONAL floor thins with altitude (8 km Rayleigh scale height
 * above 1 km) and retires entirely by 60 km. The original full-night floor is
 * unchanged, and this pass adds no new luminous dome above the atmosphere.
 */
export function twilightBalance(elevationDeg, altitudeKm, saturation, nightWeight, enabled = TWILIGHT_BALANCE_ON) {
  if (!enabled || !Number.isFinite(elevationDeg) || elevationDeg >= 12 || elevationDeg <= -12) {
    return { saturation, nightWeight };
  }
  const envelope = smooth(-12, -6, elevationDeg) * (1 - smooth(0, 10, elevationDeg));
  const sat = saturation + (Math.min(saturation, 1) - saturation) * envelope;
  const h = Number.isFinite(altitudeKm) ? Math.max(0, altitudeKm) : 0;
  const air = Math.exp(-Math.max(0, h - 1) / 8) * (1 - smooth(30, 60, h));
  const earlyFloor = 1 - smooth(-6, 6, elevationDeg);
  return { saturation: sat, nightWeight: nightWeight + Math.max(0, earlyFloor - nightWeight) * air };
}

const LOWER = [.16, .20, .26];
const UPPER = [.62, .68, .74];
const KEY = [.92, .96, 1];
const GOLDEN = [1, .67, .36];

/** The analytic model contains solar scattering, which correctly reaches zero
 * at night. Use its chroma through the shared daylight ramp; retain the existing
 * cool night illumination rather than normalizing zero into black clouds.
 * out: key RGB, upper ambient RGB, lower ambient RGB. No frame allocations. */
export function paintedCloudLight(model, golden, out) {
  const a = model.ambient;
  const y = .2126*a[0] + .7152*a[1] + .0722*a[2];
  const day = Math.min(1, Math.max(0, model.day));
  const weight = day * Math.min(1, Math.max(0, y / 1e-6));
  const inverseY = y > 0 ? 1/y : 0;
  for (let c = 0; c < 3; c++) {
    const key = KEY[c] + (GOLDEN[c] - KEY[c]) * golden;
    out[c] = key + (model.key[c] - key) * weight;
    out[c+3] = UPPER[c] + (a[c]*inverseY*.6716 - UPPER[c]) * weight;
    out[c+6] = LOWER[c] + (a[c]*inverseY*.1961 - LOWER[c]) * weight;
  }
  return out;
}

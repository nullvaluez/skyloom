/**
 * TRUE EARTH — verify-sun-azimuth: SUN_TRUE_AZ (lib/fly/sun-model.js).
 *
 * THE DEFECT. computeSun returned the HOUR ANGLE as `az`, and every consumer
 * builds the sun direction as (−sin az·cos el, sin el, cos az·cos el). So the
 * noon sun always sat toward +Z (south): wrong for the whole southern
 * hemisphere (the Sydney adventure's shadows pointed the wrong way) and
 * ~20° off on mid-latitude summer mornings.
 *
 * THE REFERENCE is independent of the app's model: Meeus, Astronomical
 * Algorithms ch. 25 (higher-accuracy solar coordinates with nutation and
 * aberration) and ch. 12 (sidereal time), written out below. The app uses the
 * Astronomical Almanac low-precision algorithm (Michalsky 1988), a different
 * series, so agreement checks both.
 *
 * THE CONTRACT
 *  (1) flag off (the default): computeSun is the legacy model (az = H);
 *  (2) flag on: elevation within 0.05° of the reference, every city/date/hour;
 *  (3) flag on: sun direction within 0.05° of the reference whenever the sun
 *      is up (angular separation, which stays well-conditioned at the zenith
 *      where an azimuth difference does not);
 *  (4) flag on: `az < 0` means morning (hour angle < 0) at every sample,
 *      southern hemisphere included — the dawn/dusk HDRI split's contract;
 *  (5) the defect is real: with the flag off, the Sydney noon sun is ~180° off.
 *
 * Run: node scripts/verify-sun-azimuth.mjs
 */
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const { computeSun } = await import('../lib/fly/sun-model.js');
const { SUN_TRUE_AZ } = await import('../lib/fly/fly-constants.js');

const DEG = Math.PI / 180;
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const wrap = (a) => {
  let x = (a + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
};

/** Reference (Meeus ch. 25 + 12): compass azimuth (deg, N=0, E=90) and elevation (deg). */
function reference(lon, lat, tMs) {
  const jd = tMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps0 = 23 + 26 / 60 + (21.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T) / 3600;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const theta0 = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000;
  const ha = (theta0 + lon) * DEG - ra;
  const phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { az: ((az / DEG) % 360 + 360) % 360, el: el / DEG };
}
/** Unit direction (east, north, up) from compass azimuth and elevation in degrees. */
const enu = (azDeg, elDeg) => {
  const a = azDeg * DEG;
  const e = elDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
};
/** The app's `az` convention -> compass azimuth: compass = az + 180°. */
const compassOf = (az) => (((az / DEG + 180) % 360) + 360) % 360;

const cities = [
  ['Sydney', 151.21, -33.87],
  ['Rio de Janeiro', -43.17, -22.91],
  ['Cape Town', 18.42, -33.92],
  ['Quito', -78.47, -0.18],
  ['Columbus OH', -82.99, 39.96],
  ['Reykjavik', -21.94, 64.15],
  ['Tromso', 18.96, 69.65],
  ['Auckland', 174.76, -36.85],
];
const dates = ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21', '2026-02-11'];

// (1) flag off is the legacy model
{
  let ok = true;
  for (const [, lon, lat] of cities) {
    for (const day of dates) {
      const t = Date.parse(`${day}T15:30:00Z`);
      const a = computeSun(lon, lat, t, false);
      const legacyH = ((((((15.5 + lon / 15) % 24) + 24) % 24) - 12) / 12) * Math.PI;
      if (a.az !== legacyH || 'hourAngle' in a) ok = false;
    }
  }
  check('(1) flag explicitly off: az is the legacy hour angle, bit for bit', ok, `default enabled=${SUN_TRUE_AZ.enabled}`);
}

// (2)-(4) flag on against the reference
{
  let worstEl = 0;
  let worstAz = 0;
  let worstElAt = '';
  let worstAzAt = '';
  let signOk = true;
  let signAt = '';
  let samples = 0;
  for (const [name, lon, lat] of cities) {
    for (const day of dates) {
      for (let h = 0; h < 24; h += 0.5) {
        const t = Date.parse(`${day}T00:00:00Z`) + h * 3600000;
        const s = computeSun(lon, lat, t, true);
        const r = reference(lon, lat, t);
        const el = Math.asin(Math.max(-1, Math.min(1, s.sinEl))) / DEG;
        const dEl = Math.abs(el - r.el);
        if (dEl > worstEl) {
          worstEl = dEl;
          worstElAt = `${name} ${day} ${h}h`;
        }
        if (r.el > 0) {
          const a = enu(compassOf(s.az), el);
          const b = enu(r.az, r.el);
          const dAz = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / DEG;
          if (dAz > worstAz) {
            worstAz = dAz;
            worstAzAt = `${name} ${day} ${h}h`;
          }
        }
        if (Math.abs(Math.sin(s.hourAngle)) > 1e-6 && Math.sign(s.az) !== Math.sign(Math.sin(s.hourAngle))) {
          signOk = false;
          signAt = `${name} ${day} ${h}h`;
        }
        samples++;
      }
    }
  }
  check('(2) flag on: elevation within 0.05° of the reference', worstEl <= 0.05, `worst ${worstEl.toFixed(3)}° at ${worstElAt} (${samples} samples)`);
  check('(3) flag on: sun direction within 0.05° of the reference while the sun is up', worstAz <= 0.05, `worst ${worstAz.toFixed(3)}° at ${worstAzAt}`);
  check('(4) flag on: az < 0 is morning in both hemispheres', signOk, signAt);
}

// (5) the defect, measured: Sydney at local solar noon on the June solstice
{
  const lon = 151.21;
  const t = Date.parse('2026-06-21T00:00:00Z') + ((12 - lon / 15) * 3600000);
  const legacy = computeSun(lon, -33.87, t, false);
  const fixed = computeSun(lon, -33.87, t, true);
  const r = reference(lon, -33.87, t);
  const legacyErr = Math.abs(wrap(compassOf(legacy.az) - r.az));
  const fixedErr = Math.abs(wrap(compassOf(fixed.az) - r.az));
  check(
    '(5) Sydney June noon: the legacy sun is in the wrong half of the sky; the fix is not',
    legacyErr > 150 && fixedErr < 1,
    `reference azimuth ${r.az.toFixed(1)}° (north), legacy off by ${legacyErr.toFixed(1)}°, fixed off by ${fixedErr.toFixed(2)}°`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

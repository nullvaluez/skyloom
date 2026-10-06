import { HILLSHADE, SKY_LIVE, SUN_TRUE_AZ } from './fly-constants';
import { pinned } from './fly-pins';

/**
 * Round 16 "Living World" — the SUN, for real.
 *
 * Through R15 the day cycle was LONGITUDE-ONLY (`localH = UTC + lon/15`,
 * `sunFactor = max(0, cos((localH-12)/12·π))`): Barrow and Quito shared one
 * sun, December looked like June, there was no polar night, and the hillshade
 * sun could disagree with the HDRI's baked one. Every downstream night system
 * (HDRI bucket, moonlit key, altAtmo rim, white balance, building windows,
 * satellite roads/city glow, tracer gain) reads `runtime.sun.frac`, so the
 * whole living sky was riding a placeholder.
 *
 * This is the standard low-precision solar-position model — declination from
 * the day of year, hour angle from mean solar time — which is accurate to
 * roughly a degree of elevation. That is far below what any consumer here can
 * see (the coarsest is a 4-bucket HDRI split), and it costs a handful of
 * trig calls on a 60-second cadence.
 *
 * TWO CONVENTIONS ARE LOAD-BEARING and must not be "cleaned up":
 *
 *  1. `az` IS THE HOUR ANGLE H, not a compass azimuth (flag off — see the
 *     TRUE EARTH note below for SUN_TRUE_AZ). It is negative before
 *     local solar noon and positive after, wrapped into [−π, π). Three
 *     systems key on that: the HDRI dawn/dusk split (`az < 0` = morning), the
 *     hillshade east/west flip (`-sin(az)` — verify-sat-depth gates the sign
 *     change), and the warp/burst cues. Wrapping localSolarH into [0,24)
 *     BEFORE forming H is what keeps `az` bit-identical to the R15 formula
 *     for every (lon, t) — this model changes the sun's HEIGHT, never its
 *     left/right sense.
 *
 *  2. `frac` is NOT sin(elevation). It is elevation normalised against a
 *     reference elevation (`SKY_LIVE.sun.elRefDeg`, 50°) and clamped to
 *     [0,1], so "full daylight" is reached at a realistic sun height instead
 *     of only at the zenith. Without the reference a 40°-latitude winter noon
 *     (el ≈ 26°) would read frac 0.44 — permanent dusk. Consumers treat frac
 *     as "how much day is it", which is exactly what this gives them.
 *
 * `el` keeps the R15 clamp into [HILLSHADE.minElRad, maxElRad]: the graze
 * floor keeps relief readable at night and the noon cap stops a zenith sun
 * from flattening every slope.
 *
 * TRUE EARTH (SUN_TRUE_AZ, fly-constants.js). Using H as an azimuth put the
 * noon sun toward +Z (south) at every latitude: wrong for the whole southern
 * hemisphere, and ~20° off on mid-latitude summer mornings. With the flag on,
 * `az` is the TRUE azimuth expressed in the SAME convention,
 * az = atan2(sin H, cos H·sin φ − tan δ·cos φ), so the direction formula
 * (−sin az·cos el, sin el, cos az·cos el) every consumer already uses points
 * at the real sun. Both load-bearing properties survive exactly: the sign of
 * atan2 is the sign of sin H, so `az < 0` is still "morning" in both
 * hemispheres, and the east/west flip still happens at solar noon. The sun's
 * position comes from the Astronomical Almanac algorithm (~0.01°, equation of
 * time included), and `hourAngle` carries H for anyone who needs it.
 */
const TRUE_AZ = pinned(SUN_TRUE_AZ, '__flySunTrueAzOverride');
/** The resolved SUN_TRUE_AZ block (URL / console pins applied once, at load). */
export const SUN_TRUE_AZ_ACTIVE = TRUE_AZ;

const DEG = Math.PI / 180;
const DAY_MS = 86400000;
const TWO_PI = Math.PI * 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** UTC day of year, 1 = Jan 1 (Date.UTC(y, 0, 0) is Dec 31 of y−1). */
function utcDayOfYear(d) {
  return Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
      DAY_MS
  );
}

/**
 * Solar state at a place and time.
 *
 * @param {number} lonDeg  longitude, east positive
 * @param {number} latDeg  latitude, north positive
 * @param {number} [tMs]   epoch ms (defaults to now — callers that honour
 *                         `window.__flySunOverride` pass it in explicitly)
 * @returns {{frac:number, az:number, el:number, decl:number, sinEl:number}}
 *   frac  0..1 "how much day is it" (see the reference-elevation note above)
 *   az    hour angle in radians, [−π, π) — negative = morning (KEEP)
 *   el    sun elevation in radians, clamped to the hillshade band
 *   decl  solar declination in radians (seasons; polar day/night fall out)
 *   sinEl raw sin(elevation), NEGATIVE below the horizon (unclamped truth)
 */
export function computeSun(lonDeg, latDeg, tMs, trueAz = TRUE_AZ.enabled === true) {
  const t = Number.isFinite(tMs) ? tMs : Date.now();
  const lon = Number.isFinite(lonDeg) ? lonDeg : 0;
  // The poles make cos(lat) vanish and the hour angle meaningless; clamping
  // just inside them keeps every term finite without changing any real case.
  const lat = Number.isFinite(latDeg) ? Math.max(-89.9, Math.min(89.9, latDeg)) : 0;
  if (trueAz) return trueSun(lon, lat, t);

  const d = new Date(t);
  const n = utcDayOfYear(d);
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;

  // Declination: ±23.44° cosine wave with its minimum at the solstice. N+10
  // puts Jan 1 ten days after the December solstice.
  const decl = -23.44 * DEG * Math.cos((TWO_PI * (n + 10)) / 365.24);

  // Mean solar time. The wrap into [0,24) is what makes `az` identical to the
  // R15 formula (see convention 1 above) — without it a longitude that pushes
  // the local hour past midnight flips the sign of H and would swap dawn for
  // dusk on the other side of the date line.
  const localSolarH = ((((utcH + lon / 15) % 24) + 24) % 24);
  const H = ((localSolarH - 12) / 12) * Math.PI;

  const phi = lat * DEG;
  const sinEl =
    Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);

  const frac = clamp01(sinEl / Math.sin(SKY_LIVE.sun.elRefDeg * DEG));
  const el = Math.min(
    HILLSHADE.maxElRad,
    Math.max(HILLSHADE.minElRad, Math.asin(Math.min(1, Math.max(0, sinEl))))
  );

  return { frac, az: H, el, decl, sinEl };
}

/**
 * SUN_TRUE_AZ: the Astronomical Almanac low-precision solar position
 * (Michalsky 1988, ~0.01° for 1950–2050: declination and right ascension from
 * the mean longitude and anomaly, hour angle from sidereal time, so the
 * equation of time is implicit), with the true azimuth in the app's `az`
 * convention. Same return shape as the legacy path, plus `hourAngle`.
 * The fractional-year (Spencer/NOAA) series was tried first and rejected:
 * fitted to a typical year, it put the 2026 March-equinox declination 0.42°
 * off (scripts/verify-sun-azimuth.mjs).
 */
function trueSun(lon, lat, tMs) {
  const n = tMs / DAY_MS + 2440587.5 - 2451545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstH = (18.697374558 + 24.06570982441908 * n) % 24;
  const h = (gmstH * 15 + lon) * DEG - ra;
  const H = Math.atan2(Math.sin(h), Math.cos(h)); // local hour angle, wrapped
  const phi = lat * DEG;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const frac = clamp01(sinEl / Math.sin(SKY_LIVE.sun.elRefDeg * DEG));
  const el = Math.min(
    HILLSHADE.maxElRad,
    Math.max(HILLSHADE.minElRad, Math.asin(Math.min(1, Math.max(0, sinEl))))
  );
  return { frac, az, el, decl, sinEl, hourAngle: H };
}

/**
 * Night weight from the sun fraction: 0 in daylight, 1 once the sun is well
 * down. An INVERSE smoothstep across [starFullFrac, starZeroFrac] — stars and
 * the moon come up as the last light goes, and the term is exactly 0 (never
 * an epsilon) above starZeroFrac so a daytime sky is untouched.
 */
export function nightWeight(frac) {
  const ns = SKY_LIVE.nightSky;
  const hi = ns.starZeroFrac;
  const lo = ns.starFullFrac;
  if (!(frac < hi)) return 0;
  if (frac <= lo) return 1;
  const x = (hi - frac) / Math.max(1e-6, hi - lo);
  return x * x * (3 - 2 * x);
}

/**
 * Moon direction for the night sky: ANTI-SOLAR in hour angle (a full moon
 * rises as the sun sets) at a fixed, gentle elevation. Returns a unit-ish
 * [x, y, z] in the SAME convention the hillshade key uses
 * (`-sin(az)·cos(el), sin(el), cos(az)·cos(el)`), so the moon and the moonlit
 * directional key agree about which side of the sky the light comes from.
 */
export function moonDirFromSun(az, out) {
  const el = SKY_LIVE.nightSky.moonElRad;
  const a = az + Math.PI; // anti-solar
  const ce = Math.cos(el);
  const v = out || [0, 0, 0];
  v[0] = -Math.sin(a) * ce;
  v[1] = Math.sin(el);
  v[2] = Math.cos(a) * ce;
  return v;
}

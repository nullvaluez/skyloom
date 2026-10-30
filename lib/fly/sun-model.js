import { HILLSHADE, SKY_LIVE, SUN_TRUE_AZ } from './fly-constants';
import { pinned } from './fly-pins';
// SHIP PASS SKY (SK-3): REAL_MOON is read only through ship-pass.js.
import { shipPassBlock } from './ship-pass';

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
  if (trueAz) return recordSun(trueSun(lon, lat, t), lon, lat, t, true);

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

  return recordSun({ frac, az: H, el, decl, sinEl }, lon, lat, t, false);
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

/*
 * SHIP PASS SKY (FLY_SHIP_PASS.md SK-3) — REAL_MOON: the moon from an
 * ephemeris instead of "always full, anti-solar, 34° up".
 *
 * THE EPHEMERIS. Meeus, Astronomical Algorithms (2nd ed., 1998), chapter 47
 * (the ELP-2000/82 main problem as Meeus tabulates it), TRUNCATED: the 26
 * largest longitude/distance terms of Table 47.A and the 14 largest latitude
 * terms of Table 47.B, plus the A1/A2/A3 planetary and flattening terms. The
 * omitted rows are each under 0.004° (Σl) and 0.0025° (Σb), together a few
 * hundredths of a degree — two orders below what any consumer can see, and
 * below the 0.3° the gate holds against JPL Horizons. Then the textbook chain:
 * mean obliquity (nutation, ±0.005°, omitted), RA/Dec, the hour angle from
 * Greenwich mean sidereal time (IAU 1982, on the UT clock), altitude and
 * azimuth, and the TOPOCENTRIC parallax in altitude (the moon's horizontal
 * parallax is ~0.95°: without it a moon on the horizon is a degree too high).
 * The phase comes from the elongation against the sun's apparent longitude
 * (the same Almanac solar series trueSun uses), the illuminated fraction from
 * the phase angle (Meeus ch. 48). scripts/verify-ship-sky.mjs checks it
 * against JPL Horizons on 20 dates (position ≤ 0.3°, illumination ≤ 2%) and
 * against Meeus's own worked example 47.a.
 *
 * HOW THE CONSUMERS INHERIT IT UNEDITED. moonDirFromSun(az, out) is called by
 * FlyScene (the day-cycle cadence and the key light), the cloud pass and
 * cinema-environment, always with an `az` that came out of computeSun — the
 * day cycle publishes it as runtime.sun.az. So computeSun records which place
 * and instant produced each `az` (a 16-slot ring, a few assignments per call),
 * and moonDirFromSun with REAL_MOON on looks the sun's `az` up and returns the
 * moon of THAT place and instant, in the SAME `az` convention the sun used
 * (true azimuth under SUN_TRUE_AZ, the hour angle without it). The day cycle
 * calls moonDirFromSun synchronously right after computeSun, so the lookup
 * cannot miss there; the result is memoised on `az`, so the per-frame callers
 * that pass the same runtime.sun.az reuse it until the sun next moves (every
 * 2 s). An `az` no computeSun produced (a gate's literal) falls back to the
 * legacy anti-solar moon, deterministically. With REAL_MOON off nothing here
 * runs and moonDirFromSun is the legacy function, value for value.
 */
const REAL_MOON = shipPassBlock('REAL_MOON');
/** True when this page load runs the ephemeris moon (REAL_MOON). */
export const REAL_MOON_ON = REAL_MOON?.enabled === true;

const RAD = 180 / Math.PI;
const norm360 = (d) => ((d % 360) + 360) % 360;
// TT − UT (seconds) for the 2020s; the moon moves 0.01° in it, the sky 0.29°
// (which is why the sidereal time stays on the UT clock).
const DELTA_T_S = 69;
// Table 47.A, the 26 largest rows: D, M, M', F, Σl (1e-6°), Σr (1e-3 km).
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
];
// Table 47.B, the 14 largest rows: D, M, M', F, Σb (1e-6°).
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359],
];

/**
 * The moon's geocentric ecliptic position for a Julian Ephemeris Day (TT):
 * { lambdaDeg, betaDeg, distKm } — Meeus ch. 47, truncated (see above).
 */
export function moonEcliptic(jde) {
  const T = (jde - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F = norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) / RAD;
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sl += l * e * Math.sin(arg);
    sr += r * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sb += b * e * Math.sin((d * D + m * M + mp * Mp + f * F) / RAD);
  }
  const A1 = (119.75 + 131.849 * T) / RAD, A2 = (53.09 + 479264.29 * T) / RAD, A3 = (313.45 + 481266.484 * T) / RAD;
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin((Lp - F) / RAD) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(Lp / RAD) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F / RAD) + 175 * Math.sin(A1 + F / RAD)
    + 127 * Math.sin((Lp - Mp) / RAD) - 115 * Math.sin((Lp + Mp) / RAD);
  return { lambdaDeg: norm360(Lp + sl / 1e6), betaDeg: sb / 1e6, distKm: 385000.56 + sr / 1000, T };
}

/**
 * The moon seen from a place at an instant (airless, topocentric).
 * @returns {{altDeg:number, compassAzDeg:number, az:number, hourAngle:number,
 *   raDeg:number, decDeg:number, distKm:number, phase:number, illum:number}}
 *   altDeg       topocentric altitude (parallax applied), degrees
 *   compassAzDeg azimuth from north through east, degrees [0, 360)
 *   az           the app's `az` (radians, from south positive west — the
 *                SUN_TRUE_AZ convention the direction formula reads)
 *   hourAngle    local hour angle, radians [−π, π)
 *   phase        0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter [0, 1)
 *   illum        illuminated fraction 0..1
 */
export function moonEphemeris(tMs, latDeg, lonDeg) {
  const t = Number.isFinite(tMs) ? tMs : Date.now();
  const lat = Number.isFinite(latDeg) ? Math.max(-89.9, Math.min(89.9, latDeg)) : 0;
  const lon = Number.isFinite(lonDeg) ? lonDeg : 0;
  const jdUt = t / DAY_MS + 2440587.5;
  const m = moonEcliptic(jdUt + DELTA_T_S / 86400);
  const lam = m.lambdaDeg / RAD, bet = m.betaDeg / RAD;
  const eps = (23.4392911 - 0.0130042 * m.T) / RAD;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
  const d0 = jdUt - 2451545.0, Tu = d0 / 36525;
  const gmst = norm360(280.46061837 + 360.98564736629 * d0 + 0.000387933 * Tu * Tu - (Tu * Tu * Tu) / 38710000);
  const h = (gmst + lon) / RAD - ra;
  const H = Math.atan2(Math.sin(h), Math.cos(h));
  const phi = lat / RAD;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const altGeo = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Topocentric: the observer stands an Earth radius off the line to the
  // moon's centre, which lowers it by asin(R/Δ · cos alt).
  const alt = altGeo - Math.asin((6378.14 / m.distKm) * Math.cos(altGeo));
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  // Phase: the elongation from the sun's apparent longitude (Almanac series).
  const n = jdUt - 2451545.0;
  const g = norm360(357.528 + 0.9856003 * n) / RAD;
  const lamSun = norm360(280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const rSunKm = 149597870.7 * (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g));
  const cosPsi = Math.cos(bet) * Math.cos((m.lambdaDeg - lamSun) / RAD);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const i = Math.atan2(rSunKm * Math.sin(psi), m.distKm - rSunKm * Math.cos(psi));
  return {
    altDeg: alt * RAD,
    compassAzDeg: norm360(azS * RAD + 180),
    az: azS,
    hourAngle: H,
    raDeg: norm360(ra * RAD),
    decDeg: dec * RAD,
    distKm: m.distKm,
    phase: norm360(m.lambdaDeg - lamSun) / 360,
    illum: (1 + Math.cos(i)) / 2,
  };
}

// The place and instant behind each `az` computeSun handed out (see above).
const SUN_CTX_N = 16;
const _sunCtx = Array.from({ length: SUN_CTX_N }, () => ({ az: NaN, lon: 0, lat: 0, t: 0, trueAz: true }));
let _sunCtxAt = 0;
function recordSun(sun, lon, lat, t, trueAz) {
  const c = _sunCtx[_sunCtxAt];
  c.az = sun.az;
  c.lon = lon;
  c.lat = lat;
  c.t = t;
  c.trueAz = trueAz;
  _sunCtxAt = (_sunCtxAt + 1) % SUN_CTX_N;
  return sun;
}
// The last moon resolved for a sun `az` (memo + moonState()'s "last frame").
const _moonFrame = { az: NaN, moon: null, dirAz: 0 };

/** The real moon for the sun whose `az` computeSun returned, or null. */
function moonForSunAz(az) {
  if (_moonFrame.moon && _moonFrame.az === az) return _moonFrame;
  for (let k = 1; k <= SUN_CTX_N; k++) {
    const c = _sunCtx[(_sunCtxAt - k + SUN_CTX_N) % SUN_CTX_N];
    if (c.az !== az) continue;
    const moon = moonEphemeris(c.t, c.lat, c.lon);
    _moonFrame.az = az;
    _moonFrame.moon = moon;
    // The sun's convention: the true azimuth, or the hour angle without SUN_TRUE_AZ.
    _moonFrame.dirAz = c.trueAz ? moon.az : moon.hourAngle;
    return _moonFrame;
  }
  return null;
}

/**
 * Moon direction for the night sky. Returns a unit [x, y, z] in the SAME
 * convention the hillshade key uses (`-sin(az)·cos(el), sin(el),
 * cos(az)·cos(el)`), so the moon and the moonlit key agree about which side of
 * the sky the light comes from.
 *
 * Legacy (REAL_MOON off): ANTI-SOLAR in hour angle (a full moon rises as the
 * sun sets) at a fixed, gentle elevation. REAL_MOON on: the ephemeris moon of
 * the place and instant that produced `az` (see above), its elevation floored
 * at REAL_MOON.minKeyElDeg so a moon on or under the horizon never lights the
 * world from below (moonLight() fades that key out and the disc with it).
 */
export function moonDirFromSun(az, out, realMoon = REAL_MOON_ON) {
  const v = out || [0, 0, 0];
  if (realMoon) {
    const f = moonForSunAz(az);
    if (f) {
      const el = Math.max(f.moon.altDeg, REAL_MOON?.minKeyElDeg ?? 2) / RAD;
      const ce = Math.cos(el);
      v[0] = -Math.sin(f.dirAz) * ce;
      v[1] = Math.sin(el);
      v[2] = Math.cos(f.dirAz) * ce;
      return v;
    }
  }
  const el = SKY_LIVE.nightSky.moonElRad;
  const a = az + Math.PI; // anti-solar
  const ce = Math.cos(el);
  v[0] = -Math.sin(a) * ce;
  v[1] = Math.sin(el);
  v[2] = Math.cos(a) * ce;
  return v;
}

const smooth01 = (a, b, x) => {
  const u = clamp01((x - a) / (b - a || 1e-6));
  return u * u * (3 - 2 * u);
};

/**
 * REAL_MOON's light, relative to today's moon (always full, at
 * SKY_LIVE.nightSky.moonElRad), for the moon of `moon` ({altDeg, illum}):
 *   keyK   the key intensity multiplier: vis × min(max(floor, illum × altF),
 *          s0 / sin(keyEl)) — the altitude factor altF = sin(alt) / s0
 *          (capped at 1) dims a low moon, the floor keeps D15's art floor, and
 *          the last term stops a high full moon from lighting the ground MORE
 *          than today's 34° one (the night key never exceeds today's value);
 *   fillK  the shadowless sky fill that tops the ground's horizontal light up
 *          to the floor wherever the key cannot (a low moon, a set moon), in
 *          units of today's key on a horizontal surface;
 *   lightK the ground's horizontal light now / today's, in [floorK, 1];
 *   vis    the disc and key visibility across REAL_MOON.horizonBandDeg;
 *   exposureStops  the night exposure opening, adapt × log2(1 / lightK).
 * Flag-off callers never ask; `moonLight(null)` is today's moon (all 1, no fill).
 */
export function moonLight(moon) {
  if (!moon) return { keyK: 1, fillK: 0, lightK: 1, vis: 1, exposureStops: 0 };
  const P = REAL_MOON ?? {};
  const floorK = Number.isFinite(P.floorK) ? P.floorK : 0.5;
  const band = P.horizonBandDeg ?? [-1, 2];
  const s0 = Math.sin(SKY_LIVE.nightSky.moonElRad);
  const keyEl = Math.max(moon.altDeg, P.minKeyElDeg ?? 2) / RAD;
  const sKey = Math.sin(keyEl);
  const vis = smooth01(band[0], band[1], moon.altDeg);
  const altF = Math.min(1, Math.max(0, Math.sin(moon.altDeg / RAD)) / s0);
  const keyK = vis * Math.min(Math.max(floorK, clamp01(moon.illum) * altF), s0 / Math.max(s0, sKey));
  const fillK = Math.max(0, floorK * s0 - keyK * sKey) / s0;
  const lightK = Math.min(1, (keyK * sKey) / s0 + fillK);
  const exposureStops = (Number.isFinite(P.exposureAdapt) ? P.exposureAdapt : 0.5) * Math.log2(1 / Math.max(floorK, lightK));
  return { keyK, fillK, lightK, vis, exposureStops };
}

/**
 * REAL_MOON's disc weight for the dome the frame last resolved: { vis, illum }
 * (the disc fades under the horizon; its glow follows the lit fraction).
 * Flag off, or before a moon is resolved: { vis: 1, illum: 1 } — today's moon.
 */
export function moonDiscWeight(realMoon = REAL_MOON_ON) {
  const m = realMoon ? _moonFrame.moon : null;
  if (!m) return { vis: 1, illum: 1 };
  return { vis: moonLight(m).vis, illum: m.illum };
}

/** REAL_MOON's light for the sun whose `az` computeSun returned (moonLight(null) when off / unknown). */
export function moonLightForSun(az, realMoon = REAL_MOON_ON) {
  return moonLight(realMoon ? moonForSunAz(az)?.moon ?? null : null);
}

/**
 * SHIP PASS (FLY_SHIP_PASS.md SK-3, section 6) — the moon other streams read.
 * SKY owns it. FROZEN API: moonState(ctx?) → { altDeg, azDeg, phase, illum }
 * where phase is in [0, 1) (0 new, 0.5 full) and illum the lit fraction 0..1;
 * `azDeg` is in the app's `az` convention (from south, positive west — the
 * angle the direction formula above reads), [0, 360). `ctx` may carry what the
 * caller already knows ({ tMs, latDeg, lonDeg, sunAz }).
 *
 * REAL_MOON on: the ephemeris moon at ({tMs, latDeg, lonDeg}) when all three
 * are given, else the moon of the sun `ctx.sunAz`, else the last moon the
 * frame resolved. Additive fields: `compassAzDeg` (from north, east
 * positive), `lightK` (the ground's moonlight relative to today's, the
 * number a night exposure balance wants) and `real: true`.
 * REAL_MOON off: today's moon, which is what the frame draws — always full,
 * anti-solar, at the fixed elevation (`lightK` 1, `real: false`).
 */
export function moonState(ctx = {}, realMoon = REAL_MOON_ON) {
  if (realMoon) {
    let moon = null;
    if (Number.isFinite(ctx.tMs) && Number.isFinite(ctx.latDeg) && Number.isFinite(ctx.lonDeg)) moon = moonEphemeris(ctx.tMs, ctx.latDeg, ctx.lonDeg);
    else if (Number.isFinite(ctx.sunAz)) moon = moonForSunAz(ctx.sunAz)?.moon ?? null;
    else moon = _moonFrame.moon;
    if (moon) {
      return {
        altDeg: moon.altDeg,
        azDeg: norm360(moon.compassAzDeg + 180),
        phase: moon.phase,
        illum: moon.illum,
        compassAzDeg: moon.compassAzDeg,
        lightK: moonLight(moon).lightK,
        real: true,
      };
    }
  }
  const az = Number.isFinite(ctx.sunAz) ? ((ctx.sunAz + Math.PI) * 180) / Math.PI : null;
  return {
    altDeg: (SKY_LIVE.nightSky.moonElRad * 180) / Math.PI,
    azDeg: az == null ? null : ((az % 360) + 360) % 360,
    phase: 0.5,
    illum: 1,
    compassAzDeg: az == null ? null : (((az + 180) % 360) + 360) % 360,
    lightK: 1,
    real: false,
  };
}

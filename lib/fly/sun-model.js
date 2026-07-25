import { HILLSHADE, SKY_LIVE } from './fly-constants';

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
 *  1. `az` IS THE HOUR ANGLE H, not a compass azimuth. It is negative before
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
 */

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
export function computeSun(lonDeg, latDeg, tMs) {
  const t = Number.isFinite(tMs) ? tMs : Date.now();
  const lon = Number.isFinite(lonDeg) ? lonDeg : 0;
  // The poles make cos(lat) vanish and the hour angle meaningless; clamping
  // just inside them keeps every term finite without changing any real case.
  const lat = Number.isFinite(latDeg) ? Math.max(-89.9, Math.min(89.9, latDeg)) : 0;

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

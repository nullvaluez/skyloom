// Local clock and sun state at an airport, and the "golden hour now" list —
// a way to watch a real sunset without a time picker (CONDITIONS stays off).
// Pure: no DOM, no network. The clock is offline: the nearest POI city's
// standard UTC offset (lib/fly/poi/cities.js) plus the daylight-saving rules
// of the regions that observe it; with no city nearby, mean solar time.
import { computeSun } from './sun-model.js';
import { CITIES } from './poi/cities.js';
import { shortAirportName } from './ops-labels.mjs';

const DEG = Math.PI / 180;
const HOUR = 3600000;
const MINUTE = 60000;
const SUNSET_EL = -0.833; // apparent horizon: refraction plus the sun's radius

function distKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dLat, dLon);
}

// --- calendar helpers (UTC dates) -------------------------------------------
const nthSunday = (y, m, n) => {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
};
const lastWeekday = (y, m, weekday) => {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
};
const lastSunday = (y, m) => lastWeekday(y, m, 0);

/**
 * Which daylight-saving regime a place follows, from coarse geography and
 * its standard offset. Covers the regions with most of the world's large
 * airports; everything else keeps standard time all year.
 */
export function dstRegion(lat, lon, stdOffsetH) {
  if (lat >= 24.5 && lon <= -52 && lon >= -170) {
    if (stdOffsetH <= -10) return null; // Hawaii
    if (stdOffsetH === -7 && lat >= 31 && lat <= 37.1 && lon >= -114.9 && lon <= -109.04) return null; // Arizona
    if (stdOffsetH === -6 && lat >= 49 && lat <= 60 && lon >= -110 && lon <= -101.4) return null; // Saskatchewan
    // Mexico (no DST since 2022) below the border: the Rio Grande line from
    // El Paso to Brownsville, and ~31.3°N west of it.
    const border = lon < -106.5 ? 31.3 : lon <= -97.2 ? 31.76 - 0.6447 * (lon + 106.49) : 25.8;
    if (lat < border && lon < -86) return null;
    return 'na';
  }
  if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 40 && stdOffsetH >= 0 && stdOffsetH <= 2) {
    if (lon < -13 && lat > 62.5) return null; // Iceland
    if (lat < 36 && lon < -1) return null; // Morocco
    return 'eu';
  }
  if (stdOffsetH === 2 && lat >= 29.4 && lat <= 33.4 && lon >= 34.2 && lon <= 35.9) return 'il';
  if (stdOffsetH === 2 && lat >= 22 && lat < 31.7 && lon >= 24.7 && lon <= 34.2) return 'eg';
  if (stdOffsetH === 10 && lat <= -28.2 && lon >= 140.9 && lon <= 154) return 'au';
  if (stdOffsetH === 9.5 && lat <= -26 && lon <= 141) return 'au';
  if (stdOffsetH === 12 && lat <= -34 && lon >= 165) return 'nz';
  if (stdOffsetH === -4 && lat <= -17 && lon >= -76 && lon <= -66) return 'cl';
  return null;
}

/** Whether daylight saving is in force at instant `utcMs` for a region. */
export function dstActive(region, utcMs, stdOffsetH) {
  if (!region) return false;
  const y = new Date(utcMs).getUTCFullYear();
  // Local STANDARD time -> UTC instant.
  const local = (m, d, h) => Date.UTC(y, m, d, h) - stdOffsetH * HOUR;
  switch (region) {
    case 'na': // second Sunday of March 02:00 -> first Sunday of November 02:00 (01:00 standard)
      return utcMs >= local(2, nthSunday(y, 2, 2), 2) && utcMs < local(10, nthSunday(y, 10, 1), 1);
    case 'eu': // last Sunday of March -> last Sunday of October, both 01:00 UTC
      return utcMs >= Date.UTC(y, 2, lastSunday(y, 2), 1) && utcMs < Date.UTC(y, 9, lastSunday(y, 9), 1);
    case 'il': // Friday before the last Sunday of March -> last Sunday of October
      return utcMs >= local(2, lastSunday(y, 2) - 2, 2) && utcMs < local(9, lastSunday(y, 9), 1);
    case 'eg': // last Friday of April -> last Thursday of October (midnight)
      return utcMs >= local(3, lastWeekday(y, 3, 5), 0) && utcMs < local(9, lastWeekday(y, 9, 4), 23);
    case 'au': // first Sunday of October 02:00 -> first Sunday of April 03:00 (02:00 standard)
      return utcMs >= local(9, nthSunday(y, 9, 1), 2) || utcMs < local(3, nthSunday(y, 3, 1), 2);
    case 'nz': // last Sunday of September 02:00 -> first Sunday of April 03:00
      return utcMs >= local(8, lastSunday(y, 8), 2) || utcMs < local(3, nthSunday(y, 3, 1), 2);
    case 'cl': // first Sunday of September -> first Sunday of April (UTC approximations)
      return utcMs >= Date.UTC(y, 8, nthSunday(y, 8, 1), 4) || utcMs < Date.UTC(y, 3, nthSunday(y, 3, 1), 3);
    default:
      return false;
  }
}

/** Standard UTC offset (hours) from the nearest POI city within 300 km, or null. */
export function standardOffsetAt(lat, lon) {
  let best = null, bestD = 300;
  for (const c of CITIES) {
    if (!Number.isFinite(c[3])) continue;
    const d = distKm(lat, lon, c[1], c[2]);
    if (d < bestD) { bestD = d; best = c[3]; }
  }
  return best;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Local clock at a place: {text 'HH:MM', offsetH, dst, zone 'UTC−4' |
 * 'solar'}. Falls back to mean solar time (longitude / 15) labelled 'solar'
 * when no city offset is known, so the UI never presents a guess as a zone.
 */
export function localClockAt(lat, lon, utcMs = Date.now()) {
  const std = standardOffsetAt(lat, lon);
  let offsetH, dst = false, zone;
  if (std == null) {
    offsetH = lon / 15;
    zone = 'solar';
  } else {
    dst = dstActive(dstRegion(lat, lon, std), utcMs, std);
    offsetH = std + (dst ? 1 : 0);
    const whole = Math.trunc(offsetH), mins = Math.round(Math.abs(offsetH - whole) * 60);
    zone = `UTC${offsetH < 0 ? '−' : '+'}${Math.abs(whole)}${mins ? ':' + pad2(mins) : ''}`;
  }
  const d = new Date(utcMs + offsetH * HOUR);
  return { text: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`, offsetH, dst, zone, hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
}

/** Sun elevation (degrees) at a place and instant. */
export function sunElevationDeg(lat, lon, utcMs) {
  const s = computeSun(lon, lat, utcMs);
  return Math.asin(Math.max(-1, Math.min(1, s.sinEl))) / DEG;
}

/**
 * Sun state for the UI: {elevationDeg, rising, kind, label}. kind is
 * 'day' | 'golden' | 'twilight' | 'night'. `rising` = before solar noon.
 */
export function sunStateAt(lat, lon, utcMs = Date.now()) {
  const s = computeSun(lon, lat, utcMs);
  const el = Math.asin(Math.max(-1, Math.min(1, s.sinEl))) / DEG;
  const rising = (s.hourAngle ?? s.az) < 0;
  const kind = el < -6 ? 'night' : el < 0 ? 'twilight' : el < 8 ? 'golden' : 'day';
  const label = kind === 'night' ? 'Night' : kind === 'twilight' ? (rising ? 'Dawn' : 'Dusk') : kind === 'golden' ? 'Golden hour' : 'Daylight';
  return { elevationDeg: el, rising, kind, label };
}

/**
 * Minutes from `utcMs` to the sun crossing the apparent horizon in the
 * direction it is moving (positive: still to come, negative: already
 * happened), searched ±limitMin. null when it does not cross in the window.
 */
export function minutesToHorizon(lat, lon, utcMs, rising, limitMin = 120) {
  const above = (t) => sunElevationDeg(lat, lon, t) > SUNSET_EL;
  const now = above(utcMs);
  // Setting: look ahead while still up, back once down. Rising: the reverse.
  const ahead = rising ? !now : now;
  const step = ahead ? MINUTE : -MINUTE;
  for (let i = 1; i <= limitMin; i++) {
    if (above(utcMs + step * i) !== now) return ahead ? i : -i;
  }
  return null;
}

/**
 * Large airports from the runway index rows ({ident, name, lat, lon,
 * length}): one entry per four-letter ident, kept when its longest runway
 * reaches `minLengthM`.
 */
export function majorAirports(rows, minLengthM = 2900) {
  const best = new Map();
  for (const r of rows || []) {
    if (!/^[A-Z]{4}$/.test(r?.ident || '') || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const prev = best.get(r.ident);
    if (!prev || (r.length || 0) > prev.length) best.set(r.ident, { ident: r.ident, name: r.name, lat: r.lat, lon: r.lon, length: r.length || 0 });
  }
  return [...best.values()].filter((a) => a.length >= minLengthM);
}

// "John F. Kennedy International Airport" -> "John F. Kennedy International".
// One definition, in the ops labels (lib/fly/ops-labels.mjs); re-exported here.
export { shortAirportName };

/**
 * Airports where the sun is low right now. Golden light runs from a little
 * below the horizon to ~8° above it; the list favours the sun just above the
 * horizon, spreads picks at least `spreadKm` apart so it is not one region,
 * and labels each with the sunset or sunrise moment.
 * Returns [{ident, name, lat, lon, elevationDeg, rising, minutes, label, clock}].
 */
export function goldenHourNow(airports, utcMs = Date.now(), { limit = 6, spreadKm = 600, minEl = -4, maxEl = 8 } = {}) {
  const candidates = [];
  for (const a of airports || []) {
    const sun = sunStateAt(a.lat, a.lon, utcMs);
    if (sun.elevationDeg < minEl || sun.elevationDeg > maxEl) continue;
    // Busy hubs (priority) first: a sunset is better with traffic in it.
    candidates.push({ ...a, elevationDeg: sun.elevationDeg, rising: sun.rising, score: Math.abs(sun.elevationDeg - 2) - (a.length || 0) / 20000 - (a.priority || 0) });
  }
  candidates.sort((x, y) => x.score - y.score);
  const out = [];
  for (const c of candidates) {
    if (out.length >= limit) break;
    if (out.some((o) => distKm(o.lat, o.lon, c.lat, c.lon) < spreadKm)) continue;
    const minutes = minutesToHorizon(c.lat, c.lon, utcMs, c.rising);
    const event = c.rising ? 'Sunrise' : 'Sunset';
    const label =
      minutes == null ? 'Golden hour'
        : minutes > 0 ? `${event} in ${minutes} min`
          : minutes === 0 ? `${event} now`
            : `${c.rising ? 'Sunrise' : 'Sunset'} ${-minutes} min ago`;
    out.push({
      ident: c.ident,
      name: shortAirportName(c.name),
      lat: c.lat,
      lon: c.lon,
      elevationDeg: c.elevationDeg,
      rising: c.rising,
      minutes,
      label,
      clock: localClockAt(c.lat, c.lon, utcMs),
    });
  }
  return out;
}

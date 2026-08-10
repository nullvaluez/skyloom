/**
 * Sun-time solver: "what epoch-ms do I hand `window.__flySunOverride` to get a
 * +2° dusk sun over London?"
 *
 * `__flySunOverride` is an EPOCH-MILLISECONDS value (see
 * `components/fly/FlyScene.jsx` ~723/872, and every `Date.UTC(...)` call in
 * `scripts/verify-dusk.js` / `verify-sat-night.js`). It is NOT an elevation and
 * NOT a fraction. But the elevation that timestamp produces depends on the
 * LOCATION, so a constant borrowed from a harness gives the wrong sky over a
 * different city — R19 re-keyed every sky bucket on ELEVATION, so the trailer
 * has to solve per shot.
 *
 * This module re-implements `computeSun`'s elevation math (lib/fly/sun-model.js
 * lines 83–96) as a standalone solver. It deliberately does NOT import the app
 * module: that file is ESM inside a Next build graph, and the trailer must not
 * add a build dependency to a certified tree. The math is copied verbatim in
 * form, and `verify.js` cross-checks the answer against the app's OWN live
 * value (`__flyStats.skyElDeg`) at capture time — so a drift between this copy
 * and the app would be caught, not shipped.
 *
 * Elevation bands that matter (R19 "Dusk Exists"):
 *   el < −8°     night — stars, city glow, window atlas, runway lights
 *   el ≈ +2°     dusk  — the golden lobe, ZERO stars
 *   el ≈ +6°     the golden band
 *   el max       solar noon
 */

const DEG = Math.PI / 180;
const DAY_MS = 86400000;

function utcDayOfYear(d) {
  return Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
      DAY_MS
  );
}

/** sin(solar elevation) at a place and time — the app's formula, verbatim. */
function sinElevation(lonDeg, latDeg, tMs) {
  const d = new Date(tMs);
  const n = utcDayOfYear(d);
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const decl = -23.44 * DEG * Math.cos((2 * Math.PI * (n + 10)) / 365.24);
  const lat = Math.max(-89.9, Math.min(89.9, latDeg)) * DEG;
  const localSolarH = ((((utcH + lonDeg / 15) % 24) + 24) % 24);
  const H = ((localSolarH - 12) / 12) * Math.PI;
  return Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
}

/** True (unclamped) solar elevation in degrees — R19's `trueElevationDeg`. */
function elevationDeg(lonDeg, latDeg, tMs) {
  return Math.asin(Math.max(-1, Math.min(1, sinElevation(lonDeg, latDeg, tMs)))) / DEG;
}

/**
 * Find the epoch-ms on `dayUtc` at which the sun over (lat, lon) is closest to
 * `targetDeg`. Scans the whole day at 1-minute resolution, then refines to the
 * second — 1440 evaluations of a closed-form expression is free.
 *
 * @param {object} o
 * @param {number} o.lat
 * @param {number} o.lon
 * @param {number} o.targetDeg      desired elevation in degrees
 * @param {number} [o.dayUtc]       any epoch-ms inside the UTC day to search
 * @param {'any'|'rising'|'setting'} [o.phase]  disambiguates the two daily
 *                                  crossings — 'setting' is what a dusk shot
 *                                  wants (evening light, not dawn).
 */
function solveElevation({ lat, lon, targetDeg, dayUtc = Date.UTC(2026, 6, 28), phase = 'setting' }) {
  const d0 = new Date(dayUtc);
  const base = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  let best = null;
  for (let m = 0; m < 1440; m++) {
    const t = base + m * 60000;
    const el = elevationDeg(lon, lat, t);
    if (phase !== 'any') {
      const prev = elevationDeg(lon, lat, t - 60000);
      const rising = el > prev;
      if (phase === 'rising' && !rising) continue;
      if (phase === 'setting' && rising) continue;
    }
    const err = Math.abs(el - targetDeg);
    if (!best || err < best.err) best = { t, el, err };
  }
  if (!best) return null;
  // Refine to the second around the best minute.
  let fine = best;
  for (let s = -60; s <= 60; s++) {
    const t = best.t + s * 1000;
    const el = elevationDeg(lon, lat, t);
    const err = Math.abs(el - targetDeg);
    if (err < fine.err) fine = { t, el, err };
  }
  return { tMs: fine.t, elDeg: +fine.el.toFixed(3), errDeg: +fine.err.toFixed(3), iso: new Date(fine.t).toISOString() };
}

/** The day's maximum elevation (solar noon) over a place. */
function solveNoon({ lat, lon, dayUtc = Date.UTC(2026, 6, 28) }) {
  const d0 = new Date(dayUtc);
  const base = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  let best = null;
  for (let m = 0; m < 1440; m++) {
    const t = base + m * 60000;
    const el = elevationDeg(lon, lat, t);
    if (!best || el > best.el) best = { t, el };
  }
  return { tMs: best.t, elDeg: +best.el.toFixed(3), errDeg: 0, iso: new Date(best.t).toISOString() };
}

/**
 * Resolve a shot's `sun` spec to an epoch-ms.
 *   { kind: 'noon' }                  → solar noon
 *   { kind: 'elevation', deg, phase } → nearest crossing of `deg`
 *   { kind: 'absolute', tMs }         → verbatim (harness-style constant)
 *   null                              → no override (live clock)
 */
function resolveSun(spec, { lat, lon, dayUtc }) {
  if (!spec) return null;
  if (spec.kind === 'absolute') return { tMs: spec.tMs, elDeg: +elevationDeg(lon, lat, spec.tMs).toFixed(3), errDeg: 0, iso: new Date(spec.tMs).toISOString() };
  if (spec.kind === 'noon') return solveNoon({ lat, lon, dayUtc: spec.dayUtc ?? dayUtc });
  if (spec.kind === 'elevation')
    return solveElevation({ lat, lon, targetDeg: spec.deg, phase: spec.phase ?? 'setting', dayUtc: spec.dayUtc ?? dayUtc });
  throw new Error(`unknown sun spec kind: ${spec.kind}`);
}

module.exports = { elevationDeg, solveElevation, solveNoon, resolveSun };

// Self-check: `node scripts/trailer/sun.js` prints the solved times for the
// shot table's locations so the values can be eyeballed without a browser.
if (require.main === module) {
  const cases = [
    ['Manhattan golden', 40.7128, -74.006, { kind: 'elevation', deg: 6, phase: 'setting' }],
    ['Manhattan noon', 40.7128, -74.006, { kind: 'noon' }],
    ['London dusk +2', 51.5007, -0.1246, { kind: 'elevation', deg: 2, phase: 'setting' }],
    ['NYC night -12', 40.7128, -74.006, { kind: 'elevation', deg: -12, phase: 'setting' }],
    ['Powell OH day', 40.158, -83.075, { kind: 'elevation', deg: 40, phase: 'setting' }],
    ['Owens Valley day', 36.601, -118.06, { kind: 'elevation', deg: 45, phase: 'setting' }],
  ];
  for (const [name, lat, lon, spec] of cases) {
    const r = resolveSun(spec, { lat, lon, dayUtc: Date.UTC(2026, 6, 28) });
    console.log(`${name.padEnd(20)} el=${String(r.elDeg).padStart(8)}°  err=${r.errDeg}°  ${r.iso}`);
  }
}

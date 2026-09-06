/**
 * R24 (E CERT) — command the sun by TIME, because that is what the app reads.
 *
 * THE DEFECT THIS REPLACES. `verify-one-sun.js` and `verify-linear-haze.js`
 * both redefined `window.__flySunOverride` as an accessor backed by
 * `window.__r24Sun`, then wrote `{ elDeg: 55 }` into it. But the app consumes
 * that override as a TIMESTAMP IN MILLISECONDS —
 * `computeSun(lon, lat, tMs ?? window.__flySunOverride ?? Date.now())`
 * (FlyScene.jsx:939) and `(window.__flySunOverride) || Date.now()` (:1155) —
 * and nothing in `lib/` or `components/` reads `__r24Sun` or an `elDeg` field
 * at all. An object where a number belongs yields NaN inside `computeSun` or a
 * truthy fall-through, so THE APP KEPT ITS WALL CLOCK: pass 2b's one-sun row
 * commanded 55° / 2° / −14° and measured a key that moved 23.132 → 23.132 →
 * 22.938, with the azimuth drifting monotonically −64.6081 → −64.8665 →
 * −65.1123 across six samples. That drift is the clock, not the command.
 *
 * THE FIX IS THE FLEET'S OWN IDIOM (R16, verify-boot): drive the sun with a
 * time, and compute that time with THE APP'S OWN MODEL rather than a copy —
 * `computeSun` is imported here through the alias loader, so if the model
 * changes this search changes with it.
 *
 * `computeSun` returns `sinEl`, the raw unclamped sine of elevation (negative
 * below the horizon), which is what makes a night target reachable at all:
 * `frac` clamps to 0 below the horizon and could never distinguish −14° from
 * −40°, and `el` is floored at HILLSHADE.minElRad.
 */
import { register } from 'node:module';

register('./_node-resolve.mjs', import.meta.url);

const { computeSun } = await import('../lib/fly/sun-model.js');

const DEG = 180 / Math.PI;

/** True elevation in degrees, unclamped — asin of the raw sine. */
export function trueElDeg(lonDeg, latDeg, tMs) {
  const s = computeSun(lonDeg, latDeg, tMs).sinEl;
  return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}

/**
 * Find a UTC timestamp whose TRUE solar elevation at (lon, lat) is closest to
 * `targetElDeg`. Scans one day at `stepMin` resolution and then bisects the
 * bracketing interval, so it needs no analytic inverse and inherits whatever
 * the model does.
 *
 * `dayMs` fixes the DATE (declination); the search moves only the time of day.
 * Returns `{ tMs, elDeg, err, reachable }` — `reachable` is false when the
 * target elevation never occurs at that latitude and date, which is a real
 * answer (polar night, a 55° sun at 60°N in December) and not a failure.
 */
export function findSunTime(lonDeg, latDeg, targetElDeg, { dayMs, stepMin = 4 } = {}) {
  const base = Number.isFinite(dayMs) ? dayMs : Date.UTC(2026, 6, 1);
  const day0 = Math.floor(base / 86400000) * 86400000;
  const step = stepMin * 60000;
  let bestT = day0;
  let bestErr = Infinity;
  let prevT = day0;
  let prevEl = trueElDeg(lonDeg, latDeg, day0);
  let bracket = null;
  let minEl = prevEl;
  let maxEl = prevEl;
  for (let t = day0 + step; t <= day0 + 86400000; t += step) {
    const el = trueElDeg(lonDeg, latDeg, t);
    if (el < minEl) minEl = el;
    if (el > maxEl) maxEl = el;
    const err = Math.abs(el - targetElDeg);
    if (err < bestErr) {
      bestErr = err;
      bestT = t;
    }
    // A sign change in (el - target) brackets an exact crossing.
    if (!bracket && (prevEl - targetElDeg) * (el - targetElDeg) < 0) bracket = [prevT, t];
    prevT = t;
    prevEl = el;
  }
  if (bracket) {
    let [lo, hi] = bracket;
    for (let i = 0; i < 40 && hi - lo > 1000; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const e = trueElDeg(lonDeg, latDeg, mid) - targetElDeg;
      const eLo = trueElDeg(lonDeg, latDeg, lo) - targetElDeg;
      if (e === 0) {
        lo = hi = mid;
        break;
      }
      if (e * eLo < 0) hi = mid;
      else lo = mid;
    }
    bestT = Math.floor((lo + hi) / 2);
    bestErr = Math.abs(trueElDeg(lonDeg, latDeg, bestT) - targetElDeg);
  }
  return {
    tMs: bestT,
    elDeg: trueElDeg(lonDeg, latDeg, bestT),
    err: bestErr,
    // Unreachable is a real answer, not a failure: the caller reports NOT
    // CALIBRATED rather than pretending the sun was where it was asked to be.
    reachable: targetElDeg >= minEl - 0.25 && targetElDeg <= maxEl + 0.25,
    rangeDeg: [+minEl.toFixed(2), +maxEl.toFixed(2)],
  };
}

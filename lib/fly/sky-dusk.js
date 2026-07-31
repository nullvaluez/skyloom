import { SKY, SKY_DUSK } from './fly-constants.js'; // .js: this module is loaded by verify-dusk in plain node too

/**
 * Round 19 "Honest World" — D GOLDENHOUR: the dusk math, pure.
 *
 * THE DEFECT (field study P9). The satellite sky picks its HDRI from
 * `frac = clamp01(sin(el) / sin(SKY_LIVE.sun.elRefDeg))` against two
 * thresholds, `SKY.hdriCycle.dayFrac 0.5` and `nightFrac 0.06`. Inverted,
 * those are solar ELEVATIONS of 22.5° and 2.6°. A sun 2.6° above the horizon
 * is not night — it is ten minutes before sunset. Pinning the clock to
 * 8:40 pm July in Ohio rendered a full starfield. Golden hour did not exist:
 * the dawn/dusk bucket only ever covered 2.6°–22.5°, which is late morning.
 *
 * THE FIX. Key the bucket on solar elevation directly — night below the civil
 * twilight line (−8°), day above +10°, and one continuous dawn/dusk window in
 * between that the HDRI cross-blend walks in `SKY_DUSK.blendSteps` steps.
 *
 * ELEVATION IS NOT `runtime.sun.el`. `computeSun` returns
 * `el = clamp(asin(max(0, sinEl)), HILLSHADE.minElRad, maxElRad)` — the
 * hillshade graze floor pins it at 8.6° and it can never go negative, so it
 * cannot express any of the thresholds above. `sinEl` is the documented
 * "unclamped truth"; `trueElevationDeg` is the only correct source, and every
 * consumer in this round goes through it.
 *
 * Zero three.js imports: this module is loadable in plain node, which is how
 * verify-dusk gates the bucket table and the blend ladder without a browser.
 */

const RAD2DEG = 180 / Math.PI;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The R19-D master switch. `SKY_DUSK.enabled` is the ship flag (false ⇒ the
 * legacy frac path runs byte-verbatim); `window.__flyDuskOverride = 0` is the
 * harness/live kill switch in the `__flyAerialOverride` / `__flyWeatherOverride`
 * family, so verify-dusk can A/B a noon frame against pre-R19 behaviour inside
 * ONE browser session instead of trusting a rebuild.
 */
export function skyDuskOn() {
  if (!SKY_DUSK.enabled) return false;
  if (typeof window !== 'undefined' && window.__flyDuskOverride === 0) return false;
  return true;
}

/** Unclamped solar elevation in DEGREES from `runtime.sun.sinEl`. */
export function trueElevationDeg(sinEl) {
  if (!Number.isFinite(sinEl)) return 90;
  const s = sinEl < -1 ? -1 : sinEl > 1 ? 1 : sinEl;
  return Math.asin(s) * RAD2DEG;
}

/**
 * The R13 bucket rule, VERBATIM. This is what runs whenever the round is
 * flagged off, and it is still what names a prefetch neighbour.
 */
export function legacyBucket(frac, az) {
  const hc = SKY.hdriCycle;
  if (frac >= hc.dayFrac) return 'day';
  if (frac < hc.nightFrac) return 'night';
  return az < 0 ? 'dawn' : 'dusk';
}

/**
 * Elevation-keyed sky state: which two HDRIs are in play and how far between
 * them we are, quantised to `blendSteps` so a crossing costs a bounded number
 * of PMREM bakes (one per step) instead of one per frame.
 *
 * `s === 0` ⇒ pure `a`; `s === 1` ⇒ pure `b`. Both are SINGLE-TEXTURE states
 * that take the legacy code path on the raw source texture — the blend render
 * target is only ever engaged for `0 < s < 1`, which is what keeps a settled
 * day/night sky bit-identical to R18.
 *
 * @param {number} az     hour angle, radians (negative = morning — the R16
 *                        convention that splits dawn from dusk)
 * @param {number} elDeg  TRUE solar elevation, degrees (trueElevationDeg)
 */
export function resolveSky(az, elDeg) {
  const d = SKY_DUSK;
  const twilight = az < 0 ? 'dawn' : 'dusk';
  if (!(elDeg > d.elNightDeg)) return { a: 'night', b: 'night', s: 0, label: 'night' };
  if (elDeg >= d.elDayDeg) return { a: 'day', b: 'day', s: 0, label: 'day' };
  // The twilight HDRI owns the middle of the window; night and day meet it
  // from either side, so the ladder is night → dawn|dusk → day.
  const mid = (d.elNightDeg + d.elDayDeg) / 2;
  let a;
  let b;
  let t;
  if (elDeg <= mid) {
    a = 'night';
    b = twilight;
    t = (elDeg - d.elNightDeg) / (mid - d.elNightDeg);
  } else {
    a = twilight;
    b = 'day';
    t = (elDeg - mid) / (d.elDayDeg - mid);
  }
  const steps = Math.max(1, Math.round(d.blendSteps));
  const s = Math.round(clamp01(t) * steps) / steps;
  return { a, b, s, label: s === 0 ? a : s === 1 ? b : `${a}~${b}` };
}

/** Stable identity of a sky state — the swap effect's dependency. */
export function skyKey(r) {
  return r.s === 0 ? r.a : r.s === 1 ? r.b : `${r.a}|${r.b}|${r.s}`;
}

/**
 * Night weight re-keyed on ELEVATION — the companion fix to the bucket
 * re-key. `sun-model.nightWeight(frac)` cannot express twilight at all:
 * frac is clamped at 0 for every sub-horizon sun, so it returns 1 (full star
 * field, full moon) from the instant the sun sets until it rises, which is
 * exactly the "8:40 pm rendered as full night with a starfield" report.
 *
 * Same inverse-smoothstep SHAPE as the original, so nothing downstream had to
 * learn a new curve — only the input is honest now. Exactly 0 at and above
 * elStarZeroDeg (no epsilon), exactly 1 at and below elStarFullDeg, which
 * keeps both ends of the existing contract: a daylight frame is untouched and
 * a deep-night pose (el ≈ −25°) is still a full 1.
 */
export function nightWeightEl(elDeg) {
  const hi = SKY_DUSK.elStarZeroDeg;
  const lo = SKY_DUSK.elStarFullDeg;
  if (!(elDeg < hi)) return 0;
  if (elDeg <= lo) return 1;
  const x = (hi - elDeg) / Math.max(1e-6, hi - lo);
  return x * x * (3 - 2 * x);
}

/**
 * Golden-hour lobe envelope: a smooth hat over
 * [glow.elMinDeg, glow.elMaxDeg] peaking exactly at the horizon, and EXACTLY
 * 0 at or outside both ends. That hard zero is the SkyDome contract — the
 * shader's whole glow block sits behind `if (uSunGlow.x > 0.0)`, so a noon or
 * deep-night frame executes none of it.
 */
export function glowEnvelope(elDeg) {
  const g = SKY_DUSK.glow;
  if (!(elDeg > g.elMinDeg) || !(elDeg < g.elMaxDeg)) return 0;
  const t =
    elDeg < 0
      ? (elDeg - g.elMinDeg) / Math.max(1e-6, -g.elMinDeg)
      : (g.elMaxDeg - elDeg) / Math.max(1e-6, g.elMaxDeg);
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

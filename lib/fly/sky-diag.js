/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md SK-1) — the grey-veil diagnosis pins.
 *
 * `window.__flySkyDiag` is a dev / `?graphicsReview=1` object a harness (or a
 * pasted console line) sets to take one atmosphere term out of the frame, so
 * scripts/ship-sky-veil.cjs can attribute the veil per cause:
 *
 *   { aerial: 0 }   the Enhanced aerial post pass mixes nothing: its
 *                   strength-0 early-out returns the scene colour (exposure
 *                   kept), so the physical in-scatter, the weather
 *                   extinction, the world fade and the ground mist it carries
 *                   all leave the ground pixels together, and nothing else
 *                   does (the sky, clouds and grade are untouched).
 *   { clouds: 0 }   the Enhanced cloud composite mixes nothing (its cloudMix
 *                   is 0): no cloud and no cloud shadow reach the frame. The
 *                   cinema deck spans 1,500-3,800 m at coverage 0.41 even in
 *                   CLEAR weather, so from 5,000-12,500 ft the Midtown sight
 *                   line can cross it; this pin measures that share.
 *   { clarity: 0 }  (a page loaded with ?flags=AERIAL_CLARITY) this frame's
 *                   clarity k is 0: shipClarity() returns exactly 1, so the
 *                   in-scatter is the shipped S on the same settled pose —
 *                   SK-2's same-pose control arm in ship-sky-veil.cjs.
 *
 * Every pin is a UNIFORM write in its consumer: no shader text and no program
 * key can move, and with no pin set (production, every other harness) nothing
 * is read. A consumer that honours a pin records it in
 * `window.__flySkyDiagApplied[key] = true`, so a harness can prove the arm it
 * measured was really applied instead of assuming it (the CITY
 * `__flyCityDiagApplied` idiom, FLY_SHIP_PASS.md section 6).
 */
import { graphicsReviewOn } from './satellite-visuals';

/** The live diagnosis pin object, or null (always null in production). */
export function skyDiag() {
  if (typeof window === 'undefined') return null;
  if (!(process.env.NODE_ENV === 'development' || graphicsReviewOn())) return null;
  const d = window.__flySkyDiag;
  return d && typeof d === 'object' ? d : null;
}

/** Record that the consumer of pin `key` applied it this frame. */
export function markSkyDiagApplied(key) {
  if (typeof window === 'undefined') return;
  (window.__flySkyDiagApplied ??= {})[key] = true;
}

/**
 * The SKY stream's read-only diagnostics handle (dev / ?graphicsReview=1, set
 * once by components/fly/ShipSkyDiag.jsx as `window.__flySky`): what the sky
 * is doing this frame, for harnesses and the console. Getters only; nothing
 * here writes a uniform or a pin.
 */
export function shipSkyDiagnostics(runtime, deps) {
  const { moonState, moonLightForSun, aerialClarityK, AERIAL_CLARITY_UNIFORMS, PSKY_UNIFORMS, shipPassFlags } = deps;
  return {
    flags: () => {
      const f = shipPassFlags();
      return { AERIAL_CLARITY: f.AERIAL_CLARITY, REAL_MOON: f.REAL_MOON, SKY_LITE: f.SKY_LITE };
    },
    moon: () => moonState(),
    moonLight: () => (runtime.sun ? moonLightForSun(runtime.sun.az) : null),
    clarityK: () => AERIAL_CLARITY_UNIFORMS.uShipClarity.value.x,
    clarityKNow: (eyeAglM) => aerialClarityK(eyeAglM, runtime.cinemaEnvironment),
    aerialReach: () => ({ rangeKm: PSKY_UNIFORMS.uPskyAp.value.x, liteSwitch: PSKY_UNIFORMS.uPskyAp.value.z }),
    env: () => {
      const e = runtime.cinemaEnvironment;
      return e ? { sun: e.sun, fill: e.fill, moonW: e.moonW, exposureStops: e.exposureStops, day: e.day, night: e.night, keyDir: [...e.keyDir], moonDir: [...e.moonDir] } : null;
    },
  };
}

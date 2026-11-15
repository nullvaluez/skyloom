import { cinemaProfile } from './cinema-policy';
import { LOOK_GRADE_CFG, LOOK_GRADE_ON, LOOK_GRADE_COMPILED, LOOK_WATER_UNIFORM } from './look-grade-flag.js';

export { LOOK_GRADE_CFG, LOOK_GRADE_ON, LOOK_GRADE_COMPILED, LOOK_WATER_UNIFORM };

/** LOOK PASS E (GRADE): tone curve, colour grade, key/fill colour and ground, vegetation and water colour.
 * LOOK_GRADE_CFG is the owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */

const DESKTOP = new Set(['ultra', 'ultra-balanced', 'high', 'high-balanced']);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * 1 on desktop High and Ultra with the flag on, else 0. Medium, phone and Low
 * keep today's pixels (FLY_LOOK_PASS.md rule 5). Node (no window) reads 0, so
 * the pure environment gates keep asserting the pre-pass numbers.
 */
let smoothW = -1, smoothT = 0;
export function lookGradeWeight() {
  if (!LOOK_GRADE_ON || !globalThis.window) return 0;
  let target = 0;
  try { target = DESKTOP.has(cinemaProfile().name) ? 1 : 0; } catch { target = 0; }
  // A governor tier step (Ultra -> Medium) must not snap the whole grade off
  // in one frame: ease the weight over about half a second. The first frame
  // snaps, so a boot or a still capture is never caught mid-ramp.
  const now = globalThis.performance?.now?.() ?? Date.now();
  if (smoothW < 0) smoothW = target;
  else smoothW += Math.sign(target - smoothW) * Math.min(Math.abs(target - smoothW), clamp((now - smoothT) / 500));
  smoothT = now;
  return smoothW;
}

/** The live dials the display grade and water read each frame (CPU mirror). */
export const lookGradeState = { weight: 0, golden: 0, lowSun: 0, twilight: 0, day: 1, night: 0, overcast: 0 };

/**
 * Exposure follows the light; low sun gets a cool open-sky fill. Runs on the
 * cinema environment after the physical sky has set the key, so the key it
 * reads is the final one. Weight 0 returns the environment untouched.
 */
export function applyLookGradeEnvironment(e, weight = lookGradeWeight()) {
  const s = lookGradeState;
  s.weight = weight;
  if (!weight || !e) { LOOK_WATER_UNIFORM.value.set(0, 0, 0, 0); return e; }
  const C = LOOK_GRADE_CFG;
  const el = Math.asin(clamp(e.sunDir?.[1] ?? 1, -1, 1)) * 180 / Math.PI;
  const clear = 1 - clamp(e.overcast);
  // Golden: the sun is up but low and the ground is lit at a graze.
  const lowSun = smooth(-1.5, 3.5, el) * (1 - smooth(11, 32, el));
  // Civil twilight: the key has set (or is setting) and the moon is not the key yet.
  const twilight = smooth(-10, -5.5, el) * (1 - smooth(-0.5, 3.5, el));
  const high = smooth(18, 40, el);
  s.golden = clamp(e.golden); s.lowSun = lowSun; s.twilight = twilight;
  s.day = clamp(e.day); s.night = clamp(e.night); s.overcast = clamp(e.overcast);

  const X = num(C.exposure, 1) * weight;
  e.exposureStops += X * (num(C.exposureNoon, 0) * high
    + num(C.exposureGolden, 0) * lowSun * (0.55 + 0.45 * clear)
    + num(C.exposureDusk, 0) * twilight);
  e.exposure = 2 ** e.exposureStops;

  // Warm key, cool fill: at low sun most of what the eye sees in shade is the
  // blue dome. Raise its share and its hue, and stop the brown ground bounce.
  const F = num(C.fill, 1) * weight;
  const f = F * Math.max(lowSun, 0.35 * twilight) * (0.4 + 0.6 * clear);
  const day = clamp(e.day);
  if (f > 0) {
    e.fill *= 1 + num(C.fillGolden, 0) * f;
    e.environment *= 1 + num(C.envGolden, 0) * f;
    const cool = C.fillColor ?? [0.4, 0.58, 1];
    for (let i = 0; i < 3; i++) e.fillColor[i] = mix(e.fillColor[i], cool[i], Math.min(1, 0.9 * f));
  }
  // Warm key: the physical transmittance at +3..+12 deg is amber, but AgX
  // pulls a bright warm key back toward cream, so lit faces read neutral grey
  // beside the cool fill. Deepen the key's chroma at low sun only (noon and
  // the brown-city daylight white point are untouched), keeping max = 1.
  const K = num(C.warmth, 1) * weight * lowSun * (0.3 + 0.7 * clear);
  if (K > 0) {
    const sat = 1 + num(C.keyWarmGolden, 0) * K, kc = e.keyColor;
    for (let i = 0; i < 3; i++) kc[i] = clamp(1 - (1 - kc[i]) * sat, 0.12, 1);
    // Bias toward gold rather than red: hold green up against blue.
    kc[1] = mix(kc[1], Math.max(kc[1], num(C.keyGoldGreen, 0.66)), Math.min(1, 0.7 * K));
    e.sun *= 1 + num(C.keyGainGolden, 0) * K;
  }
  const W = num(C.water, 1) * weight * Math.max(lowSun, 0.5 * twilight) * clear;
  // z: daylight steep-water lift (a lake seen from above keeps its waves);
  // w: the near-water gold sheen on sun-facing wave slopes (scales with x).
  const Wd = num(C.water, 1) * weight * smooth(8, 25, el);
  LOOK_WATER_UNIFORM.value.set(num(C.waterSheen, 0) * W, num(C.waterPath, 0) * W * lowSun,
    num(C.waterNoon, 0) * Wd, num(C.waterNearSheen, 0));
  const bounce = C.groundBounce;
  if (bounce && F * day > 0) for (let i = 0; i < 3; i++) e.groundColor[i] = mix(e.groundColor[i], bounce[i], 0.8 * F * day);
  return e;
}

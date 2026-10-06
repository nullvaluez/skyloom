/**
 * TRUE EARTH Phase 2 — PHYS_SKY: the runtime half.
 *  - the switch (physSkyOn) and the twilight geometry it implies;
 *  - PSKY_UNIFORMS, the consumer uniforms every cinemaSky program reads
 *    (merged by reference into CINEMA_UNIFORMS by cinema-frame.js);
 *  - physSkyShader(), the asserted shader edits (all-or-nothing per program,
 *    recorded in PHYS_SKY_SHADERS for the gate);
 *  - applyPhysicalSky(), the lighting from the CPU mirror: the sun key's
 *    colour and strength from the real transmittance, the horizon and zenith
 *    the shader will show, the sun disc, and lit ground for the IBL bake.
 */
import { Vector3, Vector4 } from 'three';
import { pinned } from '../fly-pins.js';
import { PHYS_SKY, TWILIGHT_FIX } from '../fly-constants.js';
import * as M from './model.js';

/** The resolved PHYS_SKY block (URL / console pins applied once, at load). */
export const PHYS_SKY_ACTIVE = pinned(PHYS_SKY, '__flyPhysSkyOverride');
export function physSkyOn() {
  return PHYS_SKY_ACTIVE.enabled === true;
}
/** The physical sky draws the real sun, so the key switches at twilight. */
export const PHYS_TWILIGHT = Object.freeze({ ...TWILIGHT_FIX, enabled: true });

/** The consumer uniforms (shared holders; values written every frame). */
export const PSKY_UNIFORMS = {
  uPskyView: { value: null },
  uPskyEye: { value: new Vector4(0.001, 1, 1, 0) },
  uPskyApScatter: { value: null },
  uPskyApTrans: { value: null },
  uPskyAp: { value: new Vector4(450, 0.001, 0, 0) },
  uPskySunIllum: { value: new Vector3(1, 1, 1) },
  uPskyGrade: { value: new Vector4(1, 0, 0, 0) },
  uPskyNightH: { value: new Vector3() },
  uPskyNightZ: { value: new Vector3() },
  uPskyVeilH: { value: new Vector3() },
  uPskyVeilZ: { value: new Vector3() },
  uPskySunDisc: { value: new Vector3() },
  uPskyGround: { value: new Vector3() },
};

/** Per-program edit results ('patched' | 'off' | 'miss: …'), for the gate. */
export const PHYS_SKY_SHADERS = {};
/** Apply exact single-match edits when the flag is on; any miss keeps `src`. */
export function physSkyShader(name, src, edits) {
  if (!physSkyOn()) {
    PHYS_SKY_SHADERS[name] = 'off';
    return src;
  }
  let out = src;
  for (const [from, to] of edits) {
    const at = out.indexOf(from);
    if (at < 0 || out.indexOf(from, at + from.length) >= 0) {
      PHYS_SKY_SHADERS[name] = `miss: ${from.slice(0, 60)}`;
      return src;
    }
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  PHYS_SKY_SHADERS[name] = 'patched';
  return out;
}

/** The weather's own extinction (fog, overcast) on top of the physical air. */
export function physWeatherExtinction(e) {
  return (e?.overcast ?? 0) * 0.000051 + (e?.fog ?? 0) * 0.00024;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const SIN1 = Math.sin(Math.PI / 180);
const SIN45 = Math.SQRT1_2;
// The authored Enhanced layers the physical sky keeps (cinema-environment.js).
const NIGHT_H = [0.016, 0.029, 0.055];
const NIGHT_Z = [0.002, 0.0045, 0.014];

let cpu = null;
/** The CPU mirror's small tables, built once (~20 ms). */
export function physSkyCpu() {
  if (!cpu) {
    const p = M.atmosphereParams(PHYS_SKY_ACTIVE.grade);
    const s = M.createAtmosphereCpu(p);
    cpu = { ...s, lumRef: lum(M.lookupTransmittance(p, s.trans, 0.001, SIN45)), cache: { h: NaN, muS: NaN } };
  }
  return cpu;
}

const avgAround = (f) => {
  const a = f(1), b = f(0), c = f(-1);
  return [0, 1, 2].map((k) => (a[k] + 2 * b[k] + c[k]) / 4);
};
function sample(c, h, muS) {
  const k = c.cache;
  if (Math.abs(h - k.h) <= 0.002 && Math.abs(muS - k.muS) <= 2e-4) return k;
  const { p, trans, ms } = c;
  k.h = h;
  k.muS = muS;
  k.T = M.lookupTransmittance(p, trans, h, muS);
  k.vis = M.sunVisibility(p, h, muS);
  k.zenith = M.skyRadiance(p, trans, ms, h, 1, 1, muS, 24);
  k.horizon = avgAround((lvc) => M.skyRadiance(p, trans, ms, h, SIN1, lvc, muS, 24));
  // Sky irradiance on the ground: zenith and 45° ring, cosine-weighted.
  const z0 = M.skyRadiance(p, trans, ms, 0.001, 1, 1, muS, 16);
  const r45 = avgAround((lvc) => M.skyRadiance(p, trans, ms, 0.001, SIN45, lvc, muS, 16));
  k.skyIrr = [0, 1, 2].map((i) => (Math.PI * (z0[i] + 2 * r45[i])) / 3);
  k.T0 = M.lookupTransmittance(p, trans, 0.001, muS);
  k.vis0 = M.sunVisibility(p, 0.001, muS);
  return k;
}

const _rgb = [0, 0, 0];
/** cinemaSky's layers, on the CPU: saturation, night floor, weather veil. */
function shadeSky(L, up, illum, sat, nightW, veilH, veilZ, veilW, out) {
  for (let i = 0; i < 3; i++) _rgb[i] = L[i] * illum;
  const l = lum(_rgb);
  for (let i = 0; i < 3; i++) {
    const g = Math.max(0, l + (_rgb[i] - l) * sat) + mix(NIGHT_H[i], NIGHT_Z[i], up) * nightW;
    out[i] = Math.max(0, mix(g, mix(veilH[i], veilZ[i], up), veilW));
  }
  return out;
}

/**
 * Light the cinema environment `e` (after the art pass) from the physical
 * sky, and write PSKY_UNIFORMS. `twilight` is the switch geometry in use.
 */
export function applyPhysicalSky(e, runtime, twilight = PHYS_TWILIGHT) {
  const c = physSkyCpu();
  const P = PHYS_SKY_ACTIVE;
  const camY = runtime?.camera?.position?.y;
  const yM = Number.isFinite(camY) ? camY : runtime?.flight?.pos?.y ?? 0;
  const h = clamp(yM / 1000, 0.001, 80);
  const muS = clamp(e.sunDir[1], -1, 1);
  const k = sample(c, h, muS);
  const illum = P.sunIlluminance;
  const sunT = [k.T[0] * k.vis, k.T[1] * k.vis, k.T[2] * k.vis];
  const rel = lum(sunT) / c.lumRef;
  const elDeg = (Math.asin(muS) * 180) / Math.PI;
  if (elDeg >= (twilight?.switchElDeg ?? -4)) {
    // The key is the sun: its colour and strength are the real transmittance.
    const m = Math.max(sunT[0], sunT[1], sunT[2]);
    if (m > 1e-6) for (let i = 0; i < 3; i++) e.keyColor[i] = sunT[i] / m;
    e.sun = P.keyIntensity * rel * (1 - 0.84 * e.overcast) * e.keyGain;
  }
  const discK = P.discRadiance / c.lumRef;
  PSKY_UNIFORMS.uPskySunDisc.value.set(sunT[0] * discK, sunT[1] * discK, sunT[2] * discK);

  const day = e.day;
  const veilW = (1 - (1 - e.overcast) * (1 - e.fog * 0.75)) * 0.85;
  const nightW = e.night;
  const veilH = [mix(0.018, 0.34, day), mix(0.026, 0.39, day), mix(0.044, 0.46, day)];
  const veilZ = [mix(0.006, 0.13, day), mix(0.012, 0.18, day), mix(0.025, 0.25, day)];
  const sat = Number.isFinite(P.grade?.saturation) ? P.grade.saturation : 1;
  // What the shader shows at the horizon and the zenith: the rim colour and
  // the IBL signature read these.
  shadeSky(k.horizon, Math.pow(SIN1, 0.46), illum, sat, nightW, veilH, veilZ, veilW, e.horizon);
  shadeSky(k.zenith, 1, illum, sat, nightW, veilH, veilZ, veilW, e.zenith);
  // Lit ground for the IBL's lower hemisphere (the aircraft bellies).
  const g = (P.iblGroundAlbedo / Math.PI) * illum;
  const direct = Math.max(muS, 0) * k.vis0;
  const ground = [0, 1, 2].map((i) => g * (k.T0[i] * direct + k.skyIrr[i]) * (1 - 0.6 * e.overcast) + e.fillColor[i] * 0.045);

  const U = PSKY_UNIFORMS;
  U.uPskySunIllum.value.set(illum, illum, illum);
  U.uPskyGrade.value.set(sat, veilW, nightW, 0);
  U.uPskyNightH.value.fromArray(NIGHT_H);
  U.uPskyNightZ.value.fromArray(NIGHT_Z);
  U.uPskyVeilH.value.fromArray(veilH);
  U.uPskyVeilZ.value.fromArray(veilZ);
  U.uPskyGround.value.fromArray(ground);
  e.physSky = { h, muS, sunRel: rel };
  return e;
}

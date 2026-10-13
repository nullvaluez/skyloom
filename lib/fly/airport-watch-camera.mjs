// The seated observer's head and optics: pure math, no three, no DOM.
//
// FRAMES. Head angles live in the RENDERED frame — what the observer
// perceives. With TRUE_SCALE on the camera renders scene units with true
// proportions (lib/fly/true-scale.js: forward' = normalize(S·forward),
// S = diag(1, k0, 1)), so a rig that writes a scene pitch p_s is seen at
// atan(k0·tan p_s). Every function here takes or returns rendered angles;
// `scenePitch()` is the one conversion the camera write needs. With
// TRUE_SCALE off, k0 = 1 and the two frames coincide.
//
// YAW is the scene/camera yaw convention (rotation.y, order 'YXZ'): a
// direction (dx, dz) has yaw atan2(-dx, -dz). Uniform Mercator scaling of
// X and Z never changes a horizontal direction, so yaw needs no conversion.
import { VIEW } from './observation-config.js';

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Wrap an angle into [-π, π). */
export function wrapPi(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Magnification inside the optics' range. */
export function clampMag(mag) {
  const o = VIEW.optics;
  return clamp(Number.isFinite(mag) ? mag : 1, o.minMag, o.maxMag);
}

/** Vertical field of view in degrees at a magnification (the owner's rule: FOV = 58 / mag). */
export function fovForMag(mag) {
  return VIEW.baseFovDeg / clampMag(mag);
}

/** 0..1: how far the binocular mask is raised at this magnification. */
export function maskAmount(mag) {
  return smoothstep(VIEW.optics.maskFromMag, VIEW.optics.maskFullMag, mag);
}

/**
 * One frame-rate independent step of log-magnification toward its target.
 * Exponential in log space, so 7x -> 20x and 20x -> 7x take the same time.
 */
export function easeMag(mag, target, dt) {
  const k = 1 - Math.exp(-VIEW.optics.zoomRate * Math.max(0, dt));
  const next = Math.exp(Math.log(mag) + (Math.log(target) - Math.log(mag)) * k);
  return Math.abs(next / target - 1) < 1e-4 ? target : next;
}

/**
 * Exact step of a critically damped spring toward a target moving at a
 * constant rate. `target` is where the target is at the END of the step.
 * The error e = x - target obeys e'' = -2ωe' - ω²e, whose closed form is
 * integrated over dt, then the target is added back: with the rate fed
 * forward, a target crossing the sky at a steady angular rate is held with
 * zero lag. `state` is {x, v} and is mutated.
 */
export function springTo(state, target, targetRate, omega, dt) {
  if (!(dt > 0)) return state;
  const e0 = state.x - (target - targetRate * dt);
  const de0 = state.v - targetRate;
  const decay = Math.exp(-omega * dt);
  const a = de0 + omega * e0;
  state.x = target + (e0 + a * dt) * decay;
  state.v = targetRate + (de0 - omega * a * dt) * decay;
  return state;
}

/** Scene pitch to write into camera.rotation.x for a rendered pitch under TRUE_SCALE k0. */
export function scenePitch(renderedPitch, k0 = 1) {
  return Math.atan(Math.tan(renderedPitch) / (k0 > 0 ? k0 : 1));
}

/**
 * Rendered angles of a scene-space offset from the eye. Returns yaw relative
 * to `roomHeading` (wrapped) and the rendered pitch. `k0` is the TRUE_SCALE
 * vertical correction (1 when off).
 */
export function offsetAngles(dx, dy, dz, k0, roomHeading, out = {}) {
  out.yaw = wrapPi(Math.atan2(-dx, -dz) - roomHeading);
  out.pitch = Math.atan2(dy * (k0 > 0 ? k0 : 1), Math.hypot(dx, dz));
  return out;
}

/**
 * Unit view-space ray through NDC (u, v) for a camera whose half-angle
 * tangents are (tanH, tanV), rotated by head (yaw, pitch) into world angles.
 * Returns the ray's {yaw, pitch}. (Order 'YXZ', roll 0, matching the camera.)
 */
export function ndcDirection(yaw, pitch, u, v, tanH, tanV, out = {}) {
  let x = u * tanH, y = v * tanV, z = -1;
  const n = Math.hypot(x, y, z);
  x /= n; y /= n; z /= n;
  // Rx(pitch)
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y1 = y * cp - z * sp;
  const z1 = y * sp + z * cp;
  // Ry(yaw)
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const wx = x * cy + z1 * sy;
  const wz = -x * sy + z1 * cy;
  out.yaw = Math.atan2(-wx, -wz);
  out.pitch = Math.asin(clamp(y1, -1, 1));
  return out;
}

/**
 * Head (yaw, pitch) that places the world direction (dirYaw, dirPitch) at
 * NDC (u, v). Used by zoom-to-cursor: the point under the pointer stays
 * under the pointer while the field narrows. Inverse of ndcDirection.
 */
export function anchorHead(dirYaw, dirPitch, u, v, tanH, tanV, out = {}) {
  let x = u * tanH, y = v * tanV, z = -1;
  const n = Math.hypot(x, y, z);
  x /= n; y /= n; z /= n;
  // Pitch from the vertical component: y·cos p − z·sin p = sin(dirPitch).
  const A = y, B = -z;
  const R = Math.hypot(A, B);
  const pitch = Math.asin(clamp(Math.sin(dirPitch) / R, -1, 1)) - Math.atan2(A, B);
  // The pitched ray's horizontal angle; yaw makes up the rest.
  const z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
  out.pitch = pitch;
  out.yaw = wrapPi(dirYaw - Math.atan2(-x, -z1));
  return out;
}

/** Great-circle angle between two directions given as (yaw, pitch). */
export function angularSeparation(y1, p1, y2, p2) {
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(wrapPi(y1 - y2));
  return Math.acos(clamp(c, -1, 1));
}

/**
 * The magnification the optics may use while the aim is `errRad` off target:
 * the field stays VIEW.optics.slewFovRatio times wider than the error, so a
 * swing to a distant contact zooms out, travels, and zooms back in.
 */
export function slewMag(errRad, targetMag) {
  if (!(errRad > 0)) return targetMag;
  const fovDeg = (errRad / DEG) * VIEW.optics.slewFovRatio;
  return clampMag(Math.min(targetMag, VIEW.baseFovDeg / Math.max(1e-6, fovDeg)));
}

/**
 * Deterministic hand sway (radians) — three incommensurate sines per axis and
 * a slow breath on pitch, so it never visibly loops. `amplitude` is the peak.
 */
export function handSway(tSec, amplitude, out = {}) {
  const t = tSec * TAU;
  out.yaw = amplitude * (0.58 * Math.sin(t * 0.23 + 1.3) + 0.3 * Math.sin(t * 0.61 + 0.4) + 0.12 * Math.sin(t * 1.7 + 2.1));
  out.pitch = amplitude * (0.5 * Math.sin(t * 0.19 + 2.6) + 0.32 * Math.sin(t * 0.53 + 5.1) + 0.18 * Math.sin(t * 1.37 + 0.9));
  return out;
}

/** Pick radius in CSS px at a magnification, before the aircraft's own projected size. */
export function pickRadius(mag) {
  const p = VIEW.pick;
  return Math.min(p.maxPx, p.basePx * Math.pow(clampMag(mag), p.magExp));
}

/** Typical wingspan (m) for an ADS-B emitter category: sizes markers and pick targets. */
export function wingspanFor(category) {
  switch (category) {
    case 'A1': return 11; // light
    case 'A2': return 20; // small
    case 'A3': return 35; // large
    case 'A4': return 40; // high-vortex large (757)
    case 'A5': return 62; // heavy
    case 'A6': return 30; // high performance
    case 'A7': return 12; // rotorcraft
    case 'B1': return 16; // glider
    default: return 32;
  }
}

/** Reduced-motion preference: the app's own setting wins, else the OS query. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage?.getItem('fly-reduced-motion');
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // storage blocked: fall back to the media query
  }
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

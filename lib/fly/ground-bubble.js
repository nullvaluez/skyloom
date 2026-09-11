/**
 * Round 25 (Fable, W0) — GROUND_BUBBLE: the pure math behind the one "how low
 * are we" signal (`runtime.groundBubble.k`). No constants import: the caller
 * hands in the (pinned) config so this file is node-testable as-is
 * (scripts/verify-ground-bubble-k.mjs).
 *
 * THE SHAPE. k is 1 at or below `aglInM`, 0 at or above `aglOutM`, a
 * smoothstep between. Two things stand between the raw AGL and k:
 *
 *  1. A DEADBAND of `hysteresisM` on the INPUT. The filtered AGL follows the
 *     real one but only moves once the real one has strayed more than the
 *     band from it, and then only by the excess. So a DEM refinement that
 *     steps the visual ground by less than the band cannot move k at all,
 *     and a 480 → 560 → 480 m sweep with a 60 m band moves the filtered AGL
 *     exactly once (to 500) and never back. That is the MOTION_R24 lesson —
 *     the world must not flicker because the DEM got better under you —
 *     applied to the one signal three owners key their bands on.
 *  2. An exponential settle of `smoothSec` from the current k toward the
 *     target, frame-rate independent (dt in seconds). A hitch delivers a
 *     larger fraction of the step, never more than the whole step.
 *
 * A warp (epoch change) and the first sample SNAP both stages: a cut is not a
 * ramp (the GROUND_VIS rule).
 */

export function createBubbleState() {
  return { k: 0, aglH: 0, epoch: undefined, inited: false };
}

/** Hermite smoothstep on [a, b]. */
export function smoothstep(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The target k for a (filtered) visual AGL. */
export function bubbleTarget(aglM, cfg) {
  return 1 - smoothstep(cfg.aglInM, cfg.aglOutM, aglM);
}

/**
 * Advance the state one frame. Returns the new k (also stored on `s.k`).
 * `aglVisM` is the VISUAL AGL (eyeAglVis — never the raw one). `epoch` is the
 * warp epoch; a change snaps.
 */
export function stepBubble(s, aglVisM, dtSec, cfg, epoch) {
  const agl = Number.isFinite(aglVisM) ? Math.max(0, aglVisM) : 0;
  const h = Math.max(0, cfg.hysteresisM ?? 0);
  if (!s.inited || s.epoch !== epoch) {
    s.inited = true;
    s.epoch = epoch;
    s.aglH = agl;
    s.k = bubbleTarget(agl, cfg);
    return s.k;
  }
  const d = agl - s.aglH;
  if (Math.abs(d) > h) s.aglH += d - Math.sign(d) * h;
  const target = bubbleTarget(s.aglH, cfg);
  const tau = cfg.smoothSec ?? 0;
  if (!(tau > 0) || !(dtSec > 0)) {
    s.k = target;
  } else {
    const a = 1 - Math.exp(-dtSec / tau);
    s.k += (target - s.k) * a;
    // Settle exactly: a k within 1e-4 of its target IS its target, so a reader
    // that compares against 0 or 1 (an "outside the bubble" gate) sees a clean
    // number rather than an asymptote.
    if (Math.abs(target - s.k) < 1e-4) s.k = target;
  }
  return s.k;
}

// ---------------------------------------------------------------------------
// The runtime side, as PLAIN functions. The rig (a React component) calls
// these rather than assigning to `runtime.*` itself: the project's
// react-hooks/immutability rule forbids mutating a prop inside a component or
// hook body, and it is right to — but `runtime` is the app's shared mutable
// bus by design (FlyScene fills it every frame), so the write belongs in a
// module function that owns the contract, exactly as GROUND_VIS's
// stepGroundVis() does for `runtime.groundElevVis`.
// ---------------------------------------------------------------------------

/** Create the published object. Idempotent; returns it. */
export function attachGroundBubble(runtime) {
  if (!runtime) return null;
  const gb = { k: 0, aglM: 0, aglVisM: 0 };
  runtime.groundBubble = gb;
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const stats = (window.__flyStats = window.__flyStats || {});
    stats.groundBubble = gb;
  }
  return gb;
}

/** Remove it so every reader is back to `?? 0`. */
export function detachGroundBubble(runtime) {
  if (runtime) runtime.groundBubble = undefined;
  if (typeof window !== 'undefined' && window.__flyStats) window.__flyStats.groundBubble = undefined;
}

/**
 * One frame: read the damped AGL, step the state, publish in place. `aglVisM`
 * and `aglRawM` are computed by the caller from `eyeAglVis` so this module
 * stays free of the ground-vis import (node-testable).
 */
export function publishGroundBubble(runtime, state, aglVisM, aglRawM, dtSec, cfg) {
  const gb = runtime?.groundBubble;
  if (!gb || !state) return 0;
  const k = stepBubble(state, aglVisM, dtSec, cfg, runtime._gvEpoch);
  gb.k = k;
  gb.aglVisM = aglVisM;
  gb.aglM = aglRawM;
  return k;
}

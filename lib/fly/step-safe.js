'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { STEP_SAFE } from '@/lib/fly/fly-constants';

/**
 * ROUND 22.1 (A "FLASH") — apply a quality-ladder DPR step INSIDE the frame
 * loop, in the same animation frame that then draws.
 *
 * See the STEP_SAFE block in fly-constants.js for the measured ordering this
 * replaces. In one line: r3f resizes the drawing buffer from a React layout
 * effect, i.e. in a plain task between animation frames, and the composer
 * resizes a whole frame later from a passive effect — so the compositor gets
 * two chances to present a surface the frame loop never drew at that size.
 *
 * The seam is deliberately tiny and NOT React state: the governor is a plain
 * object built by createGovernor() and its `applyDpr` effector must stay
 * callable from a node test. It parks a number here; the rig picks it up on
 * the next useFrame at STEP_SAFE.framePriority (-99, i.e. immediately after
 * PerfGovernor's -100 and long before the composer's +1).
 *
 * `enabled:false` ⇒ requestDpr() is never called (perf-governor.js keeps its
 * R22 `applyDpr: (d) => setDpr(d)` line) and <StepSafeRig> is not mounted.
 */

/** Flag + (harness) pin resolution. One place, so every consumer agrees. */
export function stepSafeOn() {
  if (!STEP_SAFE.enabled) return false;
  // Same fleet-pin idiom as __flyGovPin / __flyTerraPin: a harness that needs
  // the PRE-FIX ordering (verify-step-clean's own RED leg) pins it off without
  // a rebuild. undefined — the state on every user machine — means "armed".
  if (typeof window !== 'undefined' && window.__flyStepSafePin === 'off') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The pending-dpr cell. Module scope on purpose: the governor hands a value in
// from outside React, and the rig reads it inside the frame loop.
// ---------------------------------------------------------------------------
let pendingDpr = null;
let pendingAt = 0;
let fallback = null;
/** Set by FlyCanvas so the safety valve can still reach React. */
let reactSetDpr = null;
/** Set by FlyEffectComposer so the composer resizes in the same tick. */
let composer = null;

function stats() {
  if (typeof window === 'undefined') return null;
  return ((window.__flyStats ??= {}).stepSafe ??= {
    requested: 0,
    applied: 0,
    valve: 0,
    lastDpr: null,
    lastDeferMs: null,
    inFrame: null,
    composerInTick: null,
  });
}

/**
 * Called by the composer component so the rig can resize it in-tick. Only the
 * FORKED composer (FX_STABILITY.enabled) registers — with that flag off the
 * library component is in the tree and the post chain keeps catching up in its
 * own passive effect, exactly as it does today. The renderer half of the fix
 * still applies in that configuration.
 */
export function registerStepSafeComposer(c) {
  if (!STEP_SAFE.enabled) return undefined;
  composer = c;
  return () => {
    if (composer === c) composer = null;
  };
}

/** Called by FlyCanvas so the safety valve has a React path. */
export function registerStepSafeSetDpr(fn) {
  reactSetDpr = fn;
}

/**
 * The governor's effector when the flag is armed. Records the value; the rig
 * applies it. Returns true if it was parked (the caller must not also write
 * React state).
 */
export function requestDpr(d) {
  if (!stepSafeOn()) return false;
  pendingDpr = d;
  pendingAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const s = stats();
  if (s) {
    s.requested++;
    s.lastDpr = d;
  }
  if (fallback) clearTimeout(fallback);
  if (STEP_SAFE.maxDeferMs > 0 && typeof setTimeout === 'function') {
    fallback = setTimeout(() => {
      fallback = null;
      // The rig never ran (not mounted, or the tab has been hidden for a
      // second). Losing the ladder's cheapest rung is worse than the flash it
      // would have avoided, so fall back to the R22 path.
      if (pendingDpr == null) return;
      const d2 = pendingDpr;
      pendingDpr = null;
      const s2 = stats();
      if (s2) s2.valve++;
      if (reactSetDpr) reactSetDpr(d2);
    }, STEP_SAFE.maxDeferMs);
  }
  return true;
}

/** Test/harness read-out — never used by production code paths. */
export function peekPendingDpr() {
  return pendingDpr;
}

/**
 * The rig. Mounted inside <Canvas> by FlyCanvas when the flag is armed.
 * Returns null; it owns no scene object and issues no draw.
 */
export function StepSafeRig({ setDpr }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    registerStepSafeSetDpr(setDpr);
    return () => registerStepSafeSetDpr(null);
  }, [setDpr]);

  useFrame(() => {
    const d = pendingDpr;
    if (d == null) return;
    pendingDpr = null;
    if (fallback) {
      clearTimeout(fallback);
      fallback = null;
    }
    const { width, height } = sizeRef.current;

    // (1) THE DRAWING BUFFER. setPixelRatio() folds into setSize(), which is
    //     the canvas.width/height write that reallocates — the one operation
    //     that must not be visible to the compositor before a draw. Running it
    //     here means the composer's own useFrame (priority 1) fills the new
    //     buffer later in THIS SAME animation frame, before the browser gets
    //     a chance to composite.
    gl.setPixelRatio(d);
    gl.setSize(width, height, true);

    // (2) THE POST CHAIN, in the same tick. Without this the composer resizes
    //     a whole frame later from its passive effect, and the frame in
    //     between is composed with buffers that disagree with the drawing
    //     buffer (measured: exactly one such frame per step, pre-fix).
    //     composer.setSize takes CSS dimensions and derives every buffer from
    //     getDrawingBufferSize() internally — see FlyEffectComposer (ii).
    let did = false;
    if (composer) {
      try {
        composer.setSize(width, height);
        did = true;
      } catch {
        // A composer that fails to resize must never take the frame loop with
        // it; its own effect will retry on the React catch-up below.
      }
    }

    // (3) THE REACT CATCH-UP, same tick. r3f's store subscriber will re-apply
    //     setPixelRatio + setSize with the IDENTICAL numbers; assigning an
    //     unchanged value to canvas.width does not reallocate the drawing
    //     buffer (measured in Chromium), so the second application is a true
    //     no-op and the composer's size effect finds its buffers already
    //     correct and skips.
    setDpr(d);

    const s = stats();
    if (s) {
      s.applied++;
      s.lastDeferMs = +(
        (typeof performance !== 'undefined' ? performance.now() : 0) - pendingAt
      ).toFixed(2);
      s.inFrame = true;
      s.composerInTick = did;
      s.dbw = gl.getContext?.().drawingBufferWidth ?? null;
    }
  }, STEP_SAFE.framePriority);

  return null;
}

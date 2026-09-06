/**
 * Round 24 (A PACE) — STEP_SAFE: apply a governor DPR step INSIDE the frame
 * that draws it. Recon A3 / FL-05.
 *
 * THE DEFECT. `PerfGovernor` decides a step inside its `useFrame`, but it
 * effects the step through React state (`setDpr`). React commits that in a
 * separate task; r3f's store subscriber then calls
 * `gl.setPixelRatio(d); gl.setSize(w, h, …)` SYNCHRONOUSLY inside the zustand
 * write — outside any animation frame. Writing `canvas.width` reallocates and
 * CLEARS the drawing buffer, so the compositor can present a cleared buffer;
 * and the vendored composer resizes its own targets in a PASSIVE effect, a
 * frame later still, so at least one composed frame is rendered into buffers
 * of the wrong size and resampled onto the new canvas. R22.1 traced exactly
 * that on the later tree: 24/24 reallocs outside rAF, composer lag 9.0–23.6 ms,
 * 10–12 of 12 steps mismatched.
 *
 * (What it is NOT: the user's white flash. That theory was refuted by
 * measurement — 0 pale frames in 112 forced steps and 70,285 live frames — and
 * plan §7 forbids re-opening it. This is a real ordering defect on its own
 * terms, and it is one of the three tear-shaped mechanisms this round can
 * actually fix.)
 *
 * THE FIX, and why it is a module cell rather than a ref. The governor parks
 * the value here; a rig component with `useFrame(cb, -99)` — after the
 * governor's -100, long before the composer's +1 — applies the renderer resize,
 * the composer resize and the React `setDpr` in the SAME tick. r3f's catch-up
 * then re-applies identical numbers, and Chromium does not reallocate on an
 * unchanged `canvas.width`. A module cell is the right shape because the two
 * ends are in different component trees (the governor is a child of Canvas, the
 * composer is inside Effects) and neither owns the other.
 *
 * Everything here is inert unless `STEP_SAFE.enabled`: with the flag off the
 * governor calls `setDpr` directly, exactly as in R21.
 */

/** The parked DPR, or null. One slot: a newer step supersedes an older one. */
let pendingDpr = null;
let parkedAtMs = 0;

/** Park a DPR for the rig to apply on the next frame. */
export function parkDpr(d) {
  pendingDpr = d;
  parkedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Take the parked DPR (and clear it), or null. */
export function takeDpr() {
  const d = pendingDpr;
  pendingDpr = null;
  return d;
}

/** Milliseconds a value has been waiting, or 0 when nothing is parked. */
export function pendingAgeMs() {
  if (pendingDpr == null) return 0;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now - parkedAtMs;
}

/** Peek without consuming (the safety valve and the harness both read this). */
export function peekDpr() {
  return pendingDpr;
}

/**
 * The live EffectComposer, registered by FlyEffectComposer from a keyed effect
 * with an OWNER-CHECKED disposer. Owner-checked because React 19 StrictMode
 * double-invokes effects: without the check, the second mount's cleanup would
 * clear the first mount's registration and the rig would resize the renderer
 * but not the composer — the exact half-applied state STEP_SAFE exists to
 * prevent (recon A10's lesson, applied to a registration rather than a global).
 */
let liveComposer = null;
export function registerComposer(c) {
  liveComposer = c;
  return () => {
    if (liveComposer === c) liveComposer = null;
  };
}
export function getComposer() {
  return liveComposer;
}

/** Test seam: forget everything (harnesses run several arms in one page). */
export function resetStepSafe() {
  pendingDpr = null;
  parkedAtMs = 0;
  liveComposer = null;
}

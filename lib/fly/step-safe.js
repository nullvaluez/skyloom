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
 * the composer resize and the React `setDpr` in the SAME tick. A module cell is
 * the right shape because the two ends are in different component trees (the
 * governor is a child of Canvas, the composer is inside Effects) and neither
 * owns the other.
 *
 * That is HALF the fix, and shipping only that half left half the writes
 * outside the frame — see THE SECOND WRITER at the foot of this file, which is
 * also where the claim that used to sit here ("Chromium does not reallocate on
 * an unchanged canvas.width") is retracted and replaced by a measurement.
 *
 * Everything here is inert unless `STEP_SAFE.enabled`: with the flag off the
 * governor calls `setDpr` directly, exactly as in R21.
 */

import { STEP_SAFE } from './fly-constants';

/**
 * The live STEP_SAFE config with a harness/diagnosis override on top.
 * `window.__flyStepSafeOverride = { enabled: true }`, set before Fly mode
 * mounts, arms the rig without editing constants — the R16 weather-pin idiom,
 * and the same one TERRA_PACE uses. It is what makes an A/B possible on the
 * USER'S machine, which is the only place a frame-pacing claim can be tested.
 * Production reads nothing extra.
 */
export function resolveStepSafe() {
  const pin = typeof window !== 'undefined' ? window.__flyStepSafeOverride : null;
  return pin ? { ...STEP_SAFE, ...pin } : STEP_SAFE;
}

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
  guardOwner = null;
}

/* -------------------------------------------------------------------------
 * THE SECOND WRITER, and why the rig alone was not enough.
 *
 * MEASURED (pass 2b, verify-step-clean, tree ec53fd3, DPR 1.5): with the rig
 * ON, EXACTLY HALF of every canvas and renderer write was still outside the
 * frame — 6 forced steps, 12 DPR applications, 6 inside and 6 outside, each
 * outside one carrying the SAME value as the inside one 46-117 ms later.
 *
 *   setPixelRatio: [{d:1.25,inRaf:true,t:178239.6},{d:1.25,inRaf:false,t:182942.8},
 *                   {d:1.5, inRaf:true,t:184117.3},{d:1.5, inRaf:false,t:184181.2}, …]
 *
 * THE CHAIN. `FlyCanvas` holds the DPR in React state and passes it as
 * `<Canvas dpr={dpr}>`; the rig's own `setDpr(d)` is that React setter, not
 * r3f's store setter. So the rig's call schedules a React render; on commit
 * r3f's `Canvas` layout effect runs `await root.configure({ dpr, … })` — an
 * AWAIT, so the store write lands a task later — and r3f's zustand subscriber
 * (@react-three/fiber 9.6.1, events-*.esm.js:1158-1166) then re-applies:
 *
 *     if (size.width !== oldSize.width || … || viewport.dpr !== oldDpr) {
 *       updateCamera(camera, size);
 *       if (viewport.dpr > 0) gl.setPixelRatio(viewport.dpr);
 *       gl.setSize(size.width, size.height, updateStyle);
 *     }
 *
 * unconditionally, outside any animation frame. The rig cannot pre-empt it:
 * `configure` is async and the subscriber is captured in `createRoot`'s
 * closure, so there is nothing to reach. `flushSync` does not help either —
 * the await defers the store write past the flush.
 *
 * WHAT I GOT WRONG. The rig's header asserted that this catch-up was harmless
 * because "Chromium does not reallocate on an unchanged canvas.width". I never
 * measured that, and the HTML spec says the opposite: assigning width or
 * height resets the bitmap. Writing it as fact is how a second writer survived
 * a design whose whole claim is that there is one writer.
 *
 * THE GUARD. When the rig owns the step, a resize request for the state the
 * renderer is ALREADY in must not reach the canvas. This wraps the two
 * renderer methods on the instance and skips exactly that case — never real
 * work: a genuine container resize still resizes, because its target differs.
 * On a skip it still calls `setViewport(0, 0, w, h)`, which is the one side
 * effect three's `setSize` has that a bare return would drop, so the skip is a
 * semantic no-op rather than a behaviour change. It delegates unconditionally
 * whenever three itself would take a different path (`xr.isPresenting`, or a
 * non-null `renderer.output` whose `setSize` a skip would miss — the app sets
 * neither, and this is insurance, not a live case).
 *
 * Installed and removed by the rig, so it exists only while STEP_SAFE is armed.
 * ------------------------------------------------------------------------- */

/** The renderer currently guarded, so a StrictMode re-mount cannot double-wrap. */
let guardOwner = null;

/**
 * Wrap `gl.setPixelRatio` / `gl.setSize` so an already-satisfied resize does
 * not touch the canvas. Returns an owner-checked uninstaller.
 */
export function installResizeGuard(gl) {
  const noop = () => {};
  if (!resolveStepSafe().enabled) return noop;
  if (!gl || typeof gl.setSize !== 'function' || typeof gl.setPixelRatio !== 'function') return noop;
  if (guardOwner === gl) return noop;

  const origSetPixelRatio = gl.setPixelRatio;
  const origSetSize = gl.setSize;
  // `getSize` writes into whatever object is handed to it, so a two-field
  // scratch avoids importing three into a module three does not otherwise need.
  const scratch = {
    x: 0,
    y: 0,
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
  };
  const bump = (which) => {
    if (typeof window === 'undefined') return;
    const st = (window.__flyStats ??= {});
    const g = (st.stepGuard ??= { setPixelRatio: 0, setSize: 0 });
    g[which] += 1;
  };
  // three itself takes a different path in these two states, so never guess on
  // their behalf.
  const delegate = () => gl.xr?.isPresenting === true || gl.output != null;

  gl.setPixelRatio = function guardedSetPixelRatio(value) {
    if (value === undefined) return undefined; // three's own first line
    if (!delegate() && value === gl.getPixelRatio()) {
      const s = gl.getSize(scratch);
      gl.setViewport(0, 0, s.x, s.y);
      bump('setPixelRatio');
      return undefined;
    }
    return origSetPixelRatio.call(gl, value);
  };

  gl.setSize = function guardedSetSize(width, height, updateStyle = true) {
    if (!delegate()) {
      const s = gl.getSize(scratch);
      const pr = gl.getPixelRatio();
      const canvas = gl.domElement;
      const styleSettled =
        updateStyle !== true ||
        (canvas?.style?.width === `${width}px` && canvas?.style?.height === `${height}px`);
      if (
        s.x === width &&
        s.y === height &&
        canvas?.width === Math.floor(width * pr) &&
        canvas?.height === Math.floor(height * pr) &&
        styleSettled
      ) {
        gl.setViewport(0, 0, width, height);
        bump('setSize');
        return undefined;
      }
    }
    return origSetSize.call(gl, width, height, updateStyle);
  };

  guardOwner = gl;
  return () => {
    if (guardOwner !== gl) return;
    gl.setPixelRatio = origSetPixelRatio;
    gl.setSize = origSetSize;
    guardOwner = null;
  };
}

/** Test seam: is a renderer currently guarded? */
export function resizeGuardOwner() {
  return guardOwner;
}

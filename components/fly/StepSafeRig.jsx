'use client';

import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  getComposer,
  installResizeGuard,
  peekDpr,
  pendingAgeMs,
  resolveStepSafe,
  takeDpr,
} from '@/lib/fly/step-safe';

/**
 * ROUND 24 (A PACE) — STEP_SAFE's frame half. Recon A3 / FL-05.
 *
 * The governor parks a DPR (lib/fly/step-safe.js); this applies it INSIDE a
 * frame, in one tick:
 *
 *   priority -100  PerfGovernor decides and parks
 *   priority  -99  THIS: gl.setPixelRatio -> gl.setSize -> composer.setSize
 *                        -> React setDpr
 *   priority  -50  FlyScene's simulation
 *   priority   +1  FlyEffectComposer renders
 *
 * so the canvas realloc, the composer's render targets and the React state all
 * move before anything draws.
 *
 * `setDpr` is FlyCanvas's React STATE setter, so calling it here is what keeps
 * r3f's store honest — and also what makes r3f re-apply the same numbers from
 * its own store subscriber a task later, OUTSIDE the frame. This header used to
 * claim that catch-up was free because "Chromium does not reallocate on an
 * unchanged canvas.width". That was never measured, the HTML spec says the
 * opposite, and pass 2b measured 6 of 12 DPR applications landing outside the
 * frame with the rig ON. So the rig also installs `installResizeGuard`, which
 * makes an already-satisfied resize a no-op and leaves the rig as the only
 * writer that reaches the canvas. See lib/fly/step-safe.js, THE SECOND WRITER.
 *
 * Renders nothing and adds nothing to the scene.
 */
export function StepSafeRig({ setDpr }) {
  const gl = useThree((s) => s.gl);

  // Owner-checked inside `installResizeGuard`, for the same reason the composer
  // registration is: React 19 StrictMode double-invokes effects, and an
  // uninstaller that did not check ownership would restore the ORIGINAL methods
  // over the second mount's wrappers, leaving the renderer unguarded while the
  // rig believed otherwise.
  useEffect(() => installResizeGuard(gl), [gl]);

  useFrame(({ gl: glFrame, size }) => {
    const d = takeDpr();
    if (d == null) return;
    const t0 = performance.now();
    glFrame.setPixelRatio(d);
    // `updateStyle` true: the CSS size is unchanged, so this only rewrites the
    // backing store — the same call r3f's subscriber would make, made here.
    glFrame.setSize(size.width, size.height, true);
    // The composer's targets are sized in CSS pixels; it multiplies by the
    // renderer's pixel ratio internally, exactly as its own passive effect
    // does. Registered from a keyed effect with an owner-checked disposer, so
    // a StrictMode double-mount cannot leave this pointing at a dead composer.
    getComposer()?.setSize(size.width, size.height);
    setDpr(d);
    if (typeof window !== 'undefined') {
      // The record verify-step-clean reads: everything below happened in ONE
      // animation frame. `rafId` is the frame counter, so a gate can assert
      // the renderer resize, the composer resize and the draw share a frame.
      const st = (window.__flyStats ??= {});
      const prev = st.step;
      st.step = {
        n: (prev?.n ?? 0) + 1,
        dpr: d,
        atMs: t0,
        applyMs: +(performance.now() - t0).toFixed(3),
        canvasW: glFrame.domElement.width,
        canvasH: glFrame.domElement.height,
        composer: !!getComposer(),
        viaValve: false,
      };
    }
  }, -99);

  // The safety valve. If the rig never runs — a hidden tab, or the canvas
  // unmounted between the park and the next frame — the parked value must not
  // strand the governor on a rung it thinks it applied. After valveMs it is
  // applied the legacy way (React state only), which is exactly the R21
  // behaviour and therefore always safe, just not same-frame.
  useEffect(() => {
    const cfg = resolveStepSafe();
    if (!cfg.enabled) return undefined;
    const id = setInterval(() => {
      if (peekDpr() == null) return;
      if (pendingAgeMs() < cfg.valveMs) return;
      const d = takeDpr();
      if (d == null) return;
      setDpr(d);
      if (typeof window !== 'undefined') {
        const st = (window.__flyStats ??= {});
        st.step = { ...(st.step ?? {}), n: (st.step?.n ?? 0) + 1, dpr: d, viaValve: true };
        st.stepValves = (st.stepValves ?? 0) + 1;
      }
    }, 250);
    return () => clearInterval(id);
  }, [setDpr]);

  return null;
}

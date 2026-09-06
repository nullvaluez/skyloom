'use client';

import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { getComposer, peekDpr, pendingAgeMs, resolveStepSafe, takeDpr } from '@/lib/fly/step-safe';

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
 * move before anything draws. r3f's own catch-up then re-applies identical
 * numbers on its next commit, and Chromium does not reallocate on an unchanged
 * `canvas.width` — which is why calling `setDpr` here as well is not a second
 * resize but the thing that keeps r3f's store honest.
 *
 * Renders nothing and adds nothing to the scene.
 */
export function StepSafeRig({ setDpr }) {
  useFrame(({ gl, size }) => {
    const d = takeDpr();
    if (d == null) return;
    const t0 = performance.now();
    gl.setPixelRatio(d);
    // `updateStyle` true: the CSS size is unchanged, so this only rewrites the
    // backing store — the same call r3f's subscriber would make, made here.
    gl.setSize(size.width, size.height, true);
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
        canvasW: gl.domElement.width,
        canvasH: gl.domElement.height,
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

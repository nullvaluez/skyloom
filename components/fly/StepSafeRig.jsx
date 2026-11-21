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
 * The governor parks a DPR (lib/fly/step-safe.js). For the stable composer we
 * hand it the resize at -99. It commits the drawing buffer, post targets and
 * React state just before a draw that preflight has cleared to proceed.
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
    if (peekDpr() == null) return;
    const composer = getComposer();
    const apply = () => {
      const d = takeDpr();
      if (d == null) return;
      const t0 = performance.now();
      glFrame.setPixelRatio(d);
      glFrame.setSize(size.width, size.height, true);
      composer?.setSize(size.width, size.height);
      setDpr(d);
      if (typeof window !== 'undefined') {
        const st = (window.__flyStats ??= {});
        st.step = {
          n: (st.step?.n ?? 0) + 1,
          dpr: d,
          atMs: t0,
          applyMs: +(performance.now() - t0).toFixed(3),
          canvasW: glFrame.domElement.width,
          canvasH: glFrame.domElement.height,
          composer: !!composer,
          viaValve: false,
        };
      }
    };
    const main = glFrame.__flyMainDraw;
    if (main?.enabled && main.owner === composer) {
      main.applyDpr = apply;
    } else {
      apply();
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
      const main = gl.__flyMainDraw;
      // A visible compositor may be waiting on a program. A state-only resize
      // would clear the canvas during that hold.
      if (main?.enabled && main.owner === getComposer() && !document.hidden) return;
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
  }, [gl, setDpr]);

  return null;
}

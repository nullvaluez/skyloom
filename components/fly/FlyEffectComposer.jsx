'use client';

import { memo, forwardRef, useMemo, useEffect, useLayoutEffect, useRef, useImperativeHandle } from 'react';
import { HalfFloatType, NoToneMapping, Vector2 } from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import {
  EffectComposer as LibEffectComposer,
  EffectComposerContext,
} from '@react-three/postprocessing';
import {
  EffectComposer as EffectComposerImpl,
  RenderPass,
  EffectPass,
  NormalPass,
  DepthDownsamplingPass,
  Effect,
  Pass,
  EffectAttribute,
} from 'postprocessing';
import { finishPassChain } from '@/lib/fly/post-policy';
import { FX_STABILITY } from '@/lib/fly/fly-constants';
import { registerComposer, resolveStepSafe } from '@/lib/fly/step-safe';

/**
 * ROUND 21 (A GOVERNOR, S2 + S3) — a vendored fork of
 * @react-three/postprocessing@3.0.4's <EffectComposer> (over
 * postprocessing@6.39.2), carrying three fixes the upstream component cannot
 * give us. FX_STABILITY.enabled:false exports the LIBRARY component itself
 * (same component identity, same behavior, byte-identical frames) — the
 * one-flag revert contract.
 *
 * ── (i) DISPOSE ON REMOVE ────────────────────────────────────────────────
 * Upstream's pass-assembly layout effect tears down with
 * `composer.removePass(pass)`, and postprocessing's removePass ONLY splices
 * the pass out of the array — it never disposes. Every rebuild therefore
 * abandoned an EffectPass, its EffectMaterial and the compiled program behind
 * it. Because the merged EffectPass is rebuilt on EVERY re-render of <Effects>
 * (see (iii)), that is a per-DPR-step, per-tier-step, per-store-tick leak.
 *
 * The dispose itself needs care: postprocessing 6.39.2's EffectPass.dispose()
 * calls `effect.dispose()` on each of ITS CHILD EFFECTS, and our children are
 * React-owned singletons (the useMemo'd WhiteBalance / AerialPerspective /
 * SpeedLines instances and the R3F-managed Bloom). Disposing those would
 * permanently break the next rebuild. So we detach the pass's own change
 * listeners, empty `pass.effects`, and only THEN dispose — which runs
 * Pass.dispose()'s resource sweep (fullscreenMaterial → program released) over
 * an empty child list.
 *
 * ── (ii) DPR-TRUE SIZING ─────────────────────────────────────────────────
 * Upstream keys its setSize effect on R3F's CSS `size` only. R3F's setDpr
 * mutates `viewport.dpr` — not `size` — so a quality-ladder DPR step resized
 * the DRAWING BUFFER while the composer's input/output/depth targets kept the
 * old resolution: the composited frame was sampled at the wrong scale and
 * arrived stretched or cropped until the next real window resize. That is the
 * user's literal "screen glitching", and it was present from boot (the very
 * first PerformanceMonitor step). Here the effect also depends on
 * `viewport.dpr`, and it verifies against `gl.getDrawingBufferSize()` — the
 * buffer truth — rather than trusting either React value.
 *
 * NOTE the argument: composer.setSize() takes CSS dimensions and sizes every
 * buffer from getDrawingBufferSize() internally. Passing drawing-buffer
 * dimensions in would make it call renderer.setSize() with them and blow the
 * canvas' CSS box up by the pixel ratio. The DPR truth belongs in the TRIGGER
 * and the assertion, not in the argument.
 *
 * ── (iii) PASS-LIST DIFF ─────────────────────────────────────────────────
 * Upstream's layout effect lists `children` in its dependency array. JSX
 * children are a fresh array on every render of the parent, so the composer
 * demolished and rebuilt its entire pass chain on every unrelated re-render of
 * <Effects> — a store selector tick, a DPR state change, anything. With
 * AerialPerspectiveEffect declaring EffectAttribute.DEPTH, each of those
 * cycles also deleted and re-created the composer's depth render target.
 * Here the effect runs on every commit but reconciles against the RESOLVED
 * effect/pass instance list: identical list ⇒ no teardown, no rebuild, no
 * recompile. <Effects> additionally memoises its children so the list is
 * stable by construction; this diff is the belt to that suspenders, and it is
 * what makes `__flyStats.fx.rebuilds` a meaningful instrument.
 */

// R24 A (STEP_SAFE): module scratch, so the in-frame buffer check on the hot
// path allocates nothing.
const _fxSize = new Vector2();
const _fxCss = new Vector2();
const isConvolution = (effect) =>
  (effect.getAttributes() & EffectAttribute.CONVOLUTION) === EffectAttribute.CONVOLUTION;

/** Dispose an EffectPass WITHOUT disposing its React-owned child effects. */
function disposePass(pass) {
  try {
    if (pass instanceof EffectPass) {
      const effects = Array.isArray(pass.effects) ? pass.effects.slice() : [];
      for (const e of effects) {
        try {
          e.removeEventListener('change', pass.listener);
        } catch {
          // an effect that never registered — nothing to detach
        }
      }
      // Own property on EffectPass (set in its constructor), so this really
      // does neuter the dispose loop rather than hitting an accessor.
      pass.effects = [];
    }
    pass.dispose();
  } catch {
    // A pass that fails to dispose must never take the frame loop with it.
  }
}

/** Shallow reference-equality over the resolved child object list. */
function sameList(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function bumpFxStat(patch) {
  if (typeof window === 'undefined') return;
  const fx = ((window.__flyStats ??= {}).fx ??= { rebuilds: 0, resizes: 0 });
  Object.assign(fx, patch);
}

const StableEffectComposer = /* @__PURE__ */ memo(
  /* @__PURE__ */ forwardRef(function FlyEffectComposerImpl(
    {
      children,
      camera: _camera,
      scene: _scene,
      resolutionScale,
      enabled = true,
      renderPriority = 1,
      autoClear = true,
      depthBuffer,
      enableNormalPass,
      stencilBuffer,
      multisampling = 8,
      frameBufferType = HalfFloatType,
    },
    ref
  ) {
    const gl = useThree((s) => s.gl);
    const defaultScene = useThree((s) => s.scene);
    const defaultCamera = useThree((s) => s.camera);
    const size = useThree((s) => s.size);
    // (ii) THE fix: R3F's setDpr moves this, never `size`.
    const dpr = useThree((s) => s.viewport.dpr);
    const scene = _scene || defaultScene;
    const camera = _camera || defaultCamera;

    const [composer, normalPass, downSamplingPass] = useMemo(() => {
      const effectComposer = new EffectComposerImpl(gl, {
        depthBuffer,
        stencilBuffer,
        multisampling,
        frameBufferType,
      });
      effectComposer.addPass(new RenderPass(scene, camera));
      let downSampling = null;
      let normal = null;
      if (enableNormalPass) {
        normal = new NormalPass(scene, camera);
        normal.enabled = false;
        effectComposer.addPass(normal);
        if (resolutionScale !== undefined) {
          downSampling = new DepthDownsamplingPass({
            normalBuffer: normal.texture,
            resolutionScale,
          });
          downSampling.enabled = false;
          effectComposer.addPass(downSampling);
        }
      }
      return [effectComposer, normal, downSampling];
    }, [
      camera,
      gl,
      depthBuffer,
      stencilBuffer,
      multisampling,
      frameBufferType,
      scene,
      enableNormalPass,
      resolutionScale,
    ]);

    // ---- the harness handle on the LIVE composer -------------------------
    // R21 (E addendum): verify-tier-step gate 4 asserts
    // `composer.inputBuffer` size === `gl.getDrawingBufferSize()` after each
    // forced DPR/tier step — the S3 stretched-frame defect — and there is no
    // other way to reach the composer instance from a page.evaluate. Only the
    // forked component publishes it, so the handle's PRESENCE is also an
    // honest signal that FX_STABILITY is armed. Cleared on unmount so a gate
    // can never read a dead composer from a previous canvas.
    useEffect(() => {
      if (typeof window === 'undefined' || !composer) return;
      window.__flyComposer = composer;
      return () => {
        if (window.__flyComposer === composer) delete window.__flyComposer;
      };
    }, [composer]);

    // R24 A (STEP_SAFE): hand the LIVE composer to the -99 DPR rig, from a
    // keyed effect with an OWNER-CHECKED disposer. Owner-checked because React
    // 19 StrictMode double-invokes effects: an unconditional cleanup would let
    // the second mount's teardown clear the first mount's registration, and the
    // rig would then resize the renderer but not the composer — precisely the
    // half-applied state STEP_SAFE exists to prevent.
    useEffect(() => {
      if (!resolveStepSafe().enabled || !composer) return undefined;
      return registerComposer(composer);
    }, [composer]);

    // ---- (ii) size, keyed on CSS size AND device pixel ratio -------------
    useEffect(() => {
      if (!composer) return;
      const db = gl.getDrawingBufferSize(new Vector2());
      const buf = composer.inputBuffer;
      // R3F hands out a fresh `size` object more often than the canvas
      // actually changes shape, so decide on the BUFFERS, not on React
      // identity: resize when the composer's input buffer is not the drawing
      // buffer. That keeps `resizes` an honest instrument and keeps the
      // per-pass setSize walk off the hot path.
      // The second term covers the effect-ordering case: if this ever ran
      // BEFORE R3F applied a new CSS size to the renderer, the drawing buffer
      // would still read old and the first term alone would skip the resize
      // permanently. Comparing R3F's size against the renderer's own is the
      // library's original trigger, kept as the backstop.
      const cur = gl.getSize(new Vector2());
      const stale =
        !buf ||
        buf.width !== db.width ||
        buf.height !== db.height ||
        cur.width !== size.width ||
        cur.height !== size.height;
      if (stale) composer.setSize(size.width, size.height);
      const after = composer.inputBuffer;
      bumpFxStat({
        resizes: (window.__flyStats?.fx?.resizes ?? 0) + (stale ? 1 : 0),
        buffer: after ? [after.width, after.height] : null,
        drawing: [db.width, db.height],
        dpr,
        // The invariant verify-tier-step asserts: the composer's buffers ARE
        // the drawing buffer, at every DPR the ladder can reach.
        bufferMatchesDrawing:
          !!after && after.width === db.width && after.height === db.height,
      });
    }, [composer, size, dpr, gl]);

    useFrame(
      (_, delta) => {
        if (enabled) {
          // R24 A (STEP_SAFE, recon FL-05): the composer's own size effect is
          // PASSIVE, so on any resize it lags the renderer by at least a frame
          // and that frame is composed from buffers of the wrong size and
          // resampled onto the new canvas. Comparing the buffers HERE, in the
          // render, closes the window for every resize path — including the
          // window-resize path the rig does not cover. It is two integer
          // comparisons on the hot path and it keeps
          // `__flyStats.fx.bufferMatchesDrawing` (verify-tier-step gate 4)
          // true by construction rather than by timing.
          if (stepSafeOn.current && composer) {
            const db = gl.getDrawingBufferSize(_fxSize);
            const buf = composer.inputBuffer;
            if (!buf || buf.width !== db.width || buf.height !== db.height) {
              const css = gl.getSize(_fxCss);
              composer.setSize(css.width, css.height);
              bumpFxStat({
                inFrameResizes: (window.__flyStats?.fx?.inFrameResizes ?? 0) + 1,
              });
            }
          }
          const currentAutoClear = gl.autoClear;
          gl.autoClear = autoClear;
          if (stencilBuffer && !autoClear) gl.clearStencil();
          composer.render(delta);
          gl.autoClear = currentAutoClear;
        }
      },
      enabled ? renderPriority : 0
    );

    // ---- (i) + (iii) pass assembly, reconciled not rebuilt ---------------
    // R24 A (STEP_SAFE): resolved once, read on the hot path as a ref.
    const stepSafeOn = useRef(resolveStepSafe().enabled);
    const group = useRef(null);
    const built = useRef({ objects: null, passes: [], composer: null, camera: null });

    const teardown = () => {
      const prev = built.current;
      for (const pass of prev.passes) {
        prev.composer?.removePass(pass);
        // Only the passes THIS component constructed are ours to dispose; a
        // <primitive> Pass child belongs to the React tree that made it.
        if (prev.owned?.has(pass)) disposePass(pass);
      }
      built.current = { objects: null, passes: [], owned: null, composer: null, camera: null };
    };

    // No dependency array on purpose: correctness is decided by the RESOLVED
    // child list, not by React's identity of `children` (which is a fresh
    // array every render — the upstream churn bug).
    useLayoutEffect(() => {
      const groupInstance = group.current?.__r3f;
      if (!groupInstance || !composer) return;

      const objects = [];
      for (const c of groupInstance.children) {
        const o = c.object;
        if (o instanceof Effect || o instanceof Pass) objects.push(o);
      }

      const prev = built.current;
      if (
        prev.objects &&
        prev.composer === composer &&
        prev.camera === camera &&
        sameList(prev.objects, objects)
      ) {
        return; // (iii) nothing changed — keep the compiled merged pass
      }

      teardown();

      const passes = [];
      const owned = new Set();
      for (let i = 0; i < objects.length; i++) {
        const child = objects[i];
        if (child instanceof Effect) {
          const effects = [child];
          if (!isConvolution(child)) {
            let next = null;
            while ((next = objects[i + 1]) instanceof Effect) {
              if (isConvolution(next)) break;
              effects.push(next);
              i++;
            }
          }
          const pass = new EffectPass(camera, ...effects);
          owned.add(pass);
          passes.push(pass);
        } else if (child instanceof Pass) {
          passes.push(child);
        }
      }
      // R24 C (POST_ORDER): per-PASS policy the descriptor list cannot express
      // — today the output dither on the LAST pass. Called from here AND from
      // prewarm's identical assembly so the warmed program carries the same
      // DITHERING define production compiles. No-op with the flag off.
      finishPassChain(passes);
      for (const pass of passes) composer.addPass(pass);
      if (normalPass) normalPass.enabled = true;
      if (downSamplingPass) downSamplingPass.enabled = true;

      built.current = { objects, passes, owned, composer, camera };
      bumpFxStat({
        rebuilds: (window.__flyStats?.fx?.rebuilds ?? 0) + 1,
        passes: passes.length,
        effects: objects.length,
      });
    });

    // Unmount / composer swap is the ONLY teardown.
    useLayoutEffect(() => {
      return () => {
        teardown();
        if (normalPass) normalPass.enabled = false;
        if (downSamplingPass) downSamplingPass.enabled = false;
      };
    }, [composer, normalPass, downSamplingPass]);

    useEffect(() => {
      const currentTonemapping = gl.toneMapping;
      gl.toneMapping = NoToneMapping;
      return () => {
        gl.toneMapping = currentTonemapping;
      };
    }, [gl]);

    const state = useMemo(
      () => ({ composer, normalPass, downSamplingPass, resolutionScale, camera, scene }),
      [composer, normalPass, downSamplingPass, resolutionScale, camera, scene]
    );

    useImperativeHandle(ref, () => composer, [composer]);

    return (
      <EffectComposerContext.Provider value={state}>
        <group ref={group}>{children}</group>
      </EffectComposerContext.Provider>
    );
  })
);

/**
 * The drop-in. Module-level branch (FX_STABILITY.enabled is a build-time
 * constant): with the flag off this IS the library component — same identity,
 * same reconciliation, nothing forked in the tree at all.
 */
export const FlyEffectComposer = FX_STABILITY.enabled
  ? StableEffectComposer
  : LibEffectComposer;

export { EffectComposerContext };

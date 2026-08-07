'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PREWARM } from '@/lib/fly/fly-constants';
import { prewarmState, runPrewarm } from '@/lib/fly/prewarm';
import { useFlyStore } from '@/stores/fly-store';

/**
 * ROUND 21 (A GOVERNOR, §3.2) — the mount point for the boot shader pre-warm.
 *
 * Deliberately its own component rather than a line inside FlyScene: the warm
 * needs the renderer, the camera and the LIVE scene (for light/fog/environment
 * parity — see lib/fly/prewarm.js), all of which useThree hands over, and it
 * must not be able to affect a single thing FlyScene renders. It adds no
 * object to the scene graph and issues no draw, so every frozen draw ceiling
 * (Owens ≤ 261, satellite ≤ 375, toy ≤ 480) is untouched by construction.
 *
 * Scheduling: idle, but NOT before `scene.environment` exists (capped by
 * PREWARM.envWaitMs). That wait is not caution, it is a MEASURED requirement:
 * three folds the scene environment into a material's program cache key for
 * MeshStandardMaterial (envMapMode CubeUVReflectionMapping +
 * envMapCubeUVHeight), and warming before the HDRI resolved produced keys that
 * differed from production in exactly those two fields — for the terrain tile
 * material (179 uses) and every traffic model. A warm that lands one field off
 * is not a warm; it is a second program.
 *
 * The compile competes with the GPU but not with the network, so it overlaps
 * the tile stream that dominates boot instead of extending it — and
 * BootScreen's shaders gate only WAITS for it up to PREWARM.maxMs, after which
 * the reveal proceeds and the warm finishes in the background. The boot
 * envelope can therefore never grow by more than that cap.
 *
 * `runtime.prewarm` is published as the live state OBJECT (mutated in place by
 * the warm), so the BootScreen poll reads fresh values with no extra wiring.
 */
export function PrewarmRig({ runtime }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    if (!PREWARM.enabled || !runtime) return;
    runtime.prewarm = prewarmState();
    const store = useFlyStore.getState();
    const t0 = performance.now();
    let timer = null;
    let idle = null;
    const ric = typeof window !== 'undefined' ? window.requestIdleCallback : null;
    const kick = () => {
      runPrewarm({
        gl,
        camera,
        scene,
        style: store.mapStyle,
        tier: store.qualityTier,
      });
    };
    const wait = () => {
      const ready = !!scene.environment || performance.now() - t0 >= PREWARM.envWaitMs;
      if (!ready) {
        timer = setTimeout(wait, 100);
        return;
      }
      idle = ric ? ric(kick, { timeout: 300 }) : setTimeout(kick, 0);
    };
    wait();
    return () => {
      if (timer) clearTimeout(timer);
      if (idle != null) {
        if (ric && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
        else clearTimeout(idle);
      }
    };
  }, [gl, camera, scene, runtime]);

  return null;
}

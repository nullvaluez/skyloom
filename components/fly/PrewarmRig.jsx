'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ENV_UNIFORM, PREWARM, SETTLE_CALM } from '@/lib/fly/fly-constants';
import { compileCriticalTerrain, prewarmPending, prewarmSliceStep, prewarmState, pumpRequeue, requeueForEnvironment, runPrewarm } from '@/lib/fly/prewarm';
import { terrainArrivalCovered } from '@/lib/fly/critical-terrain-prewarm.mjs';
import { cinemaOn } from '@/lib/fly/cinema-policy';
import { bumpArrival, noteFrame, popinState, settleOn } from '@/lib/fly/settle';
import { useFlyStore } from '@/stores/fly-store';
// SHIP PASS FRAME (FR-3, SHADER_READY): the registry rescan triggers.
import { queueRegistryWarm } from '@/lib/fly/prewarm';
import { prewarmEntries } from '@/lib/fly/prewarm-registry';
import { resetRegistryWarm } from '@/lib/fly/registry-warm';
import { shipPassOn } from '@/lib/fly/ship-pass';

/**
 * ROUND 21 (A GOVERNOR, §3.2) — the mount point for the boot shader pre-warm.
 *
 * Deliberately its own component rather than a line inside FlyScene: the warm
 * needs the renderer, the camera and the LIVE scene (for light/fog/environment
 * parity — see lib/fly/prewarm.js), all of which useThree hands over, and it
 * adds no object to the scene graph and issues no draw, so every frozen draw ceiling
 * (Owens ≤ 261, satellite ≤ 375, toy ≤ 480) is untouched by construction.
 *
 * Scheduling: critical terrain dispatches before its first draw, immediately
 * after the live shadow/environment callbacks. The rest is idle, but NOT
 * before `scene.environment` exists (capped by
 * PREWARM.envWaitMs). That wait is not caution, it is a MEASURED requirement:
 * three folds the scene environment into a material's program cache key for
 * MeshStandardMaterial (envMapMode CubeUVReflectionMapping +
 * envMapCubeUVHeight), and warming before the HDRI resolved produced keys that
 * differed from production in exactly those two fields — for the terrain tile
 * material (179 uses) and every traffic model. A warm that lands one field off
 * is not a warm; it is a second program.
 *
 * The critical publication latch only applies under an arrival curtain; its
 * existing time cap / explicit reduced entry releases the latch and records
 * a bypass. Unsupported parallel drivers retain the original rendering path.
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

  // ROUND 22 (B SETTLE) — the POP-IN / LONG-FRAME instrument (plan §6.9).
  // Published as the live state OBJECT, the `runtime.prewarm` idiom: E's gates
  // and the soak read `runtime.popin` without any polling plumbing. It is NOT
  // flag-gated — a measurement of the un-flagged tree is exactly what the
  // flagged one has to be compared against.
  useEffect(() => {
    if (!runtime) return undefined;
    // runtime is the scene's mutable bus (FlyScene RUNTIME CONTRACTS (R18)) —
    // the same write `runtime.prewarm` below has always made.
    runtime.popin = popinState();
    // …and mirrored under __flyStats, where every other instrument in the app
    // lives and where the soak's sampler already looks. Same OBJECT, so there
    // is nothing to keep in sync.
    if (typeof window !== 'undefined') (window.__flyStats ??= {}).popin = popinState();
    let prev = useFlyStore.getState().warpEpoch;
    bumpArrival(prev);
    return useFlyStore.subscribe((s) => {
      if (s.warpEpoch === prev) return;
      prev = s.warpEpoch;
      bumpArrival(prev);
    });
  }, [runtime]);

  // The long-frame census + the post-reveal compile slice, both on the RAW
  // inter-frame delta at priority -99 (behind the governor at -100, ahead of
  // everything that draws). A unit is only ever taken on a frame that already
  // had room: a compile is a synchronous driver stall, and spending one on a
  // frame that is ALREADY long is how R21's straight-line warm produced the
  // stutter this replaces.
  const sliceRef = useRef(false);
  const sliceWaitRef = useRef(0);
  const envSeenRef = useRef(false);
  // TRUE when the warm actually ran with a scene environment resident, i.e.
  // the R21 wait was satisfied rather than timed out. Set at kick time below.
  const warmedWithEnvRef = useRef(false);
  useFrame((_, delta) => {
    noteFrame(delta);
    if (!settleOn()) return;
    // THE ENVIRONMENT RE-KEY. A warm that ran before the HDRI resolved (the
    // PREWARM.envWaitMs cap firing on a cold or throttled fetch) minted the
    // no-environment permutation of every lit material; the moment
    // scene.environment appears, three will want the 306/2048 one. Re-queue
    // once — see requeueForEnvironment for the measured 13-program census
    // this closes. `warmedWithEnv` is recorded at kick time, so a warm that
    // already had the environment never re-queues at all.
    if (!envSeenRef.current && scene.environment) {
      envSeenRef.current = true;
      if (!warmedWithEnvRef.current) requeueForEnvironment({ gl, camera, scene });
    }
    if (sliceRef.current || !prewarmPending()) return;
    // The frame-budget test, with a RELAXATION so a genuinely slow machine
    // still finishes its warm. On a heavily loaded machine no frame is ever
    // 24 ms, and a queue that waits forever is a queue that has traded one
    // stutter for a lifetime of first-draw compiles. After sliceGraceSec of
    // frames with no opportunity the bar rises to the frame time that machine
    // is actually delivering — still never a frame that is ALREADY the worst
    // one, which is the whole rule.
    sliceWaitRef.current += delta;
    const bar = sliceWaitRef.current > 20 ? 0.05 : 0.024;
    if (delta > bar) return;
    sliceWaitRef.current = 0;
    sliceRef.current = true;
    prewarmSliceStep(SETTLE_CALM.prewarmSlice?.perIdleRaf ?? 1).finally(() => {
      sliceRef.current = false;
    });
  }, -99);

  // The first real tile used to beat the idle warm and block in
  // getProgramInfoLog for seconds. CSM patches at −0.9 and the environment
  // publishes at −0.8; dispatch immediately after both, before reflections or
  // the main draw. Tile material visibility stays latched until ready.
  useFrame(() => {
    const store = useFlyStore.getState();
    const worldProfiles = runtime?.prewarm?.worldProfiles;
    // A restored renderer has the same JS identity but no old GPU programs.
    // Recover only the measured profile batch after the rebuilt environment
    // and live cascade rig publish; the generic boot warm stays one-shot.
    if (worldProfiles?.status === 'invalidated' && !runtime.contextLost && !gl.getContext().isContextLost()) {
      if (!cinemaOn(store)) Object.assign(worldProfiles, { required: false, status: 'not-required' });
      else if (scene.environment && runtime.cinemaShadows != null) runtime.prewarm.retryWorldProfiles?.();
    }
    const gate = runtime?.terrainPrewarm;
    if (!gate) return;
    if (runtime.prewarm) runtime.prewarm.criticalTerrain = gate.state;
    if (!['waiting', 'compiling', 'failed'].includes(gate.state.status)) return;
    const environment = scene.environment;
    const key = [environment?.id ?? 'none', environment?.mapping ?? '',
      runtime.cinemaShadows?.cascades ?? 'legacy', store.mapStyle, store.visuals, store.qualityTier,
      gl.shadowMap.enabled, gl.shadowMap.type].join('/');
    gate.tick({
      key,
      parallel: gl.extensions.has('KHR_parallel_shader_compile'),
      covered: terrainArrivalCovered(runtime, typeof window !== 'undefined' ? window.__flyBoot : null, store.phase),
      available: (!!environment || performance.now() - gate.state.createdAt >= PREWARM.envWaitMs)
        && (!cinemaOn(store) || runtime.cinemaShadows != null),
      compile: () => compileCriticalTerrain({ gl, camera, scene,
        adoptWarmScene: (object) => runtime.adoptCinematicWarmScene?.(object),
        onProfiles: (counts) => { gate.state.cascadeCounts = counts; } }),
    });
  }, -0.7);

  useEffect(() => {
    if (!PREWARM.enabled || !runtime) return;
    runtime.prewarm = prewarmState();
    const store = useFlyStore.getState();
    const t0 = performance.now();
    let timer = null;
    let idle = null;
    const ric = typeof window !== 'undefined' ? window.requestIdleCallback : null;
    const kick = () => {
      warmedWithEnvRef.current = !!scene.environment;
      runPrewarm({
        gl,
        camera,
        scene,
        style: store.mapStyle,
        tier: store.qualityTier,
        adoptWarmScene: (object) => runtime.adoptCinematicWarmScene?.(object),
        beforeWarm: () => runtime.terrainPrewarm?.wait(),
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

  // SHIP PASS FRAME (FR-3, SHADER_READY) — the registry consumer's other
  // triggers (the boot drain is in runPrewarm): a tier or preset step queues
  // what is still missing for the new tier; every 2 s it rescans for entries
  // registered late (a stream's lazily loaded module, the title) and for a
  // new scene.environment (the day/night bucket crossing re-bakes it). A
  // lost context drops the retained registry programs. Flag off: no effect,
  // no timer, no subscription.
  useEffect(() => {
    if (!PREWARM.enabled || !shipPassOn('SHADER_READY')) return undefined;
    const run = (reason, tiers) => {
      if (!prewarmState().started) return; // runPrewarm owns the boot warm
      queueRegistryWarm({ gl, camera, scene, tiers, reason });
    };
    let prevTier = useFlyStore.getState().qualityTier;
    let prevPreset = useFlyStore.getState().qualityPreset;
    const unsub = useFlyStore.subscribe((st) => {
      if (st.qualityTier === prevTier && st.qualityPreset === prevPreset) return;
      prevTier = st.qualityTier;
      prevPreset = st.qualityPreset;
      run('tier', [st.qualityTier]);
    });
    let count = prewarmEntries().length;
    let env = scene.environment;
    const id = setInterval(() => {
      const n = prewarmEntries().length;
      if (n !== count) {
        count = n;
        run('rescan');
      }
      if (scene.environment && scene.environment !== env) {
        env = scene.environment;
        run('env');
      }
    }, 2000);
    const lost = () => resetRegistryWarm();
    gl.domElement?.addEventListener('webglcontextrestored', lost);
    return () => {
      unsub();
      clearInterval(id);
      gl.domElement?.removeEventListener('webglcontextrestored', lost);
    };
  }, [gl, camera, scene]);

  // R24 B (ENV_UNIFORM, recon A5) — the late-HDRI repair. When the warm ran
  // WITHOUT a scene.environment (a throttled network beat PREWARM.envWaitMs),
  // every lit material warmed its no-environment permutation and the real ones
  // compile after the reveal, inside the frame loop. This re-queues them and
  // drains ONE per IDLE frame — a frame slower than ENV_UNIFORM.idleFrameMs is
  // skipped entirely, so the repair only ever spends headroom that already
  // exists. Flag-off both calls return immediately and this useFrame is a
  // single boolean test; priority 3 puts it after the render.
  useFrame((_, dt) => {
    if (!ENV_UNIFORM.enabled) return;
    requeueForEnvironment({ gl, camera, scene });
    // The optional boot queue and main's late-environment queue share frame
    // headroom; do not spend both compile budgets in the same frame.
    if (sliceRef.current || prewarmPending()) return;
    pumpRequeue(dt * 1000);
  }, 3);

  return null;
}

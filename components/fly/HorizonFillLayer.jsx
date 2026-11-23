'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { horizonFillOn, horizonFillConfig, horizonFillTier } from '@/lib/fly/horizon-fill';
import { worldPassConfig } from '@/lib/fly/world-pass';
import { CarpetEngine, buildCarpetPrewarm } from '@/lib/fly/horizon-fill/carpet-engine';
import { registerPrewarm } from '@/lib/fly/prewarm-registry';
import { mayFinalize } from '@/lib/fly/finalize-pace';
import { satelliteVisualsOn } from '@/lib/fly/satellite-visuals';
import { eyeAglVis, groundElevVis } from '@/lib/fly/ground-vis';
import { useFlyStore } from '@/stores/fly-store';

/**
 * HORIZON FILL (FLY_HORIZON_FILL.md): the procedural far-field building layer.
 *
 * Mounted by FlyScene inside worldRoot, after SatSkylineLayer, in satellite
 * only. The latched reader decides once per mount whether anything exists:
 * off (the shipped default, Medium / Low, phones, stand-ins off) this
 * component renders null and creates no worker, no engine, no draw and no
 * global.
 *
 * On: its own fill worker (lib/fly/horizon-fill/fill.worker.js), the carpet
 * engine (lib/fly/horizon-fill/carpet-engine.js) and a frame loop at priority
 * -44, after the skyline's -45, so the detailed ring's coverage mask the
 * skyline wrote this frame is the one copied. The engine's meshes sit at
 * absolute chunk centres, so worldRoot's -anchor translation places them, as
 * it places the skyline's. Not part of world readiness: a failed worker or a
 * failed tile leaves today's view.
 */
export function HorizonFillLayer({ runtime, flight }) {
  const on = useMemo(() => horizonFillOn('carpet'), []);
  if (!on) return null;
  return <HorizonFillCarpet runtime={runtime} flight={flight} />;
}

// The detailed ring's arrival has priority: while it drapes, an upload waits,
// at most this many frames in a row.
const ARRIVAL_HOLD_FRAMES = 30;

function HorizonFillCarpet({ runtime, flight }) {
  const engine = useMemo(() => {
    const reachCfg = worldPassConfig('reach');
    return new CarpetEngine({
      config: horizonFillConfig(),
      tier: horizonFillTier() ?? 'high',
      groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat),
      coverage: () => (horizonFillOn('coverage') ? runtime.satSkyline?.fillCoverage ?? null : null),
      houses: horizonFillOn('houses'),
      preload: horizonFillOn('preload'),
      reachCfg,
      lighting: satelliteVisualsOn('lighting'),
    });
  }, [runtime]);
  const nowRef = useRef(0);
  const statsAtRef = useRef(0);

  /* eslint-disable react-hooks/immutability -- publish the engine on the shared imperative scene runtime */
  useEffect(() => {
    runtime.horizonFill = engine;
    /* eslint-enable react-hooks/immutability */
    engine.revive(); // a StrictMode re-run of this effect follows a dispose
    // The carpet's one program variant (the near hole); the registry consumer
    // rescans for late entries. Same key on a re-run: registering replaces it.
    try {
      const reachCfg = worldPassConfig('reach');
      const lighting = satelliteVisualsOn('lighting');
      registerPrewarm({ stream: 'HORIZON', key: 'HORIZON:carpet-hole', build: () => buildCarpetPrewarm({ reachCfg, lighting }), when: { tiers: ['high', 'ultra'] } });
    } catch {
      /* a cold first compile is the only cost */
    }
    // Upload admission: the shared finalize brake (a probe, it reserves
    // nothing), and the detailed ring's arrival first.
    let held = 0;
    engine.setAdmit((done) => {
      if (!mayFinalize(done)) return false;
      const s = runtime.satBuildings?.stats;
      if (done === 0 && s && s.draping && held < ARRIVAL_HOLD_FRAMES) {
        held += 1;
        return false;
      }
      held = 0;
      return true;
    });
    let worker = null;
    try {
      worker = new Worker(new URL('../../lib/fly/horizon-fill/fill.worker.js', import.meta.url), { type: 'module' });
      const api = wrap(worker);
      const footprintK = worldPassConfig('reach').worker?.footprintK ?? 0.5;
      Promise.resolve(api.init({ ...horizonFillConfig(), footprintK }))
        .then(() => {
          engine.setWorker(api);
        })
        .catch((err) => {
          if (process.env.NODE_ENV === 'development') console.warn('[horizon-fill] worker init failed:', err?.message ?? err);
        });
    } catch (err) {
      if (process.env.NODE_ENV === 'development') console.warn('[horizon-fill] worker failed to start:', err?.message ?? err);
    }
    if (process.env.NODE_ENV === 'development') window.__horizonFill = engine;
    return () => {
      engine.dispose();
      worker?.terminate();
      if (runtime.horizonFill === engine) runtime.horizonFill = null;
      if (process.env.NODE_ENV === 'development') delete window.__horizonFill;
      const stats = window.__flyStats;
      if (stats?.horizonFill) stats.horizonFill = { state: stats.horizonFill.state };
    };
  }, [engine, runtime]);

  // A warp is a cut: the destination's ring streams at once.
  useEffect(() => {
    let prev = useFlyStore.getState().warpEpoch;
    return useFlyStore.subscribe((s) => {
      if (s.warpEpoch !== prev) {
        prev = s.warpEpoch;
        engine.notifyWarp(nowRef.current);
      }
    });
  }, [engine]);

  useFrame(({ clock, camera, size }) => {
    const t = clock.elapsedTime;
    nowRef.current = t;
    if (camera?.isPerspectiveCamera) engine.setView(size.height / (2 * Math.tan((camera.fov * Math.PI) / 360)), size.height);
    engine.syncSkyline(runtime.satSkyline?.material, runtime.sun?.frac);
    engine.update(t, flight.pos.x, flight.pos.z, eyeAglVis(runtime, flight), groundElevVis(runtime, flight));
    if (t - statsAtRef.current > 0.25) {
      statsAtRef.current = t;
      const stats = window.__flyStats;
      // Throttled and in place; the reader's `state` stays beside the carpet's numbers.
      if (stats) {
        const out = (stats.horizonFill ??= {});
        const s = engine.stats;
        for (const key in s) if (key !== 'levels') out[key] = s[key];
        const levels = (out.levels ??= [0, 0, 0]);
        levels[0] = s.levels[0];
        levels[1] = s.levels[1];
        levels[2] = s.levels[2];
      }
    }
  }, -44);

  return <primitive object={engine.object} />;
}

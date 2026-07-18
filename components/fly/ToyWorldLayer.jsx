'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { ToyWorldEngine } from '@/lib/fly/toy-world/toy-world-engine';
import { setFoamTime, setPulseTime } from '@/lib/fly/toy-world/world-bend';
import { BEACONS, FOAM, ROAD_PULSE } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Mounts the Toy World chunk engine (FLY_TOYWORLD_REWORK §4.2) inside
 * worldRoot and owns its update loop (priority -48: after flight at -50,
 * before traffic at -45). Rendered only while mapStyle === 'toy'; unmount
 * disposes every chunk + the worker (StrictMode-safe: creation in effects,
 * symmetric cleanup).
 *
 * The engine drapes chunks on the existing TerrainEngine's DEM — `runtime`
 * hands it `engine.getElevationAt` (satellite tiles keep streaming as the
 * elevation oracle + base ground; their imagery is a flat palette tan in
 * toy style, see tile-sources.js).
 */
export function ToyWorldLayer({ runtime, flight }) {
  const engine = useMemo(
    () => new ToyWorldEngine({ groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat) }),
    [runtime]
  );

  useEffect(() => {
    const worker = new Worker(
      new URL('../../lib/fly/toy-world/vector-tile.worker.js', import.meta.url),
      { type: 'module' }
    );
    const api = wrap(worker);
    api.init().catch((err) => {
      if (process.env.NODE_ENV === 'development')
        console.warn('[toy-world] TileJSON init failed:', err?.message ?? err);
    });
    engine.setWorker(api);
    if (process.env.NODE_ENV === 'development') window.__toyWorld = engine; // harness introspection
    return () => {
      runtime.toyStats = null; // raster styles use the tile-download signal
      engine.dispose();
      worker.terminate();
    };
  }, [engine, runtime]);

  // A warp opens the engine's accept-coarse-fast window so the destination
  // pops in within seconds (the heal path re-drapes once real DEM lands).
  // Discrete store subscription — never per-frame React.
  useEffect(() => {
    let prev = useFlyStore.getState().warpEpoch;
    return useFlyStore.subscribe((s) => {
      if (s.warpEpoch !== prev) {
        prev = s.warpEpoch;
        engine.notifyWarp(engine._lastNowSec ?? 0);
      }
    });
  }, [engine]);

  useFrame(({ clock }) => {
    engine._lastNowSec = clock.elapsedTime;
    engine.update(clock.elapsedTime, flight.pos.x, flight.pos.z);
    setFoamTime(clock.elapsedTime * FOAM.speed); // shoreline dash train
    // road-pulse dash + rooftop beacon clocks (Atlas round §4.3a/b)
    setPulseTime(clock.elapsedTime * ROAD_PULSE.speed, clock.elapsedTime * BEACONS.rate);
    // Prod-safe readiness for the warp-arrival hold (WarpFlash polls this).
    // ~4Hz — engine.stats allocates a snapshot, no need per frame.
    if (clock.elapsedTime - (engine._statsAt ?? 0) > 0.25) {
      engine._statsAt = clock.elapsedTime;
      const snap = engine.stats;
      runtime.toyStats = snap;
      if (process.env.NODE_ENV === 'development' && window.__flyStats) {
        window.__flyStats.toy = snap;
      }
    }
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.pulseT = clock.elapsedTime * ROAD_PULSE.speed; // clock advancing = pulses scrolling
    }
  }, -48);

  return <primitive object={engine.object} />;
}

'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { ToyWorldEngine } from '@/lib/fly/toy-world/toy-world-engine';
import { setFoamTime, setPulseTime } from '@/lib/fly/toy-world/world-bend';
import { BEACONS, FOAM, ROAD_PULSE } from '@/lib/fly/fly-constants';

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
      engine.dispose();
      worker.terminate();
    };
  }, [engine]);

  useFrame(({ clock }) => {
    engine.update(clock.elapsedTime, flight.pos.x, flight.pos.z);
    setFoamTime(clock.elapsedTime * FOAM.speed); // shoreline dash train
    // road-pulse dash + rooftop beacon clocks (Atlas round §4.3a/b)
    setPulseTime(clock.elapsedTime * ROAD_PULSE.speed, clock.elapsedTime * BEACONS.rate);
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.toy = engine.stats;
      window.__flyStats.pulseT = clock.elapsedTime * ROAD_PULSE.speed; // clock advancing = pulses scrolling
    }
  }, -48);

  return <primitive object={engine.object} />;
}

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { SatBuildingEngine } from '@/lib/fly/toy-world/sat-building-engine';
import { SAT_WATER } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Round 13 Phase 3 — mounts the SATELLITE 3D-building streamer inside worldRoot
 * (so its chunk meshes' modelMatrix carries the floating-origin -anchor, exactly
 * like the toy chunks, keeping the anchor-bend uBendCenter frame in sync). Owns
 * its own worker instance + update loop (priority -47: after the flight/bend at
 * -50, alongside the toy chunk loop). Rendered ONLY while mapStyle === 'satellite'
 * AND SAT_BUILDINGS.enabled AND tier ≥ medium — the FlyScene gate — so when off
 * the component never mounts: no worker, no engine, no draws, no globals (the
 * byte-noop contract verify-sat-buildings asserts).
 *
 * Drapes on the EXISTING TerrainEngine DEM (raw elevation — no toy exaggeration).
 * Dev introspection lives on window.__satBuildings (NOT __toyWorld — verify-round11
 * gate A asserts the toy pipeline is never built in satellite).
 */
export function SatBuildingLayer({ runtime, flight }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const engine = useMemo(
    () => new SatBuildingEngine({ groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat) }),
    [runtime]
  );
  // Round 13 (P4): water glint is a STRICT high-tier flourish. The layer itself
  // mounts at medium+ (FlyScene gate); this flips water on only at high, and off
  // (evicting the water meshes) on a high→medium degrade — no per-frame cost.
  useEffect(() => {
    engine.setWaterEnabled(SAT_WATER.enabled && qualityTier === SAT_WATER.minTier);
  }, [engine, qualityTier]);
  // Frame-loop timing lives in refs (never mutate the memoized engine in render —
  // react-hooks/purity); the warp subscription reads the current clock from here.
  const nowRef = useRef(0);
  const statsAtRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(
      new URL('../../lib/fly/toy-world/vector-tile.worker.js', import.meta.url),
      { type: 'module' }
    );
    const api = wrap(worker);
    api.init().catch((err) => {
      if (process.env.NODE_ENV === 'development')
        console.warn('[sat-buildings] TileJSON init failed:', err?.message ?? err);
    });
    engine.setWorker(api);
    if (process.env.NODE_ENV === 'development') window.__satBuildings = engine; // harness introspection
    return () => {
      engine.dispose();
      worker.terminate();
      if (process.env.NODE_ENV === 'development') delete window.__satBuildings;
    };
  }, [engine, runtime]);

  // A warp opens the accept-coarse-fast window so the destination city pops in.
  useEffect(() => {
    let prev = useFlyStore.getState().warpEpoch;
    return useFlyStore.subscribe((s) => {
      if (s.warpEpoch !== prev) {
        prev = s.warpEpoch;
        engine.notifyWarp(nowRef.current);
      }
    });
  }, [engine]);

  useFrame(({ clock }) => {
    nowRef.current = clock.elapsedTime;
    const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
    engine.update(clock.elapsedTime, flight.pos.x, flight.pos.z, eyeAgl);
    if (
      process.env.NODE_ENV === 'development' &&
      window.__flyStats &&
      clock.elapsedTime - statsAtRef.current > 0.25
    ) {
      statsAtRef.current = clock.elapsedTime;
      window.__flyStats.satBuildings = engine.stats;
    }
  }, -47);

  return <primitive object={engine.object} />;
}

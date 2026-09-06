'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { SatSkylineEngine } from '@/lib/fly/toy-world/sat-skyline-engine';
import { SAT_SKYLINE } from '@/lib/fly/fly-constants';
import { getSatSkyline } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';
// R24 B (GROUND_VIS, recon A6/T8) — AGL fade bands read the DAMPED ground.
import { eyeAglVis } from '@/lib/fly/ground-vis';

/**
 * Round 18 (A2 "SKYLINE") — mounts the DISTANT BLOCK-MASS streamer inside
 * worldRoot, structurally SatBuildingLayer/SatRoadLayer: its OWN worker
 * instance, its own update loop (priority -45: after the flight/bend at -50 and
 * behind the building loop at -47 / road loop at -46), a warp subscription, a
 * StrictMode-symmetric dispose. Its chunk meshes sit at ABSOLUTE group centers,
 * so worldRoot's -anchor translation is what puts them in the same rebased
 * frame uBendCenter lives in.
 *
 * Rendered ONLY while mapStyle === 'satellite' AND SAT_SKYLINE.enabled AND
 * tier ≥ medium (the FlyScene gate — the same &&-chain the buildings and roads
 * take), so when off the component never mounts: no worker, no engine, no
 * draws, no globals, and SAT_SKYLINE.enabled:false is a genuine byte-noop.
 *
 * The tier ALSO caps the group count (SAT_SKYLINE.maxChunksByTier): a phone
 * resolves to 'medium' pre-mount (R16's isPhoneClass floor) and gets 6 groups
 * instead of 10.
 *
 * Dev introspection: window.__satSkyline (engine — .stats mirrors the
 * __satBuildings idiom) + __flyStats.satSkyline. NEVER __toyWorld
 * (verify-round11 gate A asserts the toy pipeline is not built in satellite).
 *
 * DRAW LEDGER: ≤ maxChunksByTier[tier] draws, one merged mesh per non-empty
 * group. An EMPTY group issues no mesh at all, so an empty scene (Owens Valley)
 * costs exactly zero — the round's strictest invariant, pinned by
 * scripts/verify-skyline.js alongside verify-sat-depth's total.
 */
export function SatSkylineLayer({ runtime, flight }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const engine = useMemo(
    () => new SatSkylineEngine({ groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat) }),
    [runtime]
  );
  // Frame-loop timing lives in refs (never mutate the memoized engine in render
  // — react-hooks/purity); the warp subscription reads the current clock here.
  const nowRef = useRef(0);
  const statsAtRef = useRef(0);

  // Tier → group cap. Dropping to a smaller cap evicts the surplus on the next
  // refresh; 0 (low) evicts everything immediately. No re-stream on a raise —
  // the desired set just grows.
  useEffect(() => {
    engine.setMaxChunks(SAT_SKYLINE.maxChunksByTier[qualityTier] ?? 0);
  }, [engine, qualityTier]);

  useEffect(() => {
    const worker = new Worker(
      new URL('../../lib/fly/toy-world/vector-tile.worker.js', import.meta.url),
      { type: 'module' }
    );
    const api = wrap(worker);
    api.init().catch((err) => {
      if (process.env.NODE_ENV === 'development')
        console.warn('[sat-skyline] TileJSON init failed:', err?.message ?? err);
    });
    engine.setWorker(api);
    if (process.env.NODE_ENV === 'development') window.__satSkyline = engine; // harness introspection
    return () => {
      engine.dispose();
      worker.terminate();
      if (process.env.NODE_ENV === 'development') delete window.__satSkyline;
    };
  }, [engine, runtime]);

  // A warp re-arms the desired set immediately and opens the accept-coarse-DEM
  // window, so the destination city's mass streams instead of waiting out the
  // move/time cadence over ground the player already left.
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
    const t = clock.elapsedTime;
    nowRef.current = t;
    const eyeAgl = eyeAglVis(runtime, flight); // R24 B (GROUND_VIS)
    // groundElev rides along as the fallback for far DEM samples that have not
    // streamed yet — sea level would sink a mountain city's skyline.
    engine.update(t, flight.pos.x, flight.pos.z, eyeAgl, flight.groundElev);
    if (
      process.env.NODE_ENV === 'development' &&
      window.__flyStats &&
      t - statsAtRef.current > 0.25
    ) {
      statsAtRef.current = t;
      window.__flyStats.satSkyline = engine.stats;
      window.__flyStats.satSkylineMix = getSatSkyline(); // live hole radius + fade
    }
  }, -45);

  return <primitive object={engine.object} />;
}

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { SatSkylineEngine } from '@/lib/fly/toy-world/sat-skyline-engine';
import { SAT_SKYLINE, SETTLE_CALM } from '@/lib/fly/fly-constants';
import { getSatSkyline, setSatSkyline } from '@/lib/fly/toy-world/world-bend';
import {
  applyUniformBirth,
  arrivalEpoch,
  birthK,
  groundElevVis,
  makeBirth,
  makeUniformBirth,
  notePopin,
} from '@/lib/fly/settle';
import { useFlyStore } from '@/stores/fly-store';

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
  // R22 (B SETTLE) — the distant mass births on its OWN Bayer term (uSkyFade),
  // the same mechanism and the same 0-gated identity as the near ring. No new
  // shader, no new cache key.
  const birthRef = useRef(makeBirth());
  const fadeRef = useRef(makeUniformBirth());

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
    // R22 (B): the VISUAL ground elevation drives the skyline's own AGL fade
    // and the hole choreography, so a DEM refining under the aircraft no longer
    // sweeps the crossfade between the detail city and the distant mass.
    const gVis = groundElevVis(runtime, flight);
    const eyeAgl = Math.max(0, flight.pos.y - gVis);
    // groundElev rides along as the fallback for far DEM samples that have not
    // streamed yet — sea level would sink a mountain city's skyline.
    engine.update(t, flight.pos.x, flight.pos.z, eyeAgl, gVis);
    const ready = engine.stats.ready;
    const k = birthK(
      birthRef.current,
      t,
      ready > 0,
      arrivalEpoch(),
      SETTLE_CALM.births.bayerSec
    );
    if (k < 1) {
      const s = getSatSkyline();
      applyUniformBirth(fadeRef.current, s.fade, k, (v) =>
        setSatSkyline(s.holeRadiusM, s.holeFeatherM, v)
      );
    } else if (!Number.isNaN(fadeRef.current.lastWritten)) {
      const s = getSatSkyline();
      applyUniformBirth(fadeRef.current, s.fade, 1, (v) =>
        setSatSkyline(s.holeRadiusM, s.holeFeatherM, v)
      );
      fadeRef.current.lastWritten = Number.NaN;
    }
    notePopin('satSkyline', ready > 0, birthRef.current.running);
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

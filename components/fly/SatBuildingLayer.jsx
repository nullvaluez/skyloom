'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { SatBuildingEngine } from '@/lib/fly/toy-world/sat-building-engine';
import {
  PARCEL_HOMES,
  SAT_AMBIENT,
  SAT_BUILDINGS,
  SAT_COVERAGE,
  SAT_SHADOWS,
  SAT_TINT,
  SAT_VEG,
  SAT_WATER,
  SUBURB_NIGHT,
} from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';
import { SatVegLayer } from './SatVegLayer';
// R24 B (GROUND_VIS, recon A6/T8) — AGL fade bands read the DAMPED ground.
import { eyeAglVis } from '@/lib/fly/ground-vis';

const TIERS = ['low', 'medium', 'high']; // mirrors FlyCanvas's quality ladder
const atLeastTier = (tier, min) => TIERS.indexOf(tier) >= TIERS.indexOf(min);

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
  // Round 15: facade windows (daylight `map`, medium+) and NIGHT windows
  // (`emissiveMap`, high only) are material swaps on the SAME shared material —
  // zero extra draws, no re-stream. Each flip costs one shader compile, so they
  // ride tier changes (rare), never the frame loop.
  useEffect(() => {
    engine.setFacadeEnabled(
      SAT_BUILDINGS.facade.enabled && atLeastTier(qualityTier, SAT_BUILDINGS.facade.minTier)
    );
    engine.setNightWindowsEnabled(
      SAT_BUILDINGS.night.enabled && atLeastTier(qualityTier, SAT_BUILDINGS.night.minTier)
    );
  }, [engine, qualityTier]);
  // Round 19 (A HOMESTEAD, P2) — HIGH-TIER-ONLY coverage widen. The field
  // study found building coverage effectively zero outside downtown cores:
  // ring r 3600 / 12 chunks reaches ~4.8 km of tiles, and a suburb needs the
  // reach more than a downtown does. Medium/low resolve to null ⇒ the engine
  // falls back to the R18 SAT_BUILDINGS values and phones are byte-identical
  // (user decision 2). SAT_COVERAGE.enabled false does the same at high.
  useEffect(() => {
    engine.setCoverage(
      SAT_COVERAGE.enabled && qualityTier === 'high' ? SAT_COVERAGE.high : null
    );
  }, [engine, qualityTier]);
  // Round 19 — the two SAT_SHADOWS mesh flags for THIS layer's meshes (the
  // plan's per-layer rule; B DEEPFIELD owns the light rig and FlyScene's
  // castShadow gate, C does the same for SatVegLayer in W2). The runtime
  // override is the fleet pin from scripts/_boot.js: harnesses set it to 0 so
  // every frozen satellite pixel gate keeps seeing the pre-R19 frame, and
  // verify-aerial is the one harness that un-pins it. Optional-chained through
  // `window` so this never assumes B's work has landed.
  useEffect(() => {
    const pinnedOff =
      typeof window !== 'undefined' && window.__flySatShadowOverride === 0;
    engine.setShadows(
      SAT_SHADOWS.enabled && qualityTier === SAT_SHADOWS.minTier && !pinnedOff
    );
  }, [engine, qualityTier]);
  // Frame-loop timing lives in refs (never mutate the memoized engine in render —
  // react-hooks/purity); the warp subscription reads the current clock from here.
  const nowRef = useRef(0);
  const statsAtRef = useRef(0);

  // Round 18 (A1) — publish the engine on the runtime bus (the RUNTIME
  // CONTRACTS (R18) block in FlyScene). A5 GRAVITY's crash system calls
  // runtime.satBuildings?.queryColumns(px, pz, r) for building collision, and
  // it does so on PRODUCTION paths — which is why this is NOT the dev-only
  // window.__satBuildings global below. Off-satellite, at low tier, or with
  // SAT_BUILDINGS.enabled false this layer never mounts and the field stays
  // null, so the caller needs no style test. Mount-time is enough: the engine
  // is memoized ON `runtime`, so a new runtime always brings a new engine and
  // re-runs this. Cleared on unmount, guarded on identity so a StrictMode
  // double-mount can't null out the live engine.
  //
  // `runtime` IS a prop, so react-hooks/immutability objects — but the whole
  // point of the object is that it is the scene's mutable cross-component bus
  // (ToyWorldLayer's runtime.toyStats, TrafficLayer's runtime.modelsReady,
  // FlyCanvas's runtime.framesRendered all write it the same way). Disabled
  // narrowly, on the one synchronous line, rather than silently. (The rule
  // only analyses the effect body — the deferred cleanup below needs none.)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- runtime is the scene's mutable bus (FlyScene RUNTIME CONTRACTS (R18))
    runtime.satBuildings = engine;
    return () => {
      if (runtime.satBuildings === engine) runtime.satBuildings = null;
    };
  }, [engine, runtime]);

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
    const eyeAgl = eyeAglVis(runtime, flight); // R24 B (GROUND_VIS)
    // Windows light up as the sun goes down (runtime.sun is the R13 day cycle,
    // republished on a 60s cadence — this just reads it; one uniform write).
    engine.setNightMix(runtime.sun?.frac);
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

  return (
    <>
      <primitive object={engine.object} />
      {/* Round 18 (A3 "GROUNDSKEEPER"): the living ground — pooled canopies plus
          the two data-anchored ambient movers. Mounted HERE rather than from
          FlyScene because it wants exactly this gate (satellite, tier >= medium,
          inside worldRoot so its meshes ride the -anchor rebase into the
          uBendCenter frame) and A3 owns only these mount lines this wave.
          EITHER flag alone keeps the shared 'sat-veg' streamer alive: the worker
          emits the canopies and the mover anchor points in ONE bundle, so
          SatVegLayer owns the streamer and SatAmbientLife reads its chunks.
          Both flags false = no mount, no worker, no draws, no globals.
          Round 19 (C "GROUNDTRUTH") extended the SAME rule to two more
          consumers of that one bundle — the landcover tint (satTint polys) and
          the suburban house lights (residential scatter points). They are
          mounted inside SatVegLayer, so their flags belong in this gate too:
          any ONE of the four keeps the streamer alive, all four false is still
          no mount, no worker, no draws, no globals. */}
      {/* Round 20 (B): PARCEL_HOMES joins the same any-one-of gate — its
          anchors ride the same 'sat-veg' bundle, so it is a fifth consumer of
          this one streamer, and with all five off it is still no mount, no
          worker, no draws, no globals. */}
      {(SAT_VEG.enabled ||
        SAT_AMBIENT.enabled ||
        SAT_TINT.enabled ||
        SUBURB_NIGHT.enabled ||
        PARCEL_HOMES.enabled) && <SatVegLayer runtime={runtime} flight={flight} />}
    </>
  );
}

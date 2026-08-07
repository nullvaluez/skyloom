'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import {
  AdditiveBlending,
  DynamicDrawUsage,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { SatRoadEngine } from '@/lib/fly/toy-world/sat-road-engine';
import { buildPoiList } from '@/lib/fly/poi-data';
import { SAT_AIRPORT_BEACONS, SAT_ROADS } from '@/lib/fly/fly-constants';
import { applyBendAnchor, getSatBldgFade, getSatRoadMix } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const TIERS = ['low', 'medium', 'high']; // mirrors FlyCanvas's quality ladder
const atLeastTier = (tier, min) => TIERS.indexOf(tier) >= TIERS.indexOf(min);

const _dummy = new Object3D();
// Pool size is fixed at mount (an InstancedMesh cannot grow); `mesh.count`
// parks the draw entirely when nothing is in range.
const BEACON_POOL = SAT_AIRPORT_BEACONS.pool;

/**
 * Round 16 (A4 "GND-C") — mounts the SATELLITE ground-light network: the
 * SatRoadEngine chunk streamer (roads + baked runway edge lights) plus the
 * airport-beacon pool. Structurally SatBuildingLayer: its OWN worker instance,
 * its own update loop (priority -46: after the flight/bend at -50 and beside
 * the building loop at -47), a warp subscription, StrictMode-symmetric dispose.
 *
 * Rendered ONLY while mapStyle === 'satellite' AND SAT_ROADS.enabled AND
 * tier ≥ medium (the FlyScene gate), so when off the component never mounts:
 * no worker, no engine, no draws, no globals. Lives INSIDE worldRoot — the
 * engine's chunk meshes sit at ABSOLUTE tile centers (like the building
 * chunks), so worldRoot's -anchor translation is what puts them in the same
 * rebased frame uBendCenter lives in.
 *
 * Dev introspection: window.__satRoads (engine) + window.__satBeacons (the
 * beacon InstancedMesh) + __flyStats.satRoads / .satBeacons. NEVER __toyWorld
 * (verify-round11 gate A asserts the toy pipeline is not built in satellite).
 *
 * DRAW LEDGER: ≤ SAT_ROADS.maxChunks road draws + at most ONE beacon draw.
 * Nothing here is sun-gated at the DRAW level — the sun only writes uniforms
 * (roads) and one material property (beacons), so the draw count is identical
 * at noon and at midnight (verify-sat-night gate B).
 */
export function SatRoadLayer({ runtime, flight }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const engine = useMemo(
    () => new SatRoadEngine({ groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat) }),
    [runtime]
  );
  // Frame-loop timing lives in refs (never mutate the memoized engine in render
  // — react-hooks/purity); the warp subscription reads the current clock here.
  const nowRef = useRef(0);
  const statsAtRef = useRef(0);

  // --- airport beacons -------------------------------------------------------
  // A STRICT high-tier flourish (mirrors how SatBuildingLayer gates the facade
  // atlas). Below it the mesh is never created → zero draws, zero placement.
  const beaconsOn = SAT_AIRPORT_BEACONS.enabled && atLeastTier(qualityTier, SAT_AIRPORT_BEACONS.minTier);
  const airports = useMemo(() => buildPoiList().filter((p) => p.kind === 'airport'), []);
  const beaconRef = useRef(null);
  const beaconGeometry = useMemo(() => new SphereGeometry(1, 8, 6), []);
  const beaconMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({
      color: SAT_AIRPORT_BEACONS.white,
      transparent: true,
      opacity: 0, // the flash envelope owns this from the first frame
      blending: AdditiveBlending,
      depthWrite: false,
    });
    // Rigid instanced GROUND objects must ride the ANCHOR bend, never the
    // per-vertex one (round-6 lesson 2) — same variant TownGlow uses, unmodified
    // (no new program cache key).
    applyBendAnchor(m);
    return m;
  }, []);
  // Placement + the night ramp run on the 2s cadence; only the flash envelope is
  // per frame. `half` is the discrete white/green side of the period — the ONLY
  // thing that ever writes material.color, and only when it flips (~0.6 Hz).
  const beaconRefs = useRef({ t: -Infinity, placed: 0, nightK: 0, half: -1 });
  useEffect(
    () => () => {
      beaconGeometry.dispose();
      beaconMaterial.dispose();
    },
    [beaconGeometry, beaconMaterial]
  );

  useEffect(() => {
    const worker = new Worker(
      new URL('../../lib/fly/toy-world/vector-tile.worker.js', import.meta.url),
      { type: 'module' }
    );
    const api = wrap(worker);
    api.init().catch((err) => {
      if (process.env.NODE_ENV === 'development')
        console.warn('[sat-roads] TileJSON init failed:', err?.message ?? err);
    });
    engine.setWorker(api);
    if (process.env.NODE_ENV === 'development') window.__satRoads = engine; // harness introspection
    return () => {
      engine.dispose();
      worker.terminate();
      if (process.env.NODE_ENV === 'development') delete window.__satRoads;
    };
  }, [engine, runtime]);

  // A warp opens the accept-coarse-fast window so the destination city's road
  // web pops in instead of waiting out the full DEM-quality hold.
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
    const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
    // sunFrac is REQUIRED by the engine contract: omitting it falls back to noon
    // (1) and the whole network stays dark forever.
    engine.update(t, flight.pos.x, flight.pos.z, eyeAgl, runtime.sun?.frac);

    // --- beacons: 2s placement + night ramp, per-frame flash envelope --------
    const mesh = beaconRef.current;
    if (mesh) {
      const P = SAT_AIRPORT_BEACONS;
      const st = beaconRefs.current;
      if (t - st.t >= SAT_ROADS.refreshSec) {
        st.t = t;
        // γ night ramp — the EXACT SAT_BUILDINGS.night / SAT_ROADS.night shape,
        // so beacons, road glow and window lights all arrive together at dusk.
        const nt = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / P.dayFrac));
        st.nightK = nt ** P.gamma;
        // Placement is RANGE-only (never sun-gated): the draw count must not
        // move with the clock. Nearest-win into the fixed pool.
        const px = flight.pos.x;
        const pz = flight.pos.z;
        const near = [];
        for (const a of airports) {
          const d = Math.hypot(a.wx - px, a.wz - pz);
          if (d > P.rangeM) continue;
          near.push({ a, d });
        }
        near.sort((x, y) => x.d - y.d);
        const fs = P.farScale;
        let n = 0;
        for (const { a, d } of near) {
          if (n >= BEACON_POOL) break;
          let ft = Math.min(1, Math.max(0, (d - fs.startM) / (fs.endM - fs.startM)));
          ft = ft * ft * (3 - 2 * ft); // smoothstep
          const r = P.sizeM * (1 + (fs.mul - 1) * ft);
          // RAW DEM ground (no toy exaggeration — the R11 monuments lesson).
          // A null/coarse sample parks the beacon at sea level for one cadence;
          // it heals on the next pass, and additive glow hides the transient.
          const s = runtime.engine?.getGroundAt?.(a.lon, a.lat);
          // ABSOLUTE world XZ: this mesh lives inside worldRoot, whose -anchor
          // translation puts it in the same rebased frame as uBendCenter.
          _dummy.position.set(a.wx, (s?.elev ?? 0) + P.liftM, a.wz);
          _dummy.scale.setScalar(r);
          _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix();
          mesh.setMatrixAt(n, _dummy.matrix);
          n += 1;
        }
        st.placed = n;
        mesh.count = n; // 0 = the draw is parked entirely (three skips primcount 0)
        mesh.instanceMatrix.needsUpdate = true;
        // No per-instance color: every beacon flashes the SAME hue, so the
        // shared material.color carries it (one write per flip, no attribute).
      }
      // ONE material property write per frame: the flash envelope. A real
      // beacon FLASHES — lit for `flashFrac` of each half-period, dark between.
      const phase = (t % P.periodSec) / P.periodSec; // 0..1 over white+green
      const half = phase < 0.5 ? 0 : 1; // 0 = white flash, 1 = green flash
      const local = (phase - half * 0.5) / 0.5; // 0..1 inside this half
      const env =
        local < P.flashFrac ? Math.sin((local / P.flashFrac) * Math.PI) : 0;
      mesh.material.opacity = env * st.nightK;
      if (half !== st.half) {
        st.half = half; // discrete flip only (~0.6 Hz), never per frame
        mesh.material.color.set(half === 0 ? P.white : P.green);
      }
    }

    if (
      process.env.NODE_ENV === 'development' &&
      window.__flyStats &&
      t - statsAtRef.current > 0.25
    ) {
      statsAtRef.current = t;
      const stats = window.__flyStats;
      stats.satRoads = engine.stats;
      stats.satRoadMix = getSatRoadMix(); // day/night uniform mix (gate B)
      // The SATELLITE BUILDING cull-fade uniform, surfaced for verify-sat-night
      // gate E. It is owned + written by SatBuildingEngine (A2); this only READS
      // it back through the world-bend accessor — the two satellite ground
      // layers share a frame loop cadence, so this is the cheapest place to
      // publish it without touching the building layer.
      stats.satBldgFade = getSatBldgFade();
      stats.satBeacons = {
        placed: beaconRefs.current.placed,
        nightK: beaconRefs.current.nightK,
        on: beaconsOn,
      };
    }
  }, -46);

  return (
    <>
      <primitive object={engine.object} />
      {beaconsOn && (
        <instancedMesh
          ref={(m) => {
            beaconRef.current = m;
            // R21 SANCTIONED BUGFIX (C, P7 — unflagged, R20 D-CERT precedent).
            // An inline ref callback re-attaches on EVERY re-render of this
            // component, and FlyScene re-renders for entirely ordinary reasons
            // (hovering a plane, a contract tick, a panel opening). `count = 0`
            // below therefore wiped the whole beacon field on each of them —
            // and unlike the boats, placement here only runs on the 2 s
            // cadence, so the airport lights stayed BLANK for up to two
            // seconds every time. This is the SatVegLayer latch idiom
            // (`__satVegInit`, whose comment documents the same hazard) and it
            // cannot change settled-state output: it only stops a re-render
            // from undoing a pass that already ran.
            if (m && !m.userData.__satBeaconInit) {
              m.userData.__satBeaconInit = true;
              m.instanceMatrix.setUsage(DynamicDrawUsage);
              m.frustumCulled = false; // instances span the ring; the unit bound lies
              m.renderOrder = 4; // additive, after the road ribbons (renderOrder 3)
              m.count = 0; // parked until the first placement pass
              beaconRefs.current.t = -Infinity; // …which is the very next frame
            }
            if (process.env.NODE_ENV === 'development') {
              if (m) window.__satBeacons = m;
              else delete window.__satBeacons;
            }
          }}
          args={[beaconGeometry, beaconMaterial, BEACON_POOL]}
        />
      )}
    </>
  );
}

'use client';
/* eslint-disable react-hooks/immutability -- Three.js buffers, materials and the shared flight runtime are imperative simulation objects, updated by useFrame without React renders. */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, Quaternion, Vector3 } from 'three';
import { AIRCRAFT_EFFECTS as FX, smokeStations, wakeDensity, wingVaporStrength } from '@/lib/fly/aircraft-effects';
import { WakeBatch, WakeHistory } from '@/lib/fly/aircraft-wake';
import { registerSkyOverlay } from '@/lib/fly/sky-overlay-pass';
import { patchAirWake } from '@/lib/fly/tracer-spot';
import { useTitleHidden } from '@/lib/fly/front-door';
import { useFlyStore } from '@/stores/fly-store';

const attitude = new Euler(0, 0, 0, 'YXZ'), rotation = new Quaternion(), emitter = new Vector3();

/** Each sample owns its density, age and wind. Descending leaves a dissipating
 * wake; all engine stations rotate in three axes with the aircraft.
 * MULTIPLAYER: while `runtime.mp.smoke` is on the same stations trail airshow
 * smoke at density 1. An engine-less type (mounted only when multiplayer is
 * available) owns one tail station and records nothing unless smoking. */
export function Contrail({ flight, origin, aircraft, runtime }) {
  const titleHidden = useTitleHidden();
  const id = aircraft?.id ?? 'fighter';
  const state = useMemo(() => {
    // A jet's smoke stations ARE its engine array (playerEngineOffsets).
    const engines = smokeStations(id);
    return { time: 0, engines, histories: engines.map(() => new WakeHistory()),
      tips: [new WakeHistory(80, FX.vaporLifeSec), new WakeHistory(80, FX.vaporLifeSec)],
      batch: new WakeBatch(engines.length + 2, FX.points, patchAirWake) };
  }, [id]);
  const warpEpoch = useFlyStore(s => s.warpEpoch);
  useEffect(() => { for (const h of [...state.histories, ...state.tips]) h.clear(); }, [state, warpEpoch]);
  // Depth-less vapor against the sky: drawn after the cloud composite.
  useEffect(() => registerSkyOverlay(state.batch.mesh), [state]);
  useEffect(() => () => {
    state.batch.dispose();
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      delete window.__flyStats.aircraftWake;
      window.__flyStats.contrailPts = 0;
    }
  }, [state]);

  useFrame(({ camera }, delta) => {
    const store = useFlyStore.getState();
    const held = store.phase === 'paused' || store.screen !== 'flight' || runtime?.worldLoading ||
      store.atlasOpen || store.logbookOpen || store.inspectHex || document.hidden;
    if (!held) state.time += Math.min(delta, .1);
    const now = state.time, visual = flight.aircraftVisual;
    rotation.setFromEuler(attitude.set(flight.pitch, -flight.heading, -flight.bank));
    const density = wakeDensity(id, runtime?.mp?.smoke === true, flight.pos.y, flight.speed, flight.operations?.grounded);
    const wind = runtime?.weather?.wx;
    const windX = (wind?.windX ?? 0) * .35, windZ = (wind?.windZ ?? 0) * .35;
    // The measured stations (the Talon's two nacelles feed its ONE wake), unless
    // the airframe publishes fewer than it trails — none: the smoke tail.
    const stations = visual?.id === id && visual.engines.length >= state.engines.length ? visual.engines : state.engines;
    for (let e = 0; e < state.histories.length; e++) {
      emitter.fromArray(stations[e]).applyQuaternion(rotation).add(flight.pos);
      if (!held) state.histories[e].record(emitter.x, emitter.y, emitter.z, now, density,
        Math.max(FX.spacingM, flight.speed * FX.sampleSec), windX, windZ);
    }
    const vapor = aircraft?.afterburner?.enabled ? wingVaporStrength(flight) : 0;
    for (let e = 0; e < 2; e++) {
      const tip = visual?.id === id ? visual.tips[e] : [(e ? 1 : -1) * 8, 0, 0];
      emitter.fromArray(tip).applyQuaternion(rotation).add(flight.pos);
      if (!held) state.tips[e].record(emitter.x, emitter.y, emitter.z, now, vapor, Math.max(6, flight.speed * .06), windX, windZ);
    }
    state.batch.begin(camera,!!runtime?.cinemaEnvironment&&store.mapStyle==='satellite');
    for (const h of state.histories) state.batch.add(h, now, origin.anchor);
    for (const h of state.tips) state.batch.add(h, now, origin.anchor,
      { width: FX.vaporWidthM, spread: FX.vaporSpreadMps, opacity: .65 });
    state.batch.end(runtime?.sun?.frac ?? 1, store.mapStyle === 'toy', runtime?.cinemaEnvironment);
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.contrailPts = state.histories.reduce((n, h) => n + h.count, 0);
      window.__flyStats.aircraftWake = { engines: state.histories.length, ribbons: state.batch.used,
        points: window.__flyStats.contrailPts, density, vapor, gear: flight.operations?.gear ?? 0 };
    }
  }, -20);
  return <group visible={!titleHidden}><primitive object={state.batch.mesh} dispose={null} /></group>;
}

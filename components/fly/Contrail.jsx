'use client';
/* eslint-disable react-hooks/immutability -- Three.js buffers, materials and the shared flight runtime are imperative simulation objects, updated by useFrame without React renders. */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, Quaternion, Vector3 } from 'three';
import { AIRCRAFT_EFFECTS as FX, playerEngineOffsets, wingVaporStrength } from '@/lib/fly/aircraft-effects';
import { WakeBatch, WakeHistory } from '@/lib/fly/aircraft-wake';
import { registerSkyOverlay } from '@/lib/fly/sky-overlay-pass';
import { patchAirWake } from '@/lib/fly/tracer-spot';
import { useTitleHidden } from '@/lib/fly/front-door';
import { useFlyStore } from '@/stores/fly-store';
// LIVING WORLD (SKY_TRAILS): your own trail persists behind you for minutes.
import { SkyTrails, trailPersistence } from '@/lib/fly/fleet-trails';
import { SKY_VIEW } from '@/lib/fly/observation-config';
import { SKY_TRAILS_ON, SKY_TRAILS_CFG, applyFlightTrailFades, livingContrailStrength, skyTrailLight, skyTrailWind } from '@/lib/fly/sky-trails';
import { mercatorScale } from '@/lib/fly/coords';

const attitude = new Euler(0, 0, 0, 'YXZ'), rotation = new Quaternion(), emitter = new Vector3();
const _src = new Vector3(), _wind = { x: 0, z: 0 };

/** Each sample owns its density, age and wind. Descending leaves a dissipating
 * wake; all engine stations rotate in three axes with the aircraft. */
export function Contrail({ flight, origin, aircraft, runtime }) {
  const titleHidden = useTitleHidden();
  const id = aircraft?.id ?? 'fighter';
  const state = useMemo(() => {
    const engines = playerEngineOffsets(id);
    return { time: 0, engines, histories: engines.map(() => new WakeHistory(FX.points, SKY_TRAILS_ON ? SKY_TRAILS_CFG.nearLifeSec : FX.lifeSec)),
      tips: [new WakeHistory(80, FX.vaporLifeSec), new WakeHistory(80, FX.vaporLifeSec)],
      batch: new WakeBatch(engines.length + 2, FX.points, patchAirWake),
      // SKY_TRAILS: one persistent trail for the aircraft (the engine plumes
      // are its early lobes), fed from the engines' centre.
      sky: SKY_TRAILS_ON && engines.length ? new SkyTrails({ maxTrails: 1, points: SKY_VIEW.points, flight: true }) : null,
      span: engines.reduce((m, e) => Math.max(m, Math.abs(e[0])), 1.5), prev: null, vel: new Vector3(), velDt: 0 };
  }, [id]);
  const warpEpoch = useFlyStore(s => s.warpEpoch);
  useEffect(() => { for (const h of [...state.histories, ...state.tips]) h.clear(); state.sky?.clear(); state.prev = null; }, [state, warpEpoch]);
  // Depth-less vapor against the sky: drawn after the cloud composite.
  useEffect(() => registerSkyOverlay(state.batch.mesh), [state]);
  useEffect(() => (state.sky ? registerSkyOverlay(state.sky.mesh) : undefined), [state]);
  useEffect(() => () => {
    state.batch.dispose();
    state.sky?.dispose();
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      delete window.__flyStats.aircraftWake;
      window.__flyStats.contrailPts = 0;
    }
  }, [state]);

  useFrame(({ camera, gl }, delta) => {
    state.renderer = gl;
    const store = useFlyStore.getState();
    const held = store.phase === 'paused' || store.screen !== 'flight' || runtime?.worldLoading ||
      store.atlasOpen || store.logbookOpen || store.inspectHex || document.hidden;
    if (!held) state.time += Math.min(delta, .1);
    const now = state.time, visual = flight.aircraftVisual;
    rotation.setFromEuler(attitude.set(flight.pitch, -flight.heading, -flight.bank));
    const wind = runtime?.weather?.wx;
    const density = livingContrailStrength(flight.pos.y, flight.speed, flight.operations?.grounded, wind);
    const windX = (wind?.windX ?? 0) * .35, windZ = (wind?.windZ ?? 0) * .35;
    const stations = visual?.id === id ? visual.engines : state.engines;
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
    if (state.sky) playerSkyTrail(state, flight, origin, camera, store, runtime, density, held, stations, delta);
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.contrailPts = state.histories.reduce((n, h) => n + h.count, 0);
      window.__flyStats.aircraftWake = { engines: state.histories.length, ribbons: state.batch.used,
        points: window.__flyStats.contrailPts, density, vapor, gear: flight.operations?.gear ?? 0 };
    }
  }, -20);
  return <group visible={!titleHidden}>
    <primitive object={state.batch.mesh} dispose={null} />
    {state.sky && <primitive object={state.sky.mesh} dispose={null} />}
  </group>;
}

/**
 * SKY_TRAILS: the player's persistent trail. Wall-clock ageing (it spreads
 * and drifts while you pause, as the traffic's do); fed only while flying.
 * Velocity comes from the position itself, smoothed, so the trail's dead
 * reckoning between feeds follows the aircraft through turns and climbs.
 */
function playerSkyTrail(state, flight, origin, camera, store, runtime, density, held, stations, delta) {
  const sky = state.sky, now = performance.now() / 1000;
  const on = !!runtime?.cinemaEnvironment && store.mapStyle === 'satellite' && (SKY_TRAILS_CFG.maxTrails[store.qualityTier] ?? 0) > 0;
  if (!on) { if (sky.stats.trails) sky.clear(); sky.mesh.visible = false; state.prev = null; return; }
  const renderer = state.renderer;
  if (!held && delta > 0) {
    _src.set(0, 0, 0);
    for (const st of stations) _src.add(emitter.fromArray(st).applyQuaternion(rotation));
    _src.multiplyScalar(1 / Math.max(1, stations.length)).add(flight.pos);
    if (state.prev) {
      const k = Math.min(1, delta * 4);
      state.vel.lerp(emitter.subVectors(_src, state.prev).multiplyScalar(1 / Math.max(1e-3, delta)), state.velDt ? k : 1);
      state.velDt = 1;
    }
    state.prev = (state.prev ?? new Vector3()).copy(_src);
    const kSite = runtime.cinemaGeography?.worldUnitsPerMetre ?? mercatorScale(flight.latDeg || 0);
    skyTrailWind(runtime.weather?.wx, kSite, _wind);
    const life = SKY_TRAILS_CFG.playerLifeSec ?? trailPersistence(flight.pos.y, Math.floor(Date.now() / 3600000));
    if (density > 0.003 || sky.byHex.has('player'))
      sky.feed('player', _src, state.vel, density * SKY_VIEW.density, now, _wind, { engine: state.span, life, backfillSec: 0 });
  }
  sky.rebase(origin.anchor);
  applyFlightTrailFades(sky);
  if (renderer) sky.end(now, skyTrailLight(runtime, camera, renderer, store.qualityTier));
}

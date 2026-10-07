'use client';
/* eslint-disable react-hooks/immutability -- Three.js buffers, materials and the shared flight runtime are imperative simulation objects, updated by useFrame without React renders. */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, Quaternion, Vector3 } from 'three';
import { LIVE_AIRCRAFT, resolveLiveAircraft } from '@/lib/fly/live-aircraft';
import { AIRCRAFT_EFFECTS as FX, contrailStrength, liveEngineOffsets, smokeStations, wakeDensity } from '@/lib/fly/aircraft-effects';
import { WakeBatch, WakeHistory } from '@/lib/fly/aircraft-wake';
import { registerSkyOverlay } from '@/lib/fly/sky-overlay-pass';
import { patchAirWake } from '@/lib/fly/tracer-spot';
import { F as MP_FLAG } from '@/lib/fly/mp/protocol.mjs';
import { useFlyStore } from '@/stores/fly-store';

const stations = LIVE_AIRCRAFT.map(liveEngineOffsets);
// Unknown types use only established jet archetypes; props, rotorcraft and
// unknown blobs never acquire fictional jet exhausts.
const fallback = { 0: [[-10, -2, 2], [10, -2, 2]], 1: [[-1.5, 0, 7], [1.5, 0, 7]],
  4: [[0, 0, 7]], 5: [[-12, -3, 3], [12, -3, 3], [-21, -2, 8], [21, -2, 8]],
  10: [[0, 0, 5.4]] };
const noSources = [];
const attitude = new Euler(0, 0, 0, 'YXZ'), rotation = new Quaternion(), emitter = new Vector3();
function sources(t) {
  // MULTIPLAYER: a remote pilot's wake leaves its own airframe — the engines, or
  // the tail of an engine-less type, which only ever trails smoke. Memoized per
  // aircraft id (a jet's is its engine array): a rec resets when this changes.
  if (t.remote === true) return smokeStations(t.meta?.aircraftId);
  // Military is a mission class, not an engine type. The shared military GLB
  // must not give a reported turboprop transport a jet's exhaust.
  if (/^(C130|C30J|C160|A400|C27J|C295|P3|E2|PC21|PC9|T6)/.test(t.meta?.t ?? '')) return noSources;
  const index = resolveLiveAircraft(t.meta, t.archetype);
  return index == null ? fallback[t.archetype] ?? noSources : stations[index];
}
// Condensation; a remote pilot's smoke (protocol F.SMOKE, a state) is density 1.
function densityOf(t, speed) {
  return t.remote === true ? wakeDensity(t.meta?.aircraftId, (t.mpFlags & MP_FLAG.SMOKE) !== 0, t.ry, speed, t.flags & 1)
    : contrailStrength(t.ry, speed, t.flags & 1);
}

/** Optical engine plumes in addition to the established navigation tracers.
 * ONE bounded draw for the whole fleet; distant/unknown traffic stays cheap.
 * Records contain no aircraft metadata and are retired when the track leaves. */
export function TrafficContrails({ runtime, origin }) {
  const state = useMemo(() => ({ time: 0, recs: new Map(), pool: [],
    batch: new WakeBatch(FX.maxTraffic.high * 4, 96, patchAirWake) }), []);
  useEffect(() => {
    // Depth-less vapor against the sky: drawn after the cloud composite.
    const unregister = registerSkyOverlay(state.batch.mesh);
    return () => { unregister(); state.batch.dispose(); };
  }, [state]);
  useFrame(({ camera }, delta) => {
    const store = useFlyStore.getState(), items = runtime.traffic?.items ?? [];
    const dt = document.hidden ? 0 : Math.min(delta, .1);
    state.time += dt;
    const now = state.time, limit = FX.maxTraffic[store.qualityTier] ?? FX.maxTraffic.medium;
    // Preserve admitted tracks through a small range band so equal-distance
    // neighbours cannot trade slots and erase one another's histories.
    const eligible = items.filter(t => t.fix1 && t.distM < (state.recs.has(t.hex) ? 26000 : 22000) &&
      (t.opacity ?? 1) * (t.horizonFade ?? 1) > .03 &&
      (densityOf(t, Math.hypot(t.fix1.vE, t.fix1.vN)) > .003 || state.recs.has(t.hex)) && sources(t).length);
    eligible.sort((a, b) => (a.distM - (state.recs.has(a.hex) ? 1800 : 0)) - (b.distM - (state.recs.has(b.hex) ? 1800 : 0)));
    const chosen = eligible.slice(0, limit), seen = new Set(chosen.map(t => t.hex));
    for (const [hex, rec] of state.recs) if (!seen.has(hex)) {
      for (const h of rec.histories) { h.clear(); if (state.pool.length < FX.maxTraffic.high * 4) state.pool.push(h); }
      state.recs.delete(hex);
    }
    const wind = runtime.weather?.wx, wx = (wind?.windX ?? 0) * .35, wz = (wind?.windZ ?? 0) * .35;
    state.batch.begin(camera,!!runtime.cinemaEnvironment&&store.mapStyle==='satellite');
    for (const t of chosen) {
      const offsets = sources(t), fix = t.fix1, speed = Math.hypot(fix.vE, fix.vN);
      const density = densityOf(t, speed);
      let rec = state.recs.get(t.hex);
      // A remote pilot's warp / respawn (snapEpoch bump) starts a new wake; ADS-B: both undefined.
      if (rec && (rec.sources !== offsets || rec.snap !== t.snapEpoch)) {
        for (const h of rec.histories) { h.clear(); state.pool.push(h); }
        state.recs.delete(t.hex); rec = null;
      }
      const fresh = !rec;
      if (fresh) { rec = { sources: offsets, snap: t.snapEpoch, histories: offsets.map(() => state.pool.pop() ?? new WakeHistory(96)) }; state.recs.set(t.hex, rec); }
      // A remote pilot transmits real attitude; ADS-B pitch is derived.
      rotation.setFromEuler(attitude.set(t.remote === true ? t.pitch : speed > 20 ? Math.atan2(fix.vUp, speed) : 0, -t.yaw, -t.bank));
      const k = Number.isFinite(fix.latRad) ? 1 / Math.cos(fix.latRad) : 1;
      for (let e = 0; e < offsets.length; e++) {
        const h = rec.histories[e];
        emitter.fromArray(offsets[e]).applyQuaternion(rotation);
        emitter.x = emitter.x * t.scaleK + t.rx;
        emitter.y += t.ryd;
        emitter.z = emitter.z * t.scaleK + t.rz;
        // A newly observed cruising jet has been flying already. Seed a short
        // velocity-estimated wake (visual only, like the existing tracers),
        // then replace it with recorded positions. Never backfill ground or
        // upper-air gaps, and never pretend this is historical ADS-B data.
        // A remote pilot is seen live from its first frame: no seed.
        if (fresh && density > .003 && t.remote !== true) for (let j = 64; j > 0; j--) {
          const age = j * .32, climb = Math.max(-speed * .12, Math.min(speed * .12, fix.vUp));
          h.record(emitter.x - fix.vE * k * age, emitter.y - climb * age, emitter.z + fix.vN * k * age,
            now - age, density * contrailStrength(t.ry - climb * age, speed), 0, wx, wz);
        }
        if (dt > 0) h.record(emitter.x, emitter.y, emitter.z, now, t.stale === 2 ? 0 : density,
          Math.max(FX.spacingM, speed * .38), wx, wz);
        state.batch.add(h, now, origin.anchor, { opacity: (t.opacity ?? 1) * (t.horizonFade ?? 1) });
      }
    }
    state.batch.end(runtime.sun?.frac ?? 1, store.mapStyle === 'toy', runtime.cinemaEnvironment);
    if (process.env.NODE_ENV === 'development' && window.__flyStats)
      window.__flyStats.trafficWake = { aircraft: state.recs.size, ribbons: state.batch.used, capacity: limit, draws: state.batch.used ? 1 : 0 };
  }, -43);
  return <primitive object={state.batch.mesh} dispose={null} />;
}

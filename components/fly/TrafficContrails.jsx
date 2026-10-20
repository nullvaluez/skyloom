'use client';
/* eslint-disable react-hooks/immutability -- Three.js buffers, materials and the shared flight runtime are imperative simulation objects, updated by useFrame without React renders. */
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, Quaternion, Vector2, Vector3 } from 'three';
import { LIVE_AIRCRAFT, resolveLiveAircraft, resolveLiveType } from '@/lib/fly/live-aircraft';
import { AIRCRAFT_EFFECTS as FX, contrailStrength, liveEngineOffsets } from '@/lib/fly/aircraft-effects';
import { WakeBatch, WakeHistory } from '@/lib/fly/aircraft-wake';
import { SkyTrails, trailPersistence } from '@/lib/fly/fleet-trails';
import { SKY_VIEW } from '@/lib/fly/observation-config';
import { registerSkyOverlay } from '@/lib/fly/sky-overlay-pass';
import { patchAirWake } from '@/lib/fly/tracer-spot';
import { getR25Sky } from '@/lib/fly/r25-sky';
import { useFlyStore } from '@/stores/fly-store';
// LIVING WORLD (SKY_TRAILS): the lounge's persistent trails, in flight too.
import { SKY_TRAILS_ON, SKY_TRAILS_CFG, applyFlightTrailFades, livingContrailStrength, skyTrailLight, skyTrailWind } from '@/lib/fly/sky-trails';
import { mercatorScale } from '@/lib/fly/coords';

const stations = LIVE_AIRCRAFT.map((f) => liveEngineOffsets(f));
// Unknown types use only established jet archetypes; props, rotorcraft and
// unknown blobs never acquire fictional jet exhausts.
const fallback = { 0: [[-10, -2, 2], [10, -2, 2]], 1: [[-1.5, 0, 7], [1.5, 0, 7]],
  4: [[0, 0, 7]], 5: [[-12, -3, 3], [12, -3, 3], [-21, -2, 8], [21, -2, 8]],
  10: [[0, 0, 5.4]] };
const noSources = [];
const attitude = new Euler(0, 0, 0, 'YXZ'), rotation = new Quaternion(), emitter = new Vector3();
const _buffer = new Vector2();
const _src = { x: 0, y: 0, z: 0 }, _vel = { x: 0, y: 0, z: 0 }, _wind = { x: 0, z: 0 };
function sources(t) {
  // Military is a mission class, not an engine type. The shared military GLB
  // must not give a reported turboprop transport a jet's exhaust.
  if (/^(C130|C30J|C160|A400|C27J|C295|P3|E2|PC21|PC9|T6)/.test(t.meta?.t ?? '')) return noSources;
  const index = resolveLiveAircraft(t.meta, t.archetype);
  return index == null ? fallback[t.archetype] ?? noSources : stations[index];
}

/** Optical engine plumes in addition to the established navigation tracers.
 * Flight: ONE bounded draw of short CPU ribbons (aircraft-wake.js).
 * Observation lounge: persistent GPU trails seen from the ground
 * (fleet-trails.js), every contrail-forming jet within SKY_VIEW.rangeM.
 * Records contain no aircraft metadata and are retired when the track leaves. */
export function TrafficContrails({ runtime, origin }) {
  const renderer = useThree((s) => s.gl);
  const state = useMemo(() => ({ time: 0, recs: new Map(), pool: [], chosen: [], chooseAt: 0, limit: null,
    batch: new WakeBatch(FX.maxTraffic.high * 4, 96, patchAirWake), sky: new SkyTrails(), observing: false, skyChosen: [],
    // SKY_TRAILS: a second, flight-mode batch (near and age fades), so the
    // lounge's own program and state stay exactly as they were.
    flightSky: SKY_TRAILS_ON ? new SkyTrails({ maxTrails: Math.max(...Object.values(SKY_TRAILS_CFG.maxTrails)), points: SKY_VIEW.points, flight: true }) : null,
    flightChosen: [], flightChooseAt: 0 }), []);
  // SKY_TRAILS: a warp starts the flight batch clean, so its local origin
  // (the first trail fed) restarts beside the aircraft instead of keeping
  // float32 positions thousands of kilometres from it.
  const warpEpoch = useFlyStore((s) => s.warpEpoch);
  useEffect(() => { state.flightSky?.clear(); state.flightChooseAt = 0; }, [state, warpEpoch]);
  useEffect(() => {
    // Depth-less vapor against the sky: drawn after the cloud composite.
    const unregister = registerSkyOverlay(state.batch.mesh);
    const unregisterSky = registerSkyOverlay(state.sky.mesh);
    const unregisterFlight = state.flightSky ? registerSkyOverlay(state.flightSky.mesh) : null;
    return () => { unregister(); unregisterSky(); unregisterFlight?.(); state.batch.dispose(); state.sky.dispose(); state.flightSky?.dispose(); };
  }, [state]);
  useFrame(({ camera }, delta) => {
    const store = useFlyStore.getState(), items = runtime.traffic?.items ?? [];
    const dt = document.hidden ? 0 : Math.min(delta, .1);
    state.time += dt;
    const now = state.time, limit = FX.maxTraffic[store.qualityTier] ?? FX.maxTraffic.medium;
    const observing = !!runtime.airportWatch?.active && store.mapStyle === 'satellite';
    if (observing !== state.observing) {
      // Mode switch: each system starts clean.
      state.observing = observing;
      for (const [, rec] of state.recs) for (const h of rec.histories) h.clear();
      state.recs.clear();
      state.sky.clear();
      state.flightSky?.clear();
      state.chooseAt = 0; state.flightChooseAt = 0;
    }
    if (observing) {
      // Wall-clock seconds: the trail ages on the same clock the traffic
      // engine moves the aircraft on (a hitch must not bend the trail).
      skyFrame(state, runtime, origin, camera, renderer, items, store, performance.now() / 1000);
      if (state.flightSky) state.flightSky.mesh.visible = false;
      state.batch.begin(camera, false);
      state.batch.end(1, false, null);
      return;
    }
    state.sky.mesh.visible = false;
    const wxNow = runtime.weather?.wx;
    if (state.flightSky) flightSkyFrame(state, runtime, origin, camera, renderer, items, store, performance.now() / 1000, wxNow);
    // Preserve admitted tracks through a small range band so equal-distance
    // neighbours cannot trade slots and erase one another's histories.
    // Admission is a spatial decision, not animation. Reuse its bounded set
    // between polls while recording/rendering every frame (avoids allocating
    // filter/sort/Set arrays for the entire regional feed every single frame).
    if(now>=state.chooseAt||limit!==state.limit){
    state.chooseAt=now+.5;state.limit=limit;
    const range=22000;
    const eligible = items.filter(t => t.fix1 && t.distM < range+(state.recs.has(t.hex)?4000:0) &&
      (t.opacity ?? 1) * (t.horizonFade ?? 1) > .03 &&
      (livingContrailStrength(t.ry, Math.hypot(t.fix1.vE, t.fix1.vN), t.flags & 1, wxNow) > .003 || state.recs.has(t.hex)) && sources(t).length);
    eligible.sort((a, b) => (a.distM - (state.recs.has(a.hex) ? 1800 : 0)) - (b.distM - (state.recs.has(b.hex) ? 1800 : 0)));
    state.chosen = eligible.slice(0, limit);const seen = new Set(state.chosen.map(t => t.hex));
    for (const [hex, rec] of state.recs) if (!seen.has(hex)) {
      for (const h of rec.histories) { h.clear(); if (state.pool.length < FX.maxTraffic.high * 4) state.pool.push(h); }
      state.recs.delete(hex);
    }
    }
    const chosen=state.chosen;
    const wind = runtime.weather?.wx, wx = (wind?.windX ?? 0) * .35, wz = (wind?.windZ ?? 0) * .35;
    state.batch.begin(camera,!!runtime.cinemaEnvironment&&store.mapStyle==='satellite');
    for (const t of chosen) {
      const offsets = sources(t), fix = t.fix1, speed = Math.hypot(fix.vE, fix.vN);
      const density = livingContrailStrength(t.ry, speed, t.flags & 1, wxNow);
      let rec = state.recs.get(t.hex);
      if (rec && rec.sources !== offsets) {
        for (const h of rec.histories) { h.clear(); state.pool.push(h); }
        state.recs.delete(t.hex); rec = null;
      }
      const fresh = !rec;
      // SKY_TRAILS: the near ribbon hands over to the persistent trail sooner.
      if (fresh) { rec = { sources: offsets, histories: offsets.map(() => state.pool.pop() ?? new WakeHistory(96, SKY_TRAILS_ON ? SKY_TRAILS_CFG.nearLifeSec : undefined)) }; state.recs.set(t.hex, rec); }
      rotation.setFromEuler(attitude.set(speed > 20 ? Math.atan2(fix.vUp, speed) : 0, -t.yaw, -t.bank));
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
        if (fresh && density > .003) for (let j = 64; j > 0; j--) {
          const age = j * .32, climb = Math.max(-speed * .12, Math.min(speed * .12, fix.vUp));
          h.record(emitter.x - fix.vE * k * age, emitter.y - climb * age, emitter.z + fix.vN * k * age,
            now - age, density * livingContrailStrength(t.ry - climb * age, speed, false, wxNow), 0, wx, wz);
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
  return <>
    <primitive object={state.batch.mesh} dispose={null} />
    <primitive object={state.sky.mesh} dispose={null} />
    {state.flightSky && <primitive object={state.flightSky.mesh} dispose={null} />}
  </>;
}

/** 0..1 per ICAO hex, stable. */
function hexShade(hex) {
  let h = 2166136261;
  for (let i = 0; i < hex.length; i++) h = Math.imul(h ^ hex.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 999;
}

/**
 * LIVING WORLD (SKY_TRAILS): flight mode's persistent trails — skyFrame's
 * per-aircraft feed with the flight's range and tier caps, the physical
 * formation band, the player's latitude for scene units, and the flight
 * batch's near and age fades. Wall-clock seconds like the lounge (the
 * traffic engine moves the aircraft on that clock).
 */
function flightSkyFrame(state, runtime, origin, camera, renderer, items, store, now, wxNow) {
  const sky = state.flightSky, tier = store.qualityTier;
  const cap = runtime.cinemaEnvironment && store.mapStyle === 'satellite' ? SKY_TRAILS_CFG.maxTrails[tier] ?? 0 : 0;
  if (!cap) { if (sky.stats.trails) sky.clear(); sky.mesh.visible = false; return; }
  const range = SKY_TRAILS_CFG.rangeM;
  if (now >= state.flightChooseAt) {
    state.flightChooseAt = now + 0.5;
    const eligible = [];
    for (const t of items) {
      if (!t.fix1 || !(t.distM < range + (sky.byHex.has(t.hex) ? 6000 : 0)) || t.stale === 2) continue;
      const speed = Math.hypot(t.fix1.vE, t.fix1.vN);
      if (!(livingContrailStrength(t.ry, speed, t.flags & 1, wxNow) > 0) && !sky.byHex.has(t.hex)) continue;
      if (!sources(t).length) continue;
      eligible.push(t);
    }
    eligible.sort((a, b) => (a.distM - (sky.byHex.has(a.hex) ? 4000 : 0)) - (b.distM - (sky.byHex.has(b.hex) ? 4000 : 0)));
    state.flightChosen = eligible.slice(0, cap);
  }
  const kSite = runtime.cinemaGeography?.worldUnitsPerMetre ?? mercatorScale(runtime.flight?.latDeg || 0);
  skyTrailWind(wxNow, kSite, _wind);
  const hourKey = Math.floor(Date.now() / 3600000);
  for (const t of state.flightChosen) {
    const fix = t.fix1, speed = Math.hypot(fix.vE, fix.vN);
    // Each trail its own optical depth (engine count, fuel flow, the air it
    // forms in), deterministic per aircraft so a re-admitted trail matches.
    const density = livingContrailStrength(t.ry, speed, t.flags & 1, wxNow) * SKY_VIEW.density * SKY_TRAILS_CFG.density * (0.62 + 0.38 * hexShade(t.hex));
    const k = Number.isFinite(fix.latRad) ? 1 / Math.cos(fix.latRad) : 1;
    const spec = resolveLiveType(t);
    const f = spec ? LIVE_AIRCRAFT[spec.family] : null;
    const scale = spec?.scale ?? 1;
    const len = (f?.length ?? 40) * scale;
    const hx = Math.sin(t.yaw), hz = -Math.cos(t.yaw);
    _vel.x = hx * speed * k; _vel.y = Math.max(-speed * 0.12, Math.min(speed * 0.12, fix.vUp)); _vel.z = hz * speed * k;
    let turn = 0;
    const f0 = t.fix0;
    if (f0 && fix.t > f0.t + 0.5 && speed > 20) {
      const dh = Math.atan2(fix.vE, fix.vN) - Math.atan2(f0.vE, f0.vN);
      const d = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(d) > 0.035) turn = Math.max(-0.09, Math.min(0.09, d / (fix.t - f0.t)));
    }
    _src.x = t.rx - hx * len * 0.5 * k; _src.y = t.ryd; _src.z = t.rz - hz * len * 0.5 * k;
    let engine = 6;
    if (f) { engine = 0; for (const e of stations[spec.family] ?? []) engine = Math.max(engine, Math.abs(e[0])); engine = Math.max(1.5, engine * scale); }
    sky.feed(t.hex, _src, _vel, density, now, _wind, { engine, life: trailPersistence(t.ry, hourKey), backfillSec: SKY_TRAILS_CFG.backfillSec, turn });
  }
  sky.rebase(origin.anchor);
  applyFlightTrailFades(sky);
  sky.end(now, skyTrailLight(runtime, camera, renderer, tier));
  if (process.env.NODE_ENV === 'development' && window.__flyStats)
    window.__flyStats.flightTrails = { trails: sky.stats.trails, chosen: state.flightChosen.length, cap, visible: sky.mesh.visible };
}

/**
 * Observation lounge: every jet forming a trail within SKY_VIEW.rangeM keeps
 * a persistent ground-visible contrail (tier capped, nearest first). One
 * ribbon per aircraft, emitted at the tail; the shader splits it into engine
 * lobes for the first seconds.
 */
function skyFrame(state, runtime, origin, camera, renderer, items, store, now) {
  const sky = state.sky, cap = SKY_VIEW.maxTrails[store.qualityTier] ?? SKY_VIEW.maxTrails.medium;
  if (now >= state.chooseAt) {
    state.chooseAt = now + 0.5;
    const eligible = [];
    for (const t of items) {
      if (!t.fix1 || !(t.distM < SKY_VIEW.rangeM + (sky.byHex.has(t.hex) ? 6000 : 0)) || t.stale === 2) continue;
      const speed = Math.hypot(t.fix1.vE, t.fix1.vN);
      if (!(contrailStrength(t.ry, speed, t.flags & 1) > 0) && !sky.byHex.has(t.hex)) continue;
      if (!sources(t).length) continue;
      eligible.push(t);
    }
    eligible.sort((a, b) => (a.distM - (sky.byHex.has(a.hex) ? 4000 : 0)) - (b.distM - (sky.byHex.has(b.hex) ? 4000 : 0)));
    state.skyChosen = eligible.slice(0, cap);
  }
  const wx = runtime.weather?.wx;
  // Upper winds blow harder than the surface report: a capped multiple.
  _wind.x = (wx?.windX ?? 0) * SKY_VIEW.windK; _wind.z = (wx?.windZ ?? 0) * SKY_VIEW.windK;
  const wind = Math.hypot(_wind.x, _wind.z);
  if (wind > SKY_VIEW.windMaxMps) { _wind.x *= SKY_VIEW.windMaxMps / wind; _wind.z *= SKY_VIEW.windMaxMps / wind; }
  // m/s to scene units (Mercator x/z at the observer's latitude).
  const kSite = runtime.airportWatch?.site?.k ?? 1;
  _wind.x *= kSite; _wind.z *= kSite;
  // Persistence bands re-roll every hour of the (real) day.
  const hourKey = Math.floor(Date.now() / 3600000);
  for (const t of state.skyChosen) {
    const fix = t.fix1, speed = Math.hypot(fix.vE, fix.vN);
    const density = contrailStrength(t.ry, speed, t.flags & 1) * SKY_VIEW.density;
    const k = Number.isFinite(fix.latRad) ? 1 / Math.cos(fix.latRad) : 1;
    const spec = resolveLiveType(t);
    const f = spec ? LIVE_AIRCRAFT[spec.family] : null;
    const scale = spec?.scale ?? 1;
    const len = (f?.length ?? 40) * scale;
    // Velocity in scene units (Mercator x/z, metres y) along the DRAWN
    // heading (the engine flies turns as arcs between fixes); the trail
    // leaves the tail.
    const hx = Math.sin(t.yaw), hz = -Math.cos(t.yaw);
    _vel.x = hx * speed * k; _vel.y = Math.max(-speed * 0.12, Math.min(speed * 0.12, fix.vUp)); _vel.z = hz * speed * k;
    // Turn rate between the last two fixes (rad/s, compass sense).
    let turn = 0;
    const f0 = t.fix0;
    if (f0 && fix.t > f0.t + 0.5 && speed > 20) {
      const dh = Math.atan2(fix.vE, fix.vN) - Math.atan2(f0.vE, f0.vN);
      const d = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(d) > 0.035) turn = Math.max(-0.09, Math.min(0.09, d / (fix.t - f0.t)));
    }
    _src.x = t.rx - hx * len * 0.5 * k; _src.y = t.ryd; _src.z = t.rz - hz * len * 0.5 * k;
    // Engine half-span: the outermost nacelle of the family (the early plume
    // lines), 6 m for an unresolved jet.
    let engine = 6;
    if (f) { engine = 0; for (const e of stations[spec.family] ?? []) engine = Math.max(engine, Math.abs(e[0])); engine = Math.max(1.5, engine * scale); }
    sky.feed(t.hex, _src, _vel, density, now, _wind, { engine, life: trailPersistence(t.ry, hourKey), backfillSec: SKY_VIEW.backfillSec, turn });
  }
  sky.rebase(origin.anchor);
  renderer.getDrawingBufferSize(_buffer);
  const e = runtime.cinemaEnvironment, exposure = getR25Sky().exposure || 1;
  const sinEl = runtime.sun?.sinEl ?? 1;
  const fill = e?.fillColor ?? [0.45, 0.62, 1];
  const day = e?.day ?? 1, night = e?.night ?? 0;
  // Sky light on a trail: the ambient fill (the trail is mostly sky-lit
  // after sunset); exposure folded in because overlays get none.
  const skyFill = fill.map((c) => c * (0.05 + 0.22 * day) * exposure);
  sky.end(now, {
    px: camera.projectionMatrix.elements[5] * (_buffer.y || 1080) * 0.5,
    sunDir: e?.sunDir ?? [0, 1, 0], sun: [sinEl, 4.6, night * (e?.sun ?? 0.3) * 1.4, exposure],
    sunColor: [1, 0.97, 0.92], keyDir: e?.keyDir ?? [0, 1, 0], keyColor: e?.keyColor ?? [0.6, 0.7, 1], skyFill, tier: store.qualityTier,
  });
  if (process.env.NODE_ENV === 'development' && window.__flyStats) {
    window.__flyStats.trafficWake = { aircraft: sky.stats.trails, ribbons: sky.stats.trails, capacity: cap, draws: sky.stats.trails ? 1 : 0, mode: 'sky' };
    window.__flySkyTrails = sky; // review harness handle (scripts/review-fleet-sky.cjs)
  }
}

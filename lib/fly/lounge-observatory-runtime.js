// Living Observatory coordinator. The existing watch remains the only owner
// of selection, optics and the camera; the walk runtime owns every movement.
import { airportFrame } from './operations-airports.js';
import { airportRunways, peekAirfieldFeatures, loadAirfieldFeatures } from './airfield/airfield-data.js';
import { loungeApertureFrom } from './lounge-site.js';
import { roomBlockers } from './lounge/room-build.js';
import { ndcDirection, fovForMag, DEG } from './airport-watch-camera.mjs';
import { getTrueScaleK } from './true-scale.js';
import { getBend, bendDrop } from './toy-world/world-bend.js';
import { observatoryStations, stationState, stationPrompt, stationOnRay } from './lounge/observatory-stations.mjs';
import { compassDegrees, observationContacts, observationRunways, observationBuildingFeatures, sampledTerrainSightline, createSuggestionMemory, windowSuggestions, listeningActivity } from './lounge/observatory-model.mjs';

/** Install on an entered watch. `drawnPoint` is injected by airport-watch to
 * share its render-time bend without a circular module dependency. The other
 * hooks permit deterministic tests without a network or DOM.
 */
export function attachLoungeObservatory(watch, runtime, {
  drawnPoint = (t, _flight, out) => Object.assign(out, { x: t.rx, y: t.ryd ?? t.ry, z: t.rz }),
  featuresOf = peekAirfieldFeatures, loadFeatures = loadAirfieldFeatures,
  recordsOf = airportRunways, frameOf = airportFrame, blockersOf = roomBlockers,
  apertureFrom = loungeApertureFrom,
  terrainSightline = null,
} = {}) {
  watch.observatory?.dispose?.();
  let disposed = false, active = null, readouts = false, night = false, bearing = 0, cue = null;
  let time = 0, refreshIn = 0, epoch = null, stations = [], blockers = [], features = null;
  let contacts = [], runways = [], suggestions = { front: null, back: null }, memory = createSuggestionMemory();
  let listening = null;
  const terrainCache = new Map();
  let terrainBudget = 0;
  const point = {};
  const publish = () => watch.publish?.();
  const eye = () => watch.eyeLocal ?? { x: 0, y: 1.18, z: 0 };
  const states = () => stations.map((s) => stationState(s, { eye: eye(), yaw: watch.yaw, active: watch.active && !disposed, validated: watch.validated, posture: watch.posture, blockers }));
  const current = () => stations.find((s) => s.id === active);

  function ensureSite() {
    if (!watch.site || disposed) return false;
    const key = `${watch.site.ident}:${watch.siteEpoch ?? 0}:${watch.site.variant}`;
    if (epoch === key) return true;
    epoch = key;
    release();
    stations = observatoryStations(watch.site.variant);
    blockers = blockersOf(watch.site.variant);
    features = featuresOf(watch.site.ident);
    runways = observationRunways(recordsOf(watch.site.ident), frameOf, watch.site);
    contacts = []; suggestions = { front: null, back: null }; memory = createSuggestionMemory();
    cue = null; refreshIn = 0;
    terrainCache.clear();
    // The data service shares/caches this request with the airfield. A late
    // completion from an old airport never changes the current room.
    if (!features && loadFeatures) {
      const requestEpoch = epoch, requestSite = watch.site;
      Promise.resolve().then(() => loadFeatures(requestSite)).then((value) => {
        if (!disposed && epoch === requestEpoch) { features = value; refreshIn = 0; }
      }).catch(() => { /* Missing geometry stays explicitly unverified. */ });
    }
    return true;
  }

  function refresh() {
    if (!watch.active || !ensureSite()) return;
    // A registry upgrade can finish after the lounge opens. Read it with the
    // same cadence as contacts rather than permanently drawing an old runway.
    features = featuresOf(watch.site.ident) ?? features;
    runways = observationRunways(recordsOf(watch.site.ident), frameOf, watch.site, features?.runwayLines ?? []);
    const sightlineSite = watch.validated && Number.isFinite(watch.floorY)
      ? { ...watch.site, floorM: watch.floorY - watch.site.groundY } : watch.site;
    const set = runtime.airportSet?.site === watch.site ? runtime.airportSet : null;
    const occlusionFeatures = observationBuildingFeatures(features, sightlineSite, set?.plan, set?.apronY?.() ?? watch.site.groundY);
    terrainBudget = 256;
    const bend = getBend(), anchor = runtime.origin?.anchor ?? { x: 0, z: 0 };
    const terrainSample = (x, z) => {
      if (!runtime.engine?.worldToGeo || !runtime.engine?.getGroundAt) return null;
      const key = `${Math.round(x)}:${Math.round(z)}`;
      const cached = terrainCache.get(key);
      let sample = cached && time - cached.at < 1 ? cached.sample : undefined;
      if (sample === undefined) {
        if (terrainBudget-- <= 0) return null;
        const geo = runtime.engine.worldToGeo({ x, y: 0, z });
        sample = runtime.engine.getGroundAt(geo.x, geo.y);
        terrainCache.delete(key); terrainCache.set(key, { sample: sample ?? null, at: time });
        if (terrainCache.size > 4096) terrainCache.delete(terrainCache.keys().next().value);
      }
      if (!sample || !Number.isFinite(sample.elev)) return null;
      const d = Math.hypot(x - anchor.x - bend.cx, z - anchor.z - bend.cz);
      return { elev: sample.elev - bendDrop(d, bend.k), tileZ: sample.tileZ };
    };
    const orderedTracks = [...(runtime.traffic?.items ?? [])].sort((a, b) => Number(b.hex === watch.selected) - Number(a.hex === watch.selected)
      || Math.hypot(a.rx - watch.site.x, a.rz - watch.site.z) - Math.hypot(b.rx - watch.site.x, b.rz - watch.site.z));
    contacts = observationContacts(orderedTracks, {
      site: sightlineSite, eye: eye(), selected: watch.selected, runways: watch.runways ?? [], features: occlusionFeatures,
      pointOf: (track) => drawnPoint(track, runtime.flight?.pos, point), apertureFrom,
      terrainSightline: terrainSightline ?? ((from, to) => sampledTerrainSightline(from, to, terrainSample, { k: watch.site.k || 1 })),
    });
    suggestions = windowSuggestions(contacts, memory, time, { eyeSide: eye().z > 7 ? 'back' : 'front' });
    if (cue) {
      const contact = contacts.find((c) => c.hex === cue.hex);
      if (!contact) cue = null;
      else cue = { ...cue, label: contact.label, bearing: contact.bearing, roomBearing: contact.roomBearing, side: contact.bestView };
    }
  }

  function updateListening() {
    const s = current();
    listening = s?.kind === 'listen' ? {
      side: s.side, bearing,
      worldBearing: compassDegrees(bearing - (watch.roomHeading || 0) / DEG),
      level: listeningActivity(contacts, bearing),
    } : null;
  }

  function release() {
    const changed = active !== null;
    active = null; listening = null;
    if (changed) publish();
    return changed;
  }

  function activate(id, { remote = false } = {}) {
    if (disposed || !watch.active || !ensureSite()) return false;
    const s = states().find((item) => item.id === id);
    if (!s?.available || (!remote && !s.nearby)) return false;
    if (id === active && s.kind !== 'night') { release(); return true; }
    // Opening a panel while a key is held ends that stride. A later movement
    // key still releases the instrument through the existing watch hook.
    watch.setMoveKeys?.(0, 0, false);
    watch.walk?.halt?.();
    release();
    active = id;
    if (s.kind === 'listen') bearing = s.side === 'back' ? 180 : 0;
    if (s.kind === 'night') night = !night;
    if (s.kind === 'support') {
      // Raising at a rail never acquires or follows a target by surprise.
      // A tracking session already in progress retains its selected aircraft.
      watch.binoculars?.(true, { acquire: false });
      runtime.airportAudio?.cue?.('support');
    }
    updateListening(); publish();
    return true;
  }

  function selectContact(hex) {
    if (disposed || !watch.active) return false;
    refresh();
    if (!contacts.some((c) => c.hex === hex)) return false;
    const ok = watch.select?.(hex, { follow: false, binoculars: false });
    refresh(); publish();
    return ok !== false;
  }

  const observatory = {
    get supported() { return current()?.kind === 'support' && watch.posture === 'standing' && !disposed; },
    get listening() { return listening; },
    get night() { return night; },
    get readouts() { return readouts; },
    snapshot() {
      ensureSite();
      const currentStates = states();
      return {
        stations: currentStates, prompt: stationPrompt(currentStates), active, contacts, runways, suggestions,
        listening, supported: observatory.supported, readouts, night, cue,
        visibilityBasis: 'room apertures, rendered airfield building volumes and sampled refined terrain (250 m spacing; 16 km range)',
        geometryReady: !!features && !(features.tiles?.failed > 0),
      };
    },
    activate, release, selectContact,
    setBearing(deg) {
      if (disposed || current()?.kind !== 'listen' || !Number.isFinite(deg)) return false;
      bearing = compassDegrees(deg); updateListening(); publish(); return true;
    },
    setReadouts(value) { if (!disposed) { readouts = !!value; publish(); } },
    toggleNight() { if (disposed || !watch.active) return false; night = !night; publish(); return night; },
    showDirection(hex) {
      if (hex == null) { cue = null; publish(); return true; }
      if (!selectContact(hex)) return false;
      const c = contacts.find((item) => item.hex === hex);
      if (!c) return false;
      cue = { hex, label: c.label, bearing: c.bearing, roomBearing: c.roomBearing, side: c.bestView, remainingSec: 12 };
      publish(); return true;
    },
    stationAt(u, v) {
      if (disposed || !watch.active || !watch.validated || !Number.isFinite(u) || !Number.isFinite(v) || !ensureSite()) return null;
      const camera = runtime.camera, tanV = Math.tan(((camera?.fov ?? fovForMag(watch.optics?.mag ?? 1)) * DEG) / 2);
      const d = ndcDirection(watch.yaw, watch.pitch, u, v, tanV * (camera?.aspect || 16 / 9), tanV, {});
      const pitch = Math.atan(((watch.frame?.k || 1) / (getTrueScaleK() || 1)) * Math.tan(d.pitch));
      return stationOnRay(stations, eye(), { x: -Math.sin(d.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(d.yaw) * Math.cos(pitch) }, blockers);
    },
    tick(dt) {
      if (disposed) return;
      if (!watch.active) { release(); cue = null; return; }
      if (!ensureSite()) return;
      const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      time += elapsed; refreshIn -= elapsed;
      // Proximity release runs every frame, independently of the low-rate
      // contact model. Leaving, sitting or gliding cannot retain support/audio.
      if (active) {
        const s = states().find((item) => item.id === active);
        if (!s?.available || ((s.kind === 'support' || s.kind === 'listen') && !s.nearby)) release();
      }
      if (cue) { cue = { ...cue, remainingSec: cue.remainingSec - elapsed }; if (cue.remainingSec <= 0) cue = null; }
      if (refreshIn <= 0) { refresh(); refreshIn = .25; }
      updateListening();
    },
    dispose() {
      if (disposed) return;
      release(); disposed = true; contacts = []; runways = []; cue = null;
      stations = []; blockers = []; features = null; suggestions = { front: null, back: null };
      terrainCache.clear();
      if (watch.observatory === observatory) watch.observatory = null;
    },
  };
  watch.observatory = observatory;
  ensureSite(); refresh();
  return () => observatory.dispose();
}

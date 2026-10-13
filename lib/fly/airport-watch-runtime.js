import { Vector3 } from 'three';
import { useFlyStore } from '@/stores/fly-store';
import { OPERATIONS_AIRPORTS, airportById, airportFrame, airportRegistryRevision } from './operations-airports';
import { ensureAirport, loadNearbyRunways, setRunwayObservation } from './runway-catalog';
import { livingAirportsOn } from './airport-feature-policy';
import { airportActivity, joinBlocker, observationViews, discoveryNeedsSceneRefresh } from './airport-observation.mjs';
import { resolveLoungeSite, loungeAperture, storedSeat, chooseSessionSeat, sessionSeat } from './lounge-site';
import { chooseLoungeSeat } from './lounge-seat';
import { loadAirfieldFeatures } from './airfield/airfield-data';
import { LOUNGE_ROOM, SEAT, VIEW } from './observation-config';
import { setAirFarLift, airDrop } from './toy-world/world-bend';
import { startEscort, releaseEscort } from './escort';
import { registerRuntimeActions } from './runtime-bus';
import { getComposer } from './step-safe';
import { getTrueScaleK } from './true-scale';
import {
  DEG, clamp, wrapPi, clampMag, fovForMag, maskAmount, easeMag, springTo, scenePitch, offsetAngles,
  ndcDirection, anchorHead, angularSeparation, slewMag, handSway, prefersReducedMotion,
} from './airport-watch-camera.mjs';
import { buildBoard, runwayDirections } from './airport-watch-board.mjs';

/*
 * runtime.airportWatch — the seated observer.
 *
 * Owns the observation lifecycle (enter / leave / join / return), the head
 * (look-around with inertia), the optics (naked eye to 25x binoculars), the
 * selection and its follow/lock, and the live board. Everything here runs
 * outside React: the HUD reads it at low rates, the frame-synced overlay
 * (components/fly/hud/lounge/LoungeOverlay.jsx) reads it every GL frame, and
 * FlyScene drives updateCamera() at priority -50 while the sim is paused.
 *
 * Fields other workstreams read (all live, never React state):
 *   active, validated, airport, site, seat (floor point, scene), floorY,
 *   roomHeading, frame.k, selected (hex | null), tracking (follow/lock on),
 *   binocular (binoculars up), optics {mag, target, amount}, hover (hex),
 *   board(), snapshot().
 * yaw / pitch / zoom remain writable for harnesses (a write is a hard cut).
 */

// Post effects copy the camera's near/far only when told (postprocessing
// EffectPass.mainCamera): without this the aerial pass reconstructs lounge
// depth with the flight near plane and hazes the view ~30x too far.
const syncComposerCamera = (camera) => getComposer()?.setMainCamera?.(camera);
// A ground observer sees traffic at its true elevation angle: no far-lift.
const OBSERVER_FAR_LIFT = 0.2;
const LOOK = LOUNGE_ROOM.look;
const NEAR = 0.08;
const GROUNDED = 1;

/** Scene position the GPU draws a track at (absolute X/Z), predicted `lead` seconds ahead. */
export function drawnPoint(t, flightPos, out, lead = 0) {
  const fix = t.fix1;
  const k = fix ? 1 / Math.max(0.1, Math.cos(fix.latRad || 0)) : 1;
  const climbs = fix && t.stale === 0 && !(t.flags & GROUNDED);
  const x = t.rx + (fix && t.stale !== 2 ? fix.vE * k * lead : 0);
  const z = t.rz - (fix && t.stale !== 2 ? fix.vN * k * lead : 0);
  const y = (t.ryd ?? t.ry) + (climbs ? (fix.vUp || 0) * lead : 0);
  // The aircraft bend (world-bend-air-anchor) mirrored on the CPU, exactly as
  // the label canvas and the reticle do, so the camera aims where it is drawn.
  const drop = flightPos ? airDrop(Math.hypot(x - flightPos.x, z - flightPos.z), y) : 0;
  out.x = x;
  out.y = y - drop;
  out.z = z;
  return out;
}

/**
 * Which glazing a scene-space offset from the seated eye looks through:
 * 'front' | 'roof' | 'side' | null (a wall or the floor is in the way).
 */
export function glazingFor(watch, dx, dy, dz) {
  const c = Math.cos(watch.roomHeading), s = Math.sin(watch.roomHeading), k = watch.frame?.k || 1;
  const lx = (dx * c - dz * s) / k, lz = (dx * s + dz * c) / k;
  const len = Math.hypot(lx, dy, lz) || 1;
  return loungeAperture(lx / len, dy / len, lz / len);
}

/** Owns the observation lifecycle. Camera vectors stay outside React. */
export function connectAirportWatch(runtime) {
  let disposed = false, request = 0, seenRegistry = airportRegistryRevision();
  let cameraBefore = null, cameraUsed = null, nextGroundSample = 0, flightLift = null;
  const eye = new Vector3(), geo = new Vector3(), aim = { x: 0, y: 0, z: 0 }, angles = {}, sway = {}, anchorOut = {};

  // --- head: rendered-frame angles, room-relative yaw ----------------------
  const head = {
    yaw: { x: 0, v: 0 },
    pitch: { x: LOOK.defaultPitch, v: 0 },
    lookYaw: 0, // free-look targets (drag and keys move these; the spring follows)
    lookPitch: LOOK.defaultPitch,
    keys: { x: 0, y: 0 }, // held arrow keys, -1..1
    anchor: null, // zoom-to-cursor: {yaw, pitch, u, v} world direction kept under the pointer
    time: 0, // sway clock
    reduced: prefersReducedMotion(),
  };
  // --- optics --------------------------------------------------------------
  const optics = { mag: 1, target: 1, bino: VIEW.optics.defaultMag, amount: 0, ceiling: VIEW.optics.maxMag };
  // --- follow / lock --------------------------------------------------------
  const follow = { hex: null, yaw: 0, pitch: 0, rateYaw: 0, ratePitch: 0, hiddenAt: 0, error: 0, primed: false, lostAt: 0 };
  let followBeforeBinoculars = null; // restored when the binoculars come down
  // --- board -----------------------------------------------------------------
  const boardMemo = new Map();
  let boardCache = null, boardAt = -Infinity, runways = [], fieldElev = 0, boardRef = { x: 0, z: 0 };
  let lastPublished = '';

  const watch = {
    active: false, airport: null, site: null, center: null, frame: null, views: [], view: 0,
    selected: null, tracking: false, notice: '', validated: false, snap: true,
    seat: new Vector3(), floorY: 0, roomHeading: 0,
    binocular: false, hover: null, optics, lostSelection: false,
    // seatPending: the airport's seat is still being chosen from its OSM data
    // (the reveal waits); siteEpoch counts seat moves (the set remounts).
    seatPending: false, siteEpoch: 0, seatChoice: null,
  };

  // Harness / legacy surface: yaw and pitch are the rendered head angles; a
  // write is a hard cut (target and spring together). zoom = 1 / magnification.
  Object.defineProperties(watch, {
    yaw: { enumerable: true, get: () => head.yaw.x, set: (v) => { if (Number.isFinite(v)) { head.yaw.x = head.lookYaw = v; head.yaw.v = 0; head.anchor = null; } } },
    pitch: { enumerable: true, get: () => head.pitch.x, set: (v) => { if (Number.isFinite(v)) { head.pitch.x = head.lookPitch = v; head.pitch.v = 0; head.anchor = null; } } },
    zoom: { enumerable: true, get: () => 1 / optics.mag, set: (v) => { if (v > 0) { optics.mag = optics.target = clampMag(1 / v); syncBinocular(); } } },
    // Landing directions of the observed airport (runwayDirections), read-only:
    // the board's corridors, and the sightline review's targets.
    runways: { enumerable: false, get: () => runways },
  });

  function publish() {
    const value = watch.active
      ? { id: watch.airport.id, site: watch.siteEpoch, view: watch.view, selected: watch.selected, tracking: watch.tracking, binocular: watch.binocular,
          mag: Math.round(optics.target * 10) / 10, zoom: 1 / optics.target, notice: watch.notice, validated: watch.validated }
      : null;
    const key = JSON.stringify(value);
    if (key === lastPublished) return;
    lastPublished = key;
    useFlyStore.setState({ airportWatch: value });
  }
  function syncBinocular() {
    const up = optics.target >= VIEW.optics.binocularAt;
    if (up !== watch.binocular) watch.binocular = up;
  }
  const cue = (name) => runtime.airportAudio?.cue?.(name);
  /**
   * The selection's soft lock, written where it is read: FlyScene re-syncs
   * the store's lock from runtime.targeting every frame, and DetailedTraffic
   * gives the targeting lock hero detail. The targeting update is skipped
   * while observing, so this lock holds until the lounge changes it (the
   * same force-lock idiom as runtime.interceptHex).
   */
  function softLock(hex) {
    const targeting = runtime.targeting;
    if (targeting) {
      targeting.lockedHex = hex || null;
      targeting.target = hex ? runtime.traffic?.tracks.get(hex) ?? null : null;
      targeting._lockT = performance.now() / 1000;
    }
    const store = useFlyStore.getState();
    if (hex) store.setLock(hex, 'soft');
    else store.clearLock();
  }

  function groundAt(point) {
    geo.copy(runtime.engine.worldToGeo(point));
    const sample = runtime.engine.getGroundAt(geo.x, geo.y);
    return sample && sample.tileZ >= 12 && Number.isFinite(sample.elev) ? sample.elev : null;
  }
  function eyePoint(out = eye) {
    out.copy(watch.seat);
    out.y += LOUNGE_ROOM.eye[1];
    return out;
  }
  function resetHead() {
    head.yaw.x = head.lookYaw = 0;
    head.pitch.x = head.lookPitch = LOOK.defaultPitch;
    head.yaw.v = head.pitch.v = 0;
    head.anchor = null;
    head.keys.x = head.keys.y = 0;
  }
  function stopFollow(notice) {
    watch.tracking = false;
    follow.hex = null;
    follow.primed = false;
    head.lookYaw = head.yaw.x;
    head.lookPitch = head.pitch.x;
    if (notice != null) watch.notice = notice;
  }
  function chooseView(index) {
    watch.view = Math.max(0, Math.min(watch.views.length - 1, index));
    resetHead();
    optics.mag = optics.target = 1;
    optics.ceiling = VIEW.optics.maxMag;
    syncBinocular();
    stopFollow();
    watch.snap = true;
    watch.validated = false;
    nextGroundSample = 0;
    publish();
  }

  // The observed airport's runways, for the board: every registered runway
  // sharing the ident (authored flagships carry their one authored runway).
  function collectRunways(observed, ident) {
    const records = OPERATIONS_AIRPORTS.filter((r) => (r.ident || String(r.id).split(':')[0]) === ident);
    if (!records.includes(observed)) records.push(observed);
    runways = runwayDirections(records, airportFrame);
    const f = airportFrame(observed);
    boardRef = { x: f.x + f.ux * f.length * f.k * 0.5, z: f.z + f.uz * f.length * f.k * 0.5 };
    fieldElev = (observed.a.elevation + observed.b.elevation) / 2;
    boardMemo.clear();
    boardCache = null;
  }

  // Seats chosen this session from an airport's own OSM data live in
  // lounge-site.js (chooseSessionSeat: one cache for the lounge and the
  // airport service's flight areas, keyed by ident and room variant; null:
  // the data had no acceptable seat, so the generic one stands). This view
  // keeps the lounge's reads by ident.
  const chosenSeats = {
    has: (ident) => sessionSeat(ident) !== undefined,
    get: (ident) => sessionSeat(ident),
  };
  const identOfAirport = (a) => a.ident || String(a.id).split(':')[0];
  function chooseSeat(airport, token) {
    return chooseSessionSeat(airport, {
      load: loadAirfieldFeatures,
      choose: chooseLoungeSeat,
      timeoutMs: SEAT.loadTimeoutMs,
      cancelled: () => disposed || token !== request,
      // Diagnostics for the review scripts: how the last seat was decided.
      onChoice: (choice) => { watch.seatChoice = choice; },
    });
  }

  /**
   * Seat the lounge at `site`: pin the faced runway, transfer the (hidden,
   * held) aircraft to the seated eye — traffic range, polling, the world bend
   * and streaming all centre on the observer — and take the site's frame.
   */
  function placeSeat(site, airport) {
    const observed = airportById(site.runwayId) || airport;
    const frame = airportFrame(observed), center = { x: site.x, y: site.groundY, z: site.z };
    const g = runtime.engine.worldToGeo(center);
    // Pin the faced runway's geometry first (it may be a sibling of the one searched).
    setRunwayObservation(observed);
    if (!runtime.warpToGeo(g.y, g.x, { altM: site.groundY + site.floorM + LOUNGE_ROOM.eye[1], headingRad: site.heading, stage: true })) {
      setRunwayObservation(watch.active ? watch.airport : null);
      return false;
    }
    Object.assign(watch, {
      airport: observed, site, center, frame, floorY: site.groundY + site.floorM,
      views: observationViews(observed, frame.length, site),
      notice: watch.seatPending ? 'Finding the best seat at the terminal…' : 'Loading terrain and live activity…',
    });
    watch.seat.set(site.x, site.groundY + site.floorM, site.z);
    watch.roomHeading = site.heading;
    watch.siteEpoch++; // the set (ObservationWorld) remounts for the new seat
    collectRunways(observed, site.ident);
    return true;
  }

  /**
   * After the transfer: choose the seat from the airport's OSM data, and move
   * there if it differs. The reveal waits for this (seatPending), so the
   * player never watches the lounge jump; a late or failed choice keeps the
   * generic seat.
   */
  async function refineSeat(airport, token) {
    const seat = await chooseSeat(airport, token);
    if (disposed || token !== request || !watch.active) return;
    watch.seatPending = false;
    const site = seat ? resolveLoungeSite(airport, { seat }) : null;
    const moved = site && (site.runwayId !== watch.site.runwayId || Math.hypot(site.x - watch.site.x, site.z - watch.site.z) > 1);
    if (moved && !watch.validated && placeSeat(site, airport)) chooseView(0);
    else {
      watch.notice = watch.validated ? '' : 'Loading terrain and live activity…';
      publish();
    }
  }

  async function enter(id) {
    if (!livingAirportsOn() || !runtime.warpToGeo || !runtime.engine) return false;
    const token = ++request;
    try {
      const airport = await ensureAirport(id);
      if (disposed || token !== request) return false;
      if (!airport) throw Error('This runway is not available in the catalog.');
      // Register before streaming so terrain and worker exclusions agree.
      await loadNearbyRunways(airport.a.lat, airport.a.lon).catch(() => []);
      if (disposed || token !== request) return false;
      // The room faces one runway from the terminal side (lounge-site.js). An
      // airport without a stored seat (flagship or hub table) chooses one from
      // its own OSM data (lounge-seat.js): the set's pier and apron on real
      // apron, never on a runway or taxiway, with the approaches in view.
      // That data takes a few seconds, so the transfer starts at the generic
      // seat and the lounge moves to the chosen one before it is revealed.
      const ident = identOfAirport(airport);
      const pending = !storedSeat(airport) && !chosenSeats.has(ident);
      const site = resolveLoungeSite(airport, { seat: chosenSeats.get(ident) ?? null });
      const observed = airportById(site.runwayId) || airport;
      const frame = airportFrame(observed), center = { x: site.x, y: site.groundY, z: site.z };
      const revision = airportRegistryRevision();
      const previous = runtime.flight?.pos;
      const previousLat = previous ? runtime.engine.worldToGeo(previous).y : 0;
      const refreshScale = Math.max(frame.k, 1 / Math.max(0.09, Math.cos((previousLat * Math.PI) / 180)));
      const refresh = revision !== seenRegistry && discoveryNeedsSceneRefresh(previous, center, refreshScale);
      watch.seatPending = pending;
      if (!placeSeat(site, airport)) {
        watch.seatPending = false;
        throw Error('The world is not ready for an airport transfer.');
      }
      // Far transfers already retire old chunks through their bounded rings.
      // Keep shared materials/workers alive there; new requests carry the new
      // registry. Only overlapping discovery needs an explicit rebuild.
      if (refresh) useFlyStore.setState({ airportContentEpoch: revision });
      seenRegistry = revision;
      releaseEscort(runtime);
      runtime.adventures?.suspend();
      runtime.input?.neutralize();
      runtime.input?.keys?.clear();
      Object.assign(watch, { active: true, selected: null, hover: null, lostSelection: false });
      if (flightLift == null) flightLift = setAirFarLift(OBSERVER_FAR_LIFT);
      const s = useFlyStore.getState();
      softLock(null); // a lock carried in from flight would otherwise hold (targeting is paused here)
      s.setInspectHex(null); s.setCameraMode('chase'); s.setFlightMode('free'); s.setHangarOpen(false); s.setAtlasOpen(false); s.setPhase('flying');
      useFlyStore.setState({ airportBrowserOpen: false, airportReturn: null });
      chooseView(0);
      if (pending) refineSeat(airport, token);
      return true;
    } catch (error) {
      if (token === request && !disposed) {
        setRunwayObservation(watch.active ? watch.airport : null);
        watch.notice = error.message;
        publish();
      }
      throw error;
    }
  }

  /**
   * Select a contact. Follows it from the seat by default (the head turns
   * with it until you look away); `binoculars: true` also raises the glasses
   * and locks them on it. Keeps the soft lock so DetailedTraffic gives the
   * selection hero detail.
   */
  function select(hex, { follow: wantFollow = true, binoculars: raise = false } = {}) {
    if (!watch.active || !hex) return false;
    const changed = watch.selected !== hex;
    watch.selected = hex;
    watch.lostSelection = false;
    watch.notice = '';
    softLock(hex);
    // An open dossier follows the new selection instead of closing.
    const store = useFlyStore.getState();
    if (store.inspectHex && store.inspectHex !== hex) store.setInspectHex(hex);
    if (wantFollow || raise) startFollow(hex);
    if (raise && !watch.binocular) raiseBinoculars();
    if (changed) cue('select');
    publish();
    return true;
  }
  function startFollow(hex) {
    const t = runtime.traffic?.tracks.get(hex);
    if (!t || t.stale === 2) {
      watch.notice = 'No fresh position for this aircraft yet.';
      return false;
    }
    if (!contactVisible(t)) {
      watch.notice = 'That aircraft is behind the lounge walls right now. It is selected; follow it once it comes into view.';
      return false;
    }
    watch.tracking = true;
    follow.hex = hex;
    follow.primed = false;
    follow.hiddenAt = 0;
    head.anchor = null;
    return true;
  }
  function clearSelection() {
    watch.selected = null;
    watch.lostSelection = false;
    stopFollow('');
    softLock(null);
    publish();
  }

  function leave() {
    request++;
    if (cameraBefore && cameraUsed) {
      cameraUsed.near = cameraBefore.near;
      cameraUsed.fov = cameraBefore.fov;
      cameraUsed.updateProjectionMatrix();
      syncComposerCamera(cameraUsed);
      cameraBefore = null;
      cameraUsed = null;
    }
    if (flightLift != null) {
      setAirFarLift(flightLift);
      flightLift = null;
    }
    watch.active = false;
    watch.seatPending = false;
    watch.selected = null;
    watch.hover = null;
    watch.binocular = false;
    optics.mag = optics.target = 1;
    optics.amount = 0;
    stopFollow();
    setRunwayObservation(null);
    useFlyStore.getState().setInspectHex(null);
    // A join hands the lock to the escort's autopilot; otherwise flight
    // resumes without a lounge selection locked on.
    if (runtime.autopilot?.mode === 'off') softLock(null);
    runtime.chaseRig?.snap?.();
    publish();
  }

  function join(hex = watch.selected) {
    if (!watch.active) return { ok: false, message: 'Open an airport observation first.' };
    const t = runtime.traffic?.tracks.get(hex), f = runtime.flight;
    if (!f) return { ok: false, message: 'The flight controls are not ready.' };
    const k = 1 / Math.max(0.1, Math.cos((runtime.engine.worldToGeo({ x: t?.rx || 0, y: t?.ry || 0, z: t?.rz || 0 }).y * Math.PI) / 180));
    const yaw = t?.yaw ?? 0;
    // Behind and offset from the contact, in true metres.
    const point = new Vector3((t?.rx || 0) - Math.sin(yaw) * 900 * k + Math.cos(yaw) * 180 * k, t?.ry ?? NaN, (t?.rz || 0) + Math.cos(yaw) * 900 * k + Math.sin(yaw) * 180 * k);
    const target = new Vector3(t?.rx || 0, t?.ry || 0, t?.rz || 0);
    let corridor = groundAt(point);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const sample = groundAt(new Vector3().lerpVectors(point, target, fraction));
      corridor = sample == null || corridor == null ? null : Math.max(corridor, sample);
    }
    const message = joinBlocker({ track: t, status: runtime.trafficStatus?.state, cfg: f.cfg, aircraftId: useFlyStore.getState().aircraftId, ground: corridor, targetGround: groundAt(target), altitude: point.y, ready: !runtime.worldLoading && watch.validated });
    if (message) {
      watch.notice = message;
      publish();
      return { ok: false, message };
    }
    const airportId = watch.airport.id, view = watch.view;
    const g = runtime.engine.worldToGeo(point);
    const ops = runtime.operations;
    const prior = { ...ops, events: ops.events?.slice() };
    const previousPosition = runtime.engine.worldToGeo(f.pos.clone());
    const previousFlight = { heading: f.heading, speed: f.speed, pitch: f.pitch, bank: f.bank };
    ops.profile = null;
    ops.phase = 'airborne';
    if (!runtime.warpToGeo(g.y, g.x, { altM: point.y, headingRad: yaw })) {
      Object.assign(ops, prior);
      watch.notice = 'The flight controls are busy. Try again.';
      publish();
      return { ok: false, message: watch.notice };
    }
    f.speed = Math.hypot(t.fix1.vE, t.fix1.vN);
    ops.warp(f);
    const result = startEscort(runtime, hex, { source: 'airport' });
    if (!result.ok) {
      runtime.warpToGeo(previousPosition.y, previousPosition.x, { altM: previousPosition.z, headingRad: previousFlight.heading, stage: true });
      Object.assign(ops, prior);
      Object.assign(f, previousFlight);
      watch.notice = result.message;
      publish();
      return result;
    }
    leave();
    useFlyStore.setState({ airportReturn: { id: airportId, view } });
    return result;
  }

  // --- optics ------------------------------------------------------------------
  /**
   * Raise the glasses at `mag`. With nothing selected they auto-acquire the
   * aircraft nearest the centre of view; with a selection they lock onto it.
   */
  function raiseBinoculars(mag = optics.bino) {
    followBeforeBinoculars = watch.tracking;
    if (!watch.selected) {
      const hex = acquire();
      if (hex) {
        watch.selected = hex;
        watch.lostSelection = false;
        watch.notice = '';
        softLock(hex);
      } else watch.notice = 'No aircraft near your line of sight. The binoculars are up — drag to search.';
    }
    if (watch.selected && !watch.tracking) startFollow(watch.selected);
    optics.target = clampMag(Math.max(mag, VIEW.optics.binocularAt));
    optics.bino = optics.target;
    syncBinocular();
    cue('raise');
  }
  function lowerBinoculars() {
    if (optics.target >= VIEW.optics.binocularAt) optics.bino = optics.target;
    optics.target = 1;
    head.anchor = null;
    syncBinocular();
    if (followBeforeBinoculars === false && watch.tracking) stopFollow();
    followBeforeBinoculars = null;
    cue('lower');
  }
  /** Toggle (or force) the binoculars. */
  function binoculars(force) {
    if (!watch.active) return false;
    const up = force ?? !watch.binocular;
    if (up && !watch.binocular) raiseBinoculars();
    else if (!up && watch.binocular) lowerBinoculars();
    publish();
    return watch.binocular;
  }
  /** Jump to a magnification (a binocular power raises the glasses; below it they come down). */
  function setMagnification(mag) {
    if (!watch.active) return;
    const m = clampMag(mag);
    if (m >= VIEW.optics.binocularAt) {
      if (watch.binocular) optics.target = optics.bino = m;
      else raiseBinoculars(m);
    } else if (watch.binocular) lowerBinoculars();
    else optics.target = m;
    syncBinocular();
    publish();
  }
  /** Step through the binocular presets (dir +1 / -1). */
  function stepMagnification(dir) {
    const steps = VIEW.optics.steps;
    const current = optics.target;
    const next = dir > 0 ? steps.find((s) => s > current * 1.01) ?? steps.at(-1) : [...steps].reverse().find((s) => s < current * 0.99) ?? 1;
    if (next <= 1) binoculars(false);
    else setMagnification(next);
  }
  /**
   * Wheel zoom: continuous 1x-25x. With (u, v) the NDC under the pointer,
   * that direction stays under the pointer while the field narrows (unless a
   * lock is holding the view on an aircraft).
   */
  function zoomAt(deltaY, u, v) {
    if (!watch.active || !Number.isFinite(deltaY)) return;
    const before = optics.target;
    optics.target = clampMag(optics.target * Math.exp(-deltaY * VIEW.optics.wheelPerPx));
    if (optics.target >= VIEW.optics.binocularAt) optics.bino = optics.target;
    const wasUp = watch.binocular;
    syncBinocular();
    if (watch.binocular !== wasUp) cue(watch.binocular ? 'raise' : 'lower');
    if (!watch.tracking && Number.isFinite(u) && Number.isFinite(v) && Math.abs(optics.target - before) > 1e-6) {
      const camera = runtime.camera;
      const aspect = camera?.aspect || 16 / 9;
      const tanV = Math.tan((fovForMag(optics.mag) * DEG) / 2);
      if (!head.anchor || head.anchor.u !== u || head.anchor.v !== v) {
        const d = ndcDirection(head.yaw.x, head.pitch.x, u, v, tanV * aspect, tanV, {});
        head.anchor = { yaw: d.yaw, pitch: d.pitch, u, v };
      }
    }
    publish();
  }

  // --- look ------------------------------------------------------------------
  /** Grab-to-look: the world under the pointer follows it (gain from the live field of view). */
  function dragLook(dxPx, dyPx, viewportH = 1080) {
    if (!watch.active) return;
    if (watch.tracking) stopFollow('');
    head.anchor = null;
    const radPerPx = (fovForMag(optics.mag) * DEG) / Math.max(200, viewportH);
    head.lookYaw = clamp(head.lookYaw + dxPx * radPerPx, LOOK.yawMin, LOOK.yawMax);
    head.lookPitch = clamp(head.lookPitch + dyPx * radPerPx, LOOK.pitchMin, LOOK.pitchMax);
  }
  /** Drag release: a short glide in the direction of the flick. */
  function releaseLook(vxPx, vyPx, viewportH = 1080) {
    if (!watch.active || watch.tracking) return;
    const radPerPx = (fovForMag(optics.mag) * DEG) / Math.max(200, viewportH);
    const glide = VIEW.head.momentumSec;
    head.lookYaw = clamp(head.lookYaw + vxPx * radPerPx * glide, LOOK.yawMin, LOOK.yawMax);
    head.lookPitch = clamp(head.lookPitch + vyPx * radPerPx * glide, LOOK.pitchMin, LOOK.pitchMax);
  }
  /** Held arrow keys: -1/0/1 per axis (+x looks right, +y looks up). */
  function setLookKeys(x, y) {
    head.keys.x = clamp(x || 0, -1, 1);
    head.keys.y = clamp(y || 0, -1, 1);
    if ((head.keys.x || head.keys.y) && watch.tracking) stopFollow('');
    if (head.keys.x || head.keys.y) head.anchor = null;
  }
  /** Legacy pixel look (keyboard steps, old harnesses). */
  function move(dx, dy) {
    if (watch.tracking) {
      stopFollow('');
      publish();
    }
    head.anchor = null;
    const gain = 0.003 / optics.mag;
    head.lookYaw = clamp(head.lookYaw - dx * gain, LOOK.yawMin, LOOK.yawMax);
    head.lookPitch = clamp(head.lookPitch - dy * gain * 0.7, LOOK.pitchMin, LOOK.pitchMax);
  }
  /** Face the runway: straight out, eye level, naked eye. */
  function resetLook() {
    stopFollow('');
    head.lookYaw = 0;
    head.lookPitch = LOOK.defaultPitch;
    head.anchor = null;
    if (watch.binocular) lowerBinoculars();
    optics.target = 1;
    syncBinocular();
    publish();
  }

  // --- contacts ----------------------------------------------------------------
  /** True when the track is drawn and seen through the lounge glazing. */
  function contactVisible(t) {
    if (!t?.fix1 || !runtime.flight) return false;
    if ((t.horizonFade ?? 1) < 0.05) return false;
    drawnPoint(t, runtime.flight.pos, aim);
    eyePoint();
    return !!glazingFor(watch, aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
  }
  /**
   * The visible contact nearest the centre of view, within
   * VIEW.acquire.maxOffAxisDeg (scaled down with magnification), or null.
   */
  function acquire() {
    const items = runtime.traffic?.items;
    if (!items?.length || !runtime.flight) return null;
    eyePoint();
    const k0 = getTrueScaleK();
    const limit = Math.max(VIEW.acquire.maxOffAxisDeg * DEG, (fovForMag(optics.mag) * DEG) / 2);
    let best = null, bestScore = Infinity;
    for (const t of items) {
      if (!t.fix1 || t.stale === 2 || (t.horizonFade ?? 1) < 0.05) continue;
      drawnPoint(t, runtime.flight.pos, aim);
      const dx = aim.x - eye.x, dy = aim.y - eye.y, dz = aim.z - eye.z;
      if (!glazingFor(watch, dx, dy, dz)) continue;
      offsetAngles(dx, dy, dz, k0, watch.roomHeading, angles);
      const off = angularSeparation(angles.yaw, angles.pitch, head.yaw.x, head.pitch.x);
      if (off > limit) continue;
      // Prefer the centre, then the nearer aircraft.
      const score = off + (t.distM || 0) / 4e6;
      if (score < bestScore) {
        bestScore = score;
        best = t.hex;
      }
    }
    return best;
  }

  /** Legacy rows for the review harness: nearby contacts, runway side first. */
  function snapshot() {
    if (!watch.active) return [];
    eyePoint();
    return (runtime.traffic?.items || [])
      .map((t) => {
        const row = airportActivity(t, watch.seat, watch.frame.k, 45000);
        if (!row) return null;
        row.inFront = contactVisible(t);
        return row;
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.inFront) - Number(a.inFront) || a.distance - b.distance)
      .slice(0, 60);
  }

  /** The live board (cached VIEW.board.cacheMs: the HUD and the in-world screen both poll it). */
  function board() {
    const empty = { arrivals: [], departures: [], ground: [], overhead: [], local: [], at: 0 };
    if (!watch.active) return empty;
    const now = performance.now();
    if (boardCache && now - boardAt < VIEW.board.cacheMs) return boardCache;
    eyePoint();
    boardCache = buildBoard(runtime.traffic?.items || [], {
      eye: { x: eye.x, y: eye.y, z: eye.z }, k: watch.frame.k, ref: boardRef, fieldElev, runways, nowSec: now / 1000,
    }, boardMemo);
    boardAt = now;
    return boardCache;
  }

  // --- per frame ---------------------------------------------------------------
  function updateFollow(dt, now) {
    const t = runtime.traffic?.tracks.get(follow.hex);
    if (!t || t.stale === 2) {
      stopFollow('Contact lost. Returned to the airport view.');
      if (!t) watch.lostSelection = true;
      publish();
      return null;
    }
    // Aim where the aircraft will be drawn THIS frame: traffic positions are
    // last frame's (TrafficLayer updates at -45, after this -50 block).
    const lead = clamp(now - (t._lastUpdate ?? now), 0, 0.1);
    drawnPoint(t, runtime.flight.pos, aim, lead);
    const dx = aim.x - eye.x, dy = aim.y - eye.y, dz = aim.z - eye.z;
    offsetAngles(dx, dy, dz, getTrueScaleK(), watch.roomHeading, angles);
    if (!glazingFor(watch, dx, dy, dz)) {
      follow.hiddenAt ||= now;
      if (now - follow.hiddenAt > VIEW.head.lostAfterSec) {
        stopFollow('The aircraft passed behind the lounge walls. It stays selected.');
        publish();
        return null;
      }
    } else follow.hiddenAt = 0;
    const ty = clamp(angles.yaw, LOOK.yawMin, LOOK.yawMax);
    const tp = clamp(angles.pitch, LOOK.pitchMin, LOOK.pitchMax);
    if (!follow.primed) {
      follow.primed = true;
      follow.rateYaw = follow.ratePitch = 0;
    } else if (dt > 0) {
      // Angular rate of the target, low-passed: the spring's feed-forward.
      const a = 1 - Math.exp(-dt / VIEW.head.rateFilterSec);
      follow.rateYaw += (wrapPi(ty - follow.yaw) / dt - follow.rateYaw) * a;
      follow.ratePitch += ((tp - follow.pitch) / dt - follow.ratePitch) * a;
    }
    follow.yaw = ty;
    follow.pitch = tp;
    const omega = VIEW.head.followOmega + (VIEW.head.lockOmega - VIEW.head.followOmega) * optics.amount;
    springTo(head.yaw, head.yaw.x + wrapPi(ty - head.yaw.x), follow.rateYaw, omega, dt);
    springTo(head.pitch, tp, follow.ratePitch, omega, dt);
    head.lookYaw = head.yaw.x;
    head.lookPitch = head.pitch.x;
    follow.error = angularSeparation(head.yaw.x, head.pitch.x, ty, tp);
    return t;
  }

  function updateCamera(dt, camera) {
    const site = watch.site, p = { x: site.x, y: site.groundY, z: site.z };
    // A fixed seat; drag changes head orientation, never orbits/translates.
    // Cache the validated floor and revisit DEM twice per second. Streaming
    // refinements cannot move the room beneath the seated observer. A seat
    // still being chosen is not revealed: the lounge may yet move.
    const nowMs = performance.now();
    if (!watch.validated && !watch.seatPending && nowMs >= nextGroundSample) {
      nextGroundSample = nowMs + 500;
      const ground = groundAt(p);
      if (Number.isFinite(ground)) {
        watch.floorY = Math.max(p.y, ground) + site.floorM;
        watch.seat.set(p.x, watch.floorY, p.z);
        watch.validated = true;
        watch.notice = '';
        publish();
      }
    }
    if (!watch.validated) watch.seat.set(p.x, p.y + 1500, p.z);
    watch.roomHeading = site.heading;
    eyePoint();
    const now = nowMs / 1000;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    head.time += dt;

    // The selection may vanish from the feed while nothing follows it.
    if (watch.selected && !watch.tracking && !runtime.traffic?.tracks.get(watch.selected)) {
      follow.lostAt ||= now;
      if (now - follow.lostAt > 8) {
        watch.selected = null;
        watch.lostSelection = false;
        softLock(null);
        publish();
      }
    } else follow.lostAt = 0;

    // Optics first: the anchored zoom below needs this frame's field.
    const ceiling = watch.tracking ? slewMag(follow.error, optics.target) : optics.target;
    optics.mag = easeMag(optics.mag, Math.min(optics.target, ceiling), dt);
    optics.amount = maskAmount(optics.mag);
    const fov = fovForMag(optics.mag);
    const tanV = Math.tan((fov * DEG) / 2), tanH = tanV * (camera.aspect || 16 / 9);

    // Head.
    if (watch.tracking && follow.hex) updateFollow(dt, now);
    else if (watch.tracking && watch.selected) startFollow(watch.selected);
    if (!watch.tracking) {
      if (head.anchor && !head.keys.x && !head.keys.y) {
        // Zoom to cursor: solve the head that keeps the anchored direction
        // under the pointer at this frame's field of view.
        anchorHead(head.anchor.yaw, head.anchor.pitch, head.anchor.u, head.anchor.v, tanH, tanV, anchorOut);
        head.yaw.x = head.lookYaw = clamp(anchorOut.yaw, LOOK.yawMin, LOOK.yawMax);
        head.pitch.x = head.lookPitch = clamp(anchorOut.pitch, LOOK.pitchMin, LOOK.pitchMax);
        head.yaw.v = head.pitch.v = 0;
        if (optics.mag === optics.target) head.anchor = null; // easeMag lands exactly
      } else {
        const rate = VIEW.head.keyRateRad * (fov / VIEW.baseFovDeg);
        head.lookYaw = clamp(head.lookYaw - head.keys.x * rate * dt, LOOK.yawMin, LOOK.yawMax);
        head.lookPitch = clamp(head.lookPitch + head.keys.y * rate * dt, LOOK.pitchMin, LOOK.pitchMax);
        springTo(head.yaw, head.lookYaw, 0, VIEW.head.lookOmega, dt);
        springTo(head.pitch, head.lookPitch, 0, VIEW.head.lookOmega, dt);
      }
    }
    // Hard look limits (a fast follow can carry momentum into them).
    if (head.yaw.x < LOOK.yawMin || head.yaw.x > LOOK.yawMax) { head.yaw.x = clamp(head.yaw.x, LOOK.yawMin, LOOK.yawMax); head.yaw.v = 0; }
    if (head.pitch.x < LOOK.pitchMin || head.pitch.x > LOOK.pitchMax) { head.pitch.x = clamp(head.pitch.x, LOOK.pitchMin, LOOK.pitchMax); head.pitch.v = 0; }

    // Hand sway: only with the glasses up, stabilised while locked, never
    // for reduced motion. Applied to the camera only — the head state, the
    // follow and the board never see it.
    let swayYaw = 0, swayPitch = 0;
    if (optics.amount > 0 && !head.reduced) {
      const locked = watch.tracking && follow.error < (fov * DEG) / 8;
      const amp = VIEW.sway.fovFrac * fov * DEG * optics.amount * (locked ? VIEW.sway.lockedFrac : 1);
      handSway(head.time, amp, sway);
      swayYaw = sway.yaw;
      swayPitch = sway.pitch;
    }

    if (!cameraBefore) {
      cameraBefore = { near: camera.near, fov: camera.fov };
      cameraUsed = camera;
    }
    camera.position.copy(eye);
    camera.rotation.order = 'YXZ';
    // Head angles are what the observer perceives; TRUE_SCALE renders a scene
    // pitch p at atan(k0·tan p), so write the scene pitch that lands there.
    camera.rotation.set(scenePitch(head.pitch.x + swayPitch, getTrueScaleK()), watch.roomHeading + head.yaw.x + swayYaw, 0);
    if (camera.fov !== fov || camera.near !== NEAR) {
      const nearChanged = camera.near !== NEAR;
      camera.fov = fov;
      camera.near = NEAR;
      camera.updateProjectionMatrix();
      if (nearChanged) syncComposerCamera(camera);
    }
    watch.snap = false;
  }

  Object.assign(watch, {
    cancelPending() { request++; },
    enter, leave, select, join, chooseView, clearSelection,
    track(force) {
      if (!watch.selected) return;
      const on = force ?? !watch.tracking;
      if (on) startFollow(watch.selected);
      else stopFollow('');
      useFlyStore.getState().setInspectHex(null);
      publish();
    },
    binoculars, setMagnification, stepMagnification, zoomAt, acquire,
    zoomBy(delta) { zoomAt(delta); },
    move, dragLook, releaseLook, setLookKeys, resetLook,
    contactVisible: (hex) => contactVisible(runtime.traffic?.tracks.get(hex)),
    lockError: () => follow.error,
    snapshot, board, updateCamera,
  });
  runtime.airportWatch = watch;
  const unsubscribe = useFlyStore.subscribe((s) => s.airportBrowserOpen, (open, previous) => { if (previous && !open) request++; });
  registerRuntimeActions({ enterAirportObservation: enter, selectAirportContact: select, joinAirportContact: join, leaveAirportObservation: leave });
  return () => {
    disposed = true;
    unsubscribe();
    leave();
    request++;
    watch.active = false;
    setRunwayObservation(null);
    useFlyStore.setState({ airportWatch: null, airportReturn: null });
    delete runtime.airportWatch;
    registerRuntimeActions({ enterAirportObservation: null, selectAirportContact: null, joinAirportContact: null, leaveAirportObservation: null });
  };
}

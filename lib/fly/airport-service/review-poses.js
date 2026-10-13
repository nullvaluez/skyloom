/**
 * GATE TO GATE — the review pose hook (development only).
 *
 * installReviewPoses({ runtime, flight, operations }) installs
 * runtime.reviewOps for scripts/review-operations-airfield.cjs and returns a
 * release function. FlyScene calls it only when NODE_ENV === 'development'.
 * Certification harnesses never use it.
 *
 * Contract:
 *   runtime.reviewOps = {
 *     poses: string[],          // the runway poses available now
 *     gatePoses: string[],      // W3 (GATE_TO_GATE); pose() refuses them today
 *     pose(name, { aircraftId, reverse, hold }) -> { ok, name, airportId, runway, aircraftId, ..., reason? },
 *     hold(bool),               // runtime.simHold reason 'review'
 *     camera('chase'|'side'|'side-right'|'tower') -> { ok, camera, reason? },
 *     state() -> { phase, gear, throttle, speed, pos, geo, held, ... },
 *     ensureAirport(idOrIdent) -> Promise<registered runway id | null>,  // runway-catalog
 *     eligible(airportId, aircraftId) -> bool,                           // airportEligible
 *     readiness() -> worldReadiness(runtime, 0)  // every part, nothing deferred
 *   }
 *
 * Runway poses come from registry data only (lib/fly/operations-airports.js
 * airportFrame / airportPoint and the 3° path in operations-paths.js), at the
 * airport the operations session is at (operations.airport):
 *   lineup    on the centreline 65 m from the runway end (the game's own
 *             lineUp spot), parked, brake set
 *   roll40    40 kt on the takeoff roll, full power
 *   rotate    at Vr, where departurePathPoint puts rotation, nose up 0.12 rad
 *   final3nm  3 nm from the threshold on the 3° path, approach speed, gear down
 *   final1nm  1 nm, the same
 *   flare     wheels 3 m above the runway, 200 m past the threshold
 *   rollout   on the runway 700 m past the threshold after touchdown, slowing
 * Each pose writes the flight pose and the operations state together (phase,
 * gear, flaps, throttle, brake, vy, lowSpeed), then holds the sim through
 * runtime.simHold('review'), so the frame is stable until hold(false). The
 * operations integrator never runs while held, so no event is emitted and no
 * contact is judged. Releasing the hold lets the flight continue from the
 * pose (a final keeps flying the approach).
 *
 * Gate poses (stand, pushback, hold, taxiin, docked) need the W3 living apron
 * and are refused with a reason.
 *
 * Cameras: 'chase' is the game's chase rig, hard-cut onto the pose through the
 * title rig's needsSnap (FlyScene honours it every frame; the rig exists while
 * FRONT_DOOR ships on — without it the chase rig damps onto the pose).
 * 'side' / 'side-right' are a PLACEHOLDER on the photo-mode orbit rig: photo
 * mode is entered, which also hides the flight HUD and shows the photo bar.
 * The W2 CAMERA_DIRECTOR owns real side / tower / runway shots and replaces
 * this; 'tower' is refused until then.
 */
import { airportById, airportEligible, airportFrame, airportPoint } from '../operations-airports.js';
import { approachPathPoint, TOUCHDOWN_AIM_M } from '../operations-paths.js';
import { ensureAirport } from '../runway-catalog.js';
import { worldReadiness } from '../world-readiness.js';
import { useFlyStore } from '@/stores/fly-store';

export const REVIEW_RUNWAY_POSES = Object.freeze(['lineup', 'roll40', 'rotate', 'final3nm', 'final1nm', 'flare', 'rollout']);
export const REVIEW_GATE_POSES = Object.freeze(['stand', 'pushback', 'hold', 'taxiin', 'docked']);
export const REVIEW_CAMERAS = Object.freeze(['chase', 'side', 'side-right']);

const KT = 0.514444;
const NM = 1852;
const LINEUP_M = 65; // FlightOperations.lineUp's spot
const FLARE_PAST_M = 200;
const FLARE_WHEELS_M = 3;
const ROLLOUT_PAST_M = TOUCHDOWN_AIM_M + 450;
const ROTATE_PITCH = 0.12;
const FLARE_PITCH = 0.03;
const GLIDE = Math.tan(Math.PI / 60);

/**
 * The pure pose: where the aircraft is and what the operations state says,
 * for `name` at runway `airport` (a registry record) with operations profile
 * `profile`. `reverse` flies the reciprocal; `cruise` is
 * flight.cfg.speeds.cruise (the throttle scale). Returns null for an unknown
 * name.
 *
 * Distances are true metres along the runway from end a; positions are world
 * units (airportPoint applies the Mercator k); heights are metres MSL, with
 * `at.groundY` the runway profile height under the aircraft.
 */
export function reviewRunwayPose(name, airport, profile, { reverse = false, cruise = 250 } = {}) {
  if (!airport || !profile || !REVIEW_RUNWAY_POSES.includes(name)) return null;
  const length = airportFrame(airport).length;
  const dir = reverse ? -1 : 1;
  const heading = airportFrame(airport).heading + (reverse ? Math.PI : 0);
  const fromEnd = (d) => Math.max(0, Math.min(length, reverse ? length - d : d));
  const threshold = reverse ? length - (airport.thresholdB || 0) : airport.thresholdA || 0;
  const pastThreshold = (d) => Math.max(LINEUP_M, Math.min(length - LINEUP_M, threshold + dir * d));
  // departurePathPoint's own rotation distance, so the rotate pose sits where
  // the game's departure guidance expects the wheels to leave.
  const rollDist = (v) => (v * v) / (2 * profile.accel * 0.85);
  const rotation = Math.min(length * 0.7, Math.max(180, rollDist(profile.rotate)));
  const approachThrottle = Math.max(0, Math.min(1, profile.approach / cruise));
  const ground = (along, extra = 0) => {
    const p = airportPoint(airport, along);
    return { x: p.x, y: p.y + profile.clearance + extra, z: p.z, groundY: p.y, along };
  };
  const base = { lowSpeed: true, flaps: 1, gear: 1, vy: 0, approachRequested: false, taxiAssist: false };
  switch (name) {
    case 'lineup':
      return { name, at: ground(fromEnd(LINEUP_M)), heading, pitch: 0, speed: 0,
        ops: { ...base, phase: 'parked', throttle: 0, parkingBrake: true, routeIndex: 4 } };
    case 'roll40': {
      const v = 40 * KT;
      return { name, at: ground(fromEnd(LINEUP_M + rollDist(v))), heading, pitch: 0, speed: v,
        ops: { ...base, phase: 'takeoffRoll', throttle: 1, parkingBrake: false, routeIndex: 4 } };
    }
    case 'rotate':
      return { name, at: ground(fromEnd(LINEUP_M + rotation)), heading, pitch: ROTATE_PITCH, speed: profile.rotate,
        ops: { ...base, phase: 'takeoffRoll', throttle: 1, parkingBrake: false, routeIndex: 4 } };
    case 'final3nm':
    case 'final1nm': {
      const distance = name === 'final3nm' ? 3 * NM : NM;
      const p = approachPathPoint(airport, profile, reverse, distance);
      const pitch = -Math.PI / 60; // FlightOperations.retry's 3° attitude
      const groundY = p.y - profile.clearance - Math.max(0, distance + TOUCHDOWN_AIM_M) * GLIDE;
      return { name, at: { x: p.x, y: p.y, z: p.z, groundY, along: threshold - dir * distance }, heading, pitch, speed: profile.approach,
        ops: { ...base, phase: 'approach', throttle: approachThrottle, parkingBrake: false, vy: Math.sin(pitch) * profile.approach } };
    }
    case 'flare':
      return { name, at: ground(pastThreshold(FLARE_PAST_M), FLARE_WHEELS_M), heading, pitch: FLARE_PITCH, speed: profile.approach * 0.97,
        ops: { ...base, phase: 'approach', throttle: approachThrottle * 0.5, parkingBrake: false, vy: -0.8 } };
    case 'rollout':
      return { name, at: ground(pastThreshold(ROLLOUT_PAST_M)), heading, pitch: 0, speed: profile.approach * 0.55,
        ops: { ...base, phase: 'landingRoll', throttle: 0, parkingBrake: false, routeIndex: 0 } };
    default:
      return null;
  }
}

/** Install runtime.reviewOps (dev only — FlyScene's effect gates it). Returns the release. */
export function installReviewPoses({ runtime, flight, operations }) {
  if (!runtime || !flight || !operations) return () => {};
  let photoByUs = false;
  const hold = (on) => {
    runtime.simHold?.set('review', !!on);
    return !!runtime.simHold?.has('review');
  };
  const snapChase = () => {
    if (runtime.titleCam) runtime.titleCam.needsSnap = true;
  };
  const geoOf = () => runtime.engine?.worldToGeo?.(flight.pos) ?? null;
  const state = () => {
    const g = geoOf();
    return {
      phase: operations.phase, gear: operations.gear, flaps: operations.flaps, throttle: operations.throttle,
      parkingBrake: operations.parkingBrake, reverse: !!operations.reverse, runway: operations.runwayName ?? null,
      airportId: operations.airport?.id ?? null, aircraftId: operations.profile?.id ?? null,
      speed: flight.speed, heading: flight.heading, pitch: flight.pitch, bank: flight.bank,
      pos: { x: flight.pos.x, y: flight.pos.y, z: flight.pos.z }, groundElev: flight.groundElev, agl: flight.agl,
      geo: g ? { lat: g.y, lon: g.x } : null, held: !!runtime.simHold?.has('review'),
      camera: useFlyStore.getState().cameraMode,
    };
  };

  const pose = (name, { aircraftId, reverse, hold: holdIt = true } = {}) => {
    if (REVIEW_GATE_POSES.includes(name)) return { ok: false, name, reason: 'gate poses arrive with the W3 living apron (GATE_TO_GATE)' };
    if (!REVIEW_RUNWAY_POSES.includes(name)) return { ok: false, name, reason: `unknown pose '${name}'` };
    if (aircraftId && aircraftId !== operations.profile?.id) {
      const airportId = operations.airport?.id;
      if (!airportId || typeof runtime.beginDeparture !== 'function' || !runtime.beginDeparture(aircraftId, airportId, 'runway'))
        return { ok: false, name, reason: `cannot start ${aircraftId} at ${airportId ?? 'no airport'}` };
    }
    const airport = operations.airport, profile = operations.profile;
    if (!airport || !profile) return { ok: false, name, reason: 'no operations session (start a Takeoff & Landing flight first)' };
    const rev = reverse == null ? !!operations.reverse : !!reverse;
    const p = reviewRunwayPose(name, airport, profile, { reverse: rev, cruise: flight.cfg?.speeds?.cruise ?? 250 });
    if (!p) return { ok: false, name, reason: 'pose unavailable' };

    hold(true); // freeze before writing so no fixed step sees a half-written pose
    flight.pos.set(p.at.x, p.at.y, p.at.z);
    flight.heading = p.heading;
    flight.pitch = p.pitch;
    flight.bank = 0;
    flight.turnRate = 0;
    flight.pitchRate = 0;
    flight.speed = p.speed;
    flight.groundElev = p.at.groundY;
    flight.agl = p.at.y - p.at.groundY;
    flight.floorContact = null;
    const g = geoOf();
    if (g) flight.latDeg = g.y;

    const o = p.ops;
    Object.assign(operations, {
      reverse: rev, destination: airport.id, phase: o.phase, gear: o.gear, flaps: o.flaps, throttle: o.throttle,
      taxiAssist: o.taxiAssist, parkingBrake: o.parkingBrake, vy: o.vy, lowSpeed: o.lowSpeed,
      approachRequested: o.approachRequested, accumulator: 0, bounced: false, bounceCooldown: 0,
      routeWarning: null, reason: null, freeRoam: false,
      assisted: true, // a teleport is an assist, like lineUp / retry
    });
    if (o.routeIndex != null) operations.routeIndex = o.routeIndex;
    if (o.phase === 'landingRoll') {
      operations.arrivalExit = null;
      operations.lastTouchdown = { sink: 1, quality: 'Smooth', airport: airport.id };
      operations.contactCount = Math.max(1, operations.contactCount || 0);
    } else if (o.phase !== 'approach') {
      operations.lastTouchdown = null;
    }

    if (g) {
      runtime.geo = g;
      runtime.engine?.notifyWarp?.(g.x, g.y); // the terrain prefetch burst a warp gets
    }
    snapChase();
    if (!holdIt) hold(false);
    return {
      ok: true, name, airportId: airport.id, ident: airport.ident ?? airport.id, runwayName: operations.runwayName ?? null,
      aircraftId: profile.id, along: +p.at.along.toFixed(1), heightM: +(p.at.y - p.at.groundY).toFixed(2),
      ...state(),
    };
  };

  const camera = (name = 'chase') => {
    const store = useFlyStore.getState();
    if (name === 'chase') {
      if (photoByUs && store.cameraMode === 'photo') store.setCameraMode('chase');
      photoByUs = false;
      snapChase();
      return { ok: true, camera: 'chase' };
    }
    if (name === 'side' || name === 'side-right') {
      const rig = runtime.photoRig;
      if (!rig?._look) return { ok: false, camera: name, reason: 'photo rig not mounted' };
      // Placeholder until the W2 CAMERA_DIRECTOR: the photo orbit rig, square
      // to the left (or right) wing, a shade above the wing line.
      const dist = Math.max(25, Math.min(600, (operations.profile?.length ?? 20) * 1.8 + 20));
      rig._look.yaw = name === 'side' ? Math.PI / 2 : -Math.PI / 2;
      rig._look.pitch = 0.05;
      rig._dist = rig._distTarget = dist;
      rig._initialized = false; // the first frame places the camera without damping
      if (store.cameraMode !== 'photo') {
        store.setCameraMode('photo');
        photoByUs = true;
      }
      return { ok: true, camera: name, placeholder: true, distM: dist };
    }
    if (name === 'tower') return { ok: false, camera: name, reason: 'tower shots arrive with the W2 CAMERA_DIRECTOR (towerPoint)' };
    return { ok: false, camera: name, reason: `unknown camera '${name}'` };
  };

  const api = {
    poses: REVIEW_RUNWAY_POSES, gatePoses: REVIEW_GATE_POSES, cameras: REVIEW_CAMERAS, pose, hold, camera, state,
    // A catalog ident resolves to its longest runway (ensureAirport); its rows load on demand.
    ensureAirport: async (id) => (await ensureAirport(id))?.id ?? null,
    eligible: (airportId, aircraftId) => airportEligible(airportById(airportId), aircraftId),
    readiness: () => worldReadiness(runtime, 0),
  };
  runtime.reviewOps = api;
  return () => {
    if (runtime.reviewOps === api) delete runtime.reviewOps;
    runtime.simHold?.set('review', false);
    if (photoByUs && useFlyStore.getState().cameraMode === 'photo') useFlyStore.getState().setCameraMode('chase');
  };
}

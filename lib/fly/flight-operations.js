import { airportById, airportEligible, airportPoint, airportLocal, airportFrame, nearestOperationsAirport, taxiRoute } from './operations-airports.js';
import { operationsProfile } from './operations-profiles.js';
import { clamp, angle } from './ops/util.js';
import { surfaceAt } from './ops/contact.js';
import { groundIntegrate, pavementEdge, advanceRouteMarker } from './ops/ground-step.js';
import { airIntegrate } from './ops/air-step.js';
import { judgeContact } from './ops/touchdown.js';
import { completeOnRunway, completeAtStand } from './ops/completion.js';
import { runwayForWind, guideApproach, approachGuidance, groundRoute, updateArrivalExit, guidanceTarget } from './ops/guidance.js';

export { runwayForWind } from './ops/guidance.js';

/** Phases in which the wheels are on the ground (FlightOperations.grounded). */
export const GROUND_PHASES = new Set(['parked', 'taxiOut', 'takeoffRoll', 'landingRoll', 'taxiIn']);

/**
 * Deep copy of operations state for snapshot()/restore(). Plain objects,
 * arrays and typed arrays are copied; frozen objects and class instances are
 * shared by reference. SHARED_KEYS are references by contract (the registry
 * airport, whose identity callers compare, and the profile), never copied.
 */
const SHARED_KEYS = new Set(['airport', 'profile', 'ground']);
function cloneState(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value.slice();
  if (Array.isArray(value)) return value.map(cloneState);
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = cloneState(value[key]);
  return out;
}

/**
 * Owns one player flight. No React, renderer, storage, or network dependencies.
 * advance returns true when it owns the motion step; false delegates to cruise.
 * Contact/events only originate inside fixed-step integration. No renderer or
 * terrain-streaming callback may manufacture a touchdown.
 *
 * The step is split into readable modules under lib/fly/ops/ (ground-step,
 * air-step, contact, touchdown, completion, guidance); this class keeps the
 * state machine and every public field and method name.
 * scripts/verify-ops-golden.mjs proves the trajectories byte-identical.
 */
export class FlightOperations {
  constructor() {
    this.phase = 'hangar';
    this.accumulator = 0;
    this.throttle = 0;
    this.parkingBrake = true;
    this.events = [];
    this.elapsed = 0;
    this.sequence = 0;
    this.assisted = false;
    this.guidance = true;
    this.gear = 1;
    this.flaps = 1;
    this.vy = 0;
    this.routeIndex = 1;
    this.parkTime = 0;
    this.contactCount = 0;
    this.takeoffs = 0;
    this.summary = null;
  }

  get grounded() {
    return GROUND_PHASES.has(this.phase);
  }

  setThrottle(value) {
    this.throttle = clamp(value, 0, 1);
    this.taxiAssist = false;
  }

  toggleBrake() {
    this.parkingBrake = !this.parkingBrake;
  }

  toggleGuidance() {
    this.guidance = !this.guidance;
  }

  setPowerPreset(index) {
    this.throttle = [0, 0.45, 1][index];
    this.taxiAssist = index === 1;
  }

  startTaxi() {
    if (!this.grounded) return false;
    this.setPowerPreset(1);
    this.parkingBrake = false;
    return true;
  }

  takeoffStatus(flight) {
    if (!this.grounded || !this.airport) return { aligned: false, ready: false };
    const surface = surfaceAt(this, flight.pos.x, flight.pos.z);
    if (surface?.kind !== 'runway') return { aligned: false, ready: false };
    const error = Math.abs(angle(flight.heading - airportFrame(surface.airport).heading));
    return {
      aligned: Math.min(error, Math.abs(Math.PI - error)) < 0.18 && Math.abs(surface.cross) < surface.airport.width * 0.4,
      ready: flight.speed >= this.profile.rotate,
      reverse: error > Math.PI / 2,
    };
  }

  startTakeoff(flight) {
    const status = this.takeoffStatus(flight);
    if (!status.aligned || !['parked', 'taxiOut', 'takeoffRoll'].includes(this.phase)) return false;
    this.reverse = status.reverse;
    this.parkingBrake = false;
    this.setPowerPreset(2);
    this.phase = 'takeoffRoll';
    return true;
  }

  /** Assisted shortcut: place the aircraft stationary on the runway centreline, 65 m in. */
  lineUp(flight) {
    if (!this.profile || !['parked', 'taxiOut'].includes(this.phase)) return false;
    const frame = airportFrame(this.airport);
    const point = airportPoint(this.airport, this.reverse ? frame.length - 65 : 65);
    flight.pos.set(point.x, point.y + this.profile.clearance, point.z);
    flight.heading = frame.heading + (this.reverse ? Math.PI : 0);
    flight.speed = 0;
    flight.pitch = 0;
    flight.bank = 0;
    flight.turnRate = 0;
    flight.pitchRate = 0;
    flight.groundElev = point.y;
    flight.agl = this.profile.clearance;
    flight.floorContact = null;
    this.phase = 'parked';
    this.parkingBrake = true;
    this.setPowerPreset(0);
    this.vy = 0;
    this.accumulator = 0;
    this.routeWarning = null;
    this.routeIndex = 4;
    this.assisted = true;
    this.emit('runway-lineup');
    return true;
  }

  setApproachRunway(reverse) {
    if (!this.grounded) this.reverse = !!reverse;
  }

  returnToHangar() {
    this.phase = 'hangar';
  }

  markSaved() {
    this.saved = true;
  }

  goAround(flight) {
    if (this.grounded || !this.profile) return false;
    this.phase = 'airborne';
    this.approachRequested = false;
    this.throttle = 1;
    this.taxiAssist = false;
    this.lastTouchdown = null;
    this.parkingBrake = false;
    // The action must arrest the descent, not merely add power while leaving
    // a nose-down approach pointed at the runway. Pilot steering remains live.
    if (flight) {
      flight.pitch = Math.max(flight.pitch, 0.1);
      flight.pitchRate = 0;
      this.vy = Math.max(0, this.vy);
    }
    this.emit('go-around');
    return true;
  }

  setApproachPower(flight) {
    if (this.grounded || !this.profile) return false;
    this.setThrottle(this.profile.approach / flight.cfg.speeds.cruise);
    return true;
  }

  chooseRunway(wind) {
    const a = this.airport;
    if (!a) return;
    this.reverse = runwayForWind(a, wind);
  }

  get runwayName() {
    return this.reverse ? this.airport?.reciprocal : this.airport?.runway;
  }

  emit(type, detail = {}) {
    this.events.push({ id: ++this.sequence, type, ...detail });
    if (this.events.length > 32) this.events.shift();
  }

  begin(flight, aircraftId, airportId) {
    const a = airportById(airportId);
    const profile = operationsProfile(aircraftId);
    if (!profile || !airportEligible(a, aircraftId)) return false;
    this.profile = profile;
    this.freeRoam = false;
    this.departure = a.id;
    this.destination = a.id;
    this.airport = a;
    this.phase = 'parked';
    this.reverse = false;
    this.throttle = 0;
    this.taxiAssist = false;
    this.parkingBrake = true;
    this.elapsed = 0;
    this.assisted = false;
    this.summary = null;
    this.saved = false;
    this.reason = null;
    this.bounced = false;
    this.bounceCooldown = 0;
    this.contactCount = 0;
    this.takeoffs = 0;
    this.events = [];
    this.vy = 0;
    this.accumulator = 0;
    this.routeIndex = 1;
    this.parkTime = 0;
    this.gear = 1;
    this.flaps = 1;
    this.lastTouchdown = null;
    this.approachRequested = false;
    this.arrivalExit = null;
    this.routeWarning = null;
    const route = taxiRoute(a);
    const p = airportPoint(a, ...route[0]);
    const q = airportPoint(a, ...route[1]);
    flight.pos.set(p.x, p.y + profile.clearance, p.z);
    flight.heading = Math.atan2(q.x - p.x, -(q.z - p.z));
    flight.speed = 0;
    flight.pitch = 0;
    flight.bank = 0;
    flight.pitchRate = 0;
    flight.turnRate = 0;
    flight.groundElev = p.y;
    flight.agl = profile.clearance;
    flight.latDeg = a.a.lat;
    flight.floorContact = null;
    flight._trimT = 0;
    flight.operations = this;
    this.emit('departure');
    return true;
  }

  selectDestination(id) {
    const a = airportById(id);
    if (!airportEligible(a, this.profile?.id)) return false;
    this.destination = id;
    this.approachRequested = false;
    if (this.phase === 'approach') this.phase = 'airborne';
    return true;
  }

  guideApproach(flight, wind) {
    return guideApproach(this, flight, wind);
  }

  approachGuidance(flight) {
    return approachGuidance(this, flight);
  }

  groundRoute() {
    return groundRoute(this);
  }

  updateArrivalExit(flight) {
    updateArrivalExit(this, flight);
  }

  warp(flight) {
    if (this.phase === 'hangar') return;
    this.assisted = true;
    this.phase = 'airborne';
    this.approachRequested = false;
    this.parkingBrake = false;
    this.gear = this.profile?.fixedGear ? 1 : 0;
    this.flaps = 0;
    this.lowSpeed = false;
    this.vy = Math.sin(flight.pitch) * flight.speed;
    this.accumulator = 0;
    this.contactCount = 0;
    this.lastTouchdown = null;
    this.emit('warp');
  }

  /** Assisted shortcut: a stabilised final 3 km out on the 3° path at approach speed. */
  retry(flight) {
    const a = airportById(this.destination) || this.airport;
    if (!a || !this.profile) return false;
    const f = airportFrame(a);
    const p = airportPoint(a, this.reverse ? f.length - (a.thresholdB || 0) + 3000 : (a.thresholdA || 0) - 3000);
    const height = this.profile.clearance + 3250 * Math.tan(Math.PI / 60);
    flight.pos.set(p.x, p.y + height, p.z);
    flight.heading = f.heading + (this.reverse ? Math.PI : 0);
    flight.pitch = -Math.PI / 60;
    flight.bank = 0;
    flight.speed = this.profile.approach;
    flight.groundElev = p.y;
    flight.latDeg = a.a.lat;
    flight.floorContact = null;
    flight.turnRate = 0;
    flight.pitchRate = 0;
    flight.agl = height;
    this.airport = a;
    this.reason = null;
    this.bounced = false;
    this.bounceCooldown = 0;
    this.phase = 'approach';
    this.lowSpeed = true;
    this.approachRequested = false;
    this.assisted = true;
    this.vy = Math.sin(flight.pitch) * flight.speed;
    this.throttle = clamp(this.profile.approach / flight.cfg.speeds.cruise, 0, 1);
    this.parkingBrake = false;
    this.accumulator = 0;
    this.gear = 1;
    this.lastTouchdown = null;
    this.emit('retry');
    return true;
  }

  advance(dt, flight, cmd, held = false) {
    flight.operations = this;
    if (held || this.phase === 'hangar' || this.phase === 'completed' || this.phase === 'crashed') {
      this.accumulator = 0;
      return true;
    }
    // Free Flight deliberately has no operations profile. Its airborne start
    // must not inherit the hangar/departure gear value and hold it forever.
    if (!this.profile) {
      this.gear = 0;
      this.flaps = 0;
      const nearest = nearestOperationsAirport(flight.pos.x, flight.pos.z);
      const a = nearest.airport;
      const local = airportLocal(a, flight.pos.x, flight.pos.z);
      const frame = airportFrame(a);
      const facing = Math.cos(flight.heading - frame.heading);
      const aligned = Math.abs(facing) > Math.cos((35 * Math.PI) / 180);
      const approaching = (local.along < frame.length / 2 && facing > 0) || (local.along > frame.length / 2 && facing < 0);
      const funnel = cmd.speedPreset === 'slow' && nearest.distance < 8000 && flight.pos.y - airportPoint(a, local.along).y < 800 &&
        Math.abs(local.cross) < 600 && aligned && approaching && airportEligible(a, this.freeAircraftId);
      if (funnel) {
        this.profile = operationsProfile(this.freeAircraftId);
        this.airport = a;
        this.destination = a.id;
        this.departure = null;
        this.phase = 'airborne';
        this.freeRoam = true;
        this.setThrottle(flight.speed / flight.cfg.speeds.cruise);
        this.vy = Math.sin(flight.pitch) * flight.speed;
        this.guideApproach(flight);
      } else return false;
    }
    this.elapsed += Math.min(dt, 0.1);
    const nearest = nearestOperationsAirport(flight.pos.x, flight.pos.z);
    const fieldY = nearest.distance < 4000
      ? airportPoint(nearest.airport, airportLocal(nearest.airport, flight.pos.x, flight.pos.z).along).y
      : flight.groundElev;
    const agl = flight.pos.y - fieldY;
    if (this.freeRoam && !this.grounded && (nearest.distance > 9000 || agl > 850)) {
      this.profile = null;
      this.airport = null;
      this.destination = null;
      this.phase = 'airborne';
      this.approachRequested = false;
      this.gear = 0;
      this.flaps = 0;
      this.lowSpeed = false;
      return false;
    }
    if (this.approachRequested && !this.grounded && nearest.airport.id === this.destination && nearest.distance < 5500 && agl < 500) {
      this.phase = 'approach';
      this.approachRequested = false;
      this.emit('approach');
    }
    const wasLowSpeed = this.lowSpeed;
    // Keep the current owner through a small band at the envelope boundary.
    // Otherwise a descending turn near 500 m can swap flight models each frame.
    this.lowSpeed = this.grounded || this.phase === 'approach' || (nearest.distance < (wasLowSpeed ? 6000 : 5500) && agl < (wasLowSpeed ? 550 : 500));
    if (this.lowSpeed && wasLowSpeed === false && !this.grounded && this.phase !== 'approach') {
      this.setThrottle(flight.speed / flight.cfg.speeds.cruise);
      this.vy = Math.sin(flight.pitch) * flight.speed;
    }
    // Gear follows the flight phase, not the low-speed physics owner. A low
    // pass or a go-around must not extend the wheels just by nearing an airport.
    // Keep them through initial lift-off, then take 2.5 seconds to retract.
    const gearDown = this.profile.fixedGear || this.grounded || this.phase === 'approach' || (this.gear === 1 && agl < this.profile.clearance + 15);
    const gearStep = Math.min(Math.max(dt, 0), 0.1) / 2.5;
    this.gear = gearDown ? Math.min(1, this.gear + gearStep) : Math.max(0, this.gear - gearStep);
    if (!this.lowSpeed) {
      this.flaps = 0;
      this.vy = Math.sin(flight.pitch) * flight.speed;
      return false;
    }
    this.flaps = 1;
    this.throttle = clamp(Number.isFinite(cmd.throttle) ? cmd.throttle : this.throttle + (cmd.throttleDelta || 0) * dt * 0.35, 0, 1);
    if (cmd.throttleDelta) this.taxiAssist = false;
    if (cmd.powerPreset != null) this.setPowerPreset(cmd.powerPreset);
    if (cmd.toggleParkingBrake) this.parkingBrake = !this.parkingBrake;
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    while (this.accumulator >= 1 / 120) {
      this.step(1 / 120, flight, cmd);
      this.accumulator -= 1 / 120;
    }
    return true;
  }

  /** One fixed 120 Hz integration step. The only place events originate. */
  step(dt, f, cmd) {
    if (this.phase === 'crashed' || this.phase === 'completed') return;
    const p = this.profile;
    const surface = surfaceAt(this, f.pos.x, f.pos.z);
    const wasGrounded = this.grounded;
    const ground = surface?.height ?? f.groundElev;
    const floor = ground + p.clearance;
    this.bounceCooldown = Math.max(0, (this.bounceCooldown || 0) - dt);
    const brake = clamp(cmd.brake || 0, 0, 1);
    if (wasGrounded) {
      if (groundIntegrate(this, f, cmd, dt, surface, floor, brake)) return;
    } else airIntegrate(this, f, cmd, dt);
    const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
    f.pos.x += Math.sin(f.heading) * f.speed * Math.cos(f.pitch) * k * dt;
    f.pos.z -= Math.cos(f.heading) * f.speed * Math.cos(f.pitch) * k * dt;
    const contact = surfaceAt(this, f.pos.x, f.pos.z);
    const groundAfter = contact?.height ?? ground;
    if (pavementEdge(this, f, wasGrounded, contact)) return;
    if (judgeContact(this, f, contact, groundAfter)) return;
    completeOnRunway(this, f);
    if (this.phase === 'taxiIn' || this.phase === 'landingRoll') this.updateArrivalExit(f);
    completeAtStand(this, f, dt, k);
    advanceRouteMarker(this, f, k);
    f.groundElev = groundAfter;
    f.agl = f.pos.y - groundAfter;
    f.floorContact = null;
    f.boosting = false;
  }

  fail(reason) {
    this.phase = 'crashed';
    this.reason = reason;
    this.emit('crashed', { reason });
  }

  guidanceTarget(f) {
    return guidanceTarget(this, f);
  }

  /**
   * A deep copy of the operations state (nested telemetry, route and gate
   * state included) for the lounge join rollback and bookmarks. Registry
   * airports are shared by reference; they are frozen.
   */
  snapshot() {
    const out = {};
    for (const key of Object.keys(this)) out[key] = SHARED_KEYS.has(key) ? this[key] : cloneState(this[key]);
    return out;
  }

  /** Restore a snapshot() exactly: keys added since are removed, nested state is copied back. */
  restore(snap) {
    for (const key of Object.keys(this)) if (!(key in snap)) delete this[key];
    for (const key of Object.keys(snap)) this[key] = SHARED_KEYS.has(key) ? snap[key] : cloneState(snap[key]);
  }
}

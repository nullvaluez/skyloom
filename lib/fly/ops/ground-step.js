/**
 * Operations ground step: wheels-on-the-ground integration, the pavement
 * edge rules and the taxi-route marker. Called only from
 * FlightOperations.step inside the fixed 120 Hz integration.
 *
 * Each function that can end the step (a failure) returns true; the caller
 * returns immediately, exactly as the pre-split inline `return` did.
 */
import { airportPoint } from '../operations-airports.js';
import { clamp } from './util.js';

/** Speed, steering, attitude and phase changes while grounded. */
export function groundIntegrate(ops, f, cmd, dt, surface, floor, brake) {
  const p = ops.profile;
  const thrust = ops.taxiAssist ? Math.min(ops.throttle, Math.max(0, (p.taxiSpeed - f.speed) * 0.5)) : ops.throttle;
  f.speed = Math.max(0, f.speed + (thrust * p.accel - (0.1 + f.speed * 0.012) - brake * p.braking - (ops.parkingBrake ? p.braking * 2 : 0)) * dt);
  if (ops.parkingBrake && f.speed < 0.1) f.speed = 0;
  // Nose-wheel authority arrives at walking speed. A small powered
  // steering floor makes tight turns recoverable without a run-up.
  const steering = ops.parkingBrake || brake > 0.5
    ? 0
    : Math.min(p.length > 40 ? 0.65 : 0.8, (ops.throttle > 0 ? 0.22 : 0) + f.speed * 0.12) / (1 + f.speed * 0.04);
  f.heading += clamp(cmd.turn || 0, -1, 1) * steering * dt;
  f.bank = 0;
  f.pitch += ((f.speed >= p.rotate * 0.85 ? clamp((cmd.pitch || 0) * 0.18, 0, 0.18) : 0) - f.pitch) * Math.min(1, dt * 3);
  f.pos.y = floor;
  ops.vy = 0;
  if (ops.phase === 'parked' && f.speed > 0.3) ops.phase = 'taxiOut';
  if (ops.phase === 'taxiOut' && surface?.kind === 'runway' && f.speed > p.taxiSpeed * 1.5) ops.phase = 'takeoffRoll';
  if (ops.phase === 'takeoffRoll' && f.speed < p.taxiSpeed && ops.throttle < 0.5) ops.phase = 'taxiOut';
  if (surface?.kind === 'runway' && f.speed >= p.rotate && f.pitch > 0.065 && !ops.parkingBrake) {
    ops.phase = 'airborne';
    ops.vy = 2;
    f.pos.y += 0.03;
    ops.takeoffs++;
    ops.emit(ops.lastTouchdown ? 'touch-and-go' : 'takeoff', { airport: ops.airport.id });
    ops.lastTouchdown = null;
  }
  if (!surface && f.speed > p.taxiSpeed * 2) {
    ops.fail('Runway excursion — reduce speed before leaving the pavement.');
    return true;
  }
  return false;
}

/**
 * After the move: a grounded aircraft that left the pavement. Fast is an
 * excursion; slow is a recoverable shoulder (speed capped, a route warning).
 */
export function pavementEdge(ops, f, wasGrounded, contact) {
  const p = ops.profile;
  if (wasGrounded && ops.grounded && !contact) {
    if (f.speed > p.taxiSpeed * 2) {
      ops.fail('Runway excursion — brake earlier and stay on the pavement.');
      return true;
    }
    // Low-speed shoulder contact is recoverable. Rewinding the position and
    // setting speed to zero made an invisible wall: steering also depended
    // on speed, so a slightly wide taxi turn could permanently trap a plane.
    // Let the player crawl and steer back. Rotation still requires runway
    // contact, and the high-speed excursion check above remains unchanged.
    f.speed = Math.min(f.speed, p.taxiSpeed * 0.65);
    ops.routeWarning = 'Off the pavement. Use taxi power and steer back to the marked route.';
  } else ops.routeWarning = null;
  return false;
}

/** Advance the ground-route marker when the aircraft reaches its junction. */
export function advanceRouteMarker(ops, f, k) {
  if (!(ops.grounded && ops.phase !== 'landingRoll')) return;
  const route = ops.groundRoute();
  ops.routeIndex = Math.min(ops.routeIndex, route.length - 1);
  const point = airportPoint(ops.airport, ...route[ops.routeIndex]);
  // Switch at the junction, not 25 m before a 20 m-wide KOSU connector.
  // Early marker changes encouraged diagonal shortcuts across the grass.
  const turnDistance = ops.airport.id === 'KOSU' ? 8 : 18;
  if (Math.hypot(f.pos.x - point.x, f.pos.z - point.z) / k < turnDistance && ops.routeIndex < route.length - 1) ops.routeIndex++;
}

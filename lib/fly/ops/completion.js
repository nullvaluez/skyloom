/**
 * Operations completion: when a landed flight is over, and the summary row
 * the logbook stores. Called only from FlightOperations.step.
 */
import { airportPoint, taxiRoute } from '../operations-airports.js';

/** The completed-flight summary (the v1 'fly-flight-history' row shape). */
export function flightSummary(ops) {
  return {
    aircraft: ops.profile.id,
    departure: ops.departure,
    destination: ops.destination,
    duration: Math.round(ops.elapsed),
    touchdown: ops.lastTouchdown?.quality || 'Practice',
    assisted: ops.assisted,
    at: Date.now(),
  };
}

function complete(ops) {
  ops.phase = 'completed';
  ops.summary = flightSummary(ops);
  ops.emit('completed', ops.summary);
}

/**
 * The rollout ends: at an authored airport the flight taxis in; at a catalog
 * runway (no stand) it completes once stopped with the parking brake set.
 */
export function completeOnRunway(ops, f) {
  const p = ops.profile;
  if (ops.phase === 'landingRoll' && f.speed <= p.taxiSpeed && ops.airport.authored !== false) ops.phase = 'taxiIn';
  if (ops.phase === 'landingRoll' && ops.airport.authored === false && f.speed < 0.5 && ops.parkingBrake) complete(ops);
}

/** Taxi-in ends parked at the stand: stopped, parking brake set, for 2 s. */
export function completeAtStand(ops, f, dt, k) {
  if (ops.phase !== 'taxiIn') return;
  const p = ops.profile;
  const stand = airportPoint(ops.airport, ...taxiRoute(ops.airport)[0]);
  const inStand = Math.hypot(f.pos.x - stand.x, f.pos.z - stand.z) / k < Math.max(12, p.length * 0.45);
  ops.parkTime = inStand && f.speed < 0.5 && ops.parkingBrake ? ops.parkTime + dt : 0;
  if (ops.parkTime >= 2) complete(ops);
}

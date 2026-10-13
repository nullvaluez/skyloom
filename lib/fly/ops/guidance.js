/**
 * Operations guidance: runway choice, approach capture and the approach
 * path, the ground route and its arrival exit, and the guidance target the
 * HUD aims at. Reads never advance route state.
 */
import { airportById, airportEligible, airportFrame, airportLocal, airportPoint, airportTaxiExits, taxiRoute } from '../operations-airports.js';
import { approachPathPoint } from '../operations-paths.js';
import { angle } from './util.js';
import { placementHeight } from './contact.js';

/**
 * Runway direction for a wind: true (use the reciprocal) when the wind
 * vector's component along the runway's forward axis exceeds 1 m/s. No usable
 * wind keeps the forward direction. Pure; FlightOperations.chooseRunway uses it.
 */
export function runwayForWind(airport, wind) {
  const f = airportFrame(airport);
  return Number.isFinite(wind?.windX) && Number.isFinite(wind?.windZ) && wind.windX * f.ux + wind.windZ * f.uz > 1;
}

export function guideApproach(ops, flight, wind) {
  const a = airportById(ops.destination);
  if (ops.grounded || !flight || !airportEligible(a, ops.profile?.id)) return false;
  // Keep an assigned runway for a return circuit. At another airport wind
  // supplies the default, but an established final takes precedence.
  const sameAirport = ops.airport?.id === a.id;
  ops.airport = a;
  if (!sameAirport) ops.chooseRunway(wind);
  const local = airportLocal(a, flight.pos.x, flight.pos.z);
  const frame = airportFrame(a);
  const facing = Math.cos(flight.heading - frame.heading);
  if (Math.abs(local.cross) < 1500 && ((local.along < 0 && facing > 0.7) || (local.along > frame.length && facing < -0.7))) ops.reverse = facing < 0;
  ops.approachRequested = true;
  const distance = Math.hypot(local.cross, Math.max(0, -local.along, local.along - frame.length));
  const under = airportPoint(a, local.along);
  const agl = flight.pos.y - placementHeight(ops, under.x, under.z, under.y);
  if (distance < 5500 && agl < 500) {
    ops.phase = 'approach';
    ops.approachRequested = false;
    ops.emit('approach', { airport: a.id, runway: ops.runwayName });
  }
  return true;
}

export function approachGuidance(ops, flight) {
  const a = ops.airport;
  const local = airportLocal(a, flight.pos.x, flight.pos.z);
  const length = airportFrame(a).length;
  const distance = ops.reverse ? local.along - (length - (a.thresholdB || 0)) : (a.thresholdA || 0) - local.along;
  // Three-degree path runs to the touchdown aim point, 250 m beyond the
  // threshold, rather than levelling at 12 m over the whole runway.
  const targetHeight = approachPathPoint(a, ops.profile, ops.reverse, distance).y;
  const headingError = angle(airportFrame(a).heading + (ops.reverse ? Math.PI : 0) - flight.heading);
  return { distance, lateral: local.cross * (ops.reverse ? -1 : 1), vertical: flight.pos.y - targetHeight, targetHeight, headingError };
}

export function groundRoute(ops) {
  return taxiRoute(ops.airport, ops.phase === 'taxiIn' || ops.phase === 'landingRoll', ops.reverse, ops.arrivalExit ?? undefined);
}

export function updateArrivalExit(ops, flight) {
  if (ops.airport.authored === false) return;
  const local = airportLocal(ops.airport, flight.pos.x, flight.pos.z);
  const direction = ops.reverse ? -1 : 1;
  // Pick ahead of the rollout. If the player passes an exit while still on
  // the runway, advance to the next connector rather than pointing behind.
  if (ops.routeIndex > 1 || Math.abs(local.cross) > ops.airport.width / 2) return;
  if (ops.arrivalExit != null && (ops.arrivalExit - local.along) * direction >= -20) return;
  const exits = airportTaxiExits(ops.airport).sort((a, b) => (a - b) * direction);
  ops.arrivalExit = exits.find((s) => (s - local.along) * direction >= -20) ?? exits.at(-1);
  ops.routeIndex = 0;
}

export function guidanceTarget(ops, f) {
  if (!ops.airport || ['hangar', 'crashed', 'completed'].includes(ops.phase)) return null;
  if (ops.phase === 'takeoffRoll') return airportPoint(ops.airport, ops.reverse ? 65 : airportFrame(ops.airport).length - 65);
  if (ops.grounded && ops.airport.authored === false) return airportPoint(ops.airport, ops.reverse ? 65 : airportFrame(ops.airport).length - 65);
  if (ops.grounded) {
    const route = ops.groundRoute();
    return airportPoint(ops.airport, ...route[Math.min(ops.routeIndex, route.length - 1)]);
  }
  const a = airportById(ops.destination);
  const local = airportLocal(a, f.pos.x, f.pos.z);
  const length = airportFrame(a).length;
  const before = ops.reverse ? local.along > length + 3500 : local.along < -3500;
  const point = airportPoint(a, ops.reverse ? (before ? length + 3000 : length - (a.thresholdB || 0) - 250) : before ? -3000 : (a.thresholdA || 0) + 250);
  point.y += before ? 160 : 12;
  return point;
}

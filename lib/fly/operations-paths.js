import { airportFrame, airportLocal, airportPoint } from './operations-airports.js';

export const APPROACH_SLOPE = Math.tan(Math.PI / 60);
export const TOUCHDOWN_AIM_M = 250;
export function approachPathPoint(airport, profile, reverse, distance) {
  const length = airportFrame(airport).length;
  const threshold = reverse ? length - (airport.thresholdB || 0) : (airport.thresholdA || 0);
  const point = airportPoint(airport, threshold + (reverse ? distance : -distance));
  point.y += profile.clearance + Math.max(0, distance + TOUCHDOWN_AIM_M) * APPROACH_SLOPE;
  return point;
}

/** Rounded centreline, bounded inside the narrowest taxiway intersection.
 * Unlike an interpolating spline, quadratic corner cuts never overshoot the
 * pavement or loop at short/repeated segments. Coordinates are true metres. */
export function roundedGroundRoute(route, radius = 7, spacing = 4) {
  const points = [];
  const add = (p) => {
    const last = points.at(-1);
    if (!last) { points.push([...p]); return; }
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - last[0], p[1] - last[1]) / spacing));
    for (let i = 1; i <= n; i++) points.push([last[0] + (p[0] - last[0]) * i / n, last[1] + (p[1] - last[1]) * i / n]);
  };
  if (!route.length) return points;
  add(route[0]);
  for (let i = 1; i < route.length - 1; i++) {
    const a = route[i - 1], b = route[i], c = route[i + 1];
    const l0 = Math.hypot(b[0] - a[0], b[1] - a[1]), l1 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (l0 < .01 || l1 < .01) continue;
    const cut = Math.min(radius, l0 * .45, l1 * .45);
    const p = b.map((v, j) => v + (a[j] - v) * cut / l0), q = b.map((v, j) => v + (c[j] - v) * cut / l1);
    add(p);
    const n = Math.max(6, Math.ceil(cut * 2 / spacing));
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      add(b.map((v, k) => (1 - t) ** 2 * p[k] + 2 * (1 - t) * t * v + t * t * q[k]));
    }
  }
  if (route.length > 1) add(route.at(-1));
  return points;
}

export function departurePathPoint(airport, profile, reverse, distance) {
  const length = airportFrame(airport).length;
  // Gameplay climb guidance: a continuous roll-to-climb transition, scaled
  // to this aircraft's rotation speed/acceleration, not a real-world SID.
  const rotation = Math.min(length * .7, Math.max(180, profile.rotate ** 2 / (2 * profile.accel * .85)));
  const climb = Math.max(0, distance - rotation), transition = 240;
  const height = Math.tan(Math.PI / 30) * (climb < transition ? climb * climb / (2 * transition) : climb - transition / 2);
  const point = airportPoint(airport, reverse ? length - 65 - distance : 65 + distance);
  point.y += profile.clearance + height;
  return point;
}

export function operationsPathMode(operations, flight) {
  if (!operations?.guidance || !operations.airport || !operations.profile) return null;
  if (operations.phase === 'approach') return 'approach';
  const local = airportLocal(operations.airport, flight.pos.x, flight.pos.z), length = airportFrame(operations.airport).length;
  if (operations.phase === 'takeoffRoll' || (operations.phase === 'parked' && Math.abs(local.cross) < operations.airport.width / 2)) return 'departure';
  if (operations.phase === 'airborne' && operations.takeoffs > 0 && operations.destination === operations.airport.id &&
    Math.abs(local.cross) < 500 && local.along > -4000 && local.along < length + 4000 && flight.agl < 550) return 'departure';
  if (operations.grounded && operations.phase !== 'landingRoll') return 'ground';
  return null;
}

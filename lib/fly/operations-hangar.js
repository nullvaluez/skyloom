import { airportFrame, airportPoint } from './operations-airports';
import { airfieldSuppressesAirport } from './airfield/airfield-suppression';

// The rendered building and chase-camera obstruction use the same physical box.
export const OPERATIONS_HANGAR = Object.freeze({
  width: 80, depth: 125, wallHeight: 24, roofThickness: 1,
  outwardOffset: 180, clearance: 2,
});

export function airportHangarOrigin(airport) {
  return airportPoint(airport, airport.standAlong,
    airport.taxiSide * (airport.taxiOffset + OPERATIONS_HANGAR.outwardOffset));
}

const frames = new WeakMap();
const interval = { enter: 0, exit: 1 };
function slab(p, v, lo, hi) {
  if (Math.abs(v) < 1e-9) return p >= lo && p <= hi;
  const a = (lo - p) / v, b = (hi - p) / v;
  interval.enter = Math.max(interval.enter, Math.min(a, b));
  interval.exit = Math.min(interval.exit, Math.max(a, b));
  return interval.enter <= interval.exit;
}

/** Pull a chase/orbit camera in front of the authored hangar when its sightline
 * enters the building. Coordinates are absolute Mercator X/Z and metric Y.
 * The solid envelope is conservative even through the open hangar door; a
 * camera must not pass through its interior on the way to an apron aircraft.
 * No scene raycast, per-frame allocation, material changes or aircraft scaling.
 */
export function avoidOperationsHangar(camera, focus, airport) {
  if (!airport || airport.authored === false || airfieldSuppressesAirport(airport)) return false;
  let frame = frames.get(airport);
  if (!frame) {
    const { heading, k } = airportFrame(airport);
    frame = { c: Math.cos(heading), s: Math.sin(heading), k, origin: airportHangarOrigin(airport) };
    frames.set(airport, frame);
  }
  const { c, s, k, origin } = frame;
  const fx = focus.x - origin.x, fz = focus.z - origin.z;
  const dx = camera.x - focus.x, dz = camera.z - focus.z;
  const x = (c * fx + s * fz) / k, y = focus.y - origin.y, z = (-s * fx + c * fz) / k;
  const vx = (c * dx + s * dz) / k, vy = camera.y - focus.y, vz = (-s * dx + c * dz) / k;
  const h = OPERATIONS_HANGAR, pad = h.clearance;
  const hx = h.width / 2 + pad, hz = h.depth / 2 + pad, top = h.wallHeight + h.roofThickness / 2 + pad;
  // An aircraft already inside the building has no exterior camera solution.
  if (Math.abs(x) <= hx && y >= -pad && y <= top && Math.abs(z) <= hz) return false;
  interval.enter = 0; interval.exit = 1;
  if (!slab(x, vx, -hx, hx) || !slab(y, vy, -pad, top) || !slab(z, vz, -hz, hz) || interval.enter <= 0 || interval.enter >= 1) return false;
  const t = Math.max(0, interval.enter - 1e-5);
  camera.set(focus.x + dx * t, focus.y + vy * t, focus.z + dz * t);
  return true;
}

// AIRFIELD SUPPRESSION — while a lounge observes an airport, its ground
// belongs to AIRFIELD GROUND (components/fly/observation/AirfieldGround.jsx)
// and the older layers that drew it stand down inside one disc:
//
//   AirportOperationsLayer  the observed airport's runway mesh, paint, lights
//                           and authored stand-in hangar (landmarks untouched)
//   LivingAirports          the +0.65 m OSM pavement sheet (shader discard)
//   SatRoadEngine           the baked runway-light quads (class 7 zeroed)
//
// Only set once the replacement is drawn, cleared on leave/unmount, so a
// failed load never leaves the airport bare. Scene coordinates (absolute).
let state = null;
const listeners = new Set();

/**
 * @param s null to clear, or { ident, x, z, radius (scene units),
 *          runwayIds: string[] (registry ids drawn by the replacement) }
 */
export function setAirfieldSuppression(s) {
  const next = s ? Object.freeze({ ident: s.ident, x: s.x, z: s.z, radius: s.radius, runwayIds: Object.freeze([...(s.runwayIds ?? [])]) }) : null;
  if (next === state || (next && state && next.ident === state.ident && next.x === state.x && next.z === state.z && next.radius === state.radius)) return;
  state = next;
  for (const fn of listeners) fn(state);
}

export function airfieldSuppression() {
  return state;
}

export function subscribeAirfieldSuppression(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Inside the suppressed disc? (scene coordinates) */
export function insideAirfieldSuppression(x, z, s = state) {
  return !!s && (x - s.x) ** 2 + (z - s.z) ** 2 <= s.radius * s.radius;
}

/** Is this registry airport (runway record) one the replacement draws? */
export function airfieldSuppressesAirport(airport, s = state) {
  if (!s || !airport) return false;
  const ident = airport.ident || String(airport.id).split(':')[0];
  return ident === s.ident || s.runwayIds.includes(airport.id);
}

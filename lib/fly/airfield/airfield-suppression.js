// AIRFIELD SUPPRESSION — where a newer layer draws an airport's ground, the
// older layers that drew it stand down inside that layer's disc:
//
//   AirportOperationsLayer  the matching airport's runway mesh, paint, lights
//                           and authored stand-in hangar (landmarks untouched)
//   LivingAirports          the +0.65 m OSM pavement sheet (shader discard;
//                           a tile wholly inside one disc is hidden)
//   SatRoadEngine           the baked runway-light quads (class 7 zeroed)
//
// Several discs can be live at once, one per area key: 'lounge' (the
// observation lounge's AIRFIELD GROUND, components/fly/observation/
// AirfieldGround.jsx) and, with OPS_AIRFIELD, the flight areas
// (FLY_GATE_TO_GATE_PLAN.md, "Multi-area suppression"). A disc says what its
// replacement draws: covers 'all' (pavement, paint and lights) or 'runways'
// (the runway surfaces and their lights only), so the pavement sheet stays
// under a 'runways' disc.
//
// Only set once the replacement is drawn, cleared on leave/unmount, so a
// failed load never leaves the airport bare. Scene coordinates (absolute).

const NONE = Object.freeze([]);
const areas = new Map();
let discs = NONE; // frozen snapshot; a new array only when something changes
const listeners = new Set();

function freezeDisc(key, s) {
  return Object.freeze({
    key,
    ident: s.ident,
    x: s.x,
    z: s.z,
    radius: s.radius,
    runwayIds: Object.freeze([...(s.runwayIds ?? [])]),
    covers: s.covers === 'runways' ? 'runways' : 'all',
  });
}

function sameDisc(a, b) {
  return (
    a.ident === b.ident &&
    a.x === b.x &&
    a.z === b.z &&
    a.radius === b.radius &&
    a.covers === b.covers &&
    a.runwayIds.length === b.runwayIds.length &&
    a.runwayIds.every((id, i) => id === b.runwayIds[i])
  );
}

// Callers may pass the list, one disc (the pre-G2G single-disc form) or null.
const asList = (list) => (Array.isArray(list) ? list : list ? [list] : NONE);

/**
 * Set or clear one area's disc.
 * @param key  area key ('lounge', or a flight area's key)
 * @param s    null to clear, or { ident, x, z, radius (scene units),
 *             runwayIds: string[] (registry ids drawn by the replacement),
 *             covers: 'all' (default) | 'runways' }
 */
export function setAirfieldSuppressionArea(key, s) {
  const previous = areas.get(key) ?? null;
  const next = s ? freezeDisc(key, s) : null;
  if (!previous && !next) return;
  if (previous && next && sameDisc(previous, next)) return;
  if (next) areas.set(key, next);
  else areas.delete(key);
  discs = areas.size ? Object.freeze([...areas.values()]) : NONE;
  for (const fn of listeners) fn(discs);
}

/** Every live disc, in the order the areas were first set. Stable identity until a change (useSyncExternalStore). */
export function airfieldSuppressions() {
  return discs;
}

/** Listeners receive the new list. Returns the unsubscribe function. */
export function subscribeAirfieldSuppression(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The lounge's disc (compat: the single-disc API before multi-area suppression). */
export function setAirfieldSuppression(s) {
  setAirfieldSuppressionArea('lounge', s);
}

/** The first live disc, or null (compat). */
export function airfieldSuppression() {
  return discs[0] ?? null;
}

/** Inside any suppressed disc? (scene coordinates) */
export function insideAirfieldSuppression(x, z, list = discs) {
  for (const s of asList(list)) if ((x - s.x) ** 2 + (z - s.z) ** 2 <= s.radius * s.radius) return true;
  return false;
}

/** The first disc whose replacement draws this registry airport (runway record), or null. */
export function airfieldSuppressionOf(airport, list = discs) {
  if (!airport) return null;
  const ident = airport.ident || String(airport.id).split(':')[0];
  for (const s of asList(list)) if (ident === s.ident || s.runwayIds.includes(airport.id)) return s;
  return null;
}

/** Is this registry airport (runway record) one a replacement draws? */
export function airfieldSuppressesAirport(airport, list = discs) {
  return airfieldSuppressionOf(airport, list) !== null;
}

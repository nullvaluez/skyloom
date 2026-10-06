/**
 * TRUE EARTH Phase 1b — TRUE_AREAS: latitude-consistent footprint areas in the
 * satellite building and skyline builders (lib/fly/toy-world/vector-tile.worker.js).
 * The worker has no window, so the resolved flag travels with each build
 * request; flag off adds nothing to the request.
 */
import { pinned } from './fly-pins.js';
import { TRUE_AREAS } from './fly-constants.js';

/** The resolved TRUE_AREAS block (URL / console pins applied once, at load). */
export const TRUE_AREAS_ACTIVE = pinned(TRUE_AREAS, '__flyTrueAreasOverride');
export function trueAreasOn() {
  return TRUE_AREAS_ACTIVE.enabled === true;
}

/** Extra build-request options: `{ trueAreas: true }` when on, nothing when off. */
export function trueAreasRequest() {
  return trueAreasOn() ? { trueAreas: true } : null;
}

/**
 * The area factor for a tile whose Mercator scale is k: (kRef / k)², so a
 * Mercator area times it is the area the same footprint would measure at the
 * reference latitude. Exactly 1 when off. Shared by the worker and the gate.
 */
export function areaNormK(k, on, refLatDeg = TRUE_AREAS.refLatDeg) {
  if (!on || !(k > 0)) return 1;
  const kRef = 1 / Math.cos((refLatDeg * Math.PI) / 180);
  return (kRef / k) ** 2;
}

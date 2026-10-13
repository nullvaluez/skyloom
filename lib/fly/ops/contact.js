/**
 * Operations contact: the one place the operations core asks "what is under
 * the wheels". Owned by the airport-world work (W1 stream B); every other ops
 * module, and every placement (begin, lineUp, retry, the approach capture and
 * the envelope AGL), goes through it.
 *
 * operations.ground is null until OPS_AIRFIELD's AirportService installs its
 * composite ground (lib/fly/airport-service/ops-ground.js, W1). While it is
 * null every answer is today's authored one, so the shipped trajectories are
 * byte-identical (scripts/verify-ops-golden.mjs).
 *
 * The ground interface (see airport-service/contracts.js OpsGround):
 *   surfaceAt(x, z) -> OpsSurface | null
 *   placementHeight(x, z) -> number | null   (the drawn surface height)
 */
import { findAirportSurface } from '../operations-airports.js';

/** The surface under (x, z) in scene coordinates, or null off every pavement. */
export function surfaceAt(ops, x, z) {
  return ops.ground ? ops.ground.surfaceAt(x, z) : findAirportSurface(x, z);
}

/**
 * Is this surface paved (taxi and takeoff allowed at speed)? Grass is a
 * surface, not pavement: the composite ground reports kind 'grass' inside an
 * airfield area where the authored registry would report null.
 */
export function paved(surface) {
  return !!surface && surface.kind !== 'grass';
}

/**
 * The ground height for placing the aircraft at (x, z). authoredY is the
 * registry answer the caller computed (the runway endpoint profile); it is
 * returned unchanged unless an installed ground knows the drawn height.
 */
export function placementHeight(ops, x, z, authoredY) {
  const ground = ops.ground;
  if (!ground) return authoredY;
  const h = ground.placementHeight?.(x, z);
  return Number.isFinite(h) ? h : authoredY;
}

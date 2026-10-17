// Shared vertical shell tests for walking-related picking and observation.
// Room-local metres; the authored stair opening is the only connection
// through the existing lower ceiling / new upper floor.
import { HALF_X, ROOF_Z1, BACK_Z } from './room-plan.js';

const within = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Nearest intersection with either face of the solid intermediate deck.
 * Infinity means clear, including a ray through the exact stair opening. */
export function deckRayHit(eye, direction, upper, limit = Infinity) {
  if (!upper || Math.abs(direction.y) < 1e-9) return Infinity;
  let hit = Infinity;
  for (const [y, region] of [[upper.floorY, 'all'], [upper.floorY - (upper.slabM ?? .16), 'upper'], [upper.floorY + .06, 'lower-roof']]) {
    const t = (y - eye.y) / direction.y;
    if (!(t > 1e-6) || t >= limit || t >= hit) continue;
    const x = eye.x + direction.x * t, z = eye.z + direction.z * t;
    const inUpper = within(x, z, upper.plate);
    if (region === 'upper' && !inUpper || region === 'lower-roof' && inUpper) continue;
    if (Math.abs(x) <= HALF_X && z >= ROOF_Z1 && z <= BACK_Z && !within(x, z, upper.well)) hit = t;
  }
  return hit;
}

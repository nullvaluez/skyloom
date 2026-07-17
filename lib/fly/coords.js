/**
 * Coordinate adapter between true meters and the terrain engine's
 * Web-Mercator world units.
 *
 * The TileMap world is Web-Mercator meters on the horizontal plane —
 * stretched by k = 1/cos(lat) versus true ground meters — while altitude
 * (the world Y axis after the -90° X rotation) stays in true meters.
 * All flight-model speeds/distances are TRUE meters; only when applying
 * horizontal displacement to world positions do we multiply by k.
 */

const DEG2RAD = Math.PI / 180;

/** Horizontal stretch factor of Web-Mercator at a latitude. */
export function mercatorScale(latDeg) {
  return 1 / Math.cos(latDeg * DEG2RAD);
}

/** Wrap an angle to [-PI, PI). */
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Frame-rate-independent exponential approach:
 * returns x moved toward target by rate lambda (1/s) over dt seconds.
 */
export function expApproach(x, target, lambda, dt) {
  return x + (target - x) * (1 - Math.exp(-lambda * dt));
}

/** Same, but for angles (approaches along the shortest arc). */
export function expApproachAngle(x, target, lambda, dt) {
  return x + wrapAngle(target - x) * (1 - Math.exp(-lambda * dt));
}

export { DEG2RAD };
export const RAD2DEG = 180 / Math.PI;
export const MPS_TO_KT = 1.943844;
export const M_TO_FT = 3.28084;

/**
 * HORIZON FILL (FLY_HORIZON_FILL.md) stream B: the z11 survey grid in world
 * units, as the carpet engine uses it. Pure functions, no three, no flags, so
 * a node gate can import them raw.
 *
 *   WORLD = 40075016.68557849; S = WORLD / 2048 (one z11 tile)
 *   tile (tx, ty): x in [-WORLD/2 + tx*S, +S), z in [-WORLD/2 + ty*S, +S)
 *   true metres = world units / cosh(z / 6378137)
 */
export const EARTH_R = 6378137;
export const WORLD = 2 * Math.PI * EARTH_R;
export const HALF = WORLD / 2;
export const TILE_Z = 11;
export const TILES = 2 ** TILE_Z;
export const S = WORLD / TILES;
export const CELLS = 128;
const RAD2DEG = 180 / Math.PI;

/** Mercator scale at world z: world units per true metre. */
export function mercK(z) {
  return Math.cosh(z / EARTH_R);
}

export function tileMinX(tx) {
  return -HALF + tx * S;
}

export function tileMinZ(ty) {
  return -HALF + ty * S;
}

/** The z11 tile index containing world x (or z), clamped to the grid. */
export function tileIndex(v) {
  const i = Math.floor((v + HALF) / S);
  return i < 0 ? 0 : i >= TILES ? TILES - 1 : i;
}

/** Distance (world units) from (px, pz) to the nearest point of the square [minX, +span) x [minZ, +span). */
export function rectDist(px, pz, minX, minZ, span) {
  const dx = Math.max(minX - px, 0, px - (minX + span));
  const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
  return Math.hypot(dx, dz);
}

/** Distance (world units) from (px, pz) to the farthest corner of the square. */
export function rectFar(px, pz, minX, minZ, span) {
  const dx = Math.max(Math.abs(px - minX), Math.abs(px - (minX + span)));
  const dz = Math.max(Math.abs(pz - minZ), Math.abs(pz - (minZ + span)));
  return Math.hypot(dx, dz);
}

/** World x -> longitude (degrees). */
export function lonOf(x) {
  return (x / EARTH_R) * RAD2DEG;
}

/** World z (grows south) -> latitude (degrees). */
export function latOf(z) {
  return (2 * Math.atan(Math.exp(-z / EARTH_R)) - Math.PI / 2) * RAD2DEG;
}

/** Bounds of a chunk: the whole tile (level 1, 2) or quarter (qx, qy) of it (level 0). */
export function chunkBounds(tx, ty, level, qx, qy, out) {
  const half = level === 0;
  const span = half ? S / 2 : S;
  out.minX = tileMinX(tx) + (half ? qx * span : 0);
  out.minZ = tileMinZ(ty) + (half ? qy * span : 0);
  out.span = span;
  return out;
}

/**
 * The cell mask of quarters excluded from a whole-tile chunk (bit q = qy * 2 +
 * qx), OR'd into `mask` (Uint8Array(16384)) or a new one. Nonzero = emit nothing.
 */
export function quarterMask(bits, mask = null) {
  const m = mask ?? new Uint8Array(CELLS * CELLS);
  for (let q = 0; q < 4; q++) {
    if (!(bits & (1 << q))) continue;
    const qx = q & 1;
    const qy = q >> 1;
    for (let j = qy * 64; j < qy * 64 + 64; j++) m.fill(1, j * CELLS + qx * 64, j * CELLS + qx * 64 + 64);
  }
  return m;
}

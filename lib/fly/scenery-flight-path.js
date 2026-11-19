// Rank *work* along the ground track. Distances and velocity are in projected
// world units, just like the tile grid. Orbiting the camera cannot move it.
const HALF_WORLD = Math.PI * 6378137;

export function sceneryFlightPath(px, pz, vx, vz, span) {
  const speed = Math.hypot(vx, vz);
  const lead = Math.min(10 * speed, 1.5 * span);
  if (!(lead > 0.08 * span)) return null;
  const dx = lead * vx / speed, dz = lead * vz / speed;
  const tx = (px + HALF_WORLD) / span, tz = (pz + HALF_WORLD) / span;
  const lx = dx / span, lz = dz / span, length2 = lx * lx + lz * lz;
  return {
    x: px + dx, z: pz + dz,
    rank(x, z) {
      if (x === Math.floor(tx) && z === Math.floor(tz)) return -1;
      const cx = x + 0.5 - tx, cz = z + 0.5 - tz;
      const t = Math.max(0, Math.min(1, (cx * lx + cz * lz) / length2));
      const gapX = Math.max(0, Math.abs(cx - t * lx) - 0.5);
      const gapZ = Math.max(0, Math.abs(cz - t * lz) - 0.5);
      // Along-track neighbours arrive in overflight order. A small distance
      // term also gives nearby flanking tiles time before a distant endpoint.
      return gapX * gapX + gapZ * gapZ + 0.16 * (cx * cx + cz * cz);
    },
  };
}

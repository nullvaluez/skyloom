// The terrain and tree positions are absolute Mercator XZ. Three's camera
// has a floating horizontal origin; heights stay in metres above sea level.
export function canopyViewChanged(camera, anchor, previous, moveStep) {
  if (!previous) return true;
  const e = camera.matrixWorld.elements, p = camera.projectionMatrix.elements;
  return (e[12] + anchor.x - previous.x) ** 2 + (e[14] + anchor.z - previous.z) ** 2 +
      (e[13] - previous.y) ** 2 >= moveStep ** 2 ||
    -e[8] * previous.fx - e[9] * previous.fy - e[10] * previous.fz < 0.985 ||
    e[4] * previous.ux + e[5] * previous.uy + e[6] * previous.uz < 0.985 ||
    Math.abs(p[0] / previous.projX - 1) > 0.025 || Math.abs(p[5] / previous.projY - 1) > 0.025;
}

export function captureCanopyView(camera, anchor, margin, groundAt) {
  const e = camera.matrixWorld.elements, p = camera.projectionMatrix.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10];
  const horizontal = Math.hypot(fx, fz);
  const tanX = 1 / p[0], tanY = 1 / p[5];
  // If either vertical ray falls inside the picture, ground in every
  // compass direction can be visible. Otherwise the four corner rays bound
  // its horizontal footprint, including when the aircraft banks.
  const includesVertical = Math.abs(e[1]) <= Math.abs(fy) * tanX &&
    Math.abs(e[5]) <= Math.abs(fy) * tanY;
  let halfAngle = 0;
  if (!includesVertical && horizontal > 1e-6) {
    for (const h of [-tanX, tanX]) for (const v of [-tanY, tanY]) {
      const x = fx + h * e[0] + v * e[4], z = fz + h * e[2] + v * e[6];
      halfAngle = Math.max(halfAngle, Math.abs(Math.atan2(fx * z - fz * x, fx * x + fz * z)));
    }
  } else halfAngle = Math.PI;
  return {
    x: anchor.x + e[12], y: e[13], z: anchor.z + e[14],
    fx, fy, fz, ux: e[4], uy: e[5], uz: e[6], projX: p[0], projY: p[5],
    dirX: horizontal ? fx / horizontal : 0, dirZ: horizontal ? fz / horizontal : 0,
    cos: Math.cos(Math.min(Math.PI, halfAngle + margin)),
    // Existing detail distances were authored for an ordinary 60-degree view.
    focalScale: Math.min(3, Math.max(0.5, Math.tan(Math.PI / 6) * p[5])),
    groundAt,
  };
}

export function canopyCellInView(view, x, z, radius) {
  if (view.cos <= -1) return true;
  const dx = x - view.x, dz = z - view.z;
  return dx * view.dirX + dz * view.dirZ + 2 * radius >= view.cos * Math.hypot(dx, dz);
}

// Keep the outer coverage and fade distances geographic. Only the choice
// between a stand of trees, a smaller clump and branches uses viewing distance.
export function canopyCellDetailed(view, chunk, rows, at, reach, k) {
  const x = chunk.cx + rows[at], z = chunk.cz + rows[at + 1];
  const seed = Math.imul(Math.floor(x), 73856093) ^ Math.imul(Math.floor(z), 19349663);
  const jitter = 0.90 + ((seed ^ (seed >>> 16)) & 255) * (0.20 / 255);
  const limit = reach * view.focalScale * jitter;
  const horizontal2 = (x - view.x) ** 2 + (z - view.z) ** 2;
  if (horizontal2 >= limit * limit) return false;
  const ground = view.groundAt(chunk, rows[at], rows[at + 1]);
  if (!Number.isFinite(ground)) return true; // a missing sample cannot rule out a nearby ridge
  const dy = (view.y - ground - rows[at + 3] * 0.75) * k;
  return horizontal2 + dy * dy < limit * limit;
}

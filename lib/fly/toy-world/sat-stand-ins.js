/**
 * World Pass C (REACH): main-thread assembly of a skyline group's stand-ins.
 * Stream C owns this file. Pure functions plus one shared base box, so a node
 * gate can drive them (scripts/wp-reach-node-bench.mjs reads the worker side).
 *
 *   mergeStandInParts(parts)   the group's tiles (each already sorted by size,
 *       descending) merged into one size-descending list, positions moved into
 *       the group frame. Typed arrays only.
 *   drapeStandIns(m, grid, n, gspan, out)   ground y per instance, bilinear
 *       over the engine's lattice of the DRAWN terrain mesh (the same grid the
 *       old horizon mass draped on; FLY_WORLD_PASS.md rule 4).
 *   createStandInGeometry(m, base)   an InstancedBufferGeometry over the
 *       shared 12-vertex box, 32 bytes per instance:
 *         aBendAnchor  Float32 x2   centre (group-local world x, z)
 *         aStandInBase Float32 x1   ground y
 *         aStandInDim  Uint16n x4   half extents, height (/1000), yaw (/2pi)
 *         aStandInWall Uint8n  x4   wall sRGB, family
 *         aStandInRoof Uint8n  x4   roof sRGB, seed
 *         aStandInGround Uint8n x4 round 2: the ground photo's albedo (sRGB) under the
 *                                  stand-in, or its tile's mean roof; a = 255 photo, 0 mean
 *   countAtLeast(size, n, threshold)   how many of a size-descending list are
 *       >= threshold (the per-group draw prefix).
 */
import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Sphere, Vector3 } from 'three';
import { skylineHeight } from '../skyline-drape';
import { CITY_GEOMETRY_LOD_ON } from '../world-clarity';

// roof (y = 1), the +x wall, the +z wall; outward counter-clockwise winding.
const BOX = new Float32Array([
  -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1, // roof
  1, 0, 1, 1, 0, -1, 1, 1, -1, 1, 1, 1, // +x wall
  -1, 0, 1, 1, 0, 1, 1, 1, 1, -1, 1, 1, // +z wall
]);
const FACE = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
const NORMAL = new Float32Array([
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
]);
const INDEX = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
export const STAND_IN_TRIANGLES = INDEX.length / 3;

let _base = null;
/** The shared base box. Its attributes are shared by every group's geometry (one upload). */
export function standInBase() {
  if (!_base) {
    _base = {
      position: new BufferAttribute(BOX, 3),
      // Three selects FLAT_SHADED when this attribute is absent, discarding
      // standInNormal even though the shader supplies it through its alias.
      // The 144-byte shared buffer selects the normal-varying path; the vertex
      // shader still rotates the wall and applies the photo-ground blend.
      normal: new BufferAttribute(NORMAL, 3),
      face: new BufferAttribute(FACE, 1),
      index: new BufferAttribute(INDEX, 1),
    };
  }
  return _base;
}

/**
 * @param parts [{ si: { n, pos, dim, col, size }, dx, dz }] (tile bundles)
 * @returns { n, ax, az, dim (Uint16 x4), wall (Uint8 x4), roof (Uint8 x4), size, maxH }
 */
export function mergeStandInParts(parts) {
  let n = 0;
  for (const p of parts) n += p.si.n;
  const ax = new Float32Array(n);
  const az = new Float32Array(n);
  const dim = new Uint16Array(n * 4);
  const wall = new Uint8Array(n * 4);
  const roof = new Uint8Array(n * 4);
  const gnd = new Uint8Array(n * 4); // round 2: ground photo albedo sRGB + photo flag
  const size = new Float32Array(n);
  const bottom = parts.some(p => p.si.bottom) ? new Uint16Array(n) : null;
  const head = new Int32Array(parts.length);
  const q = (v, s) => Math.max(0, Math.min(65535, Math.round((v / s) * 65535)));
  const TAU = Math.PI * 2;
  let maxH = 0;
  let parent;
  for (let o = 0; o < n; o++) {
    // k-way merge: at most 16 heads, each list already size-descending.
    let best = -1;
    let bestS = -Infinity;
    for (let j = 0; j < parts.length; j++) {
      const h = head[j];
      if (h < parts[j].si.n && parts[j].si.size[h] > bestS) {
        bestS = parts[j].si.size[h];
        best = j;
      }
    }
    const part = parts[best];
    const si = part.si;
    const i = head[best]++;
    if (si.parentOffsets?.[i]) (parent ??= new Map()).set(o,o-si.parentOffsets[i]);
    ax[o] = si.pos[i * 2] + part.dx;
    az[o] = si.pos[i * 2 + 1] + part.dz;
    const yaw = ((si.dim[i * 4 + 3] % TAU) + TAU) % TAU;
    dim[o * 4] = q(si.dim[i * 4], 1000);
    dim[o * 4 + 1] = q(si.dim[i * 4 + 1], 1000);
    dim[o * 4 + 2] = q(si.dim[i * 4 + 2], 1000);
    dim[o * 4 + 3] = q(yaw, TAU);
    if (si.dim[i * 4 + 2] > maxH) maxH = si.dim[i * 4 + 2];
    for (let c = 0; c < 4; c++) {
      wall[o * 4 + c] = si.col[i * 8 + c];
      roof[o * 4 + c] = si.col[i * 8 + 4 + c];
      gnd[o * 4 + c] = si.gnd ? si.gnd[i * 4 + c] : roof[o * 4 + c];
    }
    size[o] = si.size[i];
    if (bottom) bottom[o] = si.bottom?.[i] ?? 0;
  }
  return { n, ax, az, dim, wall, roof, gnd, size, maxH, ...(parent ? {parent} : {}), ...(bottom ? { bottom } : {}) };
}

/** Ground y per instance from the group's (n+1)^2 lattice (group-local coordinates). */
export function drapeStandIns(m, grid, n, gspan, out) {
  const step = gspan / n;
  for (let i = 0; i < m.n; i++) out[i] = skylineHeight(grid, n, (m.ax[i] + gspan / 2) / step, (m.az[i] + gspan / 2) / step);
  if (m.parent) for (const [child,parent] of m.parent) out[child] = out[parent];
  return out;
}

export function createStandInGeometry(m, baseY, gspan, prepared = null) {
  const b = standInBase();
  const geo = new InstancedBufferGeometry();
  geo.setIndex(b.index);
  geo.setAttribute('position', b.position);
  geo.setAttribute('normal', b.normal);
  geo.setAttribute('aStandInFace', b.face);
  const anchor = prepared?.anchor ?? new Float32Array(m.n * 2);
  for (let i = 0; !prepared && i < m.n; i++) {
    anchor[i * 2] = m.ax[i];
    anchor[i * 2 + 1] = m.az[i];
  }
  geo.setAttribute('aBendAnchor', new InstancedBufferAttribute(anchor, 2));
  geo.setAttribute('aStandInBase', new InstancedBufferAttribute(baseY, 1));
  geo.setAttribute('aStandInDim', new InstancedBufferAttribute(m.dim, 4, true));
  geo.setAttribute('aStandInWall', new InstancedBufferAttribute(m.wall, 4, true));
  geo.setAttribute('aStandInRoof', new InstancedBufferAttribute(m.roof, 4, true));
  geo.setAttribute('aStandInGround', new InstancedBufferAttribute(m.gnd, 4, true));
  if (CITY_GEOMETRY_LOD_ON) geo.setAttribute('aCityRank', new InstancedBufferAttribute(m.size, 1));
  if (m.bottom) geo.setAttribute('aStandInBottom', new InstancedBufferAttribute(m.bottom, 1));
  geo.instanceCount = 0; // the engine sets the drawn prefix every frame
  let lo = prepared?.lo ?? Infinity;
  let hi = prepared?.hi ?? -Infinity;
  for (let i = 0; !prepared && i < m.n; i++) {
    if (baseY[i] < lo) lo = baseY[i];
    if (baseY[i] > hi) hi = baseY[i];
  }
  if (!Number.isFinite(lo)) lo = hi = 0;
  const top = hi + m.maxH;
  geo.boundingSphere = new Sphere(new Vector3(0, (lo + top) / 2, 0), Math.hypot(gspan / Math.SQRT2, (top - lo) / 2 + 50));
  return geo;
}

/** Number of leading entries of a size-descending list that are >= threshold. */
export function countAtLeast(size, n, threshold) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (size[mid] >= threshold) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

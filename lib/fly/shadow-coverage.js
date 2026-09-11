/** Camera-aware coverage for the existing light. No scene or light mutations.
 * Coordinates are rebased world units throughout. The caller owns damping,
 * warp resets and final shadow-texel snapping; this module retains no pose.
 */
import { Box3, Frustum, Matrix4 } from 'three';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** Mutates the supplied reusable output. A .6-radius limit leaves the player
 * inside the focus footprint with .4-radius reserve even at a grazing view.
 * Near the horizon, smoothly retire the finite-plane intersection rather than
 * switching between an enormous forward point and zero on a one-pixel tilt.
 */
export function resolveShadowFocus(out, { playerX, playerZ, groundY, camera, radiusM, maxOffsetRatio = .6 }) {
  out.dx = out.dz = 0;
  out.valid = false;
  const e = camera?.matrixWorld?.elements;
  if (!e || !Number.isFinite(playerX + playerZ + groundY + radiusM) || radiusM <= 0) return out;
  const norm = Math.hypot(e[8], e[9], e[10]);
  if (!(norm > 0) || !Number.isFinite(e[12] + e[13] + e[14] + norm)) return out;
  const dy = -e[9] / norm, above = e[13] - groundY;
  if (dy >= -.005 || above <= 0) return out;
  const rayT = -above / dy;
  const dx = e[12] - e[8] / norm * rayT - playerX;
  const dz = e[14] - e[10] / norm * rayT - playerZ;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance)) return out;
  const ratio = Number.isFinite(maxOffsetRatio) ? clamp(maxOffsetRatio, 0, .75) : .6;
  const scale = Math.min(1, radiusM * ratio / Math.max(distance, 1e-9)) * smooth01((-dy - .005) / .075);
  out.dx = dx * scale;
  out.dz = dz * scale;
  out.valid = true;
  return out;
}

const newCandidate = () => ({ model: null, rank: 0, near: 0, focus: 0, z: 0, x: 0, y: 0, id: 0, visible: false, footprint: false });
const compare = (a, b) => a.rank - b.rank || a.near - b.near || a.focus - b.focus ||
  a.z - b.z || a.x - b.x || a.y - b.y || a.id - b.id;
function copyCandidate(to, from) {
  to.model = from.model; to.rank = from.rank; to.near = from.near; to.focus = from.focus;
  to.z = from.z; to.x = from.x; to.y = from.y; to.id = from.id;
  to.visible = from.visible; to.footprint = from.footprint;
}

/** Allocate once per depth rig. Scratch boxes, heaps, candidates and output
 * arrays are reused; no vertex scan, geometry bound computation or world-matrix
 * update occurs here. Call at the existing receiver sweep cadence, not per RAF.
 */
export function createShadowCoverageState() {
  return {
    selected: [],
    census: { walked: 0, leaves: 0, eligible: 0, visibleEligible: 0, footprintEligible: 0,
      selected: 0, visibleSelected: 0, footprintSelected: 0, capped: false, cameraReady: false },
    stack: [], heap: [], pool: [], candidate: newCandidate(), box: new Box3(),
    projection: new Matrix4(), view: new Frustum(), shadow: new Frustum(),
  };
}

function cameraFrustum(state, target, camera, reversedDepth) {
  if (!camera?.projectionMatrix?.elements || !camera?.matrixWorldInverse?.elements) return false;
  state.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  if (!state.projection.elements.every(Number.isFinite)) return false;
  target.setFromProjectionMatrix(state.projection, camera.coordinateSystem, reversedDepth);
  return true;
}

function distanceToBoxXZ(box, x, z) {
  const dx = x - clamp(x, box.min.x, box.max.x), dz = z - clamp(z, box.min.z, box.max.z);
  return dx * dx + dz * dz;
}

/** Terrain is authored on local XY [-.5,.5], with elevation on local Z.
 * Ready meshes normally have bounds already; the fallback uses the tile's
 * cached height and never decodes a newly arriving dense terrain buffer.
 */
function tileBounds(box, tile, bend) {
  const model = tile.model, geometry = model?.geometry, matrix = model?.matrixWorld;
  if (!matrix?.elements) return false;
  if (geometry?.boundingBox) box.copy(geometry.boundingBox);
  else if (geometry?.boundingSphere) {
    const sphere = geometry.boundingSphere;
    // The terrain engine may have padded the sphere for the farthest possible
    // bend. Recover the original bound; we apply the actual local bend below.
    const r = sphere.userData?.r24BaseRadius ?? sphere.radius;
    // Local XY is normalized while elevation Z is metres. Expanding XY by a
    // sphere's elevation radius before the map scale would exaggerate it by
    // hundreds of metres and spend the cap on distant, non-overlapping tiles.
    box.min.set(-.5, -.5, sphere.center.z - r);
    box.max.set(.5, .5, sphere.center.z + r);
  } else {
    box.min.set(-.5, -.5, 0);
    box.max.set(.5, .5, Math.max(0, tile._maxZ ?? 0));
  }
  box.applyMatrix4(matrix);
  if (!Number.isFinite(box.min.x + box.min.y + box.min.z + box.max.x + box.max.y + box.max.z) || box.isEmpty()) return false;
  const k = Number.isFinite(bend?.k) ? Math.max(0, bend.k) : 0;
  if (k > 0 && Number.isFinite(bend.cx + bend.cz)) {
    const near2 = distanceToBoxXZ(box, bend.cx, bend.cz);
    const farX = Math.max(Math.abs(box.min.x - bend.cx), Math.abs(box.max.x - bend.cx));
    const farZ = Math.max(Math.abs(box.min.z - bend.cz), Math.abs(box.max.z - bend.cz));
    box.min.y -= (farX * farX + farZ * farZ) * k;
    box.max.y -= near2 * k;
  }
  return true;
}

/** Bounded max-heap: the worst retained candidate is always at the root. */
function retain(state, cap) {
  const heap = state.heap, candidate = state.candidate;
  if (cap <= 0) return;
  if (heap.length < cap) {
    const slot = state.pool[heap.length] ?? (state.pool[heap.length] = newCandidate());
    copyCandidate(slot, candidate); heap.push(slot);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (compare(heap[p], heap[i]) >= 0) break;
      const swap = heap[p]; heap[p] = heap[i]; heap[i] = swap; i = p;
    }
  } else if (compare(candidate, heap[0]) < 0) {
    copyCandidate(heap[0], candidate);
    let i = 0;
    for (;;) {
      const left = i * 2 + 1, right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && compare(heap[right], heap[left]) > 0 ? right : left;
      if (compare(heap[i], heap[child]) >= 0) break;
      const swap = heap[i]; heap[i] = heap[child]; heap[child] = swap; i = child;
    }
  }
}

/** Returns state itself; selected and census are overwritten on the next sweep.
 * All eligible leaves are counted before applying the cap. Priority: visible
 * actual footprint, visible padded fringe, hidden footprint, hidden fringe;
 * then nearest camera footprint, focus distance, stable z/x/y/model-id ties.
 * Optional shadowCamera uses the actual light frustum; otherwise radiusM is
 * a conservative circular focus footprint. Existing padM is only a fringe.
 */
export function selectShadowReceivers(state, root, { camera, shadowCamera, focusX, focusZ,
  radiusM, padM = 200, maxTiles = 48, bend, reversedDepth = false }) {
  const c = state.census;
  c.walked = c.leaves = c.eligible = c.visibleEligible = c.footprintEligible = 0;
  c.selected = c.visibleSelected = c.footprintSelected = 0; c.capped = false;
  state.selected.length = state.heap.length = state.stack.length = 0;
  for (const row of state.pool) row.model = null;
  c.cameraReady = cameraFrustum(state, state.view, camera, reversedDepth);
  const shadowReady = cameraFrustum(state, state.shadow, shadowCamera, reversedDepth);
  if (!root || !Number.isFinite(focusX + focusZ + radiusM) || radiusM <= 0) return state;
  const cap = Number.isFinite(maxTiles) ? clamp(Math.floor(maxTiles), 0, 48) : 48;
  const pad = Number.isFinite(padM) ? Math.max(0, padM) : 200;
  const reach2 = (radiusM + pad) ** 2, radius2 = radiusM ** 2;
  const eye = camera?.matrixWorld?.elements;
  const eyeX = Number.isFinite(eye?.[12]) ? eye[12] : focusX;
  const eyeZ = Number.isFinite(eye?.[14]) ? eye[14] : focusZ;
  state.stack.push(root);
  while (state.stack.length) {
    const tile = state.stack.pop();
    if (!tile || tile.visible === false) continue;
    if (tile.isTile) {
      c.walked++;
      if (tile.isLeaf) {
        c.leaves++;
        if (!tile.model || !tileBounds(state.box, tile, bend)) continue;
        const focusDistance = distanceToBoxXZ(state.box, focusX, focusZ);
        const footprint = shadowReady ? state.shadow.intersectsBox(state.box) : focusDistance <= radius2;
        if (!footprint && focusDistance > reach2) continue;
        const visible = tile.model.visible !== false && c.cameraReady && state.view.intersectsBox(state.box);
        c.eligible++; if (visible) c.visibleEligible++; if (footprint) c.footprintEligible++;
        const row = state.candidate;
        row.model = tile.model; row.visible = visible; row.footprint = footprint;
        row.rank = (visible ? 0 : 2) + (footprint ? 0 : 1);
        row.near = distanceToBoxXZ(state.box, eyeX, eyeZ); row.focus = focusDistance;
        row.z = tile.z ?? 0; row.x = tile.x ?? 0; row.y = tile.y ?? 0; row.id = tile.model.id ?? tile.id ?? 0;
        retain(state, cap);
        continue;
      }
    }
    const children = tile.children;
    if (children) for (let i = children.length - 1; i >= 0; i--) state.stack.push(children[i]);
  }
  state.heap.sort(compare);
  for (const row of state.heap) {
    state.selected.push(row.model);
    if (row.visible) c.visibleSelected++;
    if (row.footprint) c.footprintSelected++;
  }
  c.selected = state.selected.length; c.capped = c.eligible > c.selected;
  return state;
}

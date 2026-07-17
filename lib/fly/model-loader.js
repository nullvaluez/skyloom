import { Box3, BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { GLTFLoader } from 'three-stdlib';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAFFIC_MODELS } from './assets';

/**
 * GLB → InstancedMesh-ready geometry (Phase 4 asset pass, poly.pizza CC-BY
 * models). Each archetype becomes ONE merged BufferGeometry with material
 * colors baked into a vertex-color attribute (instancing needs a single
 * material; instanceColor then MULTIPLIES the vertex colors, so the stale
 * ladder's dim-toward-fog keeps working with a white base tint).
 *
 * Normalization to the rig convention (nose -Z, +Y up, origin CG, real
 * meters): center on the bbox, spin the longest horizontal axis onto Z,
 * then point the nose at -Z by putting the TALLER half (the tail fin) at
 * +Z — every model in the manifest has a fin. yawFixRad in the manifest
 * overrides the heuristic if a model ever defeats it.
 */

const _loader = new GLTFLoader();
const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();
const _color = new Color();

function bakeMeshGeometry(mesh) {
  let g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  if (g.index) g = g.toNonIndexed();

  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  // Textured materials bake as their color factor (usually white) — the
  // low-poly fleet is overwhelmingly solid-material, so this stays faithful.
  _color.set(mesh.material?.color ?? 0xffffff);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }

  const clean = new BufferGeometry();
  clean.setAttribute('position', g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  clean.setAttribute('normal', g.attributes.normal);
  clean.setAttribute('color', new BufferAttribute(colors, 3));
  return clean;
}

/**
 * Peak-height asymmetry of the two halves along an axis. The FUSELAGE axis
 * shows a strong asymmetry (the tail fin makes one end tall); the WING axis
 * is mirror-symmetric (≈0). This beats "longest horizontal axis": several
 * low-poly planes are wider (wingspan) than they are long.
 */
function yAsymmetry(pos, useX) {
  let negMax = -Infinity;
  let posMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if ((useX ? pos.getX(i) : pos.getZ(i)) < 0) negMax = Math.max(negMax, y);
    else posMax = Math.max(posMax, y);
  }
  return { diff: Math.abs(posMax - negMax), tailAtPositive: posMax >= negMax };
}

/**
 * Which end of the fuselage (z axis) is the NOSE? Compare the cross-section
 * height of the two outer 12% slabs: the nose tapers to a point while the
 * tail slab contains the fin + tailplane. This is far more reliable than a
 * half-split fin test — bubble canopies sit mid-body and can out-tall a toy
 * jet's fin in the half containing them (the bug that shipped a backwards
 * player plane, twice).
 */
function noseAtNegativeZ(pos) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const slab = (maxZ - minZ) * 0.12;
  let negHeight = 0; // cross-section height (max|y| span) of the -Z end slab
  let posHeight = 0;
  let negMinY = Infinity;
  let negMaxY = -Infinity;
  let posMinY = Infinity;
  let posMaxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const y = pos.getY(i);
    if (z <= minZ + slab) {
      if (y < negMinY) negMinY = y;
      if (y > negMaxY) negMaxY = y;
    }
    if (z >= maxZ - slab) {
      if (y < posMinY) posMinY = y;
      if (y > posMaxY) posMaxY = y;
    }
  }
  negHeight = negMaxY > negMinY ? negMaxY - negMinY : 0;
  posHeight = posMaxY > posMinY ? posMaxY - posMinY : 0;
  return negHeight <= posHeight; // slimmer end = nose
}

function orientAndScale(geometry, targetLenM, yawFixRad, extraYawRad = 0) {
  geometry.computeBoundingBox();
  geometry.boundingBox.getCenter(_center);
  geometry.translate(-_center.x, -_center.y, -_center.z);

  if (yawFixRad != null) {
    // Manifest override: absolute yaw, heuristics skipped entirely
    if (yawFixRad !== 0) geometry.rotateY(yawFixRad);
  } else {
    const pos = geometry.attributes.position;
    const alongX = yAsymmetry(pos, true);
    const alongZ = yAsymmetry(pos, false);
    if (alongX.diff > alongZ.diff) geometry.rotateY(Math.PI / 2); // fuselage onto Z
    // Nose = the tapered end slab; put it at -Z
    if (!noseAtNegativeZ(geometry.attributes.position)) geometry.rotateY(Math.PI);
  }
  if (extraYawRad) geometry.rotateY(extraYawRad); // manifest nudge on top

  geometry.computeBoundingBox();
  geometry.boundingBox.getSize(_size);
  const s = targetLenM / (_size.z || 1);
  geometry.scale(s, s, s);
  // Re-center: rotation may have moved the bbox center off origin
  geometry.computeBoundingBox();
  geometry.boundingBox.getCenter(_center);
  geometry.translate(-_center.x, -_center.y, -_center.z);
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadOne(entry) {
  const gltf = await _loader.loadAsync(entry.url);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) parts.push(bakeMeshGeometry(o));
  });
  if (parts.length === 0) throw new Error(`no meshes in ${entry.url}`);
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return orientAndScale(merged, entry.targetLenM, entry.yawFixRad ?? null, entry.extraYawRad ?? 0);
}

/**
 * Load every mapped traffic archetype. Resolves to an array aligned with
 * the archetype index; null where the primitive should stay. Individual
 * failures degrade to the primitive (never reject the whole fleet).
 */
export async function loadTrafficGeometries() {
  return Promise.all(
    TRAFFIC_MODELS.map(async (entry) => {
      if (!entry) return null;
      try {
        return await loadOne(entry);
      } catch (err) {
        console.warn(`[fly-models] ${entry.url} failed, keeping primitive:`, err);
        return null;
      }
    })
  );
}

/**
 * Compute the wrapper-group correction for a full-material model (the
 * player plane keeps its GLTF materials — no baking). Returns
 * {rotY, scale, offsetY} to apply on a parent group.
 */
export function computeModelCorrection(object3D, targetLenM, yawFixRad = null, extraYawRad = 0) {
  object3D.updateMatrixWorld(true);
  _box.setFromObject(object3D);
  _box.getSize(_size);
  _box.getCenter(_center);

  // Collect world-space vertices relative to the bbox center, then apply
  // the same axis (fin-asymmetry) + nose (tapered end slab) tests as
  // orientAndScale.
  const v = new Vector3();
  const xs = [];
  const ys = [];
  const zs = [];
  object3D.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(_center);
      xs.push(v.x);
      ys.push(v.y);
      zs.push(v.z);
    }
  });
  const asym = (axis) => {
    let negMax = -Infinity;
    let posMax = -Infinity;
    for (let i = 0; i < axis.length; i++) {
      if (axis[i] < 0) negMax = Math.max(negMax, ys[i]);
      else posMax = Math.max(posMax, ys[i]);
    }
    return Math.abs(posMax - negMax);
  };
  const noseAtNegative = (axis) => {
    let min = Infinity;
    let max = -Infinity;
    for (const c of axis) {
      if (c < min) min = c;
      if (c > max) max = c;
    }
    const slab = (max - min) * 0.12;
    let negMinY = Infinity;
    let negMaxY = -Infinity;
    let posMinY = Infinity;
    let posMaxY = -Infinity;
    for (let i = 0; i < axis.length; i++) {
      if (axis[i] <= min + slab) {
        negMinY = Math.min(negMinY, ys[i]);
        negMaxY = Math.max(negMaxY, ys[i]);
      }
      if (axis[i] >= max - slab) {
        posMinY = Math.min(posMinY, ys[i]);
        posMaxY = Math.max(posMaxY, ys[i]);
      }
    }
    const negH = negMaxY > negMinY ? negMaxY - negMinY : 0;
    const posH = posMaxY > posMinY ? posMaxY - posMinY : 0;
    return negH <= posH; // slimmer end = nose
  };

  let rotY;
  let lengthAxisIsX;
  if (yawFixRad != null) {
    rotY = yawFixRad;
    lengthAxisIsX = Math.abs(Math.sin(rotY)) > 0.5;
  } else if (asym(xs) > asym(zs)) {
    // Fuselage along X. rotY=π/2 maps +X → -Z, so the nose must sit at +X;
    // otherwise spin the other way.
    lengthAxisIsX = true;
    rotY = noseAtNegative(xs) ? -Math.PI / 2 : Math.PI / 2;
  } else {
    lengthAxisIsX = false;
    rotY = noseAtNegative(zs) ? 0 : Math.PI;
  }
  const len = lengthAxisIsX ? _size.x : _size.z;
  return { rotY: rotY + extraYawRad, scale: targetLenM / (len || 1), offsetY: 0 };
}

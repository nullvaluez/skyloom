import { Box3, BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { GLTFLoader } from 'three-stdlib';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAFFIC_MODELS } from './assets';
import { NAV_LIGHTS } from './fly-constants';

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

  // Round 8: per-vertex emissive (rgb = material.emissive × intensity,
  // w = nav-light mode, 0 = steady). Baked on EVERY vertex — hull verts
  // from non-emissive materials get (0,0,0,0) — because mergeGeometries
  // requires attribute uniformity across all parts (incl. the appended
  // nav-light octahedra). Preserves any source-model emissive through the
  // merge; consumed by applyNavLights (world-bend.js).
  const emissive = new Float32Array(count * 4); // zero-filled = dark hull
  const em = mesh.material?.emissive;
  if (em && (em.r > 0 || em.g > 0 || em.b > 0)) {
    const k = mesh.material.emissiveIntensity ?? 1;
    for (let i = 0; i < count; i++) {
      emissive[i * 4] = em.r * k;
      emissive[i * 4 + 1] = em.g * k;
      emissive[i * 4 + 2] = em.b * k;
      // w stays 0 — steady
    }
  }

  const clean = new BufferGeometry();
  clean.setAttribute('position', g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  clean.setAttribute('normal', g.attributes.normal);
  clean.setAttribute('color', new BufferAttribute(colors, 3));
  clean.setAttribute('aEmissive', new BufferAttribute(emissive, 4));
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

// --- Round 8: procedural nav lights (baked into the merged geometry) --------

// Deterministic [0,1) phase per model+light so the fleet never blinks in
// unison (every instance of one archetype DOES share phases — the per-
// instance variety comes from the 7 archetypes × 6 lights all differing).
function phaseHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// Emissive multiplier baked into aEmissive.rgb — well past the toy bloom
// threshold (0.56) so lit lights pop like the crown/spire emitters do.
const NAV_EMIT = 2.0;

/**
 * Find the nav-light anchor points on an ORIENTED geometry (nose -Z, real
 * meters): wingtip extremes (min/max X), tail-top (max Y in the aft 15%
 * slab), belly (min Y within the mid-fuselage 50%). Vertex-derived, so the
 * lights sit ON the model whatever its silhouette (a helicopter's "wingtips"
 * land on the rotor disc edge — reads fine at toy scale).
 */
function findNavAnchors(geometry) {
  const pos = geometry.attributes.position;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const aftZ = bb.max.z - (bb.max.z - bb.min.z) * 0.15;
  const midZ = (bb.min.z + bb.max.z) / 2;
  const cgHalf = (bb.max.z - bb.min.z) * 0.25;
  let minX = Infinity;
  let maxX = -Infinity;
  let tailY = -Infinity;
  let bellyY = Infinity;
  const port = new Vector3();
  const stbd = new Vector3();
  const tail = new Vector3();
  const belly = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (x < minX) {
      minX = x;
      port.set(x, y, z);
    }
    if (x > maxX) {
      maxX = x;
      stbd.set(x, y, z);
    }
    if (z >= aftZ && y > tailY) {
      tailY = y;
      tail.set(x, y, z);
    }
    if (Math.abs(z - midZ) < cgHalf && y < bellyY) {
      bellyY = y;
      belly.set(x, y, z);
    }
  }
  return { port, stbd, tail, belly };
}

/**
 * Build ONE geometry holding every nav-light octahedron for a model, with
 * the same attribute set as the baked hull (position/normal/color/aEmissive)
 * so mergeGeometries accepts it. Mode encoding in aEmissive.w:
 * 0 = steady; (0, 0.5] = strobe (phase = w×2); (0.5, 1] = beacon blink
 * (phase = (w−0.5)×2). Vertex COLOR is white — the applyNavLights fragment
 * dims the emissive by the instance tint's luma (the stale-ghost ladder),
 * and a white base keeps fresh traffic's lights at full strength.
 */
function buildNavLights(geometry, entry) {
  const { port, stbd, tail, belly } = findNavAnchors(geometry);
  const s = NAV_LIGHTS.sizeM;
  const h = (i) => phaseHash(`${entry.url}:${i}`);
  const lights = [
    { p: port, color: NAV_LIGHTS.port, w: 0 }, // steady red
    { p: stbd, color: NAV_LIGHTS.starboard, w: 0 }, // steady green
    { p: tail, color: NAV_LIGHTS.tail, w: 0 }, // steady white
    { p: belly, color: NAV_LIGHTS.beacon, w: 0.501 + h(3) * 0.499 }, // beacon
    // Wingtip strobes: white, offset slightly aft of the steady tip lights
    { p: port, dz: s * 2, color: NAV_LIGHTS.tail, w: 0.001 + h(4) * 0.499 },
    { p: stbd, dz: s * 2, color: NAV_LIGHTS.tail, w: 0.001 + h(5) * 0.499 },
  ];

  // Octahedron: 6 corners / 8 faces, non-indexed (24 verts per light)
  const FACES = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  const n = lights.length * 24;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const emissive = new Float32Array(n * 4);
  let v = 0;
  for (const light of lights) {
    const cx = light.p.x;
    const cy = light.p.y;
    const cz = light.p.z + (light.dz ?? 0);
    const corners = [
      [cx + s, cy, cz], [cx - s, cy, cz],
      [cx, cy + s, cz], [cx, cy - s, cz],
      [cx, cy, cz + s], [cx, cy, cz - s],
    ];
    _color.set(light.color);
    for (const face of FACES) {
      for (const ci of face) {
        positions[v * 3] = corners[ci][0];
        positions[v * 3 + 1] = corners[ci][1];
        positions[v * 3 + 2] = corners[ci][2];
        colors[v * 3] = 1;
        colors[v * 3 + 1] = 1;
        colors[v * 3 + 2] = 1;
        emissive[v * 4] = _color.r * NAV_EMIT;
        emissive[v * 4 + 1] = _color.g * NAV_EMIT;
        emissive[v * 4 + 2] = _color.b * NAV_EMIT;
        emissive[v * 4 + 3] = light.w;
        v += 1;
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('aEmissive', new BufferAttribute(emissive, 4));
  return g;
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
  const oriented = orientAndScale(
    merged,
    entry.targetLenM,
    entry.yawFixRad ?? null,
    entry.extraYawRad ?? 0
  );
  // Nav lights are appended AFTER orientAndScale — the geometry is now
  // nose -Z / +Y up / real meters, so wingtip/tail/belly detection is
  // convention-stable across models.
  const lights = buildNavLights(oriented, entry);
  const lit = mergeGeometries([oriented, lights], false);
  oriented.dispose();
  lights.dispose();
  lit.computeBoundingSphere();
  return lit;
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

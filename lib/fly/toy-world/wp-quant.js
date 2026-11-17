/**
 * WORLD PASS B r2 (ARRIVAL, quantize): building vertices stored as normalized
 * Int16 on the CPU and on the GPU.
 *
 * Position and the bend anchor are tile-local metres on a fixed lattice of
 * 1/16 m (Int16, +-2047.9 m: a z14 tile is 2,446 m across, so its local
 * coordinates stay inside +-1,300 m); position carries a 4th component so the
 * attribute is R16G16B16A16_SNORM under ANGLE / D3D11 (there is no 3-component
 * 16-bit vertex format; a 3-component one is expanded on upload). The facade uv
 * is on a 1/512 lattice (+-64 uv units: 26.4 / 27.2 m per unit, so +-1.7 km).
 * The mesh's Y offset (its tile's median ground) lives in mesh.position.y, so
 * the local Y range holds any building on that ground.
 *
 * Bytes per building vertex: position 12 -> 8, anchor 8 -> 4, uv 8 -> 4, on the
 * CPU array and on the GPU buffer alike (the budget tool counts the CPU array;
 * here the two are the same size, nothing is moved out of its sight).
 *
 * Two halves keep every reader on metres:
 *  - CPU: WpQuantAttribute's get/set read and write METRES (uv units for uv),
 *    so three's bounding volumes, raycasts and every getX/getY reader (night
 *    lights) see what they saw before. Raw `.array` readers must use the
 *    stride (itemSize) and the scale (`wpK`); the engine's drape, repair and
 *    footing write integer deltas.
 *  - GPU: the decode is a macro at the top of the vertex shader of every
 *    material that draws these meshes (inserted before main) (the shared architecture material, its
 *    CHUNK_FADE twins, and the shadow depth material set as the mesh's
 *    customDepthMaterial), so every later use of `position`, `uv` and
 *    `aBendAnchor` reads metres. A separate program cache key, compiled only
 *    with the flag on. With the flag off nothing here runs.
 */
import { BufferAttribute, MeshDepthMaterial, ShaderChunk } from 'three';

export const WPQ_POS_K = 16; // lattice steps per metre (position, anchor)
export const WPQ_UV_K = 512; // lattice steps per uv unit
const I16 = 32767;
// normalized SHORT decodes to c / 32767; times these gives metres / uv units.
const POS_DECODE = (I16 / WPQ_POS_K).toFixed(7);
const UV_DECODE = (I16 / WPQ_UV_K).toFixed(9);

/** A normalized Int16 attribute whose accessors speak the dequantized unit. */
export class WpQuantAttribute extends BufferAttribute {
  constructor(array, itemSize, k = 1) {
    super(array, itemSize, true);
    this.isWpQuant = true;
    this.wpK = k; // metres (or uv units) per lattice step
  }
  copy(source) {
    super.copy(source);
    this.wpK = source.wpK;
    this.isWpQuant = true;
    return this;
  }
  getComponent(i, c) { return this.array[i * this.itemSize + c] * this.wpK; }
  setComponent(i, c, v) { this.array[i * this.itemSize + c] = Math.round(v / this.wpK); return this; }
  getX(i) { return this.array[i * this.itemSize] * this.wpK; }
  getY(i) { return this.array[i * this.itemSize + 1] * this.wpK; }
  getZ(i) { return this.array[i * this.itemSize + 2] * this.wpK; }
  getW(i) { return this.array[i * this.itemSize + 3] * this.wpK; }
  setX(i, v) { this.array[i * this.itemSize] = Math.round(v / this.wpK); return this; }
  setY(i, v) { this.array[i * this.itemSize + 1] = Math.round(v / this.wpK); return this; }
  setZ(i, v) { this.array[i * this.itemSize + 2] = Math.round(v / this.wpK); return this; }
  setW(i, v) { this.array[i * this.itemSize + 3] = Math.round(v / this.wpK); return this; }
  setXY(i, x, y) { return this.setX(i, x).setY(i, y); }
  setXYZ(i, x, y, z) { return this.setX(i, x).setY(i, y).setZ(i, z); }
  setXYZW(i, x, y, z, w) { return this.setX(i, x).setY(i, y).setZ(i, z).setW(i, w); }
}

/** Float32 metres (stride 3) from a quantized position array (stride 4), for rare fallbacks. */
export function dequantPositions(q) {
  const n = q.length >> 2, out = new Float32Array(n * 3), k = 1 / WPQ_POS_K;
  for (let v = 0; v < n; v++) { out[v * 3] = q[v * 4] * k; out[v * 3 + 1] = q[v * 4 + 1] * k; out[v * 3 + 2] = q[v * 4 + 2] * k; }
  return out;
}

// Inserted just before `void main`: every global (three's chunks declare
// helpers with parameters named `uv` and struct fields named `position`) is
// already declared, so the macros reach only main's body, where the
// attributes are read (begin_vertex, uv_vertex, the bend).
const decodeHead = (anchor) => [
  `vec3 wpQPosition() { return position * ${POS_DECODE}; }`,
  `vec2 wpQUv() { return uv * ${UV_DECODE}; }`,
  ...(anchor ? [`vec2 wpQAnchor() { return aBendAnchor * ${POS_DECODE}; }`] : []),
  '#define position wpQPosition()',
  '#define uv wpQUv()',
  ...(anchor ? ['#define aBendAnchor wpQAnchor()'] : []),
  '',
].join('\n');
// A local or a field named like a decoded attribute inside main would become a
// call: refuse to build such a program rather than draw wrong.
const SHADOWED = /\b(?:in|out|inout|float|vec2|vec3|vec4)\s+(?:position|uv|aBendAnchor)\b|\.(?:position|uv|aBendAnchor)\b/;
const INCLUDE = /^[ \t]*#include +<([\w\d./]+)>/gm;
const expand = (src, depth = 0) => (depth > 8 ? src : src.replace(INCLUDE, (m, k) => (ShaderChunk[k] === undefined ? m : expand(ShaderChunk[k], depth + 1))));

/** The vertex-shader edit (exported for the node gate). Throws when it cannot be made safely. */
export function wpQuantVertex(src, { anchor = true } = {}) {
  const at = src.lastIndexOf('void main');
  if (at < 0 || src.indexOf('void main') !== at) throw new Error('WORLD_ARRIVAL quantize: no single void main in the vertex shader');
  if (anchor && !/attribute\s+vec2\s+aBendAnchor\s*;/.test(src.slice(0, at))) throw new Error('WORLD_ARRIVAL quantize: aBendAnchor is not declared before main');
  if (SHADOWED.test(expand(src.slice(at)))) throw new Error('WORLD_ARRIVAL quantize: a name in main shadows a decoded attribute');
  return src.slice(0, at) + decodeHead(anchor) + src.slice(at);
}

/** Decode quantized attributes in this material (idempotent; survives a later onBeforeCompile wrap). */
export function patchQuantMaterial(material, { anchor = true } = {}) {
  if (!material || material.userData.wpQuant) return material;
  material.userData.wpQuant = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    prev?.call(this, shader, renderer);
    shader.vertexShader = wpQuantVertex(shader.vertexShader, { anchor });
  };
  material.customProgramCacheKey = function () {
    return `${prevKey ? prevKey.call(this) : ''}|wpq1${anchor ? 'a' : ''}`;
  };
  material.needsUpdate = true;
  return material;
}

/** The shadow-pass depth material for quantized building meshes (three's default, decoded). */
let _depth = null;
export function quantDepthMaterial() {
  return (_depth ??= patchQuantMaterial(new MeshDepthMaterial(), { anchor: false }));
}

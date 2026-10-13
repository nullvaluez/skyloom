// Observation lounge — baked ambient occlusion: the file format, the
// geometry signature that keeps it honest, and applying it at mount.
//
// scripts/build-lounge-ao.mjs raycasts the REAL room geometry offline (a BVH,
// 48 cosine-weighted rays per vertex, 64 per floor texel) and writes
// public/models/lounge-ao-v1.bin:
//   - one byte of AO per vertex, every bucket in BAKE_BUCKETS order;
//   - a floor AO map over the floor rectangle (contact shadows of every chair
//     leg, table foot, planter and wall junction).
// The file carries the signature of the geometry it was baked from. A room
// whose geometry changed without a re-bake does not match, keeps AO = 1 and
// says so (scripts/verify-airport-lounge.mjs fails the same mismatch).
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, UnsignedByteType } from 'three';
import { SURF } from './room-build.js';
import { HALF_X, BACK_Z } from './room-plan.js';
import { LOUNGE_ROOM } from '../observation-config.js';

export const AO_URL = '/models/lounge-ao-v1.bin';
const MAGIC = 0x4f41474c; // 'LGAO'
const VERSION = 1;
/** Buckets in file order (each present bucket contributes its vertex count). */
export const BAKE_BUCKETS = ['stone', 'wood', 'metal', 'leather', 'fabric', 'plaster', 'small', 'foliage', 'emissive'];
/** Floor AO map: the whole floor plate inside the glass. */
export const FLOOR_RECT = Object.freeze({ x0: -HALF_X, x1: HALF_X, z0: LOUNGE_ROOM.glass.baseZ, z1: BACK_Z, w: 512, h: 352 });

/** Surfaces whose shading AO is analytic (shell corners, floor map) — their
 *  few, far-apart vertices would smear a per-vertex value across metres. */
export function skipsVertexAO(bucket, flag) {
  if (bucket === 'plaster' || bucket === 'emissive') return true;
  return flag === SURF.TILES || flag === SURF.DECK || flag === SURF.FLUTED || flag === SURF.FLUTED_FINE
    || flag === SURF.RUG || flag === SURF.BAFFLE || flag === SURF.LONG;
}

/** FNV-1a over bucket names, counts and millimetre-quantised positions. */
export function geometrySignature(buckets) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    h ^= v & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  for (const name of BAKE_BUCKETS) {
    const g = buckets[name];
    if (!g) continue;
    for (let i = 0; i < name.length; i++) mix(name.charCodeAt(i));
    const p = g.attributes.position.array;
    mix(p.length / 3);
    mix(g.index ? g.index.count : 0);
    for (let i = 0; i < p.length; i++) mix(Math.round(p[i] * 1000) | 0);
  }
  return h >>> 0;
}

/** Serialise a bake (node). */
export function encodeBake(signature, vertexAO, floorAO) {
  const head = 4 * 4 + 4 * 2 + 4 * 4;
  const buf = new ArrayBuffer(head + vertexAO.length + floorAO.length);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, signature, true);
  dv.setUint32(12, vertexAO.length, true);
  dv.setUint32(16, FLOOR_RECT.w, true);
  dv.setUint32(20, FLOOR_RECT.h, true);
  dv.setFloat32(24, FLOOR_RECT.x0, true);
  dv.setFloat32(28, FLOOR_RECT.x1, true);
  dv.setFloat32(32, FLOOR_RECT.z0, true);
  dv.setFloat32(36, FLOOR_RECT.z1, true);
  new Uint8Array(buf, head, vertexAO.length).set(vertexAO);
  new Uint8Array(buf, head + vertexAO.length).set(floorAO);
  return buf;
}

/** Parse a bake; null when the bytes are not a bake. */
export function decodeBake(buf) {
  if (!buf || buf.byteLength < 40) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== VERSION) return null;
  const n = dv.getUint32(12, true), w = dv.getUint32(16, true), h = dv.getUint32(20, true);
  if (buf.byteLength !== 40 + n + w * h) return null;
  return {
    signature: dv.getUint32(8, true),
    vertexAO: new Uint8Array(buf, 40, n),
    floor: { w, h, x0: dv.getFloat32(24, true), x1: dv.getFloat32(28, true), z0: dv.getFloat32(32, true), z1: dv.getFloat32(36, true), data: new Uint8Array(buf, 40 + n, w * h) },
  };
}

/** Write the per-vertex AO into aSurf.z. Returns false on a signature miss. */
export function applyVertexAO(buckets, bake) {
  if (!bake || bake.signature !== geometrySignature(buckets)) return false;
  let o = 0;
  for (const name of BAKE_BUCKETS) {
    const g = buckets[name];
    if (!g) continue;
    const surf = g.attributes.aSurf;
    for (let i = 0; i < surf.count; i++) surf.array[i * 4 + 2] = bake.vertexAO[o++] / 255;
    surf.needsUpdate = true;
  }
  return o === bake.vertexAO.length;
}

/** The floor AO map as a texture (R8, mipmapped, clamped). */
export function floorAOTexture(bake) {
  const f = bake?.floor;
  const data = f ? f.data : new Uint8Array([255]);
  const t = new DataTexture(data, f ? f.w : 1, f ? f.h : 1, RedFormat, UnsignedByteType);
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.name = 'lounge-floor-ao';
  t.needsUpdate = true;
  return t;
}

// Session cache: the bake is the same at every airport.
let _bake = null, _pending = null;
/** Fetch the bake once per session (browser). Resolves null when missing. */
export function loadBake() {
  if (_bake) return Promise.resolve(_bake);
  if (!_pending) {
    _pending = (typeof fetch === 'function' ? fetch(AO_URL) : Promise.reject(new Error('no fetch')))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (_bake = decodeBake(buf)))
      .catch(() => null)
      .finally(() => { _pending = null; });
  }
  return _pending;
}

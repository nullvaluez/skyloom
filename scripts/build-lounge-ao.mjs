/**
 * Observation lounge — offline ambient-occlusion bake (first-party).
 *
 *   node scripts/build-lounge-ao.mjs [--rays 48] [--floor-rays 64] [--out <file>]
 *
 * Builds the room exactly as the game does (lib/fly/lounge/room-build.js),
 * raycasts the real triangles through a BVH and writes
 * public/models/lounge-ao-v1.bin (format: lib/fly/lounge/room-ao.js):
 *   - per-vertex AO for compact objects (furniture, props, fixtures);
 *   - a 512 x 352 floor AO map (contact shadows under every leg and foot,
 *     the floor-to-wall junctions, the bar and planters).
 * Long members and the big flat shell keep analytic AO in the shader.
 *
 * Re-run after any geometry change: verify-airport-lounge.mjs fails a stale
 * bake (the file carries the geometry's signature).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLoungeRoom } from '../lib/fly/lounge/room-build.js';
import { BAKE_BUCKETS, FLOOR_RECT, encodeBake, geometrySignature, skipsVertexAO } from '../lib/fly/lounge/room-ao.js';
import { buildTriBvh } from './_tri-bvh.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const RAYS = arg('rays', 48);
const FLOOR_RAYS = arg('floor-rays', 64);
const OBJECT_RANGE = 0.42; // metres: crevices and contact
const FLOOR_RANGE = 0.85; // metres: the soft pool under a seat or table

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --out writes elsewhere (scripts/verify-lounge-walk.mjs --bake compares a fresh bake with the shipped file).
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'public/models/lounge-ao-v1.bin');

const t0 = performance.now();
const room = buildLoungeRoom();
const buckets = room.buckets;

// ---------------------------------------------------------------------------
// Triangle soup + BVH (scripts/_tri-bvh.mjs: median split on the widest
// centroid axis, leaves <= 4 — shared with the lounge walk gates)
// ---------------------------------------------------------------------------
const { triCount, cast } = buildTriBvh(buckets, BAKE_BUCKETS);

// Cosine-weighted hemisphere directions (Fibonacci), around +Z.
function hemisphere(n) {
  const dirs = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), a = i * g;
    dirs[i * 3] = r * Math.cos(a); dirs[i * 3 + 1] = r * Math.sin(a); dirs[i * 3 + 2] = Math.sqrt(1 - r * r);
  }
  return dirs;
}

/** Obscurance at p around n: 1 - mean of (1 - t/range) over rays that hit. */
function occlusion(px, py, pz, nx, ny, nz, dirs, range, spin) {
  // Tangent frame with a per-sample spin so neighbouring samples decorrelate.
  let tx = Math.abs(nx) < 0.9 ? 1 : 0, ty = tx ? 0 : 1, tz = 0;
  let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  let l = Math.hypot(bx, by, bz); bx /= l; by /= l; bz /= l;
  tx = by * nz - bz * ny; ty = bz * nx - bx * nz; tz = bx * ny - by * nx;
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const ux = tx * cs + bx * sn, uy = ty * cs + by * sn, uz = tz * cs + bz * sn;
  const vx = bx * cs - tx * sn, vy = by * cs - ty * sn, vz = bz * cs - tz * sn;
  const ox = px + nx * 0.003, oy = py + ny * 0.003, oz = pz + nz * 0.003;
  let occ = 0;
  const n = dirs.length / 3;
  for (let i = 0; i < n; i++) {
    const a = dirs[i * 3], b = dirs[i * 3 + 1], c = dirs[i * 3 + 2];
    let dx = ux * a + vx * b + nx * c, dy = uy * a + vy * b + ny * c, dz = uz * a + vz * b + nz * c;
    l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const t = cast(ox, oy, oz, dx, dy, dz, range);
    if (t < range) occ += 1 - t / range;
  }
  return 1 - occ / n;
}

const objectDirs = hemisphere(RAYS), floorDirs = hemisphere(FLOOR_RAYS);
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return (s - Math.floor(s)) * Math.PI * 2; };

// ---------------------------------------------------------------------------
// Per-vertex AO
// ---------------------------------------------------------------------------
let vertexTotal = 0;
for (const name of BAKE_BUCKETS) if (buckets[name]) vertexTotal += buckets[name].attributes.position.count;
const vertexAO = new Uint8Array(vertexTotal);
let o = 0, baked = 0;
for (const name of BAKE_BUCKETS) {
  const g = buckets[name];
  if (!g) continue;
  const p = g.attributes.position.array, nrm = g.attributes.normal.array, surf = g.attributes.aSurf.array;
  for (let i = 0; i < p.length / 3; i++, o++) {
    if (skipsVertexAO(name, Math.round(surf[i * 4 + 3]))) { vertexAO[o] = 255; continue; }
    const ao = occlusion(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], objectDirs, OBJECT_RANGE, hash(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    vertexAO[o] = Math.max(0, Math.min(255, Math.round(ao * 255)));
    baked++;
  }
}
const t1 = performance.now();

// ---------------------------------------------------------------------------
// Floor AO map (texel centres on the floor plane, normal up)
// ---------------------------------------------------------------------------
const { w, h, x0, x1, z0, z1 } = FLOOR_RECT;
const floor = new Uint8Array(w * h);
for (let j = 0; j < h; j++) {
  const z = z0 + ((j + 0.5) / h) * (z1 - z0);
  for (let i = 0; i < w; i++) {
    const x = x0 + ((i + 0.5) / w) * (x1 - x0);
    // Rugs and the grille sit a few millimetres above the slab: start above them.
    const ao = occlusion(x, 0.016, z, 0, 1, 0, floorDirs, FLOOR_RANGE, hash(x, 0, z));
    floor[j * w + i] = Math.max(0, Math.min(255, Math.round(ao * 255)));
  }
}
const t2 = performance.now();

const signature = geometrySignature(buckets);
fs.writeFileSync(out, Buffer.from(encodeBake(signature, vertexAO, floor)));
let sum = 0;
for (const v of floor) sum += v;
console.log(`lounge AO: ${triCount} triangles, ${baked}/${vertexTotal} vertices baked (${((t1 - t0) / 1000).toFixed(1)} s), floor ${w}x${h} (${((t2 - t1) / 1000).toFixed(1)} s, mean ${(sum / floor.length / 255).toFixed(3)})`);
console.log(`signature ${signature.toString(16)} -> ${path.relative(root, out)} (${fs.statSync(out).size} bytes)`);

/**
 * Observation lounge — offline ambient-occlusion bake (first-party).
 *
 *   node scripts/build-lounge-ao.mjs [--rays 48] [--floor-rays 64]
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

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const RAYS = arg('rays', 48);
const FLOOR_RAYS = arg('floor-rays', 64);
const OBJECT_RANGE = 0.42; // metres: crevices and contact
const FLOOR_RANGE = 0.85; // metres: the soft pool under a seat or table

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/models/lounge-ao-v1.bin');

const t0 = performance.now();
const room = buildLoungeRoom();
const buckets = room.buckets;

// ---------------------------------------------------------------------------
// Triangle soup + BVH (median split on the widest centroid axis, leaves <= 4)
// ---------------------------------------------------------------------------
let triCount = 0;
for (const name of BAKE_BUCKETS) if (buckets[name]) triCount += buckets[name].index.count / 3;
const tri = new Float32Array(triCount * 9); // v0, e1, e2
const cen = new Float32Array(triCount * 3);
const box = new Float32Array(triCount * 6);
{
  let t = 0;
  for (const name of BAKE_BUCKETS) {
    const g = buckets[name];
    if (!g) continue;
    const p = g.attributes.position.array, ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3, t++) {
      const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      const o = t * 9;
      tri[o] = p[a]; tri[o + 1] = p[a + 1]; tri[o + 2] = p[a + 2];
      tri[o + 3] = p[b] - p[a]; tri[o + 4] = p[b + 1] - p[a + 1]; tri[o + 5] = p[b + 2] - p[a + 2];
      tri[o + 6] = p[c] - p[a]; tri[o + 7] = p[c + 1] - p[a + 1]; tri[o + 8] = p[c + 2] - p[a + 2];
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(p[a + k], p[b + k], p[c + k]), hi = Math.max(p[a + k], p[b + k], p[c + k]);
        box[t * 6 + k] = lo; box[t * 6 + 3 + k] = hi;
        cen[t * 3 + k] = (lo + hi) / 2;
      }
    }
  }
}
const order = new Uint32Array(triCount).map((_, i) => i);
const nodeBox = [], nodeA = [], nodeB = []; // leaf: a = start, b = -count ; inner: a = left, b = right
function buildNode(start, end) {
  const id = nodeA.length;
  nodeA.push(0); nodeB.push(0);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity];
  for (let i = start; i < end; i++) {
    const t = order[i];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], box[t * 6 + k]); hi[k] = Math.max(hi[k], box[t * 6 + 3 + k]);
      clo[k] = Math.min(clo[k], cen[t * 3 + k]); chi[k] = Math.max(chi[k], cen[t * 3 + k]);
    }
  }
  nodeBox.push(...lo, ...hi);
  if (end - start <= 4) { nodeA[id] = start; nodeB[id] = -(end - start); return id; }
  const axis = chi[0] - clo[0] >= chi[1] - clo[1] && chi[0] - clo[0] >= chi[2] - clo[2] ? 0 : chi[1] - clo[1] >= chi[2] - clo[2] ? 1 : 2;
  const mid = (start + end) >> 1;
  // nth_element by centroid along the axis
  const sub = Array.from(order.subarray(start, end)).sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis]);
  order.set(sub, start);
  const l = buildNode(start, mid), r = buildNode(mid, end);
  nodeA[id] = l; nodeB[id] = r;
  return id;
}
buildNode(0, triCount);
const NB = new Float32Array(nodeBox), NA = new Int32Array(nodeA), NBi = new Int32Array(nodeB);
const stack = new Int32Array(128);

/** Closest hit distance along a unit ray within tMax (Infinity on a miss). */
function cast(ox, oy, oz, dx, dy, dz, tMax) {
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let best = tMax, sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const n = stack[--sp], b = n * 6;
    let t1 = (NB[b] - ox) * ix, t2 = (NB[b + 3] - ox) * ix;
    let tn = Math.min(t1, t2), tf = Math.max(t1, t2);
    t1 = (NB[b + 1] - oy) * iy; t2 = (NB[b + 4] - oy) * iy;
    tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
    t1 = (NB[b + 2] - oz) * iz; t2 = (NB[b + 5] - oz) * iz;
    tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
    if (tf < Math.max(tn, 0) || tn > best) continue;
    const cnt = NBi[n];
    if (cnt <= 0) {
      const s = NA[n], e = s - cnt;
      for (let i = s; i < e; i++) {
        const o = order[i] * 9;
        const e1x = tri[o + 3], e1y = tri[o + 4], e1z = tri[o + 5], e2x = tri[o + 6], e2y = tri[o + 7], e2z = tri[o + 8];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det;
        const sx = ox - tri[o], sy = oy - tri[o + 1], sz = oz - tri[o + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-5 && t < best) best = t;
      }
    } else {
      stack[sp++] = NA[n];
      stack[sp++] = cnt;
    }
  }
  return best;
}

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

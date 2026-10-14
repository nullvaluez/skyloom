/**
 * A triangle BVH over merged room geometry (node, first-party). Shared by
 * scripts/build-lounge-ao.mjs (the AO bake's rays) and the lounge walk gates
 * (how close the walking eye comes to the room's real triangles).
 *
 *   const bvh = buildTriBvh(buckets, names?)   // BufferGeometry per bucket name
 *   bvh.cast(ox, oy, oz, dx, dy, dz, tMax)     // closest hit along a unit ray (Infinity on a miss)
 *   bvh.distance(px, py, pz, maxD?)            // distance to the nearest triangle (maxD when none is closer)
 *
 * The triangle soup and the tree are built exactly as the AO bake always
 * built them (Float32 triangles as v0 + two edges, median split on the widest
 * centroid axis, leaves of at most 4), so the bake's output is byte-identical
 * to the one it produced before this module existed.
 */
export function buildTriBvh(buckets, names = Object.keys(buckets)) {
  let triCount = 0;
  for (const name of names) if (buckets[name]) triCount += buckets[name].index.count / 3;
  const tri = new Float32Array(triCount * 9); // v0, e1, e2
  const cen = new Float32Array(triCount * 3);
  const box = new Float32Array(triCount * 6);
  {
    let t = 0;
    for (const name of names) {
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

  // Squared distance from p to triangle o (Ericson, Real-Time Collision Detection 5.1.5).
  function triDist2(o, px, py, pz) {
    const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
    const abx = tri[o + 3], aby = tri[o + 4], abz = tri[o + 5], acx = tri[o + 6], acy = tri[o + 7], acz = tri[o + 8];
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else {
      const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) { qx = ax + abx; qy = ay + aby; qz = az + abz; }
      else if (d6 >= 0 && d5 <= d6) { qx = ax + acx; qy = ay + acy; qz = az + acz; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        qx = ax + abx + (acx - abx) * w; qy = ay + aby + (acy - aby) * w; qz = az + abz + (acz - abz) * w;
      } else {
        const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
        qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
      }
    }
    const ex = px - qx, ey = py - qy, ez = pz - qz;
    return ex * ex + ey * ey + ez * ez;
  }

  /** Distance from a point to the nearest triangle, or maxD when none is nearer. */
  function distance(px, py, pz, maxD = Infinity) {
    let best2 = maxD * maxD, sp = 0;
    const st = new Int32Array(128);
    st[sp++] = 0;
    while (sp) {
      const n = st[--sp], b = n * 6;
      const dx = Math.max(NB[b] - px, 0, px - NB[b + 3]);
      const dy = Math.max(NB[b + 1] - py, 0, py - NB[b + 4]);
      const dz = Math.max(NB[b + 2] - pz, 0, pz - NB[b + 5]);
      if (dx * dx + dy * dy + dz * dz >= best2) continue;
      const cnt = NBi[n];
      if (cnt <= 0) {
        const s = NA[n], e = s - cnt;
        for (let i = s; i < e; i++) {
          const d2 = triDist2(order[i] * 9, px, py, pz);
          if (d2 < best2) best2 = d2;
        }
      } else {
        st[sp++] = NA[n];
        st[sp++] = cnt;
      }
    }
    return Math.sqrt(best2);
  }

  return { triCount, cast, distance };
}

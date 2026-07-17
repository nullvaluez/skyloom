/**
 * Dependency-free GLB inspector: prints per-model bbox and the height of
 * the cross-section in the outer 12% slabs of each horizontal axis, so a
 * human can pin down which end is the (tapered) nose. Ground truth for
 * lib/fly/assets.js yawFixRad decisions — no runtime guessing.
 *
 * Usage: node scripts/inspect-glb.mjs public/models/*.glb
 */
import fs from 'node:fs';

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mat4Multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function mat4FromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  return m;
}
function applyMat4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function parseGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not GLB');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

function accessorPositions(json, bin, accessorIdx) {
  const acc = json.accessors[accessorIdx];
  const bv = json.bufferViews[acc.bufferView];
  const stride = bv.byteStride || 12;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const { json, bin } = parseGlb(file);
  const verts = [];
  const walk = (nodeIdx, parentM) => {
    const node = json.nodes[nodeIdx];
    const local = node.matrix
      ? node.matrix
      : mat4FromTRS(node.translation, node.rotation, node.scale);
    const m = mat4Multiply(parentM, local);
    if (node.mesh != null) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.attributes?.POSITION == null) continue;
        for (const p of accessorPositions(json, bin, prim.attributes.POSITION)) {
          verts.push(applyMat4(m, p));
        }
      }
    }
    for (const c of node.children ?? []) walk(c, m);
  };
  const sceneNodes = json.scenes[json.scene ?? 0].nodes;
  for (const n of sceneNodes) walk(n, mat4Identity());

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts)
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];

  const slabHeights = (axis) => {
    const slab = size[axis] * 0.12;
    let nMin = Infinity, nMax = -Infinity, pMin = Infinity, pMax = -Infinity;
    for (const v of verts) {
      if (v[axis] <= min[axis] + slab) {
        nMin = Math.min(nMin, v[1]);
        nMax = Math.max(nMax, v[1]);
      }
      if (v[axis] >= max[axis] - slab) {
        pMin = Math.min(pMin, v[1]);
        pMax = Math.max(pMax, v[1]);
      }
    }
    return [+(nMax - nMin).toFixed(2), +(pMax - pMin).toFixed(2)];
  };

  const [xNegH, xPosH] = slabHeights(0);
  const [zNegH, zPosH] = slabHeights(2);
  console.log(`\n${file}`);
  console.log(`  verts ${verts.length}  size x=${size[0].toFixed(1)} y=${size[1].toFixed(1)} z=${size[2].toFixed(1)}  center [${center.map((c) => c.toFixed(1)).join(', ')}]`);
  console.log(`  end-slab heights:  -X ${xNegH}  +X ${xPosH}   |   -Z ${zNegH}  +Z ${zPosH}`);
  console.log(`  (nose = the SMALL height; fin/tail = the BIG one)`);
}

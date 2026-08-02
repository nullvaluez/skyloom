/**
 * Round 20 (C ICONS) — the OFFLINE marquee-monument GLB processor.
 *
 * WHY THIS EXISTS: the Fly loader is a bare three-stdlib GLTFLoader — there is
 * no draco / meshopt / KTX2 decoder in the app, and lib/fly/model-loader.js's
 * bake reads only `material.color` × an optional COLOR_0. A downloaded model
 * that carries its albedo in a TEXTURE therefore renders FLAT WHITE (the R15
 * trap that shipped traffic-military.glb white for seven rounds). So every
 * marquee monument is normalised OFFLINE, once, into a shape the runtime can
 * consume with no decoders and no texture sampling:
 *
 *   • every node transform flattened into the vertex data (one node, one mesh,
 *     one primitive, one white material — no scene graph to walk at runtime)
 *   • albedo resolved PER VERTEX into COLOR_0 (unsigned-byte normalised):
 *     baseColorFactor, or the baseColorTexture sampled at each vertex's UV and
 *     converted sRGB → linear (COLOR_0 is linear, like material.color, so the
 *     two simply multiply downstream). KHR_materials_pbrSpecularGlossiness
 *     diffuse is honoured as a fallback — several Poly-era models use it.
 *   • ALL textures, UVs, tangents, skins, animations, cameras and extensions
 *     dropped. The output GLB is uncompressed and extension-free by
 *     construction.
 *   • axis normalised to the monument convention: +Y up, base plane at y = 0,
 *     origin at the FOOTPRINT CENTRE (bbox centre in XZ). Real proportions are
 *     preserved — lib/fly/monument-loader.js scales by HEIGHT at mount, so the
 *     file's own units never matter, only its aspect.
 *
 * Usage:
 *   node scripts/r20-monument-bake.mjs --in <src.glb> --out public/models/monument-<id>.glb
 *        [--yaw <deg>]            spin about +Y BEFORE normalising (measured with inspect-glb)
 *        [--pitch <deg>]          spin about +X first (for Z-up sources)
 *        [--drop <a,b,c>]         drop primitives whose mesh/material name contains any substring
 *        [--drop-below <frac>]    drop verts below frac of the height (cuts baseplates/plazas)
 *        [--tint <hex>]           multiply every vertex colour by this hex
 *        [--recolor <mat=hex,…>]  force a material's colour (substring match on the material name)
 *        [--flat]                 recompute FLAT (per-face) normals — the low-poly toy read
 *        [--no-weld]              skip the (lossless) exact-attribute vertex weld
 *        [--quiet]
 *
 * Binary STL is accepted as an input too (Wikimedia Commons hosts several CC-BY
 * landmark scans in that format). STL carries no colour, so those models take
 * their one stone tone from --tint.
 *
 * Prints a report (verts / tris / bytes / bbox / per-material colours) that is
 * the ground truth for the manifest's `modifications` string. NOT wired into
 * the app or any gate — it is a build-time tool, run by hand, output committed.
 */
import fs from 'node:fs';
import path from 'node:path';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// --- args -------------------------------------------------------------------

function parseArgs(argv) {
  const out = { drop: [], recolor: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--in') out.in = next();
    else if (a === '--out') out.out = next();
    else if (a === '--yaw') out.yaw = parseFloat(next());
    else if (a === '--pitch') out.pitch = parseFloat(next());
    else if (a === '--drop') out.drop = next().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--drop-below') out.dropBelow = parseFloat(next());
    else if (a === '--tint') out.tint = next();
    else if (a === '--recolor')
      out.recolor = next()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [k, v] = s.split('=');
          return { match: k.toLowerCase(), hex: v };
        });
    else if (a === '--flat') out.flat = true;
    else if (a === '--no-weld') out.noWeld = true;
    else if (a === '--quiet') out.quiet = true;
    else throw new Error(`unknown arg ${a}`);
  }
  if (!out.in || !out.out) throw new Error('need --in and --out');
  return out;
}

// --- glb read ---------------------------------------------------------------

/**
 * Binary STL → the same in-memory shape a glTF parse produces (one primitive,
 * no material, no UVs). Wikimedia Commons hosts several CC-BY landmark scans as
 * STL, which is a geometry-only format: the model arrives WHITE and takes its
 * colour from --tint (white × tint == tint), which is exactly the authored
 * "one stone tone" a monument wants anyway.
 */
function readStl(buf) {
  const triCount = buf.readUInt32LE(80);
  if (84 + triCount * 50 !== buf.length) throw new Error('not a binary STL');
  const pos = new Float32Array(triCount * 9);
  const nrm = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const o = 84 + t * 50;
    const nx = buf.readFloatLE(o);
    const ny = buf.readFloatLE(o + 4);
    const nz = buf.readFloatLE(o + 8);
    for (let v = 0; v < 3; v++) {
      const p = o + 12 + v * 12;
      pos[t * 9 + v * 3] = buf.readFloatLE(p);
      pos[t * 9 + v * 3 + 1] = buf.readFloatLE(p + 4);
      pos[t * 9 + v * 3 + 2] = buf.readFloatLE(p + 8);
      nrm[t * 9 + v * 3] = nx;
      nrm[t * 9 + v * 3 + 1] = ny;
      nrm[t * 9 + v * 3 + 2] = nz;
    }
  }
  return {
    json: {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'stl' }],
      meshes: [{ name: 'stl', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, mode: 4 }] }],
      accessors: [
        { __inline: pos, count: triCount * 3, type: 'VEC3', componentType: 5126 },
        { __inline: nrm, count: triCount * 3, type: 'VEC3', componentType: 5126 },
      ],
    },
    buffers: [],
    dir: '.',
  };
}

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (file.toLowerCase().endsWith('.stl')) return readStl(buf);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) {
    // .gltf (JSON) with external/embedded buffers
    const json = JSON.parse(buf.toString('utf8'));
    const dir = path.dirname(file);
    const buffers = (json.buffers ?? []).map((b) => {
      if (!b.uri) throw new Error('gltf buffer without uri');
      if (b.uri.startsWith('data:')) return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
      return fs.readFileSync(path.join(dir, decodeURIComponent(b.uri)));
    });
    return { json, buffers, dir };
  }
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(chunk.toString('utf8').replace(/\0+$/, ''));
    else if (type === CHUNK_BIN) bin = Buffer.from(chunk);
    off += 8 + len + ((4 - (len % 4)) % 4 === 4 ? 0 : 0);
  }
  return { json, buffers: [bin], dir: path.dirname(file) };
}

function readAccessor(json, buffers, idx) {
  const acc = json.accessors[idx];
  if (acc.__inline) return acc.__inline; // STL path
  const n = NUM_COMPONENTS[acc.type];
  const comp = COMPONENT[acc.componentType];
  const out = new Float32Array(acc.count * n);
  if (acc.bufferView == null) return out; // all-zero (sparse base)
  const bv = json.bufferViews[acc.bufferView];
  const buf = buffers[bv.buffer ?? 0];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || comp.size * n;
  const norm = acc.normalized;
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      const o = base + i * stride + c * comp.size;
      let v;
      switch (acc.componentType) {
        case 5120: v = buf.readInt8(o); if (norm) v = Math.max(v / 127, -1); break;
        case 5121: v = buf.readUInt8(o); if (norm) v /= 255; break;
        case 5122: v = buf.readInt16LE(o); if (norm) v = Math.max(v / 32767, -1); break;
        case 5123: v = buf.readUInt16LE(o); if (norm) v /= 65535; break;
        case 5125: v = buf.readUInt32LE(o); break;
        default: v = buf.readFloatLE(o);
      }
      out[i * n + c] = v;
    }
  }
  return out;
}

// --- matrices ---------------------------------------------------------------

const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const applyPoint = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];
const applyDir = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

// --- colour -----------------------------------------------------------------

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
function hexToLinear(hex) {
  const h = hex.replace('#', '');
  return [0, 1, 2].map((i) => srgbToLinear(parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255));
}
const linearToHex = (rgb) =>
  '#' +
  rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, '0'))
    .join('');

/** Decode a glTF image (embedded bufferView or a URI) to raw RGBA + dims. */
async function decodeImage(json, buffers, dir, imageIdx) {
  const sharp = (await import('sharp')).default;
  const img = json.images[imageIdx];
  let data;
  if (img.bufferView != null) {
    const bv = json.bufferViews[img.bufferView];
    data = buffers[bv.buffer ?? 0].subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  } else if (img.uri?.startsWith('data:')) {
    data = Buffer.from(img.uri.slice(img.uri.indexOf(',') + 1), 'base64');
  } else if (img.uri) {
    data = fs.readFileSync(path.join(dir, decodeURIComponent(img.uri)));
  } else throw new Error(`image ${imageIdx} has no source`);
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { raw, w: info.width, h: info.height, ch: info.channels };
}

// --- main -------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const { json, buffers, dir } = readGlb(args.in);
const log = (...a) => { if (!args.quiet) console.log(...a); };

// 1. flatten the scene graph
const prims = [];
const walk = (nodeIdx, parentM) => {
  const node = json.nodes[nodeIdx];
  const local = node.matrix ? node.matrix : fromTRS(node.translation, node.rotation, node.scale);
  const m = mul(parentM, local);
  if (node.mesh != null) {
    const mesh = json.meshes[node.mesh];
    for (const p of mesh.primitives) {
      if (p.attributes?.POSITION == null) continue;
      if (p.mode != null && p.mode !== 4) continue; // TRIANGLES only
      prims.push({ prim: p, m, meshName: mesh.name ?? '', nodeName: node.name ?? '' });
    }
  }
  for (const c of node.children ?? []) walk(c, m);
};
const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i);
for (const n of sceneNodes) walk(n, ident());
if (prims.length === 0) throw new Error('no triangle primitives found');

// 2. per-primitive extraction + per-vertex albedo
const imageCache = new Map();
const outPos = [];
const outNrm = [];
const outCol = [];
const outIdx = [];
const matReport = new Map();

for (const rec of prims) {
  const p = rec.prim;
  const mat = p.material != null ? json.materials[p.material] : null;
  const matName = (mat?.name ?? '').toString();
  const tag = `${rec.nodeName}|${rec.meshName}|${matName}`.toLowerCase();
  if (args.drop.some((d) => tag.includes(d))) {
    log(`  drop primitive (matched --drop): ${tag}`);
    continue;
  }

  const pos = readAccessor(json, buffers, p.attributes.POSITION);
  const count = pos.length / 3;
  const nrm = p.attributes.NORMAL != null ? readAccessor(json, buffers, p.attributes.NORMAL) : null;
  const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(json, buffers, p.attributes.TEXCOORD_0) : null;
  const vcol = p.attributes.COLOR_0 != null ? readAccessor(json, buffers, p.attributes.COLOR_0) : null;
  const vcolN = vcol ? vcol.length / count : 0;

  // material albedo: metallic-roughness first, spec-gloss fallback, unlit ok
  const pbr = mat?.pbrMetallicRoughness ?? {};
  const sg = mat?.extensions?.KHR_materials_pbrSpecularGlossiness ?? null;
  const factor = (pbr.baseColorFactor ?? sg?.diffuseFactor ?? [1, 1, 1, 1]).slice(0, 3);
  const texInfo = pbr.baseColorTexture ?? sg?.diffuseTexture ?? null;
  let img = null;
  if (texInfo) {
    const texIdx = texInfo.index;
    const src = json.textures?.[texIdx]?.source;
    if (src != null) {
      if (!imageCache.has(src)) imageCache.set(src, await decodeImage(json, buffers, dir, src));
      img = imageCache.get(src);
    }
  }
  const forced = args.recolor.find((r) => matName.toLowerCase().includes(r.match) || tag.includes(r.match));
  const forcedRGB = forced ? hexToLinear(forced.hex) : null;

  // normal matrix = inverse-transpose of the upper 3x3; for the rigid+uniform
  // transforms these files carry, the matrix itself is close enough, but a
  // mirrored/anisotropic node would flip lighting — so do it properly.
  const m = rec.m;
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[3] * (a[1] * a[8] - a[2] * a[7]) +
    a[6] * (a[1] * a[5] - a[2] * a[4]);
  const invT =
    Math.abs(det) < 1e-12
      ? m
      : (() => {
          const c = [
            a[4] * a[8] - a[5] * a[7], a[5] * a[6] - a[3] * a[8], a[3] * a[7] - a[4] * a[6],
            a[2] * a[7] - a[1] * a[8], a[0] * a[8] - a[2] * a[6], a[1] * a[6] - a[0] * a[7],
            a[1] * a[5] - a[2] * a[4], a[2] * a[3] - a[0] * a[5], a[0] * a[4] - a[1] * a[3],
          ].map((v) => v / det);
          // pack column-major 4x4 so applyDir can use it
          return [c[0], c[3], c[6], 0, c[1], c[4], c[7], 0, c[2], c[5], c[8], 0, 0, 0, 0, 1];
        })();

  const base = outPos.length / 3;
  let acc = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const wp = applyPoint(m, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    outPos.push(wp[0], wp[1], wp[2]);
    if (nrm) {
      const wn = applyDir(invT, [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]);
      const len = Math.hypot(wn[0], wn[1], wn[2]) || 1;
      outNrm.push(wn[0] / len, wn[1] / len, wn[2] / len);
    } else outNrm.push(0, 1, 0);

    let rgb;
    if (forcedRGB) rgb = forcedRGB.slice();
    else {
      rgb = factor.slice();
      if (img && uv) {
        // nearest sample with REPEAT wrap (glTF's default sampler wrap)
        const u = uv[i * 2] - Math.floor(uv[i * 2]);
        const v = uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1]);
        const px = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w)));
        const py = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
        const o = (py * img.w + px) * img.ch;
        rgb = [
          srgbToLinear(img.raw[o] / 255) * factor[0],
          srgbToLinear(img.raw[o + 1] / 255) * factor[1],
          srgbToLinear(img.raw[o + 2] / 255) * factor[2],
        ];
      }
      if (vcol && vcolN >= 3) {
        rgb = [rgb[0] * vcol[i * vcolN], rgb[1] * vcol[i * vcolN + 1], rgb[2] * vcol[i * vcolN + 2]];
      }
    }
    acc = [acc[0] + rgb[0], acc[1] + rgb[1], acc[2] + rgb[2]];
    outCol.push(rgb[0], rgb[1], rgb[2]);
  }
  const key = matName || `mat${p.material ?? '-'}`;
  const prev = matReport.get(key) ?? { n: 0, sum: [0, 0, 0], tex: !!img };
  matReport.set(key, { n: prev.n + count, sum: [prev.sum[0] + acc[0], prev.sum[1] + acc[1], prev.sum[2] + acc[2]], tex: prev.tex || !!img });

  if (p.indices != null) {
    const idx = readAccessor(json, buffers, p.indices);
    for (let i = 0; i < idx.length; i++) outIdx.push(base + idx[i]);
  } else {
    for (let i = 0; i < count; i++) outIdx.push(base + i);
  }
}
if (outIdx.length === 0) throw new Error('everything was dropped');

// 3. orientation fixes, then normalise to the monument convention
const rotY = (deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  for (const arr of [outPos, outNrm]) {
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i];
      const z = arr[i + 2];
      arr[i] = c * x + s * z;
      arr[i + 2] = -s * x + c * z;
    }
  }
};
const rotX = (deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  for (const arr of [outPos, outNrm]) {
    for (let i = 0; i < arr.length; i += 3) {
      const y = arr[i + 1];
      const z = arr[i + 2];
      arr[i + 1] = c * y - s * z;
      arr[i + 2] = s * y + c * z;
    }
  }
};
if (args.pitch) rotX(args.pitch);
if (args.yaw) rotY(args.yaw);

const bbox = () => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outPos.length; i += 3)
    for (let c = 0; c < 3; c++) {
      if (outPos[i + c] < min[c]) min[c] = outPos[i + c];
      if (outPos[i + c] > max[c]) max[c] = outPos[i + c];
    }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
};

let bb = bbox();
log(`  source bbox size  x=${bb.size[0].toFixed(3)} y=${bb.size[1].toFixed(3)} z=${bb.size[2].toFixed(3)}`);

// optional baseplate cull: drop TRIANGLES entirely below a height fraction
let tris = [];
for (let i = 0; i < outIdx.length; i += 3) tris.push([outIdx[i], outIdx[i + 1], outIdx[i + 2]]);
if (args.dropBelow != null) {
  const cut = bb.min[1] + bb.size[1] * args.dropBelow;
  const before = tris.length;
  tris = tris.filter((t) => t.some((v) => outPos[v * 3 + 1] > cut));
  log(`  --drop-below ${args.dropBelow}: ${before} → ${tris.length} tris`);
}

// 4. compact (only referenced verts survive) + optional flat normals
const remap = new Map();
// `let`, not `const`: the weld below REPLACES these wholesale. It used to
// splice the welded arrays back in with `P.push(...P2)`, which passes every
// element as a call argument and dies with "Maximum call stack size exceeded"
// the moment a model is big enough to matter (measured: a 100k-vertex Eiffel).
let P = [];
let N = [];
let C = [];
let I = [];
const flat = args.flat;
for (const t of tris) {
  if (flat) {
    const [a, b, c] = t;
    const e1 = [outPos[b * 3] - outPos[a * 3], outPos[b * 3 + 1] - outPos[a * 3 + 1], outPos[b * 3 + 2] - outPos[a * 3 + 2]];
    const e2 = [outPos[c * 3] - outPos[a * 3], outPos[c * 3 + 1] - outPos[a * 3 + 1], outPos[c * 3 + 2] - outPos[a * 3 + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of t) {
      I.push(P.length / 3);
      P.push(outPos[v * 3], outPos[v * 3 + 1], outPos[v * 3 + 2]);
      N.push(n[0] / len, n[1] / len, n[2] / len);
      C.push(outCol[v * 3], outCol[v * 3 + 1], outCol[v * 3 + 2]);
    }
  } else {
    for (const v of t) {
      let ni = remap.get(v);
      if (ni === undefined) {
        ni = P.length / 3;
        remap.set(v, ni);
        P.push(outPos[v * 3], outPos[v * 3 + 1], outPos[v * 3 + 2]);
        N.push(outNrm[v * 3], outNrm[v * 3 + 1], outNrm[v * 3 + 2]);
        C.push(outCol[v * 3], outCol[v * 3 + 1], outCol[v * 3 + 2]);
      }
      I.push(ni);
    }
  }
}

// 4b. WELD on the exact (position, normal, colour) triple. Lossless by
// construction — two vertices only merge when every attribute the output GLB
// carries is identical, so the rendered result cannot change. It matters most
// for STL sources, which are wholly unindexed (a 3,160-triangle Space Needle
// arrives as 9,480 unique vertices and welds to ~1/3 of that).
if (!args.noWeld) {
  const key = new Map();
  const P2 = [];
  const N2 = [];
  const C2 = [];
  const I2 = [];
  const Q = 1e5;
  const qz = (v) => Math.round(v * Q);
  for (const vi of I) {
    const k = `${qz(P[vi * 3])},${qz(P[vi * 3 + 1])},${qz(P[vi * 3 + 2])},${qz(N[vi * 3])},${qz(N[vi * 3 + 1])},${qz(N[vi * 3 + 2])},${qz(C[vi * 3])},${qz(C[vi * 3 + 1])},${qz(C[vi * 3 + 2])}`;
    let ni = key.get(k);
    if (ni === undefined) {
      ni = P2.length / 3;
      key.set(k, ni);
      P2.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
      N2.push(N[vi * 3], N[vi * 3 + 1], N[vi * 3 + 2]);
      C2.push(C[vi * 3], C[vi * 3 + 1], C[vi * 3 + 2]);
    }
    I2.push(ni);
  }
  log(`  weld: ${P.length / 3} → ${P2.length / 3} verts`);
  P = P2;
  N = N2;
  C = C2;
  I = I2;
}

// 5. normalise: base plane at y = 0, footprint centre at the origin
{
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let c = 0; c < 3; c++) {
      if (P[i + c] < min[c]) min[c] = P[i + c];
      if (P[i + c] > max[c]) max[c] = P[i + c];
    }
  const dx = (min[0] + max[0]) / 2;
  const dz = (min[2] + max[2]) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= dx;
    P[i + 1] -= min[1];
    P[i + 2] -= dz;
  }
}

// 6. optional global tint
if (args.tint) {
  const t = hexToLinear(args.tint);
  for (let i = 0; i < C.length; i += 3) {
    C[i] *= t[0];
    C[i + 1] *= t[1];
    C[i + 2] *= t[2];
  }
}

// --- write ------------------------------------------------------------------

const vertCount = P.length / 3;
const pos32 = new Float32Array(P);
const nrm32 = new Float32Array(N);
const col8 = new Uint8Array(vertCount * 3);
for (let i = 0; i < col8.length; i++) col8[i] = Math.round(Math.min(1, Math.max(0, C[i])) * 255);
const use16 = vertCount <= 65535;
const idxArr = use16 ? new Uint16Array(I) : new Uint32Array(I);

const chunks = [];
let byteOffset = 0;
const push = (typedArray, align = 4) => {
  const pad = (align - (byteOffset % align)) % align;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteOffset += pad;
  }
  const start = byteOffset;
  const b = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  chunks.push(b);
  byteOffset += b.length;
  return { byteOffset: start, byteLength: b.length };
};
const bvPos = push(pos32);
const bvNrm = push(nrm32);
const bvCol = push(col8);
const bvIdx = push(idxArr);
const binPad = (4 - (byteOffset % 4)) % 4;
if (binPad) {
  chunks.push(Buffer.alloc(binPad));
  byteOffset += binPad;
}
const bin = Buffer.concat(chunks);

const minP = [Infinity, Infinity, Infinity];
const maxP = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < P.length; i += 3)
  for (let c = 0; c < 3; c++) {
    if (P[i + c] < minP[c]) minP[c] = P[i + c];
    if (P[i + c] > maxP[c]) maxP[c] = P[i + c];
  }

const name = path.basename(args.out, '.glb');
const gltf = {
  asset: { version: '2.0', generator: 'skyloom r20-monument-bake' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name }],
  meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
  materials: [
    {
      name: 'monument',
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: false,
    },
  ],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: bvPos.byteOffset, byteLength: bvPos.byteLength, target: 34962 },
    { buffer: 0, byteOffset: bvNrm.byteOffset, byteLength: bvNrm.byteLength, target: 34962 },
    { buffer: 0, byteOffset: bvCol.byteOffset, byteLength: bvCol.byteLength, target: 34962 },
    { buffer: 0, byteOffset: bvIdx.byteOffset, byteLength: bvIdx.byteLength, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vertCount, type: 'VEC3', min: minP, max: maxP },
    { bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3' },
    { bufferView: 2, componentType: 5121, count: vertCount, type: 'VEC3', normalized: true },
    { bufferView: 3, componentType: use16 ? 5123 : 5125, count: idxArr.length, type: 'SCALAR' },
  ],
};

const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(GLB_MAGIC, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
const jsonHdr = Buffer.alloc(8);
jsonHdr.writeUInt32LE(jsonChunk.length, 0);
jsonHdr.writeUInt32LE(CHUNK_JSON, 4);
const binHdr = Buffer.alloc(8);
binHdr.writeUInt32LE(bin.length, 0);
binHdr.writeUInt32LE(CHUNK_BIN, 4);

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, Buffer.concat([header, jsonHdr, jsonChunk, binHdr, bin]));

const size = [maxP[0] - minP[0], maxP[1] - minP[1], maxP[2] - minP[2]];
console.log(`\n${args.out}`);
console.log(`  verts ${vertCount}  tris ${idxArr.length / 3}  bytes ${fs.statSync(args.out).size} (${(fs.statSync(args.out).size / 1024).toFixed(1)} KB)`);
console.log(`  bbox  x=${size[0].toFixed(3)} y=${size[1].toFixed(3)} z=${size[2].toFixed(3)}  (aspect x/y ${(size[0] / size[1]).toFixed(3)}, z/y ${(size[2] / size[1]).toFixed(3)})`);
console.log(`  base y=${minP[1].toFixed(4)}  footprint centre [${((minP[0] + maxP[0]) / 2).toFixed(4)}, ${((minP[2] + maxP[2]) / 2).toFixed(4)}]`);
for (const [k, v] of matReport) {
  console.log(`  material "${k}": ${v.n} verts, mean albedo ${linearToHex([v.sum[0] / v.n, v.sum[1] / v.n, v.sum[2] / v.n])}${v.tex ? ' (from texture)' : ''}`);
}

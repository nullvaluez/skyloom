/** Reproducible, textureless landmark assets. Source Eiffel is supplied via --eiffel=path. */
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
registerHooks({
  resolve(s, c, n) {
    if (s.startsWith(".") || s.startsWith("file:")) {
      const u = new URL(s, c.parentURL);
      if (fs.existsSync(fileURLToPath(u) + ".js")) return n(u.href + ".js", c);
    }
    return n(s, c);
  },
});
const T = await import("three");
const { mergeGeometries } = await import(
  "three/examples/jsm/utils/BufferGeometryUtils.js"
);
const { MONUMENT_BUILDERS } = await import("../lib/fly/monument-builders.js");
const { attachCinematicModelAttributes } = await import(
  "../lib/fly/cinematic-models.js"
);
const outDir = "public/models";
const checkOnly = process.argv.includes("--check");
const records = [];
function readGlb(file) {
  const b = fs.readFileSync(file),
    l = b.readUInt32LE(12),
    j = JSON.parse(b.subarray(20, 20 + l).toString()),
    bin = b.subarray(28 + l);
  const p = j.meshes[0].primitives[0],
    g = new T.BufferGeometry();
  const attr = (id) => {
    const a = j.accessors[id],
      v = j.bufferViews[a.bufferView],
      k = {
        5121: Uint8Array,
        5123: Uint16Array,
        5125: Uint32Array,
        5126: Float32Array,
      }[a.componentType],
      size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
      start = (v.byteOffset || 0) + (a.byteOffset || 0),
      buf = bin.subarray(start, start + a.count * size * k.BYTES_PER_ELEMENT);
    return new T.BufferAttribute(
      new k(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      size,
      !!a.normalized,
    );
  };
  for (const [src, dest] of [
    ["POSITION", "position"],
    ["NORMAL", "normal"],
    ["COLOR_0", "color"],
  ])
    g.setAttribute(dest, attr(p.attributes[src]));
  g.setIndex(attr(p.indices));
  return g;
}
function color(g, hex) {
  const c = new T.Color(hex),
    n = g.attributes.position.count,
    a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new T.BufferAttribute(a, 3));
  return g;
}
function builder() {
  const parts = [];
  return {
    parts,
    box(x, y, z, w, h, d, c = "#b9b8af") {
      const g = color(new T.BoxGeometry(w, h, d), c);
      g.translate(x, y + h / 2, z);
      parts.push(g);
    },
    cone(x, y, z, rb, rt, h, segments, c = "#b9b8af") {
      const g = color(new T.CylinderGeometry(rt, rb, h, segments, 1), c);
      g.translate(x, y + h / 2, z);
      parts.push(g);
    },
    beam(a, b, r, c = "#c8c6bd") {
      const d = new T.Vector3(...b).sub(new T.Vector3(...a)),
        g = color(new T.CylinderGeometry(r, r, d.length(), 6), c);
      g.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          d.clone().normalize(),
        ),
      );
      g.translate(...a.map((v, i) => (v + b[i]) / 2));
      parts.push(g);
    },
    finish() {
      const g = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      return g;
    },
  };
}
function cn(detail) {
  const b = builder(),
    seg = detail ? 48 : 16;
  // Tapered concrete shaft, three splayed buttresses, main deck, radome and antenna.
  b.cone(0, 0, 0, 14, 5, 335, seg, "#b8b5a9");
  for (let a = 0; a < 3; a++) {
    const t = (a * Math.PI * 2) / 3;
    b.beam(
      [Math.cos(t) * 23, 0, Math.sin(t) * 23],
      [Math.cos(t) * 5, 330, Math.sin(t) * 5],
      detail ? 3 : 2.8,
    );
  }
  b.cone(0, 330, 0, 9, 20, 12, seg);
  b.cone(0, 342, 0, 20, 20, 13, seg, "#4b6570");
  b.cone(0, 355, 0, 20, 11, 13, seg, "#d0cec3");
  b.cone(0, 368, 0, 6, 3.2, 77, seg);
  b.cone(0, 445, 0, 8, 8, 8, seg, "#526975");
  b.cone(0, 453, 0, 8, 2.2, 9, seg);
  b.cone(0, 462, 0, 2.2, 0.7, 91, 12, "#c8c7bd");
  if (detail)
    for (let y = 343; y < 356; y += 3)
      b.cone(0, y, 0, 20.3, 20.3, 0.45, seg, "#bfc6c5");
  return b.finish();
}
function burj(detail) {
  const b = builder(),
    segments = detail === 2 ? 18 : detail ? 12 : 8;
  // Three wings retreat at staggered heights around the central core.
  b.cone(0, 0, 0, 22, 3, 690, segments, "#889eaa");
  for (let wing = 0; wing < 3; wing++) {
    const angle = (wing * Math.PI * 2) / 3,
      dx = Math.cos(angle),
      dz = Math.sin(angle);
    for (let step = 0; step < 9; step++) {
      const y = step * 68,
        h = 68,
        reach = 46 - step * 4.3,
        r = 14 - step * 0.95;
      b.cone(
        dx * reach,
        y,
        dz * reach,
        r,
        r,
        h,
        segments,
        step % 2 ? "#8298a5" : "#a6b5bc",
      );
      const g = color(new T.BoxGeometry(reach, h, r * 1.7), "#8fa6b2");
      g.rotateY(-angle);
      g.translate((dx * reach) / 2, y + h / 2, (dz * reach) / 2);
      b.parts.push(g);
      if (detail)
        for (let floor = 4; floor < h; floor += detail === 2 ? 5 : 10)
          b.cone(
            dx * reach,
            y + floor,
            dz * reach,
            r + 0.15,
            r + 0.15,
            0.35,
            segments,
            "#c0c8cb",
          );
    }
  }
  b.cone(0, 612, 0, 10, 4, 115, segments);
  b.cone(0, 727, 0, 4, 0.45, 101, 12, "#bec9ce");
  return b.finish();
}
function empire() {
  const b = builder();
  for (const [y, w, d, h] of [
    [0, 115, 65, 25],
    [25, 85, 55, 45],
    [70, 66, 45, 90],
    [160, 55, 38, 70],
    [230, 43, 31, 65],
    [295, 32, 26, 45],
    [340, 23, 20, 32],
  ]) {
    b.box(0, y, 0, w, h, d, "#b9b1a0");
    for (let x = -w / 2 + 3; x < w / 2; x += 5) {
      b.box(x, y, -d / 2 - 0.2, 0.8, h, 0.6, "#d2c8b4");
      b.box(x, y, d / 2 + 0.2, 0.8, h, 0.6, "#d2c8b4");
    }
    for (let z = -d / 2 + 3; z < d / 2; z += 5) {
      b.box(-w / 2 - 0.2, y, z, 0.6, h, 0.8, "#d2c8b4");
      b.box(w / 2 + 0.2, y, z, 0.6, h, 0.8, "#d2c8b4");
    }
    b.box(0, y + h - 0.8, 0, w + 1, 1, d + 1, "#d8cdb8");
  }
  b.cone(0, 372, 0, 10, 6, 32, 12, "#b6b7b1");
  b.cone(0, 404, 0, 3, 0.3, 39, 12, "#c3c9cc");
  return b.finish();
}
function willis() {
  const b = builder();
  // Nine square tubes stop in four tiers; two rooftop broadcast masts reach 527m.
  const heights = [
    [206, 270, 206],
    [355, 442, 442],
    [270, 355, 270],
  ];
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 3; z++) {
      const h = heights[x][z],
        cx = (x - 1) * 23,
        cz = (z - 1) * 23;
      b.box(cx, 0, cz, 23, h, 23, "#303d45");
      for (let o = -9; o <= 9; o += 3) {
        b.box(cx + o, 0, cz - 11.55, 0.45, h, 0.25, "#65747c");
        b.box(cx + o, 0, cz + 11.55, 0.45, h, 0.25, "#65747c");
        b.box(cx - 11.55, 0, cz + o, 0.25, h, 0.45, "#65747c");
        b.box(cx + 11.55, 0, cz + o, 0.25, h, 0.45, "#65747c");
      }
      b.box(cx, h - 0.6, cz, 23.3, 0.6, 23.3, "#8d969b");
    }
  for (const z of [0, 23]) {
    b.cone(0, 442, z, 1.8, 0.7, 68, 10, "#d6dde0");
    b.cone(0, 510, z, 0.7, 0.25, 17, 8, "#cdd5d8");
  }
  return b.finish();
}
function clean(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox,
    h = bb.max.y - bb.min.y;
  g.translate(
    -(bb.min.x + bb.max.x) / 2,
    -bb.min.y,
    -(bb.min.z + bb.max.z) / 2,
  );
  g.scale(1 / h, 1 / h, 1 / h);
  const p = g.attributes.position,
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    idx = [];
  for (let i = 0; i < g.index.count; i += 3) {
    const x = g.index.getX(i),
      y = g.index.getX(i + 1),
      z = g.index.getX(i + 2);
    a.fromBufferAttribute(p, x);
    b.fromBufferAttribute(p, y).sub(a);
    c.fromBufferAttribute(p, z).sub(a);
    if (b.cross(c).lengthSq() > 1e-22) idx.push(x, y, z);
  }
  g.setIndex(idx);
  g.computeBoundingBox();
  return g;
}
function write(g, id, poi, level, source) {
  clean(g);
  attachCinematicModelAttributes(g, { poi, accents: [] });
  const attrs = {
    POSITION: g.attributes.position,
    NORMAL: g.attributes.normal,
    COLOR_0: g.attributes.color,
    _MODEL_SURFACE: g.attributes.aModelSurface,
    _MODEL_LIGHT: g.attributes.aModelLight,
  };
  // Compact colors; custom lighting remains linear HDR float, surface two floats.
  const src = attrs.COLOR_0,
    bytes = new Uint8Array(src.count * 3);
  for (let i = 0; i < src.count; i++)
    for (let k = 0; k < 3; k++)
      bytes[i * 3 + k] = Math.round(
        Math.max(0, Math.min(1, src.getComponent(i, k))) * 255,
      );
  attrs.COLOR_0 = new T.BufferAttribute(bytes, 3, true);
  const chunks = [],
    views = [],
    accessors = [],
    mapping = {};
  let offset = 0;
  function add(a, target) {
    const raw = Buffer.from(
        a.array.buffer,
        a.array.byteOffset,
        a.array.byteLength,
      ),
      pad = Buffer.alloc((4 - (raw.length % 4)) % 4);
    const view = views.length;
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: raw.length,
      target,
    });
    chunks.push(raw, pad);
    offset += raw.length + pad.length;
    const count = accessors.length,
      acc = {
        bufferView: view,
        componentType:
          a.array instanceof Uint8Array
            ? 5121
            : a.array instanceof Uint16Array
              ? 5123
              : a.array instanceof Uint32Array
                ? 5125
                : 5126,
        count: a.count,
        type: ["", "SCALAR", "VEC2", "VEC3", "VEC4"][a.itemSize],
      };
    if (a.normalized) acc.normalized = true;
    accessors.push(acc);
    return count;
  }
  for (const [k, a] of Object.entries(attrs)) mapping[k] = add(a, 34962);
  accessors[0].min = g.boundingBox.min.toArray();
  accessors[0].max = g.boundingBox.max.toArray();
  const index = add(g.index, 34963);
  const doc = {
    asset: {
      version: "2.0",
      generator: "Skyloom landmark details v1",
      extras: { source, poi, level },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      { primitives: [{ attributes: mapping, indices: index, material: 0 }] },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const js = Buffer.from(JSON.stringify(doc)),
    json = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 32)]),
    bin = Buffer.concat(chunks),
    head = Buffer.alloc(20),
    bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(28 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  const data = Buffer.concat([head, json, bh, bin]),
    file = `monument-${id}-v1.glb`;
  if (checkOnly) {
    if (!fs.readFileSync(path.join(outDir, file)).equals(data))
      throw Error(file + " is not deterministic");
  } else fs.writeFileSync(path.join(outDir, file), data);
  records.push({
    poi,
    level,
    file: "/models/" + file,
    triangles: g.index.count / 3,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    source,
  });
  g.dispose();
}
const eiffelArg = process.argv.find((s) => s.startsWith("--eiffel="))?.slice(9);
if (!eiffelArg)
  throw Error(
    "Pass --eiffel=<offline baked source> to preserve the complete inventory",
  );
if (eiffelArg) {
  const g = readGlb(eiffelArg);
  g.computeBoundingBox();
  const sz = g.boundingBox.getSize(new T.Vector3());
  g.scale(125 / 330 / (sz.x / sz.y), 1, 125 / 330 / (sz.z / sz.y));
  write(
    g,
    "eiffel-detail",
    "Eiffel Tower",
    "high",
    "Scott Marshall / CC-BY 3.0 / https://poly.pizza/m/aIpJchqtRTg",
  );
}
write(
  MONUMENT_BUILDERS.eiffel(true),
  "eiffel-medium",
  "Eiffel Tower",
  "medium",
  "Skyloom first-party / MIT",
);
write(
  empire(),
  "empire-state-detail",
  "Empire State Building",
  "high",
  "Skyloom first-party / MIT",
);
write(
  willis(),
  "willis-detail",
  "Willis Tower",
  "high",
  "Skyloom first-party / MIT",
);
for (const [name, build, id] of [
  ["CN Tower", cn, "cn-tower"],
  ["Burj Khalifa", burj, "burj-khalifa"],
])
  for (const level of ["far", "medium", "high"])
    write(
      build(level === "high" ? 2 : level === "medium" ? 1 : 0),
      id + "-" + level,
      name,
      level,
      "Skyloom first-party / MIT",
    );
if (!checkOnly)
  fs.writeFileSync(
    "lib/fly/monument-detail-assets.json",
    JSON.stringify(records, null, 2) + "\n",
  );
console.log(
  checkOnly
    ? `DETERMINISTIC: ${records.length} GLBs byte-identical`
    : JSON.stringify(records, null, 2),
);

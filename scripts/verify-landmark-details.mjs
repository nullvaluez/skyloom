import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(s, c, n) {
    if (s.startsWith("@/"))
      s = new URL("../" + s.slice(2), import.meta.url).href;
    if (s.startsWith(".") || s.startsWith("file:")) {
      const u = new URL(s, c.parentURL);
      if (fs.existsSync(fileURLToPath(u) + ".js")) return n(u.href + ".js", c);
    }
    return n(s, c);
  },
});
const {
  MONUMENT_DETAIL: C,
  MonumentDetailCache,
  selectMonumentDetails,
  landmarkDistanceM,
} = await import("../lib/fly/monument-detail.js");
const { MONUMENT_MANIFEST } = await import("../lib/fly/monument-models.js");
const { FLY_ASSETS } = await import("../lib/fly/assets.js");
const records = JSON.parse(
  fs.readFileSync("lib/fly/monument-detail-assets.json"),
);
let count = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS " + name);
  count++;
}
await test("twelve POIs, no duplicates, new exclusions bounded", () => {
  assert.equal(MONUMENT_MANIFEST.length, 12);
  assert.equal(new Set(MONUMENT_MANIFEST.map((e) => e.poi)).size, 12);
  for (const e of MONUMENT_MANIFEST)
    assert.ok(e.exclusionM > 0 && e.exclusionM <= 190);
});
for (const r of records)
  await test(r.poi + " " + r.level + " geometry / budget / provenance", () => {
    const data = fs.readFileSync("public" + r.file),
      jl = data.readUInt32LE(12),
      j = JSON.parse(data.subarray(20, 20 + jl)),
      bin = data.subarray(28 + jl),
      p = j.meshes[0].primitives[0];
    assert.equal(data.length, r.bytes);
    assert.equal(createHash("sha256").update(data).digest("hex"), r.sha256);
    assert.equal(j.accessors[p.indices].count / 3, r.triangles);
    const budget = C[r.level] ?? { bytes: 1048576, triangles: 20000 };
    assert.ok(r.bytes <= budget.bytes);
    assert.ok(r.triangles <= budget.triangles);
    assert.equal(j.images?.length ?? 0, 0);
    assert.equal(j.extensionsRequired?.length ?? 0, 0);
    for (const attr of [
      "POSITION",
      "NORMAL",
      "COLOR_0",
      "_MODEL_LIGHT",
      "_MODEL_SURFACE",
    ])
      assert.ok(p.attributes[attr] != null);
    const acc = j.accessors[p.attributes.POSITION],
      v = j.bufferViews[acc.bufferView],
      values = new Float32Array(
        bin.buffer.slice(
          bin.byteOffset + v.byteOffset,
          bin.byteOffset + v.byteOffset + v.byteLength,
        ),
      );
    assert.ok([...values].every(Number.isFinite));
    assert.ok(Math.abs(acc.min[1]) < 1e-6);
    assert.ok(Math.abs(acc.max[1] - 1) < 1e-6);
    const normal = j.accessors[p.attributes.NORMAL],
      nv = j.bufferViews[normal.bufferView],
      norms = new Float32Array(
        bin.buffer.slice(
          bin.byteOffset + nv.byteOffset,
          bin.byteOffset + nv.byteOffset + nv.byteLength,
        ),
      );
    assert.ok([...norms].every(Number.isFinite));
    for (let i = 0; i < norms.length; i += 3)
      assert.ok(
        Math.abs(Math.hypot(norms[i], norms[i + 1], norms[i + 2]) - 1) < 0.01,
      );
    const ia = j.accessors[p.indices],
      iv = j.bufferViews[ia.bufferView],
      K = ia.componentType === 5123 ? Uint16Array : Uint32Array,
      idx = new K(
        bin.buffer.slice(
          bin.byteOffset + iv.byteOffset,
          bin.byteOffset + iv.byteOffset + iv.byteLength,
        ),
      );
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3,
        b = idx[i + 1] * 3,
        c = idx[i + 2] * 3;
      assert.ok(
        c + 2 < values.length && b + 2 < values.length && a + 2 < values.length,
      );
      const u = [0, 1, 2].map((k) => values[b + k] - values[a + k]),
        w = [0, 1, 2].map((k) => values[c + k] - values[a + k]);
      assert.ok(
        Math.hypot(
          u[1] * w[2] - u[2] * w[1],
          u[2] * w[0] - u[0] * w[2],
          u[0] * w[1] - u[1] * w[0],
        ) > 1e-11,
      );
    }
    const credit = FLY_ASSETS.find((a) => a.file === "public" + r.file);
    assert.ok(credit?.author);
    assert.ok(["MIT", "CC-BY 3.0"].includes(credit.license));
    assert.ok(fs.readFileSync("CREDITS.md", "utf8").includes(credit.url));
  });
const candidate = (name, d) => ({
  name,
  distanceM: d,
  entry: {
    poi: name,
    detail: { high: { file: name }, medium: { file: name } },
  },
});
await test("true metre distance includes latitude and altitude", () => {
  assert.ok(
    Math.abs(
      landmarkDistanceM(
        { wx: 0, wz: 0, lat: 60, groundY: 0 },
        { x: 2000, z: 0, y: 0 },
      ) - 1000,
    ) < 1e-6,
  );
  assert.equal(
    landmarkDistanceM(
      { wx: 0, wz: 0, lat: 0, groundY: 0 },
      { x: 0, z: 0, y: 2600 },
    ),
    2600,
  );
});
await test("entry/exit hysteresis, two slots, tier changes", () => {
  let s = selectMonumentDetails(
    [candidate("a", 1999), candidate("b", 1900), candidate("c", 1800)],
    new Map(),
    "high",
  );
  assert.equal(s.size, 2);
  assert.equal(s.has("a"), false);
  s = selectMonumentDetails(
    [candidate("b", 2499), candidate("c", 1800), candidate("a", 100)],
    s,
    "medium",
  );
  assert.equal(s.get("b"), "medium");
  assert.equal(s.has("a"), false);
  assert.equal(
    selectMonumentDetails([candidate("b", 2501)], s, "high").size,
    0,
  );
  assert.equal(selectMonumentDetails([candidate("c", 100)], s, "low").size, 0);
});
const flush = () => new Promise((r) => setTimeout(r, 0));
await test("bounded downloads, LRU, rapid warps, and late disposal", async () => {
  const pending = [],
    disposed = [];
  const cache = new MonumentDetailCache(
    (e, l) =>
      new Promise((resolve) =>
        pending.push({
          name: e.poi,
          resolve: () =>
            resolve({ dispose: () => disposed.push(e.poi), level: l }),
        }),
      ),
  );
  cache.request(
    ["a", "b", "c", "d", "e"].map((n, i) => candidate(n, 100 + i)),
    "high",
  );
  await flush();
  assert.equal(cache.active, 2);
  assert.equal(pending.length, 2);
  cache.request([candidate("z", 100)], "high");
  pending.splice(0).forEach((p) => p.resolve());
  await flush();
  assert.equal(disposed.length, 2);
  assert.equal(pending.length, 1);
  cache.dispose();
  pending[0].resolve();
  await flush();
  assert.equal(cache.items.size, 0);
  assert.ok(disposed.includes("z"));
});
await test("four cached landmarks and retry backoff", async () => {
  let attempts = 0,
    time = 0;
  const cache = new MonumentDetailCache(
    async (e) => {
      attempts++;
      if (e.poi === "bad") throw Error("404");
      return { dispose() {} };
    },
    () => time,
  );
  for (let i = 0; i < 6; i++) {
    cache.request([candidate("m" + i, 10)], "high");
    await flush();
  }
  assert.equal(cache.items.size, 4);
  cache.request([candidate("bad", 10)], "high");
  await flush();
  const n = attempts;
  cache.request([candidate("bad", 10)], "high");
  await flush();
  assert.equal(attempts, n);
  time = C.retryMs + 1;
  cache.request([candidate("bad", 10)], "high");
  await flush();
  assert.equal(attempts, n + 1);
  cache.dispose();
});
await test("shared loader limits outstanding requests across style lifetimes", async () => {
  const { GLTFLoader } = await import("three-stdlib");
  const { Scene, Mesh, BoxGeometry, MeshBasicMaterial } = await import("three");
  const { loadOne } = await import("../lib/fly/monument-loader.js");
  const old = GLTFLoader.prototype.loadAsync,
    pending = [];
  let active = 0,
    peak = 0;
  GLTFLoader.prototype.loadAsync = function () {
    active++;
    peak = Math.max(peak, active);
    return new Promise((resolve) =>
      pending.push(() => {
        active--;
        const scene = new Scene();
        scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
        resolve({ scene });
      }),
    );
  };
  try {
    const all = Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        loadOne({ file: "fake-" + i, accents: [] }, i % 2 ? "sat" : "toy"),
      ),
    );
    await flush();
    assert.equal(pending.length, 2);
    for (let i = 0; i < 3; i++) {
      pending.splice(0).forEach((done) => done());
      await flush();
    }
    const geometries = await all;
    assert.equal(peak, 2);
    assert.equal(geometries.length, 6);
    geometries.forEach((g) => g.dispose());
  } finally {
    GLTFLoader.prototype.loadAsync = old;
  }
});
console.log(`VERIFY: PASS (${count})`);

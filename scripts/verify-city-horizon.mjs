import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const off = process.argv.includes('--off');
globalThis.window = { location: { search: '' }, __flyCityHorizonOverride: { enabled: !off }, __flyBuildingRealismOverride: { enabled: false } };
const workerURL = new URL('../lib/fly/toy-world/vector-tile.worker.js', import.meta.url).href;
const baselineWorkerSource = execFileSync('git', ['show', 'HEAD:lib/fly/toy-world/vector-tile.worker.js'], { encoding: 'utf8', maxBuffer: 2e6 });
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: 'file:///city-horizon-comlink.mjs', shortCircuit: true };
    if (spec.startsWith('@/')) spec = new URL('../' + spec.slice(2), import.meta.url).href;
    if (spec.startsWith('.') || spec.startsWith('file:')) {
      const u = new URL(spec, ctx.parentURL);
      if (fs.existsSync(fileURLToPath(u) + '.js')) return next(spec + '.js', ctx);
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === 'file:///city-horizon-comlink.mjs') return { format: 'module', shortCircuit: true, source: 'export const expose=x=>{globalThis.__horizonWorker=x}; export const transfer=x=>x;' };
    if (url === workerURL + '?baseline') return { format: 'module', shortCircuit: true, source: baselineWorkerSource };
    return next(url, ctx);
  },
});
const H = await import('../lib/fly/city-horizon.js');
const { SatSkylineEngine } = await import('../lib/fly/toy-world/sat-skyline-engine.js');
const { ShaderLib, UniformsUtils } = await import('three');
const request = { visuals: true };
if (off) {
  assert.equal(H.cityHorizonFor('high'), null);
  assert.equal(H.cityHorizonRequest(request, null), request);
  const e = new SatSkylineEngine({ groundAt: () => null });
  e.setMaxChunks(10); e.setHorizonTier('high');
  assert.equal(e.maxChunks, 10);
  const s = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  e.material.onBeforeCompile(s, {});
  assert.ok(!s.fragmentShader.includes('uCityHorizonBand'));
  assert.ok(!e.material.customProgramCacheKey().includes('city-horizon'));
  e.dispose();
  console.log('PASS flag off: request identity, original ring budget, original shader/cache key');
  process.exit(0);
}
execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--off'], { stdio: 'inherit' });

const world = 2 * Math.PI * 6378137;
const x = -73.984 / 360 * world;
const z = -6378137 * Math.log(Math.tan(Math.PI / 4 + 40.7549 * Math.PI / 360));
const e = new SatSkylineEngine({ groundAt: () => ({ tileZ: 14, elev: 0 }) });
e.setHorizonTier('high');
e.update(0, x, z, 600);
e._refreshDesired(x, z, 600, 0);
assert.equal(e.queue.length, 24);
assert.ok(e._horizonBand.end / H.horizonMercatorK(z) > 14000);
assert.ok(e._horizonBand.start < e._horizonBand.end);
const band = e._horizonBand;
// All 360 degrees under the full-density fade start lie in planned groups.
const span = world / 16384 * 4, half = world / 2;
const keys = new Set(e.queue.map((g) => `${g.gx}/${g.gy}`));
for (let a = 0; a < 360; a++) {
  const px = x + Math.cos(a * Math.PI / 180) * band.start;
  const pz = z + Math.sin(a * Math.PI / 180) * band.start;
  assert.ok(keys.has(`${Math.floor((px + half) / span)}/${Math.floor((pz + half) / span)}`), `coverage at ${a} degrees`);
}
console.log(`PASS 360° NYC coverage: fade ${(band.start / H.horizonMercatorK(z) / 1000).toFixed(1)}–${(band.end / H.horizonMercatorK(z) / 1000).toFixed(1)} km true, 24 draws maximum`);
const requests = [], resolves = [];
e.setWorker({ buildTile(...args) { requests.push(args); return new Promise((resolve) => resolves.push(resolve)); } });
e._pumpQueue(); e._pumpQueue();
assert.equal(requests.length, 8); assert.equal(e.building, 8);
assert.ok(requests.every((r) => r[4].cityHorizon.maxTriangles === 1536));
for (const resolve of resolves.splice(0)) resolve({ empty: true });
await Promise.resolve(); await Promise.resolve();
e._pumpQueue(); assert.equal(e.building, 8);
e.notifyWarp(1); e._refreshDesired(x + world / 3, z, 600, 1);
assert.ok(e.chunks.size <= 24);
for (const resolve of resolves.splice(0)) resolve({ empty: true });
await Promise.resolve(); await Promise.resolve();
e._pumpQueue(); assert.ok(e.building <= 8);
console.log('PASS tile request concurrency bounded; options propagated; warp rejects cancelled queued work');
e.dispose();

const shaderEngine = new SatSkylineEngine({ groundAt: () => null });
const sh = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
shaderEngine.material.onBeforeCompile(sh, {});
assert.ok(sh.fragmentShader.includes('smoothstep(uCityHorizonBand.x,uCityHorizonBand.y,vSkyDist)'));
assert.ok(sh.fragmentShader.includes('uArchitectureNearFade * vArchitectureCovered'));
assert.ok(!sh.fragmentShader.includes('if ( uSkyHole.x > 0.0 ) skyA *='));
for (let i = 0; i < 16; i++) for (const birth of [0, .2, .6, 1]) {
  const bayer = (i + .5) / 16;
  assert.equal(Number(bayer < birth) + Number(bayer >= birth), 1);
}
shaderEngine.dispose();
console.log('PASS far radial dissolve composes with complementary resident-detail masks');

const { default: vtpbf } = await import('vt-pbf');
const { mvtTile } = await import('./r24-fixture/mvt.mjs');
const synthetic = new Map();
function tileFeatures(count, height, holes = false) {
  return Array.from({ length: count }, (_, i) => {
    const x = 100 + (i % 12) * 300, y = 100 + Math.floor(i / 12) * 300;
    const geometry = [[[x, y], [x + 40, y], [x + 40, y + 40], [x, y + 40], [x, y]]];
    if (holes) geometry.push([[x + 10, y + 10], [x + 10, y + 30], [x + 30, y + 30], [x + 30, y + 10], [x + 10, y + 10]]);
    return { id: i + 1, type: 3, geometry, tags: { render_height: height, ...(height !== 5 ? { height } : {}) } };
  });
}
function put(y, features) { synthetic.set(`14/8192/${y}`, Buffer.from(vtpbf.fromGeojsonVt({ building: { features } }, { version: 2, extent: 4096 }))); }
put(8192, tileFeatures(96, 12)); put(8193, tileFeatures(8, 12)); put(8194, tileFeatures(96, 5));
put(8195, tileFeatures(96, 12, true));
put(8196, tileFeatures(96, 26));
globalThis.fetch = async (url) => {
  const m = String(url).match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  if (!m) return Response.json({ tiles: ['https://fixture.test/{z}/{x}/{y}.pbf'] });
  const key = m.slice(1).join('/');
  return new Response(synthetic.get(key) ?? mvtTile(...m.slice(1).map(Number)));
};
await import(workerURL + '?baseline'); const baseline = globalThis.__horizonWorker;
await import(workerURL); const worker = globalThis.__horizonWorker;
const protocolOf = (source) => {
  const match = source.match(/const WORKER_PROTOCOL\s*=\s*(\d+)/);
  assert.ok(match, 'Worker source declares its transport protocol');
  return Number(match[1]);
};
const baselineProtocol = protocolOf(baselineWorkerSource);
const currentProtocol = protocolOf(fs.readFileSync(new URL(workerURL), 'utf8'));
const hash = (r) => {
  // Protocol 24 adds explicit premium policy inputs. Compare transport
  // identity separately from the unchanged flag-off geometry payload; retain
  // every nested field, even if a future payload happens to name one "v".
  const payload = { ...r };
  delete payload.v;
  delete payload.tessMs;
  // Surface repair now supplies worker normals and repair telemetry. Those
  // additive fields have independent geometry tests; keep comparing EVERY
  // pre-existing geometry/attribute field against the pre-horizon payload.
  if (payload.satSkyline) {
    payload.satSkyline = { ...payload.satSkyline };
    delete payload.satSkyline.normal;
    delete payload.satSkyline.wallRepair;
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload, (k, v) => ArrayBuffer.isView(v) ? [...v] : v)).digest('hex');
};
const parityTiles = [[14, 4413, 6194], [14, 2817, 6402], [14, 8192, 8192]];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) parityTiles.push([14, 4824 + dx, 6157 + dy]);
for (const tile of parityTiles) {
  const opts = { visuals: true, cityRange: { denseMinH: 20, denseTallCount: 40 } };
  const actual = await worker.buildTile(...tile, 'sat-skyline', opts);
  const prior = await baseline.buildTile(...tile, 'sat-skyline', opts);
  assert.equal(actual.v, currentProtocol, 'Current result carries the current source protocol');
  assert.equal(prior.v, baselineProtocol, 'Baseline result carries its own source protocol');
  assert.equal(hash(actual), hash(prior));
}
console.log(`PASS flag-off real worker geometry matches HEAD; protocols ${baselineProtocol} -> ${currentProtocol} verified separately on city/suburb/desert/synthetic tiles`);
for (const tier of ['high', 'medium', 'low']) {
  const options = H.cityHorizonRequest({ visuals: true }, H.cityHorizonFor(tier));
  const r = await worker.buildTile(14, 8192, 8192, 'sat-skyline', options);
  assert.ok(r.horizonMeta.mappedLowrise > 0);
  assert.ok(r.satSkyline.idx.length / 3 <= options.cityHorizon.maxTriangles);
  assert.ok([...r.satSkyline.pos].filter((_, i) => i % 3 === 1).every((h) => h === 12 || h < 0));
  const sparse = await worker.buildTile(14, 8192, 8193, 'sat-skyline', options);
  const untagged = await worker.buildTile(14, 8192, 8194, 'sat-skyline', options);
  assert.equal(sparse.empty, true); assert.equal(untagged.empty, true);
  // CITY_RANGE holds 20–35m buildings in denseExtra. Without any >=35m
  // towers this cohort still forms a real neighborhood for CITY_HORIZON.
  const midrise = await worker.buildTile(14, 8192, 8196, 'sat-skyline', { ...options, cityRange: { denseMinH: 20, denseTallCount: 40 } });
  assert.equal(midrise.empty, false);
  assert.ok(midrise.horizonMeta.mappedLowrise > 0);
  assert.ok(midrise.satSkyline.idx.length / 3 <= options.cityHorizon.maxTriangles);
  assert.ok([...midrise.satSkyline.pos].filter((_, i) => i % 3 === 1).every((h) => h === 26 || h < 0));
  console.log(`PASS ${tier}: mapped 12m and isolated 26m neighborhoods; ${r.horizonMeta.emitted} lowrise bodies / ${r.satSkyline.idx.length / 3} triangles; sparse and synthetic-height tiles remain empty`);
}
const court = await worker.buildTile(14, 8192, 8195, 'sat-skyline', H.cityHorizonRequest({ visuals: true }, H.cityHorizonFor('high')));
assert.ok(court.satSkyline.idx.length / 3 <= 1536);
// For each roof triangle, its centroid must avoid that source's inner court.
const p = court.satSkyline.pos, idx = court.satSkyline.idx, unit = world / 16384 / 4096;
for (let i = 0; i < idx.length; i += 3) {
  const ids = [idx[i], idx[i + 1], idx[i + 2]];
  if (!ids.every((v) => p[v * 3 + 1] === 12)) continue;
  const tx = ids.reduce((s, v) => s + p[v * 3], 0) / 3 / unit + 2048;
  const ty = ids.reduce((s, v) => s + p[v * 3 + 2], 0) / 3 / unit + 2048;
  const lx = (tx - 100 + 300) % 300, ly = (ty - 100 + 300) % 300;
  assert.ok(!(lx > 10.01 && lx < 29.99 && ly > 10.01 && ly < 29.99));
}
console.log('PASS coarse mass preserves mapped courtyard voids and hard triangle budget');

// Real engine, deterministic delayed tile completions, no renderer/GPU. The
// unrendered triangle-cap fixture isolates lifecycle and residency guarantees
// from geographic density (the worker's geographic checks run above).
const C = await import('../lib/fly/fly-constants.js');
const { noteFinalizeFrame } = await import('../lib/fly/finalize-pace.js');
const sim = new SatSkylineEngine({ groundAt: () => ({ tileZ: 14, elev: 0 }) });
const tileBundles = new Map(), flights = [];
let frame = 0, t = 0, sx = x, sz = z, peakChildren = 0, peakConcurrent = 0, coverageMisses = 0, worstFadeStep = 0;
function capacityTile(triangles) {
  if (!tileBundles.has(triangles)) {
    const idx = new Uint16Array(triangles * 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i % 3;
    tileBundles.set(triangles, { empty: false, satSkyline: {
      pos: new Float32Array([-10, 12, -10, 10, 12, -10, 0, 12, 10]),
      col: new Float32Array(9).fill(.25), anchor: new Float32Array(6),
      style: new Uint8Array([3, 2, 0, 3, 2, 0, 3, 2, 0]), uv: new Float32Array(6), idx,
    } });
  }
  return tileBundles.get(triangles);
}
sim.setWorker({ buildTile(...args) { return new Promise((resolve) => flights.push({ due: frame + 3, resolve, budget: args[4].cityHorizon.maxTriangles })); } });
// Reproduce the layer's actual legacy-first effect order.
function setTier(tier) {
  sim.setMaxChunks({ high: 10, medium: 6, low: 3 }[tier]);
  sim.setHorizonTier(tier);
}
function covered(px, pz) {
  const key = `14/${Math.floor((px + half) / span)}/${Math.floor((pz + half) / span)}`;
  return !!sim.chunks.get(key)?.mesh;
}
async function step(check = true) {
  frame++; t += 1 / 60;
  for (let i = flights.length - 1; i >= 0; i--) if (flights[i].due <= frame) {
    const pending = flights.splice(i, 1)[0];
    pending.resolve(capacityTile(pending.budget));
  }
  await Promise.resolve(); await Promise.resolve();
  noteFinalizeFrame(1 / 60);
  const before = sim._horizonLiveEnd;
  sim.update(t, sx, sz, 600);
  if (Number.isFinite(before)) worstFadeStep = Math.max(worstFadeStep, Math.abs(sim._horizonLiveEnd - before) / H.horizonMercatorK(sz));
  peakChildren = Math.max(peakChildren, sim.object.children.length);
  peakConcurrent = Math.max(peakConcurrent, sim.building);
  assert.ok(sim.chunks.size <= sim.maxChunks);
  assert.ok(sim.object.children.length <= sim.maxChunks + C.CHUNK_FADE.maxDying);
  if (check && Number.isFinite(sim._horizonLiveEnd)) {
    for (const fraction of [.25, .5, .75, .98]) for (let a = 0; a < 360; a += 5) {
      const distance = sim._horizonLiveEnd * fraction;
      if (!covered(sx + Math.cos(a * Math.PI / 180) * distance, sz + Math.sin(a * Math.PI / 180) * distance)) coverageMisses++;
    }
  }
}
async function settle() {
  for (let i = 0; i < 1500; i++) {
    await step(false);
    if (sim.stats.ready === sim.maxChunks && !sim.queue.length && !sim.building && !sim.pendingFinalize.length && !sim._births.length && !sim._dying.length) return;
  }
  assert.fail(`engine did not settle: ${JSON.stringify(sim.stats)}`);
}
setTier('high'); await settle();
assert.equal(sim.stats.tris, 24 * 16 * 1536);
const restingKeys = [...sim.chunks.keys()].sort().join();
// A full turn changes the velocity/lookahead vectors without translating.
for (let a = 0; a < 360; a += 5) {
  sim._vx = Math.cos(a * Math.PI / 180) * 500;
  sim._vz = Math.sin(a * Math.PI / 180) * 500;
  sim._refreshDesired(sx, sz, 600, t);
  await step();
  assert.equal([...sim.chunks.keys()].sort().join(), restingKeys);
}
// 20 seconds at 250 true m/s, then reverse across the same group boundaries.
for (let i = 0; i < 2400; i++) {
  sx += (i < 1200 ? 1 : -1) * 250 / 60 * H.horizonMercatorK(sz);
  await step();
}
assert.equal(coverageMisses, 0, 'settled/moving skyline has a missing group inside its live radial mask');
console.log(`PASS deterministic 360° turn + 10km return flight: zero coverage gaps; peak ${peakConcurrent} requests / ${peakChildren} meshes incl. fades`);
await settle();
// RED calibration: reproduce the former immediate-cap contraction while
// retaining its slow radial damping. The same coverage instrument must fail.
setTier('low');
sim._horizonContraction = null;
sim._horizonAppliedCap = 5;
sim.setMaxChunks(5);
for (let i = 0; i < 24; i++) await step();
assert.ok(coverageMisses > 0, 'coverage instrument must detect the old immediate-eviction defect');
console.log(`PASS RED calibration: former contraction produces ${coverageMisses} uncovered angular samples`);
coverageMisses = 0;
setTier('high'); await settle();
setTier('low');
assert.equal(sim.maxChunks, 24, 'legacy-first layer call must preserve original cap while mask contracts');
assert.equal(sim._horizon.concurrent, 4);
const contractionStart = t, initialEnd = sim._horizonLiveEnd;
let previousEnd = initialEnd;
for (let i = 0; i < 90; i++) {
  await step();
  assert.ok(sim._horizonLiveEnd <= previousEnd + 1e-6);
  previousEnd = sim._horizonLiveEnd;
}
assert.equal(coverageMisses, 0, 'tier contraction exposed rectangular holes');
assert.equal(sim.maxChunks, 5);
assert.equal(sim.stats.ready, 5);
assert.equal(sim.stats.tris, 5 * 16 * 1536, 'retained high-detail groups must be counted honestly');
assert.equal(sim._dying.length, 0);
assert.ok(!sim._horizonContraction && t - contractionStart >= .8);
console.log(`PASS High→Low contraction: 24→5 groups, no coverage gap; retained ${sim.stats.tris} triangles; no outgoing fades after1.5s`);
setTier('high'); await settle(); setTier('medium');
await step(); assert.ok(sim._horizonContraction);
sim.notifyWarp(t); sx += world / 4;
assert.equal(sim._horizonContraction, null);
assert.equal(sim.maxChunks, 10);
await step(false);
assert.ok(sim._horizonLiveEnd <= sim._horizonBand.end + 1e-6);
assert.ok(sim._tileQueue.every((q) => sim.chunks.get(q.key)?.gen === q.gen));
sim.dispose();
assert.equal(sim.object.children.length, 0);
console.log(`PASS warp cancels contraction and stale queued generations; disposal drains every mesh (largest smooth per-frame fade movement ${worstFadeStep.toFixed(1)} true m)`);

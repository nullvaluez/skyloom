/**
 * World Pass C (REACH) — node bench and gate for the stand-in builder.
 *
 * Runs the REAL vector-tile worker in-process (the world-pass-worker-proof
 * hooks) on the RECORDED inputs in .graphics-review/world-pass/w0/proof-inputs
 * (never fetches) and builds every recorded z14 tile twice in 'sat-skyline':
 * the shipped Enhanced High horizon request, and the same request with
 * worldPass.reach on. Prints per tile: the old horizon's emitted bodies and
 * triangles, the stand-ins emitted, the reach stage counters and build ms.
 *
 * Gates (exit 1 on failure):
 *   G1 Owens and iowa-farm tiles emit no stand-in (empty stays empty)
 *   G2 midtown / paris / tokyo / lagos centre tiles emit >= 5x the old bodies
 *   G3 the size key is non-increasing in every bundle (the CPU prefix contract)
 *   G4 every record is finite, half extents > 0, height > 0
 *   G5 a request with reach on but standIns false builds the shipped bytes
 *
 *   node scripts/wp-reach-node-bench.mjs [--only <substr>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUTS = path.join(ROOT, '.graphics-review/world-pass/w0/proof-inputs');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

const COMLINK = 'file:///wp-reach-comlink-stub.mjs';
const probe = (base) => {
  for (const ext of ['', '.js', '.mjs', '/index.js']) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
  }
  return null;
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK, shortCircuit: true };
    if (spec.startsWith('@/')) {
      const u = probe(path.join(ROOT, spec.slice(2)));
      if (u) return { url: u, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(spec, ctx.parentURL));
      if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
        const u = probe(base);
        if (u) return { url: u, shortCircuit: true };
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK)
      return { format: 'module', shortCircuit: true, source: 'export const expose=(a)=>{globalThis.__wpReachApi=a;}; export const transfer=(v)=>v;' };
    return next(url, ctx);
  },
});

const index = JSON.parse(fs.readFileSync(path.join(INPUTS, 'index.json'), 'utf8'));
globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input);
  const rec = index[url];
  if (!rec) throw new Error(`not recorded: ${url}`);
  const body = fs.readFileSync(path.join(INPUTS, rec.file));
  const nullBody = rec.status === 204 || rec.status === 304;
  return new Response(nullBody ? null : body, { status: rec.status, headers: rec.type ? { 'content-type': rec.type } : {} });
};

const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
};
const PLACES = [
  ['midtown', 40.7549, -73.984, [[1, 0], [0, 1]]],
  ['lower-manhattan', 40.708, -74.011, []],
  ['brooklyn', 40.678, -73.944, []],
  ['paris', 48.8566, 2.3522, [[1, 0]]],
  ['tokyo', 35.6812, 139.7671, []],
  ['lagos', 6.455, 3.394, []],
  ['phoenix-suburb', 33.38, -111.84, []],
  ['dubai', 25.197, 55.274, []],
  ['powell-oh', 40.158, -83.075, [[1, 0]]],
  ['owens', 36.6, -118.1, [[2, 0], [3, 0]]],
  ['iowa-farm', 42.0, -93.5, []],
  ['hong-kong', 22.282, 114.158, []],
  ['san-francisco', 37.7937, -122.3965, []],
  ['jfk', 40.6413, -73.7781, []],
];
const RUNWAY = { airportLandmarks: false, operationsAirports: [] };
const ENH = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
const HIGH = { ...ENH, cityRange: { denseMinH: 20, denseTallCount: 40 }, cityHorizon: { maxTriangles: 1536, maxBodies: 192, minMappedHeight: 6, minMappedCount: 24 }, ...RUNWAY };
const wpReq = (standIns) => {
  const streams = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
  const req = { v: 1, key: 'wp1-ultra-test', any: true, tier: 'ultra' };
  for (const [s, subs] of Object.entries(streams)) req[s] = { on: false, ...Object.fromEntries(subs.map((k) => [k, false])), worker: null };
  req.reach = { on: true, standIns, worker: {} };
  return req;
};

await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
const api = globalThis.__wpReachApi;

if (argv.includes('--continuity')) {
  const { default: assert } = await import('node:assert/strict');
  globalThis.window = {
    location: { search: '' },
    __flyCityContinuityOverride: { enabled: true },
    __flyWorldPassTierOverride: false,
  };
  const WORLD_SIZE = 2 * Math.PI * 6378137;
  const { cityHorizonFor, cityHorizonRequest } = await import('../lib/fly/city-horizon.js');
  const { SatSkylineEngine } = await import('../lib/fly/toy-world/sat-skyline-engine.js');
  const { createStandInGeometry, countAtLeast, STAND_IN_TRIANGLES } = await import('../lib/fly/toy-world/sat-stand-ins.js');
  const { Mesh, ShaderLib } = await import('three');
  const profile = cityHorizonFor('medium');
  const options = cityHorizonRequest({ ...HIGH, worldPass: wpReq(false) }, profile);
  options.worldPass.reach = { on: false, standIns: false, worker: null };
  options.cityHorizon.compact = true;
  const [x, y] = tileOf(40.7549, -73.984, 14);
  const build = () => api.buildTile(14, x, y, 'sat-skyline', options);
  const first = (await build()).satStandIns;
  const second = (await build()).satStandIns;
  assert.ok(first?.n > profile.maxBodies, 'recorded Midtown tile reaches the denser compact footprint path');
  assert.ok(first.n * STAND_IN_TRIANGLES <= profile.maxTriangles, 'worker keeps each tile within its main-pass triangle share');
  for (const field of ['size', 'pos', 'dim', 'col']) assert.deepEqual(first[field], second[field]);
  for (let i = 1; i < first.n; i++) assert.ok(first.size[i] <= first.size[i - 1], 'descending footprint rank');
  const tileSpan = WORLD_SIZE / 2 ** 14;
  const octant = coordinate => Math.max(0, Math.min(7, Math.floor((coordinate / tileSpan + .5) * 8)));
  const blocks = new Set();
  let maxH = 0;
  for (let i = 0; i < first.n; i++) {
    blocks.add(octant(first.pos[i * 2]) + 8 * octant(first.pos[i * 2 + 1]));
    maxH = Math.max(maxH, first.dim[i * 4 + 2]);
  }
  assert.ok(blocks.size >= 32, 'mapped Midtown sample covers at least half its 8-by-8 grid');

  const engine = new SatSkylineEngine({ groundAt: () => ({ elev: 0, tileZ: 16 }) });
  engine.setHorizonTier('medium');
  assert.ok(engine._compact);
  assert.equal(engine.workerCount, 1);
  assert.equal(engine._reachCfg.photo.enabled, false);
  const shader = { ...ShaderLib.standard, uniforms: {} };
  engine.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('float rimDistance = distance(sCentre.xz, uBendCenter);'));
  assert.ok(!shader.fragmentShader.includes('skyA *= 1.0-smoothstep(uCityHorizonBand'));
  assert.ok(shader.fragmentShader.includes('uArchitectureNearFade * vArchitectureCovered'));
  const groupSpan = tileSpan * profile.groupN;
  const group = { z: 14, gx: Math.floor(x / profile.groupN), gy: Math.floor(y / profile.groupN) };
  const key = `${group.z}/${group.gx}/${group.gy}`;
  const cx = (group.gx + .5) * groupSpan - WORLD_SIZE / 2;
  const cz = (group.gy + .5) * groupSpan - WORLD_SIZE / 2;
  const n = first.n * profile.groupN ** 2;
  const size = Float32Array.from({ length: n }, (_, index) => first.size[0] * (1 - index / (n * 2)));
  const bundle = { n, size, maxH, ax: new Float32Array(n), az: new Float32Array(n),
    dim: new Uint16Array(n * 4), wall: new Uint8Array(n * 4), roof: new Uint8Array(n * 4), gnd: new Uint8Array(n * 4) };
  const geometry = createStandInGeometry(bundle, new Float32Array(n), groupSpan);
  assert.equal(geometry.getAttribute('aCityRank').array, size, 'CPU prefix and GPU attribute share the same rank buffer');
  const oldMesh = new Mesh(geometry, engine.material);
  engine.object.add(oldMesh);
  const chunk = { group, cx, cz, mesh: oldMesh, sourceMask: 1, state: 'building', gen: 1,
    pending: 2, failed: 0, parts: [], retryAt: Infinity, standIns: { n, size, yLo: 0, yHi: 1, maxH } };
  engine.chunks.set(key, chunk);
  engine._now = 10;
  engine.building = 2;
  const offset = -(profile.groupN - 1) / 2 * tileSpan;
  engine._childDone(key, 1, { satStandIns: first }, offset, offset);
  engine._childDone(key, 1, { empty: true, reason: 'no-data' }, offset + tileSpan, offset);
  assert.equal(chunk.state, 'ready');
  assert.ok(chunk.mesh === oldMesh, 'a repeated no-data child leaves the ready mesh attached');
  assert.ok(Number.isFinite(chunk.retryAt));
  assert.equal(engine.pendingFinalize.length, 0);

  engine._horizonRadius = profile.reachM;
  engine.maxChunks = profile.maxChunks;
  engine._refreshDesired(cx, cz, 0, chunk.retryAt + 1);
  assert.ok(chunk.mesh === oldMesh);
  assert.equal(chunk.repairQueued, true);
  assert.ok(engine.queue.some(e => e.gx === group.gx && e.gy === group.gy));

  Object.assign(chunk, { state: 'building', gen: 2, pending: 2, failed: 0, sawNoData: false, parts: [] });
  engine.building = 2;
  engine._childDone(key, 2, { satStandIns: first }, offset + tileSpan, offset);
  engine._childDone(key, 2, null, offset, offset, true);
  assert.ok(chunk.mesh === oldMesh, 'mixed recovery must retain the old coverage when a different child fails');
  assert.equal(chunk.sourceMask, 1);
  assert.equal(engine.pendingFinalize.length, 0);

  const cap = profile.maxTriangles * profile.groupN ** 2 * profile.maxChunks;
  // Stress the allocator using multiple equally near copies of the recorded
  // candidate count. Playback uses the same prefix for CPU culling and GPU
  // instancing, including the separate reflection target.
  const stressCount = profile.maxChunks; // The reflection pass pushes these full groups over budget.
  const copies = [{ entry: chunk, mesh: oldMesh }];
  for (let index = 1; index < stressCount; index++) {
    const mesh = new Mesh(geometry.clone(), engine.material);
    const entry = { ...chunk, mesh };
    copies.push({ entry, mesh });
    engine.object.add(mesh);
    engine.chunks.set('budget-' + index, entry);
  }
  const outgoing = copies.at(-1);
  engine._evict('budget-' + (stressCount - 1), outgoing.entry);
  assert.ok(engine._dying.some(fade => fade.chunk === outgoing.entry && fade.mesh === outgoing.mesh));
  engine._standInView.reflH = engine._standInView.H;
  engine._updateVisibility(cx, cz, 0, 1, 20);
  engine._updateStandInCounts(20, cx, cz, 0);
  assert.ok(engine._standInMinPx > engine._reachCfg.minPx, 'compact governor engages under triangle pressure');
  let submitted = 0;
  for (const { entry, mesh } of copies) {
    const geo = mesh.geometry;
    if (!mesh.visible) continue;
    engine._standInPass({ getRenderTarget: () => ({ texture: { name: 'coastal-city-reflection' }, height: engine._standInView.H }) }, entry, geo);
    submitted += geo.instanceCount;
    engine._standInPass({ getRenderTarget: () => null }, entry, geo);
    submitted += geo.instanceCount;
  }
  assert.ok(outgoing.mesh.visible && outgoing.mesh.geometry.instanceCount > 0, 'the outgoing draw is exercised');
  assert.ok(submitted > 0 && submitted * STAND_IN_TRIANGLES <= cap,
    `main and reflection share the compact cap (submitted ${submitted * STAND_IN_TRIANGLES}, cap ${cap}, threshold ${engine._standInMinPx}, distance ${chunk.standInD}, rank ${size[0]})`);
  assert.equal(geometry.instanceCount, countAtLeast(size, n, engine._standInMinPx * chunk.standInD / engine._standInView.K));

  Object.assign(chunk, { state: 'building', gen: 3, pending: 2, failed: 0, sawNoData: false, parts: [] });
  engine.building = 2;
  engine._childDone(key, 3, { satStandIns: first }, offset, offset);
  engine._childDone(key, 3, { satStandIns: first }, offset + tileSpan, offset);
  assert.equal(chunk.state, 'draping');
  assert.ok(chunk.mesh === oldMesh, 'a larger replacement waits for draping before publication');
  assert.equal(engine.pendingFinalize.length, 1);
  engine.notifyWarp(21);
  engine._refreshDesired(cx + 100000, cz, 0, 21);
  assert.equal(engine.pendingFinalize.length, 0);
  engine.dispose();
  engine._childDone(key, 3, { satStandIns: first }, offset, offset);
  assert.equal(engine.chunks.size, 0, 'late replies cannot resurrect a disposed engine');
  assert.equal(engine.object.children.length, 0);
  console.log(`PASS continuity: ${first.n} compact tile footprints, matching CPU/GPU ranks, bounded draws, partial retry and warp cleanup`);
  process.exit(0);
}

// Test the actual far worker and the street mask against recorded city blocks.
if (argv.includes('--relief')) {
  const { WORLD_REACH } = await import('../lib/fly/fly-constants.js');
  let additions = 0;
  for (const [name,lat,lon,extra] of PLACES) {
    if (only && !name.includes(only)) continue;
    const [x,y] = tileOf(lat,lon,14);
    for (const [dx,dy] of [[0,0],...extra]) {
      const bundles = [];
      for (const enabled of [false,true]) {
        const req = wpReq(true);
        req.reach.worker = {...WORLD_REACH.worker,footprintRelief:enabled};
        req.key += '-relief-' + Number(enabled);
        const result = await api.buildTile(14,x+dx,y+dy,'sat-skyline',{...HIGH,worldPass:req});
        bundles.push(result.satStandIns);
      }
      const [before,after] = bundles;
      const delta = (after?.n ?? 0) - (before?.n ?? 0);
      if (delta < 0 || delta > 24 || after?.n > WORLD_REACH.worker.maxPerTile) throw Error(name+' instance budget');
      for (let i=1; i<(after?.n ?? 0); i++) if(after.size[i]>after.size[i-1]) throw Error(name+' size order');
      console.log(name,x+dx,y+dy,'extra sections',delta);
      additions += delta;
    }
  }
  if (!additions) throw Error('No recorded footprint exercised section fitting');
  process.exit(0);
}

// --time: worker build ms per tile, median of 3, for the shipped horizon (base),
// reach alone, the other three wave-1 streams (three) and all four on (truth,
// arrival, reach, look) with their shipped worker tunables. The browser's far
// ring is one worker building 384 of these tiles in turn, so the sum is what
// the ring's arrival pays in worker time.
if (argv.includes('--time')) {
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const allReq = (names) => {
    const streams = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
    const blocks = { truth: C.WORLD_TRUTH, arrival: C.WORLD_ARRIVAL, reach: C.WORLD_REACH, look: C.WORLD_LOOK, ground: C.WORLD_GROUND };
    const req = { v: 1, key: `wp1-ultra-${names.join('')}`, any: true, tier: 'ultra' };
    for (const [s, subs] of Object.entries(streams)) {
      const on = names.includes(s);
      req[s] = { on, ...Object.fromEntries(subs.map((k) => [k, on && blocks[s][k] !== false])), worker: on ? JSON.parse(JSON.stringify(blocks[s].worker ?? {})) : null };
    }
    return req;
  };
  const arms = { base: HIGH, reach: { ...HIGH, worldPass: allReq(['reach']) }, three: { ...HIGH, worldPass: allReq(['truth', 'arrival', 'look']) }, all4: { ...HIGH, worldPass: allReq(['truth', 'arrival', 'reach', 'look']) } };
  const sums = Object.fromEntries(Object.keys(arms).map((k) => [k, 0]));
  for (const [name, lat, lon, extra] of PLACES) {
    if (only && !name.includes(only)) continue;
    const [x0, y0] = tileOf(lat, lon, 14);
    for (const [dx, dy] of [[0, 0], ...extra]) {
      const cells = [];
      for (const [arm, req] of Object.entries(arms)) {
        const ms = [];
        for (let r = 0; r < 3; r++) {
          const t = performance.now();
          const res = await api.buildTile(14, x0 + dx, y0 + dy, 'sat-skyline', req);
          ms.push(performance.now() - t);
          if (r === 0 && res.satStandIns) cells.n = res.satStandIns.n;
        }
        ms.sort((a, b) => a - b);
        sums[arm] += ms[1];
        cells.push(`${arm} ${ms[1].toFixed(1).padStart(6)}`);
      }
      console.log(`${name.padEnd(16)} ${x0 + dx}/${y0 + dy}  ${cells.join(' | ')}  (${cells.n ?? 0} stand-ins)`);
    }
  }
  console.log(`SUM ms ${Object.entries(sums).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' | ')}`);
  process.exit(0);
}
// --streets (round 2b): the street pattern. Per recorded city tile, the reach
// request with the shipped worker tunables but the street rule off (before),
// then the shipped block (after: corridors + centroid). Diag counters: of the
// 5 x 5 samples per emitted box, the share outside the building's own
// footprint (spill: independent of the corridor raster) and the share on a
// corridor cell at the default widths (the after arm's is low by construction).
if (argv.includes('--streets')) {
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const shipped = JSON.parse(JSON.stringify(C.WORLD_REACH.worker));
  const arm = (w) => { const r = wpReq(true); r.reach.worker = w; return { ...HIGH, worldPass: r }; };
  const arms = { before: arm({ ...shipped, roadGrid: 0, centroid: 0 }), after: arm(shipped) };
  const tot = { before: [0, 0, 0, 0, 0], after: [0, 0, 0, 0, 0] };
  await api.setDiag(true);
  for (const [name, lat, lon, extra] of PLACES) {
    if (only && !name.includes(only)) continue;
    if (['owens', 'iowa-farm', 'powell-oh', 'jfk'].includes(name)) continue;
    const [x0, y0] = tileOf(lat, lon, 14);
    for (const [dx, dy] of [[0, 0], ...extra]) {
      const cells = [];
      for (const [k, req] of Object.entries(arms)) {
        const t = performance.now();
        const res = await api.buildTile(14, x0 + dx, y0 + dy, 'sat-skyline', req);
        const ms = performance.now() - t;
        const R = res.wpStages?.reach ?? {};
        const n = res.satStandIns?.n ?? 0;
        const T = tot[k];
        T[0] += n; T[1] += R.samples ?? 0; T[2] += R.spillOut ?? 0; T[3] += R.onStreet ?? 0; T[4] += R.streetShrunk ?? 0;
        cells.push(`${k} n ${String(n).padStart(5)} spill ${(100 * (R.spillOut ?? 0) / Math.max(1, R.samples)).toFixed(1).padStart(5)}% street ${(100 * (R.onStreet ?? 0) / Math.max(1, R.samples)).toFixed(1).padStart(5)}% shrunk ${R.streetShrunk ?? 0} kept ${R.streetKept ?? 0} ${ms.toFixed(0)} ms`);
      }
      console.log(`${name.padEnd(16)} ${x0 + dx}/${y0 + dy}  ${cells.join(' | ')}`);
    }
  }
  for (const [k, T] of Object.entries(tot)) console.log(`TOTAL ${k}: stand-ins ${T[0]}, spill ${(100 * T[2] / Math.max(1, T[1])).toFixed(2)}%, on street ${(100 * T[3] / Math.max(1, T[1])).toFixed(2)}%, shrunk ${T[4]}`);
  process.exit(0);
}
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v, (k, x) => (k === 'tessMs' ? undefined : ArrayBuffer.isView(x) ? crypto.createHash('sha256').update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)).digest('hex') : x))).digest('hex');

const fails = [];
const rows = [];
let totalOld = 0;
let totalNew = 0;
for (const [name, lat, lon, extra] of PLACES) {
  if (only && !name.includes(only)) continue;
  const [x0, y0] = tileOf(lat, lon, 14);
  for (const [dx, dy] of [[0, 0], ...extra]) {
    const x = x0 + dx, y = y0 + dy;
    await api.setDiag(true);
    const old = await api.buildTile(14, x, y, 'sat-skyline', HIGH);
    const t1 = performance.now();
    const neu = await api.buildTile(14, x, y, 'sat-skyline', { ...HIGH, worldPass: wpReq(true) });
    const ms = performance.now() - t1;
    await api.setDiag(false);
    const shipped = await api.buildTile(14, x, y, 'sat-skyline', HIGH);
    const subOff = await api.buildTile(14, x, y, 'sat-skyline', { ...HIGH, worldPass: wpReq(false) });
    // wave 1 merge: stream B stamps every any-on result with `wp` (the request key); mask it
    if (sha({ ...subOff, worldPass: undefined, wp: undefined }) !== sha(shipped)) fails.push(`G5 ${name} ${x}/${y}: standIns:false differs from shipped`);
    const oldBodies = old.wpStages?.emittedPolygons ?? 0;
    const oldTris = old.wpStages?.emittedTriangles ?? 0;
    const si = neu.satStandIns;
    const n = si?.n ?? 0;
    const R = neu.wpStages?.reach ?? {};
    totalOld += oldBodies;
    totalNew += n;
    if (si) {
      for (let i = 1; i < n; i++) if (si.size[i] > si.size[i - 1]) { fails.push(`G3 ${name}: size not descending at ${i}`); break; }
      for (let i = 0; i < n; i++) {
        const ok = [si.pos[i * 2], si.pos[i * 2 + 1], ...si.dim.subarray(i * 4, i * 4 + 4)].every(Number.isFinite) && si.dim[i * 4] > 0 && si.dim[i * 4 + 1] > 0 && si.dim[i * 4 + 2] > 0;
        if (!ok) { fails.push(`G4 ${name}: bad record ${i}`); break; }
      }
    }
    if ((name === 'owens' || name === 'iowa-farm') && n > 0) fails.push(`G1 ${name} ${x}/${y}: ${n} stand-ins`);
    if (dx === 0 && dy === 0 && ['midtown', 'paris', 'tokyo', 'lagos'].includes(name) && n < 5 * oldBodies) fails.push(`G2 ${name}: ${n} < 5 x ${oldBodies}`);
    const hs = si ? Array.from(si.dim.filter((_, i) => i % 4 === 2)).sort((a, b) => a - b) : [];
    const p = (q) => (hs.length ? hs[Math.floor(q * (hs.length - 1))].toFixed(0) : '-');
    rows.push(`${name.padEnd(16)} ${x}/${y}  old ${String(oldBodies).padStart(4)} bodies ${String(oldTris).padStart(5)} tris | stand-ins ${String(n).padStart(5)} (${(n * 6 / 1000).toFixed(1)}k tris) h p50/p90 ${p(0.5)}/${p(0.9)} | adm ${R.admitted} mapped ${R.mapped} untag ${R.untagged} house ${R.untaggedHouse} sub ${R.untaggedSuburb} lock ${R.lockDropped} small ${R.belowSize} cap ${R.capDropped} | ${ms.toFixed(0)} ms`);
  }
}
console.log(rows.join('\n'));
console.log(`TOTAL old bodies ${totalOld}, stand-ins ${totalNew} (${(totalNew / Math.max(1, totalOld)).toFixed(1)}x)`);
if (fails.length) {
  console.log('FAIL\n' + fails.join('\n'));
  process.exit(1);
}
console.log('PASS G1-G5');

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (!/\.[cm]?js$/.test(url.pathname) && existsSync(fileURLToPath(url) + '.js')) return next(specifier + '.js', context);
  }
  return next(specifier, context);
} });
const { stepNearGround, stepNearGroundRuntime, groundCameraCue, groundAudioCue, nearGroundOn } = await import('../lib/fly/near-ground.js');
const { buildGroundScrubGeometry, buildGroundDetail, groundCell, triangleContains, createGroundScrubMaterial, recordGroundEdges, groundFootprintClear } = await import('../lib/fly/near-ground-detail.js');
const { applyNearGroundMaterial, NEAR_GROUND_UNIFORMS, updateNearGroundUniforms } = await import('../lib/fly/near-ground-material.js');
const { MeshStandardMaterial, MeshBasicMaterial, ShaderLib, Mesh, BufferGeometry, BufferAttribute } = await import('three');
let checks = 0;
const test = (label, fn) => { fn(); checks++; console.log(`PASS ${label}`); };
test('visual ground read cannot change flight ground or altitude', () => {
  const f = Object.freeze({ pos: Object.freeze({ y: 115 }), groundElev: 0, speed: 250 });
  const rt = { groundElevVis: 100 };
  const s = stepNearGroundRuntime(rt, f, 1 / 60, { mapStyle: 'satellite', warpEpoch: 1 });
  assert.equal(s.aglM, 15); assert.equal(s.k, 1); assert.equal(f.groundElev, 0);
});
test('unknown terrain, cruise and Neon yield no signal', () => {
  for (const input of [{ aglM: NaN }, { aglM: 1000 }, { aglM: 50, satellite: false }]) assert.equal(stepNearGround(null, input).k, 0);
});
test('one DEM change cannot step a mature visual signal', () => {
  const low = stepNearGround(null, { aglM: 30 });
  const high = stepNearGround(low, { aglM: 3000, dt: 1 / 60 });
  assert.ok(high.k > 0.97 && high.k < 1);
});
test('descent hysteresis and warp cut reset are independent', () => {
  const inside = stepNearGround(null, { aglM: 100 });
  assert.equal(stepNearGround(inside, { aglM: 600 }).active, true);
  assert.equal(stepNearGround(null, { aglM: 600 }).active, false);
  assert.equal(stepNearGround(inside, { aglM: 3000, epoch: 2 }).k, 0);
});
test('camera/audio cues bounded; reduced motion and rest are exact zero', () => {
  assert.equal(groundCameraCue({ k: 1, speedK: 1 }, true), 0);
  assert.equal(groundCameraCue({ k: 1, speedK: 0 }), 0);
  assert.equal(groundAudioCue({ k: 50, speedK: 40 }), 1);
  assert.equal(groundCameraCue(undefined), 0);
});
test('dev A/B switches leave ground signal usable', () => {
  process.env.NODE_ENV = 'development'; globalThis.window = { __flyGroundFeatures: { all: false } };
  assert.equal(nearGroundOn('detail'), false); assert.equal(stepNearGround(null, { aglM: 50 }).k, 1);
  delete globalThis.window;
});
test('production A/B requires graphicsReview=1; URL changes parse only once', () => {
  process.env.NODE_ENV = 'production';
  globalThis.window = { location: { search: '' }, __flyGroundFeatures: { all: false } };
  assert.equal(nearGroundOn('detail'), true);
  window.location.search = '?graphicsReview=0'; assert.equal(nearGroundOn('detail'), true);
  const OriginalParams = globalThis.URLSearchParams;
  let parses = 0;
  globalThis.URLSearchParams = class extends OriginalParams { constructor(...args) { super(...args); parses++; } };
  window.location.search = '?graphicsReview=1'; assert.equal(nearGroundOn('detail'), false);
  nearGroundOn('detail'); nearGroundOn('audio'); assert.equal(parses, 1);
  globalThis.URLSearchParams = OriginalParams;
  window.__flyGroundFeatures = { audio: false };
  assert.equal(nearGroundOn('audio'), false); assert.equal(nearGroundOn('detail'), true);
  window.__flyGroundFeatures = { pools: false }; assert.equal(nearGroundOn('pools'), false); assert.equal(nearGroundOn('lighting'), true);
  window.location.search = ''; assert.equal(nearGroundOn('audio'), true);
  delete globalThis.window; process.env.NODE_ENV = 'development';
});
test('scrub geometry is finite, nondegenerate and within stated triangle budget', () => {
  const g = buildGroundScrubGeometry(), p = g.attributes.position.array, ix = g.index.array;
  assert.equal(ix.length / 3, 18);
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    assert.ok(Math.hypot(...cross) > 0.001);
    assert.ok(cross[0] * (p[a] + p[b] + p[c]) + cross[1] * (p[a + 1] + p[b + 1] + p[c + 1]) + cross[2] * (p[a + 2] + p[b + 2] + p[c + 2]) > 0);
  }
  for (const n of g.attributes.normal.array) assert.ok(Number.isFinite(n));
  g.dispose();
});
const mesh = (pos) => {
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); g.setIndex([0, 1, 2]);
  return new Mesh(g, new MeshBasicMaterial());
};
const chunk = { cx: 0, cz: 0, grid: [100], tint: { pos: new Float32Array([0, 0, 0, 1200, 0, 0, 0, 0, 1200]), idx: [0, 1, 2], cls: [3, 3, 3] } };
const tile = { z: 15, x: 16384, y: 16384 };
const fixtures = () => ({ veg: { nearest: () => [chunk], groundAtLocal: () => 100 },
  buildings: { chunks: new Map([['b', { tile, state: 'ready', waterCoverage: 0 }]]), queryColumns: () => [] },
  roads: { chunks: new Map([['r', { tile, state: 'ready' }]]) }, x: 250, z: 250, mercatorK: 1, tier: 'high' });
const collect = (input) => { const it = buildGroundDetail(input); let step; do { step = it.next(); } while (!step.done); return step.value; };
test('landclass placement is deterministic, capped and drapes in true metres', () => {
  const rows = collect(fixtures()); assert.ok(rows.length > 50); assert.ok(rows.length <= 640);
  assert.deepEqual(rows, collect(fixtures()));
  for (const row of rows) { assert.equal(row.y, 99.95); assert.equal(row.cls, 3); }
});
test('no landcover, absent road/building coverage and wet tiles without water geometry produce zero', () => {
  const a = fixtures(); a.veg.nearest = () => []; assert.equal(collect(a).length, 0);
  const b = fixtures(); b.roads.chunks.clear(); assert.equal(collect(b).length, 0);
  const c = fixtures(); c.buildings.chunks.get('b').waterCoverage = 0.1; assert.equal(collect(c).length, 0);
  const d = fixtures(); d.buildings.chunks.get('b').coarse = true; assert.equal(collect(d).length, 0);
});
test('full road and water polygons, and building columns, exclude every covered candidate', () => {
  const a = fixtures(), baseline = collect(a), first = baseline[0];
  a.buildings.queryColumns = () => [{ x: first.x, z: first.z, r: 20 }];
  assert.ok(!collect(a).some((r) => Math.hypot(r.x - first.x, r.z - first.z) < 24));
  const b = fixtures(); b.roads.chunks.get('r').mesh = mesh([0, 0, 0, 1200, 0, 0, 0, 0, 1200]); assert.equal(collect(b).length, 0);
  const c = fixtures(); c.buildings.chunks.get('b').waterCoverage = 0.8; c.buildings.chunks.get('b').water = mesh([0, 0, 0, 1200, 0, 0, 0, 0, 1200]); assert.equal(collect(c).length, 0);
});
test('tier thinning keeps locations and shape stable in overlapping pools', () => {
  const high = collect(fixtures()), medium = collect({ ...fixtures(), tier: 'medium' });
  const ids = new Set(high.map((p) => p.id)); assert.ok(medium.length > 0 && medium.length < high.length);
  for (const p of medium) assert.ok(ids.has(p.id));
  assert.deepEqual(groundCell(481220, -300500), groundCell(481220, -300500));
});
test('grass and scrub use distinct supported shapes within the existing pool', () => {
  const grass = collect(fixtures()); assert.ok(grass.every((p) => p.kind === 'grass' && p.height <= 0.58));
  const a = fixtures(); a.veg.nearest = () => [{ ...chunk, tint: { ...chunk.tint, cls: [2, 2, 2] } }];
  const scrub = collect(a); assert.ok(scrub.every((p) => p.kind === 'scrub' && p.height >= 0.65));
});
test('shared woodland triangulation diagonals cannot become hedge witnesses', () => {
  const edges = new Map(); recordGroundEdges(edges, [0, 0, 10, 0, 0, 10]); recordGroundEdges(edges, [10, 0, 10, 10, 0, 10]);
  assert.equal([...edges.values()].filter((e) => e.count === 1).length, 4);
  assert.equal([...edges.values()].filter((e) => e.count === 2).length, 1);
});
test('elongated footprint exclusion checks tips and sides, not just its anchor', () => {
  const shape = { x: 0, z: 0, yaw: 0, lengthM: 5, widthM: 1.2 };
  assert.equal(groundFootprintClear(shape, () => true), true);
  assert.equal(groundFootprintClear(shape, (x) => x < 2), false);
  assert.equal(groundFootprintClear(shape, (_, z) => z < 0.5), false);
  assert.equal(groundFootprintClear({ ...shape, yaw: Math.PI / 2 }, (_, z) => z < 2), false);
});
test('hedges require both woodland boundary and minor-road witnesses; blocked tips reject conversion', () => {
  const first = collect(fixtures()).find((p) => p.x > 200 && p.x < 300 && p.z > 200 && p.z < 300);
  assert.ok(first);
  const edgeX = first.x - 2.5;
  const a = fixtures(), woodland = { ...chunk, tint: { pos: new Float32Array([edgeX, 0, 0, 1200, 0, 0, edgeX, 0, 1200]), idx: [0, 1, 2], cls: [2, 2, 2] } };
  a.veg.nearest = () => [woodland];
  const road = mesh([edgeX - 8, 0, 0, edgeX - 4, 0, 0, edgeX - 4, 0, 1200, edgeX - 8, 0, 1200]);
  road.geometry.setIndex([0, 1, 2, 0, 2, 3]); road.geometry.setAttribute('aRoadCls', new BufferAttribute(new Float32Array([5, 5, 5, 5]), 1));
  a.roads.chunks.get('r').mesh = road;
  const hedges = collect(a).filter((p) => p.kind === 'hedge');
  assert.ok(hedges.some((p) => p.id === first.id));
  a.veg.nearest = () => [{ ...woodland, tint: { ...woodland.tint, cls: [5, 5, 5] } }];
  assert.equal(collect(a).filter((p) => p.kind === 'hedge').length, 0);
  a.veg.nearest = () => [woodland]; road.geometry.attributes.aRoadCls.array.fill(1);
  assert.equal(collect(a).filter((p) => p.kind === 'hedge').length, 0);
  road.geometry.attributes.aRoadCls.array.fill(5);
  a.buildings.queryColumns = () => [{ x: first.x, z: first.z + 6, r: 0.1 }];
  assert.ok(!collect(a).some((p) => p.id === first.id && p.kind === 'hedge'));
});
test('degenerate coverage triangles never contain points', () => {
  assert.equal(triangleContains([0, 0, 0, 0, 1, 1], 0, 0, 4), false);
});
test('detail color and shadow use the same altitude and distance deformation', () => {
  const bend = (m) => { m.customProgramCacheKey = () => 'test-bend'; };
  for (const depth of [false, true]) {
    const m = createGroundScrubMaterial(bend, depth), sh = { ...ShaderLib[depth ? 'depth' : 'standard'], uniforms: {} };
    m.onBeforeCompile(sh); assert.ok(sh.vertexShader.includes('transformed *= gdFade'));
    assert.ok(sh.vertexShader.includes('uGroundDetailK')); m.dispose();
  }
});
test('terrain/basic and standard material compositions preserve prior hooks and separate cache keys', () => {
  for (const [m, kind] of [[new MeshStandardMaterial(), 'standard'], [new MeshBasicMaterial(), 'basic']]) {
    m.customProgramCacheKey = () => 'parent'; m.onBeforeCompile = (s) => { s.uniforms.previous = { value: 1 }; };
    applyNearGroundMaterial(m); const sh = { ...ShaderLib[kind], uniforms: {} }; m.onBeforeCompile(sh);
    assert.equal(sh.uniforms.previous.value, 1); assert.equal(m.customProgramCacheKey(), 'parent-near-ground-terrain-v1');
    assert.ok(sh.fragmentShader.includes('fwidth(q)')); assert.ok(sh.fragmentShader.includes('ngSurface'));
    assert.equal(sh.fragmentShader.includes('ngGradient'), kind === 'standard'); m.dispose();
  }
});
test('origin phase leaves procedural domain unchanged modulo its period across rebase', () => {
  const absoluteX = 8225612.25;
  for (const origin of [8224000, 8226048, 8228096]) {
    updateNearGroundUniforms({ origin: { anchor: { x: origin, z: 0 } } }, { latDeg: 40 }, { k: 1 }, 'medium');
    const shaderX = absoluteX - origin + NEAR_GROUND_UNIFORMS.uNearGroundOrigin.value.x;
    assert.ok(Math.abs(Math.sin(shaderX * Math.PI / 2) - Math.sin((absoluteX % 4096) * Math.PI / 2)) < 1e-8);
  }
});
console.log(`VERIFY: PASS (${checks} independent ground checks; browser/GPU unmeasured)`);

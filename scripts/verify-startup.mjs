import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const { TileMap, TileSource } = await import('../lib/fly/vendor/three-tile/index.js');
const { worldReadiness } = await import('../lib/fly/world-readiness.js');
const { cinemaProfile } = await import('../lib/fly/cinema-policy.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { Scene, Mesh, MeshStandardMaterial, PerspectiveCamera } = await import('three');
const { warmMeasuredWorldProfiles } = await import('../lib/fly/measured-world-prewarm.js');
const { createPassPrewarm } = await import('../lib/fly/pass-prewarm.mjs');
let count = 0;
const check = async (name, run) => { await run(); console.log('PASS ' + name); count++; };
const source = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');

await check('cloud preparation restores renderer state and gates only the actual active shader batch', async () => {
  const originalTarget = {}, originalMaterial = {}, programs = new Map(); let target = originalTarget;
  const pass = { fullscreenMaterial: originalMaterial, scene: {}, camera: {} };
  const gl = { domElement: new EventTarget(), extensions: { has: () => true }, getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target, setRenderTarget: value => { target = value; }, properties: { get: material => ({ currentProgram: programs.get(material) }) },
    compile() { const material = pass.fullscreenMaterial, program = { ready: false, isReady() { return this.ready; } }; programs.set(material, program); return new Set([material]); },
  };
  const warm = createPassPrewarm(), materials = [{ uuid: 'enhanced-march' }, { uuid: 'filter' }, { uuid: 'enhanced-composite' }];
  warm.prepare(gl, pass, materials, {});
  assert.equal(target, originalTarget); assert.equal(pass.fullscreenMaterial, originalMaterial); assert.equal(programs.size, 3);
  const rt = { prewarm: { done: true }, cloudWarm: warm.state };
  assert.equal(worldReadiness(rt).parts.shaders, false);
  warm.prepare(gl, pass, materials, {}); assert.equal(programs.size, 3);
  for (const program of programs.values()) program.ready = true;
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(worldReadiness(rt).parts.shaders, true);
  gl.domElement.dispatchEvent(new Event('webglcontextlost')); assert.equal(worldReadiness(rt).parts.shaders, false);
  warm.prepare(gl, pass, materials, {}); assert.equal(warm.state.status, 'compiling');
  warm.dispose(); for (const program of programs.values()) program.ready = true;
  await new Promise(resolve => setTimeout(resolve, 20)); assert.notEqual(warm.state.status, 'ready', 'Disposed work cannot publish late readiness');
});

await check('arrival traversal spends the first available slot on local ground without reordering the scene', () => {
  const map = TileMap.create({ imgSource: new TileSource({ url: 'https://fixture/{z}/{x}/{y}', minLevel: 0, maxLevel: 15 }) });
  const root = map.rootTile, children = root._createChildren(map.loader), order = [];
  root.add(...children);
  for (const child of children) child._update = params => { if (params.slots-- > 0) order.push(`${child.x}/${child.y}`); };
  root.flyArrivalGround = { x: 10000000, z: 10000000, radius: 1000, zoom: 15 };
  root._updateChildren({ slots: 1 });
  assert.deepEqual(order, ['1/1']); assert.deepEqual(root.children, children);
  order.length = 0; root.flyArrivalGround = null; root._updateChildren({ slots: 1 });
  assert.deepEqual(order, ['0/0'], 'Flight keeps the original traversal');
  map.dispose();
});

await check('local terrain readiness ignores distant downloads, but never accepts a shallow nearby tile', () => {
  const rt = { flight: { pos: { x: 0, y: 900, z: 0 }, latDeg: 0 },
    terraStats: { camTileZ: 15, targetZ: 18, sharp: false, downloading: 16 } };
  assert.equal(worldReadiness(rt).parts.terrain, true);
  rt.terraStats.camTileZ = 8; assert.equal(worldReadiness(rt).parts.terrain, false);
  rt.terraStats.sharp = true; assert.equal(worldReadiness(rt).parts.terrain, false);
  rt.flight.pos.y = 9000; assert.equal(worldReadiness(rt).parts.terrain, true, 'Retain high-cruise plateau behavior');
  delete rt.terraStats; assert.equal(worldReadiness(rt).parts.terrain, false);
});

await check('cold prefetch warms complete coarse sibling sets within the existing URL and concurrency caps', async () => {
  const terrain = fs.readFileSync(new URL('../lib/fly/terrain-engine.js', import.meta.url), 'utf8');
  const begin = terrain.indexOf('  _prefetchPyramid('), end = terrain.indexOf('\n  /**', begin);
  let active = 0, peak = 0; const urls = [];
  const prefetch = Function('TERRA_PIPE', 'terraCacheOn', 'prefetchUrl', 'rasterStats',
    'return ({' + terrain.slice(begin, end) + '})._prefetchPyramid;')(
    { warp: { prefetchTiles: 48 } }, () => true, async url => {
      urls.push(url); active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    }, {});
  const sourceFor = name => ({ maxLevel: 18, getUrl: (x, y, z) => `${name}/${z}/${x}/${y}` });
  const engine = { map: { minLevel: 2, maxLevel: 18, imgSource: [sourceFor('img')], demSource: sourceFor('dem') } };
  prefetch.call(engine, -119.65, 37.7, { cold: true });
  prefetch.call(engine, -119.65, 37.7, { cold: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls.length, 48); assert.equal(new Set(urls).size, 48); assert.equal(peak, 6);
  for (let z = 2; z <= 7; z++) assert.equal(urls.filter(url => url.split('/')[1] === String(z)).length, 8);
  assert.equal(engine._prefetching, false);
  urls.length = 0; prefetch.call(engine, -119.65, 37.7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls[0].split('/')[1], '8', 'Warm warps keep their original pyramid');
  assert.ok(urls.length <= 48);
});

await check('optional compiles wait for reveal and cannot race the boot drain or each other', async () => {
  const start = source.indexOf('export async function prewarmSliceStep('), end = source.indexOf('\n/**', start);
  const state = { done: false }, slice = { running: false }, queue = [], calls = [];
  let revealed = -1, finish;
  const step = Function('_state', '_slice', '_pending', 'sinceRevealMs', 'runUnit', 'publishPrewarmStats',
    source.slice(start, end).replace('export ', '') + ';return prewarmSliceStep;')(
    state, slice, queue, () => revealed, async unit => { calls.push(unit); await new Promise(resolve => { finish = resolve; }); }, () => {});
  queue.push('first', 'second'); await step(); assert.deepEqual(calls, []);
  state.done = true; await step(); assert.deepEqual(calls, []);
  revealed = 10; const active = step(); await step(); assert.deepEqual(calls, ['first']);
  finish(); await active; assert.deepEqual(queue, ['second']);
});

await check('the production world warm dispatches only the effective profile at each starting quality', async () => {
  const begin = source.indexOf('let worldWarmPending = null;'), end = source.indexOf('\n/**', begin);
  const batches = [], state = { worldProfiles: {} };
  const warm = Function('_state', 'warmMeasuredWorldProfiles', 'cinemaProfile',
    source.slice(begin, end) + ';return warmMeasuredWorld;')(state, async args => { batches.push(args.cascadeCounts); }, cinemaProfile);
  for (const [tier, preset, expected] of [['low', 'high', 0], ['medium', 'high', 1], ['high', 'high', 2], ['high', 'ultra', 3]]) {
    useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityTier: tier, qualityPreset: preset });
    await warm({}, {}, {}); assert.deepEqual(batches.at(-1), [expected]);
  }
});

await check('optional profile completion cannot steal context-loss invalidation from active readiness', async () => {
  const properties = new WeakMap(), canvas = new EventTarget(); let target = null;
  const gl = { domElement: canvas, shadowMap: { enabled: true }, extensions: { has: () => true },
    getContext: () => ({ isContextLost: () => false }), getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    properties: { get: material => properties.get(material) },
    compile(owner) { const materials = new Set(); owner.traverse(object => {
      if (!object.material) return; materials.add(object.material);
      properties.set(object.material, { currentProgram: { cacheKey: object.material.uuid, isReady: () => true } });
    }); return materials; },
  };
  const scene = new Scene(), camera = new PerspectiveCamera(60, 1, .1, 20000), active = {}, optional = {};
  await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [2], state: active });
  await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [1], state: optional, required: false });
  assert.equal(active.status, 'ready'); assert.equal(optional.required, false);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(active.status, 'invalidated');
});

await check('critical terrain also dispatches only the active lighting profile', async () => {
  const begin = source.indexOf('export async function compileCriticalTerrain('), end = source.indexOf('\n/**', begin);
  const batches = [];
  const dependencies = { criticalTerrainByRenderer: new WeakMap(),
    createTerrainProgramRetention: () => ({ retain: async (_key, job) => { await job.promise; job.dispose(); }, clear() {} }),
    Scene, cinemaOn: () => true, cinemaProfile,
    addTerrainWarmMeshes: owner => owner.add(new Mesh(undefined, new MeshStandardMaterial())),
    compileCinemaProfiles: args => { batches.push(args.cascadeCounts); const owner = args.createWarmScene(); return {
      profiles: [{ scene: owner.scene, cascades: args.cascadeCounts[0] }], promise: Promise.resolve(), dispose: owner.dispose,
    }; },
  };
  const dispatch = Function(...Object.keys(dependencies), source.slice(begin, end).replace('export ', '') + ';return compileCriticalTerrain;')(...Object.values(dependencies));
  const gl = { domElement: new EventTarget(), properties: { get: () => ({ currentProgram: { cacheKey: 'terrain' } }) } };
  await dispatch({ gl, camera: {}, scene: new Scene() }); assert.deepEqual(batches, [[3]]);
  await dispatch({ gl, camera: {}, scene: new Scene(), cascadeCounts: [0] }); assert.deepEqual(batches.at(-1), [0]);
});
console.log(`STARTUP: ${count}/${count}`);

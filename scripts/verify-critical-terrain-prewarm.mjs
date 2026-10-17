import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { createCriticalTerrainGate, criticalTerrainReady, terrainArrivalCovered } from '../lib/fly/critical-terrain-prewarm.mjs';
import { createTerrainProgramRetention } from '../lib/fly/terrain-program-retention.mjs';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const { worldReadiness, retryWorldContent } = await import('../lib/fly/world-readiness.js');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let count = 0;
const check = async (name, run) => { await run(); count++; console.log('PASS ' + name); };
const step = (gate, compile, options = {}) => gate.tick({ key: 'env1/csm2', parallel: true, compile, ...options });

await check('first-draw publication waits for driver completion and a matching pre-render frame', async () => {
  let time = 100, dispatches = 0, draws = 0;
  const gate = createCriticalTerrainGate({ now: () => time });
  const material = new MeshStandardMaterial(), map = new Group(); map.add(new Mesh(undefined, material));
  const driver = deferred(), compile = () => { dispatches++; return driver.promise; };
  gate.hold(material);
  const draw = () => { if (map.visible && material.visible) draws++; };
  draw(); step(gate, compile, { available: false }); draw();
  assert.equal(dispatches, 0); assert.equal(draws, 0); assert.equal(map.visible, true, 'LOD tree must stay visible/updateable');
  time = 200; step(gate, compile); draw();
  assert.equal(dispatches, 1, 'Dispatch occurs on the pre-render call, not an idle callback');
  assert.equal(draws, 0); assert.equal(criticalTerrainReady(gate.state), false);
  time = 3800; driver.resolve(); await driver.promise; await Promise.resolve(); draw();
  assert.equal(material.visible, false, 'Promise completion alone cannot publish under a stale frame key');
  assert.equal(gate.state.compiledAt, 3800);
  time = 3816; step(gate, compile); draw();
  assert.equal(draws, 1); assert.equal(dispatches, 1); assert.equal(gate.state.readyAt, 3816);
  assert.equal(criticalTerrainReady(gate.state), true);
  assert.equal((await gate.wait()).status, 'ready');
  const later = new MeshStandardMaterial(); gate.hold(later); assert.equal(later.visible, true);
  material.dispose(); later.dispose(); map.children[0].geometry.dispose();
});

await check('a changed environment/shadow key cannot publish the previous completed program', async () => {
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(), first = deferred(), next = deferred();
  gate.hold(m); step(gate, () => first.promise);
  first.resolve(); await first.promise; await Promise.resolve();
  step(gate, () => next.promise, { key: 'env2/csm1' });
  assert.equal(m.visible, false); assert.equal(gate.state.attempts, 2);
  next.resolve(); await next.promise; await Promise.resolve();
  step(gate, () => assert.fail('must not redispatch completed key'), { key: 'env2/csm1' });
  assert.equal(m.visible, true); assert.equal(gate.state.key, 'env2/csm1'); m.dispose();
});

await check('out-of-order completion cannot release a newer pending compile', async () => {
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(), old = deferred(), current = deferred();
  gate.hold(m); step(gate, () => old.promise);
  step(gate, () => current.promise, { key: 'env1/csm1' });
  old.resolve(); await old.promise; await Promise.resolve();
  step(gate, () => assert.fail('already compiling'), { key: 'env1/csm1' });
  assert.equal(m.visible, false); assert.equal(gate.state.compiledAt, null);
  current.resolve(); await current.promise; await Promise.resolve();
  step(gate, () => assert.fail('already compiled'), { key: 'env1/csm1' });
  assert.equal(m.visible, true); m.dispose();
});

await check('streamed, already-hidden and evicted materials keep their own visibility and lifetime', () => {
  const gate = createCriticalTerrainGate(), visible = new MeshStandardMaterial(), hidden = new MeshStandardMaterial(), evicted = new MeshStandardMaterial();
  hidden.visible = false;
  gate.hold(visible); gate.hold(visible); gate.hold(hidden); gate.hold(evicted);
  assert.equal(gate.state.held, 3);
  evicted.dispose(); assert.equal(gate.state.held, 2);
  gate.bypass('time-cap');
  assert.equal(visible.visible, true); assert.equal(hidden.visible, false); assert.equal(gate.state.held, 0);
  assert.equal(criticalTerrainReady(gate.state), false, 'Bypass is not proof of a completed program');
  visible.dispose(); hidden.dispose();
});

await check('disposal settles waiting callers and late completion cannot touch the replacement engine', async () => {
  const old = createCriticalTerrainGate(), replacement = createCriticalTerrainGate();
  const a = new MeshStandardMaterial(), b = new MeshStandardMaterial(), driver = deferred();
  old.hold(a); step(old, () => driver.promise); old.dispose(); replacement.hold(b);
  assert.equal(a.visible, true); assert.equal((await old.wait()).status, 'disposed');
  driver.resolve(); await driver.promise; await Promise.resolve();
  assert.equal(old.state.status, 'disposed'); assert.equal(b.visible, false);
  replacement.dispose(); a.dispose(); b.dispose();
});

await check('unsupported parallel compilation preserves the existing visible path without pretending it warmed', async () => {
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(); gate.hold(m);
  step(gate, () => assert.fail('unsupported driver must not enter the critical compile'), { parallel: false, available: false });
  assert.equal(m.visible, true); assert.equal((await gate.wait()).status, 'unsupported');
  assert.equal(gate.state.required, false); assert.equal(gate.state.readyAt, null);
  assert.equal(criticalTerrainReady(gate.state), true, 'Existing general warm remains the supported readiness path'); m.dispose();
});

await check('failed compiles keep terrain held while covered until an explicit/capped degraded reveal', async () => {
  for (const compile of [() => { throw Error('dispatch failed'); }, () => Promise.reject(Error('driver failed'))]) {
    const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(); gate.hold(m);
    step(gate, compile); await gate.wait();
    assert.equal(m.visible, false); assert.equal(gate.state.status, 'failed');
    assert.match(gate.state.error, /failed/); assert.equal(criticalTerrainReady(gate.state), false);
    step(gate, () => assert.fail('failure cannot spin retries on every frame'));
    gate.bypass('time-cap'); assert.equal(m.visible, true); assert.equal(gate.state.reason, 'time-cap'); m.dispose();
  }
});

await check('an explicit retry re-arms a failed critical program without publishing it early', async () => {
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(), retry = deferred(); gate.hold(m);
  step(gate, () => Promise.reject(Error('transient driver failure'))); await gate.wait();
  assert.equal(gate.retry(), true); assert.equal(gate.state.status, 'waiting');
  assert.equal(m.visible, false); step(gate, () => retry.promise);
  retry.resolve(); await retry.promise; await Promise.resolve();
  assert.equal(m.visible, false); step(gate, () => assert.fail('already completed'));
  assert.equal(m.visible, true); assert.equal(gate.state.attempts, 2); assert.equal(gate.retry(), false); m.dispose();
});

await check('explicit reduced entry and time caps preserve their reasons even when compile resolves later', async () => {
  for (const reason of ['explicit-reduced', 'time-cap']) {
    const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(), driver = deferred(); gate.hold(m);
    step(gate, () => driver.promise); gate.bypass(reason);
    assert.equal(m.visible, true); assert.equal((await gate.wait()).reason, reason);
    driver.resolve(); await driver.promise; await Promise.resolve(); step(gate, () => assert.fail('terminal'));
    assert.equal(gate.state.status, 'bypassed'); assert.equal(gate.state.readyAt, null); m.dispose();
  }
});

await check('uncovered flight never holds terrain and readiness distinguishes required work from a fallback', () => {
  assert.equal(terrainArrivalCovered({}, { pct: 100 }, 'playing'), false);
  assert.equal(terrainArrivalCovered({}, { pct: 10 }, 'playing'), true);
  assert.equal(terrainArrivalCovered({ worldLoading: true }, { pct: 100 }, 'playing'), true);
  assert.equal(terrainArrivalCovered({}, null, 'boot'), true);
  assert.equal(terrainArrivalCovered({}, { pct: 100 }, 'boot'), false);
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(); gate.hold(m);
  step(gate, () => assert.fail('no curtain'), { covered: false });
  assert.equal(m.visible, true); assert.equal(gate.state.status, 'bypassed');
  const rt = { prewarm: { done: true }, criticalTerrain: gate.state };
  assert.equal(worldReadiness(rt).parts.shaders, false);
  rt.criticalTerrain = { required: true, status: 'ready' }; assert.equal(worldReadiness(rt).parts.shaders, true);
  rt.criticalTerrain = { required: false, status: 'unsupported' }; assert.equal(worldReadiness(rt).parts.shaders, true);
  rt.prewarm.done = false; assert.equal(worldReadiness(rt).parts.shaders, false); m.dispose();
});

await check('room profiles remain mandatory until compiled and share explicit retry actions', () => {
  let terrainRetries = 0, roomRetries = 0;
  const rt = { prewarm: { done: true }, criticalTerrain: { required: true, status: 'ready' },
    terrainPrewarm: { retry: () => terrainRetries++ }, loungeRoom: {
      programWarm: { required: true, status: 'compiling' }, retryWarm: () => roomRetries++,
    } };
  assert.equal(worldReadiness(rt).parts.shaders, false);
  rt.loungeRoom.programWarm.status = 'bypassed'; assert.equal(worldReadiness(rt).parts.shaders, false);
  rt.loungeRoom.programWarm.status = 'ready'; assert.equal(worldReadiness(rt).parts.shaders, true);
  retryWorldContent(rt); assert.equal(terrainRetries, 1); assert.equal(roomRetries, 1);
  delete rt.loungeRoom; assert.equal(worldReadiness(rt).parts.shaders, true);
});

await check('one hundred repeat arrivals retain one exact program owner and release only completed duplicates', async () => {
  const cache = createTerrainProgramRetention(), disposed = [];
  const job = id => ({ promise: Promise.resolve(id), dispose: () => disposed.push(id) });
  await cache.retain('CSM0/1/2 exact program keys', job(0));
  for (let i = 1; i <= 100; i++) await cache.retain('CSM0/1/2 exact program keys', job(i));
  assert.equal(cache.size, 1); assert.equal(disposed.length, 100); assert.ok(!disposed.includes(0));
  const pending = deferred();
  const ready = cache.retain('CSM0/1/2 exact program keys', { promise: pending.promise, dispose: () => disposed.push('pending') });
  assert.ok(!disposed.includes('pending'), 'Three still polls that material');
  pending.resolve(); await ready; assert.ok(disposed.includes('pending')); assert.ok(!disposed.includes(0));
  cache.clear(); assert.ok(disposed.includes(0)); assert.equal(cache.size, 0);
});

await check('retention is bounded across changed keys, and renderer teardown cannot retain a late job', async () => {
  const cache = createTerrainProgramRetention({ capacity: 3 }), disposed = [];
  for (let i = 0; i < 10; i++) await cache.retain(String(i), { promise: Promise.resolve(), dispose: () => disposed.push(i) });
  assert.equal(cache.size, 3); assert.deepEqual(disposed, [0, 1, 2, 3, 4, 5, 6]);
  const pending = deferred();
  const finished = cache.retain('late', { promise: pending.promise, dispose: () => disposed.push('late') });
  cache.clear(); assert.equal(cache.size, 0); assert.ok(!disposed.includes('late'));
  pending.resolve(); await finished; assert.equal(cache.size, 0); assert.ok(disposed.includes('late'));
  const failed = cache.retain('failed', { promise: Promise.reject(Error('compile failed')), dispose: () => disposed.push('failed') });
  await assert.rejects(failed, /compile failed/); assert.ok(disposed.includes('failed')); assert.equal(cache.size, 0);
});

await check('production ordering retains exact critical programs, and degraded reveals release both owners', () => {
  const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const component = read('components/fly/PrewarmRig.jsx'), warm = read('lib/fly/prewarm.js');
  assert.match(component, /\}, -0\.7\)/, 'After CSM −0.9 and environment −0.8; before reflection −0.5');
  assert.match(component, /beforeWarm: \(\) => runtime\.terrainPrewarm\?\.wait\(\)/);
  assert.match(warm, /compileCinemaProfiles\(\{ gl, camera, scene, createWarmScene,/);
  assert.match(warm, /currentProgram\?\.cacheKey/);
  assert.match(warm, /return cache\.retain\(key, job\)/);
  for (const file of ['components/fly/hud/BootScreen.jsx', 'components/fly/hud/WarpFlash.jsx']) {
    const source = read(file), bypass = source.indexOf('terrainPrewarm?.bypass(');
    assert.ok(bypass >= 0 && source.indexOf('rt.worldLoading=false', bypass) > bypass, file);
    assert.match(source, /loungeRoom\?\.bypassWarm\?\.\(reason\)/);
  }
});
console.log(`CRITICAL TERRAIN PREWARM: ${count}/${count}`);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, ShaderLib, Texture } from 'three';
import { createCriticalTerrainGate, criticalTerrainReady, isTerrainPreview, previewTerrainTile, terrainArrivalCovered } from '../lib/fly/critical-terrain-prewarm.mjs';
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
const { compileSceneAsync } = await import('../lib/fly/compile-scene-safe.js');
const { TerrainEngine } = await import('../lib/fly/terrain-engine.js');
// The vendored imagery plugin allocates its dormant one-pixel canvas on import.
globalThis.OffscreenCanvas ??= class OffscreenCanvas {};
const { createImagerySource } = await import('../lib/fly/tile-sources.js');
const { LoaderFactory } = await import('../lib/fly/vendor/three-tile/index.js');
const { applyBendFade } = await import('../lib/fly/toy-world/world-bend.js');
const { attachLodFade } = await import('../lib/fly/lod-crossfade.js');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let count = 0;
const check = async (name, run) => { await run(); count++; console.log('PASS ' + name); };
const step = (gate, compile, options = {}) => gate.tick({ key: 'env1/csm2', parallel: true, compile, ...options });

await check('resident satellite imagery uses the real DEM, bend, night light and LOD blend until an exact-key frame', async () => {
  const gate = createCriticalTerrainGate(), driver = deferred();
  const geometry = new PlaneGeometry(120, 160), map = new Texture({ width: 64, height: 64 });
  const originalWindow = globalThis.window, originalCaches = globalThis.caches;
  let provider;
  try {
    globalThis.window = {};
    globalThis.caches = {};
    provider = createImagerySource('satellite', 'high');
  } finally {
    globalThis.window = originalWindow;
    globalThis.caches = originalCaches;
  }
  assert.equal(provider.dataType, 'fly-image-cached', 'use the shipped cache-aware imagery path');
  const loader = LoaderFactory.getMaterialLoader(provider);
  const offlineLoader = Object.create(loader, { doLoad: { value: async () => map } });
  const source = await offlineLoader.load({ x: 4139, y: 2818, z: 13, source: provider });
  assert.equal(source.transparent, true, 'World Imagery marks its single full-opacity raster layer transparent');
  assert.equal(source.opacity, 1);
  const lod = attachLodFade(source);
  const tile = new Group(), model = new Mesh(geometry, [source]);
  const root = new Group(); root.add(tile); tile.add(model);
  root.position.set(1200, 10, -1800); tile.rotation.x = -Math.PI / 2; model.position.z = 6;
  let day = 1, visits = 0, previewDisposed = 0, mapDisposed = 0, geometryDisposed = 0;
  map.addEventListener('dispose', () => mapDisposed++);
  geometry.addEventListener('dispose', () => geometryDisposed++);
  const engine = { map: root };
  const unsubscribe = TerrainEngine.prototype.onTileMaterial.call(engine, (material, owner) => {
    visits++;
    assert.equal(material, source); assert.equal(owner, model);
    gate.hold(material, onRemove => previewTerrainTile(owner, material, { patchBend: applyBendFade, daylight: () => day, onRemove }));
  });
  const [preview] = model.children;
  assert.equal(visits, 1, 'attaching a preview during the terrain walk does not re-patch it');
  assert.equal(gate.state.previews, 1); assert.equal(source.visible, false);
  assert.equal(preview.geometry, geometry); assert.equal(preview.material.map, map);
  assert.equal(preview.material.isMeshBasicMaterial, true);
  assert.equal(preview.material.transparent, source.transparent);
  assert.equal(preview.material.opacity, source.opacity);
  assert.equal(preview.castShadow, false);
  assert.equal(model.material[0], source); assert.equal(isTerrainPreview(preview), true);
  TerrainEngine.prototype.forEachTileMaterial.call(engine, material => assert.equal(material, source));
  preview.material.addEventListener('dispose', () => previewDisposed++);
  root.updateMatrixWorld(true);
  assert.ok(model.matrixWorld.equals(preview.matrixWorld));
  assert.equal(preview.raycast(null, []), undefined);
  const shader = { ...ShaderLib.basic, uniforms: {} };
  preview.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /uBendCenter/);
  if (lod) {
    assert.equal(shader.uniforms.uLodFadeMix, lod.mix);
    assert.equal(shader.uniforms.uLodFadeMap, lod.map);
    assert.match(shader.fragmentShader, /sampledDiffuseColor = mix/);
  }
  preview.onBeforeRender(); const daylight = preview.material.color.clone();
  day = 0; preview.onBeforeRender();
  assert.ok(preview.material.color.r < daylight.r * .08);
  assert.ok(preview.material.color.b > preview.material.color.r);
  model.visible = false;
  const drawn = [];
  root.traverseVisible(node => drawn.push(node));
  assert.ok(!drawn.includes(preview), 'vendor parking hides both original and temporary draw');
  model.visible = true;
  step(gate, () => driver.promise); gate.bypass('time-cap');
  assert.equal(model.children[0], preview); assert.equal(source.visible, false);
  driver.resolve(); await driver.promise; await Promise.resolve();
  assert.equal(source.visible, false); assert.equal(model.children[0], preview);
  step(gate, () => assert.fail('already linked'), { covered: false });
  assert.equal(model.children.length, 0); assert.equal(source.visible, true);
  assert.equal(gate.state.previews, 0); assert.equal(previewDisposed, 1);
  assert.equal(mapDisposed, 0); assert.equal(geometryDisposed, 0);
  unsubscribe(); source.map = null; source.dispose(); geometry.dispose(); map.dispose();
});

await check('182 revealed terrain tiles hand off in traversal order with eight exact draws at a time', async () => {
  const gate = createCriticalTerrainGate(), geometry = new PlaneGeometry(), map = new Texture({width:64,height:64});
  const tiles = Array.from({length:182}, () => {
    const source = new MeshStandardMaterial({map}), model = new Mesh(geometry,source);
    gate.hold(source, onRemove => previewTerrainTile(model,source,{patchBend:applyBendFade,daylight:()=>1,onRemove}));
    return model;
  });
  const tick = () => step(gate, () => assert.fail('already linked'), { covered:false, canStageTile:()=>true });
  step(gate, () => Promise.resolve(), { covered:false }); await Promise.resolve();
  tick();
  const later = new MeshStandardMaterial();
  gate.hold(later); assert.equal(later.visible,true);
  const sourceVisible = () => tiles.filter(t=>t.material.visible).length;
  const pending = () => tiles.filter(t=>t.userData.terrainHandoff);
  assert.deepEqual(pending(), tiles.slice(0,8));
  tick(); assert.equal(pending().length,8,'pending links bound the backlog');
  assert.equal(sourceVisible(),0);
  let frames = 0;
  while (gate.state.held) {
    const before = sourceVisible(), batch = pending();
    assert.deepEqual(batch,tiles.slice(before,before+8));
    for (const tile of batch) tile.userData.terrainHandoff();
    for (const tile of tiles) assert.equal(Number(tile.material.visible)+tile.children.length,1,'exactly one drawable surface');
    assert.ok(sourceVisible()-before<=8); frames++; tick();
  }
  assert.equal(frames,23); assert.equal(gate.state.status,'ready'); assert.equal(gate.state.previews,0);
  for (const model of tiles) model.material.dispose();
  geometry.dispose(); map.dispose(); later.dispose();
});

await check('cover, style change, driver fallback and disposal clean up a partial visible handoff synchronously', async () => {
  for (const exit of ['covered','style','unsupported','disposed','composer-off']) {
    const gate=createCriticalTerrainGate(), tiles=Array.from({length:22},()=>new MeshStandardMaterial());
    const waiting=new Set();
    for (const m of tiles) gate.hold(m,onRemove=>{
      const remove=()=>{waiting.delete(m);onRemove();};remove.stage=()=>waiting.add(m);return remove;
    });
    const options={covered:false,style:'satellite/enhanced',canStageTile:()=>true};
    step(gate,()=>Promise.resolve(),options);await Promise.resolve();step(gate,()=>assert.fail(),options);
    assert.equal(waiting.size,8);
    tiles[0].dispose();assert.equal(waiting.size,7);assert.equal(gate.state.held,21);
    if (exit==='disposed') gate.dispose();
    else if (exit==='covered') step(gate,()=>assert.fail(),{...options,covered:true});
    else if (exit==='unsupported') step(gate,()=>assert.fail(),{...options,parallel:false});
    else if (exit==='style') {
      const nextStyle={...options,style:'toy/classic',key:'toy'};
      step(gate,()=>Promise.resolve(),nextStyle);
      assert.equal(gate.state.required,true);assert.equal(gate.state.status,'compiling');
      await Promise.resolve();step(gate,()=>assert.fail(),nextStyle);
      assert.equal(gate.state.key,'toy');assert.equal(gate.state.status,'ready');
    } else while (gate.state.held) step(gate,()=>assert.fail(),{...options,canStageTile:undefined});
    assert.equal(gate.state.held,0);assert.equal(gate.state.previews,0);assert.equal(waiting.size,0);
    assert.ok(tiles.every(m=>m.visible));
    for(const m of tiles)m.dispose();
  }
});

await check('a covered rekey waits for its new driver and a staged DEM can acquire a replacement preview', async () => {
  const gate=createCriticalTerrainGate(), map=new Texture({width:64,height:64});
  const source=new MeshStandardMaterial({map}), model=new Mesh(new PlaneGeometry(),source);
  const hold=()=>gate.hold(source,onRemove=>previewTerrainTile(model,source,{patchBend:()=>{},daylight:()=>1,onRemove}));
  const options={covered:false,canStageTile:()=>true};
  hold();step(gate,()=>Promise.resolve(),options);await Promise.resolve();step(gate,()=>assert.fail(),options);
  model.geometry.dispose();model.geometry=new PlaneGeometry();hold();step(gate,()=>assert.fail(),options);
  assert.equal(source.visible,false);assert.equal(model.children[0].geometry,model.geometry);
  assert.equal(typeof model.userData.terrainHandoff,'function');
  const changed={...options,covered:true,key:'new-environment'},driver=deferred();
  step(gate,()=>driver.promise,changed);
  assert.equal(source.visible,false);assert.equal(model.children.length,1);
  assert.equal(model.userData.terrainHandoff,undefined);assert.equal(gate.state.status,'compiling');
  driver.resolve();await driver.promise;await Promise.resolve();step(gate,()=>assert.fail(),changed);
  assert.equal(source.visible,true);assert.equal(model.children.length,0);assert.equal(gate.state.key,changed.key);
  source.dispose();model.geometry.dispose();map.dispose();
});

await check('eviction and in-place DEM replacement release only the borrowed preview, and late tiles can still enter', () => {
  const gate = createCriticalTerrainGate(), root = new Group();
  const map = new Texture({ width: 64, height: 64 });
  const source = new MeshStandardMaterial({ map });
  const model = new Mesh(new PlaneGeometry(), [source]); root.add(model);
  const prepare = () => gate.hold(source, onRemove => previewTerrainTile(model, source, {
    patchBend: applyBendFade, daylight: () => 0, onRemove,
  }));
  let disposed = 0;
  map.addEventListener('dispose', () => disposed++);
  prepare(); prepare(); assert.equal(gate.state.previews, 1);
  model.geometry.dispose(); model.geometry = new PlaneGeometry();
  assert.equal(gate.state.previews, 0); assert.equal(model.children.length, 0);
  prepare(); assert.equal(model.children[0].geometry, model.geometry);
  model.removeFromParent();
  assert.equal(gate.state.previews, 0); assert.equal(model.children.length, 0);
  assert.equal(disposed, 0);
  source.dispose(); assert.equal(gate.state.held, 0);
  map.dispose(); model.geometry.dispose(); gate.dispose();
});

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
  gate.dispose();
  assert.equal(visible.visible, true); assert.equal(hidden.visible, false); assert.equal(gate.state.held, 0);
  assert.equal(criticalTerrainReady(gate.state), false, 'Disposal is not proof of a completed program');
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

await check('reduced entry and time caps never publish a pending program, even after the curtain lifts', async () => {
  for (const reason of ['explicit-reduced', 'time-cap']) {
    const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(), driver = deferred(); gate.hold(m);
    step(gate, () => driver.promise); gate.bypass(reason);
    assert.equal(m.visible, false); assert.equal((await gate.wait()).reason, reason);
    assert.equal(criticalTerrainReady(gate.state), false, 'A cap is not proof of readiness');
    const later = new MeshStandardMaterial(); gate.hold(later);
    for (let i = 0; i < 20; i++) step(gate, () => assert.fail('pending key must not redispatch'), { covered: false });
    assert.equal(m.visible, false); assert.equal(later.visible, false);
    driver.resolve(); await driver.promise; await Promise.resolve();
    assert.equal(gate.state.status, 'bypassed', 'Completion must still wait for a matching frame');
    step(gate, () => assert.fail('must not redispatch'), { covered: false });
    assert.equal(gate.state.status, 'ready'); assert.equal(gate.state.bypassReason, reason);
    assert.equal(m.visible, true); assert.equal(later.visible, true);
    assert.ok(gate.state.readyAt != null); assert.equal(criticalTerrainReady(gate.state), true); m.dispose(); later.dispose();
  }
});

await check('uncovered flight still dispatches readiness work and distinguishes a content fallback from shader completion', async () => {
  assert.equal(terrainArrivalCovered({}, { pct: 100 }, 'playing'), false);
  assert.equal(terrainArrivalCovered({}, { pct: 10 }, 'playing'), true);
  assert.equal(terrainArrivalCovered({ worldLoading: true }, { pct: 100 }, 'playing'), true);
  assert.equal(terrainArrivalCovered({}, null, 'boot'), true);
  assert.equal(terrainArrivalCovered({}, { pct: 100 }, 'boot'), false);
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(); gate.hold(m);
  const driver = deferred(); let dispatches = 0;
  step(gate, () => { dispatches++; return driver.promise; }, { covered: false });
  assert.equal(m.visible, false); assert.equal(gate.state.status, 'compiling'); assert.equal(dispatches, 1);
  assert.equal(gate.state.bypassReason, 'arrival-already-revealed');
  const rt = { prewarm: { done: true }, criticalTerrain: gate.state };
  assert.equal(worldReadiness(rt).parts.shaders, false);
  rt.criticalTerrain = { required: true, status: 'ready' }; assert.equal(worldReadiness(rt).parts.shaders, true);
  rt.criticalTerrain = { required: false, status: 'unsupported' }; assert.equal(worldReadiness(rt).parts.shaders, true);
  rt.prewarm.done = false; assert.equal(worldReadiness(rt).parts.shaders, false);
  driver.resolve(); await driver.promise; await Promise.resolve(); step(gate, () => assert.fail('already ready'), { covered: false });
  assert.equal(m.visible, true); m.dispose();
});

await check('a dispatch failing after a reduced entry cannot leave terrain hidden forever', async () => {
  const gate = createCriticalTerrainGate(), m = new MeshStandardMaterial(), driver = deferred();
  gate.hold(m); step(gate, () => driver.promise); gate.bypass('time-cap'); assert.equal(m.visible, false);
  driver.reject(Error('link failed')); await Promise.resolve(); await Promise.resolve();
  assert.equal(gate.state.status, 'failed'); assert.equal(m.visible, true); m.dispose();
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
  assert.match(component, /terrainGate: \(\) => runtime\.terrainPrewarm/);
  assert.match(warm, /compileCinemaProfiles\(\{ gl, camera, scene, createWarmScene,/);
  assert.match(warm, /currentProgram\?\.cacheKey/);
  assert.match(warm, /return await cache\.retain\(key, job\)/);
  for (const file of ['components/fly/hud/BootScreen.jsx', 'components/fly/hud/WarpFlash.jsx']) {
    const source = read(file), bypass = source.indexOf('terrainPrewarm?.bypass(');
    assert.ok(bypass >= 0 && source.indexOf('rt.worldLoading=false', bypass) > bypass, file);
    assert.match(source, /loungeRoom\?\.bypassWarm\?\.\(reason\)/);
  }
});
// Exercise the actual production dispatch function without importing its
// unrelated React postprocessing inventory into Node. Only renderer services
// are injected; this is the source function, not a reimplementation.
const warmSource = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
await check('boot dispatches measured world after terrain submission and fences generic warm past a curtain timeout', async () => {
  const terrain = createCriticalTerrainGate(), driver = deferred(), measured = deferred(), events = [];
  const state = { worldProfiles: {} };
  const start = warmSource.indexOf('export async function runPrewarm(');
  const end = warmSource.indexOf('\n/**', start);
  const deps = {
    PREWARM: { enabled: true }, _state: state, settleOn: () => false, cinemaOn: () => true,
    warmMeasuredWorld() { events.push('measured'); return measured.promise; },
    buildWarmScene() { events.push('generic'); return {}; }, _keep: { materials: [] },
    compileUnder: () => Promise.resolve(), dummyRT: () => ({}), shipPassOn: () => false,
    drain: () => Promise.resolve(), queueAltShadowWarm() {}, publishPrewarmStats() {},
  };
  const run = Function(...Object.keys(deps),
    warmSource.slice(start, end).replace('export ', '') + '\nreturn runPrewarm;')(...Object.values(deps));
  const warm = run({ terrainGate: () => terrain });
  await Promise.resolve();
  assert.deepEqual(events, []);
  step(terrain, () => { events.push('terrain'); return driver.promise; });
  await Promise.resolve();
  assert.deepEqual(events, ['terrain', 'measured']);
  assert.equal(terrain.state.compiledAt, null);
  measured.resolve(); terrain.bypass('time-cap');
  await terrain.wait(); await Promise.resolve();
  assert.deepEqual(events, ['terrain', 'measured']);
  driver.resolve(); await driver.promise; await Promise.resolve();
  assert.deepEqual(events, ['terrain', 'measured'], 'Wait for a matching frame before sharing terrain keys');
  step(terrain, () => assert.fail('Already submitted'), { covered: false });
  await warm;
  assert.deepEqual(events, ['terrain', 'measured', 'generic']);
  assert.equal(state.done, true);
});
const dispatchStart = warmSource.indexOf('export async function compileCriticalTerrain(');
const dispatchEnd = warmSource.indexOf('\n/**', dispatchStart);
const underStart = warmSource.indexOf('function compileUnder('), underEnd = warmSource.indexOf('\nfunction dummyRT', underStart);
function terrainDispatcher() {
  const dependencies = { criticalTerrainByRenderer: new WeakMap(), createTerrainProgramRetention, Scene, compileSceneAsync,
    cinemaOn: () => false, dummyRT: () => ({}),
    addTerrainWarmMeshes(owner) {
      const material = new MeshStandardMaterial({ map: new Texture() });
      owner.add(new Mesh(new BufferGeometry(), material));
    },
  };
  return Function(...Object.keys(dependencies), warmSource.slice(underStart, underEnd) + '\n' +
    warmSource.slice(dispatchStart, dispatchEnd).replace('export ', '') + '\nreturn compileCriticalTerrain;')(...Object.values(dependencies));
}
function faultRenderer({ keyFault = false, restoreFault = false } = {}) {
  const properties = new WeakMap(); let reads = 0, target = null;
  const gl = { ready: false, calls: 0, disposed: 0, domElement: new EventTarget(),
    extensions: { has: () => true }, getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target, setRenderTarget(next) { target = next; if (restoreFault && next === null) throw Error('restore fault'); },
    properties: { get(material) { if (keyFault && ++reads > 1) throw Error('identity fault'); return properties.get(material); } },
    compile(owner) {
      this.calls++; const materials = new Set();
      owner.traverse(object => { if (!object.material) return;
        object.material.addEventListener('dispose', () => { this.disposed++; });
        properties.set(object.material, { currentProgram: { cacheKey: 'exact-critical-key', isReady: () => this.ready } });
        materials.add(object.material);
      }); return materials;
    },
    compileAsync() { throw Error('Unsafe native polling must not run'); },
  };
  return gl;
}
await check('non-cinematic terrain dispatch stays synchronous and uses cancellable captured-program polling', async () => {
  const compile = terrainDispatcher(), gl = faultRenderer();
  const work = compile({ gl, camera: {}, scene: new Scene() });
  assert.equal(gl.calls, 1); assert.equal(gl.disposed, 0);
  const rejected = assert.rejects(work, /context lost/i);
  gl.domElement.dispatchEvent(new Event('webglcontextlost')); await rejected;
  assert.equal(gl.disposed, 1);
});
for (const [label, options, onProfiles, expected] of [
  ['identity inspection', { keyFault: true }, null, /identity fault/],
  ['renderer restoration', { restoreFault: true }, null, /restore fault/],
  ['profile notification', {}, () => { throw Error('notification fault'); }, /notification fault/],
]) await check(`${label} failure cannot dispose a pending critical program`, async () => {
  const compile = terrainDispatcher(), gl = faultRenderer(options);
  const work = compile({ gl, camera: {}, scene: new Scene(), onProfiles });
  const rejected = assert.rejects(work, expected);
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(gl.disposed, 0);
  gl.ready = true; await rejected; assert.equal(gl.disposed, 1);
});
console.log(`CRITICAL TERRAIN PREWARM: ${count}/${count}`);

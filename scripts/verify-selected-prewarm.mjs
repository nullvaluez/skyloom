import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { createComposerPreflight } from '../lib/fly/composer-preflight.js';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const { resolveCinemaProfile } = await import('../lib/fly/cinema-profile.js');
const ref = process.argv.find(arg => arg.startsWith('--ref='))?.slice(6);
const source = ref ? execFileSync('git', ['show', `${ref}:lib/fly/prewarm.js`], { encoding: 'utf8' })
  : fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
function declaration(text, name, optional = false) {
  const ast = ts.createSourceFile('source.js', text, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node && optional) return '';
  assert.ok(node, `Missing production function ${name}`);
  return node.getText(ast).replace(/^export /, '');
}
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
function scheduler(preset = 'ultra') {
  const store = { qualityPreset: preset, qualityTier: preset === 'ultra' ? 'high' : preset, mapStyle: 'satellite', visuals: 'enhanced' };
  const calls = [], pending = [], state = { started: false, done: false }, keep = { materials: [], scene: null };
  const scene = new THREE.Scene(); scene.environment = {};
  const gl = { getContext: () => ({ getContextAttributes: () => ({ alpha: false }) }),
    getDrawingBufferSize: () => ({ width: 100, height: 100 }),
    compileAsync: async () => { calls.push(['current-materials']); }, shadowMap: { enabled: preset !== 'low' } };
  const context = {
    _pending: pending, _slice: { queued: 0 }, _state: state, _keep: keep,
    PREWARM: { enabled: true, maxMs: 1, warmAtlases: false, warmExtra: true, warmSmaaLuts: true, warmEffectsAltTier: true, warmAltStyle: false },
    performance, settleOn: () => true, cinemaOn: () => true, useFlyStore: { getState: () => store },
    cinemaProfile: () => resolveCinemaProfile({ preset: store.qualityPreset, tier: store.qualityTier }),
    reachableCinemaCascades: () => [0, 1, 2, 3], isMobileGraphicsClass: () => false,
    warmMeasuredWorld: async () => calls.push(['world', context.cinemaProfile().cascades]),
    warmMeasuredWorldProfiles: async ({ cascadeCounts }) => calls.push(['unused-world', ...cascadeCounts]),
    compileCriticalTerrain: async ({ cascadeCounts }) => calls.push(['unused-terrain', ...cascadeCounts]),
    buildWarmScene: () => new THREE.Scene(), buildExtraScene: () => new THREE.Scene(),
    compileUnder: (_, __, fn) => fn(), dummyRT: () => null, Vector2: THREE.Vector2,
    warmCinematicVariants: async () => calls.push(['opposite-shadow']),
    warmTroikaLetters: async () => calls.push(['letters']), warmShadowDepth: async () => calls.push(['shadow-depth']),
    warmSmaaLuts: async () => calls.push(['smaa']),
    warmPassGroup: async (_, __, style, tier) => calls.push(['passes', style, tier]),
    R25_SKY: { enabled: true }, aerialR25Wanted: () => true, visualsPinned: () => null,
    warmR25SkyAlternate: async () => calls.push(['other-visuals']), shipPassOn: () => true,
    queueRegistryWarm: ({ tiers, reason }) => calls.push(['registry', reason, ...(tiers ?? [store.qualityTier])]),
    queueAltShadowWarm: () => {}, publishPrewarmStats() {},
    // Capture everything queued before AND after the boot drain. Running these
    // units below models idle time and exposes the historical post-launch tail.
    drain: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(['warmSelectionKey', 'enqueue', 'runPrewarm'].map(name => declaration(source, name, name === 'warmSelectionKey')).join('\n'), context);
  return { store, calls, pending, context,
    boot: () => context.runPrewarm({ gl, camera: {}, scene, style: store.mapStyle, tier: store.qualityTier,
      beforeWarm: async () => calls.push(['critical-terrain', context.cinemaProfile().cascades]) }),
    drain: async () => { while (pending.length) await pending.shift().fn(); },
  };
}
await check('the explicit alternate-style experiment keeps the selected tier', async () => {
  const f = scheduler(); f.context.PREWARM.warmAltStyle = true;
  await f.boot(); await f.drain();
  assert.deepEqual(f.calls.filter(call => call[0] === 'passes'), [['passes', 'satellite', 'high'], ['passes', 'toy', 'high']]);
});
for (const [preset, cascades] of [['ultra', 3], ['high', 2], ['medium', 1], ['low', 0]]) {
  await check(`${preset} boot and idle prepare only the selected profile/settings`, async () => {
    const f = scheduler(preset); await f.boot(); await f.drain();
    assert.equal(f.context._state.error ?? null, null, 'Boot did not swallow a warm failure');
    assert.deepEqual(f.calls.filter(call => ['critical-terrain', 'world'].includes(call[0])), [['critical-terrain', cascades], ['world', cascades]]);
    assert.equal(f.calls.some(call => ['unused-world', 'unused-terrain', 'other-visuals', 'opposite-shadow', 'other-shadow-state'].includes(call[0])), false, JSON.stringify(f.calls));
    assert.deepEqual(f.calls.filter(call => call[0] === 'passes'), [['passes', 'satellite', f.store.qualityTier]]);
    assert.equal(f.calls.some(call => call[0] === 'registry' && call[1] === 'ladder'), false);
    assert.ok(f.calls.some(call => call[0] === 'current-materials'), 'Current world materials must remain prepared');
    if (cascades === 0) assert.equal(f.calls.some(call => call[0] === 'shadow-depth'), false, 'CSM0 does not prepare unused depth programs');
  });
}
await check('queued work for an abandoned selection never dispatches', async () => {
  const f = scheduler(); let ran = 0, skipped = 0;
  f.context.enqueue('selected', () => ran++, { onSkip: () => skipped++ });
  f.store.qualityPreset = 'medium'; f.store.qualityTier = 'medium';
  await f.drain(); assert.equal(ran, 0); assert.equal(skipped, 1);
  f.context.enqueue('selected-current', () => ran++); await f.drain(); assert.equal(ran, 1);
});
await check('alternate shadow work remains disabled by default and honors the explicit review opt-in', () => {
  const f = scheduler(), sourceScene = new THREE.Scene(), jobs = [];
  const light = new THREE.DirectionalLight(); light.castShadow = true; sourceScene.add(light);
  Object.assign(f.context, {
    Scene: THREE.Scene, ENV_UNIFORM: { enabled: false, warmBothShadowStates: true }, _altShadowRuns: 0,
    pushWarmJob: (_, __, target, tag) => { jobs.push({ target, tag }); return true; },
  });
  vm.runInContext(declaration(source, 'queueAltShadowWarm'), f.context);
  const request = () => f.context.queueAltShadowWarm({ gl: {}, camera: {}, scene: sourceScene });
  assert.equal(request(), false); assert.equal(jobs.length, 0);
  f.context.ENV_UNIFORM.enabled = true; f.context.ENV_UNIFORM.warmBothShadowStates = false;
  assert.equal(request(), false); assert.equal(jobs.length, 0);
  f.context.ENV_UNIFORM.warmBothShadowStates = true;
  assert.equal(request(), true); assert.equal(jobs[0].tag, 'alt-shadow');
  assert.equal(jobs[0].target.children[0].castShadow, false); assert.equal(light.castShadow, true);
  assert.equal(request(), true); assert.equal(request(), false); assert.equal(jobs.length, 2, 'Opt-in remains bounded');
});
await check('registry rejects standby tiers and releases abandoned work for a later actual selection', async () => {
  const f = scheduler(), registry = { queued: 0 }, warmed = [], retained = new Set();
  Object.assign(f.context, {
    _registryQueued: new Set(), registryWarmState: () => registry,
    registryContext: value => value,
    compileSignature: ctx => `${ctx.preset}/${ctx.tier}`,
    pendingRegistryEntries: (_, sig) => retained.has(sig) ? [] : [{ key: 'selected-content' }],
    warmRegistryEntry: async (_, { sig }) => { warmed.push(sig); retained.add(sig); },
  });
  vm.runInContext(declaration(source, 'queueRegistryWarm'), f.context);
  const request = extra => f.context.queueRegistryWarm({ gl: {}, camera: {}, scene: {}, ...extra });
  assert.equal(request({ tiers: ['medium', 'low'] }), 0, 'Do not enqueue unselected lower tiers');
  assert.equal(request({ preset: 'high' }), 0, 'Do not enqueue an unselected preset sharing the high tier');
  assert.equal(request({}), 1); assert.equal(request({}), 0, 'Deduplicate the current pending key');
  assert.equal(registry.queued, 1);
  f.store.qualityPreset = 'medium'; f.store.qualityTier = 'medium';
  await f.drain(); assert.deepEqual(warmed, []); assert.equal(registry.queued, 0);
  assert.equal(request({}), 1); await f.drain();
  assert.deepEqual(warmed, ['medium/medium']); assert.equal(registry.queued, 0);
  f.store.qualityPreset = 'ultra'; f.store.qualityTier = 'high';
  assert.equal(request({}), 1, 'An abandoned Ultra request must not block a later real Ultra selection');
  await f.drain(); assert.deepEqual(warmed, ['medium/medium', 'ultra/high']);
  assert.equal(request({}), 0); assert.equal(registry.queued, 0);
});

// Exercise the real live preparation gate already used for actual changes.
// It must wait for the requested light/post keys without requiring speculative
// compilation of all lower tiers at boot.
const fixtureSource = fs.readFileSync(new URL('./verify-composer-preflight.mjs', import.meta.url), 'utf8');
const makeFixture = Function(...Object.keys(THREE), 'createComposerPreflight', declaration(fixtureSource, 'fixture') + ';return fixture;')(...Object.values(THREE), createComposerPreflight);
await check('actual Ultra → High → Medium → Low/CSM0 changes wait only for current live keys', () => {
  const f = makeFixture();
  f.scene.remove(f.light); let lights = [];
  for (const preset of ['ultra', 'high', 'medium', 'low']) {
    const profile = resolveCinemaProfile({ preset, tier: preset === 'ultra' ? 'high' : preset });
    for (const light of lights) f.scene.remove(light);
    lights = Array.from({ length: profile.cascades }, () => { const light = new THREE.DirectionalLight(); light.castShadow = true; f.scene.add(light); return light; });
    f.gl.shadowMap.enabled = profile.cascades > 0;
    f.gl.ready = false; const before = f.gl.calls.length;
    assert.equal(f.warm.prepare(), false, `${preset} must wait for pending selected links`);
    const colors = f.gl.calls.slice(before).find(call => call.objects.some(object => object.material === f.material));
    let count = 0; colors.world.traverseVisible(object => { if (object.isLight) count++; });
    assert.equal(count, profile.cascades);
    const dispatched = f.gl.calls.length;
    assert.equal(f.warm.prepare(), false); assert.equal(f.gl.calls.length, dispatched, 'Do not redispatch pending keys');
    f.gl.ready = true; assert.equal(f.warm.prepare(), true); f.warm.didRender();
    assert.equal(f.warm.prepare(), true); assert.equal(f.gl.calls.length, dispatched, 'No standby work after selected keys finish');
  }
  f.dispose();
});
console.log(`SELECTED PREWARM: ${passed} passed / ${failed} failed${ref ? ` (source ${ref})` : ''}`);
if (failed) process.exitCode = 1;

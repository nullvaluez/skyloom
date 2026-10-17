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
const { Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Texture, FogExp2, CubeUVReflectionMapping, SRGBColorSpace, NoToneMapping, ShaderLib, UniformsUtils } = await import('three');
const { WebGLPrograms } = await import('three/src/renderers/webgl/WebGLPrograms.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { createMeasuredWorldWarmScene, warmMeasuredWorldProfiles, MEASURED_WORLD_VARIANTS } = await import('../lib/fly/measured-world-prewarm.js');
const { reachableCinemaCascades } = await import('../lib/fly/cinema-profile-prewarm.js');
const { worldReadiness, retryWorldContent } = await import('../lib/fly/world-readiness.js');
useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityPreset: 'high', qualityTier: 'high' });
const evidence = JSON.parse(fs.readFileSync(new URL('./fixtures/measured-world-profile-keys.json', import.meta.url)));
const camera = new PerspectiveCamera(60, 16 / 9, .08, 20000), scene = new Scene();
scene.environment = new Texture({ height: 1024 }); scene.environment.mapping = CubeUVReflectionMapping;
scene.fog = new FogExp2(); scene.add(new DirectionalLight(), new HemisphereLight());
let count = 0;
const check = async (name, run) => { await run(); count++; console.log('PASS ' + name); };
function renderer({ parallel = true, ready = true } = {}) {
  let target = null;
  const properties = new WeakMap(), records = [], canvas = new EventTarget();
  const gl = { domElement: canvas, shadowMap: { enabled: true, type: 1 }, outputColorSpace: SRGBColorSpace, toneMapping: NoToneMapping,
    state: { buffers: { depth: { getReversed: () => true } } },
    getRenderTarget: () => target, setRenderTarget: next => { target = next; },
    extensions: { has: name => name === 'KHR_parallel_shader_compile' ? parallel : name === 'WEBGL_multi_draw' },
    getContext: () => ({ isContextLost: () => false }),
    properties: { get(material) { let entry = properties.get(material); if (!entry) { entry = {}; properties.set(material, entry); } return entry; } },
    records, ready, disposed: 0,
    compile(owner, cam, targetScene) {
      const lights = { directional: [], point: [], spot: [], spotLightMap: [], rectArea: [], hemi: [], directionalShadowMap: [], pointShadowMap: [], spotShadowMap: [], numSpotLightShadowsWithMaps: 0, numLightProbes: 0 };
      targetScene.traverse(object => { if (object.isDirectionalLight) { lights.directional.push(object); if (object.castShadow) lights.directionalShadowMap.push(object); } if (object.isHemisphereLight) lights.hemi.push(object); });
      const materials = new Set();
      owner.traverse(object => {
        if (!object.material) return;
        const material = object.material, params = programs.getParameters(material, lights, lights.directionalShadowMap, targetScene, object, []);
        const key = programs.getProgramCacheKey(params);
        const lib = material.isMeshPhysicalMaterial ? ShaderLib.physical : ShaderLib.standard;
        const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: UniformsUtils.clone(lib.uniforms) };
        material.onBeforeCompile(shader, gl);
        this.properties.get(material).currentProgram = { cacheKey: key, isReady: () => this.ready };
        material.addEventListener('dispose', () => { this.disposed++; });
        records.push({ name: object.name, key, shader, material, object }); materials.add(material);
      });
      return materials;
    },
    compileAsync(owner, cam, targetScene) { this.compile(owner, cam, targetScene); return Promise.resolve(owner); },
  };
  const programs = WebGLPrograms(gl, { get: value => value }, gl.extensions, { precision: 'highp', logarithmicDepthBuffer: false, getMaxPrecision: value => value }, {}, { numPlanes: 0, numIntersection: 0 });
  return gl;
}
await check('inventory contains only the 19 measured color variants and tiny attribute layouts', () => {
  const owner = createMeasuredWorldWarmScene();
  assert.deepEqual(owner.scene.children.map(mesh => mesh.name), MEASURED_WORLD_VARIANTS);
  for (const mesh of owner.scene.children) { assert.equal(mesh.geometry.attributes.position.count, 3); assert.equal(mesh.customDepthMaterial, undefined); }
  owner.dispose(); owner.dispose();
});
await check('all 38 captured medium/low driver program keys match the new inventory exactly', async () => {
  const gl = renderer(); await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1] });
  assert.equal(evidence.entries.length, 38); assert.equal(gl.records.length, 38);
  const actual = new Set(gl.records.map(record => record.key));
  for (const row of evidence.entries) {
    if (!actual.has(row.cacheKey)) {
      const custom = row.cacheKey.split(',').at(-1);
      const matching = gl.records.filter(record => record.key.split(',').at(-1) === custom);
      assert.fail(`Program ${row.program} absent:\nExpected ${row.cacheKey}\nClosest ${matching.map(record => record.key).join('\n')}`);
    }
  }
});
await check('only reachable profiles dispatch, with explicit retained key and timing diagnostics', async () => {
  const gl = renderer(), state = {};
  await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: reachableCinemaCascades(), state });
  assert.equal(gl.records.length, 57); assert.equal(state.status, 'ready'); assert.equal(state.identityVerified, true);
  assert.equal(state.programKeys, 57); assert.ok(state.ms >= 0); assert.ok(state.readyAt >= state.startedAt);
  assert.deepEqual(reachableCinemaCascades({ preset: 'ultra' }), [0, 1, 2, 3]);
  assert.deepEqual(reachableCinemaCascades({ preset: 'ultra', phone: true }), [0, 1]);
});
await check('unsupported parallel compilation adds no world programs and reports the reason', async () => {
  const gl = renderer({ parallel: false }), state = {};
  await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state });
  assert.equal(state.status, 'unsupported'); assert.equal(state.required, false); assert.match(state.reason, /KHR/); assert.equal(gl.records.length, 0);
});
await check('duplicate arrivals retain the original program owners and dispose only completed twins', async () => {
  const gl = renderer();
  for (let i = 0; i < 10; i++) await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2] });
  assert.equal(gl.disposed, 57 * 9);
  gl.domElement.dispatchEvent(new Event('webglcontextlost')); assert.equal(gl.disposed, 57 * 10);
});
await check('distinct environment keys stay bounded to four completed profile sets', async () => {
  const gl = renderer(), state = {}, original = scene.environment.image.height;
  for (let i = 0; i < 7; i++) { scene.environment.image.height = 64 * 2 ** i; await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state }); }
  scene.environment.image.height = original;
  assert.equal(state.retainedSets, 4); assert.equal(gl.disposed, 57 * 3);
  gl.domElement.dispatchEvent(new Event('webglcontextlost')); assert.equal(gl.disposed, 57 * 7);
});
await check('dispatch failure is explicit and every partially created owner is released', async () => {
  const gl = renderer(), state = {};
  const compile = gl.compile.bind(gl); gl.compile = (...args) => { compile(...args); throw Error('driver failure'); };
  await assert.rejects(warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state }), /driver failure/);
  assert.equal(state.status, 'failed'); assert.match(state.error, /driver failure/); assert.equal(gl.disposed, gl.records.length);
});
await check('pending driver programs remain owned until all profiles finish polling', async () => {
  const gl = renderer({ ready: false }), state = {};
  const waiting = warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(state.status, 'compiling'); assert.equal(gl.disposed, 0);
  gl.ready = true; await waiting;
  assert.equal(state.status, 'ready'); assert.equal(gl.disposed, 0);
  gl.domElement.dispatchEvent(new Event('webglcontextlost')); assert.equal(gl.disposed, 57);
});
await check('context loss cancels pending profiles and recovered context cannot reuse their owners', async () => {
  const gl = renderer({ ready: false }), state = {};
  const waiting = warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state });
  const rejected = assert.rejects(waiting, /context lost/i);
  gl.domElement.dispatchEvent(new Event('webglcontextlost')); await rejected;
  assert.equal(state.status, 'invalidated'); assert.equal(state.reason, 'context-lost'); assert.equal(gl.disposed, 57);
  gl.ready = true; await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state });
  assert.equal(state.status, 'ready'); assert.equal(state.retainedSets, 1); assert.equal(gl.disposed, 57);
  gl.domElement.dispatchEvent(new Event('webglcontextrestored')); assert.equal(gl.disposed, 114);
  assert.equal(state.status, 'invalidated'); assert.equal(state.readyAt, null);
});
await check('general warm awaits measured profiles before done and keeps depth/effects paths', () => {
  const source = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
  const entry = source.indexOf('export async function runPrewarm');
  assert.ok(source.indexOf('await warmMeasuredWorld(gl, camera, scene)', entry) < source.indexOf('_state.done = true', entry));
  assert.match(source, /enqueue\('shadow-depth', \(\) => warmShadowDepth\(gl, camera, warmScene\)\)/);
  assert.match(source, /warmPassGroup\(gl, camera, st, t, alpha, size\)/);
});
await check('a completed general queue cannot certify failed or bypassed required profiles', () => {
  let retries = 0;
  const rt = { prewarm: { done: true, worldProfiles: { required: true, status: 'failed' }, retryWorldProfiles: () => { retries++; } } };
  for (const status of ['waiting', 'compiling', 'failed', 'bypassed', 'invalidated']) {
    rt.prewarm.worldProfiles.status = status; assert.equal(worldReadiness(rt).parts.shaders, false);
  }
  retryWorldContent(rt); assert.equal(retries, 1);
  rt.prewarm.worldProfiles.status = 'ready'; assert.equal(worldReadiness(rt).parts.shaders, true);
  Object.assign(rt.prewarm.worldProfiles, { required: false, status: 'unsupported' }); assert.equal(worldReadiness(rt).parts.shaders, true);
  rt.prewarm.worldProfiles.status = 'not-required'; assert.equal(worldReadiness(rt).parts.shaders, true);
  delete rt.prewarm.worldProfiles; assert.equal(worldReadiness(rt).parts.shaders, true);
});
await check('explicit reduced entry stays usable, records bypass, and late completion restores truthful readiness', async () => {
  const source = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
  const begin = source.indexOf('const _state = {'), end = source.indexOf('\n};', begin) + 3;
  const state = Function('performance', source.slice(begin, end) + ';return _state;')(performance);
  const rt = { prewarm: state }; state.done = true;
  const gl = renderer({ ready: false });
  const waiting = warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state: state.worldProfiles });
  assert.equal(state.bypassWorldProfiles('explicit-reduced'), true);
  assert.equal(state.worldProfiles.status, 'bypassed'); assert.equal(worldReadiness(rt).parts.shaders, false);
  gl.ready = true; await waiting;
  assert.equal(state.worldProfiles.status, 'ready'); assert.equal(state.worldProfiles.bypassReason, 'explicit-reduced');
  assert.equal(worldReadiness(rt).parts.shaders, true);
  for (const path of ['components/fly/hud/BootScreen.jsx', 'components/fly/hud/WarpFlash.jsx']) {
    const ui = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const bypass = ui.indexOf('prewarm?.bypassWorldProfiles?.(reason)');
    assert.ok(bypass >= 0 && ui.indexOf('rt.worldLoading=false', bypass) > bypass);
  }
});
await check('production retry re-arms only the failed world batch and cannot duplicate a bypassed pending job', async () => {
  const source = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
  const stateStart = source.indexOf('const _state = {'), stateEnd = source.indexOf('\n};', stateStart) + 3;
  const retryStart = source.indexOf('let worldWarmPending = null;'), retryEnd = source.indexOf('\n/**', retryStart);
  const { state, warm } = Function('warmMeasuredWorldProfiles', 'reachableCinemaCascades', 'useFlyStore', 'isMobileGraphicsClass',
    source.slice(stateStart, stateEnd) + '\n' + source.slice(retryStart, retryEnd) + '\nreturn {state:_state,warm:warmMeasuredWorld};')(
    warmMeasuredWorldProfiles, reachableCinemaCascades, useFlyStore, () => false);
  const gl = renderer(), compile = gl.compile.bind(gl);
  gl.compile = (...args) => { compile(...args); throw Error('retryable driver failure'); };
  await assert.rejects(warm(gl, camera, scene), /retryable/);
  assert.equal(state.worldProfiles.status, 'failed');
  gl.compile = compile; gl.ready = false;
  assert.equal(state.retryWorldProfiles(), true);
  assert.equal(state.worldProfiles.status, 'compiling');
  const dispatches = gl.records.length;
  state.bypassWorldProfiles('explicit-reduced');
  assert.equal(state.retryWorldProfiles(), false); assert.equal(gl.records.length, dispatches);
  gl.ready = true;
  for (let i = 0; i < 30 && state.worldProfiles.status !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.worldProfiles.status, 'ready'); assert.equal(state.retryWorldProfiles(), false);
});
await check('completed context readiness invalidates immediately and the recovery frame dispatches one fresh batch', async () => {
  const source = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
  const stateStart = source.indexOf('const _state = {'), stateEnd = source.indexOf('\n};', stateStart) + 3;
  const retryStart = source.indexOf('let worldWarmPending = null;'), retryEnd = source.indexOf('\n/**', retryStart);
  const { state, warm } = Function('warmMeasuredWorldProfiles', 'reachableCinemaCascades', 'useFlyStore', 'isMobileGraphicsClass',
    source.slice(stateStart, stateEnd) + '\n' + source.slice(retryStart, retryEnd) + '\nreturn {state:_state,warm:warmMeasuredWorld};')(
    warmMeasuredWorldProfiles, reachableCinemaCascades, useFlyStore, () => false);
  const rigSource = fs.readFileSync(new URL('../components/fly/PrewarmRig.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = rigSource.indexOf('    const store = useFlyStore.getState();\n    const worldProfiles');
  const end = rigSource.indexOf('    const gate = runtime?.terrainPrewarm;', start);
  assert.ok(start >= 0 && end > start, 'Exercise the actual recovery callback source');
  const recover = Function('runtime', 'gl', 'scene', 'useFlyStore', 'cinemaOn', rigSource.slice(start, end));
  const gl = renderer(), rt = { prewarm: state, cinemaShadows: { cascades: 2 }, contextLost: false };
  state.done = true; await warm(gl, camera, scene); assert.equal(worldReadiness(rt).parts.shaders, true);
  rt.contextLost = true; gl.domElement.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(state.worldProfiles.status, 'invalidated'); assert.equal(worldReadiness(rt).parts.shaders, false);
  gl.domElement.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(worldReadiness(rt).parts.shaders, false);
  const originalEnv = scene.environment; scene.environment = null; rt.contextLost = false;
  recover(rt, gl, scene, useFlyStore, () => true); assert.equal(gl.records.length, 57);
  scene.environment = originalEnv; gl.ready = false;
  recover(rt, gl, scene, useFlyStore, () => true); assert.equal(gl.records.length, 114);
  recover(rt, gl, scene, useFlyStore, () => true); assert.equal(gl.records.length, 114);
  assert.equal(worldReadiness(rt).parts.shaders, false);
  gl.ready = true;
  for (let i = 0; i < 30 && state.worldProfiles.status !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(worldReadiness(rt).parts.shaders, true);
});
await check('a context lost between driver completion and publication cannot restore obsolete readiness', async () => {
  const gl = renderer(), state = {}, rt = { prewarm: { done: true, worldProfiles: state } };
  // Every driver program is already ready, but the promise chain has not yet
  // published completion when the renderer generation changes synchronously.
  const pending = warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0, 1, 2], state });
  gl.domElement.dispatchEvent(new Event('webglcontextlost'));
  gl.domElement.dispatchEvent(new Event('webglcontextrestored'));
  await pending;
  assert.equal(state.status, 'invalidated'); assert.equal(state.readyAt, null);
  assert.equal(worldReadiness(rt).parts.shaders, false); assert.equal(gl.disposed, 57);
});
scene.environment.dispose();
console.log(`MEASURED WORLD PREWARM: ${count}/${count}`);

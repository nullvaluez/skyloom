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
const { Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Mesh, BufferGeometry, Float32BufferAttribute, ShaderLib, UniformsUtils, Texture } = await import('three');
const { compileCinemaProfiles, reachableCinemaCascades } = await import('../lib/fly/cinema-profile-prewarm.js');
const { CinemaShadows } = await import('../lib/fly/cinema-shadows.js');
const { CINEMA_PROFILES } = await import('../lib/fly/cinema-profile.js');
const { createRoomMaterials, createRoomUniforms } = await import('../lib/fly/lounge/room-shading.js');
const { invalidateRoomProfiles, warmRoomProfiles } = await import('../lib/fly/lounge/room-prewarm.js');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let count = 0;
const check = async (name, run) => { await run(); count++; console.log('PASS ' + name); };
const camera = new PerspectiveCamera(60, 16 / 9, .08, 20000), scene = new Scene();
scene.add(new DirectionalLight(), new HemisphereLight()); scene.environment = new Texture();
const liveRig = new CinemaShadows(camera, scene, CINEMA_PROFILES.high);
const uniforms = createRoomUniforms(), originalTarget = {}, calls = [], waiting = [];
let target = originalTarget, disposed = 0;
const properties = new WeakMap();
const gl = { shadowMap: { enabled: false, type: 1 }, getRenderTarget: () => target, setRenderTarget: next => { target = next; },
  domElement: new EventTarget(), getContext: () => ({ isContextLost: () => false }), extensions: { has: () => true },
  properties: { get: material => properties.get(material) },
  compile(warmScene, cam, targetScene) {
    assert.notEqual(target, originalTarget); assert.equal(this.shadowMap.enabled, true); assert.equal(cam, camera);
    const wait = deferred(); let ready = false, failed;
    wait.promise.then(() => { ready = true; }, error => { failed = error; });
    waiting.push(wait); calls.push({ warmScene, targetScene });
    const materials = new Set(warmScene.children.map(mesh => mesh.material));
    for (const material of materials) properties.set(material, { currentProgram: { isReady() { if (failed) throw failed; return ready; } } });
    return materials;
  } };
const factory = () => {
  const materials = createRoomMaterials(uniforms, {}, 'pier'), warmScene = new Scene();
  for (const material of Object.values(materials)) warmScene.add(new Mesh(new BufferGeometry(), material));
  return { scene: warmScene, dispose() { disposed++; for (const m of warmScene.children) { m.material.dispose(); m.geometry.dispose(); } } };
};
const job = compileCinemaProfiles({ gl, camera, scene, createWarmScene: factory, cascadeCounts: [0, 1, 2] });
await check('dispatch restores renderer state and never changes live lights or rig ownership', () => {
  assert.equal(target, originalTarget); assert.equal(gl.shadowMap.enabled, false);
  assert.equal(calls.length, 3); assert.equal(scene.children.length, 6); assert.equal(liveRig.owned.size, 0);
  assert.equal(disposed, 0);
});
await check('each isolated target has the exact N+1 directional and N shadow counts', () => {
  for (const profile of job.profiles) {
    const lights = profile.targetScene.children.filter(object => object.isLight);
    assert.equal(lights.filter(light => light.isDirectionalLight).length, profile.cascades + 1);
    assert.equal(lights.filter(light => light.castShadow).length, profile.cascades);
    assert.equal(lights.filter(light => light.isHemisphereLight).length, 1);
    assert.equal(profile.targetScene.environment, scene.environment);
  }
});
await check('real material factory and CSM emit identical live/warm keys, defines and shader source for every count', () => {
  for (const profile of job.profiles) {
    const testScene = new Scene(), rig = profile.cascades ? new CinemaShadows(camera, testScene, [CINEMA_PROFILES.low, CINEMA_PROFILES.medium, CINEMA_PROFILES.high][profile.cascades]) : null;
    const materials = createRoomMaterials(uniforms, {}, 'pier');
    for (const material of Object.values(materials)) rig?.setupMaterial(material);
    for (const mesh of profile.scene.children) {
      const live = Object.values(materials).find(material => material.name === mesh.material.name), warm = mesh.material;
      assert.equal(live.customProgramCacheKey(), warm.customProgramCacheKey()); assert.deepEqual(live.defines, warm.defines);
      const lib = live.isMeshPhysicalMaterial ? ShaderLib.physical : live.isMeshStandardMaterial ? ShaderLib.standard : ShaderLib.basic;
      const source = () => ({ vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: UniformsUtils.clone(lib.uniforms) });
      const a = source(), b = source(); live.onBeforeCompile(a, {}); warm.onBeforeCompile(b, {});
      assert.equal(a.vertexShader, b.vertexShader); assert.equal(a.fragmentShader, b.fragmentShader);
    }
    rig?.dispose(); for (const material of Object.values(materials)) material.dispose();
  }
});
await check('completion retains material programs until the caller explicitly disposes the job', async () => {
  let ready = false; job.promise.then(() => { ready = true; });
  waiting[0].resolve(); waiting[1].resolve(); await Promise.resolve(); assert.equal(ready, false);
  waiting[2].resolve(); await job.promise; assert.equal(disposed, 0);
  job.dispose(); job.dispose(); assert.equal(disposed, 3);
});
await check('reachable keys respect desktop, phone and ultra ceilings', () => {
  assert.deepEqual(reachableCinemaCascades(), [0, 1, 2]);
  assert.deepEqual(reachableCinemaCascades({ preset: 'ultra' }), [0, 1, 2, 3]);
  assert.deepEqual(reachableCinemaCascades({ preset: 'ultra', phone: true }), [0, 1]);
});
await check('a rejected driver promise cannot dispose another still-pending profile', async () => {
  const fail = compileCinemaProfiles({ gl, camera, scene, createWarmScene: factory, cascadeCounts: [0, 1] });
  const rejected = assert.rejects(fail.promise, /driver failure/);
  waiting[3].reject(Error('driver failure')); await Promise.resolve(); assert.equal(disposed, 3);
  waiting[4].resolve(); await rejected; fail.dispose(); assert.equal(disposed, 5);
});
await check('revisiting a room reuses the retained job and only allocates three-vertex attribute twins', async () => {
  const materials = createRoomMaterials(uniforms, {}, 'pier');
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(900), 3));
  geometry.setAttribute('aSurf', new Float32BufferAttribute(new Float32Array(1200), 4));
  const mesh = new Mesh(geometry, materials.metal); mesh.name = 'lounge:metal';
  const resource = { materials, uniforms, meshes: [mesh] };
  const first = warmRoomProfiles({ gl, camera, scene, resource, variant: 'pier', cascadeCounts: [0, 1, 2] });
  const next = warmRoomProfiles({ gl, camera, scene, resource, variant: 'pier', cascadeCounts: [0, 1, 2] });
  assert.equal(first, next); assert.equal(waiting.length, 8);
  for (const profile of first.profiles) {
    const twin = profile.scene.children[0]; assert.equal(twin.geometry.attributes.position.count, 3); assert.equal(twin.geometry.attributes.aSurf.itemSize, 4);
  }
  waiting.slice(5).forEach(wait => wait.resolve()); await first.promise;
  // A recovered texture bake must not reuse the earlier no-map program set.
  materials.metal.map = new Texture();
  const textured = warmRoomProfiles({ gl, camera, scene, resource, variant: 'pier', cascadeCounts: [0, 1, 2] });
  assert.notEqual(textured, first); assert.equal(waiting.length, 11);
  waiting.slice(8).forEach(wait => wait.resolve()); await textured.promise;
  // No mounted AirportLounge listener exists in this test. The retained
  // renderer owner must notice loss/restoration between room visits itself.
  gl.domElement.dispatchEvent(new Event('webglcontextlost'));
  gl.domElement.dispatchEvent(new Event('webglcontextrestored'));
  await Promise.resolve();
  const restored = warmRoomProfiles({ gl, camera, scene, resource, variant: 'pier', cascadeCounts: [0, 1, 2] });
  assert.notEqual(restored, textured, 'A restored GL context must not reuse resolved shader evidence');
  waiting.slice(11).forEach(wait => wait.resolve()); await restored.promise;
  invalidateRoomProfiles(gl);
  materials.metal.map.dispose(); restored.dispose(); textured.dispose();
  geometry.dispose(); for (const material of Object.values(materials)) material.dispose(); first.dispose();
});
liveRig.dispose(); scene.environment.dispose(); uniforms.uLoungeFix.value.dispose();
console.log(`CINEMA PROFILE PREWARM: ${count}/${count}`);

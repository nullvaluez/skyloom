import assert from 'node:assert/strict';
import { BackSide, BoxGeometry, DirectionalLight, DoubleSide, Group, Mesh, MeshDepthMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, ShaderMaterial, Texture, WebGLRenderTarget } from 'three';
import { createComposerPreflight, shadowWarmMaterial } from '../lib/fly/composer-preflight.js';

function fixture(parallel = true) {
  const scene = new Scene(), camera = new PerspectiveCamera(), target = new WebGLRenderTarget(2, 2);
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial(), object = new Mesh(geometry, material);
  object.castShadow = true; scene.add(object);
  const light = new DirectionalLight(); light.castShadow = true; scene.add(light);
  const screen = new Scene(), quad = new Mesh(geometry, new ShaderMaterial()); screen.add(quad);
  const pass = { enabled: true, scene: screen, camera, fullscreenMaterial: quad.material, renderToScreen: true };
  const composer = { inputBuffer: target, passes: [pass] };
  let binding = null, properties = new WeakMap();
  const cache = new Map();
  const gl = {
    ready: false, calls: [], domElement: new EventTarget(), shadowMap: { enabled: true, type: 1 }, toneMapping: 0, outputColorSpace: 'srgb',
    extensions: { has: () => parallel }, getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => binding, setRenderTarget: value => { binding = value; }, properties: { get: m => properties.get(m) ?? {} },
    compile(holder, cam, world) {
      const materials = new Set(), objects = []; let lights = 0;
      world.traverseVisible(o => { if (o.isLight) lights++; });
      holder.traverse(o => {
        objects.push(o);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const key = [m.type, m.side, m.version, m.customProgramCacheKey(), !!o.isInstancedMesh, !!o.isSkinnedMesh, lights, !!world.fog, world.environment?.id, binding?.texture.colorSpace ?? 'screen'].join('/');
          if (!cache.has(key)) cache.set(key, { cacheKey: key, isReady: () => gl.ready, usedTimes: 1 });
          const program = cache.get(key), props = properties.get(m) ?? { programs: new Map() };
          props.programs.set(key, program); props.currentProgram = program; properties.set(m, props); materials.add(m);
        }
      });
      this.calls.push({ objects, world, target: binding }); return materials;
    },
    restore() { properties = new WeakMap(); cache.clear(); this.domElement.dispatchEvent(new Event('webglcontextrestored')); },
  };
  const warm = createComposerPreflight(gl, scene, camera, composer);
  return { scene, object, material, geometry, light, pass, composer, gl, warm,
    dispose() { warm.dispose(); geometry.dispose(); material.dispose(); quad.material.dispose(); target.dispose(); } };
}
let count = 0;
function check(name, run) { run(); console.log('PASS ' + name); count++; }

check('exact color/depth/post batches wait for links without rendering or reparenting', () => {
  const f = fixture(), parent = f.object.parent;
  assert.equal(f.warm.prepare(), false); assert.equal(f.warm.state.status, 'compiling');
  assert.equal(f.object.parent, parent); assert.equal(f.gl.getRenderTarget(), null);
  assert.equal(f.gl.calls.length, 4, 'Color, empty/lighted depth, and actual screen pass');
  assert.equal(f.gl.calls[0].objects[0].geometry, f.geometry);
  assert.equal(f.gl.calls[3].target, null, 'Screen encoding must use the default framebuffer');
  const calls = f.gl.calls.length;
  for (let i = 0; i < 10; i++) assert.equal(f.warm.prepare(), false);
  assert.equal(f.gl.calls.length, calls, 'Pending stable frames do not recompile');
  f.gl.ready = true; assert.equal(f.warm.prepare(), true);
  for (let i = 0; i < 10; i++) assert.equal(f.warm.prepare(), true);
  assert.equal(f.gl.calls.length, calls, 'Settled stable frames do not recompile'); f.dispose();
});

check('async additions compile only new renderables and removed objects are forgotten', () => {
  const f = fixture(); f.gl.ready = true; f.warm.prepare();
  const group = new Group(), next = new Mesh(f.geometry, new MeshStandardMaterial());
  next.material.customProgramCacheKey = () => 'new-async-variant'; group.add(next); f.scene.add(group);
  f.gl.ready = false; const start = f.gl.calls.length; assert.equal(f.warm.prepare(), false);
  assert.equal(f.gl.calls.length, start + 1); assert.equal(f.gl.calls.at(-1).objects.length, 1);
  assert.equal(Object.getPrototypeOf(f.gl.calls.at(-1).objects[0]), next);
  f.gl.ready = true; f.warm.prepare(); f.scene.remove(group); const end = f.gl.calls.length;
  next.material.needsUpdate = true; f.warm.prepare(); assert.equal(f.gl.calls.length, end);
  next.material.dispose(); f.dispose();
});

check('late shader links hold only affected renderables while completed world frames continue', () => {
  const f = fixture(); f.gl.ready = true; f.warm.prepare(); f.warm.didRender();
  const next = new Mesh(f.geometry, new MeshStandardMaterial());
  next.material.customProgramCacheKey = () => 'late-streamed-variant'; next.castShadow = true; f.scene.add(next);
  f.gl.ready = false;
  assert.equal(f.warm.prepare(), true, 'A completed world remains renderable during a new asset link');
  assert.equal(f.warm.state.heldObjects, 1); assert.equal(f.warm.state.status, 'streaming');
  assert.equal(f.warm.state.holdReason, 'local');
  const dispatches = f.gl.calls.length;
  for (let i = 0; i < 10; i++) {
    f.warm.beforeRender(); assert.equal(f.object.visible, true); assert.equal(next.visible, false);
    f.warm.didRender(); f.warm.afterRender(); assert.equal(next.visible, true);
    assert.equal(f.warm.prepare(), true);
  }
  assert.equal(f.gl.calls.length, dispatches, 'A drawing world does not redispatch pending assets');
  f.gl.ready = true; assert.equal(f.warm.prepare(), true); assert.equal(f.warm.state.heldObjects, 0);
  f.warm.beforeRender(); assert.equal(next.visible, true); f.warm.afterRender();
  next.material.dispose(); f.dispose();
});

check('scene-wide key transitions retain the completed canvas with an explicit global hold', () => {
  const f = fixture(); f.gl.ready = true; f.warm.prepare(); f.warm.didRender();
  f.scene.environment = new Texture(); f.gl.ready = false;
  assert.equal(f.warm.prepare(), false);
  assert.equal(f.warm.state.initialPending, false); assert.equal(f.warm.state.globalPending, true);
  assert.equal(f.warm.state.holdReason, 'global'); assert.equal(f.object.visible, true);
  const dispatches = f.gl.calls.length;
  assert.equal(f.warm.prepare(), false); assert.equal(f.gl.calls.length, dispatches);
  f.gl.ready = true; assert.equal(f.warm.prepare(), true); assert.equal(f.warm.state.globalPending, false);
  f.scene.environment.dispose(); f.dispose();
});

check('renderer-owned transparent side version bumps do not trigger per-frame compilation', () => {
  const f = fixture(); f.material.transparent = true; f.material.side = DoubleSide;
  f.gl.ready = true; f.warm.prepare(); const before = f.gl.calls.length;
  for (let i = 0; i < 10; i++) {
    // WebGLRenderer.renderObject makes these two needsUpdate writes while
    // drawing BackSide and FrontSide, then restores material.side.
    f.material.needsUpdate = true; f.material.needsUpdate = true;
    f.warm.didRender(); assert.equal(f.warm.prepare(), true);
  }
  assert.equal(f.gl.calls.length, before);
  f.material.needsUpdate = true; f.warm.prepare();
  assert.equal(f.gl.calls.length, before + 3, 'An external change between draws still prepares the material');
  f.dispose();
});

check('hidden ancestors, camera layers and held materials warm on their first eligible frame', () => {
  const f = fixture(), hidden = new Group(), dormant = new Mesh(f.geometry, new MeshStandardMaterial());
  hidden.visible = false; hidden.add(dormant); f.scene.add(hidden);
  const otherLayer = new Mesh(f.geometry, new MeshStandardMaterial()); otherLayer.layers.set(2); f.scene.add(otherLayer);
  const held = new Mesh(f.geometry, new MeshStandardMaterial()); held.material.visible = false; f.scene.add(held);
  f.gl.ready = true; f.warm.prepare();
  assert.equal(f.gl.calls[0].objects.length, 1, 'Only the visible live object belongs to the initial color batch');
  let before = f.gl.calls.length; hidden.visible = true; f.warm.prepare();
  assert.equal(f.gl.calls.length, before + 1); assert.equal(Object.getPrototypeOf(f.gl.calls.at(-1).objects[0]), dormant);
  before = f.gl.calls.length; otherLayer.layers.set(0); f.warm.prepare(); assert.equal(f.gl.calls.length, before + 1);
  before = f.gl.calls.length; held.material.visible = true; f.warm.prepare(); assert.equal(f.gl.calls.length, before + 1);
  dormant.material.dispose(); otherLayer.material.dispose(); held.material.dispose(); f.dispose();
});

check('material/layout, environment, light visibility and screen-target changes invalidate appropriate work', () => {
  const f = fixture(); f.gl.ready = true; f.warm.prepare();
  let before = f.gl.calls.length; f.material.needsUpdate = true; f.warm.prepare(); assert.equal(f.gl.calls.length, before + 3);
  before = f.gl.calls.length; f.object.instanceColor = {}; f.warm.prepare(); assert.equal(f.gl.calls.length, before + 3);
  before = f.gl.calls.length; f.scene.environment = new Texture(); f.warm.prepare(); assert.equal(f.gl.calls.length, before + 4);
  before = f.gl.calls.length; f.light.visible = false; f.warm.prepare(); assert.equal(f.gl.calls.length, before + 4);
  before = f.gl.calls.length; f.pass.renderToScreen = false; f.warm.invalidatePosts(); f.warm.prepare();
  assert.equal(f.gl.calls.length, before + 1); assert.equal(f.gl.calls.at(-1).target, f.composer.inputBuffer);
  f.scene.environment.dispose(); f.dispose();
});

check('depth proxies preserve custom hooks and r185 alpha/side/displacement rules', () => {
  const f = fixture(); f.object.customDepthMaterial = new MeshDepthMaterial();
  const hook = shader => { shader.vertexShader += ' custom'; }, key = () => 'custom-depth-key';
  f.object.customDepthMaterial.onBeforeCompile = hook; f.object.customDepthMaterial.customProgramCacheKey = key;
  f.material.side = 0; f.material.alphaToCoverage = true; f.material.map = new Texture();
  const warm = shadowWarmMaterial(f.object, f.material, 1);
  assert.equal(warm.onBeforeCompile, hook); assert.equal(warm.customProgramCacheKey(), key());
  assert.equal(warm.side, BackSide); assert.equal(warm.alphaTest, .5); assert.equal(warm.map, f.material.map);
  f.material.shadowSide = DoubleSide; const explicit = shadowWarmMaterial(f.object, f.material, 1); assert.equal(explicit.side, DoubleSide);
  warm.dispose(); explicit.dispose(); f.material.map.dispose(); f.object.customDepthMaterial.dispose(); f.dispose();
});

check('context restore re-arms exact programs and disposal detaches scene listeners', () => {
  const f = fixture(); f.gl.ready = true; f.warm.prepare(); const before = f.gl.calls.length;
  f.gl.ready = false; f.gl.restore(); assert.equal(f.warm.prepare(), false); assert.equal(f.gl.calls.length, before + 4);
  f.dispose(); const listenerCount = Object.values(f.scene._listeners ?? {}).reduce((sum, values) => sum + values.length, 0);
  assert.equal(listenerCount, 0); assert.equal(f.warm.prepare(), false);
});

check('unsupported drivers and failed dispatches retain explicit renderer fallback', () => {
  const f = fixture(false); assert.equal(f.warm.prepare(), true); assert.equal(f.gl.calls.length, 0); f.dispose();
  const broken = fixture(); broken.gl.compile = () => { throw Error('dispatch failure'); };
  assert.equal(broken.warm.prepare(), true); assert.equal(broken.warm.state.status, 'failed');
  assert.match(broken.warm.state.error, /dispatch failure/); assert.equal(broken.gl.getRenderTarget(), null); broken.dispose();
});
console.log(`COMPOSER PREFLIGHT: ${count}/${count}`);

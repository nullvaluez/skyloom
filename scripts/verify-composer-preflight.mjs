import assert from 'node:assert/strict';
import { BackSide, BoxGeometry, DirectionalLight, DoubleSide, Group, Mesh, MeshDepthMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, ShaderMaterial, Texture, WebGLRenderTarget } from 'three';
import { createComposerPreflight, shadowWarmMaterial } from '../lib/fly/composer-preflight.js';
import { createCriticalTerrainGate, previewTerrainTile } from '../lib/fly/critical-terrain-prewarm.mjs';
import { KawaseBlurPass, MipmapBlurPass, Pass } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

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
      const materials = new Set(), objects = [], lights = [];
      world.traverseVisible(o => { if (o.isLight && o.layers.test(cam.layers)) lights.push(o); });
      holder.traverse(o => {
        objects.push(o);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const key = [m.type, m.side, m.version, m.customProgramCacheKey(), !!o.isInstancedMesh, !!o.isSkinnedMesh, lights.length, !!world.fog, world.environment?.id, binding?.texture.colorSpace ?? 'screen'].join('/');
      if (!cache.has(key)) cache.set(key, { cacheKey: key, isReady: () => gl.ready && !gl.programBlocked?.(key), usedTimes: 1 });
          const program = cache.get(key), props = properties.get(m) ?? { programs: new Map() };
          props.programs.set(key, program); props.currentProgram = program; properties.set(m, props); materials.add(m);
        }
      });
      this.calls.push({ objects, lights, world, target: binding }); return materials;
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

check('compile batches use indexed live lights without revisiting world geometry', () => {
  const f = fixture(), hidden = new Group();
  const nested = new DirectionalLight(), otherLayer = new DirectionalLight();
  hidden.visible = false; hidden.add(nested); otherLayer.layers.set(2);
  f.scene.add(hidden, otherLayer);
  f.scene.environment = new Texture();
  f.scene.fog = { isFog: true };
  f.scene.traverseVisible = () => assert.fail('the renderer should only visit indexed lights');
  f.gl.ready = true; f.warm.prepare();
  const [color, darkDepth, litDepth] = f.gl.calls;
  assert.deepEqual(color.lights, [f.light]);
  assert.deepEqual(darkDepth.lights, []);
  assert.deepEqual(litDepth.lights, [f.light]);
  assert.equal(color.world.environment, f.scene.environment);
  assert.equal(color.world.fog, f.scene.fog);
  assert.equal(litDepth.world.environment, null); assert.equal(litDepth.world.fog, null);
  hidden.visible = true; f.scene.remove(f.light);
  const first = f.gl.calls.length;
  f.warm.prepare();
  assert.deepEqual(f.gl.calls[first].lights, [nested]);
  assert.deepEqual(f.gl.calls[first + 2].lights, [nested]);
  f.scene.environment.dispose(); f.dispose();
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

{
  const f=fixture(); f.gl.ready=true; f.warm.prepare(); f.warm.didRender();
  const gate=createCriticalTerrainGate(), source=new MeshStandardMaterial({map:new Texture({width:64,height:64})});
  source.customProgramCacheKey=()=>'tile-specific-color';
  const tile=new Mesh(f.geometry,source);
  tile.castShadow=true; tile.customDepthMaterial=new MeshDepthMaterial();
  tile.customDepthMaterial.customProgramCacheKey=()=>'tile-specific-depth';
  f.scene.add(tile);
  gate.hold(source,onRemove=>previewTerrainTile(tile,source,{patchBend:()=>{},daylight:()=>1,onRemove}));
  const preview=tile.children[0];
  const tick=()=>gate.tick({key:'env',parallel:true,covered:false,canStageTile:f.warm.canStageTerrain,compile:()=>Promise.resolve()});
  tick(); await Promise.resolve(); tick();
  f.gl.programBlocked=key=>key.includes('tile-specific-depth');
  for(let frame=0;frame<3;frame++){
    assert.equal(f.warm.prepare(),true);
    f.warm.beforeRender();
    const drawn=[]; f.scene.traverseVisible(o=>{if(o.isMesh&&o.material.visible)drawn.push(o);});
    assert.ok(drawn.includes(preview)); assert.ok(!drawn.includes(tile));
    f.warm.didRender(); f.warm.afterRender(); tick();
  }
  f.scene.environment=new Texture();
  assert.equal(f.warm.prepare(),true,'pending hidden sources must not become global dependencies');
  assert.equal(source.visible,false);
  f.gl.programBlocked=null;assert.equal(f.warm.prepare(),true);
  assert.equal(source.visible,true);assert.equal(tile.children.length,0);
  const calls=f.gl.calls.length;
  f.warm.beforeRender();assert.equal(tile.visible,true);f.warm.didRender();f.warm.afterRender();
  tick();assert.equal(gate.state.status,'ready');f.warm.prepare();
  assert.equal(f.gl.calls.length,calls,'publishing a known material must not compile it again');
  tile.customDepthMaterial.dispose();source.map.dispose();source.dispose();f.scene.environment.dispose();f.dispose();
  console.log('PASS terrain preview stays drawable until the actual color and shadow programs are ready');count++;
}

{
  const f=fixture(), gate=createCriticalTerrainGate(), branch=new Group();
  const map=new Texture({width:64,height:64});
  const tiles=Array.from({length:18},()=>new Mesh(f.geometry,new MeshStandardMaterial({map})));
  for(const tile of tiles){
    branch.add(tile);
    gate.hold(tile.material,onRemove=>previewTerrainTile(tile,tile.material,{patchBend:()=>{},daylight:()=>1,onRemove}));
  }
  f.scene.add(branch);
  const tick=()=>gate.tick({key:'env',parallel:true,covered:false,canStageTile:f.warm.canStageTerrain,compile:()=>Promise.resolve()});
  tick();await Promise.resolve();tick();assert.equal(tiles.filter(t=>t.userData.terrainHandoff).length,8);
  branch.removeFromParent();
  for(let i=0;i<4;i++)tick();
  assert.equal(gate.state.status,'ready');
  assert.ok(tiles.every(t=>t.material.visible&&!t.children.length&&!t.userData.terrainHandoff));
  for(const tile of tiles)tile.material.dispose();map.dispose();f.dispose();
  console.log('PASS removing a terrain ancestor drains its staged and waiting tiles without a draw');count++;
}

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

check('repeated visibility changes reuse warm color and depth programs until the scene changes', () => {
  const f = fixture();
  f.gl.ready = true;
  assert.equal(f.warm.prepare(), true);
  f.warm.didRender();
  const calls = f.gl.calls.length;
  for (let i = 0; i < 8; i++) {
    f.object.visible = false;
    assert.equal(f.warm.prepare(), true);
    f.object.visible = true;
    assert.equal(f.warm.prepare(), true);
  }
  assert.equal(f.gl.calls.length, calls);

  f.object.visible = false;
  f.scene.environment = new Texture();
  f.warm.prepare();
  const whileHidden = f.gl.calls.length;
  f.object.visible = true;
  assert.equal(f.warm.prepare(), true);
  assert.equal(f.gl.calls.length, whileHidden + 3, 'The returning object still needs the new lighting variant');
  f.scene.environment.dispose();
  f.dispose();
});

check('a hidden transparent mesh warms a revised shader key when it returns', () => {
  const f = fixture();
  f.material.transparent = true; f.material.side = DoubleSide;
  f.material.customProgramCacheKey = () => 'initial-transparent';
  f.gl.ready = true;
  assert.equal(f.warm.prepare(), true);
  f.warm.didRender();
  const calls = f.gl.calls.length;
  f.object.visible = false;
  f.material.customProgramCacheKey = () => 'returning-transparent';
  f.material.needsUpdate = true;
  assert.equal(f.warm.prepare(), true);
  f.warm.didRender();
  assert.equal(f.gl.calls.length, calls);
  f.gl.programBlocked = key => key.includes('returning-transparent');
  f.object.visible = true;
  assert.equal(f.warm.prepare(), true);
  assert.equal(f.warm.state.heldObjects, 1);
  assert.equal(f.gl.calls.length, calls + 3);
  f.gl.programBlocked = null;
  assert.equal(f.warm.prepare(), true);
  assert.equal(f.warm.state.heldObjects, 0);
  f.dispose();
});

check('draw-time side bumps are shared with dormant users of the same key', () => {
  const f = fixture(), twin = new Mesh(f.geometry, f.material);
  f.scene.add(twin);
  f.material.transparent = true; f.material.side = DoubleSide;
  f.gl.ready = true;
  assert.equal(f.warm.prepare(), true);
  f.warm.didRender();
  const calls = f.gl.calls.length;
  for (let i = 0; i < 4; i++) {
    twin.visible = false;
    assert.equal(f.warm.prepare(), true);
    f.material.needsUpdate = true; f.material.needsUpdate = true;
    f.warm.didRender();
  }
  twin.visible = true;
  assert.equal(f.warm.prepare(), true);
  assert.equal(f.gl.calls.length, calls);
  f.dispose();
});

check('detached shader links do not block first draw or a later scene-wide transition', () => {
  for (const afterFirstDraw of [false, true]) {
    const f = fixture(), unused = new Mesh(f.geometry, new MeshStandardMaterial());
    unused.material.customProgramCacheKey = () => 'detached-still-linking';
    f.gl.ready = true;
    if (afterFirstDraw) {
      assert.equal(f.warm.prepare(), true);
      f.warm.didRender();
    }
    f.gl.programBlocked = key => key.includes('detached-still-linking');
    f.scene.add(unused);
    assert.equal(f.warm.prepare(), afterFirstDraw);
    assert.equal(f.warm.state.heldObjects, 1);
    f.scene.remove(unused);
    f.scene.environment = new Texture();
    assert.equal(f.warm.prepare(), true);
    assert.ok(f.warm.state.pending > 0, 'The detached program is still linking');
    assert.equal(f.warm.state.holdReason, null);
    unused.material.dispose();
    f.scene.environment.dispose();
    f.dispose();
  }
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

check('real mipmap bloom and Kawase passes prepare both swapped materials before a screen exists', () => {
  const f=fixture(),mipmap=new MipmapBlurPass(),kawase=new KawaseBlurPass();mipmap.levels=3;
  const parent=f.pass;parent.effects=[{mipmapBlurPass:mipmap,blurPass:kawase}];
  assert.equal(mipmap.fullscreenMaterial,null);
  f.warm.invalidatePosts();assert.equal(f.warm.prepare(),false);
  const materialCalls=new Map();for(const call of f.gl.calls)for(const object of call.objects)materialCalls.set(object.material,{call,object});
  for(const [material,target]of [[mipmap.downsamplingMaterial,mipmap.downsamplingMipmaps[0]],[mipmap.upsamplingMaterial,mipmap.upsamplingMipmaps[0]],
    [kawase.blurMaterial,kawase.renderTargetA],[kawase.copyMaterial,f.composer.inputBuffer]]){
    const found=materialCalls.get(material);assert.ok(found,material.name);assert.equal(found.call.target,target);
    assert.equal(found.object.geometry,Pass.fullscreenGeometry,'Use the installed pass triangle, not a guessed layout');
  }
  assert.equal(mipmap.fullscreenMaterial,null,'Preparation must not mutate the pass material or create its live screen');
  f.gl.ready=true;f.warm.prepare();const calls=f.gl.calls.length;
  mipmap.fullscreenMaterial=mipmap.upsamplingMaterial;kawase.fullscreenMaterial=kawase.copyMaterial;
  f.warm.prepare();assert.equal(f.gl.calls.length,calls,'Render-time material swapping does not recompile stable variants');
  mipmap.dispose();kawase.dispose();f.dispose();
});

check('real N8AO quads include accumulation and retain their exact geometry and empty light state', () => {
  const f=fixture(),ao=new N8AOPostPass(f.scene,f.pass.camera,4,4);ao.configuration.halfRes=true;
  f.composer.passes.unshift(ao);f.warm.invalidatePosts();assert.equal(f.warm.prepare(),false);
  const materialCalls=new Map();for(const call of f.gl.calls)for(const object of call.objects)materialCalls.set(object.material,{call,object});
  for(const [name,target]of [['depthDownsampleQuad',ao.depthDownsampleTarget],['effectShaderQuad',ao.writeTargetInternal],
    ['poissonBlurQuad',ao.writeTargetInternal],['accumulationQuad',ao.accumulationRenderTarget],
    ['effectCompositerQuad',ao.outputTargetInternal],['copyQuad',f.composer.inputBuffer]]){
    const quad=ao[name],found=materialCalls.get(quad.material);assert.ok(found,name);assert.equal(found.call.target,target);
    assert.equal(found.object.geometry,quad._mesh.geometry);assert.equal(found.object.geometry.attributes.position.itemSize,2);
    assert.equal(found.call.world.environment,null);assert.equal(found.call.world.fog,null);
    let lights=0;found.call.world.traverseVisible(o=>{if(o.isLight)lights++;});assert.equal(lights,0);
  }
  f.gl.ready=true;f.warm.prepare();const before=f.gl.calls.length;
  ao.effectShaderQuad.material.needsUpdate=true;f.warm.prepare();assert.equal(f.gl.calls.length,before+1);
  ao.dispose();f.dispose();
});

check('unsupported drivers and failed dispatches retain explicit renderer fallback', () => {
  const f = fixture(false); assert.equal(f.warm.prepare(), true); assert.equal(f.gl.calls.length, 0); f.dispose();
  const broken = fixture(); broken.gl.compile = () => { throw Error('dispatch failure'); };
  assert.equal(broken.warm.prepare(), true); assert.equal(broken.warm.state.status, 'failed');
  assert.match(broken.warm.state.error, /dispatch failure/); assert.equal(broken.gl.getRenderTarget(), null); broken.dispose();
});
console.log(`COMPOSER PREFLIGHT: ${count}/${count}`);

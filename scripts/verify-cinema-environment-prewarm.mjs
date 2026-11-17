import assert from 'node:assert/strict';
import { Color, Mesh, OrthographicCamera, PlaneGeometry, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, WebGLRenderTarget } from 'three';
import { createCinemaEnvironmentPrewarm } from '../lib/fly/cinema-environment-prewarm.js';

// Run the installed PMREMGenerator, with an instrumented renderer. This
// verifies its actual sequence/targets instead of duplicating its algorithm.
function fixture({ parallel = true, failAt = 0 } = {}) {
  const originalTarget = new WebGLRenderTarget(8, 8), properties = new WeakMap();
  let target = originalTarget, face = 3, mip = 2;
  const targets = new Map(), compiles = [], draws = [];
  const describe = (object, camera) => {
    const out = [];
    object.traverse(o => { if (o.material) out.push({ material: o.material.name,
      layout: Object.keys(o.geometry.attributes).sort(), camera: camera.type,
      target: [target.width, target.height], tone: gl.toneMapping }); });
    return out;
  };
  const gl = {
    ready: false, lost: false, xr: { enabled: true }, toneMapping: 4, autoClear: true,
    extensions: { has: () => parallel }, getContext: () => ({ isContextLost: () => gl.lost }),
    state: { buffers: { depth: { getReversed: () => true } } },
    properties: { get: material => properties.get(material) },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(next, cubeFace = 0, level = 0) {
      target = next; face = cubeFace; mip = level;
      if (next && !targets.has(next)) {
        targets.set(next, { disposed: false });
        next.addEventListener('dispose', () => { targets.get(next).disposed = true; });
      }
    },
    getClearColor: color => color.set('#123456'),
    clearDepth() { assert.notEqual(target, originalTarget, 'Only the scratch target may be cleared'); },
    compile(object, camera) {
      compiles.push(describe(object, camera));
      if (compiles.length === failAt) throw Error('injected compile failure');
      const materials = new Set();
      object.traverse(o => {
        if (!o.material) return;
        materials.add(o.material);
        if (!properties.has(o.material)) {
          const program = { usedTimes: 1, isReady: () => gl.ready };
          properties.set(o.material, { currentProgram: program, programs: new Map([['exact', program]]) });
        }
      });
      return materials;
    },
    render(object, camera) { draws.push(describe(object, camera)); },
  };
  const sky = new Scene(), blendScene = new Scene();
  const skyMaterial = new ShaderMaterial({ name: 'test-cinema-sky' }), blendMaterial = new ShaderMaterial({ name: 'test-cinema-blend' });
  const sphere = new SphereGeometry(10, 24, 12), plane = new PlaneGeometry(2, 2);
  sky.add(new Mesh(sphere, skyMaterial)); blendScene.add(new Mesh(plane, blendMaterial));
  const rig = { sky, blendScene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), size: 256, pmrem: new PMREMGenerator(gl) };
  const originalRender = gl.render;
  const restored = () => {
    assert.equal(gl.render, originalRender); assert.equal(gl.getRenderTarget(), originalTarget);
    assert.equal(gl.getActiveCubeFace(), 3); assert.equal(gl.getActiveMipmapLevel(), 2);
    assert.equal(gl.xr.enabled, true); assert.equal(gl.toneMapping, 4); assert.equal(gl.autoClear, true);
  };
  const dispose = () => { rig.pmrem.dispose(); originalTarget.dispose(); sphere.dispose(); plane.dispose(); skyMaterial.dispose(); blendMaterial.dispose(); };
  return { gl, rig, compiles, draws, targets, restored, dispose };
}
let checks = 0;
const check = (name, run) => { run(); console.log('PASS ' + name); checks++; };

check('installed PMREM draw programs are prepared once and exact targets match the real bake', () => {
  const f = fixture(), warm = createCinemaEnvironmentPrewarm(f.gl, f.rig);
  assert.equal(warm.prepare(), false); f.restored();
  assert.equal(f.draws.length, 0); assert.ok(f.compiles.length > 12);
  assert.equal(warm.state.programs, 4, 'background, sky, GGX convolution, and blend');
  assert.ok(f.targets.size >= 3);
  assert.equal([...f.targets.values()].filter(t => t.disposed).length, 1, 'Only scratch output is retired');
  const count = f.compiles.length;
  for (let i = 0; i < 10; i++) assert.equal(warm.prepare(), false);
  assert.equal(f.compiles.length, count); assert.equal(f.draws.length, 0);
  f.gl.ready = true; assert.equal(warm.prepare(), true); assert.equal(warm.state.status, 'ready');
  const baked = f.rig.pmrem.fromScene(f.rig.sky, 0, .1, 30, { size: f.rig.size });
  assert.deepEqual(f.draws, f.compiles.slice(0, -1), 'Warm traversal follows the installed draw sequence byte for byte');
  baked.dispose(); warm.dispose(); f.dispose();
});

check('a thrown compile restores PMREM renderer mutations and disposes the scratch output', () => {
  const f = fixture({ failAt: 3 }); f.rig.sky.background = new Color('#abcdef');
  const background = f.rig.sky.background, warm = createCinemaEnvironmentPrewarm(f.gl, f.rig);
  assert.equal(warm.prepare(), true); assert.equal(warm.state.status, 'failed');
  assert.match(warm.state.error, /injected/); f.restored();
  assert.equal(f.rig.sky.background, background); assert.equal(f.draws.length, 0);
  assert.equal([...f.targets.values()].filter(t => t.disposed).length, 1);
  warm.dispose(); f.dispose();
});

check('context loss and disposed owners cannot resume a stale batch', () => {
  const f = fixture(), warm = createCinemaEnvironmentPrewarm(f.gl, f.rig);
  warm.prepare(); const count = f.compiles.length;
  f.gl.lost = true; assert.equal(warm.prepare(), false); assert.equal(f.compiles.length, count);
  warm.dispose(); f.gl.lost = false; f.gl.ready = true; assert.equal(warm.prepare(), false);
  const restored = createCinemaEnvironmentPrewarm(f.gl, f.rig);
  assert.equal(restored.prepare(), true); assert.ok(f.compiles.length > count);
  restored.dispose(); f.dispose();
});

check('unsupported parallel compilation retains the original renderer path', () => {
  const f = fixture({ parallel: false }), warm = createCinemaEnvironmentPrewarm(f.gl, f.rig);
  assert.equal(warm.prepare(), true); assert.equal(warm.state.status, 'unsupported');
  assert.equal(f.compiles.length, 0); f.restored(); warm.dispose(); f.dispose();
});
console.log(`CINEMA ENVIRONMENT PREWARM: ${checks}/${checks}`);

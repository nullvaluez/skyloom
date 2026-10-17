// Exercise the real texture baker with real Three resources and a faulting
// renderer. No WebGL context is needed to prove ownership and state cleanup.
import assert from 'node:assert/strict';
import { BufferGeometry, Material, WebGLRenderTarget } from 'three';
import { bakeRoomTextures, roomMapBytes } from '../lib/fly/lounge/room-textures.js';

let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function exercise({ failure = null, index = 1, state = { autoClear: false, xr: true, shadow: true } } = {}) {
  const disposed = { materials: [], targets: [], geometry: [] };
  const originals = [Material.prototype.dispose, WebGLRenderTarget.prototype.dispose, BufferGeometry.prototype.dispose];
  Material.prototype.dispose = function () { disposed.materials.push(this); return originals[0].call(this); };
  WebGLRenderTarget.prototype.dispose = function () { disposed.targets.push(this); return originals[1].call(this); };
  BufferGeometry.prototype.dispose = function () { disposed.geometry.push(this); return originals[2].call(this); };
  const originalTarget = { name: 'previous-scene-target' }, bound = [], rendered = [];
  const fault = new Error('injected bake ' + failure);
  let current = originalTarget, restored = 0;
  const renderer = {
    autoClear: state.autoClear,
    xr: { enabled: state.xr },
    shadowMap: { autoUpdate: state.shadow },
    capabilities: { getMaxAnisotropy: () => 16 },
    getRenderTarget: () => current,
    setRenderTarget(target) {
      current = target;
      if (target === originalTarget) {
        restored++;
        if (failure === 'restore') throw fault;
      } else {
        assert.ok(target.isWebGLRenderTarget);
        bound.push(target);
        if (failure === 'bind' && bound.length === index) throw fault;
      }
    },
    render(scene, camera) {
      const quad = scene.children[0];
      assert.ok(quad.material.isShaderMaterial && quad.geometry.isBufferGeometry);
      assert.ok(camera.isOrthographicCamera);
      assert.equal(this.autoClear, true);
      assert.equal(this.xr.enabled, false);
      assert.equal(this.shadowMap.autoUpdate, false);
      assert.equal(current.texture.anisotropy, 8);
      rendered.push({ material: quad.material, geometry: quad.geometry, target: current });
      if (failure === 'render' && rendered.length === index) throw fault;
    },
  };
  try {
    if (failure) {
      assert.throws(() => bakeRoomTextures(renderer), error => error === fault);
      assert.equal(disposed.targets.length, bound.length, 'all targets, including previous completed maps, are released');
      assert.deepEqual(new Set(disposed.targets), new Set(bound));
      assert.equal(disposed.materials.length, bound.length, 'current shader material is released even when binding fails');
      assert.ok(disposed.materials.every(material => material.isShaderMaterial));
    } else {
      const baked = bakeRoomTextures(renderer);
      assert.deepEqual(Object.keys(baked.maps), ['stone', 'wood', 'leather', 'fabric', 'plaster', 'foliage']);
      assert.equal(baked.bytes, roomMapBytes());
      assert.equal(rendered.length, 6);
      assert.equal(disposed.materials.length, 6);
      assert.equal(disposed.targets.length, 0, 'successful maps stay alive for their owner');
      for (const target of bound) assert.equal(baked.maps[target.texture.name.slice(7)], target.texture);
      baked.dispose();
      assert.deepEqual(new Set(disposed.targets), new Set(bound));
      assert.equal(disposed.targets.length, 6);
      baked.dispose();
      assert.equal(disposed.targets.length, 6, 'owner disposal is idempotent');
    }
    assert.equal(disposed.geometry.length, 1, 'full-screen quad geometry is released once');
    assert.equal(restored, 1);
    assert.equal(current, originalTarget);
    assert.equal(renderer.autoClear, state.autoClear);
    assert.equal(renderer.xr.enabled, state.xr);
    assert.equal(renderer.shadowMap.autoUpdate, state.shadow);
  } finally {
    [Material.prototype.dispose, WebGLRenderTarget.prototype.dispose, BufferGeometry.prototype.dispose] = originals;
  }
}
check('first bake render failure releases its target, shader and quad and restores renderer state', () => exercise({ failure: 'render', index: 1 }));
check('mid-bake render failure releases completed maps as well as the active bake', () => exercise({ failure: 'render', index: 4 }));
check('first target bind failure also releases the never-rendered shader and target', () => exercise({ failure: 'bind', index: 1 }));
check('mid-bake target bind failure restores disabled renderer flags as well', () => exercise({ failure: 'bind', index: 3, state: { autoClear: true, xr: false, shadow: false } }));
check('target restoration failure still releases every map and restores independent flags', () => exercise({ failure: 'restore' }));
check('successful bake transfers live maps and owner disposal releases them exactly once', () => exercise());
console.log(`LOUNGE TEXTURE LIFECYCLE: ${checks} checks`);

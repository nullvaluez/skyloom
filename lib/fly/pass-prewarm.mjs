import { compileSceneAsync } from './compile-scene-safe.js';

/** Prepare exact fullscreen materials before their first covered draw.
 * Dispatch captures each program before the pass switches its quad material. */
export function createPassPrewarm() {
  const state = { required: false, status: 'waiting', error: null, ms: 0 };
  let key = null, generation = 0, disposed = false, renderer = null;
  const invalidate = () => { generation++; key = null; state.status = 'invalidated'; };
  return {
    state,
    prepare(gl, pass, materials, target) {
      if (disposed) return;
      if (!gl.extensions.has('KHR_parallel_shader_compile')) { state.required = false; state.status = 'unsupported'; return; }
      state.required = true;
      if (renderer !== gl) {
        renderer?.domElement.removeEventListener('webglcontextlost', invalidate);
        renderer = gl; renderer.domElement.addEventListener('webglcontextlost', invalidate);
        invalidate();
      }
      const next = materials.map(material => material.uuid).join('/');
      if (key === next) return;
      key = next; const job = ++generation, start = performance.now(), pending = [];
      state.status = 'compiling'; state.error = null;
      const previousTarget = gl.getRenderTarget(), previousMaterial = pass.fullscreenMaterial;
      try {
        gl.setRenderTarget(target);
        for (const material of materials) {
          pass.fullscreenMaterial = material;
          pending.push(compileSceneAsync(gl, pass.scene, pass.camera));
        }
      } catch (error) { pending.push(Promise.reject(error)); }
      finally { pass.fullscreenMaterial = previousMaterial; gl.setRenderTarget(previousTarget); }
      Promise.allSettled(pending).then(results => {
        if (disposed || generation !== job) return;
        const failed = results.find(result => result.status === 'rejected');
        state.status = failed ? 'failed' : 'ready'; state.error = failed ? String(failed.reason?.message ?? failed.reason) : null;
        state.ms = Math.round(performance.now() - start);
      });
    },
    retry: invalidate,
    dispose() { disposed = true; generation++; renderer?.domElement.removeEventListener('webglcontextlost', invalidate); },
  };
}

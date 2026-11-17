/** Prepare the installed PMREM generator's exact draw programs, without
 * copying its private shaders or substituting an approximate environment.
 * The synchronous traversal temporarily compiles each draw instead of
 * rendering it. Its scratch output never becomes the displayed environment.
 */
export function createCinemaEnvironmentPrewarm(renderer, rig) {
  const state = { required: !!renderer.extensions?.has?.('KHR_parallel_shader_compile'),
    status: 'waiting', pending: 0, programs: 0, dispatches: 0, error: null };
  const programs = new Set();
  let dispatched = false, disposed = false;
  const capture = materials => {
    for (const material of materials) {
      const properties = renderer.properties.get(material);
      for (const program of properties.programs?.values?.() ?? [properties.currentProgram]) {
        if (!program) throw Error('Environment preparation produced no program');
        programs.add(program);
      }
    }
  };
  return {
    state,
    prepare() {
      if (disposed || renderer.getContext().isContextLost()) return false;
      if (!state.required) { state.status = 'unsupported'; return true; }
      if (state.status === 'ready' || state.status === 'failed') return true;
      try {
        if (!dispatched) {
          dispatched = true;
          const previous = { render: renderer.render, target: renderer.getRenderTarget(),
            face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
            xr: renderer.xr.enabled, tone: renderer.toneMapping, auto: renderer.autoClear,
            background: rig.sky.background };
          let scratch = null;
          try {
            // fromScene binds its real cube-UV and ping-pong targets, uses
            // perspective and orthographic cameras, and visits its actual
            // background/sky/GGX meshes. No async work may enter this scope.
            renderer.render = (scene, camera) => {
              scratch ??= renderer.getRenderTarget();
              capture(renderer.compile(scene, camera));
              state.dispatches++;
            };
            scratch = rig.pmrem.fromScene(rig.sky, 0, .1, 30, { size: rig.size });
            renderer.setRenderTarget(scratch);
            capture(renderer.compile(rig.blendScene, rig.camera));
            state.dispatches++;
            state.programs = programs.size;
          } finally {
            // PMREM.fromScene itself is not exception-safe. Restore all of
            // its renderer mutations even when a compile throws midway.
            renderer.render = previous.render;
            renderer.setRenderTarget(previous.target, previous.face, previous.mip);
            renderer.xr.enabled = previous.xr;
            renderer.toneMapping = previous.tone;
            renderer.autoClear = previous.auto;
            rig.sky.background = previous.background;
            scratch?.dispose();
          }
        }
        for (const program of programs) if (program.usedTimes === 0 || program.isReady()) programs.delete(program);
        state.pending = programs.size;
        state.status = programs.size ? 'compiling' : 'ready';
        return programs.size === 0;
      } catch (error) {
        programs.clear(); state.pending = 0;
        state.status = 'failed'; state.error = String(error?.message ?? error);
        // Unsupported/failed preparation keeps the normal renderer's error
        // path. A slow parallel link does not authorize this fallback.
        return true;
      }
    },
    dispose() { disposed = true; programs.clear(); state.pending = 0; state.status = 'disposed'; },
  };
}

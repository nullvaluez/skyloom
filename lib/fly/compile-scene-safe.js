/** Three's compileAsync protocol with explicit context-loss cancellation.
 * Capture WebGLProgram owners at dispatch: looking them up through material
 * properties later is unsafe when WebGL restores its property table. Shader
 * diagnostics and the driver's real isReady check remain unchanged. */
export function compileSceneAsync(gl, scene, camera, targetScene = scene) {
  return new Promise((resolve, reject) => {
    let timer = null, settled = false;
    const canvas = gl.domElement;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      canvas?.removeEventListener('webglcontextlost', lost);
      if (error) reject(error); else resolve(scene);
    };
    const lost = () => {
      const error = new Error('WebGL context lost during shader preparation');
      error.code = 'WEBGL_CONTEXT_LOST'; finish(error);
    };
    canvas?.addEventListener('webglcontextlost', lost);
    if (gl.getContext().isContextLost()) { lost(); return; }
    let programs;
    try {
      const materials = gl.compile(scene, camera, targetScene);
      programs = new Set([...materials].map(material => gl.properties.get(material).currentProgram));
      if (programs.has(undefined)) throw Error('Shader preparation did not produce a program');
    } catch (error) { finish(error); return; }
    const poll = () => {
      if (settled) return;
      if (gl.getContext().isContextLost()) { lost(); return; }
      try {
        for (const program of programs) if (program.isReady()) programs.delete(program);
      } catch (error) { finish(error); return; }
      if (!programs.size) finish(); else timer = setTimeout(poll, 10);
    };
    if (gl.extensions.has('KHR_parallel_shader_compile')) poll();
    else timer = setTimeout(poll, 10);
  });
}

/** Make `gl.compileAsync` safe across a context loss, for every caller.
 * Three's compileAsync re-reads `properties.get(material).currentProgram`
 * every 10 ms from a timer. A context restore replaces that table, so a
 * compile still polling across a loss throws "Cannot read properties of
 * undefined (reading 'isReady')" from the timer, uncaught (beta-smoke's
 * context-loss leg; the prewarm queues and the observation set keep compiles
 * in flight). Installed once per renderer, it keeps three's contract: it
 * resolves with the scene and does not reject when the context is lost (the
 * programs are gone; the restored context compiles on first use). Other
 * failures still reject. The normal path is the same compile and the same
 * isReady polling as three's. */
export function installSafeCompileAsync(gl) {
  if (!gl || gl.__flySafeCompileAsync || typeof gl.compileAsync !== 'function') return;
  gl.__flySafeCompileAsync = true;
  gl.compileAsync = (scene, camera, targetScene = null) =>
    compileSceneAsync(gl, scene, camera, targetScene ?? scene).catch((error) => {
      if (error?.code === 'WEBGL_CONTEXT_LOST') return scene;
      throw error;
    });
}

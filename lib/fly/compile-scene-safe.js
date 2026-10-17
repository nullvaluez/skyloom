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

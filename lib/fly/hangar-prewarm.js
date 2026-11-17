import { BackSide, BoxGeometry, ColorManagement, CubeReflectionMapping, Mesh, PMREMGenerator, Scene, ShaderLib, ShaderMaterial, SRGBTransfer, UniformsUtils, WebGLCubeRenderTarget, WebGLRenderTarget } from 'three';
import { shadowWarmMaterial } from './composer-preflight.js';

const renderable = object => object.isMesh || object.isPoints || object.isLine || object.isSprite;
const materialList = material => Array.isArray(material) ? material : material ? [material] : [];
const proxy = (object, material) => Object.assign(Object.create(object), { material, children: [] });

function rendererScope(gl, render, operation, nestedDraws = false) {
  const methods = { render: gl.render, clear: gl.clear, clearColor: gl.clearColor, clearDepth: gl.clearDepth, clearStencil: gl.clearStencil };
  const saved = { target: gl.getRenderTarget(), face: gl.getActiveCubeFace?.(), mip: gl.getActiveMipmapLevel?.(),
    auto: gl.autoClear, xr: gl.xr.enabled, shadow: gl.shadowMap.autoUpdate, shadowNeeds: gl.shadowMap.needsUpdate, tone: gl.toneMapping };
  let compiling = false;
  try {
    gl.render = (scene, camera) => {
      // A Standard material can trigger Three's internal PMREM conversion
      // during compile. Those nested draws must produce their real textures.
      if (compiling && nestedDraws) return methods.render.call(gl, scene, camera);
      compiling = true;
      try { return render(scene, camera); } finally { compiling = false; }
    };
    for (const name of ['clear', 'clearColor', 'clearDepth', 'clearStencil']) if (methods[name]) {
      gl[name] = (...args) => { if (compiling && nestedDraws) return methods[name].apply(gl, args); };
    }
    return operation();
  } finally {
    for (const [name, method] of Object.entries(methods)) if (method) gl[name] = method;
    gl.setRenderTarget(saved.target, saved.face, saved.mip);
    gl.autoClear = saved.auto; gl.xr.enabled = saved.xr;
    gl.shadowMap.autoUpdate = saved.shadow; gl.shadowMap.needsUpdate = saved.shadowNeeds; gl.toneMapping = saved.tone;
  }
}

function environmentWarm(gl, texture, retain) {
  const pmrem = new PMREMGenerator(gl), keep = new Set();
  let scratch, cube, completed = false;
  let released = false;
  const dispose = () => { if (released) return; released = true; for (const material of keep) material.dispose(); keep.clear(); pmrem.dispose(); };
  try {
    rendererScope(gl, (scene, camera) => {
      // Remember the owned output before compile can throw; the public API
      // otherwise returns it only after all conversion passes have finished.
      scratch ??= gl.getRenderTarget();
      retain(gl.compile(scene, camera));
    }, () => {
      scratch = texture.isCubeTexture ? pmrem.fromCubemap(texture) : pmrem.fromEquirectangular(texture);
    });
    // WebGLEnvironments converts the HDR background separately from its PMREM.
    // The public converter disposes its material before returning, so retain
    // an exact material twin until the renderer has acquired its own program.
    if (!texture.isCubeTexture) {
      cube = new WebGLCubeRenderTarget(texture.image.height);
      rendererScope(gl, (mesh, camera) => {
        const material = mesh.material.clone();
        material.onBeforeCompile = mesh.material.onBeforeCompile;
        material.customProgramCacheKey = mesh.material.customProgramCacheKey;
        keep.add(material);
        const holder = new Scene(); holder.children.push(proxy(mesh, material));
        retain(gl.compile(holder, camera));
      }, () => cube.fromEquirectangularTexture(gl, texture));
    }
    completed = true;
  } finally { scratch?.dispose(); cube?.dispose(); if (!completed) dispose(); }
  return dispose;
}

/** Initial/changed hangar programs, using the installed Drei callbacks rather
 * than copies of their reflector and one-shot contact-shadow implementation.
 * The caller keeps this R3F root on `never` and advances only this root at dt=0.
 * ContactShadows is armed with frames=Infinity during this compile-only frame,
 * then gets frames=1 in a React commit before normal rendering resumes.
 */
export function createHangarPrewarm(gl, scene, camera, advance) {
  const pending = new Set(), environmentPending = new Set();
  const depths = new Set(), empty = new Scene(), depthTarget = new WebGLRenderTarget(1, 1);
  const state = { required: !!gl.extensions?.has?.('KHR_parallel_shader_compile'), status: 'waiting',
    pending: 0, dispatches: 0, batches: 0, error: null, programKeys: [] };
  gl.__hangarProgramWarm = state;
  const keys = new Set();
  let disposed = false, dispatched = false, environment = null, disposeEnvironment = null, environmentDispatched = false;
  const background = new Mesh(new BoxGeometry(1, 1, 1), new ShaderMaterial({
    name: 'BackgroundCubeMaterial', uniforms: UniformsUtils.clone(ShaderLib.backgroundCube.uniforms),
    vertexShader: ShaderLib.backgroundCube.vertexShader, fragmentShader: ShaderLib.backgroundCube.fragmentShader,
    side: BackSide, depthTest: false, depthWrite: false, fog: false, allowOverride: false,
  }));
  background.geometry.deleteAttribute('normal'); background.geometry.deleteAttribute('uv');
  const backgroundCube = new WebGLCubeRenderTarget(1);
  backgroundCube.texture.mapping = CubeReflectionMapping;
  Object.defineProperty(background.material, 'envMap', { get() { return this.uniforms.envMap.value; } });
  const retain = (materials, queue = pending) => {
    for (const material of materials) {
      const props = gl.properties.get(material);
      for (const program of props.programs?.values?.() ?? [props.currentProgram]) {
        if (!program) throw Error('Hangar preparation produced no program');
        queue.add(program); keys.add(program.cacheKey);
      }
    }
  };
  const poll = (queue = pending) => {
    for (const program of queue) if (program.usedTimes === 0 || program.isReady()) queue.delete(program);
    state.pending = pending.size + environmentPending.size; state.programKeys = [...keys];
    return queue.size === 0;
  };
  const capture = (source, cam) => {
    let compileSource = source;
    if (source.overrideMaterial) {
      const objects = [];
      source.traverse(object => {
        if (!renderable(object)) return;
        const materials = materialList(object.material).map(material => material.allowOverride === false ? material : source.overrideMaterial);
        objects.push(proxy(object, Array.isArray(object.material) ? materials : materials[0]));
      });
      compileSource = { traverse: visit => objects.forEach(visit), traverseVisible() {} };
    }
    retain(gl.compile(compileSource, cam, source)); state.dispatches++;
    if (source.background?.isTexture) {
      backgroundCube.texture.colorSpace = source.background.colorSpace;
      background.material.uniforms.envMap.value = backgroundCube.texture;
      background.material.toneMapped = ColorManagement.getTransfer(source.background.colorSpace) !== SRGBTransfer;
      const holder = { traverse: visit => visit(background), traverseVisible() {} };
      retain(gl.compile(holder, cam, source)); state.dispatches++;
    }
  };
  return {
    state,
    invalidate(contextRestored = false) {
      if (disposed) return;
      dispatched = false; pending.clear(); keys.clear();
      for (const material of depths) material.dispose(); depths.clear();
      state.status = 'waiting'; state.error = null;
      if (contextRestored) { disposeEnvironment?.(); disposeEnvironment = null; environmentDispatched = false; environment = null; environmentPending.clear(); }
    },
    prepare() {
      if (disposed || gl.getContext().isContextLost()) return false;
      if (!state.required) { state.status = 'unsupported'; return true; }
      if (state.status === 'failed') return true;
      try {
        // A missing HDR/model does not block the available bay. Prepare its
        // current no-environment variant; the HDR's layout commit re-arms the
        // gate before any newly installed texture can be first-used.
        const texture = scene.environment;
        if (texture !== environment) {
          disposeEnvironment?.(); environment = texture; environmentDispatched = false; dispatched = false;
          pending.clear(); environmentPending.clear();
        }
        if (texture?.image && !environmentDispatched) {
          environmentDispatched = true;
          disposeEnvironment = environmentWarm(gl, texture, materials => retain(materials, environmentPending));
          state.status = 'environment';
        }
        if (!poll(environmentPending)) return false;
        if (!dispatched) {
          dispatched = true; state.batches++;
          const visibility = new Map();
          scene.traverse(object => { visibility.set(object, object.visible); });
          const oldBackground = scene.background, oldOverride = scene.overrideMaterial;
          try {
            scene.updateMatrixWorld(true);
            // Only this root's zero-delta callbacks. Shared R3F/global effects
            // and the flight canvas are never advanced by this operation.
            rendererScope(gl, capture, () => advance(0, false), true);
          } finally {
            scene.background = oldBackground; scene.overrideMaterial = oldOverride;
            for (const [object, visible] of visibility) object.visible = visible;
          }
          // The captured color calls do not execute WebGLShadowMap. Prepare
          // its exact directional-depth derivatives separately, with no clear
          // or draw that could consume or publish an incomplete shadow map.
          const objects = [];
          scene.traverse(object => {
            if (!renderable(object) || !object.castShadow) return;
            for (const material of materialList(object.material)) {
              const depth = shadowWarmMaterial(object, material, gl.shadowMap.type);
              depths.add(depth); objects.push(proxy(object, depth));
            }
          });
          if (objects.length && gl.shadowMap.enabled) {
            const lighting = new Scene();
            lighting.traverseVisible = visit => scene.traverseVisible(object => { if (object.isLight) visit(object); });
            const holder = { traverse: visit => objects.forEach(visit), traverseVisible() {} }, previous = gl.getRenderTarget();
            try {
              gl.setRenderTarget(depthTarget);
              retain(gl.compile(holder, camera, empty)); retain(gl.compile(holder, camera, lighting)); state.dispatches += 2;
            } finally { gl.setRenderTarget(previous); }
          }
        }
        state.status = poll() ? 'ready' : 'compiling';
        return state.status === 'ready';
      } catch (error) {
        state.status = 'failed'; state.error = String(error?.message ?? error);
        return true;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; pending.clear(); environmentPending.clear(); disposeEnvironment?.();
      // Captured Drei targets/materials are borrowed. Their owner, including
      // StrictMode replay, remains responsible for their resource lifetime.
      for (const material of depths) material.dispose();
      depthTarget.dispose(); backgroundCube.dispose(); background.geometry.dispose(); background.material.dispose();
      if (gl.__hangarProgramWarm === state) delete gl.__hangarProgramWarm;
      state.status = 'disposed';
    },
  };
}

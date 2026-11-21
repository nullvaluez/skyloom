import { BackSide, ColorManagement, DoubleSide, FrontSide, Mesh, MeshDepthMaterial, OrthographicCamera, Scene, VSMShadowMap } from 'three';
import { Pass } from 'postprocessing';

const renderable = object => object.isMesh || object.isPoints || object.isLine || object.isSprite;
const sides = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };
const emptyAttributes = Object.freeze({});
const effectivelyVisible = object => { for (let at = object; at; at = at.parent) if (!at.visible) return false; return true; };
const visibleMaterial = material => {
  if (!Array.isArray(material)) return !!material?.visible;
  for (const entry of material) if (entry?.visible) return true;
  return false;
};

/** A compile-only object keeps the actual geometry/instancing/skinning state,
 * without reparenting live objects or allocating another instance buffer. */
function proxy(object, material = object.material) {
  const result = Object.create(object);
  result.material = material; result.children = [];
  return result;
}

/** r185 WebGLShadowMap.getDepthMaterial's directional-light parameters.
 * The retained twin only owns its material, never geometry or map textures. */
export function shadowWarmMaterial(object, source, shadowType) {
  const original = object.customDepthMaterial;
  const material = original ? original.clone() : new MeshDepthMaterial();
  if (original) {
    // Material.copy deliberately omits these; custom bend/quantized depth
    // hooks must have the exact same cache key and uniforms as the caster.
    material.onBeforeCompile = original.onBeforeCompile;
    material.customProgramCacheKey = original.customProgramCacheKey;
  }
  material.visible = source.visible; material.wireframe = source.wireframe;
  material.side = source.shadowSide !== null ? source.shadowSide : shadowType === VSMShadowMap ? source.side : sides[source.side];
  material.alphaMap = source.alphaMap;
  material.alphaTest = source.alphaToCoverage === true ? .5 : source.alphaTest;
  material.map = source.map;
  material.clipShadows = source.clipShadows; material.clippingPlanes = source.clippingPlanes; material.clipIntersection = source.clipIntersection;
  material.displacementMap = source.displacementMap; material.displacementScale = source.displacementScale; material.displacementBias = source.displacementBias;
  material.wireframeLinewidth = source.wireframeLinewidth; material.linewidth = source.linewidth;
  return material;
}

function sameLayout(saved, object) {
  if (!saved) return false;
  const g = object.geometry, a = g?.attributes ?? emptyAttributes, m = g?.morphAttributes ?? emptyAttributes;
  return saved.geometry === g && saved.colorSize === a.color?.itemSize && saved.position === !!a.position &&
    saved.tangent === !!a.tangent && saved.normal === !!a.normal && saved.uv === !!a.uv &&
    saved.uv1 === !!a.uv1 && saved.uv2 === !!a.uv2 && saved.uv3 === !!a.uv3 &&
    saved.morphPosition === (m.position?.length ?? -1) && saved.morphNormal === (m.normal?.length ?? -1) &&
    saved.morphColor === (m.color?.length ?? -1) && saved.instanced === !!object.isInstancedMesh &&
    saved.instanceColor === !!object.instanceColor && saved.morphTexture === !!object.morphTexture &&
    saved.skinned === !!object.isSkinnedMesh && saved.batched === !!object.isBatchedMesh &&
    saved.batchColors === !!object._colorsTexture && saved.receiveShadow === object.receiveShadow &&
    saved.castShadow === object.castShadow && saved.customDepth === object.customDepthMaterial &&
    saved.customDepthVersion === object.customDepthMaterial?.version;
}

function snapshotLayout(object) {
  const g = object.geometry, a = g?.attributes ?? emptyAttributes, m = g?.morphAttributes ?? emptyAttributes;
  return { geometry: g, colorSize: a.color?.itemSize, position: !!a.position, tangent: !!a.tangent, normal: !!a.normal,
    uv: !!a.uv, uv1: !!a.uv1, uv2: !!a.uv2, uv3: !!a.uv3, morphPosition: m.position?.length ?? -1,
    morphNormal: m.normal?.length ?? -1, morphColor: m.color?.length ?? -1, instanced: !!object.isInstancedMesh,
    instanceColor: !!object.instanceColor, morphTexture: !!object.morphTexture, skinned: !!object.isSkinnedMesh,
    batched: !!object.isBatchedMesh, batchColors: !!object._colorsTexture, receiveShadow: object.receiveShadow,
    castShadow: object.castShadow, customDepth: object.customDepthMaterial, customDepthVersion: object.customDepthMaterial?.version };
}

function sameMaterial(saved, m) {
  return saved?.material === m && saved.version === m.version && saved.side === m.side && saved.shadowSide === m.shadowSide &&
    saved.alphaTest === m.alphaTest && saved.alphaToCoverage === m.alphaToCoverage && saved.map === m.map &&
    saved.alphaMap === m.alphaMap && saved.displacementMap === m.displacementMap &&
    saved.displacementScale === m.displacementScale && saved.displacementBias === m.displacementBias &&
    saved.visible === m.visible && saved.wireframe === m.wireframe && saved.transparent === m.transparent &&
    saved.forceSinglePass === m.forceSinglePass;
}

function sameMaterials(saved, material) {
  if (!saved) return false;
  if (!Array.isArray(material)) return saved.length === (material ? 1 : 0) && (!material || sameMaterial(saved[0], material));
  if (saved.length !== material.length) return false;
  for (let i = 0; i < material.length; i++) if (!sameMaterial(saved[i], material[i])) return false;
  return true;
}

function snapshotMaterials(material) {
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  return materials.map(m => ({ material: m, version: m.version, key: m.customProgramCacheKey(), side: m.side, shadowSide: m.shadowSide,
    alphaTest: m.alphaTest, alphaToCoverage: m.alphaToCoverage, map: m.map, alphaMap: m.alphaMap,
    displacementMap: m.displacementMap, displacementScale: m.displacementScale, displacementBias: m.displacementBias,
    visible: m.visible, wireframe: m.wireframe, transparent: m.transparent, forceSinglePass: m.forceSinglePass }));
}

function fullscreenPasses(composer, emptyScene, quadCamera) {
  const out = [], seen = new Set();
  const outputTarget = (pass, nested) => !nested && pass.renderToScreen ? null : composer.inputBuffer;
  const swappedMaterial = (pass, field, target) => {
    // Pass lazily creates its screen on the first material assignment. Use
    // the library's exact shared geometry without changing the live screen.
    const object = new Mesh(Pass.fullscreenGeometry, null);
    out.push({ pass, materialFor: () => pass[field], objectFor: () => object, targetFor: target,
      scene: pass.scene, camera: pass.camera });
  };
  const visit = (pass, nested = false, depth = 0) => {
    if (!pass || seen.has(pass) || depth > 3) return;
    seen.add(pass);
    // Clouds own their changing fullscreen batch and pass through while it
    // links. Warming their inactive Classic quad here creates an unused key.
    if (pass.programWarm) return;
    if (pass.effectShaderQuad?._mesh) {
      // N8AO renders bare FullScreenTriangle meshes, using its own empty
      // scene/light state and 2-component position geometry. Its accumulation
      // draw runs even when temporal accumulation is disabled in settings.
      const quad = (field, target) => out.push({ pass, materialFor: () => pass[field]?.material,
        objectFor: () => pass[field]?._mesh, targetFor: target, scene: emptyScene, camera: quadCamera });
      quad('depthDownsampleQuad', () => pass.depthDownsampleTarget);
      quad('effectShaderQuad', () => pass.writeTargetInternal);
      quad('poissonBlurQuad', () => pass.writeTargetInternal);
      quad('accumulationQuad', () => pass.accumulationRenderTarget);
      quad('effectCompositerQuad', () => pass.outputTargetInternal);
      quad('copyQuad', () => outputTarget(pass, nested));
    } else if (pass.downsamplingMaterial && pass.upsamplingMaterial) {
      swappedMaterial(pass, 'downsamplingMaterial', () => pass.downsamplingMipmaps[0] ?? pass.renderTarget);
      swappedMaterial(pass, 'upsamplingMaterial', () => pass.upsamplingMipmaps[0] ?? pass.renderTarget);
    } else if (pass.blurMaterial && pass.copyMaterial && pass.renderTargetA) {
      swappedMaterial(pass, 'blurMaterial', () => pass.renderTargetA);
      swappedMaterial(pass, 'copyMaterial', () => outputTarget(pass, nested));
    } else if (pass.scene && pass.camera && pass.fullscreenMaterial) {
      out.push({ pass, materialFor: () => pass.fullscreenMaterial, targetFor: () => outputTarget(pass, nested),
        scene: pass.scene, camera: pass.camera });
    }
    for (const effect of pass.effects ?? []) {
      for (const value of Object.values(effect)) if (value?.scene && value?.camera) visit(value, true, depth + 1);
    }
    for (const value of Object.values(pass)) {
      if (value !== pass.scene && value !== pass.camera && value?.scene && value?.camera) visit(value, true, depth + 1);
    }
  };
  for (const pass of composer.passes) if (pass.enabled) visit(pass);
  return out;
}

/** Readiness for the exact live scene and post chain. A content timeout never
 * authorizes first-use introspection of a pending driver link. New scene
 * children are observed; stable frames only compare tracked layouts/versions,
 * and never compile the complete scene or issue an extra render.
 */
export function createComposerPreflight(gl, scene, camera, composer) {
  const records = new Map(), watched = new Set(), lights = new Set(), pending = new Set();
  const retired = new Set(), keys = new Set(), drawVersions = new Set(), drawnVersions = new Map();
  const globalWait = new Set(), empty = new Scene(), shadowScene = new Scene();
  const colorScene = Object.create(scene), visibleLights = [];
  const quadCamera = new OrthographicCamera();
  const heldObjects = [];
  // Three.compile visits the target scene only to collect lights. Use the
  // same indexed live lights for every batch, with the actual fog/environment
  // for color and the empty scene's settings for ShadowMap's scene=null path.
  colorScene.traverseVisible = shadowScene.traverseVisible = visit => {
    for (const light of visibleLights) visit(light);
  };
  let readyPrograms = new WeakSet(), disposed = false, presented = false, environmentKey = null, passes = null, postsDirty = true;
  const state = { required: !!gl.extensions?.has?.('KHR_parallel_shader_compile'), status: 'waiting', pending: 0,
    batches: 0, sceneDispatches: 0, depthDispatches: 0, postDispatches: 0, skippedFrames: 0, heldObjects: 0,
    initialPending: false, globalPending: false, postPending: 0, holdReason: null, error: null, programKeys: [] };
  const retire = record => {
    for (const m of record.depth) retired.add(m);
    record.depth.length = 0;
    if (record.versions) for (const saved of record.versions) drawVersions.delete(saved);
  };
  const add = object => {
    if (watched.has(object)) return;
    watched.add(object); object.addEventListener('childadded', added); object.addEventListener('childremoved', removed);
    if (renderable(object)) records.set(object, { object, dirty: true, depth: [], programs: new Set(), hiddenForDraw: false });
    if (object.isLight) { lights.add(object); environmentKey = null; }
    for (const child of object.children) add(child);
  };
  const remove = object => {
    if (!watched.delete(object)) return;
    object.removeEventListener('childadded', added); object.removeEventListener('childremoved', removed);
    if (records.has(object)) { retire(records.get(object)); records.delete(object); }
    if (lights.delete(object)) environmentKey = null;
    for (const child of object.children) remove(child);
  };
  const added = event => add(event.child), removed = event => remove(event.child);
  add(scene);
  const invalidate = () => {
    pending.clear(); globalWait.clear(); readyPrograms = new WeakSet(); environmentKey = null; postsDirty = true;
    presented = false;
    state.status = 'waiting'; state.error = null;
    for (const record of records.values()) record.dirty = true;
  };
  gl.domElement?.addEventListener('webglcontextrestored', invalidate);
  gl.domElement?.addEventListener('webglcontextlost', invalidate);
  const retainPrograms = (materials, dependencies) => {
    for (const material of materials) {
      const props = gl.properties.get(material), programs = props.programs?.values?.() ?? [props.currentProgram];
      for (const program of programs) {
        if (!program) throw Error('Live shader preparation produced no program');
        keys.add(program.cacheKey);
        dependencies?.add(program);
        if (!readyPrograms.has(program)) pending.add(program);
      }
    }
  };
  const compile = (objects, targetScene = colorScene, target = composer.inputBuffer, cam = camera, dependencies) => {
    const previous = gl.getRenderTarget();
    // Plain traversal holders are accepted by Three.compile and do not own or
    // mutate live parents. Geometry and all mesh feature flags stay exact.
    const holder = { traverse: fn => objects.forEach(fn), traverseVisible: fn => objects.forEach(fn) };
    try { gl.setRenderTarget(target); retainPrograms(gl.compile(holder, cam, targetScene), dependencies); }
    finally { gl.setRenderTarget(previous); }
  };
  const programsReady = programs => {
    if (!programs) return true;
    for (const program of programs) if (program.usedTimes !== 0 && !readyPrograms.has(program)) return false;
    return true;
  };
  return {
    state,
    canStageTerrain: model => !disposed && state.required && state.status !== 'failed' && records.has(model),
    prepare() {
      if (disposed || gl.getContext().isContextLost()) return false;
      if (!state.required) { state.status = 'unsupported'; return true; }
      if (state.status === 'failed') return true;
      try {
        heldObjects.length = 0;
        visibleLights.length = 0;
        const environment = scene.environment;
        let lightKey = '';
        for (const light of lights) {
          const visible = effectivelyVisible(light);
          if (visible) visibleLights.push(light);
          lightKey += `${light.id}:${visible}:${light.castShadow}:${light.layers.mask}:${!!light.map},`;
        }
        const key = [environment?.id, environment?.mapping, environment?.image?.height, !!scene.fog, !!scene.fog?.isFogExp2,
          lightKey, camera.layers.mask, gl.shadowMap.enabled, gl.shadowMap.type, gl.toneMapping,
          gl.outputColorSpace, composer.inputBuffer.texture.colorSpace].join('/');
        const rekey = key !== environmentKey; environmentKey = key;
        // Stable frames allocate no per-object signatures, material lists,
        // proxies, or batch arrays. Snapshots belong only to a changed object.
        let changed, colors, depths, terrainHandoffs;
        for (const record of records.values()) {
          const { object } = record;
          // Match projectObject's visibility and camera-layer rules. Dormant
          // hangar/fleet branches and terrain held by its own readiness gate
          // should not expand the boot batch. Re-appearance is checked before
          // the first draw, including an ancestor's visibility transition.
          const handoff = object.userData.terrainHandoff;
          if (!handoff && (!effectivelyVisible(object) || !object.layers.test(camera.layers) || !visibleMaterial(object.material))) {
            record.active = false;
            // A hidden object's prior key is reusable on reappearance unless
            // the scene changed variants while it was out of the draw.
            if (rekey) record.dirty = true;
            continue;
          }
          const wasActive = record.active;
          // This tile's lit source is hidden while its child preview draws.
          // Keep it out of local holds: hiding the parent hides both.
          record.active = !handoff;
          if (handoff) (terrainHandoffs ??= []).push(record);
          if (!rekey && !record.dirty && sameLayout(record.layout, object) && sameMaterials(record.versions, object.material)
            && (wasActive || record.versions.every(saved => saved.key === saved.material.customProgramCacheKey()))) continue;
          record.layout = snapshotLayout(object); record.dirty = false;
          (colors ??= []).push(proxy(object)); (changed ??= []).push(record);
          retire(record);
          const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
          if (gl.shadowMap.enabled && object.castShadow) for (const source of materials) {
            const material = shadowWarmMaterial(object, source, gl.shadowMap.type);
            record.depth.push(material); (depths ??= []).push(proxy(object, material));
          }
        }
        if (colors) { compile(colors); state.sceneDispatches++; state.batches++; }
        if (depths) {
          // Shadow rendering precedes setupLights on the first frame, then
          // inherits the main light state on later frames. Both exact color-
          // independent keys are retained, with no shadow-map clear or draw.
          compile(depths, empty); compile(depths, shadowScene); state.depthDispatches += 2;
        }
        // Three may increment transparent DoubleSide material versions while
        // preparing its front/back programs. Record the post-compile version.
        if (changed) for (const record of changed) {
          record.versions = snapshotMaterials(record.object.material);
          record.programs.clear();
          retainPrograms(record.versions.map(saved => saved.material), record.programs);
          retainPrograms(record.depth, record.programs);
          for (const saved of record.versions) if (saved.transparent && saved.side === DoubleSide && saved.forceSinglePass === false) {
            saved.record = record;
            drawVersions.add(saved);
          }
        }
        if (postsDirty || passes !== composer.passes) { passes = composer.passes; this.posts = fullscreenPasses(composer, empty, quadCamera); postsDirty = false; }
        for (const entry of this.posts ?? []) {
          const material = entry.materialFor(), object = entry.objectFor?.();
          if (!material) { entry.programs?.clear(); continue; }
          const selectedTarget = entry.targetFor();
          const target = selectedTarget === undefined ? composer.inputBuffer : selectedTarget;
          const output = target === null ? gl.outputColorSpace : target.isXRRenderTarget ? target.texture.colorSpace : ColorManagement.workingColorSpace;
          if (!rekey && entry.material === material && entry.version === material.version && entry.output === output && entry.geometry === object?.geometry) continue;
          const objects = [];
          if (object) objects.push(proxy(object, material));
          else entry.scene.traverse(mesh => { if (renderable(mesh)) objects.push(proxy(mesh)); });
          entry.programs = new Set();
          compile(objects, entry.scene, target, entry.camera, entry.programs); state.postDispatches++;
          entry.material = material; entry.version = material.version; entry.output = output; entry.geometry = object?.geometry;
        }
        for (const program of pending) if (program.usedTimes === 0 || program.isReady()) { pending.delete(program); readyPrograms.add(program); }
        for (const record of terrainHandoffs ?? []) if (programsReady(record.programs)) {
          record.object.userData.terrainHandoff();
          // Only visibility changed during publication. The newly visible
          // source has the same color/depth programs this prepare just checked.
          for (const saved of record.versions) saved.visible = saved.material.visible;
          record.active = true;
        }
        state.pending = pending.size;
        if (colors || state.programKeys.length !== keys.size) state.programKeys = [...keys];
        let postPending = 0;
        if (rekey) globalWait.clear();
        if (pending.size) {
          for (const entry of this.posts ?? []) if (!programsReady(entry.programs)) postPending++;
          let stillNeeded;
          if ((rekey && presented) || globalWait.size) stillNeeded = new Set();
          for (const record of records.values()) {
            if (!record.active || programsReady(record.programs)) continue;
            heldObjects.push(record);
            if (stillNeeded) for (const program of record.programs) {
              if (pending.has(program)) stillNeeded.add(program);
            }
          }
          if (rekey && stillNeeded) {
            for (const program of stillNeeded) globalWait.add(program);
          } else if (stillNeeded) {
            for (const program of globalWait) if (!stillNeeded.has(program)) globalWait.delete(program);
          }
        }
        if (!pending.size) globalWait.clear();
        state.heldObjects = heldObjects.length; state.postPending = postPending;
        state.initialPending = !presented && (heldObjects.length > 0 || postPending > 0);
        state.globalPending = globalWait.size > 0;
        // Boot needs one complete frame. Afterwards, stream newly linked
        // renderables into a world that keeps drawing instead of freezing the
        // whole canvas whenever an asynchronous asset brings a new shader.
        // A scene-wide key transition retains the last canvas instead of
        // hiding an entire city. Snapshot only that transition's dependencies
        // so later streamed objects cannot indefinitely extend its hold.
        // A changed post chain is also atomic: its output routing cannot be
        // bypassed by disabling arbitrary intermediate or screen passes.
        state.holdReason = state.initialPending ? 'initial' : state.globalPending ? 'global' : postPending ? 'post' : heldObjects.length ? 'local' : null;
        if (state.initialPending || state.globalPending || postPending) { state.status = 'compiling'; state.skippedFrames++; return false; }
        if (!pending.size) { for (const material of retired) material.dispose(); retired.clear(); }
        state.status = heldObjects.length ? 'streaming' : 'ready'; return true;
      } catch (error) {
        heldObjects.length = 0; state.heldObjects = 0;
        state.status = 'failed'; state.error = String(error?.message ?? error);
        // Keep Three's normal diagnostics/fallback if preparation itself fails.
        // A mere slow link cannot reach this path.
        return true;
      }
    },
    beforeRender() {
      for (const record of heldObjects) if (record.object.visible) {
        record.hiddenForDraw = true; record.object.visible = false;
      }
    },
    afterRender() {
      // The hold only surrounds this draw. Simulation, scene ownership, and
      // component visibility decisions see their original value next tick.
      for (const record of heldObjects) if (record.hiddenForDraw) {
        record.object.visible = true; record.hiddenForDraw = false;
      }
    },
    didRender() {
      presented = true;
      // Three increments version for each side of a double-sided transparent
      // draw. The material must have been eligible to draw with the saved
      // shader key before we accept that version for any of its users.
      for (const saved of drawVersions) {
        const { material, record } = saved;
        if (!record.active || record.hiddenForDraw || saved.version === material.version || drawnVersions.has(material)) continue;
        if (saved.key !== material.customProgramCacheKey()) continue;
        saved.beforeDrawVersion = saved.version;
        drawnVersions.set(material, saved);
      }
      if (drawnVersions.size) {
        for (const saved of drawVersions) {
          const drawn = drawnVersions.get(saved.material);
          if (drawn?.beforeDrawVersion === saved.version && drawn.key === saved.key) saved.version = saved.material.version;
        }
        drawnVersions.clear();
      }
    },
    invalidatePosts() { postsDirty = true; },
    dispose() {
      this.afterRender();
      disposed = true;
      gl.domElement?.removeEventListener('webglcontextrestored', invalidate);
      gl.domElement?.removeEventListener('webglcontextlost', invalidate);
      remove(scene);
      for (const material of retired) material.dispose(); retired.clear();
      pending.clear(); keys.clear(); drawVersions.clear(); globalWait.clear(); visibleLights.length = 0;
      state.status = 'disposed'; state.programKeys = [];
    },
  };
}

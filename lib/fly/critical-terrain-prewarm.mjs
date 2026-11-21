import { Mesh, MeshBasicMaterial } from 'three';

const HANDOFFS_PER_FRAME = 8;

/** Initial terrain publication, independent of React and renderer clocks.
 * Keep the tile tree updating; only its materials wait for the exact program.
 * Completion is committed by the next pre-render tick, after checking that the
 * live environment/shadow key still matches the asynchronously compiled key. */
export function criticalTerrainReady(state) {
  return !state?.required || state.status === 'ready';
}

export function terrainArrivalCovered(runtime, boot, phase) {
  return runtime?.worldLoading === true || (boot ? boot.pct < 100 : phase === 'boot');
}

export function isTerrainPreview(object) {
  return object.userData.__terrainPreview === true;
}

/** Draw the one resident satellite layer while its lit program links. The
 * tile still owns its imagery, geometry, visibility, and world transform. */
export function previewTerrainTile(model, source, { patchBend, daylight, onRemove }) {
  const geometry = model.geometry;
  if (!source.map?.image || !geometry.getAttribute('uv') ||
      (Array.isArray(model.material) && model.material.length !== 1)) return null;

  const material = new MeshBasicMaterial({ map: source.map, side: source.side, fog: source.fog,
    toneMapped: source.toneMapped, depthTest: source.depthTest, depthWrite: source.depthWrite,
    transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
    alphaMap: source.alphaMap, premultipliedAlpha: source.premultipliedAlpha });
  patchBend(material);
  const lod = source.userData.__lodFade;
  if (lod) {
    const patch = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.customProgramCacheKey = () => `${key}/preview-lod`;
    material.onBeforeCompile = (shader, renderer) => {
      patch.call(material, shader, renderer);
      Object.assign(shader.uniforms, { uLodFadeMix: lod.mix, uLodFadeUV: lod.uv, uLodFadeMap: lod.map });
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nuniform float uLodFadeMix;\nuniform vec4 uLodFadeUV;\nuniform sampler2D uLodFadeMap;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', lod.chunk.replace(
        'diffuseColor *= sampledDiffuseColor;',
        `if (uLodFadeMix > 0.0) {
          sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(uLodFadeMap, vMapUv * uLodFadeUV.xy + uLodFadeUV.zw), uLodFadeMix);
        }
        diffuseColor *= sampledDiffuseColor;`));
    };
  }

  const preview = new Mesh(geometry, material);
  preview.userData.__terrainPreview = true;
  preview.frustumCulled = model.frustumCulled;
  preview.layers.mask = model.layers.mask;
  preview.renderOrder = model.renderOrder;
  preview.raycast = () => {};
  preview.onBeforeRender = () => {
    const day = daylight();
    // Linear-light scale, with a small cool floor at full night. Tone mapping
    // and output conversion are still owned by the normal scene renderer.
    material.color.setRGB(.020 + .73 * day, .027 + .73 * day, .041 + .73 * day);
  };

  let active = true;
  let staged = null;
  const unstage = () => {
    if (staged && model.userData.terrainHandoff === staged) delete model.userData.terrainHandoff;
    staged = null;
  };
  const remove = event => {
    if (!active) return;
    active = false;
    model.removeEventListener('removed', remove);
    geometry.removeEventListener('dispose', remove);
    unstage();
    preview.removeFromParent();
    material.dispose();
    onRemove(event?.type === 'dispose' ? 'geometry' : 'removed');
  };
  // Three-tile removes the model before traversing and disposing its meshes.
  // Detach first so that traversal cannot dispose the borrowed DEM or map.
  model.addEventListener('removed', remove);
  geometry.addEventListener('dispose', remove);
  model.add(preview);
  // Composer preflight can prepare the exact source mesh while its original
  // material is still hidden and the borrowed imagery remains on screen.
  remove.stage = ready => { staged = model.userData.terrainHandoff = ready; };
  remove.unstage = unstage;
  remove.model = model;
  return remove;
}

export function createCriticalTerrainGate({ now = () => performance.now() } = {}) {
  const state = {
    required: true, status: 'waiting', createdAt: now(), startedAt: null,
    compiledAt: null, readyAt: null, endedAt: null, attempts: 0, held: 0, previews: 0,
    parallel: null, key: null, error: null, reason: null, cascadeCounts: [],
  };
  let held = new Map();
  const staged = new Map();
  let styleKey;
  let generation = 0, completed = null, terminal = false, resolveSettled, resolveDispatched, resolvePrograms;
  let settled = new Promise(resolve => { resolveSettled = resolve; });
  const dispatched = new Promise(resolve => { resolveDispatched = resolve; });
  let programs = new Promise(resolve => { resolvePrograms = resolve; });
  const releaseOne = (material, entry) => {
    held.delete(material); staged.delete(material);
    material.removeEventListener?.('dispose', entry.disposed);
    material.visible = entry.visible;
    entry.preview?.();
    state.held = held.size + staged.size;
  };
  const release = () => {
    for (const [material, entry] of staged) releaseOne(material, entry);
    for (const [material, entry] of held) releaseOne(material, entry);
  };
  const finish = (status, reason = null) => {
    if (terminal) return;
    terminal = true; generation++;
    state.status = status; state.reason = reason; state.endedAt = now();
    if (status === 'ready') state.readyAt = state.endedAt;
    if (status === 'unsupported') state.required = false;
    release(); resolveSettled(state); resolveDispatched(state); resolvePrograms(state);
  };
  const fail = error => {
    generation++; completed = null;
    state.status = 'failed'; state.reason = 'compile-error'; state.endedAt = now();
    state.error = String(error?.message ?? error);
    // A failed dispatch has no outstanding successful link to wait for. A
    // reduced entry may use the renderer's normal failure/diagnostic path;
    // an in-flight dispatch must never receive that fallback merely for
    // taking longer than the content arrival timer.
    if (state.bypassReason) release();
    resolveSettled(state); resolveDispatched(state); resolvePrograms(state);
  };
  return {
    state,
    hold(material, makePreview) {
      if (terminal || (state.status === 'failed' && state.bypassReason) || !material) return;
      let entry = held.get(material) ?? staged.get(material);
      if (!entry) {
        if (state.status === 'publishing') return;
        const disposed = () => releaseOne(material, entry);
        entry = { visible: material.visible, disposed, preview: null };
        held.set(material, entry);
        material.visible = false; material.addEventListener?.('dispose', disposed);
        state.held = held.size;
      }
      if (entry.visible && !entry.preview && makePreview) {
        entry.preview = makePreview(reason => {
          entry.preview = null; state.previews--;
          if (!staged.has(material)) return;
          if (reason === 'geometry') {
            staged.delete(material); held.set(material, entry);
          } else releaseOne(material, entry);
        });
        if (entry.preview) state.previews++;
      }
    },
    tick({ key, compile, parallel, available = true, covered = true, style, canStageTile }) {
      if (terminal) return;
      state.parallel = !!parallel;
      if (!parallel) { finish('unsupported', 'parallel-compile-unavailable'); return; }
      if (styleKey !== undefined && style !== styleKey) {
        // Retire the outgoing style's previews immediately. The incoming
        // style still needs its own matching key before it can report ready.
        release(); generation++; completed = null;
        Object.assign(state, {status:'waiting', key:null, startedAt:null, compiledAt:null, endedAt:null, error:null, reason:null});
      } else if (state.status === 'publishing' && completed?.key !== key) {
        // Keep showing the outstanding preview surfaces while the new
        // environment/light layout links, even if a new curtain covers them.
        for (const entry of staged.values()) entry.preview?.unstage?.();
        held = new Map([...staged, ...held]); staged.clear();
        state.status = 'waiting';
      }
      styleKey = style;
      if (completed?.key === key && completed.generation === generation) {
        if (covered || !state.held) { finish('ready'); return; }
        state.status = 'publishing';
        // Preserve terrain traversal/load order. A cold tile-specific key
        // occupies a slot until preflight confirms it; its preview keeps drawing.
        let slots = HANDOFFS_PER_FRAME - staged.size;
        for (const [material, entry] of staged) {
          if (!canStageTile?.(entry.preview?.model)) releaseOne(material, entry);
        }
        for (const [material, entry] of held) {
          if (slots-- <= 0) break;
          if (entry.preview?.stage && canStageTile?.(entry.preview.model)) {
            held.delete(material); staged.set(material, entry);
            entry.preview.stage(() => releaseOne(material, entry));
          } else releaseOne(material, entry);
        }
        if (!state.held) finish('ready');
        return;
      }
      // The content curtain may time out before the driver finishes. Keep
      // holding publication and checking the exact key after that timeout;
      // first-use introspection would otherwise synchronously finish the link.
      if (!covered && !state.bypassReason) this.bypass('arrival-already-revealed');
      if (state.status === 'failed') return;
      if (!available) return;
      if (state.status === 'bypassed' && state.key === key && state.startedAt != null && !completed) return;
      if (state.status === 'compiling' && state.key === key) return;
      const attempt = ++generation;
      state.status = 'compiling'; state.key = key; state.attempts++;
      state.startedAt = now(); state.compiledAt = null; completed = null;
      // Dispatch synchronously on this pre-render tick. Deferring dispatch to
      // idle is the first-draw race this gate exists to prevent.
      let pending;
      try { pending = compile(); }
      catch (error) { fail(error); return; }
      resolveDispatched(state);
      Promise.resolve(pending).then(() => {
        if (terminal || attempt !== generation) return;
        state.compiledAt = now(); completed = { key, generation: attempt };
      }, error => {
        if (terminal || attempt !== generation) return;
        fail(error);
      });
    },
    wait: () => settled,
    // Separate renderer milestones. A curtain timeout resolves wait() but
    // cannot authorize secondary compilation of an outstanding terrain key.
    waitForDispatch: () => dispatched,
    waitForPrograms: () => programs,
    retry() {
      if (terminal || state.status !== 'failed') return false;
      generation++; completed = null;
      state.status = 'waiting'; state.error = null; state.reason = null;
      state.startedAt = state.compiledAt = state.endedAt = null;
      settled = new Promise(resolve => { resolveSettled = resolve; });
      programs = new Promise(resolve => { resolvePrograms = resolve; });
      return true;
    },
    bypass(reason) {
      if (terminal || state.status === 'bypassed' || state.status === 'publishing') return;
      const failed = state.status === 'failed';
      state.status = 'bypassed'; state.reason = reason; state.bypassReason = reason; state.endedAt = now();
      // This releases the CONTENT wait (so optional warm work can continue),
      // not pending GPU programs. Failed/unsupported paths still have their
      // original degraded fallback; a slow parallel link is neither of those.
      if (failed) { state.status = 'failed'; release(); }
      resolveSettled(state);
    },
    dispose: () => finish('disposed', 'engine-disposed'),
  };
}

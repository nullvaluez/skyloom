/** Initial terrain publication, independent of Three/React and renderer clocks.
 * Keep the tile tree updating; only its materials wait for the exact program.
 * Completion is committed by the next pre-render tick, after checking that the
 * live environment/shadow key still matches the asynchronously compiled key. */
export function criticalTerrainReady(state) {
  return !state?.required || state.status === 'ready';
}

export function terrainArrivalCovered(runtime, boot, phase) {
  return runtime?.worldLoading === true || (boot ? boot.pct < 100 : phase === 'boot');
}

export function createCriticalTerrainGate({ now = () => performance.now() } = {}) {
  const state = {
    required: true, status: 'waiting', createdAt: now(), startedAt: null,
    compiledAt: null, readyAt: null, endedAt: null, attempts: 0, held: 0,
    parallel: null, key: null, error: null, reason: null, cascadeCounts: [],
  };
  const held = new Map();
  let generation = 0, completed = null, terminal = false, resolveSettled;
  let settled = new Promise(resolve => { resolveSettled = resolve; });
  const release = () => {
    for (const [material, entry] of held) {
      material.removeEventListener?.('dispose', entry.disposed);
      material.visible = entry.visible;
    }
    held.clear(); state.held = 0;
  };
  const finish = (status, reason = null) => {
    if (terminal) return;
    terminal = true; generation++;
    state.status = status; state.reason = reason; state.endedAt = now();
    if (status === 'ready') state.readyAt = state.endedAt;
    if (status === 'unsupported') state.required = false;
    release(); resolveSettled(state);
  };
  const fail = error => {
    generation++; completed = null;
    state.status = 'failed'; state.reason = 'compile-error'; state.endedAt = now();
    state.error = String(error?.message ?? error);
    // Let the general warm report its own result, but do not first-draw the
    // failed terrain program while arrival is still covered. Retry or the
    // existing explicit/capped degraded reveal owns publication from here.
    resolveSettled(state);
  };
  return {
    state,
    hold(material) {
      if (terminal || !material || held.has(material)) return;
      const disposed = () => {
        held.delete(material); state.held = held.size;
        material.removeEventListener?.('dispose', disposed);
      };
      held.set(material, { visible: material.visible, disposed });
      material.visible = false; material.addEventListener?.('dispose', disposed);
      state.held = held.size;
    },
    tick({ key, compile, parallel, available = true, covered = true }) {
      if (terminal) return;
      state.parallel = !!parallel;
      if (!parallel) { finish('unsupported', 'parallel-compile-unavailable'); return; }
      if (!covered) { finish('bypassed', 'arrival-already-revealed'); return; }
      if (state.status === 'failed') return;
      if (!available) return;
      if (completed?.key === key && completed.generation === generation) {
        finish('ready'); return;
      }
      if (state.status === 'compiling' && state.key === key) return;
      const attempt = ++generation;
      state.status = 'compiling'; state.key = key; state.attempts++;
      state.startedAt = now(); state.compiledAt = null; completed = null;
      // Dispatch synchronously on this pre-render tick. Deferring dispatch to
      // idle is the first-draw race this gate exists to prevent.
      let pending;
      try { pending = compile(); }
      catch (error) { fail(error); return; }
      Promise.resolve(pending).then(() => {
        if (terminal || attempt !== generation) return;
        state.compiledAt = now(); completed = { key, generation: attempt };
      }, error => {
        if (terminal || attempt !== generation) return;
        fail(error);
      });
    },
    wait: () => settled,
    retry() {
      if (terminal || state.status !== 'failed') return false;
      generation++; completed = null;
      state.status = 'waiting'; state.error = null; state.reason = null;
      state.startedAt = state.compiledAt = state.endedAt = null;
      settled = new Promise(resolve => { resolveSettled = resolve; });
      return true;
    },
    bypass: reason => finish('bypassed', reason),
    dispose: () => finish('disposed', 'engine-disposed'),
  };
}

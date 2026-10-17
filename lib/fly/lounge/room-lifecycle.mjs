/** Room shader ownership independent of React and WebGL driver timing. */
export function createRoomWarmLifecycle({ now = () => performance.now() } = {}) {
  const state = { required: true, status: 'waiting', startedAt: null, readyAt: null,
    error: null, reason: null, bypassReason: null, bypassedAt: null, cascadeCounts: [] };
  const pending = new Set();
  let active = true, generation = 0, released = false;
  const reset = (reason = null, { preserveReveal = false } = {}) => {
    generation++;
    // A new context/mount needs new GPU evidence. Only an explicit retry of
    // already revealed degraded content may preserve its current visibility.
    if (!preserveReveal) released = false;
    Object.assign(state, { status: 'waiting', startedAt: null, readyAt: null, error: null, reason });
  };
  return {
    state,
    activate() { active = true; reset('mounted'); },
    reset,
    current: () => generation,
    valid: token => active && generation === token,
    canShow: () => released || state.status === 'ready',
    afterPending: () => Promise.allSettled([...pending]),
    fail(error, reason = 'compile-error') {
      if (!active) return;
      Object.assign(state, { status: 'failed', error: String(error?.message ?? error), reason });
    },
    bypass(reason) {
      if (state.status === 'ready') return;
      released = true;
      Object.assign(state, { status: 'bypassed', reason, bypassReason: reason, bypassedAt: now() });
    },
    run(compile, onReady = () => {}, onFailure = () => {}) {
      const token = generation;
      Object.assign(state, { status: 'compiling', startedAt: now(), error: null });
      let work;
      try { work = compile(); } catch (error) { work = Promise.reject(error); }
      const settled = Promise.resolve(work).then(() => {
        if (!active || generation !== token) return;
        // Current readiness recovers; the historical degraded-arrival reason
        // stays separately available and cannot strand a later airport visit.
        Object.assign(state, { status: 'ready', readyAt: now(), error: null, reason: null });
        onReady();
      }, (error) => {
        if (!active || generation !== token) return;
        Object.assign(state, { status: 'failed', error: String(error?.message ?? error), reason: 'compile-error' });
        onFailure(error);
      });
      pending.add(settled);
      settled.then(() => pending.delete(settled));
      return settled;
    },
    deactivate(dispose) {
      active = false;
      const token = ++generation;
      return Promise.allSettled([...pending]).then(() => {
        // React StrictMode may remount the same resource before old work
        // settles. That newer lease owns disposal from this point onward.
        if (!active && generation === token) dispose();
      });
    },
  };
}

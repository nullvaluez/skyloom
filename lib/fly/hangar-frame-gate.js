/** R3F's shared loop still renders `never` roots with queued internal.frames.
 * Keep the hangar root stopped through queued invalidations and stale Canvas
 * configuration commits. Root-local advance() remains available to prewarm.
 */
export function createHangarFrameGate(store) {
  const state = { held: true, generation: 0, drainedFrames: 0, preventedResumes: 0 };
  let enforcing = false, disposed = false;
  const enforce = () => {
    if (disposed || !state.held || enforcing) return;
    enforcing = true;
    try {
      const root = store.getState();
      state.drainedFrames += root.internal.frames;
      root.internal.frames = 0;
      if (root.frameloop !== 'never') {
        state.preventedResumes++;
        root.setFrameloop('never');
      }
      // Store subscribers run synchronously; drain again after changing mode.
      store.getState().internal.frames = 0;
    } finally { enforcing = false; }
  };
  const unsubscribe = store.subscribe(enforce);
  enforce();
  return {
    state,
    hold() {
      if (disposed) return state.generation;
      state.held = true; state.generation++;
      enforce();
      return state.generation;
    },
    release(generation) {
      if (disposed || generation !== state.generation) return false;
      state.held = false;
      store.getState().setFrameloop('always');
      return true;
    },
    dispose() {
      if (disposed) return;
      state.held = true; enforce();
      disposed = true; unsubscribe();
    },
  };
}

'use client';

import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';

/** Pause belongs to the same Back chain as the other full overlays. */
export function anyOverlayOpen(s) {
  return !!s.inspectHex || s.cameraMode === 'photo' || s.atlasOpen ||
    s.logbookOpen || s.hangarOpen || s.creditsOpen || s.phase === 'paused';
}

export function escapeStep(s) {
  if (s.inspectHex) s.setInspectHex(null);
  else if (s.cameraMode === 'photo') s.setCameraMode('chase');
  else if (s.atlasOpen) s.setAtlasOpen(false);
  else if (s.logbookOpen) s.setLogbookOpen(false);
  else if (s.hangarOpen) s.setHangarOpen(false);
  else if (s.creditsOpen) s.closeCredits();
  else if (s.phase === 'paused') s.setPhase('flying');
}

/**
 * One sentinel for touch panels and full overlays. Programmatic dismissal
 * consumes it asynchronously; reopening before that popstate must neither
 * create another entry nor let the old pop dismiss the newly opened panel.
 * Existing Next/router history state is preserved when adding our marker.
 */
export function useOverlayBack(enabled = true, transientOpen = false, closeTransient, readTransient) {
  const pending = useRef({ pushed: false, consuming: false });
  const transient = useRef({});
  const sync = useRef(null);
  useEffect(() => {
    transient.current = { open: transientOpen, close: closeTransient, read: readTransient };
    sync.current?.();
  }, [transientOpen, closeTransient, readTransient]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const state = pending.current;
    const hasTransient = () => transient.current.read?.() ?? transient.current.open;
    const hasSurface = () => hasTransient() || anyOverlayOpen(useFlyStore.getState());
    const push = () => {
      if (state.pushed || state.consuming) return;
      try {
        window.history.pushState({ ...window.history.state, __flyOverlay: true }, '');
        state.pushed = true;
      } catch { /* History may be unavailable in an embedded game. */ }
    };
    const consume = () => {
      if (!state.pushed || state.consuming) return;
      state.pushed = false;
      // Never consume a router entry that superseded our own sentinel.
      if (!window.history.state?.__flyOverlay) return;
      state.consuming = true;
      try { window.history.back(); }
      catch { state.consuming = false; }
    };
    const update = () => { if (hasSurface()) push(); else consume(); };
    const onPop = () => {
      state.pushed = false;
      if (state.consuming) {
        state.consuming = false;
        update();
        return;
      }
      if (hasTransient()) transient.current.close?.();
      else escapeStep(useFlyStore.getState());
      if (hasSurface()) push();
    };
    window.addEventListener('popstate', onPop);
    sync.current = update;
    update();
    const unsubscribe = useFlyStore.subscribe(anyOverlayOpen, update);
    return () => {
      unsubscribe();
      sync.current = null;
      window.removeEventListener('popstate', onPop);
      consume();
    };
  }, [enabled]);
}

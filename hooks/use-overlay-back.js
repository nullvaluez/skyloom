'use client';

import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { FRONT_DOOR } from '@/lib/fly/fly-constants';

/**
 * Pause belongs to the same Back chain as the other full overlays.
 * R25 (A FRONT DOOR): the title's Settings sheet is one more surface. The
 * title ROOT is deliberately not: it is the app's home screen, so Back there
 * is ordinary browser navigation (no sentinel is pushed) — and escapeStep is
 * a no-op on it either way, so Back can never reveal an unstarted world.
 * `settingsOpen` can only be true once the title ships, so with FRONT_DOOR off
 * this predicate is today's.
 */
export function anyOverlayOpen(s) {
  return !!s.inspectHex || s.cameraMode === 'photo' || s.atlasOpen ||
    s.logbookOpen || s.hangarOpen || s.creditsOpen || s.phase === 'paused' || !!s.settingsOpen;
}

/**
 * One Back/Esc step (plan "Keyboard and Back"):
 *   inspect -> photo -> atlas -> logbook -> settings sheet -> hangar -> credits -> pause.
 * Hangar: a DISMISSIBLE hangar is the mid-flight return confirmation and Back
 * cancels it (unchanged). A pre-flight hangar (hangarDismissible false) returns
 * to the title when the front door ships; with FRONT_DOOR off selection stays
 * mandatory (today). On the title root nothing happens.
 */
export function escapeStep(s) {
  if (s.inspectHex) s.setInspectHex(null);
  else if (s.cameraMode === 'photo') s.setCameraMode('chase');
  else if (s.atlasOpen) s.setAtlasOpen(false);
  else if (s.logbookOpen) s.setLogbookOpen(false);
  else if (s.settingsOpen) s.setSettingsOpen(false);
  // Selection is mandatory at startup and after ending a flight. Back may
  // cancel the return confirmation, but cannot reveal an unstarted world.
  else if (s.hangarOpen) {
    if (s.hangarDismissible !== false) s.setHangarOpen(false);
    else if (FRONT_DOOR.enabled) s.setScreen('title');
  }
  else if (s.creditsOpen) s.closeCredits();
  else if (s.phase === 'paused') s.setPhase('flying');
  // screen 'title' (the root): no-op.
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

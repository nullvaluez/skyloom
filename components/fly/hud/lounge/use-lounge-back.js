'use client';
import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { anyOverlayOpen } from '@/hooks/use-overlay-back';

/*
 * LOUNGE MOBILE — GLASS: Android Back (and the browser's back) in the lounge
 * on a touch device. Back closes the topmost lounge layer — a sheet, then the
 * binoculars, then the selection — and at the lounge's root it leaves the
 * lounge the way desktop Esc does (watch.exit(): back to where it was entered
 * from). It never leaves the app: while the lounge is up one history sentinel
 * of ours is always under the current entry.
 *
 * It shares the history with the flight HUD's chain (hooks/use-overlay-back.js,
 * mounted by TouchControls, which stays mounted under the lounge): that one
 * pushes its own sentinel for the full overlays (inspect, Atlas, logbook,
 * pause) and closes them on Back. Ours is told apart by a token in its state:
 *  - a pop that lands on an entry still carrying our token popped something
 *    pushed above ours (the flight chain's): not ours, nothing to do;
 *  - a pop of ours while a full overlay is open (read in the CAPTURE phase,
 *    before the flight chain's listener closes it) belongs to that overlay:
 *    we only put our sentinel back;
 *  - otherwise `close()` (the caller's topmost-layer step) runs, and the
 *    sentinel goes back while the lounge is still up.
 * Unmounting pops our sentinel a tick later unless a new mount adopted it
 * (StrictMode's mount / unmount / mount, or the HUD remounting for a new
 * airport), so no stale entry is ever left behind.
 * `enabled` false (a fine-pointer desktop): nothing is pushed or heard.
 * `keep()` says whether the surface is still up (default: the lounge); the
 * airport browser opened from the title uses the same chain with its own.
 */
let live = 0;
const loungeUp = () => !!useFlyStore.getState().airportWatch;

export function useLoungeBack(enabled, close, keep = loungeUp) {
  const closeRef = useRef(close);
  const keepRef = useRef(keep);
  useEffect(() => {
    closeRef.current = close;
    keepRef.current = keep;
  }, [close, keep]);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    live++;
    // Adopt a sentinel a moment-ago instance left (it pops it only if no one did).
    const adopted = window.history.state?.__flyLounge;
    const token = adopted || `lounge-${Math.random().toString(36).slice(2, 10)}`;
    const state = { pushed: !!adopted, alive: true, timer: 0 };
    const ours = () => window.history.state?.__flyLounge === token;
    const push = () => {
      if (!state.alive || state.pushed || !keepRef.current()) return;
      try {
        window.history.pushState({ ...window.history.state, __flyOverlay: true, __flyLounge: token }, '');
        state.pushed = true;
      } catch {
        // History may be unavailable in an embedded game.
      }
    };
    const onPop = () => {
      if (ours() || !state.pushed) return; // something pushed above ours was popped
      state.pushed = false;
      // A full overlay owns this Back (the flight chain closes it next).
      if (!anyOverlayOpen(useFlyStore.getState())) closeRef.current?.();
      // Put ours back once the step has settled (leaving the lounge unmounts
      // us instead).
      clearTimeout(state.timer);
      state.timer = setTimeout(push, 0);
    };
    window.addEventListener('popstate', onPop, true);
    push();
    return () => {
      live--;
      state.alive = false;
      clearTimeout(state.timer);
      window.removeEventListener('popstate', onPop, true);
      if (!state.pushed) return;
      setTimeout(() => {
        if (live > 0 || window.history.state?.__flyLounge !== token) return;
        try {
          window.history.back();
        } catch {
          // nothing to unwind
        }
      }, 0);
    };
  }, [enabled]);
}

'use client';
import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { anyOverlayOpen, backFromCode, heardPop, popPending, sentinelState, whenSettled } from '@/hooks/use-overlay-back';

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
 * pause) and closes them on Back. The two never mistake each other's entries
 * (use-overlay-back.js says how: one tag per sentinel, `__flyLounge: <token>`
 * here, and every pop made from code announced, so it is never a Back step):
 *  - a pop made from code (the flight chain unwinding its sentinel, or ours):
 *    no step; ours goes back if it went;
 *  - a pop that lands on an entry still carrying our token popped something
 *    pushed above ours (the flight chain's): not ours, nothing to do;
 *  - a pop of ours that lands on the flight chain's sentinel: our layer sat
 *    ABOVE its overlay (the airport browser opened over the Atlas), so the
 *    Back is ours: `close()` (the Atlas stays, and the flight chain, whose
 *    sentinel is current again, does nothing);
 *  - a pop of ours while a full overlay is open (read in the CAPTURE phase,
 *    before the flight chain's listener closes it) belongs to that overlay:
 *    we only put our sentinel back;
 *  - otherwise `close()` (the caller's topmost-layer step) runs, and the
 *    sentinel goes back while the lounge is still up.
 * A push waits while a pop made from code is on its way (it would land under
 * that traversal). Unmounting pops our sentinel a tick later unless a new
 * mount adopted it (StrictMode's mount / unmount / mount, the HUD remounting
 * for a new airport, or the lounge taking over the airport browser's), so no
 * stale entry is ever left behind.
 * `enabled` false (a fine-pointer desktop): nothing is pushed or heard.
 * `keep()` says whether the surface is still up (default: the lounge); the
 * airport browser (from the title, or over the Atlas in flight) uses the same
 * chain with its own.
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
      // A pop made from code is on its way: push once it has landed.
      if (popPending()) return void whenSettled(push);
      try {
        window.history.pushState(sentinelState('__flyLounge', token), '');
        state.pushed = true;
      } catch {
        // History may be unavailable in an embedded game.
      }
    };
    const later = () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(push, 0);
    };
    const onPop = (e) => {
      if (heardPop(e)) {
        // Unwound from code: never a Back step. Ours stays, or comes back.
        state.pushed = ours();
        if (!state.pushed) later();
        return;
      }
      if (ours() || !state.pushed) return; // something pushed above ours was popped
      state.pushed = false;
      // Ours sat above the flight chain's sentinel (the browser over the
      // Atlas): this Back is ours. Else a full overlay open now owns it (the
      // flight chain closes it next).
      const aboveFlight = !!window.history.state?.__flyOverlay;
      if (aboveFlight || !anyOverlayOpen(useFlyStore.getState())) closeRef.current?.();
      // Put ours back once the step has settled (leaving the lounge unmounts
      // us instead).
      later();
    };
    window.addEventListener('popstate', onPop, true);
    push();
    return () => {
      live--;
      state.alive = false;
      clearTimeout(state.timer);
      window.removeEventListener('popstate', onPop, true);
      if (!state.pushed) return;
      setTimeout(() => whenSettled(() => {
        if (live > 0 || window.history.state?.__flyLounge !== token) return;
        backFromCode('lounge');
      }), 0);
    };
  }, [enabled]);
}

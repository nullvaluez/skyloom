'use client';

import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';

/**
 * ROUND 17 (A5) — the Android / in-browser BACK gesture closes a Fly overlay
 * instead of leaving the game.
 *
 * THE PROBLEM. Every overlay in Fly Mode unwinds with Escape, and on a phone
 * there is no Escape. The system back gesture is the platform's Escape, but a
 * single-page app that never pushes history answers it by navigating AWAY —
 * so on a phone, reflexively swiping back out of the Atlas dropped you out of
 * the flight entirely.
 *
 * THE SHAPE. One SENTINEL history entry, not one per overlay:
 *
 *   · the first time ANY overlay opens, push exactly one state
 *     (`{ __flyOverlay: true }`) — the stack is now [page, sentinel];
 *   · a back gesture pops the sentinel and fires popstate. We replay ONE step
 *     of the Escape priority chain, and if something is still open we push the
 *     sentinel again, so the next back closes the next layer;
 *   · when the last overlay closes by any other route (the ✕, Esc, a warp),
 *     we consume our own sentinel with history.back().
 *
 * WHY ONE SENTINEL AND NOT A STACK. Overlays do not only close in the order
 * they opened — a warp closes the Atlas, the inspect card's WARP closes
 * itself, the pause menu closes everything. A per-overlay stack would leave
 * orphan entries behind every one of those, and the user would then have to
 * press back three times to actually leave. One sentinel is always either
 * present or not, and the boolean that tracks it is checked before every
 * history call.
 *
 * WHY IT IS TOUCH-ONLY. On desktop there is no back gesture and a mouse user
 * pressing the browser Back button means it. Pushing history for them would
 * make the browser's forward/back buttons behave differently in this app than
 * in every other one. The `enabled` gate is resolved by the CALLER (this hook
 * is mounted from TouchControls, which only exists on touch), and re-checked
 * here so the hook is safe to mount anywhere.
 *
 * STRICTMODE. React 19 dev double-invokes effects. `pushed` lives in a ref
 * that survives the remount, and every push is guarded on it, so a double
 * mount can never stack two sentinels. All history calls are wrapped: a
 * sandboxed iframe or a privacy mode that blocks history throws instead of
 * returning, and a HUD button must not be able to take the frame loop down
 * with it.
 *
 * NEVER PER-FRAME. It subscribes to six discrete booleans through
 * `useFlyStore.subscribe` (transient — no re-render), and does DOM work only
 * on the frames where "is any overlay open" actually flips.
 */

/** True when any Esc-chain overlay owns the screen. */
function anyOverlayOpen(s) {
  return (
    !!s.inspectHex ||
    s.cameraMode === 'photo' ||
    s.atlasOpen ||
    s.logbookOpen ||
    s.hangarOpen ||
    s.creditsOpen
  );
}

/**
 * ONE step of FlyMode's Escape priority chain, replayed verbatim:
 * inspect → photo → atlas → logbook → hangar → credits → pause.
 *
 * Deliberately a COPY of the order and not a shared import: FlyMode's listener
 * is A4's file this round, and a cross-file import for six lines would have
 * coupled two agents' files for no behavioural gain. The order is asserted by
 * verify-mobile, so a future divergence is caught rather than guessed at.
 */
function escapeStep(store) {
  if (store.inspectHex) store.setInspectHex(null);
  else if (store.cameraMode === 'photo') store.setCameraMode('chase');
  else if (store.atlasOpen) store.setAtlasOpen(false);
  else if (store.logbookOpen) store.setLogbookOpen(false);
  else if (store.hangarOpen) store.setHangarOpen(false);
  else if (store.creditsOpen) store.closeCredits();
  else if (store.phase === 'paused') store.setPhase('flying');
  else return false; // nothing was open — let the navigation happen
  return true;
}

export function useOverlayBack(enabled = true) {
  // Whether OUR sentinel is currently the top of the history stack. A ref, not
  // state: it is a fact about the browser, never a render input.
  const pushed = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.history) return undefined;

    const push = () => {
      if (pushed.current) return;
      try {
        window.history.pushState({ __flyOverlay: true }, '');
        pushed.current = true;
      } catch {
        /* history blocked (sandboxed frame) — the hook degrades to a no-op */
      }
    };

    // Consume our own sentinel. Only ever called when pushed.current is true,
    // so this can never eat the host page's entry.
    const consume = () => {
      if (!pushed.current) return;
      pushed.current = false;
      try {
        window.history.back();
      } catch {
        /* see push() */
      }
    };

    const onPop = () => {
      // The sentinel is gone — the browser already popped it.
      pushed.current = false;
      const store = useFlyStore.getState();
      if (!anyOverlayOpen(store)) return; // nothing of ours to close
      escapeStep(store);
      // Still layered? Re-arm so the NEXT back closes the next layer.
      if (anyOverlayOpen(useFlyStore.getState())) push();
    };

    window.addEventListener('popstate', onPop);

    // Arm immediately if an overlay is somehow already open at mount.
    if (anyOverlayOpen(useFlyStore.getState())) push();

    const unsub = useFlyStore.subscribe(anyOverlayOpen, (open) => {
      if (open) push();
      else consume();
    });

    return () => {
      unsub();
      window.removeEventListener('popstate', onPop);
      // Leave the stack as we found it — an unmount (exiting Fly Mode) must
      // not strand a phantom entry that swallows the user's next back.
      consume();
    };
  }, [enabled]);
}

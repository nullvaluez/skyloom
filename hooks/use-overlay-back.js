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
  return !!s.adventureOpen || !!s.inspectHex || s.cameraMode === 'photo' || s.atlasOpen ||
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
  if (s.adventureOpen) s.closeAdventureOverlay?.();
  else if (s.inspectHex) s.setInspectHex(null);
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

/*
 * LOUNGE MOBILE: one history, two Back chains. This hook's sentinel
 * (`__flyOverlay: <token>`, the flight HUD's panels and full overlays) and the
 * lounge's (`__flyLounge: <token>`, components/fly/hud/lounge/use-lounge-back.js,
 * the lounge and the airport browser) share the browser's history. So that
 * neither can take the other's entry for its own:
 *  - a sentinel carries exactly ONE chain's tag (sentinelState() copies the
 *    current entry, router state kept, without either chain's tag) and its
 *    own token, and a chain only ever unwinds an entry carrying its token;
 *  - a chain that unwinds its sentinel from code says so (backFromCode):
 *    every popstate listener then hears that pop as code's (heardPop: the
 *    owner, or null for the player's Back) and only re-syncs, never runs a
 *    Back step for it;
 *  - while such a pop is on its way nobody pushes (popPending): a pushState
 *    slipped under a queued traversal is the entry that traversal removes.
 *    The pusher retries when the pop lands (every listener re-syncs then) or
 *    through whenSettled().
 * A same-document traversal always fires its popstate; an expectation nothing
 * has heard after STALE_MS is dropped so a lost one can never wedge the chain.
 */
const STALE_MS = 4000;
const unwinding = []; // { owner, at }: history.back() calls made from code, oldest first
const heard = new WeakMap(); // popstate event -> its owner (null: the player's Back)
const settled = []; // callbacks waiting for the pops on their way

function prunePops() {
  const now = Date.now();
  while (unwinding.length && now - unwinding[0].at > STALE_MS) unwinding.shift();
}
function settle() {
  if (popPending()) return;
  for (const fn of settled.splice(0)) fn();
}

/** A pop issued from code has not reached its popstate yet. */
export function popPending() {
  prunePops();
  return unwinding.length > 0;
}

/** Unwind one entry from code, as `owner` ('flight' | 'lounge'). */
export function backFromCode(owner) {
  unwinding.push({ owner, at: Date.now() });
  try {
    window.history.back();
    return true;
  } catch {
    unwinding.pop();
    return false;
  }
}

/**
 * Who this popstate belongs to: the owner of the oldest pop issued from code,
 * or null (the player's Back). Every listener of one event hears the same
 * answer (the event object keys it; a call without one takes the next).
 */
export function heardPop(e) {
  const keyed = typeof e === 'object' && e !== null;
  if (keyed && heard.has(e)) return heard.get(e);
  prunePops();
  const owner = unwinding.length ? unwinding.shift().owner : null;
  if (keyed) heard.set(e, owner);
  // After this event's listeners have all re-synced.
  if (settled.length && typeof setTimeout === 'function') setTimeout(settle, 0);
  return owner;
}

/** Run `fn` once no pop issued from code is on its way. */
export function whenSettled(fn) {
  if (!popPending()) {
    fn();
    return;
  }
  settled.push(fn);
  if (typeof setTimeout === 'function') setTimeout(settle, STALE_MS + 50);
}

/** A sentinel entry: the current entry's state (the router's kept) tagged for one chain only. */
export function sentinelState(tag, token) {
  const next = { ...window.history.state };
  delete next.__flyOverlay;
  delete next.__flyLounge;
  next[tag] = token;
  return next;
}

/**
 * One sentinel for touch panels and full overlays. Programmatic dismissal
 * consumes it asynchronously; reopening before that popstate must neither
 * create another entry nor let the old pop dismiss the newly opened panel.
 * Existing Next/router history state is preserved when adding our marker.
 * LOUNGE MOBILE: the marker is this instance's token (see above): a lounge
 * sentinel pushed above ours is never consumed, and a player's Back that took
 * that entry (our sentinel is the current one again) is not ours to answer.
 */
export function useOverlayBack(enabled = true, transientOpen = false, closeTransient, readTransient) {
  const pending = useRef({ pushed: false });
  const transient = useRef({});
  const sync = useRef(null);
  useEffect(() => {
    transient.current = { open: transientOpen, close: closeTransient, read: readTransient };
    sync.current?.();
  }, [transientOpen, closeTransient, readTransient]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const state = pending.current;
    const token = `overlay-${Math.random().toString(36).slice(2, 10)}`;
    const ours = () => window.history.state?.__flyOverlay === token;
    const hasTransient = () => transient.current.read?.() ?? transient.current.open;
    const hasSurface = () => hasTransient() || anyOverlayOpen(useFlyStore.getState());
    const push = () => {
      // A pop on its way (ours being consumed, or the lounge's): push once it
      // has landed (onPop re-syncs).
      if (state.pushed || popPending()) return;
      try {
        window.history.pushState(sentinelState('__flyOverlay', token), '');
        state.pushed = true;
      } catch { /* History may be unavailable in an embedded game. */ }
    };
    const consume = () => {
      if (!state.pushed) return;
      state.pushed = false;
      // Never consume an entry that is not our own sentinel: a router entry
      // that superseded it, or a lounge sentinel pushed above it.
      if (!ours()) return;
      backFromCode('flight');
    };
    const update = () => { if (hasSurface()) push(); else consume(); };
    const onPop = (e) => {
      if (heardPop(e)) {
        // Unwound from code (our consumption or the lounge's): re-sync only.
        state.pushed = ours();
        update();
        return;
      }
      if (ours()) {
        // Our sentinel is current again: the player's Back took an entry
        // pushed above it (the lounge's, or the airport browser's over the
        // Atlas), which its own chain answers. An orphan of ours goes now.
        state.pushed = true;
        update();
        return;
      }
      state.pushed = false;
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

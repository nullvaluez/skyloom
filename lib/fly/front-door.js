'use client';

// R25 A FRONT DOOR — title screen state helpers. W0 STUBS: signatures are the
// contract; A fills the bodies. With FRONT_DOOR.enabled false every function
// returns today's behaviour (mandatory hangar at boot, demand frameloop while
// the hangar is open, spotting allowed whenever it is today).

import { useFlyStore } from '@/stores/fly-store';
import { graphicsReviewOn } from './satellite-visuals';

/** Harness pin: window.__flyTitleBypass === true skips the title (dev / graphicsReview only). */
export function titleBypassPinned() {
  if (typeof window === 'undefined') return false;
  if (!(process.env.NODE_ENV === 'development' || graphicsReviewOn())) return false;
  return window.__flyTitleBypass === true;
}

/** Pre-mount: which screen the session opens on. W0: today's mandatory hangar. */
export function resolveInitialScreen() {
  return 'hangar';
}

/** FlyCanvas frameloop selector (zustand selector shape). W0: today's rule. */
export function frameloopFor(s) {
  return s.hangarOpen ? 'demand' : 'always';
}

/** Passport spotting gate (FlyScene logSpot). W0: today's behaviour (always). */
export function spotAllowed(_s) {
  return true;
}

/** React hook: hide the player group on the title. */
export function useTitleHidden() {
  return useFlyStore((s) => s.screen === 'title');
}

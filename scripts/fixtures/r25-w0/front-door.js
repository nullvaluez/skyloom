// SHIP PASS RL-1 FIXTURE: `r25-w0:lib/fly/front-door.js` for shallow clones (CI checks out
// depth 1, and the r25-w0 tag is not on origin). r25-w0 is commit
// db78bdf768756a3dd3b31c4fb64c7309adb07869 ("R25 W0: scaffold the front door,
// flight plan and visuals profile", CLEAR_SKY_VISUALS.md). Fetched 2026-10-30
// from origin with the GitHub contents API at that ref; git blob ecdd12703a6feebeca5e961eda38f491496ba7ca.
// Everything after the marker line below is that blob byte for byte;
// scripts/_r25-w0-baseline.mjs re-hashes it before any gate uses it.
// ---- r25-w0 blob below ----
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

'use client';

// R25 Visuals profile — 'enhanced' | 'classic' (plan FLY_ROUND25_PLAN.md §Visuals).
// W0 writes this module in full; A FRONT DOOR owns it afterwards.
//
// THE ONE PREDICATE: every R25 C SKY / D GROUND decision point (shader text,
// customProgramCacheKey token, CPU uniform write, allocation) goes through
// r25On(block, sub). Text and key derive from the same predicate, so they can
// never disagree (the R4 registry lesson), and Classic produces today's text
// and keys exactly — Classic IS the flag-off tree, by construction.
//
// Resolution precedence (pre-mount, the map-style.js / fly-settings.js beat):
//   dev/graphicsReview pin window.__flyVisualsOverride ∈ {'classic','enhanced'}
//   > localStorage VISUALS.key
//   > VISUALS.defaultProfile when visualsAvailable()
//   > 'classic'.
// Harnesses pin 'classic' (scripts/_boot.js) so the legacy fleet runs the
// flag-off tree; Enhanced gates un-pin via unpinPins(['__flyVisualsOverride']).
//
// Dev sub-pins for E's luminance columns (C-only / D-only):
//   window.__flyR25Sky = 0    forces R25_SKY off even in Enhanced
//   window.__flyR25Ground = 0 forces R25_GROUND off even in Enhanced

import { useFlyStore } from '@/stores/fly-store';
import { VISUALS, R25_SKY, R25_GROUND } from './fly-constants';
import { graphicsReviewOn } from './satellite-visuals';

const PROFILES = ['classic', 'enhanced'];

function pinsReadable() {
  return typeof window !== 'undefined' && (process.env.NODE_ENV === 'development' || graphicsReviewOn());
}

/** At least one R25 visual block ships ON — otherwise the Settings row hides and everything is Classic. */
export function visualsAvailable() {
  return !!(R25_SKY.enabled || R25_GROUND.enabled);
}

/** The harness/dev pin, or null. */
export function visualsPinned() {
  if (!pinsReadable()) return null;
  const v = window.__flyVisualsOverride;
  return PROFILES.includes(v) ? v : null;
}

/** Pre-mount resolve into the store. Idempotent; storage-blocked falls through to defaults. */
export function resolveInitialVisuals() {
  if (typeof window === 'undefined') return;
  let profile = visualsPinned();
  if (!profile) {
    let saved = null;
    try {
      saved = window.localStorage.getItem(VISUALS.key);
    } catch {
      saved = null;
    }
    if (PROFILES.includes(saved)) profile = saved;
    else profile = visualsAvailable() ? VISUALS.defaultProfile : 'classic';
  }
  if (!visualsAvailable()) profile = 'classic';
  const store = useFlyStore.getState();
  if (store.visuals !== profile) store.setVisuals(profile);
}

/** Live: the current session profile is Enhanced (and some R25 block exists to enhance). */
export function visualsEnhanced() {
  return visualsAvailable() && useFlyStore.getState().visuals === 'enhanced';
}

function subPinOff(block) {
  if (!pinsReadable()) return false;
  if (block === R25_SKY && window.__flyR25Sky === 0) return true;
  if (block === R25_GROUND && window.__flyR25Ground === 0) return true;
  return false;
}

/**
 * THE predicate. block.enabled && (no sub || block[sub].enabled !== false)
 * && profile is Enhanced && no dev sub-pin forces the block off.
 */
export function r25On(block, sub) {
  if (!block?.enabled) return false;
  if (sub && block[sub] && block[sub].enabled === false) return false;
  if (subPinOff(block)) return false;
  return visualsEnhanced();
}

/** Persist an explicit player choice. */
export function saveVisuals(profile) {
  if (!PROFILES.includes(profile)) return;
  try {
    window.localStorage.setItem(VISUALS.key, profile);
  } catch {
    // storage blocked — the live choice still applies for this session
  }
}

/** Apply live (bumps visualsEpoch on a real change). */
export function setVisualsLive(profile) {
  if (!PROFILES.includes(profile)) return;
  useFlyStore.getState().setVisuals(profile);
}

/** Non-React subscription for engine code: fn(visualsEpoch). Returns the unsubscribe. */
export function onVisualsChange(fn) {
  return useFlyStore.subscribe((s) => s.visualsEpoch, fn);
}

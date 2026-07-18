'use client';

import { useFlyStore } from '@/stores/fly-store';

// v2: key bumped when Toy World became the default so styles saved before
// it existed don't pin users to the old look
export const MAP_STYLE_KEY = 'fly-map-style-2';

// Every style is a curved mini-globe now (FLY_GLOBE_REWORK) — the names
// describe the mood, not the tile provider. Keys stay stable for persistence.
// Round 7: 'night' retired — it was a flat dark raster with none of Neon's
// vector world; the Electric Night City pass made Neon THE night look.
export const MAP_STYLES = [
  ['toy', 'Neon'],
  ['satellite', 'Day'],
];

/**
 * Resolve the session's map style from localStorage into the fly store.
 *
 * Round 11: this MUST run before the first FlyCanvas mount (FlyMode's spawn
 * effect — FlyCanvas only mounts once spawn resolves, strictly after). The
 * round-10 version lived in PauseMenu's mount effect, which runs after the
 * scene mounts: an unsaved player built the whole toy vector world and then
 * hot-swapped to satellite — paying for both pipelines on every fresh boot.
 *
 * Rules (unchanged from round 10):
 * - saved 'night' migrates to 'toy' (round 7 retirement) BEFORE validation
 * - a saved valid style wins (explicit toy-choosers keep Neon)
 * - no saved choice → 'satellite' ("Day") is the default; persist it so the
 *   choice sticks. Harnesses seed 'toy' via scripts/_boot.js and never take
 *   this branch (Neon suite unmoved). The store literal stays 'toy' so a
 *   seeded harness boot mounts with zero style churn.
 *
 * Idempotent (StrictMode double-mount safe) and a no-op when storage is
 * blocked — the store default then stands.
 */
export function resolveInitialMapStyle() {
  if (typeof window === 'undefined') return;
  let saved = null;
  try {
    saved = window.localStorage.getItem(MAP_STYLE_KEY);
    // Round 7 migration: saved 'night' lands on Neon (must run BEFORE the
    // validity check — 'night' is no longer a valid style).
    if (saved === 'night') {
      saved = 'toy';
      window.localStorage.setItem(MAP_STYLE_KEY, saved);
    }
    if (!saved || !MAP_STYLES.some(([k]) => k === saved)) {
      saved = 'satellite';
      window.localStorage.setItem(MAP_STYLE_KEY, saved);
    }
  } catch {
    // storage blocked — leave the store default ('toy') in place
    return;
  }
  const store = useFlyStore.getState();
  if (store.mapStyle !== saved) store.setMapStyle(saved);
}

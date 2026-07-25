'use client';

import { useFlyStore } from '@/stores/fly-store';

/**
 * Session settings that should OUTLIVE the tab — the round-16 complaint was
 * that quality and sound reset on every boot while the map style (round 11)
 * remembered itself.
 *
 * Deliberately modelled on lib/fly/map-style.js: plain localStorage, resolved
 * into the store BEFORE the first FlyCanvas mount (FlyMode's spawn effect),
 * idempotent under StrictMode's double-mount, and a silent no-op when storage
 * is blocked (the store defaults then stand).
 *
 * IMPORTANT — what is NOT persisted: PerformanceMonitor's automatic tier
 * degrade. That is a live response to THIS session's frame times on THIS
 * hardware/scene; baking it into storage would let one bad tab (a warp into
 * Tokyo at noon on a laptop on battery) permanently pin a capable machine to
 * 'low'. Only the PauseMenu click sites call the savers — a persisted tier
 * means "the player chose this".
 */

export const QUALITY_TIER_KEY = 'fly-quality-tier';
export const SOUND_ON_KEY = 'fly-sound-on';

// Mirrors PauseMenu's TIERS + the fly-store contract ('high' | 'medium' | 'low')
const VALID_TIERS = ['low', 'medium', 'high'];

/**
 * Resolve persisted quality tier + sound into the fly store. Call once, from
 * FlyMode, beside resolveInitialMapStyle() — i.e. pre-canvas-mount, so the
 * scene is built at the tier the player actually chose instead of building at
 * 'high' and hot-swapping (the round-11 lesson, applied to tiers).
 *
 * Unknown/corrupt values are IGNORED (store default wins) and never written
 * back — unlike the map style there is no "default choice" worth persisting.
 */
export function resolveInitialSettings() {
  if (typeof window === 'undefined') return;
  let tier = null;
  let sound = null;
  try {
    tier = window.localStorage.getItem(QUALITY_TIER_KEY);
    sound = window.localStorage.getItem(SOUND_ON_KEY);
  } catch {
    // storage blocked — leave the store defaults ('high' / sound on) in place
    return;
  }
  const store = useFlyStore.getState();
  if (VALID_TIERS.includes(tier) && store.qualityTier !== tier) {
    store.setQualityTier(tier);
  }
  if (sound === '0' || sound === '1') {
    const on = sound === '1';
    if (store.soundOn !== on) store.setSoundOn(on);
  }
}

/** Persist a PLAYER-CHOSEN quality tier (PauseMenu click sites only). */
export function saveQualityTier(tier) {
  if (typeof window === 'undefined' || !VALID_TIERS.includes(tier)) return;
  try {
    window.localStorage.setItem(QUALITY_TIER_KEY, tier);
  } catch {
    // storage full/blocked — the setting still applies to this session
  }
}

/** Persist the sound toggle ('1' / '0' — same shape as the other fly keys). */
export function saveSoundOn(on) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOUND_ON_KEY, on ? '1' : '0');
  } catch {
    // storage full/blocked — the setting still applies to this session
  }
}

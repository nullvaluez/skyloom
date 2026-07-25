'use client';

import { useFlyStore } from '@/stores/fly-store';
import { isPhoneClass } from '@/lib/fly/device-class';

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
 *
 * Post-R16 mobile pass: with NO explicit pick, a PHONE-CLASS device resolves
 * 'medium' instead of the store's 'high'. The first satellite session that
 * actually rendered on an iPhone (the FloatType fix) ran the full high-tier
 * config — night-window building materials, cloud shadows, 0.5-scale bloom —
 * and the monitor then flapped high↔medium, rebuilding effects/materials
 * every few seconds ("heavy and lagged"). Resolving medium up front mounts
 * the phone-priced scene from frame one; every tier-keyed R11–R16 reduction
 * (aniso, hillshade strength, bloom scale, micro-detail, emissive windows)
 * engages for free. NOT persisted — a default is not a choice, and defaults
 * must stay free to evolve. Explicit picks (any device) always win.
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
  const saved = VALID_TIERS.includes(tier) ? tier : null;
  const phone = isPhoneClass();
  const resolved = saved ?? (phone ? 'medium' : store.qualityTier);
  if (store.qualityTier !== resolved) store.setQualityTier(resolved);
  if (process.env.NODE_ENV === 'development') {
    // verify-sat-mobile gates on this exact resolution (race-free, unlike
    // polling the live tier under a running PerformanceMonitor).
    (window.__flyStats ??= {}).tierPolicy = {
      saved,
      phone,
      resolved,
      ceiling: autoTierCeiling(),
    };
  }
  if (sound === '0' || sound === '1') {
    const on = sound === '1';
    if (store.soundOn !== on) store.setSoundOn(on);
  }
}

/**
 * The highest tier PerformanceMonitor's incline is allowed to step UP to
 * (FlyCanvas's stepQualityTier; the decline path is never capped — rescuing
 * frame time is always legitimate).
 *
 * Desktop: 'high' — behavior byte-identical to R16, including the documented
 * walk-back-up that verify-logbook's gate 9 calibrates around.
 *
 * Phone-class: the player's explicitly saved tier if there is one (their
 * choice is a hard ceiling AND fully reachable — pick 'high' and the monitor
 * may return you there after a dip), else 'medium'. Without this, the incline
 * walked every phone back to 'high' within seconds of any smooth stretch
 * (the R16 lesson observed live: the user's iPhone read "Q High"), then
 * declined again — and each high↔medium crossing rebuilds the bloom pass and
 * recompiles the building materials, which is itself the hitch. Reads
 * storage per call: stepQualityTier fires on monitor events (rare), and the
 * PauseMenu click sites persist synchronously, so the ceiling follows an
 * in-session pick with no extra wiring.
 */
export function autoTierCeiling() {
  if (!isPhoneClass()) return 'high';
  try {
    const saved = window.localStorage.getItem(QUALITY_TIER_KEY);
    if (VALID_TIERS.includes(saved)) return saved;
  } catch {
    // storage blocked — fall through to the phone default
  }
  return 'medium';
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

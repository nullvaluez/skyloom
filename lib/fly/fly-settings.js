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
 * IMPORTANT — what is NOT persisted: the automatic tier degrade (R20: drei's
 * PerformanceMonitor; R21: lib/fly/perf-governor.js behind PERF_GOVERNOR).
 * That is a live response to THIS session's frame times on THIS
 * hardware/scene; baking it into storage would let one bad tab (a warp into
 * Tokyo at noon on a laptop on battery) permanently pin a capable machine to
 * 'low'. The R21 governor's session LATCH is the deliberately-scoped version
 * of the same idea: a rung that proved unsustainable is closed for the rest of
 * the session and reopens on the next boot. Only the PauseMenu click sites
 * call the savers — a persisted tier means "the player chose this".
 */

export const QUALITY_TIER_KEY = 'fly-quality-tier';
export const SOUND_ON_KEY = 'fly-sound-on';
// Round 18 (A5 GRAVITY): 'stakes' | 'forgiving'. Crashes are ON by default —
// the user's call — so ONLY the string 'forgiving' turns them off, and an
// absent/corrupt value resolves to stakes.
export const CRASH_MODE_KEY = 'fly-crash-mode';

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
  // Round 18: the crash-stakes pick rides the same pre-mount beat. Done FIRST
  // and outside the try below — like _boot.js's weather pin, a determinism
  // choice must land even when localStorage throws.
  resolveInitialCrashMode();
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
    // Round 18: verify-crash gate 4 seeds 'forgiving' and reads this back to
    // prove the pick was resolved PRE-MOUNT, not polled off a live scene.
    window.__flyStats.crashStakes = _stakesOn;
  }
  if (sound === '0' || sound === '1') {
    const on = sound === '1';
    if (store.soundOn !== on) store.setSoundOn(on);
  }
}

/**
 * The highest tier an automatic INCLINE is allowed to step up to — R20's
 * PerformanceMonitor path (FlyCanvas's stepQualityTier) and, unchanged in
 * semantics, R21's governor ascent check (lib/fly/perf-governor.js). The
 * decline path is never capped — rescuing frame time is always legitimate.
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

// ---------------------------------------------------------------------------
// Round 18 — "Flight stakes"
// ---------------------------------------------------------------------------
// The crash gate is read ONCE PER FRAME by FlyScene, so it cannot be a
// localStorage hit like autoTierCeiling()'s (that one runs on rare monitor
// events). It is a module cache instead: resolved on the same pre-mount beat
// as tier/sound, updated synchronously by the PauseMenu click, and lazily
// self-healing if anything ever reads it before FlyMode resolves.
//
// Deliberately NOT a fly-store field. Which crash rules apply is not scene
// state — it never re-renders anything, reset() must not wipe it, and the
// round-18 store scaffolding is owned by the session/juice group.
let _stakesOn = null;

/** Crashes armed for this player? Default (and every corrupt value) is YES. */
export function crashStakesOn() {
  if (_stakesOn == null) resolveInitialCrashMode();
  return _stakesOn;
}

/** Resolve the persisted stakes choice into the module cache. Idempotent. */
export function resolveInitialCrashMode() {
  let raw = null;
  if (typeof window !== 'undefined') {
    try {
      raw = window.localStorage.getItem(CRASH_MODE_KEY);
    } catch {
      // storage blocked — stakes stay on, which is the default anyway
    }
  }
  // Note the shape: ONLY the exact string turns them off. An SSR pass, a
  // blocked store and a corrupt value all land on "crashes on", which is the
  // user's chosen default.
  _stakesOn = raw !== 'forgiving';
  return _stakesOn;
}

/**
 * Persist the stakes toggle. Same explicit-pick discipline as the tier: only
 * the PauseMenu click site calls this, and it writes BOTH values (unlike the
 * tier, "forgiving" is a real choice worth remembering, and so is choosing to
 * turn the stakes back on).
 */
export function saveCrashMode(on) {
  _stakesOn = !!on;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CRASH_MODE_KEY, on ? 'stakes' : 'forgiving');
  } catch {
    // storage full/blocked — the setting still applies to this session
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

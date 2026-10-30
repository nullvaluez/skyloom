/**
 * SHIP PASS (FLY_SHIP_PASS.md RL-2, D2, section 6) — the Challenge layer
 * state. RELEASE owns this file.
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   CHALLENGE_KEY          'fly-challenge-v1'
 *   challengeOn() → bool   true when the arcade systems (crashes, combos,
 *                          near-miss, its shake, the run summary, buzz
 *                          contracts) are on for this player.
 *
 * D2: Skyloom is a calm explorer by default. Behind CHALLENGE_LAYER the arcade
 * layer of Round 18 (crashes, the combo chain, near-miss scoring and its
 * shake, the run summary, and the tower-buzz contracts) is one opt-in switch,
 * "Challenge mode", and a new profile starts with it OFF. The boost meter is
 * not part of it (it stays for everyone).
 *
 * With CHALLENGE_LAYER off, challengeOn() is constant true: every arcade
 * system is present exactly as before the pass, and crashes keep following
 * the Round 18 `fly-crash-mode` pick (fly-settings.js), so the flag-off arm is
 * today's behaviour by construction (scripts/verify-ship-release.mjs proves
 * it against values recorded from W0 `main`).
 *
 * Resolution, with the layer on (first match wins):
 *   1. the pin `window.__flyChallengeOverride` — true / false, 'on' / 'off',
 *      or `{ enabled }` (so `?flags=CHALLENGE` / `?flags=-CHALLENGE` sets it
 *      for one page load); harnesses that test the arcade layer
 *      (verify-crash, verify-juice) pin it on;
 *   2. the saved choice `fly-challenge-v1` ('1' / '0');
 *   3. the one-time migration from Round 18's `fly-crash-mode`: 'stakes' (a
 *      player who chose crashes) turns Challenge on and 'forgiving' leaves it
 *      off — both are written to `fly-challenge-v1` once, since each was a
 *      choice; an ABSENT key (the default, never chosen) resolves off and is
 *      not written, so the default stays free to evolve (the fly-settings
 *      discipline: a default is not a choice).
 *
 * Node-safe and SSR-safe: no window means no pin and no storage.
 */
import { shipPassOn } from './ship-pass';
import { track } from './analytics';

export const CHALLENGE_KEY = 'fly-challenge-v1';
/** Round 18's stakes key (fly-settings.js CRASH_MODE_KEY; a literal here so
 * this module never imports fly-settings, which imports it). */
export const LEGACY_CRASH_MODE_KEY = 'fly-crash-mode';
export const CHALLENGE_PIN = '__flyChallengeOverride';

/**
 * Contract templates that belong to the Challenge layer (lib/fly/contracts.js
 * reads this): buzzing a control tower is an arcade stunt, so with the layer on
 * they are dealt only with Challenge on, and the shared daily pool never draws
 * them (so every player still gets the same two dailies).
 */
export const CHALLENGE_TEMPLATE_IDS = Object.freeze(['buzz-tower', 'night-buzz']);

/** The CHALLENGE_LAYER flag for this page load (`?flags=-CHALLENGE_LAYER` = the pre-pass game). */
export function challengeLayerOn() {
  return shipPassOn('CHALLENGE_LAYER');
}

/** A pin value → true / false, or null when it says nothing. */
export function readChallengePin(pin) {
  if (pin === true || pin === 'on' || pin === '1') return true;
  if (pin === false || pin === 'off' || pin === '0') return false;
  if (pin && typeof pin === 'object' && typeof pin.enabled === 'boolean') return pin.enabled;
  return null;
}

/**
 * Pure resolution (the gate drives this directly).
 * @param {{layerOn:boolean, pin?:any, saved?:string|null, legacy?:string|null}} s
 * @returns {{on:boolean, write:('1'|'0'|null), source:string}}
 */
export function resolveChallengeState({ layerOn, pin = null, saved = null, legacy = null }) {
  if (!layerOn) return { on: true, write: null, source: 'layer-off' };
  const pinned = readChallengePin(pin);
  if (pinned != null) return { on: pinned, write: null, source: 'pin' };
  if (saved === '1' || saved === '0') return { on: saved === '1', write: null, source: 'saved' };
  if (legacy === 'stakes') return { on: true, write: '1', source: 'migrated' };
  if (legacy === 'forgiving') return { on: false, write: '0', source: 'migrated' };
  return { on: false, write: null, source: 'default' };
}

let _state = null;

function storage() {
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null; // storage blocked
  }
}

/** Resolve (or re-resolve) the player's Challenge state. Idempotent. */
export function resolveChallenge() {
  const win = globalThis.window;
  const ls = storage();
  let saved = null;
  let legacy = null;
  try {
    saved = ls?.getItem(CHALLENGE_KEY) ?? null;
    legacy = ls?.getItem(LEGACY_CRASH_MODE_KEY) ?? null;
  } catch {
    // storage blocked: the default stands
  }
  _state = resolveChallengeState({ layerOn: challengeLayerOn(), pin: win?.[CHALLENGE_PIN], saved, legacy });
  if (_state.write) {
    try {
      ls?.setItem(CHALLENGE_KEY, _state.write);
    } catch {
      // storage full/blocked: the migration simply runs again next boot
    }
  }
  if (win && process.env.NODE_ENV === 'development') (win.__flyStats ??= {}).challenge = { ..._state };
  return _state.on;
}

/** Are the arcade systems on for this player? Constant true with CHALLENGE_LAYER off. */
export function challengeOn() {
  if (_state == null) resolveChallenge();
  return _state.on;
}

/**
 * Persist a CLICKED Challenge choice (the Settings row is the only caller).
 * A no-op with the layer off (there is no Challenge row then).
 */
export function saveChallenge(on) {
  if (!challengeLayerOn()) return;
  const next = !!on;
  _state = { on: next, write: null, source: 'clicked' };
  try {
    storage()?.setItem(CHALLENGE_KEY, next ? '1' : '0');
  } catch {
    // storage full/blocked: the choice still applies to this session
  }
  track('challenge_toggled', { on: next });
}

/** Is this contract template part of the Challenge layer? */
export function challengeTemplate(id) {
  return CHALLENGE_TEMPLATE_IDS.includes(id);
}

/**
 * May a Challenge template be dealt right now? Always with the layer off
 * (today's deal); with it on, only while Challenge is on.
 */
export function challengeDealOn() {
  return !challengeLayerOn() || challengeOn();
}

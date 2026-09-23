'use client';

// R25 A FRONT DOOR — the title screen's state helpers (plan FLY_ROUND25_PLAN.md
// "Key rulings" 1-3, "UX flow"). One state machine lives in the store
// (`screen: 'title'|'hangar'|'flight'`, `hangarOpen` its maintained mirror);
// this module holds every rule that reads or moves it outside FlyScene.
//
// FLAG-OFF IDENTITY: with FRONT_DOOR.enabled false every export below returns
// exactly the W0 stub's answer (mandatory hangar at boot, 'demand' frameloop
// while the hangar is open, spotting/juice/contracts always allowed, no exit
// to title, no stage pump). scripts/verify-r25-front-door.mjs proves it arm by
// arm against the real module.

import { useFlyStore, menuOpen, inFlight } from '@/stores/fly-store';
import { graphicsReviewOn } from './satellite-visuals';
import { FRONT_DOOR, FLIGHT_PLAN } from './fly-constants';
import { isPhoneClass } from './device-class';

/** The title screen ships (master flag). */
export function frontDoorOn() {
  return FRONT_DOOR.enabled === true;
}

/** Harness pin: window.__flyTitleBypass === true skips the title (dev / graphicsReview only). */
export function titleBypassPinned() {
  if (typeof window === 'undefined') return false;
  if (!(process.env.NODE_ENV === 'development' || graphicsReviewOn())) return false;
  return window.__flyTitleBypass === true;
}

/**
 * Pre-mount: which screen the session opens on. The title when the front door
 * ships and no harness bypass is pinned; otherwise today's mandatory hangar
 * (the legacy fleet's posture, plan ruling 6).
 */
export function resolveInitialScreen() {
  return frontDoorOn() && !titleBypassPinned() ? 'title' : 'hangar';
}

/**
 * FlyCanvas frameloop selector (zustand selector shape — it returns a string,
 * so FlyCanvas re-renders only when the answer changes). The title and the
 * flight render continuously (the title world is live and doubles as tile
 * warm-up); the opaque hangar stays on 'demand' and is fed by <StagePump>.
 */
export function frameloopFor(s) {
  if (!frontDoorOn()) return s.hangarOpen ? 'demand' : 'always';
  return s.screen === 'hangar' || s.hangarOpen ? 'demand' : 'always';
}

/**
 * Gameplay side effects (passport spots, contract progress, airport buzz,
 * near-miss juice, the arrival banner) happen only while actually flying.
 * Flag-off: always (today). The title's frozen flight and its orbiting camera
 * must never farm the logbook or complete a contract.
 */
export function gameplayLive(s) {
  if (!frontDoorOn()) return true;
  return inFlight(s);
}

/** Passport spotting gate (FlyScene logSpot). */
export function spotAllowed(s) {
  return gameplayLive(s);
}

/** React hook: hide the player group on the title. */
export function useTitleHidden() {
  return useFlyStore((s) => s.screen === 'title');
}

/** Selector: the title screen is up (always false with the flag off). */
export function onTitle(s) {
  return frontDoorOn() && s.screen === 'title';
}

/** Exit leads to the title (instead of today's page reload). */
export function exitGoesToTitle() {
  return frontDoorOn() && FRONT_DOOR.exitToTitle !== false;
}

/** Selector: BootScreen renders as the compact loading strip under the title. */
export function bootCompactFor(s) {
  return frontDoorOn() && FRONT_DOOR.bootCompact !== false && s.screen === 'title';
}

/** The Free Flight card exists only once B's flight plan ships. */
export function freeFlightAvailable() {
  return FLIGHT_PLAN.enabled === true;
}

/**
 * Title card → hangar in `mode` ('free' | 'ops'). Also the explicit audio
 * unlock the plan asks for on the first title click (the window-level gesture
 * listener in use-fly-audio does it too; this covers keyboard activation).
 */
export function enterHangarFromTitle(mode, runtime) {
  runtime?.audio?.resume?.();
  const s = useFlyStore.getState();
  s.setSettingsOpen(false);
  s.closeCredits();
  s.setFlightMode(mode === 'free' ? 'free' : 'ops');
  s.setHangarDismissible(false);
  s.setScreen('hangar');
  return true;
}

/** Pre-flight hangar → title (‹ Title / Esc / Back). The mid-flight return confirm is NOT this. */
export function hangarToTitle() {
  if (!frontDoorOn()) return false;
  const s = useFlyStore.getState();
  if (!s.hangarOpen || s.hangarDismissible === true) return false;
  s.setScreen('title');
  return true;
}

/**
 * Pause → "Exit to title" (and the desktop X). Plan UX table: return the
 * operations state machine to its hangar phase (which freezes the flight),
 * disengage the autopilot, disarm the crash system, close every overlay, and
 * let the title camera ease out of the current chase pose. The world stays
 * mounted and live — this replaces window.location.reload().
 * Returns false (and does nothing) with the flag off.
 */
export function exitToTitle(runtime) {
  if (!exitGoesToTitle()) return false;
  const rt = runtime || {};
  rt.operations?.returnToHangar?.();
  rt.autopilot?.disengage?.();
  rt.crashSys?.disarm?.();
  if (rt.crash && rt.crash.state && rt.crash.state !== 'idle') {
    rt.crash.state = 'idle';
    rt.crash.track = null;
  }
  rt.input?.neutralize?.();
  const s = useFlyStore.getState();
  s.setInspectHex(null);
  s.setAtlasOpen(false);
  s.setLogbookOpen(false);
  s.closeCredits();
  s.setSettingsOpen(false);
  s.setRunSummaryOpen(false);
  s.setArrival(null);
  s.setCameraMode('chase');
  s.setHangarDismissible(false);
  s.setPhase('flying');
  rt.titleCam?.blendFrom?.(rt.camera);
  s.setScreen('title');
  return true;
}

// ---------------------------------------------------------------------------
// <StagePump> policy (FlyCanvas mounts the component). While the opaque hangar
// holds the world canvas on 'demand', a low-rate invalidate lets the staged
// destination (B's runtime.staging) — and, for a session that came through the
// title, a boot that has not revealed yet — keep streaming behind it. It stops
// the moment staging is ready, the boot has revealed, or the tab is hidden.
// ---------------------------------------------------------------------------

/** Pump rate: FLIGHT_PLAN.stage.hzDesktop / hzPhone. */
export function stagePumpHz(phone = isPhoneClass()) {
  const st = FLIGHT_PLAN.stage || {};
  const hz = phone ? st.hzPhone : st.hzDesktop;
  return Number.isFinite(hz) && hz > 0 ? hz : phone ? 4 : 10;
}

/**
 * Should this tick invalidate? `env` is injectable for the node gate:
 * { hidden, bootPct, bypass }.
 */
export function stagePumpWanted(s, runtime, env = null) {
  if (!frontDoorOn() || FLIGHT_PLAN.stage?.enabled === false) return false;
  if (!menuOpen(s) || s.screen !== 'hangar') return false; // title + flight run 'always'
  const hidden = env ? !!env.hidden : typeof document !== 'undefined' && document.hidden;
  if (hidden) return false;
  const staging = runtime?.staging;
  if (staging && !staging.ready) return true;
  const bypass = env ? !!env.bypass : titleBypassPinned();
  const pct = env ? env.bootPct : typeof window !== 'undefined' ? window.__flyBoot?.pct : 100;
  return !bypass && Number.isFinite(pct) && pct < 100;
}

/** Pump telemetry (module scope — never React). */
export const stagePumpStats = { ticks: 0, lastAt: 0 };
export function noteStagePump(now) {
  stagePumpStats.ticks++;
  stagePumpStats.lastAt = now;
}

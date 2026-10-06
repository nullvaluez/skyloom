/**
 * TRUE EARTH Phase 2 — CONDITIONS: the player's time-of-day and weather pick.
 *
 * Precedence, highest first:
 *   1. harness pins — window.__flySunOverride / __flyWeatherOverride (also set
 *      by ?sunUtc= / ?weather=), so every gate stays deterministic;
 *   2. a curated Adventure's authored conditions (adventure-environment.mjs);
 *   3. the player's pick (session only, never persisted);
 *   4. Live — the real clock and the real weather at the aircraft.
 *
 * The time pick is a LOCAL SOLAR hour (what the light depends on), applied on
 * today's date at the aircraft's longitude, and a change glides over
 * CONDITIONS.easeMs along the shorter way round the clock. With the flag off
 * nothing here is called (FlyScene and the weather hook keep their own path).
 */
import { pinned } from './fly-pins.js';
import { CONDITIONS } from './fly-constants.js';
import { adventureSunTime } from './adventure-environment.mjs';

export const CONDITIONS_ACTIVE = pinned(CONDITIONS, '__flyConditionsOverride');
export function conditionsOn() {
  return CONDITIONS_ACTIVE.enabled === true;
}

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** The weather presets the panel offers (payloads in /api/weather's shape). */
export const WEATHER_PRESETS = [
  { id: 'clear', label: 'Clear', payload: { cloudCoverPct: 5, visM: 40000, visPlus: true } },
  { id: 'scattered', label: 'Scattered', payload: { cloudCoverPct: 45, visM: 30000, visPlus: true } },
  { id: 'overcast', label: 'Overcast', payload: { cloudCoverPct: 96, visM: 12000 } },
  { id: 'rain', label: 'Rain', payload: { cloudCoverPct: 92, visM: 5000, precip: 'rain', precipMm: 2.5, tempC: 12 } },
  { id: 'snow', label: 'Snow', payload: { cloudCoverPct: 92, visM: 2500, precip: 'snow', precipMm: 1.5, tempC: -4 } },
  { id: 'fog', label: 'Fog', payload: { cloudCoverPct: 20, visM: 500, tempC: 8 } },
];
const PRESET_BY_ID = Object.fromEntries(WEATHER_PRESETS.map((p) => [p.id, p]));

/** The weather payload the player picked, or null (Live, unknown id, flag off). */
export function playerWeatherPayload(id, on = conditionsOn()) {
  const p = on && id ? PRESET_BY_ID[id] : null;
  return p ? { found: true, source: 'player', ...p.payload } : null;
}

const wrap24 = (h) => ((h % 24) + 24) % 24;
/** Local solar hour at longitude `lon` (degrees east) for a UTC instant. */
export function solarHour(tMs, lon) {
  return wrap24(tMs / HOUR_MS + lon / 15);
}

/** The UTC instant nearest `nowMs` (within ±12 h) whose local solar hour at `lon` is `hour`. */
export function instantForSolarHour(hour, lon, nowMs) {
  let t = Math.floor(nowMs / DAY_MS) * DAY_MS + (hour - lon / 15) * HOUR_MS;
  while (t - nowMs > DAY_MS / 2) t -= DAY_MS;
  while (nowMs - t > DAY_MS / 2) t += DAY_MS;
  return t;
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Ease state: one glide at a time, restarted from wherever the last one is. */
const ease = { from: null, to: null, t0: 0, live: false };

/**
 * The solar hour to light the world with. `target` is the player's pick (null
 * = Live); `liveHour` is the real solar hour now. A change of target starts a
 * glide from the current eased hour; returning to Live glides to the live hour
 * and then follows the clock. Returns { hour, easing }.
 */
export function easedHour(target, liveHour, nowMs, easeMs = CONDITIONS_ACTIVE.easeMs) {
  const goal = target == null ? liveHour : wrap24(target);
  const wantLive = target == null;
  if (ease.to == null) {
    // First call: no glide from nowhere — start where we are.
    ease.from = goal;
    ease.to = goal;
    ease.t0 = nowMs - easeMs;
    ease.live = wantLive;
  } else if (wantLive !== ease.live || (!wantLive && goal !== ease.to)) {
    const cur = easedHour.peek(nowMs, easeMs);
    ease.from = cur;
    ease.to = goal;
    ease.t0 = nowMs;
    ease.live = wantLive;
  } else if (wantLive) {
    ease.to = goal; // the live hour moves with the clock
  }
  const s = smooth((nowMs - ease.t0) / easeMs);
  const d = ((ease.to - ease.from + 36) % 24) - 12; // the shorter way round
  const hour = s >= 1 ? ease.to : wrap24(ease.from + d * s);
  return { hour, easing: s < 1 };
}
easedHour.peek = (nowMs, easeMs = CONDITIONS_ACTIVE.easeMs) => {
  if (ease.to == null) return null;
  const s = smooth((nowMs - ease.t0) / easeMs);
  const d = ((ease.to - ease.from + 36) % 24) - 12;
  return s >= 1 ? ease.to : wrap24(ease.from + d * s);
};
/** Test hook: forget the glide. */
export function resetEase() {
  ease.from = ease.to = null;
  ease.t0 = 0;
  ease.live = false;
}

/**
 * The sun clock with the precedence above. `hour` is the player's pick (null =
 * Live). Returns { tMs, easing }. With no pick and no glide in flight this is
 * exactly `nowMs`, so Live is the real clock bit for bit.
 */
export function conditionsSunTime(environment, nowMs, pin, lon, hour) {
  if (Number.isFinite(pin) && pin > 0) return { tMs: pin, easing: false };
  if (environment?.mode === 'curated') return { tMs: adventureSunTime(environment, nowMs, pin), easing: false };
  const live = solarHour(nowMs, lon);
  const e = easedHour(hour, live, nowMs);
  if (hour == null && !e.easing) return { tMs: nowMs, easing: false };
  return { tMs: instantForSolarHour(e.hour, lon, nowMs), easing: e.easing };
}

// What the panel shows: the effective solar hour and whether an Adventure owns
// the conditions. Published by FlyScene's sun cadence; read with
// useSyncExternalStore.
let shown = { hour: null, curated: false };
const listeners = new Set();
export function publishConditions(hour, curated) {
  if (shown.hour === hour && shown.curated === curated) return;
  shown = { hour, curated };
  for (const fn of listeners) fn();
}
export function subscribeConditions(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getShownConditions() {
  return shown;
}

/** 'HH:MM' for a solar hour. */
export function formatHour(h) {
  if (!Number.isFinite(h)) return '--:--';
  const m = Math.round(wrap24(h) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

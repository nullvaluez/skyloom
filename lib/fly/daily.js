/**
 * Round 17 "Your Wings" — the DAILY SET.
 *
 * Two extra objectives, chosen by the CALENDAR rather than by the player's
 * rotation: everyone on earth gets the same two today, they change at UTC
 * midnight, and they pay double. That "everyone" is the whole point — a daily
 * that differed per session would just be two more random contracts.
 *
 * ZERO-IMPORT, deliberately:
 *   · loadable in plain node, so scripts/verify-daily.mjs can prove the
 *     determinism claims without a browser or a bundler alias;
 *   · it can never drag fly-constants / three / next into a worker;
 *   · the POOL is an argument, not an import (contracts.js owns which
 *     templates are mechanical — see DAILY_TEMPLATE_IDS there). This is the
 *     one deviation from the plan's `pickDaily(dayNum, n)` sketch, and it is
 *     what buys the zero-import property.
 *
 * UTC everywhere. The passport's day buckets are already
 * `toISOString().split('T')[0]` (see lib/badges.js getStreakDays, and the R16
 * lesson that shipped `daily_streak_7` broken by disagreeing with them), so
 * the daily rollover uses the same clock rather than inventing a second one.
 */

const DAY_MS = 86400000;

/**
 * Mulberry32 — a 32-bit PRNG that is small, fast and, crucially, EXACTLY
 * reproducible across engines: integer ops and one float divide, no Math.sin
 * hashing whose last bits differ between V8 and JavaScriptCore. Two devices
 * asked for the same day must compute the same two contracts.
 *
 * @param {number} seed  any integer
 * @returns {() => number} generator producing floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole UTC days since the epoch — the daily seed. */
export function utcDayNumber(tMs) {
  const t = Number.isFinite(tMs) ? tMs : Date.now();
  return Math.floor(t / DAY_MS);
}

/** `YYYY-MM-DD` in UTC — the rollover key (string compare, no Date math). */
export function utcDayKey(tMs) {
  const t = Number.isFinite(tMs) ? tMs : Date.now();
  return new Date(t).toISOString().split('T')[0];
}

/**
 * The clock the daily set runs on. `window.__flyDayOverride` (epoch ms) pins
 * it for harnesses — the same shape as `__flySunOverride` /
 * `__flyWeatherOverride`. Node-safe: no window, no override.
 */
export function dailyNowMs() {
  if (typeof window !== 'undefined' && Number.isFinite(window.__flyDayOverride)) {
    return window.__flyDayOverride;
  }
  return Date.now();
}

/**
 * Sample `n` items from `pool` WITHOUT replacement, deterministically for a
 * given day number.
 *
 * A partial Fisher-Yates over a copy: unbiased, and "without replacement" is
 * structural rather than a retry loop (a rejection loop on a 9-item pool would
 * still terminate, but its cost would depend on the draws — this doesn't).
 *
 * The seed is mixed with a constant so day N's daily set is not the same
 * stream as anything else that might one day seed on the same day number.
 *
 * @param {number} dayNum  from utcDayNumber()
 * @param {Array} pool     candidate values (ids, templates — anything)
 * @param {number} [n]     how many to take (clamped to the pool size)
 * @returns {Array} the picks, in draw order
 */
export function pickDaily(dayNum, pool, n = 2) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const take = Math.max(0, Math.min(n, pool.length));
  const rnd = mulberry32((dayNum | 0) ^ 0x9e3779b9);
  const bag = pool.slice();
  const out = [];
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rnd() * (bag.length - i));
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
    out.push(bag[i]);
  }
  return out;
}

/**
 * TRUE EARTH — PLAYER_SURFACE: one shipped look for players.
 *
 * `reviewSurfaceOn()` is the single predicate for the legacy surfaces: the
 * Visuals and Map style rows (SettingsRows), the review warps (PauseMenu),
 * the neon warp confetti in satellite (FlyScene) and the one-time migration
 * of a saved Neon/Classic choice (map-style.js, visuals-profile.js).
 * True when the flag is off (today's behaviour), under `?graphicsReview=1`,
 * or under automation: the harness fleet seeds Neon and pins Classic, and
 * three harnesses click the rows (scripts/verify-player-surface.mjs).
 */
import { pinned } from './fly-pins';
import { PLAYER_SURFACE } from './fly-constants';
import { graphicsReviewOn } from './satellite-visuals';

/** The resolved PLAYER_SURFACE block (URL / console pins applied once, at load). */
export const PLAYER_SURFACE_ACTIVE = pinned(PLAYER_SURFACE, '__flyPlayerSurfaceOverride');

/** WebDriver/Playwright sessions: the harness fleet's seeded choices stand. */
export function automationContext() {
  return typeof navigator !== 'undefined' && navigator?.webdriver === true;
}

/** Show the legacy look switches and review shortcuts. */
export function reviewSurfaceOn(active = PLAYER_SURFACE_ACTIVE) {
  return active?.enabled !== true || graphicsReviewOn() || automationContext();
}

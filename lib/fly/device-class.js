'use client';

/**
 * Static phone-class gate for performance policy (post-R16 mobile pass).
 *
 * WHY STATIC: the R16 lesson — PerformanceMonitor's onIncline reverts any
 * downward tier nudge within seconds, so anything that must HOLD on a class
 * of device has to be a source gate, not a runtime reaction. This is that
 * gate: decided once per session from what the device IS, never from how a
 * frame happened to run.
 *
 * "Phone" = a coarse-pointer touch device (the use-is-touch pair — BOTH
 * required, so a touchscreen laptop stays desktop) whose smallest screen
 * dimension is under 768 CSS px. Tablets (iPad: 768+) and desktops are NOT
 * phone-class: they keep the certified desktop defaults.
 */
export function isPhoneClass() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window;
  if (!(coarse && hasTouch)) return false;
  const s = window.screen;
  const minDim = Math.min(
    s?.width ?? window.innerWidth,
    s?.height ?? window.innerHeight
  );
  return minDim > 0 && minDim < 768;
}

'use client';

import { useDeviceLayout } from './use-device-layout';

/**
 * True on coarse-pointer / touch devices — the gate for Fly-mode's on-screen
 * controls (joystick, throttle, action buttons). Desktop stays untouched.
 *
 * Requires BOTH a coarse primary pointer AND touch hardware: a small desktop
 * window (fine pointer, no touch) must NOT sprout a joystick — and even on a
 * touchscreen laptop, mouse users keep the desktop scheme (the InputController
 * gates steering per-event on pointerType, so touch input still works there).
 *
 * ROUND 17: this is now a thin wrapper over `useDeviceLayout()`. The semantics
 * above are unchanged — they were MOVED into the shared hook verbatim, so the
 * five existing call sites keep the exact boolean they had. What the move buys
 * is that "is this a touch device" and "is this a phone" can no longer drift
 * apart across components (the R17 landscape-phone bug: touch controls from
 * this hook + a desktop HUD from `max-sm:`). New code should prefer
 * `useDeviceLayout()` directly and read the field it actually means.
 */
export function useIsTouch() {
  return useDeviceLayout().isTouch;
}

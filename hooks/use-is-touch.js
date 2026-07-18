'use client';

import { useEffect, useState } from 'react';

/**
 * True on coarse-pointer / touch devices — the gate for Fly-mode's on-screen
 * controls (joystick, throttle, action buttons). Desktop stays untouched.
 *
 * SSR-safe: starts false so the server render and the first client render
 * agree (no hydration mismatch), then resolves after mount. Re-checks on a
 * pointer-capability change and on resize/orientation so a hybrid device that
 * flips between mouse and touch (2-in-1, tablet + trackpad) updates live.
 *
 * Requires BOTH a coarse primary pointer AND touch hardware: a small desktop
 * window (fine pointer, no touch) must NOT sprout a joystick — and even on a
 * touchscreen laptop, mouse users keep the desktop scheme (the InputController
 * gates steering per-event on pointerType, so touch input still works there).
 */
export function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    const check = () => {
      const coarse = mq ? mq.matches : false;
      const hasTouch =
        (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
        'ontouchstart' in window;
      setIsTouch(coarse && hasTouch);
    };
    check();
    mq?.addEventListener?.('change', check);
    window.addEventListener('resize', check);
    return () => {
      mq?.removeEventListener?.('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return isTouch;
}

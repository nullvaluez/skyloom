'use client';

import { useEffect, useState } from 'react';
import { isPhoneClass } from '@/lib/fly/device-class';

/**
 * ONE device/layout description for the whole Fly UI (round 17 mobile
 * overhaul). Before this hook the app carried TWO disagreeing definitions of
 * "phone" — `useIsTouch()` (any coarse-pointer touch device) gated the
 * on-screen controls, while `max-sm:` / `useSheetLayout()` (width ≤ 639) gated
 * the compact layout. A phone in LANDSCAPE is 844 px wide, so it satisfied the
 * first and failed the second: touch controls on top of the full desktop HUD,
 * which is exactly the "crammed, things overflow" state the user reported.
 *
 * Returned shape:
 *   isTouch      coarse pointer AND touch hardware (the use-is-touch semantics,
 *                verbatim — a small mouse-driven window must not sprout a
 *                joystick, and a touchscreen laptop keeps the desktop scheme).
 *   isPhone      `isPhoneClass()` from lib/fly/device-class.js — capability +
 *                min(screen dims) < 768. ROTATION-INVARIANT by construction
 *                (it reads `screen`, not the viewport), which is the whole
 *                point: a phone stays a phone when you turn it sideways.
 *   isTablet     isTouch && !isPhone (iPads: touch, but 768+ on the short side).
 *   orientation  'portrait' | 'landscape' from matchMedia, reactive.
 *   isSheet      isPhone || viewportWidth ≤ 639 — a UNION, deliberately:
 *                  · landscape phones finally get the full-bleed sheets
 *                    (they used to fall back to desktop-sized dialogs);
 *                  · a narrow DESKTOP window keeps today's exact behavior,
 *                    because the ≤ 639 term is the old rule, untouched.
 *
 * Resolves on the FIRST render, not in the effect. FlyMode is mounted through
 * `dynamic(..., { ssr: false })`, so nothing in this subtree ever renders on
 * the server and there is no hydration pass to mismatch — and the hook this
 * replaces (`useSheetLayout`) resolved synchronously for a reason: deferring
 * it renders one frame of the DESKTOP dialog before the phone sheet takes
 * over, which reads as a flash every time the inspect card or the logbook
 * opens. `read()` still guards on `typeof window` and falls back to the
 * desktop/portrait defaults, so the hook stays safe if it is ever used from a
 * server-rendered tree. All listeners are removed on unmount.
 *
 * DELIBERATELY NOT a store: this is layout, read at render time by ~10
 * overlays. It changes on rotation, not per frame.
 */
export function useDeviceLayout() {
  const [state, setState] = useState(read);

  useEffect(() => {
    const coarseMq = window.matchMedia?.('(pointer: coarse)');
    const landMq = window.matchMedia?.('(orientation: landscape)');
    const narrowMq = window.matchMedia?.('(max-width: 639px)');

    const check = () => {
      const next = read();
      // Same-value guard: matchMedia + resize can fire several times for one
      // rotation, and every extra setState re-renders every consumer overlay.
      setState((prev) => (same(prev, next) ? prev : next));
    };

    check();
    coarseMq?.addEventListener?.('change', check);
    landMq?.addEventListener?.('change', check);
    narrowMq?.addEventListener?.('change', check);
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      coarseMq?.removeEventListener?.('change', check);
      landMq?.removeEventListener?.('change', check);
      narrowMq?.removeEventListener?.('change', check);
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  return state;
}

/** SSR / no-DOM fallback: the desktop, portrait, non-sheet reading. */
const INITIAL = {
  isTouch: false,
  isPhone: false,
  isTablet: false,
  orientation: 'portrait',
  isSheet: false,
};

/**
 * One measurement of the device. Pure read — no listeners, no state — so it
 * can serve both the lazy state initializer and every change handler, and the
 * two can never compute the reading differently.
 */
function read() {
  if (typeof window === 'undefined') return INITIAL;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window;
  const isTouch = coarse && hasTouch;
  // Rotation-invariant on purpose: isPhoneClass() reads `screen`, not the
  // viewport, so turning a phone sideways cannot demote it to a tablet.
  const isPhone = isPhoneClass();
  const landscape =
    window.matchMedia?.('(orientation: landscape)').matches ??
    window.innerWidth > window.innerHeight;
  const narrow = window.matchMedia?.('(max-width: 639px)').matches ?? window.innerWidth <= 639;
  return {
    isTouch,
    isPhone,
    isTablet: isTouch && !isPhone,
    orientation: landscape ? 'landscape' : 'portrait',
    // UNION. The `narrow` term is the pre-R17 rule verbatim (narrow desktop
    // windows behave exactly as they did); `isPhone` is the new one.
    isSheet: isPhone || narrow,
  };
}

function same(a, b) {
  return (
    a.isTouch === b.isTouch &&
    a.isPhone === b.isPhone &&
    a.isTablet === b.isTablet &&
    a.orientation === b.orientation &&
    a.isSheet === b.isSheet
  );
}

/**
 * The `data-device` value the Fly root stamps (globals.css keys the
 * `phone:` / `phone-land:` / `phone-port:` variants off it). Exported so the
 * root and any harness assertion share ONE spelling.
 */
export function deviceAttr({ isPhone, isTablet }) {
  return isPhone ? 'phone' : isTablet ? 'tablet' : 'desktop';
}

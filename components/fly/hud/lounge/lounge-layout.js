'use client';
import { useEffect, useState } from 'react';

/*
 * LOUNGE MOBILE — GLASS: which lounge HUD a device gets, from the ONE device
 * description (hooks/use-device-layout.js):
 *   'phone-portrait' / 'phone-landscape'  a phone (coarse pointer + touch,
 *        short screen side under 768 px; rotation-invariant): the thumb HUD —
 *        compact header, dock, sheets, coach marks;
 *   'tablet'   a coarse-touch tablet: the desktop HUD with touch-sized targets;
 *   'desktop'  everything else, a fine-pointer desktop at any window size:
 *        today's HUD, untouched (no attribute, no class, no extra element).
 * And which binocular figure it draws (lib/fly/lounge/glass-layout.mjs): a
 * phone's own orientation, a tablet's portrait (the desktop's twin lenses
 * sized from the height are each wider than an upright screen), else desktop.
 */
export function loungeLayoutOf(device) {
  if (device.isPhone) return device.orientation === 'landscape' ? 'phone-landscape' : 'phone-portrait';
  if (device.isTablet) return 'tablet';
  return 'desktop';
}

export function binoLayoutOf(layout, device) {
  if (layout === 'phone-portrait') return 'portrait';
  if (layout === 'phone-landscape') return 'landscape';
  if (layout === 'tablet' && device.orientation === 'portrait') return 'portrait';
  return 'desktop';
}

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The safe-area insets in px, read from a probe element whose padding is
 * env(safe-area-inset-*) (lounge-mobile.css .lounge-safe-probe), so the canvas
 * mask and the DOM readouts lay out from the same numbers. Re-read on resize
 * and rotation. `on` false: always zero, nothing listens.
 */
export function useSafeInsets(ref, on) {
  const [insets, setInsets] = useState(ZERO);
  useEffect(() => {
    if (!on) return undefined;
    const read = () => {
      const el = ref.current;
      if (!el) return;
      const s = getComputedStyle(el);
      const next = { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
      setInsets((prev) => (prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom && prev.left === next.left ? prev : next));
    };
    read();
    // The probe's padding IS the insets, so its box changes size exactly when
    // they do (rotation, a standalone web app's bars, an emulator override).
    const ro = typeof ResizeObserver === 'undefined' || !ref.current ? null : new ResizeObserver(read);
    ro?.observe(ref.current, { box: 'border-box' });
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
    };
  }, [ref, on]);
  return on ? insets : ZERO;
}

/** The viewport in CSS px, re-read on resize (`on` false: nothing listens). */
export function useViewportSize(on) {
  const [size, setSize] = useState(() => (typeof window === 'undefined' ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    if (!on) return undefined;
    const read = () => setSize((prev) => (prev.w === window.innerWidth && prev.h === window.innerHeight ? prev : { w: window.innerWidth, h: window.innerHeight }));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [on]);
  return size;
}

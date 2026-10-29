/**
 * LOUNGE MOBILE (2026-10-29; FLY_LOUNGE_MOBILE.md) — the one reader of the
 * LOUNGE_MOBILE flag block (lib/fly/fly-constants.js, TRUE EARTH flags).
 *
 * Every read is a literal pinned(LOUNGE_MOBILE, '__flyLoungeMobileOverride')
 * at call time, so `?flags=-LOUNGE_MOBILE`, a harness pin or a pasted console
 * pin wins over the shipped value (scripts/verify-true-earth-flags.mjs (5)).
 *
 * Device classes come from lib/fly/device-class.js and are decided once per
 * session from what the device IS (coarse pointer + touch hardware; phone =
 * short screen side under 768 CSS px). Layout (portrait / landscape, sheet or
 * not) is hooks/use-device-layout.js's job, and gesture handling keys off
 * the pointer's own type (PointerEvent.pointerType === 'touch'), so a
 * touchscreen laptop keeps the desktop scheme for its mouse.
 */
import { pinned } from './fly-pins.js';
import { isMobileGraphicsClass, isPhoneClass } from './device-class.js';
import { LOUNGE_MOBILE } from './fly-constants.js';

export const loungeMobile = () => pinned(LOUNGE_MOBILE, '__flyLoungeMobileOverride');

/** The flag itself (phones and tablets may watch an airport). */
export function loungeMobileOn() {
  return loungeMobile().enabled === true;
}

/** 'desktop' | 'phone' | 'tablet' — the lounge's device class. */
export function loungeDeviceClass() {
  if (!isMobileGraphicsClass()) return 'desktop';
  return isPhoneClass() ? 'phone' : 'tablet';
}

/** May this device open the lounge? Desktop always; phones and tablets per the flag. */
export function loungeMobileAllowed(device = loungeDeviceClass()) {
  if (device === 'desktop') return true;
  const block = loungeMobile();
  if (block.enabled !== true) return false;
  return device === 'phone' || block.tablets !== false;
}

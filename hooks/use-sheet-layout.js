'use client';

import { useDeviceLayout } from './use-device-layout';

/**
 * "Render as a full-bleed sheet rather than a floating dialog." Drives layout,
 * entrance direction and touch-target sizing for InspectModal / Logbook /
 * HangarPanel, so the geometry can live in constants instead of hard-coded
 * utilities.
 *
 * R16 "Living World": extracted verbatim from InspectModal.jsx (round 15 §A3,
 * where it was a private function) so the overlays share ONE breakpoint.
 *
 * ROUND 17: now a thin wrapper over `useDeviceLayout().isSheet`, which is the
 * UNION `isPhone || width ≤ 639`. The width term is the old rule byte-for-byte
 * (narrow desktop windows behave exactly as before); the `isPhone` term is the
 * fix — a phone held in LANDSCAPE is 844 px wide, so it used to fail the width
 * test and got a desktop-sized dialog on a 390 px-tall screen. Public API and
 * return type are unchanged (a boolean), so existing call sites are untouched.
 */
export function useSheetLayout() {
  return useDeviceLayout().isSheet;
}

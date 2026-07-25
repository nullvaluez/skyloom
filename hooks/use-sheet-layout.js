'use client';

import { useEffect, useState } from 'react';

/**
 * Phone-sheet breakpoint (Tailwind `sm`). matchMedia, not a resize listener:
 * one state update when the breakpoint is actually crossed (rotation), never
 * per pixel. Drives layout + entrance direction + touch-target sizing, so the
 * geometry can live in constants instead of hard-coded utilities.
 *
 * R16 "Living World": EXTRACTED VERBATIM from InspectModal.jsx (round 15 §A3,
 * where it was a private function) so the Logbook overlay and the inspect
 * sheet share ONE breakpoint definition — the same media string, the same
 * single state update. Mechanical move: InspectModal only swapped its local
 * function for this import; zero behavior change, zero testid change.
 */
export function useSheetLayout() {
  const [isSheet, setIsSheet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = () => setIsSheet(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isSheet;
}

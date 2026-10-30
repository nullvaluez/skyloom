'use client';

import { useEffect, useState } from 'react';

/**
 * SHIP PASS RELEASE — the height a card on the TITLE must clear so it never
 * covers the imagery credit (a licence term: the credit is always visible).
 * CinemaTitle measures its credit strip and publishes the reserve as
 * `--fly-title-attr-reserve` on its root (`title-screen`); this reads it, and
 * re-reads when the root or the credit resizes. Used by ConsentPrompt (RL-6)
 * and the OfflineShell install hint (RL-8), which show on the title only.
 */
const FALLBACK_PX = 40;

export function useTitleCreditReserve(active = true) {
  const [px, setPx] = useState(FALLBACK_PX);
  useEffect(() => {
    if (!active) return undefined;
    const root = document.querySelector('[data-testid="title-screen"]');
    if (!root || typeof ResizeObserver !== 'function') return undefined;
    let raf = 0;
    // Read a frame later: the title's own observer writes the property first.
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const v = parseFloat(root.style.getPropertyValue('--fly-title-attr-reserve'));
        setPx(Number.isFinite(v) && v > 0 ? v : FALLBACK_PX);
      });
    };
    const ro = new ResizeObserver(read); // fires once on observe, then on every resize
    ro.observe(root);
    const credit = root.querySelector('[data-testid="title-attribution"]');
    if (credit) ro.observe(credit);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [active]);
  return px;
}

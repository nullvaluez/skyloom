'use client';

/*
 * LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md; the TOUCH stream owns this file) — the
 * touch-only controls that live over the lounge view: the walk stick while
 * standing, and anything else a thumb needs that is not part of the HUD's
 * dock. Mounted once by LoungeHud (the GLASS stream's file) right after the
 * look surface. `blocked` is true while a sheet or panel covers the thumb
 * zone (the GLASS stream wires it); the controls hide then.
 *
 * W0 stub: renders nothing until the TOUCH stream builds it.
 */
export function LoungeTouchControls({ runtime, watch, blocked = false }) {
  return null;
}

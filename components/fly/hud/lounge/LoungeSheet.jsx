'use client';
import { useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MOBILE_GLASS } from '@/lib/fly/observation-config';

/*
 * LOUNGE MOBILE — GLASS: the parts every phone bottom sheet shares (the
 * spotter card, the board, the lounge menu, the seat menu).
 *  - SheetGrabber: the handle at a sheet's top edge. A tap toggles it, a swipe
 *    up expands it, a swipe down collapses (or closes) it; a 44 px tall strip
 *    so a thumb finds it without aiming.
 *  - CardToggle: the spotter sheet's More / Less, beside its primary actions
 *    (the route, the live figures and the minor actions are its "more").
 */
export function SheetGrabber({ expanded, onToggle, onExpand, onCollapse, label }) {
  const start = useRef(null);
  const swipe = MOBILE_GLASS.sheetSwipePx;
  return (
    <button
      type="button"
      className="lsheet-grab"
      aria-expanded={expanded}
      aria-label={label}
      onPointerDown={(e) => {
        start.current = { y: e.clientY, id: e.pointerId, swiped: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId || s.swiped) return;
        const dy = e.clientY - s.y;
        if (dy < -swipe) {
          s.swiped = true;
          (onExpand ?? onToggle)?.();
        } else if (dy > swipe) {
          s.swiped = true;
          (onCollapse ?? onToggle)?.();
        }
      }}
      onClick={() => {
        const s = start.current;
        start.current = null;
        if (!s?.swiped) onToggle?.();
      }}
    >
      <i aria-hidden="true" />
    </button>
  );
}

export function CardToggle({ expanded, onToggle }) {
  return (
    <button type="button" className="lc-chip lc-more" data-testid="spotter-expand" aria-expanded={expanded} aria-label={expanded ? 'Show less' : 'Show the route, the live figures and more'} onClick={onToggle}>
      {expanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
      <span>{expanded ? 'Less' : 'More'}</span>
    </button>
  );
}

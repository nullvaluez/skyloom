'use client';
import { Armchair } from 'lucide-react';

/*
 * The lounge bar's "Seats" button (LOUNGE_WALK): opens and closes the seat
 * menu (also V). Test id lounge-seats. Nothing without walking.
 */
export function SeatsButton({ runtime, watch }) {
  if (!watch.walk) return null;
  return (
    <button
      type="button"
      className="lounge-btn"
      data-testid="lounge-seats"
      aria-pressed={!!watch.seatMenu}
      aria-haspopup="dialog"
      onClick={() => runtime.airportWatch?.seatMenuOpen()}
      title="Seats (V)"
    >
      <Armchair size={16} aria-hidden="true" />
      <span>Seats</span>
      <span className="tgt-kbd">V</span>
    </button>
  );
}

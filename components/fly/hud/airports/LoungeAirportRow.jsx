'use client';
import { Binoculars } from 'lucide-react';

const countries = new Intl.DisplayNames(['en'], { type: 'region' });

/** An airport-level watch action. Flight starts stay in the hangar chooser. */
export function LoungeAirportRow({ airport: a, busy, onChoose }) {
  const place = [a.city, a.country ? countries.of(a.country) : null].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className="ab-lounge-row"
      data-testid={`airport-result-${a.ident}`}
      disabled={busy}
      onClick={() => onChoose(a.id)}
      aria-label={`Watch ${a.name}${a.city ? `, ${a.city}` : ''}`}
    >
      <span className="ab-lounge-code">{a.iata || a.ident}</span>
      <span className="ab-lounge-place">
        <strong title={a.name}>{a.name}</strong>
        <span>{a.ident}{place ? ` · ${place}` : ' · Airport lounge'}</span>
      </span>
      <Binoculars size={17} aria-hidden="true" />
    </button>
  );
}

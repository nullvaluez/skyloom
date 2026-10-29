'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Coffee, Eye, Map as MapIcon, Plane, X } from 'lucide-react';
import './lounge-life.css';

/*
 * Inspectable décor (LOUNGE_PIER; the second-level pass, LIFE). Standing still
 * near a piece the pier room offers for a closer look (the model aircraft,
 * the stair's chart prints, the library, the coffee station:
 * lib/fly/lounge/upper-dressing.mjs INSPECTABLES, once built), facing it, a
 * quiet prompt appears; Enter or a click opens a calm card of text about it.
 * Enter or Escape closes the card and focus returns where it was. No camera
 * move, no reward, nothing remembered. Needs walking (LOUNGE_WALK), never the
 * instruments. Test ids lounge-decor-prompt, lounge-decor-card.
 *
 * The walk runtime owns the state (watch.walk.inspectOffer / .inspecting /
 * openInspect / closeInspect); this file polls it, as the observatory HUD
 * polls its snapshot, because the published lounge state carries only the
 * fields every room shares.
 */

const ICONS = { display: Plane, charts: MapIcon, shelf: BookOpen, prop: Coffee };
const KIND = { 'model-display': 'display', 'stair-charts': 'charts', library: 'shelf', 'coffee-station': 'prop' };

/** The walk's floor and décor state, polled at 8 Hz; re-renders only when one of them changes. */
export function useWalkFeel(runtime, id) {
  const [state, setState] = useState({ floorId: null, offer: null, open: null });
  useEffect(() => {
    let last = '';
    const read = () => {
      const walk = runtime.airportWatch?.walk;
      const next = { floorId: walk?.floorId ?? null, offer: walk?.inspectOffer ?? null, open: walk?.inspecting ?? null };
      const key = `${next.floorId}|${next.offer?.id ?? ''}|${next.open?.id ?? ''}`;
      if (key === last) return;
      last = key;
      setState(next);
    };
    read();
    const timer = setInterval(read, 120);
    return () => clearInterval(timer);
  }, [runtime, id]);
  return state;
}

export function DecorPrompt({ runtime, offer }) {
  if (!offer) return null;
  const Icon = ICONS[KIND[offer.id]] ?? Eye;
  return (
    <button
      type="button"
      className="lounge-decor-prompt"
      data-testid="lounge-decor-prompt"
      onClick={() => runtime.airportWatch?.walk?.openInspect(offer.id)}
      aria-label={`${offer.prompt} (Enter)`}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{offer.prompt}</span>
      <kbd>Enter</kbd>
    </button>
  );
}

/** `touch` (LOUNGE MOBILE): a touch device, so the close hint names the button, not the keys. */
export function DecorCard({ runtime, item, touch = false }) {
  const card = useRef(null);
  // Focus moves into the card and returns, on close, to what had it (or to
  // the look surface when that was the prompt, which the card replaces).
  useEffect(() => {
    const before = typeof document === 'undefined' ? null : document.activeElement;
    card.current?.focus({ preventScroll: true });
    return () => {
      const back = before && before.isConnected && before !== document.body ? before : document.querySelector('[data-testid="lounge-surface"]');
      back?.focus?.({ preventScroll: true });
    };
  }, [item.id]);
  const close = () => runtime.airportWatch?.walk?.closeInspect();
  const Icon = ICONS[KIND[item.id]] ?? Eye;
  return (
    <section
      ref={card}
      className="lounge-decor-card"
      data-testid="lounge-decor-card"
      role="dialog"
      aria-labelledby="lounge-decor-title"
      aria-describedby="lounge-decor-text"
      tabIndex={-1}
      onKeyDown={(e) => {
        // Enter on the card itself closes it (its button answers Enter on its own).
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          close();
        }
      }}
    >
      <button type="button" className="lounge-decor-close" aria-label="Close" onClick={close}>
        <X size={16} aria-hidden="true" />
      </button>
      <Icon size={20} aria-hidden="true" className="lounge-decor-icon" />
      <h2 id="lounge-decor-title">{item.label}</h2>
      <p id="lounge-decor-text">{item.text}</p>
      <small>{touch ? 'Tap × to close' : 'Enter or Esc to close'}</small>
    </section>
  );
}

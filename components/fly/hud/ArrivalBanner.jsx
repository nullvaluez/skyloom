'use client';

import { useEffect } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { ATLAS_KIND } from './atlas/atlas-tokens';
import { CARD_THEME } from './inspect/inspect-tokens';

const BANNER_MS = 3200;

/**
 * Atlas-warp arrival treatment (FLY_ATLAS_REWORK §4.1): the destination
 * name in Archivo Black fading over ~3s while the world streams in under
 * it — same visual language as the nearest-POI HUD line. Pure DOM/CSS.
 */
export function ArrivalBanner() {
  const arrival = useFlyStore((s) => s.arrival);

  useEffect(() => {
    if (!arrival) return undefined;
    const id = setTimeout(() => useFlyStore.getState().setArrival(null), BANNER_MS);
    return () => clearTimeout(id);
  }, [arrival]);

  if (!arrival) return null;
  const kind = ATLAS_KIND[arrival.kind];

  return (
    <div
      key={arrival.at}
      className="pointer-events-none absolute inset-x-0 top-[26%] z-20 flex flex-col items-center"
      data-testid="arrival-banner"
    >
      <style>{`
        @keyframes fly-arrival {
          0% { opacity: 0; transform: scale(1.12); letter-spacing: 0.5em; }
          14% { opacity: 1; transform: scale(1); letter-spacing: 0.18em; }
          72% { opacity: 1; }
          100% { opacity: 0; transform: scale(0.98); }
        }
      `}</style>
      <div
        className="px-6 text-center text-4xl uppercase text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]"
        style={{
          fontFamily: CARD_THEME.fontDisplay,
          letterSpacing: '0.18em',
          animation: `fly-arrival ${BANNER_MS}ms ease-out forwards`,
        }}
      >
        {arrival.name}
      </div>
      {kind && (
        <div
          className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.3em]"
          style={{
            color: kind.color,
            animation: `fly-arrival ${BANNER_MS}ms ease-out forwards`,
          }}
        >
          {kind.label}
        </div>
      )}
    </div>
  );
}

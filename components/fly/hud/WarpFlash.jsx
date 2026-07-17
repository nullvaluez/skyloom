'use client';

import { useEffect, useState } from 'react';
import { WARP } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Full-screen warp effect: white radial flash + expanding ring + "WARP"
 * stamp, keyed on fly-store.warpEpoch so every warp restarts the CSS
 * animation. Also usefully masks the first beat of terrain-tile stream-in
 * at the destination. Pure DOM/CSS — nothing per-frame.
 */
export function WarpFlash() {
  const warpEpoch = useFlyStore((s) => s.warpEpoch);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (warpEpoch === 0) return undefined;
    setActive(true);
    const id = setTimeout(() => setActive(false), WARP.flashMs);
    return () => clearTimeout(id);
  }, [warpEpoch]);

  if (!active) return null;
  return (
    <div key={warpEpoch} className="pointer-events-none absolute inset-0 z-30">
      <style>{`
        @keyframes fly-warp-flash {
          0% { opacity: 1; }
          55% { opacity: 0.55; }
          100% { opacity: 0; }
        }
        @keyframes fly-warp-ring {
          0% { transform: translate(-50%, -50%) scale(0.05); opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scale(3.2); opacity: 0; }
        }
        @keyframes fly-warp-text {
          0% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; letter-spacing: 1.2em; }
          25% { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; letter-spacing: 0.4em; }
        }
      `}</style>
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(199,222,255,0.65) 35%, rgba(120,170,255,0.15) 70%, transparent 100%)',
          animation: `fly-warp-flash ${WARP.flashMs}ms ease-out forwards`,
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-64 w-64 rounded-full border-2 border-white/80"
        style={{ animation: `fly-warp-ring ${WARP.flashMs}ms cubic-bezier(0.16, 1, 0.3, 1) forwards` }}
      />
      <div
        className="absolute left-1/2 top-1/2 font-mono text-3xl font-bold uppercase text-white"
        style={{ animation: `fly-warp-text ${WARP.flashMs}ms ease-out forwards` }}
      >
        Warp
      </div>
    </div>
  );
}

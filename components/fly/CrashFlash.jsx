'use client';

import { useEffect, useState } from 'react';
import { CRASH } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Round 18 (A5 GRAVITY) — the crash cut, keyed on fly-store.crashEpoch.
 *
 * WarpFlash's local-warp branch, in the other direction: that one is a white
 * bloom that says "you are somewhere new", this is a red slam that says "that
 * was your fault". It fires on the SAME beat as the respawn teleport, so it is
 * also the mask over the cut — exactly the job WarpFlash does for a warp.
 *
 * Pure DOM/CSS, nothing per-frame, unmounted between crashes. It is also
 * deliberately standalone: it needs only the store epoch, so it communicates
 * the crash on its own if A4's RunSummary/juice are not present.
 */
export function CrashFlash() {
  const crashEpoch = useFlyStore((s) => s.crashEpoch);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (crashEpoch === 0) return undefined;
    setOn(true);
    const id = setTimeout(() => setOn(false), CRASH.sequence.flashMs);
    return () => clearTimeout(id);
  }, [crashEpoch]);

  if (!on) return null;

  const kind = useFlyStore.getState().lastCrash?.kind;
  const ms = CRASH.sequence.flashMs;

  return (
    <div
      key={crashEpoch}
      data-testid="crash-flash"
      data-kind={kind ?? 'terrain'}
      className="pointer-events-none absolute inset-0 z-30"
    >
      <style>{`
        @keyframes fly-crash-slam {
          0% { opacity: 0.92; }
          18% { opacity: 0.55; }
          100% { opacity: 0; }
        }
        @keyframes fly-crash-vignette {
          0% { opacity: 1; }
          70% { opacity: 0.7; }
          100% { opacity: 0; }
        }
        @keyframes fly-crash-text {
          0% { transform: translate(-50%, -50%) scale(1.35); opacity: 0; letter-spacing: 0.9em; }
          22% { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(0.94); opacity: 0; letter-spacing: 0.3em; }
        }
      `}</style>
      {/* the impact itself — a hot flash, not a white-out */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(255,238,228,0.95) 0%, rgba(255,120,70,0.6) 38%, rgba(150,20,10,0.2) 72%, transparent 100%)',
          animation: `fly-crash-slam ${ms}ms ease-out forwards`,
        }}
      />
      {/* the red vignette that lingers a beat longer than the flash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(120,8,8,0.55) 82%, rgba(70,0,0,0.85) 100%)',
          animation: `fly-crash-vignette ${ms}ms ease-in forwards`,
        }}
      />
      <div
        className="fly-display-lg absolute left-1/2 top-1/2 max-w-[92vw] font-mono font-bold uppercase text-white"
        style={{ animation: `fly-crash-text ${ms}ms ease-out forwards` }}
      >
        Crashed
      </div>
    </div>
  );
}

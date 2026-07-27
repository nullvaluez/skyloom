'use client';

import { useEffect } from 'react';
import { SESSION } from '@/lib/fly/fly-constants';
import { MOBILE_UI } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';
import { CARD_THEME } from './inspect/inspect-tokens';

const ROWS = [
  ['near misses', 'nearMisses'],
  ['buzzes', 'buzzes'],
  ['best combo', 'bestCombo'],
  ['contracts', 'contracts'],
];

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * ROUND 18 (A4 SHOWTIME) — end-of-run card.
 *
 * A5 GRAVITY's crash sequence calls `runtime.juice.onCrash()`, which banks the
 * run and flips `runSummaryOpen`. This mirrors ArrivalBanner's shape: a
 * self-dismissing overlay whose animation is re-keyed on the payload, so a
 * second crash replays it rather than leaving a stale card up.
 *
 * The whole card is the dismiss target (well past MOBILE_UI.minTargetPx), so
 * on a phone there is nothing to aim at — you tap the thing you are reading.
 * It is z-30, ABOVE the HUD zones (z-10) and the touch cluster (z-20): a run
 * has ended, and the controls under it are not the point any more.
 */
export function RunSummary() {
  const open = useFlyStore((s) => s.runSummaryOpen);
  const stats = useFlyStore((s) => s.runStats);
  const sessionScore = useFlyStore((s) => s.sessionScore);

  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(
      () => useFlyStore.getState().setRunSummaryOpen(false),
      SESSION.summaryAutoDismissSec * 1000
    );
    return () => clearTimeout(id);
  }, [open, stats]);

  if (!open || !stats) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <style>{`
        @keyframes fly-runsummary {
          0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
          12%  { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 1; }
        }
      `}</style>
      <button
        type="button"
        data-testid="run-summary"
        aria-label="Dismiss run summary"
        onClick={() => useFlyStore.getState().setRunSummaryOpen(false)}
        className="hud-flat-phone pointer-events-auto w-[min(88vw,340px)] rounded-2xl border px-5 py-4 text-left backdrop-blur-md"
        style={{
          minHeight: MOBILE_UI.minTargetPx,
          background: 'linear-gradient(180deg, rgba(16, 19, 34, 0.92), rgba(7, 10, 20, 0.95))',
          borderColor: CARD_THEME.edge,
          boxShadow: '0 18px 60px rgba(2, 4, 10, 0.7)',
          animation: 'fly-runsummary 420ms ease-out forwards',
        }}
      >
        <div
          className="text-[9px] uppercase tracking-[0.4em]"
          style={{ color: CARD_THEME.iceDim }}
        >
          run ended
        </div>
        <div
          className="fly-display-lg mt-1 uppercase"
          style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
          data-testid="run-summary-score"
        >
          {(stats.score ?? 0).toLocaleString()}
        </div>

        <div
          className="my-3 h-px w-full"
          style={{ background: CARD_THEME.edgeSoft }}
          aria-hidden="true"
        />

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {ROWS.map(([label, key]) => (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <span
                className="text-[9px] uppercase tracking-[0.22em]"
                style={{ color: CARD_THEME.iceFaint }}
              >
                {label}
              </span>
              <span className="font-mono text-[12px]" style={{ color: CARD_THEME.ice }}>
                {stats[key] ?? 0}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-[9px] uppercase tracking-[0.22em]"
              style={{ color: CARD_THEME.iceFaint }}
            >
              airtime
            </span>
            <span className="font-mono text-[12px]" style={{ color: CARD_THEME.ice }}>
              {mmss(stats.durationSec)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-[9px] uppercase tracking-[0.22em]"
              style={{ color: CARD_THEME.iceFaint }}
            >
              session
            </span>
            <span className="font-mono text-[12px]" style={{ color: '#fbbf24' }}>
              {sessionScore.toLocaleString()}
            </span>
          </div>
        </div>

        <div
          className="mt-3 text-center text-[9px] uppercase tracking-[0.3em]"
          style={{ color: CARD_THEME.iceFaint }}
        >
          tap to dismiss
        </div>
      </button>
    </div>
  );
}

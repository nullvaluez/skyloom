'use client';

import { BarChart3, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { setConsent } from '@/lib/fly/analytics';

/**
 * SHIP PASS RL-6 (ANALYTICS_V2) — the first-run consent prompt.
 *
 * Non-blocking: a small card in the lower left that never pauses the flight,
 * takes no focus and lets every other control work. Shown once, after the
 * player's first completed flight (components/fly/hud/ReleaseAnalytics.jsx
 * decides), only while the choice was never made. Either answer persists in
 * `fly-analytics-consent`; the Settings row (GuestSaveControls) changes it
 * later. Nothing is sent before "Share" (lib/fly/analytics.js).
 */
export function ConsentPrompt() {
  const open = useFlyStore((s) => s.consentPrompt);
  if (!open) return null;
  const answer = (yes) => {
    setConsent(yes);
    useFlyStore.getState().setConsentPrompt(false);
  };
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-prompt-title"
      data-testid="consent-prompt"
      className="pointer-events-auto absolute bottom-[max(env(safe-area-inset-bottom),1rem)] left-[max(env(safe-area-inset-left),1rem)] z-30 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-zinc-700/70 bg-zinc-950/90 p-3 text-xs text-zinc-200 shadow-xl"
    >
      <div className="flex items-start gap-2">
        <BarChart3 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-sky-300" />
        <div className="min-w-0">
          <p id="consent-prompt-title" className="text-sm font-medium text-zinc-100">Help improve Skyloom?</p>
          <p className="mt-1 text-zinc-300">
            Share anonymous usage: which modes you play, how smoothly it runs, and crash reports. Never your location,
            aircraft you spot, or photos. You can change this in Settings.
          </p>
        </div>
        <button type="button" aria-label="Not now" className="ml-auto grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-400 hover:text-zinc-100" onClick={() => answer(false)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" data-testid="consent-decline" className="min-h-11 rounded-md px-3 text-zinc-300 hover:bg-zinc-800" onClick={() => answer(false)}>
          No thanks
        </button>
        <button type="button" data-testid="consent-share" className="min-h-11 rounded-md bg-sky-600 px-3 font-medium text-white hover:bg-sky-500" onClick={() => answer(true)}>
          Share
        </button>
      </div>
    </section>
  );
}

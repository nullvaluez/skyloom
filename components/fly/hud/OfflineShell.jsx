'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { shipPassOn } from '@/lib/fly/ship-pass';
import { offlineShellAction, syncOfflineShell, whenIdle } from '@/lib/fly/offline-shell';
import { deviceClassOf } from '@/lib/fly/device-policy';
import { useTitleCreditReserve } from './use-title-credit-reserve';

/**
 * SHIP PASS RL-8 (OFFLINE_SHELL) — the worker's registration (or its kill
 * switch) once per page, and the install hint.
 *
 * The hint shows on touch devices (deviceClassOf(): phone or tablet), on the
 * SECOND visit after a completed flight (`fly-first-flight-v1`, written by
 * ReleaseAnalytics), on the title, when the app is not already installed and
 * the player never dismissed it. Where the browser offers an install prompt
 * (Android Chrome: `beforeinstallprompt`) the hint's button opens it; iOS
 * Safari has no prompt, so the hint says how (Share → Add to Home Screen).
 */
const VISITS_KEY = 'fly-visit-count-v1';
const DISMISS_KEY = 'fly-install-hint-v1';
const FIRST_FLIGHT_KEY = 'fly-first-flight-v1';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, v) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage blocked: the hint simply stays away
  }
}

/** Visits counted once per tab session; returns this visit's number. */
function countVisit() {
  let n = Number(read(VISITS_KEY)) || 0;
  try {
    if (!sessionStorage.getItem(VISITS_KEY)) {
      sessionStorage.setItem(VISITS_KEY, '1');
      n += 1;
      write(VISITS_KEY, String(n));
    }
  } catch {
    // sessionStorage blocked: count nothing
  }
  return n;
}

export function OfflineShell() {
  const onTitle = useFlyStore((s) => s.screen === 'title');
  const [eligible, setEligible] = useState(false);
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    // After load, in an idle period: the worker never competes with the boot.
    // `window.__flyOfflineShell` reports what this page load did (harnesses).
    const action = offlineShellAction();
    const status = { action, result: 'pending' };
    window.__flyOfflineShell = status;
    const cancelSync = whenIdle(() => {
      syncOfflineShell(action).then((result) => {
        status.result = result;
      });
    });
    if (!shipPassOn('OFFLINE_SHELL')) return cancelSync;
    // The completed flight must predate this visit: read it before anything this visit writes.
    const flewBefore = read(FIRST_FLIGHT_KEY) === '1';
    const visit = countVisit();
    const standalone = globalThis.matchMedia?.('(display-mode: standalone)')?.matches || globalThis.navigator?.standalone === true;
    const touch = ['phone', 'tablet'].includes(deviceClassOf());
    const show = touch && !standalone && flewBefore && visit >= 2 && read(DISMISS_KEY) !== '1';
    if (!show) return cancelSync;
    // Only a player the hint is for loses the browser's own mini-infobar.
    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const t = setTimeout(() => setEligible(true), 0);
    return () => {
      cancelSync();
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onPrompt);
    };
  }, []);

  const reserve = useTitleCreditReserve(eligible && onTitle);

  if (!eligible || !onTitle) return null;
  const dismiss = () => {
    write(DISMISS_KEY, '1');
    setEligible(false);
  };
  const install = async () => {
    try {
      await prompt?.prompt?.();
    } finally {
      dismiss();
    }
  };
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Install Skyloom"
      data-testid="install-hint"
      style={{ bottom: reserve + 12 }}
      className="pointer-events-auto absolute left-1/2 z-[46] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-950/90 p-2 pl-3 text-xs text-zinc-200 shadow-xl"
    >
      <Download size={16} aria-hidden="true" className="shrink-0 text-sky-300" />
      <p className="min-w-0 flex-1">{prompt ? 'Add Skyloom to your home screen for a full-screen window seat.' : 'Add Skyloom to your home screen: tap Share, then Add to Home Screen.'}</p>
      {prompt && (
        <button type="button" data-testid="install-hint-install" className="min-h-11 rounded-md bg-sky-600 px-3 font-medium text-white" onClick={install}>
          Install
        </button>
      )}
      <button type="button" aria-label="Dismiss" data-testid="install-hint-dismiss" className="grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-400 hover:text-zinc-100" onClick={dismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

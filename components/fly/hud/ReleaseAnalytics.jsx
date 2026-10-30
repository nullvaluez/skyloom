'use client';

import { useEffect } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { useAdventureStore } from '@/stores/adventure-store';
import { analyticsConsent, analyticsV2On, track } from '@/lib/fly/analytics';
import { frameSessionSummary } from '@/lib/fly/frame-api';
import { deviceClassOf } from '@/lib/fly/device-policy';

/**
 * SHIP PASS RL-6 (ANALYTICS_V2) and RL-10 (save durability) — the session
 * bookkeeping, at 1 Hz, outside the frame loop.
 *
 *   - mode_entered{mode} on every mode change, and minutes per mode for
 *     session_end{minutes_by_mode, preset, device_class} on pagehide, with
 *     perf_summary from FRAME's frameSessionSummary() (sent only once FRAME
 *     reports real values; the W0 stub's nulls send nothing);
 *   - lounge_movement_watched{movement} when the lounge director shows a
 *     touchdown or liftoff;
 *   - the FIRST COMPLETED FLIGHT (a flight of at least a minute that ends, or
 *     five minutes in one): asks the browser to keep this site's storage
 *     (navigator.storage.persist(), RL-10, once);
 *   - with ANALYTICS_V2 on, the consent never asked and a first flight
 *     completed (this visit or an earlier one), the consent prompt, raised on
 *     the TITLE only (never mid-flight, where a card in the lower left would
 *     sit on a phone's flight stick), once per visit. Automation
 *     (navigator.webdriver) is never prompted, so the harness fleet's long
 *     SwiftShader flights keep their layout; a harness opens it through
 *     `setConsentPrompt`.
 * Every track() call is a no-op without consent or with the flag off.
 */
const FLIGHT_MODES = new Set(['free', 'journey', 'ops']);
const FIRST_FLIGHT_KEY = 'fly-first-flight-v1';
const PERSIST_KEY = 'fly-storage-persist-v1';

export function modeOf(s, adventureActive) {
  if (s.airportWatch) return 'watch';
  if (s.screen === 'title') return 'title';
  if (s.screen === 'hangar' || s.hangarOpen) return 'hangar';
  if (adventureActive) return 'journey';
  return s.flightMode === 'ops' ? 'ops' : 'free';
}

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // storage blocked: it simply happens again next session
  }
}

export function ReleaseAnalytics({ runtime }) {
  useEffect(() => {
    const minutes = {};
    let mode = null;
    let since = performance.now();
    let flightSec = 0;
    let firstDone = readFlag(FIRST_FLIGHT_KEY);
    let ended = false;
    const seenMoments = new Set();
    // deviceClassOf() can open a throwaway WebGL context to read the GPU, so it
    // is asked only when the event will be sent (track() is a no-op flag off).
    if (analyticsV2On()) track('session_start', { device_class: deviceClassOf() });

    const completeFirstFlight = () => {
      if (firstDone) return;
      firstDone = true;
      writeFlag(FIRST_FLIGHT_KEY);
      if (!readFlag(PERSIST_KEY)) {
        writeFlag(PERSIST_KEY);
        navigator.storage?.persist?.().catch(() => {});
      }
    };
    let prompted = false;
    const automation = globalThis.navigator?.webdriver === true;

    const tick = () => {
      const s = useFlyStore.getState();
      const next = modeOf(s, !!useAdventureStore.getState().progress?.active && s.screen === 'flight');
      const now = performance.now();
      if (mode) minutes[mode] = (minutes[mode] ?? 0) + (now - since) / 60000;
      since = now;
      if (next !== mode) {
        if (FLIGHT_MODES.has(mode) && flightSec >= 60) completeFirstFlight();
        flightSec = 0;
        mode = next;
        track('mode_entered', { mode });
      } else if (FLIGHT_MODES.has(mode) && s.phase !== 'paused') {
        flightSec += 1;
        if (flightSec >= 300) completeFirstFlight();
      }
      if (!prompted && !automation && firstDone && s.screen === 'title' && analyticsV2On() && analyticsConsent() == null) {
        prompted = true;
        s.setConsentPrompt(true);
      }
      const moments = runtime.airportWatch?.active ? runtime.airportWatch?.director?.snapshot?.()?.moments : null;
      for (const m of moments ?? []) {
        if (seenMoments.has(m.id)) continue;
        seenMoments.add(m.id);
        if (m.moment === 'touchdown') track('lounge_movement_watched', { movement: 'arrival' });
        else if (m.moment === 'liftoff') track('lounge_movement_watched', { movement: 'departure' });
      }
    };

    const end = () => {
      if (ended) return;
      ended = true;
      tick();
      const s = useFlyStore.getState();
      if (analyticsV2On()) track('session_end', { minutes_by_mode: minutes, preset: s.qualityPreset, device_class: deviceClassOf() });
      const perf = frameSessionSummary?.();
      if (perf && (perf.p95Bucket != null || perf.stallsPerMin != null || perf.rung != null)) {
        track('perf_summary', { p95_bucket: perf.p95Bucket ?? undefined, stalls_per_min: perf.stallsPerMin ?? undefined, rung: perf.rung ?? undefined });
      }
    };

    const timer = setInterval(tick, 1000);
    window.addEventListener('pagehide', end);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', end);
    };
  }, [runtime]);
  return null;
}

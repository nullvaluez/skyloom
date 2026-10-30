'use client';

import { useEffect, useState } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { pendingDeepLink, settleDeepLink } from '@/lib/fly/deep-link.mjs';
import { isAircraftId } from '@/lib/fly/player-aircraft';
import { livingAirportsOn } from '@/lib/fly/airport-feature-policy';
import { track } from '@/lib/fly/analytics';
import { useAdventureStore } from '@/stores/adventure-store';
import { registerRuntimeActions } from '@/lib/fly/runtime-bus';

/**
 * SHIP PASS RL-4 (DEEP_LINKS) — launches the page's entry link.
 *
 * The pre-mount blocks (front-door.js RELEASE entry, flight-plan.js RELEASE
 * spawn) already opened the session on the title, staged where the link
 * points. This waits for the boot reveal (`window.__flyBoot.pct === 100`, the
 * BootScreen contract, which LOAD_GUARD bounds), then opens the link's mode
 * exactly as the title's own buttons do: Free Flight through
 * `runtime.launchSetup` (Continue's path), a lounge through
 * `runtime.airportWatch.enter`, a journey's briefing through
 * `runtime.adventures.prepare`. If the player leaves the title first, the
 * link stands down. An invalid link, or one that cannot open, leaves the
 * title up with one quiet line that fades by itself.
 */
const DEADLINE_MS = 120000;
const NOTICE_MS = 6500;
// A lounge entry that fails on a data load is tried at most this often.
const WATCH_DATA_TRIES = 4;

function savedAircraft() {
  try {
    const id = localStorage.getItem('fly-aircraft');
    if (isAircraftId(id)) return id;
  } catch {
    // storage blocked
  }
  return useFlyStore.getState().aircraftId;
}

export function DeepLinkHost({ runtime }) {
  const [notice, setNotice] = useState('');

  // Pause's "Copy link" (current place) reads where the flight is through the
  // runtime bus, since PauseMenu holds no runtime. Re-registered on every
  // render that the runtime changes; FlyScene's teardown nulls it with the rest.
  useEffect(() => {
    registerRuntimeActions({
      currentPlace: () => {
        const g = runtime.geo; // Vector3(lon, lat, altM)
        return g && Number.isFinite(g.x) && Number.isFinite(g.y) ? { lat: g.y, lon: g.x, altM: Number.isFinite(g.z) ? g.z : null } : null;
      },
    });
  }, [runtime]);

  useEffect(() => {
    // The link is read on the first TICK, not in this effect's body: FlyMode's
    // pre-mount effect consumes it (resolveInitialSpawn's RELEASE spawn block),
    // and React runs a child's effects BEFORE its parent's on the mounting
    // commit, so here the link is not consumed yet (measured in the venue: the
    // ?fly= link was stripped and __flyDeepLink never set). By the first tick
    // the parent effect has run; no link then (none, or a harness bypass pin
    // left it unread) means there is nothing to launch.
    let link = null;
    let timer = null;
    let busy = false;
    let done = false;
    let started = 0;
    // `window.__flyDeepLink` says where the link stands (harnesses, and an
    // owner reading a phone's state): waiting | launched | refused | stood-down.
    let attempts = 0;
    let dataFailures = 0;
    let lastError = null;
    const report = (state, message = '') => {
      window.__flyDeepLink = { kind: link.ok ? link.kind : 'invalid', state, message, attempts, lastError, ms: Math.round(performance.now() - started) };
    };
    const finish = (message, state = message ? 'refused' : 'launched') => {
      done = true;
      settleDeepLink();
      clearInterval(timer);
      report(state, message);
      if (message) setNotice(message);
    };
    const arm = () => {
      link = pendingDeepLink();
      if (!link) {
        done = true;
        clearInterval(timer);
        return false;
      }
      track('deep_link_opened', { kind: link.ok ? link.kind : 'invalid' });
      report('waiting');
      started = performance.now();
      if (!link.ok) {
        finish("That link didn't match a place in Skyloom, so you're on the title.");
        return false;
      }
      return true;
    };
    // FlyMode sets the opening screen only once the (async) spawn resolves, and
    // a linked spawn far from home takes longer: until the title has been up,
    // "not on the title" means "not yet", not "the player left" (measured in
    // the venue: the ?fly= link stood down at its first tick on the store's
    // default 'hangar' screen).
    let sawTitle = false;
    const step = () => {
      if (done || busy) return;
      if (!link && !arm()) return;
      const s = useFlyStore.getState();
      const late = performance.now() - started > DEADLINE_MS;
      if (s.screen === 'title') sawTitle = true;
      else if (sawTitle) return finish('', 'stood-down'); // the player chose something else
      else {
        if (late) finish("The world took too long to load, so that link didn't open.");
        return;
      }
      if (globalThis.window?.__flyBoot?.pct !== 100) {
        if (late) finish("The world took too long to load, so that link didn't open.");
        return;
      }
      if (link.kind === 'fly' || link.kind === 'at') {
        if (typeof runtime.launchSetup !== 'function') return late ? finish("That link couldn't open. You're on the title.") : undefined;
        const ok = runtime.launchSetup({ flightMode: 'free', aircraftId: link.aircraftId ?? savedAircraft(), dest: link.kind === 'fly' ? link.destinationId : link.dest });
        return finish(ok ? '' : "That flight couldn't start. You're on the title.");
      }
      if (link.kind === 'journey') {
        if (!runtime.adventures) return late ? finish("That journey couldn't open. You're on the title.") : undefined;
        if (!runtime.adventures.prepare(link.adventureId)) return finish("That journey isn't available. You're on the title.");
        if (link.aircraftId) {
          const st = useAdventureStore.getState();
          if (st.preflight?.id === link.adventureId) st.setPreflight({ ...st.preflight, aircraftId: link.aircraftId });
        }
        return finish('');
      }
      // watch
      if (!livingAirportsOn()) return finish("Watching airports isn't available here. You're on the title.");
      if (!runtime.airportWatch) return late ? finish("That airport couldn't open. You're on the title.") : undefined;
      busy = true;
      attempts++;
      runtime.airportWatch
        .enter(link.airportId, { origin: { kind: 'title' } })
        .then((ok) => {
          busy = false;
          if (ok !== false) return finish('');
          // false: the world was not ready for a transfer yet (no engine), or a
          // newer entry superseded this one; the screen check above stands the
          // link down if that was the player's own choice.
          if (late) finish("That airport couldn't open. You're on the title.");
          else report('waiting');
        })
        .catch((e) => {
          busy = false;
          // Worth another try before the deadline: "not ready" (the lounge
          // asking for a moment), and — a few times — a data load that was cut
          // off or failed (the runway catalog's first fetch is 2.4 MB under a
          // 15 s timeout; measured in the venue: "The user aborted a
          // request."). A player who taps an airport card can tap again; a link
          // has no second tap.
          const msg = String(e?.message || '');
          lastError = `${e?.name || 'Error'}: ${msg.slice(0, 120)}`;
          const notReady = /not ready|still loading/i.test(msg);
          const dataLoad = e?.name === 'AbortError' || e?.name === 'TimeoutError' || /abort|timed out|could not load|failed to fetch|network/i.test(msg);
          if (!late && (notReady || (dataLoad && ++dataFailures < WATCH_DATA_TRIES))) return report('waiting');
          finish(`${link.airport.name} couldn't open right now. You're on the title.`);
        });
      return undefined;
    };
    timer = setInterval(step, 500);
    return () => clearInterval(timer);
  }, [runtime]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="deep-link-notice"
      className="pointer-events-none absolute left-1/2 top-[max(env(safe-area-inset-top),1rem)] z-[60] max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md bg-zinc-900/85 px-3 py-2 text-center text-xs text-zinc-200 shadow-lg"
    >
      {notice}
    </div>
  );
}

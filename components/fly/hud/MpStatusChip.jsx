'use client';

import { useEffect, useState } from 'react';
import { useMpStore } from '@/stores/mp-store';
import { useFlyStore } from '@/stores/fly-store';
import { useAdventureStore } from '@/stores/adventure-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { MULTIPLAYER } from '@/lib/fly/fly-constants';
import './mp.css';

// The dot's colour per non-online status (online wears the player's own
// palette colour — the same one other pilots see on their labels).
const DOT = {
  connecting: '#fbbf24',
  offline: '#94a3b8',
  full: '#fbbf24',
  outdated: '#ff5f8f',
  replaced: '#94a3b8',
};
const STATUS_TEXT = {
  connecting: 'Connecting…',
  offline: 'Offline — retrying',
  full: 'Sky is full — retrying',
  outdated: 'Multiplayer was updated — reload',
  replaced: 'Opened in another tab',
};

/**
 * freeFlightExclusive's Adventure term (lib/fly/encounter-runtime.js), read
 * off the adventure store so it re-renders: the session leaves the sky while
 * an Adventure flies or finishes, but mp-store stays 'online' through the
 * linger. The chip and the touch signals hide on it.
 */
export const adventureFlying = (s) => {
  const status = s.progress.active?.status;
  return status === 'flying' || status === 'finish';
};

/**
 * MULTIPLAYER (MULTIPLAYER.md §9/§10): who else is up here, and the
 * disclosure. Mounted by FlyMode only when mpAvailable(); every number comes
 * from the low-rate mp-store (written by lib/fly/mp/session.js at most 1 Hz),
 * never from the frame loop.
 *
 * The disclosure ("You're visible to other pilots as HERON 27 · Turn off")
 * replaces the chip for MULTIPLAYER.disclosureShowMs after the FIRST welcome
 * of the page load (mp-store.disclosedAt, never reset on reconnect); the
 * session holds every STATE until it has been up disclosureHoldMs.
 *
 * Desktop: the chip is a button that opens the Atlas (clusters live there);
 * "reload" when the relay speaks a newer protocol. Touch: a passive readout
 * (see mp.css for why), except the disclosure's Turn off.
 */
export function MpStatusChip() {
  const enabled = useMpStore((s) => s.enabled);
  const status = useMpStore((s) => s.status);
  const online = useMpStore((s) => s.online);
  const nearby = useMpStore((s) => s.nearby);
  const callsign = useMpStore((s) => s.callsign);
  const color = useMpStore((s) => s.color);
  const disclosedAt = useMpStore((s) => s.disclosedAt);
  const freeFlight = useFlyStore((s) => s.screen === 'flight' && s.flightMode === 'free');
  const adventure = useAdventureStore(adventureFlying);
  const { isTouch, isPhone } = useDeviceLayout();

  // The disclosure window closes on a timer, not on a render: `closedFor` is
  // the disclosedAt whose window has run out (a mount after it ran out starts
  // closed, so a remount can never replay the banner).
  const [closedFor, setClosedFor] = useState(() =>
    disclosedAt > 0 && performance.now() - disclosedAt >= MULTIPLAYER.disclosureShowMs ? disclosedAt : 0
  );
  useEffect(() => {
    if (!(disclosedAt > 0)) return undefined;
    const left = disclosedAt + MULTIPLAYER.disclosureShowMs - performance.now();
    const id = setTimeout(() => setClosedFor(disclosedAt), Math.max(0, left));
    return () => clearTimeout(id);
  }, [disclosedAt]);
  const disclosing = disclosedAt > 0 && closedFor !== disclosedAt;

  if (!enabled || status === 'off' || !freeFlight || adventure) return null;

  const name = callsign || 'a random callsign';
  const dot = status === 'online' ? color || '#4ade80' : DOT[status] || DOT.offline;
  const root = {
    className: 'mp-chip',
    'data-testid': 'mp-chip',
    'data-status': status,
    style: { '--mp-dot': dot },
    // LabelCanvas picks planes off a WINDOW pointerdown; a press on the chip
    // must not also open the inspect card for whatever the cursor hovers.
    onPointerDown: (e) => e.stopPropagation(),
  };

  if (disclosing) {
    return (
      <div {...root}>
        <div className="mp-disclosure hud-glass" data-testid="mp-disclosure" role="status">
          <span>
            You&apos;re visible to other pilots as <span className="mp-callsign">{name}</span> ·
          </span>
          <button
            type="button"
            data-testid="mp-disclosure-off"
            aria-label="Turn off flying with others"
            onClick={() => useMpStore.getState().setEnabled(false)}
          >
            Turn off
          </button>
        </div>
      </div>
    );
  }

  let text;
  if (status === 'online') {
    if (nearby === 0 && online > 1) {
      text = isTouch
        ? isPhone
          ? 'No one nearby · see the Atlas'
          : 'No one nearby · the Atlas shows where pilots are'
        : 'No one nearby · Atlas (M) shows where pilots are';
    } else {
      text = (
        <>
          {online} online · {nearby} in range
          {!isPhone && (
            <span className="mp-you">
              {' '}
              · you are <span className="mp-callsign">{name}</span>
            </span>
          )}
        </>
      );
    }
  } else {
    text = STATUS_TEXT[status] || STATUS_TEXT.offline;
  }

  const body = (
    <>
      <span className="mp-dot" aria-hidden="true" />
      <span>{text}</span>
    </>
  );
  const outdated = status === 'outdated';
  return (
    <div {...root}>
      {isTouch ? (
        <div className="mp-chip-body hud-glass">{body}</div>
      ) : (
        <button
          type="button"
          className="mp-chip-body hud-glass"
          title={outdated ? 'Reload to fly with others again' : 'Open the Atlas — see where pilots are (M)'}
          onClick={() => {
            if (outdated) window.location.reload();
            else useFlyStore.getState().setAtlasOpen(true);
          }}
        >
          {body}
        </button>
      )}
    </div>
  );
}

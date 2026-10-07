'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, Crosshair, Eye, EyeOff, Hand, Info, ListChecks, Map, Navigation, Pause, Plane, Radar, ThumbsUp, Video, Wind, Zap } from 'lucide-react';
import { getBoostMirror } from '@/lib/fly/juice';
import { MULTIPLAYER } from '@/lib/fly/fly-constants';
import { mpAvailable } from '@/lib/fly/mp/mp-flag';
import { useMpStore } from '@/stores/mp-store';
import { useAdventureStore } from '@/stores/adventure-store';
import { adventureFlying } from './MpStatusChip';
import { useNearbyEntry } from './EncounterExperience';
import './mp.css';

const SPEEDS = [['slow', 'Slow'], ['cruise', 'Cruise'], ['boost', 'Fast']];
const ACTIONS = [
  ['look', 'Free look', Eye], ['atlas', 'Atlas', Map], ['logbook', 'Logbook', BookOpen],
  ['hangar', 'Hangar', Plane], ['contracts', 'Contracts', ListChecks], ['nearby', 'Nearby', Radar],
  ['photo', 'Photo', Camera],
];
// MULTIPLAYER quick signals: [id, label, icon, runtime.mp.signal code]. Read
// once (installUrlFlags runs before the lazy FlyMode import); flag off, both
// selectors below return constants, so neither store re-renders the panel.
const MP_TOUCH = mpAvailable();
const SIGNALS = [['wave', 'Wave', Hand, 1], ['follow', 'Follow me', Navigation, 2], ['nice', 'Nice', ThumbsUp, 3]];

/** Momentary hold, never a toggle; captured pointer identity survives two thumbs. */
function TouchBoost({ runtime }) {
  const pointer = useRef(null);
  const keyboard = useRef(false);
  const pulse = useRef(null);
  const meter = useRef(null);
  const [held, setHeld] = useState(false);
  const release = useCallback(() => {
    pointer.current = null;
    keyboard.current = false;
    clearTimeout(pulse.current);
    runtime.input?.setBoost(false);
    setHeld(false);
  }, [runtime]);
  const start = () => { runtime.input?.setBoost(true); setHeld(true); };
  useEffect(() => {
    const interval = setInterval(() => {
      const boost = getBoostMirror();
      if (meter.current) meter.current.value = boost.present ? Math.max(0, Math.min(1, boost.frac)) : 1;
    }, 100);
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(interval); clearTimeout(pulse.current);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden);
      runtime.input?.setBoost(false);
    };
  }, [runtime, release]);
  const endPointer = (event) => {
    event.stopPropagation();
    if (pointer.current !== event.pointerId) return;
    release();
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* synthetic */ }
  };
  return (
    <button type="button" data-testid="touch-boost" className="touch-action touch-boost" aria-label="Boost, hold to accelerate"
      aria-pressed={held} style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        event.preventDefault(); event.stopPropagation();
        if (pointer.current !== null || keyboard.current) return;
        pointer.current = event.pointerId;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic */ }
        start();
      }}
      onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}
      onPointerLeave={endPointer} onBlur={release}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault(); event.stopPropagation();
        if (event.repeat || pointer.current !== null) return;
        keyboard.current = true; start();
      }}
      onKeyUp={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault(); event.stopPropagation(); release();
      }}
      onClick={(event) => {
        event.stopPropagation();
        // Assistive activation has no held pointer/key. Offer a short pulse,
        // with the same unconditional release paths, rather than latching it.
        if (event.detail === 0 && !keyboard.current && pointer.current === null) {
          clearTimeout(pulse.current); start(); pulse.current = setTimeout(release, 180);
        }
      }}>
      <Zap size={17} aria-hidden="true" /><span>Hold boost</span>
      <progress ref={meter} max="1" value="1" aria-label="Boost charge" />
    </button>
  );
}

function Action({ id, label, Icon, active, disabled, cooling, onClick }) {
  return (
    <button type="button" data-testid={`touch-${id}`} className="touch-action" aria-pressed={active} disabled={disabled}
      aria-disabled={cooling || undefined} data-cooling={cooling ? '1' : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onClick(); }}>
      <Icon size={18} aria-hidden="true" /><span>{label}</span>
    </button>
  );
}

// The session owns both store mirrors (cooldown, smoke); these patches are
// no-ops once it has written them, and keep the buttons honest if it has not.
function sendSignal(runtime, code) {
  if (!runtime.mp?.signal(code)) return;
  const mp = useMpStore.getState(), now = performance.now();
  if (!(mp.signalCooldownUntil > now)) mp.patch({ signalCooldownUntil: now + MULTIPLAYER.signals.cooldownMs });
}
function toggleSmoke(runtime) {
  const on = runtime.mp?.toggleSmoke();
  if (typeof on === 'boolean' && useMpStore.getState().smoke !== on) useMpStore.getState().patch({ smoke: on });
}

/**
 * MULTIPLAYER (MULTIPLAYER.md §8): wave / follow me / nice / smoke, the touch
 * twins of keys 4–7. Mounted only while the session is online. The emotes dim
 * through the 2 s cooldown (one timer per cooldown, never a poll); smoke is a
 * toggle and shows its state.
 */
function TouchSignals({ runtime }) {
  const until = useMpStore((s) => s.signalCooldownUntil);
  const smoke = useMpStore((s) => s.smoke === true);
  // `cooledFor` = the cooldown deadline that has already passed.
  const [cooledFor, setCooledFor] = useState(() => (until > performance.now() ? 0 : until));
  useEffect(() => {
    if (!(until > 0)) return undefined;
    const id = setTimeout(() => setCooledFor(until), Math.max(0, until - performance.now()));
    return () => clearTimeout(id);
  }, [until]);
  const cooling = until > 0 && cooledFor !== until;
  return (
    <fieldset className="touch-target" data-testid="touch-signals">
      <legend>Signal nearby pilots</legend>
      <div className="touch-actions-grid">
        {SIGNALS.map(([id, label, Icon, code]) => (
          <Action key={id} id={`signal-${id}`} label={label} Icon={Icon} cooling={cooling} onClick={() => sendSignal(runtime, code)} />
        ))}
        <Action id="signal-smoke" label={smoke ? 'Smoke · on' : 'Smoke'} Icon={Wind} active={smoke} onClick={() => toggleSmoke(runtime)} />
      </div>
    </fieldset>
  );
}

export function TouchActionPanel({ runtime, speedPreset, actions, lookMode, locked, chasing, cinema, hangar, canHideInfo, reducedMotion }) {
  const panel = useRef(null);
  // Nearby lives here on touch: a closed touch HUD keeps one gameplay button.
  const nearby = useNearbyEntry();
  // An Adventure leaves the sky (signals would go nowhere) while mp-store
  // still reads 'online' for the linger — hide with the chip.
  const mpStatusOnline = useMpStore((s) => MP_TOUCH && s.status === 'online');
  const mpOnline = !useAdventureStore((s) => MP_TOUCH && adventureFlying(s)) && mpStatusOnline;
  useEffect(() => {
    // A disclosure, not a modal: no focus trap and no aria-modal. The joystick
    // and world remain usable; Escape/Back are handled by TouchControls.
    panel.current?.querySelector('button')?.focus({ preventScroll: true });
  }, []);
  return (
    <section ref={panel} id="touch-actions-panel" data-testid="touch-actions" data-touch-surface="actions"
      className="hud-glass touch-actions-panel" aria-labelledby="touch-actions-title"
      data-reduced-motion={reducedMotion ? '1' : undefined}
      onPointerDown={(event) => event.stopPropagation()}>
      <header className="touch-actions-heading">
        <h2 id="touch-actions-title">Flight actions</h2><span>Flight stays live</span>
      </header>
      <div className="touch-actions-scroll">
        <fieldset className="touch-speed" data-testid="touch-throttle">
          <legend>Speed</legend>
          <div>
            {SPEEDS.map(([key, label]) => (
              <button key={key} type="button" data-testid={`touch-throttle-${key}`} className="touch-action"
                aria-pressed={speedPreset === key}
                onClick={() => runtime.input?.setSpeedPreset(key)}>{runtime.operations?.lowSpeed ? ({slow:'Idle',cruise:'Taxi',boost:'Takeoff'})[key] : label}</button>
            ))}
          </div>
        </fieldset>
        {!runtime.operations?.lowSpeed && <TouchBoost runtime={runtime} />}
        <div className="touch-actions-grid">
          {ACTIONS.filter(([id]) => (id !== 'hangar' || hangar) && (id !== 'nearby' || nearby.available)).map(([id, label, Icon]) => (
            <Action key={id} id={id} label={id === 'nearby' && nearby.count ? `${label} · ${nearby.count}` : label}
              Icon={Icon} onClick={actions[id]} active={id === 'look' ? lookMode : undefined} />
          ))}
        </div>
        {locked && <fieldset className="touch-target" data-testid="touch-contextual">
          <legend>Selected aircraft</legend>
          <div className="touch-actions-grid">
            <Action id="inspect" label="Inspect" Icon={Info} onClick={actions.inspect} />
            <Action id="dismiss-info" label="Hide aircraft info" Icon={EyeOff} disabled={!canHideInfo} onClick={actions.dismiss} />
            <Action id="intercept" label={chasing ? 'Stop intercept' : 'Intercept'} Icon={Crosshair} active={chasing} onClick={actions.intercept} />
            {chasing && <Action id="cinema" label={cinema ? 'Exit cinema' : 'Cinema'} Icon={Video} active={cinema} onClick={actions.cinema} />}
          </div>
        </fieldset>}
        {mpOnline && <TouchSignals runtime={runtime} />}
        <Action id="pause" label="Pause / Settings" Icon={Pause} onClick={actions.pause} />
      </div>
    </section>
  );
}

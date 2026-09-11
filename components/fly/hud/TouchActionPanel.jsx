'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, Crosshair, Eye, EyeOff, Info, ListChecks, Map, Pause, Plane, Video, Zap } from 'lucide-react';
import { getBoostMirror } from '@/lib/fly/juice';

const SPEEDS = [['slow', 'Slow'], ['cruise', 'Cruise'], ['boost', 'Fast']];
const ACTIONS = [
  ['look', 'Free look', Eye], ['atlas', 'Atlas', Map], ['logbook', 'Logbook', BookOpen],
  ['hangar', 'Hangar', Plane], ['contracts', 'Contracts', ListChecks], ['photo', 'Photo', Camera],
];

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

function Action({ id, label, Icon, active, disabled, onClick }) {
  return (
    <button type="button" data-testid={`touch-${id}`} className="touch-action" aria-pressed={active} disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onClick(); }}>
      <Icon size={18} aria-hidden="true" /><span>{label}</span>
    </button>
  );
}

export function TouchActionPanel({ runtime, speedPreset, actions, lookMode, locked, chasing, cinema, hangar, canHideInfo, reducedMotion }) {
  const panel = useRef(null);
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
                onClick={() => runtime.input?.setSpeedPreset(key)}>{label}</button>
            ))}
          </div>
        </fieldset>
        <TouchBoost runtime={runtime} />
        <div className="touch-actions-grid">
          {ACTIONS.filter(([id]) => id !== 'hangar' || hangar).map(([id, label, Icon]) => (
            <Action key={id} id={id} label={label} Icon={Icon} onClick={actions[id]}
              active={id === 'look' ? lookMode : undefined} />
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
        <Action id="pause" label="Pause / Settings" Icon={Pause} onClick={actions.pause} />
      </div>
    </section>
  );
}

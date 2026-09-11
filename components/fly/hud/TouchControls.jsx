'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Zone } from '@/components/fly/LayoutRoot';
import { HANGAR } from '@/lib/fly/fly-constants';
import { readReducedMotion } from '@/lib/fly/immersive';
import { useOverlayBack, anyOverlayOpen } from '@/hooks/use-overlay-back';
import { dismissTouchInfo, readTouchSurface, setTouchSurface, useTouchSurface } from '@/hooks/use-touch-actions';
import { useFlyStore } from '@/stores/fly-store';
import { TouchActionPanel } from './TouchActionPanel';

const KNOB_TRAVEL = 52;
const hasTouchSurface = () => readTouchSurface() !== null;

function stampPress(key) {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    (window.__flyStats ??= {}).touchPress = { key, at: Date.now() };
  }
}

/** One finger owns the stick; a second thumb on Boost cannot steal its drag. */
function Thumbstick({ runtime, lookMode, reducedMotion }) {
  const base = useRef(null);
  const pointer = useRef(null);
  const last = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const apply = (event) => {
    const rect = base.current?.getBoundingClientRect();
    if (!rect) return;
    let x = event.clientX - rect.left - rect.width / 2;
    let y = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(x, y);
    if (distance > KNOB_TRAVEL) { x *= KNOB_TRAVEL / distance; y *= KNOB_TRAVEL / distance; }
    setKnob({ x, y });
    if (lookMode) {
      runtime.input?.addLook((event.clientX - last.current.x) / window.innerWidth,
        (event.clientY - last.current.y) / window.innerHeight);
      last.current = { x: event.clientX, y: event.clientY };
    } else runtime.input?.setTouchSteer(x / KNOB_TRAVEL, y / KNOB_TRAVEL);
  };
  const release = (event) => {
    event.stopPropagation();
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    runtime.input?.clearTouchSteer();
    setKnob({ x: 0, y: 0 });
    try { base.current?.releasePointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
  };
  useEffect(() => () => runtime.input?.clearTouchSteer(), [runtime]);
  return (
    <div ref={base} data-testid="touch-joystick" aria-label={lookMode ? 'Camera look joystick' : 'Flight joystick'}
      className="hud-glass pointer-events-auto relative grid h-32 w-32 place-items-center rounded-full"
      style={{ touchAction: 'none', border: `1px solid ${lookMode ? 'rgba(249,168,212,0.5)' : 'rgba(125,211,252,0.35)'}`, boxShadow: '0 8px 30px rgba(2,4,10,0.5)' }}
      onPointerDown={(event) => {
        event.preventDefault(); event.stopPropagation();
        if (pointer.current !== null) return;
        pointer.current = event.pointerId;
        last.current = { x: event.clientX, y: event.clientY };
        try { base.current?.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
        apply(event);
      }}
      onPointerMove={(event) => { event.stopPropagation(); if (pointer.current === event.pointerId) apply(event); }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}>
      <div className="pointer-events-none absolute inset-2 rounded-full border border-white/5" />
      <span className="pointer-events-none absolute top-2 font-mono text-[9px] uppercase tracking-widest text-blue-100/70">{lookMode ? 'look' : '▲'}</span>
      <div className="pointer-events-none h-14 w-14 rounded-full" style={{
        transform: `translate(${knob.x}px, ${knob.y}px)`,
        background: lookMode ? 'radial-gradient(circle at 35% 30%, #fce7f3, #f472b88c)' : 'radial-gradient(circle at 35% 30%, #eef5ff, #7dd3fc8c)',
        border: '1px solid rgba(255,255,255,0.55)',
        boxShadow: lookMode ? '0 0 16px #f472b866' : '0 0 16px #7dd3fc66',
        transition: reducedMotion || knob.x || knob.y ? 'none' : 'transform 0.18s ease-out',
      }} />
    </div>
  );
}

/**
 * The only persistent touch actions are the joystick and this disclosure.
 * The panel keeps flight live. Full overlays retain their existing flight
 * guards. Every button uses the same store/input path as the keyboard.
 */
export function TouchControls({ runtime }) {
  const covered = useFlyStore(anyOverlayOpen);
  const speedPreset = useFlyStore((s) => s.speedPreset);
  const lockedHex = useFlyStore((s) => s.lockedHex);
  const infoCardHex = useFlyStore((s) => s.infoCardHex);
  const lockState = useFlyStore((s) => s.lockState);
  const cameraMode = useFlyStore((s) => s.cameraMode);
  const surface = useTouchSurface();
  const [lookMode, setLookMode] = useState(false);
  const [inputEpoch, setInputEpoch] = useState(0);
  const fab = useRef(null);
  const previous = useRef({ covered, surface });
  const reducedMotion = readReducedMotion();

  const neutralize = useCallback(() => {
    runtime.input?.setBoost(false);
    runtime.input?.clearTouchSteer();
    runtime.input?.setLookActive(false);
    setLookMode(false);
    setInputEpoch((value) => value + 1);
  }, [runtime]);
  const close = useCallback(() => {
    neutralize();
    setTouchSurface(null);
  }, [neutralize]);
  useOverlayBack(true, !!surface, close, hasTouchSurface);

  useEffect(() => {
    runtime.input?.setLookActive(lookMode && !covered);
  }, [lookMode, covered, runtime]);

  useEffect(() => {
    const last = previous.current;
    previous.current = { covered, surface };
    if (covered && (!last.covered || surface)) close();
    if (!covered && (last.covered || (last.surface && !surface))) {
      // Modal focus restoration may target a button that the panel unmounted.
      // Restore to the persistent disclosure after the overlay has unwound.
      const frame = requestAnimationFrame(() => fab.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
  }, [covered, surface, close]);

  useEffect(() => {
    const visibility = () => { if (document.hidden) close(); };
    window.addEventListener('blur', close);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', close);
      document.removeEventListener('visibilitychange', visibility);
      runtime.input?.setBoost(false);
      runtime.input?.clearTouchSteer();
      runtime.input?.setLookActive(false);
      setTouchSurface(null);
    };
  }, [close, runtime]);

  useEffect(() => {
    if (!surface || covered) return undefined;
    const outside = (event) => {
      // Both thumbs can fly while the panel is open. No backdrop intercepts
      // the world, and touching the joystick never dismisses held controls.
      if (event.target instanceof Element && event.target.closest(
        '[data-touch-surface], [data-testid="touch-fab"], [data-testid="touch-joystick"]')) return;
      close();
    };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [surface, covered, close]);

  if (covered) return null;
  const press = (key) => { runtime.input?.press(key); stampPress(key); };
  const navigate = (action) => { close(); action(); };
  const locked = !!lockedHex && lockState !== 'none';
  const chasing = lockState === 'intercepting' || lockState === 'formation';
  const actions = {
    look: () => {
      runtime.input?.clearTouchSteer();
      setInputEpoch((value) => value + 1);
      setLookMode(!lookMode);
    },
    atlas: () => navigate(() => useFlyStore.getState().setAtlasOpen(true)),
    logbook: () => navigate(() => useFlyStore.getState().setLogbookOpen(true)),
    hangar: () => navigate(() => useFlyStore.getState().setHangarOpen(true)),
    contracts: () => { neutralize(); setTouchSurface('contracts'); },
    photo: () => navigate(() => press('p')),
    pause: () => navigate(() => useFlyStore.getState().setPhase('paused')),
    inspect: () => navigate(() => { useFlyStore.getState().setInspectHex(lockedHex); stampPress('t'); }),
    dismiss: dismissTouchInfo,
    intercept: () => { press('f'); },
    cinema: () => { press('c'); },
  };
  return (
    <>
      <Zone name="controls-left" style={{ left: 'max(var(--touch-safe-left), 18px)', bottom: 'calc(var(--touch-safe-bottom) + 3.25rem)' }}>
        <Thumbstick key={inputEpoch} runtime={runtime} lookMode={lookMode} reducedMotion={reducedMotion} />
      </Zone>
      <Zone name="controls-right" style={{ right: 'max(var(--touch-safe-right), 16px)', bottom: 'calc(var(--touch-safe-bottom) + 3.25rem)' }}>
        <button ref={fab} type="button" data-testid="touch-fab" className="hud-glass touch-actions-fab"
          aria-expanded={!!surface} aria-controls={surface === 'contracts' ? 'touch-contracts-panel' : 'touch-actions-panel'}
          aria-label={surface ? 'Close flight actions' : 'Open flight actions'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); if (surface) close(); else setTouchSurface('actions'); }}>
          {surface ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
          <span>{surface ? 'Close' : 'Actions'}</span>
        </button>
      </Zone>
      {surface === 'actions' && <TouchActionPanel runtime={runtime} speedPreset={speedPreset}
        actions={actions} lookMode={lookMode} locked={locked} chasing={chasing}
        cinema={cameraMode === 'cinema'} hangar={HANGAR.enabled} canHideInfo={!!infoCardHex} reducedMotion={reducedMotion} />}
    </>
  );
}

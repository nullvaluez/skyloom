'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, Map as MapIcon, Pause } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';

/**
 * On-screen flight controls for touch devices (mobile / tablet). Desktop
 * never mounts this — FlyMode gates it behind useIsTouch. Everything drives
 * the shared InputController imperatively (runtime.input), the same struct
 * the mouse/keyboard produce, so the flight model is untouched:
 *
 *   • left thumbstick  → setTouchSteer(x, y)   (turn + pitch, expo-shaped)
 *   • throttle rail     → setSpeedPreset(...)   (mirrors the 1/2/3 keys)
 *   • LOOK toggle       → setLookActive()/addLook()  (RMB-orbit equivalent)
 *   • ATLAS / PAUSE     → store transitions      (M / Esc equivalent)
 *
 * The controls hide themselves whenever a full overlay owns the screen
 * (pause menu, Atlas, inspect card) — the stick is neutralized there anyway.
 * Look mode auto-exits on any such overlay so it can never desync.
 */

const KNOB_TRAVEL = 52; // px — max thumbstick deflection from center

// Throttle detents, top (fast) → bottom (slow); mirrors keys 3 / 2 / 1.
const THROTTLE = [
  { key: 'boost', label: 'BOOST', tint: '#f9a8d4' },
  { key: 'cruise', label: 'CRUISE', tint: '#7dd3fc' },
  { key: 'slow', label: 'SLOW', tint: '#bef264' },
];

function Thumbstick({ runtime, lookMode }) {
  const baseRef = useRef(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragActive, setDragActive] = useState(false); // drives the snap-back

  const apply = (e) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > KNOB_TRAVEL) {
      dx = (dx / dist) * KNOB_TRAVEL;
      dy = (dy / dist) * KNOB_TRAVEL;
    }
    setKnob({ x: dx, y: dy });
    if (lookMode) {
      // Relative-drag orbit: feed raw finger deltas as screen fractions —
      // the same units an RMB drag produces (chase camera consumes them).
      runtime.input?.addLook(
        (e.clientX - last.current.x) / window.innerWidth,
        (e.clientY - last.current.y) / window.innerHeight
      );
      last.current = { x: e.clientX, y: e.clientY };
    } else {
      runtime.input?.setTouchSteer(dx / KNOB_TRAVEL, dy / KNOB_TRAVEL);
    }
  };

  const onDown = (e) => {
    e.preventDefault();
    dragging.current = true;
    setDragActive(true);
    last.current = { x: e.clientX, y: e.clientY };
    baseRef.current?.setPointerCapture?.(e.pointerId);
    apply(e);
  };
  const onMove = (e) => {
    if (dragging.current) apply(e);
  };
  const onUp = (e) => {
    dragging.current = false;
    setDragActive(false);
    baseRef.current?.releasePointerCapture?.(e.pointerId);
    setKnob({ x: 0, y: 0 });
    if (!lookMode) runtime.input?.clearTouchSteer();
  };

  return (
    <div
      ref={baseRef}
      data-testid="touch-joystick"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      className="pointer-events-auto relative grid h-32 w-32 place-items-center rounded-full"
      style={{
        touchAction: 'none',
        background: 'radial-gradient(circle at 50% 50%, rgba(14,20,34,0.5), rgba(6,9,16,0.62))',
        border: `1px solid ${lookMode ? 'rgba(249,168,212,0.5)' : 'rgba(125,211,252,0.35)'}`,
        boxShadow: '0 8px 30px rgba(2,4,10,0.5)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      {/* cardinal ticks */}
      <div className="pointer-events-none absolute inset-2 rounded-full border border-white/5" />
      <span
        className="pointer-events-none absolute font-mono text-[8px] uppercase tracking-widest"
        style={{ top: 7, color: lookMode ? 'rgba(249,168,212,0.75)' : 'rgba(191,219,254,0.55)' }}
      >
        {lookMode ? 'look' : '▲'}
      </span>
      {/* knob */}
      <div
        className="pointer-events-none h-14 w-14 rounded-full"
        style={{
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          background: lookMode
            ? 'radial-gradient(circle at 35% 30%, rgba(252,231,243,0.95), rgba(244,114,182,0.55))'
            : 'radial-gradient(circle at 35% 30%, rgba(238,245,255,0.95), rgba(125,211,252,0.55))',
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: lookMode
            ? '0 0 16px rgba(244,114,182,0.5), inset 0 1px 2px rgba(255,255,255,0.6)'
            : '0 0 16px rgba(125,211,252,0.5), inset 0 1px 2px rgba(255,255,255,0.6)',
          transition: dragActive ? 'none' : 'transform 0.18s ease-out',
        }}
      />
    </div>
  );
}

function Throttle({ runtime, preset, boost }) {
  const activeKey = boost ? 'boost' : preset;
  return (
    <div
      data-testid="touch-throttle"
      className="pointer-events-auto flex w-[68px] flex-col overflow-hidden rounded-2xl"
      style={{
        border: '1px solid rgba(125,211,252,0.28)',
        background: 'rgba(6,9,16,0.55)',
        boxShadow: '0 8px 30px rgba(2,4,10,0.5)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        touchAction: 'none',
      }}
    >
      {THROTTLE.map((t, i) => {
        const on = t.key === activeKey;
        return (
          <button
            key={t.key}
            data-testid={`touch-throttle-${t.key}`}
            onPointerDown={(e) => {
              e.preventDefault();
              runtime.input?.setSpeedPreset(t.key);
            }}
            className="flex items-center justify-center py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors"
            style={{
              color: on ? '#04060f' : 'rgba(203,213,225,0.75)',
              background: on ? t.tint : 'transparent',
              borderTop: i === 0 ? 'none' : '1px solid rgba(148,163,184,0.14)',
              textShadow: on ? 'none' : '0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ActionButton({ testid, label, active, onTap, children }) {
  return (
    <button
      data-testid={testid}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(e) => {
        e.preventDefault();
        onTap();
      }}
      className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full transition-colors"
      style={{
        border: `1px solid ${active ? 'rgba(249,168,212,0.6)' : 'rgba(125,211,252,0.3)'}`,
        background: active ? 'rgba(244,114,182,0.22)' : 'rgba(6,9,16,0.55)',
        color: active ? '#fbcfe8' : '#dbeafe',
        boxShadow: '0 6px 20px rgba(2,4,10,0.5)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        touchAction: 'none',
      }}
    >
      {children}
    </button>
  );
}

export function TouchControls({ runtime }) {
  const phase = useFlyStore((s) => s.phase);
  const atlasOpen = useFlyStore((s) => s.atlasOpen);
  const inspectHex = useFlyStore((s) => s.inspectHex);
  const speedPreset = useFlyStore((s) => s.speedPreset);
  const [lookMode, setLookMode] = useState(false);

  // A full overlay owns the screen (pause / Atlas / inspect) and neutralizes
  // the stick, so free-look must read as OFF while covered. Derive it — never
  // a second state that could desync — and let ONE effect mirror the effective
  // value onto the InputController (updating an external system is exactly
  // what an effect is for).
  const covered = phase === 'paused' || atlasOpen || !!inspectHex;
  const lookActive = lookMode && !covered;
  useEffect(() => {
    runtime.input?.setLookActive(lookActive);
  }, [lookActive, runtime]);

  // Boost is momentary state on the controller, not the store — reflect it in
  // the throttle highlight by polling at a lazy cadence (never per frame).
  const [boost, setBoost] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const cmd = runtime.input?.read?.();
      setBoost(!!cmd?.boost && cmd.speedPreset !== 'boost');
    }, 200);
    return () => clearInterval(id);
  }, [runtime]);

  if (covered) return null;

  const toggleLook = () => {
    setLookMode((v) => {
      if (!v) runtime.input?.clearTouchSteer(); // stop steering as look begins
      return !v;
    });
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Left thumbstick — lifted above the required attribution strip */}
      <div
        className="absolute"
        style={{
          left: 'max(env(safe-area-inset-left), 18px)',
          bottom: 'calc(env(safe-area-inset-bottom) + 3.25rem)',
        }}
      >
        <Thumbstick runtime={runtime} lookMode={lookActive} />
      </div>

      {/* Right cluster: action buttons above the throttle rail */}
      <div
        className="absolute flex flex-col items-end gap-3"
        style={{
          right: 'max(env(safe-area-inset-right), 16px)',
          bottom: 'calc(env(safe-area-inset-bottom) + 3.25rem)',
        }}
      >
        <div className="flex gap-2">
          <ActionButton
            testid="touch-look"
            label="Free look"
            active={lookActive}
            onTap={toggleLook}
          >
            <Eye className="h-5 w-5" />
          </ActionButton>
          <ActionButton
            testid="touch-atlas"
            label="Open Atlas"
            onTap={() => useFlyStore.getState().setAtlasOpen(true)}
          >
            <MapIcon className="h-5 w-5" />
          </ActionButton>
          <ActionButton
            testid="touch-pause"
            label="Pause"
            onTap={() => useFlyStore.getState().setPhase('paused')}
          >
            <Pause className="h-5 w-5" />
          </ActionButton>
        </div>
        <Throttle runtime={runtime} preset={speedPreset} boost={boost} />
      </div>
    </div>
  );
}

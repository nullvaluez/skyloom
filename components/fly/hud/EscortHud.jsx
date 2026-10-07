'use client';

import { useEffect, useRef } from 'react';
import { Clapperboard, Video, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { releaseEscort, toggleEscortCamera } from '@/lib/fly/escort';
import { MPS_TO_KT } from '@/lib/fly/coords';
import { ENCOUNTER_LIMITS } from '@/lib/fly/encounters.mjs';
import './target-ui.css';

/**
 * The escort HUD: what the intercept → formation autopilot is doing, to whom,
 * how far and how fast it is closing, plus the two controls that matter while
 * it flies — the camera (cinematic ⇄ chase, C) and Release (F).
 *
 * Replaces the old one-line text chip and keeps its contract: testid
 * `hud-chase-chip`, opacity 1 while an escort is up and 0 otherwise, and the
 * words INTERCEPT / FORMATION / CINEMA in its text (verify-inspect-actions and
 * verify-chase-cam read them). Discrete state comes from the store; the range
 * and closing-rate line is written through a ref at 4 Hz, never per frame.
 */
export function EscortHud({ runtime, cinematic }) {
  const lockState = useFlyStore((s) => s.lockState);
  const cameraMode = useFlyStore((s) => s.cameraMode);
  const lockedHex = useFlyStore((s) => s.lockedHex);
  const encounter = useEncounterStore((s) => s.active);
  const { isTouch } = useDeviceLayout();
  const active = lockState === 'intercepting' || lockState === 'formation';
  const cinema = cameraMode === 'cinema';
  const phase = lockState === 'formation' ? 'FORMATION' : 'INTERCEPT';
  const mode = cinema ? 'cinema' : lockState === 'formation' ? 'formation' : 'intercept';

  const nameRef = useRef(null);
  const subRef = useRef(null);
  const sample = useRef(null);
  useEffect(() => {
    sample.current = null;
    if (!active) return undefined;
    const tick = () => {
      const t = runtime.targeting?.target;
      if (!t) return;
      const name = t.meta?.flight?.trim() || t.meta?.r || t.hex?.toUpperCase() || '';
      if (nameRef.current && nameRef.current.textContent !== name) nameRef.current.textContent = name;
      const now = performance.now() / 1000;
      const s = sample.current;
      if (!s) sample.current = { d: t.distM, t: now, rate: null };
      else if (now - s.t >= 0.25) {
        const raw = (s.d - t.distM) / (now - s.t);
        s.rate = s.rate == null ? raw : s.rate + (raw - s.rate) * 0.35;
        s.d = t.distM;
        s.t = now;
      }
      const rate = sample.current.rate;
      const nm = t.distM / 1852;
      const dist = nm < 10 ? `${nm.toFixed(1)} nm` : `${Math.round(nm)} nm`;
      const words =
        lockState === 'formation'
          ? 'holding the wing'
          : rate == null
            ? 'closing in'
            : rate > 4
              ? `closing ${Math.round(rate * MPS_TO_KT)} kt`
              : rate < -4
                ? `opening ${Math.round(-rate * MPS_TO_KT)} kt`
                : 'matching speed';
      const text = `${cinema ? `${phase} · ` : ''}${dist} · ${words}`;
      if (subRef.current && subRef.current.textContent !== text) subRef.current.textContent = text;
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active, runtime, lockState, cinema, phase]);

  const hold =
    active && encounter?.kind === 'traffic' && encounter.hex === lockedHex
      ? Math.min(1, (encounter.seconds || 0) / ENCOUNTER_LIMITS.holdSec)
      : null;

  return (
    <div
      className="tgt tgt-escort"
      data-testid="hud-chase-chip"
      data-overlay="escort"
      data-active={active ? '1' : '0'}
      data-mode={mode}
      data-cinematic={cinematic ? '1' : '0'}
      aria-hidden={!active}
      role="status"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="tgt-escort-ring" aria-hidden="true">
        <svg viewBox="0 0 34 34">
          <circle
            cx="17"
            cy="17"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="10 6"
            opacity="0.9"
          />
        </svg>
        <svg viewBox="0 0 34 34">
          <circle cx="17" cy="17" r="5" fill="currentColor" opacity="0.25" />
          <circle cx="17" cy="17" r="2.2" fill="currentColor" />
          <path
            d="M17 1v6M17 27v6M1 17h6M27 17h6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="tgt-escort-text">
        <span className="tgt-escort-title">
          <em>{cinema ? 'CINEMA' : phase}</em>
          <span ref={nameRef} />
        </span>
        <span className="tgt-escort-sub" ref={subRef} />
        {hold != null && (
          <span className="tgt-escort-hold" title="Stay alongside to save a flight memory">
            <i style={{ width: `${Math.round(hold * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="tgt-escort-actions">
        <button
          type="button"
          aria-pressed={cinema}
          tabIndex={active ? 0 : -1}
          onClick={() => toggleEscortCamera(runtime)}
          aria-label={cinema ? 'Back to the chase camera' : 'Cinematic camera'}
          title={cinema ? 'Chase camera (C)' : 'Cinematic camera (C)'}
        >
          {cinema ? <Video size={16} aria-hidden="true" /> : <Clapperboard size={16} aria-hidden="true" />}
          <span>{cinema ? 'Chase cam' : 'Cinema'}</span>
          {!isTouch && <kbd className="tgt-kbd">C</kbd>}
        </button>
        <button
          type="button"
          tabIndex={active ? 0 : -1}
          onClick={() => releaseEscort(runtime)}
          aria-label="Release the escort"
          title="Release (F)"
        >
          <X size={16} aria-hidden="true" />
          <span>Release</span>
          {!isTouch && <kbd className="tgt-kbd">F</kbd>}
        </button>
      </span>
    </div>
  );
}

/** Cinematic letterbox: two bars that slide in whenever the cinema camera flies. */
export function CinemaBars() {
  const on = useFlyStore((s) => s.cameraMode === 'cinema');
  return <div className="tgt-bars" data-on={on ? '1' : '0'} aria-hidden="true" />;
}

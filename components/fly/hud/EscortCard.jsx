'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Camera, Clapperboard, Video, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { releaseEscort, toggleEscortCamera } from '@/lib/fly/escort';
import { MPS_TO_KT } from '@/lib/fly/coords';
import { ENCOUNTER_LIMITS } from '@/lib/fly/encounters.mjs';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { AIRCRAFT_SILHOUETTES, getBestSilhouette } from '@/lib/aircraft-silhouettes';
import { zoneClass } from '../LayoutRoot';
import './target-ui.css';
import './play-encounters.css';

/**
 * PLAY PASS — ENCOUNTERS (ENCOUNTER_FEEL; FLY_PLAY_PASS.md F4): the ONE escort
 * card. The review found three surfaces saying "you are escorting N410CK" at
 * once — the escort pill (top), the lock card ("Escorting", bottom left) and
 * the Nearby mission card ("Crossing paths", right) — none of them showing the
 * thing that matters, how close the flight memory is.
 *
 * This card takes the lock card's slot (the info-dock zone's own classes, so
 * the HUD layout places it) for the whole escort: the aircraft (photo with its
 * planespotters credit, or the class silhouette), what it is and where it is
 * going, what the autopilot is doing, the 30 s memory as a bar that fills,
 * and the three things you can do — Photo (P), Cinema / Chase cam (C),
 * Release (F). The lock card and the mission card stand down while it is up;
 * during the payoff beat it steps aside for the lower third.
 *
 * Contract kept from the pill: testid `hud-chase-chip`, opacity 1 while an
 * escort is up and hidden otherwise, and INTERCEPT / FORMATION / CINEMA in its
 * text (verify-inspect-actions, verify-chase-cam). The live line is written
 * through a ref at 4 Hz, never per frame.
 */
export function EscortCard({ runtime }) {
  const lockState = useFlyStore((s) => s.lockState);
  const cameraMode = useFlyStore((s) => s.cameraMode);
  const lockedHex = useFlyStore((s) => s.lockedHex);
  const encounter = useEncounterStore((s) => s.active);
  const { isTouch } = useDeviceLayout();
  const active = lockState === 'intercepting' || lockState === 'formation';
  const cinema = cameraMode === 'cinema';
  const phase = lockState === 'formation' ? 'FORMATION' : 'INTERCEPT';
  const mode = cinema ? 'cinema' : lockState === 'formation' ? 'formation' : 'intercept';
  const hex = active ? lockedHex : null;
  const meta = hex ? (runtime.traffic?.tracks.get(hex)?.meta ?? null) : null;

  const liveRef = useRef(null);
  const sample = useRef(null);
  useEffect(() => {
    sample.current = null;
    if (!active) return undefined;
    const tick = () => {
      const t = runtime.targeting?.target;
      if (!t) return;
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
      const alt = Number.isFinite(t.ry) ? ` · ${Math.round((t.ry * 3.28084) / 100) * 100} ft` : '';
      const text = `${dist} · ${words}${alt}`;
      if (liveRef.current && liveRef.current.textContent !== text) liveRef.current.textContent = text;
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active, runtime, lockState]);

  // Identity: the shared React Query caches the lock card and the dossier use.
  const shim = useMemo(() => {
    if (!hex || !meta) return null;
    const t = runtime.traffic?.tracks.get(hex);
    const geo = t && runtime.engine ? runtime.engine.worldToGeo({ x: t.rx, y: t.ry, z: t.rz }) : null;
    return { hex, flight: meta.flight, r: meta.r, t: meta.t, category: meta.category, lat: geo?.y, lon: geo?.x };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex, meta]);
  const { route } = useRoute(shim);
  const { data: photo } = useAircraftPhoto(isTouch ? null : hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;

  const title = meta?.flight?.trim() || meta?.r || hex?.toUpperCase() || '';
  const typeName = meta ? getAircraftTypeName(meta.t, meta.category) : null;
  const who = [typeName || meta?.t, route?.airline?.name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  const leg =
    route?.origin || route?.destination
      ? `${route.origin?.iata || route.origin?.icao || '···'} → ${route.destination?.iata || route.destination?.icao || '···'}`
      : null;
  const silhouette = meta
    ? (AIRCRAFT_SILHOUETTES[getBestSilhouette({ t: meta.t }, meta.iconType || 'airliner')] ?? AIRCRAFT_SILHOUETTES.unknown)
    : AIRCRAFT_SILHOUETTES.unknown;

  // The memory: the active crossing with THIS aircraft (Nearby, an invitation,
  // or an escort adopted from the dossier or the lock card).
  const memory = active && encounter?.kind === 'traffic' && encounter.hex === lockedHex;
  const seconds = memory ? Math.min(ENCOUNTER_LIMITS.holdSec, encounter.seconds || 0) : 0;
  const held = memory ? seconds / ENCOUNTER_LIMITS.holdSec : 0;
  const waiting = memory && encounter.stale;

  return (
    <div className={`${zoneClass('info-dock')} tgt-ec-wrap`} data-letterbox={cinema ? '1' : '0'}>
      <div
        className="tgt tgt-ec"
        data-testid="hud-chase-chip"
        data-overlay="escort"
        data-active={active ? '1' : '0'}
        data-mode={mode}
        data-memory={memory ? '1' : '0'}
        aria-hidden={!active}
        role="status"
        style={{ '--hero': meta?.color || '#4fe3ff' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="tgt-ec-thumb" aria-hidden={!photoSrc}>
          {photoSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc} alt={title} />
              {photo?.photographer && (
                // planespotters requires the credit and link wherever the photo shows.
                <a
                  href={photo.link || 'https://www.planespotters.net'}
                  target="_blank"
                  rel="noreferrer"
                  className="tgt-ec-credit"
                  title={`Photo ${photo.photographer} · planespotters.net`}
                >
                  📷 {photo.photographer}
                </a>
              )}
            </>
          ) : (
            <svg viewBox={silhouette.viewBox} aria-hidden="true">
              {silhouette.paths.map((p, i) => (
                <path key={i} d={p.d} fill="currentColor" />
              ))}
            </svg>
          )}
        </div>
        <div className="tgt-ec-body">
          <div className="tgt-ec-kicker">
            <i aria-hidden="true" />
            <span>{phase}</span>
            {cinema && <b>CINEMA</b>}
            {memory && (
              <em className="tgt-ec-secs">
                {seconds}/{ENCOUNTER_LIMITS.holdSec} s
              </em>
            )}
          </div>
          <div className="tgt-ec-name" title={title}>
            {title}
          </div>
          {(who || leg) && <div className="tgt-ec-sub">{[who, leg].filter(Boolean).join(' · ')}</div>}
          <div className="tgt-ec-live" ref={liveRef} />
        </div>
        <div className="tgt-ec-actions">
          <button
            type="button"
            tabIndex={active ? 0 : -1}
            onClick={() => runtime.input?.press?.('p')}
            aria-label="Photo mode"
            title="Photo (P)"
          >
            <Camera size={16} aria-hidden="true" />
            <span>Photo</span>
            {!isTouch && <kbd className="tgt-kbd">P</kbd>}
          </button>
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
        </div>
        {memory && (
          <div className="tgt-ec-memory" title="Stay alongside to save a flight memory">
            <span>
              {waiting
                ? 'Waiting for a fresh position'
                : held >= 1
                  ? 'Flight memory saved'
                  : `Flight memory · ${seconds} / ${ENCOUNTER_LIMITS.holdSec} s`}
            </span>
            <span className="tgt-ec-bar" aria-hidden="true">
              <i style={{ width: `${Math.round(held * 100)}%` }} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

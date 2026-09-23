'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Compass, Info, MapPin, Moon, Play, PlaneTakeoff, Settings, Sun, Sunrise, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { FRONT_DOOR } from '@/lib/fly/fly-constants';
import { ATTRIBUTIONS_BY_STYLE } from '@/lib/fly/tile-sources';
import { OPERATIONS_AIRPORTS } from '@/lib/fly/operations-airports';
import { CITIES } from '@/lib/fly/poi';
import { FEATURED_DESTINATIONS, describeSetup, readLastSetup } from '@/lib/fly/flight-plan';
import { enterHangarFromTitle, freeFlightAvailable } from '@/lib/fly/front-door';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { computeSun } from '@/lib/fly/sun-model';
import { SettingsRows } from './SettingsRows';
import { CreditsPanel } from './CreditsPanel';
import './title.css';

const DEG = Math.PI / 180;

function distKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dLat, dLon);
}

/**
 * Name + coarse UTC offset for the spot the title is orbiting. Featured
 * destination (B) → operations airport → nearest offline POI city. Hand-rolled
 * and offline, like the Atlas (no reverse geocoding, no API).
 */
function spotInfo(lat, lon) {
  for (const d of FEATURED_DESTINATIONS || []) {
    if (Number.isFinite(d?.lat) && distKm(lat, lon, d.lat, d.lon) < 25) {
      return { name: d.name, tz: Number.isFinite(d.tz) ? d.tz : null };
    }
  }
  for (const a of OPERATIONS_AIRPORTS) {
    const p = a.a;
    if (p && distKm(lat, lon, p.lat, p.lon) < 8) return { name: `${a.id} · ${a.name}`, tz: null };
  }
  let best = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = distKm(lat, lon, c[1], c[2]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) return { name: 'Somewhere on Earth', tz: null };
  return { name: bestD < 30 ? best[0] : `Near ${best[0]}`, tz: Number.isFinite(best[3]) ? best[3] : null };
}

function localClock(tz, lon) {
  const offH = Number.isFinite(tz) ? tz : Math.round(lon / 15);
  const d = new Date(Date.now() + offH * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function sunState(sun) {
  if (!sun || !Number.isFinite(sun.sinEl)) return null;
  const el = Math.asin(Math.max(-1, Math.min(1, sun.sinEl))) / DEG;
  if (el < -6) return { kind: 'night', label: 'Night' };
  if (el < 8) return { kind: 'golden', label: el < 0 ? 'Twilight' : 'Golden hour' };
  return { kind: 'day', label: 'Daylight' };
}

/** 1 Hz DOM poll of the orbit spot (runtime.geo + runtime.sun) — never per frame. */
function useSpotChip(runtime) {
  const [chip, setChip] = useState(null);
  const cache = useRef({ lat: null, lon: null, info: null });
  useEffect(() => {
    const tick = () => {
      const g = runtime.geo;
      const spawn = useFlyStore.getState().spawn;
      const lat = Number.isFinite(g?.y) ? g.y : spawn?.lat;
      const lon = Number.isFinite(g?.x) ? g.x : spawn?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const c = cache.current;
      if (c.info == null || distKm(lat, lon, c.lat, c.lon) > 1) {
        c.info = spotInfo(lat, lon);
        c.lat = lat;
        c.lon = lon;
      }
      // runtime.sun is satellite-only (toy has no live sun), so the chip asks
      // the same model directly — honouring the dev sun pin like the scene.
      const pin = typeof window !== 'undefined' ? window.__flySunOverride : undefined;
      const sun = runtime.sun ?? computeSun(lon, lat, Number.isFinite(pin) ? pin : undefined);
      const next = { name: c.info.name, time: localClock(c.info.tz, lon), sun: sunState(sun) };
      setChip((prev) =>
        prev && prev.name === next.name && prev.time === next.time && prev.sun?.kind === next.sun?.kind ? prev : next
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runtime]);
  return chip;
}

/** Title world revealed (`__flyBoot.pct === 100`), polled at 4 Hz until true. */
function useWorldReady() {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && window.__flyBoot?.pct === 100);
  useEffect(() => {
    if (ready) return undefined;
    const id = setInterval(() => {
      if (window.__flyBoot?.pct === 100) setReady(true);
    }, 250);
    return () => clearInterval(id);
  }, [ready]);
  return ready;
}

/**
 * R25 A FRONT DOOR — the title screen (plan ruling 1, "UX flow", "Title
 * layout"). DOM only, at z-45: above the BootScreen backdrop (z-40, which goes
 * compact under it) and below the hangar (z-60). Interactive immediately; the
 * live world orbits behind it (lib/fly/title-camera.js) and `data-ready` flips
 * when that world reveals. No new canvas element (67 harness sites
 * read `.fixed.inset-0 canvas`). Renders nothing unless screen === 'title'.
 */
export function TitleScreen({ runtime }) {
  const screen = useFlyStore((s) => s.screen);
  if (!FRONT_DOOR.enabled || screen !== 'title') return null;
  return <TitleBody runtime={runtime} />;
}

function TitleBody({ runtime }) {
  const settingsOpen = useFlyStore((s) => s.settingsOpen);
  const creditsOpen = useFlyStore((s) => s.creditsOpen);
  const logbookOpen = useFlyStore((s) => s.logbookOpen);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const { isPhone } = useDeviceLayout();
  const ready = useWorldReady();
  const chip = useSpotChip(runtime);
  // Read on mount = every time the title is shown (B writes it at launch).
  const [last] = useState(() => readLastSetup());
  const continueLabel = last ? describeSetup(last) : null;
  const free = freeFlightAvailable();
  const firstAction = useRef(null);
  const attributions = ATTRIBUTIONS_BY_STYLE[mapStyle] ?? ATTRIBUTIONS_BY_STYLE.satellite;

  useEffect(() => {
    firstAction.current?.focus({ preventScroll: true });
  }, []);

  // The explicit first-click audio unlock (plan): every title action resumes
  // the AudioContext; the capture-phase pointerdown covers clicks that land on
  // the title's chrome rather than a button.
  const unlock = () => runtime?.audio?.resume?.();
  const store = useFlyStore.getState;

  const onContinue = () => {
    unlock();
    if (typeof runtime?.launchSetup === 'function') runtime.launchSetup(last);
    else enterHangarFromTitle(last?.flightMode ?? last?.mode ?? 'ops', runtime);
  };

  const airports = OPERATIONS_AIRPORTS.map((a) => a.id).join(' · ');

  return (
    <div
      className="fly-title"
      data-testid="title-screen"
      data-overlay="title"
      data-ready={ready ? 'true' : 'false'}
      data-phone={isPhone ? '1' : undefined}
      hidden={logbookOpen}
      style={{ zIndex: FRONT_DOOR.titleZ }}
      onPointerDownCapture={unlock}
    >
      <div className="fly-title-scrim" aria-hidden="true" />

      <header className="fly-title-top">
        <div className="fly-title-brand">
          <h1 className="fly-title-wordmark">Skyloom</h1>
          <p className="fly-title-tagline">Fly the living Earth</p>
        </div>
        {chip && (
          <div className="fly-title-spot" data-testid="title-spot" data-sun={chip.sun?.kind ?? 'unknown'}>
            <MapPin size={14} aria-hidden="true" />
            <span className="fly-title-spot-name">{chip.name}</span>
            <span className="fly-title-spot-sep" aria-hidden="true" />
            <span className="fly-title-spot-time">{chip.time}</span>
            {chip.sun && (
              <span className="fly-title-spot-sun" title={chip.sun.label} aria-label={chip.sun.label}>
                {chip.sun.kind === 'night' ? <Moon size={14} /> : chip.sun.kind === 'golden' ? <Sunrise size={14} /> : <Sun size={14} />}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="fly-title-bottom">
        {last && (
          <button
            ref={firstAction}
            type="button"
            className="fly-title-continue"
            data-testid="title-continue"
            onClick={onContinue}
          >
            <Play size={18} aria-hidden="true" />
            <span className="fly-title-continue-label">Continue</span>
            {continueLabel && <span className="fly-title-continue-detail">{continueLabel}</span>}
          </button>
        )}

        <div className={`fly-title-cards${free ? '' : ' fly-title-cards-single'}`}>
          {free && (
            <button
              ref={last ? undefined : firstAction}
              type="button"
              className="fly-title-card"
              data-testid="title-free-flight"
              onClick={() => enterHangarFromTitle('free', runtime)}
            >
              <Compass className="fly-title-card-icon" size={26} aria-hidden="true" />
              <span className="fly-title-card-text">
                <strong>Free Flight</strong>
                <span>Start airborne over a famous place or any city on Earth.</span>
              </span>
            </button>
          )}
          <button
            ref={last || free ? undefined : firstAction}
            type="button"
            className="fly-title-card"
            data-testid="title-takeoff-landing"
            onClick={() => enterHangarFromTitle('ops', runtime)}
          >
            <PlaneTakeoff className="fly-title-card-icon" size={26} aria-hidden="true" />
            <span className="fly-title-card-text">
              <strong>Takeoff &amp; Landing</strong>
              <span>{airports}</span>
              <span className="fly-title-card-sub">Apron · Runway · Approach</span>
            </span>
          </button>
        </div>

        <nav className="fly-title-secondary" aria-label="More">
          <button type="button" data-testid="title-logbook" onClick={() => store().setLogbookOpen(true)}>
            <BookOpen size={16} aria-hidden="true" />
            <span>Logbook</span>
          </button>
          <button type="button" data-testid="title-settings" onClick={() => store().setSettingsOpen(true)}>
            <Settings size={16} aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button type="button" data-testid="title-credits" onClick={() => store().openCredits()}>
            <Info size={16} aria-hidden="true" />
            <span>Credits</span>
          </button>
        </nav>

        {/* Esri's terms: the imagery credit stays visible in every UI state —
            the title layer sits over the flight AttributionBar, so it carries
            its own copy. */}
        <div className="fly-title-attribution" data-testid="title-attribution">
          {attributions.map((a) => (
            <a key={a.label} href={a.href} target="_blank" rel="noopener noreferrer">
              {a.label}
            </a>
          ))}
        </div>
      </div>

      {settingsOpen && <SettingsSheet phone={isPhone} />}
      {creditsOpen && !settingsOpen && (
        <div className="fly-title-modal" onClick={(e) => e.target === e.currentTarget && store().closeCredits()}>
          <CreditsPanel onClose={() => store().closeCredits()} />
        </div>
      )}
    </div>
  );
}

function SettingsSheet({ phone }) {
  const close = () => useFlyStore.getState().setSettingsOpen(false);
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      className={`fly-title-modal${phone ? ' fly-title-modal-sheet' : ''}`}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <section
        className="fly-title-settings"
        data-testid="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fly-title-settings-h"
      >
        <header>
          <h2 id="fly-title-settings-h">Settings</h2>
          <button ref={closeRef} type="button" data-testid="settings-close" aria-label="Close settings" onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="fly-title-settings-rows">
          <SettingsRows sheet />
        </div>
      </section>
    </div>
  );
}

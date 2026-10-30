'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Compass, Info, MapPin, Moon, Play, PlaneTakeoff, Settings, Sun, Sunrise, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { OPERATIONS_AIRPORTS } from '@/lib/fly/operations-airports';
import { FRONT_DOOR } from '@/lib/fly/fly-constants';
import { attributionsFor } from '@/lib/fly/tile-sources';
import { CITIES } from '@/lib/fly/poi';
import { FEATURED_DESTINATIONS, describeSetup, readLastSetup } from '@/lib/fly/flight-plan';
import { enterHangarFromTitle, freeFlightAvailable } from '@/lib/fly/front-door';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { useDialogFocus } from '@/hooks/use-dialog-focus';
import { computeSun } from '@/lib/fly/sun-model';
import { SettingsRows } from './SettingsRows';
import { CreditsPanel } from './CreditsPanel';
import './title.css';
import { AirportEntry } from './AirportExperience';
import { useAdventureStore } from '@/stores/adventure-store';
import { adventureById } from '@/lib/fly/adventures.mjs';
// Living World: MENU_GLASS dresses the title's Settings and Credits;
// TITLE_MOTION the title itself. Flag off renders the markup below unchanged.
import { GLASS_ON, GLASS_EXIT_MS, closingProps, glassRootProps, stillMotion, usePresence } from './LivingGlass';
import { livingWorldBlock, livingWorldOn } from '@/lib/fly/living-world';

const TITLE_ON = livingWorldOn('TITLE_MOTION');
const TITLE_BLOCK = livingWorldBlock('TITLE_MOTION') ?? {};
// The entrance hands over to the settled title after this long (so the
// Logbook's hide/show never replays it).
const ENTER_MS = Number.isFinite(TITLE_BLOCK.settleMs) ? TITLE_BLOCK.settleMs : 2600;
/** Title-motion class names: the flag-off name alone, or it plus the motion classes. */
const tm = (base, extra) => (TITLE_ON ? `${base} ${extra}` : base);

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
  const adventure = useAdventureStore(s=>s.progress.active);
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
  const rootRef = useRef(null);
  const attrRef = useRef(null);
  const trafficSource = useFlyStore((s) => s.trafficSource);
  const attributions = attributionsFor(mapStyle, trafficSource);
  // Living World (TITLE_MOTION): 'enter' plays the entrance once per showing;
  // 'still' (reduced motion) and 'done' are the settled title.
  const [motion, setMotion] = useState(() => (TITLE_ON ? (stillMotion() ? 'still' : 'enter') : undefined));
  useEffect(() => {
    if (motion !== 'enter') return undefined;
    const id = setTimeout(() => setMotion('done'), ENTER_MS);
    return () => clearTimeout(id);
  }, [motion]);

  useEffect(() => {
    firstAction.current?.focus({ preventScroll: true });
  }, []);

  // Esri's terms (AttributionBar): the credit stays visible in every UI state.
  // The Settings / Credits modal covers the title, so it stops ABOVE the
  // credit strip: --fly-title-attr-reserve = root bottom − credit top (+4 px),
  // written straight to the DOM (no React state; resize-driven only).
  useEffect(() => {
    const root = rootRef.current;
    const attr = attrRef.current;
    if (!root || !attr) return undefined;
    const apply = () => {
      const rr = root.getBoundingClientRect();
      const ar = attr.getBoundingClientRect();
      const reserve = ar.height > 0 ? Math.max(0, Math.ceil(rr.bottom - ar.top + 4)) : 0;
      root.style.setProperty('--fly-title-attr-reserve', `${reserve}px`);
    };
    apply();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    ro?.observe(root);
    ro?.observe(attr);
    return () => ro?.disconnect();
  }, []);

  // The explicit first-click audio unlock (plan): every title action resumes
  // the AudioContext; the capture-phase pointerdown covers clicks that land on
  // the title's chrome rather than a button.
  const unlock = () => runtime?.audio?.resume?.();
  const store = useFlyStore.getState;

  const onContinue = () => {
    unlock();
    if (adventure) { if (!runtime.adventures?.resume()) useAdventureStore.getState().setLibraryOpen(true); return; }
    if (typeof runtime?.launchSetup === 'function') runtime.launchSetup(last);
    else enterHangarFromTitle(last?.flightMode ?? last?.mode ?? 'ops', runtime);
  };

  const airports = 'Worldwide runway departures and arrivals';

  return (
    <div
      ref={rootRef}
      className={tm('fly-title', 'lwt')}
      data-testid="title-screen"
      data-overlay="title"
      data-ready={ready ? 'true' : 'false'}
      data-phone={isPhone ? '1' : undefined}
      data-motion={motion}
      hidden={logbookOpen}
      style={{ zIndex: FRONT_DOOR.titleZ }}
      onPointerDownCapture={unlock}
    >
      <div className="fly-title-scrim" aria-hidden="true" />

      <header className="fly-title-top">
        <div className="fly-title-brand">
          {TITLE_ON ? <Wordmark /> : <h1 className="fly-title-wordmark">Skyloom</h1>}
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
        {(last || adventure) && (
          <button
            ref={firstAction}
            type="button"
            className={tm('fly-title-continue', 'lwt-continue')}
            data-testid="title-continue"
            onClick={onContinue}
          >
            {TITLE_ON ? (
              <span className="lwt-lamp" aria-hidden="true">
                <Play size={15} fill="currentColor" />
              </span>
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
            <span className="fly-title-continue-label">Continue</span>
            {(adventure || continueLabel) && <span className="fly-title-continue-detail">{adventure ? adventureById(adventure.id)?.name : continueLabel}</span>}
            {TITLE_ON && <span className="lwt-sheen" aria-hidden="true" />}
          </button>
        )}

        {TITLE_ON ? (
          <button
            ref={last || adventure ? undefined : firstAction}
            type="button"
            className="lwt-explore"
            data-testid="title-explore"
            data-primary={last || adventure ? undefined : ''}
            onClick={() => {
              unlock();
              enterHangarFromTitle('free', runtime);
            }}
          >
            <span className="lwt-explore-art" aria-hidden="true" />
            <span className="lwt-explore-text">
              <strong>Where will you fly?</strong>
              <span>Discover a city, wander a coastline, or head somewhere new.</span>
            </span>
            <span className="lwt-go" aria-hidden="true">
              <Play size={18} fill="currentColor" />
            </span>
          </button>
        ) : (
        <button ref={last||adventure?undefined:firstAction} type="button" className="fly-title-adventure" data-testid="title-explore" onClick={()=>{unlock();enterHangarFromTitle('free',runtime);}}><Compass size={28}/><span><strong>Where will you fly?</strong><span>Discover a city, wander a coastline, or head somewhere new.</span></span><Play size={22}/></button>
        )}
        <div className={`fly-title-cards${free ? '' : ' fly-title-cards-single'}`}>
          <AirportEntry className={tm('fly-title-card', 'lwt-card lwt-card-watch')} />
          {free && (
            <button
              type="button"
              className={tm('fly-title-card', 'lwt-card lwt-card-journeys')}
              data-testid="title-adventures"
              onClick={() => {unlock();useAdventureStore.getState().setLibraryOpen(true);}}
            >
              <Compass className="fly-title-card-icon" size={26} aria-hidden="true" />
              <span className="fly-title-card-text">
                <strong>Guided journeys</strong>
                <span>Six places to explore. Four discoveries in every journey.</span>
              </span>
            </button>
          )}
          <button
            type="button"
            className={tm('fly-title-card', 'lwt-card lwt-card-runway')}
            data-testid="title-takeoff-landing"
            onClick={() => enterHangarFromTitle('ops', runtime)}
          >
            <PlaneTakeoff className="fly-title-card-icon" size={26} aria-hidden="true" />
            <span className="fly-title-card-text">
              <strong>Takeoff &amp; Landing</strong>
              <span>{airports}</span>
              <span className="fly-title-card-sub">Choose your aircraft and runway</span>
            </span>
          </button>
        </div>

        <nav className="fly-title-secondary" aria-label="More">
          <button type="button" data-testid="title-logbook" onClick={() => store().setLogbookOpen(true)}>
            <BookOpen size={16} aria-hidden="true" />
            <span>Travel journal</span>
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
            its own copy; the title's modals stop above it (the reserve above),
            and under the title Logbook FlyMode mounts the flight bar. */}
        <div ref={attrRef} className="fly-title-attribution" data-testid="title-attribution">
          {attributions.map((a) => (
            <a key={a.label} href={a.href} target="_blank" rel="noopener noreferrer">
              {a.label}
            </a>
          ))}
        </div>
      </div>

      {!GLASS_ON && settingsOpen && <SettingsSheet phone={isPhone} />}
      {!GLASS_ON && creditsOpen && !settingsOpen && (
        <div className="fly-title-modal" onClick={(e) => e.target === e.currentTarget && store().closeCredits()}>
          <CreditsPanel onClose={() => store().closeCredits()} />
        </div>
      )}
      {GLASS_ON && <GlassSettingsSheet open={settingsOpen} phone={isPhone} />}
      {GLASS_ON && <GlassTitleCredits open={creditsOpen && !settingsOpen} />}
    </div>
  );
}

/*
 * Living World (TITLE_MOTION): the Skyloom wordmark. A contrail is the loom's
 * thread: it passes over the first o, under the second, over the m, and
 * climbs away with the aircraft at its head. The thread is two copies of one
 * path in the oo's own em space (1 unit = 0.01 em, Archivo Black metrics:
 * baseline 0.84 em, x-height 0.54 em, o advance 0.657 em): the one BEHIND the
 * letters shows only through the gaps and counters; the one IN FRONT is
 * clipped to the over-crossings and wears a dark halo so it reads as on top.
 */
const THREAD = 'M-120 63C-40 61 60 58 180 52C250 48.5 292 24 322-6';
const HEAD = 'M8 0L5-1L1-1.2L-2-7.6L-4-7.6L-2.6-1.2L-6.4-1L-8-3.6L-9.3-3.6L-8.4 0L-9.3 3.6L-8 3.6L-6.4 1L-2.6 1.2L-4 7.6L-2 7.6L1 1.2L5 1Z';
const THREAD_BOX = '-130 -30 470 120';

export function Wordmark() {
  return (
    <h1 className="fly-title-wordmark lwt-wordmark">
      <span className="lwt-wm-sky">Sky</span>
      <span className="lwt-wm-loom">
        l
        <span className="lwt-wm-oo">
          oo
          <svg className="lwt-thread lwt-thread-under" viewBox={THREAD_BOX} aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="lwt-thread-g" gradientUnits="userSpaceOnUse" x1="-120" y1="0" x2="322" y2="0">
                <stop offset="0" stopColor="#7fe7ff" stopOpacity="0" />
                <stop offset="0.3" stopColor="#7fe7ff" stopOpacity="0.9" />
                <stop offset="1" stopColor="#f2feff" />
              </linearGradient>
              <linearGradient id="lwt-thread-h" gradientUnits="userSpaceOnUse" x1="-120" y1="0" x2="322" y2="0">
                <stop offset="0" stopColor="#050a16" stopOpacity="0" />
                <stop offset="0.3" stopColor="#050a16" stopOpacity="0.62" />
                <stop offset="1" stopColor="#050a16" stopOpacity="0.62" />
              </linearGradient>
              <radialGradient id="lwt-thread-glow">
                <stop offset="0" stopColor="#7fe7ff" stopOpacity="0.55" />
                <stop offset="1" stopColor="#7fe7ff" stopOpacity="0" />
              </radialGradient>
              <clipPath id="lwt-thread-over">
                <rect x="-6" y="-30" width="72" height="120" />
                <rect x="131.5" y="-30" width="210" height="120" />
              </clipPath>
            </defs>
            <path className="lwt-t" d={THREAD} pathLength="100" stroke="url(#lwt-thread-g)" strokeWidth="4.4" fill="none" strokeLinecap="round" />
          </svg>
          <svg className="lwt-thread lwt-thread-over" viewBox={THREAD_BOX} aria-hidden="true" focusable="false">
            <g clipPath="url(#lwt-thread-over)">
              <path className="lwt-t" d={THREAD} pathLength="100" stroke="url(#lwt-thread-h)" strokeWidth="8.5" fill="none" strokeLinecap="round" />
              <path className="lwt-t" d={THREAD} pathLength="100" stroke="url(#lwt-thread-g)" strokeWidth="4.4" fill="none" strokeLinecap="round" />
            </g>
            <g className="lwt-head" transform="translate(322 -6) rotate(-45) scale(1.25)">
              <circle r="14" fill="url(#lwt-thread-glow)" />
              <path d={HEAD} fill="#f2feff" />
            </g>
          </svg>
        </span>
        m
      </span>
    </h1>
  );
}

/**
 * Living World (MENU_GLASS): Settings as a glass drawer from the right edge
 * (the title stays in view on the left), a bottom sheet on phones, with an
 * exit as purposeful as the entrance. Same testids, names and focus order.
 */
export function GlassSettingsSheet({ open, phone }) {
  const still = stillMotion();
  const p = usePresence(open, still ? 0 : GLASS_EXIT_MS);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, open);
  if (!p.mounted) return null;
  const close = () => useFlyStore.getState().setSettingsOpen(false);
  return (
    <div
      className={`fly-title-modal lg lg-modal lg-drawer-host${phone ? ' fly-title-modal-sheet' : ''}`}
      {...glassRootProps(still)}
      {...closingProps(p.closing)}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="lg-panel lg-drawer"
        data-testid="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fly-title-settings-h"
      >
        <header className="lg-drawer-head">
          <h2 id="fly-title-settings-h" className="lg-title">
            Settings
          </h2>
          <button ref={closeRef} type="button" className="lg-icon-btn" data-testid="settings-close" aria-label="Close settings" onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="lg-drawer-body lg-settings">
          <SettingsRows sheet />
        </div>
      </section>
    </div>
  );
}

/** Living World (MENU_GLASS): the title's Credits, entering and leaving. */
export function GlassTitleCredits({ open }) {
  const still = stillMotion();
  const p = usePresence(open, still ? 0 : GLASS_EXIT_MS);
  if (!p.mounted) return null;
  const close = () => useFlyStore.getState().closeCredits();
  return (
    <div
      className="fly-title-modal lg lg-modal lg-credits-host"
      {...glassRootProps(still)}
      {...closingProps(p.closing)}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <CreditsPanel onClose={close} />
    </div>
  );
}

export function SettingsSheet({ phone }) {
  const close = () => useFlyStore.getState().setSettingsOpen(false);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, true);
  return (
    <div
      className={`fly-title-modal${phone ? ' fly-title-modal-sheet' : ''}`}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
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

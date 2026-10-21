'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Binoculars,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  EyeOff,
  Globe2,
  Info,
  MapPin,
  Moon,
  Play,
  PlaneTakeoff,
  Settings,
  Sun,
  Sunrise,
} from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useAdventureStore } from '@/stores/adventure-store';
import { FRONT_DOOR } from '@/lib/fly/fly-constants';
import { attributionsFor } from '@/lib/fly/tile-sources';
import { CITIES } from '@/lib/fly/poi';
import { OPERATIONS_AIRPORTS, airportById } from '@/lib/fly/operations-airports';
import { airportLabel } from '@/lib/fly/ops-labels.mjs';
import { nearestFeatured, readLastSetup } from '@/lib/fly/flight-plan';
import { enterHangarFromTitle, freeFlightAvailable } from '@/lib/fly/front-door';
import { aircraftName, isAircraftId } from '@/lib/fly/player-aircraft';
import { adventureById } from '@/lib/fly/adventures.mjs';
import { livingAirportsOn } from '@/lib/fly/airport-feature-policy';
import { computeSun } from '@/lib/fly/sun-model';
import { loadCoastlines } from '@/lib/fly/atlas/coastlines';
import { FLEET_PRESENTATION } from '@/lib/fly/fleet-aircraft.mjs';
import {
  ROUTE_MAP,
  TOUR_POSTERS,
  coastPath,
  greatCircle,
  projectRoute,
  routePath,
  formatLatLon,
  lightPhrase,
  orbitHeadingDeg,
  passBarcode,
  passFlightNo,
  shadeWanted,
  tourIndexAt,
  tourMayAdvance,
  tourStep,
  tourStops,
  TITLE_TOUR,
} from '@/lib/fly/title-tour';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { CreditsPanel } from './CreditsPanel';
import { GLASS_ON, stillMotion } from './LivingGlass';
import { GlassSettingsSheet, GlassTitleCredits, SettingsSheet, Wordmark } from './TitleScreen';
import './title.css';
import './cinema-title.css';

/*
 * The cinema title — the window-seat title (owner-requested, 2026-10-21).
 *
 * The live world orbiting behind the title IS the view; this layer frames it
 * as a window with a dataview over it:
 *   - a heading tape driven by the title camera's orbit (one transform write
 *     per frame, never React), the coordinates, local time, light, altitude
 *     and the live traffic count (a 1 Hz DOM poll, as the old spot chip);
 *   - the place set large, with its region and the destination's own line;
 *   - a WORLD TOUR over the featured destinations: a window shade closes, the
 *     frozen title flight is staged to the next stop (runtime.stageDestination,
 *     the hangar's own pre-stream), and the shade lifts once that world reads
 *     ready — streaming happens behind the shade, never on screen. The same
 *     shade covers the boot and a hangar pick still streaming;
 *   - a boarding pass as the primary action (Continue, or Fly here), a
 *     numbered mode menu with arrow-key focus, and H to hide the interface.
 *
 * Every harness address of the old title is kept: title-screen (data-ready),
 * title-spot, title-continue, title-explore, title-adventures, watch-airport,
 * title-takeoff-landing, title-logbook, title-settings, title-credits,
 * title-attribution, settings-sheet. The attribution stays visible in every
 * state (Esri's terms), and the Settings / Credits sheets stop above it.
 */

const CFG = TITLE_TOUR;
const TOUR_CFG = CFG.tour ?? {};
const SHADE_CFG = CFG.shade ?? {};
const num = (v, d) => (Number.isFinite(v) ? v : d);
const DWELL_MS = num(TOUR_CFG.dwellSec, 48) * 1000;
const IDLE_MS = num(TOUR_CFG.idleSec, 5) * 1000;
const DOWN_MS = num(SHADE_CFG.downMs, 650);
const MIN_DOWN_MS = num(SHADE_CFG.minDownMs, 1100);
const CAP_MS = num(SHADE_CFG.capSec, 30) * 1000;
const LIFT_DELAY_MS = num(SHADE_CFG.liftDelayMs, 350);
const SOUND = CFG.sound !== false;

const DEG = Math.PI / 180;
const pad2 = (n) => String(n).padStart(2, '0');

// Page-lifetime memory: the entrance plays once per page load (exit to title
// returns to a settled title), and the tour keeps its auto setting.
let entrancePlayed = false;
let titleShown = false; // the page's first title showing carries the boot hero

/**
 * Automation (navigator.webdriver: the harness fleet) keeps the tour manual,
 * so no title gate's spot moves under it mid-measurement — the DEVICE_TIERS /
 * PLAYER_SURFACE automation rule. `window.__flyTitleTourAuto = true` opts a
 * harness back in.
 */
function tourAutoAllowed() {
  if (typeof navigator === 'undefined' || navigator.webdriver !== true) return true;
  return typeof window !== 'undefined' && window.__flyTitleTourAuto === true;
}

function km(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dLat, dLon);
}

/**
 * What the window is showing: a featured destination (its name, region and
 * line), an operations airport, or the nearest offline POI city. Offline and
 * keyless, like the Atlas.
 */
function placeAt(lat, lon) {
  const d = nearestFeatured(lat, lon, 25);
  if (d) return { key: d.id, destId: d.id, name: d.name, region: d.region, blurb: d.blurb, tz: Number.isFinite(d.tz) ? d.tz : null };
  for (const a of OPERATIONS_AIRPORTS) {
    const p = a.a;
    if (p && km(lat, lon, p.lat, p.lon) < 8) {
      const l = airportLabel(a);
      return { key: `airport:${a.id}`, destId: null, name: l?.name || a.name, region: `${l?.code || a.id} · Airfield`, blurb: null, tz: null };
    }
  }
  let best = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    const k = km(lat, lon, c[1], c[2]);
    if (k < bestD) {
      bestD = k;
      best = c;
    }
  }
  if (!best) return { key: 'earth', destId: null, name: 'Somewhere on Earth', region: null, blurb: null, tz: null };
  const near = bestD < 30;
  return {
    key: `city:${best[0]}`,
    destId: null,
    name: near ? best[0] : `Near ${best[0]}`,
    region: near ? null : `${Math.round(bestD)} km out`,
    blurb: null,
    tz: Number.isFinite(best[3]) ? best[3] : null,
  };
}

function clockAt(tz, lon) {
  const offH = Number.isFinite(tz) ? tz : Math.round(lon / 15);
  const d = new Date(Date.now() + offH * 3600 * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function skyWord(coverPct) {
  if (!Number.isFinite(coverPct)) return null;
  if (coverPct < 12) return 'Clear';
  if (coverPct < 40) return 'Few clouds';
  if (coverPct < 75) return 'Broken';
  return 'Overcast';
}

/** 1 Hz DOM poll of what the window is showing — never per frame. */
function useLiveView(runtime) {
  const [view, setView] = useState(null);
  const cache = useRef({ lat: null, lon: null, place: null });
  useEffect(() => {
    const tick = () => {
      const g = runtime?.geo;
      const spawn = useFlyStore.getState().spawn;
      const lat = Number.isFinite(g?.y) ? g.y : spawn?.lat;
      const lon = Number.isFinite(g?.x) ? g.x : spawn?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const c = cache.current;
      if (c.place == null || km(lat, lon, c.lat, c.lon) > 1) {
        c.place = placeAt(lat, lon);
        c.lat = lat;
        c.lon = lon;
      }
      // runtime.sun is satellite-only (toy has no live sun): ask the same model,
      // honouring the dev sun pin like the scene does.
      const pin = typeof window !== 'undefined' ? window.__flySunOverride : undefined;
      const sun = runtime?.sun ?? computeSun(lon, lat, Number.isFinite(pin) ? pin : undefined);
      const cam = runtime?.titleCam?.stats;
      const eyeY = cam?.eyeY;
      const wx = runtime?.weather?.wx;
      const tracks = runtime?.traffic?.tracks?.size;
      const next = {
        lat,
        lon,
        place: c.place,
        coords: formatLatLon(lat, lon),
        time: clockAt(c.place.tz, lon),
        light: lightPhrase(sun?.sinEl),
        altFt: Number.isFinite(eyeY) && eyeY > 0 ? Math.round((eyeY * 3.28084) / 100) * 100 : null,
        orbitKm: Number.isFinite(cam?.radiusM) && cam.radiusM > 0 ? (cam.radiusM / 1000).toFixed(1) : null,
        traffic: Number.isFinite(tracks) && tracks > 0 ? tracks : 0,
        tempC: wx?.found && Number.isFinite(wx.tempC) ? Math.round(wx.tempC) : null,
        sky: wx?.found ? skyWord(wx.coverPct) : null,
      };
      const sig = JSON.stringify([next.place.key, next.coords, next.time, next.light?.label, Math.round((next.light?.el ?? 0)), next.altFt, next.orbitKm, next.traffic, next.tempC, next.sky]);
      setView((prev) => (prev && prev.sig === sig ? prev : { ...next, sig }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runtime]);
  return view;
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

const FLAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Split-flap text: a change scrambles left to right before it settles (still under reduced motion). */
function FlapText({ text }) {
  const [scramble, setScramble] = useState(null); // the in-between glyphs, null when settled
  const prev = useRef(text);
  useEffect(() => {
    if (text === prev.current) return undefined;
    const from = prev.current;
    prev.current = text;
    // The first real value replaces the placeholder at once; later changes flap.
    if (from === '—' || stillMotion()) return undefined;
    let step = 0;
    const steps = 11;
    const id = setInterval(() => {
      step++;
      const k = Math.floor((step / steps) * text.length);
      if (step >= steps) {
        clearInterval(id);
        setScramble(null);
        return;
      }
      setScramble([...text].map((ch, i) => (i < k || ch === ' ' ? ch : FLAP[(Math.random() * FLAP.length) | 0])).join(''));
    }, 36);
    return () => {
      clearInterval(id);
      setScramble(null);
    };
  }, [text]);
  return <span className="tcn-flap">{scramble ?? text}</span>;
}

const TAPE_PX = 4; // pixels per degree
const TAPE_MARKS = (() => {
  const out = [];
  const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let v = -180; v <= 540; v += 5) {
    const h = ((v % 360) + 360) % 360;
    out.push({ x: (v + 180) * TAPE_PX, major: h % 15 === 0, label: card[h] ?? null });
  }
  return out;
})();

/** The heading tape: the title camera's compass heading, one transform write per frame. */
function HeadingTape({ runtime }) {
  const strip = useRef(null);
  const readout = useRef(null);
  useEffect(() => {
    let raf = 0;
    let last = null;
    let lastText = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const h = orbitHeadingDeg(runtime?.titleCam?.stats?.angleDeg);
      if (h == null) return;
      const r = Math.round(h * 20) / 20;
      if (r === last) return;
      last = r;
      if (strip.current) strip.current.style.transform = `translate3d(${(-(h + 180) * TAPE_PX).toFixed(1)}px,0,0)`;
      // The readout repaints only when its whole degree changes.
      const text = `${String(Math.round(h) % 360).padStart(3, '0')}°`;
      if (text !== lastText && readout.current) readout.current.textContent = lastText = text;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);
  const width = 720 * TAPE_PX;
  return (
    <div className="tcn-tape" aria-hidden="true">
      <div className="tcn-tape-window">
        <svg ref={strip} className="tcn-tape-strip" width={width} height="26" viewBox={`0 0 ${width} 26`}>
          {TAPE_MARKS.map((m) => (
            <g key={m.x}>
              <line x1={m.x} x2={m.x} y1={m.label ? 12 : m.major ? 15 : 18} y2="22" />
              {m.label && (
                <text x={m.x} y="8" textAnchor="middle" className={m.label.length === 1 ? 'tcn-tape-card' : undefined}>
                  {m.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <span className="tcn-tape-caret" />
      <span className="tcn-tape-read">
        HDG <b ref={readout}>---°</b>
      </span>
    </div>
  );
}

function Barcode({ seed }) {
  const bars = useMemo(() => passBarcode(seed, 64), [seed]);
  return (
    <svg className="tcn-barcode" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height="20" />
      ))}
    </svg>
  );
}

/** The pass's fields for a saved setup or an active journey. */
export function continueFields(last, adventure) {
  if (adventure) {
    const a = adventureById(adventure.id);
    return {
      label: 'Continue',
      sub: a?.name ?? 'Your journey',
      fields: [
        ['Mode', 'Journey'],
        ['Aircraft', isAircraftId(adventure.aircraftId) ? aircraftName(adventure.aircraftId) : 'Hangar'],
        ['To', a?.place ?? '—'],
      ],
      seed: `adv:${adventure.id}`,
      aircraftId: adventure.aircraftId,
    };
  }
  if (!last) return null;
  const who = aircraftName(last.aircraftId);
  if (last.flightMode === 'free') {
    return {
      label: 'Continue',
      sub: `Free flight over ${last.dest.name}`,
      fields: [
        ['Mode', 'Free flight'],
        ['Aircraft', who],
        ['To', last.dest.name],
      ],
      seed: `free:${last.dest.id}`,
      aircraftId: last.aircraftId,
    };
  }
  if (last.start === 'practice') {
    return { label: 'Continue', sub: 'Glider practice over Columbus', fields: [['Mode', 'Practice'], ['Aircraft', who], ['From', 'KOSU']], seed: 'ops:practice', aircraftId: last.aircraftId };
  }
  const l = airportLabel(airportById(last.airportId));
  const start = { apron: 'From the apron', runway: 'On the runway', approach: 'On approach', gate: 'From the gate' }[last.start] ?? 'Takeoff & landing';
  return {
    label: 'Continue',
    sub: `${start} · ${l?.name ?? last.airportId}`,
    fields: [
      ['Mode', last.start === 'approach' ? 'Landing' : 'Takeoff'],
      ['Aircraft', who],
      [last.start === 'approach' ? 'To' : 'From', l?.code ?? last.airportId],
    ],
    seed: `ops:${last.airportId}:${last.start}`,
    aircraftId: last.aircraftId,
  };
}

function savedAircraft() {
  try {
    const id = localStorage.getItem('fly-aircraft');
    return isAircraftId(id) ? id : 'fighter';
  } catch {
    return 'fighter';
  }
}

/** The boarding pass: the title's one lit action. */
function BoardingPass({ pass, testid, onClick, onFocusIn, innerRef, active }) {
  const art = aircraftArt(pass.aircraftId);
  return (
    <button
      ref={innerRef}
      type="button"
      className="tcn-pass"
      data-testid={testid}
      data-tcn-nav=""
      data-active={active ? '' : undefined}
      onClick={onClick}
      onFocus={onFocusIn}
      onPointerEnter={onFocusIn}
      aria-label={`${pass.label}: ${pass.sub}`}
    >
      <span className="tcn-pass-main">
        <span className="tcn-pass-top">
          <span>Boarding pass · {passFlightNo(pass.seed)}</span>
        </span>
        <span className="tcn-pass-head">
          <span className="tcn-pass-lamp" aria-hidden="true">
            <Play size={14} fill="currentColor" />
          </span>
          <span className="tcn-pass-label">{pass.label}</span>
          <span className="tcn-pass-sub">{pass.sub}</span>
        </span>
        <span className="tcn-pass-fields">
          {pass.fields.map(([k, v]) => (
            <span key={k}>
              <small>{k}</small>
              <b>{k === 'To' || k === 'From' ? <FlapText text={String(v)} /> : v}</b>
            </span>
          ))}
        </span>
      </span>
      <span className="tcn-pass-stub" aria-hidden="true">
        <span className="tcn-pass-seat">
          <small>Seat</small>
          <b>1A</b>
          <small>Window</small>
        </span>
        <Barcode seed={pass.seed} />
      </span>
      {art && <span className="tcn-pass-art" style={{ backgroundImage: `url(${art})` }} aria-hidden="true" />}
      <span className="tcn-pass-sheen" aria-hidden="true" />
    </button>
  );
}

/** The hangar's own render of an aircraft (the fleet rail's thumbnail), or null. */
function aircraftArt(id) {
  return FLEET_PRESENTATION[id]?.thumbnail || (id === 'fighter' ? '/models/player-vector-v4.svg' : null);
}

/** The window shade: frosted, with the place it is opening onto. Pointer-transparent. */
function Shade({ state, subject, kicker, pct, showProgress, hero }) {
  const poster = subject?.destId ? TOUR_POSTERS[subject.destId] : null;
  return (
    <div className="tcn-shade" data-state={state} aria-hidden={state === 'up' ? 'true' : undefined}>
      <div className="tcn-shade-panel">
        {poster && <div key={poster} className="tcn-shade-poster" style={{ backgroundImage: `url(${poster})` }} />}
        <div className="tcn-shade-tint" />
        {hero ? (
          // The boot: the line the game stands on, before the window opens.
          <div className="tcn-shade-lockup tcn-shade-hero" role={state === 'up' ? undefined : 'status'}>
            <p className="tcn-hero">
              <span className="tcn-hero-thin">Fly the</span>
              <span className="tcn-hero-heavy">Living Earth.</span>
            </p>
            <p className="tcn-shade-kicker">
              {kicker}
              {subject?.name ? ` · ${subject.name}` : ''}
            </p>
          </div>
        ) : (
          <div className="tcn-shade-lockup" role={state === 'up' ? undefined : 'status'}>
            <p className="tcn-shade-kicker">{kicker}</p>
            <p className="tcn-shade-name">{subject?.name ?? 'Skyloom'}</p>
            {subject?.region && <p className="tcn-shade-region">{subject.region}</p>}
          </div>
        )}
        {showProgress && (
          <div className="tcn-shade-progress" aria-hidden="true">
            <span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
            <small>Streaming the world · {Math.round(pct)}%</small>
          </div>
        )}
        <span className="tcn-shade-lip" aria-hidden="true">
          <i />
        </span>
      </div>
    </div>
  );
}

// The coastline path, built once per page from the Atlas's own data.
let coastCache = null;
function useCoastPath() {
  const [d, setD] = useState(coastCache);
  useEffect(() => {
    if (coastCache != null) return undefined;
    let live = true;
    loadCoastlines().then((lines) => {
      coastCache = coastPath(lines);
      if (live) setD(coastCache);
    });
    return () => {
      live = false;
    };
  }, []);
  return d;
}

const GRATICULE = (() => {
  const { w, h, latTop, latBottom } = ROUTE_MAP;
  let d = '';
  for (let lon = -150; lon < 180; lon += 30) d += `M${(((lon + 180) / 360) * w).toFixed(1)} 0V${h}`;
  for (let lat = 60; lat > latBottom; lat -= 30) d += `M0 ${(((latTop - lat) / (latTop - latBottom)) * h).toFixed(1)}H${w}`;
  return d;
})();

const PLANE = 'M6 0L-3 -3.6L-1.4 0L-3 3.6Z';

/**
 * The flight plan: the world (the Atlas coastlines), every stop, and the great
 * circle to the next one. During a hop the arc lights and a plane flies it
 * once (finite; still under reduced motion). A stop is a click away.
 */
function RouteMap({ stops, current, from, to, flying, still, onPick }) {
  const coast = useCoastPath();
  const fLat = from?.lat;
  const fLon = from?.lon;
  const tLat = to?.lat;
  const tLon = to?.lon;
  const arc = useMemo(
    () => (Number.isFinite(fLat) && Number.isFinite(tLat) && (fLat !== tLat || fLon !== tLon) ? routePath(greatCircle({ lat: fLat, lon: fLon }, { lat: tLat, lon: tLon }, 64)) : ''),
    [fLat, fLon, tLat, tLon]
  );
  const { w, h } = ROUTE_MAP;
  const label = (d, cls) => {
    if (!d) return null;
    const p = projectRoute(d.lat, d.lon);
    const right = p.x > w - 96;
    return (
      <text className={cls} x={right ? p.x - 7 : p.x + 7} y={Math.min(h - 4, Math.max(9, p.y + 3))} textAnchor={right ? 'end' : 'start'}>
        {d.name}
      </text>
    );
  };
  const fromStop = current >= 0 ? stops[current] : null;
  const pos = !fromStop && from ? projectRoute(from.lat, from.lon) : null;
  const close = fromStop && to && Math.hypot(projectRoute(fromStop.lat, fromStop.lon).x - projectRoute(to.lat, to.lon).x, projectRoute(fromStop.lat, fromStop.lon).y - projectRoute(to.lat, to.lon).y) < 60;
  return (
    <svg className="tcn-route" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label="Tour map" data-flying={flying ? '' : undefined}>
      <path className="tcn-route-grat" d={GRATICULE} />
      {coast && <path className="tcn-route-coast" d={coast} />}
      {arc && <path key={`${fLat},${fLon}>${tLat},${tLon}`} className="tcn-route-arc" d={arc} />}
      {stops.map((d, i) => {
        const p = projectRoute(d.lat, d.lon);
        return (
          <g
            key={d.id}
            className="tcn-route-stop"
            data-state={i === current ? 'here' : d === to ? 'next' : undefined}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            onClick={(e) => onPick(i, e)}
          >
            <title>{d.name}</title>
            <circle className="tcn-route-hit" r="8" />
            <circle className="tcn-route-dot" r="2.3" />
          </g>
        );
      })}
      {pos && <circle className="tcn-route-pos" cx={pos.x} cy={pos.y} r="3" />}
      {label(fromStop, 'tcn-route-label')}
      {!close && label(to, 'tcn-route-label tcn-route-label-next')}
      {flying && arc && !still && (
        <g key={`plane-${tLat},${tLon}`} className="tcn-route-plane">
          <path d={PLANE} />
          <animateMotion dur="2.6s" fill="freeze" rotate="auto" path={arc} calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.2 1" />
        </g>
      )}
    </svg>
  );
}

/**
 * The title (FlyMode mounts it; the classic TitleScreen is no longer mounted).
 * Renders nothing unless the front door is on and the screen is the title.
 */
export function CinemaTitle({ runtime }) {
  const screen = useFlyStore((s) => s.screen);
  if (!FRONT_DOOR.enabled || screen !== 'title') return null;
  return <CinemaBody runtime={runtime} />;
}

function CinemaBody({ runtime }) {
  const adventure = useAdventureStore((s) => s.progress.active);
  const libraryOpen = useAdventureStore((s) => s.libraryOpen);
  const settingsOpen = useFlyStore((s) => s.settingsOpen);
  const creditsOpen = useFlyStore((s) => s.creditsOpen);
  const logbookOpen = useFlyStore((s) => s.logbookOpen);
  const browserOpen = useFlyStore((s) => s.airportBrowserOpen);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const trafficSource = useFlyStore((s) => s.trafficSource);
  const { isPhone, orientation } = useDeviceLayout();
  const bootReady = useWorldReady();
  const view = useLiveView(runtime);
  const [last] = useState(() => readLastSetup()); // read on mount = every showing
  const free = freeFlightAvailable();
  const watch = livingAirportsOn();
  const attributions = attributionsFor(mapStyle, trafficSource);

  const rootRef = useRef(null);
  const attrRef = useRef(null);
  const passRef = useRef(null);
  const [firstShowing] = useState(() => {
    const first = !titleShown;
    titleShown = true;
    return first;
  });
  const [motion] = useState(() => {
    if (stillMotion()) return 'still';
    if (entrancePlayed) return 'done';
    entrancePlayed = true;
    return 'enter';
  });

  // --- audio: the first click unlocks; focus ticks and the confirm chime ----
  const unlock = () => runtime?.audio?.resume?.();
  const lastTick = useRef(0);
  const tick = useCallback(() => {
    if (!SOUND) return;
    const now = performance.now();
    if (now - lastTick.current < 70) return;
    lastTick.current = now;
    runtime?.audio?.uiFocus?.();
  }, [runtime]);
  const confirm = () => {
    unlock();
    if (SOUND) runtime?.audio?.uiConfirm?.();
  };

  // --- the menu: the pass, then the modes ----------------------------------
  const contPass = continueFields(last, adventure);
  const placeName = view?.place?.name ?? '—';
  const hereAircraft = savedAircraft();
  const herePass = {
    aircraftId: hereAircraft,
    label: 'Fly here',
    sub: view?.place?.region ? `Free flight · ${view.place.region}` : 'Free flight from this window',
    fields: [
      ['Mode', 'Free flight'],
      ['Aircraft', aircraftName(hereAircraft)],
      ['To', placeName],
    ],
    seed: `here:${view?.place?.key ?? 'earth'}`,
  };
  const pass = contPass ?? herePass;
  const flyHere = () => {
    confirm();
    enterHangarFromTitle('free', runtime);
  };
  const onContinue = () => {
    confirm();
    if (adventure) {
      if (!runtime.adventures?.resume()) useAdventureStore.getState().setLibraryOpen(true);
      return;
    }
    if (typeof runtime?.launchSetup === 'function') runtime.launchSetup(last);
    else enterHangarFromTitle(last?.flightMode ?? 'ops', runtime);
  };
  const modes = [
    { key: 'free', testid: 'title-explore', label: 'Free Flight', desc: 'Anywhere on Earth, in any aircraft.', Icon: Globe2, run: () => enterHangarFromTitle('free', runtime) },
    free && { key: 'journeys', testid: 'title-adventures', label: 'Guided Journeys', desc: 'Curated flights, four discoveries each.', Icon: Compass, run: () => useAdventureStore.getState().setLibraryOpen(true) },
    watch && { key: 'watch', testid: 'watch-airport', label: 'Watch an Airport', desc: 'A window seat on real arrivals.', Icon: Binoculars, tag: 'Live', run: () => useFlyStore.setState({ airportBrowserOpen: true }) },
    { key: 'ops', testid: 'title-takeoff-landing', label: 'Takeoff & Landing', desc: 'Real runways, gate to gate.', Icon: PlaneTakeoff, run: () => enterHangarFromTitle('ops', runtime) },
  ].filter(Boolean);
  const [active, setActive] = useState('pass');
  const activeRef = useRef('pass');
  const activate = (key) => {
    if (activeRef.current === key) return;
    activeRef.current = key;
    setActive(key);
    tick();
  };

  useEffect(() => {
    passRef.current?.focus({ preventScroll: true });
  }, []);

  // --- the tour + the shade ---------------------------------------------------
  const reduced = motion === 'still';
  const stops = useMemo(() => {
    const pin = typeof window !== 'undefined' ? window.__flySunOverride : undefined;
    // The dev sun pin, like the scene; unpinned, tourStops reads the clock itself.
    return tourStops({ style: mapStyle, now: Number.isFinite(pin) ? pin : undefined, minSunDeg: num(TOUR_CFG.minNightSunDeg, -4) });
  }, [mapStyle]);
  const auto = !reduced && tourAutoAllowed() && (isPhone ? TOUR_CFG.autoPhone === true : TOUR_CFG.autoDesktop !== false);
  const here = view ? tourIndexAt(stops, view.lat, view.lon) : -1;
  const [hop, setHop] = useState(null); // the stop the shade is opening onto
  const [hopFrom, setHopFrom] = useState(null); // where that hop left from (the route map's arc)
  // Mounted over a ready world with nothing streaming: open from the first frame.
  const [shade, setShade] = useState(() => (bootReady && !shadeWanted({ bootReady, staging: runtime?.staging, now: -Infinity, capMs: CAP_MS }) ? 'up' : 'down'));
  const [stagePct, setStagePct] = useState(0);
  const [shownKey, setShownKey] = useState(0);
  const [uiHidden, setUiHidden] = useState(false);
  const covered = settingsOpen || creditsOpen || logbookOpen || browserOpen || libraryOpen;
  const live = useRef({});
  useEffect(() => {
    live.current = { auto, covered, here, stops, bootReady, pos: view ? { lat: view.lat, lon: view.lon } : null };
  });
  const hopRef = useRef(null);
  const shadeRef = useRef(shade);
  const shownMs = useRef(0); // time at this stop with the shade up and nothing over the title
  const lastInput = useRef(0);
  const bootAt = useRef(bootReady ? -Infinity : null);
  const markInput = (e) => {
    lastInput.current = e.timeStamp;
  };

  const hopTo = useCallback(
    (dest) => {
      if (!dest || hopRef.current || typeof runtime?.stageDestination !== 'function') return false;
      hopRef.current = { dest, closedAt: performance.now(), staged: false };
      const L = live.current;
      setHopFrom(L.here >= 0 ? L.stops[L.here] : L.pos);
      setHop(dest);
      setStagePct(0);
      shadeRef.current = 'down';
      setShade('down');
      return true;
    },
    [runtime]
  );
  const pickStop = (i, e) => {
    markInput(e);
    const L = live.current;
    if (i !== L.here && hopTo(L.stops[i])) tick();
  };
  const step = (dir, e) => {
    markInput(e);
    const L = live.current;
    const from = hopRef.current ? L.stops.indexOf(hopRef.current.dest) : L.here;
    const to = tourStep(L.stops.length, from, dir);
    if (to >= 0 && hopTo(L.stops[to])) tick();
  };

  useEffect(() => {
    let lastPoll = performance.now();
    lastInput.current = lastPoll;
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1000, now - lastPoll);
      lastPoll = now;
      const L = live.current;
      if (L.bootReady && bootAt.current == null) bootAt.current = now;
      const h = hopRef.current;
      if (h) {
        if (!h.staged && now - h.closedAt >= DOWN_MS) {
          h.staged = true;
          if (!runtime?.stageDestination?.(h.dest)) {
            hopRef.current = null;
            setHop(null);
          }
        }
        const s = runtime?.staging;
        if (h.staged && hopRef.current) {
          const mine = s && s.key === h.dest.id;
          setStagePct(mine ? Math.round((s.progress || 0) * 100) : 100);
          const done = !mine || s.ready || now - s.since >= CAP_MS;
          if (done && now - h.closedAt >= MIN_DOWN_MS) {
            hopRef.current = null;
            setHop(null);
          }
        }
      }
      const bootHold = !L.bootReady || now - bootAt.current < LIFT_DELAY_MS;
      const want = !!hopRef.current || bootHold || shadeWanted({ bootReady: true, staging: runtime?.staging, now, capMs: CAP_MS });
      const next = want ? 'down' : 'up';
      if (next !== shadeRef.current) {
        shadeRef.current = next;
        setShade(next);
        if (next === 'up') {
          shownMs.current = 0;
          setShownKey((k) => k + 1);
        }
      }
      const tabHidden = typeof document !== 'undefined' && document.hidden;
      if (!want && !L.covered && !tabHidden) shownMs.current += dt;
      if (!hopRef.current && !want) {
        const ok = tourMayAdvance({
          auto: L.auto,
          covered: L.covered,
          hidden: tabHidden,
          bootReady: L.bootReady,
          busy: false,
          dwellMs: DWELL_MS,
          shownMs: shownMs.current,
          idleMs: now - lastInput.current,
          idleNeedMs: IDLE_MS,
        });
        if (ok && L.stops.length > 1) {
          const to = tourStep(L.stops.length, L.here, 1);
          if (to >= 0) hopTo(L.stops[to]);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [runtime, hopTo]);

  // --- the credit strip reserve (the sheets stop above it) ------------------
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

  // --- keyboard: ↑↓ menu focus, ← → places, H hides the interface ------------
  const hideUi = () => {
    setUiHidden(true);
    rootRef.current?.focus({ preventScroll: true });
  };
  const showUi = () => {
    setUiHidden(false);
    requestAnimationFrame(() => passRef.current?.focus({ preventScroll: true }));
  };
  const onKeyDown = (e) => {
    markInput(e);
    if (covered || e.altKey || e.ctrlKey || e.metaKey) return;
    if (uiHidden) {
      e.preventDefault();
      e.stopPropagation();
      showUi();
      return;
    }
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      const items = [...(rootRef.current?.querySelectorAll('[data-tcn-nav]') ?? [])];
      if (!items.length) return;
      // From the highlighted row (a hover moves the highlight too), else the focus.
      const lit = items.findIndex((el) => el.hasAttribute('data-active'));
      const at = lit >= 0 ? lit : items.indexOf(document.activeElement);
      const next = items[(at < 0 ? 0 : at + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next.focus({ preventScroll: true });
      e.preventDefault();
      e.stopPropagation();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      step(k === 'ArrowLeft' ? -1 : 1, e);
      e.preventDefault();
      e.stopPropagation();
    } else if ((k === 'h' || k === 'H') && !e.repeat) {
      hideUi();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const place = view?.place;
  const shadeSubject = hop ? { name: hop.name, region: hop.region, destId: hop.id } : place;
  const kicker = hop ? 'Next stop' : !bootReady ? 'Preparing your window' : 'Arriving';
  const index = hop ? stops.indexOf(hop) : here;
  const leftOff = !!contPass && !!place && !hop && contPass.seed === `free:${place.destId}`;
  const placeKicker = index >= 0 ? (leftOff ? 'Where you left off' : 'Now showing') : 'Live view';
  const nextStop = stops[tourStep(stops.length, here, 1)];
  const len = (place?.name ?? '').length;
  const LightIcon = view?.light?.kind === 'night' ? Moon : view?.light?.kind === 'golden' ? Sunrise : Sun;
  const navProps = (key) => ({
    'data-tcn-nav': '',
    'data-active': active === key ? '' : undefined,
    onFocus: () => activate(key),
    onPointerEnter: () => activate(key),
  });

  return (
    <div
      ref={rootRef}
      className="tcn"
      data-testid="title-screen"
      data-overlay="title"
      data-ready={bootReady ? 'true' : 'false'}
      data-phone={isPhone ? '1' : undefined}
      data-orient={orientation}
      data-motion={motion}
      data-shade={shade}
      data-ui={uiHidden ? 'hidden' : 'shown'}
      hidden={logbookOpen}
      tabIndex={-1}
      style={{ zIndex: FRONT_DOOR.titleZ, '--tcn-dwell': `${DWELL_MS}ms` }}
      onPointerDownCapture={(e) => {
        unlock();
        markInput(e);
      }}
      onPointerDown={(e) => {
        if (uiHidden) {
          e.preventDefault();
          showUi();
        }
      }}
      onPointerMove={markInput}
      onKeyDown={onKeyDown}
    >
      <Shade state={shade} subject={shadeSubject} kicker={kicker} pct={stagePct} showProgress={!!hop && bootReady} hero={!hop && firstShowing && shownKey === 0} />
      <div className="tcn-scrim" aria-hidden="true" />
      <div className="tcn-frame" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="tcn-reticle" aria-hidden="true">
        <span className="tcn-reticle-ring" />
        {view && (
          <span className="tcn-reticle-tag">
            <b>{view.coords}</b>
            {view.orbitKm && <span>Orbit {view.orbitKm} km</span>}
          </span>
        )}
      </div>

      <header className="tcn-top tcn-ui">
        <div className="tcn-brand lwt" data-motion={motion === 'enter' ? 'enter' : 'done'}>
          <Wordmark />
          <p className="tcn-tagline">Fly the living Earth</p>
        </div>
        <HeadingTape runtime={runtime} />
        <div className="tcn-status">
          {view?.traffic > 0 && (
            <span className="tcn-live" title="Real aircraft, live ADS-B">
              <i aria-hidden="true" />
              Live · {view.traffic.toLocaleString('en-US')} aircraft
            </span>
          )}
          {view && (
            <div className="fly-title-spot tcn-spot" data-testid="title-spot" data-sun={view.light?.kind ?? 'unknown'}>
              <MapPin size={13} aria-hidden="true" />
              <span className="fly-title-spot-name">{place.name}</span>
              <span className="fly-title-spot-sep" aria-hidden="true" />
              <span className="fly-title-spot-time">{view.time}</span>
              {view.light && (
                <span className="fly-title-spot-sun" title={view.light.label} aria-label={view.light.label}>
                  <LightIcon size={13} />
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <p className="tcn-claims tcn-ui">
        <span>Real places.</span>
        <span>Real weather.</span>
        <span>Real traffic.</span>
      </p>

      <section className="tcn-place tcn-ui" aria-label="Now showing">
        {place && (
          <div key={place.key} className="tcn-place-in">
            <p className="tcn-kicker">
              <span className="tcn-no">№ {index >= 0 ? `${pad2(index + 1)} / ${pad2(stops.length)}` : '—'}</span>
              <i aria-hidden="true" />
              <span>{placeKicker}</span>
            </p>
            <h2 className="tcn-name" data-len={len > 14 ? 'long' : len > 10 ? 'mid' : undefined}>
              {place.name}
            </h2>
            <p className="tcn-region">
              {place.region && <span>{place.region}</span>}
              <span className="tcn-coords">{view.coords}</span>
            </p>
            {place.blurb && <p className="tcn-blurb">{place.blurb}</p>}
            <dl className="tcn-data">
              <div>
                <dt>Local</dt>
                <dd>{view.time}</dd>
              </div>
              {view.light && (
                <div>
                  <dt>Light</dt>
                  <dd>
                    {view.light.label}
                    <small>{Math.round(view.light.el)}°</small>
                  </dd>
                </div>
              )}
              {view.altFt != null && (
                <div>
                  <dt>Altitude</dt>
                  <dd>
                    {view.altFt.toLocaleString('en-US')}
                    <small>ft</small>
                  </dd>
                </div>
              )}
              {(view.tempC != null || view.sky) && (
                <div>
                  <dt>Air</dt>
                  <dd>{[view.tempC != null ? `${view.tempC}°C` : null, view.sky].filter(Boolean).join(' · ')}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </section>

      <div className="tcn-deck tcn-ui">
        <BoardingPass
          pass={pass}
          testid={contPass ? 'title-continue' : 'title-fly-here'}
          innerRef={passRef}
          active={active === 'pass'}
          onFocusIn={() => activate('pass')}
          onClick={contPass ? onContinue : flyHere}
        />
        <nav className="tcn-menu" aria-label="Ways to fly">
          {modes.map((m, i) => (
            <button
              key={m.key}
              type="button"
              className="tcn-row"
              data-testid={m.testid}
              {...navProps(m.key)}
              onClick={() => {
                confirm();
                m.run();
              }}
            >
              <span className="tcn-row-no" aria-hidden="true">
                {pad2(i + 1)}
              </span>
              <span className="tcn-row-text">
                <strong>{m.label}</strong>
                <span>{m.desc}</span>
              </span>
              {m.tag && (
                <span className="tcn-row-tag" aria-hidden="true">
                  <i />
                  {m.tag}
                </span>
              )}
              <ArrowUpRight className="tcn-row-go" size={18} aria-hidden="true" />
            </button>
          ))}
        </nav>
      </div>

      <aside className="tcn-tour tcn-ui" aria-label="World tour" data-auto={auto ? '' : undefined}>
        <div className="tcn-tour-head">
          <span>World tour</span>
          <span className="tcn-tour-next">
            {hop ? (
              <>
                Flying to <b>{hop.name}</b>
              </>
            ) : nextStop && auto ? (
              <>
                Next <b>{nextStop.name}</b>
              </>
            ) : (
              <>← → to travel</>
            )}
          </span>
        </div>
        <RouteMap
          stops={stops}
          current={hop ? stops.indexOf(hopFrom) : here}
          from={hop ? hopFrom : here >= 0 ? stops[here] : view ? { lat: view.lat, lon: view.lon } : null}
          to={hop ?? nextStop}
          flying={!!hop}
          still={reduced}
          onPick={pickStop}
        />
        <div className="tcn-tour-rail">
          <button type="button" className="tcn-tour-btn" data-testid="title-tour-prev" aria-label="Previous place" onClick={(e) => step(-1, e)}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="tcn-dots" aria-hidden="true">
            {stops.map((d, i) => (
              <span key={d.id} data-on={i === index ? '' : undefined}>
                {i === index && !hop && shade === 'up' && auto && <i key={shownKey} data-run={!covered ? '' : undefined} />}
              </span>
            ))}
          </span>
          <button type="button" className="tcn-tour-btn" data-testid="title-tour-next" aria-label="Next place" onClick={(e) => step(1, e)}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          {contPass && (
            <button type="button" className="tcn-tour-fly" data-testid="title-fly-here" onClick={flyHere}>
              Fly here
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </aside>

      <footer className="tcn-foot">
        <nav className="tcn-secondary tcn-ui" aria-label="More">
          <button type="button" data-testid="title-logbook" onClick={() => useFlyStore.getState().setLogbookOpen(true)}>
            <BookOpen size={15} aria-hidden="true" />
            <span>Travel journal</span>
          </button>
          <button type="button" data-testid="title-settings" onClick={() => useFlyStore.getState().setSettingsOpen(true)}>
            <Settings size={15} aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button type="button" data-testid="title-credits" onClick={() => useFlyStore.getState().openCredits()}>
            <Info size={15} aria-hidden="true" />
            <span>Credits</span>
          </button>
          <button type="button" data-testid="title-hide-ui" onClick={hideUi} aria-label="Hide the interface and watch">
            <EyeOff size={15} aria-hidden="true" />
            <span>Watch</span>
          </button>
        </nav>
        <p className="tcn-keys tcn-ui" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            Choose
          </span>
          <span>
            <kbd>Enter</kbd>
            Select
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd>
            Places
          </span>
          <span>
            <kbd>H</kbd>
            Watch
          </span>
        </p>
        {/* Esri's terms: the imagery credit stays visible in every state —
            the hidden interface included — and the sheets stop above it. */}
        <div ref={attrRef} className="fly-title-attribution tcn-attr" data-testid="title-attribution">
          {attributions.map((a) => (
            <a key={a.label} href={a.href} target="_blank" rel="noopener noreferrer">
              {a.label}
            </a>
          ))}
        </div>
      </footer>

      {uiHidden && (
        <p className="tcn-watch-hint" role="status">
          {isPhone ? 'Tap anywhere to return' : 'Press any key to return'}
        </p>
      )}

      {!GLASS_ON && settingsOpen && <SettingsSheet phone={isPhone} />}
      {!GLASS_ON && creditsOpen && !settingsOpen && (
        <div className="fly-title-modal" onClick={(e) => e.target === e.currentTarget && useFlyStore.getState().closeCredits()}>
          <CreditsPanel onClose={() => useFlyStore.getState().closeCredits()} />
        </div>
      )}
      {GLASS_ON && <GlassSettingsSheet open={settingsOpen} phone={isPhone} />}
      {GLASS_ON && <GlassTitleCredits open={creditsOpen && !settingsOpen} />}
    </div>
  );
}

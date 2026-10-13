'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Binoculars, Clock3, Moon, PlaneLanding, PlaneTakeoff, Search, Sun, Sunrise, Sunset, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { livingAirportsOn } from '@/lib/fly/airport-feature-policy';
import { FLAGSHIP_AIRPORTS } from '@/lib/fly/airport-observation.mjs';
import { runwayIndex, searchRunways } from '@/lib/fly/runway-catalog';
import { airportEligible } from '@/lib/fly/operations-airports';
import { goldenHourNow, localClockAt, majorAirports, shortAirportName, sunStateAt } from '@/lib/fly/airport-watch-sky.mjs';
import { AIRPORTS } from '@/lib/airports';
import { CITIES } from '@/lib/fly/poi/cities';
import { LoungeHud } from './lounge/LoungeHud';
import './target-ui.css';
import './airport-watch.css';

/*
 * Airport observation: the "Watch an airport" entry (title screen card and
 * Atlas pill), the airport browser (featured lounges with their local time
 * and sun, the live "Golden hour now" list, search) and the seated lounge
 * HUD (./lounge/LoungeHud.jsx). Desktop only — livingAirportsOn() is false
 * on phones by policy.
 *
 * Test ids — kept: watch-airport, airport-observation. Browser: airport-browser,
 * airport-featured-<id>, golden-hour-list, golden-hour-<ident>,
 * airport-result-<id>. Lounge: lounge-surface, lounge-marks, binocular-mask,
 * lounge-header, lounge-feed-status, lounge-clock, lounge-weather,
 * lounge-airports, lounge-leave, lounge-board, lounge-board-tab-<list>,
 * lounge-board-row-<hex>, lounge-face-runway, lounge-binoculars,
 * lounge-follow, spotter-card (+ -reg, -route, -telemetry, -phase, -notice,
 * -photo-credit and the actions -binoculars, -follow, -details, -join,
 * -photo), binocular-view, binocular-readout, binocular-mag.
 */

const sunNow = () => (typeof window !== 'undefined' && Number.isFinite(window.__flySunOverride) ? window.__flySunOverride : Date.now());

/** The entry: a full card on the title screen, a compact pill in the Atlas header. */
export function AirportEntry({ className = '' }) {
  if (!livingAirportsOn()) return null;
  const open = () => useFlyStore.setState({ airportBrowserOpen: true });
  if (className.includes('fly-title-card')) {
    return (
      <button type="button" className={className} onClick={open} data-testid="watch-airport">
        <Binoculars className="fly-title-card-icon" size={26} aria-hidden="true" />
        <span className="fly-title-card-text">
          <strong>Watch an airport</strong>
          <span>Take a window seat and watch real flights land, taxi and take off.</span>
          <span className="fly-title-card-sub">Live traffic · any airport</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className={`tgt lounge-entry ${className}`} onClick={open} data-testid="watch-airport">
      <Binoculars size={15} aria-hidden="true" />
      <span>Watch an airport</span>
    </button>
  );
}

export function AirportExperience({ runtime }) {
  const open = useFlyStore((s) => s.airportBrowserOpen);
  const watch = useFlyStore((s) => s.airportWatch);
  const back = useFlyStore((s) => s.airportReturn);
  const [notice, setNotice] = useState('');
  if (!livingAirportsOn()) return null;
  return (
    <>
      {back && !watch && (
        <button
          type="button"
          className="tgt airport-return"
          data-overlay="airport-return"
          onClick={() => {
            setNotice('');
            runtime.airportWatch?.enter(back.id).catch((e) => setNotice(e.message));
          }}
        >
          ← Return to the lounge
        </button>
      )}
      {watch && <LoungeHud runtime={runtime} watch={watch} />}
      {open && <AirportBrowser runtime={runtime} />}
      {!watch && notice && (
        <p className="tgt airport-return-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

// The golden-hour pool: busy hubs (lib/airports.js) that the runway catalog
// can open, then every other large airport — those serving a known city
// (lib/fly/poi/cities.js, within 35 km) ahead of remote fields, since a
// sunset is better with traffic in it. Built once per session.
let goldenPool = null;
function servesCity(a, grid) {
  for (let la = Math.floor(a.lat) - 1; la <= Math.floor(a.lat) + 1; la++) {
    for (let lo = Math.floor(a.lon) - 1; lo <= Math.floor(a.lon) + 1; lo++) {
      for (const c of grid.get(`${la}|${lo}`) || []) {
        const dy = (c[1] - a.lat) * 111.32, dx = (c[2] - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
        if (dx * dx + dy * dy < 35 * 35) return true;
      }
    }
  }
  return false;
}
async function goldenAirports() {
  if (goldenPool) return goldenPool;
  const major = majorAirports(await runwayIndex());
  const byIdent = new Map(major.map((a) => [a.ident, a]));
  const hubs = Object.values(AIRPORTS)
    .filter((h) => byIdent.has(h.icao))
    .map((h) => ({ ...byIdent.get(h.icao), name: h.name, city: h.city, priority: 3 }));
  const hubIds = new Set(hubs.map((h) => h.ident));
  const grid = new Map();
  for (const c of CITIES) {
    const key = `${Math.floor(c[1])}|${Math.floor(c[2])}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(c);
  }
  const rest = major.filter((a) => !hubIds.has(a.ident)).map((a) => (servesCity(a, grid) ? { ...a, priority: 1.5 } : a));
  goldenPool = [...hubs, ...rest];
  return goldenPool;
}

function SunChip({ sun }) {
  if (!sun) return null;
  const Icon = sun.kind === 'night' ? Moon : sun.kind === 'day' ? Sun : sun.rising ? Sunrise : Sunset;
  return (
    <span className="ab-sun" data-sun={sun.kind}>
      <Icon size={12} aria-hidden="true" />
      {sun.label}
    </span>
  );
}

function AirportBrowser({ runtime }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [golden, setGolden] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef(null);
  // Request generation: a newer choice (or closing) retires an older one.
  const generation = useRef(0);
  const close = () => {
    generation.current++;
    runtime.airportWatch?.cancelPending();
    useFlyStore.setState({ airportBrowserOpen: false });
  };
  useEffect(() => {
    const previous = document.activeElement;
    const requests = generation;
    ref.current?.querySelector('input')?.focus();
    return () => {
      requests.current++;
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      searchRunways(query, runtime.geo ? { lat: runtime.geo.y, lon: runtime.geo.x } : null)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, runtime]);
  // Live clocks and the golden-hour list refresh every 30 s while open.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setNow(Date.now());
      goldenAirports()
        .then((pool) => {
          if (!cancelled) setGolden(goldenHourNow(pool, sunNow(), { limit: 6 }));
        })
        .catch(() => {
          if (!cancelled) setGolden([]);
        });
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function choose(id, start = null) {
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      if (!runtime.airportWatch) throw Error('The world is still loading. Try again in a moment.');
      if (start) {
        const { ensureAirport } = await import('@/lib/fly/runway-catalog');
        const a = await ensureAirport(id);
        if (token !== generation.current) return;
        const aircraftId = useFlyStore.getState().aircraftId;
        if (!airportEligible(a, aircraftId) || !runtime.launchSetup({ flightMode: 'ops', aircraftId, airportId: a.id, start }))
          throw Error('This aircraft cannot use this runway. Choose another aircraft in the hangar.');
        runtime.airportWatch.leave();
        close();
      } else await runtime.airportWatch.enter(id);
    } catch (e) {
      if (token === generation.current) setError(e.message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  return (
    <div
      className="airport-browser-backdrop"
      data-overlay="airport-browser"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
        if (e.key === 'Tab') {
          const nodes = [...ref.current.querySelectorAll('button:not(:disabled),input,a[href]')];
          const first = nodes[0], last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
          } else if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }}
    >
      <section className="tgt airport-browser" ref={ref} role="dialog" aria-modal="true" aria-labelledby="airport-browser-title" data-testid="airport-browser">
        <header className="ab-head">
          <div>
            <small className="ab-kicker">
              <i aria-hidden="true" />
              Live aviation · worldwide
            </small>
            <h1 id="airport-browser-title">Watch an airport</h1>
            <p>Take a window seat over a real runway. Watch live flights land, taxi and depart, follow one through binoculars, or join it in the air.</p>
          </div>
          <button type="button" className="tgt-iconbtn" onClick={close} aria-label="Close airport search">
            <X size={18} />
          </button>
        </header>

        <label className="ab-search" htmlFor="airport-search">
          <Search size={17} aria-hidden="true" />
          <span className="ab-sr">Airport name or code</span>
          <input id="airport-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search an airport — Columbus, JFK, Heathrow, LOWI…" autoComplete="off" spellCheck={false} />
        </label>

        {!query && (
          <>
            <h2 className="ab-section">Featured lounges</h2>
            <div className="ab-featured">
              {FLAGSHIP_AIRPORTS.map((a) => {
                const clock = localClockAt(a.lat, a.lon, now);
                const sun = sunStateAt(a.lat, a.lon, sunNow());
                return (
                  <button type="button" key={a.id} disabled={busy} onClick={() => choose(a.id)} data-testid={`airport-featured-${a.id}`} data-sun={sun.kind}>
                    <small>{a.id}</small>
                    <strong>{a.name}</strong>
                    <span>{a.tag}</span>
                    <span className="ab-meta">
                      <Clock3 size={12} aria-hidden="true" />
                      {clock.text}
                      <SunChip sun={sun} />
                    </span>
                  </button>
                );
              })}
            </div>

            <h2 className="ab-section">
              <Sunset size={15} aria-hidden="true" />
              Golden hour now
              <small>The sun is low at these airports right now — real light, live traffic.</small>
            </h2>
            <div className="ab-golden" data-testid="golden-hour-list">
              {golden == null && <p className="ab-empty">Reading the sun around the world…</p>}
              {golden?.length === 0 && <p className="ab-empty">No large airport is in golden light this minute. Check back shortly.</p>}
              {golden?.map((g) => (
                <button type="button" key={g.ident} disabled={busy} onClick={() => choose(g.ident)} data-testid={`golden-hour-${g.ident}`} data-rising={g.rising ? '1' : '0'}>
                  {g.rising ? <Sunrise size={18} aria-hidden="true" /> : <Sunset size={18} aria-hidden="true" />}
                  <span className="ab-golden-text">
                    <strong title={g.name}>{shortAirportName(g.name)}</strong>
                    <small>
                      {g.ident} · {g.clock.text} {g.clock.zone === 'solar' ? 'solar' : 'local'}
                    </small>
                  </span>
                  <em>{g.label}</em>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </>
        )}

        {query && (
          <div className="ab-results">
            {results.map((a) => (
              <div key={a.id} className="ab-result" data-testid={`airport-result-${a.id}`}>
                <button type="button" className="ab-result-main" disabled={busy} onClick={() => choose(a.id)}>
                  <strong>{a.name}</strong>
                  <span>
                    {a.ident} · Runway {a.runway}
                  </span>
                </button>
                <button type="button" className="ab-watch" disabled={busy} onClick={() => choose(a.id)} aria-label={`Watch ${a.name}`}>
                  <Binoculars size={14} aria-hidden="true" />
                  Watch
                </button>
                <button type="button" className="ab-alt" disabled={busy} onClick={() => choose(a.id, 'runway')}>
                  <PlaneTakeoff size={14} aria-hidden="true" />
                  Runway start
                </button>
                <button type="button" className="ab-alt" disabled={busy} onClick={() => choose(a.id, 'approach')}>
                  <PlaneLanding size={14} aria-hidden="true" />
                  Approach
                </button>
              </div>
            ))}
            {!results.length && <p className="ab-empty">No airport matches “{query}”.</p>}
          </div>
        )}

        <p className="ab-note">Every airport has a window lounge and live regional traffic. Runway and approach starts are also available; detailed taxi routes are limited to the authored Ohio airports.</p>
        <p className="ab-status" role="status">
          {error || (busy ? 'Preparing the airport…' : '')}
        </p>
      </section>
    </div>
  );
}

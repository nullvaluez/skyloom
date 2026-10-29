'use client';
import { useEffect, useRef, useState } from 'react';
import { Binoculars, Search, Sunset, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { livingAirportsOn } from '@/lib/fly/airport-feature-policy';
import { FLAGSHIP_AIRPORTS } from '@/lib/fly/airport-observation.mjs';
import { LOUNGE_AIRPORTS, LOUNGE_REGIONS, searchLoungeAirports } from '@/lib/fly/lounge-airports.mjs';
import { searchLoungeCatalog } from '@/lib/fly/lounge-catalog';
import { goldenHourNow } from '@/lib/fly/airport-watch-sky.mjs';
import { FeaturedAirportCard, GoldenHourRow, goldenAirports, sunNow } from './airports/browser-parts';
import { LoungeAirportRow } from './airports/LoungeAirportRow';
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
 *
 * The browser's rows, sun chip and golden-hour pool live in
 * ./airports/browser-parts.jsx (shared with the hangar's airport chooser).
 */

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

function AirportBrowser({ runtime }) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [visible, setVisible] = useState(12);
  const [search, setSearch] = useState({ query: '', rows: [], error: '' });
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [golden, setGolden] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef(null);
  // Request generation: a newer choice (or closing) retires an older one.
  const generation = useRef(0);
  const term = query.trim();
  const searching = !!term && search.query !== term;
  // Curated destinations work immediately, including while the worldwide
  // catalog is loading or unavailable. The network only adds other airports.
  const results = term
    ? search.query === term ? search.rows : searchLoungeAirports(LOUNGE_AIRPORTS, term)
    : searchLoungeAirports(LOUNGE_AIRPORTS, '', { region });
  const searchError = term && search.query === term ? search.error : '';
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
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchLoungeCatalog(term)
        .then((rows) => {
          if (!cancelled) setSearch({ query: term, rows, error: '' });
        })
        .catch((e) => {
          if (!cancelled) setSearch({ query: term, rows: searchLoungeAirports(LOUNGE_AIRPORTS, term), error: e.message });
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, retry]);
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

  async function choose(id) {
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      if (!runtime.airportWatch) throw Error('The world is still loading. Try again in a moment.');
      await runtime.airportWatch.enter(id);
    } catch (e) {
      if (token === generation.current) {
        setError(e.message);
        ref.current?.scrollTo({ top: 0 });
      }
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
          <span className="ab-sr">Airport, city, country, ICAO or IATA code</span>
          <input id="airport-search" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(12); setError(''); }} placeholder="Airport, city or code — Tokyo, LHR, Dubai…" autoComplete="off" spellCheck={false} aria-controls="lounge-airport-results" />
        </label>

        {(error || busy) && <p className="ab-status" role="status">{error || 'Preparing the airport…'}</p>}

        {!term && (
          <>
            <h2 className="ab-section">Featured lounges</h2>
            <div className="ab-featured">
              {FLAGSHIP_AIRPORTS.map((a) => (
                <FeaturedAirportCard key={a.id} airport={a} now={now} busy={busy} onChoose={choose} />
              ))}
            </div>

          </>
        )}

        <h2 className="ab-section" id="lounge-directory-title">
          {term ? 'Search results' : 'Explore the world'}
          <small aria-live="polite">{results.length} {results.length === 1 ? 'airport' : 'airports'}{searching ? ' · Searching worldwide…' : ''}</small>
        </h2>
        {!term && (
          <div className="ab-regions" role="group" aria-label="Browse lounge airports by region">
            {[{ id: 'all', label: 'All regions' }, ...LOUNGE_REGIONS].map((r) => (
              <button type="button" key={r.id} aria-pressed={region === r.id} onClick={() => { setRegion(r.id); setVisible(12); }}>
                {r.label}
              </button>
            ))}
          </div>
        )}
        <div className="ab-lounge-list" id="lounge-airport-results" aria-labelledby="lounge-directory-title" aria-busy={searching}>
          {results.slice(0, visible).map((a) => (
            <LoungeAirportRow key={a.ident} airport={a} busy={busy} onChoose={choose} />
          ))}
          {!results.length && !searching && !searchError && <p className="ab-empty">No airport matches “{term}”. Try its airport name or ICAO code.</p>}
          {!results.length && searching && <p className="ab-empty">Searching worldwide airports…</p>}
        </div>
        {visible < results.length && (
          <button type="button" className="ab-more" onClick={() => setVisible((n) => n + 24)} aria-controls="lounge-airport-results">
            Show more airports · {results.length - visible} more
          </button>
        )}
        {searchError && <p className="ab-catalog-error" role="status">The worldwide catalog could not load. You can still search the destination directory. <button type="button" onClick={() => { setSearch({ query: '', rows: [], error: '' }); setRetry((n) => n + 1); }}>Retry search</button></p>}

        {!term && (
          <>
            <h2 className="ab-section">
              <Sunset size={15} aria-hidden="true" />
              Golden hour now
              <small>The sun is low at these airports right now — real light, live traffic.</small>
            </h2>
            <div className="ab-golden" data-testid="golden-hour-list">
              {golden == null && <p className="ab-empty">Reading the sun around the world…</p>}
              {golden?.length === 0 && <p className="ab-empty">No large airport is in golden light this minute. Check back shortly.</p>}
              {golden?.map((g) => (
                <GoldenHourRow key={g.ident} entry={g} busy={busy} onChoose={choose} />
              ))}
            </div>
          </>
        )}

        <p className="ab-note">Browse {LOUNGE_AIRPORTS.length} destinations or search the worldwide airport catalog. Take a lounge seat at any airport with runway data; live traffic depends on local coverage.</p>
      </section>
    </div>
  );
}

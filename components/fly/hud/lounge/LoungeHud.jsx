'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Binoculars, Camera, Crosshair, ListOrdered, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { exitToTitle } from '@/lib/fly/front-door';
import { localClockAt, sunStateAt } from '@/lib/fly/airport-watch-sky.mjs';
import { LoungeOverlay } from './LoungeOverlay';
import { LoungeSurface } from './LoungeSurface';
import { LoungeHeader, weatherSummary } from './LoungeHeader';
import { LiveBoard } from './LiveBoard';
import { SpotterCard } from './SpotterCard';
import { BinocularHud } from './BinocularHud';

/*
 * The seated lounge HUD. One 1 Hz poll feeds the header, the board and the
 * overlay's category labels; the spotter card and the binocular readouts
 * poll their own small slices; the overlay draws per GL frame. The section
 * carries data-overlay so the flight world never hears its clicks, and
 * stops non-Escape keys typed inside it from reaching the flight input.
 */

const EMPTY_BOARD = { arrivals: [], departures: [], ground: [], overhead: [], local: [], at: 0 };
const BOARD_PREF = 'fly-lounge-board-open';

function readBoardPref() {
  try {
    return localStorage.getItem(BOARD_PREF) !== '0';
  } catch {
    return true;
  }
}

function runwayLabel(airport) {
  if (!airport) return null;
  return airport.runway && airport.reciprocal ? `${airport.runway}/${airport.reciprocal}` : null;
}

export function LoungeHud({ runtime, watch }) {
  const sound = useFlyStore((s) => s.soundOn);
  const inspecting = useFlyStore((s) => !!s.inspectHex);
  // A full-screen panel over the lounge (Atlas, logbook, airport browser):
  // the board and the spotter card step aside so the two never interleave.
  const covered = useFlyStore((s) => s.atlasOpen || s.logbookOpen || s.airportBrowserOpen);
  const picker = useMemo(() => ({ hits: [], hover: null, pointer: { x: 0, y: 0, over: false, dragging: false }, categories: new Map(), surface: null }), []);
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [feed, setFeed] = useState({ state: 'unavailable', count: 0 });
  const [conditions, setConditions] = useState({ clock: null, sun: null, weather: null });
  const [tab, setTab] = useState('arrivals');
  const [boardOpen, setBoardOpen] = useState(readBoardPref);
  const [notice, setNotice] = useState('');
  const [savingPhoto, setSavingPhoto] = useState(false);
  const autoTab = useRef(true);
  const noticeTimer = useRef(null);
  const airport = runtime.airportWatch?.airport;

  const flash = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    if (message) noticeTimer.current = setTimeout(() => setNotice(''), 4200);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    autoTab.current = true;
    setNotice('');
  }, [watch.id]);

  // 1 Hz: board, feed state, local clock, sun and weather at the field.
  useEffect(() => {
    const tick = () => {
      const w = runtime.airportWatch;
      if (!w?.active) return;
      const b = w.board();
      setBoard(b);
      const cats = picker.categories;
      cats.clear();
      for (const list of [b.arrivals, b.departures, b.ground, b.overhead, b.local]) for (const row of list) cats.set(row.hex, row);
      const count = b.arrivals.length + b.departures.length + b.ground.length + b.overhead.length + b.local.length;
      setFeed({ state: runtime.trafficStatus?.state || 'unavailable', count });
      if (autoTab.current && count) {
        autoTab.current = false;
        setTab((t) => (b[t]?.length ? t : ['arrivals', 'departures', 'ground'].find((n) => b[n].length) || 'overhead'));
      }
      const a = w.airport?.a;
      const now = typeof window !== 'undefined' && Number.isFinite(window.__flySunOverride) ? window.__flySunOverride : Date.now();
      setConditions({
        // The clock and the sun read one instant: the harness sun pin when
        // set (review captures), the real clock otherwise.
        clock: a ? localClockAt(a.lat, a.lon, now) : null,
        sun: a ? sunStateAt(a.lat, a.lon, now) : null,
        weather: weatherSummary(runtime.weather?.data),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runtime, picker, watch.id]);

  const photo = useCallback(async () => {
    if (savingPhoto) return;
    setSavingPhoto(true);
    flash('Saving photograph…');
    try {
      const capture = getRuntimeAction('capturePhoto');
      if (!capture) throw Error('The camera is not ready.');
      const { blob, filename } = await capture();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      flash('Photograph saved.');
    } catch (e) {
      flash(e.message);
    } finally {
      setSavingPhoto(false);
    }
  }, [savingPhoto, flash]);

  const leave = () => {
    runtime.airportWatch?.leave();
    exitToTitle(runtime);
  };
  const w = runtime.airportWatch;
  const selectedRow = watch.selected ? picker.categories.get(watch.selected) : null;
  const fieldElev = airport ? (airport.a.elevation + airport.b.elevation) / 2 : 0;
  const status = notice || watch.notice || (!watch.validated ? 'Preparing your window seat…' : '');

  return (
    <section
      className="tgt airport-watch lounge"
      aria-label="Airport lounge"
      data-overlay="airport-observation"
      data-testid="airport-observation"
      data-binocular={watch.binocular ? '1' : '0'}
      onKeyDown={(e) => {
        // Keyboard isolation: keys typed inside the lounge never steer.
        if (e.key !== 'Escape') e.stopPropagation();
      }}
    >
      <LoungeSurface runtime={runtime} picker={picker} onNotice={flash} />
      <LoungeOverlay runtime={runtime} picker={picker} />

      <LoungeHeader
        code={airport?.ident || watch.id}
        name={airport?.name}
        runway={runwayLabel(airport)}
        feed={feed.state}
        count={feed.count}
        clock={conditions.clock}
        sun={conditions.sun}
        weather={conditions.weather}
        onAirports={() => useFlyStore.setState({ airportBrowserOpen: true })}
        onLeave={leave}
      />

      {!watch.binocular && !inspecting && !covered && (
        <LiveBoard
          board={board}
          tab={tab}
          onTab={(t) => {
            autoTab.current = false;
            setTab(t);
          }}
          open={boardOpen}
          onToggle={() => {
            const next = !boardOpen;
            setBoardOpen(next);
            try {
              localStorage.setItem(BOARD_PREF, next ? '1' : '0');
            } catch {
              // a remembered panel state is a convenience, nothing more
            }
          }}
          selected={watch.selected}
          onSelect={(hex) => w?.select(hex)}
          onBinoculars={(hex) => w?.select(hex, { binoculars: true })}
          feed={feed.state === 'live' && !feed.count ? 'quiet' : feed.state}
        />
      )}

      <AnimatePresence>
        {watch.selected && !watch.binocular && !covered && (
          <SpotterCard key={watch.selected} runtime={runtime} hex={watch.selected} boardRow={selectedRow} fieldElev={fieldElev} airportIdent={airport?.ident || String(airport?.id || '').split(':')[0]} onPhoto={photo} savingPhoto={savingPhoto} />
        )}
      </AnimatePresence>

      <AnimatePresence>{watch.binocular && <BinocularHud key="bino" runtime={runtime} />}</AnimatePresence>

      {!watch.binocular && (
        <footer className="lounge-bar lounge-panel" aria-label="Lounge controls">
          <button type="button" className="lounge-btn" aria-pressed={boardOpen} onClick={() => setBoardOpen((v) => !v)} title="Live board">
            <ListOrdered size={16} aria-hidden="true" />
            <span>Board</span>
          </button>
          <button type="button" className="lounge-btn" data-testid="lounge-face-runway" onClick={() => w?.resetLook()} title="Face the runway (R)">
            <RotateCcw size={16} aria-hidden="true" />
            <span>Face the runway</span>
          </button>
          <button type="button" className="lounge-btn lounge-btn-primary" data-testid="lounge-binoculars" aria-pressed={!!watch.binocular} onClick={() => w?.binoculars()} title="Binoculars (B)">
            <Binoculars size={16} aria-hidden="true" />
            <span>Binoculars</span>
            <span className="tgt-kbd">B</span>
          </button>
          <button type="button" className="lounge-btn" data-testid="lounge-follow" aria-pressed={!!watch.tracking} disabled={!watch.selected} onClick={() => w?.track()} title="Follow the selected aircraft (F)">
            <Crosshair size={16} aria-hidden="true" />
            <span>{watch.tracking ? 'Following' : 'Follow'}</span>
          </button>
          <button type="button" className="lounge-btn" disabled={savingPhoto || !watch.validated} aria-busy={savingPhoto} onClick={photo}>
            <Camera size={16} aria-hidden="true" />
            <span>Photo</span>
          </button>
          <button type="button" className="lounge-btn lounge-btn-icon" onClick={() => useFlyStore.getState().setSoundOn(!sound)} aria-label={sound ? 'Mute sound' : 'Enable sound'} title={sound ? 'Mute' : 'Sound on'}>
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        </footer>
      )}
      {!watch.binocular && (
        <p className="lounge-help" aria-hidden="true">
          Drag to look <span>·</span> Scroll to zoom <span>·</span> Click a plane to select <span>·</span> Double-click for binoculars
        </p>
      )}

      <AnimatePresence>
        {status && (
          // framer-motion owns `transform`, so the centring offset rides in x.
          <motion.p key={status} className="lounge-status airport-status" role="status" initial={{ opacity: 0, y: -6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }} transition={{ duration: 0.2 }}>
            {status}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}

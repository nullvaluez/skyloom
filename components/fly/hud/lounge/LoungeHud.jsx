'use client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Binoculars, Camera, Crosshair, ListOrdered, Map as MapIcon, Moon, RotateCcw, Sun, Volume2, VolumeX } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { exitToTitle } from '@/lib/fly/front-door';
import { leaveLabelFor } from '@/lib/fly/lounge-bridge';
import { localClockAt, sunStateAt } from '@/lib/fly/airport-watch-sky.mjs';
import { LoungeOverlay } from './LoungeOverlay';
import { LoungeSurface } from './LoungeSurface';
import { LoungeHeader, weatherSummary } from './LoungeHeader';
import { LiveBoard } from './LiveBoard';
import { SpotterCard } from './SpotterCard';
import { BinocularHud } from './BinocularHud';
// Gate to Gate W4 slots: walking and seats (LOUNGE_WALK) and the flight
// bridge (LOUNGE_BRIDGE) render here and nowhere else; each is null while
// its flag is off.
import { SeatsButton } from './SeatsButton';
import { SitPrompt } from './SitPrompt';
import { SeatMenu } from './SeatMenu';
import { LoungeBridgeBar } from './LoungeBridgeBar';
import { ObservatoryHud, useObservatory } from './ObservatoryHud';
// The pier room's décor prompt and card, and its floor-aware place label
// (LOUNGE_PIER; the second-level pass).
import { DecorCard, DecorPrompt, useWalkFeel } from './DecorCard';
import { decorTurn, pierPlace } from '@/lib/fly/lounge/lounge-life.mjs';
// Play Pass DIRECTOR (LOUNGE_DIRECTOR): the next-movement cue, the auto
// director and its lower thirds. Nothing of it renders while the flag is off.
import { playPassOn } from '@/lib/fly/play-pass';
import { DirectorCue, DirectorLower, useDirector } from './DirectorHud';
// LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md): the touch-only controls (the walk
// stick). The TOUCH stream owns the component; this file mounts it once.
import { LoungeTouchControls } from './LoungeTouchControls';
// LOUNGE MOBILE — GLASS: the phone HUD (header, dock, sheets, coach marks),
// Android Back, and the layout every lounge piece reads. A fine-pointer
// desktop takes none of it: `layout` is 'desktop' there and every branch
// below renders today's tree.
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { LoungeHeaderPhone } from './LoungeHeader';
import { BoardPeek, CoachMarks, LoungeMenuSheet, PhoneDock, peekMovement } from './PhoneLounge';
import { binoLayoutOf, loungeLayoutOf, useSafeInsets } from './lounge-layout';
import { useLoungeBack } from './use-lounge-back';
import { prefersReducedMotion } from '@/lib/fly/airport-watch-camera.mjs';
import './lounge-mobile.css';

const DIRECTOR_ON = playPassOn('LOUNGE_DIRECTOR');

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

/**
 * The help line. Seated with no walking it is today's line; with LOUNGE_WALK
 * it follows the posture.
 */
function helpHints(watch) {
  if (!watch.walk) return ['Drag to look', 'Scroll to zoom', 'Click a plane to select', 'Double-click for binoculars'];
  if (watch.posture === 'gliding') return ['Drag to look', 'V for seats'];
  if (watch.posture === 'standing') return ['WASD to walk', 'Shift to run', 'Drag to look', 'Click a chair to sit', 'V for seats'];
  return ['Drag to look', 'Scroll to zoom', 'Click a plane to select', 'WASD to get up', 'V for seats'];
}

export function LoungeHud({ runtime, watch }) {
  const observatory = useObservatory(runtime, watch.id);
  const instrumentOpen = !!observatory?.active;
  const feel = useWalkFeel(runtime, watch.id);
  const director = useDirector(runtime, watch.id, DIRECTOR_ON);
  // The auto director has the view: the board, the card and the bar step aside,
  // and a press or a wheel anywhere but its own controls takes the view back.
  const auto = DIRECTOR_ON && !!watch.auto;
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
  const [boardOpen, setBoardOpen] = useState(() => runtime.airportWatch?.observatory ? false : readBoardPref());
  const [notice, setNotice] = useState('');
  const [savingPhoto, setSavingPhoto] = useState(false);
  const autoTab = useRef(true);
  const noticeTimer = useRef(null);
  const airport = runtime.airportWatch?.airport;
  // LOUNGE MOBILE — GLASS: the layout ('desktop' renders today's HUD), the
  // binocular figure, the safe areas, and the phone's one bottom sheet of its
  // own ('board' | 'more'), remembered with the selection it opened over (a
  // new selection closes it, so the spotter sheet can come up).
  const device = useDeviceLayout();
  const layout = loungeLayoutOf(device);
  const mobile = layout !== 'desktop';
  const phone = layout === 'phone-portrait' || layout === 'phone-landscape';
  const binoLayout = binoLayoutOf(layout, device);
  const sectionRef = useRef(null);
  const safeRef = useRef(null);
  const insets = useSafeInsets(safeRef, mobile);
  const paused = useFlyStore((s) => s.phase === 'paused');
  // Reduced motion (FLY_LOUNGE_MOBILE.md rule 4: the game's own setting, else
  // the OS), read each render (the 1 Hz tick re-renders, so a change in
  // Settings lands within a second): data-reduced for the CSS, and
  // MotionConfig for the framer-motion springs and slides of the phone HUD.
  const reduced = mobile && prefersReducedMotion();
  const [sheetState, setSheetState] = useState(null);
  const [cardExpanded, setCardExpanded] = useState({ hex: null, open: false });

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

  // Leave goes back where the lounge was entered from (watch.exit(): the
  // title today).
  const leave = () => {
    const live = runtime.airportWatch;
    if (live?.exit) live.exit();
    else exitToTitle(runtime);
  };
  const w = runtime.airportWatch;
  // The seat you are in (LOUNGE_WALK), for the header and the face button.
  const seat = watch.walk ? w?.seats?.find((s) => s.id === watch.seat) ?? null : null;
  const pier = w?.site?.variant === 'pier';
  // Standing in the pier room, the header names the floor (or the stair) as
  // you climb; the classic room reads as it always has.
  const place = !watch.walk ? 'Window lounge' : watch.posture === 'seated' && seat ? seat.label : watch.posture === 'gliding' ? 'Changing seats' : pier ? pierPlace(feel.floorId ?? w?.walk?.floorId) : w?.walk?.floorId === 'upper' ? 'Upper lounge' : w?.walk?.floorId === 'stairs' ? 'Staircase' : 'Standing';
  const decorOpen = pier && watch.walk && watch.posture === 'standing' && feel.open && !watch.binocular && !watch.seatMenu && !inspecting && !covered && !instrumentOpen ? feel.open : null;
  // One prompt at a time: a chair or an instrument within reach keeps the floor (Enter asks the same).
  const decorOffer = pier && !feel.open && !inspecting && !covered && decorTurn(w, observatory) ? feel.offer : null;
  const faceLabel = watch.walk && watch.posture === 'seated' && seat?.faces === 'back' ? 'Face the back window' : 'Face the runway';
  const selectedRow = watch.selected ? picker.categories.get(watch.selected) : null;
  const fieldElev = airport ? (airport.a.elevation + airport.b.elevation) / 2 : 0;
  const status = notice || watch.notice || (!watch.validated ? 'Preparing your window seat…' : '');
  // Phone: one bottom sheet at a time. A runtime layer (the seat menu, a
  // décor card, an instrument), the binoculars, the auto director or a full
  // panel hides the phone's own sheet; so does a new selection.
  const runtimeLayer = !!watch.seatMenu || !!decorOpen || instrumentOpen;
  const sheet = phone && sheetState && sheetState.sel === (watch.selected ?? null) && !runtimeLayer && !watch.binocular && !auto && !inspecting && !covered ? sheetState.kind : null;
  const setSheet = useCallback((kind) => setSheetState(kind ? { kind, sel: runtime.airportWatch?.selected ?? null } : null), [runtime]);
  const spotterUp = !!watch.selected && !watch.binocular && !covered && !instrumentOpen && !auto && (!phone || (!sheet && !runtimeLayer));
  const expanded = cardExpanded.hex === watch.selected && cardExpanded.open;
  const standing = watch.posture === 'standing' || watch.posture === 'gliding';
  const showPeek = phone && !watch.binocular && !auto && !inspecting && !covered && !sheet && !runtimeLayer && !spotterUp && !standing;
  // The thumb zone (FLY_LOUNGE_MOBILE.md contract 1): the walk stick hides
  // while a sheet or panel covers the lower-left zone. A phone held sideways
  // opens the board, the lounge menu and the spotter card as side sheets on
  // the right, clear of the zone (lounge-mobile.css), so there they leave the
  // stick up: the left thumb walks while the right one reads. The seat menu,
  // a décor card, the instruments, inspect, the full panels, pause and the
  // binoculars block in every layout.
  const sideSheets = layout === 'phone-landscape';
  const blocked = mobile && ((!sideSheets && (!!sheet || spotterUp)) || runtimeLayer || inspecting || covered || paused || !!watch.binocular);
  const boardCount = board.arrivals.length + board.departures.length + board.ground.length + board.overhead.length + board.local.length;

  // Android Back on a touch device (use-lounge-back.js): the topmost lounge
  // layer closes first; at the root it leaves the lounge as desktop Esc does.
  const layers = useRef({ sheet: null, expanded: false });
  useEffect(() => {
    layers.current = { sheet, expanded: expanded && spotterUp };
  }, [sheet, expanded, spotterUp]);
  const backStep = useCallback(() => {
    const w = runtime.airportWatch;
    if (!w?.active) return;
    if (useFlyStore.getState().airportBrowserOpen) {
      w.cancelPending?.();
      useFlyStore.setState({ airportBrowserOpen: false });
    } else if (layers.current.sheet) setSheetState(null);
    else if (w.walk?.inspecting) w.walk.closeInspect();
    else if (w.seatMenu && !w.binocular) w.seatMenuOpen(false);
    else if (w.observatory?.snapshot().active && !w.binocular) w.observatory.release();
    else if (layers.current.expanded) setCardExpanded({ hex: null, open: false });
    else if (w.binocular) w.binoculars(false);
    else if (w.director?.auto) w.director.setAuto(false);
    else if (w.selected) w.clearSelection();
    else if (w.exit) w.exit();
    else exitToTitle(runtime);
  }, [runtime]);
  useLoungeBack(device.isTouch, backStep);

  // Phone: a touch on the view folds the phone's own sheets away (the view is
  // what the player reached for), and the expanded spotter sheet back to its
  // peek.
  useEffect(() => {
    if (!phone || (!sheet && !expanded)) return undefined;
    const onDown = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-testid="lounge-surface"]')) return;
      setSheetState(null);
      setCardExpanded({ hex: null, open: false });
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [phone, sheet, expanded]);

  // Phone and tablet: the attribution strip's height, measured (it wraps with
  // the width), so the dock and the thumb zone sit above the credit and never
  // on it.
  useEffect(() => {
    const section = sectionRef.current;
    if (!mobile || !section || typeof ResizeObserver === 'undefined') return undefined;
    const credit = document.querySelector('[data-zone="attribution"] > div');
    if (!credit) return undefined;
    const set = () => section.style.setProperty('--lounge-attr-h', `${Math.ceil(credit.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(credit);
    return () => {
      ro.disconnect();
      section.style.removeProperty('--lounge-attr-h');
    };
  }, [mobile, layout]);

  // Tablet: the desktop header wraps on a narrower screen (the conditions strip
  // takes two rows), so the cue, the board and the status line below it follow
  // its measured height (--lounge-head-h) instead of the desktop's fixed tops.
  useEffect(() => {
    const section = sectionRef.current;
    if (layout !== 'tablet' || !section || typeof ResizeObserver === 'undefined') return undefined;
    const header = section.querySelector('.lounge-header');
    if (!header) return undefined;
    const set = () => section.style.setProperty('--lounge-head-h', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => {
      ro.disconnect();
      section.style.removeProperty('--lounge-head-h');
    };
  }, [layout]);

  return (
    <section
      ref={sectionRef}
      className="tgt airport-watch lounge"
      aria-label="Airport lounge"
      data-overlay="airport-observation"
      data-testid="airport-observation"
      data-binocular={watch.binocular ? '1' : '0'}
      data-instruments={observatory ? '1' : '0'}
      data-auto={auto ? '1' : undefined}
      // LOUNGE MOBILE: phones and tablets only (lounge-mobile.css keys off these).
      data-layout={mobile ? layout : undefined}
      data-posture={mobile ? watch.posture || 'seated' : undefined}
      data-sheet={phone && (sheet || runtimeLayer || spotterUp) ? '1' : undefined}
      data-peek={showPeek ? '1' : undefined}
      data-thumb-blocked={mobile ? (blocked ? '1' : '0') : undefined}
      data-reduced={reduced ? '1' : undefined}
      onKeyDown={(e) => {
        // Keyboard isolation: keys typed inside the lounge never steer.
        if (e.key !== 'Escape') e.stopPropagation();
      }}
      onPointerDownCapture={auto ? (e) => { if (!e.target.closest?.('[data-director-control]')) w?.director?.handBack(); } : undefined}
      onWheelCapture={auto ? () => w?.director?.handBack() : undefined}
    >
      <PhoneMotion mobile={mobile} reduced={reduced}>
      <LoungeSurface runtime={runtime} picker={picker} onNotice={flash} />
      <LoungeOverlay runtime={runtime} picker={picker} binoLayout={binoLayout} insets={mobile ? insets : null} />
      {/* LOUNGE MOBILE slot: `blocked` is true while a sheet or panel covers
          the thumb zone. */}
      <LoungeTouchControls runtime={runtime} watch={watch} blocked={blocked} />
      {mobile && <i ref={safeRef} className="lounge-safe-probe" aria-hidden="true" />}

      {phone ? (
        <LoungeHeaderPhone
          code={airport?.ident || watch.id}
          name={airport?.name}
          runway={runwayLabel(airport)}
          feed={feed.state}
          count={feed.count}
          clock={conditions.clock}
          place={place}
          menuOpen={sheet === 'more'}
          onMenu={() => setSheet(sheet === 'more' ? null : 'more')}
        />
      ) : (
        <LoungeHeader
          code={airport?.ident || watch.id}
          name={airport?.name}
          runway={runwayLabel(airport)}
          feed={feed.state}
          count={feed.count}
          clock={conditions.clock}
          sun={conditions.sun}
          weather={conditions.weather}
          place={place}
          leaveLabel={leaveLabelFor(watch.origin)}
          onAirports={() => useFlyStore.setState({ airportBrowserOpen: true })}
          onLeave={leave}
        />
      )}

      {!observatory?.prompt && !instrumentOpen && !decorOpen && !sheet && <SitPrompt runtime={runtime} watch={watch} />}
      {!sheet && <DecorPrompt runtime={runtime} offer={decorOffer} />}
      {decorOpen && <DecorCard key={decorOpen.id} runtime={runtime} item={decorOpen} touch={mobile || undefined} />}
      <ObservatoryHud runtime={runtime} state={observatory} hidden={inspecting || covered || watch.seatMenu || !!decorOpen || !!sheet} />
      <SeatMenu runtime={runtime} watch={watch} touch={mobile || undefined} />

      {DIRECTOR_ON && !phone && !inspecting && !covered && !instrumentOpen && !watch.seatMenu && !decorOpen && <DirectorCue runtime={runtime} state={director} binocular={!!watch.binocular} card={!!watch.selected && !watch.binocular && !auto} />}
      {/* Phone: the next movement rides the board's peek; the cue itself only
          while the auto director has the view (its Stop). */}
      {DIRECTOR_ON && phone && auto && !inspecting && !covered && <DirectorCue runtime={runtime} state={director} binocular={!!watch.binocular} />}
      {DIRECTOR_ON && !covered && <DirectorLower runtime={runtime} state={director} ident={airport?.ident || String(airport?.id || '').split(':')[0]} beside={!!watch.selected && !watch.binocular && !auto && !instrumentOpen} />}

      {!phone && !watch.binocular && !inspecting && !covered && !instrumentOpen && !auto && (
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
      {sheet === 'board' && (
        <LiveBoard
          sheet
          board={board}
          tab={tab}
          onTab={(t) => {
            autoTab.current = false;
            setTab(t);
          }}
          open
          onToggle={() => setSheet(null)}
          selected={watch.selected}
          onSelect={(hex) => {
            w?.select(hex);
            setSheetState(null);
          }}
          onBinoculars={(hex) => {
            setSheetState(null);
            w?.select(hex, { binoculars: true });
          }}
          feed={feed.state === 'live' && !feed.count ? 'quiet' : feed.state}
        />
      )}
      {showPeek && <BoardPeek runtime={runtime} movement={peekMovement(director, board)} total={boardCount} onOpen={() => setSheet('board')} />}

      <AnimatePresence>
        {spotterUp && (
          <SpotterCard
            key={watch.selected}
            runtime={runtime}
            hex={watch.selected}
            boardRow={selectedRow}
            fieldElev={fieldElev}
            airportIdent={airport?.ident || String(airport?.id || '').split(':')[0]}
            onPhoto={photo}
            savingPhoto={savingPhoto}
            sheet={phone ? { expanded, onToggle: () => setCardExpanded({ hex: watch.selected, open: !expanded }), onClose: () => w?.clearSelection() } : undefined}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{watch.binocular && <BinocularHud key="bino" runtime={runtime} layout={binoLayout} insets={insets} notice={binoLayout !== 'desktop' ? status : undefined} />}</AnimatePresence>

      {!phone && !watch.binocular && !auto && (
        <footer className="lounge-bar lounge-panel" aria-label="Lounge controls">
          <button type="button" className="lounge-btn" aria-pressed={boardOpen} onClick={() => setBoardOpen((v) => !v)} title="Live board">
            <ListOrdered size={16} aria-hidden="true" />
            <span>Board</span>
          </button>
          <SeatsButton runtime={runtime} watch={watch} />
          {observatory && <button type="button" className="lounge-btn" aria-label="Airport map" title="Airport map (I)" data-testid="observatory-open" aria-pressed={observatory.active === 'airport-table'} onClick={() => observatory.active === 'airport-table' ? w?.observatory?.release() : w?.observatory?.activate('airport-table', { remote: true })}><MapIcon size={16} aria-hidden="true" /><span>Map</span></button>}
          {observatory && <button type="button" className="lounge-btn lounge-btn-icon" aria-label={observatory.night ? 'Restore lounge lighting' : 'Dim lounge lighting'} title={observatory.night ? 'Restore lounge lighting' : 'Dim lounge lighting'} aria-pressed={observatory.night} data-testid="observatory-lighting" onClick={() => w?.observatory?.toggleNight()}>{observatory.night ? <Sun size={17} /> : <Moon size={17} />}</button>}
          <button type="button" className="lounge-btn" data-testid="lounge-face-runway" onClick={() => w?.resetLook()} title={`${faceLabel} (R)`}>
            <RotateCcw size={16} aria-hidden="true" />
            <span>{faceLabel}</span>
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
          <LoungeBridgeBar runtime={runtime} watch={watch} />
        </footer>
      )}
      {phone && !watch.binocular && !auto && (
        <PhoneDock
          runtime={runtime}
          watch={watch}
          sheet={sheet}
          boardCount={boardCount}
          selection={spotterUp ? selectedRow?.label || watch.selected : null}
          onBoard={() => setSheet(sheet === 'board' ? null : 'board')}
          onMore={() => setSheet(sheet === 'more' ? null : 'more')}
          onAction={() => setSheetState(null)}
        />
      )}
      {!phone && !watch.binocular && !auto && (
        <p className="lounge-help" aria-hidden="true">
          {helpHints(watch).map((hint, i) => (
            <Fragment key={hint}>
              {i > 0 && <> <span>·</span> </>}
              {hint}
            </Fragment>
          ))}
        </p>
      )}
      {phone && <CoachMarks posture={watch.posture} walk={!!watch.walk} hidden={!watch.validated || !!watch.binocular || auto || inspecting || covered || !!sheet || runtimeLayer || spotterUp} />}

      <AnimatePresence>
        {sheet === 'more' && (
          <LoungeMenuSheet
            key="more"
            runtime={runtime}
            watch={watch}
            observatory={observatory}
            director={DIRECTOR_ON}
            sound={sound}
            savingPhoto={savingPhoto}
            onPhoto={photo}
            faceLabel={faceLabel}
            conditions={conditions}
            feed={feed}
            airport={airport}
            leaveLabel={leaveLabelFor(watch.origin)}
            onAirports={() => {
              setSheetState(null);
              useFlyStore.setState({ airportBrowserOpen: true });
            }}
            onLeave={leave}
            onClose={() => setSheetState(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {status && !(binoLayout !== 'desktop' && watch.binocular) && (
          // framer-motion owns `transform`, so the centring offset rides in x.
          <motion.p key={status} className="lounge-status airport-status" role="status" initial={reduced ? false : { opacity: 0, y: -6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }} transition={{ duration: 0.2 }}>
            {status}
          </motion.p>
        )}
      </AnimatePresence>
      </PhoneMotion>
    </section>
  );
}

/** Phones and tablets: the HUD's framer-motion follows the reduced-motion preference. Desktop: no wrapper, today's tree. */
function PhoneMotion({ mobile, reduced, children }) {
  if (!mobile) return children;
  return <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>;
}

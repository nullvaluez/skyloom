'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Binoculars, Camera, ChevronUp, Clapperboard, Crosshair, Ellipsis, Eye, Hand, ListOrdered, LocateFixed, Map as MapIcon, Moon, MousePointerClick, Move, RotateCcw, Sun, Volume2, VolumeX, X, ZoomIn } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { MOBILE_GLASS } from '@/lib/fly/observation-config';
import { countdown, movementVerb } from '@/lib/fly/airport-watch-director.mjs';
import { haptic } from '@/lib/fly/lounge/haptics';
import { fmtEta } from './SpotterCard';
import { SeatsButton } from './SeatsButton';
import { LoungeBridgeBar } from './LoungeBridgeBar';
import { LoungeConditions } from './LoungeHeader';
import { SheetGrabber } from './LoungeSheet';

/*
 * LOUNGE MOBILE — GLASS (FLY_LOUNGE_MOBILE.md): the phone lounge's own chrome,
 * mounted by LoungeHud only on a phone (portrait and landscape; CSS in
 * lounge-mobile.css lays both out). Everything a thumb needs at a glance is
 * in the dock; everything else is one tap further, in the lounge menu.
 *
 *  - PhoneDock: Board, Seats (with walking), the Binoculars as the big primary
 *    action, Follow, More. A bar along the bottom in portrait; a rail down the
 *    right edge in landscape (the left thumb looks and walks, the right one
 *    acts).
 *  - LoungeMenuSheet: Face the runway, the airport map and lighting (the
 *    instruments), Photo, Sound, Watch for me (the director), then the field's
 *    conditions and Airports / Leave.
 *  - BoardPeek: the live board folded to one line — the next movement — that
 *    opens the board sheet; Watch (the director's N) beside it.
 *  - CoachMarks: the help line, touch-worded, once: the gestures of the touch
 *    scheme (FLY_LOUNGE_MOBILE.md's gesture table), dismissed by a tap,
 *    remembered, and faded on its own once the view has been used a few times.
 *
 * Existing test ids keep their controls (lounge-binoculars, lounge-follow,
 * lounge-seats, lounge-face-runway, lounge-airports, lounge-leave,
 * observatory-open, observatory-lighting, director-watch, director-auto); the
 * new ones: lounge-dock, lounge-board-toggle, lounge-more, lounge-more-sheet,
 * lounge-photo, lounge-sound, lounge-board-peek, lounge-coach,
 * lounge-coach-dismiss.
 */

/** The thumb dock. */
export function PhoneDock({ runtime, watch, sheet, onBoard, onMore, onAction, boardCount }) {
  const w = runtime.airportWatch;
  return (
    <nav
      className="lounge-dock"
      data-testid="lounge-dock"
      aria-label="Lounge controls"
      data-lounge-avoid=""
      // Any action other than the two sheet toggles folds an open sheet away.
      onClickCapture={(e) => {
        if (!(e.target instanceof Element) || !e.target.closest('[data-sheet-toggle]')) onAction?.();
      }}
    >
      <button type="button" className="ldk-btn" data-testid="lounge-board-toggle" data-sheet-toggle="" aria-pressed={sheet === 'board'} onClick={onBoard}>
        <ListOrdered size={20} aria-hidden="true" />
        <span>Board</span>
        {boardCount > 0 && <em aria-label={`${boardCount} tracked`}>{boardCount}</em>}
      </button>
      {watch.walk ? (
        <SeatsButton runtime={runtime} watch={watch} />
      ) : (
        <button type="button" className="ldk-btn" data-testid="lounge-dock-face" onClick={() => w?.resetLook()}>
          <RotateCcw size={20} aria-hidden="true" />
          <span>Face</span>
        </button>
      )}
      <button
        type="button"
        className="ldk-primary"
        data-testid="lounge-binoculars"
        aria-pressed={!!watch.binocular}
        onClick={() => {
          haptic('raise');
          w?.binoculars();
        }}
        aria-label="Binoculars"
      >
        <Binoculars size={26} aria-hidden="true" />
      </button>
      <button type="button" className="ldk-btn" data-testid="lounge-follow" aria-pressed={!!watch.tracking} disabled={!watch.selected} onClick={() => w?.track()}>
        <Crosshair size={20} aria-hidden="true" />
        <span>{watch.tracking ? 'Following' : 'Follow'}</span>
      </button>
      <button type="button" className="ldk-btn" data-testid="lounge-more" data-sheet-toggle="" aria-pressed={sheet === 'more'} aria-haspopup="dialog" onClick={onMore}>
        <Ellipsis size={20} aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  );
}

/** The lounge menu sheet: the rest of the controls, the conditions, Airports and Leave. */
export function LoungeMenuSheet({ runtime, watch, observatory, director, sound, savingPhoto, onPhoto, faceLabel, conditions, feed, airport, leaveLabel, onAirports, onLeave, onClose }) {
  const w = runtime.airportWatch;
  const act = (fn) => () => {
    fn();
    onClose();
  };
  return (
    <motion.section
      className="lounge-sheet lounge-menu-sheet"
      data-testid="lounge-more-sheet"
      data-overlay="airport-menu"
      role="dialog"
      aria-label="Lounge menu"
      data-lounge-avoid=""
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
    >
      <SheetGrabber expanded onToggle={onClose} onCollapse={onClose} label="Close the lounge menu" />
      <header className="lms-head">
        <span className="lms-code">{airport?.ident || ''}</span>
        <span className="lms-name">{airport?.name || 'Airport lounge'}</span>
        <button type="button" className="lsheet-close" onClick={onClose} aria-label="Close the lounge menu">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <LoungeConditions feed={feed.state} count={feed.count} sun={conditions.sun} weather={conditions.weather} />
      <div className="lms-grid">
        <button type="button" className="lms-tile" data-testid="lounge-face-runway" onClick={act(() => w?.resetLook())}>
          <RotateCcw size={20} aria-hidden="true" />
          <span>{faceLabel}</span>
        </button>
        {observatory && (
          <button type="button" className="lms-tile" data-testid="observatory-open" aria-pressed={observatory.active === 'airport-table'} onClick={act(() => (observatory.active === 'airport-table' ? w?.observatory?.release() : w?.observatory?.activate('airport-table', { remote: true })))}>
            <MapIcon size={20} aria-hidden="true" />
            <span>Airport map</span>
          </button>
        )}
        {observatory && (
          <button type="button" className="lms-tile" data-testid="observatory-lighting" aria-pressed={observatory.night} onClick={() => w?.observatory?.toggleNight()}>
            {observatory.night ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
            <span>{observatory.night ? 'Lights up' : 'Dim lights'}</span>
          </button>
        )}
        <button type="button" className="lms-tile" data-testid="lounge-photo" disabled={savingPhoto || !watch.validated} aria-busy={savingPhoto} onClick={act(onPhoto)}>
          <Camera size={20} aria-hidden="true" />
          <span>Photo</span>
        </button>
        <button type="button" className="lms-tile" data-testid="lounge-sound" aria-pressed={sound} onClick={() => useFlyStore.getState().setSoundOn(!sound)}>
          {sound ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
          <span>{sound ? 'Sound on' : 'Sound off'}</span>
        </button>
        {director && (
          <button type="button" className="lms-tile lms-tile-accent" data-testid="director-auto" data-director-control="" onClick={act(() => w?.director?.setAuto(true))}>
            <Clapperboard size={20} aria-hidden="true" />
            <span>Watch for me</span>
          </button>
        )}
        <LoungeBridgeBar runtime={runtime} watch={watch} />
      </div>
      <div className="lms-exit">
        <button type="button" className="lms-wide" onClick={onAirports} data-testid="lounge-airports">
          <LocateFixed size={18} aria-hidden="true" />
          Airports
        </button>
        <button type="button" className="lms-wide lms-leave" onClick={onLeave} data-testid="lounge-leave">
          <X size={18} aria-hidden="true" />
          {leaveLabel}
        </button>
      </div>
    </motion.section>
  );
}

/** What the peek line says: the director's next movement, else the board's soonest arrival or departure. */
export function peekMovement(director, board) {
  const next = director?.next;
  if (next) {
    const rw = next.runway ? ` ${next.runway}` : '';
    const when = next.kind === 'landing' ? (countdown(next.etaS) === 'now' ? 'now' : `in ${countdown(next.etaS)}`) : 'now';
    return { kind: next.kind, label: next.label, line: next.kind === 'climb' ? `Climbing out${next.runway ? ' of ' + next.runway : ''}` : `${movementVerb(next.kind)}${rw} ${when}`, director: true };
  }
  const arrival = board.arrivals.find((r) => Number.isFinite(r.etaS));
  if (arrival) return { kind: 'landing', label: arrival.label, line: `${arrival.phaseLabel}${fmtEta(arrival.etaS) ? ' · ' + fmtEta(arrival.etaS) : ''}` };
  const departure = board.departures[0];
  if (departure) return { kind: 'takeoff', label: departure.label, line: departure.phaseLabel };
  return null;
}

/** The board folded to one line. */
export function BoardPeek({ runtime, movement, total, onOpen }) {
  const w = runtime.airportWatch;
  return (
    <div className="lounge-peek" data-testid="lounge-board-peek" data-tone={movement?.kind === 'landing' ? 'land' : movement ? 'depart' : 'quiet'} data-lounge-avoid="">
      <button type="button" className="lpk-main" onClick={onOpen} aria-expanded="false" aria-controls="lounge-board-body" aria-label={movement ? `Live board. Next: ${movement.label}, ${movement.line}` : 'Open the live board'}>
        <i aria-hidden="true" />
        <span className="lpk-text">
          <small>{movement ? 'Next movement' : 'Live board'}</small>
          <strong>{movement ? <><b>{movement.label}</b> {movement.line}</> : total ? `${total} aircraft tracked` : 'Quiet skies for now'}</strong>
        </span>
        <ChevronUp size={18} aria-hidden="true" />
      </button>
      {movement?.director && (
        <button type="button" className="lpk-watch" data-testid="director-watch" data-director-control="" onClick={() => w?.director?.watchNext()}>
          <Eye size={17} aria-hidden="true" />
          Watch
        </button>
      )}
    </div>
  );
}

const COACH = {
  seated: [
    [Hand, 'Drag to look around'],
    [ZoomIn, 'Pinch to zoom'],
    [MousePointerClick, 'Tap a plane to select it'],
    [Binoculars, 'Double-tap for binoculars'],
  ],
  standing: [
    [Move, 'Thumb stick, lower left, to walk'],
    [Hand, 'Drag to look around'],
    [MousePointerClick, 'Tap a chair to sit'],
    [Binoculars, 'Double-tap for binoculars'],
  ],
};

function coachSeen() {
  try {
    return localStorage.getItem(MOBILE_GLASS.coach.key) === '1';
  } catch {
    return false;
  }
}
function rememberCoach() {
  try {
    localStorage.setItem(MOBILE_GLASS.coach.key, '1');
  } catch {
    // a remembered hint is a convenience, nothing more
  }
}

/**
 * First-visit coach marks. They never take a touch from the view (only the
 * dismiss button does), go away on a tap of it, after a few touches of the
 * view (remembered either way), or after a while (shown again next visit).
 */
export function CoachMarks({ posture, hidden }) {
  const [open, setOpen] = useState(() => !coachSeen());
  // The clock and the touch count run only while the tips are on screen.
  useEffect(() => {
    if (!open || hidden) return undefined;
    let touches = 0;
    const onDown = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-testid="lounge-surface"]')) return;
      if (++touches >= MOBILE_GLASS.coach.autoHideTouches) {
        rememberCoach();
        setOpen(false);
      }
    };
    const timer = setTimeout(() => setOpen(false), MOBILE_GLASS.coach.autoHideMs);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, hidden]);
  // Dev only: probes reopen the tips (an earlier probe's touches may have
  // faded them) to check their words and their dismissal.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined;
    window.__flyLoungeCoach = { open: () => setOpen(true) };
    return () => {
      delete window.__flyLoungeCoach;
    };
  }, []);
  const rows = COACH[posture === 'standing' ? 'standing' : 'seated'];
  return (
    <AnimatePresence>
      {open && !hidden && (
        <motion.aside
          className="lounge-coach"
          data-testid="lounge-coach"
          aria-label="How to look around"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.28 }}
        >
          <ul>
            {rows.map(([Icon, text]) => (
              <li key={text}>
                <Icon size={16} aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="lounge-coach-dismiss"
            data-testid="lounge-coach-dismiss"
            onClick={() => {
              rememberCoach();
              setOpen(false);
            }}
            aria-label="Got it, hide these tips"
          >
            Got it
          </button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

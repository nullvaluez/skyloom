'use client';
import { useEffect, useRef } from 'react';
import { Armchair, X } from 'lucide-react';
import { seatGroups } from '@/lib/fly/lounge/lounge-life.mjs';
import './lounge-life.css';

/*
 * The seat menu (LOUNGE_WALK): the room's vantage seats, each naming what it
 * faces. Choosing one glides there and sits (watch.sit). Opened by V or the
 * Seats button, closed by Esc, the close button or a choice. Test ids
 * lounge-seat-menu and lounge-seat-<id>.
 *
 * Also the reduced-motion veil: a seat glide under reduced motion is a short
 * dip to black (watch.walk.veil, 0..1), drawn here per frame.
 *
 * In the pier room the seats span two floors, so the menu groups them under
 * "Lower lounge" and "Upper room" (lib/fly/lounge/lounge-life.mjs seatGroups).
 * Grouped, it takes focus when it opens (your seat, else the first), the
 * arrows move between its rows, and focus returns where it was when it
 * closes. A seat on the other floor still glides there by the stair, with
 * the comfort fade where the view would move too fast. One floor's seats
 * (the classic room) read exactly as before.
 */

function facesLine(seat, runway, back) {
  if (seat.faces === 'back') return back ? `Faces ${back}` : 'Faces the back window';
  return runway ? `Faces runway ${runway}` : 'Faces the runway';
}

function SeatRow({ seat, here, runway, back, onChoose }) {
  return (
    <li>
      <button type="button" className="lsm-row" data-testid={`lounge-seat-${seat.id}`} aria-current={here ? 'true' : undefined} onClick={onChoose}>
        <Armchair size={16} aria-hidden="true" />
        <span className="lsm-text">
          <strong>{seat.label}</strong>
          <small>{facesLine(seat, runway, back)}</small>
        </span>
        {here && <span className="lsm-here">You are here</span>}
      </button>
    </li>
  );
}

/** The grouped (two-floor) menu: focus in on open, arrows between rows, focus back on close. */
function useGroupedFocus(menu, grouped, open) {
  useEffect(() => {
    if (!grouped || !open || !menu.current) return undefined;
    const before = document.activeElement;
    const rows = menu.current.querySelectorAll('.lsm-row');
    (menu.current.querySelector('.lsm-row[aria-current="true"]') ?? rows[0])?.focus({ preventScroll: true });
    return () => {
      const back = before && before.isConnected && before !== document.body ? before : document.querySelector('[data-testid="lounge-surface"]');
      back?.focus?.({ preventScroll: true });
    };
  }, [menu, grouped, open]);
}
const onGroupedKey = (e) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = [...e.currentTarget.querySelectorAll('.lsm-row')];
  const i = rows.indexOf(document.activeElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (Math.max(0, i) + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
  rows[next]?.focus();
  e.preventDefault();
};

export function SeatMenu({ runtime, watch }) {
  const veil = useRef(null);
  const menu = useRef(null);
  const walking = !!watch.walk;
  const seatsNow = runtime.airportWatch?.seats ?? [];
  const groups = walking ? seatGroups(seatsNow) : null;
  useGroupedFocus(menu, !!groups, !!(watch.seatMenu && !watch.binocular));

  // The veil follows watch.walk.veil every frame while walking is on.
  useEffect(() => {
    if (!walking) return undefined;
    let raf = 0, last = -1;
    const tick = () => {
      const v = runtime.airportWatch?.walk?.veil ?? 0;
      if (veil.current && v !== last) {
        veil.current.style.opacity = String(v);
        last = v;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runtime, walking]);

  if (!walking) return null;
  const w = runtime.airportWatch;
  const airport = w?.airport;
  const runway = airport?.runway && airport?.reciprocal ? `${airport.runway}/${airport.reciprocal}` : null;
  const back = w?.site?.back?.label ?? null;
  const seats = w?.seats ?? [];
  const row = (seat) => {
    const here = watch.posture === 'seated' && watch.seat === seat.id;
    return <SeatRow key={seat.id} seat={seat} here={here} runway={runway} back={back} onChoose={() => { w?.seatMenuOpen(false); if (!here) w?.sit(seat.id); }} />;
  };
  if (groups) return (
    <>
      <div ref={veil} className="lounge-veil" aria-hidden="true" />
      {watch.seatMenu && !watch.binocular && (
        <section ref={menu} className="lounge-seat-menu lounge-panel" data-testid="lounge-seat-menu" data-grouped="" role="dialog" aria-label="Seats" onKeyDown={onGroupedKey}>
          <header>
            <h2>Seats</h2>
            <button type="button" className="lounge-btn lounge-btn-icon" onClick={() => w?.seatMenuOpen(false)} aria-label="Close seats">
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          {groups.map((g) => (
            <div key={g.id} className="lsm-group" role="group" aria-labelledby={`lsm-group-${g.id}`}>
              <h3 id={`lsm-group-${g.id}`}>{g.label}</h3>
              <ul>{g.seats.map(row)}</ul>
            </div>
          ))}
          <p className="lsm-foot">Or walk: WASD, Shift to run. Click a chair to sit.</p>
        </section>
      )}
    </>
  );
  return (
    <>
      <div ref={veil} className="lounge-veil" aria-hidden="true" />
      {watch.seatMenu && !watch.binocular && (
        <section className="lounge-seat-menu lounge-panel" data-testid="lounge-seat-menu" role="dialog" aria-label="Seats">
          <header>
            <h2>Seats</h2>
            <button type="button" className="lounge-btn lounge-btn-icon" onClick={() => w?.seatMenuOpen(false)} aria-label="Close seats">
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <ul>
            {seats.map((seat) => {
              const here = watch.posture === 'seated' && watch.seat === seat.id;
              return (
                <li key={seat.id}>
                  <button
                    type="button"
                    className="lsm-row"
                    data-testid={`lounge-seat-${seat.id}`}
                    aria-current={here ? 'true' : undefined}
                    onClick={() => {
                      w?.seatMenuOpen(false);
                      if (!here) w?.sit(seat.id);
                    }}
                  >
                    <Armchair size={16} aria-hidden="true" />
                    <span className="lsm-text">
                      <strong>{seat.label}</strong>
                      <small>{facesLine(seat, runway, back)}</small>
                    </span>
                    {here && <span className="lsm-here">You are here</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="lsm-foot">Or walk: WASD, Shift to run. Click a chair to sit.</p>
        </section>
      )}
    </>
  );
}

'use client';
import { useEffect, useRef } from 'react';
import { Armchair, X } from 'lucide-react';

/*
 * The seat menu (LOUNGE_WALK): the room's vantage seats, each naming what it
 * faces. Choosing one glides there and sits (watch.sit). Opened by V or the
 * Seats button, closed by Esc, the close button or a choice. Test ids
 * lounge-seat-menu and lounge-seat-<id>.
 *
 * Also the reduced-motion veil: a seat glide under reduced motion is a short
 * dip to black (watch.walk.veil, 0..1), drawn here per frame.
 */

function facesLine(seat, runway, back) {
  if (seat.faces === 'back') return back ? `Faces ${back}` : 'Faces the back window';
  return runway ? `Faces runway ${runway}` : 'Faces the runway';
}

export function SeatMenu({ runtime, watch }) {
  const veil = useRef(null);
  const walking = !!watch.walk;

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

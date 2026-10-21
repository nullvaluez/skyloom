'use client';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clapperboard, Eye, PlaneLanding, PlaneTakeoff, Plane, Square } from 'lucide-react';
import { useRoute } from '@/hooks/use-route';
import { countdown, movementVerb, captionKicker } from '@/lib/fly/airport-watch-director.mjs';
import './director.css';

/*
 * DIRECTOR HUD (Play Pass DIRECTOR, LOUNGE_DIRECTOR; FLY_PLAY_PASS.md A1–A4).
 * Mounted by LoungeHud only while the flag is on. Reads
 * runtime.airportWatch.director.snapshot() at 4 Hz (lib/fly/
 * airport-watch-director-runtime.js); the in-view locator is drawn per GL
 * frame by LoungeOverlay.
 *
 *  - the NEXT cue (top left, under the place): the next movement at the field
 *    — landing or taking off, the runway, a countdown — with Watch (N) and
 *    Watch for me (H); then the one after it. While the auto director has the
 *    view it says what it is watching and how to take the controls back;
 *  - the LOWER THIRD (bottom left, broadcast style): the auto director's
 *    captions (airline and flight, type, from → to when the route on file
 *    agrees with what the aircraft is doing here) and the moments —
 *    touchdown, airborne — of the watched aircraft or the next one.
 *
 * Test ids: director-cue, director-watch, director-auto, director-stop,
 * director-lower. Controls carry data-director-control: clicking them never
 * counts as the player taking the view back.
 */

/** The director's snapshot at 4 Hz (`on` false: nothing polls, always null). */
export function useDirector(runtime, id, on = true) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    const read = () => setState(runtime.airportWatch?.director?.snapshot() ?? null);
    read();
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
  }, [runtime, id, on]);
  return state;
}

const KindIcon = ({ kind, size = 15 }) => {
  const Icon = kind === 'landing' ? PlaneLanding : kind === 'takeoff' || kind === 'climb' ? PlaneTakeoff : Plane;
  return <Icon size={size} aria-hidden="true" />;
};
const tone = (kind) => (kind === 'landing' ? 'land' : kind === 'takeoff' || kind === 'climb' ? 'depart' : 'ground');
const idLine = (m) => [m.airline, m.type || m.typeCode].filter(Boolean).join(' · ') || 'Unidentified';
/** "Landing 04R in 1:18" / "Taking off now" / "Climbing out of 22R". */
function whenLine(m) {
  const verb = movementVerb(m.kind);
  const rw = m.runway ? (m.kind === 'climb' ? ` from ${m.runway}` : ` ${m.runway}`) : '';
  if (m.kind === 'landing') {
    const c = countdown(m.etaS);
    return c === 'now' ? `${verb}${rw} now` : `${verb}${rw} in ${c}`;
  }
  return m.kind === 'takeoff' ? `${verb}${rw} now` : `${verb}${rw}`;
}

/** The auto director's line for what it is doing now. */
function autoLine(d) {
  const s = d.session;
  if (s) return captionKicker(s.kind, s.reason, s.runway) || 'Watching';
  if (d.next) return d.next.kind === 'landing' ? `Next: ${d.next.label} lands in ${countdown(d.next.etaS)}` : `Next: ${d.next.label}`;
  return 'Waiting for the next movement';
}

/** `card`: the spotter card is open below it (short windows fold the cue to its essentials). */
export function DirectorCue({ runtime, state, binocular, card = false }) {
  const w = runtime.airportWatch;
  const d = state;
  if (!d) return null;
  const next = d.next;
  if (d.auto) {
    const s = d.session;
    return (
      <section className="lounge-panel dir-cue" data-auto="1" data-compact={binocular ? '1' : '0'} data-tone={tone(s?.kind ?? next?.kind)} data-testid="director-cue" data-director-control="" aria-label="Watching for you">
        <div className="dir-cue-head">
          <span className="dir-kicker">
            <Clapperboard size={13} aria-hidden="true" />
            Watching for you
          </span>
          <button type="button" className="dir-stop" data-testid="director-stop" onClick={() => w?.director?.setAuto(false)} title="Take the controls back (H, Esc or any input)">
            <Square size={10} aria-hidden="true" />
            Stop <kbd>H</kbd>
          </button>
        </div>
        {!binocular && (
          <div className="dir-auto-now">
            {s ? (
              <>
                <KindIcon kind={s.kind} />
                <span className="dir-id">
                  <strong>{s.label}</strong>
                  <small>{autoLine(d)}</small>
                </span>
              </>
            ) : (
              <span className="dir-id">
                <strong>Between movements</strong>
                <small>{autoLine(d)}</small>
              </span>
            )}
          </div>
        )}
        {!binocular && <p className="dir-foot">Any input takes the controls back</p>}
      </section>
    );
  }
  if (binocular) return null;
  const watching = d.session && !d.session.auto ? d.session : null;
  return (
    <section className="lounge-panel dir-cue" data-auto="0" data-card={card ? '1' : '0'} data-tone={tone(next?.kind)} data-testid="director-cue" data-director-control="" aria-label="Next movement">
      <div className="dir-cue-head">
        <span className="dir-kicker">
          <i aria-hidden="true" />
          {watching ? 'Watching' : 'Next movement'}
        </span>
        {next?.kind === 'landing' && <span className="dir-count" data-soon={next.etaS < 60 ? '1' : '0'}>{countdown(next.etaS)}</span>}
        {next?.kind === 'takeoff' && <span className="dir-count" data-soon="1">now</span>}
      </div>
      {watching && (
        <div className="dir-watching">
          <KindIcon kind={watching.kind} size={14} />
          <span>
            <b>{watching.label}</b> · {captionKicker(watching.kind, watching.reason, watching.runway) || 'Following'}
          </span>
        </div>
      )}
      {next ? (
        <button type="button" className="dir-next" onClick={() => w?.director?.watchNext()} title="Watch it: the head turns and follows it through the movement (N)">
          <KindIcon kind={next.kind} size={18} />
          <span className="dir-id">
            <strong>{next.label}</strong>
            <small>{idLine(next)}</small>
          </span>
          <span className="dir-when">{whenLine(next)}{next.unseen ? <em>out of view from here</em> : null}</span>
        </button>
      ) : (
        <p className="dir-quiet">Nothing lined up to land or take off yet. The board updates live.</p>
      )}
      <div className="dir-actions">
        <button type="button" className="dir-btn" data-testid="director-watch" disabled={!next} onClick={() => w?.director?.watchNext()} title="Watch the next movement (N)">
          <Eye size={15} aria-hidden="true" />
          Watch <kbd>N</kbd>
        </button>
        <button type="button" className="dir-btn dir-btn-auto" data-testid="director-auto" onClick={() => w?.director?.setAuto(true)} title="Lean back: the lounge watches the movements for you (H)">
          <Clapperboard size={15} aria-hidden="true" />
          Watch for me <kbd>H</kbd>
        </button>
      </div>
      {next?.then && (
        <p className="dir-then">
          Then <b>{next.then.label}</b> · {next.then.kind === 'landing' ? `lands in ${countdown(next.then.etaS)}` : movementVerb(next.then.kind).toLowerCase()}
        </p>
      )}
    </section>
  );
}

/** The route as a caption when it agrees with what the aircraft is doing here ("Fort Myers → New York"). */
function useCaptionRoute(runtime, hex, kind, ident) {
  const t = hex ? runtime.traffic?.tracks.get(hex) : null;
  const meta = t?.meta || null;
  const routable = !!meta?.flight?.trim() && meta.flight.trim().replace(/-/g, '') !== String(meta.r || '').replace(/-/g, '');
  const shim = useMemo(() => (meta && routable ? { hex, flight: meta.flight, r: meta.r, t: meta.t, category: meta.category } : null),
    // The identity is enough for the lookup; telemetry would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hex, routable]);
  const { route } = useRoute(shim);
  const o = route?.origin, dst = route?.destination;
  if (!o || !dst) return null;
  if (kind === 'landing' && dst.icao && ident && dst.icao !== ident) return null;
  if ((kind === 'takeoff' || kind === 'climb') && o.icao && ident && o.icao !== ident) return null;
  const name = (a) => a.city || a.iata || a.icao || a.name;
  return `${name(o)} → ${name(dst)}`;
}

function LowerThird({ runtime, item, ident }) {
  const route = useCaptionRoute(runtime, item.hex, item.kind, ident);
  const sub = [item.type || item.typeCode, route].filter(Boolean).join(' · ');
  return (
    <motion.div
      className="dir-lower"
      data-testid="director-lower"
      data-variant={item.moment ? 'moment' : 'caption'}
      data-tone={item.moment === 'touchdown' ? 'land' : item.moment === 'liftoff' ? 'depart' : tone(item.kind)}
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      role="status"
    >
      <span className="dir-lower-bar" aria-hidden="true" />
      <div className="dir-lower-text">
        <small>{item.kicker}</small>
        <strong>{item.title || item.label}</strong>
        {sub && <span>{sub}</span>}
      </div>
    </motion.div>
  );
}

/** The lower third: a moment (touchdown, airborne) wins over a caption. */
export function DirectorLower({ runtime, state, ident, beside }) {
  const moment = state?.moments?.at(-1) ?? null;
  const caption = state?.auto ? state.caption : null;
  const item = moment ? { ...moment, kind: moment.moment === 'touchdown' ? 'landing' : 'takeoff' } : caption;
  return (
    <div className="dir-lower-slot" data-beside={beside ? '1' : '0'}>
      <AnimatePresence mode="wait">{item && <LowerThird key={item.id || `${item.hex}:${item.kicker}`} runtime={runtime} item={item} ident={ident} />}</AnimatePresence>
    </div>
  );
}

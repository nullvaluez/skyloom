'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronsDown, Gauge, Smartphone } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { VIEW, LOUNGE_ROOM } from '@/lib/fly/observation-config';
import { DEG } from '@/lib/fly/airport-watch-camera.mjs';
import { contactLabel, typeNameFor } from '@/lib/fly/airport-watch-board.mjs';
import { useObservatory } from './ObservatoryHud';
import { M_TO_FT, MPS_TO_KT } from '@/lib/fly/coords';
import { binocularFigure } from '@/lib/fly/lounge/glass-layout.mjs';
import { haptic } from '@/lib/fly/lounge/haptics';
import { FocusWheel } from './FocusWheel';
import { useViewportSize } from './lounge-layout';

/*
 * BINOCULAR HUD — the readouts inside the twin-lens view (the mask and the
 * reticle are drawn frame-synced by LoungeOverlay): a magnification scale
 * with the 7x / 12x / 20x presets, the bearing and elevation you are
 * looking at, and the rangefinder line for the locked aircraft — callsign,
 * type, altitude, speed, range and vertical speed. Read at 8 Hz.
 */

const fmt = (n) => Math.round(n).toLocaleString();

function read(runtime) {
  const w = runtime.airportWatch;
  if (!w?.active) return null;
  const heading = (((-(w.roomHeading + w.yaw) / DEG) % 360) + 360) % 360;
  const out = { mag: w.optics.mag, bearing: heading, elevation: w.pitch / DEG, lock: null };
  const t = w.selected && runtime.traffic?.tracks.get(w.selected);
  if (t?.fix1) {
    const k = w.frame?.k || 1;
    // Ranged from the observer's eye (it walks with LOUNGE_WALK).
    const e = w.eyeWorld ? w.eyeWorld() : { x: w.seat.x, y: w.seat.y + LOUNGE_ROOM.eye[1], z: w.seat.z };
    const dx = (t.rx - e.x) / k, dz = (t.rz - e.z) / k, dy = (t.ry ?? 0) - e.y;
    const fov = (runtime.camera?.fov ?? 58) * DEG;
    out.lock = {
      hex: t.hex,
      label: contactLabel(t.meta, t.hex),
      type: typeNameFor(t.meta) || t.meta?.t || 'Type not broadcast',
      // Feed heights near sea-level fields can dip below zero (GNSS height
      // over the ellipsoid); an altitude readout never shows a negative.
      altFt: Math.max(0, (t.ry ?? 0) * M_TO_FT),
      grounded: !!(t.flags & 1),
      gsKt: Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT,
      rangeKm: Math.hypot(dx, dy, dz) / 1000,
      vsFpm: (t.fix1.vUp || 0) * M_TO_FT * 60,
      locked: w.tracking && w.lockError() < (w.lockTolerance?.() ?? fov / 8), // the runtime's lock tolerance (contract 5)
      tracking: w.tracking,
      stale: t.stale,
    };
  }
  return out;
}

/**
 * `layout` ('desktop' | 'portrait' | 'landscape', LoungeHud) picks the view:
 * the desktop's below, unchanged, or the phone's laid out in the bands of the
 * figure the mask draws (PhoneBinocularHud). `insets` and `notice` are the
 * phone's: the safe areas and the status line, shown inside the band there.
 */
export function BinocularHud({ runtime, layout = 'desktop', insets, notice }) {
  if (layout !== 'desktop') return <PhoneBinocularHud runtime={runtime} layout={layout} insets={insets} notice={notice} />;
  return <DesktopBinocularHud runtime={runtime} />;
}

function DesktopBinocularHud({ runtime }) {
  const observatory = useObservatory(runtime, runtime.airportWatch?.airport?.id);
  const target = useFlyStore((s) => s.airportWatch?.mag ?? 1);
  const [s, setS] = useState(() => read(runtime));
  useEffect(() => {
    const id = setInterval(() => setS(read(runtime)), 125);
    return () => clearInterval(id);
  }, [runtime]);
  if (!s) return null;
  const w = runtime.airportWatch;
  const lock = s.lock;
  const status = !lock ? 'search' : lock.stale === 2 ? 'lost' : lock.locked ? 'lock' : lock.tracking ? 'acquire' : 'free';
  return (
    <motion.div className="bino-hud" data-testid="binocular-view" data-status={status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="bino-top">
        <span>
          BRG <b>{String(Math.round(s.bearing) % 360).padStart(3, '0')}°</b>
        </span>
        <span>
          ELV <b>{s.elevation >= 0 ? '+' : '−'}{Math.abs(s.elevation).toFixed(1)}°</b>
        </span>
      </div>
      {(!observatory || observatory.readouts) && <div className="bino-readout" data-testid="binocular-readout" aria-live="polite">
        <div className="bino-status">
          <i aria-hidden="true" />
          {status === 'lock' ? 'Locked' : status === 'acquire' ? 'Acquiring' : status === 'lost' ? 'Signal lost' : status === 'free' ? 'Free look' : 'Searching'}
          {lock && <strong>{lock.label}</strong>}
          {lock && <span>{lock.type}</span>}
        </div>
        {lock ? (
          <div className="bino-figures">
            <span><small>ALT</small><b>{lock.grounded ? 'GND' : fmt(lock.altFt)}</b><em>{lock.grounded ? '' : 'ft'}</em></span>
            <span><small>SPD</small><b>{fmt(lock.gsKt)}</b><em>kt</em></span>
            <span><small>RNG</small><b>{lock.rangeKm < 9.5 ? lock.rangeKm.toFixed(2) : lock.rangeKm.toFixed(1)}</b><em>km</em></span>
            <span><small>V/S</small><b>{Math.abs(lock.vsFpm) < 150 ? 'LVL' : `${lock.vsFpm > 0 ? '▲' : '▼'}${fmt(Math.abs(lock.vsFpm))}`}</b><em>{Math.abs(lock.vsFpm) < 150 ? '' : 'fpm'}</em></span>
          </div>
        ) : (
          <p className="bino-hint">Drag to search · click an aircraft to lock on</p>
        )}
      </div>
      }
      <div className="bino-mag" role="group" aria-label="Magnification">
        {observatory && <>
          {observatory.supported && <span className="observatory-supported">Resting on rail</span>}
          <button type="button" aria-pressed={observatory.readouts} onClick={() => w?.observatory?.setReadouts(!observatory.readouts)}>Readouts</button>
        </>}
        <span className="bino-mag-now" data-testid="binocular-mag">{s.mag.toFixed(s.mag < 9.95 ? 1 : 0)}×</span>
        {VIEW.optics.steps.map((m, i) => (
          <button key={m} type="button" aria-pressed={Math.abs(target - m) < 0.05} onClick={() => w?.setMagnification(m)} title={`${m}× (${i + 1})`}>
            {m}×
          </button>
        ))}
        <button type="button" className="bino-lower" onClick={() => w?.binoculars(false)} title="Lower the binoculars (B or Esc)">
          Lower <span className="tgt-kbd">B</span>
        </button>
      </div>
    </motion.div>
  );
}

// --- LOUNGE MOBILE — GLASS: the phone binocular view ---------------------------
/*
 * The readouts live in the dark of the figure the mask draws
 * (lib/fly/lounge/glass-layout.mjs binocularFigure, from the same viewport and
 * safe-area insets), never over the glass:
 *  - portrait: information up, controls down. The top band is read-only: the
 *    bearing tape (a compass ribbon, moved per frame), the elevation and the
 *    live power, the identity line (lock status, callsign, type), then the
 *    rangefinder figures (ALT / SPD / RNG / V-S in large tabular numerals) or
 *    a notice of up to two lines ("No aircraft near your line of sight…") or
 *    the hint; a notice that comes while the figures are up floats over the
 *    foot of the glass. Its budget (MOBILE_GLASS.bino.portrait.top) holds the
 *    tallest of these, and it never climbs under the top inset (safe
 *    flex-end). The
 *    bottom band is the thumb's: Lower, the focus wheel, then the side
 *    toggles as labelled rounds — the instruments' Readouts switch (the pier
 *    room) and motion look (a device with an orientation sensor), compact when
 *    both are there (glass-layout.mjs portraitControls). A thumb on the wheel
 *    never covers a number it is reading. In the pier room the figures follow
 *    the instruments' Readouts switch, as on desktop; the lock status and
 *    callsign always show;
 *  - landscape: the twin lenses with the identity and figures in the left
 *    column; the power, a vertical wheel, Lower and the side toggle in the
 *    right one (with motion look in the side slot, the Readouts switch is a
 *    labelled chip across the right column, above Lower: the left column is
 *    full with the figures, and a chip under them ran onto the map credit).
 * Test ids: binocular-view, binocular-readout, binocular-mag (as on desktop),
 * binocular-ident, binocular-notice, binocular-lower, binocular-motion,
 * binocular-readouts, binocular-tape, binocular-wheel.
 *
 * Cost (the hero view of the slowest devices): the tape and the wheel move per
 * frame and write only what changed; the 8 Hz poll commits only when a figure
 * the bands show has changed (phoneView's key), and the tape's 145 marks are a
 * memoised list that never re-renders.
 */
const motionState = (runtime) => {
  const m = runtime.airportWatch?.motionLook;
  return m && m.supported ? { active: !!m.active, needsPermission: !!m.needsPermission } : null;
};

const TAPE_PX = 3.2; // px per degree of bearing
const CARDINAL = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
const TAPE_MARKS = Array.from({ length: 145 }, (_, i) => {
  const deg = -180 + i * 5;
  const n = ((deg % 360) + 360) % 360;
  return { deg, label: deg % 30 === 0 ? CARDINAL[n] ?? String(n).padStart(3, '0') : null };
});

/** The tape's ticks and labels: static, rendered once. */
const TapeMarks = memo(function TapeMarks() {
  return TAPE_MARKS.map((m) => (
    <i key={m.deg} style={{ left: `${((m.deg + 180) * TAPE_PX).toFixed(1)}px` }} data-major={m.label ? '1' : '0'}>
      {m.label && <span>{m.label}</span>}
    </i>
  ));
});

/** The bearing tape: a ribbon of 5° ticks under a fixed caret, its readout and the elevation, moved per frame. */
const BearingTape = memo(function BearingTape({ runtime, elvRef }) {
  const strip = useRef(null);
  const readout = useRef(null);
  const box = useRef(null);
  useEffect(() => {
    let raf = 0, lastB = NaN, lastE = NaN, lastW = -1;
    // The box's width, measured when it changes (never read per frame).
    let width = box.current?.clientWidth ?? 0;
    const ro = typeof ResizeObserver === 'undefined' || !box.current ? null : new ResizeObserver(() => { width = box.current?.clientWidth ?? width; });
    ro?.observe(box.current);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const w = runtime.airportWatch;
      if (!w?.active || !strip.current || !box.current) return;
      const b = (((-(w.roomHeading + w.yaw) / DEG) % 360) + 360) % 360;
      if (!(Math.abs(b - lastB) <= 0.02) || width !== lastW) {
        lastB = b;
        lastW = width;
        strip.current.style.transform = `translate3d(${(width / 2 - (b + 180) * TAPE_PX).toFixed(1)}px,0,0)`;
        readout.current.textContent = `${String(Math.round(b) % 360).padStart(3, '0')}°`;
      }
      const e = w.pitch / DEG;
      if (elvRef.current && !(Math.abs(e - lastE) <= 0.04)) {
        lastE = e;
        elvRef.current.textContent = `${e >= 0 ? '+' : '−'}${Math.abs(e).toFixed(1)}°`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [runtime, elvRef]);
  return (
    <div className="bp-tape" ref={box} data-testid="binocular-tape" aria-hidden="true">
      <div className="bp-tape-strip" ref={strip}>
        <TapeMarks />
      </div>
      <b className="bp-tape-caret" />
      <output className="bp-tape-digits" ref={readout} />
    </div>
  );
});

function lockFigures(lock) {
  return [
    ['ALT', lock.grounded ? 'GND' : fmt(lock.altFt), lock.grounded ? '' : 'ft'],
    ['SPD', fmt(lock.gsKt), 'kt'],
    ['RNG', lock.rangeKm < 9.5 ? lock.rangeKm.toFixed(2) : lock.rangeKm.toFixed(1), 'km'],
    ['V/S', Math.abs(lock.vsFpm) < 150 ? 'LVL' : `${lock.vsFpm > 0 ? '▲' : '▼'}${fmt(Math.abs(lock.vsFpm))}`, Math.abs(lock.vsFpm) < 150 ? '' : 'fpm'],
  ];
}

/**
 * What the phone's bands show, as displayed (the power to 0.1, the figures as
 * formatted, the status, the label), with a key: the 8 Hz poll keeps the
 * previous object, and commits nothing, while the key is unchanged.
 */
function phoneView(runtime) {
  const s = read(runtime);
  if (!s) return null;
  const lock = s.lock;
  const status = !lock ? 'search' : lock.stale === 2 ? 'lost' : lock.locked ? 'lock' : lock.tracking ? 'acquire' : 'free';
  const view = {
    mag: `${s.mag.toFixed(s.mag < 9.95 ? 1 : 0)}×`,
    status,
    lock: lock ? { label: lock.label, type: lock.type, figures: lockFigures(lock) } : null,
  };
  view.key = `${view.mag}|${status}|${lock ? `${lock.label}|${lock.type}|${view.lock.figures.map((f) => f[1]).join('|')}` : '-'}`;
  return view;
}

function PhoneBinocularHud({ runtime, layout, insets, notice }) {
  const observatory = useObservatory(runtime, runtime.airportWatch?.airport?.id);
  const [s, setS] = useState(() => phoneView(runtime));
  const [motionLook, setMotionLook] = useState(() => motionState(runtime));
  const [motionNote, setMotionNote] = useState('');
  const elv = useRef(null);
  const vp = useViewportSize(true);
  useEffect(() => {
    const id = setInterval(() => {
      setS((prev) => {
        const next = phoneView(runtime);
        return prev && next && prev.key === next.key ? prev : next;
      });
      setMotionLook((prev) => {
        const next = motionState(runtime);
        return !prev === !next && prev?.active === next?.active && prev?.needsPermission === next?.needsPermission ? prev : next;
      });
    }, 125);
    return () => clearInterval(id);
  }, [runtime]);
  if (!s) return null;
  const w = runtime.airportWatch;
  const fig = binocularFigure(layout, vp.w, vp.h, insets);
  const lock = s.lock;
  const status = s.status;
  const statusText = status === 'lock' ? 'Locked' : status === 'acquire' ? 'Acquiring' : status === 'lost' ? 'Signal lost' : status === 'free' ? 'Free look' : 'Searching';
  const readouts = !observatory || observatory.readouts;
  const line = notice || motionNote;
  const vars = fig && {
    '--bino-top': `${Math.max(0, fig.top).toFixed(1)}px`,
    '--bino-bottom': `${Math.max(0, vp.h - fig.bottom).toFixed(1)}px`,
    '--bino-left': `${Math.max(0, fig.left).toFixed(1)}px`,
    '--bino-right': `${Math.max(0, vp.w - fig.right).toFixed(1)}px`,
  };
  // Motion look: enable() is called from the tap itself (iOS asks for the
  // permission only inside a user gesture; FLY_LOUNGE_MOBILE.md contract 3).
  const toggleMotion = () => {
    const m = runtime.airportWatch?.motionLook;
    if (!m) return;
    setMotionNote('');
    if (m.active) {
      m.disable();
      haptic('tick');
      setMotionLook(motionState(runtime));
      return;
    }
    Promise.resolve(m.enable()).then(
      (ok) => {
        setMotionLook(motionState(runtime));
        if (ok) haptic('select');
        else setMotionNote('Motion look needs permission to read the phone’s orientation.');
      },
      () => setMotionNote('Motion look is not available on this device.'),
    );
  };
  const ident = (
    <div className="bp-ident" data-testid="binocular-ident" aria-live="polite">
      <span className="bp-status">
        <i aria-hidden="true" />
        {statusText}
      </span>
      {lock && (
        <span className="bp-callsign">
          <strong>{lock.label}</strong>
          <small>{lock.type}</small>
        </span>
      )}
    </div>
  );
  const figures = readouts && lock && (
    <div className="bino-readout bp-figures" data-testid="binocular-readout">
      {lock.figures.map(([k, v, u]) => (
        <span key={k}>
          <small>{k}</small>
          <b>{v}</b>
          <em>{u}</em>
        </span>
      ))}
    </div>
  );
  // The notice, or the hint. Portrait: a line of the top band (two at most),
  // in the place the figures take — so with the figures up it floats over
  // the foot of the glass instead, as it always does in landscape, whose
  // columns have no width for a sentence: clear of the centre either way.
  const floats = !!line && (layout === 'landscape' || !!figures);
  const lineEl = line && !floats ? (
    <p className="bp-notice" data-testid="binocular-notice" aria-live="polite">
      {line}
    </p>
  ) : !lock && !line ? (
    <p className="bp-hint">Drag to search · tap an aircraft to lock on</p>
  ) : null;
  const floatNotice = floats && (
    <p className="bp-float-notice" data-testid="binocular-notice" data-lounge-avoid="" aria-live="polite">
      {line}
    </p>
  );
  const mag = <span className="bp-mag" data-testid="binocular-mag">{s.mag}</span>;
  const lower = (
    <button type="button" className="bp-round bp-lower" data-testid="binocular-lower" onClick={() => { haptic('lower'); w?.binoculars(false); }} aria-label="Lower the binoculars">
      <ChevronsDown size={20} aria-hidden="true" />
      <span>Lower</span>
    </button>
  );
  // The instruments' Readouts switch (the pier room), always labelled: a
  // round beside the wheel in portrait; in landscape a round in the right
  // column's side slot, or a chip across that column (above Lower) when
  // motion look holds the slot.
  const readoutsButton = (chip) => observatory && (
    <button type="button" className={chip ? 'bp-chip' : 'bp-round'} data-testid="binocular-readouts" aria-pressed={observatory.readouts} onClick={() => w?.observatory?.setReadouts(!observatory.readouts)} aria-label={observatory.readouts ? 'Hide the readouts' : 'Show the readouts'}>
      <Gauge size={chip ? 16 : 19} aria-hidden="true" />
      <span>Readouts</span>
    </button>
  );
  const motionButton = motionLook && (
    <button type="button" className="bp-round bp-motion" data-testid="binocular-motion" aria-pressed={motionLook.active} onClick={toggleMotion} aria-label={motionLook.active ? 'Turn motion look off' : 'Look by moving the phone'}>
      <Smartphone size={19} aria-hidden="true" />
      <span>{motionLook.active ? 'Motion on' : 'Motion'}</span>
    </button>
  );
  const spacer = <span className="bp-round bp-spacer" aria-hidden="true" />;
  const side = (observatory ? 1 : 0) + (motionLook ? 1 : 0);
  return (
    <motion.div className="bino-hud bino-phone" data-layout={layout} data-testid="binocular-view" data-status={status} style={vars || undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {layout === 'landscape' ? (
        <>
          <div className="bp-col bp-col-left" data-lounge-avoid="">
            <div className="bp-tape-row">
              <span className="bp-elv">ELV <b ref={elv} /></span>
            </div>
            <BearingTape runtime={runtime} elvRef={elv} />
            {ident}
            {lineEl}
            {figures}
          </div>
          <div className="bp-col bp-col-right" data-lounge-avoid="">
            {mag}
            <FocusWheel runtime={runtime} axis="y" />
            {motionLook && readoutsButton(true)}
            <div className="bp-col-actions">
              {lower}
              {motionButton || readoutsButton(false) || spacer}
            </div>
          </div>
          {floatNotice}
        </>
      ) : (
        <>
          <div className="bp-top" data-lounge-avoid="">
            <div className="bp-tape-row">
              <span className="bp-elv">ELV <b ref={elv} /></span>
              <BearingTape runtime={runtime} elvRef={elv} />
              {mag}
            </div>
            {ident}
            {lineEl}
            {figures}
          </div>
          {floatNotice}
          <div className="bp-bottom" data-lounge-avoid="">
            <div className="bp-controls" data-side={side}>
              {lower}
              <FocusWheel runtime={runtime} axis="x" />
              {readoutsButton(false)}
              {motionButton}
              {!side && spacer}
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

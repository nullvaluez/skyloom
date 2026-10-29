'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Footprints } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { MOBILE_TOUCH } from '@/lib/fly/observation-config';
import { stickVector } from '@/lib/fly/lounge/touch-stick.mjs';
import { haptic } from '@/lib/fly/lounge/haptics';
import { prefersReducedMotion } from '@/lib/fly/airport-watch-camera.mjs';
import './lounge-touch.css';

/*
 * LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md; the TOUCH stream owns this file) — the
 * touch-only controls that live over the lounge view: the walk stick.
 * Mounted once by LoungeHud (the GLASS stream's file) right after the look
 * surface; `blocked` is true while a sheet or panel covers the thumb zone.
 *
 * STANDING: a floating thumbstick. The lower-left thumb zone (above the
 * --lounge-stick-bottom line the HUD publishes, so the dock and the home
 * indicator stay theirs) answers a thumb anywhere in it: the stick's base
 * appears under the thumb and the knob follows it (analog speed,
 * lib/fly/lounge/touch-stick.mjs; past MOBILE_TOUCH.stick.runAt it runs,
 * the ring turning amber with a RUN tag and one tap of the motor). Lifting
 * stops the walk; the other thumb looks around on the glass at the same
 * time (each touch belongs to the element it landed on). A tap in the zone
 * that never became a push is handed to the look surface ('lounge-touch-tap'),
 * so a chair or an aircraft under the zone is still a tap away. At rest the
 * base waits as a faint ring at the zone's corner.
 *
 * SEATED: a small "Walk" ring in the same corner (the only part that takes a
 * touch, so the seated view keeps the whole glass). Pushing it stands you up
 * and walks (the move keys' rule: lib/fly/lounge-walk-runtime.js); a tap
 * just stands you up.
 *
 * Nothing renders on a non-touch device or without LOUNGE_WALK. The stick
 * hides while `blocked`, while the binoculars are up, while the auto
 * director has the view, while a lounge panel covers it, during a seat
 * glide, and before the floor is validated; a thumb already pushing keeps it
 * through the stand-up glide, and anything else that hides it mid-push
 * releases the walk at once.
 */
const STICK = MOBILE_TOUCH.stick;
const TAP = MOBILE_TOUCH.gesture;
const covered = (s) => !!(s.inspectHex || s.airportBrowserOpen || s.atlasOpen || s.logbookOpen || s.phase === 'paused');

export function LoungeTouchControls({ runtime, watch, blocked = false }) {
  const { isTouch } = useDeviceLayout();
  const panel = useFlyStore(covered);
  // null at rest; 'standing' (the floating stick) or 'seated' (the Walk ring pushed).
  const [active, setActive] = useState(null);
  const [running, setRunning] = useState(false);
  const rootRef = useRef(null);
  const zoneRef = useRef(null);
  const stickRef = useRef(null);
  const knobRef = useRef(null);
  const press = useRef(null); // { id, ox, oy, t, travel, run, seated }
  const out = useRef({});
  const [reduced] = useState(prefersReducedMotion);

  const seated = watch?.posture === 'seated';
  const ready = isTouch && !!watch?.walk && !!watch?.validated;
  const allowed = ready && !blocked && !watch?.binocular && !watch?.auto && !watch?.seatMenu && !panel;
  // A thumb already on the stick carries it through the stand-up glide.
  const show = allowed && (watch?.posture !== 'gliding' || active);

  const send = useCallback((forward, right, run) => {
    runtime.airportWatch?.setMoveAnalog?.(forward, right, run);
  }, [runtime]);

  const release = useCallback((asTap) => {
    const p = press.current;
    press.current = null;
    setActive(null);
    setRunning(false);
    if (knobRef.current) knobRef.current.style.transform = '';
    if (stickRef.current) {
      stickRef.current.style.left = '';
      stickRef.current.style.top = '';
    }
    send(0, 0, false);
    if (!p || !asTap) return;
    if (p.seated) runtime.airportWatch?.stand?.();
    else {
      // A tap, not a push: the glass under it gets it (select, sit, décor).
      const surface = rootRef.current?.closest('.lounge')?.querySelector('.lounge-surface');
      surface?.dispatchEvent(new CustomEvent('lounge-touch-tap', { detail: { x: p.ox, y: p.oy } }));
    }
  }, [runtime, send]);

  // Hidden mid-push (a panel, the binoculars, the director): the walk stops now.
  useEffect(() => {
    if (!show && press.current) release(false);
  }, [show, release]);
  useEffect(() => () => {
    if (press.current) runtime.airportWatch?.setMoveAnalog?.(0, 0, false);
  }, [runtime]);
  // A thumb on the stick never scrolls or bounces the page (touch-action
  // covers most browsers; a non-passive touchmove covers the rest).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const hold = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  }, [ready]);

  if (!ready) return null;

  const begin = (e, seatedPush) => {
    if (e.pointerType !== 'touch' || press.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // The walk reads the thumb's travel from where it landed (the seated
    // ring: from its centre), so every push starts at rest.
    let ox = e.clientX, oy = e.clientY;
    if (seatedPush) {
      const r = e.currentTarget.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
    }
    // The base ring is drawn there, kept wholly inside the thumb zone (never
    // over the dock line, never past the left inset); the knob then shows
    // the thumb's travel from its centre.
    const root = rootRef.current?.getBoundingClientRect(), zone = zoneRef.current?.getBoundingClientRect();
    if (root && zone && stickRef.current) {
      const half = STICK.ringPx / 2;
      const inset = parseFloat(getComputedStyle(rootRef.current).getPropertyValue('--lounge-stick-left')) || 20;
      const fit = (v, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), v));
      const bx = fit(ox, Math.max(zone.left, root.left + inset) + half, zone.right - half);
      const by = fit(oy, zone.top + half, zone.bottom - half);
      stickRef.current.style.left = `${bx - root.left}px`;
      stickRef.current.style.top = `${by - root.top}px`;
    }
    press.current = { id: e.pointerId, ox, oy, x0: e.clientX, y0: e.clientY, t: e.timeStamp, travel: 0, run: false, seated: seatedPush };
    setActive(seatedPush ? 'seated' : 'standing');
    move(e);
  };
  const move = (e) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    p.travel = Math.max(p.travel, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
    const v = stickVector(e.clientX - p.ox, e.clientY - p.oy, p.run, STICK, out.current);
    if (knobRef.current) knobRef.current.style.transform = `translate(${v.kx.toFixed(1)}px, ${v.ky.toFixed(1)}px)`;
    // A seated ring only stands you up once the thumb really pushes.
    if (p.seated && p.travel < TAP.slopPx) return;
    if (v.run !== p.run) {
      p.run = v.run;
      setRunning(v.run);
      if (v.run) haptic('tick');
    }
    send(v.forward, v.right, v.run);
  };
  const end = (e) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    const tap = e.type === 'pointerup' && p.travel < TAP.slopPx && e.timeStamp - p.t <= TAP.tapMs;
    release(tap);
  };
  const handlers = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu: (e) => e.preventDefault(),
  };

  const state = running ? 'run' : active ? 'active' : 'rest';
  // The seated "Walk" ring: seated and at rest (a push turns it into the stick
  // and keeps its handlers through the stand-up; the stick's handlers ignore
  // any pointer but the one pushing).
  const seatedRing = seated && !active;
  return (
    <div ref={rootRef} className="lounge-touch" data-testid="lounge-touch" data-show={show ? '1' : '0'} data-reduced={reduced ? '1' : undefined}>
      {show && (
        // Seated, the zone only measures (the Walk ring alone takes a touch).
        <div
          ref={zoneRef}
          className="lounge-stick-zone"
          data-testid={seated || active === 'seated' ? undefined : 'lounge-stick-zone'}
          data-passive={seated || active === 'seated' ? '1' : undefined}
          aria-label={seated ? undefined : 'Walk: put your thumb here and push'}
          onPointerDown={seated || active === 'seated' ? undefined : (e) => begin(e, false)}
          {...handlers}
        />
      )}
      {show && (
        <div
          ref={stickRef}
          className="lounge-stick"
          data-testid="lounge-stick"
          data-mode={seatedRing ? 'seated' : 'standing'}
          data-state={state}
          data-pushed={active === 'seated' ? '1' : undefined}
          aria-hidden={seatedRing ? undefined : 'true'}
          role={seatedRing ? 'button' : undefined}
          aria-label={seatedRing ? 'Walk: push to stand up and walk' : undefined}
          onPointerDown={seatedRing ? (e) => begin(e, true) : undefined}
          {...handlers}
        >
          <span className="lounge-stick-ring" />
          <span ref={knobRef} className="lounge-stick-knob">
            <Footprints size={seatedRing ? 16 : 18} strokeWidth={2} aria-hidden="true" />
          </span>
          {seatedRing && <span className="lounge-stick-label">Walk</span>}
          <span className="lounge-stick-run" aria-hidden="true">Run</span>
        </div>
      )}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Footprints } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { MOBILE_TOUCH } from '@/lib/fly/observation-config';
import { stickVector } from '@/lib/fly/lounge/touch-stick.mjs';
import { pinchPair } from '@/lib/fly/lounge/touch-gestures.mjs';
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
 * the ring turning amber with a RUN tag and one tap of the motor). The thumb
 * walks only once it has moved MOBILE_TOUCH.gesture.slopPx on its own. Lifting
 * stops the walk; the other thumb looks around on the glass at the same
 * time (each touch belongs to the element it landed on). A tap in the zone
 * that never became a push is handed to the look surface ('lounge-touch-tap'),
 * so a chair or an aircraft under the zone is still a tap away. At rest the
 * base waits as a faint ring at the zone's corner.
 *
 * A PINCH may start in the zone (an aircraft taxiing low on the left): two
 * fingers landing together, the first still (pinchPair), are the glass's. A
 * still thumb here is handed over when a finger lands on the glass
 * ('lounge-touch-claim', from LoungeSurface) or a second one lands in the
 * zone, and a finger landing here pairs with a still one on the glass (it
 * asks: 'lounge-touch-relay' kind 'ask'). From then on the zone RELAYS those
 * fingers to the surface's recognizer ('lounge-touch-relay' down / move / up /
 * cancel): each touch's events arrive where it landed, so the zone stays
 * mounted while it relays, even once the stick hides (the pinch raised the
 * binoculars). A thumb already walking keeps the stick, and a second finger
 * in the zone then looks, as one on the glass does.
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
  // The zone relays fingers to the glass (see the header): it stays mounted.
  const [relaying, setRelaying] = useState(false);
  const rootRef = useRef(null);
  const zoneRef = useRef(null);
  const stickRef = useRef(null);
  const knobRef = useRef(null);
  const glassRef = useRef(null); // the look surface the relays go to
  // The stick's own touch: { id, ox, oy, x0, y0, x, y, t, tl, travel, run, seated, still }.
  const press = useRef(null);
  const relay = useRef(new Set()); // zone fingers relayed to the glass
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

  /** The look surface (kept once found, so a relay still reaches it while the controls unmount). */
  const glass = useCallback(() => {
    if (glassRef.current?.isConnected) return glassRef.current;
    glassRef.current = rootRef.current?.closest('.lounge')?.querySelector('.lounge-surface') ?? null;
    return glassRef.current;
  }, []);
  const toGlass = useCallback((detail) => {
    glass()?.dispatchEvent(new CustomEvent('lounge-touch-relay', { detail }));
    return detail;
  }, [glass]);

  const resetStick = useCallback(() => {
    setActive(null);
    setRunning(false);
    if (knobRef.current) knobRef.current.style.transform = '';
    if (stickRef.current) {
      stickRef.current.style.left = '';
      stickRef.current.style.top = '';
    }
  }, []);

  const release = useCallback((asTap) => {
    const p = press.current;
    press.current = null;
    resetStick();
    send(0, 0, false);
    if (!p || !asTap) return;
    if (p.seated) runtime.airportWatch?.stand?.();
    else {
      // A tap, not a push: the glass under it gets it (select, sit, décor).
      glass()?.dispatchEvent(new CustomEvent('lounge-touch-tap', { detail: { x: p.ox, y: p.oy } }));
    }
  }, [runtime, send, glass, resetStick]);

  /** From now on this zone finger is the glass's (it landed at x, y at t). */
  const relayStart = useCallback((id, x, y, t) => {
    relay.current.add(id);
    setRelaying(true);
    toGlass({ kind: 'down', id, x, y, t });
  }, [toGlass]);
  /** A relayed finger lifted ('up') or was taken away ('cancel'); false if it was not relayed. */
  const relayEnd = useCallback((id, kind, x, y, t) => {
    if (!relay.current.delete(id)) return false;
    toGlass({ kind, id, x, y, t });
    if (!relay.current.size) setRelaying(false);
    return true;
  }, [toGlass]);
  /** The still thumb on the stick is the first finger of a pinch: hand it to the glass. */
  const handOver = useCallback(() => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    resetStick();
    send(0, 0, false); // a still thumb never walked; this only re-asserts it
    relayStart(p.id, p.x0, p.y0, p.t);
    if (p.x !== p.x0 || p.y !== p.y0) toGlass({ kind: 'move', id: p.id, x: p.x, y: p.y, t: p.tl });
  }, [send, resetStick, relayStart, toGlass]);

  // Hidden mid-push (a panel, the binoculars, the director): the walk stops now.
  useEffect(() => {
    if (!show && press.current) release(false);
  }, [show, release]);
  // Gone (the lounge left, the walk detached): a relayed finger ends there too.
  const cancelRelays = useCallback(() => {
    for (const id of [...relay.current]) relayEnd(id, 'cancel', NaN, NaN, 0);
  }, [relayEnd]);
  useEffect(() => {
    if (!ready) cancelRelays();
  }, [ready, cancelRelays]);
  useEffect(() => () => {
    if (press.current) runtime.airportWatch?.setMoveAnalog?.(0, 0, false);
    cancelRelays();
  }, [runtime, cancelRelays]);
  // A thumb on the stick never scrolls or bounces the page (touch-action
  // covers most browsers; a non-passive touchmove covers the rest). A finger
  // landing on the glass claims a still thumb as its pinch's first finger.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const hold = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    const claim = (e) => {
      const p = press.current;
      if (p && !p.seated && pinchPair({ still: p.still, t0: p.t }, e.detail?.t)) handOver();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    el.addEventListener('lounge-touch-claim', claim);
    return () => {
      el.removeEventListener('touchmove', hold);
      el.removeEventListener('lounge-touch-claim', claim);
    };
  }, [ready, handOver]);

  if (!ready) return null;

  const stamp = (ev) => (ev.timeStamp > 0 ? ev.timeStamp : performance.now());
  const begin = (e, seatedPush) => {
    if (e.pointerType !== 'touch') return;
    if (seatedPush && press.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const t = stamp(e);
    if (!seatedPush) {
      // Whose finger is it? A thumb already here: a still one and this are a
      // pinch (both the glass's), else this one looks. The zone only relaying
      // (the stick hid mid-gesture), or one still finger on the glass a
      // moment ago (it asks): the glass's. Otherwise it may become the stick.
      const p = press.current;
      if (p) {
        if (!p.seated && pinchPair({ still: p.still, t0: p.t }, t)) handOver();
        relayStart(e.pointerId, e.clientX, e.clientY, t);
        return;
      }
      if (!show || seated || toGlass({ kind: 'ask', t, pairable: false }).pairable) {
        relayStart(e.pointerId, e.clientX, e.clientY, t);
        return;
      }
    }
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
    press.current = { id: e.pointerId, ox, oy, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t, tl: t, travel: 0, run: false, seated: seatedPush, still: true };
    setActive(seatedPush ? 'seated' : 'standing');
    move(e);
  };
  const move = (e) => {
    if (relay.current.has(e.pointerId)) {
      // Coalesced samples keep a flick's true release velocity on the glass too.
      const list = e.nativeEvent?.getCoalescedEvents?.() || [];
      for (const ev of list.length ? list : [e]) toGlass({ kind: 'move', id: e.pointerId, x: ev.clientX, y: ev.clientY, t: stamp(ev) });
      return;
    }
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    p.x = e.clientX;
    p.y = e.clientY;
    p.tl = stamp(e);
    p.travel = Math.max(p.travel, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
    const v = stickVector(e.clientX - p.ox, e.clientY - p.oy, p.run, STICK, out.current);
    if (knobRef.current) knobRef.current.style.transform = `translate(${v.kx.toFixed(1)}px, ${v.ky.toFixed(1)}px)`;
    // Still until the thumb really pushes (a tap; a pinch's first finger,
    // handed over; the seated ring standing you up only on a push): then it walks.
    if (p.travel < TAP.slopPx) return;
    p.still = false;
    if (v.run !== p.run) {
      p.run = v.run;
      setRunning(v.run);
      if (v.run) haptic('tick');
    }
    send(v.forward, v.right, v.run);
  };
  const end = (e) => {
    if (relayEnd(e.pointerId, e.type === 'pointerup' ? 'up' : 'cancel', e.clientX, e.clientY, stamp(e))) return;
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    const tap = e.type === 'pointerup' && p.travel < TAP.slopPx && stamp(e) - p.t <= TAP.tapMs;
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
  // Seated, the zone only measures (the Walk ring alone takes a touch),
  // unless it is relaying: then it keeps taking its fingers.
  const passive = !relaying && (seated || active === 'seated');
  return (
    <div ref={rootRef} className="lounge-touch" data-testid="lounge-touch" data-show={show ? '1' : '0'} data-reduced={reduced ? '1' : undefined}>
      {(show || relaying) && (
        <div
          ref={zoneRef}
          className="lounge-stick-zone"
          data-testid={!show || seated || active === 'seated' ? undefined : 'lounge-stick-zone'}
          data-passive={passive ? '1' : undefined}
          data-relay={relaying ? '1' : undefined}
          aria-label={seated || !show ? undefined : 'Walk: put your thumb here and push'}
          onPointerDown={passive ? undefined : (e) => begin(e, false)}
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

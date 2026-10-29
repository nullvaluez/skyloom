'use client';
/* eslint-disable react-hooks/immutability -- the picker is the overlay's imperative per-frame bus. */
import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { VIEW, MOBILE_TOUCH } from '@/lib/fly/observation-config';
import { pickRadius, touchPickRadius } from '@/lib/fly/airport-watch-camera.mjs';
import { decorTurn, inspectKeyAction } from '@/lib/fly/lounge/lounge-life.mjs';
import { createTouchGestures } from '@/lib/fly/lounge/touch-gestures.mjs';
import { haptic } from '@/lib/fly/lounge/haptics';
import { isMobileGraphicsClass } from '@/lib/fly/device-class';

/*
 * The full-screen look surface under the lounge HUD. It owns the pointer:
 *  - a press that moves < VIEW.pick.clickMovePx and lifts within clickMs is a
 *    CLICK: it selects the projected aircraft nearest the pointer inside a
 *    radius that grows with magnification (plus the aircraft's own size);
 *  - anything else is a LOOK drag (grab the view; gain from the live field of
 *    view) that ends in a short glide;
 *  - a second click within doubleMs on the same spot raises the binoculars
 *    on the aircraft the first click picked;
 *  - the wheel zooms 1x-25x toward the pointer.
 * And, while the lounge is up, the lounge keys (capture phase, so the flight
 * input never sees them): B binoculars, Esc lowers / deselects, arrows look,
 * +/- and 1/2/3 magnification, F follow, R face the runway, T details,
 * Q/E cycle visible aircraft.
 *
 * WALKING (LOUNGE_WALK, while watch.walk is attached): W/A/S/D are held move
 * keys and Shift runs (they are always consumed here, so input.keys never
 * holds them, even with a panel open, and a panel opening releases them);
 * Enter sits at the Sit prompt (not when it is pressed on another control);
 * V opens the seat menu, and Esc closes it before anything else (both only
 * while the menu can be seen: the binoculars hide it). A click that hits
 * no aircraft sits in the vantage chair under the pointer. There is no
 * pointer lock: the cursor stays the picker, and drag still looks.
 *
 * THE PIER ROOM (LOUNGE_PIER): Enter opens the card of the décor on offer
 * when no chair or instrument claims it, Enter or Esc closes an open card
 * first (lib/fly/lounge/lounge-life.mjs inspectKeyAction), and the arrows
 * move between the rows of the seat menu while it is grouped by floor.
 *
 * THE DIRECTOR (Play Pass, LOUNGE_DIRECTOR; watch.director): N watches the
 * next movement, H toggles "Watch for me". While the auto director has the
 * view any other key takes it back (and still does its own job), except Esc,
 * which only takes it back. Without the flag there is no watch.director and
 * neither key is handled.
 *
 * TOUCH (LOUNGE MOBILE; FLY_LOUNGE_MOBILE.md "Gestures"). A pointer whose
 * pointerType is 'touch' never reaches the mouse path above: its samples go
 * to the recognizer (lib/fly/lounge/touch-gestures.mjs) and its intents to
 * the runtime. One finger grabs the view (the world under it stays under
 * it), two pinch about their midpoint (zoom follows the finger gap; past
 * VIEW.optics.binocularAt the binoculars come up, the wheel's semantics) and
 * pan by it; a tap is the click (aircraft, chair, décor, station), with a
 * fingertip's pick radius; a double-tap raises the binoculars on the tapped
 * aircraft or where you look, and lowers them on empty glass; a still
 * long-press on an aircraft opens its details (the T key). The walk stick
 * (LoungeTouchControls) hands its taps here ('lounge-touch-tap'), so a tap in
 * the thumb zone still selects and sits. On a touch device the surface also
 * owns the iOS gestures a lounge must not have: WebKit's page pinch
 * (gesturestart / gesturechange), the scroll and overscroll of a dragged
 * finger (non-passive touchmove) and the long-press callout (lounge-touch.css).
 * The mouse, the pen and the keys above are untouched.
 */
const MOVE_KEYS = { w: 'forward', s: 'back', a: 'left', d: 'right' };
// Keys that never take the view back from the auto director on their own.
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

const isTyping = (el) => {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
};
/** Enter on a focused control belongs to that control (a seat row, a board row, the Sit prompt itself). */
const isControl = (el) => !!el?.closest?.('button, a[href], [role="button"], [role="dialog"], summary');
/** A panel covers the lounge: walking waits. */
const covered = (s) => !!(s.inspectHex || s.airportBrowserOpen || s.atlasOpen || s.logbookOpen || s.phase === 'paused');

/**
 * Nearest projected aircraft to (x, y) within the zoom-aware pick radius
 * (`radius`: the mouse's pickRadius; a finger passes touchPickRadius).
 */
export function pickAt(picker, x, y, mag, radius = pickRadius) {
  let best = null, bestD = Infinity;
  const base = radius(mag);
  for (const hit of picker.hits) {
    const d = Math.hypot(hit.sx - x, hit.sy - y);
    if (d <= base + hit.half && d < bestD) {
      bestD = d;
      best = hit;
    }
  }
  return best;
}

export function LoungeSurface({ runtime, picker, onNotice }) {
  const ref = useRef(null);
  const press = useRef(null);
  const lastClick = useRef(null);
  // Touch (LOUNGE MOBILE): the recognizer, its long-press timer, the
  // pinch's starting midpoint, and the last single tap (its aircraft, or
  // whether it already did something: sat, opened a card, used a station).
  const gestures = useRef(null);
  const holdTimer = useRef(0);
  const holdDue = useRef(null);
  const pinchMid = useRef(null);
  const lastTap = useRef(null);

  useEffect(() => {
    const el = ref.current;
    picker.surface = el;
    return () => {
      if (picker.surface === el) picker.surface = null;
    };
  }, [picker]);

  // Lounge keys. Capture phase on window: they work wherever focus is, and a
  // handled key never reaches the flight input or FlyMode's Escape chain.
  useEffect(() => {
    const held = { left: false, right: false, up: false, down: false };
    const syncKeys = () => runtime.airportWatch?.setLookKeys((held.right ? 1 : 0) - (held.left ? 1 : 0), (held.up ? 1 : 0) - (held.down ? 1 : 0));
    const arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    // Walking: held move keys and Shift (LOUNGE_WALK).
    const move = { forward: false, back: false, left: false, right: false, run: false };
    const syncMove = () => runtime.airportWatch?.setMoveKeys((move.forward ? 1 : 0) - (move.back ? 1 : 0), (move.right ? 1 : 0) - (move.left ? 1 : 0), move.run);
    const releaseMove = () => {
      const any = move.forward || move.back || move.left || move.right || move.run;
      move.forward = move.back = move.left = move.right = move.run = false;
      if (any) syncMove();
    };
    const consume = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (e) => {
      const w = runtime.airportWatch;
      // A range owns arrows and movement keys while focused, but Escape still
      // follows the lounge's overlay/optics hierarchy.
      if (!w?.active || e.metaKey || e.ctrlKey || e.altKey || (isTyping(e.target) && e.key !== 'Escape')) return;
      const s = useFlyStore.getState();
      const lower = e.key.toLowerCase();
      if (w.director?.auto && lower !== 'h' && !MODIFIERS.has(e.key)) {
        w.director.handBack();
        if (e.key === 'Escape') {
          consume(e);
          return;
        }
      }
      const walkKey = !!w.walk && (MOVE_KEYS[lower] || e.key === 'Shift');
      // Focus inside an instrument belongs to its controls. A movement key
      // must not silently release the instrument (or let the next Escape
      // clear the aircraft selection). Arrow defaults can still scroll it.
      if (e.target?.closest?.('[data-overlay="observatory"]') && (walkKey || arrows[e.key])) {
        releaseMove();
        e.stopPropagation();
        if (walkKey) e.preventDefault();
        return;
      }
      // The grouped seat menu (pier) moves its own focus with the arrows: let
      // them reach it (the lounge section keeps them from the flight input).
      if (arrows[e.key] && e.target?.closest?.('.lounge-seat-menu[data-grouped]')) return;
      if (covered(s)) {
        // A panel is up: walking waits, but its keys never reach the flight input.
        if (walkKey) {
          releaseMove();
          consume(e);
        }
        return;
      }
      if (walkKey) {
        if (MOVE_KEYS[lower]) move[MOVE_KEYS[lower]] = true;
        move.run = e.shiftKey || e.key === 'Shift';
        if (!e.repeat) syncMove();
        consume(e);
        return;
      }
      const key = e.key;
      let handled = true;
      if (arrows[key]) {
        held[arrows[key]] = true;
        syncKeys();
      } else if (e.repeat) {
        handled = key.length === 1 && 'bfrtqe123+=-'.includes(key.toLowerCase());
      } else {
        switch (key.toLowerCase()) {
          case 'i':
            if (!w.observatory) handled = false;
            else if (w.observatory.snapshot().active) w.observatory.release();
            else if (!w.binocular) w.observatory.activate('airport-table', { remote: true });
            break;
          case 'b':
            w.binoculars();
            break;
          case 'n':
            if (!w.director) handled = false;
            else {
              // Flight's N (the Nearby scope, components/fly/hud/EncounterExperience.jsx)
              // hears this key first and toggles its hidden scope, which would then
              // swallow the next Esc: in the lounge N is ours, so it stays closed.
              if (useEncounterStore.getState().nearbyOpen) useEncounterStore.getState().setNearbyOpen(false);
              if (!w.director.watchNext()) onNotice?.('Nothing is lined up to land or take off yet.');
            }
            break;
          case 'h':
            if (!w.director) handled = false;
            else w.director.toggleAuto();
            break;
          case 'v':
            if (!w.walk) handled = false;
            else if (!w.binocular) w.seatMenuOpen(); // hidden behind the glasses: nothing to toggle
            break;
          case 'enter': {
            const decor = inspectKeyAction('Enter', { open: !!w.walk?.inspecting, offer: w.walk?.inspectOffer, onControl: isControl(e.target), blocked: !decorTurn(w, w.observatory?.snapshot() ?? null) });
            if (w.walk?.inspecting) {
              if (decor === 'close') w.walk.closeInspect();
              else handled = false; // a control in the card answers Enter itself
            } else if (w.observatory?.snapshot().prompt && !w.binocular && !w.seatMenu && !isControl(e.target)) w.observatory.activate(w.observatory.snapshot().prompt.id);
            else if (w.walk && w.sitPrompt && w.posture === 'standing' && !w.binocular && !w.seatMenu && !isControl(e.target)) w.sit(w.sitPrompt.id);
            else if (decor === 'open') w.walk.openInspect(w.walk.inspectOffer.id);
            else handled = false;
            break;
          }
          case 'escape':
            if (inspectKeyAction('Escape', { open: !!w.walk?.inspecting }) === 'close') w.walk.closeInspect();
            else if (w.seatMenu && !w.binocular) w.seatMenuOpen(false);
            else if (w.observatory?.snapshot().active && !w.binocular) w.observatory.release();
            else if (w.binocular) w.binoculars(false);
            else if (w.selected) w.clearSelection();
            else handled = false; // FlyMode: leave the lounge
            break;
          case '+':
          case '=':
            w.stepMagnification(1);
            break;
          case '-':
            w.stepMagnification(-1);
            break;
          case '1':
          case '2':
          case '3':
            w.setMagnification(VIEW.optics.steps[Number(key) - 1]);
            break;
          case 'f':
            if (w.selected) w.track();
            else onNotice?.('Select an aircraft to follow it.');
            break;
          case 'r':
            w.resetLook();
            break;
          case 't':
            if (w.selected) s.setInspectHex(w.selected);
            break;
          case 'q':
          case 'e': {
            // Cycle through the aircraft in view, left to right.
            const order = picker.hits.filter((h) => h.onScreen).sort((a, b) => a.sx - b.sx);
            if (!order.length) break;
            const i = order.findIndex((h) => h.hex === w.selected);
            const next = order[(i < 0 ? 0 : i + (key.toLowerCase() === 'e' ? 1 : -1) + order.length) % order.length];
            w.select(next.hex);
            break;
          }
          default:
            handled = false;
        }
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onUp = (e) => {
      const lower = e.key.toLowerCase();
      if (MOVE_KEYS[lower] || e.key === 'Shift') {
        const was = move[MOVE_KEYS[lower]] || (e.key === 'Shift' && move.run);
        if (MOVE_KEYS[lower]) move[MOVE_KEYS[lower]] = false;
        if (e.key === 'Shift') move.run = false;
        if (was) {
          syncMove();
          consume(e);
        }
        return;
      }
      if (!arrows[e.key]) return;
      held[arrows[e.key]] = false;
      syncKeys();
    };
    const onBlur = () => {
      held.left = held.right = held.up = held.down = false;
      syncKeys();
      releaseMove();
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    // A panel opening mid-stride stops the walk at once (its keys then go to the panel).
    const unsubscribe = useFlyStore.subscribe((s) => {
      if (covered(s)) releaseMove();
    });
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
      runtime.airportWatch?.setLookKeys(0, 0);
      runtime.airportWatch?.setMoveKeys(0, 0, false);
    };
  }, [runtime, picker, onNotice]);

  // --- touch ------------------------------------------------------------------
  const ndc = (x, y) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return { u: ((x - rect.left) / rect.width) * 2 - 1, v: 1 - ((y - rect.top) / rect.height) * 2, h: rect.height };
  };
  /** A single tap: the click (a station, an aircraft, a chair, the décor), with a fingertip's radius. */
  const touchTap = (x, y) => {
    const w = runtime.airportWatch;
    if (!w) return;
    lastTap.current = { hex: null, used: false };
    if (w.observatory && !w.binocular) {
      const p = ndc(x, y);
      const id = p && w.observatory.stationAt(p.u, p.v);
      if (id) {
        lastTap.current.used = true;
        w.observatory.activate(id);
        return;
      }
    }
    const hit = pickAt(picker, x, y, w.optics.mag, touchPickRadius);
    if (hit) {
      lastTap.current.hex = hit.hex;
      w.select(hit.hex);
      return;
    }
    if (w.walk && !w.binocular) {
      const p = ndc(x, y);
      if (!p) return;
      const seat = w.walk.seatAt(p.u, p.v);
      const decor = !seat && w.walk.decorAt?.(p.u, p.v);
      if (decor && w.walk.openInspect(decor)) lastTap.current.used = true;
      else if (seat) {
        lastTap.current.used = true;
        w.sit(seat);
      }
    }
  };
  /**
   * The second tap of a double-tap: the binoculars on the aircraft the first
   * tap picked; on empty glass they come up where you look, or, already up,
   * come down. A first tap that sat or opened something is not doubled.
   */
  const touchDoubleTap = () => {
    const w = runtime.airportWatch, prev = lastTap.current;
    lastTap.current = null;
    if (!w || prev?.used) return;
    if (prev?.hex) w.select(prev.hex, { binoculars: true });
    else w.binoculars(!w.binocular);
  };
  /** A still long-press on an aircraft: select it and open its details (the T key). */
  const touchLongPress = (x, y) => {
    const w = runtime.airportWatch;
    if (!w) return;
    const hit = pickAt(picker, x, y, w.optics.mag, touchPickRadius);
    if (!hit) return;
    w.select(hit.hex);
    useFlyStore.getState().setInspectHex(hit.hex);
    haptic('select');
  };
  const runIntents = (intents) => {
    const w = runtime.airportWatch;
    for (const it of intents) {
      if (it.type === 'tap') {
        if (it.count === 2) touchDoubleTap();
        else touchTap(it.x, it.y);
      } else if (it.type === 'long-press') touchLongPress(it.x, it.y);
      else if (!w) continue;
      else if (it.type === 'look-start' || it.type === 'look') {
        const p = ndc(it.x, it.y);
        if (!p) continue;
        if (it.type === 'look-start') w.grabStart(p.u, p.v);
        else w.grabMove(p.u, p.v);
        picker.pointer.dragging = true;
      } else if (it.type === 'look-end') {
        w.grabEnd(it.vx, it.vy, ref.current?.clientHeight || window.innerHeight);
        picker.pointer.dragging = false;
      } else if (it.type === 'pinch-start') {
        const p = ndc(it.x, it.y);
        pinchMid.current = { x: it.x, y: it.y };
        if (p) w.pinchStart(p.u, p.v);
        picker.pointer.dragging = true;
      } else if (it.type === 'pinch') {
        const p = ndc(it.x, it.y), m = pinchMid.current;
        const pan = !!m && Math.hypot(it.x - m.x, it.y - m.y) > MOBILE_TOUCH.gesture.pinchPanSlopPx;
        if (p) w.pinchTo(it.scale, p.u, p.v, { pan });
      } else if (it.type === 'pinch-end') {
        w.pinchEnd();
        pinchMid.current = null;
        picker.pointer.dragging = false;
      }
    }
  };
  /**
   * Re-arm the long-press timer from the recognizer's deadline (input time).
   * A main thread that stalled past the deadline still waits half a
   * long-press from now, so a quick tap whose lift is queued behind the
   * stall is read as the tap it was, not as a hold.
   */
  const armHold = () => {
    const due = gestures.current?.deadline() ?? null;
    if (due === holdDue.current) return; // a still finger's jitter never pushes the deadline
    clearTimeout(holdTimer.current);
    holdDue.current = due;
    if (due == null) return;
    holdTimer.current = setTimeout(() => {
      holdDue.current = null;
      if (gestures.current) runIntents(gestures.current.poll(performance.now()));
    }, Math.max(due - performance.now(), MOBILE_TOUCH.gesture.longPressMs / 2) + 4);
  };
  // The input's own clock: a busy main thread hands events over late and in
  // bursts, and a tap or a flick must be judged by when the finger moved.
  const stamp = (ev) => (ev.timeStamp > 0 ? ev.timeStamp : performance.now());
  const touch = (kind, e) => {
    gestures.current ||= createTouchGestures();
    const g = gestures.current, now = stamp(e);
    if (kind === 'down') runIntents(g.down(e.pointerId, e.clientX, e.clientY, now));
    else if (kind === 'move') {
      // Coalesced samples keep a fast flick's true release velocity.
      const list = e.nativeEvent.getCoalescedEvents?.() || [];
      for (const ev of list.length ? list : [e]) runIntents(g.move(e.pointerId, ev.clientX, ev.clientY, stamp(ev)));
    } else if (kind === 'up') runIntents(g.up(e.pointerId, e.clientX, e.clientY, now));
    else runIntents(g.cancel(e.pointerId));
    armHold();
  };

  // Touch devices only: the page itself must not pinch-zoom (WebKit's
  // gesture events), scroll or bounce under a finger on the lounge, and the
  // walk stick's taps land here.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onTap = (e) => {
      const g = (gestures.current ||= createTouchGestures());
      const { x, y } = e.detail || {};
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Through the recognizer, so a tap there can still be a double-tap's
      // second (unless a finger is on the glass: then it is a plain tap).
      if (g.count) {
        touchTap(x, y);
        return;
      }
      const t = performance.now();
      runIntents(g.down('stick-tap', x, y, t));
      runIntents(g.up('stick-tap', x, y, t));
    };
    el.addEventListener('lounge-touch-tap', onTap);
    if (!isMobileGraphicsClass()) return () => el.removeEventListener('lounge-touch-tap', onTap);
    const block = (e) => e.preventDefault();
    const blockMove = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    // A double-tap's second tap that lands on what the first one opened (the
    // spotter card rising over the aircraft just tapped) is the double's, not
    // a tap on that panel: it is taken here, before React sees it, with its
    // lift and the click it would make.
    const swallowed = new Map(); // pointerId -> { x, y }
    let swallowClick = null; // { x, y, until }
    const onDocDown = (e) => {
      if (e.pointerType !== 'touch' || el.contains(e.target) || !e.target?.closest?.('.lounge')) return;
      const intents = gestures.current?.secondTap(e.clientX, e.clientY, stamp(e)) ?? [];
      if (!intents.length) return;
      e.preventDefault();
      e.stopPropagation();
      swallowed.set(e.pointerId, { x: e.clientX, y: e.clientY });
      runIntents(intents);
    };
    const onDocUp = (e) => {
      const s = swallowed.get(e.pointerId);
      if (!s) return;
      swallowed.delete(e.pointerId);
      e.stopPropagation();
      swallowClick = { x: s.x, y: s.y, until: performance.now() + 700 };
    };
    const onDocClick = (e) => {
      if (!swallowClick || performance.now() > swallowClick.until || Math.hypot(e.clientX - swallowClick.x, e.clientY - swallowClick.y) > 40) return;
      swallowClick = null;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('pointerup', onDocUp, true);
    document.addEventListener('pointercancel', onDocUp, true);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('gesturestart', block, { passive: false });
    document.addEventListener('gesturechange', block, { passive: false });
    el.addEventListener('touchmove', blockMove, { passive: false });
    return () => {
      el.removeEventListener('lounge-touch-tap', onTap);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('pointerup', onDocUp, true);
      document.removeEventListener('pointercancel', onDocUp, true);
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
      el.removeEventListener('touchmove', blockMove);
      clearTimeout(holdTimer.current);
      holdDue.current = null;
      gestures.current?.reset();
    };
    // runIntents reads refs and the runtime; it is rebuilt each render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, picker]);

  const click = (x, y, now) => {
    const w = runtime.airportWatch;
    if (!w) return;
    const prev = lastClick.current;
    const double = prev && now - prev.t < VIEW.pick.doubleMs && Math.hypot(prev.x - x, prev.y - y) < VIEW.pick.doublePx;
    if (double) {
      lastClick.current = null;
      if (prev.hex) w.select(prev.hex, { binoculars: true });
      else w.binoculars(true);
      return;
    }
    if (w.observatory && !w.binocular) {
      const rect = ref.current?.getBoundingClientRect();
      const id = rect && w.observatory.stationAt(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
      if (id) { lastClick.current = null; w.observatory.activate(id); return; }
    }
    const hit = pickAt(picker, x, y, w.optics.mag);
    lastClick.current = { t: now, x, y, hex: hit?.hex ?? null };
    if (hit) {
      w.select(hit.hex);
      return;
    }
    // No aircraft there: a vantage chair under the pointer sits you in it
    // (LOUNGE_WALK); else the pier's décor on offer under it opens its card.
    if (w.walk && !w.binocular) {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const seat = w.walk.seatAt(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
      const decor = !seat && w.walk.decorAt?.(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
      if (decor && w.walk.openInspect(decor)) {
        lastClick.current = null; // a double-click must not raise the binoculars
        return;
      }
      if (seat) {
        lastClick.current = null; // a double-click must not raise the binoculars
        w.sit(seat);
      }
    }
  };

  return (
    <div
      ref={ref}
      className="lounge-surface"
      data-testid="lounge-surface"
      tabIndex={0}
      aria-label="Window seat. Drag to look around, scroll to zoom, click an aircraft to select it, double-click for binoculars. Arrow keys look, B raises the binoculars."
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') {
          e.currentTarget.setPointerCapture(e.pointerId);
          e.stopPropagation();
          touch('down', e);
          return;
        }
        if (e.button !== 0) return;
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), drag: false, samples: [] };
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'touch') {
          touch('move', e);
          return;
        }
        picker.pointer.x = e.clientX;
        picker.pointer.y = e.clientY;
        picker.pointer.over = true;
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const now = performance.now();
        if (!p.drag && (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= VIEW.pick.clickMovePx || now - p.t > VIEW.pick.clickMs)) {
          p.drag = true;
          picker.pointer.dragging = true;
        }
        if (!p.drag) return;
        // Coalesced events keep a fast flick's full path (high-rate mice).
        const list = e.nativeEvent.getCoalescedEvents?.() || [];
        const events = list.length ? list : [e];
        let dx = 0, dy = 0;
        for (const ev of events) {
          dx += ev.clientX - p.lx;
          dy += ev.clientY - p.ly;
          p.lx = ev.clientX;
          p.ly = ev.clientY;
        }
        runtime.airportWatch?.dragLook(dx, dy, window.innerHeight);
        p.samples.push({ x: e.clientX, y: e.clientY, t: now });
        while (p.samples.length > 2 && now - p.samples[0].t > 90) p.samples.shift();
      }}
      onPointerUp={(e) => {
        if (e.pointerType === 'touch') {
          touch('up', e);
          return;
        }
        const p = press.current;
        press.current = null;
        picker.pointer.dragging = false;
        if (!p || p.id !== e.pointerId) return;
        const now = performance.now();
        if (!p.drag && now - p.t < VIEW.pick.clickMs) {
          click(e.clientX, e.clientY, now);
          return;
        }
        // Release glide from the last ~90 ms of motion.
        const a = p.samples[0], b = p.samples.at(-1);
        if (a && b && b.t - a.t > 8 && now - b.t < 60) {
          const dt = (b.t - a.t) / 1000;
          runtime.airportWatch?.releaseLook((b.x - a.x) / dt, (b.y - a.y) / dt, window.innerHeight);
        }
      }}
      onPointerCancel={(e) => {
        if (e.pointerType === 'touch') touch('cancel', e);
      }}
      onLostPointerCapture={(e) => {
        // A touch's capture is released after its pointerup (a no-op then);
        // lost without one, the touch is over (a cancel).
        if (e.pointerType === 'touch') {
          touch('cancel', e);
          return;
        }
        press.current = null;
        picker.pointer.dragging = false;
      }}
      onPointerLeave={() => {
        picker.pointer.over = false;
      }}
      onWheel={(e) => {
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        const rect = e.currentTarget.getBoundingClientRect();
        const u = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const v = 1 - ((e.clientY - rect.top) / rect.height) * 2;
        runtime.airportWatch?.zoomAt(e.deltaY * scale, u, v);
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

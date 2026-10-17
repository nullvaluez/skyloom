'use client';
/* eslint-disable react-hooks/immutability -- the picker is the overlay's imperative per-frame bus. */
import { useEffect, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { VIEW } from '@/lib/fly/observation-config';
import { pickRadius } from '@/lib/fly/airport-watch-camera.mjs';

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
 */
const MOVE_KEYS = { w: 'forward', s: 'back', a: 'left', d: 'right' };

const isTyping = (el) => {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
};
/** Enter on a focused control belongs to that control (a seat row, a board row, the Sit prompt itself). */
const isControl = (el) => !!el?.closest?.('button, a[href], [role="button"], [role="dialog"], summary');
/** A panel covers the lounge: walking waits. */
const covered = (s) => !!(s.inspectHex || s.airportBrowserOpen || s.atlasOpen || s.logbookOpen || s.phase === 'paused');

/** Nearest projected aircraft to (x, y) within the zoom-aware pick radius. */
export function pickAt(picker, x, y, mag) {
  let best = null, bestD = Infinity;
  const base = pickRadius(mag);
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
      const walkKey = !!w.walk && (MOVE_KEYS[lower] || e.key === 'Shift');
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
          case 'v':
            if (!w.walk) handled = false;
            else if (!w.binocular) w.seatMenuOpen(); // hidden behind the glasses: nothing to toggle
            break;
          case 'enter':
            if (w.observatory?.snapshot().prompt && !w.binocular && !w.seatMenu && !isControl(e.target)) w.observatory.activate(w.observatory.snapshot().prompt.id);
            else if (w.walk && w.sitPrompt && w.posture === 'standing' && !w.binocular && !w.seatMenu && !isControl(e.target)) w.sit(w.sitPrompt.id);
            else handled = false;
            break;
          case 'escape':
            if (w.seatMenu && !w.binocular) w.seatMenuOpen(false);
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
    // No aircraft there: a vantage chair under the pointer sits you in it (LOUNGE_WALK).
    if (w.walk && !w.binocular) {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const seat = w.walk.seatAt(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
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
        if (e.button !== 0) return;
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), drag: false, samples: [] };
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
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
      onLostPointerCapture={() => {
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

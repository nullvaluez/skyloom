/**
 * LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md; the TOUCH stream) — the look surface's
 * touch gesture recognizer. Pure: no DOM, no three, no clock of its own.
 * LoungeSurface feeds it the touch pointers' samples (down / move / up /
 * cancel, CSS px and ms) and acts on the intents it returns; node feeds it
 * synthetic streams (scripts/verify-lounge-touch.mjs).
 *
 * Every call returns an array of intents (often empty):
 *   { type: 'look-start', x, y }   one finger grabs the view at (x, y): the
 *                                  world under that point follows the finger
 *   { type: 'look', x, y }         ... the finger is now at (x, y)
 *   { type: 'look-end', vx, vy }   ... lifted; the release velocity (px/s, 0
 *                                  for no glide)
 *   { type: 'pinch-start', x, y, gap }  two fingers: midpoint and finger gap
 *   { type: 'pinch', scale, x, y } ... the gap is `scale` times the start gap,
 *                                  the midpoint is at (x, y) (a two-finger pan)
 *   { type: 'pinch-end' }
 *   { type: 'tap', x, y, count }   count 2 is the second tap of a double-tap
 *                                  (the first already arrived as count 1)
 *   { type: 'long-press', x, y }   still for longPressMs (from poll())
 *
 * THE RULES (a misfire costs more on a phone than a missed gesture):
 *  - A finger is a tap only if it never moved slopPx, lifted within tapMs
 *    and no other finger touched during it. A drag, a pinch or a long-press
 *    never ends in a tap.
 *  - A tap that lands within doubleMs (from the first lift to the second
 *    touch) and doublePx of a single tap is that tap's second; a third tap
 *    starts over. Any other gesture forgets the first tap.
 *  - A long-press needs stillness: moving past slopPx first makes it a look.
 *    Once it fires, the rest of the touch does nothing (no look, no tap).
 *  - A one-finger look grabs at the TOUCH-DOWN point (crossing the slop
 *    catches the world up to the finger, as a grab should).
 *  - A second finger turns a look into a pinch (the look ends without a
 *    glide). Lifting one finger of a pinch ends the pinch, and the finger
 *    left behind re-grabs where it IS once it moves past slopPx again: no
 *    jump, no phantom tap. Fingers beyond two are ignored.
 *  - The pinch scale is the finger gap ratio (zoom follows the fingers),
 *    with both gaps floored at minGapPx so two fingers that land together
 *    do not make a violent first step.
 *  - cancel (the browser took the touch) ends whatever was running, with no
 *    tap and no glide.
 */
import { MOBILE_TOUCH } from '../observation-config.js';

const GESTURE = MOBILE_TOUCH.gesture;

export function createTouchGestures(cfg = GESTURE) {
  const fingers = new Map(); // id -> { x, y, x0, y0, t0 }
  let state = 'idle'; // idle | pending | look | pinch | after | held
  let primary = null; // the look / pending finger id
  let downT = 0;
  let gap0 = 0; // pinch: the floored start gap
  let lastTap = null; // { t (lift), x, y } of a single tap waiting for its second
  let tapCount = 1; // the count the pending tap will report
  const samples = []; // the look finger's recent { x, y, t }

  const floorGap = (g) => Math.max(cfg.minGapPx, g);
  const pair = () => {
    const [a, b] = [...fingers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, gap: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const sample = (x, y, t) => {
    samples.push({ x, y, t });
    while (samples.length > 2 && t - samples[0].t > cfg.velocityMs) samples.shift();
  };
  const velocity = (t) => {
    const a = samples[0], b = samples.at(-1);
    if (!a || !b || b.t - a.t < 8 || t - b.t > cfg.staleMs) return { vx: 0, vy: 0 };
    const dt = (b.t - a.t) / 1000;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  };
  const beginLook = (f, x, y, t, out) => {
    state = 'look';
    lastTap = null;
    samples.length = 0;
    sample(x, y, t);
    out.push({ type: 'look-start', x, y });
    if (x !== f.x || y !== f.y) {
      sample(f.x, f.y, t);
      out.push({ type: 'look', x: f.x, y: f.y });
    }
  };

  const api = {
    /** The recognizer's state (harnesses, the surface's own guards). */
    get state() { return state; },
    get count() { return fingers.size; },
    /** When poll() must next be called (the long-press), or null. */
    deadline() {
      return state === 'pending' ? downT + cfg.longPressMs : null;
    },
    down(id, x, y, t) {
      const out = [];
      if (fingers.has(id) || fingers.size >= 2) return out;
      if (fingers.size === 1 && state === 'held') return out; // a long-press owns the touch
      fingers.set(id, { x, y, x0: x, y0: y, t0: t });
      if (fingers.size === 1) {
        state = 'pending';
        primary = id;
        downT = t;
        // A second tap counts from the first's lift to this touch.
        tapCount = lastTap && t - lastTap.t <= cfg.doubleMs && Math.hypot(x - lastTap.x, y - lastTap.y) <= cfg.doublePx ? 2 : 1;
        return out;
      }
      // Two fingers: whatever one finger was doing becomes a pinch.
      if (state === 'look') out.push({ type: 'look-end', vx: 0, vy: 0 });
      state = 'pinch';
      lastTap = null;
      const p = pair();
      gap0 = floorGap(p.gap);
      out.push({ type: 'pinch-start', x: p.x, y: p.y, gap: p.gap });
      return out;
    },
    move(id, x, y, t) {
      const out = [];
      const f = fingers.get(id);
      if (!f) return out;
      f.x = x;
      f.y = y;
      if (state === 'pending' || state === 'after') {
        if (id === primary && Math.hypot(x - f.x0, y - f.y0) >= cfg.slopPx) {
          // A fresh drag grabs where the finger landed; a finger left over
          // from a pinch grabs where it is (it already moved the view).
          if (state === 'pending') beginLook(f, f.x0, f.y0, t, out);
          else beginLook(f, x, y, t, out);
        }
      } else if (state === 'look' && id === primary) {
        sample(x, y, t);
        out.push({ type: 'look', x, y });
      } else if (state === 'pinch' && fingers.size === 2) {
        const p = pair();
        out.push({ type: 'pinch', scale: floorGap(p.gap) / gap0, x: p.x, y: p.y });
      }
      return out;
    },
    up(id, x, y, t) {
      const out = [];
      const f = fingers.get(id);
      if (!f) return out;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        f.x = x;
        f.y = y;
      }
      fingers.delete(id);
      if (state === 'pending') {
        state = 'idle';
        if (t - downT <= cfg.tapMs && Math.hypot(f.x - f.x0, f.y - f.y0) < cfg.slopPx) {
          out.push({ type: 'tap', x: f.x0, y: f.y0, count: tapCount });
          lastTap = tapCount === 1 ? { t, x: f.x0, y: f.y0 } : null;
        } else lastTap = null;
      } else if (state === 'look') {
        state = 'idle';
        out.push({ type: 'look-end', ...velocity(t) });
      } else if (state === 'pinch') {
        out.push({ type: 'pinch-end' });
        const rest = [...fingers.entries()][0];
        if (rest) {
          // The finger left behind waits for slop before it looks again.
          state = 'after';
          primary = rest[0];
          rest[1].x0 = rest[1].x;
          rest[1].y0 = rest[1].y;
        } else state = 'idle';
      } else if (state === 'after' || state === 'held') {
        if (!fingers.size) state = 'idle';
      }
      if (!fingers.size) primary = null;
      return out;
    },
    /** The browser took the touch (scroll, system gesture): end it all, no tap, no glide. */
    cancel(id) {
      const out = [];
      if (!fingers.has(id)) return out;
      if (state === 'look') out.push({ type: 'look-end', vx: 0, vy: 0 });
      if (state === 'pinch') out.push({ type: 'pinch-end' });
      fingers.clear();
      state = 'idle';
      primary = null;
      lastTap = null;
      return out;
    },
    /** Time passes (the long-press). */
    poll(t) {
      const out = [];
      if (state === 'pending' && t - downT >= cfg.longPressMs) {
        const f = fingers.get(primary);
        state = 'held';
        lastTap = null;
        out.push({ type: 'long-press', x: f.x0, y: f.y0 });
      }
      return out;
    },
    /** Forget everything (the lounge closed, the surface unmounted). */
    reset() {
      fingers.clear();
      state = 'idle';
      primary = null;
      lastTap = null;
      samples.length = 0;
    },
  };
  return api;
}

'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { MOBILE_GLASS, VIEW } from '@/lib/fly/observation-config';
import { detentNear, detentsCrossed, wheelMag, wheelPx, wheelTicks } from '@/lib/fly/lounge/glass-layout.mjs';
import { prefersReducedMotion } from '@/lib/fly/airport-watch-camera.mjs';
import { haptic } from '@/lib/fly/lounge/haptics';

/*
 * LOUNGE MOBILE — GLASS: the focus wheel (the binoculars' magnification on a
 * phone). A knurled strip under a fixed index, on a log scale: drag it toward
 * the higher numbers to zoom in, continuously, the way a phone camera's zoom
 * dial works. The presets (VIEW.optics.steps: 7x, 12x, 20x) are detents — a
 * haptic tick as the finger passes one, a few pixels of magnetic hold, and a
 * release near one settles on it — and their labels are buttons: a tap goes
 * straight there. A flick glides a short way (none under reduced motion).
 *
 * The scale follows the live magnification (runtime.airportWatch.optics.mag)
 * per frame while the finger is off it, so the pinch, the presets and the
 * director's range framing all move it too. Every change goes through
 * watch.setMagnification(), whose clamp keeps the glasses up (minMag 2x).
 *
 * `axis` 'x' (portrait, under the lens: higher numbers to the right) or 'y'
 * (landscape, beside it: higher numbers above). Either way the scale moves
 * with the finger. Test ids: binocular-wheel, binocular-preset-<mag>.
 *
 * The wheel only ever turns a power it set itself: a glide (or a held drag)
 * stops the moment the glasses come down or anything else sets the power
 * (Lower, Back, a double-tap, a pinch, a preset, the director) — the
 * HUD stays mounted for its fade-out, and a glide that kept setting the power
 * would raise the glasses straight back up. Per frame it writes the scale's
 * transform and its aria value only when they change, and reads its own box
 * from a ResizeObserver, never from layout.
 */
const W = MOBILE_GLASS.wheel;

export function FocusWheel({ runtime, axis = 'x' }) {
  const root = useRef(null);
  const track = useRef(null);
  const drag = useRef(null);
  const presets = VIEW.optics.steps;
  const ticks = useMemo(() => wheelTicks(presets), [presets]);

  // Per frame: place the scale under the index (the drag owns it while held).
  useEffect(() => {
    let raf = 0, lastMove = '', lastValue = '';
    let half = 0;
    const measure = () => {
      const box = root.current;
      if (box) half = (axis === 'x' ? box.clientWidth : box.clientHeight) / 2;
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' || !root.current ? null : new ResizeObserver(measure);
    ro?.observe(root.current);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = track.current, box = root.current;
      const w = runtime.airportWatch;
      if (!el || !box || !w?.optics) return;
      const d = drag.current;
      const px = d?.px ?? wheelPx(w.optics.mag);
      // x: higher numbers to the right, moved left under the index as you zoom
      // in; y: higher numbers up.
      const move = axis === 'x' ? `translate3d(${(half - px).toFixed(1)}px,0,0)` : `translate3d(0,${(half + px).toFixed(1)}px,0)`;
      if (move !== lastMove) {
        lastMove = move;
        el.style.transform = move;
      }
      const value = (d?.px != null ? wheelMag(px) : w.optics.target).toFixed(1);
      if (value !== lastValue) {
        lastValue = value;
        box.setAttribute('aria-valuenow', value);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [runtime, axis]);

  /** End the drag or glide (cancelling a glide's next frame). */
  const stop = () => {
    const d = drag.current;
    if (d?.glide) cancelAnimationFrame(d.glide);
    drag.current = null;
  };
  /** The wheel still owns the power: the glasses are up and nothing else has set it since the wheel last did. */
  const owns = (d) => {
    const w = runtime.airportWatch;
    return !!w?.binocular && (d.set == null || w.optics?.target === d.set);
  };
  const setMag = (m, d) => {
    const w = runtime.airportWatch;
    w?.setMagnification(m);
    if (d) d.set = w?.optics?.target;
  };
  const along = (e) => (axis === 'x' ? e.clientX : -e.clientY);

  // The glasses came down (Lower, Back, a double-tap, a pinch out): a glide
  // still running stops now.
  const up = useFlyStore((s) => !!s.airportWatch?.binocular);
  useEffect(() => {
    if (!up) stop();
  });

  const onPointerDown = (e) => {
    stop();
    const w = runtime.airportWatch;
    const start = wheelPx(w?.optics?.target ?? presets[0]);
    drag.current = { id: e.pointerId, from: along(e), start, px: null, moved: false, last: along(e), lastT: e.timeStamp, v: 0, set: null };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!owns(d)) return stop();
    const delta = along(e) - d.from;
    if (!d.moved) {
      if (Math.abs(delta) < W.slopPx) return;
      d.moved = true;
      try { root.current?.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    }
    // The scale moves with the finger: pulling the higher numbers under the
    // index (a drag left in x, down in y) zooms in.
    let px = d.start - delta;
    px = Math.min(wheelPx(W.maxMag), Math.max(wheelPx(W.minMag), px));
    const hold = detentNear(px, presets, W.magnetPx);
    if (hold) px = wheelPx(hold);
    const prev = d.px ?? d.start;
    if (detentsCrossed(prev, px, presets).length) haptic('detent');
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.7 * d.v + 0.3 * ((d.last - along(e)) / dt); // px/ms toward higher numbers
    d.last = along(e);
    d.lastT = e.timeStamp;
    d.px = px;
    setMag(wheelMag(px), d);
  };
  const settle = (d) => {
    drag.current = null;
    if (!owns(d)) return;
    const at = detentNear(d.px, presets, W.snapPx);
    if (at) {
      if (Math.abs(wheelPx(at) - d.px) > 0.5) haptic('detent');
      setMag(at, d);
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    try { root.current?.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!d.moved || d.px == null) {
      drag.current = null;
      return;
    }
    // A flick glides on a little (velocity decays exponentially), then settles.
    if (prefersReducedMotion() || Math.abs(d.v) < 0.15) return settle(d);
    let v = d.v, last = performance.now();
    const t0 = last;
    const step = (now) => {
      d.glide = 0;
      if (drag.current !== d) return;
      if (!owns(d)) return stop();
      const dt = Math.min(48, now - last);
      last = now;
      const prev = d.px;
      d.px = Math.min(wheelPx(W.maxMag), Math.max(wheelPx(W.minMag), d.px + v * dt));
      if (detentsCrossed(prev, d.px, presets).length) haptic('detent');
      v *= Math.exp(-W.friction * dt * 2);
      setMag(wheelMag(d.px), d);
      if (now - t0 < W.glideMs && Math.abs(v) > 0.02 && d.px > wheelPx(W.minMag) && d.px < wheelPx(W.maxMag)) d.glide = requestAnimationFrame(step);
      else settle(d);
    };
    d.glide = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (drag.current?.glide) cancelAnimationFrame(drag.current.glide); }, []);

  return (
    <div
      ref={root}
      className="bino-wheel"
      data-axis={axis}
      data-testid="binocular-wheel"
      role="slider"
      aria-label="Magnification"
      aria-orientation={axis === 'x' ? 'horizontal' : 'vertical'}
      aria-valuemin={W.minMag}
      aria-valuemax={W.maxMag}
      aria-valuenow={Number((runtime.airportWatch?.optics?.target ?? VIEW.optics.defaultMag).toFixed(1))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bino-wheel-knurl" aria-hidden="true" />
      <div ref={track} className="bino-wheel-track">
        {ticks.map((t) => (
          <i key={t.mag} className="bino-wheel-tick" data-major={t.major ? '1' : '0'} data-preset={t.preset ? '1' : '0'} style={axis === 'x' ? { left: `${t.px.toFixed(1)}px` } : { top: `${(-t.px).toFixed(1)}px` }} />
        ))}
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            className="bino-wheel-preset"
            data-testid={`binocular-preset-${m}`}
            style={axis === 'x' ? { left: `${wheelPx(m).toFixed(1)}px` } : { top: `${(-wheelPx(m)).toFixed(1)}px` }}
            onClick={() => {
              haptic('detent');
              setMag(m);
            }}
            aria-label={`${m} times`}
          >
            {m}×
          </button>
        ))}
      </div>
      <span className="bino-wheel-index" aria-hidden="true" />
    </div>
  );
}

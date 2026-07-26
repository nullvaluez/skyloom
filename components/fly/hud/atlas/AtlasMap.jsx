'use client';

import { useEffect, useRef } from 'react';
import { loadCoastlines } from '@/lib/fly/atlas/coastlines';
import { MOBILE_UI } from '@/lib/fly/fly-constants';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { ATLAS_KIND, ATLAS_MAP } from './atlas-tokens';

/**
 * The Atlas world map: ONE 2D canvas (no GL). Equirectangular projection,
 * ink ocean, Natural Earth coastlines in ice, POI dots by kind, the player
 * as a red jet marker. Wheel zooms toward the cursor, drag pans, click
 * selects the nearest dot. Redraws on interaction plus a 2Hz tick for the
 * player marker — never per frame (FLY_ATLAS_REWORK §4.1 perf note).
 *
 * ROUND 17 — TOUCH. Everything above was already pointer-events based, so
 * one-finger PAN and TAP-to-select worked on a phone in principle; in practice
 * they did not, because the canvas had no `touch-action` and the phone Atlas
 * sheet scrolls, so the browser claimed every drag before the canvas saw it.
 * Three additions:
 *
 *   · `touch-action: none` — the canvas owns its gestures.
 *   · PINCH ZOOM through a pointerId map. Two fingers give a distance RATIO,
 *     which drives the SAME zoom + keep-the-point-under-the-anchor math the
 *     wheel already used, only about the pinch midpoint instead of the cursor.
 *     One implementation of "zoom about a screen point", two ways in.
 *   · A 22 px TAP pick radius (`MOBILE_UI.atlas.touchPickRadiusPx`) instead of
 *     the 13 px cursor one, and 44 px +/- buttons as the accessible fallback
 *     for anyone who cannot pinch (one-handed, assistive pointer, a phone
 *     that hands the second finger to the OS).
 */
export function AtlasMap({ entries, selectedKey, onSelect, runtime, focus }) {
  const canvasRef = useRef(null);
  const { isTouch } = useDeviceLayout();
  const stateRef = useRef({
    clat: 25,
    clon: -40,
    zoom: 1,
    hover: null,
    coasts: null,
    dragging: false,
    moved: 0,
    lastX: 0,
    lastY: 0,
    // Round 17 touch: live pointers by id, and the pinch baseline captured
    // when the SECOND one arrives.
    pointers: new Map(),
    pinch: null, // {dist, zoom, glon, glat} | null
  });
  const propsRef = useRef({});
  useEffect(() => {
    propsRef.current = { entries, selectedKey, onSelect, runtime };
  });

  // Search-driven focus: center the view on the picked destination
  useEffect(() => {
    if (!focus) return;
    const s = stateRef.current;
    s.clat = Math.max(-ATLAS_MAP.latClamp, Math.min(ATLAS_MAP.latClamp, focus.lat));
    s.clon = focus.lon;
    s.zoom = Math.max(s.zoom, 4);
    s.draw?.();
  }, [focus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const s = stateRef.current;
    let disposed = false;

    loadCoastlines().then((lines) => {
      if (disposed) return;
      s.coasts = lines;
      draw();
    });

    const scalePxPerDeg = (w) => (w / 360) * s.zoom;
    const toPx = (lon, lat, w, h) => {
      const sc = scalePxPerDeg(w);
      return [(lon - s.clon) * sc + w / 2, (s.clat - lat) * sc + h / 2];
    };
    const toGeo = (x, y, w, h) => {
      const sc = scalePxPerDeg(w);
      return [s.clon + (x - w / 2) / sc, s.clat - (y - h / 2) / sc];
    };

    function draw() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ocean
      ctx.fillStyle = ATLAS_MAP.ocean;
      ctx.fillRect(0, 0, w, h);

      // graticule every 30°
      ctx.strokeStyle = ATLAS_MAP.graticule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 30) {
        const [x] = toPx(lon, 0, w, h);
        if (x < -2 || x > w + 2) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let lat = -60; lat <= 80; lat += 30) {
        const [, y] = toPx(0, lat, w, h);
        if (y < -2 || y > h + 2) continue;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // coastlines
      if (s.coasts) {
        ctx.strokeStyle = ATLAS_MAP.coast;
        ctx.lineWidth = ATLAS_MAP.coastWidth;
        ctx.beginPath();
        for (const line of s.coasts) {
          let started = false;
          for (let i = 0; i < line.length; i += 2) {
            const [x, y] = toPx(line[i], line[i + 1], w, h);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
        }
        ctx.stroke();
      }

      // POI dots by kind (landmarks only once zoomed — clutter control)
      const { entries: list, selectedKey: selKey } = propsRef.current;
      let selPt = null;
      for (const e of list) {
        if (e.kind === 'landmark' && s.zoom < 2.5) continue;
        const [x, y] = toPx(e.lon, e.lat, w, h);
        if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
        const kind = ATLAS_KIND[e.kind] ?? ATLAS_KIND.city;
        const r = kind.dot;
        ctx.fillStyle = kind.color;
        ctx.globalAlpha = e.kind === 'airport' || e.kind === 'landmark' ? 0.55 : 0.92;
        if (e.kind === 'military') {
          // hollow triangle — matches the minimap language
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = kind.color;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(x, y - r - 1);
          ctx.lineTo(x - r, y + r - 0.5);
          ctx.lineTo(x + r, y + r - 0.5);
          ctx.closePath();
          ctx.stroke();
        } else if (e.kind === 'hotspot') {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-r + 0.5, -r + 0.5, r * 1.7, r * 1.7);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (e.key === selKey) selPt = [x, y];
      }
      ctx.globalAlpha = 1;

      // selected ring + crosshair
      if (selPt) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(selPt[0], selPt[1], 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(selPt[0] - 16, selPt[1]);
        ctx.lineTo(selPt[0] - 9, selPt[1]);
        ctx.moveTo(selPt[0] + 9, selPt[1]);
        ctx.lineTo(selPt[0] + 16, selPt[1]);
        ctx.moveTo(selPt[0], selPt[1] - 16);
        ctx.lineTo(selPt[0], selPt[1] - 9);
        ctx.moveTo(selPt[0], selPt[1] + 9);
        ctx.lineTo(selPt[0], selPt[1] + 16);
        ctx.stroke();
      }

      // player — red jet wedge rotated to heading
      const rt = propsRef.current.runtime;
      const geo = rt?.geo;
      if (geo) {
        const [px, py] = toPx(geo.x, geo.y, w, h);
        if (px > -20 && px < w + 20 && py > -20 && py < h + 20) {
          const hdg = rt.flight?.heading ?? 0;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(hdg);
          ctx.fillStyle = ATLAS_MAP.player;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -6.5);
          ctx.lineTo(-4.5, 5);
          ctx.lineTo(0, 2.6);
          ctx.lineTo(4.5, 5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.font = '700 9px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('YOU', px, py + 16);
        }
      }

      // hover label
      if (s.hover) {
        const [x, y] = toPx(s.hover.lon, s.hover.lat, w, h);
        const kind = ATLAS_KIND[s.hover.kind] ?? ATLAS_KIND.city;
        ctx.strokeStyle = kind.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
        const label = s.hover.name.toUpperCase();
        ctx.font = '700 11px ui-monospace, monospace';
        const tw = ctx.measureText(label).width;
        const bx = Math.max(4, Math.min(w - tw - 18, x + 10));
        const by = Math.max(16, y - 12);
        ctx.fillStyle = 'rgba(7, 10, 20, 0.9)';
        ctx.fillRect(bx - 5, by - 11, tw + 10, 16);
        ctx.fillStyle = kind.color;
        ctx.textAlign = 'left';
        ctx.fillText(label, bx, by + 1);
      }
    }
    s.draw = draw;

    /**
     * A fingertip contact patch is ~9 mm across; the 13 px radius below
     * assumes a 1 px cursor hotspot, which is why the POI dots were
     * essentially untappable. Mouse and pen keep the cursor radius EXACTLY —
     * the gate is per-event on pointerType, not per-device, so a stylus on a
     * tablet still gets cursor precision.
     */
    const pickRadius = (e) =>
      e?.pointerType === 'touch' ? MOBILE_UI.atlas.touchPickRadiusPx : 13;

    const pick = (x, y, radius = 13) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const { entries: list } = propsRef.current;
      let best = null;
      let bestD = radius;
      for (const e of list) {
        if (e.kind === 'landmark' && s.zoom < 2.5) continue;
        const [ex, ey] = toPx(e.lon, e.lat, w, h);
        const d = Math.hypot(ex - x, ey - y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    };

    const clampView = () => {
      s.zoom = Math.max(ATLAS_MAP.zoomMin, Math.min(ATLAS_MAP.zoomMax, s.zoom));
      s.clat = Math.max(-ATLAS_MAP.latClamp, Math.min(ATLAS_MAP.latClamp, s.clat));
      s.clon = Math.max(-200, Math.min(200, s.clon));
    };

    /** Dev telemetry — verify-mobile proves a pinch actually moved the view. */
    const stampZoom = () => {
      if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
      (window.__flyStats ??= {}).atlasZoom = s.zoom;
    };

    /**
     * THE one zoom primitive: scale by `factor` while pinning the geo point
     * currently under (x, y) to (x, y). The wheel, the pinch and the +/-
     * buttons all funnel through it, so they cannot drift apart.
     * `anchor` optionally supplies an already-resolved geo point (the pinch
     * captures it once, at gesture start, so the view does not creep as the
     * midpoint wanders between the two fingers).
     */
    const zoomAbout = (x, y, factor, anchor = null) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const [glon, glat] = anchor ?? toGeo(x, y, r.width, r.height);
      s.zoom *= factor;
      clampView();
      const sc = scalePxPerDeg(r.width);
      s.clon = glon - (x - r.width / 2) / sc;
      s.clat = glat + (y - r.height / 2) / sc;
      clampView();
      stampZoom();
      draw();
    };

    const onWheel = (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAbout(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    };

    // The +/- buttons: zoom about the map CENTRE (there is no cursor to zoom
    // toward), which is also what a keyboard/assistive user expects.
    s.zoomBy = (factor) => {
      const r = canvas.getBoundingClientRect();
      zoomAbout(r.width / 2, r.height / 2, factor);
    };

    /** Screen distance + midpoint of the two live pointers. */
    const twoFinger = () => {
      const [a, b] = [...s.pointers.values()];
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    };

    const startPinch = () => {
      const r = canvas.getBoundingClientRect();
      const { dist, mx, my } = twoFinger();
      const [glon, glat] = toGeo(mx - r.left, my - r.top, r.width, r.height);
      s.pinch = { dist: Math.max(1, dist), zoom: s.zoom, glon, glat };
      s.dragging = false; // a pinch is not a pan
      s.moved = 999; // ...and must never be mistaken for a tap on release
    };

    const onDown = (e) => {
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size >= 2) {
        startPinch();
      } else {
        s.dragging = true;
        s.moved = 0;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
      }
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic/never-active pointer id — gestures still track on-canvas */
      }
    };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (s.pinch && s.pointers.size >= 2) {
        const { dist, mx, my } = twoFinger();
        const ratio = Math.max(1, dist) / s.pinch.dist;
        // Absolute against the gesture baseline (not incremental): the zoom
        // tracks the fingers exactly and cannot accumulate drift over a long
        // pinch. zoomAbout applies the clamp, so the ratio is safe to be wild.
        const target = Math.max(
          ATLAS_MAP.zoomMin,
          Math.min(ATLAS_MAP.zoomMax, s.pinch.zoom * ratio)
        );
        zoomAbout(mx - r.left, my - r.top, target / s.zoom, [s.pinch.glon, s.pinch.glat]);
        return;
      }

      if (s.dragging) {
        const dx = e.clientX - s.lastX;
        const dy = e.clientY - s.lastY;
        s.moved += Math.abs(dx) + Math.abs(dy);
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        const sc = scalePxPerDeg(r.width);
        s.clon -= dx / sc;
        s.clat += dy / sc;
        clampView();
        draw();
      } else {
        const prev = s.hover?.key;
        s.hover = pick(e.clientX - r.left, e.clientY - r.top, pickRadius(e));
        canvas.style.cursor = s.hover ? 'pointer' : 'grab';
        if (s.hover?.key !== prev) draw();
      }
    };
    const onUp = (e) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.pinch = null;
      if (s.pointers.size > 0) return; // still mid-gesture
      const wasDrag = s.moved > 5;
      s.dragging = false;
      if (!wasDrag) {
        const r = canvas.getBoundingClientRect();
        const hit = pick(e.clientX - r.left, e.clientY - r.top, pickRadius(e));
        if (hit) propsRef.current.onSelect?.(hit);
      }
    };
    const onCancel = (e) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.pinch = null;
      if (s.pointers.size === 0) {
        s.dragging = false;
        s.moved = 999; // a cancelled gesture is never a tap
      }
    };
    const onLeave = () => {
      if (s.hover) {
        s.hover = null;
        draw();
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    // 2Hz: the player keeps flying behind the atlas — keep the marker live
    const tick = setInterval(draw, 500);

    return () => {
      disposed = true;
      clearInterval(tick);
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      s.pointers.clear();
      s.pinch = null;
    };
  }, []);

  // selection / filter changes redraw through the shared draw handle
  useEffect(() => {
    stateRef.current.draw?.();
  }, [entries, selectedKey]);

  const zoomBy = (factor) => stateRef.current.zoomBy?.(factor);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full rounded-lg"
        // `touch-action: none` is the load-bearing line for touch: without it
        // the phone Atlas sheet (a scroll container) claims every vertical
        // drag before the canvas sees a single pointermove, and the map simply
        // does not pan. It also stops the browser's own pinch-zoom from
        // fighting ours.
        style={{ cursor: 'grab', touchAction: 'none' }}
      />
      {/* Accessible zoom fallback — touch only. Pinch is the primary gesture;
          these exist for one-handed use, assistive pointers, and phones whose
          OS claims the second finger. Desktop has the wheel and is unchanged
          (these do not render at all). */}
      {isTouch && (
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-2">
          {[
            { testid: 'atlas-zoom-in', label: 'Zoom in', glyph: '+', factor: 1.6 },
            { testid: 'atlas-zoom-out', label: 'Zoom out', glyph: '−', factor: 1 / 1.6 },
          ].map((b) => (
            <button
              key={b.testid}
              type="button"
              data-testid={b.testid}
              aria-label={b.label}
              onClick={() => zoomBy(b.factor)}
              className="hud-glass pointer-events-auto grid h-11 w-11 place-items-center rounded-lg text-lg leading-none"
              style={{
                border: '1px solid rgba(207,238,248,0.28)',
                color: '#eef5ff',
                touchAction: 'manipulation',
              }}
            >
              {b.glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

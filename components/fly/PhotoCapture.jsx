'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PHOTO } from '@/lib/fly/fly-constants';
import { ATTRIBUTIONS_BY_STYLE } from '@/lib/fly/tile-sources';
import { registerRuntimeActions } from '@/lib/fly/runtime-bus';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Round 17 — the shutter.
 *
 * WHY THIS IS A useFrame SUBSCRIBER AND NOT A CLICK HANDLER
 * ---------------------------------------------------------
 * Two facts about this canvas decide the whole design:
 *
 *  1. `FlyCanvas` does NOT set `preserveDrawingBuffer`. The WebGL drawing
 *     buffer is therefore valid only until the frame is composited — any read
 *     from a later task (a click handler, a promise continuation, a timeout)
 *     gets a cleared/undefined buffer.
 *  2. `Effects` mounts an EffectComposer, which takes over rendering at
 *     useFrame priority 1 with R3F's auto-render disabled. So the graded
 *     image (bloom → grade → ACES) only exists AFTER that pass. A naive
 *     `gl.render(scene, camera)` would re-render the raw scene and export an
 *     UNGRADED frame that looks nothing like what the player is seeing.
 *
 * Both are satisfied by one thing: read the canvas from a useFrame subscriber
 * at a HIGHER priority than the composer (PHOTO.capturePriority = 100), in
 * the same rAF task, immediately after the composer has drawn.
 *
 * The read itself is `ctx.drawImage(gl.domElement, …)` onto a one-shot 2D
 * canvas — a synchronous pixel copy, unlike `toBlob`'s "snapshot now, encode
 * in parallel" contract, which is correct per spec but leaves the moment of
 * capture to the engine. Once the pixels are in a 2D canvas they are ours,
 * and the watermark + PNG encode can take as long as they like.
 *
 * The attribution is BAKED IN because the exported file leaves the app: Esri's
 * terms follow the pixels, not the page. It comes from the same
 * ATTRIBUTIONS_BY_STYLE table AttributionBar renders — one source of truth.
 */
export function PhotoCapture() {
  const gl = useThree((s) => s.gl);
  // { resolve, reject, t0 } — set by the action, drained by the frame below.
  const pendingRef = useRef(null);

  useEffect(() => {
    const capturePhoto = () =>
      new Promise((resolve, reject) => {
        // A second request while one is in flight simply replaces it: the
        // shutter is idempotent within a frame, and the old promise would
        // otherwise dangle forever.
        pendingRef.current?.reject?.(new Error('superseded'));
        pendingRef.current = { resolve, reject, t0: performance.now() };
      });
    registerRuntimeActions({ capturePhoto });
    return () => {
      // The bus nulls handles on FlyScene's cleanup; ours is separate, so
      // clear the in-flight request explicitly or a caller hangs.
      pendingRef.current?.reject?.(new Error('photo capture unmounted'));
      pendingRef.current = null;
      registerRuntimeActions({ capturePhoto: null });
    };
  }, []);

  useFrame(() => {
    const req = pendingRef.current;
    if (!req) return;
    pendingRef.current = null;

    try {
      const src = gl.domElement;
      const w = src.width;
      const h = src.height;
      if (!w || !h) throw new Error('canvas has no drawing buffer');

      // --- SAME TASK, immediately after the composer pass -----------------
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      ctx.drawImage(src, 0, 0);
      // From here on the pixels are in a 2D canvas — the WebGL buffer may go.

      const mapStyle = useFlyStore.getState().mapStyle;
      drawWatermark(ctx, w, h, mapStyle);

      const filename = photoFilename();
      out.toBlob((blob) => {
        const ms = Math.round(performance.now() - req.t0);
        if (!blob) {
          req.reject(new Error('PNG encode failed'));
          return;
        }
        if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
          const stats = (window.__flyStats ??= {});
          stats.photo = {
            captures: (stats.photo?.captures ?? 0) + 1,
            watermark: true,
            ms,
            w,
            h,
            bytes: blob.size,
            style: mapStyle,
          };
        }
        req.resolve({ blob, filename, width: w, height: h, ms });
      }, 'image/png');
    } catch (err) {
      req.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }, PHOTO.capturePriority);

  return null;
}

/**
 * `skyloom-photo-<ISO timestamp>.png`, with the colons/dots ISO 8601 insists
 * on folded to dashes — Windows refuses `:` in a filename and Chrome silently
 * rewrites the download, which would make the saved name unpredictable.
 */
function photoFilename() {
  const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
  return `skyloom-photo-${iso}.png`;
}

/** Bottom-left credit plate: SKYLOOM over the active style's data credits. */
function drawWatermark(ctx, w, h, mapStyle) {
  const wm = PHOTO.watermark;
  const list = ATTRIBUTIONS_BY_STYLE[mapStyle] ?? ATTRIBUTIONS_BY_STYLE.satellite;
  const credit = list.map((a) => a.label).join('  ·  ');

  // Scale with the export so a 4K capture doesn't get a 15px credit line and
  // a phone capture doesn't get a banner.
  const s = Math.max(0.65, Math.min(1.6, w / 1600));
  const fontPx = Math.max(wm.minFontPx, Math.round(wm.fontPx * s));
  const brandPx = Math.round(fontPx * 1.15);
  const pad = Math.round(wm.padPx * s);
  const sp = Math.round(wm.scrimPadPx * s);
  const gap = Math.round(wm.lineGapPx * s);

  const monoFont = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  const brandFont = `600 ${brandPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = brandFont;
  const brandW = ctx.measureText(wm.brand).width;
  ctx.font = monoFont;
  const creditW = ctx.measureText(credit).width;

  const boxW = Math.min(w - pad * 2, Math.max(brandW, creditW) + sp * 2);
  const boxH = brandPx + gap + fontPx + sp * 2;
  const boxX = pad;
  const boxY = h - pad - boxH;

  ctx.fillStyle = `rgba(4, 6, 13, ${wm.scrimAlpha})`;
  roundRect(ctx, boxX, boxY, boxW, boxH, Math.round(6 * s));
  ctx.fill();

  ctx.font = brandFont;
  ctx.fillStyle = wm.brandColor;
  ctx.fillText(wm.brand, boxX + sp, boxY + sp);
  ctx.font = monoFont;
  ctx.fillStyle = wm.color;
  ctx.fillText(credit, boxX + sp, boxY + sp + brandPx + gap, boxW - sp * 2);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  // Not every browser this ships to has ctx.roundRect (Safari < 16.4).
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

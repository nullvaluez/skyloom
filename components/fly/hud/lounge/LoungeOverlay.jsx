'use client';
/* eslint-disable react-hooks/immutability -- the flight runtime and the picker are imperative per-frame buses, deliberately outside React state. */
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { addAfterEffect } from '@react-three/fiber';
import { HUD_SYNC } from '@/lib/fly/fly-constants';
import { pinned } from '@/lib/fly/fly-pins';
import { VIEW, MOBILE_GLASS } from '@/lib/fly/observation-config';
import { binocularFigure, raisedRadius, reticleFor } from '@/lib/fly/lounge/glass-layout.mjs';
import { drawnPoint, glazingFor } from '@/lib/fly/airport-watch-runtime';
import { DEG, clamp, pickRadius, wingspanFor, smoothstep, prefersReducedMotion } from '@/lib/fly/airport-watch-camera.mjs';
import { contactLabel, typeNameFor } from '@/lib/fly/airport-watch-board.mjs';
import { playPassOn, playPassBlock } from '@/lib/fly/play-pass';
import { skyMarker, countdown } from '@/lib/fly/airport-watch-director.mjs';

/*
 * The lounge's in-view layer, drawn once per GL frame (HUD_SYNC: from
 * addAfterEffect, after renderer.render refreshed the camera matrices, so a
 * marker is a picture of the same frame it sits on — no swim at 20x).
 *
 *  - projects every live contact through the camera at its DRAWN position
 *    (the aircraft bend mirrored on the CPU, like the flight label canvas);
 *  - keeps only contacts seen through the glazing (loungeAperture) — those
 *    are the pick targets the surface hit-tests (`picker.hits`);
 *  - resolves the hover under the pointer with hysteresis;
 *  - draws: fine brackets on visible contacts (fading with range), a label
 *    for the selection, the hover and the nearest arrivals/departures, an
 *    edge arrow when the selection is out of frame, the binocular lock box,
 *    and — on its own canvas, redrawn only when it changes — the twin-lens
 *    binocular mask with vignette and reticle.
 *
 * Play Pass DIRECTOR (LOUNGE_DIRECTOR; null below while the flag is off, and
 * every use is guarded by it): a CLEAN SKY — idle brackets only on contacts
 * that help (lib/fly/airport-watch-director.mjs skyMarker), a faint dot for
 * mid-range ones, nothing for far ones (all stay pickable) — and the NEXT
 * MOVEMENT's locator from watch.director.next: a ring and its countdown on the
 * aircraft in view, an edge arrow toward it, or toward its touchdown zone
 * while the aircraft itself is out of sight.
 */
const DIRECTOR = playPassOn('LOUNGE_DIRECTOR') ? playPassBlock('LOUNGE_DIRECTOR') : null;

const C = {
  ice: '238,245,255',
  cyan: '79,227,255',
  amber: '255,197,97',
  lime: '125,255,182',
  ink: '3,7,15',
};
const FONT = 'ui-sans-serif, system-ui, sans-serif';
const DISPLAY = "'Archivo Black', ui-sans-serif, system-ui, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Corner brackets around (x, y). The dark under-stroke keeps them legible on a bright sky. */
function brackets(ctx, x, y, half, arm, rgb, alpha, width) {
  const path = () => {
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * half, y + sy * (half - arm));
      ctx.lineTo(x + sx * half, y + sy * half);
      ctx.lineTo(x + sx * (half - arm), y + sy * half);
    }
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path();
  ctx.strokeStyle = `rgba(${C.ink},${0.5 * alpha})`;
  ctx.lineWidth = width + 2;
  ctx.stroke();
  path();
  ctx.strokeStyle = `rgba(${rgb},${alpha})`;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** A label pill's size for `lines` (callsign, then an optional detail line). */
function measurePill(ctx, lines, accent) {
  ctx.font = `400 12.5px ${DISPLAY}`;
  const w0 = ctx.measureText(lines[0]).width;
  ctx.font = `600 10.5px ${FONT}`;
  const w1 = lines[1] ? ctx.measureText(lines[1]).width : 0;
  return [Math.max(w0, w1) + 18 + (accent ? 6 : 0), lines[1] ? 38 : 24];
}

/** Draw a rounded label pill into rectangle `rect` = [x, y, w, h]. */
function drawPill(ctx, rect, lines, { rgb = C.ice, accent = null, alpha = 1 }) {
  const [px, py, w, h] = rect;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.roundRect(px, py, w, h, 7);
  ctx.fillStyle = `rgba(${C.ink},0.74)`;
  ctx.fill();
  ctx.strokeStyle = accent ? `rgba(${accent},0.55)` : 'rgba(186,222,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (accent) {
    ctx.fillStyle = `rgba(${accent},0.95)`;
    ctx.fillRect(px + 6, py + 7, 2, h - 14);
  }
  const tx = px + 9 + (accent ? 6 : 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 12.5px ${DISPLAY}`;
  ctx.fillStyle = `rgba(${rgb},1)`;
  ctx.fillText(lines[0], tx, py + 17);
  if (lines[1]) {
    ctx.font = `600 10.5px ${FONT}`;
    ctx.fillStyle = 'rgba(167,184,207,1)';
    ctx.fillText(lines[1], tx, py + 31);
  }
  ctx.globalAlpha = 1;
}

/** A pill at (x, y), kept inside the viewport; returns its rectangle. */
function pill(ctx, x, y, lines, opts) {
  const [w, h] = measurePill(ctx, lines, !!opts.accent);
  const rect = [clamp(x, 8, opts.w - w - 8), clamp(y, 8, opts.h - h - 8), w, h];
  drawPill(ctx, rect, lines, opts);
  return rect;
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** DIRECTOR: the next movement's ring (a soft halo under a fine line). */
function ring(ctx, x, y, r, rgb, alpha) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${C.ink},${0.5 * alpha})`;
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = `rgba(${rgb},0.7)`;
  ctx.shadowBlur = 9;
  ctx.strokeStyle = `rgba(${rgb},${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** DIRECTOR: a toned arrow at the screen edge toward NDC direction (ux, uy), slid clear of the panels; returns its tip. */
function edgeArrow(ctx, W, H, ux, uy, inset, rgb, avoid) {
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const hx = W / 2 - inset, hy = H / 2 - inset - 40;
  const sx = hx / Math.max(1e-6, Math.abs(ux)), sy = hy / Math.max(1e-6, Math.abs(uy));
  const s = Math.min(sx, sy);
  let ex = W / 2 + ux * s, ey = H / 2 - uy * s;
  for (const r of avoid) {
    if (ex < r[0] - 14 || ex > r[0] + r[2] + 14 || ey < r[1] - 14 || ey > r[1] + r[3] + 14) continue;
    if (sx <= sy) ey = r[1] + r[3] + 18; // on a side edge: slide below the panel
    else ex = ux > 0 ? r[0] - 18 : r[0] + r[2] + 18; // on the top or bottom: beside it
  }
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(Math.atan2(-uy, ux));
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(-6, -9);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-6, 9);
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb},0.95)`;
  ctx.shadowColor = `rgba(${rgb},0.8)`;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.restore();
  return { ex, ey, ux, uy };
}

/** DIRECTOR: a pill at (x, y) moved clear of the panels (below one it would cover, else above). */
function pillClear(ctx, x, y, lines, opts, avoid) {
  const [w, h] = measurePill(ctx, lines, !!opts.accent);
  const rect = [clamp(x, 8, opts.w - w - 8), clamp(y, 8, opts.h - h - 8), w, h];
  for (let i = 0; i < 3; i++) {
    const r = avoid.find((o) => overlaps(o, rect));
    if (!r) break;
    const below = r[1] + r[3] + 6;
    rect[1] = below + h < opts.h - 8 ? below : Math.max(8, r[1] - h - 6);
  }
  drawPill(ctx, rect, lines, opts);
  return rect;
}
const fmtKm = (m) => (m < 9500 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`);

/** The twin-lens mask, vignette and reticle for raise amount `a` (0..1). */
// `posts` (0..1, DIRECTOR): the reticle's strength — it fades while steady
// binoculars frame a locked aircraft, which the lock box then frames instead.
function drawMask(ctx, w, h, a, posts = 1) {
  ctx.clearRect(0, 0, w, h);
  if (a <= 0.001) return;
  const up = 1 - Math.pow(1 - a, 3); // ease-out raise
  const R = h * 0.47 * (1.5 - 0.5 * up);
  const sep = R * 0.56;
  const cy = h / 2, c1 = w / 2 - sep, c2 = w / 2 + sep;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(1,3,7,${0.965 * up})`;
  ctx.fillRect(0, 0, w, h);
  // Cut the two eyepieces with soft, slightly blurred edges.
  ctx.globalCompositeOperation = 'destination-out';
  for (const cx of [c1, c2]) {
    const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Optical vignette toward the rim of the fused field, and a faint cool
  // coating ring where each eyepiece meets the dark.
  const v = ctx.createRadialGradient(w / 2, cy, R * 0.55, w / 2, cy, R + sep);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.72, `rgba(0,2,6,${0.16 * up})`);
  v.addColorStop(1, `rgba(0,2,6,${0.55 * up})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1.5;
  for (const [cx, other] of [[c1, c2], [c2, c1]]) {
    // Only the arc that borders the dark: inside the fused field the other
    // eyepiece's light covers it, so no ring crosses the picture.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(other, cy, R * 0.995, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(150,205,255,${0.07 * up})`;
    ctx.stroke();
    ctx.restore();
  }
  // Fine post reticle: four posts that FRAME the centre (a locked aircraft
  // sits in the open middle, never under a line) with mil ticks.
  const x = w / 2, ra = up * 0.6 * posts, gap = 46, reach = 150;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * gap, cy + dy * gap);
    ctx.lineTo(x + dx * reach, cy + dy * reach);
  }
  for (let i = 1; i <= 8; i++) {
    const d = gap + i * 13, t = i % 4 === 0 ? 6 : 3;
    ctx.moveTo(x + d, cy - t); ctx.lineTo(x + d, cy + t);
    ctx.moveTo(x - d, cy - t); ctx.lineTo(x - d, cy + t);
    ctx.moveTo(x - t, cy + d); ctx.lineTo(x + t, cy + d);
  }
  ctx.strokeStyle = `rgba(${C.ink},${ra * 0.55})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${C.ice},${ra})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/*
 * LOUNGE MOBILE — GLASS: the phone figures (lib/fly/lounge/glass-layout.mjs).
 * Portrait is one circular field sized from the width and centred on the
 * optical axis; landscape is the twin-lens figure scaled from the height. The
 * desktop keeps drawMask above, untouched. Drawn only when the mask key
 * changes, at the canvas's DPR (fit() below), so the extra optics cost
 * nothing per frame:
 *  - the glass is cut with a soft edge, and an optical vignette darkens
 *    toward the rim;
 *  - just outside it the eyecup: a rubber lip lit faintly from above, so the
 *    field reads as something held to the eyes, not a hole in a page;
 *  - a cool anti-reflection coating ring and a faint violet sheen on the
 *    upper-left arc where the room light would catch it;
 *  - the post reticle scaled from the lens radius, centred on the optical
 *    axis (the screen centre), faded by `posts` like the desktop's.
 */
function drawPhoneMask(ctx, w, h, a, posts, fig) {
  ctx.clearRect(0, 0, w, h);
  if (a <= 0.001 || !fig) return;
  const up = 1 - Math.pow(1 - a, 3); // ease-out raise, as on desktop
  const R = raisedRadius(fig.R, up);
  const lenses = fig.lenses;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(1,3,7,${0.97 * up})`;
  ctx.fillRect(0, 0, w, h);
  // The eyecup lip: a ring just outside the glass, lighter on its upper edge.
  for (const L of lenses) {
    const lip = ctx.createRadialGradient(L.cx, L.cy - R * 0.04, R * 0.98, L.cx, L.cy, R * 1.07);
    lip.addColorStop(0, `rgba(44,54,70,${0.55 * up})`);
    lip.addColorStop(0.45, `rgba(16,21,30,${0.6 * up})`);
    lip.addColorStop(1, 'rgba(1,3,7,0)');
    ctx.fillStyle = lip;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R * 1.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cut the glass with a soft, slightly blurred edge.
  ctx.globalCompositeOperation = 'destination-out';
  for (const L of lenses) {
    const g = ctx.createRadialGradient(L.cx, L.cy, R * 0.9, L.cx, L.cy, R);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Optical vignette toward the rim of the fused field.
  const span = lenses.length > 1 ? R + Math.abs(lenses[1].cx - lenses[0].cx) / 2 : R;
  const v = ctx.createRadialGradient(fig.cx, fig.cy, span * 0.58, fig.cx, fig.cy, span);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.75, `rgba(0,2,6,${0.14 * up})`);
  v.addColorStop(1, `rgba(0,2,6,${0.5 * up})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  // Coating ring and sheen: only the arc that borders the dark (inside a
  // fused twin field the other eyepiece's light covers it).
  for (const L of lenses) {
    const other = lenses.find((o) => o !== L);
    ctx.save();
    if (other) {
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(other.cx, other.cy, R * 0.995, 0, Math.PI * 2, true);
      ctx.clip('evenodd');
    }
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R * 0.975, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(150,205,255,${0.11 * up})`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R * 0.955, Math.PI * 1.08, Math.PI * 1.42);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(178,150,255,${0.12 * up})`;
    ctx.stroke();
    ctx.restore();
  }
  // The post reticle on the optical axis, scaled from the lens radius.
  const { gap, reach, step, ticks } = reticleFor(fig.R);
  const x = w / 2, cy = h / 2, ra = up * 0.62 * posts;
  if (ra < 0.01) return;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * gap, cy + dy * gap);
    ctx.lineTo(x + dx * reach, cy + dy * reach);
  }
  for (let i = 1; i <= ticks; i++) {
    const d = gap + i * step, t = i % 4 === 0 ? 5 : 2.5;
    ctx.moveTo(x + d, cy - t); ctx.lineTo(x + d, cy + t);
    ctx.moveTo(x - d, cy - t); ctx.lineTo(x - d, cy + t);
    ctx.moveTo(x - t, cy + d); ctx.lineTo(x + t, cy + d);
  }
  ctx.lineCap = 'butt';
  ctx.strokeStyle = `rgba(${C.ink},${ra * 0.55})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${C.ice},${ra})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * `binoLayout` ('desktop' | 'portrait' | 'landscape') and `insets` (the
 * safe-area insets) come from LoungeHud; desktop draws exactly as before.
 */
export function LoungeOverlay({ runtime, picker, binoLayout = 'desktop', insets = null }) {
  const markRef = useRef(null);
  const maskRef = useRef(null);
  // Read inside the frame loop without re-running its effect.
  const layoutRef = useRef({ mode: binoLayout, insets });
  useEffect(() => {
    layoutRef.current = { mode: binoLayout, insets };
  }, [binoLayout, insets]);
  useEffect(() => {
    const mark = markRef.current, mask = maskRef.current;
    if (!mark || !mask) return undefined;
    const ctx = mark.getContext('2d'), mctx = mask.getContext('2d');
    const v = new Vector3(), fwd = new Vector3(), aim = {};
    const order = [], drawn = []; // idle-bracket declutter scratch (drawn: x, y, r triples)
    const dots = []; // DIRECTOR: mid-range contacts drawn as faint dots
    const reduced = prefersReducedMotion();
    let posts = 1, postsAt = 0; // DIRECTOR: the reticle's eased strength
    const fx = { hex: null, at: 0 }; // selection snap-in
    let maskKey = '', raf = 0, lastCleared = false;
    // Screen rectangles of the lounge's own panels (header, board, card,
    // control bar), re-read at 4 Hz: labels are placed clear of them.
    let avoid = [], avoidAt = -1e9;
    const readAvoid = (now) => {
      if (now - avoidAt < 250) return;
      avoidAt = now;
      avoid = [];
      const root = mark.closest('.lounge');
      if (!root) return;
      const base = mark.getBoundingClientRect();
      // [data-lounge-avoid]: the phone HUD's own chrome (no desktop element carries it).
      for (const el of root.querySelectorAll('.lounge-panel, .lh-actions, .lounge-help, .dir-lower, [data-lounge-avoid]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) avoid.push([r.left - base.left - 6, r.top - base.top - 6, r.width + 12, r.height + 12]);
      }
    };

    const fit = (canvas, c2d, w, h, dpr) => {
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        if (canvas === mask) maskKey = '';
      }
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      if (!syncToGl) raf = requestAnimationFrame(draw);
      const w = runtime.airportWatch;
      const { camera, origin, flight, traffic } = runtime;
      const W = mark.clientWidth, H = mark.clientHeight;
      if (!w?.active || !camera || !origin || !flight || !W || !H) {
        if (!lastCleared) {
          ctx.clearRect(0, 0, mark.width, mark.height);
          mctx.clearRect(0, 0, mask.width, mask.height);
          picker.hits.length = 0;
          lastCleared = true;
          maskKey = '';
        }
        return;
      }
      lastCleared = false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      fit(mark, ctx, W, H, dpr);
      fit(mask, mctx, W, H, dpr);
      ctx.clearRect(0, 0, W, H);
      const now = performance.now();
      const mag = w.optics.mag, amount = w.optics.amount;
      const fovRad = camera.fov * DEG;
      const focal = H / 2 / Math.tan(fovRad / 2);
      const k = w.frame?.k || 1;
      camera.getWorldDirection(fwd);
      const ax = origin.anchor.x, az = origin.anchor.z;

      // --- project + glazing cull: the pick set -----------------------------
      const hits = picker.hits;
      hits.length = 0;
      let selectedHit = null, selectedTrack = null;
      // DIRECTOR: the next movement (watch.director.next), its hit and its glazing-visible track.
      const next = DIRECTOR ? w.director?.next ?? null : null;
      let nextHit = null, nextTrack = null;
      for (const t of traffic?.items || []) {
        if (!t.fix1 || (t.horizonFade ?? 1) < 0.05) continue;
        drawnPoint(t, flight.pos, aim);
        const rx = aim.x - ax, rz = aim.z - az;
        const dx = rx - camera.position.x, dy = aim.y - camera.position.y, dz = rz - camera.position.z;
        if (!glazingFor(w, dx, dy, dz)) continue;
        if (t.hex === w.selected) selectedTrack = t;
        if (next && t.hex === next.hex) nextTrack = t;
        if (dx * fwd.x + dy * fwd.y + dz * fwd.z < 1) continue; // behind the eye
        v.set(rx, aim.y, rz).project(camera);
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
        if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
        const dist = Math.hypot(dx / k, dy, dz / k);
        const half = Math.max(VIEW.markers.minHalfPx, (wingspanFor(t.meta?.category) * 0.5 * focal) / Math.max(1, dist));
        const hit = { hex: t.hex, sx, sy, half, dist, t, onScreen: sx >= 0 && sx <= W && sy >= 0 && sy <= H };
        hits.push(hit);
        if (t.hex === w.selected) selectedHit = hit;
        if (next && t.hex === next.hex) nextHit = hit;
      }

      // --- hover under the pointer (hysteresis) -----------------------------
      let hover = null;
      const p = picker.pointer;
      if (p.over && !p.dragging) {
        let best = Infinity;
        const base = pickRadius(mag);
        for (const hit of hits) {
          let d = Math.hypot(hit.sx - p.x, hit.sy - p.y);
          if (d > base + hit.half) continue;
          if (hit.hex === picker.hover?.hex) d *= VIEW.pick.hoverStick;
          if (d < best) {
            best = d;
            hover = hit;
          }
        }
      }
      picker.hover = hover;
      w.hover = hover?.hex ?? null;
      // The canvases never take pointer events; the surface under them does.
      const cursor = hover ? 'pointer' : '';
      if (picker.surface && picker.surface.style.cursor !== cursor) picker.surface.style.cursor = cursor;

      // --- markers ------------------------------------------------------------
      const M = VIEW.markers;
      const naked = 1 - smoothstep(0.15, 0.6, amount); // idle brackets fade as the glasses rise
      if (naked > 0.01) {
        // Declutter: airborne contacts claim their place first (nearest
        // first), then ground traffic; a bracket that would overlap one
        // already drawn is skipped, and a parked aircraft past M.groundM draws
        // none. Skipped contacts stay pickable (hover and click still find them).
        order.length = 0;
        drawn.length = 0;
        dots.length = 0;
        if (hover) drawn.push(hover.sx, hover.sy, hover.half + 6);
        if (selectedHit) drawn.push(selectedHit.sx, selectedHit.sy, selectedHit.half + 8);
        for (const hit of hits) {
          if (hit.hex === w.selected || hit === hover) continue;
          const grounded = (hit.t.flags & 1) === 1, fix = hit.t.fix1;
          if (grounded && hit.dist > M.groundM && Math.hypot(fix.vE || 0, fix.vN || 0) < M.parkedMps) continue;
          if (DIRECTOR) {
            // The clean sky: the next movement draws its locator; the rest earn a bracket, a dot or nothing.
            if (hit === nextHit) continue;
            const mark = skyMarker({ grounded, speedMs: Math.hypot(fix.vE || 0, fix.vN || 0), dist: hit.dist, category: picker.categories.get(hit.hex)?.category }, DIRECTOR);
            if (!mark) continue;
            if (mark === 'dot') {
              dots.push(hit);
              continue;
            }
          }
          hit.rank = (grounded ? 1e7 : 0) + hit.dist;
          order.push(hit);
        }
        order.sort((a, b) => a.rank - b.rank);
        for (const hit of order) {
          const r = hit.half + 3;
          let clash = false;
          for (let i = 0; i < drawn.length && !clash; i += 3) {
            const reach = drawn[i + 2] + r + M.gapPx;
            clash = Math.abs(drawn[i] - hit.sx) < reach && Math.abs(drawn[i + 1] - hit.sy) < reach;
          }
          if (clash) continue;
          drawn.push(hit.sx, hit.sy, r);
          const fade = 1 - smoothstep(M.nearM, M.farM, hit.dist);
          const alpha = (M.minAlpha + (M.maxAlpha - M.minAlpha) * fade) * naked * Math.max(0.3, hit.t.opacity ?? 1);
          const cat = picker.categories.get(hit.hex);
          const rgb = hit.t.flags & 1 ? C.amber : C.ice;
          brackets(ctx, hit.sx, hit.sy, hit.half + 3, Math.min(5, hit.half * 0.55 + 2), rgb, alpha, 1.15);
          // A tiny chevron marks arrivals (down) and departures (up) without words.
          if (cat?.category === 'arrival' || cat?.category === 'departure') {
            const dir = cat.category === 'arrival' ? 1 : -1, y0 = hit.sy + hit.half + 9;
            ctx.beginPath();
            ctx.moveTo(hit.sx - 3.5, y0 - dir * 2);
            ctx.lineTo(hit.sx, y0 + dir * 2);
            ctx.lineTo(hit.sx + 3.5, y0 - dir * 2);
            ctx.strokeStyle = `rgba(${cat.category === 'arrival' ? C.lime : C.cyan},${alpha})`;
            ctx.lineWidth = 1.3;
            ctx.stroke();
          }
        }
        // DIRECTOR: mid-range contacts as faint dots, clear of every bracket.
        for (const hit of dots) {
          let clash = false;
          for (let i = 0; i < drawn.length && !clash; i += 3) clash = Math.abs(drawn[i] - hit.sx) < drawn[i + 2] + 4 && Math.abs(drawn[i + 1] - hit.sy) < drawn[i + 2] + 4;
          if (clash) continue;
          ctx.beginPath();
          ctx.arc(hit.sx, hit.sy, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${C.ice},${DIRECTOR.sky.dotAlpha * naked * Math.max(0.3, hit.t.opacity ?? 1)})`;
          ctx.fill();
        }
      }

      // Labels: selection first, then hover, then the nearest arrivals and
      // departures — never overlapping each other or the lounge's panels.
      // Each tries the right of its marker, then the left.
      readAvoid(now);
      const taken = [];
      const label = (hit, lines, opts, required = false) => {
        const [pw, ph] = measurePill(ctx, lines, !!opts.accent);
        const top = clamp(hit.sy - ph / 2, 8, H - ph - 8);
        let first = null;
        for (const x of [hit.sx + hit.half + 12, hit.sx - hit.half - 12 - pw]) {
          const rect = [clamp(x, 8, W - pw - 8), top, pw, ph];
          if (!first) first = rect;
          if (taken.some((r) => overlaps(r, rect)) || avoid.some((r) => overlaps(r, rect))) continue;
          drawPill(ctx, rect, lines, opts);
          taken.push(rect);
          return rect;
        }
        if (!required) return null;
        drawPill(ctx, first, lines, opts);
        taken.push(first);
        return first;
      };

      if (selectedHit && amount < 0.98) {
        if (fx.hex !== w.selected) {
          fx.hex = w.selected;
          fx.at = now;
        }
        const s = clamp((now - fx.at) / 260, 0, 1), ease = 1 - Math.pow(1 - s, 3);
        const half = selectedHit.half + 5 + (1 - ease) * 26;
        const a = (0.35 + 0.65 * ease) * (1 - amount);
        ctx.save();
        ctx.shadowColor = `rgba(${C.cyan},0.75)`;
        ctx.shadowBlur = 10;
        brackets(ctx, selectedHit.sx, selectedHit.sy, half, Math.min(9, half * 0.5), C.cyan, a, 1.8);
        ctx.restore();
        const t = selectedHit.t, cat = picker.categories.get(t.hex);
        const sub = [typeNameFor(t.meta) || t.meta?.t, cat?.phaseLabel, fmtKm(selectedHit.dist)].filter(Boolean).join(' · ');
        label(selectedHit, [contactLabel(t.meta, t.hex), sub], { accent: C.cyan, alpha: a }, true);
      } else if (!w.selected) fx.hex = null;

      if (hover && hover.hex !== w.selected && amount < 0.98) {
        brackets(ctx, hover.sx, hover.sy, hover.half + 6, Math.min(8, hover.half * 0.5 + 2), C.ice, 0.95, 1.6);
        const t = hover.t;
        const sub = [typeNameFor(t.meta) || t.meta?.t, fmtKm(hover.dist), 'click to select'].filter(Boolean).join(' · ');
        label(hover, [contactLabel(t.meta, t.hex), sub], {});
      }

      // DIRECTOR: the next movement's locator (labelled before the phase labels).
      if (next && next.hex !== w.selected && naked > 0.5) {
        const rgb = next.kind === 'landing' ? C.lime : C.amber;
        const count = next.kind === 'landing' ? countdown(next.etaS) : 'now';
        const rw = next.runway ? ' ' + next.runway : '';
        const when = next.kind === 'landing' ? `Lands${rw} · ${count}` : next.kind === 'takeoff' ? `Taking off${rw} · now` : `Climbing out${next.runway ? ' of ' + next.runway : ''}`;
        const a = naked;
        const L = DIRECTOR.locator;
        if (nextHit?.onScreen && nextHit !== hover) {
          const pulse = reduced ? 0 : Math.sin((now / 1000) * ((Math.PI * 2) / 1.8)) * 1.6;
          ring(ctx, nextHit.sx, nextHit.sy, Math.max(L.ringPx, nextHit.half + 9) + pulse, rgb, 0.92 * a);
          label(nextHit, [next.label, when], { accent: rgb, alpha: a }, true);
        } else if (nextTrack && !nextHit?.onScreen) {
          drawnPoint(nextTrack, flight.pos, aim);
          v.set(aim.x - ax, aim.y, aim.z - az).sub(camera.position);
          const behind = v.dot(fwd) < 0;
          v.add(camera.position).project(camera);
          const e = edgeArrow(ctx, W, H, behind ? -v.x : v.x, behind ? -v.y : v.y, L.edgeInsetPx, rgb, avoid);
          pillClear(ctx, e.ex - e.ux * 40 - 44, e.ey + e.uy * 40 - 19, [next.label, when], { w: W, h: H, accent: rgb, alpha: 0.92 * a }, avoid);
        } else if (!nextTrack && next.touchdown?.seen) {
          // Out of sight for now: point at where it will touch down.
          const z = next.touchdown;
          v.set(z.wx - ax, z.y, z.wz - az).sub(camera.position);
          const behind = v.dot(fwd) < 0;
          v.add(camera.position).project(camera);
          const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
          if (!behind && v.z < 1 && sx >= 0 && sx <= W && sy >= 0 && sy <= H) {
            ctx.beginPath();
            ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 9, sy); ctx.lineTo(sx, sy + 7); ctx.lineTo(sx - 9, sy); ctx.closePath();
            ctx.strokeStyle = `rgba(${C.ink},${0.5 * a})`;
            ctx.lineWidth = 3.2;
            ctx.stroke();
            ctx.strokeStyle = `rgba(${rgb},${0.9 * a})`;
            ctx.lineWidth = 1.4;
            ctx.stroke();
            // On its runway it lands here; still turning in, it is expected on the runway in use.
            label({ sx, sy, half: 9 }, [next.label, `${next.runway ? 'Lands' : 'Expected'} here${count === 'now' ? ' now' : ' in ' + count}`], { accent: rgb, alpha: a }, true);
          } else {
            const e = edgeArrow(ctx, W, H, behind ? -v.x : v.x, behind ? -v.y : v.y, L.edgeInsetPx, rgb, avoid);
            pillClear(ctx, e.ex - e.ux * 40 - 44, e.ey + e.uy * 40 - 19, [next.label, `Touchdown${rw} · ${count}`], { w: W, h: H, accent: rgb, alpha: 0.86 * a }, avoid);
          }
        }
      }

      if (naked > 0.5) {
        const phased = hits
          .filter((h) => h.hex !== w.selected && h !== hover && h.onScreen && (!DIRECTOR || h !== nextHit))
          .map((h) => ({ h, cat: picker.categories.get(h.hex) }))
          .filter(({ h, cat }) => (cat?.category === 'arrival' && h.dist < M.labelArrivalM) || (cat?.category === 'departure' && h.dist < M.labelDepartureM))
          .sort((a, b) => a.h.dist - b.h.dist);
        let shown = 0;
        for (const { h, cat } of phased) {
          if (shown >= (DIRECTOR ? DIRECTOR.sky.phaseLabels : M.maxPhaseLabels)) break;
          if (label(h, [`${contactLabel(h.t.meta, h.hex)}  ${cat.category === 'arrival' ? '↘' : '↗'} ${cat.phaseLabel}`], { alpha: 0.82 * naked, accent: cat.category === 'arrival' ? C.lime : C.cyan })) shown++;
        }
      }

      // Selection out of frame: an edge arrow toward it (only while it is
      // visible through the glazing — the overlay never points at a wall).
      if (selectedTrack && !(selectedHit?.onScreen)) {
        drawnPoint(selectedTrack, flight.pos, aim);
        v.set(aim.x - ax, aim.y, aim.z - az).sub(camera.position);
        const behind = v.dot(fwd) < 0;
        v.add(camera.position).project(camera);
        let ux = v.x, uy = v.y;
        if (behind) { ux = -ux; uy = -uy; }
        const len = Math.hypot(ux, uy) || 1;
        ux /= len; uy /= len;
        const inset = 46, hx = W / 2 - inset, hy = H / 2 - inset - 40;
        const s = Math.min(hx / Math.max(1e-6, Math.abs(ux)), hy / Math.max(1e-6, Math.abs(uy)));
        const ex = W / 2 + ux * s, ey = H / 2 - uy * s;
        const ang = Math.atan2(-uy, ux);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-6, -8);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-6, 8);
        ctx.closePath();
        ctx.fillStyle = `rgba(${C.cyan},0.95)`;
        ctx.shadowColor = `rgba(${C.cyan},0.8)`;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
        pill(ctx, ex - ux * 34 - 40, ey + uy * 34 - 12, [contactLabel(selectedTrack.meta, selectedTrack.hex)], { w: W, h: H, accent: C.cyan, alpha: 0.9 });
      }

      // Binocular lock box: hugs the aircraft once the glasses are up (on a
      // phone its smallest size follows the lens radius).
      const { mode } = layoutRef.current;
      const figure = mode === 'desktop' ? null : binocularFigure(mode, W, H, layoutRef.current.insets || undefined);
      if (selectedHit && amount > 0.3) {
        const locked = w.tracking && w.lockError() < fovRad / 8;
        const a = smoothstep(0.3, 0.9, amount);
        const half = Math.max(figure ? Math.max(12, figure.R * MOBILE_GLASS.bino.lockMinFrac) : 16, selectedHit.half * 1.18);
        brackets(ctx, selectedHit.sx, selectedHit.sy, half, Math.min(14, half * 0.35), locked ? C.cyan : C.amber, 0.85 * a, 1.2);
      }

      // DIRECTOR: the reticle fades while steady binoculars frame a held lock.
      if (DIRECTOR) {
        const framed = w.optics.auto && w.tracking && !!selectedHit && w.lockError() < fovRad / 8;
        posts += ((framed ? 0 : 1) - posts) * (1 - Math.exp(-Math.min(0.1, (now - postsAt) / 1000) * 5));
        postsAt = now;
      }

      // --- the binocular mask (only redrawn when it changes) ------------------
      const key = `${Math.round(amount * 400)}|${W}x${H}` + (DIRECTOR ? `|${Math.round(posts * 24)}` : '') + (figure ? `|${mode}|${Math.round(figure.R)}` : '');
      if (key !== maskKey) {
        maskKey = key;
        if (figure) {
          drawPhoneMask(mctx, W, H, amount, DIRECTOR ? Math.round(posts * 24) / 24 : 1, figure);
          // The map credit (AttributionBar, under the lounge) stays readable
          // through the dark: its strip is left clear (licensing).
          const credit = document.querySelector('[data-zone="attribution"] > div')?.getBoundingClientRect();
          const base = mask.getBoundingClientRect();
          if (credit?.width) mctx.clearRect(credit.left - base.left, credit.top - base.top, credit.width, credit.height);
          // The figure the mask was drawn with, for the readouts' probes.
          mask.dataset.figure = JSON.stringify({ mode, R: Math.round(figure.R), lenses: figure.lenses.map((l) => [Math.round(l.cx), Math.round(l.cy)]) });
        } else {
          drawMask(mctx, W, H, amount, DIRECTOR ? Math.round(posts * 24) / 24 : 1);
          if (mask.dataset.figure) delete mask.dataset.figure;
        }
      }
    };

    const syncToGl = pinned(HUD_SYNC, '__flyHudSyncOverride').enabled;
    let unsubscribe = null;
    if (syncToGl) unsubscribe = addAfterEffect(draw);
    else raf = requestAnimationFrame(draw);
    // Read-only handle for probes: this frame's projected pick targets.
    runtime.loungePicker = picker;
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe?.();
      picker.hits.length = 0;
      picker.hover = null;
      if (runtime.airportWatch) runtime.airportWatch.hover = null;
      if (runtime.loungePicker === picker) delete runtime.loungePicker;
    };
  }, [runtime, picker]);

  return (
    <>
      <canvas ref={markRef} className="lounge-canvas lounge-marks" data-testid="lounge-marks" aria-hidden="true" />
      <canvas ref={maskRef} className="lounge-canvas lounge-mask" data-testid="binocular-mask" aria-hidden="true" />
    </>
  );
}

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addAfterEffect } from '@react-three/fiber';
import { MPS_TO_KT, M_TO_FT, RAD2DEG, DEG2RAD, mercatorScale } from '@/lib/fly/coords';
import { renderView } from '@/lib/fly/render-view';
import { livingWorldBlock } from '@/lib/fly/living-world';
import { useFlyStore } from '@/stores/fly-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import './flight-instruments.css';

/**
 * LIVING WORLD — FLIGHT_INSTRUMENTS (FLY_LIVING_WORLD.md, UI-FLIGHT).
 *
 * The flight HUD as instruments rather than a text table: a speed tape with
 * its trend and the throttle annunciator, an altitude tape with the vertical
 * speed cue and the radar altitude, a heading scale, the flight-path marker
 * (where the aircraft is actually going) and, on desktop, a short conformal
 * pitch ladder around it.
 *
 * FRAME SYNC (R24 HUD_SYNC, recon FL-01). Everything that moves is written
 * from `addAfterEffect`, i.e. after every R3F root has rendered, so the
 * flight-path marker is projected through the camera matrices of the frame it
 * sits on and the tapes read the same simulation step. A marker drawn from its
 * own rAF or a 10 Hz interval would be a picture of the previous frame and
 * visibly swim against the horizon while turning.
 *
 * The velocity is the RENDERED motion: the per-frame change of the pose the
 * camera follows (renderView), in world units. Horizontal world units are
 * Mercator-scaled metres and vertical ones are true metres, so the marker sits
 * where the aircraft visibly goes, and the ladder rungs are built the same way
 * (a true pitch angle θ in render space), so the marker on the 10 rung means a
 * true 10° climb.
 *
 * React renders the static structure (tick slots, masks) per layout; the frame
 * callback only writes transforms and text when they change. No React state
 * per frame.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const fmtThousands = (n) => {
  const s = String(Math.abs(Math.round(n)));
  const out = s.length > 3 ? `${s.slice(0, -3)},${s.slice(-3)}` : s;
  return n < 0 ? `-${out}` : out;
};

/** Where every instrument sits for a viewport (CSS px). Pure; tested by the gate. */
export function instrumentLayout(w, h, { phone = false, landscape = false, cfg = {} } = {}) {
  const cx = w / 2;
  const cy = h / 2;
  const kind = phone ? (landscape ? 'landscape' : 'portrait') : 'desktop';
  let tapeH, tapeW, off, headW, headGap, font;
  if (kind === 'portrait') {
    // Clear of the contracts chip above (ends ~283 px on a 390×844 phone) and
    // the Spotting toggle and stick below; the readout boxes stay off the
    // screen edges.
    tapeH = clamp(h * 0.18, 130, 160);
    tapeW = 44;
    off = clamp(w * 0.27, 96, 120);
    headW = Math.min(190, w * 0.48);
    headGap = 30;
    font = 10;
  } else if (kind === 'landscape') {
    // The heading labels stay under the nearest-place line (top ~3.1rem);
    // the altitude box stays clear of the flight deck's right-hand panel.
    tapeH = clamp(h * 0.33, 116, 140);
    tapeW = 48;
    off = clamp(w * 0.2, 140, 220);
    headW = Math.min(240, w * 0.3);
    headGap = 30;
    font = 10;
  } else {
    tapeH = clamp(h * 0.32, 190, 300);
    tapeW = 64;
    off = clamp(w * 0.21, 168, 360);
    // Keep the left tape and its readout box clear of the 296 px operations
    // panel (left 18 px): the box reaches 7 px + its width past the spine.
    const box = Math.max(tapeW + 10, Math.ceil((11 + 6) * 0.62 * 6 + 14));
    off = Math.max(140, Math.min(off, cx - 330 - Math.max(tapeW, 7 + box)));
    headW = clamp(w * 0.27, 300, 440);
    headGap = 44;
    font = 11;
  }
  const speed = cfg.speed?.[kind] ?? { window: kind === 'desktop' ? 60 : 45, step: 10, label: 20 };
  const alt = cfg.altitude?.[kind] ?? { window: kind === 'desktop' ? 600 : 450, step: 100, label: 200 };
  const heading = cfg.heading?.[kind] ?? { window: kind === 'desktop' ? 30 : 25, step: 5, label: 10 };
  const ladder = (cfg.ladder?.[kind] ?? kind === 'desktop') === true;
  const top = cy - tapeH / 2;
  return {
    kind,
    w,
    h,
    cx,
    cy,
    font,
    tapeH,
    tapeW,
    speed: { ...speed, x: cx - off, ppu: tapeH / 2 / speed.window, side: -1 },
    alt: { ...alt, x: cx + off, ppu: tapeH / 2 / alt.window, side: 1 },
    heading: { ...heading, y: top - headGap, w: headW, ppu: headW / 2 / heading.window },
    // The HUD "glass": the marker and the ladder stay inside it, below the
    // heading readout and between the tapes.
    field: { x0: cx - off + 14, x1: cx + off - 14, y0: top - headGap + 9 + font * 2 + 12, y1: cy + tapeH / 2 + (kind === 'desktop' ? 34 : 4) },
    ladder,
  };
}

/**
 * Where a world DIRECTION (a point at infinity) lands on a w×h screen through
 * `cam` as it was last rendered (matrixWorldInverse and projectionMatrix, so
 * view offsets and lens shifts are honoured). Writes CSS px into `out`;
 * false when the direction points behind the camera.
 */
export function projectDirection(cam, x, y, z, w, h, out) {
  const e = cam.matrixWorldInverse.elements;
  const cx = e[0] * x + e[4] * y + e[8] * z;
  const cy = e[1] * x + e[5] * y + e[9] * z;
  const cz = e[2] * x + e[6] * y + e[10] * z;
  const p = cam.projectionMatrix.elements;
  const W = p[3] * cx + p[7] * cy + p[11] * cz;
  if (!(W > 1e-6)) return false;
  out[0] = (((p[0] * cx + p[4] * cy + p[8] * cz) / W + 1) / 2) * w;
  out[1] = ((1 - (p[1] * cx + p[5] * cy + p[9] * cz) / W) / 2) * h;
  return true;
}

/** Tick slots for a tape whose base value is aligned to the label step (so major/minor never change). */
function slots(t) {
  const kmin = Math.floor((-t.window - t.step) / t.step);
  const kmax = Math.ceil((t.label + t.window + t.step) / t.step);
  const out = [];
  for (let k = kmin; k <= kmax; k++) out.push({ k, major: (k * t.step) % t.label === 0 });
  return out;
}

const LADDER = [];
for (let deg = -80; deg <= 80; deg += 10) LADDER.push(deg);

function Tape({ t, layout, scrollRef, labelRefs, readoutRef, children, testid, title }) {
  const { tapeH, tapeW, cy, font } = layout;
  const side = t.side; // -1 = left tape (speed), +1 = right tape (altitude)
  const spine = t.x; // the inner edge, facing the centre
  const outer = spine + side * tapeW;
  const ticks = slots(t);
  const y0 = cy - tapeH / 2;
  const maskId = `fi-mask-${testid}`;
  const tickLen = (major) => (major ? 11 : 6);
  const readoutFont = layout.kind === 'desktop' ? font + 6 : font + 3;
  const box = { w: Math.max(tapeW + 10, Math.ceil(readoutFont * 0.62 * 6 + 14)), h: Math.round(readoutFont * 1.75) };
  // A pointer box: a tag whose point touches the spine.
  const bx0 = spine + side * 7;
  const bx1 = spine + side * (7 + box.w);
  const by0 = cy - box.h / 2;
  const by1 = cy + box.h / 2;
  const boxPath = `M${spine} ${cy}L${bx0} ${by0}L${bx1} ${by0}L${bx1} ${by1}L${bx0} ${by1}Z`;
  return (
    <g className="fi-tape" data-testid={`hud-tape-${testid}`}>
      <defs>
        <linearGradient id={`${maskId}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.2" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.8" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={Math.min(spine, outer) - 60} y={y0} width={tapeW + 120} height={tapeH}>
          <rect x={Math.min(spine, outer) - 60} y={y0} width={tapeW + 120} height={tapeH} fill={`url(#${maskId}-g)`} />
        </mask>
      </defs>
      <rect className="fi-tape-band" x={Math.min(spine, outer)} y={y0} width={tapeW} height={tapeH} mask={`url(#${maskId})`} />
      <g mask={`url(#${maskId})`}>
        <line className="fi-halo" x1={spine} y1={y0} x2={spine} y2={y0 + tapeH} />
        <line className="fi-ink fi-spine" x1={spine} y1={y0} x2={spine} y2={y0 + tapeH} />
        <g ref={scrollRef}>
          {['fi-halo', 'fi-ink'].map((cls) => (
            <g key={cls} className={cls}>
              {ticks.map(({ k, major }) => {
                const y = cy - k * t.step * t.ppu;
                return <line key={k} x1={spine} y1={y} x2={spine + side * tickLen(major)} y2={y} />;
              })}
            </g>
          ))}
          {ticks.map(({ k, major }) =>
            major ? (
              <text
                key={k}
                ref={(el) => {
                  labelRefs.current[k] = el;
                }}
                className="fi-text fi-tick-label"
                x={spine + side * 15}
                y={cy - k * t.step * t.ppu}
                textAnchor={side < 0 ? 'end' : 'start'}
                dominantBaseline="central"
                fontSize={font}
              />
            ) : null
          )}
        </g>
        {children}
      </g>
      <path className="fi-box" d={boxPath} />
      <text
        ref={readoutRef}
        className="fi-text fi-readout"
        x={side < 0 ? bx0 - 6 : bx1 - 6}
        y={cy}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={readoutFont}
        data-testid={`hud-tape-${testid}-value`}
      />
      <text className="fi-text fi-caption" x={spine + side * (tapeW / 2)} y={y0 - 10} textAnchor="middle" fontSize={font - 2}>
        {title}
      </text>
    </g>
  );
}

// The block's tunables, resolved once with the flag (a page-load decision).
const cfg = livingWorldBlock('FLIGHT_INSTRUMENTS') ?? {};

export function FlightInstruments({ runtime }) {
  const { isPhone, orientation } = useDeviceLayout();
  const phone = isPhone;
  const landscape = orientation === 'landscape';
  const cameraMode = useFlyStore((s) => s.cameraMode);
  const rootRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(
    () => (size.w > 0 ? instrumentLayout(size.w, size.h, { phone, landscape, cfg }) : null),
    [size.w, size.h, phone, landscape]
  );

  const refs = useRef(null);
  if (!refs.current)
    refs.current = {
      spdScroll: { current: null },
      spdLabels: { current: {} },
      spdValue: { current: null },
      spdTrend: { current: null },
      thr: { current: null },
      altScroll: { current: null },
      altLabels: { current: {} },
      altValue: { current: null },
      vsTrend: { current: null },
      vsText: { current: null },
      agl: { current: null },
      hdgScroll: { current: null },
      hdgLabels: { current: {} },
      hdgValue: { current: null },
      fpm: { current: null },
      ladder: { current: {} },
    };
  const R = refs.current;

  // Hidden (not unmounted) while the cinematic camera films the pair: the
  // marker would be the player's path seen from the side, and the tapes clutter
  // the shot. The frame loop also stops writing.
  const hidden = cameraMode === 'cinema';
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    if (!layout) return undefined;
    // Per-layout write caches: a re-render rebuilds the nodes, so start clean.
    const last = new Map();
    const put = (el, key, attr, value) => {
      if (!el) return;
      const id = key + attr;
      if (last.get(id) === value) return;
      last.set(id, value);
      if (attr === 'text') el.textContent = value;
      else el.setAttribute(attr, value);
    };
    const st = {
      t: 0,
      px: NaN,
      py: 0,
      pz: 0,
      dir: [0, 0, -1],
      haveDir: false,
      vs: 0,
      kt: NaN,
      accel: 0,
      epoch: -1,
      spdBase: NaN,
      altBase: NaN,
      hdgBase: NaN,
    };
    const trendSec = cfg.trendSec ?? 6;
    const speedTrendSec = cfg.speedTrendSec ?? 8;
    const { speed: S, alt: A, heading: H, field: F } = layout;

    const projDir = (cam, x, y, z, out) => projectDirection(cam, x, y, z, layout.w, layout.h, out);
    const a = [0, 0];
    const b = [0, 0];

    const writeTape = (tape, value, base, scrollEl, labels, keyPrefix, fmt, valid) => {
      const b0 = Math.floor(value / tape.label) * tape.label;
      if (b0 !== base) {
        for (const k in labels) {
          const v = b0 + Number(k) * tape.step;
          put(labels[k], `${keyPrefix}l${k}`, 'text', valid(v) ? fmt(v) : '');
        }
      }
      put(scrollEl, keyPrefix, 'transform', `translate(0 ${((value - b0) * tape.ppu).toFixed(2)})`);
      return b0;
    };

    const frame = (timestamp) => {
      const f = runtime.flight;
      const cam = runtime.camera;
      if (!f || !cam || hiddenRef.current) return;
      const view = renderView(f);
      const now = (timestamp ?? performance.now()) / 1000;
      const dt = st.t ? now - st.t : 0;
      st.t = now;
      const k = mercatorScale(f.latDeg || 0);
      const epoch = useFlyStore.getState().warpEpoch;
      const p = view.pos;
      // --- the rendered motion ------------------------------------------------
      if (epoch !== st.epoch || !Number.isFinite(st.px) || !(dt > 0) || dt > 0.5) {
        st.epoch = epoch;
        st.vs = 0;
        st.accel = 0;
        st.kt = NaN;
      } else {
        const dx = p.x - st.px;
        const dy = p.y - st.py;
        const dz = p.z - st.pz;
        const d = Math.hypot(dx, dy, dz);
        const reach = ((f.speed || 0) * k + 120) * dt * 3 + 5;
        if (d > 1e-4 && d < reach) {
          st.dir[0] = dx / d;
          st.dir[1] = dy / d;
          st.dir[2] = dz / d;
          st.haveDir = true;
        }
        if (d < reach) st.vs += (dy / dt - st.vs) * (1 - Math.exp(-dt / 0.35));
      }
      st.px = p.x;
      st.py = p.y;
      st.pz = p.z;

      // --- speed ----------------------------------------------------------------
      const kt = (f.speed || 0) * MPS_TO_KT;
      if (Number.isFinite(st.kt) && dt > 0) st.accel += ((kt - st.kt) / dt - st.accel) * (1 - Math.exp(-dt / 0.6));
      st.kt = kt;
      st.spdBase = writeTape(S, kt, st.spdBase, R.spdScroll.current, R.spdLabels.current, 's', (v) => String(v), (v) => v >= 0);
      put(R.spdValue.current, 'sv', 'text', String(Math.round(kt)));
      const spdTrend = clamp(st.accel * speedTrendSec, -S.window, S.window);
      put(R.spdTrend.current, 'st', 'y2', (layout.cy - spdTrend * S.ppu).toFixed(1));
      put(R.spdTrend.current, 'sto', 'opacity', Math.abs(spdTrend) > 2 ? '1' : '0');
      // The annunciator at 10 Hz (input.read() allocates; the FlyHUD cadence).
      if (R.thr.current && now - (st.thrT || 0) >= 0.1) {
        st.thrT = now;
        const cmd = runtime.input?.read?.();
        const ops = runtime.operations;
        const thr = ops?.lowSpeed ? `${Math.round(ops.throttle * 100)}%` : cmd?.boost ? 'BOOST' : (cmd?.speedPreset ?? 'cruise').toUpperCase();
        put(R.thr.current, 'th', 'text', thr);
        put(R.thr.current, 'thb', 'data-boost', thr === 'BOOST' ? '1' : '0');
      }

      // --- altitude, vertical speed, radar altitude ------------------------------
      const ft = f.pos.y * M_TO_FT;
      st.altBase = writeTape(A, ft, st.altBase, R.altScroll.current, R.altLabels.current, 'a', fmtThousands, () => true);
      put(R.altValue.current, 'av', 'text', fmtThousands(Math.round(ft / 10) * 10));
      const fpm = st.vs * M_TO_FT * 60;
      const vsTrend = clamp(st.vs * M_TO_FT * trendSec, -A.window, A.window);
      put(R.vsTrend.current, 'vt', 'y2', (layout.cy - vsTrend * A.ppu).toFixed(1));
      put(R.vsTrend.current, 'vto', 'opacity', Math.abs(fpm) >= 100 ? '1' : '0');
      const vsTxt = Math.abs(fpm) >= 100 ? `${fpm > 0 ? '▲' : '▼'} ${fmtThousands(Math.round(Math.abs(fpm) / 50) * 50)}` : '';
      put(R.vsText.current, 'vs', 'text', vsTxt);
      const aglFt = Number.isFinite(f.agl) ? f.agl * M_TO_FT : NaN;
      put(R.agl.current, 'ag', 'text', Number.isFinite(aglFt) ? `AGL ${fmtThousands(Math.round(aglFt / 10) * 10)}` : 'AGL —');
      put(R.agl.current, 'agw', 'data-warn', Number.isFinite(aglFt) && aglFt < 500 && fpm < -300 ? '1' : '0');

      // --- heading ---------------------------------------------------------------
      let hdg = (view.heading ?? f.heading) * RAD2DEG;
      hdg = ((hdg % 360) + 360) % 360;
      const hb = Math.floor(hdg / H.label) * H.label;
      if (hb !== st.hdgBase) {
        st.hdgBase = hb;
        const labels = R.hdgLabels.current;
        for (const kk in labels) {
          const v = (((hb + Number(kk) * H.step) % 360) + 360) % 360;
          const card = v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : String(v).padStart(3, '0');
          put(labels[kk], `hl${kk}`, 'text', card);
          put(labels[kk], `hc${kk}`, 'data-card', v % 90 === 0 ? '1' : '0');
        }
      }
      put(R.hdgScroll.current, 'h', 'transform', `translate(${(-(hdg - hb) * H.ppu).toFixed(2)} 0)`);
      put(R.hdgValue.current, 'hv', 'text', String(Math.round(hdg) % 360).padStart(3, '0'));

      // --- flight-path marker and ladder -------------------------------------------
      const crashed = runtime.crash && runtime.crash.state && runtime.crash.state !== 'idle';
      const freeLook = (runtime.chaseRig?._freeAmt ?? 0) > 0.35;
      const moving = (f.speed || 0) > 12 && !runtime.operations?.grounded;
      const showFpm = st.haveDir && moving && !crashed && !freeLook;
      let fpmIn = false;
      let gamma = 0;
      let psi = 0;
      if (showFpm) {
        const [dx, dy, dz] = st.dir;
        const hz = Math.hypot(dx, dz);
        psi = Math.atan2(dx, -dz);
        gamma = Math.atan2(dy * k, hz);
        if (projDir(cam, dx, dy, dz, a)) {
          fpmIn = a[0] > F.x0 && a[0] < F.x1 && a[1] > F.y0 && a[1] < F.y1;
          const x = clamp(a[0], F.x0, F.x1);
          const y = clamp(a[1], F.y0, F.y1);
          put(R.fpm.current, 'fp', 'transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        } else {
          put(R.fpm.current, 'fp', 'transform', `translate(${layout.cx} ${F.y1})`);
        }
      }
      put(R.fpm.current, 'fpo', 'data-state', !showFpm ? 'off' : fpmIn ? 'on' : 'caged');

      // The ladder is conformal: every rung sits where that true pitch angle
      // is along the marker's azimuth, so whichever rungs fall inside the
      // glass are drawn (a caged marker in a steep climb still shows the
      // 10/20/30 rungs sliding past). Rungs fade toward the glass edges and
      // away from the marker, so at most two or three read at once.
      if (layout.ladder) {
        const gDeg = gamma * RAD2DEG;
        const sp = Math.sin(psi);
        const cp = Math.cos(psi);
        const sp2 = Math.sin(psi + 2 * DEG2RAD);
        const cp2 = Math.cos(psi + 2 * DEG2RAD);
        for (const deg of LADDER) {
          const el = R.ladder.current[deg];
          if (!el) continue;
          const th = deg * DEG2RAD;
          const ch = Math.cos(th) * k;
          const sh = Math.sin(th);
          if (!showFpm || !projDir(cam, sp * ch, sh, -cp * ch, a) || !projDir(cam, sp2 * ch, sh, -cp2 * ch, b)) {
            put(el, `r${deg}`, 'data-on', '0');
            continue;
          }
          const edge = smooth(F.y0, F.y0 + 36, a[1]) * (1 - smooth(F.y1 - 36, F.y1, a[1]));
          const near = 1 - 0.55 * smooth(12, 32, Math.abs(deg - gDeg));
          const alpha = edge * near;
          if (alpha <= 0.02) {
            put(el, `r${deg}`, 'data-on', '0');
            continue;
          }
          const rot = Math.atan2(b[1] - a[1], b[0] - a[0]) * RAD2DEG;
          put(el, `r${deg}`, 'data-on', '1');
          put(el, `rt${deg}`, 'transform', `translate(${a[0].toFixed(1)} ${a[1].toFixed(1)}) rotate(${rot.toFixed(2)})`);
          put(el, `ro${deg}`, 'opacity', alpha.toFixed(2));
        }
      }
    };
    return addAfterEffect(frame);
    // R holds stable ref boxes; the tunables are a page-load constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, runtime]);

  const font = layout?.font ?? 11;
  return (
    <svg
      ref={rootRef}
      className="fi"
      data-testid="hud-instruments"
      data-kind={layout?.kind ?? 'pending'}
      data-hidden={hidden ? '1' : '0'}
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={layout ? `0 0 ${layout.w} ${layout.h}` : undefined}
    >
      {layout && (
        <>
          <defs>
            <clipPath id="fi-field">
              <rect x={layout.field.x0} y={layout.field.y0} width={layout.field.x1 - layout.field.x0} height={layout.field.y1 - layout.field.y0} />
            </clipPath>
            <linearGradient id="fi-head-g" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.18" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.82" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="fi-head-mask" maskUnits="userSpaceOnUse" x={layout.cx - layout.heading.w / 2} y={layout.heading.y - 40} width={layout.heading.w} height={60}>
              <rect x={layout.cx - layout.heading.w / 2} y={layout.heading.y - 40} width={layout.heading.w} height={60} fill="url(#fi-head-g)" />
            </mask>
          </defs>

          {/* Pitch ladder (desktop): conformal rungs around the marker. */}
          {layout.ladder && (
            <g className="fi-ladder" clipPath="url(#fi-field)">
              {LADDER.map((deg) => {
                const gap = 44;
                const len = deg === 0 ? 120 : 54;
                const tip = deg === 0 ? 0 : deg > 0 ? 7 : -7;
                const d = `M${-gap - len} ${tip}V0H${-gap}M${gap} 0H${gap + len}V${tip}`;
                return (
                  <g
                    key={deg}
                    ref={(el) => {
                      R.ladder.current[deg] = el;
                    }}
                    data-on="0"
                    data-deg={deg}
                    className={deg === 0 ? 'fi-rung fi-horizon' : deg < 0 ? 'fi-rung fi-neg' : 'fi-rung'}
                  >
                    <path className="fi-halo" d={d} />
                    <path className="fi-ink" d={d} />
                    {deg !== 0 && (
                      <>
                        <text className="fi-text fi-rung-label" x={-gap - len - 6} y={0} textAnchor="end" dominantBaseline="central" fontSize={font - 1}>
                          {Math.abs(deg)}
                        </text>
                        <text className="fi-text fi-rung-label" x={gap + len + 6} y={0} textAnchor="start" dominantBaseline="central" fontSize={font - 1}>
                          {Math.abs(deg)}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Heading scale */}
          <g className="fi-heading" data-testid="hud-heading-scale">
            <g mask="url(#fi-head-mask)">
              <g ref={R.hdgScroll}>
                {['fi-halo', 'fi-ink'].map((cls) => (
                  <g key={cls} className={cls}>
                    {slots(layout.heading).map(({ k, major }) => {
                      const x = layout.cx + k * layout.heading.step * layout.heading.ppu;
                      return <line key={k} x1={x} y1={layout.heading.y} x2={x} y2={layout.heading.y - (major ? 9 : 5)} />;
                    })}
                  </g>
                ))}
                {slots(layout.heading).map(({ k, major }) =>
                  major ? (
                    <text
                      key={k}
                      ref={(el) => {
                        R.hdgLabels.current[k] = el;
                      }}
                      className="fi-text fi-tick-label"
                      x={layout.cx + k * layout.heading.step * layout.heading.ppu}
                      y={layout.heading.y - 18}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={font}
                    />
                  ) : null
                )}
              </g>
              <line className="fi-halo" x1={layout.cx - layout.heading.w / 2} y1={layout.heading.y} x2={layout.cx + layout.heading.w / 2} y2={layout.heading.y} />
              <line className="fi-ink fi-spine" x1={layout.cx - layout.heading.w / 2} y1={layout.heading.y} x2={layout.cx + layout.heading.w / 2} y2={layout.heading.y} />
            </g>
            <path className="fi-box" d={`M${layout.cx} ${layout.heading.y + 2}l6 7h17v${font * 2}h-46v-${font * 2}h17z`} />
            <text
              ref={R.hdgValue}
              className="fi-text fi-readout"
              x={layout.cx}
              y={layout.heading.y + 9 + font}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={font + 3}
              data-testid="hud-heading-value"
            />
          </g>

          <Tape t={layout.speed} layout={layout} scrollRef={R.spdScroll} labelRefs={R.spdLabels} readoutRef={R.spdValue} testid="speed" title="SPD KT">
            <line ref={R.spdTrend} className="fi-trend" x1={layout.speed.x - 3} y1={layout.cy} x2={layout.speed.x - 3} y2={layout.cy} opacity="0" />
          </Tape>
          <text
            ref={R.thr}
            className="fi-text fi-annunciator"
            data-testid="hud-throttle-mode"
            x={layout.speed.x - layout.tapeW / 2}
            y={layout.cy + layout.tapeH / 2 + 16}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={font}
          />

          <Tape t={layout.alt} layout={layout} scrollRef={R.altScroll} labelRefs={R.altLabels} readoutRef={R.altValue} testid="altitude" title="ALT FT">
            <line ref={R.vsTrend} className="fi-trend" x1={layout.alt.x + 3} y1={layout.cy} x2={layout.alt.x + 3} y2={layout.cy} opacity="0" />
          </Tape>
          <text
            ref={R.vsText}
            className="fi-text fi-vs"
            data-testid="hud-vertical-speed"
            x={layout.alt.x + layout.tapeW / 2}
            y={layout.cy + layout.tapeH / 2 + 16}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={font}
          />
          <text
            ref={R.agl}
            className="fi-text fi-agl"
            data-testid="hud-radar-altitude"
            x={layout.alt.x + layout.tapeW / 2}
            y={layout.cy + layout.tapeH / 2 + 16 + font * 1.6}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={font}
          />

          {/* Flight-path marker */}
          <g ref={R.fpm} className="fi-fpm" data-state="off" data-testid="hud-flight-path-marker">
            {['fi-halo', 'fi-ink'].map((cls) => (
              <g key={cls} className={cls}>
                <circle r="6.5" />
                <path d="M-6.5 0H-17M6.5 0H17M0 -6.5V-13" />
              </g>
            ))}
          </g>
        </>
      )}
    </svg>
  );
}

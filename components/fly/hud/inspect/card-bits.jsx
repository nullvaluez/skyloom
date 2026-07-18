'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { CARD_THEME } from './inspect-tokens';

/**
 * Shared INK CODEX card atoms. Exported separately so a later InfoCard
 * restyle can adopt them without touching the inspect modal.
 */

/**
 * Rolling number: a rAF tween writing textContent directly — the 500ms
 * live-telemetry interval stays the ONLY React state churn; the tween
 * itself never renders. Counts up from 0 on mount (600ms), then eases
 * between live updates (250ms).
 */
export function Odometer({ value, format, className, style }) {
  const ref = useRef(null);
  const anim = useRef({ shown: 0, raf: 0, mounted: false });
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    const a = anim.current;
    const target = Number.isFinite(value) ? value : 0;
    const from = a.mounted ? a.shown : 0;
    const dur = a.mounted ? 250 : 600;
    a.mounted = true;
    const t0 = performance.now();
    cancelAnimationFrame(a.raf);
    const tick = () => {
      const u = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - u, 3); // easeOutCubic
      a.shown = from + (target - from) * e;
      if (ref.current) {
        ref.current.textContent = fmt.current
          ? fmt.current(a.shown)
          : Math.round(a.shown).toLocaleString();
      }
      if (u < 1) a.raf = requestAnimationFrame(tick);
    };
    a.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(a.raf);
  }, [value]);

  return <span ref={ref} className={className} style={style} />;
}

/** Rarity tier chip — the card's second saturated voice. */
export function RarityChip({ tier }) {
  if (!tier) return null;
  return (
    <span
      className="rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]"
      style={{
        color: tier.color,
        borderColor: `${tier.color}55`,
        background: `${tier.color}14`,
      }}
    >
      ◆ {tier.name}
    </span>
  );
}

/** Hero-tinted airline lettermark (safe stand-in for logo CDNs). */
export function MonogramChip({ code }) {
  if (!code) return null;
  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] font-bold"
      style={{
        color: 'var(--hero)',
        borderColor: 'color-mix(in srgb, var(--hero) 55%, transparent)',
        background: 'color-mix(in srgb, var(--hero) 12%, transparent)',
      }}
    >
      {code}
    </span>
  );
}

/** One arcade meter row: label · animated fill bar · odometer value. */
export function StatBar({ label, pct, delay = 0, children }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-[30px] text-[9px] font-semibold uppercase tracking-widest"
        style={{ color: CARD_THEME.iceDim }}
      >
        {label}
      </div>
      <div
        className="relative h-[5px] flex-1 overflow-hidden rounded-full"
        style={{ background: CARD_THEME.panel }}
      >
        <motion.div
          className="absolute inset-0 origin-left rounded-full"
          style={{ background: 'var(--hero)', opacity: 0.85 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.015, Math.min(1, pct ?? 0)) }}
          transition={{ delay, type: 'spring', stiffness: 130, damping: 22 }}
        />
      </div>
      <div
        className="w-[86px] text-right font-mono text-[12px] font-bold"
        style={{ color: CARD_THEME.ice }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Round 7: bearing + relative-altitude chip — where the target sits
 * relative to the player (the card floats over the live world now, so
 * spatial context is the point).
 */
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function BearingChip({ bearingDeg, relAltFt }) {
  if (bearingDeg == null) return null;
  const dir = COMPASS[Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8];
  const rel =
    relAltFt == null
      ? ''
      : Math.abs(relAltFt) < 300
        ? ' · co-alt'
        : relAltFt > 0
          ? ` · ▲ ${Math.round(Math.abs(relAltFt) / 100) / 10}k ft above`
          : ` · ▼ ${Math.round(Math.abs(relAltFt) / 100) / 10}k ft below`;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{ background: CARD_THEME.panel, color: CARD_THEME.iceDim }}
      data-testid="inspect-bearing"
    >
      <span
        className="inline-block leading-none"
        style={{ color: 'var(--hero)', transform: `rotate(${Math.round(bearingDeg)}deg)` }}
      >
        ➤
      </span>
      {dir} {Math.round(bearingDeg)}°{rel}
    </span>
  );
}

/**
 * Round 7: tiny V/S trend sparkline — the last ~10 samples of the 500ms
 * telemetry interval, plain SVG polyline (no deps, no extra state churn:
 * the samples ride the existing live-state updates).
 */
export function Sparkline({ samples, width = 72, height = 20 }) {
  if (!samples || samples.length < 2) return null;
  const max = Math.max(500, ...samples.map((v) => Math.abs(v)));
  const pts = samples
    .map((v, i) => {
      const x = (i / (samples.length - 1)) * (width - 2) + 1;
      const y = height / 2 - (v / max) * (height / 2 - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-testid="inspect-sparkline"
      aria-hidden="true"
    >
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={CARD_THEME.edgeSoft} strokeWidth="1" />
      <polyline points={pts} fill="none" stroke="var(--hero)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Route progress row: origin ──✈── destination with a hero-colored fill at
 * route.progressPercent, distance/ETA line under. Ghosts when unknown.
 */
export function RouteProgress({ route, loading = false }) {
  const o = route?.origin;
  const d = route?.destination;
  if (!o && !d) {
    // Honest empty states: a lookup in flight is not the same as "this
    // flight filed no route" (GA/military tails legitimately 404 upstream).
    return (
      <div
        className={`flex items-center justify-center rounded-xl px-3 py-2 text-[10px] uppercase tracking-[0.3em] ${loading ? 'animate-pulse' : ''}`}
        style={{ background: CARD_THEME.panel, color: CARD_THEME.iceFaint }}
        data-testid="inspect-route-unknown"
      >
        {loading ? 'route lookup…' : 'no filed route'}
      </div>
    );
  }
  const pct = route.progressPercent;
  const sub = [
    route.totalDistanceNm ? `${route.totalDistanceNm.toLocaleString()} nm` : null,
    pct != null ? `${pct}%` : null,
    route.timeRemaining ? `ETA ${route.timeRemaining}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="rounded-xl px-3 py-2" style={{ background: CARD_THEME.panel }}>
      <div className="flex items-center gap-2.5">
        <span
          className="font-mono text-[15px] font-bold leading-none"
          style={{ color: CARD_THEME.ice }}
          title={o?.name}
        >
          {o?.iata || o?.icao || '···'}
        </span>
        <div
          className="relative h-[4px] flex-1 rounded-full"
          style={{ background: 'rgba(207, 238, 248, 0.12)' }}
        >
          {pct != null ? (
            <>
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: 'var(--hero)', opacity: 0.9 }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, ease: 'easeOut', delay: 0.35 }}
              />
              <motion.span
                className="absolute -top-[8px] text-[12px] leading-none"
                style={{ color: 'var(--hero)', left: `calc(${pct}% - 7px)` }}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6 }}
              >
                ✈
              </motion.span>
            </>
          ) : null}
        </div>
        <span
          className="font-mono text-[15px] font-bold leading-none"
          style={{ color: CARD_THEME.ice }}
          title={d?.name}
        >
          {d?.iata || d?.icao || '···'}
        </span>
      </div>
      {sub && (
        <div className="mt-1.5 text-center text-[10px]" style={{ color: CARD_THEME.iceDim }}>
          {sub}
        </div>
      )}
    </div>
  );
}

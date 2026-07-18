'use client';

import { useEffect, useRef } from 'react';
import { MPS_TO_KT, M_TO_FT, RAD2DEG } from '@/lib/fly/coords';
import { usePassportStore } from '@/stores/passport-store';
import { useFlyStore } from '@/stores/fly-store';
import { useIsTouch } from '@/hooks/use-is-touch';

/**
 * Flight readouts. DOM text updated at 10Hz from the shared runtime via
 * refs — no React state per tick, no work inside the frame loop.
 */
export function FlyHUD({ runtime }) {
  // Round 8 fix (F5): live tier readout — PerformanceMonitor degrades were
  // invisible outside the pause menu, making "why does it look flat?"
  // undiagnosable mid-flight. Store-subscribed, so it is always current.
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const isTouch = useIsTouch();
  const spdRef = useRef(null);
  const altRef = useRef(null);
  const aglRef = useRef(null);
  const hdgRef = useRef(null);
  const presetRef = useRef(null);
  const poiRef = useRef(null);
  const spotsRef = useRef(null);
  const chaseRef = useRef(null);
  const latRef = useRef(null);
  const lonRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => {
      const f = runtime.flight;
      if (!f) return;
      // Live geographic position ("where are we"). runtime.geo is a
      // Vector3(lon, lat, altM) written every 3rd frame by FlyScene; hemisphere
      // letters avoid a stray minus sign reading as "no fix".
      const g = runtime.geo;
      if (g && latRef.current && lonRef.current) {
        latRef.current.textContent = `${Math.abs(g.y).toFixed(4)}°${g.y >= 0 ? 'N' : 'S'}`;
        lonRef.current.textContent = `${Math.abs(g.x).toFixed(4)}°${g.x >= 0 ? 'E' : 'W'}`;
      }
      if (spdRef.current)
        spdRef.current.textContent = Math.round(f.speed * MPS_TO_KT);
      if (altRef.current)
        altRef.current.textContent = Math.round(f.pos.y * M_TO_FT).toLocaleString();
      if (aglRef.current)
        aglRef.current.textContent = Number.isFinite(f.agl)
          ? Math.round(f.agl * M_TO_FT).toLocaleString()
          : '—';
      if (hdgRef.current) {
        let deg = Math.round(f.heading * RAD2DEG);
        if (deg < 0) deg += 360;
        hdgRef.current.textContent = String(deg % 360).padStart(3, '0');
      }
      if (presetRef.current) {
        const cmd = runtime.input?.read();
        presetRef.current.textContent = cmd?.boost ? 'BOOST' : (cmd?.speedPreset ?? 'cruise').toUpperCase();
      }
      if (poiRef.current) {
        const poi = runtime.nearestPoi; // written by PoiLetters at 0.5Hz
        poiRef.current.textContent = poi ? `◆ ${poi}` : '';
        poiRef.current.style.opacity = poi ? '1' : '0';
      }
      if (spotsRef.current) {
        // persisted Spotter's Passport — read per tick, never reactive
        spotsRef.current.textContent = usePassportStore.getState().stats.totalSpotted;
      }
      if (chaseRef.current) {
        // CHASE feedback: the intercept/formation autopilot was previously
        // invisible — ordering a chase looked like a dead button.
        const mode = runtime.autopilot?.mode;
        const t = runtime.targeting?.target;
        if (mode && mode !== 'off' && t) {
          const name = t.meta?.flight || t.meta?.r || t.hex?.toUpperCase() || '';
          const nm = (t.distM / 1852).toFixed(1);
          const cinema = useFlyStore.getState().cameraMode === 'cinema';
          chaseRef.current.textContent = cinema
            ? `◉ CINEMA · ${name} · C to exit`
            : `${mode === 'formation' ? '◎ FORMATION' : '◎ INTERCEPT'} · ${name} · ${nm}nm · C cinema`;
          chaseRef.current.style.opacity = '1';
        } else {
          chaseRef.current.style.opacity = '0';
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [runtime]);

  // max-sm: overrides keep desktop pixel-identical while the phone gets a
  // tighter, notch-safe strip (AGL + Spots fold away below 640px).
  const cell = 'flex flex-col items-center px-3 max-sm:px-2';
  const label = 'text-[9px] uppercase tracking-widest text-zinc-400 max-sm:text-[8px]';
  const value = 'font-mono text-lg leading-6 text-zinc-50 max-sm:text-sm max-sm:leading-5';

  return (
    <>
      {/* steering reference: the cursor's offset from this dot is the command */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />

      {/* "Where am I" — nearest airport/city + bearing, video-game style.
          On phones it sits below the notch-safe stats strip. */}
      <div
        ref={poiRef}
        className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90 transition-opacity duration-500 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)] max-sm:top-[calc(env(safe-area-inset-top)+4.75rem)]"
      />

      {/* Active chase/intercept chip — visible payoff for the CHASE button */}
      <div
        ref={chaseRef}
        data-testid="hud-chase-chip"
        className="pointer-events-none absolute left-1/2 top-27 z-10 -translate-x-1/2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/90 opacity-0 transition-opacity duration-300 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)] max-sm:top-[calc(env(safe-area-inset-top)+6.5rem)]"
      />

      <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 divide-x divide-zinc-700 rounded-lg bg-zinc-950/60 py-1.5 backdrop-blur-sm max-sm:top-[calc(env(safe-area-inset-top)+0.375rem)]">
        <div className={cell}>
          <span className={label}>SPD KT</span>
          <span className={value} ref={spdRef}>—</span>
        </div>
        <div className={cell}>
          <span className={label}>ALT FT</span>
          <span className={value} ref={altRef}>—</span>
        </div>
        {/* AGL folds away on phones — the compact strip keeps SPD/ALT/HDG/THR */}
        <div className={`${cell} max-sm:hidden`}>
          <span className={label}>AGL FT</span>
          <span className={value} ref={aglRef}>—</span>
        </div>
        <div className={cell}>
          <span className={label}>HDG</span>
          <span className={value} ref={hdgRef}>—</span>
        </div>
        <div className={cell}>
          <span className={label}>Throttle</span>
          <span className={value} ref={presetRef}>—</span>
        </div>
        {/* LAST cell on purpose: verify-fly.js indexes .font-mono [0..4].
            Hidden on phones (Spots also lives on the inspect card). */}
        <div className={`${cell} max-sm:hidden`}>
          <span className={label}>Spots</span>
          <span className={value} ref={spotsRef}>—</span>
        </div>
        {/* Live position — "where are we" (per user). Folds away on the compact
            phone strip; desktop shows lat/lon with N/S · E/W hemispheres. */}
        <div className={`${cell} max-sm:hidden`}>
          <span className={label}>Lat</span>
          <span className={value} ref={latRef}>—</span>
        </div>
        <div className={`${cell} max-sm:hidden`}>
          <span className={label}>Lon</span>
          <span className={value} ref={lonRef}>—</span>
        </div>
      </div>

      {/* Desktop: the full control legend. Touch: the on-screen controls are
          self-explanatory, so drop the mouse/keyboard sentence and keep only
          the tiny live quality-tier chip (out of the way, above attribution). */}
      {isTouch ? (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2">
          <span
            data-testid="hud-quality-tier"
            className="font-mono text-[10px] uppercase tracking-widest text-zinc-500/80"
          >
            Q {qualityTier}
          </span>
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded bg-zinc-950/50 px-3 py-1 text-[11px] text-zinc-400">
          Steer with the mouse · WASD/arrows · 1/2/3 speed · Shift boost · RMB look · click a plane (or T on a lock) to inspect &amp; warp · F intercept · Esc menu
          <span
            data-testid="hud-quality-tier"
            className="ml-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500"
          >
            Q {qualityTier}
          </span>
        </div>
      )}
    </>
  );
}

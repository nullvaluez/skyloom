'use client';

import { useEffect, useRef } from 'react';
import { MPS_TO_KT, M_TO_FT, RAD2DEG } from '@/lib/fly/coords';
import { usePassportStore } from '@/stores/passport-store';

/**
 * Flight readouts. DOM text updated at 10Hz from the shared runtime via
 * refs — no React state per tick, no work inside the frame loop.
 */
export function FlyHUD({ runtime }) {
  const spdRef = useRef(null);
  const altRef = useRef(null);
  const aglRef = useRef(null);
  const hdgRef = useRef(null);
  const presetRef = useRef(null);
  const poiRef = useRef(null);
  const spotsRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => {
      const f = runtime.flight;
      if (!f) return;
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
    }, 100);
    return () => clearInterval(id);
  }, [runtime]);

  const cell = 'flex flex-col items-center px-3';
  const label = 'text-[9px] uppercase tracking-widest text-zinc-400';
  const value = 'font-mono text-lg leading-6 text-zinc-50';

  return (
    <>
      {/* steering reference: the cursor's offset from this dot is the command */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />

      {/* "Where am I" — nearest airport/city + bearing, video-game style */}
      <div
        ref={poiRef}
        className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90 transition-opacity duration-500 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]"
      />

      <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 divide-x divide-zinc-700 rounded-lg bg-zinc-950/60 py-1.5 backdrop-blur-sm">
        <div className={cell}>
          <span className={label}>SPD KT</span>
          <span className={value} ref={spdRef}>—</span>
        </div>
        <div className={cell}>
          <span className={label}>ALT FT</span>
          <span className={value} ref={altRef}>—</span>
        </div>
        <div className={cell}>
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
        {/* LAST cell on purpose: verify-fly.js indexes .font-mono [0..4] */}
        <div className={cell}>
          <span className={label}>Spots</span>
          <span className={value} ref={spotsRef}>—</span>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded bg-zinc-950/50 px-3 py-1 text-[11px] text-zinc-400">
        Steer with the mouse · WASD/arrows · 1/2/3 speed · Shift boost · RMB look · click a plane (or T on a lock) to inspect &amp; warp · F intercept · Esc menu
      </div>
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { WARP } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Warp arrival treatment, keyed on fly-store.warpEpoch.
 *
 * Local warps (target warp / short hop): the original 900ms white flash +
 * ring + "WARP" stamp. Pure DOM/CSS — nothing per-frame.
 *
 * Far warps (round 6, warpKind 'far'): streak → hold → reveal. The hold
 * keeps an ink overlay up while the destination streams in, polling world
 * readiness at 4Hz (toy chunk counts via runtime.toyStats, tile downloads
 * via runtime.engine.downloading in the raster styles), bounded by
 * WARP.far.holdMinMs/holdMaxMs so a slow network can never trap the
 * player. The destination name rides the hold in Archivo Black.
 */
export function WarpFlash({ runtime }) {
  const warpEpoch = useFlyStore((s) => s.warpEpoch);
  const [stage, setStage] = useState(null); // 'flash' | 'streak' | 'hold' | 'reveal'
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    if (warpEpoch === 0) return undefined;
    const kind = useFlyStore.getState().warpKind;
    let cancelled = false;
    const timers = [];
    if (kind !== 'far') {
      setStage('flash');
      timers.push(setTimeout(() => !cancelled && setStage(null), WARP.flashMs));
    } else {
      setStage('streak');
      const t0 = performance.now();
      timers.push(setTimeout(() => !cancelled && setStage('hold'), WARP.flashMs));
      const poll = setInterval(() => {
        const el = performance.now() - t0;
        if (el < WARP.far.holdMinMs) return;
        const rt = runtimeRef.current;
        const ts = rt?.toyStats;
        const ready = ts
          ? ts.ready >= WARP.far.readyChunks ||
            (ts.chunks > 0 && ts.ready / ts.chunks >= WARP.far.readyFrac)
          : (rt?.engine?.downloading ?? 0) < WARP.far.readyDownloads;
        if (ready || el >= WARP.far.holdMaxMs) {
          clearInterval(poll);
          if (cancelled) return;
          setStage('reveal');
          timers.push(setTimeout(() => !cancelled && setStage(null), WARP.far.revealMs));
        }
      }, 250);
      timers.push({ _i: poll });
    }
    return () => {
      cancelled = true;
      for (const t of timers) (t?._i != null ? clearInterval(t._i) : clearTimeout(t));
    };
  }, [warpEpoch]);

  if (!stage) return null;

  if (stage === 'flash') {
    return (
      <div key={warpEpoch} className="pointer-events-none absolute inset-0 z-30">
        <style>{`
          @keyframes fly-warp-flash {
            0% { opacity: 1; }
            55% { opacity: 0.55; }
            100% { opacity: 0; }
          }
          @keyframes fly-warp-ring {
            0% { transform: translate(-50%, -50%) scale(0.05); opacity: 0.9; }
            100% { transform: translate(-50%, -50%) scale(3.2); opacity: 0; }
          }
          @keyframes fly-warp-text {
            0% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; letter-spacing: 1.2em; }
            25% { opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; letter-spacing: 0.4em; }
          }
        `}</style>
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(199,222,255,0.65) 35%, rgba(120,170,255,0.15) 70%, transparent 100%)',
            animation: `fly-warp-flash ${WARP.flashMs}ms ease-out forwards`,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 h-64 w-64 rounded-full border-2 border-white/80"
          style={{ animation: `fly-warp-ring ${WARP.flashMs}ms cubic-bezier(0.16, 1, 0.3, 1) forwards` }}
        />
        <div
          className="absolute left-1/2 top-1/2 font-mono text-3xl font-bold uppercase text-white"
          style={{ animation: `fly-warp-text ${WARP.flashMs}ms ease-out forwards` }}
        >
          Warp
        </div>
      </div>
    );
  }

  // --- far warp: streak / hold / reveal ---------------------------------
  const arrival = useFlyStore.getState().arrival;
  const revealing = stage === 'reveal';
  return (
    <div
      key={warpEpoch}
      className="pointer-events-none absolute inset-0 z-30"
      data-testid="warp-hold"
      data-stage={stage}
      style={{
        opacity: revealing ? 0 : stage === 'streak' ? 1 : 0.92,
        transition: `opacity ${revealing ? WARP.far.revealMs : 250}ms ease-${revealing ? 'in' : 'out'}`,
        background: '#04060f',
      }}
    >
      <style>{`
        @keyframes fly-hyper-streak {
          0% { transform: translate(-50%, -50%) scaleY(0.1); opacity: 0; }
          30% { opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scaleY(60); opacity: 0; }
        }
        @keyframes fly-hold-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
      {/* streak tunnel: a handful of radial lines racing outward */}
      {[...Array(9)].map((_, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="absolute left-1/2 top-1/2 h-2 w-px bg-white/80"
          style={{
            rotate: `${i * 40}deg`,
            translate: `${Math.sin(i * 2.1) * 260}px ${Math.cos(i * 1.7) * 150}px`,
            animation: `fly-hyper-streak 1100ms cubic-bezier(0.5, 0, 0.9, 0.4) ${i * 90}ms infinite`,
          }}
        />
      ))}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ fontFamily: "'Archivo Black', ui-sans-serif" }}
      >
        <div className="text-4xl uppercase tracking-[0.3em] text-white">
          {arrival?.name ?? 'warping'}
        </div>
        <div
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.5em] text-white/60"
          style={{ animation: 'fly-hold-pulse 1.4s ease-in-out infinite' }}
        >
          {stage === 'reveal' ? 'arrived' : 'streaming world'}
        </div>
      </div>
    </div>
  );
}

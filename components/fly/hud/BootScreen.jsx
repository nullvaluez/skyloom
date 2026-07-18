'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BOOT } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * R9-1 boot loading screen — the full-screen INK+ICE overlay that covers the
 * immediately-mounted FlyCanvas until the world is actually ready. Progress
 * is REAL (no fake timers): three weighted gates polled from runtime signals
 * at BOOT.pollMs, weights BOOT.weights (world 60 / fleet 25 / shaders 15).
 *
 *  (a) world — toy: every ring-0 ("full" detail) chunk finalized
 *      (toyStats.fullDone === fullTotal) with the drape queue empty, held
 *      BOOT.worldHoldMs. Satellite: the tile layer has no per-tile ready
 *      event, so the DOCUMENTED CHOICE is the download-queue heuristic —
 *      engine.downloading === 0 held worldHoldMs after in-flight downloads
 *      were observed (a fully browser-cached session that never shows
 *      downloading > 0 passes after BOOT.satGraceMs with frames rendering).
 *  (b) fleet — loadTrafficGeometries() resolved (TrafficLayer flips
 *      runtime.modelsReady; per-model failures degrade inside the loader).
 *  (c) shaders — ≥ BOOT.minFrames rendered frames post-Suspense
 *      (runtime.framesRendered via BootFramePulse).
 *
 * window.__flyBoot = { phase, pct } is the harness contract: pct is
 * monotonic, hits 100 exactly when the reveal starts, and stays 100.
 * BOOT.maxBootMs is the absolute ceiling — a dead tile CDN can't trap the
 * boot. The reveal is a WarpFlash-style streak-accelerate + fade.
 */

const CAPTIONS = {
  spawn: 'finding your sky',
  world: { toy: 'carving the city', satellite: 'rendering the earth' },
  fleet: 'waking the fleet',
  shaders: 'warming shaders',
  ready: 'cleared for takeoff',
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function publish(phase, pct) {
  if (typeof window !== 'undefined') window.__flyBoot = { phase, pct };
}

export function BootScreen({ runtime }) {
  const [stage, setStage] = useState('loading'); // 'loading' | 'reveal' | null
  const [view, setView] = useState({ phase: 'spawn', pct: 0 });
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  // Deterministic star field — same sky every boot, zero hydration risk.
  const stars = useMemo(() => {
    let s = 0x5eed;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    return Array.from({ length: 70 }, (_, i) => ({
      id: i,
      left: rnd() * 100,
      top: rnd() * 100,
      size: 1 + rnd() * 1.6,
      delay: rnd() * 4,
      dur: 2.4 + rnd() * 3,
      dim: rnd() < 0.5,
    }));
  }, []);

  useEffect(() => {
    publish('spawn', 0);
    const t0 = performance.now();
    const gate = {
      worldHoldStart: null, // hold timer for gate (a)
      satSawDownload: false,
      satMaxSeen: 0,
      pct: 0, // monotonic floor
      done: false,
    };
    let revealTimer = null;

    const poll = setInterval(() => {
      if (gate.done) return;
      const rt = runtimeRef.current;
      const store = useFlyStore.getState();
      const now = performance.now();
      const frames = rt.framesRendered ?? 0;

      // --- gate (a): world streamed in --------------------------------
      let worldP = 0;
      let worldSteady = false; // instantaneous condition, pre-hold
      if (store.mapStyle === 'toy') {
        const ts = rt.toyStats;
        if (ts && ts.fullTotal > 0) {
          worldP = clamp01(ts.fullDone / ts.fullTotal);
          worldSteady = ts.fullDone >= ts.fullTotal && ts.draping === 0;
        }
      } else {
        const engine = rt.engine;
        if (engine && frames > 0) {
          const d = engine.downloading ?? 0;
          if (d > 0) {
            gate.satSawDownload = true;
            gate.satMaxSeen = Math.max(gate.satMaxSeen, d);
          }
          if (gate.satSawDownload) {
            worldP = clamp01(1 - d / gate.satMaxSeen);
            worldSteady = d === 0;
          } else {
            // Browser-cached fast path: ramp on the grace window instead.
            worldP = clamp01((now - t0) / BOOT.satGraceMs);
            worldSteady = now - t0 >= BOOT.satGraceMs && d === 0;
          }
        }
      }
      if (worldSteady) {
        if (gate.worldHoldStart == null) gate.worldHoldStart = now;
      } else {
        gate.worldHoldStart = null;
      }
      const worldDone =
        gate.worldHoldStart != null && now - gate.worldHoldStart >= BOOT.worldHoldMs;

      // --- gates (b) + (c) --------------------------------------------
      const modelsP = rt.modelsReady ? 1 : 0;
      const framesP = clamp01(frames / BOOT.minFrames);

      const timedOut = now - t0 >= BOOT.maxBootMs;
      const allDone =
        timedOut || (worldDone && modelsP === 1 && framesP === 1 && !!store.spawn);

      // Weighted, monotonic, and pinned ≤99 until the reveal moment so the
      // harness can rely on pct === 100 ⇔ world revealed.
      const raw =
        BOOT.weights.world * (worldDone ? 1 : Math.min(worldP, 0.98)) +
        BOOT.weights.models * modelsP +
        BOOT.weights.frames * framesP;
      gate.pct = Math.max(gate.pct, Math.min(99, Math.round(raw * 100)));

      let phase;
      if (!store.spawn) phase = 'spawn';
      else if (!worldDone) phase = 'world';
      else if (!modelsP) phase = 'fleet';
      else if (framesP < 1) phase = 'shaders';
      else phase = 'ready';

      if (allDone) {
        gate.done = true;
        gate.pct = 100;
        publish('ready', 100);
        setView({ phase: 'ready', pct: 100 });
        setStage('reveal');
        revealTimer = setTimeout(() => setStage(null), BOOT.revealMs);
        clearInterval(poll);
        return;
      }
      publish(phase, gate.pct);
      setView({ phase, pct: gate.pct });
    }, BOOT.pollMs);

    return () => {
      clearInterval(poll);
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, []);

  if (!stage) return null;

  const mapStyle = useFlyStore.getState().mapStyle;
  const caption =
    view.phase === 'world'
      ? CAPTIONS.world[mapStyle] ?? CAPTIONS.world.toy
      : CAPTIONS[view.phase];
  const revealing = stage === 'reveal';

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40"
      data-testid="boot-screen"
      data-stage={stage}
      style={{
        background:
          'radial-gradient(ellipse at 50% 62%, #0a0f22 0%, #04060f 62%, #02030a 100%)',
        opacity: revealing ? 0 : 1,
        transition: revealing ? `opacity ${BOOT.revealMs}ms ease-in` : 'none',
      }}
    >
      <style>{`
        @keyframes fly-boot-twinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.85; }
        }
        @keyframes fly-boot-streak {
          0% { transform: translate(-50%, -50%) scaleY(0.08); opacity: 0; }
          35% { opacity: var(--streak-peak, 0.28); }
          100% { transform: translate(-50%, -50%) scaleY(46); opacity: 0; }
        }
        @keyframes fly-boot-caption {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
        @keyframes fly-boot-shine {
          0% { transform: translateX(-160%); }
          100% { transform: translateX(420%); }
        }
      `}</style>

      {/* star backdrop */}
      {stars.map((st) => (
        <div
          key={st.id}
          className="absolute rounded-full"
          style={{
            left: `${st.left}%`,
            top: `${st.top}%`,
            width: st.size,
            height: st.size,
            background: st.dim ? '#8fa0bf' : '#eef5ff',
            animation: `fly-boot-twinkle ${st.dur}s ease-in-out ${st.delay}s infinite`,
          }}
        />
      ))}

      {/* streak tunnel — idle drift while loading, hyper on reveal */}
      {[...Array(9)].map((_, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-1/2 h-2 w-px"
          style={{
            background: 'rgba(207, 238, 248, 0.8)',
            rotate: `${i * 40 + 12}deg`,
            translate: `${Math.sin(i * 2.1) * 300}px ${Math.cos(i * 1.7) * 170}px`,
            '--streak-peak': revealing ? 0.9 : 0.22,
            animation: `fly-boot-streak ${revealing ? 650 : 3400}ms cubic-bezier(0.5, 0, 0.9, 0.4) ${
              i * (revealing ? 40 : 320)
            }ms infinite`,
          }}
        />
      ))}

      {/* wordmark + progress */}
      <div className="absolute left-1/2 top-1/2 w-[340px] -translate-x-1/2 -translate-y-1/2 text-center">
        <div
          className="select-none text-4xl uppercase text-[#eef5ff]"
          style={{
            fontFamily: "'Archivo Black', ui-sans-serif",
            letterSpacing: '0.28em',
            textShadow: '0 0 24px rgba(120, 170, 255, 0.35)',
          }}
        >
          Shadow
          <span className="text-[#8fa0bf]">ADSB</span>
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.7em] text-[#5a6884]">
          fly mode
        </div>

        <div className="mx-auto mt-8 h-0.5 w-64 overflow-hidden rounded-full bg-[#3d4a75]/40">
          <div
            className="relative h-full rounded-full"
            style={{
              width: `${view.pct}%`,
              background: '#eef5ff',
              boxShadow: '0 0 10px rgba(238, 245, 255, 0.8)',
              transition: `width ${BOOT.pollMs}ms linear`,
            }}
          >
            <div
              className="absolute inset-y-0 w-10"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(207,238,248,0.9), transparent)',
                animation: 'fly-boot-shine 1.6s ease-in-out infinite',
              }}
            />
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-center gap-3 font-mono text-[11px] uppercase text-[#8fa0bf]">
          <span
            className="tracking-[0.4em]"
            style={{ animation: 'fly-boot-caption 1.6s ease-in-out infinite' }}
            data-testid="boot-caption"
          >
            {caption}
          </span>
          <span className="tracking-widest text-[#5a6884]">{view.pct}%</span>
        </div>
      </div>
    </div>
  );
}

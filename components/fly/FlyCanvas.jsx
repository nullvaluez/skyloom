'use client';

import { Suspense, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { FlyScene } from './FlyScene';
import { Effects } from './Effects';
import { PhotoCapture } from './PhotoCapture';
import { JuiceSystems } from './JuiceSystems';
import { PrewarmRig } from './PrewarmRig';
import { CANVAS, PERF_GOVERNOR, PREWARM, STEP_SAFE } from '@/lib/fly/fly-constants';
import { autoTierCeiling } from '@/lib/fly/fly-settings';
import { PerfGovernor } from '@/lib/fly/perf-governor';
import { StepSafeRig } from '@/lib/fly/step-safe';
import { useFlyStore } from '@/stores/fly-store';

function initialDpr() {
  if (typeof window === 'undefined') return CANVAS.dprMax;
  return Math.min(CANVAS.dprMax, window.devicePixelRatio || 1);
}

const TIERS = ['low', 'medium', 'high'];

/**
 * R9-1 boot gate (c): counts rendered frames AFTER Suspense resolved (it
 * mounts beside FlyScene, so its useFrame only runs once the scene — and
 * its compiled shaders — actually draw). The BootScreen overlay polls
 * runtime.framesRendered from the DOM.
 */
function BootFramePulse({ runtime }) {
  useFrame(() => {
    runtime.framesRendered = (runtime.framesRendered ?? 0) + 1;
  });
  return null;
}

/** Second rung of the quality ladder after DPR: bloom + cloud density.
 *  Up-steps are capped at autoTierCeiling() — 'high' on desktop (unchanged),
 *  and on phone-class devices the player's saved pick or 'medium', so the
 *  incline can never flap a phone back into the high-tier scene it just
 *  declined out of (each high↔medium crossing rebuilds bloom + building
 *  materials — the hitch IS the flap). Declines are never capped. */
function stepQualityTier(dir) {
  const store = useFlyStore.getState();
  const i = TIERS.indexOf(store.qualityTier);
  let next = TIERS[Math.min(TIERS.length - 1, Math.max(0, i + dir))];
  if (dir > 0) {
    const ceil = TIERS.indexOf(autoTierCeiling());
    if (ceil >= 0 && TIERS.indexOf(next) > ceil) next = TIERS[ceil];
  }
  if (next !== store.qualityTier) store.setQualityTier(next);
}

/**
 * The R3F canvas with the production GL configuration. reversedDepthBuffer
 * (three r184+) gives near-uniform depth precision across the 600 km far
 * plane without logarithmicDepthBuffer's early-z cost. PerformanceMonitor
 * steps DPR down/up as the first rung of the quality ladder.
 */
export function FlyCanvas({ runtime }) {
  const [dpr, setDpr] = useState(initialDpr);

  // ROUND 21 (A GOVERNOR, S1): the scene subtree, shared by both quality
  // controllers so the two paths differ ONLY in what wraps it. With
  // PERF_GOVERNOR.enabled false the JSX below is byte-for-byte the R20 tree.
  const sceneTree = (
    <Suspense fallback={null}>
      <FlyScene runtime={runtime} />
      <Effects runtime={runtime} />
      {/* Round 17: reads the GRADED frame off this canvas at useFrame
          priority 100 — i.e. after the composer above, same task. */}
      <PhotoCapture />
      {/* Round 18 (A4): the arcade layer's frame driver. Mounted AFTER
          FlyScene so its default-priority useFrame runs behind the -50
          flight step and the -45 traffic update — i.e. every item's
          .distM is this frame's value when the near-miss scan reads it. */}
      <JuiceSystems runtime={runtime} />
      <BootFramePulse runtime={runtime} />
      {/* Round 21 (A): boot shader pre-warm. Adds no object to the scene and
          issues no draw — see components/fly/PrewarmRig.jsx. */}
      {PREWARM.enabled && <PrewarmRig runtime={runtime} />}
    </Suspense>
  );

  return (
    <Canvas
      dpr={dpr}
      shadows
      frameloop="always"
      camera={{
        fov: CANVAS.fov,
        near: CANVAS.near,
        far: CANVAS.far,
        position: [0, 150, 400],
      }}
      gl={{
        powerPreference: 'high-performance',
        antialias: false,
        stencil: false,
        alpha: false,
        reversedDepthBuffer: true,
      }}
      onCreated={({ gl }) => {
        if (process.env.NODE_ENV === 'development') {
          console.info(
            '[fly] reversedDepthBuffer active:',
            gl.capabilities?.reversedDepthBuffer === true
          );
          // Round 21 (A): the renderer handle the stability gates need.
          // `gl.info.programs.length` is the ONLY honest instrument for the
          // S2 leak (a composer rebuild that abandons its EffectPass shows up
          // there and nowhere else) and for proving the pre-warm actually
          // seeded three's program cache. Dev-only, read-only, no frame cost.
          window.__flyGl = gl;
        }
      }}
    >
      {PERF_GOVERNOR.enabled ? (
        <>
          {/* Round 21 (A GOVERNOR): the EMA + dwell + cooldown + session-latch
              controller that replaces the drei monitor. One ladder, DPR rungs
              above tier rungs, one rung per step — see lib/fly/perf-governor.js
              for why the drei defaults could not stay (fps 60 sits ON the
              default incline bound at vsync-locked steady state, and
              flipflops=Infinity means it never latches). */}
          <PerfGovernor setDpr={setDpr} />
          {/* Round 22.1 (A FLASH): applies a pending DPR step — renderer AND
              composer — inside the animation frame that then draws it, so the
              compositor can never present a reallocated (cleared) drawing
              buffer or a frame composed against buffers of the wrong size.
              Mounted only on the governor path: the legacy PerformanceMonitor
              branch below steps DPR with a FUNCTIONAL setState that has no
              value to park, and R22's one-flag revert for that path is that it
              stays byte-identical. STEP_SAFE.enabled:false ⇒ not mounted and
              perf-governor's applyDpr keeps its R22 line. */}
          {STEP_SAFE.enabled && <StepSafeRig setDpr={setDpr} />}
          {sceneTree}
        </>
      ) : (
        <PerformanceMonitor
          onDecline={() => {
            setDpr((d) => Math.max(CANVAS.dprMin, d - CANVAS.dprStep));
            stepQualityTier(-1);
          }}
          onIncline={() => {
            setDpr((d) => Math.min(initialDpr(), d + CANVAS.dprStep));
            stepQualityTier(1);
          }}
        >
          {sceneTree}
        </PerformanceMonitor>
      )}
    </Canvas>
  );
}

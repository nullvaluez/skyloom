'use client';

import { Suspense, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { FlyScene } from './FlyScene';
import { Effects } from './Effects';
import { PhotoCapture } from './PhotoCapture';
import { CANVAS } from '@/lib/fly/fly-constants';
import { autoTierCeiling } from '@/lib/fly/fly-settings';
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
        }
      }}
    >
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
        <Suspense fallback={null}>
          <FlyScene runtime={runtime} />
          <Effects runtime={runtime} />
          {/* Round 17: reads the GRADED frame off this canvas at useFrame
              priority 100 — i.e. after the composer above, same task. */}
          <PhotoCapture />
          <BootFramePulse runtime={runtime} />
        </Suspense>
      </PerformanceMonitor>
    </Canvas>
  );
}

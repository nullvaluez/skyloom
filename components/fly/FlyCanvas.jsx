'use client';

import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { FlyScene } from './FlyScene';
import { Effects } from './Effects';
import { CANVAS } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';

function initialDpr() {
  if (typeof window === 'undefined') return CANVAS.dprMax;
  return Math.min(CANVAS.dprMax, window.devicePixelRatio || 1);
}

const TIERS = ['low', 'medium', 'high'];

/** Second rung of the quality ladder after DPR: bloom + cloud density. */
function stepQualityTier(dir) {
  const store = useFlyStore.getState();
  const i = TIERS.indexOf(store.qualityTier);
  const next = TIERS[Math.min(TIERS.length - 1, Math.max(0, i + dir))];
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
          <Effects />
        </Suspense>
      </PerformanceMonitor>
    </Canvas>
  );
}

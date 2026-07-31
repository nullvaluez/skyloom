'use client';

import { Suspense, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { FlyScene } from './FlyScene';
import { Effects } from './Effects';
import { PhotoCapture } from './PhotoCapture';
import { JuiceSystems } from './JuiceSystems';
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
  // R19 (Fable scaffolding): sanctioned DEV-ONLY tier hold for
  // software-GL harness environments (SwiftShader always inclines to LOW,
  // which disables every satellite layer a gate wants to measure). A harness
  // sets window.__flyTierPin = 'high' pre-mount and the ladder never steps
  // in either direction. The R16 fleet-pin idiom INVERTED: nothing in
  // scripts/_boot.js sets it, so the production fleet and every existing
  // harness are byte-untouched; the NODE_ENV guard makes it dead code in
  // prod builds. The one-shot apply lives in FlyCanvas's mount effect.
  if (
    process.env.NODE_ENV === 'development' &&
    typeof window !== 'undefined' &&
    window.__flyTierPin
  ) {
    return;
  }
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

  // R19 dev tier hold, one-shot apply: a pin set before mount lands as the
  // live tier once, then stepQualityTier's early return keeps it there.
  // See the comment on stepQualityTier — dev-only, harness-set, never in
  // _boot.js, dead code in prod builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const pin = typeof window !== 'undefined' ? window.__flyTierPin : null;
    if (pin && TIERS.includes(pin)) useFlyStore.getState().setQualityTier(pin);
  }, []);

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
          {/* Round 18 (A4): the arcade layer's frame driver. Mounted AFTER
              FlyScene so its default-priority useFrame runs behind the -50
              flight step and the -45 traffic update — i.e. every item's
              .distM is this frame's value when the near-miss scan reads it. */}
          <JuiceSystems runtime={runtime} />
          <BootFramePulse runtime={runtime} />
        </Suspense>
      </PerformanceMonitor>
    </Canvas>
  );
}

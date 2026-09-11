'use client';
import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useFlyStore } from '@/stores/fly-store';
import { stepNearGroundRuntime } from '@/lib/fly/near-ground';
import { updateNearGroundUniforms } from '@/lib/fly/near-ground-material';

export function GroundImmersionRig({ runtime, flight }) {
  // Physics and chase share -50. Read the prior-frame visual pose at -51 so
  // camera, lighting and details share ONE damped signal throughout this frame.
  useFrame((_, dt) => {
    const state = useFlyStore.getState();
    stepNearGroundRuntime(runtime, flight, dt, state);
  }, -51);
  // Origin rebases happen at -50. Refresh only shader coordinates afterward;
  // never advance the damped signal twice or texture detail jumps on a rebase.
  useFrame(() => {
    updateNearGroundUniforms(runtime, flight, runtime.groundImmersion, useFlyStore.getState().qualityTier);
  }, -49);
  useEffect(() => () => {
    runtime.groundImmersion = null;
    updateNearGroundUniforms(runtime, flight, null, 'low');
  }, [runtime, flight]);
  return null;
}

'use client';
/**
 * SHIP PASS SKY — mounts `window.__flySky` (lib/fly/sky-diag.js
 * shipSkyDiagnostics) in dev and under ?graphicsReview=1, so harnesses read
 * the moon, the clarity k and the aerial reach switch the frame is using.
 * Renders nothing; production without the review flag never sets it.
 */
import { useEffect } from 'react';
import { graphicsReviewOn } from '@/lib/fly/satellite-visuals';
import { shipSkyDiagnostics } from '@/lib/fly/sky-diag';
import { moonLightForSun, moonState } from '@/lib/fly/sun-model';
import { AERIAL_CLARITY_UNIFORMS, aerialClarityK } from '@/lib/fly/aerial-clarity';
import { PSKY_UNIFORMS } from '@/lib/fly/atmosphere/runtime';
import { shipPassFlags } from '@/lib/fly/ship-pass';

export function ShipSkyDiag({ runtime }) {
  useEffect(() => {
    if (!(process.env.NODE_ENV === 'development' || graphicsReviewOn())) return undefined;
    const handle = shipSkyDiagnostics(runtime, { moonState, moonLightForSun, aerialClarityK, AERIAL_CLARITY_UNIFORMS, PSKY_UNIFORMS, shipPassFlags });
    window.__flySky = handle;
    return () => {
      if (window.__flySky === handle) delete window.__flySky;
    };
  }, [runtime]);
  return null;
}

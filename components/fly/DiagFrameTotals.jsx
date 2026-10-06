'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * TRUE EARTH — whole-frame draw/triangle totals for the diagnostics overlay
 * (mounted only with ?diag=1). The composer renders several passes per frame
 * and three's default autoReset zeroes gl.info per render() call, so a
 * production build would otherwise report only the last pass. Read at the
 * START of each frame, the counters hold the previous frame's full render.
 * It resets them only when it owns them: dev and ?graphicsReview=1 already
 * accumulate and reset inside FlyScene, and their instruments must not move.
 */
export function DiagFrameTotals() {
  const gl = useThree((s) => s.gl);
  const own = useRef(false);
  useEffect(() => {
    if (gl.info.autoReset) {
      gl.info.autoReset = false;
      own.current = true;
    }
    return () => {
      if (own.current) gl.info.autoReset = true;
      own.current = false;
    };
  }, [gl]);
  useFrame(() => {
    const t = ((window.__flyStats ??= {}).diag ??= { calls: 0, triangles: 0, callsPeak: 0, trianglesPeak: 0 });
    t.calls = gl.info.render.calls;
    t.triangles = gl.info.render.triangles;
    if (t.calls > t.callsPeak) t.callsPeak = t.calls;
    if (t.triangles > t.trianglesPeak) t.trianglesPeak = t.triangles;
    if (own.current) gl.info.reset();
  }, -1000);
  return null;
}

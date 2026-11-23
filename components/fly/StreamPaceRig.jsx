'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { lastWorkMs } from '@/lib/fly/pace-adapt';
import { cadenceState } from '@/lib/fly/frame-api';
import { resetStreamPace, stepStreamPace, streamPaceStats } from '@/lib/fly/stream-pace';
import { useFlyStore, menuOpen } from '@/stores/fly-store';

/**
 * STREAM PACE (FLY_HORIZON_FILL.md "Third round", stream P). Mounted by
 * FlyCanvas only while streamPaceOn(); renders nothing and draws nothing.
 *
 * Once a frame, at priority -98 (after the governor's -100 and STEP_SAFE's
 * -99, before FlyScene's -50 stamps the finalize frame and long before the
 * streaming layers at -47 and later), it feeds the law in lib/fly/stream-pace.js
 * and so sets the scale every streaming allowance reads this frame:
 *
 *   interval    the r3f delta, the same number the governor samples
 *   work        the governor's own measurement of the previous frame's
 *               main-thread work (pace-adapt lastWorkMs(): its -100 start
 *               stamp to PaceClock's +1000 end stamp; undefined with
 *               ?flags=-PACE_ADAPT, and then the interval alone decides)
 *   target      the governor's target interval (cadenceState().targetFps), or
 *               the presented interval when FlyCanvas pumps a slower cadence
 *               than that (`presentFps`: a 60 fps pump on a faster display),
 *               so a frame the pump holds on purpose is never read as late
 *   sample      false where the governor does not sample either (a menu, a
 *               hidden page): k holds
 *   curtain     runtime.worldLoading (BootScreen and WarpFlash set it)
 *   epoch       fly-store warpEpoch; boot done = __flyBoot.pct 100
 *
 * Publishes window.__flyStats.streamPace four times a second into one reused
 * object: k now, its minimum and time-weighted mean since the last reveal,
 * seconds at the floor, falls begun, and the curtain factor used (its
 * time-weighted mean over the last curtain) with that curtain's length.
 * Nothing is allocated per frame.
 */
export function StreamPaceRig({ runtime, presentFps = null }) {
  const input = useRef({ dtMs: 0, workMs: undefined, targetMs: null, sample: true, curtain: false, epoch: 0, bootDone: false });
  const pub = useRef({ t: 0, out: {} });

  useEffect(() => {
    // A fresh law per mount (a remounted canvas starts at 1, not where the last left off).
    resetStreamPace();
    return () => {
      resetStreamPace();
      if (typeof window !== 'undefined' && window.__flyStats) delete window.__flyStats.streamPace;
    };
  }, []);

  useFrame((_, delta) => {
    const inp = input.current;
    const store = useFlyStore.getState();
    const fps = cadenceState().targetFps;
    inp.dtMs = delta * 1000;
    inp.workMs = lastWorkMs();
    inp.targetMs = fps > 0 ? Math.max(1000 / fps, presentFps > 0 ? 1000 / presentFps : 0) : null;
    inp.sample = !(menuOpen(store) || (typeof document !== 'undefined' && document.hidden));
    inp.curtain = runtime?.worldLoading === true;
    inp.epoch = store.warpEpoch ?? 0;
    inp.bootDone = typeof window !== 'undefined' && (window.__flyBoot?.pct ?? 0) >= 100;
    stepStreamPace(inp);

    const p = pub.current;
    p.t += delta;
    if (p.t >= 0.25 && typeof window !== 'undefined') {
      p.t = 0;
      const stats = (window.__flyStats ??= {});
      stats.streamPace = streamPaceStats(p.out);
    }
  }, -98);

  return null;
}

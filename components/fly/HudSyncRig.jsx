'use client';

import { useEffect } from 'react';
import { addAfterEffect } from '@react-three/fiber';
import { HUD_SYNC } from '@/lib/fly/fly-constants';
import { pinned } from '@/lib/fly/fly-pins';

/**
 * ROUND 24 (A PACE) — HUD_SYNC's frame half. Recon FL-01.
 *
 * The DOM label overlay used to run its own `requestAnimationFrame` loop.
 * rAF callbacks run in REGISTRATION order, and both that loop and R3F's
 * re-register as their first statement, so the order set at boot is permanent
 * — and LabelCanvas registers first, because FlyMode renders it
 * unconditionally while FlyCanvas waits on geolocation. Every overlay frame
 * therefore projected its tracks through the camera matrices left by the
 * PREVIOUS `renderer.render`: a consistent picture of frame N-1 composited
 * over GL frame N. At 60 fps and ~60 deg/s of yaw that is about 30 px of swim
 * on a 1920-wide canvas, and it is one of the things "tearing" can mean.
 *
 * `addAfterEffect` runs after ALL roots have rendered, so the camera's
 * `matrixWorldInverse` and `projectionMatrix` are the ones the frame was drawn
 * with. The overlay is then a picture of the same frame it sits on.
 *
 * Cost: the 2D draw moves into the GL frame's task instead of a separate rAF
 * slot — the same ~0.5–1 ms of main-thread work, paid at a different moment.
 * The phone 30 Hz cadence lives inside the draw closure and is unaffected.
 *
 * Mounted inside <Canvas>. Renders nothing.
 */
export function HudSyncRig({ runtime }) {
  useEffect(() => {
    if (!pinned(HUD_SYNC, '__flyHudSyncOverride').enabled) return undefined;
    // addAfterEffect returns its own unsubscribe; the closure is read from
    // `runtime` AT CALL TIME so a LabelCanvas remount re-arms without this rig
    // having to re-subscribe.
    return addAfterEffect(() => {
      runtime?.hudDraw?.();
    });
  }, [runtime]);
  return null;
}

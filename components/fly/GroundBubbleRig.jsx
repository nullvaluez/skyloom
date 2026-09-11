'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { r25Block } from '@/lib/fly/r25-pins';
import { eyeAglVis } from '@/lib/fly/ground-vis';
import {
  attachGroundBubble,
  createBubbleState,
  detachGroundBubble,
  publishGroundBubble,
} from '@/lib/fly/ground-bubble';

/**
 * ROUND 25 (Fable, W0) — GROUND_BUBBLE's frame half. The ONE writer of
 * `runtime.groundBubble = { k, aglM, aglVisM }`.
 *
 * Runs at useFrame priority −49: FlyScene's −50 block has already stepped the
 * flight model and `runtime.groundElevVis` (GROUND_VIS) for this frame, so the
 * AGL read here is the same damped number every other visual band uses, and
 * every reader of `runtime.groundBubble` at the default priority (layers,
 * Effects' feeds, the chase camera) sees THIS frame's k. The object is mutated
 * in place — zero allocation per frame — and readers spell it
 * `runtime.groundBubble?.k ?? 0`, so with the flag off (this rig unmounted)
 * they read exactly 0. The writes themselves live in lib/fly/ground-bubble.js
 * (plain functions on the shared runtime bus); this component only sequences
 * them.
 *
 * Mounted inside <Canvas>. Renders nothing.
 */
export function GroundBubbleRig({ runtime }) {
  const stateRef = useRef(null);

  useEffect(() => {
    if (!runtime) return undefined;
    attachGroundBubble(runtime);
    stateRef.current = createBubbleState();
    return () => detachGroundBubble(runtime);
  }, [runtime]);

  useFrame((_, dt) => {
    const flight = runtime?.flight;
    const s = stateRef.current;
    if (!flight?.pos || !s) return;
    const aglVis = eyeAglVis(runtime, flight);
    const aglRaw = Math.max(0, flight.pos.y - (flight.groundElev ?? 0));
    publishGroundBubble(runtime, s, aglVis, aglRaw, dt, r25Block('GroundBubble'));
  }, -49);

  return null;
}

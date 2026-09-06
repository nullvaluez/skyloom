/**
 * R24 B WORLD — GROUND_VIS: a slew-limited VISUAL ground elevation
 * (recon A6, T8).
 *
 * THE DEFECT. `flight.groundElev` is a raw quadtree raycast sampled every 3rd
 * frame (FlyScene.jsx:1084) and published to EVERY consumer at once. When a
 * finer DEM tile lands under the aircraft the value STEPS — R22 measured
 * ~384 m in a single frame — and everything AGL-keyed steps with it: the bend
 * datum (`setBendEye`), the building / skyline / road fade bands, the POI
 * letter horizon, the low-AGL micro-detail and quilt ramps, the altitude
 * atmosphere. One DEM refinement therefore sweeps every fade band in the
 * world at once, which reads as the whole scene flickering.
 *
 * THE SEAM. The flight model, the crash floor, the ground shadow, the cinema
 * and photo cameras and every placement/drape sample keep the RAW value —
 * they are about where the aircraft actually is. Only the things that are
 * about how the world LOOKS read the damped one. That split is the whole
 * feature: a visual ramp may lag reality by a metre; a collision floor may
 * not.
 *
 * The slew is per FRAME, not per second, and deliberately so: the quantity it
 * protects is a per-frame visual delta, and a frame-rate-independent rate
 * would let a hitch deliver the whole step at once — exactly the event being
 * damped. A warp SNAPS (a cut is not a ramp), and so does the first sample.
 */

import { GROUND_VIS } from './fly-constants';

/**
 * Advance `runtime.groundElevVis` toward the raw `flight.groundElev`.
 * Called once per frame from FlyScene's −50 block, immediately after the raw
 * write. Flag-off it mirrors the raw value exactly, so every consumer below is
 * byte-identical to R21.
 */
export function stepGroundVis(runtime, flight, warpEpoch) {
  const raw = flight.groundElev ?? 0;
  if (!GROUND_VIS.enabled) {
    runtime.groundElevVis = raw;
    return raw;
  }
  const snap = runtime.groundElevVis == null || runtime._gvEpoch !== warpEpoch;
  runtime._gvEpoch = warpEpoch;
  if (snap) {
    runtime.groundElevVis = raw;
    return raw;
  }
  const d = raw - runtime.groundElevVis;
  const step = GROUND_VIS.maxStepM;
  runtime.groundElevVis =
    Math.abs(d) <= step ? raw : runtime.groundElevVis + Math.sign(d) * step;
  return runtime.groundElevVis;
}

/** The elevation a VISUAL consumer should use. Raw when the flag is off. */
export function groundElevVis(runtime, flight) {
  if (!GROUND_VIS.enabled) return flight.groundElev ?? 0;
  const v = runtime?.groundElevVis;
  return typeof v === 'number' ? v : flight.groundElev ?? 0;
}

/** `max(0, eyeY - visualGround)` — the one expression every fade band uses. */
export function eyeAglVis(runtime, flight) {
  return Math.max(0, flight.pos.y - groundElevVis(runtime, flight));
}

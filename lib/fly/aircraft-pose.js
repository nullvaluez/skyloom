/**
 * GATE TO GATE — the ONE drawn-aircraft pose helper.
 *
 * PlayerPlane, the TrafficLayer player feed (lights, smoke), the camera
 * director's rigid shots and the replay all compose the drawn aircraft
 * through this file, so a light or a smoke puff can never detach from the
 * visible airframe. The math is PlayerPlane's (pre-W0 PlayerPlane.jsx:92-109)
 * moved here verbatim: position, YXZ euler (pitch, -heading, -bank), the idle
 * bob and sway, Object3D.updateMatrix, then the Mercator projection.
 * scripts/verify-ops-presentation.mjs proves it element-for-element identical
 * (Object.is) to the old inline code.
 *
 * `src` is renderView(flight) (lib/fly/render-view.js) or a replay pose:
 * { pos, heading, pitch, bank, latDeg }. `presentation` is flight.presentation
 * (lib/fly/ops-presentation.js): its pitchOffset / rollOffset / heaveM apply
 * only when non-zero, so the default presentation changes no bit.
 */
import { Matrix4, Object3D } from 'three';
import { projectModelMatrix } from './render-scale.js';
import { mercatorScale } from './coords.js';

/**
 * The idle hover bob amplitude 0..1 (PlayerPlane's game-feel wobble): none on
 * the ground or with reduced motion, fading in over the first 30 m above the
 * gear, and quieter in the cinematic look.
 */
export function idleBobAmplitude(flight, { reduced = false, cinema = false } = {}) {
  const ops = flight.operations;
  const clearance = ops?.grounded ? 0 : ops?.profile ? Math.max(0, Math.min(1, (flight.agl - ops.profile.clearance) / 30)) : 1;
  return reduced ? 0 : clearance * (cinema ? 0.28 : 1);
}

/** The hull's vertical offset inside the rig (airliner model offset with the gear down). */
export function groundHullOffset(flight) {
  return (flight.operations?.profile?.modelOffsetY ?? 0) * (flight.operations?.gear ?? 0);
}

/**
 * Pose an aircraft rig (an Object3D with matrixAutoUpdate false) and return
 * its projected matrix. bob is the amplitude (idleBobAmplitude), t seconds.
 */
export function poseAircraftRig(rig, src, presentation, { bob = 0, t = 0, latDeg = src.latDeg } = {}) {
  rig.position.copy(src.pos);
  rig.rotation.order = 'YXZ';
  const pitchOffset = presentation?.pitchOffset;
  const rollOffset = presentation?.rollOffset;
  rig.rotation.set(pitchOffset ? src.pitch + pitchOffset : src.pitch, -src.heading, rollOffset ? -src.bank + rollOffset : -src.bank);
  // Idle hover wobble: a two-tone bob + faint roll sway (game feel). The
  // camera doesn't share it, so the plane reads alive against the world.
  rig.position.y += (Math.sin(t * 1.9) * 0.35 + Math.sin(t * 3.1) * 0.12) * bob;
  rig.rotation.z += Math.sin(t * 1.3) * 0.01 * bob;
  if (presentation?.heaveM) rig.position.y += presentation.heaveM;
  rig.updateMatrix();
  projectModelMatrix(rig.matrix, mercatorScale(latDeg));
  return rig.matrix;
}

const _rig = new Object3D();
_rig.matrixAutoUpdate = false;
const _hull = new Matrix4();

/**
 * The drawn aircraft's matrix without a scene object. groundHull adds the
 * hull offset (hull and lights only; the landing gear is not offset), anchor
 * rebases the translation into the floating origin.
 */
export function composeAircraftMatrix(src, presentation, { bob = 0, t = 0, latDeg = src.latDeg, groundHull = false, hullY = 0, anchor = null } = {}, out = new Matrix4()) {
  out.copy(poseAircraftRig(_rig, src, presentation, { bob, t, latDeg }));
  if (groundHull && hullY) out.multiply(_hull.makeTranslation(0, hullY, 0));
  if (anchor) {
    out.elements[12] -= anchor.x;
    out.elements[14] -= anchor.z;
  }
  return out;
}

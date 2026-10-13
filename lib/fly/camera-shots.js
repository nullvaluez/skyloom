/**
 * GATE TO GATE — camera shot geometry (CAMERA_DIRECTOR, W2 F).
 *
 * previewPose(name, ctx, out) is pure with respect to the game: it computes
 * where a shot would put the camera without moving any camera. The lounge
 * glide (LOUNGE_BRIDGE, W4 P) targets it, then the director starts the same
 * shot with blendFrom(camera), so the handoff has no jump.
 *
 * W0 stub: every shot previews the chase camera's rest pose (a scratch
 * ChaseCamera snapped onto the aircraft). W2 F adds the real shots.
 */
import { PerspectiveCamera } from 'three';
import { ChaseCamera } from './chase-camera';
import { mercatorScale } from './coords';

export const SHOTS = Object.freeze(['chase', 'nose', 'wing', 'tower', 'runwaySide', 'establish', 'gateCam', 'flyby', 'consequence']);

let scratch = null;
const STILL = { active: false, dx: 0, dy: 0 };

/**
 * @param {string} name  one of SHOTS
 * @param {{flight: object, runtime?: object, standIndex?: number}} ctx
 * @param {{position: object, quaternion: object, fov?: number, shot?: string}} out
 */
export function previewPose(name, ctx, out) {
  scratch ??= { chase: new ChaseCamera(), camera: new PerspectiveCamera(50, 16 / 9, 1, 1e7) };
  const { chase, camera } = scratch;
  STILL.active = false;
  STILL.dx = 0;
  STILL.dy = 0;
  chase.snap();
  chase.update(1 / 60, ctx.flight, camera, STILL, mercatorScale(ctx.flight.latDeg), null);
  out.position.copy(camera.position);
  out.quaternion.copy(camera.quaternion);
  out.fov = camera.fov;
  out.shot = 'chase';
  return out;
}

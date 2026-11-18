/**
 * GATE TO GATE — who drives the camera this frame, in one place.
 *
 * Precedence: the lounge (incl. its glide) > photo > the photo exit snap >
 * the title orbit > the director (CAMERA_DIRECTOR, and only when it wants
 * the frame) > the cinema wing cam (C, with a target) > chase. FlyScene calls
 * cameraOwner() and then runs that rig; transitionMode() names the mode the
 * CameraTransition blends between. W2 F owns the director branch; W4 P adds
 * the 'lounge' transition mode.
 *
 * photoExit is a thunk (PhotoCamera.handoff() returns true once and must only
 * be consulted when neither the lounge nor photo mode own the frame).
 */
import { cameraDirector } from './ops-flags.js';
import { pilotSeatSelected } from './pilot-seat.js';

/**
 * @returns {'lounge'|'photo'|'photo-exit'|'title'|'director'|'cinema'|'pilot'|'chase'}
 */
export function cameraOwner(runtime, flyState, { photoMode, photoExit, hasTarget, ops } = {}) {
  if (runtime.airportWatch?.active) return 'lounge';
  if (photoMode) return 'photo';
  const leavingPhoto = photoExit?.();
  if (leavingPhoto && !pilotSeatSelected(flyState)) return 'photo-exit';
  if (runtime.titleCam?.active) return 'title';
  if (cameraDirector().enabled === true && runtime.director?.wants(flyState, ops)) return 'director';
  if (flyState.cameraMode === 'cinema' && hasTarget) return 'cinema';
  if (pilotSeatSelected(flyState)) return 'pilot';
  return 'chase';
}

/** The mode name CameraTransition blends between (a change starts a blend). */
export function transitionMode(runtime, flyState) {
  return runtime.titleCam?.active ? 'title' : flyState.cameraMode;
}

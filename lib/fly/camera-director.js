/**
 * GATE TO GATE — the camera director (runtime.director; CAMERA_DIRECTOR, W2 F).
 *
 * FlyScene asks the director for the camera only through lib/fly/camera-mode.js
 * (cameraOwner), after the lounge, photo and title cameras and before the
 * cinema and chase cameras, and only while CAMERA_DIRECTOR is on.
 *
 * Contract: { wants(state, ops), update(dt, view, camera, ctx), cycle(),
 *   setHome(shot), cut({reason, to, holdSec}), beat(name, opts),
 *   playIntro({kind, standIndex, fromPose}), cancelBeats(), previewPose,
 *   shot, stats: {shot, blending, beats, cuts, nearSyncs} }
 * Shot ids are camera-shots.js SHOTS. The director emits 'touchdown-photo'
 * when a touchdown beat frames the aircraft (OPS_DEBRIEF's auto photo).
 *
 * W0 stub: wants() is always false, so the chase camera keeps the frame.
 */
import { previewPose } from './camera-shots';

export function createCameraDirector() {
  const listeners = new Set();
  return {
    shot: 'chase',
    stats: { shot: 'chase', blending: false, beats: 0, cuts: 0, nearSyncs: 0 },
    wants() {
      return false;
    },
    update() {},
    cycle() {},
    setHome() {},
    cut() {},
    beat() {},
    playIntro() {},
    cancelBeats() {},
    previewPose,
    /** 'touchdown-photo' and future director events. Returns the release function. */
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      listeners.clear();
    },
  };
}

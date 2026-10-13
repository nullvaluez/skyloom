/**
 * GATE TO GATE — operations tunables (feel, presentation, audio, deck,
 * debrief). The flag blocks in fly-constants.js only gate; the numbers live
 * here so a stream can tune without touching the flag registry. Each section
 * names its owner stream.
 */
export const OPS_TUNING = Object.freeze({
  // OPS_FEEL (W1 C)
  feel: Object.freeze({
    spool: Object.freeze({ upSec: 2.0, downSec: 1.1, heavyK: 1.35, propSec: 0.35 }),
    rotation: Object.freeze({ liftoffPitch: Object.freeze({ heavy: 0.105, light: 0.085 }), minVrFrac: 1.02 }),
    groundEffect: Object.freeze({ k: 0.45, flareVyCap: 0.4, floatBleedAfterSec: 3.5 }),
    failure: Object.freeze({ settleSec: 4 }),
    groundInput: Object.freeze({ mouseDeadzone: 0.12, steerWhileBrakingK: 0.5 }),
  }),
  // OPS_FX (W2 E)
  fx: Object.freeze({
    aoa: Object.freeze({ maxRad: 0.3, derotationSec: 1.4 }),
    cinemaShakeK: 0.1,
  }),
  // OPS_AUDIO (W2 G)
  audio: Object.freeze({
    apronVoices: Object.freeze({ desktop: 3, phone: 2 }),
    centrelineThumpM: 15,
  }),
  // CAMERA_DIRECTOR (W2 F)
  director: Object.freeze({
    blendSec: Object.freeze([0.6, 1.5]),
    eyeAboveGroundM: 1.2,
    takeoffBeatVrFrac: 0.9,
    touchdownPhotoSec: 0.6,
    airportCutDipMs: 220,
    airportCutKm: 15,
  }),
  // OPS_DEBRIEF (W2 H): landing-grade weights and letters.
  grade: Object.freeze({
    weights: Object.freeze({ sink: 0.25, centreline: 0.15, aim: 0.15, speed: 0.15, flare: 0.15, rollout: 0.15 }),
    letters: Object.freeze([
      Object.freeze({ letter: 'A+', min: 95, label: 'Butter' }),
      Object.freeze({ letter: 'A', min: 88 }),
      Object.freeze({ letter: 'B', min: 78 }),
      Object.freeze({ letter: 'C', min: 66 }),
      Object.freeze({ letter: 'D', min: 0 }),
    ]),
    bounceCap: 87,
    provisionalSec: 1.2,
  }),
  // GATE_TO_GATE (W3 J): auto-taxi time compression applies only in taxi
  // phases, 1x near holds or traffic, with the wall-dt cap applied first.
  journey: Object.freeze({ nearHoldM: 150, nearTrafficM: 300 }),
});

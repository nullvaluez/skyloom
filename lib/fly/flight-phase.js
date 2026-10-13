// Visual flight phase for a live track: gear, landing lights and the lounge
// board read this. It is an inference from position and velocity, never a
// runway assignment or navigation data, and it is deliberately conservative.

export const PHASE = Object.freeze({
  PARKED: 'parked', // on the ground, stopped
  TAXI: 'taxi', // on the ground, moving slowly
  RUNWAY: 'runway', // on the ground at takeoff/landing speed
  FINAL: 'final', // low, descending: gear down, landing lights
  CLIMB_OUT: 'climb-out', // low, climbing after takeoff
  APPROACH: 'approach', // descending below 3,000 m
  DEPARTURE: 'departure', // climbing below 3,000 m
  CLIMB: 'climb',
  DESCENT: 'descent',
  CRUISE: 'cruise',
  LEVEL: 'level',
});

const GROUNDED = 1;

/**
 * Phase of track `t`. `groundY` is the terrain/airfield elevation under it in
 * metres (an airport's elevation is a good stand-in near the field).
 */
export function trackPhase(t, groundY = 0) {
  const fix = t?.fix1;
  if (!fix) return PHASE.LEVEL;
  const speed = Math.hypot(fix.vE, fix.vN);
  if (t.flags & GROUNDED) return speed < 1.5 ? PHASE.PARKED : speed < 28 ? PHASE.TAXI : PHASE.RUNWAY;
  const agl = (t.ry ?? 0) - groundY, vUp = fix.vUp ?? 0;
  if (agl < 650 && vUp < -1.2) return PHASE.FINAL;
  if (agl < 900 && vUp > 1.2) return PHASE.CLIMB_OUT;
  if (agl < 3000 && vUp < -0.8) return PHASE.APPROACH;
  if (agl < 3000 && vUp > 0.8) return PHASE.DEPARTURE;
  if (vUp > 2) return PHASE.CLIMB;
  if (vUp < -2) return PHASE.DESCENT;
  return (t.ry ?? 0) > 7000 ? PHASE.CRUISE : PHASE.LEVEL;
}

/** Gear is shown down on the ground, on final, and through the first climb. */
export function gearDown(t, phase, groundY = 0) {
  if (t?.flags & GROUNDED) return true;
  if (phase === PHASE.FINAL) return true;
  return phase === PHASE.CLIMB_OUT && (t.ry ?? 0) - groundY < 260;
}

/** Landing lights: rolling on the runway, and airborne below ~10,000 ft MSL. */
export function landingLightsOn(t, phase) {
  if (t?.flags & GROUNDED) return phase === PHASE.RUNWAY;
  return (t?.ry ?? Infinity) < 3050;
}

// Visual flight phase for a live track: gear, flaps, lights and the lounge
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
const LANDING_LIGHT_CEILING_M = 3050; // ~10,000 ft: the customary switch-off altitude

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
  return (t?.ry ?? Infinity) < LANDING_LIGHT_CEILING_M;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (a, b, v) => clamp01((v - a) / (b - a));

/**
 * Configuration the airframe should be moving toward for its phase:
 *   gear 0/1, flaps 0..1 (1 = landing flap), spoiler 0/1 (lift dumpers on
 *   the landing roll), pitch (radians of nose-up attitude over the flight
 *   path: angle of attack on approach, rotation on the takeoff roll, the
 *   flare), and the external lights in use.
 * `memory` carries the track's recent history: { landedAt, liftoffAt,
 * speedRate } (seconds, server-independent; `now` is the same clock), so a
 * landing roll is told from a takeoff roll and taxi-in from taxi-out.
 * Speeds are true m/s. Light aircraft (`light`) use smaller numbers.
 */
export function phaseConfig(t, phase, groundY = 0, memory = {}, now = 0, { light = false } = {}, out = {}) {
  const fix = t?.fix1;
  const speed = fix ? Math.hypot(fix.vE, fix.vN) : 0;
  const agl = (t?.ry ?? 0) - groundY;
  const sinceLanding = now - (memory.landedAt ?? -1e9);
  const sinceLiftoff = now - (memory.liftoffAt ?? -1e9);
  const k = light ? 0.5 : 1; // speed scale for light aircraft
  out.gear = 0;
  out.flaps = 0;
  out.spoiler = 0;
  out.pitch = 0;
  out.landing = landingLightsOn(t, phase);
  out.taxi = false;
  out.strobe = !(t?.flags & GROUNDED);
  out.beacon = true;
  switch (phase) {
    case PHASE.PARKED:
      out.gear = 1;
      out.beacon = sinceLanding < 300; // engines still spooling down after arrival
      break;
    case PHASE.TAXI:
      out.gear = 1;
      out.taxi = true;
      // Taxi-out with takeoff flap set; taxi-in clean.
      out.flaps = sinceLanding < 900 ? 0 : 0.3;
      break;
    case PHASE.RUNWAY: {
      out.gear = 1;
      out.taxi = true;
      out.strobe = true;
      out.landing = true;
      if (sinceLanding < 120) {
        // Landing roll: landing flap, lift dumpers up until taxi speed.
        out.flaps = 1;
        out.spoiler = speed > 22 * k ? 1 : 0;
        out.pitch = speed > 50 * k && sinceLanding < 4 ? 0.04 * (1 - sinceLanding / 4) : 0;
      } else {
        // Takeoff roll: takeoff flap; rotate as speed passes ~Vr.
        out.flaps = 0.3;
        if ((memory.speedRate ?? 0) > -0.2) out.pitch = 0.14 * ramp(62 * k, 75 * k, speed);
      }
      break;
    }
    case PHASE.FINAL:
      out.gear = 1;
      out.flaps = 1;
      // Approach attitude, then the flare over the threshold.
      out.pitch = 0.05 + 0.05 * (1 - ramp(4, 18, agl));
      break;
    case PHASE.CLIMB_OUT:
      // Gear comes up at a positive climb a few seconds after liftoff (the
      // retraction itself takes ~7 s); flap retracts with speed.
      out.gear = agl < 25 || sinceLiftoff < 3 ? 1 : 0;
      out.flaps = 0.3 * (1 - ramp(85 * k, 115 * k, speed));
      out.pitch = 0.12;
      break;
    case PHASE.APPROACH:
      out.gear = agl < 750 || speed < 82 * k ? 1 : 0;
      out.flaps = ramp(115 * k, 75 * k, speed);
      out.pitch = 0.03 + 0.03 * out.flaps;
      break;
    case PHASE.DEPARTURE:
      out.flaps = 0.3 * (1 - ramp(90 * k, 120 * k, speed));
      out.pitch = 0.08;
      break;
    case PHASE.CLIMB:
      out.pitch = 0.05;
      break;
    case PHASE.DESCENT:
      out.pitch = 0.015;
      break;
    case PHASE.LEVEL:
      // A level segment low down is usually an approach being set up (the
      // intercept altitude, a visual circuit): configure by speed.
      if (agl < 3000) {
        out.flaps = 0.8 * ramp(115 * k, 75 * k, speed);
        out.gear = agl < 600 && speed < 80 * k ? 1 : 0;
        out.pitch = 0.035 + 0.03 * out.flaps;
      } else out.pitch = 0.035;
      break;
    default:
      out.pitch = 0.035; // cruise angle of attack
  }
  return out;
}

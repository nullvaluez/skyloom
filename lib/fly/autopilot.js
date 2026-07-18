import { FLIGHT, TARGETING } from './fly-constants';
import { mercatorScale, wrapAngle } from './coords';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Intercept + formation autopilot (Phase 5): a virtual command generator
 * that REPLACES the user's commands in the frame loop while engaged.
 *
 * Intercept: lead pursuit at boost toward `targetPos + targetVel·(dist/
 * closing)`, exponential deceleration from interceptDecelStartM down to
 * targetGS + interceptOverspeedMps, automatic transition to formation at
 * interceptHandoffM. Formation: loose position controller (λ≈1.8) holding
 * a wing slot in the target's local frame; desired velocity = slot error·λ
 * + target velocity. Hard stick input (>formationBreakDeflection held
 * formationBreakHoldSec) breaks out of either mode; a stale/lost target
 * auto-releases.
 */
export class Autopilot {
  constructor() {
    this.mode = 'off'; // 'off' | 'intercept' | 'formation'
    this._breakSec = 0;
  }

  engage(mode) {
    this.mode = mode;
    this._breakSec = 0;
  }

  disengage() {
    this.mode = 'off';
    this._breakSec = 0;
  }

  /**
   * @param dt seconds
   * @param flight FlightModel (absolute world pos, true-angle heading/pitch)
   * @param target TrafficEngine track (rx/ry/rz absolute, fix1 velocities)
   * @param userCmd this frame's raw input commands
   * @returns command struct for FlightModel, or null when off/disengaged
   */
  update(dt, flight, target, userCmd) {
    if (this.mode === 'off') return null;
    if (!target || !target.fix1 || target.stale === 2) {
      this.disengage(); // stale >30s or lost: hand back control
      return null;
    }

    // Hard input breaks out
    if (
      Math.abs(userCmd.turn) > TARGETING.formationBreakDeflection ||
      Math.abs(userCmd.pitch) > TARGETING.formationBreakDeflection
    ) {
      this._breakSec += dt;
      if (this._breakSec >= TARGETING.formationBreakHoldSec) {
        this.disengage();
        return null;
      }
    } else {
      this._breakSec = 0;
    }

    const k = mercatorScale(flight.latDeg);
    // Target state in TRUE meters relative to the player (x east, y up,
    // z south — matching the world axes with mercator stretch removed).
    // ryd (round 8.5 H1): chase the RENDERED altitude — in toy the target
    // draws in the drawn frame, and an intercept/formation must end up
    // visually alongside it (the player's own render Y is its true pos.y).
    const dx = (target.rx - flight.pos.x) / k;
    const dy = target.ryd - flight.pos.y;
    const dz = (target.rz - flight.pos.z) / k;
    const distM = Math.hypot(dx, dy, dz);
    const tv = target.fix1;
    const tSpeed = Math.hypot(tv.vE, tv.vN);

    if (this.mode === 'intercept' && distM <= TARGETING.interceptHandoffM) {
      this.mode = 'formation'; // arrived: hold the wing slot
    }

    if (this.mode === 'intercept') {
      // Closing speed along the line of sight (own velocity from the model)
      const fwd = flight.forward();
      const inv = 1 / (distM || 1);
      const losX = dx * inv;
      const losY = dy * inv;
      const losZ = dz * inv;
      const ownAlong = flight.speed * (fwd.x * losX + fwd.y * losY + fwd.z * losZ);
      const tgtAlong = tv.vE * losX + tv.vUp * losY + -tv.vN * losZ; // vN is north = -z
      const closing = Math.max(40, ownAlong - tgtAlong);
      const leadT = Math.min(25, distM / closing);

      // Lead-pursuit aim point (world units: horizontal offsets re-stretched)
      const aimX = target.rx + tv.vE * leadT * k;
      const aimY = target.ryd + tv.vUp * leadT; // rendered altitude (see dy above)
      const aimZ = target.rz - tv.vN * leadT * k;

      const cmd = this._steer(flight, aimX, aimY, aimZ, k);
      // Braking-curve speed law: the fastest speed from which constant
      // decel (with margin) still reaches `arrive` right at the handoff
      // distance — v(d) = sqrt(arrive² + 2·a·(d - handoff)). A fixed
      // decel-start distance can't work: shedding boost at FLIGHT.accel
      // needs ~7km, not 1km.
      const arrive = tSpeed + TARGETING.interceptOverspeedMps;
      const brakeD = Math.max(0, distM - TARGETING.interceptHandoffM);
      const vAllowed = Math.sqrt(arrive * arrive + 2 * FLIGHT.accel * 0.85 * brakeD);
      cmd.speedOverride = Math.min(FLIGHT.speeds.boost, vAllowed);
      cmd.speedPreset = userCmd.speedPreset;
      cmd.freeLook = userCmd.freeLook;
      return cmd;
    }

    // --- Formation: hold the wing slot in the target's local frame --------
    const yaw = target.yaw; // heading of the target (rad, 0=N, cw+)
    const fx = Math.sin(yaw); // target forward, true frame (x east, z south)
    const fz = -Math.cos(yaw);
    const rx = -fz; // right = forward rotated -90° about Y
    const rz = fx;
    const slot = TARGETING.formationSlot;
    const slotX = rx * slot.right - fx * slot.back; // true meters, relative to target
    const slotZ = rz * slot.right - fz * slot.back;
    // Slot position relative to the PLAYER (true meters)
    const ex = dx + slotX;
    const ey = dy + slot.up;
    const ez = dz + slotZ;

    // Loose position controller: desired velocity DIRECTION from
    // error·λ + target velocity; MAGNITUDE from a braking curve over the
    // slot error (excess over target speed ∝ √error) so a distant slot is
    // chased briskly but arrival is asymptotic — no boost-overshoot orbits.
    const lam = TARGETING.formationLambda;
    const vx = ex * lam + tv.vE;
    const vy = ey * lam + tv.vUp;
    const vz = ez * lam + -tv.vN;
    const vHoriz = Math.hypot(vx, vz);
    const errDist = Math.hypot(ex, ey, ez);
    const excess = 0.8 * Math.sqrt(2 * FLIGHT.accel * errDist);
    const desiredSpeed = clamp(tSpeed + excess, 40, FLIGHT.speeds.boost);

    const cmd = this._steerDirection(flight, vx, vy, vz, vHoriz);
    cmd.speedOverride = desiredSpeed;
    cmd.speedPreset = userCmd.speedPreset;
    cmd.freeLook = userCmd.freeLook;
    return cmd;
  }

  /** Steer toward an absolute world point. */
  _steer(flight, aimX, aimY, aimZ, k) {
    const dx = aimX - flight.pos.x;
    const dz = aimZ - flight.pos.z;
    const brg = Math.atan2(dx, -dz); // mercator k cancels in the ratio
    const hErr = wrapAngle(brg - flight.heading);
    const horiz = Math.hypot(dx / k, dz / k);
    const pitchDes = Math.atan2(aimY - flight.pos.y, Math.max(1, horiz));
    const pErr = pitchDes - flight.pitch;
    return {
      turn: clamp(hErr * 1.8, -1, 1),
      pitch: clamp(pErr * 2.4, -1, 1),
      boost: false,
    };
  }

  /** Steer along a desired velocity direction (true-frame components). */
  _steerDirection(flight, vx, vy, vz, vHoriz) {
    const brg = Math.atan2(vx, -vz);
    const hErr = wrapAngle(brg - flight.heading);
    const pitchDes = Math.atan2(vy, Math.max(1, vHoriz));
    const pErr = pitchDes - flight.pitch;
    return {
      turn: clamp(hErr * 1.8, -1, 1),
      pitch: clamp(pErr * 2.4, -1, 1),
      boost: false,
    };
  }
}

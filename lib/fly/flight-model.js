import { Vector3 } from 'three';
import { FLIGHT } from './fly-constants';
import {
  DEG2RAD,
  expApproach,
  expApproachAngle,
  mercatorScale,
  wrapAngle,
} from './coords';

const MAX_PITCH = 80 * DEG2RAD; // hard clamp keeps the euler rig singularity-free

/**
 * Arcade kinematic flight model — the War-Thunder-"instructor" scheme:
 * the player commands TURN and PITCH; bank is derived from coordinated-turn
 * physics (atan(v·ω/g)) so turns look like flying, not strafing. State is
 * heading/pitch/bank scalars + a speed scalar; no aerodynamics, no stall.
 *
 * Positions are engine world units (Web-Mercator meters, Y-up true meters);
 * speeds are TRUE m/s — horizontal displacement is scaled by mercatorScale.
 * Pure module: no React, no three-tile — trivially testable.
 */
export class FlightModel {
  constructor() {
    this.pos = new Vector3(); // world units
    this.heading = 0; // rad, 0 = north (-Z), increases clockwise (east)
    this.pitch = 0; // rad, + = nose up
    this.bank = 0; // rad, + = right wing down
    this.speed = FLIGHT.speeds.cruise; // true m/s

    this.turnRate = 0; // rad/s, eased toward command
    this.pitchRate = 0; // rad/s, eased toward command

    this.agl = Infinity; // meters above ground, fed by the caller
    this.latDeg = 0; // updated by the caller for mercator scale
    this.groundElev = 0; // terrain elevation (m) under the aircraft

    this._idleRollSec = 0;

    this._fwd = new Vector3();
  }

  /** Unit forward vector in world space for current heading/pitch. */
  forward(target = this._fwd) {
    const cp = Math.cos(this.pitch);
    return target.set(
      Math.sin(this.heading) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.heading) * cp
    );
  }

  /**
   * Advance one frame.
   * @param dt seconds (caller clamps)
   * @param cmd {turn: -1..1, pitch: -1..1 (+ = pull up), speedPreset, boost}
   */
  step(dt, cmd) {
    const F = FLIGHT;

    // --- Speed: ease toward preset with an accel limit -------------------
    // speedOverride (m/s) lets the Phase-5 autopilot command continuous
    // speeds; player input still runs through the presets.
    const presetSpeed =
      cmd.speedOverride ?? F.speeds[cmd.boost ? 'boost' : cmd.speedPreset] ?? F.speeds.cruise;
    let targetSpeed = presetSpeed;
    // Ceiling: thrust fades approaching the ceiling, gentle push-down above
    if (this.pos.y > F.ceiling - F.ceilingSoftZone) {
      const over = (this.pos.y - (F.ceiling - F.ceilingSoftZone)) / F.ceilingSoftZone;
      targetSpeed = Math.min(targetSpeed, F.speeds.cruise * Math.max(0.3, 1 - over));
    }
    const speedErr = targetSpeed - this.speed;
    const maxDelta = F.accel * dt;
    this.speed += Math.abs(speedErr) <= maxDelta ? speedErr : Math.sign(speedErr) * maxDelta;

    // --- Commanded rates (halved above the high-speed cutover) -----------
    const speedFactor = this.speed > F.highSpeedTurnCutover ? 0.5 : 1;
    const maxTurn = F.maxYawRateDeg * DEG2RAD * speedFactor * 2.2; // turn feels ~2x yaw authority
    const maxPitchRate = F.maxPitchRateDeg * DEG2RAD * speedFactor;

    this.turnRate = expApproach(this.turnRate, cmd.turn * maxTurn, F.rateLambda, dt);
    this.pitchRate = expApproach(this.pitchRate, cmd.pitch * maxPitchRate, F.rateLambda, dt);

    // --- Integrate heading/pitch -----------------------------------------
    this.heading = wrapAngle(this.heading + this.turnRate * dt);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.pitchRate * dt));

    // Auto-level pitch drift toward horizon when unpitched input
    if (Math.abs(cmd.pitch) < 0.05) {
      this.pitch = expApproach(this.pitch, 0, 0.25, dt);
    }

    // --- Bank follows the turn (coordinated) ------------------------------
    const bankTarget = Math.atan((this.speed * this.turnRate) / 9.81);
    const clampedBank = Math.max(
      -F.maxBankDeg * DEG2RAD,
      Math.min(F.maxBankDeg * DEG2RAD, bankTarget)
    );
    this.bank = expApproachAngle(this.bank, clampedBank, F.bankLambda, dt);

    // Auto-level bank after idle (only below the intentional-bank limit)
    if (Math.abs(cmd.turn) < 0.05) {
      this._idleRollSec += dt;
      if (
        this._idleRollSec > F.autoLevelIdleSec &&
        Math.abs(this.bank) < F.autoLevelMaxBankDeg * DEG2RAD
      ) {
        this.bank = expApproachAngle(this.bank, 0, (F.autoLevelRateDeg * DEG2RAD) / Math.max(Math.abs(this.bank), 0.01), dt * 0.5);
      }
    } else {
      this._idleRollSec = 0;
    }

    // --- Soft floor: scale descent to zero approaching terrain + clearance
    const floor = this.groundElev + F.floorClearance;
    let vy = Math.sin(this.pitch) * this.speed;
    if (vy < 0) {
      const bandTop = floor + F.floorSoftZone;
      if (this.pos.y <= floor) {
        vy = 0;
      } else if (this.pos.y < bandTop) {
        vy *= (this.pos.y - floor) / F.floorSoftZone;
      }
    }

    // --- Displace ----------------------------------------------------------
    const k = mercatorScale(this.latDeg); // horizontal true-m → map-units
    const cp = Math.cos(this.pitch);
    const vxz = this.speed * cp;
    this.pos.x += Math.sin(this.heading) * vxz * k * dt;
    this.pos.z += -Math.cos(this.heading) * vxz * k * dt;
    this.pos.y += vy * dt;

    // Terrain slide: never below floor (arcade forgiveness, no crash)
    if (this.pos.y < floor) this.pos.y = floor;

    this.agl = this.pos.y - this.groundElev;
  }
}

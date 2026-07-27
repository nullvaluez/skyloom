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
 *
 * Round 17 ("Your Wings"): the model is CONFIG-DRIVEN. `cfg` is a FLIGHT-shaped
 * object — the global FLIGHT block by default, or one of the hangar's per-
 * aircraft merges (lib/fly/player-aircraft.js `resolveAircraft().cfg`, which is
 * `{...FLIGHT, ...override}` so every field the step below reads is always
 * present). The default `new FlightModel()` is byte-identical to the round-16
 * model: cfg IS the FLIGHT object, so every `this.cfg.x` resolves to the same
 * value the old `FLIGHT.x` did. Consumers that need the envelope (chase camera,
 * autopilot, warp seeding, audio) read `flight.cfg` — never the FLIGHT import —
 * so an aircraft swap moves them all together.
 */
export class FlightModel {
  constructor(cfg = FLIGHT) {
    this.cfg = cfg;
    this.pos = new Vector3(); // world units
    this.heading = 0; // rad, 0 = north (-Z), increases clockwise (east)
    this.pitch = 0; // rad, + = nose up
    this.bank = 0; // rad, + = right wing down
    this.speed = this.cfg.speeds.cruise; // true m/s

    this.turnRate = 0; // rad/s, eased toward command
    this.pitchRate = 0; // rad/s, eased toward command

    this.agl = Infinity; // meters above ground, fed by the caller
    this.latDeg = 0; // updated by the caller for mercator scale
    this.groundElev = 0; // terrain elevation (m) under the aircraft

    this._idleRollSec = 0;

    // Round 18 (A5 GRAVITY) — the two crash/boost seams. Both are INERT at
    // these defaults: `boostBlocked` false makes the coercion in step() an
    // identity, and nothing in this model ever reads `floorContact`.
    this.boostBlocked = false; // set by FlyScene's boost METER (BOOST_METER)
    this.floorContact = null; // { vy, speed } for THIS frame, else null

    this._fwd = new Vector3();
  }

  /**
   * Swap the flight envelope MID-SESSION (hangar pick). Position, heading,
   * pitch and bank are deliberately untouched — you change aircraft, you do not
   * respawn — and the live speed is only clamped into the new envelope's
   * ceiling; step()'s normal accel limit then eases it to the commanded preset,
   * so a 750 m/s fighter dropping into a 95 m/s Skylark decelerates instead of
   * snapping. Discrete call site only (a store subscription), never per frame.
   */
  setConfig(cfg) {
    this.cfg = cfg;
    this.speed = Math.max(0, Math.min(this.speed, cfg.speeds.boost));
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
    const F = this.cfg;

    // --- Speed: ease toward preset with an accel limit -------------------
    // speedOverride (m/s) lets the Phase-5 autopilot command continuous
    // speeds; player input still runs through the presets.
    // Round 18 (A5): an empty BOOST METER coerces the held boost off. The
    // fallback is `cmd.speedPreset` — cruise for a Shift-holder — which is why
    // "the meter runs dry" reads as the plane settling back to cruise while
    // the HUD legend (which prints the RAW input) still says BOOST. With
    // boostBlocked false this is `cmd.boost`, so the expression below is the
    // round-17 one, value for value.
    const boosting = this.boostBlocked ? false : cmd.boost;
    const presetSpeed =
      cmd.speedOverride ?? F.speeds[boosting ? 'boost' : cmd.speedPreset] ?? F.speeds.cruise;
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
    // sinkRaw is the COMMANDED vertical rate; `vy` below is the same number
    // after the soft floor has had its say (round 18 reads both — see the
    // floorContact block at the end of step()).
    const sinkRaw = Math.sin(this.pitch) * this.speed;
    let vy = sinkRaw;
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

    // Round 18 (A5 GRAVITY) — GROUND-CONTACT telemetry. Transient: written
    // every frame, read in the SAME frame by lib/fly/crash-system.js and by
    // nothing else. The clamp above still owns the arcade slide; this only
    // records how hard you arrived, so the crash system can tell a landing
    // from a smear. With the crash system off, nothing reads it.
    //
    // Two choices worth the ink, both learned the hard way:
    //  * `sinkRaw`, not `vy`. The soft floor scales vy toward zero as you
    //    enter the band, so the REALIZED vertical rate at contact is ~0 by
    //    construction — a detector reading it could never fire.
    //  * "within one frame of the floor", not "below the floor". Inside the
    //    band dy/dt is proportional to the remaining gap, so over flat ground
    //    `pos.y < floor` is an ASYMPTOTE the model never actually reaches: a
    //    full nose-down dive pins a hair above the terrain forever. The
    //    one-frame reach (|sinkRaw| * dt) is the honest "you would be through
    //    it by now" test, and it costs no new tunable. It also subsumes the
    //    clamp case (ground rising to meet a descending aircraft).
    // Level contact deliberately records NOTHING: flying flat into a hillside
    // keeps the round-6 slide, which is the plan's rule and also what keeps a
    // DEM tile popping up under a harness from ever reading as a crash.
    this.floorContact =
      sinkRaw < 0 && this.pos.y <= floor - sinkRaw * dt
        ? { vy: sinkRaw, speed: this.speed }
        : null;

    this.agl = this.pos.y - this.groundElev;
  }
}

import { Vector3 } from 'three';
import { FLIGHT, WARP_TRIM } from './fly-constants';
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
    this._contact = { vy: 0, speed: 0 }; // reused — no per-frame garbage

    // Round 19 (E SLIPSTREAM). Both INERT until something arms them.
    // `boosting` is pure telemetry — the EFFECTIVE boost state (post
    // boost-meter coercion) that step() already computes and then threw away.
    // ChaseCamera reads it for the FOV punch edge and Effects.jsx for the heat
    // haze; nothing in this model reads it, so it changes no arithmetic.
    this.boosting = false;
    // Post-warp altitude trim: seconds of hold remaining + the MSL altitude to
    // hold. `_trimT` 0 = the whole block below is skipped = pre-R19 exactly.
    this._trimT = 0;
    this._trimY = 0;

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

  /**
   * Round 19 (E): arm the post-warp altitude trim. Called by FlyScene's
   * warpToGeo with the altitude the warp actually placed the aircraft at, so
   * the servo's target IS the arrival altitude — the trim can only ever hold
   * what the warp asked for, never invent an altitude of its own.
   *
   * Deliberately NOT armed by `warpTo` (the warp-behind-a-track path): that one
   * drops you WARP.aboveM over a moving contact you are about to chase, and an
   * altitude hold is exactly the wrong assist there.
   */
  armWarpTrim(altY) {
    if (!WARP_TRIM.enabled) return;
    this._trimT = WARP_TRIM.holdSec;
    this._trimY = altY;
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
    //
    // W1 integration (Fable): the '3' PRESET is coerced too — a meter that
    // only governed held Shift left preset boost as an unlimited loophole,
    // and the user picked the full meter. The preset swap below is the same
    // identity when boostBlocked is false. (Harness fleet keeps unlimited
    // boost via the sanctioned __flyBoostInfinite pin in scripts/_boot.js —
    // the meter never drains there, so this branch never engages;
    // verify-edge-fx's 40 s @ 750 m/s gate holds untouched.)
    const boosting = this.boostBlocked ? false : cmd.boost;
    // Round 19 (E): publish the EFFECTIVE boost state. Read-only telemetry for
    // the chase camera's punch edge and the speed-lines heat haze; this model
    // never reads it back, so no arithmetic here moves. "Boosting" is the same
    // notion R18's meter uses — held Shift OR the '3' preset — because both
    // command boost THRUST, and a punch that fired for one but not the other
    // would read as a bug in the key, not a feature of the throttle.
    const effPreset =
      this.boostBlocked && cmd.speedPreset === 'boost' ? 'cruise' : cmd.speedPreset;
    this.boosting = !!boosting || effPreset === 'boost';
    const presetSpeed =
      cmd.speedOverride ?? F.speeds[boosting ? 'boost' : effPreset] ?? F.speeds.cruise;
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

    // --- Round 19 (E SLIPSTREAM): post-warp altitude trim -----------------
    // The arrival assist. For WARP_TRIM.holdSec after a warp the PITCH axis is
    // flown by the instructor, not the stick — because the stick, on arrival,
    // is not the player. Mouse-steer is absolute (input-controller's read():
    // `pitch += _shape(-mouse.y)`), so a warp hands control back with the
    // cursor still parked wherever it was clicked; measured, an Atlas-height
    // cursor is a sustained cmd.pitch −0.471 that pins the nose at the −80°
    // clamp and puts 2,300 m into the ground in 16 s. That is P12.
    //
    // It IGNORES the small stick rather than fighting it: fighting settles at
    // an equilibrium (rate command vs servo ≈ 13° nose-down ≈ 40 m/s of sink)
    // which still fails the ±60 m contract. A deflection at or past
    // cancelPitch is a decision, not a parked cursor — that ends the window
    // permanently, the same frame, and normal flight resumes.
    //
    // `_trimT === 0` (no warp yet, or the window spent) makes pitchCmd the
    // SAME NUMBER as cmd.pitch, so every line below is byte-for-byte the R18
    // model for every harness that never warps.
    let pitchCmd = cmd.pitch;
    if (this._trimT > 0) {
      this._trimT = Math.max(0, this._trimT - dt);
      if (Math.abs(cmd.pitch) >= WARP_TRIM.cancelPitch) {
        this._trimT = 0; // deliberate stick: hand it all back, this frame
      } else {
        // Fade the stick back in over the last releaseSec instead of switching
        // it on at t=holdSec: a trim that ENDS is a nose that drops in one
        // frame, which reads as the aircraft being dropped a second time.
        // Through the body of the window this multiplier is exactly 0.
        const w = Math.min(1, this._trimT / Math.max(0.01, WARP_TRIM.releaseSec));
        pitchCmd = cmd.pitch * (1 - w);
      }
    }

    this.turnRate = expApproach(this.turnRate, cmd.turn * maxTurn, F.rateLambda, dt);
    this.pitchRate = expApproach(this.pitchRate, pitchCmd * maxPitchRate, F.rateLambda, dt);

    // --- Integrate heading/pitch -----------------------------------------
    this.heading = wrapAngle(this.heading + this.turnRate * dt);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.pitchRate * dt));

    // Auto-level pitch drift toward horizon when unpitched input
    if (Math.abs(pitchCmd) < 0.05) {
      this.pitch = expApproach(this.pitch, 0, 0.25, dt);
    }

    // Trim servo: hold the ARRIVAL altitude, not an invented one. The target
    // pitch is whatever nulls the altitude error at the current speed, capped
    // at maxHoldPitchDeg so a trim can never read as a zoom-climb — and since
    // the warp places the aircraft AT _trimY with pitch 0, the usual case is a
    // zero error, a zero hold pitch, and an aircraft that simply stays put.
    if (this._trimT > 0) {
      const sinHold = Math.max(
        -1,
        Math.min(1, ((this._trimY - this.pos.y) * WARP_TRIM.errGain) / Math.max(1, this.speed))
      );
      const cap = Math.sin(WARP_TRIM.maxHoldPitchDeg * DEG2RAD);
      const holdPitch = Math.asin(Math.max(-cap, Math.min(cap, sinHold)));
      const lt = 1 - Math.exp(-WARP_TRIM.lambda * dt);
      this.pitch += (holdPitch - this.pitch) * lt;
      this.pitchRate *= 1 - lt; // don't let a stale rate re-open what was just closed
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
    // (The payload is a REUSED object, not a fresh literal: ground skimming
    // holds contact for as long as you skim, and that is exactly the moment
    // not to hand the collector a per-frame allocation.)
    if (sinkRaw < 0 && this.pos.y <= floor - sinkRaw * dt) {
      this._contact.vy = sinkRaw;
      this._contact.speed = this.speed;
      this.floorContact = this._contact;
    } else {
      this.floorContact = null;
    }

    this.agl = this.pos.y - this.groundElev;
  }
}

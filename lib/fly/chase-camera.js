import { Vector3, Quaternion, Matrix4, Euler, MathUtils } from 'three';
import { CAMERA, CANVAS, FLIGHT, SHAKE } from './fly-constants';
import { expApproach } from './coords';
import { getTrauma } from './juice';

const _anchor = new Vector3();
const _lookTarget = new Vector3();
const _orbOffIdeal = new Vector3();
const _orbitPos = new Vector3();
const _orbitLook = new Vector3();
const _fwd = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3();
const _yAxis = new Vector3(0, 1, 0);
const _shakeE = new Euler(0, 0, 0, 'YXZ');
const _shakeQ = new Quaternion();

const DEG = Math.PI / 180;

/**
 * Round 18 shake noise: three pairs of sines with IRRATIONAL frequency
 * ratios, one pair per axis. Rational ratios re-phase on a short period and
 * the shake reads as a mechanical wobble; √2/φ/√3-ish ratios never repeat
 * inside a burst, so the same three cheap sines read as handheld camera.
 * Phase offsets keep the three axes from peaking together on frame 0.
 */
const SHAKE_WAVES = [
  [1.0, 0.0, 1.618034, 1.7], // yaw
  [0.7071068, 2.3, 1.324718, 4.1], // pitch
  [1.236068, 0.9, 0.8660254, 5.2], // roll
];

function shakeAxis(w, t) {
  return Math.sin(w[0] * t + w[1]) * 0.6 + Math.sin(w[2] * t + w[3]) * 0.4;
}

/**
 * Damped chase rig. Position follows an offset anchor behind/above the
 * plane (exponential damping — lag sells speed); orientation slerps toward
 * a look-ahead point and inherits a fraction of the plane's bank; FOV
 * widens with speed.
 *
 * Hold-RMB free-look (round 7): a true ORBIT pose — spherical offset around
 * the plane with unbounded yaw and clamped pitch, aimed AT the plane — is
 * blended in over the chase pose while the button is held, and blends back
 * out on release (snapback). The old rig kept the chase look-ahead target
 * during free-look, so a 180° drag pointed the camera away from the plane.
 *
 * The orbit pose damps its OFFSET (plane-relative), not its world position:
 * the chase pose's world-space lag (v·τ ≈ 45m at cruise — it sells speed)
 * would flatten any orbit of a moving plane into a trailing arc and the
 * camera could never get overhead.
 */
export class ChaseCamera {
  constructor() {
    this.fov = CANVAS.fov;
    this._look = { yaw: 0, pitch: 0 }; // free-look offsets (rad)
    this._freeAmt = 0; // 0 = pure chase pose, 1 = pure orbit pose
    this._chasePos = new Vector3(); // damped world-space chase position
    this._orbOff = new Vector3(); // damped plane-relative orbit offset
    this._initialized = false;
    this._shakeT = 0; // round 18: shake noise phase (seconds)
  }

  /** Hard-cut to the ideal pose on the next update (used by warp). */
  snap() {
    this._initialized = false;
    this._look.yaw = 0;
    this._look.pitch = 0;
    this._freeAmt = 0;
  }

  /**
   * @param dt seconds
   * @param flight FlightModel (pos in world units, heading/pitch/bank rad)
   * @param camera three PerspectiveCamera
   * @param freeLook {active, dx, dy} accumulated drag deltas
   * @param k horizontal mercator scale (world units per true meter)
   */
  update(dt, flight, camera, freeLook, k) {
    // --- Free-look offsets -------------------------------------------------
    const FL = CAMERA.freeLook;
    if (freeLook.active) {
      this._look.yaw -= freeLook.dx * FL.yawRate;
      this._look.pitch = MathUtils.clamp(
        this._look.pitch - freeLook.dy * FL.pitchRate,
        FL.minPitchRad,
        FL.maxPitchRad
      );
      freeLook.dx = 0;
      freeLook.dy = 0;
    } else {
      const l = 1 - Math.exp(-dt / (CAMERA.freeLookSnapbackSec / 4));
      this._look.yaw += (0 - this._look.yaw) * l;
      this._look.pitch += (0 - this._look.pitch) * l;
    }

    // Orbit-pose blend: in fast while held, out with the snapback so the
    // camera swings home together with the decaying look offsets.
    const freeTarget = freeLook.active ? 1 : 0;
    const bl = freeLook.active ? FL.blendLambda : 4 / CAMERA.freeLookSnapbackSec;
    this._freeAmt += (freeTarget - this._freeAmt) * (1 - Math.exp(-bl * dt));

    // Round 17: the envelope comes from the AIRCRAFT (flight.cfg), not the
    // global FLIGHT block — a 95 m/s Skylark must reach full FOV kick and full
    // follow-lengthening at ITS boost, not at the fighter's 750. cameraOffsetScale
    // then sizes the whole rig to the airframe (a 70 m 747 needs 2.8× the standoff
    // a 20 m fighter does). The chase pose is damped, so a mid-flight swap glides
    // to the new standoff instead of cutting. Fighter's scale is 1 ⇒ unchanged.
    const F = flight.cfg ?? FLIGHT;
    const camScale = F.cameraOffsetScale ?? 1;
    const speedFrac = Math.min(1, flight.speed / F.speeds.boost);
    const followScale = 1 + (CAMERA.boostOffsetScale - 1) * speedFrac;
    const back = CAMERA.offset.z * followScale * k * camScale;
    const up = CAMERA.offset.y * followScale * camScale;

    // --- Chase pose: behind + above in the plane's heading frame -----------
    const yaw = flight.heading;
    _anchor.set(
      flight.pos.x - Math.sin(yaw) * back,
      flight.pos.y + up + Math.sin(-flight.pitch) * back * 0.35,
      flight.pos.z + Math.cos(yaw) * back
    );
    flight.forward(_fwd);
    _lookTarget.copy(flight.pos).addScaledVector(_fwd, CAMERA.lookAheadM * k);

    // --- Orbit pose: spherical PLANE-RELATIVE offset, damped in offset
    // space so the camera rides the plane rigidly while swinging around it.
    const fa = this._freeAmt;
    const a = flight.heading + this._look.yaw;
    const cp = Math.cos(this._look.pitch);
    const sp = Math.sin(this._look.pitch);
    _orbOffIdeal.set(-Math.sin(a) * back * cp, up + back * sp, Math.cos(a) * back * cp);

    const snapPose = !this._initialized;
    const l = 1 - Math.exp(-CAMERA.posLambda * dt);
    if (snapPose) {
      this._chasePos.copy(_anchor);
      this._orbOff.copy(_orbOffIdeal);
      this._initialized = true;
    } else {
      this._chasePos.lerp(_anchor, l); // world-space lag (sells speed)
      this._orbOff.lerp(_orbOffIdeal, l); // offset-space (orbits cleanly)
    }

    camera.position.copy(this._chasePos);
    if (fa > 0.001) {
      _orbitPos.copy(flight.pos).add(this._orbOff);
      _orbitLook.set(
        flight.pos.x,
        flight.pos.y + CAMERA.offset.y * FL.orbitAimUpFrac,
        flight.pos.z
      );
      camera.position.lerp(_orbitPos, fa);
      _lookTarget.lerp(_orbitLook, fa);
    }

    // --- Orientation: bank share fades out in orbit (world-up there) -------
    const bankShare = flight.bank * CAMERA.bankShare * (1 - fa);
    _up.set(Math.sin(bankShare), Math.cos(bankShare), 0);
    // Rotate the banked up-vector into the heading frame so the tilt is
    // about the view axis, not world X.
    _up.applyAxisAngle(_yAxis, -flight.heading);

    _m.lookAt(camera.position, _lookTarget, _up);
    _q.setFromRotationMatrix(_m);
    if (snapPose) {
      camera.quaternion.copy(_q); // warp/first-frame: no swing-in
    } else {
      const ol = 1 - Math.exp(-CAMERA.lookLambda * dt);
      camera.quaternion.slerp(_q, ol);
    }

    // --- Screen shake (round 18) -------------------------------------------
    // Applied AFTER the slerp and in CAMERA-LOCAL space (right-multiply), so
    // the rig's settled pose is still the thing being damped — the shake is a
    // pure post-effect on the final orientation and cannot fight the damping.
    //
    // Two terms, both zero at rest: a SPEED buzz that wires the two dead
    // CAMERA.shakeSpeedFraction/shakeMaxDeg semantics (silent below
    // SHAKE.speedFrac of the AIRCRAFT's own boost — cruise is 180/750 = 0.24,
    // so every harness probe and every normal flight sits at exactly 0), and
    // TRAUMA squared (juice.js accumulator) for discrete hits. When the total
    // amplitude is zero we do not touch the quaternion AT ALL: that is what
    // makes SHAKE.enabled:false — and enabled:true at cruise — byte-identical
    // to the pre-R18 pose verify-chase-cam pins.
    if (SHAKE.enabled) {
      this._shakeT += dt;
      const over = (speedFrac - SHAKE.speedFrac) / (1 - SHAKE.speedFrac);
      const s = MathUtils.clamp(over, 0, 1);
      const speedShake = s * s * (3 - 2 * s); // smoothstep — no step at the gate
      const trauma = getTrauma();
      const ampDeg = SHAKE.maxDeg * speedShake + SHAKE.traumaMaxDeg * trauma * trauma;
      if (ampDeg > 1e-4) {
        const t = this._shakeT * (2 * Math.PI * SHAKE.noiseHz);
        const a = ampDeg * DEG;
        _shakeE.set(
          shakeAxis(SHAKE_WAVES[1], t) * a,
          shakeAxis(SHAKE_WAVES[0], t) * a,
          shakeAxis(SHAKE_WAVES[2], t) * a,
          'YXZ'
        );
        camera.quaternion.multiply(_shakeQ.setFromEuler(_shakeE));
      }
    }

    // --- FOV kick with speed ------------------------------------------------
    const fovTarget = CANVAS.fov + CAMERA.fovBoost * Math.pow(speedFrac, 1.5);
    this.fov = expApproach(this.fov, fovTarget, CAMERA.fovLambda, dt);
    if (Math.abs(camera.fov - this.fov) > 0.05) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

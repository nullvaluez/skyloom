import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';
import { CAMERA, CANVAS, FLIGHT } from './fly-constants';
import { expApproach } from './coords';

const _anchor = new Vector3();
const _lookTarget = new Vector3();
const _fwd = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3();
const _yAxis = new Vector3(0, 1, 0);

/**
 * Damped chase rig. Position follows an offset anchor behind/above the
 * plane (exponential damping — lag sells speed); orientation slerps toward
 * a look-ahead point and inherits a fraction of the plane's bank; FOV
 * widens with speed. Hold-RMB free-look orbits and snaps back.
 */
export class ChaseCamera {
  constructor() {
    this.fov = CANVAS.fov;
    this._look = { yaw: 0, pitch: 0 }; // free-look offsets (rad)
    this._initialized = false;
  }

  /** Hard-cut to the ideal pose on the next update (used by warp). */
  snap() {
    this._initialized = false;
    this._look.yaw = 0;
    this._look.pitch = 0;
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
    if (freeLook.active) {
      this._look.yaw -= freeLook.dx * 4;
      this._look.pitch = MathUtils.clamp(this._look.pitch - freeLook.dy * 2.5, -1.2, 1.2);
      freeLook.dx = 0;
      freeLook.dy = 0;
    } else {
      const l = 1 - Math.exp(-dt / (CAMERA.freeLookSnapbackSec / 4));
      this._look.yaw += (0 - this._look.yaw) * l;
      this._look.pitch += (0 - this._look.pitch) * l;
    }

    const speedFrac = Math.min(1, flight.speed / FLIGHT.speeds.boost);
    const followScale = 1 + (CAMERA.boostOffsetScale - 1) * speedFrac;

    // --- Anchor: behind + above in the plane's heading frame (world units)
    const yaw = flight.heading + this._look.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const back = CAMERA.offset.z * followScale * k;
    const up = CAMERA.offset.y * followScale;
    _anchor.set(
      flight.pos.x - sin * back,
      flight.pos.y + up + Math.sin(-flight.pitch) * back * 0.35,
      flight.pos.z + cos * back
    );

    const snapPose = !this._initialized;
    if (snapPose) {
      camera.position.copy(_anchor);
      this._initialized = true;
    } else {
      const l = 1 - Math.exp(-CAMERA.posLambda * dt);
      camera.position.lerp(_anchor, l);
    }

    // --- Orientation: look ahead of the plane, share some bank -------------
    flight.forward(_fwd);
    _lookTarget.copy(flight.pos).addScaledVector(_fwd, CAMERA.lookAheadM * k);
    _lookTarget.y += Math.tan(this._look.pitch) * CAMERA.lookAheadM * 0.6;

    const bankShare = flight.bank * CAMERA.bankShare;
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

    // --- FOV kick with speed ------------------------------------------------
    const fovTarget = CANVAS.fov + CAMERA.fovBoost * Math.pow(speedFrac, 1.5);
    this.fov = expApproach(this.fov, fovTarget, CAMERA.fovLambda, dt);
    if (Math.abs(camera.fov - this.fov) > 0.05) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

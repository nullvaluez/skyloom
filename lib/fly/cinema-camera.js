import { Matrix4, Quaternion, Vector3 } from 'three';
import { CAMERA, CANVAS } from './fly-constants';

const _mid = new Vector3();
const _pos = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);

/**
 * Cinema cam (round 6, Phase E): a wing-view rig used while the intercept/
 * formation autopilot is flying — the camera hangs abeam the player↔target
 * midpoint with a slow orbital drift, so a CHASE order pays off as an
 * actual air-to-air shot instead of the same over-the-shoulder view.
 * Works in the same ABSOLUTE frame as ChaseCamera (FlyScene brackets the
 * update with the floating-origin shift). Toggled with C; FlyScene
 * auto-reverts (+ chase.snap()) when the lock/autopilot drops.
 */
export class CinemaCamera {
  constructor() {
    this._t = 0;
    this._initialized = false;
  }

  /** Hard-cut to the ideal pose on the next update. */
  snap() {
    this._initialized = false;
  }

  /**
   * @param dt seconds
   * @param flight FlightModel (absolute world pos)
   * @param target traffic track (rx/ry/rz absolute world)
   * @param camera three PerspectiveCamera (absolute during this call)
   * @param k horizontal mercator scale at the player
   * @param groundElev terrain height under the player (m)
   */
  update(dt, flight, target, camera, k, groundElev) {
    const cfg = CAMERA.cinema;
    this._t += dt;

    // target.ryd (round 8.5 H1): frame the RENDERED target position — in
    // toy the fleet draws in the drawn frame, the player at true pos.y.
    _mid.set(
      (flight.pos.x + target.rx) / 2,
      (flight.pos.y + target.ryd) / 2,
      (flight.pos.z + target.rz) / 2
    );
    const sepM = Math.hypot(
      (flight.pos.x - target.rx) / k,
      flight.pos.y - target.ryd,
      (flight.pos.z - target.rz) / k
    );
    const rangeM = Math.max(sepM * cfg.rangeK, cfg.minRangeM);

    // Abeam of the pair axis, drifting slowly around it
    const axis = Math.atan2(target.rx - flight.pos.x, target.rz - flight.pos.z);
    const ang = axis + Math.PI / 2 + this._t * cfg.orbitRate;
    _pos.set(
      _mid.x + Math.sin(ang) * rangeM * k,
      Math.max(_mid.y + cfg.aboveM, groundElev + cfg.groundClearM),
      _mid.z + Math.cos(ang) * rangeM * k
    );

    if (!this._initialized) {
      camera.position.copy(_pos);
      this._initialized = true;
    } else {
      const l = 1 - Math.exp(-cfg.posLambda * dt);
      camera.position.lerp(_pos, l);
    }

    _m.lookAt(camera.position, _mid, _up);
    _q.setFromRotationMatrix(_m);
    if (this._initialized) {
      const ol = 1 - Math.exp(-cfg.lookLambda * dt);
      camera.quaternion.slerp(_q, ol);
    } else {
      camera.quaternion.copy(_q);
    }

    // Neutral FOV (the chase rig's speed-kick doesn't belong in a wing shot)
    if (Math.abs(camera.fov - CANVAS.fov) > 0.05) {
      camera.fov = CANVAS.fov;
      camera.updateProjectionMatrix();
    }
  }
}

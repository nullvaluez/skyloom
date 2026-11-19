import { Euler, Matrix4, MathUtils, Quaternion, Vector3 } from 'three';
import { composeAircraftMatrix, groundHullOffset } from './aircraft-pose.js';
import { renderView } from './render-view.js';

const DEG = Math.PI / 180;
const offset = new Vector3();
const forward = new Vector3();
const right = new Vector3();
const up = new Vector3();
const basis = new Matrix4();
const attitude = new Euler(0, 0, 0, 'YXZ');

/** The main camera sees the terrain from the F-35's eye point. The interior
 * camera uses the same optical axis and head rotation, in cockpit metres. */
export class PilotCamera {
  constructor() {
    this.head = new Quaternion();
    this.body = new Quaternion();
    this.world = new Quaternion();
    this.active = false;
    this.ready = false;
    this.reset();
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
  }

  setInteriorReady(ready) {
    this.ready = ready;
  }

  update(dt, flight, camera, input, trueScale, command) {
    this.command = command;
    const drag = input.freeLook;
    // Brackets look sideways on compact keyboards. Page Up/Down are a head tilt.
    const keyX = Number(input.keys.has(']')) - Number(input.keys.has('['));
    const keyY = Number(input.keys.has('pageup')) - Number(input.keys.has('pagedown'));
    const relax = Math.exp(-Math.min(dt, .1) * 6);
    if (drag.active || keyX || keyY) {
      this.yaw = MathUtils.clamp(this.yaw + (drag.active ? drag.dx * 2.8 : 0) + keyX * dt * 1.35, -1.56, 1.56);
      this.pitch = MathUtils.clamp(this.pitch - (drag.active ? drag.dy * 1.9 : 0) + keyY * dt, -.7, .82);
    } else {
      this.yaw *= relax;
      this.pitch *= relax;
    }
    drag.dx = drag.dy = 0;
    const pose = renderView(flight);
    composeAircraftMatrix(pose, flight.presentation, { groundHull: true, hullY: groundHullOffset(flight) }, basis);
    offset.set(0, 1.08, -4.08).applyMatrix4(basis);
    camera.position.copy(offset);
    this.body.setFromEuler(attitude.set(pose.pitch + (flight.presentation?.pitchOffset || 0), -pose.heading, -pose.bank + (flight.presentation?.rollOffset || 0)));
    this.head.setFromEuler(attitude.set(this.pitch - 14 * DEG, -this.yaw, 0));
    this.world.multiplyQuaternions(this.body, this.head);
    camera.quaternion.copy(this.world);
    if (trueScale !== 1) {
      // Invert composeTrueScaleMatrix's orthogonalisation. Upright lettering,
      // cockpit bank and the outside horizon now agree even at high latitude.
      forward.set(0, 0, -1).applyQuaternion(this.world);
      forward.y /= trueScale;
      forward.normalize().negate();
      right.set(1, 0, 0).applyQuaternion(this.world);
      right.y *= trueScale;
      right.normalize();
      up.crossVectors(forward, right);
      camera.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, forward));
    }
    const fov = MathUtils.clamp(2 * Math.atan(Math.tan(36 * DEG) / camera.aspect) / DEG, 62, 100);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}

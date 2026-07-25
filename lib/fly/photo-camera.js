import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';
import { CAMERA, PHOTO } from './fly-constants';

const _offIdeal = new Vector3();
const _lookTarget = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

/**
 * Round 17 — PHOTO MODE rig.
 *
 * A free orbit around the player's aircraft, in the same family as
 * ChaseCamera's RMB free-look pose (offset-space damping so the camera rides
 * a moving plane rigidly instead of trailing it) with three deliberate
 * differences:
 *
 *  1. **The pose is PERSISTENT.** The chase rig snaps yaw/pitch back to zero
 *     the moment the button is released — correct for a glance, fatal for
 *     composing a shot. Here the drag deltas accumulate into `_look` and stay
 *     there until the player drags again or leaves photo mode.
 *  2. **Distance is a first-class control.** The wheel scrubs
 *     PHOTO.minDistM..maxDistM (damped), where the chase distance is a fixed
 *     offset scaled by speed.
 *  3. **Pitch can go below the plane** (PHOTO.minPitchRad) — belly shots are
 *     half the point of a photo mode; the chase rig floors out near level so
 *     it never buries the camera in terrain during flight.
 *
 * Roll is deliberately NOT implemented this round (a Dutch-angle control
 * wants its own input surface and a horizon readout).
 *
 * Pure module — no store reads, no React. Consumes the same
 * `{active, dx, dy}` free-look struct the InputController already produces,
 * so a mouse drag, an RMB drag and a touch drag all feed it identically.
 */
export class PhotoCamera {
  constructor() {
    this._look = { yaw: 0, pitch: PHOTO.startPitchRad };
    this._dist = PHOTO.startDistM; // damped
    this._distTarget = PHOTO.startDistM;
    this._off = new Vector3(); // damped plane-relative orbit offset
    this._initialized = false;
    this._prevFov = null; // restored by the chase rig's own FOV ramp
  }

  /** Re-open on the default framing (entering photo mode / after a warp). */
  snap() {
    this._look.yaw = 0;
    this._look.pitch = PHOTO.startPitchRad;
    this._dist = PHOTO.startDistM;
    this._distTarget = PHOTO.startDistM;
    this._initialized = false;
  }

  /**
   * True EXACTLY ONCE on the first frame after this rig stops driving the
   * camera, whichever way photo mode was left (P, Esc, the pill's ✕, a warp).
   * The caller uses it to hard-cut the chase rig back in: chase damps in
   * WORLD space, and its `_chasePos` is however many kilometres stale the
   * plane travelled while you were composing — without the cut it swoops in
   * from wherever the shot started.
   */
  handoff() {
    if (!this._initialized) return false;
    this._initialized = false;
    return true;
  }

  /** Dev telemetry — the harness reads the live orbit through this. */
  telemetry() {
    return {
      yaw: +this._look.yaw.toFixed(4),
      pitch: +this._look.pitch.toFixed(4),
      dist: +this._dist.toFixed(1),
    };
  }

  /**
   * @param dt seconds
   * @param flight FlightModel (pos in world units, heading rad)
   * @param camera three PerspectiveCamera (already in ABSOLUTE coordinates)
   * @param input InputController — read for freeLook deltas + consumeZoom()
   * @param k horizontal mercator scale (world units per true metre)
   */
  update(dt, flight, camera, input, k) {
    // --- Orbit angles: accumulate, never snap back ------------------------
    const fl = input.freeLook;
    if (fl && (fl.dx !== 0 || fl.dy !== 0)) {
      this._look.yaw -= fl.dx * PHOTO.yawRate;
      this._look.pitch = MathUtils.clamp(
        this._look.pitch - fl.dy * PHOTO.pitchRate,
        PHOTO.minPitchRad,
        PHOTO.maxPitchRad
      );
      fl.dx = 0;
      fl.dy = 0;
    }

    // --- Distance: wheel scrub, exponential so the feel is scale-free -----
    const dz = input.consumeZoom ? input.consumeZoom() : 0;
    if (dz !== 0) {
      this._distTarget = MathUtils.clamp(
        this._distTarget * Math.exp(dz * PHOTO.zoomRate),
        PHOTO.minDistM,
        PHOTO.maxDistM
      );
    }
    const zl = 1 - Math.exp(-PHOTO.zoomLambda * dt);
    this._dist += (this._distTarget - this._dist) * zl;

    // --- Spherical PLANE-RELATIVE offset ----------------------------------
    // Horizontal components carry the mercator scale (the world is stretched
    // in X/Z by k at this latitude); Y is true metres, like every other rig.
    const a = flight.heading + this._look.yaw;
    const cp = Math.cos(this._look.pitch);
    const sp = Math.sin(this._look.pitch);
    const d = this._dist;
    _offIdeal.set(-Math.sin(a) * d * cp * k, d * sp, Math.cos(a) * d * cp * k);

    const first = !this._initialized;
    if (first) {
      this._off.copy(_offIdeal);
      this._initialized = true;
    } else {
      this._off.lerp(_offIdeal, 1 - Math.exp(-PHOTO.posLambda * dt));
    }

    camera.position.copy(flight.pos).add(this._off);
    // Belly shots pitch the camera under the aircraft; near the ground that
    // would bury it inside the terrain (and render the inside of a tile).
    const floorY = (flight.groundElev ?? 0) + PHOTO.groundClearM;
    if (camera.position.y < floorY) camera.position.y = floorY;

    // --- Aim at the aircraft (world up — no bank share; a photo rig with a
    // rolling horizon is a nausea generator, not a camera) -----------------
    _lookTarget.set(
      flight.pos.x,
      flight.pos.y + CAMERA.offset.y * PHOTO.aimUpFrac,
      flight.pos.z
    );
    _up.set(0, 1, 0);
    _m.lookAt(camera.position, _lookTarget, _up);
    _q.setFromRotationMatrix(_m);
    if (first) {
      camera.quaternion.copy(_q);
    } else {
      camera.quaternion.slerp(_q, 1 - Math.exp(-PHOTO.lookLambda * dt));
    }

    // --- Fixed lens: no speed FOV kick (the frame must not breathe while
    // you compose). The chase rig re-ramps its own FOV on the way out.
    if (Math.abs(camera.fov - PHOTO.fov) > 0.05) {
      camera.fov = PHOTO.fov;
      camera.updateProjectionMatrix();
    }
  }
}

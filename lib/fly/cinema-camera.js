import { Matrix4, Quaternion, Vector3 } from 'three';
import { CAMERA, CANVAS, CINEMA_FIX } from './fly-constants';

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
/**
 * Round 19 (E, P11): true separation between the player and a track, in TRUE
 * metres. Shared by the engage gate and the rig itself so "too far to engage"
 * and "how far to stand off" can never be computed two different ways.
 */
export function cinemaSeparationM(flight, target, k) {
  return Math.hypot(
    (flight.pos.x - target.rx) / k,
    flight.pos.y - (target.ryd ?? target.ry),
    (flight.pos.z - target.rz) / k
  );
}

/**
 * Round 19 (E, P11): may C engage on this pair? A 21 nm intercept target put
 * the rig 62 km from a midpoint 19 km from the player — the "wing shot" was
 * empty sky with two invisible specks in it, and pressing C looked broken.
 * Beyond engageMaxM the answer is simply no; FlyScene keeps the chase rig and
 * says so. CINEMA_FIX.enabled false ⇒ always true = the pre-R19 behaviour.
 */
export function canEngageCinema(flight, target, k) {
  if (!CINEMA_FIX.enabled) return true;
  if (!flight || !target) return false;
  return cinemaSeparationM(flight, target, k) <= CINEMA_FIX.engageMaxM;
}

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
    let rangeM = Math.max(sepM * cfg.rangeK, cfg.minRangeM);
    // Round 19 (E, P11): bound the standoff. `sep × rangeK` is unbounded, so
    // the further the target the further the camera runs — exactly backwards,
    // since a distant pair is the case that most needs the camera CLOSE.
    //
    // The cap is a preference, not an absolute, and the second term is why: a
    // flat 900 m clamp on a 2.4 km pair puts each aircraft 53° off the view
    // axis, outside the ~47° half-FOV, and frames neither. So the clamp may
    // never pull in tighter than the range that still fits the pair inside
    // frameSafety of the LIVE half-FOV (read off this camera every frame — it
    // is the honest number on any aspect, and it stays right while any FOV
    // animation is running). Measured on a 2.4 km pair: 3,840 m standoff
    // before, ~1,430 m now — a tighter shot with framing guaranteed rather
    // than merely likely.
    if (CINEMA_FIX.enabled) {
      // HORIZONTAL half-angle: the rig hangs abeam, so the pair lies across
      // the frame and it is the wide axis that has to contain it. (The orbit
      // drift only ever rotates the axis toward the view direction, which
      // shrinks the apparent separation — perpendicular is the worst case.)
      const vHalf = (camera.fov * Math.PI) / 360;
      const hHalf = Math.atan(Math.tan(vHalf) * (camera.aspect || 1));
      const tanH = Math.tan(hHalf * CINEMA_FIX.frameSafety);
      const framing = tanH > 1e-4 ? sepM / 2 / tanH : rangeM;
      rangeM = Math.max(
        CINEMA_FIX.minRangeM,
        Math.min(rangeM, Math.max(CINEMA_FIX.maxRangeM, framing))
      );
    }

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

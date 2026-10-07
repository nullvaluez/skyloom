import { Matrix4, Quaternion, Vector3 } from 'three';
import { CAMERA, CANVAS, CINEMA_FIX } from './fly-constants';

const _mid = new Vector3();
const _pos = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _qP = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _pp = new Vector3();
const _toP = new Vector3();
const _toT = new Vector3();
const _look = new Vector3();
const _carry = new Vector3();

/**
 * ESCORT pursuit framing. The wing shot below is built for a pair that is
 * already close: at 4–8 km it frames two specks in a lot of sky, which is
 * exactly the moment an escort starts. While the pair is far apart the rig
 * now hangs over the player's shoulder on the line toward the target — your
 * aircraft large in the lower third, the target ahead — and swings round to
 * the classic abeam wing shot as the separation closes (pursuitM → wingM).
 * Distances scale with the aircraft's own chase standoff (cameraOffsetScale),
 * so a 747 is not filmed from a fighter's distance.
 *
 * The swing is an arc around the pair's midpoint (angle and radius blend),
 * not a straight line between the two poses: the straight line cuts through
 * the region where the pair is wider than the frame (measured: a 1.5 km pair
 * at 16:9 put the player 4.8 NDC off screen half-way through the blend). Every
 * blended pose is also held outside the circle through both aircraft whose
 * inscribed angle is the safe horizontal FOV, so the pair always fits.
 * `enabled:false` restores the pre-escort rig exactly.
 */
export const CINEMA_PURSUIT = Object.freeze({
  enabled: true,
  wingM: 900, // separation at and below which the shot is the pure wing view
  pursuitM: 1800, // separation at and above which it is the pure pursuit view
  backK: 1.2, // × CAMERA.offset.z × cameraOffsetScale behind the player
  upK: 1.0, // × CAMERA.offset.y × cameraOffsetScale above the player
  sideK: 0.45, // × CAMERA.offset.z × cameraOffsetScale off the sightline
  targetWeight: 0.6, // look axis between player (0) and target (1), frame permitting
  // The CINEMA_FIX framing range is also a FLOOR. It only ever capped the
  // standoff, so on a portrait phone (~13° of horizontal half-FOV) the wing
  // shot stood at sep × rangeK and put both aircraft off the frame edges. A
  // no-op on desktop and landscape, where sep × rangeK is already wider.
  frameFloor: true,
});

function smooth01(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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
    this._last = new Vector3();
    this._hasLast = false;
  }

  /** Hard-cut to the ideal pose on the next update. */
  snap() {
    this._initialized = false;
    this._hasLast = false;
  }

  /**
   * Escort entry: fly the camera FROM wherever it is now (the chase pose) to
   * the cinematic pose with the rig's own damping, instead of cutting. The
   * camera object is shared by every rig, so its current pose is the start.
   */
  glide() {
    this._initialized = true;
    this._t = 0;
    this._hasLast = false;
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
    const P = CINEMA_PURSUIT;
    // target.ryd (round 8.5 H1): frame the RENDERED target position — in
    // toy the fleet draws in the drawn frame, the player at true pos.y.
    const tgtY = target.ryd ?? target.ry;
    _mid.set((flight.pos.x + target.rx) / 2, (flight.pos.y + tgtY) / 2, (flight.pos.z + target.rz) / 2);
    const sepM = Math.hypot(
      (flight.pos.x - target.rx) / k,
      flight.pos.y - tgtY,
      (flight.pos.z - target.rz) / k
    );
    const pursuit = P.enabled ? smooth01(P.wingM, P.pursuitM, sepM) : 0;
    // The orbit drift belongs to the wing shot: it runs only while that shot
    // is on screen, so the swing in from pursuit always lands abeam.
    this._t += dt * (1 - pursuit);

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
    //
    // HORIZONTAL half-angle: the rig hangs abeam, so the pair lies across
    // the frame and it is the wide axis that has to contain it. (The orbit
    // drift only ever rotates the axis toward the view direction, which
    // shrinks the apparent separation — perpendicular is the worst case.)
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (camera.aspect || 1));
    const safeHalf = hHalf * CINEMA_FIX.frameSafety;
    if (CINEMA_FIX.enabled) {
      const tanH = Math.tan(safeHalf);
      const framing = tanH > 1e-4 ? sepM / 2 / tanH : rangeM;
      rangeM = Math.max(
        CINEMA_FIX.minRangeM,
        Math.min(rangeM, Math.max(CINEMA_FIX.maxRangeM, framing))
      );
      if (P.enabled && P.frameFloor) rangeM = Math.max(rangeM, framing);
    }

    // Abeam of the pair axis, drifting slowly around it
    const axis = Math.atan2(target.rx - flight.pos.x, target.rz - flight.pos.z);
    const ang = axis + Math.PI / 2 + this._t * cfg.orbitRate;
    _pos.set(
      _mid.x + Math.sin(ang) * rangeM * k,
      Math.max(_mid.y + cfg.aboveM, groundElev + cfg.groundClearM),
      _mid.z + Math.cos(ang) * rangeM * k
    );

    // Escort pursuit framing for a far pair (see CINEMA_PURSUIT).
    if (pursuit > 0) {
      const s = flight.cfg?.cameraOffsetScale ?? 1;
      const back = CAMERA.offset.z * s * P.backK;
      const up = CAMERA.offset.y * s * P.upK;
      // A portrait phone has ~13° of horizontal half-FOV: pull the shoulder
      // offset in with the aspect so the player stays inside the frame.
      const side = CAMERA.offset.z * s * P.sideK * Math.min(1, (camera.aspect || 1) / 1.3);
      // Pair frame in true metres: x̂ from the player toward the target, ŵ the
      // side the abeam camera hangs on at zero drift (ŵ = (uz, −ux)).
      let ux = (target.rx - flight.pos.x) / k;
      let uz = (target.rz - flight.pos.z) / k;
      const hSep = Math.hypot(ux, uz);
      if (hSep > 1) {
        ux /= hSep;
        uz /= hSep;
      } else {
        // Stacked pair: film along the player's own heading.
        const hd = flight.heading ?? 0;
        ux = Math.sin(hd);
        uz = -Math.cos(hd);
      }
      const half = hSep / 2;
      // Both poses in polar form around the midpoint (φ from x̂ toward ŵ):
      // the wing shot at φ = 90° + drift, radius rangeM; pursuit behind the
      // player, raised, on the wing side.
      const phiW = Math.PI / 2 + this._t * cfg.orbitRate;
      const phiP = Math.atan2(side, -(half + back));
      let dPhi = phiP - phiW;
      dPhi -= Math.round(dPhi / (2 * Math.PI)) * 2 * Math.PI; // the short way round
      const phi = phiW + dPhi * pursuit;
      let rho = rangeM + (Math.hypot(half + back, side) - rangeM) * pursuit;
      // Stay outside the circle through both aircraft on which the pair
      // subtends exactly 2·safeHalf (inscribed-angle theorem): its centre sits
      // half/tan(2·safeHalf) off the midpoint, toward the camera's side.
      const fit = 2 * safeHalf;
      if (fit < Math.PI - 1e-3) {
        const d = half / Math.tan(fit);
        const across = d * Math.abs(Math.sin(phi));
        rho = Math.max(rho, across + Math.sqrt(across * across + half * half));
      }
      const along = Math.cos(phi) * rho;
      const wide = Math.sin(phi) * rho;
      _pos.set(
        _mid.x + (along * ux + wide * uz) * k,
        Math.max(
          _mid.y + cfg.aboveM + (flight.pos.y + up - _mid.y - cfg.aboveM) * pursuit,
          groundElev + cfg.groundClearM
        ),
        _mid.z + (along * uz - wide * ux) * k
      );
    }

    if (!this._initialized) {
      camera.position.copy(_pos);
      this._initialized = true;
    } else {
      // Over the shoulder the rig rides WITH the player (like the chase rig's
      // transport): a world-space lag of speed/posLambda would trail the
      // camera ~90 m behind a fighter at cruise. The wing shot keeps its lag.
      if (pursuit > 0 && this._hasLast) {
        camera.position.addScaledVector(_carry.copy(flight.pos).sub(this._last), pursuit);
      }
      const l = 1 - Math.exp(-cfg.posLambda * dt);
      camera.position.lerp(_pos, l);
    }
    this._last.copy(flight.pos);
    this._hasLast = true;

    _m.lookAt(camera.position, _mid, _up);
    _q.setFromRotationMatrix(_m);
    if (pursuit > 0) {
      // Look between the two aircraft, leaning toward the target only as far
      // as the frame allows: a weight w on the target puts the player
      // atan(w·sinθ / (1−w+w·cosθ)) off axis, so cap w where that equals the
      // safe half-FOV (w = ½ exactly when the pair fills the safe frame).
      _toP.copy(flight.pos).sub(camera.position).normalize();
      _toT.set(target.rx, tgtY, target.rz).sub(camera.position).normalize();
      const theta = Math.acos(Math.max(-1, Math.min(1, _toP.dot(_toT))));
      const tau = Math.tan(safeHalf);
      const room = Math.sin(theta) + tau * (1 - Math.cos(theta));
      const cap = room > 1e-6 ? Math.max(0.5, tau / room) : 1;
      const w = Math.min(0.5 + (P.targetWeight - 0.5) * pursuit, cap);
      _look
        .copy(_toP)
        .multiplyScalar(1 - w)
        .addScaledVector(_toT, w)
        .add(camera.position);
      _m.lookAt(camera.position, _look, _up);
      _qP.setFromRotationMatrix(_m);
      // Ease from the wing shot's midpoint look over the first quarter.
      _q.slerp(_qP, Math.min(1, pursuit * 4));
    }
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

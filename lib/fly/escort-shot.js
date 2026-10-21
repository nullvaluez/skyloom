/**
 * PLAY PASS — ENCOUNTERS: the escort shot (ENCOUNTER_FEEL.shot; FLY_PLAY_PASS.md F4).
 *
 * What the review saw over Manhattan: "Fly alongside" on a 100 kt AS350 put
 * the cinema camera abeam the pair at 1.6 × their separation — 160 to 1,000 m
 * out — so a 13 m helicopter drew 5–10 px under its own bracket and the jet
 * was a speck at the frame edge. The wing shot is right for two airliners a
 * kilometre apart; it is wrong for the moment the player asked for.
 *
 * Close in (separation ≤ photoM) this rig flies a PHOTO SHIP: it sits
 * `subjectK` target-lengths from the target on the target's far side, `angle`
 * off the line from your aircraft through it, a few degrees high, on the
 * SUNLIT side — the target large and lit in the foreground, your aircraft
 * behind it in the same frame, like an air-to-air shoot. It breathes slowly
 * round that angle. Far out (≥ pursuitM) it is CINEMA_PURSUIT's over-the-
 * shoulder pose; in between it swings round the pair on an arc (never a
 * straight line through it) and every pose is held outside the circle on
 * which the pair would be wider than the frame (the inscribed-angle bound
 * CinemaCamera already uses). Angles are computed in TRUE metres, which is
 * what TRUE_SCALE renders; the look is built in scene units so S maps it
 * back onto the same true direction.
 *
 * The rig rides with your aircraft (both are flying ~50–250 m/s; a world-space
 * lag would leave a 30 m standoff 40 m behind) and damps toward the pose.
 * The payoff beat (lib/fly/encounter-feel.js) eases the camera in, onto its
 * best angle, with a small push of the lens.
 *
 * `escortShotState` is the shot's one shared state (one escort at a time):
 * the sun direction the scene rig publishes, the beat, and what the shot did
 * this frame (photo weight, side, separation) for the HUD's clean frame.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { CAMERA, CANVAS, CINEMA_FIX } from './fly-constants';
import { playPassBlock, playPassOn } from './play-pass';

export const ESCORT_SHOT_ON = playPassOn('ENCOUNTER_FEEL');
const BLOCK = playPassBlock('ENCOUNTER_FEEL') ?? {};
export const SHOT = Object.freeze({
  photoM: 320, pursuitM: 1050, subjectK: 3.4, minM: 30, maxM: 260, angleDeg: 30, driftDeg: 8, driftSec: 36,
  elevDeg: 6, targetWeight: 0.6, posLambda: 3, lookLambda: 4.5, sideHoldSec: 10, sunSwitch: 0.55,
  ...(BLOCK.shot ?? {}),
});
export const PAYOFF = Object.freeze({
  swingSec: 1.6, shutterSec: 1.9, holdSec: 4.2, fovPushDeg: 6, closeK: 0.8, release: true, thumbPx: 560, momentSec: 6.5,
  ...(BLOCK.payoff ?? {}),
});
/** The beat's best angle: a three-quarter front, a little higher. */
const BEST = Object.freeze({ angleDeg: 24, elevDeg: 9 });

export const escortShotState = {
  clock: 0, // the shot's own seconds (drift, side hold, beat)
  drift: 0, // seconds spent in the photo-ship shot (the breathing orbit's phase)
  photo: 0, // 0 pursuit … 1 photo ship, this frame
  side: 1, // ±1: which side of the line the photo ship flies on
  sideAt: -1e9, // clock when the side was chosen
  sepM: null,
  frame: 0, // increments every update (the HUD sees a live shot)
  sun: { x: 0, y: 1, z: 0 }, // TRUE sun direction (x east, y up, z south), published by the scene rig
  beat: null, // { t0 } while the payoff beat runs (lib/fly/encounter-feel.js)
};

const DEG = Math.PI / 180;
const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _pos = new Vector3();
const _look = new Vector3();
const _carry = new Vector3();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function smooth01(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

/** 0 → 1 → 0 over the beat: ease in over swingSec, hold, ease out over swingSec. */
export function beatWeight(beat, clock, P = PAYOFF) {
  if (!beat) return 0;
  const t = clock - beat.t0;
  const rise = smooth01(0, P.swingSec, t);
  const fall = smooth01(P.swingSec + P.holdSec, P.swingSec * 2 + P.holdSec, t);
  return rise * (1 - fall);
}

/**
 * The photo-ship placement relative to the TARGET, TRUE metres: the camera
 * `R` from the target, `beta` off the far side of the line from the player
 * through it (sign = side), `elev` up. Shrinks the angle and backs off until
 * the pair subtends no more than `fit` (rad). Pure; exported for the gate.
 *   ux,uz: horizontal unit vector player → target; hSep, dy: target − player.
 */
export function photoShipPose(ux, uz, hSep, dy, R, beta, elev, side, fit) {
  const wx = uz, wz = -ux; // ŵ, the side the pursuit pose hangs on
  let b = beta, r = R, angle = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < 10; i++) {
    const rc = r * Math.cos(elev);
    cx = ux * rc * Math.cos(b) + side * wx * rc * Math.sin(b);
    cz = uz * rc * Math.cos(b) + side * wz * rc * Math.sin(b);
    cy = r * Math.sin(elev);
    // camera → target, camera → player (player = target − (ux·hSep, dy, uz·hSep))
    const ax = -cx, ay = -cy, az = -cz;
    const bx = -ux * hSep - cx, by = -dy - cy, bz = -uz * hSep - cz;
    const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
    angle = Math.acos(clamp(cos, -1, 1));
    if (angle <= fit) break;
    b *= 0.8;
    r *= 1.15;
  }
  return { x: cx, y: cy, z: cz, R: r, beta: b, angle };
}

/** Which side of the line is sunlit: +1 or −1 (the camera on the sun's side sees the lit faces). */
export function sunlitSide(ux, uz, beta, sun) {
  const wx = uz, wz = -ux;
  const h = Math.hypot(sun.x, sun.z) || 1;
  const sx = sun.x / h, sz = sun.z / h;
  const along = (ux * sx + uz * sz) * Math.cos(beta);
  const across = (wx * sx + wz * sz) * Math.sin(beta);
  return { plus: along + across, minus: along - across };
}

/**
 * Drive the camera for one frame. `rig` is the CinemaCamera (its _initialized /
 * _hasLast / _last carry glide() and snap() through unchanged); `pursuitCfg` is
 * CINEMA_PURSUIT (passed in to keep the import one-way).
 */
export function updateEscortShot(rig, pursuitCfg, dt, flight, target, camera, k, groundElev, st = escortShotState) {
  const cfg = CAMERA.cinema;
  st.clock += dt;
  st.frame += 1;
  // glide() and snap() both clear _hasLast: a fresh shot picks its side again.
  if (!rig._hasLast) {
    st.sideAt = -1e9;
    st.drift = 0;
  }
  const tgtY = target.ryd ?? target.ry;
  // Pair frame in TRUE metres: x̂ player → target (horizontal), ŵ = (uz, −ux).
  let ux = (target.rx - flight.pos.x) / k;
  let uz = (target.rz - flight.pos.z) / k;
  const dy = tgtY - flight.pos.y;
  const hSep = Math.hypot(ux, uz);
  if (hSep > 1) {
    ux /= hSep;
    uz /= hSep;
  } else {
    const hd = flight.heading ?? 0;
    ux = Math.sin(hd);
    uz = -Math.cos(hd);
  }
  const wx = uz, wz = -ux;
  const half = hSep / 2;
  const sep = Math.hypot(hSep, dy);
  const p = smooth01(SHOT.photoM, SHOT.pursuitM, sep);
  st.photo = 1 - p;
  st.sepM = sep;
  if (p < 1) st.drift += dt * (1 - p);

  const vHalf = (camera.fov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * (camera.aspect || 1));
  const safeHalf = hHalf * CINEMA_FIX.frameSafety;
  // The photo ship can see the pair stacked as well as side by side: its fit
  // and the look's lean use the NARROWER half-angle (vertical on a desktop).
  const tightHalf = Math.min(hHalf, vHalf) * CINEMA_FIX.frameSafety;
  const beatK = beatWeight(st.beat, st.clock);

  // ---- the photo ship (relative to the target) ----
  const len = target.fleetType?.spec?.length ?? 30;
  const R = clamp(len * SHOT.subjectK, SHOT.minM, SHOT.maxM) * (1 - (1 - PAYOFF.closeK) * beatK);
  const breathe = Math.sin((2 * Math.PI * st.drift) / SHOT.driftSec) * SHOT.driftDeg * DEG;
  const beta = (SHOT.angleDeg * DEG + breathe) * (1 - beatK) + BEST.angleDeg * DEG * beatK;
  const elev = (SHOT.elevDeg + (BEST.elevDeg - SHOT.elevDeg) * beatK) * DEG;
  // The sunlit side: chosen when the photo ship first takes the frame, then
  // held; changed only when the other side is clearly better lit.
  const lit = sunlitSide(ux, uz, beta, st.sun);
  const sunHigh = Math.abs(st.sun.y) > 0.92;
  if (st.photo > 0 && !sunHigh) {
    const fresh = st.clock - st.sideAt > SHOT.sideHoldSec;
    const want = lit.plus >= lit.minus ? 1 : -1;
    const gain = Math.abs(lit.plus - lit.minus);
    if (st.sideAt < 0 || (fresh && want !== st.side && gain > SHOT.sunSwitch)) {
      st.side = want;
      st.sideAt = st.clock;
    }
  }
  const ship = photoShipPose(ux, uz, hSep, dy, R, beta, elev, st.side, 2 * tightHalf * 0.92);
  // In the pair's polar frame around the midpoint (φ from x̂ toward ŵ).
  const shipAlong = half + (ship.x * ux + ship.z * uz);
  const shipWide = ship.x * wx + ship.z * wz;
  const phiS = Math.atan2(shipWide, shipAlong);
  const rhoS = Math.hypot(shipAlong, shipWide);

  // ---- the pursuit pose (CINEMA_PURSUIT, as CinemaCamera builds it) ----
  const s = flight.cfg?.cameraOffsetScale ?? 1;
  const back = CAMERA.offset.z * s * pursuitCfg.backK;
  const up = CAMERA.offset.y * s * pursuitCfg.upK;
  const sideP = CAMERA.offset.z * s * pursuitCfg.sideK * Math.min(1, (camera.aspect || 1) / 1.3);
  const phiP = Math.atan2(sideP, -(half + back));
  const rhoP = Math.hypot(half + back, sideP);

  // ---- the arc between them, held outside the pair's fit circle ----
  // The swing is linear in separation, so its steepest step is the average one.
  const swing = clamp((sep - SHOT.photoM) / (SHOT.pursuitM - SHOT.photoM), 0, 1);
  const phi = phiS + wrap(phiP - phiS) * swing;
  let rho = rhoS + (rhoP - rhoS) * swing;
  const fit = 2 * safeHalf * 0.9;
  if (swing > 0 && fit < Math.PI - 1e-3) {
    const d = half / Math.tan(fit);
    const across = d * Math.abs(Math.sin(phi));
    rho = Math.max(rho, across + Math.sqrt(across * across + half * half));
    // …and far enough that a stacked pair fits the narrower (vertical) half-angle.
    rho = Math.max(rho, Math.abs(dy) / 2 / Math.tan(tightHalf * 0.85));
  }
  const along = Math.cos(phi) * rho;
  const wide = Math.sin(phi) * rho;
  const yShip = tgtY + ship.y;
  const yPursuit = flight.pos.y + up;
  _pos.set(
    (flight.pos.x + target.rx) / 2 + (along * ux + wide * wx) * k,
    Math.max(yShip + (yPursuit - yShip) * swing, groundElev + cfg.groundClearM),
    (flight.pos.z + target.rz) / 2 + (along * uz + wide * wz) * k
  );

  // ---- move: ride with the player, damp toward the pose ----
  if (!rig._initialized) {
    camera.position.copy(_pos);
    rig._initialized = true;
  } else {
    if (rig._hasLast) camera.position.add(_carry.copy(flight.pos).sub(rig._last));
    camera.position.lerp(_pos, 1 - Math.exp(-SHOT.posLambda * dt));
  }
  rig._last.copy(flight.pos);
  rig._hasLast = true;

  // ---- look: between the two from where the camera IS, leaning to the target
  // only as far as the frame allows (the CinemaCamera cap) ----
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  let px = (flight.pos.x - cx) / k, py = flight.pos.y - cy, pz = (flight.pos.z - cz) / k;
  let tx = (target.rx - cx) / k, ty = tgtY - cy, tz = (target.rz - cz) / k;
  const pl = Math.hypot(px, py, pz) || 1, tl = Math.hypot(tx, ty, tz) || 1;
  px /= pl; py /= pl; pz /= pl;
  tx /= tl; ty /= tl; tz /= tl;
  const theta = Math.acos(clamp(px * tx + py * ty + pz * tz, -1, 1));
  const tau = Math.tan(tightHalf);
  const room = Math.sin(theta) + tau * (1 - Math.cos(theta));
  const cap = room > 1e-6 ? Math.max(0.5, tau / room) : 1;
  const want = SHOT.targetWeight + (pursuitCfg.targetWeight - SHOT.targetWeight) * p;
  const w = Math.min(want + (0.72 - want) * beatK, cap);
  const lx = px * (1 - w) + tx * w, ly = py * (1 - w) + ty * w, lz = pz * (1 - w) + tz * w;
  _look.set(cx + lx * k, cy + ly, cz + lz * k);
  _m.lookAt(camera.position, _look, _up);
  _q.setFromRotationMatrix(_m);
  camera.quaternion.slerp(_q, 1 - Math.exp(-SHOT.lookLambda * dt));

  // ---- lens: neutral, pushed a little for the beat ----
  const fov = CANVAS.fov - PAYOFF.fovPushDeg * beatK;
  if (Math.abs(camera.fov - fov) > 0.02) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(camera.fov - fov) < 0.03) camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

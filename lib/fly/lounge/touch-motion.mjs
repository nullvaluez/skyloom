/**
 * LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md; the TOUCH stream) — motion look math:
 * the phone as the binoculars' body. Pure: DeviceOrientation angles in, head
 * angle offsets out (the runtime in lib/fly/airport-watch-runtime.js owns the
 * listener, the permission and the reference; node tests this module).
 *
 * WHERE THE PHONE LOOKS. DeviceOrientation (alpha, beta, gamma; degrees) is
 * the intrinsic Z-X'-Y'' rotation R = Rz(alpha) Rx(beta) Ry(gamma) taking the
 * device frame (x right, y up the screen in the device's NATURAL portrait
 * orientation, z out of the screen) to the earth frame (x east, y north, z
 * up). The view through the phone is the direction out of its BACK, -z, so
 * the look direction is R (0, 0, -1). That axis does not depend on how the
 * screen content is rotated, which is the whole screen-orientation correction
 * for a direction: a phone turned to landscape (screen.orientation.angle 90
 * or 270) and aimed at the same aircraft reports different Euler angles but
 * the same back axis, so it looks at the same point (the gate proves this
 * pose by pose). What the screen angle changes is only the roll about that
 * axis, which the lounge camera never applies (roll 0); screenRoll() returns
 * it for completeness. Yaw follows the lounge convention: turning LEFT is
 * positive (alpha grows counter-clockwise seen from above), 0 = north.
 *
 * STEADY HANDS. A hand holding a phone at arm's length trembles by a few
 * tenths of a degree; at 20x that is a tenth of the field. The filter is a
 * one-pole low-pass (tauSec) followed by a backlash deadband (deadbandDeg):
 * the output moves only once the filtered input leaves a band around it, so
 * tremor never shimmers the view while a deliberate turn follows at once
 * (one deadband behind). Near straight up or down (|pitch| > maxPitchDeg)
 * yaw is not defined by the axis: it is held there.
 */
import { MOBILE_TOUCH } from '../observation-config.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const wrapPi = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/** The look direction out of the phone's back, earth frame: { x, y, z } (east, north, up). */
export function backAxis(alpha, beta, gamma, out = {}) {
  const a = (alpha || 0) * DEG, b = (beta || 0) * DEG, g = (gamma || 0) * DEG;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g);
  out.x = -sg * ca - cg * sb * sa;
  out.y = -sg * sa + cg * sb * ca;
  out.z = -cg * cb;
  return out;
}

/**
 * Where the phone looks: { yaw, pitch, valid } in radians (yaw left-positive
 * from north; pitch up). `valid` is false for missing angles (a desktop
 * browser fires the event with nulls). `screenAngle` is accepted so every
 * caller passes the same arguments, and is irrelevant here (see the header).
 */
export function deviceLook(alpha, beta, gamma, screenAngle = 0, out = {}) {
  void screenAngle;
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    out.valid = false;
    return out;
  }
  const v = backAxis(alpha, beta, gamma, {});
  out.pitch = Math.asin(Math.max(-1, Math.min(1, v.z)));
  out.yaw = Math.atan2(-v.x, v.y);
  out.valid = true;
  return out;
}

/** The roll of the screen's content about the back axis (radians), for a screen angle (degrees). */
export function screenRoll(alpha, beta, gamma, screenAngle = 0) {
  // The content's up in device coordinates, then into the earth frame.
  const s = (screenAngle || 0) * DEG;
  const ux = Math.sin(s), uy = Math.cos(s);
  const a = (alpha || 0) * DEG, b = (beta || 0) * DEG, g = (gamma || 0) * DEG;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g);
  // R * (ux, uy, 0): columns of R for x and y.
  const rx = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const ry = [-sa * cb, ca * cb, sb];
  const up = [rx[0] * ux + ry[0] * uy, rx[1] * ux + ry[1] * uy, rx[2] * ux + ry[2] * uy];
  // Roll: the angle of the content's up from the world-up projected across the view.
  const look = backAxis(alpha, beta, gamma, {});
  const vz = [0, 0, 1];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const lv = [look.x, look.y, look.z];
  const worldUp = vz.map((c, i) => c - dot(vz, lv) * lv[i]);
  const right = [lv[1] * worldUp[2] - lv[2] * worldUp[1], lv[2] * worldUp[0] - lv[0] * worldUp[2], lv[0] * worldUp[1] - lv[1] * worldUp[0]];
  return Math.atan2(dot(up, right), dot(up, worldUp));
}

/**
 * A motion-look filter: feed it the device look each event (with the seconds
 * since the last), read the head offset from the reference. reset(look)
 * recentres (the look at enable() becomes the zero).
 */
export function createMotionFilter(cfg = MOBILE_TOUCH.motion) {
  const ref = { yaw: 0, pitch: 0 };
  const low = { yaw: 0, pitch: 0 }; // low-passed offset
  const out = { yaw: 0, pitch: 0 }; // after the deadband
  let primed = false;
  const db = cfg.deadbandDeg * DEG;
  const band = (value, held) => (value - held > db ? value - db : held - value > db ? value + db : held);
  const filter = {
    get primed() { return primed; },
    offset: out,
    reset(look) {
      primed = !!look?.valid;
      if (primed) {
        ref.yaw = look.yaw;
        ref.pitch = look.pitch;
      }
      low.yaw = low.pitch = out.yaw = out.pitch = 0;
    },
    /** One sample; returns the filtered head offset { yaw, pitch } (radians). */
    step(look, dt) {
      if (!look?.valid) return out;
      if (!primed) {
        filter.reset(look);
        return out;
      }
      const a = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-3, cfg.tauSec));
      // Yaw is undefined looking straight up or down: hold it there.
      if (Math.abs(look.pitch) <= cfg.maxPitchDeg * DEG) {
        const dy = wrapPi(look.yaw - ref.yaw);
        low.yaw += wrapPi(dy - low.yaw) * a;
      }
      low.pitch += (look.pitch - ref.pitch - low.pitch) * a;
      out.yaw = band(low.yaw, out.yaw);
      out.pitch = band(low.pitch, out.pitch);
      return out;
    },
  };
  return filter;
}

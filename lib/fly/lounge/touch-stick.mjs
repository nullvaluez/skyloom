/**
 * LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md; the TOUCH stream) — the walk stick's
 * mapping from a thumb's offset to the walk. Pure (LoungeTouchControls draws
 * the stick; lib/fly/lounge-walk-runtime.js setMoveAnalog walks it; node
 * tests the mapping).
 *
 * The thumb's offset from where it landed (dx right, dy down, CSS px) is read
 * as a fraction r of MOBILE_TOUCH.stick.travelPx (clamped to 1). Inside the
 * deadzone nothing walks (a resting thumb never creeps). From the deadzone to
 * runAt the walk speed rises from 0 to the full walk along a gentle curve
 * (fine positioning near the glass, a stroll at mid-throw); past runAt it
 * runs, and once running it keeps running down to runAt - runHold, so a
 * thumb at the threshold never flickers between the two. The direction is
 * the thumb's: up the screen is forward.
 */
import { MOBILE_TOUCH } from '../observation-config.js';

const STICK = MOBILE_TOUCH.stick;

/**
 * { forward, right, amount, run, r, kx, ky } for a thumb offset. forward /
 * right are the walk direction scaled by `amount` (0..1, the share of the walk
 * speed; 1 while running); kx / ky place the knob (the offset clamped to the
 * travel ring). `wasRunning` is the previous answer's `run` (hysteresis).
 */
export function stickVector(dx, dy, wasRunning = false, cfg = STICK, out = {}) {
  const len = Math.hypot(dx, dy);
  const travel = cfg.travelPx;
  const r = Math.min(1, len / travel);
  const k = len > travel ? travel / len : 1;
  out.kx = dx * k;
  out.ky = dy * k;
  out.r = r;
  if (!(len > 0) || r <= cfg.deadzone) {
    out.forward = out.right = out.amount = 0;
    out.run = false;
    return out;
  }
  out.run = r >= cfg.runAt || (wasRunning && r >= cfg.runAt - cfg.runHold);
  const walk = Math.min(1, (r - cfg.deadzone) / Math.max(1e-6, cfg.runAt - cfg.deadzone));
  out.amount = out.run ? 1 : Math.pow(walk, cfg.curve);
  out.forward = (-dy / len) * out.amount;
  out.right = (dx / len) * out.amount;
  return out;
}

/**
 * Is (x, y) inside the stick's thumb zone? The zone is the lower-left of the
 * viewport (width / height fractions, capped in px) above `bottomPx` (the
 * --lounge-stick-bottom line: the dock and the home indicator stay theirs)
 * and right of `leftPx` minus a little grace.
 */
export function inStickZone(x, y, vw, vh, bottomPx, leftPx = 0, cfg = STICK) {
  const z = cfg.zone;
  const w = Math.min(z.maxWidthPx, vw * z.widthFrac);
  const h = Math.min(z.maxHeightPx, vh * z.heightFrac);
  const bottom = vh - bottomPx;
  return x >= Math.max(0, leftPx - 12) && x <= w && y <= bottom && y >= bottom - h;
}

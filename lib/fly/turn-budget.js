/**
 * SHIP PASS FRAME (FR-8; PACE_ADAPT.turn, SHIPS OFF) — the yaw-rate input of
 * the turn budget (lib/fly/finalize-pace.js setTurnBudgetK). FlyScene's
 * SHIP PASS FRAME frame block calls noteHeading(heading, dt) every frame;
 * while the yaw rate exceeds `yawDegPerSec` the shared finalize allowance is
 * scaled by `budgetK`. Unarmed (the shipped state) this returns at once and
 * the scale stays exactly 1. Arm it for an A/B with `?flags=PACE_ADAPT` and
 * `window.__flyPaceAdaptOverride = { turn: { enabled: true } }` before boot,
 * then run scripts/verify-ship-frame-yaw.cjs both ways on the 5080.
 */
import { shipPassBlock, shipPassOn } from './ship-pass';
import { setTurnBudgetK } from './finalize-pace';

let cfg;
let lastHeading = null;

function turnConfig() {
  if (cfg === undefined) {
    const t = shipPassOn('PACE_ADAPT') ? shipPassBlock('PACE_ADAPT')?.turn : null;
    cfg = t && t.enabled === true ? t : null;
  }
  return cfg;
}

/** The scale for a yaw rate (pure). */
export function turnScale(degPerSec, t) {
  return t && degPerSec > t.yawDegPerSec ? t.budgetK : 1;
}

/** Heading (radians) and the frame's dt (seconds), once per frame. */
export function noteHeading(headingRad, dtSec, t = turnConfig()) {
  if (!t) return 1;
  if (lastHeading == null || !(dtSec > 0) || !Number.isFinite(headingRad)) {
    lastHeading = headingRad;
    return 1;
  }
  let d = headingRad - lastHeading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  lastHeading = headingRad;
  const k = turnScale((Math.abs(d) * (180 / Math.PI)) / dtSec, t);
  setTurnBudgetK(k);
  return k;
}

/** Test seam. */
export function resetTurnBudget() {
  cfg = undefined;
  lastHeading = null;
  setTurnBudgetK(1);
}

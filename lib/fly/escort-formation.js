/**
 * PLAY PASS — ENCOUNTERS (ENCOUNTER_FEEL.formation; FLY_PLAY_PASS.md F4).
 *
 * The wing slot held by SPEED along the target's track and a bounded heading
 * correction ACROSS it.
 *
 * The classic formation law (lib/fly/autopilot.js) flies toward
 * `slot error · λ + target velocity` at `target speed + √(2·a·|error|)` — a
 * speed that is never below the target's. Behind the slot that is right. Past
 * it, the only way back is to turn round: on a 100 kt helicopter the measured
 * escort over Manhattan looped 54 → 483 → 687 → 317 → 109 → 74 → 417 m in 30 s,
 * banked knife-edge, and the 30 s alongside timer reset three times without
 * ever paying out.
 *
 * Here the heading is the target's course plus a correction toward the slot
 * capped at crossMaxDeg (so the aircraft never turns its back on the target),
 * and the along-track error sets the speed on BOTH sides of the slot: ahead
 * of it you ease off below the target's speed (down to minMps) and it comes
 * back to you. Near the slot the law is linear (alongK), far behind it is the
 * classic braking curve, so the join from an intercept is as brisk as before.
 *
 * Pure and allocation-free apart from the result object: node-gated by
 * scripts/verify-play-encounters.mjs. Returns null when it does not apply
 * (flag off, a target too slow to hold beside) — the caller then runs the
 * classic law unchanged.
 */
import { playPassBlock, playPassOn } from './play-pass';

const FEEL_ON = playPassOn('ENCOUNTER_FEEL');
const CFG = playPassBlock('ENCOUNTER_FEEL')?.formation ?? {};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEG = Math.PI / 180;

/**
 * @param ex,ey,ez slot position relative to the player, TRUE metres (x east, y up, z south)
 * @param yaw target heading (rad, 0 = N, clockwise +)
 * @param tv target fix1 velocities { vE, vN, vUp } (m/s)
 * @param tSpeed target ground speed (m/s)
 * @param F the player's flight config ({ accel, speeds: { boost } })
 * @param lam the classic formation λ (vertical channel, unchanged)
 * @param cfg tunables (defaults to the ENCOUNTER_FEEL block; the gate passes its own)
 * @returns {{ vx, vy, vz, vHoriz, speed, along, cross } | null}
 */
export function formationHold(ex, ey, ez, yaw, tv, tSpeed, F, lam, cfg = FEEL_ON ? CFG : null) {
  if (!cfg || !Number.isFinite(tSpeed) || !Number.isFinite(yaw)) return null;
  const minMps = cfg.minMps ?? 38;
  if (tSpeed < minMps * 1.1) return null; // cannot hold beside a hover: the classic law orbits it
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const along = ex * fx + ez * fz; // > 0: the slot is ahead of you
  const cross = ex * rx + ez * rz; // > 0: the slot is to your right (target frame)
  const accel = F?.accel ?? 40;
  const boost = F?.speeds?.boost ?? 750;
  // Linear near the slot (no chatter at zero), the braking curve far from it.
  const a = Math.abs(along);
  const term = Math.sign(along) * Math.min((cfg.alongK ?? 0.35) * a, 0.8 * Math.sqrt(2 * accel * a));
  // Heading: the target's course plus a capped turn toward the slot.
  const capped = (cfg.crossMaxDeg ?? 32) * DEG;
  const corr = clamp(Math.atan2((cfg.crossK ?? 0.45) * cross, Math.max(10, tSpeed)), -capped, capped);
  const hd = yaw + corr;
  // Crabbing toward the slot costs along-track speed: pay it back.
  const speed = clamp((tSpeed + term) / Math.max(0.5, Math.cos(corr)), minMps, boost);
  const vHoriz = Math.max(1, speed);
  return {
    vx: Math.sin(hd) * vHoriz,
    vy: ey * lam + (tv?.vUp ?? 0),
    vz: -Math.cos(hd) * vHoriz,
    vHoriz,
    speed,
    along,
    cross,
  };
}

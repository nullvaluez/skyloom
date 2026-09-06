/**
 * Round 24 (A PACE) — FRAME_STEP: a fixed-timestep simulation with an
 * interpolated render pose. Recon FL-04, plan §0 ruling 2 and ruling 6.
 *
 * WHAT IS WRONG TODAY. `flight.step(dt, cmd)` is called once per frame with the
 * RENDER delta, clamped at 50 ms, and `flight.pos` is simultaneously the sim
 * state and the render pose. Three consequences:
 *
 *  - motion smoothness is exactly frame pacing: every dropped frame is a jump;
 *  - a long frame SLOWS THE WORLD DOWN (the 50 ms clamp turns a stall into
 *    time dilation) while traffic dead-reckoning keeps wall-clock time, so
 *    relative motion glitches through every hitch;
 *  - the integration is explicit Euler on a delta that varies frame to frame,
 *    so identical inputs give different trajectories at different frame rates.
 *
 * WHAT THIS PROVIDES. An accumulator that advances the model in fixed `1/hz`
 * steps (at most `maxSubsteps` per frame, so a stall cannot spiral), plus the
 * interpolation factor for the leftover. `flight.pos` and `flight.heading`
 * REMAIN THE SIM TRUTH — the crash detector, the contracts, and every harness
 * pose read them and are untouched. The interpolated pose is published as NEW
 * fields, `runtime.flight.renderPos` / `renderQuat`, which render consumers
 * OPT INTO.
 *
 * WHAT IS DELIBERATELY NOT HERE. The consumer opt-in (PlayerPlane, the chase
 * camera, Contrail, PlayerGroundShadow reading `renderPos` instead of `pos`) is
 * NOT wired in this round. It is the half that can move a harness pose, and it
 * cannot be certified in this container: the fleet's poses are pinned through
 * `flight.pos` by a `setInterval`, and proving that a render-pose consumer
 * still lands on the pinned pose needs the fleet actually running, which this
 * venue cannot do at a useful rate. Shipping the seam and the probe, with the
 * consumer list written down, is the honest half of this to land. See
 * scripts/r24-a-pace.md §8c.
 *
 * The accumulator is pure and has no dependency on three or React, so it is
 * testable in node — which is what `scripts/verify-frame-step.mjs` does.
 */

import { FRAME_STEP } from './fly-constants';
import { pinned } from './fly-pins';

/**
 * Create an accumulator. `hz` is the fixed simulation rate; `maxSubsteps`
 * bounds the catch-up so a 2-second stall cannot ask for 240 steps.
 */
export function createFrameStep(cfg = pinned(FRAME_STEP, '__flyFrameStepOverride')) {
  const hz = Math.max(1, cfg.hz || 120);
  const fixed = 1 / hz;
  const maxSubsteps = Math.max(1, cfg.maxSubsteps || 4);
  let acc = 0;
  let dropped = 0;
  let steps = 0;

  return {
    fixed,
    hz,
    maxSubsteps,
    /**
     * Advance by a render delta. Returns how many fixed steps to run and the
     * interpolation factor for the render pose.
     *
     * `alpha` is the leftover fraction of a fixed step: 0 means the render pose
     * IS the sim pose (a substep boundary), which is the identity the probe
     * asserts.
     */
    advance(dtSec) {
      acc += dtSec;
      let n = 0;
      while (acc >= fixed && n < maxSubsteps) {
        acc -= fixed;
        n++;
      }
      // A stall longer than maxSubsteps * fixed cannot be caught up without
      // spiralling, so the remainder is DROPPED rather than carried. That is
      // the one place a fixed step deliberately loses time, and it is counted
      // so a soak can see it rather than infer it.
      if (acc >= fixed) {
        dropped += Math.floor(acc / fixed);
        acc = acc % fixed;
      }
      steps += n;
      return { steps: n, alpha: acc / fixed };
    },
    stats() {
      return { steps, dropped, acc, fixed, hz, maxSubsteps };
    },
    reset() {
      acc = 0;
      dropped = 0;
      steps = 0;
    },
  };
}

/**
 * Interpolate a render pose between two sim poses. Writes into `out` (a plain
 * {x,y,z}) and returns it — no allocation on the hot path.
 */
export function lerpPose(out, prev, cur, alpha) {
  out.x = prev.x + (cur.x - prev.x) * alpha;
  out.y = prev.y + (cur.y - prev.y) * alpha;
  out.z = prev.z + (cur.z - prev.z) * alpha;
  return out;
}

/** Shortest-arc interpolation for the three attitude angles, in radians. */
export function lerpAngle(a, b, alpha) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * alpha;
}

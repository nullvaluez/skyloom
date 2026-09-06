/**
 * Round 24 (A PACE) — FINALIZE_PACE: one shared per-frame brake for every
 * streaming engine's finalize step. Recon WB-3 and A9.
 *
 * WHAT IS UNBUDGETED TODAY. Drape SAMPLING is budgeted per millisecond in all
 * four chunk engines, but the final ASSEMBLY is atomic per chunk: a merge, a
 * `computeVertexNormals` (two passes over V + I), a `computeBoundingSphere`
 * (two more), a collision-column run walk, and then three's first-draw
 * `bufferData` of four or five attributes on the next render. A 2x2 skyline
 * group is measured at ~135k verts / ~5.9 MB of attributes IN ONE FRAME
 * (fly-constants.js:3020-3022). Only the toy engine has a wall-clock brake at
 * all, and its guard is `done > 0 &&` — so the FIRST chunk always lands, no
 * matter how long the previous frame ran, and the four engines cannot see each
 * other at all: each may spend its own budget in the same frame.
 *
 * WHAT THIS ADDS, in two rules:
 *
 *  1. THE FIRST CHUNK IS NOT FREE. If the previous frame overran
 *     `longFrameMs`, no engine finalizes anything this frame. A frame that is
 *     already late is the worst possible moment to add a 6 MB upload, and
 *     "always let the first one through" is exactly how a hitch train
 *     sustains itself.
 *  2. THE BUDGET IS SHARED. `budgetLeftMs()` counts from the START OF THE
 *     FRAME, not from each engine's own entry, so the four engines plus veg
 *     draw on ONE allowance instead of four.
 *
 * Neither rule can starve a chunk: a deferred chunk keeps its place in
 * `pendingFinalize` and is retried next frame, and `ready` counts are
 * unchanged — this only moves WHEN work lands, never WHETHER it does.
 * THAT CLAIM WAS FALSE AS ORIGINALLY WRITTEN and is only true now, because
 * "retried next frame" is worth nothing if next frame refuses on the same
 * grounds forever. See the defect record below: the spike test and the
 * starvation cap are what make the sentence above true.
 *
 * The frame is stamped once, from FlyScene's -50 block, before any engine runs.
 *
 * ---------------------------------------------------------------------------
 * RULE 1 AS FIRST SHIPPED WAS A DEFECT. This is the round's first defect found
 * in a feature that had already been flipped ON, and the honest record of it
 * belongs here rather than only in the ledger.
 *
 * Rule 1 originally read `lastDtMs <= longFrameMs` — a test for a LEVEL, with
 * longFrameMs fixed at 24 ms. On any machine that runs steadily BELOW ~41 fps
 * every frame is "long", so rule 1 refused the first finalize of every frame
 * forever: `mayFinalize(0)` false on every call, each engine's
 * `if (!mayFinalize(done)) break;` firing before its loop body ran once, and NO
 * CHUNK EVER FINALIZING. The user-visible symptom is not a stutter; it is that
 * buildings never appear at all. 30 fps is a 33 ms frame and 20 fps is 50 ms,
 * so the affected machines are laptops and integrated GPUs — precisely the ones
 * that report the symptoms this round exists to fix.
 *
 * It surfaced on the build container, where SwiftShader frames are 300-1000 ms
 * and the starvation is therefore total: pass 2's flash-guard census read 0
 * meshes and 0 triangles at Powell AND Manhattan after the same 60 s settle
 * that gave 31,576 / 126,116 triangles in pass 1 with the brake off. The venue
 * did not cause the defect. It made a graded failure into an absolute one, and
 * so made it visible.
 *
 * THE FIX IS A SPIKE TEST, and it is in the product, not in a harness seam. A
 * frame is refused only when it exceeds BOTH `longFrameMs` AND `spikeK` times a
 * running EMA of recent frame times, so:
 *
 *   - a 40 ms hitch amid 16 ms frames is a spike and is refused — which is the
 *     hitch train rule 1 was written to break;
 *   - a steady 33 ms machine is never refused, because its own baseline is
 *     33 ms and it is not spiking, it is simply slower;
 *   - a steady 1 fps venue is a no-op BY CONSTRUCTION, for the same reason.
 *     That last line is the proof that this is the product's fix: the harness
 *     needs no exemption from a rule that correctly ignores it.
 *
 * The spike is measured against the EMA OF THE FRAMES BEFORE IT, never against
 * an average the spike has already been folded into — otherwise a large enough
 * hitch raises its own threshold and hides itself.
 *
 * AND A HARD STARVATION CAP. Even a genuine hitch train may not defer more than
 * `maxRefuseFrames` consecutive frames; the next frame is admitted whatever the
 * EMA says. No streaming rule may be able to stall the world indefinitely,
 * however good its reason on any individual frame. Rule 1 is an optimisation,
 * and an optimisation that can starve is worse than not having it.
 *
 * WHAT THE HARNESS SCALER STILL DOES. E's `budgetK()` (lib/fly/harness-budget.js,
 * exactly 1 in production and in every harness that does not set the global)
 * multiplies rule 2's shared allowance, matching the five engine sites where E
 * already scales the COUNT budgets. Rule 1 needs no K seam at all now. Any gate
 * that measures pacing, stalls or stream-in SHAPE must leave the scaler at 1 —
 * which is also why the scaler may only ever make the budget more generous.
 */

import { FINALIZE_PACE } from './fly-constants';
import { pinned } from './fly-pins';
import { budgetK } from './harness-budget';

/**
 * EMA smoothing for the spike baseline. Deliberately a module constant and not
 * a knob: it is the instrument's smoothing, not a policy. At 0.1 the baseline
 * follows a genuine change in machine speed within a few dozen frames while a
 * single hitch moves it by a tenth of its own size.
 */
const EMA_ALPHA = 0.1;

let cfg = null;
let lastDtMs = 0;
let frameStartMs = 0;
/** Running EMA of frame time, ms. 0 means unseeded. */
let emaDtMs = 0;
/** Consecutive frames rule 1 has refused, for the starvation cap. */
let refuseRun = 0;
/**
 * Rule 1's verdict for THIS frame, decided once in `noteFinalizeFrame`. It must
 * be a per-frame decision and not a per-call one: four engines each call
 * `mayFinalize(0)` in the same frame, and they must all get the same answer or
 * the starvation cap would count one frame up to four times.
 */
let frameRefuses = false;

/** Resolved once, on first use (the pin is set before Fly mode mounts). */
function config() {
  if (!cfg) cfg = pinned(FINALIZE_PACE, '__flyFinalizePaceOverride');
  return cfg;
}

/** True when the brake is armed at all. */
export function finalizePaceOn() {
  return config().enabled === true;
}

/**
 * Stamp the frame. `dtSec` is the delta of the frame that just ELAPSED, which
 * is what rule 1 needs: the question is whether the machine is currently
 * struggling, not whether this frame will.
 */
export function noteFinalizeFrame(dtSec) {
  lastDtMs = dtSec * 1000;
  frameStartMs = performance.now();
  const c = config();
  if (!c.enabled) {
    frameRefuses = false;
    return;
  }
  // Seed from longFrameMs rather than from the first frame observed: a cold
  // start has no baseline, and seeding from the first frame would make every
  // first frame un-spikeable by definition.
  if (emaDtMs === 0) emaDtMs = c.longFrameMs;
  // The baseline is the EMA BEFORE this frame is folded in — see the header.
  const baselineMs = emaDtMs;
  emaDtMs += (lastDtMs - emaDtMs) * EMA_ALPHA;
  const spike = lastDtMs > c.longFrameMs && lastDtMs > c.spikeK * baselineMs;
  if (spike && refuseRun < Math.max(0, c.maxRefuseFrames)) {
    frameRefuses = true;
    refuseRun++;
  } else {
    frameRefuses = false;
    refuseRun = 0;
  }
}

/**
 * Milliseconds of the shared per-frame finalize allowance still unspent.
 * `budgetK()` is exactly 1 outside a harness that sets the global, so this is
 * `budgetMs - elapsed` byte-for-byte in production.
 */
export function budgetLeftMs() {
  return config().budgetMs * budgetK() - (performance.now() - frameStartMs);
}

/**
 * The one call every engine makes. `done` is how many chunks THIS engine has
 * already finalized this frame.
 *
 *  - `done === 0`: allowed unless the previous frame was a SPIKE (rule 1), and
 *    never for more than `maxRefuseFrames` frames in a row.
 *  - `done > 0`  : allowed only while the shared budget lasts (rule 2).
 */
export function mayFinalize(done) {
  const c = config();
  if (!c.enabled) return true;
  if (done === 0) return !frameRefuses;
  return budgetLeftMs() > 0;
}

/** Test seam. */
export function resetFinalizePace() {
  cfg = null;
  lastDtMs = 0;
  frameStartMs = 0;
  emaDtMs = 0;
  refuseRun = 0;
  frameRefuses = false;
}

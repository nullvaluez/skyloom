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
 *
 * The frame is stamped once, from FlyScene's -50 block, before any engine runs.
 */

import { FINALIZE_PACE } from './fly-constants';
import { pinned } from './fly-pins';

let cfg = null;
let lastDtMs = 0;
let frameStartMs = 0;

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
}

/** Milliseconds of the shared per-frame finalize allowance still unspent. */
export function budgetLeftMs() {
  return config().budgetMs - (performance.now() - frameStartMs);
}

/**
 * The one call every engine makes. `done` is how many chunks THIS engine has
 * already finalized this frame.
 *
 *  - `done === 0`: allowed unless the previous frame overran (rule 1).
 *  - `done > 0`  : allowed only while the shared budget lasts (rule 2).
 */
export function mayFinalize(done) {
  const c = config();
  if (!c.enabled) return true;
  if (done === 0) return lastDtMs <= c.longFrameMs;
  return budgetLeftMs() > 0;
}

/** Test seam. */
export function resetFinalizePace() {
  cfg = null;
  lastDtMs = 0;
  frameStartMs = 0;
}

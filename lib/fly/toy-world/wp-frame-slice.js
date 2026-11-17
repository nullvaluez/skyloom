/**
 * WORLD PASS B r2b: one finalize allowance per frame for every World Pass
 * finalize (FLY_WORLD_PASS.md, round 2 item 3). Owner: stream B (ARRIVAL).
 *
 * ARRIVAL finalizes a building tile in slices of `finalizeSliceMs` a frame.
 * Another stream's finalize that cannot be sliced (REACH's skyline group, one
 * tile at a time) asks for a WHOLE frame instead: it is granted only in a
 * frame where no World Pass slice ran yet, and after it ARRIVAL does no slice
 * work in that frame. So the two never stack in one frame, and neither is
 * held back more than HOLD frames in a row while the other has work (no
 * starvation either way, whatever order the two engines run in).
 *
 * The frame is identified by `document.timeline.currentTime`, which the
 * browser sets once per animation frame and holds through every rAF callback
 * of that frame (every useFrame). Where there is no document timeline (node,
 * a worker) every call grants: nothing here can hold work back off the page.
 *
 * Only flag-on code calls this module (ARRIVAL's uploads path, REACH's stand-in
 * finalize behind its own seam line); with every flag off nothing here runs.
 */

let frame = null;
let n = 0; // frame counter (this module's own)
let spentMs = 0;
let whole = false;
// Fairness, both ways, with a period of HOLD + 1 frames when both want work:
// each side may be held back at most HOLD consecutive frames, then the other
// side gives it a frame. Not a strict alternation: the shared R24 brake
// (finalize-pace.js) forgets a waiting owner after two frames, and a period-2
// alternation against that queue livelocked (each side always found the other
// first in the brake's queue; measured: a prepared tile waited 60 s, 571
// grants against 571 refusals).
const HOLD = 3;
let wholeHeld = 0, wholeAskAt = -2; // whole-frame requests refused in a row, and the last frame one asked
let sliceHeld = 0, sliceAskAt = -2; // ARRIVAL frames held back in a row, and the last frame it asked
const stat = { wholeGranted: 0, wholeRefused: 0, slicesYielded: 0 };

function now() {
  const t = globalThis.document?.timeline?.currentTime;
  return t == null ? null : t;
}

/** Roll the record over at a new frame; false when there is no frame clock (always grant). */
function roll() {
  const f = now();
  if (f === null) return false;
  if (f !== frame) {
    frame = f;
    n += 1;
    spentMs = 0;
    whole = false;
  }
  return true;
}

/**
 * ARRIVAL, before any slice work this frame: false when this frame belongs to
 * a whole-frame finalize (granted already, or one has been refused HOLD
 * frames in a row and asked last frame).
 */
export function wpSliceMayRun() {
  if (!roll()) return true;
  const owed = wholeHeld >= HOLD && wholeAskAt >= n - 1;
  if (whole || (owed && spentMs === 0)) {
    if (sliceAskAt !== n) sliceHeld += 1;
    sliceAskAt = n;
    stat.slicesYielded += 1;
    return false;
  }
  if (sliceAskAt !== n) sliceHeld = 0;
  sliceAskAt = n;
  return true;
}

/** ARRIVAL, after its slice work: what it spent this frame (ms). */
export function wpSliceSpend(ms) {
  if (!roll()) return;
  if (ms > 0) spentMs += ms;
}

/**
 * A finalize that cannot be sliced asks for the rest of this frame. True when
 * granted: no World Pass slice ran this frame yet, none was granted whole, and
 * ARRIVAL is not owed a frame (held back HOLD frames in a row, asking last
 * frame). False means "a later frame".
 */
export function wpWholeFinalize() {
  if (!roll()) return true;
  const owed = sliceHeld >= HOLD && sliceAskAt >= n - 1;
  if (whole || spentMs > 0 || owed) {
    if (!whole && wholeAskAt !== n) wholeHeld += 1;
    if (!whole) wholeAskAt = n;
    stat.wholeRefused += 1;
    return false;
  }
  whole = true;
  wholeHeld = 0;
  wholeAskAt = n;
  stat.wholeGranted += 1;
  return true;
}

/** Counters (diagnostic only). */
export function wpFrameSliceStats() {
  return { ...stat };
}

/** Test seam. */
export function resetWpFrameSlice() {
  frame = null;
  n = 0;
  spentMs = 0;
  whole = false;
  wholeHeld = 0;
  wholeAskAt = -2;
  sliceHeld = 0;
  sliceAskAt = -2;
  stat.wholeGranted = 0;
  stat.wholeRefused = 0;
  stat.slicesYielded = 0;
}

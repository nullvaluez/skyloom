/**
 * R24 (E CERT) — capture the GL canvas WITHOUT Playwright's actionability wait.
 *
 * WHY. `locator.screenshot()` runs the actionability check, which waits for the
 * element to be STABLE — two consecutive animation frames at the same bounding
 * box. A canvas that re-renders continuously never settles that check on a
 * venue this slow, and the R16/R17 night gates duly died on it:
 *
 *   FAILED: locator.screenshot: Timeout 23971.959 ms exceeded
 *           waiting for element to be stable
 *
 * That is Playwright's default actionability budget, not a gate result — the
 * legacy harness meeting the fixture. `verify-sat-night` reported ZERO gates,
 * which is the worst possible failure mode: a frozen gate that ran nothing
 * looks, in a summary table, exactly like a frozen gate that passed nothing.
 *
 * `page.screenshot({ clip })` has no actionability check. The bounding box is
 * read ONCE and cached — the canvas is `.fixed.inset-0`, so it is the viewport
 * and does not move — and every capture after that is a straight pixel read of
 * the same rectangle. The gates' assertions are untouched: they receive the
 * same PNG bytes of the same region they asked for.
 *
 * THE PRECONDITION OF THAT CACHE, stated so the next consumer checks it: the
 * page must not resize the viewport or change devicePixelRatio for the life of
 * the capper. If it does, the cached rectangle keeps naming the OLD region and
 * every later crop silently compares the wrong pixels — a defect with no error
 * and no visible symptom, which is strictly worse than the timeout this file
 * replaces. Verified for the three consumers at the time of writing
 * (verify-sat-night, verify-dusk, verify-flicker): none of them calls
 * `setViewportSize`, sets `deviceScaleFactor`, or drives a DPR override. A gate
 * that needs to resize should build a NEW capper after the resize rather than
 * reuse this one.
 */

function makeCanvasShot(page, selector = '.fixed.inset-0 canvas') {
  let clip = null;
  const box = async () => {
    if (clip) return clip;
    const b = await page.locator(selector).first().boundingBox();
    if (!b) throw new Error(`canvas ${selector} has no bounding box — is Fly mode mounted?`);
    // Integer pixels: a fractional clip is rejected on some Playwright builds,
    // and a half-pixel offset would move every crop the gates take.
    clip = {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
    };
    return clip;
  };
  return {
    /** Buffer of the canvas region, or write it to `p` when given. */
    shot: async (p) => page.screenshot({ clip: await box(), ...(p ? { path: p } : {}) }),
    shot64: async () => (await page.screenshot({ clip: await box() })).toString('base64'),
    box,
  };
}

module.exports = { makeCanvasShot };

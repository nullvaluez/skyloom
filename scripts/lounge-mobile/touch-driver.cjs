// LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md) — real multi-touch for the mobile
// lounge harness. Playwright's page.touchscreen only taps with one finger, so
// gestures go through CDP Input.dispatchTouchEvent: Chromium turns them into
// the same PointerEvents (pointerType 'touch') a phone's browser delivers,
// two fingers included. Shared by both streams' check modules; owned by the
// runner (scripts/verify-lounge-mobile.cjs).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function touchDriver(cdp) {
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 6, radiusY: 6, force: 1 })),
  });
  const lerp = (a, b, t) => a + (b - a) * t;
  return {
    /** One finger down and up at (x, y). */
    async tap(x, y, holdMs = 60) {
      await send('touchStart', [{ x, y }]);
      await sleep(holdMs);
      await send('touchEnd', []);
    },
    /** Two taps on one spot, gapMs apart. */
    async doubleTap(x, y, gapMs = 140) {
      await this.tap(x, y, 50);
      await sleep(gapMs);
      await this.tap(x, y, 50);
    },
    /** Press and hold (long-press). */
    async hold(x, y, ms = 650) {
      await send('touchStart', [{ x, y }]);
      await sleep(ms);
      await send('touchEnd', []);
    },
    /** One-finger drag from (x0, y0) to (x1, y1) in `steps` moves over ~ms. */
    async drag(x0, y0, x1, y1, { steps = 12, ms = 240, release = true } = {}) {
      await send('touchStart', [{ x: x0, y: y0 }]);
      for (let i = 1; i <= steps; i++) {
        await sleep(ms / steps);
        await send('touchMove', [{ x: lerp(x0, x1, i / steps), y: lerp(y0, y1, i / steps) }]);
      }
      if (release) await send('touchEnd', []);
    },
    /** Hold a finger at (x, y), moved to (x1, y1), for ms, then lift (a walk stick push). */
    async push(x, y, x1, y1, ms) {
      await send('touchStart', [{ x, y }]);
      for (let i = 1; i <= 6; i++) {
        await sleep(30);
        await send('touchMove', [{ x: lerp(x, x1, i / 6), y: lerp(y, y1, i / 6) }]);
      }
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        await sleep(100);
        await send('touchMove', [{ x: x1, y: y1 }]);
      }
      await send('touchEnd', []);
    },
    /** Two-finger pinch about (cx, cy): finger gap fromPx -> toPx (out > in zooms in). */
    async pinch(cx, cy, fromPx, toPx, { steps = 14, ms = 420, angle = 0 } = {}) {
      const at = (gap) => {
        const dx = (Math.cos(angle) * gap) / 2, dy = (Math.sin(angle) * gap) / 2;
        return [{ x: cx - dx, y: cy - dy, id: 0 }, { x: cx + dx, y: cy + dy, id: 1 }];
      };
      await send('touchStart', at(fromPx));
      for (let i = 1; i <= steps; i++) {
        await sleep(ms / steps);
        await send('touchMove', at(lerp(fromPx, toPx, i / steps)));
      }
      await send('touchEnd', []);
    },
    /** Raw access for anything the helpers do not cover. */
    send,
  };
}

module.exports = { touchDriver, sleep };

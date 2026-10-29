// LOUNGE MOBILE (FLY_LOUNGE_MOBILE.md) — real multi-touch for the mobile
// lounge harness. Playwright's page.touchscreen only taps with one finger, so
// gestures go through CDP Input.dispatchTouchEvent: Chromium turns them into
// the same PointerEvents (pointerType 'touch') a phone's browser delivers,
// two fingers included. Shared by both streams' check modules; owned by the
// runner (scripts/verify-lounge-mobile.cjs).
//
// Every event carries CDP's `timestamp`: the time the finger did it on the
// gesture's own timeline. The look surface judges a gesture by its events'
// own clock (lib/fly/lounge/touch-gestures.mjs), and under SwiftShader the
// page can hand events over seconds late, so an unstamped 60 ms tap arrived as
// a multi-second press. The short gestures (tap, double-tap) go out together;
// the long ones keep real pacing (a long-press needs the page's own timer to
// run, a stick push needs wall-clock walking time).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function touchDriver(cdp) {
  const send = (type, points, at = Date.now() / 1000) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 6, radiusY: 6, force: 1 })),
    timestamp: at,
  });
  const now = () => Date.now() / 1000;
  const lerp = (a, b, t) => a + (b - a) * t;
  return {
    /** One finger down and up at (x, y). */
    async tap(x, y, holdMs = 60) {
      const t0 = now();
      await Promise.all([send('touchStart', [{ x, y }], t0), send('touchEnd', [], t0 + holdMs / 1000)]);
    },
    /** Two taps on one spot, gapMs apart (one timeline, sent together). */
    async doubleTap(x, y, gapMs = 140) {
      const t0 = now(), s = (ms) => t0 + ms / 1000;
      await Promise.all([
        send('touchStart', [{ x, y }], s(0)), send('touchEnd', [], s(50)),
        send('touchStart', [{ x, y }], s(50 + gapMs)), send('touchEnd', [], s(100 + gapMs)),
      ]);
    },
    /** Press and hold (long-press): real time passes, so the page's timer runs. */
    async hold(x, y, ms = 650) {
      const t0 = now();
      await send('touchStart', [{ x, y }], t0);
      await sleep(ms);
      await send('touchEnd', [], t0 + ms / 1000);
    },
    /** One-finger drag from (x0, y0) to (x1, y1) in `steps` moves over ~ms. */
    async drag(x0, y0, x1, y1, { steps = 12, ms = 240, release = true } = {}) {
      const t0 = now(), s = (i) => t0 + (i * ms) / steps / 1000;
      await send('touchStart', [{ x: x0, y: y0 }], s(0));
      for (let i = 1; i <= steps; i++) {
        await sleep(ms / steps);
        await send('touchMove', [{ x: lerp(x0, x1, i / steps), y: lerp(y0, y1, i / steps) }], s(i));
      }
      if (release) await send('touchEnd', [], s(steps));
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
      const t0 = now(), s = (i) => t0 + (i * ms) / steps / 1000;
      await send('touchStart', at(fromPx), s(0));
      for (let i = 1; i <= steps; i++) {
        await sleep(ms / steps);
        await send('touchMove', at(lerp(fromPx, toPx, i / steps)), s(i));
      }
      await send('touchEnd', [], s(steps));
    },
    /** Raw access for anything the helpers do not cover. */
    send,
  };
}

module.exports = { touchDriver, sleep };

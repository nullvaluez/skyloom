/**
 * R25 (E CERT) — the TITLE SCREEN helpers for browser harnesses.
 *
 * R25 puts a DOM title screen (`[data-testid="title-screen"]`, A FRONT DOOR)
 * in front of the hangar. A harness that `goto`s the app and then looks for
 * `hangar-pick-*` would, once A merges, find the title instead. These helpers
 * are written TOLERANT OF BOTH TREES so a harness can adopt them today:
 *
 *   - title present  (A merged, FRONT_DOOR on, no `__flyTitleBypass` pin):
 *       click the mode card, wait for the hangar;
 *   - title absent   (r25-w0, flag off, or the bypass pin):
 *       set `flightMode` on the store directly (W0 added the field and the
 *       `setFlightMode` action), and wait for the hangar that today's boot
 *       already opens.
 *
 * Nothing here pins or un-pins anything; the harness decides that.
 *
 * USAGE
 *   const { enterHangar, waitTitleReady } = require('./_title');
 *   await page.goto(URL);
 *   await enterHangar(page, 'ops');        // Takeoff & Landing
 *   await enterHangar(page, 'free');       // Free Flight
 *   const t = await waitTitleReady(page);  // { title, ready, screen, ms }
 */

const TITLE = '[data-testid="title-screen"]';
const CARD = { free: 'title-free-flight', ops: 'title-takeoff-landing' };

/**
 * Wait until the session has decided which screen it opens on, and — when that
 * is the title — until the title is mounted (it is interactive immediately,
 * plan ruling 1). With `{ world: true }` also wait for the title's
 * `data-ready` to read true (the title world revealed).
 *
 * Returns { title: boolean, ready: boolean|null, screen, ms }. Never throws on
 * a missing title — only on a runtime that never mounts at all.
 */
async function waitTitleReady(page, { timeoutMs = 120000, world = false } = {}) {
  const t0 = Date.now();
  // The store is exposed by FlyScene on mount (dev / graphicsReview), after
  // FlyMode's pre-mount beat has already resolved `screen`.
  await page.waitForFunction(() => !!window.__flyStore && !!window.__fly, undefined, {
    timeout: timeoutMs,
    polling: 250,
  });
  const screen = await page.evaluate(() => window.__flyStore.getState().screen ?? null);
  const hasTitleDom = (await page.locator(TITLE).count()) > 0;
  if (screen !== 'title' && !hasTitleDom) return { title: false, ready: null, screen, ms: Date.now() - t0 };
  await page.locator(TITLE).first().waitFor({ state: 'visible', timeout: timeoutMs });
  let ready = null;
  if (world) {
    await page.waitForFunction(
      (sel) => {
        const v = document.querySelector(sel)?.getAttribute('data-ready');
        return v === 'true' || v === '1';
      },
      TITLE,
      { timeout: timeoutMs, polling: 250 }
    );
    ready = true;
  } else {
    const v = await page.locator(TITLE).first().getAttribute('data-ready');
    ready = v == null ? null : v === 'true' || v === '1';
  }
  return { title: true, ready, screen: 'title', ms: Date.now() - t0 };
}

/**
 * From a fresh page (after `goto`), reach the hangar in `mode` ('ops' =
 * Takeoff & Landing, 'free' = Free Flight). Returns { via: 'title'|'store', ms }.
 */
async function enterHangar(page, mode = 'ops', { timeoutMs = 120000, tap = false } = {}) {
  if (!CARD[mode]) throw new Error(`_title.enterHangar: unknown mode ${mode}`);
  const t0 = Date.now();
  const t = await waitTitleReady(page, { timeoutMs });
  let via;
  if (t.title) {
    const card = page.getByTestId(CARD[mode]);
    if (tap) await card.tap({ timeout: timeoutMs });
    else await card.click({ timeout: timeoutMs });
    via = 'title';
  } else {
    await page.evaluate((m) => {
      const s = window.__flyStore.getState();
      if (typeof s.setFlightMode === 'function') s.setFlightMode(m);
      else window.__flyStore.setState({ flightMode: m });
    }, mode);
    via = 'store';
  }
  await page.getByTestId('hangar').waitFor({ state: 'visible', timeout: timeoutMs });
  return { via, ms: Date.now() - t0 };
}

/** True when the title screen is in the DOM right now. */
async function titleVisible(page) {
  const l = page.locator(TITLE);
  return (await l.count()) > 0 && (await l.first().isVisible());
}

module.exports = { enterHangar, waitTitleReady, titleVisible, TITLE_SELECTOR: TITLE, TITLE_CARDS: CARD };

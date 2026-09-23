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
 * Takeoff & Landing, 'free' = Free Flight). Returns
 * { via: 'title'|'store', ms, forced }.
 *
 * The card press is the trusted, actionability-checked click/tap first, for
 * at most ACTIONABLE_MS; then ONE page.evaluate DOM click on the card. R25 E2,
 * MEASURED on the fixture at load ~8-9: the "stable" wait needs two animation
 * frames with one box and a SwiftShader rAF pair can take seconds (A's ledger
 * measured a click sitting 180 s), and behind the free hangar's StagePump even
 * a FORCE click timed out at 180 s — the locator round trips never got a turn
 * on a saturated main thread. On a real GPU the trusted press succeeds at once
 * and nothing changes; the hangar wait below asserts the EFFECT either way.
 * `forced` says the DOM click ran.
 */
const ACTIONABLE_MS = 30000;
async function enterHangar(page, mode = 'ops', { timeoutMs = 120000, tap = false } = {}) {
  if (!CARD[mode]) throw new Error(`_title.enterHangar: unknown mode ${mode}`);
  const t0 = Date.now();
  const t = await waitTitleReady(page, { timeoutMs });
  let via;
  let forced = false;
  if (t.title) {
    const card = page.getByTestId(CARD[mode]);
    await card.waitFor({ state: 'visible', timeout: timeoutMs });
    try {
      if (tap) await card.tap({ timeout: Math.min(timeoutMs, ACTIONABLE_MS) });
      else await card.click({ timeout: Math.min(timeoutMs, ACTIONABLE_MS) });
    } catch {
      // Only if the timed-out press did not land after all (the hangar is up):
      // ONE plain page.evaluate DOM click (A's verify-r25-title domClick idiom)
      // — a starved main thread can stall even a force click's round trips.
      if (!(await page.getByTestId('hangar').isVisible().catch(() => false))) {
        forced = true;
        const ok = await page.evaluate((tid) => {
          const el = document.querySelector(`[data-testid="${tid}"]`);
          if (!el || el.disabled) return false;
          el.click();
          return true;
        }, CARD[mode]);
        if (!ok) throw new Error(`_title.enterHangar: ${CARD[mode]} vanished or is disabled`);
      }
    }
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
  return { via, ms: Date.now() - t0, forced };
}

/** True when the title screen is in the DOM right now. */
async function titleVisible(page) {
  const l = page.locator(TITLE);
  return (await l.count()) > 0 && (await l.first().isVisible());
}

/**
 * The PRODUCT-BOOT PROBE (an init script: `page.addInitScript(installBootProbe)`
 * BEFORE the goto). Records, in ms since navigation start, the first moment
 * the title node exists (and the boot pct at that moment), the title's
 * data-ready, `__flyBoot.pct === 100`, and the first hangar node — on a plain
 * 50 ms timer, independent of the render loop, so a 1-3 fps venue cannot
 * reorder them. Read back with `page.evaluate(() => window.__r25Probe)`.
 * It keeps ticking until the title is ready AND the boot revealed (or 30 min),
 * so it also serves a tree with no title (the hangar path).
 */
function installBootProbe() {
  const p = (window.__r25Probe = { titleAt: null, titlePct: null, readyAt: null, revealAt: null, hangarAt: null });
  const tick = () => {
    const now = performance.now();
    const title = document.querySelector('[data-testid="title-screen"]');
    const pct = window.__flyBoot?.pct ?? null;
    if (title && p.titleAt == null) {
      p.titleAt = now;
      p.titlePct = pct;
    }
    if (title && p.readyAt == null && ['true', '1'].includes(title.getAttribute('data-ready'))) p.readyAt = now;
    if (pct === 100 && p.revealAt == null) p.revealAt = now;
    if (p.hangarAt == null && document.querySelector('[data-testid="hangar"]')) p.hangarAt = now;
    if (now < 30 * 60 * 1000 && (p.revealAt == null || (p.titleAt != null && p.readyAt == null))) setTimeout(tick, 50);
  };
  setTimeout(tick, 0);
}

module.exports = { enterHangar, waitTitleReady, titleVisible, installBootProbe, TITLE_SELECTOR: TITLE, TITLE_CARDS: CARD };

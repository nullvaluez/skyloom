/**
 * Trailer boot helper — the capture fleet's equivalent of `scripts/_boot.js`.
 *
 * This is a SEPARATE file on purpose. `scripts/_boot.js` is a sanctioned-edit
 * harness contract shared by ~30 verification gates; the trailer must not
 * touch it. But the trailer also wants a DIFFERENT pin set than the gates do,
 * because the gates freeze pixels and the trailer wants beauty:
 *
 *   | pin                       | harness fleet | trailer      | why                                    |
 *   |---------------------------|---------------|--------------|----------------------------------------|
 *   | fly-map-style-2           | 'toy'         | 'satellite'  | satellite-only brief                   |
 *   | __flyAerialOverride       | 0 (pinned)    | NOT PINNED   | R19 depth aerial perspective is a hero |
 *   | __flySatShadowOverride    | 0 (pinned)    | NOT PINNED   | R19 satellite content shadows likewise |
 *   | __flyGovPin               | 'hold'        | 'hold'       | no mid-shot DPR/composer rebuilds      |
 *   | __flyBoostInfinite        | true          | true         | the boost shot must not drain          |
 *   | __flyWeatherOverride      | 'baseline'    | 'baseline'   | clean clear-sky default (per shot ovr) |
 *   | fly-quality-tier          | per-harness   | 'high'       | night windows + bloom are tier-gated   |
 *
 * The two R19 fleet pins are the ONLY substantive divergence, and they are
 * deliberate: `verify-aerial` is the one gate that un-pins them, and the
 * pictures it certifies are exactly the pictures the trailer wants.
 *
 * TIER IS DOUBLE-PINNED (R16 §10 lesson): the persisted pick alone is not
 * enough, because PerformanceMonitor's incline step re-raises/lowers a
 * store-only pin within seconds. We seed the persisted key pre-mount AND call
 * setQualityTier post-boot, the `scripts/verify-skyline.js` + `r20-c2-probe.js`
 * idiom.
 *
 * Readiness is the real published contract, copied from `_boot.js`:
 *   __flyBoot.pct === 100  →  canvas present  →  boot-screen gone  →  settle.
 */

const { chromium } = require('playwright');

const BOOT_URL = process.env.FLY_URL || 'http://localhost:3100';

/** Persisted key from `lib/fly/fly-settings.js` (QUALITY_TIER_KEY). */
const QUALITY_TIER_KEY = 'fly-quality-tier';

/**
 * Launch the capture browser.
 *
 * NOTE: no `channel: 'chrome'`. The harness fleet asks for Google Chrome,
 * which does not exist in the capture container; default resolution finds the
 * bundled Playwright chromium. WebGL2 works there, on SwiftShader (software).
 */
async function launch({ headless = true } = {}) {
  return chromium.launch({
    headless,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
}

/**
 * A fresh recording context. One per shot — closing it is what flushes the
 * .webm to disk (Playwright writes the video on context close, not page close).
 *
 * viewport === recordVideo.size keeps the recording 1:1 with the rendered
 * frame; any mismatch makes Playwright letterbox/scale the capture.
 */
async function newCaptureContext(browser, { width, height, videoDir, record = true }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(record ? { recordVideo: { dir: videoDir, size: { width, height } } } : {}),
  });
  // Tier pin #1 — the PERSISTED pick, seeded pre-mount so the very first
  // resolveInitialSettings() call in fly-settings.js already reads 'high'.
  await context.addInitScript((key) => {
    try {
      localStorage.setItem(key, 'high');
    } catch {
      /* storage blocked — the post-boot store pin below still applies */
    }
  }, QUALITY_TIER_KEY);
  return context;
}

/**
 * Seed + boot one page into the satellite world.
 *
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {string} [opts.url]           dev-server origin (FLY_URL)
 * @param {number} [opts.timeoutMs]     boot budget
 * @param {number} [opts.settleMs]      post-reveal settle
 * @param {string|null} [opts.weather]  __flyWeatherOverride ('baseline' default;
 *                                      pass null for the LIVE sky — shot 9)
 * @returns {Promise<{ms:number}>}      goto → pct 100 wall time
 */
async function bootTrailer(
  page,
  { url = BOOT_URL, timeoutMs = 240000, settleMs = 3000, weather = 'baseline' } = {}
) {
  await page.addInitScript((w) => {
    // Set OUTSIDE the try: localStorage can throw, and these determinism pins
    // must land even then (the `_boot.js` reasoning, kept).
    if (w !== null) window.__flyWeatherOverride = w;
    window.__flyBoostInfinite = true;
    window.__flyGovPin = 'hold';
    // DELIBERATELY ABSENT: __flyAerialOverride / __flySatShadowOverride.
    // The fleet pins them to 0 to freeze satellite pixel gates. The trailer
    // wants both features ON — they are the R19 beauty pass.
    try {
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-map-style-2', 'satellite');
      window.__flyTrailerSeeded = true;
    } catch {
      /* storage blocked — the app boots on defaults (which are satellite) */
    }
  }, weather);

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  // Safety net for a page that navigated before bootTrailer was called: init
  // scripts only apply from the NEXT navigation, so seed + reload once.
  const seeded = await page.evaluate(() => window.__flyTrailerSeeded === true);
  if (!seeded) {
    await page.evaluate((w) => {
      if (w !== null) window.__flyWeatherOverride = w;
      window.__flyBoostInfinite = true;
      window.__flyGovPin = 'hold';
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-map-style-2', 'satellite');
    }, weather);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  // The published contract: pct hits 100 exactly at world reveal.
  // waitForFunction's options are the THIRD argument (R11 lesson in _boot.js).
  await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, {
    timeout: timeoutMs,
    polling: 250,
  });
  const ms = Date.now() - t0;

  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="boot-screen"]'), {
    timeout: 30000,
  });
  await page.waitForTimeout(settleMs);

  // Tier pin #2 — the store call. Pin #1 (persisted) survives a governor step;
  // this one makes the CURRENT session high immediately, without waiting for
  // an incline. Both are needed (R16 §10).
  await page.evaluate(() => window.__flyStore?.getState?.().setQualityTier?.('high'));
  await page.waitForTimeout(800);

  return { ms };
}

/** Read the live boot progress — used to report honestly when boot stalls. */
async function bootProgress(page) {
  return page.evaluate(() => ({
    pct: window.__flyBoot?.pct ?? null,
    label: window.__flyBoot?.label ?? null,
    hasCanvas: !!document.querySelector('.fixed.inset-0 canvas'),
    bootScreen: !!document.querySelector('[data-testid="boot-screen"]'),
  }));
}

module.exports = { launch, newCaptureContext, bootTrailer, bootProgress, BOOT_URL, QUALITY_TIER_KEY };

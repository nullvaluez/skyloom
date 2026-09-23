/**
 * R25 (E CERT) — the FIXTURE PRELOAD, for harnesses that never call bootFly.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3206 FLY_URL=http://localhost:3036 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js \
 *     -r ./scripts/_fixture-preload.js scripts/verify-operations-browser.cjs
 *
 * WHY: the ops harnesses (`verify-operations-{browser,keyboard,touch}.cjs`)
 * are UNPINNED real-browser checks — they `goto` the product, walk the title
 * (`_title.js enterHangar`, the sanctioned R25 edit) and wait for full
 * satellite readiness. They open their own page (`browser.newPage` /
 * `browser.newContext`), so in this container, where the tile hosts answer
 * 403, they could only ever read BLOCKED at the readiness wait. `bootFly`
 * attaches the offline world fixture for the rest of the fleet; this preload
 * does the SAME two things for a harness that opens its own context, and
 * nothing else:
 *   1. `attachFixture(context)` — the Playwright routes (OpenFreeMap,
 *      Esri imagery, WorldCover, /api/aircraft, /api/weather);
 *   2. the `window.__flyTileFixture` init script (the DEM + imagery source
 *      swap lib/fly/tile-sources.js reads) and, as `bootFly` does for a
 *      satellite boot, the finalize-budget scaler (`__flyFinalizeBudgetK`,
 *      default 40, FLY_FINALIZE_BUDGET_K overrides; 0/1 = off) — the
 *      measured precondition of a satellite fixture reveal (_boot.js).
 * It pins NOTHING else: no style, no weather, no title bypass — the harness
 * still measures the product exactly as a player boots it.
 *
 * A no-op unless FLY_TILE_FIXTURE is set, so the same command line runs the
 * harness unchanged on the user's machine. Load it AFTER _pw-shim.js (it
 * wraps the shim's already-wrapped `chromium.launch`). Zero harness edits.
 */
'use strict';

const { fixtureEnabled, attachFixture, fixturePin } = require('./_fixture');

async function prepareContext(context) {
  if (context.__flyPreloaded) return;
  context.__flyPreloaded = true;
  const fx = await attachFixture(context);
  await context.addInitScript((pin) => {
    window.__flyTileFixture = pin;
  }, fixturePin(fx.url, Number(process.env.FLY_FIXTURE_DEM_MAXZOOM || 15)));
  const kEnv = process.env.FLY_FINALIZE_BUDGET_K;
  const k = Number(kEnv != null && kEnv !== '' ? kEnv : 40);
  if (k > 1)
    await context.addInitScript((v) => {
      window.__flyFinalizeBudgetK = v;
    }, k);
}

function wrapBrowser(browser) {
  if (browser.__flyPreloaded) return browser;
  browser.__flyPreloaded = true;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    await prepareContext(context);
    return context;
  };
  // browser.newPage opens a private context Playwright never hands back; open
  // it through the wrapped newContext instead (browser.close() still closes it).
  browser.newPage = async (...args) => {
    const context = await browser.newContext(...args);
    return context.newPage();
  };
  return browser;
}

if (fixtureEnabled()) {
  const pw = require('playwright');
  const launch = pw.chromium.launch;
  pw.chromium.launch = async function (...args) {
    return wrapBrowser(await launch.apply(this, args));
  };
  if (!process.env.PW_SHIM_QUIET)
    process.stderr.write('[fixture-preload] every new browser context gets the offline world fixture\n');
}

module.exports = { prepareContext, wrapBrowser };

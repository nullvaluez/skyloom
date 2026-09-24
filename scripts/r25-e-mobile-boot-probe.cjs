/**
 * R25 (E CERT) — probe for the bootMobile airborne skip (scripts/_mobile-boot.js).
 *
 * RED: `R25_MOBILE_OLD=<path to the r25-w0 _mobile-boot.js>` boots with the
 * W0 helper (no skip). MEASURED (scripts/r25-e-cert.md §5a): it RETURNS —
 * pct reaches 100 behind the mandatory hangar — with screen 'hangar' and the
 * flight frozen in phase 'hangar', i.e. every mobile harness since 2c624a3
 * has run under an opaque z-60 hangar. GREEN: the current helper returns
 * airborne (screen 'flight', phase 'airborne'). Records pct / screen / phase
 * either way. Not a gate; exit 0 when the helper returned, 1 when it threw.
 *
 *   FLY_URL=http://localhost:3035 /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/r25-e-mobile-boot-probe.cjs
 */
const path = require('path');
const { chromium } = require('playwright');
const helper = process.env.R25_MOBILE_OLD ? require(path.resolve(process.env.R25_MOBILE_OLD)) : require('./_mobile-boot');
const { MOBILE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

(async () => {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const ctx = await browser.newContext(MOBILE_CTX);
  const page = await ctx.newPage();
  const t0 = Date.now();
  let err = null, waited = null;
  try {
    waited = await helper.bootMobile(page, { style: 'toy', waitS: Number(process.env.R25_MOBILE_WAIT_S || 90) });
  } catch (e) {
    err = String(e).slice(0, 160);
  }
  const s = await page.evaluate(() => ({
    pct: window.__flyBoot?.pct ?? null,
    screen: window.__flyStore?.getState().screen ?? null,
    hangarOpen: window.__flyStore?.getState().hangarOpen ?? null,
    phase: window.__fly?.operations?.phase ?? null,
    title: !!document.querySelector('[data-testid="title-screen"]'),
  })).catch((e) => ({ evalError: String(e).slice(0, 120) }));
  console.log(JSON.stringify({ helper: process.env.R25_MOBILE_OLD ? 'r25-w0' : 'current', ms: Date.now() - t0, waited, err, ...s }));
  await browser.close();
  process.exit(err ? 1 : 0);
})();

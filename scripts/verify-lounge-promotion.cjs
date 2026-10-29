// Observation lounge promotion gate (desktop Chrome + a phone viewport).
//
// The lounge ships to ordinary desktop players (lib/fly/airport-feature-policy.js
// LIVING_AIRPORTS.enabled, owner 2026-10-13: "lounge now"). With NO review
// parameters on the URL:
//   desktop  the title shows the "Watch an airport" card; it opens the airport
//            browser; a featured airport enters a validated lounge; the
//            Atlas header carries the pill; no page errors.
//   phone    no card on the title and no Atlas pill (phones and tablets stay
//            excluded).
//
//   FLY_URL=http://localhost:3311/ node scripts/verify-lounge-promotion.cjs [--out <dir>]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const URL_ = process.env.FLY_URL || 'http://localhost:3311/';
const out = path.resolve(arg('out', '.graphics-review/observation-lounge/promotion'));
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail != null && !pass ? ' — ' + JSON.stringify(detail) : ''}`);
};
const seed = () => {
  localStorage.setItem('fly-map-style-2', 'satellite');
  localStorage.setItem('fly-controls-seen', '1');
  localStorage.setItem('fly-sound-on', '0');
};

(async () => {
  if (new URL(URL_).search) throw new Error('verify-lounge-promotion must boot a URL with no query parameters');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    // --- desktop ---------------------------------------------------------
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(seed);
    await page.goto(URL_, { timeout: 240000 });
    await page.getByTestId('title-screen').waitFor({ state: 'visible', timeout: 240000 });
    const card = page.getByTestId('watch-airport');
    await card.first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    const onTitle = await card.count();
    const cardClass = onTitle ? await card.first().getAttribute('class') : null;
    check('title shows the "Watch an airport" card with no review parameters', onTitle === 1 && /fly-title-card/.test(cardClass || ''), { onTitle, cardClass });
    await page.screenshot({ path: path.join(out, 'desktop-title.png') });
    await card.first().click();
    await page.getByTestId('airport-browser').waitFor({ state: 'visible', timeout: 30000 });
    check('the card opens the airport browser', await page.getByTestId('airport-browser').isVisible());
    await page.getByTestId('airport-featured-KCMH').click();
    const entered = await page
      .waitForFunction(() => window.__fly?.airportWatch?.active && window.__fly.airportWatch.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 })
      .then(() => true, () => false);
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
    const surface = await page.getByTestId('lounge-surface').isVisible().catch(() => false);
    check('a featured airport enters a validated lounge (KCMH)', entered && surface, { entered, surface });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, 'desktop-lounge-kcmh.png') });
    await page.getByTestId('lounge-leave').click();
    await page.waitForFunction(() => !window.__fly?.airportWatch?.active, undefined, { timeout: 30000 });
    check('Leave lounge returns', true);
    // The Atlas header pill (the same AirportEntry, compact form).
    await page.evaluate(() => window.__flyStore.setState({ atlasOpen: true }));
    await page.getByTestId('atlas').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const atlasPill = await page.locator('[data-testid="atlas"] [data-testid="watch-airport"]').count();
    check('the Atlas header carries the "Watch an airport" pill', atlasPill === 1, { atlasPill });
    await page.screenshot({ path: path.join(out, 'desktop-atlas.png') });
    await page.evaluate(() => window.__flyStore.setState({ atlasOpen: false }));
    check('no page errors on desktop', errors.length === 0, errors.slice(0, 3));
    await page.close();

    // --- phone -----------------------------------------------------------
    const phone = await browser.newContext({ ...devices['iPhone 13'] });
    const p2 = await phone.newPage();
    const errors2 = [];
    p2.on('pageerror', (e) => errors2.push(e.message));
    await p2.addInitScript(seed);
    await p2.goto(URL_, { timeout: 240000 });
    await p2.getByTestId('title-screen').waitFor({ state: 'visible', timeout: 240000 });
    await p2.waitForTimeout(1500);
    // LOUNGE MOBILE (2026-10-29, sanctioned move): phones have the lounge
    // behind LOUNGE_MOBILE (these two checks read "no card" / "no pill" before).
    const phoneCards = await p2.getByTestId('watch-airport').count();
    check('phones get the lounge card (LOUNGE_MOBILE)', phoneCards === 1, { phoneCards });
    await p2.screenshot({ path: path.join(out, 'phone-title.png') });
    await p2.evaluate(() => window.__flyStore.setState({ atlasOpen: true }));
    const atlasUp = await p2.getByTestId('atlas').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    const phonePill = await p2.locator('[data-testid="atlas"] [data-testid="watch-airport"]').count();
    check('phones get the Atlas pill too', atlasUp && phonePill === 1, { atlasUp, phonePill });
    check('no page errors on the phone', errors2.length === 0, errors2.slice(0, 3));
    await phone.close();
  } catch (e) {
    failed++;
    console.log('FAIL harness — ' + e.message);
  } finally {
    await browser.close();
  }
  console.log(`\nLOUNGE PROMOTION: ${failed ? 'FAIL' : 'PASS'} (${failed} failed)`);
  process.exit(failed ? 1 : 0);
})();

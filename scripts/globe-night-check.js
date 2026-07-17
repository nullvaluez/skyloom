/** One-off: night style only, long tile settle, street-grid legibility check. */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('header', { timeout: 120000 });
  await page.evaluate(() => {
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.setItem('fly-map-style-2', 'night');
  });
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  console.log('night up; long settle…');
  await page.waitForTimeout(35000);
  await page.mouse.move(800, 450);
  await page.screenshot({ path: path.join(__dirname, 'globe-night-settled.png') });
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 210, { steps: 10 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'globe-night-settled-down.png') });
  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
    tracers: window.__flyStats?.tracers,
  }));
  console.log('stats:', JSON.stringify(s), 'errors:', errs.length);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

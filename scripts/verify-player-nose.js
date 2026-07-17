/** Side-profile screenshot of the player plane via RMB free-look. */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  await page.waitForTimeout(10000);
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);

  // Hold RMB and drag to orbit ~90° for a side profile
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1400, 430, { steps: 20 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'player-side.png') });
  await page.mouse.up({ button: 'right' });

  // And a top-down-ish angle for sweep direction
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1100, 900, { steps: 20 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'player-top.png') });
  await page.mouse.up({ button: 'right' });

  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

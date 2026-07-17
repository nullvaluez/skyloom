/** Toy World style check: tiles, grade, fog bubble, player orientation. */
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
  let voyagerTiles = 0;
  page.on('response', (r) => {
    if (r.url().includes('rastertiles/voyager')) voyagerTiles++;
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.evaluate(() => {
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.removeItem('fly-map-style-2');
  });
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  await page.waitForTimeout(14000);
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'toy-01-spawn.png') });

  // bank for a scenic angle + player profile
  await page.keyboard.down('a');
  await page.waitForTimeout(1600);
  await page.keyboard.up('a');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'toy-02-bank.png') });

  console.log('voyager tiles:', voyagerTiles);
  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  console.log(voyagerTiles > 20 && errs.length === 0 ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

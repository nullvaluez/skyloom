/** Quick visual check: spawn view after cloud-material fix. */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await bootFly(page); // R9-3: fly-only boot
  await page.waitForTimeout(3000); // clouds drift into frame
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'p3-06-clouds-fixed.png') });
  // brief cruise to see puffs pass by
  await page.keyboard.down('d');
  await page.waitForTimeout(1200);
  await page.keyboard.up('d');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(__dirname, 'p3-07-clouds-turn.png') });
  console.log('pageerrors:', errs.slice(0, 5).join(' | ') || 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

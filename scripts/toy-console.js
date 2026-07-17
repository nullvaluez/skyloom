/** Dev probe: enter fly mode and dump EVERY console message + a screenshot. */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const seen = new Map();
  page.on('console', (m) => {
    const key = m.text().slice(0, 160);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('header', { timeout: 120000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  await page.waitForTimeout(20000);
  await page.screenshot({ path: path.join(__dirname, 'toy-console.png') });
  console.log('--- console messages (deduped) ---');
  for (const [text, count] of seen) console.log(`[×${count}]`, text);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

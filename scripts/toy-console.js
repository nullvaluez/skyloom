/** Dev probe: enter fly mode and dump EVERY console message + a screenshot. */
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
  const seen = new Map();
  page.on('console', (m) => {
    const key = m.text().slice(0, 160);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
  await bootFly(page); // R9-3: fly-only boot
  await page.waitForTimeout(10000); // let post-boot console traffic accumulate
  await page.screenshot({ path: path.join(__dirname, 'toy-console.png') });
  console.log('--- console messages (deduped) ---');
  for (const [text, count] of seen) console.log(`[×${count}]`, text);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

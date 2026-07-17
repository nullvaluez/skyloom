/** Close-up traffic model check: warp + intercept → formation screenshots. */
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

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  await page.waitForTimeout(12000);
  await page.mouse.move(800, 450);

  for (const arch of [0, 5, 4, 3]) {
    let hex = null;
    for (let tries = 0; tries < 15 && !hex; tries++) {
      hex = await page.evaluate((a) => {
      const fly = window.__fly;
      const items = [...fly.traffic.items]
        .filter(
          (it) =>
            it.archetype === a && it.stale === 0 && it.fix1 && Math.hypot(it.fix1.vE, it.fix1.vN) > 40
        )
        .sort((x, y) => x.distM - y.distM);
      if (!items[0]) return null;
      return fly.warpTo(items[0].hex) ? items[0].hex : null;
      }, arch);
      if (!hex) await page.waitForTimeout(2000);
    }
    if (!hex) {
      console.log(`arch${arch}: no live candidate`);
      continue;
    }
    await page.waitForTimeout(1200);
    // engage intercept → formation on the (auto-)locked target
    await page.evaluate((h) => window.__fly.interceptHex(h), hex);
    await page.waitForTimeout(14000);
    const state = await page.evaluate((h) => {
      const t = window.__fly.traffic.tracks.get(h);
      return { dist: t ? Math.round(t.distM) : null, ap: window.__fly.autopilot.mode };
    }, hex);
    console.log(`arch${arch} ${hex}:`, JSON.stringify(state));
    await page.screenshot({ path: path.join(__dirname, `formation-arch${arch}.png`) });
  }

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

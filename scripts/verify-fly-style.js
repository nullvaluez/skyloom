/** Verify: waypoint chips, player orientation, night map style, hover UX. */
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
  let cartoTiles = 0;
  page.on('response', (r) => {
    if (r.url().includes('basemaps.cartocdn.com')) cartoTiles++;
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.evaluate(() => {
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.removeItem('fly-map-style');
  });
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  await page.waitForTimeout(12000);
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1500);

  // 1. New waypoint chips + player orientation (satellite)
  await page.screenshot({ path: path.join(__dirname, 'style-01-chips-day.png') });

  // 2. Night Ops toggle via pause menu (also exercises persistence path)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'style-02-pause-menu.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(9000); // tiles refetch
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);
  const attribution = await page.evaluate(
    () => document.querySelector('.bottom-2.left-2')?.textContent ?? ''
  );
  await page.screenshot({ path: path.join(__dirname, 'style-03-night.png') });
  console.log('carto tiles fetched:', cartoTiles);
  console.log('attribution now:', attribution);

  // 3. Hover + T-inspect (works regardless of pointer precision)
  const locked = await page.evaluate(() => window.__fly.targeting.lockedHex);
  if (locked) {
    await page.keyboard.press('t');
    await page.waitForTimeout(400);
  }
  const modalVisible = await page
    .locator('[data-testid="inspect-card"]')
    .isVisible()
    .catch(() => false);
  console.log('locked:', locked, '→ T-inspect modal:', modalVisible);
  if (modalVisible) {
    await page.screenshot({ path: path.join(__dirname, 'style-04-night-modal.png') });
    await page.keyboard.press('Escape');
  }

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  const pass = cartoTiles > 20 && attribution.includes('CARTO') && errs.length === 0;
  console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

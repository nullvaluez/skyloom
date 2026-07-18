/**
 * Verify: waypoint chips, player orientation, map-style toggle via the
 * pause menu (persistence path), hover UX.
 * Round 7: the Night style is retired — the toggle test now flips to Day
 * (satellite) and gates on Esri imagery + attribution.
 */
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
  let esriTiles = 0;
  page.on('response', (r) => {
    if (r.url().includes('World_Imagery/MapServer/tile')) esriTiles++;
  });

  // R9-3: the app boots straight into fly mode — bootFly waits on the real
  // __flyBoot readiness contract (style switching lives ONLY in the pause
  // menu now, which is exactly the path step 2 exercises).
  await bootFly(page); // Neon (toy) default
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1500);

  // 1. Chips + player orientation at spawn (toy default)
  await page.screenshot({ path: path.join(__dirname, 'style-01-chips-neon.png') });

  // 2. Day toggle via pause menu (exercises the persistence path)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'style-02-pause-menu.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(9000); // tiles refetch
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);
  const attribution = await page.evaluate(
    () => document.querySelector('.bottom-2.left-2')?.textContent ?? ''
  );
  const saved = await page.evaluate(() => localStorage.getItem('fly-map-style-2'));
  await page.screenshot({ path: path.join(__dirname, 'style-03-day.png') });
  console.log('esri tiles fetched:', esriTiles);
  console.log('attribution now:', attribution, '· saved style:', saved);

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
    await page.screenshot({ path: path.join(__dirname, 'style-04-day-modal.png') });
    await page.keyboard.press('Escape');
  }

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  const pass =
    esriTiles > 20 && attribution.includes('Esri') && saved === 'satellite' && errs.length === 0;
  console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

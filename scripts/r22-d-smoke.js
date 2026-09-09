/**
 * R22 D — 60-second smoke: boot, arm each sub-flag, confirm no pageerror and
 * that the N8AO pass reports the reversed-depth configuration it must have.
 * FLY_URL is MANDATORY here (never default to :3000 — the user's live server).
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

if (!process.env.FLY_URL) {
  console.error('FLY_URL is required (e.g. http://localhost:3223)');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200));
  });

  const { ms } = await bootFly(page, { style: 'satellite' });
  console.log('boot ms', ms);
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flyAerialOverride = 1;
    window.__flySatShadow?.set(true);
  });
  await page.waitForTimeout(2500);

  console.log('legacy stats', JSON.stringify(await page.evaluate(() => ({
    depthRig: window.__flyStats?.depthRig ?? null,
    n8ao: window.__flyN8AO?.get?.() ?? null,
    draws: window.__flyStats?.drawCalls,
  }))));

  await page.evaluate(() => {
    window.__flyDepthArm = 1;
    window.__flyDepthSub = { catcher: 1, nearReceive: 1, n8ao: 1, aerialNear: 1 };
    window.__flyN8AO?.set?.(true);
  });
  await page.waitForTimeout(6000);
  console.log('armed stats', JSON.stringify(await page.evaluate(() => ({
    depthRig: window.__flyStats?.depthRig ?? null,
    n8ao: window.__flyN8AO?.get?.() ?? null,
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
    fx: window.__flyStats?.fx ?? null,
  })), null, 2));
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: require('path').join(__dirname, 'r22-d-smoke.png') });

  console.log('pageerrors', errs.length);
  errs.slice(0, 8).forEach((e) => console.log('  ', e));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();

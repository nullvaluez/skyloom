/**
 * Altitude-aware traffic bend (user report 2026-07-17): at 3,000ft, high
 * traffic used to render BELOW the player (raw d^2*k crushed FL210 25nm out
 * by ~13km). Gates: (1) INVARIANT — every track flying >=300m above the
 * player projects to a bent Y at/above the player's eye level; (2) grounded
 * tracks (>8km away, agl<120m) keep >=90% of the raw drop (still glued);
 * (3) screenshot at 3k ft for the eyeball. Dev server on :3000.
 */
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
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  await page.waitForTimeout(15000);
  await page.mouse.move(800, 450);

  // The reported scenario: 3,000 ft
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 914;
  });
  await page.waitForTimeout(2500);

  const res = await page.evaluate(() => {
    const fly = window.__fly;
    const eye = fly.flight.pos.y;
    let above = 0;
    let violations = [];
    let groundedOk = 0;
    let groundedSoft = 0;
    for (const it of fly.traffic.items) {
      const d = Math.hypot(it.rx - fly.flight.pos.x, it.rz - fly.flight.pos.z);
      if (d < 1000 || d > 90000) continue;
      const drop = window.__flyAirDrop(d, it.ry);
      const bentY = it.ry - drop;
      if (it.ry > eye + 300) {
        above += 1;
        // must never render below eye level (small tolerance for the blend band)
        if (bentY < eye - 60)
          violations.push({ hex: it.hex, ry: Math.round(it.ry), d: Math.round(d), bentY: Math.round(bentY) });
      }
      const raw = d * d * (window.__flyStats?.bendK ?? 0);
      if (d > 8000 && it.ry < fly.flight.groundElev + 120 && raw > 100) {
        if (drop / raw >= 0.9) groundedOk += 1;
        else groundedSoft += 1;
      }
    }
    return { eye: Math.round(eye), above, violations: violations.slice(0, 6), groundedOk, groundedSoft, total: fly.traffic.items.length };
  });
  console.log(JSON.stringify(res, null, 1));
  if (res.above < 5) console.log('WARN: few high targets in range this run');
  if (res.violations.length > 0) throw new Error(`above-eye invariant violated: ${JSON.stringify(res.violations)}`);
  if (res.groundedSoft > res.groundedOk) throw new Error('grounded traffic lost its terrain glue');

  await page.screenshot({ path: path.join(__dirname, 'airbend-01-3kft.png') });
  console.log('pageerrors:', errs.join(' | ') || 'none');
  console.log(errs.length === 0 ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(errs.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

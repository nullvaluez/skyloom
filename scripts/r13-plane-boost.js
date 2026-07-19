/** Round 13 Phase 2: afterburner + BOOST contrail bug re-check (toy, real GPU). */
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

  await bootFly(page); // toy
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));

  // High-altitude sustained boost (contrail forms above minAltM 6000).
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.pos.y = 9200;
    f.speed = 300;
    f.heading = 0;
    f.pitch = 0;
    if (window.__flyStats) window.__flyStats.contrailPts = 0;
  });
  await page.keyboard.down('Shift');
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    samples.push(
      await page.evaluate(
        (n) => ({
          t: n,
          pts: window.__flyStats?.contrailPts,
          spd: Math.round(window.__fly.flight.speed),
          draws: window.__flyStats?.drawCalls,
        }),
        i
      )
    );
  }
  await page.mouse.move(800, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(920, 520, { steps: 20 });
  await page.waitForTimeout(600);
  await page.mouse.up({ button: 'right' });
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r13-plane-boost.png') });
  await page.keyboard.up('Shift');

  console.log('BOOST 6s samples (high altitude, toy):');
  for (const s of samples) console.log(`  t+${s.t}s: contrailPts=${s.pts} speed=${s.spd}m/s draws=${s.draws}`);
  const formed = samples.some((s) => (s.pts ?? 0) > 2);
  console.log(`BOOST contrail bug: ${formed ? 'NOT reproduced — contrail formed on real GPU' : 'REPRODUCED — no contrail!'}`);
  console.log(`pageerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

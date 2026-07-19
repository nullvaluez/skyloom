/**
 * Round 13 Phase 1 evidence capture + smoke test.
 * Boots satellite, drives fixed scenes, captures A/B PNGs and prints the live
 * atmosphere stats (fog density, HDRI bucket, edge-fade band, cloud spread).
 * Run: node scripts/r13-atmo-capture.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const gl = (page, n) =>
  page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, `r13-atmo-${n}.png`) });

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`);
  });

  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  const stat = () =>
    page.evaluate(() => ({
      fogDensity: window.__fly?.camera && window.__flyStore.getState().mapStyle,
      hdriBucket: window.__flyStats?.hdriBucket,
      draws: window.__flyStats?.drawCalls,
      startM: window.__flyStats?.edgeFadeStartM,
      endM: window.__flyStats?.groundHorizonM,
      cloudF: window.__flyStats?.cloudSpreadF,
      cloudsBelow: window.__flyStats?.cloudsBelowEye,
      cloudTint: window.__flyStats?.cloudTint,
      alt: window.__fly?.flight?.pos?.y,
    }));

  const readFog = () =>
    page.evaluate(() => {
      let n = window.__fly.engine.object;
      while (n.parent) n = n.parent;
      const fog = n.fog;
      return fog ? { density: fog.density, color: '#' + fog.color.getHexString() } : null;
    });

  // Scenic mountains + clear horizon (Owens Valley / Sierra), NOON.
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 20, 0); // ~noon PDT
    window.__fly.warpToGeo(36.6, -118.1, { altM: 1200, name: null });
  });
  await page.waitForTimeout(18000);
  await page.mouse.move(800, 450);
  console.log('LOW-AGL noon:', JSON.stringify(await stat()), 'fog', JSON.stringify(await readFog()));
  await gl(page, 'sat-lowagl');

  // Pin FL300 (the "wet mirror" defect location) — noon still
  await page.evaluate(() => {
    window.__r13pin = setInterval(() => { window.__fly.flight.pos.y = 9100; }, 300);
  });
  await page.waitForTimeout(9000);
  console.log('FL300 noon:', JSON.stringify(await stat()), 'fog', JSON.stringify(await readFog()));
  await gl(page, 'sat-fl300');

  // Cloud deck at cruise (below the eye)
  await page.waitForTimeout(4000);
  console.log('cruise cloud deck:', JSON.stringify(await stat()));
  await gl(page, 'sat-clouddeck');
  await page.evaluate(() => clearInterval(window.__r13pin));

  // Time-of-day skies at low AGL — dawn / dusk / night (UTC computed for the
  // Sierra longitude lon≈-118 → localH = UTC - 7.87; twilight at localH≈6.8/17.2)
  for (const [name, utc] of [
    ['dawn', Date.UTC(2026, 6, 17, 14, 40)],  // localH ~6.8 morning twilight
    ['dusk', Date.UTC(2026, 6, 18, 1, 4)],    // localH ~17.2 evening twilight
    ['night', Date.UTC(2026, 6, 17, 8, 52)],  // localH ~1.0 night
  ]) {
    await page.evaluate((t) => {
      window.__flySunOverride = t;
      const g = window.__fly.geo;
      window.__fly.warpToGeo(g.y, g.x, { altM: 1400, name: null });
    }, utc);
    await page.waitForTimeout(9000); // day-cycle + HDRI bucket swap + settle
    await page.mouse.move(800, 450);
    console.log(`${name}:`, JSON.stringify(await stat()), 'fog', JSON.stringify(await readFog()));
    await gl(page, `sat-${name}`);
  }

  console.log(`\npageErrors: ${errs.length}`);
  if (errs.length) console.log(errs.slice(0, 6).join('\n'));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => {
  console.error('CAPTURE FAILED:', e.message);
  process.exit(1);
});

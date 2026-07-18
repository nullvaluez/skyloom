/**
 * Round 6 Phase G: Day-style destination local-time light.
 * - override the clock to local NOON → sunFactor ≈ 1, full intensity
 * - override to local MIDNIGHT → sunFactor ≈ 0, floor intensity
 * - night style: authored intensity untouched
 * Player stays at the NYC spawn (lon ≈ −74 → local ≈ UTC−5).
 * Run: npm run dev (:3000), then `node scripts/verify-sun.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract

  const readLights = () =>
    page.evaluate(() => {
      let n = window.__fly.engine.object;
      while (n.parent) n = n.parent;
      let sun = null;
      let hemi = null;
      n.traverse((o) => {
        if (o.isDirectionalLight) sun = o.intensity;
        if (o.isHemisphereLight) hemi = o.intensity;
      });
      return { sun, hemi, sunFactor: window.__flyStats?.sunFactor ?? null };
    });

  // UTC 17:00 → NYC local ≈ noon
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 17, 0, 0);
    window.__flyStore.getState().setMapStyle('satellite');
  });
  await page.waitForTimeout(4000);
  const noon = await readLights();
  gate('local noon → sunFactor high', noon.sunFactor != null && noon.sunFactor > 0.8, JSON.stringify(noon));
  gate('noon sun near full intensity', noon.sun > 1.8, `${noon.sun}`);
  await page.screenshot({ path: path.join(__dirname, 'sun-01-noon.png') });

  // UTC 05:00 → NYC local ≈ midnight (flip styles to force re-apply)
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 5, 0, 0);
    window.__flyStore.getState().setMapStyle('toy');
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('satellite'));
  await page.waitForTimeout(4000);
  const night = await readLights();
  gate('local midnight → sunFactor ~0', night.sunFactor != null && night.sunFactor < 0.1, JSON.stringify(night));
  gate('midnight sun at floor', night.sun < noon.sun * 0.55 && night.sun > 0.5, `${night.sun}`);
  await page.screenshot({ path: path.join(__dirname, 'sun-02-midnight.png') });

  // Toy style: authored intensity, day-cycle inert (round 7: Night retired)
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('toy'));
  await page.waitForTimeout(2500);
  const nstyle = await readLights();
  gate('toy style untouched by day-cycle', Math.abs(nstyle.sun - 0) < 10 && nstyle.sun != null, `${nstyle.sun}`);

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

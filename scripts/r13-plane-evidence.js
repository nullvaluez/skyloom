/**
 * Round 13 Phase 2 evidence capture + BOOST contrail bug re-check (real GPU).
 * Screenshots land in scripts/r13-plane-*.png. Also prints the contrail
 * point/draw stats during a sustained high-altitude boost.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const glShot = (page, n) =>
  page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, `r13-plane-${n}.png`) });

async function orbit(page, x, y) {
  await page.mouse.move(800, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x, y, { steps: 24 });
  await page.waitForTimeout(700);
  await page.mouse.up({ button: 'right' });
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // ============ SATELLITE ============
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));

  // 1. sat-noon: hull grade + ground-contact blob (low AGL, noon light)
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 0); // ~noon MT
    window.__fly.warpToGeo(36.15, -112.0, { altM: 2600, name: null }); // Grand Canyon rim
  });
  await page.waitForTimeout(12000);
  await orbit(page, 1180, 640); // orbit up + around to see plane over ground
  await glShot(page, 'sat-noon');
  const aglNoon = await page.evaluate(() => {
    const f = window.__fly.flight;
    return Math.round(f.pos.y - f.groundElev);
  });
  console.log(`sat-noon captured (AGL ~${aglNoon}m — blob active below 2200m)`);

  // 2. farlod: far-traffic billboard sprites — warp to dense airspace, climb a
  //    bit so far traffic sits beyond the 25km model LOD as glints
  await page.evaluate(() => {
    window.__flySunOverride = null;
    window.__fly.warpToGeo(40.75, -73.9, { altM: 3500, name: null }); // NYC
  });
  await page.waitForTimeout(14000);
  await page.mouse.move(800, 450);
  await glShot(page, 'farlod');
  const far = await page.evaluate(() => {
    const items = window.__fly.traffic.items;
    return items.filter((it) => it.distM > 25000).length;
  });
  console.log(`farlod captured (${far} far billboards in range)`);

  // 3. twin-contrails: high altitude, moving — the twin ribbons behind the jet
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.pos.y = 10500;
    f.speed = 260;
    f.heading = 0;
    f.pitch = 0;
  });
  await page.keyboard.down('Shift'); // hold boost so it keeps climbing/moving
  await page.waitForTimeout(6000);
  await orbit(page, 1150, 560); // orbit behind/above to see both ribbons
  await glShot(page, 'twin-contrails');
  const twin = await page.evaluate(() => ({
    contrailPts: window.__flyStats?.contrailPts,
    alt: Math.round(window.__fly.flight.pos.y),
    spd: Math.round(window.__fly.flight.speed),
  }));
  await page.keyboard.up('Shift');
  console.log(`twin-contrails: ${JSON.stringify(twin)}`);

  // 4. sat-night-ground: moonlit key at the night HDRI bucket
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 7, 0); // ~midnight ET
    window.__fly.warpToGeo(40.75, -73.98, { altM: 1400, name: null });
  });
  await page.waitForTimeout(12000); // let the day-cycle + hdri bucket settle
  await page.mouse.move(800, 450);
  const bucket = await page.evaluate(() => window.__flyStats?.hdriBucket);
  await glShot(page, 'sat-night-ground');
  console.log(`sat-night-ground captured (hdriBucket=${bucket})`);

  // ============ TOY (Neon) ============
  await page.evaluate(() => {
    window.__flySunOverride = null;
    window.__flyStore.getState().setMapStyle('toy');
  });
  await page.waitForTimeout(4000);

  // 5. toy-night: nav lights + moon-cool fresnel rim (close orbit of the jet)
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.pos.y = 900;
    f.speed = 120;
  });
  await page.waitForTimeout(1500);
  await orbit(page, 1220, 520); // 3/4 view of the hero
  await glShot(page, 'toy-night');
  console.log('toy-night captured');

  // 6. BOOST bug re-check + afterburner: high altitude, sustained boost
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.pos.y = 9200; // above CONTRAIL.minAltM (6000)
    f.speed = 300;
    f.heading = 0;
    f.pitch = 0;
    window.__flyStats.contrailPts = 0;
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
  await orbit(page, 900, 520); // slight orbit to see flame + trail
  await glShot(page, 'boost');
  await page.keyboard.up('Shift');
  console.log('BOOST 6s samples (contrailPts / speed):');
  for (const s of samples) console.log(`  t+${s.t}s: pts=${s.pts} spd=${s.spd}kt-ish draws=${s.draws}`);
  const formed = samples.some((s) => (s.pts ?? 0) > 2);
  console.log(`BOOST contrail bug: ${formed ? 'NOT reproduced (contrail formed)' : 'REPRODUCED (no contrail!)'}`);

  console.log(`pageerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

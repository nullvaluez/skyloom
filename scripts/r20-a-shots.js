/**
 * R20 A "SPRAWL" — the before/after evidence pass.
 *
 * Captures the SAME pinned pose twice per scene, once with the round's flag
 * armed and once with it off, by toggling the layer's own inputs rather than
 * by editing constants mid-run: the satellite pair rebuilds the ring after a
 * SAT_POLY_COVER flip is not possible from the page, so each state is captured
 * in its own browser session and the flag is flipped between runs by the
 * caller. Pass the state name as argv[2]:
 *
 *   node scripts/r20-a-shots.js off   # with both R20 A flags enabled:false
 *   node scripts/r20-a-shots.js on    # with both armed
 *
 * Writes scripts/r20-a-<scene>-<state>.png. Poses are the harnesses' own so
 * the shots and the gate numbers describe the same frame.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

(async () => {
  const state = process.argv[2] === 'on' ? 'on' : 'off';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const shot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — setQualityTier below still pins it */
    }
  });

  // --- satellite: the SAT_POLY_COVER scenes ---------------------------------
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 27, 17, 0, 0); // 13:00 EDT — the R18/R19 hour
  });
  await page.mouse.move(800, 450);

  const scenes = [
    ['powell', [40.1578, -83.0752, 600, 1.9, -0.35]],
    ['powell-down', [40.1578, -83.0752, 500, 1.9, -1.2]],
    ['dublin', [40.0992, -83.1141, 4000, 1.9, -0.3]],
    ['owens', [36.6, -118.1, 2600, 1.2, -0.18]],
  ];
  for (const [name, pose] of scenes) {
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(24000);
    await page.mouse.move(800, 450);
    const s = await page.evaluate(() => ({
      kept: window.__satBuildings?.meta?.kept ?? -1,
      houses: window.__satBuildings?.meta?.houses ?? -1,
      sky: window.__satSkyline?.stats?.ready ?? -1,
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
    }));
    await shot(`r20-a-sat-${name}-${state}.png`);
    console.log(`SHOT sat-${name} ${state} ${JSON.stringify(s)}`);
  }

  // --- toy: the TOY_MID_SUBURB scene ---------------------------------------
  // The mid ring is the 8-18 km band, so the pose looks ACROSS a suburb from
  // altitude rather than down at it — that band is the whole point.
  const page2 = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page2.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page2.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked */
    }
  });
  await bootFly(page2, BOOT_OPTS); // seeds 'toy'
  await page2.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page2.mouse.move(800, 450);
  for (const [name, pose] of [
    ['powell-mid', [40.1578, -83.0752, 2600, 1.9, -0.12]],
    ['columbus-mid', [39.9612, -82.9988, 3200, 1.9, -0.14]],
  ]) {
    await page2.evaluate(pinScene, pose);
    await page2.waitForTimeout(26000);
    await page2.mouse.move(800, 450);
    const s = await page2.evaluate(() => ({
      chunks: window.__toyWorld?.stats?.ready ?? -1,
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
    }));
    await page2
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `r20-a-toy-${name}-${state}.png`) });
    console.log(`SHOT toy-${name} ${state} ${JSON.stringify(s)}`);
  }

  await browser.close();
})();

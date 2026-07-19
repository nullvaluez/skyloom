/**
 * R9-2 post-deletion smoke: the flat tracker is GONE — the app must boot
 * straight into FlyMode (no header, no Fly Mode button). Boot-native flow:
 *   1. goto → wait window.__flyBoot.pct === 100 + boot overlay unmounted
 *   2. warp somewhere via window.__fly.warpToGeo (Tokyo)
 *   3. open the inspect card (synthetic track + setInspectHex)
 *   4. open Atlas (M) and close it
 *   5. zero pageerrors throughout; screenshot the revealed world
 * Run: npm run dev (:3000), then `node scripts/smoke-r9-2.js`.
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
  // --- 1. boot to reveal --------------------------------------------------
  // Round 13: migrated to the R9-3 shared boot contract (_boot.js). This
  // smoke predated it and hand-seeded only fly-controls-seen — after the
  // round-10 default flip a fresh context therefore booted SATELLITE, where
  // __toyWorld is REQUIRED to be absent (R11 gate A), so the toy-globals
  // gate below could never pass again. bootFly seeds 'toy' like every other
  // harness (and waits pct 100 with the correct 3rd-arg options — the same
  // waitForFunction 2-arg/30s-default trap R11 fixed in _boot).
  const t0 = Date.now();
  await bootFly(page);
  const noHeader = await page.evaluate(() => !document.querySelector('header'));
  gate('flat-tracker header GONE', noHeader);
  const booted = await page.evaluate(() => ({
    boot: window.__flyBoot,
    overlay: !!document.querySelector('[data-testid="boot-screen"]'),
    canvas: !!document.querySelector('canvas'),
    fly: !!window.__fly,
    toyWorld: !!window.__toyWorld,
    stats: !!window.__flyStats,
    bus: !!window.__flyRuntimeBus,
  }));
  gate('boot pct 100 + overlay gone + canvas up', booted.boot?.pct === 100 && !booted.overlay && booted.canvas, JSON.stringify(booted));
  gate('dev globals live (__fly/__toyWorld/__flyStats/__flyRuntimeBus)', booted.fly && booted.toyWorld && booted.stats && booted.bus);
  console.log('goto→pct100+reveal:', Date.now() - t0, 'ms');
  await page.screenshot({ path: path.join(__dirname, 'smoke-r9-2-01-revealed.png') });

  // --- 2. warp somewhere (Tokyo) ------------------------------------------
  await page.evaluate(() => {
    window.__fly.warpToGeo(35.6762, 139.6503, { altM: 650, name: 'Tokyo' });
  });
  await page.waitForTimeout(9000); // arrival + stream-in starts
  const postWarp = await page.evaluate(() => {
    const g = window.__fly?.geo;
    return g ? { lat: g.y, lon: g.x } : null;
  }).catch(() => null);
  const nearTokyo =
    postWarp && Math.abs(postWarp.lat - 35.68) < 0.5 && Math.abs(postWarp.lon - 139.65) < 0.5;
  gate('warpToGeo landed near Tokyo', !!nearTokyo, JSON.stringify(postWarp));
  await page.screenshot({ path: path.join(__dirname, 'smoke-r9-2-02-tokyo.png') });

  // --- 3. inspect card ------------------------------------------------------
  await page.evaluate(() => {
    const fly = window.__fly;
    fly.traffic.tracks.set('fffff1', {
      hex: 'fffff1',
      meta: { flight: 'SMOKE1', r: 'N0FX', t: 'C172', color: '#22d3ee', iconType: 'prop' },
      fix1: null,
      stale: 0,
      rx: fly.flight.pos.x + 3000,
      ry: fly.flight.pos.y + 200,
      rz: fly.flight.pos.z + 3000,
      distM: 4200,
      archetype: 'prop',
    });
    window.__flyStore.getState().setInspectHex('fffff1');
  });
  await page.waitForSelector('[data-testid="inspect-card"]', { timeout: 8000 });
  gate('inspect card opens', true);
  await page.screenshot({ path: path.join(__dirname, 'smoke-r9-2-03-inspect.png') });
  await page.evaluate(() => window.__flyStore.getState().setInspectHex(null));
  await page.waitForTimeout(500);

  // --- 4. atlas -------------------------------------------------------------
  await page.keyboard.press('m');
  await page.waitForSelector('[data-testid="atlas"]', { timeout: 8000 });
  gate('atlas opens on M', true);
  await page.screenshot({ path: path.join(__dirname, 'smoke-r9-2-04-atlas.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const atlasClosed = await page.evaluate(() => !document.querySelector('[data-testid="atlas"]'));
  gate('atlas closes on Escape', atlasClosed);

  // --- 5. zero pageerrors ---------------------------------------------------
  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nRESULT:', fails.length === 0 ? 'ALL PASS' : `FAILURES: ${fails.join(', ')}`);
  process.exit(fails.length === 0 ? 0 : 1);
})();

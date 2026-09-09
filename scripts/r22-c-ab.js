/**
 * R22 C CLUTTER — per-pool A/B at ONE pose (diagnostic, not a gate).
 * Shoots four frames at P-LEWIS: all on, poles off, cars off, movers off.
 *   FLY_URL=http://localhost:3222 node scripts/r22-c-ab.js [lat lon altM]
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const LAT = Number(process.argv[2] ?? 40.2083);
const LON = Number(process.argv[3] ?? -83.0701);
const ALT = Number(process.argv[4] ?? 120);

const pinScene = async ([lat, lon, altM, heading, pitch]) => {
  for (let i = 0; i < 120 && !window.__fly?.flight?.pos; i++)
    await new Promise((r) => setTimeout(r, 100));
  if (window.__pin) clearInterval(window.__pin);
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  await new Promise((r) => setTimeout(r, 4000));
  f.pos.y = (f.groundElev ?? 0) + altM;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
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
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    let cur = 0;
    Object.defineProperty(window, '__flyClutterPin', {
      get: () => cur,
      set: () => {},
      configurable: true,
    });
  });
  await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  await page.waitForTimeout(2000);
  await page.evaluate(pinScene, [LAT, LON, ALT, 20, -12]);
  await page.waitForTimeout(14000);

  const shot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });
  const set = (k, v) => page.evaluate(([kk, vv]) => (globalThis[kk] = vv), [k, v]);

  for (const [name, flags] of [
    ['all', {}],
    ['nopoles', { __flyClutterPolesOff: true }],
    ['nocars', { __flyClutterCarsOff: true }],
    ['nomovers', { __flyClutterMoversOff: true }],
    ['none', {
      __flyClutterPolesOff: true,
      __flyClutterCarsOff: true,
      __flyClutterMoversOff: true,
    }],
  ]) {
    await set('__flyClutterPolesOff', !!flags.__flyClutterPolesOff);
    await set('__flyClutterCarsOff', !!flags.__flyClutterCarsOff);
    await set('__flyClutterMoversOff', !!flags.__flyClutterMoversOff);
    await page.waitForTimeout(3000);
    // Sample the SAME frame's scene totals as the counts: the bit-identical
    // flip (the R20 suppression instrument) is an equality test, so the two
    // legs must be read the same way and at the same cadence.
    const s = await page.evaluate(() => ({
      ...(window.__flyStats?.satClutter ?? {}),
      sceneDraws: window.__flyStats?.drawCalls ?? -1,
      sceneTris: window.__flyStats?.triangles ?? -1,
    }));
    console.log(
      `${name.padEnd(9)} parked=${s?.parked} movers=${s?.movers} poles=${s?.poles} ` +
        `+draws=${s?.draws} sceneDraws=${s.sceneDraws} sceneTris=${s.sceneTris}`
    );
    await shot(`r22-c-ab-${name}.png`);
  }
  await browser.close();
})();

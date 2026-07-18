/**
 * Round 7 Phase E: airport buzz / touch-and-go.
 * Gates (store-driven — toasts expire, the fly-store `buzz` field is the
 * deterministic record): (1) a sustained low fast pass over KJFK fires a
 * 'buzz' event + the ⌁ toast; (2) a dip below touchAglM followed by a
 * prompt climb fires 'touch-go'; (3) repeating inside the per-airport
 * cooldown stays silent; (4) warping away does NOT mint a phantom event;
 * (5) zero pageerrors. Contract wiring rides the same advanceRef path as
 * the proven overfly kind (buzz templates sit in the rotation pool).
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
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.mouse.move(800, 450); // neutral stick — the plane must hold alt

  const buzzState = () => page.evaluate(() => window.__flyStore.getState().buzz);
  // Pin the plane OVER the field each tick — at cruise (180 m/s) it would
  // exit the 2,500m detection radius before the 2-tick buzz confirmation.
  const holdAgl = (agl) =>
    page.evaluate((a) => {
      const f = window.__fly;
      const elev = f.engine.getElevationAt
        ? (f.engine.getElevationAt(-73.7781, 40.6413) ?? 0)
        : 0;
      const w = f.engine.geoToWorld(-73.7781, 40.6413, elev + a);
      f.flight.pos.x = w.x;
      f.flight.pos.z = w.z;
      f.flight.pos.y = elev + a;
      return elev;
    }, agl);

  // Approach KJFK at a safe height, let DEM stream
  await page.evaluate(() => window.__fly.warpToGeo(40.6413, -73.7781, { altM: 600, name: null }));
  await page.waitForTimeout(12000);

  // --- 1. buzz: sustained 110m AGL fast pass ------------------------------
  const before = await buzzState();
  for (let i = 0; i < 5; i++) {
    await holdAgl(110);
    await page.waitForTimeout(1000);
  }
  const afterBuzz = await buzzState();
  gate(
    'low pass fires buzz',
    !!afterBuzz && afterBuzz.kind === 'buzz' && afterBuzz.at !== before?.at,
    JSON.stringify(afterBuzz)
  );
  gate('buzz airport is JFK', afterBuzz?.airport === 'JFK', afterBuzz?.airport);
  const toastVisible = await page
    .locator('[data-testid="buzz-toast"]')
    .isVisible()
    .catch(() => false);
  gate('⌁ buzz toast shown', toastVisible);
  await page.screenshot({ path: path.join(__dirname, 'buzz-01-toast.png') });

  // --- 2. touch-and-go: dip below 75, climb out ---------------------------
  for (let i = 0; i < 3; i++) {
    await holdAgl(60);
    await page.waitForTimeout(1000);
  }
  await holdAgl(130);
  await page.waitForTimeout(2500);
  const afterTg = await buzzState();
  gate(
    'dip + climb fires touch-go',
    !!afterTg && afterTg.kind === 'touch-go' && afterTg.at > (afterBuzz?.at ?? 0),
    JSON.stringify(afterTg)
  );

  // --- 3. cooldown: repeat inside 120s stays silent -----------------------
  for (let i = 0; i < 3; i++) {
    await holdAgl(60);
    await page.waitForTimeout(1000);
  }
  await holdAgl(130);
  await page.waitForTimeout(2500);
  const afterRepeat = await buzzState();
  gate('cooldown suppresses repeat', afterRepeat?.at === afterTg?.at, JSON.stringify(afterRepeat));

  // --- 4. warp away → no phantom ------------------------------------------
  await holdAgl(100); // mid-low-pass state...
  await page.evaluate(() => window.__fly.warpToGeo(42.3656, -71.0096, { altM: 900, name: null })); // KBOS high
  await page.waitForTimeout(5000);
  const afterWarp = await buzzState();
  gate('warp mints no phantom event', afterWarp?.at === afterRepeat?.at, JSON.stringify(afterWarp));

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

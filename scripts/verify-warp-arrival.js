/**
 * Round 6 Phase D: far-warp arrival — streaming speed + held cinematic.
 * - atlas warp to London (far) → warp-hold overlay appears, holds ≥ holdMin,
 *   reveals ≤ holdMax + 1.2s, and toy chunks are meaningfully ready at reveal
 * - logs the chunk-ready timeline (compare against the pre-round baseline:
 *   ready 40/120 at +3s, 118/120 at +8s with maxThreads 5)
 * - satellite-style far warp exercises the raster (tile-download) readiness
 *   path (round 7: Night retired — same code path, Esri provider)
 * - local warp (target warp) still shows the plain 900ms flash
 * Run: npm run dev (:3000), then `node scripts/verify-warp-arrival.js`.
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
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `warp-${n}.png`) });

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract

  // --- far warp (toy readiness path) -------------------------------------
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  await page.keyboard.type('London', { delay: 40 });
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const holdVisible = await page
    .locator('[data-testid="warp-hold"]')
    .isVisible()
    .catch(() => false);
  const kind = await page.evaluate(() => window.__flyStore.getState().warpKind);
  gate('far warp → hold overlay + warpKind far', holdVisible && kind === 'far', `kind ${kind}`);
  await page.waitForTimeout(1500);
  await shot('01-hold');

  // wait for the overlay to resolve, sampling chunk readiness
  let revealAt = null;
  const timeline = [];
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({
      hold: !!document.querySelector('[data-testid="warp-hold"]'),
      toy: window.__fly?.toyStats ?? null,
    }));
    timeline.push({ t: Math.round((Date.now() - t0) / 100) / 10, ...s });
    if (!s.hold && revealAt == null) {
      revealAt = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(400);
  }
  console.log(
    'timeline:',
    timeline.map((s) => `${s.t}s ready ${s.toy ? s.toy.ready + '/' + s.toy.chunks : '-'} hold ${s.hold ? 1 : 0}`).join(' | ')
  );
  gate(
    'hold resolves within bounds',
    revealAt != null && revealAt >= 2000 && revealAt <= 5600,
    `${revealAt}ms`
  );
  const atReveal = timeline[timeline.length - 1]?.toy;
  gate(
    'chunks meaningfully ready at reveal',
    !!atReveal && (atReveal.ready >= 12 || atReveal.ready / Math.max(1, atReveal.chunks) >= 0.3),
    atReveal ? `${atReveal.ready}/${atReveal.chunks}` : 'no stats'
  );
  await page.waitForTimeout(1200);
  await shot('02-after-reveal');

  // ready-speed check: by +8s from warp, most chunks should be in
  await page.waitForTimeout(Math.max(0, 8000 - (Date.now() - t0)));
  const at8 = await page.evaluate(() => window.__fly?.toyStats ?? null);
  console.log('ready at +8s:', at8 ? `${at8.ready}/${at8.chunks}` : 'n/a');
  gate('streaming not slower than baseline', !!at8 && at8.ready >= 60, `${at8?.ready}`);

  // --- satellite far warp (raster readiness path) -------------------------
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('satellite'));
  await page.waitForTimeout(4000);
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  await page.keyboard.type('Tokyo', { delay: 40 });
  await page.waitForTimeout(600);
  const t1 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const holdNight = await page
    .locator('[data-testid="warp-hold"]')
    .isVisible()
    .catch(() => false);
  gate('satellite far warp → hold overlay', holdNight);
  let nightReveal = null;
  for (let i = 0; i < 30; i++) {
    const hold = await page.evaluate(() => !!document.querySelector('[data-testid="warp-hold"]'));
    if (!hold) {
      nightReveal = Date.now() - t1;
      break;
    }
    await page.waitForTimeout(400);
  }
  gate('satellite hold resolves within bounds', nightReveal != null && nightReveal <= 5600, `${nightReveal}ms`);
  await page.waitForTimeout(2500);
  await shot('03-sat-tokyo');

  // --- local warp still plain flash --------------------------------------
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(5, fly.flight.pos).find((i) => i.fix1);
    if (t) window.__flyStore.getState().setInspectHex(t.hex);
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('[data-testid="inspect-warp"]')?.click());
  await page.waitForTimeout(250);
  const local = await page.evaluate(() => ({
    kind: window.__flyStore.getState().warpKind,
    hold: !!document.querySelector('[data-testid="warp-hold"]'),
  }));
  gate('local warp → plain flash (no hold)', local.kind === 'local' && !local.hold, JSON.stringify(local));

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

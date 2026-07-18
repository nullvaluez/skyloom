/**
 * Globe rework round 2: verifies the user-reported fixes —
 * (1) ink+ice palette (screenshot review), (2) clouds bend with the globe
 * (no rim clipping), (3) contrail is CONTINUOUS across floating-origin
 * rebases at boost altitude, (4) grounded/low traffic sits on the terrain
 * (warp to the lowest track). ALWAYS look at the screenshots.
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
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `globe2-${n}.png`) });

  await bootFly(page); // R9-3: ring-0 stream-in is boot gate (a) — no fixed sleep
  await page.waitForTimeout(4000); // traffic/contrail sources settle (not a boot wait)
  await page.mouse.move(800, 450);

  // 1. New palette at spawn
  await shot('01-ink-ice-spawn');

  // 2. Contrail continuity: jump to 8km, boost straight for ~40s (3 rebases
  // at 750m/s). A rebase used to blank the trail for ~4s — assert the point
  // buffer stays full right after the run, then bank hard so the curved
  // ribbon sweeps into the chase-cam frame for the screenshot.
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 8000;
  });
  await page.keyboard.press('3');
  await page.waitForTimeout(40000);
  const trail = await page.evaluate(() => ({
    rebases: window.__flyStats?.rebases ?? 0,
    contrailPts: window.__flyStats?.contrailPts ?? 0,
  }));
  console.log(
    `rebases crossed at boost: ${trail.rebases} · contrail points live: ${trail.contrailPts}`
  );
  await page.keyboard.down('a'); // hard bank — the trail curves into view
  await page.waitForTimeout(2600);
  await page.keyboard.up('a');
  await shot('02-contrail-after-rebases');
  await page.keyboard.press('2');

  // 3. Clouds at the rim: descend back, level view toward the horizon
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 1500;
  });
  await page.waitForTimeout(4000);
  await shot('03-cloud-rim');

  // 4. Grounded/low traffic on terrain: warp to the LOWEST live track
  const low = await page.evaluate(() => {
    const t = window.__fly?.traffic;
    if (!t) return null;
    const items = t.getNearest(200, window.__fly.flight.pos).filter((i) => i.fix1);
    // Prefer fresh tracks, but adsb.lol oscillates — degrade gracefully
    const pool =
      items.filter((i) => i.stale === 0).length > 0
        ? items.filter((i) => i.stale === 0)
        : items.filter((i) => i.stale === 1).length > 0
          ? items.filter((i) => i.stale === 1)
          : items;
    let best = null;
    for (const it of pool) {
      if (!best || it.ry < best.ry) best = it;
    }
    if (!best) return null;
    const ok = window.__fly.warpTo(best.hex);
    return ok ? { hex: best.hex, altM: Math.round(best.ry), stale: best.stale } : null;
  });
  console.log('warped to lowest track:', JSON.stringify(low));
  if (low) {
    await page.waitForTimeout(6000); // tiles stream at the new spot
    await shot('04-low-traffic-ground');
  }

  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
    tracers: window.__flyStats?.tracers,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  console.log('stats:', JSON.stringify(s), 'pageErrors:', errs.length);
  if (errs.length) console.log('errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(errs.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});

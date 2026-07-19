/**
 * Round 13 Phase 1: measure the satellite HDRI time-of-day swap cost (the
 * PMREM re-bake hitch when the drei <Environment> remounts on a sun-frac
 * bucket change). Drives noon → dusk → night → noon and samples the worst
 * requestAnimationFrame gap around each transition. Run: node scripts/r13-hdri-swapcost.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => window.__fly.warpToGeo(36.6, -118.1, { altM: 1400, name: null }));
  await page.waitForTimeout(6000);

  // rAF gap recorder
  await page.evaluate(() => {
    window.__rafGaps = [];
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      window.__rafGaps.push(now - last);
      last = now;
      window.__rafId = requestAnimationFrame(loop);
    };
    window.__rafId = requestAnimationFrame(loop);
  });

  const measure = async (label, utc) => {
    await page.evaluate(() => { window.__rafGaps.length = 0; });
    await page.evaluate((t) => {
      window.__flySunOverride = t;
      const g = window.__fly.geo;
      window.__fly.warpToGeo(g.y, g.x, { altM: 1400, name: null });
    }, utc);
    await page.waitForTimeout(9000); // bucket flip + HDRI load + PMREM bake
    const r = await page.evaluate(() => {
      const g = window.__rafGaps.slice();
      g.sort((a, b) => b - a);
      return { bucket: window.__flyStats?.hdriBucket, worst: g[0], p2: g[1], p3: g[2], n: g.length };
    });
    console.log(`${label.padEnd(6)} → bucket=${r.bucket}  worst rAF gap ${r.worst?.toFixed(1)}ms (next: ${r.p2?.toFixed(1)}, ${r.p3?.toFixed(1)}) over ${r.n} frames`);
  };

  await measure('noon', Date.UTC(2026, 6, 17, 20, 0));   // lon-118 → ~noon (day)
  await measure('dusk', Date.UTC(2026, 6, 18, 1, 4));    // → dusk bucket swap
  await measure('night', Date.UTC(2026, 6, 17, 8, 52));  // → night bucket swap
  await measure('day', Date.UTC(2026, 6, 17, 20, 0));    // → back to day bucket swap

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

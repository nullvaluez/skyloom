/**
 * F REWIND — the round's money shots: toy Powell before/after.
 *
 * Run once with NEON_COVER.enabled:false (label "before") and once with true
 * (label "after"). Sun is PINNED (R18 lesson 7) and the player is hidden so
 * the frame is the WORLD, not the hero.
 *
 * Usage: node scripts/r19-f-shots.js <before|after>
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

// NOTE the y values are ABSOLUTE world Y, and toy draws terrain at
// trueDEM × 1.7 (TOY_WORLD.terrainExaggeration) while the HUD's AGL is TRUE
// DEM. Powell's true ground is ~276 m, so its DRAWN ground sits at ~470 m —
// a naive y=300 "300 m over Powell" puts the camera UNDERGROUND looking at the
// void floor (first run of this script did exactly that).
const SHOTS = [
  ['powell-300', 40.1578, -83.0752, 770], // ~300 m over the drawn ground
  ['powell-1000', 40.1578, -83.0752, 1470], // ~1000 m over the drawn ground
  ['nyc-cruise', 40.7549, -73.984, 7925],
];

(async () => {
  const tag = process.argv[2] || 'after';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page); // seeds 'toy'
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 16, 0);
  });

  for (const [name, lat, lon, y] of SHOTS) {
    await page.evaluate(
      (p) => {
        if (window.__shotPin) clearInterval(window.__shotPin);
        window.__fly.warpToGeo(p.lat, p.lon, { altM: p.y, name: null });
      },
      { lat, lon, y }
    );
    await page.waitForTimeout(2000);
    await page.evaluate((yy) => {
      window.__shotPin = setInterval(() => {
        window.__fly.flight.pos.y = yy;
      }, 400);
    }, y);
    await page.waitForTimeout(y > 4000 ? 70000 : 40000); // ultra ring is slow to fill
    await page.evaluate(() => {
      if (window.__flyPlayer) window.__flyPlayer.visible = false;
    });
    await page.waitForTimeout(1200);
    const stats = await page.evaluate(() => ({
      draws: window.__flyStats?.drawCalls,
      tris: window.__flyStats?.triangles,
    }));
    await page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `r19-f-${name}-toy-${tag}.png`) });
    console.log(
      `SHOT ${tag} ${name}: draws ${stats.draws} tris ${(stats.tris / 1e6).toFixed(3)}M`
    );
  }
  await browser.close();
})();

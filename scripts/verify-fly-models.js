/** Visual check of the GLB asset pass: player plane + close-up traffic. */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const warns = [];
  page.on('console', (m) => {
    if (m.text().includes('fly-models')) warns.push(m.text());
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  await page.waitForTimeout(12000);
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);

  // Player plane close-up (chase view is always on it)
  await page.screenshot({ path: path.join(__dirname, 'models-01-player.png') });

  // Sanity: every swapped archetype geometry must be fuselage-on-Z
  const dims = await page.evaluate(() => {
    const worldRoot = window.__fly.engine.object.parent;
    const scene = worldRoot.parent;
    const out = [];
    scene.traverse((o) => {
      if (o.isInstancedMesh && o._isModel) {
        o.geometry.computeBoundingBox();
        const s = new o.geometry.boundingBox.constructor().copy(o.geometry.boundingBox);
        const size = {
          x: +(s.max.x - s.min.x).toFixed(1),
          y: +(s.max.y - s.min.y).toFixed(1),
          z: +(s.max.z - s.min.z).toFixed(1),
        };
        out.push(size);
      }
    });
    return out;
  });
  console.log('model geometry sizes (want z = length):', JSON.stringify(dims));

  // Warp to the nearest few archetypes to eyeball orientation/scale
  const shots = ['02', '03', '04'];
  for (const tag of shots) {
    const hex = await page.evaluate(() => {
      const fly = window.__fly;
      const items = [...fly.traffic.items]
        .filter((it) => it.stale === 0 && it.fix1 && Math.hypot(it.fix1.vE, it.fix1.vN) > 60)
        .sort((a, b) => a.distM - b.distM);
      // rotate through different archetypes for variety
      const seen = window.__seenArch ?? (window.__seenArch = new Set());
      const pick = items.find((it) => !seen.has(it.archetype)) ?? items[0];
      if (!pick) return null;
      seen.add(pick.archetype);
      return fly.warpTo(pick.hex) ? pick.hex : null;
    });
    if (!hex) break;
    await page.waitForTimeout(4500);
    const info = await page.evaluate((h) => {
      const t = window.__fly.traffic.tracks.get(h);
      return t ? { arch: t.archetype, dist: Math.round(t.distM) } : null;
    }, hex);
    console.log(`warped to ${hex}:`, JSON.stringify(info));
    await page.screenshot({ path: path.join(__dirname, `models-${tag}-arch${info?.arch}.png`) });
  }

  console.log('model warnings:', warns.join(' | ') || 'none');
  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

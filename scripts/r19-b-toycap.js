/**
 * B DEEPFIELD — toy byte-identity capture.
 *
 * The R19 tile key moved ('world-bend-fade-hill-r13' → '-r19') and that program
 * is the tile material in BOTH styles, so every Neon tile recompiles. The claim
 * is that toy pixels are unchanged because the two SAT_QUILT uniforms are 0
 * outside satellite. This captures one deterministic Neon frame so the claim
 * can be tested against a stashed pre-R19 tree instead of argued from the
 * source. Output name comes from argv[2].
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

(async () => {
  const tag = process.argv[2] || 'toy';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page); // seeds 'toy'
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
    window.__fly.warpToGeo(40.7549, -73.984, { altM: 1800, name: null });
  });
  await page.waitForTimeout(2500);
  // Freeze: identical pose in both runs is the whole point of the comparison.
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.__frozen = true;
    f.step = () => {};
  });
  await page.waitForTimeout(30000);
  await page.evaluate(() => {
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
    let s = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
    while (s && s.parent) s = s.parent;
    s?.traverse((o) => {
      if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
        o.visible = false;
    });
  });
  await page.mouse.move(640, 360);
  await page.waitForTimeout(1500);
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, `r19-b-toy-${tag}.png`) });
  const out = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    quilt: window.__flyAerial?.quilt?.() ?? null,
    haze: window.__flyAerial?.haze?.() ?? null,
    aerial: window.__flyAerial?.get?.()?.strength ?? null,
  }));
  console.log(
    `toy capture "${tag}": draws ${out.draws} · quilt ${JSON.stringify(out.quilt)} · contentHazeMax ${out.haze?.max} · aerialStrength ${out.aerial}`
  );
  await browser.close();
})();

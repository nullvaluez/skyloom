/**
 * Phase 3 verification (see FLY_MODE_HANDOFF.md §5.3): floating origin +
 * sky/clouds/contrail. Protocol: enter Fly mode → spawn screenshot (HDRI +
 * clouds) → 75s boost run due north (~55km true, ~7 anchor rebases) with a
 * rAF frame-time monitor → assert rebases happened, no long frames at
 * rebase, tiles still streaming at the end, HUD sane → climb above 6km for
 * the contrail → Esc exit. Screenshots land next to this script — LOOK at
 * them (jitter/seams are visual failures automation can't catch).
 */
const { chromium } = require('playwright');
const path = require('path');

const OUT = __dirname;
const URL = 'http://localhost:3000';

async function readHud(page) {
  const vals = await page.locator('.font-mono').allTextContents();
  return {
    spd: parseInt(vals[0]?.replace(/[^\d-]/g, ''), 10),
    alt: parseInt(vals[1]?.replace(/[^\d-]/g, ''), 10),
    agl: parseInt(vals[2]?.replace(/[^\d-]/g, ''), 10),
    hdg: parseInt(vals[3]?.replace(/[^\d-]/g, ''), 10),
    thr: vals[4],
  };
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const tileHits = []; // timestamps of arcgis tile responses
  page.on('response', (r) => {
    if (r.url().includes('arcgisonline.com')) tileHits.push(Date.now());
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  console.log('flying; waiting for tiles + HDRI...');
  await page.waitForTimeout(15000);
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);

  console.log('HUD@spawn:', JSON.stringify(await readHud(page)));
  await page.screenshot({ path: path.join(OUT, 'p3-01-spawn-sky.png') });

  // Frame-time monitor (rAF deltas)
  await page.evaluate(() => {
    window.__frames = [];
    const loop = (prev) =>
      requestAnimationFrame((t) => {
        if (prev) window.__frames.push(t - prev);
        loop(t);
      });
    loop(0);
  });

  // --- 75s boost run due north ---
  console.log('boost run: 75s due north...');
  await page.keyboard.down('Shift');
  for (let leg = 1; leg <= 5; leg++) {
    await page.waitForTimeout(15000);
    const h = await readHud(page);
    const stats = await page.evaluate(() => window.__flyStats || null);
    console.log(`t=${leg * 15}s HUD:`, JSON.stringify(h), 'rebase:', JSON.stringify(stats));
    if (leg === 2) await page.screenshot({ path: path.join(OUT, 'p3-02-boost-30s.png') });
    if (leg === 4) await page.screenshot({ path: path.join(OUT, 'p3-03-boost-60s.png') });
  }
  await page.keyboard.up('Shift');
  await page.screenshot({ path: path.join(OUT, 'p3-04-boost-end.png') });

  // Frame-time verdict: ignore first 5s (tile burst right after monitor start)
  const frames = await page.evaluate(() => window.__frames);
  const warm = frames.slice(300);
  const sorted = [...warm].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const long = warm.filter((f) => f > 25).length;
  const worst = Math.max(...warm);
  console.log(
    `frames n=${warm.length} p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms worst=${worst.toFixed(1)}ms >25ms:${long} (${((100 * long) / warm.length).toFixed(2)}%)`
  );

  const stats = await page.evaluate(() => window.__flyStats || null);
  console.log('rebase stats:', JSON.stringify(stats), '— expect ~7 rebases, maxRebaseMs well under 25');

  // Tiles must still be streaming at the end of the run
  const now = Date.now();
  const recent = tileHits.filter((t) => now - t < 15000).length;
  console.log(`tile responses in final 15s: ${recent} (must be > 0), total: ${tileHits.length}`);

  // --- Contrail: climb above 6km ---
  console.log('climbing for contrail...');
  await page.keyboard.down('Shift');
  await page.keyboard.down('s');
  await page.waitForTimeout(9000);
  await page.keyboard.up('s');
  await page.waitForTimeout(2500);
  const h = await readHud(page);
  console.log('HUD@altitude:', JSON.stringify(h), '(contrail needs ALT > 19,685ft)');
  await page.screenshot({ path: path.join(OUT, 'p3-05-contrail.png') });
  await page.keyboard.up('Shift');

  console.log('--- errors ---');
  const errs = consoleLines.filter((l) => l.startsWith('[pageerror]'));
  console.log(errs.slice(0, 8).join('\n') || 'none');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  console.log('exited:', (await page.locator('.fixed.inset-0 canvas').count()) === 0);
  await browser.close();
})().catch((e) => {
  console.error('DRIVE FAILED:', e.message);
  process.exit(1);
});

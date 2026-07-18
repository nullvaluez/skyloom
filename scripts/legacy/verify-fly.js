// LEGACY (R9-3, 2026-07-18): base flight-test of the pre-round-9 app shell (header-button entry, Esc-exit to the deleted flat tracker). Kept unmigrated for the record — do not run against the fly-only app.
/**
 * Fly-mode browser flight-test harness (see FLY_MODE_HANDOFF.md §6).
 * Protocol: enter Fly mode → HUD readouts → 2s turn measurement → 8s dive
 * (soft-floor/terrain-slide check) → boost acceleration → the same turn
 * under 4x CPU throttle (frame-rate independence) → Esc exit.
 *
 * Prereqs: dev server on :3000 (`npm run dev`), Chrome installed, and the
 * `playwright` package resolvable (`npm i -D playwright` or a sibling
 * install — no browser download needed, it drives installed Chrome).
 * Screenshots land next to this script; ALWAYS look at them.
 */
const { chromium } = require('playwright');
const path = require('path');

const OUT = __dirname;
const URL = 'http://localhost:3000';

async function readHud(page) {
  const vals = await page.locator('.font-mono').allTextContents();
  // [SPD, ALT, AGL, HDG, THROTTLE]
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

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  console.log('flying; waiting for tiles + spawn...');
  await page.waitForTimeout(15000);

  // Park the mouse dead-center so mouse-steer is neutral for key tests
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);

  let h = await readHud(page);
  console.log('HUD@spawn:', JSON.stringify(h));
  await page.screenshot({ path: path.join(OUT, 'p2-01-spawn.png') });

  // --- Turn test: hold D exactly 2s, measure heading delta ---
  const h0 = (await readHud(page)).hdg;
  await page.keyboard.down('d');
  await page.waitForTimeout(2000);
  await page.keyboard.up('d');
  const h1 = (await readHud(page)).hdg;
  const dNormal = ((h1 - h0 + 540) % 360) - 180;
  console.log(`turn: hdg ${h0} -> ${h1} (Δ${dNormal}° in 2s @60fps)`);
  await page.screenshot({ path: path.join(OUT, 'p2-02-banked.png') });
  await page.waitForTimeout(2500); // bank auto-levels

  // --- Dive test: nose down into terrain, must slide, never clip ---
  await page.keyboard.down('w');
  await page.waitForTimeout(8000);
  await page.keyboard.up('w');
  await page.waitForTimeout(3000); // pitch auto-levels, still at floor?
  h = await readHud(page);
  console.log('HUD@after-dive:', JSON.stringify(h), '| floor(50m)=164ft — AGL must be >=~150 and never negative');
  await page.screenshot({ path: path.join(OUT, 'p2-03-terrain-slide.png') });

  // --- Boost test ---
  await page.keyboard.down('s');
  await page.waitForTimeout(1500); // pull up first
  await page.keyboard.up('s');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(4000);
  h = await readHud(page);
  await page.screenshot({ path: path.join(OUT, 'p2-04-boost.png') });
  await page.keyboard.up('Shift');
  console.log('HUD@boost:', JSON.stringify(h), '| boost target ~1458kt');

  // --- Frame-rate independence: same 2s turn under 4x CPU throttle ---
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(1000);
  const t0 = (await readHud(page)).hdg;
  await page.keyboard.down('d');
  await page.waitForTimeout(2000);
  await page.keyboard.up('d');
  const t1 = (await readHud(page)).hdg;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const dThrottled = ((t1 - t0 + 540) % 360) - 180;
  console.log(`turn@4x-throttle: Δ${dThrottled}° in 2s (vs Δ${dNormal}° at full speed) — should match within ~20%`);

  console.log('--- errors ---');
  const errs = consoleLines.filter((l) => l.startsWith('[pageerror]'));
  console.log(errs.slice(0, 6).join('\n') || 'none');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  console.log('exited:', (await page.locator('.fixed.inset-0 canvas').count()) === 0);
  await browser.close();
})().catch((e) => {
  console.error('DRIVE FAILED:', e.message);
  process.exit(1);
});

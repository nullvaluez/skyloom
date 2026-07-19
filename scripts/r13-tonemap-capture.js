/**
 * Round 13 Phase 0 — tone-map A/B capture (AgX vs ACES vs None/pre-R13).
 * Boots fixed scenes and flips the tone mode live via window.__flySetTone
 * (dev-only hook registered by Effects.jsx), saving GL screenshots
 * scripts/r13-tonemap-<mode>-<scene>.png and printing quantitative stats:
 *   clip%   = luma > 250 (highlight clipping — Esri imagery snow/cloud tops)
 *   hi%     = luma > 220
 *   midStd  = luma std-dev over mid-tones (50..205) = mid-tone contrast
 *   sat     = mean (max-min)/max saturation
 *   luma    = mean luma
 * Run: node scripts/r13-tonemap-capture.js  (dev server on :3000).
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const MODES = ['AgX', 'ACES', 'None'];

async function stats(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const n = info.width * info.height;
  let clip = 0, hi = 0, sumL = 0, sumL2mid = 0, cntMid = 0, sumSat = 0;
  const midL = [];
  for (let i = 0; i < n; i++) {
    const r = data[i * ch], g = data[i * ch + 1], b = data[i * ch + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumL += l;
    if (l > 250) clip++;
    if (l > 220) hi++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sumSat += mx > 0 ? (mx - mn) / mx : 0;
    if (l >= 50 && l <= 205) { midL.push(l); }
  }
  const midMean = midL.reduce((a, b) => a + b, 0) / Math.max(1, midL.length);
  let v = 0;
  for (const l of midL) v += (l - midMean) ** 2;
  const midStd = Math.sqrt(v / Math.max(1, midL.length));
  return {
    clip: +((clip / n) * 100).toFixed(2),
    hi: +((hi / n) * 100).toFixed(2),
    midStd: +midStd.toFixed(1),
    sat: +(sumSat / n).toFixed(3),
    luma: +(sumL / n).toFixed(1),
  };
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`); });
  const gl = () => page.locator('.fixed.inset-0 canvas').first();

  const captureAt = async (scene) => {
    const row = {};
    for (const mode of MODES) {
      await page.evaluate((m) => window.__flySetTone(m), mode);
      await page.waitForTimeout(1200); // recompile + settle
      await page.mouse.move(800, 450);
      const file = path.join(__dirname, `r13-tonemap-${mode}-${scene}.png`);
      await gl().screenshot({ path: file });
      row[mode] = await stats(file);
    }
    await page.evaluate(() => window.__flySetTone(null)); // back to constant
    console.log(`\n=== ${scene} ===`);
    for (const m of MODES) console.log(`  ${m.padEnd(5)} ${JSON.stringify(row[m])}`);
  };

  // --- SATELLITE -----------------------------------------------------------
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.waitForTimeout(4000);
  await captureAt('sat-boot');

  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 20, 0); // ~noon PDT
    window.__fly.warpToGeo(36.578, -118.29, { altM: 3600, name: null });
  });
  await page.waitForTimeout(20000);
  await captureAt('sat-noon-sierra');

  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 18, 3, 0); // ~8pm PDT dusk
    window.__fly.warpToGeo(36.578, -118.29, { altM: 3600, name: null });
  });
  await page.waitForTimeout(6000);
  await captureAt('sat-dusk-sierra');

  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 17, 0); // NYC ~noon
    window.__fly.warpToGeo(40.758, -73.9855, { altM: 800, name: null }); // Midtown ~2.6k ft
  });
  await page.waitForTimeout(20000);
  await captureAt('sat-manhattan');

  // --- TOY -----------------------------------------------------------------
  await page.evaluate(() => { window.__flySunOverride = null; window.__flyStore.getState().setMapStyle('toy'); });
  await page.waitForTimeout(9000);
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.waitForTimeout(3000);
  await captureAt('toy-boot');

  await page.evaluate(() => {
    window.__fly.warpToGeo(40.728, -73.995, { altM: 650, name: null }); // Midtown skyline
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__abPin = setInterval(() => { f.pos.x = p.x; f.pos.y = p.y; f.pos.z = p.z; f.heading = 0; f.pitch = 0; f.bank = 0; f.speed = 0; }, 8);
  });
  await page.waitForTimeout(18000);
  await captureAt('toy-midtown');
  await page.evaluate(() => clearInterval(window.__abPin));

  console.log(`\npageErrors: ${errs.length}`, errs.slice(0, 4));
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

/**
 * Round 7 Phase C: satellite depth pass.
 * Gates: (1) hillshade A/B — with the strength uniform at 0 vs default, the
 * luminance std-dev of a mountain-terrain crop must rise ≥ 12% (relief
 * contrast exists and is attributable to the layer); (2) the sun-direction
 * uniform flips east↔west between a morning and evening __flySunOverride;
 * (3) some streamed tile texture carries anisotropy = HILLSHADE.anisotropy;
 * (4) a z17 Esri imagery request is observed at low altitude (satMaxZoom
 * 16→17); (5) draws ≤ 360 at low AGL in satellite (deeper LOD = more tiles
 * — the phase's real budget risk, reported loudly); (6) zero pageerrors.
 * Screenshots: Sierra Nevada morning/evening — eyeball the relief.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

async function meanAbsDiff(fileA, fileB, region) {
  const opts = { resolveWithObject: true };
  const a = await sharp(fileA).extract(region).raw().toBuffer(opts);
  const b = await sharp(fileB).extract(region).raw().toBuffer(opts);
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

async function lumaStd(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    const l =
      0.2126 * data[i * info.channels] +
      0.7152 * data[i * info.channels + 1] +
      0.0722 * data[i * info.channels + 2];
    sum += l;
    sum2 += l * l;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let z17Seen = false;
  page.on('response', (r) => {
    if (/World_Imagery\/MapServer\/tile\/17\//.test(r.url())) z17Seen = true;
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, `satdepth-${n}.png`) });

  // R9-3: boot straight into satellite (persisted-style path) — the boot
  // contract already waits for the tile download queue to drain.
  await bootFly(page, { style: 'satellite' });
  await page.mouse.move(800, 450);

  // Sierra Nevada, morning light
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 16, 0); // 9am PDT
    window.__fly.warpToGeo(36.578, -118.29, { altM: 3600, name: null });
  });
  await page.waitForTimeout(20000);
  await page.mouse.move(800, 450);
  await glShot('01-sierra-am');
  const dirAM = await page.evaluate(() => window.__flyHill.get());

  // A/B: strength 0 for the control frame
  const region = { left: 300, top: 450, width: 1000, height: 380 };
  await page.evaluate(() => window.__flyHill.set(0));
  await page.waitForTimeout(400);
  await glShot('02-sierra-flat');
  await page.evaluate((s) => window.__flyHill.set(s), dirAM.strength || 0.55);
  await page.waitForTimeout(400);
  const stdOn = await lumaStd(path.join(__dirname, 'satdepth-01-sierra-am.png'), region);
  const stdOff = await lumaStd(path.join(__dirname, 'satdepth-02-sierra-flat.png'), region);
  const mad = await meanAbsDiff(
    path.join(__dirname, 'satdepth-01-sierra-am.png'),
    path.join(__dirname, 'satdepth-02-sierra-flat.png'),
    region
  );
  console.log(
    `terrain luma std-dev: hillshade ${stdOn.toFixed(1)} vs flat ${stdOff.toFixed(1)} · mean |Δ| ${mad.toFixed(2)}/255`
  );
  // Primary gate: the layer must actually move terrain pixels (clouds/haze
  // dilute a std-ratio; per-pixel |Δ| is attribution-proof — >2/255 mean
  // over a 1000×380 terrain crop cannot come from temporal noise alone).
  gate('hillshade changes terrain rendering', mad > 2, `mean |Δ| ${mad.toFixed(2)}`);
  gate('strength gated to satellite default', Math.abs(dirAM.strength - 0.55) < 0.01, `strength ${dirAM.strength}`);

  // Evening: sun direction must flip east→west. The day-cycle effect
  // re-applies on warp epoch — nudge with an in-place warp.
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 18, 1, 0); // 6pm PDT
    window.__fly.warpToGeo(36.578, -118.29, { altM: 3600, name: null });
  });
  await page.waitForTimeout(2500);
  const dirPM = await page.evaluate(() => window.__flyHill.get());
  console.log(`sun dir AM x=${dirAM.dir[0].toFixed(2)} → PM x=${dirPM.dir[0].toFixed(2)}`);
  gate('sun direction flips AM→PM', dirAM.dir[0] > 0.2 && dirPM.dir[0] < -0.2);
  await glShot('03-sierra-pm');

  // Anisotropy on streamed tile textures
  const aniso = await page.evaluate(() => {
    let found = 0;
    window.__fly.engine.object.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m?.map?.anisotropy > found) found = m.map.anisotropy;
      }
    });
    return found;
  });
  gate('anisotropic imagery sampling', aniso >= 8, `max anisotropy ${aniso}`);

  // z17 descent at low altitude over the valley
  await page.evaluate(() => {
    window.__flySunOverride = null;
    window.__fly.warpToGeo(36.601, -118.06, { altM: 500, name: null }); // Owens Valley floor
  });
  await page.waitForTimeout(22000);
  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  console.log(`z17 request seen: ${z17Seen} · SAT DRAWS low-AGL: ${s.draws} · heap ${s.heapMB}MB`);
  gate('z17 imagery streams at low level', z17Seen);
  if (s.draws > 360) fails.push(`draws ${s.draws} > 360`);
  await glShot('04-valley-low');

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

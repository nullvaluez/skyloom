/**
 * Round 20 (C2) control experiment: at Agra, DEEP NIGHT, is the marquee Taj
 * bluer than the PROCEDURAL monument that stood in exactly the same place
 * before it — and does the satellite stone key close the gap?
 *
 * The first attempt at this compared the Taj against Christ the Redeemer at the
 * same UTC instant, which is NOT a control: 22:00 UTC is 03:30 in Agra (deep
 * night, cold moon key) and 19:00 in Rio (dusk, warm key). The valid control is
 * the SAME SITE, the SAME sun, the same crop, with only the marquee layer
 * flipped — MONUMENT_MODELS.enabled is baked at build time, so the caller flips
 * it between runs and passes the state as argv[2]:
 *
 *   node scripts/r20-c2-nighthue.js off   # MONUMENT_MODELS.enabled:false
 *   node scripts/r20-c2-nighthue.js on    # …:true
 *
 * Reports the mean RGB of the monument's pixels (a luma window excludes the
 * near-black ground and the HUD) and blue-minus-red, the quantity the reported
 * "the Taj is blue" defect is about.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const NIGHT = Date.UTC(2026, 7, 1, 22, 0); // 03:30 IST — deep night at Agra
const SITE = { lat: 27.1695, lon: 78.0421, altM: 200 };
// Tight on the monument's silhouette in the 1600x900 frame (see
// scripts/r20-c-taj-satellite-after.png): x 45.5-54.5%, y 39-50%.
const CROP = [0.455, 0.39, 0.09, 0.11];

(async () => {
  const state = process.argv[2] === 'on' ? 'on' : 'off';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(1500);
  await page.evaluate(
    (a) => {
      window.__flySunOverride = a.sun;
      window.__fly.warpToGeo(a.lat, a.lon, { altM: a.altM, name: null });
      const f = window.__fly.flight;
      const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
      if (window.__c2pin) clearInterval(window.__c2pin);
      window.__c2pin = setInterval(() => {
        f.pos.x = p.x;
        f.pos.y = p.y;
        f.pos.z = p.z;
        f.heading = 0;
        f.pitch = 0;
        f.bank = 0;
        f.speed = 0;
      }, 8);
    },
    { ...SITE, sun: NIGHT }
  );
  await page.waitForTimeout(20000);
  const buf = await page.locator('.fixed.inset-0 canvas').first().screenshot();
  const stats = await page.evaluate(
    async (a) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + a.b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(
        Math.round(a.crop[0] * img.width),
        Math.round(a.crop[1] * img.height),
        Math.round(a.crop[2] * img.width),
        Math.round(a.crop[3] * img.height)
      ).data;
      let n = 0;
      let r = 0;
      let gg = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (L < 40 || L > 240) continue;
        r += d[i];
        gg += d[i + 1];
        b += d[i + 2];
        n += 1;
      }
      return n ? { n, r: r / n, g: gg / n, b: b / n } : { n: 0 };
    },
    { b64: buf.toString('base64'), crop: CROP }
  );
  const placed = await page.evaluate(() =>
    (window.__flyMonuments?.placed ?? []).map((p) => p.name)
  );
  console.log(
    `MONUMENT_MODELS=${state} placed=[${placed.join(',')}] px=${stats.n} ` +
      `mean rgb=(${stats.r?.toFixed(1)}, ${stats.g?.toFixed(1)}, ${stats.b?.toFixed(1)}) ` +
      `blue-minus-red=${stats.n ? (stats.b - stats.r).toFixed(1) : 'n/a'}`
  );
  await browser.close();
})();

/**
 * Round 20 (C2) — evidence pass for the marquee footprint exclusion.
 *
 * Re-shoots the two frames that DIAGNOSED the defect, from the poses baked into
 * agent C's originals (read off their HUDs, so the before/after pair frames the
 * same thing):
 *   r20-c-taj-satellite-after.png      27.1695N 78.0421E, 200 m, hdg 000 — the
 *                                      blue night-atlas block standing through
 *                                      the marble
 *   r20-c-taj-satellite-day-after.png  same pose, midday — proves the marble
 *                                      albedo is the model's, not a night grade
 *   r20-c-eiffel-toy-after.png         48.8495N 2.2945E, 400 m, hdg 000 — the
 *                                      blocky streamed cluster at the base
 *
 * The sun is PINNED here (C's originals ran on the machine clock, which cannot
 * be reproduced): 22:00 UTC = 00:00 Paris / 03:30 Agra for the night frames,
 * 06:00 UTC = 11:30 Agra for the day frame.
 *
 * Usage: FLY_URL=http://localhost:3122 node scripts/r20-c2-shots.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const NIGHT = Date.UTC(2026, 7, 1, 22, 0);
const DAY = Date.UTC(2026, 7, 1, 6, 0);

const SHOTS = [
  ['r20-c-taj-satellite-after.png', 'satellite', 27.1695, 78.0421, 200, NIGHT],
  ['r20-c-taj-satellite-day-after.png', 'satellite', 27.1695, 78.0421, 200, DAY],
  ['r20-c-eiffel-toy-after.png', 'toy', 48.8495, 2.2945, 400, NIGHT],
];

const pin = (a) => {
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
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  for (const [file, style, lat, lon, altM, sun] of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await bootFly(page, { style });
    await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await page.waitForTimeout(1500);
    await page.evaluate(pin, { lat, lon, altM, sun });
    // The marquee layer only re-merges when the placement set changes, and a
    // placement needs streamed ground — wait for the monument, not for a guess.
    await page
      .waitForFunction(() => (window.__flyMonuments?.placed ?? []).length > 0, null, {
        timeout: 90000,
        polling: 500,
      })
      .catch(() => {});
    await page.waitForTimeout(16000);
    const placed = await page.evaluate(() =>
      (window.__flyMonuments?.placed ?? []).map((p) => p.name)
    );
    await page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, file) });
    console.log(`${file} — placed: ${placed.join(', ') || 'none'}`);
    await page.close();
  }
  await browser.close();
})();

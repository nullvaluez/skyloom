/**
 * Atlas round harness (FLY_ATLAS_REWORK §5 Phase A/B): enter fly → M opens
 * the atlas → search "Tokyo" → Enter warps → world self-heals at the
 * destination (chunks, traffic, letters) → both-altitude screenshots
 * (constraint 11) → warp "Nellis" and verify the military spawn-offset
 * path + the military letter + tooltip data. Zero page errors throughout.
 * Run: npm run dev (on :3000) first, then `node scripts/verify-atlas.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const TOKYO = { lat: 35.6762, lon: 139.6503 };
const NELLIS = { lat: 36.2362, lon: -115.0343 };

const distM = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `atlas-${n}.png`) });
  const geo = () =>
    page.evaluate(() => {
      const g = window.__fly?.geo;
      return g ? { lon: g.x, lat: g.y } : null;
    });
  const pollUntil = async (fn, timeoutMs, label) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
      await page.waitForTimeout(1000);
    }
  };

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.mouse.move(800, 450);

  // --- 1. M opens the atlas ------------------------------------------------
  await page.keyboard.press('m');
  await page.waitForSelector('[data-testid="atlas"]', { timeout: 5000 });
  console.log('atlas opened via M');
  await page.waitForTimeout(900); // coastline fetch + first draw
  await shot('01-open');

  // --- 2. Search Tokyo → Enter warps ---------------------------------------
  await page.locator('[data-testid="atlas-search"]').fill('Tokyo');
  await page.waitForTimeout(400);
  const resultCount = await page.locator('[data-testid="atlas-result"]').count();
  console.log('search results for "Tokyo":', resultCount);
  if (resultCount === 0) throw new Error('no search results for Tokyo');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  const atlasClosed = await page.evaluate(() => !window.__flyStore.getState().atlasOpen);
  const warpEpoch = await page.evaluate(() => window.__flyStore.getState().warpEpoch);
  const banner = await page
    .locator('[data-testid="arrival-banner"]')
    .isVisible()
    .catch(() => false);
  const g1 = await geo();
  console.log(
    `after warp: closed=${atlasClosed} warpEpoch=${warpEpoch} banner=${banner} geo=${g1.lat.toFixed(3)},${g1.lon.toFixed(3)}`
  );
  if (!atlasClosed || warpEpoch < 1) throw new Error('warp did not fire');
  if (Math.abs(g1.lat - TOKYO.lat) > 1 || Math.abs(g1.lon - TOKYO.lon) > 1)
    throw new Error(`arrived nowhere near Tokyo: ${g1.lat}, ${g1.lon}`);

  // --- 3. Destination self-heal: chunks + traffic ----------------------------
  const chunksReady = await pollUntil(
    () => page.evaluate(() => (window.__flyStats?.toy?.ready ?? 0) > 8),
    30000,
    'toy chunks ready > 8'
  ).then(() => page.evaluate(() => window.__flyStats.toy.ready));
  console.log('toy chunks ready:', chunksReady);
  const traffic = await pollUntil(
    () => page.evaluate(() => (window.__flyStats?.traffic ?? 0) > 10),
    20000,
    'traffic > 10'
  ).then(() => page.evaluate(() => window.__flyStats.traffic));
  console.log('traffic tracked at Tokyo:', traffic);
  await shot('02-tokyo-arrival');

  // --- 4. Constraint 11: the same place from cruise altitude ------------------
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 8000;
  });
  await page.waitForTimeout(2500);
  await shot('03-tokyo-8km');

  // --- 5. Nellis: military spawn offset + letter + slots ----------------------
  await page.keyboard.press('m');
  await page.waitForSelector('[data-testid="atlas"]', { timeout: 5000 });
  await page.locator('[data-testid="atlas-search"]').fill('Nellis');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const g2 = await geo();
  const offsetM = distM(g2.lat, g2.lon, NELLIS.lat, NELLIS.lon);
  console.log(`Nellis spawn offset: ${Math.round(offsetM)}m (expect ~4000)`);
  if (offsetM < 2800 || offsetM > 5500)
    throw new Error(`military spawn offset out of band: ${Math.round(offsetM)}m`);

  // poiSlots may still hold the pre-warp snapshot (2s tick) — require the
  // DESTINATION's letter, not just any military slot (Tokyo has Yokota).
  const slots = await pollUntil(
    () =>
      page.evaluate(() => {
        const s = window.__fly?.poiSlots ?? [];
        return s.some((p) => p.kind === 'military' && p.name.includes('Nellis')) ? s : null;
      }),
    14000,
    'Nellis military letter in poiSlots'
  );
  const mil = slots.find((p) => p.kind === 'military' && p.name.includes('Nellis'));
  console.log(
    'military slot:',
    mil.name,
    '| blurb on slot:',
    mil.blurb ? 'yes' : 'MISSING',
    '| all slots:',
    slots.map((p) => `${p.kind}:${p.name}`).join(', ')
  );
  if (!mil.blurb) throw new Error('military poiSlot missing blurb (tooltip data)');
  await page.waitForTimeout(6000); // letters pop in + some world streams
  await shot('04-nellis-arrival');

  // --- 6. Visit log persisted -------------------------------------------------
  const atlasStore = await page.evaluate(() => localStorage.getItem('fly-atlas'));
  const visits = atlasStore ? JSON.parse(atlasStore).state?.visits ?? {} : {};
  const nellisVisits = visits['military:Nellis AFB'] ?? 0;
  console.log('Nellis visit count in fly-atlas store:', nellisVisits);
  if (nellisVisits < 1) throw new Error('visit log did not record the Nellis warp');

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  const pass = errs.length === 0;
  console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

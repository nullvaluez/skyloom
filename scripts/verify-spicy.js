/**
 * SPICY ping verification (FLY_ATLAS_REWORK §5 Phase D): inject a synthetic
 * military contact (verify-fly5's injection pattern) → the ping toast must
 * appear once with the SPICY badge, set the minimap pulse, and NEVER
 * re-fire for the same hex; then a 3-minute zero-pageerror soak with the
 * synthetic feed running. Run against a dev server on :3000.
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `spicy-${n}.png`) });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('header', { timeout: 120000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  await page.waitForTimeout(10000);
  await page.mouse.move(800, 450);

  // Synthetic military contact 12km NE, military archetype (4) + iconType.
  await page.evaluate(() => {
    const rt = window.__fly;
    const t = rt.traffic;
    const f = rt.flight;
    const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
    const t0 = performance.now() / 1000;
    window.__sim = {
      planes: [
        {
          hex: 'ae5f01',
          flight: 'VIPER11',
          x0: f.pos.x + 8500 * k,
          y: f.pos.y + 2200,
          z0: f.pos.z - 8500 * k,
          vE: -160,
          vN: -40,
          arch: 4,
        },
      ],
      t0,
    };
    const STRIDE = 9;
    const send = () => {
      const clientSec = performance.now() / 1000;
      const now = t.serverNow(clientSec) ?? clientSec;
      const age = clientSec - window.__sim.t0;
      const planes = window.__sim.planes;
      const rows = new Float32Array(planes.length * STRIDE);
      const hexes = [];
      const meta = [];
      planes.forEach((p, i) => {
        const o = i * STRIDE;
        rows[o] = p.x0 + p.vE * age * k - t._originX;
        rows[o + 1] = p.y;
        rows[o + 2] = p.z0 - p.vN * age * k - t._originZ;
        rows[o + 3] = p.vE;
        rows[o + 4] = 0;
        rows[o + 5] = p.vN;
        rows[o + 6] = 0;
        rows[o + 7] = p.arch;
        rows[o + 8] = 0;
        hexes.push(p.hex);
        meta.push({
          hex: p.hex,
          flight: p.flight,
          r: 'AF-16',
          t: 'F16',
          squawk: '4701',
          category: 'A2',
          iconType: 'military',
          color: '#f87171',
        });
      });
      t.ingest({ buffer: rows.buffer, count: planes.length, hexes, meta, serverNow: now }, clientSec);
    };
    send();
    window.__sim.id = setInterval(send, 2000);
  });

  // --- 1. Ping fires once ----------------------------------------------------
  // Real traffic legitimately pings too (evening NYC has genuine military/
  // epic contacts) — scope every assertion to the synthetic callsign.
  const viper = page.locator('[data-testid="spicy-toast"]', { hasText: 'VIPER11' });
  await viper.waitFor({ timeout: 20000 });
  const text = await viper.textContent();
  console.log('spicy toast:', text);
  const pulse = await page.evaluate(() => window.__fly.spicyPulse?.hex ?? null);
  console.log('minimap pulse hex (latest ping):', pulse);
  await shot('01-ping');
  if (!pulse) throw new Error('spicy pulse not set');
  if (!/nm\s+(N|NE|E|SE|S|SW|W|NW)/.test(text)) throw new Error('toast missing range/bearing');

  // --- 2. Toast retires and never re-fires for the same hex -------------------
  await page.waitForTimeout(6500);
  const goneOnce = (await viper.count()) === 0;
  console.log('VIPER11 toast retired:', goneOnce);
  let refires = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1500);
    refires += await viper.count();
  }
  console.log('VIPER11 re-fires over 12s:', refires);
  if (!goneOnce || refires > 0) throw new Error('spicy toast re-fired for a seen hex');

  // --- 3. Three-minute soak, synthetic feed live ------------------------------
  console.log('3-minute zero-error soak…');
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(10000);
    if (errs.length > 0) break;
  }
  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  console.log('heap after soak (MB):', heap);

  const pass = errs.length === 0;
  console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

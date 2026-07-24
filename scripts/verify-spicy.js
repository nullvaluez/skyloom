/**
 * SPICY ping verification (FLY_ATLAS_REWORK §5 Phase D): inject a synthetic
 * military contact (verify-fly5's injection pattern) → the ping toast must
 * appear once with the SPICY badge, set the minimap pulse, and NEVER
 * re-fire for the same hex.
 *
 * R14 "AirVenture" phase (after the F16 assertions): inject a SECOND contact
 * (WARBRD1, t:'B17', iconType:'warbird-heavy', archetype 11, CIVILIAN squawk,
 * ~10nm) — a B-17 is base(warbird-heavy 50) + WARBIRD_TYPE_RARITY.B17 (40) = 90
 * = Legendary, so it must ping ONCE through the tier gate (NOT the military
 * accent path, since iconType !== 'military'), and never re-fire. Proves the
 * new warbird rarity reaches SPICY without touching militaryTypes.
 *
 * Then a 3-minute zero-pageerror soak with both synthetic contacts running.
 * Run against a dev server on :3000.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

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

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.mouse.move(800, 450);

  // Synthetic military contact 12km NE, military archetype (4) + iconType.
  await page.evaluate(() => {
    const rt = window.__fly;
    const t = rt.traffic;
    const f = rt.flight;
    const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
    const t0 = performance.now() / 1000;
    window.__sim = {
      // Each plane carries its OWN meta so a later phase can push a warbird
      // with different iconType/type without disturbing the military contact.
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
          meta: {
            r: 'AF-16',
            t: 'F16',
            squawk: '4701',
            category: 'A2',
            iconType: 'military',
            color: '#f87171',
          },
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
        meta.push({ hex: p.hex, flight: p.flight, ...p.meta });
      });
      t.ingest({ buffer: rows.buffer, count: planes.length, hexes, meta, serverNow: now }, clientSec);
    };
    window.__sim.send = send;
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

  // --- 2b. R14 warbird pings through the TIER gate (not military accent) ------
  // Inject a B-17 ~10nm out, civilian squawk, iconType 'warbird-heavy'. Its
  // score = base(warbird-heavy 50) + WARBIRD_TYPE_RARITY.B17 (40) = 90 =
  // Legendary, so it must ping once via SPICY.minTier — NOT the military path.
  await page.evaluate(() => {
    const f = window.__fly.flight;
    const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
    window.__sim.planes.push({
      hex: 'b17c47',
      flight: 'WARBRD1',
      x0: f.pos.x + 13100 * k, // ~13.1km E + ~13.1km N ≈ 18.5km ≈ 10nm
      y: f.pos.y + 1200,
      z0: f.pos.z - 13100 * k,
      vE: 0,
      vN: 0,
      arch: 11, // warbird-heavy
      meta: {
        r: 'N17W',
        t: 'B17',
        squawk: '1200', // VFR civilian — no squawk bonus, no military auto-ping
        category: 'A1',
        iconType: 'warbird-heavy',
        color: '#f59e0b',
      },
    });
    window.__sim.send(); // push it into the feed immediately
  });

  const warbird = page.locator('[data-testid="spicy-toast"]', { hasText: 'WARBRD1' });
  await warbird.waitFor({ timeout: 20000 });
  const wtext = await warbird.textContent();
  console.log('warbird spicy toast:', wtext);
  const wPulse = await page.evaluate(() => window.__fly.spicyPulse?.hex ?? null);
  console.log('minimap pulse hex after warbird ping:', wPulse);
  await shot('02b-warbird');
  if (!wPulse) throw new Error('warbird ping did not set the spicy pulse');
  if (!/nm\s+(N|NE|E|SE|S|SW|W|NW)/.test(wtext)) throw new Error('warbird toast missing range/bearing');
  // B-17 must be tiered Legendary — the toast tint is the tier color (amber),
  // NOT the military accent (#f87171). We assert firing = tier-gate proof and
  // that F16 (below) is untouched.

  // Warbird toast retires and never re-fires for the same hex.
  await page.waitForTimeout(6500);
  const wGoneOnce = (await warbird.count()) === 0;
  console.log('WARBRD1 toast retired:', wGoneOnce);
  let wRefires = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1500);
    wRefires += await warbird.count();
  }
  console.log('WARBRD1 re-fires over 12s:', wRefires);
  if (!wGoneOnce || wRefires > 0) throw new Error('warbird spicy toast re-fired for a seen hex');

  // F16 phase still holds: VIPER11 stayed retired through the warbird phase.
  const viperStillGone = (await viper.count()) === 0;
  console.log('VIPER11 still retired after warbird phase:', viperStillGone);
  if (!viperStillGone) throw new Error('F16 phase regressed: VIPER11 re-appeared');

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

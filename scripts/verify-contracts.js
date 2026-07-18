/**
 * Round 6 Phase F: contracts v1.
 * - panel renders with 3 active contracts + persisted score
 * - synthetic helicopter spot via passport logSpot → spot-heli progress
 * - altitude contract completes at FL300 → stamp + score bump + rotation
 * - formation contract completes when lockState hits formation
 * Run: npm run dev (:3000), then `node scripts/verify-contracts.js`.
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
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // Fresh score for deterministic asserts — seeded BEFORE the app mounts
  // (the persisted contracts store rehydrates on mount).
  await page.addInitScript(() => localStorage.removeItem('fly-contracts'));
  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract

  const panel = await page.locator('[data-testid="contracts-panel"]').isVisible();
  gate('contracts panel visible', panel);
  const readScore = () =>
    page.evaluate(() => {
      const t = document.querySelector('[data-testid="contracts-score"]')?.textContent ?? '';
      return parseInt(t.replace(/[^\d]/g, ''), 10) || 0;
    });
  const score0 = await readScore();
  console.log('baseline score:', score0);

  // --- synthetic helicopter spots → spot-heli progress -------------------
  await page.evaluate(() => {
    const { usePassportStore } = window.__flyStores ?? {};
    // passport store is not on window — go through the logSpot the fly code
    // uses: the store singleton is importable only in-app, so drive it via
    // a synthetic traffic track + inspect (the product path).
  });
  // Product path: inject a synthetic helicopter track and open its card
  // (InspectModal logs the spot on open).
  for (const [hex, reg] of [['feedc1', 'N1HELI'], ['feedc2', 'N2HELI']]) {
    await page.evaluate(
      ([h, r]) => {
        const fly = window.__fly;
        const f = fly.flight;
        const liveT = Math.max(0, ...[...fly.traffic.tracks.values()].map((t) => t.fix1?.t ?? 0));
        const x = f.pos.x + 1500;
        const y = f.pos.y + 100;
        const z = f.pos.z;
        const track = {
          hex: h,
          meta: { flight: r, r, t: 'B407', color: '#a78bfa', iconType: 'helicopter', category: null, squawk: null },
          archetype: 1,
          flags: 0,
          fix0: null,
          fix1: { x, y, z, vE: 40, vN: 20, vUp: 0, latRad: (f.latDeg * Math.PI) / 180, t: liveT },
          groundElev: 0,
          yaw: 0,
          bank: 0,
          rx: x,
          ry: y,
          ryd: y, // round-8.5 H1 drawn-frame Y — engine glides this via renderLift
          renderLift: 0,
          _liftTarget: 0,
          rz: z,
          distM: 1500,
          opacity: 1,
          scaleK: 1,
          stale: 0,
          blendFix1: null,
          blendFix0: null,
          blendStart: 0,
          altBlendFrom: 0,
          altBlendStart: null,
          snapDipUntil: null,
          lastPollServer: liveT,
        };
        fly.traffic.tracks.set(h, track);
        if (!fly.traffic.items.includes(track)) fly.traffic.items.push(track);
        window.__flyStore.getState().setInspectHex(h);
      },
      [hex, reg]
    );
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  // The completed row lingers ~2.6s then rotates out — accept either the
  // visible "+150" stamp or the rotation having already happened with the
  // score credited.
  let heliOk = false;
  let heliDetail = '';
  for (let i = 0; i < 20 && !heliOk; i++) {
    const heli = await page.evaluate(
      () => document.querySelector('[data-testid="contract-spot-heli"]')?.textContent ?? ''
    );
    const s = await readScore();
    heliOk = /\+150/.test(heli) || (heli === '' && s >= score0 + 150);
    heliDetail = `row "${heli}" score ${s}`;
    if (!heliOk) await page.waitForTimeout(250);
  }
  gate('helicopter spots advance + complete', heliOk, heliDetail);

  // --- altitude contract --------------------------------------------------
  // Only present after rotations; if active it must complete. Pin the
  // altitude while polling (the flight model can drift it back down).
  let alt = '';
  let altOk = false;
  let altShown = false;
  for (let i = 0; i < 24; i++) {
    await page.evaluate(() => {
      window.__fly.flight.pos.y = 9400;
    });
    alt = await page.evaluate(
      () => document.querySelector('[data-testid="contract-alt-fl300"]')?.textContent ?? ''
    );
    altShown = altShown || alt.length > 0;
    if (!altShown || /\+100/.test(alt)) {
      altOk = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  gate('altitude contract (if active) completes', altOk, alt || 'not active');
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 1200;
  });

  // --- formation contract -------------------------------------------------
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(8, fly.flight.pos).find((i) => i.fix1);
    fly.interceptHex(t.hex);
  });
  let formationDone = false;
  for (let i = 0; i < 45 && !formationDone; i++) {
    await page.waitForTimeout(1000);
    formationDone = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="contract-chase-formation"]');
      return el ? el.getAttribute('data-done') === '1' : false;
    });
  }
  gate('formation contract completes', formationDone);

  const scoreEnd = await readScore();
  const persisted = await page.evaluate(() => localStorage.getItem('fly-contracts') ?? '');
  gate(
    'score accumulated + persisted',
    scoreEnd > score0 && new RegExp(`"totalScore":${scoreEnd}`).test(persisted),
    `${score0} → ${scoreEnd}`
  );
  await page.screenshot({ path: path.join(__dirname, 'contracts-01-panel.png') });

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

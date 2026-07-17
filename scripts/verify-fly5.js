/**
 * Phase 5 verification with SYNTHETIC traffic (works while adsb.lol is
 * degraded): injects fabricated worker batches straight into
 * window.__fly.traffic at 2s cadence, then drives the full gameplay chain —
 * soft lock → reticle → F intercept → boost pursuit → 400m handoff →
 * formation slot hold → info card → hard-stick breakout → pause menu.
 * Also covers Phase 6 UI (controls help card, pause, credits, exit).
 */
const { chromium } = require('playwright');
const path = require('path');

const OUT = __dirname;
const URL = 'http://localhost:3000';

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

  // First-entry controls help must appear once, then dismiss
  const gotIt = page.getByText("Got it — let's fly");
  await gotIt.waitFor({ timeout: 15000 });
  console.log('controls help card: visible ✓');
  await gotIt.click();

  console.log('waiting for tiles...');
  await page.waitForTimeout(10000);
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);

  // --- Inject synthetic traffic, refreshed every 2s in-page --------------
  await page.evaluate(() => {
    const rt = window.__fly;
    const t = rt.traffic;
    const f = rt.flight;
    const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
    const t0 = performance.now() / 1000;

    // Target: 2km dead ahead (north), co-altitude, 80 m/s northbound —
    // close and exactly on the nose so it out-scores any real traffic.
    // Extras: crossing traffic for labels/minimap.
    window.__sim = {
      planes: [
        { hex: 'te5701', flight: 'TEST01', x0: f.pos.x, y: f.pos.y, z0: f.pos.z - 2000 * k, vE: 0, vN: 80, arch: 0 },
        { hex: 'te5702', flight: 'TEST02', x0: f.pos.x - 3000 * k, y: f.pos.y + 900, z0: f.pos.z - 9000 * k, vE: 90, vN: 10, arch: 1 },
        { hex: 'te5703', flight: 'TEST03', x0: f.pos.x + 5000 * k, y: f.pos.y + 1800, z0: f.pos.z - 4000 * k, vE: -70, vN: 40, arch: 3 },
      ],
      t0,
    };

    const STRIDE = 9;
    const send = () => {
      const clientSec = performance.now() / 1000;
      // Stamp batches in the engine's estimated SERVER timebase so the
      // synthetic fixes coexist with any live adsb.lol traffic.
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
        rows[o + 6] = 0; // fresh fix
        rows[o + 7] = p.arch;
        rows[o + 8] = 0;
        hexes.push(p.hex);
        meta.push({
          hex: p.hex,
          flight: p.flight,
          r: `N${i + 1}TS`,
          t: 'A320',
          squawk: '1200',
          category: 'A3',
          iconType: 'airliner',
          color: '#4ade80',
        });
      });
      t.ingest({ buffer: rows.buffer, count: planes.length, hexes, meta, serverNow: now }, clientSec);
    };
    send();
    window.__sim.id = setInterval(send, 2000);
  });
  await page.waitForTimeout(2500);

  const readLock = () =>
    page.evaluate(() => {
      // fly-store is module-scoped; read the mirrored state via targeting
      const rt = window.__fly;
      return {
        lockedHex: rt.targeting?.lockedHex ?? null,
        apMode: rt.autopilot?.mode ?? null,
        dist: rt.targeting?.target?.distM ?? null,
        speed: rt.flight?.speed ?? null,
        tracks: rt.traffic?.size ?? 0,
      };
    });

  let s = await readLock();
  console.log('after inject:', JSON.stringify(s), '— expect lockedHex te5701 (soft), 3 tracks');
  await page.screenshot({ path: path.join(OUT, 'p5-01-softlock.png') });

  // --- F: intercept ---
  await page.keyboard.press('f');
  await page.waitForTimeout(1500);
  s = await readLock();
  console.log('after F:', JSON.stringify(s), '— expect apMode intercept, speed ramping');

  // Ride the intercept: 6km at closing ~600+m/s → handoff in ~10-15s
  let formationAt = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    s = await readLock();
    if (i % 3 === 0) console.log(`t+${(i + 1) * 1.5}s:`, JSON.stringify(s));
    if (s.apMode === 'formation') {
      formationAt = (i + 1) * 1.5;
      break;
    }
  }
  console.log(formationAt ? `FORMATION handoff at ~${formationAt}s ✓` : 'NO formation handoff (FAIL)');
  await page.screenshot({ path: path.join(OUT, 'p5-02-intercept.png') });

  // --- Formation hold: sample slot distance for 8s ---
  const holdSamples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1000);
    s = await readLock();
    holdSamples.push(Math.round(s.dist));
  }
  const slotIdeal = Math.hypot(80, 20, 60);
  console.log(
    `formation hold dist samples: [${holdSamples.join(', ')}]m (ideal slot ≈ ${slotIdeal.toFixed(0)}m; must be stable, roughly 40-350m)`
  );
  await page.screenshot({ path: path.join(OUT, 'p5-03-formation.png') });

  // --- Info card should be up (<2km) ---
  const cardVisible = await page.getByText('TEST01').count();
  console.log('info card visible:', cardVisible > 0 ? '✓' : 'NOT VISIBLE (check)');

  // --- Passport logged the spot ---
  const passportHit = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      if (v && v.includes('te5701')) return k;
    }
    return null;
  });
  console.log('passport spot logged:', passportHit ? `✓ (${passportHit})` : 'NOT FOUND (check)');

  // --- Hard-stick breakout ---
  await page.keyboard.down('a');
  await page.waitForTimeout(700);
  await page.keyboard.up('a');
  s = await readLock();
  console.log('after hard stick:', JSON.stringify(s), '— apMode must be off');

  // --- Pause menu (Esc pauses, attribution stays, credits open) ---
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const paused = await page.getByText('Paused').count();
  const attribution = await page.getByText('Terrain © Esri').count();
  console.log(`pause menu: ${paused > 0 ? '✓' : 'MISSING'} | attribution visible while paused: ${attribution > 0 ? '✓' : 'MISSING'}`);
  await page.screenshot({ path: path.join(OUT, 'p5-04-pause.png') });

  await page.getByText('Credits & licenses').click();
  await page.waitForTimeout(400);
  const credits = await page.getByText('Kloofendal 48d Partly Cloudy (Pure Sky)').count();
  console.log('credits panel lists HDRI:', credits > 0 ? '✓' : 'MISSING');
  await page.screenshot({ path: path.join(OUT, 'p5-05-credits.png') });
  await page.getByText('Back').click();
  await page.keyboard.press('Escape'); // resume
  await page.waitForTimeout(600);

  // --- Exit via the X button (Esc no longer exits) ---
  await page.locator('button[aria-label="Exit Fly Mode"]').click();
  await page.waitForTimeout(1500);
  console.log('exited:', (await page.locator('.fixed.inset-0 canvas').count()) === 0);

  console.log('--- errors ---');
  const errs = consoleLines.filter((l) => l.startsWith('[pageerror]'));
  console.log(errs.slice(0, 8).join('\n') || 'none');
  await browser.close();
})().catch((e) => {
  console.error('DRIVE FAILED:', e.message);
  process.exit(1);
});

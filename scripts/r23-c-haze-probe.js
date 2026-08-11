/**
 * ROUND 23 (C "NIGHT-CERT") — CONTENT-HAZE PROBE. Not a gate; the evidence.
 *
 * verify-aerial's new legs 12/13 cannot be exercised in this session, because
 * the ELEVEN frozen gates ahead of them are pixel A/Bs over satellite imagery
 * and this session's egress denies both tile hosts. That would leave two new
 * assertions shipped without a single measurement behind them.
 *
 * This probe is the same two reads with nothing in front of them. It boots
 * satellite, drops to medium tier, RELEASES the fleet aerial pin, and reads
 * `getSatContentHaze().max` through FlyScene's `__flyAerial` handle at noon and
 * at deep night. Every input is local — tier, constants, sun — so it measures
 * the real thing on a machine with no tiles, and it is the number A's F1
 * finding predicts.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules FLY_URL=http://localhost:3023 \
 *      node scripts/r23-c-haze-probe.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const MAN = [40.7075, -74.0113, 792];
const NOON = Date.UTC(2026, 6, 17, 19, 30);
const NIGHT = Date.UTC(2026, 6, 18, 4, 0); // NYC lon −74 ⇒ ≈ 23:04 local

const READ = () => ({
  tier: window.__flyStore?.getState?.().qualityTier ?? null,
  aerialPin: window.__flyAerialOverride ?? null,
  haze: window.__flyAerial?.haze?.() ?? null,
  post: window.__flyAerial?.get?.()?.strength ?? null,
  quilt: window.__flyAerial?.quilt?.() ?? null,
  elDeg: window.__flyStats?.skyElDeg ?? null,
  state: window.__flyStats?.skyState ?? null,
  sunFrac: window.__flyStats?.sunFactor ?? null,
  tel: window.__flyStats?.night ?? null, // A's block; null before the merge
});

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });

  const rows = {};
  const leg = async (tag, tier, sunMs, release) => {
    await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), tier);
    await page.waitForTimeout(2500); // material/composer rebuild
    await page.evaluate((r) => {
      if (r) delete window.__flyAerialOverride;
      else window.__flyAerialOverride = 0;
    }, release);
    // Sun BEFORE the warp — warpEpoch re-runs the day-cycle effect.
    await page.evaluate(
      ([la, lo, al, su]) => {
        window.__flySunOverride = su;
        window.__fly.warpToGeo(la, lo, { altM: al, name: null });
      },
      [...MAN, sunMs]
    );
    await page.waitForTimeout(6000);
    const r = await page.evaluate(READ);
    rows[tag] = r;
    console.log(
      `${tag.padEnd(26)} tier=${String(r.tier).padEnd(6)} pin=${r.aerialPin ?? 'RELEASED'} ` +
        `el=${r.elDeg}° ${String(r.state).padEnd(5)} contentHaze=${r.haze?.max} ` +
        `band=[${r.haze?.startM},${r.haze?.endM}] postAerial=${r.post} ` +
        `tel=${r.tel ? r.tel.contentHaze : 'absent'}`
    );
    return r;
  };

  // The four cells that define the finding.
  await leg('high/noon/released', 'high', NOON, true);
  await leg('high/night/released', 'high', NIGHT, true);
  await leg('medium/noon/released', 'medium', NOON, true);
  const mNight = await leg('medium/night/released', 'medium', NIGHT, true);
  // …and the fleet's own cell, to show what every legacy harness sees.
  await leg('medium/night/FLEET-PINNED', 'medium', NIGHT, false);

  console.log('\npageerrors:', errs.slice(0, 4).join(' | ') || 'none');
  console.log(
    `VERDICT — medium + deep night, aerial released: contentHaze = ${mNight.haze?.max}. ` +
      `A's F1 predicts 0.55 on a tree without NIGHT_TRUTH_R23.hazeNight, and ~0 with it.`
  );
  fs.writeFileSync(
    path.join(__dirname, 'r23-c-haze-probe.json'),
    JSON.stringify({ when: new Date().toISOString(), rows, errs }, null, 2)
  );
  console.log('written: scripts/r23-c-haze-probe.json');
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

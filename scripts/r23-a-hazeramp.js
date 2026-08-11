/**
 * R23 A "NIGHT-TRUTH" — the content-haze DUSK RAMP (F1 evidence).
 *
 * The F1 fix retires the content haze as the city lights arrive. A step would
 * be a new defect (a haze that snaps off at a clock boundary reads as a flash),
 * and the R19 dusk ladder is load-bearing, so this sweeps the clock across a
 * whole afternoon→midnight crossing at medium tier and prints the measured
 * curve.
 *
 * BEFORE the fix the curve is a CONSTANT 0.55 at every one of these samples —
 * measured at both endpoints in scripts/r23-a-tiernight.json's pre-fix run
 * (committed at a529b51), since the term read no sun input at all.
 *
 * Tile-independent (see scripts/r23-a-BLOCKED.md): it reads a uniform, not a
 * pixel. Medium tier, `__flyAerialOverride` released = the user's condition.
 *
 * Usage: FLY_URL=http://localhost:3021 node scripts/r23-a-hazeramp.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const GEO = [40.758, -73.9855]; // P-MAN
const ALT = 800;

const pinScene = ([lat, lon, altM]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = 200;
  f.pitch = -18;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = 200;
    f.pitch = -18;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  // Capture the STACK, not just the message: in this worktree the egress policy
  // 403s both tile hosts, so "TypeError: Failed to fetch" is expected noise —
  // but noise has to be ATTRIBUTED, not assumed (R19 §7: an instrument can
  // indict an actor it merely failed to exclude).
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)));
  await page.addInitScript(unpinPins, [
    '__flyTerraPin',
    '__flySettlePin',
    '__flyClutterPin',
    '__flyDepthPin',
    '__flyAerialOverride',
  ]);
  await bootFly(page, { style: 'satellite', settleMs: 3000 });
  await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), 'medium');
  await page.waitForTimeout(2000);

  const rows = [];
  // 16:00 UTC ≈ noon EDT through 05:00 UTC ≈ 01:00 EDT — an afternoon into
  // deep night, crossing dusk in the middle.
  const hoursUtc = [16, 18, 20, 21, 22, 22.5, 23, 23.5, 24, 24.5, 25, 26, 27, 29];
  for (const h of hoursUtc) {
    const ms = Date.UTC(2026, 6, 28, 0, 0) + h * 3600 * 1000;
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, ms);
    await page.evaluate(pinScene, [GEO[0], GEO[1], ALT]);
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({
      sunFrac: window.__flyStats?.sunFactor ?? null,
      hdri: window.__flyStats?.hdriBucket ?? null,
      haze: window.__flyAerial?.haze?.()?.max ?? null,
      nightTele: window.__flyStats?.night
        ? {
            tier: window.__flyStats.night.tier,
            contentHaze: window.__flyStats.night.contentHaze,
            windowsArmed: window.__flyStats.night.lit.windowsArmed,
          }
        : null,
    }));
    rows.push({ utcHour: h, ...r });
    process.stdout.write(
      `UTC ${String(h).padStart(4)}h  sunFrac=${String(r.sunFrac).padEnd(20)} hdri=${String(r.hdri).padEnd(6)} contentHaze=${r.haze}\n`
    );
  }
  const dest = path.join(__dirname, 'r23-a-hazeramp.json');
  fs.writeFileSync(
    dest,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'BEFORE the F1 fix this column is a constant 0.55 at every sample (the term read no sun input).',
        tier: 'medium',
        errors,
        rows,
      },
      null,
      2
    )
  );
  process.stdout.write(`\nwrote ${dest}\nerrors=${errors.length}\n`);
  await browser.close();
})();

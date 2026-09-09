/**
 * ROUND 22 (D "DEPTH") — evidence for plan §5.4, the pre-sanctioned
 * `AERIAL_PERSPECTIVE.content.enabled false -> true` + `minTier -> medium`
 * flip. D PREPARES this; Fable consumes the move at merge (charter rule 3), so
 * the constant is flipped ONLY for the duration of the capture and reverted —
 * the shipped tree must show that hunk untouched.
 *
 * MEDIUM TIER is the whole point. At high tier the flip is redundant: the
 * AerialPerspective POST pass already hazes those same fragments off the same
 * depth buffer, and running both double-hazes the mid band (the R19 §5b
 * ruling). At medium and low there is no post pass at all, so extruded content
 * is an un-atmosphered cut-out standing on hazed ground — the field study's
 * P1/P6 finding, and the reason R19 built the term and shipped it off.
 *
 * Usage:  TAG=off node scripts/r22-d-haze54.js     (constant as shipped)
 *         TAG=on  node scripts/r22-d-haze54.js     (constant flipped)
 * with FLY_URL set. Produces r22-d-haze54-<tag>-<pose>.png + a JSON of the live
 * uniform state read through world-bend's getSatHaze().
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

if (!process.env.FLY_URL) process.exit(2);
const TAG = process.env.TAG || 'off';
const SHOT = (n) => path.join(__dirname, `r22-d-haze54-${process.env.TIER || 'medium'}-${TAG}-${n}.png`);
const NOON = Date.UTC(2026, 6, 17, 19, 30);

// Content crop: the building band, clear of every HUD element.
const CROP = { left: 300, top: 470, width: 1000, height: 300 };

async function luma(file) {
  const { data, info } = await sharp(file)
    .extract(CROP)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    s += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return +(s / n).toFixed(2);
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
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(n) });

  await bootFly(page, { style: 'satellite' });
  // MEDIUM — the tier the flip is for. The aerial post pass is high-only, so at
  // medium the content term is the ONLY atmosphere touching extruded content.
  // TIER is an argument: 'medium' is what §5.4 is FOR, 'high' is the control
  // that proves the shader term is alive at all. HIGH additionally un-pins
  // __flyAerialOverride, because FlyScene's content branch is gated on the
  // SAME `aerialGate` master as the post pass (see the report).
  const TIER = process.env.TIER || 'medium';
  await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), TIER);
  if (TIER === 'high') await page.evaluate(() => (window.__flyAerialOverride = 1));
  await page.waitForTimeout(2500);

  const out = { tag: TAG, poses: {} };
  const pose = async (name, lat, lon, altM, settle) => {
    await page.evaluate(
      ([la, lo, al, su]) => {
        const f = window.__fly.flight;
        delete f.step;
        delete f.__frozen;
        window.__flySunOverride = su;
        window.__fly.warpToGeo(la, lo, { altM: al, name: null });
      },
      [lat, lon, altM, NOON]
    );
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const f = window.__fly.flight;
      f.__frozen = true;
      f.step = () => {};
    });
    await page.waitForTimeout(settle);
    await page.evaluate(() => {
      if (window.__flyPlayer) window.__flyPlayer.visible = false;
    });
    await page.mouse.move(800, 450);
    await page.waitForTimeout(1200);
    await glShot(name);
    out.poses[name] = {
      luma: await luma(SHOT(name)),
      haze: await page.evaluate(() => window.__flyStats?.satHaze ?? null),
      tier: await page.evaluate(() => window.__flyStore.getState().qualityTier),
      draws: await page.evaluate(() => window.__flyStats?.drawCalls ?? null),
      tris: await page.evaluate(() => window.__flyStats?.triangles ?? null),
      agl: await page.evaluate(() => Math.round(window.__fly.flight.agl)),
    };
    console.log(name, JSON.stringify(out.poses[name]));
  };

  await pose('manhattan', 40.7549, -73.984, 1400, 26000);
  await pose('lewis', 40.2083, -83.0701, 700, 24000);

  out.pageerrors = errs;
  fs.writeFileSync(path.join(__dirname, `r22-d-haze54-${process.env.TIER || 'medium'}-${TAG}.json`), JSON.stringify(out, null, 2));
  console.log('pageerrors', errs.length);
  await browser.close();
})();

/**
 * Round 6 Phase C: sky/ground rim unification.
 * For each style × two altitudes: screenshot, then measure the hardest
 * color step down a blurred vertical strip crossing the horizon band. The
 * pre-round-6 bug was a hard black band between the bent terrain rim and
 * the sky (fog ≠ edge-fade ≠ dome band in night/toy) — a hard band reads
 * as a large adjacent-row delta; the unified rim should grade smoothly.
 * Stars/terrain noise are averaged out by a 60px-wide column mean + blur.
 * Run: npm run dev (:3000), then `node scripts/verify-rim.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

// Round 7: Night retired — two styles remain (4 strips).
const STYLES = ['toy', 'satellite'];
const ALTS = [{ name: 'low', y: 900 }, { name: 'high', y: 9100 }];
// Max blurred adjacent-row channel delta allowed across the horizon band
// (0-255). Smooth gradients run ~1-4; the old black band edge read >25.
const MAX_STEP = 18;

async function stripMaxStep(file) {
  // 60px-wide strip left of center (avoids HUD + player), rows spanning
  // where the rim sits at both altitudes. The metric is the per-row MEDIAN
  // of per-column adjacent-row deltas: a rim BAND (the bug) hits every
  // column at one row → median high; a neon tracer crossing the strip hits
  // a few columns → median stays low (data-conditions robustness).
  const { data, info } = await sharp(file)
    .extract({ left: 90, top: 330, width: 60, height: 360 })
    .blur(2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = (x, y, c) => data[(y * info.width + x) * info.channels + c];
  let maxStep = 0;
  let at = 0;
  const deltas = new Array(info.width);
  for (let y = 1; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      deltas[x] = Math.max(
        Math.abs(px(x, y, 0) - px(x, y - 1, 0)),
        Math.abs(px(x, y, 1) - px(x, y - 1, 1)),
        Math.abs(px(x, y, 2) - px(x, y - 1, 2))
      );
    }
    deltas.sort((a, b) => a - b);
    const med = deltas[info.width >> 1];
    if (med > maxStep) {
      maxStep = med;
      at = y + 330;
    }
  }
  return { maxStep: Math.round(maxStep * 10) / 10, at };
}

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

  await bootFly(page); // R9-3: fly-only boot — the style loop below keeps its own settles
  await page.mouse.move(800, 450);
  // R9: the spawn resolver can start the plane over a dense city, where a
  // bright highway crossing the strip reads as a 19-20 step "band" (traced
  // 2026-07-18: toy/low maxStep 20 @y666 was a road, not the rim). Pin the
  // measurement over the pre-R9 Adirondack wilderness framing.
  await page.evaluate(() => {
    window.__fly.warpToGeo(43.8, -74.05, { altM: 900, name: null });
    window.__fly.flight.heading = 0;
  });
  await page.waitForTimeout(8000);

  for (const style of STYLES) {
    await page.evaluate((s) => window.__flyStore.getState().setMapStyle(s), style);
    await page.waitForTimeout(style === 'satellite' ? 10000 : 6000);
    for (const alt of ALTS) {
      await page.evaluate((y) => {
        window.__fly.flight.pos.y = y;
      }, alt.y);
      await page.waitForTimeout(3000);
      const file = path.join(__dirname, `rim-${style}-${alt.name}.png`);
      await page.screenshot({ path: file }); // full page — for eyeball review
      // Analysis runs on the GL canvas ONLY: traffic label chips live on
      // the DOM/LabelCanvas overlay and drifting into the strip once read
      // as a 19-step "seam" (data-conditions flake).
      const glFile = path.join(__dirname, `rim-${style}-${alt.name}-gl.png`);
      // Neon trails parallel to the horizon defeat any band detector —
      // mute the additive traffic/contrail materials (colorWrite) for the
      // measurement frame; the rim/sky/terrain is what's under test.
      await page.evaluate(() => {
        let n = window.__fly.engine.object;
        while (n.parent) n = n.parent;
        window.__scene = n;
        n.traverse((o) => {
          if (o.isMesh && o.material?.transparent && o.material.blending === 2) {
            o.material.colorWrite = false;
            o.material.__rimMuted = true;
          }
          if (o.isMesh && o.geometry?.attributes?.position?.count === 320) {
            o.material.colorWrite = false;
            o.material.__rimMuted = true;
          }
        });
      });
      await page.waitForTimeout(300);
      await page.locator('.fixed.inset-0 canvas').first().screenshot({ path: glFile });
      await page.evaluate(() => {
        window.__scene.traverse((o) => {
          if (o.isMesh && o.material?.__rimMuted) {
            o.material.colorWrite = true;
            o.material.__rimMuted = false;
          }
        });
      });
      const { maxStep, at } = await stripMaxStep(glFile);
      gate(`${style}/${alt.name} rim smooth`, maxStep <= MAX_STEP, `maxStep ${maxStep} @y${at}`);
    }
    const draws = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
    console.log(`  ${style} draws: ${draws}`);
    // Round 8 fix: toy carries shadows/monuments/fleet lights — fleet-wide
    // 480 gate (PERF_BUDGET 470 + composer slack); satellite stays at 350.
    const drawGate = style === 'toy' ? 480 : 350;
    if (draws > drawGate) fails.push(`${style} draws ${draws} > ${drawGate}`);
  }

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

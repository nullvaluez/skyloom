/**
 * R22 D — direct shader probe. Rewrites n8ao's compositer renderMode-1 branch
 * to output intermediate values, so the reversed-depth question is answered by
 * READING the shader's own reconstruction rather than by inferring it from a
 * grey frame. Diagnostic only; never shipped, never a gate.
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

if (!process.env.FLY_URL) process.exit(2);
const SHOT = (n) => path.join(__dirname, `r22-d-dbg-${n}.png`);
const CROP = { left: 340, top: 560, width: 900, height: 240 };

async function px(file) {
  const { data, info } = await sharp(file).extract(CROP).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    r += data[o];
    g += data[o + 1];
    b += data[o + 2];
  }
  return [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)];
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
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 400));
  });
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(n) });

  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flyAerialOverride = 1;
    window.__flySatShadow?.set(true);
    window.__flyDepthArm = 1;
    window.__flyDepthSub = { catcher: 0, nearReceive: 0, n8ao: 1, aerialNear: 0 };
    window.__flyN8AO?.set?.(true);
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
    window.__fly.warpToGeo(40.7549, -73.984, { altM: 300, name: null });
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.__frozen = true;
    f.step = () => {};
  });
  await page.waitForTimeout(22000);
  await page.evaluate(() => {
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
  });
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);

  const probe = (expr) =>
    page.evaluate((e) => {
      const p = window.__flyN8AO?.pass?.();
      if (!p) return 'no-pass';
      const q = p.effectCompositerQuad;
      const base = q.material.userData.__base ?? q.material.fragmentShader;
      q.material.userData.__base = base;
      const anchor =
        'gl_FragColor = vec4( mix(vec3(1.0), aoApplied, 1.0 - finalAo), sceneTexel.a);';
      if (!base.includes(anchor)) return 'anchor-missing';
      q.material.fragmentShader = base.replace(anchor, `gl_FragColor = vec4(${e}, 1.0);`);
      q.material.needsUpdate = true;
      p.setDisplayMode('AO');
      p.firstFrame();
      return 'ok';
    }, expr);

  // BINARY probes only: 0 and 1 survive the grade + ACES tone map intact
  // (0 -> 0, 1 -> 226.89 as measured), so the readback is unambiguous. Any
  // continuous value would arrive through three non-linear stages.
  const legs = [
    ['early', 'vec3(float(depth == 1.0), float(depth > 0.999999), float(depth > 0.99))'],
    ['rawnz', 'vec3(step(1e-7, texture2D(sceneDepth, vUv).x), step(1e-4, texture2D(sceneDepth, vUv).x), step(0.5, texture2D(sceneDepth, vUv).x))'],
    ['viewzband', 'vec3(step(50.0, -getWorldPos(depth,vUv).z), step(500.0, -getWorldPos(depth,vUv).z), step(5000.0, -getWorldPos(depth,vUv).z))'],
    ['aobin', 'vec3(step(texel.r, 0.999), step(texel.r, 0.9), step(texel.r, 0.5))'],
    ['normbin', 'vec3(step(0.001, abs(computeNormal(getWorldPos(depth,vUv), vUv).x)), step(0.001, abs(computeNormal(getWorldPos(depth,vUv), vUv).y)), step(0.001, abs(computeNormal(getWorldPos(depth,vUv), vUv).z)))'],
  ];
  for (const [name, expr] of legs) {
    const r = await probe(expr);
    await page.waitForTimeout(1300);
    await glShot(name);
    console.log(name.padEnd(9), r, JSON.stringify(await px(SHOT(name))));
  }
  console.log('errs', errs.length, errs.slice(0, 4));
  await browser.close();
})();

/**
 * ROUND 22 (D "DEPTH") — the reversed-depth PROOF for N8AO.
 *
 * Rule 5 of the charter: "verify its depth sampling and depth-linearization
 * behave with reversed depth; record HOW you proved it." A screenshot of the
 * composited frame cannot prove it — AO is a subtle multiply and a broken AO
 * buffer that happens to come out near-white looks exactly like a correct one
 * that found little occlusion. So the proof is run on n8ao's OWN AO-only debug
 * view (`setDisplayMode('AO')`, renderMode 1: the raw occlusion buffer, no
 * scene colour at all) as a THREE-WAY control at ONE frozen pose:
 *
 *   A  SHIPPED   DepthType.Reverse + the conventional-projection proxy camera.
 *   B  RED-1     DepthType.Default (what stock n8ao configures itself as on
 *                this canvas, because its auto-detect reads a property three
 *                r185 does not have) — everything else identical.
 *   C  RED-2     DepthType.Reverse but the camera's REVERSE-Z projection
 *                matrix restored — i.e. the flip without the proxy. This is
 *                the leg that isolates defect (2) from defect (1).
 *
 * A correct AO buffer has structure: a real spread of values, with dark pixels
 * in the creases between buildings. Both broken configurations collapse it —
 * either to a flat field (no occlusion found anywhere) or to high-variance
 * noise unrelated to the geometry. The printed statistics are mean luma, the
 * standard deviation, and the fraction of pixels below 0.75 of white ("dark
 * fraction"); the PNGs are kept beside them so the read is not only numeric.
 *
 * Usage: FLY_URL=http://localhost:3223 node scripts/r22-d-reversed-proof.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

if (!process.env.FLY_URL) {
  console.error('FLY_URL is required (never default to :3000 — the live server)');
  process.exit(2);
}

const SHOT = (n) => path.join(__dirname, `r22-d-ao-${n}.png`);
// HUD-FREE crop: the contracts panel, the traffic labels and the hint bar
// are DOM overlays that Playwright's element screenshot includes, and they
// would put fixed dark pixels into every leg's statistics.
const CROP = { left: 340, top: 560, width: 900, height: 240 };

async function lumaStats(file) {
  const { data, info } = await sharp(file)
    .extract(CROP)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let sum = 0;
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    vals[i] = l;
    sum += l;
  }
  const mean = sum / n;
  let v = 0;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    const d = vals[i] - mean;
    v += d * d;
    if (vals[i] < 191) dark++; // < 0.75 * 255
  }
  return {
    mean: +mean.toFixed(2),
    sd: +Math.sqrt(v / n).toFixed(2),
    darkFrac: +(dark / n).toFixed(4),
  };
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
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flyAerialOverride = 1;
    window.__flySatShadow?.set(true);
    window.__flyDepthArm = 1;
    window.__flyDepthSub = { catcher: 0, nearReceive: 0, n8ao: 1, aerialNear: 0 };
    window.__flyN8AO?.set?.(true);
  });
  // Manhattan midtown at 260 m MSL — roughly 240 m AGL, i.e. INSIDE the tower
  // field. Altitude is the whole ballgame for this proof: at the 900 m the
  // first draft used, a 24 m AO radius subtends almost nothing and even a
  // perfectly correct buffer comes out flat, which discriminates nothing.
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
    window.__fly.warpToGeo(40.7549, -73.984, { altM: 300, name: null });
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const f = window.__fly.flight;
    f.__frozen = true;
    f.step = () => {};
  });
  await page.waitForTimeout(24000);
  await page.evaluate(() => {
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
  });
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1200);

  const cfg = (mode) =>
    page.evaluate((m) => {
      const p = window.__flyN8AO?.pass?.();
      if (!p) return 'no-pass';
      const DT = { Default: 1, Reverse: 3 };
      const cam = p.camera;
      // The shipped pass re-asserts the conventional projection EVERY frame
      // (that is the fix). To hold a RED leg still, the enforcement is parked
      // for the duration of that leg and restored for the shipped one.
      if (!p.__syncBak) p.__syncBak = p._syncProxy;
      p._syncProxy = m === 'shipped' ? p.__syncBak : function () {};
      if (m === 'shipped') {
        cam._reversedDepth = false;
        cam.updateProjectionMatrix();
        p.configuration.depthBufferType = DT.Reverse;
        p.configureAOPass(DT.Reverse, false);
        p.configureDenoisePass(DT.Reverse, false);
        p.configureEffectCompositer(DT.Reverse, false);
      } else if (m === 'red-default') {
        cam._reversedDepth = false;
        cam.updateProjectionMatrix();
        p.configuration.depthBufferType = DT.Default;
        p.configureAOPass(DT.Default, false);
        p.configureDenoisePass(DT.Default, false);
        p.configureEffectCompositer(DT.Default, false);
      } else if (m === 'red-reversematrix') {
        // The flip WITHOUT the proxy: give n8ao the reverse-Z projection the
        // live camera actually carries.
        cam._reversedDepth = true;
        cam.updateProjectionMatrix();
        p.configuration.depthBufferType = DT.Reverse;
        p.configureAOPass(DT.Reverse, false);
        p.configureDenoisePass(DT.Reverse, false);
        p.configureEffectCompositer(DT.Reverse, false);
      }
      p.setDisplayMode('AO');
      p.firstFrame();
      return {
        depthBufferType: p.configuration.depthBufferType,
        camReversed: !!cam._reversedDepth,
        // element [10] of the projection matrix is the z-scale term: the
        // conventional and reverse-Z matrices differ there by construction.
        projZ: +cam.projectionMatrix.elements[10].toFixed(6),
      };
    }, mode);

  const out = {};
  for (const m of ['shipped', 'red-default', 'red-reversematrix']) {
    const c = await cfg(m);
    await page.waitForTimeout(1400);
    await glShot(m);
    const s = await lumaStats(SHOT(m));
    out[m] = { cfg: c, ...s };
    console.log(`${m.padEnd(20)} cfg=${JSON.stringify(c)} -> ${JSON.stringify(s)}`);
  }

  // Restore the shipped configuration + the combined view before leaving.
  await cfg('shipped');
  await page.evaluate(() => window.__flyN8AO?.pass?.()?.setDisplayMode('Combined'));
  await page.waitForTimeout(1200);
  await glShot('combined');

  out.pageerrors = errs;
  fs.writeFileSync(path.join(__dirname, 'r22-d-ao-proof.json'), JSON.stringify(out, null, 2));
  console.log('pageerrors', errs.length);
  await browser.close();
})();

/**
 * R22 D — direct render-target readback. The earlier probe wrote its values
 * into the frame, which meant reading them THROUGH bloom, the satellite grade
 * and the ACES tone map — three non-linear stages that mangle a binary field
 * and mix channels. This reads n8ao's own internal targets with
 * gl.readRenderTargetPixels instead, so the numbers are the shader's actual
 * output. Diagnostic only.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

if (!process.env.FLY_URL) process.exit(2);

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

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
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1500);

  const read = await page.evaluate(() => {
    const p = window.__flyN8AO?.pass?.();
    const gl = window.__flyComposer?.renderer;
    if (!p || !gl) return 'no-pass';
    const out = {};
    const grid = [];
    // Half-res target coordinates: sample a 5x3 lattice over the lower half of
    // the frame, where the buildings are.
    const W = Math.floor(p.width / 2);
    const H = Math.floor(p.height / 2);
    for (let gy = 1; gy <= 3; gy++)
      for (let gx = 1; gx <= 5; gx++)
        grid.push([Math.floor((gx * W) / 6), Math.floor((gy * H) / 8)]);

    // (1) the depth the AO shader reads (RedFormat/FloatType, texture 0 of the
    //     downsample MRT).
    try {
      const buf = new Float32Array(4);
      out.downsampleDepth = grid.map(([x, y]) => {
        gl.readRenderTargetPixels(p.depthDownsampleTarget, x, y, 1, 1, buf, 0, 0);
        return +buf[0].toFixed(7);
      });
    } catch (e) {
      out.downsampleDepthErr = String(e.message);
    }
    // (2) the normal buffer (texture 1). HalfFloatType, so the readback array
    //     MUST be Uint16Array — handing three a Float32Array for a half-float
    //     attachment returns zeros with no error, which reads exactly like a
    //     broken normal buffer. (An instrument can indict what it merely failed
    //     to decode — R19 lesson 6, in a new costume.)
    try {
      const h = new Uint16Array(4);
      const half2f = (u) => {
        const s = (u & 0x8000) ? -1 : 1;
        const e = (u >> 10) & 0x1f;
        const m = u & 0x3ff;
        if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
        if (e === 31) return m ? NaN : s * Infinity;
        return s * Math.pow(2, e - 15) * (1 + m / 1024);
      };
      out.normal = grid.map(([x, y]) => {
        gl.readRenderTargetPixels(p.depthDownsampleTarget, x, y, 1, 1, h, 0, 1);
        return [+half2f(h[0]).toFixed(3), +half2f(h[1]).toFixed(3), +half2f(h[2]).toFixed(3)];
      });
      out.normalLen = out.normal.map((n) =>
        +Math.hypot(n[0], n[1], n[2]).toFixed(3)
      );
    } catch (e) {
      out.normalErr = String(e.message);
    }
    // (3) the AO result after the blur.
    try {
      const buf = new Uint8Array(4);
      out.ao = grid.map(([x, y]) => {
        gl.readRenderTargetPixels(p.writeTargetInternal, x, y, 1, 1, buf);
        return buf[0];
      });
    } catch (e) {
      out.aoErr = String(e.message);
    }
    out.cfg = {
      halfRes: p.configuration.halfRes,
      dbt: p.configuration.depthBufferType,
      aoRadius: p.configuration.aoRadius,
      near: p.camera.near,
      far: p.camera.far,
      projZ: +p.camera.projectionMatrix.elements[10].toFixed(7),
      w: p.width,
      h: p.height,
    };
    out.agl = Math.round(window.__fly.flight.agl);
    return out;
  });
  console.log(JSON.stringify(read, null, 2));
  console.log('errs', errs.length, errs.slice(0, 3));
  await browser.close();
})();

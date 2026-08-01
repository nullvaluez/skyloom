/**
 * R19 — is verify-sat-night's "SUN DRIVES UNIFORMS ONLY" gate measuring the
 * road layer, or the scene's own breathing?
 *
 * The gate compares layerDraws = onDraws - offDraws between the night leg and
 * the noon leg and demands EXACT equality. Both terms are SCENE TOTALS sampled
 * 2.5 s apart in a live-traffic scene, so the gate is a difference of four
 * breathing numbers tested for exact equality. This repeats the measurement N
 * times per lighting state and prints the distribution, plus the road layer's
 * own mesh census (which cannot breathe).
 *
 * MEASURED on main 414a392 (800 m, streaming, i.e. noisier than the harness's
 * settled pose): census meshes=16 visible=16 at BOTH night and noon - the
 * layer's cost IS identical, as claimed - while layerDraws came out
 * NIGHT [15, 11, 14, 18] and NOON [-3, 5, -16, 15]. Negative "layer draws" is
 * the instrument confessing. Three consecutive verify-sat-night runs on the
 * settled pose gave night/day 6/5 (FAIL), 5/6 (FAIL), 5/5 (PASS): the sign
 * flips, so it is noise and not a directional regression.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const NIGHT_MS = Date.UTC(2026, 6, 18, 4, 0, 0);
const NOON_MS = Date.UTC(2026, 6, 17, 17, 0, 0);
const ROUNDS = 4;

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));

  const draws = () => page.evaluate(() => window.__flyStats?.drawCalls ?? -1);
  const census = () =>
    page.evaluate(() => {
      let meshes = 0;
      let visible = 0;
      window.__satRoads?.object.traverse((o) => {
        if (!o.isMesh) return;
        meshes += 1;
        if (o.visible && (o.material?.visible ?? true)) visible += 1;
      });
      return { meshes, visible, ready: window.__flyStats?.satRoads?.ready ?? -1 };
    });
  const setForeground = (v) =>
    page.evaluate((vis) => {
      if (window.__flyPlayer) window.__flyPlayer.visible = vis;
      let scene = window.__flyPlayer ?? window.__satRoads?.object ?? null;
      while (scene && scene.parent) scene = scene.parent;
      scene?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
          o.visible = vis;
      });
    }, v);

  for (const [label, ms] of [
    ['NIGHT', NIGHT_MS],
    ['NOON', NOON_MS],
  ]) {
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, ms);
    await page.evaluate(() => {
      window.__fly.warpToGeo(40.7075, -74.0113, { altM: 800, name: null });
    });
    await page.waitForTimeout(26000);
    await setForeground(false);
    const c = await census();
    const deltas = [];
    for (let i = 0; i < ROUNDS; i++) {
      await page.evaluate(() => {
        window.__satRoads?.object.traverse((o) => {
          if (o.isMesh) o.visible = false;
        });
      });
      await page.waitForTimeout(2500);
      const off = await draws();
      await page.evaluate(() => {
        window.__satRoads?.object.traverse((o) => {
          if (o.isMesh) o.visible = true;
        });
      });
      await page.waitForTimeout(2500);
      const on = await draws();
      deltas.push(on - off);
    }
    await setForeground(true);
    console.log(
      `${label}: census meshes=${c.meshes} visible=${c.visible} ready=${c.ready} | layerDraws over ${ROUNDS} rounds = [${deltas.join(', ')}]`
    );
  }
  await browser.close();
})();

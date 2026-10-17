/* Focused rendered motion diagnosis. Uses real held-key walking; no eye writes.
 * Captured frames and optional forced quality transitions are diagnostic only,
 * never substituted for the normal performance/soak gate.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { installLoungeWebGLProbe } = require('./lounge-webgl-probe.cjs');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const out = path.resolve(arg('out', `.graphics-review/living-observatory/motion-${Date.now()}`));
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), purpose: 'Motion/depth and shader diagnostics; screenshot work affects frame timing', source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), errors: [], consoleErrors: [], routes: [], frames: [], transitions: [], sunUtc: Date.UTC(2026, 9, 17, 19, 43) };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
(async () => {
  let browser, page, walk, space;
  const state = () => page.evaluate(() => {
    const r = window.__fly, w = r.airportWatch;
    let scene = r.engine.object; while (scene.parent) scene = scene.parent;
    const gl = scene.__r3f.root.getState().gl;
    return { at: performance.now(), eye: { ...w.eyeLocal }, floorId: w.walk.floorId, posture: w.posture, yaw: w.yaw, pitch: w.pitch, tier: window.__flyStore.getState().qualityTier, csm: r.cinemaShadows, room: r.loungeStats, programs: gl.info.programs.length, frame: window.__flyStats.frame.sample() };
  });
  const mark = (value) => page.evaluate((value) => window.__loungeWebGL.mark(value), value);
  const screenshot = async (name) => { const file = name + '.png'; await page.screenshot({ path: path.join(out, file), timeout: 120000 }); report.frames.push({ file, ...(await state()) }); save(); };
  const walkTo = async (target, name) => {
    const start = await state();
    const points = walk.findPath(space, { ...start.eye, floorId: start.floorId }, target);
    if (!points) throw new Error('No real walking route: ' + name);
    await page.getByTestId('lounge-surface').focus();
    await page.evaluate((points) => {
      const w = window.__fly.airportWatch, d = window.__motionRoute = { done: false, i: 1, points };
      const tick = () => {
        while (d.i < points.length && Math.hypot(points[d.i].x - w.eyeLocal.x, points[d.i].z - w.eyeLocal.z) < .085) d.i++;
        if (d.i === points.length) { d.done = true; w.setMoveKeys(0, 0, false); return; }
        w.yaw = Math.atan2(-(points[d.i].x - w.eyeLocal.x), -(points[d.i].z - w.eyeLocal.z)); w.pitch = -.06;
        d.raf = requestAnimationFrame(tick);
      }; tick();
    }, points);
    await mark(name);
    try { await page.keyboard.down('w'); await page.waitForFunction(() => window.__motionRoute.done, undefined, { timeout: 120000 }); }
    finally { await page.keyboard.up('w'); await page.evaluate(() => { cancelAnimationFrame(window.__motionRoute.raf); window.__fly.airportWatch.setMoveKeys(0, 0, false); }); }
    report.routes.push({ name, start, target, points, end: await state() }); save();
  };
  const movingFrames = async (name, yaw, pitch, duration) => {
    await page.evaluate(({ yaw, pitch }) => { const w = window.__fly.airportWatch; w.yaw = yaw; w.pitch = pitch; }, { yaw, pitch });
    await page.getByTestId('lounge-surface').focus();
    await mark(name); await page.waitForTimeout(500); await screenshot(name + '-00-still');
    const start = Date.now(); let n = 1;
    try {
      await page.keyboard.down('w');
      while (Date.now() - start < duration) { await page.waitForTimeout(180); await screenshot(name + '-' + String(n++).padStart(2, '0')); }
    } finally { await page.keyboard.up('w'); }
    await page.waitForTimeout(300); await screenshot(name + '-99-still');
  };
  const tiers = async () => {
    report.controlledQualityTransitions = true;
    for (const tier of ['high', 'medium', 'low', 'high']) {
      await mark('forced-tier-' + tier);
      await page.evaluate((tier) => { window.__flyGovPin = 'hold'; window.__flyStore.setState({ qualityTier: tier }); }, tier);
      await page.waitForTimeout(2000); report.transitions.push({ requested: tier, ...(await state()) });
      await screenshot('forced-tier-' + tier + '-' + report.transitions.length);
    }
  };
  try {
    const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
    walk = await import('../lib/fly/lounge/room-walk.mjs'); space = walk.buildWalkSpace(roomBlockers('pier'), { variant: 'pier' });
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-shader-disk-cache', '--mute-audio'] });
    page = await browser.newPage({ viewport: { width: 1680, height: 1260 } });
    page.on('pageerror', (e) => { report.errors.push(e.stack || e.message); save(); });
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
    await page.addInitScript(installLoungeWebGLProbe);
    await page.addInitScript((sun) => { window.__flyVisualsOverride = 'enhanced'; window.__flySunOverride = sun; localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-controls-seen', '1'); }, report.sunUtc);
    report.url = `http://localhost:${arg('port', '3353')}/?graphicsReview=1&flags=LOUNGE_PIER,LOUNGE_INSTRUMENTS,LOUNGE_WALK`;
    const response = await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    report.servedHtmlBuild = (await response.text()).match(/\\"b\\":\\"([^"\\]+)\\"/)?.[1] ?? null;
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 120000 });
    await mark('KCMH-enter'); await page.evaluate(() => window.__fly.airportWatch.enter('KCMH'));
    await page.waitForFunction(() => window.__fly.airportWatch.validated && !window.__fly.worldLoading && window.__flyBoot?.pct === 100, undefined, { timeout: 180000 });
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(5000); report.initial = await state();
    if (arg('mode', 'motion') === 'tiers') {
      await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = Math.PI; w.pitch = -.08; });
      await tiers(); report.complete = true; return;
    }
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.clearSelection(); w.stand(); });
    await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing');
    await walkTo({ x: 0, z: 2.8, floorId: 'lower' }, 'lower-aisle');
    await walkTo({ x: -10, z: 2.8, floorId: 'lower' }, 'stair-approach');
    await movingFrames('stair-ascent', Math.PI, -.30, 6500);
    await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
    await walkTo({ x: -6, z: 10.7, floorId: 'upper' }, 'upper-start');
    await movingFrames('upper-walk', -Math.PI / 2, -.22, 4500);
    if (arg('tiers', '0') === '1') await tiers();
    await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'descent-approach');
    await movingFrames('stair-descent', 0, -.46, 6500);
    report.complete = true;
  } catch (e) { report.failure = e.stack || String(e); process.exitCode = 1; if (page) await screenshot('failure').catch(() => {}); }
  finally { if (page) report.webgl = await page.evaluate(() => window.__loungeWebGL.snapshot()).catch(() => null); save(); await browser?.close(); }
})();

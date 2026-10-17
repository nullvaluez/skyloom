/* Rendered upper-observatory review. Real room, live traffic, keyboard walking.
 * Source and production build must be frozen before running. This is visual
 * evidence, not a performance result or owner sign-off. No eye teleportation.
 * node scripts/review-observatory-upper.cjs --port 3351 --out .graphics-review/living-observatory/upper-review
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const arg = (key, fallback) => { const at = process.argv.indexOf('--' + key); return at >= 0 ? process.argv[at + 1] : fallback; };
const out = path.resolve(arg('out', `.graphics-review/living-observatory/upper-${Date.now()}`));
const url = `http://localhost:${arg('port', '3351')}/?graphicsReview=1&flags=LOUNGE_PIER,LOUNGE_INSTRUMENTS,LOUNGE_WALK`;
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), url, weather: 'baseline clear', viewport: [1920, 1080], purpose: 'Rendered visual review, no performance certification', errors: [], consoleErrors: [], captures: [], routes: [] };
report.source = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() };
report.source.files = Object.fromEntries(['lib/fly/observation-config.js', 'lib/fly/lounge/room-walk.mjs', 'lib/fly/lounge/room-build.js', 'lib/fly/lounge/room-shading.js', 'lib/fly/lounge/observatory-instruments.js', 'components/fly/hud/lounge/ObservatoryHud.jsx'].map((file) => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

(async () => {
  let browser, page, space, walk;
  const pose = () => page.evaluate(() => {
    const w = window.__fly.airportWatch;
    return { ...w.eyeLocal, floorId: w.walk.floorId, posture: w.posture, seat: w.seatId, yaw: w.yaw, pitch: w.pitch, binocular: w.binocular, mag: w.optics.mag, night: w.observatory.night, room: window.__fly.loungeStats };
  });
  const look = (yaw, pitch = -.06) => page.evaluate(({ yaw, pitch }) => { const w = window.__fly.airportWatch; w.clearSelection(); w.yaw = yaw; w.pitch = pitch; }, { yaw, pitch });
  const capture = async (name) => {
    await page.waitForTimeout(700);
    const file = name + '.png';
    await page.screenshot({ path: path.join(out, file), timeout: 30000 });
    report.captures.push({ file, pose: await pose(), sunUtc: await page.evaluate(() => window.__flySunOverride) }); save();
    console.log('CAPTURE', file);
  };
  const lighting = async (kind) => {
    await page.evaluate((kind) => { window.__flySunOverride = Date.UTC(2026, 9, 17, kind === 'night' ? 4 : 16); }, kind);
    await page.waitForTimeout(4000);
  };
  const pair = async (name) => { await lighting('day'); await capture(name + '-day'); await lighting('night'); await capture(name + '-night'); await lighting('day'); };
  const walkTo = async (goal, name) => {
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.binoculars(false); w.observatory.release(); w.clearSelection(); });
    const from = await pose();
    if (!walk.isFree(space.layers?.[goal.floorId] ?? space, goal.x, goal.z)) throw new Error(`Review target ${name} is inside a collision capsule: ${JSON.stringify(goal)}`);
    const points = walk.findPath(space, from, goal);
    if (!points) throw new Error(`No connected walking route ${name}: ${JSON.stringify({ from, goal })}`);
    await page.getByTestId('lounge-surface').focus();
    await page.evaluate((points) => {
      const w = window.__fly.airportWatch;
      const r = window.__upperRoute = { index: 1, done: false, points, samples: [] };
      let lastSample = 0;
      const steer = (time) => {
        const p = w.eyeLocal;
        if (time - lastSample > 100) { r.samples.push({ x: p.x, y: p.y, z: p.z, floorId: w.walk.floorId }); lastSample = time; }
        while (r.index < points.length && Math.hypot(points[r.index].x - p.x, points[r.index].z - p.z) < .085) r.index++;
        if (r.index >= points.length) { r.done = true; w.setMoveKeys(0, 0, false); return; }
        const target = points[r.index]; w.yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z)); w.pitch = -.06;
        r.raf = requestAnimationFrame(steer);
      };
      r.raf = requestAnimationFrame(steer);
    }, points);
    try {
      await page.keyboard.down('w');
      await page.waitForFunction(() => window.__upperRoute.done, undefined, { timeout: 90000 });
    } finally {
      await page.keyboard.up('w');
      await page.evaluate(() => { cancelAnimationFrame(window.__upperRoute?.raf); window.__fly.airportWatch.setMoveKeys(0, 0, false); });
      await page.waitForTimeout(250);
      report.routes.push({ name, from, goal, ...(await page.evaluate(() => ({ done: window.__upperRoute.done, points: window.__upperRoute.points, samples: window.__upperRoute.samples }))), end: await pose() }); save();
    }
    if ((await pose()).floorId !== goal.floorId) throw new Error(`Wrong floor at ${name}`);
  };
  const stand = async () => {
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.binoculars(false); w.observatory.release(); w.stand(); });
    await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing', undefined, { timeout: 45000 });
  };
  const sit = async (id) => {
    await page.evaluate((id) => window.__fly.airportWatch.sit(id), id);
    await page.waitForFunction((id) => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === id; }, id, { timeout: 90000 });
  };
  const instrument = async (id, approach, name) => {
    await walkTo(approach, name);
    await page.evaluate((id) => { const w = window.__fly.airportWatch, s = w.observatory.snapshot().stations.find((s) => s.id === id); const p = s.position, e = w.eyeLocal; w.yaw = Math.atan2(-(p[0] - e.x), -(p[2] - e.z)); w.pitch = Math.atan2(p[1] - e.y, Math.hypot(p[0] - e.x, p[2] - e.z)); }, id);
    await capture(name + '-physical');
    await page.evaluate((id) => window.__fly.airportWatch.observatory.activate(id, { remote: true }), id);
    await capture(name + '-hud');
    await page.evaluate(() => window.__fly.airportWatch.observatory.release());
    await page.getByTestId('observatory-panel').waitFor({ state: 'hidden' });
  };
  try {
    const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
    walk = await import('../lib/fly/lounge/room-walk.mjs');
    space = walk.buildWalkSpace(roomBlockers('pier'), { variant: 'pier' });
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => { report.errors.push(e.stack || e.message); save(); });
    page.on('console', (m) => { if (m.type() === 'error') { report.consoleErrors.push(m.text()); save(); } });
    await page.addInitScript(() => {
      window.__flyVisualsOverride = 'enhanced'; window.__flyGovPin = 'hold';
      window.__flySunOverride = Date.UTC(2026, 9, 17, 16); window.__flyWeatherOverride = 'baseline';
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-reduced-motion', '1');
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 120000 });
    await page.evaluate(() => window.__fly.airportWatch.enter('KCMH'));
    await page.waitForFunction(() => window.__fly.airportWatch.validated && !window.__fly.worldLoading && window.__flyBoot?.pct === 100, undefined, { timeout: 180000 });
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(10000);
    const buildIdFile = path.resolve('.next-observatory-upper/BUILD_ID');
    report.buildId = fs.existsSync(buildIdFile) ? fs.readFileSync(buildIdFile, 'utf8').trim() : null;
    report.renderer = await page.evaluate(() => { let scene = window.__fly.engine.object; while (scene.parent) scene = scene.parent; const gl = scene.__r3f.root.getState().gl.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
    report.initial = await pose(); save();
    if (report.errors.length || report.consoleErrors.some((s) => /shader error|validate_status|gl_invalid|program link/i.test(s))) throw new Error('Page or shader errors on initial upper-room rendering');
    await capture('lower-front-initial');
    if (arg('mode', '') === 'hud') {
      await stand();
      await instrument('airport-table', { x: 4.4, z: 5.2, floorId: 'lower' }, 'airport-table');
      await page.getByTestId('observatory-open').click();
      await page.waitForFunction(() => window.__fly.airportWatch.observatory.snapshot().active === 'airport-table');
      await page.locator('.observatory-contact-list button').first().waitFor({ timeout: 45000 });
      report.selectedLabel = await page.locator('.observatory-contact-list button').first().innerText();
      await page.locator('.observatory-contact-list button').first().click();
      await capture('airport-map-selected-1920');
      await page.setViewportSize({ width: 1280, height: 720 });
      const dimensions = () => page.getByTestId('observatory-panel').evaluate((el) => {
        const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const list = el.querySelector('.observatory-contact-list'), cta = el.querySelector('.observatory-selection .observatory-action');
        return { panel: box(el), panelScrollTop: el.scrollTop, panelScrollHeight: el.scrollHeight, panelClientHeight: el.clientHeight, list: box(list), listScrollHeight: list.scrollHeight, listClientHeight: list.clientHeight, cta: cta ? box(cta) : null, viewport: { width: innerWidth, height: innerHeight } };
      });
      await page.waitForTimeout(500); report.compactBeforeScroll = await dimensions(); save();
      await capture('airport-map-selected-1280');
      const action = page.getByRole('button', { name: 'Show me the direction', exact: true });
      await action.scrollIntoViewIfNeeded();
      report.compactAfterScroll = await dimensions(); save();
      await capture('airport-map-selected-1280-scrolled');
      await action.click(); await capture('airport-map-direction-cue');
      report.complete = true; report.checks = { noPageErrors: report.errors.length === 0 }; save();
      return;
    }
    await stand();
    await walkTo({ x: 0, z: 2.8, floorId: 'lower' }, 'lower-aisle');
    await look(Math.PI, .07); await pair('lower-room');
    await look(Math.PI, .35); await capture('lower-room-ceiling');
    await walkTo({ x: -10, z: 2.8, floorId: 'lower' }, 'stair-approach');
    await look(Math.PI, .22); await pair('stair-approach');
    await walkTo({ x: -10, z: 7.4, floorId: 'stairs' }, 'stair-midpoint');
    await look(Math.PI, .16); await capture('stair-midpoint-day');
    await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'upper-landing');
    await look(-Math.PI / 2, -.04); await pair('upper-landing');
    await walkTo({ x: -7.5, z: 11.9, floorId: 'upper' }, 'upper-room');
    await look(-Math.PI / 2, -.04); await pair('upper-room');
    await walkTo({ x: 0, z: 9.3, floorId: 'upper' }, 'upper-front-standing');
    await look(0, -.08); await pair('upper-front-standing');
    await sit('upper-front'); await pair('upper-front');
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.binoculars(true, { acquire: false }); w.setMagnification(25); });
    await capture('upper-front-binocular-25x');
    await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
    await sit('upper-back'); await pair('upper-rear');
    await stand();
    await walkTo({ x: 0, z: 10.7, floorId: 'upper' }, 'upper-centre');
    await look(Math.PI / 2, -.08); await lighting('night');
    await capture('upper-night-normal');
    await page.getByTestId('observatory-lighting').click(); await capture('upper-night-dim');
    await page.getByTestId('observatory-lighting').click(); await lighting('day');
    await walkTo({ x: -10, z: 11.9, floorId: 'upper' }, 'descent-landing');
    await look(0, -.4); await capture('stair-descent');
    await walkTo({ x: -10, z: 2.8, floorId: 'lower' }, 'lower-return');
    await instrument('front-listen', { x: -2.2, z: .45, floorId: 'lower' }, 'listening-window');
    await instrument('front-compass', { x: 6.8, z: .45, floorId: 'lower' }, 'window-compass');
    await walkTo({ x: 6.2, z: .45, floorId: 'lower' }, 'window-compass-oblique');
    await page.evaluate(() => { const w = window.__fly.airportWatch, p = [6.8, .96, -.83], e = w.eyeLocal; w.yaw = Math.atan2(-(p[0] - e.x), -(p[2] - e.z)); w.pitch = Math.atan2(p[1] - e.y, Math.hypot(p[0] - e.x, p[2] - e.z)); });
    await capture('window-compass-stem-oblique');
    await instrument('airport-table', { x: 4.4, z: 5.2, floorId: 'lower' }, 'airport-table');
    await page.getByTestId('observatory-open').click(); await capture('airport-map-hud');
    await page.setViewportSize({ width: 1280, height: 720 }); await capture('airport-map-hud-1280');
    await page.setViewportSize({ width: 1920, height: 1080 });
    report.final = await pose();
    report.checks = { noPageErrors: report.errors.length === 0, noShaderErrors: !report.consoleErrors.some((s) => /shader error|validate_status|gl_invalid|program link/i.test(s)), routesComplete: report.routes.every((r) => r.done && r.goal.floorId === r.end.floorId), actualStairAscent: report.routes.some((r) => r.samples.some((p) => p.floorId === 'stairs' && p.y > 2 && p.y < 6)) };
    report.complete = true; save();
    if (Object.values(report.checks).some((v) => !v)) process.exitCode = 1;
  } catch (e) {
    report.failure = e.stack || String(e); process.exitCode = 1; console.error(e);
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  } finally { save(); await browser?.close(); }
})();

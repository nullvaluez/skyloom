/* Living Observatory hardware review. Fresh Chrome profile for every run.
 *
 * node scripts/review-living-observatory.cjs --port 3347 --airport KCMH --mode cold
 * node scripts/review-living-observatory.cjs --port 3347 --airport YSSY --mode soak --minutes 20
 * node scripts/review-living-observatory.cjs --port 3347 --airports KCMH,KJFK,LOWI,EGLL,YSSY --mode views --lighting day
 * node scripts/review-living-observatory.cjs --port 3347 --airports KCMH,KJFK,LOWI,EGLL,YSSY --mode views --lighting night
 *
 * Use --flags=-LOUNGE_PIER,-LOUNGE_INSTRUMENTS for the baseline, and the same
 * browser/build/UTC/viewport for matched measurements. Do not run another GPU
 * benchmark concurrently. The trace never disables shader checks, changes
 * readiness or subtracts long frames. A trace is diagnostic, not a visual
 * owner sign-off or proof of smooth presentation on a physical display.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { installLoungeWebGLProbe } = require('./lounge-webgl-probe.cjs');

const arg = (name, fallback) => {
  const key = '--' + name, inline = process.argv.find((v) => v.startsWith(key + '='));
  if (inline) return inline.slice(key.length + 1);
  const at = process.argv.indexOf(key);
  return at >= 0 && process.argv[at + 1] != null ? process.argv[at + 1] : fallback;
};
const mode = arg('mode', 'cold');
const minutes = Number(arg('minutes', mode === 'soak' ? '20' : '3'));
if (!['cold', 'soak', 'views'].includes(mode)) throw new Error('mode must be cold, soak or views');
if (!(minutes >= 0.5 && minutes <= 30)) throw new Error('minutes must be between 0.5 and 30');
const airports = arg('airports', arg('airport', 'KCMH')).split(',');
const flags = arg('flags', 'LOUNGE_PIER,LOUNGE_INSTRUMENTS');
const utc = arg('utc', '');
const lighting = arg('lighting', '');
if (lighting && !['day', 'night'].includes(lighting)) throw new Error('lighting must be day or night');
const localReviewHours = { day: { KCMH: 16, KJFK: 16, LOWI: 12, EGLL: 12, YSSY: 4 }, night: { KCMH: 4, KJFK: 4, LOWI: 22, EGLL: 22, YSSY: 14 } };
const reviewHour = (airport) => lighting ? localReviewHours[lighting][airport] : utc;
if (lighting && airports.some((id) => reviewHour(id) == null)) throw new Error('No local solar review hour for one of the requested airports');
const out = path.resolve(arg('out', `.graphics-review/living-observatory/${mode}-${airports.join('-')}-${Date.now()}`));
const url = new URL(arg('url', `http://localhost:${arg('port', '3347')}/`));
url.searchParams.set('graphicsReview', '1');
url.searchParams.set('diag', '1');
url.searchParams.set('flags', flags);
fs.mkdirSync(out, { recursive: true });
const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] : null;
const summary = (values) => ({ count: values.length, p50: quantile(values, .5), p95: quantile(values, .95), p99: quantile(values, .99), max: values.length ? values.reduce((a, b) => Math.max(a, b), 0) : null, over100: values.filter((v) => v > 100).length, over1000: values.filter((v) => v > 1000).length });
const report = { at: new Date().toISOString(), mode, minutes, airports, flags, utc, lighting, url: url.toString(), viewport: [1920, 1080], coldShaderDiskCache: true, entryMethod: arg('entry', 'ui'), errors: [], errorCount: 0, hotReloads: [], consoleErrors: [], responses: {}, visits: [], samples: [], shots: [], events: [] };
const save = (file = 'progress.json') => fs.writeFileSync(path.join(out, file), JSON.stringify(report, null, 2));

(async () => {
  let browser, context, page, cpu;
  let walkModule, walkGrids;
  let progress = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - progress <= 240000) return;
    report.failure = 'No harness progress for four minutes';
    save('report.json');
    browser?.close().catch(() => {});
  }, 10000);
  const mark = async (phase) => {
    report.events.push({ phase, wall: new Date().toISOString() });
    await page.evaluate((value) => window.__loungeWebGL.mark(value), phase);
    save();
  };
  const screenshot = async (name) => {
    const file = name + '.png';
    await page.screenshot({ path: path.join(out, file), timeout: 30000 });
    report.shots.push(file);
  };
  const sample = async () => {
    const row = await page.evaluate(() => {
      window.__loungeWebGL.annotate();
      const r = window.__fly, w = r?.airportWatch, s = window.__flyStore?.getState(), stats = window.__flyStats, info = window.__flyGl?.info;
      const frame = stats?.frame?.sample?.();
      return {
        at: performance.now(), airport: w?.airport?.id, phase: window.__loungeWebGL.phase,
        active: w?.active, validated: w?.validated, loading: r?.worldLoading, posture: w?.posture, seat: w?.seatId,
        variant: w?.site?.variant, source: w?.site?.source, eye: w?.eyeLocal && { ...w.eyeLocal },
        walkSpeed: w?.walk?.speed, clearance: w?.walk && w.posture === 'standing' ? w.walk.clearance() : null,
        binocular: w?.binocular, mag: w?.optics?.mag, selected: w?.selected, tracked: w?.tracking,
        traffic: { count: r?.traffic?.tracks?.size, state: r?.trafficStatus?.state },
        tier: s?.qualityTier, frame, room: r?.loungeStats,
        calls: stats?.diag?.calls ?? info?.render?.calls, triangles: stats?.diag?.triangles ?? info?.render?.triangles,
        programs: info?.programs?.length ?? frame?.programs, geometries: info?.memory?.geometries ?? frame?.geometries, textures: info?.memory?.textures ?? frame?.textures,
        heap: performance.memory?.usedJSHeapSize ?? null, hidden: document.hidden,
        shaderStalls: window.__loungeWebGL.slow.length, frameGaps: window.__loungeWebGL.frameGaps.length,
        latestShaderStalls: window.__loungeWebGL.slow.slice(-4),
      };
    });
    report.samples.push(row);
    progress = Date.now();
    save();
    if (!row.active) throw new Error('Observation runtime disappeared during review (check HMR or runtime errors); performance evidence is invalid');
    return row;
  };
  const dwell = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await page.waitForTimeout(Math.min(5000, until - Date.now()));
      await sample();
    }
  };
  const crossRoom = async (airport, cycle) => {
    await mark(`${airport}:${cycle}:continuous-route`);
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.binoculars(false); w.clearSelection(); w.sit('window'); });
    await page.waitForFunction(() => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === 'window'; }, undefined, { timeout: 45000 });
    await page.evaluate(() => window.__fly.airportWatch.stand());
    await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing', undefined, { timeout: 30000 });
    await page.getByTestId('lounge-surface').focus();
    const start = await page.evaluate(() => { const w = window.__fly.airportWatch; return { x: w.eyeLocal.x, z: w.eyeLocal.z, variant: w.site.variant }; });
    const grid = walkGrids.get(start.variant);
    // A real round trip through the centre aisle. Both segments use the same
    // A* collision geometry as seating, with an extra 9 cm turning clearance.
    // Only keyboard motion moves the eye; never assign its position.
    for (const [side, target] of [['rear', { x: 0, z: start.variant === 'pier' ? 11.7 : 9.8 }], ['front', { x: start.x, z: start.z }]]) {
      const from = await page.evaluate(() => ({ ...window.__fly.airportWatch.eyeLocal }));
      const route = walkModule.findPath(grid, from, target);
      if (!route) throw new Error(`No continuous walking path to ${side} in ${start.variant}`);
      await page.evaluate((points) => {
        const w = window.__fly.airportWatch;
        const drive = window.__loungeRoute = { index: 1, done: false, points, travelled: 0, previous: { ...w.eyeLocal }, minClearance: Infinity };
        const steer = () => {
          const eye = w.eyeLocal;
          drive.travelled += Math.hypot(eye.x - drive.previous.x, eye.z - drive.previous.z);
          drive.previous = { ...eye };
          drive.minClearance = Math.min(drive.minClearance, w.walk.clearance());
          while (drive.index < points.length && Math.hypot(points[drive.index].x - eye.x, points[drive.index].z - eye.z) < .045) drive.index++;
          if (drive.index >= points.length) { drive.done = true; w.setMoveKeys(0, 0, false); return; }
          const p = points[drive.index];
          w.yaw = Math.atan2(-(p.x - eye.x), -(p.z - eye.z)); w.pitch = -.06;
          drive.raf = requestAnimationFrame(steer);
        };
        steer();
      }, route);
      try {
        await page.keyboard.down('w');
        await page.waitForFunction(() => window.__loungeRoute.done, undefined, { timeout: 60000 });
      } finally {
        await page.keyboard.up('w');
        await page.evaluate(() => { cancelAnimationFrame(window.__loungeRoute?.raf); window.__fly.airportWatch.setMoveKeys(0, 0, false); });
      }
      const result = await page.evaluate(() => { const p = window.__loungeRoute; return { done: p.done, travelled: p.travelled, minClearance: p.minClearance, eye: { ...window.__fly.airportWatch.eyeLocal } }; });
      (report.visits.at(-1).routes ??= []).push({ cycle, side, ...result });
      await sample();
      await page.evaluate((rear) => { const w = window.__fly.airportWatch; w.yaw = rear ? Math.PI : 0; w.pitch = -.06; }, side === 'rear');
      await dwell(1000);
      if (cycle === 0) await screenshot(`${airport}-continuous-${side}`);
    }
  };
  try {
    if (mode !== 'cold') {
      const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
      walkModule = await import('../lib/fly/lounge/room-walk.mjs');
      walkGrids = new Map(['classic', 'pier'].map((variant) => [variant, walkModule.buildWalkGrid(roomBlockers(variant), { radiusM: .34 })]));
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-shader-disk-cache'] });
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await context.addInitScript(installLoungeWebGLProbe);
    await context.addInitScript((hour) => {
      window.__flyVisualsOverride = 'enhanced';
      if (hour !== '') { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(hour)); }
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
    }, reviewHour(airports[0]));
    page = await context.newPage();
    page.setDefaultTimeout(240000);
    page.on('pageerror', (error) => { report.errorCount++; if (report.errors.length < 100) report.errors.push({ at: Date.now(), message: error.message, stack: error.stack?.slice(0, 1800) }); });
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && report.consoleErrors.length < 100) report.consoleErrors.push(text.slice(0, 800));
      if (/\[Fast Refresh\]/.test(text) && report.hotReloads.length < 100) report.hotReloads.push({ at: Date.now(), message: text.slice(0, 500) });
    });
    page.on('response', (response) => { const u = new URL(response.url()); if (u.origin !== url.origin) { const key = u.hostname + ':' + response.status(); report.responses[key] = (report.responses[key] ?? 0) + 1; } });
    if (arg('cpu', '0') === '1') {
      cpu = await context.newCDPSession(page);
      await cpu.send('Profiler.enable');
      await cpu.send('Profiler.start');
    }
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.airportWatch, undefined, { timeout: 240000 });
    report.renderer = await page.evaluate(() => {
      const gl = window.__loungeWebGL.context, ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), parallelShaderCompile: !!gl.getExtension('KHR_parallel_shader_compile'), checkShaderErrors: window.__flyGl?.debug.checkShaderErrors ?? null };
    });
    if (/swiftshader|llvmpipe|software/i.test(report.renderer.renderer)) throw new Error('A software renderer cannot certify this hardware route');
    report.browserVersion = browser.version();
    console.log('REVIEW renderer', report.renderer.renderer);
    // The title deliberately exposes airport search before its background
    // world is ready. Use that real entry path: waiting for pct 100 first can
    // deadlock a fresh title without a spawn, and hides reachable cold stalls.
    // --entry runtime is available only for an explicitly labelled diagnostic.
    report.boot = await page.evaluate(() => ({ ...window.__flyBoot, at: performance.now(), prewarm: window.__fly.prewarm && { ...window.__fly.prewarm } }));
    for (const airport of airports) {
      const solarHour = reviewHour(airport);
      if (solarHour !== '') await page.evaluate((hour) => { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(hour)); }, solarHour);
      await mark(`${airport}:enter`);
      const entered = Date.now();
      if (report.entryMethod === 'ui') {
        await page.getByTestId('title-screen').getByTestId('watch-airport').click({ timeout: 30000 });
        await page.locator('#airport-search').fill(airport, { timeout: 30000 });
        await page.getByTestId(`airport-result-${airport}`).locator('.ab-watch').click({ timeout: 30000 });
      } else await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
      await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
      report.visits.push({ airport, utc: solarHour, readyMs: Date.now() - entered });
      await page.evaluate(() => {
        const trace = window.__loungeReviewFrames = { values: [], distanceM: 0, binocularFrames: 0, standingFrames: 0, lastCount: null, eye: null };
        const tick = () => {
          const w = window.__fly.airportWatch, frame = window.__flyStats?.frame;
          if (w?.active && w.validated && !document.hidden) {
            // BudgetFramePump renders at 60 Hz even when headless Chrome's
            // rAF runs faster. Count actual game frames, not callback cadence.
            if (frame && frame.count !== trace.lastCount) {
              trace.values.push(frame.lastDt);
              trace.lastCount = frame.count;
            }
            if (w.binocular) trace.binocularFrames++;
            if (w.posture === 'standing') {
              trace.standingFrames++;
              if (trace.eye) trace.distanceM += Math.hypot(w.eyeLocal.x - trace.eye.x, w.eyeLocal.z - trace.eye.z);
              trace.eye = { ...w.eyeLocal };
            } else trace.eye = null;
          }
          trace.raf = requestAnimationFrame(tick);
        };
        trace.raf = requestAnimationFrame(tick);
      });
      await mark(`${airport}:first-view`);
      if (mode === 'cold') {
        await dwell(minutes * 30000);
        await screenshot(`${airport}-first-view`);
        await mark(`${airport}:first-binocular`);
        await page.evaluate(() => { const w = window.__fly.airportWatch; const row = w.snapshot().find((x) => x.inFront && x.stale === 0 && x.category !== 'ground'); if (row) w.select(row.hex); w.setMagnification(25); });
        await dwell(minutes * 30000);
        await screenshot(`${airport}-first-binocular`);
        await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
      } else {
        await dwell(10000);
        const seats = await page.evaluate(() => window.__fly.airportWatch.seats.map((s) => s.id));
        if (!seats.length) throw new Error('Walking review requires LOUNGE_WALK and at least one vantage seat');
        const begin = Date.now();
        let cycle = 0;
        do {
          await crossRoom(airport, cycle);
          for (const seat of seats) {
            if (mode === 'soak' && Date.now() - begin >= minutes * 60000) break;
            await mark(`${airport}:${cycle}:${seat}:seat`);
            await page.evaluate((id) => { const w = window.__fly.airportWatch; w.setMoveKeys(0, 0, false); w.binoculars(false); w.clearSelection(); w.sit(id); }, seat);
            await page.waitForFunction((id) => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === id; }, seat, { timeout: 45000 });
            await page.evaluate(() => window.__fly.airportWatch.resetLook());
            await dwell(4000);
            if (cycle === 0) await screenshot(`${airport}-${seat}-wide`);
            if (cycle === 0 && lighting === 'night' && ['window', 'back'].includes(seat)) {
              await page.evaluate(() => { const o = window.__fly.airportWatch.observatory; if (o && !o.night) o.toggleNight(); });
              await dwell(3000);
              await screenshot(`${airport}-${seat}-night-watch`);
              await page.evaluate(() => { const o = window.__fly.airportWatch.observatory; if (o?.night) o.toggleNight(); });
              await dwell(3000);
            }
            await mark(`${airport}:${cycle}:${seat}:walk`);
            await page.evaluate(() => window.__fly.airportWatch.stand());
            await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing', undefined, { timeout: 30000 });
            // Walk away from the chair with the real keyboard input, then look
            // across the room. Collision resolution remains entirely in-game.
            await page.getByTestId('lounge-surface').focus();
            await page.keyboard.down('s');
            await dwell(1800);
            await page.keyboard.up('s');
            await dwell(500);
            await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw += Math.PI; w.pitch = -.08; });
            await dwell(3000);
            if (cycle === 0) await screenshot(`${airport}-${seat}-standing-room`);
            await mark(`${airport}:${cycle}:${seat}:binocular`);
            await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw -= Math.PI; w.setMagnification(25); });
            await dwell(mode === 'views' ? 5000 : 12000);
            if (cycle === 0) await screenshot(`${airport}-${seat}-binocular`);
            await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
            console.log(`REVIEW ${airport} ${seat} cycle ${cycle} ${((Date.now() - begin) / 60000).toFixed(1)}m`);
          }
          cycle++;
        } while (mode === 'soak' && Date.now() - begin < minutes * 60000);
        report.visits.at(-1).exerciseMs = Date.now() - begin;
      }
      const frames = await page.evaluate(() => { const p = window.__loungeReviewFrames; cancelAnimationFrame(p.raf); return p; });
      const visit = report.visits.at(-1);
      visit.frames = summary(frames.values);
      visit.walkDistanceM = frames.distanceM;
      visit.binocularFrames = frames.binocularFrames;
      visit.standingFrames = frames.standingFrames;
      await page.evaluate(() => window.__fly.airportWatch.leave());
    }
    report.resources = Object.fromEntries(['calls', 'triangles', 'programs', 'geometries', 'textures', 'heap'].map((key) => [key, summary(report.samples.map((x) => x[key]).filter(Number.isFinite))]));
    report.residency = { first: report.samples[0], last: report.samples.at(-1) };
    report.limits = { calls: 360, triangles: 2200000, p95Frame: 20, p99Frame: 33.3 };
    report.checks = {
      noPageErrors: report.errors.length === 0,
      stableBuild: report.hotReloads.length === 0,
      frameBudget: report.visits.every((v) => v.frames.count > 1000 && v.frames.p95 <= 20 && v.frames.p99 <= 33.3),
      noMultiSecondVisibleStalls: report.visits.every((v) => v.frames.over1000 === 0),
      visibleThroughout: report.samples.every((s) => !s.hidden),
      drawBudget: report.resources.calls.max != null && report.resources.calls.max <= report.limits.calls,
      triangleBudget: report.resources.triangles.max != null && report.resources.triangles.max <= report.limits.triangles,
      binocularExercised: report.visits.every((v) => v.binocularFrames > 0),
      walkingExercised: mode === 'cold' ? null : report.visits.every((v) => v.walkDistanceM >= 2),
      continuousRoundTrip: mode === 'cold' ? null : report.visits.every((v) => v.routes?.some((r) => r.side === 'rear' && r.done && r.travelled >= 8) && v.routes.some((r) => r.side === 'front' && r.done && r.travelled >= 8)),
      twentyMinuteSoak: mode === 'soak' ? report.visits.every((v) => v.exerciseMs >= 20 * 60000) : null,
    };
    console.log('REVIEW complete', JSON.stringify({ visits: report.visits, resources: report.resources, checks: report.checks }));
    if (Object.values(report.checks).some((value) => value === false)) process.exitCode = 1;
  } catch (error) {
    report.failure = error.stack ?? String(error);
    console.error(error);
    process.exitCode = 1;
    if (page) await screenshot('failure').catch(() => {});
  } finally {
    clearInterval(watchdog);
    if (page) {
      report.webgl = await page.evaluate(() => window.__loungeWebGL?.snapshot()).catch(() => null);
      if (cpu) { const { profile } = await cpu.send('Profiler.stop').catch(() => ({})); if (profile) fs.writeFileSync(path.join(out, 'cpu-profile.json'), JSON.stringify(profile)); }
    }
    save('report.json');
    await browser?.close();
  }
})();

/* Living Observatory hardware review. Fresh Chrome profile for every run.
 *
 * node scripts/review-living-observatory.cjs --port 3347 --airport KCMH --mode cold
 * node scripts/review-living-observatory.cjs --port 3347 --airport YSSY --mode soak --minutes 20
 * node scripts/review-living-observatory.cjs --port 3347 --airport KJFK --mode views --lighting day
 * node scripts/review-living-observatory.cjs --port 3347 --airport KJFK --mode views --lighting night
 * Run separate processes for independent UI entries. A labelled runtime-entry
 * batch may use --entry runtime --airports KCMH,KJFK,LOWI,EGLL,YSSY.
 * Views only: --view-seats windows captures the four front/rear seats;
 * --night-comparison 0 omits additional Night Watch normal/dim pairs.
 * --seated-only 1 is an explicitly compact visual subset, with no new
 * continuous walking or stair-coverage claim (reuse must be documented).
 *
 * Use --flags=-LOUNGE_PIER,-LOUNGE_INSTRUMENTS for the baseline, and the same
 * browser/build/UTC/viewport for matched measurements. Do not run another GPU
 * benchmark concurrently. The trace never disables shader checks, changes
 * readiness or subtracts long frames. A trace is diagnostic, not a visual
 * owner sign-off or proof of smooth presentation on a physical display.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { installLoungeWebGLProbe } = require('./lounge-webgl-probe.cjs');

const arg = (name, fallback) => {
  const key = '--' + name, inline = process.argv.find((v) => v.startsWith(key + '='));
  if (inline) return inline.slice(key.length + 1);
  const at = process.argv.indexOf(key);
  return at >= 0 && process.argv[at + 1] != null ? process.argv[at + 1] : fallback;
};
const mode = arg('mode', 'cold');
const minutes = Number(arg('minutes', mode === 'soak' ? '20' : mode === 'probe' ? '4' : '3'));
if (!['cold', 'soak', 'views', 'probe'].includes(mode)) throw new Error('mode must be cold, soak, views or probe');
if (!(minutes >= 0.5 && minutes <= 30)) throw new Error('minutes must be between 0.5 and 30');
if (mode === 'probe' && (!(minutes >= 3 && minutes <= 5) || arg('cpu', '0') === '1')) throw new Error('The no-capture adaptive probe requires3–5minutes and no CPU profiler');
const airports = arg('airports', arg('airport', 'KCMH')).split(',');
const entryMethod = arg('entry', 'ui');
if (!['ui', 'runtime'].includes(entryMethod)) throw new Error('entry must be ui or runtime');
if (entryMethod === 'ui' && airports.length > 1) throw new Error('UI entry starts at the title; leaving the lounge returns to flight. Use one airport per fresh process, or explicitly label --entry runtime for a multi-airport diagnostic.');
const flags = arg('flags', 'LOUNGE_PIER,LOUNGE_INSTRUMENTS');
const utc = arg('utc', '');
const lighting = arg('lighting', '');
if (lighting && !['day', 'night'].includes(lighting)) throw new Error('lighting must be day or night');
const viewSeats = arg('view-seats', 'all');
const nightComparison = arg('night-comparison', '1');
const seatedOnly = arg('seated-only', '0') === '1';
const postWindowGc = arg('post-gc', '0') === '1';
if (!['all', 'windows'].includes(viewSeats)) throw new Error('view-seats must be all or windows');
if (!['0', '1'].includes(nightComparison)) throw new Error('night-comparison must be 0 or 1');
if (mode !== 'views' && (viewSeats !== 'all' || nightComparison !== '1')) throw new Error('Reduced seat or night-comparison coverage is allowed only in views mode');
if (seatedOnly && mode !== 'views') throw new Error('The compact seated visual subset is allowed only in views mode');
if (postWindowGc && mode !== 'views') throw new Error('Post-window GC is diagnostic-only and available in visual review mode');
const windowSeats = ['window', 'back', 'upper-front', 'upper-back'];
const localReviewHours = { day: { KCMH: 16, KJFK: 16, LOWI: 12, EGLL: 12, YSSY: 4 }, night: { KCMH: 4, KJFK: 4, LOWI: 22, EGLL: 22, YSSY: 14 } };
const reviewHour = (airport) => lighting ? localReviewHours[lighting][airport] : utc;
if (lighting && airports.some((id) => reviewHour(id) == null)) throw new Error('No local solar review hour for one of the requested airports');
const catalog = require('../public/data/runways/v1/index.json').runways;
const entryId = (airport) => catalog.filter((row) => row.ident === airport).sort((a, b) => (b.length || 0) - (a.length || 0))[0]?.id ?? airport;
const out = path.resolve(arg('out', `.graphics-review/living-observatory/${mode}-${airports.join('-')}-${Date.now()}`));
const url = new URL(arg('url', `http://localhost:${arg('port', '3347')}/`));
url.searchParams.set('graphicsReview', '1');
url.searchParams.set('diag', '1');
url.searchParams.set('flags', flags);
fs.mkdirSync(out, { recursive: true });
const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] : null;
const summary = (values) => ({ count: values.length, p50: quantile(values, .5), p95: quantile(values, .95), p99: quantile(values, .99), max: values.length ? values.reduce((a, b) => Math.max(a, b), 0) : null, over100: values.filter((v) => v > 100).length, over1000: values.filter((v) => v > 1000).length });
function servedBuildFromHtml(html) {
  // App Router can consume its initial __next_f array before the runtime is
  // ready. Decode the exact initial document's JSON strings without executing
  // its scripts; do not make another request or alter the cold-entry timing.
  const chunks = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { chunks.push(JSON.parse(match[1])); } catch { /* Not a valid Flight string. */ }
  }
  return chunks.join('').match(/"b":"([^"\n]+)"/)?.[1] ?? null;
}
const report = { at: new Date().toISOString(), mode, minutes, airports, flags, utc, lighting, url: url.toString(), viewport: [1920, 1080], coldShaderDiskCache: true, entryMethod, errors: [], errorCount: 0, hotReloads: [], consoleErrors: [], responses: {}, visits: [], samples: [], shots: [], events: [] };
report.requestedCoverage = { seats: mode === 'cold' ? null : mode === 'views' ? viewSeats : 'all', nightWatchComparison: mode !== 'cold' && lighting === 'night' && nightComparison === '1', continuousRoutes: mode !== 'cold' && !seatedOnly, seatedVisualOnly: seatedOnly, postWindowGc };
if (mode === 'probe') report.probePurpose = 'Bounded normal-adaptive walk/zoom diagnosis with zero screenshots and no CPU profile; not a20-minute soak.';
report.source = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() };
report.source.checkout = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
report.source.files = Object.fromEntries(['scripts/review-living-observatory.cjs', 'lib/fly/observation-config.js', 'lib/fly/lounge/room-walk.mjs', 'lib/fly/lounge-walk-runtime.js', 'lib/fly/lounge/room-elevation.mjs', 'lib/fly/lounge/room-build.js', 'lib/fly/lounge/room-shading.js', 'lib/fly/lounge-site.js', 'lib/fly/lounge/observatory-instruments.js', 'lib/fly/lounge/observatory-model.mjs', 'lib/fly/lounge/observatory-stations.mjs', 'lib/fly/lounge-observatory-runtime.js', 'lib/fly/airport-watch-runtime.js', 'components/fly/hud/lounge/ObservatoryHud.jsx', 'components/fly/hud/lounge/observatory.css', 'components/fly/PrewarmRig.jsx', 'lib/fly/prewarm.js'].map((file) => [file, fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]));
for (const file of ['lib/fly/compile-scene-safe.js', 'lib/fly/cinema-profile-prewarm.js', 'lib/fly/critical-terrain-prewarm.mjs', 'lib/fly/measured-world-prewarm.js', 'lib/fly/world-material-factories.js', 'lib/fly/lounge/room-prewarm.js', 'lib/fly/lounge/room-lifecycle.mjs', 'lib/fly/lounge/room-textures.js', 'lib/fly/lounge-seats-pier.js', 'lib/fly/airfield/rendered-building-bound.js']) {
  report.source.files[file] = fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}
report.buildDirectory = path.resolve(arg('build-dir', '.next-observatory-final'));
const buildFile = path.join(report.buildDirectory, 'BUILD_ID');
report.buildId = fs.existsSync(buildFile) ? fs.readFileSync(buildFile, 'utf8').trim() : null;
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
    if (cpu) {
      const metrics = await cpu.send('Performance.getMetrics');
      (report.cpuPhases ??= []).push({ phase, timestamp: metrics.metrics.find((m) => m.name === 'Timestamp')?.value ?? null });
    }
    save();
  };
  const modelSnapshot = async (name) => {
    if (arg('model-snapshot', '0') !== '1') return;
    const input = await page.evaluate(() => {
      const r = window.__fly, w = r.airportWatch;
      return { at: performance.now(), site: w.site, floorY: w.floorY, eye: w.eyeLocal, selected: w.selected, runways: w.runways,
        origin: r.origin?.anchor, bend: r.bend ?? null,
        tracks: (r.traffic.items ?? []).map((t) => ({ hex: t.hex, rx: t.rx, ry: t.ry, ryd: t.ryd, rz: t.rz, stale: t.stale,
          horizonFade: t.horizonFade, fix1: t.fix1, meta: t.meta, flags: t.flags, source: t.source, scenery: t.scenery })),
        set: r.airportSet?.site === w.site ? { plan: r.airportSet.plan, apronY: r.airportSet.apronY() } : null };
    });
    fs.writeFileSync(path.join(out, name + '-model-input.json'), JSON.stringify(input, null, 2));
    (report.modelSnapshots ??= []).push(name + '-model-input.json');
  };
  const screenshot = async (name) => {
    if (mode === 'probe') return;
    const file = name + '.png';
    await page.screenshot({ path: path.join(out, file), timeout: 30000 });
    report.shots.push(file);
    (report.shotStates ??= []).push(await page.evaluate((file) => {
      const w = window.__fly.airportWatch;
      return { file, airport: w.airport?.id, variant: w.site?.variant, floorId: w.walk?.floorId, posture: w.posture, seat: w.seatId, eye: { ...w.eyeLocal }, yaw: w.yaw, pitch: w.pitch, mag: w.optics?.mag, nightWatch: w.observatory?.night ?? false, sunUtc: window.__flySunOverride ?? null };
    }, file));
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
        walkSpeed: w?.walk?.speed, floorId: w?.walk?.floorId, clearance: w?.walk && w.posture === 'standing' ? w.walk.clearance() : null,
        binocular: w?.binocular, mag: w?.optics?.mag, selected: w?.selected, tracked: w?.tracking,
        traffic: { count: r?.traffic?.tracks?.size, state: r?.trafficStatus?.state },
        tier: s?.qualityTier, frame, room: r?.loungeStats,
        governor: window.__flyGov?.state?.() ?? null,
        cinemaShadows: r?.cinemaShadows ? { cascades: r.cinemaShadows.cascades, size: r.cinemaShadows.size, rangeM: r.cinemaShadows.rangeM } : null,
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
    await page.waitForFunction(() => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === 'window'; }, undefined, { timeout: 90000 });
    await page.evaluate(() => window.__fly.airportWatch.stand());
    await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing', undefined, { timeout: 30000 });
    await page.getByTestId('lounge-surface').focus();
    const start = await page.evaluate(() => { const w = window.__fly.airportWatch; return { x: w.eyeLocal.x, z: w.eyeLocal.z, floorId: w.walk.floorId, variant: w.site.variant }; });
    const grid = walkGrids.get(start.variant);
    // A real round trip through the centre aisle. Both segments use the same
    // layered A* collision geometry as seating. The 8.5 cm waypoint arrival
    // tolerance is the same one exercised by the rendered stair review.
    // Only keyboard motion moves the eye; never assign its position.
    const targets = [['rear', { x: 0, z: start.variant === 'pier' ? 11.7 : 9.8, floorId: 'lower' }]];
    if (grid.layers) targets.push(['upper-front', { x: 0, z: 9.3, floorId: 'upper' }], ['upper-back', { x: 0, z: 12, floorId: 'upper' }]);
    targets.push(['front', { x: start.x, z: start.z, floorId: 'lower' }]);
    for (const [side, target] of targets) {
      const from = await page.evaluate(() => { const w = window.__fly.airportWatch; return { ...w.eyeLocal, floorId: w.walk.floorId }; });
      if (!walkModule.isFree(grid.layers?.[target.floorId] ?? grid, target.x, target.z)) throw new Error(`Blocked review target: ${side}`);
      const route = walkModule.findPath(grid, from, target);
      if (!route) throw new Error(`No continuous walking path to ${side} in ${start.variant}`);
      await page.evaluate((points) => {
        const w = window.__fly.airportWatch;
        const drive = window.__loungeRoute = { index: 1, done: false, points, travelled: 0, previous: { ...w.eyeLocal }, minClearance: Infinity, surfaces: {}, minY: w.eyeLocal.y, maxY: w.eyeLocal.y };
        const steer = () => {
          const eye = w.eyeLocal;
          drive.travelled += Math.hypot(eye.x - drive.previous.x, eye.y - drive.previous.y, eye.z - drive.previous.z);
          drive.previous = { ...eye };
          drive.surfaces[w.walk.floorId] = (drive.surfaces[w.walk.floorId] || 0) + 1;
          drive.minY = Math.min(drive.minY, eye.y); drive.maxY = Math.max(drive.maxY, eye.y);
          drive.minClearance = Math.min(drive.minClearance, w.walk.clearance());
          while (drive.index < points.length && Math.hypot(points[drive.index].x - eye.x, points[drive.index].z - eye.z) < .085) drive.index++;
          if (drive.index >= points.length) { drive.done = true; w.setMoveKeys(0, 0, false); return; }
          const p = points[drive.index];
          w.yaw = Math.atan2(-(p.x - eye.x), -(p.z - eye.z)); w.pitch = -.06;
          drive.raf = requestAnimationFrame(steer);
        };
        steer();
      }, route);
      try {
        await page.keyboard.down('w');
        await page.waitForFunction(() => window.__loungeRoute.done, undefined, { timeout: 90000 });
      } finally {
        await page.keyboard.up('w');
        await page.evaluate(() => { cancelAnimationFrame(window.__loungeRoute?.raf); window.__fly.airportWatch.setMoveKeys(0, 0, false); });
      }
      const result = await page.evaluate(() => { const p = window.__loungeRoute, w = window.__fly.airportWatch; return { done: p.done, travelled: p.travelled, minClearance: p.minClearance, surfaces: p.surfaces, minY: p.minY, maxY: p.maxY, eye: { ...w.eyeLocal }, floorId: w.walk.floorId }; });
      (report.visits.at(-1).routes ??= []).push({ cycle, side, from, target, points: route, ...result });
      if (result.floorId !== target.floorId) throw new Error(`Wrong floor at ${side}: ${result.floorId}`);
      await sample();
      await page.evaluate((rear) => { const w = window.__fly.airportWatch; w.yaw = rear ? Math.PI : 0; w.pitch = -.06; }, side === 'rear' || side === 'upper-back');
      await dwell(1000);
      if (cycle === 0) await screenshot(`${airport}-continuous-${side}`);
    }
  };
  try {
    if (mode !== 'cold') {
      const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
      walkModule = await import('../lib/fly/lounge/room-walk.mjs');
      walkGrids = new Map(['classic', 'pier'].map((variant) => [variant, walkModule.buildWalkSpace(roomBlockers(variant), { variant })]));
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
      await cpu.send('Performance.enable');
      await cpu.send('Profiler.start');
    }
    const documentResponse = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.airportWatch, undefined, { timeout: 240000 });
    report.renderer = await page.evaluate(() => {
      const gl = window.__loungeWebGL.context, ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), parallelShaderCompile: !!gl.getExtension('KHR_parallel_shader_compile'), gpuTimerQueryAvailable: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), checkShaderErrors: window.__flyGl?.debug.checkShaderErrors ?? null };
    });
    if (/swiftshader|llvmpipe|software/i.test(report.renderer.renderer)) throw new Error('A software renderer cannot certify this hardware route');
    report.browserVersion = browser.version();
    report.servedBuildId = await page.evaluate(() => {
      if (window.__NEXT_DATA__?.buildId) return window.__NEXT_DATA__.buildId;
      const flight = (window.__next_f ?? []).filter((row) => typeof row?.[1] === 'string').map((row) => row[1]).join('');
      return flight.match(/"b":"([^"\n]+)"/)?.[1] ?? null;
    });
    report.servedBuildIdSource = report.servedBuildId ? 'runtime-flight' : null;
    if (!report.servedBuildId && documentResponse) {
      const html = await documentResponse.text();
      report.servedDocument = { url: documentResponse.url(), status: documentResponse.status(), sha256: createHash('sha256').update(html).digest('hex') };
      report.servedBuildId = servedBuildFromHtml(html);
      if (report.servedBuildId) report.servedBuildIdSource = 'initial-document-flight';
    }
    console.log('REVIEW renderer', report.renderer.renderer);
    // The title deliberately exposes airport search before its background
    // world is ready. Use that real entry path: waiting for pct 100 first
    // skips a reachable cold-entry case while the title world is loading.
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
        await page.getByTestId(`airport-result-${entryId(airport)}`).locator('.ab-watch').click({ timeout: 30000 });
      } else await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
      await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
      report.visits.push({ airport, utc: solarHour, readyMs: Date.now() - entered, variant: await page.evaluate(() => window.__fly.airportWatch.site?.variant) });
      await page.evaluate(() => {
        const trace = window.__loungeReviewFrames = { values: [], distanceM: 0, distance3DM: 0, binocularFrames: 0, standingFrames: 0, floorFrames: {}, binocularFloorFrames: {}, lastCount: null, eye: null };
        const tick = () => {
          const w = window.__fly.airportWatch, frame = window.__flyStats?.frame;
          if (w?.active && w.validated && !document.hidden) {
            // BudgetFramePump renders at 60 Hz even when headless Chrome's
            // rAF runs faster. Count actual game frames, not callback cadence.
            if (frame && frame.count !== trace.lastCount) {
              trace.values.push(frame.lastDt);
              trace.lastCount = frame.count;
              if (w.binocular) trace.binocularFrames++;
              if (w.posture === 'standing') trace.standingFrames++;
              const floor = w.walk?.floorId ?? 'lower';
              trace.floorFrames[floor] = (trace.floorFrames[floor] || 0) + 1;
              if (w.binocular) trace.binocularFloorFrames[floor] = (trace.binocularFloorFrames[floor] || 0) + 1;
            }
            if (w.posture === 'standing') {
              if (trace.eye) {
                trace.distanceM += Math.hypot(w.eyeLocal.x - trace.eye.x, w.eyeLocal.z - trace.eye.z);
                trace.distance3DM += Math.hypot(w.eyeLocal.x - trace.eye.x, w.eyeLocal.y - trace.eye.y, w.eyeLocal.z - trace.eye.z);
              }
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
        await modelSnapshot(`${airport}-wide`);
        await screenshot(`${airport}-first-view`);
        await mark(`${airport}:first-binocular`);
        await page.evaluate(() => { const w = window.__fly.airportWatch; const row = w.snapshot().find((x) => x.inFront && x.stale === 0 && x.category !== 'ground'); if (row) w.select(row.hex); w.setMagnification(25); });
        await dwell(minutes * 30000);
        await modelSnapshot(`${airport}-binocular`);
        await screenshot(`${airport}-first-binocular`);
        await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
      } else {
        await dwell(10000);
        const seats = await page.evaluate(() => window.__fly.airportWatch.seats.map((s) => ({ id: s.id, floorId: s.floorId ?? 'lower', eyeY: s.eye[1] })));
        if (!seats.length) throw new Error('Walking review requires LOUNGE_WALK and at least one vantage seat');
        const visit = report.visits.at(-1);
        visit.seats = seats; visit.seatVisits = [];
        if (visit.variant === 'pier' && (seats.length < 6 || ['window', 'back', 'corner-left', 'corner-right', 'upper-front', 'upper-back'].some((id) => !seats.some((s) => s.id === id)))) throw new Error('The pier review requires all six lower and upper vantage seats');
        const requestedSeats = mode === 'views' && viewSeats === 'windows' ? seats.filter((s) => windowSeats.includes(s.id)) : seats;
        visit.requestedSeats = requestedSeats.map((s) => ({ ...s }));
        const begin = Date.now();
        let cycle = 0;
        do {
          if (!seatedOnly) await crossRoom(airport, cycle);
          for (const seatSpec of requestedSeats) {
            const seat = seatSpec.id;
            if ((mode === 'soak' || mode === 'probe') && Date.now() - begin >= minutes * 60000) break;
            await mark(`${airport}:${cycle}:${seat}:seat`);
            await page.evaluate((id) => { const w = window.__fly.airportWatch; w.setMoveKeys(0, 0, false); w.binoculars(false); w.clearSelection(); w.sit(id); }, seat);
            await page.waitForFunction((id) => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === id; }, seat, { timeout: 90000 });
            const seated = await page.evaluate(() => { const w = window.__fly.airportWatch; return { floorId: w.walk.floorId, eye: { ...w.eyeLocal }, posture: w.posture }; });
            visit.seatVisits.push({ id: seat, cycle, ...seated });
            if (seated.floorId !== seatSpec.floorId || Math.abs(seated.eye.y - seatSpec.eyeY) > .001) throw new Error(`Seat ${seat} settled on the wrong floor or at the wrong eye height`);
            await page.evaluate(() => window.__fly.airportWatch.resetLook());
            await dwell(4000);
            if (cycle === 0) await screenshot(`${airport}-${seat}-wide`);
            if (cycle === 0 && lighting === 'night' && nightComparison === '1' && windowSeats.includes(seat)) {
              await page.evaluate(() => { const o = window.__fly.airportWatch.observatory; if (o && !o.night) o.toggleNight(); });
              await dwell(3000);
              await screenshot(`${airport}-${seat}-night-watch`);
              await page.evaluate(() => { const o = window.__fly.airportWatch.observatory; if (o?.night) o.toggleNight(); });
              await dwell(3000);
            }
            if (!seatedOnly) {
              await mark(`${airport}:${cycle}:${seat}:walk`);
              await page.evaluate(() => window.__fly.airportWatch.stand());
              await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing', undefined, { timeout: 30000 });
              // Walk away from the chair with the real keyboard input, then look
              // across the room. Collision resolution remains entirely in-game.
              await page.getByTestId('lounge-surface').focus();
              await page.keyboard.down('s');
              try { await dwell(1800); } finally { await page.keyboard.up('s'); }
              await dwell(500);
              await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw += Math.PI; w.pitch = -.08; });
              await dwell(3000);
              if (cycle === 0) await screenshot(`${airport}-${seat}-standing-room`);
            }
            await mark(`${airport}:${cycle}:${seat}:binocular`);
            await page.evaluate(({ visualReview, seatedOnly }) => {
              const w = window.__fly.airportWatch;
              if (!seatedOnly) w.yaw -= Math.PI;
              // The room-facing shot deliberately looks down. For visual
              // matrix coverage, return to exterior detail near the horizon
              // so max zoom is not merely a magnified patch of empty ground.
              if (visualReview) w.pitch = -.01;
              w.binoculars(true, { acquire: false }); w.setMagnification(25);
            }, { visualReview: mode === 'views', seatedOnly });
            await dwell(mode === 'views' ? 5000 : 12000);
            if (cycle === 0) await screenshot(`${airport}-${seat}-binocular`);
            await page.evaluate(() => window.__fly.airportWatch.binoculars(false));
            console.log(`REVIEW ${airport} ${seat} cycle ${cycle} ${((Date.now() - begin) / 60000).toFixed(1)}m`);
          }
          cycle++;
        } while ((mode === 'soak' || mode === 'probe') && Date.now() - begin < minutes * 60000);
        report.visits.at(-1).exerciseMs = Date.now() - begin;
      }
      const frames = await page.evaluate(() => { const p = window.__loungeReviewFrames; cancelAnimationFrame(p.raf); return p; });
      const visit = report.visits.at(-1);
      visit.frames = summary(frames.values);
      visit.walkDistanceM = frames.distanceM;
      visit.walkDistance3DM = frames.distance3DM;
      visit.binocularFrames = frames.binocularFrames;
      visit.standingFrames = frames.standingFrames;
      visit.floorFrames = frames.floorFrames;
      visit.binocularFloorFrames = frames.binocularFloorFrames;
      let memorySession, memorySnapshot;
      if (postWindowGc && airport === airports.at(-1)) {
        // Deliberately after the complete measured frame window, and only
        // on the last visual visit. Never changes cold/soak frame evidence.
        await mark(`${airport}:post-window-gc`);
        memorySession = await context.newCDPSession(page);
        memorySnapshot = async () => ({
          heap: await memorySession.send('Runtime.getHeapUsage'),
          scene: await page.evaluate(() => {
            const r = window.__fly, w = r.airportWatch;
            let root = r.engine?.object; while (root?.parent) root = root.parent;
            const gl = root?.__r3f?.root?.getState?.().gl ?? window.__flyGl;
            return { at: performance.now(), active: w.active, eye: { ...w.eyeLocal }, posture: w.posture,
              programs: gl?.info?.programs?.length, geometries: gl?.info?.memory?.geometries, textures: gl?.info?.memory?.textures };
          }),
        });
        report.postWindowMemory = { note: 'Separate visual-run diagnostic after frame collection; not retained-heap proof for the earlier20-minute soak.', beforeGc: await memorySnapshot() };
        try {
          await memorySession.send('HeapProfiler.collectGarbage');
          report.postWindowMemory.afterGc = await memorySnapshot();
        } catch (error) { report.postWindowMemory.error = String(error); }
      }
      await mark(`${airport}:leave`);
      await page.evaluate(() => window.__fly.airportWatch.leave());
      if (memorySession) {
        await page.waitForTimeout(1000);
        report.postWindowMemory.oneSecondAfterLeave = await memorySnapshot();
        await memorySession.detach();
      }
    }
    report.resources = Object.fromEntries(['calls', 'triangles', 'programs', 'geometries', 'textures', 'heap'].map((key) => [key, summary(report.samples.map((x) => x[key]).filter(Number.isFinite))]));
    report.residency = { first: report.samples[0], last: report.samples.at(-1) };
    // Current lounge contract, FLY_OBSERVATION_LOUNGE.md:228. Earlier 360
    // context is retained as an informational comparison, not a moved gate.
    report.limits = { calls: 375, triangles: 2200000, p95Frame: 20, p99Frame: 33.3, source: 'FLY_OBSERVATION_LOUNGE.md:228' };
    report.stricter360DrawComparison = report.resources.calls.max <= 360;
    report.checks = {
      noPageErrors: report.errors.length === 0,
      stableBuild: report.hotReloads.length === 0,
      buildIdentityMatches: report.buildId && report.servedBuildId ? report.buildId === report.servedBuildId : null,
      frameBudget: report.visits.every((v) => v.frames.count > 1000 && v.frames.p95 <= 20 && v.frames.p99 <= 33.3),
      noMultiSecondVisibleStalls: report.visits.every((v) => v.frames.over1000 === 0),
      visibleThroughout: report.samples.every((s) => !s.hidden),
      drawBudget: report.resources.calls.max != null && report.resources.calls.max <= report.limits.calls,
      triangleBudget: report.resources.triangles.max != null && report.resources.triangles.max <= report.limits.triangles,
      binocularExercised: report.visits.every((v) => v.binocularFrames > 0),
      walkingExercised: mode === 'cold' || seatedOnly ? null : report.visits.every((v) => v.walkDistanceM >= 2),
      continuousRoundTrip: mode === 'cold' || seatedOnly ? null : report.visits.every((v) => v.routes?.some((r) => r.side === 'rear' && r.done && r.travelled >= 8) && v.routes.some((r) => r.side === 'front' && r.done && r.travelled >= 8)),
      allVantageSeatsVisited: mode === 'cold' || (mode === 'views' && viewSeats !== 'all') ? null : report.visits.every((v) => v.seats.every((s) => v.seatVisits.some((seen) => seen.id === s.id && seen.floorId === s.floorId))),
      requestedViewSeatsVisited: mode === 'views' ? report.visits.every((v) => v.requestedSeats.every((s) => v.seatVisits.some((seen) => seen.id === s.id && seen.floorId === s.floorId))) : null,
      upperAndStairsExercised: mode === 'cold' || seatedOnly ? null : report.visits.every((v) => v.variant !== 'pier' || (v.floorFrames.stairs > 0 && v.floorFrames.upper > 0 && v.binocularFloorFrames.upper > 0 && v.routes.some((r) => r.side === 'upper-front' && r.done && r.surfaces.stairs > 0 && r.surfaces.upper > 0 && r.maxY - r.minY > 4) && v.routes.some((r) => r.side === 'upper-back' && r.done && r.floorId === 'upper') && v.routes.some((r) => r.side === 'front' && r.done && r.surfaces.stairs > 0 && r.surfaces.lower > 0 && r.maxY - r.minY > 4))),
      nightWatchPairs: report.requestedCoverage.nightWatchComparison ? report.visits.every(v => v.requestedSeats.filter(s => windowSeats.includes(s.id)).every(s =>
        report.shotStates?.some(shot => shot.file === `${v.airport}-${s.id}-wide.png` && shot.nightWatch === false)
        && report.shotStates?.some(shot => shot.file === `${v.airport}-${s.id}-night-watch.png` && shot.nightWatch === true))) : null,
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

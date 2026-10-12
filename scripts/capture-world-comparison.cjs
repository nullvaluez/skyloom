// Local review artifact only. Does not change the game, its defaults or saves.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { enterFlight } = require('./_skip-menus');
const { captureStreamersSettled, captureSceneCensus } = require('./graphics-capture-census.cjs');
const out = path.resolve('.graphics-review/world-comparison');
const sites = [
  { id: 'columbus', name: 'Columbus', detail: 'Airport & surrounding ground', airport: 'KCMH', lat: 39.997, lon: -82.894, altM: 950, headingRad: 1.7 },
  { id: 'manhattan', name: 'Manhattan', detail: 'Buildings & urban materials', airport: 'KJFK', lat: 40.713, lon: -74.016, altM: 850, headingRad: 0 },
  { id: 'innsbruck', name: 'Innsbruck', detail: 'Mountain slopes & atmosphere', airport: 'LOWI', lat: 47.26, lon: 11.35, altM: 2100, headingRad: 1.2 },
  { id: 'sydney', name: 'Sydney', detail: 'Coastline & airport surrounds', airport: 'YSSY', lat: -33.948, lon: 151.18, altM: 1000, headingRad: 0 },
];
const report = {
  purpose: 'Unedited game captures for visual review. Not a performance benchmark.',
  capturedAt: new Date().toISOString(),
  builds: {
    before: fs.readFileSync('.graphics-review/living-airports/baseline/.next/BUILD_ID', 'utf8').trim(),
    after: fs.readFileSync('.next-lounge-review/BUILD_ID', 'utf8').trim(),
  },
  pins: { viewport: [2560, 1440], dpr: 1, quality: 'high', governor: 'hold', visuals: 'enhanced', map: 'satellite', weather: 'baseline', sunUTC: '2026-10-12T16:00:00.000Z', cameraFov: 60, animationTimeSeconds: 240, traffic: 'Empty capture fixture, to remove moving contacts from comparisons' },
  notes: [
    'Whole pass compares the preserved pre-change build with the current lounge build, with all three Living Airports review switches enabled.',
    'Materials only compares airportArt=off/on inside one settled current-build scene. Airport discovery and scenery stay enabled in both images.',
    'Same camera, viewport, graphics quality, solar instant, weather preset and frozen animation clock. Geographic locations have different local solar times.',
    'Map imagery, elevation and vector tiles are live provider data. Separately loaded builds may have small streaming differences.',
    'UI hidden during capture; PNGs are not color graded, retouched or generated. The player aircraft remains visible.',
  ],
  sites, captures: [], errors: [],
};
function save() { fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2)); }

async function prepareCapture(page) {
  return page.evaluate(() => {
    const r = window.__fly;
    let scene = r.engine.object;
    while (scene.parent) scene = scene.parent;
    const state = scene.__r3f?.root?.getState();
    if (!state?.clock || !state.gl) throw new Error('R3F capture clock and canvas unavailable');
    // These overrides exist only in this isolated QA browser, never in source.
    window.__comparisonClockRestore = { clock: state.clock, elapsedTime: state.clock.elapsedTime, getDelta: state.clock.getDelta, getElapsedTime: state.clock.getElapsedTime, at: performance.now() };
    state.clock.elapsedTime = 240;
    state.clock.getDelta = () => 1 / 60;
    state.clock.getElapsedTime = () => 240;
    state.gl.domElement.setAttribute('data-world-comparison', '');
    const gl = state.gl.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, buffer: [state.gl.domElement.width, state.gl.domElement.height] };
  });
}

async function capture(page, site, variant, environment) {
  await page.waitForTimeout(1500);
  const census = await page.evaluate(captureSceneCensus);
  const settings = await page.evaluate(() => {
    const s = window.__flyStore.getState();
    return { quality: s.qualityTier, visuals: s.visuals, style: s.mapStyle, governor: window.__flyGov?.state(), sun: window.__fly.sun, graphics: window.__graphicsReview, cinemaProfile: window.__fly.cinemaProfile };
  });
  if (settings.quality !== 'high' || settings.visuals !== 'enhanced') throw new Error('Capture graphics settings drifted');
  const file = `${site.id}-${variant}.png`;
  await page.screenshot({ path: path.join(out, file), timeout: 30000, style: 'body * { visibility:hidden!important; } canvas[data-world-comparison] { visibility:visible!important; }' });
  report.captures.push({ site: site.id, variant, file, environment, census, settings });
  save();
  console.log(`CAPTURE ${file}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
  report.browser = browser.version();
  try {
    for (const arm of ['before', 'after']) {
      const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
      page.on('pageerror', e => report.errors.push({ arm, message: e.message }));
      await page.addInitScript(() => {
        window.__flyGovPin = 'hold';
        window.__flyVisualsOverride = 'enhanced';
        window.__flyWeatherOverride = 'baseline';
        window.__flySunOverride = Date.UTC(2026, 9, 12, 16);
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-quality-tier', 'high');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-encounters', '0');
      });
      await page.route('**/api/aircraft?**', r => r.fulfill({ json: { ac: [], now: Date.now(), source: 'Comparison capture fixture' } }));
      const url = arm === 'before' ? 'http://localhost:3098/?graphicsReview=1' : 'http://localhost:3097/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await enterFlight(page, sites[0]);
      await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 90000 });
      await page.evaluate(() => {
        // Flight-speed FOV eases while booting. Pin the lens for both captures
        // before streaming, so boot timing cannot introduce a scale mismatch.
        const camera = window.__fly.camera;
        Object.defineProperty(camera, 'fov', { configurable: true, get: () => 60, set: () => {} });
        camera.updateProjectionMatrix();
      });
      for (const site of sites) {
        console.log(`SETTLE ${arm} ${site.id}`);
        if (arm === 'after') {
          await page.evaluate(id => window.__fly.airportWatch.enter(id), site.airport);
          await page.evaluate(() => window.__fly.airportWatch.leave());
        }
        await page.evaluate(site => {
          const r = window.__fly, s = window.__flyStore.getState();
          r.operations.profile = null;
          r.operations.phase = 'airborne';
          s.setPhase('flying');
          r.warpToGeo(site.lat, site.lon, { altM: site.altM, headingRad: site.headingRad });
          s.setPhase('paused');
          r.chaseCam?.snap?.();
        }, site);
        await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 90000 });
        await page.waitForFunction(captureStreamersSettled, undefined, { timeout: 90000 });
        await page.waitForTimeout(6000);
        const environment = await prepareCapture(page);
        if (arm === 'after') {
          for (const [value, variant] of [['off', 'materials-before'], ['on', 'after']]) {
            await page.evaluate(value => {
              const url = new URL(location.href);
              url.searchParams.set('airportArt', value);
              history.replaceState(null, '', url);
            }, value);
            await capture(page, site, variant, environment);
          }
        } else await capture(page, site, arm, environment);
        await page.evaluate(() => {
          const saved = window.__comparisonClockRestore;
          saved.clock.getDelta = saved.getDelta;
          saved.clock.getElapsedTime = saved.getElapsedTime;
          saved.clock.elapsedTime = saved.elapsedTime + (performance.now() - saved.at) / 1000;
          saved.clock.oldTime = performance.now();
          delete window.__comparisonClockRestore;
        });
      }
      await page.close();
    }
    report.cameraChecks = sites.map(site => {
      const captures = report.captures.filter(c => c.site === site.id);
      const camera = captures[0].census.camera;
      const maxPoseDelta = Math.max(...captures.flatMap(c => [...c.census.camera.position.map((v, i) => Math.abs(v - camera.position[i])), ...c.census.camera.quaternion.map((v, i) => Math.abs(v - camera.quaternion[i])), Math.abs(c.census.camera.fov - camera.fov)]));
      return { site: site.id, maxPoseDelta, matching: maxPoseDelta < 0.0001 };
    });
    if (report.cameraChecks.some(c => !c.matching)) throw new Error('Paired cameras do not match; inspect manifest before publishing');
    report.complete = report.captures.length === 12 && report.errors.length === 0;
  } catch (error) {
    report.failure = error.stack;
    console.error(error);
    process.exitCode = 1;
  } finally {
    save();
    await browser.close();
  }
})();

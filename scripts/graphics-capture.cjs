/* Visual evidence without _boot.js. --fixed-tier holds only the governor for matched
 * comparisons; graphics-flight.cjs always measures unpinned production behaviour. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k,v] = s.replace(/^--/, '').split('='); return [k,v ?? true]; }));
const stage = args.stage || 'cinematic';
const output = path.resolve(args.output || `.graphics-review/${stage}`);
const url = args.url || process.env.FLY_URL || 'http://localhost:3000';
const sites = {
  manhattan: { lat: 40.7028, lon: -74.017, ground: 0, heading: 0.3, noon: 17, dusk: 24.3, night: 4 },
  powell: { lat: 40.2083, lon: -83.0701, ground: 280, heading: 1.9, noon: 18, dusk: 25, night: 5 },
  ohio: { lat: 40.20403, lon: -83.0896, ground: 280, heading: 3.9, noon: 18, dusk: 25, night: 5 },
  melton: { lat: -37.683, lon: 144.582, ground: 135, heading: 1.9, noon: 2, dusk: 7.4, night: 15 },
  paris: { lat: 48.8579, lon: 2.301, ground: 35, heading: 2.6, noon: 12, dusk: 20.8, night: 23 },
  owens: { lat: 36.601, lon: -118.06, ground: 1150, heading: 1.9, noon: 20, dusk: 27.3, night: 8 },
};

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = { stage, ...require('./graphics-source.cjs')(),
    recordedAt: new Date().toISOString(), viewport: { width: Number(args.width||1920), height: Number(args.height||1080) },
    purpose: 'fixed-pose visual evidence; not a frame-time benchmark', errors: [], shots: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|ReferenceError|TypeError/.test(m.text())) report.errors.push(m.text().slice(0,2500)); });
    await page.addInitScript(({ stage, fixedTier, featureOff }) => {
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-sound-on', '0');
      window.__flyWeatherOverride = 'baseline';
      window.__flySunOverride = Date.UTC(2026, 6, 18, 17);
      if (fixedTier) window.__flyGovPin = 'hold';
      if (stage === 'cinematic') window.__flyVisualsArm = 1;
      if (featureOff.length) window.__flyVisualsFeatures = Object.fromEntries(featureOff.map(key=>[key,false]));
    }, { stage, fixedTier: !!args['fixed-tier'], featureOff: (args['feature-off']||'').split(',').filter(Boolean) });
    await page.goto(`${url}/?graphics=${encodeURIComponent(stage)}&graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    report.hardware = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: !!gl, renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), vendor: ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), userAgent: navigator.userAgent };
    });
    report.hardware.cpu = require('node:os').cpus()[0]?.model;
    report.hardware.memoryBytes = require('node:os').totalmem();
    console.log(JSON.stringify({ stage, hardware: report.hardware }));
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && !!window.__fly, null, { timeout: 90000 });
    const keys = args.sites ? args.sites.split(',') : args.site ? [args.site] : args.full ? Object.keys(sites) : ['manhattan', 'powell'];
    for (const name of keys) {
      for (const time of (args.times ? args.times.split(',') : args.quick ? ['noon'] : args.matrix ? ['noon','dusk','night'] : ['noon', 'night'])) {
        for (const aglFt of (args.alts ? args.alts.split(',').map(Number) : args.full || args.matrix ? [300, 1000, 3000] : [1000])) {
          await page.evaluate(({ site, time, aglFt }) => {
            const fly = window.__fly;
            window.__flySunOverride = Date.UTC(2026, 6, 18) + (site[time] ?? site.noon)*3600000;
            window.__flyStore.getState().setQualityTier('high');
            fly.warpToGeo(site.lat, site.lon, { altM: site.ground + aglFt * 0.3048, name: null });
            const f = fly.flight;
            f.heading = site.heading; f.pitch = -0.08; f.bank = 0;
            const pin = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
            window.__graphicsPose = pin;
            clearInterval(window.__graphicsPoseTimer);
            window.__graphicsPoseTimer = setInterval(() => {
              Object.assign(f.pos, pin); f.heading = site.heading; f.pitch = -0.08; f.bank = 0; f.speed = 0;
            }, 16);
            fly.chaseCam?.snap?.();
          }, { site: sites[name], time, aglFt });
          await page.waitForTimeout(Number(args.settle || 20000));
          await page.waitForFunction(() => (window.__fly?.satBuildings?.stats?.ready ?? 0) > 0 && window.__graphicsReview?.terrain?.sharp, null, {timeout:45000}).catch(error => {
            // Optional diagnostic image, never a relaxed readiness verdict.
            if (!args['capture-unready']) throw error;
            (report.readinessFailures ??= []).push({name,time,aglFt,reason:error.message});
          });
          // Use the resolved DEM for actual AGL, not the approximate bootstrap elevation.
          await page.evaluate(aglFt => { window.__graphicsPose.y = window.__fly.flight.groundElev + aglFt * 0.3048; }, aglFt);
          await page.waitForTimeout(3000);
          const telemetry = await page.evaluate(() => ({ stats: window.__flyStats,
            review: window.__graphicsReview,
            boot: window.__flyBoot, tier: window.__flyStore?.getState().qualityTier,
            activePins: Object.fromEntries(['__flyTerraPin','__flyDepthPin','__flyGovPin','__flyAerialOverride','__flyNightCityArm','__flyVisualsArm','__flyVisualsFeatures'].map(k=>[k,window[k] ?? null])) }));
          const file = `${name}-${time}-${aglFt}.png`;
          await page.screenshot({ path: path.join(output, file) });
          report.shots.push({ name, time, site: sites[name], requestedAglFt: aglFt, file, ...telemetry });
          fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, status: 'IN_PROGRESS' }, null, 2));
          console.log(`Captured ${file}`);
        }
      }
    }
    const software = /swiftshader|llvmpipe|software/i.test(report.hardware.renderer || '');
    const empty = report.shots.some(s => !(s.review?.buildings?.ready > 0 || s.stats?.satBuildings?.ready > 0));
    const unready = report.shots.some(s => !s.review?.terrain?.sharp) || !!report.readinessFailures?.length;
    report.status = software || empty || unready ? 'BLOCKED' : report.errors.length ? 'FAIL' : 'CAPTURED';
    report.reason = software ? 'Software renderer: no GPU performance certification.' : empty ? 'Required building residency not established.' : unready ? 'Terrain imagery did not reach the active sharpness target.' : undefined;
  } catch (error) {
    report.status = 'BLOCKED'; report.reason = error.message;
    console.error(error.message);
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`GRAPHICS: ${report.status} (${output})`);
    process.exitCode = report.status === 'BLOCKED' ? 2 : report.status === 'FAIL' ? 1 : 0;
  }
})();

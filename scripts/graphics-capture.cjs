/* Visual evidence without _boot.js. --fixed-tier holds only the governor for matched
 * comparisons; graphics-flight.cjs always measures unpinned production behaviour. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { captureBudgetChecks } = require('./graphics-capture-budget.cjs');
const { captureStreamersSettled, captureSceneCensus } = require('./graphics-capture-census.cjs');

const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k,v] = s.replace(/^--/, '').split('='); return [k,v ?? true]; }));
const stage = args.stage || 'cinematic';
const output = path.resolve(args.output || `.graphics-review/${stage}`);
const url = args.url || process.env.FLY_URL || 'http://localhost:3000';
const sites = {
  jfk: { lat: 40.6245, lon: -73.7854, ground: 4, heading: 44*Math.PI/180, noon: 17, dusk: 24.3, night: 4 },
  elyria: { lat: 41.1859, lon: -82.0982, ground: 252, heading: 93*Math.PI/180, noon: 18, dusk: 25, night: 5 },
  erie: { lat: 41.7588, lon: -82.6925, ground: 175, heading: 349*Math.PI/180, noon: 18, dusk: 25, night: 5 },
  manhattan: { lat: 40.7028, lon: -74.017, ground: 0, heading: 0.3, noon: 17, dusk: 24.3, night: 4 },
  powell: { lat: 40.2083, lon: -83.0701, ground: 280, heading: 1.9, noon: 18, dusk: 25, night: 5 },
  'powell-reference': { lat: 40.1990, lon: -83.0811, ground: 280, heading: 339*Math.PI/180, noon: 18, dusk: 25, night: 5 },
  ohio: { lat: 40.20403, lon: -83.0896, ground: 280, heading: 3.9, noon: 18, dusk: 25, night: 5 },
  melton: { lat: -37.683, lon: 144.582, ground: 135, heading: 1.9, noon: 2, dusk: 7.4, night: 15 },
  paris: { lat: 48.8579, lon: 2.301, ground: 35, heading: 2.6, noon: 12, dusk: 20.8, night: 23 },
  owens: { lat: 36.601, lon: -118.06, ground: 1150, heading: 1.9, noon: 20, dusk: 27.3, night: 8 },
  'owens-boundary': { lat: 36.6326, lon: -117.945, ground: 2423, heading: 172*Math.PI/180, noon: 20, dusk: 27.3, night: 8 },
};

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = { stage, ...require('./graphics-source.cjs')(),
    recordedAt: new Date().toISOString(), viewport: { width: Number(args.width||1920), height: Number(args.height||1080) },
    purpose: 'Review-only fixed-pose visual evidence, not ordinary flight or a frame-time benchmark. Poses below the existing 50 m flight floor inspect materials only.', errors: [], shots: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    if(args['fail-worldcover']) {
      report.worldCoverFault = { mode: 'HTTP 503', intercepted: 0 };
      await page.route('https://wmts.terrascope.be/**', route => {
        report.worldCoverFault.intercepted++;
        return route.fulfill({ status: 503, body: 'Controlled land-cover outage' });
      });
    }
    if(args['audit-textures']) await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);
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
    await page.goto(`${url}/?graphics=${encodeURIComponent(stage)}&graphicsReview=1${args.earth ? '&earth=stylized' : ''}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (args['build-id']) {
      report.servedBuild = await require('./ground-build-receipt.cjs')(page, url, args['build-id']);
    }
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
          await page.evaluate(({ site, time, aglFt, msl }) => {
            const fly = window.__fly;
            window.__flyWeatherOverride = time === 'overcast' ? 'overcast' : 'baseline';
            window.__flySunOverride = Date.UTC(2026, 6, 18) + (site[time] ?? site.noon)*3600000;
            window.__flyStore.getState().setQualityTier('high');
            fly.warpToGeo(site.lat, site.lon, { altM: (msl ? 0 : site.ground) + aglFt * 0.3048, name: null });
            const f = fly.flight;
            f.heading = site.heading; f.pitch = -0.08; f.bank = 0;
            window.__graphicsPose = { y: f.pos.y };
            // Hold synchronously with rendering, after the real integrator.
            // The old interval fought its 50 m floor: images could show 50 ft
            // while AGL/HUD still reported 164 ft. Do not change flight physics
            // to take material-inspection images below that existing floor.
            fly.autopilot.disengage();
            window.__graphicsCaptureStep ??= f.step.bind(f);
            f.step = (dt, cmd) => {
              window.__graphicsCaptureStep(dt, { ...cmd, speedOverride: 0, turn: 0, pitch: 0, boost: false });
              f.pos.y = window.__graphicsPose.y;
              f.heading = site.heading; f.pitch = -0.08; f.bank = 0;
              f.agl = f.pos.y - f.groundElev;
            };
            fly.chaseCam?.snap?.();
          }, { site: sites[name], time, aglFt, msl: !!args.msl });
          await page.waitForTimeout(Number(args.settle || 20000));
          await page.waitForFunction(() => {
            const rt=window.__fly,b=rt?.satBuildings?.stats;
            // Cruise intentionally retires the near building ring above 2.8 km
            // AGL. Requiring a ready near chunk there makes a valid cruise view
            // impossible; require the observed altitude AND the retired ring.
            const nearReady=(b?.ready??0)>0 || (b?.ringOn===false&&rt.flight.pos.y-rt.flight.groundElev>2800);
            return nearReady&&window.__graphicsReview?.terrain?.sharp;
          }, null, {timeout:45000}).catch(async error => {
            // Optional diagnostic image, never a relaxed readiness verdict.
            (report.readinessFailures ??= []).push({name,time,aglFt,phase:'terrain/buildings',reason:error.message,census:await page.evaluate(captureSceneCensus)});
            if (!args['capture-unready']) throw error;
          });
          // Use the resolved DEM for actual AGL, not the approximate bootstrap elevation.
          await page.evaluate(({ aglFt, msl }) => { window.__graphicsPose.y = msl ? Math.max(window.__fly.flight.groundElev + 100, aglFt * 0.3048) : window.__fly.flight.groundElev + aglFt * 0.3048; }, { aglFt, msl: !!args.msl });
          await page.waitForTimeout(3000);
          await page.waitForFunction(captureStreamersSettled, null, {timeout:45000,polling:500}).catch(async error=>{
            (report.readinessFailures??=[]).push({name,time,aglFt,phase:'streamers',reason:error.message,census:await page.evaluate(captureSceneCensus)});
            if(!args['capture-unready'])throw error;
          });
          const sceneCensus=await page.evaluate(captureSceneCensus);
          if (args.earth) await page.waitForFunction(() => (window.__fly?.earthSurface?.ready ?? 0) >= 16 && window.__fly.earthSurface.pending === 0, null, { timeout: 90000 }).catch(error => {
            (report.readinessFailures ??= []).push({ name, time, aglFt, phase: 'surface-masks', reason: error.message });
            if (!args['capture-unready']) throw error;
          });
          const telemetry = await page.evaluate(() => ({ stats: window.__flyStats,
            pose: { altitudeM: window.__fly.flight.pos.y, groundM: window.__fly.flight.groundElev,
              actualAglM: window.__fly.flight.pos.y - window.__fly.flight.groundElev,
              reportedAglM: window.__fly.flight.agl, mode: 'review-only-fixed-pose' },
            review: window.__graphicsReview,
            earthSurface: window.__fly?.earthSurface,
            boot: window.__flyBoot, tier: window.__flyStore?.getState().qualityTier,
            ground: window.__fly?.groundImmersion,
            groundDetail: window.__fly?.groundDetail,
            satVeg: window.__fly?.satVeg?.stats,
            nightGround: window.__fly?.groundLighting,
            textureAudit: window.__groundTextureAudit?.snapshot(),
            shadowRadiusM: window.__fly?.shadowRadiusM,
            activePins: Object.fromEntries(['__flyTerraPin','__flyDepthPin','__flyGovPin','__flyAerialOverride','__flyNightCityArm','__flyVisualsArm','__flyVisualsFeatures','__flyGroundFeatures'].map(k=>[k,window[k] ?? null])) }));
          const file = `${name}-${time}-${aglFt}${args.msl ? '-msl' : ''}.png`;
          await page.screenshot({ path: path.join(output, file) });
          report.shots.push({ name, time, site: sites[name], requestedAglFt: args.msl ? null : aglFt, requestedMslFt: args.msl ? aglFt : null, file, sceneCensus, ...telemetry });
          if (Math.abs(telemetry.pose.actualAglM - telemetry.pose.reportedAglM) > 0.1 ||
              (!args.msl && Math.abs(telemetry.pose.actualAglM - aglFt * 0.3048) > 1)) {
            throw Error(`Capture altitude did not settle for ${file}: ${JSON.stringify(telemetry.pose)}`);
          }
          fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, status: 'IN_PROGRESS' }, null, 2));
          console.log(`Captured ${file}`);
        }
      }
    }
    const software = /swiftshader|llvmpipe|software/i.test(report.hardware.renderer || '');
    const empty = report.shots.some(s => {
      const buildings=s.review?.buildings??s.stats?.satBuildings;
      // Match the live readiness condition above in the final verdict too.
      return !(buildings?.ready>0 || (buildings?.ringOn===false&&s.ground?.aglM>2800));
    });
    const unready = report.shots.some(s => !s.review?.terrain?.sharp || !s.sceneCensus?.streamersSettled) || !!report.readinessFailures?.length;
    report.budgetChecks = captureBudgetChecks(report.shots, !!args['audit-textures']);
    const overBudget = args['gate-budgets'] && report.budgetChecks.some(s=>!s.pass);
    const allocationUnknown = args['audit-textures'] && report.budgetChecks.some(s=>!s.allocationObserved);
    if (args['fail-worldcover'] && (!report.worldCoverFault.intercepted ||
        report.shots.some(s => s.earthSurface?.worldCoverTiles !== 0 || s.earthSurface?.ready < 16))) {
      report.errors.push('Controlled WorldCover outage did not prove ready vector/imagery fallback without WorldCover tiles.');
    }
    report.status = software || empty || unready || allocationUnknown ? 'BLOCKED' : report.errors.length || overBudget ? 'FAIL' : 'CAPTURED';
    report.reason = software ? 'Software renderer: no GPU performance certification.' : empty ? 'Required building residency not established.' : unready ? 'Terrain sharpness or streamer settling was not established; see sceneCensus/readinessFailures.' : undefined;
    if(overBudget) report.reason='A fixed-pose draw, triangle or texture budget was exceeded; see budgetChecks.';
    if(allocationUnknown) report.reason='Texture allocation tracking is incomplete; see textureAudit.';
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

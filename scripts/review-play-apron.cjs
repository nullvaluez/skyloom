// Play Pass APRON review captures (desktop Chrome, real GPU, live feeds):
// the airfield ground seen from the lounge window seat, naked eye and through
// the binoculars, at day and night (FLY_PLAY_PASS.md, stream APRON).
//
//   node scripts/review-play-apron.cjs [--port 3135] [--airport KJFK] [--utc 16]
//        [--flags -APRON_DETAIL] [--out .graphics-review/play-pass/apron/<name>]
//        [--views seat,down,left,right,near,mid,far,edge,edge20] [--settle 25]
//        [--size 1440x900] [--weather baseline]
//
// Views: seat = the default window view; down / left / right = naked-eye
// looks; near / mid / far = binoculars (4x / 8x / 14x) on the apron and
// taxiways in front of the seat; edge / edge20 = the far edge of the airfield
// at 8x / 20x. Each view writes a PNG; report.json carries the airfield
// ground stats, renderer counts and every console / page error (shader
// compile errors included).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const port = arg('port', '3135');
const airport = arg('airport', 'KJFK');
const utc = arg('utc', '');
const flags = arg('flags', '');
// The weather pin (window.__flyWeatherOverride): 'baseline' is the neutral
// sky the harness fleet uses, so a before / after pair is lit the same way;
// 'live' leaves the real weather.
const weather = arg('weather', 'baseline');
const settle = Number(arg('settle', '25')) * 1000;
const [W, H] = arg('size', '1440x900').split('x').map(Number);
const views = arg('views', 'seat,down,left,right,near,mid,far,edge,edge20').split(',');
const out = path.resolve(arg('out', `.graphics-review/play-pass/apron/${airport}-${utc || 'live'}${flags ? '-' + flags.replace(/[^A-Za-z0-9-]/g, '') : ''}`));
const url = `http://localhost:${port}/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on${flags ? `&flags=${flags}` : ''}`;
fs.mkdirSync(out, { recursive: true });
const report = { airport, url, utc, flags, weather, errors: [], shots: [] };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 600)); });
  const shot = async (name) => {
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    report.shots.push(file);
    console.log('shot', file);
  };
  // Look relative to the seat's own facing (lookLimits().face), naked eye or at a magnification.
  const look = async (dyaw, pitch, mag = 1) => {
    await page.evaluate(([dy, p, m]) => {
      const w = window.__fly.airportWatch;
      w.clearSelection?.();
      if (m > 1) { if (!w.binocular) w.binoculars(true, { acquire: false }); w.setMagnification(m); }
      else if (w.binocular) w.binoculars(false);
      const lim = w.lookLimits();
      w.tracking = false;
      w.yaw = lim.face + dy;
      w.pitch = p;
    }, [dyaw, pitch, mag]);
    await page.waitForTimeout(mag > 1 ? 2600 : 1400);
  };
  try {
    await page.addInitScript(([utcHour, wx]) => {
      window.__flyVisualsOverride = 'enhanced';
      if (wx !== 'live') window.__flyWeatherOverride = wx;
      if (utcHour !== '') { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(utcHour)); }
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
    }, [utc, weather]);
    await page.goto(url, { timeout: 240000 });
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 240000 });
    await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
    await page.waitForFunction(() => window.__airfieldGround?.state === 'ready', undefined, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(settle);
    report.stats = await page.evaluate(() => {
      const g = window.__airfieldGround, info = window.__flyGl?.info ?? null, w = window.__fly.airportWatch;
      return {
        site: w.site && { source: w.site.source, runway: w.site.runwayId, along: Math.round(w.site.along), cross: Math.round(w.site.cross), floorM: w.site.floorM },
        ground: g && { state: g.stats.state, draws: g.stats.draws, triangles: g.stats.triangles, photo: g.stats.photo, runways: g.stats.runways, pavementInfo: g.stats.pavementInfo, apron: g.stats.apron ?? null },
        render: info && { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length },
        playPass: window.__flyPlayPass ?? null,
      };
    });
    console.log(JSON.stringify(report.stats.render), JSON.stringify(report.stats.ground?.apron ?? null));
    for (const view of views) {
      if (view === 'seat') { await look(0, -0.07); await shot('01-seat'); }
      if (view === 'down') { await look(0, -0.62); await shot('02-down'); }
      if (view === 'left') { await look(1.0, -0.06); await shot('03-left'); }
      if (view === 'right') { await look(-1.0, -0.06); await shot('04-right'); }
      if (view === 'near') { await look(0.15, -0.16, 4); await shot('05-bino-near-4x'); }
      if (view === 'mid') { await look(-0.1, -0.06, 8); await shot('06-bino-mid-8x'); }
      if (view === 'far') { await look(0.05, -0.03, 14); await shot('07-bino-far-14x'); }
      if (view === 'edge') { await look(0.25, -0.004, 8); await shot('08-bino-edge-8x'); }
      if (view === 'edge20') { await look(0.25, -0.002, 20); await shot('09-bino-edge-20x'); }
    }
    await page.evaluate(() => { const w = window.__fly.airportWatch; if (w.binocular) w.binoculars(false); });
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(e);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('errors', report.errors.length);
    await browser.close();
  }
})();

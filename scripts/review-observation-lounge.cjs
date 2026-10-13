// Observation lounge review captures (desktop Chrome, real GPU, live feeds).
//
//   node scripts/review-observation-lounge.cjs [--port 3123] [--airport KCMH]
//        [--utc 16] [--out .graphics-review/observation-lounge/<name>]
//        [--views default,up,left,right,down,track,binoculars,click] [--settle 20]
//
// --utc pins the sun to that UTC hour today (__flySunOverride), so a review
// can ask for day, golden hour or night wherever the airport is. Every run
// writes PNGs plus report.json (traffic, contrails, fleet, frame stats,
// renderer counts and console errors) into --out.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const port = arg('port', '3123');
const airport = arg('airport', 'KCMH');
const utc = arg('utc', '');
const settle = Number(arg('settle', '20')) * 1000;
const views = arg('views', 'default,up,left,right,down,track,binoculars,click').split(',');
const out = path.resolve(arg('out', `.graphics-review/observation-lounge/${airport}-${utc || 'live'}`));
const url = arg('url', `http://localhost:${port}/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on`);
fs.mkdirSync(out, { recursive: true });
const report = { airport, url, utc, errors: [], shots: [], views: {} };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 400)); });
  const shot = async (name) => {
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    report.shots.push(file);
    console.log('shot', file);
  };
  const look = (yaw, pitch) => page.evaluate(([y, p]) => { const w = window.__fly.airportWatch; w.tracking = false; w.yaw = y; w.pitch = p; }, [yaw, pitch]);
  try {
    await page.addInitScript((utcHour) => {
      window.__flyVisualsOverride = 'enhanced';
      if (utcHour !== '') { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(utcHour)); }
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
    }, utc);
    await page.goto(url, { timeout: 240000 });
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 240000 });
    await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
    await page.waitForTimeout(settle);
    report.stats = await page.evaluate(() => {
      const r = window.__fly, w = r.airportWatch, stats = window.__flyStats || {};
      const rows = w.snapshot();
      const info = window.__flyGl?.info ?? null;
      return {
        trafficStatus: r.trafficStatus, items: r.traffic.items.length, nearby: rows.length,
        rows: rows.slice(0, 12).map((x) => ({ hex: x.hex, label: x.label, cat: x.category, km: +(x.distance / 1000).toFixed(1), front: x.inFront })),
        wake: stats.trafficWake, liveFleet: r.liveFleet, frame: stats.frame, quality: window.__flyStore.getState().qualityTier,
        site: w.site && { runway: w.site.runwayId, along: Math.round(w.site.along), cross: Math.round(w.site.cross), floorM: w.site.floorM, headingDeg: +(w.site.heading * 180 / Math.PI).toFixed(1) },
        camera: { fov: r.camera.fov, near: r.camera.near },
        render: info && { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures },
      };
    });
    console.log(JSON.stringify({ site: report.stats.site, nearby: report.stats.nearby, wake: report.stats.wake, render: report.stats.render }));
    for (const view of views) {
      if (view === 'default') { await look(0, -0.07); await page.waitForTimeout(1200); await shot('01-default'); }
      if (view === 'up') { await look(0.2, 0.75); await page.waitForTimeout(1200); await shot('02-up'); }
      if (view === 'left') { await look(1.1, -0.05); await page.waitForTimeout(1200); await shot('03-left'); }
      if (view === 'right') { await look(-1.1, -0.05); await page.waitForTimeout(1200); await shot('04-right'); }
      if (view === 'down') { await look(0, -0.62); await page.waitForTimeout(1200); await shot('05-down'); }
      if (view === 'back') { await look(2.3, -0.1); await page.waitForTimeout(1200); await shot('06-back'); }
      if (view === 'track' || view === 'binoculars') {
        const target = await page.evaluate(() => {
          const w = window.__fly.airportWatch;
          const rows = w.snapshot().filter((x) => x.inFront && x.stale === 0);
          const pick = rows.find((x) => x.category === 'approach' || x.category === 'departure') || rows.find((x) => x.category !== 'ground') || rows[0];
          if (!pick) return null;
          w.select(pick.hex);
          return pick;
        });
        report.views.target = target;
        await page.waitForTimeout(2000);
        if (view === 'track') await shot('07-track');
        if (view === 'binoculars') {
          await page.evaluate(() => { const w = window.__fly.airportWatch; if (w.zoom > 0.99) w.binoculars(); });
          await page.waitForTimeout(2500);
          await shot('08-binoculars');
          await page.evaluate(() => { const w = window.__fly.airportWatch; if (w.zoom < 0.99) w.binoculars(); });
        }
      }
      if (view === 'click') {
        await look(0, -0.07); await page.waitForTimeout(800);
        // Click the projected position of the nearest visible contact.
        const at = await page.evaluate(() => {
          const r = window.__fly, cam = r.camera, o = r.origin.anchor;
          for (const row of r.airportWatch.snapshot()) {
            const t = r.traffic.tracks.get(row.hex); if (!t) continue;
            const v = new cam.position.constructor(t.rx - o.x, t.ryd ?? t.ry, t.rz - o.z).project(cam);
            if (v.z < 1 && Math.abs(v.x) < .9 && Math.abs(v.y) < .9) return { hex: row.hex, x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
          }
          return null;
        });
        if (at) { await page.mouse.click(at.x, at.y); await page.waitForTimeout(900); }
        report.views.click = { at, selected: await page.evaluate(() => window.__fly.airportWatch.selected), inspect: await page.evaluate(() => window.__flyStore.getState().inspectHex) };
        await shot('09-after-click');
      }
    }
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(e);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
